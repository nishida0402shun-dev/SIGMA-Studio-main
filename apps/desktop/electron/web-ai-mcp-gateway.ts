import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";

const READ_ONLY_TOOLS = new Set([
  "get_local_app_status","list_edit_proposals","get_edit_proposal","list_all_pending_proposals","list_local_documents",
  "read_local_document","get_edit_context","get_document_outline","get_block","get_blocks","search_document","search_library",
  "validate_local_document","list_materials","get_material","render_block_context","render_page","get_selected_block",
  "get_insertion_candidates","get_neighbor_blocks","get_active_reference","get_attached_media","get_mentioned_sigma_docs",
  "list_generated_images","get_image_reference","knowledge_db_list_sources","knowledge_db_search","knowledge_db_get_page","knowledge_db_get_region",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface WebAiMcpGatewayOptions { mcpServerPath: string; userDataPath: string; }
export interface WebAiMcpGateway {
  start(): Promise<void>;
  stop(): Promise<void>;
  listTools(workspaceId: string | null): Promise<Tool[]>;
  callTool(name: string, args: Record<string, unknown>, workspaceId: string): Promise<CallToolResult>;
}

export function createWebAiMcpGateway(options: WebAiMcpGatewayOptions): WebAiMcpGateway {
  let client: Client | null = null;
  let transport: StdioClientTransport | null = null;
  let startPromise: Promise<void> | null = null;

  const ensureStarted = async (): Promise<Client> => {
    if (client) return client;
    if (!startPromise) {
      startPromise = (async () => {
        const nextClient = new Client({ name: "sigma-studio-web-ai-gateway", version: "1.0.0" }, { capabilities: {} });
        const nextTransport = new StdioClientTransport({
          command: process.execPath,
          args: [options.mcpServerPath],
          env: { ...process.env, SIGMA_STUDIO_USER_DATA_DIR: options.userDataPath, MCP_TOOL_PROFILE: "external" },
          stderr: "pipe",
        });
        await nextClient.connect(nextTransport);
        client = nextClient;
        transport = nextTransport;
      })().catch((error) => { startPromise = null; throw error; });
    }
    await startPromise;
    if (!client) throw new Error("SIGMA MCP gateway failed to start");
    return client;
  };

  return {
    async start() { await ensureStarted(); },
    async stop() {
      const currentClient = client;
      const currentTransport = transport;
      client = null; transport = null; startPromise = null;
      if (currentClient) await currentClient.close().catch(() => undefined);
      if (currentTransport) await currentTransport.close().catch(() => undefined);
    },
    async listTools(workspaceId) {
      const currentClient = await ensureStarted();
      const result = await currentClient.listTools();
      return result.tools.filter((tool) => READ_ONLY_TOOLS.has(tool.name)).map((tool) =>
        tool.name === "list_local_documents" && isRecord(tool.inputSchema)
          ? { ...tool, description: `${tool.description ?? ""} SIGMAの現在選択Workspace: ${workspaceId ?? "未選択"}。` }
          : tool,
      );
    },
    async callTool(name, args, workspaceId) {
      if (!workspaceId.trim()) throw new Error("Workspaceを選択してからSIGMA Toolを実行してください。");
      if (!READ_ONLY_TOOLS.has(name)) throw new Error(`Web AIから利用できないToolです: ${name}`);
      const currentClient = await ensureStarted();
      const input = { ...args };
      if (name === "list_local_documents" && input.workspaceId === undefined) input.workspaceId = workspaceId;
      if (typeof input.fileId === "string") {
        const overview = await currentClient.callTool({ name: "list_local_documents", arguments: { workspaceId } });
        if (!JSON.stringify(overview).includes(input.fileId)) throw new Error("指定されたfileIdは現在のWorkspaceに属していません。");
      }
      return currentClient.callTool({ name, arguments: input });
    },
  };
}
