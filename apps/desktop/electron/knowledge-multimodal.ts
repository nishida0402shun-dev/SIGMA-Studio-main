import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";

export const KNOWLEDGE_VISUAL_MODEL = "onnx-community/gemma-3-4b-it-ONNX";
export const KNOWLEDGE_VISUAL_ANALYSIS_VERSION = 1;
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

  const { createCanvas } = await import("@napi-rs/canvas");
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const packageRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));
  const toPdfJsUrl = (subDir: string) => path.join(packageRoot, subDir).replaceAll("\\", "/") + "/";

  const loading = getDocument({
    data: Uint8Array.from(bytes),
    cMapUrl: toPdfJsUrl("cmaps"),
    cMapPacked: true,
    standardFontDataUrl: toPdfJsUrl("standard_fonts"),
    wasmUrl: toPdfJsUrl("wasm"),
    isEvalSupported: false,
    verbosity: 0,
  });

  try {
    const document = await loading.promise;
    const page = await document.getPage(pageNumber);
    const originalViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(2, 2200 / Math.max(originalViewport.width, originalViewport.height));
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)));

    try {
      await page.render({
        canvas: null,
        canvasContext: canvas.getContext("2d") as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;
      await fs.mkdir(outputDir, { recursive: true });
      const outputPath = path.join(outputDir, `page-${pageNumber}.png`);
      await fs.writeFile(outputPath, canvas.toBuffer("image/png"));
      return outputPath;
    } finally {
      page.cleanup();
      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    await loading.destroy();
  }
}

let pipelinePromise: Promise<any> | null = null;
let inferenceQueue: Promise<void> = Promise.resolve();

async function getPipeline(): Promise<any> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      const cacheDir = process.env.SIGMA_STUDIO_MODEL_CACHE
        ? path.join(process.env.SIGMA_STUDIO_MODEL_CACHE, "gemma-3-4b-it")
        : path.join(process.env.HOME || process.env.USERPROFILE || process.cwd(), ".sigma-studio", "models", "gemma-3-4b-it");
      env.cacheDir = cacheDir;
      return pipeline("image-text-to-text", KNOWLEDGE_VISUAL_MODEL, {
        device: "cpu",
        dtype: "q4",
      });
    })();
  }
  return pipelinePromise;
}

function extractGeneratedText(output: any): string {
  const value = Array.isArray(output) ? output[0] : output;
  if (typeof value === "string") return value.trim();
  const generated = value?.generated_text;
  if (typeof generated === "string") return generated.trim();
  if (Array.isArray(generated)) {
    const last = generated.at(-1);
    if (typeof last === "string") return last.trim();
    if (last && typeof last.content === "string") return last.content.trim();
  }
  return "";
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

  const pipeline = await getPipeline();
  const { RawImage } = await import("@huggingface/transformers");
  const image = await RawImage.read(previewPath);
  const context = input.pageText?.trim()
    ? `The page's extracted text is below. Use it as supporting context, but inspect the image for information that extraction may have missed.\n\n${input.pageText.slice(0, 12000)}`
    : "There is little or no reliable extracted text. Read the page image directly.";

  const prompt = [
    "Analyze this document page for a local knowledge database.",
    "Return concise factual notes only.",
    "Capture visible text that extraction may miss, tables, figures, formulas, diagrams, handwritten content, layout relationships, headings, labels, and important visual evidence.",
    "Do not invent unreadable content. Explicitly say when something is uncertain.",
    context,
  ].join("\n\n");

  let output: any;
  inferenceQueue = inferenceQueue.then(async () => {
    output = await pipeline([{ role: "user", content: [{ type: "image", image }, { type: "text", text: prompt }] }], {
      max_new_tokens: 900,
      do_sample: false,
    });
  });
  await inferenceQueue;

  return {
    previewPath,
    analysis: extractGeneratedText(output),
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
