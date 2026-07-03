"use client";

import React, { useRef, useEffect, useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type {
  PageObject,
  Tool,
  Element,
  ShapeType,
  AnnotationType,
  FieldType,
  FieldCreationKind,
  FormFieldElement,
  Bounds,
  TextStyle,
} from "@giga-pdf/types";
import type { Canvas as FabricCanvas, FabricObject } from "fabric";
import { clientLogger } from "@/lib/client-logger";
// Shared PDF-background builder — the same index-0 FabricImage construction the
// continuous-view PageCanvasHost uses, so the logic lives in one place.
import { addPdfBackground, backgroundRenderScale } from "./lib/pdf-background";
// Single canonical element-overlay renderer. In the continuous (Word-like)
// view, the active page mounts this same EditorCanvas in `embedded` mode, so the
// editable Fabric overlay is built identically there — never duplicated. The
// single-page editor injects its embedded-font resolver + edit-time hide-mask
// below.
import {
  renderElementsOverlay as renderElementsOverlayShared,
  // Paragraph EDIT-INTENT session (Adobe-like): a double-click on a member of
  // a coalesced paragraph group swaps the group's per-run objects for ONE
  // multi-line Textbox session; an unmodified exit restores them untouched.
  beginParagraphEditSession,
  restoreParagraphEditSession,
  sealParagraphEditSession,
} from "./render-elements";
// Pure Fabric<->Element helpers in lib/fabric-element-io.ts, so any surface that
// serialises Fabric objects back to Elements does so identically.
import {
  generateId,
  isBoldFontWeight,
  fabricObjectToElement as fabricObjectToElementImpl,
  fabricObjectToElements as fabricObjectToElementsImpl,
  sampleBackgroundUnder as sampleBackgroundUnderImpl,
  commitParagraphSession,
  refreshParagraphSessionAfterCommit,
} from "./lib/fabric-element-io";
// Word-like partial formatting: shared char-style mappers (model <-> Fabric)
// reused so setSelectionStyles / selection-style aggregation map fields the
// same way the renderer and serialiser do.
import {
  modelStyleToFabricChar,
  fabricCharToModelStyle,
  type FabricCharStyle,
} from "./lib/text-runs";
// Word-like rulers + draggable page margins. In the single-page view these are
// mounted INSIDE the canvas-container sheet (same gutter anchoring the continuous
// view uses inside PageChrome), reusing the exact same overlay + commit flow.
import { PageMarginOverlay } from "./page-margin-overlay";
import { PageRulers } from "./page-rulers";
import type { PageMargins } from "./lib/page-margins";
import type { RulerUnit } from "./lib/ruler-ticks";
// Tactile editing (mobile lot 2): per-tool touch-action, Fabric touch flags,
// touch-safe client coordinates (hand-tool pan) and app-level pinch-to-zoom.
import {
  touchActionForTool,
  allowTouchScrollingForTool,
  clientPointFromEvent,
} from "./lib/touch-interaction";
import { attachPinchZoom } from "./lib/pinch-zoom";

/** Zoom hard bounds (10% – 800%) shared by wheel, toolbar and fit modes. */
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
/** Multiplicative wheel/keyboard zoom step — fluid, never additive jumps. */
const WHEEL_ZOOM_FACTOR = 1.1;
/** Comfortable breathing room around the page inside the scroll viewport (px). */
const CANVAS_VIEWPORT_PADDING = 32;
/** Snap distance (canvas units) when dragging a form field near another field's edges. */
const FIELD_SNAP_DISTANCE = 4;

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/**
 * A Fabric IText in inline-edit mode, narrowed to the per-character selection
 * surface used by the Word-like partial-formatting bridge.
 */
type EditableTextObject = FabricObject & {
  isEditing?: boolean;
  selectionStart?: number;
  selectionEnd?: number;
  setSelectionStyles?: (
    styles: object,
    startIndex?: number,
    endIndex?: number,
  ) => void;
  getSelectionStyles?: (
    startIndex?: number,
    endIndex?: number,
    complete?: boolean,
  ) => FabricCharStyle[];
};

/**
 * Aggregate the style of an editing IText's current character sub-selection
 * into a model `Partial<TextStyle>`, keeping only fields CONSISTENT across the
 * whole range (mixed ⇒ field dropped). Returns `null` when the object is not
 * editing or the selection is empty (caret only). Pure — shared by the handle
 * method and the live `text:selection:changed` emitter so both agree.
 */
function aggregateSelectionStyle(
  obj: EditableTextObject | null | undefined,
): Partial<TextStyle> | null {
  if (
    !obj ||
    obj.isEditing !== true ||
    typeof obj.selectionStart !== "number" ||
    typeof obj.selectionEnd !== "number" ||
    obj.selectionStart >= obj.selectionEnd ||
    typeof obj.getSelectionStyles !== "function"
  ) {
    return null;
  }
  const perChar = obj.getSelectionStyles(
    obj.selectionStart,
    obj.selectionEnd,
    true,
  );
  if (!perChar || perChar.length === 0) return null;
  const consistent: Partial<TextStyle> = { ...fabricCharToModelStyle(perChar[0] ?? {}) };
  for (let i = 1; i < perChar.length; i++) {
    const cur = fabricCharToModelStyle(perChar[i] ?? {});
    (Object.keys(consistent) as (keyof TextStyle)[]).forEach((key) => {
      if (consistent[key] !== cur[key]) delete consistent[key];
    });
  }
  return consistent;
}

/** Actions de formatage applicables aux textes sélectionnés depuis la toolbar */
export type TextFormatAction =
  | "bold"
  | "italic"
  | "underline"
  | "alignLeft"
  | "alignCenter"
  | "alignRight";

export interface EditorCanvasHandle {
  /**
   * Ajouter une image au canvas. `target` (optionnel — Remplir & Signer) :
   * l'image est AJUSTÉE dans ce rect (ratio préservé, centrée) au lieu du
   * placement libre par défaut — utilisé pour poser une signature dans un
   * widget de champ signature.
   */
  addImage: (
    dataUrl: string,
    width: number,
    height: number,
    target?: { x: number; y: number; width: number; height: number },
  ) => void;
  /** Annuler la dernière action */
  undo: () => void;
  /** Refaire la dernière action annulée */
  redo: () => void;
  /** Peut annuler */
  canUndo: () => boolean;
  /** Peut refaire */
  canRedo: () => boolean;
  /** Supprimer les éléments sélectionnés */
  deleteSelected: () => void;
  /** Dupliquer les éléments sélectionnés */
  duplicateSelected: () => void;
  /**
   * Remonter un élément au premier plan (z-order). Localise l'objet Fabric par
   * `data.elementId`, le passe devant tous les autres (Fabric v6
   * `canvas.bringObjectToFront`) et persiste l'ordre UNIQUEMENT via le `reorder`
   * op dédié (`onElementReordered` → engine `reorderElement`). N'émet PAS
   * `onElementModified` : un reorder pur ne change pas les bounds, et un op
   * `update` (redact + re-add) serait redondant et re-empilerait l'élément au
   * premier plan. No-op si l'élément n'est pas sur la page affichée.
   */
  bringToFront: (elementId: string) => void;
  /**
   * Renvoyer un élément à l'arrière-plan (z-order). Pendant du `bringToFront`
   * via `canvas.sendObjectToBack`. Persiste l'ordre UNIQUEMENT via le `reorder`
   * op dédié (`onElementReordered` → engine `reorderElement`) ; n'émet PAS
   * `onElementModified` (un `update` re-empilerait l'élément au premier plan et
   * contredirait ce sendToBack).
   */
  sendToBack: (elementId: string) => void;
  /** Obtenir les IDs des éléments sélectionnés */
  getSelectedIds: () => string[];
  /** Appliquer un formatage (gras/italique/souligné/alignement) aux textes sélectionnés */
  applyTextFormat: (action: TextFormatAction) => void;
  /**
   * Rendre sur le canvas un élément créé par un collaborateur distant.
   * Aucun événement onElementAdded n'est émis (pas de queueAdd, pas de save,
   * pas de réémission socket). L'appelant garantit que l'élément appartient
   * à la page actuellement affichée.
   */
  applyRemoteElementCreate: (element: Element) => void;
  /**
   * Appliquer la mise à jour distante d'un élément (retire/re-crée l'objet
   * Fabric via le même convertisseur que le render initial). Ignorée si
   * l'élément est sélectionné ou en cours d'édition locale (le local gagne).
   */
  applyRemoteElementUpdate: (element: Element) => void;
  /**
   * Appliquer une mise à jour LOCALE (panneau propriétés) d'un élément :
   * même retire/re-crée via le convertisseur que applyRemoteElementUpdate,
   * mais SANS la garde anti-conflit de sélection — les éléments édités via
   * le panel SONT sélectionnés par construction — et en RESTAURANT la
   * sélection (setActiveObject / ActiveSelection) après la re-création.
   * Aucun onElementModified n'est réémis (beginProgrammaticApply) et les
   * événements de sélection transitoires (discard → re-select) ne sont pas
   * forwardés à page.tsx (la sélection nette est inchangée).
   */
  applyLocalElementUpdate: (element: Element) => void;
  /**
   * Retirer du canvas un élément supprimé par un collaborateur distant.
   * No-op si l'élément n'est pas rendu sur la page affichée.
   */
  applyRemoteElementDelete: (elementId: string) => void;
  /**
   * Afficher/masquer un élément (toggle œil du panneau calques).
   * Le masquage est un OUTIL D'AFFICHAGE : l'élément RESTE dans le scene graph
   * et dans le PDF baké au save — aucune redaction n'est déclenchée. Comme
   * l'éditeur affiche le PDF en raster (les overlays sont transparents),
   * masquer = peindre un rectangle OPAQUE de la couleur de fond échantillonnée
   * par-dessus la bbox de l'élément (data.isHideMask, jamais baké car le save
   * passe par l'operations-store). L'overlay est aussi rendu non-evented pour
   * qu'un double-clic n'ouvre pas l'édition d'un élément caché. Réafficher
   * retire le masque et restaure l'interactivité selon le verrou. La
   * synchronisation du scene graph est faite par l'appelant (page.tsx).
   */
  setElementVisibility: (elementId: string, visible: boolean) => void;
  /**
   * Verrouiller/déverrouiller un élément (toggle cadenas du panneau calques).
   * Verrouillé = non sélectionnable et non réactif aux événements souris
   * (selectable=false, evented=false) ; l'objet est désélectionné s'il
   * faisait partie de la sélection active. La synchronisation du scene
   * graph est faite par l'appelant (page.tsx).
   */
  setElementLocked: (elementId: string, locked: boolean) => void;
  /**
   * Sélectionner un élément par son id (clic sur une ligne du panneau calques).
   * Trouve l'objet Fabric correspondant, le passe en objet actif et notifie la
   * sélection. Le `setActiveObject` programmatique de Fabric ne déclenche PAS
   * `selection:created` — on forwarde donc explicitement à `onSelectionChanged`
   * pour synchroniser le store + le panneau propriétés (même chemin que la
   * sélection souris).
   *
   * Retourne `true` si l'élément a été trouvé et sélectionné sur la page
   * affichée, `false` sinon (élément non rendu ici — cas du mode continu où ce
   * handle ne pilote QUE la page active : l'appelant doit alors activer la page
   * propriétaire puis re-tenter). Le booléen permet ce ré-essai déterministe
   * plutôt qu'un no-op silencieux.
   */
  selectElement: (elementId: string) => boolean;
  /**
   * Sélectionner plusieurs éléments par leurs ids (clic sur une ligne-calque :
   * met en évidence tous les membres du calque). Miroir multi de
   * `selectElement` : un seul objet trouvé → objet actif simple ; plusieurs →
   * `ActiveSelection`. Forwarde au store les ids RÉELLEMENT trouvés sur la page
   * affichée (les membres d'autres pages sont ignorés). `[]` ou aucun membre
   * trouvé ⇒ désélection.
   */
  selectElements: (elementIds: string[]) => void;
  /**
   * Collect the redaction zones drawn on the currently-displayed page, in web
   * coordinates (origin top-left, Y-down, in PDF points at scale 1 — the same
   * space as `page.dimensions`). These are transient marker rects
   * (`data.redactionMark`), never scene-graph elements: the caller lowers them
   * to PDF user-space and feeds them to the engine's `redactPii`. Returns an
   * empty array when no zone is drawn.
   */
  getRedactionMarks: () => { x: number; y: number; width: number; height: number }[];
  /** Remove every redaction marker rect from the canvas (e.g. after applying). */
  clearRedactionMarks: () => void;
  /**
   * Word-like PARTIAL formatting. When a text element is in inline-edit mode
   * with a non-empty character sub-selection, apply `patch` (bold/italic/
   * underline/strikethrough/colour/size/font) to JUST that range via Fabric's
   * `setSelectionStyles` and return `true`. Returns `false` when no text is in
   * edit mode, or the selection is empty (caret only) — the caller then falls
   * back to its whole-element style path. The character-level styles are
   * persisted as `TextElement.runs` when the edit session ends (or eagerly via
   * `flushSelectionStyle`).
   */
  applySelectionStyle: (patch: Partial<TextStyle>) => boolean;
  /**
   * The aggregated style of the current text edit sub-selection, or `null` when
   * no text is being edited / no sub-range is selected. Lets the toolbar show
   * the right active state (e.g. Bold lit when the whole selection is bold). A
   * field is present only when it is CONSISTENT across the whole selection
   * (mixed ⇒ field omitted).
   */
  getActiveTextSelectionStyle: () => Partial<TextStyle> | null;
  /**
   * The rendered PDF background canvas (Fabric lower canvas) of THIS page, or
   * `null` before init. Used by the content-edit overlay to sample the paper
   * behind a text zone (so the inline editor shows the real background). In the
   * continuous view this is the ACTIVE page's canvas (the handle is routed via
   * `onCanvasReady`); reading it lazily keeps the sample tied to the page on
   * screen. Read-only — the caller never mutates the element.
   */
  getPdfCanvas: () => HTMLCanvasElement | null;
}

export interface EditorCanvasProps {
  /** Page actuelle à afficher */
  page: PageObject | null;
  /** ID du document (session backend) — utilisé pour rendre le fond PDF */
  documentId?: string | null;
  /** Outil actif */
  tool: Tool;
  /** Niveau de zoom (1 = 100%) */
  zoom: number;
  /** Largeur du canvas */
  width?: number;
  /** Hauteur du canvas */
  height?: number;
  /**
   * Resolver for embedded PDF font names: maps the original font ID (e.g. "g_d0_f1")
   * to a CSS font-family registered via FontFace API. When the embedded font is loaded,
   * text is rendered with the SAME font as the PDF background. Returns null for unknown.
   */
  getFontFaceName?: (
    originalName: string,
    wantVariant?: { bold?: boolean; italic?: boolean },
    text?: string,
    fontId?: string,
  ) => { name: string; embedded: boolean; exact: boolean } | null;
  /**
   * True while embedded PDF fonts are still loading (the `isLoading` of
   * `useEmbeddedFonts`). The overlay first renders with FALLBACK metrics; when
   * this flips false the canvas re-renders the overlay ONCE with the exact
   * embedded subsets (correct metrics, no overlap) — no repeated flicker. Absent
   * ⇒ the one-shot is skipped (no regression; navigation still picks up fonts via
   * the renderElementsOverlay ref bridge).
   */
  fontsLoading?: boolean;
  /** Type de forme sélectionné */
  shapeType?: ShapeType;
  /** Type d'annotation sélectionné */
  annotationType?: AnnotationType;
  /** Type de champ de formulaire sélectionné (text/checkbox/radio/dropdown) */
  fieldType?: FieldType;
  /**
   * Variante de création du champ de formulaire (palette toolbar) : raffine
   * fieldType avec multiline / date / radio_group. Prioritaire sur fieldType
   * pour la création au clic.
   */
  fieldKind?: FieldCreationKind;
  /**
   * Mode de zoom adaptatif. Quand non-null, le composant recalcule le zoom
   * au resize du viewport (ResizeObserver) et au changement de page, et le
   * remonte via onFitZoomChange. Les interactions manuelles (wheel) passent
   * par onZoomChanged — c'est au parent de remettre fitMode à null.
   */
  fitMode?: "page" | "width" | null;
  /**
   * Mode "intégré" : le composant est monté à l'intérieur d'un autre scroller
   * (le défileur continu Word-like). Dans ce mode il ne possède PAS son propre
   * viewport scrollable : pas de wrapper `overflow-auto`, pas de centrage
   * `m-auto`, pas de padding — juste le `canvas-container` dimensionné à
   * page×zoom. Le zoom est piloté par le parent (prop `zoom`), donc `fitMode`
   * est forcé à null et le wheel-zoom local (qui pilotait le scroll du wrapper)
   * laisse buller l'événement vers le scroller parent. Tout le reste (outils,
   * édition, handle impératif, callbacks, fond text-free) est identique.
   */
  embedded?: boolean;
  /**
   * Word-like running header/footer edit mode is active for this document (SL2).
   * When true, the page background raster EXCLUDES the baked `/GPHF` band so the
   * editable HeaderFooterZone overlaid on top never doubles against it.
   */
  headerFooterActive?: boolean;
  /** Zoom recalculé par un mode fit (page/width). */
  onFitZoomChange?: (zoom: number) => void;
  /**
   * Afficher les règles Word-like (et, si les marges sont connues, les marges
   * draggables). Câblé sur le même toggle « Règles & marges » de la toolbar que
   * la vue continue. Rendu UNIQUEMENT en mode standalone (single-page) : la vue
   * continue monte ses propres règles via PageSlot, donc l'EditorCanvas
   * `embedded` ne les rend jamais (sinon doublon).
   */
  showRulers?: boolean;
  /** Unité d'affichage des règles (px/mm/cm/in/pt). Défaut « mm ». */
  rulerUnit?: RulerUnit;
  /**
   * Marges (points PDF, boîte intrinsèque non-rotée) de la page affichée, ou
   * `null` si inconnues. Les marqueurs/guides draggables ne s'affichent que si
   * présentes ET `onMarginsCommit` fourni.
   */
  margins?: PageMargins | null;
  /** Commit des nouvelles marges (points PDF) après un drag règle/guide. */
  onMarginsCommit?: (margins: PageMargins) => void;
  /**
   * Contenu superposé au canvas (ex: surlignage des champs de formulaire en
   * mode Remplir). Rendu DANS le conteneur du canvas, donc positionné en
   * coordonnées page×zoom et défilant avec la page.
   */
  overlay?: React.ReactNode;
  /** Couleur de contour */
  strokeColor?: string;
  /** Couleur de remplissage */
  fillColor?: string;
  /** Épaisseur du contour */
  strokeWidth?: number;
  /** Callback quand un élément est ajouté */
  onElementAdded?: (element: Element) => void;
  /** Callback quand un élément est modifié. oldBounds = bounds AVANT
   *  cette modification (utilisé par apply-elements pour clear la zone
   *  d'origine avant de redessiner — sinon le glyphe original reste). */
  onElementModified?: (element: Element, oldBounds?: Bounds) => void;
  /**
   * Callback quand l'ordre d'empilement (z-order) d'un élément change via
   * bringToFront/sendToBack. `toFront` = remonté au premier plan (`true`) ou
   * renvoyé en arrière (`false`). Permet de persister le nouvel ordre DANS le
   * binaire PDF (engine `reorderElement`), en plus du reflet scene-graph.
   */
  onElementReordered?: (element: Element, toFront: boolean) => void;
  /** Callback quand un élément est supprimé */
  onElementRemoved?: (elementId: string) => void;
  /**
   * Freehand pencil ("draw" tool): fired on pointer-up with the completed stroke
   * as a flat `[x0, y0, x1, y1, …]` polyline ALREADY lowered to PDF user space
   * (origin bottom-left, Y-up) — the same flip every other bake uses
   * (`webBoundsToPdfRect` / pdf-engine `webToPdf`). The caller bakes it via the
   * engine's `addInk` (route `/api/pdf/ink`). Absent ⇒ the pencil tool is inert.
   */
  onInkDrawn?: (points: number[]) => void;
  /** Callback quand la sélection change */
  onSelectionChanged?: (elementIds: string[]) => void;
  /**
   * Word-like partial formatting: fired when the character sub-selection
   * INSIDE a text element being inline-edited changes (Fabric
   * `text:selection:changed`), and on edit enter/exit. Carries the aggregated
   * style of the selected range (fields consistent across it), or `null` when
   * no text is being edited / the selection is empty. Lets the formatting
   * toolbar reflect the right active state live and route style edits to the
   * selection instead of the whole element.
   */
  onTextSelectionStyleChanged?: (style: Partial<TextStyle> | null) => void;
  /** Callback pour changement de zoom */
  onZoomChanged?: (zoom: number) => void;
  /** Callback appelé lorsque le canvas est prêt avec les méthodes exposées */
  onCanvasReady?: (handle: EditorCanvasHandle) => void;
  /** Callback pour les clics sur les liens hypertexte */
  onHyperlinkClick?: (linkUrl?: string | null, linkPage?: number | null) => void;
  /**
   * Fired with the live number of redaction-marker rects on the page whenever a
   * mark is drawn or removed. Lets the toolbar reflect the count and enable the
   * Apply/Clear cluster. Markers are transient overlays, never scene-graph
   * elements (see the Redaction tool).
   */
  onRedactionMarksChanged?: (count: number) => void;
  /**
   * Mode « Remplir & Signer » actif (Adobe UX). Quand vrai : un simple clic
   * dans un champ texte place le CURSEUR (enterEditing + setCursorByClick), et
   * un clic sur un widget signature ouvre le dialog de capture via
   * `onSignatureFieldClick`. Hors de ce mode le comportement design est
   * inchangé (simple clic = sélection, double clic = édition, drag = move).
   */
  fillSignActive?: boolean;
  /**
   * Remplir & Signer : clic sur un widget SIGNATURE → l'appelant ouvre le
   * SignatureCaptureDialog et insérera l'image ajustée aux bounds du widget.
   */
  onSignatureFieldClick?: (element: FormFieldElement) => void;
}

/** Tailles par défaut des widgets de formulaire, par variante de création. */
const FIELD_DEFAULT_SIZES: Record<FieldCreationKind, { width: number; height: number }> = {
  text: { width: 200, height: 30 },
  multiline: { width: 200, height: 80 },
  date: { width: 200, height: 30 },
  // 24×24 minimum : cible tactile utilisable dès la création (lot 2 mobile) —
  // en deçà, cocher au doigt une case fraîchement posée est une loterie.
  checkbox: { width: 24, height: 24 },
  radio_group: { width: 24, height: 24 },
  dropdown: { width: 200, height: 30 },
  // Liste à sélection visible : plusieurs lignes affichées d'un coup, donc
  // plus haute que la liste déroulante (combo) qui ne montre qu'une ligne.
  listbox: { width: 200, height: 76 },
};

interface NewFormFieldParams {
  elementId: string;
  kind: FieldCreationKind;
  x: number;
  y: number;
  /** Nom du champ — défaut généré depuis le type + timestamp. */
  fieldName?: string;
  /** Texte d'aide affiché dans le widget vide (éditeur uniquement). */
  placeholder?: string | null;
  /** Pour radio : valeur d'export de CE widget dans le groupe. */
  exportValue?: string;
  /** Pour radio/dropdown : liste complète des options. */
  options?: string[];
}

/**
 * Construit un FormFieldElement complet pour une création depuis la palette.
 * Source de vérité unique : stocké dans data.formFieldElement de l'objet
 * Fabric, puis re-fusionné avec les bounds réels par fabricObjectToElement.
 */
function createFormFieldElement(params: NewFormFieldParams): FormFieldElement {
  const { kind, elementId, x, y } = params;
  const size = FIELD_DEFAULT_SIZES[kind];
  const fieldType: FieldType =
    kind === "checkbox"
      ? "checkbox"
      : kind === "radio_group"
        ? "radio"
        : kind === "dropdown"
          ? "dropdown"
          : kind === "listbox"
            ? "listbox"
            : "text";
  // dropdown (combo) ET listbox (sélection visible) sont tous deux des champs
  // à options : valeur tableau + liste d'options par défaut.
  const isList = fieldType === "dropdown" || fieldType === "listbox";
  const isRadio = fieldType === "radio";
  const isCheckbox = fieldType === "checkbox";

  return {
    elementId,
    type: "form_field",
    bounds: { x, y, width: size.width, height: size.height },
    transform: { rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 },
    layerId: null,
    locked: false,
    visible: true,
    fieldType,
    fieldName: params.fieldName ?? `${kind}_${Date.now()}`,
    // radio : value = valeur d'export du widget ; checkbox : booléen ;
    // dropdown : sélection (vide) ; text : contenu (vide).
    value: isCheckbox ? false : isRadio ? (params.exportValue ?? "") : isList ? [] : "",
    defaultValue: isCheckbox ? false : isList ? [] : "",
    options: isList || isRadio ? (params.options ?? []) : null,
    properties: {
      required: false,
      readOnly: false,
      maxLength: null,
      multiline: kind === "multiline",
      password: false,
      comb: false,
    },
    style: {
      fontFamily: "Arial",
      fontSize: 12,
      textColor: "#000000",
      backgroundColor: "#ffffff",
      borderColor: "#cccccc",
      borderWidth: 1,
      textAlign: "left",
    },
    format:
      kind === "date"
        ? { type: "date", pattern: "dd/mm/yyyy" }
        : { type: "none", pattern: null },
    placeholder: params.placeholder ?? null,
    tooltip: null,
  };
}

// Famille de police dominante parmi les éléments texte de la page courante,
// pondérée par la longueur du contenu (un paragraphe long pèse plus qu'une
// puce d'un caractère). Les nouveaux textes créés par l'utilisateur héritent
// de cette famille au lieu d'un "Arial" hardcodé, pour rester visuellement
// cohérents avec le document. Fallback "Arial" si la page n'a aucun texte.
function getDocumentDefaultFontFamily(elements: readonly Element[] | undefined): string {
  if (!elements || elements.length === 0) return "Arial";
  const familyWeights = new Map<string, number>();
  for (const element of elements) {
    if (element.type !== "text") continue;
    const family = (element.style.fontFamily || "").trim();
    if (!family) continue;
    const weight = Math.max(1, (element.content || "").length);
    familyWeights.set(family, (familyWeights.get(family) ?? 0) + weight);
  }
  let best: string | null = null;
  let bestWeight = 0;
  for (const [family, weight] of familyWeights) {
    if (weight > bestWeight) {
      best = family;
      bestWeight = weight;
    }
  }
  return best ?? "Arial";
}

// Type helper for fabric objects with custom data
interface FabricObjectWithData extends FabricObject {
  data?: { elementId?: string; [key: string]: unknown };
}

/**
 * Lower a single canvas/scene point (origin top-left, Y-down — PDF points at
 * scale 1, the `page.dimensions` space) to PDF user space (origin bottom-left,
 * Y-up). The exact same flip as the panel's `webBoundsToPdfRect` (and the
 * pdf-engine `webToPdf` used by every other bake) for a zero-size box, so the
 * pencil stroke lands where every shape/text/image bake would. Used by the
 * freehand "draw" tool before emitting points to the `addInk` bake.
 */
function sceneToPdfUserPoint(
  sx: number,
  sy: number,
  geo: { width: number; height: number; rotation: 0 | 90 | 180 | 270 },
): [number, number] {
  const y = geo.height - sy;
  // rotation 180 flips X against the displayed width; 0/90/270 keep X and do a
  // plain Y-flip against the displayed height (identical to webBoundsToPdfRect).
  if ((geo.rotation ?? 0) === 180) return [geo.width - sx, y];
  return [sx, y];
}

/**
 * Retire le hit-target plein rect apparié à un élément form_field (Rect de
 * fond ajouté par render-elements, `data.hitForElementId`). À appeler partout
 * où l'objet CONTENU d'un champ est retiré/re-créé, sinon le rect orphelin
 * reste cliquable (et se ré-empile au re-render).
 */
function removeFieldHitTwin(canvas: FabricCanvas, elementId: string): void {
  const twin = canvas
    .getObjects()
    .find(
      (o) => (o as FabricObjectWithData).data?.hitForElementId === elementId,
    );
  if (twin) canvas.remove(twin);
}

/**
 * Canvas de l'éditeur PDF avec support Fabric.js.
 * Chaque élément est indépendant et éditable.
 */
export function EditorCanvas({
  page,
  documentId,
  tool,
  zoom,
  width = 800,
  height = 600,
  getFontFaceName,
  fontsLoading = false,
  shapeType = "rectangle",
  annotationType = "highlight",
  fieldType = "text",
  fieldKind = "text",
  fitMode: fitModeProp = null,
  embedded = false,
  headerFooterActive = false,
  onFitZoomChange,
  showRulers = false,
  rulerUnit = "mm",
  margins = null,
  onMarginsCommit,
  overlay,
  strokeColor = "#000000",
  fillColor = "transparent",
  strokeWidth = 2,
  onElementAdded,
  onElementModified,
  onElementReordered,
  onElementRemoved,
  onInkDrawn,
  onSelectionChanged,
  onTextSelectionStyleChanged,
  onZoomChanged,
  onCanvasReady,
  onHyperlinkClick,
  onRedactionMarksChanged,
  fillSignActive = false,
  onSignatureFieldClick,
}: EditorCanvasProps) {
  // En mode intégré, le parent (défileur continu) possède le zoom : on neutralise
  // tout mode "fit" local (qui réécrirait le zoom depuis le viewport interne
  // absent). En mode standalone, comportement inchangé.
  const fitMode = embedded ? null : fitModeProp;

  // Remplir & Signer : flags LIVE lus par les handlers souris de
  // render-elements (attachés UNE fois par canvas). Stampés sur l'instance
  // Fabric pour que le mode s'applique/se retire sans ré-attacher les
  // listeners ni re-render l'overlay.
  const fillSignActiveRef = useRef(fillSignActive);
  fillSignActiveRef.current = fillSignActive;
  const onSignatureFieldClickRef = useRef(onSignatureFieldClick);
  onSignatureFieldClickRef.current = onSignatureFieldClick;
  useEffect(() => {
    const canvas = fabricRef.current as
      | (FabricCanvas & {
          _gigaFillSignMode?: boolean;
          _gigaOnSignatureFieldClick?: (element: unknown) => void;
        })
      | null;
    if (!canvas) return;
    canvas._gigaFillSignMode = fillSignActive;
    canvas._gigaOnSignatureFieldClick = (element: unknown) =>
      onSignatureFieldClickRef.current?.(element as FormFieldElement);
  });
  const t = useTranslations("editor.canvas");
  const containerRef = useRef<HTMLDivElement>(null);
  // Assigné IMPÉRATIVEMENT (plus via ref JSX) : le <canvas> est créé et attaché
  // à containerRef dans l'effet d'init Fabric, car fabric v7 le déplace dans son
  // propre wrapper `.canvas-container` — laisser React le gérer provoquerait un
  // removeChild fantôme (NotFoundError) au démontage en mode continu.
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fabricRef = useRef<FabricCanvas | null>(null);
  const previousPageRef = useRef<string | null>(null);
  // Conteneur scrollable (viewport) — référence directe, JAMAIS de
  // traversée DOM upperCanvasEl.parentElement (fragile aux changements de
  // structure JSX, et le wrapper a maintenant un niveau intermédiaire m-auto).
  const scrollWrapperRef = useRef<HTMLDivElement>(null);

  // Ref pour documentId (évite les closures stale dans loadPage)
  const documentIdRef = useRef(documentId);

  // Refs for callbacks to avoid stale closures in Fabric.js event handlers
  const onElementAddedRef = useRef(onElementAdded);
  const onElementModifiedRef = useRef(onElementModified);
  const onElementReorderedRef = useRef(onElementReordered);
  const onElementRemovedRef = useRef(onElementRemoved);
  const onSelectionChangedRef = useRef(onSelectionChanged);
  const onTextSelectionStyleChangedRef = useRef(onTextSelectionStyleChanged);
  const onZoomChangedRef = useRef(onZoomChanged);
  const onHyperlinkClickRef = useRef(onHyperlinkClick);
  const onRedactionMarksChangedRef = useRef(onRedactionMarksChanged);
  const onInkDrawnRef = useRef(onInkDrawn);

  // Paragraph edit-intent session plumbing: the loaded Fabric module (the
  // session Textbox is constructed outside loadPage) + the LIVE embedded-font
  // resolver (per-run character styles), both read through refs because the
  // text-editing handlers are memoised once.
  const fabricModuleRef = useRef<typeof import("fabric") | null>(null);
  const getFontFaceNameRef = useRef(getFontFaceName);
  getFontFaceNameRef.current = getFontFaceName;

  // Freehand pencil ("draw" tool) live-capture state. While drawing, the stroke
  // is a transient Fabric preview; on pointer-up it is lowered to PDF user space
  // and emitted via onInkDrawn (the real `/Ink` annotation then comes back on
  // re-parse). Held in refs because the Fabric handlers are bound once at init.
  const isInkingRef = useRef(false);
  const inkScenePointsRef = useRef<number[]>([]); // flat scene coords [x0,y0,…]
  const inkPreviewRef = useRef<FabricObject | null>(null);

  // Refs for tool options to avoid stale closures
  const toolRef = useRef(tool);
  const shapeTypeRef = useRef(shapeType);
  const annotationTypeRef = useRef(annotationType);
  const fieldTypeRef = useRef(fieldType);
  const fieldKindRef = useRef(fieldKind);
  const strokeColorRef = useRef(strokeColor);
  const fillColorRef = useRef(fillColor);
  const strokeWidthRef = useRef(strokeWidth);
  const zoomRef = useRef(zoom);
  // Dimensions de la page courante (points PDF) — nécessaires au resize du
  // canvas DOM dans les handlers Fabric enregistrés une seule fois.
  const pageDimsRef = useRef<{ width: number; height: number; rotation: 0 | 90 | 180 | 270 }>({
    width: width,
    height: height,
    rotation: 0,
  });

  // Invite de saisie rapide pour la création d'un GROUPE de boutons radio :
  // le clic avec fieldKind="radio_group" ouvre ce mini-formulaire (nom du
  // groupe + options, une par ligne) au lieu de poser un objet immédiatement.
  const [radioPrompt, setRadioPrompt] = useState<{ x: number; y: number } | null>(null);
  const [radioGroupName, setRadioGroupName] = useState("");
  const [radioOptionsText, setRadioOptionsText] = useState("");
  // Ouvert depuis le handler mouse:down de Fabric (closure d'init) — passe
  // par une ref pour accéder au setState + aux traductions sans stale closure.
  const openRadioPromptRef = useRef<((x: number, y: number) => void) | null>(null);

  // Zoom + pan refs:
  //   zoomFromWheelRef = true  → the [zoom] useEffect must skip its own
  //                              zoomToPoint call because the wheel handler
  //                              already applied it (cursor-centered).
  //   isSpaceDownRef           → tracks the Space key for "hold-to-pan" UX.
  //   isPanningRef + panStart  → tracks an in-progress pan drag.
  const zoomFromWheelRef = useRef(false);
  // Miroir ref de `embedded` : lu par le handler mouse:wheel (enregistré une
  // seule fois à l'init de Fabric) pour laisser le ctrl+molette buller vers le
  // scroller parent au lieu de piloter un wrapper interne inexistant.
  const embeddedRef = useRef(embedded);
  useEffect(() => {
    embeddedRef.current = embedded;
  }, [embedded]);
  // Mirror ref of `headerFooterActive`: read inside `loadPage` (a stable-closure
  // callback with deps []) so a freshly-rendered background excludes the baked
  // `/GPHF` band whenever H/F edit mode is on, without re-creating loadPage.
  const headerFooterActiveRef = useRef(headerFooterActive);
  useEffect(() => {
    headerFooterActiveRef.current = headerFooterActive;
  }, [headerFooterActive]);
  const isSpaceDownRef = useRef(false);
  const isPanningRef = useRef(false);
  const panStartRef = useRef<{
    clientX: number;
    clientY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);

  // Police par défaut des nouveaux textes : famille dominante de la page
  // courante. Valeur dérivée memoïsée — aucun état React supplémentaire,
  // donc aucun re-render parasite. Le miroir ref est nécessaire car le
  // handler mouse:down est enregistré UNE seule fois à l'init de Fabric
  // (closure stale sans ref, même pattern que toolRef/strokeColorRef).
  const pageElements = page?.elements;
  const documentDefaultFontFamily = useMemo(
    () => getDocumentDefaultFontFamily(pageElements),
    [pageElements],
  );
  const documentDefaultFontFamilyRef = useRef(documentDefaultFontFamily);

  // Update refs when props change
  useEffect(() => {
    documentIdRef.current = documentId;
    onElementAddedRef.current = onElementAdded;
    onElementModifiedRef.current = onElementModified;
    onElementReorderedRef.current = onElementReordered;
    onElementRemovedRef.current = onElementRemoved;
    onSelectionChangedRef.current = onSelectionChanged;
    onTextSelectionStyleChangedRef.current = onTextSelectionStyleChanged;
    onZoomChangedRef.current = onZoomChanged;
    onHyperlinkClickRef.current = onHyperlinkClick;
    onRedactionMarksChangedRef.current = onRedactionMarksChanged;
    onInkDrawnRef.current = onInkDrawn;
    toolRef.current = tool;
    shapeTypeRef.current = shapeType;
    annotationTypeRef.current = annotationType;
    fieldTypeRef.current = fieldType;
    fieldKindRef.current = fieldKind;
    strokeColorRef.current = strokeColor;
    fillColorRef.current = fillColor;
    strokeWidthRef.current = strokeWidth;
    zoomRef.current = zoom;
    documentDefaultFontFamilyRef.current = documentDefaultFontFamily;
    if (page?.dimensions) {
      pageDimsRef.current = {
        width: page.dimensions.width,
        height: page.dimensions.height,
        rotation: page.dimensions.rotation,
      };
    }
    openRadioPromptRef.current = (x: number, y: number) => {
      setRadioGroupName(`groupe_${Date.now().toString(36)}`);
      setRadioOptionsText(
        [1, 2, 3].map((n) => `${t("defaultOption")} ${n}`).join("\n"),
      );
      setRadioPrompt({ x, y });
    };
  });

  // Historique pour undo/redo
  const [historyStack, setHistoryStack] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  // Ref pour historyIndex — évite les closures stale dans saveHistory
  const historyIndexRef = useRef(-1);
  useEffect(() => { historyIndexRef.current = historyIndex; }, [historyIndex]);
  const isUpdatingHistoryRef = useRef(false);
  // Compteur de mutations programmatiques en vol (loadPage, undo/redo,
  // application d'événements de collaboration distants). isUpdatingHistoryRef
  // reste actif tant qu'AU MOINS une mutation est en cours : avec un booléen
  // brut, deux opérations asynchrones entrelacées (ex: un create distant dont
  // le chargement d'image chevauche un loadPage) verraient la première
  // réactiver object:added pendant que la seconde ajoute encore ses objets —
  // d'où un onElementAdded parasite → queueAdd + réémission socket (écho).
  const programmaticApplyDepthRef = useRef(0);
  const beginProgrammaticApply = useCallback(() => {
    programmaticApplyDepthRef.current += 1;
    isUpdatingHistoryRef.current = true;
  }, []);
  const endProgrammaticApply = useCallback(() => {
    programmaticApplyDepthRef.current = Math.max(
      0,
      programmaticApplyDepthRef.current - 1,
    );
    if (programmaticApplyDepthRef.current === 0) {
      isUpdatingHistoryRef.current = false;
    }
  }, []);

  // --- Architecture zoom/pan (CHOIX DOCUMENTÉ) -----------------------------
  // viewportTransform Fabric = SCALE PUR [z,0,0,z,0,0] + canvas DOM
  // redimensionné à page×zoom + scroll NATIF du wrapper overflow-auto.
  // L'ancienne approche mélangeait zoomToPoint (translation dans le vpt) et
  // resize DOM : le contenu Fabric se décalait dans sa boîte DOM et le haut
  // de page devenait inaccessible (flex items-center + overflow). Avec un
  // vpt scale-only : scène → pixels canvas = scène × zoom (déterministe),
  // pan = scrollLeft/Top natifs (scrollbars visibles dans les 2 axes), et
  // les conversions pointeur→scène de Fabric (e.scenePoint) restent exactes
  // sous n'importe quel zoom + scroll — la création d'éléments tombe au bon
  // endroit.
  //
  // applyZoomAtClientPoint : applique un zoom en préservant le point
  // (clientX, clientY) — le pixel logique sous le curseur reste sous le
  // curseur. anchor=null → pas de correction de scroll (cas initial).
  const applyZoomAtClientPoint = useCallback(
    (newZoom: number, anchor: { x: number; y: number } | null): number => {
      const canvas = fabricRef.current;
      if (!canvas) return newZoom;
      const clamped = clampZoom(newZoom);
      const oldZoom = canvas.getZoom() || 1;
      const wrapper = scrollWrapperRef.current;
      const upperEl = canvas.upperCanvasEl as HTMLCanvasElement | undefined;

      // Point de scène sous l'ancre AVANT le changement (vpt scale pur :
      // scène = (client - origineCanvas) / zoom).
      let sceneAnchor: { x: number; y: number } | null = null;
      if (anchor && wrapper && upperEl) {
        const rect = upperEl.getBoundingClientRect();
        sceneAnchor = {
          x: (anchor.x - rect.left) / oldZoom,
          y: (anchor.y - rect.top) / oldZoom,
        };
      }

      const pageW = pageDimsRef.current.width;
      const pageH = pageDimsRef.current.height;
      canvas.setViewportTransform([clamped, 0, 0, clamped, 0, 0]);
      canvas.setDimensions({ width: pageW * clamped, height: pageH * clamped });
      // Le conteneur React garde des width/height inline : on les synchronise
      // immédiatement pour que l'étendue scrollable soit correcte AVANT le
      // re-render React (sinon la correction de scroll serait clampée).
      if (containerRef.current) {
        containerRef.current.style.width = `${pageW * clamped}px`;
        containerRef.current.style.height = `${pageH * clamped}px`;
      }
      canvas.requestRenderAll();

      if (anchor && wrapper && upperEl && sceneAnchor) {
        // Re-mesure APRÈS resize (reflow synchrone) : la position du canvas
        // dans le contenu scrollable peut changer (marges auto du centrage).
        const rect = upperEl.getBoundingClientRect();
        const wrapperRect = wrapper.getBoundingClientRect();
        const offsetLeft = rect.left - wrapperRect.left + wrapper.scrollLeft;
        const offsetTop = rect.top - wrapperRect.top + wrapper.scrollTop;
        wrapper.scrollLeft =
          sceneAnchor.x * clamped + offsetLeft - (anchor.x - wrapperRect.left);
        wrapper.scrollTop =
          sceneAnchor.y * clamped + offsetTop - (anchor.y - wrapperRect.top);
      }
      return clamped;
    },
    [],
  );
  // Miroir ref : le handler mouse:wheel est enregistré une seule fois à
  // l'init de Fabric (même pattern que toolRef).
  const applyZoomAtClientPointRef = useRef(applyZoomAtClientPoint);
  useEffect(() => {
    applyZoomAtClientPointRef.current = applyZoomAtClientPoint;
  }, [applyZoomAtClientPoint]);

  // Zoom "fit" : calcule le zoom pour voir toute la page (page) ou toute la
  // largeur (width) dans le viewport, padding confortable déduit.
  const computeFitZoom = useCallback(
    (mode: "page" | "width"): number | null => {
      const wrapper = scrollWrapperRef.current;
      if (!wrapper) return null;
      const pageW = pageDimsRef.current.width;
      const pageH = pageDimsRef.current.height;
      if (pageW <= 0 || pageH <= 0) return null;
      const availW = wrapper.clientWidth - CANVAS_VIEWPORT_PADDING * 2;
      const availH = wrapper.clientHeight - CANVAS_VIEWPORT_PADDING * 2;
      if (availW <= 0 || availH <= 0) return null;
      const zoomForMode =
        mode === "width" ? availW / pageW : Math.min(availW / pageW, availH / pageH);
      return clampZoom(zoomForMode);
    },
    [],
  );

  const onFitZoomChangeRef = useRef(onFitZoomChange);
  useEffect(() => {
    onFitZoomChangeRef.current = onFitZoomChange;
  });

  // Tant que fitMode est actif, recalcul au resize du viewport
  // (ResizeObserver) et au changement de page. Dès que l'utilisateur zoome
  // manuellement, le parent remet fitMode à null et cet effet se désabonne.
  useEffect(() => {
    if (!fitMode) return;
    const wrapper = scrollWrapperRef.current;
    if (!wrapper) return;
    const recompute = () => {
      const fitZoom = computeFitZoom(fitMode);
      if (fitZoom !== null && Math.abs(fitZoom - zoomRef.current) > 0.001) {
        onFitZoomChangeRef.current?.(fitZoom);
      }
    };
    recompute();
    const observer = new ResizeObserver(recompute);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [fitMode, page, computeFitZoom]);

  // Ref pour tracker le contenu original des textes (pour detecter les vraies modifications)
  const originalContentRef = useRef<Map<string, string>>(new Map());
  // Tracks elementIds for which text:editing:exited just fired and forwarded
  // an update. Fabric v6 also fires object:modified right after exitEditing()
  // (because exitEditing() mutates the object's fill/textBackgroundColor),
  // and without this guard the same edit gets queued twice — visible in the
  // baked PDF as two superposed glyphs in different fonts (g_d0_f7 + g_d0_f8
  // captured in v32 of fe6cd5d3-1f7f-42e3-b3c3-3d04a9d07abd).
  const recentlyForwardedTextEditRef = useRef<Map<string, number>>(new Map());
  const TEXT_EDIT_DEDUPE_WINDOW_MS = 250;
  // Map des bounds connus PAR elementId AVANT chaque modification. Sans
  // cette source, queueUpdate envoie les NOUVELLES bounds comme oldBounds
  // → updateText() côté pdf-engine clear la mauvaise zone et l'ancien
  // glyphe parsé du PDF reste visible (texte dupliqué). On capture les
  // bounds initiaux à chaque load + à chaque création/modification, et
  // on les passe au callback onElementModified pour qu'apply-elements
  // ait la bonne zone à effacer.
  const lastKnownBoundsRef = useRef<Map<string, Bounds>>(new Map());
  // The IText currently in inline-edit mode (set on text:editing:entered,
  // cleared on exit). Word-like partial formatting targets THIS object's live
  // character selection (`selectionStart`/`selectionEnd`) so the toolbar can
  // apply bold/italic/colour/… to a SUB-RANGE instead of the whole element.
  const editingTextRef = useRef<FabricObjectWithData | null>(null);
  // elementIds whose per-character `styles` map was mutated during the current
  // edit session (via applySelectionStyle). Drained on text:editing:exited so
  // the style change is forwarded for the PDF bake even when `content` is
  // unchanged. A Set keyed by elementId (idempotent — one forward per element).
  const selectionStyleDirtyRef = useRef<Set<string>>(new Set());

  // Sauvegarder l'état dans l'historique
  // Utilise historyIndexRef pour éviter une closure stale (sinon saveHistory est
  // recréé à chaque changement d'index, ce qui force la recréation de tous ses
  // dépendants et provoque des re-rendus en cascade).
  const saveHistory = useCallback(
    (canvas: FabricCanvas) => {
      const json = JSON.stringify(canvas.toObject(["data"]));
      setHistoryStack((prev) => {
        const newStack = prev.slice(0, historyIndexRef.current + 1);
        return [...newStack, json];
      });
      setHistoryIndex((prev) => prev + 1);
    },
    [] // stable — lit historyIndexRef.current au moment de l'appel
  );

  // Confirme la création d'un groupe de boutons radio : pose un widget radio
  // par option (tous partagent le fieldName du groupe → un seul champ PDF à
  // N widgets au bake) + un label texte à droite de chaque bouton (le label
  // est du contenu de page, comme dans les éditeurs PDF pro — le widget
  // AcroForm ne porte pas de libellé). Chaque canvas.add déclenche
  // handleObjectAdded → onElementAdded → queue + scene graph, le flux normal.
  const handleConfirmRadioGroup = useCallback(async () => {
    const prompt = radioPrompt;
    const canvas = fabricRef.current;
    setRadioPrompt(null);
    if (!prompt || !canvas) return;
    const options = radioOptionsText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (options.length === 0) return;
    // Charset AcroForm sûr pour le nom de champ.
    const safeName =
      radioGroupName.trim().replace(/[^A-Za-z0-9_.\-]/g, "_") ||
      `radio_${Date.now()}`;
    const { Group, Circle, IText } = await import("fabric");
    const SPACING = 30;
    options.forEach((option, index) => {
      const elementId = generateId();
      const widgetY = prompt.y + index * SPACING;
      const element = createFormFieldElement({
        elementId,
        kind: "radio_group",
        x: prompt.x,
        y: widgetY,
        fieldName: safeName,
        exportValue: option,
        options,
      });
      const widget = new Group(
        [
          new Circle({
            left: 0,
            top: 0,
            radius: 9,
            fill: "#ffffff",
            stroke: "#555555",
            strokeWidth: 1.5,
          }),
        ],
        { left: prompt.x, top: widgetY },
      );
      (widget as FabricObjectWithData).data = {
        elementId,
        formFieldType: "radio",
        fieldName: safeName,
        exportValue: option,
        options,
        formFieldElement: element,
      };
      canvas.add(widget);

      const label = new IText(option, {
        left: prompt.x + 26,
        top: widgetY + 1,
        fontSize: 13,
        fontFamily: documentDefaultFontFamilyRef.current,
        fill: "#000000",
      });
      (label as FabricObjectWithData).data = { elementId: generateId() };
      canvas.add(label);
    });
    canvas.renderAll();
    saveHistory(canvas);
  }, [radioPrompt, radioOptionsText, radioGroupName, saveHistory]);

  // Convertir un objet Fabric.js en Element
  const fabricObjectToElement = useCallback(
    (obj: FabricObjectWithData): Element | null =>
      fabricObjectToElementImpl(obj),
    [],
  );

  // Forward a modified Fabric object to the parent for the PDF bake. Most
  // objects map 1:1 to a single Element, but a COALESCED PARAGRAPH (multi-line
  // Textbox, `data.isParagraph`) decomposes into its individual line runs via
  // fabricObjectToElements — each run is forwarded with its OWN tracked
  // oldBounds (the per-run zone to clear) so the bake stays lossless. For a
  // single-element object this behaves exactly like the previous
  // `fabricObjectToElement` + forward. Returns the elements it forwarded (so the
  // caller can refresh per-element bounds tracking / dedupe).
  const forwardElementModified = useCallback(
    (obj: FabricObjectWithData): Element[] => {
      const elements = fabricObjectToElementsImpl(obj);
      for (const element of elements) {
        const oldBounds = lastKnownBoundsRef.current.get(element.elementId);
        lastKnownBoundsRef.current.set(element.elementId, element.bounds);
        onElementModifiedRef.current?.(element, oldBounds);
      }
      return elements;
    },
    [],
  );

  // Suppression des événements de sélection pendant applyLocalElementUpdate :
  // le retire/re-crée passe par discardActiveObject → selection:cleared puis
  // setActiveObject → selection:created. Forwarder ces transitions ferait
  // flasher le store (sélection vide un tick) → le properties panel se
  // démonterait/remonterait et l'input en cours de frappe perdrait le focus.
  // La sélection NETTE étant identique avant/après, on ne forward rien.
  const suppressSelectionEventsRef = useRef(false);

  // Handlers d'événements - using refs to avoid stale closures
  const handleSelectionChange = useCallback(() => {
    if (suppressSelectionEventsRef.current) return;
    if (!fabricRef.current) return;
    const activeObjects = fabricRef.current.getActiveObjects();
    const ids = activeObjects
      .map((obj) => (obj as FabricObjectWithData).data?.elementId)
      .filter(Boolean) as string[];
    onSelectionChangedRef.current?.(ids);
  }, []);

  // Type de modification pour distinguer position/contenu/style
  type ModificationType = 'position' | 'content' | 'style';

  // Sample the actual paper / band colour beneath a text overlay, so that
  // when the user enters edit mode we can mask the underlying PDF glyph
  // with a SOLID matching the real background (e.g. the red banner under
  // "Somme à payer le 04 Juin 2025"), instead of a hardcoded white block
  // that would cover the design. Reads pixels just OUTSIDE the bbox on
  // all four sides so the glyph itself never contaminates the sample.
  // Returns rgb() string, or null if the canvas is unreadable (cross-
  // origin tainted, scaled to 0, etc.).
  const sampleBackgroundUnder = useCallback(
    (
      obj: FabricObject,
      textRgb?: [number, number, number] | null,
    ): string | null => sampleBackgroundUnderImpl(obj, textRgb),
    [],
  );


  // --- Masquage réel d'un élément "caché" (toggle œil du panneau calques) ---
  //
  // L'éditeur affiche le PDF comme un BITMAP raster (fond non-éditable) ; les
  // éléments du scene graph sont des overlays Fabric TRANSPARENTS au-dessus (le
  // texte a fill rgba(0,0,0,0), il ne sert que de hit-target d'édition — le
  // visuel vient du raster). Passer un overlay `visible=false` ne cache donc
  // RIEN : son contenu reste peint dans le raster. Pour réellement masquer un
  // élément, on peint un rectangle OPAQUE de la couleur de fond échantillonnée
  // (même mécanisme que le masquage d'édition : sampleBackgroundUnder) par-
  // dessus sa bbox. Le masque porte data.isHideMask + elementId pour être
  // retiré au toggle, et n'est JAMAIS sélectionnable/evented ni baké dans le
  // PDF (le save passe par l'operations-store, pas par canvas.getObjects()).

  /** Retire le masque de visibilité d'un élément (s'il existe). */
  const removeHideMask = useCallback(
    (canvas: FabricCanvas, elementId: string): void => {
      const mask = canvas
        .getObjects()
        .find(
          (o) =>
            (o as FabricObjectWithData).data?.isHideMask === true &&
            (o as FabricObjectWithData).data?.elementId === elementId,
        );
      if (mask) canvas.remove(mask);
    },
    [],
  );

  /**
   * Pose (ou repose) un masque opaque couvrant la bbox de `target`, échantillonné
   * sur le fond raster réel. Idempotent : retire d'abord un éventuel masque
   * existant pour le même élément. À appeler dans une fenêtre programmatique
   * (beginProgrammaticApply) — le Rect ajouté ne doit pas remonter via
   * object:added ni être confondu avec un élément éditable.
   */
  const applyHideMask = useCallback(
    async (canvas: FabricCanvas, target: FabricObjectWithData): Promise<void> => {
      const elementId = target.data?.elementId;
      if (!elementId) return;
      removeHideMask(canvas, elementId);

      const o = target as unknown as {
        left?: number;
        top?: number;
        width?: number;
        height?: number;
        scaleX?: number;
        scaleY?: number;
        originY?: string;
        angle?: number;
      };
      const left = o.left ?? 0;
      const top = o.top ?? 0;
      const width = (o.width ?? 0) * (o.scaleX ?? 1);
      const height = (o.height ?? 0) * (o.scaleY ?? 1);
      // Le texte est rendu avec originY='bottom' (top = baseline). Translate vers
      // un coin haut-gauche pour que le masque couvre la zone du glyphe.
      const topLeftY = o.originY === "bottom" ? top - height : top;
      // Marge de 1px tout autour : l'anti-aliasing des glyphes du raster déborde
      // légèrement de la bbox — sans marge un liseré fantôme reste visible.
      const PAD = 1;

      // Couleur de fond : échantillon live autour de l'élément (gère bannières
      // colorées / cartes / dégradés), sinon blanc si canvas illisible (CORS).
      const fillColour =
        sampleBackgroundUnder(target as FabricObject) ?? "#ffffff";

      const { Rect } = await import("fabric");
      const mask = new Rect({
        left: left - PAD,
        top: topLeftY - PAD,
        width: width + PAD * 2,
        height: height + PAD * 2,
        originX: "left",
        originY: "top",
        angle: o.angle ?? 0,
        fill: fillColour,
        stroke: undefined,
        strokeWidth: 0,
        selectable: false,
        evented: false,
        hasControls: false,
        hasBorders: false,
        excludeFromExport: true,
      });
      (mask as FabricObjectWithData).data = { isHideMask: true, elementId };
      canvas.add(mask);
      // Placer le masque JUSTE AU-DESSUS du fond PDF (index 1) : il recouvre le
      // raster mais reste SOUS les autres overlays éditables, donc cacher un
      // élément ne masque pas accidentellement ceux qui passent par-dessus.
      const bgIndex = canvas
        .getObjects()
        .findIndex((o2) => (o2 as FabricObjectWithData).data?.isPdfBackground);
      canvas.moveObjectTo(mask, bgIndex >= 0 ? bgIndex + 1 : 0);
    },
    [removeHideMask, sampleBackgroundUnder],
  );

  // Handler appele quand un texte entre en mode edition.
  // 1:1 fidelity mode: text overlay is invisible by default (PDF native text
  // shows through). On edit-enter we must:
  //   - cover the underlying PDF glyph with a solid matching the REAL
  //     background colour (sampled from the rendered PDF bitmap) so the
  //     mask blends in instead of slapping a white box over the design
  //   - restore the real fill colour so the user sees what they're typing
  // On edit-exit we revert both.
  const handleTextEditingEntered = useCallback((e: { target?: FabricObject }) => {
    if (!e.target) return;
    const obj = e.target as FabricObjectWithData;
    const typeName = (obj as FabricObject & { type?: string }).type ?? "";
    if (typeName !== "i-text" && typeName !== "textbox" && typeName !== "text") {
      return;
    }
    // PARAGRAPH EDIT-INTENT: a double-click on a MEMBER of a coalesced
    // paragraph group opens the GROUP session instead of the single-run inline
    // edit (Adobe-like: one editable multi-line box with wrap/reflow). Fabric
    // has already entered editing on the member — baseline its content so the
    // imminent exitEditing() forwards nothing, then (microtask, out of Fabric's
    // enterEditing call stack) swap the group for the session Textbox. Only in
    // the plain select tool; form fields never carry a group id.
    if (
      obj.data?.paragraphGroupId &&
      obj.data?.isParagraphSession !== true &&
      toolRef.current === "select"
    ) {
      const canvas = fabricRef.current;
      const fabricModule = fabricModuleRef.current;
      if (canvas && fabricModule) {
        const memberId = obj.data?.elementId;
        if (memberId) {
          originalContentRef.current.set(
            memberId,
            (obj as FabricObjectWithData & { text?: string }).text || "",
          );
        }
        queueMicrotask(() => {
          if (fabricRef.current !== canvas) return; // canvas re-init meanwhile
          (
            obj as FabricObjectWithData & { exitEditing?: () => void }
          ).exitEditing?.();
          // The swap is presentation-only (no scene-graph change): suppress the
          // object:added/removed forwarding it would otherwise trigger.
          beginProgrammaticApply();
          try {
            beginParagraphEditSession(
              canvas,
              fabricModule,
              obj,
              getFontFaceNameRef.current
                ? { getFontFaceName: getFontFaceNameRef.current }
                : {},
            );
          } finally {
            endProgrammaticApply();
          }
        });
      }
      return;
    }
    // DIRECT-TEXT model: the page is rasterised WITHOUT text, so this overlay is
    // already the visible text in its real colour — there is no glyph beneath to
    // mask. Just remember the original content (to detect a real change on exit)
    // and show a subtle edit border. No fill/background mutation, so editing
    // works over any background (gradients included).
    const elementId = obj.data?.elementId;
    const currentText =
      (obj as FabricObjectWithData & { text?: string }).text || "";
    if (elementId) {
      originalContentRef.current.set(elementId, currentText);
    }
    // Track the live editing object so the formatting toolbar can style its
    // current character sub-selection (Word-like partial formatting). Emit the
    // (initially caret-only ⇒ null) selection style so the toolbar resets.
    editingTextRef.current = obj;
    onTextSelectionStyleChangedRef.current?.(
      aggregateSelectionStyle(obj as EditableTextObject),
    );
    const setObj = (obj as FabricObject & { set: (...args: unknown[]) => void })
      .set;
    setObj.call(obj, { borderColor: "rgba(0, 100, 200, 0.6)" });
    // Editable text form fields show a grey placeholder when empty. On entering
    // edit, clear it so the user types into an empty field (and restore the real
    // text colour), and remember (via originalContent="") that the baseline is
    // empty so an unchanged field is not treated as edited.
    if (
      obj.data?.type === "form_field" &&
      obj.data?.fieldShowingPlaceholder === true
    ) {
      const placeholder = obj.data?.fieldPlaceholder;
      if (typeof placeholder === "string" && currentText === placeholder) {
        const field = obj.data?.formFieldElement as
          | { style?: { textColor?: string } }
          | undefined;
        setObj.call(obj, {
          text: "",
          fill: field?.style?.textColor || "#0a3a8a",
        });
        obj.data.fieldShowingPlaceholder = false;
        if (elementId) originalContentRef.current.set(elementId, "");
      }
    }
    const canvas = (
      obj as FabricObject & { canvas?: { requestRenderAll?: () => void } }
    ).canvas;
    canvas?.requestRenderAll?.();
  }, [beginProgrammaticApply, endProgrammaticApply]);

  // Handler appele quand le texte change en temps reel
  const handleTextChanged = useCallback((e: { target?: FabricObject }) => {
    if (!e.target) return;
    const obj = e.target as FabricObjectWithData;
    const elementId = obj.data?.elementId;
    const currentText = (obj as FabricObjectWithData & { text?: string }).text || "";

    clientLogger.debug("[EditorCanvas] Text changed in real-time:", elementId, `"${currentText}"`);

    // Contraintes LIVE des champs de formulaire (UX Adobe) :
    //   - /MaxLen non-comb : la saisie est TRONQUÉE à la volée (les champs
    //     comb sont déjà clampés par leur layout par-cellule au round-trip) ;
    //   - single-line : si le texte déborde la largeur du widget, la taille de
    //     police RÉTRÉCIT en direct (auto-size Adobe) et regrandit vers la
    //     taille de base quand des caractères sont effacés.
    const data = obj.data;
    if (data?.type !== "form_field") return;
    const field = data.formFieldElement as FormFieldElement | undefined;
    if (!field) return;
    const isComb = field.properties?.comb === true;
    const isMultiline = field.properties?.multiline === true;
    const set = (obj as FabricObject & { set: (...args: unknown[]) => void }).set;
    const editable = obj as FabricObjectWithData & {
      text?: string;
      width?: number;
      fontSize?: number;
      selectionStart?: number;
      selectionEnd?: number;
      canvas?: { requestRenderAll?: () => void };
    };
    let dirty = false;

    const maxLength = field.properties?.maxLength ?? null;
    if (
      !isComb &&
      typeof maxLength === "number" &&
      maxLength > 0 &&
      currentText.length > maxLength
    ) {
      set.call(obj, { text: currentText.slice(0, maxLength) });
      editable.selectionStart = Math.min(
        editable.selectionStart ?? maxLength,
        maxLength,
      );
      editable.selectionEnd = Math.min(
        editable.selectionEnd ?? maxLength,
        maxLength,
      );
      dirty = true;
    }

    if (!isComb && !isMultiline) {
      const widgetBounds =
        (data.fieldWidgetBounds as { width: number } | undefined) ??
        field.bounds;
      const avail = Math.max(4, (widgetBounds?.width ?? 0) - 4);
      const base =
        typeof data.fieldBaseFontSize === "number"
          ? data.fieldBaseFontSize
          : (editable.fontSize ?? 12);
      const measured = editable.width ?? 0;
      const current = editable.fontSize ?? base;
      if (measured > avail && current > 4) {
        // Déborde : rétrécir proportionnellement (plancher 4pt lisible).
        const next = Math.max(4, current * (avail / measured));
        if (next < current - 0.1) {
          set.call(obj, { fontSize: next });
          dirty = true;
        }
      } else if (current < base && measured > 0 && measured < avail) {
        // Regrandir vers la taille de base quand la place le permet.
        const grown = Math.min(base, current * (avail / measured));
        if (grown > current + 0.1) {
          set.call(obj, { fontSize: grown });
          dirty = true;
        }
      }
    }

    if (dirty) editable.canvas?.requestRenderAll?.();
  }, []);

  // Word-like partial formatting: the IText caret/selection moved while editing
  // (Fabric `text:selection:changed`) — push the aggregated style of the new
  // range up so the formatting toolbar reflects the right active state. `null`
  // (no edit / caret-only) tells the toolbar to fall back to the element style.
  const handleTextSelectionChanged = useCallback(
    (e: { target?: FabricObject }) => {
      if (!onTextSelectionStyleChangedRef.current) return;
      const obj = (e.target ?? editingTextRef.current) as
        | EditableTextObject
        | null;
      onTextSelectionStyleChangedRef.current(aggregateSelectionStyle(obj));
    },
    [],
  );

  // Handler appele quand un texte sort du mode edition.
  // 1:1 mode: revert overlay back to invisible IF the user did not change
  // the content. If they DID change it, keep the new text visible (with
  // its solid background) since the PDF native text underneath is now stale.
  //
  // CRITICAL: when the content changed, we MUST also notify the parent
  // (onElementModified) so the new text gets queued for the PDF bake.
  // Fabric does NOT emit `object:modified` after an inline text edit
  // (only `text:editing:exited` + `text:changed`), so without this
  // explicit forward the edit never reaches apply-elements and the
  // modification is silently lost on reload.
  const handleTextEditingExited = useCallback((e: { target?: FabricObject }) => {
    if (!e.target) return;
    const obj = e.target as FabricObjectWithData;
    // No longer the live edit target — clear the toolbar's live selection style
    // so it reverts to the whole-element state.
    if (editingTextRef.current === obj) editingTextRef.current = null;
    onTextSelectionStyleChangedRef.current?.(null);

    // PARAGRAPH EDIT SESSION exit (edit-intent model):
    //   - UNMODIFIED → put the original per-run objects back exactly as they
    //     were (zero write, zero re-render of the group);
    //   - MODIFIED   → commit through the standard queue: same line count ⇒
    //     per-line in-place updates (replaceText on the line's first run +
    //     erase of its siblings / pure moves); line count changed ⇒ reflow
    //     (removeElement of EVERY source run + one added run per re-wrapped
    //     line). The box then stays on canvas as the edited paragraph until
    //     the post-apply re-render re-forms the group from the fresh parse.
    if (obj.data?.isParagraphSession === true) {
      const sessionCanvas = fabricRef.current;
      const commit = commitParagraphSession(obj);
      if (commit.kind === "unchanged") {
        if (sessionCanvas) {
          beginProgrammaticApply();
          try {
            restoreParagraphEditSession(
              sessionCanvas,
              obj as unknown as FabricObject,
            );
          } finally {
            endProgrammaticApply();
          }
        }
        return;
      }
      const sessionElementId = obj.data?.elementId as string | undefined;
      if (commit.kind === "update") {
        for (const element of commit.elements) {
          const oldBounds = lastKnownBoundsRef.current.get(element.elementId);
          lastKnownBoundsRef.current.set(element.elementId, element.bounds);
          onElementModifiedRef.current?.(element, oldBounds);
        }
      } else {
        // Reflow: removals first (apply-operations orders the removeElement
        // calls in descending index itself), then the re-wrapped lines as
        // brand-new runs (no engine index → add path).
        for (const removedId of commit.removedElementIds) {
          onElementRemovedRef.current?.(removedId);
        }
        for (const element of commit.addedElements) {
          lastKnownBoundsRef.current.set(element.elementId, element.bounds);
          onElementAddedRef.current?.(element);
        }
      }
      // The commit supersedes the lifted per-run objects — never restore them.
      sealParagraphEditSession(obj as unknown as FabricObject);
      // Re-anchor the session snapshot so a follow-up edit (before the
      // re-render) maps against the freshly-committed baseline.
      refreshParagraphSessionAfterCommit(obj, commit);
      if (sessionElementId) {
        originalContentRef.current.set(
          sessionElementId,
          (obj as FabricObjectWithData & { text?: string }).text || "",
        );
        // The object:modified Fabric fires right after exitEditing() must not
        // re-queue the same commit.
        recentlyForwardedTextEditRef.current.set(sessionElementId, Date.now());
      }
      const setSession = (
        obj as FabricObject & { set: (...args: unknown[]) => void }
      ).set;
      setSession.call(obj, { borderColor: "rgba(0, 100, 200, 0.75)" });
      sessionCanvas?.requestRenderAll();
      if (sessionCanvas) saveHistory(sessionCanvas);
      return;
    }

    const elementId = obj.data?.elementId;
    const currentText = (obj as FabricObjectWithData & { text?: string }).text || "";
    const originalText = elementId ? originalContentRef.current.get(elementId) : undefined;
    const contentChanged = originalText !== undefined && originalText !== currentText;
    // A pure character-level style change (bold/colour on a sub-selection)
    // leaves `content` untouched but mutates Fabric's per-character `styles`
    // map, which `selectionStyleDirtyRef` flags. Forward those edits too so the
    // new `runs` reach the scene graph + apply payload (otherwise a partial
    // restyle would be silently lost on reload — same class of bug as inline
    // text edits, which Fabric also reports only via text:editing:exited).
    const styleChanged =
      elementId !== undefined &&
      selectionStyleDirtyRef.current.delete(elementId);

    // DIRECT-TEXT model: the text stays VISIBLE in its real colour whether or
    // not it changed (no mask, never invisible — the raster under it has no
    // text). Only reset the edit border.
    const set = (obj as FabricObject & { set: (...args: unknown[]) => void }).set;
    set.call(obj, { borderColor: "rgba(0, 100, 200, 0.75)" });
    // Editable text form field left empty → restore the grey placeholder. The
    // serialised value stays "" (readFormFieldValue treats text===placeholder as
    // empty), so the placeholder is never persisted as a real value.
    if (
      obj.data?.type === "form_field" &&
      typeof obj.data?.fieldPlaceholder === "string" &&
      currentText.length === 0
    ) {
      set.call(obj, {
        text: obj.data.fieldPlaceholder,
        fill: "rgba(0,0,0,0.4)",
      });
      obj.data.fieldShowingPlaceholder = true;
    }
    const canvas = (obj as FabricObject & { canvas?: { requestRenderAll?: () => void } }).canvas;
    canvas?.requestRenderAll?.();

    // Forward the edit to the parent so it can be queued for the PDF bake.
    // Without this, an inline text edit produces no `object:modified` event
    // (Fabric only fires `text:editing:exited`), and the change vanishes on
    // reload. We pass the OLD bounds tracked since the last render so the
    // bake can clear the original glyph zone before painting the new text.
    if ((contentChanged || styleChanged) && elementId) {
      // Forward the edit (a coalesced paragraph Textbox decomposes into its
      // line runs here — each with its own tracked oldBounds). Tracking is
      // refreshed per element inside forwardElementModified. Covers both a
      // text change AND a pure per-character style change (the serialised
      // element now carries `runs` from the Fabric `styles` map).
      const forwarded = forwardElementModified(obj);
      if (forwarded.length > 0) {
        // Mark this elementId so the object:modified that Fabric fires
        // immediately after exitEditing() (because we mutate fill/bg here)
        // does NOT re-queue the same edit a second time.
        recentlyForwardedTextEditRef.current.set(elementId, Date.now());
      }
    }
  }, [forwardElementModified, beginProgrammaticApply, endProgrammaticApply, saveHistory]);

  const handleObjectModified = useCallback(
    (e: { target?: FabricObject }) => {
      if (!e.target) return;
      const obj = e.target as FabricObjectWithData;
      const elementId = obj.data?.elementId;
      // Use Fabric `type` (stable across minification) — see fabricObjectToElement above.
      const typeName = (obj as FabricObject & { type?: string }).type ?? "";

      // Skip the duplicate fired by Fabric immediately after exitEditing()
      // mutates the IText (we set fill/textBackgroundColor in
      // handleTextEditingExited and that triggers another object:modified
      // for the same edit). Without this guard apply-elements bakes the
      // same text twice in two different fontFaces.
      if (elementId && (typeName === "i-text" || typeName === "textbox" || typeName === "text")) {
        const lastEditAt = recentlyForwardedTextEditRef.current.get(elementId);
        if (lastEditAt && Date.now() - lastEditAt < TEXT_EDIT_DEDUPE_WINDOW_MS) {
          recentlyForwardedTextEditRef.current.delete(elementId);
          clientLogger.debug(
            "[EditorCanvas] Skip object:modified (just forwarded via text:editing:exited)",
            elementId,
          );
          return;
        }
      }

      // Detecter le TYPE de modification
      let modificationType: ModificationType = 'position';

      // Verifier si c'est un objet texte et si le contenu a change
      if (typeName === "i-text" || typeName === "textbox" || typeName === "text") {
        const originalText = elementId ? originalContentRef.current.get(elementId) : undefined;
        const currentText = (obj as FabricObjectWithData & { text?: string }).text || "";

        if (originalText !== undefined && originalText !== currentText) {
          modificationType = 'content';
          clientLogger.debug(`[EditorCanvas] Text content MODIFIED: "${originalText}" -> "${currentText}"`);
          // Mettre a jour le contenu original pour les prochaines comparaisons
          if (elementId) {
            originalContentRef.current.set(elementId, currentText);
          }
        } else {
          clientLogger.debug("[EditorCanvas] Element position/style changed only (no content change)");
        }
      } else {
        clientLogger.debug("[EditorCanvas] Non-text element modified (position/style)");
      }

      // Forward the modification (a coalesced paragraph Textbox decomposes into
      // its line runs). Each forwarded element carries the OLD bounds tracked
      // before this change so updateText clears the original zone (no post-bake
      // doubling); tracking is refreshed per element inside the helper.
      const forwarded = forwardElementModified(obj);
      if (forwarded.length > 0) {
        clientLogger.debug(
          "[EditorCanvas] Object modified:",
          forwarded.map((el) => `${el.elementId}:${el.type}`).join(","),
          "modification:",
          modificationType,
        );
      }
      if (fabricRef.current) {
        saveHistory(fabricRef.current);
      }
    },
    [forwardElementModified, saveHistory]
  );

  const handleObjectAdded = useCallback(
    (e: { target?: FabricObject }) => {
      if (isUpdatingHistoryRef.current) return;
      if (!e.target) return;
      // Ignorer le fond PDF (image non-éditable ajoutée en arrière-plan)
      if ((e.target as FabricObjectWithData).data?.isPdfBackground) return;
      // Ignorer les masques de visibilité (Rect opaques posés par le toggle œil) :
      // ce ne sont pas des éléments du scene graph, ils ne doivent jamais être
      // queués/bakés ni remontés à page.tsx.
      if ((e.target as FabricObjectWithData).data?.isHideMask) return;
      // Ignorer les zones de rédaction (Rect semi-noirs posés par l'outil
      // « Rédaction ») : ce sont des marqueurs transitoires, jamais des
      // éléments du scene graph — ils ne doivent ni être queués/bakés ni
      // remontés à page.tsx. Leur application passe par redactPii (moteur).
      if ((e.target as FabricObjectWithData).data?.redactionMark) return;
      // A coalesced paragraph Textbox (e.g. a duplicated paragraph) decomposes
      // into its line runs so each is queued as its own add — a multi-line
      // `content` would otherwise lose every line but the first at bake time.
      const added = fabricObjectToElementsImpl(
        e.target as FabricObjectWithData,
      );
      for (const element of added) {
        clientLogger.debug("[EditorCanvas] Object added:", element.elementId, element.type);
        // Mémoriser les bounds initiales (utilisé par handleObjectModified)
        lastKnownBoundsRef.current.set(element.elementId, element.bounds);
        onElementAddedRef.current?.(element);
      }
    },
    []
  );

  const handleObjectRemoved = useCallback(
    (e: { target?: FabricObject }) => {
      if (isUpdatingHistoryRef.current) return;
      if (!e.target) return;
      // A redaction marker was deleted (e.g. selected + Delete) — refresh the
      // toolbar count; markers never reach the scene-graph removal path.
      if ((e.target as FabricObjectWithData).data?.redactionMark) {
        const count =
          fabricRef.current
            ?.getObjects()
            .filter((o) => (o as FabricObjectWithData).data?.redactionMark === true)
            .length ?? 0;
        onRedactionMarksChangedRef.current?.(count);
        return;
      }
      const removedData = (e.target as FabricObjectWithData).data;
      // A coalesced paragraph holds several source runs; deleting the block must
      // remove EVERY run (each by its own elementId), not just the first.
      const paragraphRuns = removedData?.paragraphRuns as
        | Array<{ elementId: string }>
        | undefined;
      if (
        removedData?.isParagraph === true &&
        Array.isArray(paragraphRuns) &&
        paragraphRuns.length > 0
      ) {
        for (const run of paragraphRuns) {
          if (run.elementId) {
            clientLogger.debug("[EditorCanvas] Paragraph run removed:", run.elementId);
            onElementRemovedRef.current?.(run.elementId);
          }
        }
        return;
      }
      const elementId = removedData?.elementId;
      if (elementId) {
        clientLogger.debug("[EditorCanvas] Object removed:", elementId);
        onElementRemovedRef.current?.(elementId);
      }
    },
    []
  );

  // Update event handlers when they change
  useEffect(() => {
    if (!fabricRef.current) return;
    const canvas = fabricRef.current;

    // Remove old handlers
    canvas.off("selection:created");
    canvas.off("selection:updated");
    canvas.off("selection:cleared");
    canvas.off("object:modified");
    canvas.off("object:added");
    canvas.off("object:removed");
    canvas.off("text:editing:entered");
    canvas.off("text:changed");
    canvas.off("text:editing:exited");
    canvas.off("text:selection:changed");

    // Re-attach updated handlers
    canvas.on("selection:created", handleSelectionChange);
    canvas.on("selection:updated", handleSelectionChange);
    canvas.on("selection:cleared", handleSelectionChange);
    canvas.on("object:modified", handleObjectModified as (e: unknown) => void);
    canvas.on("object:added", handleObjectAdded as (e: unknown) => void);
    canvas.on("object:removed", handleObjectRemoved as (e: unknown) => void);
    // Handlers pour detecter les modifications de contenu texte
    canvas.on("text:editing:entered", handleTextEditingEntered as (e: unknown) => void);
    canvas.on("text:changed", handleTextChanged as (e: unknown) => void);
    canvas.on("text:editing:exited", handleTextEditingExited as (e: unknown) => void);
    // Word-like partial formatting: live character-selection style → toolbar.
    canvas.on("text:selection:changed", handleTextSelectionChanged as (e: unknown) => void);
  }, [handleSelectionChange, handleObjectModified, handleObjectAdded, handleObjectRemoved, handleTextEditingEntered, handleTextChanged, handleTextEditingExited, handleTextSelectionChanged]);

  // Initialiser Fabric.js
  useEffect(() => {
    if (!containerRef.current) return;

    // Import dynamique de Fabric.js pour éviter les erreurs SSR
    import("fabric").then((fabricModule) => {
      // Conservé pour la construction hors-loadPage (session de paragraphe).
      fabricModuleRef.current = fabricModule;
      const { Canvas, Rect, Circle, Ellipse, Triangle, Line, IText, Group, FabricText, Polyline } = fabricModule;

      const host = containerRef.current;
      // Le container a pu se démonter pendant l'import async (mode continu :
      // la page sort de la fenêtre de virtualisation). Ne rien créer alors.
      if (!host) return;

      // Re-init propre : disposer une éventuelle instance Fabric précédente puis
      // retirer son <canvas> impératif du DOM (dispose() est ASYNC en fabric v7 —
      // on ne l'attend pas, mais on détache nous-mêmes le nœud pour éviter
      // l'empilement de canvases au ré-init in-place).
      if (fabricRef.current) {
        try { fabricRef.current.dispose(); } catch { /* dispose best-effort */ }
        fabricRef.current = null;
      }
      if (canvasRef.current && canvasRef.current.parentNode) {
        canvasRef.current.parentNode.removeChild(canvasRef.current);
      }

      // Création IMPÉRATIVE du <canvas> : fabric.Canvas() le déplacera dans un
      // wrapper `.canvas-container` qu'il injecte dans `host`. React ne connaît
      // que `host` (containerRef) et ne touchera jamais à ce canvas → pas de
      // removeChild fantôme au démontage.
      const el = document.createElement("canvas");
      host.appendChild(el);
      canvasRef.current = el;

      const canvas = new Canvas(el, {
        width: (page?.dimensions?.width || width) * zoom,
        height: (page?.dimensions?.height || height) * zoom,
        backgroundColor: "#ffffff",
        selection: tool === "select",
        preserveObjectStacking: true,
        // Tactile : sans ce flag, Fabric preventDefault CHAQUE touchstart/
        // touchmove (listeners passive:false) + pose touch-action:none inline
        // sur les canvases → scroll au doigt ET pinch morts sur toute la
        // surface de la page. `true` pose touch-action:manipulation sur les
        // canvases ; le gating par outil (tracé = pas de scroll) est porté par
        // le wrapper (`touchActionForTool`) + le toggle JS runtime ci-dessous.
        allowTouchScrolling: true,
      });
      // Outils de tracé (draw/shape/…): Fabric doit re-preventDefault et
      // streamer les touchmove (le crayon libre en dépend). Propriété lue à
      // CHAQUE touchstart → toggle runtime sûr (l'effet [tool] la maintient).
      canvas.allowTouchScrolling = allowTouchScrollingForTool(toolRef.current);
      // Architecture scale-pur dès l'init : sans ça, un zoom initial ≠ 1
      // (mode fit restauré) rendrait le contenu non-scalé dans un canvas
      // DOM déjà dimensionné à page×zoom.
      canvas.setViewportTransform([
        zoomRef.current, 0, 0, zoomRef.current, 0, 0,
      ]);

      fabricRef.current = canvas;

      // Remplir & Signer : stamp initial des flags live (le canvas naît APRÈS
      // le render courant ; l'effet de sync ne tournera qu'au prochain render).
      const gigaCanvas = canvas as typeof canvas & {
        _gigaFillSignMode?: boolean;
        _gigaOnSignatureFieldClick?: (element: unknown) => void;
      };
      gigaCanvas._gigaFillSignMode = fillSignActiveRef.current;
      gigaCanvas._gigaOnSignatureFieldClick = (element: unknown) =>
        onSignatureFieldClickRef.current?.(element as FormFieldElement);

      // Event handlers
      canvas.on("selection:created", handleSelectionChange);
      canvas.on("selection:updated", handleSelectionChange);
      canvas.on("selection:cleared", handleSelectionChange);
      canvas.on("object:modified", handleObjectModified as (e: unknown) => void);
      canvas.on("object:added", handleObjectAdded as (e: unknown) => void);
      canvas.on("object:removed", handleObjectRemoved as (e: unknown) => void);
      // Handlers pour detecter les modifications de contenu texte
      canvas.on("text:editing:entered", handleTextEditingEntered as (e: unknown) => void);
      canvas.on("text:changed", handleTextChanged as (e: unknown) => void);
      canvas.on("text:editing:exited", handleTextEditingExited as (e: unknown) => void);
      // Word-like partial formatting: live character-selection style → toolbar.
      canvas.on("text:selection:changed", handleTextSelectionChanged as (e: unknown) => void);

      // Mouse down for creating objects - using refs to get current values
      canvas.on("mouse:down", (e) => {
        if (!fabricRef.current || !e.scenePoint) return;
        const currentCanvas = fabricRef.current;

        // Si on clique sur un objet existant, ne rien créer
        if (e.target) return;

        const pointer = e.scenePoint;
        const currentTool = toolRef.current;
        const currentShapeType = shapeTypeRef.current;
        const currentAnnotationType = annotationTypeRef.current;
        const currentStrokeColor = strokeColorRef.current;
        const currentFillColor = fillColorRef.current;
        const currentStrokeWidth = strokeWidthRef.current;

        clientLogger.debug("[EditorCanvas] mouse:down - tool:", currentTool);

        // Freehand pencil ("draw" tool): begin capturing a polyline in scene
        // coords (origin top-left). It is baked as a real `/Ink` annotation
        // (addInk) on pointer-up; the transient preview here is removed once the
        // re-parse brings the real ink back. `skipTargetFind` (set per-tool) makes
        // e.target null so the stroke can start over any content.
        if (currentTool === "draw") {
          isInkingRef.current = true;
          inkScenePointsRef.current = [pointer.x, pointer.y];
          const preview = new Polyline([{ x: pointer.x, y: pointer.y }], {
            stroke: currentStrokeColor,
            strokeWidth: currentStrokeWidth || 2,
            fill: "transparent",
            strokeLineCap: "round",
            strokeLineJoin: "round",
            selectable: false,
            evented: false,
            objectCaching: false,
            excludeFromExport: true,
          });
          (preview as FabricObjectWithData).data = { inkPreview: true };
          inkPreviewRef.current = preview;
          currentCanvas.add(preview);
          currentCanvas.renderAll();
          return;
        }

        let newObj: FabricObject | null = null;

        try {
          switch (currentTool) {
            case "text": {
              clientLogger.debug("[EditorCanvas] Creating IText with:", { pointer, strokeColor: currentStrokeColor });
              newObj = new IText(t("defaultText") || "Text", {
                left: pointer.x,
                top: pointer.y,
                fontSize: 16,
                // Famille dominante du document (memoïsée) — un nouveau texte
                // doit ressembler au reste de la page, pas à un Arial générique.
                fontFamily: documentDefaultFontFamilyRef.current,
                fill: currentStrokeColor,
              });
              (newObj as FabricObjectWithData).data = { elementId: generateId() };
              clientLogger.debug("[EditorCanvas] IText created successfully:", newObj);
              break;
            }

          case "shape": {
            const shapeOptions = {
              left: pointer.x,
              top: pointer.y,
              fill: currentFillColor,
              stroke: currentStrokeColor,
              strokeWidth: currentStrokeWidth,
            };

            switch (currentShapeType) {
              case "rectangle":
                newObj = new Rect({
                  ...shapeOptions,
                  width: 100,
                  height: 80,
                });
                break;
              case "circle":
                newObj = new Circle({
                  ...shapeOptions,
                  radius: 50,
                });
                break;
              case "ellipse":
                newObj = new Ellipse({
                  ...shapeOptions,
                  rx: 60,
                  ry: 40,
                });
                break;
              case "triangle":
                newObj = new Triangle({
                  ...shapeOptions,
                  width: 100,
                  height: 100,
                });
                break;
              case "line":
              case "arrow":
                newObj = new Line([0, 0, 100, 0], shapeOptions);
                break;
            }
            if (newObj) {
              (newObj as FabricObjectWithData).data = { elementId: generateId() };
            }
            break;
          }

          case "annotation": {
            switch (currentAnnotationType) {
              case "highlight":
                newObj = new Rect({
                  left: pointer.x,
                  top: pointer.y,
                  width: 100,
                  height: 20,
                  fill: "rgba(255, 255, 0, 0.3)",
                  stroke: "transparent",
                });
                break;
              case "underline":
                newObj = new Line([0, 0, 100, 0], {
                  left: pointer.x,
                  top: pointer.y,
                  stroke: "#ff0000",
                  strokeWidth: 2,
                });
                break;
              case "strikeout":
              case "strikethrough":
                newObj = new Line([0, 0, 100, 0], {
                  left: pointer.x,
                  top: pointer.y,
                  stroke: "#ff0000",
                  strokeWidth: 1,
                });
                break;
              case "squiggly":
                // Wavy text-markup under the run — drawn flat here (the baked
                // /Annot renders the squiggle); colour mirrors underline.
                newObj = new Line([0, 0, 100, 0], {
                  left: pointer.x,
                  top: pointer.y,
                  stroke: "#2196f3",
                  strokeWidth: 2,
                });
                break;
              case "freetext":
                // Editable free-text annotation box; the typed content is
                // baked via addFreeText (see annotation-renderer).
                newObj = new IText(t("defaultText") || "Text", {
                  left: pointer.x,
                  top: pointer.y,
                  fontSize: 14,
                  fontFamily: documentDefaultFontFamilyRef.current,
                  fill: currentStrokeColor,
                });
                break;
              case "note":
                newObj = new Rect({
                  left: pointer.x,
                  top: pointer.y,
                  width: 30,
                  height: 30,
                  fill: "#ffeb3b",
                  stroke: "#ffc107",
                  strokeWidth: 1,
                });
                break;
              case "comment":
                newObj = new Circle({
                  left: pointer.x,
                  top: pointer.y,
                  radius: 15,
                  fill: "#2196f3",
                  stroke: "#1976d2",
                  strokeWidth: 1,
                });
                break;
              case "stamp":
                newObj = new Rect({
                  left: pointer.x,
                  top: pointer.y,
                  width: 120,
                  height: 36,
                  fill: "rgba(192, 0, 0, 0.12)",
                  stroke: "#c00000",
                  strokeWidth: 2,
                });
                break;
              case "line":
              case "arrow":
                newObj = new Line([0, 0, 120, 0], {
                  left: pointer.x,
                  top: pointer.y,
                  stroke: currentStrokeColor,
                  strokeWidth: currentStrokeWidth || 2,
                });
                break;
            }
            if (newObj) {
              // Real PDF annotations require data.annotationType so the
              // object→element mapping classifies them as AnnotationElement
              // (not a shape). Without it the backend never emits a /Annot.
              const annData: FabricObjectWithData["data"] = {
                elementId: generateId(),
                annotationType: currentAnnotationType,
              };
              if (currentAnnotationType === "stamp") {
                annData.content = "APPROVED";
              }
              if (currentAnnotationType === "arrow" || currentAnnotationType === "line") {
                annData.strokeWidth = currentStrokeWidth || 2;
              }
              (newObj as FabricObjectWithData).data = annData;
            }
            break;
          }

          case "form_field": {
            // Crée le champ selon la VARIANTE sélectionnée dans la palette
            // (fieldKind) : text / multiligne / date / case à cocher /
            // groupe radio / liste déroulante. Chaque variante a un visuel
            // distinct pour être identifiable au coup d'œil.
            const currentKind = fieldKindRef.current;

            if (currentKind === "radio_group") {
              // Création différée : un mini-formulaire demande le nom du
              // groupe + les options, puis pose N boutons partageant le
              // même fieldName (voir handleConfirmRadioGroup).
              openRadioPromptRef.current?.(pointer.x, pointer.y);
              break;
            }

            const fieldElementId = generateId();
            const placeholderText =
              currentKind === "text"
                ? t("textPlaceholder")
                : currentKind === "multiline"
                  ? t("multilinePlaceholder")
                  : currentKind === "date"
                    ? t("dateHint")
                    : null;
            const fieldElement = createFormFieldElement({
              elementId: fieldElementId,
              kind: currentKind,
              x: pointer.x,
              y: pointer.y,
              placeholder: placeholderText,
              options:
                currentKind === "dropdown" || currentKind === "listbox"
                  ? [1, 2, 3].map((n) => `${t("defaultOption")} ${n}`)
                  : undefined,
            });

            let formFieldGroup: InstanceType<typeof Group>;
            switch (currentKind) {
              case "checkbox": {
                formFieldGroup = new Group(
                  [
                    new Rect({
                      left: 0,
                      top: 0,
                      width: 20,
                      height: 20,
                      fill: "#ffffff",
                      stroke: "#555555",
                      strokeWidth: 1.5,
                      rx: 2,
                      ry: 2,
                    }),
                  ],
                  { left: pointer.x, top: pointer.y },
                );
                break;
              }
              case "dropdown": {
                formFieldGroup = new Group(
                  [
                    new Rect({
                      left: 0,
                      top: 0,
                      width: 200,
                      height: 30,
                      fill: "#ffffff",
                      stroke: "#cccccc",
                      strokeWidth: 1,
                      rx: 4,
                      ry: 4,
                    }),
                    new FabricText(t("selectPlaceholder"), {
                      left: 10,
                      top: 8,
                      fontSize: 12,
                      fontFamily: "Arial",
                      fill: "#999999",
                    }),
                    new FabricText("▾", {
                      left: 175,
                      top: 6,
                      fontSize: 14,
                      fontFamily: "Arial",
                      fill: "#666666",
                    }),
                  ],
                  { left: pointer.x, top: pointer.y },
                );
                break;
              }
              case "listbox": {
                // Liste à sélection visible : plusieurs options affichées d'un
                // coup (pas de chevron, à la différence de la combo). La 1re
                // ligne est « surlignée » pour signaler la sélection.
                formFieldGroup = new Group(
                  [
                    new Rect({
                      left: 0,
                      top: 0,
                      width: 200,
                      height: 76,
                      fill: "#ffffff",
                      stroke: "#cccccc",
                      strokeWidth: 1,
                      rx: 4,
                      ry: 4,
                    }),
                    // Bande de sélection sur la première option.
                    new Rect({
                      left: 2,
                      top: 2,
                      width: 196,
                      height: 22,
                      fill: "#e0ecff",
                    }),
                    new FabricText(`${t("defaultOption")} 1`, {
                      left: 10,
                      top: 6,
                      fontSize: 12,
                      fontFamily: "Arial",
                      fill: "#1f2937",
                    }),
                    new FabricText(`${t("defaultOption")} 2`, {
                      left: 10,
                      top: 30,
                      fontSize: 12,
                      fontFamily: "Arial",
                      fill: "#374151",
                    }),
                    new FabricText(`${t("defaultOption")} 3`, {
                      left: 10,
                      top: 54,
                      fontSize: 12,
                      fontFamily: "Arial",
                      fill: "#374151",
                    }),
                  ],
                  { left: pointer.x, top: pointer.y },
                );
                break;
              }
              case "multiline": {
                formFieldGroup = new Group(
                  [
                    new Rect({
                      left: 0,
                      top: 0,
                      width: 200,
                      height: 80,
                      fill: "#ffffff",
                      stroke: "#cccccc",
                      strokeWidth: 1,
                      rx: 4,
                      ry: 4,
                    }),
                    new FabricText(t("multilinePlaceholder"), {
                      left: 10,
                      top: 8,
                      fontSize: 12,
                      fontFamily: "Arial",
                      fill: "#999999",
                    }),
                    // Lignes d'écriture simulées — identifie la zone
                    // multiligne au premier regard.
                    new Line([10, 40, 190, 40], { stroke: "#e5e7eb", strokeWidth: 1 }),
                    new Line([10, 58, 190, 58], { stroke: "#e5e7eb", strokeWidth: 1 }),
                  ],
                  { left: pointer.x, top: pointer.y },
                );
                break;
              }
              case "date": {
                formFieldGroup = new Group(
                  [
                    new Rect({
                      left: 0,
                      top: 0,
                      width: 200,
                      height: 30,
                      fill: "#ffffff",
                      stroke: "#cccccc",
                      strokeWidth: 1,
                      rx: 4,
                      ry: 4,
                    }),
                    new FabricText(t("dateHint"), {
                      left: 10,
                      top: 8,
                      fontSize: 12,
                      fontFamily: "Arial",
                      fill: "#999999",
                    }),
                    new FabricText("📅", {
                      left: 176,
                      top: 7,
                      fontSize: 13,
                      fontFamily: "Arial",
                      fill: "#666666",
                    }),
                  ],
                  { left: pointer.x, top: pointer.y },
                );
                break;
              }
              case "text":
              default: {
                formFieldGroup = new Group(
                  [
                    new Rect({
                      left: 0,
                      top: 0,
                      width: 200,
                      height: 30,
                      fill: "#ffffff",
                      stroke: "#cccccc",
                      strokeWidth: 1,
                      rx: 4,
                      ry: 4,
                    }),
                    new FabricText(t("textPlaceholder"), {
                      left: 10,
                      top: 8,
                      fontSize: 12,
                      fontFamily: "Arial",
                      fill: "#999999",
                    }),
                  ],
                  { left: pointer.x, top: pointer.y },
                );
                break;
              }
            }

            (formFieldGroup as FabricObjectWithData).data = {
              elementId: fieldElementId,
              formFieldType: fieldElement.fieldType,
              fieldName: fieldElement.fieldName,
              required: false,
              placeholder: fieldElement.placeholder ?? "",
              // Source de vérité complète pour le round-trip Fabric→Element
              // (multiline, format date, options, style…).
              formFieldElement: fieldElement,
            };
            newObj = formFieldGroup;
            break;
          }

          // NOTE: the "draw" tool is the freehand pencil — handled by the
          // ink-capture branch above (before this switch) + the mouse:move /
          // pointer-up handlers, never as a one-shot object here.

          case "redact": {
            // Zone de rédaction — Rect semi-noir (preview AVANT application).
            // Marqué data.redactionMark : ce n'est PAS un élément du scene
            // graph (jamais queué/baké). L'application réelle (suppression du
            // texte + écrasement des pixels image + cache noir opaque,
            // irréversible) passe par le moteur (redactPii) sur « Appliquer ».
            const redactRect = new Rect({
              left: pointer.x,
              top: pointer.y,
              width: 120,
              height: 24,
              fill: "rgba(0, 0, 0, 0.55)",
              stroke: "#000000",
              strokeWidth: 1,
              // Coins corner pour distinguer du contenu, sélectionnable et
              // redimensionnable comme une forme.
              originX: "left",
              originY: "top",
            });
            (redactRect as FabricObjectWithData).data = {
              redactionMark: true,
              elementId: generateId(),
            };
            newObj = redactRect;
            break;
          }
          }
        } catch (error) {
          clientLogger.error("[EditorCanvas] Error creating object:", error);
        }

        if (newObj) {
          clientLogger.debug("[EditorCanvas] Adding new object to canvas:", currentTool, (newObj as FabricObjectWithData).data?.elementId);
          currentCanvas.add(newObj);
          currentCanvas.setActiveObject(newObj);
          currentCanvas.renderAll();
          saveHistory(currentCanvas);
          // Redaction markers are not scene-graph elements; report their live
          // count so the toolbar can enable Apply/Clear.
          if ((newObj as FabricObjectWithData).data?.redactionMark) {
            const count = currentCanvas
              .getObjects()
              .filter((o) => (o as FabricObjectWithData).data?.redactionMark === true)
              .length;
            onRedactionMarksChangedRef.current?.(count);
          }
          clientLogger.debug("[EditorCanvas] Object added to canvas, total objects:", currentCanvas.getObjects().length);
        } else {
          clientLogger.debug("[EditorCanvas] mouse:down - newObj is null for tool:", currentTool);
        }
      });

      // Molette :
      //   - Ctrl/Cmd + molette → zoom centré sur le curseur (le point sous
      //     la souris reste sous la souris — applyZoomAtClientPoint ajuste
      //     le scroll après le resize DOM).
      //   - Shift + molette → scroll horizontal (les navigateurs ne
      //     convertissent pas tous deltaY→horizontal sur un canvas).
      //   - Molette seule → scroll vertical NATIF du wrapper (on ne
      //     preventDefault pas : l'événement bulle jusqu'au overflow-auto).
      canvas.on("mouse:wheel", (opt) => {
        const event = opt.e as WheelEvent;

        // Mode intégré : le scroll ET le zoom appartiennent au scroller parent.
        // On ne preventDefault rien → l'événement bulle (ctrl+molette = zoom
        // parent, molette seule = scroll continu). Pas de wrapper local à
        // piloter ici.
        if (embeddedRef.current) {
          return;
        }

        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          event.stopPropagation();
          const currentZoom = canvas.getZoom();
          const factor =
            event.deltaY > 0 ? 1 / WHEEL_ZOOM_FACTOR : WHEEL_ZOOM_FACTOR;
          const newZoom = clampZoom(currentZoom * factor);
          if (newZoom === currentZoom) return;
          applyZoomAtClientPointRef.current(newZoom, {
            x: event.clientX,
            y: event.clientY,
          });
          // Le useEffect [zoom] ne doit pas ré-appliquer (déjà fait ici) ;
          // le parent remet aussi fitMode à null (zoom manuel).
          zoomFromWheelRef.current = true;
          onZoomChangedRef.current?.(newZoom);
          return;
        }

        if (event.shiftKey) {
          const wrapper = scrollWrapperRef.current;
          if (wrapper && event.deltaY !== 0 && event.deltaX === 0) {
            event.preventDefault();
            wrapper.scrollLeft += event.deltaY;
          }
          return;
        }
        // Pas de preventDefault : scroll vertical natif.
      });

      // Pan handlers — activated by:
      //   - the "hand" tool from the toolbar (toolRef.current === 'hand')
      //   - holding Space (any tool)
      //   - middle-click drag (any tool)
      // Drives the wrapper scroll directly so the existing overflow:auto
      // behaviour stays consistent (scrollbars visible, keyboard arrows still
      // work for fine adjustment).
      canvas.on("mouse:down", (opt) => {
        // Fabric (mode touch events) forwarde des TouchEvent bruts : lire
        // clientX dessus donne undefined → NaN dans le pan. Normalisation
        // Mouse/Pointer/Touch via clientPointFromEvent (touches[0]).
        const e = opt.e as MouseEvent | TouchEvent;
        const point = clientPointFromEvent(e);
        const shouldPan =
          (e as MouseEvent).button === 1 || // middle-click (undefined on touch)
          isSpaceDownRef.current ||
          toolRef.current === "hand";
        if (!shouldPan || !point) return;
        const wrapper = scrollWrapperRef.current;
        isPanningRef.current = true;
        panStartRef.current = {
          clientX: point.x,
          clientY: point.y,
          scrollLeft: wrapper?.scrollLeft ?? 0,
          scrollTop: wrapper?.scrollTop ?? 0,
        };
        canvas.defaultCursor = "grabbing";
        canvas.selection = false;
        e.preventDefault();
      });

      canvas.on("mouse:move", (opt) => {
        // Freehand pencil: extend the live preview while a stroke is in flight.
        // The EMITTED geometry comes from inkScenePointsRef (raw scene coords);
        // the Polyline below is a transient cosmetic preview only.
        if (isInkingRef.current && inkPreviewRef.current) {
          const sp = opt.scenePoint;
          if (sp) {
            inkScenePointsRef.current.push(sp.x, sp.y);
            const poly = inkPreviewRef.current as unknown as {
              points: { x: number; y: number }[];
            };
            poly.points.push({ x: sp.x, y: sp.y });
            canvas.renderAll();
          }
          return;
        }
        if (!isPanningRef.current || !panStartRef.current) return;
        // Même normalisation Mouse/Pointer/Touch que le mouse:down du pan.
        const point = clientPointFromEvent(opt.e);
        const wrapper = scrollWrapperRef.current;
        if (!wrapper || !point) return;
        wrapper.scrollLeft =
          panStartRef.current.scrollLeft - (point.x - panStartRef.current.clientX);
        wrapper.scrollTop =
          panStartRef.current.scrollTop - (point.y - panStartRef.current.clientY);
      });

      // Snap léger (4 px) des champs de formulaire sur les bords des autres
      // champs pendant le drag — alignement rapide sans système de guides.
      canvas.on("object:moving", (opt) => {
        const target = opt.target as FabricObjectWithData | undefined;
        if (!target?.data) return;
        const isFormField = (d: FabricObjectWithData["data"]): boolean =>
          Boolean(d && (d.formFieldElement || d.formFieldType || d.type === "form_field"));
        if (!isFormField(target.data)) return;
        const others = canvas.getObjects().filter((o) => {
          if (o === target) return false;
          return isFormField((o as FabricObjectWithData).data);
        });
        // Garde perf : au-delà de 200 champs le snap n'apporte plus rien.
        if (others.length === 0 || others.length > 200) return;
        const targetW = (target.width ?? 0) * (target.scaleX ?? 1);
        const targetH = (target.height ?? 0) * (target.scaleY ?? 1);
        const left = target.left ?? 0;
        const top = target.top ?? 0;
        let bestDx: number | null = null;
        let bestDy: number | null = null;
        for (const other of others) {
          const ol = other.left ?? 0;
          const ot = other.top ?? 0;
          const ow = (other.width ?? 0) * (other.scaleX ?? 1);
          const oh = (other.height ?? 0) * (other.scaleY ?? 1);
          for (const edge of [ol, ol + ow]) {
            for (const myEdge of [left, left + targetW]) {
              const delta = edge - myEdge;
              if (
                Math.abs(delta) <= FIELD_SNAP_DISTANCE &&
                (bestDx === null || Math.abs(delta) < Math.abs(bestDx))
              ) {
                bestDx = delta;
              }
            }
          }
          for (const edge of [ot, ot + oh]) {
            for (const myEdge of [top, top + targetH]) {
              const delta = edge - myEdge;
              if (
                Math.abs(delta) <= FIELD_SNAP_DISTANCE &&
                (bestDy === null || Math.abs(delta) < Math.abs(bestDy))
              ) {
                bestDy = delta;
              }
            }
          }
        }
        if (bestDx !== null) target.set({ left: left + bestDx });
        if (bestDy !== null) target.set({ top: top + bestDy });
      });

      const endPan = () => {
        // Freehand pencil: finalise the stroke on pointer-up / pointer-out.
        // Lower the captured scene polyline to PDF user space (the same flip as
        // every other bake) and emit it; the real `/Ink` annotation comes back on
        // re-parse, so the cosmetic preview is dropped here.
        if (isInkingRef.current) {
          isInkingRef.current = false;
          if (inkPreviewRef.current) {
            canvas.remove(inkPreviewRef.current);
            inkPreviewRef.current = null;
          }
          const scenePts = inkScenePointsRef.current;
          inkScenePointsRef.current = [];
          canvas.renderAll();
          // Need at least two distinct points (4 numbers) to form a stroke.
          if (scenePts.length >= 4) {
            const geo = pageDimsRef.current;
            const pdfPts: number[] = [];
            for (let i = 0; i + 1 < scenePts.length; i += 2) {
              const [px, py] = sceneToPdfUserPoint(scenePts[i]!, scenePts[i + 1]!, geo);
              pdfPts.push(px, py);
            }
            onInkDrawnRef.current?.(pdfPts);
          }
          return;
        }
        if (!isPanningRef.current) return;
        isPanningRef.current = false;
        panStartRef.current = null;
        const tool = toolRef.current;
        canvas.defaultCursor =
          isSpaceDownRef.current || tool === "hand"
            ? "grab"
            : tool === "select"
              ? "default"
              : "crosshair";
        canvas.selection = tool === "select";
      };
      canvas.on("mouse:up", endPan);
      canvas.on("mouse:out", endPan);

      // Double-click for hyperlinks - using refs
      canvas.on("mouse:dblclick", (e) => {
        if (!e.target) return;
        const obj = e.target as FabricObjectWithData;
        const data = obj.data;
        if (data?.linkUrl || data?.linkPage) {
          onHyperlinkClickRef.current?.(data.linkUrl as string | null, data.linkPage as number | null);
        }
      });

      // Charger la page initiale via loadPage (inclut fond PDF).
      // On doit le faire ici car le useEffect [page, loadPage] vérifie
      // fabricRef.current synchroniquement AVANT que l'import("fabric") se
      // résout → il est déjà sorti sans rien faire.
      if (page) {
        previousPageRef.current = page.pageId;
        loadPage(page, fabricModule).then(() => {
          saveHistory(canvas);
        }).catch(() => {
          saveHistory(canvas);
        });
      } else {
        // Sauvegarder l'état initial du canvas vide
        saveHistory(canvas);
      }
    });

    return () => {
      // dispose() est ASYNC en fabric v7 (la restauration du DOM par Fabric
      // n'aura pas lieu avant le démontage React) — on ne l'attend pas.
      try { fabricRef.current?.dispose(); } catch { /* dispose best-effort */ }
      fabricRef.current = null;
      // Détacher le canvas impératif de SON wrapper Fabric. Sûr car
      // canvasRef.current vit dans le wrapper `.canvas-container` créé par
      // Fabric (son vrai parent), que React ne gère pas. Au démontage React
      // retire containerRef en entier ; ce retrait manuel sert surtout au
      // ré-init in-place pour ne pas empiler les canvases.
      if (canvasRef.current && canvasRef.current.parentNode) {
        canvasRef.current.parentNode.removeChild(canvasRef.current);
      }
      canvasRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Renders real PDF elements (text/image/shape/annotation/form_field) from the scene graph
   * onto the Fabric canvas, layered above the PDF background image.
   *
   * Performance note: images are loaded in parallel via Promise.all to stay within 500ms
   * for typical 100-element pages. The canvas is rendered once after all sync objects are
   * added; async image loads each trigger a targeted renderAll on completion.
   */
  // useCallback (et non simple const) : référencé par le useEffect qui expose
  // EditorCanvasHandle — sans identité stable, le handle serait reconstruit à
  // chaque render. Seule dépendance réelle : getFontFaceName (fonts embarquées).
  const renderElementsOverlay = useCallback(
    async (
      canvas: FabricCanvas,
      elements: Element[],
      fabricModule: typeof import("fabric"),
      blockGroups?: PageObject["blockGroups"],
    ): Promise<void> => {
      // Delegate to the single canonical overlay renderer (render-elements.ts).
      // The continuous view (PageCanvasHost) calls the SAME function, so both
      // surfaces build the Fabric overlay identically (invisible 1:1-fidelity
      // hit-targets). We inject the single-page editor's embedded-font resolver
      // and edit-time hide-mask; and the native engine's structural `blockGroups`
      // (when the page carries them) so paragraphs/headings coalesce from the lib
      // instead of the positional heuristic. Everything else lives in one place.
      await renderElementsOverlayShared(canvas, elements, fabricModule, {
        applyHideMask,
        ...(getFontFaceName ? { getFontFaceName } : {}),
        ...(blockGroups && blockGroups.length > 0 ? { blockGroups } : {}),
      });
    },
    [getFontFaceName, applyHideMask],
  );

  // Ref bridge: `loadPage` is memoised with `[]` (stable identity), so its
  // closure captures the FIRST-render `renderElementsOverlay` — whose embedded
  // `getFontFaceName` had ZERO fonts loaded. Reading the resolver through this
  // ref makes every (re)load use the CURRENT resolver instead, so embedded fonts
  // apply on page navigation (not only on the initial font-finish re-render).
  const renderElementsOverlayRef = useRef(renderElementsOverlay);
  renderElementsOverlayRef.current = renderElementsOverlay;

  // Charger une page dans le canvas
  const loadPage = useCallback(
    async (pageData: PageObject, fabricModule: typeof import("fabric")) => {
      if (!fabricRef.current) return;
      const canvas = fabricRef.current;

      // Bloquer les événements object:added/removed pendant le chargement pour
      // éviter d'envoyer des appels API pour des éléments déjà existants
      beginProgrammaticApply();

      canvas.clear();
      canvas.backgroundColor = "#ffffff";

      // --- Rendu du fond PDF ---
      // On rend la page PDF comme une image Fabric.js non-sélectionnable à
      // l'index 0, de sorte qu'elle soit affectée par canvas.setZoom() comme
      // tous les autres objets (backgroundImage ne l'est pas).
      const docId = documentIdRef.current;
      if (docId) {
        try {
          const pdfUrl = `/backend-api/api/v1/documents/${docId}/download`;
          const { getAuthToken } = await import("@/lib/api");
          const token = await getAuthToken();
          const response = await fetch(pdfUrl, {
            credentials: "include",
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          });
          if (response.ok) {
            const arrayBuffer = await response.arrayBuffer();
            // Import dynamique pour éviter les problèmes SSR
            const { PDFRenderer } = await import("@giga-pdf/canvas");
            const renderer = new PDFRenderer();
            await renderer.loadDocument(arrayBuffer);
            // Rendre à une résolution plus élevée (HiDPI) pour un rendu net,
            // puis réduire l'image via scaleX/scaleY pour garder les dimensions PDF correctes.
            const renderScale = backgroundRenderScale(window.devicePixelRatio);
            const dataUrl = await renderer.renderPageToDataURL(pageData.pageNumber, {
              scale: renderScale,
              // Text-free raster: the engine renders everything EXCEPT text
              // (vector art, gradients/shadings, IMAGES and SHAPES stay 1:1).
              // The REAL editable text is painted as a visible Fabric overlay on
              // top, so editing is direct and works on any background — no colour
              // mask. SHAPES stay in this raster (= visual ground truth) and the
              // overlay paints them as transparent, editable hit-targets revealed
              // on selection (render-elements.ts). We deliberately do NOT pass
              // `excludeIndices` for shapes: `renderPageExcluding` is fed by the
              // unified element index, but the engine honours it only for SOME
              // vector paths (e.g. it drops index 34 yet keeps 101 on real docs),
              // and mixing in the text-run ordinals (a different index space)
              // over-excludes unrelated content — both left whole colored
              // section backgrounds blank. Keeping shapes in the raster makes
              // their fidelity exact and independent of that engine quirk.
              skipText: true,
              // In Word-like H/F edit mode, drop the baked `/GPHF` band so the
              // editable HeaderFooterZone overlaid on top never doubles it.
              ...(headerFooterActiveRef.current
                ? { excludeMarkedContent: true }
                : {}),
            });
            renderer.dispose();

            // Build the index-0 PDF-background image via the shared helper
            // (same construction as the continuous-view PageCanvasHost).
            await addPdfBackground(canvas, fabricModule, dataUrl, renderScale);
          }
        } catch (e) {
          clientLogger.warn("[EditorCanvas] Could not render PDF background:", e);
        }
      }

      // --- Charger les éléments éditables par-dessus le fond PDF ---
      // renderElementsOverlay handles all element types (text/image/shape/annotation/form_field),
      // attaches rich metadata to each Fabric object's .data property, and awaits async image loads
      // before the final canvas.renderAll() — so the canvas is fully populated in one shot.
      if (pageData.elements && pageData.elements.length > 0) {
        // Capturer les bounds initiaux POUR CHAQUE élément. Sans ça
        // la première modification d'un élément parsé efface la NOUVELLE
        // zone (oldBounds undefined → fallback element.bounds) et le
        // glyphe original reste visible.
        for (const el of pageData.elements) {
          if (el.elementId && el.bounds) {
            lastKnownBoundsRef.current.set(el.elementId, el.bounds);
          }
        }
        await renderElementsOverlayRef.current(
          canvas,
          pageData.elements,
          fabricModule,
          pageData.blockGroups,
        );
      } else {
        canvas.renderAll();
      }

      endProgrammaticApply();
    },
    // beginProgrammaticApply/endProgrammaticApply/renderElementsOverlay sont
    // référencés via la closure du premier render (deps [] volontaires,
    // pattern existant) — begin/end sont stables, renderElementsOverlay ne
    // varie qu'avec getFontFaceName.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Mettre à jour la page quand elle change
  useEffect(() => {
    if (!fabricRef.current || !page) return;
    if (previousPageRef.current === page.pageId) return;
    previousPageRef.current = page.pageId;

    import("fabric").then((fabricModule) => {
      loadPage(page, fabricModule);
    });
  }, [page, loadPage]);

  // Rebuild ONLY the editable overlay (keep the index-0 text-free PDF background
  // — no re-fetch, no flash) with the CURRENT embedded-font resolver. Used by the
  // font loading→ready one-shot below to swap fallback metrics for the exact
  // embedded subsets. Wrapped in begin/endProgrammaticApply so the remove/add
  // churn fires no scene-graph mutations (no save loop, no history entry).
  const reRenderOverlayForFonts = useCallback(async () => {
    const canvas = fabricRef.current;
    if (!canvas || !page) return;
    const fabricModule = await import("fabric");
    beginProgrammaticApply();
    try {
      const overlay = canvas
        .getObjects()
        .filter(
          (o) =>
            (o as { data?: { isPdfBackground?: boolean } }).data
              ?.isPdfBackground !== true,
        );
      for (const o of overlay) canvas.remove(o);
      if (page.elements && page.elements.length > 0) {
        await renderElementsOverlay(
          canvas,
          page.elements,
          fabricModule,
          page.blockGroups,
        );
      } else {
        canvas.renderAll();
      }
    } finally {
      endProgrammaticApply();
    }
  }, [page, renderElementsOverlay, beginProgrammaticApply, endProgrammaticApply]);

  // Re-render the overlay EXACTLY ONCE, on the embedded-fonts loading→ready EDGE.
  // The first loadPage runs before async font loading finishes, so its text
  // overlay uses FALLBACK metrics; this single corrective pass swaps in the exact
  // embedded subsets (correct metrics → no overlap). Gating on the true→false
  // transition (not on `page`) avoids both the per-font-tick flicker and a
  // redundant pass on plain navigation (handled by the renderElementsOverlay ref
  // bridge in loadPage).
  const prevFontsLoadingRef = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    const wasLoading = prevFontsLoadingRef.current;
    prevFontsLoadingRef.current = fontsLoading;
    if (wasLoading !== true || fontsLoading) return;
    if (!fabricRef.current || !page) return;
    void reRenderOverlayForFonts();
  }, [fontsLoading, page, reRenderOverlayForFonts]);

  // Mettre à jour le zoom (changement venant du store : toolbar, presets,
  // raccourcis, modes fit).
  //
  // - Changement issu de la molette (zoomFromWheelRef=true) : le handler a
  //   déjà tout appliqué de façon ancrée sur le curseur — on consomme juste
  //   le flag.
  // - Sinon : zoom ancré sur le CENTRE du viewport visible, pour que le
  //   point focal de l'utilisateur ne saute pas au coin (0,0).
  useEffect(() => {
    if (!fabricRef.current || !page) return;
    if (zoomFromWheelRef.current) {
      zoomFromWheelRef.current = false;
      return;
    }
    const wrapper = scrollWrapperRef.current;
    let anchor: { x: number; y: number } | null = null;
    if (wrapper) {
      const rect = wrapper.getBoundingClientRect();
      anchor = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    applyZoomAtClientPoint(zoom, anchor);
  }, [zoom, page, applyZoomAtClientPoint]);

  // Mettre à jour les options de l'outil
  useEffect(() => {
    if (!fabricRef.current) return;
    fabricRef.current.selection = tool === "select";
    fabricRef.current.defaultCursor =
      tool === "hand" ? "grab" : tool === "select" ? "default" : "crosshair";
    // Freehand pencil: skip hit-testing so a stroke can be drawn ANYWHERE
    // (including over existing text/images) without selecting/dragging the
    // object underneath — the Fabric-native equivalent of isDrawingMode for our
    // manual polyline capture.
    fabricRef.current.skipTargetFind = tool === "draw";
    // Tactile : outils de tracé → Fabric preventDefault + streame les
    // touchmove (crayon libre) ; outils de navigation → scroll natif au doigt.
    // Le gating CSS équivalent vit sur le wrapper (touchActionForTool en JSX).
    fabricRef.current.allowTouchScrolling = allowTouchScrollingForTool(tool);
    fabricRef.current.renderAll();
  }, [tool]);

  // Pinch-to-zoom applicatif (mode standalone uniquement — en mode intégré le
  // défileur continu possède le zoom et attache son propre pinch sur son
  // scroll root). Deux pointeurs TOUCH sur le viewport → zoom borné
  // [MIN_ZOOM, MAX_ZOOM] ancré au midpoint des doigts, via le MÊME chemin que
  // le Ctrl+molette (applyZoomAtClientPoint + zoomFromWheelRef + onZoomChanged
  // → le parent remet fitMode à null). Souris/stylet ignorés (desktop intact).
  useEffect(() => {
    if (embedded) return;
    const wrapper = scrollWrapperRef.current;
    if (!wrapper) return;
    return attachPinchZoom(wrapper, {
      getZoom: () => fabricRef.current?.getZoom() || zoomRef.current || 1,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      onPinchZoom: (nextZoom, center) => {
        const canvas = fabricRef.current;
        if (!canvas) return;
        const currentZoom = canvas.getZoom() || 1;
        if (Math.abs(nextZoom - currentZoom) < 0.0005) return;
        const applied = applyZoomAtClientPointRef.current(nextZoom, center);
        zoomFromWheelRef.current = true;
        onZoomChangedRef.current?.(applied);
      },
    });
  }, [embedded]);

  // Hold-Space-to-pan : track Space key globally so the user can grab the
  // page from any tool without switching. We ignore the keystroke when an
  // editable element is focused (typing inside an IText overlay, a form
  // field, the search bar, etc.) so the user can still type spaces.
  useEffect(() => {
    const isTextInputFocused = (): boolean => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (el.isContentEditable) return true;
      // Fabric's IText editing creates a hidden textarea — guard against it.
      if (el.classList?.contains("upper-canvas")) return false;
      return false;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      if (isTextInputFocused()) return;
      if (isSpaceDownRef.current) return;
      isSpaceDownRef.current = true;
      const canvas = fabricRef.current;
      if (canvas) {
        canvas.defaultCursor = "grab";
        canvas.selection = false;
      }
      e.preventDefault();
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      isSpaceDownRef.current = false;
      const canvas = fabricRef.current;
      if (!canvas) return;
      const t = toolRef.current;
      canvas.defaultCursor =
        t === "hand" ? "grab" : t === "select" ? "default" : "crosshair";
      canvas.selection = t === "select";
    };

    // Perte de focus fenêtre pendant un Espace maintenu (Alt+Tab, devtools) :
    // sans ce reset le keyup est raté et le curseur reste bloqué en "grab".
    const onWindowBlur = () => {
      if (!isSpaceDownRef.current) return;
      isSpaceDownRef.current = false;
      const canvas = fabricRef.current;
      if (!canvas) return;
      const t = toolRef.current;
      canvas.defaultCursor =
        t === "hand" ? "grab" : t === "select" ? "default" : "crosshair";
      canvas.selection = t === "select";
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, []);

  // Exposer les méthodes via callback
  useEffect(() => {
    if (!onCanvasReady) return;

    const handle: EditorCanvasHandle = {
      addImage: (
        dataUrl: string,
        _width?: number,
        _height?: number,
        target?: { x: number; y: number; width: number; height: number },
      ) => {
        if (!fabricRef.current) return;
        import("fabric").then(({ FabricImage }) => {
          FabricImage.fromURL(dataUrl).then((img) => {
            const naturalW =
              (img as unknown as { width: number }).width || 400;
            const naturalH =
              (img as unknown as { height: number }).height || 400;
            let left = 50;
            let top = 50;
            let scaleX = Math.min(1, 400 / naturalW);
            let scaleY = Math.min(1, 400 / naturalH);
            if (target && target.width > 0 && target.height > 0) {
              // Remplir & Signer : ajuster l'image DANS le rect du widget
              // signature — ratio préservé, centrée dans le rect.
              const fit = Math.min(
                target.width / naturalW,
                target.height / naturalH,
              );
              scaleX = fit;
              scaleY = fit;
              left = target.x + (target.width - naturalW * fit) / 2;
              top = target.y + (target.height - naturalH * fit) / 2;
            }
            img.set({
              left,
              top,
              // Fabric v6 defaults originX/Y to 'center'; force 'left'/'top'
              // so left/top reference the corner, not the centre.
              originX: "left",
              originY: "top",
              scaleX,
              scaleY,
            });
            (img as FabricObjectWithData).data = { elementId: generateId() };
            fabricRef.current?.add(img);
            fabricRef.current?.setActiveObject(img);
            fabricRef.current?.renderAll();
            if (fabricRef.current) {
              saveHistory(fabricRef.current);
            }
          });
        });
      },
      undo: () => {
        if (historyIndex <= 0 || !fabricRef.current) return;
        const newIndex = historyIndex - 1;
        const json = historyStack[newIndex];
        if (!json) return;
        beginProgrammaticApply();
        fabricRef.current.loadFromJSON(JSON.parse(json)).then(() => {
          fabricRef.current?.renderAll();
          setHistoryIndex(newIndex);
          endProgrammaticApply();
        });
      },
      redo: () => {
        if (historyIndex >= historyStack.length - 1 || !fabricRef.current)
          return;
        const newIndex = historyIndex + 1;
        const json = historyStack[newIndex];
        if (!json) return;
        beginProgrammaticApply();
        fabricRef.current.loadFromJSON(JSON.parse(json)).then(() => {
          fabricRef.current?.renderAll();
          setHistoryIndex(newIndex);
          endProgrammaticApply();
        });
      },
      canUndo: () => historyIndex > 0,
      canRedo: () => historyIndex < historyStack.length - 1,
      deleteSelected: () => {
        if (!fabricRef.current) return;
        const activeObjects = fabricRef.current.getActiveObjects();
        // Capture elementIds BEFORE remove() — Fabric drops .data on
        // removed objects in some paths and the object:removed listener
        // can miss them, leaving the scene graph + Redis with stale
        // entries (and the doc never marked dirty).
        const removedIds = activeObjects
          .map((obj) => (obj as FabricObjectWithData).data?.elementId)
          .filter((id): id is string => Boolean(id));
        activeObjects.forEach((obj) => {
          fabricRef.current?.remove(obj);
        });
        // Retirer aussi les hit-targets plein rect appariés aux champs de
        // formulaire supprimés (sinon un Rect orphelin reste cliquable).
        for (const id of removedIds) {
          if (fabricRef.current) removeFieldHitTwin(fabricRef.current, id);
        }
        fabricRef.current.discardActiveObject();
        fabricRef.current.renderAll();
        saveHistory(fabricRef.current);
        // Defense-in-depth: explicitly forward each elementId to the
        // React side. The Fabric object:removed event also fires, but
        // the parent handler is idempotent (it deselects + queues a
        // delete; running twice is a no-op for already-removed ids).
        for (const id of removedIds) {
          onElementRemovedRef.current?.(id);
        }
      },
      duplicateSelected: () => {
        if (!fabricRef.current) return;
        const activeObjects = fabricRef.current.getActiveObjects();
        fabricRef.current.discardActiveObject();
        activeObjects.forEach((obj) => {
          const srcData = (obj as FabricObjectWithData).data;
          obj.clone().then((cloned: FabricObject) => {
            cloned.set({
              left: (cloned.left || 0) + 20,
              top: (cloned.top || 0) + 20,
            });
            // Preserve the source's editing metadata (type, originalFont,
            // formFieldElement…) so the duplicate round-trips as the SAME
            // element kind, but give it a FRESH elementId and DROP the engine
            // `index`/`rotation0`: a duplicate is brand-new content with no
            // original engine element, so it must take the `add` path (never an
            // in-place transform of the original it was copied from).
            const { index: _index, rotation0: _rotation0, ...keep } =
              (srcData ?? {}) as FabricObjectWithData["data"] & {
                index?: number;
                rotation0?: number;
              };
            void _index;
            void _rotation0;
            // For a coalesced PARAGRAPH, also strip the per-run engine indices
            // and re-id the stashed runs: the duplicate is brand-new content,
            // so its lines must take the `add` path and must NEVER `replaceText`
            // the ORIGINAL runs they were copied from.
            const keepRuns = keep as {
              isParagraph?: boolean;
              paragraphRuns?: unknown;
              isParagraphSession?: unknown;
              lineRuns?: unknown;
              paragraphGroupId?: unknown;
              paragraphGroup?: unknown;
              sessionLineTexts?: unknown;
              sessionOriginalText?: unknown;
              sessionOrigin?: unknown;
            };
            if (keepRuns.isParagraph && Array.isArray(keepRuns.paragraphRuns)) {
              keepRuns.paragraphRuns = (
                keepRuns.paragraphRuns as Array<{
                  index?: number;
                  bounds: { x: number; y: number; width: number; height: number };
                  content: string;
                }>
              ).map((r) => ({
                elementId: generateId(),
                bounds: { ...r.bounds },
                content: r.content,
              }));
            }
            // EDIT-INTENT markers must NEVER survive duplication: a clone is
            // brand-new content, not a member of the source paragraph group
            // nor a live edit session (its lines must take the `add` path).
            delete keepRuns.isParagraphSession;
            delete keepRuns.lineRuns;
            delete keepRuns.paragraphGroupId;
            delete keepRuns.paragraphGroup;
            delete keepRuns.sessionLineTexts;
            delete keepRuns.sessionOriginalText;
            delete keepRuns.sessionOrigin;
            (cloned as FabricObjectWithData).data = {
              ...keep,
              elementId: generateId(),
            };
            // `canvas.add` fires `object:added` → handleObjectAdded →
            // onElementAdded → queueAdd, so the duplicate PERSISTS on save
            // (previously it was Fabric-only and vanished on reload).
            fabricRef.current?.add(cloned);
            fabricRef.current?.setActiveObject(cloned);
            fabricRef.current?.requestRenderAll();
          });
        });
        fabricRef.current.renderAll();
        if (fabricRef.current) {
          saveHistory(fabricRef.current);
        }
      },
      bringToFront: (elementId: string) => {
        const canvas = fabricRef.current;
        if (!canvas) return;
        const obj = canvas
          .getObjects()
          .find(
            (o) => (o as FabricObjectWithData).data?.elementId === elementId,
          ) as FabricObjectWithData | undefined;
        if (!obj) return;
        // Fabric v6 renamed the z-order API to the `*Object*` form.
        canvas.bringObjectToFront(obj);
        canvas.requestRenderAll();
        // A pure reorder changes ONLY the stacking, never the bounds — so we
        // emit ONLY the dedicated `reorder` op (queueReorder → engine
        // `reorderElement` bake), which survives reload. We deliberately do NOT
        // also emit onElementModified: that would queue a redundant `update`
        // (redact + re-add) op for unchanged bounds — wasteful, and worse, the
        // redact+readd re-adds the element ON TOP, which can contradict a
        // sendToBack. The PDF binary z-order is persisted by the reorder op alone.
        const element = fabricObjectToElement(obj);
        if (element) {
          onElementReorderedRef.current?.(element, true);
        }
        saveHistory(canvas);
      },
      sendToBack: (elementId: string) => {
        const canvas = fabricRef.current;
        if (!canvas) return;
        const obj = canvas
          .getObjects()
          .find(
            (o) => (o as FabricObjectWithData).data?.elementId === elementId,
          ) as FabricObjectWithData | undefined;
        if (!obj) return;
        canvas.sendObjectToBack(obj);
        canvas.requestRenderAll();
        // Pure reorder (see bringToFront): emit ONLY the dedicated `reorder` op,
        // never onElementModified — a redact+readd `update` would re-add the
        // element on top and contradict this sendToBack, besides being redundant
        // for unchanged bounds.
        const element = fabricObjectToElement(obj);
        if (element) {
          onElementReorderedRef.current?.(element, false);
        }
        saveHistory(canvas);
      },
      getSelectedIds: () => {
        if (!fabricRef.current) return [];
        return fabricRef.current
          .getActiveObjects()
          .map((obj) => (obj as FabricObjectWithData).data?.elementId)
          .filter(Boolean) as string[];
      },
      applyTextFormat: (action: TextFormatAction) => {
        if (!fabricRef.current) return;
        const canvas = fabricRef.current;
        // getActiveObjects() aplatit une ActiveSelection en ses enfants —
        // sélection simple et multiple sont donc traitées uniformément.
        const textObjects = canvas.getActiveObjects().filter((obj) => {
          const typeName = (obj as FabricObject & { type?: string }).type ?? "";
          return typeName === "i-text" || typeName === "text" || typeName === "textbox";
        }) as Array<
          FabricObjectWithData & {
            fontWeight?: string | number;
            fontStyle?: string;
            underline?: boolean;
          }
        >;
        if (textObjects.length === 0) return;

        for (const obj of textObjects) {
          switch (action) {
            case "bold":
              obj.set({
                fontWeight: isBoldFontWeight(obj.fontWeight) ? "normal" : "bold",
              });
              break;
            case "italic":
              obj.set({
                fontStyle: obj.fontStyle === "italic" ? "normal" : "italic",
              });
              break;
            case "underline":
              obj.set({ underline: !obj.underline });
              break;
            case "alignLeft":
              obj.set({ textAlign: "left" });
              break;
            case "alignCenter":
              obj.set({ textAlign: "center" });
              break;
            case "alignRight":
              obj.set({ textAlign: "right" });
              break;
          }
        }
        canvas.requestRenderAll();

        // MÊME synchronisation scene-graph que handleObjectModified (souris) :
        // conversion objet→element + oldBounds trackés AVANT la modification
        // (zone à effacer côté apply-elements) + onElementModified, puis un
        // snapshot d'historique unique pour toute l'action.
        for (const obj of textObjects) {
          const element = fabricObjectToElement(obj);
          if (!element) continue;
          const oldBounds = lastKnownBoundsRef.current.get(element.elementId);
          // Changement de style pur : le glyphe ne bouge pas. Dans une
          // ActiveSelection, obj.left/top sont RELATIFS à la sélection —
          // des bounds recalculées seraient fausses ; on réutilise alors
          // les bounds trackées.
          const bounds = obj.group && oldBounds ? oldBounds : element.bounds;
          const syncedElement = { ...element, bounds };
          lastKnownBoundsRef.current.set(element.elementId, bounds);
          onElementModifiedRef.current?.(syncedElement, oldBounds);
        }
        saveHistory(canvas);
      },

      applySelectionStyle: (patch: Partial<TextStyle>): boolean => {
        const editing = editingTextRef.current as EditableTextObject | null;
        // Only act when a text object is in inline-edit mode with a real
        // (non-empty) character sub-selection. Caret-only or no-edit ⇒ defer to
        // the whole-element style path.
        if (
          !editing ||
          editing.isEditing !== true ||
          typeof editing.selectionStart !== "number" ||
          typeof editing.selectionEnd !== "number" ||
          editing.selectionStart >= editing.selectionEnd ||
          typeof editing.setSelectionStyles !== "function"
        ) {
          return false;
        }
        const fabricStyle = modelStyleToFabricChar(patch);
        if (Object.keys(fabricStyle).length === 0) return false;
        editing.setSelectionStyles(
          fabricStyle,
          editing.selectionStart,
          editing.selectionEnd,
        );
        const elementId = (editing as FabricObjectWithData).data?.elementId;
        if (elementId) selectionStyleDirtyRef.current.add(elementId);
        fabricRef.current?.requestRenderAll();
        // Reflect the new selection style in the toolbar immediately (the
        // selection range itself is unchanged, so Fabric fires no
        // text:selection:changed here).
        onTextSelectionStyleChangedRef.current?.(
          aggregateSelectionStyle(editing),
        );
        return true;
      },

      getActiveTextSelectionStyle: (): Partial<TextStyle> | null =>
        aggregateSelectionStyle(
          editingTextRef.current as EditableTextObject | null,
        ),

      // Fabric lower canvas of this page (the rendered PDF background). The
      // content-edit overlay samples it behind text zones. Lazy getter: returns
      // whatever canvas is mounted now (the active page in the continuous view).
      getPdfCanvas: (): HTMLCanvasElement | null => canvasRef.current,

      // --- Application des événements de collaboration distants ---
      // Ces trois méthodes reproduisent l'effet d'une action utilisateur SANS
      // repasser par les callbacks Fabric : beginProgrammaticApply bloque
      // handleObjectAdded/Removed pendant l'opération, donc AUCUN
      // onElementAdded/onElementRemoved ne remonte à page.tsx → pas de
      // queueAdd/queueUpdate/queueDelete, pas de save, pas de réémission
      // socket (anti-boucle d'écho). Le scene graph React est mis à jour par
      // l'appelant (page.tsx) AVANT l'appel.
      applyRemoteElementCreate: (element: Element) => {
        const canvas = fabricRef.current;
        if (!canvas) return;
        void (async () => {
          beginProgrammaticApply();
          try {
            const fabricModule = await import("fabric");
            // Double délivrance réseau : si l'objet existe déjà, le retirer
            // d'abord au lieu d'empiler un doublon visuel.
            const existing = canvas
              .getObjects()
              .find(
                (o) =>
                  (o as FabricObjectWithData).data?.elementId ===
                  element.elementId,
              );
            if (existing) canvas.remove(existing);
            // Le hit-target plein rect d'un champ est re-créé par le render —
            // retirer l'ancien pour ne pas empiler des Rects orphelins.
            removeFieldHitTwin(canvas, element.elementId);
            // Même tracking qu'au load : bounds initiales pour que la
            // première modification locale efface la bonne zone au bake.
            lastKnownBoundsRef.current.set(element.elementId, element.bounds);
            if (element.type === "text") {
              originalContentRef.current.set(
                element.elementId,
                element.content || "",
              );
            }
            // Réutilise le MÊME convertisseur element→Fabric que le render
            // initial (z-order, data.elementId, originX/Y 'left'/'top',
            // baseline texte, fonts embarquées).
            await renderElementsOverlay(canvas, [element], fabricModule);
          } catch (err) {
            clientLogger.error(
              "[EditorCanvas] applyRemoteElementCreate failed:",
              element.elementId,
              err,
            );
          } finally {
            endProgrammaticApply();
          }
        })();
      },
      applyRemoteElementUpdate: (element: Element) => {
        const canvas = fabricRef.current;
        if (!canvas) return;
        const existing = canvas
          .getObjects()
          .find(
            (o) =>
              (o as FabricObjectWithData).data?.elementId === element.elementId,
          ) as (FabricObjectWithData & { isEditing?: boolean }) | undefined;
        // L'édition locale gagne : un élément sélectionné ou en cours
        // d'édition inline n'est PAS écrasé par l'update distant (dernière
        // écriture au save).
        if (existing) {
          const isSelectedLocally = canvas
            .getActiveObjects()
            .some(
              (o) =>
                (o as FabricObjectWithData).data?.elementId ===
                element.elementId,
            );
          if (isSelectedLocally || Boolean(existing.isEditing)) {
            clientLogger.debug(
              "[EditorCanvas] Remote update ignored (element locally selected/editing):",
              element.elementId,
            );
            return;
          }
        }
        void (async () => {
          beginProgrammaticApply();
          try {
            const fabricModule = await import("fabric");
            // Retirer/re-créer via le convertisseur : plus sûr que muter
            // propriété par propriété (offsets baseline/descender, fonts
            // embarquées et mode "1:1 fidelity" recalculés comme au load).
            // La sélection locale d'AUTRES objets n'est pas affectée.
            if (existing) canvas.remove(existing);
            // Retirer aussi le hit-target apparié (re-créé par le render).
            removeFieldHitTwin(canvas, element.elementId);
            lastKnownBoundsRef.current.set(element.elementId, element.bounds);
            if (element.type === "text") {
              originalContentRef.current.set(
                element.elementId,
                element.content || "",
              );
            }
            await renderElementsOverlay(canvas, [element], fabricModule);
          } catch (err) {
            clientLogger.error(
              "[EditorCanvas] applyRemoteElementUpdate failed:",
              element.elementId,
              err,
            );
          } finally {
            endProgrammaticApply();
          }
        })();
      },
      // Variante LOCALE de applyRemoteElementUpdate pour les éditions du
      // panneau propriétés : même retire/re-crée via le convertisseur, mais
      // SANS la garde "élément sélectionné = ignoré" (les éléments du panel
      // SONT sélectionnés par construction) et en restaurant la sélection
      // après re-création — y compris les multi-sélections (ActiveSelection).
      applyLocalElementUpdate: (element: Element) => {
        const canvas = fabricRef.current;
        if (!canvas) return;
        void (async () => {
          beginProgrammaticApply();
          suppressSelectionEventsRef.current = true;
          try {
            const fabricModule = await import("fabric");
            const existing = canvas
              .getObjects()
              .find(
                (o) =>
                  (o as FabricObjectWithData).data?.elementId ===
                  element.elementId,
              ) as
              | (FabricObjectWithData & {
                  isEditing?: boolean;
                  exitEditing?: () => void;
                })
              | undefined;

            // Capture la sélection active AVANT le retire/re-crée pour la
            // restaurer à l'identique (mono ou multi-sélection).
            const activeIds = canvas
              .getActiveObjects()
              .map((o) => (o as FabricObjectWithData).data?.elementId)
              .filter((id): id is string => Boolean(id));
            const wasSelected = activeIds.includes(element.elementId);

            if (existing) {
              // Texte en cours d'édition inline : sortir du mode édition
              // SANS forwarder de modification (le panel est la source de
              // cette mise à jour, pas l'IText).
              if (
                existing.isEditing &&
                typeof existing.exitEditing === "function"
              ) {
                originalContentRef.current.delete(element.elementId);
                existing.exitEditing();
              }
              if (wasSelected) canvas.discardActiveObject();
              canvas.remove(existing);
            }
            // Retirer aussi le hit-target apparié (re-créé par le render).
            removeFieldHitTwin(canvas, element.elementId);

            lastKnownBoundsRef.current.set(element.elementId, element.bounds);
            if (element.type === "text") {
              originalContentRef.current.set(
                element.elementId,
                element.content || "",
              );
            }
            await renderElementsOverlay(canvas, [element], fabricModule);

            // Restaurer la sélection sur l'objet re-créé (et les éventuels
            // autres membres d'une multi-sélection, intacts sur le canvas).
            if (wasSelected) {
              const toSelect = activeIds
                .map((id) =>
                  canvas
                    .getObjects()
                    .find(
                      (o) =>
                        (o as FabricObjectWithData).data?.elementId === id,
                    ),
                )
                .filter((o): o is FabricObject => Boolean(o));
              if (toSelect.length === 1) {
                canvas.setActiveObject(toSelect[0]!);
              } else if (toSelect.length > 1) {
                canvas.setActiveObject(
                  new fabricModule.ActiveSelection(toSelect, { canvas }),
                );
              }
            }
            canvas.requestRenderAll();
          } catch (err) {
            clientLogger.error(
              "[EditorCanvas] applyLocalElementUpdate failed:",
              element.elementId,
              err,
            );
          } finally {
            suppressSelectionEventsRef.current = false;
            endProgrammaticApply();
          }
        })();
      },
      applyRemoteElementDelete: (elementId: string) => {
        const canvas = fabricRef.current;
        if (!canvas) return;
        const target = canvas
          .getObjects()
          .find(
            (o) => (o as FabricObjectWithData).data?.elementId === elementId,
          ) as
          | (FabricObjectWithData & {
              isEditing?: boolean;
              exitEditing?: () => void;
            })
          | undefined;
        if (!target) return; // pas rendu sur la page affichée — rien à retirer
        beginProgrammaticApply();
        try {
          // Si le texte supprimé est en cours d'édition locale : sortir du
          // mode édition SANS forwarder de modification. exitEditing()
          // déclenche handleTextEditingExited, qui ne forward que si
          // originalContentRef contient l'ancienne valeur — on la retire
          // AVANT pour que contentChanged === false.
          if (target.isEditing && typeof target.exitEditing === "function") {
            originalContentRef.current.delete(elementId);
            target.exitEditing();
          }
          // Désélectionner si l'objet fait partie de la sélection active,
          // sinon Fabric garde des contrôles orphelins sur un objet retiré.
          const isSelected = canvas
            .getActiveObjects()
            .some(
              (o) => (o as FabricObjectWithData).data?.elementId === elementId,
            );
          if (isSelected) canvas.discardActiveObject();
          canvas.remove(target);
          // Retirer aussi le hit-target plein rect apparié (champ form).
          removeFieldHitTwin(canvas, elementId);
          // Nettoyage des refs de tracking pour cet élément.
          lastKnownBoundsRef.current.delete(elementId);
          originalContentRef.current.delete(elementId);
          recentlyForwardedTextEditRef.current.delete(elementId);
          canvas.requestRenderAll();
        } finally {
          endProgrammaticApply();
        }
      },

      // --- Visibilité / verrouillage des calques (panneau calques) ---
      // Mutations programmatiques pures, même contrat que les applyRemote* :
      // beginProgrammaticApply bloque les callbacks Fabric pendant
      // l'opération → aucun onElementAdded/Modified parasite ne remonte.
      // L'appelant (page.tsx) met à jour le scene graph et déclenche le
      // save lui-même. Au re-render d'une page (loadPage), les états sont
      // ré-appliqués depuis element.visible/element.locked par
      // renderElementsOverlay (baseOptions) — rien à re-faire ici.
      setElementVisibility: (elementId: string, visible: boolean) => {
        const canvas = fabricRef.current;
        if (!canvas) return;
        const target = canvas
          .getObjects()
          .find(
            (o) =>
              (o as FabricObjectWithData).data?.elementId === elementId &&
              (o as FabricObjectWithData).data?.isHideMask !== true,
          ) as
          | (FabricObjectWithData & {
              isEditing?: boolean;
              exitEditing?: () => void;
              locked?: boolean;
            })
          | undefined;
        if (!target) return;
        // Texte en cours d'édition inline : committer l'édition via le flux
        // normal AVANT de masquer (hors garde programmatique, pour que
        // handleTextEditingExited forwarde le changement de contenu).
        if (
          !visible &&
          target.isEditing &&
          typeof target.exitEditing === "function"
        ) {
          target.exitEditing();
        }
        // L'objet reste-t-il sélectionnable une fois visible ? Dépend de son
        // verrou (un élément verrouillé ne redevient pas evented en réaffichant).
        const lockedState =
          (target as FabricObjectWithData).data?.locked === true;
        beginProgrammaticApply();
        const finishVisibilityChange = async () => {
          try {
            if (!visible) {
              // Désélectionner avant de masquer, sinon Fabric garde des
              // contrôles orphelins sur un objet invisible.
              const isSelected = canvas
                .getActiveObjects()
                .some(
                  (o) =>
                    (o as FabricObjectWithData).data?.elementId === elementId,
                );
              if (isSelected) canvas.discardActiveObject();
              // Poser le masque opaque sur le raster PUIS neutraliser l'overlay :
              // invisible + non-evented (sinon un double-clic entrerait encore en
              // édition sur un élément censé être caché).
              await applyHideMask(canvas, target);
              target.set({
                visible: false,
                evented: false,
                selectable: false,
              });
            } else {
              // Réafficher : retirer le masque et restaurer l'interactivité
              // selon l'état de verrou (un élément verrouillé reste non-evented).
              removeHideMask(canvas, elementId);
              target.set({
                visible: true,
                evented: !lockedState,
                selectable: !lockedState,
              });
            }
            // Le hit-target plein rect d'un champ de formulaire suit la
            // visibilité de son contenu (sinon un champ caché reste cliquable).
            const hitTwin = canvas
              .getObjects()
              .find(
                (o) =>
                  (o as FabricObjectWithData).data?.hitForElementId ===
                  elementId,
              );
            if (hitTwin) {
              hitTwin.set({ visible, evented: visible && !lockedState });
            }
            canvas.requestRenderAll();
          } finally {
            endProgrammaticApply();
          }
        };
        void finishVisibilityChange();
      },
      setElementLocked: (elementId: string, locked: boolean) => {
        const canvas = fabricRef.current;
        if (!canvas) return;
        const target = canvas
          .getObjects()
          .find(
            (o) =>
              (o as FabricObjectWithData).data?.elementId === elementId &&
              (o as FabricObjectWithData).data?.isHideMask !== true,
          ) as
          | (FabricObjectWithData & {
              isEditing?: boolean;
              exitEditing?: () => void;
              visible?: boolean;
            })
          | undefined;
        if (!target) return;
        // Committer une édition inline en cours avant de verrouiller
        // (même raison que setElementVisibility).
        if (
          locked &&
          target.isEditing &&
          typeof target.exitEditing === "function"
        ) {
          target.exitEditing();
        }
        // Un élément actuellement masqué reste non-evented quel que soit son
        // verrou : le réafficher (toggle œil) ré-évaluera l'interactivité via
        // data.locked. On ne le rend donc evented ici que s'il est visible.
        const isHidden = target.visible === false;
        beginProgrammaticApply();
        try {
          if (locked) {
            const isSelected = canvas
              .getActiveObjects()
              .some(
                (o) =>
                  (o as FabricObjectWithData).data?.elementId === elementId,
              );
            if (isSelected) canvas.discardActiveObject();
          }
          target.set({
            selectable: !locked,
            evented: !locked && !isHidden,
            hasControls: !locked,
            hasBorders: !locked,
            lockMovementX: locked,
            lockMovementY: locked,
          });
          // Persiste l'état de verrou sur l'objet (lu par setElementVisibility
          // pour décider de l'interactivité au réaffichage).
          (target as FabricObjectWithData).data = {
            ...(target as FabricObjectWithData).data,
            locked,
          };
          canvas.requestRenderAll();
        } finally {
          endProgrammaticApply();
        }
      },
      selectElement: (elementId: string): boolean => {
        const canvas = fabricRef.current;
        if (!canvas) return false;
        const target = canvas
          .getObjects()
          .find(
            (o) =>
              (o as FabricObjectWithData).data?.elementId === elementId &&
              (o as FabricObjectWithData).data?.isHideMask !== true,
          );
        // Élément absent de CETTE page (mode continu : ce handle ne pilote que la
        // page active). On le signale au lieu d'un no-op silencieux pour que
        // l'appelant active la page propriétaire puis re-tente.
        if (!target) return false;
        // Rendre l'objet actif puis forwarder l'id : le setActiveObject
        // programmatique de Fabric ne fire pas selection:created, donc on
        // notifie onSelectionChanged nous-mêmes (même chemin que la souris)
        // pour synchroniser store + panneau propriétés. Un objet verrouillé
        // (selectable=false / hasControls=false) devient bien actif — sans
        // poignées — ce qui suffit à le mettre en évidence.
        canvas.setActiveObject(target);
        canvas.requestRenderAll();
        onSelectionChangedRef.current?.([elementId]);
        return true;
      },
      selectElements: (elementIds: string[]) => {
        const canvas = fabricRef.current;
        if (!canvas) return;
        // Résout chaque id en son objet Fabric (hors masques de masquage).
        // Garde l'ordre des ids fournis et ignore ceux absents de la page.
        const targets = elementIds
          .map((id) =>
            canvas
              .getObjects()
              .find(
                (o) =>
                  (o as FabricObjectWithData).data?.elementId === id &&
                  (o as FabricObjectWithData).data?.isHideMask !== true,
              ),
          )
          .filter((o): o is FabricObject => Boolean(o));
        const foundIds = targets.map(
          (o) => (o as FabricObjectWithData).data!.elementId as string,
        );

        if (targets.length === 0) {
          // Aucun membre rendu sur la page : désélection nette.
          canvas.discardActiveObject();
          canvas.requestRenderAll();
          onSelectionChangedRef.current?.([]);
          return;
        }
        if (targets.length === 1) {
          canvas.setActiveObject(targets[0]!);
          canvas.requestRenderAll();
          onSelectionChangedRef.current?.(foundIds);
          return;
        }
        // Multi-sélection : ActiveSelection (même primitive que la restauration
        // multi de applyLocalElementUpdate). fabric est importé dynamiquement
        // comme dans les autres méthodes du handle. Le setActiveObject
        // programmatique ne fire pas selection:created → on forwarde nous-mêmes.
        void import("fabric").then((fabricModule) => {
          const live = fabricRef.current;
          if (!live) return;
          live.setActiveObject(
            new fabricModule.ActiveSelection(targets, { canvas: live }),
          );
          live.requestRenderAll();
          onSelectionChangedRef.current?.(foundIds);
        });
      },
      getRedactionMarks: () => {
        const canvas = fabricRef.current;
        if (!canvas) return [];
        // Fabric object props (left/top/width/scaleX…) are in SCENE space,
        // independent of the viewport zoom — so they already match the page's
        // PDF-point coordinate system (the canvas is set up scale-pure at
        // page×zoom). Multiply width/height by the live scale to honour any
        // resize the user dragged on the marker.
        return canvas
          .getObjects()
          .filter(
            (o) => (o as FabricObjectWithData).data?.redactionMark === true,
          )
          .map((o) => {
            const left = o.left ?? 0;
            const top = o.top ?? 0;
            const w = (o.width ?? 0) * (o.scaleX ?? 1);
            const h = (o.height ?? 0) * (o.scaleY ?? 1);
            return { x: left, y: top, width: w, height: h };
          });
      },
      clearRedactionMarks: () => {
        const canvas = fabricRef.current;
        if (!canvas) return;
        const marks = canvas
          .getObjects()
          .filter(
            (o) => (o as FabricObjectWithData).data?.redactionMark === true,
          );
        if (marks.length === 0) return;
        // beginProgrammaticApply so the removals don't fire onElementRemoved
        // (markers are not scene-graph elements anyway, but stay consistent
        // with the hide-mask / programmatic-mutation pattern).
        beginProgrammaticApply();
        for (const m of marks) canvas.remove(m);
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        endProgrammaticApply();
        onRedactionMarksChangedRef.current?.(0);
      },
    };

    onCanvasReady(handle);
  }, [historyIndex, historyStack, onCanvasReady, fabricObjectToElement, saveHistory, renderElementsOverlay, beginProgrammaticApply, endProgrammaticApply, applyHideMask, removeHideMask]);

  // Calculer les dimensions du canvas basées sur la page
  const canvasWidth = page?.dimensions?.width || width;
  const canvasHeight = page?.dimensions?.height || height;

  // Conteneur canvas + overlays — IDENTIQUE dans les deux modes (standalone et
  // intégré). En mode intégré il est rendu seul (le slot du défileur est déjà
  // dimensionné à page×zoom) ; en standalone il est enveloppé dans le viewport
  // scrollable ci-dessous.
  const canvasContainer = (
    <div
      ref={containerRef}
      className="canvas-container relative bg-white shadow-lg rounded-sm"
      style={{
        width: canvasWidth * zoom,
        height: canvasHeight * zoom,
        // Tactile : gate le geste par outil. Fabric pose `manipulation` inline
        // sur ses canvases (allowTouchScrolling:true) ; l'intersection avec ce
        // wrapper donne : tracé → none (le doigt dessine, pas de scroll) ;
        // select/hand/… → pan-x pan-y (scroll natif, pinch capté par l'app).
        touchAction: touchActionForTool(tool),
      }}
    >
      {/* Le <canvas> Fabric est créé IMPÉRATIVEMENT et attaché à containerRef
          dans l'effet d'init (voir plus bas). Il n'est PAS rendu en JSX : fabric
          v7 le déplace dans un wrapper `.canvas-container` qu'il injecte lui-même,
          ce que React ignore. Si React gérait le <canvas> (ref JSX), son
          removeChild au démontage échouerait (NotFoundError) car le nœud a été
          déplacé par Fabric. En le créant nous-mêmes, React ne gère que ce div :
          au démontage il retire containerRef en entier (canvas + wrapper Fabric
          inclus) sans removeChild individuel → plus de crash. */}

      {/* Overlay applicatif (ex: surlignage des champs en mode Remplir).
          Positionné dans le repère page×zoom, défile avec la page. */}
      {overlay ? (
        <div className="absolute inset-0 z-10 pointer-events-none">
          {overlay}
        </div>
      ) : null}

      {/* Règles Word-like + marges draggables (single-page uniquement). Montées
          DANS le sheet position:relative — les barres se placent dans la gouttière
          au-dessus/à gauche via bottom:100%/right:100% (le padding du viewport
          standalone fournit la place). En mode `embedded`, la vue continue les
          monte déjà via PageSlot : on ne les rend donc jamais ici pour éviter le
          doublon. Marges draggables si connues + commit fourni, sinon règles
          passives (mêmes composants/flux que la vue continue). */}
      {showRulers && !embedded ? (
        margins != null && onMarginsCommit ? (
          <PageMarginOverlay
            width={canvasWidth * zoom}
            height={canvasHeight * zoom}
            zoom={zoom}
            unit={rulerUnit}
            margins={margins}
            rotation={page?.dimensions?.rotation ?? 0}
            onCommit={onMarginsCommit}
          />
        ) : (
          <PageRulers
            pageWidthPts={canvasWidth}
            pageHeightPts={canvasHeight}
            zoom={zoom}
            unit={rulerUnit}
          />
        )
      ) : null}

      {/* Mini-formulaire de création d'un groupe de boutons radio. */}
      {radioPrompt ? (
        <div
          className="absolute z-20 w-64 rounded-lg border bg-background p-3 shadow-xl"
          style={{
            left: Math.max(0, radioPrompt.x * zoom),
            top: Math.max(0, radioPrompt.y * zoom),
          }}
        >
          <h4 className="text-sm font-medium mb-2">
            {t("radioPrompt.title")}
          </h4>
          <label className="block text-xs text-muted-foreground mb-1">
            {t("radioPrompt.groupName")}
          </label>
          <input
            type="text"
            value={radioGroupName}
            onChange={(e) => setRadioGroupName(e.target.value)}
            className="w-full h-8 px-2 mb-2 rounded border bg-background text-sm"
          />
          <label className="block text-xs text-muted-foreground mb-1">
            {t("radioPrompt.options")}
          </label>
          <textarea
            value={radioOptionsText}
            onChange={(e) => setRadioOptionsText(e.target.value)}
            rows={4}
            className="w-full px-2 py-1 mb-1 rounded border bg-background text-sm resize-y"
          />
          <p className="text-[10px] text-muted-foreground mb-2">
            {t("radioPrompt.optionsHint")}
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setRadioPrompt(null)}
              className="px-2.5 py-1.5 rounded text-xs border hover:bg-muted transition-colors"
            >
              {t("radioPrompt.cancel")}
            </button>
            <button
              type="button"
              onClick={() => {
                void handleConfirmRadioGroup();
              }}
              className="px-2.5 py-1.5 rounded text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              {t("radioPrompt.create")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );

  // Mode intégré : pas de viewport scrollable, pas de centrage, pas de padding.
  // Le slot du défileur continu mesure exactement page×zoom ; on rend donc le
  // conteneur canvas directement (aucun scrollbar imbriqué). `scrollWrapperRef`
  // reste non attaché — toutes les lectures du wrapper sont déjà gardées.
  if (embedded) {
    return canvasContainer;
  }

  return (
    // Viewport scrollable : le contenu interne prend page×zoom (+ padding),
    // les scrollbars natives apparaissent dans les 2 axes dès que la page
    // déborde. PAS de items-center/justify-center ici : avec un contenu en
    // overflow, le centrage flex rend le haut/gauche de page inatteignable
    // au scroll (c'était le bug « impossible de bouger dans la page »).
    <div
      ref={scrollWrapperRef}
      className="editor-canvas-wrapper h-full w-full flex overflow-auto overscroll-contain bg-gray-100 dark:bg-gray-900"
    >
      {/* m-auto : centre la page quand elle est plus petite que le viewport
          (les marges auto se replient à 0 en cas d'overflow → coin haut-
          gauche toujours accessible). Le padding vit ICI pour faire partie
          de la zone scrollable : marge confortable aux 4 bords, même
          zoomé à fond. */}
      <div className="m-auto" style={{ padding: CANVAS_VIEWPORT_PADDING }}>
        {canvasContainer}
      </div>
    </div>
  );
}
