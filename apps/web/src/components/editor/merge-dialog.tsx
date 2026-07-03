"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Button,
  Input,
  Label,
} from "@giga-pdf/ui";
import { Loader2, Trash2, FilePlus } from "lucide-react";
import { useMergePdfs, downloadBlob } from "@giga-pdf/api";
import { clientLogger } from "@/lib/client-logger";

interface MergeDialogProps {
  open: boolean;
  onClose: () => void;
}

interface PdfEntry {
  id: string;
  file: File;
  range: string;
}

export function MergeDialog({ open, onClose }: MergeDialogProps) {
  const t = useTranslations("editor.merge");
  const [entries, setEntries] = useState<PdfEntry[]>([]);
  const [outputName, setOutputName] = useState("merged.pdf");
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { mutateAsync: mergePdfs, isPending } = useMergePdfs();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    if (selected.length === 0) return;

    const newEntries: PdfEntry[] = selected.map((file) => ({
      id: `${file.name}-${Date.now()}-${Math.random()}`,
      file,
      range: "",
    }));

    setEntries((prev) => [...prev, ...newEntries]);
    setError(null);

    // Reset the input so the same file can be re-selected if needed
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleRemove = (id: string) => {
    setEntries((prev) => prev.filter((entry) => entry.id !== id));
  };

  const handleRangeChange = (id: string, range: string) => {
    setEntries((prev) =>
      prev.map((entry) => (entry.id === id ? { ...entry, range } : entry))
    );
  };

  const handleMerge = async () => {
    if (entries.length < 2) {
      setError(t("errorMinFiles"));
      return;
    }

    setError(null);

    try {
      const files = entries.map((e) => e.file);
      const ranges = entries.map((e) => e.range);
      const hasRanges = ranges.some((r) => r.trim() !== "");

      const blob = await mergePdfs({
        files,
        options: {
          ranges: hasRanges ? ranges : undefined,
          outputName: outputName.trim() || "merged.pdf",
        },
      });

      downloadBlob(blob, outputName.trim() || "merged.pdf");
      handleClose();
    } catch (err) {
      clientLogger.error("[MergeDialog] merge failed:", err);
      setError(
        err instanceof Error
          ? err.message
          : t("errorMergeFailed")
      );
    }
  };

  const handleClose = () => {
    if (isPending) return;
    setEntries([]);
    setOutputName("merged.pdf");
    setError(null);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) handleClose(); }}>
      {/* Explicit mobile-safety classes (also the Tailwind emission anchor for
          the same class strings used by the shared @giga-pdf/ui DialogContent,
          whose pre-bundled source is not scanned by the consumer's Tailwind). */}
      <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-lg max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* File picker */}
          <div className="space-y-2">
            <Label htmlFor="merge-file-input">{t("addFilesLabel")}</Label>
            <input
              ref={fileInputRef}
              id="merge-file-input"
              type="file"
              accept=".pdf"
              multiple
              className="hidden"
              onChange={handleFileChange}
              disabled={isPending}
            />
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => fileInputRef.current?.click()}
              disabled={isPending}
            >
              <FilePlus className="mr-2 h-4 w-4" />
              {t("choosePdfFiles")}
            </Button>
          </div>

          {/* File list */}
          {entries.length > 0 && (
            <div className="space-y-2">
              <Label>{t("selectedFiles", { count: entries.length })}</Label>
              <ul className="space-y-2">
                {entries.map((entry, index) => (
                  <li
                    key={entry.id}
                    className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3"
                  >
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-muted-foreground w-5 shrink-0">
                          {index + 1}.
                        </span>
                        <span
                          className="text-sm truncate"
                          title={entry.file.name}
                        >
                          {entry.file.name}
                        </span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          ({(entry.file.size / 1024).toFixed(0)} KB)
                        </span>
                      </div>
                      <div className="pl-7">
                        <Input
                          type="text"
                          placeholder={t("rangePlaceholder")}
                          value={entry.range}
                          onChange={(e) =>
                            handleRangeChange(entry.id, e.target.value)
                          }
                          disabled={isPending}
                          className="h-7 text-xs"
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemove(entry.id)}
                      disabled={isPending}
                      className="mt-0.5 shrink-0 rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      aria-label={t("removeFile", { name: entry.file.name })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Output filename */}
          <div className="space-y-2">
            <Label htmlFor="merge-output-name">{t("outputNameLabel")}</Label>
            <Input
              id="merge-output-name"
              type="text"
              placeholder="merged.pdf"
              value={outputName}
              onChange={(e) => setOutputName(e.target.value)}
              disabled={isPending}
            />
          </div>

          {/* Error display */}
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={isPending}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            onClick={handleMerge}
            disabled={isPending || entries.length < 2}
          >
            {isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("merging")}
              </>
            ) : (
              t("merge")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
