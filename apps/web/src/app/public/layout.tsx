import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "@/styles/globals.css";

// ---------------------------------------------------------------------------
// ROOT LAYOUT #3 — périmètre PUBLIC PAR TOKEN (/public/[token]).
//
// C'est un VRAI root layout (rend <html>/<body>) au même titre que (site) et
// (app) : le viewer de lien public vit à une URL NUE, jamais localisée (le
// lien copié dans ShareDialog est `${origin}/public/{token}`), donc hors du
// périmètre statique (site)/[locale]. Aucune session requise → PAS de
// Providers (QueryProvider/auth interceptor inutiles), pas d'AuthGuard.
//
// Locale : résolue par request.ts (cookie s'il existe, sinon Accept-Language,
// sinon fr) — un visiteur anonyme obtient donc sa langue navigateur. Cette
// résolution passe par cookies() → rendu dynamique obligatoire (explicite via
// force-dynamic, même contrainte que (app)).
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

// URLs porteuses de token (capability secret) : JAMAIS indexées. Défense en
// profondeur avec le X-Robots-Tag posé par l'API sur /download.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-bricolage",
  display: "swap",
});

export default async function PublicShareLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${bricolage.variable} font-sans antialiased`}
      >
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
