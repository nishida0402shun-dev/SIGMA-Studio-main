// 重要:
// - command は process.execPath (Electron バイナリ)。.cjs を Node として実行させるため
//   env に ELECTRON_RUN_AS_NODE=1 を必ず入れる (これが無いと Electron が GUI として起動する)。
// - SIGMA_STUDIO_USER_DATA_DIR は main プロセスの USER_DATA_PATH と一致させること。
//   一致しないと MCP サーバーが書く pending proposal を main の watcher が監視できない。

import path from "node:path";

import type { AppLocale } from "@/lib/i18n";
import { VALIDATION_LOCALE_ENV } from "@/lib/ai/validation-locale";
import { MCP_TOOL_PROFILE_ENV } from "@/lib/ai/mcp-tool-profile";
import { SIGMA_STUDIO_RENDER_BRIDGE_FILE_ENV } from "./ai-render-bridge";
import { SIGMA_STUDIO_RUN_CONTEXT_FILE_ENV } from "./ai-edit-run-context";
import type { McpEditProposalProvider } from "./local-sigma-doc-proposal-store";

// local-sigma-doc-proposal-store.ts の McpEditProposalProvider を再エクスポートする別名。
// 起動元のprovider指定と提案の保存先providerは同じ値集合でなければならないため、型を分けない。
export type SigmaStudioMcpProvider = McpEditProposalProvider;

export const SIGMA_STUDIO_MCP_PROVIDER_ENV = "SIGMA_STUDIO_MCP_PROVIDER";

export interface SigmaStudioMcpLaunchSpec {
  /**
   * 検証フィードバックを組む言語。**必須** — optional にすると 4 つの呼び出し元のうち
   * 3 つが渡し忘れても型が黙り、Codex と Antigravity だけ日本語のままになる
   * (WI-8b の code-review で実際にそうなっていた)。
   */
  uiLocale: AppLocale;
  execPath: string;
  scriptPath: string;
  userDataDir: string;
  runContextFile: string;
  renderBridgeFile: string;
  provider: SigmaStudioMcpProvider;
  /**
   * Optional read-only SIGMA Core source-material server. It is added only when
   * the packaged script exists; older callers and tests without a Core script
   * keep producing exactly the existing single-server configuration.
   */
  coreScriptPath?: string;
  /** Defaults to `<userDataDir>/data/sigma-core`, matching SourceMaterialService. */
  coreDataDir?: string;
}

export const SIGMA_DOC_MCP_SERVER_NAME = "sigma-studio-local";
export const SIGMA_CORE_MCP_SERVER_NAME = "sigma-core-local";
export const SIGMA_CORE_AI_SUBJECT_ID = "studio-ai";

/** Stable sibling name used by the Electron build output. */
export function siblingCoreMcpScriptPath(docScriptPath: string): string {
  return path.join(path.dirname(docScriptPath), "sigma-core-mcp-server.cjs");
}

export interface SigmaCoreMcpStdioServer {
  type: "stdio";
  command: string;
  args: string[];
  env: Record<string, string>;
}

export function buildSigmaCoreMcpEnv(input: SigmaStudioMcpLaunchSpec): Record<string, string> | null {
  const scriptPath = input.coreScriptPath?.trim();
  if (!scriptPath) return null;
  const dataDir = input.coreDataDir?.trim() || path.join(input.userDataDir, "data", "sigma-core");
  return {
    ELECTRON_RUN_AS_NODE: "1",
    SIGMA_CORE_DB_PATH: path.join(dataDir, "core.sqlite"),
    SIGMA_CORE_BLOB_DIR: path.join(dataDir, "blobs"),
    SIGMA_CORE_SUBJECT_ID: SIGMA_CORE_AI_SUBJECT_ID,
  };
}

export function buildSigmaCoreMcpStdioServer(
  input: SigmaStudioMcpLaunchSpec,
): SigmaCoreMcpStdioServer | null {
  const env = buildSigmaCoreMcpEnv(input);
  if (!env || !input.coreScriptPath) return null;
  return {
    type: "stdio",
    command: input.execPath,
    args: [input.coreScriptPath],
    env,
  };
}

export function buildSigmaStudioMcpEnv(input: SigmaStudioMcpLaunchSpec): Record<string, string> {
  return {
    ELECTRON_RUN_AS_NODE: "1",
    SIGMA_STUDIO_USER_DATA_DIR: input.userDataDir,
    [SIGMA_STUDIO_RUN_CONTEXT_FILE_ENV]: input.runContextFile,
    [SIGMA_STUDIO_RENDER_BRIDGE_FILE_ENV]: input.renderBridgeFile,
    [SIGMA_STUDIO_MCP_PROVIDER_ENV]: input.provider,
    [MCP_TOOL_PROFILE_ENV]: "app",
    // 検証フィードバックの言語。**MCP サーバーは別プロセス**で renderer とメモリを
    // 共有しないので、起動時に渡すしかない (`src/lib/ai/validation-locale.ts`)。
    [VALIDATION_LOCALE_ENV]: input.uiLocale,
  };
}
