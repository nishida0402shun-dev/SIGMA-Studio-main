import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

import { SourceMaterialService } from "../electron/source-material/source-material-service";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronPath = createRequire(import.meta.url)("electron") as string;
const packaged = process.env.SIGMA_CORE_MCP_PACKAGED === "true";
const productName = /-beta\./.test((createRequire(import.meta.url)("../package.json") as { version: string }).version)
  ? "Sigma Studio Beta"
  : "Sigma Studio";
const packagedAppDir = process.env.SIGMA_CORE_MCP_PACKAGED_APP_DIR
  || path.join(desktopRoot, "release", "win-unpacked");
const packagedResources = path.join(packagedAppDir, "resources");
const serverPath = packaged
  ? path.join(packagedResources, "app.asar", "dist-electron", "sigma-core-mcp-server.cjs")
  : fileURLToPath(new URL("../dist-electron/sigma-core-mcp-server.cjs", import.meta.url));
const serverExecutable = packaged
  ? path.join(packagedAppDir, `${productName}.exe`)
  : process.platform === "win32"
    ? electronPath
    : process.execPath;

describe("bundled SIGMA Core MCP stdio integration", () => {
  let userDataDir: string | undefined;
  let client: Client | undefined;

  afterEach(async () => {
    try {
      await client?.close();
    } finally {
      client = undefined;
      if (userDataDir) {
        await fs.rm(userDataDir, { recursive: true, force: true });
        userDataDir = undefined;
      }
    }
  });

  it("fails visibly on stderr when a required Core data path is missing", async () => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV ?? "test",
      ELECTRON_RUN_AS_NODE: "1",
    };
    delete env.SIGMA_CORE_DB_PATH;
    delete env.SIGMA_CORE_BLOB_DIR;
    delete env.SIGMA_CORE_SUBJECT_ID;

    const child = spawn(serverExecutable, [serverPath], {
      cwd: desktopRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"] as const,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => resolve({ code, signal }));
      },
    );

    expect(exit.code).not.toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toContain("Missing required environment variable: SIGMA_CORE_DB_PATH");
  }, 15_000);

  it("launches the bundled Electron Node entrypoint and completes a read-only round-trip", async () => {
    if (packaged) {
      expect((await fs.stat(path.join(packagedResources, "app.asar"))).isFile()).toBe(true);
      expect((await fs.stat(serverExecutable)).isFile()).toBe(true);
    }

    userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "sigma-core-stdio-"));
    const dataDir = path.join(userDataDir, "data", "sigma-core");
    const databasePath = path.join(dataDir, "core.sqlite");
    const blobDirectory = path.join(dataDir, "blobs");

    // Seed the exact DB/blob directory contract used by SourceMaterialService.
    const sourceService = new SourceMaterialService(userDataDir);
    let imported: Awaited<ReturnType<SourceMaterialService["importBytes"]>>;
    try {
      sourceService.registerWorkspace("stdio-fixture", "stdio integration fixture");
      const fixtureBytes = Buffer.from("SIGMA Core MCP stdio round-trip fixture.", "utf8");
      imported = await sourceService.importBytes("stdio-fixture", {
        name: "fixture.txt",
        bytes: fixtureBytes,
      });
      const original = await sourceService.getFileBytes("stdio-fixture", imported.source.id);
      expect(Buffer.from(original.bytes)).toEqual(fixtureBytes);
    } finally {
      sourceService.close();
    }

    expect(await fs.stat(databasePath)).toBeDefined();
    expect(await fs.readdir(blobDirectory)).not.toHaveLength(0);

    const env = Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
    );
    Object.assign(env, {
      ELECTRON_RUN_AS_NODE: "1",
      SIGMA_CORE_DB_PATH: databasePath,
      SIGMA_CORE_BLOB_DIR: blobDirectory,
      SIGMA_CORE_SUBJECT_ID: "studio-ai",
    });

    const createTransport = () => new StdioClientTransport({
      command: serverExecutable,
      args: [serverPath],
      env,
    });
    client = new Client({ name: "sigma-studio-windows-integration", version: "1.0.0" });
    await client.connect(createTransport());

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

    const workspaceResult = await client.callTool({
      name: "list_source_workspaces",
      arguments: {},
    });
    expect(workspaceResult.isError).not.toBe(true);
    expect(JSON.stringify(workspaceResult.content)).toContain("studio:stdio-fixture");

    const listResult = await client.callTool({
      name: "list_sources",
      arguments: { workspaceId: "studio:stdio-fixture" },
    });
    expect(listResult.isError).not.toBe(true);
    const listContent: unknown = listResult.content;
    if (!Array.isArray(listContent)) throw new Error("MCP tool result did not contain a content array");
    const firstContent: unknown = listContent[0];
    if (
      typeof firstContent !== "object" ||
      firstContent === null ||
      !("text" in firstContent) ||
      typeof firstContent.text !== "string"
    ) {
      throw new Error("MCP tool result did not contain text content");
    }
    const listPayload = JSON.parse(firstContent.text) as {
      sources: Array<{ sourceId: string; name: string }>;
    };
    const source = listPayload.sources.find((item) => item.sourceId === imported.source.id);
    expect(source?.name).toBe("fixture.txt");

    const rangeResult = await client.callTool({
      name: "get_source_page_range",
      arguments: {
        workspaceId: "studio:stdio-fixture",
        sourceId: imported.source.id,
        startPage: 1,
        endPage: 1,
      },
    });
    expect(rangeResult.isError).not.toBe(true);
    expect(JSON.stringify(rangeResult.content)).toContain("SIGMA Core MCP stdio round-trip fixture.");

    const searchResult = await client.callTool({
      name: "search_sources",
      arguments: { workspaceId: "studio:stdio-fixture", query: "round-trip" },
    });
    expect(searchResult.isError).not.toBe(true);
    expect(JSON.stringify(searchResult.content)).toContain(imported.source.id);

    // There is intentionally no mutation tool in the exposed MCP surface.
    const mutationResult = await client.callTool({
      name: "delete_source",
      arguments: { workspaceId: "studio:stdio-fixture", sourceId: imported.source.id },
    });
    expect(mutationResult.isError).toBe(true);

    // Re-check that MCP used the same on-disk DB and blob directory seeded above.
    expect((await fs.stat(databasePath)).isFile()).toBe(true);
    expect(await fs.readdir(blobDirectory)).not.toHaveLength(0);

    await client.close();
    client = undefined;
    client = new Client({ name: "sigma-studio-core-restart-smoke", version: "1.0.0" });
    await client.connect(createTransport());
    const restoredResult = await client.callTool({
      name: "list_sources",
      arguments: { workspaceId: "studio:stdio-fixture" },
    });
    expect(restoredResult.isError).not.toBe(true);
    expect(JSON.stringify(restoredResult.content)).toContain(imported.source.id);
  }, 30_000);
});
