# SIGMA Core integration map

Audit ref: current branch `feat/sigma-core-foundation`. This map records tracked-code boundaries, not a claim that runtime behavior or all tests are verified.

| Area | Current location | Current boundary |
|---|---|---|
| Question domain and application contracts | `packages/question-engine/src/core`, `application/contracts.ts` | Domain types/contracts remain; the package's old SQLite storage layer is removed. Core's question repository currently consumes these types. |
| Shared database and schema | `packages/sigma-core/src/storage/sqlite-database.ts`, `sqlite-schema.ts` | SIGMA Core opens `sigma-core.sqlite` and owns schema initialization. Legacy `qe_*` tables are dropped without row migration. |
| Knowledge source/page metadata | `sqlite-knowledge-library-repository.ts` | Core owns relational reads/writes; Electron retains document extraction, classification, ranking, and UI orchestration. |
| PDF import staging | `sqlite-knowledge-import-repository.ts` | Core owns staging-record persistence; Electron retains PDF processing and approval workflow. |
| Embeddings/vector index | `sqlite-vector-index.ts`, `apps/desktop/electron/local-vector-index.ts` | Core owns vector persistence; Electron adapter still owns embedding model initialization and query embedding. |
| Learning feedback | `sqlite-knowledge-learning-store.ts`, Electron compatibility export | Persistence is in Core. |
| Conversation history | `sqlite-conversation-memory-store.ts` | Shared SQLite persistence and search. |
| Long-term memory | `sqlite-long-term-memory-store.ts` | Shared SQLite persistence, distinct from raw conversation history. |
| Research sessions | `sqlite-research-session-store.ts`, Electron compatibility export | Persistence is in Core. |
| Backup/restore | `apps/desktop/electron/knowledge-db-store.ts` | Electron still owns archive/filesystem workflow and generic SQL restore; database-specific path updates use the Core repository. |
| Web AI runtime | `apps/desktop/electron/web-ai-agent-runtime.ts` | Existing runtime remains; Core integration is a separate workstream. |
| MCP and local MCP server | `apps/desktop/electron/web-ai-mcp-gateway.ts`, `apps/desktop/mcp/` | Existing tool schemas and approval boundaries must be preserved during future integration. |
| CLI providers | `claude-mcp-config.ts`, `codex-mcp-config.ts`, related runtime modules | Provider-specific runtime remains; common run contracts are future work. |
| Built-in Skills | `apps/desktop/electron/official-skills/` | Existing Skill format remains and must be regression-tested. |
| Browser persistence | `apps/desktop/src/lib/runtime/browser/` | Separate browser-runtime IndexedDB layer; not part of desktop SQLite deletion. |
| StudyAid / question UI | Existing app consumers and Question Engine domain | Question workflows require separate behavior and regression verification. |

## Confirmed code removals

- `packages/question-engine/src/storage/` is absent from the current branch.
- The disconnected standalone Question Bank package is absent.
- The Electron KnowledgeDbStore no longer directly reads/writes the PDF staging table.
- Electron backup restore expects `sigma-core.sqlite`, not the retired `sigma-studio.sqlite` filename.
- Electron startup attempts to delete the previous `sigma-studio.sqlite` file and its WAL/SHM sidecars.

These are source-tree facts. They do not prove local files have already been removed from a user's machine.

## Verification gates

- Inspect the latest CI run after the last commit; previous runs failed or were cancelled during this sequence.
- Require desktop/Core typecheck, Core and desktop tests, lint, production build, Electron package/smoke tests, and cross-platform file-locking checks to pass.
- Test the schema cleanup and backup/restore round-trip.
- Review the Core schema for genuine domain-model design rather than treating table-prefix changes as proof of a ground-up redesign.
- Keep the draft PR unmerged until the verification gates pass.
