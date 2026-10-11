import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type ConversationMemoryRole = "user" | "assistant" | "system" | "tool";

export interface ConversationMemoryEntry {
  id: string;
  conversationId: string;
  role: ConversationMemoryRole;
  content: string;
  provider?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

type EntryRow = {
  id: string;
  conversation_id: string;
  role: ConversationMemoryRole;
  content: string;
  provider: string | null;
  created_at: string;
  metadata_json: string;
};

const MAX_ENTRIES = 20_000;
const MAX_CONTENT_LENGTH = 50_000;

export class SqliteConversationMemoryStore {
  constructor(private readonly db: DatabaseSync) {}

  async append(input: Omit<ConversationMemoryEntry, "id" | "createdAt">): Promise<ConversationMemoryEntry> {
    const content = input.content.trim();
    if (!content) throw new Error("conversation memory content is empty");
    if (content.length > MAX_CONTENT_LENGTH) throw new Error("conversation memory content is too long");
    const entry: ConversationMemoryEntry = {
      ...input,
      id: "mem_" + randomUUID(),
      content,
      createdAt: new Date().toISOString(),
    };
    this.insert(entry);
    this.prune();
    return entry;
  }

  async appendCaptured(
    input: Omit<ConversationMemoryEntry, "id" | "createdAt"> & { captureKey: string },
  ): Promise<ConversationMemoryEntry | null> {
    const captureKey = input.captureKey.trim();
    if (!captureKey) throw new Error("conversation capture key is empty");
    const existing = this.db.prepare(
      "SELECT id FROM qe_conversation_entries WHERE json_extract(metadata_json, '$.captureKey') = ? LIMIT 1",
    ).get(captureKey);
    if (existing) return null;
    const { captureKey: _captureKey, ...entryInput } = input;
    const content = entryInput.content.trim();
    if (!content) throw new Error("conversation memory content is empty");
    if (content.length > MAX_CONTENT_LENGTH) throw new Error("conversation memory content is too long");
    const entry: ConversationMemoryEntry = {
      ...entryInput,
      id: "mem_" + randomUUID(),
      content,
      createdAt: new Date().toISOString(),
      metadata: { ...entryInput.metadata, captureKey },
    };
    this.insert(entry);
    this.prune();
    return entry;
  }

  async recent(conversationId?: string, limit = 20): Promise<ConversationMemoryEntry[]> {
    const safeLimit = Math.max(1, Math.min(Math.trunc(limit) || 1, 100));
    const rows = conversationId
      ? this.db.prepare("SELECT * FROM qe_conversation_entries WHERE conversation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?").all(conversationId, safeLimit)
      : this.db.prepare("SELECT * FROM qe_conversation_entries ORDER BY created_at DESC, rowid DESC LIMIT ?").all(safeLimit);
    return (rows as EntryRow[]).map(fromRow);
  }

  async search(query: string, conversationId?: string, limit = 8): Promise<Array<ConversationMemoryEntry & { score: number }>> {
    const normalized = query.normalize("NFKC").toLocaleLowerCase().trim();
    if (!normalized) return [];
    const tokens = tokenize(normalized);
    const safeLimit = Math.max(1, Math.min(Math.trunc(limit) || 1, 50));
    // FTS narrows the candidate set; LIKE is a fallback for scripts that FTS tokenizes poorly.
    const ftsQuery = tokens.map((token) => '"' + token.replace(/"/gu, '""') + '"').join(" OR ");
    let rows: EntryRow[] = [];
    if (ftsQuery) {
      try {
        const sql = conversationId
          ? "SELECT e.* FROM qe_conversation_entries e JOIN qe_conversation_entries_fts ON qe_conversation_entries_fts.entry_id = e.id WHERE qe_conversation_entries_fts MATCH ? AND e.conversation_id = ? ORDER BY e.created_at DESC LIMIT 500"
          : "SELECT e.* FROM qe_conversation_entries e JOIN qe_conversation_entries_fts ON qe_conversation_entries_fts.entry_id = e.id WHERE qe_conversation_entries_fts MATCH ? ORDER BY e.created_at DESC LIMIT 500";
        rows = (conversationId
          ? this.db.prepare(sql).all(ftsQuery, conversationId)
          : this.db.prepare(sql).all(ftsQuery)) as EntryRow[];
      } catch {
        rows = [];
      }
    }
    // Always add a LIKE-based candidate pass: unicode61 does not reliably segment
    // Japanese text, and an FTS partial hit must not hide other matching entries.
    const likeTokens = [...new Set([normalized, ...tokens])].slice(0, 65);
    if (likeTokens.length) {
      const predicate = likeTokens.map(() => "content LIKE ? ESCAPE '\\'").join(" OR ");
      const sql = conversationId
        ? `SELECT * FROM qe_conversation_entries WHERE conversation_id = ? AND (${predicate}) ORDER BY created_at DESC LIMIT 500`
        : `SELECT * FROM qe_conversation_entries WHERE ${predicate} ORDER BY created_at DESC LIMIT 500`;
      const parameters = likeTokens.map((token) => "%" + escapeLike(token) + "%");
      const likeRows = (conversationId
        ? this.db.prepare(sql).all(conversationId, ...parameters)
        : this.db.prepare(sql).all(...parameters)) as EntryRow[];
      const merged = new Map(rows.map((row) => [row.id, row]));
      for (const row of likeRows) merged.set(row.id, row);
      rows = [...merged.values()];
    }

    const now = Date.now();
    return rows.map((row) => {
      const entry = fromRow(row);
      const text = entry.content.normalize("NFKC").toLocaleLowerCase();
      const tokenHits = tokens.reduce((sum, token) => sum + (text.includes(token) ? 1 : 0), 0);
      const phrase = text.includes(normalized) ? 1 : 0;
      const ageDays = Math.max(0, (now - Date.parse(entry.createdAt)) / 86_400_000);
      const recency = Math.max(0, 1 - ageDays / 30);
      const score = phrase * 0.45 + (tokens.length ? tokenHits / tokens.length : 0) * 0.45 + recency * 0.1;
      return { ...entry, score };
    }).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score).slice(0, safeLimit);
  }

  private insert(entry: ConversationMemoryEntry): void {
    this.db.prepare(`
      INSERT INTO qe_conversation_entries
        (id, conversation_id, role, content, provider, created_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.id,
      entry.conversationId,
      entry.role,
      entry.content,
      entry.provider ?? null,
      entry.createdAt,
      JSON.stringify(entry.metadata ?? {}),
    );
  }

  private prune(): void {
    this.db.prepare(`
      DELETE FROM qe_conversation_entries
      WHERE id IN (
        SELECT id FROM qe_conversation_entries
        ORDER BY created_at DESC, rowid DESC
        LIMIT -1 OFFSET ?
      )
    `).run(MAX_ENTRIES);
  }
}

function fromRow(row: EntryRow): ConversationMemoryEntry {
  const metadata = JSON.parse(row.metadata_json) as Record<string, unknown>;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    ...(row.provider ? { provider: row.provider } : {}),
    createdAt: row.created_at,
    ...(Object.keys(metadata).length ? { metadata } : {}),
  };
}

function tokenize(value: string): string[] {
  const tokens = value.match(/[a-z0-9]+|[ぁ-んァ-ヶ一-龯]{2,}/giu) ?? [];
  return [...new Set(tokens)].slice(0, 64);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, "\\$&");
}
