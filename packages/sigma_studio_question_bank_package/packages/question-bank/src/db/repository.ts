import Database from 'better-sqlite3';
import { Question, QuestionFilter, SearchResponse } from '../types';

export class QuestionRepository {
  constructor(private db: Database.Database) {}

  public search(filter: QuestionFilter): SearchResponse {
    let whereClauses: string[] = ['1=1'];
    const params: any[] = [];

    if (filter.subjectId) {
      whereClauses.push('t.subject_id = ?');
      params.push(filter.subjectId);
    }
    if (filter.unitName) {
      whereClauses.push('t.unit_name = ?');
      params.push(filter.unitName);
    }
    if (filter.difficulty) {
      whereClauses.push('q.difficulty = ?');
      params.push(filter.difficulty);
    }

    let ftsJoin = '';
    if (filter.keyword && filter.keyword.trim() !== '') {
      ftsJoin = 'JOIN questions_fts fts ON q.rowid = fts.rowid';
      whereClauses.push('questions_fts MATCH ?');
      const formattedKw = filter.keyword.trim().split(/\s+/).map(k => `"${k}"*`).join(' AND ');
      params.push(formattedKw);
    }

    const countSql = `
      SELECT COUNT(*) as total
      FROM questions q
      JOIN taxonomy t ON q.taxonomy_id = t.id
      ${ftsJoin}
      WHERE ${whereClauses.join(' AND ')}
    `;
    const total = (this.db.prepare(countSql).get(...params) as { total: number }).total;

    const limit = filter.limit || 20;
    const page = filter.page || 1;
    const offset = (page - 1) * limit;

    const selectSql = `
      SELECT 
        q.id, q.title, q.difficulty, q.tags, q.body_json, q.solution_json,
        q.created_at, q.updated_at,
        t.subject_id, t.subject_name, t.domain_name, t.unit_name
      FROM questions q
      JOIN taxonomy t ON q.taxonomy_id = t.id
      ${ftsJoin}
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY q.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const rows = this.db.prepare(selectSql).all(...params, limit, offset) as any[];

    return {
      items: rows.map(r => ({
        id: r.id,
        title: r.title,
        taxonomy: {
          subjectId: r.subject_id,
          subjectName: r.subject_name,
          domainName: r.domain_name,
          unitName: r.unit_name,
        },
        difficulty: r.difficulty,
        tags: JSON.parse(r.tags || '[]'),
        body: JSON.parse(r.body_json),
        solution: r.solution_json ? JSON.parse(r.solution_json) : undefined,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  public save(question: Question): { success: boolean; id: string } {
    const id = question.id || crypto.randomUUID();
    const taxonomyId = question.taxonomyId || 'tax_chem_01';

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO questions (id, taxonomy_id, title, difficulty, tags, body_json, solution_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    stmt.run(
      id,
      taxonomyId,
      question.title,
      question.difficulty,
      JSON.stringify(question.tags || []),
      JSON.stringify(question.body),
      question.solution ? JSON.stringify(question.solution) : null
    );

    return { success: true, id };
  }

  public delete(id: string): { success: boolean } {
    const stmt = this.db.prepare('DELETE FROM questions WHERE id = ?');
    stmt.run(id);
    return { success: true };
  }
}
