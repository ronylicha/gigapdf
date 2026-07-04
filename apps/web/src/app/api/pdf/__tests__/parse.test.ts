/**
 * Tests for POST /api/pdf/parse — the editor's re-parse route (called after
 * every page operation: rotate, apply-elements, watermark, forms, …).
 *
 * Focus: the `blockGroups` opt-in flag. Without it, the first page op of a
 * session silently dropped the structural paragraph grouping that
 * /api/pdf/parse-from-s3 attaches on load (heuristic fallback until reload).
 * The route must:
 *   - attach `page.blockGroups` (per page, multi-line paragraph grouping)
 *     when the caller sends `blockGroups=true` (multipart) or
 *     `{ blockGroups: true }` (JSON documentId path);
 *   - leave the response byte-identical for callers that omit the flag
 *     (e.g. the documents page's plain text extraction);
 *   - stay best-effort: a grouping failure never breaks the 200 response.
 *
 * Strategy (mirrors compress.test.ts / merge-universal.test.ts):
 *   - Mock @giga-pdf/pdf-engine so the WASM engine never loads under jsdom.
 *     `parseDocument` returns a two-page scene graph; the mocked
 *     `extractPageBlockGroupsByPage` returns a multi-line paragraph group for
 *     page 1 only (page 2 must stay group-less).
 *   - Mock @/lib/auth + next/headers (this route uses auth.api.getSession
 *     directly), @/lib/server-logger and 'server-only'.
 *   - Drive POST directly with a fake Request whose formData()/json() resolve
 *     synchronously.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import type { PageBlockGroup } from '@giga-pdf/pdf-engine';

// ── jsdom polyfill: File.prototype.arrayBuffer / Blob.prototype.arrayBuffer ───
for (const proto of [File.prototype, Blob.prototype]) {
  if (!('arrayBuffer' in proto)) {
    Object.defineProperty(proto, 'arrayBuffer', {
      configurable: true,
      writable: true,
      value: function (this: Blob): Promise<ArrayBuffer> {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as ArrayBuffer);
          reader.onerror = () => reject(reader.error);
          reader.readAsArrayBuffer(this);
        });
      },
    });
  }
}

// ── Mocks (declared before route imports) ─────────────────────────────────────

vi.mock('@giga-pdf/pdf-engine', () => {
  const mkError = (name: string) =>
    class extends Error {
      constructor(message = name) {
        super(message);
        this.name = name;
      }
    };
  return {
    parseDocument: vi.fn(),
    extractPageBlockGroupsByPage: vi.fn(),
    PDFParseError: mkError('PDFParseError'),
    PDFCorruptedError: mkError('PDFCorruptedError'),
    PDFEncryptedError: mkError('PDFEncryptedError'),
    PDFInvalidPasswordError: mkError('PDFInvalidPasswordError'),
    PDFPageOutOfRangeError: mkError('PDFPageOutOfRangeError'),
  };
});

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}));

vi.mock('@/lib/server-logger', () => ({
  serverLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('server-only', () => ({}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { POST as parsePOST } from '../parse/route';
import { parseDocument, extractPageBlockGroupsByPage } from '@giga-pdf/pdf-engine';
import { auth } from '@/lib/auth';
import { serverLogger } from '@/lib/server-logger';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FAKE_PDF = new Uint8Array(
  Array.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n%%EOF', (c) => c.charCodeAt(0) & 0xff),
);

/**
 * Grouping of a MULTI-LINE paragraph: three text runs (engine source indices
 * 0/1/2) laid out on three visual lines — what the engine emits for a page
 * with wrapped body text.
 */
const MULTILINE_PARAGRAPH_GROUP: PageBlockGroup = {
  kind: 'paragraph',
  sourceIndices: [0, 1, 2],
  lines: [[0], [1], [2]],
};

/** Fresh two-page scene graph per test (attachPageBlockGroups mutates it). */
function makeDoc() {
  return {
    documentId: 'doc-1',
    pages: [
      { pageNumber: 1, elements: [] },
      { pageNumber: 2, elements: [] },
    ],
    metadata: { pageCount: 2 },
  };
}

function makeFile(name: string, content: Uint8Array, type = 'application/pdf'): File {
  const plain = new Uint8Array(new ArrayBuffer(content.byteLength));
  plain.set(content);
  return new File([plain], name, { type });
}

