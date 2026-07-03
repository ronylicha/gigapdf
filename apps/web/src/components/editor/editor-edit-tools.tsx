"use client";

import React from "react";
import {
  Replace,
  ClipboardCopy,
  Scissors,
  ClipboardPaste,
  Paintbrush,
  Table,
} from "lucide-react";
import { useTranslations } from "next-intl";

export interface EditorEditToolsProps {
  /** Open the find & replace dialog. */
  onFindReplace: () => void;
  /** Copy the current selection to the in-app clipboard. */
  onCopy: () => void;
  /** Cut the current selection (copy + delete). */
  onCut: () => void;
  /** Paste the in-app clipboard (offset clones). */
  onPaste: () => void;
  /** Pick up the formatting of the selected text element ("copy format"). */
  onCopyFormat: () => void;
  /** True while at least one element is selected. */
  hasSelection: boolean;
  /** True when a single text element is selected (format painter source). */
  canCopyFormat: boolean;
  /** True when the in-app clipboard has content to paste. */
  canPaste: boolean;
  /** True while a format has been picked up and is armed to be applied. */
  formatPainterArmed: boolean;
  /**
   * Toggle the table-editing overlay (select a reconstructed table → add/remove
   * rows & columns). Omitted (with `tableEditActive` undefined) when the host
   * does not wire table editing — the button is then hidden, keeping the bar
   * backward-compatible.
   */
  onToggleTableEdit?: () => void;
  /** True while the table-editing overlay is shown (drives the toggle state). */
  tableEditActive?: boolean;
  /** Number of editable tables detected on the document (gates the toggle). */
  tableCount?: number;
}

interface ToolButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  isActive?: boolean;
}

function ToolButton({
  icon,
  label,
  onClick,
  disabled,
  isActive,
}: ToolButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={isActive}
      className={`p-2 rounded-lg transition-colors flex items-center justify-center gap-1 pointer-coarse:min-h-11 pointer-coarse:min-w-11 ${
        isActive
          ? "bg-primary text-primary-foreground"
          : "hover:bg-muted text-muted-foreground hover:text-foreground"
      } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
    >
      {icon}
    </button>
  );
}

function Separator() {
  return <div className="w-px h-6 bg-border mx-1" />;
}

/**
 * EditorEditTools — a compact secondary toolbar row for the P7 editing
 * toolset (find & replace, clipboard, format painter). Kept as a standalone
 * component (rendered right under the main EditorToolbar) so the primary
 * toolbar file stays untouched and merges remain conflict-free.
 */
export function EditorEditTools({
  onFindReplace,
  onCopy,
  onCut,
  onPaste,
  onCopyFormat,
  hasSelection,
  canCopyFormat,
  canPaste,
  formatPainterArmed,
  onToggleTableEdit,
  tableEditActive,
  tableCount,
}: EditorEditToolsProps) {
  const t = useTranslations("editor.editTools");
  const tTable = useTranslations("editor.tableEdit");

  return (
    // flex-wrap: same non-negotiable rule as the main toolbar — fold onto
    // extra rows, never overflow. No overflow-x on this bar either.
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1 pointer-coarse:gap-x-2 pointer-coarse:gap-y-2 px-3 py-1.5 border-b border-border bg-background/60">
      <ToolButton
        icon={<Replace size={18} />}
        label={t("findReplace.open")}
        onClick={onFindReplace}
      />

      <Separator />

      <ToolButton
        icon={<ClipboardCopy size={18} />}
        label={t("clipboard.copy")}
        onClick={onCopy}
        disabled={!hasSelection}
      />
      <ToolButton
        icon={<Scissors size={18} />}
        label={t("clipboard.cut")}
        onClick={onCut}
        disabled={!hasSelection}
      />
      <ToolButton
        icon={<ClipboardPaste size={18} />}
        label={t("clipboard.paste")}
        onClick={onPaste}
        disabled={!canPaste}
      />

      <Separator />

      <ToolButton
        icon={<Paintbrush size={18} />}
        label={
          formatPainterArmed
            ? t("formatPainter.applyHint")
            : t("formatPainter.copy")
        }
        onClick={onCopyFormat}
        disabled={!formatPainterArmed && !canCopyFormat}
        isActive={formatPainterArmed}
      />

      {onToggleTableEdit ? (
        <>
          <Separator />
          <ToolButton
            icon={<Table size={18} />}
            label={
              tableCount && tableCount > 0
                ? tTable("toggle", { count: tableCount })
                : tTable("toggleNone")
            }
            onClick={onToggleTableEdit}
            disabled={!tableCount || tableCount === 0}
            isActive={tableEditActive}
          />
        </>
      ) : null}
    </div>
  );
}
