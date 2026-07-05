/**
 * Elements Service
 * Scene-graph element operations on a SESSION document.
 *
 * ── Migration note (2026-07, tech-debt #20) ─────────────────────────────────
 * Elements live in the editing session (Redis scene graph). The `documentId`
 * here must be a SESSION document id (from `storageService.loadSession`), NOT a
 * stored-document id. This service is not imported by any screen.
 *
 * Current route status (FastAPI `/api/v1/documents/{id}/...`):
 *   ✅ Live: `list`, `create` (`/pages/{n}/elements`), `get`, `update`,
 *            `delete`, `move`, `duplicate`, batch (`/elements/batch`).
 *   ❌ REMOVED (no current endpoint) — `deleteMultiple`, `bringToFront`,
 *      `sendToBack`, `bringForward`, `sendBackward`, `group`, `ungroup`,
 *      `align`, `distribute`, `flip`, `copyStyle`, `replaceImage`, `toggle`…
 *      Z-order / grouping / alignment are client-side scene-graph concerns in
 *      the current web editor and have no mobile REST equivalent.
 */

import { apiClient, createFormData } from './api';
import {
  ApiResponse,
  Element,
  CreateElementData,
  UpdateElementData,
  ElementType,
} from './types';

// ============================================================================
// Elements Service
// ============================================================================

