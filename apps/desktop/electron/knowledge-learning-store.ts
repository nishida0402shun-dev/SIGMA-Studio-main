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

type FeedbackRow = {
  id: string;
  query_text: string;
  source_id: string | null;
  page_number: number | null;
  label: LearningFeedbackLabel;
  correction: string | null;
  created_at: string;
  metadata_json: string;
};

const MAX_FEEDBACK = 20_000;

export class KnowledgeLearningStore {
  constructor(private readonly db: DatabaseSync) {}

  async record(input: Omit<KnowledgeLearningFeedback, "id" | "createdAt">): Promise<KnowledgeLearningFeedback> {
    const query = input.query.trim();
    if (!query) throw new Error("learning query is empty");
    if (query.length > 10_000) throw new Error("learning query is too long");
    const entry: KnowledgeLearningFeedback = {
      ...input,
      id: "learn_" + randomUUID(),
      query,
      createdAt: new Date().toISOString(),
    };
    this.db.prepare(`
      INSERT INTO qe_knowledge_learning_feedback
        (id, query_text, source_id, page_number, label, correction, created_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(entry.id, entry.query, entry.sourceId ?? null, entry.pageNumber ?? null, entry.label,
      entry.correction ?? null, entry.createdAt, JSON.stringify(entry.metadata ?? {}));
    this.db.prepare(`
      DELETE FROM qe_knowledge_learning_feedback
      WHERE id IN (
        SELECT id FROM qe_knowledge_learning_feedback
        ORDER BY created_at DESC, rowid DESC
        LIMIT -1 OFFSET ?
      )
    `).run(MAX_FEEDBACK);
    return entry;
  }

  async list(limit = 100): Promise<KnowledgeLearningFeedback[]> {
    const safeLimit = Math.max(1, Math.min(Math.trunc(limit) || 1, 500));
    return (this.db.prepare(`
      SELECT * FROM qe_knowledge_learning_feedback
      ORDER BY created_at DESC, rowid DESC LIMIT ?
    `).all(safeLimit) as FeedbackRow[]).map(fromRow);
  }

  async getBoost(query: string, sourceId?: string, pageNumber?: number): Promise<number> {
    const normalized = query.normalize("NFKC").toLocaleLowerCase().trim();
    if (!normalized) return 0;
    const rows = this.db.prepare("SELECT * FROM qe_knowledge_learning_feedback").all() as FeedbackRow[];
    let boost = 0;
    for (const row of rows) {
      const item = fromRow(row);
      if (sourceId && item.sourceId !== sourceId) continue;
      if (pageNumber !== undefined && item.pageNumber !== pageNumber) continue;
      const text = item.query.normalize("NFKC").toLocaleLowerCase();
      if (!(normalized === text || normalized.includes(text) || text.includes(normalized))) continue;
      if (item.label === "positive") boost += 0.06;
      if (item.label === "negative") boost -= 0.08;
      if (item.label === "correction") boost -= 0.02;
    }
    return Math.max(-0.20, Math.min(0.20, boost));
  }
}

function fromRow(row: FeedbackRow): KnowledgeLearningFeedback {
  const metadata = JSON.parse(row.metadata_json) as Record<string, unknown>;
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
