import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
const electronDir=path.dirname(new URL(import.meta.url).pathname);
const root=path.resolve(electronDir,"../..");
const source=(relativePath:string)=>path.join(root,relativePath);
describe("SIGMA Studio v1 completion gate",()=>{
  it("has implementation anchors for all 16 roadmap phases",()=>{
    const required=["electron/preload.ts","electron/knowledge-db-store.ts","electron/knowledge-analysis-engine.ts","electron/knowledge-corpus-analysis.ts","electron/ai-edit-run-context.ts","electron/web-ai-bridge.ts","electron/web-ai-mcp-gateway.ts","electron/local-sigma-doc-store.ts","electron/local-sigma-doc-proposal-store.ts","electron/proposal-approval.ts","electron/app-updater.ts","src/app/content-security-policy.ts","scripts/electron-csp-smoke.mjs","tests/e2e/large-document-performance.spec.ts"];
    for(const relativePath of required) expect(existsSync(source(relativePath)),relativePath).toBe(true);
  });
  it("keeps the supported desktop release/test surface",()=>{
    const packageJson=JSON.parse(readFileSync(source("package.json"),"utf8")) as {scripts?:Record<string,string>};
    for(const script of ["typecheck","lint","test","test:e2e:electron","csp:smoke","electron:dist"]) expect(typeof packageJson.scripts?.[script],script).toBe("string");
  });
  it("keeps fail-closed AI boundary primitives",()=>{
    const permissionGate=readFileSync(source("electron/ai-permission-gate.ts"),"utf8");
    const gateway=readFileSync(source("electron/web-ai-mcp-gateway.ts"),"utf8");
    expect(permissionGate).toContain("return \"write\"");
    expect(permissionGate).toContain("consequential");
    expect(gateway).toContain("Select a SIGMA Workspace before using this Tool.");
    expect(gateway).toContain("Web AI Tool request was denied.");
  });
});