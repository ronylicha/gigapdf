"use client";

import React, { useState, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import type {
  Tool,
  ShapeType,
  AnnotationType,
  FieldType,
  FieldCreationKind,
  Element,
  TextStyle,
  TextElement,
  DocumentLanguageInfo,
} from "@giga-pdf/types";
import type { RulerUnit, DocumentFontOption } from "@giga-pdf/editor";
import {
  FontPicker,
  DEFAULT_FONTS,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@giga-pdf/ui";
import type { FontOption } from "@giga-pdf/ui";
import {
  MousePointer2,
  Type,
  Image,
  Square,
  PenTool,
  MessageSquare,
  Hand,
  ZoomIn,
  ZoomOut,
  Undo2,
  Redo2,
  Bold,
  Italic,
  Underline,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Circle,
  Triangle,
  Minus,
  ArrowRight,
  Highlighter,
  MessageCircle,
  StickyNote,
  Strikethrough,
  Spline,
  Stamp,
  ChevronDown,
  Trash2,
  Copy,
  ArrowUp,
  ArrowDown,
  Palette,
  Merge,
  Scissors,
  Lock,
  FileSignature,
  Signature,
  FileText,
  Layers,
  FileSearch,
  Hash,
  FileCode,
  SquareDashedMousePointer,
  Search,
  Droplet,
  ScanText,
  ScanSearch,
  FileCheck2,
  Minimize2,
  TextCursorInput,
  AlignJustify,
  CheckSquare,
  CircleDot,
  List,
  CalendarDays,
  Maximize,
  MoveHorizontal,
  Rows3,
  RectangleVertical,
  Ruler,
  PanelTop,
  Eraser,
  Check,
  X,
  Presentation,
  Grid2x2,
  Wrench,
  LayoutGrid,
  Replace,
  ClipboardCopy,
  ClipboardPaste,
  Paintbrush,
  Table,
  FilePlus2,
  type LucideIcon,
} from "lucide-react";
import { MergeDialog } from "./merge-dialog";
import { SplitDialog } from "./split-dialog";
import { EncryptDialog } from "./encrypt-dialog";
import { SignDialog } from "./sign-dialog";
import { MetadataDialog } from "./metadata-dialog";
import { PageLabelsDialog } from "./page-labels-dialog";
import { ImpositionDialog } from "./imposition-dialog";
import { ConvertDialog } from "./convert-dialog";
import { SearchDialog } from "./search-dialog";
import { WatermarkDialog } from "./watermark-dialog";
import { OcrDialog } from "./ocr-dialog";
import { PdfADialog } from "./pdfa-dialog";
import { PresentationDialog } from "./presentation-dialog";
import { CompressDialog } from "./compress-dialog";
import { HeadersFootersDialog } from "./headers-footers-dialog";
import {
  FormattingToolbar,
  type HeaderFooterToolbarContext,
} from "./formatting-toolbar";
import { InsertMenu, InsertMenuItems } from "./insert-menu";
import {
  InsertLinkDialog,
  type InsertLinkValue,
} from "./insert-link-dialog";
import { InsertSvgDialog, type InsertSvgValue } from "./insert-svg-dialog";
import { HeaderFooterPageSetup } from "./header-footer-page-setup";
import { AddPageMenu, AddPageForm } from "./add-page-menu";
import {
  MobileToolsSheet,
  type MobileToolEntry,
  type MobileToolsSection,
} from "./mobile-tools-sheet";
import { useIsMobile } from "@/hooks/use-media-query";
import type {
  PageFormat,
  PageOrientation,
  AddPagePosition,
  PageFormatPoints,
} from "./lib/page-formats";
import type { HeaderFooterKind } from "./lib/page-headers-footers";
import type { HeaderFooterSpec } from "@qrcommunication/gigapdf-lib";

export interface EditorToolbarProps {
  /** Outil actuellement sélectionné */
  activeTool: Tool;
  /** Callback pour changer d'outil */
  onToolChange: (tool: Tool) => void;
  /** Niveau de zoom actuel */
  zoom: number;
  /** Callback pour changer le zoom */
  onZoomChange: (zoom: number) => void;
  /** Peut annuler */
  canUndo: boolean;
  /** Peut refaire */
  canRedo: boolean;
  /** Callback pour annuler */
  onUndo: () => void;
  /** Callback pour refaire */
  onRedo: () => void;
  /** Éléments sélectionnés */
  hasSelection: boolean;
  /** Callback pour les actions de formatage */
  onFormatAction?: (
    action:
      | "bold"
      | "italic"
      | "underline"
      | "align-left"
      | "align-center"
      | "align-right"
  ) => void;
  /** Type de forme sélectionné */
  shapeType?: ShapeType;
  /** Callback pour changer le type de forme */
  onShapeTypeChange?: (shapeType: ShapeType) => void;
  /** Type d'annotation sélectionné */
  annotationType?: AnnotationType;
  /** Callback pour changer le type d'annotation */
  onAnnotationTypeChange?: (annotationType: AnnotationType) => void;
  /** Type de champ de formulaire sélectionné */
  fieldType?: FieldType;
  /** Callback pour changer le type de champ de formulaire */
  onFieldTypeChange?: (fieldType: FieldType) => void;
  /** Variante de création du champ (palette complète : multiligne, date, groupe radio…) */
  fieldKind?: FieldCreationKind;
  /** Callback pour changer la variante de création du champ */
  onFieldKindChange?: (fieldKind: FieldCreationKind) => void;
  /** Mode d'affichage des pages : page unique ou défilement continu. */
  viewMode?: "single" | "continuous";
  /** Callback pour basculer le mode d'affichage. */
  onViewModeChange?: (mode: "single" | "continuous") => void;
  /** Règles (horizontale + verticale) visibles. */
  showRulers?: boolean;
  /** Callback pour afficher/masquer les règles. */
  onToggleRulers?: () => void;
  /** Unité d'affichage des règles (px/mm/cm/in/pt). */
  rulerUnit?: RulerUnit;
  /** Callback pour changer l'unité des règles. */
  onRulerUnitChange?: (unit: RulerUnit) => void;
  /** Mode de zoom adaptatif actif (page / largeur / null = manuel) */
  fitMode?: "page" | "width" | null;
  /** Ajuster la page entière au viewport (Ctrl+0) */
  onFitPage?: () => void;
  /** Ajuster la largeur de page au viewport */
  onFitWidth?: () => void;
  /** Couleur de contour */
  strokeColor?: string;
  /** Callback pour changer la couleur de contour */
  onStrokeColorChange?: (color: string) => void;
  /** Couleur de remplissage */
  fillColor?: string;
  /** Callback pour changer la couleur de remplissage */
  onFillColorChange?: (color: string) => void;
  /** Épaisseur du contour */
  strokeWidth?: number;
  /** Callback pour changer l'épaisseur */
  onStrokeWidthChange?: (width: number) => void;
  /** Callback pour supprimer les éléments sélectionnés */
  onDelete?: () => void;
  /** Callback pour dupliquer les éléments sélectionnés */
  onDuplicate?: () => void;
  /** Callback z-order : remonter la sélection au premier plan (Ctrl/Cmd+]). */
  onBringToFront?: () => void;
  /** Callback z-order : renvoyer la sélection à l'arrière-plan (Ctrl/Cmd+[). */
  onSendToBack?: () => void;
  /** Callback pour ajouter une image */
  onAddImage?: () => void;
  /** Activate Adobe-style "Fill & Sign" mode (fill form fields on the page). */
  onFillSign?: () => void;
  /** Open the signature/initials capture dialog to place a stamp on the page. */
  onInsertSignature?: () => void;
  /**
   * Insert menu (Word-like) — inserts a table of editable cells + borders. Each
   * cell flows through the normal element-add + apply-elements path.
   */
  onInsertTable?: (rows: number, cols: number) => void;
  /** Insert menu — attach a hyperlink (URL or in-document page) to selected text. */
  onInsertLink?: (value: InsertLinkValue) => void;
  /** Insert menu — remove the hyperlink from the selected text element. */
  onRemoveLink?: () => void;
  /** Insert menu — embed an SVG graphic on the current page. */
  onInsertSvg?: (value: InsertSvgValue) => void;
  /** Known named destinations, offered in the link dialog's "named" mode. */
  namedDestinations?: string[];
  /** Insert menu — insert a blank page before / after the current page. */
  onInsertBlankPage?: (position: "before" | "after") => void;
  /** Insert menu — apply bullet / numbered list formatting to selected text. */
  onInsertList?: (kind: "bullet" | "numbered") => void;
  /** Total page count, for the Insert > Link in-document page target. */
  pageCount?: number;
  /** Element actuellement selectionne */
  selectedElement?: Element | null;
  /**
   * All currently selected *text* elements. Drives the Word-like formatting
   * cluster (B/I/U/S, colour, highlight, alignment, line spacing) and lets its
   * edits fan out to every selected text run. When empty/undefined the cluster
   * is hidden.
   */
  selectedTextElements?: TextElement[];
  /** Callback pour mettre a jour le style d'un element */
  onElementStyleChange?: (elementId: string, style: Partial<TextStyle>) => void;
  /**
   * Word-like PARTIAL formatting (character runs). Live style of the character
   * sub-selection inside the text element being inline-edited (or `null` when
   * none) — lets the formatting cluster reflect the right active state for a
   * sub-selection. Forwarded to {@link FormattingToolbar}.
   */
  textSelectionStyle?: Partial<TextStyle> | null;
  /**
   * Apply a style patch to the active text edit SUB-SELECTION. Returns `true`
   * when a sub-range was styled; `false` when no text is being edited with a
   * selection (the cluster then falls back to the whole-element style path).
   */
  applyTextSelectionStyle?: (patch: Partial<TextStyle>) => boolean;
  /**
   * Polices RÉELLES du document (faces embarquées chargées par `useEmbeddedFonts`).
   * Affichées en tête du FontPicker, AVANT le set système de repli. Absent /
   * vide ⇒ seules les polices système sont proposées (comportement historique).
   * Choisir une police document applique sa face réelle (`gigapdf-{docId}-{fontId}`)
   * + son nom d'origine au texte, pour un rendu 1:1 avec le PDF.
   */
  documentFonts?: DocumentFontOption[];
  /** Fichier PDF actuellement ouvert (pour les opérations merge/split/encrypt) */
  currentFile?: File | null;
  /**
   * Numéro (1-based) de la page actuellement active dans l'éditeur. Alimente le
   * scope « page courante uniquement » de l'OCR. Défaut 1 si absent.
   */
  currentPageNumber?: number;
  /**
   * Langue / écriture détectée du document — pré-remplit le sélecteur d'écriture
   * de la modale OCR (l'utilisateur peut toujours changer). Forwardé tel quel.
   */
  documentLanguage?: DocumentLanguageInfo;
  /** Callback pour afficher/masquer le panneau formulaires */
  onToggleFormsPanel?: () => void;
  /** Callback pour aplatir le PDF courant */
  onFlattenPdf?: () => void;
  onToggleMetadataDialog?: () => void;
  onToggleConvertDialog?: () => void;
  /** Whether content edit mode is active */
  isContentEditActive?: boolean;
  /** Callback to toggle content edit mode */
  onToggleContentEdit?: () => void;
  /** Callback when a search hit is clicked — caller scrolls to the target page. */
  onSearchGoToPage?: (
    pageNumber: number,
    hit: {
      pageNumber: number;
      matchIndex: number;
      bbox: [number, number, number, number];
    },
  ) => void;
  /**
   * Callback quand le filigrane est appliqué au document courant (mode
   * « Appliquer au document » du WatermarkDialog). Reçoit le PDF filigrané.
   */
  onWatermarkApplied?: (blob: Blob) => void;
  /**
   * Callback quand la compression est appliquée au document courant (mode
   * « Appliquer au document » du CompressDialog). Reçoit le PDF compressé.
   */
  onCompressApplied?: (blob: Blob) => void;
  /**
   * Callback quand l'OCR « PDF cherchable » est appliqué au document
   * courant. Reçoit le PDF avec son calque de texte invisible.
   */
  onOcrApplied?: (blob: Blob) => void;
  /**
   * Callback du bouton « Indexer OCR » : lance l'OCR de la page courante et
   * envoie les blocs au moteur de recherche sémantique (#85). Le bouton n'est
   * rendu que si ce callback est fourni.
   */
  onIndexOcr?: () => void;
  /** True pendant que l'indexation OCR est en cours (désactive le bouton). */
  indexOcrBusy?: boolean;
  /**
   * Callback quand la signature numérique est appliquée au document courant
   * (mode « Appliquer au document » du SignDialog). Reçoit le PDF signé.
   */
  onSignApplied?: (blob: Blob) => void;
  /**
   * Editor-mode callback for the PresentationDialog: receives the produced PDF
   * bytes (page transitions set/cleared per page) so the editor adopts them onto
   * the live document instead of downloading a copy.
   */
  onPresentationApplied?: (bytes: Uint8Array) => void | Promise<void>;
  /**
   * Word-style running headers & footers turned on for the document. The toggle
   * button reflects this state. Available in BOTH the continuous and the
   * single-page view (parity).
   */
  headersFootersEnabled?: boolean;
  /** Toggle Word-style running headers & footers on/off. */
  onToggleHeadersFooters?: () => void;
  /**
   * SL2 — enter/leave the Word-like editable header/footer ZONE mode. When set,
   * the toolbar toggle drives this (editable bands) instead of the legacy flat
   * dialog; the toggle's active state follows {@link headerFooterEditing}.
   */
  onToggleHeaderFooterZones?: () => void;
  /** SL2 — whether the editable header/footer zones are currently active. */
  headerFooterEditing?: boolean;
  /**
   * SL2 — contextual cluster appended to the FormattingToolbar while editing a
   * header/footer zone (insert image, `{{token}}` buttons, close zone).
   */
  headerFooterContext?: HeaderFooterToolbarContext;
  /**
   * SL2 — synthetic selection of the focused header/footer text item, so the
   * FormattingToolbar's B/I/U/colour/size/align controls style THAT item.
   */
  hfSelectedTextElements?: TextElement[];
  /** SL2 — route FormattingToolbar style edits to the focused H/F text item. */
  hfOnElementStyleChange?: (elementId: string, style: Partial<TextStyle>) => void;
  /**
   * SL3 — "different first page" flag (page 1 gets its own `firstPage` zone).
   * Drives the page-setup switch shown while editing a header/footer zone.
   */
  headerFooterDifferentFirstPage?: boolean;
  /** SL3 — "different odd & even pages" flag (own `evenPage`/`oddPage` zones). */
  headerFooterDifferentOddEven?: boolean;
  /** SL3 — toggle "different first page" (the editor seeds the `firstPage` zone). */
  onToggleHeaderFooterDifferentFirstPage?: () => void;
  /** SL3 — toggle "different odd/even" (the editor seeds the even/odd zones). */
  onToggleHeaderFooterDifferentOddEven?: () => void;
  /**
   * SL4 — add a page with a chosen format/orientation at a position (after the
   * current page / at the end). The button is rendered only when provided.
   */
  onAddPageFormat?: (
    format: PageFormat,
    orientation: PageOrientation,
    position: AddPagePosition,
    custom?: PageFormatPoints,
  ) => void;
  /**
   * Apply a header/footer band (header or footer) to the current document. The
   * editor bakes the spec onto the live PDF and persists it.
   */
  onHeaderFooterApply?: (kind: HeaderFooterKind, spec: HeaderFooterSpec) => void;
  /** Remove every header/footer band of the given kind from the document. */
  onHeaderFooterRemove?: (kind: HeaderFooterKind) => void;
  /** Pre-fill text for the header band (Word auto-detect). */
  headerFooterInitialHeader?: string;
  /** Pre-fill text for the footer band (Word auto-detect). */
  headerFooterInitialFooter?: string;
  /** Whether a header/footer apply/remove is currently running. */
  headerFooterBusy?: boolean;
  /**
   * Number of redaction zones currently drawn on the active page. Drives the
   * Apply/Clear cluster (shown only while the Redaction tool is active) and its
   * enabled state. The editor reads the zones off the canvas on apply.
   */
  redactionMarkCount?: number;
  /**
   * Apply the drawn redaction zones to the current document: the engine deletes
   * the overlapping text, overwrites image pixels, and paints an opaque black
   * box — irreversibly. The editor bakes the new binary and persists it.
   */
  onRedactApply?: () => void;
  /** Discard every redaction zone drawn on the active page without applying. */
  onRedactClear?: () => void;
  /**
   * P7 edit-tools handlers (find & replace, clipboard, format painter, table
   * edit) — the SAME wiring page.tsx gives {@link EditorEditTools}. On mobile
   * (< md) that secondary bar is hidden and these actions are served from the
   * "Édition" section of the mobile tools bottom-sheet instead. Optional so
   * hosts that don't render the edit-tools bar stay unaffected.
   */
  editTools?: {
    onFindReplace: () => void;
    onCopy: () => void;
    onCut: () => void;
    onPaste: () => void;
    onCopyFormat: () => void;
    hasSelection: boolean;
    canCopyFormat: boolean;
    canPaste: boolean;
    formatPainterArmed: boolean;
    onToggleTableEdit?: () => void;
    tableEditActive?: boolean;
    tableCount?: number;
  };
  /**
   * Auto-detect PII (emails / phones / IBANs / cards / FR SSN·SIREN) across the
   * document and open the confirmation dialog before redacting.
   */
  onRedactPiiAuto?: () => void;
  /** Whether a redaction apply is currently running. */
  redactBusy?: boolean;
}

interface ToolButtonProps {
  icon: React.ReactNode;
  label: string;
  isActive?: boolean;
  onClick: () => void;
  disabled?: boolean;
  hasDropdown?: boolean;
}

function ToolButton({
  icon,
  label,
  isActive,
  onClick,
  disabled,
  hasDropdown,
}: ToolButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={`
        p-2 rounded-lg transition-colors flex items-center justify-center gap-0.5
        pointer-coarse:min-h-11 pointer-coarse:min-w-11
        ${
          isActive
            ? "bg-primary text-primary-foreground"
            : "hover:bg-muted text-muted-foreground hover:text-foreground"
        }
        ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
      `}
    >
      {icon}
      {hasDropdown && <ChevronDown size={12} />}
    </button>
  );
}

function Separator({ className = "" }: { className?: string }) {
  return <div className={`w-px h-6 bg-border mx-1 ${className}`.trim()} />;
}

/**
 * "Add page" accordion for the mobile tools sheet: expands the SAME
 * {@link AddPageForm} the desktop AddPageMenu popover renders (no absolute
 * positioning — inline expansion, so the sheet's overflow-y never clips it).
 */
function MobileAddPageAccordion({
  label,
  onAddPage,
  onDone,
}: {
  label: string;
  onAddPage: NonNullable<EditorToolbarProps["onAddPageFormat"]>;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1 rounded-lg border">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm transition-colors hover:bg-muted"
      >
        <span className="flex items-center gap-2">
          <FilePlus2 size={16} />
          {label}
        </span>
        <ChevronDown
          size={14}
          className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? (
        <div className="border-t p-3">
          <AddPageForm onAddPage={onAddPage} onDone={onDone} />
        </div>
      ) : null}
    </div>
  );
}

