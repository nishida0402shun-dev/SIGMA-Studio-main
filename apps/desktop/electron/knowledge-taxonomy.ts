export interface KnowledgeTaxonomyNode {
  id: string;
  name: string;
  aliases?: string[];
  children?: KnowledgeTaxonomyNode[];
}

export const KNOWLEDGE_TAXONOMY_VERSION = 2;

/**
 * Standard learning taxonomy used by Knowledge DB classification.
 * The library remains global; taxonomy is a classification path, not a storage partition.
 *
 * Design rule: the six top-level subjects are fixed, with subject-specific depth only where
 * it improves retrieval. In particular, mathematics is subject -> course -> unit, while
 * English keeps its approved learning-area structure and only deepens vocabulary/grammar.
 */
export const KNOWLEDGE_TAXONOMY: KnowledgeTaxonomyNode[] = [
  {
    id: "math",
    name: "数学",
    children: [
      { id: "math-i", name: "数学I", aliases: ["数学Ⅰ"], children: [
        { id: "math-i-expressions", name: "数と式" },
        { id: "math-i-geometry-measurement", name: "図形と計量" },
        { id: "math-i-quadratic", name: "二次関数" },
        { id: "math-i-data-analysis", name: "データの分析" },
      ]},
      { id: "math-a", name: "数学A", children: [
        { id: "math-a-geometry", name: "図形の性質" },
        { id: "math-a-counting-probability", name: "場合の数と確率" },
        { id: "math-a-human-activity", name: "数学と人間の活動" },
      ]},
      { id: "math-ii", name: "数学II", aliases: ["数学Ⅱ"], children: [
        { id: "math-ii-proofs", name: "式と証明" },
        { id: "math-ii-complex-equations", name: "複素数と方程式" },
        { id: "math-ii-coordinate-geometry", name: "図形と方程式" },
        { id: "math-ii-trigonometry", name: "三角関数" },
        { id: "math-ii-exp-log", name: "指数関数・対数関数" },
        { id: "math-ii-differentiation", name: "微分法" },
        { id: "math-ii-integration", name: "積分法" },
      ]},
      { id: "math-b", name: "数学B", children: [
        { id: "math-b-sequences", name: "数列" },
        { id: "math-b-statistical-inference", name: "統計的な推測" },
        { id: "math-b-society", name: "数学と社会生活" },
      ]},
      { id: "math-iii", name: "数学III", aliases: ["数学Ⅲ"], children: [
        { id: "math-iii-limits", name: "極限" },
        { id: "math-iii-differentiation", name: "微分法" },
        { id: "math-iii-integration", name: "積分法" },
        { id: "math-iii-complex-plane", name: "複素数平面" },
      ]},
      { id: "math-c", name: "数学C", children: [
        { id: "math-c-vectors", name: "ベクトル" },
        { id: "math-c-curves-complex", name: "平面上の曲線と複素数平面" },
        { id: "math-c-representation", name: "数学的な表現の工夫" },
      ]},
    ],
  },
  {
    id: "english",
    name: "英語",
    children: [
      { id: "english-vocabulary-usage", name: "語彙・語法", children: [
        { id: "english-vocabulary-basic", name: "基礎語彙" },
        { id: "english-vocabulary-frequent", name: "頻出語彙" },
        { id: "english-vocabulary-idioms", name: "熟語・イディオム" },
        { id: "english-vocabulary-usage", name: "語法" },
        { id: "english-vocabulary-polysemy-synonyms", name: "多義語・同意語・類義語" },
        { id: "english-vocabulary-word-formation", name: "派生語・語形成" },
      ]},
      { id: "english-grammar", name: "文法", children: [
        { id: "english-grammar-sentence-structure", name: "文の基本構造" },
        { id: "english-grammar-tenses", name: "時制" },
        { id: "english-grammar-modals", name: "助動詞" },
        { id: "english-grammar-passive", name: "受動態" },
        { id: "english-grammar-infinitive", name: "不定詞" },
        { id: "english-grammar-gerund", name: "動名詞" },
        { id: "english-grammar-participle", name: "分詞" },
        { id: "english-grammar-relative", name: "関係詞" },
        { id: "english-grammar-comparison", name: "比較" },
        { id: "english-grammar-subjunctive", name: "仮定法" },
        { id: "english-grammar-direct-indirect-speech", name: "話法" },
        { id: "english-grammar-conjunctions", name: "接続詞" },
        { id: "english-grammar-prepositions", name: "前置詞" },
        { id: "english-grammar-negation-inversion-emphasis", name: "否定・倒置・省略・強調" },
      ]},
      { id: "english-interpretation-structure", name: "英文解釈・構文" },
      { id: "english-reading", name: "長文読解" },
      { id: "english-writing", name: "英作文・ライティング" },
      { id: "english-listening", name: "リスニング" },
    ],
  },
  {
    id: "japanese",
    name: "国語",
    children: [
      { id: "japanese-modern", name: "現代文", children: [
        { id: "japanese-modern-critical", name: "評論" },
        { id: "japanese-modern-fiction", name: "小説" },
        { id: "japanese-modern-essay", name: "随筆" },
        { id: "japanese-modern-vocabulary", name: "語彙" },
        { id: "japanese-modern-kanji", name: "漢字" },
      ]},
      { id: "japanese-classical", name: "古文", children: [
        { id: "japanese-classical-vocab", name: "古文単語" },
        { id: "japanese-classical-grammar", name: "古典文法", children: [
          { id: "japanese-classical-grammar-inflection", name: "用言" },
          { id: "japanese-classical-grammar-auxiliary", name: "助動詞" },
          { id: "japanese-classical-grammar-particle", name: "助詞" },
          { id: "japanese-classical-grammar-honorific", name: "敬語" },
          { id: "japanese-classical-grammar-kakari-musubi", name: "係り結び" },
          { id: "japanese-classical-grammar-other", name: "その他の文法" },
        ]},
        { id: "japanese-classical-reading", name: "古文読解" },
        { id: "japanese-classical-culture", name: "古典常識" },
      ]},
      { id: "japanese-kanbun", name: "漢文", children: [
        { id: "japanese-kanbun-syntax", name: "漢文句法" },
        { id: "japanese-kanbun-vocab", name: "漢文単語・語彙" },
        { id: "japanese-kanbun-reading", name: "漢文読解" },
        { id: "japanese-kanbun-culture", name: "漢文常識" },
      ]},
    ],
  },
  {
    id: "science",
    name: "理科",
    children: [
      { id: "physics", name: "物理", children: [
        { id: "physics-mechanics", name: "力学" },
        { id: "physics-thermal", name: "熱力学" },
        { id: "physics-waves", name: "波動" },
        { id: "physics-electromagnetism", name: "電磁気" },
        { id: "physics-atomic", name: "原子" },
      ]},
      { id: "chemistry", name: "化学", children: [
        { id: "chemistry-theory", name: "理論" },
        { id: "chemistry-inorganic", name: "無機" },
        { id: "chemistry-organic", name: "有機" },
      ]},
      { id: "biology", name: "生物", children: [
        { id: "biology-cell-biomolecules", name: "細胞・生体物質" },
        { id: "biology-metabolism", name: "代謝" },
        { id: "biology-genetics", name: "遺伝" },
        { id: "biology-reproduction-development", name: "生殖・発生" },
        { id: "biology-information-homeostasis", name: "生体情報・恒常性" },
        { id: "biology-evolution-systematics", name: "生物の進化・系統" },
        { id: "biology-ecosystem-environment", name: "生態系・環境" },
      ]},
      { id: "earth-science", name: "地学", children: [
        { id: "earth-science-structure-activity", name: "地球の構造・活動" },
        { id: "earth-science-geology-history", name: "地質・地史" },
        { id: "earth-science-atmosphere-ocean", name: "大気・海洋" },
        { id: "earth-science-space", name: "宇宙・天体" },
        { id: "earth-science-environment-disasters", name: "地球環境・自然災害" },
      ]},
    ],
  },
  {
    id: "social-studies",
    name: "社会",
    children: [
      { id: "geography", name: "地理", children: [
        { id: "geography-map", name: "地図・地理情報" },
        { id: "geography-natural-environment", name: "自然環境" },
        { id: "geography-resources-industry", name: "資源・産業" },
        { id: "geography-population-urban", name: "人口・都市" },
        { id: "geography-culture-life", name: "文化・生活" },
        { id: "geography-japan", name: "日本地理" },
        { id: "geography-world", name: "世界地理" },
      ]},
      { id: "japanese-history", name: "日本史", children: [
        { id: "japanese-history-ancient", name: "原始・古代" },
        { id: "japanese-history-medieval", name: "中世" },
        { id: "japanese-history-early-modern", name: "近世" },
        { id: "japanese-history-modern", name: "近代" },
        { id: "japanese-history-contemporary", name: "現代" },
      ]},
      { id: "world-history", name: "世界史", children: [
        { id: "world-history-ancient", name: "古代" },
        { id: "world-history-medieval", name: "中世" },
        { id: "world-history-early-modern", name: "近世" },
        { id: "world-history-modern-contemporary", name: "近現代" },
      ]},
      { id: "civics", name: "公民", children: [
        { id: "civics-modern-society-thought", name: "現代社会・社会思想" },
        { id: "civics-politics", name: "政治" },
        { id: "civics-economics", name: "経済" },
        { id: "civics-international", name: "国際社会" },
      ]},
    ],
  },
  {
    id: "information",
    name: "情報",
    children: [
      { id: "information-society-ethics", name: "情報社会・情報モラル" },
      { id: "information-computing-technology", name: "コンピュータ・情報技術" },
      { id: "information-design", name: "情報デザイン" },
      { id: "information-data-statistics", name: "データ・統計" },
      { id: "information-programming", name: "プログラミング" },
      { id: "information-network-security", name: "ネットワーク・セキュリティ" },
    ],
  },
];

