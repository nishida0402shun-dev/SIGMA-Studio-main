import type { KnowledgePage } from "./knowledge-db-store";
import type { StructurePageResult } from "./knowledge-db-structure-parser";
import { analyzeKnowledgePage, KNOWLEDGE_ANALYSIS_VERSION } from "./knowledge-analysis-engine";
import { classifyKnowledgeTaxonomy, KNOWLEDGE_TAXONOMY_VERSION } from "./knowledge-taxonomy";
import {
  analyzeKnowledgeVisualPage,
  KNOWLEDGE_VISUAL_ANALYSIS_VERSION,
  shouldRunKnowledgeVisualAnalysis,
} from "./knowledge-multimodal";

export async function buildKnowledgeIndexedPage(input: {
  page: KnowledgePage;
  nativeText: string;
  structured?: StructurePageResult;
  filePath: string;
  dataDir: string;
}): Promise<KnowledgePage> {
  const { page, nativeText, structured } = input;
  const blocks = structured?.blocks ?? [];
  let visualAnalysis = page.visualAnalysis;
  let visualPreviewPath = page.visualPreviewPath;
  let visualAnalysisError: string | undefined;

  const shouldVisualize = shouldRunKnowledgeVisualAnalysis({
    filePath: input.filePath,
    pageText: nativeText,
    extractionStatus: nativeText ? "text" : "ocr-needed",
    hasFigureOrTable: blocks.some((block) => block.type === "figure" || block.type === "table"),
  });

  if (shouldVisualize && page.visualAnalysisVersion !== KNOWLEDGE_VISUAL_ANALYSIS_VERSION) {
    try {
      const visual = await analyzeKnowledgeVisualPage({
        filePath: input.filePath,
        pageNumber: page.pageNumber,
        pageText: nativeText,
        dataDir: input.dataDir,
      });
      visualAnalysis = visual.analysis;
      visualPreviewPath = visual.previewPath;
    } catch (error) {
      visualAnalysisError = error instanceof Error ? error.message : String(error);
    }
  }

  const extractedContent = [
    nativeText,
    structured?.text ?? "",
    ...blocks.map((block) => block.text),
    visualAnalysis ? `[visual]\n${visualAnalysis}` : "",
  ]
    .map((value) => value.trim())
    .filter(Boolean)
    .join("\n");
  const text = extractedContent;
  const analysis = analyzeKnowledgePage(text, blocks);
  const classifiedTaxonomy = classifyKnowledgeTaxonomy(text, analysis.keywords);
  const taxonomy = classifiedTaxonomy.length
    ? classifiedTaxonomy
    : [{ nodeId: "other", path: ["その他"], score: 0, confidence: 0 }];

  return {
    ...page,
    text: text || undefined,
    semanticType: page.semanticType === "unknown" ? analysis.semanticType : page.semanticType,
    ...(page.title || !analysis.title ? {} : { title: analysis.title }),
    keywords: analysis.keywords,
    analysisSignals: analysis.signals,
    analysisStatus: "analyzed",
    analysisVersion: KNOWLEDGE_ANALYSIS_VERSION,
    analysisError: undefined,
    ...(taxonomy.length
      ? {
          taxonomyNodeIds: taxonomy.map((item) => item.nodeId),
          taxonomyPaths: taxonomy.map((item) => item.path),
          taxonomyConfidence: taxonomy[0]?.confidence ?? 0,
        }
      : { taxonomyNodeIds: [], taxonomyPaths: [], taxonomyConfidence: 0 }),
    taxonomyVersion: KNOWLEDGE_TAXONOMY_VERSION,
    classificationReviewStatus: taxonomy.length > 1 || (taxonomy[0]?.confidence ?? 0) < 0.85 ? "pending" : undefined,
    classificationReviewPaths: undefined,
    classificationReviewConfidence: undefined,
    classificationReviewReason: undefined,
    classificationReviewEvidence: undefined,
    extractionStatus: text ? "text" : "ocr-needed",
    wordCount: text ? countWords(text) : 0,
    ...(visualPreviewPath ? { visualPreviewPath } : {}),
    ...(visualAnalysis ? { visualAnalysis } : {}),
    ...(visualAnalysisError ? { visualAnalysisError } : {}),
    ...(blocks.length ? { structureBlocks: blocks } : {}),
  };
}

function countWords(text: string): number {
  const normalized = text.normalize("NFKC").trim();
  return normalized ? normalized.split(/\s+/u).length : 0;
}
