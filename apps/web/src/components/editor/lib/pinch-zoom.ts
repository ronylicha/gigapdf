/**
 * pinch-zoom.ts
 *
 * Framework-agnostic two-finger pinch-to-zoom tracker (mobile lot 2).
 *
 * Tracks TOUCH pointers (Pointer Events, `Map<pointerId, {x,y}>`) on a host
 * element. When two touch pointers are down, every move computes
 * `zoom = startZoom × (distance / startDistance)`, clamped to
 * `[minZoom, maxZoom]`, and reports it with the CLIENT-coordinate midpoint so
 * the caller can anchor the zoom on the fingers (single-page mode →
 * `applyZoomAtClientPoint`; continuous mode → store `setZoom` + scroll
 * compensation).
 *
 * While a pinch is active, a non-passive `touchmove` listener calls
 * `preventDefault()` so the browser's native two-finger pan (allowed by
 * `touch-action: pan-x pan-y`) does not fight the zoom. Mouse/pen pointers
 * are ignored entirely — desktop behaviour is untouched.
 *
 * The attach function returns a cleanup that removes every listener.
 */

export interface PinchZoomOptions {
  /** Current zoom factor — sampled when the second finger lands. */
  getZoom: () => number;
  minZoom: number;
  maxZoom: number;
  /**
   * Fired on every pinch move with the clamped zoom and the midpoint of the
   * two fingers in CLIENT coordinates.
   */
  onPinchZoom: (zoom: number, center: { x: number; y: number }) => void;
  /** Fired once when the second touch pointer lands (pinch begins). */
  onPinchStart?: () => void;
  /** Fired once when fewer than two touch pointers remain (pinch ends). */
  onPinchEnd?: () => void;
}

interface TrackedPoint {
  x: number;
  y: number;
}

function distance(points: Iterable<TrackedPoint>): number {
  const [a, b] = [...points];
  if (!a || !b) return 0;
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function midpoint(points: Iterable<TrackedPoint>): { x: number; y: number } {
  const [a, b] = [...points];
  if (!a || !b) return { x: a?.x ?? 0, y: a?.y ?? 0 };
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Attach pinch-to-zoom tracking on `el`. Returns a detach function.
 */
export function attachPinchZoom(
  el: HTMLElement,
  options: PinchZoomOptions,
): () => void {
  const pointers = new Map<number, TrackedPoint>();
  let pinching = false;
  let startDistance = 0;
  let startZoom = 1;

  const clamp = (zoom: number): number =>
    Math.min(options.maxZoom, Math.max(options.minZoom, zoom));

  const onPointerDown = (e: PointerEvent) => {
    // Touch only: a pinch is a two-FINGER gesture. Mouse/pen never pinch and
    // must keep their existing behaviour (selection drags, middle-click pan…).
    if (e.pointerType !== "touch") return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!pinching && pointers.size === 2) {
      pinching = true;
      startDistance = distance(pointers.values());
      startZoom = options.getZoom() || 1;
      options.onPinchStart?.();
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!pinching || pointers.size < 2 || startDistance <= 0) return;
    const dist = distance(pointers.values());
    if (dist <= 0) return;
    const next = clamp(startZoom * (dist / startDistance));
    options.onPinchZoom(next, midpoint(pointers.values()));
  };

  const onPointerEnd = (e: PointerEvent) => {
    if (!pointers.delete(e.pointerId)) return;
    if (pinching && pointers.size < 2) {
      pinching = false;
      startDistance = 0;
      options.onPinchEnd?.();
    }
  };

  // Neutralise native scrolling for the duration of the gesture. Must be
  // non-passive: `touch-action: pan-x pan-y` still allows a two-finger PAN,
  // which would scroll underneath the zoom without this guard.
  const onTouchMove = (e: TouchEvent) => {
    if (pinching && e.cancelable) {
      e.preventDefault();
    }
  };

  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointermove", onPointerMove);
  el.addEventListener("pointerup", onPointerEnd);
  el.addEventListener("pointercancel", onPointerEnd);
  el.addEventListener("touchmove", onTouchMove, { passive: false });

  return () => {
    el.removeEventListener("pointerdown", onPointerDown);
    el.removeEventListener("pointermove", onPointerMove);
    el.removeEventListener("pointerup", onPointerEnd);
    el.removeEventListener("pointercancel", onPointerEnd);
    el.removeEventListener("touchmove", onTouchMove);
    pointers.clear();
    pinching = false;
  };
}
