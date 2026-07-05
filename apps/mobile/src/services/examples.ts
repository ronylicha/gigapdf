/**
 * Usage Examples for GigaPDF API Services
 * Practical examples with React Query hooks.
 *
 * ── Migration note (2026-07, tech-debt #20) ─────────────────────────────────
 * These hooks are ILLUSTRATIVE and not imported by any screen. Their route
 * status against the CURRENT backend:
 *
 *  ✅ Current / working:
 *     • Auth hooks (useLogin/useRegister/useLogout/useCurrentUser)
 *     • usePageRotate / usePageDelete — now routed through the migrated
 *       `pagesService` (stateless PDF engine + stored-document versions).
 *
 *  ⚠️ Legacy scaffolding (the stateful editing API they call was REMOVED —
 *     `pagesService.list/get/getPreview/reorder`, `documentsService.*`,
 *     `elementsService.*`, `annotationsService.*` now throw or hit dead
 *     routes). For real usage prefer:
 *       • Document management → `storageService` (GED, `/api/v1/storage/*`)
 *       • Sharing            → `sharingService` (`/api/v1/sharing/*`)
 *       • PDF editing         → the stateless engine (`/api/pdf/*`)
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  authService,
  documentsService,
  pagesService,
  elementsService,
  annotationsService,
} from './index';
import type {
  LoginCredentials,
  RegisterData,
  Document,
  UploadDocumentData,
  CreateElementData,
  CreateMarkupAnnotationData,
} from './types';

// ============================================================================
// Authentication Hooks
// ============================================================================

/**
 * Hook for user login
 */
export function useLogin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (credentials: LoginCredentials) => authService.login(credentials),
    onSuccess: (data) => {
      // Cache user data
      queryClient.setQueryData(['user'], data.user);
    },
  });
}

/**
 * Hook for user registration
 */
export function useRegister() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: RegisterData) => authService.register(data),
    onSuccess: (data) => {
      queryClient.setQueryData(['user'], data.user);
    },
  });
}

/**
 * Hook for user logout
 */
export function useLogout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => authService.logout(),
    onSuccess: () => {
      // Clear all cached data
      queryClient.clear();
    },
  });
}

/**
 * Hook to get current user
 */
export function useCurrentUser() {
  return useQuery({
    queryKey: ['user'],
    queryFn: () => authService.getCurrentUser(),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// ============================================================================
// Documents Hooks
// ============================================================================

/**
 * Hook to get documents list
 */
export function useDocuments(params?: any) {
  return useQuery({
    queryKey: ['documents', params],
    queryFn: () => documentsService.list(params),
    staleTime: 1 * 60 * 1000, // 1 minute
  });
}

/**
 * Hook to get single document
 */
export function useDocument(id: string, enabled = true) {
  return useQuery({
    queryKey: ['document', id],
    queryFn: () => documentsService.get(id),
    enabled: !!id && enabled,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Hook for document upload with progress
 */
export function useDocumentUpload() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      data,
      onProgress,
    }: {
      data: UploadDocumentData;
      onProgress?: (progress: number) => void;
    }) => documentsService.upload(data, onProgress),
    onSuccess: () => {
      // Invalidate documents list to refetch
      queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
  });
}

/**
 * Hook for document deletion
 */
export function useDocumentDelete() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => documentsService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
  });
}

/**
 * Hook for document download
 */
export function useDocumentDownload() {
  return useMutation({
    mutationFn: ({
      id,
      onProgress,
    }: {
      id: string;
      onProgress?: (progress: number) => void;
    }) => documentsService.download(id, onProgress),
  });
}

/**
 * Hook for merging documents
 */
export function useDocumentMerge() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ documentIds, title }: { documentIds: string[]; title?: string }) =>
      documentsService.merge(documentIds, title),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
  });
}

// ============================================================================
// Pages Hooks
// ============================================================================

/**
 * Hook to get document pages
 */
export function usePages(documentId: string, enabled = true) {
  return useQuery({
    queryKey: ['pages', documentId],
    queryFn: () => pagesService.list(documentId),
    enabled: !!documentId && enabled,
  });
}

/**
 * Hook to get single page
 */
export function usePage(documentId: string, pageNumber: number, enabled = true) {
  return useQuery({
    queryKey: ['page', documentId, pageNumber],
    queryFn: () => pagesService.get(documentId, pageNumber),
    enabled: !!documentId && pageNumber > 0 && enabled,
  });
}

