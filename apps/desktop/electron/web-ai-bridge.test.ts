import { describe, expect, it } from "vitest";

import { createWebAiBridgeServer, type WebAiBridgeDeps } from "./web-ai-bridge";

function createDeps(overrides: Partial<WebAiBridgeDeps> = {}): WebAiBridgeDeps {
  return {
    token: "test-token",
    allowedOrigins: ["https://chatgpt.com"],
    aiEditController: {
      run: async (_runId, _payload, onEvent) => {
        onEvent({ kind: "phase", phase: "preparing", message: "test" } as never);
        return {} as never;
      },
      cancel: () => ({ ok: true, cancelled: true }),
    },
    loadDocument: async () => ({}) as never,
    listFiles: async () => [{ fileId: "file_test" }],
    listProposals: async () => [{ proposalId: "proposal_test" }],
    approveProposal: async (proposalId) => ({ ok: true, proposalId }),
    ...overrides,
  };
}

async function withServer(deps: WebAiBridgeDeps, fn: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = createWebAiBridgeServer(deps);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server address unavailable");
  try {
    await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("Web AI bridge", () => {
  it("requires the bearer token", async () => {
    await withServer(createDeps(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/health`);
      expect(response.status).toBe(401);
    });
  });

  it("serves health only to an allowed origin", async () => {
    await withServer(createDeps(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/health`, {
        headers: {
          Authorization: "Bearer test-token",
          Origin: "https://chatgpt.com",
        },
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        providers: ["chatgpt", "claude", "antigravity"],
      });
    });
  });

  it("rejects an unapproved origin", async () => {
    await withServer(createDeps(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/health`, {
        headers: {
          Authorization: "Bearer test-token",
          Origin: "https://example.com",
        },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    });
  });

  it("loads a document before starting an agent run", async () => {
    let receivedPayload: unknown = null;
    await withServer(createDeps({
      aiEditController: {
        run: async (_runId, payload) => {
          receivedPayload = payload;
          return {} as never;
        },
        cancel: () => ({ ok: true, cancelled: false }),
      },
    }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/runs`, {
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: "chatgpt",
          instruction: "Add a title",
          fileId: "file_test",
        }),
      });
      expect(response.status).toBe(200);
      expect(receivedPayload).toMatchObject({
        provider: "chatgpt",
        instruction: "Add a title",
        fileId: "file_test",
        document: {},
      });
    });
  });

  it("exposes proposals and routes approval", async () => {
    let approvedId = "";
    await withServer(createDeps({
      approveProposal: async (proposalId) => {
        approvedId = proposalId;
        return { ok: true };
      },
    }), async (baseUrl) => {
      const proposals = await fetch(`${baseUrl}/v1/proposals?fileId=file_test`, {
        headers: { Authorization: "Bearer test-token" },
      });
      expect(proposals.status).toBe(200);

      const approval = await fetch(`${baseUrl}/v1/proposals/proposal_test/approve`, {
        method: "POST",
        headers: { Authorization: "Bearer test-token" },
      });
      expect(approval.status).toBe(200);
      expect(approvedId).toBe("proposal_test");
    });
  });
});