interface DropdownProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

function Dropdown({ isOpen, onClose, children }: DropdownProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    }

    // pointerdown couvre souris ET tactile (mousedown seul laissait le
    // dropdown bloqué ouvert au doigt).
    document.addEventListener("pointerdown", handleClickOutside);
    return () => document.removeEventListener("pointerdown", handleClickOutside);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={ref}
      className="absolute top-full left-0 mt-1 bg-background border rounded-lg shadow-lg p-2 z-50 min-w-[120px]"
    >
      {children}
    </div>
  );
}

interface ColorPickerProps {
  color: string;
  onChange: (color: string) => void;
  label: string;
}

function ColorPicker({ color, onChange, label }: ColorPickerProps) {
  const t = useTranslations("editor.toolbar");
  const presetColors = [
    "#000000",
    "#ffffff",
    "#ff0000",
    "#00ff00",
    "#0000ff",
    "#ffff00",
    "#ff00ff",
    "#00ffff",
    "#ff8000",
    "#8000ff",
    "#0080ff",
    "#80ff00",
    "transparent",
  ];

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs text-muted-foreground">{label}</label>
      <div className="flex flex-wrap gap-1">
        {presetColors.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => onChange(preset)}
            className={`
              w-6 h-6 rounded border-2 transition-colors
              ${
                color === preset
                  ? "border-primary"
                  : "border-transparent hover:border-muted-foreground"
              }
              ${preset === "transparent" ? "bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iOCIgaGVpZ2h0PSI4IiB2aWV3Qm94PSIwIDAgOCA4IiBmaWxsPSJub25lIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSI0IiBoZWlnaHQ9IjQiIGZpbGw9IiNjY2MiLz48cmVjdCB4PSI0IiB5PSI0IiB3aWR0aD0iNCIgaGVpZ2h0PSI0IiBmaWxsPSIjY2NjIi8+PC9zdmc+')]" : ""}
            `}
            style={{
              backgroundColor: preset === "transparent" ? undefined : preset,
            }}
            title={preset === "transparent" ? t("transparent") : preset}
          />
        ))}
      </div>
      <input
        type="color"
        value={color === "transparent" ? "#ffffff" : color}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-8 rounded border cursor-pointer"
      />
    </div>
  );
}

