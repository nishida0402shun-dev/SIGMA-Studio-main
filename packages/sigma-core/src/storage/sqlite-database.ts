import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { initializeSigmaCoreSchema, type SqliteSchemaDriver } from "./sqlite-schema.js";

interface PreparedStatement {
  get(...parameters: unknown[]): unknown;
  run(...parameters: unknown[]): unknown;
}

class SchemaConnection implements SqliteSchemaDriver {
  constructor(private readonly connection: DatabaseSync) {}

  exec(sql: string): void {
    this.connection.exec(sql);
  }

  prepare(sql: string): PreparedStatement {
    const statement = this.connection.prepare(sql);
    return {
      get: (...parameters) => statement.get(...(parameters as SQLInputValue[])),
      run: (...parameters) => statement.run(...(parameters as SQLInputValue[])),
    };
  }

  transaction<T extends (...args: never[]) => unknown>(callback: T): T {
    const wrapped = (() => {
      this.connection.exec("BEGIN IMMEDIATE");
      try {
        const result = callback();
        this.connection.exec("COMMIT");
        return result;
      } catch (error) {
        try {
          this.connection.exec("ROLLBACK");
        } catch {
          // Preserve the migration error if rollback itself also fails.
        }
        throw error;
      }
    }) as T;
    return wrapped;
  }
}

export interface SigmaCoreDatabase {
  readonly raw: DatabaseSync;
  close(): void;
}

export interface OpenSigmaCoreDatabaseOptions {
  /** One application-owned directory shared by every workspace. */
  dataDir: string;
  /** A filename override is intended for isolated tests and diagnostics. */
  filename?: string;
}

const DEFAULT_DATABASE_FILENAME = "sigma-core.sqlite";

export function openSigmaCoreDatabase(options: OpenSigmaCoreDatabaseOptions): SigmaCoreDatabase {
  if (!options.dataDir.trim()) throw new Error("SIGMA Core data directory is required");

  const directory = path.resolve(options.dataDir);
  const filename = options.filename ?? DEFAULT_DATABASE_FILENAME;
  if (!filename.trim() || path.basename(filename) !== filename || filename === "." || filename === "..") {
    throw new Error("SIGMA Core database filename must be a simple filename");
  }

  mkdirSync(directory, { recursive: true });
  const connection = new DatabaseSync(path.join(directory, filename));

  try {
    connection.exec("PRAGMA foreign_keys = ON");
    connection.exec("PRAGMA journal_mode = WAL");
    connection.exec("PRAGMA synchronous = NORMAL");
    connection.exec("PRAGMA busy_timeout = 5000");
    initializeSigmaCoreSchema(new SchemaConnection(connection));
  } catch (initializationError) {
    try {
      connection.close();
    } catch {
      // Keep the initialization failure as the primary error.
    }
    throw initializationError;
  }

  let closed = false;
  return {
    raw: connection,
    close() {
      if (closed) return;
      connection.close();
      closed = true;
    },
  };
}
