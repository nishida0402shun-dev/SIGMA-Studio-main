import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface LongTermMemory {
  id: string;
  content: string;
  conversationId: string;
  sourceEntryId: string;
  provider?: string;
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

interface MemoryFile { version: 1; entries: LongTermMemory[]; }

export class LongTermMemoryStore {
  private readonly filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, "long-term-memory", "entries.json");
  }

  async remember(input: Omit<LongTermMemory, "id" | "createdAt" | "updatedAt">): Promise<LongTermMemory | null> {
    return this.enqueue(async () => {
      const content = input.content.normalize("NFKC").trim().replace(/\s+/gu, " ").slice(0, 4000);
      if (content.length < 4) return null;
      const file = await this.read();
      const existing = file.entries.find((entry) => entry.content === content && entry.conversationId === input.conversationId);
      if (existing) {
        existing.updatedAt = new Date().toISOString();
        existing.confidence = Math.max(existing.confidence, input.confidence);
        await this.write(file);
        return existing;
      }
      const now = new Date().toISOString();
      const entry: LongTermMemory = { ...input, id: "ltm_" + randomUUID(), content, createdAt: now, updatedAt: now };
      file.entries.push(entry);
      if (file.entries.length > 10_000) file.entries.splice(0, file.entries.length - 10_000);
      await this.write(file);
      return entry;
    });
  }

  async recent(limit = 50): Promise<LongTermMemory[]> {
    const file = await this.read();
    return file.entries.slice(-Math.max(1, Math.min(limit, 200))).reverse();
  }

  async search(query: string, limit = 20): Promise<LongTermMemory[]> {
    const normalized = query.normalize("NFKC").toLocaleLowerCase().trim();
    if (!normalized) return [];
    const tokens = normalized.match(/[a-z0-9]+|[ぁ-んァ-ヶ一-龯]{2,}/giu) ?? [];
    const file = await this.read();
    return file.entries.map((entry) => {
      const text = entry.content.normalize("NFKC").toLocaleLowerCase();
      const hits = tokens.reduce((sum, token) => sum + (text.includes(token) ? 1 : 0), 0);
      return { entry, score: (text.includes(normalized) ? 1 : 0) * 0.6 + (tokens.length ? hits / tokens.length : 0) * 0.4 };
    }).filter((item) => item.score > 0).sort((a,b) => b.score - a.score).slice(0, Math.max(1, Math.min(limit, 100))).map((item) => item.entry);
  }

  private async enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.writeQueue;
    let release!: () => void;
    this.writeQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }

  private async read(): Promise<MemoryFile> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<MemoryFile>;
      if (parsed.version === 1 && Array.isArray(parsed.entries)) return { version: 1, entries: parsed.entries };
    } catch {}
    return { version: 1, entries: [] };
  }

  private async write(file: MemoryFile): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temp = this.filePath + "." + process.pid + ".tmp";
    await fs.writeFile(temp, JSON.stringify(file), "utf8");
    await fs.rename(temp, this.filePath);
  }
}
