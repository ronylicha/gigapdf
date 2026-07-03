/**
 * editor-toolbar-header-footer.test.tsx
 *
 * Continuous/single PARITY for the Word-style running header/footer toggle.
 *
 * The toggle used to be gated behind `viewMode === "continuous"`, so the
 * single-page editor could never enter header/footer ZONE mode. These tests
 * pin the parity contract: the toggle (and therefore the editable bands it
 * drives via page.tsx) is available in BOTH the single-page AND the continuous
 * view, and clicking it enters zone mode in either.
 *
 * The toolbar's heavy children (PDF-operation dialogs, formatting cluster,
 * menus) are stubbed so the test renders fast and deterministically and focuses
 * purely on the toolbar's own gating logic.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { Tool } from "@giga-pdf/types";

// next-intl mock: namespaced so each label is unique
// (`editor.headersFooters.toolbarLabel`, `editor.toolbar.*`, …).
vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));

// @giga-pdf/ui — FontPicker/DEFAULT_FONTS + the Radix dropdown primitives used
// by the collapsed "Outils" menu (passthroughs: children render inline; the
// menu items carry NO `title` attribute, so getByTitle stays unique).
vi.mock("@giga-pdf/ui", async () => {
  const React = await import("react");
  const passthrough = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children);
  return {
    FontPicker: () => null,
    DEFAULT_FONTS: [],
    DropdownMenu: passthrough,
    DropdownMenuTrigger: passthrough,
    DropdownMenuContent: passthrough,
    DropdownMenuItem: ({
      children,
      onClick,
      disabled,
    }: {
      children?: React.ReactNode;
      onClick?: () => void;
      disabled?: boolean;
    }) =>
      React.createElement(
        "button",
        { type: "button", role: "menuitem", onClick, disabled },
        children,
      ),
  };
});

// Stub the toolbar's heavy child modules to inert components. We test the
// toolbar's gating logic, not its children (covered by their own suites).
vi.mock("../merge-dialog", () => ({ MergeDialog: () => null }));
vi.mock("../split-dialog", () => ({ SplitDialog: () => null }));
vi.mock("../encrypt-dialog", () => ({ EncryptDialog: () => null }));
vi.mock("../sign-dialog", () => ({ SignDialog: () => null }));
vi.mock("../metadata-dialog", () => ({ MetadataDialog: () => null }));
vi.mock("../page-labels-dialog", () => ({ PageLabelsDialog: () => null }));
vi.mock("../imposition-dialog", () => ({ ImpositionDialog: () => null }));
vi.mock("../convert-dialog", () => ({ ConvertDialog: () => null }));
vi.mock("../search-dialog", () => ({ SearchDialog: () => null }));
vi.mock("../watermark-dialog", () => ({ WatermarkDialog: () => null }));
vi.mock("../ocr-dialog", () => ({ OcrDialog: () => null }));
vi.mock("../pdfa-dialog", () => ({ PdfADialog: () => null }));
vi.mock("../presentation-dialog", () => ({ PresentationDialog: () => null }));
vi.mock("../compress-dialog", () => ({ CompressDialog: () => null }));
vi.mock("../headers-footers-dialog", () => ({
  HeadersFootersDialog: () => null,
}));
vi.mock("../formatting-toolbar", () => ({ FormattingToolbar: () => null }));
vi.mock("../insert-menu", () => ({ InsertMenu: () => null }));
vi.mock("../insert-link-dialog", () => ({ InsertLinkDialog: () => null }));
vi.mock("../insert-svg-dialog", () => ({ InsertSvgDialog: () => null }));
vi.mock("../header-footer-page-setup", () => ({
  HeaderFooterPageSetup: () => null,
}));
vi.mock("../add-page-menu", () => ({ AddPageMenu: () => null }));

import { EditorToolbar } from "../editor-toolbar";

afterEach(cleanup);

/** Minimal required props (every other prop is optional). */
function baseProps() {
  return {
    activeTool: "select" as Tool,
    onToolChange: vi.fn(),
    zoom: 1,
    onZoomChange: vi.fn(),
    canUndo: false,
    canRedo: false,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    hasSelection: false,
  };
}

// The H/F zone toggle is a ToolButton whose accessible name is its `title`
// (= the localised label). With the namespaced i18n mock this resolves to a
// stable, unique string.
const HF_TOGGLE_TITLE = "editor.headersFooters.toolbarLabel";

describe("EditorToolbar — header/footer toggle parity (single ↔ continuous)", () => {
  it("renders the header/footer zone toggle in SINGLE-page mode", () => {
    const onToggleHeaderFooterZones = vi.fn();
    render(
      <EditorToolbar
        {...baseProps()}
        viewMode="single"
        headerFooterEditing={false}
        onToggleHeaderFooterZones={onToggleHeaderFooterZones}
      />,
    );
    expect(screen.getByTitle(HF_TOGGLE_TITLE)).toBeInTheDocument();
  });

  it("renders the header/footer zone toggle in CONTINUOUS mode (no regression)", () => {
    const onToggleHeaderFooterZones = vi.fn();
    render(
      <EditorToolbar
        {...baseProps()}
        viewMode="continuous"
        headerFooterEditing={false}
        onToggleHeaderFooterZones={onToggleHeaderFooterZones}
      />,
    );
    expect(screen.getByTitle(HF_TOGGLE_TITLE)).toBeInTheDocument();
  });

  it("clicking the toggle enters zone mode in SINGLE-page mode", () => {
    const onToggleHeaderFooterZones = vi.fn();
    render(
      <EditorToolbar
        {...baseProps()}
        viewMode="single"
        headerFooterEditing={false}
        onToggleHeaderFooterZones={onToggleHeaderFooterZones}
      />,
    );
    fireEvent.click(screen.getByTitle(HF_TOGGLE_TITLE));
    expect(onToggleHeaderFooterZones).toHaveBeenCalledTimes(1);
  });

  it("reflects active zone mode via the toggle's pressed styling in single mode", () => {
    render(
      <EditorToolbar
        {...baseProps()}
        viewMode="single"
        headerFooterEditing
        onToggleHeaderFooterZones={vi.fn()}
      />,
    );
    // isActive=true paints the primary background — proves the same active
    // wiring used in continuous mode is honoured in single mode.
    expect(screen.getByTitle(HF_TOGGLE_TITLE).className).toContain(
      "bg-primary",
    );
  });
});
