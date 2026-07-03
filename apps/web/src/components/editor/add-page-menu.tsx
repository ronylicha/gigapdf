"use client";

/**
 * add-page-menu.tsx
 *
 * The Word-like "Add page" picker (SL4): choose a paper format (A4 / A3 /
 * Letter / Legal / custom), orientation (portrait / landscape) and where the
 * page goes (after the current page / at the end). On confirm it calls back with
 * the selection; the editor resolves the size to PDF points
 * ({@link import("./lib/page-formats").formatToPoints}) and runs the page-add
 * operation, re-baking the running header/footer afterwards (the `{{page}}` /
 * `{{pages}}` tokens shift).
 *
 * Self-contained dropdown (own open state + click-outside) so the toolbar stays
 * lean and this stays unit-testable in isolation.
 */

import React, { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { FilePlus2, ChevronDown } from "lucide-react";
import {
  STANDARD_PAGE_FORMATS,
  type AddPagePosition,
  type PageFormat,
  type PageFormatPoints,
  type PageOrientation,
} from "./lib/page-formats";

export interface AddPageMenuProps {
  /**
   * Add a page with the chosen format/orientation at `position`. `custom`
   * carries the portrait dimensions (PDF points) when `format === "custom"`.
   */
  onAddPage: (
    format: PageFormat,
    orientation: PageOrientation,
    position: AddPagePosition,
    custom?: PageFormatPoints,
  ) => void;
}

/** The "Add page" dropdown: format × orientation × position picker. */
export function AddPageMenu({ onAddPage }: AddPageMenuProps) {
  const t = useTranslations("editor.addPage");
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<PageFormat>("a4");
  const [orientation, setOrientation] = useState<PageOrientation>("portrait");
  const [position, setPosition] = useState<AddPagePosition>("after");
  const [customWidth, setCustomWidth] = useState(595);
  const [customHeight, setCustomHeight] = useState(842);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocPointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    // pointerdown couvre souris ET tactile (mousedown seul laissait le menu
    // bloqué ouvert au doigt).
    document.addEventListener("pointerdown", onDocPointerDown);
    return () => document.removeEventListener("pointerdown", onDocPointerDown);
  }, [open]);

  const confirm = () => {
    const custom: PageFormatPoints | undefined =
      format === "custom"
        ? { width: customWidth, height: customHeight }
        : undefined;
    onAddPage(format, orientation, position, custom);
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={t("toolbarLabel")}
        aria-label={t("toolbarLabel")}
        className="flex items-center gap-0.5 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <FilePlus2 size={20} />
        <ChevronDown size={12} />
      </button>

      {open ? (
        <div
          data-testid="add-page-menu"
          className="absolute left-0 top-full z-50 mt-1 flex w-56 flex-col gap-3 rounded-lg border bg-background p-3 shadow-lg"
        >
          {/* Format */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t("formatLabel")}
            </span>
            <div className="grid grid-cols-2 gap-1">
              {STANDARD_PAGE_FORMATS.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFormat(f)}
                  className={`rounded px-2 py-1 text-xs transition-colors ${
                    format === f
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted"
                  }`}
                >
                  {t(`format.${f}`)}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setFormat("custom")}
                className={`col-span-2 rounded px-2 py-1 text-xs transition-colors ${
                  format === "custom"
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                }`}
              >
                {t("format.custom")}
              </button>
            </div>
          </div>

          {/* Custom dimensions (points) */}
          {format === "custom" ? (
            <div className="flex items-center gap-2">
              <label className="flex flex-1 flex-col gap-0.5 text-[10px] text-muted-foreground">
                {t("customWidth")}
                <input
                  type="number"
                  min={1}
                  value={customWidth}
                  aria-label={t("customWidth")}
                  onChange={(e) =>
                    setCustomWidth(Math.max(1, Number(e.target.value) || 0))
                  }
                  className="h-7 rounded border bg-background px-2 text-xs"
                />
              </label>
              <label className="flex flex-1 flex-col gap-0.5 text-[10px] text-muted-foreground">
                {t("customHeight")}
                <input
                  type="number"
                  min={1}
                  value={customHeight}
                  aria-label={t("customHeight")}
                  onChange={(e) =>
                    setCustomHeight(Math.max(1, Number(e.target.value) || 0))
                  }
                  className="h-7 rounded border bg-background px-2 text-xs"
                />
              </label>
            </div>
          ) : null}

          {/* Orientation */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t("orientationLabel")}
            </span>
            <div className="grid grid-cols-2 gap-1">
              {(["portrait", "landscape"] as const).map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => setOrientation(o)}
                  className={`rounded px-2 py-1 text-xs transition-colors ${
                    orientation === o
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted"
                  }`}
                >
                  {t(`orientation.${o}`)}
                </button>
              ))}
            </div>
          </div>

          {/* Position */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t("positionLabel")}
            </span>
            <div className="grid grid-cols-2 gap-1">
              {(["after", "end"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPosition(p)}
                  className={`rounded px-2 py-1 text-xs transition-colors ${
                    position === p
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted"
                  }`}
                >
                  {t(`position.${p}`)}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={confirm}
            className="rounded bg-primary px-2 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            {t("add")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
