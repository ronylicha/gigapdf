import { createHash } from 'node:crypto';
import type { TextElement } from '@giga-pdf/types';
import type { TextElementInfo } from '@qrcommunication/gigapdf-lib';
import { rgbToHex } from '../utils';
import { getEngine } from '../wasm';

// ---------------------------------------------------------------------------
// Text extractor — backed by the native engine's `textElements()` (no pdfjs).
//
// `textElements(page)` returns rich per-run text: bounds (user space, origin
// bottom-left), the resolved /BaseFont family + bold/italic, the effective
// point size, the RGB fill colour, and the baseline rotation. That removes the
// whole pdfjs operator-list colour-matching + font-resolution + Type3 dance —
// the engine resolves all of it natively.
//
// Coordinate mapping (proven numerically against the previous pdfjs output):
//   bounds.x      = run.x
//   bounds.y      = pageHeight - run.y - run.height   (run.height = 1.2·fontSize box)
//   bounds.width  = run.width                          (exact glyph advances)
//   bounds.height = run.fontSize
//   rotation      = -run.rotation  (viewport Y-down flips the sign; 0 stays 0)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// TextBlock — richer output for the Fabric.js editor
// ---------------------------------------------------------------------------

export interface TextBlock {
  /** Stable UUID derived from content + position hash */
  elementId: string;
  pageNumber: number;
  /** Concatenated text of all coalesced runs */
  content: string;
  /** Bounds in web coordinates (origin top-left, Y down) expressed in PDF points */
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  style: {
    /** Clean PostScript family name (e.g. "Calibri") */
    fontFamily: string;
    /** Font size in points */
    fontSize: number;
    fontWeight?: 'normal' | 'bold';
    fontStyle?: 'normal' | 'italic';
    /** Fill colour as #RRGGBB */
    color?: string;
    alignment?: 'left' | 'center' | 'right' | 'justify';
    /** Original font family (engine-resolved) */
    originalFont?: string;
    /**
     * PHYSICAL identity of the run's embedded font program (the engine's
     * `TextElementInfo.fontId` — 8-hex SHA-256 prefix of the `/FontFile*`
     * bytes, matching `EmbeddedFontV2.fontId` / `extractWebFontById`).
     * Absent when the font embeds no program (base-14, Type3).
     */
    fontId?: string;
  };
  direction?: 'ltr' | 'rtl';
  /** Rotation in degrees (0 for upright text) */
  rotation?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** `#rrggbb` from an engine RGB triple (`0..1` per channel). */
function colorHex(color: [number, number, number]): string {
  return rgbToHex(color[0], color[1], color[2]);
}

/** Format a 32-hex digest as a UUID v4-shaped id (RFC 4122 variant bits). */
function hashToUuid(hash: string): string {
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    '4' + hash.slice(13, 16),
    ((parseInt(hash[16]!, 16) & 0x3) | 0x8).toString(16) + hash.slice(17, 20),
    hash.slice(20, 32),
  ].join('-');
}

/**
 * Derive a stable UUID from the block content + position so the same text at
 * the same location always gets the same id (useful for diffing/editing the
 * coalesced TextBlock API).
 */
function deriveBlockId(content: string, x: number, y: number, page: number): string {
  const hash = createHash('sha256')
    .update(`${page}:${x.toFixed(2)}:${y.toFixed(2)}:${content}`)
    .digest('hex')
    .slice(0, 32);
  return hashToUuid(hash);
}

/**
 * Derive a deterministic UUID-shaped id from a seed (per-run text elements).
 * Seeded by `(page, type, text-run index)` — the engine's durable run identity —
 * so two parses of the same PDF produce identical elementIds for the same run.
 */
function deriveStableId(seed: string): string {
  return hashToUuid(createHash('sha256').update(seed).digest('hex').slice(0, 32));
}

// ---------------------------------------------------------------------------
// Text run grouping logic (TextBlock pass)
// ---------------------------------------------------------------------------

/** A single engine text run, enriched with computed web coordinates. */
interface TextRun {
  str: string;
  /** Grouping identity: family + weight + style. */
  fontKey: string;
  fontFamily: string;
  /** Exact `/BaseFont` (subset prefix kept) — the precise embedded-font key. */
  baseFont: string;
  /** Physical embedded-program id (`TextElementInfo.fontId`), '' when none. */
  fontId: string;
  bold: boolean;
  italic: boolean;
  fontSize: number;
  /** Y position in PDF coords (origin bottom-left). */
  pdfY: number;
  width: number;
  height: number;
  /** Web coords (top-left origin). */
  webX: number;
  webY: number;
  rotation: number;
  color: string;
}

const LINE_Y_TOLERANCE = 2;
const BLOCK_X_GAP = 6;

