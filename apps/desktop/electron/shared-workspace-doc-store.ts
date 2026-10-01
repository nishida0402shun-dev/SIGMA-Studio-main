import { LocalSigmaDocStore, type LocalDocumentMetadata, type LocalStorageResult, type LocalStoreChangeEvent, type LocalWorkspaceOverviewResult, type LocalWorkspaceState, type DocumentVersionMetadata } from "./local-sigma-doc-store";
import type { SigmaDocument } from "@/features/document";
import type { DocumentVersion, DocumentVersionOrigin } from "@/lib/document-version-history";

const SHARED_WORKSPACE_PREFIX = "shared:";
const SHARED_FILE_PREFIX = "shared:";

function isSharedId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(SHARED_WORKSPACE_PREFIX);
}

function rawId(id: string): string {
  return id.slice(SHARED_WORKSPACE_PREFIX.length);
}

function mapSharedFile(file: LocalDocumentMetadata): LocalDocumentMetadata {
  return {
    ...file,
    fileId: SHARED_FILE_PREFIX + file.fileId,
    workspaceId: SHARED_WORKSPACE_PREFIX + file.workspaceId,
  };
}

function mapSharedOverview(result: LocalWorkspaceOverviewResult): LocalWorkspaceOverviewResult {
  if (result.state !== "ready") return result;
  return {
    state: "ready",
    overview: {
      ...result.overview,
      activeWorkspaceId: SHARED_WORKSPACE_PREFIX + result.overview.activeWorkspaceId,
      workspaces: result.overview.workspaces.map((workspace) => ({
        ...workspace,
        id: SHARED_WORKSPACE_PREFIX + workspace.id,
        name: workspace.name,
      })),
      folders: result.overview.folders.map((folder) => ({
        ...folder,
        workspaceId: SHARED_WORKSPACE_PREFIX + folder.workspaceId,
      })),
      files: result.overview.files.map(mapSharedFile),
    },
  };
}

function mapSharedCreateResult<T extends { file: LocalDocumentMetadata }>(result: T): T {
  return {
    ...result,
    file: mapSharedFile(result.file),
  };
}

/**
 * Beta/Stable共通のローカル共有Workspaceを、通常のLocalSigmaDocStoreと同じ契約で
 * 見せる薄いルーター。個人Workspaceは各アプリのuserData配下、共有Workspaceだけ
 * 共通ディレクトリに保存する。
 *
 * UIには shared: 接頭辞を隠し、通常のworkspaceId/fileIdとして扱えるようにする。
 */
export class SharedWorkspaceDocStore extends LocalSigmaDocStore {
  private readonly personalStore: LocalSigmaDocStore;
  private readonly sharedStore: LocalSigmaDocStore;

  constructor(personalUserDataPath: string, sharedWorkspacePath: string) {
    super(personalUserDataPath);
    this.personalStore = new LocalSigmaDocStore(personalUserDataPath);
    this.sharedStore = new LocalSigmaDocStore(sharedWorkspacePath);
  }

  private storeForFile(fileId: string): { store: LocalSigmaDocStore; rawFileId: string; shared: boolean } {
    return isSharedId(fileId)
      ? { store: this.sharedStore, rawFileId: rawId(fileId), shared: true }
      : { store: this.personalStore, rawFileId: fileId, shared: false };
  }

  private storeForWorkspace(workspaceId: string | null | undefined): { store: LocalSigmaDocStore; rawWorkspaceId: string | null | undefined; shared: boolean } {
    return isSharedId(workspaceId)
      ? { store: this.sharedStore, rawWorkspaceId: workspaceId ? rawId(workspaceId) : null, shared: true }
      : { store: this.personalStore, rawWorkspaceId: workspaceId, shared: false };
  }

  override getDataDir(): string {
    return this.personalStore.getDataDir();
  }

  override async initializeWorkspace(payload?: { initialDocument?: SigmaDocument }): Promise<LocalWorkspaceState> {
    return this.personalStore.initializeWorkspace(payload);
  }

  override async runExclusive<T>(fileId: string, fn: () => Promise<T>): Promise<T> {
    return this.storeForFile(fileId).store.runExclusive(this.storeForFile(fileId).rawFileId, fn);
  }

