/**
 * click-outside-touch.test.tsx
 *
 * Mobile lot 2 — the editor's hand-rolled dropdowns close on POINTERDOWN
 * outside (covers mouse AND touch). The previous `mousedown` document
 * listeners never fired on touch, leaving menus stuck open on the finger.
 *
 * AddPageMenu is the representative here; editor-toolbar's Dropdown,
 * formatting-toolbar's spacing/paragraph popovers and insert-menu use the
 * exact same `document.addEventListener("pointerdown", …)` pattern.
 */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import { AddPageMenu } from "../add-page-menu";

afterEach(cleanup);

/** Dispatch a pointerdown that mimics a TOUCH tap (jsdom-safe). */
function fireTouchPointerDown(target: EventTarget): void {
  const event = new MouseEvent("pointerdown", {
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, "pointerId", { value: 1 });
  Object.defineProperty(event, "pointerType", { value: "touch" });
  // Raw dispatchEvent (fireEvent has no touch-pointer preset) → flush via act.
  act(() => {
    target.dispatchEvent(event);
  });
}

describe("AddPageMenu — close on outside tap (pointerdown)", () => {
  it("closes when a touch pointerdown lands outside the menu", () => {
    render(<AddPageMenu onAddPage={vi.fn()} />);

    fireEvent.click(screen.getByLabelText("toolbarLabel"));
    expect(screen.getByTestId("add-page-menu")).toBeInTheDocument();

    fireTouchPointerDown(document.body);
    expect(screen.queryByTestId("add-page-menu")).not.toBeInTheDocument();
  });

  it("stays open when the pointerdown lands inside the menu", () => {
    render(<AddPageMenu onAddPage={vi.fn()} />);

    fireEvent.click(screen.getByLabelText("toolbarLabel"));
    const menu = screen.getByTestId("add-page-menu");
    fireTouchPointerDown(menu);
    expect(screen.getByTestId("add-page-menu")).toBeInTheDocument();
  });

  it("still closes on a mouse pointerdown outside (desktop path)", () => {
    render(<AddPageMenu onAddPage={vi.fn()} />);

    fireEvent.click(screen.getByLabelText("toolbarLabel"));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId("add-page-menu")).not.toBeInTheDocument();
  });
});
