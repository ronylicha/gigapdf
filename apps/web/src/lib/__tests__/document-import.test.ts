import { describe, expect, it } from "vitest";
import {
  IMPORT_CONCURRENCY,
  MAX_IMPORT_FILE_SIZE_BYTES,
  batchCurrentFileName,
  batchPercent,
  createBatchProgress,
  getFileExtension,
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
  type ImportOutcome,
} from "../document-import";

describe("validateImportFile", () => {
  it("accepts any non-empty file within the size cap", () => {
    expect(validateImportFile({ size: 1 })).toEqual({ ok: true });
    expect(validateImportFile({ size: MAX_IMPORT_FILE_SIZE_BYTES })).toEqual({
      ok: true,
    });
  });

  it("rejects an empty file with errorEmpty", () => {
    expect(validateImportFile({ size: 0 })).toEqual({
      ok: false,
      reasonKey: "errorEmpty",
    });
  });

  it("rejects a file above the cap with errorTooLarge", () => {
    expect(validateImportFile({ size: MAX_IMPORT_FILE_SIZE_BYTES + 1 })).toEqual(
      { ok: false, reasonKey: "errorTooLarge" },
    );
  });

  it("honors a custom max size", () => {
    expect(validateImportFile({ size: 11 }, 10)).toEqual({
      ok: false,
      reasonKey: "errorTooLarge",
    });
    expect(validateImportFile({ size: 10 }, 10)).toEqual({ ok: true });
  });

  it("does NOT reject by format — every type passes the size check", () => {
    // A .exe, .zip, .png, .docx — all accepted as long as size is valid.
    for (const size of [1, 1024, 50 * 1024 * 1024]) {
      expect(validateImportFile({ size }).ok).toBe(true);
    }
  });
});

describe("getFileExtension", () => {
  it("returns the lowercase extension without the dot", () => {
    expect(getFileExtension("report.PDF")).toBe("pdf");
    expect(getFileExtension("Archive.Final.DOCX")).toBe("docx");
  });

  it("returns empty string when there is no usable extension", () => {
    expect(getFileExtension("README")).toBe("");
    expect(getFileExtension(".gitignore")).toBe(""); // dot at index 0
    expect(getFileExtension("trailingdot.")).toBe("");
  });
});

describe("isPdfFile", () => {
  it("detects PDFs by extension (case-insensitive)", () => {
    expect(isPdfFile({ name: "a.pdf" })).toBe(true);
    expect(isPdfFile({ name: "A.PDF" })).toBe(true);
  });

  it("detects PDFs by MIME when the extension is missing", () => {
    expect(isPdfFile({ name: "noext", type: "application/pdf" })).toBe(true);
  });

  it("returns false for non-PDF files", () => {
    expect(isPdfFile({ name: "sheet.xlsx" })).toBe(false);
    expect(isPdfFile({ name: "image.png", type: "image/png" })).toBe(false);
  });
});

describe("isOfficeFile", () => {
  it("detects every supported Office format (case-insensitive)", () => {
    for (const ext of [
      "docx",
      "xlsx",
      "pptx",
      "doc",
      "xls",
      "ppt",
      "odt",
      "ods",
      "odp",
    ]) {
      expect(isOfficeFile({ name: `report.${ext}` })).toBe(true);
      expect(isOfficeFile({ name: `report.${ext.toUpperCase()}` })).toBe(true);
    }
  });

  it("returns false for PDFs, images and other formats", () => {
    expect(isOfficeFile({ name: "doc.pdf" })).toBe(false);
    expect(isOfficeFile({ name: "image.png" })).toBe(false);
    expect(isOfficeFile({ name: "archive.zip" })).toBe(false);
    expect(isOfficeFile({ name: "NOEXT" })).toBe(false);
  });

  it("treats rtf as convertible (the Office route renders it via rtfToPdf)", () => {
    expect(isOfficeFile({ name: "letter.rtf" })).toBe(true);
    expect(isOfficeFile({ name: "LETTER.RTF" })).toBe(true);
  });
});

