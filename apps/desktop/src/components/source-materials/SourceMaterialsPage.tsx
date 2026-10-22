"use client";

import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  FileText,
  Loader2,
  Maximize2,
  Minus,
  Plus,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { Button, IconButton } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import type {
  SourceMaterialImportItem,
  SourceMaterialPage,
  SourceMaterialSummary,
  SourceMaterialWorkspaceStatus,
} from "@/features/source-material/types";
import { navigateToAppRoute } from "@/lib/app-navigation";
import { getDesktopBridge } from "@/lib/desktop-bridge";
import { useT } from "@/lib/i18n/react";
import { listWorkspaceOverview } from "@/lib/workspace-repository";
import type { WorkspaceSummary } from "@/lib/runtime/types";
import type { DesktopSourceMaterialsAPI } from "@/types/desktop";

type WorkspaceLoadState = "loading" | "ready" | "error";
type WorkspaceCheckState = "idle" | "loading" | "ready" | "error";
type ViewerMode = "document" | "text";

interface PageImageState {
  url: string;
  width: number;
  height: number;
  pageCount: number;
}

interface ImportNotice {
  key: string;
  kind: "success" | "duplicate" | "error";
  message: string;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 4;
const ZOOM_STEP = 0.25;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(value * 100) / 100));
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function EmptyPanel({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <section className="sources-empty-panel">
      <div className="sources-empty-icon" aria-hidden="true">
        {icon}
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
      {action ? <div className="sources-empty-action">{action}</div> : null}
    </section>
  );
}

