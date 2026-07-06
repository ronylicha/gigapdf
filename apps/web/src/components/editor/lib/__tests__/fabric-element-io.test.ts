/**
 * fabric-element-io.test.ts
 *
 * Round-trip guards for `fabricObjectToElement` — the inverse of the overlay
 * renderer. Two behaviours are critical and easy to regress:
 *
 *   1. An editable text FORM FIELD is rendered as an IText (Fabric `type` =
 *      "i-text"). It MUST serialise back as `type:"form_field"` (never as free
 *      `type:"text"`), or the field identity (fieldType/fieldName/options) is
 *      lost and the AcroForm is never reconstructed at bake time.
 *   2. The typed value / checked state must be re-read from the live object so
 *      user input is persisted.
 *   3. A COSMETIC scaleX (anti-overflow fit on the fallback font) must NOT bleed
 *      into bounds.width, which would corrupt the redaction/replaceText region.
 */

import { describe, it, expect } from "vitest";
import type { FabricObjectWithData } from "../fabric-element-io";
import {
  fabricObjectToElement,
  fabricObjectToElements,
  readFormFieldValue,
  commitParagraphSession,
  mapLineEditToSingleRun,
  refreshParagraphSessionAfterCommit,
} from "../fabric-element-io";
import type { TextElement } from "@giga-pdf/types";

/** Minimal Fabric-like object stub carrying our `.data` metadata. */
function fabricStub(
  partial: Partial<FabricObjectWithData> & { type?: string; text?: string },
): FabricObjectWithData {
  return {
    left: 0,
    top: 0,
    width: 100,
    height: 16,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    skewX: 0,
    skewY: 0,
    selectable: true,
    visible: true,
    ...partial,
  } as unknown as FabricObjectWithData;
}

function textFieldElement(value: string): Record<string, unknown> {
  return {
    type: "form_field",
    elementId: "f1",
    fieldType: "text",
    fieldName: "lastName",
    value,
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
  };
}

describe("fabricObjectToElement — form field round-trip", () => {
  it("serialises a text-field IText as form_field, NOT free text", () => {
    const field = textFieldElement("");
    const obj = fabricStub({
      type: "i-text",
      text: "Dupont",
      left: 10,
      top: 20,
      width: 120,
      data: {
        elementId: "f1",
        type: "form_field",
        fieldType: "text",
        fieldName: "lastName",
        fieldPlaceholder: "Last name",
        formFieldElement: field as never,
      },
    });
    const el = fabricObjectToElement(obj);
    expect(el).not.toBeNull();
    expect(el!.type).toBe("form_field");
    // Field identity preserved.
    const ff = el as unknown as {
      fieldType: string;
      fieldName: string;
      value: unknown;
    };
    expect(ff.fieldType).toBe("text");
    expect(ff.fieldName).toBe("lastName");
    // Typed value persisted.
    expect(ff.value).toBe("Dupont");
  });

  it("persists '' (not the placeholder) for an empty text field", () => {
    const field = textFieldElement("");
    const obj = fabricStub({
      type: "i-text",
      text: "Last name", // still showing the placeholder
      data: {
        elementId: "f1",
        type: "form_field",
        fieldType: "text",
        fieldName: "lastName",
        fieldPlaceholder: "Last name",
        formFieldElement: field as never,
      },
    });
    const ff = fabricObjectToElement(obj) as unknown as { value: unknown };
    expect(ff.value).toBe("");
  });

  it("reads the checked state of a checkbox field", () => {
    const field = {
      ...textFieldElement(""),
      fieldType: "checkbox",
      fieldName: "agree",
      value: false,
    };
    const obj = fabricStub({
      type: "i-text",
      text: "☑",
      data: {
        elementId: "cb",
        type: "form_field",
        fieldType: "checkbox",
        fieldName: "agree",
        fieldChecked: true,
        formFieldElement: field as never,
      },
    });
    const ff = fabricObjectToElement(obj) as unknown as {
      type: string;
      value: unknown;
    };
    expect(ff.type).toBe("form_field");
    expect(ff.value).toBe(true);
  });

  it("reads the selected option of a checked radio field", () => {
    const field = {
      ...textFieldElement(""),
      fieldType: "radio",
      fieldName: "answer",
      options: ["yes"],
      value: "",
    };
    const obj = fabricStub({
      type: "i-text",
      text: "◉",
      data: {
        elementId: "r-yes",
        type: "form_field",
        fieldType: "radio",
        fieldName: "answer",
        fieldChecked: true,
        fieldExportValue: "yes",
        formFieldElement: field as never,
      },
    });
    const ff = fabricObjectToElement(obj) as unknown as { value: unknown };
    expect(ff.value).toBe("yes");
  });

  it("serialises an unchecked radio back to '' (group has one value)", () => {
    const field = {
      ...textFieldElement(""),
      fieldType: "radio",
      fieldName: "answer",
      options: ["no"],
      value: "no",
    };
    const obj = fabricStub({
      type: "i-text",
      text: "○",
      data: {
        elementId: "r-no",
        type: "form_field",
        fieldType: "radio",
        fieldName: "answer",
        fieldChecked: false,
        fieldExportValue: "no",
        formFieldElement: field as never,
      },
    });
    const ff = fabricObjectToElement(obj) as unknown as { value: unknown };
    expect(ff.value).toBe("");
  });
});

