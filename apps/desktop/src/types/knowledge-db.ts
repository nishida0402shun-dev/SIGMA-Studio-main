export type KnowledgeSemanticType =
  | "problem"
  | "example"
  | "explanation"
  | "column"
  | "definition"
  | "theorem"
  | "answer"
  | "figure"
  | "unknown";

export type KnowledgeAnalysisStatus = "pending" | "processing" | "analyzed" | "stale" | "failed";

export interface KnowledgePage {
  id: string;
  pageNumber: number;
  semanticType: KnowledgeSemanticType;
  title?: string;
  text?: string;
  keywords?: string[];
  analysisSignals?: string[];
  taxonomyNodeIds?: string[];
  taxonomyPaths?: string[][];
  taxonomyConfidence?: number;
  taxonomyVersion?: number;
  analysisStatus?: KnowledgeAnalysisStatus;
  analysisVersion?: number;
  analysisError?: string;
}

export interface KnowledgeSource {
  id: string;
  name: string;
  originalPath: string;
  storedPath: string;
  mimeType: string;
  sizeBytes: number;
  pageCount: number;
  importedAt: string;
  pages: KnowledgePage[];
}


export interface KnowledgeSearchResult {
  id: string;
  sourceId: string;
  pageNumber: number;
  chunkIndex: number;
  text: string;
  score: number;
}


export interface KnowledgeDbAiContext {
  sourceId: string;
  pageId: string;
  sourceName: string;
  pageNumber: number;
  semanticType: KnowledgeSemanticType;
  taxonomyPaths?: string[][];
  score: number;
  text: string;
  citation: string;
  matchReasons?: string[];
}
