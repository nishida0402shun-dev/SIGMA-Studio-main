import { app, dialog, ipcMain, type BrowserWindow } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { KnowledgeDbStore, type KnowledgeSemanticType } from "../knowledge-db-store";

const te = (message: string) => message;

export interface RegisterKnowledgeDbIpcDeps {
  getMainWindow: () => BrowserWindow | null;
  store: KnowledgeDbStore;
}

async function collectPdfFiles(paths: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const candidate of paths) {
    const stat = await fs.stat(candidate);
    if (stat.isDirectory()) {
      const entries = await fs.readdir(candidate, { withFileTypes: true });
      files.push(...await collectPdfFiles(entries.map((entry) => path.join(candidate, entry.name))));
    } else if (path.extname(candidate).toLowerCase() === ".pdf") {
      files.push(candidate);
    }
  }
  return files;
}

export function registerKnowledgeDbIpc(deps: RegisterKnowledgeDbIpcDeps): void {
  const { getMainWindow, store } = deps;

  ipcMain.handle("knowledge-db:choose-sources", async (event) => {
    if (event.sender !== getMainWindow()?.webContents) return null;
    const mainWindow = getMainWindow();
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "DBに追加",
      filters: [{ name: "PDF", extensions: ["pdf"] }],
      properties: ["openFile", "openDirectory", "multiSelections"],
    });
    if (result.canceled) return null;
    const paths = await collectPdfFiles(result.filePaths);
    return { paths };
  });

  ipcMain.handle("knowledge-db:list", async (event) => {
    if (event.sender !== getMainWindow()?.webContents) return [];
    return store.listSources();
  });

  ipcMain.handle("knowledge-db:import", async (event, filePaths: unknown) => {
    if (event.sender !== getMainWindow()?.webContents) return [];
    if (!Array.isArray(filePaths) || !filePaths.every((value) => typeof value === "string")) {
      throw new Error(te("invalid source paths"));
    }
    return store.addFiles(filePaths as string[]);
  });

  ipcMain.handle("knowledge-db:extract-pages", async (event, payload: unknown) => {
    if (event.sender !== getMainWindow()?.webContents) return null;
    if (!payload || typeof payload !== "object") throw new Error("invalid extraction request");
    const sourceId = "sourceId" in payload && typeof payload.sourceId === "string" ? payload.sourceId : "";
    const pages = "pageNumbers" in payload && Array.isArray(payload.pageNumbers)
      ? payload.pageNumbers.filter((value): value is number => Number.isInteger(value))
      : [];
    if (!sourceId || pages.length === 0) throw new Error("no pages selected");
    const bytes = await store.extractPages(sourceId, pages);
    const mainWindow = getMainWindow();
    if (!mainWindow) return null;
    const save = await dialog.showSaveDialog(mainWindow, {
      title: "選択ページをPDFとして抽出",
      defaultPath: "sigma-db-extract.pdf",
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (save.canceled || !save.filePath) return null;
    const output = save.filePath.toLowerCase().endsWith(".pdf") ? save.filePath : `${save.filePath}.pdf`;
    await fs.writeFile(output, bytes);
    return { filePath: output, pageCount: pages.length };
  });

  ipcMain.handle("knowledge-db:set-page-type", async (event, payload: unknown) => {
    if (event.sender !== getMainWindow()?.webContents) return null;
    if (!payload || typeof payload !== "object") throw new Error("invalid page metadata");
    const sourceId = "sourceId" in payload && typeof payload.sourceId === "string" ? payload.sourceId : "";
    const pageNumber = "pageNumber" in payload && typeof payload.pageNumber === "number" ? payload.pageNumber : 0;
    const semanticType = "semanticType" in payload && typeof payload.semanticType === "string"
      ? payload.semanticType as KnowledgeSemanticType
      : "unknown";
    const title = "title" in payload && typeof payload.title === "string" ? payload.title : undefined;
    return store.updatePageSemanticType(sourceId, pageNumber, semanticType, title);
  });
}
