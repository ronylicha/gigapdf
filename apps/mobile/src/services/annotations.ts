/**
 * Annotations Service
 * Markup / notes / links / highlights.
 *
 * ── Migration note (2026-07, tech-debt #20) ─────────────────────────────────
 * The FastAPI annotation routes (`/api/v1/documents/{id}/.../annotations/*`)
 * were REMOVED (2026-06-13). Every method in this service therefore targets a
 * DEAD route and is not imported by any screen.
 *
 * Current replacement: the stateless PDF engine `POST /api/pdf/annotations`
 * (multipart PDF in → PDF out), then persist via
 * `storageService.saveVersion(storedDocumentId, ...)`. On-device, in-canvas
 * markup is handled locally by `useAnnotations` + `AnnotationOverlay`.
 *
 * This file is retained for reference and future migration; do not wire it to
 * screens as-is.
 */

import { apiClient } from './api';
import {
  ApiResponse,
  Annotation,
  CreateMarkupAnnotationData,
  CreateNoteAnnotationData,
  CreateLinkAnnotationData,
  AnnotationType,
} from './types';

// ============================================================================
// Annotations Service
// ============================================================================

export const annotationsService = {
  /**
   * Get all annotations on a page
   * @param documentId - Document ID
   * @param pageNumber - Page number (1-based)
   * @returns Array of annotations
   */
  async list(documentId: string, pageNumber: number): Promise<Annotation[]> {
    const response = await apiClient.get<Annotation[]>(
      `/documents/${documentId}/pages/${pageNumber}/annotations`
    );
    return response.data!;
  },

  /**
   * Get all annotations in a document
   * @param documentId - Document ID
   * @returns Array of all annotations
   */
  async listAll(documentId: string): Promise<Annotation[]> {
    const response = await apiClient.get<Annotation[]>(
      `/documents/${documentId}/annotations`
    );
    return response.data!;
  },

  /**
   * Get single annotation by ID
   * @param documentId - Document ID
   * @param annotationId - Annotation ID
   * @returns Annotation details
   */
  async get(documentId: string, annotationId: string): Promise<Annotation> {
    const response = await apiClient.get<Annotation>(
      `/documents/${documentId}/annotations/${annotationId}`
    );
    return response.data!;
  },

  /**
   * Create markup annotation (highlight, underline, strikeout)
   * @param documentId - Document ID
   * @param pageNumber - Page number (1-based)
   * @param data - Markup annotation data
   * @returns Created annotation
   */
  async createMarkup(
    documentId: string,
    pageNumber: number,
    data: CreateMarkupAnnotationData
  ): Promise<Annotation> {
    const response = await apiClient.post<Annotation>(
      `/documents/${documentId}/pages/${pageNumber}/annotations/markup`,
      data
    );
    return response.data!;
  },

  /**
   * Create highlight annotation
   * @param documentId - Document ID
   * @param pageNumber - Page number (1-based)
   * @param data - Highlight data
   * @returns Created annotation
   */
  async createHighlight(
    documentId: string,
    pageNumber: number,
    data: CreateMarkupAnnotationData
  ): Promise<Annotation> {
    const response = await apiClient.post<Annotation>(
      `/documents/${documentId}/pages/${pageNumber}/annotations/highlight`,
      data
    );
    return response.data!;
  },

  /**
   * Create underline annotation
   * @param documentId - Document ID
   * @param pageNumber - Page number (1-based)
   * @param data - Underline data
   * @returns Created annotation
   */
  async createUnderline(
    documentId: string,
    pageNumber: number,
    data: CreateMarkupAnnotationData
  ): Promise<Annotation> {
    const response = await apiClient.post<Annotation>(
      `/documents/${documentId}/pages/${pageNumber}/annotations/underline`,
      data
    );
    return response.data!;
  },

  /**
   * Create strikeout annotation
   * @param documentId - Document ID
   * @param pageNumber - Page number (1-based)
   * @param data - Strikeout data
   * @returns Created annotation
   */
  async createStrikeout(
    documentId: string,
    pageNumber: number,
    data: CreateMarkupAnnotationData
  ): Promise<Annotation> {
    const response = await apiClient.post<Annotation>(
      `/documents/${documentId}/pages/${pageNumber}/annotations/strikeout`,
      data
    );
    return response.data!;
  },

  /**
   * Create note annotation
   * @param documentId - Document ID
   * @param pageNumber - Page number (1-based)
   * @param data - Note annotation data
   * @returns Created annotation
   */
  async createNote(
    documentId: string,
    pageNumber: number,
    data: CreateNoteAnnotationData
  ): Promise<Annotation> {
    const response = await apiClient.post<Annotation>(
      `/documents/${documentId}/pages/${pageNumber}/annotations/note`,
      data
    );
    return response.data!;
  },

  /**
   * Create comment annotation (alias for note)
   * @param documentId - Document ID
   * @param pageNumber - Page number (1-based)
   * @param data - Comment data
   * @returns Created annotation
   */
  async createComment(
    documentId: string,
    pageNumber: number,
    data: CreateNoteAnnotationData
  ): Promise<Annotation> {
    return this.createNote(documentId, pageNumber, data);
  },

  /**
   * Create link annotation
   * @param documentId - Document ID
   * @param pageNumber - Page number (1-based)
   * @param data - Link annotation data
   * @returns Created annotation
   */
  async createLink(
    documentId: string,
    pageNumber: number,
    data: CreateLinkAnnotationData
  ): Promise<Annotation> {
    const response = await apiClient.post<Annotation>(
      `/documents/${documentId}/pages/${pageNumber}/annotations/link`,
      data
    );
    return response.data!;
  },

  /**
   * Update annotation
   * @param documentId - Document ID
   * @param annotationId - Annotation ID
   * @param data - Updated annotation data
   * @returns Updated annotation
   */
  async update(
    documentId: string,
    annotationId: string,
    data: Partial<Annotation>
  ): Promise<Annotation> {
    const response = await apiClient.patch<Annotation>(
      `/documents/${documentId}/annotations/${annotationId}`,
      data
    );
    return response.data!;
  },

  /**
   * Delete annotation
   * @param documentId - Document ID
   * @param annotationId - Annotation ID
   */
  async delete(documentId: string, annotationId: string): Promise<void> {
    await apiClient.delete(`/documents/${documentId}/annotations/${annotationId}`);
  },

  /**
   * Delete multiple annotations
   * @param documentId - Document ID
   * @param annotationIds - Array of annotation IDs
   */
  async deleteMultiple(documentId: string, annotationIds: string[]): Promise<void> {
    await apiClient.post(`/documents/${documentId}/annotations/delete-multiple`, {
      annotation_ids: annotationIds,
    });
  },

  /**
   * Delete all annotations on a page
   * @param documentId - Document ID
   * @param pageNumber - Page number (1-based)
   */
  async deleteByPage(documentId: string, pageNumber: number): Promise<void> {
    await apiClient.delete(
      `/documents/${documentId}/pages/${pageNumber}/annotations/all`
    );
  },

  /**
   * Delete all annotations in document
   * @param documentId - Document ID
   */
  async deleteAll(documentId: string): Promise<void> {
    await apiClient.delete(`/documents/${documentId}/annotations/all`);
  },

  /**
   * Update note content
   * @param documentId - Document ID
   * @param annotationId - Annotation ID
   * @param content - New content
   * @returns Updated annotation
   */
  async updateNoteContent(
    documentId: string,
    annotationId: string,
    content: string
  ): Promise<Annotation> {
    const response = await apiClient.patch<Annotation>(
      `/documents/${documentId}/annotations/${annotationId}`,
      { content }
    );
    return response.data!;
  },

  /**
   * Update annotation color
   * @param documentId - Document ID
   * @param annotationId - Annotation ID
   * @param color - New color (hex format)
   * @returns Updated annotation
   */
  async updateColor(
    documentId: string,
    annotationId: string,
    color: string
  ): Promise<Annotation> {
    const response = await apiClient.patch<Annotation>(
      `/documents/${documentId}/annotations/${annotationId}`,
      { color }
    );
    return response.data!;
  },

  /**
   * Update annotation opacity
   * @param documentId - Document ID
   * @param annotationId - Annotation ID
   * @param opacity - Opacity value (0-1)
   * @returns Updated annotation
   */
  async updateOpacity(
    documentId: string,
    annotationId: string,
    opacity: number
  ): Promise<Annotation> {
    const response = await apiClient.patch<Annotation>(
      `/documents/${documentId}/annotations/${annotationId}`,
      { opacity }
    );
    return response.data!;
  },

  /**
   * Move annotation to different page
   * @param documentId - Document ID
   * @param annotationId - Annotation ID
   * @param targetPageNumber - Target page number
   * @returns Updated annotation
   */
  async moveToPage(
    documentId: string,
    annotationId: string,
    targetPageNumber: number
  ): Promise<Annotation> {
    const response = await apiClient.post<Annotation>(
      `/documents/${documentId}/annotations/${annotationId}/move`,
      {
        page_number: targetPageNumber,
      }
    );
    return response.data!;
  },

  /**
   * Duplicate annotation
   * @param documentId - Document ID
   * @param annotationId - Annotation ID
   * @param offset - Optional offset for duplicated annotation
   * @returns Duplicated annotation
   */
  async duplicate(
    documentId: string,
    annotationId: string,
    offset?: { x: number; y: number }
  ): Promise<Annotation> {
    const response = await apiClient.post<Annotation>(
      `/documents/${documentId}/annotations/${annotationId}/duplicate`,
      { offset }
    );
    return response.data!;
  },

  /**
   * Get annotations by type
   * @param documentId - Document ID
   * @param type - Annotation type
   * @returns Array of annotations of specified type
   */
  async getByType(documentId: string, type: AnnotationType): Promise<Annotation[]> {
    const response = await apiClient.get<Annotation[]>(
      `/documents/${documentId}/annotations`,
      {
        params: { type },
      }
    );
    return response.data!;
  },

  /**
   * Get annotations by user
   * @param documentId - Document ID
   * @param userId - User ID
   * @returns Array of annotations created by user
   */
  async getByUser(documentId: string, userId: string): Promise<Annotation[]> {
    const response = await apiClient.get<Annotation[]>(
      `/documents/${documentId}/annotations`,
      {
        params: { user_id: userId },
      }
    );
    return response.data!;
  },

  /**
   * Search annotations by content
   * @param documentId - Document ID
   * @param query - Search query
   * @returns Array of matching annotations
   */
  async search(documentId: string, query: string): Promise<Annotation[]> {
    const response = await apiClient.get<Annotation[]>(
      `/documents/${documentId}/annotations/search`,
      {
        params: { q: query },
      }
    );
    return response.data!;
  },

  /**
   * Export annotations to format
   * @param documentId - Document ID
   * @param format - Export format (json, xml, fdf)
   * @returns Export data or download URL
   */
  async export(
    documentId: string,
    format: 'json' | 'xml' | 'fdf' = 'json'
  ): Promise<any> {
    const response = await apiClient.get<any>(
      `/documents/${documentId}/annotations/export`,
      {
        params: { format },
      }
    );
    return response.data!;
  },

  /**
   * Import annotations from file
   * @param documentId - Document ID
   * @param file - Annotations file
   * @param format - File format (json, xml, fdf)
   * @returns Imported annotations
   */
  async import(
    documentId: string,
    file: any,
    format: 'json' | 'xml' | 'fdf' = 'json'
  ): Promise<Annotation[]> {
    const formData = new FormData();

    const fileUri = file.uri || file;
    const fileName = file.name || file.fileName || `annotations.${format}`;
    const fileType = file.type || file.mimeType || 'application/json';

    formData.append('file', {
      uri: fileUri,
      name: fileName,
      type: fileType,
    } as any);

    formData.append('format', format);

    const response = await apiClient.uploadFile<Annotation[]>(
      `/documents/${documentId}/annotations/import`,
      formData
    );

    return response.data!;
  },

  /**
   * Add reply to annotation
   * @param documentId - Document ID
   * @param annotationId - Parent annotation ID
   * @param content - Reply content
   * @returns Created reply annotation
   */
  async addReply(
    documentId: string,
    annotationId: string,
    content: string
  ): Promise<Annotation> {
    const response = await apiClient.post<Annotation>(
      `/documents/${documentId}/annotations/${annotationId}/replies`,
      { content }
    );
    return response.data!;
  },

  /**
   * Get replies to annotation
   * @param documentId - Document ID
   * @param annotationId - Parent annotation ID
   * @returns Array of reply annotations
   */
  async getReplies(documentId: string, annotationId: string): Promise<Annotation[]> {
    const response = await apiClient.get<Annotation[]>(
      `/documents/${documentId}/annotations/${annotationId}/replies`
    );
    return response.data!;
  },

  /**
   * Mark annotation as resolved
   * @param documentId - Document ID
   * @param annotationId - Annotation ID
   * @returns Updated annotation
   */
  async markAsResolved(documentId: string, annotationId: string): Promise<Annotation> {
    const response = await apiClient.post<Annotation>(
      `/documents/${documentId}/annotations/${annotationId}/resolve`
    );
    return response.data!;
  },

  /**
   * Mark annotation as unresolved
   * @param documentId - Document ID
   * @param annotationId - Annotation ID
   * @returns Updated annotation
   */
  async markAsUnresolved(documentId: string, annotationId: string): Promise<Annotation> {
    const response = await apiClient.post<Annotation>(
      `/documents/${documentId}/annotations/${annotationId}/unresolve`
    );
    return response.data!;
  },

  /**
   * Get annotation statistics for document
   * @param documentId - Document ID
   * @returns Statistics object
   */
  async getStatistics(documentId: string): Promise<{
    total: number;
    by_type: Record<string, number>;
    by_user: Record<string, number>;
    by_page: Record<number, number>;
  }> {
    const response = await apiClient.get<{
      total: number;
      by_type: Record<string, number>;
      by_user: Record<string, number>;
      by_page: Record<number, number>;
    }>(`/documents/${documentId}/annotations/statistics`);
    return response.data!;
  },

  /**
   * Flatten annotations (make them permanent part of PDF)
   * @param documentId - Document ID
   * @returns Updated document
   */
  async flatten(documentId: string): Promise<any> {
    const response = await apiClient.post<any>(
      `/documents/${documentId}/annotations/flatten`
    );
    return response.data!;
  },

  /**
   * Create annotation from selected text
   * @param documentId - Document ID
   * @param pageNumber - Page number
   * @param selectedText - Selected text
   * @param annotationType - Type of annotation to create
   * @param additionalData - Additional annotation data
   * @returns Created annotation
   */
  async createFromSelection(
    documentId: string,
    pageNumber: number,
    selectedText: string,
    annotationType: 'highlight' | 'underline' | 'strikeout' | 'note',
    additionalData?: Record<string, any>
  ): Promise<Annotation> {
    const response = await apiClient.post<Annotation>(
      `/documents/${documentId}/pages/${pageNumber}/annotations/from-selection`,
      {
        selected_text: selectedText,
        annotation_type: annotationType,
        ...additionalData,
      }
    );
    return response.data!;
  },

  /**
   * Batch update annotations
   * @param documentId - Document ID
   * @param updates - Array of annotation updates
   * @returns Updated annotations
   */
  async batchUpdate(
    documentId: string,
    updates: Array<{ id: string; data: Partial<Annotation> }>
  ): Promise<Annotation[]> {
    const response = await apiClient.post<Annotation[]>(
      `/documents/${documentId}/annotations/batch-update`,
      { updates }
    );
    return response.data!;
  },
};

export default annotationsService;
