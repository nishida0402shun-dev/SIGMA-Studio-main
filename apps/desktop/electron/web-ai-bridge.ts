import crypto from "node:crypto";
import fsPromises from "node:fs/promises";
import http from "node:http";
import path from "node:path";

import { z } from "zod";

import type { SigmaDocument } from "@/features/document";
import type { AiEditRunEvent, AiEditRunResult } from "@/lib/ai/ai-edit-runtime";
import type { AiEditController } from "./ipc/ai-edit";

const MAX_REQUEST_BODY_BYTES = 4 * 1024 * 1024;
const BRIDGE_DIR_NAME = "ai-run-context";
const BRIDGE_FILE_NAME = "web-ai-bridge.json";

export const WebAiBridgeInfoSchema = z.object({
  version: z.literal(1),
  url: z.string().min(1),
  token: z.string().min(1),
  pid: z.number().int(),
  createdAt: z.string().min(1),
});

export type WebAiBridgeInfo = z.infer<typeof WebAiBridgeInfoSchema>;

export interface WebAiBridgeStore {
  getBridgeFilePath(): string;
  write(info: WebAiBridgeInfo): Promise<void>;
  clear(): Promise<void>;
}

export class LocalWebAiBridgeStore implements WebAiBridgeStore {
  private readonly bridgeFilePath: string;

  constructor(userDataPath: string) {
    this.bridgeFilePath = path.join(userDataPath, "data", BRIDGE_DIR_NAME, BRIDGE_FILE_NAME);
  }

  getBridgeFilePath(): string {
    return this.bridgeFilePath;
  }

  async write(info: WebAiBridgeInfo): Promise<void> {
    await fsPromises.mkdir(path.dirname(this.bridgeFilePath), { recursive: true });
    const tmpPath = `${this.bridgeFilePath}.tmp`;
    await fsPromises.writeFile(tmpPath, JSON.stringify(info), "utf8");
    await fsPromises.rename(tmpPath, this.bridgeFilePath);
  }

  async clear(): Promise<void> {
    try {
      await fsPromises.unlink(this.bridgeFilePath);
    } catch (error) {
      if (!error || typeof error !== "object" || (error as { code?: string }).code !== "ENOENT") {
        console.warn("Failed to clear Web AI bridge metadata.", error);
      }
    }
  }
}

const RunRequestSchema = z.object({
  provider: z.enum(["chatgpt", "claude", "antigravity"]).default("chatgpt"),
  instruction: z.string().trim().min(1).max(32_000),
  fileId: z.string().trim().min(1).max(256),
  selectedId: z.string().trim().max(256).nullable().optional(),
  model: z.string().trim().max(256).optional(),
  reasoningEffort: z.string().trim().max(64).optional(),
  aiResourceIds: z.array(z.string().trim().min(1).max(256)).max(64).optional(),
  roomId: z.string().trim().max(256).optional(),
  turnId: z.string().trim().max(256).optional(),
  sessionLabel: z.string().trim().max(256).optional(),
});

export interface WebAiBridgeDeps {
  token: string;
  allowedOrigins: readonly string[];
  aiEditController: AiEditController;
  loadDocument: (fileId: string) => Promise<SigmaDocument | null>;
  listFiles: () => Promise<unknown>;
  listProposals: (fileId?: string) => Promise<unknown>;
  approveProposal: (proposalId: string) => Promise<unknown>;
}

function sendJson(
  res: http.ServerResponse,
  statusCode: number,
  payload: unknown,
  origin: string | undefined,
  allowedOrigins: readonly string[],
): void {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(Buffer.byteLength(body)),
    "Cache-Control": "no-store",
  };
  if (origin && allowedOrigins.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Vary"] = "Origin";
  }
  res.writeHead(statusCode, headers);
  res.end(body);
}

