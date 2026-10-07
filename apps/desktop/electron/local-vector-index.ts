import fs from "node:fs/promises";
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
const MODEL_PACKAGE = "ruvector-onnx-embeddings-wasm/loader.js";

type Embedder = {
  embedOne(text: string): Float32Array | number[];
};

let embedderPromise: Promise<Embedder> | null = null;

async function getEmbedder(): Promise<Embedder> {
  if (!embedderPromise) {
    embedderPromise = import(MODEL_PACKAGE).then(async ({ createEmbedder }) => {
      return (await createEmbedder(MODEL)) as Embedder;
    }).catch((error) => {
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
    const index = await this.read();
    const keys = new Set(records.map((record) => record.sourceId + ":" + record.pageNumber + ":" + record.chunkIndex));
    const next = index.records.filter((item) => !keys.has(item.sourceId + ":" + item.pageNumber + ":" + item.chunkIndex));
    const vectors = await Promise.all(records.map((record) => embedText(record.text)));
    next.push(...records.map((record, index) => ({ ...record, vector: vectors[index] })));
    await this.write({ version: 3, dimensions: DIMENSIONS, model: MODEL, records: next });
  }

  async hasSource(sourceId: string): Promise<boolean> {
    const index = await this.read();
    return index.records.some((item) => item.sourceId === sourceId);
  }

  async removeSource(sourceId: string): Promise<void> {
    const index = await this.read();
    const next = index.records.filter((item) => item.sourceId !== sourceId);
    if (next.length !== index.records.length) {
      await this.write({ ...index, records: next });
    }
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
    try {
      const raw = await fs.readFile(this.indexPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<VectorIndexFile>;
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
      if (parsed.version === 2 && parsed.dimensions === DIMENSIONS && Array.isArray(parsed.records)) {
        const oldRecords = parsed.records as VectorRecord[];
        const migratedVectors = await Promise.all(oldRecords.map((record) => embedText(record.text)));
        const migrated: VectorIndexFile = {
          version: 3,
          dimensions: DIMENSIONS,
          model: MODEL,
          records: oldRecords.map((record, index) => ({ ...record, vector: migratedVectors[index] })),
        };
        await this.write(migrated);
        return migrated;
      }
    } catch {
      // First launch, an incomplete index, or a stale legacy index.
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
