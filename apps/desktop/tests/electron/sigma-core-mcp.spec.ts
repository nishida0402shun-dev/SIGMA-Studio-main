import { existsSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { build } from "esbuild";
import { expect, test } from "@playwright/test";

const APP_ROOT = path.resolve(__dirname, "../..");
const CORE_SERVER = path.join(APP_ROOT, "dist-electron/sigma-core-mcp-server.cjs");
const require = createRequire(__filename);
const ELECTRON_EXECUTABLE = require("electron") as string;
const desktopPackage = require("../../package.json") as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const EXTERNAL_PACKAGES = [
  "electron",
  "better-sqlite3",
  ...Object.keys(desktopPackage.dependencies ?? {}),
  ...Object.keys(desktopPackage.devDependencies ?? {}),
];
const CORE_RUNTIME_EXECUTABLE = process.platform === "win32" ? ELECTRON_EXECUTABLE : process.execPath;
const WORKSPACE_ID = "studio:workspace-a";
const LESSON_TEXT = "光合成には光と二酸化炭素が必要です。";

async function waitForProcessClose(closed: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      closed,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("SIGMA Core MCP process did not shut down")), 15_000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function seedRegisteredSource(coreDataPath: string, userDataPath: string): Promise<void> {
  const seedBundlePath = path.join(userDataPath, "seed-sigma-core-mcp.cjs");
  await build({
    entryPoints: [path.join(APP_ROOT, "tests/electron/fixtures/seed-sigma-core-mcp.ts")],
    outfile: seedBundlePath,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    external: EXTERNAL_PACKAGES,
    define: { "import.meta.url": "__sigmaImportMetaUrl" },
    banner: {
      js: 'const __sigmaImportMetaUrl = require("node:url").pathToFileURL(__filename).href;',
    },
    logLevel: "silent",
  });
  const seed = require(seedBundlePath) as {
    seedRegisteredSource: (coreDataPath: string) => Promise<void>;
  };
  await seed.seedRegisteredSource(coreDataPath);
}

test("bundled SIGMA Core MCP initializes, lists read-only tools, and shuts down cleanly", async ({}, testInfo) => {
  test.skip(!existsSync(CORE_SERVER), "Run electron:build first.");

  const userDataPath = testInfo.outputPath("sigma-core-mcp-user-data");
  const coreDataPath = path.join(userDataPath, "data", "sigma-core");
  let transport: StdioClientTransport | undefined;
  let client: Client | undefined;
  let processClosed = false;
  let stderr = "";
  let closed: Promise<void> | undefined;

  try {
    await seedRegisteredSource(coreDataPath, userDataPath);

    const env = Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
    );
    if (process.platform === "win32") env.ELECTRON_RUN_AS_NODE = "1";
    else delete env.ELECTRON_RUN_AS_NODE;
    env.SIGMA_CORE_DB_PATH = path.join(coreDataPath, "core.sqlite");
    env.SIGMA_CORE_BLOB_DIR = path.join(coreDataPath, "blobs");
    env.SIGMA_CORE_SUBJECT_ID = "studio-ai";

    transport = new StdioClientTransport({
      command: CORE_RUNTIME_EXECUTABLE,
      args: [CORE_SERVER],
      cwd: APP_ROOT,
      env,
      stderr: "pipe",
    });
    client = new Client({ name: "sigma-studio-core-smoke", version: "1.0.0" }, { capabilities: {} });
    transport.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    closed = new Promise<void>((resolve) => {
      transport!.onclose = () => {
        processClosed = true;
        resolve();
      };
    });

    await client.connect(transport);
    expect(transport.pid).not.toBeNull();
    expect(client.getServerVersion()).toMatchObject({ name: "sigma-core-local", version: "1.0.0" });

    const { tools } = await client.listTools();
    const listWorkspaces = tools.find((tool) => tool.name === "list_source_workspaces");
    expect(listWorkspaces?.annotations?.readOnlyHint).toBe(true);
    expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      "list_sources",
      "search_sources",
      "get_source",
      "get_source_page",
      "get_source_page_range",
    ]));

    const workspacesResult = await client.callTool({
      name: "list_source_workspaces",
      arguments: {},
    }) as CallToolResult;
    expect(workspacesResult.isError).not.toBe(true);
    const workspaceText = workspacesResult.content.find((item) => item.type === "text");
    expect(workspaceText?.type).toBe("text");
    expect(JSON.parse(workspaceText!.text)).toEqual({
      workspaces: [{ workspaceId: WORKSPACE_ID, displayName: "理科資料", sourceCount: 1 }],
    });

    const sourcesResult = await client.callTool({
      name: "list_sources",
      arguments: { workspaceId: WORKSPACE_ID },
    }) as CallToolResult;
    expect(sourcesResult.isError).not.toBe(true);
    const sourcesText = sourcesResult.content.find((item) => item.type === "text");
    expect(sourcesText?.type).toBe("text");
    const sources = JSON.parse(sourcesText!.text).sources as Array<Record<string, unknown>>;
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ workspaceId: WORKSPACE_ID, name: "lesson.txt", pageCount: 1 });
    const sourceId = String(sources[0]?.sourceId);

    const searchResult = await client.callTool({
      name: "search_sources",
      arguments: { workspaceId: WORKSPACE_ID, query: "光合成" },
    }) as CallToolResult;
    expect(searchResult.isError).not.toBe(true);
    const searchText = searchResult.content.find((item) => item.type === "text");
    expect(searchText?.type).toBe("text");
    const hits = JSON.parse(searchText!.text).hits as Array<Record<string, unknown>>;
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]).toMatchObject({ sourceId, sourceName: "lesson.txt", pageNumber: 1 });

    const pageResult = await client.callTool({
      name: "get_source_page",
      arguments: { workspaceId: WORKSPACE_ID, sourceId, pageNumber: 1 },
    }) as CallToolResult;
    expect(pageResult.isError).not.toBe(true);
    const pageText = pageResult.content.find((item) => item.type === "text");
    expect(pageText?.type).toBe("text");
    expect(JSON.parse(pageText!.text).page).toMatchObject({ pageNumber: 1, text: LESSON_TEXT });

    const rangeResult = await client.callTool({
      name: "get_source_page_range",
      arguments: { workspaceId: WORKSPACE_ID, sourceId, startPage: 1, endPage: 1 },
    }) as CallToolResult;
    expect(rangeResult.isError).not.toBe(true);
    const rangeText = rangeResult.content.find((item) => item.type === "text");
    expect(rangeText?.type).toBe("text");
    expect(JSON.parse(rangeText!.text).pages).toMatchObject([
      { pageNumber: 1, text: LESSON_TEXT },
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}${stderr ? `\nSIGMA Core stderr:\n${stderr}` : ""}`, { cause: error });
  } finally {
    let shutdownError: unknown;
    try {
      await client?.close();
    } catch (error) {
      shutdownError = error;
    } finally {
      if (transport && closed && !processClosed) {
        const pid = transport.pid;
        if (pid !== null) {
          try {
            process.kill(pid, "SIGTERM");
          } catch (error) {
            if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") {
              shutdownError ??= error;
            }
          }
        }
        try {
          await waitForProcessClose(closed);
        } catch (error) {
          shutdownError ??= error;
          const remainingPid = transport.pid;
          if (remainingPid !== null) {
            try {
              process.kill(remainingPid, "SIGKILL");
            } catch (error) {
              if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") {
                shutdownError ??= error;
              }
            }
          }
          try {
            await waitForProcessClose(closed);
          } catch (forcedError) {
            shutdownError ??= forcedError;
          }
        }
      }
      rmSync(userDataPath, { recursive: true, force: true });
    }
    expect(existsSync(userDataPath)).toBe(false);
    if (transport) expect(processClosed).toBe(true);
    if (shutdownError) throw shutdownError;
  }
});
