/**
 * Embedded-font binary route (engine-backed — replaces the legacy Python
 * pikepdf/fontTools endpoint at GET /api/v1/pdf/fonts/{documentId}/{fontId}).
 *
 * GET /api/pdf/fonts/{documentId}/{fontId}
 *   → { success, data: { fontId, dataBase64, format, mimeType, originalName } }
 *
 * `fontId` is the PHYSICAL program identity (engine `EmbeddedFontV2.fontId`,
 * the same value `textElements()` reports per run) — served via
 * `extractWebFontById`, which always yields a loadable sfnt with a union
 * `cmap` for an embedded program (incomplete subsets are served as-is, missing
 * glyphs render `.notdef`). A 404 is therefore RARE: only an id that matches
 * no embedded program (stale client cache, foreign document) or a bare
 * cff/type1 face no browser can load. The editor then falls back to its
 * Google-Fonts substitute — the LAST resort, never preferred over embedded
 * bytes.
 */

import 'server-only';

import { NextResponse } from 'next/server';
import { getDocumentFont } from '@giga-pdf/pdf-engine';
import { fetchSessionPdfBytes } from '@/lib/document-bytes';
import { serverLogger } from '@/lib/server-logger';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ documentId: string; fontId: string }> },
): Promise<Response> {
  const { documentId, fontId } = await params;
  if (!documentId || !fontId) {
    return NextResponse.json(
      { success: false, error: 'documentId and fontId are required.' },
      { status: 400 },
    );
  }

  const fetched = await fetchSessionPdfBytes(documentId, {
    authorization: request.headers.get('Authorization'),
    cookie: request.headers.get('Cookie'),
  });
  if (!fetched.ok) {
    return NextResponse.json(
      { success: false, error: fetched.error },
      { status: fetched.status },
    );
  }

  try {
    const font = await getDocumentFont(fetched.bytes, fontId);
    if (!font) {
      return NextResponse.json(
        {
          success: false,
          error: `Font '${fontId}' is not embedded or could not be loaded for the browser.`,
        },
        { status: 404 },
      );
    }
    return NextResponse.json({ success: true, data: font });
  } catch (err) {
    serverLogger.error('[api/pdf/fonts] Font binary extraction failed', {
      documentId,
      fontId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { success: false, error: 'Could not extract the font from the document.' },
      { status: 422 },
    );
  }
}
