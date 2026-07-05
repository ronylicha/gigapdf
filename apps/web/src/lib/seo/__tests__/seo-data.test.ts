/**
 * Invariants des données SEO programmatique (tools + solutions).
 *
 * Protège contre les régressions éditoriales : longueurs méta dépassées,
 * liens internes cassés (slugs related inexistants), contenu trop maigre
 * (thin content) et phrases dupliquées entre intros (gabarit déguisé).
 */

import { describe, expect, it } from "vitest";
import {
  getAlternateSolutionSlug,
  getAlternateToolSlug,
  solutionSlugMap,
  toolSlugMap,
} from "../slug-map";
import { SOLUTIONS } from "../solutions-data";
import { SOLUTIONS as SOLUTIONS_EN } from "../solutions-data.en";
import { TOOLS } from "../tools-data";
import { TOOLS as TOOLS_EN } from "../tools-data.en";

const TOOL_SLUGS = new Set(TOOLS.map((tool) => tool.slug));
const SOLUTION_SLUGS = new Set(SOLUTIONS.map((solution) => solution.slug));
const TOOL_SLUGS_EN = new Set(TOOLS_EN.map((tool) => tool.slug));
const SOLUTION_SLUGS_EN = new Set(SOLUTIONS_EN.map((solution) => solution.slug));

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

describe("tools-data", () => {
  it("contient les 38 outils attendus, sans doublon de slug", () => {
    expect(TOOLS).toHaveLength(38);
    expect(TOOL_SLUGS.size).toBe(38);
  });

  it.each(TOOLS.map((tool) => [tool.slug, tool] as const))(
    "%s respecte les contraintes éditoriales",
    (_slug, tool) => {
      expect(tool.metaTitle.length).toBeLessThanOrEqual(60);
      expect(tool.metaDescription.length).toBeLessThanOrEqual(155);
      expect(tool.intro.length).toBeGreaterThanOrEqual(2);
      expect(tool.intro.length).toBeLessThanOrEqual(3);
      expect(tool.howTo.steps.length).toBeGreaterThanOrEqual(4);
      expect(tool.howTo.steps.length).toBeLessThanOrEqual(6);
      expect(tool.faq.length).toBeGreaterThanOrEqual(4);
      expect(tool.faq.length).toBeLessThanOrEqual(6);
      expect(tool.useCases).toHaveLength(3);

      // ≥ 400 mots utiles par page
      const words = wordCount(
        [
          ...tool.intro,
          ...tool.howTo.steps,
          ...tool.capabilities,
          ...tool.faq.flatMap((item) => [item.question, item.answer]),
          ...tool.useCases,
        ].join(" "),
      );
      expect(words).toBeGreaterThanOrEqual(400);

      // Maillage interne : tous les slugs référencés existent
      for (const related of tool.relatedTools) {
        expect(TOOL_SLUGS.has(related), `relatedTool inconnu: ${related}`).toBe(true);
        expect(related).not.toBe(tool.slug);
      }
      for (const related of tool.relatedSolutions) {
        expect(SOLUTION_SLUGS.has(related), `relatedSolution inconnue: ${related}`).toBe(
          true,
        );
      }
      expect(tool.relatedTools.length).toBeGreaterThanOrEqual(3);
      expect(tool.relatedSolutions.length).toBeGreaterThanOrEqual(2);
    },
  );

  it("aucune phrase d'intro n'est partagée entre deux outils (anti-gabarit)", () => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];

    for (const tool of TOOLS) {
      for (const paragraph of tool.intro) {
        for (const raw of paragraph.split(/(?<=[.!?])\s+/)) {
          const sentence = raw.trim();
          if (sentence.length < 40) continue;
          const owner = seen.get(sentence);
          if (owner && owner !== tool.slug) {
            duplicates.push(`[${owner} & ${tool.slug}] ${sentence.slice(0, 80)}`);
          }
          seen.set(sentence, tool.slug);
        }
      }
    }

    expect(duplicates).toEqual([]);
  });

  it("expose des appHref internes valides vers les outils de l'app", () => {
    const bySlug = new Map(TOOLS.map((tool) => [tool.slug, tool]));

    // Un outil fonctionnel connu pointe vers sa route d'app réelle : la page
    // outil (hero + CtaSection) propose alors un CTA direct vers l'outil.
    expect(bySlug.get("fusionner-pdf")?.appHref).toBe("/merge");

    // Tout appHref défini est un chemin d'app ABSOLU et NON préfixé par la
    // locale : les routes (app)/* ne sont pas localisées et sont consommées via
    // un NextLink brut (jamais via le Link i18n qui ajouterait /en). Une valeur
    // relative ou localisée produirait un CTA 404.
    for (const tool of TOOLS) {
      if (tool.appHref === undefined) continue;
      expect(
        tool.appHref.startsWith("/"),
        `appHref non absolu: ${tool.slug}`,
      ).toBe(true);
      expect(
        tool.appHref.startsWith("/en/"),
        `appHref préfixé par la locale: ${tool.slug}`,
      ).toBe(false);
    }
  });
});

