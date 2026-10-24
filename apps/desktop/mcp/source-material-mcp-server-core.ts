/**
 * Read-only SIGMA Core source-material MCP server.
 *
 * Studio deliberately does not reuse Core's full stdio entrypoint here: that
 * server also exposes mutable lifecycle tools. CLI AI receives a separate
 * `studio-ai` subject with read grants, and this surface contains retrieval
 * tools only. The database path and subject come from Studio's MCP launcher.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type {
  AuthContext,
  CoreService,
  SourceLocation,
  SourceObject,
} from "../electron/source-material/core-bridge";

const SERVER_NAME = "sigma-core-local";
const SERVER_VERSION = "1.0.0";

function sourceSummary(core: CoreService, auth: AuthContext, object: SourceObject) {
  const artifact = core.getExtractionArtifacts(auth, object.objectId).at(-1);
  return {
    sourceId: object.objectId,
    workspaceId: object.scopeId,
    name: object.metadata.name,
    mimeType: object.metadata.mimeType,
    sizeBytes: object.metadata.sizeBytes,
    pageCount: object.metadata.pageCount ?? artifact?.pageCount ?? 0,
    contentHash: object.contentHash,
    createdAt: object.createdAt,
    updatedAt: object.updatedAt,
    extraction: artifact
      ? {
          extractorId: artifact.extractorId,
          extractorVersion: artifact.extractorVersion,
          status: artifact.status,
          warnings: artifact.warnings,
          pageCount: artifact.pageCount ?? null,
        }
      : null,
  };
}

function pageResult(location: SourceLocation) {
  return {
    pageNumber: location.pageNumber,
    section: location.section ?? null,
    title: location.title ?? null,
    semanticType: location.semanticType,
    text: location.textContent ?? "",
    startOffset: location.startOffset ?? null,
    endOffset: location.endOffset ?? null,
    boundingBox: location.boundingBox ?? null,
  };
}

function jsonResult(payload: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload as Record<string, unknown>,
  };
}

function errorResult(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

function assertWorkspace(object: SourceObject | undefined, workspaceId: string): SourceObject {
  if (!object || object.scopeId !== workspaceId) {
    throw new Error("SOURCE_NOT_FOUND: source does not exist in the requested workspace");
  }
  return object;
}

export function createSourceMaterialMcpServer(
  core: CoreService,
  auth: AuthContext,
): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, {
    instructions: [
      "SIGMA Studioの資料（SIGMA Core）を読み取る専用サーバーです。",
      "すべてのツールは読み取り専用で、資料の追加・削除・更新はできません。",
      "最初にlist_source_workspacesでWorkspaceを確認し、workspaceIdを明示して資料を検索・取得してください。",
      "引用するときはsourceId、pageNumber、contentHashを回答に残してください。",
      "資料に書かれていない内容を補完した場合は、資料の事実と区別して明示してください。",
    ].join(" "),
  });

  server.registerTool(
    "list_source_workspaces",
    {
      title: "資料Workspace一覧",
      description: "CLI AIが読み取りを許可されているSIGMA Coreの資料Workspaceを返します。",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const workspaces = core.listWorkspaces(auth).map((workspace) => ({
          workspaceId: workspace.workspaceId,
          displayName: workspace.displayName,
          sourceCount: core.listObjects(auth, workspace.workspaceId).length,
        }));
        return jsonResult({ workspaces });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "list_sources",
    {
      title: "資料一覧",
      description: "指定Workspaceの有効な資料を、ページ数・内容ハッシュ・抽出状態とともに返します。",
      inputSchema: { workspaceId: z.string().min(1) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ workspaceId }) => {
      try {
        const sources = core
          .listObjects(auth, workspaceId)
          .map((object) => sourceSummary(core, auth, object))
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
        return jsonResult({ workspaceId, sources });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "search_sources",
    {
      title: "資料を検索",
      description: "指定Workspaceの抽出テキストを検索し、出典のページ番号と抜粋を返します。",
      inputSchema: {
        workspaceId: z.string().min(1),
        query: z.string().min(1),
        limit: z.number().int().min(1).max(50).optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ workspaceId, query, limit }) => {
      try {
        const hits = core.search(auth, {
          scopeId: workspaceId,
          query,
          ...(limit === undefined ? {} : { limit }),
        });
        return jsonResult({
          workspaceId,
          query,
          hits: hits.map((hit) => ({
            sourceId: hit.objectId,
            sourceName: hit.sourceName,
            pageNumber: hit.pageNumber,
            semanticType: hit.semanticType,
            title: hit.title ?? null,
            textSnippet: hit.textSnippet,
            score: hit.score,
          })),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get_source",
    {
      title: "資料の詳細",
      description: "資料のメタデータ、内容ハッシュ、抽出状態と警告を返します。",
      inputSchema: { workspaceId: z.string().min(1), sourceId: z.string().min(1) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ workspaceId, sourceId }) => {
      try {
        const object = assertWorkspace(core.getObject(auth, sourceId), workspaceId);
        return jsonResult({ source: sourceSummary(core, auth, object) });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get_source_page",
    {
      title: "資料のページ",
      description: "指定資料の1始まりページ番号から、抽出テキストと出典位置を返します。",
      inputSchema: {
        workspaceId: z.string().min(1),
        sourceId: z.string().min(1),
        pageNumber: z.number().int().min(1),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ workspaceId, sourceId, pageNumber }) => {
      try {
        assertWorkspace(core.getObject(auth, sourceId), workspaceId);
        const page = core.getPage(auth, sourceId, pageNumber);
        if (!page) throw new Error(`PAGE_NOT_FOUND: page ${pageNumber} has no extracted text`);
        return jsonResult({ sourceId, page: pageResult(page.location) });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get_source_page_range",
    {
      title: "資料のページ範囲",
      description: "指定資料の1始まりの開始・終了ページをまとめて返します。欠落ページがある範囲はエラーになります。",
      inputSchema: {
        workspaceId: z.string().min(1),
        sourceId: z.string().min(1),
        startPage: z.number().int().min(1),
        endPage: z.number().int().min(1),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ workspaceId, sourceId, startPage, endPage }) => {
      try {
        assertWorkspace(core.getObject(auth, sourceId), workspaceId);
        const range = core.getPageRange(auth, sourceId, startPage, endPage);
        return jsonResult({
          sourceId,
          startPage: range.startPage,
          endPage: range.endPage,
          pageCount: range.pageCount,
          pages: range.pages.map(pageResult),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  return server;
}
