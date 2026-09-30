import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { URL } from "node:url";
import { z } from "zod";

import type { SigmaDocument } from "@/features/document";
import type { AiEditRunEvent } from "@/lib/ai/ai-edit-runtime";

const MAX_REQUEST_BODY_BYTES = 2 * 1024 * 1024;
const MAX_INSTRUCTION_LENGTH = 20_000;
const MAX_RUNS = 32;
const RUN_RETENTION_MS = 30 * 60 * 1000;
const BRIDGE_DIR_NAME = "ai-run-context";
const BRIDGE_FILE_NAME = "web-ai-bridge.json";
const API_VERSION = "1";

const WEB_AI_ORIGINS = new Set([
  "https://chatgpt.com",
  "https://chat.openai.com",
  "https://claude.ai",
  "https://gemini.google.com",
]);

export const WebAiProviderSchema = z.enum(["chatgpt", "claude", "antigravity"]);
export type WebAiProvider = z.infer<typeof WebAiProviderSchema>;

const RunRequestSchema = z.object({
  provider: WebAiProviderSchema,
  fileId: z.string().min(1).max(256),
  instruction: z.string().min(1).max(MAX_INSTRUCTION_LENGTH),
  model: z.string().min(1).max(128).optional(),
  reasoningEffort: z.string().min(1).max(32).optional(),
  roomId: z.string().min(1).max(256).optional(),
}).strict();

export type WebAiRunRequest = z.infer<typeof RunRequestSchema>;

export interface WebAiDocumentSnapshot {
  fileId: string;
  revision: number;
  document: SigmaDocument;
}

export interface WebAiRunInput extends WebAiRunRequest {
  runId: string;
  document: SigmaDocument;
  revision: number;
}

export interface WebAiRunState {
  runId: string;
  provider: WebAiProvider;
  fileId: string;
  baseRevision: number;
  status: "running" | "completed" | "cancelled" | "error";
  startedAt: string;
  completedAt?: string;
  error?: string;
  result?: unknown;
}

export interface CreateWebAiBridgeServerDeps {
  token: string;
  getDocument: (fileId: string) => Promise<WebAiDocumentSnapshot | null>;
  listDocuments: () => Promise<unknown[]>;
  listProposals: (fileId: string) => Promise<unknown[]>;
  approveProposal: (proposalId: string) => Promise<unknown>;
  rejectProposal: (proposalId: string) => Promise<unknown>;
  startRun: (input: WebAiRunInput, onEvent: (event: AiEditRunEvent) => void) => Promise<unknown>;
  cancelRun: (runId: string) => boolean;
}

export interface WebAiBridgeInfo {
  version: 1;
  apiVersion: typeof API_VERSION;
  url: string;
  token: string;
  pid: number;
  createdAt: string;
}

export class LocalWebAiBridgeStore {
  private readonly bridgeFilePath: string;

  constructor(userDataPath: string) {
    this.bridgeFilePath = path.join(userDataPath, "data", BRIDGE_DIR_NAME, BRIDGE_FILE_NAME);
  }

  getBridgeFilePath(): string {
    return this.bridgeFilePath;
  }

