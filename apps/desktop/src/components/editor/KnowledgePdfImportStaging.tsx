"use client";

import { useState } from "react";
import { Check, FileText, X } from "lucide-react";
import type { KnowledgePdfImportSegmentProposal, KnowledgePdfImportStaging } from "@/types/knowledge-db";

interface Props {
  staging: KnowledgePdfImportStaging;
  onChange: (staging: KnowledgePdfImportStaging) => void;
  onApprove: () => Promise<void>;
  onReject: () => Promise<void>;
  onClose: () => void;
}

export function KnowledgePdfImportStaging({
  staging,
  onChange,
  onApprove,
  onReject,
  onClose,
}: Props) {
  const [busy, setBusy] = useState(false);
  const selected = staging.segments.filter((segment) => segment.selected).length;

  function updateSegment(id: string, patch: Partial<KnowledgePdfImportSegmentProposal>): void {
    onChange({
      ...staging,
      segments: staging.segments.map((segment) =>
        segment.id === id ? { ...segment, ...patch } : segment,
      ),
    });
  }

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    try { await action(); } finally { setBusy(false); }
  }

  return (
    <div className="knowledge-db-staging-backdrop" role="dialog" aria-modal="true" aria-label="PDF取り込みプレビュー">
      <section className="knowledge-db-staging">
        <header className="knowledge-db-staging-header">
          <div>
            <div className="knowledge-db-staging-title"><FileText size={19} />AI分割・分類プレビュー</div>
            <p>{staging.sourceName} · {staging.pageCount}ページ · {selected}件を登録予定</p>
            <small>原本はまだKnowledge DBへ登録されていません。SHA-256: {staging.sourceHash}</small>
          </div>
          <button type="button" className="knowledge-db-close" onClick={onClose} disabled={busy}><X size={18} /></button>
        </header>

        <div className="knowledge-db-staging-notice">
          承認前は原本PDFも子PDFもKnowledge DBの登録資料には追加されません。分割範囲・名称・分類案を確認してから承認してください。
        </div>

        <div className="knowledge-db-staging-list">
          {staging.segments.map((segment) => (
            <article key={segment.id} className="knowledge-db-staging-card">
              <div className="knowledge-db-staging-card-top">
                <label>
                  <input
                    type="checkbox"
                    checked={segment.selected}
                    disabled={busy || staging.status !== "draft"}
                    onChange={(event) => updateSegment(segment.id, { selected: event.target.checked })}
                  />
                  登録
                </label>
                <span>AI信頼度 {Math.round(segment.confidence * 100)}%</span>
              </div>
              <div className="knowledge-db-staging-grid">
                <label>開始<input type="number" min={1} max={staging.pageCount} value={segment.startPage} disabled={busy} onChange={(event) => updateSegment(segment.id, { startPage: Number(event.target.value) })} /></label>
                <label>終了<input type="number" min={segment.startPage} max={staging.pageCount} value={segment.endPage} disabled={busy} onChange={(event) => updateSegment(segment.id, { endPage: Number(event.target.value) })} /></label>
                <label className="wide">名称<input value={segment.name} disabled={busy} onChange={(event) => updateSegment(segment.id, { name: event.target.value })} /></label>
              </div>
              <div className="knowledge-db-staging-paths">
                <strong>分類候補</strong>
                {segment.paths.length
                  ? segment.paths.map((path, index) => <span key={index}>{path.join(" → ")}</span>)
                  : <span>分類候補なし</span>}
              </div>
              <small>{segment.reason}</small>
            </article>
          ))}
        </div>

        <footer className="knowledge-db-staging-footer">
          <button type="button" onClick={() => void run(onReject)} disabled={busy || staging.status !== "draft"}><X size={15} />破棄</button>
          <button
            type="button"
            className="primary"
            disabled={busy || staging.status !== "draft" || selected === 0}
            onClick={() => void run(onApprove)}
          >
            <Check size={15} />承認してDBへ登録
          </button>
        </footer>
      </section>
    </div>
  );
}
