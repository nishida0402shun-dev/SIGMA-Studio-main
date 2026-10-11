import type { KnowledgeChunk, KnowledgePageInput } from "./contracts.js";

export interface ChunkTextOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  createChunkId?: (sourceId: string, pageNumber: number, chunkIndex: number) => string;
}

/**
 * Splits page text into deterministic Unicode-code-point windows while retaining
 * source offsets. Offsets are measured in Unicode code points, not UTF-16 units.
 */
export function chunkKnowledgePage(page: KnowledgePageInput, options: ChunkTextOptions = {}): KnowledgeChunk[] {
  const chunkSize = options.chunkSize ?? 1200;
  const chunkOverlap = options.chunkOverlap ?? 160;
  if (!Number.isInteger(chunkSize) || chunkSize < 1) throw new Error("chunkSize must be a positive integer");
  if (!Number.isInteger(chunkOverlap) || chunkOverlap < 0 || chunkOverlap >= chunkSize) {
    throw new Error("chunkOverlap must be an integer between 0 and chunkSize - 1");
  }
  if (!Number.isInteger(page.pageNumber) || page.pageNumber < 1) throw new Error("pageNumber must be a positive integer");
  if (!page.sourceId.trim()) throw new Error("sourceId is required");

  const chars = Array.from(page.text);
  const chunks: KnowledgeChunk[] = [];
  let start = 0;
  let chunkIndex = 0;
  while (start < chars.length) {
    let end = Math.min(chars.length, start + chunkSize);
    // Prefer a nearby paragraph/sentence boundary without making tiny chunks.
    if (end < chars.length) {
      const minimumEnd = start + Math.floor(chunkSize * 0.65);
      for (let candidate = end; candidate > minimumEnd; candidate -= 1) {
        const char = chars[candidate - 1];
        if (char === "\n" || char === "。" || char === "." || char === "！" || char === "？") {
          end = candidate;
          break;
        }
      }
    }

    const text = chars.slice(start, end).join("").trim();
    if (text) {
      const id = options.createChunkId?.(page.sourceId, page.pageNumber, chunkIndex)
        ?? `${page.sourceId}:p${page.pageNumber}:c${chunkIndex}`;
      chunks.push({
        id,
        text,
        source: {
          sourceId: page.sourceId,
          displayName: page.displayName,
          pageNumber: page.pageNumber,
          chunkIndex,
          startOffset: start,
          endOffset: end,
          ...(page.contentHash ? { contentHash: page.contentHash } : {}),
        },
      });
    }
    if (end === chars.length) break;

    // Advance from the actual chosen boundary, preserving overlap and avoiding
    // both skipped text and repeated windows when a sentence boundary is early.
    const nextStart = end - chunkOverlap;
    start = nextStart > start ? nextStart : start + 1;
    chunkIndex += 1;
  }
  return chunks;
}
