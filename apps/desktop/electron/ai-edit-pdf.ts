import path from "node:path";
import { createCurrentLocaleTranslator } from "@/lib/i18n";

const te = createCurrentLocaleTranslator("error");

export interface AttachedPdfPages {
  pageCount: number;
  pages: Array<{ pageNumber: number; text: string; previewFile: string }>;
  nextPageStart: number | null;
}

/**
 * Windows環境対応ヘルパー:
 * pdfjs-dist の factory URL は Windows のバックスラッシュ(\)ではなく
 * フォワードスラッシュ(/) かつ末尾スラッシュ(/) を要求するため変換します。
 */
function toPdfJsUrl(packageRoot: string, subDir: string): string {
  return path.join(packageRoot, subDir).replaceAll("\\", "/") + "/";
}

/** Derived AI input only: the original PDF stays in the run's attachments. */
export async function renderAttachedPdfPages(
  bytes: Uint8Array,
  options: {
    pageStart: number;
    writePage: (pageNumber: number, png: Buffer) => Promise<string>;
    onPageImage?: (pageNumber: number, png: Buffer) => void;
  },
): Promise<AttachedPdfPages> {
  if (!Number.isSafeInteger(options.pageStart) || options.pageStart < 1) {
    throw new Error(te("electron.pdfAttachment.invalidPageStart"));
  }

  // Keep the ESM library external to the Electron/MCP CommonJS bundles.
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const packageRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));

  const loading = getDocument({
    data: Uint8Array.from(bytes),
    cMapUrl: toPdfJsUrl(packageRoot, "cmaps"),
    cMapPacked: true,
    standardFontDataUrl: toPdfJsUrl(packageRoot, "standard_fonts"),
    wasmUrl: toPdfJsUrl(packageRoot, "wasm"),
    verbosity: 0,
  });

  try {
    const pdf = await loading.promise;
    if (options.pageStart > pdf.numPages) {
      throw new Error(te("electron.pdfAttachment.pageOutOfRange", { count: pdf.numPages }));
    }
    const end = Math.min(pdf.numPages, options.pageStart + 3);
    const pages: AttachedPdfPages["pages"] = [];
    for (let pageNumber = options.pageStart; pageNumber <= end; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const originalViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(2, 2000 / Math.max(originalViewport.width, originalViewport.height));
      const viewport = page.getViewport({ scale });
      const canvasAndContext = pdf.canvasFactory.create(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)));
      try {
        await page.render({
          canvasContext: canvasAndContext.context,
          viewport,
        }).promise;
        const content = await page.getTextContent();
        const text = content.items.map((item) => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join("");
        const png = canvasAndContext.canvas.toBuffer("image/png");
        const previewFile = await options.writePage(pageNumber, png);
        pages.push({ pageNumber, text, previewFile });
        options.onPageImage?.(pageNumber, png);
      } finally {
        page.cleanup();
        pdf.canvasFactory.destroy(canvasAndContext);
      }
    }
    return { pageCount: pdf.numPages, pages, nextPageStart: end < pdf.numPages ? end + 1 : null };
  } finally {
    await loading.destroy();
  }
}