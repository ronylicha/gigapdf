"use client";

/**
 * continuous-page-view.tsx
 *
 * The Word-like CONTINUOUS, VIRTUALISED multi-page scroller. Every page in the
 * document is stacked vertically in ONE scroll view, but only the pages inside
 * the viewport (plus a buffer band) actually mount a Fabric canvas — the rest
 * are pre-sized DOM placeholders. This keeps a 100+ page document scrolling
 * smoothly: at most a handful of canvases are live (bounded further by the
 * pool's `maxLive` cap).
 *
 * Windowing mechanics:
 *   - `computePageLayout(pages, zoom)` gives each page a fixed vertical slot
 *     (top/height/width). A `position:relative` content div of `totalHeight`
 *     holds the absolutely-positioned slots → the scrollbar is correct and the
 *     content never reflows when pages mount/unmount.
 *   - ONE `IntersectionObserver` (root = the scroll element, `rootMargin` = a
 *     ~2-page buffer band) watches a zero-cost sentinel per page. Intersecting
 *     sentinels — already widened by the buffer band — drive
 *     `viewStore.visiblePages`. Only those pages render a canvas.
 *   - A rAF-throttled scroll handler maps the scroll position to the page in
 *     focus (`pageIndexAtScroll`) → `viewStore.currentPageIndex` (the indicator)
 *     and detects fling velocity → `viewStore.isFastScrolling` (suppresses
 *     canvas hydration mid-fling, hydrates on settle ~120 ms later).
 *
 * Active page: clicking into a page sets it active (`onActivatePage`); the
 * active page renders a real embedded `<EditorCanvas>` (full editing), while the
 * other in-window pages render cheap read-only bitmaps.
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useShallow } from "zustand/react/shallow";
import type {
  PageObject,
  Element,
  Bounds,
  Tool,
  TextStyle,
  ShapeType,
  AnnotationType,
  FieldCreationKind,
  FormFieldElement,
} from "@giga-pdf/types";
import { useViewStore } from "@giga-pdf/editor";
import { clientLogger } from "@/lib/client-logger";
import { PageSlot } from "./page-slot";
import type { EditorCanvasHandle } from "./editor-canvas";
import { PageRenderPool } from "./lib/page-render-pool";
import {
  computePageLayout,
  effectivePagePoints,
  pageIndexAtScroll,
} from "./lib/page-layout";
import type { PageMargins } from "./lib/page-margins";
import type { RulerUnit } from "./lib/ruler-ticks";

/** Pages of buffer kept mounted on each side of the visible window. */
const BUFFER_PAGES = 2;

/** Milliseconds of scroll stillness before we consider a fling "settled". */
const SETTLE_MS = 120;

/** px/ms scroll speed above which we treat the motion as a fast fling. */
const FAST_SCROLL_VELOCITY = 1.5;

/** Zoom hard bounds (10%–800%), matching the single-page EditorCanvas. */
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
/** Comfortable breathing room around the page when computing a fit zoom (px). */
const FIT_PADDING_PX = 32;

/** Vertical alignment of a page when programmatically scrolled into view. */
export type ScrollAlign = "start" | "center";

export interface ContinuousPageViewHandle {
  /** Smoothly scroll page `index` to the top (`start`) or centre of the view. */
  scrollToPage: (index: number, align?: ScrollAlign) => void;
}

