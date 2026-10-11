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

  it("uses the actual sentence boundary as the next window origin without skipping text", () => {
    const text = "12345678。abcdefgh。ABCDEFGH。uvwxyz0123456789";
    const chunks = chunkKnowledgePage({ sourceId: "doc", displayName: "text", pageNumber: 1, text }, { chunkSize: 12, chunkOverlap: 3 });
    expect(chunks.length).toBeGreaterThan(2);
    for (let index = 1; index < chunks.length; index += 1) {
      const previous = chunks[index - 1]!;
      const current = chunks[index]!;
      expect(current.source.startOffset!).toBeLessThan(previous.source.endOffset!);
      expect(current.source.startOffset!).toBeGreaterThan(previous.source.startOffset!);
    }
    expect(chunks[0]?.source.startOffset).toBe(0);
    expect(chunks[chunks.length - 1]?.source.endOffset).toBe(Array.from(text).length);
    for (let index = 1; index < chunks.length; index += 1) {
      expect(chunks[index]!.source.startOffset!).toBeLessThanOrEqual(chunks[index - 1]!.source.endOffset!);
    }
  });

  it("returns no chunks for empty text and validates chunk settings", () => {
    expect(chunkKnowledgePage({ sourceId: "doc", displayName: "empty", pageNumber: 1, text: "" })).toEqual([]);
    expect(() => chunkKnowledgePage({ sourceId: "doc", displayName: "x", pageNumber: 1, text: "x" }, { chunkSize: 5, chunkOverlap: 5 })).toThrow("chunkOverlap");
  });
});
