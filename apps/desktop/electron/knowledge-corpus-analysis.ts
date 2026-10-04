import { analyzeKnowledgePage, type KnowledgeAnalysisResult, type KnowledgeAnalysisSemanticType } from "./knowledge-analysis-engine";

export interface KnowledgeCorpusPage {
  sourceId: string; pageNumber: number; text: string;
  blocks?: Parameters<typeof analyzeKnowledgePage>[1]; taxonomyPath?: string[];
}
export interface KnowledgeConceptNode { key:string; label:string; occurrences:number; sourceIds:string[]; pageKeys:string[]; semanticTypes:KnowledgeAnalysisSemanticType[]; }
export interface KnowledgeConceptRelation { from:string; to:string; weight:number; sourceIds:string[]; }
export interface KnowledgeCorpusConflict { key:string; sourceIds:string[]; semanticTypes:KnowledgeAnalysisSemanticType[]; reason:"semantic-type-disagreement"; }
export interface KnowledgeCorpusAnalysis { pages:Array<KnowledgeAnalysisResult & {sourceId:string;pageNumber:number;text:string}>; concepts:KnowledgeConceptNode[]; relations:KnowledgeConceptRelation[]; conflicts:KnowledgeCorpusConflict[]; confidence:number; }
const KEYWORD_NORMALIZATION = /[^\p{L}\p{N}_-]+/gu;
const concept = (...codePoints: number[]) => String.fromCodePoint(...codePoints);
const CONCEPT_ALIASES: Record<string, string> = Object.fromEntries([
  [concept(0x4e09,0x89d2,0x95a2,0x6570), concept(0x4e09,0x89d2,0x95a2,0x6570)],
  [concept(0x9023,0x7d9a,0x95a2,0x6570), concept(0x9023,0x7d9a,0x95a2,0x6570)],
  [concept(0x52a0,0x6cd5,0x5b9a,0x7406), concept(0x52a0,0x6cd5,0x5b9a,0x7406)],
  [concept(0x5b9a,0x7fa9), concept(0x5b9a,0x7fa9)],
  [concept(0x554f,0x984c), concept(0x554f,0x984c)],
  [concept(0x4f8b,0x984c), concept(0x4f8b,0x984c)],
  [concept(0x89e3,0x7b54), concept(0x89e3,0x7b54)],
  [concept(0x89e3,0x8aac), concept(0x89e3,0x8aac)],
]);