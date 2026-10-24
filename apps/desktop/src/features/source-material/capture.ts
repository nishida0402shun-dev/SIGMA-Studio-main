import type { SourceMaterialSummary } from "./types";

/**
 * A capture is a renderer-side snapshot of what the user can see in the
 * `/sources` viewer. It is never produced by desktop capture APIs or from
 * another application. The content hash ties the snapshot back to the exact
 * source version Core returned to Studio.
 */

export type SourceCaptureKind = "page" | "text" | "region";

export interface SourceCaptureBoundingBox {
  /** Normalized to the displayed page image: 0..1. */
  x: number;
  y: number;
  /** Normalized page image width/height: 0..1. */
  width: number;
  height: number;
}

export interface SourceCapture {
  id: string;
  sourceId: string;
  sourceName: string;
  contentHash: string;
  pageNumber: number;
  kind: SourceCaptureKind;
  text: string;
  startOffset?: number;
  endOffset?: number;
  boundingBox?: SourceCaptureBoundingBox;
  imageDataUrl?: string;
  createdAt: string;
}

export interface CaptureLimits {
  maxTextBytes: number;
  maxImageBytes: number;
}

/**
 * The Web AI path has no MCP connection. Keep exports comfortably inside
 * common chat attachment limits and ask the user to narrow a capture rather
 * than silently dropping content.
 */
export const WEB_AI_CAPTURE_LIMITS: CaptureLimits = {
  maxTextBytes: 120_000,
  maxImageBytes: 6_000_000,
};

export interface CaptureSizeInspection {
  textBytes: number;
  imageBytes: number;
  totalBytes: number;
  exceedsTextLimit: boolean;
  exceedsImageLimit: boolean;
}

export interface CaptureMarkdownLabels {
  source: string;
  page: string;
  characters: string;
  region: string;
  contentHash: string;
}

interface CaptureSource {
  id: string;
  name: string;
  contentHash: string;
}

interface CaptureBaseInput {
  source: CaptureSource;
  pageNumber: number;
  text: string;
  createdAt?: string;
}

export interface TextCaptureInput extends CaptureBaseInput {
  startOffset: number;
  endOffset: number;
}

export interface RegionCaptureInput extends CaptureBaseInput {
  boundingBox: SourceCaptureBoundingBox;
  imageDataUrl: string;
}

function createId(kind: SourceCaptureKind): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${kind}-${crypto.randomUUID()}`;
  }
  return `${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function baseCapture(input: CaptureBaseInput, kind: SourceCaptureKind): SourceCapture {
  return {
    id: createId(kind),
    sourceId: input.source.id,
    sourceName: input.source.name,
    contentHash: input.source.contentHash,
    pageNumber: input.pageNumber,
    kind,
    text: input.text,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function createPageCapture(input: CaptureBaseInput): SourceCapture {
  return baseCapture(input, "page");
}

export function createTextCapture(input: TextCaptureInput): SourceCapture {
  return {
    ...baseCapture(input, "text"),
    startOffset: Math.max(0, input.startOffset),
    endOffset: Math.max(input.startOffset, input.endOffset),
  };
}

export function clampBoundingBox(box: SourceCaptureBoundingBox): SourceCaptureBoundingBox {
  const x = Math.min(1, Math.max(0, box.x));
  const y = Math.min(1, Math.max(0, box.y));
  return {
    x,
    y,
    width: Math.min(1 - x, Math.max(0, box.width)),
    height: Math.min(1 - y, Math.max(0, box.height)),
  };
}

export function createRegionCapture(input: RegionCaptureInput): SourceCapture {
  return {
    ...baseCapture(input, "region"),
    boundingBox: clampBoundingBox(input.boundingBox),
    imageDataUrl: input.imageDataUrl,
  };
}

export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function imageDataUrlByteLength(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return 0;
  const base64 = dataUrl.slice(comma + 1);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

export function inspectCaptureSize(
  capture: SourceCapture,
  text: string,
  limits: CaptureLimits = WEB_AI_CAPTURE_LIMITS,
): CaptureSizeInspection {
  const textBytes = utf8ByteLength(text);
  const imageBytes = capture.imageDataUrl ? imageDataUrlByteLength(capture.imageDataUrl) : 0;
  return {
    textBytes,
    imageBytes,
    totalBytes: textBytes + imageBytes,
    exceedsTextLimit: textBytes > limits.maxTextBytes,
    exceedsImageLimit: imageBytes > limits.maxImageBytes,
  };
}

export function isCaptureSourceCurrent(
  capture: SourceCapture,
  source: Pick<SourceMaterialSummary, "id" | "contentHash"> | null,
): boolean {
  return Boolean(source && source.id === capture.sourceId && source.contentHash === capture.contentHash);
}

export function formatCaptureMarkdown(
  capture: SourceCapture,
  text: string,
  labels: CaptureMarkdownLabels,
): string {
  const metadata = [
    `${labels.source}: ${capture.sourceName}`,
    `${labels.page}: ${capture.pageNumber}`,
    `${labels.contentHash}: ${capture.contentHash}`,
  ];
  if (capture.kind === "text" && capture.startOffset !== undefined && capture.endOffset !== undefined) {
    metadata.push(`${labels.characters}: ${capture.startOffset}-${capture.endOffset}`);
  }
  if (capture.kind === "region" && capture.boundingBox) {
    const box = capture.boundingBox;
    metadata.push(
      `${labels.region}: x=${box.x.toFixed(3)}, y=${box.y.toFixed(3)}, w=${box.width.toFixed(3)}, h=${box.height.toFixed(3)}`,
    );
  }
  return `${metadata.join("\n")}\n\n---\n\n${text.trim()}\n`;
}
