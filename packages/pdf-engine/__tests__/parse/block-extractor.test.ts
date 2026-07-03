import { describe, it, expect } from 'vitest';
import type { GigaBlock } from '@qrcommunication/gigapdf-lib';
import { gigaBlocksToPageBlockGroups } from '../../src/parse/block-extractor';

// `gigaBlocksToPageBlockGroups` is a PURE mapper over the native engine's
// `pageBlocks` output — no WASM needed, so we drive it with synthetic blocks.

/** A run inline carrying the given `source_index` (flat typed shape). */
function run(source_index: number | null) {
  return {
    t: 'run',
    text: source_index === null ? 'synthetic' : `run ${source_index}`,
    style: {
      family: 'Helvetica',
      generic: 'sans',
      size_pt: 12,
      bold: false,
      italic: false,
      underline: false,
      strike: false,
      color: null,
      valign: 'baseline',
    },
    source_index,
  };
}

/** A nested paragraph `GigaBlock` (table cell / list item body), with runs. */
function paragraphInner(sourceIndices: Array<number | null>): unknown {
  return {
    id: 99,
    frame: null,
    rotation: { t: 'd0' },
    kind: { t: 'paragraph', v: { runs: sourceIndices.map(run) } },
  };
}

/** A paragraph/heading block carrying `runs` with the given source indices. */
function textBlock(
  kind: 'paragraph' | 'heading' | 'list' | 'table',
  sourceIndices: Array<number | null>,
): GigaBlock {
  return {
    id: 1,
    frame: { x: 0, y: 0, w: 100, h: 20 },
    rotation: { t: 'd0' },
    kind: {
      t: kind,
      v: { runs: sourceIndices.map(run) },
    },
  } as unknown as GigaBlock;
}

/**
 * A `table` block with `rows × cols` of cells; `grid[r][c]` is the array of
 * source indices of that cell's runs. Mirrors the engine runtime body
 * `{ rows: [{ cells: [{ blocks, col_span, row_span }], height }], col_widths }`.
 */
function tableBlock(grid: Array<Array<Array<number | null>>>): GigaBlock {
  const colCount = grid[0]?.length ?? 0;
  return {
    id: 64,
    frame: { x: 0, y: 0, w: 500, h: 200 },
    rotation: { t: 'd0' },
    kind: {
      t: 'table',
      v: {
        col_widths: Array.from({ length: colCount }, () => 100),
        border: { width: 0, color: [0, 0, 0] },
        rows: grid.map((row) => ({
          height: 20,
          cells: row.map((cellIndices) => ({
            blocks: [paragraphInner(cellIndices)],
            col_span: 1,
            row_span: 1,
            shading: null,
          })),
        })),
      },
    },
  } as unknown as GigaBlock;
}

/**
 * A `list` block whose items carry the given source indices. Mirrors the engine
 * runtime body `{ ordered, marker:{t,v}, items: [{ blocks, level }] }`.
 */
function listBlock(
  items: Array<Array<number | null>>,
  opts: { ordered?: boolean; marker?: string } = {},
): GigaBlock {
  return {
    id: 39,
    frame: { x: 0, y: 0, w: 300, h: 100 },
    rotation: { t: 'd0' },
    kind: {
      t: 'list',
      v: {
        ordered: opts.ordered ?? false,
        marker: { t: 'bullet', v: opts.marker ?? '-' },
        items: items.map((idxs) => ({
          blocks: [paragraphInner(idxs)],
          level: 0,
        })),
      },
    },
  } as unknown as GigaBlock;
}

