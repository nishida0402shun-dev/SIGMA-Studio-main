import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type ConversationMemoryRole = "user" | "assistant" | "system" | "tool";

export interface ConversationMemoryEntry {
  id: string;
  conversationId: string;
  role: ConversationMemoryRole;
  content: string;
  provider?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

interface ConversationMemoryFile {
  version: 1;
  entries: ConversationMemoryEntry[];
}

const MAX_ENTRIES = 20_000;
const MAX_CONTENT_LENGTH = 50_000;

export class ConversationMemoryStore {
  private readonly filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, "conversation-memory", "entries.json");
  }

  async append(input: Omit<ConversationMemoryEntry, "id" | "createdAt">): Promise<ConversationMemoryEntry> {
    return this.enqueueWrite(async () => {
      const content = input.content.trim();
      if (!content) throw new Error("conversation memory content is empty");
      if (content.length > MAX_CONTENT_LENGTH) throw new Error("conversation memory content is too long");

      const file = await this.read();
      const entry: ConversationMemoryEntry = {
        ...input,
        id: "mem_" + randomUUID(),
        content,
        createdAt: new Date().toISOString(),
      };
      file.entries.push(entry);
      if (file.entries.length > MAX_ENTRIES) {
        file.entries.splice(0, file.entries.length - MAX_ENTRIES);
      }
      await this.write(file);
      return entry;
    });
  }

  async appendCaptured(input: Omit<ConversationMemoryEntry, "id" | "createdAt"> & { captureKey: string }): Promise<ConversationMemoryEntry | null> {
    return this.enqueueWrite(async () => {
      const key = input.captureKey.trim();
      if (!key) throw new Error("conversation capture key is empty");
      const file = await this.read();
      if (file.entries.some((entry) => entry.metadata?.captureKey === key)) return null;
      const { captureKey, ...entryInput } = input;
      const content = entryInput.content.trim();
      if (!content) throw new Error("conversation memory content is empty");
      if (content.length > MAX_CONTENT_LENGTH) throw new Error("conversation memory content is too long");
      const entry: ConversationMemoryEntry = {
        ...entryInput,
        id: "mem_" + randomUUID(),
        content,
        createdAt: new Date().toISOString(),
        metadata: { ...entryInput.metadata, captureKey },
      };
      file.entries.push(entry);
      if (file.entries.length > MAX_ENTRIES) file.entries.splice(0, file.entries.length - MAX_ENTRIES);
      await this.write(file);
      return entry;
    });
  }

  async recent(conversationId?: string, limit = 20): Promise<ConversationMemoryEntry[]> {
    const file = await this.read();
    const safeLimit = Math.max(1, Math.min(limit, 100));
    return file.entries
      .filter((entry) => !conversationId || entry.conversationId === conversationId)
      .slice(-safeLimit)
      .reverse();
  }

  async search(query: string, conversationId?: string, limit = 8): Promise<Array<ConversationMemoryEntry & { score: number }>> {
    const normalized = query.normalize("NFKC").toLocaleLowerCase().trim();
    if (!normalized) return [];
    const tokens = tokenize(normalized);
    const file = await this.read();
    const candidates = file.entries.filter((entry) => !conversationId || entry.conversationId === conversationId);

    return candidates
      .map((entry) => {
        const text = entry.content.normalize("NFKC").toLocaleLowerCase();
        const tokenHits = tokens.reduce((sum, token) => sum + (text.includes(token) ? 1 : 0), 0);
        const phrase = text.includes(normalized) ? 1 : 0;
        const ageDays = Math.max(0, (Date.now() - Date.parse(entry.createdAt)) / (1000 * 60 * 60 * 24));
        const recency = Math.max(0, 1 - ageDays / 30);
        const score = phrase * 0.45 + (tokens.length ? tokenHits / tokens.length : 0) * 0.45 + recency * 0.10;
        return { ...entry, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(limit, 50)));
  }

  private async enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.writeQueue;
    let release!: () => void;
    this.writeQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async read(): Promise<ConversationMemoryFile> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<ConversationMemoryFile>;
      if (parsed.version === 1 && Array.isArray(parsed.entries)) {
        return { version: 1, entries: parsed.entries };
      }
    } catch {
      // First use or an unreadable store starts empty.
    }
    return { version: 1, entries: [] };
  }

  private async write(file: ConversationMemoryFile): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temp = this.filePath + "." + process.pid + ".tmp";
    await fs.writeFile(temp, JSON.stringify(file), "utf8");
    await fs.rename(temp, this.filePath);
  }
}

function tokenize(value: string): string[] {
  const tokens = value.match(/[a-z0-9]+|[ぁ-んァ-ヶ一-龯]{2,}/giu) ?? [];
  return [...new Set(tokens)].slice(0, 64);
}
