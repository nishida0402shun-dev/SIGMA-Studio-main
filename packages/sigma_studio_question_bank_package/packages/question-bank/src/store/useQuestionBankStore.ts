import { create } from 'zustand';
import { QuestionFilter, Question } from '../types';

interface QuestionBankState {
  filter: QuestionFilter;
  selectedQuestionForModal: Question | null;
  selectedQuestionIndex: number;
  searchResults: Question[];
  isAiModalOpen: boolean;
  setFilter: (newFilter: Partial<QuestionFilter>) => void;
  openDetailModal: (question: Question, index: number) => void;
  closeDetailModal: () => void;
  setSearchResults: (questions: Question[]) => void;
  setAiModalOpen: (open: boolean) => void;
}

export const useQuestionBankStore = create<QuestionBankState>((set) => ({
  filter: { page: 1, limit: 20, sortBy: 'createdAt', sortOrder: 'DESC' },
  selectedQuestionForModal: null,
  selectedQuestionIndex: -1,
  searchResults: [],
  isAiModalOpen: false,

  setFilter: (newFilter) =>
    set((state) => ({
      filter: { ...state.filter, ...newFilter, page: newFilter.page ?? 1 },
    })),

  openDetailModal: (question, index) =>
    set({ selectedQuestionForModal: question, selectedQuestionIndex: index }),

  closeDetailModal: () =>
    set({ selectedQuestionForModal: null, selectedQuestionIndex: -1 }),

  setSearchResults: (questions) => set({ searchResults: questions }),

  setAiModalOpen: (open) => set({ isAiModalOpen: open }),
}));
