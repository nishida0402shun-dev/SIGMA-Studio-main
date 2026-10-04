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
    await fs.writeFile(libraryPath, JSON.stringify(library), "utf8");

    const index = new LocalVectorIndex(path.join(dataDir, "knowledge-db", "vector-index"));
    await index.upsertMany([
      { id: sourceId + "_p1_c0", sourceId, pageNumber: 1, chunkIndex: 0, text: "shared neutral content 定理" },
      { id: sourceId + "_p2_c0", sourceId, pageNumber: 2, chunkIndex: 0, text: "shared neutral content" },
    ]);

    const results = await store.search("定理", 2);
    expect(results[0]?.pageNumber).toBe(1);
    expect(results[0]?.score).toBeGreaterThan(results[1]?.score ?? -1);
  });



  it("prioritizes exact phrase matches and can scope retrieval to selected sources", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "sigma-knowledge-db-exact-"));
    tempDirs.push(dataDir);
    const store = new KnowledgeDbStore(dataDir);
    const sourceA = "src_exact_a";
    const sourceB = "src_exact_b";
    const libraryPath = path.join(dataDir, "knowledge-db", "library.json");
    await fs.mkdir(path.dirname(libraryPath), { recursive: true });
    const now = new Date().toISOString();
    const page = (sourceId: string, pageNumber: number, text: string) => ({
      id: sourceId + "_p" + pageNumber,
      sourceId,
      pageNumber,
      semanticType: "unknown" as const,
      text,
      extractionStatus: "text" as const,
      analysisStatus: "analyzed" as const,
      analysisVersion: 2,
    });
    await fs.writeFile(libraryPath, JSON.stringify({
      version: 3,
      sources: [
        { id: sourceA, name: "a.md", originalPath: "", storedPath: "", mimeType: "text/markdown", sizeBytes: 0, pageCount: 1, importedAt: now, updatedAt: now, extractionStatus: "complete", pages: [page(sourceA, 1, "exact phrase: 三角関数の加法定理")] },
        { id: sourceB, name: "b.md", originalPath: "", storedPath: "", mimeType: "text/markdown", sizeBytes: 0, pageCount: 1, importedAt: now, updatedAt: now, extractionStatus: "complete", pages: [page(sourceB, 1, "三角関数について一般的に説明する")] },
      ],
    }), "utf8");
    const index = new LocalVectorIndex(path.join(dataDir, "knowledge-db", "vector-index"));
    await index.upsertMany([
      { id: sourceA + "_p1_c0", sourceId: sourceA, pageNumber: 1, chunkIndex: 0, text: "exact phrase: 三角関数の加法定理" },
      { id: sourceB + "_p1_c0", sourceId: sourceB, pageNumber: 1, chunkIndex: 0, text: "三角関数について一般的に説明する" },
    ]);

    const results = await store.search("三角関数の加法定理", 2);
    expect(results[0]?.sourceId).toBe(sourceA);
    expect(results[0]?.matchReasons).toContain("完全一致");

    const scoped = await store.search("三角関数", 10, [sourceB]);
    expect(scoped.length).toBeGreaterThan(0);
    expect(scoped.every((result) => result.sourceId === sourceB)).toBe(true);

    const context = await store.getContext("三角関数", 10, [sourceA]);
    expect(context.length).toBeGreaterThan(0);
    expect(context.every((item) => item.sourceId === sourceA)).toBe(true);
  });

  it("attaches structure-aware citation regions to search/context results", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "sigma-knowledge-db-citation-"));
    tempDirs.push(dataDir);
    const store = new KnowledgeDbStore(dataDir);
    const sourceId = "src_citation";
    const libraryPath = path.join(dataDir, "knowledge-db", "library.json");
    await fs.mkdir(path.dirname(libraryPath), { recursive: true });
    const library = {
      version: 3,
      sources: [{
        id: sourceId,
        name: "citation.pdf",
        originalPath: "",
        storedPath: "",
        mimeType: "application/pdf",
        sizeBytes: 0,
        pageCount: 1,
        importedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        extractionStatus: "complete",
        pages: [{
          id: sourceId + "_p1",
          sourceId,
          pageNumber: 1,
          semanticType: "theorem",
          text: "三角関数の定理を確認する。",
          extractionStatus: "text",
          analysisStatus: "analyzed",
          structureBlocks: [
            { type: "title", text: "三角関数の定理", bbox: [10, 20, 300, 50], confidence: 0.99 },
            { type: "formula", text: "sin²x + cos²x = 1", bbox: [40, 80, 240, 120], confidence: 0.98 },
          ],
        }],
      }],
    };
    await fs.writeFile(libraryPath, JSON.stringify(library), "utf8");
    const index = new LocalVectorIndex(path.join(dataDir, "knowledge-db", "vector-index"));
    await index.upsertMany([{ id: sourceId + "_p1_c0", sourceId, pageNumber: 1, chunkIndex: 0, text: "三角関数の定理を確認する。" }]);

    const results = await store.search("三角関数の定理", 1);
    expect(results[0]?.citationRegions?.length).toBeGreaterThan(0);
    expect(results[0]?.citationRegions?.[0]?.bbox).toEqual([10, 20, 300, 50]);

    const context = await store.getContext("三角関数の定理", 1);
    expect(context[0]?.citationRegions?.some((region) => region.type === "title")).toBe(true);
    expect(context[0]?.citationRef).toEqual({ sourceId, pageId: sourceId + "_p1", pageNumber: 1 });
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


