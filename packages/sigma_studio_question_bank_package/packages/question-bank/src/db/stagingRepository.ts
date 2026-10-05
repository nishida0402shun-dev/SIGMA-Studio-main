import Database from 'better-sqlite3';
import { QuestionRepository } from './repository';
import type {
  CommitPdfStagingResult,
  CreatePdfStagingInput,
  PdfImportStaging,
  StagedQuestionProposal,
  UpdateStagedProposalInput,
} from '../types/staging';

const now = () => new Date().toISOString();

function mapRow(row: any): PdfImportStaging {
  return {
    id: row.id,
    source: {
      sourcePath: row.source_path,
      sourceSha256: row.source_sha256,
      pageCount: row.page_count,
      fileName: row.file_name,
    },
    status: row.status,
    proposals: JSON.parse(row.proposals_json) as StagedQuestionProposal[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    approvedAt: row.approved_at ?? undefined,
  };
}

export class PdfStagingRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly questions: QuestionRepository,
  ) {}

  create(input: CreatePdfStagingInput): PdfImportStaging {
    if (input.source.pageCount < 1) throw new Error('PDF must contain at least one page.');
    if (!input.source.sourceSha256) throw new Error('sourceSha256 is required.');

    const id = crypto.randomUUID();
    const timestamp = now();
    const staging: PdfImportStaging = {
      id,
      source: input.source,
      status: 'draft',
      proposals: input.proposals,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.db.prepare(
      'INSERT INTO pdf_import_staging (id, source_path, source_sha256, file_name, page_count, status, proposals_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      id,
      input.source.sourcePath,
      input.source.sourceSha256,
      input.source.fileName,
      input.source.pageCount,
      'draft',
      JSON.stringify(input.proposals),
      timestamp,
      timestamp,
    );

    return staging;
  }

  get(id: string): PdfImportStaging | null {
    const row = this.db.prepare('SELECT * FROM pdf_import_staging WHERE id = ?').get(id);
    return row ? mapRow(row) : null;
  }

  list(): PdfImportStaging[] {
    return (this.db.prepare('SELECT * FROM pdf_import_staging ORDER BY updated_at DESC').all() as any[]).map(mapRow);
  }

  updateProposal(input: UpdateStagedProposalInput): PdfImportStaging {
    const current = this.get(input.stagingId);
    if (!current) throw new Error('Staging import not found.');
    if (current.status !== 'draft') throw new Error('Only draft staging imports can be edited.');

    const proposals = current.proposals.map((item) =>
      item.id === input.proposal.id ? { ...input.proposal, edited: true } : item,
    );
    if (!proposals.some((item) => item.id === input.proposal.id)) {
      throw new Error('Staged proposal not found.');
    }

    const updatedAt = now();
    this.db.prepare(
      "UPDATE pdf_import_staging SET proposals_json = ?, updated_at = ? WHERE id = ? AND status = 'draft'",
    ).run(JSON.stringify(proposals), updatedAt, input.stagingId);

    return this.get(input.stagingId)!;
  }

  approve(stagingId: string): CommitPdfStagingResult {
    const current = this.get(stagingId);
    if (!current) throw new Error('Staging import not found.');
    if (current.status !== 'draft') throw new Error('Only draft staging imports can be approved.');

    const selected = current.proposals.filter((proposal) => proposal.selected);
    if (selected.length === 0) throw new Error('Select at least one proposal before approval.');

    const questionIds: string[] = [];
    const committedProposalIds: string[] = [];

    this.db.transaction(() => {
      for (const proposal of selected) {
        const result = this.questions.save({
          id: proposal.id,
          title: proposal.title,
          taxonomy: proposal.taxonomy,
          taxonomyId: proposal.taxonomy.id,
          difficulty: proposal.difficulty,
          tags: proposal.tags,
          body: proposal.body,
          solution: proposal.solution,
          createdAt: current.createdAt,
          updatedAt: now(),
        });
        questionIds.push(result.id);
        committedProposalIds.push(proposal.id);
      }

      const approvedAt = now();
      this.db.prepare(
        "UPDATE pdf_import_staging SET status = 'approved', approved_at = ?, updated_at = ? WHERE id = ? AND status = 'draft'",
      ).run(approvedAt, approvedAt, stagingId);
    })();

    return { stagingId, questionIds, committedProposalIds };
  }

  reject(stagingId: string): { stagingId: string } {
    const current = this.get(stagingId);
    if (!current) throw new Error('Staging import not found.');
    if (current.status !== 'draft') throw new Error('Only draft staging imports can be rejected.');

    this.db.prepare(
      "UPDATE pdf_import_staging SET status = 'rejected', updated_at = ? WHERE id = ? AND status = 'draft'",
    ).run(now(), stagingId);

    return { stagingId };
  }
}
