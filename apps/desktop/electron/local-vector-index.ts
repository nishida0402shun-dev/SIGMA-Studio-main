import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export interface VectorRecord {
  id: string;
  sourceId: string;
  pageNumber: number;
  /** Zero-based chunk number within the source page. */
  chunkIndex: number;
  text: string;
  vector: number[];
}

interface VectorIndexFile {
  version: 3;
  dimensions: number;
  model: string;
  records: VectorRecord[];
}

export interface VectorSearchResult extends Omit<VectorRecord, "vector"> {
  score: number;
}

const DIMENSIONS = 384;
const MODEL = "ruri-v3-70m";
const MODEL_REPOSITORY = "sirasagi62/ruri-v3-70m-ONNX";
const MODEL_REVISION = "5e9cd15";
const MODEL_CACHE_DIR = path.join(
  process.env.SIGMA_STUDIO_MODEL_CACHE?.trim() || path.join(os.homedir(), ".sigma-studio", "models"),
  MODEL_REPOSITORY.replace(/[^a-zA-Z0-9._-]+/gu, "_"),
  MODEL_REVISION,
);
const MODEL_URL = `https://huggingface.co/${MODEL_REPOSITORY}/resolve/${MODEL_REVISION}/onnx/model_int8.onnx?download=true`;
const TOKENIZER_URL = `https://huggingface.co/${MODEL_REPOSITORY}/resolve/${MODEL_REVISION}/tokenizer.json?download=true`;

type Embedder = {
  embedOne(text: string): Float32Array | number[];
};

type WasmEmbeddingModule = {
  default?: () => Promise<unknown>;
  WasmEmbedder: {
    withConfig(modelBytes: Uint8Array, tokenizerJson: string, config: unknown): {
      embedOne(text: string): Float32Array;
    };
  };
  WasmEmbedderConfig: new () => {
    setMaxLength(length: number): unknown;
    setNormalize(normalize: boolean): unknown;
    setPooling(strategy: number): unknown;
  };
};

let embedderPromise: Promise<Embedder> | null = null;

async function downloadModelFile(url: string, outputPath: string): Promise<void> {
  try {
    await fs.access(outputPath);
    return;
  } catch {
    // First use or an interrupted previous download.
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Knowledge DB Japanese embedding model download failed (${response.status}): ${url}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength < 1024) {
    throw new Error(`Knowledge DB Japanese embedding model download was unexpectedly small: ${url}`);
  }
  const tempPath = outputPath + ".tmp";
  await fs.writeFile(tempPath, bytes);
  await fs.rename(tempPath, outputPath);
}

