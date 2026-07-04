/**
 * Tests for PublicDocumentViewer — the anonymous /public/[token] page body.
 *
 * Covered:
 *   - loading state while the token resolves
 *   - valid token → document name, page count/size, inline iframe on the
 *     public download endpoint, and a forced-download button (?dl=true)
 *   - invalid/expired token (404) → clear error state
 *   - network failure → error state AND the token never reaches the
 *     client logs (clientLogger/console)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

// vitest.config.ts runs with isolate:false — RTL auto-cleanup does not fire
// across files sharing the fork, so clean the DOM explicitly (repo convention).
afterEach(cleanup);

// ── Mocks (must be declared before imports) ───────────────────────────────────

vi.mock('next-intl', () => ({
  useTranslations: (ns?: string) => (key: string, values?: Record<string, unknown>) => {
    const base = ns ? `${ns}.${key}` : key;
    if (!values) return base;
    const inline = Object.entries(values)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join('|');
    return `${base}|${inline}`;
  },
}));

const clientLoggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@/lib/client-logger', () => ({ clientLogger: clientLoggerMock }));

// Logo pulls next/link — irrelevant here.
vi.mock('@/components/logo', () => ({
  Logo: () => <div data-testid="logo" />,
}));

import { PublicDocumentViewer } from '../public-document-viewer';

const TOKEN = 'tok-public-client-secret-xyz';

const INFO_PAYLOAD = {
  data: {
    document_name: 'Contrat 2026.pdf',
    page_count: 3,
    file_size_bytes: 2048,
    permission: 'view' as const,
  },
};

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let consoleLogSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  consoleLogSpy.mockRestore();
});

function mockFetchOnce(response: Response) {
  global.fetch = vi.fn().mockResolvedValue(response) as unknown as typeof fetch;
}

describe('PublicDocumentViewer — states', () => {
  it('shows a loading skeleton while resolving', async () => {
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {})) as unknown as typeof fetch;

    render(<PublicDocumentViewer token={TOKEN} />);

    expect(screen.getByTestId('public-viewer-loading')).toBeInTheDocument();
  });

  it('renders the document viewer for a valid token', async () => {
    mockFetchOnce(new Response(JSON.stringify(INFO_PAYLOAD), { status: 200 }));

    render(<PublicDocumentViewer token={TOKEN} />);

    expect(await screen.findByText('Contrat 2026.pdf')).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith(
      `/api/v1/sharing/public/${TOKEN}`,
      expect.objectContaining({ cache: 'no-store' }),
    );

    // Inline PDF preview on the public download endpoint.
    const frame = screen.getByTestId('public-viewer-frame');
    expect(frame).toHaveAttribute('src', `/api/v1/sharing/public/${TOKEN}/download`);

    // Robust fallback: forced download (?dl=true).
    const downloadLink = screen.getByRole('link', {
      name: /sharing\.publicPage\.download/,
    });
    expect(downloadLink).toHaveAttribute(
      'href',
      `/api/v1/sharing/public/${TOKEN}/download?dl=true`,
    );

    // Display metadata (page count + view-only).
    expect(
      screen.getByText('sharing.publicPage.pageCount|count=3'),
    ).toBeInTheDocument();
    expect(screen.getByText('sharing.publicPage.viewOnly')).toBeInTheDocument();
  });

  it('shows the invalid/expired state on a 404', async () => {
    mockFetchOnce(
      new Response(JSON.stringify({ detail: 'Public link not found or expired' }), {
        status: 404,
      }),
    );

    render(<PublicDocumentViewer token={TOKEN} />);

    expect(
      await screen.findByText('sharing.publicPage.notFoundTitle'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('sharing.publicPage.notFoundDescription'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('public-viewer-frame')).not.toBeInTheDocument();
  });

  it('shows the invalid state when the token is empty', async () => {
    global.fetch = vi.fn() as unknown as typeof fetch;

    render(<PublicDocumentViewer token="" />);

    expect(
      await screen.findByText('sharing.publicPage.notFoundTitle'),
    ).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('PublicDocumentViewer — token never leaks into client logs', () => {
  it('logs a static message only on network failure', async () => {
    global.fetch = vi
      .fn()
      .mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch;

    render(<PublicDocumentViewer token={TOKEN} />);

    expect(
      await screen.findByText('sharing.publicPage.notFoundTitle'),
    ).toBeInTheDocument();

    await waitFor(() => expect(clientLoggerMock.error).toHaveBeenCalled());
    const loggedArgs = [
      ...clientLoggerMock.error.mock.calls.flat(),
      ...clientLoggerMock.warn.mock.calls.flat(),
      ...clientLoggerMock.info.mock.calls.flat(),
      ...consoleErrorSpy.mock.calls.flat(),
      ...consoleLogSpy.mock.calls.flat(),
    ]
      .map((arg) => {
        try {
          return typeof arg === 'string' ? arg : JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      })
      .join(' ');
    expect(loggedArgs).not.toContain(TOKEN);
  });

  it('never logs anything on the happy path', async () => {
    mockFetchOnce(new Response(JSON.stringify(INFO_PAYLOAD), { status: 200 }));

    render(<PublicDocumentViewer token={TOKEN} />);

    await screen.findByText('Contrat 2026.pdf');
    expect(clientLoggerMock.error).not.toHaveBeenCalled();
    expect(clientLoggerMock.warn).not.toHaveBeenCalled();
  });
});
