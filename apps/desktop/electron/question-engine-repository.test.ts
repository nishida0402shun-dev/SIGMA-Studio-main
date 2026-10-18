import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  QUESTION_ENGINE_SCHEMA_VERSION,
  openQuestionEngineDatabase,
  SqliteQuestionRepository,
  type QuestionEngineDatabase,
} from "../../../packages/question-engine/src/index";

describe("SqliteQuestionRepository", () => {
  let dir: string | undefined;
  let database: QuestionEngineDatabase | undefined;

  afterEach(async () => {
    database?.close();
    database = undefined;
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  async function createRepository() {
    dir = await mkdtemp(path.join(os.tmpdir(), "sigma-question-repository-"));
    database = openQuestionEngineDatabase({ dataDir: dir });
    return new SqliteQuestionRepository(database.raw);
  }

  it("reopens an initialized database without duplicating the current migration record", async () => {
    await createRepository();
    const before = database!.raw.prepare(
      "SELECT COUNT(*) AS count FROM qe_schema_migrations WHERE version = ?",
    ).get(QUESTION_ENGINE_SCHEMA_VERSION) as { count: number };
    expect(before.count).toBe(1);

    database!.close();
    database = undefined;
    database = openQuestionEngineDatabase({ dataDir: dir! });

    const after = database.raw.prepare(
      "SELECT COUNT(*) AS count FROM qe_schema_migrations WHERE version = ?",
    ).get(QUESTION_ENGINE_SCHEMA_VERSION) as { count: number };
    expect(after.count).toBe(1);
  });

  it("rejects existing Question Engine tables without a schema version", async () => {
    await createRepository();
    database!.raw.exec("DROP TABLE qe_schema_migrations");

    database!.close();
    database = undefined;

    expect(() => openQuestionEngineDatabase({ dataDir: dir! })).toThrow(
      "Question Engine DB contains existing tables without a schema version; automatic migration is unsafe and a verified migration path is not available",
    );
  });

  it("rejects existing Question Engine tables when migration history is empty", async () => {
    await createRepository();
    database!.raw.prepare("DELETE FROM qe_schema_migrations").run();

    database!.close();
    database = undefined;

    expect(() => openQuestionEngineDatabase({ dataDir: dir! })).toThrow(
      "Question Engine DB contains existing tables without a schema version; automatic migration is unsafe and a verified migration path is not available",
    );
  });

  it("rejects an older schema when no verified migration path is available", async () => {
    await createRepository();
    const legacyVersion = QUESTION_ENGINE_SCHEMA_VERSION - 1;
    database!.raw.prepare("DELETE FROM qe_schema_migrations").run();
    database!.raw.prepare(
      "INSERT INTO qe_schema_migrations(version, applied_at) VALUES (?, ?)",
    ).run(legacyVersion, new Date().toISOString());

    database!.close();
    database = undefined;

    expect(() => openQuestionEngineDatabase({ dataDir: dir! })).toThrow(
      `Question Engine DB schema version ${legacyVersion} cannot be upgraded automatically; a verified migration path to version ${QUESTION_ENGINE_SCHEMA_VERSION} is not available`,
    );
  });

  it("rejects a database schema version newer than the application supports", async () => {
    await createRepository();
    const unsupportedVersion = QUESTION_ENGINE_SCHEMA_VERSION + 1;
    database!.raw.prepare(
      "INSERT INTO qe_schema_migrations(version, applied_at) VALUES (?, ?)",
    ).run(unsupportedVersion, new Date().toISOString());

    database!.close();
    database = undefined;

    expect(() => openQuestionEngineDatabase({ dataDir: dir! })).toThrow(
      `Question Engine DB schema version ${unsupportedVersion} is newer than this application supports (${QUESTION_ENGINE_SCHEMA_VERSION})`,
    );
  });

  it("rejects a current-version database missing a required FTS trigger", async () => {
    await createRepository();
    database!.raw.exec("DROP TRIGGER qe_knowledge_pages_fts_au");
    database!.close();
    database = undefined;

    expect(() => openQuestionEngineDatabase({ dataDir: dir! })).toThrow(
      "Question Engine DB schema version 5 is incomplete; missing required objects: trigger qe_knowledge_pages_fts_au",
    );
  });

  it("keeps knowledge-page and conversation FTS indexes in sync", async () => {
    await createRepository();

    database!.raw.prepare(
      `INSERT INTO qe_knowledge_sources (
        id, display_name, original_uri, stored_uri, mime_type, size_bytes,
        content_hash, page_count, extraction_status, imported_at, updated_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "knowledge-source-1", "Physics notes", "file:///source.pdf", "file:///stored.pdf",
      "application/pdf", 100, "hash-1", 1, "complete", "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z", "{}",
    );
    database!.raw.prepare(
      `INSERT INTO qe_knowledge_pages (
        id, source_id, page_number, semantic_type, title, text_content,
        extraction_status, structure_json, analysis_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "knowledge-page-1", "knowledge-source-1", 1, "notes", "Quantum optics",
      "photon coherence alpha", "text", "[]", "{}", "2026-01-01T00:00:00.000Z",
    );

    const pageSearch = () => database!.raw.prepare(
      "SELECT page_id FROM qe_knowledge_pages_fts WHERE qe_knowledge_pages_fts MATCH ?",
    ).all("photon");
    expect(pageSearch()).toHaveLength(1);

    database!.raw.prepare(
      "UPDATE qe_knowledge_pages SET text_content = ? WHERE id = ?",
    ).run("neutrino oscillation beta", "knowledge-page-1");
    expect(database!.raw.prepare(
      "SELECT page_id FROM qe_knowledge_pages_fts WHERE qe_knowledge_pages_fts MATCH ?",
    ).all("photon")).toHaveLength(0);
    expect(database!.raw.prepare(
      "SELECT page_id FROM qe_knowledge_pages_fts WHERE qe_knowledge_pages_fts MATCH ?",
    ).all("neutrino")).toHaveLength(1);
    database!.raw.prepare("DELETE FROM qe_knowledge_pages WHERE id = ?").run("knowledge-page-1");
    expect(database!.raw.prepare(
      "SELECT page_id FROM qe_knowledge_pages_fts WHERE qe_knowledge_pages_fts MATCH ?",
    ).all("neutrino")).toHaveLength(0);

    database!.raw.prepare(
      `INSERT INTO qe_conversation_entries (
        id, conversation_id, role, content, provider, created_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "conversation-entry-1", "conversation-1", "user", "rememberable comet gamma",
      "test-provider", "2026-01-01T00:00:00.000Z", "{}",
    );
    const conversationSearch = (term: string) => database!.raw.prepare(
      "SELECT entry_id FROM qe_conversation_entries_fts WHERE qe_conversation_entries_fts MATCH ?",
    ).all(term);
    expect(conversationSearch("comet")).toHaveLength(1);

    database!.raw.prepare(
      "UPDATE qe_conversation_entries SET content = ? WHERE id = ?",
    ).run("rememberable asteroid delta", "conversation-entry-1");
    expect(conversationSearch("comet")).toHaveLength(0);
    expect(conversationSearch("asteroid")).toHaveLength(1);

    database!.raw.prepare(
      "DELETE FROM qe_conversation_entries WHERE id = ?",
    ).run("conversation-entry-1");
    expect(conversationSearch("asteroid")).toHaveLength(0);
  });

  it("rolls back question creation and related records when version history fails", async () => {
    const repository = await createRepository();
    database!.raw.exec(`
      CREATE TRIGGER qe_test_fail_version_insert
      BEFORE INSERT ON qe_question_versions
      BEGIN
        SELECT RAISE(ABORT, 'forced version history failure');
      END;
    `);

    await expect(repository.create({
      title: "Rollback test",
      body: { format: "plain-text", content: "This record must not persist." },
      tags: [{ id: "rollback-tag", label: "rollback-tag", taxonomyPath: [] }],
      sources: [{ id: "rollback-source", name: "Rollback source", pageNumber: 1 }],
    })).rejects.toThrow("forced version history failure");

    for (const table of [
      "qe_questions",
      "qe_question_tags",
      "qe_question_sources",
      "qe_question_versions",
      "qe_questions_fts",
    ]) {
      const row = database!.raw.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
      expect(row.count, `expected ${table} to roll back`).toBe(0);
    }
    expect((database!.raw.prepare("SELECT COUNT(*) AS count FROM qe_tags").get() as { count: number }).count).toBe(0);
    expect((database!.raw.prepare("SELECT COUNT(*) AS count FROM qe_sources").get() as { count: number }).count).toBe(0);
  });

  it("creates, searches, updates with optimistic locking, and deletes questions", async () => {
    const repository = await createRepository();
    const created = await repository.create({
      title: "二次関数の頂点",
      body: { format: "markdown", content: "放物線の頂点を求める。" },
      answer: {
        content: { format: "plain-text", content: "平方完成する。" },
        verification: "source-checked",
        evidenceSourceIds: ["textbook-1"],
      },
      tags: [{ id: "tag-math", label: "数学", taxonomyPath: ["数学", "二次関数"] }],
      sources: [{ id: "textbook-1", name: "数学の教科書", pageNumber: 12 }],
      difficulty: 2,
      reviewStatus: "needs-review",
    });

    expect(created.version).toBe(1);
    const createdFts = database!.raw.prepare(
      "SELECT title, body_text, tags_text FROM qe_questions_fts WHERE question_id = ?",
    ).all(created.id) as Array<{ title: string; body_text: string; tags_text: string }>;
    expect(createdFts).toHaveLength(1);
    expect(createdFts[0]).toMatchObject({
      title: "二次関数の頂点",
      body_text: JSON.stringify({ format: "markdown", content: "放物線の頂点を求める。" }),
      tags_text: "数学",
    });
    const sourceMetadata = database!.raw.prepare(
      "SELECT page_count FROM qe_sources WHERE id = ?",
    ).get("textbook-1") as { page_count: number };
    // A citation page number is not the total page count of the source document.
    expect(sourceMetadata.page_count).toBe(0);
    expect((await repository.getById(created.id))?.answer?.verification).toBe("source-checked");
    expect((await repository.search({ text: "放物線", tagIds: ["tag-math"], reviewStatuses: ["needs-review"] })).total).toBe(1);
    expect((await repository.search({ text: "頂点の座標" })).total).toBe(0);
    expect((await repository.search({ text: "数学" })).items[0]?.id).toBe(created.id);
    expect((await repository.search({ sourceIds: ["textbook-1"], difficultyMin: 2 })).items[0]?.id).toBe(created.id);

    const updated = await repository.update(created.id, 1, {
      title: "二次関数の頂点（確認問題）",
      body: { format: "markdown", content: "頂点の座標を求めよ。" },
      tags: [{ id: "tag-algebra", label: "代数", taxonomyPath: ["数学", "代数"] }],
      reviewStatus: "approved",
    });
    expect(updated.version).toBe(2);
    expect(updated.reviewStatus).toBe("approved");
    const updatedFts = database!.raw.prepare(
      "SELECT title, body_text, tags_text FROM qe_questions_fts WHERE question_id = ?",
    ).all(created.id) as Array<{ title: string; body_text: string; tags_text: string }>;
    expect(updatedFts).toHaveLength(1);
    expect(updatedFts[0]).toMatchObject({
      title: "二次関数の頂点（確認問題）",
      body_text: JSON.stringify({ format: "markdown", content: "頂点の座標を求めよ。" }),
      tags_text: "代数",
    });
    expect((await repository.search({ text: "確認問題" })).total).toBe(1);
    expect((await repository.search({ text: "代数" })).items[0]?.id).toBe(created.id);
    expect((await repository.search({ text: "数学" })).total).toBe(0);
    expect((await repository.search({ text: "放物線" })).total).toBe(0);
    await expect(repository.update(created.id, 1, {
      title: "古い更新",
      body: { format: "plain-text", content: "古い本文" },
    })).rejects.toThrow("version conflict");

    const history = database!.raw.prepare(
      "SELECT version FROM qe_question_versions WHERE question_id = ? ORDER BY version",
    ).all(created.id) as Array<{ version: number }>;
    expect(history.map((item) => item.version)).toEqual([1, 2]);

    await repository.delete(created.id);
    expect(await repository.getById(created.id)).toBeNull();
    expect((database!.raw.prepare(
      "SELECT COUNT(*) AS count FROM qe_questions_fts WHERE question_id = ?",
    ).get(created.id) as { count: number }).count).toBe(0);
    expect((await repository.search({ text: "確認問題" })).total).toBe(0);
    for (const table of ["qe_question_tags", "qe_question_sources", "qe_question_versions", "qe_questions_fts"]) {
      const row = database!.raw.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE question_id = ?`).get(created.id) as { count: number };
      expect(row.count, `expected related rows in ${table} to be deleted`).toBe(0);
    }
  });
});
