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

export interface KnowledgePage {
  id: string;
  pageNumber: number;
  semanticType: KnowledgeSemanticType;
  title?: string;
  text?: string;
}

export interface KnowledgeSource {
  id: string;
  workspaceId: string;
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
  workspaceId: string;
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
  text: string;
}
