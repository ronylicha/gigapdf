/**
 * page-render-pool.ts
 *
 * Recycling pool of `fabric.Canvas` instances + a single shared PDF renderer,
 * for the Word-like continuous editor view where many pages are mounted at once.
 *
 * Two scarce resources are pooled here:
 *
 *  1. **Fabric canvases** — building a `fabric.Canvas` is expensive and each one
 *     holds a `<canvas>` + its 2D context. The pool keeps a hard cap of
 *     `maxLive` live instances and recycles released ones via an LRU free-list,
 *     disposing the least-recently-used canvas when the cap is exceeded.
 *
 *  2. **The PDF background renderer** — ONE {@link PDFRenderer} (one shared
 *     GigaPDF engine / `GigaPdfDoc`) rasterises every page. Backgrounds are
 *     memoised per `(pageIndex, scaleBucket)` so scrolling back to a page reuses
 *     the already-rendered PNG instead of re-rasterising.
 *
 * The class is deliberately framework-agnostic (no React) and fully injectable
 * — the Fabric module, the `<canvas>` factory and the renderer factory can all
 * be supplied, so it is unit-testable without a DOM or the wasm engine.
 *
 * @example
 *   const pool = new PageRenderPool({ pdfBytes });
 *   const canvas = await pool.acquire(0, canvasEl);
 *   const dataUrl = await pool.renderBackground(0, 2);
 *   // ... render the page ...
 *   pool.release(0);
 *   pool.dispose(); // on teardown
 */

import type { Canvas as FabricCanvas } from "fabric";
import type * as FabricNamespace from "fabric";
import { PDFRenderer } from "@giga-pdf/canvas";
import { clientLogger } from "@/lib/client-logger";

type FabricModule = typeof FabricNamespace;

/**
 * The subset of {@link PDFRenderer} the pool depends on. Typing against this
 * structural interface (rather than the class) keeps the pool decoupled from
 * the concrete renderer and lets tests inject a lightweight stub.
 */
export interface SharedRenderer {
  loadDocument(source: ArrayBuffer | Uint8Array): Promise<void>;
  renderPageToDataURL(
    pageNumber: number,
    options?: { scale?: number; skipText?: boolean; excludeIndices?: number[] },
  ): Promise<string>;
  dispose(): void;
}

/** Hard cap of simultaneously live `fabric.Canvas` instances. */
export const DEFAULT_MAX_LIVE = 12;

/**
 * Rounding granularity for the background memo cache key. Render scale derives
 * from `devicePixelRatio`, which can jitter by tiny fractions; bucketing to two
 * decimals keeps the cache hot without producing visibly different bitmaps.
 */
const SCALE_BUCKET_PRECISION = 100;

/** Minimal `fabric.Canvas` surface the pool relies on (keeps tests light). */
interface PoolableFabricCanvas {
  clear: () => void;
  dispose: () => void | Promise<void>;
  getElement?: () => HTMLCanvasElement | undefined;
}

export interface PageRenderPoolOptions {
  /** Raw PDF bytes; the shared renderer opens these once on first background render. */
  pdfBytes?: ArrayBuffer | Uint8Array;
  /** Max live `fabric.Canvas` instances before LRU eviction. Default {@link DEFAULT_MAX_LIVE}. */
  maxLive?: number;
  /**
   * Fabric module override (injected in tests). When omitted, the real module
   * is dynamically imported on first {@link acquire} — keeps SSR/bundlers happy.
   */
  fabric?: FabricModule;
  /**
   * PDF renderer factory override (injected in tests). Defaults to a real
   * {@link PDFRenderer}. The returned object must expose `loadDocument`,
   * `renderPageToDataURL` and `dispose`.
   */
  createRenderer?: () => SharedRenderer;
}

interface PoolEntry {
  canvas: FabricCanvas;
  /** Monotonic tick of the last `acquire`/`release` — drives LRU ordering. */
  lastUsed: number;
}

