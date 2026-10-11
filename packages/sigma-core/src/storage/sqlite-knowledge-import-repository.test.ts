import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteKnowledgeImportRepository } from "./sqlite-knowledge-import-repository.js";

const databases: DatabaseSync[] = [];
function makeRepository(): SqliteKnowledgeImportRepository {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec(`
    CREATE TABLE sigma_core_knowledge_staging (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'rejected')),
      source_path TEXT NOT NULL,
      source_name TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
      page_count INTEGER NOT NULL CHECK (page_count > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      approved_at TEXT,
      segments_json TEXT NOT NULL
    );
  `);
  return new SqliteKnowledgeImportRepository(db);
}
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe("SqliteKnowledgeImportRepository", () => {
  it("round-trips staged PDF metadata and segment proposals", () => {
    const repository = makeRepository();
    const draft = {
      id: "staging-1",
      status: "draft" as const,
      sourcePath: "/source/notes.pdf",
      sourceName: "notes.pdf",
      sourceHash: "abc123",
      sizeBytes: 128,
      pageCount: 2,
      createdAt: "2026-10-11T00:00:00.000Z",
      updatedAt: "2026-10-11T00:01:00.000Z",
      segments: [{
        id: "segment-1",
        startPage: 1,
        endPage: 2,
        name: "Chapter 1",
        paths: [["Mathematics", "Algebra"]],
        confidence: 0.92,
        reason: "continuous topic",
        selected: true,
      }],
    };
    repository.save(draft);
    expect(repository.get(draft.id)).toEqual(draft);
    expect(repository.list()).toEqual([draft]);
  });

  it("updates status and approved timestamp for an existing draft", () => {
    const repository = makeRepository();
    const draft = {
      id: "staging-1",
      status: "draft" as const,
      sourcePath: "/source/notes.pdf",
      sourceName: "notes.pdf",
      sourceHash: "abc123",
      sizeBytes: 128,
      pageCount: 1,
      createdAt: "2026-10-11T00:00:00.000Z",
      updatedAt: "2026-10-11T00:00:00.000Z",
      segments: [],
    };
    repository.save(draft);
    repository.save({ ...draft, status: "approved", updatedAt: "2026-10-11T00:02:00.000Z", approvedAt: "2026-10-11T00:02:00.000Z" });
    expect(repository.get(draft.id)).toMatchObject({ status: "approved", approvedAt: "2026-10-11T00:02:00.000Z" });
  });
});