/**
 * Barre d'outils de l'éditeur PDF avec dropdowns et color picker.
 */
// Font value mapping for FontPicker (value -> family)
const FONT_VALUE_TO_FAMILY: Record<string, string> = {
  arial: "Arial, sans-serif",
  helvetica: "Helvetica, sans-serif",
  times: "'Times New Roman', serif",
  courier: "'Courier New', monospace",
  georgia: "Georgia, serif",
  verdana: "Verdana, sans-serif",
  palatino: "Palatino, serif",
  garamond: "Garamond, serif",
  bookman: "Bookman, serif",
  "comic-sans": "'Comic Sans MS', cursive",
  trebuchet: "'Trebuchet MS', sans-serif",
  impact: "Impact, sans-serif",
  "lucida-console": "'Lucida Console', monospace",
  tahoma: "Tahoma, sans-serif",
  "century-gothic": "'Century Gothic', sans-serif",
  optima: "Optima, sans-serif",
  futura: "Futura, sans-serif",
  rockwell: "Rockwell, serif",
  baskerville: "Baskerville, serif",
  didot: "Didot, serif",
};

// Reverse mapping: family -> value
function getFontValueFromFamily(family: string): string {
  const normalizedFamily = family.toLowerCase();
  for (const [value, fontFamily] of Object.entries(FONT_VALUE_TO_FAMILY)) {
    const normalizedFontFamily = fontFamily.toLowerCase();
    const baseFontName = normalizedFontFamily.split(",")[0]?.replace(/'/g, "") ?? "";
    if (normalizedFontFamily.includes(normalizedFamily) || normalizedFamily.includes(baseFontName)) {
      return value;
    }
  }
  // Default fallback based on common font names
  if (normalizedFamily.includes("arial")) return "arial";
  if (normalizedFamily.includes("helvetica")) return "helvetica";
  if (normalizedFamily.includes("times")) return "times";
  if (normalizedFamily.includes("courier")) return "courier";
  return "arial";
}

// Available font sizes
const FONT_SIZES = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72];

/** Ruler unit cycle order (the unit button steps through these in turn). */
const RULER_UNIT_CYCLE: readonly RulerUnit[] = ["mm", "cm", "in", "pt", "px"];

/** The unit following `unit` in {@link RULER_UNIT_CYCLE} (wraps around). */
function nextRulerUnit(unit: RulerUnit): RulerUnit {
  const i = RULER_UNIT_CYCLE.indexOf(unit);
  return RULER_UNIT_CYCLE[(i + 1) % RULER_UNIT_CYCLE.length] ?? "mm";
}

