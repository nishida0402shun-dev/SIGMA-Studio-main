import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LongTermMemoryStore } from "./long-term-memory-store";

describe("LongTermMemoryStore", () => {
  it("deduplicates durable memories and searches them", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "sigma-ltm-"));
    try {
      const store = new LongTermMemoryStore(dir);
      const input = { content: "数学の教材ではページ番号を必ず引用する", conversationId: "c1", sourceEntryId: "m1", confidence: 0.95 };
      const first = await store.remember(input);
      const second = await store.remember({ ...input, sourceEntryId: "m2", confidence: 0.8 });
      expect(first?.id).toBe(second?.id);
      expect((await store.search("ページ番号")).length).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
