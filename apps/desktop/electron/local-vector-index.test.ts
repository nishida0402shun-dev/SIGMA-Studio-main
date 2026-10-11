import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openQuestionEngineDatabase, type QuestionEngineDatabase } from "../../../packages/question-engine/src/index";
import { LocalVectorIndex, embed } from "./local-vector-index";

describe("LocalVectorIndex", () => {
  const tempDirs: string[] = [];
  const databases: QuestionEngineDatabase[] = [];

  afterEach(async () => {
    for (const database of databases.splice(0)) database.close();
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function createIndex(sourceIds: string[]) {
    const root = await mkdtemp(path.join(os.tmpdir(), "sigma-vector-"));
    tempDirs.push(root);
    const database = openQuestionEngineDatabase({ dataDir: root });
    databases.push(database);
    const now = new Date().toISOString();
    const insert = database.raw.prepare(`
      INSERT INTO qe_knowledge_sources
        (id, display_name, original_uri, stored_uri, mime_type, size_bytes, content_hash,
         page_count, extraction_status, imported_at, updated_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const sourceId of sourceIds) {
      insert.run(sourceId, sourceId, "", "", "text/plain", 0, "", 1, "complete", now, now, "{}");
    }
    return { root, database, index: new LocalVectorIndex(database.raw) };
  }

  it("creates normalized deterministic semantic vectors", async () => {
    const first = await embed("二次関数の頂点");
    const second = await embed("二次関数の頂点");
    expect(first).toEqual(second);
    expect(first).toHaveLength(256);
    expect(Math.sqrt(first.reduce((sum, value) => sum + value * value, 0))).toBeCloseTo(1);
  });

  it("serializes concurrent upserts from independent index instances", async () => {
    const { database, index } = await createIndex(["source-a", "source-b"]);
    const second = new LocalVectorIndex(database.raw);
    await Promise.all([
      index.upsert({ id: "page-a", sourceId: "source-a", pageNumber: 1, chunkIndex: 0, text: "二次関数の頂点" }),
      second.upsert({ id: "page-b", sourceId: "source-b", pageNumber: 1, chunkIndex: 0, text: "英語の長文読解" }),
    ]);
    const persisted = database.raw.prepare("SELECT id FROM qe_vector_records ORDER BY id").all() as Array<{ id: string }>;
    expect(persisted.map((row) => row.id)).toEqual(["page-a", "page-b"]);
  });

  it("persists semantic vectors and returns the closest matching page", async () => {
    const { database, index } = await createIndex(["source-a", "source-b"]);
    await index.upsert({
      id: "page-a", sourceId: "source-a", pageNumber: 1, chunkIndex: 0,
      text: "二次関数の頂点と軸を求める問題",
    });
    await index.upsert({
      id: "page-b", sourceId: "source-b", pageNumber: 2, chunkIndex: 0,
      text: "英語の長文読解と単語",
    });
    const results = await index.search("二次関数 頂点");
    expect(results[0]?.id).toBe("page-a");
    expect(results[0]?.chunkIndex).toBe(0);
    const persisted = database.raw.prepare(
      "SELECT model, dimensions, vector_json FROM qe_vector_records ORDER BY id",
    ).all() as Array<{ model: string; dimensions: number; vector_json: string }>;
    expect(persisted[0]?.dimensions).toBe(256);
    expect(persisted[0]?.model).toBe("embeddinggemma-2-text");
    expect(JSON.parse(persisted[0]!.vector_json)).toHaveLength(256);
    expect(await index.hasRecords()).toBe(true);
    expect(await index.hasSource("source-a")).toBe(true);
    await index.removeSource("source-a");
    expect(await index.hasSource("source-a")).toBe(false);
  });
});
