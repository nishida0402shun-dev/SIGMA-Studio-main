import React, { useEffect } from 'react';
import { Question, SigmaNode } from '../types';
import { X, ChevronLeft, ChevronRight, Plus } from 'lucide-react';

interface QuestionDetailModalProps {
  question: Question | null;
  currentIndex: number;
  totalQuestions: number;
  onClose: () => void;
  onNavigate: (newIndex: number) => void;
  onInsert: (nodes: SigmaNode[]) => void;
}

export const QuestionDetailModal: React.FC<QuestionDetailModalProps> = ({
  question,
  currentIndex,
  totalQuestions,
  onClose,
  onNavigate,
  onInsert,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!question) return;
      if (e.key === 'ArrowLeft' && currentIndex > 0) {
        onNavigate(currentIndex - 1);
      } else if (e.key === 'ArrowRight' && currentIndex < totalQuestions - 1) {
        onNavigate(currentIndex + 1);
      } else if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [question, currentIndex, totalQuestions, onNavigate, onClose]);

  if (!question) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-background text-foreground border rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* ヘッダー */}
        <div className="p-4 border-b flex items-center justify-between bg-muted/30">
          <div>
            <span className="text-xs font-semibold px-2.5 py-1 bg-primary/10 text-primary rounded mr-2">
              {question.taxonomy.subjectName} · {question.taxonomy.unitName}
            </span>
            <h2 className="text-lg font-bold inline">{question.title}</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 問題全文・図形表示エリア */}
        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          <div className="prose dark:prose-invert max-w-none">
            {question.body.nodes.map((node) => (
              <div key={node.id} className="my-2">
                {node.type === 'paragraph' && <p className="text-base leading-relaxed">{node.content}</p>}
                {node.type === 'equation' && (
                  <div className="my-3 p-3 bg-muted rounded-lg text-center font-mono text-lg text-primary">
                    $${node.latex}$$
                  </div>
                )}
              </div>
            ))}
          </div>

          {question.solution && (
            <div className="mt-6 pt-4 border-t border-dashed">
              <h3 className="font-bold text-sm text-muted-foreground mb-2">【解答・解説】</h3>
              <p className="text-sm bg-emerald-50 dark:bg-emerald-950/40 p-3 rounded text-emerald-900 dark:text-emerald-100">
                {question.solution.answer}
              </p>
            </div>
          )}
        </div>

        {/* フッターナビゲーション */}
        <div className="p-4 border-t flex items-center justify-between bg-muted/20">
          <div className="flex items-center gap-2">
            <button
              disabled={currentIndex <= 0}
              onClick={() => onNavigate(currentIndex - 1)}
              className="p-2 border rounded disabled:opacity-40 hover:bg-muted flex items-center gap-1 text-xs"
            >
              <ChevronLeft className="w-4 h-4" /> 前の問題
            </button>
            <span className="text-xs text-muted-foreground px-2">
              {currentIndex + 1} / {totalQuestions}
            </span>
            <button
              disabled={currentIndex >= totalQuestions - 1}
              onClick={() => onNavigate(currentIndex + 1)}
              className="p-2 border rounded disabled:opacity-40 hover:bg-muted flex items-center gap-1 text-xs"
            >
              次の問題 <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={() => {
              onInsert(question.body.nodes);
              onClose();
            }}
            className="px-4 py-2 bg-primary text-primary-foreground font-semibold text-sm rounded-lg hover:bg-primary/90 flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" /> プリントに追加 ↵
          </button>
        </div>
      </div>
    </div>
  );
};
