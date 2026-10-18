export const MANUAL_WEB_AI_BRIDGE_PROTOCOL = "sigma-mcp-bridge/v1";
export const MANUAL_WEB_AI_BRIDGE_MAX_REQUEST_CHARS = 32_768;
export const MANUAL_WEB_AI_BRIDGE_MAX_RESPONSE_CHARS = 65_536;
export const MANUAL_WEB_AI_BRIDGE_TIMEOUT_MS = 10_000;

/**
 * Explicit allowlist for the manual fallback. Do not replace this with a check of
 * readOnlyHint alone: annotations are descriptive metadata, not an authorization policy.
 */
export const MANUAL_WEB_AI_READ_ONLY_TOOLS = [
  "get_local_app_status",
  "list_local_documents",
  "read_local_document",
  "get_edit_context",
  "get_document_outline",
  "get_block",
  "get_blocks",
  "search_document",
  "search_library",
  "validate_local_document",
  "list_materials",
  "get_material",
  "render_block_context",
  "render_page",
  "get_selected_block",
  "get_insertion_candidates",
  "get_neighbor_blocks",
  "get_active_reference",
  "get_attached_media",
  "get_mentioned_sigma_docs",
  "list_generated_images",
  "get_image_reference",
  "knowledge_db_list_sources",
  "knowledge_db_search",
  "knowledge_db_get_page",
  "knowledge_db_get_region",
  "conversation_memory_search",
  "conversation_memory_recent",
] as const;

type ManualToolName = (typeof MANUAL_WEB_AI_READ_ONLY_TOOLS)[number];
type JsonRecord = Record<string, unknown>;

interface ManualBridgeRequest {
  protocol: typeof MANUAL_WEB_AI_BRIDGE_PROTOCOL;
  tool: ManualToolName;
  arguments: JsonRecord;
}

export interface ManualBridgeResult {
  protocol: typeof MANUAL_WEB_AI_BRIDGE_PROTOCOL;
  ok: boolean;
  tool?: string;
  data?: unknown;
  error?: {
    code: "INVALID_REQUEST" | "TOOL_NOT_ALLOWED" | "INVALID_ARGUMENTS" | "TOOL_TIMEOUT" | "TOOL_FAILED" | "RESPONSE_TOO_LARGE";
    message: string;
  };
}

interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  enum?: unknown[];
  const?: unknown;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
}

export interface ManualBridgeTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean };
  execute(input: JsonRecord): Promise<unknown> | unknown;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function schemaMatches(value: unknown, schema: JsonSchema): boolean {
  if (schema.anyOf && !schema.anyOf.some((candidate) => schemaMatches(value, candidate))) return false;
  if (schema.oneOf && schema.oneOf.filter((candidate) => schemaMatches(value, candidate)).length !== 1) return false;
  if (schema.const !== undefined && !Object.is(value, schema.const)) return false;
  if (schema.enum && !schema.enum.some((candidate) => Object.is(candidate, value))) return false;

  if (schema.type !== undefined) {
    const allowedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
    const matchesType = allowedTypes.some((type) => {
      switch (type) {
        case "object": return isRecord(value);
        case "array": return Array.isArray(value);
        case "string": return typeof value === "string";
        case "number": return typeof value === "number" && Number.isFinite(value);
        case "integer": return typeof value === "number" && Number.isInteger(value);
        case "boolean": return typeof value === "boolean";
        case "null": return value === null;
        default: return false;
      }
    });
    if (!matchesType) return false;
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) return false;
    if (schema.maximum !== undefined && value > schema.maximum) return false;
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) return false;
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) return false;
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) return false;
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return false;
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) return false;
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return false;
    if (schema.items && !value.every((item) => schemaMatches(item, schema.items!))) return false;
  }
  if (isRecord(value)) {
    const properties = schema.properties ?? {};
    if (schema.required?.some((key) => !(key in value))) return false;
    for (const [key, item] of Object.entries(value)) {
      const propertySchema = properties[key];
      if (propertySchema) {
        if (!schemaMatches(item, propertySchema)) return false;
      } else if (schema.additionalProperties === false
        || schema.additionalProperties === undefined && schema.properties !== undefined) {
        return false;
      } else if (isRecord(schema.additionalProperties) && !schemaMatches(item, schema.additionalProperties)) {
        return false;
      }
    }
  }
  return true;
}

