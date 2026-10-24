"use client";

import { Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { ModalBody, ModalFrame, ModalHeader } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n/react";

interface SourceDeleteDialogProps {
  sourceName: string;
  deleting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function SourceDeleteDialog({
  sourceName,
  deleting,
  error,
  onCancel,
  onConfirm,
}: SourceDeleteDialogProps) {
  const t = useT("workspace");
  return (
    <ModalFrame open onDismiss={onCancel} size="sm" ariaLabel={t("sources.deleteTitle")}>
      <ModalHeader
        title={t("sources.deleteTitle")}
        description={t("sources.deleteDescription", { name: sourceName })}
        onClose={onCancel}
        hideCloseButton={deleting}
      />
      <ModalBody padding="lg">
        {error ? (
          <p className="sources-delete-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="sources-delete-actions">
          <Button tone="ghost" size="sm" onClick={onCancel} disabled={deleting}>
            {t("action.cancelLong")}
          </Button>
          <Button tone="danger" size="sm" onClick={onConfirm} disabled={deleting}>
            {deleting ? (
              <Loader2 className="sources-spin" size={15} aria-hidden="true" />
            ) : (
              <Trash2 size={15} aria-hidden="true" />
            )}
            {deleting ? t("sources.deleting") : t("sources.deleteConfirm")}
          </Button>
        </div>
      </ModalBody>
    </ModalFrame>
  );
}