function makeMultipartRequest(fields: { key: string; value: File | string }[]): NextRequest {
  const fd = new FormData();
  for (const { key, value } of fields) fd.append(key, value);
  const req = new Request('http://localhost/api/pdf/parse', {
    method: 'POST',
    body: 'dummy',
    headers: { 'Content-Type': 'multipart/form-data; boundary=x' },
  });
  Object.defineProperty(req, 'formData', { value: () => Promise.resolve(fd) });
  return req as unknown as NextRequest;
}

function makeJsonRequest(body: unknown): NextRequest {
  const req = new Request('http://localhost/api/pdf/parse', {
    method: 'POST',
    body: 'dummy',
    headers: { 'Content-Type': 'application/json' },
  });
  Object.defineProperty(req, 'json', { value: () => Promise.resolve(body) });
  return req as unknown as NextRequest;
}

const pdfFile = () => makeFile('doc.pdf', FAKE_PDF);

const sessionOk = { user: { id: 'user-123', email: 'test@example.com' } };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/pdf/parse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth.api.getSession).mockResolvedValue(sessionOk as never);
    vi.mocked(parseDocument).mockResolvedValue(makeDoc() as never);
    vi.mocked(extractPageBlockGroupsByPage).mockResolvedValue(
      new Map([[1, [MULTILINE_PARAGRAPH_GROUP]]]),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects unauthenticated requests with 401', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const res = await parsePOST(
      makeMultipartRequest([{ key: 'file', value: pdfFile() }]),
    );
    expect(res.status).toBe(401);
  });

  it('attaches blockGroups to pages with multi-line text when blockGroups=true (multipart)', async () => {
    const res = await parsePOST(
      makeMultipartRequest([
        { key: 'file', value: pdfFile() },
        { key: 'blockGroups', value: 'true' },
      ]),
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      success: boolean;
      data: { pages: Array<{ pageNumber: number; blockGroups?: PageBlockGroup[] }> };
    };
    expect(json.success).toBe(true);
    expect(extractPageBlockGroupsByPage).toHaveBeenCalledTimes(1);
    // Page 1 carries the engine's multi-line paragraph grouping…
    expect(json.data.pages[0]?.blockGroups).toEqual([MULTILINE_PARAGRAPH_GROUP]);
    // …page 2 resolved no groups and stays group-less (no empty array).
    expect(json.data.pages[1]?.blockGroups).toBeUndefined();
  });

  it('does not compute nor attach blockGroups when the flag is omitted', async () => {
    const res = await parsePOST(
      makeMultipartRequest([{ key: 'file', value: pdfFile() }]),
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      success: boolean;
      data: { pages: Array<{ blockGroups?: PageBlockGroup[] }> };
    };
    expect(extractPageBlockGroupsByPage).not.toHaveBeenCalled();
    expect(json.data.pages[0]?.blockGroups).toBeUndefined();
    expect(json.data.pages[1]?.blockGroups).toBeUndefined();
  });

  it('is best-effort: a grouping failure still returns 200 without blockGroups', async () => {
    vi.mocked(extractPageBlockGroupsByPage).mockRejectedValue(new Error('engine boom'));

    const res = await parsePOST(
      makeMultipartRequest([
        { key: 'file', value: pdfFile() },
        { key: 'blockGroups', value: 'true' },
      ]),
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      success: boolean;
      data: { pages: Array<{ blockGroups?: PageBlockGroup[] }> };
    };
    expect(json.success).toBe(true);
    expect(json.data.pages[0]?.blockGroups).toBeUndefined();
    expect(serverLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('pageBlocks grouping failed'),
      expect.objectContaining({ error: 'engine boom' }),
    );
  });

  it('supports blockGroups on the JSON documentId path too', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        status: 200,
        ok: true,
        arrayBuffer: async () => FAKE_PDF.buffer.slice(0),
      })),
    );

    const res = await parsePOST(
      makeJsonRequest({
        documentId: '340111e2-a678-4ae6-81d9-64a0a189ee8f',
        blockGroups: true,
      }),
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      success: boolean;
      data: { pages: Array<{ blockGroups?: PageBlockGroup[] }> };
    };
    expect(extractPageBlockGroupsByPage).toHaveBeenCalledTimes(1);
    expect(json.data.pages[0]?.blockGroups).toEqual([MULTILINE_PARAGRAPH_GROUP]);
    expect(json.data.pages[1]?.blockGroups).toBeUndefined();
  });
});