describe("solutions-data", () => {
  it("contient les 10 solutions attendues, sans doublon de slug", () => {
    expect(SOLUTIONS).toHaveLength(10);
    expect(SOLUTION_SLUGS.size).toBe(10);
  });

  it.each(SOLUTIONS.map((solution) => [solution.slug, solution] as const))(
    "%s respecte les contraintes éditoriales",
    (_slug, solution) => {
      expect(solution.metaTitle.length).toBeLessThanOrEqual(60);
      expect(solution.metaDescription.length).toBeLessThanOrEqual(155);
      expect(solution.intro.length).toBeGreaterThanOrEqual(2);
      expect(solution.intro.length).toBeLessThanOrEqual(3);
      expect(solution.workflows.length).toBeGreaterThanOrEqual(3);
      expect(solution.workflows.length).toBeLessThanOrEqual(4);
      expect(solution.faq.length).toBeGreaterThanOrEqual(4);

      const words = wordCount(
        [
          ...solution.intro,
          ...solution.workflows.flatMap((workflow) => [
            workflow.title,
            workflow.description,
          ]),
          ...solution.capabilities,
          ...solution.faq.flatMap((item) => [item.question, item.answer]),
        ].join(" "),
      );
      expect(words).toBeGreaterThanOrEqual(400);

      for (const related of solution.relatedTools) {
        expect(TOOL_SLUGS.has(related), `relatedTool inconnu: ${related}`).toBe(true);
      }
      expect(solution.relatedTools.length).toBeGreaterThanOrEqual(3);
    },
  );

  it("aucune phrase d'intro n'est partagée entre deux solutions (anti-gabarit)", () => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];

    for (const solution of SOLUTIONS) {
      for (const paragraph of solution.intro) {
        for (const raw of paragraph.split(/(?<=[.!?])\s+/)) {
          const sentence = raw.trim();
          if (sentence.length < 40) continue;
          const owner = seen.get(sentence);
          if (owner && owner !== solution.slug) {
            duplicates.push(`[${owner} & ${solution.slug}] ${sentence.slice(0, 80)}`);
          }
          seen.set(sentence, solution.slug);
        }
      }
    }

    expect(duplicates).toEqual([]);
  });
});