describe("fabricObjectToElement — scaleX is taken verbatim (no cosmetic fit)", () => {
  it("bakes a user-resize scaleX into bounds.width", () => {
    // The cosmetic anti-overflow scaleX no longer exists (render-elements stopped
    // squashing text). scaleX is therefore always a real user resize and is baked
    // straight into bounds.width.
    const obj = fabricStub({
      type: "i-text",
      text: "Resized",
      width: 100,
      scaleX: 1.5,
      data: {
        elementId: "t2",
        type: "text",
        originalFont: "Helvetica",
      },
    });
    const el = fabricObjectToElement(obj);
    expect(el!.type).toBe("text");
    expect(el!.bounds.width).toBe(150);
  });

  it("uses scaleX=1 (no squeeze) verbatim when the object was not resized", () => {
    const obj = fabricStub({
      type: "i-text",
      text: "Natural width",
      width: 200,
      scaleX: 1,
      data: { elementId: "t1", type: "text", originalFont: "Helvetica" },
    });
    const el = fabricObjectToElement(obj);
    expect(el!.bounds.width).toBe(200);
  });
});

describe("readFormFieldValue", () => {
  const base = textFieldElement("") as unknown as Parameters<
    typeof readFormFieldValue
  >[1];

  it("returns boolean for checkbox from data.fieldChecked", () => {
    const field = { ...base, fieldType: "checkbox" as const };
    expect(
      readFormFieldValue(
        fabricStub({ data: { fieldChecked: true } }),
        field,
      ),
    ).toBe(true);
    expect(
      readFormFieldValue(
        fabricStub({ data: { fieldChecked: false } }),
        field,
      ),
    ).toBe(false);
  });

  it("returns the typed text for a text field, ignoring the placeholder", () => {
    const field = { ...base, fieldType: "text" as const };
    expect(
      readFormFieldValue(
        fabricStub({ text: "hello", data: { fieldPlaceholder: "name" } }),
        field,
      ),
    ).toBe("hello");
    expect(
      readFormFieldValue(
        fabricStub({ text: "name", data: { fieldPlaceholder: "name" } }),
        field,
      ),
    ).toBe("");
  });

  it("keeps the stored value for non-keyboard fields (signature)", () => {
    const field = {
      ...base,
      fieldType: "signature" as const,
      value: "kept",
    };
    expect(readFormFieldValue(fabricStub({}), field)).toBe("kept");
  });

  it("serialises a NAMED-state checkbox as its export string (checked) or '' (unchecked)", () => {
    // Multi-widget CERFA pairs (Oui/non): the widget's on-state is a NAMED
    // export — a boolean would lose WHICH state was picked. The bake routes
    // the string through setCheckboxState (per-widget /AS).
    const field = {
      ...base,
      fieldType: "checkbox" as const,
      fieldName: "RAT",
      onValue: "non",
    };
    expect(
      readFormFieldValue(fabricStub({ data: { fieldChecked: true } }), field),
    ).toBe("non");
    expect(
      readFormFieldValue(fabricStub({ data: { fieldChecked: false } }), field),
    ).toBe("");
  });

  it("keeps the boolean shape for a plain (unnamed) checkbox", () => {
    const field = {
      ...base,
      fieldType: "checkbox" as const,
      onValue: null,
    };
    expect(
      readFormFieldValue(fabricStub({ data: { fieldChecked: true } }), field),
    ).toBe(true);
  });
});

describe("fabricObjectToElement — multiline field Textbox claim", () => {
  it("claims a MULTILINE field Textbox as form_field BEFORE the textbox/text branch", () => {
    // The multiline overlay is a Fabric Textbox (type "textbox"); without the
    // early form-field guard it would serialise as free `type:"text"` and
    // destroy the field identity (fieldName/properties/AcroForm reconstruction).
    const field = {
      ...textFieldElement("ligne 1\nligne 2"),
      properties: {
        required: false,
        readOnly: false,
        maxLength: null,
        multiline: true,
        password: false,
        comb: false,
      },
    };
    const obj = fabricStub({
      type: "textbox",
      text: "ligne 1\nligne 2",
      data: {
        elementId: "f1",
        type: "form_field",
        fieldType: "text",
        fieldName: "lastName",
        fieldPlaceholder: "Last name",
        formFieldElement: field as never,
      },
    });
    const el = fabricObjectToElement(obj)!;
    expect(el.type).toBe("form_field");
    const ff = el as unknown as { fieldName: string; value: unknown };
    expect(ff.fieldName).toBe("lastName");
    expect(ff.value).toBe("ligne 1\nligne 2");
  });

  it("returns null for a form-field HIT-TARGET (chrome, never an element)", () => {
    const obj = fabricStub({
      type: "rect",
      data: {
        elementId: "hit:f1",
        type: "form_field",
        isFieldHitTarget: true,
        hitForElementId: "f1",
      },
    });
    expect(fabricObjectToElement(obj)).toBeNull();
  });
});

