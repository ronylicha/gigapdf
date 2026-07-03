/**
 * continuous-page-view-fit.test.tsx
 *
 * Fit-zoom ↔ container-resize contract (lot 1 — responsive toolbar).
 *
 * The toolbar now WRAPS onto multiple rows, so its height varies with the
 * viewport width; every wrap change resizes the continuous scroller. The
 * fit-zoom effect must therefore recompute the fit zoom whenever the scroll
 * container is resized — which it does through the ResizeObserver it installs
 * on the scroll root (continuous-page-view.tsx, adaptive fit effect).
 *
 * These tests pin that contract with a functional ResizeObserver mock:
 * - fit-width recomputes when the container WIDTH changes;
 * - fit-page recomputes when the container HEIGHT changes (a toolbar row
 *   appearing/disappearing is exactly a height change).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { act } from "@testing-library/react";
import type { PageObject } from "@giga-pdf/types";

// --- Same inert harness as continuous-page-view.test.tsx ---------------------
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

vi.mock("../lib/page-margins", () => ({
  readAllPageMargins: () => Promise.resolve([]),
}));

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

// --- Controllable environment ------------------------------------------------
/** Mutable "container size" read by the clientWidth/clientHeight stubs. */
const containerSize = { width: 964, height: 864 };

/** Functional ResizeObserver: collects callbacks so a test can fire a resize. */
const resizeCallbacks = new Set<() => void>();
class FunctionalResizeObserver {
  private readonly cb: () => void;
  constructor(cb: () => void) {
    this.cb = cb;
    resizeCallbacks.add(cb);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    resizeCallbacks.delete(this.cb);
  }
}
function fireContainerResize(next: Partial<typeof containerSize>) {
  Object.assign(containerSize, next);
  for (const cb of [...resizeCallbacks]) cb();
}

class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

let restoreClientSize: (() => void) | null = null;

beforeEach(() => {
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
    NoopObserver as unknown as typeof IntersectionObserver;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver =
    FunctionalResizeObserver as unknown as typeof ResizeObserver;
  resizeCallbacks.clear();
  containerSize.width = 964;
  containerSize.height = 864;

  // jsdom reports 0 for client sizes — stub them from the mutable container.
  const widthDesc = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientWidth",
  );
  const heightDesc = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientHeight",
  );
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => containerSize.width,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => containerSize.height,
  });
  restoreClientSize = () => {
    if (widthDesc) {
      Object.defineProperty(HTMLElement.prototype, "clientWidth", widthDesc);
    } else {
      delete (HTMLElement.prototype as { clientWidth?: unknown }).clientWidth;
    }
    if (heightDesc) {
      Object.defineProperty(HTMLElement.prototype, "clientHeight", heightDesc);
    } else {
      delete (HTMLElement.prototype as { clientHeight?: unknown }).clientHeight;
    }
  };
});

afterEach(() => {
  cleanup();
  restoreClientSize?.();
  restoreClientSize = null;
});

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
// FIT_PADDING_PX in continuous-page-view.tsx.
const PAD = 32;

describe("ContinuousPageView — fit zoom recomputes on container resize", () => {
  it("fit-width: recomputes when the container width changes", async () => {
    const onFitZoomChange = vi.fn();
    // availW = 964 - 64 = 900 → fit = 900/600 = 1.5 (≠ zoom 1 → pushed).
    render(
      <ContinuousPageView
        pages={makePages(["p1"])}
        zoom={1}
        pdfFile={makePdfFile("a")}
        activePageIndex={0}
        onActivatePage={NOOP}
        fitMode="width"
        onFitZoomChange={onFitZoomChange}
      />,
    );

    await waitFor(() => expect(onFitZoomChange).toHaveBeenCalledWith(1.5));

    // The container width changes (viewport resize): fit must follow.
    // availW = 1264 - 2*PAD = 1200 → fit = 1200/600 = 2.0.
    act(() => {
      fireContainerResize({ width: 1200 + PAD * 2 });
    });
    await waitFor(() => expect(onFitZoomChange).toHaveBeenCalledWith(2));
  });

  it("fit-page: recomputes when the container HEIGHT changes (toolbar wrap)", async () => {
    const onFitZoomChange = vi.fn();
    // availW = 900 (964-64), availH = 800 (864-64):
    // fit-page = min(900/600, 800/800) = 1.0 → equals zoom → NOT pushed yet.
    render(
      <ContinuousPageView
        pages={makePages(["p1"])}
        zoom={1}
        pdfFile={makePdfFile("a")}
        activePageIndex={0}
        onActivatePage={NOOP}
        fitMode="page"
        onFitZoomChange={onFitZoomChange}
      />,
    );
    // Give the mount recompute a tick — it must not push (fit == zoom).
    await waitFor(() =>
      expect(document.querySelector('[data-testid="slot-p1"]')).not.toBeNull(),
    );
    expect(onFitZoomChange).not.toHaveBeenCalled();

    // The toolbar wraps onto an extra row → the scroller LOSES height:
    // availH = 464 - 64 = 400 → fit-page = min(1.5, 0.5) = 0.5.
    act(() => {
      fireContainerResize({ height: 464 });
    });
    await waitFor(() => expect(onFitZoomChange).toHaveBeenCalledWith(0.5));
  });
});
