/**
 * editor-toolbar-tools-menu.test.tsx
 *
 * Mobile toolbar contract (lot 1 — responsive editor):
 *
 * 1. The toolbar container WRAPS (flex-wrap) instead of overflowing off-screen
 *    — non-negotiable — and never carries overflow-x (the home-made dropdowns
 *    are absolutely positioned and would be clipped).
 * 2. The 17-18 "PDF tools" are rendered on TWO surfaces from a single source
 *    of truth: individual buttons (lg+, `hidden lg:contents`) and ONE
 *    collapsed "Outils" menu (<lg, `lg:hidden`). Every menu item triggers the
 *    SAME handler as its button twin: dialog openers flip the same dialog
 *    `open` prop; callback tools call the same prop callbacks.
 *
 * Radix dropdown primitives are stubbed as passthroughs (items render inline),
 * so the test drives the toolbar's own wiring — not Radix internals.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import type { Tool } from "@giga-pdf/types";

// next-intl mock: namespaced so each label is unique.
vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));

// @giga-pdf/ui — FontPicker/DEFAULT_FONTS + dropdown passthroughs. The menu
// content is tagged (data-testid) so items can be queried apart from the
// lg+ ToolButtons that share the same labels (as `title` attributes).
vi.mock("@giga-pdf/ui", async () => {
  const React = await import("react");
  const passthrough = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children);
  return {
    FontPicker: () => null,
    DEFAULT_FONTS: [],
    DropdownMenu: passthrough,
    DropdownMenuTrigger: passthrough,
    DropdownMenuContent: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(
        "div",
        { "data-testid": "tools-menu-content" },
        children,
      ),
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
    // Sheet passthroughs: the toolbar's mobile bottom-sheet imports these from
    // the same module. Unused here (desktop default), but the shared fork
    // (`isolate: false`) makes factory PARITY across sibling files the safe
    // contract — see editor-toolbar-mobile-sheet.test.tsx.
    Sheet: ({
      open,
      children,
    }: {
      open?: boolean;
      children?: React.ReactNode;
    }) => (open ? React.createElement(React.Fragment, null, children) : null),
    SheetContent: ({ children }: { children?: React.ReactNode }) =>
      React.createElement("div", { "data-testid": "mobile-tools-sheet" }, children),
    SheetHeader: passthrough,
    SheetTitle: ({ children }: { children?: React.ReactNode }) =>
      React.createElement("h2", null, children),
  };
});

// PDF-operation dialogs → markers exposing their `open`/`isOpen` prop, so a
// menu-item click can be asserted to open the SAME dialog as the button.
vi.mock("../merge-dialog", () => ({
  MergeDialog: (p: { open: boolean }) =>
    p.open ? <div data-testid="dlg-merge" /> : null,
}));
vi.mock("../split-dialog", () => ({
  SplitDialog: (p: { open: boolean }) =>
    p.open ? <div data-testid="dlg-split" /> : null,
}));
vi.mock("../encrypt-dialog", () => ({
  EncryptDialog: (p: { open: boolean }) =>
    p.open ? <div data-testid="dlg-encrypt" /> : null,
}));
vi.mock("../sign-dialog", () => ({
  SignDialog: (p: { open: boolean }) =>
    p.open ? <div data-testid="dlg-sign" /> : null,
}));
vi.mock("../metadata-dialog", () => ({
  MetadataDialog: (p: { isOpen: boolean }) =>
    p.isOpen ? <div data-testid="dlg-metadata" /> : null,
}));
vi.mock("../page-labels-dialog", () => ({
  PageLabelsDialog: (p: { isOpen: boolean }) =>
    p.isOpen ? <div data-testid="dlg-page-labels" /> : null,
}));
vi.mock("../convert-dialog", () => ({
  ConvertDialog: (p: { isOpen: boolean }) =>
    p.isOpen ? <div data-testid="dlg-convert" /> : null,
}));
vi.mock("../search-dialog", () => ({
  SearchDialog: (p: { open: boolean }) =>
    p.open ? <div data-testid="dlg-search" /> : null,
}));
vi.mock("../watermark-dialog", () => ({
  WatermarkDialog: (p: { open: boolean }) =>
    p.open ? <div data-testid="dlg-watermark" /> : null,
}));
vi.mock("../ocr-dialog", () => ({
  OcrDialog: (p: { open: boolean }) =>
    p.open ? <div data-testid="dlg-ocr" /> : null,
}));
vi.mock("../pdfa-dialog", () => ({
  PdfADialog: (p: { open: boolean }) =>
    p.open ? <div data-testid="dlg-pdfa" /> : null,
}));
vi.mock("../presentation-dialog", () => ({
  PresentationDialog: (p: { open: boolean }) =>
    p.open ? <div data-testid="dlg-presentation" /> : null,
}));
vi.mock("../imposition-dialog", () => ({
  ImpositionDialog: (p: { open: boolean }) =>
    p.open ? <div data-testid="dlg-imposition" /> : null,
}));
vi.mock("../compress-dialog", () => ({
  CompressDialog: (p: { open: boolean }) =>
    p.open ? <div data-testid="dlg-compress" /> : null,
}));
vi.mock("../headers-footers-dialog", () => ({
  HeadersFootersDialog: (p: { open: boolean }) =>
    p.open ? <div data-testid="dlg-headers-footers" /> : null,
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

/** Click the menu item whose visible label matches exactly. */
function clickMenuItem(label: string) {
  const menu = screen.getByTestId("tools-menu-content");
  fireEvent.click(within(menu).getByText(label));
}

