# Question Engine migration inventory

Audit baseline: commit `7377554902141bba9335435394ed7bfeefbf3efe`.

This is a source-code inventory, not a claim that runtime data locations or test results have been verified.

## Existing data stores found

| Area | Existing implementation | Format / role | Migration decision |
|---|---|---|---|
| Question Bank | `packages/sigma_studio_question_bank_package/packages/question-bank/src/db/schema.ts`, `repository.ts`, `stagingRepository.ts` | SQLite via `better-sqlite3`; question records, taxonomy, FTS5, PDF import staging | Reuse domain ideas and repository behavior after schema and FTS correctness tests. Do not delete or migrate yet. |
| Knowledge DB | `apps/desktop/electron/knowledge-db-store.ts` | File-backed knowledge library; source documents, pages, extraction/classification metadata and knowledge retrieval integration | Preserve existing user-visible workflows. Audit file format, backup/restore, locking, and all consumers before choosing whether to migrate records or retain an adapter. |
| Local vector index | `apps/desktop/electron/local-vector-index.ts` | Versioned file-backed vector records and local embedding model integration | Keep as an adapter initially. Decide whether vector records should be indexed from the new canonical source model only after checking rebuild/recovery behavior and performance. |
| Conversation memory | `apps/desktop/electron/conversation-memory-store.ts` | JSON file-backed conversation entries, recent/search operations | Preserve the feature and its retention/privacy behavior; evaluate a repository adapter rather than deleting it. |
| Long-term memory | `apps/desktop/electron/long-term-memory-store.ts` | JSON file-backed extracted memory entries | Preserve existing APIs and semantics during migration; assess deduplication, retention, and error handling. |
| Browser runtime stores | `apps/desktop/src/lib/runtime/browser/idb-backend.ts`, `memory-backend.ts` | Browser-side persistence abstractions | Treat separately from Electron's local data stores; audit callers and compatibility requirements before unifying APIs. |

## Important observations

- The project does not currently have one uniform physical database engine for all these features. At this baseline, the Question Bank uses SQLite while Knowledge DB, vector index, and memory stores are file-backed.
- A shared *library/API* does not require every record to be stored in one SQLite file. Domain ownership and persistence adapters should be separated.
- The Knowledge DB already has substantial import, page analysis, classification, and retrieval logic. Reimplementing it without a detailed audit risks losing valuable independent functionality.
- The Question Bank package uses an older dependency set and is outside the root npm workspaces shown in the audited root `package.json`; integration must account for this rather than assuming it is already wired into the desktop app.
- The Question Bank FTS5 schema uses an external-content FTS table with `body_text`, while the source table has `body_json`. Its triggers also refer to `body_json`. This needs an explicit correctness test and likely a schema adjustment in the new implementation.

## Safe rebuild strategy

1. Keep all old stores and their on-disk formats untouched during initial development.
2. Establish the new library's domain/application interfaces independently of storage.
3. Add storage adapters and versioned migrations behind those interfaces.
4. Write import/export and round-trip tests using disposable copies of old data.
5. Preserve backward compatibility through adapters until all consumers have migrated.
6. Only propose removal of legacy stores after data parity, backup/restore, performance, and regression checks pass.

## Unknowns that require runtime or broader source inspection

- Exact runtime data directories and whether users have existing production data in them.
- All constructor/initialization sites and all IPC/MCP/UI consumers.
- Full browser-store migration behavior and its persisted schema.
- Current automated test/build/CI results for the audit baseline.
- Whether the vector index can be deterministically rebuilt from the current Knowledge DB.
