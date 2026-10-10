import fs from "node:fs/promises";
import { atomicRename } from "./atomic-rename";
import { randomUUID } from "node:crypto";
import path from "node:path";

export interface ResearchSourceReference {
  sourceId: string;
  sourceName: string;
  pageNumber: number;
  pageId?: string;
}

export interface ResearchSession {
  id: string;
  title: string;
  query: string;
  sourceReferences: ResearchSourceReference[];
  createdAt: string;
  updatedAt: string;
}

interface ResearchLibrary {
  version: 1;
  sessions: ResearchSession[];
}

export class ResearchSessionStore {
  constructor(private readonly dataDir: string) {}

  async list(): Promise<ResearchSession[]> {
    const library = await this.read();
    return library.sessions;
  }

  async create(input: { title?: string; query: string; sourceReferences?: ResearchSourceReference[] }): Promise<ResearchSession> {
    const library = await this.read();
    const now = new Date().toISOString();
    const session: ResearchSession = {
      id: `research_${randomUUID()}`,
      title: input.title?.trim() || input.query.trim().slice(0, 80) || "Research",
      query: input.query.trim(),
      sourceReferences: dedupeReferences(input.sourceReferences ?? []),
      createdAt: now,
      updatedAt: now,
    };
    library.sessions.unshift(session);
    library.sessions = library.sessions.slice(0, 200);
    await this.write(library);
    return session;
  }

  async update(id: string, patch: { title?: string; query?: string; sourceReferences?: ResearchSourceReference[] }): Promise<ResearchSession | null> {
    const library = await this.read();
    const session = library.sessions.find((item) => item.id === id);
    if (!session) return null;
    if (patch.title !== undefined) session.title = patch.title.trim() || session.title;
    if (patch.query !== undefined) session.query = patch.query.trim();
    if (patch.sourceReferences !== undefined) session.sourceReferences = dedupeReferences(patch.sourceReferences);
    session.updatedAt = new Date().toISOString();
    await this.write(library);
    return session;
  }

  async remove(id: string): Promise<boolean> {
    const library = await this.read();
    const next = library.sessions.filter((item) => item.id !== id);
    if (next.length === library.sessions.length) return false;
    library.sessions = next;
    await this.write(library);
    return true;
  }

  private async read(): Promise<ResearchLibrary> {
    const filePath = this.libraryPath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    try {
      const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as Partial<ResearchLibrary>;
      if (parsed.version === 1 && Array.isArray(parsed.sessions)) return parsed as ResearchLibrary;
    } catch {}
    return { version: 1, sessions: [] };
  }

  private async write(library: ResearchLibrary): Promise<void> {
    const filePath = this.libraryPath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temp = filePath + ".tmp";
    await fs.writeFile(temp, JSON.stringify(library, null, 2), "utf8");
    await atomicRename(temp, filePath);
  }

  private libraryPath(): string {
    return path.join(this.dataDir, "research-sessions", "library.json");
  }
}

function dedupeReferences(references: ResearchSourceReference[]): ResearchSourceReference[] {
  const seen = new Set<string>();
  return references.filter((reference) => {
    if (!reference.sourceId || !Number.isInteger(reference.pageNumber) || reference.pageNumber < 1) return false;
    const key = `${reference.sourceId}:${reference.pageNumber}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 500);
}
