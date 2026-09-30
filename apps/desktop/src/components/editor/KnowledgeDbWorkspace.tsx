"use client";

import { useEffect, useMemo, useState } from "react";
import { Database, Download, FilePlus2, FileText, MessageSquare, Search, X } from "lucide-react";
import { getDesktopBridge } from "@/lib/desktop-bridge";
import type { KnowledgeSemanticType, KnowledgeSource } from "@/types/knowledge-db";
import type { Translate } from "@/lib/i18n";

interface Props {
  open: boolean;
  onClose: () => void;
  onOpenAi: () => void;
  t: Translate<"chrome">;
}

const TYPES: KnowledgeSemanticType[] = ["problem", "example", "explanation", "column", "definition", "theorem", "answer", "figure"];

export function KnowledgeDbWorkspace({ open, onClose, onOpenAi, t }: Props) {
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Record<string, Set<number>>>({});
  const [typeFilter, setTypeFilter] = useState<KnowledgeSemanticType | "all">("all");
  const desktop = getDesktopBridge();
  const knowledgeDb = desktop?.knowledgeDb;

  useEffect(() => {
    if (!open || !knowledgeDb) return;
    let cancelled = false;
    void knowledgeDb.list().then((value) => {
      if (!cancelled && Array.isArray(value)) setSources(value as KnowledgeSource[]);
    });
    return () => { cancelled = true; };
  }, [knowledgeDb, open]);

  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return sources.flatMap((source) => source.pages.map((page) => ({ source, page }))).filter(({ source, page }) => {
      if (typeFilter !== "all" && page.semanticType !== typeFilter) return false;
      if (!normalized) return true;
      return source.name.toLocaleLowerCase().includes(normalized)
        || String(page.pageNumber).includes(normalized)
        || (page.title ?? "").toLocaleLowerCase().includes(normalized)
        || (page.text ?? "").toLocaleLowerCase().includes(normalized);
    });
  }, [query, sources, typeFilter]);

  const selectedPages = Object.entries(selected).flatMap(([sourceId, pages]) =>
    [...pages].map((pageNumber) => ({ sourceId, pageNumber })),
  );

  if (!open) return null;

  async function addSources(): Promise<void> {
    if (!knowledgeDb) return;
    const picked = await knowledgeDb.chooseSources();
    if (!picked?.paths?.length) return;
    const added = await knowledgeDb.importSources(picked.paths);
    setSources((current) => [...(added as KnowledgeSource[]), ...current]);
  }

  async function extractPdf(): Promise<void> {
    if (!knowledgeDb || selectedPages.length === 0) return;
    const grouped = new Map<string, number[]>();
    for (const item of selectedPages) grouped.set(item.sourceId, [...(grouped.get(item.sourceId) ?? []), item.pageNumber]);
    if (grouped.size !== 1) return;
    const [sourceId, pageNumbers] = [...grouped.entries()][0]!;
    await knowledgeDb.extractPages({ sourceId, pageNumbers });
  }

  async function handoffAi(): Promise<void> {
    onOpenAi();
  }

  return (
    <>
      <style>{`.knowledge-db-backdrop {
  position: fixed;
  inset: 0;
  z-index: 30;
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

.knowledge-db-toolbar select {
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
  grid-template-columns: minmax(0, 1fr) 300px;
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

.knowledge-db-detail p,
.knowledge-db-empty {
  color: rgb(71 85 105);
  line-height: 1.6;
}

@media (max-width: 900px) {
  .knowledge-db-content {
    grid-template-columns: 1fr;
  }

  .knowledge-db-detail {
    display: none;
  }

  .knowledge-db-actions button {
    padding-inline: 8px;
  }
}
`}</style>
      <div className="knowledge-db-backdrop" role="dialog" aria-modal="true" aria-label={t("knowledgeDb.title")}>
      <section className="knowledge-db-workspace">
        <header className="knowledge-db-header">
          <div className="knowledge-db-title"><Database size={20} /><strong>{t("knowledgeDb.title")}</strong></div>
          <div className="knowledge-db-actions">
            <button type="button" onClick={() => void addSources()}><FilePlus2 size={16} />{t("knowledgeDb.add")}</button>
            <button type="button" onClick={() => void extractPdf()} disabled={selectedPages.length === 0}><Download size={16} />{t("knowledgeDb.extractPdf")}</button>
            <button type="button" onClick={() => void handoffAi()}><MessageSquare size={16} />{t("knowledgeDb.handoffAi")}</button>
            <button type="button" className="knowledge-db-close" onClick={onClose} aria-label={t("knowledgeDb.close")}><X size={18} /></button>
          </div>
        </header>
        <div className="knowledge-db-toolbar">
          <label className="knowledge-db-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("knowledgeDb.searchPlaceholder")} /></label>
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as KnowledgeSemanticType | "all")}>
            <option value="all">{t("knowledgeDb.allTypes")}</option>
            {TYPES.map((type) => <option key={type} value={type}>{t(`knowledgeDb.types.${type}`)}</option>)}
          </select>
          <span>{t("knowledgeDb.resultCount", { count: visible.length })}</span>
        </div>
        <div className="knowledge-db-content">
          <div className="knowledge-db-results">
            {visible.map(({ source, page }) => {
              const checked = selected[source.id]?.has(page.pageNumber) ?? false;
              return (
                <label key={page.id} className={`knowledge-db-item ${checked ? "selected" : ""}`}>
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
                    <span>{t("knowledgeDb.page", { page: page.pageNumber })} · {TYPES.includes(page.semanticType) ? t(`knowledgeDb.types.${page.semanticType}`) : t("knowledgeDb.unclassified")}</span>
                  </span>
                </label>
              );
            })}
            {visible.length === 0 && <div className="knowledge-db-empty">{t("knowledgeDb.empty")}</div>}
          </div>
          <aside className="knowledge-db-detail">
            <strong>{t("knowledgeDb.selected")}</strong>
            <span>{t("knowledgeDb.selectedPages", { count: selectedPages.length })}</span>
            <p>{t("knowledgeDb.help")}</p>
          </aside>
        </div>
      </section>
      </div>
    </>
  );
}
