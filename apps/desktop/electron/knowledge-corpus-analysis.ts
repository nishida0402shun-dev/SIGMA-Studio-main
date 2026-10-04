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
const CONCEPT_ALIASES: Record<string, string> = {
  "\u4e09\u89d2\u95a2\u6570": "\u4e09\u89d2\u95a2\u6570", "\u9023\u7d9a\u95a2\u6570": "\u9023\u7d9a\u95a2\u6570", "\u52a0\u6cd5\u5b9a\u7406": "\u52a0\u6cd5\u5b9a\u7406", "\u5b9a\u7fa9": "\u5b9a\u7fa9", "\u554f\u984c": "\u554f\u984c", "\u4f8b\u984c": "\u4f8b\u984c", "\u89e3\u7b54": "\u89e3\u7b54", "\u89e3\u8aac": "\u89e3\u8aac",
};

export function analyzeKnowledgeCorpus(pages: KnowledgeCorpusPage[]): KnowledgeCorpusAnalysis {
  const analyzed = pages.map((page) => ({ ...analyzeKnowledgePage(page.text, page.blocks), sourceId: page.sourceId, pageNumber: page.pageNumber, text: page.text }));
  const nodes = new Map<string, KnowledgeConceptNode>();
  const relationWeights = new Map<string, {weight:number; sourceIds:Set<string>}>();
  analyzed.forEach((page) => {
    const uniqueKeywords = [...new Set([...page.keywords, ...extractDomainConcepts(page.text)].map(normalizeConcept).filter(Boolean))];
    for (const key of uniqueKeywords) {
      const existing = nodes.get(key); const pageKey = `${page.sourceId}#${page.pageNumber}`;
      if (existing) { existing.occurrences += 1; if (!existing.sourceIds.includes(page.sourceId)) existing.sourceIds.push(page.sourceId); if (!existing.pageKeys.includes(pageKey)) existing.pageKeys.push(pageKey); if (!existing.semanticTypes.includes(page.semanticType)) existing.semanticTypes.push(page.semanticType); }
      else nodes.set(key, {key,label:key,occurrences:1,sourceIds:[page.sourceId],pageKeys:[pageKey],semanticTypes:[page.semanticType]});
    }
    for (let i=0;i<uniqueKeywords.length;i+=1) for (let j=i+1;j<uniqueKeywords.length;j+=1) {
      const from=uniqueKeywords[i], to=uniqueKeywords[j]; const relationKey=from<to?`${from}\0${to}`:`${to}\0${from}`;
      const relation=relationWeights.get(relationKey) ?? {weight:0,sourceIds:new Set<string>()}; relation.weight+=1; relation.sourceIds.add(page.sourceId); relationWeights.set(relationKey,relation);
    }
  });
  const concepts=[...nodes.values()].sort((a,b)=>b.occurrences-a.occurrences||a.key.localeCompare(b.key)).map((node)=>({...node,sourceIds:[...node.sourceIds].sort(),pageKeys:[...node.pageKeys].sort(),semanticTypes:[...node.semanticTypes].sort()}));
  const relations=[...relationWeights.entries()].map(([key,value])=>{const [from,to]=key.split("\0");return {from,to,weight:value.weight,sourceIds:[...value.sourceIds].sort()};}).sort((a,b)=>b.weight-a.weight||a.from.localeCompare(b.from)||a.to.localeCompare(b.to));
  const conflicts=concepts.filter((concept)=>concept.semanticTypes.length>1&&concept.sourceIds.length>1).map((concept)=>({key:concept.key,sourceIds:concept.sourceIds,semanticTypes:concept.semanticTypes,reason:"semantic-type-disagreement" as const}));
  const crossSourceConcepts=concepts.filter((concept)=>concept.sourceIds.length>1).length; const conflictPenalty=conflicts.length/Math.max(1,concepts.length); const coverage=pages.length===0?0:Math.min(1,crossSourceConcepts/Math.max(1,concepts.length));
  const confidence=Number(Math.max(0,Math.min(1,0.5+coverage*0.4-conflictPenalty*0.25)).toFixed(3));
  return {pages:analyzed,concepts,relations,conflicts,confidence};
}
function normalizeConcept(value:string):string { const normalized=value.normalize("NFKC").toLocaleLowerCase().replace(KEYWORD_NORMALIZATION,"").trim(); return CONCEPT_ALIASES[normalized] ?? normalized; }
function extractDomainConcepts(text:string): string[] { return Object.keys(CONCEPT_ALIASES).filter((term)=>text.includes(term)); }