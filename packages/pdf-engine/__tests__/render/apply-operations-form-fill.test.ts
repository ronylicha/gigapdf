/**
 * applyOperations — fill-mode routing for form fields.
 *
 * A fill-mode `update` (value changed, widget geometry untouched) must be
 * routed to the REAL form setters (`applyFieldValuesOnHandle`) instead of the
 * redact + re-add fallback. The fallback used to DUPLICATE the field: the
 * redaction only clears the content stream (the original widget survives in
 * /Annots) and the re-add created a brand-new field with a reset /DA and lost
 * /Q/comb/flags.
 *
 * These prove:
 *   - update (geometry unchanged) on a TEXT field → `formFieldsFilled === 1`,
 *     NO redaction, NO add; after a full round-trip re-parse the field exists
 *     EXACTLY once under its name with the typed value.
 *   - update with a NAMED checkbox state (string, non-boolean) → the export is
 *     set via `setCheckboxState` (per-widget /AS) and reads back checked.
 *   - update with "" on that checkbox → unchecked (every widget off).
 *   - update with CHANGED geometry → the historical fallback still runs
 *     (redact + re-add), untouched.
 *   - update on a field ABSENT from the AcroForm (design-mode creation) → the
 *     fill fails and falls back to `addFormField` (the field materialises).
 */

import { describe, it, expect } from 'vitest';
import { getEngine } from '../../src/wasm';
import { applyOperations } from '../../src/render/apply-operations';
import type { ElementOperation } from '../../src/render/apply-operations';
import { extractFormFieldElements } from '../../src/parse/form-extractor';
import { getFormFields } from '../../src/forms/reader';
import { loadFixture, SIMPLE_PDF } from '../helpers';
import type { FormFieldElement } from '@giga-pdf/types';

/**
 * SIMPLE_PDF with a text field `name` and a checkbox `rat` whose on-state is
 * the NAMED export `non` (the CERFA Oui/non pattern, single-widget flavour).
 */
async function pdfWithFields(): Promise<Buffer> {
  const giga = await getEngine();
  const doc = giga.open(loadFixture(SIMPLE_PDF));
  try {
    expect(doc.addTextField(1, 'name', [72, 700, 272, 724], '')).toBe(true);
    expect(
      doc.addCheckbox(1, 'rat', [72, 660, 86, 674], false, { export: 'non' }),
    ).toBe(true);
    return Buffer.from(doc.save());
  } finally {
    doc.close();
  }
}

/** The parsed scene-graph element for `fieldName` on page 1. */
async function parsedField(
  bytes: Buffer | Uint8Array,
  fieldName: string,
): Promise<FormFieldElement> {
  const elements = await extractFormFieldElements(bytes, 1);
  const field = elements.find((el) => el.fieldName === fieldName);
  expect(field).toBeDefined();
  return field!;
}

/** An `update` op carrying the element with its CURRENT bounds as oldBounds. */
function updateOp(
  element: FormFieldElement,
  value: FormFieldElement['value'],
  oldBounds: FormFieldElement['bounds'] = element.bounds,
): ElementOperation {
  return {
    action: 'update',
    pageNumber: 1,
    element: { ...element, value } as unknown as Record<string, unknown>,
    oldBounds: { ...oldBounds },
  };
}

