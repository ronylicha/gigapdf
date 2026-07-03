/**
 * AcroForm filling via the zero-dependency WASM engine. We take a typed
 * snapshot of the fields first (via {@link getFormFields}) so we know each
 * field's kind and previous value, then dispatch every requested value to the
 * matching engine setter (`setTextField` / `setCheckbox` / `setRadio` /
 * `setChoice`). No pdf-lib.
 */

import { getEngine } from '../wasm';
import { PDFParseError } from '../errors';
import { getFormFields, type FillResult, type FormFieldInfo } from './reader';
import type { PDFDocumentHandle } from '../engine/document-handle';
import { markDirty } from '../engine/document-handle';
import type { FieldKind } from '@qrcommunication/gigapdf-lib';

export async function fillForm(
  buffer: Buffer,
  values: Record<string, string | boolean | string[]>,
): Promise<{ buffer: Buffer; results: FillResult[] }> {
  // Typed snapshot: field kind + current value, for dispatch and `oldValue`.
  const snapshot = new Map<string, FormFieldInfo>();
  for (const field of await getFormFields(buffer)) {
    snapshot.set(field.fieldName, field);
  }

  const giga = await getEngine();
  const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

  let doc;
  try {
    doc = giga.open(data);
  } catch (err) {
    throw new PDFParseError(
      `Failed to parse PDF: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  try {
    const results: FillResult[] = [];

    for (const [fieldName, newValue] of Object.entries(values)) {
      const info = snapshot.get(fieldName);
      const oldValue = info?.value ?? '';

      if (!info) {
        results.push({
          fieldName,
          success: false,
          oldValue,
          newValue,
          error: 'Field not found',
        });
        continue;
      }

      let ok = false;
      switch (info.fieldType) {
        case 'text':
          ok = doc.setTextField(fieldName, String(newValue));
          break;
        case 'checkbox':
          ok = doc.setCheckbox(fieldName, Boolean(newValue));
          break;
        case 'radio':
          ok = doc.setRadio(fieldName, String(newValue));
          break;
        case 'dropdown':
        case 'listbox': {
          const choices = Array.isArray(newValue)
            ? newValue.map(String)
            : [String(newValue)];
          ok = doc.setChoice(fieldName, choices);
          break;
        }
        default:
          results.push({
            fieldName,
            success: false,
            oldValue,
            newValue,
            error: 'Field type not supported for filling',
          });
          continue;
      }

      results.push({
        fieldName,
        success: ok,
        oldValue,
        newValue,
        ...(ok ? {} : { error: 'Engine rejected the value' }),
      });
    }

    return { buffer: Buffer.from(doc.save()), results };
  } finally {
    doc.close();
  }
}

/** Per-field outcome of {@link applyFieldValuesOnHandle}. */
export interface HandleFillResult {
  fieldName: string;
  success: boolean;
  error?: string;
}

/**
 * Fill EXISTING AcroForm fields on an already-open document handle — the
 * in-pipeline twin of {@link fillForm} used by `applyOperations` to route a
 * fill-mode `update` (value change, widget geometry untouched) through the real
 * form setters instead of the destructive redact + re-add fallback. Same
 * dispatch as {@link fillForm} (`setTextField` / `setCheckbox` / `setRadio` /
 * `setChoice`), plus:
 *
 *   - a checkbox whose value is a NAMED on-state (a non-boolean string, e.g.
 *     the `Oui`/`non` export pairs of multi-widget CERFA checkboxes) is set via
 *     `setCheckboxState`, which reaches ANY widget's export — `setCheckbox(true)`
 *     only ever reaches the first one;
 *   - `""` / `false` / `"Off"` uncheck every widget.
 *
 * The caller decides what to do with a failure (typically: fall back to
 * materialising the field via `addFormField` when it does not exist yet — a
 * design-mode creation not yet baked into the AcroForm).
 */
export function applyFieldValuesOnHandle(
  handle: PDFDocumentHandle,
  values: Record<string, string | boolean | string[]>,
): HandleFillResult[] {
  const doc = handle._doc;

  // Kind snapshot for dispatch (one `fields()` read for the whole batch).
  const kinds = new Map<string, FieldKind>();
  for (const field of doc.fields()) {
    kinds.set(field.name, field.kind);
  }

  const results: HandleFillResult[] = [];
  let anyApplied = false;

  for (const [fieldName, value] of Object.entries(values)) {
    const kind = kinds.get(fieldName);
    if (!kind || kind === 'unknown') {
      results.push({ fieldName, success: false, error: 'Field not found' });
      continue;
    }

    let ok = false;
    let unsupported = false;
    switch (kind) {
      case 'text':
        ok = doc.setTextField(fieldName, String(value));
        break;

      case 'checkbox': {
        if (typeof value === 'boolean') {
          ok = doc.setCheckbox(fieldName, value);
          break;
        }
        const state = Array.isArray(value) ? (value[0] ?? '') : value;
        if (state === '' || /^(off|false)$/i.test(state)) {
          // "" / false / "Off" → uncheck EVERY widget of the field.
          ok =
            typeof doc.setCheckboxState === 'function'
              ? doc.setCheckboxState(fieldName, 'Off')
              : doc.setCheckbox(fieldName, false);
        } else if (/^true$/i.test(state)) {
          ok = doc.setCheckbox(fieldName, true);
        } else {
          // Named on-state — reaches the matching widget's export (`/AS` per
          // widget), unlike setCheckbox(true) which only hits the first one.
          ok =
            typeof doc.setCheckboxState === 'function'
              ? doc.setCheckboxState(fieldName, state)
              : doc.setCheckbox(fieldName, true);
        }
        break;
      }

      case 'radio': {
        const selected = String(value);
        if (selected === '') {
          // AcroForm radio groups have no reliable "blank" state; an empty
          // value means "nothing selected here" (an unchecked sibling widget's
          // serialisation) — treat as a successful no-op rather than letting
          // the caller destructively re-add the group.
          ok = true;
        } else {
          ok = doc.setRadio(fieldName, selected);
        }
        break;
      }

      case 'combo':
      case 'list':
        ok = doc.setChoice(
          fieldName,
          Array.isArray(value) ? value.map(String) : [String(value)],
        );
        break;

      default:
        // pushbutton / signature — no value to fill.
        unsupported = true;
    }

    if (ok) anyApplied = true;
    results.push({
      fieldName,
      success: ok,
      ...(ok
        ? {}
        : {
            error: unsupported
              ? 'Field type not supported for filling'
              : 'Engine rejected the value',
          }),
    });
  }

  if (anyApplied) markDirty(doc);
  return results;
}
