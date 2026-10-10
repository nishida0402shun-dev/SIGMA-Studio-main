import { describe, expect, it } from "vitest";
import { isAllowedWebAiOrigin, isTrustedWebAiFrame } from "./web-ai-ipc-security";

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
  const event = (senderFrame: unknown) => ({
    sender,
    senderFrame,
  }) as never;

  it("allows the trusted top frame at an approved HTTPS origin", () => {
    expect(isTrustedWebAiFrame(event(topFrame))).toBe(true);
  });

  it("rejects a subframe even when its URL uses an approved origin", () => {
    expect(isTrustedWebAiFrame(event({ url: "https://chatgpt.com/embedded" }))).toBe(false);
  });

  it("rejects an unapproved subdomain in the top frame", () => {
    const frame = { url: "https://sub.chatgpt.com/" };
    expect(isTrustedWebAiFrame(event(frame))).toBe(false);
  });
});