it("classifies taxonomy from content rather than the filename", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "sigma-knowledge-db-content-taxonomy-"));
  tempDirs.push(dataDir);
  const filePath = path.join(dataDir, "random-name.md");
  await fs.writeFile(filePath, "# 三角関数\\n\\n数学Ⅱの三角関数について、正弦定理と余弦定理を説明する。", "utf8");
  const store = new KnowledgeDbStore(dataDir);
  const [source] = await store.addFiles([filePath]);
  await store.search("正弦定理", 5);
  const indexed = (await store.listSources()).find((item) => item.id === source?.id);
  expect(indexed?.pages[0]?.taxonomyPaths?.some((taxonomyPath) => taxonomyPath.includes("数学Ⅱ"))).toBe(true);
});

it("imports non-PDF files into the global Knowledge DB and indexes their text", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "sigma-knowledge-db-file-types-"));
  tempDirs.push(dataDir);
  const filePath = path.join(dataDir, "notes.md");
  await fs.writeFile(filePath, "# 三角関数\\n\\n正弦定理と余弦定理のメモ", "utf8");
  const store = new KnowledgeDbStore(dataDir);
  const [source] = await store.addFiles([filePath]);
  expect(source?.mimeType).toBe("text/markdown");
  expect(source?.pageCount).toBe(1);
  await store.search("正弦定理", 5);
  const indexed = (await store.listSources()).find((item) => item.id === source?.id);
  expect(indexed?.pages[0]?.text).toContain("正弦定理");
  expect(indexed?.pages[0]?.analysisStatus).toBe("analyzed");
  expect(indexed?.pages[0]?.taxonomyPaths?.length).toBeGreaterThan(0);
  expect(indexed?.pages[0]?.taxonomyPaths?.some((taxonomyPath) => taxonomyPath.includes("図形と計量"))).toBe(true);
  expect((await store.search("正弦定理", 5)).some((item) => item.sourceId === source?.id)).toBe(true);
});

describe("global library", () => {
  it("shares sources across all app contexts", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "sigma-knowledge-db-global-"));
    tempDirs.push(dataDir);
    const sourcePath = await createPdf("global.pdf", 1);
    const store = new KnowledgeDbStore(dataDir);
    const [source] = await store.addFiles([sourcePath]);
    expect(source).toBeTruthy();
    expect(await store.listSources()).toHaveLength(1);
    expect(await store.search("global")).toHaveLength(0);
    await expect(store.getPage(source!.id, 1)).resolves.toBeTruthy();
  });
});


