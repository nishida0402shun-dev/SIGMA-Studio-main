import path from "node:path";

type PdfModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type PdfDocument = Awaited<ReturnType<PdfModule["getDocument"]>["promise"]>;
type PdfLoadingTask = ReturnType<PdfModule["getDocument"]>;

export type PdfRenderErrorCode =
  | "PDF_PASSWORD_REQUIRED"
  | "PDF_CORRUPT"
  | "PDF_RENDER_FAILED"
  | "PAGE_NOT_FOUND";

export class PdfRenderError extends Error {
  readonly code: PdfRenderErrorCode;

  constructor(code: PdfRenderErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PdfRenderError";
    this.code = code;
  }
}

export interface RenderedPdfPage {
  png: Uint8Array;
  width: number;
  height: number;
  scale: number;
  pageCount: number;
}

interface CachedDocument {
  loading: PdfLoadingTask;
  pdf: PdfDocument;
  lastUsed: number;
}

interface CachedPage {
  page: RenderedPdfPage;
  lastUsed: number;
}

const MAX_DOCUMENTS = 2;
const MAX_PAGES = 12;
const MIN_SCALE = 0.5;
const MAX_SCALE = 4;
const MAX_DIMENSION = 2_400;

function toPdfJsUrl(packageRoot: string, subDir: string): string {
  // pdf.js requires forward slashes and a trailing slash on Windows.
  return path.join(packageRoot, subDir).replaceAll("\\", "/") + "/";
}

function classifyPdfError(error: unknown): PdfRenderError {
  const name = error && typeof error === "object" && "name" in error
    ? String((error as { name?: unknown }).name)
    : "";
  const message = error instanceof Error ? error.message : String(error);
  if (name === "PasswordException" || /password/i.test(message)) {
    return new PdfRenderError("PDF_PASSWORD_REQUIRED", "This PDF requires a password", { cause: error });
  }
  if (name === "InvalidPDFException" || /invalid pdf|format error/i.test(message)) {
    return new PdfRenderError("PDF_CORRUPT", "This PDF is damaged or is not a valid PDF", { cause: error });
  }
  return new PdfRenderError("PDF_RENDER_FAILED", message || "Failed to render the PDF page", { cause: error });
}

/**
 * Renders external PDF pages for the source viewer in the Electron main
 * process. Keeping pdf.js out of the renderer avoids both the `worker-src
 * 'none'` CSP exception and a second pagination model: these images are only
 * the original page, while SigmaDoc's own PageCanvas/OutputSession remains the
 * only pagination engine for teaching materials.
 */
export class SourcePdfPageRenderer {
  readonly #documents = new Map<string, CachedDocument>();
  readonly #pages = new Map<string, CachedPage>();
  #module: PdfModule | null = null;

  async #loadModule(): Promise<PdfModule> {
    this.#module ??= await import("pdfjs-dist/legacy/build/pdf.mjs");
    return this.#module;
  }

  async #getDocument(sourceId: string, bytes: Uint8Array): Promise<PdfDocument> {
    const existing = this.#documents.get(sourceId);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing.pdf;
    }

    const pdfjs = await this.#loadModule();
    const packageRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));
    const loading = pdfjs.getDocument({
      data: Uint8Array.from(bytes),
      cMapUrl: toPdfJsUrl(packageRoot, "cmaps"),
      cMapPacked: true,
      standardFontDataUrl: toPdfJsUrl(packageRoot, "standard_fonts"),
      wasmUrl: toPdfJsUrl(packageRoot, "wasm"),
      verbosity: 0,
    });
    try {
      const pdf = await loading.promise;
      this.#documents.set(sourceId, { loading, pdf, lastUsed: Date.now() });
      this.#evictDocuments();
      return pdf;
    } catch (error) {
      await loading.destroy().catch(() => undefined);
      throw classifyPdfError(error);
    }
  }

  #evictDocuments(): void {
    while (this.#documents.size > MAX_DOCUMENTS) {
      let oldestId: string | null = null;
      let oldestUsed = Number.POSITIVE_INFINITY;
      for (const [id, document] of this.#documents) {
        if (document.lastUsed < oldestUsed) {
          oldestId = id;
          oldestUsed = document.lastUsed;
        }
      }
      if (!oldestId) return;
      const oldest = this.#documents.get(oldestId);
      this.#documents.delete(oldestId);
      void oldest?.loading.destroy().catch(() => undefined);
      for (const key of this.#pages.keys()) {
        if (key.startsWith(`${oldestId}:`)) this.#pages.delete(key);
      }
    }
  }

  #cachePage(key: string, page: RenderedPdfPage): void {
    this.#pages.set(key, { page, lastUsed: Date.now() });
    while (this.#pages.size > MAX_PAGES) {
      let oldestKey: string | null = null;
      let oldestUsed = Number.POSITIVE_INFINITY;
      for (const [candidate, cached] of this.#pages) {
        if (cached.lastUsed < oldestUsed) {
          oldestKey = candidate;
          oldestUsed = cached.lastUsed;
        }
      }
      if (!oldestKey) return;
      this.#pages.delete(oldestKey);
    }
  }

  async renderPage(
    sourceId: string,
    bytes: Uint8Array,
    pageNumber: number,
    requestedScale = 1.5,
  ): Promise<RenderedPdfPage> {
    if (!Number.isInteger(pageNumber) || pageNumber < 1) {
      throw new PdfRenderError("PAGE_NOT_FOUND", "Page numbers are 1-based");
    }
    const safeScale = Number.isFinite(requestedScale) ? requestedScale : 1.5;
    const pdf = await this.#getDocument(sourceId, bytes);
    if (pageNumber > pdf.numPages) {
      throw new PdfRenderError("PAGE_NOT_FOUND", `Page ${pageNumber} does not exist`);
    }

    const cacheKey = `${sourceId}:${pageNumber}:${safeScale.toFixed(2)}`;
    const cached = this.#pages.get(cacheKey);
    if (cached) {
      cached.lastUsed = Date.now();
      return cached.page;
    }

    const page = await pdf.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const dimensionLimit = MAX_DIMENSION / Math.max(baseViewport.width, baseViewport.height);
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, safeScale, dimensionLimit));
    const viewport = page.getViewport({ scale });
    const canvasFactory = pdf.canvasFactory as unknown as {
      create: (width: number, height: number) => {
        canvas: { toBuffer: (format: string) => Buffer };
        context: CanvasRenderingContext2D;
      };
      destroy: (canvasAndContext: unknown) => void;
    };
    const canvasAndContext = canvasFactory.create(
      Math.max(1, Math.ceil(viewport.width)),
      Math.max(1, Math.ceil(viewport.height)),
    );
    try {
      await page.render({
        canvas: canvasAndContext.canvas as unknown as HTMLCanvasElement,
        canvasContext: canvasAndContext.context,
        viewport,
      }).promise;
      const png = canvasAndContext.canvas.toBuffer("image/png");
      const rendered: RenderedPdfPage = {
        png: new Uint8Array(png),
        width: Math.max(1, Math.ceil(viewport.width)),
        height: Math.max(1, Math.ceil(viewport.height)),
        scale,
        pageCount: pdf.numPages,
      };
      this.#cachePage(cacheKey, rendered);
      return rendered;
    } catch (error) {
      throw classifyPdfError(error);
    } finally {
      page.cleanup();
      canvasFactory.destroy(canvasAndContext);
    }
  }

  close(): void {
    for (const document of this.#documents.values()) {
      void document.loading.destroy().catch(() => undefined);
    }
    this.#documents.clear();
    this.#pages.clear();
  }
}
