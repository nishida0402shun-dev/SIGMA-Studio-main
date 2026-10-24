/**
 * Studio-side import boundary for the pinned SIGMA Core submodule.
 *
 * Keep every direct path into `vendor/sigma-core` in this file. The Electron
 * esbuild bundle and the Vitest transform both resolve these files directly,
 * so the rest of Studio never needs to know the submodule layout.
 */
export {
  CoreRepository,
} from "../../../../vendor/sigma-core/src/persistence/core-repository.ts";
export {
  LocalBlobStore,
  type StoredBlob,
} from "../../../../vendor/sigma-core/src/persistence/local-blob-store.ts";
export {
  AuthService,
  type AuthContext,
} from "../../../../vendor/sigma-core/src/services/auth-service.ts";
export {
  BackupService,
} from "../../../../vendor/sigma-core/src/services/backup-service.ts";
export {
  DeviceQuarantineService,
} from "../../../../vendor/sigma-core/src/services/device-quarantine-service.ts";
export {
  CoreService,
  type IngestObjectInput,
} from "../../../../vendor/sigma-core/src/services/core-service.ts";
export {
  SigmaStudioAdapter,
  type KnowledgePage,
  type KnowledgeSource,
  type VectorSearchResult,
} from "../../../../vendor/sigma-core/src/adapters/sigma-studio-adapter.ts";
export {
  detectFormat,
  type DetectionResult,
  type Format,
} from "../../../../vendor/sigma-core/src/extraction.ts";
export type {
  BoundingBox,
  ExtractedArtifact,
  KnowledgeSemanticType,
  SourceLocation,
  SourceObject,
  Workspace,
} from "../../../../vendor/sigma-core/src/models/types.ts";
