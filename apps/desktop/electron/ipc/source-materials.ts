import { dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import path from "node:path";

import { createCurrentLocaleTranslator } from "@/lib/i18n";
import type {
  SourceMaterialFailure,
  SourceMaterialImportItem,
  SourceMaterialImportResult,
  SourceMaterialResult,
} from "@/features/source-material/types";

import {
  SourceMaterialError,
  SourceMaterialService,
  toSourceMaterialError,
} from "../source-material/source-material-service";

export interface RegisterSourceMaterialIpcDeps {
  getMainWindow: () => BrowserWindow | null;
  getService: () => SourceMaterialService;
}

const te = createCurrentLocaleTranslator("error");

function failure(error: unknown): SourceMaterialFailure {
  const normalized = toSourceMaterialError(error);
  return { code: normalized.code, message: normalized.message };
}

function requireString(value: unknown, message: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new SourceMaterialError("INVALID_INPUT", message);
  }
  return value;
}

function requirePageNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new SourceMaterialError("INVALID_PAGE_NUMBER", te("electron.sourceMaterial.invalidPageNumber"));
  }
  return value;
}

function assertTrustedSender(event: IpcMainInvokeEvent, getMainWindow: () => BrowserWindow | null): void {
  const window = getMainWindow();
  if (!window || event.sender !== window.webContents) {
    throw new SourceMaterialError("UNAUTHORIZED_RENDERER", te("electron.sourceMaterial.unauthorizedRenderer"));
  }
}

async function run<T>(operation: () => T | Promise<T>): Promise<SourceMaterialResult<T>> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    return { ok: false, error: failure(error) };
  }
}

