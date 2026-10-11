import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openSigmaCoreDatabase } from "./sqlite-database.js";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("openSigmaCoreDatabase", () => {
  it("creates the Core database and retires legacy qe tables without importing their rows", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "sigma-core-schema-"));
    tempDirs.push(dir);
    const filename = path.join(dir, "sigma-core.sqlite");
    const legacy = new DatabaseSync(filename);
    legacy.exec(`
      CREATE TABLE sigma_core_schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO sigma_core_schema_migrations(version, applied_at) VALUES (6, '2026-01-01T00:00:00.000Z');
      CREATE TABLE qe_questions (id TEXT PRIMARY KEY, title TEXT NOT NULL);
      INSERT INTO qe_questions(id, title) VALUES ('legacy-question', 'must not be migrated');
      CREATE TABLE qe_schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE qe_vector_records (id TEXT PRIMARY KEY, vector_json TEXT NOT NULL);
    `);
    legacy.close();

    const database = openSigmaCoreDatabase({ dataDir: dir });
    try {
      const oldTables = database.raw.prepare(
        "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name LIKE 'qe_%' ORDER BY name",
      ).all() as Array<{ name: string }>;
      expect(oldTables).toEqual([]);
      const newTables = database.raw.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sigma_core_questions'",
      ).all();
      expect(newTables).toHaveLength(1);
      const migrations = database.raw.prepare(
        "SELECT version FROM sigma_core_schema_migrations ORDER BY version",
      ).all() as Array<{ version: number }>;
      expect(migrations.map((row) => row.version)).toEqual([6, 7]);
      expect(() => database.raw.prepare("SELECT * FROM qe_questions").all()).toThrow();
    } finally {
      database.close();
    }
  });

  it("rejects a database schema newer than the running Core package", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "sigma-core-newer-schema-"));
    tempDirs.push(dir);
    const filename = path.join(dir, "sigma-core.sqlite");
    const database = new DatabaseSync(filename);
    database.exec(`
      CREATE TABLE sigma_core_schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO sigma_core_schema_migrations(version, applied_at) VALUES (999, '2026-01-01T00:00:00.000Z');
    `);
    database.close();

    expect(() => openSigmaCoreDatabase({ dataDir: dir })).toThrow("newer than this application supports");
  });
});
