import { describe, expect, it, vi } from "vitest";
import type { SearchHit } from "../contracts.js";
import { createHybridRetrievalService, type RetrievalBackend } from "./hybrid-retriever.js";

function hit(id: string, score = 1, domain: SearchHit["domain"] = "document"): SearchHit {
  return { id, domain, text: "text " + id, score, source: { sourceId: "source-" + id, displayName: id, pageNumber: 1 } };
}

function backend(hits: readonly SearchHit[]): RetrievalBackend {
  return { search: vi.fn(async () => hits) };
}

describe("createHybridRetrievalService", () => {
  it("fuses lexical and semantic ranks and deduplicates identical hits", async () => {
    const lexical = backend([hit("a", 0.9), hit("b", 0.8)]);
    const semantic = backend([hit("b", 0.99), hit("c", 0.7)]);
    const service = createHybridRetrievalService({ lexical, semantic, indexVersion: "test-v1" });

    const result = await service.search({ text: "  quadratic equation  ", limit: 10 });

    expect(result.hits.map((item) => item.id)).toEqual(["b", "a", "c"]);
    expect(result.hits).toHaveLength(3);
    expect(result.hits[0].score).toBeGreaterThan(result.hits[1].score);
    expect(result.trace.pipeline).toBe("sigma-hybrid-rrf-v1");
    expect(result.trace.indexVersion).toBe("test-v1");
    expect(lexical.search).toHaveBeenCalledWith(
      expect.objectContaining({ text: "quadratic equation", limit: 10 }),
      10,
      undefined,
    );
  });

  it("filters domains and source IDs before returning results", async () => {
    const service = createHybridRetrievalService({
      lexical: backend([hit("a"), hit("b", 1, "conversation")]),
      semantic: backend([hit("a"), hit("c")]),
    });
    const result = await service.search({ text: "query", domains: ["document"], sourceIds: ["source-a"] });
    expect(result.hits.map((item) => item.id)).toEqual(["a"]);
  });

  it("returns no hits for an empty query without calling backends", async () => {
    const lexical = backend([]);
    const semantic = backend([]);
    const service = createHybridRetrievalService({ lexical, semantic });
    const result = await service.search({ text: "   " });
    expect(result.hits).toEqual([]);
    expect(lexical.search).not.toHaveBeenCalled();
    expect(semantic.search).not.toHaveBeenCalled();
  });

  it("rejects invalid fusion options", () => {
    expect(() => createHybridRetrievalService({
      lexical: backend([]), semantic: backend([]), rankConstant: 0,
    })).toThrow("rankConstant");
  });

  it("honors cancellation before starting backend calls", async () => {
    const lexical = backend([]);
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    const service = createHybridRetrievalService({ lexical, semantic: backend([]) });
    await expect(service.search({ text: "query" }, controller.signal)).rejects.toThrow("cancelled");
    expect(lexical.search).not.toHaveBeenCalled();
  });
});
