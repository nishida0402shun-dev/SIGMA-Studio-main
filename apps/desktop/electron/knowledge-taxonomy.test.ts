import { describe, expect, it } from "vitest";
import { classifyKnowledgeTaxonomy, KNOWLEDGE_TAXONOMY, KNOWLEDGE_TAXONOMY_VERSION } from "./knowledge-taxonomy";

describe("knowledge taxonomy", () => {
  it("matches the approved six-subject hierarchy", () => {
    expect(KNOWLEDGE_TAXONOMY_VERSION).toBe(2);
    expect(KNOWLEDGE_TAXONOMY.map((node) => node.name)).toEqual([
      "数学",
      "英語",
      "国語",
      "理科",
      "社会",
      "情報",
    ]);
  });

  it("keeps mathematics at subject -> course -> unit depth", () => {
    const math = KNOWLEDGE_TAXONOMY[0];
    expect(math.children?.map((node) => node.name)).toEqual([
      "数学I",
      "数学A",
      "数学II",
      "数学B",
      "数学III",
      "数学C",
    ]);
    expect(math.children?.every((course) => course.children?.every((unit) => !unit.children))).toBe(true);
  });

  it("keeps the approved English areas and only deepens vocabulary and grammar", () => {
    const english = KNOWLEDGE_TAXONOMY.find((node) => node.name === "英語");
    expect(english?.children?.map((node) => node.name)).toEqual([
      "語彙・語法",
      "文法",
      "英文解釈・構文",
      "長文読解",
      "英作文・ライティング",
      "リスニング",
    ]);
    expect(english?.children?.find((node) => node.name === "英文解釈・構文")?.children).toBeUndefined();
    expect(english?.children?.find((node) => node.name === "長文読解")?.children).toBeUndefined();
    expect(english?.children?.find((node) => node.name === "英作文・ライティング")?.children).toBeUndefined();
    expect(english?.children?.find((node) => node.name === "リスニング")?.children).toBeUndefined();
  });

  it("classifies pages into the approved parent and unit paths", () => {
    expect(classifyKnowledgeTaxonomy("数学IIの微分法")).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: ["数学", "数学II", "微分法"] })]),
    );
    expect(classifyKnowledgeTaxonomy("英語の助動詞と話法")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ["英語", "文法", "助動詞"] }),
        expect.objectContaining({ path: ["英語", "文法", "話法"] }),
      ]),
    );
    expect(classifyKnowledgeTaxonomy("理科・化学・有機")).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: ["理科", "化学", "有機"] })]),
    );
  });
});
