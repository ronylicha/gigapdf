/**
 * pages-sidebar-touch.test.tsx
 *
 * Mobile lot 2 — the per-thumbnail actions were hover-only
 * (`opacity-0 group-hover:opacity-100`), i.e. unreachable on touch devices.
 * They must now also be visible on coarse pointers
 * (`pointer-coarse:opacity-100`) with enlarged tap targets
 * (`pointer-coarse:p-2`). Desktop keeps the hover reveal untouched.
 */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { PageObject } from "@giga-pdf/types";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import { PagesSidebar } from "../pages-sidebar";

afterEach(cleanup);

function makePages(count: number): PageObject[] {
  return Array.from({ length: count }, (_, i) => ({
    pageId: `p${i + 1}`,
    pageNumber: i + 1,
    dimensions: { width: 595, height: 842, rotation: 0 },
  })) as unknown as PageObject[];
}

describe("PagesSidebar — touch-visible page actions", () => {
  it("reveals the actions container on coarse pointers (and keeps hover)", () => {
    const { container } = render(
      <PagesSidebar
        pages={makePages(2)}
        currentPageIndex={0}
        onPageSelect={vi.fn()}
        onPageDelete={vi.fn()}
        onPageRotate={vi.fn()}
      />,
    );
    const actionBars = container.querySelectorAll(
      ".pointer-coarse\\:opacity-100",
    );
    expect(actionBars.length).toBe(2); // one bar per thumbnail
    for (const bar of actionBars) {
      // Desktop hover reveal preserved alongside the coarse reveal.
      expect(bar.className).toContain("group-hover:opacity-100");
      expect(bar.className).toContain("opacity-0");
    }
  });

  it("enlarges the action buttons on coarse pointers", () => {
    const { container } = render(
      <PagesSidebar
        pages={makePages(1)}
        currentPageIndex={0}
        onPageSelect={vi.fn()}
        onPageDelete={vi.fn()}
        onPageRotate={vi.fn()}
        onPageDuplicate={vi.fn()}
      />,
    );
    const buttons = container.querySelectorAll(
      '[class*="pointer-coarse:p-2"]',
    );
    // duplicate + rotate (delete is hidden with a single page).
    expect(buttons.length).toBeGreaterThanOrEqual(2);
  });
});
