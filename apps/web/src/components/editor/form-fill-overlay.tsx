"use client";

/** Rect d'un widget de champ à surligner en mode Remplir (1 entrée PAR widget). */
export interface FormFillHighlight {
  fieldName: string;
  /** Page 1-indexée du widget. */
  pageNumber: number;
  /** Bounds du widget en points PDF (repère page, origine haut-gauche). */
  bounds: { x: number; y: number; width: number; height: number };
}

export interface FormFillOverlayProps {
  /**
   * Widgets à surligner — issus du SCENE GRAPH (1 élément form_field PAR
   * widget, pages dupliquées et paires Oui/non incluses), pas du `getFormFields`
   * de l'API qui ne remonte que le premier widget de chaque champ.
   */
  fields: FormFillHighlight[];
  /** Index 0-based de la page affichée. */
  currentPageIndex: number;
  /** Zoom courant — les bounds sont en points PDF, l'overlay en pixels écran. */
  zoom: number;
  /** Champ actuellement ciblé (synchronisé avec le FormsPanel). */
  focusedFieldName: string | null;
}

/**
 * Surlignage PUREMENT VISUEL des champs de formulaire du PDF (mode Remplir).
 * Rendu via la prop `overlay` d'EditorCanvas, donc positionné dans le repère
 * page×zoom et défilant avec la page. `pointer-events: none` sur CHAQUE rect :
 * les clics traversent vers le canvas Fabric, où le hit-target plein rect du
 * champ place le curseur / coche la case directement (UX Adobe) — l'ancien
 * overlay à <button> volait les clics et ne faisait que focuser le panneau.
 * Le focus du panneau suit désormais la sélection canvas (page.tsx).
 */
export function FormFillOverlay({
  fields,
  currentPageIndex,
  zoom,
  focusedFieldName,
}: FormFillOverlayProps) {
  const pageFields = fields.filter(
    (field) => (field.pageNumber ?? 1) - 1 === currentPageIndex,
  );

  if (pageFields.length === 0) return null;

  return (
    <>
      {pageFields.map((field, index) => {
        const isFocused = focusedFieldName === field.fieldName;
        return (
          <div
            key={`${field.fieldName}-${index}-${field.bounds.x}-${field.bounds.y}`}
            aria-hidden="true"
            // pointer-events-none : le conteneur overlay d'EditorCanvas est
            // déjà pointer-events-none ; on le réaffirme par rect pour que le
            // surlignage ne vole JAMAIS un clic au canvas.
            className={`absolute pointer-events-none rounded-sm border-2 transition-colors ${
              isFocused
                ? "border-primary bg-primary/20"
                : "border-blue-400/50 bg-blue-300/10"
            }`}
            style={{
              left: field.bounds.x * zoom,
              top: field.bounds.y * zoom,
              width: Math.max(6, field.bounds.width * zoom),
              height: Math.max(6, field.bounds.height * zoom),
            }}
          />
        );
      })}
    </>
  );
}
