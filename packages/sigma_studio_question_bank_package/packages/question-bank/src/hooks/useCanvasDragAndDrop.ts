import { useCallback } from 'react';
import { SigmaNode } from '../types';

export const SIGMA_QUESTION_MIME_TYPE = 'application/x-sigma-question-nodes';

export const useCanvasDragAndDrop = (
  onInsertToCanvas: (nodes: SigmaNode[], dropPosition?: { x: number; y: number }) => void
) => {
  const handleDragStart = useCallback((event: React.DragEvent, nodes: SigmaNode[]) => {
    const reidentifiedNodes = nodes.map((node) => ({
      ...node,
      id: crypto.randomUUID(),
    }));
    event.dataTransfer.setData(SIGMA_QUESTION_MIME_TYPE, JSON.stringify(reidentifiedNodes));
    event.dataTransfer.effectAllowed = 'copy';
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const rawData = event.dataTransfer.getData(SIGMA_QUESTION_MIME_TYPE);
      if (!rawData) return;

      try {
        const nodes: SigmaNode[] = JSON.parse(rawData);
        const dropPosition = { x: event.clientX, y: event.clientY };
        onInsertToCanvas(nodes, dropPosition);
      } catch (err) {
        console.error('[DnD Error]', err);
      }
    },
    [onInsertToCanvas]
  );

  const handleDragOver = useCallback((event: React.DragEvent) => {
    if (event.dataTransfer.types.includes(SIGMA_QUESTION_MIME_TYPE)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  return { handleDragStart, handleDrop, handleDragOver };
};
