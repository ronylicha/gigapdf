/**
 * editor-toolbar-mobile-sheet.test.tsx
 *
 * Mobile toolbar contract (lot 2 — compact row + bottom-sheet, Adobe-mobile
 * pattern):
 *
 * 1. Below md the toolbar keeps ONE compact primary row: select / text / hand,
 *    Fill & Sign, undo/redo and the "Tools" bottom-sheet opener. Every other
 *    group (shapes, annotations, form fields, insert, colours, PDF tools,
 *    view controls, content-edit…) is CSS-hidden (`hidden md:*`) and served
 *    from the bottom-sheet instead — no functionality removed.
 * 2. Every sheet entry triggers the SAME handler as its desktop button twin
 *    (dialog openers flip the same dialog `open` prop; tool entries call the
 *    same prop callbacks) and then dismisses the sheet.
 *
 * `useIsMobile` is mocked to `true` so the (mobile-only) sheet tree mounts in
 * jsdom; the @giga-pdf/ui Sheet primitives are stubbed as passthroughs so the
 * test drives the toolbar's own wiring — not Radix internals.
 */
import {
  describe,
  it,
  expect,
  vi,
  afterEach,
  beforeAll,
  afterAll,
} from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  within,
} from "@testing-library/react";
import type { Tool } from "@giga-pdf/types";

// next-intl mock: namespaced so each label is unique.
vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));

