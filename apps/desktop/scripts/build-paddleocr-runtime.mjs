#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

const platform = process.env.SIGMA_OCR_PLATFORM || (process.platform === "win32" ? "win" : process.platform === "darwin" ? "mac" : process.platform);
const arch = process.env.SIGMA_OCR_ARCH || (process.arch === "arm64" ? "arm64" : "x64");
const root = resolve(process.cwd(), "ocr-runtime", platform, arch);
const work = resolve(process.cwd(), ".ocr-runtime-build");
const python = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");

if (!["win", "mac"].includes(platform) || !["x64", "arm64"].includes(arch)) {
  throw new Error(`Unsupported OCR runtime target: ${platform}/${arch}`);
}
if (platform === "mac" && arch === "x64") {
  throw new Error("PaddlePaddle does not provide a current macOS x64 wheel; build the macOS arm64 runtime instead.");
}

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
mkdirSync(root, { recursive: true });

const runner = `import json, sys
from paddleocr import PPStructureV3

pdf_path = sys.argv[1]
out_path = sys.argv[2]
pipeline = PPStructureV3(
    lang="japan",
    use_doc_orientation_classify=False,
    use_doc_unwarping=False,
    use_textline_orientation=True,
)
results = pipeline.predict(pdf_path)
pages = []
for index, result in enumerate(results, 1):
    data = result.json if hasattr(result, "json") else {}
    if callable(data):
        data = data()
    if isinstance(data, str):
        data = json.loads(data)
    if not isinstance(data, dict):
        data = {}
    pages.append({"pageNumber": index, "result": data})
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(pages, f, ensure_ascii=False)
`;
const packageHelper = `import importlib.metadata
import subprocess
import sys
import paddlex

deps_all = list(paddlex.utils.deps.BASE_DEP_SPECS.keys())
deps_need = [dist.metadata["Name"] for dist in importlib.metadata.distributions() if dist.metadata["Name"] in deps_all]
cmd = ["pyinstaller", sys.argv[1], "--collect-data", "paddlex", "--collect-binaries", "paddle"]
for dep in deps_need:
    cmd += ["--copy-metadata", dep]
print("PyInstaller command:", " ".join(cmd))
subprocess.run(cmd, check=True)
`;
const runnerPath = join(work, "sigma_ocr.py");
const packagePath = join(work, "package.py");
writeFileSync(runnerPath, runner, "utf8");
writeFileSync(packagePath, packageHelper, "utf8");

execFileSync(python, ["-m", "pip", "install", "--upgrade", "pip"], { stdio: "inherit" });
execFileSync(python, ["-m", "pip", "install", "paddlepaddle==3.3.0", "paddleocr[doc-parser]", "pyinstaller"], { stdio: "inherit" });
execFileSync(python, ["package.py", "sigma_ocr.py"], { cwd: work, stdio: "inherit" });

const dist = join(work, "dist", "sigma-ocr");
if (!existsSync(dist)) throw new Error("PyInstaller did not produce sigma-ocr runtime.");
rmSync(root, { recursive: true, force: true });
execFileSync(process.platform === "win32" ? "xcopy" : "cp", process.platform === "win32" ? [dist, root, "/E", "/I", "/Y"] : ["-R", dist, root], { stdio: "inherit", shell: process.platform === "win32" });
console.log(`Built PP-StructureV3 runtime: ${root}`);
