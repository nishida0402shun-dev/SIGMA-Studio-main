import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { LocalVectorIndex, type VectorSearchResult } from "./local-vector-index";

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
}

export interface KnowledgeSource {
  id: string;
  name: string;
  originalPath: string;
  storedPath: string;
  mimeType: "application/pdf";
  sizeBytes: number;
  pageCount: number;
  importedAt: string;
  updatedAt: string;
  contentHash?: string;
  pages: KnowledgePage[];
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

export class KnowledgeDbStore {
  private readonly dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  async listSources(): Promise<KnowledgeSource[]> {
    return this.ensureIndexed();
  }

  async addFiles(filePaths: string[]): Promise<KnowledgeSource[]> {
    const paths = this.paths();
    const library = await this.readLibrary();
    const added: KnowledgeSource[] = [];

    for (const filePath of filePaths) {
      if (path.extname(filePath).toLowerCase() !== ".pdf") continue;
      const stat = await fs.stat(filePath);
      const bytes = await fs.readFile(filePath);
      const contentHash = createHash("sha256").update(bytes).digest("hex");
      if (library.sources.some((source) => source.contentHash === contentHash)) {
        continue;
      }

      const pdf = await PDFDocument.load(bytes, { ignoreEncryption: false });
      const id = `src_${cryptoRandomId()}`;
      const storedPath = path.join(paths.sourcesDir, `${id}.pdf`);
      const now = new Date().toISOString();
      const pageCount = pdf.getPageCount();
      const pageTexts = await extractPdfPageTexts(bytes, pageCount);
      const source: KnowledgeSource = {
        id,
        name: path.basename(filePath),
        originalPath: filePath,
        storedPath,
        mimeType: "application/pdf",
        sizeBytes: stat.size,
        pageCount,
        importedAt: now,
        updatedAt: now,
        contentHash,
        pages: Array.from({ length: pageCount }, (_, index) => ({
          id: `${id}_p${index + 1}`,
          sourceId: id,
          pageNumber: index + 1,
          semanticType: "unknown",
          text: pageTexts[index] || undefined,
        })),
      };

      await fs.mkdir(paths.sourcesDir, { recursive: true });
      try {
        await fs.copyFile(filePath, storedPath);
        await this.indexSource(source);
        library.sources.unshift(source);
        await this.writeLibrary(library);
        added.push(source);
      } catch (error) {
        await fs.rm(storedPath, { force: true });
        await this.vectorIndex().removeSource(source.id);
        throw error;
      }
    }
    return added;
  }

  async search(query: string, limit = 12): Promise<Array<VectorSearchResult & { sourceName: string }>> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    await this.ensureIndexed();
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
    return [...bestByPage.values()]
      .map((match) => {
        const lexical = lexicalScore(match.text, queryTokens);
        return { ...match, score: match.score * 0.75 + lexical * 0.25 };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, safeLimit)
      .map((match) => ({ ...match, sourceName: sourceNames.get(match.sourceId) ?? match.sourceId }));
  }

  async getContext(query: string, limit = 8, sourceIds?: string[]): Promise<KnowledgeContextItem[]> {
    const allowed = sourceIds?.length ? new Set(sourceIds) : null;
    const results = (await this.search(query, Math.min(50, Math.max(limit * 3, limit))))
      .filter((result) => !allowed || allowed.has(result.sourceId))
      .slice(0, Math.max(1, Math.min(limit, 20)));
    const items: KnowledgeContextItem[] = [];
    for (const result of results) {
      const { source, page } = await this.getPage(result.sourceId, result.pageNumber);
      const text = result.text.trim() || page.text?.trim() || "";
      if (!text) continue;
      items.push({
        id: result.id,
        sourceId: source.id,
        pageId: page.id,
        sourceName: source.name,
        pageNumber: page.pageNumber,
        semanticType: page.semanticType,
        score: result.score,
        text: text.slice(0, 5000),
        citation: `[SIGMA:${source.id}:p${page.pageNumber}]`,
      });
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
    let changed = false;
    for (const source of library.sources) {
      const needsText = source.pages.some((page) => page.text === undefined);
      const needsIndex = !(await this.vectorIndex().hasSource(source.id));
      if (!needsText && !needsIndex) continue;
      try {
        if (needsText) {
          const bytes = await fs.readFile(source.storedPath);
          const pageTexts = await extractPdfPageTexts(bytes, source.pageCount);
          source.pages = source.pages.map((page, index) => ({ ...page, text: pageTexts[index] || undefined }));
          source.updatedAt = new Date().toISOString();
          changed = true;
        }
        await this.vectorIndex().removeSource(source.id);
        await this.indexSource(source);
      } catch {}
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
        const id = library.sources.some((source) => source.id === legacy.id) ? "src_" + cryptoRandomId() : legacy.id;
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
  score: number;
  text: string;
  citation: string;
}

function tokenizeForSearch(text: string): string[] {
  return text.normalize("NFKC").toLocaleLowerCase().match(/[\\p{L}\\p{N}][\\p{P}\\p{L}\\p{N}_-]*/gu) ?? [];
}

function lexicalScore(text: string, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  const normalized = text.normalize("NFKC").toLocaleLowerCase();
  const hits = queryTokens.filter((token) => normalized.includes(token)).length;
  return Math.min(1, hits / queryTokens.length);
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
