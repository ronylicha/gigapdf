import type {
  PageBlockGroup,
  PageBlockTable,
  PageBlockTableCell,
  PageBlockList,
  PageBlockListItem,
} from '@giga-pdf/types';
import type { GigaBlock, GigaInline } from '@qrcommunication/gigapdf-lib';
import { getEngine } from '../wasm';

export type { PageBlockGroup } from '@giga-pdf/types';

// ---------------------------------------------------------------------------
// Block extractor — backed by the native engine's `pageBlocks(page)`.
//
// `pageBlocks(page)` returns the STRUCTURAL reconstruction of a page's flat
// glyph/path geometry: paragraphs, headings, lists, tables, images and shapes,
// in reading order. Each text run inside a block carries a `source_index` that
// points back to the editable content-stream operator — the SAME unified
// text-run index surfaced by `textElements().index` (see text-extractor.ts) and
// consumed by `replaceText` / `moveElement` / `removeElement`.
//
// This extractor exposes the lib as the authoritative SOURCE OF STRUCTURE while
// the per-run geometry/style stays owned by the proven text extractor: we emit
// only the GROUPING (which `source_index`es form one paragraph/heading, in what
// order), so the editor can coalesce its already-parsed flat `TextElement`s into
// Word-like blocks WITHOUT re-deriving per-run bounds or styles from the block
// `frame` (which would risk drift with the lossless decompose-save path that
// keys each run by its own bounds + engine index).
// ---------------------------------------------------------------------------

// `PageBlockGroup` is defined in `@giga-pdf/types` (shared with the editor) and
// re-exported above. A group reduces ONE engine block to what the editor needs
// to coalesce flat runs losslessly: its `kind` + the ordered, non-null
// `source_index`es of its runs (which map 1:1 onto the parsed `TextElement.index`
// of the same page, so the in-place edit pipeline keeps working unchanged).

/**
 * Read the `{ runs, style }` paragraph body of a paragraph OR heading block.
 * A heading nests its paragraph under `{ level, para: { runs, style } }` at
 * runtime, while the (older) flat shape carries `{ runs }` directly — read
 * both defensively so synthetic test blocks and every engine version work.
 */
function paragraphBody(
  block: GigaBlock,
): { runs?: unknown; style?: unknown } | undefined {
  const v = block.kind.v as
    | { runs?: unknown; style?: unknown; para?: { runs?: unknown; style?: unknown } }
    | undefined;
  if (!v || typeof v !== 'object') return undefined;
  if (block.kind.t === 'heading' && v.para && typeof v.para === 'object') {
    return v.para;
  }
  return v;
}

/** Read the `{ runs }` body of a paragraph/heading block defensively. */
function blockRuns(block: GigaBlock): GigaInline[] {
  const runs = paragraphBody(block)?.runs;
  return Array.isArray(runs) ? (runs as GigaInline[]) : [];
}

/**
 * ALL engine run indices carried by ONE inline run, reading BOTH the flat
 * typed shape (`{ t:'run', source_index, source_indices? }`) and the
 * runtime-wrapped shape (`{ t:'run', v:{ source_index, source_indices? } }`).
 * `source_indices` (present since lib 0.114) lists EVERY content-stream run
 * the span was coalesced from; the scalar `source_index` (its first entry) is
 * the backward-compatible fallback. Returns `[]` for a non-editable run.
 */
function inlineRunIndices(inline: unknown): number[] {
  if (!inline || typeof inline !== 'object') return [];
  if ((inline as { t?: unknown }).t !== 'run') return [];
  const wrapped = (inline as { v?: unknown }).v;
  const body =
    wrapped && typeof wrapped === 'object'
      ? (wrapped as { source_index?: number | null; source_indices?: unknown })
      : (inline as { source_index?: number | null; source_indices?: unknown });
  const multi = body.source_indices;
  if (Array.isArray(multi)) {
    const out = multi.filter(
      (n): n is number => typeof n === 'number' && n >= 0,
    );
    if (out.length > 0) return out;
  }
  const idx = body.source_index;
  return typeof idx === 'number' && idx >= 0 ? [idx] : [];
}

