"use client";

/**
 * render-elements.ts
 *
 * SINGLE canonical renderer for parsed PDF elements (text / image / shape /
 * annotation / form_field) onto a Fabric.js canvas. The editable surface uses
 * THIS function — there is no second implementation:
 *
 *   - the single-page editor (`editor-canvas.tsx`) delegates to it; in the
 *     continuous Word-like view the ACTIVE page mounts the same `<EditorCanvas>`
 *     (embedded), so it goes through here too. Inactive pages in the continuous
 *     view render a read-only full raster (no overlay) via `page-canvas-host.tsx`.
 *
 * DIRECT-EDIT FIDELITY MODEL (what is visible vs a hit-target)
 * -----------------------------------------------------------
 * The visible page is the PDF rasterised at index 0 (the background image),
 * rendered by the editor WITHOUT the elements it overlays editably:
 *   - TEXT   — the raster omits ALL text (`renderPageNoText`); this overlay
 *     paints the REAL editable text on top (real colour + embedded font).
 *   - SHAPES — still drawn by the raster (it keeps every vector path 1:1, the
 *     visual ground truth); this overlay is a TRANSPARENT hit-target that
 *     reveals its real fill/stroke ONLY while selected (`attachShapeStyleReveal`)
 *     so the element stays editable without doubling the shape. Shapes are NOT
 *     excluded from the raster: `renderPageExcluding` honours shape exclusion
 *     only for some vector paths (engine index quirk) and mixing in the
 *     text-run ordinals over-excludes — both blanked whole coloured backgrounds.
 *   - IMAGES — a PARSED image (carries an engine `index`) is still drawn by the
 *     raster, so its overlay is an INVISIBLE (opacity 0) hit-target sitting
 *     exactly on top for click/move/resize, revealed while selected (like a
 *     shape). A NEWLY-ADDED image is NOT in the raster, so its overlay stays
 *     VISIBLE at its real opacity. The real opacity is stashed on
 *     `data.originalOpacity` so the 0 display opacity is never baked on save.
 * Text is the only element repainted here, so nothing is drawn twice (no
 * "doubled text" bug). The original colours/styles are stashed on `obj.data.*`
 * for the selection-reveal, the properties panel and the layer-hide toggle.
 *
 * Dependencies that differ per surface (embedded-font resolution, edit-time
 * hide-mask, image URL resolution) are INJECTED via {@link RenderElementsOptions}
 * so the construction logic stays identical everywhere.
 */

import type { Canvas as FabricCanvas, FabricObject } from "fabric";
import type * as FabricNamespace from "fabric";
import type {
  Element,
  PageBlockGroup,
  PageBlockTableCell,
  PageBlockListItem,
} from "@giga-pdf/types";
import { clientLogger } from "@/lib/client-logger";
// Shared run<->Fabric-styles mapping (single source of truth with
// fabric-element-io.ts) so character-level styling round-trips identically.
import { runsToFabricStyles } from "./lib/text-runs";
// Single source of truth for the text-baseline anchoring geometry, shared with
// the save-time inverse in fabric-element-io.ts (was a bare `0.22` copied here).
import { baselineTopFromBoundsY } from "./lib/text-baseline";
// Tactile (mobile lot 2): larger touch handles on coarse pointers + a minimum
// on-screen hit floor for tiny form-field widgets. No-ops on fine pointers.
import {
  coarseControlProps,
  installFormFieldHitFloor,
  type HitFloorTarget,
} from "./lib/touch-interaction";
import {
  composeDisplayText,
  leftIndentOffset,
  shiftStylesForMarker,
} from "./lib/list-format";
import { clampCombValue, computeCombLayout } from "./lib/comb-layout";

type FabricModule = typeof FabricNamespace;

// In the browser, never fall back to the internal dev URL (localhost:8000) —
// it leaks into the bundle when NEXT_PUBLIC_API_URL is unset at build time and
// gets blocked by CSP. Use the current origin (prod: https://giga-pdf.com).
// SSR/Node keeps the local Python default.
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  (typeof window !== "undefined" ? window.location.origin : "http://localhost:8000");

// ---------------------------------------------------------------------------
// Types publics
// ---------------------------------------------------------------------------

/** Metadata stockée dans obj.data pour tout objet rendu par cet utilitaire. */
export interface ElementObjectData {
  elementId?: string;
  type?: string;
  isPdfBackground?: boolean;
  /**
   * Engine UNIFIED element index (text run / image / vector path) carried from
   * the parsed element. Round-tripped back onto `element.index` by
   * `fabricObjectToElement` so the apply pipeline fires the lossless in-place
   * ops (`replaceText`/`transformElement`/`removeElement`) instead of redact+add.
   * Undefined for newly-added elements (no original engine element).
   */
  index?: number;
  /**
   * Original element rotation (degrees) at parse time. Compared against the
   * Fabric object's current `angle` to decide whether an image/shape in-place
   * edit can use an affine `transformElement` (rotation unchanged) or must fall
   * back to redact+add (rotation changed — affine can't express it here).
   */
  rotation0?: number;
  originalFont?: string | null;
  /**
   * Block identity (EDIT-INTENT model): the paragraph/cell/item group this text
   * run belongs to. Tagged on EVERY engine block's members — including groups
   * the coherence gate rejects — so a single click can always select the whole
   * block (`attachParagraphBlockSelection`). `pg:` + first run's elementId.
   */
  paragraphGroupId?: string;
  /**
   * Whether a double-click on this member may open the multi-line Textbox edit
   * session (result of {@link isCoherentLineGroup} on the group's lines). The
   * gate no longer gates the group IDENTITY — only the session: a geometrically
   * incoherent group (footer↔header fusion on a dense form) would drift inside
   * a single Textbox, so its members keep the per-run inline edit instead.
   */
  paragraphSessionable?: boolean;
  /**
   * Transient hover-affordance outline drawn around a paragraph block while a
   * member is hovered (`attachParagraphHoverAffordance`). Pure chrome: never a
   * scene-graph element, never serialised (fabric-element-io returns null),
   * never queued for the save, swept on every overlay re-render.
   */
  isParagraphHoverOutline?: boolean;
  /**
   * Fill & Sign: elementId of the SIGNATURE WIDGET this image was stamped into
   * (set by editor-canvas `addImage` on a targeted insertion). While the image
   * lives on the canvas, clicking its widget SELECTS the image (movable /
   * resizable) instead of reopening the capture dialog; once the image is
   * deleted the widget becomes clickable again to re-sign. Session-local link:
   * never serialised into the scene graph (fabric-element-io builds typed
   * elements), so a reload naturally clears it.
   */
  signedWidgetId?: string;
  [key: string]: unknown;
}

interface FabricObjectWithData extends FabricObject {
  data?: ElementObjectData;
}

export interface RenderElementsOptions {
  /**
   * Facteur d'échelle conservé pour compatibilité d'API. La géométrie est
   * exprimée en points PDF natifs ; le zoom est appliqué via `canvas.setZoom()`
   * par l'appelant (single-page ET continu), donc ce paramètre n'est pas
   * réappliqué aux coordonnées ici.
   */
  scale?: number;
  /** Mode lecture seule : objets non sélectionnables / non interactifs. */
  readonly?: boolean;
  /** Callback déclenché à la sélection d'un élément (continu : panneaux page-scoped). */
  onElementSelected?: (elementId: string) => void;
  /**
   * Résout la FontFace enregistrée pour une police embarquée du PDF. Injecté
   * par l'appelant (hook `useEmbeddedFonts`). Retourne `{ name, embedded,
   * exact }` — ou `null` quand AUCUNE face de la famille n'est chargée.
   *
   * Cascade côté hook : (1) IDENTITÉ — le `fontId` du run (4e argument,
   * identité PHYSIQUE du programme embarqué) ou son `/BaseFont` exact matche
   * une face chargée → retour INCONDITIONNEL (`exact: true`), même si le
   * subset est incomplet (glyphes manquants → `.notdef`, accepté) ; (2)
   * VARIANTE — le sous-ensemble de la famille dont le NOM porte le
   * bold/italic du run, la couverture cmap servant de CLASSEMENT (jamais de
   * rejet) ; (3) FLOU — 1er sous-ensemble de la famille (`exact: false`, le
   * renderer conserve alors ses poids/style synthétiques). `embedded` reflète
   * la provenance des octets (programme du document vs substitut Google) —
   * seul un vrai fallback subit le width-fit borné.
   */
  getFontFaceName?: (
    originalName: string,
    wantVariant?: { bold?: boolean; italic?: boolean },
    text?: string,
    fontId?: string,
  ) => { name: string; embedded: boolean; exact: boolean } | null;
  /** Résout une URL d'image relative en URL absolue (défaut : API base URL). */
  resolveImageUrl?: (url: string) => string;
  /**
   * Masque le glyphe de fond sous un élément caché (edit-mode / re-render).
   * Optionnel : seul le single-page le fournit aujourd'hui.
   */
  applyHideMask?: (canvas: FabricCanvas, obj: FabricObject) => Promise<void>;
  /**
   * Regroupe les runs de texte d'un même paragraphe en UN bloc `Textbox`
   * multi-ligne éditable (édition « Word-like », à la Adobe) au lieu de N
   * `IText` ligne-par-ligne. Activé par défaut. Mettre à `false` pour revenir
   * au rendu ligne-par-ligne (utile pour le diagnostic / si un PDF se regroupe
   * mal). Le regroupement est CONSERVATEUR : en cas de doute un run reste un
   * `IText` séparé (cf. {@link groupTextRunsIntoParagraphs}).
   */
  groupParagraphs?: boolean;
  /**
   * Regroupement STRUCTUREL fourni par le moteur natif (`pageBlocks`) : la lib
   * est la source de vérité de la structure de lecture. Quand fourni (et
   * `groupParagraphs` non désactivé), les paragraphes/titres sont coalescés à
   * partir de CE découpage — chaque groupe liste les `source_index` (= l'index
   * moteur d'un run, identique à `TextElement.index`) de ses runs en ordre de
   * lecture — au lieu de l'heuristique positionnelle {@link
   * groupTextRunsIntoParagraphs}. Les runs sont résolus contre les `elements`
   * déjà parsés par leur `index` (bounds/style/police embarquée corrects), donc
   * le chemin de sauvegarde lossless (`data.paragraphRuns` → `replaceText`) est
   * réutilisé tel quel. Absent ⇒ repli sur l'heuristique (aucune régression).
   */
  blockGroups?: PageBlockGroup[];
}

// ---------------------------------------------------------------------------
// Helpers internes (purs)
// ---------------------------------------------------------------------------

