/**
 * render-elements.test.ts
 *
 * Regression guard for the "doubled text" bug: the element overlay built by the
 * SHARED canonical renderer (used by BOTH the single-page editor and the
 * continuous Word-like view) must be INVISIBLE — the visible page is the PDF
 * raster at index 0; the overlay is only a click/edit hit-target. If the text
 * overlay ever regains a visible fill, every glyph renders twice.
 *
 * Fabric is mocked with lightweight constructors that record their options, so
 * we assert on the exact Fabric object configuration without a real canvas.
 */

import { describe, it, expect, vi } from "vitest";
import type { Element, PageBlockGroup } from "@giga-pdf/types";
import {
  renderElementsOverlay,
  applyFallbackWidthFit,
  applySegmentWidthFit,
  groupTextRunsIntoParagraphs,
  measuredLineHeightMultiple,
  hasUniformLineAdvance,
  isCoherentCoalescedBlock,
  isCoherentLineGroup,
  joinLineRunContents,
  pageBlockGroupsToParagraphs,
  pageBlockGroupsToTablesAndLists,
  beginParagraphEditSession,
  restoreParagraphEditSession,
} from "../render-elements";
import type { TextRun } from "../render-elements";
// The single serialisation seam — asserted here so the hover-affordance
// outline can NEVER reach the operations queue / save path.
import {
  fabricObjectToElement,
  fabricObjectToElements,
} from "../lib/fabric-element-io";

// --- Minimal Fabric mock: each shape records its constructor options. --------
class FakeObj {
  opts: Record<string, unknown>;
  data?: Record<string, unknown>;
  constructor(opts: Record<string, unknown> = {}) {
    this.opts = opts;
  }
  // Mirror Fabric's dual signature: set(key, value) AND set({ ...patch }).
  set(patch: Record<string, unknown> | string, value?: unknown) {
    if (typeof patch === "string") {
      this.opts[patch] = value;
      return;
    }
    Object.assign(this.opts, patch);
  }
  // Mirror Fabric's ABSOLUTE geometry helpers (block selection / hover
  // affordance hit-test on them). A text object anchored originY:"bottom"
  // hangs ABOVE its `top` (the baseline anchor), like real Fabric.
  getBoundingRect() {
    const w = (this.opts.width as number | undefined) ?? 0;
    const h =
      (this.opts.height as number | undefined) ??
      (this.opts.fontSize as number | undefined) ??
      0;
    const left = (this.opts.left as number | undefined) ?? 0;
    const topRaw = (this.opts.top as number | undefined) ?? 0;
    const top = this.opts.originY === "bottom" ? topRaw - h : topRaw;
    return { left, top, width: w, height: h };
  }
  containsPoint(p: { x: number; y: number }) {
    const { left, top, width, height } = this.getBoundingRect();
    return (
      p.x >= left && p.x <= left + width && p.y >= top && p.y <= top + height
    );
  }
}
class IText extends FakeObj {
  text: string;
  constructor(text: string, opts: Record<string, unknown>) {
    super(opts);
    this.text = text;
  }
  // Fabric's IText.set({ text }) updates the live `.text` property; mirror that
  // so click-toggle assertions (which read obj.text) behave like real Fabric.
  set(patch: Record<string, unknown> | string, value?: unknown) {
    if (typeof patch === "object" && typeof patch.text === "string") {
      this.text = patch.text;
    }
    super.set(patch, value);
  }
}
class Textbox extends FakeObj {
  text: string;
  enterEditing = vi.fn();
  constructor(text: string, opts: Record<string, unknown>) {
    super(opts);
    this.text = text;
  }
  set(patch: Record<string, unknown> | string, value?: unknown) {
    if (typeof patch === "object" && typeof patch.text === "string") {
      this.text = patch.text;
    }
    super.set(patch, value);
  }
}
class Rect extends FakeObj {}
class Circle extends FakeObj {}
class Ellipse extends FakeObj {}
class Triangle extends FakeObj {}
class Polygon extends FakeObj {
  constructor(_points: unknown, opts: Record<string, unknown>) {
    super(opts);
  }
}
class Line extends FakeObj {
  constructor(_coords: unknown, opts: Record<string, unknown>) {
    super(opts);
  }
}
class Path extends FakeObj {
  constructor(_d: unknown, opts: Record<string, unknown>) {
    super(opts);
  }
}
const FabricImage = {
  fromURL: vi.fn(async () => new FakeObj()),
};

// Live multi-selection mock: real Fabric reports instance `type` as the
// lowercased class name ("activeselection") and flattens via getObjects().
class ActiveSelection extends FakeObj {
  type = "activeselection";
  private members: FakeObj[];
  constructor(objects: FakeObj[] = [], opts: Record<string, unknown> = {}) {
    super(opts);
    this.members = objects;
  }
  getObjects() {
    return [...this.members];
  }
}

const fabricMock = {
  Rect,
  Circle,
  Ellipse,
  Triangle,
  Line,
  IText,
  Textbox,
  FabricImage,
  Path,
  Polygon,
  ActiveSelection,
} as unknown as typeof import("fabric");

function makeCanvas() {
  const objects: FakeObj[] = [];
  const handlers: Record<string, Array<(e: unknown) => void>> = {};
  // Track the active object like real Fabric so mouse:down:before snapshots
  // (block selection drill-down state) read the same thing they would live.
  let active: FakeObj | null = null;
  return {
    add: (o: FakeObj) => objects.push(o),
    // A REAL removal (splice) — the paragraph edit session lifts the member
    // objects off the canvas and puts them back on an unmodified exit.
    remove: vi.fn((o: FakeObj) => {
      const i = objects.indexOf(o);
      if (i >= 0) objects.splice(i, 1);
    }),
    insertAt: vi.fn((index: number, ...objs: FakeObj[]) => {
      objects.splice(index, 0, ...objs);
    }),
    discardActiveObject: vi.fn(() => {
      active = null;
    }),
    setActiveObject: vi.fn((o: FakeObj) => {
      active = o;
    }),
    getActiveObject: () => active,
    getObjects: () => objects,
    // Mirror Fabric v6's canvas.moveObjectTo: pull the object out and re-insert
    // it at the target index (used by the post-image-load z-order re-assert).
    moveObjectTo: (o: FakeObj, index: number) => {
      const cur = objects.indexOf(o);
      if (cur === -1) return;
      objects.splice(cur, 1);
      objects.splice(index, 0, o);
    },
    renderAll: vi.fn(),
    requestRenderAll: vi.fn(),
    on: (event: string, cb: (e: unknown) => void) => {
      (handlers[event] ??= []).push(cb);
    },
    fire: (event: string, e: unknown) => {
      for (const cb of handlers[event] ?? []) cb(e);
    },
    _objects: objects,
    _handlers: handlers,
  } as unknown as import("fabric").Canvas & {
    _objects: FakeObj[];
    fire: (event: string, e: unknown) => void;
  };
}

function textElement(over: Partial<Record<string, unknown>> = {}): Element {
  return {
    type: "text",
    elementId: "t1",
    bounds: { x: 10, y: 20, width: 100, height: 14 },
    visible: true,
    locked: false,
    content: "Bonjour",
    style: {
      fontSize: 12,
      color: "#112233",
      fontFamily: "Helvetica",
      originalFont: "KWVFOU+TimesNewRoman,Bold",
    },
    ...over,
  } as unknown as Element;
}

