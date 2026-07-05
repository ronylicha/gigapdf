/**
 * Services Index
 * Central export point for all API services
 */

// API Client and utilities
export { default as apiClient, tokenManager, axiosInstance, AUTH_BASE_URL, BASE_URL } from './api';
export { isApiException, getErrorMessage, getValidationErrors, createFormData } from './api';

// Authentication
export { default as authService, socialAuthService, twoFactorAuthService } from './auth';

// Storage (GED) — current FastAPI /api/v1/storage/* surface (used by screens)
export { storageService } from './storageService';

// Sharing — current FastAPI /api/v1/sharing/* surface (used by screens)
export { sharingService } from './sharingService';

// Documents (legacy session-document service — mostly superseded by storageService)
export { default as documentsService } from './documents';

// Pages — migrated to the stateless PDF engine + stored-document versions
export { default as pagesService } from './pages';

// Elements
export { default as elementsService } from './elements';

// Annotations
export { default as annotationsService } from './annotations';

// PDF Editor (comprehensive editing service)
export { default as pdfEditorService } from './pdf-editor';

// Types (explicitly export to avoid conflicts)
export type {
  ApiResponse,
  PaginatedResponse,
  LoginCredentials,
  RegisterData,
  AuthTokens,
  User,
  AuthResponse,
  BetterAuthSession,
  Document,
  DocumentMetadata,
  DocumentStatus,
  Page,
  PageMetadata,
  Element,
  ElementType,
  TextElement,
  ImageElement,
  SignatureElement,
  ShapeElement,
  Annotation,
  AnnotationType,
  MarkupAnnotation,
  NoteAnnotation,
  LinkAnnotation,
  Position,
  Size,
  ApiError,
  ApiException,
} from './types';

// Re-export services as named exports for convenience
import authService from './auth';
import documentsService from './documents';
import pagesService from './pages';
import elementsService from './elements';
import annotationsService from './annotations';
import pdfEditorService from './pdf-editor';

export const services = {
  auth: authService,
  documents: documentsService,
  pages: pagesService,
  elements: elementsService,
  annotations: annotationsService,
  pdfEditor: pdfEditorService,
};

export default services;
