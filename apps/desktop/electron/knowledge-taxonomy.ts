export interface KnowledgeTaxonomyNode {
  id: string;
  name: string;
  aliases?: string[];
  children?: KnowledgeTaxonomyNode[];
}

export const KNOWLEDGE_TAXONOMY_VERSION = 1;

/**
 * Standard learning taxonomy. It is a classification guide, not a storage
 * partition: the Knowledge DB remains global and a page can reference
 * multiple taxonomy nodes.
 */
export const KNOWLEDGE_TAXONOMY: KnowledgeTaxonomyNode[] = [
  {
    id: "math",
    name: "数学",
    children: [
      { id: "math-i", name: "数学Ⅰ", children: [
        { id: "math-i-expressions", name: "数と式", children: [
          { id: "math-i-expressions-calculation", name: "式の計算" },
          { id: "math-i-expressions-real", name: "実数" },
          { id: "math-i-expressions-linear-inequality", name: "1次不等式" },
          { id: "math-i-expressions-sets-propositions", name: "集合と命題" },
        ]},
        { id: "math-i-quadratic", name: "2次関数", children: [
          { id: "math-i-quadratic-graph", name: "2次関数とグラフ" },
          { id: "math-i-quadratic-extrema", name: "2次関数の最大・最小" },
          { id: "math-i-quadratic-equation", name: "2次方程式" },
          { id: "math-i-quadratic-inequality", name: "2次不等式" },
          { id: "math-i-quadratic-application", name: "応用問題" },
        ]},
        { id: "math-i-geometry-measurement", name: "図形と計量", children: [
          { id: "math-i-trigonometry-ratio", name: "三角比" },
          { id: "math-i-sine-law", name: "正弦定理" },
          { id: "math-i-cosine-law", name: "余弦定理" },
          { id: "math-i-area", name: "面積" },
          { id: "math-i-spatial-geometry", name: "空間図形" },
        ]},
        { id: "math-i-data-analysis", name: "データの分析", children: [
          { id: "math-i-data-organization", name: "データの整理" },
          { id: "math-i-data-representative-values", name: "代表値" },
          { id: "math-i-data-variance", name: "分散・標準偏差" },
          { id: "math-i-data-correlation", name: "相関" },
          { id: "math-i-data-inference", name: "統計的な推測" },
        ]},
      ]},
      { id: "math-ii", name: "数学Ⅱ", children: [
        { id: "math-ii-proofs", name: "式と証明", children: [
          { id: "math-ii-polynomials", name: "多項式" },
          { id: "math-ii-equation-proof", name: "等式・不等式の証明" },
          { id: "math-ii-identity", name: "恒等式" },
        ]},
        { id: "math-ii-complex-equations", name: "複素数と方程式", children: [
          { id: "math-ii-complex", name: "複素数" },
          { id: "math-ii-quadratic", name: "2次方程式" },
          { id: "math-ii-roots-coefficients", name: "解と係数" },
          { id: "math-ii-higher-equations", name: "高次方程式" },
        ]},
        { id: "math-ii-coordinate-geometry", name: "図形と方程式", children: [
          { id: "math-ii-point-line", name: "点と直線" },
          { id: "math-ii-circle", name: "円" },
          { id: "math-ii-locus", name: "軌跡" },
          { id: "math-ii-region", name: "領域" },
        ]},
        { id: "math-ii-trigonometry", name: "三角関数", children: [
          { id: "math-ii-general-angle", name: "一般角" },
          { id: "math-ii-radian", name: "弧度法" },
          { id: "math-ii-trig-functions", name: "三角関数" },
          { id: "math-ii-addition-theorem", name: "加法定理" },
          { id: "math-ii-trig-equations", name: "方程式・不等式" },
        ]},
        { id: "math-ii-exp-log", name: "指数関数・対数関数", children: [
          { id: "math-ii-exponents", name: "指数" },
          { id: "math-ii-exp-function", name: "指数関数" },
          { id: "math-ii-logarithms", name: "対数" },
          { id: "math-ii-log-function", name: "対数関数" },
          { id: "math-ii-exp-log-equations", name: "方程式・不等式" },
        ]},
        { id: "math-ii-calculus", name: "微分法・積分法", children: [
          { id: "math-ii-derivative", name: "微分係数・導関数" },
          { id: "math-ii-tangent", name: "接線" },
          { id: "math-ii-monotonicity", name: "関数の増減" },
          { id: "math-ii-extrema", name: "極値" },
          { id: "math-ii-indefinite-integral", name: "不定積分" },
          { id: "math-ii-definite-integral", name: "定積分" },
          { id: "math-ii-area", name: "面積" },
        ]},
      ]},
      { id: "math-iii", name: "数学Ⅲ", children: [
        { id: "math-iii-limits", name: "極限", children: [
          { id: "math-iii-sequence-limit", name: "数列の極限" },
          { id: "math-iii-function-limit", name: "関数の極限" },
          { id: "math-iii-infinite-series", name: "無限級数" },
        ]},
        { id: "math-iii-differentiation", name: "微分法", children: [
          { id: "math-iii-composite", name: "合成関数" },
          { id: "math-iii-inverse", name: "逆関数" },
          { id: "math-iii-parametric", name: "媒介変数表示" },
          { id: "math-iii-higher-derivative", name: "高次導関数" },
          { id: "math-iii-diff-application", name: "微分法の応用" },
        ]},
        { id: "math-iii-integration", name: "積分法", children: [
          { id: "math-iii-indefinite", name: "不定積分" },
          { id: "math-iii-definite", name: "定積分" },
          { id: "math-iii-substitution", name: "置換積分" },
          { id: "math-iii-by-parts", name: "部分積分" },
          { id: "math-iii-area", name: "面積" },
          { id: "math-iii-volume", name: "体積" },
          { id: "math-iii-arc-length", name: "曲線の長さ" },
        ]},
        { id: "math-iii-complex-plane", name: "複素数平面", children: [
          { id: "math-iii-complex-plane-basic", name: "複素数平面" },
          { id: "math-iii-polar-form", name: "極形式" },
          { id: "math-iii-demoivre", name: "ド・モアブルの定理" },
          { id: "math-iii-complex-geometry", name: "図形への応用" },
        ]},
        { id: "math-iii-curves", name: "平面上の曲線", children: [
          { id: "math-iii-conics", name: "2次曲線" },
          { id: "math-iii-parametric-curves", name: "媒介変数表示" },
          { id: "math-iii-polar-coordinates", name: "極座標" },
        ]},
      ]},
      { id: "math-a", name: "数学A", children: [
        { id: "math-a-geometry", name: "図形の性質", children: [
          { id: "math-a-triangle", name: "三角形" },
          { id: "math-a-circle", name: "円" },
          { id: "math-a-spatial", name: "空間図形" },
          { id: "math-a-construction", name: "作図" },
        ]},
        { id: "math-a-counting-probability", name: "場合の数と確率", children: [
          { id: "math-a-sets", name: "集合" },
          { id: "math-a-counting", name: "場合の数" },
          { id: "math-a-permutation", name: "順列" },
          { id: "math-a-combination", name: "組合せ" },
          { id: "math-a-probability", name: "確率" },
          { id: "math-a-conditional-probability", name: "条件付き確率" },
          { id: "math-a-expectation", name: "期待値" },
        ]},
        { id: "math-a-human-activity", name: "数学と人間の活動", children: [
          { id: "math-a-integers", name: "整数" },
          { id: "math-a-divisibility", name: "約数・倍数" },
          { id: "math-a-euclid", name: "ユークリッドの互除法" },
          { id: "math-a-cryptography", name: "暗号" },
          { id: "math-a-history", name: "数学史・文化" },
        ]},
      ]},
      { id: "math-b", name: "数学B", children: [
        { id: "math-b-sequences", name: "数列", children: [
          { id: "math-b-arithmetic", name: "等差数列" },
          { id: "math-b-geometric", name: "等比数列" },
          { id: "math-b-sigma", name: "Σ" },
          { id: "math-b-recurrence", name: "漸化式" },
          { id: "math-b-induction", name: "数学的帰納法" },
        ]},
        { id: "math-b-statistical-inference", name: "統計的な推測", children: [
          { id: "math-b-distribution", name: "確率分布" },
          { id: "math-b-binomial", name: "二項分布" },
          { id: "math-b-normal", name: "正規分布" },
          { id: "math-b-sampling", name: "標本調査" },
          { id: "math-b-estimation", name: "推定" },
          { id: "math-b-hypothesis-test", name: "仮説検定" },
        ]},
        { id: "math-b-society", name: "数学と社会生活", children: [
          { id: "math-b-data-use", name: "データ活用" },
          { id: "math-b-modeling", name: "数理モデル" },
          { id: "math-b-optimization", name: "最適化" },
          { id: "math-b-application", name: "社会への応用" },
        ]},
      ]},
      { id: "math-c", name: "数学C", children: [
        { id: "math-c-vectors", name: "ベクトル", children: [
          { id: "math-c-plane-vectors", name: "平面ベクトル" },
          { id: "math-c-space-vectors", name: "空間ベクトル" },
          { id: "math-c-inner-product", name: "内積" },
          { id: "math-c-position-vector", name: "位置ベクトル" },
          { id: "math-c-vector-geometry", name: "図形への応用" },
        ]},
        { id: "math-c-curves-complex", name: "平面上の曲線と複素数平面", children: [
          { id: "math-c-conics", name: "2次曲線" },
          { id: "math-c-parametric", name: "媒介変数" },
          { id: "math-c-polar", name: "極座標" },
          { id: "math-c-complex-plane", name: "複素数平面" },
          { id: "math-c-complex-geometry", name: "複素数と図形" },
        ]},
        { id: "math-c-representation", name: "数学的な表現の工夫", children: [
          { id: "math-c-matrix-thinking", name: "行列的な考え方" },
          { id: "math-c-graphs", name: "グラフ" },
          { id: "math-c-formula", name: "数式表現" },
          { id: "math-c-mathematical-expression", name: "数理的表現" },
        ]},
      ]},
    ],
  },
  { id: "english", name: "英語", children: [
    { id: "english-vocabulary", name: "英単語" },
    { id: "english-grammar", name: "英文法", children: [
      { id: "english-grammar-sentence-patterns", name: "文型" }, { id: "english-grammar-tenses", name: "時制" },
      { id: "english-grammar-modals", name: "助動詞" }, { id: "english-grammar-passive", name: "受動態" },
      { id: "english-grammar-infinitive-gerund", name: "不定詞・動名詞" }, { id: "english-grammar-participle", name: "分詞・分詞構文" },
      { id: "english-grammar-relative", name: "関係詞" }, { id: "english-grammar-comparison", name: "比較" }, { id: "english-grammar-subjunctive", name: "仮定法" },
    ]},
    { id: "english-interpretation", name: "英文解釈" }, { id: "english-reading", name: "長文読解" },
    { id: "english-writing", name: "英作文" }, { id: "english-listening", name: "リスニング" }, { id: "english-pronunciation", name: "発音・音声" },
  ]},
  { id: "japanese", name: "国語", children: [
    { id: "japanese-modern", name: "現代文", children: [{ id: "japanese-modern-critical", name: "評論・論説" }, { id: "japanese-modern-fiction", name: "小説・随筆" }, { id: "japanese-modern-reading", name: "現代文読解" }]},
    { id: "japanese-classical", name: "古文", children: [{ id: "japanese-classical-vocab", name: "古文単語" }, { id: "japanese-classical-grammar", name: "古典文法" }, { id: "japanese-classical-reading", name: "古文読解" }, { id: "japanese-classical-poetry", name: "和歌" }]},
    { id: "japanese-kanbun", name: "漢文", children: [{ id: "japanese-kanbun-syntax", name: "句法" }, { id: "japanese-kanbun-reading", name: "漢文読解" }]},
    { id: "japanese-literature", name: "文学・作品" },
  ]},
  { id: "physics", name: "物理", children: [{ id: "physics-mechanics", name: "力学" }, { id: "physics-thermal", name: "熱" }, { id: "physics-waves", name: "波動" }, { id: "physics-electromagnetism", name: "電磁気" }, { id: "physics-atomic", name: "原子" }]},
  { id: "chemistry", name: "化学", children: [{ id: "chemistry-theory", name: "理論化学" }, { id: "chemistry-inorganic", name: "無機化学" }, { id: "chemistry-organic", name: "有機化学" }, { id: "chemistry-experiments", name: "実験・分析" }]},
  { id: "biology", name: "生物", children: [{ id: "biology-cell", name: "細胞" }, { id: "biology-genetics", name: "遺伝" }, { id: "biology-metabolism", name: "代謝" }, { id: "biology-development", name: "生殖・発生" }, { id: "biology-homeostasis", name: "体内環境" }, { id: "biology-ecology", name: "生態" }, { id: "biology-evolution", name: "進化・系統" }]},
  { id: "geography", name: "地理", children: [{ id: "geography-map", name: "地図・地理情報" }, { id: "geography-natural", name: "自然環境" }, { id: "geography-population", name: "人口・都市" }, { id: "geography-industry", name: "産業" }, { id: "geography-regions", name: "地域研究" }, { id: "geography-statistics", name: "統計・資料問題" }]},
  { id: "japanese-history", name: "日本史", children: [{ id: "japanese-history-ancient", name: "原始・古代" }, { id: "japanese-history-medieval", name: "中世" }, { id: "japanese-history-early-modern", name: "近世" }, { id: "japanese-history-modern", name: "近代" }, { id: "japanese-history-contemporary", name: "現代" }, { id: "japanese-history-themes", name: "テーマ史" }]},
  { id: "world-history", name: "世界史", children: [{ id: "world-history-ancient", name: "古代" }, { id: "world-history-medieval", name: "中世" }, { id: "world-history-early-modern", name: "近世" }, { id: "world-history-modern", name: "近代" }, { id: "world-history-contemporary", name: "現代" }, { id: "world-history-themes", name: "テーマ史" }]},
  { id: "civics", name: "公民", children: [{ id: "civics-politics", name: "政治" }, { id: "civics-economics", name: "経済" }, { id: "civics-law", name: "法・社会" }, { id: "civics-philosophy", name: "倫理・思想" }]},
  { id: "other", name: "その他" },
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
    const terms = [node.name, ...(node.aliases ?? [])].map(normalizeTaxonomyText).filter((term) => term.length >= 2);
    if (!terms.length) continue;
    let score = 0;
    for (const term of terms) {
      if (normalized.includes(term)) {
        score = Math.max(score, term.length >= 5 ? 1 : 0.82);
      }
    }
    if (score > 0) {
      // Prefer the deepest matched node; parents remain available as context.
      score += Math.min(0.25, path.length * 0.04);
      const boundedScore = Math.min(1, score);
      candidates.push({
        nodeId: node.id,
        path: path.filter((part, index) => index === 0 || part !== path[index - 1]),
        score: boundedScore,
        confidence: boundedScore,
      });
    }
  }

  return candidates
    .sort((a, b) => b.score - a.score || b.path.length - a.path.length)
    .slice(0, 4);
}
