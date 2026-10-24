"use client";

import { AlertTriangle, ClipboardCopy, Download, Globe2, Terminal } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { ModalBody, ModalFrame, ModalHeader } from "@/components/ui/Modal";
import {
  formatCaptureMarkdown,
  inspectCaptureSize,
  isCaptureSourceCurrent,
  type SourceCapture,
  WEB_AI_CAPTURE_LIMITS,
} from "@/features/source-material/capture";
import type { SourceMaterialSummary } from "@/features/source-material/types";
import { writeTextToClipboard } from "@/lib/clipboard-text";
import { useT } from "@/lib/i18n/react";

interface SourceCapturePreviewDialogProps {
  capture: SourceCapture;
  source: SourceMaterialSummary | null;
  workspaceId: string;
  onClose: () => void;
}

function imageFileName(capture: SourceCapture): string {
  const base = capture.sourceName.replace(/\.[^.]+$/u, "").replace(/[^\p{L}\p{N}_-]+/gu, "-");
  return `${base || "source"}-p${capture.pageNumber}-${capture.kind}.png`;
}

export function SourceCapturePreviewDialog({
  capture,
  source,
  workspaceId,
  onClose,
}: SourceCapturePreviewDialogProps) {
  const t = useT("workspace");
  const [text, setText] = useState(capture.text);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const current = isCaptureSourceCurrent(capture, source);
  const inspection = inspectCaptureSize(capture, text, WEB_AI_CAPTURE_LIMITS);
  const kindLabel =
    capture.kind === "page"
      ? t("sources.capturePageLabel")
      : capture.kind === "text"
        ? t("sources.captureTextLabel")
        : t("sources.captureRegionLabel");

  const markdown = formatCaptureMarkdown(capture, text, {
    source: t("sources.sourceInfo"),
    page: t("sources.page"),
    characters: t("sources.characters"),
    region: t("sources.region"),
    contentHash: t("sources.contentHash"),
  });
  const cliContext = [
    "MCP server: sigma-core-local",
    `workspaceId: ${workspaceId}`,
    `coreWorkspaceId: ${source?.coreWorkspaceId ?? ""}`,
    `sourceId: ${capture.sourceId}`,
    `pageNumber: ${capture.pageNumber}`,
    `contentHash: ${capture.contentHash}`,
  ].join("\n");

  const copy = async (value: string, successMessage: string) => {
    const copied = await writeTextToClipboard(value);
    setCopyMessage(copied ? successMessage : t("sources.copyFailed"));
  };

  const downloadImage = () => {
    if (!capture.imageDataUrl) return;
    const anchor = document.createElement("a");
    anchor.href = capture.imageDataUrl;
    anchor.download = imageFileName(capture);
    anchor.click();
  };

  return (
    <ModalFrame open onDismiss={onClose} size="lg" ariaLabel={t("sources.previewTitle")}>
      <ModalHeader
        title={t("sources.previewTitle")}
        description={t("sources.previewDescription")}
        onClose={onClose}
      />
      <ModalBody scroll="auto">
        <div className="sources-capture-preview">
          {!current ? (
            <div className="sources-capture-alert" role="alert">
              <AlertTriangle size={18} aria-hidden="true" />
              <span>{t("sources.sourceChanged")}</span>
            </div>
          ) : null}

          <dl className="sources-capture-meta">
            <div>
              <dt>{t("sources.sourceInfo")}</dt>
              <dd>{capture.sourceName}</dd>
            </div>
            <div>
              <dt>{t("sources.page")}</dt>
              <dd>{capture.pageNumber}</dd>
            </div>
            <div>
              <dt>{t("sources.captureKind")}</dt>
              <dd>{kindLabel}</dd>
            </div>
            <div>
              <dt>{t("sources.contentHash")}</dt>
              <dd title={capture.contentHash}>{capture.contentHash.slice(0, 16)}…</dd>
            </div>
          </dl>

          {capture.imageDataUrl ? (
            <figure className="sources-capture-image">
              {/* The data URL was cropped from the already-rendered viewer image. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={capture.imageDataUrl} alt={t("sources.captureRegionLabel")} />
              <figcaption>
                {t("sources.bytesCount", { bytes: inspection.imageBytes })}
                <Button tone="ghost" size="sm" onClick={downloadImage} disabled={!current}>
                  <Download size={15} aria-hidden="true" />
                  {t("sources.downloadImage")}
                </Button>
              </figcaption>
            </figure>
          ) : null}

          <label className="sources-capture-text-label" htmlFor="sources-capture-text">
            {t("sources.captureText")}
          </label>
          <textarea
            id="sources-capture-text"
            className="sources-capture-text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={Math.min(16, Math.max(6, text.split("\n").length + 1))}
            disabled={!current}
          />
          <div className="sources-capture-byte-row">
            <span>{t("sources.captureTextHint")}</span>
            <span>{t("sources.bytesCount", { bytes: inspection.textBytes })}</span>
          </div>

          {inspection.exceedsTextLimit ? (
            <div className="sources-capture-alert" role="alert">
              <AlertTriangle size={18} aria-hidden="true" />
              <span>
                {t("sources.textLimitExceeded", {
                  limit: WEB_AI_CAPTURE_LIMITS.maxTextBytes,
                })}
              </span>
            </div>
          ) : null}
          {inspection.exceedsImageLimit ? (
            <div className="sources-capture-alert" role="alert">
              <AlertTriangle size={18} aria-hidden="true" />
              <span>
                {t("sources.imageLimitExceeded", {
                  limit: WEB_AI_CAPTURE_LIMITS.maxImageBytes,
                })}
              </span>
            </div>
          ) : null}

          <div className="sources-capture-actions">
            <Button
              tone="secondary"
              size="sm"
              onClick={() => void copy(text, t("sources.copiedText"))}
              disabled={!current || text.trim().length === 0}
            >
              <ClipboardCopy size={15} aria-hidden="true" />
              {t("sources.copyText")}
            </Button>
            <Button
              tone="primary"
              size="sm"
              onClick={() => void copy(markdown, t("sources.copiedMarkdown"))}
              disabled={!current}
            >
              <ClipboardCopy size={15} aria-hidden="true" />
              {t("sources.copyMarkdown")}
            </Button>
            {copyMessage ? (
              <span className="sources-capture-copy-status" role="status">
                {copyMessage}
              </span>
            ) : null}
          </div>

          <section className="sources-handoff-card" aria-labelledby="sources-cli-handoff-title">
            <h3 id="sources-cli-handoff-title">
              <Terminal size={17} aria-hidden="true" />
              {t("sources.cliAiTitle")}
            </h3>
            <p>{t("sources.cliAiDescription")}</p>
            <Button
              tone="ghost"
              size="sm"
              onClick={() => void copy(cliContext, t("sources.copiedCliContext"))}
              disabled={!current}
            >
              <ClipboardCopy size={15} aria-hidden="true" />
              {t("sources.copyCliContext")}
            </Button>
          </section>

          <section className="sources-handoff-card" aria-labelledby="sources-web-handoff-title">
            <h3 id="sources-web-handoff-title">
              <Globe2 size={17} aria-hidden="true" />
              {t("sources.webAiTitle")}
            </h3>
            <p>{t("sources.webAiDescription")}</p>
          </section>
        </div>
      </ModalBody>
    </ModalFrame>
  );
}
