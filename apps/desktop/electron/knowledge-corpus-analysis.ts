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
export function analyzeKnowledgeCorpus(pages: KnowledgeCorpusPage[]): KnowledgeCorpusAnalysis {
  const analyzed = pages.map((page) => ({ ...analyzeKnowledgePage(page.text, page.blocks), sourceId: page.sourceId, pageNumber: page.pageNumber }));
  const nodes = new Map<string, KnowledgeConceptNode>();
  const relationWeights = new Map<string, { weight: number; sourceIds: Set<string> }>();
  for (const page of analyzed) {
    const uniqueKeywords = [...new Set(page.keywords.map(normalizeConcept).filter(Boolean))];
    for (const key of uniqueKeywords) {
      const existing = nodes.get(key); const pageKey = `${page.sourceId}#${page.pageNumber}`;
      if (existing) {
        existing.occurrences += 1;
        if (!existing.sourceIds.includes(page.sourceId)) existing.sourceIds.push(page.sourceId);
        if (!existing.pageKeys.includes(pageKey)) existing.pageKeys.push(pageKey);
        if (!existing.semanticTypes.includes(page.semanticType)) existing.semanticTypes.push(page.semanticType);
      } else nodes.set(key, { key, label: key, occurrences: 1, sourceIds: [page.sourceId], pageKeys: [pageKey], semanticTypes: [page.semanticType] });
    }
    for (let i=0;i<uniqueKeywords.length;i+=1) for (let j=i+1;j<uniqueKeywords.length;j+=1) {
      const from=uniqueKeywords[i], to=uniqueKeywords[j]; const relationKey=from<to?`${from}\\0${to}`:`${to}\\0${from}`;
      const relation=relationWeights.get(relationKey) ?? {weight:0,sourceIds:new Set<string>()}; relation.weight += 1; relation.sourceIds.add(page.sourceId); relationWeights.set(relationKey,relation);
    }
  }
  const concepts=[...nodes.values()].sort((a,b)=>b.occurrences-a.occurrences||a.key.localeCompare(b.key)).map((n)=>({...n,sourceIds:[...n.sourceIds].sort(),pageKeys:[...n.pageKeys].sort(),semanticTypes:[...n.semanticTypes].sort()}));
  const relations=[...relationWeights.entries()].map(([key,value])=>{const [from,to]=key.split("\\0");return {from,to,weight:value.weight,sourceIds:[...value.sourceIds].sort()};}).sort((a,b)=>b.weight-a.weight||a.from.localeCompare(b.from)||a.to.localeCompare(b.to));
  const conflicts=concepts.filter((n)=>n.semanticTypes.length>1&&n.sourceIds.length>1).map((n)=>({key:n.key,sourceIds:n.sourceIds,semanticTypes:n.semanticTypes,reason:"semantic-type-disagreement" as const}));
  const cross=concepts.filter((n)=>n.sourceIds.length>1).length; const penalty=conflicts.length/Math.max(1,concepts.length); const coverage=pages.length?Math.min(1,cross/Math.max(1,concepts.length)):0;
  const confidence=Number(Math.max(0,Math.min(1,0.5+coverage*0.4-penalty*0.25)).toFixed(3));
  return { pages: analyzed, concepts, relations, conflicts, confidence };
}
function normalizeConcept(value:string):string { const normalized=value.normalize("NFKC").toLocaleLowerCase(); for(const [alias,canonical] of Object.entries(CONCEPT_ALIASES)) if(normalized.includes(alias)) return canonical; return normalized.replace(KEYWORD_NORMALIZATION,"").trim(); }
