import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWebAiMcpGateway } from "./web-ai-mcp-gateway";
import { createWebAiBridgeServer } from "./web-ai-bridge";

describe("Web AI MCP gateway live server path", () => {
  let userDataPath: string;
  let serverProcess: ChildProcess | null = null;
  let gateway: ReturnType<typeof createWebAiMcpGateway>;
  let bridge: import("node:http").Server | null = null;
  let bridgeBase = "";
  const requestedWrites: string[] = [];
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

    gateway = createWebAiMcpGateway({
      mcpServerPath,
      userDataPath,
      requestPermission: async ({ toolName }) => {
        requestedWrites.push(toolName);
        return true;
      },
    });
  }, 90_000);

  afterAll(async () => {
    if (bridge) {
      await new Promise<void>((resolve, reject) => bridge!.close((error) => error ? reject(error) : resolve()));
      bridge = null;
    }
    await gateway?.stop();
    if (serverProcess && serverProcess.exitCode === null) {
      serverProcess.kill("SIGTERM");
    }
    await rm(userDataPath, { recursive: true, force: true });
  });

  it("connects to the real MCP server and exposes read and writable tool contracts", async () => {
    const tools = await gateway.listTools("workspace_live_test");
    const names = new Set(tools.map((tool) => tool.name));

    expect(names.has("list_local_documents")).toBe(true);
    expect(names.has("read_local_document")).toBe(true);
    expect(names.has("knowledge_db_search")).toBe(true);
    expect(names.has("knowledge_db_get_context")).toBe(true);
    expect(names.has("knowledge_db_list_classification_reviews")).toBe(true);
    expect(names.has("knowledge_db_get_classification_review_context")).toBe(true);
    expect(names.has("knowledge_db_submit_classification_review")).toBe(true);
    expect(names.has("knowledge_db_pdf_import_preview")).toBe(true);
    expect(names.has("knowledge_db_pdf_import_staging_list")).toBe(true);
    expect(names.has("knowledge_db_pdf_import_staging_get")).toBe(true);
    expect(names.has("knowledge_db_pdf_import_staging_update")).toBe(true);
    expect(names.has("knowledge_db_pdf_import_approve")).toBe(true);
    expect(names.has("knowledge_db_pdf_import_reject")).toBe(true);
    const reviewTool = tools.find((tool) => tool.name === "knowledge_db_submit_classification_review");
    expect(reviewTool?.annotations?.readOnlyHint).toBe(false);
    expect(reviewTool?.annotations?.destructiveHint).toBe(false);
    expect(names.has("create_local_document")).toBe(true);
    expect(names.size).toBeGreaterThan(5);

    const globalTools = await gateway.listTools(null);
    const globalNames = new Set(globalTools.map((tool) => tool.name));
    expect(globalNames.has("knowledge_db_search")).toBe(true);
    expect(globalNames.has("knowledge_db_get_context")).toBe(true);
    expect(globalNames.has("knowledge_db_list_classification_reviews")).toBe(true);
    expect(globalNames.has("knowledge_db_get_classification_review_context")).toBe(true);
    expect(globalNames.has("knowledge_db_submit_classification_review")).toBe(true);
    expect(globalNames.has("knowledge_db_pdf_import_preview")).toBe(true);
    expect(globalNames.has("knowledge_db_pdf_import_staging_list")).toBe(true);
    expect(globalNames.has("knowledge_db_pdf_import_staging_get")).toBe(true);
    expect(globalNames.has("list_local_documents")).toBe(false);
  });

  it("allows the classification review workflow without a selected Workspace", async () => {
    await expect(
      gateway.callTool("knowledge_db_list_classification_reviews", { status: "pending", limit: 1 }, null),
    ).resolves.toBeTruthy();
    await expect(
      gateway.callTool("knowledge_db_get_classification_review_context", { sourceId: "missing", pageNumber: 1 }, null),
    ).resolves.toMatchObject({ isError: true });
  });

  it("routes a real HTTP Bridge request into the real MCP server", async () => {
    bridge = createWebAiBridgeServer({
      token: "live-test-token",
      getDocument: async () => null,
      listDocuments: async () => [],
      listProposals: async () => [],
      getProposal: async () => null,
      approveProposal: async () => null,
      rejectProposal: async () => null,
      startRun: async () => ({ status: "answer" }),
      cancelRun: () => false,
      mcpGateway: gateway,
    });
    await new Promise<void>((resolve, reject) => {
      bridge!.once("error", reject);
      bridge!.listen(0, "127.0.0.1", resolve);
    });
    const address = bridge.address();
    if (!address || typeof address === "string") throw new Error("bridge did not bind");
    bridgeBase = `http://127.0.0.1:${address.port}`;

    const healthResponse = await fetch(`${bridgeBase}/v1/health`, {
      headers: {
        Authorization: "Bearer live-test-token",
        Origin: "https://chatgpt.com",
      },
    });
    expect(healthResponse.status).toBe(200);
    await expect(healthResponse.json()).resolves.toMatchObject({ ok: true, apiVersion: "1" });

    const unauthorizedHealthResponse = await fetch(`${bridgeBase}/v1/health`, {
      headers: {
        Authorization: "Bearer wrong-token",
        Origin: "https://chatgpt.com",
      },
    });
    expect(unauthorizedHealthResponse.status).toBe(401);

    const toolsResponse = await fetch(`${bridgeBase}/v1/mcp/tools`, {
      headers: {
        Authorization: "Bearer live-test-token",
        Origin: "https://chatgpt.com",
      },
    });
    expect(toolsResponse.status).toBe(200);
    const toolsBody = await toolsResponse.json();
    expect(toolsBody.ok).toBe(true);
    expect(toolsBody.tools.some((tool: { name?: string }) => tool.name === "knowledge_db_search")).toBe(true);

    const callResponse = await fetch(`${bridgeBase}/v1/mcp/call`, {
      method: "POST",
      headers: {
        Authorization: "Bearer live-test-token",
        Origin: "https://chatgpt.com",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "knowledge_db_search",
        arguments: { query: "SIGMA live bridge connectivity", limit: 1 },
      }),
    });
    expect(callResponse.status).toBe(200);
    const callBody = await callResponse.json();
    expect(callBody.ok).toBe(true);
    expect(callBody.result).toBeTruthy();
  });

  it("requires approval for a writable global Knowledge DB operation", async () => {
    await expect(
      gateway.callTool(
        "knowledge_db_submit_classification_review",
        { sourceId: "missing", pageNumber: 1, paths: ["その他"], confidence: 0.5 },
        null,
      ),
    ).resolves.toMatchObject({ isError: true });
    expect(requestedWrites).toContain("knowledge_db_submit_classification_review");
  });

  it("exposes PDF staging through the global Web AI scope", async () => {
    await expect(
      gateway.callTool("knowledge_db_pdf_import_staging_list", {}, null),
    ).resolves.toBeTruthy();
    await expect(
      gateway.callTool("knowledge_db_pdf_import_staging_get", { stagingId: "missing-staging" }, null),
    ).resolves.toBeTruthy();
  });

  it("requires approval for PDF import preview and approval", async () => {
    await expect(
      gateway.callTool(
        "knowledge_db_pdf_import_preview",
        { sourcePath: path.join(userDataPath, "missing.pdf") },
        null,
      ),
    ).resolves.toMatchObject({ isError: true });
    expect(requestedWrites).toContain("knowledge_db_pdf_import_preview");

    await expect(
      gateway.callTool(
        "knowledge_db_pdf_import_approve",
        { stagingId: "missing-staging" },
        null,
      ),
    ).resolves.toMatchObject({ isError: true });
    expect(requestedWrites).toContain("knowledge_db_pdf_import_approve");
  });

  it("allows global Knowledge DB tools without a selected Workspace", async () => {
    await expect(gateway.callTool("knowledge_db_search", { query: "test", limit: 1 }, null)).resolves.toBeTruthy();
    await expect(gateway.callTool("list_local_documents", {}, null)).rejects.toThrow(/Workspace/);
    await expect(
      gateway.callTool("list_local_documents", { workspaceId: "workspace_foreign" }, "workspace_selected"),
    ).rejects.toThrow(/selected Workspace/);
  });
});
