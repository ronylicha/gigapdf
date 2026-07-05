/**
 * PDF Editor Service for GigaPDF
 * Comprehensive editing facade (legacy scaffolding).
 *
 * ── Migration note (2026-07, tech-debt #20) ─────────────────────────────────
 * This service was written against the pre-refactor stateful editing API and
 * targets many REMOVED routes. It is NOT imported by any screen.
 *
 * Route status:
 *   ❌ REMOVED — `/documents/{id}/history/*` (undo/redo/goto), `/forms/*`,
 *      standalone `/documents/{id}/layers/*`, `/text/search|replace|extract`,
 *      `/pages/*`, `/annotations/*`.
 *   ➡️ Current replacements:
 *      • Page ops              → `pagesService` (engine `/api/pdf/pages` + versions)
 *      • Text / annotations / forms / shapes / images → stateless engine
 *        (`/api/pdf/text|annotations|forms|shape|image`) then `saveVersion`
 *      • Document layers       → `/api/v1/storage/documents/{id}/layers` (GET/PUT)
 *      • Element CRUD          → `elementsService` (session document)
 *      • Undo/redo/history     → client-side editor state (no server history API)
 *
 * Retained for reference and incremental migration; do not wire to screens
 * as-is.
 */

import apiClient from './api';
import {
  ElementType,
  AnnotationType,
  FormFieldType,
  PageOperation,
  ToolActionParams,
  ToolResult,
} from '../types/tools';

// ============================================
// TYPES
// ============================================

export interface Position {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextElement {
  type: 'text';
  content: string;
  position: Position;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  alignment?: 'left' | 'center' | 'right';
}

export interface ImageElement {
  type: 'image';
  imageData: string; // Base64
  position: Position;
  size?: Size;
  opacity?: number;
}

export interface ShapeElement {
  type: 'shape';
  shapeType: 'rectangle' | 'circle' | 'line' | 'arrow';
  position: Position;
  size: Size;
  strokeColor?: string;
  fillColor?: string;
  strokeWidth?: number;
}

export interface SignatureElement {
  type: 'signature';
  imageData: string; // Base64 signature image
  position: Position;
  size?: Size;
}

export interface DrawingElement {
  type: 'drawing';
  paths: Array<{ points: Position[]; color: string; width: number }>;
  position: Position;
}

export type Element =
  | TextElement
  | ImageElement
  | ShapeElement
  | SignatureElement
  | DrawingElement;

export interface MarkupAnnotation {
  type: 'highlight' | 'underline' | 'strikethrough';
  quadPoints: number[]; // Coordinates defining the text area
  color?: string;
  opacity?: number;
}

export interface NoteAnnotation {
  type: 'note';
  position: Position;
  content: string;
  author?: string;
  color?: string;
}

export interface LinkAnnotation {
  type: 'link';
  rect: Rectangle;
  url?: string;
  pageNumber?: number;
}

export type Annotation = MarkupAnnotation | NoteAnnotation | LinkAnnotation;

export interface FormField {
  type: FormFieldType;
  name: string;
  rect: Rectangle;
  value?: string;
  options?: string[]; // For dropdown/radio
  required?: boolean;
}

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked?: boolean;
  elements?: string[]; // Element IDs
}

export interface SearchResult {
  pageNumber: number;
  text: string;
  rect: Rectangle;
}

// ============================================
// TEXT OPERATIONS
// ============================================

/**
 * Add text element to a page
 */
export async function addText(
  documentId: string,
  pageNumber: number,
  element: TextElement
): Promise<ToolResult> {
  try {
    const response = await apiClient.post(
      `/documents/${documentId}/pages/${pageNumber}/elements`,
      element
    );
    return {
      success: true,
      data: response.data,
      message: 'Texte ajouté avec succès',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Erreur lors de l\'ajout du texte',
    };
  }
}

/**
 * Search text in document
 */
export async function searchText(
  documentId: string,
  query: string,
  caseSensitive = false
): Promise<ToolResult> {
  try {
    const response = await apiClient.post(
      `/documents/${documentId}/text/search`,
      { query, case_sensitive: caseSensitive }
    );
    return {
      success: true,
      data: response.data as SearchResult[],
      message: `${response.data.length} résultat(s) trouvé(s)`,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Erreur lors de la recherche',
    };
  }
}

