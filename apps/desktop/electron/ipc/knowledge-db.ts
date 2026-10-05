/* eslint-disable no-restricted-syntax -- Native Knowledge DB picker titles are intentionally localized at the Electron boundary. */
import { dialog, ipcMain, shell, type BrowserWindow } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { KnowledgeDbStore, type KnowledgeSemanticType } from "../knowledge-db-store";

const te = (message: string) => message;

export interface RegisterKnowledgeDbIpcDeps {
  getMainWindow: () => BrowserWindow | null;
  store: KnowledgeDbStore;
}

async function collectSourceFiles(paths: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const candidate of paths) {
    const stat = await fs.stat(candidate);
    if (stat.isDirectory()) {
      const entries = await fs.readdir(candidate, { withFileTypes: true });
      files.push(...await collectSourceFiles(entries.map((entry) => path.join(candidate, entry.name))));
    } else if (stat.isFile()) {
      files.push(candidate);
    }
  }
  return files;
}

export function registerKnowledgeDbIpc(deps: RegisterKnowledgeDbIpcDeps): void {
  const { getMainWindow, store } = deps;

  async function chooseSourcePaths(
    event: Electron.IpcMainInvokeEvent,
    properties: Electron.OpenDialogOptions["properties"],
    title: string,
  ): Promise<{ paths: string[] } | null> {
    if (event.sender !== getMainWindow()?.webContents) return null;
    const mainWindow = getMainWindow();
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, { title, properties });
    if (result.canceled) return null;
    return { paths: await collectSourceFiles(result.filePaths) };
  }

  ipcMain.handle("knowledge-db:choose-files", (event) =>
    chooseSourcePaths(event, ["openFile", "multiSelections"], "Knowledge DBにファイルを追加"),
  );

  ipcMain.handle("knowledge-db:choose-folder", (event) =>
    chooseSourcePaths(event, ["openDirectory"], "Knowledge DBにフォルダを追加"),
  );

  // Legacy mixed picker kept for compatibility with older renderer builds.
  ipcMain.handle("knowledge-db:choose-sources", (event) =>
    chooseSourcePaths(event, ["openFile", "openDirectory", "multiSelections"], "Add to DB"),
  );

  ipcMain.handle("knowledge-db:pdf-import-preview", async (event, payload: unknown) => {
    if (event.sender !== getMainWindow()?.webContents) return null;
    const filePath = payload && typeof payload === "object" && "filePath" in payload && typeof payload.filePath === "string" ? payload.filePath : "";
    if (!filePath) throw new Error("invalid PDF file path");
    return store.previewPdfImport(filePath);
  });

  ipcMain.handle("knowledge-db:pdf-import-staging-get", async (event, stagingId: string) => {
    if (event.sender !== getMainWindow()?.webContents) return null;
    return store.getPdfImportStaging(stagingId);
  });

  ipcMain.handle("knowledge-db:pdf-import-staging-list", async (event) => {
    if (event.sender !== getMainWindow()?.webContents) return [];
    return store.listPdfImportStaging();
  });

  ipcMain.handle("knowledge-db:pdf-import-staging-update", async (event, payload: unknown) => {
    if (event.sender !== getMainWindow()?.webContents) return null;
    if (!payload || typeof payload !== "object") throw new Error("invalid PDF staging payload");
    const stagingId = "stagingId" in payload && typeof payload.stagingId === "string" ? payload.stagingId : "";
    const segments = "segments" in payload && Array.isArray(payload.segments) ? payload.segments : [];
    if (!stagingId) throw new Error("invalid staging id");
    return store.updatePdfImportStaging({ stagingId, segments });
  });

  ipcMain.handle("knowledge-db:pdf-import-staging-approve", async (event, stagingId: string) => {
    if (event.sender !== getMainWindow()?.webContents) return null;
    return store.approvePdfImport(stagingId);
  });

  ipcMain.handle("knowledge-db:pdf-import-staging-reject", async (event, stagingId: string) => {
    if (event.sender !== getMainWindow()?.webContents) return null;
    return store.rejectPdfImport(stagingId);
  });

  ipcMain.handle("knowledge-db:index-status", async (event) => {
    if (event.sender !== getMainWindow()?.webContents) return { state: "idle", total: 0, completed: 0 };
    return store.getIndexStatus();
  });

  ipcMain.handle("knowledge-db:analysis-status", async (event) => {
    if (event.sender !== getMainWindow()?.webContents) return null;
    return store.getAnalysisStatus();
  });

  ipcMain.handle("knowledge-db:reanalyze", async (event, payload: unknown) => {
    if (event.sender !== getMainWindow()?.webContents) return null;
    const sourceIds = payload && typeof payload === "object" && "sourceIds" in payload && Array.isArray(payload.sourceIds)
      ? payload.sourceIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : undefined;
    return store.reanalyze(sourceIds);
  });

  ipcMain.handle("knowledge-db:index-start", async (event) => {
    if (event.sender !== getMainWindow()?.webContents) return { state: "idle", total: 0, completed: 0 };
    return store.startBackgroundIndexing();
  });

  ipcMain.handle("knowledge-db:structure-status", async (event) => {
    if (event.sender !== getMainWindow()?.webContents) return { available: false, engine: null, pythonPath: null };
    return store.getStructureParserStatus();
  });

  ipcMain.handle("knowledge-db:list", async (event) => {
    if (event.sender !== getMainWindow()?.webContents) return [];
    return store.listSources();
  });

  ipcMain.handle("knowledge-db:import", async (event, payload: unknown) => {
    if (event.sender !== getMainWindow()?.webContents) return [];
    if (!payload || typeof payload !== "object") throw new Error(te("invalid source paths"));
    const filePaths = "paths" in payload && Array.isArray(payload.paths) ? payload.paths : [];
    if (!filePaths.every((value) => typeof value === "string")) throw new Error(te("invalid source paths"));
    const pdfPaths = (filePaths as string[]).filter((filePath) => filePath.toLowerCase().endsWith(".pdf"));
    if (pdfPaths.length > 0) {
      throw new Error("PDF files must go through the AI split/classification preview before Knowledge DB registration.");
    }
    return store.addFiles(filePaths as string[]);
  });

  ipcMain.handle("knowledge-db:delete-source", async (event, payload: unknown) => {
    if (event.sender !== getMainWindow()?.webContents) return { ok: false };
    const sourceId = payload && typeof payload === "object" && "sourceId" in payload && typeof payload.sourceId === "string" ? payload.sourceId.trim() : "";
    if (!sourceId) throw new Error("invalid source id");
    return { ok: await store.deleteSource(sourceId) };
  });

  ipcMain.handle("knowledge-db:related", async (event, payload: unknown) => {
    if (event.sender !== getMainWindow()?.webContents) return [];
    const sourceId = payload && typeof payload === "object" && "sourceId" in payload && typeof payload.sourceId === "string" ? payload.sourceId : "";
    const limit = payload && typeof payload === "object" && "limit" in payload && typeof payload.limit === "number" ? payload.limit : 6;
    if (!sourceId) throw new Error("invalid source id");
    return store.getRelatedSources(sourceId, limit);
  });

  ipcMain.handle("knowledge-db:get-page-pdf", async (event, payload: unknown) => {
    if (event.sender !== getMainWindow()?.webContents) return null;
    if (!payload || typeof payload !== "object") throw new Error("invalid page request");
    const sourceId = "sourceId" in payload && typeof payload.sourceId === "string" ? payload.sourceId : "";
    const pageNumber = "pageNumber" in payload && typeof payload.pageNumber === "number" ? payload.pageNumber : 0;
    if (!sourceId || !Number.isInteger(pageNumber) || pageNumber < 1) throw new Error("invalid page request");
    return store.getPagePdfBase64(sourceId, pageNumber);
  });

  ipcMain.handle("knowledge-db:extract-region", async (event, payload: unknown) => {
    if (event.sender !== getMainWindow()?.webContents) return null;
    if (!payload || typeof payload !== "object") throw new Error("invalid region request");
    const sourceId = "sourceId" in payload && typeof payload.sourceId === "string" ? payload.sourceId : "";
    const pageNumber = "pageNumber" in payload && typeof payload.pageNumber === "number" ? payload.pageNumber : 0;
    const rect = "rect" in payload && payload.rect && typeof payload.rect === "object" ? payload.rect : null;
    if (!sourceId || !Number.isInteger(pageNumber) || pageNumber < 1 || !rect) throw new Error("invalid region request");
    const x = "x" in rect && typeof rect.x === "number" ? rect.x : 0;
    const y = "y" in rect && typeof rect.y === "number" ? rect.y : 0;
    const width = "width" in rect && typeof rect.width === "number" ? rect.width : 0;
    const height = "height" in rect && typeof rect.height === "number" ? rect.height : 0;
    if (!(width > 0) || !(height > 0)) throw new Error("invalid region request");
    const filePath = await store.extractRegion(sourceId, pageNumber, { x, y, width, height });
    const error = await shell.openPath(filePath);
    return error ? { ok: false, error } : { ok: true, filePath };
  });

  ipcMain.handle("knowledge-db:open-page", async (event, payload: unknown) => {
    if (event.sender !== getMainWindow()?.webContents) return { ok: false };
    if (!payload || typeof payload !== "object") throw new Error("invalid page request");
    const sourceId = "sourceId" in payload && typeof payload.sourceId === "string" ? payload.sourceId : "";
    const pageNumber = "pageNumber" in payload && typeof payload.pageNumber === "number" ? payload.pageNumber : 0;
    if (!sourceId || !Number.isInteger(pageNumber) || pageNumber < 1) throw new Error("invalid page request");
    const filePath = await store.openPage(sourceId, pageNumber);
    const error = await shell.openPath(filePath);
    return error ? { ok: false, error } : { ok: true, filePath };
  });

  ipcMain.handle("knowledge-db:extract-pages", async (event, payload: unknown) => {
    if (event.sender !== getMainWindow()?.webContents) return null;
    if (!payload || typeof payload !== "object") throw new Error("invalid extraction request");
    const sourceId = "sourceId" in payload && typeof payload.sourceId === "string" ? payload.sourceId : "";
    const pages = "pageNumbers" in payload && Array.isArray(payload.pageNumbers)
      ? payload.pageNumbers.filter((value): value is number => Number.isInteger(value))
      : [];
    const selections = "selections" in payload && Array.isArray(payload.selections)
      ? payload.selections.flatMap((selection: unknown) => {
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