describe("renderElementsOverlay — 1:1 fidelity (anti-doubling)", () => {
  it("renders text overlay VISIBLE in its real colour (direct text over a text-free raster)", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(canvas, [textElement()], fabricMock);

    const it_ = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof IText,
    ) as IText | undefined;
    expect(it_).toBeDefined();
    // The raster is rendered WITHOUT text, so this overlay IS the visible text:
    // painted in its real colour (no doubling — there is no glyph underneath).
    expect(it_!.opts.fill).toBe("#112233");
    expect((it_!.data as Record<string, unknown>).originalFill).toBe("#112233");
  });

  it("resolves the embedded FontFace via getFontFaceName when provided", async () => {
    const canvas = makeCanvas();
    const getFontFaceName = vi.fn(() => ({
      name: "gigapdf-doc-font-abc",
      embedded: true,
      exact: true,
    }));
    await renderElementsOverlay(canvas, [textElement()], fabricMock, {
      getFontFaceName,
    });

    const it_ = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof IText,
    ) as IText;
    // Now resolved WEIGHT/STYLE-AWARE: the run carries no explicit weight/style,
    // so the variant intent is regular (bold:false, italic:false). The run text
    // is forwarded so the resolver can rank same-variant subsets by coverage —
    // here "Bonjour" from the textElement() factory. The 4th arg is the run's
    // PHYSICAL program id (`style.fontId`) — absent on this element.
    expect(getFontFaceName).toHaveBeenCalledWith(
      "KWVFOU+TimesNewRoman,Bold",
      { bold: false, italic: false },
      "Bonjour",
      undefined,
    );
    expect(it_.opts.fontFamily).toBe("gigapdf-doc-font-abc");
  });

  it("forwards the run's physical fontId (style.fontId) to the resolver", async () => {
    const canvas = makeCanvas();
    const getFontFaceName = vi.fn(() => ({
      name: "gigapdf-doc-ab12cd34",
      embedded: true,
      exact: true,
    }));
    const run = textElement({
      style: {
        fontSize: 12,
        color: "#112233",
        fontFamily: "Helvetica",
        originalFont: "KWVFOU+TimesNewRoman,Bold",
        // Physical program identity from the engine (TextElementInfo.fontId).
        fontId: "ab12cd34",
      },
    });
    await renderElementsOverlay(canvas, [run], fabricMock, { getFontFaceName });

    expect(getFontFaceName).toHaveBeenCalledWith(
      "KWVFOU+TimesNewRoman,Bold",
      { bold: false, italic: false },
      "Bonjour",
      "ab12cd34",
    );
    const it_ = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof IText,
    ) as IText;
    expect(it_.opts.fontFamily).toBe("gigapdf-doc-ab12cd34");
    expect((it_.data as Record<string, unknown>).usingEmbeddedFont).toBe(true);
  });

  it("resolves the embedded subset matching the run's weight/style variant", async () => {
    // A PDF embeds many subsets of the same family. The resolver is asked first
    // for the variant-EXACT subset (Pass 1, weight-bearing names); only if that
    // misses does the renderer fall back to the loose 1-arg call. Here the run is
    // BOLD ITALIC, so the variant query must carry { bold: true, italic: true }
    // and its result is used as-is (no synthetic bold/italic on top).
    const canvas = makeCanvas();
    const getFontFaceName = vi.fn((_name: string, variant?: { bold?: boolean; italic?: boolean }) =>
      variant?.bold && variant?.italic
        ? { name: "gigapdf-doc-bolditalic", embedded: true, exact: true }
        : null,
    );
    const run = textElement({
      style: {
        fontSize: 12,
        color: "#000000",
        fontFamily: "Times New Roman",
        fontWeight: "bold",
        fontStyle: "italic",
        // Bare family name — exactly what the SDK collapses a run's font to.
        originalFont: "Times New Roman",
      },
    });
    await renderElementsOverlay(canvas, [run], fabricMock, { getFontFaceName });

    const it_ = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof IText,
    ) as IText;
    expect(getFontFaceName).toHaveBeenCalledWith(
      "Times New Roman",
      { bold: true, italic: true },
      "Bonjour",
      undefined,
    );
    expect(it_.opts.fontFamily).toBe("gigapdf-doc-bolditalic");
    // Variant-exact subset already encodes the weight/style → no synthetic.
    expect(it_.opts.fontWeight).toBe("normal");
    expect(it_.opts.fontStyle).toBe("normal");
    expect((it_.data as Record<string, unknown>).usingEmbeddedFont).toBe(true);
  });

  it("keeps the ORIGINAL embedded bytes + synthetic weight on a LOOSE match (exact: false)", async () => {
    // The PDF embeds the family but NOT this run's variant: the resolver's
    // cascade lands on the LOOSE family subset (`exact: false`) in a SINGLE
    // call. The renderer keeps the parsed weight/style synthetically to
    // approximate the missing variant — but the face still carries the
    // document's ORIGINAL bytes, so it IS flagged usingEmbeddedFont (no
    // cosmetic width-fit clamp on original metrics).
    const canvas = makeCanvas();
    const getFontFaceName = vi.fn(() => ({
      name: "gigapdf-doc-regular",
      embedded: true,
      exact: false,
    }));
    const run = textElement({
      style: {
        fontSize: 12,
        color: "#000000",
        fontFamily: "Times New Roman",
        fontWeight: "bold",
        fontStyle: "normal",
        originalFont: "Times New Roman",
      },
    });
    await renderElementsOverlay(canvas, [run], fabricMock, { getFontFaceName });

    const it_ = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof IText,
    ) as IText;
    // ONE call carries the whole cascade (variant intent + run text + fontId).
    expect(getFontFaceName).toHaveBeenCalledTimes(1);
    expect(getFontFaceName).toHaveBeenCalledWith(
      "Times New Roman",
      { bold: true, italic: false },
      "Bonjour",
      undefined,
    );
    expect(it_.opts.fontFamily).toBe("gigapdf-doc-regular");
    // Loose subset is not the bold variant → synthesise bold so it still reads bold.
    expect(it_.opts.fontWeight).toBe("bold");
    expect(it_.opts.fontStyle).toBe("normal");
    // Original embedded bytes ⇒ usingEmbeddedFont stays true (synthetic variant
    // is decoupled from byte provenance).
    expect((it_.data as Record<string, unknown>).usingEmbeddedFont).toBe(true);
  });

  it("flags a GOOGLE-substitute face as NOT embedded (mislabel fix)", async () => {
    // The resolver can return a face whose bytes came from the Google-Fonts
    // proxy (registered under the font's conventional name). It must NOT be
    // treated as original bytes: usingEmbeddedFont=false (width-fit clamp
    // allowed), while `exact: true` still neutralises the synthetic variant
    // (the Google face was requested at the right weight/style).
    const canvas = makeCanvas();
    const getFontFaceName = vi.fn(() => ({
      name: "gigapdf-doc-google-sub",
      embedded: false,
      exact: true,
    }));
    const run = textElement({
      style: {
        fontSize: 12,
        color: "#000000",
        fontFamily: "Times New Roman",
        fontWeight: "bold",
        fontStyle: "normal",
        originalFont: "Times New Roman",
      },
    });
    await renderElementsOverlay(canvas, [run], fabricMock, { getFontFaceName });

    const it_ = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof IText,
    ) as IText;
    expect(it_.opts.fontFamily).toBe("gigapdf-doc-google-sub");
    expect(it_.opts.fontWeight).toBe("normal");
    expect((it_.data as Record<string, unknown>).usingEmbeddedFont).toBe(false);
  });

  it("NEUTRALISES synthetic bold/italic when the embedded font is used", async () => {
    // The embedded subset IS already the bold/italic variant, so applying a
    // synthetic weight/style on top widens glyphs → overflow. With the embedded
    // font resolved, fontWeight/fontStyle must be 'normal' and the object is
    // flagged usingEmbeddedFont (no cosmetic width fit).
    const canvas = makeCanvas();
    const getFontFaceName = vi.fn(() => ({
      name: "gigapdf-doc-font-bold",
      embedded: true,
      exact: true,
    }));
    const bold = textElement({
      style: {
        fontSize: 12,
        color: "#000000",
        fontFamily: "Helvetica",
        fontWeight: "bold",
        fontStyle: "italic",
        originalFont: "KWVFOU+TimesNewRoman,Bold",
      },
    });
    await renderElementsOverlay(canvas, [bold], fabricMock, { getFontFaceName });

    const it_ = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof IText,
    ) as IText;
    expect(it_.opts.fontFamily).toBe("gigapdf-doc-font-bold");
    expect(it_.opts.fontWeight).toBe("normal");
    expect(it_.opts.fontStyle).toBe("normal");
    expect((it_.data as Record<string, unknown>).usingEmbeddedFont).toBe(true);
  });

  it("KEEPS the parsed weight/style for the generic fallback font", async () => {
    // No embedded font resolved (getFontFaceName returns null) → the CSS family
    // has no built-in variant, so the parsed bold/italic must be honoured.
    const canvas = makeCanvas();
    const getFontFaceName = vi.fn(() => null);
    const bold = textElement({
      style: {
        fontSize: 12,
        color: "#000000",
        fontFamily: "Helvetica",
        fontWeight: "bold",
        fontStyle: "italic",
        originalFont: "KWVFOU+TimesNewRoman,Bold",
      },
    });
    await renderElementsOverlay(canvas, [bold], fabricMock, { getFontFaceName });

    const it_ = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof IText,
    ) as IText;
    expect(it_.opts.fontFamily).toBe("Helvetica");
    expect(it_.opts.fontWeight).toBe("bold");
    expect(it_.opts.fontStyle).toBe("italic");
    expect((it_.data as Record<string, unknown>).usingEmbeddedFont).toBe(false);
  });

  it("shrinks an overflowing FALLBACK run to its /Widths box (floored at 0.5)", async () => {
    // A loose/CSS fallback measures wider than the run's real advance; it is shrunk
    // to the box so it can't overlap the next run, floored so a gross mis-measure
    // (here 100/250 = 0.4) never crushes below 0.5.
    const canvas = makeCanvas();
    // IText mock reporting a measured width far beyond the 100px bounds.
    class WideIText extends IText {
      width = 250;
    }
    const wideFabric = {
      ...fabricMock,
      IText: WideIText,
    } as unknown as typeof import("fabric");
    await renderElementsOverlay(canvas, [textElement()], wideFabric, {
      getFontFaceName: () => null, // no embedded match → CSS fallback
    });

    const it_ = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof WideIText,
    ) as WideIText;
    // 100/250 = 0.4 → clamped to the 0.5 floor.
    expect(it_.opts.scaleX).toBeCloseTo(0.5, 5);
    expect((it_.data as Record<string, unknown>).usingEmbeddedFont).toBe(false);
  });

  it("shrinks an overflowing EMBEDDED run to its box too (hmtx ≠ /Widths)", async () => {
    // Even the exact embedded subset renders at the FontFace hmtx advance, a hair
    // wider than /Widths — so a run interleaved in a justified line (a footer's plain
    // " 'obtenir") would overlap its neighbour. It is now fitted to its box (this was
    // previously left untouched, which caused the residual footer overlap).
    const canvas = makeCanvas();
    class WideIText extends IText {
      width = 250;
    }
    const wideFabric = {
      ...fabricMock,
      IText: WideIText,
    } as unknown as typeof import("fabric");
    await renderElementsOverlay(canvas, [textElement()], wideFabric, {
      // Exact subset resolves → resolveTextFont marks usingEmbeddedFont.
      getFontFaceName: () => ({ name: "gigapdf-doc-KWVFOU", embedded: true, exact: true }),
    });

    const it_ = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof WideIText,
    ) as WideIText;
    // 100/250 = 0.4 → clamped to the 0.5 floor — fitted, no longer left untouched.
    expect(it_.opts.scaleX).toBeCloseTo(0.5, 5);
    expect((it_.data as Record<string, unknown>).usingEmbeddedFont).toBe(true);
  });

  it("renders shapes as TRANSPARENT hit-targets (raster shows the real shape)", async () => {
    const canvas = makeCanvas();
    const shape = {
      type: "shape",
      elementId: "s1",
      shapeType: "rectangle",
      bounds: { x: 0, y: 0, width: 50, height: 50 },
      visible: true,
      locked: false,
      index: 7,
      geometry: {},
      style: {
        fillColor: "#ff0000",
        fillOpacity: 1,
        strokeColor: "#0000ff",
        strokeWidth: 2,
        strokeOpacity: 1,
      },
    } as unknown as Element;
    await renderElementsOverlay(canvas, [shape], fabricMock);

    const rect = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof Rect,
    ) as Rect;
    // The shape stays BAKED in the text-free raster background (the visual
    // ground truth — exact PDF z-order, no `renderPageExcluding` index quirk),
    // so the overlay is a TRANSPARENT, editable hit-target. Painting it would
    // double the shape over the raster.
    expect(rect.opts.fill).toBe("transparent");
    expect(rect.opts.stroke).toBe("transparent");
    expect(rect.opts.strokeWidth).toBe(0);
    // The real fill/stroke are stashed on .data — used by the properties panel
    // and to REVEAL the overlay while the shape is selected.
    const data = rect.data as Record<string, unknown>;
    expect(data.originalFill).toBe("#ff0000");
    expect(data.originalStroke).toBe("#0000ff");
    expect(data.originalStrokeWidth).toBe(2);
  });

  it("stashes the alpha-composited fill on .data (revealed on selection)", async () => {
    const canvas = makeCanvas();
    const shape = {
      type: "shape",
      elementId: "s2",
      shapeType: "rectangle",
      bounds: { x: 0, y: 0, width: 50, height: 50 },
      visible: true,
      locked: false,
      index: 3,
      geometry: {},
      style: { fillColor: "#ff0000", fillOpacity: 0.5, strokeWidth: 0 },
    } as unknown as Element;
    await renderElementsOverlay(canvas, [shape], fabricMock);

    const rect = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof Rect,
    ) as Rect;
    // Overlay is transparent in view; the 50%-alpha fill is preserved on .data
    // so selection-reveal restores the exact colour.
    expect(rect.opts.fill).toBe("transparent");
    expect((rect.data as Record<string, unknown>).originalFill).toBe(
      "rgba(255, 0, 0, 0.5)",
    );
  });

  it("deduplicates a stacked twin text run at the same position", async () => {
    const canvas = makeCanvas();
    const a = textElement({ elementId: "a" });
    const b = textElement({ elementId: "b" }); // same content + size + position
    await renderElementsOverlay(canvas, [a, b], fabricMock);

    const texts = (
      canvas as unknown as { _objects: FakeObj[] }
    )._objects.filter((o) => o instanceof IText);
    expect(texts).toHaveLength(1);
  });

  it("KEEPS legitimate same-content repeats in the same column at different rows", async () => {
    // Form labels / table cells / repeated values like "Les Lilas" recur down a
    // column: same content + colour + X but DIFFERENT Y. A previous heuristic
    // ("same X, ANY Y") wrongly dropped these, making text vanish from the
    // editor. They must ALL render.
    const canvas = makeCanvas();
    const rows = [20, 60, 100, 140].map((y, i) =>
      textElement({
        elementId: `row${i}`,
        content: "Les Lilas",
        bounds: { x: 30, y, width: 80, height: 12 },
      }),
    );
    await renderElementsOverlay(canvas, rows, fabricMock);

    const texts = (
      canvas as unknown as { _objects: FakeObj[] }
    )._objects.filter((o) => o instanceof IText);
    expect(texts).toHaveLength(4);
  });

  it("KEEPS a same-content cross-line repeat at the same Y but offset X", async () => {
    // "RONY LICHA" on a sender + recipient line: same y, different x — keep both.
    const canvas = makeCanvas();
    const left = textElement({
      elementId: "l",
      content: "RONY LICHA",
      bounds: { x: 30, y: 40, width: 90, height: 12 },
    });
    const right = textElement({
      elementId: "r",
      content: "RONY LICHA",
      bounds: { x: 320, y: 40, width: 90, height: 12 },
    });
    await renderElementsOverlay(canvas, [left, right], fabricMock);

    const texts = (
      canvas as unknown as { _objects: FakeObj[] }
    )._objects.filter((o) => o instanceof IText);
    expect(texts).toHaveLength(2);
  });

  it("preserves a WHITE text run's colour (header on a coloured band)", async () => {
    // White section headers ("A Identification") sit on a coloured band that is
    // baked into the text-free raster — so the white overlay must render WHITE
    // (never forced to black) to be visible over the band.
    const canvas = makeCanvas();
    const white = textElement({
      elementId: "w",
      content: "A Identification",
      style: { fontSize: 11, color: "#ffffff", fontFamily: "Helvetica" },
    });
    await renderElementsOverlay(canvas, [white], fabricMock);

    const it_ = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof IText,
    ) as IText;
    expect(it_.opts.fill).toBe("#ffffff");
    expect((it_.data as Record<string, unknown>).originalFill).toBe("#ffffff");
  });

  it("reveals a shape's real fill on selection and re-masks it on clear", async () => {
    const canvas = makeCanvas();
    const fire = (canvas as unknown as { fire: (e: string, p: unknown) => void })
      .fire;
    const shape = {
      type: "shape",
      elementId: "s3",
      shapeType: "rectangle",
      bounds: { x: 0, y: 0, width: 50, height: 50 },
      visible: true,
      locked: false,
      index: 9,
      geometry: {},
      style: {
        fillColor: "#00ff00",
        fillOpacity: 1,
        strokeColor: "#000000",
        strokeWidth: 3,
        strokeOpacity: 1,
      },
    } as unknown as Element;
    await renderElementsOverlay(canvas, [shape], fabricMock);

    const rect = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof Rect,
    ) as Rect;
    // Transparent in view…
    expect(rect.opts.fill).toBe("transparent");

    // …revealed (real fill/stroke/width) while selected…
    fire("selection:created", { selected: [rect] });
    expect(rect.opts.fill).toBe("#00ff00");
    expect(rect.opts.stroke).toBe("#000000");
    expect(rect.opts.strokeWidth).toBe(3);

    // …re-masked on deselection.
    fire("selection:cleared", {});
    expect(rect.opts.fill).toBe("transparent");
    expect(rect.opts.strokeWidth).toBe(0);
  });
});

// --- Editable form fields (fill the form directly on the page) ---------------

function formFieldElement(
  over: Partial<Record<string, unknown>> = {},
): Element {
  return {
    type: "form_field",
    elementId: "f1",
    fieldType: "text",
    fieldName: "lastName",
    value: "",
    defaultValue: "",
    options: null,
    properties: {
      required: false,
      readOnly: false,
      maxLength: null,
      multiline: false,
      password: false,
      comb: false,
    },
    style: {
      fontFamily: "Helvetica",
      fontSize: 11,
      textColor: "#0a3a8a",
      backgroundColor: null,
      borderColor: null,
      borderWidth: 0,
    },
    format: { type: "none", pattern: null },
    placeholder: "Last name",
    bounds: { x: 10, y: 20, width: 120, height: 16 },
    visible: true,
    locked: false,
    ...over,
  } as unknown as Element;
}

describe("renderElementsOverlay — editable form fields", () => {
  it("renders a TEXT field as an editable IText showing its value", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [formFieldElement({ value: "Dupont" })],
      fabricMock,
    );
    const it_ = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof IText,
    ) as IText;
    expect(it_).toBeDefined();
    expect(it_.text).toBe("Dupont");
    expect(it_.opts.editable).toBe(true);
    const data = it_.data as Record<string, unknown>;
    expect(data.type).toBe("form_field");
    expect(data.fieldType).toBe("text");
    expect(data.formFieldElement).toBeDefined();
  });

  it("shows the placeholder (greyed) for an empty TEXT field", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(canvas, [formFieldElement()], fabricMock);
    const it_ = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof IText,
    ) as IText;
    expect(it_.text).toBe("Last name");
    expect((it_.data as Record<string, unknown>).fieldShowingPlaceholder).toBe(
      true,
    );
    expect((it_.data as Record<string, unknown>).fieldPlaceholder).toBe(
      "Last name",
    );
  });

  it("shows BLANK (never the field name) for an empty TEXT field with no placeholder", async () => {
    const canvas = makeCanvas();
    // No AcroForm placeholder: the empty field must render blank, NOT the
    // internal field NAME ("lastName" / CERFA's "NOM PAR 2"). The name is
    // identity metadata, kept on data.fieldName for round-trip / side panel.
    await renderElementsOverlay(
      canvas,
      [formFieldElement({ placeholder: null })],
      fabricMock,
    );
    const it_ = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof IText,
    ) as IText;
    expect(it_.text).toBe("");
    const data = it_.data as Record<string, unknown>;
    expect(data.fieldPlaceholder).toBe("");
    // The field NAME is still available for the round-trip + side-panel label.
    expect(data.fieldName).toBe("lastName");
  });

  it("renders an empty LISTBOX (no options) as blank, not its field name", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [
        formFieldElement({
          elementId: "lb",
          fieldType: "listbox",
          fieldName: "country",
          options: [],
          value: "",
        }),
      ],
      fabricMock,
    );
    const it_ = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof IText,
    ) as IText;
    expect(it_.text).toBe("");
    expect((it_.data as Record<string, unknown>).fieldName).toBe("country");
  });

  it("renders a CHECKBOX as a clickable mark reflecting its checked state", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [
        formFieldElement({
          elementId: "cb",
          fieldType: "checkbox",
          fieldName: "agree",
          value: true,
        }),
      ],
      fabricMock,
    );
    const it_ = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof IText,
    ) as IText;
    expect(it_.text).toBe("☑");
    expect(it_.opts.editable).toBe(false);
    const data = it_.data as Record<string, unknown>;
    expect(data.fieldChecked).toBe(true);
    expect(data.fieldType).toBe("checkbox");
  });

  it("toggles a checkbox on click and fires object:modified", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [
        formFieldElement({
          elementId: "cb",
          fieldType: "checkbox",
          fieldName: "agree",
          value: false,
        }),
      ],
      fabricMock,
      { onElementSelected: vi.fn() },
    );
    const fire = (canvas as unknown as { fire: (e: string, p: unknown) => void })
      .fire;
    const it_ = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof IText,
    ) as IText;
    expect((it_.data as Record<string, unknown>).fieldChecked).toBe(false);

    let modifiedTarget: unknown = null;
    canvas.on("object:modified", (e) => {
      modifiedTarget = (e as { target?: unknown }).target;
    });
    fire("mouse:down", { target: it_ });

    expect((it_.data as Record<string, unknown>).fieldChecked).toBe(true);
    expect(it_.text).toBe("☑");
    expect(modifiedTarget).toBe(it_);
  });

  it("unchecks sibling radios of the same group when one is selected", async () => {
    const canvas = makeCanvas();
    const radios = ["yes", "no"].map((opt) =>
      formFieldElement({
        elementId: `r-${opt}`,
        fieldType: "radio",
        fieldName: "answer",
        options: [opt],
        value: opt === "yes" ? opt : "",
        bounds: { x: 10, y: opt === "yes" ? 20 : 50, width: 14, height: 14 },
      }),
    );
    await renderElementsOverlay(canvas, radios, fabricMock, {
      onElementSelected: vi.fn(),
    });
    const fire = (canvas as unknown as { fire: (e: string, p: unknown) => void })
      .fire;
    const marks = (
      canvas as unknown as { _objects: FakeObj[] }
    )._objects.filter((o) => o instanceof IText) as IText[];
    const yes = marks.find((m) => (m.data as Record<string, unknown>).elementId === "r-yes")!;
    const no = marks.find((m) => (m.data as Record<string, unknown>).elementId === "r-no")!;
    expect((yes.data as Record<string, unknown>).fieldChecked).toBe(true);

    // Click the "no" radio → it becomes checked, "yes" gets unchecked.
    fire("mouse:down", { target: no });
    expect((no.data as Record<string, unknown>).fieldChecked).toBe(true);
    expect((yes.data as Record<string, unknown>).fieldChecked).toBe(false);
  });

  it("renders a SIGNATURE field as a non-text hit-target Rect", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [
        formFieldElement({
          elementId: "sig",
          fieldType: "signature",
          fieldName: "sign",
          value: "",
        }),
      ],
      fabricMock,
    );
    const hasIText = (canvas as unknown as { _objects: FakeObj[] })._objects.some(
      (o) => o instanceof IText,
    );
    const rect = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof Rect,
    ) as Rect;
    expect(hasIText).toBe(false);
    expect(rect).toBeDefined();
    expect((rect.data as Record<string, unknown>).fieldType).toBe("signature");
    expect((rect.data as Record<string, unknown>).formFieldElement).toBeDefined();
  });

  it("renders a LISTBOX showing its options with the selected one marked", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [
        formFieldElement({
          elementId: "lb",
          fieldType: "listbox",
          fieldName: "country",
          options: ["France", "Spain", "Italy"],
          value: "Spain",
        }),
      ],
      fabricMock,
    );
    const it_ = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof IText,
    ) as IText;
    expect(it_).toBeDefined();
    // The selected option is prefixed with a marker; the others are not.
    expect(it_.text).toContain("▸ Spain");
    expect(it_.text).toContain("France");
    expect(it_.opts.editable).toBe(false);
    const data = it_.data as Record<string, unknown>;
    expect(data.fieldType).toBe("listbox");
    expect(data.formFieldElement).toBeDefined();
  });

  it("renders a BUTTON showing its label (centred, non-editable)", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [
        formFieldElement({
          elementId: "btn",
          fieldType: "button",
          fieldName: "submit",
          value: "Submit",
        }),
      ],
      fabricMock,
    );
    const it_ = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof IText,
    ) as IText;
    expect(it_).toBeDefined();
    expect(it_.text).toBe("Submit");
    expect(it_.opts.editable).toBe(false);
    expect(it_.opts.originX).toBe("center");
    expect((it_.data as Record<string, unknown>).fieldType).toBe("button");
  });
});

