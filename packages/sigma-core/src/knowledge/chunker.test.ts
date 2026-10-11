import { describe, expect, it } from "vitest";
import { chunkKnowledgePage } from "./chunker.js";

describe("chunkKnowledgePage", () => {
  it("keeps deterministic IDs and source offsets for Japanese and supplementary Unicode", () => {
    const page = { sourceId: "doc-1", displayName: "教材.pdf", pageNumber: 2, text: "数学の定理。😀説明文が続きます。", contentHash: "hash-1" };
    const chunks = chunkKnowledgePage(page, { chunkSize: 10, chunkOverlap: 2 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.id).toBe("doc-1:p2:c0");
    expect(chunks[0]?.source).toMatchObject({ sourceId: "doc-1", displayName: "教材.pdf", pageNumber: 2, chunkIndex: 0, startOffset: 0, contentHash: "hash-1" });
    expect(chunks.map((chunk) => chunk.text).join("")).toContain("😀");
  });

  it("returns no chunks for empty text and validates chunk settings", () => {
    expect(chunkKnowledgePage({ sourceId: "doc", displayName: "empty", pageNumber: 1, text: "" })).toEqual([]);
    expect(() => chunkKnowledgePage({ sourceId: "doc", displayName: "x", pageNumber: 1, text: "x" }, { chunkSize: 5, chunkOverlap: 5 })).toThrow("chunkOverlap");
  });
});
