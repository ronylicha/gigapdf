"use client";

import React, { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { ShapeType } from "@giga-pdf/types";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Image as ImageIcon,
  FileCode,
  Table,
  Shapes,
  Square,
  Circle,
  Minus,
  ArrowRight,
  Link2,
  FilePlus2,
  List,
  ListOrdered,
} from "lucide-react";

/** Max grid offered by the inline table size picker (Word-like). */
const TABLE_PICKER_ROWS = 8;
const TABLE_PICKER_COLS = 10;

const SHAPE_ITEMS: ReadonlyArray<{
  shape: ShapeType;
  icon: React.ReactNode;
  labelKey: string;
}> = [
  { shape: "rectangle", icon: <Square size={16} />, labelKey: "shapes.rectangle" },
  { shape: "ellipse", icon: <Circle size={16} />, labelKey: "shapes.ellipse" },
  { shape: "line", icon: <Minus size={16} />, labelKey: "shapes.line" },
  { shape: "arrow", icon: <ArrowRight size={16} />, labelKey: "shapes.arrow" },
];

export interface InsertMenuProps {
  /** Open the image file picker + embed flow (reuses the toolbar image add). */
  onInsertImage: () => void;
  /** Open the insert-SVG dialog (paste markup or upload a .svg file). */
  onInsertSvg: () => void;
  /** Insert an N×M table of editable cells + borders. */
  onInsertTable: (rows: number, cols: number) => void;
  /** Activate the shape tool with the chosen shape so the user drags to draw. */
  onInsertShape: (shape: ShapeType) => void;
  /** Open the link dialog (acts on the selected text element). */
  onInsertLink: () => void;
  /** Insert a blank page before / after the current page. */
  onInsertBlankPage: (position: "before" | "after") => void;
  /** Apply bullet / numbered list formatting to the selected text element. */
  onInsertList: (kind: "bullet" | "numbered") => void;
  /** A single text element is selected (gates link + list items). */
  hasTextSelection: boolean;
}

type SubMenu = "table" | "shapes" | "page" | "list" | null;

export interface InsertMenuItemsProps extends InsertMenuProps {
  /**
   * Called right before each terminal action fires, so the HOST surface can
   * close itself (the desktop dropdown closes its popover; the mobile tools
   * bottom-sheet dismisses). Sub-menu toggles do NOT trigger it.
   */
  onAction: () => void;
}

/**
 * The Insert menu CONTENT (items + inline sub-flyouts), extracted so the SAME
 * wiring is rendered on two surfaces: inside the desktop {@link InsertMenu}
 * dropdown, and inline inside the mobile tools bottom-sheet. Every action
 * funnels into the editor's existing element-add / page-op / element-update
 * paths — no new save path.
 */
