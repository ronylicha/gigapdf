/**
 * Embedded-font extraction (engine-backed) — the editor's overlay font source.
 *
 * Regression guard for the CERFA garbling: the legacy pikepdf/fontTools backend
 * synthesised a cmap assuming `gid == code`, which mis-mapped Unicode to the
 * wrong glyph for CFF/Type1 subset fonts (`M → U`). The engine path serves a
 * real sfnt with a correct `cmap`, so the served font always carries a `cmap`
 * table and is FontFace-loadable. These tests pin that contract.
 */
import { describe, it, expect } from 'vitest';
import { listDocumentFonts, getDocumentFont } from '../../src/fonts/extract-fonts';
import { loadFixture } from '../helpers';

const EMBEDDED_FONTS_PDF = 'embedded-fonts.pdf'; // one embedded TrueType (DejaVuSans)
const NO_FONTS_PDF = 'simple-text.pdf'; // no embedded fonts

/** True when `bytes` is a valid sfnt that carries a `cmap` table. */
function sfntHasCmap(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.byteLength < 12) return false;
  const version = view.getUint32(0);
  // 0x00010000 = TrueType, 'OTTO' = CFF OpenType, 'true'/'typ1' = legacy Mac.
  const validSfnt =
    version === 0x00010000 ||
    version === 0x4f54544f /* OTTO */ ||
    version === 0x74727565 /* true */ ||
    version === 0x74797031; /* typ1 */
  if (!validSfnt) return false;
  const numTables = view.getUint16(4);
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    if (rec + 16 > view.byteLength) break;
    if (view.getUint32(rec) === 0x636d6170 /* 'cmap' */) return true;
  }
  return false;
}

describe('listDocumentFonts', () => {
  it('returns engine-extracted metadata for an embedded TrueType font', async () => {
    const fonts = await listDocumentFonts(Buffer.from(loadFixture(EMBEDDED_FONTS_PDF)));
    expect(fonts.length).toBeGreaterThanOrEqual(1);

    const f = fonts[0]!;
    // PHYSICAL program identity (engine EmbeddedFontV2.fontId — 8-hex SHA-256
    // prefix of the decoded /FontFile* bytes), matching TextElementInfo.fontId.
    expect(f.fontId).toMatch(/^[0-9a-f]{8}$/);
    expect(f.subtype).toBe('TrueType');
    expect(f.isEmbedded).toBe(true); // truetype → browser-loadable
    expect(f.format).toBe('ttf');
    // The list is built cheaply from embeddedFontsV2() (no per-font extraction),
    // so size is not computed here — it stays null until the binary is fetched.
    expect(f.sizeBytes).toBeNull();
    expect(typeof f.originalName).toBe('string');
    expect(f.originalName.length).toBeGreaterThan(0);
    // One entry per PROGRAM: every /BaseFont alias wrapped around it is listed,
    // and originalName is the first alias.
    expect(Array.isArray(f.baseFonts)).toBe(true);
    expect(f.baseFonts.length).toBeGreaterThanOrEqual(1);
    expect(f.baseFonts[0]).toBe(f.originalName);
  });

  it('is deterministic — same document yields the same fontIds', async () => {
    const bytes = Buffer.from(loadFixture(EMBEDDED_FONTS_PDF));
    const a = await listDocumentFonts(bytes);
    const b = await listDocumentFonts(bytes);
    expect(a.map((f) => f.fontId)).toEqual(b.map((f) => f.fontId));
  });

  it('returns an empty list for a document with no embedded fonts', async () => {
    const fonts = await listDocumentFonts(Buffer.from(loadFixture(NO_FONTS_PDF)));
    expect(fonts).toEqual([]);
  });
});

describe('getDocumentFont', () => {
  it('serves a browser-loadable sfnt with a cmap table (regression guard)', async () => {
    const bytes = Buffer.from(loadFixture(EMBEDDED_FONTS_PDF));
    const [meta] = await listDocumentFonts(bytes);
    expect(meta).toBeDefined();

    const font = await getDocumentFont(bytes, meta!.fontId);
    expect(font).not.toBeNull();
    expect(font!.format).toBe('ttf');
    expect(font!.mimeType).toBe('font/ttf');
    expect(font!.dataBase64.length).toBeGreaterThan(0);

    const decoded = new Uint8Array(Buffer.from(font!.dataBase64, 'base64'));
    // A served font must be a real sfnt WITH a cmap — the broken legacy path
    // could emit a font whose Unicode→glyph mapping was absent/wrong.
    expect(sfntHasCmap(decoded)).toBe(true);
  });

  it('returns null for an unknown fontId', async () => {
    const bytes = Buffer.from(loadFixture(EMBEDDED_FONTS_PDF));
    const font = await getDocumentFont(bytes, 'deadbeefdeadbeef');
    expect(font).toBeNull();
  });
});