/** Préfixe l'API base URL pour les chemins relatifs ; passe les absolus/data. */
function defaultResolveImageUrl(url: string): string {
  if (!url) return "";
  if (
    url.startsWith("http://") ||
    url.startsWith("https://") ||
    url.startsWith("data:")
  ) {
    return url;
  }
  return `${API_BASE_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

/**
 * Incruste une valeur alpha dans une couleur hex/rgb. Utilisé pour fill/stroke
 * de shape afin de préserver des opacités mixtes. Passe-through pour
 * transparent / chaînes vides.
 */
function colorWithAlpha(color: string, alpha: number): string {
  if (!color || color === "transparent" || color === "none") return "transparent";
  const a = Math.max(0, Math.min(1, alpha ?? 1));
  if (a >= 0.999) return color;
  const hex = color.trim();
  if (hex.startsWith("#")) {
    let r = 0,
      g = 0,
      b = 0;
    if (hex.length === 4) {
      r = parseInt(hex[1]! + hex[1]!, 16);
      g = parseInt(hex[2]! + hex[2]!, 16);
      b = parseInt(hex[3]! + hex[3]!, 16);
    } else if (hex.length === 7) {
      r = parseInt(hex.slice(1, 3), 16);
      g = parseInt(hex.slice(3, 5), 16);
      b = parseInt(hex.slice(5, 7), 16);
    } else {
      return color;
    }
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  if (hex.startsWith("rgb(")) {
    return hex.replace(/^rgb\(/, "rgba(").replace(/\)$/, `, ${a})`);
  }
  return color;
}

/** Resolution of a run's render font: the CSS family to use + whether the
 *  parsed weight/style must still be applied synthetically. */
interface ResolvedTextFont {
  /** FontFace name (embedded subset) or CSS fallback family. */
  fontFamily: string;
  /**
   * True when the resolved face carries the document's ORIGINAL embedded bytes
   * (even via a loose family match). Decoupled from {@link syntheticVariant}:
   * the width-fit clamp keys on THIS flag (original metrics ⇒ no cosmetic
   * squash), while the synthetic weight/style keys on `syntheticVariant`.
   * False for a Google-substitute face and for the generic CSS fallback.
   */
  usingEmbeddedFont: boolean;
  /**
   * True when the parsed weight/style had to be applied synthetically because
   * the resolved face does NOT carry the run's variant (loose family match or
   * CSS fallback). False when the face IS the run's identity/variant — a
   * synthetic bold/italic on top would double-bold and widen the glyphs.
   */
  syntheticVariant: boolean;
  /** Effective fontWeight to set on the Fabric object ("normal" | "bold"). */
  fontWeight: "normal" | "bold";
  /** Effective fontStyle to set on the Fabric object ("normal" | "italic"). */
  fontStyle: "normal" | "italic";
}

/**
 * Resolve the font for a text run, identity- and weight/style-aware.
 *
 * PRODUCT DIRECTIVE: a run whose ORIGINAL embedded program is loadable is
 * ALWAYS rendered with it — even when the subset is incomplete (missing glyphs
 * render `.notdef`, accepted). Google/CSS substitutes are the LAST resort,
 * only when no embedded byte is servable for the family.
 *
 * A single resolver call carries the whole cascade (see the hook's
 * `getFontFaceName`): the run's PHYSICAL program id (`style.fontId`) pins its
 * exact embedded program first; then the exact `/BaseFont`; then the
 * variant-matching subset of the family (coverage RANKS candidates, never
 * rejects); then the loose family match. The returned flags drive:
 *   • `exact: true`  ⇒ the face already carries the run's identity/variant —
 *     NO synthetic weight/style (double-bolding widens glyphs).
 *   • `exact: false` ⇒ loose match — the parsed weight/style is applied
 *     synthetically to approximate the variant this face does not carry.
 *   • `embedded`     ⇒ byte provenance: original document bytes vs Google
 *     substitute. Only a NON-embedded face is subject to the bounded
 *     width-fit clamp (original metrics are never squashed).
 * No resolver hit at all ⇒ generic CSS family + synthetic weight/style.
 */
function resolveTextFont(
  style: {
    fontFamily?: string;
    originalFont?: string | null;
    fontId?: string;
    fontWeight?: "normal" | "bold";
    fontStyle?: "normal" | "italic";
  },
  getFontFaceName?: (
    originalName: string,
    wantVariant?: { bold?: boolean; italic?: boolean },
    text?: string,
    fontId?: string,
  ) => { name: string; embedded: boolean; exact: boolean } | null,
  text?: string,
): ResolvedTextFont {
  const parsedWeight: "normal" | "bold" = style.fontWeight === "bold" ? "bold" : "normal";
  const parsedStyle: "normal" | "italic" = style.fontStyle === "italic" ? "italic" : "normal";
  const wantBold = parsedWeight === "bold";
  const wantItalic = parsedStyle === "italic";
  const orig = style.originalFont;

  if (orig && getFontFaceName) {
    const info = getFontFaceName(
      orig,
      { bold: wantBold, italic: wantItalic },
      text,
      style.fontId,
    );
    if (info) {
      return {
        fontFamily: info.name,
        usingEmbeddedFont: info.embedded,
        syntheticVariant: !info.exact,
        // Identity/variant carried by the face ⇒ neutral weight/style (the
        // glyphs ARE the variant); loose ⇒ keep the parsed weight/style.
        fontWeight: info.exact ? "normal" : parsedWeight,
        fontStyle: info.exact ? "normal" : parsedStyle,
      };
    }
  }

  // Generic CSS family → honour the parsed weight/style (last resort).
  return {
    fontFamily: style.fontFamily ?? "Helvetica",
    usingEmbeddedFont: false,
    syntheticVariant: true,
    fontWeight: parsedWeight,
    fontStyle: parsedStyle,
  };
}

/**
 * BOUNDED horizontal fit for FALLBACK-font text ONLY. The lib gives the real
 * target advance width (`bounds.width`). When the resolved face carries the
 * document's ORIGINAL embedded bytes (`usingEmbeddedFont === true` — identity,
 * variant OR loose family match on an embedded program) the glyph metrics
 * already match the original, so NO scaleX is applied (squashing exact text is
 * the bug the product directive forbids). Only a TRUE substitute (Google face
 * or generic CSS family, `usingEmbeddedFont === false`) can render WIDER than
 * the original and overlap the next run; shrink the object with a scaleX
 * clamped to [0.92, 1] — enough to absorb the metric drift WITHOUT a visible
 * squash, and NEVER expanding (ratio ≥ 1 ⇒ untouched).
 *
 * A Fabric `Textbox` reports its FIXED box width here (it wraps rather than
 * overflowing), so `measured === target` ⇒ this is naturally inert for grouped
 * paragraphs — only single-line `IText` (whose `.width` is the measured content
 * advance) is ever scaled. The chosen scaleX is self-inverting through the save
 * path's `width * scaleX` bake (the persisted width stays ≈ `bounds.width`), so
 * the place → save → reload round-trip does not drift.
 *
 * @returns the applied scaleX (1 when untouched) — exposed for unit assertions.
 */
export function applyFallbackWidthFit(
  obj: { width?: number; set: (patch: { scaleX: number }) => void },
  targetWidth: number,
  usingEmbeddedFont: boolean,
): number {
  if (usingEmbeddedFont) return 1;
  const measured = obj.width ?? 0;
  if (measured <= 0 || targetWidth <= 0 || measured <= targetWidth) return 1;
  const scaleX = Math.max(0.92, Math.min(1, targetWidth / measured));
  obj.set({ scaleX });
  return scaleX;
}

/**
 * Fit a per-word RUN FRAGMENT to its exact `/Widths` advance — for ANY font,
 * embedded or fallback (unlike {@link applyFallbackWidthFit}, which skips embedded
 * fonts). The engine positions each fragment at the rasterizer's pen `x`, but the
 * browser draws the word at the FontFace's own `hmtx` advance, which is often a hair
 * WIDER than the PDF's `/Widths` (a CFF/Type1 subset re-hinted for the web). Over a
 * justified line those hair-widths accumulate and a word eats the inter-word gap —
 * "amende et/ou" collapses to "amendeet/ou". Shrinking each word to its `/Widths`
 * box restores the exact rasterizer footprint, so every gap is preserved. Shrink-ONLY
 * (a word rendered narrower than its box keeps its gap; the next word is absolutely
 * positioned anyway); clamped to a floor so a mis-measured fallback never collapses.
 */
export function applySegmentWidthFit(
  obj: { width?: number; set: (patch: { scaleX: number }) => void },
  targetWidth: number,
): number {
  const measured = obj.width ?? 0;
  if (measured <= 0 || targetWidth <= 0 || measured <= targetWidth) return 1;
  const scaleX = Math.max(0.5, targetWidth / measured);
  obj.set({ scaleX });
  return scaleX;
}

/** Strip a 6-letter `ABCDEF+` PDF subset prefix so two disjoint subsets of the
 *  same `/BaseFont` compare equal (paragraph-grouping identity). */
function stripSubsetPrefix(name: string): string {
  return name.replace(/^[A-Z]{6}\+/, "");
}

// ---------------------------------------------------------------------------
// Form-field overlay helpers (purs)
// ---------------------------------------------------------------------------

const FIELD_FILL_BY_TYPE: Record<string, string> = {
  text: "rgba(0, 100, 255, 0.08)",
  checkbox: "rgba(0, 180, 0, 0.10)",
  radio: "rgba(0, 180, 0, 0.10)",
  dropdown: "rgba(100, 0, 255, 0.08)",
  listbox: "rgba(100, 0, 255, 0.08)",
  signature: "rgba(255, 100, 0, 0.10)",
  button: "rgba(50, 50, 50, 0.10)",
};

const FIELD_STROKE_BY_TYPE: Record<string, string> = {
  text: "#0066cc",
  checkbox: "#00aa00",
  radio: "#00aa00",
  dropdown: "#6600cc",
  listbox: "#6600cc",
  signature: "#ff6600",
  button: "#333333",
};

/** Light translucent background tint for a form-field overlay, by field type. */
function fieldOverlayFill(fieldType: string): string {
  return FIELD_FILL_BY_TYPE[fieldType] ?? "rgba(0, 100, 255, 0.08)";
}

/** Border colour for a form-field overlay, by field type. */
function fieldOverlayStroke(fieldType: string): string {
  return FIELD_STROKE_BY_TYPE[fieldType] ?? "#0066cc";
}

/**
 * The display string for a text/dropdown field value. FormFieldElement.value is
 * `string | boolean | string[]`; coerce to a single line for the IText overlay.
 */
function formFieldTextValue(value: string | boolean | string[]): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? "";
  return value ? "true" : "";
}

/**
 * Whether a checkbox/radio field is currently checked, from its value. Checkbox
 * uses a boolean (or the strings "on"/"off"/"yes"); radio is checked when its
 * value matches one of its option export values (non-empty).
 */
function formFieldChecked(field: {
  fieldType: string;
  value: string | boolean | string[];
  options: string[] | null;
  onValue?: string | null;
}): boolean {
  const { value } = field;
  if (typeof value === "boolean") return value;
  // A widget with a named on-state (a radio button, or a checkbox whose "on" is a
  // named export): checked iff the field value equals THIS widget's on-state. A
  // radio group renders one element per button, so only the selected one is on.
  if (field.onValue != null && field.onValue.length > 0) {
    return formFieldTextValue(value) === field.onValue;
  }
  if (field.fieldType === "checkbox") {
    const v = formFieldTextValue(value).toLowerCase();
    return v === "true" || v === "on" || v === "yes" || v === "1";
  }
  // radio without a per-widget on-state: checked when a non-empty option is selected.
  return formFieldTextValue(value).length > 0;
}

// ---------------------------------------------------------------------------
// Annotation geometry helpers (pure)
// ---------------------------------------------------------------------------

/**
 * SVG path data for a squiggly (wavy) underline spanning `width` at the local
 * origin (the Fabric.Path is positioned at the annotation's top-left). A real
 * zig-zag of period `~amp*2` — far truer to a PDF "squiggly" markup than the
 * previous dashed straight line. `amp` (peak height) defaults to 2pt.
 */
function squigglyPathData(width: number, amp = 2): string {
  const w = Math.max(1, width);
  const period = Math.max(2, amp * 2);
  const segments = Math.max(1, Math.round(w / period));
  const step = w / segments;
  // Start on the baseline, then alternate up/down peaks across the width.
  let d = `M 0 ${amp}`;
  for (let i = 0; i < segments; i++) {
    const x1 = step * (i + 0.5);
    const y1 = i % 2 === 0 ? 0 : amp * 2;
    const x2 = step * (i + 1);
    d += ` Q ${x1} ${y1} ${x2} ${amp}`;
  }
  return d;
}

/**
 * Triangle points (Fabric.Polygon) for an arrowhead at the END of a segment
 * going from (x1,y1) → (x2,y2), in the same coordinate space as the line. The
 * head is `size` long and `size*0.7` wide, pointing along the segment direction.
 */
function arrowHeadPoints(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  size: number,
): { x: number; y: number }[] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  // Perpendicular (for the two base corners).
  const px = -uy;
  const py = ux;
  const half = size * 0.35;
  const baseX = x2 - ux * size;
  const baseY = y2 - uy * size;
  return [
    { x: x2, y: y2 }, // tip
    { x: baseX + px * half, y: baseY + py * half },
    { x: baseX - px * half, y: baseY - py * half },
  ];
}

// ---------------------------------------------------------------------------
// Paragraph grouping (Word-like editing) — pure helpers
// ---------------------------------------------------------------------------

export type TextRun = Extract<Element, { type: "text" }>;

/**
 * Minimal snapshot of a source text run, stashed on the paragraph Textbox's
 * `data.paragraphRuns` so the save path can DECOMPOSE the multi-line block back
 * into the individual runs it came from (preserving each run's engine `index`,
 * `elementId`, exact `bounds` and `style`). This is what makes a coalesced
 * paragraph round-trip losslessly through `fabricObjectToElements`.
 */
export interface ParagraphRun {
  elementId: string;
  /** Engine text-run index (lossless `replaceText`); undefined if absent. */
  index?: number;
  bounds: { x: number; y: number; width: number; height: number };
  content: string;
}

/** A detected paragraph: 2+ vertically-stacked text runs sharing a style. */
export interface ParagraphGroup {
  /** The source runs, ordered top→bottom. */
  runs: TextRun[];
  /**
   * The runs grouped per VISUAL LINE (reading order). Produced from the lib's
   * `{t:'br'}` line structure when the block groups carry `lines`; table cells
   * and list items (which carry no `{t:'br'}` structure) band their runs into
   * true visual lines by baseline (see bandRunsIntoVisualLines); the remaining
   * producers (positional heuristic, flat `sourceIndices`) emit ONE run per
   * line — the legacy model. `runs` is always the flattening of `lines`.
   */
  lines?: TextRun[][];
  /** Paragraph alignment from the lib block (drives the edit-session Textbox). */
  align?: "left" | "center" | "right" | "justify";
  /** Line height MULTIPLE from the lib block (fallback when unmeasurable). */
  lineHeightMultiple?: number;
  /** The lib block's top-down placement frame (edit-session position/width). */
  frame?: { x: number; y: number; width: number; height: number };
}

/**
 * The descriptor stashed on EVERY member Fabric object of an accepted
 * paragraph group (`data.paragraphGroup`, alongside `data.paragraphGroupId`).
 * AT REST the members stay the per-run / per-segment objects (pixel-1:1 with
 * the raster — nothing about the resting render changes); the descriptor only
 * fuels the EDIT-INTENT path: a double-click on any member swaps the group for
 * ONE multi-line Textbox session (see {@link beginParagraphEditSession}).
 * Plain JSON (serialisable by the history snapshots).
 */
export interface RegisteredParagraphGroup {
  /** Stable id (derived from the first run's elementId). */
  groupId: string;
  /** The source runs per visual line, reading order (plain elements). */
  lines: TextRun[][];
  align?: "left" | "center" | "right" | "justify";
  lineHeightMultiple?: number;
  frame?: { x: number; y: number; width: number; height: number };
}

/** Normalised colour key for "same style" comparison. */
function colourKeyOf(t: TextRun): string {
  return (t.style.color || "#000000").trim().toLowerCase();
}

/**
 * Two runs share the SAME visual style (so they may belong to one paragraph):
 * same family + same embedded subset identity (`originalFont`), font sizes
 * within ±10%, same colour, same weight/style and same horizontal alignment.
 * A style break (e.g. a bold lead-in line, a differently-coloured note) ends
 * the paragraph — exactly what a real editor does.
 */
function sameParagraphStyle(a: TextRun, b: TextRun): boolean {
  const fsA = a.style.fontSize || 0;
  const fsB = b.style.fontSize || 0;
  if (fsA <= 0 || fsB <= 0) return false;
  const ratio = fsA > fsB ? fsA / fsB : fsB / fsA;
  if (ratio > 1.1) return false; // sizes differ by more than 10%
  if ((a.style.fontFamily || "") !== (b.style.fontFamily || "")) return false;
  // `originalFont` now carries the exact `/BaseFont` (subset prefix kept). Two
  // lines of one paragraph routinely use DIFFERENT subsets of the SAME font
  // ("ABCDEF+Times…" vs "GHIJKL+Times…"), so compare with the subset prefix
  // stripped — otherwise the same paragraph would never coalesce (regression).
  if (
    stripSubsetPrefix(a.style.originalFont || "") !==
    stripSubsetPrefix(b.style.originalFont || "")
  ) {
    return false;
  }
  if (colourKeyOf(a) !== colourKeyOf(b)) return false;
  if ((a.style.fontWeight || "normal") !== (b.style.fontWeight || "normal")) {
    return false;
  }
  if ((a.style.fontStyle || "normal") !== (b.style.fontStyle || "normal")) {
    return false;
  }
  if ((a.style.textAlign || "left") !== (b.style.textAlign || "left")) {
    return false;
  }
  return true;
}

/** Horizontal intervals [x, x+width] of the two runs overlap by ≥ minOverlap px. */
function horizontallyOverlap(a: TextRun, b: TextRun, minOverlap: number): boolean {
  const aL = a.bounds.x;
  const aR = a.bounds.x + a.bounds.width;
  const bL = b.bounds.x;
  const bR = b.bounds.x + b.bounds.width;
  return Math.min(aR, bR) - Math.max(aL, bL) >= minOverlap;
}

/**
 * `next` continues the paragraph started by `prev` (the previous line) iff ALL
 * of these hold — deliberately strict so we never merge things that are not a
 * paragraph (titles, form labels, table cells, separate columns):
 *
 *   - same visual style (see {@link sameParagraphStyle});
 *   - left edges aligned within `xTol` (left-aligned / justified body text);
 *   - a REGULAR descending line gap: `next` sits BELOW `prev` and the baseline
 *     step is between ~0.8×fontSize (no overlap) and ~1.8×(fontSize·lineHeight)
 *     (no large jump = new block / blank line);
 *   - the two runs share a horizontal span (same column, not side-by-side).
 *
 * Hyperlinks (linkUrl/linkPage) and RTL runs are never merged (handled by the
 * caller) — wrapping/decoration there is too easy to get wrong.
 */
function continuesParagraph(prev: TextRun, next: TextRun): boolean {
  if (!sameParagraphStyle(prev, next)) return false;

  const fontSize = prev.style.fontSize || 12;
  const lineHeight = prev.style.lineHeight && prev.style.lineHeight > 0
    ? prev.style.lineHeight
    : 1.2;

  // Left edges close (paragraph indentation is consistent line-to-line).
  const xTol = Math.max(2, fontSize * 0.5);
  if (Math.abs(next.bounds.x - prev.bounds.x) > xTol) return false;

  // Descending, regular line gap (top-left Y, axis points downward).
  const gap = next.bounds.y - prev.bounds.y;
  const minGap = fontSize * 0.8;
  const maxGap = fontSize * lineHeight * 1.8;
  if (gap < minGap || gap > maxGap) return false;

  // Same column (significant horizontal overlap), not two side-by-side runs.
  const minOverlap = Math.min(prev.bounds.width, next.bounds.width) * 0.4;
  if (!horizontallyOverlap(prev, next, Math.max(1, minOverlap))) return false;

  return true;
}

/** A run that must NEVER be folded into a paragraph (kept as its own IText). */
function isUngroupableRun(t: TextRun): boolean {
  if (t.linkUrl || t.linkPage) return true; // keep links standalone (underline/click)
  if (t.style.direction === "rtl") return true; // RTL wrapping is delicate
  if (!t.content || t.content.includes("\n")) return true; // empty / already multi-line
  return false; // otherwise groupable
}

/**
 * Median per-line vertical advance of a coalesced paragraph's runs, expressed as
 * a Fabric `lineHeight` MULTIPLE of `fontSize`.
 *
 * A Fabric `Textbox` lays every wrapped line at a UNIFORM `fontSize × lineHeight`.
 * Hardcoding 1.2 (Word's default) over-spaces imported PDF text whose real line
 * advance is tighter — a CERFA body is ~10.5pt for a 10pt font (⇒ ~1.05, not
 * 1.2). The 1.5pt/line excess accumulates, so the coalesced lines drift downward
 * and visually separate from the same-line runs that render as standalone
 * `IText`s at their true `bounds.y` (the "texte emmêlé" the user sees). Deriving
 * the multiple from the runs' own `bounds.y` gaps keeps the box 1:1 with the
 * source for BOTH the lib-`pageBlocks` and positional-heuristic coalescing paths.
 *
 * Pure & deterministic (unit-tested). Same-line runs (gap ≈ 0) are ignored;
 * returns 1.2 when there is < 2 lines or the measurement is degenerate; clamped
 * to a sane range so a single outlier gap can never blow up the spacing.
 */
export function measuredLineHeightMultiple(
  runs: readonly TextRun[],
  fontSize: number,
): number {
  const FALLBACK = 1.2;
  if (fontSize <= 0 || runs.length < 2) return FALLBACK;
  const ys = runs.map((r) => r.bounds.y).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < ys.length; i += 1) {
    const gap = ys[i]! - ys[i - 1]!;
    if (gap > 0.5) gaps.push(gap); // skip same-line runs (≈0 advance)
  }
  if (gaps.length === 0) return FALLBACK;
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor((gaps.length - 1) / 2)]!;
  return Math.min(3, Math.max(0.8, median / fontSize));
}

/**
 * Whether a candidate paragraph's lines are spaced REGULARLY enough to survive a
 * Fabric `Textbox`'s single uniform `lineHeight` without visible drift.
 *
 * A `Textbox` can only advance every line by the SAME `fontSize × lineHeight`.
 * Imported PDF paragraphs frequently mix a body advance with wider sub-paragraph
 * / blank-line gaps (a CERFA intro alternates ~10.5pt and ~14pt). No single
 * lineHeight reproduces that — the median just relocates where the drift piles
 * up (proven: max vertical drift stayed ~6pt). So a non-uniform block must NOT
 * be coalesced; its runs render as standalone `IText`s at their exact `bounds.y`
 * (1:1 fidelity, the ground-truth-clean path). Genuinely uniform paragraphs
 * (typical Word-like content) still coalesce and stay paragraph-editable.
 *
 * Uniform ⇔ every inter-line gap is within ±30% of the median gap. Pure &
 * deterministic (unit-tested). Blocks of < 3 lines have at most one gap and are
 * trivially uniform.
 */
export function hasUniformLineAdvance(runs: readonly TextRun[]): boolean {
  if (runs.length < 3) return true;
  const ys = runs.map((r) => r.bounds.y).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < ys.length; i += 1) {
    const gap = ys[i]! - ys[i - 1]!;
    if (gap > 0.5) gaps.push(gap); // skip same-line runs (≈0 advance)
  }
  if (gaps.length < 2) return true;
  const median = [...gaps].sort((a, b) => a - b)[Math.floor((gaps.length - 1) / 2)]!;
  if (median <= 0) return true;
  return gaps.every((gap) => gap >= median * 0.7 && gap <= median * 1.3);
}

/**
 * Whether a set of runs is a GEOMETRICALLY COHERENT block that a single
 * left-aligned, uniformly-line-spaced `Textbox` can reproduce 1:1.
 *
 * The engine's `pageBlocks` structural reconstruction (paragraphs, headings AND
 * table cells / list items) is authoritative for READING ORDER but is only a
 * heuristic for LAYOUT — on dense administrative forms (CERFA and friends) it
 * routinely mis-groups runs that are visually unrelated: a "paragraph" or a
 * "table cell" whose runs span the footer (`y≈16`) AND the header (`y≈792`), or
 * a two-run "paragraph" that is really a stray space next to a dotted rule 250pt
 * away. Coalescing such a group into ONE `Textbox` — which lays every run on its
 * own left-aligned line at a single uniform advance — RELOCATES those runs
 * (footer text vanishes, header text stacks in the wrong place: the exact
 * symptoms the user reports). {@link hasUniformLineAdvance} rejects the
 * wildly-irregular multi-run cases but is blind to two-run groups (one gap ⇒
 * trivially "uniform") and to uniform-but-huge advances.
 *
 * A coalescable block must therefore satisfy ALL of:
 *  1. **No justified/positioned run** (`segments`): a `TJ`-positioned run's
 *     per-word geometry can never be reproduced by a wrapped `Textbox`, so it
 *     stays per-segment (rendered pixel-exact by the segment branch).
 *  2. **One run per line**: consecutive runs (sorted by `bounds.y`) never share a
 *     line (gap ≥ `0.4·fontSize`). Two runs on the same visual line would be laid
 *     on two separate `Textbox` lines → vertical "texte emmêlé".
 *  3. **Line-contiguous**: no consecutive gap exceeds `2.5·fontSize` — a real
 *     block advances ≈ one line between runs; a jump of hundreds of points means
 *     the lib fused unrelated regions.
 *  4. **Single column**: the runs' left edges cluster within `3·fontSize` — a
 *     left-aligned `Textbox` re-flows every line from the block's min-x, so runs
 *     that start far apart horizontally would be shoved left of where they belong.
 *
 * Rejected groups are NOT dropped — they fall through to the per-run / per-segment
 * IText path, which renders every run at its exact `bounds` (proven pixel-1:1 with
 * the rasterizer). So this gate can only ever IMPROVE fidelity; the cost is that a
 * genuinely centered / multi-run-per-line paragraph loses paragraph-level editing
 * (it stays a set of standalone ITexts) — an accepted trade (a false coalesce is
 * worse than none). Pure & deterministic (unit-tested).
 */
export function isCoherentCoalescedBlock(runs: readonly TextRun[]): boolean {
  if (runs.length < 2) return true; // a lone run is never coalesced anyway
  // (1) Justified / per-glyph-positioned runs must stay per-segment.
  if (runs.some((r) => r.segments && r.segments.length > 0)) return false;

  const sizes = runs
    .map((r) => r.style.fontSize || 12)
    .sort((a, b) => a - b);
  const fs = sizes[Math.floor((sizes.length - 1) / 2)] || 12;

  const ys = runs.map((r) => r.bounds.y).sort((a, b) => a - b);
  for (let i = 1; i < ys.length; i += 1) {
    const gap = ys[i]! - ys[i - 1]!;
    if (gap < fs * 0.4) return false; // (2) same-line runs → would stack
    if (gap > fs * 2.5) return false; // (3) discontinuity → unrelated regions
  }

  // (4) Single-column: left edges must cluster (a left-aligned Textbox reflows
  //     every line from min-x, so scattered starts would be pulled leftward).
  const xs = runs.map((r) => r.bounds.x);
  if (Math.max(...xs) - Math.min(...xs) > fs * 3) return false;

  return true;
}

/** Horizontal span (left/right) of one visual line = union of its runs. */
function lineSpanOf(line: readonly TextRun[]): { left: number; right: number } {
  let left = Infinity;
  let right = -Infinity;
  for (const r of line) {
    left = Math.min(left, r.bounds.x);
    right = Math.max(right, r.bounds.x + r.bounds.width);
  }
  return { left, right };
}

/** A group's visual lines: the lib `{t:'br'}` structure, or one run per line. */
function linesOfGroup(group: ParagraphGroup): TextRun[][] {
  if (group.lines && group.lines.length > 0) return group.lines;
  return group.runs.map((r) => [r]);
}

/**
 * PER-LINE coherence gate for a coalesced paragraph candidate — the EDIT-INTENT
 * successor of {@link isCoherentCoalescedBlock} (kept exported for reference /
 * tests but no longer gating the render). Since lib 0.114 repaired the
 * `source_index` seam and hardened `split_paragraphs` (no more footer↔header
 * fusions), the gate can reason about LINES instead of RUNS, which unlocks
 * multi-run lines and justified (segmented) paragraphs:
 *
 *   1. Lines sorted by top-Y must be STRICTLY descending on the page (two
 *      "lines" sharing a Y means the line structure is wrong → reject);
 *   2. Every inter-line gap sits within `[0.4, 2.5] ×` the MEASURED leading
 *      (median gap). The median itself must stay ≤ `3 ×` the median font size
 *      — the anchor that keeps a two-line group (whose lone gap IS the median)
 *      from accepting a footer↔header jump;
 *   3. CONSECUTIVE lines overlap horizontally by ≥ 20% of the narrower line
 *      (same column — an indented first/last line still passes).
 *
 * DELIBERATELY GONE vs the old run-level gate: the "one run per line" rule
 * (the lib now says which runs share a line), the run left-edge spread rule
 * (multi-run lines legitimately start apart), and the blanket `segments` ban
 * (a justified paragraph is exactly what paragraph editing is FOR — at rest it
 * still renders per-segment, pixel-exact). Acceptance no longer changes the
 * resting render at all: members are only TAGGED for the edit session, and a
 * rejected group simply keeps per-run editing. Pure & deterministic.
 */
export function isCoherentLineGroup(
  lines: readonly (readonly TextRun[])[],
): boolean {
  const nonEmpty = lines.filter((l) => l.length > 0);
  if (nonEmpty.length === 0) return false;
  const all = nonEmpty.flat();
  if (all.length < 2) return true; // a lone run is never coalesced anyway
  if (nonEmpty.length === 1) return true; // one multi-run line — trivially coherent

  // Median font size = the reference the leading anchor is expressed in.
  const sizes = all.map((r) => r.style.fontSize || 12).sort((a, b) => a - b);
  const fs = sizes[Math.floor((sizes.length - 1) / 2)] || 12;

  // (1) Strictly descending line tops (sorted defensively — reading order in,
  //     but a shared Y between two "lines" must reject either way).
  const tops = nonEmpty
    .map((l) => Math.min(...l.map((r) => r.bounds.y)))
    .sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < tops.length; i += 1) {
    const gap = tops[i]! - tops[i - 1]!;
    if (gap <= 0.5) return false;
    gaps.push(gap);
  }

  // (2) Gap regularity around the measured leading + the font-size anchor.
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  const leading = sortedGaps[Math.floor((sortedGaps.length - 1) / 2)]!;
  if (leading > fs * 3) return false;
  for (const gap of gaps) {
    if (gap < leading * 0.4 || gap > leading * 2.5) return false;
  }

  // (3) Consecutive lines share a column (≥ 20% overlap of the narrower one).
  const byTop = [...nonEmpty].sort(
    (a, b) =>
      Math.min(...a.map((r) => r.bounds.y)) -
      Math.min(...b.map((r) => r.bounds.y)),
  );
  for (let i = 1; i < byTop.length; i += 1) {
    const a = lineSpanOf(byTop[i - 1]!);
    const b = lineSpanOf(byTop[i]!);
    const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const minWidth = Math.max(1, Math.min(a.right - a.left, b.right - b.left));
    if (overlap < minWidth * 0.2) return false;
  }

  return true;
}

/**
 * Group consecutive same-style, regularly-spaced, left-aligned text runs into
 * paragraphs. Returns BOTH the detected paragraph groups (2+ runs) AND the runs
 * that stay standalone. Pure & deterministic — drives the renderer and is unit
 * tested in isolation.
 *
 * Conservative by design: a single line, a style change, an irregular gap, a
 * column change, a link or an RTL run all CLOSE the current paragraph. A false
 * merge is worse than no merge, so when in doubt a run is left on its own.
 */
export function groupTextRunsIntoParagraphs(elements: Element[]): {
  paragraphs: ParagraphGroup[];
  standalone: TextRun[];
} {
  const runs = elements.filter((e): e is TextRun => e.type === "text");
  // Top→bottom, then left→right, so paragraph lines are visited in reading order.
  const ordered = [...runs].sort((a, b) => {
    const dy = a.bounds.y - b.bounds.y;
    if (Math.abs(dy) > 0.5) return dy;
    return a.bounds.x - b.bounds.x;
  });

  const paragraphs: ParagraphGroup[] = [];
  const standalone: TextRun[] = [];
  const consumed = new Set<TextRun>();

  for (let i = 0; i < ordered.length; i++) {
    const start = ordered[i]!;
    if (consumed.has(start)) continue;
    if (isUngroupableRun(start)) {
      standalone.push(start);
      consumed.add(start);
      continue;
    }
    // Greedily extend the paragraph downward from `start`.
    const group: TextRun[] = [start];
    consumed.add(start);
    let prev = start;
    for (let j = i + 1; j < ordered.length; j++) {
      const cand = ordered[j]!;
      if (consumed.has(cand)) continue;
      if (isUngroupableRun(cand)) continue;
      if (continuesParagraph(prev, cand)) {
        group.push(cand);
        consumed.add(cand);
        prev = cand;
      }
      // Do NOT break on first non-match: a later run could still be the next
      // line if an unrelated run interleaved in the sort. But once the vertical
      // gap to the LAST paragraph line is exceeded, stop scanning (perf + safety).
      else if (cand.bounds.y - prev.bounds.y > (prev.style.fontSize || 12) * (prev.style.lineHeight || 1.2) * 1.8) {
        break;
      }
    }
    if (group.length >= 2) {
      // The heuristic detects one run per line → legacy one-run-per-line model.
      paragraphs.push({ runs: group, lines: group.map((r) => [r]) });
    } else {
      standalone.push(start);
    }
  }

  return { paragraphs, standalone };
}

/**
 * Coalesce paragraphs/headings from the native engine's STRUCTURAL grouping
 * (the lib is the source of reading structure) instead of the positional
 * heuristic. Each {@link PageBlockGroup} lists the engine `source_index`es of a
 * paragraph/heading block's runs in reading order; those map 1:1 onto
 * `TextElement.index`, so we resolve each run from the page's ALREADY-PARSED
 * text elements (keeping their exact bounds, style and embedded-font identity)
 * and assemble a {@link ParagraphGroup}. The resulting groups feed the same
 * Textbox render + `data.paragraphRuns` lossless decompose-save path as the
 * heuristic — the lib only decides WHICH runs group together.
 *
 * Pure & deterministic. Robust to drift between the lib grouping and the parsed
 * elements: an index with no matching text run (or already consumed) is skipped,
 * and a group that ends up with < 2 resolvable runs is dropped (its lone run, if
 * any, stays a standalone IText — identical to the no-grouping behaviour).
 *
 * @param elements   The page's flat scene-graph elements (text + others).
 * @param blockGroups The engine block grouping for the page.
 * @returns Detected paragraph groups (≥ 2 runs) + the text runs left standalone.
 */
export function pageBlockGroupsToParagraphs(
  elements: Element[],
  blockGroups: PageBlockGroup[],
): { paragraphs: ParagraphGroup[]; standalone: TextRun[] } {
  // Index the page's text runs by their engine index for O(1) lookup. A run
  // without an `index` (newly added, or non-editable form-XObject sentinel) is
  // not addressable by the lib grouping and stays standalone.
  const runByIndex = new Map<number, TextRun>();
  const allRuns: TextRun[] = [];
  for (const el of elements) {
    if (el.type !== "text") continue;
    const run = el as TextRun;
    allRuns.push(run);
    if (typeof run.index === "number" && run.index >= 0) {
      // First run wins for a given index (indices are unique per page in
      // practice; this guards against any accidental duplicate).
      if (!runByIndex.has(run.index)) runByIndex.set(run.index, run);
    }
  }

  const paragraphs: ParagraphGroup[] = [];
  const consumed = new Set<TextRun>();

  for (const group of blockGroups) {
    if (group.kind !== "paragraph" && group.kind !== "heading") continue;
    // The lib's `{t:'br'}` line structure (lib ≥ 0.114) — falls back to the
    // legacy one-run-per-line model when `lines` is absent (older producer).
    const indexLines: number[][] =
      group.lines && group.lines.length > 0
        ? group.lines
        : group.sourceIndices.map((i) => [i]);

    const lines: TextRun[][] = [];
    const claimed: TextRun[] = [];
    for (const lineIndices of indexLines) {
      const lineRuns: TextRun[] = [];
      for (const sourceIndex of lineIndices) {
        const run = runByIndex.get(sourceIndex);
        // Skip a missing index, an already-consumed run (defensive against a
        // run claimed by two blocks), and ungroupable runs (links/RTL/
        // multi-line) so they keep their dedicated standalone rendering.
        if (!run || consumed.has(run) || isUngroupableRun(run)) continue;
        lineRuns.push(run);
        consumed.add(run);
        claimed.push(run);
      }
      // A line whose runs all failed to resolve is skipped (the group keeps
      // its remaining lines — same "skip the hole" policy as before).
      if (lineRuns.length > 0) lines.push(lineRuns);
    }

    const runs = lines.flat();
    if (runs.length >= 2) {
      paragraphs.push({
        runs,
        lines,
        ...(group.align ? { align: group.align } : {}),
        ...(group.lineHeightMultiple
          ? { lineHeightMultiple: group.lineHeightMultiple }
          : {}),
        ...(group.frame ? { frame: group.frame } : {}),
      });
    } else {
      // A block that resolved to a single run is not worth a paragraph session
      // — release its run so it renders as a standalone IText below.
      for (const r of claimed) consumed.delete(r);
    }
  }

  const standalone = allRuns.filter((r) => !consumed.has(r));
  return { paragraphs, standalone };
}

// ---------------------------------------------------------------------------
// Table / list reconstruction (Word-like editing) — pure helpers
//
// A `table` group carries a grid of cells, a `list` group carries ordered items;
// each cell/item lists the engine `source_index`es of ITS runs (reading order).
// We resolve those indices against the page's already-parsed text runs and emit
// a {@link ParagraphGroup} per cell/item that has ≥ 2 resolvable runs — so a
// multi-line cell/item becomes ONE editable, positioned Textbox flowing through
// the exact same render + `data.paragraphRuns` lossless decompose-save as a
// coalesced paragraph. The cell's own grid position needs no extra geometry: the
// resolved runs already carry their real `bounds`, so the Textbox lands exactly
// where the cell's text is (union of the runs' bounds, identical to a paragraph).
//
// FALLBACK / ZERO-REGRESSION: a cell/item whose runs do NOT resolve (empty
// `sourceIndices` — the common case, the engine emits `source_index: null` for
// most table/list runs today), or that resolves to a single run, contributes
// NOTHING and leaves its runs untouched — they stay flat `TextElement`s rendered
// element-by-element, byte-identical to today's table/list rendering. The list
// marker glyph (bullet/number) is itself a flat element rendered as-is; it is
// never injected into a run's editable text (that would corrupt the lossless
// `replaceText` round-trip).
// ---------------------------------------------------------------------------

/**
 * Band a cell/item's resolved runs into TRUE visual lines. Table cells and
 * list items carry no `{t:'br'}` line structure, yet a cell routinely holds
 * several runs on ONE baseline ("Nom :" + "DUPONT"). Two runs share a line
 * when their tops sit within `0.5 × fontSize` of the line's anchor run (the
 * topmost run that opened the line — the tolerance is expressed in ITS font
 * size). Each banded line is sorted left→right and the lines run top→bottom,
 * so the result reads in visual order; a run with no baseline neighbour stays
 * a one-run line — identical to the legacy one-run-per-line model. Pure &
 * deterministic.
 */
function bandRunsIntoVisualLines(runs: readonly TextRun[]): TextRun[][] {
  const byTop = [...runs].sort((a, b) => {
    const dy = a.bounds.y - b.bounds.y;
    if (dy !== 0) return dy;
    return a.bounds.x - b.bounds.x;
  });
  const lines: TextRun[][] = [];
  let current: TextRun[] = [];
  let anchorTop = 0;
  let anchorTol = 0;
  for (const run of byTop) {
    if (current.length > 0 && Math.abs(run.bounds.y - anchorTop) <= anchorTol) {
      current.push(run);
    } else {
      if (current.length > 0) lines.push(current);
      current = [run];
      anchorTop = run.bounds.y;
      anchorTol = (run.style.fontSize || 12) * 0.5;
    }
  }
  if (current.length > 0) lines.push(current);
  for (const line of lines) {
    line.sort((a, b) => a.bounds.x - b.bounds.x);
  }
  return lines;
}

/**
 * Reconstruct paragraph groups from the engine's `table` / `list` block groups.
 * Each cell (table) / item (list) with ≥ 2 resolvable runs becomes one
 * {@link ParagraphGroup}; cells/items with 0–1 resolvable run are skipped and
 * their runs left standalone. Pure & deterministic. Reuses the same
 * index→run resolution as {@link pageBlockGroupsToParagraphs}, including the
 * defensive guards (missing index, run already consumed by another block,
 * ungroupable links/RTL/multi-line runs).
 *
 * @param elements   The page's flat scene-graph elements (text + others).
 * @param blockGroups The engine block grouping for the page (any kinds).
 * @returns Paragraph groups for the table cells / list items + the runs left
 *          standalone (everything not folded into a cell/item Textbox).
 */
export function pageBlockGroupsToTablesAndLists(
  elements: Element[],
  blockGroups: PageBlockGroup[],
): { paragraphs: ParagraphGroup[]; standalone: TextRun[] } {
  const runByIndex = new Map<number, TextRun>();
  const allRuns: TextRun[] = [];
  for (const el of elements) {
    if (el.type !== "text") continue;
    const run = el as TextRun;
    allRuns.push(run);
    if (typeof run.index === "number" && run.index >= 0) {
      if (!runByIndex.has(run.index)) runByIndex.set(run.index, run);
    }
  }

  const paragraphs: ParagraphGroup[] = [];
  const consumed = new Set<TextRun>();

  // Resolve one cell/item's source indices into a coalesced ParagraphGroup when
  // it holds ≥ 2 editable runs; release a sub-2 group so its run(s) stay
  // standalone (a 1-run cell is already an identically-positioned IText today).
  const foldUnit = (sourceIndices: number[]): void => {
    const runs: TextRun[] = [];
    for (const sourceIndex of sourceIndices) {
      const run = runByIndex.get(sourceIndex);
      if (!run || consumed.has(run) || isUngroupableRun(run)) continue;
      runs.push(run);
      consumed.add(run);
    }
    if (runs.length >= 2) {
      // Cells/items carry no `{t:'br'}` structure — band the runs into TRUE
      // visual lines instead (see bandRunsIntoVisualLines). The synthetic
      // one-run-per-"line" model made two same-baseline runs ("Nom :" +
      // "DUPONT") produce two "lines" sharing a top-Y → rejected by the
      // strictly-descending rule of isCoherentLineGroup, so such cells were
      // never block-editable. `runs` stays the flattening of `lines` (banded
      // reading order), per the ParagraphGroup contract.
      const lines = bandRunsIntoVisualLines(runs);
      paragraphs.push({ runs: lines.flat(), lines });
    } else {
      for (const r of runs) consumed.delete(r);
    }
  };

  for (const group of blockGroups) {
    if (group.kind === "table" && group.table) {
      for (const cell of group.table.cells as PageBlockTableCell[]) {
        foldUnit(cell.sourceIndices);
      }
    } else if (group.kind === "list" && group.list) {
      for (const item of group.list.items as PageBlockListItem[]) {
        foldUnit(item.sourceIndices);
      }
    }
  }

  const standalone = allRuns.filter((r) => !consumed.has(r));
  return { paragraphs, standalone };
}

// ---------------------------------------------------------------------------
// API publique
// ---------------------------------------------------------------------------

/**
 * Rend tous les éléments parsés en objets Fabric.js (invisibles, hit-targets)
 * sur le canvas donné. Le rendu est identique pour le single-page et le continu.
 */
export async function renderElementsOverlay(
  canvas: FabricCanvas,
  elements: Element[],
  fabricModule: FabricModule,
  options: RenderElementsOptions = {},
): Promise<void> {
  const {
    scale = 1,
    readonly = false,
    onElementSelected,
    getFontFaceName,
    resolveImageUrl = defaultResolveImageUrl,
    applyHideMask,
    groupParagraphs = true,
    blockGroups,
  } = options;
  // Géométrie en points natifs : le zoom est géré par canvas.setZoom().
  void scale;

  const {
    Rect,
    Circle,
    Ellipse,
    Triangle,
    Line,
    IText,
    Textbox,
    FabricImage,
    Path: FabricPath,
    Polygon,
  } = fabricModule;

  // Sweep any lingering hover-affordance outline (transient chrome). It carries
  // NO elementId, so clearElementsOverlay never removes it — without this sweep
  // a re-render fired mid-hover would stack a stale outline over the fresh
  // overlay (its mouse:out may never fire once the hovered member is gone).
  for (const stale of canvas
    .getObjects()
    .filter(
      (o) =>
        (o as FabricObjectWithData).data?.isParagraphHoverOutline === true,
    )) {
    canvas.remove(stale);
  }

  // Collect image-load promises to await them all before the final renderAll
  const imageLoadPromises: Promise<void>[] = [];

  // 1. SORT BY Z-ORDER LAYER: shapes (background fills, banner rectangles)
  //    must render BEHIND text and images. Without this, a red banner shape
  //    extracted later in the parser ends up on top of its own text label,
  //    making it unreadable. Layer order: shape < image < text < annotation < form_field.
  const layerRank: Record<string, number> = {
    shape: 0,
    image: 1,
    draw: 2,
    text: 3,
    annotation: 4,
    form_field: 5,
  };
  const sortedElements = [...elements].sort((a, b) => {
    const ra = layerRank[a.type] ?? 99;
    const rb = layerRank[b.type] ?? 99;
    return ra - rb;
  });

  // 2. DEDUPLICATE near-identical text runs. PDFs sometimes render the
  //    same string twice — generators do this for shadow/relief effects,
  //    or because they layer a vector outline (custom font) above an
  //    invisible selectable-text trace (system font fallback). Both
  //    cases produce two stacked IText objects in our scene graph; the
  //    user sees a doubled title and clicking one selects the wrong
  //    layer.
  //
  //    The signature deliberately ignores fontFamily because the duplicate
  //    typically uses a different family (embedded outline vs Helvetica
  //    fallback). Matching on content + rounded fontSize + tight position
  //    (≤2px on BOTH axes) is enough — wider tolerance kills legitimate
  //    repeats.
  //
  //    DEDUPE RULE (single, conservative): drop the second occurrence ONLY
  //    when it is a true shadow/outline twin — same content + same colour +
  //    within 2px on BOTH the X AND Y axes. A real shadow/relief or
  //    vector-outline-over-trace duplicate sits within sub-pixel of its
  //    twin, so 2px covers it.
  //
  //    Anything farther apart on EITHER axis is a legitimate distinct run
  //    and MUST be kept. This includes:
  //      - cross-line repeats ("RONY LICHA" on sender + recipient lines:
  //        same y, offset x),
  //      - same-column repeats at different rows (form field labels, table
  //        cells, repeated values like "Les Lilas" down a column: same x,
  //        different y).
  //    A previous heuristic also dropped "same X (≤3px) + ANY Y" to catch a
  //    form save-loop re-render; that over-suppressed legitimate column
  //    repeats on real forms (whole runs vanished from the editor), so it is
  //    removed — the save-loop case is now handled upstream (the overlay is
  //    no longer baked back as a second text run) and never warrants killing
  //    a run that differs in Y.
  //
  //    Colour is part of the signature so a white "6,99€" on a red banner
  //    does not get killed by a black drop-shadow twin that appeared first
  //    in the parser stream.
  const seenTextSignatures = new Map<string, Array<{ x: number; y: number }>>();
  const dedupedElements = sortedElements.filter((el) => {
    if (el.type !== "text") return true;
    const textElement = el as Extract<Element, { type: "text" }>;
    const colourKey = (textElement.style.color || "#000000").toLowerCase();
    const sig = `${textElement.content}|${Math.round(textElement.style.fontSize)}|${colourKey}`;
    const positions = seenTextSignatures.get(sig);
    const here = { x: textElement.bounds.x, y: textElement.bounds.y };
    if (!positions) {
      seenTextSignatures.set(sig, [here]);
      return true;
    }
    // True shadow/outline twin ONLY: same content + colour, within 2px on
    // BOTH axes. Different X or different Y → legitimate distinct run, keep.
    const isShadowTwin = positions.some((p) => {
      const dx = Math.abs(p.x - here.x);
      const dy = Math.abs(p.y - here.y);
      return dx <= 2 && dy <= 2;
    });
    if (isShadowTwin) return false;
    positions.push(here);
    return true;
  });

  // 3. GROUP TEXT RUNS INTO PARAGRAPHS (Word-like editing). Consecutive runs of
  //    a paragraph/heading are coalesced into one multi-line `Textbox` (like
  //    Adobe grouping an intro paragraph into one editable block) instead of N
  //    IText. The grouping comes from the native engine's `pageBlocks` when the
  //    caller supplies `blockGroups` (the lib = source of structure); otherwise
  //    it falls back to the positional heuristic. Either way the folded runs are
  //    excluded from the per-line IText loop below (tracked by elementId) and
  //    rendered as Textboxes afterwards, and both paths produce the SAME
  //    ParagraphGroup shape → identical lossless decompose-save. Conservative —
  //    a title / label / table cell / column / link stays its own IText.
  const paragraphGroups = !groupParagraphs
    ? []
    : blockGroups && blockGroups.length > 0
      ? pageBlockGroupsToParagraphs(dedupedElements, blockGroups).paragraphs
      : groupTextRunsIntoParagraphs(dedupedElements).paragraphs;

  // TABLE / LIST reconstruction (Word-like): when the engine supplied block
  // groups, additionally coalesce each table cell / list item that resolves to
  // ≥ 2 editable runs into ONE positioned Textbox (same render + lossless
  // decompose-save as a paragraph). Cells/items with 0–1 resolvable run are NOT
  // folded — their runs stay flat IText, byte-identical to today (the common
  // case, since most table/list runs carry no engine `source_index`). These
  // groups are disjoint from the paragraph/heading groups above (a run belongs
  // to exactly one block in the engine's reading structure).
  const tableListGroups =
    groupParagraphs && blockGroups && blockGroups.length > 0
      ? pageBlockGroupsToTablesAndLists(dedupedElements, blockGroups).paragraphs
      : [];

  // EVERY coalesced candidate (paragraph, table cell OR list item) keeps its
  // BLOCK IDENTITY — the per-line coherence gate (see isCoherentLineGroup) no
  // longer decides membership, only whether the double-click may open the
  // multi-line Textbox SESSION (`data.paragraphSessionable`, computed at
  // tagging time below). A rejected group still tags its members with the
  // group id, so a single click selects the whole block; its double-click
  // stays the per-run inline edit (a geometrically incoherent group would
  // drift inside one Textbox). The resting render is per-run either way.
  const allCoalescedGroups = [...paragraphGroups, ...tableListGroups];

  for (const element of dedupedElements) {
    // Guard: skip elements with missing or zero-size bounds
    if (
      !element.bounds ||
      element.bounds.width <= 0 ||
      element.bounds.height <= 0
    ) {
      continue;
    }

    // EDIT-INTENT model: a text run that belongs to an accepted paragraph
    // group is STILL rendered per-run/per-segment right here (the resting
    // render is the proven pixel-1:1 path). Its membership is tagged AFTER
    // this loop (data.paragraphGroupId) so a double-click opens the group's
    // multi-line edit session instead of the single-run inline edit.
    const baseOptions = {
      left: element.bounds.x,
      top: element.bounds.y,
      // Fabric 6.x defaults to originX/Y: 'center' which treats left/top as
      // the OBJECT CENTER. Parser produces top-left coords, so force origin
      // to 'left'/'top' to avoid visual offset of width/2, height/2.
      originX: "left" as const,
      originY: "top" as const,
      angle: element.transform?.rotation || 0,
      selectable: !element.locked && !readonly,
      evented: !element.locked && !readonly,
      visible: element.visible,
    };

    let fabricObj: FabricObject | null = null;

    switch (element.type) {
      case "text": {
        const textElement = element;
        // Resolved colour (kept on .data so edit mode can restore it)
        const textColour = textElement.style.color || "#000000";
        // pdf-engine text-extractor stores bounds.{x,y} at the TOP-LEFT
        // of the glyph bbox (= baseline - fontSize approximated as ascender).
        // For Fabric's baseline to land on the PDF baseline (= bounds.y +
        // fontSize), use originY='bottom' with top = bounds.y + fontSize +
        // descender (~22% of fontSize). Geometry + constant live in the shared
        // text-baseline module (single source of truth with the save-time
        // inverse boundsYFromBaselineTop in fabric-element-io.ts), so the
        // place → save → reload round-trip can never drift.
        const _fontSize = textElement.style.fontSize ?? 12;
        const _baselineTop = baselineTopFromBoundsY(
          textElement.bounds.y,
          _fontSize,
        );
        // Resolve the embedded PDF font WEIGHT/STYLE-AWARE: pick the subset that
        // matches this run's bold/italic so a regular run never lands on the
        // first-loaded BOLD subset (the "gras parasite" + wrong-metrics overlap).
        // When the exact variant is embedded, its FontFace already IS the right
        // weight/style → no synthetic bold/italic (which would double-bold and
        // widen glyphs). Otherwise the parsed weight/style is applied synthetically.
        const _font = resolveTextFont(
          textElement.style,
          getFontFaceName,
          textElement.content || "",
        );
        const _usingEmbeddedFont = _font.usingEmbeddedFont;
        const _resolvedFontFamily = _font.fontFamily;
        // JUSTIFIED / per-glyph-positioned run: the engine split it into
        // positioned fragments (a legal footer's TJ jumps a single box can't
        // reproduce). Paint ONE IText per fragment at its exact box — 1:1 with the
        // render — instead of one drifting box. All fragments share the run's
        // elementId/index so selecting/moving/deleting still targets the whole run
        // (fragments are display-exact, not individually inline-editable: editing
        // one fragment's text would corrupt the run). Added directly here; the
        // post-switch single-object add is skipped (fabricObj left null).
        if (textElement.segments && textElement.segments.length > 0) {
          for (let si = 0; si < textElement.segments.length; si += 1) {
            const seg = textElement.segments[si]!;
            const segObj = new IText(seg.text, {
              ...baseOptions,
              left: seg.bounds.x,
              top: baselineTopFromBoundsY(seg.bounds.y, _fontSize),
              originY: "bottom" as const,
              width: seg.bounds.width,
              fontSize: _fontSize,
              fontFamily: _resolvedFontFamily,
              fontWeight: _font.fontWeight,
              fontStyle: _font.fontStyle,
              fill: textColour,
              opacity: textElement.style.opacity ?? 1,
              textAlign: "left" as const,
              lineHeight: 1,
              charSpacing: (textElement.style.letterSpacing || 0) * 10,
              underline: textElement.style.underline || false,
              linethrough: textElement.style.strikethrough || false,
              editable: false,
              textBackgroundColor: "",
              hasControls: true,
              hasBorders: true,
              borderColor: "rgba(0, 100, 200, 0.75)",
              borderScaleFactor: 1,
              cornerColor: "rgb(0, 100, 200)",
              cornerStrokeColor: "#ffffff",
              cornerSize: 8,
              transparentCorners: false,
              // Pointeur grossier : poignées tactiles élargies (touchCornerSize
              // + padding) — {} sur pointeur fin, visuel desktop inchangé.
              ...coarseControlProps(),
            });
            // Fit the word to its exact /Widths box for ANY font (embedded too): the
            // browser draws it at the FontFace's hmtx advance, a hair wider than the
            // PDF /Widths, and over a justified line those hair-widths would eat the
            // inter-word gaps ("amende et/ou" → "amendeet/ou"). Shrinking to the box
            // restores the rasterizer's exact per-word footprint. See applySegmentWidthFit.
            applySegmentWidthFit(segObj, seg.bounds.width);
            (segObj as FabricObjectWithData).data = {
              elementId: textElement.elementId,
              type: "text",
              index: textElement.index,
              rotation0: textElement.transform?.rotation ?? 0,
              originalFont: textElement.style.originalFont,
              usingEmbeddedFont: _usingEmbeddedFont,
              originalFill: textColour,
              originalBgColor: textElement.style.backgroundColor || "",
              linkUrl: null,
              linkPage: null,
              listMarkerLen: 0,
              listStyle: null,
              indentLeft: 0,
              locked: textElement.locked === true,
              // Display fragment of a segmented run — excluded from save (the run
              // is persisted once via its index/binary, never per fragment).
              isRunSegment: true,
              segmentIndex: si,
            };
            canvas.add(segObj as unknown as FabricObject);
          }
          fabricObj = null;
          break;
        }
        // Word-like list + paragraph indentation. The marker glyph is a
        // DECORATION composed into the DISPLAYED text only (the model `content`
        // stays clean — the serialiser strips it back). The box is shifted right
        // by the combined indent so the marker sits in a gutter. Absent
        // list/indentLeft ⇒ offset 0, display === content (legacy behaviour).
        const _indentOffset = leftIndentOffset(textElement.style);
        const { display: _displayText, prefixLen: _markerLen } =
          composeDisplayText(textElement.content || "", textElement.style);
        const textObj = new IText(_displayText, {
          ...baseOptions,
          left: baseOptions.left + _indentOffset,
          top: _baselineTop,
          originY: "bottom" as const,
          width: textElement.bounds.width,
          fontSize: _fontSize,
          fontFamily: _resolvedFontFamily,
          // Variant-exact embedded subset → no synthetic bold/italic; loose/CSS
          // fallback → honour the parsed weight/style (see resolveTextFont).
          fontWeight: _font.fontWeight,
          fontStyle: _font.fontStyle,
          // DIRECT-TEXT model: the page background is rasterised WITHOUT text
          // (engine `renderPageNoText`), so this overlay IS the visible text —
          // rendered in its REAL colour and embedded font. No colour mask is
          // ever needed (nothing underneath), so editing works on any
          // background (gradients included). data.originalFill keeps the colour
          // for the properties panel / layer-hide toggle.
          fill: textColour,
          opacity: textElement.style.opacity ?? 1,
          textAlign: textElement.style.textAlign || "left",
          lineHeight: textElement.style.lineHeight || 1.2,
          charSpacing: (textElement.style.letterSpacing || 0) * 10,
          underline: textElement.style.underline || false,
          linethrough: textElement.style.strikethrough || false,
          textBackgroundColor: "",
          cursorColor: textColour,
          cursorWidth: 1,
          // Selection visuals stay subtle so we don't pollute the page
          selectionColor: "rgba(0, 100, 200, 0.18)",
          // Selected state must be visually obvious — without a visible
          // border + controls the user clicks the title and sees nothing
          // change, then concludes "the editor is broken". Fabric only
          // draws border/controls when the object is the active target,
          // so this stays clean for the unselected glyphs.
          hasControls: true,
          hasBorders: true,
          borderColor: "rgba(0, 100, 200, 0.75)",
          borderScaleFactor: 1,
          cornerColor: "rgb(0, 100, 200)",
          cornerStrokeColor: "#ffffff",
          cornerSize: 8,
          transparentCorners: false,
          // Pointeur grossier : poignées tactiles élargies ({} sur desktop).
          ...coarseControlProps(),
        });
        // Fit the run to its exact /Widths box for ANY font (embedded too). Even the
        // exact embedded subset renders at the FontFace's hmtx advance, which is a
        // hair WIDER than the PDF's /Widths — so a run interleaved in a justified line
        // (a footer's plain " 'obtenir" / " le versement" between positioned words)
        // overflows and overlaps its neighbour. Shrinking to the box restores the
        // rasterizer's footprint; it never expands, so a run that already fits (the
        // common left-aligned paragraph case) is untouched. See applySegmentWidthFit.
        applySegmentWidthFit(textObj, textElement.bounds.width);
        (textObj as FabricObjectWithData).data = {
          elementId: textElement.elementId,
          type: "text",
          // Engine text-run index → lossless in-place replaceText/moveElement.
          index: textElement.index,
          rotation0: textElement.transform?.rotation ?? 0,
          originalFont: textElement.style.originalFont,
          // True when the embedded PDF font was resolved & registered — the
          // overlay then renders with the SAME typography as the original, so no
          // synthetic weight/style is applied.
          usingEmbeddedFont: _usingEmbeddedFont,
          originalFill: textColour,
          originalBgColor: textElement.style.backgroundColor || "",
          linkUrl: textElement.linkUrl,
          linkPage: textElement.linkPage,
          // Length of the decorative list-marker prefix prepended to the
          // displayed text (0 when not a list). The serialiser strips exactly
          // this many leading chars to recover the clean `content`, and the
          // list style itself is re-read from `data.listStyle`/`data.indentLeft`.
          listMarkerLen: _markerLen,
          listStyle: textElement.style.list ?? null,
          indentLeft: textElement.style.indentLeft ?? 0,
        };
        // Word-like partial formatting: project the model's character-level
        // runs onto Fabric's native per-character `styles` map. Absent/empty
        // runs ⇒ {} ⇒ Fabric renders the run uniformly via the object-level
        // fontWeight/fill/… set above (legacy behaviour, no per-char styling).
        // When a list marker prefixes line 0, shift the map right by its length
        // so per-char styling stays aligned with the (unstyled) marker present.
        const _charStyles = shiftStylesForMarker(
          runsToFabricStyles(textElement.content || "", textElement.runs),
          _markerLen,
        );
        if (Object.keys(_charStyles).length > 0) {
          textObj.set("styles", _charStyles);
        }
        // Style hyperlinks
        if (
          (textElement.linkUrl || textElement.linkPage) &&
          !textElement.style.underline
        ) {
          textObj.set({ underline: true });
        }
        fabricObj = textObj as unknown as FabricObject;
        break;
      }

      case "image": {
        const imgElement = element;
        if (imgElement.source?.dataUrl) {
          const imageUrl = resolveImageUrl(imgElement.source.dataUrl);
          const originalWidth =
            imgElement.source.originalDimensions?.width ||
            imgElement.bounds.width;
          const originalHeight =
            imgElement.source.originalDimensions?.height ||
            imgElement.bounds.height;
          const targetScaleX = imgElement.bounds.width / (originalWidth || 1);
          const targetScaleY = imgElement.bounds.height / (originalHeight || 1);

          // A PARSED image (carries an engine `index`) is ALREADY baked into the
          // text-free raster background, so its overlay must be an INVISIBLE
          // (opacity 0) hit-target — exactly like the shape overlays — otherwise
          // a full-page parsed background image paints OVER the text and steals
          // every click. A NEWLY-ADDED image (no `index`) is NOT in the raster,
          // so it stays VISIBLE at its real opacity.
          const isParsedImage = imgElement.index !== undefined;
          const realImageOpacity = imgElement.style?.opacity ?? 1;

          const loadPromise = FabricImage.fromURL(imageUrl, {
            crossOrigin: "anonymous",
          })
            .then((img: FabricObject) => {
              img.set({
                ...baseOptions,
                scaleX: targetScaleX,
                scaleY: targetScaleY,
                // Parsed → invisible hit-target; new → visible at real opacity.
                opacity: isParsedImage ? 0 : realImageOpacity,
              });
              (img as FabricObjectWithData).data = {
                elementId: imgElement.elementId,
                type: "image",
                // Engine unified element index → lossless in-place
                // transformElement (move/resize) / removeElement (delete).
                index: imgElement.index,
                rotation0: imgElement.transform?.rotation ?? 0,
                // True opacity preserved for save (so the 0 display opacity of a
                // parsed hit-target is never baked into the PDF — mirrors the
                // shape `data.originalFill` pattern) AND for selection-reveal.
                originalOpacity: realImageOpacity,
                // Parsed images are transparent hit-targets revealed while
                // selected (like shapes); new images are already visible.
                isTransparentImageOverlay: isParsedImage,
              };
              canvas.add(img);
            })
            .catch((err) => {
              clientLogger.error(
                "[renderElements] Failed to load image element:",
                imgElement.elementId,
                err,
              );
            });
          imageLoadPromises.push(loadPromise);
        } else {
          // No usable image source (empty/missing dataUrl). Rather than dropping
          // the element SILENTLY — which loses the click/move/delete hit-target
          // and hides the data gap — render a VISIBLE dashed placeholder of the
          // element's bounds and warn. It still carries the engine index so the
          // in-place transform/remove pipeline keeps working on it.
          clientLogger.warn(
            "[renderElements] Image element has no dataUrl — placeholder shown:",
            imgElement.elementId,
          );
          const placeholder = new Rect({
            ...baseOptions,
            width: imgElement.bounds.width,
            height: imgElement.bounds.height,
            fill: "rgba(120, 120, 120, 0.08)",
            stroke: "#9ca3af",
            strokeWidth: 1,
            strokeDashArray: [4, 4],
            // Purely a visual stand-in for a broken image: NOT interactive, so
            // the save pipeline never serialises it (a Rect would otherwise be
            // mis-persisted as a `shape`, corrupting the image element).
            selectable: false,
            evented: false,
          });
          (placeholder as FabricObjectWithData).data = {
            elementId: imgElement.elementId,
            type: "image",
            index: imgElement.index,
            rotation0: imgElement.transform?.rotation ?? 0,
            // Flags this overlay as a stand-in for a source-less image so the
            // round-trip/apply side can tell it apart from a loaded image.
            isImagePlaceholder: true,
          };
          fabricObj = placeholder;
        }
        break;
      }

      case "shape": {
        const shapeElement = element;
        const hasStroke =
          shapeElement.style.strokeColor && shapeElement.style.strokeWidth > 0;
        const hasFill = !!shapeElement.style.fillColor;
        // RASTER-TRUTH shape model: the source PDF's shapes (section fills,
        // coloured banners, field backgrounds…) stay BAKED in the text-free
        // raster background (`renderPageNoText`, index 0), so what the user sees
        // is pixel-exact — including the PDF's own z-order subtleties (e.g. a
        // white input box inset over a coloured frame, anti-aliased borders).
        // This Fabric overlay is therefore a TRANSPARENT, editable hit-target:
        // it carries the real fill/stroke on `data.*`, is revealed on selection
        // (see `attachShapeStyleReveal`) and is the object the move/resize/
        // restyle pipeline edits. We do NOT repaint shapes here, because the
        // engine's `renderPageExcluding` honours shape exclusion only for some
        // vector paths, so painting a visible overlay over an inconsistently
        // excluded raster left whole coloured backgrounds blank.
        const fillCss = hasFill
          ? colorWithAlpha(
              shapeElement.style.fillColor as string,
              shapeElement.style.fillOpacity ?? 1,
            )
          : "transparent";
        const strokeCss = hasStroke
          ? colorWithAlpha(
              shapeElement.style.strokeColor as string,
              shapeElement.style.strokeOpacity ?? 1,
            )
          : "transparent";
        const shapeOptions = {
          ...baseOptions,
          // Transparent in view (the raster shows the real shape); data.* keeps
          // the real values so selection-reveal / the properties panel restore
          // them, and the strokeDashArray is carried for the reveal too.
          fill: "transparent",
          stroke: "transparent",
          strokeWidth: 0,
          ...(shapeElement.style.strokeDashArray &&
          shapeElement.style.strokeDashArray.length > 0
            ? { strokeDashArray: [...shapeElement.style.strokeDashArray] }
            : {}),
          opacity: 1,
          // Make the selected state obvious — same rationale as text overlays.
          hasControls: true,
          hasBorders: true,
          borderColor: "rgba(0, 100, 200, 0.75)",
          cornerColor: "rgb(0, 100, 200)",
          cornerStrokeColor: "#ffffff",
          cornerSize: 8,
          transparentCorners: false,
          // Pointeur grossier : poignées tactiles élargies ({} sur desktop).
          ...coarseControlProps(),
        };
        const w = shapeElement.bounds.width;
        const h = shapeElement.bounds.height;

        switch (shapeElement.shapeType) {
          case "rectangle":
            fabricObj = new Rect({
              ...shapeOptions,
              width: w,
              height: h,
              rx: shapeElement.geometry?.cornerRadius || 0,
              ry: shapeElement.geometry?.cornerRadius || 0,
            });
            break;
          case "circle":
            fabricObj = new Circle({ ...shapeOptions, radius: w / 2 });
            break;
          case "ellipse":
            fabricObj = new Ellipse({ ...shapeOptions, rx: w / 2, ry: h / 2 });
            break;
          case "line":
          case "arrow":
            fabricObj = new Line([0, 0, w, 0], shapeOptions);
            break;
          case "triangle":
            fabricObj = new Triangle({ ...shapeOptions, width: w, height: h });
            break;
          case "polygon": {
            // fabric.Polygon needs an explicit points array. We have it on
            // geometry.points (already in canvas coords).
            const pts = shapeElement.geometry?.points ?? [];
            if (pts.length >= 3) {
              fabricObj = new Polygon(pts, shapeOptions);
            } else {
              fabricObj = new Rect({ ...shapeOptions, width: w, height: h });
            }
            break;
          }
          case "path":
          default: {
            // Render via SVG pathData when available — required for any
            // shape with Bezier curves (logos, icons, complex outlines).
            // Falling back to Rect would render a meaningless filled box.
            const pathData = shapeElement.geometry?.pathData;
            if (pathData) {
              // Fabric.Path positions itself at the path's own bounding box
              // top-left, then offsets via left/top. Pass the bounds origin
              // explicitly so the path keeps its absolute canvas position.
              fabricObj = new FabricPath(pathData, {
                ...shapeOptions,
                left: shapeElement.bounds.x,
                top: shapeElement.bounds.y,
                originX: "left",
                originY: "top",
              });
            } else {
              fabricObj = new Rect({ ...shapeOptions, width: w, height: h });
            }
          }
        }
        if (fabricObj) {
          (fabricObj as FabricObjectWithData).data = {
            elementId: shapeElement.elementId,
            type: "shape",
            // Engine unified element index → lossless in-place
            // transformElement (move/resize) / removeElement (delete).
            index: shapeElement.index,
            rotation0: shapeElement.transform?.rotation ?? 0,
            originalFill: hasFill ? fillCss : null,
            originalStroke: hasStroke ? strokeCss : null,
            originalStrokeWidth: hasStroke ? shapeElement.style.strokeWidth : 0,
            // Carried so selection-reveal restores the dash pattern too.
            originalStrokeDashArray:
              shapeElement.style.strokeDashArray &&
              shapeElement.style.strokeDashArray.length > 0
                ? [...shapeElement.style.strokeDashArray]
                : null,
          };
        }
        break;
      }

      case "annotation": {
        const annoElement = element;
        const annoOptions = {
          ...baseOptions,
          opacity: annoElement.style?.opacity ?? 1,
        };
        const annoWidth = annoElement.bounds.width;
        const annoHeight = annoElement.bounds.height;
        const annoColor = annoElement.style?.color || "#ff0000";

        switch (annoElement.annotationType) {
          case "highlight":
            fabricObj = new Rect({
              ...annoOptions,
              width: annoWidth,
              height: annoHeight,
              fill: "rgba(255, 255, 0, 0.3)",
              stroke: "transparent",
            });
            break;
          case "underline":
            fabricObj = new Line([0, 0, annoWidth, 0], {
              ...annoOptions,
              stroke: annoColor,
              strokeWidth: 2,
            });
            break;
          case "strikethrough":
          case "strikeout":
            fabricObj = new Line([0, 0, annoWidth, 0], {
              ...annoOptions,
              stroke: annoColor,
              strokeWidth: 1,
            });
            break;
          case "squiggly":
            // Real wavy underline (a true zig-zag spanning the run width),
            // positioned at the annotation's top-left. Far closer to a PDF
            // "squiggly" markup than the previous dashed straight line.
            fabricObj = new FabricPath(squigglyPathData(annoWidth, 2), {
              ...annoOptions,
              left: annoElement.bounds.x,
              top: annoElement.bounds.y,
              originX: "left" as const,
              originY: "top" as const,
              fill: "transparent",
              stroke: annoColor,
              strokeWidth: annoElement.style?.strokeWidth ?? 1.5,
            });
            break;
          case "line":
          case "arrow": {
            // Explicit endpoints when present; otherwise the diagonal of
            // `bounds`. Coordinates are absolute (web/canvas).
            const lp = annoElement.linePoints;
            const x1 = lp?.x1 ?? annoElement.bounds.x;
            const y1 = lp?.y1 ?? annoElement.bounds.y;
            const x2 = lp?.x2 ?? annoElement.bounds.x + annoWidth;
            const y2 = lp?.y2 ?? annoElement.bounds.y + annoHeight;
            const lineWidth = annoElement.style?.strokeWidth ?? 2;
            if (annoElement.annotationType === "arrow") {
              // Shaft + filled triangular head as ONE Fabric.Path → a single
              // selectable hit-target that round-trips as one annotation (no
              // Group, no duplicate object). The head is closed (`Z`) so it
              // fills; the shaft is the open `M…L`.
              const headSize = Math.max(6, lineWidth * 4);
              const [tip, c1, c2] = arrowHeadPoints(x1, y1, x2, y2, headSize);
              const d =
                `M ${x1} ${y1} L ${x2} ${y2} ` +
                `M ${tip!.x} ${tip!.y} L ${c1!.x} ${c1!.y} ` +
                `L ${c2!.x} ${c2!.y} Z`;
              fabricObj = new FabricPath(d, {
                ...annoOptions,
                left: Math.min(x1, x2, c1!.x, c2!.x),
                top: Math.min(y1, y2, c1!.y, c2!.y),
                originX: "left" as const,
                originY: "top" as const,
                fill: annoColor,
                stroke: annoColor,
                strokeWidth: lineWidth,
              });
            } else {
              fabricObj = new Line([x1, y1, x2, y2], {
                ...annoOptions,
                left: 0,
                top: 0,
                originX: "left" as const,
                originY: "top" as const,
                stroke: annoColor,
                strokeWidth: lineWidth,
              });
            }
            break;
          }
          case "note":
          case "stamp":
            fabricObj = new Rect({
              ...annoOptions,
              width: Math.min(annoWidth, 30),
              height: Math.min(annoHeight, 30),
              fill: "#ffeb3b",
              stroke: "#ffc107",
              strokeWidth: 1,
            });
            break;
          case "freetext": {
            // Render the annotation TEXT itself (editable), not an opaque marker.
            // Empty content falls back to a faint placeholder box so the region
            // stays a visible, clickable hit-target.
            const ftText = annoElement.content ?? "";
            if (ftText.length > 0) {
              const ftSize = Math.max(
                8,
                Math.min(annoHeight > 0 ? annoHeight * 0.7 : 14, 16),
              );
              fabricObj = new IText(ftText, {
                ...annoOptions,
                left: annoElement.bounds.x + 1,
                top: annoElement.bounds.y + 1,
                originX: "left" as const,
                originY: "top" as const,
                width: annoWidth,
                fontSize: ftSize,
                fontFamily: "Helvetica",
                fill: annoColor,
                editable: true,
              }) as unknown as FabricObject;
            } else {
              fabricObj = new Rect({
                ...annoOptions,
                width: annoWidth,
                height: annoHeight,
                fill: "rgba(33, 150, 243, 0.08)",
                stroke: "#1976d2",
                strokeWidth: 1,
                strokeDashArray: [3, 3],
              });
            }
            break;
          }
          case "comment":
            // Sticky-note marker (a small dot the user clicks to read/edit).
            fabricObj = new Circle({
              ...annoOptions,
              radius: Math.min(annoWidth, annoHeight) / 2,
              fill: "#2196f3",
              stroke: "#1976d2",
              strokeWidth: 1,
            });
            break;
          case "link":
            fabricObj = new Rect({
              ...annoOptions,
              width: annoWidth,
              height: annoHeight,
              fill: "rgba(0, 100, 200, 0.1)",
              stroke: "#0066cc",
              strokeWidth: 1,
            });
            break;
          default: {
            // Unknown annotation subtype: show a neutral highlight box AND warn
            // (never a silent drop), so the gap is visible in the console.
            clientLogger.warn(
              "[renderElements] Unhandled annotation subtype — generic box shown:",
              annoElement.annotationType,
              annoElement.elementId,
            );
            fabricObj = new Rect({
              ...annoOptions,
              width: annoWidth,
              height: annoHeight,
              fill: "rgba(255, 255, 0, 0.3)",
            });
          }
        }
        if (fabricObj) {
          (fabricObj as FabricObjectWithData).data = {
            elementId: annoElement.elementId,
            type: "annotation",
            annotationType: annoElement.annotationType,
            linkDestination: annoElement.linkDestination,
          };
        }
        break;
      }

      case "form_field": {
        const formElement = element;
        // EDITABLE form fields (user directive: "fields should be editable, not
        // rendered as an image"). The page raster (`renderPageNoText`) keeps the
        // PDF's own field frames/borders as the visual ground truth, but the
        // VALUE lives here in an interactive overlay so the user can fill it in:
        //   - text / dropdown → an editable IText bound to the field value
        //     (placeholder shown when empty). Typing persists via the normal
        //     text-edit flow (text:editing:exited → fabricObjectToElement, which
        //     re-reads the value from this object).
        //   - checkbox / radio → an IText carrying a check/dot mark, toggled on
        //     click by `attachFormFieldToggle`; the checked state is stashed on
        //     data.fieldChecked and round-tripped into the field value.
        //   - listbox / signature / button → a hit-target Rect (filled/selected
        //     elsewhere, not via keyboard on the canvas).
        // In every case data.formFieldElement is the canonical full element so
        // the round-trip never loses the field identity (fieldType/options/…).
        const fieldFill = fieldOverlayFill(formElement.fieldType);
        const fieldStroke = fieldOverlayStroke(formElement.fieldType);
        const isTextEntry =
          formElement.fieldType === "text" ||
          formElement.fieldType === "dropdown";
        const isCheckable =
          formElement.fieldType === "checkbox" ||
          formElement.fieldType === "radio";

        // Full-rect FIELD BACKGROUND + HIT-TARGET (Adobe UX). An empty text
        // field used to be an IText whose width Fabric recomputes from its
        // CONTENT (initDimensions), so a blank field's clickable surface was
        // ~0 px. This Rect always covers the whole widget rect: the field is
        // VISIBLE (tint + border) and clickable anywhere inside. It sits
        // BEHIND the value object (stable-sort tie on [layerRank, engine
        // order] — added first) and DELEGATES its clicks to the content
        // object (attachFormFieldToggle): caret for text entry, toggle for
        // checkables. Its `elementId` is `hit:`-prefixed so every element
        // lookup (`data.elementId === id`) resolves the REAL field object,
        // never this chrome; `hitForElementId` carries the target.
        const wantsHitRect =
          isTextEntry || isCheckable || formElement.fieldType === "listbox";
        if (wantsHitRect) {
          const hitRect = new Rect({
            left: formElement.bounds.x,
            top: formElement.bounds.y,
            originX: "left" as const,
            originY: "top" as const,
            width: formElement.bounds.width,
            height: formElement.bounds.height,
            fill: fieldFill,
            stroke: fieldStroke,
            strokeWidth: 1,
            selectable: false,
            evented: !element.locked && !readonly,
            visible: formElement.visible,
            hoverCursor: isTextEntry ? "text" : "pointer",
          });
          (hitRect as FabricObjectWithData).data = {
            elementId: `hit:${formElement.elementId}`,
            type: "form_field",
            isFieldHitTarget: true,
            hitForElementId: formElement.elementId,
            fieldName: formElement.fieldName,
            fieldType: formElement.fieldType,
          };
          // Tactile : plancher du HIT à ~24 px écran (pointeur grossier
          // uniquement — no-op sur desktop). Le rect VISUEL ne change pas,
          // seul containsPoint (target finding Fabric) est élargi, en suivant
          // le zoom live.
          installFormFieldHitFloor(
            hitRect as unknown as HitFloorTarget,
            () => canvas.getZoom() || 1,
          );
          canvas.add(hitRect as unknown as FabricObject);
        }

        if (isTextEntry) {
          // A COMB (PEIGNE) field lays its value out one char per equally-spaced
          // cell across `maxLength` cells (CERFA SSN/date boxes). Reproduce the
          // original cell spacing: monospace face + charSpacing so each glyph is
          // centred in its cell, and never more chars than there are cells.
          const combMaxLen = formElement.properties?.maxLength ?? 0;
          const isComb =
            (formElement.properties?.comb ?? false) && combMaxLen > 0;
          // Empty fields show the AcroForm placeholder if one exists, otherwise
          // BLANK — never the internal field NAME ("NOM PAR 2", "SS PAR 2"…),
          // which is identity metadata, not a user-facing value. The name stays
          // available on data.fieldName (round-trip) and in the side panel label.
          const placeholder = formElement.placeholder ?? "";
          const rawValue = formFieldTextValue(formElement.value);
          const currentValue = isComb
            ? clampCombValue(rawValue, combMaxLen)
            : rawValue;
          const showPlaceholder = currentValue.length === 0;
          // Comb geometry (monospace, equal cells); only used when isComb.
          const combLayout = isComb
            ? computeCombLayout(
                formElement.bounds.width,
                formElement.bounds.height,
                combMaxLen,
                formElement.style?.daSize ?? formElement.style?.fontSize ?? 0,
              )
            : null;
          // Field font size: honour the AcroForm `/DA` size verbatim; `0` is
          // AUTO-SIZE — with a value, target a size that fits BOTH the box
          // height (70%) and the box width (Helvetica-like ≈ 0.5 em per char),
          // matching the engine's `0 Tf` shrink-to-fit appearances; an empty
          // field keeps the height-only heuristic for the caret/placeholder.
          // Comb fields size to the cell so a glyph never bleeds into the next.
          const styleFontSize = formElement.style?.fontSize ?? 0;
          const autoFitFontSize = (() => {
            const heightFit = Math.max(
              8,
              Math.min(formElement.bounds.height * 0.7, 16),
            );
            if (currentValue.length === 0) return heightFit;
            const widthFit =
              (formElement.bounds.width - 4) / (0.5 * currentValue.length);
            return Math.max(
              4,
              Math.min(formElement.bounds.height * 0.7, widthFit),
            );
          })();
          const fieldFontSize = combLayout
            ? combLayout.fontSize
            : styleFontSize > 0
              ? styleFontSize
              : autoFitFontSize;
          const textColour = formElement.style?.textColor || "#0a3a8a";
          // `/Q` quadding: a single-line IText is CONTENT-sized, so honouring
          // centre/right needs the ANCHOR (Fabric originX) at the box's
          // centre/right edge — a left-anchored IText can never render centred
          // in the widget. Comb fields stay left-anchored (per-cell layout).
          const fieldAlign = combLayout
            ? "left"
            : formElement.style?.textAlign || "left";
          const anchorOriginX: "left" | "center" | "right" =
            combLayout || fieldAlign === "left"
              ? "left"
              : fieldAlign === "center"
                ? "center"
                : "right";
          const anchorLeft =
            anchorOriginX === "left"
              ? formElement.bounds.x + (combLayout ? combLayout.leftInset : 2)
              : anchorOriginX === "center"
                ? formElement.bounds.x + formElement.bounds.width / 2
                : formElement.bounds.x + formElement.bounds.width - 2;
          const anchorTop =
            formElement.bounds.y +
            Math.max(0, (formElement.bounds.height - fieldFontSize) / 2);
          const isMultiline =
            !combLayout && (formElement.properties?.multiline ?? false);

          const fieldTextOptions = {
            ...baseOptions,
            // The full-rect hit Rect behind carries the tint; a second
            // background here would double it under the glyphs.
            left: anchorLeft,
            top: anchorTop,
            originX: anchorOriginX,
            fontSize: fieldFontSize,
            fontFamily: combLayout
              ? combLayout.fontFamily
              : formElement.style?.fontFamily || "Helvetica",
            fill: showPlaceholder ? "rgba(0,0,0,0.4)" : textColour,
            textAlign: fieldAlign,
            // Per-cell spacing for comb fields (1/1000 em); 0 otherwise.
            charSpacing: combLayout ? combLayout.charSpacing : 0,
            hasControls: false,
            hasBorders: true,
            borderColor: fieldStroke,
            borderScaleFactor: 1,
            editable: true,
          };

          let fieldText: FabricObject;
          if (isMultiline) {
            // MULTILINE (`/Ff` bit 13): a Textbox WRAPS at the widget width
            // (an IText would run past the right edge on one line) and a clip
            // to the widget rect keeps overflowing lines from painting outside
            // the field (Adobe behaviour — the extra text stays in the model).
            fieldText = new Textbox(showPlaceholder ? placeholder : currentValue, {
              ...fieldTextOptions,
              left: formElement.bounds.x + 2,
              top: formElement.bounds.y + 1,
              originX: "left" as const,
              width: Math.max(8, formElement.bounds.width - 4),
              splitByGrapheme: false,
              clipPath: new Rect({
                left: formElement.bounds.x,
                top: formElement.bounds.y,
                originX: "left" as const,
                originY: "top" as const,
                width: formElement.bounds.width,
                height: formElement.bounds.height,
                absolutePositioned: true,
              }) as unknown as FabricObject,
            }) as unknown as FabricObject;
          } else {
            fieldText = new IText(showPlaceholder ? placeholder : currentValue, {
              ...fieldTextOptions,
              width: formElement.bounds.width,
            }) as unknown as FabricObject;
          }
          (fieldText as FabricObjectWithData).data = {
            elementId: formElement.elementId,
            type: "form_field",
            fieldName: formElement.fieldName,
            fieldType: formElement.fieldType,
            fieldPlaceholder: placeholder,
            fieldShowingPlaceholder: showPlaceholder,
            // WIDGET-RECT stash: the IText's live bbox is content-sized, NOT
            // the widget rect. The save path re-derives the persisted bounds
            // from THIS rect + the drag delta vs `fieldAnchor0`, so an
            // untouched field round-trips its rect exactly (→ the bake sees
            // "geometry unchanged" and routes the value to the real fill).
            fieldWidgetBounds: { ...formElement.bounds },
            fieldAnchor0: {
              left: isMultiline ? formElement.bounds.x + 2 : anchorLeft,
              top: isMultiline ? formElement.bounds.y + 1 : anchorTop,
            },
            // Base size for the live auto-shrink on overflow (editor-canvas
            // grows back toward this size as characters are deleted).
            fieldBaseFontSize: fieldFontSize,
            // Canonical full element → fabricObjectToElement re-merges live
            // bounds + the typed value without losing any business prop.
            formFieldElement: formElement,
          };
          fabricObj = fieldText;
        } else if (isCheckable) {
          const checked = formFieldChecked(formElement);
          const mark =
            formElement.fieldType === "checkbox"
              ? checked
                ? "☑" // ☑
                : "☐" // ☐
              : checked
                ? "◉" // ◉
                : "○"; // ○
          const markSize = Math.max(
            8,
            Math.min(formElement.bounds.width, formElement.bounds.height) * 0.9,
          );
          const markText = new IText(mark, {
            ...baseOptions,
            left: formElement.bounds.x,
            top: formElement.bounds.y,
            fontSize: markSize,
            fontFamily: "Helvetica",
            fill: checked ? "#0a7a0a" : "#444444",
            // The full-rect hit Rect behind carries the field tint.
            // The mark is toggled by click, never edited as text.
            editable: false,
            hasControls: false,
            hasBorders: true,
            borderColor: fieldStroke,
          });
          // This widget's on-state: `onValue` when the extractor stamped one
          // (radio buttons AND multi-widget named checkboxes — Oui/non CERFA
          // pairs); legacy radio fallback = the field value / first option.
          const widgetOnValue =
            typeof formElement.onValue === "string" &&
            formElement.onValue.length > 0
              ? formElement.onValue
              : formElement.fieldType === "radio"
                ? formFieldTextValue(
                    formElement.value || formElement.options?.[0] || "",
                  )
                : "";
          (markText as FabricObjectWithData).data = {
            elementId: formElement.elementId,
            type: "form_field",
            fieldName: formElement.fieldName,
            fieldType: formElement.fieldType,
            fieldChecked: checked,
            fieldExportValue:
              formElement.fieldType === "radio" ? widgetOnValue : "",
            // Named on-state of THIS widget (group exclusivity + serialisation
            // of named checkbox states via readFormFieldValue). Null when the
            // checkbox is a plain boolean one.
            fieldOnValue: widgetOnValue.length > 0 ? widgetOnValue : null,
            fieldWidgetBounds: { ...formElement.bounds },
            fieldAnchor0: {
              left: formElement.bounds.x,
              top: formElement.bounds.y,
            },
            formFieldElement: formElement,
          };
          fabricObj = markText as unknown as FabricObject;
        } else if (formElement.fieldType === "listbox") {
          // Listbox: show the available options (one per line) with the SELECTED
          // value(s) marked "▸ …", inside the field box. The value is preserved
          // on save by readFormFieldValue (listbox values are not re-read from
          // the IText, so this is display-only and lossless).
          const selected = new Set<string>(
            Array.isArray(formElement.value)
              ? formElement.value
              : typeof formElement.value === "string" && formElement.value
                ? [formElement.value]
                : [],
          );
          const options = formElement.options ?? [];
          // No options → BLANK, never the internal field name (identity metadata,
          // not a user-facing value). fieldName stays on data.fieldName.
          const listText =
            options.length > 0
              ? options
                  .map((opt) => (selected.has(opt) ? `▸ ${opt}` : `  ${opt}`))
                  .join("\n")
              : "";
          const styleFontSize = formElement.style?.fontSize ?? 0;
          const lbFontSize =
            styleFontSize > 0 ? styleFontSize : Math.max(8, Math.min(11, 14));
          const lbText = new IText(listText, {
            ...baseOptions,
            left: formElement.bounds.x + 2,
            top: formElement.bounds.y + 1,
            width: formElement.bounds.width,
            fontSize: lbFontSize,
            fontFamily: formElement.style?.fontFamily || "Helvetica",
            fill: formElement.style?.textColor || "#0a3a8a",
            // The full-rect hit Rect behind carries the field tint.
            textAlign: "left",
            // The selection is changed via the field UI, not by typing on canvas.
            editable: false,
            hasControls: false,
            hasBorders: true,
            borderColor: fieldStroke,
          });
          (lbText as FabricObjectWithData).data = {
            elementId: formElement.elementId,
            type: "form_field",
            fieldName: formElement.fieldName,
            fieldType: formElement.fieldType,
            fieldWidgetBounds: { ...formElement.bounds },
            fieldAnchor0: {
              left: formElement.bounds.x + 2,
              top: formElement.bounds.y + 1,
            },
            formFieldElement: formElement,
          };
          fabricObj = lbText as unknown as FabricObject;
        } else if (formElement.fieldType === "button") {
          // Push button: render its label (value, else fieldName) centred on a
          // filled box so it reads as a real button, not an empty zone.
          const label =
            formFieldTextValue(formElement.value) || formElement.fieldName || "";
          const styleFontSize = formElement.style?.fontSize ?? 0;
          const btnFontSize =
            styleFontSize > 0
              ? styleFontSize
              : Math.max(8, Math.min(formElement.bounds.height * 0.5, 14));
          const btnText = new IText(label, {
            ...baseOptions,
            originX: "center" as const,
            originY: "center" as const,
            left: formElement.bounds.x + formElement.bounds.width / 2,
            top: formElement.bounds.y + formElement.bounds.height / 2,
            fontSize: btnFontSize,
            fontFamily: formElement.style?.fontFamily || "Helvetica",
            fill: formElement.style?.textColor || "#333333",
            backgroundColor: fieldFill,
            textAlign: "center",
            editable: false,
            hasControls: false,
            hasBorders: true,
            borderColor: fieldStroke,
          });
          (btnText as FabricObjectWithData).data = {
            elementId: formElement.elementId,
            type: "form_field",
            fieldName: formElement.fieldName,
            fieldType: formElement.fieldType,
            fieldWidgetBounds: { ...formElement.bounds },
            fieldAnchor0: {
              left: formElement.bounds.x + formElement.bounds.width / 2,
              top: formElement.bounds.y + formElement.bounds.height / 2,
            },
            formFieldElement: formElement,
          };
          fabricObj = btnText as unknown as FabricObject;
        } else {
          // signature (and any unknown field type) — a selectable hit-target
          // Rect. A signature is a drawn/image artefact, not text, so its
          // "value" is not representable as a canvas label; the dashed zone marks
          // where to sign and stays editable/movable.
          fabricObj = new Rect({
            ...baseOptions,
            width: formElement.bounds.width,
            height: formElement.bounds.height,
            fill: fieldFill,
            stroke: fieldStroke,
            strokeDashArray: [4, 4],
            strokeWidth: 1,
          });
          (fabricObj as FabricObjectWithData).data = {
            elementId: formElement.elementId,
            type: "form_field",
            fieldName: formElement.fieldName,
            fieldType: formElement.fieldType,
            // Élément complet : fabricObjectToElement le re-fusionne avec
            // les bounds réels → aucune propriété métier perdue au move.
            formFieldElement: formElement,
          };
        }
        break;
      }

      default: {
        // Exhaustiveness guard. `Element` is a closed union of the five cases
        // above, so this is unreachable at compile time (`never`). It exists for
        // RUNTIME safety: the scene graph is produced by the backend (Pydantic)
        // and a future element kind (e.g. a dedicated ink/draw type — ink
        // strokes currently arrive as `shape` with `shapeType: "path"`/
        // `"polygon"` and ARE rendered by the shape case) would otherwise be
        // dropped SILENTLY. Warn instead so the gap is visible, never a no-op.
        const _exhaustive: never = element;
        clientLogger.warn(
          "[renderElements] Unrendered element type (no case) — dropped:",
          (_exhaustive as { type?: string }).type,
          (_exhaustive as { elementId?: string }).elementId,
        );
        break;
      }
    }

    if (fabricObj) {
      // Mémoriser l'état de verrou sur l'objet Fabric (DRY, point unique) :
      // setElementVisibility en a besoin pour ne PAS ré-activer un élément
      // verrouillé quand on le réaffiche, et le re-render le rétablit ici.
      (fabricObj as FabricObjectWithData).data = {
        ...(fabricObj as FabricObjectWithData).data,
        locked: element.locked === true,
      };
      canvas.add(fabricObj);
    }
  }

  // 4. TAG PARAGRAPH GROUPS (EDIT-INTENT model). At rest every run was rendered
  //    per-run/per-segment above — the proven pixel-1:1 path, UNCHANGED. EVERY
  //    group's member objects (including the per-segment fragments of a
  //    justified run) are tagged with the group id + the shared descriptor so
  //    a single click can select the whole block (attachParagraphBlockSelection)
  //    — the coherence gate only decides `paragraphSessionable`: whether a
  //    double-click on a member swaps the group for ONE multi-line Textbox
  //    edit session (beginParagraphEditSession) with wrap/reflow (an
  //    unmodified exit restores the per-run objects untouched, zero write), or
  //    keeps the per-run inline edit (rejected group — a single Textbox would
  //    drift). Skipped in read-only surfaces (no edit intent there).
  if (!readonly && allCoalescedGroups.length > 0) {
    const objects = canvas.getObjects();
    for (const group of allCoalescedGroups) {
      const lines = linesOfGroup(group);
      // Session eligibility (NOT identity): lines strictly descending, gaps
      // within [0.4, 2.5]× the measured leading, ≥ 20% horizontal overlap of
      // consecutive lines — see isCoherentLineGroup.
      const sessionable = isCoherentLineGroup(lines);
      const first = group.runs[0]!;
      const descriptor: RegisteredParagraphGroup = {
        groupId: `pg:${first.elementId}`,
        lines,
        ...(group.align ? { align: group.align } : {}),
        ...(group.lineHeightMultiple
          ? { lineHeightMultiple: group.lineHeightMultiple }
          : {}),
        ...(group.frame ? { frame: group.frame } : {}),
      };
      const memberIds = new Set(group.runs.map((r) => r.elementId));
      for (const obj of objects) {
        const data = (obj as FabricObjectWithData).data;
        if (!data?.elementId || data.type !== "text") continue;
        if (!memberIds.has(data.elementId)) continue;
        data.paragraphGroupId = descriptor.groupId;
        data.paragraphGroup = descriptor;
        data.paragraphSessionable = sessionable;
        if (sessionable) {
          // Light affordance: an editable-paragraph member invites a text
          // cursor. Non-sessionable members keep the default cursor (their
          // double-click stays the plain per-run inline edit).
          (obj as FabricObject & { hoverCursor?: string }).hoverCursor = "text";
        }
      }
    }
  }

  // Wait for all async image loads before final render
  if (imageLoadPromises.length > 0) {
    await Promise.all(imageLoadPromises);
  }

  // RE-ASSERT Z-ORDER after the async image loads. Image overlays are added in
  // their `.then` (promise-resolution order), so they land on TOP of the z-stack
  // regardless of `layerRank` — a full-page parsed background image would then
  // sit ABOVE the text and steal its clicks. Re-apply the SAME layerRank order
  // to every non-background object (the PDF background stays at index 0), with
  // ties broken by the ENGINE PAINT ORDER (the raw `elements` order) so
  // image-vs-image stacking is deterministic and independent of which image
  // promise resolved first. Safe in the single-element re-render path too — it
  // simply re-asserts the same total order. Hide masks are placed afterwards
  // (just above the background), so they are unaffected.
  const engineOrderByElementId = new Map<string, number>();
  elements.forEach((el, i) => {
    if (!engineOrderByElementId.has(el.elementId)) {
      engineOrderByElementId.set(el.elementId, i);
    }
  });
  const allObjects = canvas.getObjects();
  const bgIndex = allObjects.findIndex(
    (o) => (o as FabricObjectWithData).data?.isPdfBackground === true,
  );
  const reorderable = allObjects.filter(
    (o) => (o as FabricObjectWithData).data?.isPdfBackground !== true,
  );
  const moveObjectTo = (
    canvas as unknown as {
      moveObjectTo?: (o: FabricObject, i: number) => void;
    }
  ).moveObjectTo;
  if (reorderable.length > 1 && typeof moveObjectTo === "function") {
    const orderKey = (o: FabricObject): [number, number] => {
      const data = (o as FabricObjectWithData).data;
      const rank = layerRank[(data?.type as string) ?? ""] ?? 99;
      // A form-field HIT-TARGET orders by its TARGET element (its own id is
      // `hit:`-prefixed and unknown to the engine order); the sort is stable,
      // so the tie keeps the hit Rect BEHIND its value object (added first).
      const id = (data?.hitForElementId as string | undefined) ?? data?.elementId;
      const engineOrder =
        typeof id === "string"
          ? (engineOrderByElementId.get(id) ?? Number.MAX_SAFE_INTEGER)
          : Number.MAX_SAFE_INTEGER;
      return [rank, engineOrder];
    };
    const ordered = [...reorderable].sort((a, b) => {
      const ka = orderKey(a);
      const kb = orderKey(b);
      return ka[0] - kb[0] || ka[1] - kb[1];
    });
    const baseIndex = bgIndex >= 0 ? bgIndex + 1 : 0;
    ordered.forEach((o, i) => moveObjectTo.call(canvas, o, baseIndex + i));
  }

  canvas.renderAll();

  // Repose les masques de visibilité pour les éléments cachés (navigation de
  // page / re-render). Fait APRÈS renderAll() pour que sampleBackgroundUnder
  // lise le raster du fond déjà peint. Les overlays cachés sont aussi rendus
  // non-evented (cohérent avec setElementVisibility : pas d'édition au
  // double-clic sur un élément masqué). Sans applyHideMask injecté (continu),
  // on saute simplement le masquage du fond.
  if (applyHideMask) {
    const hidden = sortedElements.filter((el) => el.visible === false);
    if (hidden.length > 0) {
      for (const el of hidden) {
        const obj = canvas
          .getObjects()
          .find(
            (o) =>
              (o as FabricObjectWithData).data?.elementId === el.elementId &&
              (o as FabricObjectWithData).data?.isHideMask !== true,
          ) as FabricObjectWithData | undefined;
        if (!obj) continue;
        await applyHideMask(canvas, obj);
        (
          obj as FabricObject & { set: (o: Record<string, unknown>) => void }
        ).set({ evented: false, selectable: false });
      }
      canvas.requestRenderAll();
    }
  }

  // Attacher les handlers de sélection si callback fourni et mode non-readonly.
  if (onElementSelected && !readonly) {
    attachSelectionHandlers(canvas, onElementSelected);
  }

  // Reveal a shape's real fill/stroke while it is selected (and re-mask it on
  // deselect). In view the shape is shown by the raster (transparent overlay);
  // on selection we paint the overlay with its `data.original*` so what the user
  // edits is visible. Idempotent per canvas; skipped in read-only surfaces.
  if (!readonly) {
    attachShapeStyleReveal(canvas);
    // Toggle checkbox/radio fields on click (fill them in directly on the page).
    attachFormFieldToggle(canvas, onElementSelected);
    // Paragraph blocks: a single click selects the WHOLE block (re-click drills
    // down to the run, Alt+click targets the run directly) + a light outline is
    // drawn around the block while a member is hovered. Both are idempotent per
    // canvas and read the live tool/Fill&Sign flags stamped by the surface.
    attachParagraphBlockSelection(canvas, fabricModule);
    attachParagraphHoverAffordance(canvas, fabricModule);
  }
}

/**
 * Supprime du canvas tous les objets correspondant à des éléments parsés
 * (identifiés par `data.elementId`). Préserve les objets de fond PDF
 * (`data.isPdfBackground === true`).
 *
 * @returns Nombre d'objets supprimés
 */
export function clearElementsOverlay(canvas: FabricCanvas): number {
  const toRemove = canvas.getObjects().filter((obj) => {
    const data = (obj as FabricObjectWithData).data;
    return data?.elementId !== undefined && !data?.isPdfBackground;
  });

  for (const obj of toRemove) {
    canvas.remove(obj);
  }

  canvas.requestRenderAll();
  return toRemove.length;
}

// ---------------------------------------------------------------------------
// Paragraph EDIT SESSION (edit-intent, Adobe-like)
//
// At rest a paragraph group's runs are ordinary per-run/per-segment objects
// tagged with `data.paragraphGroupId` (+ the shared `data.paragraphGroup`
// descriptor). Double-clicking a member calls beginParagraphEditSession: the
// member objects are lifted OFF the canvas (kept intact, with their z indices)
// and replaced by ONE multi-line Textbox — frame-positioned, line texts joined
// by "\n", per-character styles carried PER RUN (family/size/colour/weight),
// the lib's alignment (justify supported) and the measured line advance — that
// enters editing immediately. Exiting without a modification restores the
// EXACT same objects (zero write); a modification flows through the standard
// commit path (see fabric-element-io.ts commitParagraphSession).
// ---------------------------------------------------------------------------

/**
 * Join the contents of one visual line's runs. Runs on a line are separate
 * content-stream runs usually split at word boundaries; a single space is
 * injected between two pieces only when NEITHER side already carries the
 * whitespace, so "Nom :" + "DUPONT" reads "Nom : DUPONT" while "foo " + "bar"
 * stays "foo bar". Pure & deterministic (the commit path compares the edited
 * lines against these exact strings, stashed as `data.sessionLineTexts`).
 */
export function joinLineRunContents(line: readonly TextRun[]): string {
  let out = "";
  for (const run of line) {
    const piece = run.content || "";
    if (piece.length === 0) continue;
    if (out.length > 0 && !/\s$/.test(out) && !/^\s/.test(piece)) out += " ";
    out += piece;
  }
  return out;
}

/**
 * One stashed source run of a paragraph edit session (`data.lineRuns[i][j]`).
 * Plain JSON. `style` snapshots the run's FULL parsed style so the commit can
 * emit erase/move elements that keep the run's own typography — the apply
 * pipeline routes them through the lossless `replaceText`/`moveElement` (a
 * style mismatch would silently downgrade to the destructive redact+add).
 */
export interface SessionLineRun {
  elementId: string;
  index?: number;
  bounds: { x: number; y: number; width: number; height: number };
  content: string;
  style: TextRun["style"];
}

/** Non-serialisable restore info (Fabric object refs), keyed by session box. */
interface ParagraphSessionRestoreInfo {
  members: Array<{ obj: FabricObject; index: number }>;
}
const paragraphSessionRestore = new WeakMap<
  FabricObject,
  ParagraphSessionRestoreInfo
>();

/**
 * Swap a paragraph group's per-run objects for ONE multi-line edit-session
 * Textbox and enter editing. `memberObj` is the double-clicked member (any of
 * the group's objects). Returns the session Textbox, or `null` when the object
 * carries no group descriptor / no member is on the canvas. The caller is
 * responsible for suppressing its own object:added/removed forwarding around
 * this call (the swap is presentation-only — no scene-graph change).
 */
export function beginParagraphEditSession(
  canvas: FabricCanvas,
  fabricModule: FabricModule,
  memberObj: FabricObjectWithData,
  options: {
    getFontFaceName?: RenderElementsOptions["getFontFaceName"];
  } = {},
): FabricObject | null {
  const descriptor = memberObj.data?.paragraphGroup as
    | RegisteredParagraphGroup
    | undefined;
  const groupId = memberObj.data?.paragraphGroupId as string | undefined;
  if (!descriptor || !groupId || descriptor.groupId !== groupId) return null;
  // Block identity ≠ session eligibility: every group's members are tagged (so
  // click-selection can target the block), but only a group the per-line
  // coherence gate ACCEPTED may open the Textbox session — a rejected group
  // (footer↔header fusion on a dense form) would drift inside a single box.
  if (memberObj.data?.paragraphSessionable !== true) return null;
  const lines = descriptor.lines.filter((l) => l.length > 0);
  if (lines.length === 0) return null;
  const { Textbox } = fabricModule;
  const { getFontFaceName } = options;

  // Collect the group's live member objects (per-run ITexts AND the per-segment
  // fragments of a justified run) with their z indices, then lift them off.
  const members: Array<{ obj: FabricObject; index: number }> = [];
  canvas.getObjects().forEach((obj, index) => {
    const data = (obj as FabricObjectWithData).data;
    if (data?.paragraphGroupId === groupId && data?.isParagraphSession !== true) {
      members.push({ obj, index });
    }
  });
  if (members.length === 0) return null;

  const allRuns = lines.flat();
  const first = lines[0]![0]!;
  const baseFontSize = first.style.fontSize ?? 12;
  const textColour = first.style.color || "#000000";

  // Line texts + full content (the session baseline the commit compares against).
  const lineTexts = lines.map(joinLineRunContents);
  const content = lineTexts.join("\n");

  // Base typography = first run (same resolution as the per-run branch).
  const baseFont = resolveTextFont(first.style, getFontFaceName, content);

  // Geometry: the lib block frame positions/sizes the session box (its width is
  // the paragraph's LAYOUT width → wrap/reflow happens at the right measure);
  // fallback = union of the runs' bounds when the producer had no frame.
  const unionLeft = Math.min(...allRuns.map((r) => r.bounds.x));
  const unionTop = Math.min(...allRuns.map((r) => r.bounds.y));
  const unionRight = Math.max(
    ...allRuns.map((r) => r.bounds.x + r.bounds.width),
  );
  const frame = descriptor.frame;
  const left = frame ? frame.x : unionLeft;
  const top = frame ? frame.y : unionTop;
  const width = Math.max(1, frame ? frame.width : unionRight - unionLeft);

  // Line advance: measured from the LINE tops (median gap / base font size),
  // falling back to the lib's line-height multiple, then Word's 1.2.
  const lineTops = lines
    .map((l) => Math.min(...l.map((r) => r.bounds.y)))
    .sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < lineTops.length; i += 1) {
    const gap = lineTops[i]! - lineTops[i - 1]!;
    if (gap > 0.5) gaps.push(gap);
  }
  let lineHeight = descriptor.lineHeightMultiple ?? 1.2;
  if (gaps.length > 0 && baseFontSize > 0) {
    gaps.sort((a, b) => a - b);
    const median = gaps[Math.floor((gaps.length - 1) / 2)]!;
    lineHeight = Math.min(3, Math.max(0.8, median / baseFontSize));
  }

  // Per-character styles PER RUN (family/size/colour/weight/style resolved for
  // EACH run via the same identity-aware cascade as the resting render — never
  // the first run's style for everything). The injected join spaces inherit the
  // Textbox base style (no entry).
  const styles: Record<number, Record<number, Record<string, unknown>>> = {};
  lines.forEach((line, li) => {
    let ci = 0;
    let lineOut = "";
    for (const run of line) {
      const piece = run.content || "";
      if (piece.length === 0) continue;
      if (lineOut.length > 0 && !/\s$/.test(lineOut) && !/^\s/.test(piece)) {
        lineOut += " ";
        ci += 1;
      }
      const resolved = resolveTextFont(run.style, getFontFaceName, piece);
      const charStyle: Record<string, unknown> = {
        fontFamily: resolved.fontFamily,
        fontWeight: resolved.fontWeight,
        fontStyle: resolved.fontStyle,
        fontSize: run.style.fontSize ?? baseFontSize,
        fill: run.style.color || textColour,
        underline: run.style.underline || false,
        linethrough: run.style.strikethrough || false,
      };
      for (let k = 0; k < piece.length; k += 1) {
        (styles[li] ??= {})[ci + k] = { ...charStyle };
      }
      ci += piece.length;
      lineOut += piece;
    }
  });

  // Lift the members off the canvas (kept intact for the zero-write restore).
  for (const m of members) canvas.remove(m.obj);

  const tb = new Textbox(content, {
    left,
    top,
    originX: "left" as const,
    originY: "top" as const,
    width,
    angle: first.transform?.rotation || 0,
    selectable: true,
    evented: true,
    visible: true,
    fontSize: baseFontSize,
    fontFamily: baseFont.fontFamily,
    fontWeight: baseFont.fontWeight,
    fontStyle: baseFont.fontStyle,
    fill: textColour,
    opacity: first.style.opacity ?? 1,
    // The lib's paragraph alignment — Fabric's Textbox supports "justify".
    textAlign: descriptor.align ?? first.style.textAlign ?? "left",
    lineHeight,
    charSpacing: (first.style.letterSpacing || 0) * 10,
    underline: first.style.underline || false,
    linethrough: first.style.strikethrough || false,
    textBackgroundColor: "",
    cursorColor: textColour,
    cursorWidth: 1,
    selectionColor: "rgba(0, 100, 200, 0.18)",
    hasControls: true,
    hasBorders: true,
    borderColor: "rgba(0, 100, 200, 0.75)",
    borderScaleFactor: 1,
    cornerColor: "rgb(0, 100, 200)",
    cornerStrokeColor: "#ffffff",
    cornerSize: 8,
    transparentCorners: false,
    // Pointeur grossier : poignées tactiles élargies ({} sur desktop).
    ...coarseControlProps(),
  });
  if (Object.keys(styles).length > 0) {
    (tb as unknown as { set: (k: string, v: unknown) => void }).set(
      "styles",
      styles,
    );
  }

  // Anti-wrap at session open: the browser session font often measures wider
  // than the PDF glyphs, so a source line can spill past the frame width and
  // Fabric re-wraps it into TWO visual lines the moment the box opens. The
  // user sees the paragraph "reorganise" (formatting lost during editing) and
  // — worse — the first keystroke would commit as a destructive REFLOW
  // (visual lines ≠ logical lines → every source run removed and re-added at
  // a uniform dominant style) even though nothing was restructured. Widen the
  // box just enough (bounded) so visual === logical at open; wrapping only
  // kicks in for text the user actually types past that measure.
  {
    const tbx = tb as unknown as {
      textLines?: string[];
      set: (props: Record<string, unknown>) => void;
      initDimensions?: () => void;
    };
    tbx.initDimensions?.();
    const expected = lineTexts.length;
    let w = width;
    for (
      let i = 0;
      i < 12 && (tbx.textLines?.length ?? expected) > expected;
      i += 1
    ) {
      w *= 1.08;
      tbx.set({ width: w });
      tbx.initDimensions?.();
    }
  }

  // Session snapshot: per-line source runs (with their engine index + full
  // style) so the commit maps edited lines back onto the sources losslessly;
  // `paragraphRuns` keeps the legacy flat shape so the existing block-delete
  // and duplicate flows keep working on a session box unchanged.
  const lineRuns: SessionLineRun[][] = lines.map((line) =>
    line.map((r) => ({
      elementId: r.elementId,
      ...(r.index !== undefined ? { index: r.index } : {}),
      bounds: {
        x: r.bounds.x,
        y: r.bounds.y,
        width: r.bounds.width,
        height: r.bounds.height,
      },
      content: r.content,
      style: { ...r.style },
    })),
  );
  const paragraphRuns: ParagraphRun[] = lineRuns.flat().map((r) => ({
    elementId: r.elementId,
    ...(r.index !== undefined ? { index: r.index } : {}),
    bounds: { ...r.bounds },
    content: r.content,
  }));

  (tb as FabricObjectWithData).data = {
    // The session adopts the FIRST run's identity for selection/tracking.
    elementId: first.elementId,
    type: "text",
    index: first.index,
    rotation0: first.transform?.rotation ?? 0,
    originalFont: first.style.originalFont,
    usingEmbeddedFont: baseFont.usingEmbeddedFont,
    originalFill: textColour,
    originalBgColor: first.style.backgroundColor || "",
    isParagraph: true,
    isParagraphSession: true,
    paragraphGroupId: groupId,
    paragraphRuns,
    lineRuns,
    sessionLineTexts: lineTexts,
    sessionOriginalText: content,
    sessionOrigin: { left, top },
    locked: false,
  };

  paragraphSessionRestore.set(tb as unknown as FabricObject, { members });
  canvas.add(tb as unknown as FabricObject);
  canvas.setActiveObject(tb as unknown as FabricObject);
  (tb as unknown as { enterEditing?: () => void }).enterEditing?.();
  canvas.requestRenderAll();
  return tb as unknown as FabricObject;
}

/**
 * ZERO-WRITE exit of a paragraph edit session: remove the session Textbox and
 * put the ORIGINAL per-run objects back at their recorded z indices — the
 * resting render is byte-identical to before the double-click. Returns false
 * when the object carries no session restore info (already restored, or a
 * reloaded canvas — nothing to do). The caller suppresses its object:added/
 * removed forwarding around this call, like for beginParagraphEditSession.
 */
export function restoreParagraphEditSession(
  canvas: FabricCanvas,
  sessionObj: FabricObject,
): boolean {
  const info = paragraphSessionRestore.get(sessionObj);
  if (!info) return false;
  paragraphSessionRestore.delete(sessionObj);
  canvas.remove(sessionObj);
  const insertAt = (
    canvas as unknown as {
      insertAt?: (index: number, ...objects: FabricObject[]) => void;
    }
  ).insertAt;
  for (const { obj, index } of [...info.members].sort(
    (a, b) => a.index - b.index,
  )) {
    if (typeof insertAt === "function") {
      insertAt.call(canvas, Math.min(index, canvas.getObjects().length), obj);
    } else {
      canvas.add(obj);
    }
  }
  (canvas as unknown as { discardActiveObject?: () => void })
    .discardActiveObject?.();
  canvas.requestRenderAll();
  return true;
}

/**
 * Drop the session restore info of a COMMITTED session box (its members are
 * superseded by the commit — restoring them would resurrect stale runs). The
 * box itself stays on canvas as the edited paragraph until the re-render.
 */
export function sealParagraphEditSession(sessionObj: FabricObject): void {
  paragraphSessionRestore.delete(sessionObj);
}

// ---------------------------------------------------------------------------
// Helpers privés
// ---------------------------------------------------------------------------

/**
 * Attache les listeners `selection:created` et `selection:updated` pour
 * propager l'ID de l'élément sélectionné au callback. Idempotent.
 */
function attachSelectionHandlers(
  canvas: FabricCanvas,
  onElementSelected: (id: string) => void,
): void {
  const canvasWithMeta = canvas as unknown as {
    _renderElementsHandlerAttached?: boolean;
  };

  if (canvasWithMeta._renderElementsHandlerAttached) return;
  canvasWithMeta._renderElementsHandlerAttached = true;

  const handleSelection = (e: { selected?: FabricObject[] }) => {
    const active = e.selected?.[0];
    const data = (active as FabricObjectWithData | undefined)?.data;
    if (data?.elementId) {
      onElementSelected(data.elementId);
    }
  };

  canvas.on("selection:created", handleSelection);
  canvas.on("selection:updated", handleSelection);
}

/**
 * Reveal a transparent overlay's real appearance while it is selected, then
 * re-mask it on deselection. In view, both shapes AND parsed images are shown by
 * the text-free raster background; their overlays are invisible hit-targets (a
 * shape is transparent fill/stroke, a parsed image is opacity 0) so the page is
 * not doubled. On selection the overlay is made visible — a shape painted with
 * its stashed `data.original*`, a parsed image flashed at its
 * `data.originalOpacity` — so the user SEES what they drag/resize; the
 * move/resize/restyle pipeline bakes the change into the PDF and the page
 * re-renders, after which the raster shows the result. New images carry no
 * `isTransparentImageOverlay` and are already visible, so they are left as-is.
 * Idempotent per canvas (guarded by a meta flag), so re-renders never stack
 * listeners. (Kept the historical name; it now covers parsed images too.)
 */
function attachShapeStyleReveal(canvas: FabricCanvas): void {
  const canvasWithMeta = canvas as unknown as {
    _shapeRevealHandlerAttached?: boolean;
    _shapeRevealed?: FabricObjectWithData[];
  };
  if (canvasWithMeta._shapeRevealHandlerAttached) return;
  canvasWithMeta._shapeRevealHandlerAttached = true;
  canvasWithMeta._shapeRevealed = [];

  const restore = (obj: FabricObjectWithData) => {
    // A parsed image overlay re-hides to opacity 0 (the raster shows it); a
    // shape overlay re-masks to a transparent fill/stroke.
    if (obj.data?.type === "image") {
      obj.set({ opacity: 0 });
      return;
    }
    obj.set({ fill: "transparent", stroke: "transparent", strokeWidth: 0 });
  };

  const reveal = (obj: FabricObjectWithData) => {
    const data = obj.data;
    if (!data) return;
    // A parsed image overlay is invisible (opacity 0) in view; while selected,
    // flash it at its real opacity so the user SEES what they are dragging.
    if (data.type === "image") {
      const op =
        typeof data.originalOpacity === "number" ? data.originalOpacity : 1;
      obj.set({ opacity: op });
      return;
    }
    if (data.type !== "shape") return;
    const fill =
      typeof data.originalFill === "string" ? data.originalFill : "transparent";
    const stroke =
      typeof data.originalStroke === "string"
        ? data.originalStroke
        : "transparent";
    const strokeWidth =
      typeof data.originalStrokeWidth === "number"
        ? data.originalStrokeWidth
        : 0;
    obj.set({ fill, stroke, strokeWidth });
    if (Array.isArray(data.originalStrokeDashArray)) {
      obj.set({ strokeDashArray: [...data.originalStrokeDashArray] });
    }
  };

  const clearRevealed = () => {
    const revealed = canvasWithMeta._shapeRevealed ?? [];
    for (const obj of revealed) restore(obj);
    canvasWithMeta._shapeRevealed = [];
  };

  const handle = (e: { selected?: FabricObject[] }) => {
    // Re-mask anything revealed by a previous selection (selection change).
    clearRevealed();
    const selected = (e.selected ?? []) as FabricObjectWithData[];
    // Reveal selected shapes AND parsed-image hit-targets — both are invisible
    // in view (shown only by the raster). New images carry no
    // `isTransparentImageOverlay` and stay visible/untouched.
    const revealable = selected.filter(
      (o) =>
        o.data?.type === "shape" ||
        (o.data?.type === "image" &&
          o.data?.isTransparentImageOverlay === true),
    );
    for (const obj of revealable) reveal(obj);
    canvasWithMeta._shapeRevealed = revealable;
    if (revealable.length > 0) canvas.requestRenderAll();
  };

  canvas.on("selection:created", handle);
  canvas.on("selection:updated", handle);
  canvas.on("selection:cleared", () => {
    clearRevealed();
    canvas.requestRenderAll();
  });
}

/**
 * Toggle a checkbox/radio form field when its overlay mark is clicked, so the
 * user fills the form directly on the page. Flips `data.fieldChecked`, swaps the
 * glyph (☑/☐, ◉/○) and its colour, then fires `object:modified` so the change is
 * persisted through the SAME pipeline as every other edit
 * (fabricObjectToElement → operations-store → apply-elements). For a radio, the
 * sibling radios of the same group (same fieldName) are unchecked — a radio
 * group has at most one selected option. Idempotent per canvas.
 */
function attachFormFieldToggle(
  canvas: FabricCanvas,
  onElementSelected?: (id: string) => void,
): void {
  const canvasWithMeta = canvas as unknown as {
    _formFieldToggleAttached?: boolean;
  };
  if (canvasWithMeta._formFieldToggleAttached) return;
  canvasWithMeta._formFieldToggleAttached = true;

  const setMark = (obj: FabricObjectWithData, checked: boolean): void => {
    const fieldType = obj.data?.fieldType;
    const mark =
      fieldType === "checkbox"
        ? checked
          ? "☑"
          : "☐"
        : checked
          ? "◉"
          : "○";
    (
      obj as FabricObject & {
        set: (o: Record<string, unknown>) => void;
        text?: string;
      }
    ).set({ text: mark, fill: checked ? "#0a7a0a" : "#444444" });
  };

  const fireModified = (obj: FabricObject): void => {
    (canvas as unknown as { fire: (e: string, o: unknown) => void }).fire(
      "object:modified",
      { target: obj },
    );
  };

  /** Live Fill & Sign flags stamped on the canvas by the editor surface. */
  const fillSignMeta = canvas as unknown as {
    _gigaFillSignMode?: boolean;
    _gigaOnSignatureFieldClick?: (element: unknown) => void;
  };

  /** Resolve a hit Rect's CONTENT object (the real field value object). */
  const resolveHitContent = (
    hit: FabricObjectWithData,
  ): FabricObjectWithData | undefined =>
    canvas.getObjects().find((o) => {
      const od = (o as FabricObjectWithData).data;
      return (
        od?.elementId === hit.data?.hitForElementId &&
        od?.isFieldHitTarget !== true
      );
    }) as FabricObjectWithData | undefined;

  /**
   * The signature-stamp image placed into a widget during Fill & Sign
   * (`data.signedWidgetId` set by editor-canvas `addImage`), or undefined when
   * the widget is unsigned / its stamp was deleted from the canvas.
   */
  const findSignedImage = (
    widgetElementId: unknown,
  ): FabricObjectWithData | undefined => {
    if (typeof widgetElementId !== "string" || widgetElementId.length === 0) {
      return undefined;
    }
    return canvas.getObjects().find((o) => {
      const od = (o as FabricObjectWithData).data;
      return od?.signedWidgetId === widgetElementId;
    }) as FabricObjectWithData | undefined;
  };

  /**
   * Fill & Sign click on a SIGNATURE widget: when a stamp image is already
   * placed in it, SELECT the image (so it stays movable/resizable without
   * friction) instead of reopening the capture dialog; otherwise open the
   * capture. Deleting the stamp makes the widget re-signable again.
   */
  const handleSignatureWidgetClick = (
    widget: FabricObjectWithData,
  ): void => {
    const signed = findSignedImage(widget.data?.elementId);
    if (signed) {
      canvas.setActiveObject(signed as FabricObject);
      const imageId = signed.data?.elementId;
      if (typeof imageId === "string" && imageId && onElementSelected) {
        onElementSelected(imageId);
      }
      canvas.requestRenderAll();
      return;
    }
    fillSignMeta._gigaOnSignatureFieldClick?.(widget.data?.formFieldElement);
  };

  /**
   * Toggle a checkable widget + keep its GROUP coherent across the page's
   * sibling widgets (same fieldName):
   *   - a widget with the SAME on-state (duplicate-page twin) mirrors this one;
   *   - a widget with a DIFFERENT on-state (multi-widget named checkbox pairs
   *     like Oui/non on CERFA forms, or radio buttons) is UNCHECKED when this
   *     one checks — one field holds ONE value, so "non" checking must uncheck
   *     the "Oui" overlay.
   * Siblings fire `object:modified` BEFORE the target so the target's value is
   * the LAST queued for the field (last-wins accumulation at bake time).
   */
  const toggleCheckable = (target: FabricObjectWithData): void => {
    const data = target.data;
    if (!data) return;
    const nextChecked = data.fieldChecked !== true;
    const groupName = data.fieldName;
    const onValue =
      typeof data.fieldOnValue === "string" && data.fieldOnValue.length > 0
        ? data.fieldOnValue
        : null;

    for (const other of canvas.getObjects() as FabricObjectWithData[]) {
      if (other === target) continue;
      const od = other.data;
      if (od?.type !== "form_field" || od.isFieldHitTarget === true) continue;
      if (od.fieldType !== "checkbox" && od.fieldType !== "radio") continue;
      if (od.fieldName !== groupName) continue;
      const otherOn =
        typeof od.fieldOnValue === "string" && od.fieldOnValue.length > 0
          ? od.fieldOnValue
          : null;
      const isTwin = onValue !== null && otherOn !== null && otherOn === onValue;
      // Twins mirror the target's new state; distinct-state siblings are
      // unchecked when the target checks and untouched when it unchecks.
      const desired = isTwin
        ? nextChecked
        : nextChecked
          ? false
          : od.fieldChecked === true;
      if ((od.fieldChecked === true) === desired) continue;
      od.fieldChecked = desired;
      setMark(other, desired);
      fireModified(other);
    }

    data.fieldChecked = nextChecked;
    setMark(target, nextChecked);
    if (data.elementId && onElementSelected) onElementSelected(data.elementId);
    fireModified(target);
    canvas.requestRenderAll();
  };

  canvas.on(
    "mouse:down",
    (e: { target?: FabricObject | null }) => {
      const target = e.target as FabricObjectWithData | null;
      if (!target?.data) return;
      const data = target.data;
      const fillSign = fillSignMeta._gigaFillSignMode === true;

      // Delegated click on a full-rect field hit-target: route to the field's
      // CONTENT object — toggle for checkables, selection for the others (the
      // caret for text entry is placed on mouse:up below).
      if (data.isFieldHitTarget === true) {
        const content = resolveHitContent(target);
        if (!content?.data) return;
        if (
          content.data.fieldType === "checkbox" ||
          content.data.fieldType === "radio"
        ) {
          toggleCheckable(content);
          return;
        }
        if (fillSign && content.data.fieldType === "signature") {
          handleSignatureWidgetClick(content);
          return;
        }
        canvas.setActiveObject(content as FabricObject);
        if (content.data.elementId && onElementSelected) {
          onElementSelected(content.data.elementId as string);
        }
        canvas.requestRenderAll();
        return;
      }

      if (data.type !== "form_field") return;

      // Fill & Sign: clicking a SIGNATURE widget opens the capture dialog so
      // the drawn/typed/imported signature lands INSIDE the widget rect —
      // unless a stamp is already placed there, in which case the click
      // SELECTS the stamp (movable/resizable) instead of reopening.
      if (fillSign && data.fieldType === "signature") {
        handleSignatureWidgetClick(target);
        return;
      }

      if (data.fieldType !== "checkbox" && data.fieldType !== "radio") return;
      toggleCheckable(target);
    },
  );

  // Fill & Sign (Adobe UX): a SINGLE click on a text-entry widget — its IText/
  // Textbox or its full-rect hit target — places the caret directly (no double
  // click). Done on mouse:up so Fabric's own mousedown selection/drag handling
  // has fully settled; outside Fill & Sign the design behaviour is untouched
  // (single click selects, double click edits, drag moves the widget).
  canvas.on(
    "mouse:up",
    (e: { target?: FabricObject | null; e?: Event }) => {
      if (fillSignMeta._gigaFillSignMode !== true) return;
      const target = e.target as FabricObjectWithData | null;
      if (!target?.data) return;
      let content: FabricObjectWithData | undefined = target;
      if (target.data.isFieldHitTarget === true) {
        content = resolveHitContent(target);
      }
      const data = content?.data;
      if (!content || data?.type !== "form_field") return;
      if (data.fieldType !== "text" && data.fieldType !== "dropdown") return;
      const editable = content as FabricObjectWithData & {
        isEditing?: boolean;
        enterEditing?: () => void;
        setCursorByClick?: (ev: Event) => void;
      };
      if (editable.isEditing) return;
      canvas.setActiveObject(content as FabricObject);
      editable.enterEditing?.();
      if (e.e) editable.setCursorByClick?.(e.e);
      canvas.requestRenderAll();
    },
  );
}

// ---------------------------------------------------------------------------
// Paragraph BLOCK selection (click = block, re-click = run, Alt+click = run)
// + hover affordance (light outline around the hovered block)
//
// The EDIT-INTENT tagging above gives every engine block's members a shared
// `data.paragraphGroupId`. These two attachments turn that identity into the
// Word/Illustrator selection model the user expects: one click selects the
// WHOLE block as a Fabric ActiveSelection (move/delete/restyle then flow
// per-run through the standard pipeline), a second click drills down to the
// run under the pointer, Alt+click targets the run directly, and hovering a
// member draws a discreet outline around the block so the affordance is
// visible BEFORE the click. Both are presentation-only: no scene-graph change,
// no operation queued, nothing serialised.
// ---------------------------------------------------------------------------

/**
 * Live editor-surface flags stamped on the Fabric canvas instance by
 * editor-canvas.tsx (same mechanism as the Fill & Sign flags): reading them at
 * event time lets the behaviour follow the CURRENT tool without re-attaching
 * listeners. Absent stamps (tests, secondary surfaces) behave like the plain
 * select tool.
 */
interface GigaCanvasLiveFlags {
  _gigaFillSignMode?: boolean;
  _gigaCurrentTool?: string;
}

/** Narrow an event target to a live Fabric multi-selection (never a data Group
 *  such as a radio widget — those carry an elementId and type "group"). */
function isLiveActiveSelection(
  obj: FabricObject | null | undefined,
): obj is FabricObject & { getObjects: () => FabricObject[] } {
  if (!obj) return false;
  const typeName = (obj as FabricObject & { type?: string }).type ?? "";
  return (
    typeName === "activeselection" &&
    typeof (obj as { getObjects?: unknown }).getObjects === "function"
  );
}

/**
 * The single paragraph group id shared by ALL members of a live selection, or
 * `null` when the selection is empty/mixed (marquee across blocks, block +
 * image, …) — mixed selections keep Fabric's native click behaviour.
 */
function blockGroupIdOfSelection(sel: {
  getObjects: () => FabricObject[];
}): string | null {
  const children = sel.getObjects();
  if (children.length < 2) return null;
  let groupId: string | null = null;
  for (const child of children) {
    const data = (child as FabricObjectWithData).data;
    const id = data?.paragraphGroupId;
    if (typeof id !== "string" || data?.isParagraphSession === true) {
      return null;
    }
    if (groupId === null) groupId = id;
    else if (groupId !== id) return null;
  }
  return groupId;
}

/**
 * Absolute (scene-space) bounding box of an object. Fabric ≥ 6 composes the
 * parent group transform inside `getBoundingRect()`, so this is correct even
 * for a member currently inside an ActiveSelection (whose own left/top are
 * RELATIVE to the selection centre — the classic multi-selection pitfall).
 */
function absBoundingRectOf(
  obj: FabricObject,
): { left: number; top: number; width: number; height: number } | null {
  const withRect = obj as FabricObject & {
    getBoundingRect?: () => {
      left: number;
      top: number;
      width: number;
      height: number;
    };
  };
  if (typeof withRect.getBoundingRect !== "function") return null;
  try {
    return withRect.getBoundingRect();
  } catch {
    return null;
  }
}

/**
 * Single-click BLOCK selection for paragraph groups (Illustrator/Figma model):
 *
 *   - click on a member run → the WHOLE block becomes the active selection
 *     (Fabric `ActiveSelection` of every live member — move/scale/delete then
 *     flow per-run through the existing object:modified/removed pipeline);
 *   - click while the block IS the active selection → DRILL-DOWN to the run
 *     under the pointer (hit-tested with `containsPoint`, which is absolute
 *     even inside a selection);
 *   - once drilled in (a member run is the active object), further clicks keep
 *     Fabric's native single-run behaviour — including the second-click
 *     inline-edit path;
 *   - Alt+click targets the run directly; Shift/Ctrl/Meta keep Fabric's native
 *     multi-selection; drags (marquee, move) are untouched (`isClick` guard).
 *
 * Promotion happens on mouse:up so Fabric's own mousedown selection/transform
 * setup has fully settled (same reasoning as the Fill & Sign caret placement):
 * swapping the active object DURING mousedown would leave Fabric's transform
 * pointing at the lone run while the selection holds it — corrupting a drag.
 * Idempotent per canvas; only active in the plain select tool, outside
 * Fill & Sign (live flags stamped by the surface).
 */
function attachParagraphBlockSelection(
  canvas: FabricCanvas,
  fabricModule: FabricModule,
): void {
  const canvasWithMeta = canvas as unknown as {
    _paragraphBlockSelectAttached?: boolean;
  } & GigaCanvasLiveFlags;
  if (canvasWithMeta._paragraphBlockSelectAttached) return;
  canvasWithMeta._paragraphBlockSelectAttached = true;

  const interactionAllowed = (): boolean => {
    if (canvasWithMeta._gigaFillSignMode === true) return false;
    const tool = canvasWithMeta._gigaCurrentTool;
    return typeof tool !== "string" || tool === "select";
  };

  // Active object BEFORE Fabric's own mousedown selection. Fabric selects the
  // clicked run DURING __onMouseDown (activeOn 'down'), so by mouse:up the run
  // is always active — only this snapshot distinguishes a first click on a
  // block (→ promote) from a click while already drilled into it (→ native).
  let prevActiveAtDown: FabricObject | null = null;
  canvas.on("mouse:down:before", () => {
    prevActiveAtDown =
      (
        canvas as unknown as { getActiveObject?: () => FabricObject | null }
      ).getActiveObject?.() ?? null;
  });

  canvas.on(
    "mouse:up",
    (opt: {
      target?: FabricObject | null;
      isClick?: boolean;
      scenePoint?: { x: number; y: number };
      e?: Event;
    }) => {
      // Only plain CLICKS re-target the selection: a drag is a move/marquee.
      if (opt.isClick === false) return;
      if (!interactionAllowed()) return;
      const evt = opt.e as MouseEvent | undefined;
      // Alt = run directly (Fabric already selected it at mousedown);
      // Shift/Ctrl/Meta = Fabric's native multi-selection keys.
      if (evt && (evt.altKey || evt.shiftKey || evt.ctrlKey || evt.metaKey)) {
        return;
      }
      const target = opt.target as FabricObjectWithData | null | undefined;
      if (!target) return;

      // DRILL-DOWN: the click landed on the live block selection (Fabric
      // targets the ActiveSelection when the pointer is inside it) → select
      // the individual run under the pointer. containsPoint composes the
      // group transform, so it hit-tests correctly despite the members'
      // relative coordinates. A click on the selection padding (between
      // lines) keeps the block selected.
      if (isLiveActiveSelection(target)) {
        if (!blockGroupIdOfSelection(target)) return;
        const point = opt.scenePoint;
        if (!point) return;
        const member = target.getObjects().find((o) => {
          const hitTestable = o as FabricObject & {
            containsPoint?: (p: { x: number; y: number }) => boolean;
          };
          return (
            typeof hitTestable.containsPoint === "function" &&
            hitTestable.containsPoint(point)
          );
        });
        if (!member) return;
        canvas.setActiveObject(member);
        canvas.requestRenderAll();
        return;
      }

      // PROMOTION: a plain click on a member run selects the WHOLE block.
      const data = target.data;
      const groupId = data?.paragraphGroupId;
      if (typeof groupId !== "string" || data?.isParagraphSession === true) {
        return;
      }
      if (
        (target as FabricObject & { isEditing?: boolean }).isEditing === true
      ) {
        return;
      }
      // Drilled-in state: the previous active object was this very run (or a
      // same-group sibling) → keep Fabric's native single-run behaviour (this
      // is also what lets the second click enter inline editing).
      if (prevActiveAtDown === (target as FabricObject)) return;
      const prevData = (prevActiveAtDown as FabricObjectWithData | null)?.data;
      if (
        prevData?.paragraphGroupId === groupId &&
        !isLiveActiveSelection(prevActiveAtDown)
      ) {
        return;
      }
      const members = canvas.getObjects().filter((o) => {
        const od = (o as FabricObjectWithData).data;
        return (
          od?.paragraphGroupId === groupId &&
          od?.isParagraphSession !== true &&
          od?.isParagraphHoverOutline !== true &&
          (o as FabricObject).selectable !== false &&
          (o as FabricObject).visible !== false
        );
      });
      if (members.length < 2) return;
      // Same primitive as the layers-panel multi-selection (selectElements):
      // Fabric ≥ 6 fires selection:created/updated from setActiveObject, so
      // the store/properties panel sync through the standard handlers.
      const selection = new fabricModule.ActiveSelection(members, { canvas });
      canvas.setActiveObject(selection as unknown as FabricObject);
      canvas.requestRenderAll();
    },
  );
}

/**
 * Hover affordance for paragraph blocks: while the pointer is over a member of
 * a group, a discreet outline (1px primary at ~35% opacity, no fill) is drawn
 * around the UNION of the members' absolute bounds, so the "one click selects
 * the whole block" behaviour is visible before the click. The outline is pure
 * chrome: non-interactive (`selectable:false, evented:false`), excluded from
 * export, never serialised (fabric-element-io skips `isParagraphHoverOutline`)
 * and swept on re-render. Removed on mouse-out (kept while moving between two
 * members of the SAME block — `nextTarget`) and on mouse-down (the real
 * selection visuals take over). Idempotent per canvas.
 */
function attachParagraphHoverAffordance(
  canvas: FabricCanvas,
  fabricModule: FabricModule,
): void {
  const canvasWithMeta = canvas as unknown as {
    _paragraphHoverAffordanceAttached?: boolean;
  } & GigaCanvasLiveFlags;
  if (canvasWithMeta._paragraphHoverAffordanceAttached) return;
  canvasWithMeta._paragraphHoverAffordanceAttached = true;
  const { Rect } = fabricModule;

  // The canvas is the single source of truth for the outline (no closure
  // state): the re-render sweep in renderElementsOverlay can remove it at any
  // time without desyncing this attachment.
  const findOutline = (): FabricObjectWithData | undefined =>
    canvas
      .getObjects()
      .find(
        (o) =>
          (o as FabricObjectWithData).data?.isParagraphHoverOutline === true,
      ) as FabricObjectWithData | undefined;

  const removeOutline = (): void => {
    const outline = findOutline();
    if (!outline) return;
    canvas.remove(outline as unknown as FabricObject);
    canvas.requestRenderAll();
  };

  canvas.on(
    "mouse:over",
    (opt: { target?: FabricObject | null }) => {
      if (canvasWithMeta._gigaFillSignMode === true) return;
      const tool = canvasWithMeta._gigaCurrentTool;
      if (typeof tool === "string" && tool !== "select") return;
      const target = opt.target as FabricObjectWithData | null | undefined;
      const data = target?.data;
      const groupId = data?.paragraphGroupId;
      if (typeof groupId !== "string" || data?.isParagraphSession === true) {
        removeOutline();
        return;
      }
      const existing = findOutline();
      if (existing?.data?.hoverForGroupId === groupId) return; // already shown
      if (existing) canvas.remove(existing as unknown as FabricObject);

      // Union of the members' ABSOLUTE bounds (getBoundingRect composes any
      // parent selection transform — correct even while the block is the
      // active multi-selection).
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const o of canvas.getObjects()) {
        const od = (o as FabricObjectWithData).data;
        if (
          od?.paragraphGroupId !== groupId ||
          od?.isParagraphSession === true ||
          od?.isParagraphHoverOutline === true
        ) {
          continue;
        }
        const rect = absBoundingRectOf(o as FabricObject);
        if (!rect) continue;
        minX = Math.min(minX, rect.left);
        minY = Math.min(minY, rect.top);
        maxX = Math.max(maxX, rect.left + rect.width);
        maxY = Math.max(maxY, rect.top + rect.height);
      }
      if (!Number.isFinite(minX) || !Number.isFinite(maxY)) return;

      const PAD = 2; // breathing room so the outline never kisses the glyphs
      const outline = new Rect({
        left: minX - PAD,
        top: minY - PAD,
        width: maxX - minX + PAD * 2,
        height: maxY - minY + PAD * 2,
        // Fabric ≥ 6 defaults originX/Y to 'center' — force top-left like
        // every other object positioned by left/top here.
        originX: "left" as const,
        originY: "top" as const,
        fill: "transparent",
        stroke: "rgba(0, 100, 200, 0.35)",
        strokeWidth: 1,
        // Keep a crisp 1px on screen whatever the zoom.
        strokeUniform: true,
        selectable: false,
        evented: false,
        hasControls: false,
        hasBorders: false,
        excludeFromExport: true,
        objectCaching: false,
      });
      (outline as FabricObjectWithData).data = {
        isParagraphHoverOutline: true,
        hoverForGroupId: groupId,
      };
      canvas.add(outline as unknown as FabricObject);
      canvas.requestRenderAll();
    },
  );

  canvas.on(
    "mouse:out",
    (opt: {
      target?: FabricObject | null;
      nextTarget?: FabricObject | null;
    }) => {
      const outline = findOutline();
      if (!outline) return;
      // Moving between two members of the SAME block keeps the outline —
      // Fabric hands us the entering object as `nextTarget` on the way out.
      const nextData = (
        opt.nextTarget as FabricObjectWithData | null | undefined
      )?.data;
      if (
        nextData?.paragraphGroupId === outline.data?.hoverForGroupId &&
        nextData?.isParagraphSession !== true
      ) {
        return;
      }
      canvas.remove(outline as unknown as FabricObject);
      canvas.requestRenderAll();
    },
  );

  // A click replaces the affordance with the real selection visuals.
  canvas.on("mouse:down", () => removeOutline());
}
