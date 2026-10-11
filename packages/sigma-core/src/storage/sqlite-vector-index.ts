import type { VectorIndex, VectorRecord, VectorSearchRequest } from "../knowledge/contracts.js";

/** Minimal structural subset implemented by node:sqlite's DatabaseSync. */
export interface SigmaSqliteDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): SigmaSqliteStatement;
}

export interface SigmaSqliteStatement {
  all(...parameters: unknown[]): unknown[];
  get(...parameters: unknown[]): unknown;
  run(...parameters: unknown[]): unknown;
}

interface StoredVectorRow {
  id: string;
  source_id: string;
  text_content: string;
  source_json: string;
  embedding_model: string;
  dimensions: number;
  vector_json: string;
}

/**
 * SIGMA-owned SQLite vector index. SQLite is the durable record store; vectors
 * are stored as JSON and ranked with cosine similarity. This portable baseline
 * intentionally avoids native extensions so it can ship with Electron.
 */
export class SqliteVectorIndex implements VectorIndex {
  constructor(private readonly db: SigmaSqliteDatabase) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sigma_core_vector_records (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        text_content TEXT NOT NULL,
        source_json TEXT NOT NULL,
        embedding_model TEXT NOT NULL,
        dimensions INTEGER NOT NULL CHECK (dimensions > 0),
        vector_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sigma_core_vector_source_idx
        ON sigma_core_vector_records(source_id);
      CREATE INDEX IF NOT EXISTS sigma_core_vector_model_idx
        ON sigma_core_vector_records(embedding_model, dimensions);
    `);
  }

  async upsertMany(records: readonly VectorRecord[], signal?: AbortSignal): Promise<void> {
    if (records.length === 0) return;
    for (const record of records) {
      throwIfAborted(signal);
      validateRecord(record);
    }

    const upsert = this.db.prepare(`
      INSERT INTO sigma_core_vector_records
        (id, source_id, text_content, source_json, embedding_model, dimensions, vector_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        source_id = excluded.source_id,
        text_content = excluded.text_content,
        source_json = excluded.source_json,
        embedding_model = excluded.embedding_model,
        dimensions = excluded.dimensions,
        vector_json = excluded.vector_json,
        updated_at = excluded.updated_at
    `);

    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const record of records) {
        throwIfAborted(signal);
        upsert.run(
          record.id,
          record.source.sourceId,
          record.text,
          JSON.stringify(record.source),
          record.embeddingModel,
          record.dimensions,
          JSON.stringify(record.vector),
          new Date().toISOString(),
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* preserve the original error */ }
      throw error;
    }
  }

  async search(request: VectorSearchRequest): Promise<readonly VectorRecord[]> {
    throwIfAborted(request.signal);
    if (!Number.isInteger(request.limit) || request.limit < 1) {
      throw new Error("limit must be a positive integer");
    }
    validateVector(request.vector, request.vector.length);
    if (request.vector.length === 0) throw new Error("query vector must not be empty");

    const rows = this.db.prepare(`
      SELECT id, source_id, text_content, source_json, embedding_model, dimensions, vector_json
      FROM sigma_core_vector_records
      WHERE dimensions = ?
      ORDER BY id
    `).all(request.vector.length) as StoredVectorRow[];
    const sourceFilter = request.sourceIds ? new Set(request.sourceIds) : null;
    const ranked: Array<{ record: VectorRecord; score: number }> = [];

    for (const row of rows) {
      throwIfAborted(request.signal);
      if (sourceFilter && !sourceFilter.has(row.source_id)) continue;
      const vector = parseVector(row.vector_json, row.dimensions);
      const score = cosineSimilarity(request.vector, vector);
      ranked.push({
        score,
        record: {
          id: row.id,
          text: row.text_content,
          source: JSON.parse(row.source_json) as VectorRecord["source"],
          embeddingModel: row.embedding_model,
          dimensions: row.dimensions,
          vector,
        },
      });
    }
    ranked.sort((left, right) => right.score - left.score || left.record.id.localeCompare(right.record.id));
    return ranked.slice(0, request.limit).map(({ record }) => record);
  }

  async removeSource(sourceId: string, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    if (!sourceId.trim()) throw new Error("sourceId is required");
    this.db.prepare("DELETE FROM sigma_core_vector_records WHERE source_id = ?").run(sourceId);
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Operation cancelled");
}

function validateVector(vector: readonly number[], dimensions: number): void {
  if (vector.length !== dimensions || vector.some((value) => !Number.isFinite(value))) {
    throw new Error("Vector must contain the expected number of finite values");
  }
}

function validateRecord(record: VectorRecord): void {
  if (!record.id.trim() || !record.source.sourceId.trim()) throw new Error("Vector record id and sourceId are required");
  if (!record.embeddingModel.trim()) throw new Error("embeddingModel is required");
  if (!Number.isInteger(record.dimensions) || record.dimensions < 1) throw new Error("dimensions must be a positive integer");
  validateVector(record.vector, record.dimensions);
}

function parseVector(json: string, dimensions: number): number[] {
  const value: unknown = JSON.parse(json);
  if (!Array.isArray(value) || value.some((item) => typeof item !== "number")) {
    throw new Error("Stored vector data is invalid");
  }
  validateVector(value as number[], dimensions);
  return value as number[];
}

function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]!;
    const b = right[index]!;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}
