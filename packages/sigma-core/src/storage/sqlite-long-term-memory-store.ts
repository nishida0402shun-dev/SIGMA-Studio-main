import { randomUUID } from "node:crypto";
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
  content: string;
  conversation_id: string;
  source_entry_id: string;
  provider: string | null;
  confidence: number;
  created_at: string;
  updated_at: string;
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
    if (!input.conversationId.trim()) throw new Error("memory conversation id is empty");
    if (!input.sourceEntryId.trim()) throw new Error("memory source entry id is empty");

    const confidence = validateConfidence(input.confidence);
    const previous = this.database.prepare(
      "SELECT * FROM sigma_core_long_term_memories WHERE conversation_id = ? AND content = ? ORDER BY updated_at DESC LIMIT 1",
    ).get(input.conversationId, content) as MemoryRecord | undefined;
    const timestamp = new Date().toISOString();

    if (previous) {
      this.database.prepare(
        "UPDATE sigma_core_long_term_memories SET updated_at = ?, confidence = MAX(confidence, ?) WHERE id = ?",
      ).run(timestamp, confidence, previous.id);
      const refreshed = this.database.prepare(
        "SELECT * FROM sigma_core_long_term_memories WHERE id = ?",
      ).get(previous.id) as MemoryRecord;
      return decodeMemory(refreshed);
    }

    const memory: LongTermMemory = {
      id: `ltm_${randomUUID()}`,
      content,
      conversationId: input.conversationId.trim(),
      sourceEntryId: input.sourceEntryId.trim(),
      ...(input.provider?.trim() ? { provider: input.provider.trim() } : {}),
      confidence,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.database.prepare(
      `INSERT INTO sigma_core_long_term_memories
        (id, content, conversation_id, source_entry_id, provider, confidence, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      memory.id, memory.content, memory.conversationId, memory.sourceEntryId,
      memory.provider ?? null, memory.confidence, memory.createdAt, memory.updatedAt,
    );
    this.enforceRetention();
    return memory;
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
    const where = terms.map(() => "instr(lower(content), lower(?)) > 0").join(" OR ");
    const rows = this.database.prepare(
      `SELECT * FROM sigma_core_long_term_memories WHERE ${where}
       ORDER BY updated_at DESC LIMIT 1000`,
    ).all(...terms) as MemoryRecord[];

    return rows.map((row) => {
      const memory = decodeMemory(row);
      const text = normalizeText(memory.content);
      const phrase = text.includes(normalized) ? 1 : 0;
      const termCoverage = tokens.length
        ? tokens.filter((token) => text.includes(token)).length / tokens.length
        : phrase;
      return { memory, score: phrase * 0.6 + termCoverage * 0.4 };
    }).filter((result) => result.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, boundedInteger(limit, 20, 1, 100))
      .map((result) => result.memory);
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

function validateConfidence(value: number): number {
  if (!Number.isFinite(value)) throw new Error("memory confidence must be finite");
  return Math.max(0, Math.min(1, value));
}

function boundedInteger(value: number, fallback: number, min: number, max: number): number {
  const integer = Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.max(min, Math.min(integer || fallback, max));
}
