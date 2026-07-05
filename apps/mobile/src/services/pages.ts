/**
 * Pages Service
 * Page-level operations on a STORED document (GED).
 *
 * ── Migration note (2026-07) ────────────────────────────────────────────────
 * The old stateful FastAPI page API (`/api/v1/documents/{id}/pages/*`) was
 * REMOVED. Page editing is now performed with the stateless TypeScript PDF
 * engine exposed by Next.js at `POST /api/pdf/pages` (multipart PDF in → PDF
 * out), and the result is persisted as a new stored-document version via
 * `POST /api/v1/storage/documents/{id}/versions`.
 *
 * Every mutating method here therefore follows the same 3 hops:
 *   1. `storageService.downloadToFile(storedDocumentId)`  (load → download)
 *   2. `POST {BASE_URL}/api/pdf/pages`                     (engine transform)
 *   3. `POST /api/v1/storage/documents/{id}/versions`     (persist new version)
 *
 * `documentId` arguments are STORED document ids (the id used by the GED and
 * the editor screen), NOT the transient editing-session id.
 *
 * Operations whose backend was removed WITHOUT a current equivalent throw
 * {@link PagesServiceUnavailableError} rather than silently hitting a dead
 * route. The message documents the closest current capability.
 */

import { BASE_URL, tokenManager } from './api';
import { storageService, DocumentVersion } from './storageService';
import {
  Page,
  PagePreview,
  AddPageData,
  ReorderPagesData,
  RotatePageData,
  ExtractPagesData,
  Document,
} from './types';

// ============================================================================
// Errors
// ============================================================================

/**
 * Thrown by page operations whose backend route was removed and has no direct
 * mobile equivalent in the current architecture.
 */
export class PagesServiceUnavailableError extends Error {
  constructor(operation: string, alternative: string) {
    super(
      `Page operation "${operation}" is not available on mobile: the legacy ` +
        `stateful page API was removed. ${alternative}`
    );
    this.name = 'PagesServiceUnavailableError';
  }
}

// ============================================================================
// PDF engine plumbing (POST /api/pdf/pages)
// ============================================================================

type EnginePageOperation = 'add' | 'delete' | 'move' | 'rotate' | 'copy' | 'resize';

async function readErrorBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    try {
      const json = JSON.parse(text) as { error?: string; message?: string };
      return json.error || json.message || text;
    } catch {
      return text;
    }
  } catch {
    return response.statusText;
  }
}

/**
 * Download the stored PDF, apply a single page operation via the stateless PDF
 * engine, then persist the modified PDF as a new stored-document version.
 * The transformed bytes stay in memory as a Blob (no intermediate disk write).
 */
