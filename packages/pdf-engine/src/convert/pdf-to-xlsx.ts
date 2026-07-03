/**
 * PDF → XLSX converter.
 *
 * Strategy
 * --------
 * **Default path (no options)** — the engine's own model-based export:
 * `doc.toXlsx()` reconstructs the PDF into the unified editable model
 * (`reconstruct_model`) and lowers it through the same corrected exporter
 * family as `toDocx()`/`toOdt()`. Typed tables become real rows/cells (spans
 * merged, header rows bold) and every prose block lands as a single-cell row
 * in reading order — so the full document text is preserved, including runs
 * the positional heuristic below can mis-bucket or drop.
 *
 * **Tuned path (any option set)** — the historical pdfjs text-grid heuristic,
 * kept because its knobs (`pages`, `yTolerance`, `xTolerance`,
 * `separateSheets`) only make sense there:
 * 1. Extract TextBlocks with coordinates via extractTextBlocks().
 * 2. Group blocks into visual rows using a Y-band accumulation algorithm.
 * 3. Build a global column anchor list for the page by scanning all rows.
 * 4. Map every block to its closest column anchor and fill a 2-D matrix.
 * 5. Write the matrices to `.xlsx` via the native engine (`gridsToXlsx`), one
 *    sheet per page (configurable) — no third-party spreadsheet library.
 *
 * Limitations (tuned path)
 * ------------------------
 * - Fidelity depends entirely on the structural regularity of the source PDF.
 *   Free-form layouts (multi-column articles, newsletters) will produce noisy
 *   output because text blocks are placed in reading order but may not form
 *   aligned columns.
 * - Merged cells and spanning headers are not detected; each cell gets its
 *   text as a plain string.
 * - Images, drawings, and form fields are ignored — only text is extracted.
 * - Right-to-left and vertical text may be mis-ordered (RTL blocks appear in
 *   LTR extraction order from pdfjs).
 * - Rotated text (rotation != 0) is included but its bounding box position
 *   may not align well with surrounding horizontal text.
 */

import { getEngine } from '../wasm';
import { extractTextBlocks } from '../parse/text-extractor';
import type { TextBlock } from '../parse/text-extractor';

// ---------------------------------------------------------------------------
// PDF utility — page count
// ---------------------------------------------------------------------------

