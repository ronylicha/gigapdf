/**
 * Element models matching backend Pydantic schemas.
 * All coordinates use web-standard system (origin top-left, Y increases downward).
 * Values are in PDF points (1 point = 1/72 inch).
 */

import type { UUID, Bounds, Point, Transform } from "./common";

// Element types
export type ElementType = "text" | "image" | "shape" | "annotation" | "form_field";

// Base element interface
export interface ElementBase {
  elementId: UUID;
  type: ElementType;
  bounds: Bounds;
  transform: Transform;
  layerId: UUID | null;
  locked: boolean;
  visible: boolean;
}

// ============= Text Element =============

/**
 * Word-like list styling on a text paragraph. Additive and paragraph-level
 * (lives on {@link TextStyle} alongside `textAlign`/`lineHeight`), so a text
 * element without `list` behaves exactly as before.
 *
 * `type` selects the marker family; `level` is the 0-based nesting depth used
 * (with `type`) to derive the marker glyph and the indentation step:
 *   - "bullet"   → •, ◦, ▪ cycling by level
 *   - "number"   → 1. 2. 3. …
 *   - "lettered" → a. b. c. …
 *   - "roman"    → i. ii. iii. …
 *
 * The marker is a RENDER-TIME decoration (a visible prefix) — it is never
 * stored in the element's editable `content`, so the lossless `replaceText`
 * round-trip stays intact. See `lib/list-format.ts`.
 */
export type ListType = "bullet" | "number" | "lettered" | "roman";

export interface TextListStyle {
  type: ListType;
  /** 0-based nesting depth; drives marker glyph + indentation step. */
  level: number;
}

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: "normal" | "bold";
  fontStyle: "normal" | "italic";
  color: string;
  opacity: number;
  textAlign: "left" | "center" | "right" | "justify";
  lineHeight: number;
  letterSpacing: number;
  writingMode: "horizontal-tb" | "vertical-rl";
  /**
   * Optional Word-like list styling (bullet/number/lettered/roman). Absent ⇒
   * the paragraph is not a list. Purely additive / backward-compatible: the
   * marker glyph is rendered as a decorative prefix, never baked into the
   * editable `content`. See {@link TextListStyle}.
   */
  list?: TextListStyle;
  /**
   * Optional left indentation of the paragraph, in PDF points. Absent ⇒ 0.
   * Shifts the rendered text box to the right (and, for a list, positions the
   * marker in the resulting gutter). Additive / backward-compatible.
   */
  indentLeft?: number;
  /**
   * Optional right indentation of the paragraph, in PDF points. Absent ⇒ 0.
   * Narrows the text box from the right edge. Additive / backward-compatible;
   * bakes natively via `setParagraphStyle` (`indent_right`).
   */
  indentRight?: number;
  /**
   * Optional first-line indent of the paragraph, in PDF points. Positive ⇒ the
   * first line is indented further than the rest; negative ⇒ a hanging indent
   * (first line outdented). Absent ⇒ 0. Additive / backward-compatible; bakes
   * natively via `setParagraphStyle` (`first_line`).
   */
  firstLine?: number;
  /**
   * Optional spacing ABOVE the paragraph, in PDF points. Absent ⇒ 0. Adds
   * vertical room before the paragraph's first line. Additive /
   * backward-compatible; bakes natively via `setParagraphStyle` (`space_before`).
   */
  spaceBefore?: number;
  /**
   * Optional spacing BELOW the paragraph, in PDF points. Absent ⇒ 0. Adds
   * vertical room after the paragraph's last line. Additive /
   * backward-compatible; bakes natively via `setParagraphStyle` (`space_after`).
   */
  spaceAfter?: number;
  /**
   * Bidirectional reading direction of the run. Surfaced by the engine
   * (`GigaPdfDoc.textElements().direction`) from the script of the text so the
   * canvas (Fabric `direction`) and the layer properties panel (`dir`) edit
   * right-to-left scripts (Arabic, Hebrew, …) correctly. Absent ⇒ `"ltr"`.
   */
  direction?: "ltr" | "rtl";
  // Additional text decorations
  underline: boolean;
  strikethrough: boolean;
  backgroundColor: string | null;
  verticalAlign: "baseline" | "superscript" | "subscript";
  // Original font info for 1:1 rendering
  originalFont: string | null;
  /**
   * PHYSICAL identity of the run's embedded font program — the engine's
   * `TextElementInfo.fontId` (first 8 hex chars of the SHA-256 of the decoded
   * `/FontFile*` bytes, matching `EmbeddedFontV2.fontId`). Unlike
   * {@link originalFont} (a `/BaseFont` NAME, ambiguous when many wrapper dicts
   * share one program), this pins the exact program that painted the run, so
   * the editor always serves the run's OWN glyphs. Absent when the run's font
   * embeds no program (base-14 / non-embedded faces, Type3). Additive /
   * backward-compatible.
   */
  fontId?: string;
}

