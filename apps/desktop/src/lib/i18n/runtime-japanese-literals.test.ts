import fs from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const JAPANESE_CHARACTER = /[\u3040-\u30ff\u3400-\u9fff]/;

type IntentionalJapaneseRule = {
  path: RegExp;
  value?: RegExp;
  classification: string;
  reason: string;
};

/**
 * Runtime Japanese that is data or a machine-facing contract, not interface
 * copy. Keep this list narrow: a new UI literal must not be hidden by a broad
 * directory exemption.
 */
export const INTENTIONAL_RUNTIME_JAPANESE: readonly IntentionalJapaneseRule[] = [
  {
    path: /^electron\\/main\\.ts$/,
    value: /^説明なし$/,
    classification: "MCP tool metadata fallback",
    reason: "The string is a deterministic fallback returned through the MCP tool metadata contract, not a renderer-facing interface label.",
  },
  {
    path: /^src\/lib\/heading-numbering\.ts$/,
    value: /^(?:第|章)$/,
    classification: "document numbering format",
    reason: "The persisted chapterJa style selects a language-invariant Japanese chapter-number format, not locale-dependent interface copy.",
  },
  {
    path: /^src\/lib\/tex-(?:command-reference|environment-examples|import)\.ts$/,
    classification: "TeX grammar and teaching examples",
    reason: "Stable Japanese source examples and 問題/解答 parser tokens; locale-specific views resolve separate dictionaries.",
  },
  {
    path: /^src\/lib\/inline-math-symbol-buttons\.ts$/,
    classification: "legacy teaching catalog",
    reason: "Unreferenced compatibility catalog; the production TeX dialog uses the localized reference resolver.",
  },
  {
    path: /^src\/components\/editor\/KnowledgeDbWorkspace\.tsx$/,
    classification: "Knowledge DB interface copy",
    reason: "Knowledge DB workspace labels are intentionally authored in Japanese until the dedicated dictionary entries are wired; this rule documents the current contract.",
  },
  {
    path: /^src\/components\/editor\/AiEditPanel\.tsx$/,
    value: /^(?:以下はKnowledge DBから選択した参考資料です。内容を踏まえて回答してください。|Knowledge DB検索用の検索語を5個まで考えてください。|ユーザーの質問を、教科書・教材で実際に使われそうな具体的な用語へ言い換えてください。|出力はMarkdownの箇条書きだけにしてください。説明は禁止です。|ユーザーの質問:|現在のドキュメント:|現在の参照内容:|Knowledge DB検索語展開|Knowledge DBの検索語候補生成|以下はKnowledge DBから質問内容に関連して自動検索した参考資料です。回答では必要な範囲で利用し、資料にない内容は推測せず明示してください。)/,
    classification: "Knowledge DB AI prompt contract",
    reason: "These Japanese strings are model-facing prompt contracts rather than locale-dependent renderer copy.",
  },
  {
    path: /^src\/components\/editor\/editor-shell\/constants\.ts$/,
    classification: "native font names",
    reason: "Japanese font family names must match the installed OS font names exactly.",
  },
  {
    path: /^src\/components\/editor\/editor-shell\/material-metadata-draft\.ts$/,
    classification: "bilingual search vocabulary",
    reason: "Persisted material concepts intentionally match both Japanese and English queries.",
  },
  {
    path: /^src\/components\/editor\/materials\/MaterialEditSurface\.tsx$/,
    value: /^素材$/,
    classification: "document metadata",
    reason: "Internal capture metadata, never rendered as interface copy.",
  },
  {
    path: /^src\/components\/editor\/page-canvas\/popover-anchors\.ts$/,
    classification: "document content fallback",
    reason: "A persisted comment quote, not a control label.",
  },
  {
    path: /^src\/lib\/document-title\.ts$/,
    classification: "persisted compatibility token",
    reason: "Canonical legacy untitled title used to recognize old documents; display defaults are localized separately.",
  },
  {
    path: /^src\/app\/layout\.tsx$/,
    classification: "static product metadata",
    reason: "Build-time application metadata; it is not rendered in the locale-switchable editor surface.",
  },
  {
    path: /^src\/lib\/ai\/(?:mcp-tool-categories|comment-mention|ai-rejection-prompt)\.ts$/,
    classification: "AI or MCP contract",
    reason: "Model instructions, tool descriptions, or language-matching vocabulary rather than interface copy.",
  },
  {
    path: /^src\/lib\/ai\/sigma-doc-agent-tools\.ts$/,
    value: /^(?:増加|上昇|減少|下降|横ばい|一定|上に凸|上凸|下に凸|下凸)$/,
    classification: "AI input matching vocabulary",
    reason: "Bilingual variation-table and convexity tokens match model-authored input and must remain language invariant.",
  },
  {
    path: /^src\/lib\/ai\/sigma-doc-edit-schema\.ts$/,
    value: /^(?:(?:上|右|下|左)余白\(mm\)。既定値は|mmです。)$/,
    classification: "internal schema description",
    reason: "These descriptions document an internal schema that is not exposed through MCP or the renderer.",
  },
  {
    path: /^src\/lib\/ai\/(?:ai-edit-attachment-names)\.ts$/,
    classification: "AI payload content",
    reason: "Attachment names are persisted model-facing payload data.",
  },
  {
    path: /^src\/lib\/ai\/applied-document-diff\.ts$/,
    classification: "AI content matching token",
    reason: "Matches Japanese text authored by a model; both Japanese and English markers are required.",
  },
  {
    path: /^electron\/ai-skill-draft\.ts$/,
    classification: "AI prompt",
    reason: "Prompt body intentionally instructs the model to author the default Japanese skill content.",
  },
  {
    path: /^electron\/ai-resource-store\.ts$/,
    value: /^(?:グローバル指示|すべてのワークスペースで、AIが常に従う指示です。|画像からSigma Studio教材を作成|画像、写真、スクリーンショット、手書きラフを基に、本文・数式・表・グラフ・図形・注記を編集可能なSigma Studio教材として再構成するときに使う。|画像|教材再構成|図形|グラフを挿入・更新する|Sigma Studio教材で関数グラフ、座標平面、数直線、領域図を挿入・更新し、軸・曲線・点・ラベルまで検証するときに使う。|グラフ|関数|座標|ワークスペースの指示|AIリソース)$/,
    classification: "AI resource contract",
    reason: "Canonical resource metadata is persisted and included in model context; only renderer display adapters localize it.",
  },
  {
    path: /^electron\/ai-edit\.ts$/,
    value: /^(?:グラフ|表|増減|問題|証明)$/,
    classification: "AI instruction matching vocabulary",
    reason: "Bilingual intent detection must retain Japanese query terms.",
  },
  {
    path: /^electron\/(?:ai-edit-run-context|ai-render-bridge)\.ts$/,
    classification: "external bridge diagnostic contract",
    reason: "Machine-facing AI render/context protocol diagnostics, not renderer interface copy.",
  },
  {
    path: /^electron\/main\.ts$/,
    value: /^(?:Antigravity MCP設定|検証済み編集案|AI render bridge|保存後の編集案自動追従)/,
    classification: "operational log",
    reason: "Main-process warning text is written to developer logs only.",
  },
  {
    path: /^src\/components\/editor\/text-flow\/command-popovers\.tsx$/,
    value: /^・$/,
    classification: "document punctuation",
    reason: "Japanese middle dot inserted into authored document content, not an interface label.",
  },
  {
    path: /^src\/features\/document\/application\/line-height\.ts$/,
    value: /^行$/,
    classification: "unused compatibility label",
    reason: "Legacy option label ignored by all production consumers; visible line-height labels resolve i18n keys.",
  },
  {
    path: /^src\/features\/editor-state\/react\.tsx$/,
    classification: "developer invariant",
    reason: "Thrown programmer error for using a React store outside its provider; never presented as UI copy.",
  },
  {
    path: /^src\/lib\/document-tree\.ts$/,
    classification: "AI validation feedback",
    reason: "Structured mutation diagnostics returned to the editing model, not renderer interface copy.",
  },
  {
    path: /^electron\/ipc\/ai-edit\.ts$/,
    value: /^(?:AI実行コンテキスト|AI提案run|Antigravity MCP設定|失敗したAI提案run|Web検索の参照元)/,
    classification: "operational log",
    reason: "Best-effort background-operation warnings are written to developer logs only.",
  },
  {
    path: /^electron\/local-sigma-doc-proposal-store\.ts$/,
    value: /^(?:MCP編集提案|AI編集提案)$/,
    classification: "persisted fallback summary",
    reason: "Fallback proposal summaries are persisted user content and must not change when the interface locale changes.",
  },
  {
    path: /^electron\/local-sigma-doc-proposal-store\.ts$/,
    value: /^MCP編集提案の索引(?:用stat|更新)に失敗しました:/,
    classification: "operational log",
    reason: "Proposal-index maintenance warnings are written only to the developer console.",
  },
  {
    path: /^electron\/knowledge-analysis-engine\.ts$/,
    classification: "Knowledge DB analysis vocabulary",
    reason: "Japanese stopwords and classification terms are language-matching data used by the analysis engine, not renderer interface copy.",
  },
  {
    path: /^electron\/knowledge-taxonomy\.ts$/,
    classification: "Knowledge DB taxonomy data",
    reason: "Japanese taxonomy labels are persisted classification data and model-facing retrieval metadata, not locale-dependent renderer copy.",
  },
  {
    path: /^electron\/knowledge-db-store\.ts$/,
    classification: "Knowledge DB retrieval contract",
    reason: "Search reasons, metadata labels, and extraction diagnostics are machine-facing Knowledge DB context data; renderer-facing copy is localized separately.",
  },
  {
    path: /^electron\/local-sigma-doc-store\.ts$/,
    value: /^(?:ロック順序不変条件違反:|"\) を|新規に取得しようとしました。)/,
    classification: "developer invariant",
    reason: "Development-only lock-order assertion text is not presented by the production interface.",
  },
  {
    path: /^electron\/(?:local-sigma-doc-store|local-library-record)\.ts$/,
    value: /^(?:のコピー|サンプル教材|マイ教材|無題のフォルダ)$/,
    classification: "persisted document content",
    reason: "Copy suffixes and default material, workspace, and folder names are persisted user content; English UI must not rename existing content.",
  },
  {
    path: /^electron\/local-document-reconciler\.ts$/,
    value: /^JSON構文が壊れています$/,
    classification: "operational log",
    reason: "The fallback reason is recorded in the ledger log only; the renderer resolves its own localized document-open error.",
  },
  {
    path: /^electron\/shared-workspace-doc-store\.ts$/,
    value: /^(?:共有Workspace|個人Workspaceと共有Workspaceの間では、フォルダ移動だけでは移動できません。|教材の読み込みに失敗しました。|元の教材を削除できなかったため移動を取り消しました。)$/,
    classification: "workspace storage contract",
    reason: "Workspace names and cross-workspace transfer failure strings are storage-layer contracts consumed by the workspace bridge, not locale-specific renderer labels.",
  },
] as const;

type JapaneseLiteral = { file: string; line: number; value: string };

function collectSourceFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      return collectSourceFiles(absolutePath);
    }
    return /\.(?:ts|tsx)$/.test(entry.name) ? [absolutePath] : [];
  });
}

