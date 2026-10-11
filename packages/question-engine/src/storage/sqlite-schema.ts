/**
 * Canonical local database schema for Question Engine.
 *
 * The adapter is deliberately structural so the domain package does not import
 * a concrete SQLite driver. The Electron composition root will inject the
 * approved driver. This module never opens a file or chooses a user-data path.
 */

export interface SqliteSchemaDriver {
  exec(sql: string): unknown;
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): unknown;
  };
  pragma?(source: string): unknown;
  transaction?<T extends (...args: never[]) => unknown>(operation: T): T;
}

export const QUESTION_ENGINE_SCHEMA_VERSION = 1;

const MIGRATION_TABLE = `
  CREATE TABLE IF NOT EXISTS qe_schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  );
`;

const CORE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS qe_sources (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    original_uri TEXT,
    page_count INTEGER NOT NULL CHECK (page_count >= 0),
    imported_at TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}'
  );

  CREATE INDEX IF NOT EXISTS qe_sources_hash_idx ON qe_sources(content_hash);

  CREATE TABLE IF NOT EXISTS qe_questions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    body_format TEXT NOT NULL CHECK (body_format IN ('sigma-document', 'markdown', 'plain-text')),
    body_json TEXT NOT NULL,
    answer_json TEXT,
    difficulty INTEGER CHECK (difficulty BETWEEN 1 AND 5),
    review_status TEXT NOT NULL CHECK (review_status IN ('draft', 'needs-review', 'approved', 'rejected')),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS qe_questions_review_idx ON qe_questions(review_status);
  CREATE INDEX IF NOT EXISTS qe_questions_difficulty_idx ON qe_questions(difficulty);

  CREATE TABLE IF NOT EXISTS qe_tags (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    taxonomy_path_json TEXT NOT NULL DEFAULT '[]',
    UNIQUE(label, taxonomy_path_json)
  );

  CREATE TABLE IF NOT EXISTS qe_question_tags (
    question_id TEXT NOT NULL REFERENCES qe_questions(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES qe_tags(id) ON DELETE CASCADE,
    PRIMARY KEY(question_id, tag_id)
  );

  CREATE TABLE IF NOT EXISTS qe_question_sources (
    question_id TEXT NOT NULL REFERENCES qe_questions(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL REFERENCES qe_sources(id) ON DELETE RESTRICT,
    page_number INTEGER,
    region_json TEXT,
    evidence_role TEXT NOT NULL DEFAULT 'source',
    PRIMARY KEY(question_id, source_id, page_number, evidence_role)
  );

  CREATE TABLE IF NOT EXISTS qe_question_versions (
    question_id TEXT NOT NULL REFERENCES qe_questions(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    snapshot_json TEXT NOT NULL,
    changed_at TEXT NOT NULL,
    change_reason TEXT,
    PRIMARY KEY(question_id, version)
  );

  CREATE TABLE IF NOT EXISTS qe_import_jobs (
    id TEXT PRIMARY KEY,
    source_name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
    completed_units INTEGER NOT NULL DEFAULT 0 CHECK (completed_units >= 0),
    total_units INTEGER CHECK (total_units IS NULL OR total_units >= 0),
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS qe_import_proposals (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES qe_import_jobs(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL REFERENCES qe_sources(id) ON DELETE RESTRICT,
    page_refs_json TEXT NOT NULL,
    draft_json TEXT NOT NULL,
    confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
    warnings_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL CHECK (status IN ('pending-review', 'approved', 'rejected')),
    created_at TEXT NOT NULL,
    reviewed_at TEXT
  );

  CREATE INDEX IF NOT EXISTS qe_proposals_job_status_idx ON qe_import_proposals(job_id, status);

  CREATE TABLE IF NOT EXISTS qe_question_attempts (
    id TEXT PRIMARY KEY,
    question_id TEXT NOT NULL REFERENCES qe_questions(id) ON DELETE RESTRICT,
    answered_at TEXT NOT NULL,
    response_json TEXT,
    is_correct INTEGER CHECK (is_correct IN (0, 1)),
    elapsed_ms INTEGER CHECK (elapsed_ms IS NULL OR elapsed_ms >= 0),
    metadata_json TEXT NOT NULL DEFAULT '{}'
  );

  CREATE INDEX IF NOT EXISTS qe_attempts_question_time_idx ON qe_question_attempts(question_id, answered_at);

  CREATE TABLE IF NOT EXISTS qe_knowledge_sources (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    original_uri TEXT NOT NULL,
    stored_uri TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
    content_hash TEXT NOT NULL,
    page_count INTEGER NOT NULL CHECK (page_count >= 0),
    extraction_status TEXT NOT NULL CHECK (extraction_status IN ('complete', 'partial', 'ocr-needed', 'failed')),
    imported_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}'
  );

  CREATE INDEX IF NOT EXISTS qe_knowledge_source_hash_idx ON qe_knowledge_sources(content_hash);

  CREATE TABLE IF NOT EXISTS qe_knowledge_pages (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES qe_knowledge_sources(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL CHECK (page_number > 0),
    semantic_type TEXT NOT NULL DEFAULT 'unknown',
    title TEXT,
    text_content TEXT NOT NULL DEFAULT '',
    extraction_status TEXT NOT NULL CHECK (extraction_status IN ('text', 'ocr-needed', 'empty')),
    structure_json TEXT NOT NULL DEFAULT '[]',
    analysis_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL,
    UNIQUE(source_id, page_number)
  );

  CREATE INDEX IF NOT EXISTS qe_knowledge_pages_source_idx ON qe_knowledge_pages(source_id, page_number);

  CREATE VIRTUAL TABLE IF NOT EXISTS qe_knowledge_pages_fts USING fts5(
    page_id UNINDEXED,
    source_id UNINDEXED,
    page_number UNINDEXED,
    title,
    text_content
  );

  CREATE TABLE IF NOT EXISTS qe_vector_records (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES qe_knowledge_sources(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL CHECK (page_number > 0),
    chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
    model TEXT NOT NULL,
    dimensions INTEGER NOT NULL CHECK (dimensions > 0),
    vector_json TEXT NOT NULL,
    text_content TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(source_id, page_number, chunk_index, model)
  );

  CREATE INDEX IF NOT EXISTS qe_vector_records_source_idx ON qe_vector_records(source_id, page_number);

  CREATE TABLE IF NOT EXISTS qe_conversation_entries (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
    content TEXT NOT NULL,
    provider TEXT,
    created_at TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}'
  );

  CREATE INDEX IF NOT EXISTS qe_conversation_recent_idx ON qe_conversation_entries(conversation_id, created_at);
  CREATE VIRTUAL TABLE IF NOT EXISTS qe_conversation_entries_fts USING fts5(
    entry_id UNINDEXED,
    conversation_id UNINDEXED,
    content
  );

  CREATE TABLE IF NOT EXISTS qe_long_term_memories (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    source_entry_id TEXT NOT NULL,
    provider TEXT,
    confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(content, conversation_id)
  );

  CREATE INDEX IF NOT EXISTS qe_long_term_memories_updated_idx ON qe_long_term_memories(updated_at);

  CREATE VIRTUAL TABLE IF NOT EXISTS qe_questions_fts USING fts5(
    question_id UNINDEXED,
    title,
    body_text,
    tags_text
  );
`;

export function initializeQuestionEngineSchema(db: SqliteSchemaDriver, now = new Date().toISOString()): void {
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(MIGRATION_TABLE);
  const current = db.prepare("SELECT MAX(version) AS version FROM qe_schema_migrations").get() as
    | { version?: number | null }
    | undefined;
  const version = Number(current?.version ?? 0);
  if (version > QUESTION_ENGINE_SCHEMA_VERSION) {
    throw new Error(`Question Engine DB schema version ${version} is newer than this application supports (${QUESTION_ENGINE_SCHEMA_VERSION})`);
  }
  if (version === QUESTION_ENGINE_SCHEMA_VERSION) return;

  const apply = () => {
    db.exec(CORE_SCHEMA);
    db.prepare("INSERT INTO qe_schema_migrations(version, applied_at) VALUES (?, ?)").run(
      QUESTION_ENGINE_SCHEMA_VERSION,
      now,
    );
  };
  if (db.transaction) db.transaction(apply)();
  else apply();
}
