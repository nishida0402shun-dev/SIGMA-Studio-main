# Web AI bridge

Sigma Studio exposes an authenticated loopback API for supported Web AI windows.

## Security boundary

- The HTTP server binds only to `127.0.0.1`.
- Every request requires a per-launch random Bearer token.
- Browser origins are restricted to ChatGPT, Claude, Gemini, and Google AI Studio origins.
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
- `GET /v1/mcp/tools`
- `POST /v1/mcp/call`

## Web AI windows

The application menu exposes ChatGPT Web, Claude Web, Gemini Web, and Google AI Studio Web. Their remote pages are loaded with:

- Google AI Studio opens at `https://aistudio.google.com/prompts/new_chat?model=gemini-3.8-flash` by default. The Web AI panel can switch between `Gemini 3.8 Flash` (`gemini-3.8-flash`) and `Gemini 3.7 Flash` (`gemini-3.7-flash`).
- The Google AI Studio page is connected to the same local SIGMA Bridge and WebMCP preload as the other supported Web AI pages.
- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- `webSecurity: true`
- a provider-specific persistent session
- a dedicated preload that registers Sigma tools through WebMCP when the loaded site exposes `document.modelContext`.

WebMCP availability is browser/provider dependent. The local API remains the deterministic integration surface even when a provider does not expose WebMCP.


## Knowledge DB PDF staging

Web AI can use the same global Knowledge DB MCP surface as the desktop AI. PDF registration is intentionally staged:

1. `knowledge_db_pdf_import_preview` reads the selected local PDF, analyzes pages, proposes split segments and taxonomy classification, and creates a staging record. The original PDF is **not** registered yet.
2. `knowledge_db_pdf_import_staging_get` / `knowledge_db_pdf_import_staging_list` inspect pending proposals.
3. `knowledge_db_pdf_import_staging_update` lets the AI revise selected segments, page ranges, names, taxonomy paths, confidence, and reasons before approval.
4. `knowledge_db_pdf_import_approve` registers the original PDF and materializes the selected child PDFs. The source hash is rechecked so a changed file cannot be approved accidentally.
5. `knowledge_db_pdf_import_reject` discards the pending import without registering the PDF.

The preview, update, approve, and reject operations are consequential Web AI tools and are routed through SIGMA Studio's existing user-approval gate. Workspace selection is not required because the Knowledge DB is global.