/** Return the total page count of a PDF via the zero-dependency WASM engine. */
async function getPageCount(buffer: Uint8Array): Promise<number> {
  const giga = await getEngine();
  const doc = giga.open(buffer);
  try {
    return doc.pageCount();
  } finally {
    doc.close();
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ConvertPdfToXlsxOptions {
  /**
   * Subset of page numbers to convert (1-based).
   * Default: all pages.
   */
  pages?: number[];

  /**
   * Maximum vertical distance (in PDF points) between TextBlock Y positions
   * for two blocks to be considered on the same visual row.
   * Default: 3.
   */
  yTolerance?: number;

  /**
   * Maximum horizontal distance (in PDF points) between a block's X position
   * and an existing column anchor for the block to snap to that anchor.
   * When the distance exceeds this value a new anchor is created.
   * Default: 5.
   */
  xTolerance?: number;

  /**
   * When true, each PDF page becomes a separate Worksheet named "Page N".
   * When false, all pages are concatenated into a single sheet named "Sheet1".
   * Default: true.
   */
  separateSheets?: boolean;
}

/**
 * Convert a PDF to XLSX by extracting text blocks and mapping them to a
 * spreadsheet grid.
 *
 * @param buffer - Raw PDF bytes.
 * @param options - Optional tuning parameters.
 * @returns XLSX file as a Uint8Array.
 *
 * @remarks
 * The extraction is heuristic. Well-structured tables (even horizontal lines,
 * consistent column positions) produce accurate output. Loosely laid-out PDFs
 * may require post-processing in Excel.
 */
export async function convertPdfToXlsx(
  buffer: Uint8Array,
  options?: ConvertPdfToXlsxOptions,
): Promise<Uint8Array> {
  // Default path: the engine's model-based export (see the module doc). Only
  // an explicitly tuned call falls through to the positional grid heuristic.
  const tuned =
    options !== undefined &&
    (options.pages !== undefined ||
      options.yTolerance !== undefined ||
      options.xTolerance !== undefined ||
      options.separateSheets !== undefined);
  if (!tuned) {
    const giga = await getEngine();
    const doc = giga.open(buffer);
    try {
      return doc.toXlsx();
    } finally {
      doc.close();
    }
  }

  const yTolerance = options?.yTolerance ?? 3;
  const xTolerance = options?.xTolerance ?? 5;
  const separateSheets = options?.separateSheets ?? true;

  // Resolve the total page count so we can create sheets even for pages that
  // yield no text (images-only, blank pages).
  const totalPages = await getPageCount(buffer);

  // Extract all text blocks in one pass so pdfjs only loads the document once.
  const allBlocks = await extractTextBlocks(buffer);

  // The full page range [1..totalPages].
  const allPageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1);

  // Honour the caller's pages filter; fall back to all pages.
  const requestedPages =
    options?.pages && options.pages.length > 0
      ? options.pages.filter((p) => p >= 1 && p <= totalPages)
      : allPageNumbers;

  const giga = await getEngine();

  if (separateSheets) {
    // One sheet ("Page N") per requested page; empty pages carry a note.
    const grids: string[][][] = [];
    const names: string[] = [];
    for (const pageNum of requestedPages) {
      const pageBlocks = allBlocks.filter((b) => b.pageNumber === pageNum);
      const matrix =
        pageBlocks.length === 0
          ? [[`No text extracted from page ${pageNum}`]]
          : buildMatrix(pageBlocks, yTolerance, xTolerance);
      grids.push(matrix);
      names.push(`Page ${pageNum}`);
    }
    return giga.gridsToXlsx(grids, names);
  }

  // All pages concatenated into a single sheet "Sheet1". A blank separator row
  // ([]) between pages survives in the output because the engine's writer keeps
  // the row-index gap (an all-empty row emits no <row>, leaving Excel a blank).
  const rows: string[][] = [];
  for (const pageNum of requestedPages) {
    const pageBlocks = allBlocks.filter((b) => b.pageNumber === pageNum);
    if (pageBlocks.length === 0) {
      rows.push([`— Page ${pageNum}: No text extracted —`]);
    } else {
      for (const row of buildMatrix(pageBlocks, yTolerance, xTolerance)) rows.push(row);
    }
    if (pageNum !== requestedPages[requestedPages.length - 1]) rows.push([]);
  }
  return giga.gridsToXlsx([rows], ['Sheet1']);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build a 2-D string matrix (rows × columns) from an array of TextBlocks
 * belonging to a single page.
 *
 * Algorithm:
 *  1. Expand multi-line blocks (those whose content contains "\n") into
 *     individual single-line blocks before processing, so that each physical
 *     line lands on its own logical row.
 *  2. Sort by Y (top-to-bottom in web coords, i.e. ascending Y).
 *  3. Group into visual rows using cumulative Y-band tracking: a new band
 *     is opened whenever the current block's Y differs from the band's
 *     reference Y by more than yTolerance.
 *  4. Build a global list of column anchors by scanning all rows.  A new
 *     anchor is appended when a block's X is more than xTolerance away from
 *     every existing anchor.
 *  5. For each row, assign each block to its nearest anchor column and
 *     concatenate content when multiple blocks map to the same cell.
 */
function buildMatrix(
  blocks: TextBlock[],
  yTolerance: number,
  xTolerance: number,
): string[][] {
  // Step 1 — Expand multi-line blocks.
  const expanded = expandMultilineBlocks(blocks);

  // Step 2 — Filter empty / whitespace-only, then sort top-to-bottom, left-to-right.
  const sorted = expanded
    .filter((b) => b.content.trim().length > 0)
    .sort((a, b) => {
      const dy = a.bounds.y - b.bounds.y;
      return Math.abs(dy) > yTolerance ? dy : a.bounds.x - b.bounds.x;
    });

  if (sorted.length === 0) return [];

  // Step 3 — Group blocks into visual rows.
  const rows = groupIntoRows(sorted, yTolerance);

  // Step 4 — Build the global column anchor list from all rows.
  const anchors = buildColumnAnchors(rows, xTolerance);

  if (anchors.length === 0) return [];

  // Step 5 — Build the matrix.
  const matrix: string[][] = [];

  for (const row of rows) {
    const cells = new Array<string>(anchors.length).fill('');

    for (const block of row) {
      const colIdx = nearestAnchorIndex(anchors, block.bounds.x, xTolerance);
      if (colIdx === -1) continue; // should not happen after buildColumnAnchors

      const existing = cells[colIdx]!;
      cells[colIdx] = existing.length > 0
        ? `${existing} ${block.content.trim()}`
        : block.content.trim();
    }

    matrix.push(cells);
  }

  return matrix;
}

/**
 * Expand TextBlocks whose content contains newline characters into one block
 * per physical line.  Each derived block inherits the parent's X position and
 * approximately stacks vertically using the font height as the line height.
 */
function expandMultilineBlocks(blocks: TextBlock[]): TextBlock[] {
  const result: TextBlock[] = [];

  for (const block of blocks) {
    const lines = block.content.split('\n');

    if (lines.length <= 1) {
      result.push(block);
      continue;
    }

    const lineHeight = block.bounds.height;

    for (let i = 0; i < lines.length; i++) {
      const lineContent = lines[i] ?? '';
      result.push({
        ...block,
        content: lineContent,
        elementId: `${block.elementId}-line${i}`,
        bounds: {
          ...block.bounds,
          y: block.bounds.y + i * lineHeight,
          height: lineHeight,
        },
      });
    }
  }

  return result;
}

/**
 * Group a sorted array of blocks into visual rows using Y-band accumulation.
 *
 * A "band" is started from the Y of the first block seen that has not yet been
 * assigned to a band.  All subsequent blocks within yTolerance of that Y are
 * placed in the same band.  This is more robust than a fixed grid because the
 * band reference Y tracks the first block seen in each band rather than
 * requiring perfect vertical alignment.
 */
function groupIntoRows(blocks: TextBlock[], yTolerance: number): TextBlock[][] {
  if (blocks.length === 0) return [];

  const rows: TextBlock[][] = [];
  let currentRow: TextBlock[] = [blocks[0]!];
  let bandY = blocks[0]!.bounds.y;

  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i]!;
    if (Math.abs(block.bounds.y - bandY) <= yTolerance) {
      currentRow.push(block);
    } else {
      rows.push(currentRow);
      currentRow = [block];
      bandY = block.bounds.y;
    }
  }

  rows.push(currentRow);
  return rows;
}

