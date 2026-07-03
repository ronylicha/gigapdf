/**
 * formatting-toolbar.tsx
 *
 * The Word-like quick formatting cluster of the editor toolbar. Rendered only
 * when at least one *text* element is selected. Every control patches the
 * selected text element(s)' `style` through the same
 * `onElementStyleChange(elementId, Partial<TextStyle>)` flow the FontPicker and
 * the properties panel use — so edits reflect on the Fabric canvas
 * (applyLocalElementUpdate) and bake into the PDF via the operations queue
 * (queueUpdate), with no new save path.
 *
 * Toggle/active states are DERIVED from the (primary) selected element's style
 * during render: a button is "active" when the selection already carries that
 * style (e.g. bold when fontWeight === "bold"). On multi-select the edit
 * fans out to every selected text element; the displayed state follows the
 * first one.
 *
 * WORD-LIKE PARTIAL FORMATTING. When a text element is in inline-edit mode with
 * a character SUB-SELECTION, the canvas reports that range's live style via
 * `textSelectionStyle` (non-null) and exposes `applyTextSelectionStyle`. In
 * that mode every control applies to JUST the selected characters (Fabric
 * `setSelectionStyles`, persisted as `TextElement.runs`) and its active state
 * reflects the selection — falling back to the whole-element flow when there is
 * no sub-selection (caret only / not editing). Fully backward-compatible: with
 * no edit selection the behaviour is exactly the previous whole-element one.
 */

"use client";

import React, { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Baseline,
  ChevronDown,
  List,
  ListOrdered,
  IndentIncrease,
  IndentDecrease,
  Pilcrow,
  Image as ImageIcon,
  X,
} from "lucide-react";
import type { TextElement, TextListStyle, TextStyle } from "@giga-pdf/types";

/** A running-header/footer token the contextual toolbar can insert. */
export type HFToken = "page" | "pages" | "date" | "title";

/** The four insertable tokens, in toolbar order. */
const HF_TOKENS: readonly HFToken[] = ["page", "pages", "date", "title"];

/**
 * Contextual extension of the formatting toolbar, surfaced ONLY while editing a
 * Word-like running header/footer zone (SL2). It adds image-insert, the four
 * token buttons and a "close zone" control to the existing cluster — never a
 * second toolbar.
 */
export interface HeaderFooterToolbarContext {
  /** Insert an image item into the active band (opens a file picker). */
  onInsertImage: () => void;
  /** Insert a `{{token}}` into the focused text item. */
  onInsertToken: (token: HFToken) => void;
  /** Close the active header/footer zone (leave H/F edit mode). */
  onCloseZone: () => void;
  /** Token buttons are enabled only when a text item is focused. */
  canInsertToken: boolean;
}

/** Line-spacing presets surfaced by the quick menu (Word's common values). */
const LINE_SPACING_PRESETS: readonly number[] = [1, 1.15, 1.5, 2, 2.5, 3];

/** Default highlight colour applied when toggling highlight on with no value. */
const DEFAULT_HIGHLIGHT = "#ffff00";

/** Indentation step (PDF points) per click of the indent buttons. Word's 0.25in. */
const INDENT_STEP_PT = 18;

type TextAlignValue = NonNullable<TextStyle["textAlign"]>;

export interface FormattingToolbarProps {
  /**
   * The text elements currently selected. The cluster only renders when this is
   * non-empty; edits fan out to all of them, the active state follows the first.
   */
  selectedTextElements: TextElement[];
  /** Patch a text element's style — same contract as the FontPicker/panel. */
  onElementStyleChange: (
    elementId: string,
    style: Partial<TextStyle>,
  ) => void;
  /**
   * Word-like PARTIAL formatting. Live style of the character sub-selection
   * inside the text element being inline-edited, or `null` when none. When
   * non-null AND {@link applyTextSelectionStyle} is provided, controls target
   * the SELECTION and their active state reflects it.
   */
  textSelectionStyle?: Partial<TextStyle> | null;
  /**
   * Apply a style patch to the active text edit SUB-SELECTION. Returns `true`
   * when a sub-range was styled; `false` when no text is being edited with a
   * selection — the control then falls back to the whole-element flow.
   */
  applyTextSelectionStyle?: (patch: Partial<TextStyle>) => boolean;
  /**
   * When set, the toolbar is in Word-like running header/footer mode (SL2): it
   * appends the H/F context cluster (insert image, token buttons, close zone)
   * to the existing controls, and renders even when no text item is focused.
   */
  headerFooterContext?: HeaderFooterToolbarContext;
}

