/**
 * continuous-page-view-pinch.test.tsx
 *
 * Tactile contract of the continuous scroller (mobile lot 2):
 * - two TOUCH pointers on the scroll root drive a MANUAL zoom via
 *   `onManualZoomChange` (page.tsx: setFitMode(null) + setZoom), clamped to
 *   the shared [0.1, 8] bounds;
 * - after the re-layout at the new zoom, the scroll position is re-projected
 *   so the content point under the fingers stays under the fingers
 *   (slot + fraction anchoring);
 * - the scroll root carries `overscroll-contain` and a tool-conditioned
 *   `touch-action` (draw tools → none; navigation → pan-x pan-y).
 *
 * Same inert harness as continuous-page-view-fit.test.tsx.
 */
import React, { useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import type { PageObject } from "@giga-pdf/types";

vi.mock("../page-slot", async () => {
  const ReactMod = await import("react");
  const PageSlot = (props: { page: { pageId: string } }) =>
    ReactMod.createElement("div", {
      "data-testid": `slot-${props.page.pageId}`,
    });
  return { PageSlot };
});

vi.mock("../lib/page-render-pool", () => {
  class FakePageRenderPool {
    replaceBytes() {}
    dispose() {}
  }
  return { PageRenderPool: FakePageRenderPool, DEFAULT_MAX_LIVE: 12 };
});

vi.mock("@giga-pdf/editor", () => ({
  useViewStore: () => ({
    visiblePages: new Set([0, 1, 2, 3]),
    isFastScrolling: false,
    setVisiblePages: () => {},
    setCurrentPageIndex: () => {},
    setScrollTop: () => {},
    setViewport: () => {},
    setFastScrolling: () => {},
  }),
}));

import { ContinuousPageView } from "../continuous-page-view";

class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

beforeEach(() => {
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
    NoopObserver as unknown as typeof IntersectionObserver;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver =
    NoopObserver as unknown as typeof ResizeObserver;
});

afterEach(cleanup);

function makePdfFile(tag: string): File {
  return {
    name: `${tag}.pdf`,
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  } as unknown as File;
}

function makePages(ids: string[]): PageObject[] {
  return ids.map(
    (pageId, i) =>
      ({
        pageId,
        pageNumber: i + 1,
        dimensions: { width: 600, height: 800, rotation: 0 },
      }) as unknown as PageObject,
  );
}

const NOOP = () => {};

function firePointer(
  el: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  opts: { pointerId: number; x: number; y: number },
): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: opts.x,
    clientY: opts.y,
  });
  Object.defineProperty(event, "pointerId", { value: opts.pointerId });
  Object.defineProperty(event, "pointerType", { value: "touch" });
  el.dispatchEvent(event);
}

/** Stateful host mirroring page.tsx: manual zoom feeds the zoom prop back. */
function Host({
  onManualZoomChange,
  tool,
}: {
  onManualZoomChange: (z: number) => void;
  tool?: "select" | "draw";
}) {
  const [zoom, setZoom] = useState(1);
  return (
    <ContinuousPageView
      pages={makePages(["p1"])}
      zoom={zoom}
      pdfFile={makePdfFile("a")}
      activePageIndex={0}
      onActivatePage={NOOP}
      tool={tool ?? "select"}
      onManualZoomChange={(z) => {
        onManualZoomChange(z);
        setZoom(z);
      }}
    />
  );
}

function scrollRootOf(container: HTMLElement): HTMLDivElement {
  const root = container.firstElementChild as HTMLDivElement | null;
  if (!root) throw new Error("scroll root not rendered");
  return root;
}

describe("ContinuousPageView — pinch-to-zoom (touch)", () => {
  it("two touch pointers drive a bounded manual zoom", () => {
    const onManualZoomChange = vi.fn();
    const { container } = render(
      <Host onManualZoomChange={onManualZoomChange} />,
    );
    const root = scrollRootOf(container);

    act(() => {
      firePointer(root, "pointerdown", { pointerId: 1, x: 100, y: 200 });
      firePointer(root, "pointerdown", { pointerId: 2, x: 200, y: 200 });
      // distance 100 → 200 = ×2 from zoom 1.
      firePointer(root, "pointermove", { pointerId: 2, x: 300, y: 200 });
    });
    expect(onManualZoomChange).toHaveBeenLastCalledWith(2);

    act(() => {
      // distance 100 → 2000 = raw ×20 from the ORIGINAL pinch start → clamp 8.
      firePointer(root, "pointermove", { pointerId: 2, x: 2100, y: 200 });
    });
    expect(onManualZoomChange).toHaveBeenLastCalledWith(8);
  });

  it("re-projects the scroll so the anchor stays under the fingers", () => {
    const onManualZoomChange = vi.fn();
    const { container } = render(
      <Host onManualZoomChange={onManualZoomChange} />,
    );
    const root = scrollRootOf(container);
    // jsdom rects are all-zero → the viewport anchor equals client coords.
    root.scrollTop = 0;

    act(() => {
      firePointer(root, "pointerdown", { pointerId: 1, x: 100, y: 200 });
      firePointer(root, "pointerdown", { pointerId: 2, x: 200, y: 200 });
      firePointer(root, "pointermove", { pointerId: 2, x: 300, y: 200 });
    });

    // zoom 1 → 2. Anchor viewY=200, contentY=200; slot@zoom1: top=16 h=800 →
    // frac=(200-16)/800=0.23. slot@zoom2: top=16 h=1600 →
    // scrollTop = 16 + 0.23×1600 − 200 = 184.
    expect(onManualZoomChange).toHaveBeenLastCalledWith(2);
    expect(root.scrollTop).toBeCloseTo(184, 5);
  });

  it("mouse pointers never zoom (desktop untouched)", () => {
    const onManualZoomChange = vi.fn();
    const { container } = render(
      <Host onManualZoomChange={onManualZoomChange} />,
    );
    const root = scrollRootOf(container);

    act(() => {
      const down = (id: number, x: number) => {
        const e = new MouseEvent("pointerdown", {
          bubbles: true,
          clientX: x,
          clientY: 0,
        });
        Object.defineProperty(e, "pointerId", { value: id });
        Object.defineProperty(e, "pointerType", { value: "mouse" });
        root.dispatchEvent(e);
      };
      down(1, 0);
      down(2, 100);
    });
    expect(onManualZoomChange).not.toHaveBeenCalled();
  });
});

describe("ContinuousPageView — tactile scroll root", () => {
  it("carries overscroll-contain and pan touch-action for navigation tools", () => {
    const { container } = render(
      <Host onManualZoomChange={NOOP} tool="select" />,
    );
    const root = scrollRootOf(container);
    expect(root.className).toContain("overscroll-contain");
    expect(root.style.touchAction).toBe("pan-x pan-y");
  });

  it("blocks touch scrolling while a draw tool is active (the finger draws)", () => {
    const { container } = render(<Host onManualZoomChange={NOOP} tool="draw" />);
    const root = scrollRootOf(container);
    expect(root.style.touchAction).toBe("none");
  });
});
