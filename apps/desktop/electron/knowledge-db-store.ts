import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { LocalVectorIndex } from "./local-vector-index";

export type KnowledgeSemanticType =
  | "problem"
  | "example"
  | "explanation"
  | "column"
  | "definition"
  | "theorem"
  | "answer"
  | "figure"
  | "unknown";

export interface KnowledgePage {
  id: string;
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
  mimeType: string;
  sizeBytes: number;
  pageCount: number;
  importedAt: string;
  pages: KnowledgePage[];
}

interface KnowledgeLibrary {
  version: 1;
  sources: KnowledgeSource[];
}

export class KnowledgeDbStore {
  private readonly root: string;
  private readonly sourcesDir: string;
  private readonly libraryPath: string;
  private readonly vectorIndex: LocalVectorIndex;
  private readonly openedPagesDir: string;

  constructor(dataDir: string) {
    this.root = path.join(dataDir, "knowledge-db");
    this.sourcesDir = path.join(this.root, "sources");
    this.libraryPath = path.join(this.root, "library.json");
    this.vectorIndex = new LocalVectorIndex(this.root);
    this.openedPagesDir = path.join(this.root, "opened-pages");
  }

  async listSources(): Promise<KnowledgeSource[]> {
    return this.ensureIndexed();
  }

  async addFiles(filePaths: string[]): Promise<KnowledgeSource[]> {
    const library = await this.readLibrary();
    const added: KnowledgeSource[] = [];

    for (const filePath of filePaths) {
      const ext = path.extname(filePath).toLowerCase();
      if (ext !== ".pdf") continue;
      const stat = await fs.stat(filePath);
      const bytes = await fs.readFile(filePath);
      const pdf = await PDFDocument.load(bytes, { ignoreEncryption: false });
      const id = `src_${cryptoRandomId()}`;
      const storedPath = path.join(this.sourcesDir, `${id}.pdf`);
      await fs.mkdir(this.sourcesDir, { recursive: true });
      await fs.copyFile(filePath, storedPath);

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
        importedAt: new Date().toISOString(),
        pages: Array.from({ length: pageCount }, (_, index) => ({
          id: `${id}_p${index + 1}`,
          pageNumber: index + 1,
          semanticType: "unknown",
          text: pageTexts[index] || undefined,
        })),
      };
      library.sources.unshift(source);
      added.push(source);
    }