describe('gigaBlocksToPageBlockGroups', () => {
  it('maps a paragraph block to its ordered source indices', () => {
    const groups = gigaBlocksToPageBlockGroups([textBlock('paragraph', [3, 4, 5])]);
    expect(groups).toMatchObject([{ kind: 'paragraph', sourceIndices: [3, 4, 5] }]);
  });

  it('maps a heading block too', () => {
    const groups = gigaBlocksToPageBlockGroups([textBlock('heading', [1, 2])]);
    expect(groups).toMatchObject([{ kind: 'heading', sourceIndices: [1, 2] }]);
  });

  it('drops null source indices (synthesised, non-editable runs)', () => {
    const groups = gigaBlocksToPageBlockGroups([textBlock('paragraph', [7, null, 8])]);
    expect(groups).toMatchObject([{ kind: 'paragraph', sourceIndices: [7, 8] }]);
  });

  it('skips a block left with a single editable run (not worth a Textbox)', () => {
    const groups = gigaBlocksToPageBlockGroups([textBlock('paragraph', [9, null])]);
    expect(groups).toHaveLength(0);
  });

  it('ignores image/shape/textbox kinds (kept element-rendered)', () => {
    const groups = gigaBlocksToPageBlockGroups([
      { id: 1, frame: null, rotation: { t: 'd0' }, kind: { t: 'image' } } as unknown as GigaBlock,
      { id: 2, frame: null, rotation: { t: 'd0' }, kind: { t: 'shape' } } as unknown as GigaBlock,
    ]);
    expect(groups).toHaveLength(0);
  });

  it('handles a malformed block body without throwing', () => {
    const broken = {
      id: 2,
      frame: null,
      rotation: { t: 'd0' },
      kind: { t: 'paragraph', v: { runs: 'not-an-array' } },
    } as unknown as GigaBlock;
    expect(gigaBlocksToPageBlockGroups([broken])).toHaveLength(0);
  });

  it('preserves multiple blocks in order', () => {
    const groups = gigaBlocksToPageBlockGroups([
      textBlock('heading', [1, 2]),
      // table with a `{runs}` body (no `rows`) is not a valid table → dropped.
      textBlock('table', [3]),
      textBlock('paragraph', [4, 5, 6]),
    ]);
    expect(groups).toMatchObject([
      { kind: 'heading', sourceIndices: [1, 2] },
      { kind: 'paragraph', sourceIndices: [4, 5, 6] },
    ]);
  });

  describe('table blocks', () => {
    it('reconstructs the grid with per-cell source indices', () => {
      const groups = gigaBlocksToPageBlockGroups([
        tableBlock([
          [[1, 2], [3]],
          [[4], [5, 6]],
        ]),
      ]);
      expect(groups).toHaveLength(1);
      const g = groups[0]!;
      expect(g.kind).toBe('table');
      expect(g.sourceIndices).toEqual([]);
      expect(g.list).toBeUndefined();
      const table = g.table!;
      expect(table.rowCount).toBe(2);
      expect(table.colCount).toBe(2);
      expect(table.colWidths).toEqual([100, 100]);
      expect(table.rowHeights).toEqual([20, 20]);
      expect(table.cells).toEqual([
        { row: 0, col: 0, colSpan: 1, rowSpan: 1, sourceIndices: [1, 2] },
        { row: 0, col: 1, colSpan: 1, rowSpan: 1, sourceIndices: [3] },
        { row: 1, col: 0, colSpan: 1, rowSpan: 1, sourceIndices: [4] },
        { row: 1, col: 1, colSpan: 1, rowSpan: 1, sourceIndices: [5, 6] },
      ]);
    });

    it('drops null source indices inside a cell', () => {
      const groups = gigaBlocksToPageBlockGroups([
        tableBlock([[[7, null, 8]]]),
      ]);
      expect(groups[0]!.table!.cells[0]!.sourceIndices).toEqual([7, 8]);
    });

    it('is dropped entirely when NO cell resolves an editable run (null path)', () => {
      // Mirrors real PDFs: every cell run carries `source_index: null`. The whole
      // table stays element-rendered → no group emitted (zero regression).
      const groups = gigaBlocksToPageBlockGroups([
        tableBlock([
          [[null], [null]],
          [[null], [null]],
        ]),
      ]);
      expect(groups).toHaveLength(0);
    });

    it('is emitted when at least one cell resolves a run', () => {
      const groups = gigaBlocksToPageBlockGroups([
        tableBlock([
          [[null], [42]],
          [[null], [null]],
        ]),
      ]);
      expect(groups).toHaveLength(1);
      expect(groups[0]!.kind).toBe('table');
    });
  });

  describe('list blocks', () => {
    it('reconstructs ordered items with marker + source indices', () => {
      const groups = gigaBlocksToPageBlockGroups([
        listBlock([[1, 2], [3]], { ordered: true, marker: '1.' }),
      ]);
      expect(groups).toHaveLength(1);
      const g = groups[0]!;
      expect(g.kind).toBe('list');
      expect(g.sourceIndices).toEqual([]);
      expect(g.table).toBeUndefined();
      expect(g.list).toEqual({
        ordered: true,
        marker: '1.',
        items: [
          { level: 0, sourceIndices: [1, 2] },
          { level: 0, sourceIndices: [3] },
        ],
      });
    });

    it('is dropped when NO item resolves an editable run (null path)', () => {
      const groups = gigaBlocksToPageBlockGroups([
        listBlock([[null], [null]]),
      ]);
      expect(groups).toHaveLength(0);
    });
  });

  it('mixes paragraph, table and list groups in document order', () => {
    const groups = gigaBlocksToPageBlockGroups([
      textBlock('paragraph', [1, 2]),
      tableBlock([[[3, 4]]]),
      listBlock([[5, 6]]),
    ]);
    expect(groups.map((g) => g.kind)).toEqual(['paragraph', 'table', 'list']);
  });
});