/** Group runs into visual lines (same Y ± tolerance), sorted by X within a line. */
function groupRunsIntoLines(runs: TextRun[]): TextRun[][] {
  if (runs.length === 0) return [];

  const sorted = [...runs].sort((a, b) => {
    const dy = b.pdfY - a.pdfY; // higher Y = closer to top in PDF space
    return Math.abs(dy) > LINE_Y_TOLERANCE ? dy : a.webX - b.webX;
  });

  const lines: TextRun[][] = [];
  let currentLine: TextRun[] = [sorted[0]!];

  for (let i = 1; i < sorted.length; i++) {
    const run = sorted[i]!;
    const lineRef = currentLine[0]!;
    if (Math.abs(run.pdfY - lineRef.pdfY) <= LINE_Y_TOLERANCE) {
      currentLine.push(run);
    } else {
      lines.push(currentLine);
      currentLine = [run];
    }
  }
  lines.push(currentLine);
  return lines;
}

/** Coalesce adjacent same-font runs on a line into single blocks. */
function coalesceLineRuns(line: TextRun[]): TextRun[][] {
  if (line.length === 0) return [];

  const groups: TextRun[][] = [];
  let currentGroup: TextRun[] = [line[0]!];

  for (let i = 1; i < line.length; i++) {
    const prev = currentGroup[currentGroup.length - 1]!;
    const curr = line[i]!;
    const sameFont =
      prev.fontKey === curr.fontKey && Math.abs(prev.fontSize - curr.fontSize) < 0.5;
    const closeEnough = curr.webX - (prev.webX + prev.width) <= BLOCK_X_GAP;

    if (sameFont && closeEnough) {
      currentGroup.push(curr);
    } else {
      groups.push(currentGroup);
      currentGroup = [curr];
    }
  }
  groups.push(currentGroup);
  return groups;
}

/** Detect alignment from the x-variance of a multi-line block's lines. */
function detectAlignment(
  lines: Array<{ startX: number; endX: number; midX: number }>,
): 'left' | 'center' | 'right' | 'justify' {
  if (lines.length < 2) return 'left';

  const startXs = lines.map((l) => l.startX);
  const endXs = lines.map((l) => l.endX);
  const midXs = lines.map((l) => l.midX);

  const variance = (arr: number[]) => {
    const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
    return arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
  };

  const ALIGN_TOLERANCE = 3; // points
  if (Math.sqrt(variance(startXs)) <= ALIGN_TOLERANCE) return 'left';
  if (Math.sqrt(variance(endXs)) <= ALIGN_TOLERANCE) return 'right';
  if (Math.sqrt(variance(midXs)) <= ALIGN_TOLERANCE) return 'center';
  return 'justify';
}

// ---------------------------------------------------------------------------
// extractTextElementsByPage — document-level extraction used by parser.ts
// ---------------------------------------------------------------------------

/** Map one engine text run to an editor `TextElement` (web coordinates).
 *  Exported for unit testing the `baseFont` → `style.originalFont` wiring. */