interface FormatButtonProps {
  icon: React.ReactNode;
  label: string;
  isActive?: boolean;
  /** When true the button is non-interactive and visually dimmed. */
  disabled?: boolean;
  onClick: () => void;
}

/** A toolbar toggle button matching the editor toolbar's ToolButton styling. */
function FormatButton({
  icon,
  label,
  isActive,
  disabled,
  onClick,
}: FormatButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-pressed={isActive ?? false}
      className={`p-2 rounded-lg transition-colors flex items-center gap-0.5 ${
        disabled
          ? "opacity-40 cursor-not-allowed text-muted-foreground"
          : isActive
            ? "bg-primary text-primary-foreground cursor-pointer"
            : "hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
      }`}
    >
      {icon}
    </button>
  );
}

function Separator() {
  return <div className="w-px h-6 bg-border mx-1" />;
}

interface ParagraphNumberRowProps {
  label: string;
  value: number;
  /** Allow negative values (a hanging first-line indent). Default false. */
  allowNegative?: boolean;
  onCommit: (value: number) => void;
}

/**
 * One labelled numeric input (PDF points) inside the paragraph spacing/indent
 * popover. Commits on change, parsing to a finite number and clamping to ≥ 0
 * unless `allowNegative` (first-line/hanging indent). A blank/invalid input
 * commits 0 so the field is always defined.
 */
function ParagraphNumberRow({
  label,
  value,
  allowNegative = false,
  onCommit,
}: ParagraphNumberRowProps) {
  return (
    <label className="flex items-center justify-between gap-2 px-2 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          step={1}
          {...(allowNegative ? {} : { min: 0 })}
          value={value}
          onChange={(e) => {
            const parsed = Number.parseFloat(e.target.value);
            const next = Number.isFinite(parsed) ? parsed : 0;
            onCommit(allowNegative ? next : Math.max(0, next));
          }}
          className="w-16 rounded border bg-background px-1.5 py-1 text-right text-foreground"
        />
        <span className="text-xs text-muted-foreground">pt</span>
      </span>
    </label>
  );
}

/**
 * The text-formatting cluster (B/I/U/S, colour, alignment, lists, spacing). Pure
 * character/paragraph controls; renders nothing when no text element is
 * selected. Split out of {@link FormattingToolbar} so the H/F context cluster
 * can be appended independently (and shown even with no text item focused).
 */
