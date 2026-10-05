import Database from 'better-sqlite3';
import { initializeDatabaseSchema } from '../db/schema';
import { QuestionRepository } from '../db/repository';
import { PdfStagingRepository } from '../db/stagingRepository';

const proposal = {
  id: 'proposal-1',
  pageStart: 1,
  pageEnd: 2,
  title: '中和滴定',
  taxonomy: { id: 'tax_chem_01', subjectId: 'chemistry', subjectName: '化学', domainName: '理論化学', unitName: '酸と塩基' },
  difficulty: 3,
  tags: ['中和'],
  body: { nodes: [{ id: 'n1', type: 'paragraph' as const, content: '問題本文' }] },
  selected: true,
  edited: false,
};

describe('PdfStagingRepository', () => {
  let db: Database.Database;
  let staging: PdfStagingRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    initializeDatabaseSchema(db);
    staging = new PdfStagingRepository(db, new QuestionRepository(db));
  });

  afterEach(() => db.close());

  test('作成直後はdraftで、questionsには登録されない', () => {
    const created = staging.create({
      source: { sourcePath: '/tmp/source.pdf', sourceSha256: 'abc123', pageCount: 2, fileName: 'source.pdf' },
      proposals: [proposal],
    });

    expect(created.status).toBe('draft');
    expect((db.prepare('SELECT COUNT(*) AS count FROM questions').get() as any).count).toBe(0);
  });

  test('承認時だけ選択済み提案をquestionsへトランザクション登録する', () => {
    const created = staging.create({
      source: { sourcePath: '/tmp/source.pdf', sourceSha256: 'abc123', pageCount: 2, fileName: 'source.pdf' },
      proposals: [proposal],
    });

    const result = staging.approve(created.id);

    expect(result.questionIds).toEqual(['proposal-1']);
    expect(staging.get(created.id)?.status).toBe('approved');
    expect((db.prepare('SELECT COUNT(*) AS count FROM questions').get() as any).count).toBe(1);
  });

  test('draft以外は再編集・再承認できない', () => {
    const created = staging.create({
      source: { sourcePath: '/tmp/source.pdf', sourceSha256: 'abc123', pageCount: 2, fileName: 'source.pdf' },
      proposals: [proposal],
    });

    staging.reject(created.id);
    expect(() => staging.approve(created.id)).toThrow('Only draft staging imports can be approved.');
    expect(() => staging.updateProposal({ stagingId: created.id, proposal })).toThrow('Only draft staging imports can be edited.');
  });
});
