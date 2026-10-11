import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { SqliteVectorIndex, type VectorRecord as CoreVectorRecord } from "../../../packages/sigma-core/src/index";

export interface VectorRecord {
  id: string;
  sourceId: string;
  pageNumber: number;
  /** Zero-based chunk number within the source page. */
  chunkIndex: number;
  text: string;
  vector: number[];
}

export interface VectorSearchResult extends Omit<VectorRecord, "vector"> {
  score: number;
}

const DIMENSIONS = 256;
// Text-only EmbeddingGemma 2 encoder; multimodal encoders are intentionally not loaded for the vector index.
const MODEL = "embeddinggemma-2-text";
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
  if (process.env.NODE_ENV === "test") {
    return { embed: async (texts) => texts.map((text) => testEmbed(text)) };
  }
  if (!embedderPromise) {
    embedderPromise = (async () => {
      const { env, AutoConfig, AutoModel, AutoTokenizer } = await import("@huggingface/transformers");
      env.cacheDir = MODEL_CACHE_DIR;
      env.allowRemoteModels = true;

      const config = await AutoConfig.from_pretrained(MODEL_REPOSITORY);
      const multimodalConfig = config as typeof config & {
        vision_config?: unknown;
        audio_config?: unknown;
      };
      multimodalConfig.vision_config = null;
      multimodalConfig.audio_config = null;

      const tokenizer = await AutoTokenizer.from_pretrained(MODEL_REPOSITORY);
      const model = await AutoModel.from_pretrained(MODEL_REPOSITORY, {
        config,
        device: "cpu",
        dtype: "q4",
      });

      return {
        embed: async (texts: string[]) => {
          if (texts.length === 0) return [];
          const inputs = await tokenizer(texts, { padding: true });
          const output = await model(inputs);
          const rows = output.sentence_embedding.tolist() as number[][];
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

export class LocalVectorIndex {
  private readonly coreIndex: SqliteVectorIndex;

  constructor(db: DatabaseSync) {
    this.coreIndex = new SqliteVectorIndex(db);
  }

  async upsert(record: Omit<VectorRecord, "vector">): Promise<void> {
    await this.upsertMany([record]);
  }

  async upsertMany(records: Array<Omit<VectorRecord, "vector">>): Promise<void> {
    if (records.length === 0) return;
    const vectors: number[][] = [];
    for (let start = 0; start < records.length; start += 32) {
      vectors.push(...await embedDocuments(records.slice(start, start + 32).map((record) => record.text)));
    }
    const coreRecords: CoreVectorRecord[] = records.map((record, index) => {
      const vector = vectors[index];
      if (!vector || vector.length !== DIMENSIONS || vector.some((value) => !Number.isFinite(value))) {
        throw new Error("Embedding model returned an invalid vector");
      }
      return {
        id: record.id,
        text: record.text,
        source: {
          sourceId: record.sourceId,
          displayName: record.sourceId,
          pageNumber: record.pageNumber,
          chunkIndex: record.chunkIndex,
        },
        embeddingModel: MODEL,
        dimensions: DIMENSIONS,
        vector,
      };
    });
    await this.coreIndex.upsertMany(coreRecords);
  }

  async hasSource(sourceId: string): Promise<boolean> {
    return this.coreIndex.hasSource(sourceId);
  }

  async removeSource(sourceId: string): Promise<void> {
    await this.coreIndex.removeSource(sourceId);
  }

  async search(query: string, limit = 12): Promise<VectorSearchResult[]> {
    const normalized = query.trim();
    if (!normalized) return [];
    const queryVector = await embedText(normalized, "query");
    const matches = await this.coreIndex.searchWithScores({ vector: queryVector, limit: Math.max(1, Math.min(Math.trunc(limit) || 1, 50)) });
    return matches.map(({ record, score }) => ({
      id: record.id,
      sourceId: record.source.sourceId,
      pageNumber: record.source.pageNumber ?? 1,
      chunkIndex: record.source.chunkIndex ?? 0,
      text: record.text,
      score,
    })).filter((item) => item.score > 0);
  }

  async hasRecords(): Promise<boolean> {
    return this.coreIndex.hasRecords();
  }
}

export async function embed(text: string): Promise<number[]> {
  return embedText(text);
}

function testEmbed(text: string): number[] {
  const vector = new Array<number>(DIMENSIONS).fill(0);
  const normalized = text.normalize("NFKC").toLocaleLowerCase();
  for (let index = 0; index < normalized.length; index += 1) {
    const code = normalized.codePointAt(index) ?? 0;
    vector[code % DIMENSIONS] += 1;
    if (index + 1 < normalized.length) {
      const pair = ((code * 257) + (normalized.codePointAt(index + 1) ?? 0)) % DIMENSIONS;
      vector[pair] += 0.5;
    }
  }
  let norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!norm) norm = 1;
  return vector.map((value) => value / norm);
}

function cosine(a: number[], b: number[]): number {
  let score = 0;
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) score += a[index] * b[index];
  return score;
}
