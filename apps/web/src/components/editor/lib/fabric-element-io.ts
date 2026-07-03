"use client";

/**
 * fabric-element-io.ts
 *
 * Pure helpers used by the editor (`editor-canvas.tsx`, mounted both standalone
 * and embedded in the continuous Word-like view):
 *
 *   - fabricObjectToElement : serialise a Fabric object back to an Element for
 *     persistence (the inverse of the overlay renderer).
 *   - sampleBackgroundUnder : sample the rasterised PDF background colour under
 *     a text object (to mask the original glyph during inline edit).
 *   - parseColorToRgb       : CSS colour → [r,g,b] tuple.
 *
 * Extracted verbatim from editor-canvas.tsx so the single-page editor and the
 * continuous editor produce byte-identical results — one implementation, no
 * drift. None of these depend on React/component state.
 */

import type { FabricObject } from "fabric";
import type {
  Element,
  ShapeType,
  FieldType,
  AnnotationElement,
  FormFieldElement,
  TextElement,
  TextListStyle,
  TextStyle,
} from "@giga-pdf/types";
// Shared run<->Fabric-styles mapping (single source of truth with
// render-elements.ts) so character-level styling round-trips identically.
import { fabricStylesToRuns, type FabricStylesMap } from "./text-runs";
// Single source of truth for the text-baseline geometry, shared with the
// forward transform in render-elements.ts (was a bare `0.22` copied here).
import { boundsYFromBaselineTop } from "./text-baseline";
// Shared list/indent marker composition (single source of truth with
// render-elements.ts) so the decorative marker prefix is stripped back off
// IDENTICALLY to how it was prepended.
import {
  leftIndentOffset,
  stripDisplayText,
  unshiftStylesForMarker,
} from "./list-format";
// Comb (PEIGNE) field constraint: never persist more characters than there are
// cells, so the next overlay re-lays the value across exactly `maxLength` boxes.
import { clampCombValue } from "./comb-layout";

/** Fabric object carrying our custom `.data` metadata. */
export interface FabricObjectWithData extends FabricObject {
  data?: { elementId?: string; [key: string]: unknown };
}

