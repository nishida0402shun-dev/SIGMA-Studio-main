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
  version: 2;
  dimensions: number;
  records: VectorRecord[];
}

export interface VectorSearchResult extends Omit<VectorRecord, "vector"> {
  score: number;
}

const DIMENSIONS = 384;
const TOKEN_RE = /[\p{L}\p{N}][\p{p}\p{L}\p{N}_-]*/gu;

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
    next.push(...records.map((record) => ({ ...record, vector: embed(record.text) })));
    await this.write({ version: 1, dimensions: DIMENSIONS, records: next });
  }

  async hasSource(sourceId: string): Promise<boolean> {
    const index = await this.read();
    return index.records.some((item) => item.sourceId === sourceId);
  }

  async removeSource(sourceId: string): Promise<void> {
    const index = await this.read();
    const next = index.records.filter((item) => item.sourceId !== sourceId);
    if (next.length !== index.records.length) await this.write({ ...index, records: next });
  }

  async search(query: string, limit = 12): Promise<VectorSearchResult[]> {
    const normalized = query.trim();
    if (!normalized) return [];
    const queryVector = embed(normalized);
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
      if (parsed.version === 2 && parsed.dimensions === DIMENSIONS && Array.isArray(parsed.records)) {
        return parsed as VectorIndexFile;
      }
    } catch {
      // First launch or an incomplete index.
    }
    return { version: 2, dimensions: DIMENSIONS, records: [] };
  }

  private async write(index: VectorIndexFile): Promise<void> {
    await fs.mkdir(path.dirname(this.indexPath), { recursive: true });
    const temp = this.indexPath + ".tmp";
    await fs.writeFile(temp, JSON.stringify(index), "utf8");
    await fs.rename(temp, this.indexPath);
  }
}

export function embed(text: string): number[] {
  const vector = new Array<number>(DIMENSIONS).fill(0);
  const tokens = tokenize(text);
  for (const token of tokens) {
    const hash = fnv1a(token);
    const index = hash % DIMENSIONS;
    const sign = (hash & 1) === 0 ? 1 : -1;
    vector[index] += sign;
    const second = (hash >>> 8) % DIMENSIONS;
    vector[second] += sign * 0.5;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm === 0 ? vector : vector.map((value) => value / norm);
}

function tokenize(text: string): string[] {
  return text.normalize("NFKC").toLocaleLowerCase().match(TOKEN_RE) ?? [];
}

function fnv1a(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function cosine(a: number[], b: number[]): number {
  let score = 0;
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) score += a[index] * b[index];
  return score;
}
