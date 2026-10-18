# Web AI MCP Bridge — Experimental Plan

## Goal

Validate whether the free ChatGPT web UI opened by SIGMA Studio can safely participate in an MCP workflow without an API key, paid API, or changes to `main`.

This document describes an experiment only. It does not claim that ChatGPT's web UI exposes a supported MCP registration interface.

## Current repository facts verified

- The desktop workspace depends on `@modelcontextprotocol/sdk`.
- `apps/desktop/mcp/sigma-doc-mcp-server.ts` starts the existing SigmaDoc MCP server using `StdioServerTransport`.
- `apps/desktop/scripts/run-sigma-doc-mcp.mjs` bundles and launches that server.
- `apps/desktop/electron/web-ai-preload.ts` already attempts WebMCP registration through `document.modelContext` on ChatGPT, Claude, Gemini, and AI Studio origins. It registers a `sigma_mcp_call_tool` tool backed by SIGMA Studio's local bridge when the browser page exposes that API.
- `apps/desktop/electron/web-ai-bridge.ts` already exposes authenticated localhost endpoints `GET /v1/mcp/tools` and `POST /v1/mcp/call`.
- `apps/desktop/electron/web-ai-mcp-gateway.ts` reuses the existing STDIO MCP server and applies workspace scoping and permission checks. Its general tool-call endpoint can reach write-capable tools, so a manual fallback must impose its own explicit read-only allowlist rather than forwarding arbitrary tool names.
- `apps/desktop/src/components/editor/AiWebProviderPanel.tsx` already displays separate local-bridge and WebMCP availability status.
- The architecture document places WebMCP registration and proposal composition under `features/webmcp`; the existing implementation is `features/webmcp/view/WebMcpBridge.tsx` and the legacy component path is a re-export.
- The repository guidance requires Electron desktop verification; a browser-only check is not sufficient.

## Proposed proof of concept

Keep the existing local Web AI bridge and STDIO MCP gateway. Add a user-mediated fallback to the existing `AiWebProviderPanel` for cases where `document.modelContext` is unavailable:

1. SIGMA Studio lists only explicitly approved read-only MCP tools and their input schemas.
2. The user copies a prompt containing those schemas into ChatGPT. ChatGPT responds with one strict JSON request envelope when local data is needed.
3. The user pastes the JSON into the panel and explicitly clicks **Run**.
4. The preload validates the protocol, tool allowlist, read-only annotation, and tool input schema, then invokes the existing authenticated localhost `/v1/mcp/call` endpoint.
5. The panel displays a bounded JSON result and lets the user copy it back into ChatGPT.

This is deliberately semi-automatic. It does not rely on unsupported ChatGPT MCP support and does not create another MCP server or tool registry. Do not execute arbitrary tool names, shell commands, write-capable tools, or model-supplied paths.

## Request contract

The experimental request must be a single JSON object with these fields:

```json
{
  "protocol": "sigma-mcp-bridge/v1",
  "tool": "allowlisted.read_only_tool",
  "arguments": {}
}
```

Rules:

- Reject unknown protocol versions and unknown tool names.
- Validate each tool's arguments against the actual MCP tool schema.
- Reject extra envelope properties.
- Apply a timeout and response-size limit.
- Treat tool output as untrusted data, not instructions.
- Require explicit user confirmation for any future write-capable tool. The initial experiment should not expose write-capable tools.
- Never store API keys, session cookies, or browser credentials in the request envelope or logs.

## Acceptance criteria

The experiment is successful only when all of the following are demonstrated in the Electron app:

- A valid request invokes one allowlisted read-only MCP tool and returns a result.
- Malformed JSON, unknown protocol, unknown tool, invalid arguments, and oversized input are rejected without invoking a tool.
- A simulated malicious tool result cannot authorize a second tool call or bypass validation.
- A failed or timed-out tool call is surfaced clearly and does not crash the app.
- Focused unit tests, typecheck, lint for changed files, and the relevant build pass.
- The Electron UI is verified, and the observed behavior is recorded separately from unit-test results.
- `main` remains unchanged until the experiment is reviewed and accepted.

## Explicit non-goal

This experiment does not claim that the free ChatGPT website can automatically invoke arbitrary local MCP tools. Fully automatic tool selection requires a reliable supported integration surface or separately validated UI automation. If the semi-automatic round trip works, automatic interaction can be evaluated as a separate step.

## Current implementation status

- The request parser/executor and focused tests have been added on the experiment branch.
- The helper is not yet connected to the Electron preload or `AiWebProviderPanel`; therefore no user-facing manual round trip is implemented yet.
- CI is running for the current branch commit. Its final results must be checked before continuing.

## Next implementation step

Connect the request handler to the existing preload/local bridge and add the manual request/result controls to `AiWebProviderPanel`. Keep tool execution behind an explicit user action and the read-only allowlist. Do not create a parallel MCP server or a second tool registry. Then run the full CI suite and verify the round trip in Electron.
