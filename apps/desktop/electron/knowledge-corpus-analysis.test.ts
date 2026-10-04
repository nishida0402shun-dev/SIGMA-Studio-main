import { describe, expect, it } from "vitest";
import { analyzeKnowledgeCorpus } from "./knowledge-corpus-analysis";
describe("analyzeKnowledgeCorpus", () => {
  it("builds a cross-source concept graph", () => {
    const result=analyzeKnowledgeCorpus([{sourceId:"book-a",pageNumber:1,text:"数学Ⅱ 三角関数の加法定理を使う説明"},{sourceId:"book-b",pageNumber:4,text:"三角関数の加法定理について説明"}]);
    const concept=result.concepts.find((item)=>item.key.includes("三角関数"));
    expect(concept?.sourceIds).toEqual(["book-a","book-b"]);
    expect(result.relations.some((edge)=>edge.from&&edge.to&&edge.weight>0)).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.5);
  });
  it("flags cross-document semantic disagreement", () => {
    const result=analyzeKnowledgeCorpus([{sourceId:"book-a",pageNumber:1,text:"連続関数の定義を説明する"},{sourceId:"book-b",pageNumber:2,text:"連続関数を使った判定問題"}]);
    const conflict=result.conflicts.find((item)=>item.key.includes("連続関数"));
    expect(conflict?.reason).toBe("semantic-type-disagreement");
    expect(conflict?.sourceIds).toEqual(["book-a","book-b"]);
  });
  it("is deterministic", () => {
    const pages=[{sourceId:"a",pageNumber:1,text:"ベクトルと図形の問題"},{sourceId:"b",pageNumber:2,text:"ベクトルと図形の解説"}];
    expect(analyzeKnowledgeCorpus(pages)).toEqual(analyzeKnowledgeCorpus(pages));
  });
});