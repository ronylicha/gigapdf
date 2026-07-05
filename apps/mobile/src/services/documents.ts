/**
 * Documents Service
 * Handles session-document operations (upload, download, unlock).
 *
 * ── Migration note (2026-07, tech-debt #20) ─────────────────────────────────
 * This service targets the FastAPI `/api/v1/documents/*` (session/processing
 * document) surface. It is NOT imported by any screen — persistent document
 * management is done by `storageService` (the GED, `/api/v1/storage/*`).
 *
 * Current route status:
 *   ✅ Live: `upload`, `get`, `download`, `delete`, `unlock`
 *            (`/documents/upload`, `/documents/{id}`, `/documents/{id}/download`,
 *             `/documents/{id}`, `/documents/{id}/unlock`).
 *   ❌ REMOVED (no `/api/v1/documents/*` equivalent) — do not rely on them:
 *      `list` (`GET /documents` → use `storageService.listDocuments`),
 *      `merge`/`split`/`compress`/`optimize`/`convert`/`watermark`/`protect`/
 *      `metadata`/`text/*`/`duplicate`/`activity`/`from-template`/`share`/
 *      `restore`/`force` → use the stateless PDF engine (`/api/pdf/*`),
 *      `storageService`, or `sharingService` instead.
 */

import { apiClient, createFormData } from './api';
import {
  ApiResponse,
  Document,
  DocumentListParams,
  DocumentTextExtraction,
  PaginatedResponse,
  UnlockDocumentData,
  UploadDocumentData,
} from './types';
// Use legacy API for file system operations
import {
  documentDirectory,
  createDownloadResumable,
} from 'expo-file-system/legacy';

// ============================================================================
// Documents Service
// ============================================================================

