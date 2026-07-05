"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { DocumentExplorer, ViewMode } from "@/components/dashboard/document-explorer";
import { SortField, SortDirection } from "@/components/dashboard/document-table";
import { BreadcrumbFolder } from "@/components/dashboard/folder-breadcrumb";
import { Button, Input, Progress, Skeleton, useToast } from "@giga-pdf/ui";
import {
  Search,
  Upload,
  FilePlus2,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  ArrowRight,
  Home,
  RefreshCw,
} from "lucide-react";
import { api, getAuthToken, StoredDocument } from "@/lib/api";
import {
  extractDocumentBlocks,
  extractDocumentText,
} from "@/components/editor/lib/extract-text";
import { clientLogger } from "@/lib/client-logger";
import { ImportDialog } from "@/components/dashboard/import-dialog";
import {
  BlankDocumentDialog,
  type BlankOrientation,
  type BlankSize,
} from "@/components/dashboard/blank-document-dialog";
import {
  IMPORT_CONCURRENCY,
  MAX_IMPORT_FILE_SIZE_BYTES,
  batchCurrentFileName,
  batchPercent,
  createBatchProgress,
  isImageFile,
  isOfficeFile,
  isPdfFile,
  isTextModelFile,
  progressWithCurrentFile,
  progressWithFileFraction,
  progressWithFileSettled,
  runWithConcurrency,
  stripExtension,
  summarizeOutcomes,
  validateImportFile,
  type BatchUploadProgress,
  type ImportOutcome,
} from "@/lib/document-import";
import {
  isAbortError,
  uploadWithProgress,
  withTimeoutSignal,
  type UploadProgressEvent,
} from "@/lib/upload-with-progress";

/**
 * Auto-index a scanned (image-only) PDF for semantic search (#85). OCRs every
 * page via the engine route (native WASM OCR — no server binary), then ships
 * the blocks to the backend pgvector index. Fire-and-forget: every failure is
 * swallowed (logged) so a failed OCR can never disrupt the import that
 * triggered it. Called only for a PDF with no extractable text layer.
 */
async function autoIndexScannedDocument(
  pdfBlob: Blob,
  storedDocumentId: string,
): Promise<void> {
  try {
    const token = await getAuthToken();
    const form = new FormData();
    form.append("file", pdfBlob, "document.pdf");
    form.append("granularity", "line");

    const res = await fetch("/api/pdf/ocr-page", {
      method: "POST",
      credentials: "include",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
    });
    if (!res.ok) {
      clientLogger.warn("documents.auto-ocr-index-failed", res.status);
      return;
    }
    const data = (await res.json()) as {
      blocks?: Array<{
        page: number;
        text: string;
        bbox: { x: number; y: number; w: number; h: number };
      }>;
    };
    const blocks = data.blocks ?? [];
    if (blocks.length === 0) return;

    await api.indexOcrBlocks(storedDocumentId, blocks);
    clientLogger.debug("documents.auto-ocr-indexed", blocks.length);
  } catch (err) {
    clientLogger.warn("documents.auto-ocr-index-failed", err);
  }
}

/**
 * Index a text-layer PDF as POSITIONED blocks (text + bbox per line) so search
 * hits can be highlighted on the page — identical to the editor save and the
 * server backfill. Best-effort; never blocks/fails the import.
 */
async function autoIndexTextBlocks(
  pdfBlob: Blob,
  storedDocumentId: string,
): Promise<void> {
  try {
    const blocks = await extractDocumentBlocks(await pdfBlob.arrayBuffer());
    if (blocks.length === 0) return; // no text layer → handled by the OCR path
    await api.indexOcrBlocks(storedDocumentId, blocks);
    clientLogger.debug("documents.auto-text-indexed", blocks.length);
  } catch (err) {
    clientLogger.warn("documents.auto-text-index-failed", err);
  }
}

interface Document {
  id: string;
  name: string;
  size: number;
  createdAt: Date;
  updatedAt: Date;
  folderId?: string | null;
  tags: string[];
  thumbnailUrl: string | null;
  mimeType: string | null;
}

interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// Thumbnail rendering bounds (PNG ≤ 2 MB backend limit is comfortable at
// this size) and client-side cap for the extracted full-text material
// (the backend truncates at the same threshold).
const THUMBNAIL_MAX_WIDTH = 480;
const THUMBNAIL_MAX_HEIGHT = 640;
const EXTRACTED_TEXT_MAX_CHARS = 500_000;

// Hard deadline for the best-effort enrichment calls (thumbnail render, text
// extraction, thumbnail upload). Without it a single hung request kept
// `uploading` true forever: the overlay never dismissed and the import dialog
// (which blocks closing mid-upload) locked the page until a reload.
const ENRICHMENT_TIMEOUT_MS = 60_000;

/** Progress/cancellation plumbing threaded through one file's import. */
interface ImportFileContext {
  /** Batch-level cancellation (user pressed Annuler). */
  signal: AbortSignal;
  /** Report this file's monotonic upload fraction (0..1). */
  onFraction: (fraction: number) => void;
}