export interface KnowledgeTaxonomyMatch {
  nodeId: string;
  path: string[];
  score: number;
  confidence: number;
}

function normalizeTaxonomyText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase();
}

function walkTaxonomy(
  nodes: KnowledgeTaxonomyNode[],
  parentPath: string[],
  output: Array<{ node: KnowledgeTaxonomyNode; path: string[] }>,
): void {
  for (const node of nodes) {
    const path = [...parentPath, node.name];
    output.push({ node, path });
    if (node.children) walkTaxonomy(node.children, path, output);
  }
}

/**
 * Deterministic taxonomy classification. It returns multiple matches so
 * cross-unit/fusion problems can reference more than one branch.
 */
export function classifyKnowledgeTaxonomy(text: string, keywords: string[] = []): KnowledgeTaxonomyMatch[] {
  const normalized = normalizeTaxonomyText([text, ...keywords].join("\n"));
  if (!normalized.trim()) return [];

  const candidates: KnowledgeTaxonomyMatch[] = [];
  const flattened: Array<{ node: KnowledgeTaxonomyNode; path: string[] }> = [];
  walkTaxonomy(KNOWLEDGE_TAXONOMY, [], flattened);

  for (const { node, path } of flattened) {
    const terms = [node.name, ...(node.aliases ?? [])]
      .map(normalizeTaxonomyText)
      .filter((term) => term.length >= 2);
    if (!terms.length) continue;

    let score = 0;
    for (const term of terms) {
      if (normalized.includes(term)) {
        score = Math.max(score, term.length >= 5 ? 1 : 0.82);
      }
    }
    if (score > 0) {
      score += Math.min(0.25, path.length * 0.04);
      const boundedScore = Math.min(1, score);
      candidates.push({
        nodeId: node.id,
        path,
        score: boundedScore,
        confidence: boundedScore,
      });
    }
  }

  return candidates
    .sort((a, b) => b.score - a.score || b.path.length - a.path.length)
    .slice(0, 4);
}
