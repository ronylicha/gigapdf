/**
 * Storage Service for GigaPDF Mobile
 * Handles documents and folders management
 * Compatible with FastAPI backend /api/v1/storage/ endpoints
 */

import { apiClient, BASE_URL, tokenManager } from './api';
import { File, Paths } from 'expo-file-system';

// ============================================================================
// Types for Storage API
// ============================================================================

export interface StoredDocument {
  stored_document_id: string;
  name: string;
  page_count: number;
  version: number;
  folder_id: string | null;
  tags: string[];
  file_size_bytes: number;
  created_at: string;
  modified_at: string;
  thumbnail_url: string | null;
}

export interface Folder {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
  document_count?: number;
  subfolder_count?: number;
}

export interface FolderStats {
  folder_id: string;
  name: string;
  document_count: number;
  total_size_bytes: number;
  subfolder_count: number;
}

export interface DocumentVersion {
  version: number;
  created_at: string;
  file_size_bytes: number;
  page_count: number;
}

/**
 * An active editing session opened from a stored document via
 * `POST /storage/documents/{id}/load`. The returned `sessionDocumentId` is a
 * short-lived handle usable with the FastAPI Document APIs (notably
 * `GET /documents/{id}/download`).
 */
export interface LoadedSession {
  sessionDocumentId: string;
  storedDocumentId: string;
  name: string;
  pageCount: number;
}

/** A stored document downloaded to a local cache file. */
export interface DownloadedDocument {
  /** Local `file://` URI of the downloaded PDF (usable by react-native-pdf and FormData). */
  localUri: string;
  session: LoadedSession;
}

export interface DocumentsListParams {
  folder_id?: string | null;
  page?: number;
  per_page?: number;
  search?: string;
  tags?: string;
  sort_by?: 'name' | 'created_at' | 'modified_at' | 'file_size';
  sort_order?: 'asc' | 'desc';
}

