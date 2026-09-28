import { useState, useCallback } from 'react';
import { Question, SigmaNode } from '../types';

export const useQuestionMutations = () => {
  const [mutating, setMutating] = useState<boolean>(false);

  // キャンバスドロップ時のID衝突防止（UUID再採番）
  const prepareNodesForCanvas = useCallback((nodes: SigmaNode[]): SigmaNode[] => {
    const reidentify = (list: SigmaNode[]): SigmaNode[] => {
      return list.map((node) => ({
        ...node,
        id: crypto.randomUUID(),
        children: node.children ? reidentify(node.children) : undefined,
      }));
    };
    return reidentify(nodes);
  }, []);

  const saveQuestion = useCallback(async (question: Question) => {
    if (!window.api) return;
    setMutating(true);
    try {
      return await window.api.questions.save(question);
    } finally {
      setMutating(false);
    }
  }, []);

  const deleteQuestion = useCallback(async (id: string) => {
    if (!window.api) return;
    setMutating(true);
    try {
      return await window.api.questions.delete(id);
    } finally {
      setMutating(false);
    }
  }, []);

  return { prepareNodesForCanvas, saveQuestion, deleteQuestion, mutating };
};
