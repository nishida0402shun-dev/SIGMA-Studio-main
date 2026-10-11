import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it } from "vitest";
import { KnowledgeDbStore, type KnowledgePage, type KnowledgeSource } from "./knowledge-db-store";
import { openQuestionEngineDatabase, type QuestionEngineDatabase } from "../../../packages/question-engine/src/index";
import { LocalVectorIndex } from "./local-vector-index";
import { KNOWLEDGE_ANALYSIS_VERSION } from "./knowledge-analysis-engine";
import { KNOWLEDGE_TAXONOMY_VERSION } from "./knowledge-taxonomy";

const tempDirs: string[] = [];
const databases: QuestionEngineDatabase[] = [];
const databasesByDir = new Map<string, QuestionEngineDatabase>();

function getDatabase(dataDir: string): QuestionEngineDatabase {
  const existing = databasesByDir.get(dataDir);
  if (existing) return existing;
  const database = openQuestionEngineDatabase({ dataDir: path.join(dataDir, "knowledge-db") });
  databases.push(database);
  databasesByDir.set(dataDir, database);
  return database;
}

function createStore(dataDir: string): KnowledgeDbStore {
  return new KnowledgeDbStore(dataDir, getDatabase(dataDir).raw);
}

function createVectorIndex(dataDir: string): LocalVectorIndex {
  return new LocalVectorIndex(getDatabase(dataDir).raw);
}

async function readLibraryFixture(dataDir: string): Promise<{ version: 3; sources: KnowledgeSource[]; __fingerprint?: string }> {
  const internal = createStore(dataDir) as unknown as {
    readLibrary: () => Promise<{ version: 3; sources: KnowledgeSource[]; __fingerprint?: string }>;
  };
  return internal.readLibrary();
}

function seedLibrary(dataDir: string, fixture: { sources: Array<Record<string, any>> }): void {
  const db = getDatabase(dataDir).raw;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec("DELETE FROM qe_knowledge_sources");
    const insertSource = db.prepare(`
      INSERT INTO qe_knowledge_sources
        (id, display_name, original_uri, stored_uri, mime_type, size_bytes, content_hash,
         page_count, extraction_status, imported_at, updated_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertPage = db.prepare(`
      INSERT INTO qe_knowledge_pages
        (id, source_id, page_number, semantic_type, title, text_content, extraction_status,
         structure_json, analysis_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const source of fixture.sources) {
      insertSource.run(source.id, source.name ?? source.display_name ?? source.id,
        source.originalPath ?? "", source.storedPath ?? "", source.mimeType ?? "text/plain",
        source.sizeBytes ?? 0, source.contentHash ?? "", source.pageCount ?? source.pages?.length ?? 0,
        source.extractionStatus ?? "complete", source.importedAt ?? new Date().toISOString(),
        source.updatedAt ?? new Date().toISOString(),
        JSON.stringify({ indexedAt: source.indexedAt, indexError: source.indexError }));
      for (const page of source.pages ?? []) {
        insertPage.run(page.id, source.id, page.pageNumber, page.semanticType ?? "unknown",
          page.title ?? null, page.text ?? "", page.extractionStatus ?? (page.text ? "text" : "empty"),
          JSON.stringify(page.structureBlocks ?? []), JSON.stringify(page), source.updatedAt ?? new Date().toISOString());
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

async function createPdf(filename: string, pages = 1): Promise<void> {
  const document = await PDFDocument.create();
  for (let index = 0; index < pages; index += 1) document.addPage([612, 792]);
  await fs.writeFile(path.join(os.tmpdir(), filename), await document.save());
}

async function createDataDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sigma-knowledge-db-"));
  tempDirs.push(dir);
  return dir;
}
