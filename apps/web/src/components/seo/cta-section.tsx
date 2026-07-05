/**
 * Bloc d'appel à l'action des pages SEO : double CTA (compte gratuit + éditeur)
 * et encart open source / auto-hébergement avec lien GitHub.
 * Dictionnaire fr/en interne ; liens internes via le Link i18n (préfixe /en
 * automatique selon la locale courante).
 */

import NextLink from "next/link";
import { ArrowRight } from "lucide-react";
import { GithubIcon as Github } from "@/components/icons/github-icon";
import { Button } from "@giga-pdf/ui";
import { Link } from "@/i18n/navigation";
import type { SeoLocale } from "@/lib/seo";

const GITHUB_URL = "https://github.com/QrCommunication/gigapdf";

const COPY: Record<
  SeoLocale,
  {
    freePlan: string;
    register: string;
    openEditor: string;
    ossTitle: string;
    ossBody: string;
    github: string;
  }
> = {
  fr: {
    freePlan:
      "Plan gratuit complet : toutes les fonctionnalités, 5 Go de stockage, 1 000 documents et 1 000 appels API par mois. Sans carte bancaire.",
    register: "Créer un compte gratuit",
    openEditor: "Ouvrir l'éditeur",
    ossTitle: "100 % open source, auto-hébergeable",
    ossBody:
      "Code « source-available » sous licence PolyForm Noncommercial : auditez-le, contribuez, ou installez GigaPDF sur vos propres serveurs pour garder vos documents chez vous.",
    github: "Voir sur GitHub",
  },
  en: {
    freePlan:
      "The free plan is complete: every feature, 5 GB of storage, 1,000 documents and 1,000 API calls per month. No credit card required.",
    register: "Create a free account",
    openEditor: "Open the editor",
    ossTitle: "100% open source, self-hostable",
    ossBody:
      "The code is source-available under the PolyForm Noncommercial license: audit it, contribute, or install GigaPDF on your own servers to keep your documents at home.",
    github: "View on GitHub",
  },
};

interface CtaSectionProps {
  /** Phrase d'accroche contextuelle au-dessus des boutons. */
  title: string;
  locale: SeoLocale;
  /**
   * Lien interne optionnel vers l'outil fonctionnel de l'app (ex: "/merge").
   * Présent → le bouton « Ouvrir l'éditeur » pointe directement vers l'outil
   * (route d'app NON préfixée par la locale, via NextLink brut — comme le CTA
   * d'en-tête de la page outil). Absent → repli sur l'inscription (comportement
   * historique).
   */
  appHref?: string;
}

export function CtaSection({ title, locale, appHref }: CtaSectionProps) {
  const copy = COPY[locale];

  return (
    <section className="mt-12 space-y-6">
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">{title}</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
          {copy.freePlan}
        </p>
        <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link href="/register">
              {copy.register}
              <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            {appHref ? (
              <NextLink href={appHref}>{copy.openEditor}</NextLink>
            ) : (
              <Link href="/register">{copy.openEditor}</Link>
            )}
          </Button>
        </div>
      </div>

      <div className="flex flex-col items-start justify-between gap-4 rounded-lg border border-border bg-muted/40 p-6 sm:flex-row sm:items-center">
        <div>
          <p className="text-sm font-semibold text-foreground">{copy.ossTitle}</p>
          <p className="mt-1 text-sm text-muted-foreground">{copy.ossBody}</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
            <Github className="mr-2 h-4 w-4" aria-hidden="true" />
            {copy.github}
          </a>
        </Button>
      </div>
    </section>
  );
}
