import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

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
  constructor(private readonly db: DatabaseSync) {}

  async upsert(record: Omit<VectorRecord, "vector">): Promise<void> {
    await this.upsertMany([record]);
  }

  async upsertMany(records: Array<Omit<VectorRecord, "vector">>): Promise<void> {
    if (records.length === 0) return;
    const vectors: number[][] = [];
    for (let start = 0; start < records.length; start += 32) {
      vectors.push(...await embedDocuments(records.slice(start, start + 32).map((record) => record.text)));
    }
    const now = new Date().toISOString();
    const upsert = this.db.prepare(`
      INSERT INTO qe_vector_records
        (id, source_id, page_number, chunk_index, model, dimensions, vector_json, text_content, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id, page_number, chunk_index, model) DO UPDATE SET
        id = excluded.id,
        dimensions = excluded.dimensions,
        vector_json = excluded.vector_json,
        text_content = excluded.text_content,
        updated_at = excluded.updated_at
    `);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      records.forEach((record, index) => {
        const vector = vectors[index];
        if (!vector || vector.length !== DIMENSIONS || vector.some((value) => !Number.isFinite(value))) {
          throw new Error("Embedding model returned an invalid vector");
        }
        upsert.run(record.id, record.sourceId, record.pageNumber, record.chunkIndex, MODEL,
          DIMENSIONS, JSON.stringify(vector), record.text, now);
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async hasSource(sourceId: string): Promise<boolean> {
    const row = this.db.prepare("SELECT 1 AS found FROM qe_vector_records WHERE source_id = ? LIMIT 1").get(sourceId) as { found?: number } | undefined;
    return Boolean(row?.found);
  }

  async removeSource(sourceId: string): Promise<void> {
    this.db.prepare("DELETE FROM qe_vector_records WHERE source_id = ?").run(sourceId);
  }

  async search(query: string, limit = 12): Promise<VectorSearchResult[]> {
    const normalized = query.trim();
    if (!normalized) return [];
    const queryVector = await embedText(normalized, "query");
    const rows = this.db.prepare(
      "SELECT id, source_id, page_number, chunk_index, text_content, vector_json FROM qe_vector_records WHERE model = ? AND dimensions = ?",
    ).all(MODEL, DIMENSIONS) as Array<{
      id: string; source_id: string; page_number: number; chunk_index: number; text_content: string; vector_json: string;
    }>;
    return rows.map((row) => {
      const { vector_json: vectorJson, ...record } = row;
      const vector = JSON.parse(vectorJson) as number[];
      return {
        id: record.id,
        sourceId: record.source_id,
        pageNumber: record.page_number,
        chunkIndex: record.chunk_index,
        text: record.text_content,
        score: cosine(queryVector, vector),
      };
    }).filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(Math.trunc(limit) || 1, 50)));
  }

  async hasRecords(): Promise<boolean> {
    const row = this.db.prepare("SELECT 1 AS found FROM qe_vector_records LIMIT 1").get() as { found?: number } | undefined;
    return Boolean(row?.found);
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
