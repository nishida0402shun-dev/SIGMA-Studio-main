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

type StoredEntry = {
  id: string;
  conversation_id: string;
  role: ConversationMemoryRole;
  content: string;
  provider: string | null;
  created_at: string;
  metadata_json: string;
};

const ENTRY_LIMIT = 20_000;
const CONTENT_LIMIT = 50_000;
const SEARCH_CANDIDATE_LIMIT = 500;

export class SqliteConversationMemoryStore {
  constructor(private readonly database: DatabaseSync) {}

  async append(input: Omit<ConversationMemoryEntry, "id" | "createdAt">): Promise<ConversationMemoryEntry> {
    const entry = this.buildEntry(input);
    this.persist(entry);
    this.enforceRetention();
    return entry;
  }

  async appendCaptured(
    input: Omit<ConversationMemoryEntry, "id" | "createdAt"> & { captureKey: string },
  ): Promise<ConversationMemoryEntry | null> {
    const key = input.captureKey.trim();
    if (!key) throw new Error("conversation capture key is empty");

    const duplicate = this.database.prepare(
      "SELECT id FROM sigma_core_conversation_entries WHERE json_extract(metadata_json, '$.captureKey') = ? LIMIT 1",
    ).get(key);
    if (duplicate) return null;

    const { captureKey: _captureKey, ...fields } = input;
    const entry = this.buildEntry({ ...fields, metadata: { ...fields.metadata, captureKey: key } });
    this.persist(entry);
    this.enforceRetention();
    return entry;
  }

  async recent(conversationId?: string, limit = 20): Promise<ConversationMemoryEntry[]> {
    const count = boundedInteger(limit, 20, 1, 100);
    const rows = conversationId
      ? this.database.prepare(
          "SELECT * FROM sigma_core_conversation_entries WHERE conversation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?",
        ).all(conversationId, count)
      : this.database.prepare(
          "SELECT * FROM sigma_core_conversation_entries ORDER BY created_at DESC, rowid DESC LIMIT ?",
        ).all(count);
    return (rows as StoredEntry[]).map(decodeEntry);
  }

  async search(
    query: string,
    conversationId?: string,
    limit = 8,
  ): Promise<Array<ConversationMemoryEntry & { score: number }>> {
    const normalized = normalizeText(query);
    if (!normalized) return [];

    const tokens = tokenize(normalized);
    const terms = [...new Set([normalized, ...tokens])].slice(0, 65);
    const conditions = terms.map(() => "content LIKE ? ESCAPE '\\'").join(" OR ");
    const scope = conversationId ? "conversation_id = ? AND " : "";
    const parameters = terms;
    if (conversationId) parameters.unshift(conversationId);

    const rows = this.database.prepare(
      `SELECT * FROM sigma_core_conversation_entries WHERE ${scope}(${conditions}) ORDER BY created_at DESC LIMIT ?`,
    ).all(...parameters, SEARCH_CANDIDATE_LIMIT) as StoredEntry[];

    const now = Date.now();
    const scored = rows.map((row) => {
      const entry = decodeEntry(row);
      const content = normalizeText(entry.content);
      const phraseMatch = content.includes(normalized) ? 1 : 0;
      const matchedTerms = tokens.filter((term) => content.includes(term)).length;
      const lexicalMatch = tokens.length ? matchedTerms / tokens.length : phraseMatch;
      const ageDays = Math.max(0, (now - Date.parse(entry.createdAt)) / 86_400_000);
      const recency = Number.isFinite(ageDays) ? Math.max(0, 1 - ageDays / 30) : 0;
      return { ...entry, score: phraseMatch * 0.5 + lexicalMatch * 0.4 + recency * 0.1 };
    });

    return scored.filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, boundedInteger(limit, 8, 1, 50));
  }

  private buildEntry(
    input: Omit<ConversationMemoryEntry, "id" | "createdAt">,
  ): ConversationMemoryEntry {
    const conversationId = input.conversationId.trim();
    const content = input.content.trim();
    if (!conversationId) throw new Error("conversation id is empty");
    if (!content) throw new Error("conversation memory content is empty");
    if (content.length > CONTENT_LIMIT) throw new Error("conversation memory content is too long");
    if (!["user", "assistant", "system", "tool"].includes(input.role)) {
      throw new Error("invalid conversation memory role");
    }
    return {
      id: `mem_${randomUUID()}`,
      conversationId,
      role: input.role,
      content,
      ...(input.provider?.trim() ? { provider: input.provider.trim() } : {}),
      createdAt: new Date().toISOString(),
      ...(input.metadata && Object.keys(input.metadata).length ? { metadata: input.metadata } : {}),
    };
  }

  private persist(entry: ConversationMemoryEntry): void {
    this.database.prepare(
      `INSERT INTO sigma_core_conversation_entries
        (id, conversation_id, role, content, provider, created_at, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      entry.id,
      entry.conversationId,
      entry.role,
      entry.content,
      entry.provider ?? null,
      entry.createdAt,
      JSON.stringify(entry.metadata ?? {}),
    );
  }

  private enforceRetention(): void {
    this.database.prepare(
      `DELETE FROM sigma_core_conversation_entries
       WHERE id IN (
         SELECT id FROM sigma_core_conversation_entries
         ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET ?
       )`,
    ).run(ENTRY_LIMIT);
  }
}

function decodeEntry(row: StoredEntry): ConversationMemoryEntry {
  let metadata: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(row.metadata_json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      metadata = parsed as Record<string, unknown>;
    }
  } catch {
    // Corrupt optional metadata must not hide otherwise readable conversation content.
  }
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

function normalizeText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().trim();
}

function tokenize(value: string): string[] {
  return [...new Set(value.match(/[a-z0-9]+|[ぁ-んァ-ヶ一-龯]{2,}/giu) ?? [])].slice(0, 64);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, "\\$&");
}

function boundedInteger(value: number, fallback: number, min: number, max: number): number {
  const number = Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.max(min, Math.min(number || fallback, max));
}
