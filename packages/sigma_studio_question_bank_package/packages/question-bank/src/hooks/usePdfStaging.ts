import { useCallback, useEffect, useState } from 'react';
import type { CreatePdfStagingInput, PdfImportStaging, StagedQuestionProposal } from '../types/staging';

export function usePdfStaging(stagingId?: string) {
  const [staging, setStaging] = useState<PdfImportStaging | null>(null);
  const [loading, setLoading] = useState(Boolean(stagingId));

  const refresh = useCallback(async () => {
    if (!stagingId || !window.api?.pdfStaging) return;
    setLoading(true);
    try { setStaging(await window.api.pdfStaging.get(stagingId)); }
    finally { setLoading(false); }
  }, [stagingId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const create = useCallback(async (input: CreatePdfStagingInput) => {
    if (!window.api?.pdfStaging) throw new Error('PDF staging API is unavailable.');
    const created = await window.api.pdfStaging.create(input);
    setStaging(created);
    return created;
  }, []);

  const updateProposal = useCallback(async (proposal: StagedQuestionProposal) => {
    if (!stagingId || !window.api?.pdfStaging) throw new Error('PDF staging API is unavailable.');
    const updated = await window.api.pdfStaging.updateProposal({ stagingId, proposal });
    setStaging(updated);
    return updated;
  }, [stagingId]);

  const approve = useCallback(async () => {
    if (!stagingId || !window.api?.pdfStaging) throw new Error('PDF staging API is unavailable.');
    const result = await window.api.pdfStaging.approve(stagingId);
    await refresh();
    return result;
  }, [refresh, stagingId]);

  const reject = useCallback(async () => {
    if (!stagingId || !window.api?.pdfStaging) throw new Error('PDF staging API is unavailable.');
    const result = await window.api.pdfStaging.reject(stagingId);
    await refresh();
    return result;
  }, [refresh, stagingId]);

  return { staging, loading, create, updateProposal, approve, reject, refresh };
}
