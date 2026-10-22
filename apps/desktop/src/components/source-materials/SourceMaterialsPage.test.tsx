// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  SourceMaterialPageImage,
  SourceMaterialPageResult,
  SourceMaterialResult,
  SourceMaterialSummary,
  SourceMaterialWorkspaceStatus,
} from "@/features/source-material/types";
import { setAppLocale } from "@/lib/i18n";
import type { DesktopAPI, DesktopSourceMaterialsAPI } from "@/types/desktop";

import { SourceMaterialsPage } from "./SourceMaterialsPage";

vi.mock("@/lib/desktop-bridge", () => ({ getDesktopBridge: vi.fn() }));
vi.mock("@/lib/workspace-repository", () => ({ listWorkspaceOverview: vi.fn() }));

import { getDesktopBridge } from "@/lib/desktop-bridge";
import { listWorkspaceOverview } from "@/lib/workspace-repository";

const WORKSPACE = { id: "ws-1", name: "理科資料", createdAt: "2026-01-01", updatedAt: "2026-01-01" };

const PDF_SOURCE: SourceMaterialSummary = {
  id: "source-1",
  studioWorkspaceId: "ws-1",
  coreWorkspaceId: "studio:ws-1",
  name: "japanese-two-pages.pdf",
  mimeType: "application/pdf",
  format: "pdf",
  sizeBytes: 18_148,
  pageCount: 2,
  contentHash: "hash-1",
  importedAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  extraction: { status: "complete", warnings: [] },
};

function ok<T>(value: T): SourceMaterialResult<T> {
  return { ok: true, value };
}

function workspaceStatus(registered: boolean): SourceMaterialWorkspaceStatus {
  return {
    studioWorkspaceId: "ws-1",
    coreWorkspaceId: "studio:ws-1",
    registered,
    ...(registered ? { displayName: WORKSPACE.name } : {}),
    sourceCount: 0,
  };
}

function createApi(options: { registered?: boolean; sources?: SourceMaterialSummary[] } = {}) {
  let registered = options.registered ?? false;
  const api: DesktopSourceMaterialsAPI = {
    getWorkspaceStatus: vi.fn(async () => ok(workspaceStatus(registered))),
    registerWorkspace: vi.fn(async () => {
      registered = true;
      return ok(workspaceStatus(true));
    }),
    listSources: vi.fn(async () => ok(options.sources ?? [])),
    importFiles: vi.fn(async () => ok({ canceled: true, items: [] })),
    getFileBytes: vi.fn(async () => ok({
      sourceId: PDF_SOURCE.id,
      name: PDF_SOURCE.name,
      mimeType: PDF_SOURCE.mimeType,
      bytes: new Uint8Array(),
    })),
    getPage: vi.fn(async (_workspaceId: string, _sourceId: string, pageNumber: number) => ok({
      source: PDF_SOURCE,
      page: {
        sourceId: PDF_SOURCE.id,
        pageNumber,
        text: `${pageNumber}ページ目の本文`,
        semanticType: "page",
      },
    } satisfies SourceMaterialPageResult)),
    getPageImage: vi.fn(async (_workspaceId: string, _sourceId: string, pageNumber: number) => ok({
      sourceId: PDF_SOURCE.id,
      pageNumber,
      pageCount: 2,
      width: 600,
      height: 800,
      scale: 1.5,
      png: new Uint8Array([137, 80, 78, 71]),
    } satisfies SourceMaterialPageImage)),
    getPageRange: vi.fn(),
    getExtractionInfo: vi.fn(async () => ok([])),
    search: vi.fn(async () => ok([])),
    deleteSource: vi.fn(async () => ok({ deleted: true })),
    restoreSource: vi.fn(async () => ok({ restored: true })),
  };
  return api;
}

function flush(): Promise<void> {
  return act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 5));
  });
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await flush();
  }
}

