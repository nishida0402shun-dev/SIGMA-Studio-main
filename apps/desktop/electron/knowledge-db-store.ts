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

  constructor(dataDir: string) {
    this.root = path.join(dataDir, "knowledge-db");
    this.sourcesDir = path.join(this.root, "sources");
    this.libraryPath = path.join(this.root, "library.json");
    this.vectorIndex = new LocalVectorIndex(this.root);
  }

  async listSources(): Promise<KnowledgeSource[]> {
    return (await this.readLibrary()).sources;
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
      await this.vectorIndex.upsertMany(
        source.pages
          .filter((page) => Boolean(page.text?.trim()))
          .map((page) => ({
            id: page.id,
            sourceId: source.id,
            pageNumber: page.pageNumber,
            text: page.text ?? "",
          })),
      );
    }
    return added;
  }

  async search(query: string, limit = 12) {
    return this.vectorIndex.search(query, limit);
  }

  async extractPages(sourceId: string, pageNumbers: number[]): Promise<Uint8Array> {
    const source = (await this.readLibrary()).sources.find((item) => item.id === sourceId);
    if (!source) throw new Error("knowledge source not found");
    const sourceBytes = await fs.readFile(source.storedPath);
    const input = await PDFDocument.load(sourceBytes);
    const output = await PDFDocument.create();
    const uniquePages = [...new Set(pageNumbers)]
      .filter((page) => Number.isInteger(page) && page >= 1 && page <= input.getPageCount())
      .map((page) => page - 1);
    if (uniquePages.length === 0) throw new Error("no valid pages selected");
    const copied = await output.copyPages(input, uniquePages);
    for (const page of copied) output.addPage(page);
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
