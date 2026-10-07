import { describe, expect, it, vi } from "vitest";
import { rerankKnowledgeCandidates } from "./knowledge-decision-reranker";

describe("knowledge decision reranker", () => {
  it("uses Tev1 probabilities to rerank candidates", async () => {
    process.env.SIGMA_KNOWLEDGE_DECISION_ENABLED = "true";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ answers: { ready: { noul: true } } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        answers: {
          candidate_0: { probabilities: { true: 0.15, false: 0.85 } },
          candidate_1: { probabilities: { true: 0.91, false: 0.09 } },
        },
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const results = await rerankKnowledgeCandidates("二次関数の頂点", [
      { id: "a", sourceId: "a", pageNumber: 1, chunkIndex: 0, text: "英語の長文読解", score: 0.9 },
      { id: "b", sourceId: "b", pageNumber: 2, chunkIndex: 0, text: "二次関数の頂点を求める方法", score: 0.7 },
    ]);

    expect(results[0]?.id).toBe("b");
    expect(results[0]?.decisionScore).toBeCloseTo(0.91);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it("falls back without a local decision model", async () => {
    process.env.SIGMA_KNOWLEDGE_DECISION_ENABLED = "false";
    const results = await rerankKnowledgeCandidates("query", [
      { id: "a", sourceId: "a", pageNumber: 1, chunkIndex: 0, text: "A", score: 0.9 },
      { id: "b", sourceId: "b", pageNumber: 1, chunkIndex: 0, text: "B", score: 0.8 },
    ]);
    expect(results.map((item) => item.id)).toEqual(["a", "b"]);
    expect(results.every((item) => item.decisionScore === 0)).toBe(true);
  });
});
