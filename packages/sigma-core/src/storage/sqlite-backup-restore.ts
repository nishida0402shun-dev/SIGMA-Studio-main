import type { DatabaseSync } from "node:sqlite";
import { SIGMA_CORE_SCHEMA_VERSION } from "./sqlite-schema.js";

/** Checkpoints the WAL before a database file is copied into an archive. */
export function checkpointSigmaCoreDatabase(db: DatabaseSync): void {
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
}

/**
 * Restores a SQLite snapshot into the already-open SIGMA Core connection.
 * The live database file is not replaced, so existing connection handles remain valid.
 */
export function restoreSigmaCoreSnapshot(db: DatabaseSync, snapshotPath: string): void {
  checkpointSigmaCoreDatabase(db);
  db.prepare("ATTACH DATABASE ? AS restore_db").run(snapshotPath);
  try {
    const migration = db.prepare(
      "SELECT MAX(version) AS version FROM restore_db.sigma_core_schema_migrations",
    ).get() as { version?: number | null } | undefined;
    if (Number(migration?.version ?? 0) !== SIGMA_CORE_SCHEMA_VERSION) {
      throw new Error("Invalid SIGMA Core snapshot: unsupported schema version");
    }
    const tables = db.prepare(`
      SELECT name FROM restore_db.sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%'
      ORDER BY name
    `).all() as Array<{ name: string }>;
    const quote = (identifier: string) => '"' + identifier.replace(/"/gu, '""') + '"';

    db.exec("PRAGMA foreign_keys = OFF");
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const table of [...tables].reverse()) {
        db.exec(`DELETE FROM main.${quote(table.name)}`);
      }
      for (const table of tables) {
        const columns = db.prepare(`PRAGMA restore_db.table_info(${quote(table.name)})`).all() as Array<{ name: string }>;
        const names = columns.map((column) => quote(column.name)).join(", ");
        if (!names) continue;
        db.exec(`INSERT INTO main.${quote(table.name)} (${names}) SELECT ${names} FROM restore_db.${quote(table.name)}`);
      }
      db.exec("DELETE FROM main.sigma_core_questions_fts");
      db.exec(`
        INSERT INTO main.sigma_core_questions_fts(question_id, title, body_text, tags_text)
        SELECT q.id, q.title, c.body_json,
          COALESCE((
            SELECT group_concat(t.label, ' ')
            FROM main.sigma_core_question_tags qt
            JOIN main.sigma_core_tags t ON t.id = qt.tag_id
            WHERE qt.question_id = q.id
          ), '')
        FROM main.sigma_core_questions q
        JOIN main.sigma_core_question_contents c ON c.question_id = q.id
      `);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    } finally {
      db.exec("PRAGMA foreign_keys = ON");
    }
    const violations = db.prepare("PRAGMA foreign_key_check").all();
    if (violations.length) throw new Error("Invalid SIGMA Core snapshot: foreign key integrity check failed");
  } finally {
    db.exec("DETACH DATABASE restore_db");
  }
}