/**
 * Replace text in document
 */
export async function replaceText(
  documentId: string,
  searchQuery: string,
  replacement: string,
  replaceAll = false
): Promise<ToolResult> {
  try {
    const response = await apiClient.post(
      `/documents/${documentId}/text/replace`,
      {
        search: searchQuery,
        replace: replacement,
        replace_all: replaceAll,
      }
    );
    return {
      success: true,
      data: response.data,
      message: 'Texte remplacé avec succès',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Erreur lors du remplacement',
    };
  }
}

/**
 * Extract all text from document
 */
export async function extractText(documentId: string): Promise<ToolResult> {
  try {
    const response = await apiClient.get(
      `/documents/${documentId}/text/extract`
    );
    return {
      success: true,
      data: response.data,
      message: 'Texte extrait avec succès',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Erreur lors de l\'extraction du texte',
    };
  }
}

// ============================================
// IMAGE OPERATIONS
// ============================================

/**
 * Add image element to a page
 */
export async function addImage(
  documentId: string,
  pageNumber: number,
  element: ImageElement
): Promise<ToolResult> {
  try {
    const response = await apiClient.post(
      `/documents/${documentId}/pages/${pageNumber}/elements`,
      element
    );
    return {
      success: true,
      data: response.data,
      message: 'Image ajoutée avec succès',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Erreur lors de l\'ajout de l\'image',
    };
  }
}

/**
 * Extract image from a page
 */
export async function extractImage(
  documentId: string,
  pageNumber: number,
  imageXref: string
): Promise<ToolResult> {
  try {
    const response = await apiClient.get(
      `/documents/${documentId}/pages/${pageNumber}/images/${imageXref}`,
      { responseType: 'blob' }
    );
    return {
      success: true,
      data: response.data,
      message: 'Image extraite avec succès',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Erreur lors de l\'extraction de l\'image',
    };
  }
}

// ============================================
// SHAPE & DRAWING OPERATIONS
// ============================================

/**
 * Add shape element to a page
 */
export async function addShape(
  documentId: string,
  pageNumber: number,
  element: ShapeElement
): Promise<ToolResult> {
  try {
    const response = await apiClient.post(
      `/documents/${documentId}/pages/${pageNumber}/elements`,
      element
    );
    return {
      success: true,
      data: response.data,
      message: 'Forme ajoutée avec succès',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Erreur lors de l\'ajout de la forme',
    };
  }
}

/**
 * Add drawing element to a page
 */
export async function addDrawing(
  documentId: string,
  pageNumber: number,
  element: DrawingElement
): Promise<ToolResult> {
  try {
    const response = await apiClient.post(
      `/documents/${documentId}/pages/${pageNumber}/elements`,
      element
    );
    return {
      success: true,
      data: response.data,
      message: 'Dessin ajouté avec succès',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Erreur lors de l\'ajout du dessin',
    };
  }
}

// ============================================
// SIGNATURE OPERATIONS
// ============================================

/**
 * Add signature to a page
 */
export async function addSignature(
  documentId: string,
  pageNumber: number,
  element: SignatureElement
): Promise<ToolResult> {
  try {
    const response = await apiClient.post(
      `/documents/${documentId}/pages/${pageNumber}/elements`,
      element
    );
    return {
      success: true,
      data: response.data,
      message: 'Signature ajoutée avec succès',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Erreur lors de l\'ajout de la signature',
    };
  }
}

// ============================================
// PAGE OPERATIONS
// ============================================

/**
 * Rotate a page
 */
export async function rotatePage(
  documentId: string,
  pageNumber: number,
  angle: 90 | 180 | 270
): Promise<ToolResult> {
  try {
    const response = await apiClient.put(
      `/documents/${documentId}/pages/${pageNumber}/rotate`,
      { angle }
    );
    return {
      success: true,
      data: response.data,
      message: `Page pivotée de ${angle}°`,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Erreur lors de la rotation',
    };
  }
}

/**
 * Reorder pages
 */
