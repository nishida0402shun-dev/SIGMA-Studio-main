# Question Engine migration inventory

Audit baseline: commit `7377554902141bba9335435394ed7bfeefbf3efe`; rebuild branch includes subsequent changes.

This is a source-code inventory, not a claim that runtime data locations or test results have been verified.

## Legacy implementations found at the audit baseline

| Area | Previous implementation | Format / role | Current status |
|---|---|---|---|
| Standalone Question Bank | `packages/sigma_studio_question_bank_package/packages/question-bank/src/db/` | SQLite via `better-sqlite3`; questions, taxonomy, FTS5, PDF staging | **Removed from this branch**. Its schema/repository should not be reused as the new storage implementation. |
| Knowledge DB | `apps/desktop/electron/knowledge-db-store.ts` | File-backed knowledge library with source/page metadata, extraction/classification and retrieval | Still present and referenced by Electron main/IPC/UI. Must be replaced behind the new library API before deletion. |
| Local vector index | `apps/desktop/electron/local-vector-index.ts` | Versioned file-backed vectors and local embedding model integration | Still present and coupled to Knowledge DB. New schema includes vector records, but adapter/model behavior is not migrated yet. |
| Conversation memory | `apps/desktop/electron/conversation-memory-store.ts` | JSON file-backed conversation entries and search | Still present and referenced by Electron IPC/preload. New schema includes conversation entries, but API consumers are not migrated yet. |
| Long-term memory | `apps/desktop/electron/long-term-memory-store.ts` | JSON file-backed extracted memory entries | Still present and referenced by Electron IPC/preload. New schema includes long-term memories, but API consumers are not migrated yet. |
| Browser runtime stores | `apps/desktop/src/lib/runtime/browser/idb-backend.ts`, `memory-backend.ts` | Browser persistence abstractions | Separate browser-runtime layer. Audit callers before deciding whether it should share the same storage API or remain an adapter. |

## Rebuild changes already made

- Created branch `feat/question-engine-rebuild`.
- Removed 25 tracked files belonging to the disconnected standalone Question Bank package.
- Added provider-neutral question domain types and application ports under `packages/question-engine/src/`.
- Added an initial versioned SQLite schema covering question records, sources, tags, import proposals, knowledge pages, vector records, conversation entries, and long-term memories.
- The new package is not yet wired into the desktop app. No build or test run has verified it.

## Correctness issues observed in the removed Question Bank implementation

- Its FTS5 virtual table declared external content `questions` with a `body_text` column, while the source table stored `body_json`; triggers also copied `body_json` into that FTS column. This needed explicit tests and was one reason not to reuse that implementation.
- The old package was not included in the root npm workspace list and was not wired through the inspected Electron main/preload files at the audit baseline.

## Safe retirement sequence for the still-integrated stores

1. Implement a SQLite adapter and automated temporary-database tests, including FTS index synchronization.
2. Migrate Knowledge DB and vector index APIs, preserving page extraction, indexing, retrieval, backup/restore, and recovery behavior.
3. Migrate conversation and long-term memory APIs, preserving search, deduplication, and retention semantics.
4. Update Electron IPC/preload and UI consumers to use the new library, with sender validation intact.
5. Verify a backup-and-restore plus round-trip migration using disposable copies of old data.
6. Run typecheck, focused tests, full test suite, build, and CI; record exact results.
7. Only then remove remaining legacy modules. This retires old code without silently discarding runtime user data.

## Unknowns

- Exact runtime data directories and whether users have production data in them.
- Full consumer graph for all legacy stores, including indirect calls and UI routes.
- Whether the new SQLite driver can be packaged correctly for every supported Electron target.
- Current build/test/CI results for the rebuild branch.