function TextFormatCluster({
  selectedTextElements,
  onElementStyleChange,
  textSelectionStyle = null,
  applyTextSelectionStyle,
}: Omit<FormattingToolbarProps, "headerFooterContext">) {
  const t = useTranslations("editor.toolbar");
  const [showSpacing, setShowSpacing] = useState(false);
  const spacingRef = useRef<HTMLDivElement>(null);
  const [showParagraph, setShowParagraph] = useState(false);
  const paragraphRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showSpacing) return;
    function handleClickOutside(event: MouseEvent) {
      if (
        spacingRef.current &&
        !spacingRef.current.contains(event.target as Node)
      ) {
        setShowSpacing(false);
      }
    }
    // pointerdown couvre souris ET tactile (fermeture au doigt).
    document.addEventListener("pointerdown", handleClickOutside);
    return () =>
      document.removeEventListener("pointerdown", handleClickOutside);
  }, [showSpacing]);

  useEffect(() => {
    if (!showParagraph) return;
    function handleClickOutside(event: MouseEvent) {
      if (
        paragraphRef.current &&
        !paragraphRef.current.contains(event.target as Node)
      ) {
        setShowParagraph(false);
      }
    }
    // pointerdown couvre souris ET tactile (fermeture au doigt).
    document.addEventListener("pointerdown", handleClickOutside);
    return () =>
      document.removeEventListener("pointerdown", handleClickOutside);
  }, [showParagraph]);

  // Source of truth for the active states = the primary (first) selection.
  const primary = selectedTextElements[0];
  if (!primary) return null;
  const style = primary.style;

  // Word-like PARTIAL mode is active when the canvas reports a live character
  // sub-selection AND the selection-style applier is wired. In that mode the
  // *character-level* fields (B/I/U/S, colour, size, font) reflect the
  // selection; paragraph-level fields (alignment, line spacing) stay element-
  // scoped (Fabric has no per-character alignment).
  const selectionMode = textSelectionStyle !== null && !!applyTextSelectionStyle;
  // For active-state of a per-character field: in selection mode read it from
  // the selection style (absent = mixed/none ⇒ inactive); otherwise from the
  // element. A consistent bold selection ⇒ Bold lit; a mixed one ⇒ Bold off.
  const charField = <K extends keyof TextStyle>(key: K): TextStyle[K] | undefined =>
    selectionMode ? textSelectionStyle?.[key] : style?.[key];

  const isBold = charField("fontWeight") === "bold";
  const isItalic = charField("fontStyle") === "italic";
  const isUnderline = charField("underline") === true;
  const isStrike = charField("strikethrough") === true;
  // Alignment / highlight / list / indent stay element-scoped (paragraph-level).
  const align: TextAlignValue = style?.textAlign ?? "left";
  const hasHighlight = !!style?.backgroundColor;
  const color = (charField("color") as string | undefined) || style?.color || "#000000";
  const highlight = style?.backgroundColor || DEFAULT_HIGHLIGHT;
  // List state of the primary selection (absent ⇒ not a list). The toolbar
  // buttons light up when the primary is that list family.
  const listType = style?.list?.type;
  const listLevel = style?.list?.level ?? 0;
  const indentLeft = style?.indentLeft ?? 0;
  // Paragraph spacing & precise indents (all PDF points; paragraph-level). The
  // quick popover edits these as numeric inputs; absent ⇒ 0.
  const indentRight = style?.indentRight ?? 0;
  const firstLine = style?.firstLine ?? 0;
  const spaceBefore = style?.spaceBefore ?? 0;
  const spaceAfter = style?.spaceAfter ?? 0;

  /**
   * Apply a CHARACTER-LEVEL style patch. In partial mode it targets the live
   * text sub-selection (persisted as `runs`); if that reports "no selection"
   * (returns false) or partial mode is off, it falls back to fanning the patch
   * out to every selected text element (whole-element, legacy behaviour).
   */
  const patchChars = (patch: Partial<TextStyle>) => {
    if (applyTextSelectionStyle && applyTextSelectionStyle(patch)) return;
    for (const el of selectedTextElements) {
      onElementStyleChange(el.elementId, patch);
    }
  };

  /**
   * Apply a PARAGRAPH/element-level style patch (alignment, line spacing,
   * highlight). Always whole-element — these have no per-character meaning.
   */
  const patchAll = (patch: Partial<TextStyle>) => {
    for (const el of selectedTextElements) {
      onElementStyleChange(el.elementId, patch);
    }
  };

  /**
   * Toggle a list FAMILY on the selection. Per-element so a heterogeneous
   * selection toggles consistently: an element already in `type` is turned OFF
   * (list removed, level reset); any other element is turned ON at `type` —
   * preserving its current nesting `level`. Whole-element (paragraph-level).
   */
  const toggleList = (type: TextListStyle["type"]) => {
    for (const el of selectedTextElements) {
      const current = el.style?.list;
      const next: TextListStyle | undefined =
        current?.type === type
          ? undefined
          : { type, level: current?.level ?? 0 };
      onElementStyleChange(el.elementId, { list: next });
    }
  };

  /**
   * Adjust the left indentation of the selection by `delta` (one step). For a
   * list element, a positive delta also DEEPENS the nesting level (and a
   * negative one shallows it) so the marker glyph follows the indent — Word-
   * like behaviour. `indentLeft` never goes negative.
   */
  const adjustIndent = (delta: number) => {
    for (const el of selectedTextElements) {
      const curIndent = el.style?.indentLeft ?? 0;
      const nextIndent = Math.max(0, curIndent + delta);
      const patch: Partial<TextStyle> = { indentLeft: nextIndent };
      const curList = el.style?.list;
      if (curList) {
        const nextLevel = Math.max(
          0,
          curList.level + (delta > 0 ? 1 : -1),
        );
        patch.list = { type: curList.type, level: nextLevel };
      }
      onElementStyleChange(el.elementId, patch);
    }
  };

  // The indent buttons are always usable (they also drive list nesting). The
  // "decrease" button is disabled only when nothing is indented AND no list is
  // nested, so it never produces a no-op.
  const canDecreaseIndent = indentLeft > 0 || listLevel > 0;

  return (
    <>
      {/* Bold / Italic / Underline / Strikethrough */}
      <FormatButton
        icon={<Bold size={20} />}
        label={t("bold")}
        isActive={isBold}
        onClick={() =>
          patchChars({ fontWeight: isBold ? "normal" : "bold" })
        }
      />
      <FormatButton
        icon={<Italic size={20} />}
        label={t("italic")}
        isActive={isItalic}
        onClick={() =>
          patchChars({ fontStyle: isItalic ? "normal" : "italic" })
        }
      />
      <FormatButton
        icon={<Underline size={20} />}
        label={t("underline")}
        isActive={isUnderline}
        onClick={() => patchChars({ underline: !isUnderline })}
      />
      <FormatButton
        icon={<Strikethrough size={20} />}
        label={t("strikethrough")}
        isActive={isStrike}
        onClick={() => patchChars({ strikethrough: !isStrike })}
      />

      <Separator />

      {/* Text colour + highlight (backgroundColor) */}
      <label
        title={t("textColor")}
        className="relative p-2 rounded-lg hover:bg-muted cursor-pointer flex items-center"
      >
        <span className="flex flex-col items-center leading-none">
          <span className="text-sm font-semibold text-foreground">A</span>
          <span
            className="block h-1 w-4 rounded-sm"
            style={{ backgroundColor: color }}
          />
        </span>
        <input
          type="color"
          value={color}
          onChange={(e) => patchChars({ color: e.target.value })}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </label>
      <div className="flex items-center">
        <label
          title={t("textHighlight")}
          className={`relative p-2 rounded-l-lg cursor-pointer flex items-center transition-colors ${
            hasHighlight
              ? "bg-primary text-primary-foreground"
              : "hover:bg-muted text-muted-foreground hover:text-foreground"
          }`}
        >
          <span className="flex flex-col items-center leading-none">
            <span className="text-sm font-semibold">H</span>
            <span
              className="block h-1 w-4 rounded-sm"
              style={{ backgroundColor: highlight }}
            />
          </span>
          <input
            type="color"
            value={highlight}
            onChange={(e) =>
              patchAll({ backgroundColor: e.target.value })
            }
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
        {hasHighlight ? (
          <button
            type="button"
            title={t("textHighlightClear")}
            onClick={() => patchAll({ backgroundColor: null })}
            className="px-1 h-9 rounded-r-lg border-l border-background/30 bg-primary text-primary-foreground hover:bg-primary/90 text-xs"
          >
            ×
          </button>
        ) : null}
      </div>

      <Separator />

      {/* Alignment — left / center / right / justify */}
      <FormatButton
        icon={<AlignLeft size={20} />}
        label={t("alignLeft")}
        isActive={align === "left"}
        onClick={() => patchAll({ textAlign: "left" })}
      />
      <FormatButton
        icon={<AlignCenter size={20} />}
        label={t("alignCenter")}
        isActive={align === "center"}
        onClick={() => patchAll({ textAlign: "center" })}
      />
      <FormatButton
        icon={<AlignRight size={20} />}
        label={t("alignRight")}
        isActive={align === "right"}
        onClick={() => patchAll({ textAlign: "right" })}
      />
      <FormatButton
        icon={<AlignJustify size={20} />}
        label={t("alignJustify")}
        isActive={align === "justify"}
        onClick={() => patchAll({ textAlign: "justify" })}
      />

      <Separator />

      {/* Lists — bullet / numbered (toggle), and paragraph indent +/- */}
      <FormatButton
        icon={<List size={20} />}
        label={t("listBullet")}
        isActive={listType === "bullet"}
        onClick={() => toggleList("bullet")}
      />
      <FormatButton
        icon={<ListOrdered size={20} />}
        label={t("listNumbered")}
        isActive={listType === "number"}
        onClick={() => toggleList("number")}
      />
      <FormatButton
        icon={<IndentDecrease size={20} />}
        label={t("indentDecrease")}
        disabled={!canDecreaseIndent}
        onClick={() => adjustIndent(-INDENT_STEP_PT)}
      />
      <FormatButton
        icon={<IndentIncrease size={20} />}
        label={t("indentIncrease")}
        onClick={() => adjustIndent(INDENT_STEP_PT)}
      />

      <Separator />

      {/* Line spacing — quick preset menu driving lineHeight */}
      <div className="relative" ref={spacingRef}>
        <button
          type="button"
          onClick={() => setShowSpacing((v) => !v)}
          title={t("lineSpacing")}
          className="p-2 rounded-lg transition-colors flex items-center gap-0.5 cursor-pointer hover:bg-muted text-muted-foreground hover:text-foreground"
        >
          <Baseline size={20} />
          <ChevronDown size={12} />
        </button>
        {showSpacing ? (
          <div className="absolute top-full left-0 mt-1 bg-background border rounded-lg shadow-lg p-1 z-50 min-w-[120px]">
            {LINE_SPACING_PRESETS.map((value) => {
              const active = (style?.lineHeight ?? 1.16) === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    patchAll({ lineHeight: value });
                    setShowSpacing(false);
                  }}
                  className={`flex w-full items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors ${
                    active
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted"
                  }`}
                >
                  {value.toFixed(2).replace(/\.00$/, "")}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      <Separator />

      {/* Paragraph spacing & precise indents — quick numeric popover (points) */}
      <div className="relative" ref={paragraphRef}>
        <button
          type="button"
          onClick={() => setShowParagraph((v) => !v)}
          title={t("paragraphSpacing")}
          className="p-2 rounded-lg transition-colors flex items-center gap-0.5 cursor-pointer hover:bg-muted text-muted-foreground hover:text-foreground"
        >
          <Pilcrow size={20} />
          <ChevronDown size={12} />
        </button>
        {showParagraph ? (
          <div className="absolute top-full left-0 mt-1 bg-background border rounded-lg shadow-lg p-1 z-50 min-w-[220px]">
            <ParagraphNumberRow
              label={t("indentRight")}
              value={indentRight}
              onCommit={(v) => patchAll({ indentRight: v })}
            />
            <ParagraphNumberRow
              label={t("firstLineIndent")}
              value={firstLine}
              allowNegative
              onCommit={(v) => patchAll({ firstLine: v })}
            />
            <ParagraphNumberRow
              label={t("spaceBefore")}
              value={spaceBefore}
              onCommit={(v) => patchAll({ spaceBefore: v })}
            />
            <ParagraphNumberRow
              label={t("spaceAfter")}
              value={spaceAfter}
              onCommit={(v) => patchAll({ spaceAfter: v })}
            />
          </div>
        ) : null}
      </div>

      <Separator />
    </>
  );
}

/**
 * The Word-like running header/footer context cluster: insert an image, insert
 * the four `{{…}}` tokens (enabled only while a text item is focused), and close
 * the active zone. Appended to the toolbar by {@link FormattingToolbar} only
 * while {@link FormattingToolbarProps.headerFooterContext} is set.
 */
function HeaderFooterContextCluster({
  context,
}: {
  context: HeaderFooterToolbarContext;
}) {
  const t = useTranslations("editor.headerFooter");
  return (
    <>
      <FormatButton
        icon={<ImageIcon size={20} />}
        label={t("insertImage")}
        onClick={context.onInsertImage}
      />
      <Separator />
      {HF_TOKENS.map((token) => (
        <button
          key={token}
          type="button"
          onClick={() => context.onInsertToken(token)}
          disabled={!context.canInsertToken}
          title={t(`token.${token}`)}
          className={`px-2 h-9 rounded-lg text-xs font-medium transition-colors ${
            context.canInsertToken
              ? "hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
              : "opacity-40 cursor-not-allowed text-muted-foreground"
          }`}
        >
          {`{{${token}}}`}
        </button>
      ))}
      <Separator />
      <FormatButton
        icon={<X size={20} />}
        label={t("closeZone")}
        onClick={context.onCloseZone}
      />
    </>
  );
}

/**
 * The editor's quick formatting cluster. Renders the text-formatting controls
 * (when a text element is selected) and, in Word-like running header/footer mode
 * ({@link FormattingToolbarProps.headerFooterContext} set), appends the H/F
 * context cluster. Renders nothing when neither applies.
 */
export function FormattingToolbar(props: FormattingToolbarProps) {
  const { headerFooterContext, ...textProps } = props;
  const hasText = textProps.selectedTextElements.length > 0;
  if (!hasText && !headerFooterContext) return null;
  return (
    <>
      {hasText ? <TextFormatCluster {...textProps} /> : null}
      {headerFooterContext ? (
        <HeaderFooterContextCluster context={headerFooterContext} />
      ) : null}
    </>
  );
}