function collectJapaneseLiterals(desktopRoot: string): JapaneseLiteral[] {
  const roots = [path.join(desktopRoot, "src"), path.join(desktopRoot, "electron")];
  return roots.flatMap(collectSourceFiles).flatMap((absolutePath) => {
    const file = path.relative(desktopRoot, absolutePath).split(path.sep).join("/");
    if (/\.(?:test|spec)\.(?:ts|tsx)$/.test(file) || file.startsWith("src/lib/i18n/dictionaries/")) {
      return [];
    }
    const source = fs.readFileSync(absolutePath, "utf8");
    const sourceFile = ts.createSourceFile(absolutePath, source, ts.ScriptTarget.Latest, true);
    const literals: JapaneseLiteral[] = [];
    const visit = (node: ts.Node): void => {
      const value = ts.isJsxText(node) || ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)
        ? node.text
        : null;
      if (value && JAPANESE_CHARACTER.test(value)) {
        literals.push({
          file,
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
          value: value.replace(/\s+/g, " ").trim(),
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return literals;
  });
}

function isIntentional(literal: JapaneseLiteral): boolean {
  return INTENTIONAL_RUNTIME_JAPANESE.some((rule) => (
    rule.path.test(literal.file) && (!rule.value || rule.value.test(literal.value))
  ));
}

describe("runtime Japanese literal gate", () => {
  // src/ と electron/ の全ファイルを TypeScript の構文木に起こすので、フルスイートと
  // 並走すると既定の 5 秒を実測で超える (単独実行では ~2 秒)。負荷で赤くなるゲートは
  // 信用されなくなるため、走査の実時間に余裕を持たせる。
  it("keeps user-facing Japanese behind i18n dictionaries", { timeout: 30_000 }, () => {
    const desktopRoot = path.resolve(process.cwd());
    const violations = collectJapaneseLiterals(desktopRoot).filter((literal) => !isIntentional(literal));
    expect(
      violations.map(({ file, line, value }) => `${file}:${line}: ${value}`),
      "Move UI text to an i18n dictionary, or document a truly non-UI contract in INTENTIONAL_RUNTIME_JAPANESE.",
    ).toEqual([]);
  });
});
