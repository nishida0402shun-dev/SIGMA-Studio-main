import { describe, expect, it } from "vitest";

import { buildClaudeMcpConfig } from "./claude-mcp-config";

describe("buildClaudeMcpConfig", () => {
  it("adds the read-only sigma-core-local server only when a Core script is supplied", () => {
    const withoutCore = buildClaudeMcpConfig({
      execPath: "/electron",
      scriptPath: "/app/sigma-doc-mcp-server.cjs",
      userDataDir: "/data",
      runContextFile: "/data/run-context.json",
      renderBridgeFile: "/data/render-bridge.json",
      provider: "claude",
      uiLocale: "ja" as const,
    });
    expect(withoutCore.mcpServers["sigma-core-local"]).toBeUndefined();

    const withCore = buildClaudeMcpConfig({
      execPath: "/electron",
      scriptPath: "/app/sigma-doc-mcp-server.cjs",
      coreScriptPath: "/app/sigma-core-mcp-server.cjs",
      userDataDir: "/data",
      runContextFile: "/data/run-context.json",
      renderBridgeFile: "/data/render-bridge.json",
      provider: "claude",
      uiLocale: "ja" as const,
    });
    expect(withCore.mcpServers["sigma-core-local"]).toEqual({
      type: "stdio",
      command: "/electron",
      args: ["/app/sigma-core-mcp-server.cjs"],
      env: {
        ELECTRON_RUN_AS_NODE: "1",
        SIGMA_CORE_DB_PATH: "/data/data/sigma-core/core.sqlite",
        SIGMA_CORE_BLOB_DIR: "/data/data/sigma-core/blobs",
        SIGMA_CORE_SUBJECT_ID: "studio-ai",
      },
    });
  });

  it("points the sigma-studio-local server at the bundled script via the Electron node runtime", () => {
    const config = buildClaudeMcpConfig({
      execPath: "/Applications/Sigma Studio.app/Contents/MacOS/Sigma Studio",
      scriptPath: "/app/dist-electron/sigma-doc-mcp-server.cjs",
      userDataDir: "/Users/teacher/Library/Application Support/Sigma Studio",
      runContextFile: "/data/data/ai-run-context/claude.run-context.json",
      renderBridgeFile: "/data/data/ai-run-context/render-bridge.json",
      provider: "claude",
      uiLocale: "ja" as const,
    });

    const server = config.mcpServers["sigma-studio-local"];
    expect(server.type).toBe("stdio");
    expect(server.command).toBe("/Applications/Sigma Studio.app/Contents/MacOS/Sigma Studio");
    expect(server.args).toEqual(["/app/dist-electron/sigma-doc-mcp-server.cjs"]);
  });

  it("sets ELECTRON_RUN_AS_NODE so the Electron binary runs the .cjs as Node", () => {
    const config = buildClaudeMcpConfig({
      execPath: "/electron",
      scriptPath: "/server.cjs",
      userDataDir: "/data",
      runContextFile: "/data/data/ai-run-context/claude.run-context.json",
      renderBridgeFile: "/data/data/ai-run-context/render-bridge.json",
      provider: "claude",
      uiLocale: "ja" as const,
    });

    expect(config.mcpServers["sigma-studio-local"].env.ELECTRON_RUN_AS_NODE).toBe("1");
  });

  it("injects SIGMA_STUDIO_USER_DATA_DIR so proposals land where main watches", () => {
    const config = buildClaudeMcpConfig({
      execPath: "/electron",
      scriptPath: "/server.cjs",
      userDataDir: "/Users/teacher/Library/Application Support/Sigma Studio",
      runContextFile: "/data/data/ai-run-context/claude.run-context.json",
      renderBridgeFile: "/data/data/ai-run-context/render-bridge.json",
      provider: "claude",
      uiLocale: "ja" as const,
    });

    expect(config.mcpServers["sigma-studio-local"].env.SIGMA_STUDIO_USER_DATA_DIR).toBe(
      "/Users/teacher/Library/Application Support/Sigma Studio",
    );
  });

  it("injects SIGMA_STUDIO_RUN_CONTEXT_FILE so the MCP server can read per-turn app context", () => {
    const config = buildClaudeMcpConfig({
      execPath: "/electron",
      scriptPath: "/server.cjs",
      userDataDir: "/data",
      runContextFile: "/data/data/ai-run-context/claude.run-context.json",
      renderBridgeFile: "/data/data/ai-run-context/render-bridge.json",
      provider: "claude",
      uiLocale: "ja" as const,
    });

    expect(config.mcpServers["sigma-studio-local"].env.SIGMA_STUDIO_RUN_CONTEXT_FILE).toBe(
      "/data/data/ai-run-context/claude.run-context.json",
    );
  });

  it("injects SIGMA_STUDIO_RENDER_BRIDGE_FILE so the MCP server can reach the app-assisted render bridge", () => {
    const config = buildClaudeMcpConfig({
      execPath: "/electron",
      scriptPath: "/server.cjs",
      userDataDir: "/data",
      runContextFile: "/data/data/ai-run-context/claude.run-context.json",
      renderBridgeFile: "/data/data/ai-run-context/render-bridge.json",
      provider: "claude",
      uiLocale: "ja" as const,
    });

    expect(config.mcpServers["sigma-studio-local"].env.SIGMA_STUDIO_RENDER_BRIDGE_FILE).toBe(
      "/data/data/ai-run-context/render-bridge.json",
    );
  });

  it("injects SIGMA_STUDIO_MCP_PROVIDER as claude", () => {
    const config = buildClaudeMcpConfig({
      execPath: "/electron",
      scriptPath: "/server.cjs",
      userDataDir: "/data",
      runContextFile: "/data/data/ai-run-context/claude.run-context.json",
      renderBridgeFile: "/data/data/ai-run-context/render-bridge.json",
      provider: "claude",
      uiLocale: "ja" as const,
    });

    expect(config.mcpServers["sigma-studio-local"].env.SIGMA_STUDIO_MCP_PROVIDER).toBe("claude");
    expect(config.mcpServers["sigma-studio-local"].env.SIGMA_STUDIO_MCP_TOOL_PROFILE).toBe("app");
  });
});