/**
 * The line structure + flat run indices of a paragraph/heading block.
 *
 * Walks the block's top-level inlines in order: every `run` contributes ALL of
 * its {@link inlineRunIndices} to the CURRENT line; a `{t:'br'}` hard break
 * closes the line; a `link` contributes its children's runs (they stay on the
 * current line — a link never spans a hard break). Empty lines (leading /
 * consecutive `br`s, or lines whose runs carry no editable index) are dropped,
 * so `lines.flat()` always equals `flat`.
 */
function paragraphLines(block: GigaBlock): {
  lines: number[][];
  flat: number[];
} {
  const lines: number[][] = [];
  const flat: number[] = [];
  let current: number[] = [];
  const closeLine = () => {
    if (current.length > 0) lines.push(current);
    current = [];
  };
  const pushRun = (inline: unknown) => {
    for (const idx of inlineRunIndices(inline)) {
      current.push(idx);
      flat.push(idx);
    }
  };
  for (const inline of blockRuns(block)) {
    if (!inline || typeof inline !== 'object') continue;
    const t = (inline as { t?: unknown }).t;
    if (t === 'br') {
      closeLine();
    } else if (t === 'run') {
      pushRun(inline);
    } else if (t === 'link') {
      const children = (inline as { children?: unknown }).children;
      if (Array.isArray(children)) for (const child of children) pushRun(child);
    }
  }
  closeLine();
  return { lines, flat };
}

/**
 * The PARAGRAPH-LEVEL formatting of a paragraph/heading block, reduced to the
 * additive {@link PageBlockGroup} fields: alignment, a line-height MULTIPLE
 * (only the `{t:'multiple'}` policy is portable without knowing the font
 * size), the block's top-down placement `frame`, and the first-line indent.
 * Every field is optional — a malformed/absent style simply contributes none.
 */
function paragraphGroupStyle(
  block: GigaBlock,
): Pick<
  PageBlockGroup,
  'align' | 'lineHeightMultiple' | 'frame' | 'firstLineIndentPt'
> {
  const out: Pick<
    PageBlockGroup,
    'align' | 'lineHeightMultiple' | 'frame' | 'firstLineIndentPt'
  > = {};

  const style = paragraphBody(block)?.style as
    | {
        align?: unknown;
        line_height?: { t?: unknown; v?: unknown };
        first_line_pt?: unknown;
      }
    | undefined;
  if (style && typeof style === 'object') {
    const align = style.align;
    if (
      align === 'left' ||
      align === 'center' ||
      align === 'right' ||
      align === 'justify'
    ) {
      out.align = align;
    }
    const lh = style.line_height;
    if (lh && lh.t === 'multiple' && typeof lh.v === 'number' && lh.v > 0) {
      out.lineHeightMultiple = lh.v;
    }
    if (typeof style.first_line_pt === 'number' && style.first_line_pt !== 0) {
      out.firstLineIndentPt = style.first_line_pt;
    }
  }

  const frame = block.frame;
  if (
    frame &&
    typeof frame.x === 'number' &&
    typeof frame.y === 'number' &&
    typeof frame.w === 'number' &&
    typeof frame.h === 'number' &&
    frame.w > 0 &&
    frame.h > 0
  ) {
    // The engine's `pageBlocks` frames are TOP-DOWN (origin top-left) — the
    // same space as the editor's element bounds; carried verbatim.
    out.frame = { x: frame.x, y: frame.y, width: frame.w, height: frame.h };
  }

  return out;
}

// ---------------------------------------------------------------------------
// Table / list structural mappers
//
// A `table` block body is `{ rows, col_widths, border }` where each row is
// `{ cells, height }` and each cell is `{ blocks, col_span, row_span, shading }`
// — `blocks` being NESTED paragraph/heading `GigaBlock`s. A `list` body is
// `{ ordered, marker, items }` where each item is `{ blocks, level }`.
//
// Inside a cell/item the run inline is wrapped: `{ t:'run', v:{ text, style,
// source_index } }` (the runtime shape; the typed `GigaInline` spells the flat
// `{ t:'run', source_index }` used by paragraphSourceIndices above). The helpers
// below read BOTH shapes defensively, and — crucially — many real PDFs emit
// `source_index: null` for cell/item runs (the glyphs still exist as flat
// `TextElement`s, rendered element-by-element). A cell/item whose runs have no
// usable index therefore yields an EMPTY `sourceIndices`; the renderer leaves it
// to the element-based path, so reconstructing tables/lists never regresses.
// ---------------------------------------------------------------------------

