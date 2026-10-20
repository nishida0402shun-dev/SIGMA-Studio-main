#!/usr/bin/env node
/* eslint @typescript-eslint/no-require-imports: "off" -- This smoke script intentionally runs as CommonJS inside Electron. */
"use strict";

// Run with ELECTRON_RUN_AS_NODE=1 using the exact Electron version from the
// committed lockfile. This checks the Electron-bundled Node/SQLite runtime,
// not SIGMA Core's adapter or any packaged application artifact.

const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const directory = mkdtempSync(join(tmpdir(), "sigma-electron-sqlite-"));
const databasePath = join(directory, "runtime-smoke.sqlite");
let db;

try {
  db = new DatabaseSync(databasePath);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("CREATE TABLE smoke_probe (id INTEGER PRIMARY KEY, content TEXT NOT NULL)");
  db.exec("CREATE VIRTUAL TABLE search_probe USING fts5(content)");

  const insert = db.prepare("INSERT INTO smoke_probe (content) VALUES (?)");
  insert.run("before-rollback");

  db.exec("BEGIN");
  insert.run("must-rollback");
  db.exec("ROLLBACK");

  const rows = db.prepare("SELECT content FROM smoke_probe ORDER BY id").all();
  assert.deepEqual(rows.map((row) => row.content), ["before-rollback"]);

  db.prepare("INSERT INTO search_probe (content) VALUES (?)").run("SIGMA Studio SQLite smoke test");
  const matches = db.prepare("SELECT content FROM search_probe WHERE search_probe MATCH ?").all("SIGMA");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].content, "SIGMA Studio SQLite smoke test");

  const sqliteVersion = db.prepare("SELECT sqlite_version() AS version").get().version;
  console.log(JSON.stringify({
    status: "passed",
    electron: process.versions.electron ?? null,
    node: process.versions.node,
    sqlite: sqliteVersion,
    fts5: "passed",
    transactionRollback: "passed",
    databasePath: "temporary file",
  }, null, 2));
} finally {
  if (db) db.close();
  rmSync(directory, { recursive: true, force: true });
}
