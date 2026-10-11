import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { initializeQuestionEngineSchema, type SqliteSchemaDriver } from "./sqlite-schema.js";

interface StatementLike {
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): unknown;
}

class NativeSqliteDriver implements SqliteSchemaDriver {
  constructor(private readonly database: DatabaseSync) {}

  exec(sql: string): void {
    this.database.exec(sql);
  }

  prepare(sql: string): StatementLike {
    const statement = this.database.prepare(sql);
    return {
      get: (...params) => statement.get(...(params as SQLInputValue[])),
      run: (...params) => statement.run(...(params as SQLInputValue[])),
    };
  }

  pragma(source: string): unknown {
    return this.database.prepare("PRAGMA " + source).all();
  }

  transaction<T extends (...args: never[]) => unknown>(operation: T): T {
    const wrapped = (() => {
      this.database.exec("BEGIN IMMEDIATE");
      try {
        const result = operation();
        this.database.exec("COMMIT");
        return result;
      } catch (error) {
        this.database.exec("ROLLBACK");
        throw error;
      }
    }) as T;
    return wrapped;
  }
}

export interface QuestionEngineDatabase {
  readonly raw: DatabaseSync;
  close(): void;
}

export interface OpenQuestionEngineDatabaseOptions {
  /** Application-owned data directory. The database is shared across workspaces. */
  dataDir: string;
  /** Override the database filename for tests or diagnostics. */
  filename?: string;
}

/**
 * Opens the shared Question Engine SQLite database and applies schema migrations.
 * This function never deletes existing files or silently resets a failed database.
 */
export function openQuestionEngineDatabase(
  options: OpenQuestionEngineDatabaseOptions,
): QuestionEngineDatabase {
  const dataDir = path.resolve(options.dataDir);
  mkdirSync(dataDir, { recursive: true });
  const filename = options.filename ?? "sigma-studio.sqlite";
  if (path.basename(filename) !== filename || filename === "." || filename === "..") {
    throw new Error("Question Engine database filename must be a simple filename");
  }

  const database = new DatabaseSync(path.join(dataDir, filename));
  try {
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("PRAGMA journal_mode = WAL");
    database.exec("PRAGMA busy_timeout = 5000");
    initializeQuestionEngineSchema(new NativeSqliteDriver(database));
  } catch (error) {
    database.close();
    throw error;
  }

  return {
    raw: database,
    close: () => database.close(),
  };
}
