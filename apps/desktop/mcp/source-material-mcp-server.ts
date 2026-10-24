import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import {
  AuthService,
  BackupService,
  CoreRepository,
  CoreService,
  DeviceQuarantineService,
  LocalBlobStore,
  type AuthContext,
} from "../electron/source-material/core-bridge";
import { createSourceMaterialMcpServer } from "./source-material-mcp-server-core";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function main(): Promise<void> {
  const repository = new CoreRepository(requiredEnv("SIGMA_CORE_DB_PATH"));
  const blobStore = new LocalBlobStore(requiredEnv("SIGMA_CORE_BLOB_DIR"));
  const authService = new AuthService(repository);
  const core = new CoreService(
    repository,
    blobStore,
    authService,
    new BackupService(repository),
    new DeviceQuarantineService(repository),
  );
  const auth: AuthContext = {
    subjectId: process.env.SIGMA_CORE_SUBJECT_ID?.trim() || "studio-ai",
  };

  const server = createSourceMaterialMcpServer(core, auth);
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