describe("fabricObjectToElement — widget-rect preservation (form fields)", () => {
  it("round-trips the STORED widget rect for an untouched field (not the IText bbox)", () => {
    const field = textFieldElement("Dupont");
    const obj = fabricStub({
      type: "i-text",
      text: "Dupont",
      // Live IText bbox: inset + content-sized — NOT the widget rect.
      left: 12,
      top: 22,
      width: 43,
      height: 12,
      data: {
        elementId: "f1",
        type: "form_field",
        fieldType: "text",
        fieldName: "lastName",
        fieldWidgetBounds: { x: 10, y: 20, width: 120, height: 16 },
        fieldAnchor0: { left: 12, top: 22 },
        formFieldElement: field as never,
      },
    });
    const el = fabricObjectToElement(obj)!;
    // Untouched (anchor unchanged) → the exact widget rect. This is what lets
    // the bake see "geometry unchanged" and route the value to the REAL fill
    // instead of the destructive redact + re-add.
    expect(el.bounds).toEqual({ x: 10, y: 20, width: 120, height: 16 });
  });

  it("translates the widget rect by the drag delta when the field was moved", () => {
    const field = textFieldElement("Dupont");
    const obj = fabricStub({
      type: "i-text",
      text: "Dupont",
      left: 12 + 30, // dragged +30 / +5
      top: 22 + 5,
      width: 43,
      data: {
        elementId: "f1",
        type: "form_field",
        fieldType: "text",
        fieldName: "lastName",
        fieldWidgetBounds: { x: 10, y: 20, width: 120, height: 16 },
        fieldAnchor0: { left: 12, top: 22 },
        formFieldElement: field as never,
      },
    });
    const el = fabricObjectToElement(obj)!;
    expect(el.bounds).toEqual({ x: 40, y: 25, width: 120, height: 16 });
  });
});

// --- Paragraph Textbox decomposition (multi-line save) -----------------------

/** Stub a coalesced paragraph Textbox carrying its source runs on data. */
function paragraphTextbox(
  text: string,
  runs: Array<{
    elementId: string;
    index?: number;
    x: number;
    y: number;
    width: number;
    height?: number;
    content: string;
  }>,
  over: Partial<FabricObjectWithData> = {},
): FabricObjectWithData {
  const originLeft = Math.min(...runs.map((r) => r.x));
  const originTop = Math.min(...runs.map((r) => r.y));
  return fabricStub({
    type: "textbox",
    text,
    left: originLeft,
    top: originTop,
    width: Math.max(...runs.map((r) => r.x + r.width)) - originLeft,
    fontSize: 12,
    fontFamily: "Helvetica",
    fill: "#000000",
    lineHeight: 1.2,
    textAlign: "left",
    data: {
      elementId: runs[0]!.elementId,
      type: "text",
      isParagraph: true,
      originalFont: "ABCDEF+Body",
      paragraphRuns: runs.map((r) => ({
        elementId: r.elementId,
        ...(r.index !== undefined ? { index: r.index } : {}),
        bounds: { x: r.x, y: r.y, width: r.width, height: r.height ?? 12 },
        content: r.content,
      })),
    },
    ...over,
  } as unknown as Partial<FabricObjectWithData> & { type?: string; text?: string });
}

