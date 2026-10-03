import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type KnowledgeStructureBlockType = "text" | "title" | "table" | "figure" | "formula" | "caption" | "unknown";

export interface KnowledgeStructureBlock {
  type: KnowledgeStructureBlockType;
  text: string;
  confidence?: number;
  bbox?: [number, number, number, number];
  html?: string;
}

export interface StructurePageResult {
  pageNumber: number;
  text: string;
  blocks: KnowledgeStructureBlock[];
}

export interface StructureParserStatus {
  available: boolean;
  engine: "pp-structurev3" | null;
  pythonPath: string | null;
  error?: string;
}

const WRAPPER = `
import json, sys
from paddleocr import PPStructureV3

pdf_path = sys.argv[1]
out_path = sys.argv[2]
pipeline = PPStructureV3(
    lang="japan",
    use_doc_orientation_classify=False,
    use_doc_unwarping=False,
    use_textline_orientation=True,
)
results = pipeline.predict(pdf_path)
pages = []
for index, result in enumerate(results, 1):
    data = result.json if hasattr(result, "json") else {}
    if callable(data):
        data = data()
    if isinstance(data, str):
        data = json.loads(data)
    if not isinstance(data, dict):
        data = {}
    pages.append({"pageNumber": index, "result": data})
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(pages, f, ensure_ascii=False)
`;

export class KnowledgeStructureParser {
  private readonly pythonPath: string;

  constructor(pythonPath = process.env.SIGMA_PADDLEOCR_PYTHON?.trim() || process.env.PYTHON?.trim() || (process.platform === "win32" ? "python" : "python3")) {
    this.pythonPath = pythonPath;
  }

  async getStatus(): Promise<StructureParserStatus> {
    try {
      await this.runPython(["-c", "import paddleocr; from paddleocr import PPStructureV3; print('ok')"], 15_000);
      return { available: true, engine: "pp-structurev3", pythonPath: this.pythonPath };
    } catch (error) {
      return {
        available: false,
        engine: null,
        pythonPath: this.pythonPath,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async parsePdf(pdfPath: string): Promise<StructurePageResult[]> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sigma-structure-"));
    const wrapperPath = path.join(tempDir, "runner.py");
    const outputPath = path.join(tempDir, "result.json");
    try {
      await fs.writeFile(wrapperPath, WRAPPER, "utf8");
      await this.runPython([wrapperPath, pdfPath, outputPath], 20 * 60_000);
      const raw = JSON.parse(await fs.readFile(outputPath, "utf8")) as unknown;
      return normalizeStructureResults(raw);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  private runPython(args: string[], timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.pythonPath, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`PP-StructureV3 timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      child.stdout.on("data", (chunk) => { stdout += String(chunk); });
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(new Error(`PP-StructureV3 Python runtime unavailable: ${error.message}`));
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(stdout.trim());
        else reject(new Error(stderr.trim() || `PP-StructureV3 exited with code ${code ?? "unknown"}`));
      });
    });
  }
}

function normalizeStructureResults(raw: unknown): StructurePageResult[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry, index) => {
    const item = isRecord(entry) ? entry : {};
    const pageNumber = Number(item.pageNumber) || index + 1;
    const result = isRecord(item.result) ? item.result : {};
    const blocks = extractBlocks(result);
    const text = blocks.map((block) => block.text).filter(Boolean).join("\n").trim();
    return { pageNumber, text, blocks };
  });
}

function extractBlocks(result: Record<string, unknown>): KnowledgeStructureBlock[] {
  const candidates = [
    result.layout_parsing_res_list,
    result.layout_det_res,
    result.layout_res,
    result.parsing_res_list,
  ];
  const source = candidates.find(Array.isArray) as unknown[] | undefined;
  if (!source) {
    const fallback = typeof result.text === "string" ? result.text.trim() : "";
    return fallback ? [{ type: "text", text: fallback }] : [];
  }
  return source.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const text = firstString(candidate.text, candidate.content, candidate.html);
    if (!text) return [];
    const type = normalizeBlockType(firstString(candidate.type, candidate.label, candidate.category));
    const confidence = firstNumber(candidate.confidence, candidate.score);
    const bbox = normalizeBbox(candidate.bbox, candidate.box);
    const html = typeof candidate.html === "string" ? candidate.html : undefined;
    return [{ type, text, ...(confidence !== undefined ? { confidence } : {}), ...(bbox ? { bbox } : {}), ...(html ? { html } : {}) }];
  });
}

function normalizeBlockType(value: string): KnowledgeStructureBlockType {
  const normalized = value.toLowerCase();
  if (normalized.includes("table")) return "table";
  if (normalized.includes("formula") || normalized.includes("equation")) return "formula";
  if (normalized.includes("figure") || normalized.includes("image")) return "figure";
  if (normalized.includes("caption")) return "caption";
  if (normalized.includes("title") || normalized.includes("header")) return "title";
  return normalized.includes("text") ? "text" : "unknown";
}

function firstString(...values: unknown[]): string {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim() ?? "";
}

function firstNumber(...values: unknown[]): number | undefined {
  return values.find((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function normalizeBbox(...values: unknown[]): [number, number, number, number] | undefined {
  const value = values.find((candidate) => Array.isArray(candidate) && candidate.length >= 4);
  if (!Array.isArray(value)) return undefined;
  const numbers = value.slice(0, 4).map(Number);
  return numbers.every(Number.isFinite) ? [numbers[0]!, numbers[1]!, numbers[2]!, numbers[3]!] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
