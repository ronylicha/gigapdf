"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { storageKeys } from "@giga-pdf/api";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Separator,
  Skeleton,
  ToastAction,
  useToast,
} from "@giga-pdf/ui";
import {
  Activity,
  ArrowLeft,
  Copy,
  Download,
  ExternalLink,
  FileX,
  History,
  Loader2,
  Pencil,
  RotateCcw,
  Share2,
  Tags,
  Trash2,
} from "lucide-react";
import { FileTypeIcon } from "@/components/dashboard/file-type-icon";
import { api } from "@/lib/api";
import { formatBytes, formatDate } from "@/lib/utils";
import { ShareDialog } from "@/components/sharing";
import { ManageTagsDialog } from "@/components/dashboard/manage-tags-dialog";
import { clientLogger } from "@/lib/client-logger";

interface DocumentPageProps {
  params: Promise<{
    id: string;
  }>;
}

interface DocumentVersion {
  version: number;
  created_at: string;
  created_by: string;
  comment: string | null;
  size_bytes: number;
}

/**
 * Extract the HTTP status attached by the API client to thrown errors.
 */
function getErrorStatus(error: unknown): number | undefined {
  if (error instanceof Error && "status" in error) {
    const status = (error as Error & { status?: unknown }).status;
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
}

/**
 * Query key for the loaded session of a stored document.
 * Aligned with the storageKeys factory from @giga-pdf/api:
 * ["storage", "documents", id, "session"].
 */
function sessionKey(storedDocumentId: string) {
  return [...storageKeys.documents(), storedDocumentId, "session"] as const;
}

/**
 * Query key for the activity history of a stored document:
 * ["storage", "documents", id, "activity"].
 */
function activityKey(storedDocumentId: string) {
  return [...storageKeys.documents(), storedDocumentId, "activity"] as const;
}

/**
 * Query key for the stored metadata (tags + thumbnail) of a document:
 * ["storage", "documents", id, "meta"].
 */
function metaKey(storedDocumentId: string) {
  return [...storageKeys.documents(), storedDocumentId, "meta"] as const;
}

const ACTIVITY_PAGE_SIZE = 10;

/**
 * Action types emitted by the backend ActivityAction enum
 * (app/services/activity_service.py). Unknown actions fall back to the
 * raw string so new backend actions never break the UI.
 */
const KNOWN_ACTIVITY_ACTIONS = [
  "create",
  "view",
  "download",
  "edit",
  "rename",
  "delete",
  "restore",
  "share",
  "unshare",
  "export",
  "upload",
  "move",
  "copy",
  "lock",
  "unlock",
] as const;

type KnownActivityAction = (typeof KNOWN_ACTIVITY_ACTIONS)[number];

function isKnownActivityAction(action: string): action is KnownActivityAction {
  return (KNOWN_ACTIVITY_ACTIONS as readonly string[]).includes(action);
}

export default function DocumentPage({ params }: DocumentPageProps) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useTranslations("documents.detail");
  const tCard = useTranslations("documents.card");
  const tToasts = useTranslations("documents.toasts");
  const { toast } = useToast();

  // Dialog states
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [tagsDialogOpen, setTagsDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [downloading, setDownloading] = useState(false);
  // Presigned thumbnail URLs expire after 7 days: fall back to the icon.
  const [thumbnailBroken, setThumbnailBroken] = useState(false);

  // Load the stored document into a session (same pattern as document-card
  // preview): the session document_id powers the iframe preview + download.
  const sessionQuery = useQuery({
    queryKey: sessionKey(id),
    queryFn: () => api.loadDocument(id),
    retry: (failureCount, error) => {
      // 404 = document does not exist, never retry
      if (getErrorStatus(error) === 404) return false;
      return failureCount < 1;
    },
    staleTime: 30 * 1000,
  });

  // Version history: provides size + created/modified dates for the document.
  const versionsQuery = useQuery({
    queryKey: storageKeys.versions(id),
    queryFn: () => api.getDocumentVersions(id),
    enabled: sessionQuery.isSuccess,
    staleTime: 30 * 1000,
  });

  // Stored metadata: tags + thumbnail_url — fetched via GET /api/v1/storage/documents/{id}.
  // Fires in parallel with sessionQuery (no dependency on the session name).
  const metaQuery = useQuery({
    queryKey: metaKey(id),
    queryFn: () => api.getStoredDocument(id),
    retry: (failureCount, error) => {
      if (getErrorStatus(error) === 404) return false;
      return failureCount < 1;
    },
    staleTime: 30 * 1000,
  });

  const renameMutation = useMutation({
    mutationFn: (name: string) => api.renameDocument(id, name),
    onSuccess: () => {
      setRenameDialogOpen(false);
      // Invalidates the session (name), versions and documents list at once.
      queryClient.invalidateQueries({ queryKey: storageKeys.documents() });
    },
    onError: (error) => {
      clientLogger.error("document-detail.rename-failed", error);
      alert(tCard("errors.renameFailed"));
    },
  });

  // Soft delete: the document goes to the trash. The toast (global Toaster,
  // survives the navigation back to /documents) offers an inline Undo that
  // restores it on the spot.
  const deleteMutation = useMutation({
    mutationFn: () => api.deleteDocument(id),
    onSuccess: () => {
      setDeleteDialogOpen(false);
      queryClient.removeQueries({ queryKey: [...storageKeys.documents(), id] });
      queryClient.invalidateQueries({ queryKey: storageKeys.documents() });
      toast({
        title: tToasts("movedToTrash"),
        description: sessionQuery.data?.name,
        action: (
          <ToastAction
            altText={tToasts("movedToTrashUndo")}
            onClick={async () => {
              try {
                await api.restoreDocument(id);
                toast({ title: tToasts("restored") });
                queryClient.invalidateQueries({
                  queryKey: storageKeys.documents(),
                });
              } catch (restoreErr) {
                clientLogger.error("document-detail.restore-trash-failed", restoreErr);
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
      router.push("/documents");
    },
    onError: (error) => {
      clientLogger.error("document-detail.delete-failed", error);
      alert(tCard("errors.deleteFailed"));
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: () => api.duplicateDocument(id),
    onSuccess: (copy) => {
      toast({ title: tToasts("duplicated", { name: copy.name }) });
      queryClient.invalidateQueries({ queryKey: storageKeys.documents() });
    },
    onError: (error) => {
      clientLogger.error("document-detail.duplicate-failed", error);
      toast({ variant: "destructive", title: tToasts("duplicateFailed") });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: () => api.restoreOriginalDocument(id),
    onSuccess: () => {
      setRestoreDialogOpen(false);
      // The PDF content changed: refresh versions AND reload the session so
      // the preview iframe points to a fresh session document.
      queryClient.invalidateQueries({ queryKey: storageKeys.versions(id) });
      queryClient.invalidateQueries({ queryKey: sessionKey(id) });
    },
    onError: (error) => {
      clientLogger.error("document-detail.restore-failed", error);
      alert(t("restoreDialog.error"));
    },
  });

  const handleDownload = async () => {
    try {
      setDownloading(true);
      // Re-load before download: session document ids are transient and must
      // not be reused across operations.
      const result = await api.loadDocument(id);
      const downloadUrl = api.getDocumentDownloadUrl(result.document_id);
      window.open(downloadUrl, "_blank");
    } catch (error) {
      clientLogger.error("document-detail.download-failed", error);
      alert(tCard("errors.downloadFailed"));
    } finally {
      setDownloading(false);
    }
  };

  const handleRename = () => {
    const session = sessionQuery.data;
    if (!session) return;
    const trimmed = newName.trim();
    if (!trimmed || trimmed === session.name) {
      setRenameDialogOpen(false);
      return;
    }
    renameMutation.mutate(trimmed);
  };

  const openRenameDialog = () => {
    setNewName(sessionQuery.data?.name ?? "");
    setRenameDialogOpen(true);
  };

  // ── Loading state ──────────────────────────────────────────────────────────
  if (sessionQuery.isPending) {
    return <DocumentDetailSkeleton backLabel={t("back")} />;
  }

  // ── Error states ───────────────────────────────────────────────────────────
  if (sessionQuery.isError) {
    const isNotFound = getErrorStatus(sessionQuery.error) === 404;
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
          <FileX className="h-8 w-8 text-muted-foreground" />
        </div>
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">
            {isNotFound ? t("errors.notFoundTitle") : t("errors.loadFailedTitle")}
          </h1>
          <p className="text-muted-foreground">
            {isNotFound
              ? t("errors.notFoundDescription")
              : t("errors.loadFailedDescription")}
          </p>
        </div>
        <div className="flex gap-2">
          {!isNotFound && (
            <Button variant="outline" onClick={() => sessionQuery.refetch()}>
              {t("errors.retry")}
            </Button>
          )}
          <Link href="/documents">
            <Button className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              {t("back")}
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const session = sessionQuery.data;
  const documentName = session.name;
  const previewUrl = api.getDocumentDownloadUrl(session.document_id);

  const meta = metaQuery.data ?? null;
  const documentTags = meta?.tags ?? [];
  const thumbnailUrl =
    meta?.thumbnail_url && !thumbnailBroken ? meta.thumbnail_url : null;

  const versionsData = versionsQuery.data;
  const versions: DocumentVersion[] = versionsData?.versions ?? [];
  const sortedVersions = [...versions].sort((a, b) => b.version - a.version);
  const currentVersion = versionsData
    ? versions.find((v) => v.version === versionsData.current_version)
    : undefined;
  const oldestVersion =
    versions.length > 0
      ? versions.reduce((min, v) => (v.version < min.version ? v : min))
      : undefined;
  const latestVersion = sortedVersions[0];
  const canRestoreOriginal = versions.length > 1;

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href="/documents"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t("back")}
      </Link>

      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          {thumbnailUrl ? (
            <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl border bg-muted/30">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={thumbnailUrl}
                alt={documentName}
                className="h-full w-full object-cover object-top"
                onError={() => setThumbnailBroken(true)}
              />
            </div>
          ) : (
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted">
              <FileTypeIcon
                mimeType={meta?.mime_type}
                name={session.name}
                className="h-6 w-6"
              />
            </div>
          )}
          <div className="min-w-0 space-y-1">
            <h1 className="truncate text-2xl font-bold sm:text-3xl" title={documentName}>
              {documentName}
            </h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {latestVersion && (
                <span>
                  {t("lastModified", { date: formatDate(latestVersion.created_at) })}
                </span>
              )}
              {currentVersion && <span>{formatBytes(currentVersion.size_bytes)}</span>}
              <Badge variant="secondary">
                {t("info.pagesValue", { count: session.page_count })}
              </Badge>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/editor/${id}`}>
            <Button className="gap-2">
              <ExternalLink className="h-4 w-4" />
              {t("actions.edit")}
            </Button>
          </Link>
          <Button
            variant="outline"
            className="gap-2"
            onClick={handleDownload}
            disabled={downloading}
          >
            {downloading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {t("actions.download")}
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => setShareDialogOpen(true)}
          >
            <Share2 className="h-4 w-4" />
            {t("actions.share")}
          </Button>
          <Button variant="outline" className="gap-2" onClick={openRenameDialog}>
            <Pencil className="h-4 w-4" />
            {t("actions.rename")}
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => duplicateMutation.mutate()}
            disabled={duplicateMutation.isPending}
          >
            {duplicateMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            {t("actions.duplicate")}
          </Button>
          <Button
            variant="outline"
            className="gap-2 text-destructive hover:text-destructive"
            onClick={() => setDeleteDialogOpen(true)}
          >
            <Trash2 className="h-4 w-4" />
            {t("actions.delete")}
          </Button>
        </div>
      </div>

      {/* Content grid: preview (dominant) + side panel */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* PDF Preview */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t("preview.title")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="h-[65vh] min-h-[420px] overflow-hidden rounded-b-xl border-t bg-muted/30">
              <iframe
                src={`${previewUrl}#toolbar=0&navpanes=0`}
                className="h-full w-full border-0"
                title={documentName}
              />
            </div>
          </CardContent>
        </Card>

        {/* Side panel */}
        <div className="space-y-6">
          {/* Metadata */}
          <Card>
            <CardHeader>
              <CardTitle>{t("info.title")}</CardTitle>
              <CardDescription>{t("info.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <MetadataRow label={t("info.fileName")} value={documentName} />
              <Separator />
              <MetadataRow label={t("info.fileType")} value="PDF" />
              <Separator />
              <MetadataRow
                label={t("info.fileSize")}
                value={
                  currentVersion ? formatBytes(currentVersion.size_bytes) : "--"
                }
              />
              <Separator />
              <MetadataRow
                label={t("info.pages")}
                value={t("info.pagesValue", { count: session.page_count })}
              />
              <Separator />
              <MetadataRow
                label={t("info.created")}
                value={oldestVersion ? formatDate(oldestVersion.created_at) : "--"}
              />
              <Separator />
              <MetadataRow
                label={t("info.lastModified")}
                value={latestVersion ? formatDate(latestVersion.created_at) : "--"}
              />
            </CardContent>
          </Card>

          {/* Tags (clickable → manage dialog) */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Tags className="h-4 w-4" />
                {t("tags.title")}
              </CardTitle>
              <CardDescription>{t("tags.description")}</CardDescription>
            </CardHeader>
            <CardContent>
              {metaQuery.isPending ? (
                <Skeleton className="h-9 w-full" />
              ) : metaQuery.isError ? (
                <p className="text-sm text-muted-foreground">
                  {t("tags.loadFailed")}
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => setTagsDialogOpen(true)}
                  className="flex w-full flex-wrap items-center gap-1.5 rounded-md border border-dashed p-3 text-left transition-colors hover:border-primary/50 hover:bg-accent/50"
                  aria-label={t("tags.edit")}
                >
                  {documentTags.length === 0 ? (
                    <span className="text-sm text-muted-foreground">
                      {t("tags.empty")}
                    </span>
                  ) : (
                    documentTags.map((tag) => (
                      <Badge key={tag} variant="secondary">
                        {tag}
                      </Badge>
                    ))
                  )}
                </button>
              )}
            </CardContent>
          </Card>

          {/* Version history */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-4 w-4" />
                {t("versions.title")}
              </CardTitle>
              <CardDescription>{t("versions.description")}</CardDescription>
            </CardHeader>
            <CardContent>
              {versionsQuery.isPending ? (
                <div className="space-y-3">
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                </div>
              ) : versionsQuery.isError ? (
                <div className="space-y-2 text-center">
                  <p className="text-sm text-muted-foreground">
                    {t("versions.loadFailed")}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => versionsQuery.refetch()}
                  >
                    {t("errors.retry")}
                  </Button>
                </div>
              ) : sortedVersions.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("versions.empty")}</p>
              ) : (
                <ul className="space-y-2">
                  {sortedVersions.map((version) => {
                    const isCurrent =
                      version.version === versionsData?.current_version;
                    return (
                      <li
                        key={version.version}
                        className={`rounded-lg border p-3 ${
                          isCurrent ? "border-primary/40 bg-primary/5" : ""
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium">
                            {t("versions.version", { version: version.version })}
                          </p>
                          {isCurrent && (
                            <Badge>{t("versions.current")}</Badge>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatDate(version.created_at)} ·{" "}
                          {formatBytes(version.size_bytes)}
                        </p>
                        {version.comment && (
                          <p
                            className="mt-1 truncate text-xs italic text-muted-foreground"
                            title={version.comment}
                          >
                            {version.comment}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
            {canRestoreOriginal && (
              <CardFooter>
                <Button
                  variant="outline"
                  className="w-full gap-2"
                  onClick={() => setRestoreDialogOpen(true)}
                  disabled={restoreMutation.isPending}
                >
                  <RotateCcw className="h-4 w-4" />
                  {t("versions.restoreOriginal")}
                </Button>
              </CardFooter>
            )}
          </Card>

          {/* Activity history */}
          <DocumentActivityCard documentId={id} />
        </div>
      </div>

      {/* Rename Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tCard("renameDialog.title")}</DialogTitle>
            <DialogDescription>{tCard("renameDialog.description")}</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="document-detail-name">{tCard("renameDialog.label")}</Label>
            <Input
              id="document-detail-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={tCard("renameDialog.placeholder")}
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
              disabled={renameMutation.isPending}
            >
              {tCard("renameDialog.cancel")}
            </Button>
            <Button
              onClick={handleRename}
              disabled={renameMutation.isPending || !newName.trim()}
            >
              {renameMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {tCard("renameDialog.renaming")}
                </>
              ) : (
                tCard("renameDialog.confirm")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tCard("deleteDialog.title")}</DialogTitle>
            <DialogDescription>
              {tCard("deleteDialog.description", { name: documentName })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={deleteMutation.isPending}
            >
              {tCard("deleteDialog.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {tCard("deleteDialog.deleting")}
                </>
              ) : (
                tCard("deleteDialog.confirm")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Restore Original Confirmation Dialog */}
      <Dialog open={restoreDialogOpen} onOpenChange={setRestoreDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("restoreDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("restoreDialog.description", { name: documentName })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRestoreDialogOpen(false)}
              disabled={restoreMutation.isPending}
            >
              {t("restoreDialog.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => restoreMutation.mutate()}
              disabled={restoreMutation.isPending}
            >
              {restoreMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("restoreDialog.restoring")}
                </>
              ) : (
                t("restoreDialog.confirm")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Share Dialog (reused component) */}
      <ShareDialog
        open={shareDialogOpen}
        onOpenChange={setShareDialogOpen}
        documentId={id}
        documentName={documentName}
      />

      {/* Manage Tags Dialog (invalidations handled inside: documents() prefix
          covers the meta query of this page) */}
      <ManageTagsDialog
        open={tagsDialogOpen}
        onOpenChange={setTagsDialogOpen}
        documentId={id}
        documentName={documentName}
        initialTags={documentTags}
      />
    </div>
  );
}

/**
 * "Activity" card: paginated audit trail of the document, fed by
 * GET /api/v1/activity/documents/{id}/history (10 entries per page,
 * "show more" appends the next page). Errors stay silent: the card shows
 * a discreet message and never breaks the page.
 */
function DocumentActivityCard({ documentId }: { documentId: string }) {
  const t = useTranslations("documents.detail.activity");
  const format = useFormatter();

  const activityQuery = useInfiniteQuery({
    queryKey: activityKey(documentId),
    queryFn: ({ pageParam }) =>
      api.getDocumentActivity(documentId, pageParam, ACTIVITY_PAGE_SIZE),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.page < lastPage.pagination.total_pages
        ? lastPage.pagination.page + 1
        : undefined,
    staleTime: 30 * 1000,
    // Silent failure: a single attempt, the card degrades to a discreet
    // message instead of retry-hammering the backend.
    retry: false,
  });

  const activities =
    activityQuery.data?.pages.flatMap((page) => page.activities) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-4 w-4" />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {activityQuery.isPending ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : activityQuery.isError ? (
          <p className="text-sm text-muted-foreground">{t("loadFailed")}</p>
        ) : activities.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <>
            <ul className="space-y-3">
              {activities.map((activity) => (
                <li
                  key={activity.id}
                  className="flex items-baseline justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {isKnownActivityAction(activity.action)
                        ? t(`actions.${activity.action}`)
                        : activity.action}
                    </p>
                    <p
                      className="truncate text-xs text-muted-foreground"
                      title={activity.user_email ?? undefined}
                    >
                      {activity.user_name ||
                        activity.user_email ||
                        t("unknownUser")}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {activity.created_at
                      ? format.relativeTime(new Date(activity.created_at))
                      : "--"}
                  </span>
                </li>
              ))}
            </ul>
            {activityQuery.hasNextPage && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-3 w-full"
                onClick={() => activityQuery.fetchNextPage()}
                disabled={activityQuery.isFetchingNextPage}
              >
                {activityQuery.isFetchingNextPage ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t("loadingMore")}
                  </>
                ) : (
                  t("loadMore")
                )}
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <p className="shrink-0 text-sm font-medium">{label}</p>
      <p className="min-w-0 truncate text-right text-sm text-muted-foreground" title={value}>
        {value}
      </p>
    </div>
  );
}

function DocumentDetailSkeleton({ backLabel }: { backLabel: string }) {
  return (
    <div className="space-y-6">
      <Link
        href="/documents"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {backLabel}
      </Link>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-4">
          <Skeleton className="h-12 w-12 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-48" />
          </div>
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-10 w-36" />
          <Skeleton className="h-10 w-28" />
          <Skeleton className="h-10 w-28" />
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-[65vh] min-h-[420px] lg:col-span-2" />
        <div className="space-y-6">
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    </div>
  );
}