/**
 * Hook to get page preview
 */
export function usePagePreview(
  documentId: string,
  pageNumber: number,
  width?: number,
  height?: number
) {
  return useQuery({
    queryKey: ['page-preview', documentId, pageNumber, width, height],
    queryFn: () => pagesService.getPreview(documentId, pageNumber, width, height),
    enabled: !!documentId && pageNumber > 0,
    staleTime: 10 * 60 * 1000, // 10 minutes (previews don't change often)
  });
}

/**
 * Hook for page rotation
 */
export function usePageRotate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      documentId,
      pageNumber,
      rotation,
    }: {
      documentId: string;
      pageNumber: number;
      rotation: number;
    }) => pagesService.rotate(documentId, pageNumber, { rotation }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['pages', variables.documentId] });
      queryClient.invalidateQueries({
        queryKey: ['page', variables.documentId, variables.pageNumber],
      });
    },
  });
}

/**
 * Hook for page deletion
 */
export function usePageDelete() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ documentId, pageNumber }: { documentId: string; pageNumber: number }) =>
      pagesService.delete(documentId, pageNumber),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['pages', variables.documentId] });
      queryClient.invalidateQueries({ queryKey: ['document', variables.documentId] });
    },
  });
}

/**
 * Hook for page reordering
 */
export function usePageReorder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      documentId,
      pageNumbers,
    }: {
      documentId: string;
      pageNumbers: number[];
    }) => pagesService.reorder(documentId, { page_numbers: pageNumbers }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['pages', variables.documentId] });
    },
  });
}

// ============================================================================
// Elements Hooks
// ============================================================================

/**
 * Hook to get page elements
 */
export function useElements(documentId: string, pageNumber: number, enabled = true) {
  return useQuery({
    queryKey: ['elements', documentId, pageNumber],
    queryFn: () => elementsService.list(documentId, pageNumber),
    enabled: !!documentId && pageNumber > 0 && enabled,
  });
}

/**
 * Hook for creating element
 */
export function useElementCreate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      documentId,
      pageNumber,
      data,
      onProgress,
    }: {
      documentId: string;
      pageNumber: number;
      data: CreateElementData;
      onProgress?: (progress: number) => void;
    }) => elementsService.create(documentId, pageNumber, data, onProgress),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['elements', variables.documentId, variables.pageNumber],
      });
    },
  });
}

/**
 * Hook for updating element
 */
export function useElementUpdate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      documentId,
      elementId,
      data,
    }: {
      documentId: string;
      elementId: string;
      data: any;
    }) => elementsService.update(documentId, elementId, data),
    onSuccess: (element) => {
      queryClient.invalidateQueries({
        queryKey: ['elements', element.document_id, element.page_number],
      });
    },
  });
}

/**
 * Hook for deleting element
 */
export function useElementDelete() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      documentId,
      elementId,
      pageNumber,
    }: {
      documentId: string;
      elementId: string;
      pageNumber: number;
    }) => elementsService.delete(documentId, elementId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['elements', variables.documentId, variables.pageNumber],
      });
    },
  });
}

// ============================================================================
// Annotations Hooks
// ============================================================================

/**
 * Hook to get page annotations
 */
export function useAnnotations(documentId: string, pageNumber: number, enabled = true) {
  return useQuery({
    queryKey: ['annotations', documentId, pageNumber],
    queryFn: () => annotationsService.list(documentId, pageNumber),
    enabled: !!documentId && pageNumber > 0 && enabled,
  });
}

/**
 * Hook to get all document annotations
 */
export function useAllAnnotations(documentId: string, enabled = true) {
  return useQuery({
    queryKey: ['annotations-all', documentId],
    queryFn: () => annotationsService.listAll(documentId),
    enabled: !!documentId && enabled,
  });
}

/**
 * Hook for creating highlight annotation
 */
export function useHighlightCreate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      documentId,
      pageNumber,
      data,
    }: {
      documentId: string;
      pageNumber: number;
      data: CreateMarkupAnnotationData;
    }) => annotationsService.createHighlight(documentId, pageNumber, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['annotations', variables.documentId, variables.pageNumber],
      });
    },
  });
}

/**
 * Hook for creating note annotation
 */
