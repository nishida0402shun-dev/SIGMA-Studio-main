"use client";

import { ChevronDown, ExternalLink, Globe, Monitor, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ElementType } from "react";

import { AntigravityMark, ClaudeMark, OpenAiMark } from "@/components/branding/provider-logos";
import { getDesktopBridge } from "@/lib/desktop-bridge";

export type AiWebProvider = "chatgpt" | "claude" | "gemini";

const PROVIDERS: Array<{ id: AiWebProvider; label: string; url: string }> = [
  { id: "chatgpt", label: "ChatGPT", url: "https://chatgpt.com/" },
  { id: "claude", label: "Claude", url: "https://claude.ai/" },
  { id: "gemini", label: "Gemini", url: "https://gemini.google.com/" },
];

function providerMark(provider: AiWebProvider) {
  if (provider === "claude") return <ClaudeMark size={15} />;
  if (provider === "gemini") return <AntigravityMark size={15} />;
  return <OpenAiMark size={15} />;
}

export interface AiWebProviderPanelProps {
  provider: AiWebProvider;
  onProviderChange: (provider: AiWebProvider) => void;
  onClose: () => void;
}

export function AiWebProviderPanel({
  provider,
  onProviderChange,
  onClose,
}: AiWebProviderPanelProps) {
  const webviewRef = useRef<HTMLElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [preloadUrl, setPreloadUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const promise = getDesktopBridge()?.webAi?.getPreloadUrl();
    void promise?.then((url) => {
      if (!cancelled) setPreloadUrl(url);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = useMemo(
    () => PROVIDERS.find((item) => item.id === provider) ?? PROVIDERS[0],
    [provider],
  );

  useEffect(() => {
    const webview = webviewRef.current as (HTMLElement & {
      addEventListener: (type: string, listener: EventListener) => void;
      removeEventListener: (type: string, listener: EventListener) => void;
      reload?: () => void;
      getURL?: () => string;
    }) | null;
    if (!webview) return;

    const allowedHosts = new Set(["chatgpt.com", "www.chatgpt.com", "claude.ai", "www.claude.ai", "gemini.google.com"]);
    const onNavigate = (event: Event) => {
      const url = (event as Event & { url?: string }).url;
      if (!url) return;
      try {
        const host = new URL(url).hostname;
        if (![...allowedHosts].some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
          event.preventDefault();
        }
      } catch {
        event.preventDefault();
      }
    };
    webview.addEventListener("will-navigate", onNavigate);
    return () => webview.removeEventListener("will-navigate", onNavigate);
  }, [provider]);

  const reload = () => {
    const webview = webviewRef.current as (HTMLElement & { reload?: () => void }) | null;
    webview?.reload?.();
  };

  return (
    <section className="ai-web-provider-panel" aria-label="Web AI">
      <header className="ai-web-provider-header">
        <div className="ai-web-provider-selector">
          <button
            type="button"
            className="ai-web-provider-select"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {providerMark(provider)}
            <span>{selected.label}</span>
            <ChevronDown size={13} />
          </button>
          {menuOpen && (
            <div className="ai-web-provider-menu" role="menu">
              {PROVIDERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={provider === item.id}
                  className="ai-web-provider-menu-item"
                  onClick={() => {
                    onProviderChange(item.id);
                    setMenuOpen(false);
                  }}
                >
                  {providerMark(item.id)}
                  <span>{item.label}</span>
                  {provider === item.id && <span aria-hidden="true">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="ai-web-provider-actions">
          <button type="button" className="ai-web-provider-icon-button" onClick={reload} title="Reload" aria-label="Reload">
            <RefreshCw size={13} />
          </button>
          <button
            type="button"
            className="ai-web-provider-icon-button"
            onClick={() => window.open(selected.url, "_blank", "noopener,noreferrer")}
            title="Open in browser"
            aria-label="Open in browser"
          >
            <ExternalLink size={13} />
          </button>
          <button type="button" className="ai-web-provider-close" onClick={onClose}>
            <Monitor size={13} />
            <span>CLI</span>
          </button>
        </div>
      </header>
      <div className="ai-web-provider-note">
        <Globe size={12} />
        <span>Web版AI。SIGMA StudioのCLIセッションとは独立した会話です。</span>
      </div>
      <div className="ai-web-provider-surface">
        {preloadUrl ? (() => {
          const Webview = "webview" as unknown as ElementType;
          return (
            <Webview
              ref={(node: HTMLElement | null) => {
                webviewRef.current = node;
              }}
              src={selected.url}
              preload={preloadUrl}
              partition="persist:sigma-studio-ai-web"
              allowpopups=""
              style={{ display: "flex", width: "100%", height: "100%", border: "0" }}
            />
          );
        })() : (
          <div className="ai-web-provider-loading">Web AIを準備しています…</div>
        )}
      </div>
    </section>
  );
}