export interface ContinuousPageViewProps {
  /** All pages of the document, in order. */
  pages: PageObject[];
  /** Current zoom factor (1 = 100%). */
  zoom: number;
  /** The PDF binary backing the page backgrounds (single source of truth). */
  pdfFile: File | null;
  /**
   * 0-based indices of the pages whose CONTENT changed in the latest bake of
   * `pdfFile` (same page structure). When provided AND the structural signature
   * is unchanged, the view PATCHES the existing pool in place — re-rasterising
   * ONLY these pages — instead of rebuilding the pool (which would re-raster
   * every visible page). Pass `null`/omit for a STRUCTURAL change (page added/
   * removed/rotated, re-parse) → the pool is rebuilt.
   */
  bakedPageIndices?: number[] | null;
  /** Document ID (session backend) — forwarded to the active page's EditorCanvas. */
  documentId?: string | null;
  /** Active tool — forwarded to the active page's EditorCanvas (create/select/…). */
  tool?: Tool;
  /** 0-based index of the active/focused page (editable EditorCanvas). */
  activePageIndex: number;
  /** Click into a page → caller updates the active page (+ selection store). */
  onActivatePage: (index: number) => void;
  /** Show the horizontal + vertical rulers along the page edges. */
  showRulers?: boolean;
  /** Display unit for the rulers (px/mm/cm/in/pt). Defaults to "mm". */
  rulerUnit?: RulerUnit;
  /**
   * Per-page content margins (PDF points), aligned to `pages` by index — the
   * single source of truth owned by page.tsx (pageId-keyed, persisted in the
   * editor sidecar). An entry is `null` when a page's margins are unknown / not
   * loaded; a missing array means no guides at all.
   */
  margins?: Array<PageMargins | null>;
  /**
   * Commit new margins (PDF points) for a page after its margin guide is
   * dropped. When omitted, the draggable margin guides are not rendered.
   */
  onMarginsCommit?: (index: number, margins: PageMargins) => void;
  /**
   * Resolves the registered FontFace name for an embedded PDF font. Forwarded to
   * the active page's EditorCanvas so the continuous (Word-like) view resolves
   * embedded fonts identically to the single-page editor.
   */
  getFontFaceName?: (
    originalName: string,
    wantVariant?: { bold?: boolean; italic?: boolean },
    text?: string,
    fontId?: string,
  ) => { name: string; embedded: boolean; exact: boolean } | null;
  /** True while embedded fonts load — forwarded to the active page's EditorCanvas
   *  so it re-renders the overlay once when fonts become ready. */
  fontsLoading?: boolean;
  /** Shape variant for the shape tool — forwarded to the ACTIVE page's EditorCanvas. */
  shapeType?: ShapeType;
  /** Annotation variant for the annotate tool — forwarded to the ACTIVE page's EditorCanvas. */
  annotationType?: AnnotationType;
  /** Form-field creation variant — forwarded to the ACTIVE page's EditorCanvas. */
  fieldKind?: FieldCreationKind;
  /** Stroke colour for new shapes/annotations — forwarded to the ACTIVE page's EditorCanvas. */
  strokeColor?: string;
  /** Fill colour for new shapes — forwarded to the ACTIVE page's EditorCanvas. */
  fillColor?: string;
  /** Stroke width for new shapes/annotations — forwarded to the ACTIVE page's EditorCanvas. */
  strokeWidth?: number;
  /**
   * Hyperlink clicked on the ACTIVE page — forwarded to the ACTIVE page's
   * EditorCanvas (same contract as the single-page editor).
   */
  onHyperlinkClick?: (linkUrl?: string | null, linkPage?: number | null) => void;
  /**
   * Live redaction-marker count on the ACTIVE page — forwarded to the ACTIVE
   * page's EditorCanvas so the toolbar can reflect the count / enable Apply.
   */
  onRedactionMarksChanged?: (count: number) => void;
  /**
   * Adaptive fit-zoom mode (page/width). Unlike the single-page editor — where
   * EditorCanvas owns the scroll viewport — the continuous SCROLLER owns the
   * viewport here, so the fit zoom is computed in THIS component against the
   * active page's points and reported via onFitZoomChange. It is deliberately
   * NOT forwarded to the embedded EditorCanvas, whose `embedded` mode forces
   * fitMode=null (forwarding it there would be a no-op).
   */
  fitMode?: "page" | "width" | null;
  /** Zoom recomputed by a fit mode — same contract as EditorCanvas.onFitZoomChange. */
  onFitZoomChange?: (zoom: number) => void;
  /**
   * Element CREATED at mouse on the ACTIVE page. Wired to the same page.tsx
   * handler as the single-page editor (scene graph + queue + apply-elements
   * bake → save).
   */
  onElementAdded?: (element: Element) => void;
  /**
   * Freehand pencil stroke completed on the ACTIVE page (PDF user-space points).
   * Wired to the same page.tsx handler as the single-page editor (`addInk` bake
   * → adopt + re-parse), so the pencil works identically in continuous mode.
   */
  onInkDrawn?: (points: number[]) => void;
  /**
   * Element moved/resized/rotated or text retyped on the ACTIVE page. Wired to
   * the same page.tsx handler as the single-page editor (queueUpdate →
   * apply-elements bake → save), so continuous editing persists identically.
   */
  onElementModified?: (element: Element, oldBounds?: Bounds) => void;
  /**
   * Z-order change (bringToFront/sendToBack) on the ACTIVE page. Wired to the
   * same page.tsx handler (queueReorder → engine `reorderElement` bake → save).
   */
  onElementReordered?: (element: Element, toFront: boolean) => void;
  /** Element removed on the ACTIVE page (same pipeline as single-page). */
  onElementRemoved?: (elementId: string) => void;
  /** Selection changed on the ACTIVE page (drives the page-scoped panels). */
  onSelectionChanged?: (elementIds: string[]) => void;
  /**
   * Live character-selection style on the ACTIVE page (Word-like partial
   * formatting) — drives the formatting toolbar's active state.
   */
  onTextSelectionStyleChanged?: (style: Partial<TextStyle> | null) => void;
  /**
   * The ACTIVE page's imperative handle. Routing this to page.tsx's
   * `setCanvasHandle` makes the toolbar (delete/undo/redo/duplicate/format/
   * addImage) drive the ACTIVE page automatically — the same handle the
   * single-page editor exposes.
   */
  onCanvasReady?: (handle: EditorCanvasHandle) => void;
  /**
   * Render an extra overlay inside the ACTIVE page's sheet (page×zoom space) —
   * the seam for the table-edit overlay in the continuous view, mirroring the
   * single-page `overlay` prop of `EditorCanvas`. Receives the 0-based page index.
   */
  renderActiveOverlay?: (index: number) => React.ReactNode;
  /**
   * SL2 — Word-like header/footer edit mode is active. Forwarded to the active
   * page's EditorCanvas so its background raster excludes the baked `/GPHF` band.
   */
  headerFooterActive?: boolean;
  /**
   * Remplir & Signer actif — forwarded to the active page's EditorCanvas
   * (simple clic = curseur dans un champ, clic signature = dialog de capture).
   */
  fillSignActive?: boolean;
  /** Remplir & Signer : clic sur un widget SIGNATURE (forwarded). */
  onSignatureFieldClick?: (element: FormFieldElement) => void;
}