/** Map a byte-level progress event onto a [base, base+span] fraction window. */
function fractionInWindow(
  event: UploadProgressEvent,
  base: number,
  span: number,
): number | null {
  if (event.total === null || event.total <= 0) return null;
  return base + span * Math.min(1, event.loaded / event.total);
}

/**
 * Render page 1 of a PDF as a PNG thumbnail via POST /api/pdf/preview
 * (mode=thumbnail, magic-bytes friendly PNG). Best-effort: returns null on
 * any failure and never throws — a missing thumbnail must not fail an import.
 */
async function renderPdfThumbnail(
  pdfFile: File,
  parentSignal?: AbortSignal,
): Promise<Blob | null> {
  // Time-boxed: a hung preview request must never freeze the import pipeline.
  const { signal, dispose } = withTimeoutSignal(parentSignal, ENRICHMENT_TIMEOUT_MS);
  try {
    const fd = new FormData();
    fd.append("file", pdfFile);
    fd.append("mode", "thumbnail");
    fd.append("pageNumber", "1");
    fd.append("format", "png");
    fd.append("maxWidth", String(THUMBNAIL_MAX_WIDTH));
    fd.append("maxHeight", String(THUMBNAIL_MAX_HEIGHT));

    const res = await fetch("/api/pdf/preview", {
      method: "POST",
      credentials: "include",
      body: fd,
      signal,
    });
    if (!res.ok) {
      clientLogger.warn("documents.thumbnail-render-failed", res.status);
      return null;
    }
    return await res.blob();
  } catch (err) {
    clientLogger.warn("documents.thumbnail-render-failed", err);
    return null;
  } finally {
    dispose();
  }
}

/**
 * Extract the plain text of a PDF entirely in the browser through the shared
 * GigaPDF WASM engine (`extractDocumentText` → `doc.toText()`) — the SAME single
 * engine instance already used below for the positioned-block index.
 *
 * This replaces the previous network round-trip to POST /api/pdf/parse, which
 * re-uploaded the WHOLE file just to read its text. The client already holds the
 * bytes, so extraction is now local: no request, no second full-file upload, and
 * — crucially — it no longer sits a network hop AHEAD of the save on the import's
 * critical path (parse → save → thumbnail became local extract → save →
 * thumbnail, one fewer round-trip). The engine and its text semantics
 * (`toText()`) match the server route, so the stored `extracted_text` (full-text
 * search material) is unchanged.
 *
 * Best-effort: returns null on any failure and for scanned/text-less PDFs, never
 * throws — a missing text layer must not fail an import. `parentSignal`
 * short-circuits an already-cancelled batch before the (local, non-abortable)
 * extraction starts.
 */
async function extractPdfText(
  pdfFile: File,
  parentSignal?: AbortSignal,
): Promise<string | null> {
  if (parentSignal?.aborted) return null;
  try {
    const text = await extractDocumentText(await pdfFile.arrayBuffer());
    const trimmed = text.trim();
    return trimmed ? trimmed.slice(0, EXTRACTED_TEXT_MAX_CHARS) : null;
  } catch (err) {
    clientLogger.warn("documents.text-extract-failed", err);
    return null;
  }
}

/**
 * Thrown when an Office→PDF conversion fails. `kind` lets the caller pick the
 * right localized reason: a real conversion failure (the file content can't be
 * rendered) vs. the conversion service being unavailable.
 */
class OfficeConversionError extends Error {
  constructor(
    message: string,
    readonly kind: "conversion" | "unavailable",
  ) {
    super(message);
    this.name = "OfficeConversionError";
  }
}

/** Progress/cancellation options threaded into a conversion upload. */
interface ConvertToPdfOptions {
  signal?: AbortSignal;
  onProgress?: (event: UploadProgressEvent) => void;
}

/**
 * Convert a file to an editable PDF via a Next.js conversion route (server-side
 * magic-byte/extension validation + native WASM engine). The returned PDF is
 * wrapped as a `<base>.pdf` File (application/pdf) so the rest of the import
 * pipeline treats it exactly like an uploaded PDF — and the editor opens it as
 * editable pages. Goes through the XHR transport so the conversion upload
 * feeds the real byte-level progress bar and honours the batch cancel signal.
 *
 * 503 = engine unavailable; everything else (400/413/422/500) is treated as a
 * content/conversion failure from the user's perspective.
 *
 * @throws {OfficeConversionError} on any non-2xx response (precise per-file reason)
 * @throws {DOMException} AbortError when the batch was cancelled (rethrown as-is)
 */