/**
 * Pool of recyclable Fabric canvases plus a shared, memoised PDF renderer.
 *
 * All array/map indexing is guarded for `noUncheckedIndexedAccess`.
 */
export class PageRenderPool {
  private readonly maxLive: number;
  private readonly createRenderer: () => SharedRenderer;

  /** Injected or lazily-imported Fabric module. */
  private fabric: FabricModule | null;

  /** Live canvases currently bound to a page index. */
  private readonly live = new Map<number, PoolEntry>();
  /** Released canvases available for reuse (LRU: oldest first). */
  private readonly freeList: FabricCanvas[] = [];

  /** Shared renderer (one GigaPdfDoc); created lazily on first background render. */
  private renderer: SharedRenderer | null = null;
  private rendererLoad: Promise<void> | null = null;
  /**
   * Raw PDF bytes backing the shared renderer. Mutable: {@link replaceBytes}
   * swaps it in place after a content bake so the SAME pool re-rasterises only
   * the changed pages, without tearing down its live/recycled canvases.
   */
  private pdfBytes: ArrayBuffer | Uint8Array | undefined;

  /** Memoised page backgrounds keyed by `${index}@${scaleBucket}`. */
  private readonly bgCache = new Map<string, Promise<string>>();

  /** Monotonic clock for LRU bookkeeping. */
  private tick = 0;
  private disposed = false;

  constructor(options: PageRenderPoolOptions = {}) {
    this.maxLive = Math.max(1, options.maxLive ?? DEFAULT_MAX_LIVE);
    this.pdfBytes = options.pdfBytes;
    this.fabric = options.fabric ?? null;
    this.createRenderer = options.createRenderer ?? (() => new PDFRenderer());
  }

  /** Number of canvases currently bound to a page. */
  get liveCount(): number {
    return this.live.size;
  }

  /** Number of recycled canvases waiting to be reused. */
  get freeCount(): number {
    return this.freeList.length;
  }

  /**
   * Acquire a `fabric.Canvas` for `index`, bound to the DOM `el`.
   *
   * Returns the existing canvas if `index` is already live (just refreshing its
   * LRU stamp). Otherwise reuses a recycled instance from the free-list, or
   * creates a new one — evicting the least-recently-used live canvas first when
   * the `maxLive` cap is reached.
   */
  async acquire(index: number, el: HTMLCanvasElement): Promise<FabricCanvas> {
    if (this.disposed) {
      throw new Error("PageRenderPool: acquire after dispose");
    }

    const existing = this.live.get(index);
    if (existing) {
      existing.lastUsed = this.nextTick();
      return existing.canvas;
    }

    const fabric = await this.ensureFabric();

    // Make room before allocating so we never exceed the cap.
    if (this.live.size >= this.maxLive) {
      this.evictLeastRecentlyUsed();
    }

    const recycled = this.freeList.shift();
    // `allowTouchScrolling: true` — les pages INACTIVES du mode continu
    // couvrent l'essentiel de la surface tactile : sans ce flag, Fabric pose
    // touch-action:none + preventDefault sur chaque touchstart/touchmove et le
    // scroll au doigt est mort partout sauf dans les gouttières entre pages.
    const canvas: FabricCanvas =
      recycled ??
      (new fabric.Canvas(el, {
        allowTouchScrolling: true,
      }) as unknown as FabricCanvas);

    // A recycled canvas is bound to its original element; the host re-mounts a
    // fresh <canvas> per page, so rebind the recycled instance to `el`.
    if (recycled) {
      this.rebind(recycled, el);
    }

    this.live.set(index, { canvas, lastUsed: this.nextTick() });
    return canvas;
  }

  /**
   * Release the canvas bound to `index`: clear its objects and recycle the
   * `fabric.Canvas` instance onto the free-list for reuse. No-op if `index`
   * is not live.
   */
  release(index: number): void {
    const entry = this.live.get(index);
    if (!entry) {
      return;
    }
    this.live.delete(index);
    this.recycle(entry.canvas);
  }

