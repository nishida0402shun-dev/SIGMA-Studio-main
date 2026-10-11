# SIGMA Question Engine

SIGMA Studio 専用の問題・知識・会話データ基盤を再構築するための新しいライブラリ境界です。

> Status: partial SQLite cutover. Desktop knowledge metadata, vectors, conversation memory, long-term memory, research sessions, learning feedback, and PDF staging now use the shared database API. Build and test results have not yet been verified.

## Goals

- Replace legacy persistence implementations with a versioned local-first SQLite storage layer behind explicit APIs.
- Support questions, knowledge documents/pages, vector records, conversation history, long-term memory, provenance, reviewable PDF ingestion, and exercise history.
- Keep AI providers, Electron IPC, MCP adapters, and storage behind separate interfaces.
- Keep all local data operations offline-capable.
- Keep Electron and filesystem access out of the domain layer.

## Current rebuild state

- The disconnected legacy Question Bank package was removed from this branch.
- A provider-neutral domain model, application ports, and initial SQLite schema have been added.
- The schema currently covers question records, sources, tags, import proposals, knowledge pages, vector records, conversation entries, long-term memories, and research sessions.
- Electron now opens one shared SQLite database under `data/knowledge-db/sigma-studio.sqlite` and injects that connection into knowledge, vector, conversation-memory, long-term-memory, and research-session stores.
- The former JSON-backed conversation, long-term memory, research-session, learning-feedback, knowledge metadata, vector index, and PDF staging stores have been replaced by SQLite tables; source documents and derived page previews remain ordinary files. A transactional question repository now provides CRUD, optimistic version checks, tags, provenance, history, and filtered search.
- The `KnowledgeDbStore` API is retained to avoid rewriting its IPC/UI callers, but its persistence implementation now reads/writes the SQLite tables.
- Existing JSON data files are no longer read by the new stores. They are not automatically deleted from user directories by the code changes.

## Boundaries

- `core`: domain types and invariants; no Electron, filesystem, or database imports.
- `application`: use cases and service interfaces.
- `storage`: SQLite schema, migrations, repositories, and FTS indexes.
- `ingestion`: import jobs and extraction pipeline orchestration.
- `extraction`: PDF text/layout/OCR adapters; extracted content remains a proposal until reviewed.
- `ai`: provider-neutral interfaces for classification, generation, and verification.
- `review`: human review decisions and audit history.
- `worksheets` and `learning`: print composition and exercise/attempt history.
- `adapters/electron` and `adapters/mcp`: explicitly authorized integration surfaces.
- `sync`: optional future change-log synchronization; not required for initial local use.

## Migration rule

The application-facing `KnowledgeDbStore` and `LocalVectorIndex` names remain as compatibility façades, but persistence is SQLite-backed. Old JSON files are not imported. Database and PDF assets share the Knowledge DB directory so the backup path can include both.

## Acceptance criteria

1. Domain and application APIs can be tested without Electron.
2. SQLite schema changes are versioned and tested against a temporary database.
3. Search, CRUD, provenance, and transaction behavior have automated tests.
4. Import jobs support progress, cancellation/error state, and retry without duplicate registration.
5. Extracted/AI-proposed content requires an explicit review/approval path.
6. Electron integration goes through validated IPC and does not expose the DB handle to the renderer.
7. Existing app tests and build/CI are checked before old modules are removed.
8. A test fixture copied from legacy stores can be migrated and queried without data loss.

## Next steps

1. Confirm the active CI run and fix any typecheck, test, lint, build, or packaging failures.
2. Add focused tests for schema upgrades, repository constraints, search edge cases, and backup/restore round trips.
3. Move remaining persistence consumers behind the shared library API where they are part of the unified data layer.
4. Verify packaging on each supported Electron target and document data reset behavior.
5. Remove remaining compatibility facades only after all call sites are migrated and regression checks pass.
