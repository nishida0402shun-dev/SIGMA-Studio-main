# SQLite retirement and SIGMA Core storage inventory

Last code verification: commit `043c9bbe2301d2ee2c6b50d17e978a5abec4a630`, [CI run 38120761778](https://github.com/nishida0402shun-dev/SIGMA-Studio-main/actions/runs/38120761778) passed. This inventory describes tracked source files; cleanup of files on a particular user's machine is not independently verified.

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

- **Passed:** [CI run 38120761778](https://github.com/nishida0402shun-dev/SIGMA-Studio-main/actions/runs/38120761778) at code commit `043c9bbe2301d2ee2c6b50d17e978a5abec4a630` verified Core/Desktop typecheck, lint, tests, production build, Electron build/smoke test, public package checks, and file locking on Ubuntu, macOS, and Windows.
- The old standalone Question Bank package, Question Engine storage directory, and Electron learning/research compatibility modules are absent from the tracked tree. Desktop typecheck passed after all known imports were redirected to SIGMA Core.
- The schema is version 8. Question content and answers are separate records; conversation ordering/capture identity, long-term memory identity, research page references, and learning ranking deltas have dedicated fields or tables.
- Migration tests verify the pre-v8 prototype tables are reset without importing rows. Backup/restore tests verify source-path restoration and rebuilding of the question FTS index.
- Passing CI does not prove that old files have been deleted from every user's machine. Electron startup attempts to remove the retired `sigma-studio.sqlite` database and its WAL/SHM sidecars.

## Remaining acceptance checks

1. **Passed at code commit `043c9bbe`** in CI run 38120761778; rerun CI after any subsequent source changes.
2. **Implemented and tested:** migration tests prove legacy `qe_*` tables are dropped and the normalized schema is created.
3. **Implemented and tested:** backup/restore round-trip checks foreign-key integrity, stored source paths, and question search-index rebuild.
4. The deleted legacy module paths are absent and typecheck passes. Continue reviewing direct persistence SQL boundaries so table-specific persistence remains in Core repositories.
5. Keep this branch unmerged until final design review and acceptance of the remaining persistence boundaries.
