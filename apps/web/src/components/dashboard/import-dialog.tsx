"use client";

import { useCallback, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Progress,
} from "@giga-pdf/ui";
import { UploadCloud, FilePlus2, X, AlertCircle } from "lucide-react";
import {
  MAX_IMPORT_FILE_SIZE_BYTES,
  batchCurrentFileName,
  batchPercent,
  type BatchUploadProgress,
} from "@/lib/document-import";

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Hand the selected/dropped files to the page-level import pipeline. */
  onFilesSelected: (files: File[]) => void;
  /** True while a batch is uploading (drives the progress + disabled state). */
  uploading: boolean;
  /** Byte-accurate batch progress (real bytes sent), null when idle. */
  progress: BatchUploadProgress | null;
  /**
   * Failures of the last settled batch (the dialog stays open on failure so
   * the user can read the reasons and retry via re-drop / browse).
   */
  failures: ReadonlyArray<{ name: string; reason: string }> | null;
  /** Abort the in-flight batch (Annuler button while uploading). */
  onCancel: () => void;
  /** Destination folder display path (e.g. "/", "/Invoices"). */
  destinationPath: string;
}

/**
 * Universal import dialog: a single drop zone that accepts EVERY file type
 * (drag & drop + native file picker), uploading each file as-is to the
 * current folder. Keyboard accessible (the zone is a button) and labelled
 * for screen readers via aria-describedby.
 */
export function ImportDialog({
  open,
  onOpenChange,
  onFilesSelected,
  uploading,
  progress,
  failures,
  onCancel,
  destinationPath,
}: ImportDialogProps) {
  const t = useTranslations("documents.import");
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();

  // Drag state with a depth counter: dragenter/dragleave fire for every child
  // element, so a naive boolean flickers. Counting enter−leave keeps the
  // highlight stable until the cursor truly leaves the zone.
  const [isDragging, setIsDragging] = useState(false);
  const dragDepthRef = useRef(0);

  const resetDrag = useCallback(() => {
    dragDepthRef.current = 0;
    setIsDragging(false);
  }, []);

  const handleBrowse = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files ? Array.from(event.target.files) : [];
      // Reset immediately so re-picking the same file fires `change` again;
      // the File references stay valid after clearing the input value.
      event.target.value = "";
      if (files.length > 0) onFilesSelected(files);
    },
    [onFilesSelected],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      resetDrag();
      const files = event.dataTransfer.files
        ? Array.from(event.dataTransfer.files)
        : [];
      if (files.length > 0) onFilesSelected(files);
    },
    [onFilesSelected, resetDrag],
  );

  const maxSizeMb = Math.floor(MAX_IMPORT_FILE_SIZE_BYTES / (1024 * 1024));
  // Byte-accurate percent (real bytes sent, weighted by file size). When no
  // byte total is known the bar falls back to an indeterminate pulse.
  const percent = progress ? batchPercent(progress) : 0;
  const indeterminate = progress !== null && progress.totalBytes <= 0;
  const currentFileName = progress ? batchCurrentFileName(progress) : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Block closing mid-upload to avoid losing the progress feedback.
        if (uploading && !next) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("dialogTitle")}</DialogTitle>
          <DialogDescription>
            {t("dialogDescription", { path: destinationPath })}
          </DialogDescription>
        </DialogHeader>

        {/* Universal drop zone — accepts every file type. The button role +
            Enter/Space activation make it fully keyboard operable. */}
        <button
          type="button"
          onClick={handleBrowse}
          aria-describedby={hintId}
          aria-disabled={uploading}
          disabled={uploading}
          onDragEnter={(e) => {
            if (!e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            dragDepthRef.current += 1;
            setIsDragging(true);
          }}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }}
          onDragLeave={(e) => {
            if (!e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            dragDepthRef.current -= 1;
            if (dragDepthRef.current <= 0) resetDrag();
          }}
          onDrop={handleDrop}
          className={`flex w-full flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 ${
            isDragging
              ? "border-primary bg-primary/10"
              : "border-muted-foreground/30 hover:border-primary/60 hover:bg-accent/40"
          }`}
        >
          <UploadCloud
            className={`h-10 w-10 ${isDragging ? "text-primary" : "text-muted-foreground"}`}
            aria-hidden="true"
          />
          <span className="text-base font-medium">
            {isDragging ? t("dropNow") : t("dropPrompt")}
          </span>
          <span id={hintId} className="text-sm text-muted-foreground">
            {t("anyFormatHint", { size: maxSizeMb })}
          </span>
          <span className="mt-1 inline-flex items-center gap-2 text-sm font-medium text-primary">
            <FilePlus2 className="h-4 w-4" aria-hidden="true" />
            {t("browse")}
          </span>
        </button>

        {/* Accepts everything: no `accept` attribute so the OS picker shows
            all files. `multiple` enables batch import. */}
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleInputChange}
          aria-hidden="true"
          tabIndex={-1}
        />

        {uploading && progress && (
          <div className="space-y-2" aria-live="polite">
            {currentFileName && (
              <p className="text-sm text-muted-foreground truncate">
                {t("currentFile", { name: currentFileName })}
              </p>
            )}
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>{t("uploadingProgress", {
                done: progress.done,
                total: progress.total,
              })}</span>
              {!indeterminate && <span>{percent}%</span>}
            </div>
            {indeterminate ? (
              <Progress value={100} className="animate-pulse" />
            ) : (
              <Progress value={percent} />
            )}
          </div>
        )}

        {/* Last batch's failures: the dialog stays open on failure so the
            user can read the per-file reasons and retry (re-drop / browse). */}
        {!uploading && failures && failures.length > 0 && (
          <div
            role="alert"
            className="space-y-1 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
          >
            <p className="flex items-center gap-2 font-medium text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              {t("failuresTitle")}
            </p>
            <ul className="space-y-0.5 text-muted-foreground">
              {failures.map((failure, index) => (
                <li key={`${failure.name}-${index}`} className="truncate">
                  {failure.name} : {failure.reason}
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground">{t("retryHint")}</p>
          </div>
        )}

        <DialogFooter>
          {uploading ? (
            <Button
              variant="outline"
              onClick={onCancel}
              className="pointer-coarse:min-h-11 pointer-coarse:min-w-11"
            >
              <X className="mr-2 h-4 w-4" aria-hidden="true" />
              {t("cancel")}
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="pointer-coarse:min-h-11 pointer-coarse:min-w-11"
            >
              <X className="mr-2 h-4 w-4" aria-hidden="true" />
              {t("close")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
