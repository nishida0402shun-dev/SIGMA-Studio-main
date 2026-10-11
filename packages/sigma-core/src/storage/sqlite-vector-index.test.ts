import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { VectorRecord } from "../knowledge/contracts.js";
import { SqliteVectorIndex } from "./sqlite-vector-index.js";

const databases: DatabaseSync[] = [];
function makeIndex(): SqliteVectorIndex {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  return new SqliteVectorIndex(db);
}
function record(id: string, sourceId: string, vector: number[], text = id): VectorRecord {
  return {
    id,
    text,
    source: { sourceId, displayName: sourceId, pageNumber: 1, chunkIndex: 0 },
    embeddingModel: "test-model",
    dimensions: vector.length,
    vector,
  };
}
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe("SqliteVectorIndex", () => {
  it("persists provenance and returns cosine-ranked results with source filtering", async () => {
    const index = makeIndex();
    await index.upsertMany([
      record("orthogonal", "source-a", [0, 1]),
      record("close", "source-a", [0.9, 0.1]),
      record("other-source", "source-b", [1, 0]),
    ]);

    const results = await index.search({ vector: [1, 0], limit: 3 });
    expect(results.map((item) => item.id)).toEqual(["other-source", "close", "orthogonal"]);
    expect(results[1]?.source).toMatchObject({ sourceId: "source-a", pageNumber: 1, chunkIndex: 0 });
    expect((await index.search({ vector: [1, 0], limit: 5, sourceIds: ["source-a"] })).map((item) => item.id))
      .toEqual(["close", "orthogonal"]);
  });

  it("upserts by id and removes all vectors for a source", async () => {
    const index = makeIndex();
    await index.upsertMany([record("chunk-1", "source-a", [1, 0], "old")]);
    await index.upsertMany([record("chunk-1", "source-a", [0, 1], "new"), record("chunk-2", "source-a", [1, 0])]);
    expect((await index.search({ vector: [0, 1], limit: 1 }))[0]?.text).toBe("new");

    await index.removeSource("source-a");
    expect(await index.search({ vector: [1, 0], limit: 5 })).toEqual([]);
  });

  it("rejects invalid vectors and limits", async () => {
    const index = makeIndex();
    await expect(index.upsertMany([record("bad", "source-a", [Number.NaN, 0])])).rejects.toThrow("finite values");
    await expect(index.search({ vector: [1, 0], limit: 0 })).rejects.toThrow("limit");
    expect(await index.search({ vector: [1, 0], limit: 1 })).toEqual([]);
  });

  it("honors cancellation before reading or writing", async () => {
    const index = makeIndex();
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await expect(index.upsertMany([record("chunk", "source-a", [1, 0])], controller.signal)).rejects.toThrow("cancelled");
    await expect(index.search({ vector: [1, 0], limit: 1, signal: controller.signal })).rejects.toThrow("cancelled");
  });
});