// ---------------------------------------------------------------------------
// Line structure + paragraph style (additive fields, lib ≥ 0.114)
// ---------------------------------------------------------------------------

/** A RUNTIME-shaped inline run: body wrapped under `.v` (what the wasm emits). */
function wrappedRun(
  source_index: number | null,
  source_indices?: number[],
): unknown {
  return {
    t: 'run',
    v: {
      text: `run ${source_index}`,
      style: {
        family: 'Times New Roman',
        generic: 'serif',
        size_pt: 10,
        bold: false,
        italic: false,
        underline: false,
        strike: false,
        color: null,
        valign: 'baseline',
      },
      source_index,
      ...(source_indices ? { source_indices } : {}),
    },
  };
}

/** A paragraph/heading block from RAW inlines + optional style/frame. */
function rawBlock(
  kind: 'paragraph' | 'heading',
  runs: unknown[],
  opts: {
    style?: Record<string, unknown>;
    frame?: { x: number; y: number; w: number; h: number } | null;
  } = {},
): GigaBlock {
  const para = { style: opts.style ?? {}, style_ref: null, runs };
  return {
    id: 5,
    frame: opts.frame === undefined ? null : opts.frame,
    rotation: { t: 'd0' },
    kind: {
      t: kind,
      // A heading nests its paragraph under `para` at runtime.
      v: kind === 'heading' ? { level: 2, para } : para,
    },
  } as unknown as GigaBlock;
}