export function InsertMenuItems({
  onInsertImage,
  onInsertSvg,
  onInsertTable,
  onInsertShape,
  onInsertLink,
  onInsertBlankPage,
  onInsertList,
  hasTextSelection,
  onAction,
}: InsertMenuItemsProps) {
  const t = useTranslations("editor.insert");
  const [sub, setSub] = useState<SubMenu>(null);
  const [hover, setHover] = useState<{ r: number; c: number }>({ r: 0, c: 0 });

  const close = () => {
    setSub(null);
    onAction();
  };

  const itemClass =
    "flex w-full items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors hover:bg-muted text-foreground pointer-coarse:min-h-11";
  const itemDisabledClass =
    "flex w-full items-center gap-2 px-2 py-1.5 rounded text-sm text-muted-foreground/50 cursor-not-allowed pointer-coarse:min-h-11";

  return (
    <div className="flex flex-col gap-1">
            {/* Image */}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                close();
                onInsertImage();
              }}
              className={itemClass}
            >
              <ImageIcon size={16} />
              <span>{t("image")}</span>
            </button>

            {/* SVG (paste markup or upload a .svg file) */}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                close();
                onInsertSvg();
              }}
              className={itemClass}
            >
              <FileCode size={16} />
              <span>{t("svg")}</span>
            </button>

            {/* Table (inline size picker) */}
            <div>
              <button
                type="button"
                role="menuitem"
                aria-haspopup="true"
                aria-expanded={sub === "table"}
                onClick={() => setSub(sub === "table" ? null : "table")}
                className={`${itemClass} justify-between`}
              >
                <span className="flex items-center gap-2">
                  <Table size={16} />
                  {t("table")}
                </span>
                <ChevronRight size={14} />
              </button>
              {sub === "table" ? (
                <div className="mt-1 rounded-md border border-border bg-background p-2">
                  <div
                    className="grid gap-0.5"
                    style={{
                      gridTemplateColumns: `repeat(${TABLE_PICKER_COLS}, 1fr)`,
                    }}
                    onMouseLeave={() => setHover({ r: 0, c: 0 })}
                  >
                    {Array.from({ length: TABLE_PICKER_ROWS }).map((_, r) =>
                      Array.from({ length: TABLE_PICKER_COLS }).map((__, c) => {
                        const active = r < hover.r && c < hover.c;
                        return (
                          <button
                            key={`${r}-${c}`}
                            type="button"
                            aria-label={`${r + 1} × ${c + 1}`}
                            onMouseEnter={() => setHover({ r: r + 1, c: c + 1 })}
                            onClick={() => {
                              close();
                              onInsertTable(r + 1, c + 1);
                            }}
                            className={`h-4 w-4 rounded-[2px] border ${
                              active
                                ? "border-primary bg-primary/60"
                                : "border-border bg-muted/40 hover:border-primary/50"
                            }`}
                          />
                        );
                      }),
                    )}
                  </div>
                  <p className="mt-1.5 text-center text-xs text-muted-foreground">
                    {hover.r > 0
                      ? t("tableSize", { rows: hover.r, cols: hover.c })
                      : t("tableHint")}
                  </p>
                </div>
              ) : null}
            </div>

            {/* Shapes */}
            <div>
              <button
                type="button"
                role="menuitem"
                aria-haspopup="true"
                aria-expanded={sub === "shapes"}
                onClick={() => setSub(sub === "shapes" ? null : "shapes")}
                className={`${itemClass} justify-between`}
              >
                <span className="flex items-center gap-2">
                  <Shapes size={16} />
                  {t("shape")}
                </span>
                <ChevronRight size={14} />
              </button>
              {sub === "shapes" ? (
                <div className="mt-1 flex flex-col gap-1 rounded-md border border-border bg-background p-1">
                  {SHAPE_ITEMS.map(({ shape, icon, labelKey }) => (
                    <button
                      key={shape}
                      type="button"
                      onClick={() => {
                        close();
                        onInsertShape(shape);
                      }}
                      className={itemClass}
                    >
                      {icon}
                      <span>{t(labelKey)}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {/* Link (needs a selected text element) */}
            <button
              type="button"
              role="menuitem"
              disabled={!hasTextSelection}
              title={hasTextSelection ? undefined : t("linkNeedsSelection")}
              onClick={() => {
                if (!hasTextSelection) return;
                close();
                onInsertLink();
              }}
              className={hasTextSelection ? itemClass : itemDisabledClass}
            >
              <Link2 size={16} />
              <span>{t("link")}</span>
            </button>

            {/* List (needs a selected text element) */}
            <div>
              <button
                type="button"
                role="menuitem"
                aria-haspopup="true"
                aria-expanded={sub === "list"}
                disabled={!hasTextSelection}
                title={hasTextSelection ? undefined : t("listNeedsSelection")}
                onClick={() => {
                  if (!hasTextSelection) return;
                  setSub(sub === "list" ? null : "list");
                }}
                className={
                  hasTextSelection
                    ? `${itemClass} justify-between`
                    : itemDisabledClass
                }
              >
                <span className="flex items-center gap-2">
                  <List size={16} />
                  {t("list")}
                </span>
                {hasTextSelection ? <ChevronRight size={14} /> : null}
              </button>
              {sub === "list" && hasTextSelection ? (
                <div className="mt-1 flex flex-col gap-1 rounded-md border border-border bg-background p-1">
                  <button
                    type="button"
                    onClick={() => {
                      close();
                      onInsertList("bullet");
                    }}
                    className={itemClass}
                  >
                    <List size={16} />
                    <span>{t("listBullet")}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      close();
                      onInsertList("numbered");
                    }}
                    className={itemClass}
                  >
                    <ListOrdered size={16} />
                    <span>{t("listNumbered")}</span>
                  </button>
                </div>
              ) : null}
            </div>

            {/* Blank page before / after */}
            <div>
              <button
                type="button"
                role="menuitem"
                aria-haspopup="true"
                aria-expanded={sub === "page"}
                onClick={() => setSub(sub === "page" ? null : "page")}
                className={`${itemClass} justify-between`}
              >
                <span className="flex items-center gap-2">
                  <FilePlus2 size={16} />
                  {t("page")}
                </span>
                <ChevronRight size={14} />
              </button>
              {sub === "page" ? (
                <div className="mt-1 flex flex-col gap-1 rounded-md border border-border bg-background p-1">
                  <button
                    type="button"
                    onClick={() => {
                      close();
                      onInsertBlankPage("before");
                    }}
                    className={itemClass}
                  >
                    <span>{t("pageBefore")}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      close();
                      onInsertBlankPage("after");
                    }}
                    className={itemClass}
                  >
                    <span>{t("pageAfter")}</span>
                  </button>
                </div>
              ) : null}
            </div>
    </div>
  );
}

/**
 * Word-like "Insert" menu surfaced as a single toolbar cluster. The dropdown
 * mirrors the toolbar's own custom `Dropdown` pattern (click-outside to close,
 * no external menu lib) and renders {@link InsertMenuItems} — the same content
 * the mobile tools bottom-sheet reuses inline.
 */
export function InsertMenu(props: InsertMenuProps) {
  const t = useTranslations("editor.insert");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    // pointerdown couvre souris ET tactile (fermeture au doigt).
    document.addEventListener("pointerdown", handleClickOutside);
    return () => document.removeEventListener("pointerdown", handleClickOutside);
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        title={t("menu")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`p-2 rounded-lg transition-colors flex items-center gap-0.5 ${
          open
            ? "bg-muted text-foreground"
            : "hover:bg-muted text-muted-foreground hover:text-foreground"
        }`}
      >
        <Plus size={20} />
        <ChevronDown size={12} />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute top-full left-0 mt-1 bg-background border rounded-lg shadow-lg p-2 z-50 min-w-[200px]"
        >
          {/* Unmounting on close resets the sub-flyout state for each open. */}
          <InsertMenuItems {...props} onAction={() => setOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}
