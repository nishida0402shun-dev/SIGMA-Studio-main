import type { Question, Taxonomy } from './index';

export type StagingStatus = 'draft' | 'approved' | 'rejected';

export interface PdfSourceRef {
  sourcePath: string;
  sourceSha256: string;
  pageCount: number;
  fileName: string;
}

export interface StagedQuestionProposal {
  id: string;
  pageStart: number;
  pageEnd: number;
  title: string;
  taxonomy: Taxonomy;
  difficulty: number;
  tags: string[];
  body: Question['body'];
  solution?: Question['solution'];
  childPdfPath?: string;
  aiConfidence?: number;
  selected: boolean;
  edited: boolean;
}

export interface PdfImportStaging {
  id: string;
  source: PdfSourceRef;
  status: StagingStatus;
  proposals: StagedQuestionProposal[];
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
}

export interface CreatePdfStagingInput {
  source: PdfSourceRef;
  proposals: StagedQuestionProposal[];
}

export interface UpdateStagedProposalInput {
  stagingId: string;
  proposal: StagedQuestionProposal;
}

export interface CommitPdfStagingResult {
  stagingId: string;
  questionIds: string[];
  committedProposalIds: string[];
}

export interface PdfStagingApi {
  create: (input: CreatePdfStagingInput) => Promise<PdfImportStaging>;
  get: (stagingId: string) => Promise<PdfImportStaging | null>;
  list: () => Promise<PdfImportStaging[]>;
  updateProposal: (input: UpdateStagedProposalInput) => Promise<PdfImportStaging>;
  approve: (stagingId: string) => Promise<CommitPdfStagingResult>;
  reject: (stagingId: string) => Promise<{ stagingId: string }>;
}
