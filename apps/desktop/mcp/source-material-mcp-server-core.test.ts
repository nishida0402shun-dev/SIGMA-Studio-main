import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AuthService,
  BackupService,
  CoreRepository,
  CoreService,
  DeviceQuarantineService,
  LocalBlobStore,
} from "../electron/source-material/core-bridge";
import { SourceMaterialService } from "../electron/source-material/source-material-service";
import { createSourceMaterialMcpServer } from "./source-material-mcp-server-core";

function payloadOf(result: Awaited<ReturnType<Client["callTool"]>>): Record<string, unknown> {
  const content = Array.isArray(result.content) ? result.content[0] : undefined;
  if (!content || content.type !== "text") throw new Error("expected a text result");
  return JSON.parse(content.text) as Record<string, unknown>;
}

describe("read-only source material MCP server", () => {
  let userDataDir: string;
  let source: SourceMaterialService | null;
  let client: Client | null;

  beforeEach(async () => {
    userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "sigma-core-mcp-"));
    source = new SourceMaterialService(userDataDir);
    source.registerWorkspace("workspace-a", "理科資料");
    await source.importBytes("workspace-a", {
      name: "lesson.txt",
      bytes: Buffer.from("光合成には光と二酸化炭素が必要です。", "utf8"),
    });
    source.close();
    source = null;
    client = null;
  });

  afterEach(async () => {
    await client?.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  });

  async function connect(): Promise<Client> {
    const dataDir = path.join(userDataDir, "data", "sigma-core");
    const repository = new CoreRepository(path.join(dataDir, "core.sqlite"));
    const authService = new AuthService(repository);
    const core = new CoreService(
      repository,
      new LocalBlobStore(path.join(dataDir, "blobs")),
      authService,
      new BackupService(repository),
      new DeviceQuarantineService(repository),
    );
    const server = createSourceMaterialMcpServer(core, { subjectId: "studio-ai" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const instance = new Client({ name: "source-material-mcp-test", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), instance.connect(clientTransport)]);
    return instance;
  }

  it("publishes retrieval tools only", async () => {
    client = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();
    expect(names).toEqual([
      "get_source",
      "get_source_page",
      "get_source_page_range",
      "list_source_workspaces",
      "list_sources",
      "search_sources",
    ]);
    expect(tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
  });

  it("reads a workspace and page through the studio-ai read grant", async () => {
    client = await connect();
    const workspaces = payloadOf(await client.callTool({ name: "list_source_workspaces", arguments: {} }));
    expect(workspaces.workspaces).toEqual([
      { workspaceId: "studio:workspace-a", displayName: "理科資料", sourceCount: 1 },
    ]);

    const list = payloadOf(await client.callTool({
      name: "list_sources",
      arguments: { workspaceId: "studio:workspace-a" },
    }));
    const sources = list.sources as Array<Record<string, unknown>>;
    expect(sources[0]).toMatchObject({ name: "lesson.txt", pageCount: 1 });
    const sourceId = String(sources[0]?.sourceId);

    const page = payloadOf(await client.callTool({
      name: "get_source_page",
      arguments: { workspaceId: "studio:workspace-a", sourceId, pageNumber: 1 },
    }));
    expect(page.page).toMatchObject({ pageNumber: 1, text: "光合成には光と二酸化炭素が必要です。" });

    const range = payloadOf(await client.callTool({
      name: "get_source_page_range",
      arguments: { workspaceId: "studio:workspace-a", sourceId, startPage: 1, endPage: 1 },
    }));
    expect(range.pages).toHaveLength(1);

    const search = payloadOf(await client.callTool({
      name: "search_sources",
      arguments: { workspaceId: "studio:workspace-a", query: "光合成" },
    }));
    expect((search.hits as unknown[]).length).toBeGreaterThan(0);
  });

  it("fails closed for an unregistered workspace", async () => {
    client = await connect();
    const result = await client.callTool({
      name: "list_sources",
      arguments: { workspaceId: "studio:not-registered" },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("PERMISSION_DENIED");
  });
});