  /**
   * Rasterise the PDF background of `index` (0-based page) at `scale`, memoised
   * per `(index, scaleBucket)`. All pages share ONE renderer / GigaPdfDoc.
   *
   * @param index 0-based page index (the renderer is 1-indexed; converted here).
   */
  renderBackground(index: number, scale: number): Promise<string> {
    if (this.disposed) {
      return Promise.reject(new Error("PageRenderPool: renderBackground after dispose"));
    }
    const key = this.bgKey(index, scale);
    const cached = this.bgCache.get(key);
    if (cached) {
      return cached;
    }

    const pending = this.ensureRenderer()
      .then(() => {
        const renderer = this.renderer;
        if (!renderer) {
          throw new Error("PageRenderPool: renderer unavailable");
        }
        // Full raster WITH text: inactive pages render the complete page bitmap
        // (read-only, cheap, pixel-perfect). The ACTIVE page is rendered by an
        // embedded <EditorCanvas> instead (which draws its own text-free
        // background + real editable text overlay), so only inactive pages use
        // this pool background — they must show their text.
        return renderer.renderPageToDataURL(index + 1, { scale });
      })
      .catch((err: unknown) => {
        // Drop the failed promise from the cache so a later attempt can retry,
        // then re-throw for the caller.
        this.bgCache.delete(key);
        throw err;
      });

    this.bgCache.set(key, pending);
    return pending;
  }

  /**
   * Swap the backing PDF bytes in place after a CONTENT bake (same page
   * structure), so the SAME pool keeps serving — only the changed pages
   * re-rasterise.
   *
   * Unlike rebuilding the pool, this never touches the live canvases or the
   * free-list (no `<PageSlot>` unmounts, the active page's editing session is
   * preserved). It:
   *   1. installs the new `bytes` as the renderer source;
   *   2. disposes the current renderer/doc and clears the load latch, forcing a
   *      lazy reload against the new bytes on the next {@link renderBackground};
   *   3. invalidates the memoised backgrounds ONLY for `changedIndices` (keys
   *      `${i}@…`) — unchanged pages keep their bitmaps (zero re-raster). When
   *      `changedIndices` is omitted, the whole background cache is cleared.
   *
   * No-op once {@link dispose}d.
   *
   * @param bytes Replacement PDF bytes (the freshly-baked binary).
   * @param changedIndices 0-based indices of the pages whose content changed.
   */
  replaceBytes(
    bytes: ArrayBuffer | Uint8Array,
    changedIndices?: number[],
  ): void {
    if (this.disposed) {
      return;
    }
    this.pdfBytes = bytes;

    // Drop the current renderer + load latch so the next background render
    // re-opens the document against the NEW bytes (lazy reload). Live canvases
    // and the free-list are deliberately left intact.
    try {
      this.renderer?.dispose();
    } catch (err) {
      clientLogger.warn(
        "[PageRenderPool] renderer dispose during replaceBytes failed:",
        err,
      );
    }
    this.renderer = null;
    this.rendererLoad = null;

    if (changedIndices && changedIndices.length > 0) {
      const changed = new Set(changedIndices);
      for (const key of Array.from(this.bgCache.keys())) {
        const at = key.indexOf("@");
        const idx = Number(at >= 0 ? key.slice(0, at) : key);
        if (changed.has(idx)) {
          this.bgCache.delete(key);
        }
      }
    } else {
      this.bgCache.clear();
    }
  }

