# Question Engine migration inventory

Audit baseline: commit `7377554902141bba9335435394ed7bfeefbf3efe`; rebuild branch includes subsequent changes.

This is a source-code inventory, not a claim that runtime data locations or test results have been verified.

## Legacy implementations found at the audit baseline

| Area | Previous implementation | Format / role | Current status |
|---|---|---|---|
| Standalone Question Bank | `packages/sigma_studio_question_bank_package/packages/question-bank/src/db/` | SQLite via `better-sqlite3`; questions, taxonomy, FTS5, PDF staging | **Removed from this branch**. Its schema/repository should not be reused as the new storage implementation. |
| Knowledge DB | `apps/desktop/electron/knowledge-db-store.ts` | Extraction/classification/retrieval logic; source/page metadata | Metadata persistence now uses `qe_knowledge_sources` and `qe_knowledge_pages` in SQLite. Source files remain on disk. The façade is retained for existing IPC/UI callers. |
| Learning feedback | `apps/desktop/electron/knowledge-learning-store.ts` | JSON-backed search feedback and ranking boosts | Replaced by `qe_knowledge_learning_feedback` in the shared SQLite database. |
| Local vector index | `apps/desktop/electron/local-vector-index.ts` | Local embedding model and vector retrieval | Vector records now persist in `qe_vector_records` in the shared SQLite database. Embedding model logic remains in this adapter. |
| Conversation memory | `apps/desktop/electron/conversation-memory-store.ts` | JSON file-backed conversation entries and search | **Old module removed**. Electron IPC now uses `SqliteConversationMemoryStore`; FTS and LIKE-assisted search are implemented in the new adapter. |
| Long-term memory | `apps/desktop/electron/long-term-memory-store.ts` | JSON file-backed extracted memory entries | **Old module removed**. Electron IPC now uses `SqliteLongTermMemoryStore`. |
| Research sessions | `apps/desktop/electron/research-session-store.ts` | JSON file-backed research questions and page references | Persistence moved to `qe_research_sessions`; the Electron-facing class is a compatibility export over the shared SQLite store. Existing JSON files are not imported. |
| Browser runtime stores | `apps/desktop/src/lib/runtime/browser/idb-backend.ts`, `memory-backend.ts` | Browser persistence abstractions | Separate browser-runtime layer. Audit callers before deciding whether it should share the same storage API or remain an adapter. |

## Rebuild changes already made

- Created branch `feat/question-engine-rebuild`.
- Removed 25 tracked files belonging to the disconnected standalone Question Bank package.
- Added provider-neutral question domain types and application ports under `packages/question-engine/src/`.
- Added a versioned SQLite schema covering question records, sources, tags, import proposals, knowledge pages, vector records, conversation entries, long-term memories, and research sessions.
- The desktop main process opens one shared SQLite connection and injects it into knowledge, vector, conversation, long-term memory, and research-session stores.
- Existing JSON-backed research-session files are no longer read by the new store; the old data is not migrated.

## Correctness issues observed in the removed Question Bank implementation

- Its FTS5 virtual table declared external content `questions` with a `body_text` column, while the source table stored `body_json`; triggers also copied `body_json` into that FTS column. This needed explicit tests and was one reason not to reuse that implementation.
- The old package was not included in the root npm workspace list and was not wired through the inspected Electron main/preload files at the audit baseline.

## Safe retirement sequence for the still-integrated stores

1. Confirm CI after the latest type correction and SQLite research-session cutover.
2. Run focused tests for schema upgrades, question repository invariants, Japanese FTS/LIKE search, and research-session persistence.
3. Audit remaining Electron and browser persistence modules; keep browser IndexedDB as a separate runtime adapter unless the consumer graph supports consolidation.
4. Validate knowledge backup/restore, PDF source files, and derived preview paths against the SQLite database.
5. Run typecheck, focused tests, full test suite, build, Electron packaging, and CI; record exact results.
6. Remove compatibility facades only when all callers are migrated and checks pass.

## Unknowns

- Exact runtime data directories and whether users have production data in them.
- Full consumer graph for all legacy stores, including indirect calls and UI routes.
- Whether the new SQLite driver can be packaged correctly for every supported Electron target.
- Current build/test/CI results for the rebuild branch.