export const elementsService = {
  /**
   * Get all elements on a page
   * @param documentId - Document ID
   * @param pageNumber - Page number (1-based)
   * @returns Array of elements
   */
  async list(documentId: string, pageNumber: number): Promise<Element[]> {
    const response = await apiClient.get<Element[]>(
      `/documents/${documentId}/pages/${pageNumber}/elements`
    );
    return response.data!;
  },

  /**
   * Get single element by ID
   * @param documentId - Document ID
   * @param elementId - Element ID
   * @returns Element details
   */
  async get(documentId: string, elementId: string): Promise<Element> {
    const response = await apiClient.get<Element>(
      `/documents/${documentId}/elements/${elementId}`
    );
    return response.data!;
  },

  /**
   * Create new element on page
   * @param documentId - Document ID
   * @param pageNumber - Page number (1-based)
   * @param data - Element data
   * @param onProgress - Upload progress for image/signature elements
   * @returns Created element
   */
  async create(
    documentId: string,
    pageNumber: number,
    data: CreateElementData,
    onProgress?: (progress: number) => void
  ): Promise<Element> {
    // Check if element requires file upload (image, signature)
    const requiresUpload = data.type === ElementType.IMAGE ||
                          data.type === ElementType.SIGNATURE;

    if (requiresUpload && (data.image || data.signature_data)) {
      const formData = new FormData();

      // Add all non-file fields
      Object.keys(data).forEach((key) => {
        if (key !== 'image' && data[key] !== undefined) {
          if (typeof data[key] === 'object' && !(data[key] instanceof File || data[key] instanceof Blob)) {
            formData.append(key, JSON.stringify(data[key]));
          } else {
            formData.append(key, data[key]);
          }
        }
      });

      // Add file if present
      if (data.image) {
        const fileUri = data.image.uri || data.image;
        const fileName = data.image.name || data.image.fileName || 'image.png';
        const fileType = data.image.type || data.image.mimeType || 'image/png';

        formData.append('image', {
          uri: fileUri,
          name: fileName,
          type: fileType,
        } as any);
      }

      const response = await apiClient.uploadFile<Element>(
        `/documents/${documentId}/pages/${pageNumber}/elements`,
        formData,
        onProgress
      );

      return response.data!;
    } else {
      // Regular JSON POST for non-upload elements
      const response = await apiClient.post<Element>(
        `/documents/${documentId}/pages/${pageNumber}/elements`,
        data
      );
      return response.data!;
    }
  },

  /**
   * Update element
   * @param documentId - Document ID
   * @param elementId - Element ID
   * @param data - Updated element data
   * @returns Updated element
   */
  async update(
    documentId: string,
    elementId: string,
    data: UpdateElementData
  ): Promise<Element> {
    const response = await apiClient.patch<Element>(
      `/documents/${documentId}/elements/${elementId}`,
      data
    );
    return response.data!;
  },

  /**
   * Delete element
   * @param documentId - Document ID
   * @param elementId - Element ID
   */
  async delete(documentId: string, elementId: string): Promise<void> {
    await apiClient.delete(`/documents/${documentId}/elements/${elementId}`);
  },

  /**
   * Delete multiple elements
   * @param documentId - Document ID
   * @param elementIds - Array of element IDs
   */
  async deleteMultiple(documentId: string, elementIds: string[]): Promise<void> {
    await apiClient.post(`/documents/${documentId}/elements/delete-multiple`, {
      element_ids: elementIds,
    });
  },

  /**
   * Duplicate element
   * @param documentId - Document ID
   * @param elementId - Element ID
   * @param offset - Optional offset for duplicated element
   * @returns Duplicated element
   */
  async duplicate(
    documentId: string,
    elementId: string,
    offset?: { x: number; y: number }
  ): Promise<Element> {
    const response = await apiClient.post<Element>(
      `/documents/${documentId}/elements/${elementId}/duplicate`,
      { offset }
    );
    return response.data!;
  },

  /**
   * Move element to different page
   * @param documentId - Document ID
   * @param elementId - Element ID
   * @param targetPageNumber - Target page number
   * @returns Updated element
   */
  async moveToPage(
    documentId: string,
    elementId: string,
    targetPageNumber: number
  ): Promise<Element> {
    const response = await apiClient.post<Element>(
      `/documents/${documentId}/elements/${elementId}/move`,
      {
        page_number: targetPageNumber,
      }
    );
    return response.data!;
  },

  /**
   * Update element z-index (layer order)
   * @param documentId - Document ID
   * @param elementId - Element ID
   * @param zIndex - New z-index
   * @returns Updated element
   */
  async updateZIndex(
    documentId: string,
    elementId: string,
    zIndex: number
  ): Promise<Element> {
    const response = await apiClient.patch<Element>(
      `/documents/${documentId}/elements/${elementId}`,
      { z_index: zIndex }
    );
    return response.data!;
  },

  /**
   * Bring element to front (highest z-index)
   * @param documentId - Document ID
   * @param elementId - Element ID
   * @returns Updated element
   */
  async bringToFront(documentId: string, elementId: string): Promise<Element> {
    const response = await apiClient.post<Element>(
      `/documents/${documentId}/elements/${elementId}/bring-to-front`
    );
    return response.data!;
  },

  /**
   * Send element to back (lowest z-index)
   * @param documentId - Document ID
   * @param elementId - Element ID
   * @returns Updated element
   */
  async sendToBack(documentId: string, elementId: string): Promise<Element> {
    const response = await apiClient.post<Element>(
      `/documents/${documentId}/elements/${elementId}/send-to-back`
    );
    return response.data!;
  },

  /**
   * Move element forward one layer
   * @param documentId - Document ID
   * @param elementId - Element ID
   * @returns Updated element
   */
  async bringForward(documentId: string, elementId: string): Promise<Element> {
    const response = await apiClient.post<Element>(
      `/documents/${documentId}/elements/${elementId}/bring-forward`
    );
    return response.data!;
  },

  /**
   * Move element backward one layer
   * @param documentId - Document ID
   * @param elementId - Element ID
   * @returns Updated element
   */
  async sendBackward(documentId: string, elementId: string): Promise<Element> {
    const response = await apiClient.post<Element>(
      `/documents/${documentId}/elements/${elementId}/send-backward`
    );
    return response.data!;
  },

  /**
   * Lock element to prevent editing
   * @param documentId - Document ID
   * @param elementId - Element ID
   * @returns Updated element
   */
  async lock(documentId: string, elementId: string): Promise<Element> {
    const response = await apiClient.patch<Element>(
      `/documents/${documentId}/elements/${elementId}`,
      { locked: true }
    );
    return response.data!;
  },

  /**
   * Unlock element
   * @param documentId - Document ID
   * @param elementId - Element ID
   * @returns Updated element
   */
  async unlock(documentId: string, elementId: string): Promise<Element> {
    const response = await apiClient.patch<Element>(
      `/documents/${documentId}/elements/${elementId}`,
      { locked: false }
    );
    return response.data!;
  },

  /**
   * Group multiple elements
   * @param documentId - Document ID
   * @param elementIds - Array of element IDs to group
   * @returns Group information
   */
  async group(documentId: string, elementIds: string[]): Promise<any> {
    const response = await apiClient.post<any>(
      `/documents/${documentId}/elements/group`,
      {
        element_ids: elementIds,
      }
    );
    return response.data!;
  },

  /**
   * Ungroup elements
   * @param documentId - Document ID
   * @param groupId - Group ID
   * @returns Array of ungrouped elements
   */
  async ungroup(documentId: string, groupId: string): Promise<Element[]> {
    const response = await apiClient.post<Element[]>(
      `/documents/${documentId}/elements/groups/${groupId}/ungroup`
    );
    return response.data!;
  },

  /**
   * Align elements
   * @param documentId - Document ID
   * @param elementIds - Array of element IDs
   * @param alignment - Alignment type
   * @returns Updated elements
   */
  async align(
    documentId: string,
    elementIds: string[],
    alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
  ): Promise<Element[]> {
    const response = await apiClient.post<Element[]>(
      `/documents/${documentId}/elements/align`,
      {
        element_ids: elementIds,
        alignment,
      }
    );
    return response.data!;
  },

  /**
   * Distribute elements evenly
   * @param documentId - Document ID
   * @param elementIds - Array of element IDs
   * @param direction - Distribution direction
   * @returns Updated elements
   */
  async distribute(
    documentId: string,
    elementIds: string[],
    direction: 'horizontal' | 'vertical'
  ): Promise<Element[]> {
    const response = await apiClient.post<Element[]>(
      `/documents/${documentId}/elements/distribute`,
      {
        element_ids: elementIds,
        direction,
      }
    );
    return response.data!;
  },

  /**
   * Rotate element
   * @param documentId - Document ID
   * @param elementId - Element ID
   * @param rotation - Rotation in degrees
   * @returns Updated element
   */
  async rotate(
    documentId: string,
    elementId: string,
    rotation: number
  ): Promise<Element> {
    const response = await apiClient.patch<Element>(
      `/documents/${documentId}/elements/${elementId}`,
      { rotation }
    );
    return response.data!;
  },

  /**
   * Flip element
   * @param documentId - Document ID
   * @param elementId - Element ID
   * @param direction - Flip direction
   * @returns Updated element
   */
  async flip(
    documentId: string,
    elementId: string,
    direction: 'horizontal' | 'vertical'
  ): Promise<Element> {
    const response = await apiClient.post<Element>(
      `/documents/${documentId}/elements/${elementId}/flip`,
      { direction }
    );
    return response.data!;
  },

  /**
   * Apply style to element
   * @param documentId - Document ID
   * @param elementId - Element ID
   * @param style - Style properties
   * @returns Updated element
   */
  async applyStyle(
    documentId: string,
    elementId: string,
    style: Record<string, any>
  ): Promise<Element> {
    const response = await apiClient.patch<Element>(
      `/documents/${documentId}/elements/${elementId}`,
      style
    );
    return response.data!;
  },

  /**
   * Copy style from one element to another
   * @param documentId - Document ID
   * @param sourceElementId - Source element ID
   * @param targetElementIds - Target element IDs
   * @returns Updated elements
   */
  async copyStyle(
    documentId: string,
    sourceElementId: string,
    targetElementIds: string[]
  ): Promise<Element[]> {
    const response = await apiClient.post<Element[]>(
      `/documents/${documentId}/elements/${sourceElementId}/copy-style`,
      {
        target_element_ids: targetElementIds,
      }
    );
    return response.data!;
  },

  // ============================================================================
  // Text Element Specific Methods
  // ============================================================================

  /**
   * Update text content
   * @param documentId - Document ID
   * @param elementId - Element ID
   * @param content - New text content
   * @returns Updated element
   */
  async updateText(
    documentId: string,
    elementId: string,
    content: string
  ): Promise<Element> {
    const response = await apiClient.patch<Element>(
      `/documents/${documentId}/elements/${elementId}`,
      { content }
    );
    return response.data!;
  },

  /**
   * Update text formatting
   * @param documentId - Document ID
   * @param elementId - Element ID
   * @param formatting - Formatting properties
   * @returns Updated element
   */
  async updateTextFormatting(
    documentId: string,
    elementId: string,
    formatting: {
      font_family?: string;
      font_size?: number;
      font_weight?: string;
      font_style?: string;
      color?: string;
      align?: 'left' | 'center' | 'right' | 'justify';
      line_height?: number;
    }
  ): Promise<Element> {
    const response = await apiClient.patch<Element>(
      `/documents/${documentId}/elements/${elementId}`,
      formatting
    );
    return response.data!;
  },

  // ============================================================================
  // Image Element Specific Methods
  // ============================================================================

  /**
   * Replace image in element
   * @param documentId - Document ID
   * @param elementId - Element ID
   * @param image - New image file
   * @param onProgress - Upload progress callback
   * @returns Updated element
   */
  async replaceImage(
    documentId: string,
    elementId: string,
    image: any,
    onProgress?: (progress: number) => void
  ): Promise<Element> {
    const formData = new FormData();

    const fileUri = image.uri || image;
    const fileName = image.name || image.fileName || 'image.png';
    const fileType = image.type || image.mimeType || 'image/png';

    formData.append('image', {
      uri: fileUri,
      name: fileName,
      type: fileType,
    } as any);

    const response = await apiClient.uploadFile<Element>(
      `/documents/${documentId}/elements/${elementId}/replace-image`,
      formData,
      onProgress
    );

    return response.data!;
  },

  /**
   * Adjust image fit mode
   * @param documentId - Document ID
   * @param elementId - Element ID
   * @param fit - Fit mode
   * @returns Updated element
   */
  async adjustImageFit(
    documentId: string,
    elementId: string,
    fit: 'cover' | 'contain' | 'fill' | 'none'
  ): Promise<Element> {
    const response = await apiClient.patch<Element>(
      `/documents/${documentId}/elements/${elementId}`,
      { fit }
    );
    return response.data!;
  },

  // ============================================================================
  // Signature Element Specific Methods
  // ============================================================================

  /**
   * Update signature data
   * @param documentId - Document ID
   * @param elementId - Element ID
   * @param signatureData - Signature data (base64 or SVG)
   * @returns Updated element
   */
  async updateSignature(
    documentId: string,
    elementId: string,
    signatureData: string
  ): Promise<Element> {
    const response = await apiClient.patch<Element>(
      `/documents/${documentId}/elements/${elementId}`,
      { signature_data: signatureData }
    );
    return response.data!;
  },

  // ============================================================================
  // Shape Element Specific Methods
  // ============================================================================

  /**
   * Update shape properties
   * @param documentId - Document ID
   * @param elementId - Element ID
   * @param properties - Shape properties
   * @returns Updated element
   */
  async updateShape(
    documentId: string,
    elementId: string,
    properties: {
      fill_color?: string;
      stroke_color?: string;
      stroke_width?: number;
      points?: Array<{ x: number; y: number }>;
    }
  ): Promise<Element> {
    const response = await apiClient.patch<Element>(
      `/documents/${documentId}/elements/${elementId}`,
      properties
    );
    return response.data!;
  },

  // ============================================================================
  // Checkbox Element Specific Methods
  // ============================================================================

  /**
   * Toggle checkbox
   * @param documentId - Document ID
   * @param elementId - Element ID
   * @returns Updated element
   */
  async toggleCheckbox(documentId: string, elementId: string): Promise<Element> {
    const response = await apiClient.post<Element>(
      `/documents/${documentId}/elements/${elementId}/toggle`
    );
    return response.data!;
  },

  /**
   * Set checkbox state
   * @param documentId - Document ID
   * @param elementId - Element ID
   * @param checked - Checked state
   * @returns Updated element
   */
  async setCheckbox(
    documentId: string,
    elementId: string,
    checked: boolean
  ): Promise<Element> {
    const response = await apiClient.patch<Element>(
      `/documents/${documentId}/elements/${elementId}`,
      { checked }
    );
    return response.data!;
  },
};

export default elementsService;
