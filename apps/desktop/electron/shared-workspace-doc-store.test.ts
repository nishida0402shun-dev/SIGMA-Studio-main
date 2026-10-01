import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { SharedWorkspaceDocStore } from "./shared-workspace-doc-store";

const tempRoots: string[] = [];

async function createStore() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sigma-shared-workspace-"));
  tempRoots.push(root);
  return new SharedWorkspaceDocStore(
    path.join(root, "personal"),
    path.join(root, "shared"),
  );
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("SharedWorkspaceDocStore", () => {
  it("keeps the default personal workspace private", async () => {
    const store = await createStore();
    await store.initializeWorkspace();

    const overview = await store.getWorkspaceOverview();
    expect(overview.state).toBe("ready");
    if (overview.state !== "ready") return;

    const personal = overview.overview.workspaces.find((workspace) => workspace.name === "マイ教材");
    const shared = overview.overview.workspaces.find((workspace) => workspace.name === "共有Workspace");
    expect(personal?.id).toBeTruthy();
    expect(shared?.id).toMatch(/^shared:/);
    expect(overview.overview.files.every((file) => !file.fileId.startsWith("shared:"))).toBe(true);
  });

  it("only puts a document into the shared store when the shared workspace is selected", async () => {
    const store = await createStore();
    await store.initializeWorkspace();

    const overview = await store.getWorkspaceOverview();
    if (overview.state !== "ready") throw new Error("workspace overview unavailable");

    const personal = overview.overview.workspaces.find((workspace) => workspace.name === "マイ教材");
    const shared = overview.overview.workspaces.find((workspace) => workspace.name === "共有Workspace");
    if (!personal || !shared) throw new Error("expected personal and shared workspaces");

    const personalFile = await store.createDocument({ title: "個人教材", workspaceId: personal.id });
    const sharedFile = await store.createDocument({ title: "共有教材", workspaceId: shared.id });

    expect(personalFile.file.fileId).not.toMatch(/^shared:/);
    expect(sharedFile.file.fileId).toMatch(/^shared:/);

    const personalOverview = await store.getWorkspaceOverview(personal.id);
    expect(personalOverview.state).toBe("ready");
    if (personalOverview.state !== "ready") return;
    expect(personalOverview.overview.files.some((file) => file.title === "個人教材")).toBe(true);
    expect(personalOverview.overview.files.some((file) => file.title === "共有教材")).toBe(false);

    const sharedOverview = await store.getWorkspaceOverview(shared.id);
    expect(sharedOverview.state).toBe("ready");
    if (sharedOverview.state !== "ready") return;
    expect(sharedOverview.overview.files.map((file) => file.title)).toEqual(["共有教材"]);

    const allFiles = await store.listFiles();
    expect(allFiles.map((file) => file.title).sort()).toEqual(["サンプル教材", "個人教材", "共有教材"]);
  });
});
