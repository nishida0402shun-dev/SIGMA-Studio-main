import type { KnowledgePage, KnowledgeSemanticType, KnowledgeSearchResult } from "./knowledge-db-store";
import type { KnowledgeStructureBlockType } from "./knowledge-db-structure-parser";

function tokenizeForSearch(text: string): string[] {
  const normalized = text.normalize("NFKC").toLocaleLowerCase();
  const tokens = normalized.match(/[\\p{L}\\p{N}][\\p{P}\\p{L}\\p{N}_-]*/gu) ?? [];
  const japanese = normalized.match(/[一-龯々〆ヵヶぁ-ゖァ-ヺー]{2,}/gu) ?? [];
  const morphemeLike: string[] = [];
  for (const token of japanese) {
    // Character bigrams improve recall for Japanese queries without requiring a heavyweight tokenizer.
    if (token.length <= 4) morphemeLike.push(token);
    for (let i = 0; i < token.length - 1; i += 1) morphemeLike.push(token.slice(i, i + 2));
  }
  return [...new Set([...tokens, ...morphemeLike])];
}

function selectDiverseContextResults(
  results: KnowledgeSearchResult[],
  limit: number,
  maxChars: number,
  pagesBySource: Map<string, KnowledgePage[]>,
): {
  primary: KnowledgeSearchResult[];
  related: Array<{ result: KnowledgeSearchResult; relatedTo: string }>;
} {
  const primary: KnowledgeSearchResult[] = [];
  const related: Array<{ result: KnowledgeSearchResult; relatedTo: string }> = [];
  const seenSources = new Set<string>();
  const seenPages = new Set<string>();
  const estimatedBudget = Math.max(1, Math.floor(maxChars / Math.max(1, limit)));
  const primaryTarget = Math.max(1, Math.min(limit, Math.ceil(limit / 2)));

  for (const result of results) {
    if (primary.length >= primaryTarget) break;
    const key = `${result.sourceId}:${result.pageNumber}`;
    if (seenPages.has(key)) continue;
    // Maximize source diversity first, then let score dominate within a source.
    const sourceAlreadyRepresented = seenSources.has(result.sourceId);
    if (sourceAlreadyRepresented && primary.length < Math.min(primaryTarget, 3)) continue;
    if (!result.text.trim() && result.citationRegions?.length === 0) continue;
    primary.push(result);
    seenPages.add(key);
    seenSources.add(result.sourceId);

    const sourcePages = pagesBySource.get(result.sourceId) ?? [];
    const primaryPage = sourcePages.find((page) => page.pageNumber === result.pageNumber);
    const primaryTaxonomy = primaryPage?.taxonomyPaths?.[0]?.join(" → ") ?? "";
    const nearby = sourcePages
      .filter((page) => Math.abs(page.pageNumber - result.pageNumber) <= 1 && page.pageNumber !== result.pageNumber)
      .filter((page) => Boolean(page.text?.trim()))
      .filter((page) => {
        const taxonomy = page.taxonomyPaths?.[0]?.join(" → ") ?? "";
        return primaryTaxonomy && taxonomy ? taxonomy === primaryTaxonomy : true;
      })
      .sort((a, b) => Math.abs(a.pageNumber - result.pageNumber) - Math.abs(b.pageNumber - result.pageNumber));

    const crossSource = results.find((candidate) =>
      candidate.sourceId !== result.sourceId &&
      !seenPages.has(`${candidate.sourceId}:${candidate.pageNumber}`)
    );
    if (crossSource && !related.some((item) => item.result.id === crossSource.id)) {
      related.push({
        result: {
          ...crossSource,
          score: Math.max(0, crossSource.score * 0.9),
          matchReasons: ["関連ソース", ...crossSource.matchReasons.filter((reason) => reason !== "関連ソース")],
        },
        relatedTo: key,
      });
      seenPages.add(`${crossSource.sourceId}:${crossSource.pageNumber}`);
    }

    const relatedPage = nearby[0];
    if (relatedPage) {
      const relatedKey = `${relatedPage.sourceId}:${relatedPage.pageNumber}`;
      if (!seenPages.has(relatedKey)) {
        const relatedResult: KnowledgeSearchResult = {
          id: `${relatedPage.id}_related`,
          sourceId: relatedPage.sourceId,
          pageNumber: relatedPage.pageNumber,
          chunkIndex: 0,
          text: relatedPage.text ?? "",
          score: Math.max(0, result.score * 0.82),
          sourceName: result.sourceName,
          matchReasons: ["関連ページ"],
          citationRegions: selectCitationRegions(relatedPage, relatedPage.text ?? ""),
        };
        related.push({ result: relatedResult, relatedTo: key });
        seenPages.add(relatedKey);
      }
    }
    // Avoid filling the context with many near-duplicate long pages.
    if (result.text.length > estimatedBudget && primary.length >= Math.min(limit, 2)) continue;
  }

  return { primary, related };
}