describe("fabricObjectToElements — paragraph decomposition", () => {
  it("passes a non-paragraph object straight through (1 element)", () => {
    const obj = fabricStub({
      type: "i-text",
      text: "Hello",
      data: { elementId: "t1", type: "text", originalFont: "Helvetica" },
    });
    const els = fabricObjectToElements(obj);
    expect(els).toHaveLength(1);
    expect(els[0]!.type).toBe("text");
    expect((els[0] as TextElement).content).toBe("Hello");
  });

  it("returns [] for an unknown object type", () => {
    const obj = fabricStub({ type: "group", data: {} });
    expect(fabricObjectToElements(obj)).toEqual([]);
  });

  it("decomposes an UNCHANGED paragraph into its runs, preserving indices", () => {
    const obj = paragraphTextbox("Line A\nLine B\nLine C", [
      { elementId: "a", index: 5, x: 40, y: 100, width: 300, content: "Line A" },
      { elementId: "b", index: 6, x: 40, y: 114, width: 300, content: "Line B" },
      { elementId: "c", index: 7, x: 40, y: 128, width: 300, content: "Line C" },
    ]);
    const els = fabricObjectToElements(obj) as TextElement[];
    expect(els).toHaveLength(3);
    expect(els.map((e) => e.elementId)).toEqual(["a", "b", "c"]);
    expect(els.map((e) => e.index)).toEqual([5, 6, 7]); // lossless replaceText
    expect(els.map((e) => e.content)).toEqual(["Line A", "Line B", "Line C"]);
    // bounds.y inherited from the source runs (block not moved).
    expect(els.map((e) => e.bounds.y)).toEqual([100, 114, 128]);
  });

  it("maps an EDITED middle line onto its source run (index kept)", () => {
    const obj = paragraphTextbox("Line A\nEDITED\nLine C", [
      { elementId: "a", index: 5, x: 40, y: 100, width: 300, content: "Line A" },
      { elementId: "b", index: 6, x: 40, y: 114, width: 300, content: "Line B" },
      { elementId: "c", index: 7, x: 40, y: 128, width: 300, content: "Line C" },
    ]);
    const els = fabricObjectToElements(obj) as TextElement[];
    expect(els[1]!.content).toBe("EDITED");
    expect(els[1]!.elementId).toBe("b");
    expect(els[1]!.index).toBe(6);
  });

  it("translates every run when the whole block was MOVED", () => {
    const obj = paragraphTextbox("Line A\nLine B", [
      { elementId: "a", index: 5, x: 40, y: 100, width: 300, content: "Line A" },
      { elementId: "b", index: 6, x: 40, y: 114, width: 300, content: "Line B" },
    ]);
    // Move the block: origin was (40,100); set it to (90,160) → dx=50, dy=60.
    (obj as { left?: number; top?: number }).left = 90;
    (obj as { left?: number; top?: number }).top = 160;
    const els = fabricObjectToElements(obj) as TextElement[];
    expect(els.map((e) => e.bounds.x)).toEqual([90, 90]);
    expect(els.map((e) => e.bounds.y)).toEqual([160, 174]);
    // Indices preserved (a move is still an in-place edit of the same runs).
    expect(els.map((e) => e.index)).toEqual([5, 6]);
  });

  it("ADDS a new run (no index) when a line is appended", () => {
    const obj = paragraphTextbox("Line A\nLine B\nNEW LINE", [
      { elementId: "a", index: 5, x: 40, y: 100, width: 300, content: "Line A" },
      { elementId: "b", index: 6, x: 40, y: 114, width: 300, content: "Line B" },
    ]);
    const els = fabricObjectToElements(obj) as TextElement[];
    expect(els).toHaveLength(3);
    expect(els[2]!.content).toBe("NEW LINE");
    // The appended line has NO engine index → takes the add path.
    expect(els[2]!.index).toBeUndefined();
    // It is stacked under the last source line (y > previous line's y).
    expect(els[2]!.bounds.y).toBeGreaterThan(els[1]!.bounds.y);
  });

  it("ERASES a removed line (surplus run serialised with empty content)", () => {
    const obj = paragraphTextbox("Line A", [
      { elementId: "a", index: 5, x: 40, y: 100, width: 300, content: "Line A" },
      { elementId: "b", index: 6, x: 40, y: 114, width: 300, content: "Line B" },
    ]);
    const els = fabricObjectToElements(obj) as TextElement[];
    expect(els).toHaveLength(2);
    expect(els[0]!.content).toBe("Line A");
    // The deleted line's source run is kept with "" so replaceText erases it.
    expect(els[1]!.elementId).toBe("b");
    expect(els[1]!.index).toBe(6);
    expect(els[1]!.content).toBe("");
  });

  it("applies the live block colour to every decomposed run", () => {
    const obj = paragraphTextbox("Line A\nLine B", [
      { elementId: "a", index: 5, x: 40, y: 100, width: 300, content: "Line A" },
      { elementId: "b", index: 6, x: 40, y: 114, width: 300, content: "Line B" },
    ]);
    (obj as { fill?: string }).fill = "#ff0000"; // user recoloured the block
    const els = fabricObjectToElements(obj) as TextElement[];
    expect(els.every((e) => e.style.color === "#ff0000")).toBe(true);
    // originalFont inherited so the bake re-uses the same subset.
    expect(els.every((e) => e.style.originalFont === "ABCDEF+Body")).toBe(true);
  });
});

