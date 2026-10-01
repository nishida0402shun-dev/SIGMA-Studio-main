import { dialog, ipcMain, type BrowserWindow } from "electron";
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
      title: "Add to DB",
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
    const selections = "selections" in payload && Array.isArray(payload.selections)
      ? payload.selections.flatMap((selection) => {
          if (!selection || typeof selection !== "object") return [];
          const id = "sourceId" in selection && typeof selection.sourceId === "string" ? selection.sourceId : "";
          const pageNumbers = "pageNumbers" in selection && Array.isArray(selection.pageNumbers)
            ? selection.pageNumbers.filter((value): value is number => Number.isInteger(value))
            : [];
          return id && pageNumbers.length > 0 ? [{ sourceId: id, pageNumbers }] : [];
        })
      : [];

    const requestedSelections = selections.length > 0
      ? selections
      : sourceId && pages.length > 0
        ? [{ sourceId, pageNumbers: pages }]
        : [];
    if (requestedSelections.length === 0) throw new Error("no pages selected");
    const bytes = await store.extractSelectedPages(requestedSelections);
    const mainWindow = getMainWindow();
    if (!mainWindow) return null;
    const save = await dialog.showSaveDialog(mainWindow, {
      title: "Extract selected pages as PDF",
      defaultPath: "sigma-db-extract.pdf",
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (save.canceled || !save.filePath) return null;
    const output = save.filePath.toLowerCase().endsWith(".pdf") ? save.filePath : `${save.filePath}.pdf`;
    await fs.writeFile(output, bytes);
    const pageCount = requestedSelections.reduce((sum, selection) => sum + selection.pageNumbers.length, 0);
    return { filePath: output, pageCount };
  });

  ipcMain.handle("knowledge-db:search", async (event, payload: unknown) => {
    if (event.sender !== getMainWindow()?.webContents) return [];
    const query = payload && typeof payload === "object" && "query" in payload && typeof payload.query === "string"
      ? payload.query
      : "";
    const limit = payload && typeof payload === "object" && "limit" in payload && typeof payload.limit === "number"
      ? payload.limit
      : 12;
    if (!query.trim()) return [];
    return store.search(query, limit);
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
