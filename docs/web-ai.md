# Web AI bridge

Sigma Studio exposes an authenticated loopback API for supported Web AI windows.

## Security boundary

- The HTTP server binds only to `127.0.0.1`.
- Every request requires a per-launch random Bearer token.
- Browser origins are restricted to ChatGPT, Claude, and Gemini origins.
- Remote pages receive no Electron IPC object and no Node integration.
- Web AI actions are routed through the existing Agent Runtime and Proposal/Revision safety model.
- There is no arbitrary shell-command endpoint.

The bridge metadata and token are written to:

`<userData>/data/ai-run-context/web-ai-bridge.json`

The file is removed when Sigma Studio exits.

## API

- `GET /v1/health`
- `GET /v1/capabilities`
- `GET /v1/documents`
- `GET /v1/documents/:fileId`
- `GET /v1/proposals?fileId=...`
- `POST /v1/agent/runs`
- `GET /v1/agent/runs/:runId`
- `GET /v1/agent/runs/:runId/events`
- `POST /v1/agent/runs/:runId/cancel`
- `POST /v1/proposals/:proposalId/approve`
- `POST /v1/proposals/:proposalId/reject`

## Web AI windows

The application menu exposes ChatGPT Web, Claude Web, and Gemini Web. Their remote pages are loaded with:

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- `webSecurity: true`
- a provider-specific persistent session
- a dedicated preload that registers Sigma tools through WebMCP when the loaded site exposes `document.modelContext`.

WebMCP availability is browser/provider dependent. The local API remains the deterministic integration surface even when a provider does not expose WebMCP.
