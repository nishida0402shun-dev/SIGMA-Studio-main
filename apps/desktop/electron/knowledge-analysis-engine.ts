import type { KnowledgeStructureBlock } from "./knowledge-db-structure-parser";

export type KnowledgeAnalysisSemanticType =
  | "problem"
  | "example"
  | "explanation"
  | "column"
  | "definition"
  | "theorem"
  | "answer"
  | "figure"
  | "unknown";

export interface KnowledgeAnalysisResult {
  semanticType: KnowledgeAnalysisSemanticType;
  title?: string;
  keywords: string[];
  signals: string[];
}

/**
 * Deterministic second-stage analysis for imported knowledge pages.
 *
 * PP-StructureV3 supplies layout-aware blocks; this layer turns those blocks
 * into stable metadata that can be persisted and consumed by retrieval/AI.
 * It deliberately does not call an external LLM, so indexing remains local,
 * reproducible, and usable offline.
 */
export function analyzeKnowledgePage(
  text: string,
  blocks: KnowledgeStructureBlock[] = [],
): KnowledgeAnalysisResult {
  const normalized = normalize(text);
  const blockText = blocks.map((block) => normalize(block.text)).filter(Boolean).join("\n");
  const combined = [normalized, blockText].filter(Boolean).join("\n");

  const signals: string[] = [];
  const scores = new Map<KnowledgeAnalysisSemanticType, number>();

  const add = (type: KnowledgeAnalysisSemanticType, score: number, signal: string) => {
    scores.set(type, (scores.get(type) ?? 0) + score);
    signals.push(signal);
  };

  if (blocks.some((block) => block.type === "table")) add("explanation", 1, "table");
  if (blocks.some((block) => block.type === "figure")) add("figure", 3, "figure");
  if (blocks.some((block) => block.type === "formula")) add("explanation", 1, "formula");
  if (blocks.some((block) => block.type === "title")) add("explanation", 0.5, "title-block");

  const rules: Array<[KnowledgeAnalysisSemanticType, RegExp, number, string]> = [
    ["problem", /(?:問題|練習問題|演習|設問|問\s*[0-9０-９]+|例題|practice|exercise|problem|question)[:：]?/u, 4, "problem-keyword"],
    ["example", /(?:例|具体例|例\s*[0-9０-９]+|example|worked example)[:：]?/u, 3, "example-keyword"],
    ["definition", /(?:定義|定義する|definition|defined as)[:：]?/u, 4, "definition-keyword"],
    ["theorem", /(?:定理|命題|補題|系|theorem|proposition|lemma|corollary)[:：]?/u, 4, "theorem-keyword"],
    ["answer", /(?:解答|答え|解説付き解答|answer|solution|解)[:：]?/u, 4, "answer-keyword"],
    ["column", /(?:コラム|column|note|豆知識)[:：]?/u, 3, "column-keyword"],
    ["explanation", /(?:解説|説明|考え方|ポイント|概説|explanation|overview|discussion)[:：]?/u, 2, "explanation-keyword"],
  ];
  for (const [type, pattern, score, signal] of rules) {
    if (pattern.test(combined)) add(type, score, signal);
  }

  const semanticType = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";

  const title = inferTitle(text, blocks);
  const keywords = extractKeywords(combined);

  return {
    semanticType,
    ...(title ? { title } : {}),
    keywords,
    signals: [...new Set(signals)].slice(0, 12),
  };
}

function inferTitle(text: string, blocks: KnowledgeStructureBlock[]): string | undefined {
  const titleBlock = blocks.find((block) => block.type === "title" && normalize(block.text));
  if (titleBlock) return cleanTitle(titleBlock.text);

  const firstLine = text
    .split(/\r?\n/u)
    .map((line) => cleanTitle(line))
    .find((line) => Boolean(line));
  return firstLine;
}

function extractKeywords(text: string): string[] {
  const tokens = text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}][\p{L}\p{N}_-]{1,}/gu) ?? [];

  const stop = new Set([
    "これ", "それ", "ため", "こと", "もの", "よう", "the", "and", "for", "with",
    "this", "that", "from", "into", "are", "was", "were",
  ]);
  const counts = new Map<string, number>();
  for (const token of tokens) {
    if (stop.has(token) || token.length < 2) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([token]) => token);
}

function cleanTitle(value: string): string {
  return value.replace(/\s+/gu, " ").trim().replace(/^[#＃\-—*]+\s*/u, "").slice(0, 160);
}

function normalize(value: string): string {
  return value.normalize("NFKC").trim();
}
