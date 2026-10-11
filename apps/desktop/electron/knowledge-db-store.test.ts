import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it } from "vitest";
import { KnowledgeDbStore, type KnowledgePage, type KnowledgeSource } from "./knowledge-db-store";
import { openQuestionEngineDatabase, type QuestionEngineDatabase } from "../../../packages/question-engine/src/index";
import { LocalVectorIndex } from "./local-vector-index";
import { KNOWLEDGE_ANALYSIS_VERSION } from "./knowledge-analysis-engine";
import { KNOWLEDGE_TAXONOMY_VERSION } from "./knowledge-taxonomy";

const tempDirs: string[] = [];
const databases: QuestionEngineDatabase[] = [];
const databasesByDir = new Map<string, QuestionEngineDatabase>();

function getDatabase(dataDir: string): QuestionEngineDatabase {
  const existing = databasesByDir.get(dataDir);
  if (existing) return existing;
  const database = openQuestionEngineDatabase({ dataDir: path.join(dataDir, "knowledge-db") });
  databases.push(database);
  databasesByDir.set(dataDir, database);
  return database;
}

function createStore(dataDir: string): KnowledgeDbStore {
  return new KnowledgeDbStore(dataDir, getDatabase(dataDir).raw);
}

function createVectorIndex(dataDir: string): LocalVectorIndex {
  return new LocalVectorIndex(getDatabase(dataDir).raw);
}

async function readLibraryFixture(dataDir: string): Promise<{ version: 3; sources: KnowledgeSource[]; __fingerprint?: string }> {
  const internal = createStore(dataDir) as unknown as {
    readLibrary: () => Promise<{ version: 3; sources: KnowledgeSource[]; __fingerprint?: string }>;
  };
  return internal.readLibrary();
}

