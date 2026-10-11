# SIGMA Core architecture and integration status

Status: **foundation implemented; production readiness not yet verified**. This document distinguishes committed code from checks that still need evidence.

## Objective and invariants

SIGMA Core is the shared owner of contracts and persistence for knowledge, retrieval, memory, questions, and learning. It must not inherit the old Question Engine SQLite implementation as its long-term storage layer.

- One shared database across workspaces; workspace selection remains explicit.
- Electron handles OS integration, file selection, document extraction, and archive I/O. Core owns table-specific persistence.
- Relational records are authoritative; FTS and vector indexes are derived and rebuildable.
- Retrieval preserves source/page/chunk provenance.
- CLI AI, Web AI, MCP, and Skills should use shared contracts, but discovery does not grant execution permission.
- Legacy local database data is not migrated. The user explicitly authorized local DB data loss for this rebuild.
- No claim of completion is valid until current CI passes and remaining persistence boundaries are audited.

## Current package boundaries

| Area | Current implementation |
|---|---|
| Shared DB lifecycle | `packages/sigma-core/src/storage/sqlite-database.ts` opens `sigma-core.sqlite`, enables foreign keys/WAL, and initializes the schema. |
| Schema and migration | `packages/sigma-core/src/storage/sqlite-schema.ts`; SIGMA Core-owned `sigma_core_*` tables and migration versioning. The initializer retires `qe_*` tables without migrating their rows. |
| Knowledge records | `sqlite-knowledge-library-repository.ts` owns source/page reads and writes. Electron retains extraction, analysis, classification, ranking, and UI-facing mapping. |
| PDF import review | `sqlite-knowledge-import-repository.ts` owns draft/segment persistence; Electron retains PDF processing and review orchestration. |
| Vector persistence | `sqlite-vector-index.ts` owns vector records. The embedding model and Electron-facing adapter remain in `apps/desktop/electron/local-vector-index.ts`. |
| Learning feedback | `sqlite-knowledge-learning-store.ts`; Electron and tests import Core directly. The compatibility re-export has been deleted. |
| Conversation memory | `sqlite-conversation-memory-store.ts`. |
| Long-term memory | `sqlite-long-term-memory-store.ts`. |
| Question persistence | `sqlite-question-repository.ts`; it uses domain types/contracts in `packages/question-engine/src/`. The Question Engine package no longer owns SQLite storage. |
| Research sessions | `sqlite-research-session-store.ts`; Electron imports Core directly. The compatibility re-export has been deleted. |
| Retrieval algorithms | `retrieval/hybrid-retriever.ts`, `knowledge/chunker.ts`, and `knowledge/document-indexer.ts` provide reusable Core logic/contracts. |

## Legacy retirement

Removed from the working branch:
- `packages/question-engine/src/storage/` and its SQLite persistence modules.
- The disconnected standalone Question Bank package from the previous rebuild work.
- Electron's direct SQL for PDF staging (now routed through `SqliteKnowledgeImportRepository`).
- Electron compatibility re-export modules for learning feedback and research sessions; all known callers now import SIGMA Core directly.

The Electron startup path attempts to remove `sigma-studio.sqlite` and its `-wal`/`-shm` sidecars before opening `sigma-core.sqlite`. This is committed code; it does not prove those files have been deleted on any particular user's machine.

The archive backup/restore orchestration still lives in `apps/desktop/electron/knowledge-db-store.ts`, including generic SQL table restoration and source-path relocation. It now expects `sigma-core.sqlite`. This is an identified boundary to review, not a claim that all database-related code has already moved into Core.

## Verification evidence

CI run `38115382853` passed the isolated SIGMA Core typecheck and 17 Core tests, but the overall desktop job failed at typecheck because some call sites still imported removed Question Engine SQLite exports. Those call sites were updated afterward. The latest branch CI must be inspected again before the foundation can be marked green.

## Remaining acceptance criteria

1. Current CI passes desktop and Core typecheck, lint, tests, production build, Electron packaging/smoke test, and cross-platform file-locking checks.
2. A migration test proves `qe_*` tables are dropped and only the new Core schema is used.
3. Backup/restore round-trip passes with `sigma-core.sqlite`, validates foreign keys, and relocates stored source paths correctly.
4. A complete tracked-source scan finds no active use of removed Question Engine SQLite exports or stale database filenames outside intentional legacy cleanup.
5. The new schema receives an explicit data-model review; changing table prefixes alone is not sufficient evidence of a ground-up redesign.
6. Existing UI, Skills, MCP, and other non-database features pass regression checks before merge.

The draft PR remains unmerged until the checks above are supported by evidence.
