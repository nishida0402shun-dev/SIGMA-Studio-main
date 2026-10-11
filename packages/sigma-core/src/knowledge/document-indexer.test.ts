import { describe, expect, it, vi } from "vitest";
import type { EmbeddingProvider, VectorIndex, VectorRecord } from "./contracts.js";
import { createDocumentIndexer } from "./document-indexer.js";

function makeProvider(embed: EmbeddingProvider["embed"] = async ({ texts }) => texts.map(() => [1, 0])): EmbeddingProvider {
  return { id: "test-embedder", modelId: "test-model-v1", dimensions: 2, embed };
}

function makeIndex(): VectorIndex & { records: VectorRecord[]; upsertMany: ReturnType<typeof vi.fn>; removeSource: ReturnType<typeof vi.fn> } {
  const records: VectorRecord[] = [];
  return {
    records,
    upsertMany: vi.fn(async (items: readonly VectorRecord[]) => { records.push(...items); }),
    search: vi.fn(async () => []),
    removeSource: vi.fn(async () => undefined),
  };
}

describe("createDocumentIndexer", () => {
  it("embeds chunks in bounded batches and stores provenance with vectors", async () => {
    const index = makeIndex();
    const embeddings = makeProvider();
    const indexer = createDocumentIndexer(embeddings, index, { chunkSize: 4, chunkOverlap: 1, batchSize: 2 });
    const result = await indexer.indexPage({ sourceId: "doc", displayName: "notes.pdf", pageNumber: 1, text: "abcdefghij" });

    expect(result).toEqual({ chunksIndexed: 3, modelId: "test-model-v1" });
    expect(index.upsertMany).toHaveBeenCalledTimes(1);
    expect(index.records.every((record) => record.vector.length === 2 && record.source.sourceId === "doc")).toBe(true);
  });

  it("rejects invalid vectors without writing partial index records", async () => {
    const index = makeIndex();
    const indexer = createDocumentIndexer(makeProvider(async ({ texts }) => texts.map(() => [Number.NaN, 0])), index);
    await expect(indexer.indexPage({ sourceId: "doc", displayName: "notes", pageNumber: 1, text: "some text" })).rejects.toThrow("invalid vector");
    expect(index.upsertMany).not.toHaveBeenCalled();
  });

  it("does not invoke embedding after cancellation", async () => {
    const embed = vi.fn(async ({ texts }: { texts: readonly string[] }) => texts.map(() => [1, 0]));
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    const indexer = createDocumentIndexer(makeProvider(embed), makeIndex());
    await expect(indexer.indexPage({ sourceId: "doc", displayName: "notes", pageNumber: 1, text: "text" }, controller.signal)).rejects.toThrow("cancelled");
    expect(embed).not.toHaveBeenCalled();
  });
});