/**
 * A run of *character-level* style overrides spanning `[start, end)` of the
 * element's `content` (UTF-16 code-unit indices, the same indexing Fabric's
 * IText selection uses). Enables Word-like partial formatting: bold/italic/
 * underline/colour/size/font applied to a SELECTION inside a text element,
 * not just the element as a whole.
 *
 * Each run carries only the fields that DIFFER from the element's base
 * `style` (a `Partial<TextStyle>`); unspecified fields inherit the base. Runs
 * are non-overlapping and sorted by `start`. Absent (`runs` undefined or empty)
 * ⇒ the element is uniformly styled by `style` exactly as before — this field
 * is purely additive and backward-compatible.
 *
 * Surfaced from / consumed by Fabric's per-character `styles` map in the
 * editor (see `lib/text-runs.ts`). NOTE: the PDF *bake* (`addText`/
 * `replaceText`) is currently one-style-per-run, so mixed runs are preserved
 * in the editable scene graph and round-trip through the apply payload, but
 * are not yet materialised glyph-by-glyph into the PDF binary — that requires
 * the engine model-ops path (`restyleRun` on the GigaDocument block tree).
 */
export interface TextStyleRun {
  /** Inclusive start char index into `content` (UTF-16 code units). */
  start: number;
  /** Exclusive end char index into `content`. `end > start`. */
  end: number;
  /** Style fields overriding the base `style` for this character range. */
  style: Partial<TextStyle>;
}

export interface TextElement extends ElementBase {
  type: "text";
  content: string;
  style: TextStyle;
  /**
   * Optional character-level style runs (Word-like partial formatting).
   * Absent ⇒ uniform `style` (legacy behaviour). See {@link TextStyleRun}.
   */
  runs?: TextStyleRun[];
  ocrConfidence: number | null;
  // Link support for clickable text
  linkUrl: string | null;
  linkPage: number | null;
  /**
   * Engine text-run index (from `GigaPdfDoc.textElements().index`) enabling
   * true in-place editing via `replaceText` / `moveElement` / `removeElement`.
   *
   * Present only for runs surfaced by the per-run extractor
   * (`extractTextElementsByPage`). Absent — or `< 0` (a sentinel the engine
   * uses for FORM-XObject text it cannot edit in place) — means the run is not
   * directly editable in place; the apply pipeline falls back to redact + add.
   * Coalesced text blocks span multiple runs and therefore carry no single
   * index.
   */
  index?: number;
  /**
   * Visually contiguous fragments of a justified / per-glyph-positioned run
   * (from `TextElementInfo.segments`), each with its own web-space box. When
   * present (length ≥ 1), the renderer paints ONE positioned `IText` per
   * fragment — 1:1 with the source, since a single box cannot reproduce a run
   * whose glyphs are spread by internal `TJ` jumps (a legal footer). Every
   * fragment shares this element's {@link ElementBase.elementId} / {@link index}
   * so editing still targets the whole run. Absent/empty ⇒ a plain run rendered
   * as one box (the common case).
   */
  segments?: TextRunSegment[];
}

/**
 * One positioned fragment of a {@link TextElement} run — its text and web-space
 * (Y-down) box. See {@link TextElement.segments}.
 */
