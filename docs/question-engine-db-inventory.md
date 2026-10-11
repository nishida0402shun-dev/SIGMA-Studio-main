# SQLite retirement and SIGMA Core storage inventory

Last checked: branch `feat/sigma-core-foundation`. This inventory describes tracked source files; runtime data deletion and full desktop verification require a passing CI run and an actual application launch.

## Legacy storage removed from the branch

| Legacy component | Current state |
|---|---|
| `packages/question-engine/src/storage/` SQLite implementation | Removed. The Question Engine package retains question-domain types and application contracts only. |
| Disconnected standalone Question Bank package | Removed from this branch; it is not used as the new storage implementation. |
| `qe_*` database tables | Retired by the SIGMA Core schema initializer on migration and on every startup, including databases already stamped with the current schema version. Existing rows are intentionally not migrated. |
| Previous `sigma-studio.sqlite` database and WAL/SHM sidecars | Electron startup now attempts to delete these files from the configured `knowledge-db` directory. This is code behavior, not evidence that a user's local files have already been deleted. |
| JSON-backed conversation, long-term memory, and research-session persistence | Replaced by SQLite stores in SIGMA Core for the migrated Electron flows. |

## Current storage ownership

| Area | Current owner | Notes |
|---|---|---|
| Shared DB opening and schema | `packages/sigma-core/src/storage/sqlite-database.ts`, `sqlite-schema.ts` | Opens `sigma-core.sqlite`; one shared database across workspaces. |
| Knowledge source/page records | `sqlite-knowledge-library-repository.ts` | Electron still owns extraction, classification, and user-facing orchestration. |
| PDF import staging | `sqlite-knowledge-import-repository.ts` | Added to SIGMA Core; Electron no longer issues staging-table SQL directly. |
| Vector records | `sqlite-vector-index.ts` | Embedding model and query orchestration remain in the Electron adapter; persistence belongs to Core. |
| Learning feedback | `sqlite-knowledge-learning-store.ts` | Electron imports Core directly; the compatibility re-export is deleted. |
| Conversation and long-term memory | `sqlite-conversation-memory-store.ts`, `sqlite-long-term-memory-store.ts` | Shared database, FTS-assisted search. |
| Question records | `sqlite-question-repository.ts` | Uses the question domain contracts/types; question-domain source remains under `packages/question-engine/src/`. |
| Research sessions | `sqlite-research-session-store.ts` | Electron imports Core directly; the compatibility re-export is deleted. |
| Backup/restore archive and file relocation | `apps/desktop/electron/knowledge-db-store.ts` | File/archive orchestration remains in Electron; it currently uses SQL for generic table restore and path relocation. Backup restore now expects `sigma-core.sqlite`. |
| Browser IndexedDB | `apps/desktop/src/lib/runtime/browser/` | Separate browser-runtime persistence, not part of the desktop SQLite retirement. |

## Verification status

- Core-only typecheck and tests passed in CI run `38115382853`, but the desktop typecheck failed because three remaining consumers still imported removed Question Engine SQLite exports.
- Those imports were corrected in subsequent commits. The latest CI result must be checked before treating the branch as verified.
- The Core schema is now namespaced and independent of the old `qe_*` tables, but a source review is still required before claiming the entire schema is a ground-up data-model redesign. Renaming tables alone is not proof of redesign.
- A passing CI run does not prove that the application has been launched locally or that a user's old files were deleted.

## Remaining acceptance checks

1. Verify current CI: Core and desktop typecheck, unit tests, lint, production build, Electron packaging/smoke test, and cross-platform file-locking jobs.
2. Add or confirm explicit migration tests that prove legacy `qe_*` tables are dropped and the new schema is created.
3. Verify backup/restore round-trip with `sigma-core.sqlite`, including foreign-key integrity and stored file paths.
4. Search the complete tracked tree for remaining direct persistence SQL outside Core. Keep file extraction and archive management in Electron, but route table-specific operations through Core repositories.
5. Keep this branch unmerged until these checks pass.
