import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { createCurrentLocaleTranslator } from "@/lib/i18n";
import type {
  SourceMaterialExtractionInfo,
  SourceMaterialExtractionStatus,
  SourceMaterialExtractionSummary,
  SourceMaterialFileBytes,
  SourceMaterialFormat,
  SourceMaterialImportOutcome,
  SourceMaterialPage,
  SourceMaterialPageRangeResult,
  SourceMaterialPageResult,
  SourceMaterialSearchHit,
  SourceMaterialSummary,
  SourceMaterialWorkspaceStatus,
} from "@/features/source-material/types";

import {
  AuthService,
  BackupService,
  CoreRepository,
  CoreService,
  DeviceQuarantineService,
  LocalBlobStore,
  detectFormat,
  type AuthContext,
  type ExtractedArtifact,
  type SourceLocation,
  type SourceObject,
} from "./core-bridge";

const te = createCurrentLocaleTranslator("error");

export const SOURCE_MATERIAL_MAX_BYTES = 50 * 1024 * 1024;
export const SOURCE_MATERIAL_STUDIO_SUBJECT = "studio-local";

const CORE_WORKSPACE_PREFIX = "studio:";
const TEXT_EXTENSIONS = new Set(["txt", "md", "markdown", "csv"]);
const PDF_MIME_TYPE = "application/pdf";

export class SourceMaterialError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SourceMaterialError";
    this.code = code;
  }
}

/**
 * Normalizes Core's machine-readable `CODE: message` errors and keeps Studio's
 * own error codes intact. Unknown failures stay visible instead of being
 * reported as an empty list or an unexplained success.
 */