export interface PaginationInfo {
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

export interface DocumentsListResponse {
  items: StoredDocument[];
  pagination: PaginationInfo;
}

export interface QuotaInfo {
  user_id: string;
  storage_used_bytes: number;
  storage_limit_bytes: number;
  api_calls_used: number;
  api_calls_limit: number;
  period_start: string;
  period_end: string;
}

export interface QuotaPlan {
  name: string;
  storage_limit_gb: number;
  api_calls_limit: number;
  features: string[];
}

// ============================================================================
// Storage Service - Documents
// ============================================================================

export const storageService = {
  // ==========================================================================
  // Documents
  // ==========================================================================

  /**
   * List documents with optional filters
   */
  async listDocuments(params: DocumentsListParams = {}): Promise<DocumentsListResponse> {
    const queryParams: Record<string, string | number> = {};

    if (params.folder_id !== undefined) {
      queryParams.folder_id = params.folder_id === null ? '' : params.folder_id;
    }
    if (params.page !== undefined) queryParams.page = params.page;
    if (params.per_page !== undefined) queryParams.per_page = params.per_page;
    if (params.search) queryParams.search = params.search;
    if (params.tags) queryParams.tags = params.tags;

    console.log('[Storage] Fetching documents with params:', queryParams);

    const response = await apiClient.get<DocumentsListResponse>('/storage/documents', {
      params: queryParams,
    });

    console.log('[Storage] Documents response:', response);

    return response.data || { items: [], pagination: { total: 0, page: 1, per_page: 20, total_pages: 0 } };
  },

  /**
   * Get document details with versions
   */
  async getDocument(documentId: string): Promise<StoredDocument & { versions: DocumentVersion[] }> {
    const response = await apiClient.get<StoredDocument & { versions: DocumentVersion[] }>(
      `/storage/documents/${documentId}`
    );
    return response.data!;
  },

  /**
   * Upload a new document
   */
  async uploadDocument(
    file: any,
    options: {
      name?: string;
      folder_id?: string | null;
      tags?: string[];
    } = {},
    onProgress?: (progress: number) => void
  ): Promise<StoredDocument> {
    const formData = new FormData();
    formData.append('file', file);

    if (options.name) formData.append('name', options.name);
    if (options.folder_id) formData.append('folder_id', options.folder_id);
    if (options.tags) formData.append('tags', JSON.stringify(options.tags));

    const response = await apiClient.uploadFile<StoredDocument>(
      '/storage/documents',
      formData,
      onProgress
    );

    return response.data!;
  },

  /**
   * Rename a document
   */
  async renameDocument(documentId: string, newName: string): Promise<StoredDocument> {
    const response = await apiClient.patch<StoredDocument>(
      `/storage/documents/${documentId}`,
      { name: newName }
    );
    return response.data!;
  },

  /**
   * Move document to a folder
   */
  async moveDocument(documentId: string, folderId: string | null): Promise<StoredDocument> {
    const response = await apiClient.patch<StoredDocument>(
      `/storage/documents/${documentId}/move`,
      { folder_id: folderId }
    );
    return response.data!;
  },

  /**
   * Move multiple documents to a folder
   */
  async moveDocuments(documentIds: string[], folderId: string | null): Promise<void> {
    await Promise.all(
      documentIds.map(id => this.moveDocument(id, folderId))
    );
  },

  /**
   * Delete a document
   */
  async deleteDocument(documentId: string): Promise<void> {
    await apiClient.delete(`/storage/documents/${documentId}`);
  },

  /**
   * Delete multiple documents
   */
  async deleteDocuments(documentIds: string[]): Promise<void> {
    await Promise.all(
      documentIds.map(id => this.deleteDocument(id))
    );
  },

  /**
   * Update document tags
   */
  async updateDocumentTags(documentId: string, tags: string[]): Promise<StoredDocument> {
    const response = await apiClient.patch<StoredDocument>(
      `/storage/documents/${documentId}`,
      { tags }
    );
    return response.data!;
  },

  /**
   * Open a stored document into an active editing session.
   *
   * Current backend: `POST /api/v1/storage/documents/{id}/load` returns a
   * transient `document_id` (the session handle) usable with the FastAPI
   * Document APIs. This replaces the removed direct-download endpoint.
   */
  async loadSession(storedDocumentId: string): Promise<LoadedSession> {
    const response = await apiClient.post<{
      document_id: string;
      stored_document_id: string;
      name: string;
      page_count: number;
    }>(`/storage/documents/${storedDocumentId}/load`);

    const data = response.data!;
    return {
      sessionDocumentId: data.document_id,
      storedDocumentId: data.stored_document_id ?? storedDocumentId,
      name: data.name,
      pageCount: data.page_count,
    };
  },

  /**
   * Download the latest bytes of a stored document to a local cache file.
   *
   * There is no public GET download URL under `/storage`; the current flow is
   * `load` (→ session id) then `GET /api/v1/documents/{sessionId}/download`
   * with a Bearer token. The result is a `file://` URI ready for
   * react-native-pdf rendering, sharing, or as multipart input to the PDF
   * engine.
   */
  async downloadToFile(
    storedDocumentId: string,
    options: { signal?: AbortSignal } = {}
  ): Promise<DownloadedDocument> {
    const session = await this.loadSession(storedDocumentId);
    const token = await tokenManager.getAccessToken();

    const safeName =
      session.name?.replace(/[^\w.-]+/g, '_').slice(0, 80) || `${storedDocumentId}.pdf`;
    const destination = new File(
      Paths.cache,
      `gigapdf_${storedDocumentId}_${Date.now()}_${safeName}`
    );

    const downloaded = await File.downloadFileAsync(
      `${BASE_URL}/api/v1/documents/${session.sessionDocumentId}/download`,
      destination,
      {
        idempotent: true,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        signal: options.signal,
      }
    );

    return { localUri: downloaded.uri, session };
  },

  /**
   * Persist a modified PDF (a local `file://` URI) as a new version of a
   * stored document via `POST /api/v1/storage/documents/{id}/versions`.
   */
  async saveVersion(
    storedDocumentId: string,
    fileUri: string,
    comment?: string
  ): Promise<DocumentVersion> {
    const form = new FormData();
    const name = fileUri.split('/').pop() || 'document.pdf';
    form.append('file', { uri: fileUri, name, type: 'application/pdf' } as unknown as Blob);
    if (comment) form.append('comment', comment);

    const response = await apiClient.uploadFile<DocumentVersion>(
      `/storage/documents/${storedDocumentId}/versions`,
      form
    );
    return response.data!;
  },

  /**
   * Resolve the transient session download URL for a stored document.
   *
   * @deprecated There is no stable public download URL. Prefer
   * {@link downloadToFile} which handles the load→download flow and auth.
   * This helper returns the session URL from a fresh `load`; fetching it still
   * requires an `Authorization: Bearer` header and the session is short-lived.
   */
  async getDocumentDownloadUrl(storedDocumentId: string): Promise<string> {
    const session = await this.loadSession(storedDocumentId);
    return `${BASE_URL}/api/v1/documents/${session.sessionDocumentId}/download`;
  },

  // ==========================================================================
  // Folders
  // ==========================================================================

  /**
   * List folders
   */
  async listFolders(parentId?: string | null): Promise<Folder[]> {
    console.log('[Storage] Fetching folders');

    const response = await apiClient.get<{ folders: Array<{ folder_id: string; name: string; parent_id: string | null; path: string; created_at: string }> }>('/storage/folders');

    console.log('[Storage] Folders response:', response);

    // Map backend response to Folder interface
    const folders = response.data?.folders || [];
    const mappedFolders: Folder[] = folders.map(f => ({
      id: f.folder_id,
      name: f.name,
      parent_id: f.parent_id,
      created_at: f.created_at,
      updated_at: f.created_at,
    }));

    // Filter by parent if specified
    if (parentId !== undefined) {
      return mappedFolders.filter(f => f.parent_id === parentId);
    }

    return mappedFolders;
  },

  /**
   * Create a new folder
   */
  async createFolder(name: string, parentId?: string | null): Promise<Folder> {
    const response = await apiClient.post<{ folder_id: string; name: string; parent_id: string | null; path: string; created_at: string }>('/storage/folders', {
      name,
      parent_id: parentId,
    });

    const data = response.data!;
    return {
      id: data.folder_id,
      name: data.name,
      parent_id: data.parent_id,
      created_at: data.created_at,
      updated_at: data.created_at,
    };
  },

  /**
   * Rename a folder
   */
  async renameFolder(folderId: string, newName: string): Promise<Folder> {
    const response = await apiClient.patch<Folder>(
      `/storage/folders/${folderId}`,
      { name: newName }
    );
    return response.data!;
  },

  /**
   * Move folder to another parent
   */
  async moveFolder(folderId: string, newParentId: string | null): Promise<Folder> {
    const response = await apiClient.patch<Folder>(
      `/storage/folders/${folderId}/move`,
      { parent_id: newParentId }
    );
    return response.data!;
  },

  /**
   * Delete a folder (must be empty or use force)
   */
  async deleteFolder(folderId: string, force: boolean = false): Promise<void> {
    await apiClient.delete(`/storage/folders/${folderId}`, {
      params: { force },
    });
  },

  /**
   * Get folder statistics
   */
  async getFolderStats(folderId: string): Promise<FolderStats> {
    const response = await apiClient.get<FolderStats>(`/storage/folders/${folderId}/stats`);
    return response.data!;
  },

  // ==========================================================================
  // Quota
  // ==========================================================================

  /**
   * Get current user quota
   */
  async getQuota(): Promise<QuotaInfo> {
    const response = await apiClient.get<QuotaInfo>('/quota/me');
    return response.data!;
  },

  /**
   * Get effective quota (with any overrides)
   */
  async getEffectiveQuota(): Promise<QuotaInfo> {
    const response = await apiClient.get<QuotaInfo>('/quota/effective');
    return response.data!;
  },

  /**
   * Get available plans
   */
  async getPlans(): Promise<QuotaPlan[]> {
    const response = await apiClient.get<QuotaPlan[]>('/quota/plans');
    return response.data || [];
  },
};

// ============================================================================
// Helper functions
// ============================================================================

/**
 * Format file size to human readable string
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';

  const units = ['B', 'Ko', 'Mo', 'Go', 'To'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${units[i]}`;
}

/**
 * Format date to relative time
 */
export function formatRelativeDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return "À l'instant";
  if (diffMins < 60) return `Il y a ${diffMins} min`;
  if (diffHours < 24) return `Il y a ${diffHours}h`;
  if (diffDays < 7) return `Il y a ${diffDays}j`;

  return date.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

/**
 * Get file icon based on document name
 */
export function getDocumentIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();

  switch (ext) {
    case 'pdf':
      return 'document-text';
    case 'doc':
    case 'docx':
      return 'document';
    case 'xls':
    case 'xlsx':
      return 'grid';
    case 'ppt':
    case 'pptx':
      return 'easel';
    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'gif':
    case 'webp':
      return 'image';
    default:
      return 'document-text';
  }
}

export default storageService;
