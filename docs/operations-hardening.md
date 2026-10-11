# SIGMA Studio Operations & Hardening

This document describes the operational safeguards that should be preserved when shipping SIGMA Studio.

## Web AI / MCP security boundary

The local Web AI bridge must remain:

1. bound to localhost;
2. protected by a random bearer token;
3. restricted to the explicit Web AI origin allowlist;
4. protected by request-body size limits;
5. workspace-scoped for document, proposal, and agent-run operations;
6. limited to the published MCP tool contract.

Global resources such as SIGMA Skills may be accessed without a selected workspace only through their explicitly allowlisted global MCP tools.

Agent-run status, SSE events, and cancellation are workspace-scoped. A run ID from another workspace must not grant access.

Write operations remain proposal/approval based. Do not add a direct arbitrary filesystem or shell MCP tool to the Web AI surface.

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
