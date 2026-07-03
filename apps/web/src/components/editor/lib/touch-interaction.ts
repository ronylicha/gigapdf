/**
 * touch-interaction.ts
 *
 * Pure helpers for the TACTILE editing layer (mobile lot 2):
 *
 *   - `touchActionForTool` — per-tool CSS `touch-action` for the canvas
 *     wrapper. Draw-intent tools (the finger draws/places) get `none` so the
 *     browser never scrolls mid-stroke; navigation tools (select/hand/…)
 *     get `pan-x pan-y` so native one-finger scrolling works, while the
 *     app-level pinch handler (see pinch-zoom.ts) owns two-finger zoom
 *     (`pan-x pan-y` deliberately excludes the browser's pinch-zoom).
 *   - `isCoarsePointer` — `(pointer: coarse)` media query probe (touch-first
 *     devices). SSR/jsdom-safe: defaults to false (fine pointer / desktop).
 *   - `coarseControlProps` — extra Fabric object options on coarse pointers:
 *     bigger touch corners + padding, WITHOUT touching the desktop visuals
 *     (returns `{}` on fine pointers, keeping `cornerSize: 8` rendering).
 *   - `clientPointFromEvent` — client coordinates from a Mouse/Pointer/Touch
 *     event. Fabric 7 (touch events mode) forwards raw `TouchEvent`s to the
 *     `mouse:*` handlers: reading `clientX` off them yields `undefined` →
 *     NaN-poisoned pan math. This normaliser fixes the "hand" tool on touch.
 *   - `installFormFieldHitFloor` — on coarse pointers only, widen the HIT
 *     detection (not the visual rect) of a form-field hit-target so tiny
 *     widgets (CERFA checkboxes…) stay tappable (~24 px on screen minimum).
 *
 * No DOM construction, no React — unit-testable in jsdom.
 */

import type { Tool } from "@giga-pdf/types";

/**
 * Tools where a touch on the page DRAWS or PLACES content — the finger must
 * not scroll the view. Everything else (select / hand / fill_sign / image /
 * zoom) keeps native touch panning.
 */
export const DRAW_INTENT_TOOLS: ReadonlySet<Tool> = new Set<Tool>([
  "text",
  "shape",
  "annotation",
  "form_field",
  "draw",
  "redact",
]);

export type EditorTouchAction = "none" | "pan-x pan-y";

/** CSS `touch-action` for the editor canvas wrapper, given the active tool. */
export function touchActionForTool(
  tool: Tool | null | undefined,
): EditorTouchAction {
  return tool != null && DRAW_INTENT_TOOLS.has(tool) ? "none" : "pan-x pan-y";
}

/**
 * Whether Fabric should allow native touch scrolling for this tool. Mirrors
 * {@link touchActionForTool}: draw-intent tools need Fabric to preventDefault
 * + stream `touchmove` (freehand ink relies on it); navigation tools let the
 * browser scroll.
 */
export function allowTouchScrollingForTool(
  tool: Tool | null | undefined,
): boolean {
  return !(tool != null && DRAW_INTENT_TOOLS.has(tool));
}

/** True on touch-first devices (`(pointer: coarse)`). False at SSR / jsdom. */
export function isCoarsePointer(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches
  );
}

/** Fabric `touchCornerSize` used on coarse pointers (default is 24). */
export const TOUCH_CORNER_SIZE = 28;
/** Extra Fabric control padding on coarse pointers (easier corner grabs). */
export const TOUCH_CONTROL_PADDING = 6;

/**
 * Extra Fabric object options for comfortable touch handles. Spread AFTER the
 * regular control options: on fine pointers this is `{}` (desktop rendering —
 * including the compact `cornerSize: 8` — is untouched).
 */
export function coarseControlProps():
  | { touchCornerSize: number; padding: number }
  | Record<string, never> {
  return isCoarsePointer()
    ? { touchCornerSize: TOUCH_CORNER_SIZE, padding: TOUCH_CONTROL_PADDING }
    : {};
}

/**
 * Client coordinates of a Mouse/Pointer/Touch event, duck-typed (jsdom has no
 * `TouchEvent` constructor). Touch lists win over `clientX` because Fabric
 * forwards raw `TouchEvent`s whose `clientX` is `undefined`.
 */
export function clientPointFromEvent(
  e: unknown,
): { x: number; y: number } | null {
  const evt = e as {
    touches?: ArrayLike<{ clientX: number; clientY: number }>;
    changedTouches?: ArrayLike<{ clientX: number; clientY: number }>;
    clientX?: number;
    clientY?: number;
  } | null;
  if (!evt) return null;
  const touch = evt.touches?.[0] ?? evt.changedTouches?.[0];
  if (touch && typeof touch.clientX === "number") {
    return { x: touch.clientX, y: touch.clientY };
  }
  if (typeof evt.clientX === "number" && typeof evt.clientY === "number") {
    return { x: evt.clientX, y: evt.clientY };
  }
  return null;
}

/** Minimum on-screen size (CSS px) of a form-field hit target on touch. */
export const MIN_FIELD_HIT_SCREEN_PX = 24;

/**
 * Minimal Fabric-object surface the hit-floor needs (keeps tests light and
 * this module decoupled from the `fabric` package).
 */
export interface HitFloorTarget {
  containsPoint: (point: { x: number; y: number }) => boolean;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  scaleX?: number;
  scaleY?: number;
}

/**
 * On COARSE pointers, widen the hit detection of `obj` (a form-field
 * hit-target rect) to at least `minScreenPx` on screen, centred on the widget.
 * The VISUAL rect is untouched — only `containsPoint` (Fabric target finding)
 * is wrapped. No-op on fine pointers so dense desktop forms keep precise hits.
 *
 * `getZoom` is read at HIT time (scene units = screen px / zoom), so the
 * floor follows live zoom changes.
 */
export function installFormFieldHitFloor(
  obj: HitFloorTarget,
  getZoom: () => number,
  minScreenPx: number = MIN_FIELD_HIT_SCREEN_PX,
): void {
  if (!isCoarsePointer()) return;
  const baseContains = obj.containsPoint.bind(obj);
  obj.containsPoint = (point: { x: number; y: number }): boolean => {
    if (baseContains(point)) return true;
    const zoom = getZoom() || 1;
    const minScene = minScreenPx / zoom;
    const w = (obj.width ?? 0) * (obj.scaleX ?? 1);
    const h = (obj.height ?? 0) * (obj.scaleY ?? 1);
    const padX = Math.max(0, (minScene - w) / 2);
    const padY = Math.max(0, (minScene - h) / 2);
    if (padX <= 0 && padY <= 0) return false;
    const left = obj.left ?? 0;
    const top = obj.top ?? 0;
    return (
      point.x >= left - padX &&
      point.x <= left + w + padX &&
      point.y >= top - padY &&
      point.y <= top + h + padY
    );
  };
}
