import type { IpcMainInvokeEvent, WebContents } from "electron";

export const WEB_AI_ALLOWED_ORIGINS = new Set([
  "https://chatgpt.com",
  "https://chat.openai.com",
  "https://claude.ai",
  "https://gemini.google.com",
  "https://aistudio.google.com",
  "https://www.aistudio.google.com",
]);

export function isAllowedWebAiOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && WEB_AI_ALLOWED_ORIGINS.has(url.origin);
  } catch {
    return false;
  }
}

const authorizedWebAiContents = new WeakSet<WebContents>();

/** Only webContents attached through the main window's validated Web AI webview path may use this bridge. */
export function authorizeWebAiContents(sender: WebContents): () => void {
  authorizedWebAiContents.add(sender);
  return () => { authorizedWebAiContents.delete(sender); };
}

/** Web AI privileges belong only to an authorized webview's top frame at an approved HTTPS origin. */
export function isTrustedWebAiFrame(event: Pick<IpcMainInvokeEvent, "sender" | "senderFrame">): boolean {
  const frame = event.senderFrame;
  return Boolean(authorizedWebAiContents.has(event.sender)
    && frame && frame === event.sender.mainFrame && isAllowedWebAiOrigin(frame.url));
}
