/**
 * @giga-pdf/api
 * API client and TanStack Query hooks for GigaPDF
 */

// Configuration
export { getApiConfig, setApiConfig, resetApiConfig } from './config';
export type { ApiConfig } from './config';

// Client
export {
  apiClient,
  setTokenStorage,
  setOnUnauthorized,
  getTokenStorage,
  ApiError,
  defaultTokenStorage,
} from './client';
export type { TokenStorage } from './client';

// Services
export {
  authService,
  documentService,
  pageService,
  elementService,
  uploadService,
  exportService,
  jobService,
  storageService,
  documentLayersService,
  billingService,
  pdfService,
} from './services';
export type { DocumentLayersData } from './services';
export type {
  OpenPdfOptions,
  OpenPdfResult,
  SavePdfOptions,
  MergePdfOptions,
  SplitPdfOptions,
  SplitPdfResult,
  SplitPart,
  PreviewOptions,
  AllThumbnailsResult,
  ThumbnailData,
  EncryptOptions,
  PermissionsResult,
  FormFieldsResult,
  ElementOperationOptions,
  ConvertOptions,
  MetadataResult,
  FlattenOptions,
  ApplyElementsOperation,
  ParagraphStyleEdit,
  ListEdit,
  TableEdit,
  TableBorderSpec,
  RgbColor,
  TableRect,
  TableCellInfo,
  TableStructureInfo,
  TableStructureResult,
  ParagraphStylePatch,
  ListMarkerSpec,
  LineHeightSpec,
  CompressPdfResult,
  SearchablePdfResult,
  EditableOcrPdfResult,
} from './services';

// Hooks
export {
  // Auth hooks
  useCurrentUser,
  useLogin,
  useRegister,
  useLogout,
  useUpdateProfile,
  useRequestPasswordReset,
  useResetPassword,
  useVerifyEmail,
  useResendVerificationEmail,
  authKeys,

  // Document hooks
  useDocuments,
  useInfiniteDocuments,
  useDocument,
  useCreateDocument,
  useUpdateDocument,
  useDeleteDocument,
  useDuplicateDocument,
  useShareDocument,
  useRemoveCollaborator,
  useUpdateCollaboratorPermission,
  useDocumentHistory,
  useRestoreDocumentVersion,
  documentKeys,

  // Page hooks — pages are identified by page_number (integer), not a UUID
  usePage,
  useCreatePage,
  useDeletePage,
  useDuplicatePage,
  useReorderPages,
  useRotatePage,
  useResizePage,
  useExtractPages,
  useMovePage,
  usePagePreview,
  usePageImage,
  pageKeys,

  // Element hooks
  useElements,
  useElement,
  useCreateElement,
  useUpdateElement,
  useBulkUpdateElements,
  useDeleteElement,
  useBulkDeleteElements,
  useDuplicateElement,
  useMoveElement,
  useUpdateElementZIndex,
  useBringElementToFront,
  useSendElementToBack,
  useGroupElements,
  useUngroupElements,
  elementKeys,

  // Upload hooks
  useUploadDirect,
  useUnlockDocument,
  useGetPresignedUrl,
  useUploadToPresignedUrl,
  useCompleteUpload,
  useCancelUpload,
  useUploadStatus,
  useFileUpload,
  uploadKeys,

  // Export hooks
  useCreateExport,
  useExportStatus,
  useDownloadExport,
  useCancelExport,
  useExports,
  useExportDirect,
  useExportDownloadUrl,
  useExportAndDownload,
  exportKeys,

  // Job hooks
  useJob,
  useJobs,
  useCancelJob,
  useRetryJob,
  useDeleteJob,
  useJobResult,
  useClearCompletedJobs,
  jobKeys,

  // Storage hooks
  useStorageDocuments,
  useCreateStorageDocument,
  useLoadDocument,
  useUpdateStorageDocument,
  useDeleteStorageDocument,
  useMoveDocument,
  useDocumentVersions,
  useCreateVersion,
  useFolders,
  useCreateFolder,
  useDeleteFolder,
  useMoveFolder,
  useFolderStats,
  useStorageQuota,
  useEffectiveQuota,
  useQuotaPlans,
  storageKeys,

  // Document layers hooks (cross-session layer persistence)
  useDocumentLayers,
  useSaveDocumentLayers,
  documentLayersKeys,

  // Billing hooks
  useSubscription,
  usePlans,
  useCreateCheckoutSession,
  useCreatePortalSession,
  useUpdateSubscription,
  useCancelSubscription,
  useReactivateSubscription,
  useInvoices,
  useInvoice,
  useDownloadInvoice,
  usePaymentMethods,
  useAddPaymentMethod,
  useRemovePaymentMethod,
  useSetDefaultPaymentMethod,
  useUsageSummary,
  billingKeys,

  // PDF engine hooks
  useOpenPdf,
  useSavePdf,
  useMergePdfs,
  useSplitPdf,
  usePreviewPage,
  usePreviewAllThumbnails,
  useEncryptPdf,
  useDecryptPdf,
  useGetPermissions,
  useSetPermissions,
  useGetFormFields,
  useFillFormFields,
  useAddFormField,
  usePdfPageOperation,
  useGetPdfMetadata,
  useSetPdfMetadata,
  useFlattenPdf,
  useConvertToPdf,
  useApplyElements,
  useApplyOcgLayers,
  useApplyModelOps,
  useTableStructure,
  useSearchPdf,
  useAddWatermark,
  useAddImageWatermark,
  useSignPdf,
  useOcrPdf,
  useMakeSearchablePdf,
  useMakeEditableOcrPdf,
  useCompressPdf,
  useIsOcrAvailable,
  useConvertToPdfA,
  downloadBlob,
  pdfKeys,
} from './hooks';
export type { OcgLayerOp } from './hooks';

// WebSocket
export {
  socketClient,
  setAuthTokenProvider,
  useSocket,
  useSocketEvent,
  useDocumentCollaboration,
  useDocumentUpdates,
  usePageUpdates,
  useElementUpdates,
  useJobStatus,
} from './websocket';
export type { SocketEvent, SocketEventData, AuthTokenProvider } from './websocket';

// Providers
export { QueryProvider, SocketProvider, useSocketContext } from './providers';
