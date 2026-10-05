import { ipcMain, BrowserWindow } from 'electron';
import Database from 'better-sqlite3';
import { Worker } from 'worker_threads';
import path from 'path';
import { QuestionRepository } from '../db/repository';
import { PdfStagingRepository } from '../db/stagingRepository';

export function registerQuestionBankIpcHandlers(db: Database.Database): void {
  const repository = new QuestionRepository(db);
  const pdfStaging = new PdfStagingRepository(db, repository);

  ipcMain.handle('questions:search', async (_, filter) => {
    try {
      return repository.search(filter);
    } catch (err) {
      console.error('[IPC Error: questions:search]', err);
      throw err;
    }
  });

  ipcMain.handle('questions:save', async (_, question) => {
    try {
      return repository.save(question);
    } catch (err) {
      console.error('[IPC Error: questions:save]', err);
      throw err;
    }
  });

  ipcMain.handle('questions:delete', async (_, questionId: string) => {
    try {
      return repository.delete(questionId);
    } catch (err) {
      console.error('[IPC Error: questions:delete]', err);
      throw err;
    }
  });

  ipcMain.handle('pdf-staging:create', async (_, input) => pdfStaging.create(input));
  ipcMain.handle('pdf-staging:get', async (_, stagingId: string) => pdfStaging.get(stagingId));
  ipcMain.handle('pdf-staging:list', async () => pdfStaging.list());
  ipcMain.handle('pdf-staging:updateProposal', async (_, input) => pdfStaging.updateProposal(input));
  ipcMain.handle('pdf-staging:approve', async (_, stagingId: string) => pdfStaging.approve(stagingId));
  ipcMain.handle('pdf-staging:reject', async (_, stagingId: string) => pdfStaging.reject(stagingId));

  ipcMain.handle('questions:startImport', async (_, filePath: string) => {
    const jobId = crypto.randomUUID();
    const workerPath = path.join(__dirname, 'pdfWorker.js');

    const worker = new Worker(workerPath, {
      workerData: { jobId, filePath },
    });

    worker.on('message', (progress) => {
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send('questions:importProgress', progress);
      });
    });

    worker.on('error', (err) => {
      console.error('[Worker Error]', err);
    });

    return { jobId };
  });
}
