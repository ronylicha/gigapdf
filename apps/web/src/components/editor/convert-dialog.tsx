"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { X, FileCode, Globe, Download, Loader2, AlertCircle } from "lucide-react";
import { useConvertToPdf, downloadBlob } from "@giga-pdf/api";
import { clientLogger } from "@/lib/client-logger";

type ConvertMode = "html" | "url";

interface ConvertDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type PageFormat = "A4" | "Letter" | "Legal";
type Orientation = "portrait" | "landscape";

interface MarginValues {
  top: string;
  right: string;
  bottom: string;
  left: string;
}

const PAGE_FORMATS: PageFormat[] = ["A4", "Letter", "Legal"];
const ORIENTATIONS: Orientation[] = ["portrait", "landscape"];

function buildMarginString(margins: MarginValues): string {
  const top = margins.top.trim() || "0";
  const right = margins.right.trim() || "0";
  const bottom = margins.bottom.trim() || "0";
  const left = margins.left.trim() || "0";
  return `${top}mm ${right}mm ${bottom}mm ${left}mm`;
}

function MarginInput({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type="number"
          min="0"
          step="1"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder="0"
          className="w-full rounded-lg border border-input bg-background px-3 py-2 pr-8 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
          mm
        </span>
      </div>
    </div>
  );
}

