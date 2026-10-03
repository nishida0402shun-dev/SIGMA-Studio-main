/* eslint-disable no-restricted-syntax, no-alert -- Knowledge DB UI uses native confirmation and intentionally localized literals. */
"use client";

import { useEffect, useMemo, useState } from "react";
import { BookmarkPlus, ChevronDown, ChevronRight, Database, Download, ExternalLink, FilePlus2, FileText, Folder, History, MessageSquare, Search, Trash2, X } from "lucide-react";
import { KnowledgePdfPageViewer, type KnowledgeRegion } from "./KnowledgePdfPageViewer";
import { getDesktopBridge } from "@/lib/desktop-bridge";
import type { KnowledgeDbAiContext, KnowledgeSearchResult, KnowledgeSemanticType, KnowledgeSource } from "@/types/knowledge-db";
import type { Translate } from "@/lib/i18n";

interface Props {
  open: boolean;
  onClose: () => void;
  onOpenAi: (context?: KnowledgeDbAiContext[]) => void;
  t: Translate<"chrome">;
}

interface ResearchSession {
  id: string;
  title: string;
  query: string;
  sourceReferences: Array<{ sourceId: string; sourceName: string; pageNumber: number; pageId?: string }>;
  createdAt: string;
  updatedAt: string;
}

const TYPES: KnowledgeSemanticType[] = ["problem", "example", "explanation", "column", "definition", "theorem", "answer", "figure"];

