/**
 * mobile-zoom-controls.test.tsx
 *
 * MobileZoomControls — floating bottom-right zoom cluster (mobile, md:hidden).
 *
 * Contract:
 * - `−` / `+` request a MANUAL zoom step (×/÷ 1.25) through `onZoomChange`
 *   (the caller wires `handleManualZoomChange`, which exits fit mode);
 * - steps are clamped to the engine bounds (10 % – 800 %) and the buttons
 *   disable at the bounds;
 * - the % readout shows the rounded percentage and, on tap, cycles
 *   fit-width → fit-page → 100 % → fit-width;
 * - the wrapper is mobile-only (`md:hidden`) with ≥44px touch targets.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MobileZoomControls } from "../mobile-zoom-controls";

// next-intl mock: namespaced so each label is unique.
vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));

afterEach(cleanup);

function renderControls({
  zoom = 1,
  fitMode = null as "page" | "width" | null,
  onZoomChange = vi.fn(),
  onFitPage = vi.fn(),
  onFitWidth = vi.fn(),
} = {}) {
  const { container } = render(
    <MobileZoomControls
      zoom={zoom}
      fitMode={fitMode}
      onZoomChange={onZoomChange}
      onFitPage={onFitPage}
      onFitWidth={onFitWidth}
    />,
  );
  return { container, onZoomChange, onFitPage, onFitWidth };
}

const zoomOutButton = () =>
  screen.getByRole("button", { name: "editor.toolbar.zoomOut" });
const zoomInButton = () =>
  screen.getByRole("button", { name: "editor.toolbar.zoomIn" });
const levelButton = () =>
  screen.getByRole("button", { name: "editor.toolbar.zoomLevel" });

describe("MobileZoomControls", () => {
  it("shows the rounded zoom percentage", () => {
    renderControls({ zoom: 1.254 });
    expect(levelButton().textContent).toBe("125%");
  });

  it("steps zoom up by ×1.25 through onZoomChange", () => {
    const { onZoomChange } = renderControls({ zoom: 1 });
    fireEvent.click(zoomInButton());
    expect(onZoomChange).toHaveBeenCalledWith(1.25);
  });

  it("steps zoom down by ÷1.25 through onZoomChange", () => {
    const { onZoomChange } = renderControls({ zoom: 1 });
    fireEvent.click(zoomOutButton());
    expect(onZoomChange).toHaveBeenCalledWith(1 / 1.25);
  });

  it("clamps the + step to the 800 % engine bound and disables at it", () => {
    const { onZoomChange } = renderControls({ zoom: 7 });
    fireEvent.click(zoomInButton());
    expect(onZoomChange).toHaveBeenCalledWith(8); // min(8, 7×1.25)

    cleanup();
    renderControls({ zoom: 8 });
    expect(zoomInButton()).toBeDisabled();
  });

  it("clamps the − step to the 10 % engine bound and disables at it", () => {
    const { onZoomChange } = renderControls({ zoom: 0.11 });
    fireEvent.click(zoomOutButton());
    expect(onZoomChange).toHaveBeenCalledWith(0.1); // max(0.1, 0.11÷1.25)

    cleanup();
    renderControls({ zoom: 0.1 });
    expect(zoomOutButton()).toBeDisabled();
  });

  it("cycles fit-width → fit-page on % tap", () => {
    const { onFitPage, onFitWidth, onZoomChange } = renderControls({
      fitMode: "width",
    });
    fireEvent.click(levelButton());
    expect(onFitPage).toHaveBeenCalledTimes(1);
    expect(onFitWidth).not.toHaveBeenCalled();
    expect(onZoomChange).not.toHaveBeenCalled();
  });

  it("cycles fit-page → 100 % on % tap", () => {
    const { onFitPage, onFitWidth, onZoomChange } = renderControls({
      fitMode: "page",
      zoom: 0.8,
    });
    fireEvent.click(levelButton());
    expect(onZoomChange).toHaveBeenCalledWith(1);
    expect(onFitPage).not.toHaveBeenCalled();
    expect(onFitWidth).not.toHaveBeenCalled();
  });

  it("cycles manual zoom → fit-width on % tap", () => {
    const { onFitPage, onFitWidth, onZoomChange } = renderControls({
      fitMode: null,
    });
    fireEvent.click(levelButton());
    expect(onFitWidth).toHaveBeenCalledTimes(1);
    expect(onFitPage).not.toHaveBeenCalled();
    expect(onZoomChange).not.toHaveBeenCalled();
  });

  it("is mobile-only (md:hidden wrapper) with ≥44px touch targets", () => {
    const { container } = renderControls();
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("md:hidden");
    // 44px targets: h-11 (buttons) — the % readout also spans h-11.
    expect(zoomInButton().className).toContain("h-11");
    expect(zoomOutButton().className).toContain("w-11");
    expect(levelButton().className).toContain("h-11");
  });
});
