# SIGMA Core — architecture and integration plan

Status: **design and contract scaffold only**. This document does not claim that adapters have been implemented or that the app already uses SIGMA Core.

## Objective

Build one SIGMA-owned library that coordinates the strongest relevant ideas from local knowledge systems, RAG pipelines, agent runtimes, tool protocols, conversation memory, and adaptive learning. It is not a collection of unrelated frameworks wired directly into the UI.

SIGMA Core owns the public contracts, lifecycle, data model, policy boundaries, provenance, and cross-module orchestration. External libraries and existing app implementations may be used behind adapters when they provide a proven low-level capability.

## Design invariants

1. Desktop UI and Electron IPC depend on SIGMA Core contracts, not directly on SQLite, an embedding implementation, an AI vendor SDK, or an MCP transport.
2. There is one shared application data store across user-selected Workspaces. Workspace selection is explicit; Workspace identity is metadata/filtering, not a separate database by default.
3. Relational records are the source of truth for application entities. Full-text and vector indexes are derived indexes that can be rebuilt and carry an index/schema version.
4. Every retrieval result can preserve provenance back to a document, page, chunk, conversation message, or question.
5. CLI AI, Web AI, and local/remote providers implement a common run contract. Provider-specific capabilities remain explicit rather than being silently flattened.
6. Tool and Skill discovery does not imply permission to execute. Every invocation passes schema validation, permission policy, cancellation, and audit recording.
7. Long-term memory is distinct from raw conversation history. Extracted memory must preserve origin references and support deletion/update.
8. Question Engine behavior is a first-class learning domain, not a side effect of generic RAG.
9. Storage migration is versioned, repeatable, observable, and rollback-aware. Existing data is not deleted until the replacement path has been verified.
10. Adapters are added only when a measured capability gap justifies them; do not add multiple overlapping frameworks by default.

## Proposed module boundaries

| Module | Owns | Does not own |
|---|---|---|
| core | shared IDs, results, errors, contracts, lifecycle | DB drivers, Electron APIs |
| data | shared relational schema, repositories, migrations, backup/restore | embedding/model logic |
| documents | import, extraction, PDF page mapping, chunking, content hashes | retrieval ranking policy |
| retrieval | full-text/vector/hybrid search, reranking, citations and traces | authoritative document storage |
| ai-runtime | provider adapters, run lifecycle, streaming, cancellation, usage | UI state |
| extensions | MCP/Tools/Skills discovery, schema validation, permission and audit | unrestricted execution |
| memory | conversation records, search, summaries, long-term memory provenance | question scoring |
| learning | question bank, import review, answer/evaluation, learner history and scheduling | generic document ingestion |
| security | capability checks, secret handling, validation, audit policies | UI presentation |

The first implementation can be a single npm package with internal folders. Split into more packages only if build boundaries or independent releases make it necessary.

## Candidate reference systems and what to study

These are references, not approved dependencies:

- Maka — local-first desktop architecture and integration boundaries.
- GNO — local knowledge retrieval and source-aware search.
- Haystack — composable document and retrieval pipelines.
- LangGraph — durable execution state, checkpoints, cancellation and approval pauses.
- RAGFlow — document parsing, chunking and evidence traceability.
- agentproto/ts — common runtime patterns across agents, tools and skills.
- Mem0 — extracting and retrieving long-term memory separately from raw history.
- adaptive-engine — adaptive question selection and learning scheduling.
- Flowise — MCP/tool composition in workflows.

Before any dependency adoption, inspect source, current maintenance, license, security posture, Electron compatibility, dependency footprint and tests. Reimplement SIGMA-specific orchestration and contracts; do not copy project code without license review.

## Current repository evidence

On feat/question-engine-rebuild, the existing code already contains several pieces that should be consolidated behind the new contracts rather than blindly replaced:

- packages/question-engine/src/application/contracts.ts: question repository/import pipeline ports.
- packages/question-engine/src/storage/sqlite-schema.ts: shared relational schema including questions, sources/pages, vector records, conversations, long-term memory and research sessions.
- apps/desktop/electron/knowledge-db-store.ts and local-vector-index.ts: knowledge extraction/retrieval and embedding/vector index implementation.
- apps/desktop/electron/web-ai-agent-runtime.ts, web-ai-mcp-gateway.ts, apps/desktop/mcp/: Web AI runtime and MCP/tool implementations.
- apps/desktop/electron/official-skills/: built-in Skill definitions.
- apps/desktop/electron/long-term-memory-store.ts and the conversation memory adapter: memory implementations.

These modules have different maturity and test coverage. Their presence is not proof that every path is wired, correct, or verified.

## Implemented in the current foundation branch

The following code is present in `packages/sigma-core/src`:

- `retrieval/hybrid-retriever.ts`: weighted reciprocal-rank fusion for lexical and semantic backends, with source/domain filtering and trace metadata.
- `knowledge/chunker.ts`: deterministic Unicode-code-point chunking with page/source offsets.
- `knowledge/document-indexer.ts`: embedding batching, dimension/finite-value validation, cancellation checks, and a single vector-index upsert per page.
- `knowledge/contracts.ts`: provider-neutral embedding and vector-index ports.

These are Core-level implementations and contracts, not yet wired to the Electron runtime or production database. The vector index and embedding implementations remain injected adapters. The chunker and indexer have unit tests authored; the latest CI run must pass before they are considered verified.

## Delivery sequence

1. Establish contract tests and module-to-existing-code inventory.
2. Create the @sigma-studio/sigma-core package with provider-neutral contracts.
3. Adapt the existing Question Engine repositories and shared SQLite database without changing storage behavior yet.
4. Add a retrieval facade that unifies full-text/vector/reranking and returns source references.
5. Add AI provider and tool invocation facades, including permission and audit checks.
6. Route conversation memory and learning operations through Core.
7. Move Electron/UI call sites in small batches, keeping compatibility adapters until tests pass.
8. Only then evaluate alternate vector engines, model runtimes, or third-party orchestration frameworks.
9. Validate migration, restart, backup/restore, data deletion, provider failures, tool approvals, and Electron packaging in CI.

## Acceptance criteria

- No UI module imports a concrete DB or vector implementation for ordinary data access.
- CLI and Web AI can call the same retrieval, memory and tool contracts.
- Search results retain page/chunk/message provenance and can be traced to their origin.
- Tool calls are permission-gated and auditable, including failed/cancelled calls.
- The shared store survives app restart; backup/restore and schema upgrades are tested.
- Question import review, search, answer/evaluation and learning history pass focused tests.
- CI typecheck, lint, unit tests, desktop build and Electron smoke tests pass before a production cutover.