export function useNoteCreate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      documentId,
      pageNumber,
      data,
    }: {
      documentId: string;
      pageNumber: number;
      data: any;
    }) => annotationsService.createNote(documentId, pageNumber, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['annotations', variables.documentId, variables.pageNumber],
      });
    },
  });
}

/**
 * Hook for deleting annotation
 */
export function useAnnotationDelete() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      documentId,
      annotationId,
      pageNumber,
    }: {
      documentId: string;
      annotationId: string;
      pageNumber: number;
    }) => annotationsService.delete(documentId, annotationId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['annotations', variables.documentId, variables.pageNumber],
      });
    },
  });
}

// ============================================================================
// Practical Usage Examples
// ============================================================================

/**
 * Example: Complete document workflow in a component
 */
export function DocumentWorkflowExample() {
  const { data: documents, isLoading } = useDocuments({ page: 1, per_page: 10 });
  const uploadMutation = useDocumentUpload();
  const deleteMutation = useDocumentDelete();

  const handleUpload = async (file: any) => {
    try {
      const document = await uploadMutation.mutateAsync({
        data: { file, title: 'My Document' },
        onProgress: (progress) => {
          console.log(`Upload: ${progress}%`);
        },
      });

      console.log('Document uploaded:', document);
    } catch (error) {
      console.error('Upload failed:', error);
    }
  };

  const handleDelete = async (documentId: string) => {
    try {
      await deleteMutation.mutateAsync(documentId);
      console.log('Document deleted');
    } catch (error) {
      console.error('Delete failed:', error);
    }
  };

  return {
    documents,
    isLoading,
    handleUpload,
    handleDelete,
    isUploading: uploadMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}

/**
 * Example: Page editing workflow
 */
export function PageEditingExample(documentId: string, pageNumber: number) {
  const { data: page } = usePage(documentId, pageNumber);
  const { data: elements } = useElements(documentId, pageNumber);
  const { data: annotations } = useAnnotations(documentId, pageNumber);

  const rotateMutation = usePageRotate();
  const createElementMutation = useElementCreate();
  const createHighlightMutation = useHighlightCreate();

  const handleRotate = async (degrees: number) => {
    await rotateMutation.mutateAsync({
      documentId,
      pageNumber,
      rotation: degrees,
    });
  };

  const handleAddText = async (text: string, x: number, y: number) => {
    await createElementMutation.mutateAsync({
      documentId,
      pageNumber,
      data: {
        type: 'text' as any,
        page_number: pageNumber,
        position: { x, y },
        size: { width: 200, height: 50 },
        content: text,
        font_size: 14,
      },
    });
  };

  const handleHighlight = async (coordinates: any[], text: string) => {
    await createHighlightMutation.mutateAsync({
      documentId,
      pageNumber,
      data: {
        coordinates,
        color: '#FFFF00',
        opacity: 0.5,
        text_content: text,
      },
    });
  };

  return {
    page,
    elements,
    annotations,
    handleRotate,
    handleAddText,
    handleHighlight,
  };
}

/**
 * Example: Real-time collaboration simulation
 */
export function CollaborationExample(documentId: string) {
  const queryClient = useQueryClient();

  // Simulate receiving real-time updates
  const handleRemoteUpdate = (event: any) => {
    switch (event.type) {
      case 'element.created':
        queryClient.invalidateQueries({
          queryKey: ['elements', documentId, event.data.page_number],
        });
        break;

      case 'annotation.created':
        queryClient.invalidateQueries({
          queryKey: ['annotations', documentId, event.data.page_number],
        });
        break;

      case 'page.updated':
        queryClient.invalidateQueries({ queryKey: ['pages', documentId] });
        break;

      default:
        break;
    }
  };

  return { handleRemoteUpdate };
}

export default {
  // Auth
  useLogin,
  useRegister,
  useLogout,
  useCurrentUser,

  // Documents
  useDocuments,
  useDocument,
  useDocumentUpload,
  useDocumentDelete,
  useDocumentDownload,
  useDocumentMerge,

  // Pages
  usePages,
  usePage,
  usePagePreview,
  usePageRotate,
  usePageDelete,
  usePageReorder,

  // Elements
  useElements,
  useElementCreate,
  useElementUpdate,
  useElementDelete,

  // Annotations
  useAnnotations,
  useAllAnnotations,
  useHighlightCreate,
  useNoteCreate,
  useAnnotationDelete,
};