export interface TextRunSegment {
  text: string;
  bounds: { x: number; y: number; width: number; height: number };
}

// ============= Image Element =============

export interface ImageSource {
  type: "embedded" | "external";
  dataUrl: string;
  originalFormat: string;
  originalDimensions: { width: number; height: number };
}

export interface ImageStyle {
  opacity: number;
  blendMode: "normal" | "multiply" | "screen" | "overlay" | "darken" | "lighten";
  /**
   * Sampled background colour (hex, e.g. "#ffffff") under the image, captured
   * by the client when the image is placed. Used by the renderer to erase the
   * old image area without leaving a white patch on coloured backgrounds.
   */
  backgroundColor?: string;
}

export interface ImageCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageElement extends ElementBase {
  type: "image";
  source: ImageSource;
  style: ImageStyle;
  crop: ImageCrop | null;
  /**
   * Engine UNIFIED element index (from `GigaPdfDoc.imageElements().index`),
   * populated by the image extractor. Enables lossless in-place
   * `transformElement` (move/resize) and `removeElement` (delete) in the apply
   * pipeline instead of redact + add. Absent on newly-added images (no original
   * engine element) → those still take the add path.
   */
  index?: number;
}

// ============= Shape Element =============

export type ShapeType = "rectangle" | "circle" | "ellipse" | "triangle" | "line" | "arrow" | "polygon" | "path";

export interface ShapeGeometry {
  points: Point[];
  pathData: string | null;
  cornerRadius: number;
}

export interface ShapeStyle {
  fillColor: string | null;
  fillOpacity: number;
  strokeColor: string | null;
  strokeWidth: number;
  strokeOpacity: number;
  strokeDashArray: number[];
}

export interface ShapeElement extends ElementBase {
  type: "shape";
  shapeType: ShapeType;
  geometry: ShapeGeometry;
  style: ShapeStyle;
  /**
   * Engine UNIFIED element index (from `GigaPdfDoc.vectorPaths().index`),
   * populated by the drawing extractor. Enables lossless in-place
   * `transformElement` (move/resize) and `removeElement` (delete) in the apply
   * pipeline instead of redact + add. Absent on newly-added shapes (no original
   * engine element) → those still take the add path.
   */
  index?: number;
}

// ============= Annotation Element =============

export type AnnotationType =
  | "highlight"
  | "underline"
  | "strikeout"
  | "strikethrough"
  | "squiggly"
  | "note"
  | "comment"
  | "freetext"
  | "stamp"
  | "line"
  | "arrow"
  | "link";

export interface LinkDestination {
  type: "internal" | "external";
  pageNumber: number | null;
  url: string | null;
  position: Point | null;
}

export interface AnnotationPopup {
  isOpen: boolean;
  bounds: Bounds;
}

export interface AnnotationStyle {
  color: string;
  opacity: number;
  /** Stroke width for line/arrow annotations (PDF points). Defaults to 2. */
  strokeWidth?: number;
}

/**
 * Endpoints of a line/arrow annotation in web coords (Y-down). The arrowhead
 * (for `annotationType === "arrow"`) is drawn at the `(x2, y2)` end.
 */
export interface AnnotationLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Quad for a single highlight/underline/squiggly/strikeout run.
 * Four corners in web coords: top-left, top-right, bottom-left, bottom-right.
 * Maps to /QuadPoints in the PDF spec (§12.5.6.10) after Y-flip.
 */
export interface AnnotationQuad {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  x3: number;
  y3: number;
  x4: number;
  y4: number;
}

export interface AnnotationElement extends ElementBase {
  type: "annotation";
  annotationType: AnnotationType;
  content: string;
  style: AnnotationStyle;
  linkDestination: LinkDestination | null;
  popup: AnnotationPopup | null;
  /**
   * Optional author/title shown in the popup. Surfaces as /T in the PDF dict.
   */
  author?: string;
  /**
   * Runs of selected text for highlight/underline/squiggly/strikeout.
   * When omitted, the renderer falls back to a single quad covering `bounds`.
   */
  quads?: AnnotationQuad[];
  /**
   * Endpoints for line/arrow annotations (web coords). When omitted, the
   * renderer falls back to the diagonal of `bounds`.
   */
  linePoints?: AnnotationLine;
}