describe("Knowledge DB analysis lifecycle", () => {
  it("marks indexed pages with the current analysis version", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "sigma-knowledge-db-analysis-"));
    tempDirs.push(dataDir);
    const sourcePath = await createPdf("analysis.pdf", 1);
    const store = new KnowledgeDbStore(dataDir);
    const [source] = await store.addFiles([sourcePath]);
    expect(source).toBeTruthy();
    await store.search("warmup", 1);

    const libraryPath = path.join(dataDir, "knowledge-db", "library.json");
    const library = JSON.parse(await fs.readFile(libraryPath, "utf8")) as { sources: Array<{ pages: KnowledgePage[] }> };
    library.sources[0].pages[0].text = "数学Ⅱ 三角関数 定理";
    library.sources[0].pages[0].analysisStatus = "stale";
    library.sources[0].pages[0].analysisVersion = 0;
    await fs.writeFile(libraryPath, JSON.stringify(library), "utf8");

    await store.search("三角関数", 1);
    const refreshed = await store.listSources();
    const page = refreshed[0]!.pages[0]!;
    expect(page.analysisStatus).toBe("analyzed");
    expect(page.analysisVersion).toBeGreaterThan(0);
    expect(page.taxonomyPaths?.some((path) => path.includes("数学Ⅱ"))).toBe(true);
  });

  it("reports analysis lifecycle state and can reanalyze without reimporting the PDF", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "sigma-knowledge-db-reanalyze-"));
    tempDirs.push(dataDir);
    const sourcePath = await createPdf("reanalyze.pdf", 1);
    const store = new KnowledgeDbStore(dataDir);
    const [source] = await store.addFiles([sourcePath]);
    expect(source).toBeTruthy();
    await store.search("warmup", 1);

    const before = await store.listSources();
    expect(before[0]?.pages[0]?.analysisStatus).toBeDefined();
    const status = await store.getAnalysisStatus();
    expect(status.totalPages).toBe(1);
    expect(status.taxonomyCurrent).toBe(1);

    const run = await store.reanalyze([source!.id]);
    expect(["running", "completed"]).toContain(run.state);
    await store.search("再解析", 1);
    const after = await store.listSources();
    expect(after[0]?.id).toBe(source!.id);
    expect(after[0]?.pages[0]?.analysisVersion).toBeGreaterThan(0);
    expect(after[0]?.pages[0]?.taxonomyVersion).toBeGreaterThan(0);
  });

  it("assembles deduplicated context within the requested character budget and exposes reasons", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "sigma-knowledge-db-context-"));
    tempDirs.push(dataDir);
    const sourcePath = await createPdf("context.pdf", 2);
    const store = new KnowledgeDbStore(dataDir);
    const [source] = await store.addFiles([sourcePath]);
    expect(source).toBeTruthy();
    await store.search("warmup", 1);

    const libraryPath = path.join(dataDir, "knowledge-db", "library.json");
    const library = JSON.parse(await fs.readFile(libraryPath, "utf8")) as {
      sources: Array<{
        pages: Array<{
          text?: string;
          analysisStatus?: string;
          analysisVersion?: number;
        }>;
      }>;
    };
    const longText = "数学Ⅱ 三角関数の定理について説明します。".repeat(80);
    for (const page of library.sources[0].pages) {
      page.text = longText;
      page.analysisStatus = "stale";
      page.analysisVersion = 0;
    }
    await fs.writeFile(libraryPath, JSON.stringify(library), "utf8");

    const context = await store.getContext("数学Ⅱ 三角関数 定理", 8, undefined, 600);
    expect(context.length).toBeGreaterThan(0);
    expect(context.reduce((sum, item) => sum + item.text.length, 0)).toBeLessThanOrEqual(600);
    expect(new Set(context.map((item) => `${item.sourceId}:${item.pageNumber}`)).size).toBe(context.length);
    expect(context[0]?.citation).toContain("sigma://knowledge-db/");
    expect(context[0]?.matchReasons?.length).toBeGreaterThan(0);
  });

  it("adds a nearby page as related evidence when it shares the local context", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "sigma-knowledge-db-related-context-"));
    tempDirs.push(dataDir);
    const sourcePath = await createPdf("related.pdf", 2);
    const store = new KnowledgeDbStore(dataDir);
    const [source] = await store.addFiles([sourcePath]);
    expect(source).toBeTruthy();
    await store.search("warmup", 1);

    const libraryPath = path.join(dataDir, "knowledge-db", "library.json");
    const library = JSON.parse(await fs.readFile(libraryPath, "utf8")) as {
      sources: Array<{ pages: KnowledgePage[] }>;
    };
    library.sources[0]!.pages[0]!.text = "三角関数の定理を説明する本文。";
    library.sources[0]!.pages[0]!.taxonomyPaths = [["数学Ⅱ", "三角関数"]];
    library.sources[0]!.pages[1]!.text = "三角関数の公式と証明を補足する本文。";
    library.sources[0]!.pages[1]!.taxonomyPaths = [["数学Ⅱ", "三角関数"]];
    await fs.writeFile(libraryPath, JSON.stringify(library), "utf8");

    const index = new LocalVectorIndex(path.join(dataDir, "knowledge-db", "vector-index"));
    await index.removeSource(source!.id);
    await index.upsertMany([
      { id: source!.id + "_p1_c0", sourceId: source!.id, pageNumber: 1, chunkIndex: 0, text: "三角関数の定理を説明する本文。" },
      { id: source!.id + "_p2_c0", sourceId: source!.id, pageNumber: 2, chunkIndex: 0, text: "三角関数の公式と証明を補足する本文。" },
    ]);

    const context = await store.getContext("三角関数の定理", 4, undefined, 2000);
    expect(context.length).toBe(2);
    expect(context[0]?.relation).toBe("primary");
    expect(context[1]?.relation).toBe("related");
    expect(context[1]?.relatedTo).toBe(`${source!.id}:1`);
    expect(context[1]?.pageNumber).toBe(2);
  });
});

