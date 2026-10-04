import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const electronDir = fileURLToPath(new URL(".", import.meta.url));
const preloadSource = readFileSync(path.join(electronDir, "preload.ts"), "utf8");

function collectTypeScriptSources(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTypeScriptSources(entryPath));
    } else if (
      entry.isFile() &&
      /\.tsx?$/u.test(entry.name) &&
      !/\.test\.tsx?$/u.test(entry.name)
    ) {
      files.push(entryPath);
    }
  }
  return files;
}

function extractChannels(source: string, expression: RegExp): string[] {
  return [...source.matchAll(expression)]
    .map((match) => match[1])
    .filter((channel): channel is string => Boolean(channel));
}

const registeredIpcChannels = new Set(
  collectTypeScriptSources(electronDir).flatMap((filePath) =>
    extractChannels(
      readFileSync(filePath, "utf8"),
      /ipcMain\.handle\(\s*["'`]([^"'`]+)["'`]/gu,
    ),
  ),
);

const invokedPreloadChannels = extractChannels(
  preloadSource,
  /ipcRenderer\.invoke\(\s*["'`]([^"'`]+)["'`]/gu,
);

describe("preload bridge surface", () => {
  it("does not expose cloud workspace IPC channels", () => {
    expect(preloadSource).not.toMatch(/cloud-workspace:/u);
    expect(preloadSource).not.toMatch(/cloudWorkspace/u);
  });

  it("does not expose auth redirect or auth callback helpers", () => {
    expect(preloadSource).not.toMatch(/getRedirectUrl/u);
    expect(preloadSource).not.toMatch(/auth:/u);
  });

  it("keeps the external link bridge used by AI login and reference links", () => {
    expect(preloadSource).toMatch(/shell:open-external/u);
  });

  it("exposes the UI locale setter on the settings namespace", () => {
    // 新チャンネルは既存の `settings:` 接頭辞に揃える。`auth:` 禁止パターンに
    // 引っかからず、preload の面が settings に一本化されるため。
    expect(preloadSource).toMatch(/settings:set-ui-locale/u);
    expect(preloadSource).toMatch(/setUiLocale/u);
  });

  it("exposes the workspace preview disk cache bridge", () => {
    expect(preloadSource).toMatch(/workspace-preview:get/u);
    expect(preloadSource).toMatch(/workspace-preview:put/u);
  });

  it("exposes the Knowledge DB structure parser status bridge", () => {
    expect(preloadSource).toMatch(/knowledge-db:structure-status/u);
    expect(preloadSource).toMatch(/getStructureParserStatus/u);
  });
});
