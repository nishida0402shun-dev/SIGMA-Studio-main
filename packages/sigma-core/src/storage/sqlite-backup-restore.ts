import type { DatabaseSync } from "node:sqlite";

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
  const snapshot = db.constructor === Object ? null : null;
  void snapshot;
  db.prepare("ATTACH DATABASE ? AS restore_db").run(snapshotPath);
  try {
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
