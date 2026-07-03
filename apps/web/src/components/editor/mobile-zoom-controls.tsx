"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Minus, Plus } from "lucide-react";

/**
 * MobileZoomControls — floating thumb-reachable zoom cluster for the editor
 * canvas on small screens (`md:hidden`; the toolbar zoom group covers md+).
 *
 * Layout contract: rendered as a bottom-right `absolute` child of the canvas
 * row (which is `relative`), so it sits above the canvas content and below
 * the portaled overlays (Sheets / dialogs are `z-50` at the end of `<body>`;
 * this cluster is `z-40`, consistent with the editor's z scale where page
 * content lives at z-20/30). Pointer events only cover the pill itself, so
 * pinch-zoom and the drawer edges stay untouched.
 *
 * - `−` / `+`: multiplicative steps (×/÷ 1.25), same contract as the toolbar
 *   and Ctrl+± shortcuts — manual zoom, exits fit mode via `onZoomChange`.
 * - `%` tap: cycles fit-width → fit-page → 100 % (then back to fit-width).
 */
export interface MobileZoomControlsProps {
  /** Current zoom factor (1 = 100 %). */
  zoom: number;
  /** Active adaptive mode (null = manual zoom). */
  fitMode: "page" | "width" | null;
  /** Manual zoom request (callers clear fitMode — `handleManualZoomChange`). */
  onZoomChange: (zoom: number) => void;
  /** Enter fit-page mode. */
  onFitPage: () => void;
  /** Enter fit-width mode. */
  onFitWidth: () => void;
}

/** Engine zoom bounds (mirrors the canvas store's minZoom/maxZoom: 10–800 %). */
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
/** Multiplicative step shared with the toolbar ± buttons and Ctrl+±. */
const ZOOM_STEP = 1.25;

/** ≥44px touch targets (the component only renders below `md`). */
const BUTTON_CLASS =
  "flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40";

export function MobileZoomControls({
  zoom,
  fitMode,
  onZoomChange,
  onFitPage,
  onFitWidth,
}: MobileZoomControlsProps): React.JSX.Element {
  const t = useTranslations("editor.toolbar");

  // Tap on the % readout: fit-width → fit-page → 100 % → fit-width …
  const handleCycle = () => {
    if (fitMode === "width") {
      onFitPage();
    } else if (fitMode === "page") {
      onZoomChange(1);
    } else {
      onFitWidth();
    }
  };

  return (
    <div className="absolute bottom-3 right-3 z-40 flex items-center overflow-hidden rounded-full border bg-background/90 shadow-lg backdrop-blur md:hidden">
      <button
        type="button"
        aria-label={t("zoomOut")}
        title={t("zoomOut")}
        disabled={zoom <= MIN_ZOOM + 0.001}
        onClick={() => onZoomChange(Math.max(MIN_ZOOM, zoom / ZOOM_STEP))}
        className={BUTTON_CLASS}
      >
        <Minus className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label={t("zoomLevel")}
        title={t("zoomLevel")}
        onClick={handleCycle}
        className="flex h-11 min-w-[3.25rem] cursor-pointer items-center justify-center px-1 text-xs font-medium tabular-nums text-foreground transition-colors duration-150 hover:bg-muted"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        aria-label={t("zoomIn")}
        title={t("zoomIn")}
        disabled={zoom >= MAX_ZOOM - 0.001}
        onClick={() => onZoomChange(Math.min(MAX_ZOOM, zoom * ZOOM_STEP))}
        className={BUTTON_CLASS}
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