function errorResult(
  code: NonNullable<ManualBridgeResult["error"]>["code"],
  message: string,
  tool?: string,
): ManualBridgeResult {
  return {
    protocol: MANUAL_WEB_AI_BRIDGE_PROTOCOL,
    ok: false,
    ...(tool ? { tool } : {}),
    error: { code, message },
  };
}

export function parseManualWebAiBridgeRequest(input: string): ManualBridgeRequest | ManualBridgeResult {
  if (input.length > MANUAL_WEB_AI_BRIDGE_MAX_REQUEST_CHARS) {
    return errorResult("INVALID_REQUEST", `リクエストが上限 (${MANUAL_WEB_AI_BRIDGE_MAX_REQUEST_CHARS} 文字) を超えています。`);
  }

  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    return errorResult("INVALID_REQUEST", "JSONとして解析できません。ChatGPTの出力をJSONだけで貼り付けてください。");
  }

  if (!isRecord(value)
    || Object.keys(value).some((key) => !["protocol", "tool", "arguments"].includes(key))
    || value.protocol !== MANUAL_WEB_AI_BRIDGE_PROTOCOL
    || typeof value.tool !== "string"
    || !isRecord(value.arguments)) {
    return errorResult("INVALID_REQUEST", "protocol、tool、argumentsを持つリクエスト形式ではありません。余分なキーも指定できません。");
  }

  if (!MANUAL_WEB_AI_READ_ONLY_TOOLS.includes(value.tool as ManualToolName)) {
    return errorResult("TOOL_NOT_ALLOWED", "このブリッジでは許可されていないツールです。読み取り専用の許可済みツールだけを実行できます。", value.tool);
  }

  return {
    protocol: MANUAL_WEB_AI_BRIDGE_PROTOCOL,
    tool: value.tool as ManualToolName,
    arguments: value.arguments,
  };
}

/** Execute one allowlisted read-only MCP tool request pasted from a Web AI chat. */
export async function executeManualWebAiBridgeRequest(
  input: string,
  tools: readonly ManualBridgeTool[],
  options: { timeoutMs?: number; maxResponseChars?: number } = {},
): Promise<ManualBridgeResult> {
  const parsed = parseManualWebAiBridgeRequest(input);
  if ("ok" in parsed) return parsed;

  const tool = tools.find((candidate) => candidate.name === parsed.tool);
  if (!tool
    || tool.annotations?.readOnlyHint !== true
    || !MANUAL_WEB_AI_READ_ONLY_TOOLS.includes(tool.name as ManualToolName)) {
    return errorResult("TOOL_NOT_ALLOWED", "許可済みの読み取り専用ツールとして登録されていません。", parsed.tool);
  }

  if (!schemaMatches(parsed.arguments, tool.inputSchema as JsonSchema)) {
    return errorResult("INVALID_ARGUMENTS", "argumentsがツールの入力スキーマに一致しません。", parsed.tool);
  }

  const timeoutMs = options.timeoutMs ?? MANUAL_WEB_AI_BRIDGE_TIMEOUT_MS;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => tool.execute(parsed.arguments)),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("SIGMA_WEB_AI_BRIDGE_TIMEOUT")), timeoutMs);
      }),
    ]);
    let serialized: string;
    try {
      serialized = JSON.stringify(result);
    } catch {
      return errorResult("TOOL_FAILED", "ツール結果をJSONに変換できませんでした。", parsed.tool);
    }
    if (serialized === undefined) {
      return errorResult("TOOL_FAILED", "ツールがJSON化できない結果を返しました。", parsed.tool);
    }
    if (serialized.length > (options.maxResponseChars ?? MANUAL_WEB_AI_BRIDGE_MAX_RESPONSE_CHARS)) {
      return errorResult("RESPONSE_TOO_LARGE", "ツール結果が応答サイズの上限を超えました。", parsed.tool);
    }
    return { protocol: MANUAL_WEB_AI_BRIDGE_PROTOCOL, ok: true, tool: parsed.tool, data: JSON.parse(serialized) as unknown };
  } catch (error) {
    if (error instanceof Error && error.message === "SIGMA_WEB_AI_BRIDGE_TIMEOUT") {
      return errorResult("TOOL_TIMEOUT", `ツールが${timeoutMs}ms以内に完了しませんでした。`, parsed.tool);
    }
    return errorResult("TOOL_FAILED", error instanceof Error ? error.message : "ツールの実行に失敗しました。", parsed.tool);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
