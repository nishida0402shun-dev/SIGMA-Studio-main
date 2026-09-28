import React from 'react';
import { X, CheckCircle, Sparkles } from 'lucide-react';

interface AiTaggingModalProps {
  isOpen: boolean;
  onClose: () => void;
  suggestedTags: {
    unitName: string;
    difficulty: number;
    tags: string[];
    confidenceScore: number;
  };
  onConfirm: (finalData: any) => void;
}

export const AiTaggingModal: React.FC<AiTaggingModalProps> = ({
  isOpen,
  onClose,
  suggestedTags,
  onConfirm,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-background text-foreground border rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-primary font-bold">
            <Sparkles className="w-5 h-5" />
            <h3>AI自動タグ付け確認</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3 text-sm">
          <div>
            <label className="text-xs text-muted-foreground">推定単元</label>
            <p className="font-semibold">{suggestedTags.unitName}</p>
          </div>

          <div>
            <label className="text-xs text-muted-foreground">推定難易度</label>
            <p className="text-amber-500">{'★'.repeat(suggestedTags.difficulty)}</p>
          </div>

          <div>
            <label className="text-xs text-muted-foreground">自動抽出タグ</label>
            <div className="flex flex-wrap gap-1 mt-1">
              {suggestedTags.tags.map((t) => (
                <span key={t} className="px-2 py-0.5 bg-secondary text-xs rounded">
                  #{t}
                </span>
              ))}
            </div>
          </div>

          <div className="pt-2">
            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
              <CheckCircle className="w-3.5 h-3.5" /> 信頼度スコア: {suggestedTags.confidenceScore}%
            </span>
          </div>
        </div>

        <div className="flex gap-2 mt-6">
          <button onClick={onClose} className="flex-1 py-2 border rounded text-xs font-medium">
            キャンセル
          </button>
          <button
            onClick={() => onConfirm(suggestedTags)}
            className="flex-1 py-2 bg-primary text-primary-foreground rounded text-xs font-semibold"
          >
            承認して保存
          </button>
        </div>
      </div>
    </div>
  );
};
