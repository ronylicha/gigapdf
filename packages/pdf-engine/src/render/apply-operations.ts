/**
 * High-level entry point for applying a batch of element operations to a PDF.
 *
 * Two layered strategies, applied in order, so every edit takes the cleanest
 * path the engine can express:
 *
 *   ── In-place pass (preferred for text) ──────────────────────────────────
 *   When an `update`/`delete` targets a `text` element that carries a valid
 *   engine run `index` (from `GigaPdfDoc.textElements().index`) AND the change
 *   is expressible by the engine's font-aware in-place ops, we mutate the run
 *   directly:
 *     - text-content and/or position only  → `replaceText` (+ `moveElement`)
 *     - delete                             → `removeElement`
 *   Images and shapes carrying a valid unified `index` likewise edit in place:
 *     - move/resize (rotation unchanged)   → `transformElement`
 *     - shape fill/stroke/width/dash/alpha → `setPathStyle` (P3 "vector restyle")
 *     - image opacity                      → `setElementOpacity`
 *     - z-order (reorder)                  → `reorderElement`
 *     - delete                             → `removeElement`
 *   A pure shape STYLE change (geometry unchanged) is one `setPathStyle`; a
 *   combined geometry + style change is `transformElement` THEN `setPathStyle`
 *   on the SAME index (neither changes the element count, so indices stay
 *   valid). Opacity is now fully expressible in place: `setPathStyle` emits
 *   `/ca`/`/CA` via an `/ExtGState` for shapes (folded into the SAME restyle
 *   call as fill/stroke/width/dash), and `setElementOpacity` does the same for
 *   images. So an opacity-only change no longer forces the redact + add path.
 *   This rewrites the original content stream (font, size, colour and position
 *   preserved), so there is NO duplicate left behind and NO redaction needed —
 *   copy/paste in the result reveals exactly one run.
 *
 *   ── Redact + add fallback (everything else) ─────────────────────────────
 *   The canonical 2-pass pipeline, unchanged, for every op the in-place pass
 *   does not handle: no/invalid index, FORM-XObject text, style changes
 *   `replaceText` can't express (font/size/colour differ), non-text types and
 *   plain `add`s.
 *     Phase 1 — applyRedactions(bytes, redactionTargets) physically removes
 *               original glyphs/images/line-art from the oldBounds area of
 *               every fallback update + delete.
 *     Phase 2 — re-open the engine, run every add op (plus every fallback
 *               update re-cast as add at the NEW element bounds). Save.
 *
 * Re-architecture (in-place ↔ redact+add ordering)
 * =================================================
 * The in-place ops MUST run before the redact pass — but the redact pass needs
 * the bytes that result from those edits, not the original input. So we open a
 * mutating handle from the input, apply the in-place ops, `save()` to obtain
 * `afterInPlaceBytes`, then run the existing redact + add 2-pass on
 * `afterInPlaceBytes` for the REMAINING (fallback) ops only. In-place text
 * edits never move the OTHER elements on the page, so the redaction bounds of
 * the fallback ops still line up exactly with their on-page regions.
 *
 * Batch index stability
 * =====================
 * `removeElement` shifts the indices of every later run on the same page;
 * `reorderElement` MOVES an element's op range (to the end for front, the start
 * for back), which renumbers indices on the page too; `replaceText`/
 * `moveElement`/`transformElement`/`setPathStyle`/`setElementOpacity` do not
 * change the element count or order. The robust rule is therefore to process a
 * page's in-place ops in two phases:
 *   1. Count-/order-STABLE ops (replace/move/transform/restyle/opacity) and
 *      `remove` in DESCENDING index order — a remove can only invalidate HIGHER
 *      indices, which have already been processed, so a lower (not-yet-processed)
 *      index is never disturbed.
 *   2. `reorder` ops LAST, one at a time, each RE-READING the current element by
 *      its original identity is not needed because reorders are applied after all
 *      other edits and each `reorderElement` returns the post-move state; we
 *      apply reorders sequentially on the still-valid pre-reorder indices (no
 *      other reorder has run yet for the first, and we re-read between them).
 * If two in-place edits target the same `(page, index)` that's a caller bug:
 * last wins, logged.
 *
 * This is the single source of truth for the edit pipeline. All routes
 * (`/api/pdf/apply-elements`, `/api/pdf/text`, `/api/pdf/image`, and any
 * future single-element route) call this helper instead of the legacy
 * mask-based `updateText` / `updateImage` / `deleteElementArea`.
 */

import { openDocument, saveDocument, closeDocument } from '../engine/document-handle';
import type { PDFDocumentHandle } from '../engine/document-handle';
import { setFontCacheForHandle } from '../utils/font-cache-port';
import type { FontCachePort } from '../utils/font-cache-port';
import { addText } from './text-renderer';
import { addImage } from './image-renderer';
import { addShape } from './shape-renderer';
import { addAnnotation } from './annotation-renderer';
import { addFormField } from './form-renderer';
import { applyFieldValuesOnHandle } from '../forms/filler';
import { applyRedactions } from './engine-redact';
import type { RedactionTarget } from './engine-redact';
import { rgbToHex, hexToRgb01 } from '../utils';
import { webToPdf } from '../utils/coordinates';
import { engineLogger } from '../utils/logger';
import type {
  TextElement,
  ImageElement,
  ShapeElement,
  AnnotationElement,
  FormFieldElement,
  Bounds,
} from '@giga-pdf/types';

export interface ElementOperation {
  /**
   * `add`: materialise new content; `update`: redact oldBounds + add at
   * element.bounds; `delete`: redact bounds only; `reorder`: change the
   * element's paint order (z-order) in the PDF binary via `reorderElement`.
   */
  action: 'add' | 'update' | 'delete' | 'reorder';
  /** 1-based page number. */
  pageNumber: number;
  /** Element payload (must include `type`). For `delete`, only `bounds` may be present. For `reorder`, must carry the engine unified `index`. */
  element: Record<string, unknown>;
  /** Web-coordinate bounds of the area to redact (required for `update`, optional for `delete`). */
  oldBounds?: { x: number; y: number; width: number; height: number };
  /** For `reorder`: bring the element to the front (`true`) or send it to the back (`false`). */
  reorder?: { toFront: boolean };
}

