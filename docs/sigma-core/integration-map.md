# SIGMA Core integration map

Audit ref: branch `feat/sigma-core-foundation`, commit `7ecae3bde7607f565d5bd86bc6774e9e175e741b`. This is a tracked-source audit. It does not prove cleanup on an end user's machine.

| Area | Current location | Current boundary |
|---|---|---|
| Question domain and application contracts | `packages/question-engine/src/core`, `application/contracts.ts` | Domain types/contracts remain; the old Question Engine SQLite storage layer is removed. Core's question repository consumes these types. |
| Shared database and schema | `packages/sigma-core/src/storage/sqlite-database.ts`, `sqlite-schema.ts` | SIGMA Core opens `sigma-core.sqlite` and owns schema initialization. Legacy `qe_*` tables are dropped without row migration. |
| Knowledge source/page metadata | `sqlite-knowledge-library-repository.ts` | Core owns relational reads/writes; Electron retains extraction, classification, ranking, and UI orchestration. |
| PDF import staging | `sqlite-knowledge-import-repository.ts` | Core owns staging-record persistence; Electron retains PDF processing and approval workflow. |
| Embeddings/vector index | `sqlite-vector-index.ts`, `apps/desktop/electron/local-vector-index.ts` | Core owns vector persistence; the Electron adapter retains embedding-model initialization and query embedding. |
| Learning feedback | `sqlite-knowledge-learning-store.ts` | Persistence is in Core; the Electron compatibility re-export has been removed. |
| Conversation history | `sqlite-conversation-memory-store.ts` | Shared SQLite persistence and search; the old file-backed implementation is removed. |
| Long-term memory | `sqlite-long-term-memory-store.ts` | Shared SQLite persistence, separate from raw conversation history. |
| Research sessions | `sqlite-research-session-store.ts` | Persistence is in Core; the Electron compatibility re-export has been removed. |
| Backup/restore | `apps/desktop/electron/knowledge-db-store.ts`, Core snapshot helpers | Electron owns archive and source-file operations; Core owns database snapshot/restore primitives and relational repositories. Review remaining raw-SQL responsibilities before claiming all persistence code is centralized. |
| Web AI runtime | `apps/desktop/electron/web-ai-agent-runtime.ts` | Existing runtime remains; shared Core integration is a separate workstream. |
| MCP and local MCP server | `apps/desktop/electron/web-ai-mcp-gateway.ts`, `apps/desktop/mcp/` | Existing tool schemas and approval boundaries must be preserved during integration. |
| CLI providers | `claude-mcp-config.ts`, `codex-mcp-config.ts`, related runtime modules | Provider-specific runtime remains; common run contracts are future work. |
| Built-in Skills | `apps/desktop/electron/official-skills/` | Existing Skill format remains and must be regression-tested. |
| Browser persistence | `apps/desktop/src/lib/runtime/browser/` | Separate browser-runtime IndexedDB layer; it is not the desktop SQLite database and should not be deleted without auditing browser consumers. |
| StudyAid / question UI | Existing app consumers and Question Engine domain | Question workflows need separate behavioral regression verification. |

## Confirmed source removals

- `packages/question-engine/src/storage/` is absent.
- The disconnected `packages/sigma_studio_question_bank_package/` is absent.
- Electron's old conversation-memory and long-term-memory file-backed modules are absent; tests exercise the Core SQLite stores.
- Electron compatibility re-export modules for learning feedback and research sessions are absent; known callers import Core directly.
- The Electron KnowledgeDbStore delegates relational source/page persistence and PDF staging persistence to Core repositories.
- Electron backup restore expects `sigma-core.sqlite`, not the retired `sigma-studio.sqlite` filename.
- Startup removes `sigma-studio.sqlite` and its `-wal` / `-shm` sidecars before opening the shared Core database.

These facts describe code in the repository, not files on a particular user's machine. Startup cleanup is implemented but cannot establish that every user's old files have already been removed.

## Verification evidence

GitHub Actions run [38116655664](https://github.com/nishida0402shun-dev/SIGMA-Studio-main/actions/runs/38116655664) passed for commit `109b63aff2201a99a4f9227b64b30c493762d846`. The run completed Core/Desktop typecheck, lint, Desktop tests, production build, Electron build, and Electron smoke test. This run predates the current branch tip `7ecae3bde7607f565d5bd86bc6774e9e175e741b`; re-check CI for the tip before treating it as verified.

## Remaining audit / acceptance criteria

1. Inspect `KnowledgeDbStore` for remaining direct SQL, especially import/delete and backup/restore paths, and move table-specific persistence into Core repositories where appropriate.
2. Confirm no legacy JSON/file-backed persistence implementations remain for data now owned by Core; retain unrelated document/settings stores.
3. Test database initialization and retirement of `qe_*` tables, source/page CRUD, vectors, conversation memory, long-term memory, research sessions, and learning feedback.
4. Test backup/restore round-trip, foreign-key integrity, source-file relocation, and derived-index rebuild.
5. Run typecheck, lint, focused tests, full Desktop/Core tests, production build, Electron packaging/smoke test, and cross-platform file-locking checks on the latest commit.
6. Keep the draft PR unmerged until these checks pass and the remaining raw-SQL audit is complete.

## Important distinction

SIGMA Core now owns the shared SQLite schema and most domain persistence, but Electron still owns file extraction, embedding-model runtime, UI orchestration, and archive/filesystem workflows. Removing the old database implementation must not delete those still-required product capabilities.
