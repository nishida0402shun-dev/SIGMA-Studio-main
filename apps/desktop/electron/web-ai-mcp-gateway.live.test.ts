import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWebAiMcpGateway } from "./web-ai-mcp-gateway";

describe("Web AI MCP gateway live server path", () => {
  let userDataPath: string;
  let serverProcess: ChildProcess | null = null;
  let gateway: ReturnType<typeof createWebAiMcpGateway>;
  const mcpServerPath = path.join(process.cwd(), "dist-mcp", "sigma-doc-mcp-server.cjs");

  beforeAll(async () => {
    userDataPath = await mkdtemp(path.join(os.tmpdir(), "sigma-web-ai-mcp-"));
    serverProcess = spawn(process.execPath, [path.join(process.cwd(), "scripts", "run-sigma-doc-mcp.mjs")], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        SIGMA_STUDIO_USER_DATA_DIR: userDataPath,
        MCP_TOOL_PROFILE: "external",
      },
      stdio: "ignore",
    });

    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      try {
        await stat(mcpServerPath);
        break;
      } catch {
        if (serverProcess.exitCode !== null) {
          throw new Error(`MCP server build process exited with code ${serverProcess.exitCode}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    await stat(mcpServerPath);

    gateway = createWebAiMcpGateway({ mcpServerPath, userDataPath });
  }, 90_000);

  afterAll(async () => {
    await gateway?.stop();
    if (serverProcess && serverProcess.exitCode === null) {
      serverProcess.kill("SIGTERM");
    }
    await rm(userDataPath, { recursive: true, force: true });
  });

  it("connects to the real MCP server and receives its read-only tool contract", async () => {
    const tools = await gateway.listTools("workspace_live_test");
    const names = new Set(tools.map((tool) => tool.name));

    expect(names.has("list_local_documents")).toBe(true);
    expect(names.has("read_local_document")).toBe(true);
    expect(names.has("create_local_document")).toBe(false);
    expect(names.size).toBeGreaterThan(5);
  });

  it("rejects an unselected or foreign workspace before MCP dispatch", async () => {
    await expect(gateway.listTools(null)).resolves.toEqual([]);
    await expect(gateway.callTool("list_local_documents", {}, null)).rejects.toThrow(/Workspace/);
    await expect(
      gateway.callTool("list_local_documents", { workspaceId: "workspace_foreign" }, "workspace_selected"),
    ).rejects.toThrow(/selected Workspace/);
  });
});
