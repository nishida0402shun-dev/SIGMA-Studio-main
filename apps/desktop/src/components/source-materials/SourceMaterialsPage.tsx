"use client";

import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Crop,
  FileText,
  Loader2,
  Maximize2,
  Minus,
  Plus,
  ScanLine,
  Trash2,
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";

import { Button, IconButton } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { SourceCapturePreviewDialog } from "./SourceCapturePreviewDialog";
import { SourceDeleteDialog } from "./SourceDeleteDialog";
import {
  createPageCapture,
  createRegionCapture,
  createTextCapture,
  type SourceCapture,
  type SourceCaptureBoundingBox,
} from "@/features/source-material/capture";
import { isCsvSource, parseCsv } from "@/features/source-material/csv";
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

function imageRegionToDataUrl(
  image: HTMLImageElement,
  box: SourceCaptureBoundingBox,
): string | null {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (sourceWidth <= 0 || sourceHeight <= 0) return null;
  const sx = Math.max(0, Math.round(box.x * sourceWidth));
  const sy = Math.max(0, Math.round(box.y * sourceHeight));
  const sw = Math.max(1, Math.round(box.width * sourceWidth));
  const sh = Math.max(1, Math.round(box.height * sourceHeight));
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas.toDataURL("image/png");
}

function imageToDataUrl(image: HTMLImageElement): string | null {
  return imageRegionToDataUrl(image, { x: 0, y: 0, width: 1, height: 1 });
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
  const [textSelection, setTextSelection] = useState<{
    text: string;
    startOffset: number;
    endOffset: number;
  } | null>(null);
  const [capture, setCapture] = useState<SourceCapture | null>(null);
  const [regionMode, setRegionMode] = useState(false);
  const [regionBox, setRegionBox] = useState<SourceCaptureBoundingBox | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SourceMaterialSummary | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [undoDelete, setUndoDelete] = useState<{ sourceId: string; name: string } | null>(null);
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const pageImageRef = useRef<HTMLImageElement | null>(null);
  const textRef = useRef<HTMLPreElement | null>(null);
  const regionDragRef = useRef<SourceCaptureBoundingBox | null>(null);

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
  const isCsv = selectedSource ? isCsvSource(selectedSource) : false;
  const csvTable = useMemo(
    () => (isCsv && pageText ? parseCsv(pageText.text) : null),
    [isCsv, pageText],
  );

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

  const clearCaptureInteraction = () => {
    setTextSelection(null);
    setCapture(null);
    setRegionMode(false);
    setRegionBox(null);
    regionDragRef.current = null;
  };

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
    clearCaptureInteraction();
    setDeleteTarget(null);
    setDeleteError(null);
    setUndoDelete(null);
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
    clearCaptureInteraction();
  };

  const handleViewerModeChange = (mode: ViewerMode) => {
    setViewerMode(mode);
    clearCaptureInteraction();
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
    clearCaptureInteraction();
  };

  const handleNextPage = () => {
    setPageNumber((current) => Math.min(totalPages, current + 1));
    setPageImage(null);
    setPageImageError(null);
    setPageText(null);
    setTextError(null);
    clearCaptureInteraction();
  };

  const handleZoomOut = () => {
    setRegionMode(false);
    setRegionBox(null);
    setScale((current) => clampScale(current - ZOOM_STEP));
  };

  const handleZoomIn = () => {
    setRegionMode(false);
    setRegionBox(null);
    setScale((current) => clampScale(current + ZOOM_STEP));
  };

  const handleFitWidth = () => {
    if (!pageImage) return;
    const availableWidth = viewerRef.current?.clientWidth;
    if (!availableWidth) return;
    setScale((current) => clampScale(current * ((availableWidth - 64) / pageImage.width)));
  };

  const handleTextSelection = () => {
    const container = textRef.current;
    const selection = window.getSelection();
    if (!container || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setTextSelection(null);
      return;
    }
    const range = selection.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) {
      setTextSelection(null);
      return;
    }
    const selectedText = range.toString();
    if (selectedText.trim().length === 0) {
      setTextSelection(null);
      return;
    }
    const prefix = document.createRange();
    prefix.selectNodeContents(container);
    prefix.setEnd(range.startContainer, range.startOffset);
    const startOffset = prefix.toString().length;
    setTextSelection({
      text: selectedText,
      startOffset,
      endOffset: startOffset + selectedText.length,
    });
  };

  const handleCapturePage = (source: SourceMaterialSummary) => {
    const text = pageText?.text ?? "";
    const base = createPageCapture({
      source,
      pageNumber: selectedSource?.format === "text" ? 1 : pageNumber,
      text,
    });
    const image = pageImageRef.current;
    const imageDataUrl = image ? imageToDataUrl(image) : null;
    if (text.trim().length === 0 && !imageDataUrl) {
      setSourcesError(t("sources.captureUnavailable"));
      return;
    }
    setSourcesError(null);
    setCapture(imageDataUrl ? { ...base, imageDataUrl } : base);
  };

  const handleCaptureSelection = (source: SourceMaterialSummary) => {
    if (!textSelection) return;
    setCapture(
      createTextCapture({
        source,
        pageNumber: selectedSource?.format === "text" ? 1 : pageNumber,
        text: textSelection.text,
        startOffset: textSelection.startOffset,
        endOffset: textSelection.endOffset,
      }),
    );
  };

  const normalizedPointer = (
    event: ReactPointerEvent<HTMLDivElement>,
  ): { x: number; y: number } => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width))),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / Math.max(1, rect.height))),
    };
  };

  const boxFromPoints = (
    start: { x: number; y: number },
    end: { x: number; y: number },
  ): SourceCaptureBoundingBox => ({
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  });

  const handleRegionPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!regionMode || !selectedSource || !pageImage) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = normalizedPointer(event);
    regionDragRef.current = { x: point.x, y: point.y, width: 0, height: 0 };
    setRegionBox({ x: point.x, y: point.y, width: 0, height: 0 });
  };

  const handleRegionPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = regionDragRef.current;
    if (!start || !regionMode) return;
    setRegionBox(boxFromPoints(start, normalizedPointer(event)));
  };

  const handleRegionPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = regionDragRef.current;
    if (!start || !selectedSource) return;
    regionDragRef.current = null;
    const box = boxFromPoints(start, normalizedPointer(event));
    setRegionBox(box);
    if (box.width < 0.01 || box.height < 0.01) return;

    const image = pageImageRef.current;
    const imageDataUrl = image ? imageRegionToDataUrl(image, box) : null;
    if (!imageDataUrl) {
      setSourcesError(t("sources.pageImageFailed"));
      return;
    }
    setRegionMode(false);
    setSourcesError(null);
    setCapture(
      createRegionCapture({
        source: selectedSource,
        pageNumber,
        // A region is image-only: extracted text belongs to the whole page, so
        // attaching it here would misrepresent the selected area.
        text: "",
        boundingBox: box,
        imageDataUrl,
      }),
    );
  };

  const handleDeleteConfirm = async () => {
    if (!api || !selectedWorkspaceId || !deleteTarget || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const result = await api.deleteSource(selectedWorkspaceId, deleteTarget.id);
      if (!result.ok || !result.value.deleted) {
        setDeleteError(result.ok ? t("sources.deleteFailed") : result.error.message);
        return;
      }
      setSources((current) => current.filter((source) => source.id !== deleteTarget.id));
      if (selectedSourceId === deleteTarget.id) {
        setSelectedSourceId(null);
        setPageImage(null);
        setPageText(null);
        setTextError(null);
      }
      clearCaptureInteraction();
      setUndoDelete({ sourceId: deleteTarget.id, name: deleteTarget.name });
      setActionMessage(t("sources.deletedMessage", { name: deleteTarget.name }));
      setDeleteTarget(null);
    } catch (error) {
      setDeleteError(toMessage(error));
    } finally {
      setDeleting(false);
    }
  };

  const handleUndoDelete = async () => {
    if (!api || !selectedWorkspaceId || !undoDelete) return;
    const target = undoDelete;
    const result = await api.restoreSource(selectedWorkspaceId, target.sourceId);
    if (!result.ok || !result.value.restored) {
      setSourcesError(
        result.ok
          ? t("sources.restoreFailed")
          : `${t("sources.restoreFailed")}: ${result.error.message}`,
      );
      return;
    }
    setUndoDelete(null);
    setActionMessage(null);
    await refreshSources(selectedWorkspaceId);
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
                <div className="sources-message" role="status">
                  <span>{actionMessage}</span>
                  {undoDelete ? (
                    <Button tone="ghost" size="sm" onClick={() => void handleUndoDelete()}>
                      <Undo2 size={15} aria-hidden="true" />
                      {t("sources.undoDelete")}
                    </Button>
                  ) : null}
                </div>
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
                    <li key={source.id} className="sources-list-row">
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
                      <IconButton
                        className="sources-list-delete"
                        label={t("sources.deleteSource")}
                        size="sm"
                        tone="ghost"
                        onClick={() => {
                          setDeleteError(null);
                          setDeleteTarget(source);
                        }}
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </IconButton>
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
                      <Button
                        tone="ghost"
                        size="sm"
                        onClick={() => handleCapturePage(selectedSource)}
                        disabled={textLoading || pageImageLoading}
                      >
                        <ScanLine size={16} aria-hidden="true" />
                        {t("sources.capturePage")}
                      </Button>
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
                          <Button
                            tone={regionMode ? "primary" : "ghost"}
                            size="sm"
                            onClick={() => {
                              setRegionBox(null);
                              setRegionMode((current) => !current);
                            }}
                            disabled={!pageImage}
                          >
                            <Crop size={16} aria-hidden="true" />
                            {regionMode ? t("sources.cancelRegion") : t("sources.selectRegion")}
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
                        <div
                          className="sources-page-image-shell"
                          data-region-mode={regionMode}
                          onPointerDown={handleRegionPointerDown}
                          onPointerMove={handleRegionPointerMove}
                          onPointerUp={handleRegionPointerUp}
                        >
                          {/* The renderer receives PNG bytes from the main process,
                              so this is a Blob URL rather than an optimizable asset. */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            ref={pageImageRef}
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
                          {regionBox ? (
                            <span
                              className="sources-region-box"
                              aria-hidden="true"
                              style={{
                                left: `${regionBox.x * 100}%`,
                                top: `${regionBox.y * 100}%`,
                                width: `${regionBox.width * 100}%`,
                                height: `${regionBox.height * 100}%`,
                              }}
                            />
                          ) : null}
                          {regionMode ? (
                            <span className="sources-region-hint">{t("sources.regionHint")}</span>
                          ) : null}
                        </div>
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
                        <>
                          {!isCsv ? (
                            <div className="sources-text-toolbar">
                              {textSelection ? (
                                <>
                                  <span>
                                    {t("sources.selectionReady", {
                                      count: textSelection.text.length,
                                    })}
                                  </span>
                                  <Button
                                    tone="primary"
                                    size="sm"
                                    onClick={() => handleCaptureSelection(selectedSource)}
                                  >
                                    <ScanLine size={15} aria-hidden="true" />
                                    {t("sources.captureSelection")}
                                  </Button>
                                </>
                              ) : (
                                <span className="sources-select-hint">
                                  {t("sources.selectWordHint")}
                                </span>
                              )}
                            </div>
                          ) : null}
                          {isCsv && csvTable && csvTable.rows.length > 0 ? (
                            <>
                              <div className="sources-csv-scroll">
                                <table
                                  className="sources-csv-table"
                                  aria-label={t("sources.csvTableLabel")}
                                >
                                  <tbody>
                                    {csvTable.rows.map((row, rowIndex) => (
                                      <tr key={rowIndex}>
                                        {row.map((cell, columnIndex) => (
                                          <td key={columnIndex}>{cell}</td>
                                        ))}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              {csvTable.truncated ? (
                                <p className="sources-csv-note" role="status">
                                  {t("sources.csvTruncated")}
                                </p>
                              ) : null}
                            </>
                          ) : (
                            <pre
                              ref={textRef}
                              className="sources-text"
                              onMouseUp={handleTextSelection}
                              onKeyUp={handleTextSelection}
                            >
                              {pageText.text}
                            </pre>
                          )}
                        </>
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

      {capture && selectedWorkspaceId ? (
        <SourceCapturePreviewDialog
          key={capture.id}
          capture={capture}
          source={selectedSource}
          workspaceId={selectedWorkspaceId}
          onClose={() => setCapture(null)}
        />
      ) : null}

      {deleteTarget ? (
        <SourceDeleteDialog
          sourceName={deleteTarget.name}
          deleting={deleting}
          error={deleteError}
          onCancel={() => {
            if (deleting) return;
            setDeleteTarget(null);
            setDeleteError(null);
          }}
          onConfirm={() => void handleDeleteConfirm()}
        />
      ) : null}
    </div>
  );
}
