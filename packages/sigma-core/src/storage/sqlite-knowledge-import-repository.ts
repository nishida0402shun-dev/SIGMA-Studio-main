import type { SigmaSqliteDatabase } from "./sqlite-vector-index.js";

export type KnowledgeImportStatus = "draft" | "approved" | "rejected";

export interface KnowledgeImportSegment {
  id: string;
  startPage: number;
  endPage: number;
  name: string;
  paths: string[][];
  confidence: number;
  reason: string;
  selected: boolean;
}

export interface KnowledgeImportDraft {
  id: string;
  status: KnowledgeImportStatus;
  sourcePath: string;
  sourceName: string;
  sourceHash: string;
  sizeBytes: number;
  pageCount: number;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  segments: KnowledgeImportSegment[];
}

interface KnowledgeImportRow {
  id: string;
  status: KnowledgeImportStatus;
  source_path: string;
  source_name: string;
  source_hash: string;
  size_bytes: number;
  page_count: number;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  segments_json: string;
}

/** Owns persistence for reviewed PDF-import drafts; extraction and file handling stay in the host app. */
export class SqliteKnowledgeImportRepository {
  constructor(private readonly db: SigmaSqliteDatabase) {}

  get(id: string): KnowledgeImportDraft | null {
    const row = this.db.prepare("SELECT * FROM sigma_core_knowledge_staging WHERE id = ?").get(id) as KnowledgeImportRow | undefined;
    return row ? this.fromRow(row) : null;
  }

  list(): KnowledgeImportDraft[] {
    const rows = this.db.prepare("SELECT * FROM sigma_core_knowledge_staging ORDER BY updated_at DESC, rowid DESC").all() as unknown as KnowledgeImportRow[];
    return rows.map((row) => this.fromRow(row));
  }

  save(draft: KnowledgeImportDraft): void {
    this.db.prepare(`
      INSERT INTO sigma_core_knowledge_staging
        (id, status, source_path, source_name, source_hash, size_bytes, page_count,
         created_at, updated_at, approved_at, segments_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        source_path = excluded.source_path,
        source_name = excluded.source_name,
        source_hash = excluded.source_hash,
        size_bytes = excluded.size_bytes,
        page_count = excluded.page_count,
        updated_at = excluded.updated_at,
        approved_at = excluded.approved_at,
        segments_json = excluded.segments_json
    `).run(
      draft.id, draft.status, draft.sourcePath, draft.sourceName, draft.sourceHash,
      draft.sizeBytes, draft.pageCount, draft.createdAt, draft.updatedAt,
      draft.approvedAt ?? null, JSON.stringify(draft.segments),
    );
  }

  private fromRow(row: KnowledgeImportRow): KnowledgeImportDraft {
    return {
      id: row.id,
      status: row.status,
      sourcePath: row.source_path,
      sourceName: row.source_name,
      sourceHash: row.source_hash,
      sizeBytes: row.size_bytes,
      pageCount: row.page_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...(row.approved_at ? { approvedAt: row.approved_at } : {}),
      segments: JSON.parse(row.segments_json) as KnowledgeImportSegment[],
    };
  }
}
