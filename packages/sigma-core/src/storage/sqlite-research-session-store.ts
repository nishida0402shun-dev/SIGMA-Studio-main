import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export interface ResearchSourceReference {
  sourceId: string;
  sourceName: string;
  pageNumber: number;
  pageId?: string;
}

export interface ResearchSession {
  id: string;
  title: string;
  query: string;
  sourceReferences: ResearchSourceReference[];
  createdAt: string;
  updatedAt: string;
}

type SessionRecord = {
  id: string;
  title: string;
  query_text: string;
  created_at: string;
  updated_at: string;
};

type ReferenceRecord = {
  source_id: string;
  source_name: string;
  page_number: number;
  page_id: string | null;
};

const SESSION_LIMIT = 200;
const REFERENCE_LIMIT = 500;

export class SqliteResearchSessionStore {
  constructor(private readonly database: DatabaseSync) {}

  async list(): Promise<ResearchSession[]> {
    const rows = this.database.prepare(
      "SELECT * FROM sigma_core_research_sessions ORDER BY updated_at DESC, rowid DESC",
    ).all() as SessionRecord[];
    return rows.map((row) => this.decodeSession(row));
  }

  async create(input: {
    title?: string;
    query: string;
    sourceReferences?: ResearchSourceReference[];
  }): Promise<ResearchSession> {
    const query = requireQuery(input.query);
    const now = new Date().toISOString();
    const session: ResearchSession = {
      id: `research_${randomUUID()}`,
      title: makeTitle(input.title, query),
      query,
      sourceReferences: normalizeReferences(input.sourceReferences ?? []),
      createdAt: now,
      updatedAt: now,
    };

    this.transaction(() => {
      this.database.prepare(
        "INSERT INTO sigma_core_research_sessions(id, title, query_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).run(session.id, session.title, session.query, session.createdAt, session.updatedAt);
      this.replaceReferences(session.id, session.sourceReferences);
      this.pruneSessions();
    });
    return session;
  }

  async update(
    id: string,
    patch: { title?: string; query?: string; sourceReferences?: ResearchSourceReference[] },
  ): Promise<ResearchSession | null> {
    const oldRow = this.database.prepare(
      "SELECT * FROM sigma_core_research_sessions WHERE id = ?",
    ).get(id) as SessionRecord | undefined;
    if (!oldRow) return null;

    const current = this.decodeSession(oldRow);
    const query = patch.query === undefined ? current.query : requireQuery(patch.query);
    const next: ResearchSession = {
      ...current,
      title: patch.title === undefined ? current.title : makeTitle(patch.title, query),
      query,
      sourceReferences: patch.sourceReferences === undefined
        ? current.sourceReferences
        : normalizeReferences(patch.sourceReferences),
      updatedAt: new Date().toISOString(),
    };

    this.transaction(() => {
      this.database.prepare(
        "UPDATE sigma_core_research_sessions SET title = ?, query_text = ?, updated_at = ? WHERE id = ?",
      ).run(next.title, next.query, next.updatedAt, id);
      if (patch.sourceReferences !== undefined) {
        this.replaceReferences(id, next.sourceReferences);
      }
    });
    return next;
  }

  async remove(id: string): Promise<boolean> {
    const result = this.database.prepare(
      "DELETE FROM sigma_core_research_sessions WHERE id = ?",
    ).run(id) as { changes: number | bigint };
    return Number(result.changes) > 0;
  }

  private decodeSession(row: SessionRecord): ResearchSession {
    return {
      id: row.id,
      title: row.title,
      query: row.query_text,
      sourceReferences: this.loadReferences(row.id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private loadReferences(sessionId: string): ResearchSourceReference[] {
    const rows = this.database.prepare(
      `SELECT source_id, source_name, page_number, page_id
       FROM sigma_core_research_references WHERE session_id = ? ORDER BY position`,
    ).all(sessionId) as ReferenceRecord[];
    return rows.map((row) => ({
      sourceId: row.source_id,
      sourceName: row.source_name,
      pageNumber: row.page_number,
      ...(row.page_id ? { pageId: row.page_id } : {}),
    }));
  }

  private replaceReferences(sessionId: string, references: ResearchSourceReference[]): void {
    this.database.prepare("DELETE FROM sigma_core_research_references WHERE session_id = ?").run(sessionId);
    const insert = this.database.prepare(
      `INSERT INTO sigma_core_research_references
        (session_id, source_id, source_name, page_number, page_id, position)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    references.forEach((reference, position) => {
      insert.run(sessionId, reference.sourceId, reference.sourceName, reference.pageNumber,
        reference.pageId ?? null, position);
    });
  }

  private pruneSessions(): void {
    this.database.prepare(
      `DELETE FROM sigma_core_research_sessions
       WHERE id IN (
         SELECT id FROM sigma_core_research_sessions
         ORDER BY updated_at DESC, rowid DESC LIMIT -1 OFFSET ?
       )`,
    ).run(SESSION_LIMIT);
  }

  private transaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      try { this.database.exec("ROLLBACK"); } catch { /* Preserve the primary error. */ }
      throw error;
    }
  }
}

function requireQuery(value: string): string {
  const query = value.trim();
  if (!query) throw new Error("research query is required");
  if (query.length > 10_000) throw new Error("research query is too long");
  return query;
}

function makeTitle(value: string | undefined, query: string): string {
  return value?.trim().slice(0, 200) || query.slice(0, 80) || "Research";
}

function isReference(value: unknown): value is ResearchSourceReference {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ResearchSourceReference>;
  return typeof item.sourceId === "string"
    && typeof item.sourceName === "string"
    && typeof item.pageNumber === "number"
    && Number.isInteger(item.pageNumber);
}

function normalizeReferences(values: ResearchSourceReference[]): ResearchSourceReference[] {
  const unique = new Map<string, ResearchSourceReference>();
  for (const item of values) {
    if (!isReference(item)) continue;
    const sourceId = item.sourceId.trim();
    const sourceName = item.sourceName.trim();
    if (!sourceId || !sourceName || item.pageNumber < 1) continue;
    const key = `${sourceId}\u0000${item.pageNumber}`;
    if (!unique.has(key)) {
      unique.set(key, {
        sourceId,
        sourceName,
        pageNumber: item.pageNumber,
        ...(item.pageId?.trim() ? { pageId: item.pageId.trim() } : {}),
      });
    }
    if (unique.size >= REFERENCE_LIMIT) break;
  }
  return [...unique.values()];
}