// --- Form fields: full-rect hit-target + AcroForm format fidelity ------------

describe("renderElementsOverlay — form-field hit-target & format", () => {
  it("adds a full-rect background/hit Rect BEHIND an empty TEXT field (widget bounds)", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(canvas, [formFieldElement()], fabricMock);
    const objects = (canvas as unknown as { _objects: FakeObj[] })._objects;
    const hit = objects.find(
      (o) => (o.data as Record<string, unknown>)?.isFieldHitTarget === true,
    ) as Rect;
    const it_ = objects.find((o) => o instanceof IText) as IText;
    expect(hit).toBeDefined();
    // The hit Rect covers the WHOLE widget rect — an empty field is clickable
    // anywhere inside (the IText alone has ~0 width when blank).
    expect(hit.opts.left).toBe(10);
    expect(hit.opts.top).toBe(20);
    expect(hit.opts.width).toBe(120);
    expect(hit.opts.height).toBe(16);
    expect(hit.opts.evented).toBe(true);
    expect(hit.opts.selectable).toBe(false);
    // Prefixed id → element lookups never resolve the chrome instead of the field.
    const data = hit.data as Record<string, unknown>;
    expect(data.elementId).toBe("hit:f1");
    expect(data.hitForElementId).toBe("f1");
    // Behind the value object (added first, stable-sorted tie).
    expect(objects.indexOf(hit)).toBeLessThan(objects.indexOf(it_));
  });

  it("anchors a /Q=center field at the box centre (originX center)", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [
        formFieldElement({
          value: "Centré",
          style: {
            fontFamily: "Helvetica",
            fontSize: 11,
            textColor: "#0a3a8a",
            backgroundColor: null,
            borderColor: null,
            borderWidth: 0,
            textAlign: "center",
          },
        }),
      ],
      fabricMock,
    );
    const it_ = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof IText,
    ) as IText;
    expect(it_.opts.originX).toBe("center");
    expect(it_.opts.left).toBe(10 + 120 / 2);
    expect(it_.opts.textAlign).toBe("center");
  });

  it("anchors a /Q=right field at the box right edge (originX right)", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [
        formFieldElement({
          value: "Droite",
          style: {
            fontFamily: "Helvetica",
            fontSize: 11,
            textColor: "#0a3a8a",
            backgroundColor: null,
            borderColor: null,
            borderWidth: 0,
            textAlign: "right",
          },
        }),
      ],
      fabricMock,
    );
    const it_ = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof IText,
    ) as IText;
    expect(it_.opts.originX).toBe("right");
    expect(it_.opts.left).toBe(10 + 120 - 2);
  });

  it("renders a MULTILINE field as a wrapping Textbox clipped to the widget rect", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [
        formFieldElement({
          value: "ligne 1\nligne 2",
          properties: {
            required: false,
            readOnly: false,
            maxLength: null,
            multiline: true,
            password: false,
            comb: false,
          },
        }),
      ],
      fabricMock,
    );
    const tb = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof Textbox,
    ) as Textbox;
    expect(tb).toBeDefined();
    expect(tb.text).toBe("ligne 1\nligne 2");
    // Fixed wrap width = widget width minus the inset.
    expect(tb.opts.width).toBe(120 - 4);
    // Clip to the widget rect (top-aligned) so overflow never paints outside.
    const clip = tb.opts.clipPath as Rect;
    expect(clip).toBeDefined();
    expect(clip.opts.left).toBe(10);
    expect(clip.opts.top).toBe(20);
    expect(clip.opts.width).toBe(120);
    expect(clip.opts.height).toBe(16);
    expect(clip.opts.absolutePositioned).toBe(true);
  });

  it("auto-sizes (/DA 0 Tf) a VALUED field to fit the widget width", async () => {
    const canvas = makeCanvas();
    const longValue = "1234567890123"; // 13 chars in a 120pt-wide box
    await renderElementsOverlay(
      canvas,
      [
        formFieldElement({
          value: longValue,
          style: {
            fontFamily: "Helvetica",
            fontSize: 0, // auto-size, propagated verbatim by the extractor
            textColor: "#0a3a8a",
            backgroundColor: null,
            borderColor: null,
            borderWidth: 0,
          },
        }),
      ],
      fabricMock,
    );
    const it_ = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof IText,
    ) as IText;
    // min(height*0.7, widthFit) = min(11.2, (120-4)/(0.5*13) ≈ 17.8) → 11.2
    expect(it_.opts.fontSize).toBeCloseTo(11.2, 5);
  });

  it("unchecks the OTHER named state of a multi-widget checkbox pair (Oui/non)", async () => {
    const canvas = makeCanvas();
    const pair = ["Oui", "non"].map((state) =>
      formFieldElement({
        elementId: `rat-${state}`,
        fieldType: "checkbox",
        fieldName: "RAT",
        onValue: state,
        // Field value = "Oui" → the Oui widget starts checked.
        value: "Oui",
        bounds: { x: 10, y: state === "Oui" ? 20 : 50, width: 14, height: 14 },
      }),
    );
    await renderElementsOverlay(canvas, pair, fabricMock, {
      onElementSelected: vi.fn(),
    });
    const fire = (canvas as unknown as { fire: (e: string, p: unknown) => void })
      .fire;
    const marks = (
      canvas as unknown as { _objects: FakeObj[] }
    )._objects.filter((o) => o instanceof IText) as IText[];
    const oui = marks.find(
      (m) => (m.data as Record<string, unknown>).elementId === "rat-Oui",
    )!;
    const non = marks.find(
      (m) => (m.data as Record<string, unknown>).elementId === "rat-non",
    )!;
    expect((oui.data as Record<string, unknown>).fieldChecked).toBe(true);
    expect((non.data as Record<string, unknown>).fieldChecked).toBe(false);

    const modified: unknown[] = [];
    canvas.on("object:modified", (e) => {
      modified.push((e as { target?: unknown }).target);
    });

    // Check "non" → "Oui" must uncheck (one field, one value), sibling first.
    fire("mouse:down", { target: non });
    expect((non.data as Record<string, unknown>).fieldChecked).toBe(true);
    expect((oui.data as Record<string, unknown>).fieldChecked).toBe(false);
    expect(modified[0]).toBe(oui); // sibling fires BEFORE the target
    expect(modified[1]).toBe(non); // target last → last-wins at bake time
  });

  it("delegates a click on the hit Rect to the checkbox toggle", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [
        formFieldElement({
          elementId: "cb",
          fieldType: "checkbox",
          fieldName: "agree",
          value: false,
        }),
      ],
      fabricMock,
      { onElementSelected: vi.fn() },
    );
    const objects = (canvas as unknown as { _objects: FakeObj[] })._objects;
    const hit = objects.find(
      (o) => (o.data as Record<string, unknown>)?.isFieldHitTarget === true,
    )!;
    const mark = objects.find((o) => o instanceof IText) as IText;
    const fire = (canvas as unknown as { fire: (e: string, p: unknown) => void })
      .fire;
    fire("mouse:down", { target: hit });
    expect((mark.data as Record<string, unknown>).fieldChecked).toBe(true);
    expect(mark.text).toBe("☑");
  });

  it("places the caret on a single click in Fill & Sign mode (mouse:up on the hit Rect)", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(canvas, [formFieldElement()], fabricMock, {
      onElementSelected: vi.fn(),
    });
    const objects = (canvas as unknown as { _objects: FakeObj[] })._objects;
    const hit = objects.find(
      (o) => (o.data as Record<string, unknown>)?.isFieldHitTarget === true,
    )!;
    const it_ = objects.find((o) => o instanceof IText) as IText & {
      enterEditing?: () => void;
      setCursorByClick?: (e: unknown) => void;
    };
    const enterEditing = vi.fn();
    const setCursorByClick = vi.fn();
    it_.enterEditing = enterEditing;
    it_.setCursorByClick = setCursorByClick;
    const fire = (canvas as unknown as { fire: (e: string, p: unknown) => void })
      .fire;

    // Outside Fill & Sign: no caret on single click (design behaviour intact).
    fire("mouse:up", { target: hit, e: {} });
    expect(enterEditing).not.toHaveBeenCalled();

    // In Fill & Sign (flag stamped live on the canvas by the editor surface).
    (canvas as unknown as { _gigaFillSignMode?: boolean })._gigaFillSignMode =
      true;
    fire("mouse:up", { target: hit, e: {} });
    expect(enterEditing).toHaveBeenCalledTimes(1);
    expect(setCursorByClick).toHaveBeenCalledTimes(1);
  });

  it("opens the signature capture on a signature-widget click in Fill & Sign", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [
        formFieldElement({
          elementId: "sig",
          fieldType: "signature",
          fieldName: "sign",
          value: "",
        }),
      ],
      fabricMock,
      { onElementSelected: vi.fn() },
    );
    const objects = (canvas as unknown as { _objects: FakeObj[] })._objects;
    const rect = objects.find((o) => o instanceof Rect)!;
    const onSignature = vi.fn();
    const meta = canvas as unknown as {
      _gigaFillSignMode?: boolean;
      _gigaOnSignatureFieldClick?: (el: unknown) => void;
    };
    const fire = (canvas as unknown as { fire: (e: string, p: unknown) => void })
      .fire;

    // Outside Fill & Sign: nothing happens (design selection untouched).
    meta._gigaOnSignatureFieldClick = onSignature;
    fire("mouse:down", { target: rect });
    expect(onSignature).not.toHaveBeenCalled();

    meta._gigaFillSignMode = true;
    fire("mouse:down", { target: rect });
    expect(onSignature).toHaveBeenCalledTimes(1);
    const arg = onSignature.mock.calls[0]![0] as { fieldName?: string };
    expect(arg.fieldName).toBe("sign");
  });

  it("selects the placed stamp (not the capture dialog) on a SIGNED widget click, and re-signs after deletion", async () => {
    const canvas = makeCanvas();
    const onElementSelected = vi.fn();
    await renderElementsOverlay(
      canvas,
      [
        formFieldElement({
          elementId: "sig",
          fieldType: "signature",
          fieldName: "sign",
          value: "",
        }),
      ],
      fabricMock,
      { onElementSelected },
    );
    const objects = (canvas as unknown as { _objects: FakeObj[] })._objects;
    const rect = objects.find((o) => o instanceof Rect)!;
    const onSignature = vi.fn();
    const meta = canvas as unknown as {
      _gigaFillSignMode?: boolean;
      _gigaOnSignatureFieldClick?: (el: unknown) => void;
    };
    meta._gigaFillSignMode = true;
    meta._gigaOnSignatureFieldClick = onSignature;
    const fire = (canvas as unknown as { fire: (e: string, p: unknown) => void })
      .fire;

    // A stamp image was inserted INTO the widget: editor-canvas `addImage`
    // links it at targeted insertion time via `data.signedWidgetId`.
    const stamp = new FakeObj({ left: 10, top: 10, width: 80, height: 30 });
    stamp.data = { elementId: "img1", signedWidgetId: "sig" };
    canvas.add(stamp as unknown as Parameters<typeof canvas.add>[0]);

    // Clicking the SIGNED widget selects the stamp (movable/resizable) —
    // the capture dialog must NOT reopen over the placed mark.
    fire("mouse:down", { target: rect });
    expect(onSignature).not.toHaveBeenCalled();
    expect(canvas.setActiveObject).toHaveBeenCalledWith(stamp);
    expect(onElementSelected).toHaveBeenCalledWith("img1");

    // Once the stamp is deleted, the widget becomes signable again: the next
    // click reopens the capture dialog.
    canvas.remove(stamp as unknown as Parameters<typeof canvas.remove>[0]);
    fire("mouse:down", { target: rect });
    expect(onSignature).toHaveBeenCalledTimes(1);
  });
});

// --- Annotation sub-types (real geometry, not approximations) ----------------

function annotationElement(
  over: Partial<Record<string, unknown>> = {},
): Element {
  return {
    type: "annotation",
    elementId: "a1",
    annotationType: "highlight",
    content: "",
    bounds: { x: 10, y: 20, width: 80, height: 12 },
    visible: true,
    locked: false,
    style: { color: "#ff0000", opacity: 1 },
    linkDestination: null,
    popup: null,
    ...over,
  } as unknown as Element;
}

