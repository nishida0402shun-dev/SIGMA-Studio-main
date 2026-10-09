import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const workflowPath = fileURLToPath(new URL("../.github/workflows/release.yml", import.meta.url));
const workflow = readFileSync(workflowPath, "utf8");
const matrixJob = workflow.split("\n  publish:\n")[0];
const publishJob = workflow.split("\n  publish:\n")[1] ?? "";

test("platform builds never publish releases independently", () => {
  assert.match(matrixJob, /electron-builder --\$\{\{ matrix\.platform \}\} --publish never/);
  assert.doesNotMatch(matrixJob, /electron-builder[^\n]*--publish always/);
  assert.match(matrixJob, /actions\/upload-artifact@v4/);
});

test("a single publish job waits for both platform builds", () => {
  assert.match(publishJob, /needs: \[prepare, release\]/);
  assert.equal((publishJob.match(/gh release create /g) ?? []).length, 2,
    "stable and beta branches must create releases only in the single publisher job");
  assert.match(publishJob, /gh release upload .*--clobber/);
});

test("publishing requires update metadata from both macOS and Windows", () => {
  assert.match(publishJob, /test -f release-assets\/final\/latest\.yml/);
  assert.match(publishJob, /test -f release-assets\/final\/latest-mac\.yml/);
  assert.match(publishJob, /Duplicate release asset basename/);
});
