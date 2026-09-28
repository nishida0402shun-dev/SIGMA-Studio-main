/**
 * SigmaDoc AST ノード定義
 */
export interface SigmaNode {
  id: string;
  type: 'paragraph' | 'equation' | 'image' | 'table' | 'group' | 'list';
  content?: string;
  latex?: string;
  url?: string;
  caption?: string;
  children?: SigmaNode[];
  metadata?: Record<string, any>;
}

/**
 * 教科・分類タクソノミーモデル
 */
export interface Taxonomy {
  id?: string;
  subjectId: string;    // 例: "chemistry", "math", "physics", "english"
  subjectName: string;  // 例: "化学", "数学", "物理", "英語"
  domainName: string;   // 例: "理論化学", "解析", "力学"
  unitName: string;     // 例: "酸と塩基", "微分・積分", "運動方程式"
  subUnitName?: string;
}

/**
 * 問題エンティティ
 */
export interface Question {
  id: string;
  taxonomyId?: string;
  title: string;
  taxonomy: Taxonomy;
  difficulty: number;   // 1 ～ 5
  tags: string[];
  body: {
    nodes: SigmaNode[];
  };
  solution?: {
    answer?: string;
    explanation?: {
      nodes: SigmaNode[];
    };
  };
  createdAt: string;
  updatedAt: string;
}

/**
 * 検索クエリフィルター
 */
export interface QuestionFilter {
  subjectId?: string;
  domainName?: string;
  unitName?: string;
  difficulty?: number;
  tags?: string[];
  keyword?: string;
  page?: number;
  limit?: number;
  sortBy?: 'createdAt' | 'difficulty' | 'title';
  sortOrder?: 'ASC' | 'DESC';
}

/**
 * 検索レスポンス
 */
export interface SearchResponse {
  items: Question[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * 500ページPDFバックグラウンドインポート進捗
 */
export interface ImportProgress {
  jobId: string;
  status: 'idle' | 'processing' | 'completed' | 'failed';
  currentPage: number;
  totalPages: number;
  extractedQuestionsCount: number;
  errorMessage?: string;
}

/**
 * グローバル Window.api 通信型定義
 */
declare global {
  interface Window {
    api?: {
      questions: {
        search: (filter: QuestionFilter) => Promise<SearchResponse>;
        save: (question: Question) => Promise<{ success: boolean; id: string }>;
        delete: (questionId: string) => Promise<{ success: boolean }>;
        startImport: (filePath: string) => Promise<{ jobId: string }>;
        onImportProgress: (callback: (progress: ImportProgress) => void) => () => void;
      };
    };
  }
}