describe("renderElementsOverlay — annotation sub-types", () => {
  it("renders a SQUIGGLY as a wavy Path (not a dashed line)", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [annotationElement({ annotationType: "squiggly" })],
      fabricMock,
    );
    const objects = (canvas as unknown as { _objects: FakeObj[] })._objects;
    const path = objects.find((o) => o instanceof Path) as Path;
    // Rendered as a Path (wavy), NOT a Line (the old dashed approximation).
    expect(path).toBeDefined();
    expect(objects.some((o) => o instanceof Line)).toBe(false);
    expect((path.data as Record<string, unknown>).annotationType).toBe(
      "squiggly",
    );
  });

  it("renders an ARROW as a single Path (shaft + filled head)", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [
        annotationElement({
          annotationType: "arrow",
          linePoints: { x1: 10, y1: 10, x2: 90, y2: 50 },
          style: { color: "#0000ff", opacity: 1, strokeWidth: 2 },
        }),
      ],
      fabricMock,
    );
    const objects = (canvas as unknown as { _objects: FakeObj[] })._objects;
    const path = objects.find((o) => o instanceof Path) as Path;
    expect(path).toBeDefined();
    // Exactly ONE object for the whole arrow (no Group, no duplicate).
    expect(objects.filter((o) => o instanceof Path)).toHaveLength(1);
    expect((path.data as Record<string, unknown>).annotationType).toBe("arrow");
    expect(path.opts.fill).toBe("#0000ff");
  });

  it("renders a LINE annotation from its explicit endpoints", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [
        annotationElement({
          annotationType: "line",
          linePoints: { x1: 5, y1: 5, x2: 95, y2: 5 },
        }),
      ],
      fabricMock,
    );
    const line = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof Line,
    ) as Line;
    expect(line).toBeDefined();
    expect((line.data as Record<string, unknown>).annotationType).toBe("line");
  });

  it("renders a FREETEXT annotation as an editable IText of its content", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [annotationElement({ annotationType: "freetext", content: "A note" })],
      fabricMock,
    );
    const it_ = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof IText,
    ) as IText;
    expect(it_).toBeDefined();
    expect(it_.text).toBe("A note");
    expect(it_.opts.editable).toBe(true);
    expect((it_.data as Record<string, unknown>).annotationType).toBe(
      "freetext",
    );
  });

  it("warns (does not silently drop) for an unknown annotation subtype", async () => {
    const canvas = makeCanvas();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await renderElementsOverlay(
      canvas,
      [annotationElement({ annotationType: "weird-kind" })],
      fabricMock,
    );
    // Still produces a hit-target Rect AND logs a warning.
    const rect = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof Rect,
    );
    expect(rect).toBeDefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// --- Image without a usable source → visible placeholder, not silent drop ----

describe("renderElementsOverlay — image placeholder", () => {
  it("renders a dashed placeholder (and warns) when an image has no dataUrl", async () => {
    const canvas = makeCanvas();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await renderElementsOverlay(
      canvas,
      [
        {
          type: "image",
          elementId: "img-broken",
          bounds: { x: 10, y: 20, width: 60, height: 40 },
          visible: true,
          locked: false,
          source: { type: "embedded", dataUrl: "" },
          style: { opacity: 1 },
        } as unknown as Element,
      ],
      fabricMock,
    );
    const rect = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof Rect,
    ) as Rect;
    expect(rect).toBeDefined();
    expect((rect.data as Record<string, unknown>).type).toBe("image");
    expect((rect.data as Record<string, unknown>).isImagePlaceholder).toBe(true);
    // Non-interactive so it is never serialised back as a shape on save.
    expect(rect.opts.selectable).toBe(false);
    expect(rect.opts.evented).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// --- Parsed vs new image overlays (opacity, z-order, selection-reveal) --------
//
// A PARSED image (carries an engine `index`) is already baked into the text-free
// raster, so its overlay must be an INVISIBLE (opacity 0) hit-target — like the
// shape overlays — otherwise a full-page parsed background image paints over the
// text and steals every click. A NEWLY-ADDED image (no `index`) is NOT in the
// raster, so it stays visible at its real opacity. In both cases the real
// opacity is stashed on data.originalOpacity for a lossless save.

describe("renderElementsOverlay — parsed vs new image overlays", () => {
  function imageElement(over: Partial<Record<string, unknown>> = {}): Element {
    return {
      type: "image",
      elementId: "img",
      bounds: { x: 0, y: 0, width: 100, height: 50 },
      visible: true,
      locked: false,
      source: {
        type: "embedded",
        dataUrl: "imgU",
        originalDimensions: { width: 100, height: 50 },
      },
      style: { opacity: 1 },
      ...over,
    } as unknown as Element;
  }

  const findImage = (canvas: unknown): FakeObj | undefined =>
    (canvas as { _objects: FakeObj[] })._objects.find(
      (o) => (o.data as Record<string, unknown> | undefined)?.type === "image",
    );

  it("renders a PARSED image overlay invisible (opacity 0) + stashes its real opacity", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [imageElement({ index: 4, style: { opacity: 0.8 } })],
      fabricMock,
      { resolveImageUrl: (u: string) => u },
    );
    const img = findImage(canvas)!;
    expect(img).toBeDefined();
    // Invisible in view (raster shows it), but the REAL opacity is preserved.
    expect(img.opts.opacity).toBe(0);
    const data = img.data as Record<string, unknown>;
    expect(data.originalOpacity).toBe(0.8);
    expect(data.isTransparentImageOverlay).toBe(true);
    expect(data.index).toBe(4);
  });

  it("renders a NEW image overlay VISIBLE at its real opacity (not a hit-target)", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [imageElement({ style: { opacity: 0.9 } })], // no index → newly added
      fabricMock,
      { resolveImageUrl: (u: string) => u },
    );
    const img = findImage(canvas)!;
    expect(img.opts.opacity).toBe(0.9);
    const data = img.data as Record<string, unknown>;
    expect(data.originalOpacity).toBe(0.9);
    expect(data.isTransparentImageOverlay).toBe(false);
    expect(data.index).toBeUndefined();
  });

  it("reveals a parsed image overlay on selection and re-hides it on clear", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [imageElement({ index: 2, style: { opacity: 0.75 } })],
      fabricMock,
      { resolveImageUrl: (u: string) => u },
    );
    const fire = (canvas as unknown as { fire: (e: string, p: unknown) => void })
      .fire;
    const img = findImage(canvas)!;
    expect(img.opts.opacity).toBe(0); // invisible in view…

    fire("selection:created", { selected: [img] });
    expect(img.opts.opacity).toBe(0.75); // …flashed at real opacity while selected…

    fire("selection:cleared", {});
    expect(img.opts.opacity).toBe(0); // …re-hidden on deselect.
  });

  it("does NOT reveal/re-hide a NEW image overlay (stays visible)", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [imageElement({ style: { opacity: 0.9 } })], // no index → new
      fabricMock,
      { resolveImageUrl: (u: string) => u },
    );
    const fire = (canvas as unknown as { fire: (e: string, p: unknown) => void })
      .fire;
    const img = findImage(canvas)!;
    expect(img.opts.opacity).toBe(0.9);
    fire("selection:created", { selected: [img] });
    expect(img.opts.opacity).toBe(0.9); // untouched (no isTransparentImageOverlay)
    fire("selection:cleared", {});
    expect(img.opts.opacity).toBe(0.9); // never forced to 0
  });

  it("stacks a parsed image overlay BELOW text (pitch-deck) — engine order beats promise order", async () => {
    const canvas = makeCanvas();
    // PDF background already on the canvas — must stay pinned at index 0.
    const bg = new FakeObj();
    bg.data = { isPdfBackground: true };
    (canvas as unknown as { add: (o: FakeObj) => void }).add(bg);

    // FabricImage that resolves imgB BEFORE imgA (the reverse of engine order),
    // so canvas.add fires B then A — proving the final z-order uses the engine
    // paint order, NOT the promise-resolution order.
    const oooFabric = {
      ...fabricMock,
      FabricImage: {
        fromURL: vi.fn(
          (url: string) =>
            new Promise<FakeObj>((resolve) =>
              setTimeout(() => resolve(new FakeObj()), url === "imgB" ? 0 : 20),
            ),
        ),
      },
    } as unknown as typeof import("fabric");

    const mkImg = (id: string, index: number, url: string): Element =>
      imageElement({
        elementId: id,
        index,
        bounds: { x: 0, y: 0, width: 400, height: 300 },
        source: {
          type: "embedded",
          dataUrl: url,
          originalDimensions: { width: 400, height: 300 },
        },
      });
    const text = textElement({
      elementId: "t",
      content: "Slide title",
      bounds: { x: 10, y: 20, width: 200, height: 14 },
    });

    await renderElementsOverlay(
      canvas,
      [mkImg("imgA", 0, "imgA"), text, mkImg("imgB", 1, "imgB")],
      oooFabric,
      { resolveImageUrl: (u: string) => u },
    );

    const objs = (canvas as unknown as { _objects: FakeObj[] })._objects;
    const idxOf = (id: string) =>
      objs.findIndex(
        (o) =>
          (o.data as Record<string, unknown> | undefined)?.elementId === id,
      );
    // Background stays at the very bottom.
    expect(objs[0]).toBe(bg);
    const iA = idxOf("imgA");
    const iB = idxOf("imgB");
    const iT = idxOf("t");
    // Both parsed images sit BELOW the text overlay (no more click-stealing).
    expect(iA).toBeLessThan(iT);
    expect(iB).toBeLessThan(iT);
    // Image-vs-image follows engine paint order, despite B resolving first.
    expect(iA).toBeLessThan(iB);
  });
});

// --- Paragraph grouping (Word-like multi-line editing) -----------------------

/**
 * A groupable text run: same style by default, body-text size 12, left edge at
 * x=40, regular line gap of 14 (≈ fontSize·lineHeight). Override bounds/content/
 * style to model the lines of a paragraph (or a deliberate style break).
 */
function paraRun(
  elementId: string,
  y: number,
  over: Partial<{
    x: number;
    width: number;
    content: string;
    index: number;
    style: Record<string, unknown>;
    linkUrl: string;
  }> = {},
): Element {
  return {
    type: "text",
    elementId,
    bounds: { x: over.x ?? 40, y, width: over.width ?? 300, height: 12 },
    visible: true,
    locked: false,
    content: over.content ?? `line ${elementId}`,
    ...(over.index !== undefined ? { index: over.index } : {}),
    ...(over.linkUrl ? { linkUrl: over.linkUrl } : {}),
    style: {
      fontSize: 12,
      color: "#000000",
      fontFamily: "Helvetica",
      lineHeight: 1.2,
      textAlign: "left",
      originalFont: "ABCDEF+Body",
      ...(over.style ?? {}),
    },
  } as unknown as Element;
}

describe("groupTextRunsIntoParagraphs (pure)", () => {
  it("groups consecutive same-style, regularly-spaced, left-aligned runs", () => {
    const runs = [
      paraRun("a", 100),
      paraRun("b", 114),
      paraRun("c", 128),
    ];
    const { paragraphs, standalone } = groupTextRunsIntoParagraphs(runs);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]!.runs.map((r) => r.elementId)).toEqual(["a", "b", "c"]);
    expect(standalone).toHaveLength(0);
  });

  it("does NOT group a single isolated line (title/label stays standalone)", () => {
    const { paragraphs, standalone } = groupTextRunsIntoParagraphs([
      paraRun("title", 50),
    ]);
    expect(paragraphs).toHaveLength(0);
    expect(standalone).toHaveLength(1);
  });

  it("breaks the paragraph on a font-size change (heading line)", () => {
    const runs = [
      paraRun("h", 100, { style: { fontSize: 20 } }), // heading
      paraRun("b1", 120),
      paraRun("b2", 134),
    ];
    const { paragraphs, standalone } = groupTextRunsIntoParagraphs(runs);
    // The heading stays alone; the two body lines form a paragraph.
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]!.runs.map((r) => r.elementId)).toEqual(["b1", "b2"]);
    expect(standalone.map((r) => r.elementId)).toContain("h");
  });

  it("breaks on a colour change (a differently-coloured note)", () => {
    const runs = [
      paraRun("a", 100),
      paraRun("b", 114, { style: { color: "#ff0000" } }),
    ];
    const { paragraphs } = groupTextRunsIntoParagraphs(runs);
    // Two single lines of different colour → no paragraph (each < 2 lines).
    expect(paragraphs).toHaveLength(0);
  });

  it("breaks on a large vertical gap (blank line / new block)", () => {
    const runs = [
      paraRun("a", 100),
      paraRun("b", 114),
      paraRun("c", 300), // far below → new block
    ];
    const { paragraphs, standalone } = groupTextRunsIntoParagraphs(runs);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]!.runs.map((r) => r.elementId)).toEqual(["a", "b"]);
    expect(standalone.map((r) => r.elementId)).toContain("c");
  });

  it("does NOT group runs in different columns (no horizontal overlap)", () => {
    const runs = [
      paraRun("L1", 100, { x: 40, width: 100 }),
      paraRun("R1", 100, { x: 400, width: 100 }), // same row, other column
      paraRun("L2", 114, { x: 40, width: 100 }),
      paraRun("R2", 114, { x: 400, width: 100 }),
    ];
    const { paragraphs } = groupTextRunsIntoParagraphs(runs);
    // Left column lines group together; right column lines group together — but
    // never across columns.
    expect(paragraphs).toHaveLength(2);
    for (const p of paragraphs) {
      const xs = p.runs.map((r) => r.bounds.x);
      expect(new Set(xs).size).toBe(1); // each paragraph is a single column
    }
  });

  it("does NOT fold a hyperlink run into a paragraph", () => {
    const runs = [
      paraRun("a", 100),
      paraRun("link", 114, { linkUrl: "https://example.com" }),
      paraRun("c", 128),
    ];
    const { paragraphs, standalone } = groupTextRunsIntoParagraphs(runs);
    // The link stays standalone; the non-link neighbours are NOT contiguous
    // through it (different gap), so they remain standalone too.
    expect(standalone.map((r) => r.elementId)).toContain("link");
    const grouped = paragraphs.flatMap((p) => p.runs.map((r) => r.elementId));
    expect(grouped).not.toContain("link");
  });

  it("does NOT group misaligned left edges (different indentation)", () => {
    const runs = [
      paraRun("a", 100, { x: 40 }),
      paraRun("b", 114, { x: 120 }), // indented far right → not the same block
    ];
    const { paragraphs } = groupTextRunsIntoParagraphs(runs);
    expect(paragraphs).toHaveLength(0);
  });

  it("groups lines that use DIFFERENT subsets of the SAME /BaseFont (prefix-aware)", () => {
    // originalFont now carries the exact subset (prefix kept). CERFA-style forms
    // paint consecutive lines of one paragraph with disjoint subsets of the same
    // font ("ABCDEF+X" vs "GHIJKL+X"); comparing the RAW originalFont would split
    // the paragraph. The subset prefix must be stripped so they still coalesce.
    const runs = [
      paraRun("a", 100, { style: { originalFont: "ABCDEF+TimesNewRomanPSMT" } }),
      paraRun("b", 114, { style: { originalFont: "GHIJKL+TimesNewRomanPSMT" } }),
    ];
    const { paragraphs } = groupTextRunsIntoParagraphs(runs);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]!.runs.map((r) => r.elementId)).toEqual(["a", "b"]);
  });

  it("does NOT group lines whose subsets denote DIFFERENT /BaseFonts", () => {
    const runs = [
      paraRun("a", 100, { style: { originalFont: "ABCDEF+TimesNewRomanPSMT" } }),
      paraRun("b", 114, { style: { originalFont: "GHIJKL+ArialMT" } }),
    ];
    const { paragraphs } = groupTextRunsIntoParagraphs(runs);
    expect(paragraphs).toHaveLength(0);
  });
});