export async function reorderPages(
  documentId: string,
  newOrder: number[]
): Promise<ToolResult> {
  try {
    const response = await apiClient.put(
      `/documents/${documentId}/pages/reorder`,
      { page_order: newOrder }
    );
    return {
      success: true,
      data: response.data,
      message: 'Pages réorganisées avec succès',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Erreur lors de la réorganisation',
    };
  }
}

/**
 * Extract pages to new document
 */
export async function extractPages(
  documentId: string,
  pageNumbers: number[]
): Promise<ToolResult> {
  try {
    const response = await apiClient.post(
      `/documents/${documentId}/pages/extract`,
      { pages: pageNumbers }
    );
    return {
      success: true,
      data: response.data,
      message: `${pageNumbers.length} page(s) extraite(s)`,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Erreur lors de l\'extraction des pages',
    };
  }
}

/**
 * Delete a page
 */
export async function deletePage(
  documentId: string,
  pageNumber: number
): Promise<ToolResult> {
  try {
    const response = await apiClient.delete(
      `/documents/${documentId}/pages/${pageNumber}`
    );
    return {
      success: true,
      data: response.data,
      message: 'Page supprimée avec succès',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Erreur lors de la suppression',
    };
  }
}

/**
 * Resize a page
 */
export async function resizePage(
  documentId: string,
  pageNumber: number,
  size: { width: number; height: number } | 'A4' | 'Letter' | 'Legal'
): Promise<ToolResult> {
  try {
    const response = await apiClient.put(
      `/documents/${documentId}/pages/${pageNumber}/resize`,
      typeof size === 'string' ? { preset: size } : size
    );
    return {
      success: true,
      data: response.data,
      message: 'Page redimensionnée avec succès',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Erreur lors du redimensionnement',
    };
  }
}

/**
 * Get page preview
 */
export async function getPagePreview(
  documentId: string,
  pageNumber: number,
  width?: number
): Promise<ToolResult> {
  try {
    const params = width ? { width } : {};
    const response = await apiClient.get(
      `/documents/${documentId}/pages/${pageNumber}/preview`,
      { params, responseType: 'blob' }
    );
    return {
      success: true,
      data: response.data,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Erreur lors de la génération de l\'aperçu',
    };
  }
}

// ============================================
// ANNOTATION OPERATIONS
// ============================================

/**
 * Add markup annotation (highlight, underline, strikethrough)
 */
export async function addMarkup(
  documentId: string,
  pageNumber: number,
  annotation: MarkupAnnotation
): Promise<ToolResult> {
  try {
    const response = await apiClient.post(
      `/documents/${documentId}/pages/${pageNumber}/annotations/markup`,
      annotation
    );
    return {
      success: true,
      data: response.data,
      message: 'Annotation ajoutée avec succès',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Erreur lors de l\'ajout de l\'annotation',
    };
  }
}

/**
 * Add note annotation
 */
export async function addNote(
  documentId: string,
  pageNumber: number,
  annotation: NoteAnnotation
): Promise<ToolResult> {
  try {
    const response = await apiClient.post(
      `/documents/${documentId}/pages/${pageNumber}/annotations/note`,
      annotation
    );
    return {
      success: true,
      data: response.data,
      message: 'Note ajoutée avec succès',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Erreur lors de l\'ajout de la note',
    };
  }
}

/**
 * Add link annotation
 */
export async function addLink(
  documentId: string,
  pageNumber: number,
  annotation: LinkAnnotation
): Promise<ToolResult> {
  try {
    const response = await apiClient.post(
      `/documents/${documentId}/pages/${pageNumber}/annotations/link`,
      annotation
    );
    return {
      success: true,
      data: response.data,
      message: 'Lien ajouté avec succès',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Erreur lors de l\'ajout du lien',
    };
  }
}

// ============================================
// FORM OPERATIONS
// ============================================

/**
 * Get form fields
 */
export async function getFormFields(documentId: string): Promise<ToolResult> {
  try {
    const response = await apiClient.get(
      `/documents/${documentId}/forms/fields`
    );
    return {
      success: true,
      data: response.data,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Erreur lors de la récupération des champs',
    };
  }
}

/**
 * Fill form fields
 */