async function convertFileToPdfViaRoute(
  file: File,
  route: string,
  logKey: string,
  options: ConvertToPdfOptions = {},
): Promise<File> {
  const baseName = stripExtension(file.name) || file.name;
  const form = new FormData();
  form.append("file", file);

  let res: Awaited<ReturnType<typeof uploadWithProgress>>;
  try {
    res = await uploadWithProgress(route, form, {
      signal: options.signal,
      onProgress: options.onProgress,
    });
  } catch (err) {
    // A user cancel is not a service failure — let the caller handle it.
    if (isAbortError(err)) throw err;
    clientLogger.warn(`${logKey}-network-failed`, err);
    throw new OfficeConversionError(`${logKey} network error`, "unavailable");
  }

  if (!res.ok) {
    clientLogger.warn(`${logKey}-failed`, res.status);
    throw new OfficeConversionError(
      `${logKey} failed (${res.status})`,
      res.status === 503 ? "unavailable" : "conversion",
    );
  }

  const pdfBlob = await res.blob();
  return new File([pdfBlob], `${baseName}.pdf`, { type: "application/pdf" });
}

/** Office/RTF → editable PDF (POST /api/office/upload, WASM `convertOfficeToPdf`). */
function convertOfficeFileToPdf(
  file: File,
  options: ConvertToPdfOptions = {},
): Promise<File> {
  return convertFileToPdfViaRoute(
    file,
    "/api/office/upload",
    "documents.office-convert",
    options,
  );
}

/** Markdown/CSV → editable PDF (POST /api/convert/text-format, WASM model pipeline). */
function convertTextModelFileToPdf(
  file: File,
  options: ConvertToPdfOptions = {},
): Promise<File> {
  return convertFileToPdfViaRoute(
    file,
    "/api/convert/text-format",
    "documents.text-format-convert",
    options,
  );
}

/** Raster image → single-page editable PDF (POST /api/convert/image, WASM `imageToPdf`). */
function convertImageFileToPdf(
  file: File,
  options: ConvertToPdfOptions = {},
): Promise<File> {
  return convertFileToPdfViaRoute(
    file,
    "/api/convert/image",
    "documents.image-convert",
    options,
  );
}

/** Build the /documents URL preserving folder and tag query params. */
function buildDocumentsUrl(folderId: string | null, tag: string | null): string {
  const params = new URLSearchParams();
  if (folderId) params.set("folder", folderId);
  if (tag) params.set("tag", tag);
  const queryString = params.toString();
  return queryString ? `/documents?${queryString}` : "/documents";
}

