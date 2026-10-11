# Vector Store Separation

Status: the initial separate-file SQLite vector store and legacy-row importer are implemented in this branch; runtime tests and CI verification are pending. LanceDB remains a candidate and has not been added.

## Decision

Keep SQLite as the authoritative relational database and move embedding vectors plus vector-search operations into a separate local vector store behind an application-owned provider interface.

- SQLite remains the source of truth for source documents, pages, questions, attempts, conversations, and the mapping between a source/chunk and its vector record.
- The vector store owns embeddings, vector-search indexes, and vector-search execution.
- Workspace selection does not choose a database. All workspaces use the same application-level stores.
- Electron main is the only process that opens either store. Renderer, Web AI, CLI integrations, and MCP tools use validated application APIs rather than direct database access.
- A vector-store failure must not corrupt or silently reset SQLite data.

## Library candidate

Use LanceDB's embedded JavaScript/TypeScript SDK as the first integration candidate (@lancedb/lancedb), pinned to a stable version after compatibility checks. It supports a local filesystem URI and provides vector-search APIs. Its Node SDK ships platform-specific native binaries, so supported OS/CPU targets and Electron packaging must be verified before calling the integration complete.

Official references:
- SDK and platform support: https://lancedb.github.io/lancedb/js/
- Local connection API: https://lancedb.github.io/lancedb/js/functions/connect/
- Project and license: https://github.com/lancedb/lancedb

Do not introduce a cloud service or require a separately managed server for the initial local-first implementation.

## Storage layout

Keep the existing shared SQLite database at the application data directory. Store LanceDB in a sibling directory, for example:

- data/knowledge-db/sigma-studio.sqlite
- data/knowledge-db/vector-index.sqlite (initial isolated SQLite-backed vector store; replaceable behind the vector-store boundary)

The exact paths must be resolved from the existing Electron user-data path and covered by tests. They must not depend on the current workspace or process working directory.

## Vector record contract

Each vector record must include at least:
- stable id
- sourceId
- pageNumber
- zero-based chunkIndex
- embedding model identifier and dimensions
- chunk text or a durable reference to its canonical text
- content hash / indexing revision, if needed to detect stale embeddings

The canonical source/page metadata remains in SQLite. Use stable identifiers to join search results back to SQLite and construct page-accurate citations. Do not treat a vector-store record as the authoritative source of document metadata.

## Consistency and recovery

SQLite and LanceDB cannot participate in one shared transaction. Implement an explicit lifecycle:
1. Commit source/page metadata and a pending indexing state in SQLite.
2. Compute embeddings and upsert vector records.
3. Verify the expected vector IDs and model/dimension metadata.
4. Mark indexing complete in SQLite only after vector writes succeed.
5. On failure, preserve source data, record the error, and allow idempotent retry.
6. On source deletion, mark deletion pending first, remove vector records, then finalize relational deletion; retries must safely finish incomplete operations.
7. Provide a rebuild operation that recreates the vector store from canonical SQLite/document data without deleting the relational database.

The implementation must not silently report a successful index when vector writes failed. Backup/restore must include both stores and a manifest containing schema/model versions. Restore must validate the pair and support rebuilding the vector store if it is missing or incompatible.

## Migration from the current same-database vector table

Before this change, apps/desktop/electron/local-vector-index.ts read and wrote qe_vector_records in the shared SQLite connection, storing vectors as JSON and scanning rows for cosine similarity. The branch now opens a separate vector-index.sqlite file, writes new vectors there, and performs a one-time idempotent copy of legacy rows from the relational database. The old table remains for rollback; LanceDB/native package integration and indexed ANN search are not yet implemented.

Migration requirements:
- Add a versioned SQLite migration that stops using the legacy vector table for new writes. Do not drop the table until a tested export/import path and rollback strategy exist.
- Provide an idempotent one-time exporter/importer from qe_vector_records into LanceDB.
- Verify vector counts, IDs, model names, dimensions, and sample search results before marking migration complete.
- Because the user has explicitly authorized discarding old local DB data, data preservation is not a product requirement for a clean rebuild; nevertheless, migration tooling should be non-destructive by default during development and tests.
- Never delete application data directories automatically as part of startup.

## Required tests before merge

- Unit tests for stable IDs, dimensions, upsert/update/delete idempotency, empty query, bounded result count, and stale model versions.
- Failure-injection tests for vector writes failing after SQLite metadata commits, and retry/rebuild recovery.
- Integration tests for SQLite + LanceDB lifecycle, source deletion, reindexing, and restore.
- Search quality checks using Japanese text, mixed Japanese/English technical terms, identifiers/error codes, and PDF page/chunk citations.
- Electron packaging checks for Windows x64, macOS x64/arm64, and supported Linux architectures. A package install alone is not sufficient evidence that the native binding loads in packaged Electron.
- Full existing test suite, typecheck, lint, desktop build, Electron build, and CI.

## Rollout gates

Do not remove the old vector implementation or its table until:
1. the new provider passes the tests above;
2. packaged Electron smoke tests load the native SDK on supported platforms;
3. indexing/search/backup/restore regressions are checked;
4. CI results are confirmed.

## Current verification status

The branch now contains the initial separate-file implementation and a migration test, but this session has not run the test suite, typecheck, lint, desktop build, or packaged Electron smoke tests. LanceDB is not installed and no performance improvement from approximate-nearest-neighbor indexing is claimed.