export const documentsService = {
  /**
   * Get list of documents with pagination and filtering
   * @param params - Query parameters for filtering, sorting, and pagination
   * @returns Paginated list of documents
   */
  async list(params?: DocumentListParams): Promise<PaginatedResponse<Document>> {
    const response = await apiClient.get<PaginatedResponse<Document>>('/documents', {
      params,
    });
    return response.data!;
  },

  /**
   * Get all documents (without pagination)
   * @param params - Query parameters for filtering and sorting
   * @returns Array of all documents
   */
  async getAll(params?: Omit<DocumentListParams, 'page' | 'per_page'>): Promise<Document[]> {
    const response = await apiClient.get<Document[]>('/documents/all', {
      params,
    });
    return response.data!;
  },

  /**
   * Get single document by ID
   * @param id - Document ID
   * @returns Document details
   */
  async get(id: string): Promise<Document> {
    const response = await apiClient.get<Document>(`/documents/${id}`);
    return response.data!;
  },

  /**
   * Upload new PDF document
   * @param data - Upload data including file and optional metadata
   * @param onProgress - Callback for upload progress (0-100)
   * @returns Created document
   */
  async upload(
    data: UploadDocumentData,
    onProgress?: (progress: number) => void
  ): Promise<Document> {
    const formData = new FormData();

    // Handle file upload for React Native
    const fileUri = data.file.uri || data.file;
    const fileName = data.file.name || data.file.fileName || 'document.pdf';
    const fileType = data.file.type || data.file.mimeType || 'application/pdf';

    // For React Native, we need to create a proper file object
    formData.append('file', {
      uri: fileUri,
      name: fileName,
      type: fileType,
    } as any);

    if (data.title) {
      formData.append('title', data.title);
    }

    if (data.password) {
      formData.append('password', data.password);
    }

    const response = await apiClient.uploadFile<Document>(
      '/documents/upload',
      formData,
      onProgress
    );

    return response.data!;
  },

  /**
   * Update document metadata
   * @param id - Document ID
   * @param data - Data to update
   * @returns Updated document
   */
  async update(id: string, data: Partial<Document>): Promise<Document> {
    const response = await apiClient.patch<Document>(`/documents/${id}`, data);
    return response.data!;
  },

  /**
   * Delete document
   * @param id - Document ID
   */
  async delete(id: string): Promise<void> {
    await apiClient.delete(`/documents/${id}`);
  },

  /**
   * Restore soft-deleted document
   * @param id - Document ID
   * @returns Restored document
   */
  async restore(id: string): Promise<Document> {
    const response = await apiClient.post<Document>(`/documents/${id}/restore`);
    return response.data!;
  },

  /**
   * Permanently delete document
   * @param id - Document ID
   */
  async forceDelete(id: string): Promise<void> {
    await apiClient.delete(`/documents/${id}/force`);
  },

  /**
   * Download document as file
   * @param id - Document ID
   * @param onProgress - Callback for download progress (0-100)
   * @returns Local file URI
   */
  async download(
    id: string,
    onProgress?: (progress: number) => void
  ): Promise<string> {
    const document = await this.get(id);
    const fileName = document.original_filename || `document_${id}.pdf`;
    const fileUri = `${documentDirectory}${fileName}`;

    const downloadResumable = createDownloadResumable(
      `${apiClient.getInstance().defaults.baseURL}/documents/${id}/download`,
      fileUri,
      {
        headers: {
          Authorization: `Bearer ${await import('./api').then((m) => m.tokenManager.getAccessToken())}`,
        },
      },
      (downloadProgress) => {
        if (onProgress) {
          const progress = Math.round(
            (downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite) * 100
          );
          onProgress(progress);
        }
      }
    );

    const result = await downloadResumable.downloadAsync();

    if (!result) {
      throw new Error('Download failed');
    }

    return result.uri;
  },

  /**
   * Get download URL for document
   * @param id - Document ID
   * @returns Download URL
   */
  async getDownloadUrl(id: string): Promise<string> {
    const baseUrl = apiClient.getInstance().defaults.baseURL;
    return `${baseUrl}/documents/${id}/download`;
  },

  /**
   * Unlock password-protected document
   * @param id - Document ID
   * @param data - Password data
   * @returns Unlocked document
   */
  async unlock(id: string, data: UnlockDocumentData): Promise<Document> {
    const response = await apiClient.post<Document>(`/documents/${id}/unlock`, data);
    return response.data!;
  },

  /**
   * Extract text from document
   * @param id - Document ID
   * @param pageNumbers - Optional array of specific page numbers to extract
   * @returns Extracted text data
   */
  async extractText(
    id: string,
    pageNumbers?: number[]
  ): Promise<DocumentTextExtraction> {
    const response = await apiClient.get<DocumentTextExtraction>(
      `/documents/${id}/text/extract`,
      {
        params: pageNumbers ? { pages: pageNumbers.join(',') } : undefined,
      }
    );
    return response.data!;
  },

  /**
   * Search text within document
   * @param id - Document ID
   * @param query - Search query
   * @param caseSensitive - Whether search is case-sensitive
   * @returns Search results with page numbers and positions
   */
  async searchText(
    id: string,
    query: string,
    caseSensitive = false
  ): Promise<Array<{ page: number; text: string; position: number }>> {
    const response = await apiClient.get<Array<{ page: number; text: string; position: number }>>(
      `/documents/${id}/text/search`,
      {
        params: {
          q: query,
          case_sensitive: caseSensitive,
        },
      }
    );
    return response.data!;
  },

  /**
   * Duplicate document
   * @param id - Document ID
   * @param title - Optional title for duplicated document
   * @returns Duplicated document
   */
  async duplicate(id: string, title?: string): Promise<Document> {
    const response = await apiClient.post<Document>(`/documents/${id}/duplicate`, {
      title,
    });
    return response.data!;
  },

  /**
   * Merge multiple documents
   * @param documentIds - Array of document IDs to merge
   * @param title - Title for merged document
   * @returns Merged document
   */
  async merge(documentIds: string[], title?: string): Promise<Document> {
    const response = await apiClient.post<Document>('/documents/merge', {
      document_ids: documentIds,
      title,
    });
    return response.data!;
  },

  /**
   * Split document into multiple documents
   * @param id - Document ID
   * @param splitPoints - Array of page numbers where to split
   * @returns Array of created documents
   */
  async split(id: string, splitPoints: number[]): Promise<Document[]> {
    const response = await apiClient.post<Document[]>(`/documents/${id}/split`, {
      split_points: splitPoints,
    });
    return response.data!;
  },

  /**
   * Compress document to reduce file size
   * @param id - Document ID
   * @param quality - Compression quality (1-100)
   * @returns Compressed document
   */
  async compress(id: string, quality = 75): Promise<Document> {
    const response = await apiClient.post<Document>(`/documents/${id}/compress`, {
      quality,
    });
    return response.data!;
  },

  /**
   * Optimize document for web viewing
   * @param id - Document ID
   * @returns Optimized document
   */
  async optimize(id: string): Promise<Document> {
    const response = await apiClient.post<Document>(`/documents/${id}/optimize`);
    return response.data!;
  },

  /**
   * Convert document to different format
   * @param id - Document ID
   * @param format - Target format (e.g., 'pdf/a', 'docx', 'images')
   * @returns Converted document or download URL
   */
  async convert(id: string, format: string): Promise<Document | string> {
    const response = await apiClient.post<Document | { url: string }>(
      `/documents/${id}/convert`,
      { format }
    );

    if (typeof response.data === 'object' && 'url' in response.data) {
      return response.data.url;
    }

    return response.data!;
  },

  /**
   * Add watermark to document
   * @param id - Document ID
   * @param watermarkData - Watermark configuration
   * @returns Document with watermark
   */
  async addWatermark(
    id: string,
    watermarkData: {
      text: string;
      opacity?: number;
      rotation?: number;
      position?: 'center' | 'top' | 'bottom' | 'diagonal';
      fontSize?: number;
      color?: string;
    }
  ): Promise<Document> {
    const response = await apiClient.post<Document>(
      `/documents/${id}/watermark`,
      watermarkData
    );
    return response.data!;
  },

  /**
   * Protect document with password
   * @param id - Document ID
   * @param password - Password to protect document
   * @param permissions - Optional permissions (print, copy, modify)
   * @returns Protected document
   */
  async protect(
    id: string,
    password: string,
    permissions?: {
      allow_printing?: boolean;
      allow_copying?: boolean;
      allow_modifying?: boolean;
    }
  ): Promise<Document> {
    const response = await apiClient.post<Document>(`/documents/${id}/protect`, {
      password,
      ...permissions,
    });
    return response.data!;
  },

  /**
   * Remove password protection from document
   * @param id - Document ID
   * @param password - Current password
   * @returns Unprotected document
   */
  async removeProtection(id: string, password: string): Promise<Document> {
    const response = await apiClient.post<Document>(`/documents/${id}/unprotect`, {
      password,
    });
    return response.data!;
  },

  /**
   * Get document metadata and properties
   * @param id - Document ID
   * @returns Document metadata
   */
  async getMetadata(id: string): Promise<any> {
    const response = await apiClient.get<any>(`/documents/${id}/metadata`);
    return response.data!;
  },

  /**
   * Update document metadata
   * @param id - Document ID
   * @param metadata - Metadata to update
   * @returns Updated document
   */
  async updateMetadata(id: string, metadata: Record<string, any>): Promise<Document> {
    const response = await apiClient.patch<Document>(`/documents/${id}/metadata`, metadata);
    return response.data!;
  },

  /**
   * Share document with other users
   * @param id - Document ID
   * @param emails - Array of email addresses
   * @param permissions - Share permissions
   * @returns Share information
   */
  async share(
    id: string,
    emails: string[],
    permissions: {
      can_view?: boolean;
      can_edit?: boolean;
      can_download?: boolean;
      can_share?: boolean;
    }
  ): Promise<any> {
    const response = await apiClient.post<any>(`/documents/${id}/share`, {
      emails,
      permissions,
    });
    return response.data!;
  },

  /**
   * Get document sharing information
   * @param id - Document ID
   * @returns Share information
   */
  async getShareInfo(id: string): Promise<any> {
    const response = await apiClient.get<any>(`/documents/${id}/share`);
    return response.data!;
  },

  /**
   * Revoke document sharing
   * @param id - Document ID
   * @param userId - User ID to revoke access
   */
  async revokeShare(id: string, userId: string): Promise<void> {
    await apiClient.delete(`/documents/${id}/share/${userId}`);
  },

  /**
   * Get document activity history
   * @param id - Document ID
   * @returns Activity log
   */
  async getActivity(id: string): Promise<any[]> {
    const response = await apiClient.get<any[]>(`/documents/${id}/activity`);
    return response.data!;
  },

  /**
   * Create document from template
   * @param templateId - Template ID
   * @param data - Template data
   * @returns Created document
   */
  async createFromTemplate(templateId: string, data: Record<string, any>): Promise<Document> {
    const response = await apiClient.post<Document>('/documents/from-template', {
      template_id: templateId,
      data,
    });
    return response.data!;
  },
};

export default documentsService;