function LoadingPanel({ label }: { label: string }) {
  return (
    <div className="sources-loading-panel" role="status">
      <Loader2 className="sources-spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function SourceMaterialsPage() {
  const t = useT("workspace");
  const [api, setApi] = useState<DesktopSourceMaterialsAPI | null>(null);
  const [desktopChecked, setDesktopChecked] = useState(false);

  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [workspaceLoad, setWorkspaceLoad] = useState<WorkspaceLoadState>("loading");
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [workspaceCheck, setWorkspaceCheck] = useState<WorkspaceCheckState>("idle");
  const [sourceWorkspace, setSourceWorkspace] = useState<SourceMaterialWorkspaceStatus | null>(null);

  const [sources, setSources] = useState<SourceMaterialSummary[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [importNotices, setImportNotices] = useState<ImportNotice[]>([]);

  const [viewerMode, setViewerMode] = useState<ViewerMode>("document");
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.5);
  const [pageImage, setPageImage] = useState<PageImageState | null>(null);
  const [pageImageLoading, setPageImageLoading] = useState(false);
  const [pageImageError, setPageImageError] = useState<string | null>(null);
  const [pageText, setPageText] = useState<SourceMaterialPage | null>(null);
  const [textLoading, setTextLoading] = useState(false);
  const [textError, setTextError] = useState<string | null>(null);
  const viewerRef = useRef<HTMLDivElement | null>(null);

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null,
    [selectedWorkspaceId, workspaces],
  );
  const selectedSource = useMemo(
    () => sources.find((source) => source.id === selectedSourceId) ?? null,
    [selectedSourceId, sources],
  );
  const isPdf = selectedSource?.format === "pdf";
  const totalPages = selectedSource
    ? selectedSource.format === "text"
      ? 1
      : Math.max(selectedSource.pageCount, pageImage?.pageCount ?? 0, 1)
    : 0;
  const warnings = selectedSource?.extraction.warnings ?? [];
  const ocrRequired = warnings.some((warning) => warning.includes("OCR_REQUIRED"));

  useEffect(() => {
    // Bridge detection reads `window`, which is unavailable during static
    // export. Resolve it after hydration instead of calling setState directly
    // in the effect body.
    queueMicrotask(() => {
      setApi(getDesktopBridge()?.sourceMaterials ?? null);
      setDesktopChecked(true);
    });
  }, []);

  useEffect(() => {
    if (!desktopChecked || !api) return;
    let cancelled = false;
    void listWorkspaceOverview()
      .then((result) => {
        if (cancelled) return;
        if (result.state === "ready") {
          setWorkspaces(result.overview.workspaces);
          setWorkspaceLoad("ready");
          return;
        }
        setWorkspaces([]);
        setWorkspaceLoad("error");
        setWorkspaceError(
          result.state === "unavailable" || result.state === "error"
            ? result.error ?? t("sources.loadFailed")
            : t("sources.loadFailed"),
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setWorkspaces([]);
        setWorkspaceLoad("error");
        setWorkspaceError(toMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, [api, desktopChecked, t]);

  useEffect(() => {
    if (!api || !selectedWorkspaceId) return;

    let cancelled = false;
    void (async () => {
      // Keep the effect body free of synchronous state updates. Selection
      // handlers reset the visible workspace state before this request starts.
      await Promise.resolve();
      const status = await api.getWorkspaceStatus(selectedWorkspaceId);
      if (cancelled) return;
      if (!status.ok) {
        setWorkspaceCheck("error");
        setSourcesError(status.error.message);
        return;
      }
      setSourceWorkspace(status.value);
      setWorkspaceCheck("ready");
      if (!status.value.registered) return;

      setSourcesLoading(true);
      const list = await api.listSources(selectedWorkspaceId);
      if (cancelled) return;
      setSourcesLoading(false);
      if (!list.ok) {
        setSourcesError(list.error.message);
        setSources([]);
        return;
      }
      setSources(list.value);
    })().catch((error: unknown) => {
      if (cancelled) return;
      setWorkspaceCheck("error");
      setSourcesLoading(false);
      setSourcesError(toMessage(error));
    });

    return () => {
      cancelled = true;
    };
  }, [api, selectedWorkspaceId]);

  const refreshSources = useCallback(
    async (workspaceId: string) => {
      if (!api) return;
      setSourcesLoading(true);
      const result = await api.listSources(workspaceId);
      setSourcesLoading(false);
      if (!result.ok) {
        setSourcesError(result.error.message);
        return;
      }
      setSources(result.value);
      setSelectedSourceId((current) =>
        current && result.value.some((source) => source.id === current) ? current : null,
      );
    },
    [api],
  );

  useEffect(() => {
    if (
      !api ||
      !selectedWorkspaceId ||
      !selectedSource ||
      selectedSource.format !== "pdf" ||
      viewerMode !== "document"
    ) {
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    const timer = window.setTimeout(() => {
      void (async () => {
        if (cancelled) return;
        setPageImage(null);
        setPageImageError(null);
        setPageImageLoading(true);
        const result = await api.getPageImage(
          selectedWorkspaceId,
          selectedSource.id,
          pageNumber,
          scale,
        );
        if (cancelled) return;
        if (!result.ok) {
          setPageImageError(result.error.message);
          return;
        }
        const pngBytes = new Uint8Array(result.value.png);
        objectUrl = URL.createObjectURL(new Blob([pngBytes.buffer], { type: "image/png" }));
        setPageImage({
          url: objectUrl,
          width: result.value.width,
          height: result.value.height,
          pageCount: result.value.pageCount,
        });
      })()
        .catch((error: unknown) => {
          if (!cancelled) setPageImageError(toMessage(error));
        })
        .finally(() => {
          if (!cancelled) setPageImageLoading(false);
        });
    }, 90);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [api, pageNumber, scale, selectedSource, selectedWorkspaceId, viewerMode]);

  useEffect(() => {
    if (!api || !selectedWorkspaceId || !selectedSource) return;

    let cancelled = false;
    const targetPage = selectedSource.format === "text" ? 1 : pageNumber;

    const timer = window.setTimeout(() => {
      void (async () => {
        if (cancelled) return;
        setPageText(null);
        setTextError(null);
        setTextLoading(true);
        const result = await api.getPage(selectedWorkspaceId, selectedSource.id, targetPage);
        if (cancelled) return;
        if (!result.ok) {
          setTextError(result.error.message);
          return;
        }
        setPageText(result.value.page);
      })()
        .catch((error: unknown) => {
          if (!cancelled) setTextError(toMessage(error));
        })
        .finally(() => {
          if (!cancelled) setTextLoading(false);
        });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [api, pageNumber, selectedSource, selectedWorkspaceId]);

  const handleWorkspaceChange = (value: string) => {
    const nextWorkspaceId = value || null;
    setSelectedWorkspaceId(nextWorkspaceId);
    setWorkspaceCheck(nextWorkspaceId ? "loading" : "idle");
    setSourceWorkspace(null);
    setSources([]);
    setSourcesLoading(false);
    setSourcesError(null);
    setSelectedSourceId(null);
    setActionMessage(null);
    setImportNotices([]);
    setViewerMode("document");
    setPageNumber(1);
    setPageImage(null);
    setPageImageError(null);
    setPageImageLoading(false);
    setPageText(null);
    setTextError(null);
    setTextLoading(false);
  };

  const handleSelectSource = (source: SourceMaterialSummary) => {
    setSelectedSourceId(source.id);
    setViewerMode(source.format === "text" ? "text" : "document");
    setPageNumber(1);
    setPageImage(null);
    setPageImageError(null);
    setPageImageLoading(false);
    setPageText(null);
    setTextError(null);
    setTextLoading(false);
  };

  const handleViewerModeChange = (mode: ViewerMode) => {
    setViewerMode(mode);
    if (mode === "text") {
      setPageImage(null);
      setPageImageError(null);
      setPageImageLoading(false);
    }
  };

  const handleRegister = useCallback(async () => {
    if (!api || !selectedWorkspaceId || !selectedWorkspace || registering) return;
    setRegistering(true);
    setSourcesError(null);
    setActionMessage(null);
    try {
      const result = await api.registerWorkspace(selectedWorkspaceId, selectedWorkspace.name);
      if (!result.ok) {
        setSourcesError(result.error.message);
        return;
      }
      setSourceWorkspace(result.value);
      setActionMessage(t("sources.registeredMessage"));
      await refreshSources(selectedWorkspaceId);
    } catch (error) {
      setSourcesError(toMessage(error));
    } finally {
      setRegistering(false);
    }
  }, [api, refreshSources, registering, selectedWorkspace, selectedWorkspaceId, t]);

  const handleImport = useCallback(async () => {
    if (!api || !selectedWorkspaceId || importing) return;
    setImporting(true);
    setSourcesError(null);
    setActionMessage(null);
    setImportNotices([]);
    try {
      const result = await api.importFiles(selectedWorkspaceId);
      if (!result.ok) {
        setSourcesError(result.error.message);
        return;
      }
      if (result.value.canceled) return;

      const notices: ImportNotice[] = result.value.items.map((item: SourceMaterialImportItem) => ({
        key: `${item.filePath}:${item.fileName}`,
        kind: item.ok ? (item.duplicate ? "duplicate" : "success") : "error",
        message: item.ok
          ? item.duplicate
            ? `${item.fileName}: ${t("sources.duplicate")}`
            : item.fileName
          : `${item.fileName}: ${item.error?.message ?? t("sources.importFailed")}`,
      }));
      setImportNotices(notices);
      const added = result.value.items.filter((item) => item.ok && !item.duplicate).length;
      if (added > 0) setActionMessage(t("sources.importedCount", { count: added }));
      await refreshSources(selectedWorkspaceId);
    } catch (error) {
      setSourcesError(toMessage(error));
    } finally {
      setImporting(false);
    }
  }, [api, importing, refreshSources, selectedWorkspaceId, t]);

  const handlePreviousPage = () => {
    setPageNumber((current) => Math.max(1, current - 1));
    setPageImage(null);
    setPageImageError(null);
    setPageText(null);
    setTextError(null);
  };

  const handleNextPage = () => {
    setPageNumber((current) => Math.min(totalPages, current + 1));
    setPageImage(null);
    setPageImageError(null);
    setPageText(null);
    setTextError(null);
  };

  const handleZoomOut = () => {
    setScale((current) => clampScale(current - ZOOM_STEP));
  };

  const handleZoomIn = () => {
    setScale((current) => clampScale(current + ZOOM_STEP));
  };

  const handleFitWidth = () => {
    if (!pageImage) return;
    const availableWidth = viewerRef.current?.clientWidth;
    if (!availableWidth) return;
    setScale((current) => clampScale(current * ((availableWidth - 64) / pageImage.width)));
  };

  return (
    <div className="sources-page">
      <header className="sources-topbar">
        <div className="sources-topbar-main">
          <Button tone="ghost" size="sm" onClick={() => navigateToAppRoute("/workspace")}>
            <ArrowLeft size={16} aria-hidden="true" />
            {t("sources.backToWorkspace")}
          </Button>
          <div className="sources-heading">
            <h1>
              <BookOpen size={22} aria-hidden="true" />
              {t("sources.title")}
            </h1>
            <p>{t("sources.subtitle")}</p>
          </div>
        </div>
        {workspaceLoad === "ready" ? (
          <div className="sources-workspace-picker">
            <label htmlFor="sources-workspace-select">{t("sources.workspaceLabel")}</label>
            <Select
              id="sources-workspace-select"
              value={selectedWorkspaceId ?? ""}
              onChange={handleWorkspaceChange}
              options={workspaces.map((workspace) => ({
                value: workspace.id,
                label: workspace.name,
              }))}
              placeholder={t("sources.workspacePlaceholder")}
            />
          </div>
        ) : null}
      </header>

      <main className="sources-main">
        {!desktopChecked ? (
          <LoadingPanel label={t("sources.loading")} />
        ) : !api ? (
          <EmptyPanel
            icon={<BookOpen size={30} />}
            title={t("sources.title")}
            description={t("sources.unsupported")}
          />
        ) : workspaceLoad === "loading" ? (
          <LoadingPanel label={t("sources.loading")} />
        ) : workspaceLoad === "error" ? (
          <EmptyPanel
            icon={<AlertTriangle size={30} />}
            title={t("sources.loadFailed")}
            description={workspaceError ?? t("sources.loadFailed")}
          />
        ) : !selectedWorkspaceId ? (
          <EmptyPanel
            icon={<BookOpen size={30} />}
            title={t("sources.workspaceRequiredTitle")}
            description={t("sources.workspaceRequiredDescription")}
          />
        ) : workspaceCheck === "loading" || workspaceCheck === "idle" ? (
          <LoadingPanel label={t("sources.loading")} />
        ) : workspaceCheck === "error" ? (
          <EmptyPanel
            icon={<AlertTriangle size={30} />}
            title={t("sources.loadFailed")}
            description={sourcesError ?? t("sources.loadFailed")}
          />
        ) : sourceWorkspace && !sourceWorkspace.registered ? (
          <EmptyPanel
            icon={<BookOpen size={30} />}
            title={t("sources.registerTitle")}
            description={t("sources.registerDescription")}
            action={
              <Button tone="primary" onClick={() => void handleRegister()} disabled={registering}>
                {registering ? <Loader2 className="sources-spin" size={16} aria-hidden="true" /> : null}
                {registering ? t("sources.registering") : t("sources.registerAction")}
              </Button>
            }
          />
        ) : sourceWorkspace?.registered ? (
          <div className="sources-layout">
            <aside className="sources-sidebar" aria-label={t("sources.fileListLabel")}>
              <div className="sources-sidebar-header">
                <div>
                  <h2>{t("sources.title")}</h2>
                  <p>{t("sources.sourceCount", { count: sources.length })}</p>
                </div>
                <Button
                  tone="primary"
                  size="sm"
                  onClick={() => void handleImport()}
                  disabled={importing}
                >
                  {importing ? <Loader2 className="sources-spin" size={16} aria-hidden="true" /> : null}
                  {importing ? t("sources.importing") : t("sources.importAction")}
                </Button>
              </div>

              {actionMessage ? (
                <p className="sources-message" role="status">
                  {actionMessage}
                </p>
              ) : null}
              {importNotices.length > 0 ? (
                <ul className="sources-notices" aria-live="polite">
                  {importNotices.map((notice) => (
                    <li key={notice.key} data-kind={notice.kind}>
                      {notice.message}
                    </li>
                  ))}
                </ul>
              ) : null}
              {sourcesError ? (
                <div className="sources-sidebar-error" role="alert">
                  <strong>{t("sources.loadFailed")}</strong>
                  <p>{sourcesError}</p>
                </div>
              ) : null}

              {sourcesLoading ? (
                <div className="sources-sidebar-loading" role="status">
                  <Loader2 className="sources-spin" size={18} aria-hidden="true" />
                  {t("sources.loading")}
                </div>
              ) : sources.length === 0 && !sourcesError ? (
                <div className="sources-sidebar-empty">
                  <FileText size={24} aria-hidden="true" />
                  <h3>{t("sources.emptyTitle")}</h3>
                  <p>{t("sources.emptyDescription")}</p>
                </div>
              ) : (
                <ul className="sources-list">
                  {sources.map((source) => (
                    <li key={source.id}>
                      <button
                        type="button"
                        className="sources-list-item"
                        data-active={source.id === selectedSourceId}
                        aria-pressed={source.id === selectedSourceId}
                        onClick={() => handleSelectSource(source)}
                      >
                        <span className="sources-list-icon" aria-hidden="true">
                          <FileText size={18} />
                        </span>
                        <span className="sources-list-text">
                          <span className="sources-list-name">{source.name}</span>
                          <span className="sources-list-meta">
                            {t("sources.pages", { count: source.format === "text" ? 1 : source.pageCount })}
                            {" · "}
                            {formatBytes(source.sizeBytes)}
                          </span>
                        </span>
                        {source.extraction.status === "failed" ? (
                          <AlertTriangle className="sources-list-warning" size={16} aria-hidden="true" />
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </aside>

            <section className="sources-viewer" aria-label={t("sources.viewerLabel")}>
              {!selectedSource ? (
                <div className="sources-viewer-empty">
                  <FileText size={30} aria-hidden="true" />
                  <p>{t("sources.selectSource")}</p>
                </div>
              ) : (
                <div className="sources-viewer-content">
                  <div className="sources-viewer-header">
                    <div className="sources-viewer-title">
                      <h2>{selectedSource.name}</h2>
                      <p>
                        {t("sources.pages", {
                          count: selectedSource.format === "text" ? 1 : selectedSource.pageCount,
                        })}
                        {" · "}
                        {formatBytes(selectedSource.sizeBytes)}
                      </p>
                    </div>
                    <div className="sources-viewer-toolbar">
                      {isPdf ? (
                        <div className="sources-tabs" role="tablist">
                          <button
                            type="button"
                            role="tab"
                            aria-selected={viewerMode === "document"}
                            data-active={viewerMode === "document"}
                            onClick={() => handleViewerModeChange("document")}
                          >
                            {t("sources.imageTab")}
                          </button>
                          <button
                            type="button"
                            role="tab"
                            aria-selected={viewerMode === "text"}
                            data-active={viewerMode === "text"}
                            onClick={() => handleViewerModeChange("text")}
                          >
                            {t("sources.textTab")}
                          </button>
                        </div>
                      ) : null}
                      {isPdf ? (
                        <div className="sources-page-nav">
                          <IconButton
                            label={t("sources.previousPage")}
                            size="sm"
                            tone="ghost"
                            onClick={handlePreviousPage}
                            disabled={pageNumber <= 1}
                          >
                            <ChevronLeft size={16} aria-hidden="true" />
                          </IconButton>
                          <span className="sources-page-indicator">
                            {t("sources.pageOf", { page: pageNumber, total: totalPages })}
                          </span>
                          <IconButton
                            label={t("sources.nextPage")}
                            size="sm"
                            tone="ghost"
                            onClick={handleNextPage}
                            disabled={pageNumber >= totalPages}
                          >
                            <ChevronRight size={16} aria-hidden="true" />
                          </IconButton>
                        </div>
                      ) : null}
                      {isPdf && viewerMode === "document" ? (
                        <div className="sources-zoom-controls">
                          <IconButton
                            label={t("sources.zoomOut")}
                            size="sm"
                            tone="ghost"
                            onClick={handleZoomOut}
                            disabled={scale <= MIN_SCALE}
                          >
                            <Minus size={16} aria-hidden="true" />
                          </IconButton>
                          <span className="sources-zoom-value">{Math.round(scale * 100)}%</span>
                          <IconButton
                            label={t("sources.zoomIn")}
                            size="sm"
                            tone="ghost"
                            onClick={handleZoomIn}
                            disabled={scale >= MAX_SCALE}
                          >
                            <Plus size={16} aria-hidden="true" />
                          </IconButton>
                          <Button tone="ghost" size="sm" onClick={handleFitWidth} disabled={!pageImage}>
                            <Maximize2 size={16} aria-hidden="true" />
                            {t("sources.fitWidth")}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {warnings.length > 0 || selectedSource.extraction.status === "failed" ? (
                    <div className="sources-warning" role="status">
                      <AlertTriangle size={18} aria-hidden="true" />
                      <div>
                        <strong>{t("sources.extractionWarningTitle")}</strong>
                        {ocrRequired ? <p>{t("sources.ocrRequired")}</p> : null}
                        {warnings.length > 0 ? (
                          <ul>
                            {warnings.map((warning) => (
                              <li key={warning}>{warning}</li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {isPdf && viewerMode === "document" ? (
                    <div className="sources-page-stage" ref={viewerRef}>
                      {pageImageLoading ? (
                        <div className="sources-stage-status" role="status">
                          <Loader2 className="sources-spin" size={20} aria-hidden="true" />
                          {t("sources.pageLoading")}
                        </div>
                      ) : null}
                      {pageImageError ? (
                        <div className="sources-stage-error" role="alert">
                          <AlertTriangle size={20} aria-hidden="true" />
                          <div>
                            <strong>{t("sources.pageImageFailed")}</strong>
                            <p>{pageImageError}</p>
                          </div>
                        </div>
                      ) : null}
                      {pageImage ? (
                        // The renderer receives PNG bytes from the main process,
                        // so this is a Blob URL rather than an optimizable asset.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          className="sources-page-image"
                          src={pageImage.url}
                          width={pageImage.width}
                          height={pageImage.height}
                          alt={t("sources.pdfPageAlt", {
                            name: selectedSource.name,
                            page: pageNumber,
                          })}
                          draggable={false}
                        />
                      ) : null}
                    </div>
                  ) : (
                    <div className="sources-text-stage">
                      {textLoading ? (
                        <div className="sources-stage-status" role="status">
                          <Loader2 className="sources-spin" size={20} aria-hidden="true" />
                          {t("sources.textLoading")}
                        </div>
                      ) : textError ? (
                        <div className="sources-stage-error" role="alert">
                          <AlertTriangle size={20} aria-hidden="true" />
                          <div>
                            <strong>{t("sources.textPanelLabel")}</strong>
                            <p>{textError}</p>
                          </div>
                        </div>
                      ) : pageText && pageText.text.trim().length > 0 ? (
                        <pre className="sources-text">{pageText.text}</pre>
                      ) : (
                        <div className="sources-text-empty">
                          <FileText size={24} aria-hidden="true" />
                          <p>{t("sources.noText")}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>
        ) : null}
      </main>
    </div>
  );
}
