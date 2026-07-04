/**
 * Tests for getShareInvitationEmailTemplate (lib/email/mailer.ts).
 *
 * The Resend SDK is mocked out — only the pure template builder is exercised:
 * bilingual subjects/CTA, link injection, and HTML-escaping of the
 * caller-supplied inviter/document names (they come from a POST body).
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('resend', () => ({
  Resend: vi.fn(() => ({ emails: { send: vi.fn() } })),
}));

vi.mock('@/lib/server-logger', () => ({
  serverLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { getShareInvitationEmailTemplate } from '../mailer';

const BASE = {
  inviterName: 'Rony',
  documentName: 'Contrat.pdf',
  permission: 'edit' as const,
  ctaUrl: 'https://giga-pdf.com/invitations/tok_abc',
  inviteeHasAccount: false,
};

describe('getShareInvitationEmailTemplate', () => {
  it('builds a French invitation for a new user', () => {
    const { subject, html } = getShareInvitationEmailTemplate(BASE, 'fr');

    expect(subject).toBe('Rony a partagé « Contrat.pdf » avec vous');
    expect(html).toContain("Voir l'invitation");
    expect(html).toContain('https://giga-pdf.com/invitations/tok_abc');
    expect(html).toContain('modification autorisée');
  });

  it('builds an English e-mail for an existing account pointing at /shared', () => {
    const { subject, html } = getShareInvitationEmailTemplate(
      {
        ...BASE,
        permission: 'view',
        ctaUrl: 'https://giga-pdf.com/shared',
        inviteeHasAccount: true,
      },
      'en',
    );

    expect(subject).toBe('Rony shared "Contrat.pdf" with you');
    expect(html).toContain('Open the shared document');
    expect(html).toContain('https://giga-pdf.com/shared');
    expect(html).toContain('read-only');
  });

  it('HTML-escapes caller-supplied names in the body', () => {
    const { html } = getShareInvitationEmailTemplate(
      {
        ...BASE,
        inviterName: '<script>alert(1)</script>',
        documentName: 'a"b<img src=x>',
      },
      'fr',
    );

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('a&quot;b&lt;img src=x&gt;');
  });
});