// Force the mobile branch via a matchMedia stub (the hook reads it live and
// defaults to desktop in bare jsdom). Same pattern as use-media-query.test —
// NO vi.mock on the hook module, so the shared-fork module registry
// (`isolate: false`) never diverges between test files.
beforeAll(() => {
  (window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia =
    ((query: string) => ({
      matches: query === "(max-width: 767px)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
});

afterAll(() => {
  // jsdom has no native matchMedia — restore the bare environment so later
  // files in the shared fork keep the desktop default.
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
});

// @giga-pdf/ui — the SAME factory shape as the sibling toolbar tests (shared
// fork, `isolate: false`: keeping the factories equivalent makes the file
// order irrelevant), extended with Sheet passthroughs for the bottom-sheet.
// Sheet queries below are scoped `within(body)` so the (always-rendered)
// dropdown passthrough labels never collide with the sheet entries.
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
// sheet-entry tap can be asserted to open the SAME dialog as the button.
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
vi.mock("../insert-link-dialog", () => ({ InsertLinkDialog: () => null }));
vi.mock("../insert-svg-dialog", () => ({ InsertSvgDialog: () => null }));
vi.mock("../header-footer-page-setup", () => ({
  HeaderFooterPageSetup: () => null,
}));
// insert-menu / add-page-menu stay REAL (importOriginal): the sheet renders
// their extracted content (InsertMenuItems / AddPageForm) — same wiring as the
// desktop menus. They MUST be declared as mocks anyway: with the shared fork
// (`isolate: false`) the per-file remock only stays sound when every sibling
// file mocks the SAME specifier set for this module graph.
vi.mock("../insert-menu", async (importOriginal) => await importOriginal());
vi.mock("../add-page-menu", async (importOriginal) => await importOriginal());

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

function editToolsProps(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    onFindReplace: vi.fn(),
    onCopy: vi.fn(),
    onCut: vi.fn(),
    onPaste: vi.fn(),
    onCopyFormat: vi.fn(),
    hasSelection: false,
    canCopyFormat: false,
    canPaste: false,
    formatPainterArmed: false,
    ...overrides,
  };
}

/** Open the bottom-sheet via the mobile "Tools" opener and return its body. */
function openSheet() {
  fireEvent.click(screen.getByTestId("mobile-tools-open"));
  return screen.getByTestId("mobile-tools-sheet-body");
}

describe("EditorToolbar — mobile compact primary row (< md)", () => {
  it("keeps the primary tools visible and folds every secondary group away", () => {
    render(<EditorToolbar {...baseProps()} />);

    // Primary row: select / text / hand, Fill & Sign, undo/redo + opener —
    // none of them wrapped in a `hidden` (md-only) container.
    for (const title of [
      "editor.toolbar.select",
      "editor.toolbar.text",
      "editor.toolbar.pan",
      "editor.toolbar.fillSign",
      "editor.toolbar.undo",
      "editor.toolbar.redo",
    ]) {
      const btn = screen.getByTitle(title);
      expect(btn.closest(".hidden")).toBeNull();
    }
    const opener = screen.getByTestId("mobile-tools-open");
    expect(opener.closest(".md\\:hidden")).not.toBeNull();

    // Secondary groups are CSS-hidden below md (still mounted for md+).
    for (const title of [
      "editor.toolbar.image",
      "editor.toolbar.insertSignature",
      "editor.toolbar.shape",
      "editor.toolbar.annotation",
      "editor.toolbar.formField",
      "editor.toolbar.colors",
      "editor.toolbar.contentEdit",
      "editor.toolbar.zoomOut",
    ]) {
      expect(screen.getByTitle(title).closest(".hidden")).not.toBeNull();
    }
  });

  it("keeps the non-negotiable wrap container (no overflow-x)", () => {
    const { container } = render(<EditorToolbar {...baseProps()} />);
    const bar = container.querySelector(".editor-toolbar");
    expect(bar).not.toBeNull();
    expect(bar!.className).toContain("flex-wrap");
    expect(bar!.className).not.toContain("overflow-x");
    expect(bar!.className).not.toContain("overflow-hidden");
  });
});

describe("EditorToolbar — mobile tools bottom-sheet (same handlers as desktop)", () => {
  it("opens with the titled sections and closes after selecting a tool", () => {
    render(
      <EditorToolbar
        {...baseProps()}
        onViewModeChange={vi.fn()}
        editTools={editToolsProps()}
      />,
    );
    expect(screen.queryByTestId("mobile-tools-sheet-body")).toBeNull();

    const body = openSheet();
    for (const section of [
      "edit",
      "colors",
      "insert",
      "annotate",
      "forms",
      "document",
      "view",
      "editing",
    ]) {
      expect(
        within(body).getByText(
          `editor.toolbar.mobileTools.sections.${section}`,
        ),
      ).toBeInTheDocument();
    }

    // Selecting a tool activates it AND dismisses the sheet.
    fireEvent.click(within(body).getByTitle("editor.toolbar.draw"));
    expect(screen.queryByTestId("mobile-tools-sheet-body")).toBeNull();
  });

  it("shape entries call the same onShapeTypeChange + onToolChange pair", () => {
    const onToolChange = vi.fn();
    const onShapeTypeChange = vi.fn();
    render(
      <EditorToolbar
        {...baseProps()}
        onToolChange={onToolChange}
        onShapeTypeChange={onShapeTypeChange}
      />,
    );
    const body = openSheet();
    fireEvent.click(within(body).getByTitle("editor.toolbar.rectangle"));
    expect(onShapeTypeChange).toHaveBeenCalledWith("rectangle");
    expect(onToolChange).toHaveBeenCalledWith("shape");
  });

  it("annotation entries call the same onAnnotationTypeChange + onToolChange pair", () => {
    const onToolChange = vi.fn();
    const onAnnotationTypeChange = vi.fn();
    render(
      <EditorToolbar
        {...baseProps()}
        onToolChange={onToolChange}
        onAnnotationTypeChange={onAnnotationTypeChange}
      />,
    );
    const body = openSheet();
    fireEvent.click(within(body).getByTitle("editor.toolbar.highlight"));
    expect(onAnnotationTypeChange).toHaveBeenCalledWith("highlight");
    expect(onToolChange).toHaveBeenCalledWith("annotation");
  });

  it("draw & redact entries select the same tools", () => {
    const onToolChange = vi.fn();
    render(
      <EditorToolbar
        {...baseProps()}
        onToolChange={onToolChange}
        onRedactApply={vi.fn()}
      />,
    );
    let body = openSheet();
    fireEvent.click(within(body).getByTitle("editor.toolbar.draw"));
    expect(onToolChange).toHaveBeenCalledWith("draw");

    body = openSheet();
    fireEvent.click(within(body).getByTitle("editor.toolbar.redact"));
    expect(onToolChange).toHaveBeenCalledWith("redact");
  });

  it("form-field entries call the same onFieldKindChange + onToolChange pair", () => {
    const onToolChange = vi.fn();
    const onFieldKindChange = vi.fn();
    render(
      <EditorToolbar
        {...baseProps()}
        onToolChange={onToolChange}
        onFieldKindChange={onFieldKindChange}
      />,
    );
    const body = openSheet();
    fireEvent.click(
      within(body).getByTitle("editor.toolbar.fields.checkbox"),
    );
    expect(onFieldKindChange).toHaveBeenCalledWith("checkbox");
    expect(onToolChange).toHaveBeenCalledWith("form_field");
  });

  it("image entry runs the toolbar image flow (onToolChange + onAddImage)", () => {
    const onToolChange = vi.fn();
    const onAddImage = vi.fn();
    render(
      <EditorToolbar
        {...baseProps()}
        onToolChange={onToolChange}
        onAddImage={onAddImage}
      />,
    );
    const body = openSheet();
    fireEvent.click(within(body).getByTitle("editor.toolbar.image"));
    expect(onToolChange).toHaveBeenCalledWith("image");
    expect(onAddImage).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["editor.toolbar.merge", "dlg-merge"],
    ["editor.toolbar.split", "dlg-split"],
    ["editor.toolbar.encrypt", "dlg-encrypt"],
    ["editor.toolbar.sign", "dlg-sign"],
    ["editor.toolbar.metadata", "dlg-metadata"],
    ["editor.toolbar.convert", "dlg-convert"],
    ["editor.toolbar.compress", "dlg-compress"],
    ["Rechercher", "dlg-search"],
    ["Filigrane", "dlg-watermark"],
    ["OCR", "dlg-ocr"],
    ["PDF/A", "dlg-pdfa"],
  ])(
    "document entry %s opens the same dialog as its desktop button (%s)",
    (label, dlg) => {
      render(<EditorToolbar {...baseProps()} />);
      expect(screen.queryByTestId(dlg)).toBeNull();
      const body = openSheet();
      fireEvent.click(within(body).getByTitle(label));
      expect(screen.getByTestId(dlg)).toBeInTheDocument();
      // Dialog opened, sheet dismissed.
      expect(screen.queryByTestId("mobile-tools-sheet-body")).toBeNull();
    },
  );

  it("view entries drive view mode, rulers and fit modes with the same handlers", () => {
    const onViewModeChange = vi.fn();
    const onToggleRulers = vi.fn();
    const onFitWidth = vi.fn();
    render(
      <EditorToolbar
        {...baseProps()}
        viewMode="single"
        onViewModeChange={onViewModeChange}
        onToggleRulers={onToggleRulers}
        onFitPage={vi.fn()}
        onFitWidth={onFitWidth}
      />,
    );
    let body = openSheet();
    fireEvent.click(
      within(body).getByTitle("editor.toolbar.viewModeContinuous"),
    );
    expect(onViewModeChange).toHaveBeenCalledWith("continuous");

    body = openSheet();
    fireEvent.click(
      within(body).getByTitle("editor.toolbar.rulersAndMargins"),
    );
    expect(onToggleRulers).toHaveBeenCalledTimes(1);

    body = openSheet();
    fireEvent.click(within(body).getByTitle("editor.toolbar.fitWidth"));
    expect(onFitWidth).toHaveBeenCalledTimes(1);
  });

  it("content-edit entry toggles the same handler", () => {
    const onToggleContentEdit = vi.fn();
    render(
      <EditorToolbar
        {...baseProps()}
        onToggleContentEdit={onToggleContentEdit}
      />,
    );
    const body = openSheet();
    fireEvent.click(within(body).getByTitle("editor.toolbar.contentEdit"));
    expect(onToggleContentEdit).toHaveBeenCalledTimes(1);
  });

  it("insert section reuses the InsertMenu items (image fires onAddImage)", () => {
    const onAddImage = vi.fn();
    render(<EditorToolbar {...baseProps()} onAddImage={onAddImage} />);
    const body = openSheet();
    fireEvent.click(within(body).getByText("editor.insert.image"));
    expect(onAddImage).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("mobile-tools-sheet-body")).toBeNull();
  });

  it("add-page accordion confirms through the same onAddPageFormat handler", () => {
    const onAddPageFormat = vi.fn();
    render(
      <EditorToolbar {...baseProps()} onAddPageFormat={onAddPageFormat} />,
    );
    const body = openSheet();
    // Expand the accordion, then confirm with the defaults (A4 / portrait /
    // after) — the exact same wiring as the desktop AddPageMenu popover.
    fireEvent.click(within(body).getByText("editor.addPage.toolbarLabel"));
    fireEvent.click(within(body).getByText("editor.addPage.add"));
    expect(onAddPageFormat).toHaveBeenCalledWith(
      "a4",
      "portrait",
      "after",
      undefined,
    );
    expect(screen.queryByTestId("mobile-tools-sheet-body")).toBeNull();
  });

  it("editing section mirrors the EditorEditTools wiring (copy gated by selection)", () => {
    const blocked = editToolsProps();
    const { unmount } = render(
      <EditorToolbar {...baseProps()} editTools={blocked} />,
    );
    let body = openSheet();
    const disabledCopy = within(body).getByTitle(
      "editor.editTools.clipboard.copy",
    );
    expect(disabledCopy).toBeDisabled();
    fireEvent.click(disabledCopy);
    expect(blocked.onCopy).not.toHaveBeenCalled();
    unmount();

    const armed = editToolsProps({ hasSelection: true, canPaste: true });
    render(<EditorToolbar {...baseProps()} editTools={armed} />);
    body = openSheet();
    fireEvent.click(within(body).getByTitle("editor.editTools.clipboard.copy"));
    expect(armed.onCopy).toHaveBeenCalledTimes(1);
  });

  it("find & replace entry fires the same handler", () => {
    const tools = editToolsProps();
    render(<EditorToolbar {...baseProps()} editTools={tools} />);
    const body = openSheet();
    fireEvent.click(
      within(body).getByTitle("editor.editTools.findReplace.open"),
    );
    expect(tools.onFindReplace).toHaveBeenCalledTimes(1);
  });

  it("colour section drives the same stroke/fill handlers without closing", () => {
    const onStrokeColorChange = vi.fn();
    render(
      <EditorToolbar
        {...baseProps()}
        strokeColor="#000000"
        onStrokeColorChange={onStrokeColorChange}
      />,
    );
    const body = openSheet();
    // Preset swatches carry the colour as their title; the stroke picker is
    // rendered first (the fill picker owns the second match).
    const swatches = within(body).getAllByTitle("#ff0000");
    expect(swatches.length).toBeGreaterThan(0);
    fireEvent.click(swatches[0]!);
    expect(onStrokeColorChange).toHaveBeenCalledWith("#ff0000");
    // Colour tweaks keep the sheet open (contextual picker).
    expect(screen.getByTestId("mobile-tools-sheet-body")).toBeInTheDocument();
  });

  it("omits the editing section when editTools is not wired", () => {
    render(<EditorToolbar {...baseProps()} />);
    const body = openSheet();
    expect(
      within(body).queryByText("editor.toolbar.mobileTools.sections.editing"),
    ).toBeNull();
  });
});