export default function DocumentsPage() {
  const t = useTranslations("documents");
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Universal import dialog (single "Import" entry point).
  const [importDialogOpen, setImportDialogOpen] = useState(false);

  // Blank-document creation dialog (size/orientation picker) + in-flight flag.
  const [blankDialogOpen, setBlankDialogOpen] = useState(false);
  const [creatingBlank, setCreatingBlank] = useState(false);

  // Get current folder + tag filter from URL
  const currentFolderId = searchParams?.get("folder") || null;
  const currentTag = searchParams?.get("tag") || null;

  // Navigation history for custom back/forward
  const [navigationHistory, setNavigationHistory] = useState<(string | null)[]>([null]);
  const [historyIndex, setHistoryIndex] = useState(0);

  // Data states
  const [documents, setDocuments] = useState<Document[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [userTags, setUserTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  // Byte-accurate batch progress: per-file upload fractions weighted by file
  // size (real bytes sent), plus the settled-files counter for the i/N label.
  const [uploadProgress, setUploadProgress] =
    useState<BatchUploadProgress | null>(null);
  // Failures of the LAST batch, shown inline in the import dialog (which stays
  // open on failure so the user can retry). Cleared on new batch / dialog close.
  const [lastFailures, setLastFailures] = useState<
    Array<{ name: string; reason: string }> | null
  >(null);
  // Cancels every in-flight transfer of the current batch (Annuler button).
  const importAbortRef = useRef<AbortController | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Search and pagination
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // View settings
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sortField, setSortField] = useState<SortField>("updatedAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  // Breadcrumb path
  const [breadcrumbPath, setBreadcrumbPath] = useState<BreadcrumbFolder[]>([]);

  // Load view preferences from localStorage
  useEffect(() => {
    const savedViewMode = localStorage.getItem("documentViewMode") as ViewMode | null;
    const savedSortField = localStorage.getItem("documentSortField") as SortField | null;
    const savedSortDirection = localStorage.getItem("documentSortDirection") as SortDirection | null;

    if (savedViewMode) setViewMode(savedViewMode);
    if (savedSortField) setSortField(savedSortField);
    if (savedSortDirection) setSortDirection(savedSortDirection);
  }, []);

  // Save view preferences to localStorage
  useEffect(() => {
    localStorage.setItem("documentViewMode", viewMode);
    localStorage.setItem("documentSortField", sortField);
    localStorage.setItem("documentSortDirection", sortDirection);
  }, [viewMode, sortField, sortDirection]);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Build breadcrumb path when folder changes
  const buildBreadcrumbPath = useCallback(
    (folderId: string | null): BreadcrumbFolder[] => {
      if (!folderId) return [];

      const path: BreadcrumbFolder[] = [];
      let currentId: string | null = folderId;

      while (currentId) {
        const folder = folders.find((f) => f.id === currentId);
        if (folder) {
          path.unshift({ id: folder.id, name: folder.name });
          currentId = folder.parentId;
        } else {
          break;
        }
      }

      return path;
    },
    [folders]
  );

  // Update breadcrumb when folder changes
  useEffect(() => {
    setBreadcrumbPath(buildBreadcrumbPath(currentFolderId));
  }, [currentFolderId, buildBreadcrumbPath]);

  const loadDocuments = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Active search or tag filter = flat results across all folders, so
      // the folder constraint is dropped from the backend query too.
      const isFiltering = Boolean(debouncedSearch || currentTag);

      // Load documents for current folder (or flat filtered results)
      const response = await api.listDocuments({
        page,
        per_page: 50,
        search: debouncedSearch || undefined,
        tag: currentTag || undefined,
        folder_id: isFiltering ? undefined : currentFolderId || undefined,
      });

      const transformedDocs: Document[] = response.items.map(
        (doc: StoredDocument) => ({
          id: doc.stored_document_id,
          name: doc.name,
          size: doc.file_size_bytes || 0,
          createdAt: new Date(doc.created_at),
          updatedAt: new Date(doc.modified_at),
          folderId: doc.folder_id || null,
          tags: doc.tags ?? [],
          thumbnailUrl: doc.thumbnail_url ?? null,
          mimeType: doc.mime_type ?? null,
        })
      );

      setDocuments(transformedDocs);
      setTotalPages(response.pagination.total_pages);
      setTotal(response.pagination.total);

      // Load folders
      try {
        const foldersResponse = await api.listFolders();
        const transformedFolders: Folder[] = foldersResponse.folders.map(
          (folder) => ({
            id: folder.folder_id,
            name: folder.name,
            parentId: folder.parent_id,
            createdAt: new Date(folder.created_at),
            updatedAt: new Date(folder.created_at), // API doesn't return updated_at, use created_at
          })
        );
        setFolders(transformedFolders);
      } catch (folderErr) {
        clientLogger.warn("documents.load-folders-failed", folderErr);
        setFolders([]);
      }

      // Load the distinct user tags (toolbar filter dropdown). Best-effort:
      // the explorer simply hides the filter when the list is empty.
      try {
        setUserTags(await api.getUserTags());
      } catch (tagsErr) {
        clientLogger.warn("documents.load-tags-failed", tagsErr);
        setUserTags([]);
      }
    } catch (err) {
      clientLogger.error("documents.load-failed", err);
      setError(t("errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, currentFolderId, currentTag, t]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  const handleOpenImport = useCallback(() => {
    setImportDialogOpen(true);
  }, []);

  const handleOpenBlankDialog = useCallback(() => {
    setBlankDialogOpen(true);
  }, []);

  // Create a brand-new blank PDF (size/orientation chosen in the dialog), store
  // it through the SAME upload flow as an imported file (api.saveDocument), then
  // jump straight into the editor so the user can start working on it like a
  // blank Word document.
  const handleCreateBlankDocument = useCallback(
    async ({
      size,
      orientation,
    }: {
      size: BlankSize;
      orientation: BlankOrientation;
    }) => {
      setCreatingBlank(true);
      try {
        const token = await getAuthToken();
        const res = await fetch("/api/pdf/blank", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ size, orientation }),
        });
        if (!res.ok) {
          throw new Error(`blank pdf creation failed (${res.status})`);
        }

        const pdfBlob = await res.blob();
        const baseName = t("blank.defaultName");
        // The GED upload flow stores a File — wrap the generated bytes as one.
        const file = new File([pdfBlob], `${baseName}.pdf`, {
          type: "application/pdf",
        });

        const saved = await api.saveDocument({
          file,
          name: baseName,
          tags: [],
          folderId: currentFolderId || undefined,
        });

        setBlankDialogOpen(false);
        toast({ title: t("blank.created") });
        router.push(`/editor/${saved.stored_document_id}`);
      } catch (err) {
        clientLogger.error("documents.create-blank-failed", err);
        toast({ variant: "destructive", title: t("blank.createFailed") });
      } finally {
        setCreatingBlank(false);
      }
    },
    [currentFolderId, router, t, toast],
  );

  // Imports ONE file. Office/RTF documents (docx/xlsx/pptx/doc/xls/ppt/odt/ods/
  // odp/rtf → /api/office/upload), Markdown/CSV (→ /api/convert/text-format) and
  // raster images (png/jpg/jpeg/gif/webp/avif → /api/convert/image) are FIRST
  // converted to an editable PDF via the native WASM engine and the resulting
  // PDF is stored, so the editor can open them as editable pages instead of
  // dead-storing the raw bytes. PDFs (uploaded or freshly converted) additionally
  // get a first-page thumbnail + extracted full text for search; any remaining
  // format is stored as-is. Never throws: every failure is returned with a
  // precise per-file reason, so one bad file cannot abort the batch.
  const importSingleFile = useCallback(
    async (file: File, context: ImportFileContext): Promise<ImportOutcome> => {
      const { signal, onFraction } = context;

      // Client-side validation: size cap only (every format is accepted).
      const validation = validateImportFile(file, MAX_IMPORT_FILE_SIZE_BYTES);
      if (!validation.ok) {
        return {
          ok: false,
          name: file.name,
          reason: t(`import.${validation.reasonKey}`),
        };
      }

      // Office / RTF, text-model (Markdown, CSV), and raster images → editable
      // PDF. On failure we abort THIS file with a precise reason (never store
      // broken/un-openable bytes silently). A given file matches at most one of
      // these branches. Converted files transfer their bytes twice (conversion
      // upload then store upload) → each phase maps to half the file's weight.
      let fileToStore = file;
      const office = isOfficeFile(file);
      const textModel = isTextModelFile(file);
      const image = isImageFile(file);
      const needsConversion = office || textModel || image;
      const storeBase = needsConversion ? 0.5 : 0;
      const storeSpan = needsConversion ? 0.5 : 1;
      const conversionOptions: ConvertToPdfOptions = {
        signal,
        onProgress: (event) => {
          const fraction = fractionInWindow(event, 0, 0.5);
          if (fraction !== null) onFraction(fraction);
        },
      };

      if (needsConversion) {
        try {
          if (office) {
            fileToStore = await convertOfficeFileToPdf(file, conversionOptions);
          } else if (textModel) {
            fileToStore = await convertTextModelFileToPdf(file, conversionOptions);
          } else {
            fileToStore = await convertImageFileToPdf(file, conversionOptions);
          }
        } catch (err) {
          // Batch cancel: bubble up so the caller records a neutral outcome.
          if (isAbortError(err)) throw err;
          const kind =
            err instanceof OfficeConversionError ? err.kind : "conversion";
          const nsKey = office ? "office" : textModel ? "textFormat" : "image";
          return {
            ok: false,
            name: file.name,
            reason:
              kind === "unavailable"
                ? t(`import.${nsKey}.unavailable`)
                : t(`import.${nsKey}.conversionFailed`),
          };
        }
      }

      // From here on, treat the (possibly converted) file as the document to
      // store. The displayed/stored title keeps the ORIGINAL name's base.
      const baseName = stripExtension(file.name) || file.name;
      const pdf = isPdfFile(fileToStore);

      try {
        // PDF-only enrichment; both best-effort (resolve to null, never reject),
        // so neither can fail the import. Non-PDFs skip them; for Office files
        // they run on the freshly converted PDF (`fileToStore`).
        //
        // The thumbnail is a time-boxed NETWORK render (ENRICHMENT_TIMEOUT_MS),
        // kicked off FIRST so it streams in the background alongside everything
        // below. The text extraction now runs LOCALLY in the shared WASM engine
        // (no /api/pdf/parse round-trip, no second full-file upload): it is
        // awaited only to feed the save's `extracted_text` (full-text search)
        // and to pick the index path, and — being local — no longer adds a
        // network hop ahead of the save.
        const thumbnailPromise = pdf ? renderPdfThumbnail(fileToStore, signal) : null;
        const extractedText = pdf ? await extractPdfText(fileToStore, signal) : null;

        // Store the document: the original bytes for already-PDF / unconverted
        // formats, or the freshly converted PDF for Office/RTF, Markdown/CSV and
        // images. The title keeps the original base name. The XHR transport
        // reports real byte progress into this file's fraction window.
        const saved = await api.saveDocument({
          file: fileToStore,
          name: baseName,
          tags: [],
          folderId: currentFolderId || undefined,
          extractedText: extractedText ?? undefined,
          signal,
          onProgress: (event) => {
            const fraction = fractionInWindow(event, storeBase, storeSpan);
            if (fraction !== null) onFraction(fraction);
          },
        });

        // Best-effort thumbnail upload (needs the stored document id, hence
        // after save). Time-boxed; a failure is logged and silently ignored.
        if (thumbnailPromise) {
          const bounded = withTimeoutSignal(signal, ENRICHMENT_TIMEOUT_MS);
          try {
            const thumbnail = await thumbnailPromise;
            if (thumbnail) {
              await api.uploadDocumentThumbnail(
                saved.stored_document_id,
                thumbnail,
                `${baseName}.png`,
                { signal: bounded.signal },
              );
            }
          } catch (thumbErr) {
            clientLogger.warn("documents.thumbnail-upload-failed", thumbErr);
          } finally {
            bounded.dispose();
          }
        }

        // Auto-index image-only PDFs for semantic search (#85): a scanned PDF
        // carries no extractable text → OCR it via the engine and feed the
        // index in the background (fire-and-forget; never blocks/fails import).
        if (pdf) {
          if (extractedText && extractedText.trim().length > 0) {
            // Text-layer PDF → positioned blocks (highlightable on the page).
            void autoIndexTextBlocks(fileToStore, saved.stored_document_id);
          } else {
            // Scanned / image-only PDF → server OCR positioned blocks.
            void autoIndexScannedDocument(fileToStore, saved.stored_document_id);
          }
        }

        return { ok: true, name: file.name };
      } catch (err) {
        // Batch cancel: bubble up so the caller records a neutral outcome.
        if (isAbortError(err)) throw err;
        clientLogger.error("documents.import-file-failed", err);
        return {
          ok: false,
          name: file.name,
          reason: err instanceof Error ? err.message : t("errors.uploadFailed"),
        };
      }
    },
    [currentFolderId, t],
  );

  // Imports a batch of files through a bounded concurrency pool (3 parallel
  // pipelines). The progress counter ticks exactly once per settled file and
  // a summary toast reports successes/failures (with file names) at the end.
  const processFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      // One batch at a time: a second drop mid-upload would otherwise steal
      // the abort controller (Annuler would only cancel the newest batch).
      if (importAbortRef.current) return;

      // Drop-overlay safety net. The explorer's scoped drop zone calls
      // stopPropagation, so a drop on the listing never bubbles up to the page
      // onDrop that clears the drag overlay — it would stay stuck on screen.
      // processFiles is the SINGLE funnel for every import path (page drop,
      // explorer drop, dialog), so resetting the drag state here (before any
      // code that could throw) guarantees the full-screen drag overlay always
      // closes the moment an import starts.
      dragDepthRef.current = 0;
      setIsDraggingFiles(false);

      // One controller per batch: the Annuler button (overlay + dialog) aborts
      // every in-flight conversion/upload transfer at once.
      const controller = new AbortController();
      importAbortRef.current = controller;

      setUploading(true);
      setError(null);
      setLastFailures(null);
      setUploadProgress(createBatchProgress(files));

      try {
        const outcomes = await runWithConcurrency(
          files,
          IMPORT_CONCURRENCY,
          async (file, index) => {
            setUploadProgress((prev) =>
              prev ? progressWithCurrentFile(prev, index) : prev,
            );
            let outcome: ImportOutcome;
            try {
              outcome = await importSingleFile(file, {
                signal: controller.signal,
                onFraction: (fraction) => {
                  setUploadProgress((prev) =>
                    prev
                      ? progressWithFileFraction(prev, index, fraction)
                      : prev,
                  );
                },
              });
            } catch (err) {
              // Only AbortError bubbles up from importSingleFile (everything
              // else is folded into a per-file outcome). Record a neutral
              // outcome so the batch summary logic stays uniform.
              if (!isAbortError(err)) {
                clientLogger.error("documents.import-file-failed", err);
              }
              outcome = {
                ok: false,
                name: file.name,
                reason: t("import.cancelled"),
              };
            }
            setUploadProgress((prev) =>
              prev ? progressWithFileSettled(prev, index) : prev,
            );
            return outcome;
          },
        );

        const { successCount, failures } = summarizeOutcomes(outcomes);

        if (controller.signal.aborted) {
          // User cancel: neutral toast (no scary failure list), refresh the
          // listing if some files landed before the abort.
          toast({ title: t("import.cancelled") });
          if (successCount > 0) await loadDocuments();
          return;
        }

        if (failures.length === 0) {
          toast({
            title: t("import.summaryAllSuccess", { count: successCount }),
          });
          // Full success: the dialog closes on its own.
          setImportDialogOpen(false);
        } else {
          // Any failure keeps the dialog open with the inline failure list so
          // the user can read the reasons and retry (re-drop / browse again).
          setLastFailures(failures);
          toast({
            variant: "destructive",
            title:
              successCount === 0
                ? t("import.summaryAllFailed", { count: failures.length })
                : t("import.summaryPartial", {
                    success: successCount,
                    failed: failures.length,
                  }),
            description: (
              <span>
                {failures.map((failure, index) => (
                  <span key={`${failure.name}-${index}`} className="block">
                    {failure.name} : {failure.reason}
                  </span>
                ))}
              </span>
            ),
          });
        }

        if (successCount > 0) {
          await loadDocuments();
        }
      } finally {
        // ALL paths (success, failure, cancel, unexpected throw) reset the
        // uploading state — the full-screen overlay always dismisses and the
        // dialog becomes closable again.
        importAbortRef.current = null;
        setUploading(false);
        setUploadProgress(null);
      }
    },
    [importSingleFile, loadDocuments, t, toast],
  );

  // Cancel the in-flight import batch (aborts every transfer).
  const handleCancelImport = useCallback(() => {
    importAbortRef.current?.abort();
  }, []);

  const handleCreateFolder = async (name: string, parentId: string | null) => {
    await api.createFolder(name, parentId);
  };

  // Navigate to folder using URL. Folder browsing is an explicit context
  // switch: it clears any active tag filter (flat results would otherwise
  // contradict the folder the user just opened).
  const handleFolderNavigate = useCallback((folderId: string | null) => {
    // Update navigation history
    const newHistory = [...navigationHistory.slice(0, historyIndex + 1), folderId];
    setNavigationHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);

    // Update URL
    router.push(buildDocumentsUrl(folderId, null));
    setPage(1);
  }, [router, navigationHistory, historyIndex]);

  // Toggle the tag filter (URL-driven, folder context preserved)
  const handleTagChange = useCallback(
    (tag: string | null) => {
      router.push(buildDocumentsUrl(currentFolderId, tag));
      setPage(1);
    },
    [router, currentFolderId],
  );

  // Custom back navigation
  const handleBack = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      const folderId = navigationHistory[newIndex];
      setHistoryIndex(newIndex);
      router.push(buildDocumentsUrl(folderId ?? null, null));
    }
  }, [historyIndex, navigationHistory, router]);

  // Custom forward navigation
  const handleForward = useCallback(() => {
    if (historyIndex < navigationHistory.length - 1) {
      const newIndex = historyIndex + 1;
      const folderId = navigationHistory[newIndex];
      setHistoryIndex(newIndex);
      router.push(buildDocumentsUrl(folderId ?? null, null));
    }
  }, [historyIndex, navigationHistory, router]);

  // Go to root
  const handleGoHome = useCallback(() => {
    handleFolderNavigate(null);
  }, [handleFolderNavigate]);

  // Refresh
  const handleRefresh = useCallback(() => {
    loadDocuments();
  }, [loadDocuments]);

  const handleSortChange = (field: SortField, direction: SortDirection) => {
    setSortField(field);
    setSortDirection(direction);
  };

  // Get current path string for address bar
  const getCurrentPath = useCallback(() => {
    if (!currentFolderId) return "/";
    const path = breadcrumbPath.map((f) => f.name).join("/");
    return "/" + path;
  }, [currentFolderId, breadcrumbPath]);

  // Drop multiple files anywhere on the page (header/empty areas). EVERY
  // file type is accepted; each file is validated/uploaded individually by
  // processFiles. The overlay only shows when the user drags actual files
  // from the OS; internal drag-and-drop (folder reorganization) doesn't
  // trigger it because the explorer's HTML5 DnD puts only JSON in
  // dataTransfer.types, not `Files`. The explorer area owns its own scoped
  // drop zone (see DocumentExplorer onFilesDropped); it calls
  // stopPropagation so a drop on the listing doesn't double-fire here.
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const dragDepthRef = useRef(0);

  const handleFilesDropped = useCallback(
    (files: FileList | File[]) => {
      void processFiles(Array.from(files));
    },
    [processFiles],
  );

  // Active search OR tag filter = flat results (no folder grouping)
  const isFiltering = Boolean(debouncedSearch || currentTag);

  // Filter documents for current folder when not filtering
  const displayDocuments = isFiltering
    ? documents
    : documents.filter((doc) => (doc.folderId || null) === currentFolderId);

  const displayFolders = isFiltering
    ? []
    : folders.filter((folder) => folder.parentId === currentFolderId);

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < navigationHistory.length - 1;

  // Batch upload completion percentage (0–100) for the full-screen import
  // overlay progress bar — byte-accurate (real bytes sent, weighted by file
  // size), with a per-file fallback when no byte total is known.
  const uploadPercent = uploadProgress ? batchPercent(uploadProgress) : 0;
  const uploadIndeterminate =
    uploadProgress !== null && uploadProgress.totalBytes <= 0;
  const uploadCurrentFileName = uploadProgress
    ? batchCurrentFileName(uploadProgress)
    : null;

  return (
    <div
      className="space-y-4 relative min-h-[calc(100vh-4rem)]"
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        dragDepthRef.current += 1;
        setIsDraggingFiles(true);
      }}
      onDragLeave={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        dragDepthRef.current -= 1;
        if (dragDepthRef.current <= 0) {
          dragDepthRef.current = 0;
          setIsDraggingFiles(false);
        }
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        dragDepthRef.current = 0;
        setIsDraggingFiles(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          handleFilesDropped(e.dataTransfer.files);
        }
      }}
    >
      {/* Drop zone overlay — only while dragging external files AND not yet
          importing (the upload overlay below takes over the moment an import
          starts, so the two never coexist). */}
      {isDraggingFiles && !uploading && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-primary/10 backdrop-blur-sm border-4 border-dashed border-primary/60 pointer-events-none"
          style={{ pointerEvents: "none" }}
        >
          <div className="bg-background rounded-lg shadow-2xl px-8 py-6 flex items-center gap-4">
            <Upload className="h-12 w-12 text-primary" />
            <div>
              <p className="text-xl font-semibold">{t("import.dropTitle")}</p>
              <p className="text-sm text-muted-foreground">
                {t("import.dropHint")}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Upload overlay with a REAL byte-level progress bar — visible for the
          whole import. processFiles' `finally` resets uploading/uploadProgress
          on success, error AND cancel, so this overlay always dismisses on its
          own; the Annuler button aborts every in-flight transfer. */}
      {uploading && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-background/70 backdrop-blur-sm">
          <div
            className="bg-background rounded-lg shadow-2xl px-8 py-6 w-[min(90vw,28rem)] space-y-3"
            aria-live="polite"
          >
            <p className="text-lg font-semibold">{t("import.uploading")}</p>
            {uploadProgress && (
              <>
                {uploadCurrentFileName && (
                  <p className="text-sm text-muted-foreground truncate">
                    {t("import.currentFile", { name: uploadCurrentFileName })}
                  </p>
                )}
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>
                    {t("import.uploadingProgress", {
                      done: uploadProgress.done,
                      total: uploadProgress.total,
                    })}
                  </span>
                  {!uploadIndeterminate && <span>{uploadPercent}%</span>}
                </div>
                {uploadIndeterminate ? (
                  <Progress value={100} className="animate-pulse" />
                ) : (
                  <Progress value={uploadPercent} />
                )}
              </>
            )}
            <div className="flex justify-end">
              <Button
                variant="outline"
                onClick={handleCancelImport}
                className="pointer-coarse:min-h-11 pointer-coarse:min-w-11"
              >
                {t("import.cancel")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t("title")}</h1>
          <p className="text-muted-foreground">
            {total > 0 ? t("totalCount", { count: total }) : t("subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="gap-2"
            onClick={handleOpenBlankDialog}
            disabled={creatingBlank}
          >
            <FilePlus2 className="h-4 w-4" />
            {t("blank.button")}
          </Button>
          <Button
            className="gap-2"
            onClick={handleOpenImport}
            disabled={uploading}
          >
            {uploading ? (
              <>
                <Upload className="h-4 w-4 animate-pulse" />
                {uploadProgress && uploadProgress.total > 1
                  ? t("import.uploadingProgress", {
                      done: uploadProgress.done,
                      total: uploadProgress.total,
                    })
                  : t("import.uploading")}
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                {t("import.button")}
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Navigation Bar - File Explorer Style */}
      <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-lg border">
        {/* Navigation buttons */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleBack}
            disabled={!canGoBack}
            title={t("explorer.back")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleForward}
            disabled={!canGoForward}
            title={t("explorer.forward")}
          >
            <ArrowRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleGoHome}
            disabled={!currentFolderId}
            title={t("explorer.home")}
          >
            <Home className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRefresh}
            disabled={loading}
            title={t("explorer.refresh")}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {/* Address bar */}
        <div className="flex-1 flex items-center gap-2 px-3 py-1.5 bg-background rounded border min-w-0">
          <span className="text-sm text-muted-foreground truncate">
            {getCurrentPath()}
          </span>
        </div>

        {/* Search */}
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("search")}
            className="pl-10 h-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-10 w-64" />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {[...Array(8)].map((_, i) => (
              <Skeleton key={i} className="h-48" />
            ))}
          </div>
        </div>
      ) : displayDocuments.length === 0 &&
        displayFolders.length === 0 &&
        !isFiltering ? (
        <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center">
          <Upload className="mb-4 h-12 w-12 text-muted-foreground" />
          <h3 className="mb-2 text-lg font-semibold">{t("noDocuments.title")}</h3>
          <p className="mb-4 text-muted-foreground">
            {t("noDocuments.description")}
          </p>
          <Button onClick={handleOpenImport}>
            <Upload className="mr-2 h-4 w-4" />
            {t("import.button")}
          </Button>
        </div>
      ) : displayDocuments.length === 0 &&
        displayFolders.length === 0 &&
        isFiltering ? (
        <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center">
          <Search className="mb-4 h-12 w-12 text-muted-foreground" />
          <h3 className="mb-2 text-lg font-semibold">
            {t("noDocuments.noResults")}
          </h3>
          <p className="text-muted-foreground">
            {t("noDocuments.noResultsDescription", {
              search: debouncedSearch || currentTag || "",
            })}
          </p>
        </div>
      ) : (
        <>
          <DocumentExplorer
            documents={documents}
            folders={folders}
            currentFolderId={currentFolderId}
            breadcrumbPath={breadcrumbPath}
            viewMode={viewMode}
            sortField={sortField}
            sortDirection={sortDirection}
            flattenResults={isFiltering}
            availableTags={userTags}
            currentTag={currentTag}
            onTagChange={handleTagChange}
            onViewModeChange={setViewMode}
            onSortChange={handleSortChange}
            onFolderNavigate={handleFolderNavigate}
            onRefresh={loadDocuments}
            onCreateFolder={handleCreateFolder}
            onFilesDropped={handleFilesDropped}
            uploadingFiles={uploading}
          />

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-4">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground">
                {t("pagination.page", { current: page, total: totalPages })}
              </span>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </>
      )}

      {/* Universal import dialog (single entry point: every file type). */}
      <ImportDialog
        open={importDialogOpen}
        onOpenChange={(open) => {
          setImportDialogOpen(open);
          // Leaving the dialog discards the last batch's failure list.
          if (!open) setLastFailures(null);
        }}
        onFilesSelected={(files) => void processFiles(files)}
        uploading={uploading}
        progress={uploadProgress}
        failures={lastFailures}
        onCancel={handleCancelImport}
        destinationPath={getCurrentPath()}
      />

      {/* Blank document creation dialog (size + orientation → editor). */}
      <BlankDocumentDialog
        open={blankDialogOpen}
        onOpenChange={setBlankDialogOpen}
        onCreate={(options) => void handleCreateBlankDocument(options)}
        creating={creatingBlank}
      />
    </div>
  );
}
