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
} from "../../../question-engine/src/core/question.js";
import type { QuestionRepository, QuestionSearchResult } from "../../../question-engine/src/application/contracts.js";

type QuestionRow = {
  id: string;
  title: string;
  difficulty: number | null;
  review_status: ReviewStatus;
  version: number;
  created_at: string;
  updated_at: string;
  body_format: QuestionContent["format"];
  body_json: string;
  answer_content_json: string | null;
  verification: QuestionAnswer["verification"] | null;
  evidence_source_ids_json: string | null;
  explanation_json: string | null;
};

type TagRow = { id: string; label: string; taxonomy_path_json: string };
type SourceRow = {
  id: string;
  display_name: string;
  content_hash: string;
  original_uri: string | null;
  page_number: number | null;
  region_json: string | null;
};

export class SqliteQuestionRepository implements QuestionRepository {
  constructor(private readonly database: DatabaseSync) {}

  async getById(id: string): Promise<QuestionRecord | null> {
    return this.readQuestion(id);
  }

  async create(draft: QuestionDraft): Promise<QuestionRecord> {
    const timestamp = new Date().toISOString();
    const record: QuestionRecord = {
      id: `question_${randomUUID()}`,
      title: cleanTitle(draft.title),
      body: cleanContent(draft.body),
      ...(draft.answer ? { answer: cleanAnswer(draft.answer) } : {}),
      tags: cleanTags(draft.tags ?? []),
      sources: cleanSources(draft.sources ?? []),
      ...(draft.difficulty !== undefined ? { difficulty: draft.difficulty } : {}),
      reviewStatus: draft.reviewStatus ?? "draft",
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    };
    validateQuestion(record);

    this.withTransaction(() => {
      this.database.prepare(
        `INSERT INTO sigma_core_questions
          (id, title, difficulty, review_status, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(record.id, record.title, record.difficulty ?? null, record.reviewStatus,
        record.version, record.createdAt, record.updatedAt);
      this.writeContent(record);
      this.writeAnswer(record);
      this.replaceAssociations(record);
      this.writeRevision(record, "created");
    });
    return record;
  }

  async update(id: string, expectedVersion: number, draft: QuestionDraft): Promise<QuestionRecord> {
    let result: QuestionRecord | undefined;
    this.withTransaction(() => {
      const current = this.readQuestion(id);
      if (!current) throw new Error("Question not found");
      if (current.version !== expectedVersion) {
        throw new Error(`Question version conflict: expected ${expectedVersion}, current ${current.version}`);
      }

      const next: QuestionRecord = {
        ...current,
        title: cleanTitle(draft.title),
        body: cleanContent(draft.body),
        ...(Object.prototype.hasOwnProperty.call(draft, "answer")
          ? (draft.answer ? { answer: cleanAnswer(draft.answer) } : { answer: undefined })
          : {}),
        tags: draft.tags === undefined ? current.tags : cleanTags(draft.tags),
        sources: draft.sources === undefined ? current.sources : cleanSources(draft.sources),
        ...(Object.prototype.hasOwnProperty.call(draft, "difficulty")
          ? (draft.difficulty === undefined ? { difficulty: undefined } : { difficulty: draft.difficulty })
          : {}),
        reviewStatus: draft.reviewStatus ?? current.reviewStatus,
        updatedAt: new Date().toISOString(),
        version: current.version + 1,
      };
      validateQuestion(next);

      const updated = this.database.prepare(
        `UPDATE sigma_core_questions SET title = ?, difficulty = ?, review_status = ?,
          version = ?, updated_at = ? WHERE id = ? AND version = ?`,
      ).run(next.title, next.difficulty ?? null, next.reviewStatus, next.version, next.updatedAt, id, expectedVersion) as { changes: number | bigint };
      if (Number(updated.changes) !== 1) throw new Error("Question version conflict");
      this.writeContent(next);
      this.writeAnswer(next);
      this.replaceAssociations(next);
      this.writeRevision(next, "updated");
      result = next;
    });
    if (!result) throw new Error("Question update did not produce a result");
    return result;
  }

  async delete(id: string): Promise<void> {
    this.withTransaction(() => {
      this.database.prepare("DELETE FROM sigma_core_questions_fts WHERE question_id = ?").run(id);
      this.database.prepare("DELETE FROM sigma_core_questions WHERE id = ?").run(id);
    });
  }

  async search(query: QuestionSearchQuery): Promise<QuestionSearchResult> {
    const filters: string[] = [];
    const parameters: Array<string | number> = [];
    const searchText = query.text?.normalize("NFKC").trim();
    if (searchText) {
      const words = [...new Set(searchText.match(/[a-z0-9]+|[ぁ-んァ-ヶ一-龯]{2,}/giu) ?? [])].slice(0, 32);
      const ftsExpression = words.map((word) => '"' + word.replace(/"/gu, '""') + '"').join(" OR ");
      filters.push(ftsExpression
        ? "(q.title LIKE ? OR EXISTS (SELECT 1 FROM sigma_core_question_contents qc WHERE qc.question_id = q.id AND qc.body_json LIKE ?) OR q.id IN (SELECT question_id FROM sigma_core_questions_fts WHERE sigma_core_questions_fts MATCH ?))"
        : "(q.title LIKE ? OR EXISTS (SELECT 1 FROM sigma_core_question_contents qc WHERE qc.question_id = q.id AND qc.body_json LIKE ?))");
      parameters.push(`%${searchText}%`, `%${searchText}%`);
      if (ftsExpression) parameters.push(ftsExpression);
    }
    if (query.difficultyMin !== undefined) { filters.push("q.difficulty >= ?"); parameters.push(query.difficultyMin); }
    if (query.difficultyMax !== undefined) { filters.push("q.difficulty <= ?"); parameters.push(query.difficultyMax); }
    if (query.reviewStatuses?.length) {
      filters.push(`q.review_status IN (${query.reviewStatuses.map(() => "?").join(",")})`);
      parameters.push(...query.reviewStatuses);
    }
    if (query.tagIds?.length) {
      filters.push(`EXISTS (SELECT 1 FROM sigma_core_question_tags qt WHERE qt.question_id = q.id AND qt.tag_id IN (${query.tagIds.map(() => "?").join(",")}))`);
      parameters.push(...query.tagIds);
    }
    if (query.sourceIds?.length) {
      filters.push(`EXISTS (SELECT 1 FROM sigma_core_question_sources qs WHERE qs.question_id = q.id AND qs.source_id IN (${query.sourceIds.map(() => "?").join(",")}))`);
      parameters.push(...query.sourceIds);
    }

    const where = filters.length ? ` WHERE ${filters.join(" AND ")}` : "";
    let countRow: { total: number };
    try {
      countRow = this.database.prepare(`SELECT COUNT(*) AS total FROM sigma_core_questions q${where}`)
        .get(...parameters) as { total: number };
    } catch (error) {
      // FTS syntax errors should not make basic title/body search unavailable.
      if (!searchText) throw error;
      return this.searchWithoutFts(query, searchText);
    }
    const limit = boundedInteger(query.limit ?? 50, 50, 1, 200);
    const offset = boundedInteger(query.offset ?? 0, 0, 0, 1_000_000);
    const rows = this.database.prepare(
      `SELECT q.id FROM sigma_core_questions q${where} ORDER BY q.updated_at DESC, q.rowid DESC LIMIT ? OFFSET ?`,
    ).all(...parameters, limit, offset) as Array<{ id: string }>;
    return {
      items: rows.map(({ id }) => this.readQuestion(id)).filter((value): value is QuestionRecord => value !== null),
      total: countRow.total,
    };
  }

  private searchWithoutFts(query: QuestionSearchQuery, text: string): Promise<QuestionSearchResult> {
    const fallbackQuery = { ...query, text: text.replace(/[^p{L}p{N}s]/gu, " ") };
    return this.searchBasic(fallbackQuery);
  }

  private async searchBasic(query: QuestionSearchQuery): Promise<QuestionSearchResult> {
    const predicates: string[] = [];
    const values: Array<string | number> = [];
    if (query.text?.trim()) {
      predicates.push("(q.title LIKE ? OR EXISTS (SELECT 1 FROM sigma_core_question_contents qc WHERE qc.question_id = q.id AND qc.body_json LIKE ?))");
      values.push(`%${query.text.trim()}%`, `%${query.text.trim()}%`);
    }
    if (query.difficultyMin !== undefined) { predicates.push("q.difficulty >= ?"); values.push(query.difficultyMin); }
    if (query.difficultyMax !== undefined) { predicates.push("q.difficulty <= ?"); values.push(query.difficultyMax); }
    if (query.reviewStatuses?.length) {
      predicates.push(`q.review_status IN (${query.reviewStatuses.map(() => "?").join(",")})`);
      values.push(...query.reviewStatuses);
    }
    if (query.tagIds?.length) {
      predicates.push(`EXISTS (SELECT 1 FROM sigma_core_question_tags qt WHERE qt.question_id = q.id AND qt.tag_id IN (${query.tagIds.map(() => "?").join(",")}))`);
      values.push(...query.tagIds);
    }
    if (query.sourceIds?.length) {
      predicates.push(`EXISTS (SELECT 1 FROM sigma_core_question_sources qs WHERE qs.question_id = q.id AND qs.source_id IN (${query.sourceIds.map(() => "?").join(",")}))`);
      values.push(...query.sourceIds);
    }
    const where = predicates.length ? ` WHERE ${predicates.join(" AND ")}` : "";
    const total = (this.database.prepare(`SELECT COUNT(*) AS total FROM sigma_core_questions q${where}`)
      .get(...values) as { total: number }).total;
    const limit = boundedInteger(query.limit ?? 50, 50, 1, 200);
    const offset = boundedInteger(query.offset ?? 0, 0, 0, 1_000_000);
    const rows = this.database.prepare(
      `SELECT q.id FROM sigma_core_questions q${where} ORDER BY q.updated_at DESC, q.rowid DESC LIMIT ? OFFSET ?`,
    ).all(...values, limit, offset) as Array<{ id: string }>;
    return {
      items: rows.map(({ id }) => this.readQuestion(id)).filter((value): value is QuestionRecord => value !== null),
      total,
    };
  }

  private readQuestion(id: string): QuestionRecord | null {
    const row = this.database.prepare(
      `SELECT q.*, c.body_format, c.body_json, a.answer_content_json, a.verification,
              a.evidence_source_ids_json, a.explanation_json
       FROM sigma_core_questions q
       JOIN sigma_core_question_contents c ON c.question_id = q.id
       LEFT JOIN sigma_core_question_answers a ON a.question_id = q.id
       WHERE q.id = ?`,
    ).get(id) as QuestionRow | undefined;
    if (!row) return null;

    const tags = this.database.prepare(
      `SELECT t.id, t.label, t.taxonomy_path_json
       FROM sigma_core_question_tags qt JOIN sigma_core_tags t ON t.id = qt.tag_id
       WHERE qt.question_id = ? ORDER BY t.label`,
    ).all(id) as TagRow[];
    const sources = this.database.prepare(
      `SELECT s.id, s.display_name, s.content_hash, s.original_uri, qs.page_number, qs.region_json
       FROM sigma_core_question_sources qs JOIN sigma_core_sources s ON s.id = qs.source_id
       WHERE qs.question_id = ? ORDER BY s.display_name, qs.page_number`,
    ).all(id) as SourceRow[];

    const body = JSON.parse(row.body_json) as QuestionContent;
    const answer = row.answer_content_json && row.verification
      ? {
          content: JSON.parse(row.answer_content_json) as QuestionContent,
          verification: row.verification,
          evidenceSourceIds: JSON.parse(row.evidence_source_ids_json ?? "[]") as string[],
          ...(row.explanation_json ? { explanation: JSON.parse(row.explanation_json) as QuestionContent } : {}),
        } satisfies QuestionAnswer
      : undefined;
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
        ...(source.content_hash ? { contentHash: source.content_hash } : {}),
        ...(source.original_uri ? { uri: source.original_uri } : {}),
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

  private replaceAssociations(record: QuestionRecord): void {
    this.database.prepare("DELETE FROM sigma_core_question_tags WHERE question_id = ?").run(record.id);
    this.database.prepare("DELETE FROM sigma_core_question_sources WHERE question_id = ?").run(record.id);

    const tagLookup = this.database.prepare(
      "SELECT id FROM sigma_core_tags WHERE label = ? AND taxonomy_path_json = ?",
    );
    const tagInsert = this.database.prepare(
      "INSERT INTO sigma_core_tags(id, label, taxonomy_path_json) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET label = excluded.label, taxonomy_path_json = excluded.taxonomy_path_json",
    );
    const tagLink = this.database.prepare(
      "INSERT OR IGNORE INTO sigma_core_question_tags(question_id, tag_id) VALUES (?, ?)",
    );
    for (const tag of record.tags) {
      const taxonomy = JSON.stringify(tag.taxonomyPath ?? []);
      const existing = tagLookup.get(tag.label, taxonomy) as { id: string } | undefined;
      const tagId = existing?.id ?? tag.id;
      if (!existing) tagInsert.run(tagId, tag.label, taxonomy);
      tagLink.run(record.id, tagId);
    }

    const sourceInsert = this.database.prepare(
      `INSERT INTO sigma_core_sources
        (id, display_name, mime_type, content_hash, original_uri, page_count, imported_at, metadata_json)
       VALUES (?, ?, 'application/octet-stream', ?, ?, ?, ?, '{}')
       ON CONFLICT(id) DO NOTHING`,
    );
    const sourceLink = this.database.prepare(
      `INSERT OR REPLACE INTO sigma_core_question_sources
        (question_id, source_id, page_number, region_json, evidence_role)
       VALUES (?, ?, ?, ?, 'source')`,
    );
    for (const source of record.sources) {
      sourceInsert.run(source.id, source.name, source.contentHash ?? "", source.uri ?? null,
        source.pageNumber ?? 0, new Date().toISOString());
      sourceLink.run(record.id, source.id, source.pageNumber ?? null,
        source.region ? JSON.stringify(source.region) : null);
    }

    const row = this.database.prepare(
      `SELECT q.title, c.body_json FROM sigma_core_questions q
       JOIN sigma_core_question_contents c ON c.question_id = q.id WHERE q.id = ?`,
    ).get(record.id) as { title: string; body_json: string };
    const labels = (this.database.prepare(
      `SELECT group_concat(t.label, ' ') AS labels FROM sigma_core_question_tags qt
       JOIN sigma_core_tags t ON t.id = qt.tag_id WHERE qt.question_id = ?`,
    ).get(record.id) as { labels: string | null }).labels ?? "";
    this.database.prepare("DELETE FROM sigma_core_questions_fts WHERE question_id = ?").run(record.id);
    this.database.prepare(
      "INSERT INTO sigma_core_questions_fts(question_id, title, body_text, tags_text) VALUES (?, ?, ?, ?)",
    ).run(record.id, row.title, row.body_json, labels);
  }

  private writeContent(record: QuestionRecord): void {
    this.database.prepare(
      `INSERT INTO sigma_core_question_contents(question_id, body_format, body_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(question_id) DO UPDATE SET
         body_format = excluded.body_format, body_json = excluded.body_json, updated_at = excluded.updated_at`,
    ).run(record.id, record.body.format, JSON.stringify(record.body), record.updatedAt);
  }

  private writeAnswer(record: QuestionRecord): void {
    if (!record.answer) {
      this.database.prepare("DELETE FROM sigma_core_question_answers WHERE question_id = ?").run(record.id);
      return;
    }
    this.database.prepare(
      `INSERT INTO sigma_core_question_answers
        (question_id, answer_content_json, verification, evidence_source_ids_json, explanation_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(question_id) DO UPDATE SET
         answer_content_json = excluded.answer_content_json,
         verification = excluded.verification,
         evidence_source_ids_json = excluded.evidence_source_ids_json,
         explanation_json = excluded.explanation_json,
         updated_at = excluded.updated_at`,
    ).run(
      record.id,
      JSON.stringify(record.answer.content),
      record.answer.verification,
      JSON.stringify(record.answer.evidenceSourceIds),
      record.answer.explanation ? JSON.stringify(record.answer.explanation) : null,
      record.updatedAt,
    );
  }

  private writeRevision(record: QuestionRecord, reason: string): void {
    this.database.prepare(
      `INSERT INTO sigma_core_question_versions(question_id, version, snapshot_json, changed_at, change_reason)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(record.id, record.version, JSON.stringify(record), record.updatedAt, reason);
  }

  private withTransaction(action: () => void): void {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      action();
      this.database.exec("COMMIT");
    } catch (error) {
      try { this.database.exec("ROLLBACK"); } catch { /* Preserve the primary operation error. */ }
      throw error;
    }
  }
}

function cleanTitle(value: string): string {
  return value.normalize("NFKC").trim().slice(0, 500);
}

function cleanContent(value: QuestionContent): QuestionContent {
  if (!value || !["sigma-document", "markdown", "plain-text"].includes(value.format)) {
    throw new Error("Question body format is invalid");
  }
  return { format: value.format, content: value.content };
}

function cleanAnswer(value: QuestionAnswer): QuestionAnswer {
  if (!value || !["unverified", "ai-proposed", "source-checked", "human-verified"].includes(value.verification)) {
    throw new Error("Question answer verification status is invalid");
  }
  return {
    content: cleanContent(value.content),
    verification: value.verification,
    evidenceSourceIds: [...new Set(value.evidenceSourceIds.map((id) => id.trim()).filter(Boolean))],
    ...(value.explanation ? { explanation: cleanContent(value.explanation) } : {}),
  };
}

function cleanTags(tags: readonly QuestionTag[]): QuestionTag[] {
  const unique = new Map<string, QuestionTag>();
  for (const tag of tags) {
    const label = tag.label.trim().slice(0, 200);
    if (!label) continue;
    const taxonomyPath = (tag.taxonomyPath ?? []).map((part) => part.trim()).filter(Boolean).slice(0, 20);
    const key = label + "\u0000" + JSON.stringify(taxonomyPath);
    if (!unique.has(key)) unique.set(key, { id: tag.id.trim() || `tag_${randomUUID()}`, label, taxonomyPath });
  }
  return [...unique.values()].slice(0, 100);
}

function cleanSources(sources: readonly QuestionSource[]): QuestionSource[] {
  const unique = new Map<string, QuestionSource>();
  for (const source of sources) {
    const id = source.id.trim();
    const name = source.name.trim();
    if (!id || !name) continue;
    const pageNumber = source.pageNumber;
    if (pageNumber !== undefined && (!Number.isInteger(pageNumber) || pageNumber < 1)) {
      throw new Error("Question source page number must be positive");
    }
    if (source.region && (source.region.length !== 4 || source.region.some((value) => !Number.isFinite(value)))) {
      throw new Error("Question source region is invalid");
    }
    const key = `${id}\u0000${pageNumber ?? ""}`;
    if (!unique.has(key)) unique.set(key, {
      id, name,
      ...(source.contentHash ? { contentHash: source.contentHash } : {}),
      ...(source.uri ? { uri: source.uri } : {}),
      ...(pageNumber !== undefined ? { pageNumber } : {}),
      ...(source.region ? { region: [...source.region] as [number, number, number, number] } : {}),
    });
  }
  return [...unique.values()].slice(0, 500);
}

function validateQuestion(record: QuestionRecord): void {
  if (!record.title) throw new Error("Question title is required");
  if (record.difficulty !== undefined && ![1, 2, 3, 4, 5].includes(record.difficulty)) {
    throw new Error("Question difficulty must be between 1 and 5");
  }
  if (!["draft", "needs-review", "approved", "rejected"].includes(record.reviewStatus)) {
    throw new Error("Question review status is invalid");
  }
}

function boundedInteger(value: number, fallback: number, min: number, max: number): number {
  const integer = Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.max(min, Math.min(integer, max));
}