describe("tools-data.en", () => {
  it("contient les 38 outils attendus, sans doublon de slug", () => {
    expect(TOOLS_EN).toHaveLength(38);
    expect(TOOL_SLUGS_EN.size).toBe(38);
  });

  it.each(TOOLS_EN.map((tool) => [tool.slug, tool] as const))(
    "%s respecte les contraintes éditoriales",
    (_slug, tool) => {
      expect(tool.metaTitle.length).toBeLessThanOrEqual(60);
      expect(tool.metaDescription.length).toBeLessThanOrEqual(155);
      expect(tool.intro.length).toBeGreaterThanOrEqual(2);
      expect(tool.intro.length).toBeLessThanOrEqual(3);
      expect(tool.howTo.steps.length).toBeGreaterThanOrEqual(4);
      expect(tool.howTo.steps.length).toBeLessThanOrEqual(6);
      expect(tool.faq.length).toBeGreaterThanOrEqual(4);
      expect(tool.faq.length).toBeLessThanOrEqual(6);
      expect(tool.useCases).toHaveLength(3);

      // ≥ 400 mots utiles par page
      const words = wordCount(
        [
          ...tool.intro,
          ...tool.howTo.steps,
          ...tool.capabilities,
          ...tool.faq.flatMap((item) => [item.question, item.answer]),
          ...tool.useCases,
        ].join(" "),
      );
      expect(words).toBeGreaterThanOrEqual(400);

      // Maillage interne EN : tous les slugs référencés existent côté EN
      for (const related of tool.relatedTools) {
        expect(TOOL_SLUGS_EN.has(related), `relatedTool EN inconnu: ${related}`).toBe(
          true,
        );
        expect(related).not.toBe(tool.slug);
      }
      for (const related of tool.relatedSolutions) {
        expect(
          SOLUTION_SLUGS_EN.has(related),
          `relatedSolution EN inconnue: ${related}`,
        ).toBe(true);
      }
      expect(tool.relatedTools.length).toBeGreaterThanOrEqual(3);
      expect(tool.relatedSolutions.length).toBeGreaterThanOrEqual(2);
    },
  );

  it("aucune phrase d'intro n'est partagée entre deux outils EN (anti-gabarit)", () => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];

    for (const tool of TOOLS_EN) {
      for (const paragraph of tool.intro) {
        for (const raw of paragraph.split(/(?<=[.!?])\s+/)) {
          const sentence = raw.trim();
          if (sentence.length < 40) continue;
          const owner = seen.get(sentence);
          if (owner && owner !== tool.slug) {
            duplicates.push(`[${owner} & ${tool.slug}] ${sentence.slice(0, 80)}`);
          }
          seen.set(sentence, tool.slug);
        }
      }
    }

    expect(duplicates).toEqual([]);
  });
});

describe("solutions-data.en", () => {
  it("contient les 10 solutions attendues, sans doublon de slug", () => {
    expect(SOLUTIONS_EN).toHaveLength(10);
    expect(SOLUTION_SLUGS_EN.size).toBe(10);
  });

  it.each(SOLUTIONS_EN.map((solution) => [solution.slug, solution] as const))(
    "%s respecte les contraintes éditoriales",
    (_slug, solution) => {
      expect(solution.metaTitle.length).toBeLessThanOrEqual(60);
      expect(solution.metaDescription.length).toBeLessThanOrEqual(155);
      expect(solution.intro.length).toBeGreaterThanOrEqual(2);
      expect(solution.intro.length).toBeLessThanOrEqual(3);
      expect(solution.workflows.length).toBeGreaterThanOrEqual(3);
      expect(solution.workflows.length).toBeLessThanOrEqual(4);
      expect(solution.faq.length).toBeGreaterThanOrEqual(4);

      const words = wordCount(
        [
          ...solution.intro,
          ...solution.workflows.flatMap((workflow) => [
            workflow.title,
            workflow.description,
          ]),
          ...solution.capabilities,
          ...solution.faq.flatMap((item) => [item.question, item.answer]),
        ].join(" "),
      );
      expect(words).toBeGreaterThanOrEqual(400);

      for (const related of solution.relatedTools) {
        expect(TOOL_SLUGS_EN.has(related), `relatedTool EN inconnu: ${related}`).toBe(
          true,
        );
      }
      expect(solution.relatedTools.length).toBeGreaterThanOrEqual(3);
    },
  );

  it("aucune phrase d'intro n'est partagée entre deux solutions EN (anti-gabarit)", () => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];

    for (const solution of SOLUTIONS_EN) {
      for (const paragraph of solution.intro) {
        for (const raw of paragraph.split(/(?<=[.!?])\s+/)) {
          const sentence = raw.trim();
          if (sentence.length < 40) continue;
          const owner = seen.get(sentence);
          if (owner && owner !== solution.slug) {
            duplicates.push(`[${owner} & ${solution.slug}] ${sentence.slice(0, 80)}`);
          }
          seen.set(sentence, solution.slug);
        }
      }
    }

    expect(duplicates).toEqual([]);
  });
});