export function EditorToolbar({
  activeTool,
  onToolChange,
  zoom,
  onZoomChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  hasSelection,
  onFormatAction,
  shapeType = "rectangle",
  onShapeTypeChange,
  annotationType = "highlight",
  onAnnotationTypeChange,
  fieldKind = "text",
  onFieldKindChange,
  viewMode = "continuous",
  onViewModeChange,
  showRulers = false,
  onToggleRulers,
  rulerUnit = "mm",
  onRulerUnitChange,
  fitMode = null,
  onFitPage,
  onFitWidth,
  strokeColor = "#000000",
  onStrokeColorChange,
  fillColor = "transparent",
  onFillColorChange,
  strokeWidth = 2,
  onStrokeWidthChange,
  onDelete,
  onDuplicate,
  onBringToFront,
  onSendToBack,
  onAddImage,
  onFillSign,
  onInsertSignature,
  onInsertTable,
  onInsertLink,
  onRemoveLink,
  onInsertSvg,
  namedDestinations,
  onInsertBlankPage,
  onInsertList,
  pageCount = 1,
  selectedElement,
  selectedTextElements,
  onElementStyleChange,
  textSelectionStyle,
  applyTextSelectionStyle,
  documentFonts = [],
  currentFile,
  currentPageNumber,
  documentLanguage,
  onToggleFormsPanel,
  onFlattenPdf,
  isContentEditActive,
  onToggleContentEdit,
  onSearchGoToPage,
  onWatermarkApplied,
  onCompressApplied,
  onOcrApplied,
  onIndexOcr,
  indexOcrBusy = false,
  onSignApplied,
  onPresentationApplied,
  headersFootersEnabled = false,
  onToggleHeadersFooters,
  onToggleHeaderFooterZones,
  headerFooterEditing = false,
  headerFooterContext,
  hfSelectedTextElements,
  hfOnElementStyleChange,
  headerFooterDifferentFirstPage = false,
  headerFooterDifferentOddEven = false,
  onToggleHeaderFooterDifferentFirstPage,
  onToggleHeaderFooterDifferentOddEven,
  onAddPageFormat,
  onHeaderFooterApply,
  onHeaderFooterRemove,
  headerFooterInitialHeader,
  headerFooterInitialFooter,
  headerFooterBusy = false,
  redactionMarkCount = 0,
  onRedactApply,
  onRedactClear,
  onRedactPiiAuto,
  redactBusy = false,
  editTools,
}: EditorToolbarProps) {
  const t = useTranslations("editor.toolbar");
  const tProperties = useTranslations("editor.properties.text");
  const tHeadersFooters = useTranslations("editor.headersFooters");
  const tRedact = useTranslations("editor.redact");
  const tPageLabels = useTranslations("editor.pageLabels");
  const tPresentation = useTranslations("editor.presentation");
  const tImposition = useTranslations("editor.imposition");
  const tEditTools = useTranslations("editor.editTools");
  const tTableEdit = useTranslations("editor.tableEdit");
  const tAddPage = useTranslations("editor.addPage");
  // Mobile (< md) — the toolbar collapses to ONE compact primary row and the
  // full tool catalogue moves into a bottom-sheet (Adobe-mobile pattern). The
  // hook defaults to desktop at SSR/jsdom, so the sheet is a mobile-only tree.
  const isMobile = useIsMobile();
  const [showMobileTools, setShowMobileTools] = useState(false);
  const [showShapeDropdown, setShowShapeDropdown] = useState(false);
  const [showAnnotationDropdown, setShowAnnotationDropdown] = useState(false);
  const [showFieldDropdown, setShowFieldDropdown] = useState(false);
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [showSvgDialog, setShowSvgDialog] = useState(false);
  const [showZoomDropdown, setShowZoomDropdown] = useState(false);
  const [showColorDropdown, setShowColorDropdown] = useState(false);
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [showSplitDialog, setShowSplitDialog] = useState(false);
  const [showEncryptDialog, setShowEncryptDialog] = useState(false);
  const [showSignDialog, setShowSignDialog] = useState(false);
  const [showMetadataDialog, setShowMetadataDialog] = useState(false);
  const [showPageLabelsDialog, setShowPageLabelsDialog] = useState(false);
  const [showConvertDialog, setShowConvertDialog] = useState(false);
  const [showSearchDialog, setShowSearchDialog] = useState(false);
  const [showWatermarkDialog, setShowWatermarkDialog] = useState(false);
  const [showOcrDialog, setShowOcrDialog] = useState(false);
  const [showPdfADialog, setShowPdfADialog] = useState(false);
  const [showPresentationDialog, setShowPresentationDialog] = useState(false);
  const [showImpositionDialog, setShowImpositionDialog] = useState(false);
  const [showCompressDialog, setShowCompressDialog] = useState(false);
  const [showHeadersFootersDialog, setShowHeadersFootersDialog] =
    useState(false);

  // Font controls — derived-with-override pattern (replaces the previous
  // setState-in-useEffect sync that triggered react-hooks/set-state-in-effect):
  // the displayed values DERIVE from the selected text element during render;
  // a manual pick is stored as an override KEYED BY elementId, so switching
  // the selection naturally falls back to the new element's derived values
  // (the stale override no longer matches) without any effect.
  const selectedTextElement =
    selectedElement?.type === "text" ? selectedElement : null;
  const [fontValueOverride, setFontValueOverride] = useState<{
    elementId: string;
    value: string;
  } | null>(null);
  const [fontSizeOverride, setFontSizeOverride] = useState<{
    elementId: string;
    size: number;
  } | null>(null);

  // FontPicker options = polices RÉELLES du document (faces embarquées) en tête,
  // puis le set système de repli. Une option document a pour `value` sa face
  // réelle (`gigapdf-{docId}-{fontId}`) et l'utilise aussi comme `family` pour
  // que l'aperçu du picker rende la vraie police.
  const documentFontOptions: FontOption[] = documentFonts.map((font) => ({
    value: font.faceName,
    label: font.label,
    family: font.faceName,
  }));
  const pickerFonts: FontOption[] = [...documentFontOptions, ...DEFAULT_FONTS];
  // Lookup face → option (pour écrire `originalFont` au moment du choix).
  const documentFontByFace = new Map(
    documentFonts.map((font) => [font.faceName, font] as const),
  );

  // Valeur dérivée : si le run porte un `originalFont` correspondant à une
  // police document chargée, on sélectionne sa face réelle ; sinon on retombe
  // sur le mapping famille-CSS → valeur système historique.
  const derivedFontValue = (() => {
    if (!selectedTextElement) return "arial";
    const orig = selectedTextElement.style?.originalFont;
    if (orig) {
      const docMatch = documentFonts.find((f) => f.originalName === orig);
      if (docMatch) return docMatch.faceName;
    }
    const family = selectedTextElement.style?.fontFamily;
    if (family && documentFontByFace.has(family)) return family;
    return getFontValueFromFamily(family || "Arial, sans-serif");
  })();
  const derivedFontSize = selectedTextElement?.style?.fontSize || 14;

  const selectedFontValue =
    fontValueOverride &&
    fontValueOverride.elementId === selectedTextElement?.elementId
      ? fontValueOverride.value
      : derivedFontValue;
  const selectedFontSize =
    fontSizeOverride &&
    fontSizeOverride.elementId === selectedTextElement?.elementId
      ? fontSizeOverride.size
      : derivedFontSize;

  // Définition des formes
  const shapes: { type: ShapeType; icon: React.ReactNode; labelKey: string }[] =
    [
      { type: "rectangle", icon: <Square size={16} />, labelKey: "rectangle" },
      { type: "circle", icon: <Circle size={16} />, labelKey: "circle" },
      { type: "triangle", icon: <Triangle size={16} />, labelKey: "triangle" },
      { type: "line", icon: <Minus size={16} />, labelKey: "line" },
      { type: "arrow", icon: <ArrowRight size={16} />, labelKey: "arrow" },
    ];

  // Définition des annotations
  const annotations: {
    type: AnnotationType;
    icon: React.ReactNode;
    labelKey: string;
  }[] = [
    {
      type: "highlight",
      icon: <Highlighter size={16} />,
      labelKey: "highlight",
    },
    {
      type: "underline",
      icon: <Underline size={16} />,
      labelKey: "underline",
    },
    {
      type: "strikeout",
      icon: <Strikethrough size={16} />,
      labelKey: "strikeout",
    },
    { type: "squiggly", icon: <Spline size={16} />, labelKey: "squiggly" },
    { type: "freetext", icon: <Type size={16} />, labelKey: "freetext" },
    { type: "note", icon: <StickyNote size={16} />, labelKey: "note" },
    { type: "comment", icon: <MessageCircle size={16} />, labelKey: "comment" },
    { type: "stamp", icon: <Stamp size={16} />, labelKey: "stamp" },
    { type: "line", icon: <Minus size={16} />, labelKey: "line" },
    { type: "arrow", icon: <ArrowRight size={16} />, labelKey: "arrow" },
  ];

  // Outils de base
  const basicTools: { tool: Tool; icon: React.ReactNode; labelKey: string }[] =
    [
      { tool: "select", icon: <MousePointer2 size={20} />, labelKey: "select" },
      { tool: "text", icon: <Type size={20} />, labelKey: "text" },
      { tool: "hand", icon: <Hand size={20} />, labelKey: "pan" },
    ];

  // Presets de zoom (menu déroulant) — bornes moteur : 10 % à 800 %.
  const zoomPresets = [0.5, 0.75, 1, 1.25, 1.5, 2, 4];
  const MIN_TOOLBAR_ZOOM = 0.1;
  const MAX_TOOLBAR_ZOOM = 8;

  // Palette de création des champs de formulaire (variantes riches).
  const fieldKinds: {
    kind: FieldCreationKind;
    icon: React.ReactNode;
    labelKey: string;
  }[] = [
    { kind: "text", icon: <TextCursorInput size={16} />, labelKey: "fields.text" },
    { kind: "multiline", icon: <AlignJustify size={16} />, labelKey: "fields.multiline" },
    { kind: "checkbox", icon: <CheckSquare size={16} />, labelKey: "fields.checkbox" },
    { kind: "radio_group", icon: <CircleDot size={16} />, labelKey: "fields.radioGroup" },
    { kind: "dropdown", icon: <List size={16} />, labelKey: "fields.dropdown" },
    { kind: "listbox", icon: <Rows3 size={16} />, labelKey: "fields.listBox" },
    { kind: "date", icon: <CalendarDays size={16} />, labelKey: "fields.date" },
  ];

  // Icône de forme actuelle
  const currentShapeIcon =
    shapes.find((s) => s.type === shapeType)?.icon || <Square size={20} />;
  const currentAnnotationIcon =
    annotations.find((a) => a.type === annotationType)?.icon || (
      <MessageSquare size={20} />
    );

  // "PDF tools" — SINGLE source of truth rendered on two surfaces:
  // - lg+  : the historical row of individual ToolButtons;
  // - < lg : ONE Radix "Outils" dropdown (same handlers, same icons, same
  //          labels) so the toolbar stays within 2-3 wrapped rows on mobile.
  // Pure CSS switching (hidden lg:contents / lg:hidden): no breakpoint JS, no
  // hydration risk. Every dialog stays mounted below regardless of surface.
  const pdfToolItems: {
    key: string;
    icon: LucideIcon;
    label: string;
    onSelect: () => void;
    disabled?: boolean;
    isActive?: boolean;
  }[] = [
    { key: "merge", icon: Merge, label: t("merge"), onSelect: () => setShowMergeDialog(true) },
    { key: "split", icon: Scissors, label: t("split"), onSelect: () => setShowSplitDialog(true) },
    { key: "encrypt", icon: Lock, label: t("encrypt"), onSelect: () => setShowEncryptDialog(true) },
    { key: "sign", icon: FileSignature, label: t("sign"), onSelect: () => setShowSignDialog(true) },
    { key: "forms", icon: FileText, label: t("forms"), onSelect: () => onToggleFormsPanel?.() },
    { key: "metadata", icon: FileSearch, label: t("metadata"), onSelect: () => setShowMetadataDialog(true) },
    { key: "pageLabels", icon: Hash, label: tPageLabels("toolbarLabel"), onSelect: () => setShowPageLabelsDialog(true) },
    { key: "convert", icon: FileCode, label: t("convert"), onSelect: () => setShowConvertDialog(true) },
    { key: "flatten", icon: Layers, label: t("flatten"), onSelect: () => onFlattenPdf?.() },
    { key: "compress", icon: Minimize2, label: t("compress"), onSelect: () => setShowCompressDialog(true) },
    { key: "search", icon: Search, label: "Rechercher", onSelect: () => setShowSearchDialog(true) },
    { key: "watermark", icon: Droplet, label: "Filigrane", onSelect: () => setShowWatermarkDialog(true) },
    { key: "ocr", icon: ScanText, label: "OCR", onSelect: () => setShowOcrDialog(true) },
    ...(onIndexOcr
      ? [
          {
            key: "indexOcr",
            icon: ScanSearch,
            label: t("indexOcr"),
            disabled: indexOcrBusy,
            onSelect: () => onIndexOcr(),
          },
        ]
      : []),
    { key: "pdfa", icon: FileCheck2, label: "PDF/A", onSelect: () => setShowPdfADialog(true) },
    { key: "presentation", icon: Presentation, label: tPresentation("toolbarLabel"), onSelect: () => setShowPresentationDialog(true) },
    { key: "imposition", icon: Grid2x2, label: tImposition("toolbarLabel"), onSelect: () => setShowImpositionDialog(true) },
    // Word-style running headers & footers — parity single ↔ continuous (see
    // the original comment near the render). Zone flow preferred; legacy flat
    // dialog kept when the zone flow isn't wired.
    ...(onToggleHeaderFooterZones
      ? [
          {
            key: "headersFooters",
            icon: PanelTop,
            label: tHeadersFooters("toolbarLabel"),
            isActive: headerFooterEditing,
            onSelect: onToggleHeaderFooterZones,
          },
        ]
      : onToggleHeadersFooters
        ? [
            {
              key: "headersFooters",
              icon: PanelTop,
              label: tHeadersFooters("toolbarLabel"),
              isActive: headersFootersEnabled,
              onSelect: () => {
                if (!headersFootersEnabled) {
                  onToggleHeadersFooters();
                }
                setShowHeadersFootersDialog(true);
              },
            },
          ]
        : []),
  ];

  // ---------------------------------------------------------------------
  // Mobile bottom-sheet sections (< md). Built ONLY on mobile: every entry
  // wraps the SAME handler as its desktop button/dropdown twin and then
  // dismisses the sheet (contextual pickers like colours stay open).
  // ---------------------------------------------------------------------
  const closeMobileTools = () => setShowMobileTools(false);
  /** Run a desktop handler then dismiss the sheet (select-and-close UX). */
  const sheetAction = (fn: () => void) => () => {
    fn();
    closeMobileTools();
  };

  const mobileSections: MobileToolsSection[] = !isMobile
    ? []
    : (() => {
        const editEntries: MobileToolEntry[] = [
          {
            key: "image",
            icon: <Image size={20} />,
            label: t("image"),
            isActive: activeTool === "image",
            onSelect: sheetAction(() => {
              onToolChange("image");
              onAddImage?.();
            }),
          },
          {
            key: "insertSignature",
            icon: <Signature size={20} />,
            label: t("insertSignature"),
            onSelect: sheetAction(() => onInsertSignature?.()),
          },
          ...shapes.map(({ type, icon, labelKey }) => ({
            key: `shape-${type}`,
            icon,
            label: t(labelKey),
            isActive: activeTool === "shape" && shapeType === type,
            onSelect: sheetAction(() => {
              onShapeTypeChange?.(type);
              onToolChange("shape");
            }),
          })),
          {
            key: "contentEdit",
            icon: <SquareDashedMousePointer size={20} />,
            label: t("contentEdit"),
            ...(isContentEditActive !== undefined
              ? { isActive: isContentEditActive }
              : {}),
            onSelect: sheetAction(() => onToggleContentEdit?.()),
          },
        ];

        const annotateEntries: MobileToolEntry[] = [
          ...annotations.map(({ type, icon, labelKey }) => ({
            key: `annotation-${type}`,
            icon,
            label: t(labelKey),
            isActive: activeTool === "annotation" && annotationType === type,
            onSelect: sheetAction(() => {
              onAnnotationTypeChange?.(type);
              onToolChange("annotation");
            }),
          })),
          {
            key: "draw",
            icon: <PenTool size={20} />,
            label: t("draw"),
            isActive: activeTool === "draw",
            onSelect: sheetAction(() => onToolChange("draw")),
          },
          ...(onRedactApply
            ? [
                {
                  key: "redact",
                  icon: <Eraser size={20} />,
                  label: t("redact"),
                  isActive: activeTool === "redact",
                  onSelect: sheetAction(() => onToolChange("redact")),
                },
              ]
            : []),
        ];

        const formEntries: MobileToolEntry[] = fieldKinds.map(
          ({ kind, icon, labelKey }) => ({
            key: `field-${kind}`,
            icon,
            label: t(labelKey),
            isActive: activeTool === "form_field" && fieldKind === kind,
            onSelect: sheetAction(() => {
              onFieldKindChange?.(kind);
              onToolChange("form_field");
            }),
          }),
        );

        const documentEntries: MobileToolEntry[] = pdfToolItems.map(
          ({ key, icon: Icon, label, onSelect, disabled, isActive }) => ({
            key,
            icon: <Icon size={20} />,
            label,
            ...(disabled !== undefined ? { disabled } : {}),
            ...(isActive !== undefined ? { isActive } : {}),
            onSelect: sheetAction(onSelect),
          }),
        );

        const viewEntries: MobileToolEntry[] = [
          ...(onViewModeChange
            ? [
                {
                  key: "viewSingle",
                  icon: <RectangleVertical size={20} />,
                  label: t("viewModeSingle"),
                  isActive: viewMode === "single",
                  onSelect: sheetAction(() => onViewModeChange("single")),
                },
                {
                  key: "viewContinuous",
                  icon: <Rows3 size={20} />,
                  label: t("viewModeContinuous"),
                  isActive: viewMode === "continuous",
                  onSelect: sheetAction(() => onViewModeChange("continuous")),
                },
              ]
            : []),
          ...(onToggleRulers
            ? [
                {
                  key: "rulers",
                  icon: <Ruler size={20} />,
                  label: t("rulersAndMargins"),
                  isActive: showRulers,
                  onSelect: sheetAction(() => onToggleRulers()),
                },
              ]
            : []),
          ...(showRulers && onRulerUnitChange
            ? [
                {
                  key: "rulerUnit",
                  icon: (
                    <span className="text-xs font-medium uppercase">
                      {rulerUnit}
                    </span>
                  ),
                  label: t("rulerUnit"),
                  // Cycles the unit in place — the sheet stays open on purpose.
                  onSelect: () => onRulerUnitChange(nextRulerUnit(rulerUnit)),
                },
              ]
            : []),
          ...(onFitPage
            ? [
                {
                  key: "fitPage",
                  icon: <Maximize size={20} />,
                  label: t("fitPage"),
                  isActive: fitMode === "page",
                  onSelect: sheetAction(() => onFitPage()),
                },
              ]
            : []),
          ...(onFitWidth
            ? [
                {
                  key: "fitWidth",
                  icon: <MoveHorizontal size={20} />,
                  label: t("fitWidth"),
                  isActive: fitMode === "width",
                  onSelect: sheetAction(() => onFitWidth()),
                },
              ]
            : []),
        ];

        const editingEntries: MobileToolEntry[] = editTools
          ? [
              {
                key: "findReplace",
                icon: <Replace size={20} />,
                label: tEditTools("findReplace.open"),
                onSelect: sheetAction(editTools.onFindReplace),
              },
              {
                key: "copy",
                icon: <ClipboardCopy size={20} />,
                label: tEditTools("clipboard.copy"),
                disabled: !editTools.hasSelection,
                onSelect: sheetAction(editTools.onCopy),
              },
              {
                key: "cut",
                icon: <Scissors size={20} />,
                label: tEditTools("clipboard.cut"),
                disabled: !editTools.hasSelection,
                onSelect: sheetAction(editTools.onCut),
              },
              {
                key: "paste",
                icon: <ClipboardPaste size={20} />,
                label: tEditTools("clipboard.paste"),
                disabled: !editTools.canPaste,
                onSelect: sheetAction(editTools.onPaste),
              },
              {
                key: "formatPainter",
                icon: <Paintbrush size={20} />,
                label: editTools.formatPainterArmed
                  ? tEditTools("formatPainter.applyHint")
                  : tEditTools("formatPainter.copy"),
                disabled:
                  !editTools.formatPainterArmed && !editTools.canCopyFormat,
                isActive: editTools.formatPainterArmed,
                onSelect: sheetAction(editTools.onCopyFormat),
              },
              ...(editTools.onToggleTableEdit
                ? [
                    {
                      key: "tableEdit",
                      icon: <Table size={20} />,
                      label:
                        editTools.tableCount && editTools.tableCount > 0
                          ? tTableEdit("toggle", {
                              count: editTools.tableCount,
                            })
                          : tTableEdit("toggleNone"),
                      disabled:
                        !editTools.tableCount || editTools.tableCount === 0,
                      ...(editTools.tableEditActive !== undefined
                        ? { isActive: editTools.tableEditActive }
                        : {}),
                      onSelect: sheetAction(() =>
                        editTools.onToggleTableEdit?.(),
                      ),
                    },
                  ]
                : []),
            ]
          : [];

        return [
          { key: "edit", title: t("mobileTools.sections.edit"), entries: editEntries },
          {
            key: "colors",
            title: t("mobileTools.sections.colors"),
            content: (
              <div className="flex flex-col gap-4 px-1 pt-1">
                <ColorPicker
                  color={strokeColor}
                  onChange={(color) => onStrokeColorChange?.(color)}
                  label={t("strokeColor")}
                />
                <ColorPicker
                  color={fillColor}
                  onChange={(color) => onFillColorChange?.(color)}
                  label={t("fillColor")}
                />
                <div className="flex flex-col gap-2">
                  <label className="text-xs text-muted-foreground">
                    {t("strokeWidth")}
                  </label>
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={strokeWidth}
                    onChange={(e) =>
                      onStrokeWidthChange?.(parseInt(e.target.value, 10))
                    }
                    className="w-full"
                  />
                  <span className="text-xs text-center">{strokeWidth}px</span>
                </div>
              </div>
            ),
          },
          {
            key: "insert",
            title: t("mobileTools.sections.insert"),
            content: (
              <div className="flex flex-col gap-1">
                <InsertMenuItems
                  onInsertImage={() => onAddImage?.()}
                  onInsertSvg={() => setShowSvgDialog(true)}
                  onInsertTable={(rows, cols) => onInsertTable?.(rows, cols)}
                  onInsertShape={(shape) => {
                    onShapeTypeChange?.(shape);
                    onToolChange("shape");
                  }}
                  onInsertLink={() => setShowLinkDialog(true)}
                  onInsertBlankPage={(position) =>
                    onInsertBlankPage?.(position)
                  }
                  onInsertList={(kind) => onInsertList?.(kind)}
                  hasTextSelection={(selectedTextElements?.length ?? 0) === 1}
                  onAction={closeMobileTools}
                />
                {onAddPageFormat ? (
                  <MobileAddPageAccordion
                    label={tAddPage("toolbarLabel")}
                    onAddPage={onAddPageFormat}
                    onDone={closeMobileTools}
                  />
                ) : null}
              </div>
            ),
          },
          {
            key: "annotate",
            title: t("mobileTools.sections.annotate"),
            entries: annotateEntries,
          },
          {
            key: "forms",
            title: t("mobileTools.sections.forms"),
            entries: formEntries,
          },
          {
            key: "document",
            title: t("mobileTools.sections.document"),
            entries: documentEntries,
          },
          { key: "view", title: t("mobileTools.sections.view"), entries: viewEntries },
          ...(editingEntries.length > 0
            ? [
                {
                  key: "editing",
                  title: t("mobileTools.sections.editing"),
                  entries: editingEntries,
                },
              ]
            : []),
        ];
      })();

  return (
    // flex-wrap (NON-NEGOTIABLE): the toolbar folds onto extra rows instead of
    // overflowing off-screen. NEVER add overflow-x-auto/overflow-hidden here —
    // the home-made dropdowns are absolutely positioned and would be clipped.
    // Below md the bar collapses to ONE compact primary row (select/hand/text,
    // Fill & Sign, undo/redo + the "Tools" bottom-sheet opener): tighter
    // paddings/gaps keep seven 44px targets within 360px; every secondary
    // group is `hidden md:*` and lives in the bottom-sheet instead. Contextual
    // clusters (text formatting, selection actions, redact apply) stay
    // rendered at every size and may wrap temporarily — that is intended.
    <div className="editor-toolbar flex flex-wrap items-center gap-x-1 gap-y-1 md:pointer-coarse:gap-x-2 md:pointer-coarse:gap-y-2 px-1 py-0.5 md:p-2 bg-background border-b">
      {/* Undo/Redo */}
      <ToolButton
        icon={<Undo2 size={20} />}
        label={t("undo")}
        onClick={onUndo}
        disabled={!canUndo}
      />
      <ToolButton
        icon={<Redo2 size={20} />}
        label={t("redo")}
        onClick={onRedo}
        disabled={!canRedo}
      />

      <Separator className="hidden md:block" />

      {/* Outils de base */}
      {basicTools.map(({ tool, icon, labelKey }) => (
        <ToolButton
          key={tool}
          icon={icon}
          label={t(labelKey)}
          isActive={activeTool === tool}
          onClick={() => onToolChange(tool)}
        />
      ))}

      {/* Outil Image avec upload — replié dans le bottom-sheet sous md. */}
      <span className="hidden md:contents">
        <ToolButton
          icon={<Image size={20} />}
          label={t("image")}
          isActive={activeTool === "image"}
          onClick={() => {
            onToolChange("image");
            onAddImage?.();
          }}
        />
      </span>

      <Separator className="hidden md:block" />

      {/* Remplir & Signer (mode Adobe : remplissage des champs + signature) */}
      <ToolButton
        icon={<FileSignature size={20} />}
        label={t("fillSign")}
        isActive={activeTool === "fill_sign"}
        onClick={() => {
          onToolChange("fill_sign");
          onFillSign?.();
        }}
      />
      {/* Insertion de signature — repliée dans le bottom-sheet sous md. */}
      <span className="hidden md:contents">
        <ToolButton
          icon={<Signature size={20} />}
          label={t("insertSignature")}
          onClick={() => onInsertSignature?.()}
        />
      </span>

      <Separator className="hidden md:block" />

      {/* Formes avec dropdown — replié dans le bottom-sheet sous md. */}
      <div className="relative hidden md:block">
        <ToolButton
          icon={currentShapeIcon}
          label={t("shape")}
          isActive={activeTool === "shape"}
          hasDropdown
          onClick={() => {
            onToolChange("shape");
            setShowShapeDropdown(!showShapeDropdown);
          }}
        />
        <Dropdown
          isOpen={showShapeDropdown}
          onClose={() => setShowShapeDropdown(false)}
        >
          <div className="flex flex-col gap-1">
            {shapes.map(({ type, icon, labelKey }) => (
              <button
                key={type}
                type="button"
                onClick={() => {
                  onShapeTypeChange?.(type);
                  setShowShapeDropdown(false);
                }}
                className={`
                  flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors
                  ${
                    shapeType === type
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted"
                  }
                `}
              >
                {icon}
                <span>{t(labelKey)}</span>
              </button>
            ))}
          </div>
        </Dropdown>
      </div>

      {/* Annotations avec dropdown — replié dans le bottom-sheet sous md. */}
      <div className="relative hidden md:block">
        <ToolButton
          icon={currentAnnotationIcon}
          label={t("annotation")}
          isActive={activeTool === "annotation"}
          hasDropdown
          onClick={() => {
            onToolChange("annotation");
            setShowAnnotationDropdown(!showAnnotationDropdown);
          }}
        />
        <Dropdown
          isOpen={showAnnotationDropdown}
          onClose={() => setShowAnnotationDropdown(false)}
        >
          <div className="flex flex-col gap-1">
            {annotations.map(({ type, icon, labelKey }) => (
              <button
                key={type}
                type="button"
                onClick={() => {
                  onAnnotationTypeChange?.(type);
                  setShowAnnotationDropdown(false);
                }}
                className={`
                  flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors
                  ${
                    annotationType === type
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted"
                  }
                `}
              >
                {icon}
                <span>{t(labelKey)}</span>
              </button>
            ))}
            {/* Replis <md : les boutons individuels draw/redact sont masqués
                sous md (voir plus bas) — les MÊMES outils restent accessibles
                via ces entrées (jamais de fonctionnalité retirée). */}
            <button
              type="button"
              data-testid="annotation-dropdown-draw"
              onClick={() => {
                onToolChange("draw");
                setShowAnnotationDropdown(false);
              }}
              className={`
                md:hidden flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors
                ${
                  activeTool === "draw"
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                }
              `}
            >
              <PenTool size={16} />
              <span>{t("draw")}</span>
            </button>
            {onRedactApply ? (
              <button
                type="button"
                data-testid="annotation-dropdown-redact"
                onClick={() => {
                  onToolChange("redact");
                  setShowAnnotationDropdown(false);
                }}
                className={`
                  md:hidden flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors
                  ${
                    activeTool === "redact"
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted"
                  }
                `}
              >
                <Eraser size={16} />
                <span>{t("redact")}</span>
              </button>
            ) : null}
          </div>
        </Dropdown>
      </div>

      {/* Outil crayon (draw tool) — tracé main-levée baké en annotation /Ink.
          Réutilise le sélecteur couleur/épaisseur global (strokeColor/strokeWidth).
          Sous md le bouton individuel disparaît : l'outil reste accessible via
          les entrées md:hidden du dropdown annotations (aucune perte de
          fonctionnalité, juste moins de lignes wrap à 360px). */}
      <span className="hidden md:contents">
        <ToolButton
          icon={<PenTool size={20} />}
          label={t("draw")}
          isActive={activeTool === "draw"}
          onClick={() => onToolChange("draw")}
        />
      </span>

      {/* Outil rédaction (PII) — dessine des zones noires irréversibles.
          Le bouton n'est rendu que si le handler d'application est fourni.
          Même repli md: que draw (entrée dans le dropdown annotations) ; le
          cluster Appliquer/Effacer reste rendu à toutes les tailles dès que
          l'outil rédaction est actif. */}
      {onRedactApply && (
        <>
          <span className="hidden md:contents">
            <ToolButton
              icon={<Eraser size={20} />}
              label={t("redact")}
              isActive={activeTool === "redact"}
              onClick={() => onToolChange("redact")}
            />
          </span>
          {/* Cluster Appliquer / Effacer — visible uniquement en mode rédaction. */}
          {activeTool === "redact" && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onRedactApply}
                disabled={redactBusy || redactionMarkCount === 0}
                title={tRedact("applyHint")}
                className={`
                  px-2 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5
                  transition-colors
                  ${
                    redactBusy || redactionMarkCount === 0
                      ? "opacity-50 cursor-not-allowed bg-muted text-muted-foreground"
                      : "bg-red-600 text-white hover:bg-red-700 cursor-pointer"
                  }
                `}
              >
                <Check size={14} />
                <span>
                  {redactBusy
                    ? tRedact("applying")
                    : redactionMarkCount > 0
                      ? tRedact("applyCount", { count: redactionMarkCount })
                      : tRedact("apply")}
                </span>
              </button>
              <button
                type="button"
                onClick={onRedactClear}
                disabled={redactBusy || redactionMarkCount === 0}
                title={tRedact("clear")}
                className={`
                  p-2 rounded-lg transition-colors
                  ${
                    redactBusy || redactionMarkCount === 0
                      ? "opacity-50 cursor-not-allowed text-muted-foreground"
                      : "hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
                  }
                `}
              >
                <X size={16} />
              </button>
              {/* Détection automatique des PII (emails, téléphones, IBAN…). */}
              {onRedactPiiAuto && (
                <button
                  type="button"
                  onClick={onRedactPiiAuto}
                  disabled={redactBusy}
                  title={tRedact("autoHint")}
                  className={`
                    px-2 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5
                    transition-colors
                    ${
                      redactBusy
                        ? "opacity-50 cursor-not-allowed bg-muted text-muted-foreground"
                        : "border border-input hover:bg-muted cursor-pointer"
                    }
                  `}
                >
                  <ScanSearch size={14} />
                  <span>{tRedact("autoDetect")}</span>
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* Champ de formulaire avec dropdown (text/checkbox/radio/dropdown) —
          replié dans le bottom-sheet sous md (section Formulaires). */}
      <div className="relative hidden md:block">
        <ToolButton
          icon={<FileText size={20} />}
          label={t("formField") || "Champ"}
          isActive={activeTool === "form_field"}
          hasDropdown
          onClick={() => {
            onToolChange("form_field");
            setShowFieldDropdown(!showFieldDropdown);
          }}
        />
        <Dropdown
          isOpen={showFieldDropdown}
          onClose={() => setShowFieldDropdown(false)}
        >
          <div className="flex flex-col gap-1 min-w-[180px]">
            {fieldKinds.map(({ kind, icon, labelKey }) => (
              <button
                key={kind}
                type="button"
                onClick={() => {
                  onFieldKindChange?.(kind);
                  onToolChange("form_field");
                  setShowFieldDropdown(false);
                }}
                className={`
                  flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors
                  ${
                    fieldKind === kind
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted"
                  }
                `}
              >
                {icon}
                <span>{t(labelKey)}</span>
              </button>
            ))}
          </div>
        </Dropdown>
      </div>

      {/* Insert menu (Word-like): image, table, shapes, link, page, list —
          replié dans le bottom-sheet sous md (section Insérer, mêmes items). */}
      <span className="hidden md:contents">
        <InsertMenu
          onInsertImage={() => onAddImage?.()}
          onInsertSvg={() => setShowSvgDialog(true)}
          onInsertTable={(rows, cols) => onInsertTable?.(rows, cols)}
          onInsertShape={(shape) => {
            onShapeTypeChange?.(shape);
            onToolChange("shape");
          }}
          onInsertLink={() => setShowLinkDialog(true)}
          onInsertBlankPage={(position) => onInsertBlankPage?.(position)}
          onInsertList={(kind) => onInsertList?.(kind)}
          hasTextSelection={(selectedTextElements?.length ?? 0) === 1}
        />

        {/* SL4 — Word-like "Add page" picker (format × orientation × position). */}
        {onAddPageFormat ? <AddPageMenu onAddPage={onAddPageFormat} /> : null}
      </span>

      <Separator className="hidden md:block" />

      {/* Color Picker — replié dans le bottom-sheet sous md (section Couleurs). */}
      <div className="relative hidden md:block">
        <ToolButton
          icon={
            <div className="relative">
              <Palette size={20} />
              <div
                className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-white"
                style={{ backgroundColor: strokeColor }}
              />
            </div>
          }
          label={t("colors")}
          hasDropdown
          onClick={() => setShowColorDropdown(!showColorDropdown)}
        />
        <Dropdown
          isOpen={showColorDropdown}
          onClose={() => setShowColorDropdown(false)}
        >
          <div className="flex flex-col gap-4 p-2 min-w-[200px]">
            <ColorPicker
              color={strokeColor}
              onChange={(color) => onStrokeColorChange?.(color)}
              label={t("strokeColor")}
            />
            <ColorPicker
              color={fillColor}
              onChange={(color) => onFillColorChange?.(color)}
              label={t("fillColor")}
            />
            <div className="flex flex-col gap-2">
              <label className="text-xs text-muted-foreground">
                {t("strokeWidth")}
              </label>
              <input
                type="range"
                min="1"
                max="10"
                value={strokeWidth}
                onChange={(e) =>
                  onStrokeWidthChange?.(parseInt(e.target.value, 10))
                }
                className="w-full"
              />
              <span className="text-xs text-center">{strokeWidth}px</span>
            </div>
          </div>
        </Dropdown>
      </div>

      <Separator className="hidden md:block" />

      {/* Font controls (visible only for text elements) */}
      {selectedElement?.type === "text" && onElementStyleChange && (
        <>
          <div className="flex items-center gap-2">
            <FontPicker
              value={selectedFontValue}
              fonts={pickerFonts}
              onChange={(font) => {
                setFontValueOverride({
                  elementId: selectedElement.elementId,
                  value: font.value,
                });
                // Police document → écrire la face réelle + son nom d'origine
                // (clé de résolution variant-aware du renderer). Police système
                // → famille CSS + effacer `originalFont` (sinon le renderer
                // résoudrait encore la police embarquée précédente).
                const docFont = documentFontByFace.get(font.value);
                const patch = docFont
                  ? { fontFamily: docFont.faceName, originalFont: docFont.originalName }
                  : { fontFamily: font.family, originalFont: null };
                // Word-like partial formatting: apply the font to the live text
                // sub-selection first (persisted as a per-character run); fall
                // back to the whole element when there is no sub-selection.
                if (applyTextSelectionStyle && applyTextSelectionStyle(patch)) {
                  return;
                }
                onElementStyleChange(selectedElement.elementId, patch);
              }}
              className="h-8 w-[130px] md:w-[160px]"
              placeholder={tProperties("fontFamily")}
            />
            <select
              value={selectedFontSize}
              onChange={(e) => {
                const size = parseInt(e.target.value, 10);
                setFontSizeOverride({
                  elementId: selectedElement.elementId,
                  size,
                });
                // Word-like partial formatting: size the live sub-selection
                // first (per-character run); fall back to the whole element.
                if (
                  applyTextSelectionStyle &&
                  applyTextSelectionStyle({ fontSize: size })
                ) {
                  return;
                }
                onElementStyleChange(selectedElement.elementId, {
                  fontSize: size,
                });
              }}
              className="h-8 w-16 px-2 rounded border bg-background text-sm"
              title={tProperties("fontSize")}
            >
              {FONT_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>
          <Separator />
        </>
      )}

      {/* SL2 — Word-like running header/footer mode: the contextual cluster
          (insert image, {{tokens}}, close zone) is always shown while editing a
          zone; the B/I/U/colour/size controls style the FOCUSED H/F text item
          (synthetic selection) and fall back to no-op when none is focused. */}
      {headerFooterContext ? (
        <>
          <FormattingToolbar
            selectedTextElements={hfSelectedTextElements ?? []}
            onElementStyleChange={hfOnElementStyleChange ?? (() => {})}
            textSelectionStyle={null}
            headerFooterContext={headerFooterContext}
          />
          {/* SL3 — Word-like page-setup switches: first page / odd-even
              different. Toggling seeds the matching override zone editor-side. */}
          {onToggleHeaderFooterDifferentFirstPage &&
          onToggleHeaderFooterDifferentOddEven ? (
            <HeaderFooterPageSetup
              differentFirstPage={headerFooterDifferentFirstPage}
              differentOddEven={headerFooterDifferentOddEven}
              onToggleDifferentFirstPage={
                onToggleHeaderFooterDifferentFirstPage
              }
              onToggleDifferentOddEven={onToggleHeaderFooterDifferentOddEven}
            />
          ) : null}
        </>
      ) : /* Word-like formatting cluster (B/I/U/S, colour, highlight, alignment,
          line spacing). Reflects the selection's current style and drives the
          rich TextStyle fields through onElementStyleChange. Only for text. */
      onElementStyleChange &&
        selectedTextElements &&
        selectedTextElements.length > 0 ? (
        <FormattingToolbar
          selectedTextElements={selectedTextElements}
          onElementStyleChange={onElementStyleChange}
          textSelectionStyle={textSelectionStyle ?? null}
          {...(applyTextSelectionStyle ? { applyTextSelectionStyle } : {})}
        />
      ) : (
        /* Fallback: legacy canvas-only quick format (no active state) used when
           the rich style flow isn't wired. */
        hasSelection &&
        onFormatAction && (
          <>
            <ToolButton
              icon={<Bold size={20} />}
              label={t("bold")}
              onClick={() => onFormatAction("bold")}
            />
            <ToolButton
              icon={<Italic size={20} />}
              label={t("italic")}
              onClick={() => onFormatAction("italic")}
            />
            <ToolButton
              icon={<Underline size={20} />}
              label={t("underline")}
              onClick={() => onFormatAction("underline")}
            />
            <Separator />
            <ToolButton
              icon={<AlignLeft size={20} />}
              label={t("alignLeft")}
              onClick={() => onFormatAction("align-left")}
            />
            <ToolButton
              icon={<AlignCenter size={20} />}
              label={t("alignCenter")}
              onClick={() => onFormatAction("align-center")}
            />
            <ToolButton
              icon={<AlignRight size={20} />}
              label={t("alignRight")}
              onClick={() => onFormatAction("align-right")}
            />
            <Separator />
          </>
        )
      )}

      {/* Actions sur sélection */}
      {hasSelection && (
        <>
          <ToolButton
            icon={<Copy size={20} />}
            label={t("duplicate")}
            onClick={() => onDuplicate?.()}
          />
          <ToolButton
            icon={<ArrowUp size={20} />}
            label={t("bringToFront")}
            onClick={() => onBringToFront?.()}
          />
          <ToolButton
            icon={<ArrowDown size={20} />}
            label={t("sendToBack")}
            onClick={() => onSendToBack?.()}
          />
          <ToolButton
            icon={<Trash2 size={20} />}
            label={t("delete")}
            onClick={() => onDelete?.()}
          />
          <Separator />
        </>
      )}

      {/* View mode — défilement continu (toutes les pages) vs page unique.
          Anchored to the right cluster (ml-auto) just before the zoom group.
          Replié dans le bottom-sheet sous md (section Affichage). */}
      {onViewModeChange && (
        <>
          <div className="ml-auto hidden items-center gap-1 md:flex">
            <ToolButton
              icon={<RectangleVertical size={20} />}
              label={t("viewModeSingle")}
              isActive={viewMode === "single"}
              onClick={() => onViewModeChange("single")}
            />
            <ToolButton
              icon={<Rows3 size={20} />}
              label={t("viewModeContinuous")}
              isActive={viewMode === "continuous"}
              onClick={() => onViewModeChange("continuous")}
            />
          </div>
          <Separator className="hidden md:block" />
        </>
      )}

      {/* Rulers & margins — single Word-style "View → Ruler" toggle that shows
          BOTH the horizontal/vertical rulers AND the draggable margin guides
          together; when on, a button cycles the ruler display unit. Right-aligns
          on its own only when the view toggle (which already grabbed `ml-auto`)
          is absent. */}
      {onToggleRulers && (
        <>
          <div
            className={`hidden items-center gap-1 md:flex ${onViewModeChange ? "" : "ml-auto"}`}
          >
            <ToolButton
              icon={<Ruler size={20} />}
              label={t("rulersAndMargins")}
              isActive={showRulers}
              onClick={() => onToggleRulers()}
            />
            {showRulers && onRulerUnitChange ? (
              <ToolButton
                icon={
                  <span className="text-xs font-medium uppercase">
                    {rulerUnit}
                  </span>
                }
                label={t("rulerUnit")}
                onClick={() => onRulerUnitChange(nextRulerUnit(rulerUnit))}
              />
            ) : null}
          </div>
          <Separator className="hidden md:block" />
        </>
      )}

      {/* Zoom — boutons ± à pas multiplicatif + menu presets/ajustements.
          Le bouton central affiche TOUJOURS la valeur courante (y compris
          un zoom arbitraire issu de la molette ou d'un mode fit). `ml-auto`
          ancre le cluster à droite quand le toggle de vue est absent ; quand
          il est présent, le toggle (ml-auto, en premier) gagne l'espace et le
          zoom se cale juste après lui. Sous md le cluster disparaît : le pill
          flottant MobileZoomControls (±, %, cycle fit) prend le relais et les
          ajustements fit page/largeur restent dans le bottom-sheet. */}
      <div className="hidden items-center gap-1 ml-auto md:flex">
        <ToolButton
          icon={<ZoomOut size={20} />}
          label={t("zoomOut")}
          onClick={() =>
            onZoomChange(Math.max(MIN_TOOLBAR_ZOOM, zoom / 1.25))
          }
          disabled={zoom <= MIN_TOOLBAR_ZOOM + 0.001}
        />

        <div className="relative">
          <button
            type="button"
            onClick={() => setShowZoomDropdown(!showZoomDropdown)}
            title={t("zoomLevel")}
            className="h-8 min-w-[72px] px-2 rounded border bg-background text-sm flex items-center justify-center gap-1 hover:bg-muted transition-colors"
          >
            <span>{Math.round(zoom * 100)}%</span>
            <ChevronDown size={12} />
          </button>
          <Dropdown
            isOpen={showZoomDropdown}
            onClose={() => setShowZoomDropdown(false)}
          >
            <div className="flex flex-col gap-1 min-w-[176px]">
              <button
                type="button"
                onClick={() => {
                  onFitPage?.();
                  setShowZoomDropdown(false);
                }}
                className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors ${
                  fitMode === "page"
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                }`}
              >
                <Maximize size={16} />
                <span>{t("fitPage")}</span>
                <span className="ml-auto text-[10px] text-muted-foreground">
                  Ctrl+0
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onFitWidth?.();
                  setShowZoomDropdown(false);
                }}
                className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors ${
                  fitMode === "width"
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                }`}
              >
                <MoveHorizontal size={16} />
                <span>{t("fitWidth")}</span>
              </button>
              <div className="h-px bg-border my-1" />
              {zoomPresets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    onZoomChange(preset);
                    setShowZoomDropdown(false);
                  }}
                  className={`px-2 py-1.5 rounded text-sm text-left transition-colors ${
                    fitMode === null && Math.abs(zoom - preset) < 0.001
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted"
                  }`}
                >
                  {Math.round(preset * 100)}%
                </button>
              ))}
            </div>
          </Dropdown>
        </div>

        <ToolButton
          icon={<ZoomIn size={20} />}
          label={t("zoomIn")}
          onClick={() =>
            onZoomChange(Math.min(MAX_TOOLBAR_ZOOM, zoom * 1.25))
          }
          disabled={zoom >= MAX_TOOLBAR_ZOOM - 0.001}
        />
      </div>

      {/* Content Edit Mode — replié dans le bottom-sheet sous md. */}
      <span className="hidden md:contents">
        <ToolButton
          icon={<SquareDashedMousePointer size={20} />}
          label={t("contentEdit")}
          isActive={isContentEditActive}
          onClick={() => onToggleContentEdit?.()}
        />
      </span>

      {/* PDF Tools — lg+ surface: the historical row of individual buttons.
          `lg:contents` keeps each button an independent flex item so the
          toolbar's flex-wrap can break BETWEEN tools (a plain wrapper div
          would wrap as one unbreakable ~800px chunk). */}
      <div className="hidden lg:contents">
        <Separator />
        {pdfToolItems.map(({ key, icon: Icon, label, onSelect, disabled, isActive }) => (
          <ToolButton
            key={key}
            icon={<Icon size={20} />}
            label={label}
            onClick={onSelect}
            {...(disabled !== undefined ? { disabled } : {})}
            {...(isActive !== undefined ? { isActive } : {})}
          />
        ))}
      </div>

      {/* PDF Tools — md..lg surface: ONE collapsed "Outils" menu (same
          handlers, icons and labels as the buttons above — no functionality
          removed). Below md the tools live in the bottom-sheet instead. */}
      <div className="hidden items-center md:flex lg:hidden">
        <Separator />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title={t("tools")}
              className="p-2 rounded-lg transition-colors flex items-center justify-center gap-1 pointer-coarse:min-h-11 pointer-coarse:min-w-11 hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <Wrench size={20} />
              {/* Le label textuel disparaît sous sm (le title/aria reste). */}
              <span className="hidden text-sm sm:inline">{t("tools")}</span>
              <ChevronDown size={12} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60 max-h-[70vh] overflow-y-auto">
            {pdfToolItems.map(({ key, icon: Icon, label, onSelect, disabled }) => (
              <DropdownMenuItem
                key={key}
                onClick={onSelect}
                {...(disabled !== undefined ? { disabled } : {})}
              >
                <Icon className="mr-2 h-4 w-4" />
                <span>{label}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Mobile (< md) — the "Tools" bottom-sheet opener, anchored right.
          44px target; the sheet below carries every collapsed group. */}
      <div className="ml-auto flex items-center md:hidden">
        <button
          type="button"
          data-testid="mobile-tools-open"
          title={t("tools")}
          aria-label={t("tools")}
          aria-haspopup="dialog"
          aria-expanded={showMobileTools}
          onClick={() => setShowMobileTools(true)}
          className={`p-2 rounded-lg transition-colors flex items-center justify-center pointer-coarse:min-h-11 pointer-coarse:min-w-11 cursor-pointer ${
            showMobileTools
              ? "bg-primary text-primary-foreground"
              : "hover:bg-muted text-muted-foreground hover:text-foreground"
          }`}
        >
          <LayoutGrid size={20} />
        </button>
      </div>

      {/* Mobile tools bottom-sheet — mounted only below md (the hook defaults
          to desktop at SSR/jsdom, so this whole tree is mobile-only). */}
      {isMobile ? (
        <MobileToolsSheet
          open={showMobileTools}
          onOpenChange={setShowMobileTools}
          title={t("mobileTools.title")}
          sections={mobileSections}
        />
      ) : null}

      {/* PDF operation dialogs */}
      <MergeDialog
        open={showMergeDialog}
        onClose={() => setShowMergeDialog(false)}
      />
      <SplitDialog
        open={showSplitDialog}
        onClose={() => setShowSplitDialog(false)}
        currentFile={currentFile}
      />
      <EncryptDialog
        open={showEncryptDialog}
        onClose={() => setShowEncryptDialog(false)}
        currentFile={currentFile}
      />
      <SignDialog
        open={showSignDialog}
        onClose={() => setShowSignDialog(false)}
        currentFile={currentFile ?? null}
        baseFilename={currentFile?.name}
        onApplied={onSignApplied}
      />
      <MetadataDialog
        isOpen={showMetadataDialog}
        onClose={() => setShowMetadataDialog(false)}
        currentFile={currentFile ?? null}
      />
      <PageLabelsDialog
        isOpen={showPageLabelsDialog}
        onClose={() => setShowPageLabelsDialog(false)}
        currentFile={currentFile ?? null}
      />
      <ConvertDialog
        isOpen={showConvertDialog}
        onClose={() => setShowConvertDialog(false)}
      />
      <SearchDialog
        open={showSearchDialog}
        onClose={() => setShowSearchDialog(false)}
        currentFile={currentFile ?? null}
        onGoToPage={(pageNumber, hit) => {
          onSearchGoToPage?.(pageNumber, hit);
        }}
      />
      <WatermarkDialog
        open={showWatermarkDialog}
        onClose={() => setShowWatermarkDialog(false)}
        currentFile={currentFile ?? null}
        baseFilename={currentFile?.name}
        onApplied={onWatermarkApplied}
      />
      <OcrDialog
        open={showOcrDialog}
        onClose={() => setShowOcrDialog(false)}
        currentFile={currentFile ?? null}
        baseFilename={currentFile?.name}
        currentPageNumber={currentPageNumber}
        documentLanguage={documentLanguage}
        onApplied={onOcrApplied}
      />
      <PdfADialog
        open={showPdfADialog}
        onClose={() => setShowPdfADialog(false)}
        currentFile={currentFile ?? null}
        baseFilename={currentFile?.name}
        documentLanguage={documentLanguage}
      />
      <PresentationDialog
        open={showPresentationDialog}
        onClose={() => setShowPresentationDialog(false)}
        currentFile={currentFile ?? null}
        baseFilename={currentFile?.name}
        currentPageNumber={currentPageNumber}
        onApply={onPresentationApplied}
      />
      <ImpositionDialog
        open={showImpositionDialog}
        onClose={() => setShowImpositionDialog(false)}
        currentFile={currentFile ?? null}
        baseFilename={currentFile?.name}
      />
      <CompressDialog
        open={showCompressDialog}
        onClose={() => setShowCompressDialog(false)}
        currentFile={currentFile ?? null}
        baseFilename={currentFile?.name}
        onApplied={onCompressApplied}
      />
      <HeadersFootersDialog
        open={showHeadersFootersDialog}
        onClose={() => setShowHeadersFootersDialog(false)}
        onApply={(kind, spec) => {
          onHeaderFooterApply?.(kind, spec);
          setShowHeadersFootersDialog(false);
        }}
        onRemove={(kind) => {
          onHeaderFooterRemove?.(kind);
          setShowHeadersFootersDialog(false);
        }}
        initialHeaderText={headerFooterInitialHeader}
        initialFooterText={headerFooterInitialFooter}
        busy={headerFooterBusy}
      />
      <InsertLinkDialog
        open={showLinkDialog}
        onClose={() => setShowLinkDialog(false)}
        hasTextTarget={(selectedTextElements?.length ?? 0) === 1}
        pageCount={pageCount}
        initialUrl={selectedTextElements?.[0]?.linkUrl ?? null}
        initialPage={selectedTextElements?.[0]?.linkPage ?? null}
        existingNamedDests={namedDestinations}
        onApply={(value) => {
          onInsertLink?.(value);
          setShowLinkDialog(false);
        }}
        onRemove={() => {
          onRemoveLink?.();
          setShowLinkDialog(false);
        }}
      />
      <InsertSvgDialog
        open={showSvgDialog}
        onClose={() => setShowSvgDialog(false)}
        onApply={(value) => {
          onInsertSvg?.(value);
          setShowSvgDialog(false);
        }}
      />
    </div>
  );
}
