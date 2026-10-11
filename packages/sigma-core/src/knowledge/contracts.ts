import type { SourceReference } from "../contracts.js";

export type EmbeddingPurpose = "query" | "document";

export interface EmbeddingRequest {
  texts: readonly string[];
  purpose: EmbeddingPurpose;
  modelId?: string;
  signal?: AbortSignal;
}

export interface EmbeddingProvider {
  readonly id: string;
  readonly modelId: string;
  readonly dimensions: number;
  embed(request: EmbeddingRequest): Promise<readonly (readonly number[])[]>;
}

export interface KnowledgePageInput {
  sourceId: string;
  displayName: string;
  pageNumber: number;
  text: string;
  contentHash?: string;
}

export interface KnowledgeChunk {
  id: string;
  source: SourceReference;
  text: string;
}

export interface VectorRecord extends KnowledgeChunk {
  embeddingModel: string;
  dimensions: number;
  vector: readonly number[];
}

export interface VectorSearchRequest {
  vector: readonly number[];
  limit: number;
  sourceIds?: readonly string[];
  signal?: AbortSignal;
}

export interface VectorIndex {
  upsertMany(records: readonly VectorRecord[], signal?: AbortSignal): Promise<void>;
  search(request: VectorSearchRequest): Promise<readonly VectorRecord[]>;
  removeSource(sourceId: string, signal?: AbortSignal): Promise<void>;
}

export interface DocumentIndexingOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  batchSize?: number;
  createChunkId?: (sourceId: string, pageNumber: number, chunkIndex: number) => string;
}

export interface DocumentIndexer {
  indexPage(page: KnowledgePageInput, signal?: AbortSignal): Promise<{ chunksIndexed: number; modelId: string }>;
  removeSource(sourceId: string, signal?: AbortSignal): Promise<void>;
}
