"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useShallow } from "zustand/react/shallow";
import Link from "next/link";
import type {
  Element,
  FormFieldElement,
  TextElement,
  TextStyle,
  UUID,
  PageObject,
  BookmarkObject,
  EmbeddedFileObject,
} from "@giga-pdf/types";
import { Button, useToast } from "@giga-pdf/ui";
import {
  useCanvasStore,
  useSelectionStore,
  useUIStore,
  useOperationsStore,
  useViewStore,
  buildTableElements,
  buildListContent,
  clonePastedElements,
  extractPaintableStyle,
  applyPaintableStyle,
} from "@giga-pdf/editor";
import type {
  FindOccurrence,
  PaintableTextStyle,
} from "@giga-pdf/editor";
import {
  ArrowLeft,
  Save,
  Download,
  Users,
  Loader2,
  AlertCircle,
  Wifi,
  WifiOff,
  Pencil,
  Check,
  X,
  MoreVertical,
  RotateCcw,
  FileText,
  Sheet,
  PanelLeft,
  SlidersHorizontal,
  Presentation,
  FileImage,
  FileCode,
  FileType,
  Hash,
  BookOpen,
  type LucideIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  // Aliased: the lucide `Sheet` icon above already owns the bare name.
  Sheet as UiSheet,
  SheetContent,
  SheetTitle,
  SheetClose,
} from "@giga-pdf/ui";
import {
  useMediaQuery,
  MOBILE_MEDIA_QUERY,
  COMPACT_MEDIA_QUERY,
} from "@/hooks/use-media-query";

import { useDocument } from "@/hooks/use-document";
import { useDocumentSave } from "@/hooks/use-document-save";
import { useCollaboration } from "@/hooks/use-collaboration";
import { usePageThumbnails } from "@/hooks/use-page-thumbnails";
import { useEmbeddedFonts, buildDocumentFontOptions } from "@giga-pdf/editor";
import { getAuthToken } from "@/lib/api";
import { api, type ElementCreateRequest } from "@/lib/api";
import {
  EditorCanvas,
  EditorToolbar,
  PagesSidebar,
  PropertiesPanel,
  CollaborationOverlay,
  CollaboratorsList,
  DocumentInfoSidebar,
  ContinuousPageView,
  MobileZoomControls,
} from "@/components/editor";
import type { ContinuousPageViewHandle, BookmarkInput } from "@/components/editor";
import type {
  GeometricAnnotationType,
  NativeAnnotationItem,
} from "@/components/editor/annotations-panel";
import type { TextRunStyleSpan } from "@/components/editor/properties-panel";
import type { InsertLinkValue } from "@/components/editor/insert-link-dialog";
import type { InsertSvgValue } from "@/components/editor/insert-svg-dialog";
import { EditorEditTools } from "@/components/editor/editor-edit-tools";
import { LoadingScreen } from "@/components/editor/loading-screen";
import { FindReplaceDialog } from "@/components/editor/find-replace-dialog";
import type {
  EditorCanvasHandle,
  TextFormatAction,
} from "@/components/editor/editor-canvas";
import {
  FormsPanel,
  type FormsPanelMode,
  type LoadedFormField,
} from "@/components/editor/forms-panel";
import {
  FormFillOverlay,
  type FormFillHighlight,
} from "@/components/editor/form-fill-overlay";
import { TableEditOverlay } from "@/components/editor/table-edit-overlay";
import type {
  TableEditAction,
  TableStyleAction,
} from "@/components/editor/table-edit-overlay";
import {
  actionToTableEdit,
  styleActionToTableEdit,
  buildSourceIndexToCellMap,
} from "@/components/editor/lib/table-edit";
import { ShareDialog } from "@/components/sharing/share-dialog";
import {
  useFlattenPdf,
  usePdfPageOperation,
  downloadBlob,
  useApplyElements,
  useApplyOcgLayers,
  useApplyModelOps,
  useTableStructure,
  useElementUpdates,
  useDocumentLayers,
  useSaveDocumentLayers,
  socketClient,
  type SocketEventData,
  type ParagraphStyleEdit,
  type ListEdit,
  type TableStructureInfo,
} from "@giga-pdf/api";
import {
  ContentEditProvider,
  ContentEditToolbar,
  ContentEditZones,
  type ElementModification,
} from "@/components/editor/content-edit-layer";
import {
  splitTextStylePatch,
  buildListEdits,
} from "@/components/editor/lib/paragraph-style-bake";
import {
  applyPageMargins,
  readAllPageMargins,
  type PageMargins,
} from "@/components/editor/lib/page-margins";
import {
  applyHeaderFooter,
  removeHeaderFooter,
  detectHeaderFooter,
  bakeRunningHeaderFooter,
  readRunningHeaderFooter,
  documentHasSignatures,
  type HeaderFooterKind,
} from "@/components/editor/lib/page-headers-footers";
import {
  HeaderFooterZone,
  type HFFocusedTextItem,
} from "@/components/editor/header-footer-zone";
import type { HFToken } from "@/components/editor/formatting-toolbar";
import {
  HFImageRegistry,
  emptyRunningHeaderFooter,
  appendItemToZone,
  makeImageItem,
  updateItemInZone,
  resolveZoneKeyForPage,
  ensureZone,
  isRunningHeaderFooterEmpty,
  applyTextStylePatch,
  appendTokenToText,
  hfColorToHex,
  textAlignFromAnchor,
  type RunningHeaderFooter,
} from "@/components/editor/lib/running-header-footer";
import {
  addPageParams,
  type PageFormat,
  type PageOrientation,
  type AddPagePosition,
  type PageFormatPoints,
} from "@/components/editor/lib/page-formats";
import {
  exportDocumentAs,
  exportFilename,
} from "@/components/editor/lib/export-document";
import { exportPagesAsImages } from "@/components/editor/lib/export-pages-as-images";
import { extractDocumentBlocks } from "@/components/editor/lib/extract-text";
import { extractDocumentText } from "@/components/editor/lib/extract-text";
import {
  redactDocument,
  groupRectsByPage,
  webRectToPdf,
  type PageGeometry,
  type WebRedactionRect,
} from "@/components/editor/lib/redact-pii";
import { bakeOutline } from "@/components/editor/lib/outline-bake";
import { ResizePageDialog } from "@/components/editor/resize-page-dialog";
import { RedactPiiDialog } from "@/components/editor/redact-pii-dialog";
import { SignatureCaptureDialog } from "@/components/editor/signature-capture-dialog";
import type { ExportFormat } from "@/components/editor/lib/export-formats";
import type { HeaderFooterSpec } from "@qrcommunication/gigapdf-lib";
import { clientLogger } from "@/lib/client-logger";
import { withRetry } from "@/lib/with-retry";
import {
  buildMembership,
  mergeSavedLayers,
} from "@/lib/layer-persistence";

/**
 * Convert a frontend Element to API ElementCreateRequest format.
 * The API expects snake_case for some fields.
 */
function convertToApiElement(element: Element): ElementCreateRequest {
  const base: ElementCreateRequest = {
    type: element.type,
    bounds: {
      x: element.bounds.x,
      y: element.bounds.y,
      width: element.bounds.width,
      height: element.bounds.height,
    },
  };

  // Add transform if present
  if (element.transform) {
    base.transform = {
      rotation: element.transform.rotation,
      scaleX: element.transform.scaleX,
      scaleY: element.transform.scaleY,
      skewX: element.transform.skewX,
      skewY: element.transform.skewY,
    };
  }

  // Add layer_id if present
  if (element.layerId) {
    base.layer_id = element.layerId;
  }

  // Handle type-specific fields
  switch (element.type) {
    case "text":
      base.content = element.content;
      base.style = element.style as unknown as Record<string, unknown>;
      break;
    case "shape":
      base.shape_type = element.shapeType;
      base.style = element.style as unknown as Record<string, unknown>;
      break;
    case "annotation":
      base.annotation_type = element.annotationType;
      base.content = element.content;
      base.style = element.style as unknown as Record<string, unknown>;
      break;
    case "form_field":
      base.field_type = element.fieldType;
      base.field_name = element.fieldName;
      base.style = element.style as unknown as Record<string, unknown>;
      break;
    case "image":
      // Images are handled separately with upload
      base.style = element.style as unknown as Record<string, unknown>;
      break;
  }

  return base;
}

/** Identifiers emitted by the toolbar formatting buttons (kebab-case). */
type ToolbarFormatAction =
  | "bold"
  | "italic"
  | "underline"
  | "align-left"
  | "align-center"
  | "align-right";

/**
 * Map toolbar identifiers to the canvas TextFormatAction contract
 * (camelCase) exposed by EditorCanvasHandle.applyTextFormat.
 */
const TOOLBAR_FORMAT_TO_TEXT_FORMAT: Record<
  ToolbarFormatAction,
  TextFormatAction
> = {
  bold: "bold",
  italic: "italic",
  underline: "underline",
  "align-left": "alignLeft",
  "align-center": "alignCenter",
  "align-right": "alignRight",
};

// Universal export menu (#84): the editable formats the GigaPDF SDK lowers the
// current document into, with their menu icon + i18n key (under `editor.office`).
const SDK_EXPORT_ITEMS: ReadonlyArray<{
  format: ExportFormat;
  icon: LucideIcon;
  labelKey: string;
}> = [
  { format: "docx", icon: FileText, labelKey: "office.exportWordEditable" },
  { format: "odt", icon: FileText, labelKey: "office.exportOdt" },
  { format: "xlsx", icon: Sheet, labelKey: "office.exportExcelEditable" },
  { format: "ods", icon: Sheet, labelKey: "office.exportOds" },
  { format: "pptx", icon: Presentation, labelKey: "office.exportPowerPointEditable" },
  { format: "odp", icon: Presentation, labelKey: "office.exportOdp" },
  { format: "html", icon: FileCode, labelKey: "office.exportHtmlEditable" },
  { format: "rtf", icon: FileType, labelKey: "office.exportRtf" },
  { format: "markdown", icon: Hash, labelKey: "office.exportMarkdown" },
  { format: "csv", icon: Sheet, labelKey: "office.exportCsv" },
  { format: "epub", icon: BookOpen, labelKey: "office.exportEpub" },
  { format: "pdf", icon: Download, labelKey: "office.exportPdf" },
];

