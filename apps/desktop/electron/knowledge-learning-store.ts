import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type LearningFeedbackLabel = "positive" | "negative" | "correction";

export interface KnowledgeLearningFeedback {
  id: string;
  query: string;
  sourceId?: string;
  pageNumber?: number;
  label: LearningFeedbackLabel;
  correction?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

interface LearningFile { version: 1; feedback: KnowledgeLearningFeedback[]; }

const MAX_FEEDBACK = 20_000;

export class KnowledgeLearningStore {
  private readonly filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, "knowledge-db", "learning.json");
  }

  async record(input: Omit<KnowledgeLearningFeedback, "id" | "createdAt">): Promise<KnowledgeLearningFeedback> {
    return this.enqueue(async () => {
      const query = input.query.trim();
      if (!query) throw new Error("learning query is empty");
      if (query.length > 10_000) throw new Error("learning query is too long");
      const file = await this.read();
      const entry: KnowledgeLearningFeedback = {
        ...input,
        id: "learn_" + randomUUID(),
        query,
        createdAt: new Date().toISOString(),
      };
      file.feedback.push(entry);
      if (file.feedback.length > MAX_FEEDBACK) file.feedback.splice(0, file.feedback.length - MAX_FEEDBACK);
      await this.write(file);
      return entry;
    });
  }

  async list(limit = 100): Promise<KnowledgeLearningFeedback[]> {
    const file = await this.read();
    return file.feedback.slice(-Math.max(1, Math.min(limit, 500))).reverse();
  }

  async getBoost(query: string, sourceId?: string, pageNumber?: number): Promise<number> {
    const normalized = query.normalize("NFKC").toLocaleLowerCase().trim();
    if (!normalized) return 0;
    const file = await this.read();
    let boost = 0;
    for (const item of file.feedback) {
      if (sourceId && item.sourceId !== sourceId) continue;
      if (pageNumber !== undefined && item.pageNumber !== pageNumber) continue;
      const text = item.query.normalize("NFKC").toLocaleLowerCase();
      const overlap = normalized === text || normalized.includes(text) || text.includes(normalized);
      if (!overlap) continue;
      if (item.label === "positive") boost += 0.06;
      if (item.label === "negative") boost -= 0.08;
      if (item.label === "correction") boost -= 0.02;
    }
    return Math.max(-0.20, Math.min(0.20, boost));
  }

  private async enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.writeQueue;
    let release!: () => void;
    this.writeQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }

  private async read(): Promise<LearningFile> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<LearningFile>;
      if (parsed.version === 1 && Array.isArray(parsed.feedback)) return { version: 1, feedback: parsed.feedback };
    } catch {}
    return { version: 1, feedback: [] };
  }

  private async write(file: LearningFile): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temp = this.filePath + "." + process.pid + ".tmp";
    await fs.writeFile(temp, JSON.stringify(file), "utf8");
    await fs.rename(temp, this.filePath);
  }
}
