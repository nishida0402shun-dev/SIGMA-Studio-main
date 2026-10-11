import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openSigmaCoreDatabase } from "../../../packages/sigma-core/src/index";
import { KnowledgeLearningStore } from "../../../packages/sigma-core/src/storage/sqlite-knowledge-learning-store";

describe("KnowledgeLearningStore", () => {
  it("persists feedback and returns bounded query boost", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "sigma-learning-"));
    const database = openSigmaCoreDatabase({ dataDir: dir });
    try {
      const store = new KnowledgeLearningStore(database.raw);
      await store.record({ query: "二次関数の定義", sourceId: "s1", pageNumber: 2, label: "positive" });
      await store.record({ query: "二次関数の定義", sourceId: "s1", pageNumber: 2, label: "negative" });
      expect((await store.list()).length).toBe(2);
      expect(await store.getBoost("二次関数の定義", "s1", 2)).toBeCloseTo(-0.02);
    } finally {
      database.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