export function toSourceMaterialError(error: unknown): SourceMaterialError {
  if (error instanceof SourceMaterialError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const match = /^([A-Z][A-Z0-9_]+)(?::\s*)?([\s\S]*)$/.exec(message);
  if (match?.[1]) {
    return new SourceMaterialError(match[1], match[2]?.trim() || message);
  }
  return new SourceMaterialError("CORE_ERROR", message || te("electron.sourceMaterial.coreUnknown"));
}

export function coreWorkspaceIdForStudio(studioWorkspaceId: string): string {
  const trimmed = studioWorkspaceId.trim();
  if (!trimmed) {
    throw new SourceMaterialError(
      "WORKSPACE_SELECTION_REQUIRED",
      te("electron.sourceMaterial.workspaceSelectionRequired"),
    );
  }
  return `${CORE_WORKSPACE_PREFIX}${trimmed}`;
}

function extensionOf(fileName: string): string {
  return fileName.toLowerCase().split(".").pop() ?? "";
}

function mimeTypeForFileName(fileName: string, isPdf: boolean): string {
  if (isPdf) return PDF_MIME_TYPE;
  switch (extensionOf(fileName)) {
    case "md":
    case "markdown":
      return "text/markdown";
    case "csv":
      return "text/csv";
    default:
      return "text/plain";
  }
}

function formatForObject(object: SourceObject): SourceMaterialFormat {
  if (object.metadata.mimeType === PDF_MIME_TYPE) return "pdf";
  return "text";
}

function extractionStatus(artifact: ExtractedArtifact | undefined): SourceMaterialExtractionStatus {
  if (!artifact) return "unavailable";
  return artifact.status;
}

function extractionSummary(artifacts: ExtractedArtifact[]): SourceMaterialExtractionSummary {
  const artifact = artifacts.at(-1);
  return {
    status: extractionStatus(artifact),
    warnings: artifact?.warnings ?? [],
    ...(artifact?.extractorId === undefined ? {} : { extractorId: artifact.extractorId }),
    ...(artifact?.extractorVersion === undefined ? {} : { extractorVersion: artifact.extractorVersion }),
    ...(artifact?.pageCount === undefined ? {} : { pageCount: artifact.pageCount }),
  };
}

function pageFromLocation(location: SourceLocation): SourceMaterialPage {
  return {
    sourceId: location.objectId,
    pageNumber: location.pageNumber,
    text: location.textContent ?? "",
    semanticType: location.semanticType,
    ...(location.title === undefined ? {} : { title: location.title }),
    ...(location.startOffset === undefined ? {} : { startOffset: location.startOffset }),
    ...(location.endOffset === undefined ? {} : { endOffset: location.endOffset }),
  };
}

export interface SourceMaterialServiceOptions {
  maxBytes?: number;
}

/**
 * Owns the Studio <-> SIGMA Core boundary. The renderer never opens Core's
 * database, and every operation is scoped to an explicitly registered Studio
 * Workspace. The service is deliberately independent of Electron so it can be
 * exercised in Node integration tests.
 */
export class SourceMaterialService {
  readonly #repository: CoreRepository;
  readonly #coreService: CoreService;
  readonly #auth: AuthContext;
  readonly #maxBytes: number;
  #closed = false;

  constructor(userDataPath: string, options: SourceMaterialServiceOptions = {}) {
    if (!userDataPath.trim()) throw new Error("userDataPath must not be empty");
    this.#maxBytes = options.maxBytes ?? SOURCE_MATERIAL_MAX_BYTES;
    const dataDirectory = path.join(userDataPath, "data", "sigma-core");
    // CoreRepository creates the SQLite file but not necessarily its parent
    // directory. LocalBlobStore creates its own nested directories on write.
    mkdirSync(dataDirectory, { recursive: true });
    this.#repository = new CoreRepository(path.join(dataDirectory, "core.sqlite"));
    const blobStore = new LocalBlobStore(path.join(dataDirectory, "blobs"));
    const authService = new AuthService(this.#repository);
    const backupService = new BackupService(this.#repository);
    const deviceQuarantineService = new DeviceQuarantineService(this.#repository);
    this.#coreService = new CoreService(
      this.#repository,
      blobStore,
      authService,
      backupService,
      deviceQuarantineService,
    );
    this.#auth = { subjectId: SOURCE_MATERIAL_STUDIO_SUBJECT };
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new SourceMaterialError("SOURCE_MATERIAL_SERVICE_CLOSED", te("electron.sourceMaterial.serviceClosed"));
    }
  }

  #registeredCoreWorkspaceId(studioWorkspaceId: string): string {
    this.#assertOpen();
    const coreWorkspaceId = coreWorkspaceIdForStudio(studioWorkspaceId);
    if (!this.#repository.getWorkspace(coreWorkspaceId)) {
      throw new SourceMaterialError(
        "WORKSPACE_NOT_REGISTERED",
        te("electron.sourceMaterial.workspaceNotRegistered"),
      );
    }
    return coreWorkspaceId;
  }

  #sourceInWorkspace(coreWorkspaceId: string, sourceId: string): SourceObject {
    const object = this.#coreService.getObject(this.#auth, sourceId);
    if (!object || object.scopeId !== coreWorkspaceId) {
      throw new SourceMaterialError("SOURCE_NOT_FOUND", te("electron.sourceMaterial.sourceNotFound"));
    }
    return object;
  }

  /** Restore must find the row while it is still PendingDeletion. */
  #sourceRecordInWorkspace(coreWorkspaceId: string, sourceId: string): SourceObject {
    const object = this.#repository.getSourceObject(sourceId);
    if (!object || object.scopeId !== coreWorkspaceId) {
      throw new SourceMaterialError("SOURCE_NOT_FOUND", te("electron.sourceMaterial.sourceNotFound"));
    }
    return object;
  }

  #summary(object: SourceObject): SourceMaterialSummary {
    const artifacts = this.#coreService.getExtractionArtifacts(this.#auth, object.objectId);
    return {
      id: object.objectId,
      studioWorkspaceId: object.scopeId.startsWith(CORE_WORKSPACE_PREFIX)
        ? object.scopeId.slice(CORE_WORKSPACE_PREFIX.length)
        : object.scopeId,
      coreWorkspaceId: object.scopeId,
      name: object.metadata.name,
      mimeType: object.metadata.mimeType,
      format: formatForObject(object),
      sizeBytes: object.metadata.sizeBytes,
      pageCount: object.metadata.pageCount ?? artifacts.at(-1)?.pageCount ?? 0,
      contentHash: object.contentHash,
      ...(object.metadata.originalPath === undefined ? {} : { originalPath: object.metadata.originalPath }),
      importedAt: object.createdAt,
      updatedAt: object.updatedAt,
      extraction: extractionSummary(artifacts),
    };
  }

  getWorkspaceStatus(studioWorkspaceId: string): SourceMaterialWorkspaceStatus {
    this.#assertOpen();
    const coreWorkspaceId = coreWorkspaceIdForStudio(studioWorkspaceId);
    const workspace = this.#repository.getWorkspace(coreWorkspaceId);
    if (!workspace) {
      return {
        studioWorkspaceId,
        coreWorkspaceId,
        registered: false,
        sourceCount: 0,
      };
    }
    return {
      studioWorkspaceId,
      coreWorkspaceId,
      registered: true,
      displayName: workspace.displayName,
      sourceCount: this.#coreService.listObjects(this.#auth, coreWorkspaceId).length,
    };
  }

  /**
   * Creates the Core Workspace only when the user explicitly asks to enable
   * source materials for a Studio Workspace. Repeating the call is safe.
   */
  registerWorkspace(studioWorkspaceId: string, displayName: string): SourceMaterialWorkspaceStatus {
    this.#assertOpen();
    const coreWorkspaceId = coreWorkspaceIdForStudio(studioWorkspaceId);
    const trimmedName = displayName.trim();
    if (!trimmedName) {
      throw new SourceMaterialError("INVALID_WORKSPACE_NAME", te("electron.sourceMaterial.invalidWorkspaceName"));
    }
    if (!this.#repository.getWorkspace(coreWorkspaceId)) {
      this.#coreService.createWorkspace(this.#auth, coreWorkspaceId, trimmedName);
    }
    return this.getWorkspaceStatus(studioWorkspaceId);
  }

  listSources(studioWorkspaceId: string): SourceMaterialSummary[] {
    const coreWorkspaceId = this.#registeredCoreWorkspaceId(studioWorkspaceId);
    return this.#coreService
      .listObjects(this.#auth, coreWorkspaceId)
      .map((object) => this.#summary(object))
      .sort((left, right) => right.importedAt.localeCompare(left.importedAt));
  }

  async importFile(studioWorkspaceId: string, filePath: string): Promise<SourceMaterialImportOutcome> {
    const coreWorkspaceId = this.#registeredCoreWorkspaceId(studioWorkspaceId);
    const resolvedPath = path.resolve(filePath);
    let info;
    try {
      info = await stat(resolvedPath);
    } catch {
      throw new SourceMaterialError("FILE_NOT_FOUND", te("electron.sourceMaterial.fileNotFound"));
    }
    if (!info.isFile()) {
      throw new SourceMaterialError("INVALID_INPUT", te("electron.sourceMaterial.selectFile"));
    }
    if (info.size > this.#maxBytes) {
      throw new SourceMaterialError(
        "FILE_TOO_LARGE",
        te("electron.sourceMaterial.fileTooLarge", { megabytes: Math.floor(this.#maxBytes / (1024 * 1024)) }),
      );
    }
    const bytes = await readFile(resolvedPath);
    return this.importBytes(studioWorkspaceId, {
      name: path.basename(resolvedPath),
      bytes,
      originalPath: resolvedPath,
      coreWorkspaceId,
    });
  }

  async importBytes(
    studioWorkspaceId: string,
    input: { name: string; bytes: Uint8Array; originalPath?: string; coreWorkspaceId?: string },
  ): Promise<SourceMaterialImportOutcome> {
    const coreWorkspaceId = input.coreWorkspaceId ?? this.#registeredCoreWorkspaceId(studioWorkspaceId);
    this.#assertOpen();
    const name = input.name.trim();
    if (!name) {
      throw new SourceMaterialError("INVALID_INPUT", te("electron.sourceMaterial.fileNameRequired"));
    }
    if (input.bytes.byteLength === 0) {
      throw new SourceMaterialError("EMPTY_FILE", te("electron.sourceMaterial.emptyFile"));
    }
    if (input.bytes.byteLength > this.#maxBytes) {
      throw new SourceMaterialError(
        "FILE_TOO_LARGE",
        te("electron.sourceMaterial.fileTooLarge", { megabytes: Math.floor(this.#maxBytes / (1024 * 1024)) }),
      );
    }

    const detection = detectFormat(input.bytes, name);
    if (detection.format !== "pdf" && detection.format !== "plain-text") {
      throw new SourceMaterialError(
        "UNSUPPORTED_FORMAT",
        te("electron.sourceMaterial.unsupportedFormat"),
      );
    }
    if (extensionOf(name) === "pdf" && detection.format !== "pdf") {
      throw new SourceMaterialError(
        "UNSUPPORTED_FORMAT",
        te("electron.sourceMaterial.pdfContentMismatch"),
      );
    }
    if (detection.format === "plain-text" && !TEXT_EXTENSIONS.has(extensionOf(name))) {
      throw new SourceMaterialError(
        "UNSUPPORTED_FORMAT",
        te("electron.sourceMaterial.unsupportedTextFormat"),
      );
    }

    const contentHash = createHash("sha256").update(input.bytes).digest("hex");
    const existing = this.#repository.findSourceByContentHash(contentHash);
    if (existing?.scopeId === coreWorkspaceId && existing.status === "Active") {
      return { source: this.#summary(existing), duplicate: true };
    }

    let registered: SourceObject;
    try {
      registered = await this.#coreService.registerObject(this.#auth, {
        workspaceId: coreWorkspaceId,
        name,
        bytes: input.bytes,
        mimeType: mimeTypeForFileName(name, detection.format === "pdf"),
        ...(input.originalPath === undefined ? {} : { originalPath: input.originalPath }),
      });
    } catch (error) {
      throw toSourceMaterialError(error);
    }
    return { source: this.#summary(registered), duplicate: false };
  }

  async getFileBytes(studioWorkspaceId: string, sourceId: string): Promise<SourceMaterialFileBytes> {
    const coreWorkspaceId = this.#registeredCoreWorkspaceId(studioWorkspaceId);
    const object = this.#sourceInWorkspace(coreWorkspaceId, sourceId);
    const bytes = await this.#coreService.getObjectBytes(this.#auth, sourceId);
    if (!bytes) {
      throw new SourceMaterialError("SOURCE_BYTES_UNAVAILABLE", te("electron.sourceMaterial.bytesUnavailable"));
    }
    return {
      sourceId: object.objectId,
      name: object.metadata.name,
      mimeType: object.metadata.mimeType,
      bytes: new Uint8Array(bytes),
    };
  }

  getPage(studioWorkspaceId: string, sourceId: string, pageNumber: number): SourceMaterialPageResult {
    const coreWorkspaceId = this.#registeredCoreWorkspaceId(studioWorkspaceId);
    const object = this.#sourceInWorkspace(coreWorkspaceId, sourceId);
    let result;
    try {
      result = this.#coreService.getPage(this.#auth, sourceId, pageNumber);
    } catch (error) {
      throw toSourceMaterialError(error);
    }
    if (!result) {
      throw new SourceMaterialError(
        "PAGE_NOT_FOUND",
        te("electron.sourceMaterial.pageNotFound"),
      );
    }
    return {
      source: this.#summary(object),
      page: pageFromLocation(result.location),
    };
  }

  getPageRange(
    studioWorkspaceId: string,
    sourceId: string,
    startPage: number,
    endPage: number,
  ): SourceMaterialPageRangeResult {
    const coreWorkspaceId = this.#registeredCoreWorkspaceId(studioWorkspaceId);
    const object = this.#sourceInWorkspace(coreWorkspaceId, sourceId);
    let range;
    try {
      range = this.#coreService.getPageRange(this.#auth, sourceId, startPage, endPage);
    } catch (error) {
      throw toSourceMaterialError(error);
    }
    return {
      source: this.#summary(object),
      startPage: range.startPage,
      endPage: range.endPage,
      pages: range.pages.map(pageFromLocation),
    };
  }

  getExtractionInfo(studioWorkspaceId: string, sourceId: string): SourceMaterialExtractionInfo[] {
    const coreWorkspaceId = this.#registeredCoreWorkspaceId(studioWorkspaceId);
    this.#sourceInWorkspace(coreWorkspaceId, sourceId);
    return this.#coreService
      .getExtractionArtifacts(this.#auth, sourceId)
      .map((artifact) => ({
        extractorId: artifact.extractorId,
        extractorVersion: artifact.extractorVersion,
        status: artifact.status,
        warnings: artifact.warnings,
        ...(artifact.pageCount === undefined ? {} : { pageCount: artifact.pageCount }),
      }));
  }

  search(studioWorkspaceId: string, query: string, limit = 12): SourceMaterialSearchHit[] {
    const coreWorkspaceId = this.#registeredCoreWorkspaceId(studioWorkspaceId);
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return [];
    const safeLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 50) : 12;
    try {
      return this.#coreService
        .search(this.#auth, { scopeId: coreWorkspaceId, query: trimmedQuery, limit: safeLimit })
        .map((hit) => ({
          sourceId: hit.objectId,
          sourceName: hit.sourceName,
          pageNumber: hit.pageNumber,
          semanticType: hit.semanticType,
          ...(hit.title === undefined ? {} : { title: hit.title }),
          textSnippet: hit.textSnippet,
          score: hit.score,
        }));
    } catch (error) {
      throw toSourceMaterialError(error);
    }
  }

  deleteSource(studioWorkspaceId: string, sourceId: string): boolean {
    const coreWorkspaceId = this.#registeredCoreWorkspaceId(studioWorkspaceId);
    this.#sourceInWorkspace(coreWorkspaceId, sourceId);
    return this.#coreService.deleteObject(this.#auth, sourceId);
  }

  restoreSource(studioWorkspaceId: string, sourceId: string): boolean {
    const coreWorkspaceId = this.#registeredCoreWorkspaceId(studioWorkspaceId);
    this.#sourceRecordInWorkspace(coreWorkspaceId, sourceId);
    try {
      if (!this.#coreService.restoreObject(this.#auth, sourceId)) {
        throw new SourceMaterialError("SOURCE_RESTORE_FAILED", te("electron.sourceMaterial.restoreFailed"));
      }
      return true;
    } catch (error) {
      throw toSourceMaterialError(error);
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#repository.close();
  }
}