export async function fillForm(
  documentId: string,
  fields: Record<string, string>
): Promise<ToolResult> {
  try {
    const response = await apiClient.put(
      `/documents/${documentId}/forms/fill`,
      { fields }
    );
    return {
      success: true,
      data: response.data,
      message: 'Formulaire rempli avec succès',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Erreur lors du remplissage du formulaire',
    };
  }
}

/**
 * Create form field
 */
export async function createFormField(
  documentId: string,
  pageNumber: number,
  field: FormField
): Promise<ToolResult> {
  try {
    const response = await apiClient.post(
      `/documents/${documentId}/pages/${pageNumber}/forms/fields`,
      field
    );
    return {
      success: true,
      data: response.data,
      message: 'Champ créé avec succès',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Erreur lors de la création du champ',
    };
  }
}

/**
 * Flatten form (convert to static content)
 */
export async function flattenForm(documentId: string): Promise<ToolResult> {
  try {
    const response = await apiClient.post(
      `/documents/${documentId}/forms/flatten`
    );
    return {
      success: true,
      data: response.data,
      message: 'Formulaire aplati avec succès',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Erreur lors de l\'aplatissement du formulaire',
    };
  }
}

// ============================================
// LAYER OPERATIONS
// ============================================

/**
 * Get document layers
 */
export async function getLayers(documentId: string): Promise<ToolResult> {
  try {
    const response = await apiClient.get(`/documents/${documentId}/layers`);
    return {
      success: true,
      data: response.data,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Erreur lors de la récupération des calques',
    };
  }
}

/**
 * Create layer
 */
export async function createLayer(
  documentId: string,
  name: string
): Promise<ToolResult> {
  try {
    const response = await apiClient.post(`/documents/${documentId}/layers`, {
      name,
    });
    return {
      success: true,
      data: response.data,
      message: 'Calque créé avec succès',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Erreur lors de la création du calque',
    };
  }
}

/**
 * Update layer
 */
export async function updateLayer(
  documentId: string,
  layerId: string,
  updates: Partial<Layer>
): Promise<ToolResult> {
  try {
    const response = await apiClient.patch(
      `/documents/${documentId}/layers/${layerId}`,
      updates
    );
    return {
      success: true,
      data: response.data,
      message: 'Calque mis à jour',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Erreur lors de la mise à jour du calque',
    };
  }
}

/**
 * Delete layer
 */
export async function deleteLayer(
  documentId: string,
  layerId: string
): Promise<ToolResult> {
  try {
    const response = await apiClient.delete(
      `/documents/${documentId}/layers/${layerId}`
    );
    return {
      success: true,
      data: response.data,
      message: 'Calque supprimé',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Erreur lors de la suppression du calque',
    };
  }
}

/**
 * Reorder layers
 */
export async function reorderLayers(
  documentId: string,
  layerOrder: string[]
): Promise<ToolResult> {
  try {
    const response = await apiClient.put(
      `/documents/${documentId}/layers/reorder`,
      { layer_order: layerOrder }
    );
    return {
      success: true,
      data: response.data,
      message: 'Calques réorganisés',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Erreur lors de la réorganisation des calques',
    };
  }
}

// ============================================
// ELEMENT OPERATIONS
// ============================================

/**
 * Get page elements
 */
export async function getPageElements(
  documentId: string,
  pageNumber: number
): Promise<ToolResult> {
  try {
    const response = await apiClient.get(
      `/documents/${documentId}/pages/${pageNumber}/elements`
    );
    return {
      success: true,
      data: response.data,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Erreur lors de la récupération des éléments',
    };
  }
}

/**
 * Update element
 */
export async function updateElement(
  documentId: string,
  elementId: string,
  updates: Partial<Element>
): Promise<ToolResult> {
  try {
    const response = await apiClient.patch(
      `/documents/${documentId}/elements/${elementId}`,
      updates
    );
    return {
      success: true,
      data: response.data,
      message: 'Élément mis à jour',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Erreur lors de la mise à jour de l\'élément',
    };
  }
}

/**
 * Delete element
 */
