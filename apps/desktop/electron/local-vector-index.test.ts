import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LocalVectorIndex, embed } from "./local-vector-index";

describe("LocalVectorIndex", () => {
  it("creates normalized deterministic vectors", () => {
    const first = embed("二次関数の頂点");
    const second = embed("二次関数の頂点");
    expect(first).toEqual(second);
    expect(Math.sqrt(first.reduce((sum, value) => sum + value * value, 0))).toBeCloseTo(1);
  });

  it("persists records and returns the closest matching page", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sigma-vector-"));
    try {
      const index = new LocalVectorIndex(root);
      await index.upsert({
        id: "page-a",
        sourceId: "source-a",
        pageNumber: 1,
        chunkIndex: 0,
        text: "二次関数の頂点と軸を求める問題",
      });
      await index.upsert({
        id: "page-b",
        workspaceId: "workspace-a",
        sourceId: "source-b",
        pageNumber: 2,
        chunkIndex: 0,
        text: "英語の長文読解と単語",
      });

      const results = await index.search("二次関数 頂点");
      expect(results[0]?.id).toBe("page-a");
      expect(results[0]?.chunkIndex).toBe(0);

      const persisted = JSON.parse(await readFile(path.join(root, "vectors.json"), "utf8")) as { records: unknown[] };
      expect(persisted.records).toHaveLength(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
