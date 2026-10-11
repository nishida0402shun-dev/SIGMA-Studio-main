# SIGMA Core architecture and integration status

Status: **Core foundation implemented; CI passed at code commit `043c9bbe2301d2ee2c6b50d17e978a5abec4a630`.** Existing user installations and local-file cleanup are not independently verified.

## Objective and invariants

SIGMA Core is the shared owner of contracts and persistence for knowledge, retrieval, memory, questions, and learning. It must not inherit the old Question Engine SQLite implementation as its long-term storage layer.

- One shared database across workspaces; workspace selection remains explicit.
- Electron handles OS integration, file selection, document extraction, and archive I/O. Core owns table-specific persistence.
- Relational records are authoritative; FTS and vector indexes are derived and rebuildable.
- Retrieval preserves source/page/chunk provenance.
- CLI AI, Web AI, MCP, and Skills should use shared contracts, but discovery does not grant execution permission.
- Legacy local database data is not migrated. The user explicitly authorized local DB data loss for this rebuild.
- CI verification is recorded below. Final completion still requires review of remaining persistence boundaries and confirmation of intended runtime cleanup behavior.

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

[GitHub Actions run 38120761778](https://github.com/nishida0402shun-dev/SIGMA-Studio-main/actions/runs/38120761778) passed at code commit `043c9bbe2301d2ee2c6b50d17e978a5abec4a630`.

Verified in that run:
- SIGMA Core typecheck and tests.
- Desktop typecheck, lint, and test suite.
- Production renderer build, Electron build, and Electron smoke test.
- Public package build/contracts.
- File-locking checks on Ubuntu, macOS, and Windows.

This verifies the tested commit; it does not prove old files have already been deleted from every user's machine.

## Remaining acceptance criteria

1. **Passed at code commit `043c9bbe`** in CI run 38120761778: Core/Desktop typecheck, lint, tests, production build, Electron packaging/smoke test, and cross-platform file-locking checks.
2. **Implemented and tested:** migration tests verify `qe_*` retirement, reset of the pre-v8 prototype schema, and creation of the normalized Core model.
3. **Implemented and tested:** backup/restore round-trip validates foreign keys, relocates stored source paths, and rebuilds the derived question FTS index.
4. The tracked tree has no standalone Question Bank package, Question Engine storage directory, or deleted Electron compatibility modules. CI typecheck confirms no unresolved imports; continue auditing direct persistence boundaries during review.
5. The schema now separates question content/answers, conversation sequence/capture identity, long-term memory identity, research references, and learning ranking deltas. Review these model decisions before merging.
6. Desktop UI, Skills, MCP, and other regressions passed the current CI test/build/smoke gates.

The draft PR remains unmerged pending final review.
