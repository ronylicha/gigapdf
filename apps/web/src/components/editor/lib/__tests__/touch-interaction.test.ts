/**
 * touch-interaction.test.ts
 *
 * Tactile helpers (mobile lot 2):
 * - per-tool touch-action mapping (draw tools block scroll, navigation pans);
 * - Fabric allowTouchScrolling mirror of that mapping;
 * - client-point normalisation (raw TouchEvent → touches[0], no NaN — the
 *   "hand" tool pan bug);
 * - coarse-pointer probes are SSR/jsdom-safe and desktop-neutral;
 * - form-field hit floor: widens containsPoint to ≥24 px ON SCREEN on coarse
 *   pointers only, following live zoom, without touching the visual rect.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import type { Tool } from "@giga-pdf/types";
import {
  DRAW_INTENT_TOOLS,
  touchActionForTool,
  allowTouchScrollingForTool,
  isCoarsePointer,
  coarseControlProps,
  clientPointFromEvent,
  installFormFieldHitFloor,
  MIN_FIELD_HIT_SCREEN_PX,
  TOUCH_CORNER_SIZE,
  type HitFloorTarget,
} from "../touch-interaction";

/** Install a matchMedia stub answering `matches` for `(pointer: coarse)`. */
function stubPointer(coarse: boolean): void {
  (window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia =
    vi.fn((query: string) => ({
      matches: coarse && query === "(pointer: coarse)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  // jsdom has no matchMedia by default — restore that baseline.
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
});

describe("touchActionForTool", () => {
  it("blocks scrolling for every draw-intent tool (the finger draws)", () => {
    for (const tool of DRAW_INTENT_TOOLS) {
      expect(touchActionForTool(tool)).toBe("none");
    }
  });

  it("keeps native panning for navigation tools and unknown/absent tools", () => {
    for (const tool of ["select", "hand", "fill_sign", "image", "zoom"] as Tool[]) {
      expect(touchActionForTool(tool)).toBe("pan-x pan-y");
    }
    expect(touchActionForTool(undefined)).toBe("pan-x pan-y");
    expect(touchActionForTool(null)).toBe("pan-x pan-y");
  });

  it("allowTouchScrollingForTool mirrors the mapping (Fabric-side gate)", () => {
    expect(allowTouchScrollingForTool("draw")).toBe(false);
    expect(allowTouchScrollingForTool("shape")).toBe(false);
    expect(allowTouchScrollingForTool("select")).toBe(true);
    expect(allowTouchScrollingForTool("hand")).toBe(true);
    expect(allowTouchScrollingForTool(undefined)).toBe(true);
  });
});

describe("clientPointFromEvent", () => {
  it("reads touches[0] from a TouchEvent-like payload (no NaN pan)", () => {
    const fakeTouchEvent = {
      touches: [{ clientX: 42, clientY: 84 }],
      // clientX/clientY are UNDEFINED on real TouchEvents — the old pan code
      // read them and NaN-poisoned the scroll math.
      preventDefault: () => {},
    };
    expect(clientPointFromEvent(fakeTouchEvent)).toEqual({ x: 42, y: 84 });
  });

  it("falls back to changedTouches when touches is empty (touchend)", () => {
    const fakeTouchEnd = {
      touches: [] as { clientX: number; clientY: number }[],
      changedTouches: [{ clientX: 7, clientY: 9 }],
    };
    expect(clientPointFromEvent(fakeTouchEnd)).toEqual({ x: 7, y: 9 });
  });

  it("reads clientX/clientY from mouse/pointer events", () => {
    expect(clientPointFromEvent({ clientX: 10, clientY: 20 })).toEqual({
      x: 10,
      y: 20,
    });
  });

  it("returns null for unusable payloads instead of NaN", () => {
    expect(clientPointFromEvent(null)).toBeNull();
    expect(clientPointFromEvent({})).toBeNull();
    expect(clientPointFromEvent({ touches: [] })).toBeNull();
  });
});

describe("coarse-pointer probes", () => {
  it("is fine-pointer (desktop) by default in jsdom — zero visual change", () => {
    expect(isCoarsePointer()).toBe(false);
    expect(coarseControlProps()).toEqual({});
  });

  it("returns enlarged touch handles on coarse pointers", () => {
    stubPointer(true);
    expect(isCoarsePointer()).toBe(true);
    expect(coarseControlProps()).toEqual({
      touchCornerSize: TOUCH_CORNER_SIZE,
      padding: expect.any(Number),
    });
    expect(TOUCH_CORNER_SIZE).toBeGreaterThanOrEqual(28);
  });
});

describe("installFormFieldHitFloor", () => {
  function makeRect(w: number, h: number): HitFloorTarget & {
    baseCalls: Array<{ x: number; y: number }>;
  } {
    const baseCalls: Array<{ x: number; y: number }> = [];
    return {
      left: 100,
      top: 100,
      width: w,
      height: h,
      scaleX: 1,
      scaleY: 1,
      baseCalls,
      containsPoint(point: { x: number; y: number }) {
        baseCalls.push(point);
        const left = this.left ?? 0;
        const top = this.top ?? 0;
        return (
          point.x >= left &&
          point.x <= left + (this.width ?? 0) &&
          point.y >= top &&
          point.y <= top + (this.height ?? 0)
        );
      },
    };
  }

  it("no-ops on fine pointers (desktop hit precision preserved)", () => {
    const rect = makeRect(10, 10);
    const original = rect.containsPoint;
    installFormFieldHitFloor(rect, () => 1);
    expect(rect.containsPoint).toBe(original);
  });

  it("floors a tiny widget's hit area to MIN_FIELD_HIT_SCREEN_PX on coarse", () => {
    stubPointer(true);
    const rect = makeRect(10, 10); // 10×10 scene units at zoom 1 → 10 px screen
    installFormFieldHitFloor(rect, () => 1);
    // Widget centre is (105,105); the 24 px floor spans [93,117] on each axis.
    expect(rect.containsPoint({ x: 105, y: 105 })).toBe(true); // inside rect
    expect(rect.containsPoint({ x: 115, y: 105 })).toBe(true); // in the floor pad
    expect(rect.containsPoint({ x: 94, y: 116 })).toBe(true); // floor corner
    expect(rect.containsPoint({ x: 92, y: 105 })).toBe(false); // beyond floor
    expect(rect.containsPoint({ x: 105, y: 118 })).toBe(false); // beyond floor
    expect(MIN_FIELD_HIT_SCREEN_PX).toBe(24);
  });

  it("follows live zoom: the floor is a SCREEN size, not a scene size", () => {
    stubPointer(true);
    const rect = makeRect(10, 10);
    let zoom = 2; // 10 scene units → 20 px screen → floor pads 4px/2=2 scene units
    installFormFieldHitFloor(rect, () => zoom);
    // minScene = 24/2 = 12 → pad = (12-10)/2 = 1 scene unit.
    expect(rect.containsPoint({ x: 99.5, y: 105 })).toBe(true);
    expect(rect.containsPoint({ x: 98, y: 105 })).toBe(false);
    // Zoomed IN far enough the widget is already ≥24 px on screen → no pad.
    zoom = 4;
    expect(rect.containsPoint({ x: 99.5, y: 105 })).toBe(false);
  });

  it("never shrinks a widget already larger than the floor", () => {
    stubPointer(true);
    const rect = makeRect(200, 40);
    installFormFieldHitFloor(rect, () => 1);
    expect(rect.containsPoint({ x: 150, y: 120 })).toBe(true); // inside
    expect(rect.containsPoint({ x: 301, y: 120 })).toBe(false); // just outside
  });
});
