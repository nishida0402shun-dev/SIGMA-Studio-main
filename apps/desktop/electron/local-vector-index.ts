import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

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
const MODEL = "gte-small";
type Embedder = {
  embedOne(text: string): Float32Array | number[];
};

let embedderPromise: Promise<Embedder> | null = null;

async function getEmbedder(): Promise<Embedder> {
  if (!embedderPromise) {
    embedderPromise = (async () => {
      const runtime = globalThis as typeof globalThis & Record<string, unknown>;
      const previousModule = runtime["module"];
      const previousExports = runtime["exports"];
      const previousRequire = runtime["require"];
      const previousFilename = runtime["__filename"];
      const previousDirname = runtime["__dirname"];
      const requireFromSigma = createRequire(import.meta.url);
      const loaderPath = requireFromSigma.resolve("ruvector-onnx-embeddings-wasm/loader.js");
      const wasmPackageDir = path.join(path.dirname(loaderPath), "pkg");
      const wasmGluePath = path.join(wasmPackageDir, "ruvector_onnx_embeddings_wasm.js");
      Object.defineProperty(runtime, "module", {
        configurable: true,
        writable: true,
        value: { exports: {} },
      });
      Object.defineProperty(runtime, "exports", {
        configurable: true,
        writable: true,
        value: (runtime["module"] as { exports: Record<string, unknown> }).exports,
      });
      Object.defineProperty(runtime, "__filename", {
        configurable: true,
        writable: true,
        value: wasmGluePath,
      });
      Object.defineProperty(runtime, "__dirname", {
        configurable: true,
        writable: true,
        value: wasmPackageDir,
      });
      Object.defineProperty(runtime, "require", {
        configurable: true,
        writable: true,
        value: requireFromSigma,
      });
      try {
        const { createEmbedder } = await import("ruvector-onnx-embeddings-wasm/loader.js");
        return (await createEmbedder(MODEL)) as Embedder;
      } finally {
        if (previousModule === undefined) Reflect.deleteProperty(runtime, "module");
        else Object.defineProperty(runtime, "module", { configurable: true, writable: true, value: previousModule });
        if (previousExports === undefined) Reflect.deleteProperty(runtime, "exports");
        else Object.defineProperty(runtime, "exports", { configurable: true, writable: true, value: previousExports });
        if (previousRequire === undefined) Reflect.deleteProperty(runtime, "require");
        else Object.defineProperty(runtime, "require", { configurable: true, writable: true, value: previousRequire });
        if (previousFilename === undefined) Reflect.deleteProperty(runtime, "__filename");
        else Object.defineProperty(runtime, "__filename", { configurable: true, writable: true, value: previousFilename });
        if (previousDirname === undefined) Reflect.deleteProperty(runtime, "__dirname");
        else Object.defineProperty(runtime, "__dirname", { configurable: true, writable: true, value: previousDirname });
      }
    })().catch((error) => {
      embedderPromise = null;
      throw new Error(
        `Knowledge DB semantic embedding model could not be initialized: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }
  return embedderPromise;
}

async function embedText(text: string): Promise<number[]> {
  const embedder = await getEmbedder();
  const vector = Array.from(embedder.embedOne(text));
  if (vector.length !== DIMENSIONS) {
    throw new Error(`Unexpected embedding dimension: ${vector.length}; expected ${DIMENSIONS}`);
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
        const embedded = await Promise.all(batch.map((record) => embedText(record.text)));
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
    const queryVector = await embedText(normalized);
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
        migratedVectors.push(...await Promise.all(batch.map((record) => embedText(record.text))));
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
