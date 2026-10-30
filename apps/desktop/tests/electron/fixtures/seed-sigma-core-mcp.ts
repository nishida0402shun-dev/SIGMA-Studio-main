import { mkdirSync } from "node:fs";
import path from "node:path";

import {
  AuthService,
  BackupService,
  CoreRepository,
  CoreService,
  DeviceQuarantineService,
  LocalBlobStore,
} from "../../../electron/source-material/core-bridge";

export async function seedRegisteredSource(coreDataPath: string): Promise<void> {
  mkdirSync(coreDataPath, { recursive: true });
  const repository = new CoreRepository(path.join(coreDataPath, "core.sqlite"));
  const core = new CoreService(
    repository,
    new LocalBlobStore(path.join(coreDataPath, "blobs")),
    new AuthService(repository),
    new BackupService(repository),
    new DeviceQuarantineService(repository),
  );
  const studioAuth = { subjectId: "studio-local" };
  const workspaceId = "studio:workspace-a";

  try {
    core.createWorkspace(studioAuth, workspaceId, "理科資料");
    await core.registerObject(studioAuth, {
      workspaceId,
      name: "lesson.txt",
      bytes: Buffer.from("光合成には光と二酸化炭素が必要です。", "utf8"),
      mimeType: "text/plain",
    });
    repository.grantPolicy({
      grantId: "grant_sigma_core_mcp_smoke_read",
      subjectId: "studio-ai",
      scopeId: workspaceId,
      permission: "read",
      validFrom: new Date().toISOString(),
    });
  } finally {
    repository.close();
  }
}