function IndexStatusBadge({ knowledgeDb }: { knowledgeDb: NonNullable<ReturnType<typeof getDesktopBridge>>["knowledgeDb"] | undefined }): React.ReactElement | null {
  const [status, setStatus] = useState<{ state: string; total: number; completed: number; error?: string } | null>(null);
  const [structureStatus, setStructureStatus] = useState<{ available: boolean; engine: string | null; source: string; error?: string } | null>(null);
  useEffect(() => {
    if (!knowledgeDb) return;
    let cancelled = false;
    const refresh = () => void knowledgeDb.getIndexStatus().then((value) => {
      if (!cancelled && value && typeof value === "object") setStatus(value as typeof status);
    });
    void knowledgeDb.getStructureParserStatus().then((value) => {
      if (!cancelled && value && typeof value === "object") setStructureStatus(value as typeof structureStatus);
    }).catch(() => {
      if (!cancelled) setStructureStatus(null);
    });
    void knowledgeDb.startIndexing().then(refresh);
    refresh();
    const timer = window.setInterval(refresh, 800);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [knowledgeDb]);
  if (!status || (status.state === "completed" && status.total === 0)) return null;
  if (status.state === "running") return <span className="knowledge-db-index-status">Indexing {status.completed}/{status.total}</span>;
  if (status.state === "failed") return <button type="button" className="knowledge-db-index-status error" onClick={() => void knowledgeDb?.startIndexing()}>Index retry</button>;
  return (
    <>
      <span className="knowledge-db-index-status">Index complete</span>
      {structureStatus && (
        <span
          className="knowledge-db-index-status"
          title={structureStatus.available ? "PP-StructureV3: PDFのOCR・表・図・数式などの構造解析が利用可能" : structureStatus.error || "PP-StructureV3が利用できません"}
        >
          {structureStatus.available ? "Structure OCR ready" : "Structure OCR unavailable"}
        </span>
      )}
    </>
  );
}

interface TaxonomyTreeNode {
  key: string;
  name: string;
  path: string[];
  children: TaxonomyTreeNode[];
  pages: Array<{ source: KnowledgeSource; page: KnowledgeSource["pages"][number] }>;
}

function buildTaxonomyTreeStable(sources: KnowledgeSource[]): TaxonomyTreeNode[] {
  const roots: TaxonomyTreeNode[] = [];
  const ensure = (siblings: TaxonomyTreeNode[], name: string, path: string[]): TaxonomyTreeNode => {
    const key = path.join("\\u001f");
    const existing = siblings.find((node) => node.key === key);
    if (existing) return existing;
    const created: TaxonomyTreeNode = { key, name, path, children: [], pages: [] };
    siblings.push(created);
    return created;
  };
  for (const source of sources) {
    for (const page of source.pages) {
      for (const path of page.taxonomyPaths ?? []) {
        let siblings = roots;
        const traversed: string[] = [];
        for (const name of path) {
          traversed.push(name);
          const node = ensure(siblings, name, [...traversed]);
          if (!node.pages.some((item) => item.source.id === source.id && item.page.id === page.id)) {
            node.pages.push({ source, page });
          }
          siblings = node.children;
        }
      }
    }
  }
  const sort = (nodes: TaxonomyTreeNode[]): TaxonomyTreeNode[] => nodes
    .sort((a, b) => a.name.localeCompare(b.name, "ja"))
    .map((node) => ({ ...node, children: sort(node.children) }));
  return sort(roots);
}

function semanticTypeLabel(t: Translate<"chrome">, type: KnowledgeSemanticType): string {
  switch (type) {
    case "problem": return t("appMenu.knowledgeDb.types.problem");
    case "example": return t("appMenu.knowledgeDb.types.example");
    case "explanation": return t("appMenu.knowledgeDb.types.explanation");
    case "column": return t("appMenu.knowledgeDb.types.column");
    case "definition": return t("appMenu.knowledgeDb.types.definition");
    case "theorem": return t("appMenu.knowledgeDb.types.theorem");
    case "answer": return t("appMenu.knowledgeDb.types.answer");
    case "figure": return t("appMenu.knowledgeDb.types.figure");
    default: return t("appMenu.knowledgeDb.unclassified");
  }
}


function TaxonomyNode({
  node,
  depth,
  expanded,
  onToggle,
  onSelect,
}: {
  node: TaxonomyTreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (key: string) => void;
  onSelect: (node: TaxonomyTreeNode) => void;
}) {
  const isExpanded = expanded.has(node.key);
  const hasChildren = node.children.length > 0;
  const icon = hasChildren ? (isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />) : <span className="knowledge-db-tree-spacer" />;
  return (
    <div className="knowledge-db-tree-node">
      <button
        type="button"
        className="knowledge-db-tree-row"
        style={{ paddingLeft: 8 + depth * 18 }}
        onClick={() => {
          if (hasChildren) onToggle(node.key);
          onSelect(node);
        }}
      >
        {icon}
        <Folder size={16} />
        <span>{node.name}</span>
        <small>{node.pages.length}</small>
      </button>
      {isExpanded && node.children.map((child) => (
        <TaxonomyNode key={child.key} node={child} depth={depth + 1} expanded={expanded} onToggle={onToggle} onSelect={onSelect} />
      ))}
    </div>
  );
}

export function KnowledgeDbWorkspace({ open, onClose, onOpenAi, t }: Props) {
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Record<string, Set<number>>>({});
  const [typeFilter, setTypeFilter] = useState<KnowledgeSemanticType | "all">("all");
  const [searchResults, setSearchResults] = useState<KnowledgeSearchResult[]>([]);
  const [region, setRegion] = useState<KnowledgeRegion | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [researchSessions, setResearchSessions] = useState<ResearchSession[]>([]);
  const [relatedSources, setRelatedSources] = useState<Array<{ sourceId: string; sourceName: string; score: number; pageNumber: number }>>([]);
  const [expandedTaxonomy, setExpandedTaxonomy] = useState<Set<string>>(new Set());
  const [selectedTaxonomyNode, setSelectedTaxonomyNode] = useState<TaxonomyTreeNode | null>(null);
  const desktop = getDesktopBridge();
  const researchApi = desktop?.researchSessions;
  const knowledgeDb = desktop?.knowledgeDb;

  useEffect(() => {
    if (!open || !knowledgeDb) return;
    let cancelled = false;
    void knowledgeDb.list().then((value) => {
      if (!cancelled && Array.isArray(value)) setSources(value as KnowledgeSource[]);
    });
    return () => { cancelled = true; };
  }, [knowledgeDb, open]);

  useEffect(() => {
    if (!open || !researchApi) return;
    let cancelled = false;
    void researchApi.list().then((value) => {
      if (!cancelled && Array.isArray(value)) setResearchSessions(value as ResearchSession[]);
    });
    return () => { cancelled = true; };
  }, [open, researchApi]);

  useEffect(() => {
    if (!knowledgeDb || !query.trim()) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void knowledgeDb.search({ query, limit: 30 }).then((value) => {
        if (!cancelled) setSearchResults((Array.isArray(value) ? value : []) as KnowledgeSearchResult[]);
      });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [knowledgeDb, query]);

  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) {
      return sources.flatMap((source) => source.pages.map((page) => ({ source, page, score: undefined as number | undefined })))
        .filter(({ page }) => typeFilter === "all" || page.semanticType === typeFilter);
    }
    return searchResults.flatMap((result) => {
      const source = sources.find((item) => item.id === result.sourceId);
      const page = source?.pages.find((item) => item.pageNumber === result.pageNumber);
      return source && page ? [{ source, page, score: result.score }] : [];
    }).filter(({ page }) => typeFilter === "all" || page.semanticType === typeFilter);
  }, [query, searchResults, sources, typeFilter]);

  const taxonomyTree = useMemo(() => buildTaxonomyTreeStable(sources), [sources]);

  const selectedPages = Object.entries(selected).flatMap(([sourceId, pages]) =>
    [...pages].map((pageNumber) => ({ sourceId, pageNumber })),
  );

  useEffect(() => {
    const sourceId = selectedPages[0]?.sourceId;
    if (!knowledgeDb || !sourceId) {
      setRelatedSources([]);
      return;
    }
    let cancelled = false;
    void knowledgeDb.related({ sourceId, limit: 6 }).then((value) => {
      if (!cancelled) setRelatedSources((Array.isArray(value) ? value : []) as typeof relatedSources);
    }).catch(() => {
      if (!cancelled) setRelatedSources([]);
    });
    return () => { cancelled = true; };
  }, [knowledgeDb, selectedPages.length, selectedPages[0]?.sourceId]);

  if (!open) return null;

  async function saveResearchSession(): Promise<void> {
    if (!researchApi) return;
    const researchQuery = query.trim() || "選択したKnowledge DB資料の調査";
    const sourceReferences = selectedPages.flatMap(({ sourceId, pageNumber }) => {
      const source = sources.find((item) => item.id === sourceId);
      const page = source?.pages.find((item) => item.pageNumber === pageNumber);
      return source && page ? [{
        sourceId,
        sourceName: source.name,
        pageNumber,
        pageId: page.id,
      }] : [];
    });
    const created = await researchApi.create({ query: researchQuery, sourceReferences });
    if (created && typeof created === "object") {
      setResearchSessions((current) => [created as ResearchSession, ...current.filter((item) => item.id !== (created as ResearchSession).id)].slice(0, 200));
    }
  }

  async function loadResearchSession(id: string): Promise<void> {
    const session = researchSessions.find((item) => item.id === id);
    if (!session) return;
    setQuery(session.query);
    setSelected(() => {
      const next: Record<string, Set<number>> = {};
      for (const ref of session.sourceReferences) {
        next[ref.sourceId] = new Set([...(next[ref.sourceId] ?? []), ref.pageNumber]);
      }
      return next;
    });
  }

  async function addSources(): Promise<void> {
    if (!knowledgeDb) return;
    const picked = await knowledgeDb.chooseSources();
    if (!picked?.paths?.length) return;
    const added = await knowledgeDb.importSources({ paths: picked.paths });
    setSources((current) => [...(added as KnowledgeSource[]), ...current]);
  }

  async function extractPdf(): Promise<void> {
    if (!knowledgeDb || selectedPages.length === 0) return;
    const grouped = new Map<string, number[]>();
    for (const item of selectedPages) {
      grouped.set(item.sourceId, [...(grouped.get(item.sourceId) ?? []), item.pageNumber]);
    }
    const selections = [...grouped.entries()].map(([sourceId, pageNumbers]) => ({
      sourceId,
      pageNumbers,
    }));
    await knowledgeDb.extractPages({ selections });
  }

  async function updateSelectedPageType(semanticType: KnowledgeSemanticType): Promise<void> {
    if (!knowledgeDb || selectedPages.length === 0) return;
    const target = selectedPages[0];
    const result = await knowledgeDb.setPageType({
      sourceId: target.sourceId,
      pageNumber: target.pageNumber,
      semanticType,
    });
    if (!result) return;
    setSources((current) => current.map((source) => {
      if (source.id !== target.sourceId) return source;
      return {
        ...source,
        pages: source.pages.map((page) =>
          page.pageNumber === target.pageNumber ? { ...page, semanticType } : page,
        ),
      };
    }));
  }

  async function openSelectedPage(): Promise<void> {
    if (!knowledgeDb || selectedPages.length === 0) return;
    const target = selectedPages[0];
    const result = await knowledgeDb.openPage({ ...target });
    if (!result.ok) console.warn("Knowledge DB page open failed:", result.error);
  }

  async function deleteSource(sourceId: string): Promise<void> {
    if (!knowledgeDb) return;
    const source = sources.find((item) => item.id === sourceId);
    if (!source || !window.confirm(`Knowledge DBから「${source.name}」を削除しますか？`)) return;
    const result = await knowledgeDb.deleteSource({ sourceId });
    if (!result.ok) return;
    setSources((current) => current.filter((item) => item.id !== sourceId));
    setSelected((current) => {
      const next = { ...current };
      delete next[sourceId];
      return next;
    });
    setSearchResults((current) => current.filter((item) => item.sourceId !== sourceId));
  }

  async function handoffAi(action?: string): Promise<void> {
    const context = selectedPages.flatMap(({ sourceId, pageNumber }) => {
      const source = sources.find((item) => item.id === sourceId);
      const page = source?.pages.find((item) => item.pageNumber === pageNumber);
      if (!source || !page) return [];
      const structuredText = (page as { structureBlocks?: Array<{ type?: string; text?: string }> }).structureBlocks
        ?.map((block) => block.text?.trim() ? `[${block.type || "text"}] ${block.text.trim()}` : "")
        .filter(Boolean)
        .join("\\n") || "";
      const pageText = page.text?.trim() || structuredText;
      if (!pageText) return [];
      return [{
        sourceId,
        pageId: page.id,
        sourceName: source.name,
        pageNumber: page.pageNumber,
        semanticType: page.semanticType,
        text: [action ? `【AI操作: ${action}】` : "", pageText].filter(Boolean).join("\\n"),
      } satisfies KnowledgeDbAiContext];
    });
    onOpenAi(context);
    setContextMenu(null);
  }

  async function extractRegionPdf(): Promise<void> {
    if (!knowledgeDb || selectedPages.length === 0 || !region) return;
    const target = selectedPages[0];
    const result = await knowledgeDb.extractRegion({ sourceId: target.sourceId, pageNumber: target.pageNumber, rect: region });
    if (!result.ok) console.warn("Knowledge DB region extraction failed:", result.error);
    setContextMenu(null);
  }

  return (
    <>
      <style>{`.knowledge-db-backdrop {
  position: fixed;
  inset: 0;
  z-index: 150;
  display: flex;
  align-items: stretch;
  justify-content: center;
  padding: 18px;
  background: rgb(15 23 42 / 0.28);
  backdrop-filter: blur(2px);
}

.app-shell[data-ai-sidebar-open="true"] .knowledge-db-backdrop {
  right: var(--ai-sidebar-width);
}

.knowledge-db-workspace {
  width: min(1500px, 100%);
  height: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgb(148 163 184 / 0.42);
  border-radius: 16px;
  background: rgb(255 255 255 / 0.96);
  box-shadow: 0 24px 70px rgb(15 23 42 / 0.24);
}

.knowledge-db-header,
.knowledge-db-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid rgb(148 163 184 / 0.24);
}

.knowledge-db-header {
  justify-content: space-between;
}

.knowledge-db-title,
.knowledge-db-actions,
.knowledge-db-search {
  display: flex;
  align-items: center;
  gap: 8px;
}

.knowledge-db-add-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 6px 11px;
  border: 1px solid rgb(100 116 139 / 0.3);
  border-radius: 8px;
  background: white;
  cursor: pointer;
  font-weight: 600;
}

.knowledge-db-add-button:hover:not(:disabled) {
  background: rgb(241 245 249 / 0.95);
}

.knowledge-db-add-button:disabled {
  opacity: 0.45;
  cursor: default;
}

.knowledge-db-actions button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 6px 10px;
  border: 1px solid rgb(100 116 139 / 0.3);
  border-radius: 8px;
  background: rgb(255 255 255 / 0.86);
  cursor: pointer;
}

.knowledge-db-actions button:hover:not(:disabled) {
  background: rgb(241 245 249 / 0.95);
}

.knowledge-db-actions button:disabled {
  opacity: 0.45;
  cursor: default;
}

.knowledge-db-close {
  border: 0 !important;
  background: transparent !important;
}

.knowledge-db-toolbar {
  flex-wrap: wrap;
}

.knowledge-db-search {
  flex: 1 1 320px;
  min-width: 220px;
  padding: 7px 10px;
  border: 1px solid rgb(100 116 139 / 0.28);
  border-radius: 8px;
}

.knowledge-db-search input {
  width: 100%;
  border: 0;
  outline: 0;
  background: transparent;
}

.knowledge-db-index-status {\n  display: inline-flex;\n  align-items: center;\n  font-size: 12px;\n  opacity: 0.8;\n}\n\n.knowledge-db-index-status.error {\n  cursor: pointer;\n  border: 0;\n  background: transparent;\n  text-decoration: underline;\n}\n\n.knowledge-db-session-select {\n  display: inline-flex;\n  align-items: center;\n  gap: 5px;\n}\n\n.knowledge-db-toolbar select {
  min-height: 34px;
  padding: 5px 9px;
  border: 1px solid rgb(100 116 139 / 0.28);
  border-radius: 8px;
  background: white;
}

.knowledge-db-content {
  min-height: 0;
  flex: 1;
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr) 300px;
}

.knowledge-db-taxonomy {
  min-width: 0;
  overflow: auto;
  padding: 10px 6px;
  border-right: 1px solid rgb(148 163 184 / 0.24);
  background: rgb(248 250 252 / 0.72);
}

.knowledge-db-taxonomy-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px 10px;
  font-size: 13px;
}

.knowledge-db-taxonomy-header button {
  border: 0;
  background: transparent;
  color: rgb(71 85 105);
  font-size: 11px;
  cursor: pointer;
}

.knowledge-db-tree-row {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 32px;
  gap: 6px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: rgb(30 41 59);
  text-align: left;
  cursor: pointer;
}

.knowledge-db-tree-row:hover {
  background: rgb(226 232 240 / 0.8);
}

.knowledge-db-tree-row span {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.knowledge-db-tree-row small {
  color: rgb(100 116 139);
  font-size: 10px;
}

.knowledge-db-tree-spacer {
  width: 15px;
  flex: 0 0 15px;
}

.knowledge-db-breadcrumb {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  padding: 7px 9px;
  border-radius: 8px;
  background: rgb(241 245 249);
  font-size: 12px;
  color: rgb(51 65 85);
}

.knowledge-db-results {
  min-width: 0;
  overflow: auto;
  padding: 10px;
}

.knowledge-db-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 9px;
  cursor: pointer;
}

.knowledge-db-item:hover,
.knowledge-db-item.selected {
  background: rgb(226 232 240 / 0.58);
}

.knowledge-db-item-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.knowledge-db-item-main strong,
.knowledge-db-item-main span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.knowledge-db-item-main span {
  font-size: 12px;
  color: rgb(71 85 105);
}

.knowledge-db-detail {
  min-width: 0;
  padding: 18px;
  border-left: 1px solid rgb(148 163 184 / 0.24);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.knowledge-db-detail span {
  font-size: 24px;
  font-weight: 700;
}

.knowledge-db-detail-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 34px;
  padding: 6px 10px;
  border: 1px solid rgb(100 116 139 / 0.3);
  border-radius: 8px;
  background: white;
  cursor: pointer;
}

.knowledge-db-type-editor {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
}

.knowledge-db-type-editor select {
  min-height: 32px;
  padding: 5px 8px;
  border: 1px solid rgb(100 116 139 / 0.28);
  border-radius: 8px;
  background: white;
}

.knowledge-db-source-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
}

.knowledge-db-source-list > strong {
  font-size: 13px;
}

.knowledge-db-source-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.knowledge-db-source-row span {
  min-width: 0;
  flex: 1;
  font-size: 12px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.knowledge-db-source-row button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  border: 0;
  border-radius: 7px;
  background: transparent;
  cursor: pointer;
}

.knowledge-db-source-row button:hover {
  background: rgb(248 113 113 / 0.14);
}

.knowledge-db-page-preview {
  min-height: 180px;
  max-height: 520px;
  overflow: auto;
  padding: 8px;
  border: 1px solid rgb(148 163 184 / 0.28);
  border-radius: 10px;
  background: rgb(248 250 252);
}

.knowledge-db-region-status {
  font-size: 11px;
  color: rgb(71 85 105);
}

.knowledge-db-context-menu {
  position: fixed;
  z-index: 100;
  min-width: 190px;
  padding: 6px;
  border: 1px solid rgb(148 163 184 / 0.35);
  border-radius: 10px;
  background: white;
  box-shadow: 0 16px 36px rgb(15 23 42 / 0.2);
}

.knowledge-db-context-menu button {
  display: block;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.knowledge-db-context-menu button:hover { background: rgb(241 245 249); }

.knowledge-db-detail p,
.knowledge-db-empty {
  color: rgb(71 85 105);
  line-height: 1.6;
}

@media (max-width: 900px) {
  .knowledge-db-content {
    grid-template-columns: 1fr;
  }

  .knowledge-db-taxonomy {
    display: none;
  }

  .knowledge-db-detail {
    display: none;
  }

  .knowledge-db-actions button {
    padding-inline: 8px;
  }
}
`}</style>
      <div className="knowledge-db-backdrop" role="dialog" aria-modal="true" aria-label={t("appMenu.knowledgeDb.title")}>
      <section className="knowledge-db-workspace">
        <header className="knowledge-db-header">
          <div className="knowledge-db-title"><Database size={20} /><strong>{t("appMenu.knowledgeDb.title")}</strong></div>
          <div className="knowledge-db-actions">
            <button type="button" onClick={() => void extractPdf()} disabled={selectedPages.length === 0}><Download size={16} />{t("appMenu.knowledgeDb.extractPdf")}</button>
            <button type="button" onClick={() => void saveResearchSession()} disabled={!researchApi}><BookmarkPlus size={16} />研究を保存</button>
            <button type="button" onClick={() => void handoffAi()}><MessageSquare size={16} />{t("appMenu.knowledgeDb.handoffAi")}</button>
            <button type="button" className="knowledge-db-close" onClick={onClose} aria-label={t("appMenu.knowledgeDb.close")}><X size={18} /></button>
          </div>
        </header>
        <div className="knowledge-db-toolbar">
          <button type="button" className="knowledge-db-add-button" onClick={() => void addSources()} ><FilePlus2 size={16} />{t("appMenu.knowledgeDb.add")}</button>
          <label className="knowledge-db-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("appMenu.knowledgeDb.searchPlaceholder")} /></label>
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as KnowledgeSemanticType | "all")}>
            <option value="all">{t("appMenu.knowledgeDb.allTypes")}</option>
            {TYPES.map((type) => <option key={type} value={type}>{semanticTypeLabel(t, type)}</option>)}
          </select>
          <span>{t("appMenu.knowledgeDb.resultCount", { count: visible.length })}</span>
          <IndexStatusBadge knowledgeDb={knowledgeDb} />
          <label className="knowledge-db-session-select" title="Research Session">
            <History size={15} />
            <select defaultValue="" onChange={(event) => void loadResearchSession(event.target.value)}>
              <option value="">Research Session</option>
              {researchSessions.map((session) => <option key={session.id} value={session.id}>{session.title}</option>)}
            </select>
          </label>
        </div>
        <div className="knowledge-db-content">
          {!query.trim() && (
            <aside className="knowledge-db-taxonomy">
              <div className="knowledge-db-taxonomy-header">
                <strong>分類</strong>
                <button type="button" onClick={() => setExpandedTaxonomy(new Set())}>すべて閉じる</button>
              </div>
              {taxonomyTree.length === 0 ? (
                <p className="knowledge-db-empty">解析済みの分類がまだありません。</p>
              ) : taxonomyTree.map((node) => (
                <TaxonomyNode
                  key={node.key}
                  node={node}
                  depth={0}
                  expanded={expandedTaxonomy}
                  onToggle={(key) => setExpandedTaxonomy((current) => {
                    const next = new Set(current);
                    if (next.has(key)) next.delete(key); else next.add(key);
                    return next;
                  })}
                  onSelect={(node) => {
                    setSelectedTaxonomyNode(node);
                    setSelected(() => {
                      const next: Record<string, Set<number>> = {};
                      for (const item of node.pages) {
                        next[item.source.id] = new Set([...(next[item.source.id] ?? []), item.page.pageNumber]);
                      }
                      return next;
                    });
                  }}
                />
              ))}
            </aside>
          )}
          <div className="knowledge-db-results">
            {visible.map(({ source, page, score }) => {
              const checked = selected[source.id]?.has(page.pageNumber) ?? false;
              return (
                <label key={page.id} className={`knowledge-db-item ${checked ? "selected" : ""}`} onContextMenu={(event) => { event.preventDefault(); setSelected({ [source.id]: new Set([page.pageNumber]) }); setContextMenu({ x: event.clientX, y: event.clientY }); }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      setSelected((current) => {
                        const next = { ...current, [source.id]: new Set(current[source.id] ?? []) };
                        if (event.target.checked) next[source.id].add(page.pageNumber);
                        else next[source.id].delete(page.pageNumber);
                        return next;
                      });
                    }}
                  />
                  <FileText size={18} />
                  <span className="knowledge-db-item-main">
                    <strong>{source.name}</strong>
                    <span>{t("appMenu.knowledgeDb.page", { page: page.pageNumber })} · {semanticTypeLabel(t, page.semanticType)}{score !== undefined ? ` · ${score.toFixed(2)}` : ""}</span>
                  </span>
                </label>
              );
            })}
            {visible.length === 0 && <div className="knowledge-db-empty">{t("appMenu.knowledgeDb.empty")}</div>}
          </div>
          <aside className="knowledge-db-detail">
            {selectedTaxonomyNode && !query.trim() && (
              <div className="knowledge-db-breadcrumb">
                {selectedTaxonomyNode.path.map((part, index) => (
                  <span key={part}>{index > 0 ? " → " : ""}📁 {part}</span>
                ))}
              </div>
            )}
            <strong>{t("appMenu.knowledgeDb.selected")}</strong>
            <span>{t("appMenu.knowledgeDb.selectedPages", { count: selectedPages.length })}</span>
            {selectedPages.length > 0 && (
              <>
                <div
                  className="knowledge-db-page-preview"
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setContextMenu({ x: event.clientX, y: event.clientY });
                  }}
                >
                  <KnowledgePdfPageViewer
                    sourceId={selectedPages[0]!.sourceId}
                    pageNumber={selectedPages[0]!.pageNumber}
                    getPagePdf={(payload) => knowledgeDb?.getPagePdf(payload) ?? Promise.resolve(null)}
                    onRegionSelected={(nextRegion) => setRegion(nextRegion)}
                  />
                </div>
                {region && <span className="knowledge-db-region-status">範囲選択済み · {Math.round(region.width)} × {Math.round(region.height)}</span>}
                <button type="button" className="knowledge-db-detail-button" onClick={() => void openSelectedPage()}>
                  <ExternalLink size={15} />選択ページを開く
                </button>
                <label className="knowledge-db-type-editor">
                  <span>ページ分類</span>
                  <select
                    value={sources.find((source) => source.id === selectedPages[0]!.sourceId)?.pages.find((page) => page.pageNumber === selectedPages[0]!.pageNumber)?.semanticType ?? "unknown"}
                    onChange={(event) => void updateSelectedPageType(event.target.value as KnowledgeSemanticType)}
                  >
                    <option value="unknown">未分類</option>
                    {TYPES.map((type) => <option key={type} value={type}>{semanticTypeLabel(t, type)}</option>)}
                  </select>
                </label>
              </>
            )}
            <p>{t("appMenu.knowledgeDb.help")}</p>
            {selectedPages.length > 0 && relatedSources.length > 0 && (
              <div className="knowledge-db-source-list">
                <strong>関連資料</strong>
                {relatedSources.map((related) => (
                  <button
                    key={`${related.sourceId}:${related.pageNumber}`}
                    type="button"
                    className="knowledge-db-detail-button"
                    onClick={() => {
                      setSelected({ [related.sourceId]: new Set([related.pageNumber]) });
                      setQuery("");
                    }}
                  >
                    {related.sourceName} · p.{related.pageNumber}
                  </button>
                ))}
              </div>
            )}
            <div className="knowledge-db-source-list">
              <strong>登録資料</strong>
              {sources.map((source) => (
                <div key={source.id} className="knowledge-db-source-row" onContextMenu={(event) => { event.preventDefault(); setSelected({ [source.id]: new Set(source.pages.map((page) => page.pageNumber)) }); setRegion(null); setContextMenu({ x: event.clientX, y: event.clientY }); }}>
                  <span title={source.name}>{source.name} · {source.pageCount}p</span>
                  <button type="button" onClick={() => void deleteSource(source.id)} aria-label={`「${source.name}」を削除`}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </section>
      {contextMenu && selectedPages.length > 0 && (
        <div className="knowledge-db-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onMouseLeave={() => setContextMenu(null)}>
          <button type="button" onClick={() => void handoffAi(selectedPages.length > 1 ? "選択した資料・ページをまとめて確認する" : undefined)}>AIに送る</button>
          {region && <button type="button" onClick={() => void extractRegionPdf()}>選択範囲をPDF抽出</button>}
          <button type="button" onClick={() => void handoffAi("内容を解説する")}>解説する</button>
          <button type="button" onClick={() => void handoffAi("数値や条件を変更した類似問題を作る")}>数値を変える</button>
          <button type="button" onClick={() => void handoffAi("この問題の類題を3問作る")}>類題を作る</button>
          <button type="button" onClick={() => void handoffAi("選択資料を根拠に調査レポートを作る")}>レポートを作る</button>
          <button type="button" onClick={() => void handoffAi("選択資料を比較し、比較表を作る")}>比較表を作る</button>
          <button type="button" onClick={() => void handoffAi("選択資料の要点を根拠ページ付きで要約する")}>要約する</button>
          <button type="button" onClick={() => void handoffAi("この内容から練習問題を作る")}>問題を作る</button>
        </div>
      )}
      </div>
    </>
  );
}
