import fs from "node:fs/promises";
import path from "node:path";
import { KnowledgeLearningStore } from "./knowledge-learning-store";
import { createHash, randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import { LocalVectorIndex, type VectorSearchResult } from "./local-vector-index";
import { rerankKnowledgeCandidates } from "./knowledge-decision-reranker";
import { KnowledgeStructureParser, type KnowledgeStructureBlock, type KnowledgeStructureBlockType, type StructureParserStatus } from "./knowledge-db-structure-parser";
import { analyzeKnowledgePage, KNOWLEDGE_ANALYSIS_VERSION } from "./knowledge-analysis-engine";
import { classifyKnowledgeTaxonomy, KNOWLEDGE_TAXONOMY_VERSION } from "./knowledge-taxonomy";
import { analyzeKnowledgeVisualPage, KNOWLEDGE_VISUAL_ANALYSIS_VERSION, KNOWLEDGE_VISUAL_MODEL, shouldRunKnowledgeVisualAnalysis } from "./knowledge-multimodal";

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
  classificationReviewStatus?: "pending" | "confirmed" | "needs-review";
  classificationReviewPaths?: string[][];
  classificationReviewConfidence?: number;
  classificationReviewReason?: string;
  classificationReviewEvidence?: string[];
  visualPreviewPath?: string;
  visualAnalysis?: string;
  visualAnalysisModel?: string;
  visualAnalysisVersion?: number;
  visualAnalysisError?: string;
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
  /** Process-local snapshot fingerprint used to detect stale read-modify-write cycles. */
  __fingerprint?: string;
}

export interface KnowledgeRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface KnowledgeSmartSplitSegment {
  id: string;
  sourceId: string;
  startPage: number;
  endPage: number;
  paths: string[][];
  confidence: number;
  reason: string;
}


export interface KnowledgePdfImportSegmentProposal {
  id: string;
  startPage: number;
  endPage: number;
  name: string;
  paths: string[][];
  confidence: number;
  reason: string;
  selected: boolean;
}