function click(element: Element): Promise<void> {
  return act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function buttonWithText(container: ParentNode, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find((candidate) =>
    candidate.textContent?.includes(text),
  );
  if (!button) throw new Error(`button not found: ${text}`);
  return button;
}

describe("SourceMaterialsPage", () => {
  let root: Root | null = null;
  let container: HTMLDivElement;
  let api: DesktopSourceMaterialsAPI;

  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    setAppLocale("ja");
    vi.clearAllMocks();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:source-page"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    vi.mocked(listWorkspaceOverview).mockResolvedValue({
      state: "ready",
      overview: {
        activeWorkspaceId: WORKSPACE.id,
        workspaces: [WORKSPACE],
        folders: [],
        files: [],
      },
    });
    api = createApi();
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
      root = null;
    }
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  async function mount(nextApi: DesktopSourceMaterialsAPI = api): Promise<void> {
    api = nextApi;
    vi.mocked(getDesktopBridge).mockReturnValue({ sourceMaterials: api } as DesktopAPI);
    container = document.createElement("div");
    document.body.append(container);
    const nextRoot = createRoot(container);
    root = nextRoot;
    await act(async () => {
      nextRoot.render(<SourceMaterialsPage />);
    });
    await flush();
  }

  async function selectWorkspace(): Promise<void> {
    const trigger = container.querySelector<HTMLButtonElement>("#sources-workspace-select");
    if (!trigger) throw new Error("workspace select not found");
    await click(trigger);
    await flush();
    const option = document.querySelector<HTMLElement>('[role="option"][data-value="ws-1"]');
    if (!option) throw new Error("workspace option not found");
    await click(option);
    await flush();
  }

  it("requires an explicit workspace selection before touching Core", async () => {
    await mount();
    expect(container.textContent).toContain("Workspaceを選択してください");
    expect(container.textContent).toContain("対象のWorkspaceを明示的に選択してください");
    expect(api.getWorkspaceStatus).not.toHaveBeenCalled();
    expect(api.listSources).not.toHaveBeenCalled();
  });

  it("registers the selected workspace only after the enable action", async () => {
    await mount();
    await selectWorkspace();

    await waitFor(
      () => (api.getWorkspaceStatus as ReturnType<typeof vi.fn>).mock.calls.length === 1,
      "workspace status",
    );
    expect(api.getWorkspaceStatus).toHaveBeenCalledWith("ws-1");
    expect(container.textContent).toContain("このWorkspaceで資料を有効にする");
    expect(api.registerWorkspace).not.toHaveBeenCalled();

    await click(buttonWithText(container, "資料を有効にする"));
    await waitFor(
      () => (api.registerWorkspace as ReturnType<typeof vi.fn>).mock.calls.length === 1,
      "workspace registration",
    );
    expect(api.registerWorkspace).toHaveBeenCalledWith("ws-1", "理科資料");
    await waitFor(() => container.textContent?.includes("資料がありません") ?? false, "empty list");
    expect(api.listSources).toHaveBeenCalledWith("ws-1");
    expect(container.textContent).toContain("このWorkspaceで資料を有効にしました");
  });

  it("shows a PDF page image, navigates pages, and exposes extracted text", async () => {
    await mount(createApi({ registered: true, sources: [PDF_SOURCE] }));
    await selectWorkspace();

    await waitFor(
      () => container.textContent?.includes(PDF_SOURCE.name) ?? false,
      "source list",
    );
    await click(buttonWithText(container, PDF_SOURCE.name));

    await waitFor(
      () => (api.getPageImage as ReturnType<typeof vi.fn>).mock.calls.length > 0,
      "page image request",
    );
    expect(api.getPageImage).toHaveBeenCalledWith("ws-1", PDF_SOURCE.id, 1, 1.5);
    const image = container.querySelector<HTMLImageElement>("img.sources-page-image");
    expect(image?.getAttribute("alt")).toContain(PDF_SOURCE.name);
    expect(image?.getAttribute("src")).toBe("blob:source-page");

    const nextPage = container.querySelector<HTMLButtonElement>('[aria-label="次のページ"]');
    if (!nextPage) throw new Error("next page button not found");
    await click(nextPage);
    await waitFor(
      () => (api.getPageImage as ReturnType<typeof vi.fn>).mock.calls.some((call) => call[2] === 2),
      "second page image",
    );

    await click(buttonWithText(container, "抽出テキスト"));
    await waitFor(() => container.querySelector("pre.sources-text") !== null, "extracted text");
    expect(container.querySelector("pre.sources-text")?.textContent).toBe("2ページ目の本文");
  });
});