export interface ApplyOperationsOptions {
  /** Optional Prisma-backed font cache for Type1/CFF→TTF conversion memoisation. */
  fontCache?: FontCachePort;
}

export interface ApplyOperationsResult {
  /** Final PDF bytes after the in-place pass and both fallback passes. */
  bytes: Uint8Array;
  /** Number of redaction targets accumulated from the FALLBACK update + delete ops. */
  redactionTargetsCount: number;
  /** Number of redactions the engine actually applied (may be smaller if some pages were out of range). */
  redactionsApplied: number;
  /** True when Phase 1 redaction completed successfully. False when it errored and we fell back. */
  redactionSucceeded: boolean;
  /** Number of `add` (+ re-cast fallback `update`) ops applied in Phase 2. */
  addsApplied: number;
  /** Number of `replaceText` in-place text-content edits applied. */
  inPlaceReplaced: number;
  /** Number of `moveElement` in-place repositions applied. */
  inPlaceMoved: number;
  /** Number of `transformElement` in-place affine edits applied (image/shape move/resize). */
  inPlaceTransformed: number;
  /** Number of `setPathStyle` in-place shape restyles applied (fill/stroke/width/dash/opacity). */
  inPlaceRestyled: number;
  /** Number of `setElementOpacity` in-place image-opacity edits applied. */
  inPlaceOpacitySet: number;
  /** Number of `reorderElement` in-place z-order edits applied. */
  inPlaceReordered: number;
  /** Number of `removeElement` in-place deletes applied. */
  inPlaceRemoved: number;
  /**
   * Number of EXISTING form fields whose VALUE was filled in place via the real
   * form setters (`applyFieldValuesOnHandle`) — a fill-mode `update` (geometry
   * unchanged) never takes the redact + re-add path, which would duplicate the
   * field and reset its `/DA`//`/Q`/comb identity.
   */
  formFieldsFilled: number;
}

type ImageDataExtractor = (element: Record<string, unknown>) => Uint8Array | undefined;

/**
 * Default image-data extractor: pulls `element.source.dataUrl` (base64 data
 * URL) and decodes it via Node's Buffer. Callers can override via
 * `applyOperations(bytes, ops, { extractImageData })` to support other
 * image-source schemes (S3 object refs, FormData blobs, etc.).
 */
const defaultExtractImageData: ImageDataExtractor = (element) => {
  const source = element['source'] as Record<string, unknown> | undefined;
  if (!source) return undefined;
  const dataUrl = source['dataUrl'];
  if (typeof dataUrl !== 'string' || !dataUrl) return undefined;
  const commaIndex = dataUrl.indexOf(',');
  const base64 = commaIndex !== -1 ? dataUrl.slice(commaIndex + 1) : dataUrl;
  return new Uint8Array(Buffer.from(base64, 'base64'));
};

// ── In-place helpers ───────────────────────────────────────────────────────

/** Largest array index the engine accepts (anything `>=` this is a sentinel). */
const MAX_RUN_INDEX = 2 ** 31;

/** A position delta below this (in PDF points) is treated as "no move". */
const MOVE_TOLERANCE = 0.5;

/** A rotation delta below this (in degrees) is treated as "rotation unchanged". */
const ROTATION_TOLERANCE = 0.5;

/**
 * A form-field widget whose old/new bounds differ by less than this (in web
 * points, every axis) is treated as "geometry unchanged" — the `update` is a
 * fill-mode VALUE change and is routed to the real form setters instead of the
 * destructive redact + re-add fallback.
 */
const FORM_GEOMETRY_TOLERANCE = 0.5;

/** Whether two web-space boxes are equal within {@link FORM_GEOMETRY_TOLERANCE}. */
function formGeometryUnchanged(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    Math.abs(a.x - b.x) <= FORM_GEOMETRY_TOLERANCE &&
    Math.abs(a.y - b.y) <= FORM_GEOMETRY_TOLERANCE &&
    Math.abs(a.width - b.width) <= FORM_GEOMETRY_TOLERANCE &&
    Math.abs(a.height - b.height) <= FORM_GEOMETRY_TOLERANCE
  );
}

/** One fill-mode form-field update routed to `applyFieldValuesOnHandle`. */
interface FormFillOp {
  pageNumber: number;
  element: Record<string, unknown>;
  fieldName: string;
  value: string | boolean | string[];
  originalIndex: number;
}

/**
 * Whether two rotation angles (degrees) are equal within `ROTATION_TOLERANCE`,
 * normalising both into `[0, 360)` first so e.g. `-90` and `270` compare equal.
 */
function rotationUnchanged(a: number, b: number): boolean {
  const norm = (deg: number) => ((deg % 360) + 360) % 360;
  const d = Math.abs(norm(a) - norm(b));
  return Math.min(d, 360 - d) <= ROTATION_TOLERANCE;
}

/**
 * Validate an engine run index. The engine assigns a negative sentinel (e.g.
 * `-1`) — and could assign a huge out-of-range value — to FORM-XObject text it
 * cannot edit in place; both are rejected so such ops take the safe fallback.
 */
function isValidRunIndex(index: unknown): index is number {
  return (
    typeof index === 'number' &&
    Number.isInteger(index) &&
    index >= 0 &&
    index < MAX_RUN_INDEX
  );
}

/**
 * Whether the NEW text element keeps the SAME font family, size and colour as
 * the engine run it targets — i.e. only its text and/or position changed.
 * `replaceText` re-encodes the run through its existing font and cannot change
 * the typeface, point size or fill colour, so a mismatch must fall back to the
 * redact + add path (which materialises a brand-new run with the new style).
 */
