/**
 * ui-sheet.test.tsx
 *
 * @giga-pdf/ui `Sheet` (Radix dialog side-drawer) — the mobile drawer used by
 * the editor layout. Imported from the package SOURCE (not the pre-built
 * dist) so the suite never depends on a stale `packages/ui/dist`.
 *
 * Contract:
 * - controlled `open` renders/unmounts the portaled content;
 * - `onOpenChange(false)` fires via the built-in close button AND Escape;
 * - the side prop anchors the panel with inline styles (scan-independent).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "../../../../../../packages/ui/src/components/ui/sheet";

afterEach(cleanup);

function renderSheet({
  open = true,
  onOpenChange = vi.fn(),
  side = "left" as const,
  showClose = true,
} = {}) {
  render(
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={side} showClose={showClose} aria-describedby={undefined}>
        <SheetTitle>Drawer title</SheetTitle>
        <div data-testid="drawer-body">body</div>
      </SheetContent>
    </Sheet>,
  );
  return { onOpenChange };
}

describe("Sheet (drawer)", () => {
  it("renders the portaled content when open", () => {
    renderSheet({ open: true });
    expect(screen.getByTestId("drawer-body")).toBeInTheDocument();
    expect(screen.getByText("Drawer title")).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    renderSheet({ open: false });
    expect(screen.queryByTestId("drawer-body")).toBeNull();
  });

  it("anchors to the requested side with inline (scan-independent) styles", () => {
    renderSheet({ side: "left" });
    const content = document.querySelector('[data-side="left"]') as HTMLElement;
    expect(content).not.toBeNull();
    expect(content.style.position).toBe("fixed");
    expect(content.style.left).toBe("0px");
    // Slide-in start state (before the rAF flips it to none).
    expect(["translateX(-100%)", "none"]).toContain(content.style.transform);
  });

  it("calls onOpenChange(false) from the built-in close button", () => {
    const { onOpenChange } = renderSheet({ showClose: true });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("hides the built-in close button when showClose=false", () => {
    renderSheet({ showClose: false });
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("calls onOpenChange(false) on Escape", () => {
    const { onOpenChange } = renderSheet();
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
