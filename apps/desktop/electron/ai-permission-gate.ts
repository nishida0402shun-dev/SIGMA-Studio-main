import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export type AiPermissionClass = "read" | "write" | "consequential";

export interface AiPermissionRequest {
  tool: Tool;
  toolName: string;
  permissionClass: Exclude<AiPermissionClass, "read">;
  arguments: Record<string, unknown>;
}

export type AiPermissionRequester = (request: AiPermissionRequest) => Promise<boolean>;

const CONSEQUENTAL_NAME = /(^|_)(delete|remove|destroy|overwrite|publish|deploy|execute|send|move|rename)(_|$)/i;
const WRITE_NAME = /(^|_)(create|update|edit|write|apply|approve|reject|submit|insert|append|set|add|run|start|cancel)(_|$)/i;

export function classifyAiPermission(tool: Tool, readOnlyToolNames: ReadonlySet<string>): AiPermissionClass {
  if (tool.annotations?.readOnlyHint === true || readOnlyToolNames.has(tool.name)) return "read";
  if (tool.annotations?.destructiveHint === true || CONSEQUENTAL_NAME.test(tool.name)) return "consequential";
  if (tool.annotations?.readOnlyHint === false || WRITE_NAME.test(tool.name)) return "write";
  // Fail closed for newly-added MCP tools until their safety semantics are known.
  return "write";
}

export function createAiPermissionGate(request: AiPermissionRequester): {
  check(tool: Tool, arguments_: Record<string, unknown>, readOnlyToolNames: ReadonlySet<string>): Promise<boolean>;
} {
  return {
    async check(tool, arguments_, readOnlyToolNames) {
      const permissionClass = classifyAiPermission(tool, readOnlyToolNames);
      if (permissionClass === "read") return true;
      return request({
        tool,
        toolName: tool.name,
        permissionClass,
        arguments: arguments_,
      });
    },
  };
}