function styleMatchesRun(
  element: TextElement,
  run: { fontFamily: string; baseFont?: string; bold: boolean; italic: boolean; fontSize: number; color: [number, number, number] },
): boolean {
  const style = element.style;
  if (!style) return false;

  // Font size — within a sub-point tolerance (the engine reports the effective
  // glyph size, which can carry tiny rounding vs the editor's stored value).
  if (Math.abs(style.fontSize - run.fontSize) > 0.5) return false;

  // Weight / slant — the editor models these as `fontWeight`/`fontStyle`.
  const runBold = run.bold ? 'bold' : 'normal';
  const runItalic = run.italic ? 'italic' : 'normal';
  if ((style.fontWeight ?? 'normal') !== runBold) return false;
  if ((style.fontStyle ?? 'normal') !== runItalic) return false;

  // Fill colour — compare as normalised `#rrggbb`. The run colour is an
  // engine RGB triple (0..1 per channel); reuse the same hex conversion the
  // extractor applies so the comparison is exact.
  const runHex = rgbToHex(run.color[0], run.color[1], run.color[2]).toLowerCase();
  const elementHex = (style.color ?? '').toLowerCase();
  if (elementHex !== runHex) return false;

  // Font family — compare case-insensitively. `originalFont` now carries the
  // run's EXACT `/BaseFont` (subset prefix kept) for embedded-font fidelity, so
  // accept a match on EITHER the raw `/BaseFont` the run reports OR the collapsed
  // family (legacy saved elements / Type3 runs whose `originalFont` is the family).
  const runFamily = run.fontFamily.toLowerCase();
  const runBaseFont = (run.baseFont ?? '').toLowerCase();
  const elementFamily = (style.originalFont ?? style.fontFamily ?? '').toLowerCase();
  if (elementFamily !== runFamily && (!runBaseFont || elementFamily !== runBaseFont)) {
    return false;
  }

  return true;
}

/** The `style` payload `setPathStyle` accepts (only the changed fields are set). */
type PathStyleOverride = {
  fill?: [number, number, number];
  stroke?: [number, number, number];
  strokeWidth?: number;
  fillAlpha?: number;
  strokeAlpha?: number;
  dash?: number[];
};

/** One classified in-place op, resolved against the element currently at `index`. */
interface InPlaceOp {
  pageNumber: number;
  index: number;
  /**
   * `replace`: set new text (+ optional move) on a TEXT run.
   * `transform`: apply an affine `matrix` to an IMAGE/SHAPE element in place.
   * `restyle`: re-style a SHAPE path via `setPathStyle` (fill/stroke/width/dash
   *   and/or fill/stroke alpha), optionally preceded by an affine `matrix` when
   *   geometry ALSO changed — both on the same index.
   * `setOpacity`: set a constant opacity on an IMAGE element via
   *   `setElementOpacity` (optionally preceded by a geometry `matrix`).
   * `reorder`: change z-order via `reorderElement` (text/image/shape).
   * `remove`: delete the element (text/image/shape).
   */
  kind: 'replace' | 'transform' | 'restyle' | 'setOpacity' | 'reorder' | 'remove';
  /** New text content (for `replace`). */
  newText?: string;
  /** PDF-space deltas for an accompanying `moveElement` (for `replace`). */
  move?: { dx: number; dy: number };
  /** Affine matrix `[a,b,c,d,e,f]` for `transformElement` (for `transform`/`restyle`/`setOpacity`). */
  matrix?: [number, number, number, number, number, number];
  /** Style override for `setPathStyle` (for `restyle`) — only changed fields. */
  style?: PathStyleOverride;
  /** Constant fill alpha for `setElementOpacity` (for `setOpacity`), 0..1. */
  opacity?: number;
  /** Bring to front (`true`) or send to back (`false`) for `reorder`. */
  toFront?: boolean;
  /** Diagnostics. */
  originalIndex: number;
}

/** A shape's current paint as reported by the engine's `vectorPaths()`. */
interface OriginalPathStyle {
  fill: [number, number, number] | null;
  stroke: [number, number, number] | null;
  strokeWidth: number;
  dash: number[];
}

/** A short tolerance (in PDF points) for the stroke-width "unchanged" test. */
const STROKE_WIDTH_TOLERANCE = 0.01;

/** Whether two dash arrays are equal element-by-element. */
function dashArraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i]! - b[i]!) > 1e-6) return false;
  }
  return true;
}

/**
 * Classify a shape `update`'s STYLE delta against the path's current paint.
 *
 * Returns:
 *  - `null` when nothing restylable changed (fill/stroke/width/dash all equal);
 *  - `{ expressible: false }` when a change exists but `setPathStyle` cannot
 *    express it (turning a fill/stroke on or off — `setPathStyle` only OVERRIDES
 *    an existing paint, it can't add/remove one) → caller must fall back;
 *  - `{ expressible: true, style }` with ONLY the changed, expressible fields.
 *
 * Colours compare via `#rrggbb` (reusing the extractor's conversion) so the test
 * is exact; the engine RGB triples are 0..1 per channel. NOTE: opacity is NOT
 * considered here — it's classified separately and always forces a fallback.
 */
function computeShapeStyleChange(
  element: ShapeElement,
  original: OriginalPathStyle,
): null | { expressible: false } | { expressible: true; style: PathStyleOverride } {
  const style = element.style;
  if (!style) return null;

  const oldFillHex = original.fill
    ? rgbToHex(original.fill[0], original.fill[1], original.fill[2]).toLowerCase()
    : null;
  const oldStrokeHex = original.stroke
    ? rgbToHex(original.stroke[0], original.stroke[1], original.stroke[2]).toLowerCase()
    : null;
  const newFillHex = style.fillColor ? style.fillColor.toLowerCase() : null;
  const newStrokeHex = style.strokeColor ? style.strokeColor.toLowerCase() : null;

  const out: PathStyleOverride = {};
  let changed = false;

  // Fill — a null↔non-null transition can't be expressed (add/remove paint).
  if (newFillHex !== oldFillHex) {
    if (newFillHex === null || oldFillHex === null) return { expressible: false };
    out.fill = hexToRgb01(newFillHex);
    changed = true;
  }

  // Stroke colour — same null↔non-null guard.
  if (newStrokeHex !== oldStrokeHex) {
    if (newStrokeHex === null || oldStrokeHex === null) return { expressible: false };
    out.stroke = hexToRgb01(newStrokeHex);
    changed = true;
  }

  // Stroke width — only meaningful (and only emittable) when the path is stroked.
  const newWidth = style.strokeWidth ?? 0;
  if (oldStrokeHex !== null && Math.abs(newWidth - original.strokeWidth) > STROKE_WIDTH_TOLERANCE) {
    out.strokeWidth = newWidth;
    changed = true;
  }

  // Dash pattern.
  const newDash = style.strokeDashArray ?? [];
  if (!dashArraysEqual(newDash, original.dash)) {
    out.dash = [...newDash];
    changed = true;
  }

  if (!changed) return null;
  return { expressible: true, style: out };
}

