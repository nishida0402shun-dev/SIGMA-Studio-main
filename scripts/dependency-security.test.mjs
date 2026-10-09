import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { patchSource } from "./patch-http-cache-semantics.mjs";

const require = createRequire(new URL("../apps/desktop/package.json", import.meta.url));
// Resolve through the actual build-tool dependency chain, including nested installs.
const builderRequire = createRequire(require.resolve("app-builder-lib/package.json"));
const getRequire = createRequire(builderRequire.resolve("@electron/get/package.json"));
const gotRequire = createRequire(getRequire.resolve("got/package.json"));
const cacheRequire = createRequire(gotRequire.resolve("cacheable-request/package.json"));
const CachePolicy = cacheRequire("http-cache-semantics");

const request = { url: "https://cache.example.invalid/account", headers: { host: "cache.example.invalid" } };
for (const [name, headers] of Object.entries({
  "shared Set-Cookie": { "set-cookie": "session=fixture; HttpOnly" },
  "proxy-revalidate": { "cache-control": "public, max-age=0, proxy-revalidate" },
  "no-cache": { "cache-control": "no-cache" },
  "private": { "cache-control": "private, max-age=3600" },
  "no-store": { "cache-control": "no-store" },
})) {
  for (const maxStale of ["max-stale", "max-stale=86400"]) {
    test(`build-tool cache refuses ${name} with ${maxStale}`, () => {
      const policy = new CachePolicy(request, { status: 200, headers }, { shared: true });
      assert.equal(policy.satisfiesWithoutRevalidation({
        ...request, headers: { ...request.headers, "cache-control": maxStale },
      }), false);
    });
  }
}

test("ordinary public cache entries remain reusable", () => {
  const policy = new CachePolicy(request, {
    status: 200, headers: { "cache-control": "public, max-age=3600" },
  }, { shared: true });
  assert.equal(policy.satisfiesWithoutRevalidation(request), true);
});

test("public opt-in and private-cache cookies keep their normal reuse behavior", () => {
  for (const shared of [true, false]) {
    const policy = new CachePolicy(request, {
      status: 200, headers: { "set-cookie": "session=fixture", "cache-control": "public, max-age=3600" },
    }, { shared });
    assert.equal(policy.satisfiesWithoutRevalidation(request), true);
  }
  const privatePolicy = new CachePolicy(request, {
    status: 200, headers: { "set-cookie": "session=fixture", "cache-control": "max-age=3600" },
  }, { shared: false });
  assert.equal(privatePolicy.satisfiesWithoutRevalidation(request), true);
});

test("max-stale still permits an ordinary expired public entry", () => {
  const now = Date.now();
  const policy = new CachePolicy(request, {
    status: 200, headers: { "cache-control": "public, max-age=1" },
  }, { shared: true });
  policy.now = () => now + 10_000;
  assert.equal(policy.satisfiesWithoutRevalidation(request), false);
  assert.equal(policy.satisfiesWithoutRevalidation({
    ...request, headers: { ...request.headers, "cache-control": "max-stale=60" },
  }), true);
});

test("cache patch is repeatable and refuses an unreviewed source change", () => {
  const installed = readFileSync(cacheRequire.resolve("http-cache-semantics"), "utf8");
  assert.equal(patchSource(installed), installed);
  assert.throws(() => patchSource(installed + "\n// unexpected change\n"), /Unexpected http-cache-semantics source/);
});

test("the builder downloader verifies bytes and reuses its artifact cache", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "sigma download cache "));
  const payload = Buffer.from("Sigma dependency verification fixture\n");
  const checksum = createHash("sha256").update(payload).digest("hex");
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.writeHead(200, { "content-length": payload.length });
    response.end(payload);
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { downloadArtifact } = builderRequire("@electron/get");
    const options = {
      version: "9.9.9", artifactName: "fixture.bin", isGeneric: true,
      cacheRoot: path.join(root, "cache"), tempDirectory: root,
      checksums: { "fixture.bin": checksum },
      mirrorOptions: { resolveAssetURL: async () => `http://127.0.0.1:${server.address().port}/fixture.bin` },
    };
    const downloaded = await downloadArtifact(options);
    assert.deepEqual(readFileSync(downloaded), payload);
    assert.equal(requests, 1);
    assert.equal(await downloadArtifact(options), downloaded);
    assert.equal(requests, 1);
    await assert.rejects(downloadArtifact({
      ...options, force: true, checksums: { "fixture.bin": "0".repeat(64) },
    }), /checksum/i);
  } finally {
    await new Promise(resolve => server.close(resolve));
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
