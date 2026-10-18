# Web AI MCP Bridge — Experimental Plan

## Goal

Validate whether the free ChatGPT web UI opened by SIGMA Studio can safely participate in an MCP workflow without an API key, paid API, or changes to `main`.

This document describes an experiment only. It does not claim that ChatGPT's web UI exposes a supported MCP registration interface.

## Current repository facts verified

- The desktop workspace depends on `@modelcontextprotocol/sdk`.
- `apps/desktop/mcp/sigma-doc-mcp-server.ts` starts the existing SigmaDoc MCP server using `StdioServerTransport`.
- `apps/desktop/scripts/run-sigma-doc-mcp.mjs` bundles and launches that server.
- `docs/architecture.md` describes a `features/webmcp` composition boundary, but its concrete implementation and current wiring still need to be inspected before editing it.
- The repository guidance requires Electron desktop verification; a browser-only check is not sufficient.

## Proposed proof of concept

Start with an explicit, user-mediated round trip rather than attempting to inject unsupported MCP support into ChatGPT:

1. SIGMA Studio provides a documented prompt that asks ChatGPT to emit one strict JSON tool-request envelope.
2. The user copies the JSON response from ChatGPT into a dedicated SIGMA Studio test surface.
3. SIGMA Studio validates the envelope against a small allowlist of read-only tools. Never execute arbitrary tool names, shell commands, file writes, or model-supplied paths.
4. The bridge invokes the registered MCP tool and displays the structured result.
5. SIGMA Studio produces a result envelope that the user can copy back to ChatGPT for interpretation.

This is deliberately a semi-automatic proof of concept. It tests the tool contract and MCP execution without pretending the ChatGPT web UI supports direct MCP calls. Only after this passes should automatic clipboard/DOM interaction be considered.

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

## Next implementation step

Inspect the concrete `features/webmcp` implementation, its tests, and the Electron UI composition point. Reuse the existing tool registry and authorization patterns where possible. Do not create a parallel MCP server or a second tool registry without evidence that the existing one cannot support the experiment.