export function registerSourceMaterialIpc(deps: RegisterSourceMaterialIpcDeps): void {
  const { getMainWindow, getService } = deps;

  ipcMain.handle("source-materials:workspace-status", (event, studioWorkspaceId: unknown) => {
    assertTrustedSender(event, getMainWindow);
    return run(() => getService().getWorkspaceStatus(requireString(studioWorkspaceId, te("electron.sourceMaterial.workspaceIdRequired"))));
  });

  ipcMain.handle("source-materials:register-workspace", (
    event,
    studioWorkspaceId: unknown,
    displayName: unknown,
  ) => {
    assertTrustedSender(event, getMainWindow);
    return run(() => getService().registerWorkspace(
      requireString(studioWorkspaceId, te("electron.sourceMaterial.workspaceIdRequired")),
      requireString(displayName, te("electron.sourceMaterial.displayNameRequired")),
    ));
  });

  ipcMain.handle("source-materials:list", (event, studioWorkspaceId: unknown) => {
    assertTrustedSender(event, getMainWindow);
    return run(() => getService().listSources(requireString(studioWorkspaceId, te("electron.sourceMaterial.workspaceIdRequired"))));
  });

  ipcMain.handle("source-materials:import", async (event, studioWorkspaceId: unknown) => {
    assertTrustedSender(event, getMainWindow);
    const window = getMainWindow();
    if (!window) {
      return { ok: false, error: { code: "WINDOW_UNAVAILABLE", message: te("electron.sourceMaterial.windowUnavailable") } };
    }
    const workspaceId = requireString(studioWorkspaceId, te("electron.sourceMaterial.workspaceIdRequired"));
    const selection = await dialog.showOpenDialog(window, {
      title: te("electron.sourceMaterial.addFilesTitle"),
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: te("electron.sourceMaterial.filesFilter"), extensions: ["pdf", "txt", "md", "markdown", "csv"] },
        { name: te("electron.sourceMaterial.allFilesFilter"), extensions: ["*"] },
      ],
    });
    if (selection.canceled) {
      const result: SourceMaterialImportResult = { canceled: true, items: [] };
      return { ok: true, value: result };
    }

    const service = getService();
    const items: SourceMaterialImportItem[] = [];
    for (const filePath of selection.filePaths) {
      try {
        const outcome = await service.importFile(workspaceId, filePath);
        items.push({
          fileName: path.basename(filePath),
          filePath,
          ok: true,
          source: outcome.source,
          duplicate: outcome.duplicate,
        });
      } catch (error) {
        items.push({
          fileName: path.basename(filePath),
          filePath,
          ok: false,
          error: failure(error),
        });
      }
    }
    const result: SourceMaterialImportResult = { canceled: false, items };
    return { ok: true, value: result };
  });

  ipcMain.handle("source-materials:get-bytes", (event, studioWorkspaceId: unknown, sourceId: unknown) => {
    assertTrustedSender(event, getMainWindow);
    return run(() => getService().getFileBytes(
      requireString(studioWorkspaceId, te("electron.sourceMaterial.workspaceIdRequired")),
      requireString(sourceId, te("electron.sourceMaterial.sourceIdRequired")),
    ));
  });

  ipcMain.handle("source-materials:get-page", (
    event,
    studioWorkspaceId: unknown,
    sourceId: unknown,
    pageNumber: unknown,
  ) => {
    assertTrustedSender(event, getMainWindow);
    return run(() => getService().getPage(
      requireString(studioWorkspaceId, te("electron.sourceMaterial.workspaceIdRequired")),
      requireString(sourceId, te("electron.sourceMaterial.sourceIdRequired")),
      requirePageNumber(pageNumber),
    ));
  });

  ipcMain.handle("source-materials:get-page-image", (
    event,
    studioWorkspaceId: unknown,
    sourceId: unknown,
    pageNumber: unknown,
    scale: unknown,
  ) => {
    assertTrustedSender(event, getMainWindow);
    return run(() => getService().getPageImage(
      requireString(studioWorkspaceId, te("electron.sourceMaterial.workspaceIdRequired")),
      requireString(sourceId, te("electron.sourceMaterial.sourceIdRequired")),
      requirePageNumber(pageNumber),
      typeof scale === "number" && Number.isFinite(scale) ? scale : 1.5,
    ));
  });

  ipcMain.handle("source-materials:get-page-range", (
    event,
    studioWorkspaceId: unknown,
    sourceId: unknown,
    startPage: unknown,
    endPage: unknown,
  ) => {
    assertTrustedSender(event, getMainWindow);
    return run(() => getService().getPageRange(
      requireString(studioWorkspaceId, te("electron.sourceMaterial.workspaceIdRequired")),
      requireString(sourceId, te("electron.sourceMaterial.sourceIdRequired")),
      requirePageNumber(startPage),
      requirePageNumber(endPage),
    ));
  });

  ipcMain.handle("source-materials:get-extraction-info", (
    event,
    studioWorkspaceId: unknown,
    sourceId: unknown,
  ) => {
    assertTrustedSender(event, getMainWindow);
    return run(() => getService().getExtractionInfo(
      requireString(studioWorkspaceId, te("electron.sourceMaterial.workspaceIdRequired")),
      requireString(sourceId, te("electron.sourceMaterial.sourceIdRequired")),
    ));
  });

  ipcMain.handle("source-materials:search", (
    event,
    studioWorkspaceId: unknown,
    query: unknown,
    limit: unknown,
  ) => {
    assertTrustedSender(event, getMainWindow);
    return run(() => getService().search(
      requireString(studioWorkspaceId, te("electron.sourceMaterial.workspaceIdRequired")),
      requireString(query, te("electron.sourceMaterial.queryRequired")),
      typeof limit === "number" ? limit : 12,
    ));
  });

  ipcMain.handle("source-materials:delete", (event, studioWorkspaceId: unknown, sourceId: unknown) => {
    assertTrustedSender(event, getMainWindow);
    return run(() => ({
      deleted: getService().deleteSource(
        requireString(studioWorkspaceId, te("electron.sourceMaterial.workspaceIdRequired")),
        requireString(sourceId, te("electron.sourceMaterial.sourceIdRequired")),
      ),
    }));
  });

  ipcMain.handle("source-materials:restore", (event, studioWorkspaceId: unknown, sourceId: unknown) => {
    assertTrustedSender(event, getMainWindow);
    return run(() => ({
      restored: getService().restoreSource(
        requireString(studioWorkspaceId, te("electron.sourceMaterial.workspaceIdRequired")),
        requireString(sourceId, te("electron.sourceMaterial.sourceIdRequired")),
      ),
    }));
  });
}
