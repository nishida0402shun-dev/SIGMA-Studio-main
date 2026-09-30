import type http from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { createWebAiBridgeServer } from "./web-ai-bridge";

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
      approveProposal: async () => null,
      rejectProposal: async () => null,
      startRun: async () => ({ status: "answer" }),
      cancelRun: () => false,
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

  it("starts runs and exposes completion state", async () => {
    const server = createWebAiBridgeServer({
      token: "test-token",
      getDocument: async (fileId) => ({
        fileId,
        revision: 7,
        document: { docId: "doc_test" } as never,
      }),
      listDocuments: async () => [{ fileId: "file_test", revision: 7 }],
      listProposals: async () => [{ proposalId: "proposal_test", status: "pending" }],
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
    });
    servers.push(server);
    const base = await listen(server);

    const created = await fetch(`${base}/v1/agent/runs`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
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
        headers: { Authorization: "Bearer test-token" },
      });
      status = await response.json();
      if (status.run.status !== "running") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(status?.run.status).toBe("completed");
    expect(status?.run.result?.status).toBe("answer");
    expect(status?.events).toHaveLength(1);

    const documents = await fetch(`${base}/v1/documents`, {
      headers: { Authorization: "Bearer test-token" },
    });
    expect((await documents.json()).documents).toEqual([{ fileId: "file_test", revision: 7 }]);
  });
});
