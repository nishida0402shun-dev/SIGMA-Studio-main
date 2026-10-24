import {
  buildSigmaCoreMcpStdioServer,
  buildSigmaStudioMcpEnv,
  SIGMA_CORE_MCP_SERVER_NAME,
  SIGMA_DOC_MCP_SERVER_NAME,
  type SigmaStudioMcpLaunchSpec,
} from "./sigma-studio-mcp-launch";

export type ClaudeMcpConfigInput = SigmaStudioMcpLaunchSpec;

export interface ClaudeMcpStdioServer {
  type: "stdio";
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface ClaudeMcpConfig {
  mcpServers: {
    "sigma-studio-local": ClaudeMcpStdioServer;
    "sigma-core-local"?: ClaudeMcpStdioServer;
  };
}

export { SIGMA_CORE_MCP_SERVER_NAME, SIGMA_DOC_MCP_SERVER_NAME };

export function buildClaudeMcpConfig(input: ClaudeMcpConfigInput): ClaudeMcpConfig {
  const core = buildSigmaCoreMcpStdioServer(input);
  return {
    mcpServers: {
      [SIGMA_DOC_MCP_SERVER_NAME]: {
        type: "stdio",
        command: input.execPath,
        args: [input.scriptPath],
        env: buildSigmaStudioMcpEnv(input),
      },
      ...(core ? { [SIGMA_CORE_MCP_SERVER_NAME]: core } : {}),
    },
  };
}