describe("fabricObjectToElement — list / indent round-trip", () => {
  // Mirrors what render-elements.ts stamps: the marker prefix is composed into
  // the DISPLAYED text (`•\t…`), the original list/indent are stashed on data,
  // and the box `left` was shifted right by leftIndentOffset(style). The
  // serialiser must recover a CLEAN content, the ORIGINAL bounds.x, and re-emit
  // style.list / style.indentLeft.
  const BULLET_PREFIX = "•\t"; // matches list-format listMarkerPrefix(bullet,0)
  const STEP = 18; // INDENT_STEP_PT

  it("strips the bullet marker prefix back to the clean content", () => {
    const obj = fabricStub({
      type: "i-text",
      text: `${BULLET_PREFIX}Groceries`,
      left: STEP, // shifted by one list-level gutter
      width: 200,
      data: {
        elementId: "l1",
        type: "text",
        originalFont: "Helvetica",
        listStyle: { type: "bullet", level: 0 },
        indentLeft: 0,
        listMarkerLen: BULLET_PREFIX.length,
      },
    });
    const el = fabricObjectToElement(obj) as TextElement;
    expect(el.type).toBe("text");
    expect(el.content).toBe("Groceries"); // marker NOT persisted
    expect(el.style.list).toEqual({ type: "bullet", level: 0 });
    // bounds.x recovered (the one-level gutter subtracted) → no rightward drift.
    expect(el.bounds.x).toBe(0);
  });

  it("recovers the original bounds.x for an explicit indent (no list)", () => {
    const obj = fabricStub({
      type: "i-text",
      text: "Indented paragraph",
      left: 60, // = original 24 + indentLeft 36
      width: 200,
      data: {
        elementId: "l2",
        type: "text",
        originalFont: "Helvetica",
        listStyle: null,
        indentLeft: 36,
        listMarkerLen: 0,
      },
    });
    const el = fabricObjectToElement(obj) as TextElement;
    expect(el.content).toBe("Indented paragraph");
    expect(el.style.indentLeft).toBe(36);
    expect(el.bounds.x).toBe(24);
    expect(el.style.list).toBeUndefined();
  });

  it("recovers bounds.x for a numbered+indented list (gutter + explicit indent)", () => {
    const NUM_PREFIX = "1.\t";
    const obj = fabricStub({
      type: "i-text",
      text: `${NUM_PREFIX}Step one`,
      // original x 10, indentLeft 12, list level 1 ⇒ offset = 12 + 2*STEP = 48.
      left: 10 + 12 + 2 * STEP,
      width: 200,
      data: {
        elementId: "l3",
        type: "text",
        originalFont: "Helvetica",
        listStyle: { type: "number", level: 1 },
        indentLeft: 12,
        listMarkerLen: NUM_PREFIX.length,
      },
    });
    const el = fabricObjectToElement(obj) as TextElement;
    expect(el.content).toBe("Step one");
    expect(el.style.list).toEqual({ type: "number", level: 1 });
    expect(el.style.indentLeft).toBe(12);
    expect(el.bounds.x).toBe(10);
  });

  it("is byte-identical to legacy for a plain paragraph (no list/indent data)", () => {
    const obj = fabricStub({
      type: "i-text",
      text: "Plain",
      left: 5,
      width: 200,
      data: { elementId: "l4", type: "text", originalFont: "Helvetica" },
    });
    const el = fabricObjectToElement(obj) as TextElement;
    expect(el.content).toBe("Plain");
    expect(el.bounds.x).toBe(5);
    expect(el.style.list).toBeUndefined();
    expect(el.style.indentLeft).toBeUndefined();
  });
});

describe("fabricObjectToElement — freetext annotation IText round-trip", () => {
  it("serialises a freetext IText back as an ANNOTATION (not a text element)", () => {
    // A freetext annotation is rendered as an IText so its text is readable; on
    // save it must round-trip as type:"annotation" via the data.annotationType
    // marker, NOT be claimed by the i-text→text branch.
    const obj = fabricStub({
      type: "i-text",
      text: "Edited note",
      fill: "#ff0000",
      data: { elementId: "ft1", annotationType: "freetext" },
    });
    const el = fabricObjectToElement(obj) as unknown as {
      type: string;
      annotationType: string;
      content: string;
    };
    expect(el.type).toBe("annotation");
    expect(el.annotationType).toBe("freetext");
    // Live IText content is the canonical value (a typed edit persists).
    expect(el.content).toBe("Edited note");
  });

  it("still serialises a plain IText (no annotationType) as a text element", () => {
    const obj = fabricStub({
      type: "i-text",
      text: "Hello",
      data: { elementId: "t9", type: "text", originalFont: "Helvetica" },
    });
    const el = fabricObjectToElement(obj);
    expect(el?.type).toBe("text");
  });
});

// --- Image opacity decoupling (parsed hit-targets are displayed at opacity 0)--
//
// A PARSED image overlay is shown invisible (opacity 0) because the text-free
// raster already paints it; its REAL opacity is stashed on data.originalOpacity.
// Serialising the live `obj.opacity` (0) would bake an invisible image into the
// PDF on the first move/resize. The save path must prefer data.originalOpacity
// (mirror of the shape data.originalFill decoupling) and only fall back to the
// live opacity for a newly-added image that has none.
describe("fabricObjectToElement — image opacity decoupling", () => {
  function imageStub(
    over: Partial<FabricObjectWithData> & { opacity?: number },
  ): FabricObjectWithData {
    return fabricStub({
      type: "image",
      opacity: 0,
      // The image branch sniffs the mime from the data URL prefix.
      ...({
        getSrc: () => "data:image/png;base64,QUFB",
      } as unknown as Partial<FabricObjectWithData>),
      ...over,
    });
  }

  it("uses data.originalOpacity, NOT the 0 display opacity, for a parsed image", () => {
    const obj = imageStub({
      opacity: 0,
      data: { elementId: "img1", type: "image", originalOpacity: 1 },
    });
    const el = fabricObjectToElement(obj) as unknown as {
      type: string;
      style: { opacity: number };
    };
    expect(el.type).toBe("image");
    // The 0 hit-target opacity must NEVER be baked — the real opacity wins.
    expect(el.style.opacity).toBe(1);
  });

  it("preserves a parsed image's mixed real opacity from data.originalOpacity", () => {
    const obj = imageStub({
      opacity: 0,
      data: { elementId: "img2", type: "image", originalOpacity: 0.6 },
    });
    const el = fabricObjectToElement(obj) as unknown as {
      style: { opacity: number };
    };
    expect(el.style.opacity).toBe(0.6);
  });

  it("falls back to the live opacity for a NEW image (no data.originalOpacity)", () => {
    const obj = imageStub({
      opacity: 0.85,
      data: { elementId: "img3", type: "image" },
    });
    const el = fabricObjectToElement(obj) as unknown as {
      style: { opacity: number };
    };
    // No stash → keep what the (visible) new image is actually drawn at.
    expect(el.style.opacity).toBe(0.85);
  });
});