function seedLibrary(dataDir: string, fixture: { sources: Array<Record<string, any>> }): void {
  const db = getDatabase(dataDir).raw;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec("DELETE FROM qe_knowledge_sources");
    const insertSource = db.prepare(`
      INSERT INTO qe_knowledge_sources
        (id, display_name, original_uri, stored_uri, mime_type, size_bytes, content_hash,
         page_count, extraction_status, imported_at, updated_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertPage = db.prepare(`
      INSERT INTO qe_knowledge_pages
        (id, source_id, page_number, semantic_type, title, text_content, extraction_status,
         structure_json, analysis_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const source of fixture.sources) {
      insertSource.run(source.id, source.name ?? source.display_name ?? source.id,
        source.originalPath ?? "", source.storedPath ?? "", source.mimeType ?? "text/plain",
        source.sizeBytes ?? 0, source.contentHash ?? "", source.pageCount ?? source.pages?.length ?? 0,
        source.extractionStatus ?? "complete", source.importedAt ?? new Date().toISOString(),
        source.updatedAt ?? new Date().toISOString(),
        JSON.stringify({ indexedAt: source.indexedAt, indexError: source.indexError }));
      for (const page of source.pages ?? []) {
        insertPage.run(page.id, source.id, page.pageNumber, page.semanticType ?? "unknown",
          page.title ?? null, page.text ?? "", page.extractionStatus ?? (page.text ? "text" : "empty"),
          JSON.stringify(page.structureBlocks ?? []), JSON.stringify(page),
          source.updatedAt ?? new Date().toISOString());
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

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
  for (const database of databases.splice(0)) database.close();
  databasesByDir.clear();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
});

describe("KnowledgeDbStore", () => {
  it("opens an individual imported page and removes a source with its index", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "sigma-knowledge-db-data-"));
    tempDirs.push(dataDir);
    const sourcePath = await createPdf("source.pdf", 3);
    const store = createStore(dataDir);
    const [source] = await store.addFiles([sourcePath]);
    expect(source).toBeTruthy();

    const openedPath = await store.openPage(source!.id, 2);
    const opened = await PDFDocument.load(await fs.readFile(openedPath));
    expect(opened.getPageCount()).toBe(1);
    expect(await fs.stat(openedPath)).toBeTruthy();

    const preview = await store.getPagePdfBase64(source!.id, 2);
    const previewPdf = await PDFDocument.load(Buffer.from(preview.dataBase64, "base64"));
    expect(previewPdf.getPageCount()).toBe(1);
    expect(preview.width).toBeGreaterThan(0);
    expect(preview.height).toBeGreaterThan(0);

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
    const store = createStore(dataDir);
    const sourceId = "src_ranking";
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
    seedLibrary(dataDir, library);

    const index = createVectorIndex(dataDir);
    await index.upsertMany([
      { id: sourceId + "_p1_c0", sourceId, pageNumber: 1, chunkIndex: 0, text: "shared neutral content 定理" },
      { id: sourceId + "_p2_c0", sourceId, pageNumber: 2, chunkIndex: 0, text: "shared neutral content" },
    ]);

    const results = await store.search("定理", 2);
    expect(results[0]?.pageNumber).toBe(1);
    expect(results[0]?.score).toBeGreaterThan(results[1]?.score ?? -1);
  });



  it("uses corpus-aware lexical ranking to prefer rare query terms over common terms", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "sigma-knowledge-db-hybrid-"));
    tempDirs.push(dataDir);
    const store = createStore(dataDir);
    const sourceIds = ["src_hybrid_a", "src_hybrid_b", "src_hybrid_c"];
    const now = new Date().toISOString();
    const pages = [
      { id: sourceIds[0] + "_p1", sourceId: sourceIds[0], pageNumber: 1, semanticType: "unknown" as const, text: "数学 三角関数 共通説明", extractionStatus: "text" as const, analysisStatus: "analyzed" as const, analysisVersion: 2 },
      { id: sourceIds[1] + "_p1", sourceId: sourceIds[1], pageNumber: 1, semanticType: "theorem" as const, text: "数学 三角関数 加法定理 特殊定理", extractionStatus: "text" as const, analysisStatus: "analyzed" as const, analysisVersion: 2, title: "加法定理", keywords: ["加法定理", "三角関数"] },
      { id: sourceIds[2] + "_p1", sourceId: sourceIds[2], pageNumber: 1, semanticType: "unknown" as const, text: "数学 三角関数 共通説明 公式", extractionStatus: "text" as const, analysisStatus: "analyzed" as const, analysisVersion: 2 },
    ];
    seedLibrary(dataDir, {
      version: 3,
      sources: sourceIds.map((id, index) => ({
        id, name: `hybrid-${index}.md`, originalPath: "", storedPath: "", mimeType: "text/markdown",
        sizeBytes: 0, pageCount: 1, importedAt: now, updatedAt: now, extractionStatus: "complete",
        pages: [pages[index]],
      })),
    });
    const index = createVectorIndex(dataDir);
    await index.upsertMany(pages.map((page) => ({
      id: page.id + "_c0", sourceId: page.sourceId, pageNumber: 1, chunkIndex: 0, text: page.text,
    })));

    const results = await store.search("三角関数 加法定理", 3);
    expect(results[0]?.sourceId).toBe(sourceIds[1]);
    expect(results[0]?.matchReasons?.length).toBeGreaterThan(0);
  });

  it("prioritizes exact phrase matches and can scope retrieval to selected sources", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "sigma-knowledge-db-exact-"));
    tempDirs.push(dataDir);
    const store = createStore(dataDir);
    const sourceA = "src_exact_a";
    const sourceB = "src_exact_b";
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
    seedLibrary(dataDir, {
      version: 3,
      sources: [
        { id: sourceA, name: "a.md", originalPath: "", storedPath: "", mimeType: "text/markdown", sizeBytes: 0, pageCount: 1, importedAt: now, updatedAt: now, extractionStatus: "complete", pages: [page(sourceA, 1, "exact phrase: 三角関数の加法定理")] },
        { id: sourceB, name: "b.md", originalPath: "", storedPath: "", mimeType: "text/markdown", sizeBytes: 0, pageCount: 1, importedAt: now, updatedAt: now, extractionStatus: "complete", pages: [page(sourceB, 1, "三角関数について一般的に説明する")] },
      ],
    });
    const index = createVectorIndex(dataDir);
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
    const store = createStore(dataDir);
    const sourceId = "src_citation";
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
    seedLibrary(dataDir, library);
    const index = createVectorIndex(dataDir);
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
    const store = createStore(dataDir);
    const added = await store.addFiles([first, second]);
    expect(added).toHaveLength(2);

    const bytes = await store.extractSelectedPages([
      { sourceId: added[0]!.id, pageNumbers: [1, 3] },
      { sourceId: added[1]!.id, pageNumbers: [2] },
    ]);
    const output = await PDFDocument.load(bytes);

    expect(output.getPageCount()).toBe(3);
  });
  it("keeps PDF outside the Knowledge DB until staging is approved", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "sigma-knowledge-db-staging-"));
    tempDirs.push(dataDir);
    const sourcePath = await createPdf("staging.pdf", 3);
    const store = createStore(dataDir);

    const staging = await store.previewPdfImport(sourcePath);
    expect(staging.status).toBe("draft");
    expect(staging.pageCount).toBe(3);
    expect(staging.sourceHash).toHaveLength(64);
    expect(await store.listSources()).toHaveLength(0);

    const updated = {
      ...staging,
      segments: staging.segments.map((segment) => ({ ...segment, name: "承認済み子PDF", selected: true })),
    };
    await store.updatePdfImportStaging({ stagingId: staging.id, segments: updated.segments });
    const committed = await store.approvePdfImport(staging.id);

    expect(committed.sourceId).toBeTruthy();
    expect(await store.listSources()).toHaveLength(2);
    expect((await store.getPdfImportStaging(staging.id))?.status).toBe("approved");
  });

  it("refuses approval when the source PDF changed after preview", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "sigma-knowledge-db-staging-hash-"));
    tempDirs.push(dataDir);
    const sourcePath = await createPdf("mutable.pdf", 1);
    const store = createStore(dataDir);
    const staging = await store.previewPdfImport(sourcePath);

    await fs.appendFile(sourcePath, Buffer.from("changed"));
    await expect(store.approvePdfImport(staging.id)).rejects.toThrow("Source PDF changed after preview");
    expect(await store.listSources()).toHaveLength(0);
  });

});