/**
 * Continuous virtualised page scroller. Reads/writes the view store for
 * visibility, focus and scroll telemetry; owns the shared {@link PageRenderPool}.
 */
function ContinuousPageViewImpl(
  {
    pages,
    zoom,
    pdfFile,
    bakedPageIndices,
    documentId,
    tool,
    activePageIndex,
    onActivatePage,
    showRulers = false,
    rulerUnit = "mm",
    margins,
    onMarginsCommit,
    getFontFaceName,
    fontsLoading,
    shapeType,
    annotationType,
    fieldKind,
    strokeColor,
    fillColor,
    strokeWidth,
    onHyperlinkClick,
    onRedactionMarksChanged,
    fitMode,
    onFitZoomChange,
    onElementAdded,
    onInkDrawn,
    onElementModified,
    onElementReordered,
    onElementRemoved,
    onSelectionChanged,
    onTextSelectionStyleChanged,
    onCanvasReady,
    renderActiveOverlay,
    headerFooterActive = false,
    fillSignActive = false,
    onSignatureFieldClick,
  }: ContinuousPageViewProps,
  ref: React.ForwardedRef<ContinuousPageViewHandle>,
) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Mirror of the current zoom so the fit-zoom effect can compare against it
  // without re-subscribing its ResizeObserver on every zoom change (same
  // pattern the single-page EditorCanvas uses for its own fit logic).
  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  // Layout is pure geometry: recompute only when the page set or zoom changes.
  const { slots, totalHeight } = useMemo(
    () => computePageLayout(pages, zoom),
    [pages, zoom],
  );

  // View-store slices. Selectors only — we read `visiblePages` for rendering and
  // call setters from the observer / scroll handler. Actions are stable in
  // Zustand, so this selector object stays referentially cheap with useShallow.
  const {
    visiblePages,
    isFastScrolling,
    setVisiblePages,
    setCurrentPageIndex,
    setScrollTop,
    setViewport,
    setFastScrolling,
  } = useViewStore(
    useShallow((s) => ({
      visiblePages: s.visiblePages,
      isFastScrolling: s.isFastScrolling,
      setVisiblePages: s.setVisiblePages,
      setCurrentPageIndex: s.setCurrentPageIndex,
      setScrollTop: s.setScrollTop,
      setViewport: s.setViewport,
      setFastScrolling: s.setFastScrolling,
    })),
  );

  // ── Shared render pool ─────────────────────────────────────────────────────
  const [pool, setPool] = useState<PageRenderPool | null>(null);
  // Mirror of the LIVE committed pool. The pdfFile-change effect reads it to
  // dispose the *previous* pool only AFTER the new one is committed (atomic
  // swap), so the cleanup never has to `setPool(null)` — which would unmount
  // every PageSlot, including the active page's `<EditorCanvas embedded>`
  // editing session (selection/undo lost + a full-document re-raster flash).
  const poolRef = useRef<PageRenderPool | null>(null);

  // Per-page background revision. Bumping `bgRevisions[i]` forces ONLY page `i`'s
  // inactive bitmap to re-rasterise (the value is forwarded to each PageSlot →
  // PageCanvasHost render-effect dep). Untouched entries keep their bitmap. The
  // active page renders an EditorCanvas, so it ignores this entirely.
  const [bgRevisions, setBgRevisions] = useState<number[]>([]);

  // Stable structural signature of the page set: `pageId:WxH@rotation` joined.
  // Drives the PATCH-vs-BUILD decision below — when it is unchanged across a
  // `pdfFile` swap, only the page binary changed (a content bake), so we patch
  // the existing pool in place instead of rebuilding it.
  const structuralSignature = useMemo(
    () =>
      pages
        .map(
          (p) =>
            `${p.pageId}:${p.dimensions.width}x${p.dimensions.height}@${p.dimensions.rotation}`,
        )
        .join("|"),
    [pages],
  );
  // Committed signature of the LIVE pool — set on BUILD, compared on the next
  // pdfFile change to detect whether the structure changed.
  const signatureRef = useRef<string | null>(null);

  // Latest baked-page hint + page count mirrored into refs so the async pool
  // effect reads them without re-subscribing (kept fresh by the effects below,
  // declared BEFORE the pool effect so they run first on the same commit).
  const bakedIndicesRef = useRef<number[] | null | undefined>(bakedPageIndices);
  useEffect(() => {
    bakedIndicesRef.current = bakedPageIndices;
  }, [bakedPageIndices]);
  const pageCountRef = useRef(pages.length);
  useEffect(() => {
    pageCountRef.current = pages.length;
  }, [pages.length]);

  useEffect(() => {
    // No document → tear down for real (there is genuinely nothing to show).
    if (!pdfFile) {
      poolRef.current?.dispose();
      poolRef.current = null;
      signatureRef.current = null;
      setPool(null);
      return;
    }

    // Epoch guard: if `pdfFile` changes again before this async run finishes,
    // `cancelled` flips so this (now-stale) run never commits an outdated pool
    // nor patches against superseded bytes.
    let cancelled = false;

    void (async () => {
      try {
        const existing = poolRef.current;

        // ── PATCH (same structure) ──
        // A live pool + an unchanged structural signature means only the page
        // binary changed (a content bake). Swap the bytes in place and bump the
        // revision of ONLY the baked pages, so just those re-rasterise — the
        // pool is NOT rebuilt and NO PageSlot unmounts (active session intact).
        if (existing && signatureRef.current === structuralSignature) {
          const bytes = await pdfFile.arrayBuffer();
          if (cancelled) {
            return;
          }
          const baked = bakedIndicesRef.current;
          const changed = baked && baked.length > 0 ? baked : null;
          existing.replaceBytes(bytes, changed ?? undefined);
          setBgRevisions((prev) => {
            const next = prev.slice();
            if (changed) {
              for (const i of changed) {
                next[i] = (next[i] ?? 0) + 1;
              }
            } else {
              // Unknown scope on an unchanged structure → refresh every inactive
              // page's bitmap (the active page is an EditorCanvas, untouched).
              for (let i = 0; i < pageCountRef.current; i += 1) {
                next[i] = (next[i] ?? 0) + 1;
              }
            }
            return next;
          });
          return;
        }

        // ── BUILD / ATOMIC POOL SWAP (no pool yet, or structure changed) ──
        const bytes = await pdfFile.arrayBuffer();
        if (cancelled) {
          // pdfFile changed during arrayBuffer() — abandon before allocating a
          // pool, so a superseded run never builds (nothing to dispose).
          return;
        }
        const next = new PageRenderPool({ pdfBytes: bytes });

        // Commit the NEW pool first: because each `<PageSlot>` is keyed by its
        // stable `pageId` and the gate `{pool ? … : null}` never goes false
        // (pool stays truthy across the swap), React reconciles the slots WITHOUT
        // unmounting them — the active editing session is preserved, zero flash.
        // Only THEN do we dispose the pool the previous run committed.
        const previous = poolRef.current;
        poolRef.current = next;
        signatureRef.current = structuralSignature;
        setPool(next);
        previous?.dispose();
      } catch (err) {
        clientLogger.warn("[ContinuousPageView] pool init failed:", err);
      }
    })();

    // NB: the cleanup deliberately does NOT dispose `poolRef.current` — the live
    // pool must survive the swap so the active PageSlot is never unmounted. A
    // run that is superseded mid-build bails on the `cancelled` check above
    // (before allocating), so there is nothing to dispose here. The committed
    // pool is disposed either by the next swap (`previous?.dispose()`), the
    // `!pdfFile` branch, or the unmount effect below.
    return () => {
      cancelled = true;
    };
    // `bakedPageIndices` is read via `bakedIndicesRef` (set in a preceding
    // effect) so a hint change alone never re-runs this; a content bake always
    // changes `pdfFile`, which does.
  }, [pdfFile, structuralSignature]);

  // Final teardown: dispose whatever pool is live when the component unmounts.
  useEffect(() => {
    return () => {
      poolRef.current?.dispose();
      poolRef.current = null;
    };
  }, []);

  // ── IntersectionObserver windowing ────────────────────────────────────────
  // One observer (root = scroll element). Each page owns a zero-size sentinel;
  // intersecting sentinels — widened by a ~BUFFER_PAGES band via rootMargin —
  // define the live window. We additionally union an index-based ±BUFFER_PAGES
  // ring so a single missed boundary observation never blanks a page.
  const sentinelsRef = useRef<Array<HTMLDivElement | null>>([]);
  const intersectingRef = useRef<Set<number>>(new Set());
  // Page nearest the viewport centre (from the scroll handler). Always kept in
  // the window so a page taller than the buffer band — whose top sentinel has
  // scrolled out — never blanks while it fills the viewport.
  const focusRef = useRef(0);

  // Trim stale tail entries when the document shrinks. The per-page ref callback
  // assigns by index (JS auto-grows the array), so we only need to drop the
  // overhang here — in an effect, to avoid mutating a ref during render.
  useEffect(() => {
    if (sentinelsRef.current.length > pages.length) {
      sentinelsRef.current.length = pages.length;
    }
  }, [pages.length]);

  const publishVisible = useCallback(() => {
    if (pages.length === 0) {
      setVisiblePages([]);
      return;
    }
    const base = intersectingRef.current;
    const focus = Math.min(Math.max(0, focusRef.current), pages.length - 1);

    let min: number;
    let max: number;
    if (base.size === 0) {
      // Nothing reported intersecting yet (initial mount): seed from the focus
      // page so the top of the document hydrates immediately.
      min = focus;
      max = focus;
    } else {
      min = Number.POSITIVE_INFINITY;
      max = Number.NEGATIVE_INFINITY;
      for (const i of base) {
        if (i < min) min = i;
        if (i > max) max = i;
      }
      // Always keep the focused page in the window (tall-page guard).
      min = Math.min(min, focus);
      max = Math.max(max, focus);
    }

    const from = Math.max(0, min - BUFFER_PAGES);
    const to = Math.min(pages.length - 1, max + BUFFER_PAGES);
    const next: number[] = [];
    for (let i = from; i <= to; i += 1) {
      next.push(i);
    }
    setVisiblePages(next);
  }, [pages.length, setVisiblePages]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || pages.length === 0) {
      return;
    }

    intersectingRef.current = new Set();

    const observer = new IntersectionObserver(
      (entries) => {
        const set = intersectingRef.current;
        for (const entry of entries) {
          const attr = (entry.target as HTMLElement).dataset.pageIndex;
          if (attr === undefined) {
            continue;
          }
          const idx = Number(attr);
          if (Number.isNaN(idx)) {
            continue;
          }
          if (entry.isIntersecting) {
            set.add(idx);
          } else {
            set.delete(idx);
          }
        }
        publishVisible();
      },
      {
        root,
        // Expand the root by a ~BUFFER_PAGES band so neighbours pre-hydrate.
        rootMargin: `${root.clientHeight}px 0px ${root.clientHeight}px 0px`,
        threshold: 0,
      },
    );

    for (const el of sentinelsRef.current) {
      if (el) {
        observer.observe(el);
      }
    }

    // Seed the window before the first intersection callback fires.
    publishVisible();

    return () => observer.disconnect();
    // Re-create the observer when the page count changes (sentinels change) or
    // the layout changes (zoom alters sentinel positions). `publishVisible` is
    // memoised on the page count.
  }, [pages.length, slots, publishVisible]);

  // ── Viewport size tracking (drives the rootMargin buffer + focus maths) ────
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) {
      return;
    }
    const update = () => setViewport(root.clientWidth, root.clientHeight);
    update();

    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const ro = new ResizeObserver(update);
    ro.observe(root);
    return () => ro.disconnect();
  }, [setViewport]);

  // ── Adaptive fit-zoom (page/width) for the CONTINUOUS scroller ─────────────
  // The single-page editor lets EditorCanvas fit itself, but in embedded mode
  // that is disabled (the scroller owns zoom). So when a fit mode is active we
  // compute the zoom HERE — from the scroller viewport and the ACTIVE page's
  // points — and report it via onFitZoomChange (page.tsx routes it to setZoom).
  // Recomputed on viewport resize and when the active page / page set changes;
  // a manual zoom clears fitMode upstream, which unsubscribes this effect.
  useEffect(() => {
    if (!fitMode || !onFitZoomChange) {
      return;
    }
    const root = scrollRef.current;
    const activePage = pages[activePageIndex];
    if (!root || !activePage) {
      return;
    }
    const recompute = () => {
      const { w: pageW, h: pageH } = effectivePagePoints(activePage);
      if (pageW <= 0 || pageH <= 0) {
        return;
      }
      const availW = root.clientWidth - FIT_PADDING_PX * 2;
      const availH = root.clientHeight - FIT_PADDING_PX * 2;
      if (availW <= 0 || availH <= 0) {
        return;
      }
      const raw =
        fitMode === "width"
          ? availW / pageW
          : Math.min(availW / pageW, availH / pageH);
      const fit = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, raw));
      // Compare against the live zoom (ref) to avoid a feedback loop: only push
      // a change when it actually differs.
      if (Math.abs(fit - zoomRef.current) > 0.001) {
        onFitZoomChange(fit);
      }
    };
    recompute();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const ro = new ResizeObserver(recompute);
    ro.observe(root);
    return () => ro.disconnect();
  }, [fitMode, onFitZoomChange, pages, activePageIndex]);

  // ── rAF-throttled scroll handler: focus page + fling detection ─────────────
  const rafRef = useRef<number | null>(null);
  const lastScrollTopRef = useRef(0);
  const lastScrollTimeRef = useRef(0);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest slots mirrored into a ref so the rAF callback reads current geometry
  // without re-binding (updated in an effect, never during render).
  const slotsRef = useRef(slots);
  useEffect(() => {
    slotsRef.current = slots;
  }, [slots]);

  const handleScroll = useCallback(() => {
    if (rafRef.current !== null) {
      return;
    }
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const root = scrollRef.current;
      if (!root) {
        return;
      }
      const top = root.scrollTop;
      const now = performance.now();

      // Velocity (px/ms) since the previous sample → fling detection.
      const dt = now - lastScrollTimeRef.current;
      const velocity = dt > 0 ? Math.abs(top - lastScrollTopRef.current) / dt : 0;
      lastScrollTopRef.current = top;
      lastScrollTimeRef.current = now;

      setScrollTop(top);

      const currentSlots = slotsRef.current;
      const focus = pageIndexAtScroll(currentSlots, top, root.clientHeight);
      setCurrentPageIndex(focus);

      // Track the focused page and refresh the window when it changes so the
      // mounted set follows slow scrolls and keeps tall pages alive even when
      // their top sentinel has left the IO band.
      if (focus !== focusRef.current) {
        focusRef.current = focus;
        publishVisible();
      }

      if (velocity > FAST_SCROLL_VELOCITY) {
        setFastScrolling(true);
        if (settleTimerRef.current) {
          clearTimeout(settleTimerRef.current);
        }
        settleTimerRef.current = setTimeout(() => {
          setFastScrolling(false);
          settleTimerRef.current = null;
        }, SETTLE_MS);
      }
    });
  }, [setScrollTop, setCurrentPageIndex, setFastScrolling, publishVisible]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      if (settleTimerRef.current) {
        clearTimeout(settleTimerRef.current);
      }
    };
  }, []);

  // ── Imperative scrollToPage (used by sidebar / TOC / header / keyboard) ────
  useImperativeHandle(
    ref,
    () => ({
      scrollToPage: (index: number, align: ScrollAlign = "start") => {
        const root = scrollRef.current;
        const slot = slots[index];
        if (!root || !slot) {
          return;
        }
        const top =
          align === "center"
            ? slot.top - Math.max(0, (root.clientHeight - slot.height) / 2)
            : slot.top;
        root.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
      },
    }),
    [slots],
  );

  return (
    <div
      ref={scrollRef}
      className="h-full w-full overflow-auto bg-gray-200"
      onScroll={handleScroll}
    >
      {/* Pre-sized content surface: total document height, absolute children. */}
      <div className="relative mx-auto" style={{ height: totalHeight }}>
        {pages.map((page, index) => {
          const slot = slots[index];
          if (!slot) {
            return null;
          }
          const isActive = index === activePageIndex;
          return (
            <React.Fragment key={page.pageId}>
              {/* Zero-size IO sentinel positioned at the slot top. */}
              <div
                ref={(el) => {
                  sentinelsRef.current[index] = el;
                }}
                data-page-index={index}
                className="pointer-events-none absolute left-0 h-px w-px"
                style={{ top: slot.top }}
                aria-hidden="true"
              />
              {pool ? (
                <PageSlot
                  page={page}
                  index={index}
                  zoom={zoom}
                  slot={slot}
                  // During a fast fling we keep only the active page hydrated and
                  // show cheap placeholders for the rest; the window re-hydrates
                  // ~SETTLE_MS after the scroll stops.
                  isVisible={
                    visiblePages.has(index) &&
                    (!isFastScrolling || isActive)
                  }
                  isActive={isActive}
                  pool={pool}
                  bgRevision={bgRevisions[index] ?? 0}
                  showRulers={showRulers}
                  rulerUnit={rulerUnit}
                  margins={margins?.[index] ?? null}
                  {...(onMarginsCommit ? { onMarginsCommit } : {})}
                  {...(getFontFaceName ? { getFontFaceName } : {})}
                  {...(fontsLoading !== undefined ? { fontsLoading } : {})}
                  {...(isActive ? { shapeType } : {})}
                  {...(isActive ? { annotationType } : {})}
                  {...(isActive ? { fieldKind } : {})}
                  {...(isActive ? { strokeColor } : {})}
                  {...(isActive ? { fillColor } : {})}
                  {...(isActive ? { strokeWidth } : {})}
                  {...(isActive && onHyperlinkClick ? { onHyperlinkClick } : {})}
                  {...(isActive && onRedactionMarksChanged
                    ? { onRedactionMarksChanged }
                    : {})}
                  {...(isActive ? { documentId } : {})}
                  {...(isActive ? { headerFooterActive } : {})}
                  {...(isActive ? { fillSignActive } : {})}
                  {...(isActive && onSignatureFieldClick
                    ? { onSignatureFieldClick }
                    : {})}
                  {...(isActive && tool ? { tool } : {})}
                  {...(isActive && onElementAdded ? { onElementAdded } : {})}
                  {...(isActive && onInkDrawn ? { onInkDrawn } : {})}
                  {...(isActive && onElementModified
                    ? { onElementModified }
                    : {})}
                  {...(isActive && onElementReordered
                    ? { onElementReordered }
                    : {})}
                  {...(isActive && onElementRemoved
                    ? { onElementRemoved }
                    : {})}
                  {...(isActive && onSelectionChanged
                    ? { onSelectionChanged }
                    : {})}
                  {...(isActive && onTextSelectionStyleChanged
                    ? { onTextSelectionStyleChanged }
                    : {})}
                  {...(isActive && onCanvasReady ? { onCanvasReady } : {})}
                  {...(isActive && renderActiveOverlay
                    ? { renderActiveOverlay }
                    : {})}
                  onActivate={onActivatePage}
                />
              ) : null}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

export const ContinuousPageView = forwardRef<
  ContinuousPageViewHandle,
  ContinuousPageViewProps
>(ContinuousPageViewImpl);
