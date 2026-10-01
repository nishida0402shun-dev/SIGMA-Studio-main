import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it } from "vitest";
import { KnowledgeDbStore } from "./knowledge-db-store";

const tempDirs: string[] = [];

async function createPdf(fileName: string, pageCount: number): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sigma-knowledge-db-"));
  tempDirs.push(dir);
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) pdf.addPage();
  const filePath = path.join(dir, fileName);
  await fs.writeFile(filePath, await pdf.save());
  return filePath;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("KnowledgeDbStore", () => {
  it("opens an individual imported page and removes a source with its index", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "sigma-knowledge-db-data-"));
    tempDirs.push(dataDir);
    const sourcePath = await createPdf("source.pdf", 3);
    const store = new KnowledgeDbStore(dataDir);

    const [source] = await store.addFiles([sourcePath]);
    expect(source).toBeTruthy();

    const openedPath = await store.openPage(source!.id, 2);
    const opened = await PDFDocument.load(await fs.readFile(openedPath));
    expect(opened.getPageCount()).toBe(1);
    expect(await fs.stat(openedPath)).toBeTruthy();

    expect(await store.deleteSource(source!.id)).toBe(true);
    expect(await store.listSources()).toHaveLength(0);
    expect(await store.search("source")).toHaveLength(0);
  });

  it("extracts selected pages from multiple imported PDFs into one PDF", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "sigma-knowledge-db-data-"));
    tempDirs.push(dataDir);
    const first = await createPdf("first.pdf", 3);
    const second = await createPdf("second.pdf", 2);
    const store = new KnowledgeDbStore(dataDir);

    const added = await store.addFiles([first, second]);
    expect(added).toHaveLength(2);

    const bytes = await store.extractSelectedPages([
      { sourceId: added[0]!.id, pageNumbers: [1, 3] },
      { sourceId: added[1]!.id, pageNumbers: [2] },
    ]);
    const output = await PDFDocument.load(bytes);

    expect(output.getPageCount()).toBe(3);
  });
});