it("classifies taxonomy from content rather than the filename", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "sigma-knowledge-db-content-taxonomy-"));
  tempDirs.push(dataDir);
  const filePath = path.join(dataDir, "random-name.md");
  await fs.writeFile(filePath, "# 三角関数\\n\\n数学Ⅱの三角関数について、正弦定理と余弦定理を説明する。", "utf8");
  const store = createStore(dataDir);
  const [source] = await store.addFiles([filePath]);
  await store.search("正弦定理", 5);
  const indexed = (await store.listSources()).find((item) => item.id === source?.id);
  expect(indexed?.pages[0]?.taxonomyPaths?.some((taxonomyPath) => taxonomyPath.includes("数学II"))).toBe(true);
});

it("imports non-PDF files into the global Knowledge DB and indexes their text", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "sigma-knowledge-db-file-types-"));
  tempDirs.push(dataDir);
  const filePath = path.join(dataDir, "notes.md");
  await fs.writeFile(filePath, "# 数学II 三角関数\\n\\n正弦定理と余弦定理のメモ", "utf8");
  const store = createStore(dataDir);
  const [source] = await store.addFiles([filePath]);
  expect(source?.mimeType).toBe("text/markdown");
  expect(source?.pageCount).toBe(1);
  await store.search("正弦定理", 5);
  const indexed = (await store.listSources()).find((item) => item.id === source?.id);
  expect(indexed?.pages[0]?.text).toContain("正弦定理");
  expect(indexed?.pages[0]?.analysisStatus).toBe("analyzed");
  expect(indexed?.pages[0]?.taxonomyPaths?.length).toBeGreaterThan(0);
  expect(indexed?.pages[0]?.taxonomyPaths?.some((taxonomyPath) => taxonomyPath.includes("三角関数"))).toBe(true);
  expect((await store.search("正弦定理", 5)).some((item) => item.sourceId === source?.id)).toBe(true);
});

describe("Knowledge DB large-library resilience", () => {
  it("searches a multi-thousand-page library without unbounded result growth", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "sigma-knowledge-db-large-"));
    tempDirs.push(dataDir);
    const sourceCount = 25;
    const pagesPerSource = 100;
    const now = new Date().toISOString();
    const sources = Array.from({ length: sourceCount }, (_, sourceIndex) => ({
      id: `src_large_${sourceIndex}`,
      name: `large-${sourceIndex}.md`,
      originalPath: "",
      storedPath: "",
      mimeType: "text/markdown",
      sizeBytes: 0,
      pageCount: pagesPerSource,
      importedAt: now,
      updatedAt: now,
      extractionStatus: "complete",
      pages: Array.from({ length: pagesPerSource }, (_, pageIndex) => ({
        id: `src_large_${sourceIndex}_p${pageIndex + 1}`,
        sourceId: `src_large_${sourceIndex}`,
        pageNumber: pageIndex + 1,
        semanticType: "unknown",
        text: pageIndex === 73 && sourceIndex === 12
          ? "数学II 三角関数 加法定理 正弦定理"
          : `一般教材本文 source ${sourceIndex} page ${pageIndex + 1}`,
        extractionStatus: "text",
        analysisStatus: "analyzed",
        analysisVersion: KNOWLEDGE_ANALYSIS_VERSION,
        taxonomyVersion: KNOWLEDGE_TAXONOMY_VERSION,
      })),
    }));
    seedLibrary(dataDir, { version: 3, sources });

    const store = createStore(dataDir);
    const results = await store.search("三角関数 加法定理", 12);

    expect(results.length).toBeLessThanOrEqual(12);
    expect(results.some((result) => result.sourceId === "src_large_12" && result.pageNumber === 74)).toBe(true);
    expect((await store.listSources()).flatMap((source) => source.pages)).toHaveLength(sourceCount * pagesPerSource);
  });
});

