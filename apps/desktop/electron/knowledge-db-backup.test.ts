import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openQuestionEngineDatabase } from "../../../packages/question-engine/src/index";
import { KnowledgeDbStore } from "./knowledge-db-store";

describe("Knowledge DB backup/restore", () => {
  it("round-trips the shared SQLite database and source files", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "sigma-knowledge-backup-"));
    const backupDir = await fs.mkdtemp(path.join(os.tmpdir(), "sigma-knowledge-backup-out-"));
    const sourceDatabase = openQuestionEngineDatabase({ dataDir: path.join(dataDir, "knowledge-db") });
    let restoredDatabase: ReturnType<typeof openQuestionEngineDatabase> | undefined;
    try {
      const store = new KnowledgeDbStore(dataDir, sourceDatabase.raw);
      const sourceDir = path.join(dataDir, "input");
      await fs.mkdir(sourceDir, { recursive: true });
      await fs.writeFile(path.join(sourceDir, "note.md"), "三角関数の定理", "utf8");
      await store.addFiles([path.join(sourceDir, "note.md")]);
      await store.search("三角関数", 2);

      const backupPath = path.join(backupDir, "knowledge-db.zip");
      const created = await store.createBackup(backupPath);
      expect(created.fileCount).toBeGreaterThan(0);
      expect((await fs.stat(backupPath)).size).toBeGreaterThan(0);

      const secondDir = await fs.mkdtemp(path.join(os.tmpdir(), "sigma-knowledge-restore-"));
      restoredDatabase = openQuestionEngineDatabase({ dataDir: path.join(secondDir, "knowledge-db") });
      const restoredStore = new KnowledgeDbStore(secondDir, restoredDatabase.raw);
      const restored = await restoredStore.restoreBackup(backupPath);
      expect(restored.fileCount).toBeGreaterThan(0);
      const sources = await restoredStore.listSources();
      expect(sources).toHaveLength(1);
      expect(sources[0]?.pages[0]?.text).toContain("三角関数");
      expect(await fs.stat(sources[0]!.storedPath)).toBeTruthy();
      restoredDatabase.close();
      restoredDatabase = undefined;
      await fs.rm(secondDir, { recursive: true, force: true });
    } finally {
      sourceDatabase.close();
      restoredDatabase?.close();
      await fs.rm(dataDir, { recursive: true, force: true });
      await fs.rm(backupDir, { recursive: true, force: true });
    }
  });

  it("rejects zip-slip entries and archives without a SQLite database", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "sigma-knowledge-backup-slip-"));
    const backupPath = path.join(dataDir, "bad.zip");
    const database = openQuestionEngineDatabase({ dataDir: path.join(dataDir, "knowledge-db") });
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      zip.file("backup-manifest.json", JSON.stringify({ format: "sigma-knowledge-db-backup", version: 1 }));
      zip.file("../escape.txt", "no");
      await fs.writeFile(backupPath, await zip.generateAsync({ type: "nodebuffer" }));
      const store = new KnowledgeDbStore(dataDir, database.raw);
      await expect(store.restoreBackup(backupPath)).rejects.toThrow("Invalid Knowledge DB backup");
    } finally {
      database.close();
      await fs.rm(dataDir, { recursive: true, force: true });
    }
  });
});