    await this.writeLibrary(library);
    for (const source of added) {
      await this.indexSource(source);
    }
    return added;
  }

  async search(query: string, limit = 12) {
    await this.ensureIndexed();
    const chunkLimit = Math.min(Math.max(limit * 4, limit), 50);
    const matches = await this.vectorIndex.search(query, chunkLimit);
    const bestByPage = new Map<string, (typeof matches)[number]>();
    for (const match of matches) {
      const key = `${match.sourceId}:${match.pageNumber}`;
      const current = bestByPage.get(key);
      if (!current || match.score > current.score) bestByPage.set(key, match);
    }
    return [...bestByPage.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(limit, 50)));
  }

  private async ensureIndexed(): Promise<KnowledgeSource[]> {
    const library = await this.readLibrary();
    let changed = false;
    for (const source of library.sources) {
      const needsText = source.pages.some((page) => page.text === undefined);
      const needsIndex = !(await this.vectorIndex.hasSource(source.id));
      if (!needsText && !needsIndex) continue;
      try {
        if (needsText) {
          const bytes = await fs.readFile(source.storedPath);
          const pageTexts = await extractPdfPageTexts(bytes, source.pageCount);
          source.pages = source.pages.map((page, index) => ({
            ...page,
            text: pageTexts[index] || undefined,
          }));
          changed = true;
        }
        await this.vectorIndex.removeSource(source.id);
        await this.indexSource(source);
      } catch {
        // Keep the source visible even if a legacy PDF can no longer be read.
      }
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
    await this.vectorIndex.upsertMany(records);
  }

  async deleteSource(sourceId: string): Promise<boolean> {
    const library = await this.readLibrary();
    const source = library.sources.find((item) => item.id === sourceId);
    if (!source) return false;
    await fs.rm(source.storedPath, { force: true });
    await this.vectorIndex.removeSource(source.id);
    library.sources = library.sources.filter((item) => item.id !== sourceId);
    await this.writeLibrary(library);
    return true;
  }

  async getPagePdfBase64(sourceId: string, pageNumber: number): Promise<{ dataBase64: string; width: number; height: number }> {
    const library = await this.readLibrary();
    const source = library.sources.find((item) => item.id === sourceId);
    if (!source) throw new Error("knowledge source not found");
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > source.pageCount) throw new Error("knowledge page not found");
    const bytes = await fs.readFile(source.storedPath);
    const input = await PDFDocument.load(bytes);
    const page = input.getPage(pageNumber - 1);
    if (!page) throw new Error("knowledge page not found");
    const { width, height } = page.getSize();
    return { dataBase64: Buffer.from(bytes).toString("base64"), width, height };
  }

  async extractRegion(sourceId: string, pageNumber: number, rect: { x: number; y: number; width: number; height: number }): Promise<string> {
    const library = await this.readLibrary();
    const source = library.sources.find((item) => item.id === sourceId);
    if (!source) throw new Error("knowledge source not found");
    const bytes = await fs.readFile(source.storedPath);
    const input = await PDFDocument.load(bytes);
    const sourcePage = input.getPage(pageNumber - 1);
    if (!sourcePage) throw new Error("knowledge page not found");
    const pageSize = sourcePage.getSize();
    const x = Math.max(0, Math.min(rect.x, pageSize.width));
    const y = Math.max(0, Math.min(rect.y, pageSize.height));
    const width = Math.max(1, Math.min(rect.width, pageSize.width - x));
    const height = Math.max(1, Math.min(rect.height, pageSize.height - y));
    const output = await PDFDocument.create();
    const copied = await output.copyPages(input, [pageNumber - 1]);
    const page = copied[0];
    if (!page) throw new Error("knowledge page not found");
    page.setCropBox(x, y, width, height);
    page.setMediaBox(x, y, width, height);
    output.addPage(page);
    await fs.mkdir(this.openedPagesDir, { recursive: true });
    const safeSource = source.id.replace(/[^a-zA-Z0-9_-]/g, "_");
    const outputPath = path.join(this.openedPagesDir, safeSource + "-p" + pageNumber + "-region.pdf");
    await fs.writeFile(outputPath, await output.save());
    return outputPath;
  }

  async openPage(sourceId: string, pageNumber: number): Promise<string> {
    const library = await this.readLibrary();
    const source = library.sources.find((item) => item.id === sourceId);
    if (!source) throw new Error("knowledge source not found");
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > source.pageCount) {
      throw new Error("knowledge page not found");
    }
    const bytes = await fs.readFile(source.storedPath);
    const input = await PDFDocument.load(bytes);
    const output = await PDFDocument.create();
    const copied = await output.copyPages(input, [pageNumber - 1]);
    const page = copied[0];
    if (!page) throw new Error("knowledge page not found");
    output.addPage(page);
    await fs.mkdir(this.openedPagesDir, { recursive: true });
    const safeSource = source.id.replace(/[^a-zA-Z0-9_-]/g, "_");
    const outputPath = path.join(this.openedPagesDir, safeSource + "-p" + pageNumber + ".pdf");
    await fs.writeFile(outputPath, await output.save());
    return outputPath;
  }

  async extractPages(sourceId: string, pageNumbers: number[]): Promise<Uint8Array> {
    return this.extractSelectedPages([{ sourceId, pageNumbers }]);
  }

  async extractSelectedPages(
    selections: Array<{ sourceId: string; pageNumbers: number[] }>,
  ): Promise<Uint8Array> {
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

  async updatePageSemanticType(
    sourceId: string,
    pageNumber: number,
    semanticType: KnowledgeSemanticType,
    title?: string,
  ): Promise<KnowledgeSource> {
    const library = await this.readLibrary();
    const source = library.sources.find((item) => item.id === sourceId);
    if (!source) throw new Error("knowledge source not found");
    const page = source.pages.find((item) => item.pageNumber === pageNumber);
    if (!page) throw new Error("knowledge page not found");
    page.semanticType = semanticType;
    if (title !== undefined) page.title = title;
    await this.writeLibrary(library);
    return source;
  }

  private async readLibrary(): Promise<KnowledgeLibrary> {
    await fs.mkdir(this.root, { recursive: true });
    try {
      const raw = await fs.readFile(this.libraryPath, "utf8");
      const parsed = JSON.parse(raw) as KnowledgeLibrary;
      if (parsed.version === 1 && Array.isArray(parsed.sources)) return parsed;
    } catch {
      // First launch or an unreadable old file: rebuild an empty derived index.
    }
    return { version: 1, sources: [] };
  }

  private async writeLibrary(library: KnowledgeLibrary): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
    const tmp = `${this.libraryPath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(library, null, 2), "utf8");
    await fs.rename(tmp, this.libraryPath);
  }
}

function cryptoRandomId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
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