describe("measuredLineHeightMultiple (pure)", () => {
  const run = (y: number): TextRun => paraRun(`r${y}`, y) as TextRun;

  it("derives the real ~10.5pt CERFA advance (≈1.05), NOT Word's 1.2", () => {
    // CERFA intro body: 10pt font, real line advance ~10.5pt → multiple ~1.05.
    const runs = [run(99.1), run(109.6), run(120.1), run(130.6)];
    const m = measuredLineHeightMultiple(runs, 10);
    expect(m).toBeCloseTo(1.05, 1);
    expect(m).toBeLessThan(1.2); // the fix: tighter than the hardcoded default
  });

  it("uses the MEDIAN so one blank-line gap cannot inflate the spacing", () => {
    // Four lines at ~10.5pt with a single 14pt sub-paragraph break in the middle.
    const runs = [run(100), run(110.5), run(124.5), run(135)];
    // gaps sorted: 10.5, 10.5, 14 → median index floor((3-1)/2)=1 → 10.5.
    expect(measuredLineHeightMultiple(runs, 10)).toBeCloseTo(1.05, 1);
  });

  it("falls back to 1.2 for a single line or degenerate input", () => {
    expect(measuredLineHeightMultiple([run(100)], 10)).toBe(1.2);
    expect(measuredLineHeightMultiple([], 10)).toBe(1.2);
    expect(measuredLineHeightMultiple([run(100), run(110)], 0)).toBe(1.2);
  });

  it("ignores same-line runs (≈0 vertical gap)", () => {
    // Two runs on the SAME visual line (left + right column) then a real 2nd line.
    const runs = [run(100), run(100), run(110.5)];
    expect(measuredLineHeightMultiple(runs, 10)).toBeCloseTo(1.05, 1);
  });

  it("clamps an absurd advance into a sane range", () => {
    expect(measuredLineHeightMultiple([run(0), run(1000)], 10)).toBe(3); // upper clamp
    expect(measuredLineHeightMultiple([run(0), run(1)], 10)).toBe(0.8); // lower clamp
  });
});

describe("hasUniformLineAdvance (pure)", () => {
  const run = (y: number): TextRun => paraRun(`r${y}`, y) as TextRun;

  it("is true for evenly-spaced lines (uniform Word-like paragraph)", () => {
    expect(hasUniformLineAdvance([run(100), run(110), run(120), run(130)])).toBe(
      true,
    );
  });

  it("is FALSE for the CERFA intro's mixed body/sub-paragraph advances", () => {
    // Real CERFA intro y's: ~10.5pt body advance with two ~14pt breaks → a
    // single Textbox lineHeight would drift, so it must render per-run.
    const runs = [99.1, 109.6, 119.7, 130.4, 144.3, 154.3, 168.1, 178.1].map(run);
    expect(hasUniformLineAdvance(runs)).toBe(false);
  });

  it("is trivially true for < 3 lines (at most one gap)", () => {
    expect(hasUniformLineAdvance([run(100), run(110)])).toBe(true);
    expect(hasUniformLineAdvance([run(100)])).toBe(true);
  });

  it("ignores same-line runs when judging uniformity", () => {
    // left+right run on each of two evenly-spaced lines → uniform.
    const runs = [run(100), run(100), run(110), run(110), run(120)];
    expect(hasUniformLineAdvance(runs)).toBe(true);
  });
});

describe("isCoherentCoalescedBlock (pure)", () => {
  // fontSize defaults to 12 ⇒ same-line < 4.8, contiguity > 30, xSpread > 36.
  const run = (y: number, x = 40): TextRun => paraRun(`r${y}_${x}`, y, { x }) as TextRun;
  const withSegments = (y: number): TextRun =>
    ({ ...(paraRun(`s${y}`, y) as unknown as TextRun), segments: [
      { text: "a", bounds: { x: 40, y, width: 6, height: 8 } },
      { text: "b", bounds: { x: 60, y, width: 6, height: 8 } },
    ] }) as unknown as TextRun;

  it("accepts a genuine 1-run-per-line, left-aligned, line-contiguous block", () => {
    expect(isCoherentCoalescedBlock([run(100), run(114), run(128)])).toBe(true);
  });

  it("rejects a block containing a justified / positioned (segmented) run", () => {
    // A TJ-positioned run's per-word geometry can't survive a wrapped Textbox.
    expect(isCoherentCoalescedBlock([run(100), withSegments(114)])).toBe(false);
  });

  it("rejects two runs on the SAME visual line (they would stack vertically)", () => {
    expect(isCoherentCoalescedBlock([run(100), run(100, 300)])).toBe(false);
  });

  it("rejects a footer↔header fusion (a jump far larger than one line)", () => {
    // The lib's pageBlocks mis-groups a footer run (y≈22) with a header run
    // (y≈792) into one "paragraph"/"cell" — a single Textbox cannot span it.
    expect(isCoherentCoalescedBlock([run(22), run(792)])).toBe(false);
  });

  it("rejects horizontally scattered runs (a space next to a far-away rule)", () => {
    // Two runs one line apart but 260pt apart in x → a left-aligned Textbox would
    // reflow the right run to the block's min-x. Not a single column.
    expect(isCoherentCoalescedBlock([run(100, 40), run(114, 300)])).toBe(false);
  });

  it("is trivially true for < 2 runs (never coalesced anyway)", () => {
    expect(isCoherentCoalescedBlock([run(100)])).toBe(true);
    expect(isCoherentCoalescedBlock([])).toBe(true);
  });
});

describe("renderElementsOverlay — justified-run segments", () => {
  it("paints ONE positioned IText per segment (not a single drifting box), all sharing the run's elementId/index", async () => {
    const canvas = makeCanvas();
    // A justified footer run the engine split into two positioned fragments.
    await renderElementsOverlay(
      canvas,
      [
        textElement({
          elementId: "run7",
          index: 7,
          content: "peuvent faire l'objet",
          bounds: { x: 30, y: 810, width: 40, height: 6.5 },
          style: { fontSize: 6.5, fontFamily: "Times New Roman" },
          segments: [
            { text: "peuvent faire", bounds: { x: 30, y: 810, width: 36, height: 6.5 } },
            { text: "l'objet", bounds: { x: 70, y: 810, width: 13, height: 6.5 } },
          ],
        }),
      ],
      fabricMock,
    );
    const objects = (canvas as unknown as { _objects: FakeObj[] })._objects;
    const segTexts = objects.filter(
      (o) => o instanceof IText && (o.data as Record<string, unknown>)?.isRunSegment === true,
    ) as IText[];
    expect(segTexts).toHaveLength(2);
    // Fragments carry the fragment text, at their own left, sharing run identity.
    expect(segTexts.map((o) => o.text)).toEqual(["peuvent faire", "l'objet"]);
    expect(segTexts.map((o) => o.opts.left)).toEqual([30, 70]);
    for (const o of segTexts) {
      expect((o.data as Record<string, unknown>).elementId).toBe("run7");
      expect((o.data as Record<string, unknown>).index).toBe(7);
    }
    // No extra single-box IText for the run (the fragments replace it).
    const plain = objects.filter(
      (o) => o instanceof IText && (o.data as Record<string, unknown>)?.isRunSegment !== true,
    );
    expect(plain).toHaveLength(0);
  });

  it("renders a plain run (no segments) as a single box, unchanged", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(canvas, [textElement()], fabricMock);
    const objects = (canvas as unknown as { _objects: FakeObj[] })._objects;
    expect(
      objects.filter((o) => o instanceof IText && (o.data as Record<string, unknown>)?.isRunSegment === true),
    ).toHaveLength(0);
    expect(objects.filter((o) => o instanceof IText)).toHaveLength(1);
  });
});

describe("applyFallbackWidthFit (pure)", () => {
  function fitObj(width: number) {
    const obj = {
      width,
      scaleX: 1,
      set(patch: { scaleX: number }) {
        this.scaleX = patch.scaleX;
      },
    };
    return obj;
  }

  it("applies a BOUNDED scaleX for a FALLBACK font that renders wider than bounds", () => {
    const obj = fitObj(110); // measured 110 vs target 100 → ratio 0.909... clamped
    const scaleX = applyFallbackWidthFit(obj, 100, /* usingEmbeddedFont */ false);
    // target/measured = 0.9090… < 0.92 → clamped UP to the 0.92 floor.
    expect(scaleX).toBeCloseTo(0.92, 5);
    expect(obj.scaleX).toBeCloseTo(0.92, 5);
  });

  it("uses the exact ratio when it sits inside [0.92, 1] (micro-overflow)", () => {
    const obj = fitObj(105); // 100/105 = 0.952… within bounds
    const scaleX = applyFallbackWidthFit(obj, 100, false);
    expect(scaleX).toBeCloseTo(100 / 105, 5);
    expect(scaleX).toBeGreaterThanOrEqual(0.92);
    expect(scaleX).toBeLessThanOrEqual(1);
    expect(obj.scaleX).toBeCloseTo(100 / 105, 5);
  });

  it("applies NO scaleX for the EXACT embedded font even when wider", () => {
    const obj = fitObj(140); // would overflow, but exact metrics must be trusted
    const scaleX = applyFallbackWidthFit(obj, 100, /* usingEmbeddedFont */ true);
    expect(scaleX).toBe(1);
    expect(obj.scaleX).toBe(1); // untouched — never squash exact text
  });

  it("never EXPANDS a fallback that fits (measured ≤ target)", () => {
    const obj = fitObj(80);
    const scaleX = applyFallbackWidthFit(obj, 100, false);
    expect(scaleX).toBe(1);
    expect(obj.scaleX).toBe(1);
  });

  it("is a no-op when the measured width is unknown (0/undefined)", () => {
    const obj = fitObj(0);
    expect(applyFallbackWidthFit(obj, 100, false)).toBe(1);
    expect(obj.scaleX).toBe(1);
  });
});

describe("applySegmentWidthFit (pure)", () => {
  function fitObj(width: number) {
    return {
      width,
      scaleX: 1,
      set(patch: { scaleX: number }) {
        this.scaleX = patch.scaleX;
      },
    };
  }

  it("fits a word rendered WIDER than its /Widths box — even for an EMBEDDED font", () => {
    // The whole point vs applyFallbackWidthFit: a per-word fragment must be shrunk to
    // its /Widths advance whatever the font, so browser hmtx over-width never eats the
    // inter-word gap. 110 measured vs 100 target → exact ratio (inside the 0.5 floor).
    const obj = fitObj(110);
    const scaleX = applySegmentWidthFit(obj, 100);
    expect(scaleX).toBeCloseTo(100 / 110, 5);
    expect(obj.scaleX).toBeCloseTo(100 / 110, 5);
  });

  it("never EXPANDS a word that already fits (measured ≤ target ⇒ keep the gap)", () => {
    const obj = fitObj(80);
    expect(applySegmentWidthFit(obj, 100)).toBe(1);
    expect(obj.scaleX).toBe(1);
  });

  it("clamps the shrink at a 0.5 floor so a mis-measured fallback never collapses", () => {
    const obj = fitObj(400); // ratio 0.25 → clamped to 0.5
    const scaleX = applySegmentWidthFit(obj, 100);
    expect(scaleX).toBe(0.5);
    expect(obj.scaleX).toBe(0.5);
  });

  it("is a no-op when the measured width is unknown (0)", () => {
    const obj = fitObj(0);
    expect(applySegmentWidthFit(obj, 100)).toBe(1);
    expect(obj.scaleX).toBe(1);
  });
});

describe("renderElementsOverlay — paragraph rendering (edit-intent)", () => {
  it("keeps per-run ITexts AT REST and tags them as one paragraph group", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [
        paraRun("a", 100, { content: "First line", index: 5 }),
        paraRun("b", 114, { content: "Second line", index: 6 }),
        paraRun("c", 128, { content: "Third line", index: 7 }),
      ],
      fabricMock,
    );
    const objects = (canvas as unknown as { _objects: FakeObj[] })._objects;
    // AT REST: the proven pixel-1:1 per-run render, no Textbox anywhere.
    expect(objects.filter((o) => o instanceof Textbox)).toHaveLength(0);
    const itexts = objects.filter((o) => o instanceof IText);
    expect(itexts).toHaveLength(3);
    // Every member carries the SAME group id + the shared descriptor.
    const groupIds = itexts.map(
      (o) => (o.data as Record<string, unknown>).paragraphGroupId,
    );
    expect(groupIds[0]).toBe("pg:a");
    expect(new Set(groupIds).size).toBe(1);
    const descriptor = (itexts[0]!.data as Record<string, unknown>)
      .paragraphGroup as { lines: Array<Array<{ elementId: string }>> };
    expect(descriptor.lines.map((l) => l.map((r) => r.elementId))).toEqual([
      ["a"],
      ["b"],
      ["c"],
    ]);
  });

  it("opens ONE multi-line Textbox session on edit intent and restores per-run on an unmodified exit", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [
        paraRun("a", 100, { content: "First line", index: 5 }),
        paraRun("b", 114, { content: "Second line", index: 6 }),
        paraRun("c", 128, { content: "Third line", index: 7 }),
      ],
      fabricMock,
    );
    const objects = (canvas as unknown as { _objects: FakeObj[] })._objects;
    const member = objects.find(
      (o) => (o.data as Record<string, unknown>)?.elementId === "b",
    )!;
    const session = beginParagraphEditSession(
      canvas,
      fabricMock,
      member as never,
    ) as unknown as Textbox;
    expect(session).toBeInstanceOf(Textbox);
    // The per-run members were lifted off; the session box is the only text.
    expect(objects.filter((o) => o instanceof IText)).toHaveLength(0);
    expect(session.text).toBe("First line\nSecond line\nThird line");
    expect(session.enterEditing).toHaveBeenCalled();
    const data = session.data as Record<string, unknown>;
    expect(data.isParagraph).toBe(true);
    expect(data.isParagraphSession).toBe(true);
    expect(data.elementId).toBe("a");
    // Session snapshot: per-line source runs with their engine indices.
    const lineRuns = data.lineRuns as Array<
      Array<{ elementId: string; index?: number }>
    >;
    expect(lineRuns.map((l) => l.map((r) => r.elementId))).toEqual([
      ["a"],
      ["b"],
      ["c"],
    ]);
    expect(lineRuns.flat().map((r) => r.index)).toEqual([5, 6, 7]);
    // Legacy flat snapshot kept for the block-delete / duplicate flows.
    const stashed = data.paragraphRuns as Array<{ elementId: string }>;
    expect(stashed.map((r) => r.elementId)).toEqual(["a", "b", "c"]);

    // UNMODIFIED exit → the exact same per-run objects come back, zero write.
    expect(restoreParagraphEditSession(canvas, session as never)).toBe(true);
    expect(objects.filter((o) => o instanceof Textbox)).toHaveLength(0);
    const restored = objects.filter((o) => o instanceof IText);
    expect(restored).toHaveLength(3);
    expect(restored.some((o) => o === member)).toBe(true);
  });

  it("renders a NON-UNIFORM block (mixed body/sub-paragraph advance) as per-run ITexts, not a drifting Textbox", async () => {
    // CERFA intro shape: ~10.5pt body advance with one wider ~14pt break. A
    // Fabric Textbox's single lineHeight cannot reproduce this without drift, so
    // the block must NOT coalesce — every line renders 1:1 at its own bounds.y.
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [
        paraRun("a", 100, { content: "line a" }),
        paraRun("b", 110.5, { content: "line b" }),
        paraRun("c", 121, { content: "line c" }),
        paraRun("d", 135, { content: "line d" }), // +14 break → non-uniform
      ],
      fabricMock,
    );
    const objects = (canvas as unknown as { _objects: FakeObj[] })._objects;
    expect(objects.filter((o) => o instanceof Textbox)).toHaveLength(0);
    expect(objects.filter((o) => o instanceof IText)).toHaveLength(4);
  });

  it("drives the SESSION Textbox's lineHeight from the measured line advance, not the hardcoded 1.2", async () => {
    // Uniform block, 12pt font, real 14pt advance → lineHeight 14/12 ≈ 1.166,
    // NOT the extractor's per-run style.lineHeight of 1.2.
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [paraRun("a", 100), paraRun("b", 114), paraRun("c", 128)],
      fabricMock,
    );
    const objects = (canvas as unknown as { _objects: FakeObj[] })._objects;
    const member = objects.find(
      (o) => (o.data as Record<string, unknown>)?.elementId === "a",
    )!;
    const session = beginParagraphEditSession(
      canvas,
      fabricMock,
      member as never,
    ) as unknown as Textbox;
    expect(session.opts.lineHeight as number).toBeCloseTo(14 / 12, 3);
  });

  it("keeps line-by-line IText when groupParagraphs is disabled", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [paraRun("a", 100), paraRun("b", 114), paraRun("c", 128)],
      fabricMock,
      { groupParagraphs: false },
    );
    const objects = (canvas as unknown as { _objects: FakeObj[] })._objects;
    expect(objects.filter((o) => o instanceof Textbox)).toHaveLength(0);
    expect(objects.filter((o) => o instanceof IText)).toHaveLength(3);
  });

  it("uses the embedded FontFace for the SESSION Textbox when available", async () => {
    const canvas = makeCanvas();
    const getFontFaceName = () => ({
      name: "gigapdf-doc-para",
      embedded: true,
      exact: true,
    });
    await renderElementsOverlay(
      canvas,
      [paraRun("a", 100), paraRun("b", 114)],
      fabricMock,
      { getFontFaceName },
    );
    const objects = (canvas as unknown as { _objects: FakeObj[] })._objects;
    const member = objects.find(
      (o) => (o.data as Record<string, unknown>)?.elementId === "a",
    )!;
    const session = beginParagraphEditSession(canvas, fabricMock, member as never, {
      getFontFaceName,
    }) as unknown as Textbox;
    expect(session.opts.fontFamily).toBe("gigapdf-doc-para");
    expect((session.data as Record<string, unknown>).usingEmbeddedFont).toBe(true);
  });

  it("leaves a lone line as a standalone IText (no Textbox)", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(canvas, [paraRun("only", 100)], fabricMock);
    const objects = (canvas as unknown as { _objects: FakeObj[] })._objects;
    expect(objects.filter((o) => o instanceof Textbox)).toHaveLength(0);
    expect(objects.filter((o) => o instanceof IText)).toHaveLength(1);
  });
});