  /**
   * Dispose every pooled resource: live + recycled canvases and the shared
   * renderer. The pool must not be used afterwards.
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    for (const entry of this.live.values()) {
      this.safeDispose(entry.canvas);
    }
    this.live.clear();

    for (const canvas of this.freeList) {
      this.safeDispose(canvas);
    }
    this.freeList.length = 0;

    this.bgCache.clear();

    try {
      this.renderer?.dispose();
    } catch (err) {
      clientLogger.warn("[PageRenderPool] renderer dispose failed:", err);
    }
    this.renderer = null;
    this.rendererLoad = null;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private nextTick(): number {
    this.tick += 1;
    return this.tick;
  }

  private bgKey(index: number, scale: number): string {
    const bucket = Math.round(scale * SCALE_BUCKET_PRECISION) / SCALE_BUCKET_PRECISION;
    return `${index}@${bucket}`;
  }

  private async ensureFabric(): Promise<FabricModule> {
    if (!this.fabric) {
      this.fabric = (await import("fabric")) as unknown as FabricModule;
    }
    return this.fabric;
  }

  /** Lazily create + load the shared renderer (idempotent across concurrent calls). */
  private ensureRenderer(): Promise<void> {
    if (this.rendererLoad) {
      return this.rendererLoad;
    }
    if (!this.pdfBytes) {
      return Promise.reject(
        new Error("PageRenderPool: no pdfBytes provided for background rendering"),
      );
    }
    const renderer = this.createRenderer();
    this.renderer = renderer;
    // `pdfBytes` is narrowed to non-undefined above; capture for the closure.
    const bytes = this.pdfBytes;
    const load = renderer.loadDocument(bytes).catch((err: unknown) => {
      // Reset so a future render can retry the load.
      this.renderer = null;
      this.rendererLoad = null;
      throw err;
    });
    this.rendererLoad = load;
    return load;
  }

  /** Evict (dispose) the live canvas with the smallest `lastUsed`. */
  private evictLeastRecentlyUsed(): void {
    let victimIndex: number | null = null;
    let victimUsed = Number.POSITIVE_INFINITY;
    for (const [index, entry] of this.live) {
      if (entry.lastUsed < victimUsed) {
        victimUsed = entry.lastUsed;
        victimIndex = index;
      }
    }
    if (victimIndex === null) {
      return;
    }
    const victim = this.live.get(victimIndex);
    this.live.delete(victimIndex);
    if (victim) {
      this.safeDispose(victim.canvas);
    }
  }

  /** Clear a canvas and push it onto the free-list for reuse. */
  private recycle(canvas: FabricCanvas): void {
    try {
      (canvas as unknown as PoolableFabricCanvas).clear();
    } catch (err) {
      // A canvas that cannot be cleared is unsafe to reuse — drop it.
      clientLogger.warn("[PageRenderPool] clear failed, dropping canvas:", err);
      this.safeDispose(canvas);
      return;
    }
    this.freeList.push(canvas);
  }

  /**
   * Rebind a recycled `fabric.Canvas` to a freshly-mounted `<canvas>` element.
   * Fabric does not expose a public re-target API; we swap the lower/upper
   * element references it keeps internally. Best-effort — if the internals
   * shift in a future Fabric, the recycled canvas is dropped rather than reused.
   */
  private rebind(canvas: FabricCanvas, el: HTMLCanvasElement): void {
    try {
      const withEl = canvas as unknown as {
        lowerCanvasEl?: HTMLCanvasElement;
        setDimensions?: (d: { width: number; height: number }) => void;
      };
      if (withEl.lowerCanvasEl && withEl.lowerCanvasEl !== el) {
        // Replace the live <canvas> node in the DOM and the Fabric reference so
        // the recycled context draws onto the host's element.
        el.replaceWith(withEl.lowerCanvasEl);
      }
    } catch (err) {
      clientLogger.warn("[PageRenderPool] rebind failed:", err);
    }
  }

  private safeDispose(canvas: FabricCanvas): void {
    try {
      void (canvas as unknown as PoolableFabricCanvas).dispose();
    } catch (err) {
      clientLogger.warn("[PageRenderPool] dispose failed:", err);
    }
  }
}