// ---------------------------------------------------------------------------
// commitParagraphSession — the edit-intent commit (session Textbox → sources)
// ---------------------------------------------------------------------------

/** Build a session Textbox stub over the given per-line source runs. */
function sessionTextbox(
  text: string,
  lines: Array<
    Array<{
      elementId: string;
      index?: number;
      x: number;
      y: number;
      width: number;
      content: string;
      style?: Record<string, unknown>;
    }>
  >,
  over: Partial<FabricObjectWithData> & {
    text?: string;
    textLines?: string[];
    sessionLineTexts?: string[];
  } = {},
): FabricObjectWithData {
  const lineRuns = lines.map((line) =>
    line.map((r) => ({
      elementId: r.elementId,
      ...(r.index !== undefined ? { index: r.index } : {}),
      bounds: { x: r.x, y: r.y, width: r.width, height: 12 },
      content: r.content,
      style: {
        fontFamily: "Times New Roman",
        fontSize: 10,
        fontWeight: "normal",
        fontStyle: "normal",
        color: "#112233",
        opacity: 1,
        textAlign: "left",
        lineHeight: 1.05,
        letterSpacing: 0,
        writingMode: "horizontal-tb",
        underline: false,
        strikethrough: false,
        backgroundColor: null,
        verticalAlign: "baseline",
        originalFont: "ABCDEF+TimesNewRoman",
        ...(r.style ?? {}),
      },
    })),
  );
  const sessionLineTexts =
    over.sessionLineTexts ??
    lines.map((line) => line.map((r) => r.content).join(" "));
  const { textLines, sessionLineTexts: _slt, ...rest } = over;
  return fabricStub({
    type: "textbox",
    text,
    ...(textLines ? { textLines } : {}),
    left: 40,
    top: 100,
    width: 300,
    fontSize: 10,
    lineHeight: 1.05,
    data: {
      elementId: lines[0]![0]!.elementId,
      type: "text",
      isParagraph: true,
      isParagraphSession: true,
      originalFont: "ABCDEF+TimesNewRoman",
      lineRuns,
      paragraphRuns: lineRuns.flat(),
      sessionLineTexts,
      sessionOriginalText: sessionLineTexts.join("\n"),
      sessionOrigin: { left: 40, top: 100 },
    },
    ...rest,
  } as never);
}

