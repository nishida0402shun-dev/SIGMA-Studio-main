import React, { useMemo, useState } from 'react';
import { Check, FileText, X } from 'lucide-react';
import type { PdfImportStaging, StagedQuestionProposal } from '../types/staging';

interface Props {
  staging: PdfImportStaging;
  onChange: (proposal: StagedQuestionProposal) => Promise<void> | void;
  onApprove: () => Promise<void> | void;
  onReject: () => Promise<void> | void;
}

export const PdfStagingPreview: React.FC<Props> = ({ staging, onChange, onApprove, onReject }) => {
  const [busy, setBusy] = useState(false);
  const selectedCount = useMemo(() => staging.proposals.filter((item) => item.selected).length, [staging.proposals]);

  const run = async (action: () => Promise<void> | void) => {
    setBusy(true);
    try { await action(); } finally { setBusy(false); }
  };

  return (
    <section className="rounded-lg border bg-background p-4 space-y-4">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 font-semibold"><FileText className="h-5 w-5" />PDF取り込みプレビュー</div>
          <p className="mt-1 text-xs text-muted-foreground">
            {staging.source.fileName} · {staging.source.pageCount}ページ · 原本はまだ問題DBへ登録されていません
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground break-all">SHA-256: {staging.source.sourceSha256}</p>
        </div>
        <span className="rounded-full bg-muted px-2 py-1 text-xs">{selectedCount}/{staging.proposals.length}件を登録予定</span>
      </header>

      <div className="max-h-[55vh] overflow-auto space-y-2">
        {staging.proposals.map((proposal) => (
          <div key={proposal.id} className="rounded-md border p-3 space-y-2">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={proposal.selected}
                disabled={busy || staging.status !== 'draft'}
                onChange={(event) => void onChange({ ...proposal, selected: event.target.checked })}
                className="mt-1"
                aria-label={`page ${proposal.pageStart}-${proposal.pageEnd} selection`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-medium">p.{proposal.pageStart}–{proposal.pageEnd}</span>
                  <span className="rounded bg-muted px-2 py-0.5">{proposal.taxonomy.subjectName}</span>
                  <span className="rounded bg-muted px-2 py-0.5">{proposal.taxonomy.unitName}</span>
                  {proposal.aiConfidence != null && <span className="text-muted-foreground">AI {Math.round(proposal.aiConfidence * 100)}%</span>}
                </div>
                <input
                  value={proposal.title}
                  disabled={busy || staging.status !== 'draft'}
                  onChange={(event) => void onChange({ ...proposal, title: event.target.value })}
                  className="mt-2 w-full rounded border bg-background px-2 py-1 text-sm"
                  aria-label={`title ${proposal.id}`}
                />
                <div className="mt-2 text-xs text-muted-foreground">
                  難易度 {proposal.difficulty}/5 · {proposal.tags.join(' · ')}
                  {proposal.edited && <span className="ml-2 text-primary">手動修正済み</span>}
                  {proposal.childPdfPath && <span className="ml-2">子PDF: {proposal.childPdfPath}</span>}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {staging.status === 'draft' && (
        <footer className="flex justify-end gap-2 border-t pt-3">
          <button type="button" disabled={busy} onClick={() => void run(onReject)} className="inline-flex items-center gap-1 rounded border px-3 py-1.5 text-sm">
            <X className="h-4 w-4" />破棄
          </button>
          <button type="button" disabled={busy || selectedCount === 0} onClick={() => void run(onApprove)} className="inline-flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50">
            <Check className="h-4 w-4" />承認してDBへ登録
          </button>
        </footer>
      )}
    </section>
  );
};