/** Small tolerance (per channel, 0..1) for the alpha "unchanged" test. */
const OPACITY_TOLERANCE = 1e-3;

/**
 * Classify a shape's OPACITY (fill/stroke alpha) delta vs the path's current
 * alpha. Opacity IS now expressible in place: `setPathStyle` emits `/ca`/`/CA`
 * via an `/ExtGState`, so a changed fill/stroke alpha is folded into the SAME
 * `setPathStyle` override as fill/stroke/width/dash. Returns the changed alpha
 * fields only (`{}` when nothing changed). A fill/stroke alpha is only emitted
 * when the path actually has that paint (`hasFill`/`hasStroke`) — setting an
 * alpha on a non-existent paint would be meaningless.
 */
function computeShapeOpacityChange(
  element: ShapeElement,
  original: { fillAlpha: number; strokeAlpha: number; hasFill: boolean; hasStroke: boolean },
): Pick<PathStyleOverride, 'fillAlpha' | 'strokeAlpha'> {
  const out: Pick<PathStyleOverride, 'fillAlpha' | 'strokeAlpha'> = {};
  const style = element.style;
  if (!style) return out;
  const newFillAlpha = style.fillOpacity ?? 1;
  if (original.hasFill && Math.abs(newFillAlpha - original.fillAlpha) > OPACITY_TOLERANCE) {
    out.fillAlpha = Math.max(0, Math.min(1, newFillAlpha));
  }
  const newStrokeAlpha = style.strokeOpacity ?? 1;
  if (original.hasStroke && Math.abs(newStrokeAlpha - original.strokeAlpha) > OPACITY_TOLERANCE) {
    out.strokeAlpha = Math.max(0, Math.min(1, newStrokeAlpha));
  }
  return out;
}

/** Element types eligible for index-based in-place edits beyond text. */
type InPlaceGeometryType = 'image' | 'shape';

/**
 * Compute the affine matrix `transformElement` must apply to move/resize an
 * `image` or `shape` from `oldPdf` to `newPdf` (both in PDF user space, origin
 * bottom-left), with NO rotation/shear (a rotation change falls back upstream).
 *
 * The engine wraps the element in `q a b c d e f cm <ops> Q`, but the frame in
 * which `[a,b,c,d,e,f]` acts DIFFERS by element kind (verified empirically — see
 * `apply-operations-geometry-inplace.test.ts`):
 *
 *  - SHAPE / TEXT — vector ops carry PAGE-space coordinates, so the matrix is a
 *    plain page-space scale+translate mapping the old PDF box onto the new one:
 *        sx = newW/oldW, sy = newH/oldH
 *        e  = newX - sx*oldX, f = newY - sy*oldY
 *    (A pure move `[1,0,0,1,Δx,Δy]` shifts the path by `(Δx,Δy)` PDF points.)
 *
 *  - IMAGE — the image is drawn as a 1×1 unit square scaled into place by its
 *    OWN placement `cm = [oldW,0,0,oldH, oldX,oldY]`, and `transformElement`
 *    applies the matrix in that LOCAL (pre-placement) unit frame. So a page-space
 *    delta must be divided by the placement size, and the matrix that maps the
 *    old placement box to the new one is `M = cm_old⁻¹ · cm_new`:
 *        a = newW/oldW, d = newH/oldH
 *        e = (newX - oldX)/oldW, f = (newY - oldY)/oldH
 *    (A page-space move of `(Δx,Δy)` becomes `e=Δx/oldW, f=Δy/oldH`.)
 *
 * Returns `null` when the move/resize is within `MOVE_TOLERANCE` (treated as a
 * no-op) or when the old box is degenerate (zero width/height — undefined scale).
 */
function computeAffineMatrix(
  geometryType: InPlaceGeometryType,
  oldPdf: { x: number; y: number; width: number; height: number },
  newPdf: { x: number; y: number; width: number; height: number },
): [number, number, number, number, number, number] | null {
  if (oldPdf.width <= 0 || oldPdf.height <= 0) return null;
  const sx = newPdf.width / oldPdf.width;
  const sy = newPdf.height / oldPdf.height;

  let e: number;
  let f: number;
  if (geometryType === 'image') {
    // Local (unit) frame: divide the page-space translation by the old size.
    e = (newPdf.x - oldPdf.x) / oldPdf.width;
    f = (newPdf.y - oldPdf.y) / oldPdf.height;
  } else {
    // Page-space frame: scale-about-origin + translate.
    e = newPdf.x - sx * oldPdf.x;
    f = newPdf.y - sy * oldPdf.y;
  }

  // No-op short-circuit: identity scale AND sub-tolerance PAGE-space translation.
  // (Compare the page-space delta directly so the tolerance has the same
  // meaning for both frames — the image `e/f` are unit-space and would compare
  // against a different magnitude.)
  const isIdentityScale = Math.abs(sx - 1) < 1e-3 && Math.abs(sy - 1) < 1e-3;
  const pageDx = newPdf.x - oldPdf.x;
  const pageDy = newPdf.y - oldPdf.y;
  if (isIdentityScale && Math.abs(pageDx) <= MOVE_TOLERANCE && Math.abs(pageDy) <= MOVE_TOLERANCE) {
    return null;
  }
  return [sx, 0, 0, sy, e, f];
}

