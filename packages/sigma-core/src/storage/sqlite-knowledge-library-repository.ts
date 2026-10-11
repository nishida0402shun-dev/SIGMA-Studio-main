import type { SigmaSqliteDatabase } from "./sqlite-vector-index.js";

export interface KnowledgePageRow {
  id: string;
  source_id: string;
  page_number: number;
  semantic_type: string;
  title: string | null;
  text_content: string;
  extraction_status: string;
  structure_json: string;
  analysis_json: string;
  updated_at: string;
}

export interface KnowledgeSourceRow {
  id: string;
  display_name: string;
  mime_type: string;
  content_hash: string;
  original_uri: string;
  stored_uri: string;
  page_count: number;
  imported_at: string;
  updated_at: string;
  size_bytes: number;
  extraction_status: string;
  metadata_json: string;
}

export interface KnowledgeLibraryRows {
  revision: number;
  sources: Array<KnowledgeSourceRow & { pages: KnowledgePageRow[] }>;
}

/**
 * Owns SQLite persistence for the shared knowledge library. File extraction,
 * analysis, indexing and user-facing domain mapping remain in the host app.
 */
export class SqliteKnowledgeLibraryRepository {
  constructor(private readonly db: SigmaSqliteDatabase) {}

  load(): KnowledgeLibraryRows {
    const sourceRows = this.db.prepare(`
      SELECT id, display_name, mime_type, content_hash, original_uri, stored_uri,
        page_count, imported_at, updated_at, size_bytes, extraction_status, metadata_json
      FROM sigma_core_knowledge_sources
      ORDER BY imported_at DESC, rowid DESC
    `).all() as KnowledgeSourceRow[];
    const pageRows = this.db.prepare(`
      SELECT id, source_id, page_number, semantic_type, title, text_content,
        extraction_status, structure_json, analysis_json, updated_at
      FROM sigma_core_knowledge_pages ORDER BY source_id, page_number
    `).all() as KnowledgePageRow[];
    const pagesBySource = new Map<string, KnowledgePageRow[]>();
    for (const page of pageRows) {
      const pages = pagesBySource.get(page.source_id) ?? [];
      pages.push(page);
      pagesBySource.set(page.source_id, pages);
    }
    const revisionRow = this.db.prepare("SELECT revision FROM sigma_core_knowledge_state WHERE id = 1").get() as { revision: number };
    return {
      revision: Number(revisionRow.revision),
      sources: sourceRows.map((source) => ({ ...source, pages: pagesBySource.get(source.id) ?? [] })),
    };
  }

  save(sources: readonly (KnowledgeSourceRow & { pages: readonly KnowledgePageRow[] })[], expectedRevision?: number): number {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const revisionRow = this.db.prepare("SELECT revision FROM sigma_core_knowledge_state WHERE id = 1").get() as { revision: number };
      const currentRevision = Number(revisionRow.revision);
      if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
        throw new Error("Knowledge DB changed concurrently; the operation was not written. Please retry.");
      }

      const sourceIds = sources.map((source) => source.id);
      if (sourceIds.length) {
        const placeholders = sourceIds.map(() => "?").join(", ");
        this.db.prepare(`DELETE FROM sigma_core_knowledge_sources WHERE id NOT IN (${placeholders})`).run(...sourceIds);
      } else {
        this.db.exec("DELETE FROM sigma_core_knowledge_sources");
      }

      const upsertSource = this.db.prepare(`
        INSERT INTO sigma_core_knowledge_sources
          (id, display_name, original_uri, stored_uri, mime_type, size_bytes, content_hash,
           page_count, extraction_status, imported_at, updated_at, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          display_name = excluded.display_name,
          original_uri = excluded.original_uri,
          stored_uri = excluded.stored_uri,
          mime_type = excluded.mime_type,
          size_bytes = excluded.size_bytes,
          content_hash = excluded.content_hash,
          page_count = excluded.page_count,
          extraction_status = excluded.extraction_status,
          imported_at = excluded.imported_at,
          updated_at = excluded.updated_at,
          metadata_json = excluded.metadata_json
      `);
      const insertPage = this.db.prepare(`
        INSERT INTO sigma_core_knowledge_pages
          (id, source_id, page_number, semantic_type, title, text_content, extraction_status,
           structure_json, analysis_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const source of sources) {
        upsertSource.run(
          source.id, source.display_name, source.original_uri, source.stored_uri, source.mime_type,
          source.size_bytes, source.content_hash, source.page_count, source.extraction_status,
          source.imported_at, source.updated_at, source.metadata_json,
        );
        this.db.prepare("DELETE FROM sigma_core_knowledge_pages WHERE source_id = ?").run(source.id);
        for (const page of source.pages) {
          insertPage.run(
            page.id, source.id, page.page_number, page.semantic_type, page.title,
            page.text_content, page.extraction_status, page.structure_json, page.analysis_json, page.updated_at,
          );
        }
      }

      const nextRevision = currentRevision + 1;
      this.db.prepare("UPDATE sigma_core_knowledge_state SET revision = ? WHERE id = 1").run(nextRevision);
      this.db.exec("COMMIT");
      return nextRevision;
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* preserve the original error */ }
      throw error;
    }
  }
}