/** Runs of a nested paragraph/heading block, reading the runtime body shape. */
function nestedBlockRuns(block: GigaBlock | undefined): GigaInline[] {
  if (!block || typeof block !== 'object') return [];
  const kind = (block as { kind?: { t?: string; v?: unknown } }).kind;
  if (!kind || typeof kind.v !== 'object' || kind.v === null) return [];
  // A heading nests its paragraph under `{ level, para: { runs } }`; a paragraph
  // (and table-cell / list-item paragraphs) carries `{ runs }` directly.
  const body =
    kind.t === 'heading'
      ? ((kind.v as { para?: { runs?: unknown } }).para ?? {})
      : (kind.v as { runs?: unknown });
  const runs = (body as { runs?: unknown }).runs;
  return Array.isArray(runs) ? (runs as GigaInline[]) : [];
}

/**
 * Non-null `source_index` values of a list of nested blocks (a cell or a list
 * item), reading the wrapped `{ t:'run', v:{ source_index } }` runtime shape and
 * the flat `{ t:'run', source_index }` typed shape. Empty when no run carries an
 * index (→ element-based fallback for that cell/item).
 */
function nestedSourceIndices(blocks: unknown): number[] {
  const out: number[] = [];
  if (!Array.isArray(blocks)) return out;
  for (const block of blocks) {
    for (const inline of nestedBlockRuns(block as GigaBlock)) {
      // A coalesced lib run carries EVERY content-stream index it merged
      // (`source_indices`, lib ≥ 0.114); the scalar `source_index` is the
      // backward-compatible fallback. Both runtime shapes are handled.
      out.push(...inlineRunIndices(inline));
    }
  }
  return out;
}

/** Read the `{ rows, col_widths }` body of a table block into the editor model. */
function tableStructure(block: GigaBlock): PageBlockTable | null {
  const v = block.kind.v as
    | { rows?: unknown; col_widths?: unknown }
    | undefined;
  const rows = v?.rows;
  if (!Array.isArray(rows)) return null;

  const colWidths = Array.isArray(v?.col_widths)
    ? (v!.col_widths as unknown[]).map((n) => (typeof n === 'number' ? n : 0))
    : [];
  const rowHeights: number[] = [];
  const cells: PageBlockTableCell[] = [];
  let colCount = colWidths.length;

  rows.forEach((row, rowIndex) => {
    const rowBody = row as { cells?: unknown; height?: unknown } | undefined;
    rowHeights.push(typeof rowBody?.height === 'number' ? rowBody.height : 0);
    const rowCells = Array.isArray(rowBody?.cells) ? rowBody!.cells : [];
    let col = 0;
    for (const cellRaw of rowCells as unknown[]) {
      const cell = cellRaw as {
        blocks?: unknown;
        col_span?: unknown;
        row_span?: unknown;
      };
      const colSpan =
        typeof cell.col_span === 'number' && cell.col_span >= 1
          ? cell.col_span
          : 1;
      const rowSpan =
        typeof cell.row_span === 'number' && cell.row_span >= 1
          ? cell.row_span
          : 1;
      cells.push({
        row: rowIndex,
        col,
        colSpan,
        rowSpan,
        sourceIndices: nestedSourceIndices(cell.blocks),
      });
      col += colSpan;
    }
    colCount = Math.max(colCount, col);
  });

  return {
    rowCount: rows.length,
    colCount,
    colWidths,
    rowHeights,
    cells,
  };
}

/** Read the `{ ordered, marker, items }` body of a list block. */
function listStructure(block: GigaBlock): PageBlockList | null {
  const v = block.kind.v as
    | { ordered?: unknown; marker?: unknown; items?: unknown }
    | undefined;
  const items = v?.items;
  if (!Array.isArray(items)) return null;

  // marker is `{ t:'bullet'|'number'|…, v?: string }` — keep the glyph if any.
  const markerRaw = v?.marker as { v?: unknown } | undefined;
  const marker =
    markerRaw && typeof markerRaw.v === 'string' ? markerRaw.v : '•';

  const outItems: PageBlockListItem[] = items.map((itemRaw) => {
    const item = itemRaw as { blocks?: unknown; level?: unknown } | undefined;
    return {
      level: typeof item?.level === 'number' ? item.level : 0,
      sourceIndices: nestedSourceIndices(item?.blocks),
    };
  });

  return {
    ordered: v?.ordered === true,
    marker,
    items: outItems,
  };
}

