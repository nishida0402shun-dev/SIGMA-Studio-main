"use client";

import { useEffect, useMemo, useState } from "react";
import { Database, Download, FilePlus2, FileText, MessageSquare, Search, X } from "lucide-react";
import { getDesktopBridge } from "@/lib/desktop-bridge";
import type { KnowledgeSemanticType, KnowledgeSource } from "@/types/knowledge-db";

interface Props {
  open: boolean;
  onClose: () => void;
  onOpenAi: () => void;
}

const TYPES: Array<{ value: KnowledgeSemanticType; label: string }> = [
  { value: "problem", label: "問題" },
  { value: "example", label: "例題" },
  { value: "explanation", label: "解説" },
  { value: "column", label: "コラム" },
  { value: "definition", label: "定義" },
  { value: "theorem", label: "定理" },
  { value: "answer", label: "解答" },
  { value: "figure", label: "図・表" },
];

export function KnowledgeDbWorkspace({ open, onClose, onOpenAi }: Props) {
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Record<string, Set<number>>>({});
  const [typeFilter, setTypeFilter] = useState<KnowledgeSemanticType | "all">("all");
  const desktop = getDesktopBridge();

  useEffect(() => {
    if (!open || !desktop) return;
    let cancelled = false;
    void desktop.knowledgeDb.list().then((value) => {
      if (!cancelled && Array.isArray(value)) setSources(value as KnowledgeSource[]);
    });
    return () => { cancelled = true; };
  }, [desktop, open]);

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
    if (!desktop) return;
    const picked = await desktop.knowledgeDb.chooseSources();
    if (!picked?.paths?.length) return;
    const added = await desktop.knowledgeDb.importSources(picked.paths);
    setSources((current) => [...(added as KnowledgeSource[]), ...current]);
  }

  async function extractPdf(): Promise<void> {
    if (!desktop || selectedPages.length === 0) return;
    const grouped = new Map<string, number[]>();
    for (const item of selectedPages) grouped.set(item.sourceId, [...(grouped.get(item.sourceId) ?? []), item.pageNumber]);
    if (grouped.size !== 1) return;
    const [sourceId, pageNumbers] = [...grouped.entries()][0]!;
    await desktop.knowledgeDb.extractPages({ sourceId, pageNumbers });
  }

  async function handoffAi(): Promise<void> {
    onOpenAi();
  }

  return (
    <div className="knowledge-db-backdrop" role="dialog" aria-modal="true" aria-label="DB">
      <section className="knowledge-db-workspace">
        <header className="knowledge-db-header">
          <div className="knowledge-db-title"><Database size={20} /><strong>DB</strong></div>
          <div className="knowledge-db-actions">
            <button type="button" onClick={() => void addSources()}><FilePlus2 size={16} />追加</button>
            <button type="button" onClick={() => void extractPdf()} disabled={selectedPages.length === 0}><Download size={16} />PDF抽出</button>
            <button type="button" onClick={() => void handoffAi()}><MessageSquare size={16} />AIに渡す</button>
            <button type="button" className="knowledge-db-close" onClick={onClose} aria-label="DBを閉じる"><X size={18} /></button>
          </div>
        </header>
        <div className="knowledge-db-toolbar">
          <label className="knowledge-db-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="教材・ページ・タイトルを検索" /></label>
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as KnowledgeSemanticType | "all")}>
            <option value="all">すべて</option>
            {TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
          </select>
          <span>{visible.length}件</span>
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
                    <span>p.{page.pageNumber} · {TYPES.find((type) => type.value === page.semanticType)?.label ?? "未分類"}</span>
                  </span>
                </label>
              );
            })}
            {visible.length === 0 && <div className="knowledge-db-empty">DBにPDFを追加してください。</div>}
          </div>
          <aside className="knowledge-db-detail">
            <strong>選択中</strong>
            <span>{selectedPages.length}ページ</span>
            <p>ページを選択すると、元PDFのページをそのまま抽出できます。意味分類は解析器を接続すると自動更新されます。</p>
          </aside>
        </div>
      </section>
    </div>
  );
}
