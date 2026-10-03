import { describe, expect, it } from "vitest";
import { analyzeKnowledgePage } from "./knowledge-analysis-engine";

describe("analyzeKnowledgePage", () => {
  it("classifies a problem page and extracts its title", () => {
    const result = analyzeKnowledgePage("二次関数\n問題1：f(x)=x^2 の最大値を求めよ。", [
      { type: "title", text: "二次関数" },
      { type: "formula", text: "f(x)=x^2" },
    ]);

    expect(result.semanticType).toBe("problem");
    expect(result.title).toBe("二次関数");
    expect(result.signals).toContain("problem-keyword");
    expect(result.keywords).toContain("二次関数");
  });

  it("uses structural blocks when native text is empty", () => {
    const result = analyzeKnowledgePage("", [
      { type: "title", text: "定理" },
      { type: "text", text: "definition of continuity" },
    ]);

    expect(result.semanticType).toBe("definition");
    expect(result.title).toBe("定理");
  });

  it("does not force a semantic type without evidence", () => {
    const result = analyzeKnowledgePage("今日は数学を勉強する。");
    expect(result.semanticType).toBe("unknown");
    expect(result.keywords.length).toBeGreaterThan(0);
  });
});