// ============= Form Field Element =============

export type FieldType =
  | "text"
  | "checkbox"
  | "radio"
  | "dropdown"
  | "listbox"
  | "signature"
  | "button";

export interface FieldFormat {
  type: "none" | "number" | "date" | "time" | "percentage" | "currency";
  pattern: string | null;
}

export interface FieldProperties {
  required: boolean;
  readOnly: boolean;
  maxLength: number | null;
  multiline: boolean;
  password: boolean;
  comb: boolean;
}

export interface FieldStyle {
  fontFamily: string;
  fontSize: number;
  textColor: string;
  backgroundColor: string | null;
  borderColor: string | null;
  borderWidth: number;
  /** Horizontal alignment of the field text (maps to /Q in AcroForm, 0/1/2 → left/center/right). */
  textAlign?: "left" | "center" | "right";
  /**
   * Font resource name from the field's `/DA` default appearance (e.g. "Helv",
   * "ZaDb"), resolved against the AcroForm. Absent when the field carries no `Tf`.
   */
  daFont?: string | null;
  /**
   * Font size in points from the field's `/DA` (`0` = auto-size). Drives the
   * overlay font size so the editable value matches the field's original render.
   */
  daSize?: number | null;
}

export interface FormFieldElement extends ElementBase {
  type: "form_field";
  fieldType: FieldType;
  fieldName: string;
  value: string | boolean | string[];
  defaultValue: string | boolean | string[];
  options: string[] | null;
  properties: FieldProperties;
  style: FieldStyle;
  format: FieldFormat;
  /** Hint text shown while the field is empty (editor-side only — not part of AcroForm). */
  placeholder?: string | null;
  /** Tooltip / alternate description (maps to /TU in AcroForm, read by screen readers). */
  tooltip?: string | null;
  /**
   * For a checkbox/radio WIDGET, the on-state export value that marks THIS widget
   * checked (the field's `value` equals it). A radio group has one element per
   * button, each with its own `onValue`; `null` for text/choice/other widgets and
   * for a boolean checkbox with no named on-state.
   */
  onValue?: string | null;
}

// ============= Union Type =============

export type Element =
  | TextElement
  | ImageElement
  | ShapeElement
  | AnnotationElement
  | FormFieldElement;

// ============= Layer =============

export interface LayerObject {
  layerId: UUID;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  print: boolean;
  order: number;
  /**
   * Numeric id of the underlying native PDF Optional Content Group (OCG), when
   * this layer mirrors a real OCG read from the document. Absent on editor-only
   * "layer groups" (user layers), which have no PDF counterpart. Drives the
   * native OCG mutators (`/api/pdf/ocg`: setLayerVisibility/Locked/removeLayer).
   */
  ocgId?: number;
}

// ============= Tool Types =============

export type Tool =
  | "select"
  | "text"
  | "image"
  | "shape"
  | "annotation"
  | "form_field"
  | "draw"   // creates a signature field area
  | "redact" // draws irreversible PII redaction zones
  | "fill_sign" // Adobe-style "Fill & Sign": fill form fields + place a signature/initials
  | "hand"
  | "zoom";

export type ShapeSubtype = "rectangle" | "ellipse" | "line" | "polygon" | "path";
export type AnnotationSubtype = "highlight" | "underline" | "strikeout" | "note" | "link";
export type FormFieldSubtype = "text" | "checkbox" | "radio" | "dropdown" | "signature";

/**
 * Creation palette for the form-field tool. Richer than FieldType: some kinds
 * map to the same PDF field type with different presets (multiline → text with
 * properties.multiline, date → text with format.type "date", radio_group →
 * N radio widgets sharing one fieldName).
 */
export type FieldCreationKind =
  | "text"
  | "multiline"
  | "date"
  | "checkbox"
  | "radio_group"
  | "dropdown"
  | "listbox";