function timingSafeTokenEquals(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(actual, "utf8");
  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function isAuthorized(req: http.IncomingMessage, token: string): boolean {
  const value = req.headers.authorization;
  if (!value?.startsWith("Bearer ")) {
    return false;
  }
  return timingSafeTokenEquals(token, value.slice("Bearer ".length));
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_REQUEST_BODY_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parsePath(url: string | undefined): { pathname: string; search: URLSearchParams } {
  const parsed = new URL(url ?? "/", "http://127.0.0.1");
  return { pathname: parsed.pathname, search: parsed.searchParams };
}

export function createWebAiBridgeServer(deps: WebAiBridgeDeps): http.Server {
  return http.createServer((req, res) => {
    void (async () => {
      const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
      const { pathname, search } = parsePath(req.url);

      if (req.method === "OPTIONS") {
        if (origin && !deps.allowedOrigins.includes(origin)) {
          sendJson(res, 403, { ok: false, error: "origin not allowed" }, origin, deps.allowedOrigins);
          return;
        }
        sendJson(res, 204, null, origin, deps.allowedOrigins);
        return;
      }

      if (!isAuthorized(req, deps.token)) {
        sendJson(res, 401, { ok: false, error: "unauthorized" }, origin, deps.allowedOrigins);
        return;
      }

      if (req.method === "GET" && pathname === "/v1/health") {
        sendJson(res, 200, {
          ok: true,
          version: 1,
          providers: ["chatgpt", "claude", "antigravity"],
        }, origin, deps.allowedOrigins);
        return;
      }

      if (req.method === "GET" && pathname === "/v1/files") {
        sendJson(res, 200, { ok: true, files: await deps.listFiles() }, origin, deps.allowedOrigins);
        return;
      }

      if (req.method === "GET" && pathname === "/v1/proposals") {
        const fileId = search.get("fileId")?.trim() || undefined;
        sendJson(res, 200, { ok: true, proposals: await deps.listProposals(fileId) }, origin, deps.allowedOrigins);
        return;
      }

      if (req.method === "POST" && pathname === "/v1/runs") {
        const raw = await readBody(req);
        let json: unknown;
        try {
          json = JSON.parse(raw.toString("utf8"));
        } catch {
          sendJson(res, 400, { ok: false, error: "invalid JSON" }, origin, deps.allowedOrigins);
          return;
        }

        const parsed = RunRequestSchema.safeParse(json);
        if (!parsed.success) {
          sendJson(res, 400, { ok: false, error: "invalid request", details: parsed.error.issues }, origin, deps.allowedOrigins);
          return;
        }

        const document = await deps.loadDocument(parsed.data.fileId);
        if (!document) {
          sendJson(res, 404, { ok: false, error: "document not found" }, origin, deps.allowedOrigins);
          return;
        }

        const runId = `webai_${crypto.randomUUID()}`;
        const events: AiEditRunEvent[] = [];
        const result: AiEditRunResult = await deps.aiEditController.run(
          runId,
          { ...parsed.data, document },
          (event) => events.push(event),
        );

        sendJson(res, 200, {
          ok: true,
          runId,
          result,
          events,
        }, origin, deps.allowedOrigins);
        return;
      }

      const cancelMatch = pathname.match(/^\/v1\/runs\/([^/]+)\/cancel$/);
      if (req.method === "POST" && cancelMatch) {
        const runId = decodeURIComponent(cancelMatch[1]);
        sendJson(res, 200, deps.aiEditController.cancel(runId), origin, deps.allowedOrigins);
        return;
      }

      const approveMatch = pathname.match(/^\/v1\/proposals\/([^/]+)\/approve$/);
      if (req.method === "POST" && approveMatch) {
        const proposalId = decodeURIComponent(approveMatch[1]);
        sendJson(res, 200, await deps.approveProposal(proposalId), origin, deps.allowedOrigins);
        return;
      }

      sendJson(res, 404, { ok: false, error: "not found" }, origin, deps.allowedOrigins);
    })().catch((error) => {
      sendJson(
        res,
        500,
        { ok: false, error: error instanceof Error ? error.message : "internal error" },
        typeof req.headers.origin === "string" ? req.headers.origin : undefined,
        deps.allowedOrigins,
      );
    });
  });
}
