/**
 * Provider-neutral domain types. These types intentionally avoid Electron,
 * filesystem, AI-provider, and database-specific dependencies.
 */

export type VerificationStatus =
  | "unverified"
  | "ai-proposed"
  | "source-checked"
  | "human-verified";

export type ReviewStatus = "draft" | "needs-review" | "approved" | "rejected";

export interface QuestionSource {
  id: string;
  name: string;
  contentHash?: string;
  pageNumber?: number;
  /** Optional page-relative bounding box: x, y, width, height. */
  region?: readonly [number, number, number, number];
  uri?: string;
}

export interface QuestionTag {
  id: string;
  label: string;
  taxonomyPath?: readonly string[];
}

export interface QuestionContent {
  /** Structured body is kept format-neutral so the editor can evolve independently. */
  format: "sigma-document" | "markdown" | "plain-text";
  content: unknown;
}

export interface QuestionAnswer {
  content: QuestionContent;
  verification: VerificationStatus;
  evidenceSourceIds: readonly string[];
  explanation?: QuestionContent;
}

export interface QuestionRecord {
  id: string;
  title: string;
  body: QuestionContent;
  answer?: QuestionAnswer;
  tags: readonly QuestionTag[];
  sources: readonly QuestionSource[];
  difficulty?: 1 | 2 | 3 | 4 | 5;
  reviewStatus: ReviewStatus;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface QuestionDraft {
  title: string;
  body: QuestionContent;
  answer?: QuestionAnswer;
  tags?: readonly QuestionTag[];
  sources?: readonly QuestionSource[];
  difficulty?: 1 | 2 | 3 | 4 | 5;
  reviewStatus?: ReviewStatus;
}

export interface QuestionSearchQuery {
  text?: string;
  tagIds?: readonly string[];
  difficultyMin?: 1 | 2 | 3 | 4 | 5;
  difficultyMax?: 1 | 2 | 3 | 4 | 5;
  reviewStatuses?: readonly ReviewStatus[];
  sourceIds?: readonly string[];
  limit?: number;
  offset?: number;
}

export interface PageRef {
  sourceId: string;
  pageNumber: number;
  region?: readonly [number, number, number, number];
}
