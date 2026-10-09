import { type BrowserWindow } from "electron";
import { ipcMain } from "../trusted-ipc";
import { ResearchSessionStore, type ResearchSourceReference } from "../research-session-store";

export interface RegisterResearchSessionIpcDeps {
  getMainWindow: () => BrowserWindow | null;
  store: ResearchSessionStore;
}

function authorized(event: Electron.IpcMainInvokeEvent, getMainWindow: () => BrowserWindow | null): boolean {
  return event.sender === getMainWindow()?.webContents;
}

export function registerResearchSessionIpc(deps: RegisterResearchSessionIpcDeps): void {
  const { getMainWindow, store } = deps;

  ipcMain.handle("research-session:list", async (event) => {
    if (!authorized(event, getMainWindow)) return [];
    return store.list();
  });

  ipcMain.handle("research-session:create", async (event, payload: unknown) => {
    if (!authorized(event, getMainWindow)) return null;
    if (!payload || typeof payload !== "object") throw new Error("invalid research session");
    const record = payload as Record<string, unknown>;
    const query = typeof record.query === "string" ? record.query.trim() : "";
    if (!query) throw new Error("research query is required");
    const title = typeof record.title === "string" ? record.title : undefined;
    const sourceReferences = Array.isArray(record.sourceReferences)
      ? record.sourceReferences.filter((item): item is ResearchSourceReference => Boolean(item && typeof item === "object"))
      : [];
    return store.create({ title, query, sourceReferences });
  });

  ipcMain.handle("research-session:update", async (event, payload: unknown) => {
    if (!authorized(event, getMainWindow)) return null;
    if (!payload || typeof payload !== "object") throw new Error("invalid research session update");
    const record = payload as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    if (!id) throw new Error("research session id is required");
    return store.update(id, {
      ...(typeof record.title === "string" ? { title: record.title } : {}),
      ...(typeof record.query === "string" ? { query: record.query } : {}),
      ...(Array.isArray(record.sourceReferences) ? { sourceReferences: record.sourceReferences as ResearchSourceReference[] } : {}),
    });
  });

  ipcMain.handle("research-session:delete", async (event, payload: unknown) => {
    if (!authorized(event, getMainWindow)) return { ok: false };
    const id = payload && typeof payload === "object" && "id" in payload && typeof payload.id === "string" ? payload.id.trim() : "";
    if (!id) throw new Error("research session id is required");
    return { ok: await store.remove(id) };
  });
}