export interface KnowledgePdfImportStaging {
  id: string;
  status: "draft" | "approved" | "rejected";
  sourcePath: string;
  sourceName: string;
  sourceHash: string;
  sizeBytes: number;
  pageCount: number;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  segments: KnowledgePdfImportSegmentProposal[];
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

function pageHasVisualBlocks(blocks: KnowledgeStructureBlock[] | undefined): boolean {
  return Boolean(blocks?.some((block) => block.type === "figure" || block.type === "table"));
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

  async recordLearningFeedback(input: { query: string; sourceId?: string; pageNumber?: number; label: "positive" | "negative" | "correction"; correction?: string }): Promise<unknown> {
    const store = new KnowledgeLearningStore(this.dataDir);
    return store.record(input);
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

  async analyzePageVisual(sourceId: string, pageNumber: number): Promise<KnowledgePage> {
    const library = await this.readLibrary();
    const source = library.sources.find((item) => item.id === sourceId);
    if (!source) throw new Error("knowledge source not found");
    const page = source.pages.find((item) => item.pageNumber === pageNumber);
    if (!page) throw new Error("knowledge page not found");

    try {
      const result = await analyzeKnowledgeVisualPage({
        filePath: source.storedPath,
        pageNumber,
        pageText: page.text?.split("\n[visual]\n")[0],
        dataDir: this.dataDir,
        force: true,
      });
      page.visualPreviewPath = result.previewPath;
      page.visualAnalysis = result.analysis || undefined;
      page.visualAnalysisModel = result.model;
      page.visualAnalysisVersion = result.version;
      page.visualAnalysisError = undefined;
      if (result.analysis?.trim()) {
        const baseText = page.text?.split("\n[visual]\n")[0]?.trim();
        const merged = [baseText, result.analysis.trim()].filter(Boolean).join("\n[visual]\n");
        page.text = merged;
        page.extractionStatus = "text";
        page.wordCount = countWords(merged);
        const analysis = analyzeKnowledgePage(merged, page.structureBlocks ?? []);
        page.semanticType = page.semanticType === "unknown" ? analysis.semanticType : page.semanticType;
        page.title ??= analysis.title;
        page.keywords = analysis.keywords;
        page.analysisSignals = [...new Set([...(page.analysisSignals ?? []), ...analysis.signals, "paddleocr-structure"])].slice(0, 20);
        page.analysisStatus = "analyzed";
        page.analysisVersion = KNOWLEDGE_ANALYSIS_VERSION;
        const taxonomy = classifyKnowledgeTaxonomy(merged, analysis.keywords);
        page.taxonomyNodeIds = taxonomy.map((item) => item.nodeId);
        page.taxonomyPaths = taxonomy.map((item) => item.path);
        page.taxonomyConfidence = taxonomy[0]?.confidence ?? 0;
        page.taxonomyVersion = KNOWLEDGE_TAXONOMY_VERSION;
      }
      source.updatedAt = new Date().toISOString();
      await this.writeLibrary(library);
      await this.vectorIndex().removeSource(source.id);
      await this.indexSource(source);
      source.indexedAt = new Date().toISOString();
      return page;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      page.visualAnalysisError = message;
      await this.writeLibrary(library);
      throw error;
    }
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

  async search(query: string, limit = 12, sourceIds?: string[]): Promise<KnowledgeSearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    if (this.indexPromise) await this.indexPromise;
    else await this.ensureIndexed();
    const library = await this.readLibrary();
    const allowedSources = sourceIds?.length ? new Set(sourceIds) : null;
    const safeLimit = Math.max(1, Math.min(limit, 50));
    const vectorMatches = (await this.vectorIndex().search(trimmed, Math.min(50, safeLimit * 5)))
      .filter((match) => !allowedSources || allowedSources.has(match.sourceId));
    const metadataQueryTokens = tokenizeForSearch(trimmed);
    const metadataMatches = library.sources.flatMap((source) => source.pages
      .filter(() => !allowedSources || allowedSources.has(source.id))
      .filter((page) => {
        const metadataHit = metadataScore(page, trimmed, metadataQueryTokens) > 0;
        const text = page.text?.normalize("NFKC").toLocaleLowerCase() ?? "";
        const lexicalHit = metadataQueryTokens.some((token) =>
          searchTokenVariants(token).some((variant) => text.includes(variant)),
        );
        return metadataHit || lexicalHit;
      })
      .map((page) => ({
        id: `${page.id}_metadata`,
        sourceId: source.id,
        pageNumber: page.pageNumber,
        chunkIndex: 0,
        text: page.text ?? "",
        score: 0.18,
      })));
    // Hybrid retrieval: keep independent semantic/vector and lexical/metadata candidate lists,
    // then fuse their ranks so a strong match from either retrieval channel cannot disappear
    // merely because the other channel scored it lower.
    const matches = [...vectorMatches, ...metadataMatches];
    const vectorRank = new Map<string, number>();
    vectorMatches.forEach((match, index) => vectorRank.set(`${match.sourceId}:${match.pageNumber}`, index + 1));
    const lexicalRanked = [...metadataMatches].sort((a, b) => b.score - a.score);
    const lexicalRank = new Map<string, number>();
    lexicalRanked.forEach((match, index) => lexicalRank.set(`${match.sourceId}:${match.pageNumber}`, index + 1));
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
    const searchablePages = library.sources
      .filter((source) => !allowedSources || allowedSources.has(source.id))
      .flatMap((source) => source.pages)
      .filter((page) => Boolean(page.text?.trim()));
    const documentFrequency = buildDocumentFrequency(searchablePages);
    const documentCount = Math.max(1, searchablePages.length);
    const learningStore = new KnowledgeLearningStore(this.dataDir);
    const learningFeedback = await learningStore.list(500);
    const ranked = [...bestByPage.values()].map((match) => {
      const lexical = lexicalScore(match.text, queryTokens, documentFrequency, documentCount);
      const exact = exactPhraseScore(match.text, trimmed);
      const page = pages.get(`${match.sourceId}:${match.pageNumber}`);
      const metadata = page ? metadataScore(page, trimmed, queryTokens) : 0;
      const semantic = page ? semanticQueryScore(page, queryTokens) : 0;
      const learning = learningFeedback.reduce((boost, item) => {
        if (item.sourceId && item.sourceId !== match.sourceId) return boost;
        if (item.pageNumber !== undefined && item.pageNumber !== match.pageNumber) return boost;
        const feedbackQuery = item.query.normalize("NFKC").toLocaleLowerCase();
        const currentQuery = trimmed.normalize("NFKC").toLocaleLowerCase();
        if (!(currentQuery === feedbackQuery || currentQuery.includes(feedbackQuery) || feedbackQuery.includes(currentQuery))) return boost;
        return boost + (item.label === "positive" ? 0.06 : item.label === "negative" ? -0.08 : -0.02);
      }, 0);
      const matchReasons = page ? retrievalMatchReasons(page, trimmed, queryTokens, match.score, lexical, metadata) : [];
      return {
        ...match,
        // Reciprocal-rank fusion is the backbone of the hybrid score; the remaining
        // signals refine ties and preserve exact/metadata intent.
        score: (
          (1 / (60 + (vectorRank.get(`${match.sourceId}:${match.pageNumber}`) ?? 1000))) * 0.52 +
          (1 / (60 + (lexicalRank.get(`${match.sourceId}:${match.pageNumber}`) ?? 1000))) * 0.28 +
          exact * 0.10 +
          metadata * 0.06 +
          semantic * 0.04 +
          learning
        ),
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
    });
    const baseRanked = ranked.sort((a, b) => b.score - a.score);
    const decisionRanked = await rerankKnowledgeCandidates(trimmed, baseRanked.slice(0, Math.min(12, Math.max(safeLimit * 2, 6))), this.dataDir);
    const decisionScores = new Map(decisionRanked.map((match) => [
      `${match.sourceId}:${match.pageNumber}:${match.chunkIndex}`,
      match.decisionScore,
    ]));
    const reranked = baseRanked
      .map((match) => {
        const decision = decisionScores.get(`${match.sourceId}:${match.pageNumber}:${match.chunkIndex}`);
        if (decision === undefined || decision <= 0) return match;
        return {
          ...match,
          score: match.score * 0.72 + decision * 0.28,
          matchReasons: [...match.matchReasons, `ローカル判定 ${Math.round(decision * 100)}%`].slice(0, 5),
        };
      })
      .sort((a, b) => b.score - a.score);

    return reranked
      .slice(0, safeLimit)
      .map((match) => ({ ...match, sourceName: sourceNames.get(match.sourceId) ?? match.sourceId }));
  }

  async getContext(query: string, limit = 8, sourceIds?: string[], maxChars = 16000): Promise<KnowledgeContextItem[]> {
    const library = await this.readLibrary();
    const allowed = sourceIds?.length ? new Set(sourceIds) : null;
    const retrievalLimit = Math.max(12, Math.min(50, limit * 5));
    const results = await this.search(query, retrievalLimit, sourceIds);
    const pagesBySource = new Map(library.sources.map((source) => [source.id, source.pages]));
    const items: KnowledgeContextItem[] = [];
    const seenPages = new Set<string>();
    let usedChars = 0;

    const appendItem = async (
      result: KnowledgeSearchResult,
      relation: "primary" | "related",
      relatedTo?: string,
    ): Promise<boolean> => {
      const pageKey = `${result.sourceId}:${result.pageNumber}`;
      if (seenPages.has(pageKey) || (allowed && !allowed.has(result.sourceId))) return false;
      const { source, page } = await this.getPage(result.sourceId, result.pageNumber);
      const structureText = page.structureBlocks?.map((block) => `[${block.type}] ${block.text}`).join("\n") ?? "";
      const analysisText = [
        page.title ? `[title] ${page.title}` : "",
        page.semanticType !== "unknown" ? `[type] ${page.semanticType}` : "",
        page.keywords?.length ? `[keywords] ${page.keywords.join(", ")}` : "",
        page.taxonomyPaths?.[0]?.length ? `[classification] ${page.taxonomyPaths[0].join(" → ")}` : "",
        relation === "related" ? `[relation] ${result.matchReasons?.includes("関連ソース") ? "関連ソース" : "関連ページ"}` : "",
      ].filter(Boolean).join("\n");
      const text = [analysisText, result.text.trim() || page.text?.trim() || structureText]
        .filter(Boolean)
        .join("\n");
      if (!text) return false;

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
        relation,
        relatedTo,
        text: text.slice(0, 5000),
        citation: `[${source.name} p${page.pageNumber}](sigma://knowledge-db/${encodeURIComponent(source.id)}/p/${page.pageNumber})`,
        matchReasons: relation === "related" ? (result.matchReasons?.length ? result.matchReasons : ["関連ページ"]) : result.matchReasons,
        citationRegions: selectCitationRegions(page, result.text || page.text || ""),
        citationRef: { sourceId: source.id, pageId: page.id, pageNumber: page.pageNumber },
      };
      const remaining = Math.max(0, maxChars - usedChars);
      if (remaining <= 0) return false;
      const boundedText = item.text.slice(0, remaining);
      if (!boundedText.trim()) return false;
      item.text = boundedText;
      item.contextChars = boundedText.length;
      items.push(item);
      seenPages.add(pageKey);
      usedChars += boundedText.length;
      return true;
    };

    const representedSources = new Set<string>();
    const normalizedLimit = Math.max(1, Math.min(limit, 20));
    const selected = selectDiverseContextResults(results, normalizedLimit, maxChars, pagesBySource);
    const primaryResults = selected.primary;
    const relatedResults = selected.related;

    for (const result of primaryResults) {
      if (usedChars >= maxChars || items.length >= normalizedLimit) break;
      const primaryKey = `${result.sourceId}:${result.pageNumber}`;
      if (!(await appendItem(result, "primary"))) continue;
      representedSources.add(result.sourceId);

      const related = relatedResults.filter((candidate) => candidate.relatedTo === primaryKey);
      for (const candidate of related) {
        if (usedChars >= maxChars || items.length >= normalizedLimit) break;
        await appendItem(candidate.result, "related", primaryKey);
      }
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



  async previewPdfImport(filePath: string): Promise<KnowledgePdfImportStaging> {
    const normalizedPath = path.resolve(filePath);
    const stat = await fs.stat(normalizedPath);
    if (!stat.isFile() || path.extname(normalizedPath).toLowerCase() !== ".pdf") {
      throw new Error("PDF file is required");
    }
    const bytes = await fs.readFile(normalizedPath);
    const sourceHash = createHash("sha256").update(bytes).digest("hex");
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: false });
    const pageCount = pdf.getPageCount();
    if (pageCount < 1) throw new Error("PDF has no pages");

    const pageTexts = await extractPdfPageTexts(bytes, pageCount);
    let structureResults: Awaited<ReturnType<KnowledgeStructureParser["parsePdf"]>> = [];
    const parserStatus = await this.getStructureParserStatus();
    if (parserStatus.available && pageTexts.some((text) => !text.trim())) {
      try {
        structureResults = await this.structureParser.parsePdf(normalizedPath);
      } catch {
        structureResults = [];
      }
    }
    const structureByPage = new Map(structureResults.map((result) => [result.pageNumber, result]));
    const pages: KnowledgePage[] = pageTexts.map((nativeText, index) => {
      const pageNumber = index + 1;
      const structured = structureByPage.get(pageNumber);
      const blocks = structured?.blocks ?? [];
      const text = [nativeText, structured?.text ?? "", ...blocks.map((block) => block.text)]
        .map((value) => value.trim())
        .filter(Boolean)
        .join("\n");
      const analysis = analyzeKnowledgePage(text, blocks);
      const taxonomy = classifyKnowledgeTaxonomy(text, analysis.keywords);
      return {
        id: "staging_p" + pageNumber,
        sourceId: "staging",
        pageNumber,
        semanticType: analysis.semanticType,
        title: analysis.title,
        text: text || undefined,
        keywords: analysis.keywords,
        analysisSignals: analysis.signals,
        taxonomyNodeIds: taxonomy.map((item) => item.nodeId),
        taxonomyPaths: taxonomy.map((item) => item.path),
        taxonomyConfidence: taxonomy[0]?.confidence ?? 0,
        analysisStatus: "analyzed",
        analysisVersion: KNOWLEDGE_ANALYSIS_VERSION,
        taxonomyVersion: KNOWLEDGE_TAXONOMY_VERSION,
      };
    });

    const pathKey = (page: KnowledgePage) => page.taxonomyPaths?.[0]?.join(" → ") ?? "";
    const segments: KnowledgePdfImportSegmentProposal[] = [];
    let start = pages[0]?.pageNumber ?? 1;
    let previousKey = pages[0] ? pathKey(pages[0]) : "";
    for (let index = 1; index < pages.length; index += 1) {
      const current = pages[index]!;
      const currentKey = pathKey(current);
      if (currentKey && previousKey && currentKey !== previousKey) {
        const previousPage = pages[index - 1]!;
        const nextPage = pages[index + 1];
        const previousSubject = previousKey.split(" → ")[0];
        const currentSubject = currentKey.split(" → ")[0];
        const stableBoundary = previousSubject !== currentSubject || Boolean(nextPage && pathKey(nextPage) === currentKey);
        if (stableBoundary) {
          const segmentPages = pages.filter((page) => page.pageNumber >= start && page.pageNumber <= previousPage.pageNumber);
          const paths = [...new Map(segmentPages.flatMap((page) => (page.taxonomyPaths ?? []).map((taxonomyPath) => [taxonomyPath.join("\u001f"), taxonomyPath] as const))).values()].slice(0, 4);
          const confidence = Math.min(1, segmentPages.reduce((sum, page) => sum + (page.taxonomyConfidence ?? 0), 0) / Math.max(1, segmentPages.length));
          const title = segmentPages.find((page) => page.title?.trim())?.title?.trim();
          segments.push({
            id: "seg_" + randomUUID(),
            startPage: start,
            endPage: previousPage.pageNumber,
            name: title || path.basename(normalizedPath, path.extname(normalizedPath)) + " p" + start + "-" + previousPage.pageNumber,
            paths,
            confidence,
            reason: "連続ページの分類が変化した境界を検出",
            selected: true,
          });
          start = current.pageNumber;
        }
      }
      if (currentKey) previousKey = currentKey;
    }
    const last = pages[pages.length - 1];
    if (last) {
      const segmentPages = pages.filter((page) => page.pageNumber >= start && page.pageNumber <= last.pageNumber);
      const paths = [...new Map(segmentPages.flatMap((page) => (page.taxonomyPaths ?? []).map((taxonomyPath) => [taxonomyPath.join("\u001f"), taxonomyPath] as const))).values()].slice(0, 4);
      const confidence = Math.min(1, segmentPages.reduce((sum, page) => sum + (page.taxonomyConfidence ?? 0), 0) / Math.max(1, segmentPages.length));
      const title = segmentPages.find((page) => page.title?.trim())?.title?.trim();
      segments.push({
        id: "seg_" + randomUUID(),
        startPage: start,
        endPage: last.pageNumber,
        name: title || path.basename(normalizedPath, path.extname(normalizedPath)) + " p" + start + "-" + last.pageNumber,
        paths,
        confidence,
        reason: "ページ内容と分類の連続性から分割範囲を推定",
        selected: true,
      });
    }

    const staging: KnowledgePdfImportStaging = {
      id: "pstg_" + randomUUID(),
      status: "draft",
      sourcePath: normalizedPath,
      sourceName: path.basename(normalizedPath),
      sourceHash,
      sizeBytes: stat.size,
      pageCount,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      segments,
    };
    const stagingDir = this.stagingPaths().root;
    await fs.mkdir(stagingDir, { recursive: true });
    await fs.writeFile(path.join(stagingDir, staging.id + ".json"), JSON.stringify(staging, null, 2), "utf8");
    return staging;
  }

  async getPdfImportStaging(stagingId: string): Promise<KnowledgePdfImportStaging | null> {
    try {
      return JSON.parse(await fs.readFile(path.join(this.stagingPaths().root, stagingId + ".json"), "utf8")) as KnowledgePdfImportStaging;
    } catch {
      return null;
    }
  }

  async listPdfImportStaging(): Promise<KnowledgePdfImportStaging[]> {
    const entries = await fs.readdir(this.stagingPaths().root, { withFileTypes: true }).catch(() => []);
    const items: KnowledgePdfImportStaging[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      try {
        items.push(JSON.parse(await fs.readFile(path.join(this.stagingPaths().root, entry.name), "utf8")) as KnowledgePdfImportStaging);
      } catch {}
    }
    return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async updatePdfImportStaging(input: { stagingId: string; segments: KnowledgePdfImportSegmentProposal[] }): Promise<KnowledgePdfImportStaging> {
    const current = await this.getPdfImportStaging(input.stagingId);
    if (!current) throw new Error("PDF import staging not found");
    if (current.status !== "draft") throw new Error("Only draft PDF imports can be edited");
    for (const segment of input.segments) {
      if (!Number.isInteger(segment.startPage) || !Number.isInteger(segment.endPage) || segment.startPage < 1 || segment.endPage < segment.startPage || segment.endPage > current.pageCount) {
        throw new Error("Invalid PDF segment range");
      }
    }
    const updated: KnowledgePdfImportStaging = { ...current, segments: input.segments, updatedAt: new Date().toISOString() };
    await fs.writeFile(path.join(this.stagingPaths().root, current.id + ".json"), JSON.stringify(updated, null, 2), "utf8");
    return updated;
  }

  async approvePdfImport(stagingId: string): Promise<{ stagingId: string; sourceId: string; childSourceIds: string[] }> {
    const current = await this.getPdfImportStaging(stagingId);
    if (!current) throw new Error("PDF import staging not found");
    if (current.status !== "draft") throw new Error("Only draft PDF imports can be approved");

    const bytes = await fs.readFile(current.sourcePath);
    const currentHash = createHash("sha256").update(bytes).digest("hex");
    if (currentHash !== current.sourceHash) throw new Error("Source PDF changed after preview; review is required again.");

    const added = await this.addFiles([current.sourcePath]);
    const library = await this.readLibrary();
    const source = added[0] ?? library.sources.find((item) => item.contentHash === current.sourceHash);
    if (!source) throw new Error("Failed to register source PDF");

    const selected = current.segments.filter((segment) => segment.selected);
    const childSources = selected.length
      ? await this.materializeSmartSplit(source.id, selected.map((segment) => ({ startPage: segment.startPage, endPage: segment.endPage, name: segment.name })))
      : [];

    const approved: KnowledgePdfImportStaging = {
      ...current,
      status: "approved",
      updatedAt: new Date().toISOString(),
      approvedAt: new Date().toISOString(),
    };
    await fs.writeFile(path.join(this.stagingPaths().root, current.id + ".json"), JSON.stringify(approved, null, 2), "utf8");
    return { stagingId, sourceId: source.id, childSourceIds: childSources.map((child) => child.id) };
  }

  async rejectPdfImport(stagingId: string): Promise<{ stagingId: string }> {
    const current = await this.getPdfImportStaging(stagingId);
    if (!current) throw new Error("PDF import staging not found");
    if (current.status !== "draft") throw new Error("Only draft PDF imports can be rejected");
    const rejected: KnowledgePdfImportStaging = { ...current, status: "rejected", updatedAt: new Date().toISOString() };
    await fs.writeFile(path.join(this.stagingPaths().root, current.id + ".json"), JSON.stringify(rejected, null, 2), "utf8");
    return { stagingId };
  }

  async previewSmartSplit(sourceId: string): Promise<{ sourceId: string; sourceName: string; pageCount: number; segments: KnowledgeSmartSplitSegment[] }> {
    const { source } = await this.getPage(sourceId, 1);
    if (source.mimeType !== "application/pdf" || source.pageCount < 2) {
      return { sourceId, sourceName: source.name, pageCount: source.pageCount, segments: [{ id: sourceId + ":1-" + source.pageCount, sourceId, startPage: 1, endPage: source.pageCount, paths: [], confidence: 1, reason: "分割不要な資料" }] };
    }
    const pages = [...source.pages].sort((a, b) => a.pageNumber - b.pageNumber);
    const pathKey = (page: KnowledgePage) => page.taxonomyPaths?.[0]?.join(" → ") ?? "";
    const segments: KnowledgeSmartSplitSegment[] = [];
    let start = pages[0]?.pageNumber ?? 1;
    let previousKey = pages[0] ? pathKey(pages[0]) : "";
    for (let index = 1; index < pages.length; index += 1) {
      const current = pages[index];
      const currentKey = pathKey(current);
      if (currentKey && previousKey && currentKey !== previousKey) {
        const previousPage = pages[index - 1];
        const nextPage = pages[index + 1];
        const previousSubject = previousKey.split(" → ")[0];
        const currentSubject = currentKey.split(" → ")[0];
        const stableBoundary = previousSubject !== currentSubject || Boolean(nextPage && pathKey(nextPage) === currentKey);
        if (stableBoundary) {
          const segmentPages = pages.filter((page) => page.pageNumber >= start && page.pageNumber <= previousPage.pageNumber);
          const paths = [...new Map(segmentPages.flatMap((page) => (page.taxonomyPaths ?? []).map((taxonomyPath) => [taxonomyPath.join("\u001f"), taxonomyPath] as const))).values()].slice(0, 4);
          segments.push({ id: sourceId + ":" + start + "-" + previousPage.pageNumber, sourceId, startPage: start, endPage: previousPage.pageNumber, paths, confidence: Math.min(1, segmentPages.reduce((sum, page) => sum + (page.taxonomyConfidence ?? 0), 0) / Math.max(1, segmentPages.length)), reason: "連続ページの分類が変化した境界を検出" });
          start = current.pageNumber;
        }
      }
      if (currentKey) previousKey = currentKey;
    }
    const last = pages[pages.length - 1];
    if (last) {
      const segmentPages = pages.filter((page) => page.pageNumber >= start && page.pageNumber <= last.pageNumber);
      const paths = [...new Map(segmentPages.flatMap((page) => (page.taxonomyPaths ?? []).map((taxonomyPath) => [taxonomyPath.join("\u001f"), taxonomyPath] as const))).values()].slice(0, 4);
      segments.push({ id: sourceId + ":" + start + "-" + last.pageNumber, sourceId, startPage: start, endPage: last.pageNumber, paths, confidence: Math.min(1, segmentPages.reduce((sum, page) => sum + (page.taxonomyConfidence ?? 0), 0) / Math.max(1, segmentPages.length)), reason: "ページ内容と分類の連続性から分割範囲を推定" });
    }
    return { sourceId, sourceName: source.name, pageCount: source.pageCount, segments };
  }

  async materializeSmartSplit(sourceId: string, segments: Array<{ startPage: number; endPage: number; name?: string }>): Promise<KnowledgeSource[]> {
    const source = (await this.getPage(sourceId, 1)).source;
    if (source.mimeType !== "application/pdf") throw new Error("smart split requires PDF");
    const input = await fs.readFile(source.storedPath);
    const paths = this.paths();
    const created: KnowledgeSource[] = [];
    for (const segment of segments) {
      const start = Math.max(1, Math.min(source.pageCount, Math.floor(segment.startPage)));
      const end = Math.max(start, Math.min(source.pageCount, Math.floor(segment.endPage)));
      const output = await PDFDocument.create();
      const sourcePdf = await PDFDocument.load(input);
      const copied = await output.copyPages(sourcePdf, Array.from({ length: end - start + 1 }, (_, offset) => start - 1 + offset));
      copied.forEach((page) => output.addPage(page));
      const id = "src_" + randomUUID();
      const storedPath = path.join(paths.sourcesDir, id + ".pdf");
      const bytes = await output.save();
      const now = new Date().toISOString();
      const name = segment.name?.trim() || (path.basename(source.name, path.extname(source.name)) + " p" + start + "-" + end + ".pdf");
      const contentHash = createHash("sha256").update(bytes).digest("hex");
      const child: KnowledgeSource = { id, name, originalPath: source.originalPath, storedPath, mimeType: "application/pdf", sizeBytes: bytes.byteLength, pageCount: end - start + 1, importedAt: now, updatedAt: now, contentHash, extractionStatus: "ocr-needed", pages: Array.from({ length: end - start + 1 }, (_, index) => ({ id: id + "_p" + (index + 1), sourceId: id, pageNumber: index + 1, semanticType: "unknown", extractionStatus: "ocr-needed", wordCount: 0, analysisStatus: "pending", analysisVersion: 0 })) };
      await fs.mkdir(paths.sourcesDir, { recursive: true });
      await fs.writeFile(storedPath, bytes);
      created.push(child);
    }
    if (created.length) {
      // Background indexing can update library metadata while PDF pages are
      // being materialized. Re-read immediately before committing children and
      // retry stale snapshots instead of turning a harmless race into a failed
      // import.
      let committed = false;
      for (let attempt = 0; attempt < 3 && !committed; attempt += 1) {
        const library = await this.readLibrary();
        for (const child of created) {
          if (!library.sources.some((item) => item.id === child.id)) {
            library.sources.unshift(child);
          }
        }
        try {
          await this.writeLibrary(library);
          committed = true;
        } catch (error) {
          if (!(error instanceof Error) || !error.message.includes("changed concurrently")) {
            throw error;
          }
        }
      }
      if (!committed) {
        throw new Error("Knowledge DB changed concurrently; could not commit smart-split sources.");
      }
    }
    this.startBackgroundIndexing();
    return created;
  }

  async getPage(sourceId: string, pageNumber: number): Promise<{ source: KnowledgeSource; page: KnowledgePage }> {
    const source = await this.findSource(sourceId);
    const page = source.pages.find((item) => item.pageNumber === pageNumber);
    if (!page) throw new Error("knowledge page not found");
    return { source, page };
  }

  async applyClassificationReview(input: {
    sourceId: string;
    pageNumber: number;
    paths: string[][];
    confidence: number;
    reason?: string;
    evidence?: string[];
  }): Promise<{ status: "confirmed" | "needs-review"; page: KnowledgePage }> {
    const library = await this.readLibrary();
    const source = library.sources.find((item) => item.id === input.sourceId);
    if (!source) throw new Error("knowledge source not found");
    const page = source.pages.find((item) => item.pageNumber === input.pageNumber);
    if (!page) throw new Error("knowledge page not found");

    const normalizePath = (value: string[]) => value.map((part) => part.normalize("NFKC").trim()).filter(Boolean);
    const reviewed = input.paths.map(normalizePath).filter((path) => path.length > 0);
    const local = (page.taxonomyPaths ?? []).map(normalizePath);
    const samePath = (a: string[], b: string[]) => a.length === b.length && a.every((part, index) => part === b[index]);
    const matchesLocal = reviewed.length > 0 && reviewed.every((candidate) => local.some((existing) => samePath(candidate, existing)));
    const status = matchesLocal ? "confirmed" : "needs-review";

    page.classificationReviewStatus = status;
    page.classificationReviewPaths = reviewed;
    page.classificationReviewConfidence = Math.max(0, Math.min(1, input.confidence));
    page.classificationReviewReason = input.reason?.trim() || undefined;
    page.classificationReviewEvidence = input.evidence?.map((item) => item.trim()).filter(Boolean).slice(0, 8);
    source.updatedAt = new Date().toISOString();
    await this.writeLibrary(library);
    return { status, page };
  }

  async createBackup(outputPath: string): Promise<{ filePath: string; fileCount: number; bytes: number }> {
    const paths = this.paths();
    await fs.mkdir(paths.root, { recursive: true });
    const zip = new JSZip();
    const files = await collectFiles(paths.root);
    let includedFileCount = 0;
    for (const filePath of files) {
      const relative = path.relative(paths.root, filePath).split(path.sep).join("/");
      if (!relative || relative.endsWith(".tmp")) continue;
      zip.file(relative, await fs.readFile(filePath));
      includedFileCount += 1;
    }
    zip.file("backup-manifest.json", JSON.stringify({
      format: "sigma-knowledge-db-backup",
      version: 1,
      createdAt: new Date().toISOString(),
      fileCount: includedFileCount,
    }, null, 2));
    const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
    const destination = path.resolve(outputPath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, bytes);
    return { filePath: destination, fileCount: includedFileCount, bytes: bytes.byteLength };
  }

  async restoreBackup(backupPath: string): Promise<{ filePath: string; fileCount: number }> {
    const destination = path.resolve(backupPath);
    const bytes = await fs.readFile(destination);
    const zip = await JSZip.loadAsync(bytes);
    const manifestEntry = zip.file("backup-manifest.json");
    if (!manifestEntry) throw new Error("Invalid Knowledge DB backup: manifest missing");
    let manifest: { format?: string; version?: number };
    try {
      manifest = JSON.parse(await manifestEntry.async("text")) as { format?: string; version?: number };
    } catch {
      throw new Error("Invalid Knowledge DB backup: manifest unreadable");
    }
    if (manifest.format !== "sigma-knowledge-db-backup" || manifest.version !== 1) {
      throw new Error("Unsupported Knowledge DB backup format");
    }

    const paths = this.paths();
    const parent = path.dirname(paths.root);
    const tempRoot = path.join(parent, `.knowledge-db-restore-${randomUUID()}`);
    await fs.mkdir(tempRoot, { recursive: true });
    try {
      let fileCount = 0;
      for (const entry of Object.values(zip.files)) {
        if (entry.dir || entry.name === "backup-manifest.json") continue;
        const normalized = path.posix.normalize(entry.name);
        if (normalized.startsWith("../") || normalized === ".." || path.posix.isAbsolute(normalized)) {
          throw new Error("Invalid Knowledge DB backup entry");
        }
        const target = path.join(tempRoot, ...normalized.split("/"));
        const relativeTarget = path.relative(tempRoot, target);
        if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) {
          throw new Error("Invalid Knowledge DB backup path");
        }
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, await entry.async("nodebuffer"));
        fileCount += 1;
      }
      const restoredLibrary = path.join(tempRoot, "library.json");
      await fs.access(restoredLibrary);
      const currentBackup = `${paths.root}.before-restore-${Date.now()}`;
      try {
        await fs.rename(paths.root, currentBackup);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      try {
        await fs.rename(tempRoot, paths.root);
      } catch (error) {
        try { await fs.rename(currentBackup, paths.root); } catch {}
        throw error;
      }
      await fs.rm(currentBackup, { recursive: true, force: true });
      return { filePath: destination, fileCount };
    } catch (error) {
      await fs.rm(tempRoot, { recursive: true, force: true });
      throw error;
    }
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
          source.pages = await Promise.all(source.pages.map(async (page, index) => {
            const nativeText = pageTexts[index]?.trim() ?? "";
            let visualAnalysis = page.visualAnalysis;
            let visualPreviewPath = page.visualPreviewPath;
            let visualAnalysisError: string | undefined;
            const shouldVisualize = shouldRunKnowledgeVisualAnalysis({
              filePath: source.storedPath,
              pageText: nativeText,
              extractionStatus: nativeText ? "text" : "ocr-needed",
              hasFigureOrTable: pageHasVisualBlocks(structureByPage.get(page.pageNumber)?.blocks),
            });
            if (shouldVisualize && page.visualAnalysisVersion !== KNOWLEDGE_VISUAL_ANALYSIS_VERSION) {
              try {
                const visual = await analyzeKnowledgeVisualPage({
                  filePath: source.storedPath,
                  pageNumber: page.pageNumber,
                  pageText: nativeText,
                  dataDir: this.dataDir,
                });
                visualAnalysis = visual.analysis;
                visualPreviewPath = visual.previewPath;
              } catch (error) {
                visualAnalysisError = error instanceof Error ? error.message : String(error);
              }
            }
            const structured = structureByPage.get(page.pageNumber);
            const blocks = structured?.blocks ?? [];
            const extractedContent = [nativeText, structured?.text ?? "", ...blocks.map((block) => block.text), visualAnalysis ? `[visual]\\n${visualAnalysis}` : ""]
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
              classificationReviewStatus: taxonomy.length > 1 || (taxonomy[0]?.confidence ?? 0) < 0.85 ? "pending" : undefined,
              classificationReviewPaths: undefined,
              classificationReviewConfidence: undefined,
              classificationReviewReason: undefined,
              classificationReviewEvidence: undefined,
              extractionStatus: text ? "text" : "ocr-needed",
              wordCount: text ? countWords(text) : 0,
              ...(blocks.length ? { structureBlocks: blocks } : {}),
            };
          }));
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
      const raw = await fs.readFile(paths.libraryPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<KnowledgeLibrary>;
      if (parsed.version === 3 && Array.isArray(parsed.sources)) {
        const sources = parsed.sources.map((source) => {
          const globalSource = { ...(source as KnowledgeSource & { workspaceId?: unknown }) };
          delete globalSource.workspaceId;
          return globalSource as KnowledgeSource;
        });
        const library: KnowledgeLibrary = { version: 3, sources };
        Object.defineProperty(library, "__fingerprint", { value: createHash("sha256").update(raw).digest("hex"), enumerable: false, writable: true });
        return library;
      }
    } catch {}
    const library: KnowledgeLibrary = { version: 3, sources: [] };
    const legacyRoot = path.join(this.dataDir, "knowledge-db", "workspaces");
    const entries = await fs.readdir(legacyRoot, { withFileTypes: true }).catch(() => []);
    type LegacySource = {
      id: string;
      storedPath: string;
      contentHash?: string;
      name?: unknown;
      originalPath?: unknown;
      sizeBytes?: unknown;
      pageCount?: unknown;
      importedAt?: unknown;
      updatedAt?: unknown;
      pages: KnowledgePage[];
    };
    await fs.mkdir(paths.sourcesDir, { recursive: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      let parsed: { sources?: LegacySource[] };
      try { parsed = JSON.parse(await fs.readFile(path.join(legacyRoot, entry.name, "library.json"), "utf8")) as { sources?: LegacySource[] }; } catch { continue; }
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
    let currentFingerprint: string | null = null;
    try {
      const currentRaw = await fs.readFile(paths.libraryPath, "utf8");
      currentFingerprint = createHash("sha256").update(currentRaw).digest("hex");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (library.__fingerprint !== undefined && library.__fingerprint !== currentFingerprint) {
      throw new Error("Knowledge DB changed concurrently; the operation was not written. Please retry.");
    }
    const serialized = JSON.stringify(library, null, 2);
    const tmp = `${paths.libraryPath}.tmp`;
    await fs.writeFile(tmp, serialized, "utf8");
    await fs.rename(tmp, paths.libraryPath);
    library.__fingerprint = createHash("sha256").update(serialized).digest("hex");
  }

  private stagingPaths() {
    return { root: path.join(this.dataDir, "knowledge-db", "staging") };
  }

  private paths() {
    const root = path.join(this.dataDir, "knowledge-db");
    return { root, libraryPath: path.join(root, "library.json"), sourcesDir: path.join(root, "sources"), openedPagesDir: path.join(root, "opened-pages") };
  }

  private vectorIndex(): LocalVectorIndex {
    return new LocalVectorIndex(path.join(this.paths().root, "vector-index"));
  }
}

async function collectFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
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
  relation?: "primary" | "related";
  relatedTo?: string;
  citationRef?: {
    sourceId: string;
    pageId: string;
    pageNumber: number;
  };
}

function selectDiverseContextResults(
  results: KnowledgeSearchResult[],
  limit: number,
  maxChars: number,
  pagesBySource: Map<string, KnowledgePage[]>,
): {
  primary: KnowledgeSearchResult[];
  related: Array<{ result: KnowledgeSearchResult; relatedTo: string }>;
} {
  const primary: KnowledgeSearchResult[] = [];
  const related: Array<{ result: KnowledgeSearchResult; relatedTo: string }> = [];
  const seenSources = new Set<string>();
  const seenPages = new Set<string>();
  const estimatedBudget = Math.max(1, Math.floor(maxChars / Math.max(1, limit)));
  const primaryTarget = Math.max(1, Math.min(limit, Math.ceil(limit / 2)));

  for (const result of results) {
    if (primary.length >= primaryTarget) break;
    const key = `${result.sourceId}:${result.pageNumber}`;
    if (seenPages.has(key)) continue;
    // Maximize source diversity first, then let score dominate within a source.
    const sourceAlreadyRepresented = seenSources.has(result.sourceId);
    if (sourceAlreadyRepresented && primary.length < Math.min(primaryTarget, 3)) continue;
    if (!result.text.trim() && result.citationRegions?.length === 0) continue;
    primary.push(result);
    seenPages.add(key);
    seenSources.add(result.sourceId);

    const sourcePages = pagesBySource.get(result.sourceId) ?? [];
    const primaryPage = sourcePages.find((page) => page.pageNumber === result.pageNumber);
    const primaryTaxonomy = primaryPage?.taxonomyPaths?.[0]?.join(" → ") ?? "";
    const nearby = sourcePages
      .filter((page) => Math.abs(page.pageNumber - result.pageNumber) <= 1 && page.pageNumber !== result.pageNumber)
      .filter((page) => Boolean(page.text?.trim()))
      .filter((page) => {
        const taxonomy = page.taxonomyPaths?.[0]?.join(" → ") ?? "";
        return primaryTaxonomy && taxonomy ? taxonomy === primaryTaxonomy : true;
      })
      .sort((a, b) => Math.abs(a.pageNumber - result.pageNumber) - Math.abs(b.pageNumber - result.pageNumber));

    const crossSource = results.find((candidate) =>
      candidate.sourceId !== result.sourceId &&
      !seenPages.has(`${candidate.sourceId}:${candidate.pageNumber}`)
    );
    if (crossSource && !related.some((item) => item.result.id === crossSource.id)) {
      related.push({
        result: {
          ...crossSource,
          score: Math.max(0, crossSource.score * 0.9),
          matchReasons: ["関連ソース", ...crossSource.matchReasons.filter((reason) => reason !== "関連ソース")],
        },
        relatedTo: key,
      });
      seenPages.add(`${crossSource.sourceId}:${crossSource.pageNumber}`);
    }

    const relatedPage = nearby[0];
    if (relatedPage) {
      const relatedKey = `${relatedPage.sourceId}:${relatedPage.pageNumber}`;
      if (!seenPages.has(relatedKey)) {
        const relatedResult: KnowledgeSearchResult = {
          id: `${relatedPage.id}_related`,
          sourceId: relatedPage.sourceId,
          pageNumber: relatedPage.pageNumber,
          chunkIndex: 0,
          text: relatedPage.text ?? "",
          score: Math.max(0, result.score * 0.82),
          sourceName: result.sourceName,
          matchReasons: ["関連ページ"],
          citationRegions: selectCitationRegions(relatedPage, relatedPage.text ?? ""),
        };
        related.push({ result: relatedResult, relatedTo: key });
        seenPages.add(relatedKey);
      }
    }
    // Avoid filling the context with many near-duplicate long pages.
    if (result.text.length > estimatedBudget && primary.length >= Math.min(limit, 2)) continue;
  }

  return { primary, related };
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/gu, "_").slice(0, 160) || "item";
}

function countWords(text: string): number {
  return text.normalize("NFKC").trim() ? text.normalize("NFKC").trim().split(/\\s+/u).length : 0;
}

function tokenizeForSearch(text: string): string[] {
  const normalized = text.normalize("NFKC").toLocaleLowerCase();
  const tokens = normalized.match(/[\\p{L}\\p{N}][\\p{P}\\p{L}\\p{N}_-]*/gu) ?? [];
  const japanese = normalized.match(/[一-龯々〆ヵヶぁ-ゖァ-ヺー]{2,}/gu) ?? [];
  const morphemeLike: string[] = [];
  for (const token of japanese) {
    // Character bigrams improve recall for Japanese queries without requiring a heavyweight tokenizer.
    if (token.length <= 4) morphemeLike.push(token);
    for (let i = 0; i < token.length - 1; i += 1) morphemeLike.push(token.slice(i, i + 2));
  }
  return [...new Set([...tokens, ...morphemeLike])];
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

function exactPhraseScore(text: string, query: string): number {
  const normalizedText = text.normalize("NFKC").toLocaleLowerCase().replace(/\\s+/gu, " ").trim();
  const normalizedQuery = query.normalize("NFKC").toLocaleLowerCase().replace(/\\s+/gu, " ").trim();
  if (!normalizedText || !normalizedQuery) return 0;
  if (normalizedText.includes(normalizedQuery)) return 1;
  const compactText = normalizedText.replace(/\\s+/gu, "");
  const compactQuery = normalizedQuery.replace(/\\s+/gu, "");
  return compactQuery.length >= 4 && compactText.includes(compactQuery) ? 0.7 : 0;
}

function buildDocumentFrequency(pages: KnowledgePage[]): Map<string, number> {
  const frequency = new Map<string, number>();
  for (const page of pages) {
    const uniqueTokens = new Set(tokenizeForSearch(page.text ?? ""));
    for (const token of uniqueTokens) frequency.set(token, (frequency.get(token) ?? 0) + 1);
  }
  return frequency;
}

function lexicalScore(
  text: string,
  queryTokens: string[],
  documentFrequency: Map<string, number>,
  documentCount: number,
): number {
  if (queryTokens.length === 0 || !text.trim()) return 0;
  const normalized = text.normalize("NFKC").toLocaleLowerCase();
  const tokens = tokenizeForSearch(text);
  const tokenCounts = new Map<string, number>();
  for (const token of tokens) tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);
  const lengthNorm = Math.sqrt(Math.max(1, tokens.length));
  let score = 0;
  let weight = 0;
  for (const queryToken of queryTokens) {
    const variants = searchTokenVariants(queryToken);
    const tf = variants.reduce((sum, variant) => sum + (tokenCounts.get(variant) ?? 0), 0);
    if (tf === 0 && !variants.some((variant) => normalized.includes(variant))) continue;
    const df = documentFrequency.get(queryToken) ?? 0;
    const idf = Math.log(1 + (documentCount + 1) / (df + 1));
    const tfWeight = tf > 0 ? (1 + Math.log(tf)) / lengthNorm : 0.35;
    score += idf * tfWeight;
    weight += idf;
  }
  if (weight === 0) return 0;
  return Math.min(1, score / weight * 2.2);
}

function semanticQueryScore(page: KnowledgePage, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  const semanticText = [
    page.semanticType,
    page.title ?? "",
    ...(page.keywords ?? []),
    ...(page.analysisSignals ?? []),
    ...(page.taxonomyPaths ?? []).flat(),
  ].join(" ").normalize("NFKC").toLocaleLowerCase();
  const hits = queryTokens.filter((token) => semanticText.includes(token)).length;
  return Math.min(1, hits / queryTokens.length);
}

function normalizeSearchToken(token: string): string {
  return token.normalize("NFKC").toLocaleLowerCase().replace(/[\\p{P}\\p{S}]/gu, "");
}

function searchTokenVariants(token: string): string[] {
  const normalized = normalizeSearchToken(token);
  const variants = new Set([normalized]);
  const aliases: Record<string, string[]> = {
    "pdf": ["portable document format"],
    "ocr": ["文字認識", "光学文字認識"],
    "rag": ["retrieval augmented generation", "検索拡張生成"],
    "ai": ["人工知能"],
    "人工知能": ["ai"],
    "検索": ["retrieval", "search"],
    "retrieval": ["検索"],
    "分類": ["taxonomy", "classification"],
    "taxonomy": ["分類"],
    "定義": ["definition"],
    "definition": ["定義"],
    "解答": ["solution", "answer"],
    "solution": ["解答", "answer"],
  };
  for (const alias of aliases[normalized] ?? []) variants.add(alias);
  return [...variants];
}

function metadataScore(page: KnowledgePage, query: string, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  const title = page.title?.normalize("NFKC").toLocaleLowerCase() ?? "";
  const keywords = (page.keywords ?? []).map((keyword) => keyword.normalize("NFKC").toLocaleLowerCase());
  const keywordHits = queryTokens.filter((token) => searchTokenVariants(token).some((variant) => keywords.some((keyword) => keyword === variant || keyword.includes(variant)))).length;
  const titleHits = queryTokens.filter((token) => searchTokenVariants(token).some((variant) => title.includes(variant))).length;
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
  if (exactPhraseScore(page.text ?? "", query) > 0) reasons.push("完全一致");
  if (lexical > 0) reasons.push(`本文一致 ${Math.round(lexical * 100)}%`);
  if (page.title && queryTokens.some((token) => searchTokenVariants(token).some((variant) => page.title!.toLocaleLowerCase().includes(variant)))) reasons.push("タイトル一致");
  if ((page.keywords ?? []).some((keyword) => queryTokens.some((token) => searchTokenVariants(token).some((variant) => keyword.toLocaleLowerCase().includes(variant))))) reasons.push("キーワード一致");
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