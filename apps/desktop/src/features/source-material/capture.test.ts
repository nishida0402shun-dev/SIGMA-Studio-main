import { describe, expect, it } from "vitest";

import {
  clampBoundingBox,
  createPageCapture,
  createRegionCapture,
  createTextCapture,
  formatCaptureMarkdown,
  inspectCaptureSize,
  isCaptureSourceCurrent,
  utf8ByteLength,
} from "./capture";

const source = { id: "source-1", name: "理科資料.pdf", contentHash: "abc123" };

describe("source capture", () => {
  it("records page, text, and region provenance", () => {
    const page = createPageCapture({
      source,
      pageNumber: 2,
      text: "本文",
      createdAt: "2026-10-22T00:00:00.000Z",
    });
    expect(page).toMatchObject({
      sourceId: "source-1",
      sourceName: "理科資料.pdf",
      contentHash: "abc123",
      pageNumber: 2,
      kind: "page",
      text: "本文",
      createdAt: "2026-10-22T00:00:00.000Z",
    });

    const text = createTextCapture({
      source,
      pageNumber: 2,
      text: "選んだ本文",
      startOffset: 4,
      endOffset: 9,
    });
    expect(text).toMatchObject({ kind: "text", startOffset: 4, endOffset: 9 });

    const region = createRegionCapture({
      source,
      pageNumber: 2,
      text: "本文",
      boundingBox: { x: -0.2, y: 0.1, width: 1.5, height: 2 },
      imageDataUrl: "data:image/png;base64,AAAA",
    });
    expect(region.boundingBox).toEqual({ x: 0, y: 0.1, width: 1, height: 0.9 });
  });

  it("clamps normalized boxes into the page", () => {
    const box = clampBoundingBox({ x: 0.8, y: 0.7, width: 0.5, height: 0.5 });
    expect(box.x).toBe(0.8);
    expect(box.y).toBe(0.7);
    expect(box.width).toBeCloseTo(0.2);
    expect(box.height).toBeCloseTo(0.3);
  });

  it("checks that a capture still belongs to the displayed source", () => {
    const capture = createPageCapture({ source, pageNumber: 1, text: "x" });
    expect(isCaptureSourceCurrent(capture, { id: "source-1", contentHash: "abc123" })).toBe(true);
    expect(isCaptureSourceCurrent(capture, { id: "source-1", contentHash: "changed" })).toBe(false);
    expect(isCaptureSourceCurrent(capture, null)).toBe(false);
  });

  it("measures UTF-8 and image data against Web AI limits", () => {
    const capture = createPageCapture({
      source,
      pageNumber: 1,
      text: "こんにちは",
    });
    expect(utf8ByteLength("こんにちは")).toBe(15);

    const inspection = inspectCaptureSize(
      { ...capture, imageDataUrl: "data:image/png;base64,AAAA" },
      "こんにちは",
      { maxTextBytes: 14, maxImageBytes: 2 },
    );
    expect(inspection.textBytes).toBe(15);
    expect(inspection.imageBytes).toBe(3);
    expect(inspection.exceedsTextLimit).toBe(true);
    expect(inspection.exceedsImageLimit).toBe(true);
  });

  it("formats an editable citation without inventing source text", () => {
    const capture = createTextCapture({
      source,
      pageNumber: 3,
      text: "光合成",
      startOffset: 10,
      endOffset: 14,
    });
    expect(
      formatCaptureMarkdown(capture, "光合成", {
        source: "資料",
        page: "ページ",
        characters: "文字位置",
        region: "範囲",
        contentHash: "内容ハッシュ",
      }),
    ).toBe(
      "資料: 理科資料.pdf\nページ: 3\n内容ハッシュ: abc123\n文字位置: 10-14\n\n---\n\n光合成\n",
    );
  });
});
