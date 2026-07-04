/**
 * signature-capture-dialog.test.tsx
 *
 * Contract of the "Fill & Sign" capture dialog with TWO INDEPENDENT PADS:
 *
 * 1. Signature and initials each own a full pad (drawing canvas, typed text,
 *    upload, active method). Toggling kinds NEVER destroys the other pad:
 *    the inactive draw canvas stays mounted (same DOM node — its bitmap
 *    survives) and is never cleared by a switch.
 * 2. Insertion sends the ACTIVE kind with the captured payload.
 * 3. `defaultKind` presets the pad (the toolbar's "Paraphe" entry opens the
 *    dialog directly on initials).
 *
 * jsdom has no 2D canvas: `getContext`/`toDataURL` are stubbed per-canvas so
 * ink can be tracked (stroke() marks ink; getImageData reports it) and
 * `clearRect` calls can be asserted per pad.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";

// next-intl mock: namespaced so each label is unique (same factory shape as
// the sibling toolbar tests — shared fork, factory parity).
vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));

import { SignatureCaptureDialog } from "../signature-capture-dialog";

// --- Per-canvas 2D context stub ---------------------------------------------

interface FakeCtx {
  canvas: HTMLCanvasElement;
  inkStrokes: number;
  clearRect: ReturnType<typeof vi.fn>;
  [key: string]: unknown;
}

const contexts = new Map<HTMLCanvasElement, FakeCtx>();

function makeFakeCtx(canvas: HTMLCanvasElement): FakeCtx {
  const ctx: FakeCtx = {
    canvas,
    inkStrokes: 0,
    lineWidth: 0,
    lineCap: "butt",
    lineJoin: "miter",
    strokeStyle: "#000",
    fillStyle: "#000",
    font: "",
    textBaseline: "alphabetic",
    setTransform: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    stroke: vi.fn(() => {
      ctx.inkStrokes += 1;
    }),
    save: vi.fn(),
    restore: vi.fn(),
    clearRect: vi.fn(() => {
      ctx.inkStrokes = 0;
    }),
    drawImage: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({
      width: 120,
      actualBoundingBoxAscent: 50,
      actualBoundingBoxDescent: 20,
    })),
    getImageData: vi.fn((_x: number, _y: number, w: number, h: number) => {
      const data = new Uint8ClampedArray(w * h * 4);
      if (ctx.inkStrokes > 0) {
        // Paint a small opaque block so the ink-trim export finds a bbox.
        for (let y = 10; y < 20 && y < h; y++) {
          for (let x = 10; x < 30 && x < w; x++) {
            data[(y * w + x) * 4 + 3] = 255;
          }
        }
      }
      return { data, width: w, height: h };
    }),
  };
  return ctx;
}

let origGetContext: typeof HTMLCanvasElement.prototype.getContext;
let origToDataURL: typeof HTMLCanvasElement.prototype.toDataURL;

beforeAll(() => {
  origGetContext = HTMLCanvasElement.prototype.getContext;
  origToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
  ) {
    let ctx = contexts.get(this);
    if (!ctx) {
      ctx = makeFakeCtx(this);
      contexts.set(this, ctx);
    }
    return ctx;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.toDataURL = function () {
    return "data:image/png;base64,stub-ink";
  };
});

afterAll(() => {
  HTMLCanvasElement.prototype.getContext = origGetContext;
  HTMLCanvasElement.prototype.toDataURL = origToDataURL;
});

beforeEach(() => {
  contexts.clear();
  // Saved-marks fetch: empty account list by default (never blocks the pads).
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ signatures: [] }),
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

// --- Helpers ------------------------------------------------------------------

const T = (key: string) => `editor.signature.${key}`;

function padWrapper(kind: "signature" | "initials"): HTMLElement {
  return screen.getByTestId(`signature-draw-pad-${kind}`);
}

function padCanvas(kind: "signature" | "initials"): HTMLCanvasElement {
  const canvas = padWrapper(kind).querySelector("canvas");
  expect(canvas).not.toBeNull();
  return canvas as HTMLCanvasElement;
}

function drawOn(canvas: HTMLCanvasElement) {
  fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 40, clientY: 40 });
  fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 60, clientY: 50 });
  fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 80, clientY: 45 });
  fireEvent.pointerUp(canvas, { pointerId: 1 });
}

function renderDialog(
  over: Partial<React.ComponentProps<typeof SignatureCaptureDialog>> = {},
) {
  const onInsert = vi.fn();
  const onClose = vi.fn();
  render(
    <SignatureCaptureDialog
      open
      onClose={onClose}
      onInsert={onInsert}
      {...over}
    />,
  );
  return { onInsert, onClose };
}

// --- Tests --------------------------------------------------------------------

describe("SignatureCaptureDialog — two independent pads", () => {
  it("keeps the signature drawing intact while the initials pad is used, and inserts the right kind", async () => {
    const { onInsert } = renderDialog();

    // Draw on the SIGNATURE pad (default kind, default Draw method).
    const signatureCanvas = padCanvas("signature");
    drawOn(signatureCanvas);
    const signatureCtx = contexts.get(signatureCanvas)!;
    expect(signatureCtx.inkStrokes).toBeGreaterThan(0);

    // Switch to INITIALS → its own pad shows; the signature pad is only
    // CSS-hidden (same DOM node → its bitmap survives) and never cleared.
    fireEvent.click(screen.getByText(T("kindInitials")));
    expect(padWrapper("signature").className).toContain("hidden");
    expect(padWrapper("initials").className).not.toContain("hidden");
    expect(padCanvas("signature")).toBe(signatureCanvas);
    expect(signatureCtx.clearRect).not.toHaveBeenCalled();

    // Type on the INITIALS pad (its own method + text).
    fireEvent.click(screen.getByRole("tab", { name: T("tabType") }));
    fireEvent.change(screen.getByLabelText(T("tabType")), {
      target: { value: "AB" },
    });

    // Back to SIGNATURE: its pad reappears on ITS method (Draw), ink intact.
    fireEvent.click(screen.getByText(T("kindSignature")));
    expect(padWrapper("signature").className).not.toContain("hidden");
    expect(padCanvas("signature")).toBe(signatureCanvas);
    expect(signatureCtx.clearRect).not.toHaveBeenCalled();
    expect(signatureCtx.inkStrokes).toBeGreaterThan(0);
    expect(
      screen.getByRole("tab", { name: T("tabDraw") }),
    ).toHaveAttribute("aria-selected", "true");
    // hasInk survived the round-trip: clear is enabled again (each pad owns
    // its clear button — scope to the signature pad).
    expect(within(padWrapper("signature")).getByText(T("clear"))).toBeEnabled();

    // Insert → the SIGNATURE kind with the drawn payload.
    fireEvent.click(screen.getByText(T("insert")));
    await waitFor(() => expect(onInsert).toHaveBeenCalledTimes(1));
    expect(onInsert.mock.calls[0]![0]).toMatchObject({
      kind: "signature",
      dataUrl: "data:image/png;base64,stub-ink",
    });
  });

  it("keeps the initials typed text intact across kind switches and inserts kind=initials", async () => {
    const { onInsert } = renderDialog();

    // Initials pad: switch method to Type and write.
    fireEvent.click(screen.getByText(T("kindInitials")));
    fireEvent.click(screen.getByRole("tab", { name: T("tabType") }));
    fireEvent.change(screen.getByLabelText(T("tabType")), {
      target: { value: "RL" },
    });

    // Round-trip through the signature pad (Draw): the initials text +
    // method are untouched when coming back.
    fireEvent.click(screen.getByText(T("kindSignature")));
    expect(
      screen.getByRole("tab", { name: T("tabDraw") }),
    ).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByText(T("kindInitials")));
    expect(
      screen.getByRole("tab", { name: T("tabType") }),
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText(T("tabType"))).toHaveValue("RL");

    fireEvent.click(screen.getByText(T("insert")));
    await waitFor(() => expect(onInsert).toHaveBeenCalledTimes(1));
    expect(onInsert.mock.calls[0]![0]).toMatchObject({ kind: "initials" });
  });

  it("clears ONLY the active pad's drawing", () => {
    renderDialog();

    drawOn(padCanvas("signature"));
    const signatureCtx = contexts.get(padCanvas("signature"))!;

    fireEvent.click(screen.getByText(T("kindInitials")));
    drawOn(padCanvas("initials"));
    const initialsCtx = contexts.get(padCanvas("initials"))!;

    // Clear the INITIALS pad — the signature ink is untouched.
    fireEvent.click(within(padWrapper("initials")).getByText(T("clear")));
    expect(initialsCtx.clearRect).toHaveBeenCalledTimes(1);
    expect(signatureCtx.clearRect).not.toHaveBeenCalled();
    expect(signatureCtx.inkStrokes).toBeGreaterThan(0);
  });

  it("presets the kind from defaultKind (toolbar 'Paraphe' entry)", () => {
    renderDialog({ defaultKind: "initials" });
    const initialsToggle = screen.getByText(T("kindInitials"));
    expect(initialsToggle).toHaveAttribute("aria-pressed", "true");
    expect(padWrapper("initials").className).not.toContain("hidden");
    expect(padWrapper("signature").className).toContain("hidden");
  });

  it("disables insert until the ACTIVE pad has content", () => {
    renderDialog();
    const insertBtn = screen.getByText(T("insert"));
    // Empty signature draw pad → disabled.
    expect(insertBtn).toBeDisabled();
    // Ink on signature → enabled.
    drawOn(padCanvas("signature"));
    expect(insertBtn).toBeEnabled();
    // Initials pad is still empty → disabled again on switch.
    fireEvent.click(screen.getByText(T("kindInitials")));
    expect(insertBtn).toBeDisabled();
  });
});
