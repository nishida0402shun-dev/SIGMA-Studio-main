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

type MemoryRow = {
  id: string;
  content: string;
  conversation_id: string;
  source_entry_id: string;
  provider: string | null;
  confidence: number;
  created_at: string;
  updated_at: string;
};

export class SqliteLongTermMemoryStore {
  constructor(private readonly db: DatabaseSync) {}

  async remember(input: Omit<LongTermMemory, "id" | "createdAt" | "updatedAt">): Promise<LongTermMemory | null> {
    const content = input.content.normalize("NFKC").trim().replace(/\\s+/gu, " ").slice(0, 4000);
    if (content.length < 4) return null;
    const existingRow = this.db.prepare(
      "SELECT * FROM qe_long_term_memories WHERE content = ? AND conversation_id = ? LIMIT 1",
    ).get(content, input.conversationId) as MemoryRow | undefined;
    const now = new Date().toISOString();
    if (existingRow) {
      this.db.prepare(
        "UPDATE qe_long_term_memories SET updated_at = ?, confidence = MAX(confidence, ?) WHERE id = ?",
      ).run(now, clampConfidence(input.confidence), existingRow.id);
      return fromRow(this.db.prepare("SELECT * FROM qe_long_term_memories WHERE id = ?").get(existingRow.id) as MemoryRow);
    }

    const entry: LongTermMemory = {
      ...input,
      id: "ltm_" + randomUUID(),
      content,
      confidence: clampConfidence(input.confidence),
      createdAt: now,
      updatedAt: now,
    };
    this.db.prepare(`
      INSERT INTO qe_long_term_memories
        (id, content, conversation_id, source_entry_id, provider, confidence, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(entry.id, entry.content, entry.conversationId, entry.sourceEntryId, entry.provider ?? null,
      entry.confidence, entry.createdAt, entry.updatedAt);
    this.prune();
    return entry;
  }

  async recent(limit = 50): Promise<LongTermMemory[]> {
    const safeLimit = Math.max(1, Math.min(Math.trunc(limit) || 1, 200));
    return (this.db.prepare("SELECT * FROM qe_long_term_memories ORDER BY updated_at DESC, rowid DESC LIMIT ?")
      .all(safeLimit) as MemoryRow[]).map(fromRow);
  }

  async search(query: string, limit = 20): Promise<LongTermMemory[]> {
    const normalized = query.normalize("NFKC").toLocaleLowerCase().trim();
    if (!normalized) return [];
    const tokens = normalized.match(/[a-z0-9]+|[ぁ-んァ-ヶ一-龯]{2,}/giu) ?? [];
    const rows = this.db.prepare("SELECT * FROM qe_long_term_memories ORDER BY updated_at DESC LIMIT 10000").all() as MemoryRow[];
    return rows.map((row) => {
      const entry = fromRow(row);
      const text = entry.content.normalize("NFKC").toLocaleLowerCase();
      const hits = tokens.reduce((sum, token) => sum + (text.includes(token) ? 1 : 0), 0);
      return { entry, score: (text.includes(normalized) ? 1 : 0) * 0.6 + (tokens.length ? hits / tokens.length : 0) * 0.4 };
    }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(Math.trunc(limit) || 1, 100))).map((item) => item.entry);
  }

  private prune(): void {
    this.db.prepare(`
      DELETE FROM qe_long_term_memories
      WHERE id IN (
        SELECT id FROM qe_long_term_memories
        ORDER BY updated_at DESC, rowid DESC
        LIMIT -1 OFFSET 10000
      )
    `).run();
  }
}

function fromRow(row: MemoryRow): LongTermMemory {
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

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) throw new Error("memory confidence must be finite");
  return Math.max(0, Math.min(1, value));
}
