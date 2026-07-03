/**
 * Pure helpers for the unified GED import flow (no React, no DOM, no network).
 *
 * The GED accepts ANY file type now: the original bytes are stored as-is
 * (no client-side Office→PDF conversion). Validation is therefore limited to
 * a size cap that matches the storage backend (`_FILE_SIZE_LIMIT` = 250 MB)
 * and a non-empty check. Format-specific enrichment (PDF thumbnail + text
 * extraction) is decided downstream from `isPdfFile`.
 *
 * Everything here is unit-tested (see `__tests__/document-import.test.ts`).
 */

/** Storage backend hard cap (POST /api/v1/storage/documents → 413 above this). */
export const MAX_IMPORT_FILE_SIZE_BYTES = 250 * 1024 * 1024;

/**
 * Bounded concurrency: at most 3 full upload pipelines in flight. Unbounded
 * `Promise.allSettled` would open one pipeline (upload + optional enrich) per
 * file and overwhelm the backend on large drops; sequential is too slow.
 */
export const IMPORT_CONCURRENCY = 3;

/** A single file accepted for import (validation passed). */
export interface ImportValidationOk {
  ok: true;
}

/** A single file rejected client-side, with an i18n key for the reason. */
export interface ImportValidationError {
  ok: false;
  /** i18n key under `documents.import.*` describing the rejection. */
  reasonKey: "errorEmpty" | "errorTooLarge";
}

export type ImportValidation = ImportValidationOk | ImportValidationError;

/**
 * Validate a file for the universal import. ALL formats are allowed — only an
 * empty file or one exceeding the storage size cap is rejected. Returns an
 * i18n key (not a translated string) so callers control the wording/locale.
 */
export function validateImportFile(
  file: { size: number },
  maxBytes: number = MAX_IMPORT_FILE_SIZE_BYTES,
): ImportValidation {
  if (file.size <= 0) {
    return { ok: false, reasonKey: "errorEmpty" };
  }
  if (file.size > maxBytes) {
    return { ok: false, reasonKey: "errorTooLarge" };
  }
  return { ok: true };
}

/** Lowercase file extension WITHOUT the dot, or "" when there is none. */
export function getFileExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) return "";
  return fileName.slice(dotIndex + 1).toLowerCase();
}

/**
 * True when the file is a PDF (by extension or MIME). PDFs get the extra
 * first-page thumbnail render + full-text extraction; other formats are
 * stored as-is without that PDF-only enrichment.
 */
export function isPdfFile(file: { name: string; type?: string }): boolean {
  return getFileExtension(file.name) === "pdf" || file.type === "application/pdf";
}

/**
 * Office (and RTF) import formats convertible to an editable PDF on upload.
 *
 * The OOXML/OLE2/ODF entries MIRROR `OFFICE_IMPORT_FORMATS` from
 * `@giga-pdf/pdf-engine` (`convert/office-headless.ts`) — kept as a local
 * literal so this module stays pure (no WASM engine import, which would break
 * the jsdom unit test). The conversion route (`/api/office/upload`) is the
 * type-checked gate against the engine's `OfficeImportFormat`; this list only
 * decides client-side routing.
 *
 * NOTE: `rtf` is included — `/api/office/upload` accepts it (magic `{\rtf`) and
 * converts it via the engine's `rtfToPdf`. RTF therefore becomes an editable PDF
 * on upload instead of being dead-stored as raw text.
 */
const OFFICE_CONVERT_EXTENSIONS = new Set([
  "docx",
  "xlsx",
  "pptx",
  "doc",
  "xls",
  "ppt",
  "odt",
  "ods",
  "odp",
  "rtf",
]);

/**
 * True when the file is an Office (or RTF) document that should be converted to
 * PDF on upload (so it becomes editable in the editor). Detected by extension
 * only; the conversion route re-validates the container/RTF magic bytes
 * server-side.
 */
export function isOfficeFile(file: { name: string }): boolean {
  return OFFICE_CONVERT_EXTENSIONS.has(getFileExtension(file.name));
}

/**
 * Raster image formats convertible to a single-page editable PDF on upload.
 *
 * MIRRORS the engine's `imageToPdf` supported formats
 * (PNG/JPEG/GIF/WebP/AVIF/TIFF). On upload they are raised to a PDF
 * (`/api/convert/image` → native WASM `imageToPdf`) so they open as an editable
 * page in the editor instead of being dead-stored as raw image bytes. The
 * conversion route re-validates the image magic bytes server-side.
 */
const IMAGE_CONVERT_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "tif",
  "tiff",
]);

/**
 * True when the file is a raster image that should be converted to PDF on upload
 * (so it becomes editable in the editor). Detected by extension only; the
 * conversion route re-validates the image magic bytes server-side.
 */
export function isImageFile(file: { name: string }): boolean {
  return IMAGE_CONVERT_EXTENSIONS.has(getFileExtension(file.name));
}

/**
 * Text-model import formats convertible to an editable PDF on upload.
 *
 * Markdown (`md`/`markdown`) and CSV are plain UTF-8 text files (no binary
 * container). On upload they are lowered into the engine's unified document
 * model and raised to a PDF (`mdToModel`/`csvToModel` → `modelToPdf`) so they
 * open as editable pages in the editor instead of failing to parse as a PDF.
 *
 * The conversion route (`/api/convert/text-format`) is the type-checked gate
 * against the engine's `convertMarkdownToPdf`/`convertCsvToPdf`; this list only
 * decides client-side routing.
 */
