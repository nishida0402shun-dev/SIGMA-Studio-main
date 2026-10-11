# SIGMA Question Engine

SIGMA Studio 専用の問題データ基盤を再構築するための新しいライブラリ境界です。

> Status: design and migration scaffold. This package is not wired into the desktop app yet.

## Goals

- Preserve existing SIGMA Studio behavior while replacing implicit database coupling with an explicit API.
- Support local-first storage, full-text search, source/page provenance, reviewable PDF ingestion, AI-assisted classification, worksheet generation, and exercise history.
- Keep AI providers, Electron IPC, MCP adapters, and storage behind separate interfaces.
- Make future synchronization optional; local use must not require a network service.

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

## Non-goals for the first milestone

- No immediate deletion or replacement of existing databases.
- No automatic migration of user data before schema inventory, backup, and migration tests.
- No network service or cloud account requirement.
- No treating AI-generated answers as source-verified answers.
- No direct renderer access to database handles or unrestricted filesystem paths.

## Migration rule

The existing question-bank package and any other SIGMA-specific databases remain intact while the new library is developed in parallel. Migration is allowed only after a database inventory, explicit mapping, backup/restore validation, and regression tests. The old path is removed only after the new path passes those checks.

## Initial acceptance criteria

1. Domain and application APIs can be tested without Electron.
2. SQLite schema changes are versioned and tested against a temporary database.
3. Search, CRUD, provenance, and transaction behavior have automated tests.
4. Import jobs support progress, cancellation/error state, and retry without duplicate registration.
5. Extracted/AI-proposed content requires an explicit review/approval path.
6. Electron integration goes through validated IPC and does not expose the DB handle to the renderer.
7. Existing application tests and build/CI results are checked before any migration or removal.

## Next steps

1. Inventory every database, connection factory, schema, migration, and consumer in the repository.
2. Compare the current question-bank schema and FTS implementation against the desired domain model.
3. Write a migration map and decide which existing tables can be reused.
4. Implement the minimal core/application/storage layers and tests.
5. Add PDF extraction and AI adapters only after the storage contracts are stable.