describe('gigaBlocksToPageBlockGroups — line structure & paragraph style', () => {
  it('splits runs into lines on {t:"br"} and expands source_indices', () => {
    const groups = gigaBlocksToPageBlockGroups([
      rawBlock('paragraph', [
        wrappedRun(181, [181, 182]),
        { t: 'br' },
        wrappedRun(183, [183, 184]),
        { t: 'br' },
        wrappedRun(187),
      ]),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.lines).toEqual([[181, 182], [183, 184], [187]]);
    // The flat sourceIndices stay the flattening of the lines (compat).
    expect(groups[0]!.sourceIndices).toEqual([181, 182, 183, 184, 187]);
  });

  it('falls back to the scalar source_index when source_indices is absent', () => {
    const groups = gigaBlocksToPageBlockGroups([
      rawBlock('paragraph', [wrappedRun(3), { t: 'br' }, wrappedRun(4)]),
    ]);
    expect(groups[0]!.lines).toEqual([[3], [4]]);
    expect(groups[0]!.sourceIndices).toEqual([3, 4]);
  });

  it('reads a RUNTIME heading (para-nested) and its wrapped runs', () => {
    const groups = gigaBlocksToPageBlockGroups([
      rawBlock('heading', [wrappedRun(80, [80, 81, 82]), { t: 'br' }, wrappedRun(90)]),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.kind).toBe('heading');
    expect(groups[0]!.lines).toEqual([[80, 81, 82], [90]]);
  });

  it('drops empty lines (leading / consecutive brs) so lines.flat() === sourceIndices', () => {
    const groups = gigaBlocksToPageBlockGroups([
      rawBlock('paragraph', [
        { t: 'br' },
        wrappedRun(1),
        { t: 'br' },
        { t: 'br' },
        wrappedRun(2),
        { t: 'br' },
      ]),
    ]);
    expect(groups[0]!.lines).toEqual([[1], [2]]);
  });

  it('carries align / lineHeightMultiple / firstLineIndentPt / frame (top-down)', () => {
    const groups = gigaBlocksToPageBlockGroups([
      rawBlock('paragraph', [wrappedRun(1), { t: 'br' }, wrappedRun(2)], {
        style: {
          align: 'justify',
          line_height: { t: 'multiple', v: 1.05 },
          first_line_pt: 12.5,
          indent_left_pt: 44,
        },
        frame: { x: 44.38, y: 99.13, w: 506.6, h: 43.28 },
      }),
    ]);
    const g = groups[0]!;
    expect(g.align).toBe('justify');
    expect(g.lineHeightMultiple).toBeCloseTo(1.05);
    expect(g.firstLineIndentPt).toBeCloseTo(12.5);
    expect(g.frame).toEqual({ x: 44.38, y: 99.13, width: 506.6, height: 43.28 });
  });

  it('omits lineHeightMultiple for the non-portable {t:"points"/"normal"} policies', () => {
    const groups = gigaBlocksToPageBlockGroups([
      rawBlock('paragraph', [wrappedRun(1), wrappedRun(2)], {
        style: { align: 'left', line_height: { t: 'normal' } },
      }),
    ]);
    expect(groups[0]!.lineHeightMultiple).toBeUndefined();
    expect(groups[0]!.align).toBe('left');
  });

  it('folds a link inline into the current line (children runs contribute)', () => {
    const groups = gigaBlocksToPageBlockGroups([
      rawBlock('paragraph', [
        wrappedRun(1),
        { t: 'link', href: { t: 'url', v: 'https://x' }, children: [wrappedRun(2)] },
        { t: 'br' },
        wrappedRun(3),
      ]),
    ]);
    expect(groups[0]!.lines).toEqual([[1, 2], [3]]);
  });

  it('expands source_indices inside table cells too (nested runs)', () => {
    const cellBlock = {
      id: 9,
      frame: null,
      rotation: { t: 'd0' },
      kind: { t: 'paragraph', v: { runs: [wrappedRun(10, [10, 11])] } },
    };
    const groups = gigaBlocksToPageBlockGroups([
      {
        id: 64,
        frame: { x: 0, y: 0, w: 500, h: 200 },
        rotation: { t: 'd0' },
        kind: {
          t: 'table',
          v: {
            col_widths: [100],
            border: { width: 0, color: [0, 0, 0] },
            rows: [
              {
                height: 20,
                cells: [
                  { blocks: [cellBlock], col_span: 1, row_span: 1, shading: null },
                ],
              },
            ],
          },
        },
      } as unknown as GigaBlock,
    ]);
    expect(groups[0]!.table!.cells[0]!.sourceIndices).toEqual([10, 11]);
  });
});