/**
 * Build a sorted list of column X anchors from all rows on the page.
 *
 * We scan every block in every row in left-to-right order and open a new
 * anchor whenever the block's X is more than xTolerance away from every
 * existing anchor.  Anchors are kept sorted in ascending X order so that
 * nearestAnchorIndex() can do a simple linear scan.
 */
function buildColumnAnchors(rows: TextBlock[][], xTolerance: number): number[] {
  const anchors: number[] = [];

  for (const row of rows) {
    for (const block of row) {
      const x = block.bounds.x;
      const existingIdx = findCloseAnchor(anchors, x, xTolerance);
      if (existingIdx === -1) {
        insertSorted(anchors, x);
      }
    }
  }

  return anchors;
}

/**
 * Find the index of an existing anchor within xTolerance of x.
 * Returns -1 if no such anchor exists.
 */
function findCloseAnchor(anchors: number[], x: number, xTolerance: number): number {
  for (let i = 0; i < anchors.length; i++) {
    if (Math.abs(anchors[i]! - x) <= xTolerance) return i;
  }
  return -1;
}

/**
 * Insert x into a sorted array in ascending order (in-place).
 */
function insertSorted(arr: number[], x: number): void {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid]! < x) lo = mid + 1;
    else hi = mid;
  }
  arr.splice(lo, 0, x);
}

/**
 * Return the index of the anchor closest to x.
 *
 * Since buildColumnAnchors already established the correct set of anchors
 * using xTolerance, we simply find the nearest one without an additional
 * radius guard. This ensures every block is mapped to exactly one column.
 *
 * Returns -1 only when the anchors array is empty.
 */
function nearestAnchorIndex(anchors: number[], x: number, _xTolerance: number): number {
  if (anchors.length === 0) return -1;

  let bestIdx = 0;
  let bestDist = Math.abs(anchors[0]! - x);

  for (let i = 1; i < anchors.length; i++) {
    const dist = Math.abs(anchors[i]! - x);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }

  return bestIdx;
}
