import type { IpcMainInvokeEvent } from "electron";

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

/** Web AI privileges belong only to the top frame of an explicitly allowed HTTPS origin. */
export function isTrustedWebAiFrame(event: Pick<IpcMainInvokeEvent, "sender" | "senderFrame">): boolean {
  const frame = event.senderFrame;
  return Boolean(frame && frame === event.sender.mainFrame && isAllowedWebAiOrigin(frame.url));
}
