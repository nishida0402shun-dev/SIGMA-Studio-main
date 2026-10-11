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

type ResearchSessionRow = {
  id: string;
  title: string;
  query_text: string;
  source_references_json: string;
  created_at: string;
  updated_at: string;
};

export class SqliteResearchSessionStore {
  constructor(private readonly db: DatabaseSync) {}

  async list(): Promise<ResearchSession[]> {
    const rows = this.db.prepare(
      "SELECT * FROM qe_research_sessions ORDER BY updated_at DESC, rowid DESC",
    ).all() as ResearchSessionRow[];
    return rows.map(fromRow);
  }

  async create(input: {
    title?: string;
    query: string;
    sourceReferences?: ResearchSourceReference[];
  }): Promise<ResearchSession> {
    const query = input.query.trim();
    if (!query) throw new Error("research query is required");
    const now = new Date().toISOString();
    const session: ResearchSession = {
      id: "research_" + randomUUID(),
      title: input.title?.trim() || query.slice(0, 80) || "Research",
      query,
      sourceReferences: dedupeReferences(input.sourceReferences ?? []),
      createdAt: now,
      updatedAt: now,
    };
    this.db.prepare(`
      INSERT INTO qe_research_sessions
        (id, title, query_text, source_references_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(session.id, session.title, session.query, JSON.stringify(session.sourceReferences), now, now);
    this.db.prepare(`
      DELETE FROM qe_research_sessions
      WHERE id IN (
        SELECT id FROM qe_research_sessions
        ORDER BY updated_at DESC, rowid DESC
        LIMIT -1 OFFSET 200
      )
    `).run();
    return session;
  }

  async update(id: string, patch: {
    title?: string;
    query?: string;
    sourceReferences?: ResearchSourceReference[];
  }): Promise<ResearchSession | null> {
    const existing = this.db.prepare("SELECT * FROM qe_research_sessions WHERE id = ?").get(id) as ResearchSessionRow | undefined;
    if (!existing) return null;
    const current = fromRow(existing);
    const query = patch.query === undefined ? current.query : patch.query.trim();
    if (!query) throw new Error("research query is required");
    const updated: ResearchSession = {
      ...current,
      title: patch.title === undefined ? current.title : patch.title.trim() || current.title,
      query,
      sourceReferences: patch.sourceReferences === undefined
        ? current.sourceReferences
        : dedupeReferences(patch.sourceReferences),
      updatedAt: new Date().toISOString(),
    };
    this.db.prepare(`
      UPDATE qe_research_sessions
      SET title = ?, query_text = ?, source_references_json = ?, updated_at = ?
      WHERE id = ?
    `).run(updated.title, updated.query, JSON.stringify(updated.sourceReferences), updated.updatedAt, id);
    return updated;
  }

  async remove(id: string): Promise<boolean> {
    const result = this.db.prepare("DELETE FROM qe_research_sessions WHERE id = ?").run(id) as { changes: number | bigint };
    return Number(result.changes) > 0;
  }
}

function fromRow(row: ResearchSessionRow): ResearchSession {
  return {
    id: row.id,
    title: row.title,
    query: row.query_text,
    sourceReferences: JSON.parse(row.source_references_json) as ResearchSourceReference[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function dedupeReferences(references: ResearchSourceReference[]): ResearchSourceReference[] {
  const seen = new Set<string>();
  return references.filter((reference) => {
    if (!reference.sourceId || !Number.isInteger(reference.pageNumber) || reference.pageNumber < 1) return false;
    const key = `${reference.sourceId}:${reference.pageNumber}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 500);
}