describe("global library", () => {
  it("shares sources across all app contexts", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "sigma-knowledge-db-global-"));
    tempDirs.push(dataDir);
    const sourcePath = await createPdf("global.pdf", 1);
    const store = createStore(dataDir);
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
    const store = createStore(dataDir);
    const [source] = await store.addFiles([sourcePath]);
    expect(source).toBeTruthy();
    await store.search("warmup", 1);
    const library = await readLibraryFixture(dataDir) as { sources: Array<{ pages: KnowledgePage[] }> };
    library.sources[0].pages[0].text = "数学Ⅱ 三角関数 定理";
    library.sources[0].pages[0].analysisStatus = "stale";
    library.sources[0].pages[0].analysisVersion = 0;
    seedLibrary(dataDir, library);

    await store.search("三角関数", 1);
    const refreshed = await store.listSources();
    const page = refreshed[0]!.pages[0]!;
    expect(page.analysisStatus).toBe("analyzed");
    expect(page.analysisVersion).toBeGreaterThan(0);
    expect(page.taxonomyPaths?.some((path) => path.includes("数学II"))).toBe(true);
  });

  it("reports analysis lifecycle state and can reanalyze without reimporting the PDF", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "sigma-knowledge-db-reanalyze-"));
    tempDirs.push(dataDir);
    const sourcePath = await createPdf("reanalyze.pdf", 1);
    const store = createStore(dataDir);
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
    const store = createStore(dataDir);
    const [source] = await store.addFiles([sourcePath]);
    expect(source).toBeTruthy();
    await store.search("warmup", 1);
    const library = await readLibraryFixture(dataDir) as {
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
    seedLibrary(dataDir, library);

    const context = await store.getContext("数学Ⅱ 三角関数 定理", 8, undefined, 600);
    expect(context.length).toBeGreaterThan(0);
    expect(context.reduce((sum, item) => sum + item.text.length, 0)).toBeLessThanOrEqual(600);
    expect(new Set(context.map((item) => `${item.sourceId}:${item.pageNumber}`)).size).toBe(context.length);
    expect(context[0]?.citation).toContain("sigma://knowledge-db/");
    expect(context[0]?.matchReasons?.length).toBeGreaterThan(0);
  });

  it("adds cross-source evidence without spending a second database search", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "sigma-knowledge-db-cross-source-"));
    tempDirs.push(dataDir);
    const firstPath = path.join(dataDir, "first.md");
    const secondPath = path.join(dataDir, "second.md");
    await fs.writeFile(firstPath, "三角関数を説明する本文。", "utf8");
    await fs.writeFile(secondPath, "三角関数を別資料から補足する本文。", "utf8");
    const store = createStore(dataDir);
    const sources = await store.addFiles([firstPath, secondPath]);
    expect(sources).toHaveLength(2);
    await store.search("warmup", 2);
    const library = await readLibraryFixture(dataDir) as {
      sources: Array<{ id: string; pages: KnowledgePage[] }>;
    };
    library.sources[0]!.pages[0]!.text = "三角関数の定理を説明する本文。";
    library.sources[1]!.pages[0]!.text = "三角関数の定理と公式を別資料から補足する本文。";
    seedLibrary(dataDir, library);

    const index = createVectorIndex(dataDir);
    await index.removeSource(sources[0]!.id);
    await index.removeSource(sources[1]!.id);
    await index.upsertMany([
      { id: sources[0]!.id + "_p1_c0", sourceId: sources[0]!.id, pageNumber: 1, chunkIndex: 0, text: "三角関数を説明する本文。" },
      { id: sources[1]!.id + "_p1_c0", sourceId: sources[1]!.id, pageNumber: 1, chunkIndex: 0, text: "三角関数を別資料から補足する本文。" },
    ]);

    const context = await store.getContext("三角関数", 2, undefined, 4000);
    expect(context).toHaveLength(2);
    expect(context[0]?.relation).toBe("primary");
    expect(context[1]?.relation).toBe("related");
    expect(context[1]?.matchReasons).toContain("関連ソース");
    expect(context[1]?.sourceId).not.toBe(context[0]?.sourceId);
  });

  it("adds a nearby page as related evidence when it shares the local context", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "sigma-knowledge-db-related-context-"));
    tempDirs.push(dataDir);
    const sourcePath = await createPdf("related.pdf", 2);
    const store = createStore(dataDir);
    const [source] = await store.addFiles([sourcePath]);
    expect(source).toBeTruthy();
    await store.search("warmup", 1);
    const library = await readLibraryFixture(dataDir) as {
      sources: Array<{ pages: KnowledgePage[] }>;
    };
    library.sources[0]!.pages[0]!.text = "三角関数の定理を説明する本文。";
    library.sources[0]!.pages[0]!.taxonomyPaths = [["数学Ⅱ", "三角関数"]];
    library.sources[0]!.pages[1]!.text = "公式と証明を補足する本文。";
    library.sources[0]!.pages[1]!.taxonomyPaths = [["数学Ⅱ", "三角関数"]];
    seedLibrary(dataDir, library);

    const index = createVectorIndex(dataDir);
    await index.removeSource(source!.id);
    await index.upsertMany([
      { id: source!.id + "_p1_c0", sourceId: source!.id, pageNumber: 1, chunkIndex: 0, text: "三角関数を説明する本文。" },
      { id: source!.id + "_p2_c0", sourceId: source!.id, pageNumber: 2, chunkIndex: 0, text: "公式と証明を補足する本文。" },
    ]);

    const context = await store.getContext("三角関数の定理", 4, undefined, 2000);
    expect(context.length).toBe(2);
    expect(context[0]?.relation).toBe("primary");
    expect(context[1]?.relation).toBe("related");
    expect(context[1]?.relatedTo).toBe(`${source!.id}:1`);
    expect(context[1]?.pageNumber).toBe(2);
  });
});