describe("commitParagraphSession", () => {
  it("returns 'unchanged' when the text and position are the session baseline", () => {
    const obj = sessionTextbox("Nom : DUPONT\nLigne deux", [
      [
        { elementId: "a", index: 1, x: 40, y: 100, width: 50, content: "Nom :" },
        { elementId: "b", index: 2, x: 95, y: 100, width: 60, content: "DUPONT" },
      ],
      [{ elementId: "c", index: 3, x: 40, y: 114, width: 200, content: "Ligne deux" }],
    ]);
    expect(commitParagraphSession(obj)).toEqual({ kind: "unchanged" });
    // The generic serialiser forwards NOTHING for an unchanged session.
    expect(fabricObjectToElements(obj)).toEqual([]);
  });

  it("UPDATE: an edit contained in ONE run rewrites ONLY that run — siblings keep their typography", () => {
    // "DUPONT" → "MARTIN": the whole diff sits inside run `b`. The commit must
    // NOT flatten the line onto run `a` (which would stamp `a`'s style over
    // the text and erase `b` — the "editing loses the mixed formatting" bug).
    const obj = sessionTextbox("Nom : MARTIN\nLigne deux", [
      [
        { elementId: "a", index: 1, x: 40, y: 100, width: 50, content: "Nom :" },
        { elementId: "b", index: 2, x: 95, y: 100, width: 60, content: "DUPONT" },
      ],
      [{ elementId: "c", index: 3, x: 40, y: 114, width: 200, content: "Ligne deux" }],
    ]);
    const commit = commitParagraphSession(obj);
    expect(commit.kind).toBe("update");
    const els = (commit as { elements: TextElement[] }).elements;
    // ONE surgical write: run b gets its new text; run a is not even emitted.
    expect(els).toHaveLength(1);
    expect(els[0]!.elementId).toBe("b");
    expect(els[0]!.index).toBe(2);
    expect(els[0]!.content).toBe("MARTIN");
    // The run keeps its OWN stashed style (lossless replaceText routing).
    expect(els[0]!.style.originalFont).toBe("ABCDEF+TimesNewRoman");
    expect(els[0]!.style.fontSize).toBe(10);
    // Source bounds preserved (block not moved).
    expect(els[0]!.bounds).toMatchObject({ x: 95, y: 100 });
  });

  it("UPDATE: an edit SPANNING several runs falls back to the coarse first-run rewrite", () => {
    // "Nom : DUPONT" → "NoXXXUPONT": the edited window covers the end of run
    // `a`, the injected join space and the start of run `b` — no single run
    // contains it, so the historical full-line-on-first-run rewrite applies.
    const obj = sessionTextbox("NoXXXUPONT\nLigne deux", [
      [
        { elementId: "a", index: 1, x: 40, y: 100, width: 50, content: "Nom :" },
        { elementId: "b", index: 2, x: 95, y: 100, width: 60, content: "DUPONT" },
      ],
      [{ elementId: "c", index: 3, x: 40, y: 114, width: 200, content: "Ligne deux" }],
    ]);
    const commit = commitParagraphSession(obj);
    expect(commit.kind).toBe("update");
    const els = (commit as { elements: TextElement[] }).elements;
    expect(els).toHaveLength(2);
    expect(els[0]!.elementId).toBe("a");
    expect(els[0]!.content).toBe("NoXXXUPONT");
    expect(els[1]!.elementId).toBe("b");
    expect(els[1]!.content).toBe("");
  });

  it("UPDATE: a pure insertion at a run boundary appends to the run ending there", () => {
    // Caret right after "Nom :" (end of run a) → the "!" belongs to run a.
    const obj = sessionTextbox("Nom :! DUPONT\nLigne deux", [
      [
        { elementId: "a", index: 1, x: 40, y: 100, width: 50, content: "Nom :" },
        { elementId: "b", index: 2, x: 95, y: 100, width: 60, content: "DUPONT" },
      ],
      [{ elementId: "c", index: 3, x: 40, y: 114, width: 200, content: "Ligne deux" }],
    ]);
    const commit = commitParagraphSession(obj);
    expect(commit.kind).toBe("update");
    const els = (commit as { elements: TextElement[] }).elements;
    expect(els).toHaveLength(1);
    expect(els[0]!.elementId).toBe("a");
    expect(els[0]!.content).toBe("Nom :!");
  });

  it("UPDATE: a single-run edit on a MOVED block also re-emits the siblings verbatim (moveElement)", () => {
    const obj = sessionTextbox(
      "Nom : MARTIN\nLigne deux",
      [
        [
          { elementId: "a", index: 1, x: 40, y: 100, width: 50, content: "Nom :" },
          { elementId: "b", index: 2, x: 95, y: 100, width: 60, content: "DUPONT" },
        ],
        [{ elementId: "c", index: 3, x: 40, y: 114, width: 200, content: "Ligne deux" }],
      ],
      { left: 50, top: 120 }, // +10 / +20 vs sessionOrigin
    );
    const commit = commitParagraphSession(obj);
    expect(commit.kind).toBe("update");
    const els = (commit as { elements: TextElement[] }).elements;
    // Line 1: surgical rewrite of b + verbatim move of a; line 2: pure move.
    expect(els.map((e) => [e.elementId, e.content])).toEqual([
      ["a", "Nom :"],
      ["b", "MARTIN"],
      ["c", "Ligne deux"],
    ]);
    expect(els.map((e) => e.bounds.x)).toEqual([50, 105, 50]);
    expect(els.map((e) => e.bounds.y)).toEqual([120, 120, 134]);
  });

  it("UPDATE: a pure block MOVE emits every run verbatim with translated bounds", () => {
    const obj = sessionTextbox(
      "Nom : DUPONT\nLigne deux",
      [
        [
          { elementId: "a", index: 1, x: 40, y: 100, width: 50, content: "Nom :" },
          { elementId: "b", index: 2, x: 95, y: 100, width: 60, content: "DUPONT" },
        ],
        [{ elementId: "c", index: 3, x: 40, y: 114, width: 200, content: "Ligne deux" }],
      ],
      { left: 50, top: 120 }, // +10 / +20 vs sessionOrigin
    );
    const commit = commitParagraphSession(obj);
    expect(commit.kind).toBe("update");
    const els = (commit as { elements: TextElement[] }).elements;
    expect(els).toHaveLength(3);
    // Contents untouched (pure moveElement), bounds translated by the delta.
    expect(els.map((e) => e.content)).toEqual(["Nom :", "DUPONT", "Ligne deux"]);
    expect(els.map((e) => e.bounds.x)).toEqual([50, 105, 50]);
    expect(els.map((e) => e.bounds.y)).toEqual([120, 120, 134]);
    expect(els.map((e) => e.index)).toEqual([1, 2, 3]);
  });

  it("REFLOW: a changed line count removes EVERY source run and adds one run per re-wrapped line", () => {
    const obj = sessionTextbox(
      // The user pressed Enter inside line 1 → 3 logical lines now.
      "Nom :\nMARTIN\nLigne deux",
      [
        [
          { elementId: "a", index: 1, x: 40, y: 100, width: 50, content: "Nom :" },
          { elementId: "b", index: 2, x: 95, y: 100, width: 60, content: "DUPONT" },
        ],
        [{ elementId: "c", index: 3, x: 40, y: 114, width: 200, content: "Ligne deux" }],
      ],
    );
    const commit = commitParagraphSession(obj);
    expect(commit.kind).toBe("reflow");
    const { removedElementIds, addedElements } = commit as {
      removedElementIds: string[];
      addedElements: TextElement[];
    };
    // ALL source runs of the group are removed (apply-operations orders the
    // removeElement calls in descending index itself).
    expect(removedElementIds).toEqual(["a", "b", "c"]);
    // One NEW run per line, stacked at fontSize × lineHeight from the box top,
    // sized to the session frame width, with NO engine index (add path).
    expect(addedElements).toHaveLength(3);
    expect(addedElements.map((e) => e.content)).toEqual([
      "Nom :",
      "MARTIN",
      "Ligne deux",
    ]);
    expect(addedElements.every((e) => e.index === undefined)).toBe(true);
    expect(addedElements.map((e) => e.bounds.y)).toEqual([
      100,
      100 + 10 * 1.05,
      100 + 2 * 10 * 1.05,
    ]);
    expect(addedElements.every((e) => e.bounds.x === 40)).toBe(true);
    expect(addedElements.every((e) => e.bounds.width === 300)).toBe(true);
  });

  it("REFLOW: uses Fabric's WRAPPED textLines when they differ from the logical lines", () => {
    const obj = sessionTextbox(
      "un texte long qui wrappe\nLigne deux",
      [
        [
          {
            elementId: "a",
            index: 1,
            x: 40,
            y: 100,
            width: 300,
            content: "un texte long qui wrappe",
          },
        ],
        [{ elementId: "c", index: 3, x: 40, y: 114, width: 200, content: "Ligne deux" }],
      ],
      {
        // Fabric wrapped the (edited) first logical line into two visual lines.
        text: "un texte long qui wrappe désormais\nLigne deux",
        textLines: ["un texte long qui", "wrappe désormais", "Ligne deux"],
        sessionLineTexts: ["un texte long qui wrappe", "Ligne deux"],
      },
    );
    const commit = commitParagraphSession(obj);
    expect(commit.kind).toBe("reflow");
    const { addedElements } = commit as { addedElements: TextElement[] };
    expect(addedElements.map((e) => e.content)).toEqual([
      "un texte long qui",
      "wrappe désormais",
      "Ligne deux",
    ]);
  });

  it("refreshParagraphSessionAfterCommit re-anchors the baseline after an update", () => {
    const obj = sessionTextbox("Nom : MARTIN\nLigne deux", [
      [
        { elementId: "a", index: 1, x: 40, y: 100, width: 50, content: "Nom :" },
        { elementId: "b", index: 2, x: 95, y: 100, width: 60, content: "DUPONT" },
      ],
      [{ elementId: "c", index: 3, x: 40, y: 114, width: 200, content: "Ligne deux" }],
    ]);
    const commit = commitParagraphSession(obj);
    refreshParagraphSessionAfterCommit(obj, commit);
    // Committed → the box is now UNCHANGED against its refreshed baseline.
    expect(commitParagraphSession(obj)).toEqual({ kind: "unchanged" });
    // The snapshot mirrors the SURGICAL commit: run b carries the new text,
    // run a is untouched (not flattened onto the first run).
    const lineRuns = obj.data!.lineRuns as Array<Array<{ content: string }>>;
    expect(lineRuns[0]!.map((r) => r.content)).toEqual(["Nom :", "MARTIN"]);
  });
});

