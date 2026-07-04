/**
 * Tests for POST /api/share/notify
 *
 * Strategy (mirrors app/api/office/__tests__/upload.test.ts):
 *   - Mock @/lib/auth-helpers to control auth outcomes
 *   - Mock @/lib/email/mailer so no e-mail provider is touched
 *   - Mock @/lib/server-logger and assert the token never reaches the logs
 *   - Directly invoke the POST handler with fake Request objects
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks (must be declared before imports) ───────────────────────────────────

vi.mock('@/lib/auth-helpers', () => ({
  requireSession: vi.fn(),
}));

vi.mock('@/lib/email/mailer', () => ({
  sendEmail: vi.fn(),
  getShareInvitationEmailTemplate: vi.fn(() => ({
    subject: 'stub-subject',
    html: '<p>stub</p>',
  })),
}));

vi.mock('@/lib/server-logger', () => ({
  serverLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('server-only', () => ({}));

import { POST } from '../notify/route';
import { requireSession } from '@/lib/auth-helpers';
import {
  sendEmail,
  getShareInvitationEmailTemplate,
} from '@/lib/email/mailer';
import { serverLogger } from '@/lib/server-logger';

const requireSessionMock = vi.mocked(requireSession);
const sendEmailMock = vi.mocked(sendEmail);
const templateMock = vi.mocked(getShareInvitationEmailTemplate);

const SESSION_OK = {
  ok: true as const,
  context: { userId: 'user-1', email: 'owner@example.com', role: 'user' },
};

const TOKEN = 'tok_secret_abcdefghijklmnop';

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/share/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    email: 'invitee@example.com',
    documentName: 'Contrat.pdf',
    permission: 'edit',
    inviterName: 'Rony',
    locale: 'fr',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSessionMock.mockResolvedValue(SESSION_OK);
  sendEmailMock.mockResolvedValue(true);
});

describe('POST /api/share/notify', () => {
  it('returns 401 without a session', async () => {
    requireSessionMock.mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 401 }),
    });

    const res = await POST(makeRequest(basePayload({ shareId: 'sh-1' })));

    expect(res.status).toBe(401);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('rejects a payload with neither invitationToken nor shareId', async () => {
    const res = await POST(makeRequest(basePayload()));

    expect(res.status).toBe(400);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('rejects a payload with BOTH invitationToken and shareId', async () => {
    const res = await POST(
      makeRequest(basePayload({ invitationToken: TOKEN, shareId: 'sh-1' })),
    );

    expect(res.status).toBe(400);
  });

  it('rejects an invalid email', async () => {
    const res = await POST(
      makeRequest(basePayload({ email: 'not-an-email', shareId: 'sh-1' })),
    );

    expect(res.status).toBe(400);
  });

  it('rejects a malformed invitation token', async () => {
    const res = await POST(
      makeRequest(basePayload({ invitationToken: '../evil?x=1' })),
    );

    expect(res.status).toBe(400);
  });

  it('existing account (shareId) → e-mail links to /shared', async () => {
    const res = await POST(makeRequest(basePayload({ shareId: 'sh-1' })));

    expect(res.status).toBe(200);
    expect(templateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        inviterName: 'Rony',
        documentName: 'Contrat.pdf',
        permission: 'edit',
        inviteeHasAccount: true,
        ctaUrl: expect.stringMatching(/\/shared$/),
      }),
      'fr',
    );
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'invitee@example.com',
        idempotencyKey: 'share-invite/sh-1',
      }),
    );
  });

  it('no account (invitationToken) → e-mail links to /invitations/{token}', async () => {
    const res = await POST(
      makeRequest(
        basePayload({ invitationToken: TOKEN, invitationId: 'inv-1', locale: 'en' }),
      ),
    );

    expect(res.status).toBe(200);
    expect(templateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        inviteeHasAccount: false,
        ctaUrl: expect.stringContaining(`/invitations/${TOKEN}`),
      }),
      'en',
    );
    // Idempotency anchored on the invitation ID — never the token.
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'share-invite/inv-1' }),
    );
  });

  it('falls back to the session identity when inviterName is missing', async () => {
    const res = await POST(
      makeRequest(basePayload({ inviterName: undefined, shareId: 'sh-1' })),
    );

    expect(res.status).toBe(200);
    expect(templateMock).toHaveBeenCalledWith(
      expect.objectContaining({ inviterName: 'owner@example.com' }),
      'fr',
    );
  });

  it('NEVER logs the invitation token', async () => {
    await POST(makeRequest(basePayload({ invitationToken: TOKEN })));

    const allLogArgs = JSON.stringify([
      ...vi.mocked(serverLogger.info).mock.calls,
      ...vi.mocked(serverLogger.warn).mock.calls,
      ...vi.mocked(serverLogger.error).mock.calls,
      ...vi.mocked(serverLogger.debug).mock.calls,
    ]);
    expect(allLogArgs).not.toContain(TOKEN);
  });

  it('returns 502 when the provider refuses the e-mail', async () => {
    sendEmailMock.mockResolvedValue(false);

    const res = await POST(makeRequest(basePayload({ shareId: 'sh-1' })));

    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });

  it('returns 400 on a non-JSON body', async () => {
    const res = await POST(
      new Request('http://localhost/api/share/notify', {
        method: 'POST',
        body: 'not-json',
      }),
    );

    expect(res.status).toBe(400);
  });
});
