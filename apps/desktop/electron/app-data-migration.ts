import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

const FORMAT_VERSION = 1;
const ARCHIVE_PREFIX = "sigma-studio-beta-migration";
const EXCLUDED_PARTS = new Set(["locks", "logs", "recovery", "opened-pages"]);

export async function exportMigrationArchive(userDataPath: string, outputPath: string, sourceVersion: string): Promise<void> {
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify({
    formatVersion: FORMAT_VERSION,
    source: "sigma-studio-beta",
    sourceVersion,
    exportedAt: new Date().toISOString(),
  }, null, 2));
  await addDirectory(zip, path.join(userDataPath, "data"), "data");
  await addDirectory(zip, path.join(userDataPath, "fonts"), "fonts");
  const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  await fs.writeFile(outputPath, bytes);
}

export async function backupCurrentData(userDataPath: string, outputPath: string): Promise<void> {
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify({
    formatVersion: FORMAT_VERSION,
    source: "sigma-studio-stable-backup",
    createdAt: new Date().toISOString(),
  }, null, 2));
  await addDirectory(zip, path.join(userDataPath, "data"), "data");
  await addDirectory(zip, path.join(userDataPath, "fonts"), "fonts");
  await fs.writeFile(outputPath, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } }));
}

export async function importMigrationArchive(userDataPath: string, archivePath: string): Promise<void> {
  const raw = await fs.readFile(archivePath);
  const zip = await JSZip.loadAsync(raw);
  const manifestEntry = zip.file("manifest.json");
  if (!manifestEntry) throw new Error("Sigma Studioの移行ファイルではありません。");
  const manifest = JSON.parse(await manifestEntry.async("text")) as { formatVersion?: unknown; source?: unknown };
  if (manifest.formatVersion !== FORMAT_VERSION || manifest.source !== "sigma-studio-beta") {
    throw new Error("対応していないSigma Studio Beta移行ファイルです。");
  }
  const root = path.resolve(userDataPath);
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || entry.name === "manifest.json") continue;
    const relative = normalizeArchivePath(entry.name);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("移行ファイルに不正なパスが含まれています。");
    const target = path.resolve(root, relative);
    if (!target.startsWith(root + path.sep)) throw new Error("移行ファイルの展開先が不正です。");
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, await entry.async("nodebuffer"));
  }
}

export function defaultMigrationFileName(version: string): string {
  return ARCHIVE_PREFIX + "-" + version + "-" + new Date().toISOString().slice(0, 10) + ".zip";
}

async function addDirectory(zip: JSZip, sourceDir: string, archiveRoot: string): Promise<void> {
  let entries;
  try { entries = await fs.readdir(sourceDir, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  for (const entry of entries) {
    if (EXCLUDED_PARTS.has(entry.name)) continue;
    const sourcePath = path.join(sourceDir, entry.name);
    const archivePath = archiveRoot + "/" + entry.name;
    if (entry.isDirectory()) await addDirectory(zip, sourcePath, archivePath);
    else if (entry.isFile()) zip.file(archivePath, await fs.readFile(sourcePath));
  }
}

function normalizeArchivePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\/+/, "");
}
