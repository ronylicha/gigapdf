/**
 * API Configuration
 * Centralized configuration for API services
 */

// ============================================================================
// Environment Variables
// ============================================================================

// You can use environment variables with expo-constants
// import Constants from 'expo-constants';
// const API_URL = Constants.expoConfig?.extra?.apiUrl;

// ============================================================================
// API Configuration
// ============================================================================

export const API_CONFIG = {
  // Base API URL
  baseURL: 'https://giga-pdf.com/api/v1',

  // Alternative URLs for different environments
  urls: {
    production: 'https://giga-pdf.com/api/v1',
    staging: 'https://staging.giga-pdf.com/api/v1',
    development: 'https://dev.giga-pdf.com/api/v1',
    local: 'http://localhost:8000/api/v1',
  },

  // Timeouts (in milliseconds)
  timeouts: {
    default: 30000, // 30 seconds
    upload: 300000, // 5 minutes
    download: 300000, // 5 minutes
    longRunning: 600000, // 10 minutes
  },

  // Retry configuration
  retry: {
    enabled: true,
    maxRetries: 3,
    retryDelay: 1000, // 1 second
    retryableStatuses: [408, 429, 500, 502, 503, 504],
  },

  // Token configuration
  tokens: {
    storageKeys: {
      accessToken: 'auth_token',
      refreshToken: 'refresh_token',
    },
    refreshBuffer: 60, // Refresh token 60 seconds before expiry
  },

  // Request configuration
  headers: {
    common: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    upload: {
      'Content-Type': 'multipart/form-data',
    },
  },

  // Feature flags
  features: {
    enableLogging: __DEV__, // Enable in development only
    enableMetrics: true,
    enableCaching: true,
    enableOfflineMode: false,
  },

  // Cache configuration
  cache: {
    ttl: {
      default: 5 * 60 * 1000, // 5 minutes
      user: 10 * 60 * 1000, // 10 minutes
      documents: 2 * 60 * 1000, // 2 minutes
      pages: 5 * 60 * 1000, // 5 minutes
      previews: 30 * 60 * 1000, // 30 minutes
    },
  },

  // Pagination defaults
  pagination: {
    defaultPage: 1,
    defaultPerPage: 20,
    maxPerPage: 100,
  },

  // Upload configuration
  upload: {
    maxFileSize: 100 * 1024 * 1024, // 100 MB
    allowedMimeTypes: [
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/jpg',
      'image/webp',
    ],
    chunkSize: 1024 * 1024, // 1 MB chunks for large files
  },

  // Download configuration
  download: {
    defaultFormat: 'pdf',
    imageQuality: 90,
    imageDPI: 150,
  },
};

// ============================================================================
// Environment Detection
// ============================================================================

export function getEnvironment(): 'production' | 'staging' | 'development' | 'local' {
  if (__DEV__) {
    return 'development';
  }

  const { baseURL } = API_CONFIG;

  if (baseURL.includes('localhost') || baseURL.includes('127.0.0.1')) {
    return 'local';
  }

  if (baseURL.includes('staging')) {
    return 'staging';
  }

  if (baseURL.includes('dev')) {
    return 'development';
  }

  return 'production';
}

/**
 * Get API URL for current environment
 */
export function getApiUrl(): string {
  const env = getEnvironment();
  return API_CONFIG.urls[env] || API_CONFIG.baseURL;
}

// ============================================================================
// API Endpoints
// ============================================================================

/**
 * API endpoints, grouped by backend surface.
 *
 * Two surfaces coexist behind `https://giga-pdf.com` (see `BASE_URL` in
 * `api.ts`):
 *   • `/api/v1/*`  — FastAPI (auth, GED storage, quota, sharing, session
 *                    document + elements APIs). Reached via `apiClient`
 *                    (baseURL already includes `/api/v1`), so paths below are
 *                    RELATIVE to `/api/v1`.
 *   • `/api/pdf/*` — the stateless TypeScript PDF engine (Next.js). These are
 *                    ABSOLUTE (`${BASE_URL}/api/pdf/...`) and NOT reachable via
 *                    `apiClient` (different base) — see the `engine` block.
 *
 * The pre-refactor stateful editing routes (`/documents/{id}/pages/*`,
 * `/documents/{id}/.../annotations/*`, `/history`, `/forms`, standalone
 * `/layers`) were REMOVED. Their current replacements are noted below.
 */