const TEXT_MODEL_CONVERT_EXTENSIONS = new Set(['md', 'markdown', 'csv']);

/**
 * True when the file is a Markdown or CSV document that should be converted to
 * PDF on upload (so it becomes editable in the editor). Detected by extension
 * only; the conversion route re-validates server-side.
 */
export function isTextModelFile(file: { name: string }): boolean {
  return TEXT_MODEL_CONVERT_EXTENSIONS.has(getFileExtension(file.name));
}

/** Strip a single trailing extension from a file name for the stored title. */
export function stripExtension(fileName: string): string {
  const ext = getFileExtension(fileName);
  if (!ext) return fileName;
  return fileName.slice(0, fileName.length - ext.length - 1);
}

/**
 * Run `worker` over `items` with at most `concurrency` runners in flight.
 * Results preserve input order. Each worker is expected to resolve (never
 * reject) so one bad item cannot abort the batch.
 */
export async function runWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let nextIndex = 0;

  const runner = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await worker(item, index);
    }
  };

  const poolSize = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: poolSize }, () => runner()));
  return results;
}

// ---------------------------------------------------------------------------
// Byte-accurate batch progress model (pure, immutable, unit-tested).
//
// The old model counted settled FILES (done/total): with a single large file
// the bar sat at 0% for the whole transfer then jumped to 100%. This model
// weights every file by its byte size and tracks a 0..1 upload fraction per
// file, so the global percent moves with the actual bytes sent.
// ---------------------------------------------------------------------------

/** Immutable snapshot of a batch import's progress. */
export interface BatchUploadProgress {
  /** Files fully settled (success OR failure). */
  done: number;
  /** Total files in the batch. */
  total: number;
  /** Sum of the original file sizes (bytes) — the progress weights. */
  totalBytes: number;
  /** Original file names, by batch index. */
  fileNames: readonly string[];
  /** Original file sizes (bytes), by batch index. */
  fileSizes: readonly number[];
  /** Monotonic 0..1 upload fraction per file, by batch index. */
  fileFractions: readonly number[];
  /** Index of the most recently started file (for the "uploading X…" label). */
  currentIndex: number | null;
}

/** Fresh progress snapshot for a new batch. */
export function createBatchProgress(
  files: ReadonlyArray<{ name: string; size: number }>,
): BatchUploadProgress {
  const fileSizes = files.map((file) => Math.max(0, file.size));
  return {
    done: 0,
    total: files.length,
    totalBytes: fileSizes.reduce((acc, size) => acc + size, 0),
    fileNames: files.map((file) => file.name),
    fileSizes,
    fileFractions: files.map(() => 0),
    currentIndex: files.length > 0 ? 0 : null,
  };
}

/** Mark a file as the one currently in flight (drives the file-name label). */
export function progressWithCurrentFile(
  progress: BatchUploadProgress,
  index: number,
): BatchUploadProgress {
  if (progress.currentIndex === index) return progress;
  return { ...progress, currentIndex: index };
}

/**
 * Record an upload fraction (0..1) for one file. Monotonic: a fraction lower
 * than the recorded one is ignored, so a two-phase pipeline (conversion upload
 * then store upload) can never make the global bar move backwards.
 */
export function progressWithFileFraction(
  progress: BatchUploadProgress,
  index: number,
  fraction: number,
): BatchUploadProgress {
  const previous = progress.fileFractions[index] ?? 0;
  const next = Math.min(1, Math.max(previous, fraction));
  if (next === previous) return progress;
  return {
    ...progress,
    fileFractions: progress.fileFractions.map((value, i) =>
      i === index ? next : value,
    ),
  };
}

/** Mark a file as settled (success or failure): fraction 1, done + 1. */
export function progressWithFileSettled(
  progress: BatchUploadProgress,
  index: number,
): BatchUploadProgress {
  return {
    ...progress,
    done: progress.done + 1,
    fileFractions: progress.fileFractions.map((value, i) =>
      i === index ? 1 : value,
    ),
  };
}

/**
 * Global completion percent (0–100), weighted by file bytes. Falls back to
 * per-file granularity when no byte total is known (all zero-size weights).
 */
export function batchPercent(progress: BatchUploadProgress): number {
  if (progress.total === 0) return 0;
  if (progress.totalBytes <= 0) {
    return Math.round((progress.done / progress.total) * 100);
  }
  const loadedBytes = progress.fileSizes.reduce(
    (acc, size, index) => acc + size * (progress.fileFractions[index] ?? 0),
    0,
  );
  return Math.round(Math.min(1, loadedBytes / progress.totalBytes) * 100);
}

/** Name of the file currently in flight, or null when unknown. */
export function batchCurrentFileName(
  progress: BatchUploadProgress,
): string | null {
  if (progress.currentIndex === null) return null;
  return progress.fileNames[progress.currentIndex] ?? null;
}

/** Outcome of importing one file (never throws). */
export type ImportOutcome =
  | { ok: true; name: string }
  | { ok: false; name: string; reason: string };

/** Aggregate counts + named failures for the end-of-batch summary toast. */
export interface ImportSummary {
  successCount: number;
  failures: Array<{ name: string; reason: string }>;
}

/** Reduce per-file outcomes into a summary for toast rendering. */
export function summarizeOutcomes(
  outcomes: readonly ImportOutcome[],
): ImportSummary {
  const failures = outcomes
    .filter((o): o is Extract<ImportOutcome, { ok: false }> => !o.ok)
    .map((o) => ({ name: o.name, reason: o.reason }));
  return { successCount: outcomes.length - failures.length, failures };
}
