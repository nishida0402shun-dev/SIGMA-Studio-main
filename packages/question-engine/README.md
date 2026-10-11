# SIGMA Question Engine

SIGMA Studio 専用の問題・知識・会話データ基盤を再構築するための新しいライブラリ境界です。

> Status: initial rebuild scaffold. The new schema is not wired into the desktop app, and migration tests have not yet been run.

## Goals

- Replace legacy persistence implementations with a versioned local-first SQLite storage layer behind explicit APIs.
- Support questions, knowledge documents/pages, vector records, conversation history, long-term memory, provenance, reviewable PDF ingestion, and exercise history.
- Keep AI providers, Electron IPC, MCP adapters, and storage behind separate interfaces.
- Keep all local data operations offline-capable.
- Keep Electron and filesystem access out of the domain layer.

## Current rebuild state

- The disconnected legacy Question Bank package was removed from this branch.
- A provider-neutral domain model, application ports, and initial SQLite schema have been added.
- The schema currently covers question records, sources, tags, import proposals, knowledge pages, vector records, conversation entries, and long-term memories.
- Existing integrated Knowledge DB and memory stores still have live application references. They are **not yet removed or replaced**; the new adapter layer must be implemented and verified before those code paths can be retired.
- No data files are deleted by this code change. Runtime data removal is a separate operation and is not part of this branch.

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

The old integrated stores are marked for retirement, but their application call sites must be migrated to the new API before deleting the old modules. Existing runtime data files are left untouched until explicit migration, backup/restore validation, and regression tests pass.

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

1. Implement and test the storage adapter and FTS synchronization.
2. Inventory all live consumers of Knowledge DB, vector index, conversation memory, and long-term memory.
3. Move those consumers behind the new library API.
4. Add a tested one-time data migration/backup flow.
5. Remove the remaining old store modules only after the app builds and regression tests pass.
