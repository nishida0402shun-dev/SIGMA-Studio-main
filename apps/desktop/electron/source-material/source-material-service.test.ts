import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  SourceMaterialError,
  SourceMaterialService,
  toSourceMaterialError,
} from "./source-material-service";

const PDF_FIXTURE = path.resolve(
  process.cwd(),
  "../../vendor/sigma-core/tests/fixtures/japanese-two-pages.pdf",
);

async function captureError(operation: () => unknown | Promise<unknown>): Promise<SourceMaterialError> {
  try {
    await operation();
  } catch (error) {
    expect(error).toBeInstanceOf(SourceMaterialError);
    return error as SourceMaterialError;
  }
  throw new Error("expected the operation to fail");
}

describe("SourceMaterialService", () => {
  let userDataDir: string;
  let service: SourceMaterialService | null;

  beforeEach(async () => {
    userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "sigma-source-material-"));
    service = new SourceMaterialService(userDataDir);
  });

  afterEach(async () => {
    service?.close();
    service = null;
    await fs.rm(userDataDir, { recursive: true, force: true });
  });

  function current(): SourceMaterialService {
    if (!service) throw new Error("service is not initialized");
    return service;
  }

  it("does not create or list a Core workspace implicitly", async () => {
    expect(current().getWorkspaceStatus("workspace-a")).toMatchObject({
      registered: false,
      sourceCount: 0,
    });

    const listError = await captureError(() => current().listSources("workspace-a"));
    expect(listError.code).toBe("WORKSPACE_NOT_REGISTERED");

    const importError = await captureError(() => current().importFile("workspace-a", PDF_FIXTURE));
    expect(importError.code).toBe("WORKSPACE_NOT_REGISTERED");

    expect(current().getWorkspaceStatus("workspace-a").registered).toBe(false);
  });

  it("requires an explicit workspace id", async () => {
    const error = await captureError(() => current().getWorkspaceStatus("  "));
    expect(error.code).toBe("WORKSPACE_SELECTION_REQUIRED");
  });

  it("registers a workspace explicitly and imports a PDF with 1-based pages", async () => {
    expect(current().registerWorkspace("workspace-a", "理科資料")).toMatchObject({
      registered: true,
      displayName: "理科資料",
      sourceCount: 0,
    });

    const outcome = await current().importFile("workspace-a", PDF_FIXTURE);
    expect(outcome.duplicate).toBe(false);
    expect(outcome.source).toMatchObject({
      name: "japanese-two-pages.pdf",
      mimeType: "application/pdf",
      format: "pdf",
      pageCount: 2,
      studioWorkspaceId: "workspace-a",
      coreWorkspaceId: "studio:workspace-a",
    });
    expect(["complete", "partial"]).toContain(outcome.source.extraction.status);

    const listed = current().listSources("workspace-a");
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(outcome.source.id);

    const page = current().getPage("workspace-a", outcome.source.id, 1);
    expect(page.page.pageNumber).toBe(1);
    expect(page.page.text.trim().length).toBeGreaterThan(0);

    const range = current().getPageRange("workspace-a", outcome.source.id, 1, 2);
    expect(range.pages.map((item) => item.pageNumber)).toEqual([1, 2]);

    const bytes = await current().getFileBytes("workspace-a", outcome.source.id);
    expect(Buffer.from(bytes.bytes).subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.name).toBe("japanese-two-pages.pdf");
  });

  it("deduplicates identical bytes only inside the same workspace", async () => {
    current().registerWorkspace("workspace-a", "A");
    current().registerWorkspace("workspace-b", "B");

    const first = await current().importFile("workspace-a", PDF_FIXTURE);
    const duplicate = await current().importFile("workspace-a", PDF_FIXTURE);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.source.id).toBe(first.source.id);
    expect(current().listSources("workspace-a")).toHaveLength(1);

    const otherWorkspace = await current().importFile("workspace-b", PDF_FIXTURE);
    expect(otherWorkspace.duplicate).toBe(false);
    expect(otherWorkspace.source.id).not.toBe(first.source.id);
    expect(current().listSources("workspace-b")).toHaveLength(1);
  });

  it("keeps sources isolated across workspaces", async () => {
    current().registerWorkspace("workspace-a", "A");
    current().registerWorkspace("workspace-b", "B");
    const imported = await current().importFile("workspace-a", PDF_FIXTURE);

    const error = await captureError(() => current().getFileBytes("workspace-b", imported.source.id));
    expect(error.code).toBe("SOURCE_NOT_FOUND");
    expect(current().listSources("workspace-b")).toEqual([]);
  });

  it("imports UTF-8 text and exposes its extracted page", async () => {
    current().registerWorkspace("workspace-a", "A");
    const outcome = await current().importBytes("workspace-a", {
      name: "notes.md",
      bytes: Buffer.from("# 見出し\n本文です。", "utf8"),
    });

    expect(outcome.source).toMatchObject({
      name: "notes.md",
      mimeType: "text/markdown",
      format: "text",
      pageCount: 1,
    });
    const page = current().getPage("workspace-a", outcome.source.id, 1);
    expect(page.page.text).toBe("# 見出し\n本文です。");
  });

  it("rejects unsupported and mismatched files without registering them", async () => {
    current().registerWorkspace("workspace-a", "A");

    const binary = await captureError(() => current().importBytes("workspace-a", {
      name: "data.bin",
      bytes: Buffer.from([0, 1, 2, 3, 4]),
    }));
    expect(binary.code).toBe("UNSUPPORTED_FORMAT");

    const fakePdf = await captureError(() => current().importBytes("workspace-a", {
      name: "fake.pdf",
      bytes: Buffer.from("plain text"),
    }));
    expect(fakePdf.code).toBe("UNSUPPORTED_FORMAT");

    expect(current().listSources("workspace-a")).toEqual([]);
  });

  it("enforces the configured byte limit before touching Core", async () => {
    service?.close();
    service = new SourceMaterialService(userDataDir, { maxBytes: 8 });
    current().registerWorkspace("workspace-a", "A");

    const error = await captureError(() => current().importBytes("workspace-a", {
      name: "notes.txt",
      bytes: Buffer.alloc(9, 0x61),
    }));
    expect(error.code).toBe("FILE_TOO_LARGE");
    expect(current().listSources("workspace-a")).toEqual([]);
  });

  it("supports logical deletion and restore within the Workspace", async () => {
    current().registerWorkspace("workspace-a", "A");
    const imported = await current().importFile("workspace-a", PDF_FIXTURE);

    expect(current().deleteSource("workspace-a", imported.source.id)).toBe(true);
    expect(current().listSources("workspace-a")).toEqual([]);
    expect(current().restoreSource("workspace-a", imported.source.id)).toBe(true);
    expect(current().listSources("workspace-a")).toHaveLength(1);
  });

  it("searches extracted text and keeps page provenance", async () => {
    current().registerWorkspace("workspace-a", "A");
    const imported = await current().importBytes("workspace-a", {
      name: "search.txt",
      bytes: Buffer.from("光合成の実験\n二酸化炭素を調べる", "utf8"),
    });

    const hits = current().search("workspace-a", "光合成");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      sourceId: imported.source.id,
      sourceName: "search.txt",
      pageNumber: 1,
    });
  });
});

describe("toSourceMaterialError", () => {
  it("preserves Core's machine-readable code", () => {
    const error = toSourceMaterialError(new Error("PERMISSION_DENIED: nope"));
    expect(error.code).toBe("PERMISSION_DENIED");
    expect(error.message).toBe("nope");
  });

  it("keeps Studio errors and wraps unknown failures", () => {
    const studio = new SourceMaterialError("LOCAL_CODE", "local");
    expect(toSourceMaterialError(studio)).toBe(studio);
    expect(toSourceMaterialError(new Error("boom")).code).toBe("CORE_ERROR");
  });
});
