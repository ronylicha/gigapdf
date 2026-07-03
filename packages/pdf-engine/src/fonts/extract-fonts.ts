/**
 * Embedded-font extraction for the editor's overlay text layer.
 *
 * The editor renders editable text on top of a text-free page raster using the
 * document's OWN fonts (via the browser FontFace API). This module is the single
 * source of truth for serving those fonts — backed entirely by the gigapdf
 * engine (`embeddedFontsV2` + `extractWebFontById`), with ZERO external font
 * tooling (no pikepdf, no fontTools).
 *
 * Why `extractWebFontById` and not a name lookup: a form generator routinely
 * embeds DOZENS of same-family font wrapper dicts whose descriptors all share a
 * handful of physical `/FontFile*` programs, each wrapper carrying its own
 * *partial* `/ToUnicode`. A `/BaseFont` NAME lookup can land on a homonym
 * wrapper whose 2-entry map drops accents the program actually carries (the
 * "à/é lost on CERFA" bug). Resolving by the program's PHYSICAL identity
 * (`fontId` — 8-hex SHA-256 prefix of the decoded bytes, the same value
 * `textElements()` reports per run) pins the exact program, and the engine
 * serves it with a `cmap` rebuilt as the UNION of every wrapper's mapping —
 * **keeping the original glyphs** (no substitute), never rejected for an
 * incomplete map (missing glyphs render `.notdef`, accepted by design).
 *
 * One entry PER embedded **program** (deduplicated by `/FontFile*` stream): the
 * reference CERFA collapses from 74 wrapper names to 21 physical programs, one
 * of which is aliased by up to 35 `/BaseFont` names — all carried in
 * {@link ExtractedFontMeta.baseFonts} so the editor can match a run by any of
 * its aliases.
 */

import { openDocument, closeDocument } from '../engine';

/** Metadata for one embedded font program, consumed by the editor. */
export interface ExtractedFontMeta {
  /**
   * PHYSICAL program identity (engine `EmbeddedFontV2.fontId` — 8-hex SHA-256
   * prefix of the decoded `/FontFile*` bytes). Matches the per-run
   * `TextElementInfo.fontId` / `TextStyle.fontId`; cache + fetch key.
   */
  fontId: string;
  /** First `/BaseFont` alias of the program (subset prefix kept). */
  originalName: string;
  /** PostScript-ish name (subset prefix stripped from {@link originalName}). */
  postscriptName: string | null;
  /** Display family (variant suffixes stripped). */
  fontFamily: string | null;
  /** PDF font subtype label (TrueType / Type1 / …) from the embedded program. */
  subtype: string;
  /** Always true here — `extractWebFontById` yields a browser-loadable sfnt. */
  isEmbedded: boolean;
  /** True when the `/BaseFont` carries an `ABCDEF+` subset prefix. */
  isSubset: boolean;
  /** Browser binary format the binary endpoint serves. */
  format: 'ttf' | 'otf' | 'cff' | null;
  /** Unknown without extracting; the editor does not rely on it. */
  sizeBytes: number | null;
  /**
   * EVERY `/BaseFont` alias wrapped around this physical program (deduplicated,
   * sorted — includes {@link originalName}). A run resolved by NAME matches the
   * program when its `/BaseFont` equals ANY of these aliases.
   */
  baseFonts: string[];
}

/** Binary payload for one font, base64-encoded for JSON transport. */
export interface ExtractedFontBinary {
  fontId: string;
  dataBase64: string;
  format: 'ttf' | 'otf' | 'cff';
  mimeType: string;
  originalName: string;
}

const SUBSET_PREFIX = /^[A-Z]{6}\+/;

function isSubsetName(name: string): boolean {
  return SUBSET_PREFIX.test(name);
}

/** Best-effort display family: drop the subset prefix and variant suffixes. */
function fontFamilyOf(name: string): string {
  let f = name.replace(SUBSET_PREFIX, '');
  f = f.split(',')[0] ?? f; // "TimesNewRoman,Bold" → "TimesNewRoman"
  f = f.replace(/PS(-?(?:Bold|Italic|BoldItalic))?MT$/i, ''); // "TimesNewRomanPS-BoldMT" → "TimesNewRoman"
  f = f.replace(/-(?:Bold|Italic|BoldItalic|Roman|Regular)$/i, ''); // "Times-Bold" → "Times"
  f = f.replace(/MT$/i, '');
  return f.trim() || name.replace(SUBSET_PREFIX, '');
}

/** PDF subtype label + browser format from the engine's embedded-program kind. */
function describeFormat(format: 'truetype' | 'cff' | 'type1'): {
  subtype: string;
  browser: 'ttf' | 'otf';
} {
  if (format === 'truetype') return { subtype: 'TrueType', browser: 'ttf' };
  // CFF (Type1C) and Type1 are wrapped to OpenType (`OTTO`) by extractWebFontById.
  return { subtype: 'Type1', browser: 'otf' };
}

/**
 * List the document's embedded font PROGRAMS (one entry per physical
 * `/FontFile*` stream, via `embeddedFontsV2`) with the metadata the editor
 * needs. Cheap — no per-font extraction. Deterministic: the engine sorts by
 * `fontId`.
 */
export async function listDocumentFonts(bytes: Buffer): Promise<ExtractedFontMeta[]> {
  const handle = await openDocument(bytes);
  try {
    const out: ExtractedFontMeta[] = [];
    for (const program of handle._doc.embeddedFontsV2()) {
      const originalName = program.baseFonts[0] ?? '';
      const { subtype, browser } = describeFormat(program.format);
      out.push({
        fontId: program.fontId,
        originalName,
        postscriptName: originalName ? originalName.replace(SUBSET_PREFIX, '') : null,
        fontFamily: originalName ? fontFamilyOf(originalName) : null,
        subtype,
        isEmbedded: true,
        isSubset: isSubsetName(originalName),
        format: browser,
        sizeBytes: null,
        baseFonts: program.baseFonts,
      });
    }
    return out;
  } finally {
    closeDocument(handle);
  }
}

/**
 * Return the browser-loadable binary for one PHYSICAL font id (the engine's
 * `EmbeddedFontV2.fontId` / per-run `TextElementInfo.fontId`), or null when no
 * embedded program carries that id or the face cannot be made
 * FontFace-loadable (bare cff/type1 — rare). The served `cmap` is the UNION of
 * every wrapper's `code → Unicode` mapping, so accents present in ANY wrapper
 * survive; an incomplete subset is served as-is (missing glyphs → `.notdef`),
 * never rejected.
 */
export async function getDocumentFont(
  bytes: Buffer,
  fontId: string,
): Promise<ExtractedFontBinary | null> {
  const handle = await openDocument(bytes);
  try {
    const program = handle._doc
      .embeddedFontsV2()
      .find((p) => p.fontId === fontId);
    if (!program) return null;

    const web = handle._doc.extractWebFontById(fontId);
    if (!web) return null;
    // truetype → ttf, otf (wrapped CFF / OpenType) → otf; bare cff/type1 are
    // not FontFace-loadable.
    const format: 'ttf' | 'otf' | null =
      web.format === 'truetype' ? 'ttf' : web.format === 'otf' ? 'otf' : null;
    if (!format) return null;
    return {
      fontId,
      dataBase64: Buffer.from(web.bytes).toString('base64'),
      format,
      mimeType: format === 'ttf' ? 'font/ttf' : 'font/otf',
      originalName: program.baseFonts[0] ?? '',
    };
  } finally {
    closeDocument(handle);
  }
}
