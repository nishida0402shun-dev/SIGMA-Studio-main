import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  QuestionAnswer,
  QuestionContent,
  QuestionDraft,
  QuestionRecord,
  QuestionSearchQuery,
  QuestionSource,
  QuestionTag,
  ReviewStatus,
} from "../core/question.js";
import type { QuestionRepository, QuestionSearchResult } from "../application/contracts.js";

type QuestionRow = {
  id: string;
  title: string;
  body_format: QuestionContent["format"];
  body_json: string;
  answer_json: string | null;
  difficulty: number | null;
  review_status: ReviewStatus;
  version: number;
  created_at: string;
  updated_at: string;
};

export class SqliteQuestionRepository implements QuestionRepository {
  constructor(private readonly db: DatabaseSync) {}

  async getById(id: string): Promise<QuestionRecord | null> {
    return this.loadRecord(id);
  }

  async create(draft: QuestionDraft): Promise<QuestionRecord> {
    const now = new Date().toISOString();
    const record: QuestionRecord = {
      id: "q_" + randomUUID(),
      title: normalizeTitle(draft.title),
      body: normalizeContent(draft.body),
      ...(draft.answer ? { answer: draft.answer } : {}),
      tags: draft.tags ?? [],
      sources: draft.sources ?? [],
      ...(draft.difficulty !== undefined ? { difficulty: draft.difficulty } : {}),
      reviewStatus: draft.reviewStatus ?? "draft",
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    this.validateRecord(record);
    this.inTransaction(() => {
      this.db.prepare(`
        INSERT INTO qe_questions
          (id, title, body_format, body_json, answer_json, difficulty, review_status, version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(record.id, record.title, record.body.format, JSON.stringify(record.body),
        record.answer ? JSON.stringify(record.answer) : null, record.difficulty ?? null,
        record.reviewStatus, record.version, record.createdAt, record.updatedAt);
      this.writeRelations(record);
      this.saveVersion(record, "created");
    });
    return record;
  }

  async update(id: string, expectedVersion: number, draft: QuestionDraft): Promise<QuestionRecord> {
    let updated: QuestionRecord | undefined;
    this.inTransaction(() => {
      const current = this.loadRecord(id);
      if (!current) throw new Error("Question not found");
      if (current.version !== expectedVersion) {
        throw new Error(`Question version conflict: expected ${expectedVersion}, current ${current.version}`);
      }
      const answer = Object.prototype.hasOwnProperty.call(draft, "answer") ? draft.answer : current.answer;
      const difficulty = Object.prototype.hasOwnProperty.call(draft, "difficulty") ? draft.difficulty : current.difficulty;
      updated = {
        id: current.id,
        title: normalizeTitle(draft.title),
        body: normalizeContent(draft.body),
        ...(answer ? { answer } : {}),
        tags: draft.tags ?? current.tags,
        sources: draft.sources ?? current.sources,
        ...(difficulty !== undefined ? { difficulty } : {}),
        reviewStatus: draft.reviewStatus ?? current.reviewStatus,
        createdAt: current.createdAt,
        updatedAt: new Date().toISOString(),
        version: current.version + 1,
      };
      this.validateRecord(updated);
      this.db.prepare(`
        UPDATE qe_questions SET title = ?, body_format = ?, body_json = ?, answer_json = ?,
          difficulty = ?, review_status = ?, version = ?, updated_at = ? WHERE id = ?
      `).run(updated.title, updated.body.format, JSON.stringify(updated.body),
        updated.answer ? JSON.stringify(updated.answer) : null, updated.difficulty ?? null,
        updated.reviewStatus, updated.version, updated.updatedAt, id);
      this.writeRelations(updated);
      this.saveVersion(updated, "updated");
    });
    return updated!;
  }

  async delete(id: string): Promise<void> {
    const existing = this.db.prepare("SELECT id FROM qe_questions WHERE id = ?").get(id);
    if (!existing) return;
    this.db.prepare("DELETE FROM qe_questions WHERE id = ?").run(id);
  }

  async search(query: QuestionSearchQuery): Promise<QuestionSearchResult> {
    const where: string[] = [];
    const params: Array<string | number> = [];
    const text = query.text?.normalize("NFKC").trim();
    if (text) {
      const tokens = text.match(/[a-z0-9]+|[ぁ-んァ-ヶ一-龯]{2,}/giu) ?? [];
      const fts = [...new Set(tokens)].slice(0, 32)
        .map((token) => '"' + token.replace(/"/gu, '""') + '"').join(" OR ");
      where.push(fts
        ? `(q.title LIKE ? OR q.body_json LIKE ? OR EXISTS (
            SELECT 1 FROM qe_questions_fts f
            WHERE f.question_id = q.id AND qe_questions_fts MATCH ?
          ))`
        : "(q.title LIKE ? OR q.body_json LIKE ?)");
      params.push("%" + text + "%", "%" + text + "%");
      if (fts) params.push(fts);
    }
    if (query.difficultyMin !== undefined) { where.push("q.difficulty >= ?"); params.push(query.difficultyMin); }
    if (query.difficultyMax !== undefined) { where.push("q.difficulty <= ?"); params.push(query.difficultyMax); }
    if (query.reviewStatuses?.length) {
      where.push("q.review_status IN (" + query.reviewStatuses.map(() => "?").join(",") + ")");
      params.push(...query.reviewStatuses);
    }
    if (query.tagIds?.length) {
      where.push("EXISTS (SELECT 1 FROM qe_question_tags qt WHERE qt.question_id = q.id AND qt.tag_id IN (" + query.tagIds.map(() => "?").join(",") + "))");
      params.push(...query.tagIds);
    }
    if (query.sourceIds?.length) {
      where.push("EXISTS (SELECT 1 FROM qe_question_sources qs WHERE qs.question_id = q.id AND qs.source_id IN (" + query.sourceIds.map(() => "?").join(",") + "))");
      params.push(...query.sourceIds);
    }
    const clause = where.length ? " WHERE " + where.join(" AND ") : "";
    const countRow = this.db.prepare("SELECT COUNT(*) AS total FROM qe_questions q" + clause).get(...params) as { total: number };
    const limit = Math.max(1, Math.min(Math.trunc(query.limit ?? 50) || 1, 200));
    const offset = Math.max(0, Math.trunc(query.offset ?? 0) || 0);
    const rows = this.db.prepare("SELECT q.* FROM qe_questions q" + clause + " ORDER BY q.updated_at DESC, q.rowid DESC LIMIT ? OFFSET ?")
      .all(...params, limit, offset) as QuestionRow[];
    return { items: rows.map((row) => this.loadRecord(row.id)!).filter(Boolean), total: countRow.total };
  }

  private loadRecord(id: string): QuestionRecord | null {
    const row = this.db.prepare("SELECT * FROM qe_questions WHERE id = ?").get(id) as QuestionRow | undefined;
    if (!row) return null;
    const tags = this.db.prepare(`
      SELECT t.id, t.label, t.taxonomy_path_json FROM qe_question_tags qt
      JOIN qe_tags t ON t.id = qt.tag_id WHERE qt.question_id = ? ORDER BY t.label
    `).all(id) as Array<{ id: string; label: string; taxonomy_path_json: string }>;
    const sources = this.db.prepare(`
      SELECT s.id, s.display_name, s.content_hash, s.original_uri, qs.page_number, qs.region_json
      FROM qe_question_sources qs JOIN qe_sources s ON s.id = qs.source_id
      WHERE qs.question_id = ? ORDER BY s.display_name, qs.page_number
    `).all(id) as Array<{
      id: string; display_name: string; content_hash: string; original_uri: string | null;
      page_number: number | null; region_json: string | null;
    }>;
    const body = JSON.parse(row.body_json) as QuestionContent;
    const answer = row.answer_json ? JSON.parse(row.answer_json) as QuestionAnswer : undefined;
    return {
      id: row.id,
      title: row.title,
      body,
      ...(answer ? { answer } : {}),
      tags: tags.map((tag) => ({
        id: tag.id,
        label: tag.label,
        taxonomyPath: JSON.parse(tag.taxonomy_path_json) as string[],
      })),
      sources: sources.map((source) => ({
        id: source.id,
        name: source.display_name,
        contentHash: source.content_hash || undefined,
        uri: source.original_uri ?? undefined,
        ...(source.page_number !== null ? { pageNumber: source.page_number } : {}),
        ...(source.region_json ? { region: JSON.parse(source.region_json) as [number, number, number, number] } : {}),
      })),
      ...(row.difficulty !== null ? { difficulty: row.difficulty as 1 | 2 | 3 | 4 | 5 } : {}),
      reviewStatus: row.review_status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
    };
  }

  private writeRelations(record: QuestionRecord): void {
    this.db.prepare("DELETE FROM qe_question_tags WHERE question_id = ?").run(record.id);
    this.db.prepare("DELETE FROM qe_question_sources WHERE question_id = ?").run(record.id);
    const insertTag = this.db.prepare("INSERT INTO qe_tags(id, label, taxonomy_path_json) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET label = excluded.label, taxonomy_path_json = excluded.taxonomy_path_json");
    const findTag = this.db.prepare("SELECT id FROM qe_tags WHERE label = ? AND taxonomy_path_json = ?");
    const linkTag = this.db.prepare("INSERT OR IGNORE INTO qe_question_tags(question_id, tag_id) VALUES (?, ?)");
    for (const tag of record.tags) {
      const taxonomy = JSON.stringify(tag.taxonomyPath ?? []);
      const existing = findTag.get(tag.label, taxonomy) as { id: string } | undefined;
      const tagId = existing?.id ?? tag.id;
      if (!existing) insertTag.run(tagId, tag.label, taxonomy);
      linkTag.run(record.id, tagId);
    }

    const insertSource = this.db.prepare(`
      INSERT INTO qe_sources(id, display_name, mime_type, content_hash, original_uri, page_count, imported_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, '{}')
      ON CONFLICT(id) DO NOTHING
    `);
    const linkSource = this.db.prepare(`
      INSERT OR REPLACE INTO qe_question_sources(question_id, source_id, page_number, region_json, evidence_role)
      VALUES (?, ?, ?, ?, 'source')
    `);
    for (const source of record.sources) {
      insertSource.run(source.id, source.name, "application/octet-stream", source.contentHash ?? "",
        source.uri ?? null, source.pageNumber ?? 0, new Date().toISOString());
      linkSource.run(record.id, source.id, source.pageNumber ?? null, source.region ? JSON.stringify(source.region) : null);
    }

    const question = this.db.prepare("SELECT title, body_json FROM qe_questions WHERE id = ?").get(record.id) as { title: string; body_json: string };
    const tagText = (this.db.prepare(`
      SELECT group_concat(t.label, ' ') AS labels
      FROM qe_question_tags qt JOIN qe_tags t ON t.id = qt.tag_id
      WHERE qt.question_id = ?
    `).get(record.id) as { labels: string | null }).labels ?? "";
    this.db.prepare("DELETE FROM qe_questions_fts WHERE question_id = ?").run(record.id);
    this.db.prepare("INSERT INTO qe_questions_fts(question_id, title, body_text, tags_text) VALUES (?, ?, ?, ?)")
      .run(record.id, question.title, question.body_json, tagText);
  }

  private saveVersion(record: QuestionRecord, reason: string): void {
    this.db.prepare(`
      INSERT INTO qe_question_versions(question_id, version, snapshot_json, changed_at, change_reason)
      VALUES (?, ?, ?, ?, ?)
    `).run(record.id, record.version, JSON.stringify(record), record.updatedAt, reason);
  }

  private validateRecord(record: QuestionRecord): void {
    if (!record.title.trim()) throw new Error("Question title is required");
    if (!record.body || !["sigma-document", "markdown", "plain-text"].includes(record.body.format)) {
      throw new Error("Question body format is invalid");
    }
    if (record.difficulty !== undefined && ![1, 2, 3, 4, 5].includes(record.difficulty)) {
      throw new Error("Question difficulty must be between 1 and 5");
    }
  }

  private inTransaction(operation: () => void): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      operation();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

function normalizeTitle(title: string): string {
  return title.normalize("NFKC").trim().slice(0, 500);
}

function normalizeContent(content: QuestionContent): QuestionContent {
  return { format: content.format, content: content.content };
}
