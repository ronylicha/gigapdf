/**
 * PDF Parse-from-S3 route
 *
 * POST /api/pdf/parse-from-s3
 * Fetches a session document's PDF bytes from the Python backend (which serves
 * from S3/local storage), parses it with the TS pdf-engine, and returns the
 * full DocumentObject (scene graph).
 *
 * This replaces the stub GET /api/v1/documents/{document_id} response for the
 * "load stored document" flow. The Python session remains authoritative for
 * byte retrieval; the TS parser is authoritative for the scene graph.
 *
 * Request:
 *   Content-Type: application/json
 *   Authorization: Bearer <JWT>   (forwarded to Python)
 *   Body: { documentId: string }  (session document_id from /load response)
 *
 * Response (200):
 *   DocumentObject — full parsed scene graph
 *
 * Error codes:
 *   400  — Missing / invalid request body
 *   401  — Missing Authorization header
 *   404  — Session not found in Python (document_id expired or invalid)
 *   422  — PDF corrupted or unparseable
 *   500  — Unexpected server error
 *   504  — Downstream Python backend timeout
 */

import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  parseDocument,
  flattenFormXObjects,
} from '@giga-pdf/pdf-engine';
import {
  PDFParseError,
  PDFCorruptedError,
  PDFEncryptedError,
  PDFInvalidPasswordError,
} from '@giga-pdf/pdf-engine';
import { serverLogger } from '@/lib/server-logger';
import { attachPageBlockGroups } from '@/lib/pdf-block-groups';

// ─── Constants ─────────────────────────────────────────────────────────────────

/**
 * Internal URL of the Python FastAPI backend.
 *
 * Dev  : http://localhost:8000  (Python runs alongside Next.js)
 * Prod : http://127.0.0.1:8000  (loopback — nginx routes /api/v1/ externally,
 *         but we bypass nginx for the internal server-to-server call)
 *
 * Override via PYTHON_BACKEND_URL env var (server-side only, no NEXT_PUBLIC_).
 */
const PYTHON_BACKEND_URL =
  process.env.PYTHON_BACKEND_URL ??
  (process.env.NODE_ENV === 'production'
    ? 'http://127.0.0.1:8000'
    : 'http://localhost:8000');

/** Maximum time (ms) to wait for Python to stream back the PDF bytes. */
const DOWNLOAD_TIMEOUT_MS = 30_000;

// ─── Zod schema ────────────────────────────────────────────────────────────────

const RequestBodySchema = z.object({
  documentId: z
    .string({ error: 'documentId is required and must be a string' })
    .min(1, 'documentId cannot be empty'),
  /**
   * When true (the editor sets this), inline Form XObjects before parsing so
   * invoice/template text becomes editable in place. Read-only viewers (e.g.
   * the embed page) omit it, so viewing never rewrites the PDF.
   */
  flatten: z.boolean().optional().default(false),
});

