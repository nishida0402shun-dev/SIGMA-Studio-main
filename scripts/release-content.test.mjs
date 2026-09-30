import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createPackage } = require("@electron/asar");
const { auditReleaseContent } = require("../apps/desktop/scripts/audit-release-content.cjs");
const environment = { RELEASE_CONTENT_RULES: JSON.stringify(["blocked-example"]), SIGMA_STUDIO_REQUIRE_RELEASE_AUDIT: "true" };

async function createFixtureArchive(resources, content, name = "app.asar") {
  const source = await mkdtemp(path.join(os.tmpdir(), "sigma-audit-source-"));
  try {
    await writeFile(path.join(source, "main.js"), content);
    await createPackage(source, path.join(resources, name));
  } finally {
    await rm(source, { recursive: true, force: true });
  }
}

test("release audit checks archive contents and unpacked resources without exposing matches", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sigma-audit-"));
  try {
    const resources = path.join(root, "resources");
    await mkdir(resources);

    await createFixtureArchive(resources, "export const value = 1;");
    await auditReleaseContent(resources, environment);

    await rm(path.join(resources, "app.asar"), { force: true });
    await createFixtureArchive(resources, "blocked-example");
    await assert.rejects(auditReleaseContent(resources, environment), (error) => {
      assert.match(error.message, /Release content audit failed/);
      assert.doesNotMatch(error.message, /blocked-example|main.js/);
      return true;
    });

    await rm(path.join(resources, "app.asar"), { force: true });
    await createFixtureArchive(resources, "safe");
    await writeFile(path.join(resources, "extra.txt"), "blocked-example");
    await assert.rejects(auditReleaseContent(resources, environment), /Release content audit failed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release audit fails closed for missing or malformed configuration", async () => {
  await assert.rejects(auditReleaseContent("unused", { SIGMA_STUDIO_REQUIRE_RELEASE_AUDIT: "true" }), /required/);
  for (const value of ["[]", "invalid", '["["]', '[null]']) {
    await assert.rejects(auditReleaseContent("unused", { ...environment, RELEASE_CONTENT_RULES: value }), /configuration is invalid/);
  }
});