export async function applyOperations(
  inputBytes: Uint8Array | Buffer,
  operations: ElementOperation[],
  options: ApplyOperationsOptions & { extractImageData?: ImageDataExtractor } = {},
): Promise<ApplyOperationsResult> {
  const inputBuffer = Buffer.isBuffer(inputBytes)
    ? inputBytes
    : Buffer.from(inputBytes);
  const extractImageData = options.extractImageData ?? defaultExtractImageData;

  // ── In-place pass: open a mutating handle on the INPUT, edit runs directly ──
  //
  // We do this first because the redact pass below must operate on the bytes
  // that result from the in-place edits, not the pristine input. Ops that can't
  // be handled in place are collected in `fallbackOps` for the redact + add
  // pipeline that follows.
  const inPlaceHandle = await openDocument(inputBuffer);

  // PDF user-space bounds from web bounds for a given page (rotation-aware).
  const toPdfBounds = (
    handle: PDFDocumentHandle,
    pageNumber: number,
    webBounds: { x: number; y: number; width: number; height: number },
  ): RedactionTarget['bounds'] => {
    const { width: pageW, height: pageH, rotation } = handle._doc.pageInfo(pageNumber);
    return webToPdf(
      webBounds.x,
      webBounds.y,
      webBounds.width,
      webBounds.height,
      pageH,
      pageW,
      rotation as 0 | 90 | 180 | 270,
    );
  };

  // Cache of `textElements(page)` results keyed by page, so we read each page's
  // runs at most once while classifying (and so a later `removeElement` can't
  // perturb the snapshot we classified against — we apply by index afterwards).
  const runsByPage = new Map<number, ReturnType<typeof inPlaceHandle._doc.textElements>>();
  const runsFor = (page: number) => {
    let runs = runsByPage.get(page);
    if (!runs) {
      runs = inPlaceHandle._doc.textElements(page);
      runsByPage.set(page, runs);
    }
    return runs;
  };

  // Same idea for image/shape geometry: snapshot each page's image and vector
  // elements once so we can (a) validate that the unified index still resolves
  // to an element of the expected geometry kind, and (b) read its ORIGINAL
  // rotation to decide whether an affine `transformElement` is expressible
  // (rotation unchanged) or the op must fall back (rotation changed).
  const imagesByPage = new Map<number, ReturnType<typeof inPlaceHandle._doc.imageElements>>();
  const imagesFor = (page: number) => {
    let images = imagesByPage.get(page);
    if (!images) {
      images = inPlaceHandle._doc.imageElements(page);
      imagesByPage.set(page, images);
    }
    return images;
  };
  const pathsByPage = new Map<number, ReturnType<typeof inPlaceHandle._doc.vectorPaths>>();
  const pathsFor = (page: number) => {
    let paths = pathsByPage.get(page);
    if (!paths) {
      paths = inPlaceHandle._doc.vectorPaths(page);
      pathsByPage.set(page, paths);
    }
    return paths;
  };

  const inPlaceOps: InPlaceOp[] = [];
  const fallbackOps: ElementOperation[] = [];
  const formFillOps: FormFillOp[] = [];

  for (let opIndex = 0; opIndex < operations.length; opIndex++) {
    const op = operations[opIndex]!;
    const { action, pageNumber, element } = op;
    const elementType = element['type'] as string | undefined;

    const rawIndex = (element as Partial<TextElement>).index;
    const hasValidIndex = isValidRunIndex(rawIndex);

    // ── Z-order (reorder) — `reorderElement` for text/image/shape ───────────
    // A reorder carries the element's unified `index` and a `toFront` flag.
    // It changes the paint order in the PDF binary so the stacking persists on
    // reload (not just the editor's scene-graph order). Applied in a dedicated
    // LAST phase below (it renumbers indices), so capturing the index here is
    // safe — no other in-place op has run yet.
    if (action === 'reorder') {
      if (hasValidIndex && op.reorder) {
        inPlaceOps.push({
          pageNumber,
          index: rawIndex as number,
          kind: 'reorder',
          toFront: op.reorder.toFront,
          originalIndex: opIndex,
        });
      }
      // No valid index → nothing the engine can target; drop silently (the
      // scene-graph order already reflects the change for the live editor).
      continue;
    }

    // `add` always materialises brand-new content (no existing element to edit).
    if (action !== 'update' && action !== 'delete') {
      fallbackOps.push(op);
      continue;
    }

    // ── Form-field VALUE fill (update with unchanged widget geometry) ────────
    // A fill-mode edit changes a field's VALUE without moving its widget.
    // Routing it through the redact + add fallback would DUPLICATE the field:
    // the redaction only clears the content stream while the original widget
    // survives in /Annots, and the re-add creates a brand-new field with a
    // reset `/DA` (Helv 12) and lost `/Q`/comb/flags. Instead the value is
    // accumulated here and applied on the Phase-2 handle via the REAL form
    // setters (`applyFieldValuesOnHandle`) just before the final save — the
    // widget, its appearance rules and its identity are preserved (the engine
    // regenerates Adobe-parity appearances from `/DA`//`/Q`//`/MaxLen`).
    // A geometry change (design-mode move/resize) still takes the fallback, as
    // does an element with no field name. A fill that fails (field not yet in
    // the AcroForm — created in design mode) falls back to `addFormField` in
    // Phase 3 below.
    if (action === 'update' && elementType === 'form_field') {
      const formElement = element as unknown as FormFieldElement;
      const fieldName =
        typeof formElement.fieldName === 'string' ? formElement.fieldName : '';
      const geometryUnchanged =
        !op.oldBounds ||
        !formElement.bounds ||
        formGeometryUnchanged(op.oldBounds, formElement.bounds);
      if (fieldName !== '' && geometryUnchanged) {
        formFillOps.push({
          pageNumber,
          element,
          fieldName,
          value: formElement.value,
          originalIndex: opIndex,
        });
        continue;
      }
      fallbackOps.push(op);
      continue;
    }

    // ── Image / shape in-place (index-based geometry edits) ─────────────────
    // An image/shape carrying a valid unified index can be deleted or
    // moved/resized losslessly via removeElement / transformElement.
    if (elementType === 'image' || elementType === 'shape') {
      if (!hasValidIndex) {
        fallbackOps.push(op);
        continue;
      }
      const index = rawIndex as number;
      const geometryType = elementType as InPlaceGeometryType;
      // Resolve the element in the engine snapshot to read its ORIGINAL
      // rotation; if the index no longer resolves (stale edit), fall back.
      const original =
        geometryType === 'image'
          ? imagesFor(pageNumber).find((e) => e.index === index)
          : pathsFor(pageNumber).find((e) => e.index === index);
      if (!original) {
        fallbackOps.push(op);
        continue;
      }

      if (action === 'delete') {
        inPlaceOps.push({ pageNumber, index, kind: 'remove', originalIndex: opIndex });
        continue;
      }

      // action === 'update' — only a geometry (move/resize) change with the
      // rotation UNCHANGED is expressible by an affine `transformElement`.
      // A rotation change falls back to redact + add.
      const geomElement = element as unknown as { transform?: { rotation?: number }; bounds?: Bounds };
      // Shapes only have `rotation` on stored vector paths via the placement
      // CTM; the engine reports the path's effective rotation as 0 for the
      // axis-aligned content we extract, so treat a missing field as 0.
      const originalRotation =
        geometryType === 'image' ? (original as { rotation: number }).rotation : 0;
      const newRotation = geomElement.transform?.rotation ?? originalRotation;
      if (!rotationUnchanged(originalRotation, newRotation)) {
        fallbackOps.push(op);
        continue;
      }

      // ── Shape STYLE classification (P3 "vector restyle") ──────────────────
      // For a shape we ALSO consider a fill/stroke/width/dash change AND an
      // opacity (fill/stroke alpha) change, all baked in place via a SINGLE
      // `setPathStyle` (it emits `/ca`/`/CA` via an `/ExtGState`). Only a
      // null↔non-null paint transition (adding/removing a fill or stroke) is
      // inexpressible and still forces the redact + add fallback.
      let restyle: PathStyleOverride | undefined;
      if (geometryType === 'shape') {
        const path = original as ReturnType<typeof pathsFor>[number];
        const shapeEl = element as unknown as ShapeElement;
        const originalStyle: OriginalPathStyle = {
          fill: path.fill,
          stroke: path.stroke,
          strokeWidth: path.strokeWidth,
          dash: path.dash,
        };
        const styleChange = computeShapeStyleChange(shapeEl, originalStyle);
        if (styleChange && !styleChange.expressible) {
          // A style change we can't bake in place (fill/stroke added or removed)
          // → fall back so the shape is re-materialised with the new paint.
          fallbackOps.push(op);
          continue;
        }
        // Opacity (alpha) is now expressible — fold the changed alpha fields
        // into the SAME setPathStyle override as fill/stroke/width/dash.
        const opacityChange = computeShapeOpacityChange(shapeEl, {
          fillAlpha: path.fillAlpha,
          strokeAlpha: path.strokeAlpha,
          hasFill: path.fill !== null,
          hasStroke: path.stroke !== null,
        });
        if (styleChange || opacityChange.fillAlpha !== undefined || opacityChange.strokeAlpha !== undefined) {
          restyle = { ...(styleChange ? styleChange.style : {}), ...opacityChange };
        }
      }

      // ── Image OPACITY classification ──────────────────────────────────────
      // An image's alpha is set in place via `setElementOpacity` (a constant
      // /ca = /CA on an /ExtGState wrapping the image's op range). Compared
      // against the image's current opacity reported by the engine snapshot.
      let imageOpacity: number | undefined;
      if (geometryType === 'image') {
        const imgInfo = original as ReturnType<typeof imagesFor>[number];
        const imgEl = element as unknown as ImageElement;
        const newOpacity = imgEl.style?.opacity ?? 1;
        if (Math.abs(newOpacity - imgInfo.opacity) > OPACITY_TOLERANCE) {
          imageOpacity = Math.max(0, Math.min(1, newOpacity));
        }
      }

      // Geometry (move/resize) component — `null` when unchanged (or degenerate).
      const matrix =
        op.oldBounds && geomElement.bounds
          ? computeAffineMatrix(
              geometryType,
              toPdfBounds(inPlaceHandle, pageNumber, op.oldBounds),
              toPdfBounds(inPlaceHandle, pageNumber, geomElement.bounds),
            )
          : null;

      // Route on what actually changed:
      //  - shape style/opacity changed (restyle present): one `restyle` op,
      //    carrying the geometry matrix too when geometry ALSO changed
      //    (transform THEN setPathStyle on the same index — count stable).
      //  - image opacity changed (imageOpacity present): one `setOpacity` op,
      //    carrying the geometry matrix too when geometry ALSO changed.
      //  - geometry only: a plain `transform`.
      //  - neither: nothing expressible changed.
      if (restyle) {
        inPlaceOps.push({
          pageNumber,
          index,
          kind: 'restyle',
          style: restyle,
          matrix: matrix ?? undefined,
          originalIndex: opIndex,
        });
        continue;
      }
      if (imageOpacity !== undefined) {
        inPlaceOps.push({
          pageNumber,
          index,
          kind: 'setOpacity',
          opacity: imageOpacity,
          matrix: matrix ?? undefined,
          originalIndex: opIndex,
        });
        continue;
      }
      if (matrix !== null) {
        inPlaceOps.push({ pageNumber, index, kind: 'transform', matrix, originalIndex: opIndex });
        continue;
      }
      // Nothing in-place-expressible changed.
      if (!op.oldBounds || !geomElement.bounds) {
        // No old box AND no style change → cannot edit in place; fall back so a
        // genuine non-geometry/non-style update isn't silently dropped.
        fallbackOps.push(op);
      }
      // else: a within-tolerance no-op move with no style change → skip silently.
      continue;
    }

    // ── Text in-place (replaceText / moveElement / removeElement) ───────────
    // Only text elements carrying a valid engine run index are eligible.
    if (elementType !== 'text' || !hasValidIndex) {
      fallbackOps.push(op);
      continue;
    }

    const index = rawIndex as number;
    const run = runsFor(pageNumber).find((r) => r.index === index);

    if (action === 'delete') {
      if (!run) {
        // Index no longer resolves (stale edit) — redact the bounds instead.
        fallbackOps.push(op);
        continue;
      }
      inPlaceOps.push({ pageNumber, index, kind: 'remove', originalIndex: opIndex });
      continue;
    }

    // action === 'update'
    const textElement = element as unknown as TextElement;
    if (!run || !styleMatchesRun(textElement, run)) {
      // No matching run, or a font/size/colour change `replaceText` can't
      // express → fall back so the new style is honoured.
      fallbackOps.push(op);
      continue;
    }

    // Position delta (PDF user space). `update` without `oldBounds` is rejected
    // by the fallback path, but here we may still have moved — derive the delta
    // from the element's NEW bounds vs the supplied `oldBounds` (if any).
    let move: InPlaceOp['move'];
    if (op.oldBounds && textElement.bounds) {
      const pdfOld = toPdfBounds(inPlaceHandle, pageNumber, op.oldBounds);
      const pdfNew = toPdfBounds(inPlaceHandle, pageNumber, textElement.bounds);
      const dx = pdfNew.x - pdfOld.x;
      const dy = pdfNew.y - pdfOld.y;
      if (Math.abs(dx) > MOVE_TOLERANCE || Math.abs(dy) > MOVE_TOLERANCE) {
        move = { dx, dy };
      }
    }

    inPlaceOps.push({
      pageNumber,
      index,
      kind: 'replace',
      newText: textElement.content ?? '',
      move,
      originalIndex: opIndex,
    });
  }

  // Apply the in-place ops PER PAGE.
  let inPlaceReplaced = 0;
  let inPlaceMoved = 0;
  let inPlaceTransformed = 0;
  let inPlaceRestyled = 0;
  let inPlaceOpacitySet = 0;
  let inPlaceReordered = 0;
  let inPlaceRemoved = 0;

  if (inPlaceOps.length > 0) {
    const byPage = new Map<number, InPlaceOp[]>();
    for (const ip of inPlaceOps) {
      const bucket = byPage.get(ip.pageNumber);
      if (bucket) bucket.push(ip);
      else byPage.set(ip.pageNumber, [ip]);
    }

    for (const [page, ops] of byPage) {
      // Split count-/order-STABLE + remove ops from reorder ops: a `reorder`
      // renumbers indices on the page, so it must run LAST (after every other
      // edit's captured index has been consumed).
      const reorderOps = ops.filter((ip) => ip.kind === 'reorder');
      const stableOps = ops.filter((ip) => ip.kind !== 'reorder');

      // Detect duplicate targets among the stable ops (caller bug) — last wins.
      const seen = new Set<number>();
      for (const ip of stableOps) {
        if (seen.has(ip.index)) {
          engineLogger.warn('applyOperations: duplicate in-place op for same run', {
            page,
            index: ip.index,
          });
        }
        seen.add(ip.index);
      }

      // Phase 1 — stable + remove ops in DESCENDING index order so a
      // `removeElement` never invalidates a not-yet-processed lower index.
      stableOps.sort((a, b) => b.index - a.index); // descending

      for (const ip of stableOps) {
        try {
          if (ip.kind === 'remove') {
            if (inPlaceHandle._doc.removeElement(page, ip.index)) inPlaceRemoved++;
          } else if (ip.kind === 'transform') {
            if (ip.matrix && inPlaceHandle._doc.transformElement(page, ip.index, ip.matrix)) {
              inPlaceTransformed++;
            }
          } else if (ip.kind === 'restyle') {
            // Geometry first (if any) so the path's box is at its NEW position,
            // then the style override. Both target the same index; neither
            // changes the element count, so the index stays valid between calls.
            if (ip.matrix && inPlaceHandle._doc.transformElement(page, ip.index, ip.matrix)) {
              inPlaceTransformed++;
            }
            if (ip.style && inPlaceHandle._doc.setPathStyle(page, ip.index, ip.style)) {
              inPlaceRestyled++;
            }
          } else if (ip.kind === 'setOpacity') {
            // Geometry first (if any), then the constant opacity. Same index,
            // count stable between calls.
            if (ip.matrix && inPlaceHandle._doc.transformElement(page, ip.index, ip.matrix)) {
              inPlaceTransformed++;
            }
            if (
              ip.opacity !== undefined &&
              inPlaceHandle._doc.setElementOpacity(page, ip.index, ip.opacity)
            ) {
              inPlaceOpacitySet++;
            }
          } else {
            if (inPlaceHandle._doc.replaceText(page, ip.index, ip.newText ?? '')) {
              inPlaceReplaced++;
            }
            if (ip.move) {
              if (inPlaceHandle._doc.moveElement(page, ip.index, ip.move.dx, ip.move.dy)) {
                inPlaceMoved++;
              }
            }
          }
        } catch (err) {
          // An in-place op that throws must not abort the batch — log and let
          // the page fall through unchanged. (Editing is best-effort; the
          // remaining fallback pass below still runs for the other ops.)
          engineLogger.warn('applyOperations: in-place op failed', {
            page,
            index: ip.index,
            kind: ip.kind,
            originalIndex: ip.originalIndex,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Phase 2 — reorder ops LAST, one at a time in QUEUED (original op) order
      // so the final paint order reflects the user's sequence of bring-to-front
      // / send-to-back actions (last action wins z-order). Each `reorderElement`
      // moves the element's op range, renumbering indices, so they are applied
      // sequentially on the captured indices (valid pre-reorder); a multi-target
      // reorder batch is rare and best-effort here — the common single-reorder
      // case is exact.
      reorderOps.sort((a, b) => a.originalIndex - b.originalIndex);
      for (const ip of reorderOps) {
        try {
          if (
            ip.toFront !== undefined &&
            inPlaceHandle._doc.reorderElement(page, ip.index, ip.toFront)
          ) {
            inPlaceReordered++;
          }
        } catch (err) {
          engineLogger.warn('applyOperations: in-place reorder failed', {
            page,
            index: ip.index,
            toFront: ip.toFront,
            originalIndex: ip.originalIndex,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  // Serialise the in-place edits, then release the mutating handle. The redact
  // + add pipeline below re-opens from these bytes.
  const afterInPlaceBytes =
    inPlaceOps.length > 0
      ? new Uint8Array(await saveDocument(inPlaceHandle))
      : new Uint8Array(inputBuffer);
  closeDocument(inPlaceHandle);

  // ── Phase 0: page metadata for the FALLBACK ops' web → PDF conversion ───────
  const metaHandle = await openDocument(Buffer.from(afterInPlaceBytes));

  // Classify the fallback ops into redaction targets + add ops.
  const redactionTargets: RedactionTarget[] = [];
  const addOps: Array<{
    pageNumber: number;
    element: Record<string, unknown>;
    elementType: string | undefined;
    originalIndex: number;
  }> = [];

  for (let opIndex = 0; opIndex < fallbackOps.length; opIndex++) {
    const op = fallbackOps[opIndex]!;
    const { action, pageNumber, element, oldBounds } = op;
    const elementType = element['type'] as string | undefined;

    if (action === 'add') {
      addOps.push({ pageNumber, element, elementType, originalIndex: opIndex });
    } else if (action === 'update') {
      if (!oldBounds) {
        throw new Error(
          `applyOperations: oldBounds is required for update operations (op[${opIndex}], element type: ${elementType ?? 'unknown'}).`,
        );
      }
      redactionTargets.push({
        pageNumber,
        bounds: toPdfBounds(metaHandle, pageNumber, oldBounds),
      });
      // Re-cast as add at element.bounds (the NEW position carried by the element).
      addOps.push({ pageNumber, element, elementType, originalIndex: opIndex });
    } else if (action === 'delete') {
      const bounds = (element['bounds'] ?? oldBounds) as Bounds | undefined;
      if (bounds) {
        redactionTargets.push({
          pageNumber,
          bounds: toPdfBounds(metaHandle, pageNumber, bounds),
        });
      }
    }
  }

  // Phase 0 done — release the metadata-only handle (frees its WASM document).
  closeDocument(metaHandle);

  // ── Phase 1: redaction on the post-in-place bytes ───────────────────────────
  let workingBytes: Uint8Array = afterInPlaceBytes;
  let redactionsApplied = 0;
  let redactionSucceeded = true;

  if (redactionTargets.length > 0) {
    try {
      const result = await applyRedactions(workingBytes, redactionTargets);
      workingBytes = result.bytes;
      redactionsApplied = result.applied;
    } catch (err) {
      redactionSucceeded = false;
      engineLogger.warn('applyOperations: redaction failed, proceeding without', {
        error: err instanceof Error ? err.message : String(err),
        targetCount: redactionTargets.length,
      });
    }
  }

  // ── Phase 2: native add pass on (potentially redacted) bytes ────────────────
  const handle = await openDocument(Buffer.from(workingBytes));
  if (options.fontCache) {
    setFontCacheForHandle(handle, options.fontCache);
  }

  let addsApplied = 0;
  for (const op of addOps) {
    const { pageNumber, element, elementType, originalIndex } = op;
    try {
      switch (elementType) {
        case 'text': {
          await addText(handle, pageNumber, element as unknown as TextElement);
          break;
        }
        case 'image': {
          const imageData = extractImageData(element);
          if (imageData) {
            await addImage(handle, pageNumber, element as unknown as ImageElement, imageData);
          }
          break;
        }
        case 'shape': {
          addShape(handle, pageNumber, element as unknown as ShapeElement);
          break;
        }
        case 'annotation': {
          await addAnnotation(handle, pageNumber, element as unknown as AnnotationElement);
          break;
        }
        case 'form_field': {
          addFormField(handle, pageNumber, element as unknown as FormFieldElement);
          break;
        }
        default:
          // Unknown type: skip silently (the redaction may still have run).
          continue;
      }
      addsApplied++;
    } catch (opError) {
      const elementId = element['elementId'] ?? element['id'];
      const annotated = new Error(
        `applyOperations: op[${originalIndex}] failed (type=${elementType ?? 'unknown'}, page=${pageNumber}, elementId=${elementId ?? 'n/a'}): ${opError instanceof Error ? opError.message : String(opError)}`,
      );
      if (opError instanceof Error) {
        (annotated as Error & { cause?: unknown }).cause = opError;
      }
      throw annotated;
    }
  }

  // ── Phase 3: fill EXISTING form fields (fill-mode updates) ──────────────────
  // Applied on the SAME handle as the add pass, right before the save, so the
  // engine regenerates the widget appearances once with the final values.
  let formFieldsFilled = 0;
  if (formFillOps.length > 0) {
    // One value per field: several widgets of the same field each emit an
    // update op (multi-widget checkboxes, duplicate-page twins); the LAST
    // queued value wins — it reflects the user's final action.
    const values: Record<string, string | boolean | string[]> = {};
    for (const fill of formFillOps) {
      values[fill.fieldName] = fill.value;
    }
    const fillResults = applyFieldValuesOnHandle(handle, values);
    for (const result of fillResults) {
      if (result.success) {
        formFieldsFilled++;
        continue;
      }
      // Field not in the AcroForm yet (created in design mode, first bake) →
      // materialise it exactly like a plain `add` op. Never redacted: the
      // geometry was unchanged, so there is nothing stale to clear.
      const source = formFillOps.find((f) => f.fieldName === result.fieldName);
      if (!source) continue;
      try {
        addFormField(
          handle,
          source.pageNumber,
          source.element as unknown as FormFieldElement,
        );
        addsApplied++;
      } catch (err) {
        engineLogger.warn('applyOperations: form-fill fallback add failed', {
          fieldName: result.fieldName,
          page: source.pageNumber,
          originalIndex: source.originalIndex,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  const finalBytes = await saveDocument(handle);
  closeDocument(handle);

  return {
    bytes: new Uint8Array(finalBytes),
    redactionTargetsCount: redactionTargets.length,
    redactionsApplied,
    redactionSucceeded,
    addsApplied,
    inPlaceReplaced,
    inPlaceMoved,
    inPlaceTransformed,
    inPlaceRestyled,
    inPlaceOpacitySet,
    inPlaceReordered,
    inPlaceRemoved,
    formFieldsFilled,
  };
}
