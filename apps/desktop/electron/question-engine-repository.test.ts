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
    const sourceMetadata = database!.raw.prepare(
      "SELECT page_count FROM qe_sources WHERE id = ?",
    ).get("textbook-1") as { page_count: number };
    // A citation page number is not the total page count of the source document.
    expect(sourceMetadata.page_count).toBe(0);
    expect((await repository.getById(created.id))?.answer?.verification).toBe("source-checked");
    expect((await repository.search({ text: "放物線", tagIds: ["tag-math"], reviewStatuses: ["needs-review"] })).total).toBe(1);
    expect((await repository.search({ text: "数学" })).items[0]?.id).toBe(created.id);
    expect((await repository.search({ sourceIds: ["textbook-1"], difficultyMin: 2 })).items[0]?.id).toBe(created.id);

    const updated = await repository.update(created.id, 1, {
      title: "二次関数の頂点（確認問題）",
      body: { format: "markdown", content: "頂点の座標を求めよ。" },
      reviewStatus: "approved",
    });
    expect(updated.version).toBe(2);
    expect(updated.reviewStatus).toBe("approved");
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
  });
});
