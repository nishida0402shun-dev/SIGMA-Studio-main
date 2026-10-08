# SIGMA Studio Operations & Hardening

This document describes the operational safeguards that should be preserved when shipping SIGMA Studio.

## Knowledge DB

- The Knowledge DB is global to the application. Workspace selection must not be used to create separate databases.
- Knowledge DB writes use an atomic file replacement and a stale-fingerprint check. A concurrent stale writer is rejected instead of silently overwriting a newer library.
- Vector-index mutations are serialized per index path.
- Hybrid retrieval uses lexical ranking + Ruri v3 semantic ranking with reciprocal-rank fusion.
- Optional local Jev-style reranking runs after candidate retrieval. If the local decision service is unavailable, retrieval falls back to the Ruri/RRF result instead of failing the query.
- Ruri v3 model files are cached under `~/.sigma-studio/models` by default. `SIGMA_STUDIO_MODEL_CACHE` can relocate the cache.
- Knowledge DB backup creates a ZIP with a `backup-manifest.json`. Restore validates the manifest and rejects absolute paths and path traversal entries before installation.
- Restore keeps the previous database as a timestamped `*.before-restore-*` directory until the new database is installed successfully.

## Web AI / MCP security boundary

The local Web AI bridge must remain:

1. bound to localhost;
2. protected by a random bearer token;
3. restricted to the explicit Web AI origin allowlist;
4. protected by request-body size limits;
5. workspace-scoped for document, proposal, and agent-run operations;
6. limited to the published MCP tool contract.

Global resources such as Knowledge DB and SIGMA Skills may be accessed without a selected workspace only through their explicitly allowlisted global MCP tools.

Agent-run status, SSE events, and cancellation are workspace-scoped. A run ID from another workspace must not grant access.

Write operations remain proposal/approval based. Do not add a direct arbitrary filesystem or shell MCP tool to the Web AI surface.

## Local decision model

The local decision model is optional and must not become a hard dependency for normal retrieval.

- On constrained machines, automatic selection uses the lightweight Tev1 model.
- Higher-memory machines may use the 4B model in high-quality mode.
- A decision-model failure must fall back to Ruri/RRF.
- Keep the model loaded only for a short period; do not make it permanently resident on low-memory systems.

## PDF/OCR recovery

For PDF import:

1. preview/classify first;
2. keep the original PDF outside the Knowledge DB until approval;
3. allow manual correction of proposed segments/classification;
4. approve only after the source fingerprint still matches;
5. index only after registration succeeds.

For OCR-dependent material, treat the extracted text as evidence with normal retrieval confidence; do not assume OCR is perfect.

## Release checks

Before shipping a desktop build:

- `npm ci`
- version check
- script tests
- desktop typecheck
- lint
- desktop tests
- app build
- Electron build
- public package/browser contract tests
- file-locking tests on Windows, macOS, and Linux

A green build is necessary but is not a substitute for security review or real-world PDF/OCR testing.

## Dependency security

Dependabot is enabled for weekly npm dependency update PRs. Dependency upgrades should be reviewed rather than blindly applying every transitive major update, especially for Electron/native modules.

When npm reports vulnerabilities:

- identify whether the vulnerable package is production-reachable;
- prefer a minimal patched dependency update;
- verify desktop and Electron builds;
- do not weaken runtime isolation to work around a dependency issue.

## Long-running / large-library testing

The Knowledge DB test suite includes a multi-thousand-page resilience case and concurrency/write-safety coverage. When changing indexing or retrieval:

- rerun the large-library suite;
- verify that result counts remain bounded;
- verify that concurrent updates do not lose data;
- verify that model initialization failure still falls back safely.

For release candidates, also perform a manual long-running session with Web AI, MCP, indexing, and document editing enabled together.

## Recovery rule

If a release candidate fails after a data-layer change, do not delete the user's Knowledge DB to recover. First use the built-in backup/restore path or restore the preserved pre-restore directory, then investigate the failing migration/index operation.
