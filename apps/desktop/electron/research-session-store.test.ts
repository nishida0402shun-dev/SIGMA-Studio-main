import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ResearchSessionStore } from "./research-session-store";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("ResearchSessionStore", () => {
  it("persists a research question and deduplicated page references", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sigma-research-session-"));
    dirs.push(dir);
    const store = new ResearchSessionStore(dir);
    const created = await store.create({
      title: "材料比較",
      query: "材料Aと材料Bの違い",
      sourceReferences: [
        { sourceId: "a", sourceName: "A.pdf", pageNumber: 3 },
        { sourceId: "a", sourceName: "A.pdf", pageNumber: 3 },
        { sourceId: "b", sourceName: "B.pdf", pageNumber: 8 },
      ],
    });
    expect(created.title).toBe("材料比較");
    expect(created.sourceReferences).toHaveLength(2);
    await expect(store.list()).resolves.toHaveLength(1);

    const updated = await store.update(created.id, { title: "更新した比較" });
    expect(updated?.title).toBe("更新した比較");
    expect(await store.remove(created.id)).toBe(true);
    await expect(store.list()).resolves.toHaveLength(0);
  });
});
