import React from 'react';
import { Search, Plus, BookOpen } from 'lucide-react';
import { QuestionCard } from './QuestionCard';
import { QuestionDetailModal } from './QuestionDetailModal';
import { useQuestionSearch, useQuestionMutations, useCanvasDragAndDrop, useImportProgress } from '../hooks';
import { useQuestionBankStore } from '../store/useQuestionBankStore';
import { SigmaNode } from '../types';

interface QuestionBankSidebarProps {
  onInsertToCanvas: (nodes: SigmaNode[], position?: { x: number; y: number }) => void;
}

export const QuestionBankSidebar: React.FC<QuestionBankSidebarProps> = ({ onInsertToCanvas }) => {
  const { questions, loading, updateFilter } = useQuestionSearch();
  const { prepareNodesForCanvas } = useQuestionMutations();
  const { handleDragStart } = useCanvasDragAndDrop(onInsertToCanvas);
  const { progress } = useImportProgress();

  const {
    selectedQuestionForModal,
    selectedQuestionIndex,
    openDetailModal,
    closeDetailModal,
    searchResults,
  } = useQuestionBankStore();

  const handleInsert = (nodes: SigmaNode[]) => {
    onInsertToCanvas(prepareNodesForCanvas(nodes));
  };

  return (
    <aside className="w-80 h-full border-r bg-sidebar p-4 flex flex-col gap-4 select-none">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-bold text-sidebar-foreground">
          <BookOpen className="w-5 h-5 text-primary" />
          <span>問題バンク</span>
        </div>
        <span className="text-xs px-2 py-0.5 bg-primary/10 text-primary font-medium rounded">
          全教科対応
        </span>
      </div>

      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <input
          type="search"
          placeholder="問題・数式・タグを検索..."
          className="w-full pl-8 pr-3 py-1.5 text-sm border rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          onChange={(e) => updateFilter({ keyword: e.target.value })}
        />
      </div>

      <div className="flex gap-2">
        <select
          onChange={(e) => updateFilter({ subjectId: e.target.value || undefined })}
          className="flex-1 text-xs p-1.5 border rounded bg-background"
        >
          <option value="">全教科</option>
          <option value="chemistry">化学</option>
          <option value="math">数学</option>
          <option value="physics">物理</option>
          <option value="english">英語</option>
        </select>

        <select
          onChange={(e) => updateFilter({ difficulty: e.target.value ? Number(e.target.value) : undefined })}
          className="flex-1 text-xs p-1.5 border rounded bg-background"
        >
          <option value="">全難易度</option>
          <option value="1">★1 以上</option>
          <option value="3">★3 以上</option>
          <option value="5">★5 のみ</option>
        </select>
      </div>

      {/* PDFバックグラウンド解析進捗 */}
      {progress.status === 'processing' && (
        <div className="p-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 rounded text-xs space-y-1">
          <p className="font-semibold text-blue-900 dark:text-blue-100">
            PDF解析中... {progress.currentPage}/{progress.totalPages} p
          </p>
          <div className="w-full bg-blue-200 h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-primary h-full transition-all duration-300"
              style={{ width: `${(progress.currentPage / progress.totalPages) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* 問題リスト */}
      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        {loading ? (
          <div className="p-8 text-center text-xs text-muted-foreground">検索中...</div>
        ) : (
          questions.map((q, idx) => (
            <QuestionCard
              key={q.id}
              question={q}
              index={idx}
              onInsert={handleInsert}
              onOpenDetail={openDetailModal}
              onDragStart={handleDragStart}
            />
          ))
        )}
      </div>

      {/* 大画面詳細モーダル */}
      <QuestionDetailModal
        question={selectedQuestionForModal}
        currentIndex={selectedQuestionIndex}
        totalQuestions={searchResults.length}
        onClose={closeDetailModal}
        onNavigate={(newIdx) => openDetailModal(searchResults[newIdx], newIdx)}
        onInsert={handleInsert}
      />
    </aside>
  );
};