// --- Engine block grouping (lib = source of structure) -----------------------

describe("pageBlockGroupsToParagraphs (pure)", () => {
  it("coalesces a paragraph block by matching source_index → element.index", () => {
    // Runs deliberately NOT positioned like a heuristic paragraph (varying x,
    // irregular gaps): only the engine grouping ties them together.
    const elements = [
      paraRun("a", 100, { index: 11, x: 40 }),
      paraRun("b", 400, { index: 12, x: 220 }),
      paraRun("c", 105, { index: 13, x: 80 }),
    ];
    const blockGroups: PageBlockGroup[] = [
      { kind: "paragraph", sourceIndices: [11, 12, 13] },
    ];
    const { paragraphs, standalone } = pageBlockGroupsToParagraphs(
      elements,
      blockGroups,
    );
    expect(paragraphs).toHaveLength(1);
    // Reading order follows the engine sourceIndices order, not the geometry.
    expect(paragraphs[0]!.runs.map((r) => r.elementId)).toEqual(["a", "b", "c"]);
    expect(standalone).toHaveLength(0);
  });

  it("treats a heading block (≥2 runs) as a group too", () => {
    const elements = [
      paraRun("h1", 50, { index: 1 }),
      paraRun("h2", 64, { index: 2 }),
    ];
    const { paragraphs } = pageBlockGroupsToParagraphs(elements, [
      { kind: "heading", sourceIndices: [1, 2] },
    ]);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]!.runs.map((r) => r.elementId)).toEqual(["h1", "h2"]);
  });

  it("skips a missing source_index and drops a group left with <2 runs", () => {
    const elements = [paraRun("a", 100, { index: 5 })];
    const { paragraphs, standalone } = pageBlockGroupsToParagraphs(elements, [
      { kind: "paragraph", sourceIndices: [5, 999] }, // 999 has no element
    ]);
    // Only one run resolved → not worth a Textbox → released to standalone.
    expect(paragraphs).toHaveLength(0);
    expect(standalone.map((r) => r.elementId)).toEqual(["a"]);
  });

  it("never claims the same run for two blocks", () => {
    const elements = [
      paraRun("a", 100, { index: 1 }),
      paraRun("b", 114, { index: 2 }),
      paraRun("c", 128, { index: 3 }),
    ];
    const { paragraphs } = pageBlockGroupsToParagraphs(elements, [
      { kind: "paragraph", sourceIndices: [1, 2] },
      { kind: "paragraph", sourceIndices: [2, 3] }, // 2 already consumed
    ]);
    // First block keeps [1,2]; second resolves only [3] → dropped.
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]!.runs.map((r) => r.elementId)).toEqual(["a", "b"]);
  });

  it("ignores non-paragraph/heading kinds (tables/lists keep element render)", () => {
    const elements = [
      paraRun("a", 100, { index: 1 }),
      paraRun("b", 114, { index: 2 }),
    ];
    const { paragraphs, standalone } = pageBlockGroupsToParagraphs(elements, [
      { kind: "table", sourceIndices: [1, 2] },
    ]);
    expect(paragraphs).toHaveLength(0);
    expect(standalone.map((r) => r.elementId)).toEqual(["a", "b"]);
  });

  it("leaves a run without an index standalone (not addressable by the lib)", () => {
    const withIdx = paraRun("a", 100, { index: 1 });
    const noIdx = paraRun("b", 114); // no index
    const { paragraphs, standalone } = pageBlockGroupsToParagraphs(
      [withIdx, noIdx],
      [{ kind: "paragraph", sourceIndices: [1] }],
    );
    expect(paragraphs).toHaveLength(0);
    expect(standalone.map((r) => r.elementId)).toEqual(["a", "b"]);
  });

  it("does NOT fold a hyperlink run even if the block lists it", () => {
    const elements = [
      paraRun("a", 100, { index: 1 }),
      paraRun("link", 114, { index: 2, linkUrl: "https://example.com" }),
      paraRun("c", 128, { index: 3 }),
    ];
    const { paragraphs, standalone } = pageBlockGroupsToParagraphs(elements, [
      { kind: "paragraph", sourceIndices: [1, 2, 3] },
    ]);
    // The link is ungroupable → excluded; the remaining two still form a block.
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]!.runs.map((r) => r.elementId)).toEqual(["a", "c"]);
    expect(standalone.map((r) => r.elementId)).toEqual(["link"]);
  });
});

describe("renderElementsOverlay — engine blockGroups drive paragraph grouping", () => {
  it("uses blockGroups over the positional heuristic and round-trips source indices", async () => {
    const canvas = makeCanvas();
    // A COHERENT block (one run per line, one normal line-advance apart) but with
    // a small left-edge offset (20pt > the heuristic's 6pt xTol) that the
    // positional heuristic rejects — so a paragraph GROUP can only form if the
    // engine blockGroups are honoured. At rest both runs still render per-run.
    await renderElementsOverlay(
      canvas,
      [
        paraRun("a", 100, { index: 21, content: "Intro line one" }),
        paraRun("b", 114, { index: 22, content: "Intro line two", x: 60 }),
      ],
      fabricMock,
      { blockGroups: [{ kind: "paragraph", sourceIndices: [21, 22] }] },
    );
    const objects = (canvas as unknown as { _objects: FakeObj[] })._objects;
    // At rest: per-run render, TAGGED as one group by the engine structure.
    expect(objects.filter((o) => o instanceof Textbox)).toHaveLength(0);
    const itexts = objects.filter((o) => o instanceof IText);
    expect(itexts).toHaveLength(2);
    expect(
      itexts.every(
        (o) => (o.data as Record<string, unknown>).paragraphGroupId === "pg:a",
      ),
    ).toBe(true);
    // The edit session round-trips the engine source indices per line.
    const session = beginParagraphEditSession(
      canvas,
      fabricMock,
      itexts[0] as never,
    ) as unknown as Textbox;
    expect(session.text).toBe("Intro line one\nIntro line two");
    const lineRuns = (session.data as Record<string, unknown>)
      .lineRuns as Array<Array<{ elementId: string; index?: number }>>;
    expect(lineRuns.flat().map((r) => r.elementId)).toEqual(["a", "b"]);
    expect(lineRuns.flat().map((r) => r.index)).toEqual([21, 22]);
  });

  it("consumes the lib `lines` structure: multi-run lines resolve per line", async () => {
    const canvas = makeCanvas();
    // One paragraph of TWO visual lines, the first made of TWO runs (the lib's
    // {t:'br'} structure) — the old one-run-per-line model could not express it.
    await renderElementsOverlay(
      canvas,
      [
        paraRun("a", 100, { index: 1, content: "Nom :", width: 40 }),
        paraRun("b", 100, { index: 2, content: "DUPONT", x: 90, width: 60 }),
        paraRun("c", 114, { index: 3, content: "Deuxième ligne" }),
      ],
      fabricMock,
      {
        blockGroups: [
          { kind: "paragraph", sourceIndices: [1, 2, 3], lines: [[1, 2], [3]] },
        ],
      },
    );
    const objects = (canvas as unknown as { _objects: FakeObj[] })._objects;
    const itexts = objects.filter((o) => o instanceof IText);
    expect(itexts).toHaveLength(3);
    const descriptor = (itexts[0]!.data as Record<string, unknown>)
      .paragraphGroup as { lines: Array<Array<{ elementId: string }>> };
    expect(descriptor.lines.map((l) => l.map((r) => r.elementId))).toEqual([
      ["a", "b"],
      ["c"],
    ]);
    // The session joins the same-line runs with a separating space.
    const session = beginParagraphEditSession(
      canvas,
      fabricMock,
      itexts[1] as never,
    ) as unknown as Textbox;
    expect(session.text).toBe("Nom : DUPONT\nDeuxième ligne");
  });

  it("falls back to the heuristic when no blockGroups are provided", async () => {
    const canvas = makeCanvas();
    // Same geometry, but WITHOUT blockGroups → the heuristic keeps them standalone
    // (the 20pt left-edge offset exceeds its 6pt xTol).
    await renderElementsOverlay(
      canvas,
      [
        paraRun("a", 100, { index: 21, content: "L1" }),
        paraRun("b", 114, { index: 22, content: "L2", x: 60 }),
      ],
      fabricMock,
    );
    const objects = (canvas as unknown as { _objects: FakeObj[] })._objects;
    expect(objects.filter((o) => o instanceof Textbox)).toHaveLength(0);
    expect(objects.filter((o) => o instanceof IText)).toHaveLength(2);
  });
});

// --- Table / list reconstruction (lib = source of structure) -----------------

/** A `table` PageBlockGroup with the given grid of per-cell source indices. */
function tableGroup(grid: number[][][]): PageBlockGroup {
  const cells = grid.flatMap((row, r) =>
    row.map((sourceIndices, c) => ({
      row: r,
      col: c,
      colSpan: 1,
      rowSpan: 1,
      sourceIndices,
    })),
  );
  return {
    kind: "table",
    sourceIndices: [],
    table: {
      rowCount: grid.length,
      colCount: grid[0]?.length ?? 0,
      colWidths: Array.from({ length: grid[0]?.length ?? 0 }, () => 100),
      rowHeights: grid.map(() => 20),
      cells,
    },
  };
}

/** A `list` PageBlockGroup whose items carry the given source indices. */
function listGroup(items: number[][]): PageBlockGroup {
  return {
    kind: "list",
    sourceIndices: [],
    list: {
      ordered: false,
      marker: "-",
      items: items.map((sourceIndices) => ({ level: 0, sourceIndices })),
    },
  };
}

