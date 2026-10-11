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
  source_references_json: string;
  created_at: string;
  updated_at: string;
};

const SESSION_LIMIT = 200;
const REFERENCE_LIMIT = 500;

export class SqliteResearchSessionStore {
  constructor(private readonly database: DatabaseSync) {}

  async list(): Promise<ResearchSession[]> {
    const rows = this.database.prepare(
      "SELECT * FROM sigma_core_research_sessions ORDER BY updated_at DESC, rowid DESC",
    ).all() as SessionRecord[];
    return rows.map(decodeSession);
  }

  async create(input: {
    title?: string;
    query: string;
    sourceReferences?: ResearchSourceReference[];
  }): Promise<ResearchSession> {
    const query = validateQuery(input.query);
    const timestamp = new Date().toISOString();
    const session: ResearchSession = {
      id: `research_${randomUUID()}`,
      title: cleanTitle(input.title, query),
      query,
      sourceReferences: normalizeReferences(input.sourceReferences ?? []),
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.database.prepare(
      `INSERT INTO sigma_core_research_sessions
        (id, title, query_text, source_references_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      session.id, session.title, session.query,
      JSON.stringify(session.sourceReferences), session.createdAt, session.updatedAt,
    );
    this.enforceRetention();
    return session;
  }

  async update(
    id: string,
    patch: { title?: string; query?: string; sourceReferences?: ResearchSourceReference[] },
  ): Promise<ResearchSession | null> {
    const row = this.database.prepare(
      "SELECT * FROM sigma_core_research_sessions WHERE id = ?",
    ).get(id) as SessionRecord | undefined;
    if (!row) return null;

    const previous = decodeSession(row);
    const query = patch.query === undefined ? previous.query : validateQuery(patch.query);
    const updated: ResearchSession = {
      ...previous,
      title: patch.title === undefined ? previous.title : cleanTitle(patch.title, query),
      query,
      sourceReferences: patch.sourceReferences === undefined
        ? previous.sourceReferences
        : normalizeReferences(patch.sourceReferences),
      updatedAt: new Date().toISOString(),
    };

    this.database.prepare(
      `UPDATE sigma_core_research_sessions
       SET title = ?, query_text = ?, source_references_json = ?, updated_at = ?
       WHERE id = ?`,
    ).run(updated.title, updated.query, JSON.stringify(updated.sourceReferences), updated.updatedAt, id);
    return updated;
  }

  async remove(id: string): Promise<boolean> {
    const result = this.database.prepare(
      "DELETE FROM sigma_core_research_sessions WHERE id = ?",
    ).run(id) as { changes: number | bigint };
    return Number(result.changes) !== 0;
  }

  private enforceRetention(): void {
    this.database.prepare(
      `DELETE FROM sigma_core_research_sessions
       WHERE id IN (
         SELECT id FROM sigma_core_research_sessions
         ORDER BY updated_at DESC, rowid DESC LIMIT -1 OFFSET ?
       )`,
    ).run(SESSION_LIMIT);
  }
}

function decodeSession(row: SessionRecord): ResearchSession {
  let sourceReferences: ResearchSourceReference[] = [];
  try {
    const parsed: unknown = JSON.parse(row.source_references_json);
    if (Array.isArray(parsed)) {
      sourceReferences = normalizeReferences(parsed.filter(isReference));
    }
  } catch {
    // A malformed reference list should not make the session itself inaccessible.
  }
  return {
    id: row.id,
    title: row.title,
    query: row.query_text,
    sourceReferences,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateQuery(value: string): string {
  const query = value.trim();
  if (!query) throw new Error("research query is required");
  if (query.length > 10_000) throw new Error("research query is too long");
  return query;
}

function cleanTitle(value: string | undefined, query: string): string {
  return value?.trim().slice(0, 200) || query.slice(0, 80) || "Research";
}

function isReference(value: unknown): value is ResearchSourceReference {
  if (!value || typeof value !== "object") return false;
  const reference = value as Partial<ResearchSourceReference>;
  return typeof reference.sourceId === "string"
    && typeof reference.sourceName === "string"
    && Number.isInteger(reference.pageNumber);
}

function normalizeReferences(values: ResearchSourceReference[]): ResearchSourceReference[] {
  const unique = new Map<string, ResearchSourceReference>();
  for (const value of values) {
    if (!isReference(value)) continue;
    const sourceId = value.sourceId.trim();
    const sourceName = value.sourceName.trim();
    if (!sourceId || !sourceName || value.pageNumber < 1) continue;
    const key = `${sourceId}\u0000${value.pageNumber}`;
    if (!unique.has(key)) {
      unique.set(key, {
        sourceId,
        sourceName,
        pageNumber: value.pageNumber,
        ...(value.pageId?.trim() ? { pageId: value.pageId.trim() } : {}),
      });
    }
    if (unique.size >= REFERENCE_LIMIT) break;
  }
  return [...unique.values()];
}
