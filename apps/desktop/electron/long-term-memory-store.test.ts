import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openQuestionEngineDatabase, SqliteLongTermMemoryStore } from "../../packages/question-engine/src/index";

describe("SqliteLongTermMemoryStore", () => {
  let dir: string | undefined;
  let database: ReturnType<typeof openQuestionEngineDatabase> | undefined;

  afterEach(async () => {
    database?.close();
    database = undefined;
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("deduplicates durable memories and searches them", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "sigma-ltm-"));
    database = openQuestionEngineDatabase({ dataDir: dir });
    const store = new SqliteLongTermMemoryStore(database.raw);
    const input = {
      content: "数学の教材ではページ番号を必ず引用する",
      conversationId: "c1",
      sourceEntryId: "m1",
      confidence: 0.95,
    };
    const first = await store.remember(input);
    const second = await store.remember({ ...input, sourceEntryId: "m2", confidence: 0.8 });
    expect(first?.id).toBe(second?.id);
    expect((await store.search("ページ番号")).length).toBe(1);
  });
});
