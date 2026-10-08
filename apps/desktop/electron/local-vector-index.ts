import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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
  version: 4;
  dimensions: number;
  model: string;
  records: VectorRecord[];
}

export interface VectorSearchResult extends Omit<VectorRecord, "vector"> {
  score: number;
}

const DIMENSIONS = 256;
const MODEL = "embeddinggemma-2";
const MODEL_REPOSITORY = "onnx-community/embeddinggemma-2-ONNX";
const MODEL_CACHE_DIR = path.join(
  process.env.SIGMA_STUDIO_MODEL_CACHE?.trim() || path.join(os.homedir(), ".sigma-studio", "models"),
  "embeddinggemma-2",
);

interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
}

let embedderPromise: Promise<Embedder> | null = null;

async function getEmbedder(): Promise<Embedder> {
  if (!embedderPromise) {
    embedderPromise = (async () => {
      const { env, pipeline } = await import("@huggingface/transformers");
      env.cacheDir = MODEL_CACHE_DIR;
      env.allowRemoteModels = true;

      const extractor = await pipeline("feature-extraction", MODEL_REPOSITORY, {
        device: "cpu",
        dtype: "q4",
      });

      return {
        embed: async (texts: string[]) => {
          if (texts.length === 0) return [];
          const output = await extractor(texts, { pooling: "mean", normalize: true });
          const rows = output.tolist() as number[][];
          return rows.map((row) => {
            if (row.length < DIMENSIONS) {
              throw new Error(`EmbeddingGemma 2 returned ${row.length} dimensions; expected at least ${DIMENSIONS}`);
            }
            const truncated = row.slice(0, DIMENSIONS);
            let norm = 0;
            for (const value of truncated) norm += value * value;
            norm = Math.sqrt(norm);
            if (!Number.isFinite(norm) || norm === 0) {
              throw new Error("EmbeddingGemma 2 produced a non-finite or zero vector");
            }
            return truncated.map((value) => value / norm);
          });
        },
      };
    })().catch((error) => {
      embedderPromise = null;
      throw new Error(
        `Knowledge DB EmbeddingGemma 2 could not be initialized: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }
  return embedderPromise;
}

async function embedText(
  text: string,
  role: "query" | "document" | "generic" = "generic",
): Promise<number[]> {
  const embedder = await getEmbedder();
  const prefix =
    role === "query"
      ? "task: search result | query: "
      : role === "document"
        ? "title: none | text: "
        : "";
  const vectors = await embedder.embed([prefix + text]);
  const vector = vectors[0];
  if (!vector || vector.length !== DIMENSIONS) {
    throw new Error(`Unexpected EmbeddingGemma 2 dimension: ${vector?.length ?? 0}; expected ${DIMENSIONS}`);
  }
  return vector;
}

async function embedDocuments(texts: string[]): Promise<number[][]> {
  const embedder = await getEmbedder();
  if (texts.length === 0) return [];
  const vectors = await embedder.embed(texts.map((text) => "title: none | text: " + text));
  return vectors;
}

const indexLocks = new Map<string, Promise<void>>();

async function withIndexLock<T>(indexPath: string, task: () => Promise<T>): Promise<T> {
  const previous = indexLocks.get(indexPath) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
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
      const keys = new Set(
        records.map((record) => record.sourceId + ":" + record.pageNumber + ":" + record.chunkIndex),
      );
      const next = index.records.filter(
        (item) => !keys.has(item.sourceId + ":" + item.pageNumber + ":" + item.chunkIndex),
      );

      const vectors: number[][] = [];
      const batchSize = 32;
      for (let start = 0; start < records.length; start += batchSize) {
        const batch = records.slice(start, start + batchSize);
        vectors.push(...(await embedDocuments(batch.map((record) => record.text))));
      }

      next.push(...records.map((record, index) => ({ ...record, vector: vectors[index] })));
      await this.write({ version: 4, dimensions: DIMENSIONS, model: MODEL, records: next });
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
      .filter((record) => record.vector.length === DIMENSIONS)
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
        return { version: 4, dimensions: DIMENSIONS, model: MODEL, records: [] };
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
      return { version: 4, dimensions: DIMENSIONS, model: MODEL, records: [] };
    }

    if (
      parsed.version === 4 &&
      parsed.dimensions === DIMENSIONS &&
      parsed.model === MODEL &&
      Array.isArray(parsed.records)
    ) {
      return parsed as VectorIndexFile;
    }

    // Any previous semantic model (Ruri/GTE) uses incompatible vector semantics.
    // Re-embed persisted text instead of silently returning stale results.
    if (
      Array.isArray(parsed.records) &&
      ((parsed.version === 3 && parsed.dimensions === 384) ||
        (parsed.version === 4 && parsed.model !== MODEL))
    ) {
      const oldRecords = parsed.records as VectorRecord[];
      const migratedVectors: number[][] = [];
      const batchSize = 32;
      for (let start = 0; start < oldRecords.length; start += batchSize) {
        const batch = oldRecords.slice(start, start + batchSize);
        migratedVectors.push(...(await embedDocuments(batch.map((record) => record.text))));
      }
      const migrated: VectorIndexFile = {
        version: 4,
        dimensions: DIMENSIONS,
        model: MODEL,
        records: oldRecords.map((record, index) => ({ ...record, vector: migratedVectors[index] })),
      };
      await this.write(migrated);
      return migrated;
    }

    // v2 contained deterministic hash vectors. Preserve the records but rebuild
    // their vectors with the current semantic model.
    if (parsed.version === 2 && Array.isArray(parsed.records)) {
      const oldRecords = parsed.records as VectorRecord[];
      const migratedVectors: number[][] = [];
      const batchSize = 32;
      for (let start = 0; start < oldRecords.length; start += batchSize) {
        const batch = oldRecords.slice(start, start + batchSize);
        migratedVectors.push(...(await embedDocuments(batch.map((record) => record.text))));
      }
      const migrated: VectorIndexFile = {
        version: 4,
        dimensions: DIMENSIONS,
        model: MODEL,
        records: oldRecords.map((record, index) => ({ ...record, vector: migratedVectors[index] })),
      };
      await this.write(migrated);
      return migrated;
    }

    return { version: 4, dimensions: DIMENSIONS, model: MODEL, records: [] };
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