describe("pageBlockGroupsToTablesAndLists (pure)", () => {
  it("folds a multi-run table cell into a paragraph group", () => {
    const elements = [
      paraRun("a", 100, { index: 1, content: "Cell L1" }),
      paraRun("b", 200, { index: 2, content: "Cell L2", x: 220 }),
      paraRun("c", 300, { index: 3, content: "Other cell" }),
    ];
    // Cell[0][0] = runs 1,2 (multi-line → folds); cell[0][1] = run 3 (single → not).
    const { paragraphs, standalone } = pageBlockGroupsToTablesAndLists(elements, [
      tableGroup([[[1, 2], [3]]]),
    ]);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]!.runs.map((r) => r.elementId)).toEqual(["a", "b"]);
    // The single-run cell stays standalone (already an identically-placed IText).
    expect(standalone.map((r) => r.elementId)).toEqual(["c"]);
  });

  it("leaves a table with no resolvable cell runs fully standalone", () => {
    // Cells reference indices that no element carries (the `source_index: null`
    // path) → nothing folded, every run stays element-rendered.
    const elements = [
      paraRun("a", 100, { index: 1 }),
      paraRun("b", 114, { index: 2 }),
    ];
    const { paragraphs, standalone } = pageBlockGroupsToTablesAndLists(elements, [
      tableGroup([[[91], [92]], [[93], [94]]]),
    ]);
    expect(paragraphs).toHaveLength(0);
    expect(standalone.map((r) => r.elementId)).toEqual(["a", "b"]);
  });

  it("folds a multi-run list item into a paragraph group", () => {
    const elements = [
      paraRun("a", 100, { index: 10, content: "Item line 1" }),
      paraRun("b", 200, { index: 11, content: "Item line 2", x: 220 }),
    ];
    const { paragraphs, standalone } = pageBlockGroupsToTablesAndLists(elements, [
      listGroup([[10, 11]]),
    ]);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]!.runs.map((r) => r.elementId)).toEqual(["a", "b"]);
    expect(standalone).toHaveLength(0);
  });

  it("ignores paragraph/heading groups (handled by the paragraph path)", () => {
    const elements = [
      paraRun("a", 100, { index: 1 }),
      paraRun("b", 114, { index: 2 }),
    ];
    const { paragraphs, standalone } = pageBlockGroupsToTablesAndLists(elements, [
      { kind: "paragraph", sourceIndices: [1, 2] },
    ]);
    expect(paragraphs).toHaveLength(0);
    expect(standalone.map((r) => r.elementId)).toEqual(["a", "b"]);
  });

  it("never claims the same run for two cells", () => {
    const elements = [
      paraRun("a", 100, { index: 1 }),
      paraRun("b", 114, { index: 2 }),
      paraRun("c", 128, { index: 3 }),
    ];
    // Cell A = [1,2], cell B = [2,3] (2 already consumed → B resolves only [3]).
    const { paragraphs } = pageBlockGroupsToTablesAndLists(elements, [
      tableGroup([[[1, 2], [2, 3]]]),
    ]);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]!.runs.map((r) => r.elementId)).toEqual(["a", "b"]);
  });

  it("bands two same-baseline cell runs into ONE visual line (label + value)", () => {
    const elements = [
      paraRun("label", 100, { index: 1, content: "Nom :", x: 40, width: 40 }),
      paraRun("value", 100, { index: 2, content: "DUPONT", x: 90, width: 60 }),
    ];
    const { paragraphs } = pageBlockGroupsToTablesAndLists(elements, [
      tableGroup([[[1, 2]]]),
    ]);
    expect(paragraphs).toHaveLength(1);
    const lines = paragraphs[0]!.lines!;
    expect(lines).toHaveLength(1);
    expect(lines[0]!.map((r) => r.elementId)).toEqual(["label", "value"]);
    // The banded single line clears the coherence gate — the synthetic
    // one-run-per-"line" model shared a top-Y and was rejected by the
    // strictly-descending rule, so such cells were never block-editable.
    expect(isCoherentLineGroup(lines)).toBe(true);
  });

  it("bands a 2-line × 2-run cell into TWO visual lines (x asc within, y asc across)", () => {
    // Deliberately out of visual order in sourceIndices: value before label.
    const elements = [
      paraRun("v1", 100, { index: 2, content: "DUPONT", x: 90, width: 60 }),
      paraRun("l1", 100, { index: 1, content: "Nom :", x: 40, width: 40 }),
      paraRun("l2", 114, { index: 3, content: "Prénom :", x: 40, width: 50 }),
      paraRun("v2", 114, { index: 4, content: "Jean", x: 100, width: 40 }),
    ];
    const { paragraphs } = pageBlockGroupsToTablesAndLists(elements, [
      tableGroup([[[2, 1, 3, 4]]]),
    ]);
    expect(paragraphs).toHaveLength(1);
    const lines = paragraphs[0]!.lines!;
    expect(lines.map((l) => l.map((r) => r.elementId))).toEqual([
      ["l1", "v1"],
      ["l2", "v2"],
    ]);
    // `runs` stays the flattening of `lines` (banded reading order).
    expect(paragraphs[0]!.runs.map((r) => r.elementId)).toEqual([
      "l1",
      "v1",
      "l2",
      "v2",
    ]);
    expect(isCoherentLineGroup(lines)).toBe(true);
  });

  it("keeps a mono-run-per-line cell unchanged (non-regression)", () => {
    const elements = [
      paraRun("a", 100, { index: 1, content: "Cell L1" }),
      paraRun("b", 114, { index: 2, content: "Cell L2" }),
      paraRun("c", 128, { index: 3, content: "Cell L3" }),
    ];
    const { paragraphs } = pageBlockGroupsToTablesAndLists(elements, [
      tableGroup([[[1, 2, 3]]]),
    ]);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]!.lines!.map((l) => l.map((r) => r.elementId))).toEqual([
      ["a"],
      ["b"],
      ["c"],
    ]);
    expect(paragraphs[0]!.runs.map((r) => r.elementId)).toEqual(["a", "b", "c"]);
  });

  it("keeps runs beyond the 0.5×fontSize banding tolerance on separate lines", () => {
    // fontSize 12 → tolerance 6pt: a 7pt top offset is a distinct baseline…
    const far = pageBlockGroupsToTablesAndLists(
      [
        paraRun("a", 100, { index: 1, content: "Ligne 1" }),
        paraRun("b", 107, { index: 2, content: "Ligne 2" }),
      ],
      [tableGroup([[[1, 2]]])],
    );
    expect(far.paragraphs).toHaveLength(1);
    expect(far.paragraphs[0]!.lines!.map((l) => l.map((r) => r.elementId))).toEqual([
      ["a"],
      ["b"],
    ]);
    // …while a 5pt offset (within the 6pt tolerance) still shares the line.
    const near = pageBlockGroupsToTablesAndLists(
      [
        paraRun("a", 100, { index: 1, content: "Nom :", x: 40, width: 40 }),
        paraRun("b", 105, { index: 2, content: "DUPONT", x: 90, width: 60 }),
      ],
      [tableGroup([[[1, 2]]])],
    );
    expect(near.paragraphs).toHaveLength(1);
    expect(near.paragraphs[0]!.lines!).toHaveLength(1);
    expect(near.paragraphs[0]!.lines![0]!.map((r) => r.elementId)).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("renderElementsOverlay — table/list reconstruction (edit-intent)", () => {
  it("tags a multi-run table cell as one group and opens its Textbox session", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [
        paraRun("a", 100, { index: 1, content: "Cell line A" }),
        paraRun("b", 114, { index: 2, content: "Cell line B" }),
      ],
      fabricMock,
      { blockGroups: [tableGroup([[[1, 2]]])] },
    );
    const objects = (canvas as unknown as { _objects: FakeObj[] })._objects;
    // At rest: per-run render (no Textbox), members tagged as one cell group.
    expect(objects.filter((o) => o instanceof Textbox)).toHaveLength(0);
    const itexts = objects.filter((o) => o instanceof IText);
    expect(itexts).toHaveLength(2);
    expect(
      itexts.every(
        (o) => (o.data as Record<string, unknown>).paragraphGroupId === "pg:a",
      ),
    ).toBe(true);
    // The cell edits as ONE session Textbox with lossless per-line indices.
    const session = beginParagraphEditSession(
      canvas,
      fabricMock,
      itexts[0] as never,
    ) as unknown as Textbox;
    expect(session.text).toBe("Cell line A\nCell line B");
    const data = session.data as Record<string, unknown>;
    expect(data.isParagraph).toBe(true);
    const stashed = data.paragraphRuns as Array<{ elementId: string; index?: number }>;
    expect(stashed.map((r) => r.index)).toEqual([1, 2]);
  });

  it("tags a multi-run list item and opens its Textbox session", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [
        paraRun("a", 100, { index: 5, content: "Bullet line 1" }),
        paraRun("b", 114, { index: 6, content: "Bullet line 2" }),
      ],
      fabricMock,
      { blockGroups: [listGroup([[5, 6]])] },
    );
    const objects = (canvas as unknown as { _objects: FakeObj[] })._objects;
    expect(objects.filter((o) => o instanceof Textbox)).toHaveLength(0);
    const itexts = objects.filter((o) => o instanceof IText);
    expect(itexts).toHaveLength(2);
    const session = beginParagraphEditSession(
      canvas,
      fabricMock,
      itexts[0] as never,
    ) as unknown as Textbox;
    expect(session.text).toBe("Bullet line 1\nBullet line 2");
  });

  it("tags a same-baseline label+value cell and joins its ONE session line", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [
        paraRun("a", 100, { index: 1, content: "Nom :", x: 40, width: 40 }),
        paraRun("b", 100, { index: 2, content: "DUPONT", x: 90, width: 60 }),
      ],
      fabricMock,
      { blockGroups: [tableGroup([[[1, 2]]])] },
    );
    const objects = (canvas as unknown as { _objects: FakeObj[] })._objects;
    // At rest: per-run render (pixel-1:1 path unchanged), members tagged.
    expect(objects.filter((o) => o instanceof Textbox)).toHaveLength(0);
    const itexts = objects.filter((o) => o instanceof IText);
    expect(itexts).toHaveLength(2);
    expect(
      itexts.every(
        (o) => (o.data as Record<string, unknown>).paragraphGroupId === "pg:a",
      ),
    ).toBe(true);
    // The banded line edits as ONE session joining the runs with a space.
    const session = beginParagraphEditSession(
      canvas,
      fabricMock,
      itexts[0] as never,
    ) as unknown as Textbox;
    expect(session.text).toBe("Nom : DUPONT");
  });

  it("FALLBACK: a table whose cell runs don't resolve renders element-by-element (no regression)", async () => {
    const canvas = makeCanvas();
    // The blockGroup references indices no element carries (source_index:null path).
    await renderElementsOverlay(
      canvas,
      [
        paraRun("a", 100, { index: 1, content: "X" }),
        paraRun("b", 300, { index: 2, content: "Y", x: 300 }),
      ],
      fabricMock,
      { blockGroups: [tableGroup([[[91], [92]]])] },
    );
    const objects = (canvas as unknown as { _objects: FakeObj[] })._objects;
    // No Textbox folded; both runs stay standalone IText — identical to today.
    expect(objects.filter((o) => o instanceof Textbox)).toHaveLength(0);
    expect(objects.filter((o) => o instanceof IText)).toHaveLength(2);
  });
});

// --- Per-line coherence gate (edit-intent successor of the run-level gate) ----

describe("isCoherentLineGroup (pure)", () => {
  const lr = (y: number, x = 40, width = 300, over: Record<string, unknown> = {}) =>
    paraRun(`r${y}-${x}`, y, { x, width, ...over }) as unknown as TextRun;

  it("accepts a genuine line-contiguous, single-column block", () => {
    expect(
      isCoherentLineGroup([[lr(100)], [lr(114)], [lr(128)]]),
    ).toBe(true);
  });

  it("accepts MULTI-RUN lines (the lib's {t:'br'} structure)", () => {
    // Two runs on line 1 (label + value), one on line 2 — the old run-level
    // gate rejected this ("two runs on the same visual line"); per-line it is
    // exactly what a paragraph looks like.
    expect(
      isCoherentLineGroup([
        [lr(100, 40, 40), lr(100, 90, 60)],
        [lr(114, 40, 110)],
      ]),
    ).toBe(true);
  });

  it("accepts a JUSTIFIED paragraph (segmented runs are no longer banned)", () => {
    const segmented = paraRun("seg", 100, {
      content: "mot un mot deux",
      width: 300,
    }) as unknown as TextRun;
    (segmented as unknown as { segments: unknown[] }).segments = [
      { text: "mot un", bounds: { x: 40, y: 100, width: 60, height: 12 } },
      { text: "mot deux", bounds: { x: 240, y: 100, width: 100, height: 12 } },
    ];
    expect(
      isCoherentLineGroup([[segmented], [lr(114)], [lr(128)]]),
    ).toBe(true);
  });

  it("rejects a gap far beyond the measured leading (footer↔header fusion)", () => {
    // 14pt leading then a 700pt jump — the lib should no longer emit this, but
    // the gate still refuses to coalesce across the page.
    expect(
      isCoherentLineGroup([[lr(100)], [lr(114)], [lr(814)]]),
    ).toBe(false);
  });

  it("rejects a TWO-line group whose lone gap dwarfs the font size (anchor)", () => {
    // With one gap the median IS the gap — the ≤3×fontSize anchor still keeps
    // a 200pt jump out (the two-run mis-fusions of dense forms).
    expect(isCoherentLineGroup([[lr(100)], [lr(300)]])).toBe(false);
  });

  it("accepts a generously-leaded but regular two-line paragraph", () => {
    expect(isCoherentLineGroup([[lr(100)], [lr(128)]])).toBe(true); // 28pt @12pt
  });

  it("rejects consecutive lines without horizontal overlap (side-by-side columns)", () => {
    expect(
      isCoherentLineGroup([[lr(100, 40, 100)], [lr(114, 400, 100)]]),
    ).toBe(false);
  });

  it("rejects two 'lines' sharing the same Y (broken line structure)", () => {
    expect(
      isCoherentLineGroup([[lr(100, 40, 100)], [lr(100, 200, 100)]]),
    ).toBe(false);
  });

  it("is trivially true for a single line / a lone run", () => {
    expect(isCoherentLineGroup([[lr(100), lr(100, 90)]])).toBe(true);
    expect(isCoherentLineGroup([[lr(100)]])).toBe(true);
    expect(isCoherentLineGroup([])).toBe(false);
  });
});

describe("joinLineRunContents (pure)", () => {
  const runWith = (content: string) =>
    paraRun(`j-${content}`, 100, { content }) as unknown as TextRun;

  it("injects a single space between two word-adjacent runs", () => {
    expect(joinLineRunContents([runWith("Nom :"), runWith("DUPONT")])).toBe(
      "Nom : DUPONT",
    );
  });

  it("does NOT double a space already carried by either side", () => {
    expect(joinLineRunContents([runWith("foo "), runWith("bar")])).toBe("foo bar");
    expect(joinLineRunContents([runWith("foo"), runWith(" bar")])).toBe("foo bar");
  });

  it("skips empty runs", () => {
    expect(joinLineRunContents([runWith(""), runWith("solo")])).toBe("solo");
  });
});

describe("beginParagraphEditSession — per-run character styles", () => {
  it("builds the styles map PER RUN (colour/size per range, not first-run-for-all)", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [
        paraRun("a", 100, {
          index: 1,
          content: "Rouge",
          width: 50,
          style: { color: "#ff0000", fontSize: 12 },
        }),
        paraRun("b", 100, {
          index: 2,
          content: "Bleu",
          x: 100,
          width: 40,
          style: { color: "#0000ff", fontSize: 14 },
        }),
        paraRun("c", 114, { index: 3, content: "Suite" }),
      ],
      fabricMock,
      {
        blockGroups: [
          { kind: "paragraph", sourceIndices: [1, 2, 3], lines: [[1, 2], [3]] },
        ],
      },
    );
    const objects = (canvas as unknown as { _objects: FakeObj[] })._objects;
    const member = objects.find(
      (o) => (o.data as Record<string, unknown>)?.elementId === "a",
    )!;
    const session = beginParagraphEditSession(
      canvas,
      fabricMock,
      member as never,
    ) as unknown as Textbox;
    expect(session.text).toBe("Rouge Bleu\nSuite");
    const styles = session.opts.styles as Record<
      number,
      Record<number, { fill?: string; fontSize?: number }>
    >;
    // "Rouge" chars 0..4 red @12; the injected space char 5 has no entry
    // (base style); "Bleu" chars 6..9 blue @14.
    expect(styles[0]![0]!.fill).toBe("#ff0000");
    expect(styles[0]![0]!.fontSize).toBe(12);
    expect(styles[0]![5]).toBeUndefined();
    expect(styles[0]![6]!.fill).toBe("#0000ff");
    expect(styles[0]![6]!.fontSize).toBe(14);
    // Line 2 carries its own run style.
    expect(styles[1]![0]!.fill).toBe("#000000");
  });

  it("positions/sizes the session box from the lib block frame when present", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [
        paraRun("a", 100, { index: 1, content: "L1" }),
        paraRun("b", 114, { index: 2, content: "L2" }),
      ],
      fabricMock,
      {
        blockGroups: [
          {
            kind: "paragraph",
            sourceIndices: [1, 2],
            lines: [[1], [2]],
            align: "justify",
            frame: { x: 44.4, y: 99.1, width: 506.6, height: 43.3 },
          },
        ],
      },
    );
    const objects = (canvas as unknown as { _objects: FakeObj[] })._objects;
    const member = objects.find(
      (o) => (o.data as Record<string, unknown>)?.elementId === "a",
    )!;
    const session = beginParagraphEditSession(
      canvas,
      fabricMock,
      member as never,
    ) as unknown as Textbox;
    expect(session.opts.left).toBeCloseTo(44.4);
    expect(session.opts.top).toBeCloseTo(99.1);
    expect(session.opts.width).toBeCloseTo(506.6);
    // The lib alignment drives the session box (justify supported by Fabric).
    expect(session.opts.textAlign).toBe("justify");
  });
});