  override async listFiles(): Promise<LocalDocumentMetadata[]> {
    const [personal, shared] = await Promise.all([
      this.personalStore.listFiles(),
      this.sharedStore.listFiles(),
    ]);
    return [...personal, ...shared.map(mapSharedFile)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  override async loadDocument(fileId: string): Promise<SigmaDocument | null> {
    const route = this.storeForFile(fileId);
    return route.store.loadDocument(route.rawFileId);
  }

  override async loadDocumentWithRecovery(fileId: string) {
    const route = this.storeForFile(fileId);
    return route.store.loadDocumentWithRecovery(route.rawFileId);
  }

  override async listDocumentVersions(fileId: string): Promise<DocumentVersionMetadata[]> {
    const route = this.storeForFile(fileId);
    return route.store.listDocumentVersions(route.rawFileId);
  }

  override async getDocumentVersion(fileId: string, versionId: string): Promise<DocumentVersion | null> {
    const route = this.storeForFile(fileId);
    return route.store.getDocumentVersion(route.rawFileId, versionId);
  }

  override async captureDocumentVersion(
    fileId: string,
    document: SigmaDocument,
    options: { expectedRevision: number; origin: DocumentVersionOrigin },
  ) {
    const route = this.storeForFile(fileId);
    return route.store.captureDocumentVersion(route.rawFileId, document, options);
  }

  override async saveDocument(
    fileId: string,
    document: SigmaDocument,
    options: { expectedRevision: number; origin?: DocumentVersionOrigin },
  ): Promise<LocalStorageResult> {
    const route = this.storeForFile(fileId);
    return route.store.saveDocument(route.rawFileId, document, options);
  }

  override async createDocument(payload: { title?: string; workspaceId?: string | null; folderId?: string | null } = {}) {
    const route = this.storeForWorkspace(payload.workspaceId);
    if (!route.shared) {
      return route.store.createDocument(payload);
    }
    return mapSharedCreateResult(await route.store.createDocument({
      ...payload,
      workspaceId: route.rawWorkspaceId,
    }));
  }

  override async createFileFromDocument(payload: { document: SigmaDocument; workspaceId?: string | null; folderId?: string | null }) {
    const route = this.storeForWorkspace(payload.workspaceId);
    if (!route.shared) {
      return route.store.createFileFromDocument(payload);
    }
    return mapSharedCreateResult(await route.store.createFileFromDocument({
      ...payload,
      workspaceId: route.rawWorkspaceId,
    }));
  }

  override async duplicateFile(fileId: string) {
    const route = this.storeForFile(fileId);
    const result = await route.store.duplicateFile(route.rawFileId);
    return route.shared ? mapSharedCreateResult(result) : result;
  }

  override async deleteFile(fileId: string, options?: { expectedRevision: number }): Promise<LocalStorageResult> {
    const route = this.storeForFile(fileId);
    return route.store.deleteFile(route.rawFileId, options);
  }

  override async saveWorkspace(state: LocalWorkspaceState): Promise<LocalStorageResult> {
    const route = this.storeForFile(state.activeFileId);
    const mapId = (id: string) => route.shared ? rawId(id) : id;
    return route.store.saveWorkspace({
      openFileIds: state.openFileIds.filter((id) => isSharedId(id) === route.shared).map(mapId),
      activeFileId: mapId(state.activeFileId),
    });
  }

  override async getWorkspaceOverview(workspaceId?: string | null): Promise<LocalWorkspaceOverviewResult> {
    const [personal, shared] = await Promise.all([
      this.personalStore.getWorkspaceOverview(isSharedId(workspaceId) ? null : workspaceId),
      this.sharedStore.getWorkspaceOverview(isSharedId(workspaceId) ? rawId(workspaceId!) : null),
    ]);

    if (personal.state !== "ready") return personal;
    if (shared.state !== "ready") return shared;

    const activeWorkspaceId = isSharedId(workspaceId)
      ? SHARED_WORKSPACE_PREFIX + shared.overview.activeWorkspaceId
      : personal.overview.activeWorkspaceId;

    return {
      state: "ready",
      overview: {
        activeWorkspaceId,
        workspaces: [
          ...personal.overview.workspaces,
          ...shared.overview.workspaces.map((workspace) => ({
            ...workspace,
            id: SHARED_WORKSPACE_PREFIX + workspace.id,
          })),
        ],
        folders: [
          ...personal.overview.folders,
          ...shared.overview.folders.map((folder) => ({
            ...folder,
            workspaceId: SHARED_WORKSPACE_PREFIX + folder.workspaceId,
          })),
        ],
        files: [
          ...personal.overview.files,
          ...shared.overview.files.map(mapSharedFile),
        ],
      },
    };
  }

  override async createWorkspace(name: string): Promise<LocalWorkspaceOverviewResult> {
    return this.personalStore.createWorkspace(name);
  }

  override async renameWorkspace(workspaceId: string, name: string): Promise<LocalWorkspaceOverviewResult> {
    const route = this.storeForWorkspace(workspaceId);
    const result = await route.store.renameWorkspace(route.rawWorkspaceId!, name);
    return route.shared ? mapSharedOverview(result) : result;
  }

  override async deleteWorkspace(workspaceId: string): Promise<LocalWorkspaceOverviewResult> {
    const route = this.storeForWorkspace(workspaceId);
    const result = await route.store.deleteWorkspace(route.rawWorkspaceId!,);
    return route.shared ? mapSharedOverview(result) : result;
  }

  override async createFolder(workspaceId: string, name: string, parentFolderId?: string | null): Promise<LocalWorkspaceOverviewResult> {
    const route = this.storeForWorkspace(workspaceId);
    const result = await route.store.createFolder(route.rawWorkspaceId!, name, parentFolderId);
    return route.shared ? mapSharedOverview(result) : result;
  }

  override async updateFolder(workspaceId: string, folderId: string, patch: { name?: string; parentFolderId?: string | null }): Promise<LocalWorkspaceOverviewResult> {
    const route = this.storeForWorkspace(workspaceId);
    const result = await route.store.updateFolder(route.rawWorkspaceId!, folderId, patch);
    return route.shared ? mapSharedOverview(result) : result;
  }

  override async deleteFolder(workspaceId: string, folderId: string): Promise<LocalWorkspaceOverviewResult> {
    const route = this.storeForWorkspace(workspaceId);
    const result = await route.store.deleteFolder(route.rawWorkspaceId!, folderId);
    return route.shared ? mapSharedOverview(result) : result;
  }

  override async moveFileToFolder(workspaceId: string, fileId: string, folderId?: string | null): Promise<LocalWorkspaceOverviewResult> {
    const route = this.storeForWorkspace(workspaceId);
    const fileRoute = this.storeForFile(fileId);
    if (route.shared !== fileRoute.shared) {
      return { state: "error", error: "個人Workspaceと共有Workspaceの間では、フォルダ移動だけでは移動できません。" };
    }
    const result = await route.store.moveFileToFolder(route.rawWorkspaceId!, fileRoute.rawFileId, folderId);
    return route.shared ? mapSharedOverview(result) : result;
  }

  override async moveFileToWorkspace(fileId: string, targetWorkspaceId: string, folderId?: string | null): Promise<LocalWorkspaceOverviewResult> {
    const source = this.storeForFile(fileId);
    const target = this.storeForWorkspace(targetWorkspaceId);

    if (source.shared === target.shared) {
      const result = await target.store.moveFileToWorkspace(source.rawFileId, target.rawWorkspaceId!, folderId);
      return target.shared ? mapSharedOverview(result) : result;
    }

    const document = await source.store.loadDocument(source.rawFileId);
    if (!document) return { state: "error", error: "教材の読み込みに失敗しました。" };

    const created = await target.store.createFileFromDocument({
      document,
      workspaceId: target.rawWorkspaceId,
      folderId,
    });
    const deleted = await source.store.deleteFile(source.rawFileId);
    if (!deleted.ok) {
      await target.store.deleteFile(created.file.fileId);
      return { state: "error", error: deleted.error ?? "元の教材を削除できなかったため移動を取り消しました。" };
    }

    return target.shared
      ? mapSharedOverview(await target.store.getWorkspaceOverview(target.rawWorkspaceId))
      : target.store.getWorkspaceOverview(target.rawWorkspaceId);
  }

  override watch(onChange: (event: LocalStoreChangeEvent) => void): () => void {
    const stopPersonal = this.personalStore.watch(onChange);
    const stopShared = this.sharedStore.watch((event) => {
      if (event.type === "document" || event.type === "documentVersion") {
        onChange({ ...event, fileId: SHARED_FILE_PREFIX + event.fileId });
        return;
      }
      onChange(event);
    });
    return () => {
      stopPersonal();
      stopShared();
    };
  }
}
