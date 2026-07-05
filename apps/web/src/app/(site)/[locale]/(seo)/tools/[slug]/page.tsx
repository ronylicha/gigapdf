import type { Metadata } from "next";
import NextLink from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Check } from "lucide-react";
import { Button } from "@giga-pdf/ui";
import { JsonLd } from "@/components/seo/json-ld";
import { CtaSection } from "@/components/seo/cta-section";
import {
  SeoBreadcrumb,
  buildBreadcrumbJsonLd,
  type BreadcrumbItem,
} from "@/components/seo/seo-breadcrumb";
import { ToolIcon } from "@/components/seo/tool-icon";
import { Link } from "@/i18n/navigation";
import { SITE_URL } from "@/lib/seo/constants";
import { routing } from "@/i18n/routing";
import {
  buildSlugAlternates,
  getSolutionBySlugForLocale,
  getToolAlternatePaths,
  getToolBySlugForLocale,
  getToolsData,
  isSeoLocale,
  localizePath,
  type SeoLocale,
  type ToolData,
} from "@/lib/seo";

interface ToolPageProps {
  params: Promise<{ locale: string; slug: string }>;
}

// SSG : un (locale, slug) par outil DANS sa locale (slugs fr pour fr, en pour
// en). Combiné à dynamicParams=false, un slug inconnu OU croisé (slug fr sous
// /en et inversement) n'est jamais matché → 404 NATIF statique (statut correct,
// page not-found rendue), sans dépendre du proxy ni d'un soft-404 notFound().
export function generateStaticParams() {
  return routing.locales.flatMap((locale) =>
    isSeoLocale(locale)
      ? getToolsData(locale).map((tool) => ({ locale, slug: tool.slug }))
      : [],
  );
}

export const dynamicParams = false;

const STRINGS: Record<
  SeoLocale,
  {
    home: string;
    toolsHub: string;
    step: (position: number) => string;
    capabilities: string;
    useCases: string;
    faq: string;
    relatedTools: string;
    relatedSolutions: string;
    openTool: string;
    cta: (toolName: string) => string;
  }
> = {
  fr: {
    home: "Accueil",
    toolsHub: "Outils PDF",
    step: (position) => `Étape ${position}`,
    capabilities: "Ce que l'outil sait faire",
    useCases: "Cas d'usage courants",
    faq: "Questions fréquentes",
    relatedTools: "Outils associés",
    relatedSolutions: "Pour votre métier",
    openTool: "Utiliser l'outil",
    cta: (toolName) => `${toolName} : essayez gratuitement`,
  },
  en: {
    home: "Home",
    toolsHub: "PDF Tools",
    step: (position) => `Step ${position}`,
    capabilities: "What the tool can do",
    useCases: "Common use cases",
    faq: "Frequently asked questions",
    relatedTools: "Related tools",
    relatedSolutions: "For your profession",
    openTool: "Open the tool",
    cta: (toolName) => `${toolName}: try it for free`,
  },
};

export async function generateMetadata({ params }: ToolPageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isSeoLocale(locale)) notFound();
  const tool = getToolBySlugForLocale(locale, slug);
  // Slug inconnu dans CETTE locale → vrai 404 HTTP (avant le stream).
  if (!tool) notFound();

  const paths = getToolAlternatePaths(slug);

  return {
    title: { absolute: tool.metaTitle },
    description: tool.metaDescription,
    alternates: paths ? buildSlugAlternates(paths, locale) : undefined,
    openGraph: {
      type: "website",
      url: `${SITE_URL}${localizePath(`/tools/${tool.slug}`, locale)}`,
      title: tool.metaTitle,
      description: tool.metaDescription,
    },
  };
}

function buildToolJsonLd(tool: ToolData, locale: SeoLocale): Record<string, unknown>[] {
  const pageUrl = `${SITE_URL}${localizePath(`/tools/${tool.slug}`, locale)}`;
  const strings = STRINGS[locale];

  return [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: `GigaPDF — ${tool.name}`,
      url: pageUrl,
      inLanguage: locale,
      description: tool.metaDescription,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "EUR",
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "HowTo",
      name: tool.howTo.title,
      inLanguage: locale,
      step: tool.howTo.steps.map((step, index) => ({
        "@type": "HowToStep",
        position: index + 1,
        name: strings.step(index + 1),
        text: step,
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      inLanguage: locale,
      mainEntity: tool.faq.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: item.answer,
        },
      })),
    },
  ];
}

