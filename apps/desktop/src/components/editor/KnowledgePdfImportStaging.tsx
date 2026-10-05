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
    <>
      <style>{`.knowledge-db-staging-backdrop{position:fixed;inset:0;z-index:220;display:flex;align-items:center;justify-content:center;padding:24px;background:rgb(15 23 42 / .38);backdrop-filter:blur(3px)}.knowledge-db-staging{width:min(1050px,100%);max-height:calc(100vh - 48px);display:flex;flex-direction:column;overflow:hidden;border:1px solid rgb(148 163 184 / .4);border-radius:16px;background:white;box-shadow:0 24px 80px rgb(15 23 42 / .28)}.knowledge-db-staging-header{display:flex;justify-content:space-between;gap:20px;padding:16px;border-bottom:1px solid rgb(148 163 184 / .25)}.knowledge-db-staging-title{display:flex;align-items:center;gap:8px;font-weight:700}.knowledge-db-staging-header p{margin:5px 0;font-size:12px;color:rgb(71 85 105)}.knowledge-db-staging-header small{font-size:10px;color:rgb(100 116 139);word-break:break-all}.knowledge-db-staging-notice{margin:12px 16px 0;padding:10px 12px;border-radius:9px;background:rgb(239 246 255);font-size:12px;line-height:1.6}.knowledge-db-staging-list{padding:12px 16px;overflow:auto;display:flex;flex-direction:column;gap:8px}.knowledge-db-staging-card{padding:11px;border:1px solid rgb(148 163 184 / .3);border-radius:10px}.knowledge-db-staging-card-top{display:flex;justify-content:space-between;font-size:12px;color:rgb(71 85 105)}.knowledge-db-staging-card-top label{display:flex;gap:7px}.knowledge-db-staging-grid{display:grid;grid-template-columns:100px 100px minmax(0,1fr);gap:8px;margin-top:8px}.knowledge-db-staging-grid label{display:flex;flex-direction:column;gap:3px;font-size:10px;color:rgb(71 85 105)}.knowledge-db-staging-grid input{min-height:32px;padding:5px 8px;border:1px solid rgb(100 116 139 / .28);border-radius:7px;background:white;color:inherit}.knowledge-db-staging-paths{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px;font-size:11px}.knowledge-db-staging-paths span{padding:3px 6px;border-radius:999px;background:rgb(241 245 249)}.knowledge-db-staging-card>small{display:block;margin-top:7px;color:rgb(100 116 139);font-size:10px}.knowledge-db-staging-footer{display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid rgb(148 163 184 / .25)}.knowledge-db-staging-footer button{display:inline-flex;align-items:center;gap:6px;min-height:34px;padding:6px 11px;border:1px solid rgb(100 116 139 / .3);border-radius:8px;background:white;cursor:pointer}.knowledge-db-staging-footer button.primary{background:rgb(37 99 235);color:white;border-color:rgb(37 99 235)}.knowledge-db-staging-footer button:disabled{opacity:.45;cursor:default}`}</style>
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