export default function EditorPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations("editor");
  const { toast } = useToast();

  // ID du document stocké (depuis l'URL)
  const storedDocumentId = params?.id as string;

  // Deep-link target page (?page=N, 1-based) — e.g. opened from a semantic
  // search hit. Applied once, after the pages load (see effect below).
  const deepLinkAppliedRef = useRef(false);

  // Share dialog (GED) — partage le document STOCKÉ (storedDocumentId)
  const [showShareDialog, setShowShareDialog] = useState(false);

  // Mobile layout — the side panels become drawers (Sheet) on small screens.
  // Both media hooks default to DESKTOP (false) at SSR/jsdom, so the server
  // markup and existing tests keep the desktop layout with no matchMedia mock.
  const isMobile = useMediaQuery(MOBILE_MEDIA_QUERY); // < md (768px)
  const isCompact = useMediaQuery(COMPACT_MEDIA_QUERY); // < lg (1024px)
  const [showPagesSheet, setShowPagesSheet] = useState(false);
  const [showPropertiesSheet, setShowPropertiesSheet] = useState(false);

  // Canvas store — tool, zoom, tool options
  const {
    activeTool,
    zoom,
    fitMode,
    shapeType,
    annotationType,
    fieldKind,
    strokeColor,
    fillColor,
    strokeWidth,
    viewMode,
    showRulers,
    rulerUnit,
    setActiveTool,
    setZoom,
    setFitMode,
    setShapeType,
    setAnnotationType,
    setFieldKind,
    setStrokeColor,
    setFillColor,
    setStrokeWidth,
    setViewMode,
    toggleRulers,
    setRulerUnit,
    setCurrentPage: setCanvasCurrentPage,
  } = useCanvasStore(
    useShallow((s) => ({
      activeTool: s.activeTool,
      zoom: s.zoom,
      fitMode: s.fitMode,
      shapeType: s.shapeType,
      annotationType: s.annotationType,
      fieldKind: s.fieldKind,
      strokeColor: s.strokeColor,
      fillColor: s.fillColor,
      strokeWidth: s.strokeWidth,
      viewMode: s.viewMode,
      showRulers: s.showRulers,
      rulerUnit: s.rulerUnit,
      setActiveTool: s.setActiveTool,
      setZoom: s.setZoom,
      setFitMode: s.setFitMode,
      setShapeType: s.setShapeType,
      setAnnotationType: s.setAnnotationType,
      setFieldKind: s.setFieldKind,
      setStrokeColor: s.setStrokeColor,
      setFillColor: s.setFillColor,
      setStrokeWidth: s.setStrokeWidth,
      setViewMode: s.setViewMode,
      toggleRulers: s.toggleRulers,
      setRulerUnit: s.setRulerUnit,
      setCurrentPage: s.setCurrentPage,
    }))
  );

  // Zoom MANUEL (molette, presets, ±, Ctrl+1) : sort du mode fit — le fit ne
  // doit plus recalculer par-dessus le choix explicite de l'utilisateur.
  // Les modes fit, eux, passent par setZoom directement (onFitZoomChange).
  const handleManualZoomChange = useCallback(
    (newZoom: number) => {
      setFitMode(null);
      setZoom(newZoom);
    },
    [setFitMode, setZoom],
  );

  const handleFitPage = useCallback(() => setFitMode("page"), [setFitMode]);
  const handleFitWidth = useCallback(() => setFitMode("width"), [setFitMode]);

  // View store — active page in the continuous (Word-like) scroller. The
  // continuous view writes activePageIndex on click; the page-scoped panels
  // read it (see effectivePageIndex below). Single-page mode ignores it.
  const { activePageIndex, setActivePageIndex } = useViewStore(
    useShallow((s) => ({
      activePageIndex: s.activePageIndex,
      setActivePageIndex: s.setActivePageIndex,
    }))
  );

  // Imperative handle to the continuous scroller (scrollToPage on jumps).
  const continuousViewRef = useRef<ContinuousPageViewHandle>(null);

  // Selection store — selected element ids
  const {
    selectedElementIds: selectedElementIdsSet,
    selectElements,
    clearSelection,
    deselectElement,
  } = useSelectionStore(
    useShallow((s) => ({
      selectedElementIds: s.selectedElementIds,
      selectElements: s.selectElements,
      clearSelection: s.clearSelection,
      deselectElement: s.deselectElement,
    }))
  );
  // Derived: array of selected IDs (compatible with the existing downstream API)
  const selectedElementIds = useMemo(
    () => Array.from(selectedElementIdsSet),
    [selectedElementIdsSet]
  );

  // UI store — panel visibility + editor modes
  const {
    showFormsPanel,
    isContentEditActive,
    toggleFormsPanel,
    setContentEditActive,
    headersFootersEnabled,
    toggleHeadersFooters,
    setHeadersFootersEnabled,
  } = useUIStore(
    useShallow((s) => ({
      showFormsPanel: s.showFormsPanel,
      isContentEditActive: s.isContentEditActive,
      toggleFormsPanel: s.toggleFormsPanel,
      setContentEditActive: s.setContentEditActive,
      headersFootersEnabled: s.headersFootersEnabled,
      toggleHeadersFooters: s.toggleHeadersFooters,
      setHeadersFootersEnabled: s.setHeadersFootersEnabled,
    }))
  );

  // Canvas handle (via callback) — kept local: transient imperative handle
  const [canvasHandle, setCanvasHandle] = useState<EditorCanvasHandle | null>(null);

  // Continuous mode: a layer-panel selection that targets an element on a
  // NON-active page. We activate the owner page (which mounts ITS EditorCanvas
  // and re-fires onCanvasReady → setCanvasHandle on the next render), and stash
  // the element id here so the canvasHandle effect (below) can retry the
  // selectElement once the new page's canvas is mounted. Cleared on success or
  // when the user navigates elsewhere. A ref (not state) avoids a render and
  // the retry is driven by the canvasHandle dependency, not by this value.
  const pendingLayerSelectRef = useRef<string | null>(null);

  // Word-like partial formatting: live style of the character sub-selection
  // inside the text element being inline-edited. `null` when no text is being
  // edited (or only a caret is placed). Drives the formatting toolbar's active
  // state and tells it to route style edits to the selection vs the element.
  const [textSelectionStyle, setTextSelectionStyle] =
    useState<Partial<TextStyle> | null>(null);

  // --- Formulaires : mode Concevoir / Remplir -----------------------------
  // Concevoir = placer/éditer des champs (comportement historique).
  // Remplir = les champs EXISTANTS du PDF sont listés (FormsPanel) ET
  // surlignés sur le canvas (FormFillOverlay) ; saisie + application via
  // /api/pdf/forms. États locaux : purement UI, non persistés.
  const [formsMode, setFormsMode] = useState<FormsPanelMode>("design");
  // Le FormsPanel charge/rafraîchit ses champs lui-même ; l'overlay de
  // surlignage lit désormais le SCENE GRAPH (formFillHighlights) — seul le
  // setter reste câblé (contrat onFieldsLoaded du panel).
  const [, setLoadedFormFields] = useState<LoadedFormField[]>([]);
  const [focusedFormField, setFocusedFormField] = useState<string | null>(null);
  // Remplir & Signer actif : le canvas passe en UX Adobe (simple clic = curseur
  // dans un champ, clic sur un widget signature = dialog de capture) et le
  // surlignage des champs devient purement visuel.
  const fillSignActive = showFormsPanel && formsMode === "fill";
  // Rect (points PDF, repère page) du widget signature cliqué en mode Remplir &
  // Signer — la prochaine insertion de signature y sera ajustée (ratio
  // préservé, centrée). `widgetId` lie l'image posée au widget (le clic suivant
  // sur le widget SÉLECTIONNE l'image au lieu de rouvrir le dialog).
  // Null = insertion libre (bouton toolbar).
  const signatureTargetRef = useRef<{
    x: number;
    y: number;
    width: number;
    height: number;
    widgetId?: string;
  } | null>(null);
  // Ref pour l'input file
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Current PDF binary — kept local: File object (resource, not serializable)
  const [currentPdfFile, setCurrentPdfFile] = useState<File | null>(null);
  // 0-based indices of the pages whose CONTENT was re-baked in the latest
  // `currentPdfFile` swap (forwarded to the continuous view so it re-rasterises
  // ONLY those pages instead of every visible page). `null` ⇒ structural change
  // (rotate / add / delete page / re-parse) ⇒ the continuous view rebuilds.
  const [bakedPageIndices, setBakedPageIndices] = useState<number[] | null>(
    null,
  );

  // True while a Word-style header/footer band is being baked onto the PDF —
  // drives the dialog's busy state so the user can't fire overlapping bakes.
  const [headerFooterBusy, setHeaderFooterBusy] = useState(false);

  // SL2 — Word-like editable running header/footer ZONES (default zone only).
  //   hfEditMode   : the editable bands are active (raster excludes /GPHF).
  //   hfDef        : the rich definition (source of truth), seeded on load.
  //   hfFocused    : the text item currently focused → drives the toolbar.
  //   hfRegistry   : editor-owned image bytes referenced by image items.
  //   hfDefRef     : sync mirror for the debounced bake closure.
  //   hfBakeTimer  : the pending debounced bake handle.
  //   hfSignedWarnedRef: gates the one-shot "editing breaks signatures" warning.
  const [hfEditMode, setHfEditMode] = useState(false);
  const [hfDef, setHfDef] = useState<RunningHeaderFooter | null>(null);
  const [hfFocused, setHfFocused] = useState<HFFocusedTextItem | null>(null);
  const hfRegistryRef = useRef<HFImageRegistry>(new HFImageRegistry());
  const hfDefRef = useRef<RunningHeaderFooter | null>(null);
  const hfBakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hfSignedWarnedRef = useRef(false);
  const hfImageInputRef = useRef<HTMLInputElement | null>(null);
  // PII redaction tool: live count of zones drawn on the active page (reported
  // by the canvas) + busy flag while the engine bakes the redaction.
  const [redactionMarkCount, setRedactionMarkCount] = useState(0);
  const [redactBusy, setRedactBusy] = useState(false);
  // Text of the header/footer the document already carried when it was opened
  // (recovered via the SDK's headerFooter() reader). Seeds the dialog so the
  // Word-like editor reflects existing document state (#76, P4).
  const [headerFooterInitialHeader, setHeaderFooterInitialHeader] = useState<
    string | undefined
  >(undefined);
  const [headerFooterInitialFooter, setHeaderFooterInitialFooter] = useState<
    string | undefined
  >(undefined);
  // Guards the one-shot header/footer auto-detect so it runs once per opened
  // document and never re-fires on subsequent binary mutations (which would
  // re-enable the toggle the user just turned off).
  const headerFooterDetectedRef = useRef(false);
  // True while the current page is being OCR'd + ingested into the semantic
  // index (#85) — disables the toolbar button to prevent overlapping runs.
  const [indexOcrBusy, setIndexOcrBusy] = useState(false);

  // Content modifications — backed by localStorage so a reload during the
  // 2s save debounce window doesn't drop user edits. The cache is scoped to
  // storedDocumentId and cleared by the onSaved callback once S3 confirms the
  // upload (see useDocumentSave below).
  const contentModsStorageKey = storedDocumentId
    ? `gigapdf:contentMods:${storedDocumentId}`
    : null;
  const [contentModifications, setContentModificationsState] = useState<ElementModification[]>(() => {
    if (typeof window === "undefined" || !contentModsStorageKey) return [];
    try {
      const raw = window.localStorage.getItem(contentModsStorageKey);
      return raw ? (JSON.parse(raw) as ElementModification[]) : [];
    } catch {
      return [];
    }
  });
  const setContentModifications = useCallback(
    (next: ElementModification[] | ((prev: ElementModification[]) => ElementModification[])) => {
      setContentModificationsState((prev) => {
        const value = typeof next === "function" ? (next as (p: ElementModification[]) => ElementModification[])(prev) : next;
        if (typeof window !== "undefined" && contentModsStorageKey) {
          try {
            if (value.length === 0) {
              window.localStorage.removeItem(contentModsStorageKey);
            } else {
              window.localStorage.setItem(contentModsStorageKey, JSON.stringify(value));
            }
          } catch {
            // Quota exceeded or storage disabled — modifications stay in memory.
          }
        }
        return value;
      });
    },
    [contentModsStorageKey],
  );

  // Charger le document
  const {
    name,
    pages,
    currentPage,
    currentPageIndex,
    loading,
    loadProgress,
    error,
    documentId,
    goToPage,
    isDirty,
    setDirty,
    addPage: addPageLocal,
    deletePage: deletePageLocal,
    reorderPages: reorderPagesLocal,
    duplicatePage: duplicatePageLocal,
    addElementToPage,
    updateElementInPage,
    removeElementFromPage,
    replacePages,
    setName,
    outlines,
    documentLanguage,
    layers,
    userLayers,
    createLayer,
    deleteLayer,
    renameLayer,
    reorderLayer,
    setLayerVisible,
    setLayerLocked,
    assignElementToLayer,
    restoreLayers,
    embeddedFiles,
    flattenedPdfFile,
  } = useDocument({ storedDocumentId, flatten: true });

  // Client-side thumbnails generated via pdfjs (durable solution — no server roundtrip)
  const thumbnails = usePageThumbnails(currentPdfFile, pages.length, { scale: 0.18 });

  // ── Continuous vs single view ─────────────────────────────────────────────
  // In continuous mode the page-scoped panels (Properties / Content edit /
  // Forms / Layers) follow the ACTIVE page (the one the user clicked into),
  // tracked in the view store. In single mode they follow useDocument's
  // current page. `effectivePageIndex`/`effectivePage` unify the two so the
  // panels stay agnostic of the layout mode.
  const isContinuous = viewMode === "continuous";
  const effectivePageIndex = useMemo(() => {
    const raw = isContinuous ? activePageIndex : currentPageIndex;
    if (pages.length === 0) return 0;
    return Math.min(Math.max(0, raw), pages.length - 1);
  }, [isContinuous, activePageIndex, currentPageIndex, pages.length]);
  const effectivePage = useMemo<PageObject | null>(
    () => pages[effectivePageIndex] ?? null,
    [pages, effectivePageIndex]
  );

  // Surlignage du mode Remplir : UN rect PAR WIDGET, issu du SCENE GRAPH (le
  // parse produit un élément form_field par widget — pages dupliquées et
  // paires Oui/non incluses), pas du getFormFields de l'API qui ne remonte que
  // le premier widget de chaque champ.
  const formFillHighlights = useMemo<FormFillHighlight[]>(() => {
    const highlights: FormFillHighlight[] = [];
    pages.forEach((page, index) => {
      for (const el of page.elements) {
        if (el.type !== "form_field") continue;
        highlights.push({
          fieldName: el.fieldName,
          pageNumber: index + 1,
          bounds: { ...el.bounds },
        });
      }
    });
    return highlights;
  }, [pages]);

  // Activate a page in the continuous scroller: it becomes the focused page
  // (editable overlay) and drives the page-scoped panels + selection store.
  // Cheap and idempotent — safe to call on every click.
  //
  // SELECTION CLOBBER FIX: the PageSlot root <div> fires this via its React
  // `onMouseDown`, which (React 19 root delegation) runs AFTER Fabric's native
  // `selection:created` for the SAME physical click has already written the
  // clicked element into the selection store. So clearing the selection here
  // unconditionally wiped the selection a click just made — the Properties /
  // layer panels stayed empty even though Fabric drew the blue handles. We
  // therefore only reset the selection when the page ACTUALLY changes (stale
  // selection from the previously-focused page): re-activating the already-
  // active page must leave the just-made selection intact. On the active page,
  // selection is owned by Fabric's own events (`selection:created/cleared` →
  // `handleSelectionChanged`), which correctly clears on empty-space clicks.
  const activatePage = useCallback(
    (index: number) => {
      const pageChanged = index !== activePageIndex;
      setActivePageIndex(index);
      setCanvasCurrentPage(index);
      const page = pages[index];
      // Only when focusing a DIFFERENT page: drop the prior page's (now stale)
      // selection and re-point the store at the newly active page. For a click
      // on the already-active page this is skipped so the element the click is
      // selecting (set by Fabric in the same tick) survives.
      if (pageChanged && page) {
        selectElements([], page.pageId);
      }
    },
    [activePageIndex, setActivePageIndex, setCanvasCurrentPage, pages, selectElements]
  );

  // ── Cross-session layer persistence (P2b) ─────────────────────────────────
  // User layers + element→layer membership are keyed by the STORED document id
  // (not any transient session id) and survive a reload. On open we fetch the
  // saved snapshot, then merge it into the freshly-parsed scene graph: restore
  // the layers and re-attach membership for elements whose deterministic id
  // still exists (P1). Subsequent layer mutations are PUT back debounced.
  const { data: savedLayersData } = useDocumentLayers(storedDocumentId);
  const saveDocumentLayers = useSaveDocumentLayers();
  // Guards the one-shot load-merge: blocks the debounced save from firing while
  // restoring, and prevents the merge from running twice for the same load.
  const layersMergedRef = useRef(false);
  const layersSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-arm the merge guard whenever a new document finishes (re)loading.
  useEffect(() => {
    layersMergedRef.current = false;
  }, [storedDocumentId]);

  // Load + merge: runs once, after the parse completes AND the saved snapshot
  // has arrived. `savedLayersData` is undefined while the query is in flight.
  useEffect(() => {
    if (layersMergedRef.current) return;
    if (loading) return; // wait for parse
    if (pages.length === 0) return;
    if (savedLayersData === undefined) return; // wait for the GET
    const { layers: restoredLayers, membership } = mergeSavedLayers(
      savedLayersData,
      pages,
    );
    layersMergedRef.current = true;
    if (restoredLayers.length === 0) return; // nothing saved → no-op
    restoreLayers(restoredLayers, membership);
  }, [loading, pages, savedLayersData, restoreLayers]);

  // Debounced save (~800ms trailing) on any layer mutation. Skipped until the
  // initial load-merge has run (avoids overwriting the saved snapshot with the
  // pre-restore empty state). `userLayers` identity changes on every mutation,
  // and `pages` identity changes on membership/visibility/lock cascades, so
  // both drive the snapshot rebuild.
  useEffect(() => {
    if (!storedDocumentId) return;
    if (!layersMergedRef.current) return; // not yet restored → don't clobber
    if (layersSaveTimerRef.current) clearTimeout(layersSaveTimerRef.current);
    layersSaveTimerRef.current = setTimeout(() => {
      saveDocumentLayers.mutate({
        storedDocumentId,
        data: { layers: userLayers, membership: buildMembership(pages) },
      });
    }, 800);
    return () => {
      if (layersSaveTimerRef.current) clearTimeout(layersSaveTimerRef.current);
    };
    // saveDocumentLayers identity is stable across renders (TanStack mutation).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedDocumentId, userLayers, pages]);

  // Unified page navigation (sidebar / TOC / header / search / keyboard).
  // Always advances useDocument's pointer; in continuous mode it ALSO focuses
  // the page and smooth-scrolls it into view.
  const navigateToPage = useCallback(
    (index: number, align: "start" | "center" = "start") => {
      const clamped =
        pages.length === 0
          ? 0
          : Math.min(Math.max(0, index), pages.length - 1);
      goToPage(clamped);
      if (isContinuous) {
        activatePage(clamped);
        continuousViewRef.current?.scrollToPage(clamped, align);
      }
    },
    [pages.length, goToPage, isContinuous, activatePage]
  );

  // Apply the ?page=N deep link once the document's pages are available (opened
  // from a semantic-search result). Runs a single time per mount.
  useEffect(() => {
    if (deepLinkAppliedRef.current) return;
    if (pages.length === 0) return;
    const pageParam = searchParams?.get("page");
    if (!pageParam) {
      deepLinkAppliedRef.current = true;
      return;
    }
    const target = Number(pageParam);
    if (Number.isInteger(target) && target >= 1) {
      navigateToPage(target - 1, "start");
    }
    deepLinkAppliedRef.current = true;
  }, [pages.length, searchParams, navigateToPage]);

  // Dynamically load embedded PDF fonts via FontFace API (backed by IndexedDB cache).
  // Maps originalFont names (like "g_d0_f1") to real CSS font-family names,
  // so Fabric can render text with the SAME font as the PDF background.
  const {
    getFontFaceName,
    fonts: embeddedFonts,
    isLoading: fontsLoading,
  } = useEmbeddedFonts({
    documentId: documentId || "",
    enabled: Boolean(documentId),
    getAuthToken,
  });
  // Real document fonts for the picker (so typed/edited text matches the PDF).
  const documentFontOptions = useMemo(
    () => buildDocumentFontOptions(embeddedFonts),
    [embeddedFonts],
  );

  // Fetch the actual PDF binary when document loads. Skipped when a flattened
  // file is present (the flatten-adopt effect below adopts those canonical
  // bytes instead), so we never overwrite the flattened content with the
  // un-flattened original. `updateCurrentPdfFile` is intentionally not in the
  // deps — it's a stable useCallback declared further down (referencing it in
  // the dep array here would hit its TDZ at render time).
  useEffect(() => {
    if (!documentId || !name) return;
    if (flattenedPdfFile) return;
    let cancelled = false;
    // Re-arm the one-shot header/footer auto-detect for this (re)load.
    headerFooterDetectedRef.current = false;

    async function loadPdfBinary() {
      try {
        const downloadUrl = api.getDocumentDownloadUrl(documentId!);
        const { getAuthToken } = await import('@/lib/api');
        const token = await getAuthToken();
        const response = await fetch(downloadUrl, {
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!response.ok || cancelled) return;
        const blob = await response.blob();
        if (cancelled) return;
        const file = new File([blob], `${name}.pdf`, { type: 'application/pdf' });
        updateCurrentPdfFile(file);

        // One-shot auto-detect of a header/footer already baked into the
        // opened document (#76, P4). Read the freshly-fetched bytes with the
        // SDK reader; if a band is present, enable the Word-style toggle and
        // pre-fill the dialog. Guarded by a ref so it runs once per document
        // and never re-fires after later binary mutations.
        if (!headerFooterDetectedRef.current) {
          headerFooterDetectedRef.current = true;
          try {
            const bytes = new Uint8Array(await blob.arrayBuffer());
            if (cancelled) return;
            const { header, footer } = await detectHeaderFooter(bytes);
            if (cancelled) return;
            if (header) setHeaderFooterInitialHeader(header);
            if (footer) setHeaderFooterInitialFooter(footer);
            if (header || footer) setHeadersFootersEnabled(true);
            // SL2 — seed the rich running-H/F definition (source of truth for
            // the editable zones) from the document's editor-meta sidecar.
            const richDef = await readRunningHeaderFooter(bytes);
            if (cancelled) return;
            const seedDef = richDef ?? emptyRunningHeaderFooter();
            setHfDef(seedDef);
            hfDefRef.current = seedDef;
          } catch (err) {
            clientLogger.warn('[editor] header/footer auto-detect failed:', err);
          }
        }
      } catch (err) {
        clientLogger.error('[editor] Failed to load PDF binary:', err);
      }
    }

    loadPdfBinary();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, name, flattenedPdfFile]);

  // État pour l'édition du nom
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(name);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // PDF mutations — hoisted above useDocumentSave so getPreparedBlob can use them
  const flattenPdf = useFlattenPdf();
  const pageOperation = usePdfPageOperation();
  const applyElements = useApplyElements();
  // Native OCG (PDF "layers") mutations — toggle visibility/lock, remove — baked
  // by id into the binary then re-parsed. `ocgBusyIds` disables a row's controls
  // while its bake is in flight (one OCG op per click, serialised by the queue).
  const applyOcgLayers = useApplyOcgLayers();
  const [ocgBusyIds, setOcgBusyIds] = useState<number[]>([]);
  // Native paragraph-style bake (alignment/indents/spacing) via the engine's
  // unified model — keyed by the editor's flat run index (`TextElement.index`),
  // resolved to a `[section, page, index]` block address server-side. Distinct
  // from `applyElements` (flat redact+add): this writes formatting structurally
  // into the document model, so a reload reflects it.
  const applyModelOps = useApplyModelOps();
  // Table-structure read path: enumerates the document's reconstructed tables
  // (positional handle + grid size + PDF-space frame) so the table-edit overlay
  // can draw a selectable box per table. Tables are addressed positionally
  // (`pageNumber` + `tableIndexOnPage`) — cell runs carry no `source_index`.
  const tableStructure = useTableStructure();
  // The tables detected in the current binary (refreshed after every adopt), the
  // table-edit overlay toggle, the selected table, and a bake-in-flight guard.
  const [documentTables, setDocumentTables] = useState<TableStructureInfo[]>([]);
  const [showTableEdit, setShowTableEdit] = useState(false);
  const [selectedTableIndex, setSelectedTableIndex] = useState<number | null>(
    null,
  );
  const [tableEditBusy, setTableEditBusy] = useState(false);

  // currentPdfFile is the single source of truth for the PDF binary. It
  // receives every local mutation (rotate/extract/element add/modify/delete
  // via apply-elements). The save flow uploads this blob directly, so any
  // op that already updated currentPdfFile is persisted, even if the op
  // queue is empty at save time.
  //
  // We keep a ref alongside the state because setState is async: callers
  // that invoke save() immediately after setCurrentPdfFile would otherwise
  // read the stale closure value and upload the pre-mutation binary. The
  // ref is updated synchronously before every save trigger.
  const peekOperations = useOperationsStore((s) => s.peek);
  const drainOperations = useOperationsStore((s) => s.drain);
  const currentPdfFileRef = useRef<File | null>(null);
  const contentModificationsRef = useRef<ElementModification[]>([]);
  // Late-bound paragraph/list-format baker. `handleTextStyleChange` (defined
  // before `adoptModifiedPdf`/`getPreparedBlob`) routes paragraph-level edits
  // (alignment, indent, line-height, list level/marker/ordered) here without a
  // TDZ on those later-declared callbacks. Assigned by an effect once the baker
  // is constructed. The `style` patch is the same partial TextStyle the toolbar
  // emits; the baker maps it to the engine's model ops.
  const bakeParagraphStyleRef = useRef<
    | ((element: TextElement, style: Partial<TextStyle>) => Promise<boolean>)
    | null
  >(null);
  // ElementIds that were baked into the PDF in the most recent apply-elements
  // call. They should be removed from the Redis backend ONLY after the S3
  // upload succeeds — flushed by the onSaved callback below. Keeping them
  // in Redis until S3 confirms means a transient upload failure is recoverable
  // (Redis still has the user data, scene graph rebuilds via merge on reload).
  const pendingFlushIdsRef = useRef<string[]>([]);

  // `bakedIndices` records which 0-based page indices had their CONTENT re-baked
  // in this binary swap. Defaults to `null` (structural change / unknown) so
  // every existing caller keeps the safe "rebuild" semantics; only the content
  // bake in `getPreparedBlob` passes the precise indices for the fast path.
  const updateCurrentPdfFile = useCallback(
    (file: File | null, bakedIndices: number[] | null = null) => {
      currentPdfFileRef.current = file;
      setCurrentPdfFile(file);
      setBakedPageIndices(bakedIndices);
    },
    [],
  );

  // Adopt the flattened PDF (Form XObjects inlined by parse-from-s3) as the
  // binary source of truth. Runs once when the flattened file arrives from the
  // load. The parsed `elements` already correspond to these bytes, so this
  // keeps currentPdfFile consistent with the scene graph (save + raster +
  // apply-operations all run on the flattened content → in-place text edits).
  // No-op for form-less docs (flattenedPdfFile stays null → raw download wins).
  useEffect(() => {
    if (!flattenedPdfFile) return;
    updateCurrentPdfFile(flattenedPdfFile);
  }, [flattenedPdfFile, updateCurrentPdfFile]);

  const getPreparedBlob = useCallback(async (): Promise<Blob | null> => {
    const pdfFile = currentPdfFileRef.current;
    if (!pdfFile) {
      // pdfFile is null only before the initial load resolves. The save flow
      // falls back to fetching S3, which is safe in this state because the
      // canonical binary IS S3 until the local copy is hydrated.
      const pendingOps = peekOperations();
      if (pendingOps.length > 0) {
        clientLogger.warn(
          "[editor] getPreparedBlob: queue has",
          pendingOps.length,
          "ops but pdfFile is not loaded yet — save will retry once the binary is available",
        );
      }
      return null;
    }

    // Peek (don't drain yet): if apply-elements throws between the drain and
    // the catch block, ops would be silently lost — even prependOperations
    // could race with concurrent save attempts. Drain only AFTER we know the
    // binary was successfully patched.
    const ops = peekOperations();
    const contentMods = contentModificationsRef.current;

    // Nothing to bake — upload the current in-memory PDF as-is. This covers
    // page-level ops (rotate/extract) that already mutated currentPdfFile.
    if (ops.length === 0 && contentMods.length === 0) {
      return pdfFile;
    }

    // Merge element ops + content-edit-layer mods into a single apply call.
    const allOps = [
      ...ops.map((op) => ({
        action: op.action,
        pageNumber: op.pageNumber,
        element: op.element as Record<string, unknown>,
        ...(op.oldBounds ? { oldBounds: op.oldBounds } : {}),
        ...(op.reorder ? { reorder: op.reorder } : {}),
      })),
      ...contentMods.map((mod) => ({
        ...mod,
        pageNumber: mod.pageNumber + 1, // content-edit-layer is 0-indexed
      })),
    ];

    try {
      const modified = await applyElements.mutateAsync({
        file: pdfFile,
        operations: allOps,
      });
      // apply-elements succeeded — now it's safe to drain the queue. Anything
      // queued AFTER our peek stays for the next save tick.
      drainOperations();

      const blob =
        modified instanceof Blob ? modified : new Blob([modified as BlobPart]);
      // 0-based indices of the pages this bake actually touched (all ops carry a
      // 1-based pageNumber). Forwarded so the continuous view re-rasterises ONLY
      // these pages — same structure, no pool rebuild.
      const bakedIdx = Array.from(
        new Set(
          allOps
            .map((op) =>
              typeof op.pageNumber === "number" ? op.pageNumber - 1 : -1,
            )
            .filter((i) => i >= 0),
        ),
      );
      // Update local cache so subsequent ops apply on top of the new binary.
      updateCurrentPdfFile(
        new File([blob], pdfFile.name, { type: "application/pdf" }),
        bakedIdx,
      );
      // Clear content modifications now that they're baked in.
      setContentModifications([]);

      // Stash the elementIds for post-upload Redis flush. We can't delete
      // from Redis here because S3 hasn't confirmed yet — if upload fails,
      // Redis is still our recovery source on next reload (via merge).
      const elementIdsBaked = ops
        .map((op) => {
          const el = op.element as { elementId?: string };
          return el?.elementId;
        })
        .filter((id): id is string => Boolean(id));
      if (elementIdsBaked.length > 0) {
        pendingFlushIdsRef.current.push(...elementIdsBaked);
      }

      return blob;
    } catch (err) {
      clientLogger.error("[editor] apply-elements failed during save:", err);
      // Don't drain the queue — ops stay in the store for the next save tick.
      // Returning the last known good binary means the upload still goes
      // through, and the user's pending ops are preserved for retry.
      return pdfFile;
    }
  }, [peekOperations, drainOperations, applyElements, updateCurrentPdfFile]);

  // Keep the ref in sync so getPreparedBlob can read the latest mods without
  // being reconstructed on every keystroke.
  useEffect(() => {
    contentModificationsRef.current = contentModifications;
  }, [contentModifications]);

  // PARTIE 4 — Rafraîchissement des métadonnées GED après un save éditeur.
  // Best-effort + throttlé (max 1 fois / 60s) : (a) régénère la miniature du
  // document stocké depuis le binaire sauvegardé, (b) reconstruit le texte de
  // recherche full-text depuis les éléments text du scene graph EN MÉMOIRE
  // (aucun re-parse). Les échecs sont silencieux (warn console uniquement) —
  // la GED se rattrapera au prochain save au-delà de la fenêtre de throttle.
  //
  // pagesRef : le onSaved du save debounced/auto peut s'exécuter longtemps
  // après la construction de sa closure — on lit l'état pages via ref pour
  // éviter un texte de recherche figé sur un scene graph périmé.
  const lastGedRefreshRef = useRef(0);
  const pagesRef = useRef<PageObject[]>(pages);
  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  const refreshGedMetadata = useCallback(async () => {
    if (!storedDocumentId) return;
    const now = Date.now();
    if (now - lastGedRefreshRef.current < 60_000) return;
    lastGedRefreshRef.current = now;

    // (a) Miniature : rend la page 1 du binaire sauvegardé en PNG via
    // /api/pdf/preview (mode thumbnail) puis l'upload vers la GED.
    const pdfFile = currentPdfFileRef.current;
    if (pdfFile) {
      try {
        const token = await getAuthToken();
        const form = new FormData();
        form.append("file", pdfFile, pdfFile.name);
        form.append("mode", "thumbnail");
        form.append("pageNumber", "1");
        form.append("format", "png");
        form.append("maxWidth", "480");
        form.append("maxHeight", "640");
        const res = await fetch("/api/pdf/preview", {
          method: "POST",
          credentials: "include",
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          body: form,
        });
        if (res.ok) {
          const png = await res.blob();
          await api.uploadDocumentThumbnail(storedDocumentId, png);
          clientLogger.debug("[editor] GED thumbnail refreshed");
        } else {
          clientLogger.warn(
            "[editor] GED thumbnail refresh failed:",
            res.status,
          );
        }
      } catch (err) {
        clientLogger.warn("[editor] GED thumbnail refresh failed:", err);
      }
    }

    // (b) Index de recherche : reconstruit l'index sémantique POSITIONNÉ
    // (texte + bbox par ligne) depuis les octets PDF sauvegardés — exactement
    // comme l'import/backfill — pour que les résultats de recherche surlignent
    // la zone sur la page. Une liste vide purge un document édité jusqu'à 0
    // texte. Gardé sur les octets sauvegardés + pages chargées pour qu'une
    // sauvegarde prématurée ne purge pas un index valide.
    try {
      const pdfFile = currentPdfFileRef.current;
      if (pdfFile && pagesRef.current.length > 0) {
        const blocks = await extractDocumentBlocks(await pdfFile.arrayBuffer());
        await api.indexOcrBlocks(storedDocumentId, blocks);
        clientLogger.debug(
          "[editor] GED search index refreshed:",
          blocks.length,
          "blocks",
        );
      }
    } catch (err) {
      clientLogger.warn("[editor] GED search-index refresh failed:", err);
    }
  }, [storedDocumentId]);

  // Sauvegarde hybride (immédiate pour actions critiques, debounced pour modifications mineures)
  const {
    saving,
    saveError,
    lastSaved,
    save,
    saveWithPriority,
    pendingChanges,
  } = useDocumentSave({
    documentId,
    storedDocumentId,
    name,
    isDirty,
    autoSaveInterval: 30000, // Auto-save toutes les 30s comme filet de sécurité
    debounceDelay: 2000, // 2s de debounce pour modifications mineures
    setDirty,
    getPreparedBlob,
    onSaved: async (id) => {
      clientLogger.debug("[editor] Document sauvegardé:", id);
      // PARTIE 4 — best-effort GED refresh (miniature + texte de recherche),
      // fire-and-forget : ne bloque ni le flush Redis ni le flux de save.
      void refreshGedMetadata();
      // Flush Redis backend for elements that were baked into the PDF in the
      // last apply-elements pass. We only run this AFTER S3 confirms the
      // upload, otherwise a transient upload failure would lose the data
      // permanently (Redis cleared + S3 unchanged).
      const flushIds = pendingFlushIdsRef.current;
      if (flushIds.length === 0 || !documentId) return;
      pendingFlushIdsRef.current = [];
      try {
        await api.batchElementOperations(
          documentId,
          flushIds.map((elementId) => ({
            action: "delete" as const,
            element_id: elementId,
          })),
        );
        clientLogger.debug(
          "[editor] Redis flushed for",
          flushIds.length,
          "baked elements",
        );
      } catch (err) {
        // Non-fatal: harmless duplicate at next reload (caught by the dedup
        // heuristic in mergeBackendElements). Push the ids back so a later
        // save tick gets another chance to clean up.
        pendingFlushIdsRef.current.push(...flushIds);
        clientLogger.warn(
          "[editor] Redis flush failed — will retry next save:",
          err,
        );
      }
    },
  });

  // Focus input quand on passe en mode édition
  useEffect(() => {
    if (isEditingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [isEditingName]);

  // Mettre à jour editedName quand name change
  useEffect(() => {
    setEditedName(name);
  }, [name]);

  // Handlers pour le renommage
  const handleStartRename = useCallback(() => {
    setEditedName(name);
    setIsEditingName(true);
  }, [name]);

  const handleCancelRename = useCallback(() => {
    setEditedName(name);
    setIsEditingName(false);
  }, [name]);

  const handleConfirmRename = useCallback(() => {
    const trimmedName = editedName.trim();
    if (trimmedName && trimmedName !== name) {
      setName(trimmedName);
      setDirty(true);
      saveWithPriority("immediate");
    }
    setIsEditingName(false);
  }, [editedName, name, setName, setDirty, saveWithPriority]);

  const handleNameKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleConfirmRename();
    } else if (e.key === "Escape") {
      handleCancelRename();
    }
  }, [handleConfirmRename, handleCancelRename]);

  // Collaboration temps réel (présence, curseurs, émissions update/delete).
  // Room = storedDocumentId (le [id] de la route, commun à tous les
  // collaborateurs) — JAMAIS le documentId de session (id Redis recréé PAR
  // UTILISATEUR à chaque /load : deux utilisateurs n'atterriraient jamais
  // dans la même room). Le serveur autorise le join par storedDocumentId
  // (owner ou partage actif — _authorize_document_join) et ses relays
  // exigent que les émissions portent ce même id (session["document_id"]).
  const {
    collaborators,
    cursors,
    sendCursorPosition,
    collaboratorCount,
    isConnected,
    emitElementUpdate,
    emitElementDelete,
  } = useCollaboration({
    documentId: storedDocumentId ?? null,
    enabled: !!storedDocumentId,
  });

  // --- Application des événements de collaboration distants ---
  // Abonnement direct via useElementUpdates (et non via les callbacks de
  // useCollaboration) : ce dernier strippe l'enveloppe socket et ne transmet
  // que l'élément — or le routage nécessite page_number et l'anti-écho
  // nécessite client_id, présents uniquement dans le payload brut.
  //
  // Aucune de ces trois branches ne déclenche queueAdd/queueUpdate/queueDelete
  // ni saveWithPriority : l'émetteur a déjà persisté (Redis + bake S3) — les
  // re-saver ici provoquerait un double-bake du même élément.
  const handleRemoteElementCreate = useCallback(
    (data: SocketEventData["element:create"]) => {
      // Anti-écho (ceinture) : socketClient filtre déjà au dispatch les
      // événements portant notre propre client_id ; on re-vérifie au cas où
      // un futur relay serveur contournerait le wrapper du provider.
      if (data.client_id && data.client_id === socketClient.getClientId()) {
        return;
      }
      const element = data.element as Element | null;
      if (!element?.elementId) return;

      // Routage : page_number (1-indexé) fourni par l'émetteur ; fallback
      // page courante pour les émetteurs qui ne l'envoient pas encore.
      const pageIndex =
        typeof data.page_number === "number" && data.page_number >= 1
          ? data.page_number - 1
          : currentPageIndex;

      clientLogger.debug(
        "[editor] Remote element created:",
        element.elementId,
        "page:",
        pageIndex + 1,
      );

      // Idempotence : double délivrance réseau ou élément déjà connu →
      // traiter comme une mise à jour plutôt que d'empiler un doublon.
      const ownerPageIndex = pages.findIndex((p) =>
        p.elements.some((e) => e.elementId === element.elementId),
      );
      if (ownerPageIndex !== -1) {
        updateElementInPage(element.elementId, element);
        if (ownerPageIndex === currentPageIndex) {
          canvasHandle?.applyRemoteElementUpdate(element);
        }
        return;
      }

      // 1. Scene graph React (toutes pages — une page non affichée sera
      //    rendue à la navigation via loadPage).
      addElementToPage(pageIndex, element);
      // 2. Canvas Fabric uniquement si la page est actuellement affichée.
      if (pageIndex === currentPageIndex) {
        canvasHandle?.applyRemoteElementCreate(element);
      }
    },
    [pages, currentPageIndex, addElementToPage, updateElementInPage, canvasHandle],
  );

  const handleRemoteElementUpdate = useCallback(
    (data: SocketEventData["element:update"]) => {
      if (data.client_id && data.client_id === socketClient.getClientId()) {
        return;
      }
      const elementId = data.element_id;
      if (!elementId) return;
      const changes = data.changes as Partial<Element> | null;
      if (!changes) return;

      // Reconstruire l'Element complet : le payload peut être partiel
      // (modification via panel propriétés) — merge sur l'élément connu.
      const ownerPage = pages.find((p) =>
        p.elements.some((e) => e.elementId === elementId),
      );
      if (!ownerPage) {
        clientLogger.debug(
          "[editor] Remote update for unknown element — ignored:",
          elementId,
        );
        return;
      }
      const existing = ownerPage.elements.find(
        (e) => e.elementId === elementId,
      );
      if (!existing) return;
      // Merge shallow volontaire (même sémantique qu'updateElementInPage).
      // Cast sûr : les changes distants proviennent du même type discriminant
      // que l'élément d'origine (l'émetteur a envoyé l'élément modifié).
      const merged = {
        ...existing,
        ...changes,
        elementId: existing.elementId,
      } as Element;

      clientLogger.debug("[editor] Remote element updated:", elementId);

      updateElementInPage(elementId, merged);
      if (pages.indexOf(ownerPage) === currentPageIndex) {
        canvasHandle?.applyRemoteElementUpdate(merged);
      }
    },
    [pages, currentPageIndex, updateElementInPage, canvasHandle],
  );

  const handleRemoteElementDelete = useCallback(
    (data: SocketEventData["element:delete"]) => {
      if (data.client_id && data.client_id === socketClient.getClientId()) {
        return;
      }
      const elementId = data.element_id;
      if (!elementId) return;

      clientLogger.debug("[editor] Remote element deleted:", elementId);

      // Canvas d'abord : la méthode no-op si l'objet n'est pas rendu sur la
      // page affichée, et son garde interne empêche tout onElementRemoved
      // (donc aucune réémission ni queueDelete).
      canvasHandle?.applyRemoteElementDelete(elementId);
      deselectElement(elementId);
      removeElementFromPage(elementId);
    },
    [canvasHandle, deselectElement, removeElementFromPage],
  );

  useElementUpdates(
    // Même room que le join : les événements distants portent le
    // storedDocumentId (les filtres data.document_id === documentId des
    // hooks laisseraient tout passer à la trappe avec l'id de session).
    storedDocumentId ?? null,
    handleRemoteElementCreate,
    handleRemoteElementUpdate,
    handleRemoteElementDelete,
  );

  // Ref pour le canvas (pour la position du curseur)
  const canvasRef = useRef<HTMLDivElement>(null);

  // Undo/Redo state via canvas handle
  const canUndo = canvasHandle?.canUndo() ?? false;
  const canRedo = canvasHandle?.canRedo() ?? false;

  // Éléments sélectionnés (sur la page active — = currentPage en mode page
  // unique, = page focalisée en mode continu).
  const selectedElements = useMemo(() => {
    if (!effectivePage) return [];
    return effectivePage.elements.filter((el) =>
      selectedElementIds.includes(el.elementId)
    );
  }, [effectivePage, selectedElementIds]);

  // Text-only subset, used by the toolbar's Word-like formatting cluster.
  const selectedTextElements = useMemo(
    () =>
      selectedElements.filter(
        (el): el is TextElement => el.type === "text",
      ),
    [selectedElements],
  );

  // === P7 — Édition (#83) : Rechercher/Remplacer + Presse-papiers + Format
  // painter. État local (additif). Le presse-papiers est en mémoire applicative
  // (pas l'OS) — copier/couper stocke des clones d'éléments, coller les ré-injecte
  // via handleElementAdded (scene graph + queue + bake). Le format painter
  // « ramasse » le style d'un texte sélectionné puis l'applique aux sélections
  // suivantes via handleElementUpdate.
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [clipboard, setClipboard] = useState<Element[]>([]);
  const [copiedFormat, setCopiedFormat] = useState<PaintableTextStyle | null>(
    null,
  );
  const canPaste = clipboard.length > 0;
  const formatPainterArmed = copiedFormat !== null;
  // Source valide du format painter : exactement un élément texte sélectionné.
  const canCopyFormat = useMemo(
    () => selectedElements.length === 1 && selectedElements[0]?.type === "text",
    [selectedElements],
  );

  // --- Champs de formulaire du document (mode Concevoir) -------------------
  // Liste plate ordonnée page par page : c'est l'ordre dans lequel les
  // champs seront bakés en AcroForm au save/export — soit l'ordre de
  // tabulation logique dans la plupart des lecteurs PDF.
  const designFields = useMemo(() => {
    const list: Array<{ element: FormFieldElement; pageIndex: number }> = [];
    pages.forEach((page, pageIndex) => {
      for (const el of page.elements) {
        if (el.type === "form_field") {
          list.push({ element: el, pageIndex });
        }
      }
    });
    return list;
  }, [pages]);

  // Noms de champs du document — validation d'unicité dans le panel
  // propriétés (les widgets radio d'un groupe partagent leur nom : le panel
  // exclut le nom courant).
  const allFieldNames = useMemo(
    () => designFields.map(({ element }) => element.fieldName),
    [designFields],
  );

  // Sélection d'un champ depuis la liste du FormsPanel : navigue vers sa
  // page puis le sélectionne (le properties panel suit).
  const handleDesignFieldSelect = useCallback(
    (elementId: string, pageIndex: number) => {
      const targetPage = pages[pageIndex];
      if (!targetPage) return;
      // navigateToPage focuses + scrolls the page (continuous) or moves the
      // single-page pointer; it clears the selection, so re-select after.
      if (pageIndex !== effectivePageIndex) navigateToPage(pageIndex, "center");
      selectElements([elementId], targetPage.pageId);
    },
    [pages, effectivePageIndex, navigateToPage, selectElements],
  );

  // Réordonnancement d'un champ dans l'ordre de bake. Limitation moteur
  // documentée : l'ordre de tabulation PDF étant l'ordre des /Annots de la
  // PAGE, le réordonnancement n'opère qu'entre champs d'une même page (un
  // swap inter-pages déplacerait physiquement le champ).
  const handleDesignFieldReorder = useCallback(
    (elementId: string, direction: "up" | "down") => {
      const index = designFields.findIndex(
        ({ element }) => element.elementId === elementId,
      );
      if (index < 0) return;
      const neighborIndex = direction === "up" ? index - 1 : index + 1;
      if (neighborIndex < 0 || neighborIndex >= designFields.length) return;
      const current = designFields[index]!;
      const neighbor = designFields[neighborIndex]!;
      if (current.pageIndex !== neighbor.pageIndex) return;

      const newPages = pages.map((page, pageIndex) => {
        if (pageIndex !== current.pageIndex) return page;
        const elements = [...page.elements];
        const ia = elements.findIndex(
          (el) => el.elementId === current.element.elementId,
        );
        const ib = elements.findIndex(
          (el) => el.elementId === neighbor.element.elementId,
        );
        if (ia < 0 || ib < 0) return page;
        [elements[ia], elements[ib]] = [elements[ib]!, elements[ia]!];
        return { ...page, elements };
      });
      replacePages(newPages);
      setDirty(true);
      saveWithPriority("debounced");
    },
    [designFields, pages, replacePages, setDirty, saveWithPriority],
  );

  // Handlers
  const handleUndo = useCallback(() => {
    canvasHandle?.undo();
  }, [canvasHandle]);

  const handleRedo = useCallback(() => {
    canvasHandle?.redo();
  }, [canvasHandle]);

  const handleDelete = useCallback(() => {
    canvasHandle?.deleteSelected();
    setDirty(true);
    saveWithPriority("immediate");
  }, [canvasHandle, setDirty, saveWithPriority]);

  const handleDuplicate = useCallback(() => {
    canvasHandle?.duplicateSelected();
    setDirty(true);
    saveWithPriority("debounced");
  }, [canvasHandle, setDirty, saveWithPriority]);

  // Z-order: bring the selected element(s) to the front / send to the back.
  // The canvas persists the new stacking order via the scene graph (no PDF
  // binary reorder op exists in the engine — see EditorCanvasHandle docs).
  const handleBringToFront = useCallback(() => {
    for (const id of selectedElementIds) canvasHandle?.bringToFront(id);
    if (selectedElementIds.length > 0) {
      setDirty(true);
      saveWithPriority("debounced");
    }
  }, [canvasHandle, selectedElementIds, setDirty, saveWithPriority]);

  const handleSendToBack = useCallback(() => {
    for (const id of selectedElementIds) canvasHandle?.sendToBack(id);
    if (selectedElementIds.length > 0) {
      setDirty(true);
      saveWithPriority("debounced");
    }
  }, [canvasHandle, selectedElementIds, setDirty, saveWithPriority]);

  // Operations queue: records user-added/modified/deleted elements so the
  // save flow can apply them to the PDF binary before uploading. Without
  // this, edits only exist in the scene_graph (Redis) and vanish from the
  // PDF on reload.
  const { queueAdd, queueUpdate, queueDelete, queueReorder } = useOperationsStore(
    useShallow((s) => ({
      queueAdd: s.queueAdd,
      queueUpdate: s.queueUpdate,
      queueDelete: s.queueDelete,
      queueReorder: s.queueReorder,
    }))
  );

  const handleElementAdded = useCallback(
    async (element: Element) => {
      clientLogger.debug("[editor] Element added:", element);
      setDirty(true);
      const pageNumber = currentPageIndex + 1;

      // Mirror the new element into the local scene graph so properties
      // panel and selection lookups find it. Without this, Fabric objects
      // are selectable but the panel stays empty because selectedElements
      // is computed via currentPage.elements.filter().
      addElementToPage(currentPageIndex, element);

      // Auto-select the new element so its properties are immediately
      // visible — matches the UX of every real PDF editor.
      if (currentPage) {
        selectElements([element.elementId], currentPage.pageId);
      }

      // Record the op so the save flow can bake it into the PDF.
      queueAdd(pageNumber, element);

      // Émettre via WebSocket pour la collaboration. Émission directe via
      // socketClient (et non emitElementCreate du hook) : le récepteur a
      // besoin de page_number pour router l'élément vers la bonne page, or
      // l'enveloppe du hook ne transporte que l'élément. client_id
      // (anti-écho) est estampillé automatiquement par socketClient.emit ;
      // user_id est renseigné côté serveur (même contrat que le hook).
      // document_id = storedDocumentId : la room jointe est celle du document
      // STOCKÉ (le relay serveur droppe toute émission portant un autre id).
      if (storedDocumentId) {
        socketClient.emit("element:create", {
          document_id: storedDocumentId,
          element,
          user_id: "",
          page_number: pageNumber,
        });
      }

      // Persister l'élément dans le backend (scene graph Redis) avec retry
      // exponentiel — couvre les hiccups Redis/réseau transients sans
      // bloquer l'UI. Le PDF S3 est de toute façon savé en parallèle, donc
      // un échec définitif côté Redis ne perd pas l'élément (le bake S3
      // reste).
      if (documentId) {
        const apiElement = convertToApiElement(element);
        try {
          await withRetry(
            () => api.createElement(documentId, pageNumber, apiElement),
            {
              onAttemptFailed: (attempt, err) =>
                clientLogger.warn(
                  `[API] createElement attempt ${attempt} failed:`,
                  err,
                ),
            },
          );
          clientLogger.debug("[API] Element created in backend:", element.elementId);
        } catch (error) {
          clientLogger.error(
            "[API] createElement failed after retries — element will be persisted via PDF bake only:",
            error,
          );
        }
      }

      // Sauvegarder le PDF vers S3 (debounced: batch ajouts rapprochés)
      saveWithPriority("debounced");
    },
    [setDirty, saveWithPriority, documentId, storedDocumentId, currentPageIndex, queueAdd, addElementToPage, currentPage, selectElements]
  );

  const handleElementModified = useCallback(
    async (element: Element, oldBounds?: Element["bounds"]) => {
      clientLogger.debug("[editor] Element modified:", element);
      setDirty(true);
      const pageNumber = currentPageIndex + 1;

      // Mirror the update into the local scene graph (properties panel
      // reads from there, not from Fabric).
      updateElementInPage(element.elementId, element);

      // COHÉRENCE MULTI-WIDGETS : un champ AcroForm porte UNE valeur partagée
      // par tous ses widgets (le même champ répété p1/p2, les paires Oui/non).
      // Après l'édition d'un widget, propager la valeur aux éléments JUMEAUX
      // du scene graph (même fieldName, toutes pages) pour que le widget p2
      // reflète la saisie p1 — et re-rendre leurs objets Fabric quand ils sont
      // montés sur la page active (les jumeaux checkables de la même page sont
      // déjà tenus cohérents par le toggle du canvas ; ce re-render est
      // idempotent). Pas de queueUpdate pour les jumeaux : le bake ne remplit
      // le champ qu'UNE fois par nom.
      if (element.type === "form_field" && element.fieldName) {
        for (const page of pages) {
          for (const sibling of page.elements) {
            if (sibling.type !== "form_field") continue;
            if (sibling.fieldName !== element.fieldName) continue;
            if (sibling.elementId === element.elementId) continue;
            if (sibling.value === element.value) continue;
            const synced = { ...sibling, value: element.value };
            updateElementInPage(sibling.elementId, synced);
            if (page.pageId === effectivePage?.pageId) {
              canvasHandle?.applyLocalElementUpdate(synced);
            }
          }
        }
      }

      // Queue update with the TRUE oldBounds (tracked by editor-canvas
      // before the modification). Without this, apply-elements clears
      // the new bounds region and the original PDF glyph stays visible
      // (texte dupliqué post-bake). Fallback to element.bounds only if
      // tracking missed (very first modification of a freshly-loaded
      // element with no init).
      queueUpdate(pageNumber, element, oldBounds ?? element.bounds);

      // Émettre via WebSocket pour la collaboration
      emitElementUpdate(element.elementId, element);

      // Mettre à jour l'élément dans le backend avec retry exponentiel.
      //
      // Note: parsed-only elements (read straight from the PDF, never
      // persisted Redis-side) return 404 here. That's expected and
      // non-fatal — the change still persists via the PDF bake on save.
      // The retry helper short-circuits 404 thanks to the .status attached
      // by api.request, and the catch logs at debug level for that case so
      // the console stays readable.
      if (documentId) {
        const updates = convertToApiElement(element);
        try {
          await withRetry(
            () => api.updateElement(documentId, element.elementId, updates),
            {
              onAttemptFailed: (attempt, err) => {
                const status = (err as { status?: number })?.status;
                if (status === 404) return; // expected for parsed elements
                clientLogger.warn(
                  `[API] updateElement attempt ${attempt} failed:`,
                  err,
                );
              },
            },
          );
          clientLogger.debug("[API] Element updated in backend:", element.elementId);
        } catch (error) {
          const status = (error as { status?: number })?.status;
          if (status === 404) {
            clientLogger.debug(
              "[API] updateElement: parsed element not in Redis — will persist via PDF bake",
              element.elementId,
            );
          } else {
            clientLogger.error(
              "[API] updateElement failed after retries — change will persist via PDF bake:",
              error,
            );
          }
        }
      }

      // Sauvegarde debounced vers S3
      saveWithPriority("debounced");
    },
    [setDirty, emitElementUpdate, saveWithPriority, documentId, currentPageIndex, queueUpdate, updateElementInPage, pages, effectivePage, canvasHandle]
  );

  // Z-order change (bringToFront / sendToBack): queue a `reorder` op so the new
  // stacking is baked into the PDF binary (engine `reorderElement`) on save, in
  // addition to the scene-graph order reflected by handleElementModified. The
  // editor-canvas calls BOTH callbacks, so the live scene graph + the persisted
  // PDF stay consistent.
  const handleElementReordered = useCallback(
    (element: Element, toFront: boolean) => {
      clientLogger.debug("[editor] Element reordered:", element.elementId, { toFront });
      setDirty(true);
      const pageNumber = currentPageIndex + 1;
      queueReorder(pageNumber, element, toFront);
      saveWithPriority("debounced");
    },
    [setDirty, currentPageIndex, queueReorder, saveWithPriority]
  );

  const handleElementRemoved = useCallback(
    async (elementId: string) => {
      clientLogger.debug("[editor] Element removed:", elementId);
      setDirty(true);
      deselectElement(elementId);
      const pageNumber = currentPageIndex + 1;

      // Best-effort bounds lookup before the element is gone. Thread the
      // engine run index (present on parsed text runs in the scene graph) so
      // apply-operations can fire the TRUE in-place removeElement instead of
      // redact+add. Undefined for added/non-text elements — the engine then
      // falls back to redact+add on its own.
      const removed = currentPage?.elements.find((e) => e.elementId === elementId);
      if (removed) {
        const removedIndex = (removed as { index?: number }).index;
        queueDelete(pageNumber, elementId as UUID, removed.bounds, removedIndex);
      }

      // Mirror the removal in the local scene graph so the Properties
      // panel + selection shrink accordingly.
      removeElementFromPage(elementId);

      // Émettre via WebSocket pour la collaboration
      emitElementDelete(elementId);

      // Supprimer l'élément du backend avec retry exponentiel
      if (documentId) {
        try {
          await withRetry(
            () => api.deleteElement(documentId, elementId),
            {
              onAttemptFailed: (attempt, err) =>
                clientLogger.warn(
                  `[API] deleteElement attempt ${attempt} failed:`,
                  err,
                ),
            },
          );
          clientLogger.debug("[API] Element deleted from backend:", elementId);
        } catch (error) {
          clientLogger.error(
            "[API] deleteElement failed after retries — deletion will persist via PDF bake:",
            error,
          );
        }
      }

      // Sauvegarder le PDF vers S3
      saveWithPriority("debounced");
    },
    [setDirty, emitElementDelete, saveWithPriority, documentId, deselectElement, currentPageIndex, currentPage, queueDelete, removeElementFromPage]
  );

  // Gérer le mouvement du curseur pour la collaboration
  const handleMouseMove = useCallback(
    (event: React.MouseEvent) => {
      if (!canvasRef.current || !currentPage) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const x = (event.clientX - rect.left) / zoom;
      const y = (event.clientY - rect.top) / zoom;
      sendCursorPosition({ x, y }, currentPage.pageId);
    },
    [zoom, currentPage, sendCursorPosition]
  );

  const handleSelectionChanged = useCallback(
    (elementIds: string[]) => {
      if (elementIds.length === 0) {
        clearSelection();
      } else if (effectivePage) {
        // Tag the selection with the page the editable canvas actually shows
        // (= effectivePage: the focused page in continuous mode, currentPage in
        // single mode). Using currentPage here was wrong in continuous mode when
        // useDocument's pointer hadn't caught up to the just-focused page yet —
        // the selection got the previous page's id, desyncing the store's
        // selectedPageId from the displayed page. effectivePage drives
        // selectedElements too, so the two stay consistent.
        selectElements(elementIds, effectivePage.pageId);
        // Mode Remplir : le focus de la ligne du FormsPanel suit la sélection
        // CANVAS (l'overlay de surlignage est purement visuel désormais).
        const selected = effectivePage.elements.find(
          (el) => el.elementId === elementIds[0],
        );
        if (selected?.type === "form_field") {
          setFocusedFormField(selected.fieldName);
        }
      }
    },
    [effectivePage, selectElements, clearSelection]
  );

  // Word-like partial formatting: the canvas reports the live style of the
  // character sub-selection being edited (or null on caret-only / edit exit).
  const handleTextSelectionStyleChanged = useCallback(
    (style: Partial<TextStyle> | null) => {
      setTextSelectionStyle(style);
    },
    [],
  );

  // Apply a style patch to the active text edit SUB-SELECTION (Word-like
  // partial formatting). Returns true when a sub-range was styled (the toolbar
  // then skips the whole-element path); false when no text is being edited with
  // a selection, so the caller falls back to `handleTextStyleChange`.
  const applyTextSelectionStyle = useCallback(
    (patch: Partial<TextStyle>): boolean => {
      const applied = canvasHandle?.applySelectionStyle(patch) ?? false;
      if (applied) {
        setDirty(true);
        // Partial restyle bakes via the element's `runs` on edit-exit forward,
        // same debounced save path as the whole-element style change.
        saveWithPriority("debounced");
      }
      return applied;
    },
    [canvasHandle, setDirty, saveWithPriority],
  );

  const handleElementUpdate = useCallback(
    async (elementId: string, updates: Partial<Element>) => {
      clientLogger.debug("[editor] Element update:", elementId, updates);
      setDirty(true);

      // PARTIE 3 — resync visuel panel→canvas. Historiquement ce handler ne
      // touchait QUE le backend (websocket + api.updateElement + save) : ni
      // le scene graph local ni le canvas Fabric n'étaient mis à jour, donc
      // les éditions du panneau propriétés (single ET batch) n'étaient
      // visibles qu'au reload. Fix : merge shallow dans le scene graph
      // (même sémantique que le handler remote) PUIS ré-application sur le
      // canvas via applyLocalElementUpdate — la variante SANS garde de
      // sélection (les éléments du panel SONT sélectionnés) qui restaure la
      // sélection après le retire/re-crée.
      const ownerPage = pages.find((p) =>
        p.elements.some((e) => e.elementId === elementId),
      );
      const existing = ownerPage?.elements.find(
        (e) => e.elementId === elementId,
      );
      if (ownerPage && existing) {
        const merged = {
          ...existing,
          ...updates,
          elementId: existing.elementId,
        } as Element;
        updateElementInPage(elementId, merged);
        if (pages.indexOf(ownerPage) === currentPageIndex) {
          canvasHandle?.applyLocalElementUpdate(merged);
        }
        // Bake the panel edit into the PDF binary via the operations queue.
        // Panel edits don't go through the Fabric object:modified path
        // (applyLocalElementUpdate suppresses events), so they must be queued
        // explicitly. A content-only change (the text textarea) takes the
        // engine in-place replaceText path (the element carries its run
        // index); a style change falls back to redact+add over the original
        // bounds. queueUpdate coalesces repeated edits to the same element.
        queueUpdate(pages.indexOf(ownerPage) + 1, merged, existing.bounds);
      }

      // Émettre via WebSocket pour la collaboration
      emitElementUpdate(elementId, updates as Element);

      // Mettre à jour l'élément dans le backend
      if (documentId) {
        try {
          // Convert only the provided updates to API format
          const apiUpdates: Partial<ElementCreateRequest> = {};
          if (updates.bounds) {
            apiUpdates.bounds = {
              x: updates.bounds.x,
              y: updates.bounds.y,
              width: updates.bounds.width,
              height: updates.bounds.height,
            };
          }
          if (updates.transform) {
            apiUpdates.transform = updates.transform;
          }
          // Check for content property (exists on text, annotation elements)
          if ("content" in updates && updates.content !== undefined) {
            apiUpdates.content = updates.content as string;
          }
          // Check for style property
          if ("style" in updates && updates.style) {
            apiUpdates.style = updates.style as unknown as Record<string, unknown>;
          }
          await withRetry(
            () => api.updateElement(documentId, elementId, apiUpdates),
            {
              onAttemptFailed: (attempt, err) =>
                clientLogger.warn(
                  `[API] updateElement (panel) attempt ${attempt} failed:`,
                  err,
                ),
            },
          );
          clientLogger.debug("[API] Element updated in backend:", elementId);
        } catch (error) {
          clientLogger.error(
            "[API] updateElement (panel) failed after retries — change will persist via PDF bake:",
            error,
          );
        }
      }

      // Modification via panel propriétés → sauvegarde debounced vers S3
      saveWithPriority("debounced");
    },
    [
      setDirty,
      emitElementUpdate,
      saveWithPriority,
      documentId,
      pages,
      currentPageIndex,
      updateElementInPage,
      canvasHandle,
      queueUpdate,
    ]
  );

  // === P7 — Presse-papiers (copier / couper / coller) =====================
  // Presse-papiers applicatif (mémoire React, pas l'OS). Copier/couper stocke
  // des snapshots des éléments sélectionnés ; coller clone avec offset et
  // ré-injecte via handleElementAdded (scene graph + queue apply-elements +
  // bake S3). Coller crée une NOUVELLE copie sélectionnée.
  const handleCopy = useCallback(() => {
    if (selectedElements.length === 0) {
      toast({ title: t("editTools.toasts.nothingSelected") });
      return;
    }
    // Snapshot détaché (deep clone) pour que des éditions ultérieures de la
    // source ne « contaminent » pas le presse-papiers.
    const snapshot = selectedElements.map(
      (el) => JSON.parse(JSON.stringify(el)) as Element,
    );
    setClipboard(snapshot);
    toast({
      title: t("editTools.toasts.copied", { count: snapshot.length }),
    });
  }, [selectedElements, toast, t]);

  const handleCut = useCallback(() => {
    if (selectedElements.length === 0) {
      toast({ title: t("editTools.toasts.nothingSelected") });
      return;
    }
    const snapshot = selectedElements.map(
      (el) => JSON.parse(JSON.stringify(el)) as Element,
    );
    setClipboard(snapshot);
    // Supprime via le flux d'édition existant (queueDelete + bake).
    for (const el of snapshot) {
      void handleElementRemoved(el.elementId);
    }
    toast({ title: t("editTools.toasts.cut", { count: snapshot.length }) });
  }, [selectedElements, handleElementRemoved, toast, t]);

  const handlePaste = useCallback(() => {
    if (clipboard.length === 0) {
      toast({ title: t("editTools.toasts.nothingToPaste") });
      return;
    }
    // Clone avec offset (fresh elementId, index moteur retiré) ; chaque clone
    // passe par handleElementAdded comme un élément utilisateur neuf.
    const clones = clonePastedElements(clipboard);
    for (const clone of clones) {
      void handleElementAdded(clone);
    }
    // handleElementAdded auto-sélectionne le dernier ; pour un coller multiple
    // on sélectionne l'ensemble des nouveaux éléments.
    if (currentPage && clones.length > 1) {
      selectElements(
        clones.map((c) => c.elementId),
        currentPage.pageId,
      );
    }
    toast({ title: t("editTools.toasts.pasted", { count: clones.length }) });
  }, [clipboard, handleElementAdded, currentPage, selectElements, toast, t]);

  // === P7 — Format painter (copier la mise en forme) ======================
  // Deux temps : (1) un seul élément texte sélectionné → ramasse son style
  // peignable. (2) Réarmé : applique le style copié à toutes les sélections
  // texte courantes via handleElementUpdate, puis désarme.
  const handleApplyCopiedFormat = useCallback(
    (paint: PaintableTextStyle) => {
      const targets = selectedElements.filter((el) => el.type === "text");
      if (targets.length === 0) {
        toast({ title: t("editTools.toasts.formatNoTarget") });
        return;
      }
      let applied = 0;
      for (const target of targets) {
        const nextStyle = applyPaintableStyle(target, paint);
        if (!nextStyle) continue;
        handleElementUpdate(target.elementId, {
          style: nextStyle,
        } as Partial<Element>);
        applied += 1;
      }
      toast({
        title: t("editTools.toasts.formatApplied", { count: applied }),
      });
    },
    [selectedElements, handleElementUpdate, toast, t],
  );

  const handleCopyFormat = useCallback(() => {
    // Réarmé → on applique puis on désarme.
    if (copiedFormat) {
      handleApplyCopiedFormat(copiedFormat);
      setCopiedFormat(null);
      return;
    }
    // Sinon → on ramasse le style de l'unique élément texte sélectionné.
    const source = selectedElements.length === 1 ? selectedElements[0] : null;
    const paint = source ? extractPaintableStyle(source) : null;
    if (!paint) {
      toast({ title: t("editTools.toasts.formatNotText") });
      return;
    }
    setCopiedFormat(paint);
    toast({ title: t("editTools.toasts.formatCopied") });
  }, [copiedFormat, handleApplyCopiedFormat, selectedElements, toast, t]);

  // === P7 — Rechercher / Remplacer ========================================
  // Navigation : va à la page de l'occurrence et sélectionne l'élément (le
  // panneau propriétés suit + l'élément est mis en évidence sur le canvas).
  const handleFindReplaceGoTo = useCallback(
    (occurrence: FindOccurrence) => {
      if (occurrence.pageIndex !== currentPageIndex) {
        goToPage(occurrence.pageIndex);
      }
      const targetPage = pages[occurrence.pageIndex];
      if (targetPage) {
        selectElements([occurrence.elementId], targetPage.pageId);
      }
    },
    [currentPageIndex, goToPage, pages, selectElements],
  );

  // Remplacer une occurrence : applique le nouveau contenu via le flux
  // d'édition existant (replaceText au bake).
  const handleReplaceOne = useCallback(
    (occurrence: FindOccurrence, newContent: string) => {
      handleElementUpdate(occurrence.elementId, {
        content: newContent,
      } as Partial<Element>);
      toast({ title: t("editTools.toasts.replacedOne") });
    },
    [handleElementUpdate, toast, t],
  );

  // Tout remplacer : un update par élément modifié.
  const handleReplaceAll = useCallback(
    (edits: { elementId: string; content: string }[]) => {
      for (const edit of edits) {
        handleElementUpdate(edit.elementId, {
          content: edit.content,
        } as Partial<Element>);
      }
      toast({
        title: t("editTools.toasts.replacedAll", { count: edits.length }),
      });
    },
    [handleElementUpdate, toast, t],
  );

  const handleFormatAction = useCallback(
    (action: ToolbarFormatAction) => {
      clientLogger.debug("[editor] Format action:", action);
      // Applique le formatage aux éléments texte sélectionnés sur le canvas.
      // Le canvas émet ensuite onElementModified pour chaque élément touché,
      // ce qui queue l'op apply-elements et synchronise le scene graph.
      canvasHandle?.applyTextFormat(TOOLBAR_FORMAT_TO_TEXT_FORMAT[action]);
      setDirty(true);
      // Modification de style → sauvegarde debounced vers S3
      saveWithPriority("debounced");
    },
    [canvasHandle, setDirty, saveWithPriority]
  );

  // Word-like formatting bar → patch a single text style field. The bar emits
  // PARTIAL TextStyle patches (e.g. { fontWeight: "bold" }), so merge them into
  // the element's current style before handing off to handleElementUpdate
  // (which would otherwise shallow-replace the whole style object). Reuses the
  // existing canvas + bake + persist pipeline — no new save path.
  const handleTextStyleChange = useCallback(
    (elementId: string, style: Partial<TextStyle>) => {
      const ownerPage = pages.find((p) =>
        p.elements.some((e) => e.elementId === elementId),
      );
      const existing = ownerPage?.elements.find(
        (e) => e.elementId === elementId,
      ) as TextElement | undefined;
      if (!existing) return;

      // PARAGRAPH-level formatting (alignment, left indent, line spacing) and
      // LIST level/marker/ordered are structural properties: bake them natively
      // through the engine's model (`setParagraphStyle` / `setList*` keyed by
      // the run's `source_index`) instead of the flat redact+add path. The baker
      // returns false (and we fall through to the flat path) when the element
      // isn't model-addressable or the bake fails, so the formatting always
      // persists. Character-level fields (bold/italic/colour/…) and the list
      // TOGGLE (no structural op) keep using the flat path.
      const split = splitTextStylePatch(style);
      if (split.bakeable && bakeParagraphStyleRef.current) {
        void bakeParagraphStyleRef.current(existing, style).then((baked) => {
          if (!baked) {
            handleElementUpdate(elementId, {
              style: { ...existing.style, ...style },
            } as Partial<Element>);
          }
        });
        return;
      }

      handleElementUpdate(elementId, {
        style: { ...existing.style, ...style },
      } as Partial<Element>);
    },
    [pages, handleElementUpdate],
  );

  const handleExport = useCallback(async () => {
    if (!currentPdfFile) {
      // Fall back to server download if no local PDF
      if (documentId) {
        window.open(api.getDocumentDownloadUrl(documentId), "_blank");
      }
      return;
    }

    try {
      let fileToExport: File | Blob = currentPdfFile;

      // 1. Apply pending canvas operations (text/shape/image overlays) so
      //    the binary contains the final scene-graph state, not just the
      //    parsed original.
      const canvasElements = currentPage?.elements ?? [];
      const canvasOps = canvasElements.map((el) => ({
        action: 'add' as const,
        pageNumber: currentPageIndex + 1,
        element: el as unknown as Record<string, unknown>,
      }));
      const allOperations = [...canvasOps, ...contentModifications.map((mod) => ({
        ...mod,
        pageNumber: mod.pageNumber + 1, // content-edit-layer uses 0-indexed, API uses 1-indexed
      }))];

      if (allOperations.length > 0) {
        const modifiedBlob = await applyElements.mutateAsync({
          file: fileToExport,
          operations: allOperations,
        });
        fileToExport = modifiedBlob;
      }

      // 2. Flatten before export: bakes form fields + annotations into the
      //    page content so the exported PDF is self-contained. Avoids the
      //    "doublon d'élément" issue when interactive widgets, native PDF
      //    annotations and freshly baked overlays would otherwise coexist
      //    in the downloaded file.
      const blobToFlatten =
        fileToExport instanceof Blob ? fileToExport : new Blob([fileToExport]);
      const fileForFlatten = new File(
        [blobToFlatten],
        `${name || 'document'}.pdf`,
        { type: 'application/pdf' },
      );
      const flattenedBlob = await flattenPdf.mutateAsync({ file: fileForFlatten });

      downloadBlob(flattenedBlob, `${name || 'document'}.pdf`);
    } catch (err) {
      clientLogger.error('[editor] Export failed:', err);
      // Fall back to server download
      if (documentId) {
        window.open(api.getDocumentDownloadUrl(documentId), "_blank");
      }
    }
  }, [currentPdfFile, currentPage, currentPageIndex, contentModifications, applyElements, flattenPdf, name, documentId]);

  // Restore the document to its original (v1) PDF binary by asking the
  // backend to copy v1 forward as a new current version. This is the
  // canonical way to wipe duplicates accumulated by pre-3e13c33 saves
  // (Fabric IText overlays baked into the PDF on top of native glyphs).
  // The intermediate versions stay in version history — restore is non-
  // destructive. After the call we navigate the user to the same editor
  // route, which triggers a fresh /load that picks up the new current
  // version and re-parses the scene graph from scratch.
  const [restoring, setRestoring] = useState(false);
  const handleRestoreOriginal = useCallback(async () => {
    if (!storedDocumentId) {
      clientLogger.warn("[editor] Restore-original requires a storedDocumentId");
      return;
    }
    if (
      !confirm(
        "Restaurer la version originale (v1) du document ? " +
          "Vos modifications actuelles seront archivées dans l'historique " +
          "des versions et le document repartira de l'état d'origine."
      )
    ) {
      return;
    }
    setRestoring(true);
    try {
      const result = await api.restoreOriginalDocument(storedDocumentId);
      clientLogger.info("[editor] Document restored to v1:", result);
      // Hard reload so /load is called fresh against the new current
      // version. Soft router.refresh() would keep the in-memory session
      // PDF and elements stale.
      window.location.reload();
    } catch (err) {
      clientLogger.error("[editor] Restore-original failed:", err);
      toast({
        variant: "destructive",
        title: t("error.restoreFailed"),
      });
      setRestoring(false);
    }
  }, [storedDocumentId, toast, t]);

  const handleFlattenPdf = async () => {
    if (!currentPdfFile) return;
    try {
      const blob = await flattenPdf.mutateAsync({ file: currentPdfFile });
      downloadBlob(blob, "flattened.pdf");
    } catch (error) {
      clientLogger.error("[editor] Flatten failed:", error);
    }
  };

  // Export Office (DOCX/PPTX via libreoffice headless, XLSX via extraction custom).
  // Sauvegarde d'abord le document courant pour exporter l'état le plus récent
  // côté serveur, puis appelle /api/office/export qui retourne le binaire Office.
  const [exportingOfficeFormat, setExportingOfficeFormat] = useState<
    "docx" | "xlsx" | "pptx" | null
  >(null);
  // Backend (Celery) export for raster/text/html formats — png/jpeg/webp/txt/html.
  const [exportingFormat, setExportingFormat] = useState<
    "png" | "jpeg" | "webp" | "txt" | "html" | null
  >(null);
  // Universal export via the GigaPDF SDK (#84) — lowers the CURRENT document
  // (currentPdfFile, the WYSIWYG source of truth) into any editable office /
  // OpenDocument / web format, 100% client-side. Independent of the two
  // server-side export paths above; null when no SDK export is running.
  const [exportingModelFormat, setExportingModelFormat] =
    useState<ExportFormat | null>(null);
  const handleExportOffice = useCallback(
    async (format: "docx" | "xlsx" | "pptx") => {
      if (!documentId || exportingOfficeFormat) return;
      setExportingOfficeFormat(format);
      try {
        // Garantit que la version exportée reflète l'état courant
        if (isDirty) await save();
        const token = await getAuthToken();
        const res = await fetch("/api/office/export", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ documentId, format }),
        });
        if (!res.ok) {
          throw new Error(`Export ${format} failed: HTTP ${res.status}`);
        }
        const blob = await res.blob();
        // Filename depuis Content-Disposition si présent, sinon fallback
        const cd = res.headers.get("Content-Disposition") ?? "";
        const cdMatch = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
        const filename = cdMatch?.[1]
          ? decodeURIComponent(cdMatch[1].replace(/"/g, ""))
          : `document.${format}`;
        downloadBlob(blob, filename);
      } catch (err) {
        clientLogger.error(`[editor] Office export ${format} failed:`, err);
      } finally {
        setExportingOfficeFormat(null);
      }
    },
    [documentId, exportingOfficeFormat, isDirty, save],
  );

  // Export via the backend (Celery) pipeline for raster/text/html formats.
  // Image / text / html export, entirely client-side from the CURRENT document
  // (currentPdfFileRef — the WYSIWYG source of truth, cf. pdf-libraries rule), so
  // the result reflects unsaved edits with no backend job. Images come back as a
  // .zip of per-page files; txt/html as their own file. Persists to the server
  // first (best-effort) so the stored copy stays in sync, but the export reads
  // the local bytes regardless.
  const handleExportFormat = useCallback(
    async (format: "png" | "jpeg" | "webp" | "txt" | "html") => {
      const file = currentPdfFileRef.current;
      if (!file || exportingFormat) return;
      setExportingFormat(format);
      try {
        if (isDirty) await save();
        const bytes = new Uint8Array(await file.arrayBuffer());
        let blob: Blob;
        let ext: string;
        if (format === "png" || format === "jpeg" || format === "webp") {
          blob = await exportPagesAsImages(bytes, format, {
            dpi: 150,
            quality: 85,
          });
          ext = "zip";
        } else if (format === "txt") {
          const text = await extractDocumentText(bytes);
          blob = new Blob([text], { type: "text/plain;charset=utf-8" });
          ext = "txt";
        } else {
          blob = await exportDocumentAs(bytes, "html");
          ext = "html";
        }
        downloadBlob(blob, `${name || "document"}.${ext}`);
        toast({ title: t("office.exportSuccess") });
      } catch (err) {
        clientLogger.error(`[editor] export ${format} failed:`, err);
        toast({ title: t("office.exportError"), variant: "destructive" });
      } finally {
        setExportingFormat(null);
      }
    },
    [exportingFormat, isDirty, save, name, toast, t],
  );

  // Universal export (#84): lower the CURRENT document into any editable
  // format (docx/xlsx/pptx/odt/ods/odp/html/rtf/pdf) via the GigaPDF SDK,
  // entirely client-side. Exports from currentPdfFileRef — the WYSIWYG source
  // of truth (cf. pdf-libraries rule) — so the result reflects unsaved edits
  // without a server round-trip. Read-only: never touches the scene graph.
  const handleExportModel = useCallback(
    async (format: ExportFormat) => {
      const file = currentPdfFileRef.current;
      if (!file || exportingModelFormat) return;
      setExportingModelFormat(format);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const blob = await exportDocumentAs(bytes, format);
        downloadBlob(blob, exportFilename(name || file.name, format));
        toast({
          title: t("office.exportSuccess"),
        });
      } catch (err) {
        clientLogger.error(`[editor] SDK export ${format} failed:`, err);
        toast({
          title: t("office.exportError"),
          variant: "destructive",
        });
      } finally {
        setExportingModelFormat(null);
      }
    },
    [exportingModelFormat, name, toast, t],
  );

  // Re-parse the PDF binary to refresh the scene graph after a page op.
  // After rotate/add/delete/move, the text items keep their original
  // coordinates in the parse output — but the page dimensions / rotation
  // flag have changed, so the canvas lays everything out wrong. Calling
  // /api/pdf/parse with the fresh binary returns new bounds that match
  // the new geometry, fixing the 'text piled up' symptom.
  const reparseFromFile = useCallback(
    async (file: File): Promise<void> => {
      try {
        const { getAuthToken } = await import('@/lib/api');
        const token = await getAuthToken();
        const form = new FormData();
        form.append('file', file, file.name);
        // Request the native engine's structural block grouping so
        // `page.blockGroups` survives every re-parse (rotate, apply-elements,
        // watermark, …) — same grouping the initial /api/pdf/parse-from-s3
        // load attaches. Without it, the first page op of a session silently
        // dropped the paragraph grouping (heuristic fallback) until reload.
        form.append('blockGroups', 'true');
        const res = await fetch('/api/pdf/parse', {
          method: 'POST',
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          body: form,
        });
        if (!res.ok) {
          clientLogger.warn('[editor] re-parse failed:', res.status);
          return;
        }
        const json = (await res.json()) as { success: boolean; data?: { pages?: unknown[] } };
        const pages = json?.data?.pages;
        if (Array.isArray(pages)) {
          replacePages(pages as PageObject[]);
        }
      } catch (err) {
        clientLogger.error('[editor] re-parse threw:', err);
      }
    },
    [replacePages],
  );

  // Shared post-processing for any operation that produced a full
  // replacement PDF binary (page ops, watermark, …): swap the in-memory
  // binary, mark the document dirty, trigger an immediate save, and
  // (optionally) re-parse so the scene graph matches the new layout.
  //
  // When `reparse` is true (default), the PDF is re-parsed after the op so
  // the scene graph reflects the new layout. Set to false for ops that
  // don't change element coordinates.
  const adoptModifiedPdf = useCallback(
    (blob: Blob, opts: { reparse?: boolean } = {}): File | null => {
      const file = currentPdfFileRef.current;
      if (!file) return null;
      const newFile = new File([blob], file.name, {
        type: 'application/pdf',
      });
      updateCurrentPdfFile(newFile);
      setDirty(true);
      saveWithPriority('immediate');
      // Refresh the scene graph from the new binary so the canvas
      // re-renders text items at the correct new bounds.
      if (opts.reparse !== false) {
        void reparseFromFile(newFile);
      }
      return newFile;
    },
    [setDirty, saveWithPriority, updateCurrentPdfFile, reparseFromFile],
  );

  // ── Native paragraph/list-format bake (the flat-index ↔ BlockAddr bridge) ──
  //
  // Word-like paragraph formatting (alignment, left indent, line spacing) and
  // list level/marker/ordered are PARAGRAPH-level properties, not per-run
  // geometric ones, so they bake cleanly via the engine's structural model
  // rather than the flat redact+add path. The editor already carries each run's
  // `source_index` on `TextElement.index`; the server resolves it to a
  // `[section, page, index]` block address and applies `setParagraphStyle` /
  // `setList*` model ops. We then adopt the re-rendered PDF (with re-parse) so
  // the reopened document reflects the change — a real structural bake + reload,
  // not an overlay.
  //
  // `style` is the partial TextStyle patch the toolbar/panel emits;
  // `splitTextStylePatch` maps its paragraph + list parts to engine edits. The
  // list TOGGLE (creating/removing a list) and character-level fields are not
  // structurally bakeable and are excluded by the split, so they never reach
  // here.
  //
  // Returns true when the native bake ran; false when the element is not
  // model-addressable (no/sentinel `index`), the patch had nothing structural,
  // or the bake failed — the caller then falls back to the flat style path.
  // Never throws.
  const bakeParagraphStyle = useCallback(
    async (
      element: TextElement,
      style: Partial<TextStyle>,
    ): Promise<boolean> => {
      // Only runs surfaced by the per-run extractor carry a usable engine
      // index; a missing or sentinel (`< 0`) index is a coalesced/Form-XObject
      // run the model can't address — let the flat path handle it.
      const sourceIndex = element.index;
      if (typeof sourceIndex !== "number" || sourceIndex < 0) return false;

      const split = splitTextStylePatch(style);
      const paragraphs: ParagraphStyleEdit[] = split.paragraphPatch
        ? [{ sourceIndex, patch: split.paragraphPatch }]
        : [];
      // A present list value bakes its family + level; a removal toggle yields
      // [] (no structural op) and stays on the flat decoration path.
      const lists: ListEdit[] = buildListEdits(sourceIndex, split.listValue);
      // Nothing structural to bake (e.g. a list-removal toggle slipped through)
      // — defer to the flat path.
      if (paragraphs.length === 0 && lists.length === 0) return false;

      // Optimistic UI: reflect the (whole) style patch in the scene graph +
      // canvas now, then bake structurally. The subsequent re-parse rebuilds the
      // scene graph from the baked bytes, so this is purely for instant feedback.
      const ownerPage = pages.find((p) =>
        p.elements.some((e) => e.elementId === element.elementId),
      );
      if (ownerPage) {
        const existing = ownerPage.elements.find(
          (e) => e.elementId === element.elementId,
        ) as TextElement | undefined;
        if (existing) {
          const merged = {
            ...existing,
            style: { ...existing.style, ...style },
          } as TextElement;
          updateElementInPage(element.elementId, merged);
          if (pages.indexOf(ownerPage) === currentPageIndex) {
            canvasHandle?.applyLocalElementUpdate(merged);
          }
        }
      }
      setDirty(true);

      try {
        // Flush any pending flat element ops first so the model-op bake runs on
        // a binary that already contains the user's other edits (getPreparedBlob
        // applies + swaps currentPdfFile, returning the up-to-date bytes).
        const base = await getPreparedBlob();
        const file = base ?? currentPdfFileRef.current;
        if (!file) return false;

        const modified = await applyModelOps.mutateAsync({
          file,
          edits: { paragraphs, lists },
        });
        const blob =
          modified instanceof Blob ? modified : new Blob([modified as BlobPart]);
        // Adopt + re-parse: modelToPdf reconstructs the page, so run indices
        // change — the scene graph must be rebuilt from the new bytes.
        adoptModifiedPdf(blob, { reparse: true });
        return true;
      } catch (err) {
        clientLogger.error("[editor] paragraph-format bake failed:", err);
        // Fall back to the flat style path so the formatting still persists.
        return false;
      }
    },
    [
      pages,
      currentPageIndex,
      updateElementInPage,
      canvasHandle,
      setDirty,
      getPreparedBlob,
      applyModelOps,
      adoptModifiedPdf,
    ],
  );

  // Bind the late-constructed baker so `handleTextStyleChange` (declared earlier)
  // can invoke it without a temporal-dead-zone on `adoptModifiedPdf`.
  useEffect(() => {
    bakeParagraphStyleRef.current = bakeParagraphStyle;
  }, [bakeParagraphStyle]);

  // ── Table editing (add/remove rows & columns via the engine's model ops) ──
  //
  // The engine reconstructs tables into the unified model and surfaces them with
  // a positional handle (`pageNumber` + `tableIndexOnPage`) + grid size + frame.
  // The overlay draws a selectable box per table; an action resolves to a
  // structural model op and bakes through `applyModelOps` (tableOps), then the
  // page re-parses — a real model edit + reload. Tables are addressed
  // positionally because table CELL runs carry no `source_index` (so the flat
  // run-index path the text editor uses cannot reach them).
  const refreshTableStructure = useCallback(
    async (file: File | Blob | null) => {
      if (!file) {
        setDocumentTables([]);
        return;
      }
      try {
        const result = await tableStructure.mutateAsync({ file });
        setDocumentTables(result.tables);
      } catch (err) {
        // Non-fatal: the overlay simply shows no tables. Never blocks editing.
        clientLogger.error("[editor] table structure read failed:", err);
        setDocumentTables([]);
      }
    },
    [tableStructure],
  );

  // Refresh the detected tables whenever the binary changes (initial load + each
  // adopt). Keyed by the File identity so it re-runs on every swap; the async
  // refresh also clears the list when there is no file (no synchronous setState
  // in the effect body).
  useEffect(() => {
    void refreshTableStructure(currentPdfFile);
    // refreshTableStructure is stable for a given mutation hook instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPdfFile]);

  // Toggle the table-edit overlay; clear any selection when hiding it.
  const handleToggleTableEdit = useCallback(() => {
    setShowTableEdit((prev) => {
      if (prev) setSelectedTableIndex(null);
      return !prev;
    });
  }, []);

  // Tables on the active page, with their on-page index preserved for addressing.
  const currentPageTables = useMemo(() => {
    const pageNumber = effectivePageIndex + 1;
    return documentTables.filter((tbl) => tbl.pageNumber === pageNumber);
  }, [documentTables, effectivePageIndex]);

  // Map each cell run index (= TextElement.index) on the active page to its cell
  // location, so a clicked cell's text element resolves to (table, row, col).
  const sourceIndexToCell = useMemo(
    () => buildSourceIndexToCellMap(currentPageTables),
    [currentPageTables],
  );

  // The active cell = the cell of the single selected text element, when its
  // engine run index is a known table cell. Derived (no effect): drives precise
  // insertion + the table auto-selection below.
  const activeTableCell = useMemo(() => {
    if (!showTableEdit || selectedElements.length !== 1) return null;
    const el = selectedElements[0];
    if (!el || el.type !== "text") return null;
    const idx = (el as TextElement).index;
    if (typeof idx !== "number" || idx < 0) return null;
    return sourceIndexToCell.get(idx) ?? null;
  }, [showTableEdit, selectedElements, sourceIndexToCell]);

  // Clicking a cell's text auto-selects its table (so the toolbar appears) —
  // unless the user has explicitly selected a different table by its frame.
  useEffect(() => {
    if (activeTableCell && selectedTableIndex === null) {
      setSelectedTableIndex(activeTableCell.tableIndexOnPage);
    }
    // Only react to a newly-resolved cell; selectedTableIndex is read, not tracked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTableCell]);

  // Run an add/remove row/column action on the selected table: resolve the
  // action to a positional TableEdit, flush pending edits, bake, then adopt +
  // re-parse (which refreshes the table structure via the file-change effect).
  const handleTableEditAction = useCallback(
    async (tableIndexOnPage: number, action: TableEditAction) => {
      if (tableEditBusy) return;
      const pageNumber = effectivePageIndex + 1;
      const target = documentTables.find(
        (tbl) =>
          tbl.pageNumber === pageNumber &&
          tbl.tableIndexOnPage === tableIndexOnPage,
      );
      if (!target) return;

      // Precise positioning when the active cell belongs to THIS table; else the
      // action falls back to the table's edges.
      const activeCell =
        activeTableCell &&
        activeTableCell.tableIndexOnPage === tableIndexOnPage
          ? { row: activeTableCell.row, col: activeTableCell.col }
          : undefined;
      const edit = actionToTableEdit(
        {
          pageNumber,
          tableIndexOnPage,
          rowCount: target.rowCount,
          colCount: target.colCount,
          ...(activeCell ? { activeCell } : {}),
        },
        action,
      );
      if (!edit) return; // e.g. delete that would empty the table — no-op.

      setTableEditBusy(true);
      try {
        // Flush pending flat element ops first so the model-op bake runs on the
        // up-to-date binary (the source of truth, not S3).
        const base = await getPreparedBlob();
        const file = base ?? currentPdfFileRef.current;
        if (!file) return;

        const modified = await applyModelOps.mutateAsync({
          file,
          edits: { tableOps: [edit] },
        });
        const blob =
          modified instanceof Blob ? modified : new Blob([modified as BlobPart]);
        // Adopt + re-parse: modelToPdf reconstructs the page, so element bounds
        // change — the scene graph must be rebuilt from the new bytes. The file
        // swap also re-triggers the table-structure refresh.
        adoptModifiedPdf(blob, { reparse: true });
        toast({ title: t("tableEdit.toasts.applied") });
      } catch (err) {
        clientLogger.error("[editor] table edit bake failed:", err);
        toast({ title: t("tableEdit.toasts.failed") });
      } finally {
        setTableEditBusy(false);
      }
    },
    [
      tableEditBusy,
      effectivePageIndex,
      documentTables,
      activeTableCell,
      getPreparedBlob,
      applyModelOps,
      adoptModifiedPdf,
      toast,
      t,
    ],
  );

  // Run a STYLE action (cell shading, row height, column width, table border,
  // cell span) on the selected table. Same flush → bake → adopt + re-parse flow
  // as `handleTableEditAction`, but resolves a value-carrying `TableStyleAction`
  // to its positional `TableEdit` via `styleActionToTableEdit`.
  const handleTableStyleAction = useCallback(
    async (tableIndexOnPage: number, action: TableStyleAction) => {
      if (tableEditBusy) return;
      const pageNumber = effectivePageIndex + 1;
      const edit = styleActionToTableEdit(
        { pageNumber, tableIndexOnPage },
        action,
      );

      setTableEditBusy(true);
      try {
        // Flush pending flat element ops first so the bake runs on up-to-date bytes.
        const base = await getPreparedBlob();
        const file = base ?? currentPdfFileRef.current;
        if (!file) return;

        const modified = await applyModelOps.mutateAsync({
          file,
          edits: { tableOps: [edit] },
        });
        const blob =
          modified instanceof Blob ? modified : new Blob([modified as BlobPart]);
        adoptModifiedPdf(blob, { reparse: true });
        toast({ title: t("tableEdit.toasts.applied") });
      } catch (err) {
        clientLogger.error("[editor] table style bake failed:", err);
        toast({ title: t("tableEdit.toasts.failed") });
      } finally {
        setTableEditBusy(false);
      }
    },
    [
      tableEditBusy,
      effectivePageIndex,
      getPreparedBlob,
      applyModelOps,
      adoptModifiedPdf,
      toast,
      t,
    ],
  );

  // The table-edit overlay for the ACTIVE page, shared by the single-page editor
  // (`EditorCanvas` `overlay` prop) and the continuous view (`PageSlot`'s
  // `renderActiveOverlay`). Uses `effectivePage` so the geometry matches whichever
  // page is focused in either mode. Returns `null` when table editing is off.
  const renderTableEditOverlay = useCallback((): React.ReactNode => {
    if (!showTableEdit || !effectivePage) return null;
    return (
      <TableEditOverlay
        tables={currentPageTables}
        pageWidthPts={effectivePage.dimensions.width}
        pageHeightPts={effectivePage.dimensions.height}
        rotation={effectivePage.dimensions.rotation}
        zoom={zoom}
        selectedTableIndex={selectedTableIndex}
        activeCell={activeTableCell}
        onSelectTable={setSelectedTableIndex}
        onAction={handleTableEditAction}
        onStyleAction={handleTableStyleAction}
        busy={tableEditBusy}
      />
    );
  }, [
    showTableEdit,
    effectivePage,
    currentPageTables,
    zoom,
    selectedTableIndex,
    activeTableCell,
    handleTableEditAction,
    handleTableStyleAction,
    tableEditBusy,
  ]);

  // Shared helper: run a page-level op through /api/pdf/pages, swap the
  // binary in memory, and trigger an immediate save. Returns the new file
  // so callers can run extra local-state updates (duplicate/add/delete need
  // to mirror the scene graph) in the same tick.
  const runPageOperation = useCallback(
    async (
      operation: 'add' | 'copy' | 'rotate' | 'delete' | 'move' | 'resize',
      params: Record<string, unknown>,
      opts: { reparse?: boolean } = {},
    ): Promise<File | null> => {
      const file = currentPdfFileRef.current;
      if (!file) return null;
      try {
        const result = await pageOperation.mutateAsync({
          file,
          operation,
          params,
        });
        return adoptModifiedPdf(result as Blob, opts);
      } catch (err) {
        clientLogger.error(`[editor] ${operation} page failed:`, err);
        return null;
      }
    },
    [pageOperation, adoptModifiedPdf],
  );

  // ── Word-like per-page content margins (consolidated, pageId-keyed) ────────
  // Single source of truth for the draggable margin guides in BOTH views. Keyed
  // by the stable `pageId` so a dragged value survives page insert/delete/
  // reorder AND the binary swaps that text edits perform; derived below into a
  // page-aligned array fed to the single-page EditorCanvas and the continuous
  // ContinuousPageView. Margins are the CONTENT ZONE (guides + header/footer
  // position) — they never recrop the page, so committing one never blanks it.
  const [marginsByPageId, setMarginsByPageId] = useState<
    Record<string, PageMargins | null>
  >({});

  // Commit new content margins (PDF points) dropped from a ruler/guide drag.
  // Two independent moves:
  //   (a) Move the guides IMMEDIATELY by updating the consolidated state for the
  //       dragged page's stable pageId — instant, no re-parse, no blank.
  //   (b) PERSIST the margins into the document's editor-metadata sidecar (NOT
  //       the CropBox) so they survive a reload, then adopt the new bytes with
  //       `reparse: false`: the sidecar is not page geometry, so nothing blanks
  //       and the scene graph stays intact. `applyGuideDrag` only changes the
  //       dragged side, so `margins` already carries the other three unchanged.
  const handleMarginsCommit = useCallback(
    (pageIndex: number, margins: PageMargins) => {
      const page = pages[pageIndex];
      if (page) {
        setMarginsByPageId((prev) => ({ ...prev, [page.pageId]: margins }));
      }
      const file = currentPdfFileRef.current;
      if (!file) return;
      void (async () => {
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const next = await applyPageMargins(bytes, pageIndex, margins);
          // `next` is a fresh Uint8Array backed by its own ArrayBuffer. The
          // sidecar write changes no page geometry → adopt WITHOUT re-parsing.
          adoptModifiedPdf(new Blob([next], { type: "application/pdf" }), {
            reparse: false,
          });
        } catch (err) {
          clientLogger.error("[editor] set editor margins failed:", err);
          toast({
            title: t("rulers.marginErrorTitle"),
            description: t("rulers.marginErrorDescription"),
            variant: "destructive",
          });
        }
      })();
    },
    [pages, adoptModifiedPdf, toast, t],
  );

  // Seed / refresh the consolidated margins from the current binary's editor
  // sidecar (written by drags), falling back to the estimated CropBox inset for
  // legacy docs. Runs whenever the binary changes — the initial open (keyed by
  // documentId) seeds an empty map, later swaps refresh it. We MERGE preferring
  // any value already held for a pageId, so a just-dragged margin is never
  // clobbered by a subsequent text-edit binary swap; a new document brings new
  // pageIds, so nothing stale survives a document change (the rebuilt map only
  // carries the current pages' ids). Read off the bytes the editor already holds
  // (cheap: one short-lived doc on the loaded engine). Failure is non-fatal.
  useEffect(() => {
    if (!currentPdfFile) {
      setMarginsByPageId({});
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const bytes = new Uint8Array(await currentPdfFile.arrayBuffer());
        const read = await readAllPageMargins(bytes);
        if (cancelled) return;
        const ids = pagesRef.current.map((p) => p.pageId);
        setMarginsByPageId((prev) => {
          const next: Record<string, PageMargins | null> = {};
          ids.forEach((id, i) => {
            // Keep a dragged in-memory value; else adopt the freshly-read one.
            next[id] = id in prev ? (prev[id] ?? null) : (read[i] ?? null);
          });
          return next;
        });
      } catch (err) {
        clientLogger.warn("[editor] page margin read failed:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentPdfFile]);

  // Page-aligned margins for the views — the single-page EditorCanvas reads its
  // current page's entry, the continuous view receives the whole array. Aligned
  // to `pages` by index but resolved through the pageId-keyed map, so reorders
  // re-map automatically and dragged values follow their page.
  const pageMargins = useMemo<Array<PageMargins | null>>(
    () => pages.map((p) => marginsByPageId[p.pageId] ?? null),
    [pages, marginsByPageId],
  );

  // Bake a Word-style running header/footer onto the current PDF. The GigaPDF
  // engine draws the band text (with {{page}}/{{pages}} tokens) in the top/
  // bottom margin band, producing new bytes we adopt without re-parsing — the
  // band lives outside the page content, so the editable overlay is unchanged.
  const handleHeaderFooterApply = useCallback(
    (kind: HeaderFooterKind, spec: HeaderFooterSpec) => {
      const file = currentPdfFileRef.current;
      if (!file) return;
      void (async () => {
        setHeaderFooterBusy(true);
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const next = await applyHeaderFooter(bytes, kind, spec);
          adoptModifiedPdf(new Blob([next], { type: "application/pdf" }), {
            reparse: false,
          });
          toast({
            title: t("headersFooters.appliedTitle"),
            description: t("headersFooters.appliedDescription"),
          });
        } catch (err) {
          clientLogger.error("[editor] set header/footer failed:", err);
          toast({
            title: t("headersFooters.errorTitle"),
            description: t("headersFooters.errorDescription"),
            variant: "destructive",
          });
        } finally {
          setHeaderFooterBusy(false);
        }
      })();
    },
    [adoptModifiedPdf, toast, t],
  );

  // Apply presentation edits (page transitions / auto-advance, set or cleared
  // per page by the PresentationDialog) onto the live document. The dialog runs
  // in editor mode (onApply) and hands us the produced PDF bytes; we adopt them
  // in place. The dialog serves all of its tabs through onApply (transitions,
  // scale, portfolio, figure-alt); the `scale` tab changes page geometry, so we
  // re-parse to keep the Fabric overlay aligned with the new binary. (Transitions
  // alone wouldn't need it, but a single reparse keeps every tab correct.)
  const handleApplyPresentation = useCallback(
    async (bytes: Uint8Array) => {
      try {
        const adopted = adoptModifiedPdf(
          new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
          { reparse: true },
        );
        if (!adopted) return;
        toast({
          title: t("presentation.applied.title"),
          description: t("presentation.applied.description"),
        });
      } catch (err) {
        clientLogger.error("[editor] apply presentation failed:", err);
        toast({
          title: t("presentation.applied.errorTitle"),
          description: t("presentation.applied.errorDescription"),
          variant: "destructive",
        });
      }
    },
    [adoptModifiedPdf, toast, t],
  );

  // Remove every header (or footer) band of the current PDF, adopting the new
  // bytes without re-parsing (the page content is unchanged).
  const handleHeaderFooterRemove = useCallback(
    (kind: HeaderFooterKind) => {
      const file = currentPdfFileRef.current;
      if (!file) return;
      void (async () => {
        setHeaderFooterBusy(true);
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const next = await removeHeaderFooter(bytes, kind);
          adoptModifiedPdf(new Blob([next], { type: "application/pdf" }), {
            reparse: false,
          });
          toast({
            title: t("headersFooters.removedTitle"),
            description: t("headersFooters.removedDescription"),
          });
        } catch (err) {
          clientLogger.error("[editor] remove header/footer failed:", err);
          toast({
            title: t("headersFooters.errorTitle"),
            description: t("headersFooters.errorDescription"),
            variant: "destructive",
          });
        } finally {
          setHeaderFooterBusy(false);
        }
      })();
    },
    [adoptModifiedPdf, toast, t],
  );

  // Toggle Word-style headers & footers for the document. Turning the feature
  // OFF clears both bands from the PDF; turning it ON just flips the flag (the
  // dialog drives the actual band apply). Mirrors the watermark/compress flow.
  const handleToggleHeadersFooters = useCallback(() => {
    if (headersFootersEnabled) {
      // Going OFF: strip both bands, then drop the flag.
      const file = currentPdfFileRef.current;
      setHeadersFootersEnabled(false);
      if (!file) return;
      void (async () => {
        setHeaderFooterBusy(true);
        try {
          let bytes = new Uint8Array(await file.arrayBuffer());
          bytes = await removeHeaderFooter(bytes, "header");
          bytes = await removeHeaderFooter(bytes, "footer");
          adoptModifiedPdf(new Blob([bytes], { type: "application/pdf" }), {
            reparse: false,
          });
        } catch (err) {
          clientLogger.error("[editor] clear headers/footers failed:", err);
        } finally {
          setHeaderFooterBusy(false);
        }
      })();
    } else {
      toggleHeadersFooters();
    }
  }, [
    headersFootersEnabled,
    setHeadersFootersEnabled,
    toggleHeadersFooters,
    adoptModifiedPdf,
  ]);

  // ─── SL2 — Word-like editable running header/footer zones ──────────────────

  // Debounced bake: re-render the visible /GPHF band from the current definition
  // (the source of truth) and adopt the bytes WITHOUT re-parsing (the band lives
  // outside page content, so the editable overlay is unchanged). Reads the live
  // file + def via refs so the timer closure never goes stale.
  const scheduleHfBake = useCallback(() => {
    if (hfBakeTimerRef.current) clearTimeout(hfBakeTimerRef.current);
    hfBakeTimerRef.current = setTimeout(() => {
      hfBakeTimerRef.current = null;
      const file = currentPdfFileRef.current;
      const def = hfDefRef.current;
      if (!file || !def) return;
      void (async () => {
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const next = await bakeRunningHeaderFooter(bytes, def, {
            date: new Date().toISOString().slice(0, 10),
            images: hfRegistryRef.current.toMap(),
          });
          adoptModifiedPdf(new Blob([next], { type: "application/pdf" }), {
            reparse: false,
          });
        } catch (err) {
          clientLogger.error("[editor] header/footer bake failed:", err);
          toast({
            title: t("headerFooter.errorTitle"),
            description: t("headerFooter.errorDescription"),
            variant: "destructive",
          });
        }
      })();
    }, 500);
  }, [adoptModifiedPdf, toast, t]);

  // Non-blocking, one-shot warning before the first H/F edit on a SIGNED
  // document — any binary edit invalidates existing signatures (a global
  // concern). Gated by a ref so it fires at most once per session.
  const warnIfSignedOnce = useCallback(() => {
    if (hfSignedWarnedRef.current) return;
    hfSignedWarnedRef.current = true;
    const file = currentPdfFileRef.current;
    if (!file) return;
    void (async () => {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (await documentHasSignatures(bytes)) {
          toast({
            title: t("headerFooter.signedWarningTitle"),
            description: t("headerFooter.signedWarningDescription"),
          });
        }
      } catch {
        /* best-effort warning — never block editing */
      }
    })();
  }, [toast, t]);

  // Adopt a new running-H/F definition (any zone edit): update state + the sync
  // mirror, warn once if signed, and schedule a debounced bake.
  const handleHfDefChange = useCallback(
    (def: RunningHeaderFooter) => {
      setHfDef(def);
      hfDefRef.current = def;
      warnIfSignedOnce();
      scheduleHfBake();
    },
    [warnIfSignedOnce, scheduleHfBake],
  );

  // Toggle the editable header/footer zones. Entering seeds an empty definition
  // when none was detected, and keeps the store flag in sync; leaving clears the
  // focused item.
  const handleToggleHeaderFooterZones = useCallback(() => {
    setHfEditMode((on) => {
      const next = !on;
      if (next) {
        if (!hfDefRef.current) {
          const seed = emptyRunningHeaderFooter();
          hfDefRef.current = seed;
          setHfDef(seed);
        }
        setHeadersFootersEnabled(true);
      } else {
        setHfFocused(null);
      }
      return next;
    });
  }, [setHeadersFootersEnabled]);

  // SL3 — toggle "different first page": flip the flag and, when turning it on,
  // seed the `firstPage` override zone (a copy of `default`) so page 1 starts
  // from the same content and can diverge. Re-bakes via handleHfDefChange.
  const handleToggleHfDifferentFirstPage = useCallback(() => {
    const def = hfDefRef.current ?? emptyRunningHeaderFooter();
    const nextOn = !def.differentFirstPage;
    let next: RunningHeaderFooter = { ...def, differentFirstPage: nextOn };
    if (nextOn) next = ensureZone(next, "firstPage");
    handleHfDefChange(next);
  }, [handleHfDefChange]);

  // SL3 — toggle "different odd & even pages": flip the flag and, when turning
  // it on, seed BOTH the `evenPage` and `oddPage` override zones.
  const handleToggleHfDifferentOddEven = useCallback(() => {
    const def = hfDefRef.current ?? emptyRunningHeaderFooter();
    const nextOn = !def.differentOddEven;
    let next: RunningHeaderFooter = { ...def, differentOddEven: nextOn };
    if (nextOn) {
      next = ensureZone(next, "evenPage");
      next = ensureZone(next, "oddPage");
    }
    handleHfDefChange(next);
  }, [handleHfDefChange]);

  // The zone reports which text item is focused → drives the FormattingToolbar.
  const handleHfFocusedChange = useCallback((focus: HFFocusedTextItem | null) => {
    setHfFocused(focus);
  }, []);

  // Insert an image item: open the hidden file picker; its change handler reads
  // the bytes, registers them and appends an image item to the focused band.
  const handleHfInsertImage = useCallback(() => {
    hfImageInputRef.current?.click();
  }, []);

  const handleHfImageInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const input = e.currentTarget;
      const f = input.files?.[0];
      input.value = ""; // allow re-selecting the same file later
      const def = hfDefRef.current;
      if (!f || !def) return;
      void (async () => {
        try {
          const bytes = new Uint8Array(await f.arrayBuffer());
          const id = hfRegistryRef.current.add(bytes);
          // Default 80×24 pt box; inserted into the focused band (else header)
          // of the ACTIVE page's zone (SL3 — first-page/odd-even aware).
          const band = hfFocused?.band ?? "header";
          const key = resolveZoneKeyForPage(def, effectivePageIndex + 1);
          const next = appendItemToZone(
            def,
            key,
            band,
            makeImageItem(id, 80, 24, { anchor: "left" }),
          );
          handleHfDefChange(next);
        } catch (err) {
          clientLogger.error("[editor] header/footer image insert failed:", err);
        }
      })();
    },
    [hfFocused, effectivePageIndex, handleHfDefChange],
  );

  // Insert a {{token}} into the focused text item's template.
  const handleHfInsertToken = useCallback(
    (token: HFToken) => {
      const def = hfDefRef.current;
      if (!def || !hfFocused || hfFocused.item.type !== "text") return;
      const nextText = appendTokenToText(hfFocused.item.text, token);
      const key = resolveZoneKeyForPage(def, effectivePageIndex + 1);
      const next = updateItemInZone(def, key, hfFocused.band, hfFocused.index, {
        text: nextText,
      });
      handleHfDefChange(next);
    },
    [hfFocused, effectivePageIndex, handleHfDefChange],
  );

  const handleHfCloseZone = useCallback(() => {
    setHfEditMode(false);
    setHfFocused(null);
  }, []);

  // Synthetic single-text-element selection so the FormattingToolbar reflects
  // and edits the FOCUSED H/F text item (B/I/colour/size/align). Null when no
  // text item is focused.
  const hfSelectedTextElements = useMemo<TextElement[] | undefined>(() => {
    if (!hfEditMode || !hfFocused || hfFocused.item.type !== "text") {
      return undefined;
    }
    const it = hfFocused.item;
    const style: TextStyle = {
      fontFamily: "Helvetica",
      fontSize: it.size ?? 10,
      fontWeight: it.bold ? "bold" : "normal",
      fontStyle: it.italic ? "italic" : "normal",
      color: hfColorToHex(it.color),
      opacity: 1,
      textAlign: textAlignFromAnchor(it.anchor),
      lineHeight: 1.2,
      letterSpacing: 0,
      writingMode: "horizontal-tb",
      underline: false,
      strikethrough: false,
      backgroundColor: null,
      verticalAlign: "baseline",
      originalFont: null,
    };
    const el: TextElement = {
      elementId: `hf-${hfFocused.band}-${hfFocused.index}`,
      type: "text",
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      transform: { rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 },
      layerId: null,
      locked: false,
      visible: true,
      content: it.text,
      style,
      ocrConfidence: null,
      linkUrl: null,
      linkPage: null,
    };
    return [el];
  }, [hfEditMode, hfFocused]);

  // Route FormattingToolbar style patches to the focused H/F text item.
  const hfOnElementStyleChange = useCallback(
    (_elementId: string, patch: Partial<TextStyle>) => {
      const def = hfDefRef.current;
      if (!def || !hfFocused || hfFocused.item.type !== "text") return;
      const nextItem = applyTextStylePatch(hfFocused.item, patch);
      const key = resolveZoneKeyForPage(def, effectivePageIndex + 1);
      const next = updateItemInZone(
        def,
        key,
        hfFocused.band,
        hfFocused.index,
        nextItem,
      );
      handleHfDefChange(next);
    },
    [hfFocused, effectivePageIndex, handleHfDefChange],
  );

  // The contextual H/F cluster passed to the toolbar while zone mode is active.
  const headerFooterContext = useMemo(
    () =>
      hfEditMode
        ? {
            onInsertImage: handleHfInsertImage,
            onInsertToken: handleHfInsertToken,
            onCloseZone: handleHfCloseZone,
            canInsertToken: hfFocused?.item.type === "text",
          }
        : undefined,
    [
      hfEditMode,
      hfFocused,
      handleHfInsertImage,
      handleHfInsertToken,
      handleHfCloseZone,
    ],
  );

  // SL3 — localised badge for the active page's zone scope (first page / even /
  // odd / default), shown atop the editable bands so the user knows which pages
  // their edit applies to. Only while editing zones AND an override is active.
  const hfZoneLabel = useMemo<string | undefined>(() => {
    if (!hfEditMode || !hfDef) return undefined;
    const key = resolveZoneKeyForPage(hfDef, effectivePageIndex + 1);
    switch (key) {
      case "firstPage":
        return t("headerFooter.zone.firstPage");
      case "evenPage":
        return t("headerFooter.zone.evenPage");
      case "oddPage":
        return t("headerFooter.zone.oddPage");
      default:
        // No badge in the plain `default` case (SL2 behaviour unchanged).
        return undefined;
    }
  }, [hfEditMode, hfDef, effectivePageIndex, t]);

  // Cancel any pending bake on unmount (avoid a late timer firing after teardown).
  useEffect(() => {
    return () => {
      if (hfBakeTimerRef.current) clearTimeout(hfBakeTimerRef.current);
    };
  }, []);

  // Filigrane appliqué au document courant (mode « Appliquer au document »
  // du WatermarkDialog) : adopte le binaire filigrané exactement comme une
  // opération de page (swap binaire + re-parse + save immédiat), puis
  // confirme via toast.
  const handleWatermarkApplied = useCallback(
    (blob: Blob) => {
      const adopted = adoptModifiedPdf(blob);
      if (!adopted) return;
      toast({
        title: t("watermark.appliedTitle"),
        description: t("watermark.appliedDescription"),
      });
    },
    [adoptModifiedPdf, toast, t],
  );

  // Compression appliquée au document courant (mode « Appliquer au
  // document » du CompressDialog) : swap du binaire + save immédiat. Pas de
  // re-parse — la compression ne change ni la géométrie ni le contenu des
  // pages, seulement la sérialisation des objets PDF.
  const handleCompressApplied = useCallback(
    (blob: Blob) => {
      const adopted = adoptModifiedPdf(blob, { reparse: false });
      if (!adopted) return;
      toast({
        title: t("compress.appliedTitle"),
        description: t("compress.appliedDescription"),
      });
    },
    [adoptModifiedPdf, toast, t],
  );

  // OCR « PDF cherchable » appliqué : le binaire contient désormais un
  // calque de texte invisible — re-parse (défaut) pour que le scene graph
  // (et la recherche côté éditeur) voient les nouveaux items de texte.
  const handleOcrApplied = useCallback(
    (blob: Blob) => {
      const adopted = adoptModifiedPdf(blob);
      if (!adopted) return;
      toast({
        title: t("ocr.appliedTitle"),
        description: t("ocr.appliedDescription"),
      });
    },
    [adoptModifiedPdf, toast, t],
  );

  // Apply the PII redaction zones drawn on the active page. The zones are
  // transient canvas markers (read off the canvas handle in web coordinates);
  // we tag them with the active page number, lower them to PDF user-space via
  // the page's displayed dimensions + rotation, and hand them to the engine's
  // redactPii (deletes overlapping text, overwrites image pixels, paints an
  // opaque black box — irreversibly). The new binary is adopted exactly like a
  // page op (swap binary + re-parse so the editable overlay re-aligns) and the
  // markers are cleared.
  const handleRedactApply = useCallback(() => {
    const file = currentPdfFileRef.current;
    const page = effectivePage;
    if (!file || !page || !canvasHandle) return;
    const marks = canvasHandle.getRedactionMarks();
    if (marks.length === 0) return;

    const pageNumber = effectivePageIndex + 1; // engine pages are 1-based
    const webRects: WebRedactionRect[] = marks.map((m) => ({
      ...m,
      pageNumber,
    }));
    const geometries = new Map<number, PageGeometry>([
      [
        pageNumber,
        {
          width: page.dimensions.width,
          height: page.dimensions.height,
          rotation: page.dimensions.rotation as 0 | 90 | 180 | 270,
        },
      ],
    ]);
    const rectsByPage = groupRectsByPage(webRects, geometries);
    if (rectsByPage.size === 0) return;

    void (async () => {
      setRedactBusy(true);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const { bytes: next } = await redactDocument(bytes, rectsByPage);
        adoptModifiedPdf(new Blob([next], { type: "application/pdf" }));
        canvasHandle.clearRedactionMarks();
        setRedactionMarkCount(0);
        toast({
          title: t("redact.appliedTitle"),
          description: t("redact.appliedDescription"),
        });
      } catch (err) {
        clientLogger.error("[editor] redaction failed:", err);
        toast({
          title: t("redact.errorTitle"),
          description: t("redact.errorDescription"),
          variant: "destructive",
        });
      } finally {
        setRedactBusy(false);
      }
    })();
  }, [
    adoptModifiedPdf,
    canvasHandle,
    effectivePage,
    effectivePageIndex,
    toast,
    t,
  ]);

  // Discard every redaction zone drawn on the active page without applying.
  const handleRedactClear = useCallback(() => {
    canvasHandle?.clearRedactionMarks();
    setRedactionMarkCount(0);
  }, [canvasHandle]);

  // Replace the pixels of the selected image IN PLACE via the engine
  // (`replaceImage`): the image keeps its position / scale / rotation — only the
  // raster changes. Flush pending flat edits into the binary first
  // (getPreparedBlob), POST the current bytes + the engine UNIFIED image index +
  // the new bitmap to /api/pdf/replace-image, then adopt + re-parse (same
  // single-source-of-truth path as redaction / page ops). Wired to the
  // PropertiesPanel "Replace image" action. Works in single + continuous mode
  // (the selected image lives on the active page → effectivePageIndex).
  const handleReplaceImage = useCallback(
    ({ index, file: imageFile }: { index: number; file: File }) => {
      void (async () => {
        try {
          await getPreparedBlob(); // flush queued ops into currentPdfFile
          const pdfFile = currentPdfFileRef.current;
          if (!pdfFile) return;
          const { getAuthToken } = await import("@/lib/api");
          const token = await getAuthToken();
          const form = new FormData();
          form.append("file", pdfFile, pdfFile.name);
          form.append("page", String(effectivePageIndex + 1));
          form.append("imageIndex", String(index));
          form.append("image", imageFile, imageFile.name);
          const res = await fetch("/api/pdf/replace-image", {
            method: "POST",
            credentials: "include",
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
            body: form,
          });
          if (!res.ok) throw new Error(`replace-image ${res.status}`);
          const blob = new Blob([await res.arrayBuffer()], {
            type: "application/pdf",
          });
          adoptModifiedPdf(blob, { reparse: true });
          toast({
            title: t("replaceImage.appliedTitle"),
            description: t("replaceImage.appliedDescription"),
          });
        } catch (err) {
          clientLogger.error("[editor] replace image failed:", err);
          toast({
            title: t("replaceImage.errorTitle"),
            description: t("replaceImage.errorDescription"),
            variant: "destructive",
          });
        }
      })();
    },
    [getPreparedBlob, adoptModifiedPdf, effectivePageIndex, toast, t],
  );

  // Bake a freehand pencil stroke as a real `/Ink` annotation (engine `addInk`).
  // The canvas hands us the completed polyline ALREADY lowered to PDF user space
  // (origin bottom-left); we attach the toolbar's stroke colour (packed
  // 0xRRGGBB) + width, flush pending edits, POST to /api/pdf/ink, then adopt +
  // re-parse so the ink joins the scene graph. Wired to EditorCanvas.onInkDrawn
  // in single + continuous mode (the stroke acts on the active page).
  const handleAddInk = useCallback(
    (points: number[]) => {
      if (!Array.isArray(points) || points.length < 4) return;
      void (async () => {
        try {
          await getPreparedBlob();
          const pdfFile = currentPdfFileRef.current;
          if (!pdfFile) return;
          let hex = (strokeColor || "#000000").replace(/^#/, "");
          if (hex.length === 3) {
            hex = hex
              .split("")
              .map((c) => c + c)
              .join("");
          }
          const rgb = /^[0-9a-fA-F]{6}$/.test(hex) ? parseInt(hex, 16) : 0x000000;
          const lineWidth =
            Number.isFinite(strokeWidth) && strokeWidth > 0 ? strokeWidth : 2;
          const { getAuthToken } = await import("@/lib/api");
          const token = await getAuthToken();
          const form = new FormData();
          form.append("file", pdfFile, pdfFile.name);
          form.append("page", String(effectivePageIndex + 1));
          form.append("points", JSON.stringify(points));
          form.append("rgb", String(rgb));
          form.append("lineWidth", String(lineWidth));
          const res = await fetch("/api/pdf/ink", {
            method: "POST",
            credentials: "include",
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
            body: form,
          });
          if (!res.ok) throw new Error(`ink ${res.status}`);
          const blob = new Blob([await res.arrayBuffer()], {
            type: "application/pdf",
          });
          adoptModifiedPdf(blob, { reparse: true });
          toast({
            title: t("ink.appliedTitle"),
            description: t("ink.appliedDescription"),
          });
        } catch (err) {
          clientLogger.error("[editor] add ink failed:", err);
          toast({
            title: t("ink.errorTitle"),
            description: t("ink.errorDescription"),
            variant: "destructive",
          });
        }
      })();
    },
    [
      getPreparedBlob,
      adoptModifiedPdf,
      effectivePageIndex,
      strokeColor,
      strokeWidth,
      toast,
      t,
    ],
  );

  // On-demand OCR + semantic indexing of the document (#85). Runs OCR on the
  // in-memory PDF blob (single source of truth), then ships the resulting
  // blocks to the backend pgvector index. The whole document is indexed because
  // the backend ingestion REPLACES the document's index — sending one page
  // would drop the others. Non-blocking UI: a busy flag disables the button.
  const handleIndexOcr = useCallback(() => {
    const pdfFile = currentPdfFileRef.current;
    if (!pdfFile || !storedDocumentId) return;

    void (async () => {
      setIndexOcrBusy(true);
      try {
        const token = await getAuthToken();
        const form = new FormData();
        form.append("file", pdfFile, pdfFile.name);
        // `page` omitted → OCR every page (full, consistent index).
        form.append("granularity", "line");

        const res = await fetch("/api/pdf/ocr-page", {
          method: "POST",
          credentials: "include",
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          body: form,
        });
        if (!res.ok) {
          throw new Error(`OCR route returned ${res.status}`);
        }
        const data = (await res.json()) as {
          success: boolean;
          blocks: Array<{
            page: number;
            text: string;
            bbox: { x: number; y: number; w: number; h: number };
          }>;
        };
        const blocks = data.blocks ?? [];
        if (blocks.length === 0) {
          toast({
            title: t("indexOcr.emptyTitle"),
            description: t("indexOcr.emptyDescription"),
          });
          return;
        }

        const result = await api.indexOcrBlocks(storedDocumentId, blocks);
        if (!result.semantic_search_available) {
          toast({
            title: t("indexOcr.unavailableTitle"),
            description: t("indexOcr.unavailableDescription"),
          });
          return;
        }
        toast({
          title: t("indexOcr.indexedTitle"),
          description: t("indexOcr.indexedDescription", {
            count: result.blocks_indexed,
          }),
        });
      } catch (err) {
        clientLogger.error("[editor] OCR index failed:", err);
        toast({
          title: t("indexOcr.errorTitle"),
          description: t("indexOcr.errorDescription"),
          variant: "destructive",
        });
      } finally {
        setIndexOcrBusy(false);
      }
    })();
  }, [storedDocumentId, toast, t]);

  // Signature numérique appliquée au document courant (mode « Appliquer au
  // document » du SignDialog) : swap du binaire + save immédiat. Pas de
  // re-parse — la signature n'ajoute qu'un dictionnaire /Sig invisible, la
  // géométrie des pages est inchangée. Toute modification ultérieure du
  // binaire invaliderait la signature : on n'y touche plus.
  const handleSignApplied = useCallback(
    (blob: Blob) => {
      const adopted = adoptModifiedPdf(blob, { reparse: false });
      if (!adopted) return;
      toast({
        title: t("sign.appliedTitle"),
        description: t("sign.appliedDescription"),
      });
    },
    [adoptModifiedPdf, toast, t],
  );

  const handlePageRotate = useCallback(
    (pageIndex: number) =>
      runPageOperation('rotate', { pageNumber: pageIndex + 1, degrees: 90 }),
    [runPageOperation],
  );

  const handleAddPage = useCallback(async () => {
    // afterPage=pages.length inserts at the end. pdf-engine treats it as
    // 1-indexed insertion point, so we pass the current page count as-is.
    const ok = await runPageOperation('add', { afterPage: pages.length });
    if (ok) addPageLocal();
  }, [runPageOperation, pages.length, addPageLocal]);

  // SL4 — add a page of a chosen format/orientation at a position (after the
  // active page / at the end). Resolves the size to PDF points + the insertion
  // point via `addPageParams`, runs the page-add op (binary swap → re-parse
  // rebuilds the scene graph with the new, possibly-different-sized page), then
  // RE-BAKES the running header/footer (re-supplying the registered images via
  // scheduleHfBake) because adding a page shifts every {{page}}/{{pages}} token.
  const handleAddPageFormat = useCallback(
    async (
      format: PageFormat,
      orientation: PageOrientation,
      position: AddPagePosition,
      custom?: PageFormatPoints,
    ) => {
      const { afterPage, width, height } = addPageParams(
        format,
        orientation,
        position,
        { currentPageIndex: effectivePageIndex, pageCount: pages.length },
        custom,
      );
      const ok = await runPageOperation('add', { afterPage, width, height });
      if (!ok) return;
      addPageLocal();
      const def = hfDefRef.current;
      if (def && !isRunningHeaderFooterEmpty(def)) scheduleHfBake();
    },
    [
      effectivePageIndex,
      pages.length,
      runPageOperation,
      addPageLocal,
      scheduleHfBake,
    ],
  );

  // --- Insert menu (Word-like) ------------------------------------------------

  /**
   * Insert an `rows`×`cols` table at the current page. The model has no grouped
   * table primitive, so the table is laid out as individual editable text cells
   * + `line` border shapes within the page content area (page size minus a
   * margin). Each element flows through the SAME element-add pipeline used by
   * the canvas tools (`handleElementAdded`): scene-graph mirror + queue + bake.
   */
  const handleInsertTable = useCallback(
    async (rows: number, cols: number) => {
      const page = currentPage;
      if (!page) return;
      const { width, height } = page.dimensions;
      // 10% margin (clamped) keeps the grid clear of page edges.
      const marginX = Math.min(width * 0.1, 72);
      const marginY = Math.min(height * 0.1, 72);
      const elements = buildTableElements({
        rows,
        cols,
        area: {
          x: marginX,
          y: marginY,
          width: Math.max(width - marginX * 2, 1),
          height: Math.max(height - marginY * 2, 1),
        },
      });
      // Add cells + borders sequentially through the normal add path. Each call
      // assigns a fresh elementId, mirrors to the scene graph, queues the op and
      // schedules a debounced save (batched across the rapid sequence).
      for (const el of elements) {
        await handleElementAdded({
          ...el,
          elementId: `element-${Date.now()}-${Math.random()}`,
        } as Element);
      }
    },
    [currentPage, handleElementAdded],
  );

  /**
   * Attach a hyperlink (external URL or in-document page) to the single
   * selected text element. TextElement carries `linkUrl` / `linkPage`; the
   * change persists via the existing partial-update path (`handleElementUpdate`)
   * — no new save path.
   */
  // Named destinations created this session — fed back into the link dialog as a
  // datalist so the user can re-pick a name when adding a GoTo-named link.
  const [createdNamedDests, setCreatedNamedDests] = useState<string[]>([]);

  const handleInsertLink = useCallback(
    async (value: InsertLinkValue) => {
      // URL / in-document-page links ride as element properties and bake through
      // the apply-elements path (no document-level round-trip).
      if (value.kind === "url" || value.kind === "page") {
        const target = selectedTextElements[0];
        if (!target) return;
        const updates: Partial<TextElement> =
          value.kind === "url"
            ? { linkUrl: value.url, linkPage: null }
            : { linkUrl: null, linkPage: value.page };
        handleElementUpdate(target.elementId, updates as Partial<Element>);
        return;
      }

      // Named destinations live in the document catalog (/Dests) + a GoTo link
      // annotation — applied through /api/pdf/links, then adopted in place.
      const base = await getPreparedBlob();
      const source = base ?? currentPdfFileRef.current;
      if (!source) return;
      const docName = currentPdfFileRef.current?.name ?? "document.pdf";

      try {
        const fd = new FormData();
        fd.append("file", new File([source], docName, { type: "application/pdf" }));

        if (value.kind === "namedCreate") {
          fd.append("action", "addNamedDest");
          fd.append("name", value.name);
          fd.append("page", String(value.targetPage));
        } else {
          // namedLink: anchor a clickable box over the selected text element.
          const target = selectedTextElements[0];
          if (!target || !effectivePage) return;
          const geo: PageGeometry = {
            width: effectivePage.dimensions.width,
            height: effectivePage.dimensions.height,
            rotation: effectivePage.dimensions.rotation as 0 | 90 | 180 | 270,
          };
          // bounds.y is the TOP edge (web Y-down); webRectToPdf flips it to the
          // PDF bottom edge (Y-up) — the same convention every bake uses.
          const r = webRectToPdf(target.bounds, geo);
          fd.append("action", "addGotoLinkNamed");
          fd.append("page", String(effectivePageIndex + 1));
          fd.append(
            "rect",
            JSON.stringify({ x: r.x, y: r.y, w: r.width, h: r.height }),
          );
          fd.append("name", value.name);
        }

        const resp = await fetch("/api/pdf/links", { method: "POST", body: fd });
        if (!resp.ok) throw new Error(`links action failed: ${resp.status}`);
        const blob = await resp.blob();
        // namedCreate moves nothing; namedLink adds an annotation we re-parse so
        // the scene graph reflects it.
        adoptModifiedPdf(blob, { reparse: value.kind === "namedLink" });

        if (value.kind === "namedCreate") {
          setCreatedNamedDests((prev) =>
            prev.includes(value.name) ? prev : [...prev, value.name],
          );
          toast({ title: t("links.toasts.namedDestCreated", { name: value.name }) });
        } else {
          toast({ title: t("links.toasts.namedLinkAdded", { name: value.name }) });
        }
      } catch (err) {
        clientLogger.error("[editor] named destination failed", err);
        toast({
          variant: "destructive",
          title:
            value.kind === "namedCreate"
              ? t("links.toasts.namedDestFailed")
              : t("links.toasts.namedLinkFailed"),
        });
      }
    },
    [
      selectedTextElements,
      handleElementUpdate,
      getPreparedBlob,
      adoptModifiedPdf,
      effectivePage,
      effectivePageIndex,
      toast,
      t,
    ],
  );

  /**
   * Embed an SVG graphic on the current page via /api/pdf/insert-svg, then adopt
   * the returned binary. Placement is in PDF points (origin bottom-left); when
   * the dialog leaves it "centred" we derive a square box centred on the page
   * (symmetric, so no Y-flip needed).
   */
  const handleInsertSvg = useCallback(
    async (value: InsertSvgValue) => {
      const base = await getPreparedBlob();
      const source = base ?? currentPdfFileRef.current;
      if (!source || !effectivePage) return;
      const docName = currentPdfFileRef.current?.name ?? "document.pdf";

      const pageW = effectivePage.dimensions.width;
      const pageH = effectivePage.dimensions.height;
      let placement = value.placement;
      if (!placement) {
        const side = Math.max(1, Math.min(pageW, pageH) * 0.5);
        placement = {
          x: (pageW - side) / 2,
          y: (pageH - side) / 2,
          w: side,
          h: side,
        };
      }

      try {
        const fd = new FormData();
        fd.append("file", new File([source], docName, { type: "application/pdf" }));
        fd.append("page", String(effectivePageIndex + 1));
        fd.append("svg", value.svg);
        fd.append("x", String(placement.x));
        fd.append("y", String(placement.y));
        fd.append("w", String(placement.w));
        fd.append("h", String(placement.h));
        const resp = await fetch("/api/pdf/insert-svg", { method: "POST", body: fd });
        if (!resp.ok) throw new Error(`insert svg failed: ${resp.status}`);
        const blob = await resp.blob();
        adoptModifiedPdf(blob, { reparse: true });
        toast({ title: t("svg.toasts.inserted") });
      } catch (err) {
        clientLogger.error("[editor] insert svg failed", err);
        toast({ variant: "destructive", title: t("svg.toasts.failed") });
      }
    },
    [getPreparedBlob, adoptModifiedPdf, effectivePage, effectivePageIndex, toast, t],
  );

  /** Remove the hyperlink from the selected text element. */
  const handleRemoveLink = useCallback(() => {
    const target = selectedTextElements[0];
    if (!target) return;
    handleElementUpdate(target.elementId, {
      linkUrl: null,
      linkPage: null,
    } as Partial<Element>);
  }, [selectedTextElements, handleElementUpdate]);

  /**
   * Insert a blank page before / after the current page, reusing the page-op
   * pipeline (`runPageOperation('add', …)`) — the same one the page sidebar uses.
   * pdf-engine treats `afterPage` as a 1-indexed insertion point; the current
   * 0-indexed page index maps to "after the current page", and one less maps to
   * "before".
   */
  const handleInsertBlankPage = useCallback(
    async (position: "before" | "after") => {
      const idx = effectivePageIndex;
      const afterPage = position === "after" ? idx : idx - 1;
      const ok = await runPageOperation("add", { afterPage });
      if (!ok) return;
      addPageLocal();
      // Inserting before the current page shifts it down by one — follow it so
      // the user stays on the same content.
      if (position === "before") {
        goToPage(idx + 1);
      }
    },
    [effectivePageIndex, runPageOperation, addPageLocal, goToPage],
  );

  /**
   * Apply bullet / numbered list formatting to the selected text element by
   * prefixing each line of its content. Persists via the partial-update path
   * (content change → in-place replaceText bake).
   */
  const handleInsertList = useCallback(
    (kind: "bullet" | "numbered") => {
      const target = selectedTextElements[0];
      if (!target) return;
      const next = buildListContent(target.content, kind);
      if (next === target.content) return;
      handleElementUpdate(target.elementId, {
        content: next,
      } as Partial<Element>);
    },
    [selectedTextElements, handleElementUpdate],
  );

  const handleDuplicatePage = useCallback(
    async (pageIndex: number) => {
      const ok = await runPageOperation('copy', {
        pageNumber: pageIndex + 1,
        insertAfter: pageIndex + 1,
      });
      if (ok) duplicatePageLocal(pageIndex);
    },
    [runPageOperation, duplicatePageLocal],
  );

  const handleDeletePage = useCallback(
    async (pageIndex: number) => {
      // pdf-engine refuses to delete the last remaining page; guard locally.
      if (pages.length <= 1) return;
      const ok = await runPageOperation('delete', { pageNumber: pageIndex + 1 });
      if (ok) deletePageLocal(pageIndex);
    },
    [runPageOperation, pages.length, deletePageLocal],
  );

  const handleReorderPages = useCallback(
    async (fromIndex: number, toIndex: number) => {
      const ok = await runPageOperation('move', {
        fromPage: fromIndex + 1,
        toPage: toIndex + 1,
      });
      if (ok) reorderPagesLocal(fromIndex, toIndex);
    },
    [runPageOperation, reorderPagesLocal],
  );

  const handlePageExtract = useCallback(async (pageIndex: number) => {
    if (!currentPdfFile) return;
    try {
      const result = await pageOperation.mutateAsync({
        file: currentPdfFile,
        operation: 'extract',
        params: { pageNumbers: [pageIndex + 1] },
      });
      downloadBlob(result as Blob, `page-${pageIndex + 1}.pdf`);
    } catch (err) {
      clientLogger.error('[editor] Extract failed:', err);
    }
  }, [currentPdfFile, pageOperation]);

  // --- Resize page (Word-like "page size") ----------------------------------
  // 0-based index of the page targeted by the resize dialog (null = closed).
  const [resizePageIndex, setResizePageIndex] = useState<number | null>(null);

  const handlePageResize = useCallback((pageIndex: number) => {
    setResizePageIndex(pageIndex);
  }, []);

  // Apply a new page size (points) via the existing `resize` page op, then
  // re-parse so the editable overlay re-aligns with the new MediaBox.
  const applyPageResize = useCallback(
    async (size: { width: number; height: number }) => {
      const idx = resizePageIndex;
      if (idx === null) return;
      await runPageOperation('resize', {
        pageNumber: idx + 1,
        width: size.width,
        height: size.height,
      });
    },
    [resizePageIndex, runPageOperation],
  );

  // --- Outline (TOC) editing -------------------------------------------------
  // Bake an edited outline tree onto the PDF (client-side, shared engine) and
  // adopt the new binary — same single-source-of-truth path as redaction.
  const handleApplyOutline = useCallback(
    (outline: BookmarkObject[]) => {
      const file = currentPdfFileRef.current;
      if (!file) return;
      void (async () => {
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const { bytes: next } = await bakeOutline(bytes, outline);
          adoptModifiedPdf(new Blob([next], { type: 'application/pdf' }), {
            reparse: false,
          });
          toast({
            title: t('toc.appliedTitle'),
            description: t('toc.appliedDescription'),
          });
        } catch (err) {
          clientLogger.error('[editor] outline bake failed:', err);
          toast({
            title: t('toc.errorTitle'),
            description: t('toc.errorDescription'),
            variant: 'destructive',
          });
        }
      })();
    },
    [adoptModifiedPdf, toast, t],
  );

  // --- Chapter detection (#96) ----------------------------------------------
  // Recover a navigable chapter list from a document that ships no embedded
  // outline: POST the current binary to /api/pdf/structure (action `detect`).
  // The TOC panel previews the returned flat, level-encoded chapters and bakes
  // the chosen ones through the existing onApplyOutline pipeline.
  const handleDetectChapters = useCallback(async (): Promise<BookmarkInput[]> => {
    const file = currentPdfFileRef.current;
    if (!file) {
      throw new Error("No document loaded");
    }
    const form = new FormData();
    form.append("file", file, file.name);
    form.append("action", "detect");

    const res = await fetch("/api/pdf/structure", {
      method: "POST",
      credentials: "include",
      body: form,
    });
    if (!res.ok) {
      toast({ title: t("toc.detectError"), variant: "destructive" });
      throw new Error(`Structure route returned ${res.status}`);
    }
    const json = (await res.json()) as {
      success: boolean;
      data?: { chapters?: BookmarkInput[] };
    };
    return json.data?.chapters ?? [];
  }, [toast, t]);

  // --- Geometric annotation creation (#94 Wave 2) ---------------------------
  // Add a circle / polygon / polyline / caret to the active page via
  // /api/pdf/annotations (action = kind). The backend places a default-sized
  // shape centred on the page; we adopt the new binary and re-parse so the
  // annotation surfaces in the scene graph (and the annotations panel list).
  const [annotationAddBusy, setAnnotationAddBusy] = useState(false);
  const handleAddAnnotation = useCallback(
    (kind: GeometricAnnotationType) => {
      const file = currentPdfFileRef.current;
      if (!file) return;
      void (async () => {
        setAnnotationAddBusy(true);
        try {
          const form = new FormData();
          form.append("file", file, file.name);
          form.append("pageNumber", String(effectivePageIndex + 1));
          form.append("action", kind);

          const res = await fetch("/api/pdf/annotations", {
            method: "POST",
            credentials: "include",
            body: form,
          });
          if (!res.ok) {
            throw new Error(`Annotations route returned ${res.status}`);
          }
          const blob = await res.blob();
          adoptModifiedPdf(blob, { reparse: true });
          toast({
            title: t("annotations.addedTitle"),
            description: t("annotations.addedDescription"),
          });
        } catch (err) {
          clientLogger.error("[editor] add annotation failed:", err);
          toast({
            title: t("annotations.addErrorTitle"),
            description: t("annotations.addErrorDescription"),
            variant: "destructive",
          });
        } finally {
          setAnnotationAddBusy(false);
        }
      })();
    },
    [effectivePageIndex, adoptModifiedPdf, toast, t],
  );

  // ── Word-like in-place text-run restyle (setTextRunStyle) ───────────────────
  // Vectorial restyle of an EXISTING parsed run: the original glyph codes are
  // sliced + re-emitted (positioning preserved), unlike the redact+add path.
  // Fired by the properties panel for a parsed text element; we adopt + re-parse
  // so the rebuilt scene graph reflects the new styling. Mode-agnostic — the
  // panel passes the active page (single + continuous), the engine run `index`,
  // and the chosen `spans`.
  const handleApplyTextStyle = useCallback(
    ({
      page,
      index,
      spans,
    }: {
      page: number;
      index: number;
      spans: TextRunStyleSpan[];
    }) => {
      const file = currentPdfFileRef.current;
      if (!file) return;
      void (async () => {
        try {
          const form = new FormData();
          form.append("file", file, file.name);
          form.append("page", String(page));
          form.append("index", String(index));
          form.append("spans", JSON.stringify(spans));

          const res = await fetch("/api/pdf/text-style", {
            method: "POST",
            credentials: "include",
            body: form,
          });
          if (!res.ok) {
            throw new Error(`text-style route returned ${res.status}`);
          }
          const blob = await res.blob();
          adoptModifiedPdf(blob, { reparse: true });
          toast({
            title: t("textStyle.appliedTitle"),
            description: t("textStyle.appliedDescription"),
          });
        } catch (err) {
          clientLogger.error("[editor] apply text style failed:", err);
          toast({
            title: t("textStyle.errorTitle"),
            description: t("textStyle.errorDescription"),
            variant: "destructive",
          });
        }
      })();
    },
    [adoptModifiedPdf, toast, t],
  );

  // ── Native annotation inventory + removal (annotations / removeAnnotation) ──
  // List walks every page server-side (action="list") and returns each existing
  // annotation's `{page, index}`. Remove deletes structurally (action="remove")
  // then adopts + re-parses the new PDF — the panel re-fetches the list, since
  // per-page indices shift after a removal.
  const handleListAnnotations =
    useCallback(async (): Promise<NativeAnnotationItem[]> => {
      const file = currentPdfFileRef.current;
      if (!file) return [];
      const form = new FormData();
      form.append("file", file, file.name);
      form.append("action", "list");
      const res = await fetch("/api/pdf/annotations", {
        method: "POST",
        credentials: "include",
        body: form,
      });
      if (!res.ok) {
        throw new Error(`annotations list returned ${res.status}`);
      }
      const data = (await res.json()) as {
        success?: boolean;
        annotations?: NativeAnnotationItem[];
      };
      return Array.isArray(data.annotations) ? data.annotations : [];
    }, []);

  const handleRemoveAnnotation = useCallback(
    async (page: number, index: number): Promise<void> => {
      const file = currentPdfFileRef.current;
      if (!file) return;
      try {
        const form = new FormData();
        form.append("file", file, file.name);
        form.append("action", "remove");
        form.append("page", String(page));
        form.append("index", String(index));
        const res = await fetch("/api/pdf/annotations", {
          method: "POST",
          credentials: "include",
          body: form,
        });
        if (!res.ok) {
          throw new Error(`annotations remove returned ${res.status}`);
        }
        const blob = await res.blob();
        adoptModifiedPdf(blob, { reparse: true });
        toast({
          title: t("annotations.removedTitle"),
          description: t("annotations.removedDescription"),
        });
      } catch (err) {
        clientLogger.error("[editor] remove annotation failed:", err);
        toast({
          title: t("annotations.removeErrorTitle"),
          description: t("annotations.removeErrorDescription"),
          variant: "destructive",
        });
      }
    },
    [adoptModifiedPdf, toast, t],
  );

  // --- PII auto-detect redaction --------------------------------------------
  const [showRedactPiiDialog, setShowRedactPiiDialog] = useState(false);
  // Fill & Sign — signature/initials capture dialog visibility + preset kind
  // (the toolbar exposes Signature and Paraphe as two distinct entries).
  const [signatureDialogOpen, setSignatureDialogOpen] = useState(false);
  const [signatureDialogKind, setSignatureDialogKind] = useState<
    "signature" | "initials"
  >("signature");

  // Redact every auto-detected PII region (whole text runs) across the whole
  // document. Reuses the manual redaction baking path: build per-page geometry,
  // lower the web rects, then `redactDocument` (same `redactPii` engine call).
  const handleRedactPiiAuto = useCallback(
    (rects: WebRedactionRect[]) => {
      const file = currentPdfFileRef.current;
      if (!file || rects.length === 0) return;
      const geometries = new Map<number, PageGeometry>();
      for (const page of pages) {
        geometries.set(page.pageNumber, {
          width: page.dimensions.width,
          height: page.dimensions.height,
          rotation: page.dimensions.rotation as 0 | 90 | 180 | 270,
        });
      }
      const rectsByPage = groupRectsByPage(rects, geometries);
      if (rectsByPage.size === 0) return;
      void (async () => {
        setRedactBusy(true);
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const { bytes: next } = await redactDocument(bytes, rectsByPage);
          adoptModifiedPdf(new Blob([next], { type: 'application/pdf' }));
          setShowRedactPiiDialog(false);
          toast({
            title: t('redact.appliedTitle'),
            description: t('redact.appliedDescription'),
          });
        } catch (err) {
          clientLogger.error('[editor] PII redaction failed:', err);
          toast({
            title: t('redact.errorTitle'),
            description: t('redact.errorDescription'),
            variant: 'destructive',
          });
        } finally {
          setRedactBusy(false);
        }
      })();
    },
    [pages, adoptModifiedPdf, toast, t],
  );

  const handleToggleContentEdit = useCallback(() => {
    if (isContentEditActive) {
      // Leaving content edit mode — clear modifications first
      setContentModifications([]);
      setContentEditActive(false);
    } else {
      setContentEditActive(true);
    }
  }, [isContentEditActive, setContentEditActive]);

  const handleContentModificationsChange = useCallback((modifications: ElementModification[]) => {
    setContentModifications(modifications);
  }, []);

  // Handler pour la navigation TOC. pageNumber is 1-indexed; navigateToPage
  // expects 0-indexed and scrolls the page into view in continuous mode.
  const handleNavigateToPage = useCallback((pageNumber: number) => {
    navigateToPage(pageNumber - 1, "start");
  }, [navigateToPage]);

  // Handler pour la visibilité d'un calque (= élément de la page).
  // Décision produit : le masquage est un OUTIL D'ÉDITION uniquement — un
  // élément masqué reste dans le scene graph ET dans le PDF baké au save
  // (aucun queueUpdate ici : pas de redaction, pas de réécriture du PDF).
  // Le panneau calques étant contrôlé par element.visible, la mise à jour
  // du scene graph suffit à rafraîchir l'icône œil ; le renderer du canvas
  // ré-applique l'état au prochain loadPage (navigation de page).
  const handleElementVisibilityChange = useCallback(
    (elementId: string, visible: boolean) => {
      clientLogger.debug(
        "[editor] Element visibility changed:",
        elementId,
        visible,
      );
      // 1. Canvas Fabric (effet visuel immédiat, désélection si masqué)
      canvasHandle?.setElementVisibility(elementId, visible);
      // 2. Scene graph React (source de vérité du panel + des re-renders)
      updateElementInPage(elementId, { visible });
      // 3. Collaboration : payload partiel — le récepteur merge sur
      //    l'élément connu puis re-rend l'objet Fabric (état appliqué).
      emitElementUpdate(elementId, { visible });
      setDirty(true);
      saveWithPriority("debounced");
    },
    [canvasHandle, updateElementInPage, emitElementUpdate, setDirty, saveWithPriority],
  );

  // Handler pour le verrouillage d'un calque (= élément de la page).
  // Verrouillé = non sélectionnable/non éditable sur le canvas
  // (selectable=false, evented=false). Même contrat de sync que la
  // visibilité : pas d'op PDF, état persisté dans le scene graph.
  const handleElementLockChange = useCallback(
    (elementId: string, locked: boolean) => {
      clientLogger.debug("[editor] Element lock changed:", elementId, locked);
      canvasHandle?.setElementLocked(elementId, locked);
      updateElementInPage(elementId, { locked });
      emitElementUpdate(elementId, { locked });
      setDirty(true);
      saveWithPriority("debounced");
    },
    [canvasHandle, updateElementInPage, emitElementUpdate, setDirty, saveWithPriority],
  );

  // Sélectionner un élément depuis le panneau calques : le canvas le passe en
  // objet actif et forwarde la sélection au store + panneau propriétés. Pas de
  // mutation ni de save — purement une sélection (comme un clic sur le canvas).
  //
  // Mode continu : `canvasHandle` ne pilote QUE la page active. Si l'élément
  // vit sur une AUTRE page, `selectElement` y échoue (l'objet n'est pas rendu
  // sur le canvas actif). On localise alors la page propriétaire dans le scene
  // graph, on l'active (navigateToPage monte son EditorCanvas + re-fire
  // onCanvasReady → setCanvasHandle) et on diffère la sélection : l'effet sur
  // `canvasHandle` (plus bas) re-tente une fois le nouveau canvas monté.
  const handleSelectElementFromLayer = useCallback(
    (elementId: string) => {
      // Page propriétaire de l'élément (le scene graph est la source de vérité,
      // indépendamment du layout single/continu).
      const ownerPageIndex = pages.findIndex((p) =>
        p.elements.some((e) => e.elementId === elementId),
      );
      // Inconnu du scene graph : tenter quand même sur le canvas courant (ne
      // régresse pas le mode single-page où tout vit sur l'unique canvas).
      if (ownerPageIndex < 0) {
        canvasHandle?.selectElement(elementId);
        return;
      }
      // Déjà sur la page affichée → sélection directe (chemin synchrone, mode
      // single ET page active du mode continu).
      if (ownerPageIndex === effectivePageIndex) {
        pendingLayerSelectRef.current = null;
        canvasHandle?.selectElement(elementId);
        return;
      }
      // Autre page (continu) : activer la page propriétaire puis différer la
      // sélection jusqu'au montage de son canvas (effet sur canvasHandle).
      pendingLayerSelectRef.current = elementId;
      navigateToPage(ownerPageIndex, "center");
    },
    [pages, effectivePageIndex, canvasHandle, navigateToPage],
  );

  // Rejoue une sélection de calque différée (mode continu) dès que le canvas de
  // la page nouvellement active est prêt. `canvasHandle` change quand la page
  // active monte son EditorCanvas (onCanvasReady), ce qui déclenche cet effet.
  // `selectElement` renvoie `true` quand l'élément est trouvé sur la page
  // affichée : on ne vide le pending qu'à ce moment (un canvasHandle transitoire
  // d'une page intermédiaire ne consomme pas la demande). Si l'élément n'est
  // jamais rendu, le pending reste simplement inerte — aucune boucle.
  useEffect(() => {
    const pendingId = pendingLayerSelectRef.current;
    if (!pendingId || !canvasHandle) return;
    if (canvasHandle.selectElement(pendingId)) {
      pendingLayerSelectRef.current = null;
    }
  }, [canvasHandle]);

  // Sélectionner sur le canvas tous les membres d'un calque (clic ligne-calque
  // dans LayersPanel). Route vers la sélection multi du canvas, qui met les
  // objets en ActiveSelection et synchronise store + panneau propriétés. `[]`
  // désélectionne. Pas de mutation ni de save — purement une sélection.
  const handleSelectLayerMembers = useCallback(
    (elementIds: string[]) => {
      canvasHandle?.selectElements(elementIds);
    },
    [canvasHandle],
  );

  // ── User layers (Phase 2 "Layer Groups") ─────────────────────────────────
  // Editor-only construct: layer membership + visibility/lock live in the
  // scene graph (useDocument), NOT in the PDF (no OCG, no pdf-engine op). The
  // visibility/lock cascade is applied to member elements inside useDocument
  // in a single state pass; here we additionally mirror the visual effect onto
  // the Fabric canvas + collaboration for each currently-loaded member element.
  const handleLayerCreate = useCallback(() => {
    // Default name is a simple ordinal; the panel immediately enters rename
    // mode after creation (double-click is also available afterwards).
    createLayer(`Layer ${userLayers.length + 1}`);
    setDirty(true);
    saveWithPriority("debounced");
  }, [createLayer, userLayers.length, setDirty, saveWithPriority]);

  const handleLayerDelete = useCallback(
    (layerId: string) => {
      deleteLayer(layerId);
      setDirty(true);
      saveWithPriority("debounced");
    },
    [deleteLayer, setDirty, saveWithPriority],
  );

  const handleLayerRename = useCallback(
    (layerId: string, name: string) => {
      renameLayer(layerId, name);
      setDirty(true);
      saveWithPriority("debounced");
    },
    [renameLayer, setDirty, saveWithPriority],
  );

  const handleLayerReorder = useCallback(
    (layerId: string, newOrder: number) => {
      reorderLayer(layerId, newOrder);
      setDirty(true);
      saveWithPriority("debounced");
    },
    [reorderLayer, setDirty, saveWithPriority],
  );

  const handleLayerVisibilityChange = useCallback(
    (layerId: string, visible: boolean) => {
      // Cascade member element flags in the scene graph (single pass).
      setLayerVisible(layerId, visible);
      // Mirror onto canvas + collaboration for each loaded member element.
      const members = (effectivePage?.elements ?? []).filter(
        (el) => el.layerId === layerId,
      );
      for (const el of members) {
        canvasHandle?.setElementVisibility(el.elementId, visible);
        emitElementUpdate(el.elementId, { visible });
      }
      setDirty(true);
      saveWithPriority("debounced");
    },
    [
      setLayerVisible,
      effectivePage,
      canvasHandle,
      emitElementUpdate,
      setDirty,
      saveWithPriority,
    ],
  );

  const handleLayerLockChange = useCallback(
    (layerId: string, locked: boolean) => {
      setLayerLocked(layerId, locked);
      const members = (effectivePage?.elements ?? []).filter(
        (el) => el.layerId === layerId,
      );
      for (const el of members) {
        canvasHandle?.setElementLocked(el.elementId, locked);
        emitElementUpdate(el.elementId, { locked });
      }
      setDirty(true);
      saveWithPriority("debounced");
    },
    [
      setLayerLocked,
      effectivePage,
      canvasHandle,
      emitElementUpdate,
      setDirty,
      saveWithPriority,
    ],
  );

  const handleAssignElementToLayer = useCallback(
    (elementId: string, layerId: string | null) => {
      assignElementToLayer(elementId, layerId);
      emitElementUpdate(elementId, { layerId });
      setDirty(true);
      saveWithPriority("debounced");
    },
    [assignElementToLayer, emitElementUpdate, setDirty, saveWithPriority],
  );

  // ── Native OCG (PDF "layers") mutations ───────────────────────────────────
  // Unlike user layers (scene-graph only), OCG groups live in the PDF binary.
  // We bake the mutation via /api/pdf/ocg then re-parse so the `layers` list +
  // page rendering reflect the new state. Serialised + guarded by `ocgBusyIds`.
  const runOcgOperation = useCallback(
    async (
      ocgId: number,
      operation: {
        action: "visibility" | "locked" | "remove";
        value?: boolean;
      },
    ) => {
      const file = currentPdfFileRef.current;
      if (!file) return;
      setOcgBusyIds((prev) => (prev.includes(ocgId) ? prev : [...prev, ocgId]));
      try {
        const blob = await applyOcgLayers.mutateAsync({
          file,
          operations: [{ ocgId, ...operation }],
        });
        // Re-parse so the OCG list + page appearance match the new binary.
        adoptModifiedPdf(blob, { reparse: true });
      } catch (error) {
        clientLogger.error("[editor] OCG operation failed", error);
      } finally {
        setOcgBusyIds((prev) => prev.filter((id) => id !== ocgId));
      }
    },
    [applyOcgLayers, adoptModifiedPdf],
  );

  const handleOcgVisibilityChange = useCallback(
    (ocgId: number, visible: boolean) => {
      void runOcgOperation(ocgId, { action: "visibility", value: visible });
    },
    [runOcgOperation],
  );

  const handleOcgLockChange = useCallback(
    (ocgId: number, locked: boolean) => {
      void runOcgOperation(ocgId, { action: "locked", value: locked });
    },
    [runOcgOperation],
  );

  const handleOcgRemove = useCallback(
    (ocgId: number) => {
      void runOcgOperation(ocgId, { action: "remove" });
    },
    [runOcgOperation],
  );

  // Delete an existing PDF annotation from the Annotations panel. Reuses the
  // editor's single-element removal flow (scene-graph + canvas + bake), so the
  // annotation is physically removed (redact/in-place) on the next save.
  const handleAnnotationDelete = useCallback(
    (elementId: string) => {
      // Reuse the canonical canvas delete path: select the targeted annotation
      // then `deleteSelected()`. That removes the Fabric object, records undo,
      // and fires onElementRemoved → handleElementRemoved (scene-graph shrink +
      // backend delete + PDF bake) — identical to pressing Delete on it.
      if (canvasHandle) {
        canvasHandle.selectElement(elementId);
        canvasHandle.deleteSelected();
        setDirty(true);
        saveWithPriority("immediate");
      } else {
        // No live canvas (defensive): fall back to the direct removal flow.
        void handleElementRemoved(elementId);
      }
    },
    [canvasHandle, handleElementRemoved, setDirty, saveWithPriority],
  );

  // Handler pour le téléchargement de fichiers embarqués
  const handleDownloadFile = useCallback((file: { dataUrl: string; name: string }) => {
    const link = document.createElement("a");
    link.href = file.dataUrl;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, []);

  // ── Document attachments + associated files (issue #78) ─────────────────────
  // Add / remove embedded file attachments and ISO 32000-2 associated files
  // (Factur-X / ZUGFeRD / Order-X) through /api/pdf/attachments, then adopt the
  // returned binary. No re-parse: attachments don't move any page element. The
  // panel list is overridden optimistically until the next reload, when
  // useDocument re-parses `embeddedFiles` from the saved binary (authoritative).
  const [attachmentsOverride, setAttachmentsOverride] = useState<
    EmbeddedFileObject[] | null
  >(null);
  const [attachmentBusy, setAttachmentBusy] = useState(false);

  // A fresh parse (document reload / page-op re-parse) is authoritative — drop
  // the optimistic override so the panel reflects the re-parsed attachments.
  useEffect(() => {
    setAttachmentsOverride(null);
  }, [embeddedFiles]);

  const displayedEmbeddedFiles = attachmentsOverride ?? embeddedFiles;

  /** Build an optimistic panel entry for a just-embedded local file. */
  const toAttachmentView = useCallback((file: File): EmbeddedFileObject => {
    const id = globalThis.crypto?.randomUUID?.() ?? `att-${file.name}-${file.size}`;
    return {
      fileId: id,
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      description: null,
      creationDate: null,
      modificationDate: null,
      // Object URL keeps the file immediately downloadable from the panel; it is
      // released when the editor page unloads.
      dataUrl: URL.createObjectURL(file),
    };
  }, []);

  const handleAddAttachments = useCallback(
    async (newFiles: File[]) => {
      if (newFiles.length === 0) return;
      const base = await getPreparedBlob();
      const source = base ?? currentPdfFileRef.current;
      if (!source) return;
      setAttachmentBusy(true);
      try {
        const docName = currentPdfFileRef.current?.name ?? "document.pdf";
        let working: Blob = source;
        const added: EmbeddedFileObject[] = [];
        for (const f of newFiles) {
          const fd = new FormData();
          fd.append("file", new File([working], docName, { type: "application/pdf" }));
          fd.append("action", "add");
          fd.append("attachment", f);
          const resp = await fetch("/api/pdf/attachments", {
            method: "POST",
            body: fd,
          });
          if (!resp.ok) throw new Error(`add attachment failed: ${resp.status}`);
          working = await resp.blob();
          added.push(toAttachmentView(f));
        }
        adoptModifiedPdf(working, { reparse: false });
        setAttachmentsOverride((prev) => [...(prev ?? embeddedFiles), ...added]);
        toast({ title: t("attachments.toasts.added", { count: newFiles.length }) });
      } catch (err) {
        clientLogger.error("[editor] add attachment failed", err);
        toast({ variant: "destructive", title: t("attachments.toasts.addFailed") });
      } finally {
        setAttachmentBusy(false);
      }
    },
    [getPreparedBlob, adoptModifiedPdf, embeddedFiles, toAttachmentView, toast, t],
  );

  const handleRemoveAttachment = useCallback(
    async (file: EmbeddedFileObject) => {
      const base = await getPreparedBlob();
      const source = base ?? currentPdfFileRef.current;
      if (!source) return;
      setAttachmentBusy(true);
      try {
        const docName = currentPdfFileRef.current?.name ?? "document.pdf";
        const fd = new FormData();
        fd.append("file", new File([source], docName, { type: "application/pdf" }));
        fd.append("action", "remove");
        fd.append("name", file.name);
        const resp = await fetch("/api/pdf/attachments", {
          method: "POST",
          body: fd,
        });
        if (!resp.ok) throw new Error(`remove attachment failed: ${resp.status}`);
        const working = await resp.blob();
        adoptModifiedPdf(working, { reparse: false });
        setAttachmentsOverride((prev) =>
          (prev ?? embeddedFiles).filter((f) => f.fileId !== file.fileId),
        );
        toast({ title: t("attachments.toasts.removed") });
      } catch (err) {
        clientLogger.error("[editor] remove attachment failed", err);
        toast({ variant: "destructive", title: t("attachments.toasts.removeFailed") });
      } finally {
        setAttachmentBusy(false);
      }
    },
    [getPreparedBlob, adoptModifiedPdf, embeddedFiles, toast, t],
  );

  // Handler pour les clics sur les liens hypertexte
  const handleHyperlinkClick = useCallback((linkUrl?: string | null, linkPage?: number | null) => {
    if (linkUrl) {
      // Un lien provient du PDF (source non fiable) : n'ouvrir QUE du http(s).
      // Bloque les schemes dangereux (javascript:, data:, file:…) → anti-XSS,
      // + noopener,noreferrer pour couper l'accès à window.opener.
      try {
        const parsed = new URL(linkUrl, window.location.href);
        if (parsed.protocol === "https:" || parsed.protocol === "http:") {
          window.open(parsed.toString(), "_blank", "noopener,noreferrer");
        } else {
          clientLogger.warn("[editor] Blocked non-http(s) hyperlink", parsed.protocol);
        }
      } catch {
        clientLogger.warn("[editor] Invalid hyperlink URL", linkUrl);
      }
    } else if (linkPage) {
      navigateToPage(linkPage - 1, "start"); // linkPage is 1-indexed
    }
  }, [navigateToPage]);

  // Handler pour l'ajout d'image
  const handleAddImage = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // Fill & Sign (mode Adobe) : passe le document en mode remplissage — le panneau
  // formulaire bascule en « fill » et l'overlay des champs devient cliquable.
  const handleFillSign = useCallback(() => {
    setFormsMode("fill");
    if (!showFormsPanel) toggleFormsPanel();
  }, [setFormsMode, showFormsPanel, toggleFormsPanel]);

  // Ouvre le dialog de capture (dessin / texte / import) préréglé sur le kind
  // demandé (signature ou paraphe). Insertion LIBRE (toolbar) : aucun widget
  // cible.
  const handleInsertSignature = useCallback(
    (kind?: "signature" | "initials") => {
      signatureTargetRef.current = null;
      setSignatureDialogKind(kind ?? "signature");
      setSignatureDialogOpen(true);
    },
    [],
  );

  // Remplir & Signer : clic sur un WIDGET SIGNATURE du PDF → ouvre le dialog
  // de capture en mémorisant le rect ET l'identité du widget ; la signature
  // capturée y sera AJUSTÉE (ratio préservé, centrée) au lieu d'un placement
  // libre, et l'image posée restera liée au widget (clic suivant = sélection).
  const handleSignatureFieldClick = useCallback(
    (element: FormFieldElement) => {
      signatureTargetRef.current = {
        ...element.bounds,
        widgetId: element.elementId,
      };
      setSignatureDialogKind("signature");
      setSignatureDialogOpen(true);
    },
    [],
  );

  // Insère la signature/paraphe capturé comme élément image, déplaçable et
  // redimensionnable, exactement comme un ajout d'image (même chemin de save).
  // Quand un widget signature a été cliqué (Remplir & Signer), l'image est
  // ajustée aux bounds du widget. L'outil bascule sur « select » pour que la
  // marque fraîchement posée soit immédiatement saisissable (déplacement /
  // redimensionnement sans friction).
  const handleSignatureInsert = useCallback(
    (sig: {
      dataUrl: string;
      width: number;
      height: number;
      kind: "signature" | "initials";
    }) => {
      const target = signatureTargetRef.current;
      signatureTargetRef.current = null;
      canvasHandle?.addImage(
        sig.dataUrl,
        sig.width,
        sig.height,
        target ?? undefined,
      );
      setSignatureDialogOpen(false);
      setActiveTool("select");
      setDirty(true);
      saveWithPriority("immediate");
    },
    [canvasHandle, setActiveTool, setDirty, saveWithPriority],
  );

  // Insertion UN-CLIC d'une marque du compte depuis le dropdown de la toolbar
  // (placement libre — jamais un widget cible, le dropdown n'est pas atteignable
  // pendant le dialog modal de capture).
  const handleInsertSavedSignature = useCallback(
    (sig: {
      dataUrl: string;
      width: number;
      height: number;
      kind: "signature" | "initials";
    }) => {
      signatureTargetRef.current = null;
      handleSignatureInsert(sig);
    },
    [handleSignatureInsert],
  );

  // Handler pour le chargement de l'image
  const handleImageFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      // Vérifier le type de fichier
      if (!file.type.startsWith("image/")) {
        toast({
          variant: "destructive",
          title: t("error.invalidImageType"),
        });
        return;
      }

      // Vérifier la taille (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        toast({
          variant: "destructive",
          title: t("error.imageTooLarge"),
        });
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        const img = new Image();
        img.onload = () => {
          canvasHandle?.addImage(dataUrl, img.width, img.height);
          setDirty(true);
          saveWithPriority("immediate");
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);

      // Reset input pour permettre de sélectionner le même fichier
      event.target.value = "";
    },
    [t, toast, canvasHandle, setDirty, saveWithPriority]
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignorer si on est dans un input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      // Ctrl/Cmd + Z - Undo
      if (cmdOrCtrl && !e.shiftKey && e.key === "z") {
        e.preventDefault();
        handleUndo();
        return;
      }

      // Ctrl/Cmd + Shift + Z or Ctrl/Cmd + Y - Redo
      if (
        (cmdOrCtrl && e.shiftKey && e.key === "z") ||
        (cmdOrCtrl && e.key === "y")
      ) {
        e.preventDefault();
        handleRedo();
        return;
      }

      // Ctrl/Cmd + S - Save
      if (cmdOrCtrl && e.key === "s") {
        e.preventDefault();
        save();
        return;
      }

      // Ctrl/Cmd + D - Duplicate
      if (cmdOrCtrl && e.key === "d") {
        e.preventDefault();
        handleDuplicate();
        return;
      }

      // Ctrl/Cmd + ] - Bring selection to front (z-order)
      if (cmdOrCtrl && e.key === "]") {
        if (selectedElementIds.length > 0) {
          e.preventDefault();
          handleBringToFront();
        }
        return;
      }

      // Ctrl/Cmd + [ - Send selection to back (z-order)
      if (cmdOrCtrl && e.key === "[") {
        if (selectedElementIds.length > 0) {
          e.preventDefault();
          handleSendToBack();
        }
        return;
      }

      // Ctrl/Cmd + F - Find & replace
      if (cmdOrCtrl && e.key === "f") {
        e.preventDefault();
        setFindReplaceOpen(true);
        return;
      }

      // Ctrl/Cmd + C - Copy selection to the app clipboard (only when elements
      // are selected; otherwise leave native text copy alone).
      if (cmdOrCtrl && e.key === "c") {
        if (selectedElementIds.length > 0) {
          e.preventDefault();
          handleCopy();
        }
        return;
      }

      // Ctrl/Cmd + X - Cut selection.
      if (cmdOrCtrl && e.key === "x") {
        if (selectedElementIds.length > 0) {
          e.preventDefault();
          handleCut();
        }
        return;
      }

      // Ctrl/Cmd + V - Paste the app clipboard.
      if (cmdOrCtrl && e.key === "v") {
        if (clipboard.length > 0) {
          e.preventDefault();
          handlePaste();
        }
        return;
      }

      // Delete or Backspace - Delete selected
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedElementIds.length > 0) {
          e.preventDefault();
          handleDelete();
        }
        return;
      }

      // Escape - Deselect
      if (e.key === "Escape") {
        clearSelection();
        setActiveTool("select");
        return;
      }

      // Page navigation — PageDown/PageUp always, ArrowDown/ArrowUp only when
      // nothing is selected (so arrows still nudge a selected element). Routes
      // through navigateToPage → scrolls into view in continuous mode.
      const noSelection = selectedElementIds.length === 0;
      if (e.key === "PageDown" || (e.key === "ArrowDown" && noSelection)) {
        e.preventDefault();
        navigateToPage(effectivePageIndex + 1, "start");
        return;
      }
      if (e.key === "PageUp" || (e.key === "ArrowUp" && noSelection)) {
        e.preventDefault();
        navigateToPage(effectivePageIndex - 1, "start");
        return;
      }

      // Tool shortcuts
      if (!cmdOrCtrl && !e.shiftKey && !e.altKey) {
        switch (e.key.toLowerCase()) {
          case "v":
            setActiveTool("select");
            break;
          case "t":
            setActiveTool("text");
            break;
          case "s":
            setActiveTool("shape");
            break;
          case "a":
            setActiveTool("annotation");
            break;
          case "h":
            setActiveTool("hand");
            break;
          case "i":
            setActiveTool("image");
            handleAddImage();
            break;
          case "f":
            setActiveTool("form_field");
            break;
        }
      }

      // Zoom shortcuts — pas multiplicatifs fluides (×1.25), clampés par le
      // store. Ctrl+0 = ajuster la page (mode fit, recalculé au resize),
      // Ctrl+1 = 100 % (zoom manuel → sort du mode fit).
      if (cmdOrCtrl) {
        if (e.key === "=" || e.key === "+") {
          e.preventDefault();
          handleManualZoomChange(zoom * 1.25);
        } else if (e.key === "-") {
          e.preventDefault();
          handleManualZoomChange(zoom / 1.25);
        } else if (e.key === "0") {
          e.preventDefault();
          handleFitPage();
        } else if (e.key === "1") {
          e.preventDefault();
          handleManualZoomChange(1);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    handleUndo,
    handleRedo,
    handleDelete,
    handleDuplicate,
    handleBringToFront,
    handleSendToBack,
    handleAddImage,
    save,
    selectedElementIds,
    zoom,
    clearSelection,
    setActiveTool,
    handleManualZoomChange,
    handleFitPage,
    navigateToPage,
    effectivePageIndex,
    handleCopy,
    handleCut,
    handlePaste,
    clipboard,
  ]);

  // Rendu conditionnel pour chargement/erreur
  if (loading) {
    return (
      <LoadingScreen
        value={loadProgress.value}
        phase={loadProgress.phase}
        pagesParsed={loadProgress.pagesParsed}
        pagesTotal={loadProgress.pagesTotal}
      />
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center">
          <AlertCircle className="h-12 w-12 text-destructive" />
          <div>
            <h2 className="text-lg font-semibold">{t("error.title")}</h2>
            <p className="text-muted-foreground">{error}</p>
          </div>
          <Button onClick={() => router.push("/documents")}>
            {t("error.backToDocuments")}
          </Button>
        </div>
      </div>
    );
  }

  // Informations sur la page active (suit la page focalisée en mode continu).
  const pageInfo = effectivePage
    ? {
        width: effectivePage.dimensions.width,
        height: effectivePage.dimensions.height,
        rotation: effectivePage.dimensions.rotation,
      }
    : undefined;

  // Format de la dernière sauvegarde
  const lastSavedText = lastSaved
    ? t("lastSaved", {
        time: lastSaved.toLocaleTimeString(),
      })
    : t("notSaved");

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Hidden file input for image upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageFileChange}
      />

      {/* Header */}
      <header className="flex items-center justify-between gap-2 border-b px-2 py-2 md:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/documents">
            <Button variant="ghost" size="icon" title={t("back")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="min-w-0">
            {isEditingName ? (
              <div className="flex items-center gap-1">
                <input
                  ref={nameInputRef}
                  type="text"
                  value={editedName}
                  onChange={(e) => setEditedName(e.target.value)}
                  onKeyDown={handleNameKeyDown}
                  onBlur={handleConfirmRename}
                  className="text-base font-semibold bg-transparent border-b-2 border-primary outline-none px-1 py-0.5 min-w-[120px] sm:min-w-[200px]"
                  placeholder={t("untitled")}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={handleConfirmRename}
                  title={t("confirm")}
                >
                  <Check className="h-3.5 w-3.5 text-green-600" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={handleCancelRename}
                  title={t("cancel")}
                >
                  <X className="h-3.5 w-3.5 text-red-600" />
                </Button>
              </div>
            ) : (
              <div className="flex min-w-0 items-center gap-1 group cursor-pointer" onClick={handleStartRename}>
                <h1 className="min-w-0 truncate text-base font-semibold hover:text-primary transition-colors">
                  {name || t("untitled")}
                  {isDirty && <span className="ml-1 text-muted-foreground">*</span>}
                </h1>
                <Pencil className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {t("pageIndicator", {
                current: currentPageIndex + 1,
                total: pages.length,
              })}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 md:gap-3">
          {/* Collaborateurs connectés */}
          {collaboratorCount > 0 && (
            <CollaboratorsList collaborators={collaborators} maxVisible={4} />
          )}

          {/* Indicateur de connexion WebSocket */}
          <div
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
            title={isConnected ? t("connection.connected") : t("connection.disconnected")}
          >
            {isConnected ? (
              <Wifi className="h-3.5 w-3.5 text-green-500" />
            ) : (
              <WifiOff className="h-3.5 w-3.5 text-red-500" />
            )}
          </div>

          {/* Below md these three actions collapse into the "Actions document"
              menu (mirror items marked md:hidden inside it) to keep the header
              compact; the canvas stays the priority on mobile. */}
          <Button
            variant="outline"
            size="sm"
            className="hidden gap-2 md:inline-flex"
            onClick={() => setShowShareDialog(true)}
            disabled={!storedDocumentId}
          >
            <Users className="h-4 w-4" />
            <span className="hidden sm:inline">{t("share")}</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="hidden gap-2 md:inline-flex"
            onClick={handleExport}
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">{t("export")}</span>
          </Button>
          <Button
            size="sm"
            className="hidden gap-2 md:inline-flex"
            onClick={save}
            disabled={saving || !isDirty}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">{t("save")}</span>
          </Button>

          {/* Document actions menu — keeps the header clean while exposing
              destructive/restorative ops behind an explicit affordance. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                aria-label="Actions document"
                disabled={restoring}
              >
                {restoring ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MoreVertical className="h-4 w-4" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {/* Mobile mirrors of the header actions (hidden from md up where
                  the dedicated buttons are visible). Same handlers/guards. */}
              <DropdownMenuItem
                className="md:hidden"
                onClick={() => setShowShareDialog(true)}
                disabled={!storedDocumentId}
              >
                <Users className="mr-2 h-4 w-4" />
                <span>{t("share")}</span>
              </DropdownMenuItem>
              <DropdownMenuItem className="md:hidden" onClick={handleExport}>
                <Download className="mr-2 h-4 w-4" />
                <span>{t("export")}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="md:hidden"
                onClick={save}
                disabled={saving || !isDirty}
              >
                {saving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                <span>{t("save")}</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="md:hidden" />
              <DropdownMenuItem
                onClick={handleRestoreOriginal}
                disabled={!storedDocumentId || restoring}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                <div className="flex flex-col">
                  <span>Restaurer l&apos;original (v1)</span>
                  <span className="text-xs text-muted-foreground">
                    Repart du PDF d&apos;origine, archive les modifications
                  </span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleFlattenPdf}
                disabled={!currentPdfFile}
              >
                <Download className="mr-2 h-4 w-4" />
                <div className="flex flex-col">
                  <span>Aplatir et télécharger</span>
                  <span className="text-xs text-muted-foreground">
                    Fusionne les calques en une couche unique
                  </span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => handleExportOffice("docx")}
                disabled={!documentId || exportingOfficeFormat !== null}
              >
                {exportingOfficeFormat === "docx" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="mr-2 h-4 w-4" />
                )}
                <span>{t("office.exportWord")}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleExportOffice("xlsx")}
                disabled={!documentId || exportingOfficeFormat !== null}
              >
                {exportingOfficeFormat === "xlsx" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Sheet className="mr-2 h-4 w-4" />
                )}
                <span>{t("office.exportExcel")}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleExportOffice("pptx")}
                disabled={!documentId || exportingOfficeFormat !== null}
              >
                {exportingOfficeFormat === "pptx" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Presentation className="mr-2 h-4 w-4" />
                )}
                <span>{t("office.exportPowerPoint")}</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => handleExportFormat("png")}
                disabled={!documentId || exportingFormat !== null}
              >
                {exportingFormat === "png" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileImage className="mr-2 h-4 w-4" />
                )}
                <span>{t("office.exportPng")}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleExportFormat("jpeg")}
                disabled={!documentId || exportingFormat !== null}
              >
                {exportingFormat === "jpeg" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileImage className="mr-2 h-4 w-4" />
                )}
                <span>{t("office.exportJpeg")}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleExportFormat("webp")}
                disabled={!documentId || exportingFormat !== null}
              >
                {exportingFormat === "webp" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileImage className="mr-2 h-4 w-4" />
                )}
                <span>{t("office.exportWebp")}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleExportFormat("txt")}
                disabled={!documentId || exportingFormat !== null}
              >
                {exportingFormat === "txt" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileType className="mr-2 h-4 w-4" />
                )}
                <span>{t("office.exportText")}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleExportFormat("html")}
                disabled={!documentId || exportingFormat !== null}
              >
                {exportingFormat === "html" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileCode className="mr-2 h-4 w-4" />
                )}
                <span>{t("office.exportHtml")}</span>
              </DropdownMenuItem>
              {/* Universal export (#84): lower the current document into any
                  editable format via the GigaPDF SDK, entirely client-side. */}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>
                {t("office.exportEditableGroup")}
              </DropdownMenuLabel>
              {SDK_EXPORT_ITEMS.map(({ format, icon: Icon, labelKey }) => (
                <DropdownMenuItem
                  key={format}
                  onClick={() => handleExportModel(format)}
                  disabled={!currentPdfFile || exportingModelFormat !== null}
                >
                  {exportingModelFormat === format ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Icon className="mr-2 h-4 w-4" />
                  )}
                  <span>{t(labelKey)}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Toolbar */}
      <EditorToolbar
        documentFonts={documentFontOptions}
        activeTool={activeTool}
        onToolChange={setActiveTool}
        zoom={zoom}
        onZoomChange={handleManualZoomChange}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={handleUndo}
        onRedo={handleRedo}
        hasSelection={selectedElementIds.length > 0}
        onFormatAction={handleFormatAction}
        selectedElement={selectedElements.length === 1 ? selectedElements[0] : null}
        selectedTextElements={selectedTextElements}
        onElementStyleChange={handleTextStyleChange}
        textSelectionStyle={textSelectionStyle}
        applyTextSelectionStyle={applyTextSelectionStyle}
        shapeType={shapeType}
        onShapeTypeChange={setShapeType}
        annotationType={annotationType}
        onAnnotationTypeChange={setAnnotationType}
        fieldKind={fieldKind}
        onFieldKindChange={setFieldKind}
        viewMode={viewMode}
        onViewModeChange={(mode) => {
          if (mode === viewMode) return;
          setViewMode(mode);
          if (mode === "continuous") {
            // Focus the page the user was on and bring it into view once the
            // scroller has mounted (next frame).
            activatePage(effectivePageIndex);
            requestAnimationFrame(() =>
              continuousViewRef.current?.scrollToPage(effectivePageIndex, "start"),
            );
          } else {
            // Leaving continuous: single-page view follows the active page.
            goToPage(effectivePageIndex);
          }
        }}
        // Rulers + draggable margins work in BOTH views (single-page mounts
        // them inside the EditorCanvas sheet, continuous via PageSlot). The
        // toggle is therefore always available.
        showRulers={showRulers}
        onToggleRulers={toggleRulers}
        rulerUnit={rulerUnit}
        onRulerUnitChange={setRulerUnit}
        fitMode={fitMode}
        onFitPage={handleFitPage}
        onFitWidth={handleFitWidth}
        strokeColor={strokeColor}
        onStrokeColorChange={setStrokeColor}
        fillColor={fillColor}
        onFillColorChange={setFillColor}
        strokeWidth={strokeWidth}
        onStrokeWidthChange={setStrokeWidth}
        onDelete={handleDelete}
        onDuplicate={handleDuplicate}
        onBringToFront={handleBringToFront}
        onSendToBack={handleSendToBack}
        onAddImage={handleAddImage}
        onFillSign={handleFillSign}
        onInsertSignature={handleInsertSignature}
        onInsertSavedSignature={handleInsertSavedSignature}
        onInsertTable={handleInsertTable}
        onInsertLink={handleInsertLink}
        onRemoveLink={handleRemoveLink}
        onInsertSvg={handleInsertSvg}
        namedDestinations={createdNamedDests}
        onInsertBlankPage={handleInsertBlankPage}
        onInsertList={handleInsertList}
        pageCount={pages.length}
        currentFile={currentPdfFile}
        onToggleFormsPanel={toggleFormsPanel}
        onFlattenPdf={handleFlattenPdf}
        isContentEditActive={isContentEditActive}
        onToggleContentEdit={handleToggleContentEdit}
        onSearchGoToPage={(pageNumber) => {
          // Search returns 1-based page numbers; navigateToPage expects 0-based
          // and scrolls the page into view in continuous mode.
          navigateToPage(pageNumber - 1, "start");
        }}
        onWatermarkApplied={handleWatermarkApplied}
        onCompressApplied={handleCompressApplied}
        onOcrApplied={handleOcrApplied}
        currentPageNumber={effectivePageIndex + 1}
        documentLanguage={documentLanguage}
        onIndexOcr={handleIndexOcr}
        indexOcrBusy={indexOcrBusy}
        onSignApplied={handleSignApplied}
        headersFootersEnabled={headersFootersEnabled}
        onToggleHeadersFooters={handleToggleHeadersFooters}
        onToggleHeaderFooterZones={handleToggleHeaderFooterZones}
        headerFooterEditing={hfEditMode}
        {...(headerFooterContext ? { headerFooterContext } : {})}
        {...(hfSelectedTextElements ? { hfSelectedTextElements } : {})}
        hfOnElementStyleChange={hfOnElementStyleChange}
        headerFooterDifferentFirstPage={hfDef?.differentFirstPage ?? false}
        headerFooterDifferentOddEven={hfDef?.differentOddEven ?? false}
        onToggleHeaderFooterDifferentFirstPage={
          handleToggleHfDifferentFirstPage
        }
        onToggleHeaderFooterDifferentOddEven={handleToggleHfDifferentOddEven}
        onAddPageFormat={handleAddPageFormat}
        onHeaderFooterApply={handleHeaderFooterApply}
        onHeaderFooterRemove={handleHeaderFooterRemove}
        onPresentationApplied={handleApplyPresentation}
        headerFooterInitialHeader={headerFooterInitialHeader}
        headerFooterInitialFooter={headerFooterInitialFooter}
        headerFooterBusy={headerFooterBusy}
        redactionMarkCount={redactionMarkCount}
        onRedactApply={handleRedactApply}
        onRedactClear={handleRedactClear}
        onRedactPiiAuto={() => setShowRedactPiiDialog(true)}
        redactBusy={redactBusy}
        // Mobile bottom-sheet "Édition" section — the SAME wiring as the
        // EditorEditTools bar below (hidden < md), so no action is lost when
        // the secondary bar folds away on small screens.
        editTools={{
          onFindReplace: () => setFindReplaceOpen(true),
          onCopy: handleCopy,
          onCut: handleCut,
          onPaste: handlePaste,
          onCopyFormat: handleCopyFormat,
          hasSelection: selectedElementIds.length > 0,
          canCopyFormat,
          canPaste,
          formatPainterArmed,
          onToggleTableEdit: handleToggleTableEdit,
          tableEditActive: showTableEdit,
          tableCount: documentTables.length,
        }}
      />

      {/* P7 — Édition (#83) : barre secondaire (rechercher/remplacer,
          presse-papiers, format painter). Composant autonome rendu sous la
          barre principale pour garder editor-toolbar.tsx intact. */}
      <EditorEditTools
        onFindReplace={() => setFindReplaceOpen(true)}
        onCopy={handleCopy}
        onCut={handleCut}
        onPaste={handlePaste}
        onCopyFormat={handleCopyFormat}
        hasSelection={selectedElementIds.length > 0}
        canCopyFormat={canCopyFormat}
        canPaste={canPaste}
        formatPainterArmed={formatPainterArmed}
        // Table editing surfaces a selectable overlay over the active page in
        // BOTH the single-page editor (EditorCanvas `overlay`) and the continuous
        // view (PageSlot `renderActiveOverlay`).
        onToggleTableEdit={handleToggleTableEdit}
        tableEditActive={showTableEdit}
        tableCount={documentTables.length}
      />

      {/* Main content — `relative` so the floating mobile zoom cluster can
          anchor bottom-right of the canvas row (above the footer) in BOTH view
          modes (continuous main is overflow-hidden, single-page main scrolls). */}
      <div className="relative flex flex-1 overflow-hidden">
        {/* Pages sidebar — inline from md up; below md the SAME component is
            served through the left Sheet (footer PanelLeft button). */}
        <div className="hidden md:flex">
          <PagesSidebar
          pages={pages}
          currentPageIndex={effectivePageIndex}
          onPageSelect={(index) => navigateToPage(index, "start")}
          onPageAdd={handleAddPage}
          onPageDelete={handleDeletePage}
          onPageReorder={handleReorderPages}
          onPageDuplicate={handleDuplicatePage}
          previewBaseUrl={process.env.NEXT_PUBLIC_API_URL}
          onPageRotate={handlePageRotate}
          onPageExtract={handlePageExtract}
          onPageResize={handlePageResize}
          thumbnails={thumbnails}
          />
        </div>

        {/* Canvas — continuous virtualised scroller OR legacy single page.
            Continuous mode owns its own scroll container, so the <main> does
            not scroll there; single mode keeps the historical overflow + the
            mouse-move collaboration cursor tracking. */}
        <main
          ref={canvasRef}
          className={
            // min-w-0: allow the canvas to shrink inside the flex row instead
            // of forcing horizontal page scroll on narrow viewports.
            isContinuous
              ? "relative min-w-0 flex-1 overflow-hidden"
              : "relative min-w-0 flex-1 overflow-auto"
          }
          onMouseMove={isContinuous ? undefined : handleMouseMove}
        >
          {/* Deep content-edit (#98): one provider wraps BOTH views so the
              viewport-level toolbar and the in-sheet editable zones share a
              single state instance (context flows by fiber position, so the
              zones reach it even when mounted deep inside PageSlot via
              `renderActiveOverlay`). The toolbar is a viewport sibling pinned to
              the top of the canvas area; the zones mount in the page sheet
              (EditorCanvas `overlay` single / `renderActiveOverlay` continuous)
              — the proven FormFillOverlay model — so they align with the glyphs
              at `bounds*zoom` from the sheet top-left in BOTH modes. */}
          <ContentEditProvider
            currentFile={currentPdfFile}
            pageIndex={effectivePageIndex}
            zoom={zoom}
            isActive={isContentEditActive}
            onModificationsChange={handleContentModificationsChange}
          >
            <ContentEditToolbar />
            {/* SL2 — hidden picker for inserting an image into a header/footer
                band (triggered from the contextual FormattingToolbar). */}
            <input
              ref={hfImageInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/tiff"
              className="hidden"
              onChange={handleHfImageInputChange}
            />
            {isContinuous ? (
            <ContinuousPageView
              ref={continuousViewRef}
              pages={pages}
              zoom={zoom}
              pdfFile={currentPdfFile}
              bakedPageIndices={bakedPageIndices}
              documentId={documentId}
              tool={activeTool}
              activePageIndex={effectivePageIndex}
              onActivatePage={activatePage}
              showRulers={showRulers}
              rulerUnit={rulerUnit}
              margins={pageMargins}
              onMarginsCommit={handleMarginsCommit}
              getFontFaceName={getFontFaceName}
              fontsLoading={fontsLoading}
              shapeType={shapeType}
              annotationType={annotationType}
              fieldKind={fieldKind}
              strokeColor={strokeColor}
              fillColor={fillColor}
              strokeWidth={strokeWidth}
              onHyperlinkClick={handleHyperlinkClick}
              onRedactionMarksChanged={setRedactionMarkCount}
              fitMode={fitMode}
              onFitZoomChange={setZoom}
              // Pinch tactile = zoom MANUEL : sort du mode fit puis setZoom
              // (même contrat que la molette / les presets de la toolbar).
              onManualZoomChange={handleManualZoomChange}
              onElementAdded={handleElementAdded}
              onInkDrawn={handleAddInk}
              onElementModified={handleElementModified}
              onElementReordered={handleElementReordered}
              onElementRemoved={handleElementRemoved}
              onSelectionChanged={handleSelectionChanged}
              onTextSelectionStyleChanged={handleTextSelectionStyleChanged}
              onCanvasReady={setCanvasHandle}
              headerFooterActive={hfEditMode}
              fillSignActive={fillSignActive}
              onSignatureFieldClick={handleSignatureFieldClick}
              renderActiveOverlay={(index) => (
                <>
                  {/* SL2 — Word-like editable running header/footer bands for the
                      ACTIVE page (default zone). Overlaid in the same sheet space
                      as the other overlays; the background raster already excludes
                      the baked /GPHF band (headerFooterActive), so no doubling. */}
                  {hfEditMode && hfDef ? (
                    <HeaderFooterZone
                      def={hfDef}
                      onChange={handleHfDefChange}
                      registry={hfRegistryRef.current}
                      pxPerPt={zoom}
                      pageNumber={index + 1}
                      {...(hfZoneLabel ? { zoneLabel: hfZoneLabel } : {})}
                      onFocusedTextItemChange={handleHfFocusedChange}
                    />
                  ) : null}
                  {/* P1 — form-fill overlay for the ACTIVE page (parity with the
                      single-page editor's EditorCanvas `overlay`). PageSlot renders
                      this inside the active page's sheet (page×zoom space), so the
                      field rects line up exactly as in single-page mode. */}
                  {fillSignActive && formFillHighlights.length > 0 ? (
                    <FormFillOverlay
                      fields={formFillHighlights}
                      currentPageIndex={index}
                      zoom={zoom}
                      focusedFieldName={focusedFormField}
                    />
                  ) : null}
                  {/* Collaborator cursors for the ACTIVE page only (cursors on
                      non-active visible pages are intentionally out of scope). */}
                  <CollaborationOverlay
                    cursors={cursors}
                    currentPageId={pages[index]?.pageId}
                    zoom={zoom}
                  />
                  {renderTableEditOverlay()}
                  {/* Deep content-edit zones for the ACTIVE page — same sheet
                      space (PageChrome) as the FormFillOverlay above, so they
                      line up with the glyphs. Background is sampled from the
                      active page's Fabric canvas via the imperative handle. */}
                  <ContentEditZones
                    pageIndex={index}
                    getPdfCanvas={() => canvasHandle?.getPdfCanvas() ?? null}
                  />
                </>
              )}
            />
          ) : (
            <>
              <EditorCanvas
                page={currentPage}
                documentId={documentId}
                getFontFaceName={getFontFaceName}
                fontsLoading={fontsLoading}
                tool={activeTool}
                zoom={zoom}
                fitMode={fitMode}
                onFitZoomChange={setZoom}
                // Rulers + draggable margins (same toolbar toggle + commit flow
                // as the continuous view). Margins for the current page come
                // from the binary; markers appear only when known.
                showRulers={showRulers}
                rulerUnit={rulerUnit}
                margins={pageMargins[currentPageIndex] ?? null}
                onMarginsCommit={(m) => handleMarginsCommit(currentPageIndex, m)}
                shapeType={shapeType}
                annotationType={annotationType}
                fieldKind={fieldKind}
                strokeColor={strokeColor}
                fillColor={fillColor}
                strokeWidth={strokeWidth}
                onElementAdded={handleElementAdded}
                onInkDrawn={handleAddInk}
                onElementModified={handleElementModified}
                onElementReordered={handleElementReordered}
                onElementRemoved={handleElementRemoved}
                onSelectionChanged={handleSelectionChanged}
                onTextSelectionStyleChanged={handleTextSelectionStyleChanged}
                onZoomChanged={handleManualZoomChange}
                onCanvasReady={setCanvasHandle}
                onHyperlinkClick={handleHyperlinkClick}
                onRedactionMarksChanged={setRedactionMarkCount}
                // Word-like H/F edit mode: when on, the page background raster
                // EXCLUDES the baked `/GPHF` band so the editable bands below
                // aren't doubled (parity with the continuous view).
                headerFooterActive={hfEditMode}
                fillSignActive={fillSignActive}
                onSignatureFieldClick={handleSignatureFieldClick}
                overlay={
                  <>
                    {/* SL2 — Word-like editable running header/footer bands for
                        the current page (single-page parity with the continuous
                        view's PageSlot `renderActiveOverlay`). Mounted in the
                        same page×zoom sheet space as the form-fill overlay; the
                        background raster already excludes the baked `/GPHF` band
                        (headerFooterActive), so there is no doubling. The zone is
                        first-page/odd-even aware via `pageNumber`. */}
                    {hfEditMode && hfDef ? (
                      <HeaderFooterZone
                        def={hfDef}
                        onChange={handleHfDefChange}
                        registry={hfRegistryRef.current}
                        pxPerPt={zoom}
                        pageNumber={currentPageIndex + 1}
                        {...(hfZoneLabel ? { zoneLabel: hfZoneLabel } : {})}
                        onFocusedTextItemChange={handleHfFocusedChange}
                      />
                    ) : null}
                    {fillSignActive && formFillHighlights.length > 0 ? (
                      <FormFillOverlay
                        fields={formFillHighlights}
                        currentPageIndex={currentPageIndex}
                        zoom={zoom}
                        focusedFieldName={focusedFormField}
                      />
                    ) : null}
                    {renderTableEditOverlay()}
                    {/* Deep content-edit zones in the page sheet (#98) — same
                        `overlay` slot as FormFillOverlay so they align with the
                        glyphs; the toolbar lives at the viewport level above.
                        Was a `<main>`-cover sibling before, which offset the
                        zones off the centered sheet. */}
                    <ContentEditZones
                      pageIndex={currentPageIndex}
                      getPdfCanvas={() => canvasHandle?.getPdfCanvas() ?? null}
                    />
                  </>
                }
              />

              {/* Overlay des curseurs des collaborateurs */}
              <CollaborationOverlay
                cursors={cursors}
                currentPageId={currentPage?.pageId}
                zoom={zoom}
              />
            </>
            )}
          </ContentEditProvider>
        </main>

        {/* Floating thumb-reachable zoom cluster (mobile only, md:hidden).
            Sibling of <main> anchored to the relative row, so it never scrolls
            with the single-page canvas and stays clear of the footer. Same
            manual-zoom contract as the toolbar (exits fit mode). */}
        <MobileZoomControls
          zoom={zoom}
          fitMode={fitMode}
          onZoomChange={handleManualZoomChange}
          onFitPage={handleFitPage}
          onFitWidth={handleFitWidth}
        />

        {/* Properties panel — inline from lg up; below lg the SAME component
            opens in a right Sheet on demand (footer button), so a selection
            never steals the canvas automatically. */}
        <div className="hidden lg:flex">
          <PropertiesPanel
          documentFonts={documentFontOptions}
          selectedElements={selectedElements}
          onElementUpdate={handleElementUpdate}
          pageInfo={pageInfo}
          zoom={zoom}
          allFieldNames={allFieldNames}
          userLayers={userLayers}
          onAssignElementToLayer={handleAssignElementToLayer}
          pageNumber={effectivePageIndex + 1}
          getDocumentBytes={getPreparedBlob}
          onPageBoxesApplied={(bytes) =>
            updateCurrentPdfFile(
              new File([new Uint8Array(bytes)], currentPdfFile?.name ?? "document.pdf", {
                type: "application/pdf",
              })
            )
          }
          onApplyTextStyle={handleApplyTextStyle}
          onReplaceImage={handleReplaceImage}
          />
        </div>

        {/* Document info sidebar (TOC, Layers, Embedded Files). Layers reflect
            the active page (the focused page in continuous mode). Secondary
            feature: simply hidden below xl (no drawer). */}
        <div className="hidden xl:flex">
          <DocumentInfoSidebar
          outlines={outlines}
          layers={layers}
          documentLanguage={documentLanguage}
          userLayers={userLayers}
          elements={effectivePage?.elements ?? []}
          selectedElementIds={selectedElementIds}
          embeddedFiles={displayedEmbeddedFiles}
          onNavigateToPage={handleNavigateToPage}
          onElementVisibilityChange={handleElementVisibilityChange}
          onElementLockChange={handleElementLockChange}
          onElementSelect={handleSelectElementFromLayer}
          onAnnotationDelete={handleAnnotationDelete}
          onLayerSelectMembers={handleSelectLayerMembers}
          onLayerCreate={handleLayerCreate}
          onLayerDelete={handleLayerDelete}
          onLayerRename={handleLayerRename}
          onLayerReorder={handleLayerReorder}
          onLayerVisibilityChange={handleLayerVisibilityChange}
          onLayerLockChange={handleLayerLockChange}
          onAssignElementToLayer={handleAssignElementToLayer}
          onOcgVisibilityChange={handleOcgVisibilityChange}
          onOcgLockChange={handleOcgLockChange}
          onOcgRemove={handleOcgRemove}
          ocgBusyIds={ocgBusyIds}
          onDownloadFile={handleDownloadFile}
          onAddAttachments={handleAddAttachments}
          onRemoveAttachment={handleRemoveAttachment}
          attachmentBusy={attachmentBusy}
          currentPageIndex={effectivePageIndex}
          onApplyOutline={handleApplyOutline}
          onDetectChapters={handleDetectChapters}
          onAddAnnotation={handleAddAnnotation}
          annotationAddBusy={annotationAddBusy}
          onListAnnotations={handleListAnnotations}
          onRemoveAnnotation={handleRemoveAnnotation}
          pageCount={pages.length}
          />
        </div>

        {/* Forms panel (conditionally shown) — inline from lg up; below lg the
            same toggle opens it in a right Sheet (see mobile drawers below). */}
        {showFormsPanel && (
          <div className="hidden lg:flex">
            <FormsPanel
            currentFile={currentPdfFile}
            mode={formsMode}
            onModeChange={(nextMode) => {
              setFormsMode(nextMode);
              setFocusedFormField(null);
            }}
            onFieldsLoaded={setLoadedFormFields}
            focusedFieldName={focusedFormField}
            designFields={designFields}
            onDesignFieldSelect={handleDesignFieldSelect}
            onDesignFieldReorder={handleDesignFieldReorder}
            onPdfUpdated={(blob) => {
              // Adopter le binaire modifié PAR LE MÊME CHEMIN que toutes les
              // autres mutations natives : updateCurrentPdfFile + save +
              // RE-PARSE. Sans le re-parse, l'overlay (valeurs des champs)
              // restait STALE après un remplissage via le panneau formulaire.
              adoptModifiedPdf(blob, { reparse: true });
            }}
            />
          </div>
        )}
      </div>

      {/* ── Mobile drawers ──────────────────────────────────────────────────
          The SAME panel components as the inline instances above, served in
          Radix Sheets on small screens. Open states are additionally gated by
          the media hooks so a drawer left open never lingers over the desktop
          layout after a resize. Content is portaled + unmounted when closed. */}
      <UiSheet
        open={showPagesSheet && isMobile}
        onOpenChange={setShowPagesSheet}
      >
        <SheetContent side="left" showClose={false} style={{ width: "13rem" }}>
          <div className="flex shrink-0 items-center justify-between border-b pl-3">
            <SheetTitle>{t("pages.title")}</SheetTitle>
            <SheetClose
              aria-label={t("cancel")}
              className="flex h-11 w-11 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </SheetClose>
          </div>
          <div className="flex min-h-0 flex-1">
            <PagesSidebar
              pages={pages}
              currentPageIndex={effectivePageIndex}
              onPageSelect={(index) => {
                navigateToPage(index, "start");
                setShowPagesSheet(false);
              }}
              onPageAdd={handleAddPage}
              onPageDelete={handleDeletePage}
              onPageReorder={handleReorderPages}
              onPageDuplicate={handleDuplicatePage}
              previewBaseUrl={process.env.NEXT_PUBLIC_API_URL}
              onPageRotate={handlePageRotate}
              onPageExtract={handlePageExtract}
              onPageResize={handlePageResize}
              thumbnails={thumbnails}
            />
          </div>
        </SheetContent>
      </UiSheet>

      <UiSheet
        open={showPropertiesSheet && isCompact}
        onOpenChange={setShowPropertiesSheet}
      >
        <SheetContent side="right" showClose={false} style={{ width: "17rem" }}>
          <div className="flex shrink-0 items-center justify-between border-b pl-3">
            <SheetTitle>{t("properties.title")}</SheetTitle>
            <SheetClose
              aria-label={t("cancel")}
              className="flex h-11 w-11 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </SheetClose>
          </div>
          <div className="flex min-h-0 flex-1">
            <PropertiesPanel
              documentFonts={documentFontOptions}
              selectedElements={selectedElements}
              onElementUpdate={handleElementUpdate}
              pageInfo={pageInfo}
              zoom={zoom}
              allFieldNames={allFieldNames}
              userLayers={userLayers}
              onAssignElementToLayer={handleAssignElementToLayer}
              pageNumber={effectivePageIndex + 1}
              getDocumentBytes={getPreparedBlob}
              onPageBoxesApplied={(bytes) =>
                updateCurrentPdfFile(
                  new File(
                    [new Uint8Array(bytes)],
                    currentPdfFile?.name ?? "document.pdf",
                    { type: "application/pdf" },
                  ),
                )
              }
              onApplyTextStyle={handleApplyTextStyle}
              onReplaceImage={handleReplaceImage}
            />
          </div>
        </SheetContent>
      </UiSheet>

      <UiSheet
        open={showFormsPanel && isCompact}
        onOpenChange={(open) => {
          if (!open) toggleFormsPanel();
        }}
      >
        <SheetContent side="right" showClose={false} style={{ width: "19rem" }}>
          <div className="flex shrink-0 items-center justify-between border-b pl-3">
            <SheetTitle>{t("forms.title")}</SheetTitle>
            <SheetClose
              aria-label={t("cancel")}
              className="flex h-11 w-11 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </SheetClose>
          </div>
          <div className="flex min-h-0 flex-1">
            <FormsPanel
              currentFile={currentPdfFile}
              mode={formsMode}
              onModeChange={(nextMode) => {
                setFormsMode(nextMode);
                setFocusedFormField(null);
              }}
              onFieldsLoaded={setLoadedFormFields}
              focusedFieldName={focusedFormField}
              designFields={designFields}
              onDesignFieldSelect={handleDesignFieldSelect}
              onDesignFieldReorder={handleDesignFieldReorder}
              onPdfUpdated={(blob) => {
                adoptModifiedPdf(blob, { reparse: true });
              }}
            />
          </div>
        </SheetContent>
      </UiSheet>

      {/* Share dialog (GED) — partage le document STOCKÉ, pas la copie de session */}
      <ShareDialog
        open={showShareDialog}
        onOpenChange={setShowShareDialog}
        documentId={storedDocumentId}
        documentName={name}
      />

      {/* P7 — Rechercher & remplacer (texte du scene graph, toutes pages) */}
      <FindReplaceDialog
        open={findReplaceOpen}
        onClose={() => setFindReplaceOpen(false)}
        pages={pages}
        onGoToOccurrence={handleFindReplaceGoTo}
        onReplaceOne={handleReplaceOne}
        onReplaceAll={handleReplaceAll}
      />

      {/* Redimensionnement de page (A4/Letter/Legal/personnalisé) */}
      {resizePageIndex !== null && (
        <ResizePageDialog
          open
          onClose={() => setResizePageIndex(null)}
          pageIndex={resizePageIndex}
          currentWidth={pages[resizePageIndex]?.dimensions.width}
          currentHeight={pages[resizePageIndex]?.dimensions.height}
          onApply={applyPageResize}
        />
      )}

      {/* Détection & caviardage automatique des PII */}
      <RedactPiiDialog
        open={showRedactPiiDialog}
        onClose={() => setShowRedactPiiDialog(false)}
        pages={pages}
        isApplying={redactBusy}
        onConfirm={handleRedactPiiAuto}
      />

      {/* Remplir & Signer — capture (dessin / texte / import) + signatures du compte */}
      <SignatureCaptureDialog
        open={signatureDialogOpen}
        defaultKind={signatureDialogKind}
        onClose={() => {
          setSignatureDialogOpen(false);
          // Annulation : oublier le widget signature ciblé pour qu'une
          // insertion ultérieure via la toolbar reste un placement libre.
          signatureTargetRef.current = null;
        }}
        onInsert={handleSignatureInsert}
      />

      {/* Status bar — flex-wrap so it never forces horizontal page scroll. */}
      <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t px-2 py-1.5 text-xs text-muted-foreground md:px-4">
        <div className="flex items-center gap-2 md:gap-4">
          {/* Mobile drawer openers (pure-CSS hidden on larger screens where
              the panels are inline). ≥44px targets on coarse pointers. */}
          <button
            type="button"
            onClick={() => setShowPagesSheet(true)}
            title={t("pages.title")}
            aria-label={t("pages.title")}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground pointer-coarse:h-11 pointer-coarse:w-11 md:hidden"
          >
            <PanelLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setShowPropertiesSheet(true)}
            title={t("properties.title")}
            aria-label={t("properties.title")}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground pointer-coarse:h-11 pointer-coarse:w-11 lg:hidden"
          >
            <SlidersHorizontal className="h-4 w-4" />
          </button>
          <span>
            {t("pageIndicator", {
              current: currentPageIndex + 1,
              total: pages.length,
            })}
          </span>
          <span className="hidden text-muted-foreground/60 md:inline">
            {t("shortcuts.hint")} (V: Select, T: Text, S: Shape, I: Image, F:
            Form)
          </span>
        </div>
        <div className="flex items-center gap-2">
          {saving && <Loader2 className="h-3 w-3 animate-spin" />}
          {saveError ? (
            <span className="text-destructive">{saveError}</span>
          ) : (
            <>
              {lastSavedText}
              {pendingChanges > 0 && (
                <span className="text-amber-500">
                  ({pendingChanges} {t("pendingChanges")})
                </span>
              )}
            </>
          )}
        </div>
        <div
          className="flex items-center gap-2"
          title={t("collaborators", { count: collaboratorCount })}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              isConnected ? "bg-green-500" : "bg-red-500"
            }`}
          />
          {/* Texte masqué sous md (le point de connexion + title suffisent) :
              garde le footer sur UNE ligne à 360px. */}
          <span className="hidden md:inline">
            {t("collaborators", { count: collaboratorCount })}
          </span>
        </div>
      </footer>
    </div>
  );
}