/** Génère un ID unique. */
export function generateId(): string {
  return `el_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Le poids de police peut arriver en mot-clé CSS (bold/normal) ou en
// nombre CSS (400/600/700…). Normalise les deux conventions : toute valeur
// numérique ≥ 600 compte comme bold (semi-bold et au-delà).
export function isBoldFontWeight(weight: string | number | undefined): boolean {
  if (typeof weight === "number") return weight >= 600;
  if (!weight) return false;
  if (weight === "bold" || weight === "bolder") return true;
  const numeric = Number.parseInt(weight, 10);
  return Number.isFinite(numeric) && numeric >= 600;
}

/**
 * Lit la VALEUR courante d'un champ de formulaire éditable depuis l'objet
 * Fabric qui le matérialise, pour que la saisie utilisateur soit persistée :
 *
 *   - text / dropdown (saisie libre) : le texte tapé dans l'IText (`obj.text`),
 *     en ignorant le placeholder affiché quand le champ est vide.
 *   - checkbox / radio : l'état coché stocké sur `data.fieldChecked` (togglé au
 *     clic), normalisé selon le type (`boolean` pour checkbox, valeur d'option
 *     ou "" pour radio).
 *   - listbox / signature / button : valeur d'origine inchangée (édités
 *     ailleurs, pas au clavier sur le canvas).
 *
 * Le `value` du FormFieldElement est typé `string | boolean | string[]`.
 */
export function readFormFieldValue(
  obj: FabricObjectWithData,
  field: FormFieldElement,
): FormFieldElement["value"] {
  const fieldType = field.fieldType;

  if (fieldType === "checkbox") {
    const checked = obj.data?.fieldChecked === true;
    // A checkbox widget with a NAMED on-state (multi-widget Oui/non pairs on
    // CERFA forms) serialises its export STRING — a boolean would collapse the
    // pair to "checked/unchecked" and lose WHICH state was picked. The bake
    // side routes such strings through `setCheckboxState` (per-widget /AS).
    const onValue = field.onValue;
    if (typeof onValue === "string" && onValue.length > 0) {
      return checked ? onValue : "";
    }
    return checked;
  }

  if (fieldType === "radio") {
    // A checked radio carries its export value (the selected option); unchecked
    // radios serialise back to "" so the group has at most one value.
    if (obj.data?.fieldChecked === true) {
      const exportValue = obj.data?.fieldExportValue;
      if (typeof exportValue === "string" && exportValue.length > 0) {
        return exportValue;
      }
      const firstOption = field.options?.[0];
      return typeof firstOption === "string" ? firstOption : "";
    }
    return "";
  }

  if (fieldType === "text" || fieldType === "dropdown") {
    const textObj = obj as FabricObjectWithData & { text?: string };
    const typed = textObj.text ?? "";
    // The IText shows the placeholder text when the field is empty; never
    // persist the placeholder as a real value.
    const placeholder = obj.data?.fieldPlaceholder;
    if (typeof placeholder === "string" && typed === placeholder) {
      return "";
    }
    // Comb fields can never hold more characters than they have cells — clamp on
    // the way back so the value re-flows across exactly `maxLength` boxes.
    if (field.properties?.comb) {
      return clampCombValue(typed, field.properties.maxLength);
    }
    return typed;
  }

  // listbox / signature / button — keep the stored value untouched.
  return field.value;
}

/**
 * Convertit un objet Fabric en Element pour la persistance. Inverse exact du
 * renderer d'overlay (`render-elements.ts`). Retourne null pour un type inconnu.
 */
export function fabricObjectToElement(
  obj: FabricObjectWithData,
): Element | null {
  // A justified-run display FRAGMENT (render-elements paints one per segment for
  // 1:1 fidelity) is NOT a persisted element: the run is saved once via its own
  // index/binary, never per fragment. Serialising fragments would duplicate the
  // run and scramble its text — skip them here (the single serialisation seam).
  if (obj.data?.isRunSegment === true) return null;
  // A form-field full-rect HIT-TARGET (background Rect behind the value object)
  // is pure chrome: the field is serialised ONCE via its content object. Its
  // `elementId` is `hit:`-prefixed so element lookups never resolve it, and it
  // must never round-trip as an element of its own.
  if (obj.data?.isFieldHitTarget === true) return null;
  const elementId = obj.data?.elementId || generateId();
  const scaleY = obj.scaleY ?? 1;
  // A user resize bakes obj.scaleX into bounds.width here. There is no longer a
  // cosmetic anti-overflow scaleX to neutralise (the renderer no longer squashes
  // text to fit — see render-elements.ts), so scaleX is taken verbatim.
  const scaleX = obj.scaleX ?? 1;

  // Base element properties matching ElementBase interface
  const baseElement = {
    elementId,
    bounds: {
      x: obj.left || 0,
      y: obj.top || 0,
      width: (obj.width || 100) * scaleX,
      height: (obj.height || 100) * scaleY,
    },
    transform: {
      rotation: obj.angle || 0,
      scaleX: 1, // Already applied to bounds
      scaleY: 1,
      skewX: obj.skewX || 0,
      skewY: obj.skewY || 0,
    },
    layerId: null,
    locked: !obj.selectable,
    visible: obj.visible ?? true,
  };

  // Check object type using Fabric's `type` property (stable string).
  // We CANNOT use obj.constructor.name here — production bundlers minify
  // class names (IText becomes "t" in Turbopack output), so any check
  // against "IText"/"Rect"/etc. silently fails and fabricObjectToElement
  // returns null. The Fabric `type` getter returns the same string in
  // dev and prod ("i-text", "rect", "image", …) and is the canonical
  // way to discriminate Fabric object types.
  const typeName = (obj as FabricObject & { type?: string }).type ?? "";

  // Form fields FIRST — before the i-text/text branch. An editable form field
  // is rendered as an IText (text fields) or a marked Rect (checkbox/radio), so
  // `typeName` may be "i-text". Without this early guard, a text-field IText
  // would fall into the text branch below and be serialised as free `type:"text"`
  // — destroying its field identity (fieldType/fieldName/options) and breaking
  // the AcroForm reconstruction at bake time. `data.formFieldElement` is the
  // canonical full element (stashed at creation AND by renderElementsOverlay),
  // re-merged with the object's live bounds/transform so move/resize is honoured
  // without losing business props. The current VALUE is re-read from the live
  // Fabric object (typed text for text fields, checked state for check/radio)
  // so user input is actually persisted.
  const storedFormFieldEarly = obj.data?.formFieldElement as
    | FormFieldElement
    | undefined;
  if (storedFormFieldEarly && storedFormFieldEarly.type === "form_field") {
    const liveValue = readFormFieldValue(obj, storedFormFieldEarly);
    // WIDGET-RECT preservation: the value object's live bbox is NOT the widget
    // rect (a text-field IText is inset and CONTENT-sized — Fabric recomputes
    // its width from the text; a checkbox mark is glyph-sized). Persisting that
    // bbox would shrink the field's bounds on every save AND make the bake see
    // a "geometry change" (→ destructive redact + re-add instead of a fill).
    // The renderer stashes the widget rect + the object's initial anchor; the
    // persisted bounds are the STORED widget rect translated by the live drag
    // delta — an untouched field round-trips its rect exactly.
    const anchor0 = obj.data?.fieldAnchor0 as
      | { left: number; top: number }
      | undefined;
    const widgetBounds = obj.data?.fieldWidgetBounds as
      | { x: number; y: number; width: number; height: number }
      | undefined;
    const preservedBounds =
      anchor0 && widgetBounds
        ? {
            x: widgetBounds.x + ((obj.left ?? anchor0.left) - anchor0.left),
            y: widgetBounds.y + ((obj.top ?? anchor0.top) - anchor0.top),
            width: widgetBounds.width,
            height: widgetBounds.height,
          }
        : baseElement.bounds;
    return {
      ...storedFormFieldEarly,
      ...baseElement,
      bounds: preservedBounds,
      type: "form_field" as const,
      fieldType: storedFormFieldEarly.fieldType,
      value: liveValue,
    };
  }

  // A freetext ANNOTATION is rendered as an IText so its text is readable, but
  // it must round-trip as an annotation (the `data.annotationType` branch
  // below), NOT as a plain text element. Skip the text branch when the object
  // carries an `annotationType` marker so the annotation branch claims it.
  const carriesAnnotationMarker = typeof obj.data?.annotationType === "string";
  if (
    !carriesAnnotationMarker &&
    (typeName === "i-text" || typeName === "text" || typeName === "textbox")
  ) {
    const textObj = obj as FabricObjectWithData & {
      text?: string;
      fontSize?: number;
      fontFamily?: string;
      fontWeight?: string | number;
      fontStyle?: string;
      fill?: string;
      textAlign?: string;
      lineHeight?: number;
      charSpacing?: number;
      originY?: string;
    };
    const textObjWithStyles = textObj as typeof textObj & {
      underline?: boolean;
      linethrough?: boolean;
      textBackgroundColor?: string;
      styles?: FabricStylesMap;
    };
    const data = (obj as FabricObjectWithData).data;
    const fontSize = textObj.fontSize || 16;
    // Word-like list/indent: recover the paragraph's list style + left indent
    // stashed by the renderer. The displayed text carries a decorative marker
    // prefix (`listMarkerLen` chars) that is NOT part of the model `content` —
    // strip it back off here so persistence stays clean and `replaceText`
    // round-trips losslessly. Absent ⇒ no list, `markerLen` 0, content as-is.
    const listStyle =
      (data?.listStyle as TextListStyle | null | undefined) ?? null;
    const indentLeft = (data?.indentLeft as number | undefined) ?? 0;
    const { content: cleanContent, prefixLen: strippedLen } = stripDisplayText(
      textObj.text || "",
      { list: listStyle ?? undefined },
    );
    // Word-like partial formatting: read Fabric's native per-character styles
    // map back into our flat, coalesced model runs. `undefined` when the text
    // is uniformly styled — the `runs` field is then omitted (legacy shape).
    // Unshift the styles map by the (actually-stripped) marker length so the
    // run indices realign with the clean `content` (marker styling is dropped).
    const styleRuns = fabricStylesToRuns(
      cleanContent,
      unshiftStylesForMarker(textObjWithStyles.styles ?? {}, strippedLen),
    );

    // Inverse of the renderer transform (baselineTopFromBoundsY): Fabric IText
    // was created with top = bounds.y + fontSize + descenderOffset and
    // originY = 'bottom', so the PDF baseline = top - descenderOffset =
    // bounds.y + fontSize. Recover the original bounds.y (= glyph top in browser
    // coords) via the shared single-source geometry; for originY='top' there is
    // no baseline offset.
    const isOriginYBottom = textObj.originY === "bottom";
    const topOfGlyphY = boundsYFromBaselineTop(
      obj.top || 0,
      fontSize,
      isOriginYBottom,
    );
    // The renderer shifted `left` right by the combined indent (explicit
    // indentLeft + one step per list level). Recover the original bounds.x by
    // subtracting the SAME offset, so a list/indented run keeps its in-place
    // identity (no creeping rightward drift on each save round-trip).
    const indentOffsetX = leftIndentOffset({
      indentLeft,
      list: listStyle ?? undefined,
    });
    const originLeftX = (obj.left || 0) - indentOffsetX;

    // Preserve the parser-extracted PDF font name so the bake side
    // (apply-elements -> updateText -> font lookup) can re-use the
    // SAME font as the original glyph instead of falling back to a
    // generic Arial. The Fabric fontFamily ("gigapdf-…") is only valid
    // in the browser FontFace registry, never on the server-side
    // pdf-engine, so we must hand back originalFont separately.
    const originalFont = (data?.originalFont as string | null) ?? null;
    const fontFamilyForRoundTrip =
      originalFont || textObj.fontFamily || "Arial";

    return {
      ...baseElement,
      // Top-left corner of the glyph bbox in browser coords. height = fontSize
      // covers approximately ascender+descender — close enough to mask the
      // glyph cleanly without bleeding into the line above/below.
      bounds: {
        x: originLeftX,
        y: topOfGlyphY,
        width: (obj.width || 100) * scaleX,
        height: fontSize,
      },
      type: "text" as const,
      content: cleanContent,
      // Character-level style runs (Word-like partial formatting). Omitted
      // (spread of {}) when the text is uniformly styled, so the serialised
      // shape is byte-identical to the legacy one for unstyled runs.
      ...(styleRuns ? { runs: styleRuns } : {}),
      style: {
        fontFamily: fontFamilyForRoundTrip,
        fontSize,
        // Numeric CSS weights (600/700) must round-trip as "bold" too —
        // applyTextFormat and parsed PDFs can both produce them.
        fontWeight: isBoldFontWeight(textObj.fontWeight) ? "bold" : "normal",
        fontStyle: textObj.fontStyle === "italic" ? "italic" : "normal",
        color: (textObj.fill as string) || "#000000",
        opacity: obj.opacity ?? 1,
        textAlign:
          (textObj.textAlign as "left" | "center" | "right" | "justify") ||
          "left",
        lineHeight: textObj.lineHeight || 1.2,
        letterSpacing: textObj.charSpacing || 0,
        writingMode: "horizontal-tb" as const,
        underline: textObjWithStyles.underline || false,
        strikethrough: textObjWithStyles.linethrough || false,
        backgroundColor: textObjWithStyles.textBackgroundColor || null,
        verticalAlign: "baseline" as const,
        originalFont,
        // Word-like list / indentation (additive). Omitted (spread of {}) when
        // not a list / no indent, so the serialised shape stays byte-identical
        // to the legacy one for plain paragraphs.
        ...(listStyle ? { list: listStyle } : {}),
        ...(indentLeft > 0 ? { indentLeft } : {}),
      },
      ocrConfidence: null,
      linkUrl: (data?.linkUrl as string) || null,
      linkPage: (data?.linkPage as number) || null,
      // Carry the ORIGINAL engine run index (stamped onto data by the
      // renderer for parsed runs) so an edited text run keeps its in-place
      // identity: apply-operations uses it to fire replaceText/moveElement
      // instead of redact+add. Never regenerated — newly-added text has no
      // index in data, so this stays undefined and falls back to add.
      index: data?.index as number | undefined,
    };
  }

  if (typeName === "image") {
    const imgObj = obj as FabricObjectWithData & {
      getSrc?: () => string;
      width?: number;
      height?: number;
      scaleX?: number;
      scaleY?: number;
    };
    const rawSrc = imgObj.getSrc?.() ?? "";
    // Sniff the actual mimetype from the data URL prefix so the backend
    // can pick the right embed path (pdf-lib only handles PNG and JPEG;
    // anything else must be flagged here, not silently mislabelled "png"
    // and re-detected by header bytes downstream).
    const mimeMatch = rawSrc.match(
      /^data:image\/(png|jpe?g|webp|gif|avif);base64,/i,
    );
    const detected = mimeMatch?.[1]?.toLowerCase().replace("jpeg", "jpg");
    const originalFormat: string = detected ?? "png";
    // A PARSED image overlay is displayed as an opacity-0 hit-target (the
    // text-free raster shows it); persisting that 0 would make the image VANISH
    // from the PDF on the first move/resize. Prefer the real opacity stashed on
    // `data.originalOpacity` (mirrors the shape `data.originalFill` decoupling);
    // a newly-added image has none → fall back to the live opacity.
    const stashedOpacity = obj.data?.originalOpacity;
    const resolvedOpacity =
      typeof stashedOpacity === "number" ? stashedOpacity : (obj.opacity ?? 1);
    return {
      ...baseElement,
      type: "image" as const,
      source: {
        type: "embedded" as const,
        dataUrl: rawSrc,
        originalFormat,
        originalDimensions: {
          width: imgObj.width || 100,
          height: imgObj.height || 100,
        },
      },
      style: {
        opacity: resolvedOpacity,
        blendMode: "normal" as const,
      },
      crop: null,
      // Carry the ORIGINAL engine unified element index (stamped on data by the
      // renderer for parsed images) so a moved/resized image keeps its in-place
      // identity: apply-operations fires transformElement/removeElement instead
      // of redact+add. Newly-added images have no index → stays undefined → add.
      index: obj.data?.index as number | undefined,
    };
  }

  // Annotations are stored as Fabric Rect/Line/Circle but carry a
  // data.annotationType marker. If we returned them as "shape" they'd
  // be drawn as regular graphics and the /Annot dict would never be
  // created — annotations must come out as AnnotationElement so the
  // backend renderer produces real PDF annotations (highlight,
  // underline, sticky note, freetext…).
  const dataAnnotationType = (obj.data?.annotationType ?? null) as
    | null
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
  if (dataAnnotationType) {
    const isLineLike =
      dataAnnotationType === "line" || dataAnnotationType === "arrow";
    // A freetext annotation is rendered as an editable IText: its live text is
    // the canonical content (so a typed edit persists). Other annotation types
    // keep their stashed `data.content`.
    const liveText = (obj as FabricObjectWithData & { text?: string }).text;
    const annotationContent =
      dataAnnotationType === "freetext" && typeof liveText === "string"
        ? liveText
        : ((obj.data?.content as string) ?? "");
    return {
      ...baseElement,
      type: "annotation" as const,
      annotationType: dataAnnotationType,
      content: annotationContent,
      style: {
        color: (obj.stroke as string) || (obj.fill as string) || "#ffff00",
        opacity: obj.opacity ?? 1,
        // strokeWidth drives the line/arrow thickness in the PDF annotation.
        ...(isLineLike
          ? {
              strokeWidth:
                (obj.data?.strokeWidth as number) ??
                (obj.strokeWidth as number) ??
                2,
            }
          : {}),
      },
      linkDestination:
        (obj.data?.linkDestination as AnnotationElement["linkDestination"]) ??
        null,
      popup: null,
      author: (obj.data?.author as string) ?? undefined,
      // For line/arrow, explicit endpoints when present; otherwise the
      // backend renderer falls back to the diagonal of `bounds`.
      ...(isLineLike && obj.data?.linePoints
        ? { linePoints: obj.data.linePoints as AnnotationElement["linePoints"] }
        : {}),
      // quads is omitted — renderer falls back to bounds when undefined
    } as AnnotationElement;
  }

  // Form fields carrying `data.formFieldElement` are already handled by the
  // early guard at the top of this function (before the i-text branch), so an
  // editable text-field IText is serialised as a field, never as free text.

  if (["rect", "circle", "triangle", "ellipse", "line"].includes(typeName)) {
    let shapeTypeResult: ShapeType = "rectangle";
    if (typeName === "circle") shapeTypeResult = "circle";
    if (typeName === "ellipse") shapeTypeResult = "ellipse";
    if (typeName === "line") shapeTypeResult = "line";
    if (typeName === "triangle") shapeTypeResult = "triangle";

    // Parsed shapes are TRANSPARENT hit-targets in view (the raster shows the
    // real shape) and only reveal their real fill/stroke while selected. So
    // prefer the originals stashed on `data.*` — `obj.fill`/`obj.stroke` are
    // "transparent" whenever the shape is currently masked (not selected),
    // which would otherwise bake "transparent" into the PDF on save/move.
    // Newly-drawn shapes have no `data.original*` → fall back to the live value.
    const liveFill = (obj.fill as string) || null;
    const liveStroke = (obj.stroke as string) || null;
    const isMasked = (v: string | null) => v === null || v === "transparent";
    const stashedFill = obj.data?.originalFill;
    const stashedStroke = obj.data?.originalStroke;
    const stashedStrokeWidth = obj.data?.originalStrokeWidth;
    const resolvedFill =
      isMasked(liveFill) && typeof stashedFill === "string"
        ? stashedFill
        : liveFill;
    const resolvedStroke =
      isMasked(liveStroke) && typeof stashedStroke === "string"
        ? stashedStroke
        : liveStroke;
    const resolvedStrokeWidth =
      (!obj.strokeWidth || obj.strokeWidth === 0) &&
      typeof stashedStrokeWidth === "number" &&
      stashedStrokeWidth > 0
        ? stashedStrokeWidth
        : obj.strokeWidth || 1;

    return {
      ...baseElement,
      type: "shape" as const,
      shapeType: shapeTypeResult,
      geometry: {
        points: [],
        pathData: null,
        cornerRadius: 0,
      },
      style: {
        fillColor: resolvedFill,
        fillOpacity: obj.opacity ?? 1,
        strokeColor: resolvedStroke,
        strokeWidth: resolvedStrokeWidth,
        strokeOpacity: 1,
        strokeDashArray: [],
      },
      // Carry the ORIGINAL engine unified element index (stamped on data by the
      // renderer for parsed shapes) so a moved/resized shape keeps its in-place
      // identity: apply-operations fires transformElement/removeElement instead
      // of redact+add. Newly-added shapes have no index → stays undefined → add.
      index: obj.data?.index as number | undefined,
    };
  }

  // Fallback legacy : Groups créés avant l'introduction de
  // data.formFieldElement (dont la zone de signature du draw tool).
  if (obj.data?.formFieldType) {
    const ft = obj.data.formFieldType as FieldType;
    const isBooleanField = ft === "checkbox";
    const isRadioField = ft === "radio";
    const isListField = ft === "dropdown" || ft === "listbox";
    return {
      ...baseElement,
      type: "form_field" as const,
      fieldType: ft,
      fieldName: (obj.data.fieldName as string) ?? `${ft}_${Date.now()}`,
      value: isBooleanField
        ? false
        : isRadioField
          ? ((obj.data.exportValue as string) ?? "")
          : isListField
            ? []
            : "",
      defaultValue: isBooleanField ? false : isListField ? [] : "",
      options:
        isListField || isRadioField
          ? ((obj.data.options as string[]) ?? (isListField ? [] : null))
          : null,
      properties: {
        required: Boolean(obj.data.required),
        readOnly: false,
        maxLength: null,
        multiline: Boolean(obj.data.multiline),
        password: false,
        comb: false,
      },
      style: {
        fontFamily: "Arial",
        fontSize: 12,
        textColor: "#000000",
        backgroundColor: "#ffffff",
        borderColor: "#cccccc",
        borderWidth: 1,
      },
      format: { type: "none" as const, pattern: null },
      placeholder: (obj.data.placeholder as string) || null,
      tooltip: null,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Paragraph (multi-line Textbox) decomposition for save
// ---------------------------------------------------------------------------

/** A source run snapshot stashed on a paragraph Textbox's `data.paragraphRuns`. */
interface StashedParagraphRun {
  elementId: string;
  index?: number;
  bounds: { x: number; y: number; width: number; height: number };
  content: string;
}

/**
 * Minimal Fabric text shape we read style off when decomposing a Textbox. `fill`
 * is NOT redeclared (it is inherited from FabricObject as `string | TFiller |
 * null`); we read it through a cast at the use site, like fabricObjectToElement.
 */
interface FabricTextLike extends FabricObjectWithData {
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string | number;
  fontStyle?: string;
  textAlign?: string;
  lineHeight?: number;
  charSpacing?: number;
  underline?: boolean;
  linethrough?: boolean;
}

/**
 * Build a single-line TextElement for one decomposed paragraph line. Style is
 * read from the LIVE Textbox (so a colour/size/weight change made on the block
 * applies to every line); `originalFont`, `elementId`, engine `index` and the
 * source `bounds` are inherited from the source run so the apply pipeline keeps
 * the run's in-place identity (`replaceText`). `dx`/`dy` translate the run if the
 * whole block was moved. A line with no source run (paragraph grew) gets a fresh
 * id, no index (→ add) and a synthesised bounds stacked under the previous line.
 */
function lineToTextElement(
  tb: FabricTextLike,
  content: string,
  source: StashedParagraphRun | null,
  fallbackBounds: { x: number; y: number; width: number; height: number },
  dx: number,
  dy: number,
): TextElement {
  const fontSize = tb.fontSize || source?.bounds.height || 12;
  const originalFont = (tb.data?.originalFont as string | null) ?? null;
  const fontFamilyForRoundTrip = originalFont || tb.fontFamily || "Arial";
  const bounds = source
    ? {
        x: source.bounds.x + dx,
        y: source.bounds.y + dy,
        width: source.bounds.width,
        height: fontSize,
      }
    : { ...fallbackBounds };

  const style: TextStyle = {
    fontFamily: fontFamilyForRoundTrip,
    fontSize,
    fontWeight: isBoldFontWeight(tb.fontWeight) ? "bold" : "normal",
    fontStyle: tb.fontStyle === "italic" ? "italic" : "normal",
    color: (tb.fill as string) || "#000000",
    opacity: tb.opacity ?? 1,
    textAlign:
      (tb.textAlign as "left" | "center" | "right" | "justify") || "left",
    lineHeight: tb.lineHeight || 1.2,
    letterSpacing: tb.charSpacing || 0,
    writingMode: "horizontal-tb",
    underline: tb.underline || false,
    strikethrough: tb.linethrough || false,
    backgroundColor: null,
    verticalAlign: "baseline",
    originalFont,
  };

  return {
    elementId: source?.elementId || generateId(),
    type: "text",
    bounds,
    transform: {
      rotation: tb.angle || 0,
      scaleX: 1,
      scaleY: 1,
      skewX: tb.skewX || 0,
      skewY: tb.skewY || 0,
    },
    layerId: null,
    locked: !tb.selectable,
    visible: tb.visible ?? true,
    content,
    style,
    ocrConfidence: null,
    linkUrl: null,
    linkPage: null,
    // Source run index → lossless replaceText; undefined for added lines → add.
    ...(source?.index !== undefined ? { index: source.index } : {}),
  };
}

/**
 * Serialise a Fabric object to the Element(s) to persist. The INVERSE of the
 * overlay renderer, but able to emit MORE THAN ONE element so a coalesced
 * paragraph (multi-line {@link import("../render-elements").ParagraphGroup}
 * Textbox) is DECOMPOSED back into its individual single-line runs on save.
 *
 * Why decompose: the bake pipeline (`addText`/`replaceText`) writes ONE run per
 * call and gives no line-break semantics to a "\n" inside `content`. Persisting
 * a paragraph as one multi-line TextElement would therefore drop every line but
 * the first. We instead map the edited lines back onto the source runs:
 *
 *   - line i ↔ source run i  → run keeps its `index`/`elementId`/`bounds`
 *     (in-place `replaceText`), with the current line text + the live block
 *     style, translated by the block's move delta;
 *   - fewer lines than runs (lines deleted) → surplus runs serialise with
 *     `content:""` so `replaceText` erases them;
 *   - more lines than runs (lines added)    → extra lines become NEW runs
 *     (no `index` → add), stacked under the last line at the block's line step.
 *
 * Any non-paragraph object returns a single-element array (or empty for an
 * unknown type), so existing 1:1 callers keep their exact behaviour.
 */
export function fabricObjectToElements(obj: FabricObjectWithData): Element[] {
  const data = obj.data;
  const typeName = (obj as FabricObject & { type?: string }).type ?? "";
  const isTextual =
    typeName === "i-text" || typeName === "text" || typeName === "textbox";
  const runs = data?.paragraphRuns as StashedParagraphRun[] | undefined;

  // A form field can NEVER take a paragraph path (its widget identity would be
  // destroyed): route it straight to the canonical single-element serialiser
  // (which claims it via the `formFieldElement` early guard).
  const isFormField =
    data?.formFieldElement !== undefined || data?.formFieldType !== undefined;

  // A PARAGRAPH EDIT SESSION box (edit-intent model) maps its edited lines back
  // onto the per-line SOURCE runs via commitParagraphSession — line i ↔ source
  // line i, first run carries the full line text, siblings are erased. This
  // generic path only ever sees session moves / no-reflow edits (the editor's
  // session-exit handler owns the reflow seam — removes + adds); a reflow
  // arriving here falls through to the legacy flat decomposition below (never
  // duplicates, at worst line↔run instead of line↔line).
  if (
    !isFormField &&
    data?.isParagraphSession === true &&
    isTextual &&
    Array.isArray(data?.lineRuns)
  ) {
    const commit = commitParagraphSession(obj);
    if (commit.kind === "unchanged") return [];
    if (commit.kind === "update") return commit.elements;
    // kind === "reflow" → legacy fallthrough below.
  }

  // Not a coalesced paragraph → keep the canonical 1:1 behaviour.
  if (
    isFormField ||
    data?.isParagraph !== true ||
    !isTextual ||
    !Array.isArray(runs) ||
    runs.length === 0
  ) {
    const single = fabricObjectToElement(obj);
    return single ? [single] : [];
  }

  const tb = obj as FabricTextLike;
  const editedLines = (tb.text ?? "").split("\n");

  // Block move delta: source block top-left vs the Textbox's current top-left.
  const originLeft = Math.min(...runs.map((r) => r.bounds.x));
  const originTop = Math.min(...runs.map((r) => r.bounds.y));
  const dx = (obj.left ?? originLeft) - originLeft;
  const dy = (obj.top ?? originTop) - originTop;

  const fontSize = tb.fontSize || runs[0]!.bounds.height || 12;
  const lineHeight = tb.lineHeight && tb.lineHeight > 0 ? tb.lineHeight : 1.2;
  const lineStep = fontSize * lineHeight;
  const blockWidth = (tb.width || runs[0]!.bounds.width) * (tb.scaleX ?? 1);

  const out: Element[] = [];
  const lastSource = runs[runs.length - 1]!;

  // 1) Every edited line maps onto its source run (or becomes a new run).
  for (let i = 0; i < editedLines.length; i++) {
    const source = i < runs.length ? runs[i]! : null;
    // New line (paragraph grew): stack it under the last source line.
    const fallbackBounds = {
      x: lastSource.bounds.x + dx,
      y: lastSource.bounds.y + dy + (i - (runs.length - 1)) * lineStep,
      width: blockWidth,
      height: fontSize,
    };
    out.push(
      lineToTextElement(tb, editedLines[i]!, source, fallbackBounds, dx, dy),
    );
  }

  // 2) Lines were deleted: erase the surplus source runs (replaceText "").
  for (let i = editedLines.length; i < runs.length; i++) {
    const source = runs[i]!;
    const fallbackBounds = {
      x: source.bounds.x + dx,
      y: source.bounds.y + dy,
      width: source.bounds.width,
      height: fontSize,
    };
    out.push(lineToTextElement(tb, "", source, fallbackBounds, dx, dy));
  }

  return out;
}

// ---------------------------------------------------------------------------
// Paragraph EDIT-SESSION commit (edit-intent model)
// ---------------------------------------------------------------------------

/**
 * One stashed source run of a paragraph edit session (`data.lineRuns[i][j]`,
 * written by render-elements' beginParagraphEditSession). `style` snapshots the
 * run's FULL parsed style so erase/move emissions keep the run's own typography
 * — a style mismatch would silently downgrade the apply pipeline's lossless
 * `replaceText`/`moveElement` to the destructive redact+add.
 */
export interface SessionLineRunSnapshot {
  elementId: string;
  index?: number;
  bounds: { x: number; y: number; width: number; height: number };
  content: string;
  style?: TextStyle;
}

/** The outcome of exiting a paragraph edit session. */
export type ParagraphSessionCommit =
  | { kind: "unchanged" }
  | {
      /** Same line count: per-line in-place updates (replace / erase / move). */
      kind: "update";
      elements: Element[];
    }
  | {
      /**
       * Line count changed (Enter / line join / wrap): every source run of the
       * group is REMOVED (`removeElement`, ordered by apply-operations) and one
       * NEW run is ADDED per re-wrapped line, stacked from the session box top
       * at `fontSize × lineHeight`, sized to the session frame width.
       */
      kind: "reflow";
      removedElementIds: string[];
      addedElements: Element[];
    };

/** Positional/typographic session-box fields read by the commit. */
interface SessionTextbox extends FabricTextLike {
  textLines?: string[];
  styles?: Record<number, Record<number, Record<string, unknown>>>;
  _styleMap?: Record<number, { line: number; offset: number }>;
}

/**
 * Build ONE element for a session source run: the run keeps its OWN elementId,
 * engine `index`, bounds (translated by the block move delta) and full stashed
 * style — only `content` changes. This is what routes the apply pipeline to the
 * lossless in-place ops for every untouched typographic property.
 */
function sessionRunToElement(
  tb: SessionTextbox,
  run: SessionLineRunSnapshot,
  content: string,
  dx: number,
  dy: number,
): TextElement {
  const fontSize = run.style?.fontSize ?? tb.fontSize ?? 12;
  const style: TextStyle = run.style
    ? { ...run.style }
    : {
        fontFamily:
          ((tb.data?.originalFont as string | null) ?? tb.fontFamily) ||
          "Arial",
        fontSize,
        fontWeight: isBoldFontWeight(tb.fontWeight) ? "bold" : "normal",
        fontStyle: tb.fontStyle === "italic" ? "italic" : "normal",
        color: (tb.fill as string) || "#000000",
        opacity: tb.opacity ?? 1,
        textAlign:
          (tb.textAlign as "left" | "center" | "right" | "justify") || "left",
        lineHeight: tb.lineHeight || 1.2,
        letterSpacing: tb.charSpacing || 0,
        writingMode: "horizontal-tb",
        underline: tb.underline || false,
        strikethrough: tb.linethrough || false,
        backgroundColor: null,
        verticalAlign: "baseline",
        originalFont: (tb.data?.originalFont as string | null) ?? null,
      };
  return {
    elementId: run.elementId,
    type: "text",
    bounds: {
      x: run.bounds.x + dx,
      y: run.bounds.y + dy,
      width: run.bounds.width,
      height: run.bounds.height,
    },
    transform: {
      rotation: tb.angle || 0,
      scaleX: 1,
      scaleY: 1,
      skewX: tb.skewX || 0,
      skewY: tb.skewY || 0,
    },
    layerId: null,
    locked: false,
    visible: tb.visible ?? true,
    content,
    style,
    ocrConfidence: null,
    linkUrl: null,
    linkPage: null,
    ...(run.index !== undefined ? { index: run.index } : {}),
  };
}

/**
 * The dominant style of ONE re-wrapped visual line, for a reflow's added runs.
 * Reads Fabric's per-character `styles` map through the Textbox `_styleMap`
 * (visual line → logical line + char offset) and takes the MAJORITY of
 * fontSize / colour / weight / slant over the line's characters; every lookup
 * is defensive and falls back to the live box's base style. The font FAMILY
 * always stays the box's round-trip family (a per-char browser FontFace name
 * cannot be inverted to a PDF font name).
 */
function dominantSessionLineStyle(
  tb: SessionTextbox,
  visualLineIndex: number,
  lineLength: number,
): TextStyle {
  const originalFont = (tb.data?.originalFont as string | null) ?? null;
  const base: TextStyle = {
    fontFamily: (originalFont ?? tb.fontFamily) || "Arial",
    fontSize: tb.fontSize || 12,
    fontWeight: isBoldFontWeight(tb.fontWeight) ? "bold" : "normal",
    fontStyle: tb.fontStyle === "italic" ? "italic" : "normal",
    color: (tb.fill as string) || "#000000",
    opacity: tb.opacity ?? 1,
    textAlign:
      (tb.textAlign as "left" | "center" | "right" | "justify") || "left",
    lineHeight: tb.lineHeight || 1.2,
    letterSpacing: tb.charSpacing || 0,
    writingMode: "horizontal-tb",
    underline: tb.underline || false,
    strikethrough: tb.linethrough || false,
    backgroundColor: null,
    verticalAlign: "baseline",
    originalFont,
  };
  const styles = tb.styles;
  if (!styles || lineLength <= 0) return base;
  const mapEntry = tb._styleMap?.[visualLineIndex];
  const logicalLine = mapEntry?.line ?? visualLineIndex;
  const offset = mapEntry?.offset ?? 0;
  const lineStyles = styles[logicalLine];
  if (!lineStyles) return base;

  const votes = new Map<string, { count: number; style: Record<string, unknown> }>();
  for (let c = offset; c < offset + lineLength; c += 1) {
    const s = lineStyles[c];
    if (!s || typeof s !== "object") continue;
    const key = JSON.stringify([
      s.fontSize ?? null,
      s.fill ?? null,
      s.fontWeight ?? null,
      s.fontStyle ?? null,
    ]);
    const entry = votes.get(key);
    if (entry) entry.count += 1;
    else votes.set(key, { count: 1, style: s });
  }
  if (votes.size === 0) return base;
  const winner = [...votes.values()].sort((a, b) => b.count - a.count)[0]!;
  // Majority only when it covers > half the line — otherwise keep the base.
  if (winner.count <= lineLength / 2) return base;
  const s = winner.style;
  return {
    ...base,
    ...(typeof s.fontSize === "number" ? { fontSize: s.fontSize } : {}),
    ...(typeof s.fill === "string" ? { color: s.fill } : {}),
    ...(s.fontWeight !== undefined
      ? { fontWeight: isBoldFontWeight(s.fontWeight as string | number) ? "bold" : "normal" }
      : {}),
    ...(s.fontStyle !== undefined
      ? { fontStyle: s.fontStyle === "italic" ? "italic" : "normal" }
      : {}),
  } as TextStyle;
}

/**
 * Map a paragraph edit session's live Textbox back onto its SOURCE runs — the
 * pure decision + construction of the edit-intent commit:
 *
 *   - UNCHANGED (text identical to the session baseline, box not moved) →
 *     `{kind:"unchanged"}` — the caller restores the per-run objects, ZERO
 *     writes;
 *   - SAME LINE COUNT → `{kind:"update"}`: line i ↔ source line i. A CHANGED
 *     line puts its full new text on the line's FIRST run (`replaceText`) and
 *     erases the siblings (`content:""`); an UNCHANGED line is skipped
 *     entirely (zero write) unless the block moved, in which case its runs are
 *     emitted verbatim with translated bounds (pure `moveElement`);
 *   - LINE COUNT CHANGED (Enter / join / wrap at the frame width) →
 *     `{kind:"reflow"}`: every source run is removed and one new run is added
 *     per re-wrapped VISUAL line (Fabric's `textLines`), stacked from the box
 *     top at `fontSize × lineHeight`, each with the line's dominant style.
 *
 * Pure & deterministic — reads only the live object + the session snapshot.
 */
export function commitParagraphSession(
  obj: FabricObjectWithData,
): ParagraphSessionCommit {
  const data = obj.data;
  const tb = obj as SessionTextbox;
  const lineRuns = data?.lineRuns as SessionLineRunSnapshot[][] | undefined;
  if (!Array.isArray(lineRuns) || lineRuns.length === 0) {
    return { kind: "unchanged" };
  }
  const origin = (data?.sessionOrigin as
    | { left: number; top: number }
    | undefined) ?? { left: obj.left ?? 0, top: obj.top ?? 0 };
  const baseline: string[] = Array.isArray(data?.sessionLineTexts)
    ? (data!.sessionLineTexts as string[])
    : typeof data?.sessionOriginalText === "string"
      ? (data.sessionOriginalText as string).split("\n")
      : lineRuns.map((line) => line.map((r) => r.content).join(" "));

  const dx = (obj.left ?? origin.left) - origin.left;
  const dy = (obj.top ?? origin.top) - origin.top;
  const moved = Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01;

  const logicalLines = (tb.text ?? "").split("\n");
  const textChanged =
    logicalLines.length !== baseline.length ||
    logicalLines.some((l, i) => l !== baseline[i]);

  if (!textChanged && !moved) return { kind: "unchanged" };

  // Visual (wrapped) lines — only trusted when Fabric exposes them.
  const visualLines =
    Array.isArray(tb.textLines) && tb.textLines.length > 0
      ? tb.textLines
      : logicalLines;

  // NO REFLOW: the logical line count still matches the source lines AND no
  // line wrapped past the frame width (visual === logical).
  const noReflow =
    logicalLines.length === lineRuns.length &&
    visualLines.length === logicalLines.length;

  if (noReflow) {
    const elements: Element[] = [];
    for (let i = 0; i < lineRuns.length; i += 1) {
      const line = lineRuns[i]!;
      if (line.length === 0) continue;
      const lineChanged = logicalLines[i] !== baseline[i];
      if (!lineChanged && !moved) continue; // untouched line — zero write
      if (lineChanged) {
        // Full new line text on the FIRST run; siblings erased.
        elements.push(
          sessionRunToElement(tb, line[0]!, logicalLines[i] ?? "", dx, dy),
        );
        for (let j = 1; j < line.length; j += 1) {
          elements.push(sessionRunToElement(tb, line[j]!, "", dx, dy));
        }
      } else {
        // Pure move: every run keeps its own content (→ moveElement).
        for (const run of line) {
          elements.push(sessionRunToElement(tb, run, run.content, dx, dy));
        }
      }
    }
    return { kind: "update", elements };
  }

  // REFLOW: remove every source run, add one run per re-wrapped visual line.
  const removedElementIds = lineRuns.flat().map((r) => r.elementId);
  const fontSize = tb.fontSize || 12;
  const lineHeight = tb.lineHeight && tb.lineHeight > 0 ? tb.lineHeight : 1.2;
  const lineStep = fontSize * lineHeight;
  const blockWidth =
    (tb.width || lineRuns[0]![0]?.bounds.width || 100) * (tb.scaleX ?? 1);
  const leftX = obj.left ?? origin.left;
  const topY = obj.top ?? origin.top;

  const addedElements: Element[] = visualLines.map((text, i) => ({
    elementId: generateId(),
    type: "text" as const,
    bounds: {
      x: leftX,
      y: topY + i * lineStep,
      width: blockWidth,
      height: fontSize,
    },
    transform: {
      rotation: tb.angle || 0,
      scaleX: 1,
      scaleY: 1,
      skewX: tb.skewX || 0,
      skewY: tb.skewY || 0,
    },
    layerId: null,
    locked: false,
    visible: tb.visible ?? true,
    content: text,
    style: dominantSessionLineStyle(tb, i, text.length),
    ocrConfidence: null,
    linkUrl: null,
    linkPage: null,
  }));

  return { kind: "reflow", removedElementIds, addedElements };
}

/**
 * Refresh the session snapshot on the box AFTER a commit was forwarded, so a
 * FOLLOW-UP edit (before the post-apply re-render replaces the canvas) maps
 * against the NEW baseline instead of re-committing the old delta:
 *
 *   - update → the changed lines' first runs now carry the full line text,
 *     their siblings "" (matching what was just baked); the baseline texts and
 *     the box origin are re-anchored;
 *   - reflow → the snapshot becomes ONE line per added run (no engine index —
 *     a further edit updates the freshly-added elements by elementId).
 */
export function refreshParagraphSessionAfterCommit(
  obj: FabricObjectWithData,
  commit: ParagraphSessionCommit,
): void {
  const data = obj.data;
  if (!data) return;
  const tb = obj as SessionTextbox;
  const logicalLines = (tb.text ?? "").split("\n");

  if (commit.kind === "update") {
    const lineRuns = data.lineRuns as SessionLineRunSnapshot[][] | undefined;
    if (Array.isArray(lineRuns)) {
      const baseline = Array.isArray(data.sessionLineTexts)
        ? (data.sessionLineTexts as string[])
        : [];
      lineRuns.forEach((line, i) => {
        const newText = logicalLines[i];
        if (newText === undefined || newText === baseline[i]) return;
        if (line[0]) line[0] = { ...line[0], content: newText };
        for (let j = 1; j < line.length; j += 1) {
          line[j] = { ...line[j]!, content: "" };
        }
      });
    }
  } else if (commit.kind === "reflow") {
    const added = commit.addedElements.filter(
      (el): el is Extract<Element, { type: "text" }> => el.type === "text",
    );
    data.lineRuns = added.map((el) => [
      {
        elementId: el.elementId,
        bounds: { ...el.bounds },
        content: el.content,
        style: { ...el.style },
      },
    ]);
    data.paragraphRuns = added.map((el) => ({
      elementId: el.elementId,
      bounds: { ...el.bounds },
      content: el.content,
    }));
  }

  data.sessionLineTexts = logicalLines;
  data.sessionOriginalText = tb.text ?? "";
  data.sessionOrigin = { left: obj.left ?? 0, top: obj.top ?? 0 };
}

/**
 * Échantillonne la couleur de fond (raster PDF) sous un objet texte, pour
 * masquer le glyphe original pendant l'édition inline. Retourne null si le
 * canvas est tainted (CORS) ou si aucun pixel exploitable.
 */
export function sampleBackgroundUnder(
  obj: FabricObject,
  textRgb?: [number, number, number] | null,
): string | null {
  const o = obj as unknown as {
    left?: number;
    top?: number;
    width?: number;
    height?: number;
    originY?: string;
    canvas?: { lowerCanvasEl?: HTMLCanvasElement; getZoom?: () => number };
  };
  const lower = o.canvas?.lowerCanvasEl;
  if (!lower) return null;
  const ctx = lower.getContext("2d");
  if (!ctx) return null;
  const zoom = o.canvas?.getZoom?.() ?? 1;
  const left = o.left ?? 0;
  const top = o.top ?? 0;
  const width = o.width ?? 0;
  const height = o.height ?? 0;
  // For text we use originY='bottom' (top = baseline). Translate to a
  // top-left bbox so the probes land in the right places.
  const topLeftY = o.originY === "bottom" ? top - height : top;

  // Probe a fan of points spread across:
  //   - the inside of the bbox (between glyphs we mostly hit the background)
  //   - the immediate edge (1-2 px out of the glyph but still inside any
  //     thin coloured band, e.g. the red "Somme à payer" banner)
  //   - the wider edge (4-6 px out, captures larger uniform areas)
  // We then drop pixels that match the text colour (so the glyph itself
  // doesn't contaminate the result) and pick the dominant remaining shade.
  const probes: Array<[number, number]> = [];
  // Inside bbox sweep
  for (let f = 0.1; f <= 0.9; f += 0.1) {
    probes.push([left + width * f, topLeftY + height * 0.5]);
  }
  // Top / bottom edges (just inside, then 2px and 5px outside)
  for (const dy of [-5, -2, 1, height - 1, height + 2, height + 5]) {
    probes.push([left + width * 0.5, topLeftY + dy]);
    probes.push([left + width * 0.25, topLeftY + dy]);
    probes.push([left + width * 0.75, topLeftY + dy]);
  }
  // Left / right edges
  for (const dx of [-5, -2, width + 2, width + 5]) {
    probes.push([left + dx, topLeftY + height * 0.5]);
  }

  const counts = new Map<string, number>();
  for (const [cx, cy] of probes) {
    const px = Math.round(cx * zoom);
    const py = Math.round(cy * zoom);
    if (px < 0 || py < 0 || px >= lower.width || py >= lower.height) continue;
    let pixel: Uint8ClampedArray;
    try {
      pixel = ctx.getImageData(px, py, 1, 1).data;
    } catch {
      return null; // tainted canvas (CORS) — cannot read
    }
    const r = pixel[0]!;
    const g = pixel[1]!;
    const b = pixel[2]!;
    // Skip pixels that match the text colour within ±20 — they are
    // glyph fragments, not background.
    if (textRgb) {
      const dr = Math.abs(r - textRgb[0]);
      const dg = Math.abs(g - textRgb[1]);
      const db = Math.abs(b - textRgb[2]);
      if (dr < 20 && dg < 20 && db < 20) continue;
    }
    // Quantize to 8-step buckets so anti-aliasing fringes vote together.
    // Math.round(255/8)*8 = 256 — clamp back into [0, 255] so the rgb()
    // string we forward to apply-elements stays in pdf-lib's valid range
    // (it rejects red/green/blue > 1.0 with a misleading 500).
    const qr = Math.min(255, Math.round(r / 8) * 8);
    const qg = Math.min(255, Math.round(g / 8) * 8);
    const qb = Math.min(255, Math.round(b / 8) * 8);
    const key = `${qr},${qg},${qb}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  const [winner] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
  const [r, g, b] = winner.split(",").map((n) => Number(n));
  return `rgb(${r}, ${g}, ${b})`;
}

// Parse a CSS colour string like '#ffffff' or 'rgb(255, 0, 0)' into rgb tuple.
// Returns null for unsupported formats — caller skips text-colour filtering.
export function parseColorToRgb(
  color: string | undefined | null,
): [number, number, number] | null {
  if (!color) return null;
  const c = color.trim().toLowerCase();
  if (c.startsWith("#")) {
    const hex = c.slice(1);
    if (hex.length === 3) {
      return [
        parseInt(hex[0]! + hex[0]!, 16),
        parseInt(hex[1]! + hex[1]!, 16),
        parseInt(hex[2]! + hex[2]!, 16),
      ];
    }
    if (hex.length === 6) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
      ];
    }
    return null;
  }
  const m = c.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}
