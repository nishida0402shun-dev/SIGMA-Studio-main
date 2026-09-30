import type { SigmaDocument } from "@/features/document";
import type { AiEditRunEvent, AiEditRunResult } from "@/lib/ai/ai-edit-runtime";
import { toAiResourceProvider, type AiEditProvider } from "@/lib/ai/ai-providers";
import type { AppLocale } from "@/lib/i18n";

import { LocalAiEditRunContextStore, prepareAiEditRunContext } from "./ai-edit-run-context";
import { runClaudeEditForIpc } from "./claude-edit";
import { buildClaudeMcpConfig } from "./claude-mcp-config";
import { CodexAppServerClient } from "./codex-app-server-client";
import { runAiEditForIpc } from "./ai-edit";
import { LocalAiResourceStore } from "./ai-resource-store";
import { readDesktopSettingsSync, isAiWebSearchEnabled, resolveDesktopPromptLocale } from "./desktop-settings";
import { runGeminiEditForIpc } from "./gemini-edit";
import { GeminiHeadlessClient } from "./gemini-headless-client";
import { buildGeminiWorkspaceSettings, writeGeminiWorkspaceSettings } from "./gemini-settings-config";
import { LocalSigmaDocStore } from "./local-sigma-doc-store";
import { LocalAiRenderBridgeStore } from "./ai-render-bridge";
import { ClaudeStreamClient } from "./claude-stream-client";

export interface WebAiAgentRunInput {
  runId: string;
  provider: AiEditProvider;
  fileId: string;
  instruction: string;
  model?: string;
  reasoningEffort?: string;
  roomId?: string;
  document: SigmaDocument;
  revision: number;
}

export interface WebAiAgentRuntimeDeps {
  userDataPath: string;
  dataDir: string;
  sigmaDocStore: LocalSigmaDocStore;
  aiResourceStore: LocalAiResourceStore;
  claudeStreamClient: ClaudeStreamClient;
  codexAppServerClient: CodexAppServerClient;
  geminiHeadlessClient: GeminiHeadlessClient;
  claudeRunContextStore: LocalAiEditRunContextStore;
  codexRunContextStore: LocalAiEditRunContextStore;
  geminiRunContextStore: LocalAiEditRunContextStore;
  aiRenderBridgeStore: LocalAiRenderBridgeStore;
  resolveMcpServerScriptPath: () => string;
  fallbackWorkspaceDirs: {
    claude: string;
    chatgpt: string;
    antigravity: string;
  };
}

export function createWebAiAgentRuntime(deps: WebAiAgentRuntimeDeps) {
  const activeRuns = new Map<string, { provider: AiEditProvider; cancel: () => boolean }>();

  async function start(
    input: WebAiAgentRunInput,
    onEvent: (event: AiEditRunEvent) => void,
  ): Promise<AiEditRunResult> {
    const provider = input.provider;
    const settings = readDesktopSettingsSync(deps.dataDir);
    const locale = (settings.uiLocale ?? resolveDesktopPromptLocale(deps.dataDir)) as AppLocale;
    const webSearchEnabled = isAiWebSearchEnabled(settings);
    const workspaceId = (await deps.sigmaDocStore.listFiles()).find((file) => file.fileId === input.fileId)?.workspaceId ?? null;
    const resourceProvider = toAiResourceProvider(provider);

    await deps.aiResourceStore.syncToRuntimeTargets({
      providers: [resourceProvider],
      workspaceIds: [workspaceId],
    });
    const cwd = deps.aiResourceStore.getAgentWorkspaceDir(resourceProvider, workspaceId);

    const runContextStores: LocalAiEditRunContextStore[] = provider === "claude"
      ? [new LocalAiEditRunContextStore(deps.userDataPath, "claude", { runId: input.runId })]
      : [
          provider === "chatgpt" ? deps.codexRunContextStore : deps.geminiRunContextStore,
          new LocalAiEditRunContextStore(
            deps.userDataPath,
            provider === "chatgpt" ? "chatgpt" : "antigravity",
            { runId: input.runId },
          ),
        ];

    const cleanups: Array<() => Promise<void>> = [];
    try {
      for (const store of runContextStores) {
        const cleanup = await prepareAiEditRunContext({
          provider,
          runContextStore: store,
          sigmaDocStore: deps.sigmaDocStore,
          runId: input.runId,
          payload: {
            fileId: input.fileId,
            document: input.document,
            instruction: input.instruction,
            model: input.model,
            reasoningEffort: input.reasoningEffort,
            roomId: input.roomId,
          },
        });
        cleanups.push(cleanup);
      }

      const aiResources = await deps.aiResourceStore.buildRunContext(
        resourceProvider,
        [],
        workspaceId,
      );
      const payload = {
        fileId: input.fileId,
        document: input.document,
        instruction: input.instruction,
        model: input.model,
        reasoningEffort: input.reasoningEffort,
        roomId: input.roomId,
      };

      if (provider === "claude") {
        const runContextFile = runContextStores[0]!.getRunContextFilePath();
        activeRuns.set(input.runId, {
          provider,
          cancel: () => deps.claudeStreamClient.cancelRun(input.runId),
        });
        return await runClaudeEditForIpc({
          claude: deps.claudeStreamClient,
          payload,
          aiResources,
          onEvent,
          runId: input.runId,
          userDataPath: deps.userDataPath,
          webSearchEnabled,
          locale,
          cwd,
          mcpConfig: buildClaudeMcpConfig({
            uiLocale: locale,
            execPath: process.execPath,
            scriptPath: deps.resolveMcpServerScriptPath(),
            userDataDir: deps.userDataPath,
            runContextFile,
            renderBridgeFile: deps.aiRenderBridgeStore.getBridgeFilePath(),
            provider: "claude",
          }),
        });
      }

      if (provider === "antigravity") {
        await writeGeminiWorkspaceSettings(
          cwd,
          buildGeminiWorkspaceSettings({
            execPath: process.execPath,
            scriptPath: deps.resolveMcpServerScriptPath(),
            userDataDir: deps.userDataPath,
            runContextFile: deps.geminiRunContextStore.getRunContextFilePath(),
            renderBridgeFile: deps.aiRenderBridgeStore.getBridgeFilePath(),
            provider: "antigravity",
            uiLocale: locale,
          }),
        );
        activeRuns.set(input.runId, {
          provider,
          cancel: () => deps.geminiHeadlessClient.cancelRun(input.runId),
        });
        return await runGeminiEditForIpc({
          gemini: deps.geminiHeadlessClient,
          payload,
          aiResources,
          onEvent,
          runId: input.runId,
          userDataPath: deps.userDataPath,
          webSearchEnabled,
          locale,
          cwd,
        });
      }

      activeRuns.set(input.runId, {
        provider,
        cancel: () => deps.codexAppServerClient.cancelByRunId(input.runId),
      });
      return await runAiEditForIpc({
        codex: deps.codexAppServerClient,
        payload,
        aiResources,
        onEvent,
        runId: input.runId,
        userDataPath: deps.userDataPath,
        webSearchEnabled,
        locale,
        cwd,
      });
    } finally {
      activeRuns.delete(input.runId);
      for (const cleanup of cleanups) {
        await cleanup().catch(() => undefined);
      }
    }
  }

  function cancel(runId: string): boolean {
    return activeRuns.get(runId)?.cancel() ?? false;
  }

  return { start, cancel };
}
