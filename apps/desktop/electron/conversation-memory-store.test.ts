import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ConversationMemoryStore } from "./conversation-memory-store";

describe("ConversationMemoryStore", () => {
  it("persists, retrieves, and searches conversation memory", async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "sigma-conversation-memory-"));
    try {
      const store = new ConversationMemoryStore(dataDir);
      await store.append({
        conversationId: "chat-1",
        role: "user",
        content: "Knowledge DBではPDFの分類を承認してから登録する。",
        provider: "chatgpt",
      });
      await store.append({
        conversationId: "chat-1",
        role: "assistant",
        content: "了解。承認前は元PDFをKnowledge DBへ登録しない設計にします。",
        provider: "claude",
      });
      await store.append({
        conversationId: "chat-2",
        role: "user",
        content: "無関係な別会話。",
      });

      const results = await store.search("PDF 分類 承認", undefined, 5);
      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results[0]?.conversationId).toBe("chat-1");

      const scoped = await store.recent("chat-1", 10);
      expect(scoped).toHaveLength(2);
      expect(scoped[0]?.role).toBe("assistant");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("deduplicates captured entries by captureKey", async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "sigma-conversation-memory-"));
    try {
      const store = new ConversationMemoryStore(dataDir);
      const first = await store.appendCaptured({
        conversationId: "web-1",
        role: "assistant",
        content: "同じ回答",
        provider: "chatgpt",
        captureKey: "chatgpt:/c/assistant:abc",
        metadata: { source: "web-ai-capture" },
      });
      const duplicate = await store.appendCaptured({
        conversationId: "web-1",
        role: "assistant",
        content: "同じ回答",
        provider: "chatgpt",
        captureKey: "chatgpt:/c/assistant:abc",
        metadata: { source: "web-ai-capture" },
      });
      expect(first).not.toBeNull();
      expect(duplicate).toBeNull();
      expect(await store.recent("web-1", 10)).toHaveLength(1);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("keeps conversation memory separate from Knowledge DB data", async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "sigma-conversation-memory-"));
    try {
      const store = new ConversationMemoryStore(dataDir);
      await store.append({
        conversationId: "chat-1",
        role: "assistant",
        content: "Memory only.",
      });
      expect((await store.search("Memory only")).length).toBe(1);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
