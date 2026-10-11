# SIGMA Core integration map

Audit ref: branch feat/question-engine-rebuild, commit 5c5e37b1201396b6a0fe9c08c73d1de65e58a511. This map is based on repository files, not runtime verification.

| Existing area | Current path(s) | Planned Core destination | Action |
|---|---|---|---|
| Question domain and import ports | packages/question-engine/src/core, application/contracts.ts | learning + shared core contracts | Adapt and then deprecate duplicate public contracts after call sites move |
| Shared SQLite schema/repositories | packages/question-engine/src/storage | data | Preserve schema/data initially; put repository interfaces behind Core |
| Knowledge source/page metadata | apps/desktop/electron/knowledge-db-store.ts, Question Engine schema | documents + data | Separate extraction orchestration from authoritative persistence |
| Embeddings/vector index | apps/desktop/electron/local-vector-index.ts | retrieval/adapters/vector | Keep as first adapter; do not change engine until benchmarks justify it |
| Knowledge search/reranking | knowledge-db-store.ts, knowledge-db-search-utils.ts, decision reranker | retrieval | Unify query/result shape and preserve citations |
| Web AI agent runtime | apps/desktop/electron/web-ai-agent-runtime.ts | ai-runtime/adapters/web | Wrap behind common run/events/cancel contract |
| MCP gateway and local MCP server | web-ai-mcp-gateway.ts, apps/desktop/mcp | extensions/adapters/mcp | Preserve tool schemas and current approval boundaries |
| CLI provider configuration | claude-mcp-config.ts, codex-mcp-config.ts, related runtime modules | ai-runtime/adapters/cli | Normalize lifecycle/events without removing provider-specific features |
| Built-in Skills | apps/desktop/electron/official-skills | extensions/skills | Preserve existing Skill format; add discovery/validation adapter |
| Conversation history | Question Engine conversation storage and existing UI/IPC callers | memory/conversations | Unify search/result provenance; avoid duplicating records |
| Long-term memory | Question Engine SQLite long-term memory storage | memory/long-term | Track origin messages and deletion/update semantics |
| Research sessions | Question Engine research-session storage | memory/research or a separate research module | Keep distinct from conversation history; decide after caller audit |
| StudyAid / Question Engine UI | existing question repository and import pipeline | learning | Add answer/evaluation and learning history incrementally |

## Known constraints

- The root npm workspace list on this branch currently includes the desktop app, viewer, editor and React 18 example; packages/question-engine is not in that list. Its own package has a TypeScript typecheck script, but root CI does not currently invoke that package script directly.
- The separate-vector-store draft PR (#22) is based on feat/question-engine-rebuild and has not reported CI statuses in the inspected status endpoint. It should remain unmerged until code review and test/build evidence exist.
- The current vector implementation stores normalized embeddings as JSON and performs cosine scoring in JavaScript. An alternate engine should be evaluated against representative datasets before adoption.
- Existing storage migrations include deliberate retirement of older JSON-backed stores. Verify actual user-data locations and migration behavior before deleting compatibility code or data.
- The official upstream repository has additional files/features in some areas; each diff needs classification and focused tests rather than wholesale copying.

## First adapter milestone

The first code milestone is intentionally narrow: export contracts from @sigma-studio/sigma-core, then create adapters that delegate to the current Question Engine and retrieval implementation. No data schema, vector engine, AI provider, MCP server, Skill format or UI behavior should change in this milestone.
