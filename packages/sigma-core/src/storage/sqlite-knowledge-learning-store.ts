import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type LearningFeedbackLabel = "positive" | "negative" | "correction";

export interface KnowledgeLearningFeedback {
  id: string;
  query: string;
  sourceId?: string;
  pageNumber?: number;
  label: LearningFeedbackLabel;
  correction?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

type FeedbackRecord = {
  id: string;
  query_text: string;
  source_id: string | null;
  page_number: number | null;
  label: LearningFeedbackLabel;
  correction: string | null;
  created_at: string;
  metadata_json: string;
};

const FEEDBACK_LIMIT = 20_000;
const QUERY_LIMIT = 10_000;

export class KnowledgeLearningStore {
  constructor(private readonly database: DatabaseSync) {}

  async record(
    input: Omit<KnowledgeLearningFeedback, "id" | "createdAt">,
  ): Promise<KnowledgeLearningFeedback> {
    const query = input.query.trim();
    if (!query) throw new Error("learning query is empty");
    if (query.length > QUERY_LIMIT) throw new Error("learning query is too long");
    if (!isFeedbackLabel(input.label)) throw new Error("invalid learning feedback label");
    if (input.pageNumber !== undefined && (!Number.isInteger(input.pageNumber) || input.pageNumber < 1)) {
      throw new Error("learning page number must be a positive integer");
    }

    const entry: KnowledgeLearningFeedback = {
      id: `learn_${randomUUID()}`,
      query,
      ...(input.sourceId?.trim() ? { sourceId: input.sourceId.trim() } : {}),
      ...(input.pageNumber !== undefined ? { pageNumber: input.pageNumber } : {}),
      label: input.label,
      ...(input.correction?.trim() ? { correction: input.correction.trim() } : {}),
      createdAt: new Date().toISOString(),
      ...(input.metadata && Object.keys(input.metadata).length ? { metadata: input.metadata } : {}),
    };

    this.database.prepare(
      `INSERT INTO sigma_core_knowledge_learning_feedback
        (id, query_text, source_id, page_number, label, correction, created_at, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      entry.id, entry.query, entry.sourceId ?? null, entry.pageNumber ?? null,
      entry.label, entry.correction ?? null, entry.createdAt, JSON.stringify(entry.metadata ?? {}),
    );
    this.database.prepare(
      `DELETE FROM sigma_core_knowledge_learning_feedback
       WHERE id IN (
         SELECT id FROM sigma_core_knowledge_learning_feedback
         ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET ?
       )`,
    ).run(FEEDBACK_LIMIT);
    return entry;
  }

  async list(limit = 100): Promise<KnowledgeLearningFeedback[]> {
    const count = boundedInteger(limit, 100, 1, 500);
    const rows = this.database.prepare(
      "SELECT * FROM sigma_core_knowledge_learning_feedback ORDER BY created_at DESC, rowid DESC LIMIT ?",
    ).all(count) as FeedbackRecord[];
    return rows.map(decodeFeedback);
  }

  async getBoost(query: string, sourceId?: string, pageNumber?: number): Promise<number> {
    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) return 0;

    const rows = this.database.prepare(
      `SELECT * FROM sigma_core_knowledge_learning_feedback
       WHERE (? IS NULL OR source_id = ?)
         AND (? IS NULL OR page_number = ?)
       ORDER BY created_at DESC LIMIT 20000`,
    ).all(sourceId ?? null, sourceId ?? null, pageNumber ?? null, pageNumber ?? null) as FeedbackRecord[];

    let score = 0;
    for (const row of rows) {
      const feedback = decodeFeedback(row);
      const phrase = normalizeText(feedback.query);
      if (!phrase || !(phrase === normalizedQuery
        || phrase.includes(normalizedQuery)
        || normalizedQuery.includes(phrase))) continue;
      if (feedback.label === "positive") score += 0.06;
      else if (feedback.label === "negative") score -= 0.08;
      else score -= 0.02;
    }
    return Math.max(-0.2, Math.min(0.2, score));
  }
}

function decodeFeedback(row: FeedbackRecord): KnowledgeLearningFeedback {
  let metadata: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(row.metadata_json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      metadata = parsed as Record<string, unknown>;
    }
  } catch {
    // Feedback scoring does not depend on optional metadata.
  }
  return {
    id: row.id,
    query: row.query_text,
    ...(row.source_id ? { sourceId: row.source_id } : {}),
    ...(row.page_number !== null ? { pageNumber: row.page_number } : {}),
    label: row.label,
    ...(row.correction ? { correction: row.correction } : {}),
    createdAt: row.created_at,
    ...(Object.keys(metadata).length ? { metadata } : {}),
  };
}

function isFeedbackLabel(value: string): value is LearningFeedbackLabel {
  return value === "positive" || value === "negative" || value === "correction";
}

function normalizeText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().trim();
}

function boundedInteger(value: number, fallback: number, min: number, max: number): number {
  const integer = Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.max(min, Math.min(integer || fallback, max));
}