describe("slug-map", () => {
  it("toolSlugMap est une bijection complète FR → EN (38 entrées)", () => {
    const keys = Object.keys(toolSlugMap);
    const values = Object.values(toolSlugMap);

    expect(keys).toHaveLength(38);
    expect(new Set(values).size).toBe(38);
    // Toutes les clés sont des slugs FR existants, toutes les valeurs des slugs EN existants
    expect(new Set(keys)).toEqual(TOOL_SLUGS);
    expect(new Set(values)).toEqual(TOOL_SLUGS_EN);
  });

  it("solutionSlugMap est une bijection complète FR → EN (10 entrées)", () => {
    const keys = Object.keys(solutionSlugMap);
    const values = Object.values(solutionSlugMap);

    expect(keys).toHaveLength(10);
    expect(new Set(values).size).toBe(10);
    expect(new Set(keys)).toEqual(SOLUTION_SLUGS);
    expect(new Set(values)).toEqual(SOLUTION_SLUGS_EN);
  });

  it("aller-retour identité sur tous les slugs d'outils (fr → en → fr et en → fr → en)", () => {
    for (const fr of TOOL_SLUGS) {
      const en = getAlternateToolSlug(fr, "en");
      expect(en, `pas d'alternate EN pour ${fr}`).toBeDefined();
      expect(TOOL_SLUGS_EN.has(en as string)).toBe(true);
      expect(getAlternateToolSlug(en as string, "fr")).toBe(fr);
    }
    for (const en of TOOL_SLUGS_EN) {
      const fr = getAlternateToolSlug(en, "fr");
      expect(fr, `pas d'alternate FR pour ${en}`).toBeDefined();
      expect(TOOL_SLUGS.has(fr as string)).toBe(true);
      expect(getAlternateToolSlug(fr as string, "en")).toBe(en);
    }
  });

  it("aller-retour identité sur tous les slugs de solutions", () => {
    for (const fr of SOLUTION_SLUGS) {
      const en = getAlternateSolutionSlug(fr, "en");
      expect(en, `pas d'alternate EN pour ${fr}`).toBeDefined();
      expect(SOLUTION_SLUGS_EN.has(en as string)).toBe(true);
      expect(getAlternateSolutionSlug(en as string, "fr")).toBe(fr);
    }
    for (const en of SOLUTION_SLUGS_EN) {
      const fr = getAlternateSolutionSlug(en, "fr");
      expect(fr, `pas d'alternate FR pour ${en}`).toBeDefined();
      expect(SOLUTION_SLUGS.has(fr as string)).toBe(true);
      expect(getAlternateSolutionSlug(fr as string, "en")).toBe(en);
    }
  });

  it("retourne undefined pour un slug inconnu", () => {
    expect(getAlternateToolSlug("nonexistent-tool", "en")).toBeUndefined();
    expect(getAlternateToolSlug("nonexistent-tool", "fr")).toBeUndefined();
    expect(getAlternateSolutionSlug("nonexistent-solution", "en")).toBeUndefined();
    expect(getAlternateSolutionSlug("nonexistent-solution", "fr")).toBeUndefined();
  });

  it("les slugs identiques dans les deux locales se résolvent en identité", () => {
    // ocr-pdf, opendocument-pdf et pdf-a partagent le même slug FR et EN
    for (const shared of ["ocr-pdf", "opendocument-pdf", "pdf-a"]) {
      expect(getAlternateToolSlug(shared, "en")).toBe(shared);
      expect(getAlternateToolSlug(shared, "fr")).toBe(shared);
    }
  });
});