async function runPageEngineOperation(
  storedDocumentId: string,
  operation: EnginePageOperation,
  params: Record<string, unknown>,
  comment: string
): Promise<DocumentVersion> {
  const { localUri, session } = await storageService.downloadToFile(storedDocumentId);
  const token = await tokenManager.getAccessToken();
  const authHeaders: Record<string, string> = {
    Origin: BASE_URL,
    'X-Client-Type': 'mobile',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const fileName = session.name || 'document.pdf';

  // 1) Transform via the stateless PDF engine (Next.js /api/pdf/pages).
  // NOTE: do not set Content-Type — the runtime sets the multipart boundary.
  const engineForm = new FormData();
  engineForm.append('file', {
    uri: localUri,
    name: fileName,
    type: 'application/pdf',
  } as unknown as Blob);
  engineForm.append('operation', operation);
  engineForm.append('params', JSON.stringify(params));

  const engineResponse = await fetch(`${BASE_URL}/api/pdf/pages`, {
    method: 'POST',
    headers: authHeaders,
    body: engineForm,
  });
  if (!engineResponse.ok) {
    throw new Error(
      `PDF engine page operation "${operation}" failed (HTTP ${engineResponse.status}): ` +
        (await readErrorBody(engineResponse))
    );
  }
  const transformedPdf = await engineResponse.blob();

  // 2) Persist the modified PDF as a new stored-document version.
  const versionForm = new FormData();
  versionForm.append('file', transformedPdf, fileName);
  versionForm.append('comment', comment);

  const versionResponse = await fetch(
    `${BASE_URL}/api/v1/storage/documents/${storedDocumentId}/versions`,
    { method: 'POST', headers: authHeaders, body: versionForm }
  );
  if (!versionResponse.ok) {
    throw new Error(
      `Saving new document version failed (HTTP ${versionResponse.status}): ` +
        (await readErrorBody(versionResponse))
    );
  }
  const payload = (await versionResponse.json()) as { data?: DocumentVersion } & DocumentVersion;
  return payload.data ?? payload;
}

/** Normalise an arbitrary rotation delta to one of the engine-accepted values. */
function normaliseDegrees(rotation: number): 90 | 180 | 270 {
  const normalised = ((Math.round(rotation / 90) * 90) % 360 + 360) % 360;
  if (normalised === 90 || normalised === 180 || normalised === 270) {
    return normalised;
  }
  throw new Error(
    `Invalid rotation ${rotation}°: expected a non-zero multiple of 90 (90 | 180 | 270).`
  );
}

// ============================================================================
// Pages Service
// ============================================================================

export const pagesService = {
  // ==========================================================================
  // Migrated — implemented against the current PDF engine + versions API
  // ==========================================================================

  /**
   * Rotate a page (1-based) and save the result as a new version.
   * @returns The newly created document version.
   */
  async rotate(
    documentId: string,
    pageNumber: number,
    data: RotatePageData
  ): Promise<DocumentVersion> {
    const degrees = normaliseDegrees(data.rotation);
    return runPageEngineOperation(
      documentId,
      'rotate',
      { pageNumber, degrees, mode: 'delta' },
      `Rotated page ${pageNumber} by ${degrees}°`
    );
  },

  /**
   * Delete a page (1-based) and save the result as a new version.
   * @returns The newly created document version.
   */
  async delete(documentId: string, pageNumber: number): Promise<DocumentVersion> {
    return runPageEngineOperation(
      documentId,
      'delete',
      { pageNumber },
      `Deleted page ${pageNumber}`
    );
  },

  /**
   * Move a page from `pageNumber` (1-based) to `newPosition` (1-based).
   * @returns The newly created document version.
   */
  async move(
    documentId: string,
    pageNumber: number,
    newPosition: number
  ): Promise<DocumentVersion> {
    return runPageEngineOperation(
      documentId,
      'move',
      { fromPage: pageNumber, toPage: newPosition },
      `Moved page ${pageNumber} to position ${newPosition}`
    );
  },

  /**
   * Duplicate a page (1-based), inserting the copy after `position`
   * (defaults to right after the source page).
   * @returns The newly created document version.
   */
  async duplicate(
    documentId: string,
    pageNumber: number,
    position?: number
  ): Promise<DocumentVersion> {
    const insertAfter = position ?? pageNumber;
    return runPageEngineOperation(
      documentId,
      'copy',
      { pageNumber, insertAfter },
      `Duplicated page ${pageNumber}`
    );
  },

  /**
   * Resize a page (1-based) to the given dimensions (PDF points).
   * @returns The newly created document version.
   */
  async resize(
    documentId: string,
    pageNumber: number,
    width: number,
    height: number
  ): Promise<DocumentVersion> {
    return runPageEngineOperation(
      documentId,
      'resize',
      { pageNumber, width, height },
      `Resized page ${pageNumber}`
    );
  },

  /**
   * Insert a blank page. `position` is the 1-based page after which to insert
   * (omit to append). Defaults to A4 dimensions.
   * @returns The newly created document version.
   */
  async addBlank(
    documentId: string,
    position?: number,
    width = 595,
    height = 842
  ): Promise<DocumentVersion> {
    return runPageEngineOperation(
      documentId,
      'add',
      { afterPage: position, width, height },
      'Added blank page'
    );
  },

  // ==========================================================================
  // Removed backend — no direct mobile equivalent (documented, not silent)
  // ==========================================================================

  /**
   * @deprecated The per-page listing API was removed. Page count is available
   * from the stored document (`storageService.getDocument().page_count`); page
   * geometry is provided by react-native-pdf on load.
   */
  async list(_documentId: string): Promise<Page[]> {
    throw new PagesServiceUnavailableError(
      'list',
      'Use storageService.getDocument().page_count and render with react-native-pdf.'
    );
  },

  /** @deprecated The per-page details API was removed. */
  async get(_documentId: string, _pageNumber: number): Promise<Page> {
    throw new PagesServiceUnavailableError(
      'get',
      'Per-page metadata is no longer served; obtain dimensions from the PDF viewer on load.'
    );
  },

  /** @deprecated Server-side page previews were removed. */
  async getPreview(
    _documentId: string,
    _pageNumber: number,
    _width?: number,
    _height?: number
  ): Promise<PagePreview> {
    throw new PagesServiceUnavailableError(
      'getPreview',
      'Render pages locally with react-native-pdf, or use POST /api/pdf/preview.'
    );
  },

  /** @deprecated Server-side page previews were removed. */
  async downloadPreview(
    _documentId: string,
    _pageNumber: number,
    _width?: number,
    _height?: number
  ): Promise<string> {
    throw new PagesServiceUnavailableError(
      'downloadPreview',
      'Render pages locally with react-native-pdf, or use POST /api/pdf/preview.'
    );
  },

  /** @deprecated Server-side thumbnails were removed. */
  async getThumbnail(_documentId: string, _pageNumber: number): Promise<string> {
    throw new PagesServiceUnavailableError(
      'getThumbnail',
      'Use storageService document thumbnails, or POST /api/pdf/preview.'
    );
  },

  /**
   * @deprecated Inserting an external file as a page has no single current
   * endpoint. Merge documents with POST /api/pdf/merge-universal instead.
   */
  async add(
    _documentId: string,
    _data: AddPageData,
    _onProgress?: (progress: number) => void
  ): Promise<Document> {
    throw new PagesServiceUnavailableError(
      'add',
      'To insert an external file as page(s), use POST /api/pdf/merge-universal. For a blank page use addBlank().'
    );
  },

  /** @deprecated No batch endpoint. Call delete() per page (highest index first). */
  async deleteMultiple(_documentId: string, _pageNumbers: number[]): Promise<Document> {
    throw new PagesServiceUnavailableError(
      'deleteMultiple',
      'Call delete() for each page (delete highest page numbers first to keep indices stable).'
    );
  },

  /**
   * @deprecated Full reordering is a client-side scene-graph concern in the
   * current editor. Approximate with successive move() calls.
   */
  async reorder(_documentId: string, _data: ReorderPagesData): Promise<Document> {
    throw new PagesServiceUnavailableError(
      'reorder',
      'Use successive move() operations, or the web editor scene graph.'
    );
  },

  /** @deprecated No batch endpoint. Call rotate() per page. */
  async rotateMultiple(
    _documentId: string,
    _pageNumbers: number[],
    _rotation: number
  ): Promise<Document> {
    throw new PagesServiceUnavailableError(
      'rotateMultiple',
      'Call rotate() for each page number.'
    );
  },

  /**
   * @deprecated Extraction to a new document was removed here. Split the PDF
   * with POST /api/pdf/split and re-upload the result via storageService.
   */
  async extract(_documentId: string, _data: ExtractPagesData): Promise<Document> {
    throw new PagesServiceUnavailableError(
      'extract',
      'Use POST /api/pdf/split then storageService.uploadDocument() for the extracted range.'
    );
  },

  /**
   * @deprecated Replacing a single page in place has no current endpoint.
   */
  async replace(
    _documentId: string,
    _pageNumber: number,
    _file: unknown,
    _onProgress?: (progress: number) => void
  ): Promise<Document> {
    throw new PagesServiceUnavailableError(
      'replace',
      'Delete the page then insert the replacement (merge-universal), or edit via the web editor.'
    );
  },

  /** @deprecated Per-page crop was removed; no current mobile endpoint. */
  async crop(
    _documentId: string,
    _pageNumber: number,
    _cropData: { x: number; y: number; width: number; height: number }
  ): Promise<Page> {
    throw new PagesServiceUnavailableError('crop', 'No current endpoint; use the web editor.');
  },

  /** @deprecated Per-page text extraction was removed; use POST /api/pdf/ocr. */
  async extractText(_documentId: string, _pageNumber: number): Promise<string> {
    throw new PagesServiceUnavailableError(
      'extractText',
      'Use POST /api/pdf/ocr (output=text) on the PDF.'
    );
  },

  /** @deprecated Per-page image extraction was removed; no current endpoint. */
  async extractImages(_documentId: string, _pageNumber: number): Promise<string[]> {
    throw new PagesServiceUnavailableError(
      'extractImages',
      'No current endpoint; parse the PDF with the pdf-engine on the web app.'
    );
  },

  /** @deprecated Per-page dimensions come from the PDF viewer on load now. */
  async getDimensions(
    _documentId: string,
    _pageNumber: number
  ): Promise<{ width: number; height: number; orientation: string }> {
    throw new PagesServiceUnavailableError(
      'getDimensions',
      'Read dimensions from the react-native-pdf onLoadComplete callback.'
    );
  },

  /**
   * @deprecated Single-page image export was removed. POST /api/pdf/to-image
   * rasterises the whole PDF to a ZIP of PNGs.
   */
  async convertToImage(
    _documentId: string,
    _pageNumber: number,
    _format: 'png' | 'jpg' | 'webp' = 'png',
    _quality = 90,
    _dpi = 150
  ): Promise<string> {
    throw new PagesServiceUnavailableError(
      'convertToImage',
      'Use POST /api/pdf/to-image (rasterises all pages to a ZIP of PNGs).'
    );
  },

  /** @deprecated Page comparison was removed; no current endpoint. */
  async compare(
    _documentId1: string,
    _pageNumber1: number,
    _documentId2: string,
    _pageNumber2: number
  ): Promise<{
    differences: Array<{ type: string; position: unknown; description: string }>;
    similarity_score: number;
  }> {
    throw new PagesServiceUnavailableError('compare', 'No current endpoint.');
  },

  /** @deprecated Per-page filters were removed; no current endpoint. */
  async applyFilter(
    _documentId: string,
    _pageNumber: number,
    _filter: 'grayscale' | 'sepia' | 'invert' | 'brightness' | 'contrast',
    _intensity = 100
  ): Promise<Page> {
    throw new PagesServiceUnavailableError('applyFilter', 'No current endpoint.');
  },
};

export default pagesService;
