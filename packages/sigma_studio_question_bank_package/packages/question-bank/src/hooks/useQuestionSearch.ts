import { useState, useEffect, useCallback, useRef } from 'react';
import { QuestionFilter, SearchResponse } from '../types';
import { useQuestionBankStore } from '../store/useQuestionBankStore';

export const useQuestionSearch = () => {
  const { filter, setFilter, setSearchResults } = useQuestionBankStore();
  const [data, setData] = useState<SearchResponse>({ items: [], total: 0, page: 1, limit: 20, totalPages: 1 });
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchQuestions = useCallback(async (currentFilter: QuestionFilter) => {
    if (!window.api) return;
    setLoading(true);
    setError(null);
    try {
      const response = await window.api.questions.search(currentFilter);
      setData(response);
      setSearchResults(response.items);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('検索エラー'));
    } finally {
      setLoading(false);
    }
  }, [setSearchResults]);

  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      fetchQuestions(filter);
    }, 250);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [filter, fetchQuestions]);

  return {
    filter,
    questions: data.items,
    total: data.total,
    page: data.page,
    totalPages: data.totalPages,
    loading,
    error,
    updateFilter: setFilter,
    refetch: () => fetchQuestions(filter),
  };
};
