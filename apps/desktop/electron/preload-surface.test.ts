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

const electronSources = collectTypeScriptSources(electronDir).map((filePath) =>
  readFileSync(filePath, "utf8"),
);

const registeredIpcChannels = new Set(
  electronSources.flatMap((source) =>
    extractChannels(
      source,
      /ipcMain\.handle\(\s*["']([^"']+)["']/gu,
    ),
  ),
);

for (const source of electronSources) {
  for (const match of source.matchAll(/registerCliBinIpc\(\s*\{[\s\S]*?prefix:\s*["']([^"']+)["']/gu)) {
    for (const suffix of ["get-status", "set-bin", "select-bin", "open-install-page"]) {
      registeredIpcChannels.add(match[1] + ":" + suffix);
    }
  }
}


function extractBraceBlock(source: string, openingBraceIndex: number): string {
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;

  for (let index = openingBraceIndex; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(openingBraceIndex + 1, index);
    }
  }
  return "";
}

function extractTopLevelMethods(source: string, declarationPattern: RegExp, methodIndent: number): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const match of source.matchAll(declarationPattern)) {
    const name = match[1];
    const openingBraceIndex = source.indexOf("{", match.index ?? 0);
    if (openingBraceIndex < 0) continue;
    const block = extractBraceBlock(source, openingBraceIndex);
    const methods = [...block.matchAll(new RegExp(`^\\s{${methodIndent},${methodIndent}}([A-Za-z][A-Za-z0-9]*)\\??\\s*\\(`, "gmu"))].map(
      (method) => method[1],
    );
    result.set(name, new Set(methods));
  }
  return result;
}

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


  it("keeps every typed desktop API namespace and method backed by preload", () => {
    const typeSource = readFileSync(
      path.resolve(electronDir, "../src/types/desktop.d.ts"),
      "utf8",
    );
    const typedApis = extractTopLevelMethods(
      typeSource,
      /export interface (Desktop[A-Za-z0-9]+API) \{/gu,
      2,
    );
    const preloadApis = extractTopLevelMethods(
      preloadSource,
      /  ([A-Za-z][A-Za-z0-9]*): \{/gu,
      4,
    );

    for (const [interfaceName, methods] of typedApis) {
      if (interfaceName === "DesktopAPI") continue;
      const namespace = interfaceName.replace(/^Desktop/u, "").replace(/API$/u, "");
      const preloadMethods = preloadApis.get(namespace.charAt(0).toLowerCase() + namespace.slice(1));
      expect(preloadMethods, `missing preload namespace: ${namespace}`).toBeDefined();
      expect(
        [...methods].filter((method) => !preloadMethods?.has(method)),
        `missing preload methods in ${namespace}`,
      ).toEqual([]);
    }
  });

  it("keeps every preload invoke channel backed by a registered IPC handler", () => {
    const missingChannels = invokedPreloadChannels.filter(
      (channel) => !registeredIpcChannels.has(channel),
    );
    expect(missingChannels).toEqual([]);
  });
});
