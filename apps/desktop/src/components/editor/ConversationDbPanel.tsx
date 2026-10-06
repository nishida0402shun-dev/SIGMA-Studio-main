"use client";

import { useCallback, useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { getDesktopBridge } from "@/lib/desktop-bridge";

type Entry = {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  provider?: string;
  createdAt: string;
};

export interface ConversationDbPanelProps {
  open: boolean;
  onClose: () => void;
}

export function ConversationDbPanel({ open, onClose }: ConversationDbPanelProps) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [longTermMemories, setLongTermMemories] = useState<Array<{ id: string; content: string; confidence: number }>>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (search = "") => {
    const desktop = getDesktopBridge();
    const api = desktop?.conversationMemory;
    if (!api) return;
    setLoading(true);
    try {
      const value = search.trim()
        ? await api.search(search.trim(), undefined, 50)
        : await api.recent(undefined, 50);
      setEntries((Array.isArray(value) ? value : []) as Entry[]);
      const memories = await desktop?.longTermMemory?.recent(20).catch(() => []) ?? [];
      setLongTermMemories((Array.isArray(memories) ? memories : []) as Array<{ id: string; content: string; confidence: number }>);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Conversation DB"
      style={{
        position: "fixed", inset: 0, zIndex: 2147483000, display: "flex",
        justifyContent: "flex-end", background: "rgba(0,0,0,.18)",
      }}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <aside style={{
        width: "min(620px, 92vw)", height: "100%", background: "var(--color-bg-primary, #fff)",
        borderLeft: "1px solid var(--color-border, #ddd)", boxShadow: "-12px 0 40px rgba(0,0,0,.18)",
        display: "flex", flexDirection: "column",
      }}>
        <header style={{ display: "flex", alignItems: "center", gap: 8, padding: 14, borderBottom: "1px solid var(--color-border, #ddd)" }}>
          <strong style={{ flex: 1 }}>Conversation DB</strong>
          <button type="button" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </header>
        <div style={{ display: "flex", gap: 8, padding: 12, borderBottom: "1px solid var(--color-border, #ddd)" }}>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") void load(query); }}
            placeholder="Search conversation memory"
            style={{ flex: 1, minWidth: 0 }}
          />
          <button type="button" onClick={() => void load(query)} aria-label="Search"><Search size={15} /></button>
          {query && <button type="button" onClick={() => { setQuery(""); void load(""); }}>Clear</button>}
        </div>
        <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--color-border, #ddd)" }}>
          <strong style={{ fontSize: 12 }}>Long-term Memory</strong>
          <div style={{ marginTop: 6, display: "grid", gap: 5 }}>
            {longTermMemories.length === 0 && <span style={{ fontSize: 11, opacity: .6 }}>No durable memories extracted yet.</span>}
            {longTermMemories.map((memory) => (
              <div key={memory.id} style={{ fontSize: 11, lineHeight: 1.4 }}>
                {memory.content} <span style={{ opacity: .55 }}>({Math.round(memory.confidence * 100)}%)</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: 12 }}>
          {loading && <div style={{ padding: 12, opacity: .65 }}>Loading…</div>}
          {!loading && entries.length === 0 && <div style={{ padding: 12, opacity: .65 }}>No conversation entries yet.</div>}
          {!loading && entries.map((entry) => (
            <article key={entry.id} style={{
              padding: "10px 12px", marginBottom: 8, border: "1px solid var(--color-border, #ddd)",
              borderRadius: 10, background: entry.role === "user" ? "var(--color-bg-secondary, #f7f7f7)" : "transparent",
            }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 5, fontSize: 11, opacity: .65 }}>
                <span>{entry.role}</span>
                {entry.provider && <span>{entry.provider}</span>}
                <time style={{ marginLeft: "auto" }}>{new Date(entry.createdAt).toLocaleString()}</time>
              </div>
              <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.5 }}>{entry.content}</div>
            </article>
          ))}
        </div>
      </aside>
    </div>
  );
}
