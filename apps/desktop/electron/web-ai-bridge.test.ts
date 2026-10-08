import type http from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { createWebAiBridgeServer } from "./web-ai-bridge";
import type { WebAiMcpGateway } from "./web-ai-mcp-gateway";

const mcpGateway: WebAiMcpGateway = {
  start: async () => undefined,
  stop: async () => undefined,
  listTools: async () => [],
  callTool: async () => ({ content: [] }),
};

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

describe("Web AI bridge", () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(close));
  });

  it("requires bearer auth and allowlisted origins", async () => {
    const server = createWebAiBridgeServer({
      token: "test-token",
      getDocument: async () => null,
      listDocuments: async () => [],
      listProposals: async () => [],
      getProposal: async () => null,
      approveProposal: async () => null,
      rejectProposal: async () => null,
      startRun: async () => ({ status: "answer" }),
      cancelRun: () => false,
      mcpGateway,
    });
    servers.push(server);
    const base = await listen(server);

    const unauthorized = await fetch(`${base}/v1/health`);
    expect(unauthorized.status).toBe(401);

    const forbidden = await fetch(`${base}/v1/health`, {
      headers: { Authorization: "Bearer test-token", Origin: "https://evil.example" },
    });
    expect(forbidden.status).toBe(403);

    const ok = await fetch(`${base}/v1/health`, {
      headers: { Authorization: "Bearer test-token", Origin: "https://chatgpt.com" },
    });
    expect(ok.status).toBe(200);
    expect((await ok.json()).ok).toBe(true);
  });

  it("accepts Google AI Studio and workspace-scoped preflight requests", async () => {
    const calls: Array<{ name: string; workspaceId: string | null }> = [];
    const server = createWebAiBridgeServer({
      token: "test-token",
      getDocument: async () => null,
      listDocuments: async () => [],
      listProposals: async () => [],
      getProposal: async () => null,
      approveProposal: async () => null,
      rejectProposal: async () => null,
      startRun: async () => ({ ok: true }),
      cancelRun: () => false,
      mcpGateway: {
        ...mcpGateway,
        listTools: async () => [],
        callTool: async (name, _args, workspaceId) => {
          calls.push({ name, workspaceId: workspaceId ?? null });
          return { content: [{ type: "text", text: "ok" }] };
        },
      },
    });
    servers.push(server);
    const base = await listen(server);

    const preflight = await fetch(`${base}/v1/mcp/call`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://aistudio.google.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization, content-type, x-sigma-workspace-id",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("https://aistudio.google.com");
    expect(preflight.headers.get("access-control-allow-headers")).toContain("X-Sigma-Workspace-Id");

    const globalCall = await fetch(`${base}/v1/mcp/call`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        Origin: "https://aistudio.google.com",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "knowledge_db_pdf_import_staging_list",
        arguments: {},
      }),
    });
    expect(globalCall.status).toBe(200);
    expect(calls).toEqual([{ name: "knowledge_db_pdf_import_staging_list", workspaceId: null }]);

    const skillsCall = await fetch(`${base}/v1/mcp/call`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        Origin: "https://chatgpt.com",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "list_ai_resources",
        arguments: { kind: "skill" },
      }),
    });
    expect(skillsCall.status).toBe(200);
    expect(calls.at(-1)).toEqual({ name: "list_ai_resources", workspaceId: null });
  });

  it("allows all supported Web AI origins to call the canonical global RAG tool", async () => {
    const origins = ["https://chatgpt.com", "https://claude.ai", "https://gemini.google.com", "https://aistudio.google.com"];
    const calls: string[] = [];
    const server = createWebAiBridgeServer({
      token: "test-token",
      getDocument: async () => null,
      listDocuments: async () => [],
      listProposals: async () => [],
      getProposal: async () => null,
      approveProposal: async () => null,
      rejectProposal: async () => null,
      startRun: async () => ({ ok: true }),
      cancelRun: () => false,
      mcpGateway: {
        ...mcpGateway,
        listTools: async () => [],
        callTool: async (name) => {
          calls.push(name);
          return { content: [{ type: "text", text: JSON.stringify({ ok: true, shouldSearch: true, context: [], citations: [] }) }] };
        },
      },
    });
    servers.push(server);
    const base = await listen(server);

    for (const origin of origins) {
      const response = await fetch(`${base}/v1/mcp/call`, {
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
          Origin: origin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "knowledge_db_rag_query",
          arguments: { query: "数学の定義を確認したい" },
        }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe(origin);
    }
    expect(calls).toEqual(["knowledge_db_rag_query", "knowledge_db_rag_query", "knowledge_db_rag_query", "knowledge_db_rag_query"]);
  });

  it("does not expose documents or MCP access without a selected workspace", async () => {
    let mcpCalls = 0;
    const server = createWebAiBridgeServer({
      token: "test-token",
      getDocument: async () => ({
        fileId: "file_test",
        revision: 1,
        workspaceId: "workspace_test",
        document: { docId: "doc_test" } as never,
      }),
      listDocuments: async () => [{ fileId: "file_test", workspaceId: "workspace_test" }],
      listProposals: async () => [{ proposalId: "proposal_test" }],
      getProposal: async () => ({ fileId: "file_test" }),
      approveProposal: async () => ({ ok: true }),
      rejectProposal: async () => ({ ok: true }),
      startRun: async () => ({ ok: true }),
      cancelRun: () => false,
      mcpGateway: {
        ...mcpGateway,
        listTools: async () => { mcpCalls += 1; return []; },
        callTool: async () => { mcpCalls += 1; return { content: [] }; },
      },
    });
    servers.push(server);
    const base = await listen(server);
    const headers = { Authorization: "Bearer test-token" };

    const documents = await fetch(`${base}/v1/documents`, { headers });
    expect(documents.status).toBe(200);
    expect((await documents.json()).documents).toEqual([]);

    const tools = await fetch(`${base}/v1/mcp/tools`, { headers });
    expect(tools.status).toBe(200);
    const call = await fetch(`${base}/v1/mcp/call`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "list_local_documents", arguments: {} }),
    });
    expect(call.status).toBe(409);
    expect(mcpCalls).toBe(1);

    const proposal = await fetch(`${base}/v1/proposals?fileId=file_test`, { headers });
    expect(proposal.status).toBe(409);
  });

  it("isolates agent run status, events, and cancellation by workspace", async () => {
    let cancelCalls = 0;
    const server = createWebAiBridgeServer({
      token: "test-token",
      getDocument: async (fileId) => ({
        fileId,
        revision: 1,
        workspaceId: "workspace_a",
        document: { docId: "doc_test" } as never,
      }),
      listDocuments: async () => [],
      listProposals: async () => [],
      getProposal: async () => null,
      approveProposal: async () => null,
      rejectProposal: async () => null,
      startRun: async () => new Promise(() => undefined),
      cancelRun: () => {
        cancelCalls += 1;
        return true;
      },
      mcpGateway,
    });
    servers.push(server);
    const base = await listen(server);

    const created = await fetch(`${base}/v1/agent/runs`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
        "X-Sigma-Workspace-Id": "workspace_a",
      },
      body: JSON.stringify({
        provider: "chatgpt",
        fileId: "file_test",
        instruction: "test",
      }),
    });
    expect(created.status).toBe(202);
    const { runId } = await created.json() as { runId: string };

    const wrongStatus = await fetch(`${base}/v1/agent/runs/${encodeURIComponent(runId)}`, {
      headers: { Authorization: "Bearer test-token", "X-Sigma-Workspace-Id": "workspace_b" },
    });
    expect(wrongStatus.status).toBe(404);

    const wrongEvents = await fetch(`${base}/v1/agent/runs/${encodeURIComponent(runId)}/events`, {
      headers: { Authorization: "Bearer test-token", "X-Sigma-Workspace-Id": "workspace_b" },
    });
    expect(wrongEvents.status).toBe(404);

    const wrongCancel = await fetch(`${base}/v1/agent/runs/${encodeURIComponent(runId)}/cancel`, {
      method: "POST",
      headers: { Authorization: "Bearer test-token", "X-Sigma-Workspace-Id": "workspace_b" },
    });
    expect(wrongCancel.status).toBe(404);
    expect(cancelCalls).toBe(0);

    const correctCancel = await fetch(`${base}/v1/agent/runs/${encodeURIComponent(runId)}/cancel`, {
      method: "POST",
      headers: { Authorization: "Bearer test-token", "X-Sigma-Workspace-Id": "workspace_a" },
    });
    expect(correctCancel.status).toBe(200);
    expect(cancelCalls).toBe(1);
  });

  it("rejects malformed JSON and oversized request bodies with client errors", async () => {
    const server = createWebAiBridgeServer({
      token: "test-token",
      getDocument: async () => null,
      listDocuments: async () => [],
      listProposals: async () => [],
      getProposal: async () => null,
      approveProposal: async () => null,
      rejectProposal: async () => null,
      startRun: async () => ({ ok: true }),
      cancelRun: () => false,
      mcpGateway,
    });
    servers.push(server);
    const base = await listen(server);
    const headers = {
      Authorization: "Bearer test-token",
      Origin: "https://chatgpt.com",
      "Content-Type": "application/json",
    };

    const malformed = await fetch(`${base}/v1/mcp/call`, {
      method: "POST",
      headers,
      body: "{not-json",
    });
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toMatchObject({ ok: false, error: "invalid JSON request body" });

    const oversized = await fetch(`${base}/v1/mcp/call`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "knowledge_db_search", arguments: { query: "x".repeat(2 * 1024 * 1024) } }),
    });
    expect(oversized.status).toBe(413);
    await expect(oversized.json()).resolves.toMatchObject({ ok: false, error: "request body too large" });
  });

  it("starts runs and exposes completion state", async () => {
    const server = createWebAiBridgeServer({
      token: "test-token",
      getDocument: async (fileId) => ({
        fileId,
        revision: 7,
        workspaceId: "workspace_test",
        document: { docId: "doc_test" } as never,
      }),
      listDocuments: async () => [{ fileId: "file_test", revision: 7, workspaceId: "workspace_test" }],
      listProposals: async () => [{ proposalId: "proposal_test", status: "pending" }],
       getProposal: async (proposalId) => proposalId === "proposal_test" ? { fileId: "file_test" } : null,
      approveProposal: async (proposalId) => ({ ok: true, proposalId }),
      rejectProposal: async (proposalId) => ({ ok: true, proposalId }),
      startRun: async (input, onEvent) => {
        onEvent({
          kind: "phase",
          phase: "complete",
          message: "done",
          timestamp: Date.now(),
        });
        return { status: "answer", changedIds: [input.fileId] };
      },
      cancelRun: () => false,
       mcpGateway,
    });
    servers.push(server);
    const base = await listen(server);

    const created = await fetch(`${base}/v1/agent/runs`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
        "X-Sigma-Workspace-Id": "workspace_test",
      },
      body: JSON.stringify({
        provider: "chatgpt",
        fileId: "file_test",
        instruction: "test",
      }),
    });
    expect(created.status).toBe(202);
    const createdBody = await created.json();
    expect(createdBody.runId).toMatch(/^webai_/);

    let status: { run: { status: string; result?: { status?: string } }; events: unknown[] } | null = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await fetch(`${base}/v1/agent/runs/${encodeURIComponent(createdBody.runId)}`, {
        headers: { Authorization: "Bearer test-token", "X-Sigma-Workspace-Id": "workspace_test" },
      });
      status = await response.json();
      if (status?.run.status !== "running") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(status?.run.status).toBe("completed");
    expect(status?.run.result?.status).toBe("answer");
    expect(status?.events).toHaveLength(1);

    const documents = await fetch(`${base}/v1/documents`, {
      headers: { Authorization: "Bearer test-token", "X-Sigma-Workspace-Id": "workspace_test" },
    });
    expect((await documents.json()).documents).toEqual([{ fileId: "file_test", revision: 7, workspaceId: "workspace_test" }]);
  });
});