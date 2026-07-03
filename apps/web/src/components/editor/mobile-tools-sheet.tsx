"use client";

/**
 * mobile-tools-sheet.tsx
 *
 * The Adobe-mobile-style "all tools" bottom-sheet for the editor toolbar on
 * small screens (< md). The compact single-row toolbar keeps only the primary
 * tools; EVERYTHING else lives here, organised in titled sections rendered as
 * icon+label grids (≥44px touch targets). Selecting a tool runs the SAME
 * handler as its desktop button twin (the toolbar builds the entries from its
 * own wiring) and closes the sheet — zero behaviour change, only placement.
 *
 * Purely presentational: sections/entries are built by EditorToolbar so all
 * dialog state and tool handlers stay in one place.
 */

import React from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@giga-pdf/ui";

export interface MobileToolEntry {
  key: string;
  icon: React.ReactNode;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  isActive?: boolean;
}

export interface MobileToolsSection {
  key: string;
  title: string;
  /** Icon+label grid entries (44px targets). */
  entries?: MobileToolEntry[];
  /** Free-form block rendered under the grid (colour pickers, insert items…). */
  content?: React.ReactNode;
}

export interface MobileToolsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  sections: MobileToolsSection[];
}

function SectionGrid({ entries }: { entries: MobileToolEntry[] }) {
  return (
    <div className="grid grid-cols-4 gap-1">
      {entries.map(({ key, icon, label, onSelect, disabled, isActive }) => (
        <button
          key={key}
          type="button"
          onClick={onSelect}
          disabled={disabled}
          aria-pressed={isActive}
          title={label}
          className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-lg p-1.5 text-center transition-colors duration-150 ${
            isActive
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
        >
          {icon}
          <span className="line-clamp-2 w-full text-[11px] leading-tight">
            {label}
          </span>
        </button>
      ))}
    </div>
  );
}

export function MobileToolsSheet({
  open,
  onOpenChange,
  title,
  sections,
}: MobileToolsSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" style={{ maxHeight: "70dvh" }}>
        <SheetHeader className="shrink-0 border-b px-4 py-3">
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <div
          data-testid="mobile-tools-sheet-body"
          className="overflow-y-auto px-3 pb-6"
        >
          {sections.map(({ key, title: sectionTitle, entries, content }) => (
            <section key={key} aria-label={sectionTitle}>
              <h3 className="px-1 pb-1.5 pt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {sectionTitle}
              </h3>
              {entries && entries.length > 0 ? (
                <SectionGrid entries={entries} />
              ) : null}
              {content ?? null}
            </section>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
