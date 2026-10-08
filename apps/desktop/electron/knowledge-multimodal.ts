import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { KnowledgeStructureParser } from "./knowledge-db-structure-parser";

export const KNOWLEDGE_VISUAL_MODEL = "PaddleOCR PP-StructureV3";
export const KNOWLEDGE_VISUAL_ANALYSIS_VERSION = 2;
export type KnowledgeVisualMode = "auto" | "all" | "off";

function visualMode(): KnowledgeVisualMode {
  const value = process.env.SIGMA_STUDIO_KNOWLEDGE_VISUAL_MODE?.trim().toLowerCase();
  return value === "all" || value === "off" ? value : "auto";
}

function isPdf(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === ".pdf";
}

async function renderPdfPage(filePath: string, pageNumber: number, outputDir: string): Promise<string> {
  const bytes = await fs.readFile(filePath);
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: false });
  if (pageNumber < 1 || pageNumber > pdf.getPageCount()) {
    throw new Error(`PDF page out of range: ${pageNumber}`);
  }

  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const packageRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));
  const toPdfJsUrl = (subDir: string) => path.join(packageRoot, subDir).replaceAll("\\", "/") + "/";

  const loading = getDocument({
    data: Uint8Array.from(bytes),
    cMapUrl: toPdfJsUrl("cmaps"),
    cMapPacked: true,
    standardFontDataUrl: toPdfJsUrl("standard_fonts"),
    wasmUrl: toPdfJsUrl("wasm"),
    verbosity: 0,
  });

  try {
    const document = await loading.promise;
    const page = await document.getPage(pageNumber);
    const originalViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(2, 2200 / Math.max(originalViewport.width, originalViewport.height));
    const viewport = page.getViewport({ scale });
    const canvasFactory = document.canvasFactory as unknown as { create: (width: number, height: number) => { canvas: { toBuffer: (format: string) => Buffer; }; context: CanvasRenderingContext2D }; destroy: (canvasAndContext: unknown) => void };
    const canvasAndContext = canvasFactory.create(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)));

    try {
      await page.render({
        canvas: canvasAndContext.canvas as unknown as HTMLCanvasElement,
        canvasContext: canvasAndContext.context,
        viewport,
      }).promise;
      await fs.mkdir(outputDir, { recursive: true });
      const outputPath = path.join(outputDir, `page-${pageNumber}.png`);
      await fs.writeFile(outputPath, canvasAndContext.canvas.toBuffer("image/png"));
      return outputPath;
    } finally {
      page.cleanup();
      canvasFactory.destroy(canvasAndContext);
    }
  } finally {
    await loading.destroy();
  }
}

let parserPromise: Promise<KnowledgeStructureParser> | null = null;

async function parseVisualPage(imagePath: string): Promise<string> {
  if (!parserPromise) {
    parserPromise = Promise.resolve(new KnowledgeStructureParser());
  }
  const parser = await parserPromise;
  const pages = await parser.parseImage(imagePath);
  const page = pages[0];
  if (!page) return "";

  return page.blocks
    .map((block) => {
      const prefix = block.type === "unknown" ? "visual" : block.type;
      const confidence = block.confidence === undefined ? "" : ` (confidence ${block.confidence.toFixed(2)})`;
      return `[${prefix}]${confidence} ${block.text}`;
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

export async function analyzeKnowledgeVisualPage(input: {
  filePath: string;
  pageNumber: number;
  pageText?: string;
  dataDir: string;
  force?: boolean;
}): Promise<{
  previewPath: string;
  analysis: string;
  model: string;
  version: number;
}> {
  const extension = path.extname(input.filePath).toLowerCase();
  if (!isPdf(input.filePath) && ![".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"].includes(extension)) {
    throw new Error("Visual knowledge analysis supports PDF and image sources only.");
  }

  const previewDir = path.join(input.dataDir, "knowledge-db", "visual-pages");
  const previewPath = isPdf(input.filePath)
    ? await renderPdfPage(input.filePath, input.pageNumber, path.join(previewDir, path.basename(input.filePath, extension)))
    : input.filePath;

  const analysis = await parseVisualPage(previewPath);
  const contextual = input.pageText?.trim()
    ? `[extracted-context]\n${input.pageText.slice(0, 12000)}`
    : "";

  return {
    previewPath,
    analysis: [analysis, contextual].filter(Boolean).join("\n"),
    model: KNOWLEDGE_VISUAL_MODEL,
    version: KNOWLEDGE_VISUAL_ANALYSIS_VERSION,
  };
}

export function shouldRunKnowledgeVisualAnalysis(input: {
  filePath: string;
  pageText?: string;
  extractionStatus?: string;
  hasFigureOrTable?: boolean;
  force?: boolean;
}): boolean {
  if (input.force) return true;
  const mode = visualMode();
  if (mode === "off") return false;
  if (mode === "all") return isPdf(input.filePath) || path.extname(input.filePath).toLowerCase() !== ".txt";
  if (!isPdf(input.filePath)) return true;
  return input.extractionStatus === "ocr-needed"
    || !input.pageText?.trim()
    || input.pageText.trim().length < 500
    || Boolean(input.hasFigureOrTable);
}
