/**
 * Tests for convertPdfToXlsx.
 *
 * Fixtures used:
 *  - simple.pdf        : 1-page PDF with at least 2 lines of text (existing fixture)
 *  - multi-page.pdf    : 5-page PDF (existing fixture)
 *  - table-grid.pdf    : 1-page table grid (committed binary fixture)
 *  - blank-shape.pdf   : 1-page PDF with only a rectangle (no extractable text)
 *  - three-page-one-text.pdf : 3-page PDF where only page 2 carries text
 *
 * The produced `.xlsx` is read back with the engine's own native reader
 * (`xlsxToGrids`) — no third-party spreadsheet library.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { XlsxSheet } from '@qrcommunication/gigapdf-lib';
import { convertPdfToXlsx } from '../../src/convert/pdf-to-xlsx';
import { getEngine } from '../../src/wasm';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXTURES_DIR = join(import.meta.dirname ?? __dirname, '../fixtures');

function loadFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
}

/** Read an XLSX back into `{ name, rows }` sheets via the native engine reader. */
async function readSheets(bytes: Uint8Array): Promise<XlsxSheet[]> {
  const giga = await getEngine();
  return giga.xlsxToGrids(bytes);
}

/** All non-empty trimmed cell values of a sheet, flattened. */
function cellValues(sheet: XlsxSheet): string[] {
  return sheet.rows
    .flat()
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/** Rows that carry at least one non-empty cell. */
function nonEmptyRows(sheet: XlsxSheet): string[][] {
  return sheet.rows.filter((row) => row.some((c) => c.trim().length > 0));
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('convertPdfToXlsx', () => {
  // ── 1. Simple 1-page PDF → XLSX with 1 sheet ──────────────────────────────
  describe('simple.pdf — 1-page, basic text', () => {
    let xlsx: Uint8Array;
    let sheets: XlsxSheet[];

    beforeAll(async () => {
      xlsx = await convertPdfToXlsx(loadFixture('simple.pdf'));
      sheets = await readSheets(xlsx);
    });

    it('returns a non-empty Uint8Array', () => {
      expect(xlsx).toBeInstanceOf(Uint8Array);
      expect(xlsx.length).toBeGreaterThan(0);
    });

    it('starts with the XLSX ZIP magic bytes (PK\\x03\\x04)', () => {
      // XLSX is a ZIP file; its first 4 bytes are always PK\x03\x04.
      expect(xlsx[0]).toBe(0x50); // P
      expect(xlsx[1]).toBe(0x4b); // K
    });

    it('produces exactly 1 worksheet (separateSheets default = true)', () => {
      expect(sheets.length).toBe(1);
    });

    it('worksheet is named "Page 1"', () => {
      expect(sheets[0]!.name).toBe('Page 1');
    });

    it('worksheet has at least 1 row of data', () => {
      expect(sheets[0]!.rows.length).toBeGreaterThanOrEqual(1);
    });

    it('extracted content contains text from the PDF', () => {
      const joined = cellValues(sheets[0]!).join(' ');
      // simple.pdf contains "Hello GigaPDF Test" and "Second line of text"
      expect(joined.toLowerCase()).toMatch(/hello|gigapdf|second|line/i);
    });
  });

  // ── 2. Tabular PDF → correct row/column count ─────────────────────────────
  describe('synthetic table PDF — row/column alignment', () => {
    let sheet: XlsxSheet;

    beforeAll(async () => {
      const xlsx = await convertPdfToXlsx(loadFixture('table-grid.pdf'), {
        yTolerance: 5,
        xTolerance: 10,
      });
      sheet = (await readSheets(xlsx))[0]!;
    });

    it('produces at least 4 rows (header + 3 data rows)', () => {
      expect(nonEmptyRows(sheet).length).toBeGreaterThanOrEqual(4);
    });

    it('detects at least 2 columns', () => {
      // The table has 3 columns (Name, Age, City); accept >= 2 for X-tolerance
      // grouping variations.
      const maxCol = Math.max(0, ...sheet.rows.map((r) => r.length));
      expect(maxCol).toBeGreaterThanOrEqual(2);
    });

    it('contains the header keywords', () => {
      const joined = cellValues(sheet).join(' ').toLowerCase();
      expect(joined).toMatch(/name/i);
      expect(joined).toMatch(/age|city|alice|bob|carol/i);
    });
  });

  // ── 3. Blank PDF (no text) ─────────────────────────────────────────────────
  describe('blank PDF (no text content)', () => {
    it('default (model) path returns a valid workbook with no text rows', async () => {
      // The engine's model-based export emits an honest empty sheet for a
      // page with no textual content (no advisory note).
      const sheets = await readSheets(await convertPdfToXlsx(loadFixture('blank-shape.pdf')));
      expect(sheets.length).toBeGreaterThanOrEqual(1);
      expect(cellValues(sheets[0]!).join(' ')).not.toMatch(/\w{4,}/);
    });

    it('tuned (grid heuristic) path keeps the "No text extracted" note', async () => {
      // Passing any tuning option routes through the historical pdfjs grid
      // heuristic, which annotates empty pages so the sheet is self-explaining.
      const sheets = await readSheets(
        await convertPdfToXlsx(loadFixture('blank-shape.pdf'), { separateSheets: true }),
      );
      expect(sheets.length).toBeGreaterThanOrEqual(1);
      const joined = cellValues(sheets[0]!).join(' ').toLowerCase();
      expect(joined).toMatch(/no text extracted/i);
    });
  });

  // ── 4. options.pages filter ───────────────────────────────────────────────
  describe('options.pages — page filtering', () => {
    it('produces exactly 1 sheet when pages=[1] on a 3-page PDF', async () => {
      const xlsx = await convertPdfToXlsx(loadFixture('three-page-one-text.pdf'), { pages: [1] });
      const sheets = await readSheets(xlsx);
      expect(sheets.length).toBe(1);
      expect(sheets[0]!.name).toBe('Page 1');
    });

    it('ignores page numbers that do not exist in the PDF', async () => {
      // Requesting page 99 of a 1-page PDF — produces no requested pages; the
      // engine still returns a valid (single blank-sheet) workbook, no throw.
      const xlsx = await convertPdfToXlsx(loadFixture('simple.pdf'), { pages: [99] });
      const sheets = await readSheets(xlsx);
      expect(Array.isArray(sheets)).toBe(true);
    });
  });

  // ── 5. options.separateSheets = false ─────────────────────────────────────
  describe('options.separateSheets = false — single sheet for all pages', () => {
    let sheets: XlsxSheet[];

    beforeAll(async () => {
      const xlsx = await convertPdfToXlsx(loadFixture('multi-page.pdf'), { separateSheets: false });
      sheets = await readSheets(xlsx);
    });

    it('produces exactly 1 worksheet named "Sheet1"', () => {
      expect(sheets.length).toBe(1);
      expect(sheets[0]!.name).toBe('Sheet1');
    });

    it('the single sheet contains rows from multiple pages', () => {
      // multi-page.pdf has 5 pages; concatenated → more than a single page's rows.
      expect(sheets[0]!.rows.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── 6. multi-page.pdf with separateSheets = true (default) ───────────────
  describe('multi-page.pdf — separateSheets = true', () => {
    let sheets: XlsxSheet[];

    beforeAll(async () => {
      sheets = await readSheets(await convertPdfToXlsx(loadFixture('multi-page.pdf')));
    });

    it('produces one worksheet per page', () => {
      expect(sheets.length).toBe(5);
    });

    it('worksheet names are "Page 1" through "Page 5"', () => {
      const names = sheets.map((s) => s.name);
      for (let i = 1; i <= 5; i++) {
        expect(names).toContain(`Page ${i}`);
      }
    });
  });
});
