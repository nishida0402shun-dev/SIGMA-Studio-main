import type { DocumentIndexer, DocumentIndexingOptions, EmbeddingProvider, KnowledgePageInput, VectorIndex, VectorRecord } from "./contracts.js";
import { chunkKnowledgePage } from "./chunker.js";

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Indexing cancelled");
}

function validateVector(vector: readonly number[], dimensions: number): void {
  if (vector.length !== dimensions || vector.some((value) => !Number.isFinite(value))) {
    throw new Error(`Embedding provider returned an invalid vector; expected ${dimensions} finite values`);
  }
}

export function createDocumentIndexer(
  embeddings: EmbeddingProvider,
  index: VectorIndex,
  options: DocumentIndexingOptions = {},
): DocumentIndexer {
  const batchSize = options.batchSize ?? 32;
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error("batchSize must be a positive integer");
  if (!Number.isInteger(embeddings.dimensions) || embeddings.dimensions < 1) {
    throw new Error("Embedding provider dimensions must be a positive integer");
  }

  return {
    async indexPage(page: KnowledgePageInput, signal?: AbortSignal) {
      throwIfAborted(signal);
      const chunks = chunkKnowledgePage(page, options);
      const records: VectorRecord[] = [];
      for (let start = 0; start < chunks.length; start += batchSize) {
        throwIfAborted(signal);
        const batch = chunks.slice(start, start + batchSize);
        const vectors = await embeddings.embed({
          texts: batch.map((chunk) => chunk.text),
          purpose: "document",
          modelId: embeddings.modelId,
          signal,
        });
        if (vectors.length !== batch.length) {
          throw new Error(`Embedding provider returned ${vectors.length} vectors for ${batch.length} chunks`);
        }
        batch.forEach((chunk, index) => {
          const vector = vectors[index];
          if (!vector) throw new Error("Embedding provider returned a missing vector");
          validateVector(vector, embeddings.dimensions);
          records.push({ ...chunk, embeddingModel: embeddings.modelId, dimensions: embeddings.dimensions, vector: [...vector] });
        });
      }
      throwIfAborted(signal);
      // One upsert call lets the backing adapter use a transaction for this page.
      if (records.length) await index.upsertMany(records, signal);
      return { chunksIndexed: records.length, modelId: embeddings.modelId };
    },
    async removeSource(sourceId: string, signal?: AbortSignal) {
      if (!sourceId.trim()) throw new Error("sourceId is required");
      throwIfAborted(signal);
      await index.removeSource(sourceId, signal);
    },
  };
}
