import Database from 'better-sqlite3';

export function initializeDatabaseSchema(db: Database.Database): void {
  db.pragma('journal_mode = WAL');

  db.transaction(() => {
    // 1. タクソノミー（教科・単元マスター）
    db.exec(`
      CREATE TABLE IF NOT EXISTS taxonomy (
        id TEXT PRIMARY KEY,
        subject_id TEXT NOT NULL,
        subject_name TEXT NOT NULL,
        domain_name TEXT NOT NULL,
        unit_name TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0
      );
    `);

    // 2. 問題テーブル
    db.exec(`
      CREATE TABLE IF NOT EXISTS questions (
        id TEXT PRIMARY KEY,
        taxonomy_id TEXT NOT NULL,
        title TEXT NOT NULL,
        difficulty INTEGER NOT NULL CHECK(difficulty BETWEEN 1 AND 5),
        tags TEXT,
        body_json TEXT NOT NULL,
        solution_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (taxonomy_id) REFERENCES taxonomy(id)
      );
    `);

    // インデックス作成
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_questions_taxonomy ON questions(taxonomy_id);
      CREATE INDEX IF NOT EXISTS idx_questions_difficulty ON questions(difficulty);
      CREATE INDEX IF NOT EXISTS idx_taxonomy_subject ON taxonomy(subject_id);
    `);

    // 3. SQLite FTS5 (Full-Text Search) 仮想テーブル
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS questions_fts USING fts5(
        title,
        body_text,
        tags,
        content='questions',
        content_rowid='rowid'
      );
    `);

    // 4. FTS5 自動更新トリガー
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS questions_ai AFTER INSERT ON questions BEGIN
        INSERT INTO questions_fts(rowid, title, body_text, tags)
        VALUES (new.rowid, new.title, new.body_json, new.tags);
      END;

      CREATE TRIGGER IF NOT EXISTS questions_ad AFTER DELETE ON questions BEGIN
        INSERT INTO questions_fts(questions_fts, rowid, title, body_text, tags)
        VALUES('delete', old.rowid, old.title, old.body_json, old.tags);
      END;

      CREATE TRIGGER IF NOT EXISTS questions_au AFTER UPDATE ON questions BEGIN
        INSERT INTO questions_fts(questions_fts, rowid, title, body_text, tags)
        VALUES('delete', old.rowid, old.title, old.body_json, old.tags);
        INSERT INTO questions_fts(rowid, title, body_text, tags)
        VALUES (new.rowid, new.title, new.body_json, new.tags);
      END;
    `);


    // 5. PDF取り込みステージング。原本PDFは保存せず、原本参照とAI提案だけを保持する。
    db.exec(`
      CREATE TABLE IF NOT EXISTS pdf_import_staging (
        id TEXT PRIMARY KEY,
        source_path TEXT NOT NULL,
        source_sha256 TEXT NOT NULL,
        file_name TEXT NOT NULL,
        page_count INTEGER NOT NULL CHECK(page_count > 0),
        status TEXT NOT NULL CHECK(status IN ('draft', 'approved', 'rejected')),
        proposals_json TEXT NOT NULL,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        approved_at DATETIME
      );
      CREATE INDEX IF NOT EXISTS idx_pdf_import_staging_status ON pdf_import_staging(status);
      CREATE INDEX IF NOT EXISTS idx_pdf_import_staging_source_sha ON pdf_import_staging(source_sha256);
    `);

    // デフォルトマスターデータ初期化
    const checkStmt = db.prepare('SELECT COUNT(*) as count FROM taxonomy');
    const { count } = checkStmt.get() as { count: number };

    if (count === 0) {
      const insertTax = db.prepare(`
        INSERT INTO taxonomy (id, subject_id, subject_name, domain_name, unit_name, sort_order)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      const defaults = [
        ['tax_chem_01', 'chemistry', '化学', '理論化学', '酸と塩基', 1],
        ['tax_chem_02', 'chemistry', '化学', '理論化学', '酸化還元', 2],
        ['tax_math_01', 'math', '数学', '解析', '微分・積分', 10],
        ['tax_math_02', 'math', '数学', '代数', 'ベクトル', 11],
        ['tax_phys_01', 'physics', '物理', '力学', '運動方程式', 20],
        ['tax_eng_01', 'english', '英語', '読解', '長文読解', 30],
      ];
      for (const item of defaults) {
        insertTax.run(...item);
      }
    }
  })();
}
