import { ipcMain, BrowserWindow } from 'electron';
import Database from 'better-sqlite3';
import { Worker } from 'worker_threads';
import path from 'path';
import { QuestionRepository } from '../db/repository';

export function registerQuestionBankIpcHandlers(db: Database.Database): void {
  const repository = new QuestionRepository(db);

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
