import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openQuestionEngineDatabase, SqliteQuestionRepository, type QuestionEngineDatabase } from "../../../packages/question-engine/src/index";

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
