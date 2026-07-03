/**
 * add-page-menu.test.tsx
 *
 * The SL4 "Add page" picker. It must hand the chosen format / orientation /
 * position straight to `onAddPage` (the editor resolves the size to points via
 * `addPageParams` — covered in page-formats.test.ts — and runs the add op +
 * re-bake). Defaults are A4 / portrait / after.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

// next-intl mock: namespaced (same factory SHAPE as the editor-toolbar test
// files — the shared fork, `isolate: false`, caches the real add-page-menu
// module across files, so every file that evaluates it must agree on the
// next-intl mock). Labels stay queryable ("editor.addPage.format.a4", …).
vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));

import { AddPageMenu } from "../add-page-menu";

afterEach(cleanup);

describe("AddPageMenu", () => {
  it("adds an A4 portrait page after the current page (defaults)", () => {
    const onAddPage = vi.fn();
    render(<AddPageMenu onAddPage={onAddPage} />);

    // Open the menu, then confirm with the default selection.
    fireEvent.click(screen.getByLabelText("editor.addPage.toolbarLabel"));
    expect(screen.getByTestId("add-page-menu")).toBeInTheDocument();
    fireEvent.click(screen.getByText("editor.addPage.add"));

    expect(onAddPage).toHaveBeenCalledWith("a4", "portrait", "after", undefined);
  });

  it("passes the chosen format / orientation / position", () => {
    const onAddPage = vi.fn();
    render(<AddPageMenu onAddPage={onAddPage} />);

    fireEvent.click(screen.getByLabelText("editor.addPage.toolbarLabel"));
    fireEvent.click(screen.getByText("editor.addPage.format.a3"));
    fireEvent.click(screen.getByText("editor.addPage.orientation.landscape"));
    fireEvent.click(screen.getByText("editor.addPage.position.end"));
    fireEvent.click(screen.getByText("editor.addPage.add"));

    expect(onAddPage).toHaveBeenCalledWith("a3", "landscape", "end", undefined);
  });

  it("passes custom dimensions when the custom format is chosen", () => {
    const onAddPage = vi.fn();
    render(<AddPageMenu onAddPage={onAddPage} />);

    fireEvent.click(screen.getByLabelText("editor.addPage.toolbarLabel"));
    fireEvent.click(screen.getByText("editor.addPage.format.custom"));
    fireEvent.change(screen.getByLabelText("editor.addPage.customWidth"), {
      target: { value: "400" },
    });
    fireEvent.change(screen.getByLabelText("editor.addPage.customHeight"), {
      target: { value: "650" },
    });
    fireEvent.click(screen.getByText("editor.addPage.add"));

    expect(onAddPage).toHaveBeenCalledWith("custom", "portrait", "after", {
      width: 400,
      height: 650,
    });
  });
});
