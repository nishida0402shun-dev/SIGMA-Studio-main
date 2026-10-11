/**
 * Stable, runtime-neutral contracts for SIGMA Core.
 * Interfaces deliberately avoid Electron, SQLite, a specific AI provider,
 * and a specific vector engine. Implementations belong in adapters.
 */
export type SigmaId = string;
export type IsoDateTime = string;
export type SigmaErrorCode =
  | "INVALID_ARGUMENT" | "NOT_FOUND" | "CONFLICT" | "PERMISSION_DENIED"
  | "PROVIDER_UNAVAILABLE" | "TIMEOUT" | "CANCELLED" | "STORAGE_FAILURE" | "INTERNAL";
export interface SigmaError {
  code: SigmaErrorCode;
  message: string;
  retryable: boolean;
  details?: Readonly<Record<string, unknown>>;
}
export type SigmaResult<T> = { ok: true; value: T } | { ok: false; error: SigmaError };
export type SearchDomain = "document" | "conversation" | "question" | "memory";
export interface SourceReference {
  sourceId: SigmaId;
  displayName: string;
  pageNumber?: number;
  chunkIndex?: number;
  /** Optional offsets in extracted text; end is exclusive. */
  startOffset?: number;
  endOffset?: number;
  contentHash?: string;
}
export interface SearchQuery {
  text: string;
  domains?: readonly SearchDomain[];
  limit?: number;
  sourceIds?: readonly SigmaId[];
  filters?: Readonly<Record<string, string | number | boolean>>;
}
export interface SearchHit {
  id: SigmaId;
  domain: SearchDomain;
  text: string;
  score: number;
  source?: SourceReference;
  createdAt?: IsoDateTime;
  metadata?: Readonly<Record<string, unknown>>;
}
export interface SearchResponse {
  hits: readonly SearchHit[];
  trace: { pipeline: string; indexVersion?: string; elapsedMs?: number };
}
export interface RetrievalService {
  search(query: SearchQuery, signal?: AbortSignal): Promise<SearchResponse>;
}
export interface CoreMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: SigmaId;
  sourceRefs?: readonly SourceReference[];
}
export interface AiRunRequest {
  providerId: SigmaId;
  modelId: string;
  messages: readonly CoreMessage[];
  tools?: readonly SigmaId[];
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}
export interface AiRunEvent {
  type: "text-delta" | "tool-request" | "usage" | "completed" | "failed";
  runId: SigmaId;
  text?: string;
  toolCall?: { id: SigmaId; name: string; arguments: unknown };
  usage?: { inputTokens?: number; outputTokens?: number };
  error?: SigmaError;
}
export interface AiProvider {
  readonly id: SigmaId;
  readonly kind: "cli" | "web" | "local" | "remote";
  run(request: AiRunRequest): AsyncIterable<AiRunEvent>;
}
export type ToolPermissionClass = "read-only" | "write" | "destructive";
export interface ToolDefinition {
  id: SigmaId;
  name: string;
  description: string;
  permission: ToolPermissionClass;
  inputSchema: Readonly<Record<string, unknown>>;
  source: "builtin" | "mcp" | "skill" | "external";
}
export interface ToolCallRequest {
  toolId: SigmaId;
  arguments: unknown;
  runId: SigmaId;
  signal?: AbortSignal;
}
export interface ToolCallResult {
  callId: SigmaId;
  toolId: SigmaId;
  ok: boolean;
  content: readonly { type: "text" | "resource"; text?: string; uri?: string }[];
  error?: SigmaError;
}
export interface ToolRegistry {
  list(): Promise<readonly ToolDefinition[]>;
  call(request: ToolCallRequest): Promise<ToolCallResult>;
}
export interface ConversationRecord {
  id: SigmaId;
  conversationId: SigmaId;
  role: CoreMessage["role"];
  content: string;
  createdAt: IsoDateTime;
  sourceRefs?: readonly SourceReference[];
  metadata?: Readonly<Record<string, unknown>>;
}
export interface ConversationMemory {
  append(record: Omit<ConversationRecord, "id" | "createdAt">): Promise<ConversationRecord>;
  search(query: SearchQuery, signal?: AbortSignal): Promise<readonly SearchHit[]>;
  getRecent(conversationId: SigmaId, limit: number): Promise<readonly ConversationRecord[]>;
}
export interface LearningService {
  getQuestion(questionId: SigmaId): Promise<unknown | null>;
  searchQuestions(query: SearchQuery): Promise<readonly SearchHit[]>;
}
export interface SigmaCore {
  retrieval: RetrievalService;
  tools: ToolRegistry;
  memory: ConversationMemory;
  learning: LearningService;
  providers: ReadonlyMap<SigmaId, AiProvider>;
}
