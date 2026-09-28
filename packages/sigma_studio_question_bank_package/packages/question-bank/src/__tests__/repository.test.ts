import Database from 'better-sqlite3';
import { initializeDatabaseSchema } from '../db/schema';
import { QuestionRepository } from '../db/repository';

describe('QuestionRepository & FTS5 Integration Tests', () => {
  let db: Database.Database;
  let repo: QuestionRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    initializeDatabaseSchema(db);
    repo = new QuestionRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  test('FTS5全文検索で数式およびキーワードの一致確認', () => {
    repo.save({
      id: 'test_q1',
      title: '酢酸と水酸化ナトリウムの中和滴定計算',
      taxonomy: { subjectId: 'chemistry', subjectName: '化学', domainName: '理論化学', unitName: '酸と塩基' },
      difficulty: 3,
      tags: ['中和滴定', '計算'],
      body: {
        nodes: [
          { id: 'n1', type: 'paragraph', content: '滴定実験を行います。' },
          { id: 'n2', type: 'equation', latex: 'CH3COOH + NaOH -> CH3COONa + H2O' },
        ],
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const result = repo.search({ keyword: '中和滴定' });
    expect(result.total).toBe(1);
    expect(result.items[0].id).toBe('test_q1');
  });

  test('教科・難易度フィルターの組み合わせ検索', () => {
    repo.save({
      id: 'test_q2',
      title: '運動方程式の基礎',
      taxonomyId: 'tax_phys_01',
      taxonomy: { subjectId: 'physics', subjectName: '物理', domainName: '力学', unitName: '運動方程式' },
      difficulty: 2,
      tags: ['基礎'],
      body: { nodes: [{ id: 'n1', type: 'paragraph', content: 'F=maを用いよ。' }] },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const result = repo.search({ subjectId: 'physics', difficulty: 2 });
    expect(result.total).toBe(1);
    expect(result.items[0].taxonomy.subjectId).toBe('physics');
  });

  test('存在しない問題を削除してもエラーにならない', () => {
    const result = repo.delete('nonexistent_id');
    expect(result.success).toBe(true);
  });
});
