"use client";

import {
  BookOpen,
  File,
  FileArchive,
  FileAudio,
  FileCode2,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Presentation,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

/** Semantic family of a stored document, resolved from mime type + filename. */
export type FileKind =
  | "pdf"
  | "word"
  | "excel"
  | "powerpoint"
  | "image"
  | "html"
  | "epub"
  | "markdown"
  | "text"
  | "archive"
  | "audio"
  | "video"
  | "json"
  | "unknown";

/** Exact (non-prefix) mime → kind. Prefix families (image/, audio/, video/) are handled in code. */
const MIME_KINDS: Record<string, FileKind> = {
  "application/pdf": "pdf",
  "application/msword": "word",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "word",
  "application/vnd.oasis.opendocument.text": "word",
  "application/rtf": "word",
  "text/rtf": "word",
  "application/vnd.ms-excel": "excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "excel",
  "application/vnd.oasis.opendocument.spreadsheet": "excel",
  "text/csv": "excel",
  "application/vnd.ms-powerpoint": "powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "powerpoint",
  "application/vnd.oasis.opendocument.presentation": "powerpoint",
  "text/html": "html",
  "application/xhtml+xml": "html",
  "application/epub+zip": "epub",
  "text/markdown": "markdown",
  "text/plain": "text",
  "application/zip": "archive",
  "application/x-zip-compressed": "archive",
  "application/x-tar": "archive",
  "application/gzip": "archive",
  "application/x-7z-compressed": "archive",
  "application/vnd.rar": "archive",
  "application/json": "json",
};

const EXTENSION_KINDS: Record<string, FileKind> = {
  pdf: "pdf",
  doc: "word",
  docx: "word",
  odt: "word",
  rtf: "word",
  xls: "excel",
  xlsx: "excel",
  ods: "excel",
  csv: "excel",
  ppt: "powerpoint",
  pptx: "powerpoint",
  odp: "powerpoint",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  bmp: "image",
  svg: "image",
  tif: "image",
  tiff: "image",
  avif: "image",
  heic: "image",
  html: "html",
  htm: "html",
  xhtml: "html",
  epub: "epub",
  md: "markdown",
  markdown: "markdown",
  txt: "text",
  log: "text",
  zip: "archive",
  tar: "archive",
  gz: "archive",
  tgz: "archive",
  "7z": "archive",
  rar: "archive",
  mp3: "audio",
  wav: "audio",
  ogg: "audio",
  m4a: "audio",
  flac: "audio",
  mp4: "video",
  mov: "video",
  avi: "video",
  mkv: "video",
  webm: "video",
  json: "json",
};

/**
 * Resolve the semantic file kind of a document. The mime type wins when it is
 * discriminating; generic mimes (octet-stream, missing) fall back to the
 * filename extension. GED rows always carry a `mime_type` (defaulted to
 * application/pdf server-side) but shares/legacy shapes only expose the name.
 */
export function resolveFileKind(
  mimeType?: string | null,
  name?: string | null,
): FileKind {
  const mime = mimeType?.trim().toLowerCase().split(";")[0] ?? "";
  if (mime && mime !== "application/octet-stream") {
    const exact = MIME_KINDS[mime];
    if (exact) return exact;
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("audio/")) return "audio";
    if (mime.startsWith("video/")) return "video";
  }
  const ext = name?.trim().toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (ext) {
    const byExt = EXTENSION_KINDS[ext];
    if (byExt) return byExt;
  }
  // A discriminating-but-unknown mime with no known extension stays unknown;
  // the historical GED default (no info at all) is a PDF.
  if (!mime && !ext) return "pdf";
  return "unknown";
}

const KIND_VISUALS: Record<FileKind, { Icon: LucideIcon; className: string }> = {
  pdf: { Icon: FileText, className: "text-red-500" },
  word: { Icon: FileText, className: "text-blue-600 dark:text-blue-400" },
  excel: { Icon: FileSpreadsheet, className: "text-emerald-600 dark:text-emerald-400" },
  powerpoint: { Icon: Presentation, className: "text-orange-500" },
  image: { Icon: FileImage, className: "text-violet-500" },
  html: { Icon: FileCode2, className: "text-sky-500" },
  epub: { Icon: BookOpen, className: "text-teal-600 dark:text-teal-400" },
  markdown: { Icon: FileText, className: "text-slate-500 dark:text-slate-400" },
  text: { Icon: FileText, className: "text-slate-500 dark:text-slate-400" },
  archive: { Icon: FileArchive, className: "text-amber-600 dark:text-amber-400" },
  audio: { Icon: FileAudio, className: "text-pink-500" },
  video: { Icon: FileVideo, className: "text-rose-500" },
  json: { Icon: FileJson, className: "text-cyan-600 dark:text-cyan-400" },
  unknown: { Icon: File, className: "text-muted-foreground" },
};

export interface FileTypeIconProps {
  /** Mime type as reported by the backend (`StoredDocument.mime_type`). */
  mimeType?: string | null;
  /** Filename — used as a fallback discriminator (extension). */
  name?: string | null;
  /** Size/layout classes; the kind colour is appended after (and wins on conflicts). */
  className?: string;
}

/**
 * Coloured file-type icon for GED surfaces (list, grid, trash, shares,
 * document detail). Decorative: the adjacent text carries the name, so the
 * icon is hidden from the accessibility tree.
 */
export function FileTypeIcon({
  mimeType,
  name,
  className,
}: FileTypeIconProps): React.JSX.Element {
  const { Icon, className: kindClass } = KIND_VISUALS[resolveFileKind(mimeType, name)];
  return (
    <Icon aria-hidden="true" className={cn("h-5 w-5", className, kindClass)} />
  );
}