describe("Knowledge DB RAG retrieval quality", () => {
  it("supports Japanese character-bigram recall and configured search aliases", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "sigma-knowledge-db-alias-"));
    tempDirs.push(dataDir);
    const filePath = path.join(dataDir, "ai.md");
    await fs.writeFile(filePath, "AI（人工知能）と検索拡張生成（RAG）について説明する。", "utf8");
    const store = createStore(dataDir);
    const [source] = await store.addFiles([filePath]);
    const japanese = await store.search("人工知能", 5);
    expect(japanese[0]?.sourceId).toBe(source?.id);
  });

  it("selects compact primary evidence and preserves a cross-source related citation", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "sigma-knowledge-db-diverse-context-"));
    tempDirs.push(dataDir);
    const firstPath = path.join(dataDir, "first.md");
    const secondPath = path.join(dataDir, "second.md");
    const thirdPath = path.join(dataDir, "third.md");
    await fs.writeFile(firstPath, "検索拡張生成の基本説明と一次資料。", "utf8");
    await fs.writeFile(secondPath, "検索拡張生成の評価方法を補足する資料。", "utf8");
    await fs.writeFile(thirdPath, "検索拡張生成の別の実装例を紹介する資料。", "utf8");
    const store = createStore(dataDir);
    const sources = await store.addFiles([firstPath, secondPath, thirdPath]);
    expect(sources).toHaveLength(3);
    const context = await store.getContext("検索拡張生成", 4, undefined, 5000);
    expect(context.length).toBeGreaterThan(1);
    expect(context[0]?.relation).toBe("primary");
    expect(context.some((item) => item.relation === "related" && item.matchReasons?.includes("関連ソース"))).toBe(true);
    expect(new Set(context.map((item) => item.sourceId)).size).toBeGreaterThan(1);
  });
});

