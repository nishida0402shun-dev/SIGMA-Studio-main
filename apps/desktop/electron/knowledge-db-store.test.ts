import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it } from "vitest";
import { KnowledgeDbStore, type KnowledgePage } from "./knowledge-db-store";
import { LocalVectorIndex } from "./local-vector-index";
import { KNOWLEDGE_ANALYSIS_VERSION } from "./knowledge-analysis-engine";
import { KNOWLEDGE_TAXONOMY_VERSION } from "./knowledge-taxonomy";

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
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
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

    const regionPath = await store.extractRegion(source!.id, 2, { x: 10, y: 20, width: 200, height: 300 });
    const region = await PDFDocument.load(await fs.readFile(regionPath));
    expect(region.getPageCount()).toBe(1);
    const regionSize = region.getPage(0).getSize();
    expect(regionSize.width).toBe(200);
    expect(regionSize.height).toBe(300);

    expect(await store.deleteSource(source!.id)).toBe(true);
    expect(await store.listSources()).toHaveLength(0);
    expect(await store.search("source")).toHaveLength(0);
  });


  it("uses analysis metadata to boost semantically matching pages", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "sigma-knowledge-db-ranking-"));
    tempDirs.push(dataDir);
    await createPdf("ranking.pdf", 2);
    const store = new KnowledgeDbStore(dataDir);
    const sourceId = "src_ranking";
    const libraryPath = path.join(dataDir, "knowledge-db", "library.json");
    await fs.mkdir(path.dirname(libraryPath), { recursive: true });
    const library = {
      version: 3,
      sources: [{
        id: sourceId,
        name: "ranking.pdf",
        originalPath: "",
        storedPath: "",
        mimeType: "application/pdf",
        sizeBytes: 0,
        pageCount: 2,
        importedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        extractionStatus: "complete",
        pages: [
          { id: sourceId + "_p1", sourceId, pageNumber: 1, semanticType: "theorem", text: "shared neutral content", extractionStatus: "text", analysisStatus: "analyzed", analysisVersion: KNOWLEDGE_ANALYSIS_VERSION, taxonomyVersion: KNOWLEDGE_TAXONOMY_VERSION, title: "定理の証明", keywords: ["証明", "数学"] },
          { id: sourceId + "_p2", sourceId, pageNumber: 2, semanticType: "unknown", text: "shared neutral content", extractionStatus: "text", analysisStatus: "analyzed", analysisVersion: 2, taxonomyVersion: 2 },
        ],
      }],
    };