import fs from "node:fs/promises";
import { appendFileSync } from "node:fs";
import path from "node:path";
import type { DesktopExternalDocument } from "../src/types/desktop";

/**
 * Optional file-based diagnostics for the Electron open-document smoke test.
 * No trace is written unless the test explicitly supplies a destination path.
 */
export function traceExternalDocumentOpen(event: string, details: Record<string, unknown> = {}): void {
  const tracePath = process.env.SIGMA_STUDIO_OPEN_DOCUMENT_TRACE_FILE;
  if (!tracePath) return;
  try {
    appendFileSync(tracePath, `${JSON.stringify({
      at: new Date().toISOString(),
      pid: process.pid,
      event,
      ...details,
    })}\n`, "utf8");
  } catch {
    // Diagnostics must never change document-open behavior.
  }
}

/** Generic JSON is deliberately excluded from OS/command-line activation. */
export function isSigmaDocumentPath(filePath: string): boolean {
  return /\.(?:sigma|sigma\.json|sigmadoc\.json)$/i.test(filePath);
}

export function documentPathsFromArgv(
  argv: readonly string[],
  workingDirectory: string,
  defaultApp: boolean,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const paths = platform === "win32" ? path.win32 : path.posix;
  return [...new Set(argv.slice(defaultApp ? 2 : 1)
    .filter((argument) => !argument.startsWith("-") && isSigmaDocumentPath(argument))
    .map((argument) => paths.resolve(workingDirectory, argument)))];
}

/** Paths stay in main until the ready editor has finished handling each request. */
export class ExternalDocumentOpenQueue {
  private pending: { id: number; filePath: string }[] = [];
  private nextId = 1;

  constructor(private readonly notify: () => void) {}

  enqueue(filePaths: readonly string[]): void {
    const before = this.pending.length;
    for (const filePath of filePaths) {
      if (!path.isAbsolute(filePath) || !isSigmaDocumentPath(filePath)) continue;
      if (this.pending.some((entry) => entry.filePath === filePath)) continue;
      this.pending.push({ id: this.nextId++, filePath });
    }
    traceExternalDocumentOpen("queue.enqueue", {
      requestedPaths: [...filePaths],
      pending: this.pending.map(({ id, filePath }) => ({ id, filePath })),
      previousPendingCount: before,
    });
    if (this.pending.length) this.notify();
  }

  async readNext(): Promise<DesktopExternalDocument | null> {
    const entry = this.pending[0];
    if (!entry) {
      traceExternalDocumentOpen("queue.read-empty");
      return null;
    }
    try {
      // Avoid reading directories, pipes or devices delivered by a file activation.
      if (!(await fs.stat(entry.filePath)).isFile()) throw new Error("Not a regular file");
      const data = await fs.readFile(entry.filePath, "utf8");
      traceExternalDocumentOpen("queue.read-success", { id: entry.id, filePath: entry.filePath, byteLength: Buffer.byteLength(data) });
      return { ...entry, data };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      traceExternalDocumentOpen("queue.read-error", { id: entry.id, filePath: entry.filePath, error: message });
      return { ...entry, error: message };
    }
  }

  acknowledge(id: number): void {
    const before = this.pending.map(({ id: pendingId, filePath }) => ({ id: pendingId, filePath }));
    if (this.pending[0]?.id === id) this.pending.shift();
    traceExternalDocumentOpen("queue.acknowledge", {
      acknowledgedId: id,
      matchedHead: before[0]?.id === id,
      before,
      after: this.pending.map(({ id: pendingId, filePath }) => ({ id: pendingId, filePath })),
    });
  }
}
