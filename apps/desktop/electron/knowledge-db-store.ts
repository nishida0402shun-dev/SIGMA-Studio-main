import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import { LocalVectorIndex, type VectorSearchResult } from "./local-vector-index";
import { KnowledgeStructureParser, type KnowledgeStructureBlock, type KnowledgeStructureBlockType, type StructureParserStatus } from "./knowledge-db-structure-parser";
import { analyzeKnowledgePage, KNOWLEDGE_ANALYSIS_VERSION } from "./knowledge-analysis-engine";
import { classifyKnowledgeTaxonomy, KNOWLEDGE_TAXONOMY_VERSION } from "./knowledge-taxonomy";

export type KnowledgeSemanticType =
  | "problem" | "example" | "explanation" | "column" | "definition"
  | "theorem" | "answer" | "figure" | "unknown";

export interface KnowledgePage {
  id: string;
  sourceId: string;
  pageNumber: number;
  semanticType: KnowledgeSemanticType;
  title?: string;
  text?: string;
  extractionStatus?: "text" | "ocr-needed" | "empty";
  wordCount?: number;
  structureBlocks?: KnowledgeStructureBlock[];
  keywords?: string[];
  analysisSignals?: string[];
  analysisStatus?: "pending" | "processing" | "analyzed" | "stale" | "failed";
  analysisVersion?: number;
  analysisError?: string;
  taxonomyNodeIds?: string[];
  taxonomyPaths?: string[][];
  taxonomyConfidence?: number;
  taxonomyVersion?: number;
}

interface KnowledgeSearchResult extends VectorSearchResult {
  sourceName: string;
  matchReasons: string[];
  citationRegions?: Array<{
    type: KnowledgeStructureBlockType;
    text: string;
    bbox?: [number, number, number, number];
    confidence?: number;
  }>;
}

export interface KnowledgeSource {
  id: string;
  name: string;
  originalPath: string;
  storedPath: string;
  mimeType: string;
  sizeBytes: number;
  pageCount: number;
  importedAt: string;
  updatedAt: string;
  contentHash?: string;
  pages: KnowledgePage[];
  extractionStatus?: "complete" | "partial" | "ocr-needed";
  indexedAt?: string;
  indexError?: string;
}

interface KnowledgeLibrary {
  version: 3;
  sources: KnowledgeSource[];
}

export interface KnowledgeRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface KnowledgeIndexStatus {
  state: "idle" | "running" | "completed" | "failed";
  total: number;
  completed: number;
  currentSourceId?: string;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
}

export class KnowledgeDbStore {
  private readonly dataDir: string;
  private indexPromise: Promise<void> | null = null;
  private indexStatus: KnowledgeIndexStatus = { state: "idle", total: 0, completed: 0 };
  private readonly structureParser = new KnowledgeStructureParser();
  private structureParserStatusPromise: Promise<StructureParserStatus> | null = null;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  async listSources(): Promise<KnowledgeSource[]> {
    const library = await this.readLibrary();
    return library.sources;
  }

  async getAnalysisStatus(): Promise<{
    totalPages: number;
    analyzed: number;
    pending: number;
    processing: number;
    stale: number;
    failed: number;
    ocrNeeded: number;
    taxonomyCurrent: number;
    taxonomyStale: number;
  }> {
    const library = await this.readLibrary();
    const pages = library.sources.flatMap((source) => source.pages);
    const count = (status: KnowledgePage["analysisStatus"]) => pages.filter((page) => page.analysisStatus === status).length;
    return {
      totalPages: pages.length,
      analyzed: count("analyzed"),
      pending: count("pending"),
      processing: count("processing"),
      stale: count("stale"),
      failed: count("failed"),
      ocrNeeded: pages.filter((page) => page.extractionStatus === "ocr-needed").length,
      taxonomyCurrent: pages.filter((page) => page.taxonomyVersion === KNOWLEDGE_TAXONOMY_VERSION).length,
      taxonomyStale: pages.filter((page) => page.taxonomyVersion !== KNOWLEDGE_TAXONOMY_VERSION).length,
    };
  }

  async reanalyze(sourceIds?: string[]): Promise<KnowledgeIndexStatus> {
    const library = await this.readLibrary();
    const allowed = sourceIds?.length ? new Set(sourceIds) : null;
    let changed = false;
    for (const source of library.sources) {
      if (allowed && !allowed.has(source.id)) continue;
      source.pages = source.pages.map((page) => page.text
        ? { ...page, analysisStatus: "stale", analysisVersion: 0, taxonomyVersion: 0, analysisError: undefined }
        : page);
      source.updatedAt = new Date().toISOString();
      changed = true;
    }
    if (changed) await this.writeLibrary(library);
    return this.startBackgroundIndexing();
  }