export function runToTextElement(run: TextElementInfo, pageHeight: number, pageNumber: number): TextElement {
  return {
    // Deterministic id seeded by (page, type, text-run index): parsing the SAME
    // PDF twice yields the SAME elementId — required for cross-session layer
    // persistence keying. The text-run index is the engine's durable identity
    // for the run (stable across position edits via `moveElement`).
    elementId: deriveStableId(`${pageNumber}:text:${run.index}`),
    type: 'text',
    // The engine text-run index drives true in-place editing downstream
    // (`replaceText`/`moveElement`/`removeElement`). A negative sentinel marks
    // FORM-XObject text the engine cannot edit in place — keep it as-is so the
    // apply pipeline recognises it as non-editable and falls back to redact+add.
    index: run.index,
    bounds: {
      x: run.x,
      y: pageHeight - run.y - run.height,
      width: run.width,
      height: run.fontSize,
    },
    transform: {
      // The editor renders in a Y-down viewport, so the user-space baseline
      // angle flips sign (0 stays 0 — avoid `-0`, which fails `toBe(0)`).
      rotation: run.rotation === 0 ? 0 : Math.round(-run.rotation),
      scaleX: 1,
      scaleY: 1,
      skewX: 0,
      skewY: 0,
    },
    layerId: null,
    locked: false,
    visible: true,
    content: run.text,
    style: {
      fontFamily: run.fontFamily,
      fontWeight: run.bold ? 'bold' : 'normal',
      fontStyle: run.italic ? 'italic' : 'normal',
      fontSize: run.fontSize,
      color: colorHex(run.color),
      opacity: 1,
      textAlign: 'left',
      lineHeight: 1.2,
      letterSpacing: 0,
      writingMode: 'horizontal-tb',
      direction:
        [...run.text].filter(
          (ch) => ch.codePointAt(0)! >= 0x0590 && ch.codePointAt(0)! <= 0x08ff,
        ).length >
        run.text.length * 0.4
          ? 'rtl'
          : 'ltr',
      underline: false,
      strikethrough: false,
      backgroundColor: null,
      verticalAlign: 'baseline',
      // FONT-FIDELITY KEY: carry the run's EXACT `/BaseFont` (subset prefix kept,
      // e.g. "ABCDEF+TimesNewRomanPSMT") resolved in the run's own scope (page or
      // form XObject), NOT the collapsed `fontFamily` ("Times New Roman"). The
      // editor's `getFontFaceName` matches this against the embedded FontFace by
      // exact subset name → the overlay renders with the SAME subset that painted
      // the run (exact metrics, no overlap). Empty `baseFont` (Type3 fonts) falls
      // back to the family so resolution still has a key.
      originalFont: run.baseFont || run.fontFamily || null,
      // PHYSICAL program identity (8-hex SHA-256 prefix of the `/FontFile*`
      // bytes) — name-ambiguity-proof: dozens of same-`/BaseFont` wrappers can
      // share one program, and a NAME lookup can land on a homonym wrapper
      // whose partial /ToUnicode drops accents. The editor feeds this to the
      // per-program font endpoint (`extractWebFontById`) so the run ALWAYS
      // renders with its own glyphs. Absent for runs whose font embeds no
      // program (base-14, Type3) — resolution then falls back to the name.
      fontId: run.fontId || undefined,
    },
    ocrConfidence: null,
    linkUrl: null,
    linkPage: null,
    // Positioned fragments for a justified / per-glyph-positioned run (a legal
    // footer): each carries the engine's exact page-space box, flipped into the
    // editor's Y-down web space exactly like the run itself. The renderer paints
    // one IText per fragment (1:1 with the render); all share this run's
    // elementId/index so editing still targets the whole run. Omitted for a
    // plain run (the common case) so its single box is used unchanged.
    segments:
      run.segments && run.segments.length > 0
        ? run.segments.map((s) => ({
            text: s.text,
            bounds: {
              x: s.x,
              y: pageHeight - s.y - s.height,
              width: s.width,
              height: run.fontSize,
            },
          }))
        : undefined,
  };
}

/**
 * Extract every text run from a PDF, grouped by 1-based page number, as editor
 * `TextElement` scene-graph objects. Opens the document once. Empty / zero-size
 * runs are skipped. Returns an empty map on failure.
 */
export async function extractTextElementsByPage(
  pdfBytes: Buffer | ArrayBuffer | Uint8Array,
): Promise<Map<number, TextElement[]>> {
  const byPage = new Map<number, TextElement[]>();
  try {
    const giga = await getEngine();
    const bytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
    const doc = giga.open(bytes);
    try {
      const pageCount = doc.pageCount();
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
        const pageHeight = doc.pageInfo(pageNumber).height;
        const elements: TextElement[] = [];
        for (const run of doc.textElements(pageNumber)) {
          if (!run.text || run.text.trim() === '' || run.fontSize < 0.1) continue;
          elements.push(runToTextElement(run, pageHeight, pageNumber));
        }
        if (elements.length > 0) byPage.set(pageNumber, elements);
      }
    } finally {
      doc.close();
    }
  } catch {
    // leave the map empty on failure
  }
  return byPage;
}

/** Text elements on a single page (convenience wrapper over the grouped map). */
export async function extractTextElements(
  pdfBytes: Buffer | ArrayBuffer | Uint8Array,
  pageNumber: number,
): Promise<TextElement[]> {
  return (await extractTextElementsByPage(pdfBytes)).get(pageNumber) ?? [];
}

// ---------------------------------------------------------------------------
// extractTextBlocks — rich coalesced API for the Fabric.js editor
// ---------------------------------------------------------------------------

/**
 * Extract text blocks with precise positions, real fonts, alignment detection,
 * and colour for use in the Fabric.js editor.
 *
 * Coordinates are in **web space** (origin top-left, Y increases downward),
 * expressed in PDF points (1 pt = 1/72 inch).
 *
 * @param pdfBytes - Raw PDF bytes (ArrayBuffer or Uint8Array)
 * @param pageNumber - 1-based page number. When omitted, all pages are processed.
 * @returns Array of TextBlock objects ordered top-left → bottom-right.
 */