  async write(info: WebAiBridgeInfo): Promise<void> {
    await fs.mkdir(path.dirname(this.bridgeFilePath), { recursive: true });
    const tmpPath = `${this.bridgeFilePath}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(info), "utf8");
    await fs.rename(tmpPath, this.bridgeFilePath);
  }

  async clear(): Promise<void> {
    try {
      await fs.unlink(this.bridgeFilePath);
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
  }
}

interface RunRecord extends WebAiRunState {
  events: AiEditRunEvent[];
  listeners: Set<http.ServerResponse>;
}

function isMissingFile(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return "code" in error && (error as { code?: string }).code === "ENOENT";
}

function tokenEquals(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(actual, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isAuthorized(req: http.IncomingMessage, token: string): boolean {
  const header = req.headers.authorization;
  return typeof header === "string" && header.startsWith("Bearer ")
    && tokenEquals(token, header.slice("Bearer ".length));
}

function isAllowedOrigin(origin: string | undefined): boolean {
  return !origin || WEB_AI_ORIGINS.has(origin);
}

function setCorsHeaders(res: http.ServerResponse, origin: string | undefined): void {
  if (origin && WEB_AI_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown, origin?: string): void {
  setCorsHeaders(res, origin);
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_REQUEST_BODY_BYTES) throw new Error("request body too large");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendSseEvent(res: http.ServerResponse, event: unknown): void {
  res.write(`data: ${JSON.stringify(event)}\
\
`);
}

function publicRunState(run: RunRecord): WebAiRunState {
  const { events: _events, listeners: _listeners, ...state } = run;
  return state;
}

function pruneRuns(runs: Map<string, RunRecord>): void {
  const cutoff = Date.now() - RUN_RETENTION_MS;
  for (const [runId, run] of runs) {
    if (run.status !== "running" && Date.parse(run.completedAt ?? run.startedAt) < cutoff) {
      runs.delete(runId);
    }
  }
  while (runs.size > MAX_RUNS) {
    const first = runs.keys().next().value as string | undefined;
    if (!first) break;
    const run = runs.get(first);
    if (run?.status === "running") break;
    runs.delete(first);
  }
}

export function createWebAiBridgeServer(deps: CreateWebAiBridgeServerDeps): http.Server {
  const runs = new Map<string, RunRecord>();

  const emit = (run: RunRecord, event: AiEditRunEvent): void => {
    run.events.push(event);
    if (run.events.length > 500) run.events.splice(0, run.events.length - 500);
    for (const listener of run.listeners) {
      if (!listener.destroyed) sendSseEvent(listener, event);
    }
  };

  const finish = (run: RunRecord, patch: Partial<RunRecord>): void => {
    Object.assign(run, patch, { completedAt: new Date().toISOString() });
    const terminal = {
      kind: "web-ai-run",
      status: run.status,
      runId: run.runId,
      result: run.result,
      error: run.error,
    };
    for (const listener of run.listeners) {
      if (!listener.destroyed) {
        sendSseEvent(listener, terminal);
        listener.end();
      }
    }
    run.listeners.clear();
    pruneRuns(runs);
  };

  return http.createServer((req, res) => {
    void (async () => {
      const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
      setCorsHeaders(res, origin);

      if (req.method === "OPTIONS") {
        if (!isAllowedOrigin(origin)) {
          sendJson(res, 403, { ok: false, error: "origin not allowed" }, origin);
          return;
        }
        res.writeHead(204);
        res.end();
        return;
      }

      if (!isAllowedOrigin(origin)) {
        sendJson(res, 403, { ok: false, error: "origin not allowed" }, origin);
        return;
      }

      if (!isAuthorized(req, deps.token)) {
        sendJson(res, 401, { ok: false, error: "unauthorized" }, origin);
        return;
      }

      const parsedUrl = new URL(req.url ?? "/", "http://127.0.0.1");
      const pathname = parsedUrl.pathname;

      if (req.method === "GET" && pathname === "/v1/health") {
        sendJson(res, 200, { ok: true, apiVersion: API_VERSION }, origin);
        return;
      }

      if (req.method === "GET" && pathname === "/v1/capabilities") {
        sendJson(res, 200, {
          ok: true,
          apiVersion: API_VERSION,
          providers: ["chatgpt", "claude", "antigravity"],
          operations: ["readDocument", "runAgent", "listProposals", "approveProposal", "rejectProposal", "cancelRun"],
          constraints: {
            maxInstructionLength: MAX_INSTRUCTION_LENGTH,
            localhostOnly: true,
            shellAccess: false,
            directDesktopIpc: false,
          },
        }, origin);
        return;
      }

      if (req.method === "GET" && pathname === "/v1/documents") {
        sendJson(res, 200, { ok: true, documents: await deps.listDocuments() }, origin);
        return;
      }

      const routeParts = pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));

      if (req.method === "GET" && routeParts.length === 3 && routeParts[0] === "v1" && routeParts[1] === "documents") {
        const fileId = routeParts[2]!;
        const snapshot = await deps.getDocument(fileId);
        if (!snapshot) {
          sendJson(res, 404, { ok: false, error: "document not found" }, origin);
          return;
        }
        sendJson(res, 200, { ok: true, ...snapshot }, origin);
        return;
      }

      if (req.method === "GET" && pathname === "/v1/proposals") {
        const fileId = parsedUrl.searchParams.get("fileId")?.trim() ?? "";
        if (!fileId) {
          sendJson(res, 400, { ok: false, error: "fileId is required" }, origin);
          return;
        }
        sendJson(res, 200, { ok: true, proposals: await deps.listProposals(fileId) }, origin);
        return;
      }

      if (req.method === "POST" && pathname === "/v1/agent/runs") {
        const body = RunRequestSchema.parse(await readBody(req));
        const snapshot = await deps.getDocument(body.fileId);
        if (!snapshot) {
          sendJson(res, 404, { ok: false, error: "document not found" }, origin);
          return;
        }

        const runId = `webai_${crypto.randomUUID()}`;
        const run: RunRecord = {
          runId,
          provider: body.provider,
          fileId: body.fileId,
          baseRevision: snapshot.revision,
          status: "running",
          startedAt: new Date().toISOString(),
          events: [],
          listeners: new Set(),
        };
        runs.set(runId, run);
        pruneRuns(runs);

        void deps.startRun(
          { ...body, runId, document: snapshot.document, revision: snapshot.revision },
          (event) => emit(run, event),
        ).then((result) => {
          finish(run, { status: "completed", result });
        }).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          finish(run, { status: "error", error: message });
        });

        sendJson(res, 202, { ok: true, runId, baseRevision: snapshot.revision }, origin);
        return;
      }

      if (req.method === "GET" && routeParts.length === 4 && routeParts[0] === "v1" && routeParts[1] === "agent" && routeParts[2] === "runs") {
        const run = runs.get(routeParts[3]!);
        if (!run) {
          sendJson(res, 404, { ok: false, error: "run not found" }, origin);
          return;
        }
        sendJson(res, 200, { ok: true, run: publicRunState(run), events: run.events }, origin);
        return;
      }

      if (req.method === "GET" && routeParts.length === 5 && routeParts[0] === "v1" && routeParts[1] === "agent" && routeParts[2] === "runs" && routeParts[4] === "events") {
        const run = runs.get(routeParts[3]!);
        if (!run) {
          sendJson(res, 404, { ok: false, error: "run not found" }, origin);
          return;
        }
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-store",
          "Connection": "keep-alive",
        });
        run.events.forEach((event) => sendSseEvent(res, event));
        if (run.status !== "running") {
          sendSseEvent(res, { kind: "web-ai-run", status: run.status, runId: run.runId, result: run.result, error: run.error });
          res.end();
          return;
        }
        run.listeners.add(res);
        req.on("close", () => run.listeners.delete(res));
        return;
      }

      if (req.method === "POST" && routeParts.length === 5 && routeParts[0] === "v1" && routeParts[1] === "agent" && routeParts[2] === "runs" && routeParts[4] === "cancel") {
        const runId = routeParts[3]!;
        const run = runs.get(runId);
        if (!run || run.status !== "running") {
          sendJson(res, 404, { ok: false, error: "running run not found" }, origin);
          return;
        }
        const cancelled = deps.cancelRun(runId);
        sendJson(res, 200, { ok: true, cancelled }, origin);
        return;
      }

      if (req.method === "POST" && routeParts.length === 4 && routeParts[0] === "v1" && routeParts[1] === "proposals" && routeParts[3] === "approve") {
        const result = await deps.approveProposal(routeParts[2]!);
        sendJson(res, 200, { ok: true, result }, origin);
        return;
      }

      if (req.method === "POST" && routeParts.length === 4 && routeParts[0] === "v1" && routeParts[1] === "proposals" && routeParts[3] === "reject") {
        const result = await deps.rejectProposal(routeParts[2]!);
        sendJson(res, 200, { ok: true, result }, origin);
        return;
      }

      sendJson(res, 404, { ok: false, error: "not found" }, origin);
    })().catch((error) => {
      const zodError = error instanceof z.ZodError ? error : null;
      const status = zodError ? 400 : 500;
      sendJson(res, status, {
        ok: false,
        error: error instanceof Error ? error.message : "request failed",
        ...(zodError ? { details: zodError.issues } : {}),
      }, typeof req.headers.origin === "string" ? req.headers.origin : undefined);
    });
  });
}
