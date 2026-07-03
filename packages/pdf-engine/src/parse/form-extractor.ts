import { createHash } from 'node:crypto';
import type { FormFieldElement, FieldType } from '@giga-pdf/types';
import type { FieldInfo, FieldKind, WidgetPlacement } from '@qrcommunication/gigapdf-lib';
import { getEngine } from '../wasm';

// ---------------------------------------------------------------------------
// Form field extractor — backed by the native engine (no pdfjs).
//
// AcroForm is document-level, so `extractFormFieldsByPage` reads every field
// once via `fields()` and groups them by the widget's page; the parser slices
// the right page out. `extractFormFieldElements` is a per-page convenience
// (used by tests). The live form read/fill path is `getFormFields`, also on the
// engine; this only builds the editor scene-graph elements.
// ---------------------------------------------------------------------------

// `/Ff` field flag bits the engine doesn't surface as a named boolean.
// (`comb` and `multiline` ARE surfaced directly on FieldInfo; only password is not.)
const FLAG_PASSWORD = 1 << 13;

/** Map the AcroForm `/Q` quadding (0/1/2) to a CSS text alignment. */
function quaddingToAlign(quadding: number): "left" | "center" | "right" {
  switch (quadding) {
    case 1:
      return "center";
    case 2:
      return "right";
    default:
      return "left";
  }
}

function stableUUID(fieldName: string, pageNumber: number, widgetIndex: number): string {
  const hash = createHash('sha256')
    .update(`${fieldName}:${pageNumber}:${widgetIndex}`)
    .digest('hex');
  const c16 = hash[16] ?? '0';
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    '4' + hash.slice(13, 16), // version 4
    ((parseInt(c16, 16) & 0x3) | 0x8).toString(16) + hash.slice(17, 20), // variant
    hash.slice(20, 32),
  ].join('-');
}

function mapKind(kind: FieldKind): FieldType {
  switch (kind) {
    case 'signature':
      return 'signature';
    case 'checkbox':
      return 'checkbox';
    case 'radio':
      return 'radio';
    case 'pushbutton':
      return 'button';
    case 'combo':
      return 'dropdown';
    case 'list':
      return 'listbox';
    case 'text':
    default:
      return 'text';
  }
}

function toElement(field: FieldInfo, widget: WidgetPlacement, widgetIndex: number): FormFieldElement {
  const pageNumber = widget.page ?? field.page ?? 1;
  // The engine already Y-flips each widget `/Rect` to a top-left `[x, y, w, h]`.
  const [x, y, width, height] = widget.bounds ?? field.bounds ?? [0, 0, 0, 0];
  return {
    // One element per WIDGET: a field on a duplicate page (or each radio button)
    // gets its own overlay, keyed by (name, page, widget index) so two widgets of
    // the same field on the same page never collide.
    elementId: stableUUID(field.name, pageNumber, widgetIndex),
    type: 'form_field',
    bounds: { x, y, width, height },
    transform: { rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 },
    layerId: null,
    locked: false,
    visible: true,
    fieldType: mapKind(field.kind),
    fieldName: field.name,
    value: field.value,
    defaultValue: field.value,
    // For a checkbox/radio button widget, its on-state export — this button is
    // "checked" iff the field value equals it (a radio group has one element per
    // button, each with its own onValue). Null for text/choice widgets.
    onValue: widget.export ?? null,
    options: field.options.length > 0 ? field.options : null,
    properties: {
      required: field.required,
      readOnly: field.readOnly,
      // For a comb field `/MaxLen` is the number of equally-spaced cells the
      // value is laid out into; the editor overlay reproduces that spacing.
      maxLength: field.maxLen ?? null,
      multiline: field.multiline,
      password: (field.flags & FLAG_PASSWORD) !== 0,
      // The engine surfaces the comb flag (`/Ff` bit 25) directly.
      comb: field.comb,
    },
    style: {
      fontFamily: 'Helvetica',
      // `/DA` font size propagated VERBATIM — `0` means AUTO-SIZE. The overlay
      // renderer computes a size that fits the widget box (height + width when
      // a value is present) and the bake keeps the engine's auto (`0 Tf`
      // shrink-to-fit appearances); coercing to 12 here silently destroyed the
      // auto-size semantics on every round-trip.
      fontSize: field.daSize,
      textColor: '#000000',
      backgroundColor: null,
      borderColor: null,
      borderWidth: 1,
      // `/Q` text alignment (0/1/2 → left/center/right).
      textAlign: quaddingToAlign(field.quadding),
      // `/DA` default-appearance font resource name + size (0 = auto-size).
      daFont: field.daFont ?? null,
      daSize: field.daSize,
    },
    format: { type: 'none', pattern: null },
  };
}

/**
 * Extract every AcroForm field with a widget, grouped by its 1-based page.
 * Fields without a widget (`/Rect` + `/P`) are skipped — they aren't page
 * elements. Reads the whole form once (efficient for the multi-page parse).
 */
export async function extractFormFieldsByPage(
  pdfBytes: Buffer | ArrayBuffer | Uint8Array,
): Promise<Map<number, FormFieldElement[]>> {
  const byPage = new Map<number, FormFieldElement[]>();
  try {
    const giga = await getEngine();
    const bytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
    const doc = giga.open(bytes);
    try {
      for (const field of doc.fields()) {
        if (!field.name) continue;
        // Render ONE overlay per widget so a field on a duplicate page (or every
        // radio button) is placed too — not just its first widget. Fall back to the
        // legacy single (page, bounds) for an older engine that omits `widgets`.
        const widgets: WidgetPlacement[] =
          field.widgets && field.widgets.length > 0
            ? field.widgets
            : field.page !== undefined && field.bounds
              ? [{ page: field.page, bounds: field.bounds }]
              : [];
        widgets.forEach((widget, widgetIndex) => {
          if (widget.page === undefined || !widget.bounds) return;
          const element = toElement(field, widget, widgetIndex);
          const list = byPage.get(widget.page) ?? [];
          list.push(element);
          byPage.set(widget.page, list);
        });
      }
    } finally {
      doc.close();
    }
  } catch {
    // leave the map empty on failure
  }
  return byPage;
}

/** Form fields on a single page (convenience wrapper over the grouped map). */
export async function extractFormFieldElements(
  pdfBytes: Buffer | ArrayBuffer | Uint8Array,
  pageNumber: number,
): Promise<FormFieldElement[]> {
  return (await extractFormFieldsByPage(pdfBytes)).get(pageNumber) ?? [];
}
