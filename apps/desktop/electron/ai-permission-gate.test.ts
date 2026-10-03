import { describe, expect, it, vi } from "vitest";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

import { classifyAiPermission, createAiPermissionGate } from "./ai-permission-gate";

const readTools = new Set(["read_local_document"]);

function tool(name: string, annotations?: Tool["annotations"]): Tool {
  return {
    name,
    description: "test",
    inputSchema: { type: "object" },
    ...(annotations ? { annotations } : {}),
  };
}

describe("AI permission gate", () => {
  it("allows known read tools without prompting", async () => {
    const request = vi.fn(async () => false);
    const gate = createAiPermissionGate(request);
    expect(classifyAiPermission(tool("read_local_document"), readTools)).toBe("read");
    await expect(gate.check(tool("read_local_document"), {}, readTools)).resolves.toBe(true);
    expect(request).not.toHaveBeenCalled();
  });

  it("requires approval for writable tools", async () => {
    const request = vi.fn(async () => true);
    const gate = createAiPermissionGate(request);
    expect(classifyAiPermission(tool("update_document"), readTools)).toBe("write");
    await expect(gate.check(tool("update_document"), { fileId: "f" }, readTools)).resolves.toBe(true);
    expect(request).toHaveBeenCalledOnce();
  });

  it("treats destructive annotations as consequential", async () => {
    const request = vi.fn(async () => false);
    const gate = createAiPermissionGate(request);
    expect(classifyAiPermission(tool("custom_operation", { readOnlyHint: false, destructiveHint: true }), readTools)).toBe("consequential");
    await expect(gate.check(tool("custom_operation", { readOnlyHint: false, destructiveHint: true }), {}, readTools)).resolves.toBe(false);
  });

  it("fails closed for unknown unannotated tools", () => {
    expect(classifyAiPermission(tool("future_mcp_tool"), readTools)).toBe("write");
  });
});
