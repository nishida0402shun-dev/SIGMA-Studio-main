/**
 * Contracts shared by the Electron main process, preload bridge, and the
 * `/sources` renderer. These types describe the Studio view of SIGMA Core and
 * intentionally do not expose Core's database or repository types.
 */

export type SourceMaterialFormat = "pdf" | "text";

export type SourceMaterialExtractionStatus =
  | "complete"
  | "partial"
  | "failed"
  | "unavailable";

export interface SourceMaterialExtractionSummary {
  status: SourceMaterialExtractionStatus;
  warnings: string[];
  extractorId?: string;
  extractorVersion?: string;
  pageCount?: number;
}

export interface SourceMaterialSummary {
  id: string;
  studioWorkspaceId: string;
  coreWorkspaceId: string;
  name: string;
  mimeType: string;
  format: SourceMaterialFormat;
  sizeBytes: number;
  pageCount: number;
  contentHash: string;
  originalPath?: string;
  importedAt: string;
  updatedAt: string;
  extraction: SourceMaterialExtractionSummary;
}

export interface SourceMaterialWorkspaceStatus {
  studioWorkspaceId: string;
  coreWorkspaceId: string;
  registered: boolean;
  displayName?: string;
  sourceCount: number;
}

export interface SourceMaterialPage {
  sourceId: string;
  pageNumber: number;
  title?: string;
  text: string;
  semanticType: string;
  startOffset?: number;
  endOffset?: number;
}

export interface SourceMaterialPageResult {
  source: SourceMaterialSummary;
  page: SourceMaterialPage;
}

export interface SourceMaterialPageRangeResult {
  source: SourceMaterialSummary;
  startPage: number;
  endPage: number;
  pages: SourceMaterialPage[];
}

export interface SourceMaterialPageImage {
  sourceId: string;
  pageNumber: number;
  pageCount: number;
  width: number;
  height: number;
  scale: number;
  png: Uint8Array;
}

export interface SourceMaterialExtractionInfo {
  extractorId: string;
  extractorVersion: string;
  status: string;
  warnings: string[];
  pageCount?: number;
}

export interface SourceMaterialSearchHit {
  sourceId: string;
  sourceName: string;
  pageNumber: number;
  semanticType: string;
  title?: string;
  textSnippet: string;
  score: number;
}

export interface SourceMaterialFileBytes {
  sourceId: string;
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface SourceMaterialFailure {
  code: string;
  message: string;
}

export type SourceMaterialResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: SourceMaterialFailure };

export interface SourceMaterialImportOutcome {
  source: SourceMaterialSummary;
  duplicate: boolean;
}

export interface SourceMaterialImportItem {
  fileName: string;
  filePath: string;
  ok: boolean;
  source?: SourceMaterialSummary;
  duplicate?: boolean;
  error?: SourceMaterialFailure;
}

export interface SourceMaterialImportResult {
  canceled: boolean;
  items: SourceMaterialImportItem[];
}
