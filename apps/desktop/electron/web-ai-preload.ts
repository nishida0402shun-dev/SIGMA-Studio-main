import { ipcRenderer } from "electron";

interface WebMcpModelContext {
  registerTool(
    tool: {
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
      annotations?: Record<string, unknown>;
      execute: (input: Record<string, unknown>, context?: { signal?: AbortSignal }) => Promise<unknown> | unknown;
    },
    options?: { signal?: AbortSignal },
  ): Promise<void>;
}

interface WebMcpDocument extends Document {
  modelContext?: WebMcpModelContext;
}

const ORIGIN_ALLOWLIST = new Set([
  "https://chatgpt.com",
  "https://chat.openai.com",
  "https://claude.ai",
  "https://gemini.google.com",
]);

function arg(name: string): string {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? "";
}

let bridgeUrl = arg("sigma-web-ai-url");
let bridgeToken = arg("sigma-web-ai-token");

async function ensureBridgeConfig(): Promise<boolean> {
  if (bridgeUrl && bridgeToken) return true;
  try {
    const info = await ipcRenderer.invoke("web-ai:get-bridge-info") as { url?: unknown; token?: unknown };
    if (typeof info?.url !== "string" || typeof info?.token !== "string" || !info.url || !info.token) {
      return false;
    }
    bridgeUrl = info.url;
    bridgeToken = info.token;
    return true;
  } catch {
    return false;
  }
}

function apiUrl(path: string): string {
  return `${bridgeUrl}${path}`;
}

interface WebAiApiResponse {
  ok?: boolean;
  error?: unknown;
  runId?: string;
  run?: { status?: string };
  [key: string]: unknown;
}

async function callApi(path: string, init: RequestInit = {}): Promise<WebAiApiResponse> {
  const response = await fetch(apiUrl(path), {
    ...init,
    headers: {
      Authorization: `Bearer ${bridgeToken}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Web AI API returned an invalid response");
  }

  if (!response.ok) {
    throw new Error(typeof body?.error === "string" ? body.error : `Web AI API error: ${response.status}`);
  }
  return body;
}

async function waitForRun(runId: string, signal?: AbortSignal): Promise<unknown> {
  while (!signal?.aborted) {
    const body = await callApi(`/v1/agent/runs/${encodeURIComponent(runId)}`);
    if (body.run?.status !== "running") {
      return body;
    }
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(resolve, 750);
      signal?.addEventListener("abort", () => {
        window.clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      }, { once: true });
    });
  }
  await callApi(`/v1/agent/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST", body: "{}" }).catch(() => undefined);
  throw new DOMException("Aborted", "AbortError");
}

function asRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("tool input must be an object");
  return input as Record<string, unknown>;
}

async function waitForModelContext(): Promise<WebMcpModelContext | null> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const modelContext = (document as WebMcpDocument).modelContext;
    if (modelContext?.registerTool) return modelContext;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
  }
  return null;
}

async function registerSigmaWebAiTools(): Promise<void> {
  if (!ORIGIN_ALLOWLIST.has(window.location.origin)) return;
  if (!(await ensureBridgeConfig())) return;

  const modelContext = await waitForModelContext();
  if (!modelContext) return;

  const controller = new AbortController();

  await modelContext.registerTool({
    name: "sigma_list_documents",
    description: "List Sigma Studio documents that the user can edit. Use this before selecting a fileId.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute: async () => callApi("/v1/documents"),
  }, { signal: controller.signal });

  await modelContext.registerTool({
    name: "sigma_get_document",
    description: "Read one Sigma Studio SigmaDoc document and its current optimistic-lock revision.",
    inputSchema: {
      type: "object",
      properties: { fileId: { type: "string" } },
      required: ["fileId"],
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async ({ fileId }) => callApi(`/v1/documents/${encodeURIComponent(String(fileId))}`),
  }, { signal: controller.signal });

  await modelContext.registerTool({
    name: "sigma_list_proposals",
    description: "List pending AI edit proposals for a Sigma Studio document.",
    inputSchema: {
      type: "object",
      properties: { fileId: { type: "string" } },
      required: ["fileId"],
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async ({ fileId }) => callApi(`/v1/proposals?fileId=${encodeURIComponent(String(fileId))}`),
  }, { signal: controller.signal });

  await modelContext.registerTool({
    name: "sigma_run_agent",
    description: "Run Codex, Claude, or Gemini through Sigma Studio's Agent Runtime. The agent can create normal Sigma edit proposals; it cannot execute arbitrary shell commands through this tool.",
    inputSchema: {
      type: "object",
      properties: {
        provider: { type: "string", enum: ["chatgpt", "claude", "antigravity"] },
        fileId: { type: "string" },
        instruction: { type: "string" },
        model: { type: "string" },
        reasoningEffort: { type: "string" },
      },
      required: ["provider", "fileId", "instruction"],
    },
    annotations: { readOnlyHint: false, consequentialHint: false, untrustedContentHint: true },
    execute: async (input, context) => {
      const created = await callApi("/v1/agent/runs", { method: "POST", body: JSON.stringify(asRecord(input)) });
      return waitForRun(String(created.runId), context?.signal);
    },
  }, { signal: controller.signal });

  await modelContext.registerTool({
    name: "sigma_cancel_run",
    description: "Cancel a running Sigma Studio Agent Runtime run.",
    inputSchema: {
      type: "object",
      properties: { runId: { type: "string" } },
      required: ["runId"],
    },
    annotations: { readOnlyHint: false, consequentialHint: false },
    execute: async ({ runId }) => callApi(`/v1/agent/runs/${encodeURIComponent(String(runId))}/cancel`, { method: "POST", body: "{}" }),
  }, { signal: controller.signal });

  await modelContext.registerTool({
    name: "sigma_approve_proposal",
    description: "Approve one pending Sigma Studio AI edit proposal. This changes the document and is subject to Sigma Studio revision/conflict validation.",
    inputSchema: {
      type: "object",
      properties: { proposalId: { type: "string" } },
      required: ["proposalId"],
    },
    annotations: { readOnlyHint: false, consequentialHint: true, untrustedContentHint: true },
    execute: async ({ proposalId }) => callApi(`/v1/proposals/${encodeURIComponent(String(proposalId))}/approve`, { method: "POST", body: "{}" }),
  }, { signal: controller.signal });

  await modelContext.registerTool({
    name: "sigma_reject_proposal",
    description: "Reject one pending Sigma Studio AI edit proposal.",
    inputSchema: {
      type: "object",
      properties: { proposalId: { type: "string" } },
      required: ["proposalId"],
    },
    annotations: { readOnlyHint: false, consequentialHint: true, untrustedContentHint: true },
    execute: async ({ proposalId }) => callApi(`/v1/proposals/${encodeURIComponent(String(proposalId))}/reject`, { method: "POST", body: "{}" }),
  }, { signal: controller.signal });
}

void registerSigmaWebAiTools().catch((error) => {
  console.warn("[sigma-web-ai] WebMCP tool registration failed", error);
});