/** Total editable runs a table reconstruction would resolve (across all cells). */
function tableResolvableRunCount(table: PageBlockTable): number {
  let n = 0;
  for (const cell of table.cells) n += cell.sourceIndices.length;
  return n;
}

/** Total editable runs a list reconstruction would resolve (across all items). */
function listResolvableRunCount(list: PageBlockList): number {
  let n = 0;
  for (const item of list.items) n += item.sourceIndices.length;
  return n;
}

/**
 * Convert the engine's `GigaBlock[]` for a page into the editor's grouping
 * model. Pure & deterministic.
 *
 * - `paragraph` / `heading` with ≥ 2 editable runs → a {@link PageBlockGroup}
 *   carrying the ordered `sourceIndices`; a single-run block is left out (the
 *   editor renders it as a standalone run, identical to today).
 * - `table` / `list` → a group carrying its structural reconstruction
 *   (`table` / `list` payload: grid of cells / ordered items, each with its own
 *   run indices). The group is emitted only when the reconstruction resolves at
 *   least one editable run (some cell/item maps to a `source_index`); otherwise
 *   it is dropped, because every run is a flat `TextElement` the editor already
 *   renders element-by-element (the common case → zero change vs today).
 * - Other kinds (`image`, `shape`, `textbox`, …) keep the element-based render.
 *
 * The renderer always falls back to element rendering for any cell/item whose
 * `sourceIndices` is empty, so a partially-resolvable table never doubles or
 * drops text.
 */
export function gigaBlocksToPageBlockGroups(blocks: GigaBlock[]): PageBlockGroup[] {
  const groups: PageBlockGroup[] = [];
  for (const block of blocks) {
    const kind = block.kind?.t;

    if (kind === 'paragraph' || kind === 'heading') {
      const { lines, flat: sourceIndices } = paragraphLines(block);
      // A lone run is not a multi-line block — the editor already renders single
      // runs as standalone IText, so grouping it would be a no-op (and the
      // decompose-save path expects ≥ 2 runs to be worth a Textbox).
      if (sourceIndices.length < 2) continue;
      // `lines` (the `{t:'br'}` structure) + the paragraph style/frame are
      // ADDITIVE: the editor's edit-intent session consumes them; every
      // pre-existing consumer keeps reading the flat `sourceIndices`.
      groups.push({
        kind,
        sourceIndices,
        lines,
        ...paragraphGroupStyle(block),
      });
      continue;
    }

    if (kind === 'table') {
      const table = tableStructure(block);
      // Emit only when the grid resolves at least one editable run; a table with
      // no `source_index`-bearing cell stays fully element-rendered (no regression).
      if (!table || tableResolvableRunCount(table) === 0) continue;
      groups.push({ kind, sourceIndices: [], table });
      continue;
    }

    if (kind === 'list') {
      const list = listStructure(block);
      if (!list || listResolvableRunCount(list) === 0) continue;
      groups.push({ kind, sourceIndices: [], list });
      continue;
    }
  }
  return groups;
}

/**
 * Extract the structural block groups for every page of a PDF, grouped by
 * 1-based page number. Opens the document once. Returns an empty map on failure
 * (the editor then falls back to its own heuristic paragraph grouping).
 */
export async function extractPageBlockGroupsByPage(
  pdfBytes: Buffer | ArrayBuffer | Uint8Array,
): Promise<Map<number, PageBlockGroup[]>> {
  const byPage = new Map<number, PageBlockGroup[]>();
  try {
    const giga = await getEngine();
    const bytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
    const doc = giga.open(bytes);
    try {
      const pageCount = doc.pageCount();
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
        const blocks = doc.pageBlocks(pageNumber);
        const groups = gigaBlocksToPageBlockGroups(blocks);
        if (groups.length > 0) byPage.set(pageNumber, groups);
      }
    } finally {
      doc.close();
    }
  } catch {
    // leave the map empty on failure — caller degrades to heuristic grouping
  }
  return byPage;
}

/** Block groups for a single page (convenience wrapper over the grouped map). */
export async function extractPageBlockGroups(
  pdfBytes: Buffer | ArrayBuffer | Uint8Array,
  pageNumber: number,
): Promise<PageBlockGroup[]> {
  return (await extractPageBlockGroupsByPage(pdfBytes)).get(pageNumber) ?? [];
}
