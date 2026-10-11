import type {
  PageRef,
  QuestionDraft,
  QuestionRecord,
  QuestionSearchQuery,
} from "../core/question.js";

export interface QuestionSearchResult {
  items: readonly QuestionRecord[];
  total: number;
}

export interface QuestionRepository {
  getById(id: string): Promise<QuestionRecord | null>;
  create(draft: QuestionDraft): Promise<QuestionRecord>;
  update(id: string, expectedVersion: number, draft: QuestionDraft): Promise<QuestionRecord>;
  delete(id: string): Promise<void>;
  search(query: QuestionSearchQuery): Promise<QuestionSearchResult>;
}

export interface SourceDocument {
  id: string;
  displayName: string;
  contentHash: string;
  mimeType: string;
  pageCount: number;
  importedAt: string;
}

export interface ImportProposal {
  id: string;
  source: SourceDocument;
  pageRefs: readonly PageRef[];
  draft: QuestionDraft;
  confidence?: number;
  warnings: readonly string[];
  status: "pending-review" | "approved" | "rejected";
}

export interface ImportJobSnapshot {
  id: string;
  sourceName: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  completedUnits: number;
  totalUnits?: number;
  errorMessage?: string;
}

export interface ImportPipeline {
  start(sourceIds: readonly string[]): Promise<ImportJobSnapshot>;
  getJob(jobId: string): Promise<ImportJobSnapshot | null>;
  cancel(jobId: string): Promise<void>;
  listProposals(jobId: string): Promise<readonly ImportProposal[]>;
  approveProposal(proposalId: string): Promise<QuestionRecord>;
  rejectProposal(proposalId: string, reason?: string): Promise<void>;
}

export interface QuestionEngine {
  readonly questions: QuestionRepository;
  readonly imports: ImportPipeline;
}
