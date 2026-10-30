import { describe, expect, it } from "vitest";

import { hasExactWorkspaceFileId } from "./web-ai-mcp-gateway";

const fileId = "file_14704d64-2aaa-4e04-9e77-ba25a5d21a51";
const workspaceId = "workspace_011be80a-9c9f-45fe-9c1d-11907a347958";

describe("hasExactWorkspaceFileId", () => {
  it("recognizes files in the wrapped desktop MCP execution result", () => {
    const result = {
      content: [{
        type: "text",
        text: JSON.stringify({
          ok: true,
          message: "MCPツールを実行しました。",
          data: {
            userDataPath: "C:\\Users\\test\\AppData\\Roaming\\Sigma Studio Beta",
            overview: {
              state: "ready",
              overview: {
                activeWorkspaceId: workspaceId,
                files: [{ fileId, workspaceId }],
              },
            },
          },
        }),
      }],
    };

    expect(hasExactWorkspaceFileId(result, fileId, workspaceId)).toBe(true);
  });

  it("continues to recognize the direct overview result shape", () => {
    const result = {
      content: [{
        type: "text",
        text: JSON.stringify({
          overview: {
            files: [{ fileId, workspaceId }],
          },
        }),
      }],
    };

    expect(hasExactWorkspaceFileId(result, fileId, workspaceId)).toBe(true);
  });

  it("rejects a file that belongs to a different Workspace", () => {
    const result = {
      content: [{
        type: "text",
        text: JSON.stringify({
          ok: true,
          data: {
            overview: {
              state: "ready",
              overview: {
                files: [{ fileId, workspaceId: "workspace_other" }],
              },
            },
          },
        }),
      }],
    };

    expect(hasExactWorkspaceFileId(result, fileId, workspaceId)).toBe(false);
  });

  it("fails closed for malformed or unrelated results", () => {
    expect(hasExactWorkspaceFileId({ content: [{ type: "text", text: "not JSON" }] }, fileId, workspaceId)).toBe(false);
    expect(hasExactWorkspaceFileId({ content: [] }, fileId, workspaceId)).toBe(false);
  });
});