  getIndexStatus(): KnowledgeIndexStatus {
    return { ...this.indexStatus };
  }

  async getStructureParserStatus(): Promise<StructureParserStatus> {
    this.structureParserStatusPromise ??= this.structureParser.getStatus();
    return this.structureParserStatusPromise;
  }

  startBackgroundIndexing(): KnowledgeIndexStatus {
    if (!this.indexPromise) {
      this.indexPromise = this.ensureIndexed()
        .then(() => { this.indexStatus = { ...this.indexStatus, state: "completed", finishedAt: new Date().toISOString() }; })
        .catch((error) => { this.indexStatus = { ...this.indexStatus, state: "failed", error: error instanceof Error ? error.message : String(error), finishedAt: new Date().toISOString() }; })
        .finally(() => { this.indexPromise = null; });
    }
    return this.getIndexStatus();
  }

  async addFiles(filePaths: string[]): Promise<KnowledgeSource[]> {
    const paths = this.paths();
    const library = await this.readLibrary();
    const added: KnowledgeSource[] = [];

    for (const filePath of filePaths) {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) continue;
      const bytes = await fs.readFile(filePath);
      const contentHash = createHash("sha256").update(bytes).digest("hex");
      if (library.sources.some((source) => source.contentHash === contentHash)) {
        continue;
      }

      const extension = path.extname(filePath).toLowerCase();
      const pdf = extension === ".pdf" ? await PDFDocument.load(bytes, { ignoreEncryption: false }) : null;
      const id = `src_${randomUUID()}`;
      const storedPath = path.join(paths.sourcesDir, `${id}${extension || ".bin"}`);
      const now = new Date().toISOString();
      const source: KnowledgeSource = {
        id,
        name: path.basename(filePath),
        originalPath: filePath,
        storedPath,
        mimeType: mimeTypeForExtension(extension),
        sizeBytes: stat.size,
        pageCount: pdf?.getPageCount() ?? 1,
        importedAt: now,
        updatedAt: now,
        contentHash,
        extractionStatus: "ocr-needed",
        pages: Array.from({ length: pdf?.getPageCount() ?? 1 }, (_, index) => ({
          id: `${id}_p${index + 1}`,
          sourceId: id,
          pageNumber: index + 1,
          semanticType: "unknown",
          extractionStatus: "ocr-needed",
          wordCount: 0,
          analysisStatus: "pending",
          analysisVersion: 0,
        })),
      };

      await fs.mkdir(paths.sourcesDir, { recursive: true });
      try {
        await fs.copyFile(filePath, storedPath);
        library.sources.unshift(source);
        await this.writeLibrary(library);
        added.push(source);
      } catch (error) {
        await fs.rm(storedPath, { force: true });
        await this.vectorIndex().removeSource(source.id);
        throw error;
      }
    }
    this.startBackgroundIndexing();
    return added;
  }

  async search(query: string, limit = 12): Promise<KnowledgeSearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    if (this.indexPromise) await this.indexPromise;
    else await this.ensureIndexed();
    const library = await this.readLibrary();
    const safeLimit = Math.max(1, Math.min(limit, 50));
    const matches = await this.vectorIndex().search(trimmed, Math.min(50, safeLimit * 5));
    const bestByPage = new Map<string, (typeof matches)[number]>();
    for (const match of matches) {
      const current = bestByPage.get(`${match.sourceId}:${match.pageNumber}`);
      if (!current || match.score > current.score) bestByPage.set(`${match.sourceId}:${match.pageNumber}`, match);
    }
    const queryTokens = tokenizeForSearch(trimmed);
    const sourceNames = new Map(library.sources.map((source) => [source.id, source.name]));
    const pages = new Map(
      library.sources.flatMap((source) => source.pages.map((page) => [`${source.id}:${page.pageNumber}`, page] as const)),
    );
    return [...bestByPage.values()]
      .map((match) => {
        const lexical = lexicalScore(match.text, queryTokens);
        const page = pages.get(`${match.sourceId}:${match.pageNumber}`);
        const metadata = page ? metadataScore(page, trimmed, queryTokens) : 0;
        const matchReasons = page ? retrievalMatchReasons(page, trimmed, queryTokens, match.score, lexical, metadata) : [];
        return {
          ...match,
          score: match.score * 0.65 + lexical * 0.20 + metadata * 0.15,
          matchReasons,
          ...(page ? {
            semanticType: page.semanticType,
            title: page.title,
            keywords: page.keywords,
            analysisSignals: page.analysisSignals,
            taxonomyPaths: page.taxonomyPaths,
            citationRegions: selectCitationRegions(page, match.text),
          } : {}),
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, safeLimit)
      .map((match) => ({ ...match, sourceName: sourceNames.get(match.sourceId) ?? match.sourceId }));
  }

  async getContext(query: string, limit = 8, sourceIds?: string[], maxChars = 16000): Promise<KnowledgeContextItem[]> {
    const allowed = sourceIds?.length ? new Set(sourceIds) : null;
    const results = (await this.search(query, Math.min(50, Math.max(limit * 3, limit))))
      .filter((result) => !allowed || allowed.has(result.sourceId))
      .slice(0, Math.max(1, Math.min(limit, 20)));
    const items: KnowledgeContextItem[] = [];
    const seenPages = new Set<string>();
    let usedChars = 0;
    for (const result of results) {
      const pageKey = `${result.sourceId}:${result.pageNumber}`;
      if (seenPages.has(pageKey)) continue;
      const { source, page } = await this.getPage(result.sourceId, result.pageNumber);
      const structureText = page.structureBlocks?.map((block) => `[${block.type}] ${block.text}`).join("\n") ?? "";
      const analysisText = [
        page.title ? `[title] ${page.title}` : "",
        page.semanticType !== "unknown" ? `[type] ${page.semanticType}` : "",
        page.keywords?.length ? `[keywords] ${page.keywords.join(", ")}` : "",
      ].filter(Boolean).join("\n");
      const text = [analysisText, result.text.trim() || page.text?.trim() || structureText]
        .filter(Boolean)
        .join("\n");
      if (!text) continue;
      const item: KnowledgeContextItem = {
        id: result.id,
        sourceId: source.id,
        pageId: page.id,
        sourceName: source.name,
        pageNumber: page.pageNumber,
        semanticType: page.semanticType,
        taxonomyPaths: page.taxonomyPaths,
        taxonomyConfidence: page.taxonomyConfidence,
        analysisStatus: page.analysisStatus,
        score: result.score,
        text: text.slice(0, 5000),
        citation: `[${source.name} p${page.pageNumber}](sigma://knowledge-db/${encodeURIComponent(source.id)}/p/${page.pageNumber})`,
        matchReasons: result.matchReasons,
        citationRegions: selectCitationRegions(page, result.text),
        citationRef: { sourceId: source.id, pageId: page.id, pageNumber: page.pageNumber },
      };
      const remaining = Math.max(0, maxChars - usedChars);
      if (remaining <= 0) break;
      const boundedText = item.text.slice(0, remaining);
      if (!boundedText.trim()) break;
      item.text = boundedText;
      item.contextChars = boundedText.length;
      items.push(item);
      seenPages.add(pageKey);
      usedChars += boundedText.length;
      if (usedChars >= maxChars) break;
    }
    return items;
  }

  async getRelatedSources(sourceId: string, limit = 6): Promise<Array<{ sourceId: string; sourceName: string; score: number; pageNumber: number }>> {
    const source = await this.findSource(sourceId);
    const query = source.pages
      .map((page) => page.text?.trim())
      .filter((text): text is string => Boolean(text))
      .slice(0, 3)
      .join(" ")
      .slice(0, 4000);
    if (!query) return [];
    const matches = await this.search(query, Math.min(50, Math.max(limit * 4, limit)));
    const seen = new Set<string>();
    return matches
      .filter((match) => match.sourceId !== sourceId && !seen.has(match.sourceId))
      .map((match) => {
        seen.add(match.sourceId);
        return {
          sourceId: match.sourceId,
          sourceName: match.sourceName,
          score: match.score,
          pageNumber: match.pageNumber,
        };
      })
      .slice(0, Math.max(1, Math.min(limit, 20)));
  }

  async getPage(sourceId: string, pageNumber: number): Promise<{ source: KnowledgeSource; page: KnowledgePage }> {
    const source = await this.findSource(sourceId);
    const page = source.pages.find((item) => item.pageNumber === pageNumber);
    if (!page) throw new Error("knowledge page not found");
    return { source, page };
  }

  async deleteSource(sourceId: string): Promise<boolean> {
    const paths = this.paths();
    const library = await this.readLibrary();
    const source = library.sources.find((item) => item.id === sourceId);
    if (!source) return false;
    await this.vectorIndex().removeSource(source.id);
    await fs.rm(source.storedPath, { force: true });
    library.sources = library.sources.filter((item) => item.id !== sourceId);
    await this.writeLibrary(library);
    await fs.rm(path.join(paths.openedPagesDir, `${safeId(source.id)}-`), { force: true }).catch(() => {});
    return true;
  }

  async getPagePdfBase64(sourceId: string, pageNumber: number): Promise<{ dataBase64: string; width: number; height: number }> {
    const { source } = await this.getPage(sourceId, pageNumber);
    const bytes = await fs.readFile(source.storedPath);
    const input = await PDFDocument.load(bytes);
    const page = input.getPage(pageNumber - 1);
    if (!page) throw new Error("knowledge page not found");
    const { width, height } = page.getSize();
    return { dataBase64: Buffer.from(bytes).toString("base64"), width, height };
  }

  async extractRegion(sourceId: string, pageNumber: number, rect: KnowledgeRegion): Promise<string> {
    const { source } = await this.getPage(sourceId, pageNumber);
    const bytes = await fs.readFile(source.storedPath);
    const input = await PDFDocument.load(bytes);
    const sourcePage = input.getPage(pageNumber - 1);
    if (!sourcePage) throw new Error("knowledge page not found");
    const pageSize = sourcePage.getSize();
    if (!(rect.width > 0) || !(rect.height > 0) || rect.x < 0 || rect.y < 0) throw new Error("invalid region request");
    if (rect.x >= pageSize.width || rect.y >= pageSize.height) throw new Error("invalid region request");
    const width = Math.min(rect.width, pageSize.width - rect.x);
    const height = Math.min(rect.height, pageSize.height - rect.y);
    if (!(width > 0) || !(height > 0)) throw new Error("invalid region request");
    const output = await PDFDocument.create();
    const copied = await output.copyPages(input, [pageNumber - 1]);
    const page = copied[0];
    if (!page) throw new Error("knowledge page not found");
    page.setCropBox(rect.x, rect.y, width, height);
    page.setMediaBox(rect.x, rect.y, width, height);
    output.addPage(page);
    const paths = this.paths();
    await fs.mkdir(paths.openedPagesDir, { recursive: true });
    const outputPath = path.join(paths.openedPagesDir, `${safeId(source.id)}-p${pageNumber}-region.pdf`);
    await fs.writeFile(outputPath, await output.save());
    return outputPath;
  }

  async openPage(sourceId: string, pageNumber: number): Promise<string> {
    const { source } = await this.getPage(sourceId, pageNumber);
    if (source.mimeType !== "application/pdf") {
      if (pageNumber !== 1) throw new Error("non-PDF sources have only one openable page");
      return source.storedPath;
    }
    const bytes = await fs.readFile(source.storedPath);
    const input = await PDFDocument.load(bytes);
    const output = await PDFDocument.create();
    const copied = await output.copyPages(input, [pageNumber - 1]);
    const page = copied[0];
    if (!page) throw new Error("knowledge page not found");
    output.addPage(page);
    const paths = this.paths();
    await fs.mkdir(paths.openedPagesDir, { recursive: true });
    const outputPath = path.join(paths.openedPagesDir, `${safeId(source.id)}-p${pageNumber}.pdf`);
    await fs.writeFile(outputPath, await output.save());
    return outputPath;
  }

  async extractPages(sourceId: string, pageNumbers: number[]): Promise<Uint8Array> {
    return this.extractSelectedPages([{ sourceId, pageNumbers }]);
  }

  async extractSelectedPages(selections: Array<{ sourceId: string; pageNumbers: number[] }>): Promise<Uint8Array> {
    const library = await this.readLibrary();
    const output = await PDFDocument.create();
    let copiedCount = 0;
    for (const selection of selections) {
      const source = library.sources.find((item) => item.id === selection.sourceId);
      if (!source) throw new Error("knowledge source not found");
      const sourceBytes = await fs.readFile(source.storedPath);
      const input = await PDFDocument.load(sourceBytes);
      const uniquePages = [...new Set(selection.pageNumbers)]
        .filter((page) => Number.isInteger(page) && page >= 1 && page <= input.getPageCount())
        .map((page) => page - 1);
      if (uniquePages.length === 0) continue;
      const copied = await output.copyPages(input, uniquePages);
      for (const page of copied) output.addPage(page);
      copiedCount += copied.length;
    }
    if (copiedCount === 0) throw new Error("no valid pages selected");
    return output.save();
  }

  async updatePageSemanticType(sourceId: string, pageNumber: number, semanticType: KnowledgeSemanticType, title?: string): Promise<KnowledgeSource> {
    const library = await this.readLibrary();
    const source = library.sources.find((item) => item.id === sourceId);
    if (!source) throw new Error("knowledge source not found");
    const page = source.pages.find((item) => item.pageNumber === pageNumber);
    if (!page) throw new Error("knowledge page not found");
    page.semanticType = semanticType;
    if (title !== undefined) page.title = title;
    source.updatedAt = new Date().toISOString();
    await this.writeLibrary(library);
    return source;
  }

  private async ensureIndexed(): Promise<KnowledgeSource[]> {
    const library = await this.readLibrary();
    const pending: KnowledgeSource[] = [];
    for (const source of library.sources) {
      const indexed = await this.vectorIndex().hasSource(source.id);
      const needsText = source.pages.some((page) => page.text === undefined);
      const needsAnalysis = source.pages.some((page) => Boolean(page.text) && (page.analysisVersion !== KNOWLEDGE_ANALYSIS_VERSION || page.analysisStatus !== "analyzed"));
      const needsTaxonomy = source.pages.some((page) => Boolean(page.text) && page.taxonomyVersion !== KNOWLEDGE_TAXONOMY_VERSION);
      if (needsText || needsAnalysis || needsTaxonomy || source.pages.some((page) => page.extractionStatus === "ocr-needed") || !indexed) {
        pending.push(source);
      }
    }
    this.indexStatus = { state: pending.length ? "running" : "completed", total: pending.length, completed: 0, startedAt: pending.length ? new Date().toISOString() : this.indexStatus.startedAt };
    let changed = false;
    for (const source of library.sources) {
      const needsText = source.pages.some((page) => page.text === undefined);
      const needsAnalysis = source.pages.some((page) => Boolean(page.text) && (page.analysisVersion !== KNOWLEDGE_ANALYSIS_VERSION || page.analysisStatus !== "analyzed"));
      const needsTaxonomy = source.pages.some((page) => Boolean(page.text) && page.taxonomyVersion !== KNOWLEDGE_TAXONOMY_VERSION);
      const needsIndex = !(await this.vectorIndex().hasSource(source.id));
      if (!needsText && !needsAnalysis && !needsTaxonomy && !needsIndex) { continue; }
      this.indexStatus = { ...this.indexStatus, currentSourceId: source.id };
      try {
        if (needsAnalysis) {
          source.pages = source.pages.map((page) => page.text
            ? { ...page, analysisStatus: "processing", analysisError: undefined }
            : page);
          changed = true;
          await this.writeLibrary(library);
        }
        if (needsText || needsAnalysis || needsTaxonomy) {
          const bytes = await fs.readFile(source.storedPath);
          const pageTexts = needsText
            ? await extractKnowledgeFilePageTexts(source.name, bytes, source.pageCount)
            : source.pages.map((page) => page.text ?? "");
          let structureResults: Awaited<ReturnType<KnowledgeStructureParser["parsePdf"]>> = [];
          const structureExtensions = new Set([".pdf", ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"]);
          const extension = path.extname(source.name).toLowerCase();
          if (structureExtensions.has(extension) && pageTexts.some((text) => !text.trim())) {
            const parserStatus = await this.getStructureParserStatus();
            if (parserStatus.available) {
              try {
                structureResults = extension === ".pdf"
                  ? await this.structureParser.parsePdf(source.storedPath)
                  : await this.structureParser.parseImage(source.storedPath);
              } catch (error) {
                source.indexError = error instanceof Error ? error.message : String(error);
              }
            }
          }
          const structureByPage = new Map(structureResults.map((result) => [result.pageNumber, result]));
          source.pages = source.pages.map((page, index) => {
            const nativeText = pageTexts[index]?.trim() ?? "";
            const structured = structureByPage.get(page.pageNumber);
            const blocks = structured?.blocks ?? [];
            const extractedContent = [nativeText, structured?.text ?? "", ...blocks.map((block) => block.text)]
              .map((value) => value.trim())
              .filter(Boolean)
              .join("\n");
            const text = extractedContent;
            const analysis = analyzeKnowledgePage(text, blocks);
            const classifiedTaxonomy = classifyKnowledgeTaxonomy(text, analysis.keywords);
            const taxonomy = classifiedTaxonomy.length ? classifiedTaxonomy : [{ nodeId: "other", path: ["その他"], score: 0, confidence: 0 }];
            return {
              ...page,
              text: text || undefined,
              semanticType: page.semanticType === "unknown" ? analysis.semanticType : page.semanticType,
              ...(page.title || !analysis.title ? {} : { title: analysis.title }),
              keywords: analysis.keywords,
              analysisSignals: analysis.signals,
              analysisStatus: "analyzed",
              analysisVersion: KNOWLEDGE_ANALYSIS_VERSION,
              analysisError: undefined,
              ...(taxonomy.length ? { taxonomyNodeIds: taxonomy.map((item) => item.nodeId), taxonomyPaths: taxonomy.map((item) => item.path), taxonomyConfidence: taxonomy[0]?.confidence ?? 0 } : { taxonomyNodeIds: [], taxonomyPaths: [], taxonomyConfidence: 0 }),
              taxonomyVersion: KNOWLEDGE_TAXONOMY_VERSION,
              extractionStatus: text ? "text" : "ocr-needed",
              wordCount: text ? countWords(text) : 0,
              ...(blocks.length ? { structureBlocks: blocks } : {}),
            };
          });
          source.extractionStatus = source.pages.every((page) => page.text) ? "complete" : "ocr-needed";
          source.updatedAt = new Date().toISOString();
          changed = true;
        }
        await this.vectorIndex().removeSource(source.id);
        await this.indexSource(source);
        source.indexedAt = new Date().toISOString();
        source.indexError = undefined;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        source.indexError = message;
        source.pages = source.pages.map((page) => page.text
          ? { ...page, analysisStatus: "failed", analysisError: message }
          : page);
        changed = true;
      }
      this.indexStatus = { ...this.indexStatus, completed: this.indexStatus.completed + 1 };
    }
    if (changed) await this.writeLibrary(library);
    return library.sources;
  }

  private async indexSource(source: KnowledgeSource): Promise<void> {
    const records = source.pages.flatMap((page) =>
      chunkText(page.text ?? "").map((text, chunkIndex) => ({
        id: `${page.id}_c${chunkIndex}`,
        sourceId: source.id,
        pageNumber: page.pageNumber,
        chunkIndex,
        text,
      })),
    );
    await this.vectorIndex().upsertMany(records);
  }

  private async findSource(sourceId: string): Promise<KnowledgeSource> {
    const library = await this.readLibrary();
    const source = library.sources.find((item) => item.id === sourceId);
    if (!source) throw new Error("knowledge source not found");
    return source;
  }

  private async readLibrary(): Promise<KnowledgeLibrary> {
    const paths = this.paths();
    await fs.mkdir(paths.root, { recursive: true });
    try {
      const parsed = JSON.parse(await fs.readFile(paths.libraryPath, "utf8")) as Partial<KnowledgeLibrary>;
      if (parsed.version === 3 && Array.isArray(parsed.sources)) {
        const sources = parsed.sources.map((source) => {
          const legacy = source as KnowledgeSource & { workspaceId?: unknown };
          const { workspaceId: _workspaceId, ...globalSource } = legacy;
          return globalSource as KnowledgeSource;
        });
        return { version: 3, sources };
      }
    } catch {}
    const library: KnowledgeLibrary = { version: 3, sources: [] };
    const legacyRoot = path.join(this.dataDir, "knowledge-db", "workspaces");
    const entries = await fs.readdir(legacyRoot, { withFileTypes: true }).catch(() => []);
    await fs.mkdir(paths.sourcesDir, { recursive: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      let parsed: any;
      try { parsed = JSON.parse(await fs.readFile(path.join(legacyRoot, entry.name, "library.json"), "utf8")); } catch { continue; }
      if (!Array.isArray(parsed.sources)) continue;
      for (const legacy of parsed.sources) {
        let bytes: Uint8Array;
        try { bytes = await fs.readFile(legacy.storedPath); } catch { continue; }
        const hash = legacy.contentHash || createHash("sha256").update(bytes).digest("hex");
        if (library.sources.some((source) => source.contentHash === hash)) continue;
        const id = library.sources.some((source) => source.id === legacy.id) ? `src_${randomUUID()}` : legacy.id;
        const storedPath = path.join(paths.sourcesDir, id + ".pdf");
        await fs.copyFile(legacy.storedPath, storedPath);
        library.sources.push({
          id,
          name: String(legacy.name ?? "Imported PDF"),
          originalPath: String(legacy.originalPath ?? ""),
          storedPath,
          mimeType: "application/pdf",
          sizeBytes: Number(legacy.sizeBytes ?? bytes.byteLength),
          pageCount: Number(legacy.pageCount ?? legacy.pages.length),
          importedAt: String(legacy.importedAt ?? new Date().toISOString()),
          updatedAt: String(legacy.updatedAt ?? legacy.importedAt ?? new Date().toISOString()),
          contentHash: hash,
          pages: legacy.pages.map((page: KnowledgePage) => ({
            id: id + "_p" + page.pageNumber,
            sourceId: id,
            pageNumber: page.pageNumber,
            semanticType: page.semanticType ?? "unknown",
            ...(page.title ? { title: page.title } : {}),
            ...(page.text ? { text: page.text } : {}),
          })),
        });
      }
    }
    return library;
  }

  private async writeLibrary(library: KnowledgeLibrary): Promise<void> {
    const paths = this.paths();
    await fs.mkdir(paths.root, { recursive: true });
    const tmp = `${paths.libraryPath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(library, null, 2), "utf8");
    await fs.rename(tmp, paths.libraryPath);
  }

  private paths() {
    const root = path.join(this.dataDir, "knowledge-db");
    return { root, libraryPath: path.join(root, "library.json"), sourcesDir: path.join(root, "sources"), openedPagesDir: path.join(root, "opened-pages") };
  }

  private vectorIndex(): LocalVectorIndex {
    return new LocalVectorIndex(path.join(this.paths().root, "vector-index"));
  }
}

async function extractPdfPageTexts(bytes: Uint8Array, pageCount: number): Promise<string[]> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = pdfjs.getDocument({ data: bytes });
    const document = await loadingTask.promise;
    const texts: string[] = [];
    for (let index = 1; index <= pageCount; index += 1) {
      const page = await document.getPage(index);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item && typeof item.str === "string" ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      texts.push(text);
      page.cleanup();
    }
    await document.destroy();
    return texts;
  } catch {
    return Array.from({ length: pageCount }, () => "");
  }
}

export interface KnowledgeContextItem {
  id: string;
  sourceId: string;
  pageId: string;
  sourceName: string;
  pageNumber: number;
  semanticType: KnowledgeSemanticType;
  taxonomyPaths?: string[][];
  taxonomyConfidence?: number;
  analysisStatus?: KnowledgePage["analysisStatus"];
  score: number;
  text: string;
  citation: string;
  matchReasons?: string[];
  contextChars?: number;
  citationRegions?: Array<{
    type: KnowledgeStructureBlockType;
    text: string;
    bbox?: [number, number, number, number];
    confidence?: number;
  }>;
  citationRef?: {
    sourceId: string;
    pageId: string;
    pageNumber: number;
  };
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/gu, "_").slice(0, 160) || "item";
}

function countWords(text: string): number {
  return text.normalize("NFKC").trim() ? text.normalize("NFKC").trim().split(/\\s+/u).length : 0;
}

function tokenizeForSearch(text: string): string[] {
  return text.normalize("NFKC").toLocaleLowerCase().match(/[\\p{L}\\p{N}][\\p{P}\\p{L}\\p{N}_-]*/gu) ?? [];
}

async function extractKnowledgeFilePageTexts(fileName: string, bytes: Uint8Array, pageCount: number): Promise<string[]> {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".pdf") return extractPdfPageTexts(bytes, pageCount);
  const textExtensions = new Set([".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".xml", ".html", ".htm", ".css", ".js", ".jsx", ".ts", ".tsx", ".yml", ".yaml", ".toml", ".ini", ".log", ".sql", ".tex", ".bib", ".svg", ".rst", ".org", ".properties", ".env", ".mjs", ".cjs", ".vue", ".svelte", ".py", ".java", ".c", ".h", ".cpp", ".hpp", ".cs", ".go", ".rs", ".swift", ".kt", ".kts", ".rb", ".php", ".sh", ".bash", ".zsh", ".fish", ".bat", ".cmd", ".ps1", ".graphql", ".gql"]);
  if (textExtensions.has(extension)) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/\\u0000/gu, "").trim();
    return [text];
  }
  if (extension === ".docx" || extension === ".xlsx" || extension === ".pptx" || extension === ".odt" || extension === ".ods" || extension === ".odp" || extension === ".epub") {
    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files).filter((name) => /\\.(?:xml|rels)$/u.test(name));
    const chunks: string[] = [];
    for (const name of names) {
      const entry = zip.files[name];
      if (!entry || entry.dir) continue;
      const xml = await entry.async("string");
      const text = xml.replace(/<[^>]+>/gu, " ").replace(/&amp;/gu, "&").replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/\\s+/gu, " ").trim();
      if (text) chunks.push(text);
    }
    return [chunks.join("\\n")];
  }
  const looksBinary = bytes.slice(0, Math.min(bytes.length, 4096)).some((byte) => byte === 0);
  if (!looksBinary) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/\\u0000/gu, "").trim();
    if (text) return [text];
  }
  return [`[ファイル] ${fileName}\\n[拡張子] ${extension || "(なし)"}\\n[サイズ] ${bytes.byteLength} bytes`];
}

function mimeTypeForExtension(extension: string): string {
  const types: Record<string, string> = {
    ".pdf": "application/pdf", ".txt": "text/plain", ".md": "text/markdown", ".csv": "text/csv", ".json": "application/json",
    ".html": "text/html", ".htm": "text/html", ".xml": "application/xml", ".svg": "image/svg+xml", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation", ".odt": "application/vnd.oasis.opendocument.text", ".ods": "application/vnd.oasis.opendocument.spreadsheet", ".odp": "application/vnd.oasis.opendocument.presentation", ".epub": "application/epub+zip",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
  };
  return types[extension] ?? "application/octet-stream";
}

function lexicalScore(text: string, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  const normalized = text.normalize("NFKC").toLocaleLowerCase();
  const hits = queryTokens.filter((token) => normalized.includes(token)).length;
  return Math.min(1, hits / queryTokens.length);
}

function metadataScore(page: KnowledgePage, query: string, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  const title = page.title?.normalize("NFKC").toLocaleLowerCase() ?? "";
  const keywords = (page.keywords ?? []).map((keyword) => keyword.normalize("NFKC").toLocaleLowerCase());
  const keywordHits = queryTokens.filter((token) => keywords.some((keyword) => keyword === token || keyword.includes(token))).length;
  const titleHits = queryTokens.filter((token) => title.includes(token)).length;
  let score = Math.max(
    keywordHits / queryTokens.length,
    titleHits / queryTokens.length,
  );

  const semanticType = semanticTypeFromQuery(query);
  if (semanticType && page.semanticType === semanticType) {
    score = Math.max(score, 1);
  }
  return Math.min(1, score);
}

function selectCitationRegions(page: KnowledgePage, matchedText: string): Array<{
  type: KnowledgeStructureBlockType;
  text: string;
  bbox?: [number, number, number, number];
  confidence?: number;
}> {
  const blocks = page.structureBlocks ?? [];
  if (blocks.length === 0) return [];
  const normalizedMatch = matchedText.normalize("NFKC").replace(/\s+/gu, "").toLocaleLowerCase();
  const scored = blocks.map((block, index) => {
    const normalizedBlock = block.text.normalize("NFKC").replace(/\s+/gu, "").toLocaleLowerCase();
    const overlap = normalizedMatch && normalizedBlock
      ? (normalizedBlock.includes(normalizedMatch) ? 1 : normalizedMatch.includes(normalizedBlock) ? 0.8 : 0)
      : 0;
    const semanticBoost = /^(table|figure|formula|title|caption)$/u.test(block.type) ? 0.1 : 0;
    return { block, score: overlap + semanticBoost, index };
  });
  return scored
    .filter(({ block }) => block.text.trim())
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 3)
    .map(({ block }) => ({
      type: block.type,
      text: block.text.slice(0, 500),
      ...(block.bbox ? { bbox: block.bbox } : {}),
      ...(block.confidence === undefined ? {} : { confidence: block.confidence }),
    }));
}

function retrievalMatchReasons(
  page: KnowledgePage,
  query: string,
  queryTokens: string[],
  vector: number,
  lexical: number,
  metadata: number,
): string[] {
  const reasons: string[] = [];
  if (vector >= 0.65) reasons.push("意味類似度が高い");
  if (lexical > 0) reasons.push(`本文一致 ${Math.round(lexical * 100)}%`);
  if (page.title && queryTokens.some((token) => page.title!.toLocaleLowerCase().includes(token))) reasons.push("タイトル一致");
  if ((page.keywords ?? []).some((keyword) => queryTokens.some((token) => keyword.toLocaleLowerCase().includes(token)))) reasons.push("キーワード一致");
  const semanticType = semanticTypeFromQuery(query);
  if (semanticType && page.semanticType === semanticType) reasons.push(`分類一致: ${semanticType}`);
  if (page.taxonomyPaths?.length) reasons.push(`分類: ${page.taxonomyPaths[0]!.join(" → ")}`);
  if (metadata >= 0.8 && reasons.length === 0) reasons.push("解析メタデータ一致");
  return reasons.slice(0, 5);
}

function semanticTypeFromQuery(query: string): KnowledgeSemanticType | undefined {
  const normalized = query.normalize("NFKC").toLocaleLowerCase();
  const rules: Array<[KnowledgeSemanticType, RegExp]> = [
    ["problem", /(?:問題|練習問題|演習|設問|例題|practice|exercise|problem|question)/u],
    ["example", /(?:例|具体例|example|worked example)/u],
    ["definition", /(?:定義|definition|defined as)/u],
    ["theorem", /(?:定理|命題|補題|系|theorem|proposition|lemma|corollary)/u],
    ["answer", /(?:解答|答え|解説付き解答|answer|solution)/u],
    ["column", /(?:コラム|column|note|豆知識)/u],
    ["explanation", /(?:解説|説明|考え方|ポイント|概説|explanation|overview|discussion)/u],
    ["figure", /(?:図|画像|figure|diagram|illustration)/u],
  ];
  return rules.find(([, pattern]) => pattern.test(normalized))?.[0];
}

function chunkText(text: string, maxLength = 900, overlap = 140): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  if (normalized.length <= maxLength) return [normalized];
  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    const end = Math.min(normalized.length, start + maxLength);
    const chunk = normalized.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= normalized.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}