export const ENDPOINTS = {
  // Authentication (FastAPI /api/v1/auth/*)
  auth: {
    login: '/auth/login',
    register: '/auth/register',
    logout: '/auth/logout',
    refresh: '/auth/refresh',
    me: '/auth/me',
    profile: '/auth/profile',
    changePassword: '/auth/password/change',
    resetPassword: '/auth/password/reset',
    verifyEmail: '/auth/email/verify',
  },

  // Persistent document storage — the GED (FastAPI /api/v1/storage/*).
  // This is the primary document surface used by the app.
  storage: {
    list: '/storage/documents',
    get: (id: string) => `/storage/documents/${id}`,
    upload: '/storage/documents',
    rename: (id: string) => `/storage/documents/${id}`,
    delete: (id: string) => `/storage/documents/${id}`,
    move: (id: string) => `/storage/documents/${id}/move`,
    // No public download URL: load → session id → documents.download (below).
    load: (id: string) => `/storage/documents/${id}/load`,
    versions: (id: string) => `/storage/documents/${id}/versions`,
    thumbnail: (id: string) => `/storage/documents/${id}/thumbnail`,
    duplicate: (id: string) => `/storage/documents/${id}/duplicate`,
    layers: (id: string) => `/storage/documents/${id}/layers`,
    tags: '/storage/documents/tags',
    folders: '/storage/folders',
    folder: (id: string) => `/storage/folders/${id}`,
    folderStats: (id: string) => `/storage/folders/${id}/stats`,
  },

  // Transient editing session documents (FastAPI /api/v1/documents/*).
  // `id` here is the session handle returned by `storage.load`.
  documents: {
    upload: '/documents/upload',
    get: (id: string) => `/documents/${id}`,
    download: (id: string) => `/documents/${id}/download`,
    delete: (id: string) => `/documents/${id}`,
    unlock: (id: string) => `/documents/${id}/unlock`,
  },

  // Scene-graph elements on a session document (FastAPI /api/v1/documents/{id}/...).
  elements: {
    list: (documentId: string, pageNum: number) =>
      `/documents/${documentId}/pages/${pageNum}/elements`,
    get: (documentId: string, elementId: string) =>
      `/documents/${documentId}/elements/${elementId}`,
    create: (documentId: string, pageNum: number) =>
      `/documents/${documentId}/pages/${pageNum}/elements`,
    update: (documentId: string, elementId: string) =>
      `/documents/${documentId}/elements/${elementId}`,
    delete: (documentId: string, elementId: string) =>
      `/documents/${documentId}/elements/${elementId}`,
    move: (documentId: string, elementId: string) =>
      `/documents/${documentId}/elements/${elementId}/move`,
    duplicate: (documentId: string, elementId: string) =>
      `/documents/${documentId}/elements/${elementId}/duplicate`,
    batch: (documentId: string) => `/documents/${documentId}/elements/batch`,
  },

  // Quota (FastAPI /api/v1/quota/*)
  quota: {
    me: '/quota/me',
    effective: '/quota/effective',
    plans: '/quota/plans',
  },

  // Sharing (FastAPI /api/v1/sharing/*)
  sharing: {
    sharedWithMe: '/sharing/shared-with-me',
    sharedByMe: '/sharing/shared-by-me',
    share: '/sharing/share',
    pendingInvitations: '/sharing/invitations/pending',
    acceptInvitation: (token: string) => `/sharing/invitations/${token}/accept`,
    declineInvitation: (token: string) => `/sharing/invitations/${token}/decline`,
    documentShares: (documentId: string) => `/sharing/documents/${documentId}/shares`,
    publicLink: (documentId: string) => `/sharing/documents/${documentId}/public-link`,
    notifications: '/sharing/notifications',
  },

  // Stateless PDF engine (Next.js). ABSOLUTE URLs — prepend `BASE_URL`, NOT the
  // `/api/v1` apiClient base. These replace the removed page/annotation/form
  // editing routes. Multipart `file` in → PDF (or JSON) out.
  engine: {
    pages: '/api/pdf/pages', // add | delete | move | rotate | copy | resize
    text: '/api/pdf/text',
    image: '/api/pdf/image',
    shape: '/api/pdf/shape',
    annotations: '/api/pdf/annotations',
    forms: '/api/pdf/forms',
    merge: '/api/pdf/merge',
    mergeUniversal: '/api/pdf/merge-universal',
    split: '/api/pdf/split',
    encrypt: '/api/pdf/encrypt',
    flatten: '/api/pdf/flatten',
    watermark: '/api/pdf/watermark',
    sign: '/api/pdf/sign',
    ocr: '/api/pdf/ocr',
    compress: '/api/pdf/compress',
    convert: '/api/pdf/convert',
    preview: '/api/pdf/preview',
    toImage: '/api/pdf/to-image',
    imageToPdf: '/api/pdf/image-to-pdf',
    metadata: '/api/pdf/metadata',
  },
};