export default async function ToolPage({ params }: ToolPageProps) {
  const { locale, slug } = await params;
  if (!isSeoLocale(locale)) notFound();
  const tool = getToolBySlugForLocale(locale, slug);
  if (!tool) notFound();

  const strings = STRINGS[locale];

  const breadcrumbItems: BreadcrumbItem[] = [
    { label: strings.home, href: "/" },
    { label: strings.toolsHub, href: "/tools" },
    { label: tool.name, href: `/tools/${tool.slug}` },
  ];

  const relatedTools = tool.relatedTools
    .map((relatedSlug) => getToolBySlugForLocale(locale, relatedSlug))
    .filter((related): related is ToolData => related !== undefined);
  const relatedSolutions = tool.relatedSolutions
    .map((relatedSlug) => getSolutionBySlugForLocale(locale, relatedSlug))
    .filter((solution) => solution !== undefined);

  return (
    <div className="container mx-auto max-w-3xl px-4 py-12">
      {buildToolJsonLd(tool, locale).map((data, index) => (
        <JsonLd key={index} data={data} />
      ))}
      <JsonLd data={buildBreadcrumbJsonLd(SITE_URL, breadcrumbItems, locale)} />

      <SeoBreadcrumb items={breadcrumbItems} locale={locale} />

      <article className="max-w-[68ch]">
        <header>
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ToolIcon name={tool.icon} className="h-6 w-6" />
            </span>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">{tool.h1}</h1>
          </div>
        </header>

        <div className="mt-6 space-y-4">
          {tool.intro.map((paragraph, index) => (
            <p key={index} className="text-base leading-relaxed text-muted-foreground">
              {paragraph}
            </p>
          ))}
        </div>

        {tool.appHref ? (
          <div className="mt-6">
            <Button asChild size="lg">
              <NextLink href={tool.appHref}>
                {strings.openTool}
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </NextLink>
            </Button>
          </div>
        ) : null}

        <section className="mt-10">
          <h2 className="text-2xl font-bold tracking-tight text-foreground">
            {tool.howTo.title}
          </h2>
          <ol className="mt-4 space-y-3">
            {tool.howTo.steps.map((step, index) => (
              <li key={index} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {index + 1}
                </span>
                <span className="text-base leading-relaxed text-muted-foreground">{step}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-10">
          <h2 className="text-2xl font-bold tracking-tight text-foreground">
            {strings.capabilities}
          </h2>
          <ul className="mt-4 space-y-2">
            {tool.capabilities.map((capability, index) => (
              <li key={index} className="flex gap-2.5">
                <Check className="mt-1 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span className="text-base leading-relaxed text-muted-foreground">
                  {capability}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-10">
          <h2 className="text-2xl font-bold tracking-tight text-foreground">
            {strings.useCases}
          </h2>
          <ul className="mt-4 list-disc space-y-2 pl-5">
            {tool.useCases.map((useCase, index) => (
              <li key={index} className="text-base leading-relaxed text-muted-foreground">
                {useCase}
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-10">
          <h2 className="text-2xl font-bold tracking-tight text-foreground">
            {strings.faq}
          </h2>
          <div className="mt-4 space-y-6">
            {tool.faq.map((item, index) => (
              <div key={index}>
                <h3 className="text-lg font-semibold text-foreground">{item.question}</h3>
                <p className="mt-2 text-base leading-relaxed text-muted-foreground">
                  {item.answer}
                </p>
              </div>
            ))}
          </div>
        </section>
      </article>

      <section className="mt-12">
        <h2 className="text-xl font-bold tracking-tight text-foreground">
          {strings.relatedTools}
        </h2>
        <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {relatedTools.map((related) => (
            <li key={related.slug}>
              <Link
                href={`/tools/${related.slug}`}
                className="group flex items-center gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/50"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <ToolIcon name={related.icon} className="h-4 w-4" />
                </span>
                <span className="text-sm font-medium text-foreground group-hover:text-primary">
                  {related.name}
                </span>
                <ArrowRight
                  className="ml-auto h-4 w-4 text-muted-foreground"
                  aria-hidden="true"
                />
              </Link>
            </li>
          ))}
        </ul>

        {relatedSolutions.length > 0 && (
          <>
            <h2 className="mt-8 text-xl font-bold tracking-tight text-foreground">
              {strings.relatedSolutions}
            </h2>
            <ul className="mt-4 flex flex-wrap gap-2">
              {relatedSolutions.map((solution) => (
                <li key={solution.slug}>
                  <Link
                    href={`/solutions/${solution.slug}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                  >
                    {solution.name}
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <CtaSection
        title={strings.cta(tool.name)}
        locale={locale}
        appHref={tool.appHref}
      />
    </div>
  );
}
