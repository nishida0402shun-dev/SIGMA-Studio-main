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
let currentWorkspaceId: string | null = null;

ipcRenderer.on("sigma-web-ai-scope", (_event, workspaceId: unknown) => {
  currentWorkspaceId = typeof workspaceId === "string" && workspaceId.trim() ? workspaceId.trim() : null;
  window.setTimeout(installSigmaContextOverlay, 300);
});

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

function currentWebProvider(): "chatgpt" | "claude" | "antigravity" {
  const host = window.location.hostname;
  if (host === "claude.ai" || host.endsWith(".claude.ai")) return "claude";
  if (host === "gemini.google.com" || host.endsWith(".gemini.google.com")) return "antigravity";
  return "chatgpt";
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
      ...(currentWorkspaceId ? { "X-Sigma-Workspace-Id": currentWorkspaceId } : {}),
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

async function fetchSigmaContext(): Promise<{ workspaceId: string | null; documents: unknown[] }> {
  if (!(await ensureBridgeConfig())) {
    return { workspaceId: currentWorkspaceId, documents: [] };
  }
  try {
    const body = await callApi("/v1/context");
    return {
      workspaceId: typeof body.workspaceId === "string" ? body.workspaceId : currentWorkspaceId,
      documents: Array.isArray(body.documents) ? body.documents : [],
    };
  } catch {
    return { workspaceId: currentWorkspaceId, documents: [] };
  }
}

function installSigmaContextOverlay(): void {
  if (window.top !== window) return;
  const marker = "data-sigma-web-ai-overlay";
  if (document.querySelector(`[${marker}]`)) return;

  const host = document.createElement("div");
  host.setAttribute(marker, "true");
  host.style.position = "fixed";
  host.style.top = "12px";
  host.style.right = "12px";
  host.style.zIndex = "2147483647";
  host.style.pointerEvents = "auto";

  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .card { display:flex; align-items:center; gap:7px; padding:6px 8px; border:1px solid rgba(128,128,128,.28); border-radius:10px; background:rgba(255,255,255,.92); color:#222; box-shadow:0 4px 18px rgba(0,0,0,.12); backdrop-filter:blur(12px); font-size:11px; }
    .dot { width:7px; height:7px; border-radius:50%; background:#888; }
    .dot.ok { background:#2e9b62; }
    .label { font-weight:650; }
    .meta { color:#666; max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    button { border:0; background:transparent; color:inherit; cursor:pointer; padding:2px 4px; border-radius:5px; }
    button:hover { background:rgba(0,0,0,.06); }
  `;
  shadow.appendChild(style);

  const card = document.createElement("div");
  card.className = "card";
  const dot = document.createElement("span");
  dot.className = "dot";
  const label = document.createElement("span");
  label.className = "label";
  label.textContent = "SIGMA";
  const meta = document.createElement("span");
  meta.className = "meta";
  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.textContent = "↻";
  refresh.title = "Refresh SIGMA context";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "Context";
  copy.title = "Copy SIGMA context";

  const render = async () => {
    const context = await fetchSigmaContext();
    dot.classList.toggle("ok", Boolean(context.workspaceId));
    const workspace = context.workspaceId ? `Workspace: ${context.workspaceId}` : "Workspace not selected";
    meta.textContent = `${workspace} · ${context.documents.length} docs`;
    const payload = [
      "SIGMA Studio context",
      `workspaceId: ${context.workspaceId ?? "(none selected)"}`,
      `documents: ${context.documents.length}`,
    ].join("\\n");
    copy.onclick = () => {
      void navigator.clipboard?.writeText(payload);
    };
  };

  refresh.onclick = () => { void render(); };
  card.append(dot, label, meta, refresh, copy);
  shadow.appendChild(card);
  void render();
}

async function waitForModelContext(): Promise<WebMcpModelContext | null> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const modelContext = (document as WebMcpDocument).modelContext;
    if (modelContext?.registerTool) return modelContext;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
  }
  return null;
}

function reportWebAiStatus(webMcp: boolean, bridge: boolean): void {
  try { ipcRenderer.sendToHost("sigma-web-ai-status", { webMcp, bridge, workspaceId: currentWorkspaceId }); } catch { /* webview host may be unavailable during teardown */ }
}

async function registerSigmaWebAiTools(): Promise<void> {
  if (!ORIGIN_ALLOWLIST.has(window.location.origin)) return;
  if (!(await ensureBridgeConfig())) {
    reportWebAiStatus(false, false);
    return;
  }
  const modelContext = await waitForModelContext();
  if (!modelContext) {
    reportWebAiStatus(false, true);
    return;
  }
  reportWebAiStatus(true, true);

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
    name: "sigma_mcp_list_tools",
    description: "List the MCP tools exposed by Sigma Studio for the selected Workspace. Knowledge DB classification review submission is a controlled write operation; other exposed tools are read-only.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute: async () => callApi("/v1/mcp/tools"),
  }, { signal: controller.signal });

  await modelContext.registerTool({
    name: "sigma_mcp_call_tool",
    description: "Call an allowlisted SIGMA MCP tool returned by sigma_mcp_list_tools. Most tools are read-only; Knowledge DB classification review submission is the only controlled classification write operation.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" }, arguments: { type: "object" } },
      required: ["name"],
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input) => callApi("/v1/mcp/call", {
      method: "POST",
      body: JSON.stringify({
        name: String(input.name),
        arguments: asRecord(input.arguments),
      }),
    }),
  }, { signal: controller.signal });

  await modelContext.registerTool({
    name: "sigma_knowledge_search",
    description: "Search SIGMA's global Knowledge DB. Use this when the user asks about documents stored in SIGMA, even when no Workspace is selected. Returns source/page references.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
      },
      required: ["query"],
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input) => callApi("/v1/mcp/call", {
      method: "POST",
      body: JSON.stringify({
        name: "knowledge_db_search",
        arguments: {
          query: String(input.query),
          ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
        },
      }),
    }),
  }, { signal: controller.signal });

  await modelContext.registerTool({
    name: "sigma_knowledge_context",
    description: "Build a citation-aware Context Pack from SIGMA's global Knowledge DB for the current question. Prefer this before answering questions grounded in SIGMA documents.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
      },
      required: ["query"],
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input) => callApi("/v1/mcp/call", {
      method: "POST",
      body: JSON.stringify({
        name: "knowledge_db_get_context",
        arguments: {
          query: String(input.query),
          ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
        },
      }),
    }),
  }, { signal: controller.signal });

  await modelContext.registerTool({
    name: "sigma_knowledge_page",
    description: "Read one exact page from SIGMA's global Knowledge DB using a sourceId and 1-based pageNumber. Preserve the returned SIGMA citation marker in grounded answers.",
    inputSchema: {
      type: "object",
      properties: {
        sourceId: { type: "string" },
        pageNumber: { type: "number" },
      },
      required: ["sourceId", "pageNumber"],
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input) => callApi("/v1/mcp/call", {
      method: "POST",
      body: JSON.stringify({
        name: "knowledge_db_get_page",
        arguments: {
          sourceId: String(input.sourceId),
          pageNumber: Number(input.pageNumber),
        },
      }),
    }),
  }, { signal: controller.signal });

  await modelContext.registerTool({
    name: "sigma_knowledge_related",
    description: "Find documents related to a SIGMA Knowledge DB source. Use this to discover comparison candidates across the global library.",
    inputSchema: {
      type: "object",
      properties: {
        sourceId: { type: "string" },
        limit: { type: "number" },
      },
      required: ["sourceId"],
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input) => callApi("/v1/mcp/call", {
      method: "POST",
      body: JSON.stringify({
        name: "knowledge_db_get_related_sources",
        arguments: {
          sourceId: String(input.sourceId),
          ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
        },
      }),
    }),
  }, { signal: controller.signal });

  await modelContext.registerTool({
    name: "sigma_knowledge_classification_reviews",
    description: "List pages in SIGMA's global Knowledge DB that need AI classification double-checking. Process pending and needs-review items from this queue using the review context tool.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["pending", "needs-review", "all"] },
        limit: { type: "number" },
      },
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input) => callApi("/v1/mcp/call", {
      method: "POST",
      body: JSON.stringify({
        name: "knowledge_db_list_classification_reviews",
        arguments: {
          ...(typeof input.status === "string" ? { status: input.status } : {}),
          ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
        },
      }),
    }),
  }, { signal: controller.signal });

  await modelContext.registerTool({
    name: "sigma_knowledge_classification_review_context",
    description: "Get the content-only context for one Knowledge DB classification review. Filenames, extensions, and storage locations are deliberately excluded. Reclassify from body/OCR/tables/figures/formulas only.",
    inputSchema: {
      type: "object",
      properties: {
        sourceId: { type: "string" },
        pageNumber: { type: "number" },
      },
      required: ["sourceId", "pageNumber"],
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input) => callApi("/v1/mcp/call", {
      method: "POST",
      body: JSON.stringify({
        name: "knowledge_db_get_classification_review_context",
        arguments: {
          sourceId: String(input.sourceId),
          pageNumber: Number(input.pageNumber),
        },
      }),
    }),
  }, { signal: controller.signal });

  await modelContext.registerTool({
    name: "sigma_knowledge_submit_classification_review",
    description: "Submit an AI classification double-check. Provide one or more full subject-to-course-to-unit paths, confidence, and concise evidence. Matching SIGMA classification is confirmed; disagreement is recorded as needs-review without changing SIGMA's original taxonomy.",
    inputSchema: {
      type: "object",
      properties: {
        sourceId: { type: "string" },
        pageNumber: { type: "number" },
        paths: { type: "array", items: { type: "array", items: { type: "string" } } },
        confidence: { type: "number" },
        reason: { type: "string" },
        evidence: { type: "array", items: { type: "string" } },
      },
      required: ["sourceId", "pageNumber", "paths", "confidence"],
    },
    annotations: { readOnlyHint: false, consequentialHint: false, untrustedContentHint: true },
    execute: async (input) => callApi("/v1/mcp/call", {
      method: "POST",
      body: JSON.stringify({
        name: "knowledge_db_submit_classification_review",
        arguments: {
          sourceId: String(input.sourceId),
          pageNumber: Number(input.pageNumber),
          paths: Array.isArray(input.paths) ? input.paths : [],
          confidence: Number(input.confidence),
          ...(typeof input.reason === "string" ? { reason: input.reason } : {}),
          ...(Array.isArray(input.evidence) ? { evidence: input.evidence } : {}),
        },
      }),
    }),
  }, { signal: controller.signal });

  await modelContext.registerTool({
    name: "sigma_run_agent",
    description: "Run Codex, Claude, or Gemini through Sigma Studio's Agent Runtime. The agent can create normal Sigma edit proposals; it cannot execute arbitrary shell commands through this tool.",
    inputSchema: {
      type: "object",
      properties: {
        fileId: { type: "string" },
        instruction: { type: "string" },
        model: { type: "string" },
        reasoningEffort: { type: "string" },
      },
      required: ["fileId", "instruction"],
    },
    annotations: { readOnlyHint: false, consequentialHint: false, untrustedContentHint: true },
    execute: async (input, context) => {
      const payload = { ...asRecord(input), provider: currentWebProvider() };
      const created = await callApi("/v1/agent/runs", { method: "POST", body: JSON.stringify(payload) });
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


}

void registerSigmaWebAiTools().catch((error) => {
  reportWebAiStatus(false, Boolean(bridgeUrl && bridgeToken));
  console.warn("[sigma-web-ai] WebMCP tool registration failed", error);
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => installSigmaContextOverlay(), { once: true });
} else {
  installSigmaContextOverlay();
}
