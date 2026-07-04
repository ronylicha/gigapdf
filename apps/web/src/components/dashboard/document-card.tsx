"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Input,
  Label,
  ToastAction,
  useToast,
} from "@giga-pdf/ui";
import { formatDate, formatBytes } from "@/lib/utils";
import { FileTypeIcon } from "./file-type-icon";
import {
  Trash2,
  Download,
  Loader2,
  ExternalLink,
  MoreVertical,
  Eye,
  FileSpreadsheet,
  FileType,
  Copy,
  Image,
  Share2,
  Pencil,
  CheckSquare,
  Square,
  Tags,
  Hash,
  BookOpen,
  ScanText,
  Presentation,
  Wrench,
  Minimize2,
  Lock,
  PenLine,
  Droplet,
  FileCheck2,
  Scissors,
  Wand2,
} from "lucide-react";
import { api } from "@/lib/api";
import { DragItem } from "./document-explorer";
import { cn } from "@/lib/utils";
import { ShareDialog } from "@/components/sharing";
import { clientLogger } from "@/lib/client-logger";
import { triggerBlobDownload } from "./blob-download";
import {
  downloadDocumentBytes,
  convertDocumentBytes,
  type DashboardExportFormat,
} from "./download-document-bytes";
import { TagChips } from "./tag-input";
import { ManageTagsDialog } from "./manage-tags-dialog";
import { GedOcrDialog } from "./ged-ocr-dialog";
import { GedOrganizeDialog } from "./ged-organize-dialog";
import {
  GedTransformDialog,
  type GedTransform,
} from "./ged-transform-dialog";

interface DocumentCardProps {
  id: string;
  name: string;
  size: number;
  createdAt: Date;
  updatedAt: Date;
  tags?: string[];
  thumbnailUrl?: string | null;
  mimeType?: string | null;
  onDelete?: () => void;
  onRename?: (newName: string) => void;
  /** Refresh callback after duplicate / tags update. */
  onChanged?: () => void;
  onDragStart?: (item: DragItem) => void;
  onDragEnd?: () => void;
  isDragging?: boolean;
  selectionMode?: boolean;
  isSelected?: boolean;
  onSelect?: () => void;
}

