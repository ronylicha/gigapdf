/**
 * Share-invitation e-mail dispatch — POST /api/share/notify
 *
 * Fired by the ShareDialog (fire-and-forget) right after a successful
 * `POST /api/v1/sharing/share`. Sends the bilingual invitation e-mail:
 *   - invitee already has an account → share is ACTIVE (auto-activation),
 *     the e-mail links to /shared
 *   - invitee has no account → invitation is PENDING, the e-mail links to
 *     /invitations/{token} (accepted after sign-up)
 *
 * Payload (JSON):
 *   {
 *     email: string,                 // recipient
 *     documentName: string,
 *     permission: "view" | "edit",
 *     inviterName?: string,          // falls back to the session identity
 *     invitationToken?: string,      // PENDING flow  → /invitations/{token}
 *     shareId?: string,              // ACTIVE  flow  → /shared
 *     invitationId?: string,         // idempotency anchor (never the token)
 *     locale?: "fr" | "en",
 *   }
 *   Exactly ONE of invitationToken / shareId must be provided.
 *
 * Security:
 *   - requireSession(): only an authenticated user can trigger the send.
 *     Ownership of the underlying share was already enforced by the FastAPI
 *     backend when the share was created; this route only mails a link.
 *   - The invitation token is NEVER logged (it grants document access).
 *   - documentName / inviterName are HTML-escaped by the template.
 *
 * Responses:
 *   200 { ok: true }                    — e-mail accepted by the provider
 *   400 { ok: false, error }            — invalid payload
 *   401                                 — no session
 *   502 { ok: false, error }            — provider refused the e-mail
 */

import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-helpers';
import { sendEmail, getShareInvitationEmailTemplate } from '@/lib/email/mailer';
import { BRAND } from '@/lib/email/layout';
import { serverLogger } from '@/lib/server-logger';

// Production app URL for in-email links. Mirrors lib/email/mailer.ts: never
// NEXT_PUBLIC_APP_URL (inlined as localhost in bundles).
const appUrl = (process.env.EMAIL_APP_URL || BRAND.baseUrl).replace(/\/$/, '');

const MAX_NAME_LENGTH = 255;
const PERMISSIONS = ['view', 'edit'] as const;
type Permission = (typeof PERMISSIONS)[number];

// Deliberately loose (full RFC 5322 is counter-productive): the address was
// already validated as EmailStr by the FastAPI share endpoint.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type NotifyPayload = {
  email: string;
  documentName: string;
  permission: Permission;
  inviterName: string;
  invitationToken?: string;
  shareId?: string;
  invitationId?: string;
  locale: 'fr' | 'en';
};

function badRequest(error: string): NextResponse {
  return NextResponse.json({ ok: false, error }, { status: 400 });
}

function parsePayload(
  body: unknown,
  fallbackInviterName: string,
): { ok: true; payload: NotifyPayload } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'Invalid JSON body.' };
  }
  const b = body as Record<string, unknown>;

  const email = typeof b.email === 'string' ? b.email.trim() : '';
  if (!EMAIL_RE.test(email) || email.length > MAX_NAME_LENGTH) {
    return { ok: false, error: 'Invalid or missing "email".' };
  }

  const documentName =
    typeof b.documentName === 'string' ? b.documentName.trim() : '';
  if (!documentName || documentName.length > MAX_NAME_LENGTH) {
    return { ok: false, error: 'Invalid or missing "documentName".' };
  }

  const permission = b.permission;
  if (
    typeof permission !== 'string' ||
    !PERMISSIONS.includes(permission as Permission)
  ) {
    return { ok: false, error: '"permission" must be "view" or "edit".' };
  }

  const invitationToken =
    typeof b.invitationToken === 'string' && b.invitationToken.trim()
      ? b.invitationToken.trim()
      : undefined;
  const shareId =
    typeof b.shareId === 'string' && b.shareId.trim()
      ? b.shareId.trim()
      : undefined;
  if ((invitationToken ? 1 : 0) + (shareId ? 1 : 0) !== 1) {
    return {
      ok: false,
      error: 'Exactly one of "invitationToken" or "shareId" is required.',
    };
  }
  // Tokens are URL path segments — refuse anything that could break out.
  if (invitationToken && !/^[A-Za-z0-9_-]{16,255}$/.test(invitationToken)) {
    return { ok: false, error: 'Invalid "invitationToken".' };
  }

  const inviterName =
    typeof b.inviterName === 'string' && b.inviterName.trim()
      ? b.inviterName.trim().slice(0, MAX_NAME_LENGTH)
      : fallbackInviterName;

  const invitationId =
    typeof b.invitationId === 'string' && b.invitationId.trim()
      ? b.invitationId.trim().slice(0, 64)
      : undefined;

  const locale = b.locale === 'en' ? 'en' : 'fr';

  return {
    ok: true,
    payload: {
      email,
      documentName,
      permission: permission as Permission,
      inviterName,
      invitationToken,
      shareId,
      invitationId,
      locale,
    },
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response as NextResponse;
  const { email: sessionEmail } = authResult.context;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest('Invalid JSON body.');
  }

  const parsed = parsePayload(body, sessionEmail);
  if (!parsed.ok) return badRequest(parsed.error);
  const payload = parsed.payload;

  const inviteeHasAccount = payload.shareId !== undefined;
  const ctaUrl = inviteeHasAccount
    ? `${appUrl}/shared`
    : `${appUrl}/invitations/${encodeURIComponent(payload.invitationToken as string)}`;

  const { subject, html } = getShareInvitationEmailTemplate(
    {
      inviterName: payload.inviterName,
      documentName: payload.documentName,
      permission: payload.permission,
      ctaUrl,
      inviteeHasAccount,
    },
    payload.locale,
  );

  // Idempotency anchored on ids only — NEVER the token (it grants access and
  // must not leak to third-party metadata or logs).
  const idempotencyAnchor = payload.shareId ?? payload.invitationId;
  const sent = await sendEmail({
    to: payload.email,
    subject,
    html,
    idempotencyKey: idempotencyAnchor
      ? `share-invite/${idempotencyAnchor}`
      : undefined,
  });

  // Structured log without PII and without the token/link.
  serverLogger.info('share.notify', {
    sent,
    linkKind: inviteeHasAccount ? 'shared' : 'invitation',
    locale: payload.locale,
  });

  if (!sent) {
    return NextResponse.json(
      { ok: false, error: 'Email could not be sent.' },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
