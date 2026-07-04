import { Resend } from "resend";
import { serverLogger } from "@/lib/server-logger";
import { renderEmail, BRAND } from "./layout";

// Resend client. The API key lives in RESEND_API_KEY (server-only, never
// NEXT_PUBLIC_*). Instantiated lazily so the module can be imported on paths
// where it is never used without crashing at import time.
let client: Resend | undefined;

function getResend(): Resend {
  if (client) return client;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY environment variable is not set");
  }
  client = new Resend(apiKey);
  return client;
}

// From / reply-to identity. EMAIL_FROM is the verified Resend sender
// (e.g. noreply@giga-pdf.com — its domain MUST be verified in Resend).
const fromEmail = process.env.EMAIL_FROM || "noreply@giga-pdf.com";
const fromName = process.env.MAIL_FROM_NAME || BRAND.name;
const replyToEmail = process.env.EMAIL_REPLY_TO || BRAND.supportEmail;

// Production app URL used for in-email links that are NOT provided by the
// auth flow (e.g. the "Go to dashboard" CTA). Falls back to the brand domain
// rather than NEXT_PUBLIC_APP_URL, which is inlined as localhost in bundles.
const appUrl = (process.env.EMAIL_APP_URL || BRAND.baseUrl).replace(/\/$/, "");

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** Prevents duplicate sends on retry. Format: `<event>/<entity-id>`. */
  idempotencyKey?: string;
}

/**
 * Sends a transactional email through Resend.
 *
 * The Resend SDK does NOT throw on API errors — it returns `{ data, error }`.
 * We surface that error in the logs (the previous SMTP impl swallowed failures
 * silently, which is exactly why "emails weren't sending" went unnoticed).
 *
 * @returns true when Resend accepted the email, false otherwise.
 */