function exactPhraseScore(text: string, query: string): number {
  const normalizedText = text.normalize("NFKC").toLocaleLowerCase().replace(/\\s+/gu, " ").trim();
  const normalizedQuery = query.normalize("NFKC").toLocaleLowerCase().replace(/\\s+/gu, " ").trim();
  if (!normalizedText || !normalizedQuery) return 0;
  if (normalizedText.includes(normalizedQuery)) return 1;
  const compactText = normalizedText.replace(/\\s+/gu, "");
  const compactQuery = normalizedQuery.replace(/\\s+/gu, "");
  return compactQuery.length >= 4 && compactText.includes(compactQuery) ? 0.7 : 0;
}

function buildDocumentFrequency(pages: KnowledgePage[]): Map<string, number> {
  const frequency = new Map<string, number>();
  for (const page of pages) {
    const uniqueTokens = new Set(tokenizeForSearch(page.text ?? ""));
    for (const token of uniqueTokens) frequency.set(token, (frequency.get(token) ?? 0) + 1);
  }
  return frequency;
}

function lexicalScore(
  text: string,
  queryTokens: string[],
  documentFrequency: Map<string, number>,
  documentCount: number,
): number {
  if (queryTokens.length === 0 || !text.trim()) return 0;
  const normalized = text.normalize("NFKC").toLocaleLowerCase();
  const tokens = tokenizeForSearch(text);
  const tokenCounts = new Map<string, number>();
  for (const token of tokens) tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);
  const lengthNorm = Math.sqrt(Math.max(1, tokens.length));
  let score = 0;
  let weight = 0;
  for (const queryToken of queryTokens) {
    const variants = searchTokenVariants(queryToken);
    const tf = variants.reduce((sum, variant) => sum + (tokenCounts.get(variant) ?? 0), 0);
    if (tf === 0 && !variants.some((variant) => normalized.includes(variant))) continue;
    const df = documentFrequency.get(queryToken) ?? 0;
    const idf = Math.log(1 + (documentCount + 1) / (df + 1));
    const tfWeight = tf > 0 ? (1 + Math.log(tf)) / lengthNorm : 0.35;
    score += idf * tfWeight;
    weight += idf;
  }
  if (weight === 0) return 0;
  return Math.min(1, score / weight * 2.2);
}

function semanticQueryScore(page: KnowledgePage, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  const semanticText = [
    page.semanticType,
    page.title ?? "",
    ...(page.keywords ?? []),
    ...(page.analysisSignals ?? []),
    ...(page.taxonomyPaths ?? []).flat(),
  ].join(" ").normalize("NFKC").toLocaleLowerCase();
  const hits = queryTokens.filter((token) => semanticText.includes(token)).length;
  return Math.min(1, hits / queryTokens.length);
}

function normalizeSearchToken(token: string): string {
  return token.normalize("NFKC").toLocaleLowerCase().replace(/[\\p{P}\\p{S}]/gu, "");
}

function searchTokenVariants(token: string): string[] {
  const normalized = normalizeSearchToken(token);
  const variants = new Set([normalized]);
  const aliases: Record<string, string[]> = {
    "pdf": ["portable document format"],
    "ocr": ["文字認識", "光学文字認識"],
    "rag": ["retrieval augmented generation", "検索拡張生成"],
    "ai": ["人工知能"],
    "人工知能": ["ai"],
    "検索": ["retrieval", "search"],
    "retrieval": ["検索"],
    "分類": ["taxonomy", "classification"],
    "taxonomy": ["分類"],
    "定義": ["definition"],
    "definition": ["定義"],
    "解答": ["solution", "answer"],
    "solution": ["解答", "answer"],
  };
  for (const alias of aliases[normalized] ?? []) variants.add(alias);
  return [...variants];
}

