/**
 * pinch-zoom.test.ts
 *
 * App-level pinch-to-zoom tracker (mobile lot 2). jsdom has no synthetic
 * multi-touch, so pointer events are hand-built MouseEvents with
 * pointerId/pointerType stamped on — exactly the fields the tracker reads.
 *
 * Pinned contract:
 * - two TOUCH pointers spreading apart → onPinchZoom(startZoom×ratio, midpoint);
 * - the zoom is clamped to [minZoom, maxZoom];
 * - mouse pointers never start a pinch (desktop untouched);
 * - lifting a finger ends the pinch (onPinchEnd) and further moves are inert;
 * - detach removes every listener.
 */
import { describe, it, expect, vi } from "vitest";
import { attachPinchZoom, type PinchZoomOptions } from "../pinch-zoom";

function firePointer(
  el: HTMLElement,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  opts: { pointerId: number; x: number; y: number; pointerType?: string },
): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: opts.x,
    clientY: opts.y,
  });
  Object.defineProperty(event, "pointerId", { value: opts.pointerId });
  Object.defineProperty(event, "pointerType", {
    value: opts.pointerType ?? "touch",
  });
  el.dispatchEvent(event);
}

function setup(overrides: Partial<PinchZoomOptions> = {}) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const onPinchZoom = vi.fn();
  const onPinchStart = vi.fn();
  const onPinchEnd = vi.fn();
  const detach = attachPinchZoom(el, {
    getZoom: () => 1,
    minZoom: 0.1,
    maxZoom: 8,
    onPinchZoom,
    onPinchStart,
    onPinchEnd,
    ...overrides,
  });
  return { el, onPinchZoom, onPinchStart, onPinchEnd, detach };
}

describe("attachPinchZoom", () => {
  it("reports the scaled zoom anchored on the finger midpoint", () => {
    const { el, onPinchZoom, onPinchStart, detach } = setup();

    firePointer(el, "pointerdown", { pointerId: 1, x: 100, y: 200 });
    firePointer(el, "pointerdown", { pointerId: 2, x: 200, y: 200 });
    expect(onPinchStart).toHaveBeenCalledTimes(1);

    // Spread: distance 100 → 200 = ratio 2 → zoom 1×2 = 2, midpoint (200,200).
    firePointer(el, "pointermove", { pointerId: 2, x: 300, y: 200 });
    expect(onPinchZoom).toHaveBeenLastCalledWith(2, { x: 200, y: 200 });

    detach();
  });

  it("clamps the zoom to [minZoom, maxZoom]", () => {
    const { el, onPinchZoom, detach } = setup();

    firePointer(el, "pointerdown", { pointerId: 1, x: 100, y: 100 });
    firePointer(el, "pointerdown", { pointerId: 2, x: 110, y: 100 });

    // Distance 10 → 1000: raw ratio 100 → clamped at maxZoom 8.
    firePointer(el, "pointermove", { pointerId: 2, x: 1100, y: 100 });
    expect(onPinchZoom).toHaveBeenLastCalledWith(8, expect.anything());

    // Distance 10 → 0.5: raw ratio 0.05 → clamped at minZoom 0.1.
    firePointer(el, "pointermove", { pointerId: 2, x: 100.5, y: 100 });
    expect(onPinchZoom).toHaveBeenLastCalledWith(0.1, expect.anything());

    detach();
  });

  it("starts from the CURRENT zoom when the second finger lands", () => {
    const { el, onPinchZoom, detach } = setup({ getZoom: () => 2 });

    firePointer(el, "pointerdown", { pointerId: 1, x: 0, y: 0 });
    firePointer(el, "pointerdown", { pointerId: 2, x: 100, y: 0 });
    firePointer(el, "pointermove", { pointerId: 2, x: 150, y: 0 });
    // 2 × (150/100) = 3.
    expect(onPinchZoom).toHaveBeenLastCalledWith(3, expect.anything());

    detach();
  });

  it("ignores mouse pointers entirely (desktop drags untouched)", () => {
    const { el, onPinchZoom, onPinchStart, detach } = setup();

    firePointer(el, "pointerdown", { pointerId: 1, x: 0, y: 0, pointerType: "mouse" });
    firePointer(el, "pointerdown", { pointerId: 2, x: 100, y: 0, pointerType: "mouse" });
    firePointer(el, "pointermove", { pointerId: 2, x: 300, y: 0, pointerType: "mouse" });

    expect(onPinchStart).not.toHaveBeenCalled();
    expect(onPinchZoom).not.toHaveBeenCalled();

    detach();
  });

  it("ends the pinch when a finger lifts; later moves are inert", () => {
    const { el, onPinchZoom, onPinchEnd, detach } = setup();

    firePointer(el, "pointerdown", { pointerId: 1, x: 0, y: 0 });
    firePointer(el, "pointerdown", { pointerId: 2, x: 100, y: 0 });
    firePointer(el, "pointerup", { pointerId: 1, x: 0, y: 0 });
    expect(onPinchEnd).toHaveBeenCalledTimes(1);

    onPinchZoom.mockClear();
    firePointer(el, "pointermove", { pointerId: 2, x: 500, y: 0 });
    expect(onPinchZoom).not.toHaveBeenCalled();

    detach();
  });

  it("treats pointercancel like pointerup (browser claimed the gesture)", () => {
    const { el, onPinchEnd, detach } = setup();

    firePointer(el, "pointerdown", { pointerId: 1, x: 0, y: 0 });
    firePointer(el, "pointerdown", { pointerId: 2, x: 100, y: 0 });
    firePointer(el, "pointercancel", { pointerId: 2, x: 100, y: 0 });
    expect(onPinchEnd).toHaveBeenCalledTimes(1);

    detach();
  });

  it("detach removes the listeners", () => {
    const { el, onPinchZoom, onPinchStart, detach } = setup();
    detach();

    firePointer(el, "pointerdown", { pointerId: 1, x: 0, y: 0 });
    firePointer(el, "pointerdown", { pointerId: 2, x: 100, y: 0 });
    firePointer(el, "pointermove", { pointerId: 2, x: 300, y: 0 });

    expect(onPinchStart).not.toHaveBeenCalled();
    expect(onPinchZoom).not.toHaveBeenCalled();
  });
});
