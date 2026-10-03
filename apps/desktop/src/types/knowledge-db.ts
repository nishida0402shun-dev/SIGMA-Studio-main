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
  classificationReviewStatus?: "pending" | "confirmed" | "needs-review";
  classificationReviewPaths?: string[][];
  classificationReviewConfidence?: number;
  classificationReviewReason?: string;
  classificationReviewEvidence?: string[];
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
  semanticType?: KnowledgeSemanticType;
  title?: string;
  keywords?: string[];
  analysisSignals?: string[];
  taxonomyPaths?: string[][];
  matchReasons?: string[];
  citationRegions?: KnowledgeCitationRegion[];
}

export interface KnowledgeCitationRegion {
  type: "text" | "title" | "table" | "figure" | "formula" | "caption" | "unknown";
  text: string;
  bbox?: [number, number, number, number];
  confidence?: number;
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
  taxonomyConfidence?: number;
  analysisStatus?: KnowledgeAnalysisStatus;
  citationRegions?: KnowledgeCitationRegion[];
  citationRef?: {
    sourceId: string;
    pageId: string;
    pageNumber: number;
  };
}
