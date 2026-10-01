"use client";

import { useEffect, useRef, useState } from "react";

export interface KnowledgeRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  sourceId: string;
  pageNumber: number;
  getPagePdf: (payload: { sourceId: string; pageNumber: number }) => Promise<{ dataBase64: string; width: number; height: number } | null>;
  onRegionSelected: (region: KnowledgeRegion) => void;
}

export function KnowledgePdfPageViewer({ sourceId, pageNumber, pageWidth, pageHeight, getPagePdf, onRegionSelected }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [pdfSize, setPdfSize] = useState({ width: 612, height: 792 });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const payload = await getPagePdf({ sourceId, pageNumber });
      if (!payload || cancelled || !canvasRef.current) return;
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const bytes = Uint8Array.from(atob(payload.dataBase64), (char) => char.charCodeAt(0));
      const pdf = await pdfjs.getDocument({ data: bytes, disableWorker: true }).promise;
      setPdfSize({ width: payload.width, height: payload.height });
      const page = await pdf.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const maxWidth = 760;
      const scale = Math.min(1.5, maxWidth / base.width);
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      canvas.style.width = \`\${viewport.width}px\`;
      canvas.style.height = \`\${viewport.height}px\`;
      await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
    })().catch((error) => console.warn("Knowledge DB PDF preview failed:", error));
    return () => { cancelled = true; };
  }, [getPagePdf, pageNumber, sourceId]);

  function point(event: React.PointerEvent): { x: number; y: number } {
    const rect = stageRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
    };
  }

  return (
    <div
      ref={stageRef}
      style={{ position: "relative", display: "inline-block", maxWidth: "100%", cursor: "crosshair", userSelect: "none" }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const p = point(event);
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        setDrag({ x: p.x, y: p.y, w: 0, h: 0 });
      }}
      onPointerMove={(event) => {
        if (!drag) return;
        const p = point(event);
        setDrag({ x: Math.min(drag.x, p.x), y: Math.min(drag.y, p.y), w: Math.abs(p.x - drag.x), h: Math.abs(p.y - drag.y) });
      }}
      onPointerUp={(event) => {
        if (!drag) return;
        const p = point(event);
        const x = Math.min(drag.x, p.x);
        const y = Math.min(drag.y, p.y);
        const w = Math.abs(p.x - drag.x);
        const h = Math.abs(p.y - drag.y);
        setDrag(null);
        if (w < 8 || h < 8) return;
        const renderedWidth = canvasRef.current?.clientWidth || pdfSize.width;
        const renderedHeight = canvasRef.current?.clientHeight || pdfSize.height;
        const scaleX = pdfSize.width / renderedWidth;
        const scaleY = pdfSize.height / renderedHeight;
        onRegionSelected({ x: x * scaleX, y: (renderedHeight - y - h) * scaleY, width: w * scaleX, height: h * scaleY });
      }}
    >
      <canvas ref={canvasRef} aria-label={\`PDF page \${pageNumber}\`} />
      {drag && <div style={{ position: "absolute", left: drag.x, top: drag.y, width: drag.w, height: drag.h, border: "2px solid currentColor", background: "rgb(59 130 246 / 0.12)", pointerEvents: "none" }} />}
    </div>
  );
}
