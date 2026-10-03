"use client";

import { ChevronDown, ExternalLink, Globe, Monitor, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ElementType } from "react";

import { ClaudeMark, GeminiMark, OpenAiMark } from "@/components/branding/provider-logos";
import { getDesktopBridge } from "@/lib/desktop-bridge";
import { useT } from "@/lib/i18n/react";

export type AiWebProvider = "chatgpt" | "claude" | "gemini";

const PROVIDERS: Array<{ id: AiWebProvider; label: string; url: string }> = [
  { id: "chatgpt", label: "ChatGPT", url: "https://chatgpt.com/" },
  { id: "claude", label: "Claude", url: "https://claude.ai/" },
  { id: "gemini", label: "Gemini", url: "https://gemini.google.com/" },
];

function providerMark(provider: AiWebProvider) {
  if (provider === "claude") return <ClaudeMark size={15} />;
  if (provider === "gemini") return <GeminiMark size={15} />;
  return <OpenAiMark size={15} />;
}

export interface AiWebProviderPanelProps {
  provider: AiWebProvider;
  onProviderChange: (provider: AiWebProvider) => void;
  onClose?: () => void;
  workspaceId?: string | null;
  embedded?: boolean;
}

export function AiWebProviderPanel({
  provider,
  onProviderChange,
  onClose,
  workspaceId = null,
  embedded = false,
}: AiWebProviderPanelProps) {
  const t = useT("common");
  const webviewRef = useRef<HTMLElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [preloadUrl, setPreloadUrl] = useState<string | null>(null);
  const [webMcpAvailable, setWebMcpAvailable] = useState<boolean | null>(null);
  const [webviewReady, setWebviewReady] = useState(false);
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

    const onDomReady = () => {
      setWebviewReady(true);
    };
    webview.addEventListener("dom-ready", onDomReady);

    const onIpcMessage = (event: Event) => {
      const payload = (event as Event & { channel?: string; args?: unknown[] }).args?.[0];
      if ((event as Event & { channel?: string }).channel !== "sigma-web-ai-status" || !payload || typeof payload !== "object") return;
      const status = payload as { webMcp?: unknown };
      if (typeof status.webMcp === "boolean") setWebMcpAvailable(status.webMcp);
    };
    webview.addEventListener("ipc-message", onIpcMessage);

    const allowedHosts = new Set(["chatgpt.com", "www.chatgpt.com", "claude.ai", "www.claude.ai", "gemini.google.com"]);
    const onNavigate = (event: Event) => {
      const url = (event as Event & { url?: string }).url;
      if (!url) return;
      try {
        const parsed = new URL(url);
        if (parsed.protocol === "sigma:" && parsed.hostname === "knowledge-db") {
          const parts = parsed.pathname.split("/").filter(Boolean).map(decodeURIComponent);
          const sourceId = parts[0] ?? "";
          const pageIndex = parts.findIndex((part) => part === "p");
          const pageNumber = pageIndex >= 0 ? Number(parts[pageIndex + 1]) : 0;
          if (sourceId && Number.isInteger(pageNumber) && pageNumber > 0) {
            event.preventDefault();
            void getDesktopBridge()?.knowledgeDb?.openPage({ sourceId, pageNumber });
          } else {
            event.preventDefault();
          }
          return;
        }
        if (![...allowedHosts].some((allowed) => parsed.hostname === allowed || parsed.hostname.endsWith(`.${allowed}`))) {
          event.preventDefault();
        }
      } catch {
        event.preventDefault();
      }
    };
    webview.addEventListener("will-navigate", onNavigate);
    return () => {
      webview.removeEventListener("dom-ready", onDomReady);
      webview.removeEventListener("will-navigate", onNavigate);
      webview.removeEventListener("ipc-message", onIpcMessage);
    };
  }, [provider, preloadUrl]);

  useEffect(() => {
    if (!webviewReady) return;
    const webview = webviewRef.current as (HTMLElement & {
      send?: (channel: string, ...args: unknown[]) => Promise<void>;
      isConnected?: boolean;
    }) | null;
    if (!webview?.send || webview.isConnected === false) return;
    void webview.send("sigma-web-ai-scope", workspaceId ?? null).catch(() => undefined);
  }, [workspaceId, webviewReady]);

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
          {!embedded && onClose && (
            <button type="button" className="ai-web-provider-close" onClick={onClose}>
              <Monitor size={13} />
              <span>CLI</span>
            </button>
          )}
        </div>
      </header>
      <div className="ai-web-provider-note">
        <Globe size={12} />
        <span>{t("webAi.note")}</span>
        <span aria-label="SIGMA connection status">
          {workspaceId ? t("webAi.workspaceSelected") : t("webAi.workspaceUnselected")} · Bridge {preloadUrl ? t("webAi.bridgeConnected") : t("webAi.bridgePreparing")} · WebMCP {webMcpAvailable === true ? t("webAi.webMcpConnected") : webMcpAvailable === false ? t("webAi.webMcpUnavailable") : t("webAi.webMcpChecking")}
        </span>
      </div>
      <div className="ai-web-provider-surface">
        {preloadUrl ? (() => {
          const Webview = "webview" as unknown as ElementType;
          return (
            <Webview
              ref={(node: HTMLElement | null) => {
                webviewRef.current = node;
              }}
              key={`${provider}:${preloadUrl}`}
              src={selected.url}
              preload={preloadUrl}
              partition="persist:sigma-studio-ai-web"
              allowpopups=""
              style={{ display: "flex", width: "100%", height: "100%", border: "0" }}
            />
          );
        })() : (
          <div className="ai-web-provider-loading">{t("webAi.preparing")}</div>
        )}
      </div>
    </section>
  );
}
