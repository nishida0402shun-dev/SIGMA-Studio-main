# SIGMA Studio v1.0 Release Readiness

Phase 0–1: runtime stability and preload/IPC/event parity; Knowledge DB structure-parser bridge; installer launch smoke.

Phase 2–3: global Knowledge DB, page extraction/citations, vector+lexical+metadata+exact/cross-source retrieval, deterministic page analysis, cross-document concept graph, semantic disagreement detection.

Phase 4–6: AI run context/provider abstraction, MCP/SIGMA Tools, Web AI bridge, Workspace/file boundary, read/write/consequential permission gate.

Phase 7–9: explicit Workspace selection, document/version/recovery stores, proposal preview→approve/reject/apply/revert, optimistic revisions, native locks, rolling ledger backup.

Phase 10–12: background update download, install on next quit/restart, CSP/security tests, large-document performance budgets.

Phase 13–14: unit/integration/E2E/release tests, installer smoke, loading/error/recovery/localization/accessibility/design-system coverage.

Phase 15: `v1-readiness.test.ts` and preload API/IPC/event audits are the final architecture gate.

Phase 16: release only after version consistency, typecheck, lint, tests, Electron E2E, CSP smoke, public package checks, Windows installer launch, and macOS signing/notarization checks pass.

Sample SigmaDoc fixtures are not user backups; no user-data repair is required unless a real backup exists.