/**
 * Tests for ShareDialog — the invitation e-mail dispatch (fire-and-forget).
 *
 * Covered:
 *   - after a successful shareDocument, /api/share/notify is called with
 *     shareId (existing account) or invitationToken (pending invitation)
 *   - a notify failure surfaces a NON-blocking warning toast and never
 *     breaks the share success path
 *   - a shareDocument failure never triggers the notify call
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ── Mocks (must be declared before imports) ───────────────────────────────────

const toastSpy = vi.fn();

vi.mock('next-intl', () => ({
  useTranslations: (ns?: string) => (key: string) => (ns ? `${ns}.${key}` : key),
  useLocale: () => 'fr',
}));

vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({
    data: { user: { name: 'Rony', email: 'owner@example.com' } },
  }),
}));

vi.mock('@/lib/client-logger', () => ({
  clientLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/api', () => ({
  api: {
    shareDocument: vi.fn(),
    getDocumentShares: vi.fn().mockResolvedValue({ shares: [], count: 0 }),
    revokeShare: vi.fn(),
    updateSharePermission: vi.fn(),
    createPublicLink: vi.fn(),
    revokePublicLink: vi.fn(),
  },
}));

vi.mock('@giga-pdf/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@giga-pdf/ui')>();
  return {
    ...actual,
    useToast: () => ({ toast: toastSpy }),
  };
});

import { ShareDialog } from '../share-dialog';
import { api } from '@/lib/api';

const shareDocumentMock = vi.mocked(api.shareDocument);

const INVITATION_BASE = {
  invitation_id: 'inv-1',
  token: 'tok_secret_abcdefghijklmnop',
  invitee_email: 'invitee@example.com',
  permission: 'edit' as const,
  expires_at: '2026-07-10T00:00:00Z',
  document_name: 'Contrat.pdf',
};

function renderDialog() {
  return render(
    <ShareDialog
      open
      onOpenChange={() => {}}
      documentId="doc-1"
      documentName="Contrat.pdf"
    />,
  );
}

async function submitShare(email = 'invitee@example.com') {
  renderDialog();
  fireEvent.change(screen.getByLabelText('sharing.dialog.email'), {
    target: { value: email },
  });
  fireEvent.click(
    screen.getByRole('button', { name: /sharing\.dialog\.share$/ }),
  );
  await waitFor(() => expect(shareDocumentMock).toHaveBeenCalled());
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getDocumentShares).mockResolvedValue({ shares: [], count: 0 });
  global.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ ok: true }), { status: 200 }),
  ) as unknown as typeof fetch;
});

describe('ShareDialog — invitation e-mail dispatch', () => {
  it('notifies with shareId when the invitee already has an account', async () => {
    shareDocumentMock.mockResolvedValue({
      ...INVITATION_BASE,
      invitee_user_exists: true,
      share_id: 'sh-1',
    });

    await submitShare();

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/share/notify',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    const body = JSON.parse(
      (vi.mocked(global.fetch).mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(body.shareId).toBe('sh-1');
    expect(body.invitationToken).toBeUndefined();
    expect(body.email).toBe('invitee@example.com');
    expect(body.documentName).toBe('Contrat.pdf');
    expect(body.inviterName).toBe('Rony');
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it('notifies with the invitation token when the invitee has no account', async () => {
    shareDocumentMock.mockResolvedValue({
      ...INVITATION_BASE,
      invitee_user_exists: false,
      share_id: null,
    });

    await submitShare();

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const body = JSON.parse(
      (vi.mocked(global.fetch).mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(body.invitationToken).toBe(INVITATION_BASE.token);
    expect(body.shareId).toBeUndefined();
  });

  it('shows a non-blocking warning toast when the e-mail dispatch fails', async () => {
    shareDocumentMock.mockResolvedValue({
      ...INVITATION_BASE,
      invitee_user_exists: true,
      share_id: 'sh-1',
    });
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: false }), { status: 502 }),
    );

    await submitShare();

    // The share itself still succeeds…
    expect(await screen.findByText('sharing.dialog.success')).toBeInTheDocument();
    // …and the e-mail failure only warns.
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith({
        title: 'sharing.dialog.emailWarning',
      }),
    );
  });

  it('does not call notify when the share itself fails', async () => {
    shareDocumentMock.mockRejectedValue(
      Object.assign(new Error('already shared'), { status: 400 }),
    );

    await submitShare();

    expect(await screen.findByText('sharing.dialog.error')).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