describe("Knowledge DB classification review", () => {
  it("confirms matching AI classification and preserves the local taxonomy on conflict", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "sigma-knowledge-db-review-"));
    tempDirs.push(dataDir);
    const filePath = path.join(dataDir, "review.md");
    await fs.writeFile(filePath, "# 三角関数\n\n数学Ⅱの三角関数について説明する。", "utf8");
    const store = new KnowledgeDbStore(dataDir);
    const [source] = await store.addFiles([filePath]);
    await store.search("三角関数", 5);
    const page = (await store.listSources()).find((item) => item.id === source?.id)?.pages[0];
    expect(page?.taxonomyPaths?.[0]).toEqual(["数学Ⅱ", "三角関数"]);

    const confirmed = await store.applyClassificationReview({
      sourceId: source!.id,
      pageNumber: 1,
      paths: [["数学Ⅱ", "三角関数"]],
      confidence: 0.94,
      reason: "本文に数学Ⅱと三角関数が明記されている。",
      evidence: ["数学Ⅱの三角関数について説明する。"],
    });
    expect(confirmed.status).toBe("confirmed");

    const conflict = await store.applyClassificationReview({
      sourceId: source!.id,
      pageNumber: 1,
      paths: [["物理", "力学"]],
      confidence: 0.91,
    });
    expect(conflict.status).toBe("needs-review");
    const after = (await store.listSources()).find((item) => item.id === source?.id)?.pages[0];
    expect(after?.taxonomyPaths?.[0]).toEqual(["数学Ⅱ", "三角関数"]);
    expect(after?.classificationReviewStatus).toBe("needs-review");
  });
});