async function getEmbedder(): Promise<Embedder> {
  if (!embedderPromise) {
    embedderPromise = (async () => {
      const modelPath = path.join(MODEL_CACHE_DIR, "model_int8.onnx");
      const tokenizerPath = path.join(MODEL_CACHE_DIR, "tokenizer.json");
      await downloadModelFile(MODEL_URL, modelPath);
      await downloadModelFile(TOKENIZER_URL, tokenizerPath);

      const runtime = await import("ruvector-onnx-embeddings-wasm") as unknown as WasmEmbeddingModule;
      if (runtime.default) await runtime.default();
      const modelBytes = await fs.readFile(modelPath);
      const tokenizerJson = await fs.readFile(tokenizerPath, "utf8");
      let config: unknown = new runtime.WasmEmbedderConfig();
      config = (config as { setMaxLength(length: number): unknown }).setMaxLength(8192);
      config = (config as { setNormalize(normalize: boolean): unknown }).setNormalize(true);
      config = (config as { setPooling(strategy: number): unknown }).setPooling(0);
      const rawEmbedder = runtime.WasmEmbedder.withConfig(modelBytes, tokenizerJson, config);
      return {
        embedOne: (text: string) => rawEmbedder.embedOne(text),
      };
    })().catch((error) => {
      embedderPromise = null;
      throw new Error(
        `Knowledge DB Japanese semantic embedding model could not be initialized: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }
  return embedderPromise;
}

async function embedText(text: string, role: "query" | "document" | "generic" = "generic"): Promise<number[]> {
  const embedder = await getEmbedder();
  // Ruri retrieval prefixes are model protocol strings, not user-facing UI copy.
  // eslint-disable-next-line no-restricted-syntax
  const prefix = role === "query" ? "検索クエリ: " : role === "document" ? "検索文書: " : "";
  const vector = Array.from(embedder.embedOne(prefix + text));
  if (vector.length !== DIMENSIONS) {
    throw new Error(`Unexpected Japanese embedding dimension: ${vector.length}; expected ${DIMENSIONS}`);
  }
  return vector;
}

const indexLocks = new Map<string, Promise<void>>();

async function withIndexLock<T>(indexPath: string, task: () => Promise<T>): Promise<T> {
  const previous = indexLocks.get(indexPath) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  indexLocks.set(indexPath, queued);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (indexLocks.get(indexPath) === queued) indexLocks.delete(indexPath);
  }
}

export class LocalVectorIndex {
  private readonly indexPath: string;

  constructor(root: string) {
    this.indexPath = path.join(root, "vectors.json");
  }

  async upsert(record: Omit<VectorRecord, "vector">): Promise<void> {
    await this.upsertMany([record]);
  }

  async upsertMany(records: Array<Omit<VectorRecord, "vector">>): Promise<void> {
    if (records.length === 0) return;
    await withIndexLock(this.indexPath, async () => {
      const index = await this.read();
      const keys = new Set(records.map((record) => record.sourceId + ":" + record.pageNumber + ":" + record.chunkIndex));
      const next = index.records.filter((item) => !keys.has(item.sourceId + ":" + item.pageNumber + ":" + item.chunkIndex));
      const vectors: number[][] = [];
      const batchSize = 32;
      for (let start = 0; start < records.length; start += batchSize) {
        const batch = records.slice(start, start + batchSize);
        const embedded = await Promise.all(batch.map((record) => embedText(record.text, "document")));
        vectors.push(...embedded);
      }
      next.push(...records.map((record, index) => ({ ...record, vector: vectors[index] })));
      await this.write({ version: 3, dimensions: DIMENSIONS, model: MODEL, records: next });
    });
  }

  async hasSource(sourceId: string): Promise<boolean> {
    const index = await this.read();
    return index.records.some((item) => item.sourceId === sourceId);
  }

  async removeSource(sourceId: string): Promise<void> {
    await withIndexLock(this.indexPath, async () => {
      const index = await this.read();
      const next = index.records.filter((item) => item.sourceId !== sourceId);
      if (next.length !== index.records.length) {
        await this.write({ ...index, records: next });
      }
    });
  }

  async search(query: string, limit = 12): Promise<VectorSearchResult[]> {
    const normalized = query.trim();
    if (!normalized) return [];
    const queryVector = await embedText(normalized, "query");
    const index = await this.read();
    return index.records
      .map(({ vector, ...record }) => ({ ...record, score: cosine(queryVector, vector) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(limit, 50)));
  }

  private async read(): Promise<VectorIndexFile> {
    let raw: string;
    try {
      raw = await fs.readFile(this.indexPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { version: 3, dimensions: DIMENSIONS, model: MODEL, records: [] };
      }
      throw error;
    }

    let parsed: {
      version?: number;
      dimensions?: number;
      model?: string;
      records?: unknown;
    };
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      return { version: 3, dimensions: DIMENSIONS, model: MODEL, records: [] };
    }

    if (
      parsed.version === 3 &&
      parsed.dimensions === DIMENSIONS &&
      parsed.model === MODEL &&
      Array.isArray(parsed.records)
    ) {
      return parsed as VectorIndexFile;
    }

    // v2 contained deterministic hash vectors, not semantic embeddings.
    // Rebuild those records in-place so existing Knowledge DB content survives.
    // Migration errors intentionally propagate so the old index is never replaced by an empty one.
    if (parsed.version === 2 && parsed.dimensions === DIMENSIONS && Array.isArray(parsed.records)) {
      const oldRecords = parsed.records as VectorRecord[];
      const migratedVectors: number[][] = [];
      const batchSize = 32;
      for (let start = 0; start < oldRecords.length; start += batchSize) {
        const batch = oldRecords.slice(start, start + batchSize);
        migratedVectors.push(...await Promise.all(batch.map((record) => embedText(record.text, "document"))));
      }
      const migrated: VectorIndexFile = {
        version: 3,
        dimensions: DIMENSIONS,
        model: MODEL,
        records: oldRecords.map((record, index) => ({ ...record, vector: migratedVectors[index] })),
      };
      await this.write(migrated);
      return migrated;
    }

    return { version: 3, dimensions: DIMENSIONS, model: MODEL, records: [] };
  }

  private async write(index: VectorIndexFile): Promise<void> {
    await fs.mkdir(path.dirname(this.indexPath), { recursive: true });
    const temp = this.indexPath + ".tmp";
    await fs.writeFile(temp, JSON.stringify(index), "utf8");
    await fs.rename(temp, this.indexPath);
  }
}

export async function embed(text: string): Promise<number[]> {
  return embedText(text);
}

function cosine(a: number[], b: number[]): number {
  let score = 0;
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) score += a[index] * b[index];
  return score;
}
