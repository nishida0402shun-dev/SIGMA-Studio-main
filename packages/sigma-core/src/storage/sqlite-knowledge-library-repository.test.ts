import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteKnowledgeLibraryRepository } from "./sqlite-knowledge-library-repository.js";

const databases: DatabaseSync[] = [];
function makeRepository(): SqliteKnowledgeLibraryRepository {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec(`
    CREATE TABLE sigma_core_knowledge_state (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL);
    INSERT INTO sigma_core_knowledge_state(id, revision) VALUES (1, 0);
    CREATE TABLE sigma_core_knowledge_sources (
      id TEXT PRIMARY KEY, display_name TEXT NOT NULL, original_uri TEXT NOT NULL,
      stored_uri TEXT NOT NULL, mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL,
      content_hash TEXT NOT NULL, page_count INTEGER NOT NULL, extraction_status TEXT NOT NULL,
      imported_at TEXT NOT NULL, updated_at TEXT NOT NULL, metadata_json TEXT NOT NULL
    );
    CREATE TABLE sigma_core_knowledge_pages (
      id TEXT PRIMARY KEY, source_id TEXT NOT NULL, page_number INTEGER NOT NULL,
      semantic_type TEXT NOT NULL, title TEXT, text_content TEXT NOT NULL,
      extraction_status TEXT NOT NULL, structure_json TEXT NOT NULL, analysis_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return new SqliteKnowledgeLibraryRepository(db);
}
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe("SqliteKnowledgeLibraryRepository", () => {
  it("round-trips sources and pages and increments the shared revision", () => {
    const repository = makeRepository();
    const source = {
      id: "source-1", display_name: "notes.pdf", original_uri: "/input/notes.pdf",
      stored_uri: "/data/notes.pdf", mime_type: "application/pdf", size_bytes: 42,
      content_hash: "hash-1", page_count: 1, extraction_status: "complete",
      imported_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-02T00:00:00.000Z",
      metadata_json: JSON.stringify({ indexedAt: "2026-01-02T00:00:00.000Z" }),
      pages: [{
        id: "page-1", source_id: "source-1", page_number: 1, semantic_type: "definition",
        title: "Definition", text_content: "A test definition", extraction_status: "text",
        structure_json: "[]", analysis_json: JSON.stringify({ analysisVersion: 1 }),
        updated_at: "2026-01-02T00:00:00.000Z",
      }],
    };
    expect(repository.save([source], 0)).toBe(1);
    const loaded = repository.load();
    expect(loaded.revision).toBe(1);
    expect(loaded.sources).toEqual([source]);
  });

  it("rejects stale writes without changing the persisted library", () => {
    const repository = makeRepository();
    const source = {
      id: "source-1", display_name: "notes.txt", original_uri: "/input/notes.txt",
      stored_uri: "/data/notes.txt", mime_type: "text/plain", size_bytes: 4,
      content_hash: "hash-1", page_count: 0, extraction_status: "complete",
      imported_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-02T00:00:00.000Z",
      metadata_json: "{}", pages: [],
    };
    repository.save([source], 0);
    expect(() => repository.save([], 0)).toThrow("changed concurrently");
    expect(repository.load().sources.map((item) => item.id)).toEqual(["source-1"]);
    expect(repository.load().revision).toBe(1);
  });
});
