import { describe, expect, it } from "vitest";
import { isAllowedWebAiOrigin } from "./web-ai-ipc-security";

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