export async function deleteElement(
  documentId: string,
  elementId: string
): Promise<ToolResult> {
  try {
    const response = await apiClient.delete(
      `/documents/${documentId}/elements/${elementId}`
    );
    return {
      success: true,
      data: response.data,
      message: 'Élément supprimé',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Erreur lors de la suppression de l\'élément',
    };
  }
}

/**
 * Move element to another page
 */
export async function moveElement(
  documentId: string,
  elementId: string,
  targetPage: number,
  position?: Position
): Promise<ToolResult> {
  try {
    const response = await apiClient.put(
      `/documents/${documentId}/elements/${elementId}/move`,
      { target_page: targetPage, position }
    );
    return {
      success: true,
      data: response.data,
      message: 'Élément déplacé',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Erreur lors du déplacement de l\'élément',
    };
  }
}

/**
 * Duplicate element
 */
export async function duplicateElement(
  documentId: string,
  elementId: string,
  targetPage?: number
): Promise<ToolResult> {
  try {
    const response = await apiClient.post(
      `/documents/${documentId}/elements/${elementId}/duplicate`,
      { target_page: targetPage }
    );
    return {
      success: true,
      data: response.data,
      message: 'Élément dupliqué',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Erreur lors de la duplication de l\'élément',
    };
  }
}

// ============================================
// HISTORY OPERATIONS
// ============================================

/**
 * Get document history
 */
export async function getHistory(documentId: string): Promise<ToolResult> {
  try {
    const response = await apiClient.get(`/documents/${documentId}/history`);
    return {
      success: true,
      data: response.data,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Erreur lors de la récupération de l\'historique',
    };
  }
}

/**
 * Undo last operations
 */
export async function undo(
  documentId: string,
  steps = 1
): Promise<ToolResult> {
  try {
    const response = await apiClient.post(
      `/documents/${documentId}/history/undo`,
      { steps }
    );
    return {
      success: true,
      data: response.data,
      message: `${steps} opération(s) annulée(s)`,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Erreur lors de l\'annulation',
    };
  }
}

/**
 * Redo operations
 */
export async function redo(
  documentId: string,
  steps = 1
): Promise<ToolResult> {
  try {
    const response = await apiClient.post(
      `/documents/${documentId}/history/redo`,
      { steps }
    );
    return {
      success: true,
      data: response.data,
      message: `${steps} opération(s) refaite(s)`,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Erreur lors de la restauration',
    };
  }
}

/**
 * Go to specific history state
 */
export async function goToHistoryState(
  documentId: string,
  stateId: string
): Promise<ToolResult> {
  try {
    const response = await apiClient.post(
      `/documents/${documentId}/history/goto`,
      { state_id: stateId }
    );
    return {
      success: true,
      data: response.data,
      message: 'État restauré',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Erreur lors de la restauration de l\'état',
    };
  }
}

// ============================================
// SECURITY OPERATIONS
// ============================================

/**
 * Unlock password-protected PDF
 */
export async function unlockPdf(
  documentId: string,
  password: string
): Promise<ToolResult> {
  try {
    const response = await apiClient.post(
      `/documents/${documentId}/unlock`,
      { password }
    );
    return {
      success: true,
      data: response.data,
      message: 'Document déverrouillé avec succès',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Mot de passe incorrect ou erreur de déverrouillage',
    };
  }
}

// ============================================
// EXPORT
// ============================================

export default {
  // Text
  addText,
  searchText,
  replaceText,
  extractText,
  // Images
  addImage,
  extractImage,
  // Shapes & Drawing
  addShape,
  addDrawing,
  // Signature
  addSignature,
  // Pages
  rotatePage,
  reorderPages,
  extractPages,
  deletePage,
  resizePage,
  getPagePreview,
  // Annotations
  addMarkup,
  addNote,
  addLink,
  // Forms
  getFormFields,
  fillForm,
  createFormField,
  flattenForm,
  // Layers
  getLayers,
  createLayer,
  updateLayer,
  deleteLayer,
  reorderLayers,
  // Elements
  getPageElements,
  updateElement,
  deleteElement,
  moveElement,
  duplicateElement,
  // History
  getHistory,
  undo,
  redo,
  goToHistoryState,
  // Security
  unlockPdf,
};