function metadataScore(page: KnowledgePage, query: string, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  const title = page.title?.normalize("NFKC").toLocaleLowerCase() ?? "";
  const keywords = (page.keywords ?? []).map((keyword) => keyword.normalize("NFKC").toLocaleLowerCase());
  const keywordHits = queryTokens.filter((token) => searchTokenVariants(token).some((variant) => keywords.some((keyword) => keyword === variant || keyword.includes(variant)))).length;
  const titleHits = queryTokens.filter((token) => searchTokenVariants(token).some((variant) => title.includes(variant))).length;
  let score = Math.max(
    keywordHits / queryTokens.length,
    titleHits / queryTokens.length,
  );

  const semanticType = semanticTypeFromQuery(query);
  if (semanticType && page.semanticType === semanticType) {
    score = Math.max(score, 1);
  }
  return Math.min(1, score);
}

function selectCitationRegions(page: KnowledgePage, matchedText: string): Array<{
  type: KnowledgeStructureBlockType;
  text: string;
  bbox?: [number, number, number, number];
  confidence?: number;
}> {
  const blocks = page.structureBlocks ?? [];
  if (blocks.length === 0) return [];
  const normalizedMatch = matchedText.normalize("NFKC").replace(/\s+/gu, "").toLocaleLowerCase();
  const scored = blocks.map((block, index) => {
    const normalizedBlock = block.text.normalize("NFKC").replace(/\s+/gu, "").toLocaleLowerCase();
    const overlap = normalizedMatch && normalizedBlock
      ? (normalizedBlock.includes(normalizedMatch) ? 1 : normalizedMatch.includes(normalizedBlock) ? 0.8 : 0)
      : 0;
    const semanticBoost = /^(table|figure|formula|title|caption)$/u.test(block.type) ? 0.1 : 0;
    return { block, score: overlap + semanticBoost, index };
  });
  return scored
    .filter(({ block }) => block.text.trim())
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 3)
    .map(({ block }) => ({
      type: block.type,
      text: block.text.slice(0, 500),
      ...(block.bbox ? { bbox: block.bbox } : {}),
      ...(block.confidence === undefined ? {} : { confidence: block.confidence }),
    }));
}

function retrievalMatchReasons(
  page: KnowledgePage,
  query: string,
  queryTokens: string[],
  vector: number,
  lexical: number,
  metadata: number,
): string[] {
  const reasons: string[] = [];
  if (vector >= 0.65) reasons.push("意味類似度が高い");
  if (exactPhraseScore(page.text ?? "", query) > 0) reasons.push("完全一致");
  if (lexical > 0) reasons.push(`本文一致 ${Math.round(lexical * 100)}%`);
  if (page.title && queryTokens.some((token) => searchTokenVariants(token).some((variant) => page.title!.toLocaleLowerCase().includes(variant)))) reasons.push("タイトル一致");
  if ((page.keywords ?? []).some((keyword) => queryTokens.some((token) => searchTokenVariants(token).some((variant) => keyword.toLocaleLowerCase().includes(variant))))) reasons.push("キーワード一致");
  const semanticType = semanticTypeFromQuery(query);
  if (semanticType && page.semanticType === semanticType) reasons.push(`分類一致: ${semanticType}`);
  if (page.taxonomyPaths?.length) reasons.push(`分類: ${page.taxonomyPaths[0]!.join(" → ")}`);
  if (metadata >= 0.8 && reasons.length === 0) reasons.push("解析メタデータ一致");
  return reasons.slice(0, 5);
}

function semanticTypeFromQuery(query: string): KnowledgeSemanticType | undefined {
  const normalized = query.normalize("NFKC").toLocaleLowerCase();
  const rules: Array<[KnowledgeSemanticType, RegExp]> = [
    ["problem", /(?:問題|練習問題|演習|設問|例題|practice|exercise|problem|question)/u],
    ["example", /(?:例|具体例|example|worked example)/u],
    ["definition", /(?:定義|definition|defined as)/u],
    ["theorem", /(?:定理|命題|補題|系|theorem|proposition|lemma|corollary)/u],
    ["answer", /(?:解答|答え|解説付き解答|answer|solution)/u],
    ["column", /(?:コラム|column|note|豆知識)/u],
    ["explanation", /(?:解説|説明|考え方|ポイント|概説|explanation|overview|discussion)/u],
    ["figure", /(?:図|画像|figure|diagram|illustration)/u],
  ];
  return rules.find(([, pattern]) => pattern.test(normalized))?.[0];
}