// ============================================================================
// Error Messages
// ============================================================================

export const ERROR_MESSAGES = {
  network: {
    offline: 'No internet connection. Please check your network.',
    timeout: 'Request timeout. Please try again.',
    serverError: 'Server error. Please try again later.',
  },

  auth: {
    invalidCredentials: 'Invalid email or password.',
    sessionExpired: 'Your session has expired. Please login again.',
    unauthorized: 'You are not authorized to perform this action.',
    emailNotVerified: 'Please verify your email address.',
  },

  validation: {
    required: 'This field is required.',
    invalidEmail: 'Please enter a valid email address.',
    passwordTooShort: 'Password must be at least 8 characters.',
    passwordMismatch: 'Passwords do not match.',
  },

  upload: {
    fileTooLarge: 'File is too large. Maximum size is 100 MB.',
    invalidFileType: 'Invalid file type. Only PDF files are allowed.',
    uploadFailed: 'Upload failed. Please try again.',
  },

  document: {
    notFound: 'Document not found.',
    locked: 'This document is password protected.',
    processingFailed: 'Failed to process document.',
  },

  generic: {
    unknown: 'An unexpected error occurred.',
    tryAgain: 'Please try again.',
  },
};

// ============================================================================
// Success Messages
// ============================================================================

export const SUCCESS_MESSAGES = {
  auth: {
    loginSuccess: 'Login successful!',
    registerSuccess: 'Account created successfully!',
    logoutSuccess: 'Logged out successfully.',
    profileUpdated: 'Profile updated successfully.',
    passwordChanged: 'Password changed successfully.',
  },

  document: {
    uploaded: 'Document uploaded successfully!',
    deleted: 'Document deleted successfully.',
    updated: 'Document updated successfully.',
    downloaded: 'Document downloaded successfully.',
  },

  page: {
    added: 'Page added successfully.',
    deleted: 'Page deleted successfully.',
    rotated: 'Page rotated successfully.',
    reordered: 'Pages reordered successfully.',
  },

  element: {
    created: 'Element created successfully.',
    updated: 'Element updated successfully.',
    deleted: 'Element deleted successfully.',
  },

  annotation: {
    created: 'Annotation created successfully.',
    updated: 'Annotation updated successfully.',
    deleted: 'Annotation deleted successfully.',
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if file size is within limit
 */
export function isFileSizeValid(fileSize: number): boolean {
  return fileSize <= API_CONFIG.upload.maxFileSize;
}

/**
 * Check if file type is allowed
 */
export function isFileTypeAllowed(mimeType: string): boolean {
  return API_CONFIG.upload.allowedMimeTypes.includes(mimeType);
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Get max file size formatted
 */
export function getMaxFileSizeFormatted(): string {
  return formatFileSize(API_CONFIG.upload.maxFileSize);
}

export default API_CONFIG;