// ─── Route Handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<Response> {
  // ── 1. Validate Authorization header ────────────────────────────────────────
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    serverLogger.warn('[api/pdf/parse-from-s3] Missing or malformed Authorization header');
    return NextResponse.json(
      { success: false, error: 'Authorization header is required (Bearer token).' },
      { status: 401 },
    );
  }

  // ── 2. Parse and validate request body ──────────────────────────────────────
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Request body must be valid JSON.' },
      { status: 400 },
    );
  }

  const parsed = RequestBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return NextResponse.json(
      { success: false, error: 'Invalid request body.', details: fieldErrors },
      { status: 400 },
    );
  }

  const { documentId, flatten } = parsed.data;

  // ── 3. Fetch PDF bytes from Python backend ───────────────────────────────────
  const downloadUrl = `${PYTHON_BACKEND_URL}/api/v1/documents/${documentId}/download`;

  serverLogger.info('[api/pdf/parse-from-s3] Fetching PDF bytes from Python', {
    documentId,
    url: downloadUrl,
  });

  let pdfBuffer: Buffer;
  try {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), DOWNLOAD_TIMEOUT_MS);

    let pythonResponse: globalThis.Response;
    try {
      pythonResponse = await fetch(downloadUrl, {
        method: 'GET',
        headers: {
          // Forward the incoming JWT — Python validates it
          Authorization: authHeader,
        },
        signal: abortController.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    // Session not found or expired
    if (pythonResponse.status === 404) {
      serverLogger.warn('[api/pdf/parse-from-s3] Document session not found in Python', {
        documentId,
      });
      return NextResponse.json(
        {
          success: false,
          error: `Document session '${documentId}' not found. It may have expired or never existed.`,
        },
        { status: 404 },
      );
    }

    // Auth rejected by Python (token expired, invalid, etc.)
    if (pythonResponse.status === 401 || pythonResponse.status === 403) {
      serverLogger.warn('[api/pdf/parse-from-s3] Python rejected auth token', {
        documentId,
        status: pythonResponse.status,
      });
      return NextResponse.json(
        { success: false, error: 'Authentication rejected by backend.' },
        { status: 401 },
      );
    }

    if (!pythonResponse.ok) {
      const body = await pythonResponse.text().catch(() => '');
      serverLogger.error('[api/pdf/parse-from-s3] Unexpected error from Python backend', {
        documentId,
        status: pythonResponse.status,
        body: body.slice(0, 500),
      });
      return NextResponse.json(
        { success: false, error: 'Failed to retrieve PDF from backend.' },
        { status: 502 },
      );
    }

    const arrayBuffer = await pythonResponse.arrayBuffer();
    pdfBuffer = Buffer.from(arrayBuffer);

    serverLogger.info('[api/pdf/parse-from-s3] PDF bytes received', {
      documentId,
      sizeBytes: pdfBuffer.byteLength,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      serverLogger.error('[api/pdf/parse-from-s3] Python backend timeout', {
        documentId,
        timeoutMs: DOWNLOAD_TIMEOUT_MS,
      });
      return NextResponse.json(
        { success: false, error: 'Backend timed out while retrieving PDF.' },
        { status: 504 },
      );
    }

    serverLogger.error('[api/pdf/parse-from-s3] Network error contacting Python backend', {
      documentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { success: false, error: 'Failed to connect to backend.' },
      { status: 502 },
    );
  }

  // ── 4. (Editor only) Flatten Form XObjects before parsing ────────────────────
  // Invoice/template text lives inside reusable Form XObjects, where it carries
  // a sentinel run index → the engine's in-place edit path can't touch it and
  // the editor falls back to the redact+add overlay. Inlining the form XObjects
  // turns that text into ordinary page runs with REAL indices, so editing works
  // in place. We must parse the *flattened* bytes (so `elements` line up) AND
  // hand the flattened PDF back to the client so its `currentPdfFile` (the
  // binary source of truth for save + raster) stays consistent with `elements`.
  //
  // No-op safety: when 0 forms are inlined (form-less PDFs, or re-loading an
  // already-flattened doc), `flattenForms` returns the original bytes untouched
  // and we add no new response fields — byte-identical to the legacy behaviour.
  let bytesToParse: Buffer = pdfBuffer;
  let flattenCount = 0;
  let flattenedPdfBase64: string | null = null;

  if (flatten) {
    try {
      const { bytes, count } = await flattenFormXObjects(pdfBuffer);
      flattenCount = count;
      if (count > 0) {
        bytesToParse = Buffer.from(bytes);
        flattenedPdfBase64 = bytesToParse.toString('base64');
        serverLogger.info('[api/pdf/parse-from-s3] Flattened form XObjects', {
          documentId,
          flattenCount: count,
        });
      }
    } catch (err) {
      // Flatten is an optimisation, never a hard requirement: on failure we
      // fall back to parsing the original bytes (legacy overlay-edit behaviour).
      serverLogger.warn('[api/pdf/parse-from-s3] flattenFormXObjects failed — parsing original', {
        documentId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── 5. Parse PDF bytes via TS pdf-engine ─────────────────────────────────────
  serverLogger.info('[api/pdf/parse-from-s3] Parsing PDF with pdf-engine', { documentId });

  try {
    const documentObject = await parseDocument(bytesToParse, {
      extractText: true,
      extractImages: true,
      extractAnnotations: true,
      extractFormFields: true,
      extractDrawings: true,
      documentId,
    });

    serverLogger.info('[api/pdf/parse-from-s3] Parse complete', {
      documentId,
      pageCount: documentObject.pages?.length ?? 0,
    });

    // Editor load (`flatten` set): attach the native engine's STRUCTURAL block
    // grouping per page so the editor coalesces paragraphs/headings from the
    // lib (the source of structure) instead of its positional heuristic. The
    // grouping is expressed as engine `source_index`es that map 1:1 onto the
    // parsed `TextElement.index`, so the lossless in-place edit path is reused
    // unchanged. Best-effort (see attachPageBlockGroups): a failure leaves
    // `blockGroups` unset and the editor degrades to its heuristic grouping.
    // Read-only viewers omit `flatten`, so their response shape is
    // byte-identical to before.
    if (flatten && Array.isArray(documentObject.pages)) {
      await attachPageBlockGroups(documentObject.pages, bytesToParse, '[api/pdf/parse-from-s3]', {
        documentId,
      });
    }

    // Only attach flatten fields when something was actually inlined, so the
    // form-less response shape is unchanged from before.
    const responseBody =
      flattenCount > 0
        ? { ...documentObject, flattenCount, flattenedPdfBase64 }
        : documentObject;

    return NextResponse.json(responseBody, { status: 200 });
  } catch (error: unknown) {
    if (error instanceof PDFEncryptedError || error instanceof PDFInvalidPasswordError) {
      return NextResponse.json(
        { success: false, error: 'PDF is encrypted and cannot be parsed without a password.' },
        { status: 422 },
      );
    }

    if (error instanceof PDFCorruptedError) {
      serverLogger.warn('[api/pdf/parse-from-s3] PDF is corrupted', { documentId });
      return NextResponse.json(
        { success: false, error: 'PDF file is corrupted and cannot be parsed.' },
        { status: 422 },
      );
    }

    if (error instanceof PDFParseError) {
      serverLogger.warn('[api/pdf/parse-from-s3] PDF parse error', {
        documentId,
        error: (error as Error).message,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to parse PDF document.' },
        { status: 422 },
      );
    }

    serverLogger.error('[api/pdf/parse-from-s3] Unexpected parse error', {
      documentId,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred while parsing the PDF.' },
      { status: 500 },
    );
  }
}
