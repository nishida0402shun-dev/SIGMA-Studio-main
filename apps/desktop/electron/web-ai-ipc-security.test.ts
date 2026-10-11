import { describe, expect, it } from "vitest";
import { authorizeWebAiContents, isAllowedWebAiOrigin, isTrustedWebAiFrame } from "./web-ai-ipc-security";

describe("isAllowedWebAiOrigin", () => {
  it.each([
    "https://chatgpt.com",
    "https://chat.openai.com",
    "https://claude.ai",
    "https://gemini.google.com",
    "https://aistudio.google.com",
    "https://www.aistudio.google.com",
  ])("allows the configured HTTPS origin %s", (origin) => {
    expect(isAllowedWebAiOrigin(origin)).toBe(true);
  });

  it.each([
    "http://chatgpt.com",
    "https://sub.chatgpt.com",
    "https://chatgpt.com.attacker.example",
    "https://claude.ai.evil.example",
    "https://user:pass@chatgpt.com",
    "https://chatgpt.com:444",
    "file:///tmp/page.html",
    "not a URL",
  ])("rejects an unapproved origin or URL %s", (origin) => {
    expect(isAllowedWebAiOrigin(origin)).toBe(false);
  });
});

describe("isTrustedWebAiFrame", () => {
  const topFrame = { url: "https://chatgpt.com/c/123" };
  const sender = { mainFrame: topFrame };
  const event = (senderFrame: unknown, source = sender) => ({
    sender: source,
    senderFrame,
  }) as never;

  it("allows the trusted top frame at an approved HTTPS origin only after webview authorization", () => {
    expect(isTrustedWebAiFrame(event(topFrame))).toBe(false);
    const revoke = authorizeWebAiContents(sender as never);
    expect(isTrustedWebAiFrame(event(topFrame))).toBe(true);
    revoke();
    expect(isTrustedWebAiFrame(event(topFrame))).toBe(false);
  });

  it("rejects a subframe even when its URL uses an approved origin", () => {
    const revoke = authorizeWebAiContents(sender as never);
    expect(isTrustedWebAiFrame(event({ url: "https://chatgpt.com/embedded" }))).toBe(false);
    revoke();
  });

  it("rejects an unapproved subdomain in the top frame", () => {
    const frame = { url: "https://sub.chatgpt.com/" };
    const revoke = authorizeWebAiContents(sender as never);
    expect(isTrustedWebAiFrame(event(frame))).toBe(false);
    revoke();
  });

  it("rejects a different webContents even if its frame uses an approved origin", () => {
    const revoke = authorizeWebAiContents(sender as never);
    const otherFrame = { url: "https://chatgpt.com/c/456" };
    const otherSender = { mainFrame: otherFrame };
    expect(isTrustedWebAiFrame(event(otherFrame, otherSender))).toBe(false);
    revoke();
  });
});