describe("isImageFile", () => {
  it("detects every supported raster image format (case-insensitive)", () => {
    for (const ext of ["png", "jpg", "jpeg", "gif", "webp", "avif"]) {
      expect(isImageFile({ name: `photo.${ext}` })).toBe(true);
      expect(isImageFile({ name: `photo.${ext.toUpperCase()}` })).toBe(true);
    }
  });

  it("returns false for PDFs, Office docs, text and other formats", () => {
    expect(isImageFile({ name: "doc.pdf" })).toBe(false);
    expect(isImageFile({ name: "report.docx" })).toBe(false);
    expect(isImageFile({ name: "letter.rtf" })).toBe(false);
    expect(isImageFile({ name: "notes.md" })).toBe(false);
    expect(isImageFile({ name: "image.svg" })).toBe(false); // vector, not raster
    expect(isImageFile({ name: "image.bmp" })).toBe(false); // unsupported by engine
    expect(isImageFile({ name: "NOEXT" })).toBe(false);
  });

  it("is disjoint from the Office and text-model branches", () => {
    for (const name of ["photo.png", "scan.jpeg", "anim.gif", "shot.webp"]) {
      expect(isImageFile({ name })).toBe(true);
      expect(isOfficeFile({ name })).toBe(false);
      expect(isTextModelFile({ name })).toBe(false);
    }
  });
});

describe("isTextModelFile", () => {
  it("detects Markdown and CSV (case-insensitive)", () => {
    for (const ext of ["md", "markdown", "csv"]) {
      expect(isTextModelFile({ name: `notes.${ext}` })).toBe(true);
      expect(isTextModelFile({ name: `notes.${ext.toUpperCase()}` })).toBe(true);
    }
  });

  it("returns false for PDFs, Office docs, images and other formats", () => {
    expect(isTextModelFile({ name: "doc.pdf" })).toBe(false);
    expect(isTextModelFile({ name: "report.docx" })).toBe(false);
    expect(isTextModelFile({ name: "sheet.xlsx" })).toBe(false);
    expect(isTextModelFile({ name: "image.png" })).toBe(false);
    expect(isTextModelFile({ name: "letter.rtf" })).toBe(false);
    expect(isTextModelFile({ name: "plain.txt" })).toBe(false);
    expect(isTextModelFile({ name: "NOEXT" })).toBe(false);
  });

  it("is disjoint from isOfficeFile (a file matches at most one branch)", () => {
    for (const name of ["notes.md", "data.csv", "readme.markdown"]) {
      expect(isTextModelFile({ name })).toBe(true);
      expect(isOfficeFile({ name })).toBe(false);
    }
  });
});

describe("stripExtension", () => {
  it("removes a single trailing extension", () => {
    expect(stripExtension("invoice.pdf")).toBe("invoice");
    expect(stripExtension("data.tar.gz")).toBe("data.tar");
  });

  it("returns the name unchanged when there is no extension", () => {
    expect(stripExtension("LICENSE")).toBe("LICENSE");
  });
});

describe("runWithConcurrency", () => {
  it("processes every item and preserves input order", async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await runWithConcurrency(items, 2, async (n) => n * 10);
    expect(results).toEqual([10, 20, 30, 40, 50]);
  });

  it("never exceeds the requested concurrency", async () => {
    let active = 0;
    let peak = 0;
    const items = Array.from({ length: 12 }, (_, i) => i);
    await runWithConcurrency(items, 3, async (n) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return n;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("handles an empty list", async () => {
    expect(await runWithConcurrency([], IMPORT_CONCURRENCY, async (n) => n)).toEqual(
      [],
    );
  });

  it("caps the pool size to the item count for tiny batches", async () => {
    let active = 0;
    let peak = 0;
    await runWithConcurrency([1], 10, async (n) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 2));
      active -= 1;
      return n;
    });
    expect(peak).toBe(1);
  });
});

describe("summarizeOutcomes", () => {
  it("counts all-success batches with no failures", () => {
    const outcomes: ImportOutcome[] = [
      { ok: true, name: "a.pdf" },
      { ok: true, name: "b.docx" },
    ];
    expect(summarizeOutcomes(outcomes)).toEqual({
      successCount: 2,
      failures: [],
    });
  });

  it("collects named failures alongside the success count", () => {
    const outcomes: ImportOutcome[] = [
      { ok: true, name: "ok.pdf" },
      { ok: false, name: "bad.zip", reason: "File too large" },
      { ok: false, name: "empty.txt", reason: "The file is empty" },
    ];
    expect(summarizeOutcomes(outcomes)).toEqual({
      successCount: 1,
      failures: [
        { name: "bad.zip", reason: "File too large" },
        { name: "empty.txt", reason: "The file is empty" },
      ],
    });
  });

  it("reports zero successes when everything fails", () => {
    const outcomes: ImportOutcome[] = [
      { ok: false, name: "x", reason: "boom" },
    ];
    const summary = summarizeOutcomes(outcomes);
    expect(summary.successCount).toBe(0);
    expect(summary.failures).toHaveLength(1);
  });
});