export async function extractTextBlocks(
  pdfBytes: ArrayBuffer | Uint8Array,
  pageNumber?: number,
): Promise<TextBlock[]> {
  const allBlocks: TextBlock[] = [];
  const giga = await getEngine();
  const bytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
  const doc = giga.open(bytes);
  try {
    const pageCount = doc.pageCount();
    const pages =
      pageNumber !== undefined
        ? [Math.max(1, Math.min(pageNumber, pageCount))]
        : Array.from({ length: pageCount }, (_, i) => i + 1);

    for (const pgNum of pages) {
      const pageHeight = doc.pageInfo(pgNum).height;

      const runs: TextRun[] = [];
      for (const run of doc.textElements(pgNum)) {
        const text = run.text;
        if (!text || run.fontSize < 0.1) continue;
        runs.push({
          str: text,
          fontKey: `${run.fontFamily}|${run.bold ? 1 : 0}|${run.italic ? 1 : 0}`,
          fontFamily: run.fontFamily,
          baseFont: run.baseFont,
          fontId: run.fontId ?? '',
          bold: run.bold,
          italic: run.italic,
          fontSize: run.fontSize,
          pdfY: run.y,
          width: run.width,
          height: run.height,
          webX: run.x,
          webY: pageHeight - run.y - run.height,
          // Block rotation stays in user space (baseline angle), matching the
          // previous transform-matrix derivation.
          rotation: Math.round(run.rotation),
          color: colorHex(run.color),
        });
      }

      if (runs.length === 0) continue;

      const lines = groupRunsIntoLines(runs);
      for (const line of lines) {
        for (const group of coalesceLineRuns(line)) {
          if (group.length === 0) continue;
          const firstRun = group[0]!;
          const lastRun = group[group.length - 1]!;

          const content = group.map((r) => r.str).join('');
          if (!content.trim()) continue;

          const blockX = firstRun.webX;
          const blockY = Math.min(...group.map((r) => r.webY));
          const blockWidth = lastRun.webX + lastRun.width - firstRun.webX;
          const blockHeight = Math.max(...group.map((r) => r.height));

          const rtlCharCount = [...content].filter(
            (ch) => ch.codePointAt(0)! >= 0x0590 && ch.codePointAt(0)! <= 0x08ff,
          ).length;
          const direction: 'ltr' | 'rtl' =
            rtlCharCount > content.length * 0.4 ? 'rtl' : 'ltr';

          allBlocks.push({
            elementId: deriveBlockId(content, blockX, blockY, pgNum),
            pageNumber: pgNum,
            content,
            bounds: {
              x: blockX,
              y: blockY,
              width: Math.max(blockWidth, 1),
              height: Math.max(blockHeight, firstRun.fontSize),
            },
            style: {
              fontFamily: firstRun.fontFamily,
              fontSize: firstRun.fontSize,
              fontWeight: firstRun.bold ? 'bold' : 'normal',
              fontStyle: firstRun.italic ? 'italic' : 'normal',
              color: firstRun.color,
              alignment: 'left', // refined below
              // Exact `/BaseFont` (subset) for embedded-font matching; falls back
              // to the collapsed family for Type3 runs with no `/BaseFont`.
              originalFont: firstRun.baseFont || firstRun.fontFamily || undefined,
              // Physical program identity (engine `fontId`) — NOT a family slug.
              // Absent when the block's font embeds no program.
              fontId: firstRun.fontId || undefined,
            },
            direction,
            rotation: firstRun.rotation !== 0 ? firstRun.rotation : undefined,
          });
        }
      }

      // Second pass: detect alignment across stacked same-font blocks.
      const pageBlocks = allBlocks.filter((b) => b.pageNumber === pgNum);
      pageBlocks.sort((a, b) => {
        const dy = a.bounds.y - b.bounds.y;
        return Math.abs(dy) > 1 ? dy : a.bounds.x - b.bounds.x;
      });

      const visited = new Set<string>();
      for (const block of pageBlocks) {
        if (visited.has(block.elementId)) continue;
        const groupBlocks: TextBlock[] = [block];
        visited.add(block.elementId);

        for (const other of pageBlocks) {
          if (visited.has(other.elementId)) continue;
          if (
            other.style.fontFamily === block.style.fontFamily &&
            Math.abs(other.style.fontSize - block.style.fontSize) < 0.5 &&
            Math.abs(other.bounds.x - block.bounds.x) < block.bounds.width &&
            other.bounds.y - (block.bounds.y + block.bounds.height) <
              block.style.fontSize * 2.5
          ) {
            groupBlocks.push(other);
            visited.add(other.elementId);
          }
        }

        if (groupBlocks.length < 2) continue;
        const lineInfos = groupBlocks.map((b) => ({
          startX: b.bounds.x,
          endX: b.bounds.x + b.bounds.width,
          midX: b.bounds.x + b.bounds.width / 2,
        }));
        const alignment = detectAlignment(lineInfos);
        for (const b of groupBlocks) b.style.alignment = alignment;
      }
    }
  } finally {
    doc.close();
  }

  // Sort: page asc, then top-left → bottom-right within each page.
  allBlocks.sort((a, b) => {
    if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
    const dy = a.bounds.y - b.bounds.y;
    return Math.abs(dy) > 1 ? dy : a.bounds.x - b.bounds.x;
  });

  return allBlocks;
}
