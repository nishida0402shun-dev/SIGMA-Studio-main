import React, { useState } from 'react';
import { Question, SigmaNode } from '../types';
import { Maximize2, ChevronDown, ChevronUp } from 'lucide-react';

interface QuestionCardProps {
  question: Question;
  index: number;
  onInsert: (nodes: SigmaNode[]) => void;
  onOpenDetail: (question: Question, index: number) => void;
  onDragStart: (e: React.DragEvent, nodes: SigmaNode[]) => void;
}

export const QuestionCard: React.FC<QuestionCardProps> = ({
  question,
  index,
  onInsert,
  onOpenDetail,
  onDragStart,
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, question.body.nodes)}
      className="p-3 border rounded-lg bg-card text-card-foreground shadow-sm hover:border-primary transition-all duration-200 cursor-grab active:cursor-grabbing group"
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs px-2 py-0.5 rounded bg-secondary text-secondary-foreground font-medium">
          {question.taxonomy.unitName}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-amber-500 font-bold">
            {'★'.repeat(question.difficulty)}
          </span>
          <button
            onClick={() => onOpenDetail(question, index)}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="大画面で拡大"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <h4 className="font-semibold text-sm mb-1 line-clamp-1">{question.title}</h4>

      {/* アコーディオン（インライン展開）対応プレビュー */}
      <div
        className={`preview-box border rounded p-2 bg-background/50 overflow-hidden text-xs transition-all duration-200 ${
          isExpanded ? 'max-h-none' : 'max-h-24'
        }`}
      >
        {question.body.nodes.map((node) => (
          <div key={node.id} className="mb-1">
            {node.type === 'paragraph' && <p>{node.content}</p>}
            {node.type === 'equation' && (
              <p className="font-mono text-primary bg-muted/40 p-1 rounded my-1">
                \\[{node.latex}\\]
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 mt-2">
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          {isExpanded ? (
            <>
              折りたたむ <ChevronUp className="w-3 h-3" />
            </>
          ) : (
            <>
              全体を表示 <ChevronDown className="w-3 h-3" />
            </>
          )}
        </button>

        <button
          type="button"
          onClick={() => onInsert(question.body.nodes)}
          className="px-3 py-1 bg-primary text-primary-foreground text-xs rounded hover:bg-primary/90 transition-colors font-medium"
        >
          追加 ↵
        </button>
      </div>
    </div>
  );
};