describe('applyOperations — form-field fill routing (update → real fill)', () => {
  it('routes a value-only text-field update to the fill path (no redact, no add)', async () => {
    const input = await pdfWithFields();
    const element = await parsedField(input, 'name');

    const result = await applyOperations(input, [
      updateOp(element, 'Dupont-Martin'),
    ]);

    expect(result.formFieldsFilled).toBe(1);
    expect(result.redactionTargetsCount).toBe(0);
    expect(result.addsApplied).toBe(0);

    // Round-trip: the field exists EXACTLY once under its name, value intact.
    const fields = await getFormFields(Buffer.from(result.bytes));
    const named = fields.filter((f) => f.fieldName === 'name');
    expect(named).toHaveLength(1);
    expect(named[0]!.value).toBe('Dupont-Martin');
  });

  it('sets a NAMED checkbox state via setCheckboxState (string value)', async () => {
    const input = await pdfWithFields();
    const element = await parsedField(input, 'rat');
    // The extractor stamps the widget's on-state export.
    expect(element.onValue).toBe('non');

    const result = await applyOperations(input, [updateOp(element, 'non')]);
    expect(result.formFieldsFilled).toBe(1);
    expect(result.redactionTargetsCount).toBe(0);

    const fields = await getFormFields(Buffer.from(result.bytes));
    const rat = fields.filter((f) => f.fieldName === 'rat');
    expect(rat).toHaveLength(1);
    // /V is the named export → reads back as checked.
    expect(rat[0]!.value).toBe(true);

    // And the raw engine value carries the EXPORT, not a generic "On".
    const giga = await getEngine();
    const doc = giga.open(result.bytes);
    try {
      const raw = doc.fields().find((f) => f.name === 'rat');
      expect(raw?.value).toBe('non');
    } finally {
      doc.close();
    }
  });

  it('unchecks a named checkbox when the value serialises back to ""', async () => {
    const input = await pdfWithFields();
    const element = await parsedField(input, 'rat');

    // Check it first, then uncheck through the same pipeline.
    const checked = await applyOperations(input, [updateOp(element, 'non')]);
    const reElement = await parsedField(Buffer.from(checked.bytes), 'rat');
    const unchecked = await applyOperations(Buffer.from(checked.bytes), [
      updateOp(reElement, ''),
    ]);
    expect(unchecked.formFieldsFilled).toBe(1);

    const fields = await getFormFields(Buffer.from(unchecked.bytes));
    expect(fields.find((f) => f.fieldName === 'rat')?.value).toBe(false);
  });

  it('still takes the redact + re-add fallback when the widget GEOMETRY changed', async () => {
    const input = await pdfWithFields();
    const element = await parsedField(input, 'name');
    const moved = {
      ...element,
      bounds: { ...element.bounds, x: element.bounds.x + 40 },
    };

    const result = await applyOperations(input, [
      updateOp(moved as FormFieldElement, 'Moved', element.bounds),
    ]);

    // Design-mode move: the historical pipeline, not the fill path.
    expect(result.formFieldsFilled).toBe(0);
    expect(result.redactionTargetsCount).toBe(1);
    expect(result.addsApplied).toBe(1);
  });

  it('falls back to addFormField when the field is not in the AcroForm yet', async () => {
    const input = await pdfWithFields();
    const element = await parsedField(input, 'name');
    const ghost = {
      ...element,
      elementId: 'ghost-1',
      fieldName: 'freshly_designed',
    } as FormFieldElement;

    const result = await applyOperations(input, [
      updateOp(ghost, 'first value'),
    ]);

    // The fill failed (unknown field) → materialised via addFormField instead.
    expect(result.formFieldsFilled).toBe(0);
    expect(result.addsApplied).toBe(1);
    expect(result.redactionTargetsCount).toBe(0);

    const fields = await getFormFields(Buffer.from(result.bytes));
    const created = fields.filter((f) => f.fieldName === 'freshly_designed');
    expect(created).toHaveLength(1);
    expect(created[0]!.value).toBe('first value');
  });

  it('last queued value wins when several widgets of the SAME field update', async () => {
    const input = await pdfWithFields();
    const element = await parsedField(input, 'rat');

    // Sibling "Oui" overlay unchecks first (""), the clicked "non" queues last.
    const result = await applyOperations(input, [
      updateOp(element, ''),
      updateOp(element, 'non'),
    ]);
    expect(result.formFieldsFilled).toBe(1);

    const giga = await getEngine();
    const doc = giga.open(result.bytes);
    try {
      expect(doc.fields().find((f) => f.name === 'rat')?.value).toBe('non');
    } finally {
      doc.close();
    }
  });
});
