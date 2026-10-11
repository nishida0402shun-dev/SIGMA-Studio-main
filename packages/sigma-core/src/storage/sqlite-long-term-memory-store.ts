import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export interface LongTermMemory {
  id: string;
  content: string;
  conversationId: string;
  sourceEntryId: string;
  provider?: string;
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

type MemoryRecord = {
  id: string;
  memory_key: string;
  content_hash: string;
  normalized_content: string;
  content: string;
  conversation_id: string;
  source_entry_id: string;
  provider: string | null;
  confidence: number;
  created_at: string;
  updated_at: string;
  metadata_json: string;
};

const MEMORY_LIMIT = 10_000;
const CONTENT_LIMIT = 4_000;

export class SqliteLongTermMemoryStore {
  constructor(private readonly database: DatabaseSync) {}

  async remember(
    input: Omit<LongTermMemory, "id" | "createdAt" | "updatedAt">,
  ): Promise<LongTermMemory | null> {
    const content = normalizeContent(input.content);
    if (content.length < 4) return null;
    const conversationId = input.conversationId.trim();
    const sourceEntryId = input.sourceEntryId.trim();
    if (!conversationId) throw new Error("memory conversation id is empty");
    if (!sourceEntryId) throw new Error("memory source entry id is empty");

    const normalized = normalizeText(content);
    const contentHash = digest(normalized);
    const memoryKey = digest(conversationId + "\u0000" + normalized);
    const confidence = boundedConfidence(input.confidence);
    const timestamp = new Date().toISOString();

    const existing = this.database.prepare(
      "SELECT id FROM sigma_core_long_term_memories WHERE memory_key = ?",
    ).get(memoryKey) as { id: string } | undefined;

    if (existing) {
      this.database.prepare(
        `UPDATE sigma_core_long_term_memories
         SET updated_at = ?, confidence = MAX(confidence, ?), source_entry_id = ?
         WHERE id = ?`,
      ).run(timestamp, confidence, sourceEntryId, existing.id);
      return this.readById(existing.id);
    }

    const record: LongTermMemory = {
      id: `memory_${randomUUID()}`,
      content,
      conversationId,
      sourceEntryId,
      ...(input.provider?.trim() ? { provider: input.provider.trim() } : {}),
      confidence,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.database.prepare(
      `INSERT INTO sigma_core_long_term_memories
        (id, memory_key, content_hash, normalized_content, content, conversation_id,
         source_entry_id, provider, confidence, created_at, updated_at, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}')`,
    ).run(
      record.id, memoryKey, contentHash, normalized, record.content, record.conversationId,
      record.sourceEntryId, record.provider ?? null, record.confidence, record.createdAt, record.updatedAt,
    );
    this.enforceRetention();
    return record;
  }

  async recent(limit = 50): Promise<LongTermMemory[]> {
    const count = boundedInteger(limit, 50, 1, 200);
    const rows = this.database.prepare(
      "SELECT * FROM sigma_core_long_term_memories ORDER BY updated_at DESC, rowid DESC LIMIT ?",
    ).all(count) as MemoryRecord[];
    return rows.map(decodeMemory);
  }

  async search(query: string, limit = 20): Promise<LongTermMemory[]> {
    const normalized = normalizeText(query);
    if (!normalized) return [];
    const tokens = [...new Set(normalized.match(/[a-z0-9]+|[ぁ-んァ-ヶ一-龯]{2,}/giu) ?? [])].slice(0, 32);
    const terms = [...new Set([normalized, ...tokens])];
    const predicate = terms.map(() => "instr(normalized_content, ?) > 0").join(" OR ");
    const rows = this.database.prepare(
      `SELECT * FROM sigma_core_long_term_memories WHERE ${predicate}
       ORDER BY updated_at DESC LIMIT 1000`,
    ).all(...terms) as MemoryRecord[];

    return rows.map((row) => {
      const memory = decodeMemory(row);
      const text = row.normalized_content;
      const exact = text.includes(normalized) ? 1 : 0;
      const coverage = tokens.length ? tokens.filter((token) => text.includes(token)).length / tokens.length : exact;
      return { memory, score: exact * 0.6 + coverage * 0.4 };
    }).filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, boundedInteger(limit, 20, 1, 100))
      .map((item) => item.memory);
  }

  private readById(id: string): LongTermMemory {
    const row = this.database.prepare(
      "SELECT * FROM sigma_core_long_term_memories WHERE id = ?",
    ).get(id) as MemoryRecord;
    return decodeMemory(row);
  }

  private enforceRetention(): void {
    this.database.prepare(
      `DELETE FROM sigma_core_long_term_memories
       WHERE id IN (
         SELECT id FROM sigma_core_long_term_memories
         ORDER BY updated_at DESC, rowid DESC LIMIT -1 OFFSET ?
       )`,
    ).run(MEMORY_LIMIT);
  }
}

function decodeMemory(row: MemoryRecord): LongTermMemory {
  return {
    id: row.id,
    content: row.content,
    conversationId: row.conversation_id,
    sourceEntryId: row.source_entry_id,
    ...(row.provider ? { provider: row.provider } : {}),
    confidence: row.confidence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeContent(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").slice(0, CONTENT_LIMIT);
}

function normalizeText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().trim();
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function boundedConfidence(value: number): number {
  if (!Number.isFinite(value)) throw new Error("memory confidence must be finite");
  return Math.max(0, Math.min(1, value));
}

function boundedInteger(value: number, fallback: number, min: number, max: number): number {
  const integer = Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.max(min, Math.min(integer || fallback, max));
}
