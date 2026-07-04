import createIntlMiddleware from "next-intl/middleware";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { routing } from "./i18n/routing";

/**
 * Proxy Next.js 16 — périmètre PUBLIC uniquement.
 *
 * Rôles :
 * 1. Routing i18n next-intl (préfixe `as-needed` : fr sans préfixe, en = /en/*)
 *    sur la landing, (auth), (legal) et (seo). Le proxy réécrit `/x` vers
 *    `/fr/x` en interne et pose le header X-NEXT-INTL-LOCALE consommé par
 *    src/i18n/request.ts.
 * 2. Redirection des utilisateurs déjà authentifiés hors des pages d'auth
 *    (login/register/forgot-password → /dashboard) — logique héritée de
 *    l'ancien apps/web/proxy.ts (qui était inactif : avec un répertoire src/,
 *    Next.js ne charge le proxy que depuis src/proxy.ts).
 *
 * Le matcher EXCLUT volontairement : /api, /backend-api, /embed, toutes les
 * routes app (/dashboard, /documents, /search, /merge, /editor, /settings,
 * /billing, /organization, /developers, /shared, /trash, /monitoring), /_next
 * et les fichiers statiques. Ces routes conservent la résolution de locale par
 * cookie (request.ts) et la protection client AuthGuard.
 */

const intlMiddleware = createIntlMiddleware(routing);

/** Pages d'auth : un utilisateur déjà connecté est renvoyé vers le dashboard. */
const AUTH_ROUTES = ["/login", "/register", "/forgot-password"];

/**
 * Premiers segments de TOUTES les routes (app) — non localisées : servies
 * directement, jamais réécrites par next-intl (sinon elles tombent dans le
 * périmètre statique (site)/[locale] → 404 natif). Source de vérité complète,
 * à garder synchronisée avec apps/web/src/app/(app)/(dashboard)/* (+ editor,
 * embed). Toute nouvelle page-outil DOIT être ajoutée ici. Le `matcher`
 * ci-dessous en pré-exclut déjà quelques-unes (perf) ; ce Set couvre le reste —
 * notamment les pages-outils, longtemps absentes du matcher → 404 silencieux.
 */
const APP_ROUTES = new Set<string>([
  // Conteneurs app
  "dashboard", "documents", "search", "settings", "billing", "organization",
  "developers", "shared", "trash", "monitoring", "forbidden", "editor", "embed",
  // Pages à token, URL nue JAMAIS localisée (liens copiés/e-mailés) :
  // /invitations/[token] (landing invité, sous (app)) et /public/[token]
  // (viewer public sans auth, root layout dédié). Sans ces entrées, next-intl
  // réécrit /public/xxx → /fr/public/xxx → 404 (périmètre statique (site)).
  "invitations", "public",
  // Outils — édition / sécurité / pages
  "merge", "split", "compress", "protect", "unlock", "sign", "watermark", "ocr",
  "pdf-a", "extract-pages", "organize-pages",
  // Outils — conversion VERS pdf
  "image-to-pdf", "office-to-pdf", "html-to-pdf", "text-to-pdf", "csv-to-pdf",
  "markdown-to-pdf", "rtf-pdf",
  // Outils — conversion DEPUIS pdf
  "pdf-to-word", "pdf-to-excel", "pdf-to-powerpoint", "pdf-to-image",
  "pdf-to-odt", "pdf-to-ods", "pdf-to-odp", "pdf-to-html", "pdf-to-rtf",
  "pdf-to-text", "pdf-to-markdown", "pdf-to-csv", "pdf-to-epub",
]);

function getSessionToken(request: NextRequest) {
  const possibleCookieNames = [
    "better-auth.session_token",
    "__Secure-better-auth.session_token",
    "better-auth.session",
    "__Secure-better-auth.session",
  ];

  for (const cookieName of possibleCookieNames) {
    const cookie = request.cookies.get(cookieName);
    if (cookie?.value) {
      return cookie;
    }
  }
  return null;
}

/** Ramène /en/login → /login (et /en → /) pour comparer aux routes d'auth. */
function stripLocalePrefix(pathname: string): string {
  for (const locale of routing.locales) {
    if (pathname === `/${locale}`) return "/";
    if (pathname.startsWith(`/${locale}/`)) return pathname.slice(locale.length + 1);
  }
  return pathname;
}

export function proxy(request: NextRequest) {
  const original = request.nextUrl.pathname;
  const pathname = stripLocalePrefix(original);

  if (AUTH_ROUTES.includes(pathname) && getSessionToken(request)) {
    // /dashboard vit hors [locale] : URL non préfixée, jamais localisée.
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // Routes (app) en URL nue (/merge, /pdf-to-word, …) : servies directement,
  // sans réécriture i18n. On teste le chemin ORIGINAL — un /fr/<outil> est laissé
  // à next-intl qui le redirige vers /<outil> (URL nue), ensuite servie ici
  // directement. Sans ce garde, next-intl réécrit /pdf-to-word → /fr/pdf-to-word,
  // qui n'existe pas dans le périmètre statique (site) → 404.
  const appSegment = original.split("/")[1] ?? "";
  if (APP_ROUTES.has(appSegment)) {
    return NextResponse.next();
  }

  // Les slugs SEO inconnus/croisés (fr sous /en et inversement) donnent un 404
  // NATIF : les pages (seo)/tools/[slug] et solutions/[slug] sont prérendues
  // (generateStaticParams par locale) avec `dynamicParams = false`, donc tout
  // slug hors-liste n'est jamais matché → 404 statique (validé en E2E). Plus
  // besoin du hack de réécriture vers /{locale}/__not-found__ qui compensait le
  // soft-404 du rendu dynamique d'avant.

  return intlMiddleware(request);
}

export const config = {
  // Matcher NÉGATIF : tout SAUF les routes app/API/fichiers. Deux raisons :
  // 1. Le périmètre public (landing, auth, legal, seo, /(fr|en)/*) doit passer
  //    par le routing i18n next-intl.
  // 2. Toute URL inconnue (/foobar, /xx/login) doit AUSSI passer par le proxy :
  //    next-intl la réécrit vers /fr/<path>. Le root layout (site)/[locale]
  //    étant statique (generateStaticParams + dynamicParams=false), un segment
  //    de locale inconnu ou un chemin sans route → 404 NATIF (plus de soft-404).
  // Exclusions = routes app ((dashboard), editor, embed), API, assets : elles
  // conservent la résolution de locale par cookie (request.ts) et ne sont
  // JAMAIS préfixées. `forbidden` est la page d'accès refusé APP (URL /forbidden,
  // sous (app)/(dashboard)) : exclue pour qu'elle reste non préfixée (cookie),
  // sans collision avec la page d'accès refusé MARKETING servie à /fr/403 et
  // /en/403 (le bare /403 reste, lui, géré par next-intl → marketing fr).
  matcher: [
    "/((?!api|backend-api|dashboard|documents|search|merge|editor|settings|billing|organization|developers|shared|trash|monitoring|embed|forbidden|_next|_vercel|.*\\..*).*)",
  ],
};
