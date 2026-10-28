import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildSigmaCoreMcpEnv,
  buildSigmaCoreMcpStdioServer,
  buildSigmaStudioMcpEnv,
  siblingCoreMcpScriptPath,
  type SigmaStudioMcpLaunchSpec,
} from "./sigma-studio-mcp-launch";

function launchSpec(overrides: Partial<SigmaStudioMcpLaunchSpec> = {}): SigmaStudioMcpLaunchSpec {
  const userDataDir = path.join(path.sep, "tmp", "sigma-studio-user-data");
  return {
    uiLocale: "ja",
    execPath: path.join(path.sep, "opt", "sigma-studio", "SIGMA Studio"),
    scriptPath: path.join(path.sep, "opt", "sigma-studio", "resources", "sigma-doc-mcp-server.cjs"),
    userDataDir,
    runContextFile: path.join(userDataDir, "run-context.json"),
    renderBridgeFile: path.join(userDataDir, "render-bridge.json"),
    provider: "codex",
    ...overrides,
  };
}

describe("SIGMA Core MCP launch contract", () => {
  it("does not add the Core server when its bundled entrypoint is absent", () => {
    const input = launchSpec();

    expect(buildSigmaCoreMcpEnv(input)).toBeNull();
    expect(buildSigmaCoreMcpStdioServer(input)).toBeNull();
  });

  it("uses the same default Core data directory as SourceMaterialService", () => {
    const input = launchSpec({
      coreScriptPath: path.join(path.dirname(launchSpec().scriptPath), "sigma-core-mcp-server.cjs"),
    });
    const dataDir = path.join(input.userDataDir, "data", "sigma-core");

    expect(buildSigmaCoreMcpEnv(input)).toEqual({
      ELECTRON_RUN_AS_NODE: "1",
      SIGMA_CORE_DB_PATH: path.join(dataDir, "core.sqlite"),
      SIGMA_CORE_BLOB_DIR: path.join(dataDir, "blobs"),
      SIGMA_CORE_SUBJECT_ID: "studio-ai",
    });
    expect(buildSigmaCoreMcpStdioServer(input)).toEqual({
      type: "stdio",
      command: input.execPath,
      args: [input.coreScriptPath],
      env: buildSigmaCoreMcpEnv(input),
    });
  });

  it("honors an explicit Core data directory without changing the AI subject", () => {
    const input = launchSpec({
      coreScriptPath: path.join(path.sep, "custom", "sigma-core-mcp-server.cjs"),
      coreDataDir: path.join(path.sep, "tmp", "sigma-core-isolated"),
    });

    expect(buildSigmaCoreMcpEnv(input)).toMatchObject({
      SIGMA_CORE_DB_PATH: path.join(input.coreDataDir!, "core.sqlite"),
      SIGMA_CORE_BLOB_DIR: path.join(input.coreDataDir!, "blobs"),
      SIGMA_CORE_SUBJECT_ID: "studio-ai",
    });
  });

  it("keeps the document MCP and Core MCP data paths separate by contract", () => {
    const input = launchSpec({
      coreScriptPath: path.join(path.sep, "bundle", "sigma-core-mcp-server.cjs"),
    });
    const studioEnv = buildSigmaStudioMcpEnv(input);
    const coreEnv = buildSigmaCoreMcpEnv(input);

    expect(studioEnv.SIGMA_STUDIO_USER_DATA_DIR).toBe(input.userDataDir);
    expect(studioEnv).not.toHaveProperty("SIGMA_CORE_DB_PATH");
    expect(coreEnv?.SIGMA_CORE_DB_PATH).toBe(
      path.join(input.userDataDir, "data", "sigma-core", "core.sqlite"),
    );
  });

  it("derives the bundled Core server as a sibling of the document MCP server", () => {
    const docScript = path.join(path.sep, "bundle", "sigma-doc-mcp-server.cjs");

    expect(siblingCoreMcpScriptPath(docScript)).toBe(
      path.join(path.dirname(docScript), "sigma-core-mcp-server.cjs"),
    );
  });
});