export function DocumentCard({
  id,
  name,
  size,
  createdAt,
  updatedAt,
  tags = [],
  thumbnailUrl = null,
  mimeType = null,
  onDelete,
  onRename,
  onChanged,
  onDragStart,
  onDragEnd,
  isDragging,
  selectionMode = false,
  isSelected = false,
  onSelect,
}: DocumentCardProps) {
  const router = useRouter();
  const t = useTranslations("documents.card");
  const tToasts = useTranslations("documents.toasts");
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [documentName, setDocumentName] = useState(name);

  // Dialog states
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [tagsDialogOpen, setTagsDialogOpen] = useState(false);
  const [ocrDialogOpen, setOcrDialogOpen] = useState(false);
  const [organizeDialogOpen, setOrganizeDialogOpen] = useState(false);
  // Active PDF→PDF transform; non-null opens the transform dialog.
  const [activeTransform, setActiveTransform] = useState<GedTransform | null>(
    null,
  );

  // Loading states
  const [deleting, setDeleting] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [duplicating, setDuplicating] = useState(false);

  // Data states
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // Tracks the in-memory object URL backing the preview iframe so we can revoke
  // it (avoid leaking blobs) on close and on unmount.
  const previewUrlRef = useRef<string | null>(null);
  const [newName, setNewName] = useState(name);

  // Revoke any outstanding preview object URL when the card unmounts.
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
    };
  }, []);

  // Close the preview and release its object URL (covers the footer button and
  // the dialog's own dismiss paths — Esc, overlay click).
  const closePreview = () => {
    setPreviewOpen(false);
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewUrl(null);
  };
  // Presigned thumbnail URLs can expire (7 days): fall back to the icon.
  const [thumbnailBroken, setThumbnailBroken] = useState(false);

  const handleOpenEditor = async () => {
    // Navigate to editor with stored document ID (not session ID)
    router.push(`/editor/${id}`);
  };

  const handleDownload = async () => {
    try {
      setLoading(true);
      // Fetch the bytes through the authenticated flow (Authorization: Bearer)
      // rather than a bare URL — the backend only authenticates via the bearer
      // token, so a direct window.open() 404s under an owned session.
      const bytes = await downloadDocumentBytes(id);
      triggerBlobDownload(
        new Blob([bytes as BlobPart], { type: "application/pdf" }),
        `${documentName}.pdf`,
      );
    } catch (err) {
      clientLogger.error("document-card.download-failed", err);
      alert(t("errors.downloadFailed"));
    } finally {
      setLoading(false);
    }
  };

  // Soft delete: the document goes to the trash (restorable for 30 days).
  // The toast carries an inline "Undo" action that restores it on the spot.
  const handleDelete = async () => {
    try {
      setDeleting(true);
      await api.deleteDocument(id);
      setDeleteDialogOpen(false);
      onDelete?.();
      toast({
        title: tToasts("movedToTrash"),
        description: documentName,
        action: (
          <ToastAction
            altText={tToasts("movedToTrashUndo")}
            onClick={async () => {
              try {
                await api.restoreDocument(id);
                toast({ title: tToasts("restored") });
                onDelete?.();
              } catch (restoreErr) {
                clientLogger.error("document-card.restore-failed", restoreErr);
                toast({
                  variant: "destructive",
                  title: tToasts("restoreFailed"),
                });
              }
            }}
          >
            {tToasts("movedToTrashUndo")}
          </ToastAction>
        ),
      });
    } catch (err) {
      clientLogger.error("document-card.delete-failed", err);
      alert(t("errors.deleteFailed"));
    } finally {
      setDeleting(false);
    }
  };

  const handleDuplicate = async () => {
    try {
      setDuplicating(true);
      const copy = await api.duplicateDocument(id);
      toast({ title: tToasts("duplicated", { name: copy.name }) });
      onChanged?.();
    } catch (err) {
      clientLogger.error("document-card.duplicate-failed", err);
      toast({ variant: "destructive", title: tToasts("duplicateFailed") });
    } finally {
      setDuplicating(false);
    }
  };

  const handleRename = async () => {
    if (!newName.trim() || newName === documentName) {
      setRenameDialogOpen(false);
      return;
    }

    try {
      setRenaming(true);
      await api.renameDocument(id, newName.trim());
      setDocumentName(newName.trim());
      setRenameDialogOpen(false);
      onRename?.(newName.trim());
    } catch (err) {
      clientLogger.error("document-card.rename-failed", err);
      alert(t("errors.renameFailed"));
    } finally {
      setRenaming(false);
    }
  };

  const handlePreview = async () => {
    try {
      setPreviewLoading(true);
      setPreviewOpen(true);
      // Same reason as download: the iframe can't carry the bearer token, so we
      // fetch the bytes authenticated and feed the iframe an in-memory object URL.
      const bytes = await downloadDocumentBytes(id);
      // Release a previous preview URL before replacing it (avoid leak).
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
      const objectUrl = URL.createObjectURL(
        new Blob([bytes as BlobPart], { type: "application/pdf" }),
      );
      previewUrlRef.current = objectUrl;
      setPreviewUrl(objectUrl);
    } catch (err) {
      clientLogger.error("document-card.preview-failed", err);
      alert(t("errors.previewFailed"));
      setPreviewOpen(false);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleShare = () => {
    setShareDialogOpen(true);
  };

  const handleExport = async (format: DashboardExportFormat) => {
    try {
      setExporting(true);
      setExportDialogOpen(true);

      // Fetch the stored document's bytes and convert entirely client-side via
      // the GigaPDF SDK (no backend job): images → per-page .zip, docx/xlsx/html
      // via the SDK exporter, txt via text extraction.
      const bytes = await downloadDocumentBytes(id);
      const { blob, extension } = await convertDocumentBytes(bytes, format);
      triggerBlobDownload(blob, `${documentName}.${extension}`);

      setExportDialogOpen(false);
    } catch (err) {
      clientLogger.error("document-card.export-failed", err);
      alert(t("errors.exportFailed"));
      setExportDialogOpen(false);
    } finally {
      setExporting(false);
    }
  };

  const openRenameDialog = () => {
    setNewName(documentName);
    setRenameDialogOpen(true);
  };

  const handleDragStart = (e: React.DragEvent) => {
    if (selectionMode) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/json", JSON.stringify({ type: "document", id }));
    onDragStart?.({ type: "document", id, name: documentName });
  };

  const handleDragEnd = () => {
    onDragEnd?.();
  };

  const handleCardClick = (e: React.MouseEvent) => {
    if (selectionMode) {
      e.preventDefault();
      e.stopPropagation();
      onSelect?.();
    }
  };

  return (
    <>
      <Card
        className={cn(
          "group transition-shadow hover:shadow-lg",
          !selectionMode && "cursor-grab active:cursor-grabbing",
          selectionMode && "cursor-pointer",
          isDragging && "opacity-50 ring-2 ring-primary",
          isSelected && "ring-2 ring-primary bg-primary/5"
        )}
        draggable={!selectionMode}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onClick={handleCardClick}
      >
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div className="flex items-center space-x-2 min-w-0 flex-1">
            {selectionMode ? (
              isSelected ? (
                <CheckSquare className="h-5 w-5 flex-shrink-0 text-primary" />
              ) : (
                <Square className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
              )
            ) : (
              <FileTypeIcon mimeType={mimeType} name={documentName} className="h-5 w-5 flex-shrink-0" />
            )}
            <h3 className="font-semibold truncate" title={documentName}>
              {documentName}
            </h3>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 flex-shrink-0"
                disabled={loading || exporting || duplicating}
              >
                <MoreVertical className="h-4 w-4" />
                <span className="sr-only">{t("menu.open")}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={handlePreview}>
                <Eye className="mr-2 h-4 w-4" />
                {t("menu.preview")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleDownload}>
                <Download className="mr-2 h-4 w-4" />
                {t("menu.download")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={openRenameDialog}>
                <Pencil className="mr-2 h-4 w-4" />
                {t("menu.rename")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleDuplicate} disabled={duplicating}>
                <Copy className="mr-2 h-4 w-4" />
                {t("menu.duplicate")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTagsDialogOpen(true)}>
                <Tags className="mr-2 h-4 w-4" />
                {t("menu.manageTags")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setOcrDialogOpen(true)}>
                <ScanText className="mr-2 h-4 w-4" />
                {t("menu.makeSearchable")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleShare}>
                <Share2 className="mr-2 h-4 w-4" />
                {t("menu.share")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <FileType className="mr-2 h-4 w-4" />
                  {t("menu.export")}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={() => handleExport("docx")}>
                    <FileType className="mr-2 h-4 w-4" />
                    {t("menu.exportWord")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport("xlsx")}>
                    <FileSpreadsheet className="mr-2 h-4 w-4" />
                    {t("menu.exportExcel")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport("pptx")}>
                    <Presentation className="mr-2 h-4 w-4" />
                    {t("menu.exportPowerPoint")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport("odt")}>
                    <FileType className="mr-2 h-4 w-4" />
                    {t("menu.exportOdt")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport("ods")}>
                    <FileSpreadsheet className="mr-2 h-4 w-4" />
                    {t("menu.exportOds")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport("odp")}>
                    <Presentation className="mr-2 h-4 w-4" />
                    {t("menu.exportOdp")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport("rtf")}>
                    <FileType className="mr-2 h-4 w-4" />
                    {t("menu.exportRtf")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport("png")}>
                    <Image className="mr-2 h-4 w-4" />
                    {t("menu.exportImages")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport("jpeg")}>
                    <Image className="mr-2 h-4 w-4" />
                    {t("menu.exportJpeg")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport("webp")}>
                    <Image className="mr-2 h-4 w-4" />
                    {t("menu.exportWebp")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport("html")}>
                    <FileType className="mr-2 h-4 w-4" />
                    {t("menu.exportHtml")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport("txt")}>
                    <FileSpreadsheet className="mr-2 h-4 w-4" />
                    {t("menu.exportText")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport("markdown")}>
                    <Hash className="mr-2 h-4 w-4" />
                    {t("menu.exportMarkdown")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport("csv")}>
                    <FileSpreadsheet className="mr-2 h-4 w-4" />
                    {t("menu.exportCsv")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport("epub")}>
                    <BookOpen className="mr-2 h-4 w-4" />
                    {t("menu.exportEpub")}
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Wrench className="mr-2 h-4 w-4" />
                  {t("menu.transform")}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={() => setActiveTransform("compress")}>
                    <Minimize2 className="mr-2 h-4 w-4" />
                    {t("menu.transformCompress")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setActiveTransform("protect")}>
                    <Lock className="mr-2 h-4 w-4" />
                    {t("menu.transformProtect")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setActiveTransform("sign")}>
                    <PenLine className="mr-2 h-4 w-4" />
                    {t("menu.transformSign")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setActiveTransform("watermark")}>
                    <Droplet className="mr-2 h-4 w-4" />
                    {t("menu.transformWatermark")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setActiveTransform("pdfa")}>
                    <FileCheck2 className="mr-2 h-4 w-4" />
                    {t("menu.transformPdfa")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setActiveTransform("split")}>
                    <Scissors className="mr-2 h-4 w-4" />
                    {t("menu.transformSplit")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setOrganizeDialogOpen(true)}>
                    <Wand2 className="mr-2 h-4 w-4" />
                    {t("menu.transformOrganize")}
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setDeleteDialogOpen(true)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {t("menu.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardHeader>
        <CardContent>
          {/* First-page thumbnail (presigned S3 URL). Absent or expired →
              the card keeps its icon-only look, exactly as before. */}
          {thumbnailUrl && !thumbnailBroken && (
            <div className="mb-3 h-28 overflow-hidden rounded-md border bg-muted/30">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={thumbnailUrl}
                alt={documentName}
                loading="lazy"
                className="h-full w-full object-cover object-top"
                onError={() => setThumbnailBroken(true)}
              />
            </div>
          )}
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>{t("size")}: {formatBytes(size)}</p>
            <p>{t("created")}: {formatDate(createdAt)}</p>
            <p>{t("modified")}: {formatDate(updatedAt)}</p>
          </div>
          <TagChips tags={tags} className="mt-2" />
        </CardContent>
        <CardFooter>
          <Button
            variant="default"
            className="w-full"
            onClick={handleOpenEditor}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <ExternalLink className="mr-2 h-4 w-4" />
                {t("open")}
              </>
            )}
          </Button>
        </CardFooter>
      </Card>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("deleteDialog.description", { name: documentName })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={deleting}
            >
              {t("deleteDialog.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("deleteDialog.deleting")}
                </>
              ) : (
                t("deleteDialog.confirm")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("renameDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("renameDialog.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="document-name">{t("renameDialog.label")}</Label>
            <Input
              id="document-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("renameDialog.placeholder")}
              className="mt-2"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleRename();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRenameDialogOpen(false)}
              disabled={renaming}
            >
              {t("renameDialog.cancel")}
            </Button>
            <Button onClick={handleRename} disabled={renaming || !newName.trim()}>
              {renaming ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("renameDialog.renaming")}
                </>
              ) : (
                t("renameDialog.confirm")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Share Dialog */}
      <ShareDialog
        open={shareDialogOpen}
        onOpenChange={setShareDialogOpen}
        documentId={id}
        documentName={documentName}
      />

      {/* Manage Tags Dialog */}
      <ManageTagsDialog
        open={tagsDialogOpen}
        onOpenChange={setTagsDialogOpen}
        documentId={id}
        documentName={documentName}
        initialTags={tags}
        onSaved={() => onChanged?.()}
      />

      {/* OCR (make searchable) Dialog */}
      <GedOcrDialog
        open={ocrDialogOpen}
        onOpenChange={setOcrDialogOpen}
        documentId={id}
        documentName={documentName}
        onReplaced={() => onChanged?.()}
      />

      {/* Organize pages Dialog (visual grid) */}
      <GedOrganizeDialog
        open={organizeDialogOpen}
        onOpenChange={setOrganizeDialogOpen}
        documentId={id}
        documentName={documentName}
        onReplaced={() => onChanged?.()}
      />

      {activeTransform && (
        <GedTransformDialog
          open={activeTransform !== null}
          onOpenChange={(next) => !next && setActiveTransform(null)}
          transform={activeTransform}
          documentId={id}
          documentName={documentName}
          onReplaced={() => onChanged?.()}
        />
      )}

      {/* Export Progress Dialog */}
      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("exportDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("exportDialog.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        </DialogContent>
      </Dialog>

      {/* Preview Modal */}
      <Dialog
        open={previewOpen}
        onOpenChange={(open) => (open ? setPreviewOpen(true) : closePreview())}
      >
        <DialogContent className="sm:max-w-5xl h-[90dvh] flex flex-col p-0">
          <DialogHeader className="px-6 py-4 border-b flex-shrink-0">
            <div className="flex items-center justify-between">
              <DialogTitle className="truncate pr-4">{documentName}</DialogTitle>
            </div>
          </DialogHeader>
          <div className="flex-1 overflow-hidden bg-muted/30">
            {previewLoading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : previewUrl ? (
              <iframe
                src={`${previewUrl}#toolbar=0&navpanes=0`}
                className="w-full h-full border-0"
                title={documentName}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                {t("preview.noPreview")}
              </div>
            )}
          </div>
          <DialogFooter className="px-6 py-4 border-t flex-shrink-0">
            <Button variant="outline" onClick={closePreview}>
              {t("preview.close")}
            </Button>
            <Button onClick={handleDownload}>
              <Download className="mr-2 h-4 w-4" />
              {t("menu.download")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