describe("Knowledge DB write safety", () => {
  it("rejects a stale read-modify-write instead of losing a concurrent update", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "sigma-knowledge-db-conflict-"));
    tempDirs.push(dataDir);
    const firstPath = path.join(dataDir, "first.md");
    const secondPath = path.join(dataDir, "second.md");
    await fs.writeFile(firstPath, "最初の資料", "utf8");
    await fs.writeFile(secondPath, "追加の資料", "utf8");
    const first = createStore(dataDir);
    const second = createStore(dataDir);
    await first.addFiles([firstPath]);
    const secondInternal = second as unknown as {
      readLibrary: () => Promise<{ sources: KnowledgeSource[]; __fingerprint?: string }>;
      writeLibrary: (library: { version: 3; sources: KnowledgeSource[]; __fingerprint?: string }) => Promise<void>;
    };
    const stale = await secondInternal.readLibrary();
    expect(stale.sources).toHaveLength(1);
    await first.addFiles([secondPath]);
    await expect(secondInternal.writeLibrary({ version: 3, sources: stale.sources, __fingerprint: stale.__fingerprint })).rejects.toThrow("changed concurrently");
    expect((await first.listSources()).map((source) => source.name)).toEqual(expect.arrayContaining(["first.md", "second.md"]));
  });
});

describe("Knowledge DB smart split", () => {
  it("previews taxonomy boundaries and materializes child PDFs", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "sigma-knowledge-smart-split-"));
    tempDirs.push(dataDir);
    const sourcePath = await createPdf("mixed.pdf", 4);
    const store = createStore(dataDir);
    const [source] = await store.addFiles([sourcePath]);
    expect(source).toBeTruthy();
    const library = await readLibraryFixture(dataDir) as { sources: Array<{ pages: KnowledgePage[] }> };
    library.sources[0]!.pages.forEach((page, index) => {
      page.text = index < 2 ? "数学Ⅱ 三角関数" : "物理 力学";
      page.taxonomyPaths = index < 2 ? [["数学", "数学II", "三角関数"]] : [["理科", "物理", "力学"]];
      page.taxonomyConfidence = 0.92;
    });
    seedLibrary(dataDir, library);

    const preview = await store.previewSmartSplit(source!.id);
    expect(preview.segments).toHaveLength(2);
    expect(preview.segments[0]?.startPage).toBe(1);
    expect(preview.segments[0]?.endPage).toBe(2);
    expect(preview.segments[1]?.startPage).toBe(3);
    expect(preview.segments[1]?.endPage).toBe(4);

    const children = await store.materializeSmartSplit(source!.id, preview.segments.map((segment) => ({
      startPage: segment.startPage,
      endPage: segment.endPage,
      name: segment.paths[0]?.at(-1),
    })));
    expect(children).toHaveLength(2);
    expect(children.map((item) => item.pageCount)).toEqual([2, 2]);
    expect((await store.listSources()).filter((item) => item.id !== source!.id)).toHaveLength(2);
  });
});

describe("Knowledge DB classification review", () => {
  it("confirms matching AI classification and preserves the local taxonomy on conflict", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "sigma-knowledge-db-review-"));
    tempDirs.push(dataDir);
    const filePath = path.join(dataDir, "review.md");
    await fs.writeFile(filePath, "# 三角関数\n\n数学Ⅱの三角関数について説明する。", "utf8");
    const store = createStore(dataDir);
    const [source] = await store.addFiles([filePath]);
    await store.search("三角関数", 5);
    const page = (await store.listSources()).find((item) => item.id === source?.id)?.pages[0];
    expect(page?.taxonomyPaths?.[0]).toEqual(["数学", "数学II", "三角関数"]);

    const confirmed = await store.applyClassificationReview({
      sourceId: source!.id,
      pageNumber: 1,
      paths: [["数学", "数学II", "三角関数"]],
      confidence: 0.94,
      reason: "本文に数学Ⅱと三角関数が明記されている。",
      evidence: ["数学Ⅱの三角関数について説明する。"],
    });
    expect(confirmed.status).toBe("confirmed");

    const conflict = await store.applyClassificationReview({
      sourceId: source!.id,
      pageNumber: 1,
      paths: [["理科", "物理", "力学"]],
      confidence: 0.91,
    });
    expect(conflict.status).toBe("needs-review");
    const after = (await store.listSources()).find((item) => item.id === source?.id)?.pages[0];
    expect(after?.taxonomyPaths?.[0]).toEqual(["数学", "数学II", "三角関数"]);
    expect(after?.classificationReviewStatus).toBe("needs-review");
  });
});