// --- Block identity for ALL groups (c3) + click = block selection (c1) -------
// --- + hover affordance (c2) --------------------------------------------------

/** The rendered IText members of a canvas, in add order. */
function textMembersOf(canvas: ReturnType<typeof makeCanvas>): FakeObj[] {
  return (canvas as unknown as { _objects: FakeObj[] })._objects.filter(
    (o) =>
      o instanceof IText &&
      (o.data as Record<string, unknown> | undefined)?.paragraphGroupId !==
        undefined,
  );
}

/** Simulate a full Fabric CLICK on `target`: Fabric selects the target during
 *  mousedown (activeOn 'down'), then fires mouse:up with isClick. */
function simulateClick(
  canvas: ReturnType<typeof makeCanvas>,
  target: FakeObj | null,
  over: Partial<{
    scenePoint: { x: number; y: number };
    e: Record<string, unknown>;
    isClick: boolean;
    fabricSelectsTarget: boolean;
  }> = {},
): void {
  const fire = (canvas as unknown as { fire: (ev: string, e: unknown) => void })
    .fire;
  fire("mouse:down:before", { e: over.e ?? {} });
  // Fabric's own mousedown selection (skipped for a click on empty canvas or
  // when the target is already the active multi-selection).
  if (target && over.fabricSelectsTarget !== false) {
    canvas.setActiveObject(target as never);
  }
  fire("mouse:down", { target, e: over.e ?? {} });
  fire("mouse:up", {
    target,
    isClick: over.isClick ?? true,
    e: over.e ?? {},
    scenePoint: over.scenePoint ?? { x: 50, y: 110 },
  });
}

describe("renderElementsOverlay — block identity for EVERY group (gate → session only)", () => {
  // A table cell whose two runs sit at footer (y=16) and header (y=792) — the
  // classic dense-form mis-fusion the coherence gate exists for.
  const incoherentCellElements = () => [
    paraRun("foot", 16, { index: 1, content: "Footer legal" }),
    paraRun("head", 792, { index: 2, content: "VOLET 2" }),
  ];

  it("tags a gate-REJECTED group's members with the group id and sessionable:false", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(canvas, incoherentCellElements(), fabricMock, {
      blockGroups: [tableGroup([[[1, 2]]])],
    });
    const members = textMembersOf(canvas);
    expect(members).toHaveLength(2);
    for (const member of members) {
      const data = member.data as Record<string, unknown>;
      expect(data.paragraphGroupId).toBe("pg:foot");
      expect(data.paragraphSessionable).toBe(false);
    }
    // Rejected ⇒ no "text" hover cursor invitation (per-run edit stays).
    expect(
      members.every(
        (m) => (m as FakeObj & { hoverCursor?: string }).hoverCursor === undefined,
      ),
    ).toBe(true);
  });

  it("REFUSES the Textbox session on a gate-rejected member (double-click stays per-run)", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(canvas, incoherentCellElements(), fabricMock, {
      blockGroups: [tableGroup([[[1, 2]]])],
    });
    const members = textMembersOf(canvas);
    const session = beginParagraphEditSession(
      canvas,
      fabricMock,
      members[0] as never,
    );
    expect(session).toBeNull();
    // Nothing was lifted off the canvas — the per-run objects are untouched.
    expect(textMembersOf(canvas)).toHaveLength(2);
    expect(
      (canvas as unknown as { _objects: FakeObj[] })._objects.filter(
        (o) => o instanceof Textbox,
      ),
    ).toHaveLength(0);
  });

  it("keeps sessionable:true + the text hover cursor on a gate-ACCEPTED group (unchanged)", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [
        paraRun("a", 100, { index: 1, content: "L1" }),
        paraRun("b", 114, { index: 2, content: "L2" }),
      ],
      fabricMock,
      { blockGroups: [tableGroup([[[1, 2]]])] },
    );
    const members = textMembersOf(canvas);
    expect(members).toHaveLength(2);
    for (const member of members) {
      const data = member.data as Record<string, unknown>;
      expect(data.paragraphSessionable).toBe(true);
      expect((member as FakeObj & { hoverCursor?: string }).hoverCursor).toBe(
        "text",
      );
    }
    const session = beginParagraphEditSession(
      canvas,
      fabricMock,
      members[0] as never,
    );
    expect(session).not.toBeNull();
  });
});

describe("renderElementsOverlay — single click selects the paragraph BLOCK (c1)", () => {
  const coherentParagraph = () => [
    paraRun("a", 100, { index: 1, content: "First line" }),
    paraRun("b", 114, { index: 2, content: "Second line" }),
    paraRun("c", 128, { index: 3, content: "Third line" }),
  ];

  async function renderedParagraph() {
    const canvas = makeCanvas();
    await renderElementsOverlay(canvas, coherentParagraph(), fabricMock, {
      blockGroups: [
        { kind: "paragraph", sourceIndices: [1, 2, 3], lines: [[1], [2], [3]] },
      ],
    });
    return { canvas, members: textMembersOf(canvas) };
  }

  it("promotes a click on a member to an ActiveSelection of ALL the block's members", async () => {
    const { canvas, members } = await renderedParagraph();
    simulateClick(canvas, members[1]!);
    const active = canvas.getActiveObject() as unknown as ActiveSelection;
    expect(active).toBeInstanceOf(ActiveSelection);
    expect(
      active
        .getObjects()
        .map((o) => (o.data as Record<string, unknown>).elementId)
        .sort(),
    ).toEqual(["a", "b", "c"]);
    expect(members.every((m) => active.getObjects().includes(m))).toBe(true);
  });

  it("DRILLS DOWN to the run under the pointer when the block is already selected", async () => {
    const { canvas, members } = await renderedParagraph();
    simulateClick(canvas, members[1]!); // 1st click → block
    const block = canvas.getActiveObject() as unknown as FakeObj;
    expect(block).toBeInstanceOf(ActiveSelection);
    // 2nd click lands ON the live selection (Fabric targets it, no re-select
    // at mousedown), pointer over member "b" (baseline 128.64, bbox top 116.64).
    simulateClick(canvas, block, {
      fabricSelectsTarget: false,
      scenePoint: { x: 50, y: 120 },
    });
    expect(canvas.getActiveObject()).toBe(members[1]);
  });

  it("keeps the block selected when the drill-down click misses every member (padding)", async () => {
    const { canvas, members } = await renderedParagraph();
    simulateClick(canvas, members[0]!);
    const block = canvas.getActiveObject() as unknown as FakeObj;
    simulateClick(canvas, block, {
      fabricSelectsTarget: false,
      scenePoint: { x: 50, y: 115.5 }, // between line 1 and line 2 bboxes
    });
    expect(canvas.getActiveObject()).toBe(block);
  });

  it("keeps native single-run behaviour once drilled in (click on the run / a sibling)", async () => {
    const { canvas, members } = await renderedParagraph();
    // Drilled-in: member b is the active object. Clicking it again must NOT
    // re-promote (this is what lets the next click enter inline editing).
    canvas.setActiveObject(members[1] as never);
    simulateClick(canvas, members[1]!);
    expect(canvas.getActiveObject()).toBe(members[1]);
    // Clicking a SIBLING while drilled in selects that run natively too.
    simulateClick(canvas, members[2]!);
    expect(canvas.getActiveObject()).toBe(members[2]);
  });

  it("Alt+click targets the run directly (never the block)", async () => {
    const { canvas, members } = await renderedParagraph();
    simulateClick(canvas, members[0]!, { e: { altKey: true } });
    expect(canvas.getActiveObject()).toBe(members[0]);
  });

  it("leaves Shift/Ctrl multi-selection clicks to Fabric (no promotion)", async () => {
    const { canvas, members } = await renderedParagraph();
    simulateClick(canvas, members[0]!, { e: { shiftKey: true } });
    expect(canvas.getActiveObject()).toBe(members[0]);
    simulateClick(canvas, members[1]!, { e: { ctrlKey: true } });
    expect(canvas.getActiveObject()).toBe(members[1]);
  });

  it("ignores drags (isClick=false): a block move must not re-target the selection", async () => {
    const { canvas, members } = await renderedParagraph();
    simulateClick(canvas, members[0]!, { isClick: false });
    // Fabric's own mousedown selection stands; no ActiveSelection was built.
    expect(canvas.getActiveObject()).toBe(members[0]);
  });

  it("keeps the current behaviour for objects WITHOUT a group id", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(canvas, [textElement()], fabricMock);
    const lone = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof IText,
    )!;
    simulateClick(canvas, lone);
    expect(canvas.getActiveObject()).toBe(lone);
  });

  it("stays inert outside the select tool and in Fill & Sign mode (live stamps)", async () => {
    const { canvas, members } = await renderedParagraph();
    const meta = canvas as unknown as {
      _gigaCurrentTool?: string;
      _gigaFillSignMode?: boolean;
    };
    meta._gigaCurrentTool = "hand";
    simulateClick(canvas, members[0]!);
    expect(canvas.getActiveObject()).toBe(members[0]);
    meta._gigaCurrentTool = "select";
    meta._gigaFillSignMode = true;
    simulateClick(canvas, members[1]!);
    expect(canvas.getActiveObject()).toBe(members[1]);
    // Back to the plain select tool → the promotion works again (selection
    // cleared first: a same-group previous active reads as "drilled in").
    meta._gigaFillSignMode = false;
    canvas.discardActiveObject();
    simulateClick(canvas, members[2]!);
    expect(canvas.getActiveObject()).toBeInstanceOf(ActiveSelection);
  });

  it("also promotes a gate-REJECTED group (identity ≠ session)", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [
        paraRun("foot", 16, { index: 1, content: "Footer legal" }),
        paraRun("head", 792, { index: 2, content: "VOLET 2" }),
      ],
      fabricMock,
      { blockGroups: [tableGroup([[[1, 2]]])] },
    );
    const members = textMembersOf(canvas);
    simulateClick(canvas, members[0]!, { scenePoint: { x: 50, y: 25 } });
    const active = canvas.getActiveObject() as unknown as ActiveSelection;
    expect(active).toBeInstanceOf(ActiveSelection);
    expect(active.getObjects()).toHaveLength(2);
  });
});

describe("renderElementsOverlay — paragraph hover affordance (c2)", () => {
  async function renderedParagraph() {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [
        paraRun("a", 100, { index: 1, content: "First line" }),
        paraRun("b", 114, { index: 2, content: "Second line" }),
        paraRun("c", 128, { index: 3, content: "Third line" }),
      ],
      fabricMock,
      {
        blockGroups: [
          {
            kind: "paragraph",
            sourceIndices: [1, 2, 3],
            lines: [[1], [2], [3]],
          },
        ],
      },
    );
    return { canvas, members: textMembersOf(canvas) };
  }

  const outlineOf = (canvas: ReturnType<typeof makeCanvas>) =>
    (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) =>
        (o.data as Record<string, unknown> | undefined)
          ?.isParagraphHoverOutline === true,
    );

  it("draws a non-interactive outline around the UNION of the block on hover", async () => {
    const { canvas, members } = await renderedParagraph();
    const fire = (
      canvas as unknown as { fire: (ev: string, e: unknown) => void }
    ).fire;
    fire("mouse:over", { target: members[0] });
    const outline = outlineOf(canvas)!;
    expect(outline).toBeInstanceOf(Rect);
    // Pure chrome: never selectable/evented, never exported, no fill.
    expect(outline.opts.selectable).toBe(false);
    expect(outline.opts.evented).toBe(false);
    expect(outline.opts.excludeFromExport).toBe(true);
    expect(outline.opts.fill).toBe("transparent");
    expect(outline.opts.stroke).toBe("rgba(0, 100, 200, 0.35)");
    expect(outline.opts.strokeWidth).toBe(1);
    // Union of the members' absolute bboxes (baseline-anchored, fs 12: bbox =
    // [y + 0.22·fs, y + 1.22·fs] per line) + 2px pad. Lines at y 100/114/128
    // → union spans y 102.64 → 142.64 (height 40), x 40 → 340 (width 300).
    expect(outline.opts.left).toBeCloseTo(40 - 2);
    expect(outline.opts.top).toBeCloseTo(100 + 0.22 * 12 - 2);
    expect(outline.opts.width).toBeCloseTo(300 + 4);
    expect(outline.opts.height).toBeCloseTo(40 + 4);
    // No elementId → clearElementsOverlay ignores it; identity is the flag.
    expect((outline.data as Record<string, unknown>).elementId).toBeUndefined();
  });

  it("keeps ONE outline while moving between two members of the SAME block", async () => {
    const { canvas, members } = await renderedParagraph();
    const fire = (
      canvas as unknown as { fire: (ev: string, e: unknown) => void }
    ).fire;
    fire("mouse:over", { target: members[0] });
    const first = outlineOf(canvas);
    fire("mouse:out", { target: members[0], nextTarget: members[1] });
    expect(outlineOf(canvas)).toBe(first); // kept — same block
    fire("mouse:over", { target: members[1] });
    expect(outlineOf(canvas)).toBe(first); // not re-created either
  });

  it("removes the outline on mouse-out (to empty) and on mouse-down", async () => {
    const { canvas, members } = await renderedParagraph();
    const fire = (
      canvas as unknown as { fire: (ev: string, e: unknown) => void }
    ).fire;
    fire("mouse:over", { target: members[0] });
    expect(outlineOf(canvas)).toBeDefined();
    fire("mouse:out", { target: members[0], nextTarget: null });
    expect(outlineOf(canvas)).toBeUndefined();
    fire("mouse:over", { target: members[1] });
    expect(outlineOf(canvas)).toBeDefined();
    fire("mouse:down", { target: members[1] });
    expect(outlineOf(canvas)).toBeUndefined();
  });

  it("never leaks the outline into the save path (io seam + re-render sweep)", async () => {
    const { canvas, members } = await renderedParagraph();
    const fire = (
      canvas as unknown as { fire: (ev: string, e: unknown) => void }
    ).fire;
    fire("mouse:over", { target: members[0] });
    const outline = outlineOf(canvas)!;
    // The single serialisation seam refuses it → object:added/modified forward
    // nothing, the operations queue never sees it.
    expect(fabricObjectToElement(outline as never)).toBeNull();
    expect(fabricObjectToElements(outline as never)).toEqual([]);
    // A re-render sweeps a lingering outline (mouse:out may never fire once
    // the hovered member is re-created).
    await renderElementsOverlay(
      canvas,
      [paraRun("a", 100, { index: 1 }), paraRun("b", 114, { index: 2 })],
      fabricMock,
      {
        blockGroups: [
          { kind: "paragraph", sourceIndices: [1, 2], lines: [[1], [2]] },
        ],
      },
    );
    expect(outlineOf(canvas)).toBeUndefined();
  });

  it("shows no outline on a plain (ungrouped) text run", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(canvas, [textElement()], fabricMock);
    const fire = (
      canvas as unknown as { fire: (ev: string, e: unknown) => void }
    ).fire;
    const lone = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof IText,
    )!;
    fire("mouse:over", { target: lone });
    expect(outlineOf(canvas)).toBeUndefined();
  });
});