describe("batch upload progress model (byte-accurate)", () => {
  const files = [
    { name: "small.pdf", size: 100 },
    { name: "big.pdf", size: 300 },
  ];

  it("createBatchProgress initializes counters, weights and fractions", () => {
    const progress = createBatchProgress(files);
    expect(progress.done).toBe(0);
    expect(progress.total).toBe(2);
    expect(progress.totalBytes).toBe(400);
    expect(progress.fileNames).toEqual(["small.pdf", "big.pdf"]);
    expect(progress.fileSizes).toEqual([100, 300]);
    expect(progress.fileFractions).toEqual([0, 0]);
    expect(progress.currentIndex).toBe(0);
    expect(batchPercent(progress)).toBe(0);
  });

  it("weights the global percent by CUMULATED BYTES, not by file count", () => {
    // small.pdf fully sent (100 B), big.pdf half sent (150 B of 300 B):
    // (100 + 150) / 400 = 62.5% → 63. A per-file counter would say 50%.
    let progress = createBatchProgress(files);
    progress = progressWithFileFraction(progress, 0, 1);
    progress = progressWithFileFraction(progress, 1, 0.5);
    expect(batchPercent(progress)).toBe(63);
  });

  it("moves with a SINGLE large file (the historical stuck-at-0% bug)", () => {
    let progress = createBatchProgress([{ name: "huge.pdf", size: 1_000 }]);
    expect(batchPercent(progress)).toBe(0);
    progress = progressWithFileFraction(progress, 0, 0.4);
    expect(batchPercent(progress)).toBe(40);
    progress = progressWithFileFraction(progress, 0, 0.9);
    expect(batchPercent(progress)).toBe(90);
  });

  it("fractions are monotonic: a two-phase pipeline never moves the bar backwards", () => {
    let progress = createBatchProgress(files);
    progress = progressWithFileFraction(progress, 0, 0.8);
    // Conversion done, the store upload restarts its own byte counter at 0.
    progress = progressWithFileFraction(progress, 0, 0.2);
    expect(progress.fileFractions[0]).toBe(0.8);
  });

  it("clamps fractions to 1", () => {
    let progress = createBatchProgress(files);
    progress = progressWithFileFraction(progress, 0, 3);
    expect(progress.fileFractions[0]).toBe(1);
  });

  it("progressWithFileSettled bumps done and forces the fraction to 1", () => {
    let progress = createBatchProgress(files);
    progress = progressWithFileFraction(progress, 0, 0.3);
    progress = progressWithFileSettled(progress, 0);
    expect(progress.done).toBe(1);
    expect(progress.fileFractions[0]).toBe(1);
    expect(batchPercent(progress)).toBe(25); // 100/400 bytes
  });

  it("progressWithCurrentFile drives the file-name label", () => {
    let progress = createBatchProgress(files);
    progress = progressWithCurrentFile(progress, 1);
    expect(batchCurrentFileName(progress)).toBe("big.pdf");
  });

  it("returns the same reference when nothing changes (no useless re-render)", () => {
    const progress = createBatchProgress(files);
    expect(progressWithFileFraction(progress, 0, 0)).toBe(progress);
    expect(progressWithCurrentFile(progress, 0)).toBe(progress);
  });

  it("falls back to per-file granularity when no byte total is known", () => {
    let progress = createBatchProgress([
      { name: "a", size: 0 },
      { name: "b", size: 0 },
    ]);
    expect(batchPercent(progress)).toBe(0);
    progress = progressWithFileSettled(progress, 0);
    expect(batchPercent(progress)).toBe(50);
  });

  it("is immutable: updates never touch the previous snapshot", () => {
    const progress = createBatchProgress(files);
    const updated = progressWithFileFraction(progress, 0, 0.5);
    expect(progress.fileFractions).toEqual([0, 0]);
    expect(updated.fileFractions).toEqual([0.5, 0]);
  });
});
