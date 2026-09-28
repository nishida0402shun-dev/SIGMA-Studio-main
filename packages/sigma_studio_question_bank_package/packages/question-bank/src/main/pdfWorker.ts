import { parentPort, workerData } from 'worker_threads';

async function processPdfImport() {
  const { jobId, filePath } = workerData;
  const totalPages = 500; // 対象PDFのページ数
  let currentPage = 0;
  let extractedCount = 0;

  // メモリ高負荷（OOM）を防ぐため、25ページ単位でチャンク非同期処理
  const chunkSize = 25;

  while (currentPage < totalPages) {
    await new Promise((res) => setTimeout(res, 200)); // 疑似解析ウェイト
    currentPage = Math.min(currentPage + chunkSize, totalPages);
    extractedCount += Math.floor(chunkSize * 1.2);

    if (parentPort) {
      parentPort.postMessage({
        jobId,
        status: currentPage >= totalPages ? 'completed' : 'processing',
        currentPage,
        totalPages,
        extractedQuestionsCount: extractedCount,
      });
    }
  }
}

processPdfImport().catch((err) => {
  if (parentPort) {
    parentPort.postMessage({
      jobId: workerData.jobId,
      status: 'failed',
      currentPage: 0,
      totalPages: 0,
      extractedQuestionsCount: 0,
      errorMessage: err.message,
    });
  }
});
