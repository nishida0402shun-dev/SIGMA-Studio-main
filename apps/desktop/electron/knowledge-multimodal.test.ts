import { describe, expect, it } from "vitest";
import { KNOWLEDGE_VISUAL_MODEL, KNOWLEDGE_VISUAL_ANALYSIS_VERSION, shouldRunKnowledgeVisualAnalysis } from "./knowledge-multimodal";

describe("knowledge multimodal", () => {
  it("uses the PaddleOCR document analysis metadata", () => {
    expect(KNOWLEDGE_VISUAL_MODEL).toBe("PaddleOCR PP-StructureV3");
    expect(KNOWLEDGE_VISUAL_ANALYSIS_VERSION).toBe(2);
  });

  it("does not require visual inference for an ordinary long-text PDF page", () => {
    expect(shouldRunKnowledgeVisualAnalysis({
      filePath: "/tmp/document.pdf",
      pageText: "a".repeat(1000),
      extractionStatus: "text",
    })).toBe(false);
  });

  it("requires visual inference for scanned/empty PDF pages", () => {
    expect(shouldRunKnowledgeVisualAnalysis({
      filePath: "/tmp/scanned.pdf",
      pageText: "",
      extractionStatus: "ocr-needed",
    })).toBe(true);
  });

  it("allows forced visual analysis for any supported page", () => {
    expect(shouldRunKnowledgeVisualAnalysis({
      filePath: "/tmp/document.pdf",
      pageText: "a".repeat(1000),
      extractionStatus: "text",
      force: true,
    })).toBe(true);
  });
});