export async function sendEmail({
  to,
  subject,
  html,
  text,
  idempotencyKey,
}: SendEmailOptions): Promise<boolean> {
  try {
    const { data, error } = await getResend().emails.send(
      {
        from: `${fromName} <${fromEmail}>`,
        to: [to],
        replyTo: replyToEmail,
        subject,
        html,
        text: text || html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
      },
      idempotencyKey ? { idempotencyKey } : undefined,
    );

    if (error) {
      serverLogger.error("email.send-failed", { name: error.name, message: error.message });
      return false;
    }

    serverLogger.info("email.sent", { id: data?.id });
    return true;
  } catch (error) {
    // Reaches here on missing API key or network failure (not API errors).
    serverLogger.error("email.send-exception", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Templates — each returns { subject, html } built on the shared brand layout.
// ──────────────────────────────────────────────────────────────────────────

export function getWelcomeEmailTemplate(
  userName: string,
  locale: string = "fr",
): { subject: string; html: string } {
  const isEnglish = locale === "en";

  const subject = isEnglish
    ? `Welcome to GigaPDF, ${userName}!`
    : `Bienvenue sur GigaPDF, ${userName} !`;

  const features = isEnglish
    ? [
        "Create, edit and annotate PDF documents",
        "Collaborate in real time",
        "Add signatures, forms and stamps",
        "Convert documents to and from many formats",
      ]
    : [
        "Créer, modifier et annoter des documents PDF",
        "Collaborer en temps réel",
        "Ajouter signatures, formulaires et tampons",
        "Convertir des documents depuis et vers de nombreux formats",
      ];

  const intro = isEnglish
    ? "Thanks for creating your GigaPDF account. You now have access to our full suite of PDF editing tools — right in your browser."
    : "Merci d'avoir créé votre compte GigaPDF. Vous avez désormais accès à toute notre suite d'outils d'édition PDF — directement dans votre navigateur.";

  const bodyHtml = `
    <p style="margin: 0 0 20px;">${isEnglish ? `Hi <strong>${userName}</strong>,` : `Bonjour <strong>${userName}</strong>,`}</p>
    <p style="margin: 0 0 22px;">${intro}</p>
    <p style="margin: 0 0 12px; font-weight: 600; color: #0F172A;">${isEnglish ? "Here's what you can do:" : "Voici ce que vous pouvez faire :"}</p>
    <ul style="margin: 0 0 8px; padding-left: 20px; line-height: 1.9;">
      ${features.map((f) => `<li>${f}</li>`).join("")}
    </ul>`;

  const html = renderEmail({
    locale,
    preview: isEnglish
      ? "Your GigaPDF account is ready."
      : "Votre compte GigaPDF est prêt.",
    subtitle: isEnglish ? "Welcome aboard" : "Bienvenue à bord",
    heading: isEnglish ? `Welcome, ${userName}!` : `Bienvenue, ${userName} !`,
    bodyHtml,
    cta: {
      label: isEnglish ? "Go to my dashboard" : "Accéder à mon tableau de bord",
      url: `${appUrl}/dashboard`,
    },
  });

  return { subject, html };
}

export function getPasswordResetEmailTemplate(
  resetUrl: string,
  locale: string = "fr",
): { subject: string; html: string } {
  const isEnglish = locale === "en";

  const subject = isEnglish
    ? "Reset your GigaPDF password"
    : "Réinitialisez votre mot de passe GigaPDF";

  const bodyHtml = `
    <p style="margin: 0 0 20px;">${
      isEnglish
        ? "We received a request to reset the password for your GigaPDF account. Click the button below to choose a new one."
        : "Nous avons reçu une demande de réinitialisation du mot de passe de votre compte GigaPDF. Cliquez sur le bouton ci-dessous pour en choisir un nouveau."
    }</p>
    <p style="margin: 22px 0 0; color: #64748B; font-size: 13px; line-height: 1.6; word-break: break-all;">
      ${isEnglish ? "If the button doesn't work, copy and paste this link:" : "Si le bouton ne fonctionne pas, copiez-collez ce lien :"}<br />
      <a href="${resetUrl}" style="color: ${BRAND.colors.primary};">${resetUrl}</a>
    </p>`;

  const html = renderEmail({
    locale,
    preview: isEnglish
      ? "Reset your GigaPDF password — link valid for 1 hour."
      : "Réinitialisez votre mot de passe GigaPDF — lien valable 1 heure.",
    subtitle: isEnglish ? "Password reset" : "Réinitialisation du mot de passe",
    heading: isEnglish ? "Reset your password" : "Réinitialiser votre mot de passe",
    bodyHtml,
    cta: {
      label: isEnglish ? "Reset my password" : "Réinitialiser mon mot de passe",
      url: resetUrl,
    },
    footerNote: isEnglish
      ? "If you didn't request this, you can safely ignore this email — your password won't change. This link expires in 1 hour."
      : "Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email — votre mot de passe restera inchangé. Ce lien expire dans 1 heure.",
  });

  return { subject, html };
}

/**
 * Escapes HTML-special characters. Share e-mails interpolate caller-supplied
 * strings (document name, inviter name from a POST body) into the HTML body —
 * unlike the auth templates whose inputs come from our own account records.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface ShareInvitationEmailParams {
  /** Display name (or e-mail) of the person sharing the document. */
  inviterName: string;
  documentName: string;
  permission: "view" | "edit";
  /** Absolute link — /shared for existing accounts, /invitations/{token} otherwise. */
  ctaUrl: string;
  /**
   * When true the share is already ACTIVE (auto-activated for an existing
   * account) — the e-mail points at "Shared with me". When false the invitee
   * has no account yet and must open the invitation link to accept it.
   */
  inviteeHasAccount: boolean;
}

export function getShareInvitationEmailTemplate(
  params: ShareInvitationEmailParams,
  locale: string = "fr",
): { subject: string; html: string } {
  const { permission, ctaUrl, inviteeHasAccount } = params;
  const isEnglish = locale === "en";

  // Subject is a plain-text header; HTML-escape only what lands in the body.
  const subject = isEnglish
    ? `${params.inviterName} shared "${params.documentName}" with you`
    : `${params.inviterName} a partagé « ${params.documentName} » avec vous`;

  const inviterName = escapeHtml(params.inviterName);
  const documentName = escapeHtml(params.documentName);

  const permissionLabel = isEnglish
    ? permission === "edit"
      ? "can edit"
      : "read-only"
    : permission === "edit"
      ? "modification autorisée"
      : "lecture seule";

  const accessLine = inviteeHasAccount
    ? isEnglish
      ? "Your access is already active — the document is waiting for you in your <strong>Shared with me</strong> space."
      : "Votre accès est déjà actif — le document vous attend dans votre espace <strong>Partagés avec moi</strong>."
    : isEnglish
      ? "Open the invitation below to accept it and access the document. You'll be asked to create a free GigaPDF account first."
      : "Ouvrez l'invitation ci-dessous pour l'accepter et accéder au document. La création d'un compte GigaPDF gratuit vous sera d'abord demandée.";

  const bodyHtml = `
    <p style="margin: 0 0 20px;">${isEnglish ? "Hi," : "Bonjour,"}</p>
    <p style="margin: 0 0 20px;">${
      isEnglish
        ? `<strong>${inviterName}</strong> shared the document <strong>"${documentName}"</strong> with you on GigaPDF (${permissionLabel}).`
        : `<strong>${inviterName}</strong> a partagé le document <strong>« ${documentName} »</strong> avec vous sur GigaPDF (${permissionLabel}).`
    }</p>
    <p style="margin: 0 0 22px;">${accessLine}</p>
    <p style="margin: 22px 0 0; color: #64748B; font-size: 13px; line-height: 1.6; word-break: break-all;">
      ${isEnglish ? "If the button doesn't work, copy and paste this link:" : "Si le bouton ne fonctionne pas, copiez-collez ce lien :"}<br />
      <a href="${ctaUrl}" style="color: ${BRAND.colors.primary};">${ctaUrl}</a>
    </p>`;

  const html = renderEmail({
    locale,
    preview: isEnglish
      ? `${inviterName} shared "${documentName}" with you on GigaPDF.`
      : `${inviterName} a partagé « ${documentName} » avec vous sur GigaPDF.`,
    subtitle: isEnglish ? "Document sharing" : "Partage de document",
    heading: isEnglish
      ? "A document was shared with you"
      : "Un document a été partagé avec vous",
    bodyHtml,
    cta: {
      label: inviteeHasAccount
        ? isEnglish
          ? "Open the shared document"
          : "Ouvrir le document partagé"
        : isEnglish
          ? "View the invitation"
          : "Voir l'invitation",
      url: ctaUrl,
    },
    footerNote: inviteeHasAccount
      ? isEnglish
        ? "This link is personal. If you don't know the sender, you can safely ignore this email."
        : "Ce lien est personnel. Si vous ne connaissez pas l'expéditeur, vous pouvez ignorer cet email."
      : isEnglish
        ? "This invitation link is personal — please don't forward it. If you don't know the sender, you can safely ignore this email."
        : "Ce lien d'invitation est personnel — merci de ne pas le transférer. Si vous ne connaissez pas l'expéditeur, vous pouvez ignorer cet email.",
  });

  return { subject, html };
}

export function getVerificationEmailTemplate(
  verificationUrl: string,
  locale: string = "fr",
): { subject: string; html: string } {
  const isEnglish = locale === "en";

  const subject = isEnglish
    ? "Verify your GigaPDF email address"
    : "Vérifiez votre adresse email GigaPDF";

  const bodyHtml = `
    <p style="margin: 0 0 20px;">${
      isEnglish
        ? "You're almost there! Confirm your email address to activate your GigaPDF account and start editing."
        : "Vous y êtes presque ! Confirmez votre adresse email pour activer votre compte GigaPDF et commencer à éditer."
    }</p>
    <p style="margin: 22px 0 0; color: #64748B; font-size: 13px; line-height: 1.6; word-break: break-all;">
      ${isEnglish ? "If the button doesn't work, copy and paste this link:" : "Si le bouton ne fonctionne pas, copiez-collez ce lien :"}<br />
      <a href="${verificationUrl}" style="color: ${BRAND.colors.primary};">${verificationUrl}</a>
    </p>`;

  const html = renderEmail({
    locale,
    preview: isEnglish
      ? "Confirm your email to activate your GigaPDF account."
      : "Confirmez votre email pour activer votre compte GigaPDF.",
    subtitle: isEnglish ? "Email verification" : "Vérification de l'email",
    heading: isEnglish ? "Verify your email address" : "Vérifiez votre adresse email",
    bodyHtml,
    cta: {
      label: isEnglish ? "Verify my email" : "Vérifier mon email",
      url: verificationUrl,
      variant: "accent",
    },
    footerNote: isEnglish
      ? "This verification link expires in 24 hours. If you didn't create a GigaPDF account, you can ignore this email."
      : "Ce lien de vérification expire dans 24 heures. Si vous n'avez pas créé de compte GigaPDF, ignorez cet email.",
  });

  return { subject, html };
}