describe("EditorToolbar — responsive container (non-negotiable wrap)", () => {
  it("wraps onto multiple rows and never clips (no overflow-x)", () => {
    const { container } = render(<EditorToolbar {...baseProps()} />);
    const bar = container.querySelector(".editor-toolbar");
    expect(bar).not.toBeNull();
    expect(bar!.className).toContain("flex-wrap");
    expect(bar!.className).not.toContain("overflow-x");
    expect(bar!.className).not.toContain("overflow-hidden");
  });

  it("shows the tool buttons on lg+ (lg:contents) and the collapsed menu below lg (lg:hidden)", () => {
    const { container } = render(<EditorToolbar {...baseProps()} />);
    expect(container.querySelector(".hidden.lg\\:contents")).not.toBeNull();
    expect(container.querySelector(".lg\\:hidden")).not.toBeNull();
  });
});

describe("EditorToolbar — collapsed 'Outils' menu (same handlers as the buttons)", () => {
  it("exposes every PDF tool as a menu item (18 with indexOcr + header/footer wired)", () => {
    render(
      <EditorToolbar
        {...baseProps()}
        onIndexOcr={vi.fn()}
        onToggleHeaderFooterZones={vi.fn()}
      />,
    );
    const menu = screen.getByTestId("tools-menu-content");
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(18);
  });

  it("omits the optional items when their handlers are not wired (16 items)", () => {
    render(<EditorToolbar {...baseProps()} />);
    const menu = screen.getByTestId("tools-menu-content");
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(16);
  });

  it.each([
    ["editor.toolbar.merge", "dlg-merge"],
    ["editor.toolbar.split", "dlg-split"],
    ["editor.toolbar.encrypt", "dlg-encrypt"],
    ["editor.toolbar.sign", "dlg-sign"],
    ["editor.toolbar.metadata", "dlg-metadata"],
    ["editor.pageLabels.toolbarLabel", "dlg-page-labels"],
    ["editor.toolbar.convert", "dlg-convert"],
    ["editor.toolbar.compress", "dlg-compress"],
    ["Rechercher", "dlg-search"],
    ["Filigrane", "dlg-watermark"],
    ["OCR", "dlg-ocr"],
    ["PDF/A", "dlg-pdfa"],
    ["editor.presentation.toolbarLabel", "dlg-presentation"],
    ["editor.imposition.toolbarLabel", "dlg-imposition"],
  ])("menu item %s opens the same dialog as its button (%s)", (label, dlg) => {
    render(<EditorToolbar {...baseProps()} />);
    expect(screen.queryByTestId(dlg)).toBeNull();
    clickMenuItem(label);
    expect(screen.getByTestId(dlg)).toBeInTheDocument();
  });

  it("menu item 'forms' calls the same onToggleFormsPanel handler", () => {
    const onToggleFormsPanel = vi.fn();
    render(
      <EditorToolbar {...baseProps()} onToggleFormsPanel={onToggleFormsPanel} />,
    );
    clickMenuItem("editor.toolbar.forms");
    expect(onToggleFormsPanel).toHaveBeenCalledTimes(1);
  });

  it("menu item 'flatten' calls the same onFlattenPdf handler", () => {
    const onFlattenPdf = vi.fn();
    render(<EditorToolbar {...baseProps()} onFlattenPdf={onFlattenPdf} />);
    clickMenuItem("editor.toolbar.flatten");
    expect(onFlattenPdf).toHaveBeenCalledTimes(1);
  });

  it("menu item 'indexOcr' calls onIndexOcr and honours the busy gate", () => {
    const onIndexOcr = vi.fn();
    const { unmount } = render(
      <EditorToolbar {...baseProps()} onIndexOcr={onIndexOcr} />,
    );
    clickMenuItem("editor.toolbar.indexOcr");
    expect(onIndexOcr).toHaveBeenCalledTimes(1);
    unmount();

    // Busy: the item is disabled — clicking must NOT fire the handler.
    const onIndexOcrBusy = vi.fn();
    render(
      <EditorToolbar {...baseProps()} onIndexOcr={onIndexOcrBusy} indexOcrBusy />,
    );
    clickMenuItem("editor.toolbar.indexOcr");
    expect(onIndexOcrBusy).not.toHaveBeenCalled();
  });

  it("menu item 'headers/footers' enters zone mode (same handler as the button)", () => {
    const onToggleHeaderFooterZones = vi.fn();
    render(
      <EditorToolbar
        {...baseProps()}
        onToggleHeaderFooterZones={onToggleHeaderFooterZones}
      />,
    );
    clickMenuItem("editor.headersFooters.toolbarLabel");
    expect(onToggleHeaderFooterZones).toHaveBeenCalledTimes(1);
  });

  it("draw & redact stay reachable below md via the annotation dropdown entries", () => {
    const onToolChange = vi.fn();
    render(
      <EditorToolbar
        {...baseProps()}
        onToolChange={onToolChange}
        onRedactApply={vi.fn()}
      />,
    );
    // Open the annotation dropdown (its trigger also selects the tool).
    fireEvent.click(screen.getByTitle("editor.toolbar.annotation"));

    fireEvent.click(screen.getByTestId("annotation-dropdown-draw"));
    expect(onToolChange).toHaveBeenCalledWith("draw");

    fireEvent.click(screen.getByTitle("editor.toolbar.annotation"));
    fireEvent.click(screen.getByTestId("annotation-dropdown-redact"));
    expect(onToolChange).toHaveBeenCalledWith("redact");
  });

  it("menu item 'headers/footers' (legacy path) enables then opens the flat dialog", () => {
    const onToggleHeadersFooters = vi.fn();
    render(
      <EditorToolbar
        {...baseProps()}
        onToggleHeadersFooters={onToggleHeadersFooters}
        headersFootersEnabled={false}
      />,
    );
    expect(screen.queryByTestId("dlg-headers-footers")).toBeNull();
    clickMenuItem("editor.headersFooters.toolbarLabel");
    expect(onToggleHeadersFooters).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("dlg-headers-footers")).toBeInTheDocument();
  });
});