describe("mapLineEditToSingleRun", () => {
  const line = [
    {
      elementId: "a",
      bounds: { x: 0, y: 0, width: 50, height: 12 },
      content: "Nom :",
      style: {} as never,
    },
    {
      elementId: "b",
      bounds: { x: 55, y: 0, width: 60, height: 12 },
      content: "DUPONT",
      style: {} as never,
    },
  ];

  it("maps an edit fully inside a run to that run", () => {
    expect(
      mapLineEditToSingleRun(line as never, "Nom : DUPONT", "Nom : DURAND"),
    ).toEqual({ runIndex: 1, content: "DURAND" });
  });

  it("returns null when the edit spans runs (through the join space)", () => {
    expect(
      mapLineEditToSingleRun(line as never, "Nom : DUPONT", "NoXXXUPONT"),
    ).toBeNull();
  });

  it("returns null when the baseline diverges from the snapshot", () => {
    expect(
      mapLineEditToSingleRun(line as never, "Autre texte", "Autre textes"),
    ).toBeNull();
  });

  it("emptying a whole run (window starts in the join space) falls back", () => {
    // "Nom : DUPONT" → "Nom :" removes " DUPONT" — the window opens on the
    // injected join space, which belongs to no run.
    expect(
      mapLineEditToSingleRun(line as never, "Nom : DUPONT", "Nom :"),
    ).toBeNull();
  });
});
