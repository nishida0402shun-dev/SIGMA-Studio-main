import { useState, useEffect } from 'react';
import { ImportProgress } from '../types';

export const useImportProgress = () => {
  const [progress, setProgress] = useState<ImportProgress>({
    jobId: '',
    status: 'idle',
    currentPage: 0,
    totalPages: 0,
    extractedQuestionsCount: 0,
  });

  useEffect(() => {
    if (!window.api) return;
    const unsubscribe = window.api.questions.onImportProgress((updated) => {
      setProgress(updated);
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const startImport = async (filePath: string) => {
    if (!window.api) return;
    const { jobId } = await window.api.questions.startImport(filePath);
    setProgress((prev) => ({ ...prev, jobId, status: 'processing' }));
  };

  return { progress, startImport };
};