export function ConvertDialog({ isOpen, onClose }: ConvertDialogProps) {
  const t = useTranslations("editor.convert");
  const [mode, setMode] = useState<ConvertMode>("html");
  const [htmlContent, setHtmlContent] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [outputName, setOutputName] = useState("converted.pdf");
  const [pageFormat, setPageFormat] = useState<PageFormat>("A4");
  const [orientation, setOrientation] = useState<Orientation>("portrait");
  const [margins, setMargins] = useState<MarginValues>({
    top: "10",
    right: "10",
    bottom: "10",
    left: "10",
  });
  const [error, setError] = useState<string | null>(null);

  const { mutateAsync: convertToPdf, isPending } = useConvertToPdf();

  const handleModeChange = useCallback((newMode: ConvertMode) => {
    setMode(newMode);
    setError(null);
  }, []);

  const handleMarginChange = useCallback(
    (side: keyof MarginValues) => (value: string) => {
      setMargins((prev) => ({ ...prev, [side]: value }));
    },
    [],
  );

  const handleConvert = useCallback(async () => {
    setError(null);

    if (mode === "html" && !htmlContent.trim()) {
      setError(t("errors.htmlRequired"));
      return;
    }

    if (mode === "url") {
      const trimmedUrl = urlInput.trim();
      if (!trimmedUrl) {
        setError(t("errors.urlRequired"));
        return;
      }
      try {
        new URL(trimmedUrl);
      } catch {
        setError(t("errors.urlInvalid"));
        return;
      }
    }

    try {
      const blob = await convertToPdf({
        ...(mode === "html" ? { html: htmlContent } : { url: urlInput.trim() }),
        format: pageFormat,
        landscape: orientation === "landscape",
        pageSize: pageFormat,
        margin: buildMarginString(margins),
      });

      downloadBlob(blob, outputName.trim() || "converted.pdf");
      handleClose();
    } catch (err) {
      clientLogger.error("[ConvertDialog] conversion failed:", err);
      setError(
        err instanceof Error
          ? err.message
          : t("errors.conversionFailed"),
      );
    }
  }, [mode, htmlContent, urlInput, outputName, pageFormat, orientation, margins, convertToPdf, t]);

  const handleClose = useCallback(() => {
    if (isPending) return;
    setMode("html");
    setHtmlContent("");
    setUrlInput("");
    setOutputName("converted.pdf");
    setPageFormat("A4");
    setOrientation("portrait");
    setMargins({ top: "10", right: "10", bottom: "10", left: "10" });
    setError(null);
    onClose();
  }, [isPending, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="convert-dialog-title"
    >
      <div className="relative w-full max-w-[calc(100vw-2rem)] sm:max-w-lg rounded-xl bg-background shadow-2xl border border-border flex flex-col max-h-[90dvh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Download size={20} className="text-primary" />
            <h2
              id="convert-dialog-title"
              className="text-base font-semibold text-foreground"
            >
              {t("title")}
            </h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={isPending}
            aria-label={t("closeAria")}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5">
          <div className="flex flex-col gap-5">
            {/* Mode tabs */}
            <div className="flex gap-1 rounded-lg border border-border bg-muted/40 p-1">
              <button
                type="button"
                onClick={() => handleModeChange("html")}
                disabled={isPending}
                aria-pressed={mode === "html"}
                className={[
                  "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  mode === "html"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                ].join(" ")}
              >
                <FileCode size={15} />
                HTML
              </button>
              <button
                type="button"
                onClick={() => handleModeChange("url")}
                disabled={isPending}
                aria-pressed={mode === "url"}
                className={[
                  "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  mode === "url"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                ].join(" ")}
              >
                <Globe size={15} />
                URL
              </button>
            </div>

            {/* HTML input */}
            {mode === "html" && (
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="convert-html-content"
                  className="text-sm font-medium text-foreground"
                >
                  {t("htmlLabel")}
                </label>
                <textarea
                  id="convert-html-content"
                  value={htmlContent}
                  onChange={(e) => {
                    setHtmlContent(e.target.value);
                    setError(null);
                  }}
                  disabled={isPending}
                  placeholder={t("htmlPlaceholder")}
                  rows={8}
                  className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-mono"
                  spellCheck={false}
                />
              </div>
            )}

            {/* URL input */}
            {mode === "url" && (
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="convert-url-input"
                  className="text-sm font-medium text-foreground"
                >
                  {t("urlLabel")}
                </label>
                <input
                  id="convert-url-input"
                  type="url"
                  value={urlInput}
                  onChange={(e) => {
                    setUrlInput(e.target.value);
                    setError(null);
                  }}
                  disabled={isPending}
                  placeholder="https://example.com"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <p className="text-xs text-muted-foreground">
                  {t("urlHint")}
                </p>
              </div>
            )}

            {/* Output filename */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="convert-output-name"
                className="text-sm font-medium text-foreground"
              >
                {t("outputLabel")}
              </label>
              <input
                id="convert-output-name"
                type="text"
                value={outputName}
                onChange={(e) => setOutputName(e.target.value)}
                disabled={isPending}
                placeholder="converted.pdf"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>

            {/* Page options */}
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/20 px-4 py-4">
              <span className="text-sm font-medium text-foreground">{t("pageOptions")}</span>

              <div className="grid grid-cols-2 gap-3">
                {/* Page format */}
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="convert-page-format"
                    className="text-sm font-medium text-foreground"
                  >
                    {t("formatLabel")}
                  </label>
                  <select
                    id="convert-page-format"
                    value={pageFormat}
                    onChange={(e) => setPageFormat(e.target.value as PageFormat)}
                    disabled={isPending}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {PAGE_FORMATS.map((fmt) => (
                      <option key={fmt} value={fmt}>
                        {fmt}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Orientation */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-foreground">{t("orientationLabel")}</span>
                  <div className="flex gap-3 pt-1">
                    {ORIENTATIONS.map((value) => (
                      <label
                        key={value}
                        className="flex items-center gap-2 cursor-pointer select-none"
                      >
                        <input
                          type="radio"
                          name="convert-orientation"
                          value={value}
                          checked={orientation === value}
                          onChange={() => setOrientation(value)}
                          disabled={isPending}
                          className="accent-primary"
                        />
                        <span className="text-sm text-foreground">{t(`orientations.${value}`)}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {/* Margins */}
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium text-foreground">
                  {t("marginsLabel")}
                </span>
                <div className="grid grid-cols-4 gap-2">
                  <MarginInput
                    id="convert-margin-top"
                    label={t("margins.top")}
                    value={margins.top}
                    onChange={handleMarginChange("top")}
                    disabled={isPending}
                  />
                  <MarginInput
                    id="convert-margin-right"
                    label={t("margins.right")}
                    value={margins.right}
                    onChange={handleMarginChange("right")}
                    disabled={isPending}
                  />
                  <MarginInput
                    id="convert-margin-bottom"
                    label={t("margins.bottom")}
                    value={margins.bottom}
                    onChange={handleMarginChange("bottom")}
                    disabled={isPending}
                  />
                  <MarginInput
                    id="convert-margin-left"
                    label={t("margins.left")}
                    value={margins.left}
                    onChange={handleMarginChange("left")}
                    disabled={isPending}
                  />
                </div>
              </div>
            </div>

            {/* Error message */}
            {error && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5"
              >
                <AlertCircle size={16} className="text-destructive shrink-0 mt-0.5" />
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border shrink-0">
          <button
            type="button"
            onClick={handleClose}
            disabled={isPending}
            className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={handleConvert}
            disabled={isPending}
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isPending ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                {t("converting")}
              </>
            ) : (
              <>
                <Download size={15} />
                {t("title")}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
