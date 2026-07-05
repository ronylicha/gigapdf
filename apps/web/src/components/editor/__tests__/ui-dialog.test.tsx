/**
 * ui-dialog.test.tsx
 *
 * @giga-pdf/ui `Dialog` — mobile-safety contract of the shared DialogContent.
 * Imported from the package SOURCE (not the pre-built dist) so the suite
 * never depends on a stale `packages/ui/dist` (same convention as
 * ui-sheet.test.tsx).
 *
 * Contract:
 * - centering stays INLINE (scan-independent: fixed + 50%/50% translate);
 * - mobile safety classes are present on the content element:
 *   `max-w-[calc(100vw-2rem)]` (1rem side margins) + `sm:max-w-lg`,
 *   `max-h-[90dvh]` (dynamic viewport cap) + `overflow-y-auto` (no clipping);
 * - consumer `className` still merges (twMerge) so width overrides like
 *   `sm:max-w-5xl` replace the default cap without losing the base margin.
 */
import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "../../../../../../packages/ui/src/components/ui/dialog";
import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandList,
} from "../../../../../../packages/ui/src/components/ui/command";

afterEach(cleanup);

function renderDialog(className?: string) {
  render(
    <Dialog open>
      <DialogContent
        {...(className !== undefined ? { className } : {})}
        aria-describedby={undefined}
        data-testid="dialog-content"
      >
        <DialogTitle>Dialog title</DialogTitle>
        <div>body</div>
      </DialogContent>
    </Dialog>,
  );
  return screen.getByTestId("dialog-content");
}

describe("DialogContent (shared @giga-pdf/ui dialog)", () => {
  it("keeps the scan-independent inline centering", () => {
    const content = renderDialog();
    expect(content.style.position).toBe("fixed");
    expect(content.style.left).toBe("50%");
    expect(content.style.top).toBe("50%");
    expect(content.style.transform).toBe("translate(-50%, -50%)");
    expect(content.style.zIndex).toBe("50");
  });

  it("applies the mobile safety classes (margins, dvh cap, internal scroll)", () => {
    const content = renderDialog();
    const cls = content.className;
    expect(cls).toContain("max-w-[calc(100vw-2rem)]");
    expect(cls).toContain("sm:max-w-lg");
    expect(cls).toContain("max-h-[90dvh]");
    expect(cls).toContain("overflow-y-auto");
  });

  it("lets consumers override the sm+ width without losing the base mobile margin", () => {
    const content = renderDialog("sm:max-w-5xl");
    const cls = content.className;
    // twMerge: the sm: override replaces the default sm:max-w-lg…
    expect(cls).toContain("sm:max-w-5xl");
    expect(cls).not.toContain("sm:max-w-lg");
    // …while the base (mobile) margin survives.
    expect(cls).toContain("max-w-[calc(100vw-2rem)]");
  });

  it("lets consumers opt out of the internal scroll (e.g. CommandDialog)", () => {
    const content = renderDialog("overflow-hidden p-0");
    const cls = content.className;
    expect(cls).toContain("overflow-hidden");
    expect(cls).not.toContain("overflow-y-auto");
    expect(cls).toContain("p-0");
    expect(cls).not.toContain("p-6");
  });
});

describe("CommandDialog (a11y — Radix DialogTitle requirement)", () => {
  // cmdk relies on browser APIs jsdom doesn't implement (active-item
  // scrollIntoView + a ResizeObserver). Stub the missing ones so the command
  // palette renders in the test environment.
  beforeAll(() => {
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = () => {};
    }
    if (typeof globalThis.ResizeObserver === "undefined") {
      globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver;
    }
  });

  function renderCommand(props?: { title?: string; description?: string }) {
    render(
      <CommandDialog open {...(props ?? {})}>
        <CommandInput placeholder="Search" />
        <CommandList>
          <CommandEmpty>No results</CommandEmpty>
        </CommandList>
      </CommandDialog>,
    );
  }

  it("renders a visually-hidden but accessible default DialogTitle", () => {
    renderCommand();
    const title = screen.getByText("Command Menu");
    // Present in the DOM for screen readers, hidden from sighted users.
    expect(title.className).toContain("sr-only");
    // Radix names the dialog via aria-labelledby → the title's id.
    expect(screen.getByRole("dialog").getAttribute("aria-labelledby")).toBe(
      title.id,
    );
  });

  it("uses a caller-provided title/description, still visually hidden", () => {
    renderCommand({ title: "Command palette", description: "Search tools" });
    expect(screen.getByText("Command palette").className).toContain("sr-only");
    expect(screen.getByText("Search tools").className).toContain("sr-only");
    expect(screen.queryByText("Command Menu")).toBeNull();
  });
});
