"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { storageKeys } from "@giga-pdf/api";
import {
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Skeleton,
  useToast,
} from "@giga-pdf/ui";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { FileTypeIcon } from "@/components/dashboard/file-type-icon";
import { api, StoredDocument } from "@/lib/api";
import { formatBytes, formatDate } from "@/lib/utils";
import { clientLogger } from "@/lib/client-logger";

const TRASH_PAGE_SIZE = 50;

/**
 * Query key for the trash listing, scoped under the storageKeys.documents()
 * prefix so global document invalidations refresh the trash too.
 */
function trashKey(page: number) {
  return [...storageKeys.documents(), "trash", { page }] as const;
}

export default function TrashPage() {
  const t = useTranslations("trash");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  // Permanent deletion target + two-step confirmation state: the dialog is
  // confirmation #1, the "armed" re-click of the destructive button is
  // confirmation #2 (the action is irreversible).
  const [docToDelete, setDocToDelete] = useState<StoredDocument | null>(null);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const trashQuery = useQuery({
    queryKey: trashKey(page),
    queryFn: () => api.getTrashedDocuments({ page, per_page: TRASH_PAGE_SIZE }),
    staleTime: 15 * 1000,
  });

  const invalidateAll = () => {
    // Trash + active listings share the documents() prefix.
    queryClient.invalidateQueries({ queryKey: storageKeys.documents() });
    // Removing the last item of a page > 1 would land on an empty page:
    // step back so the refetch targets a page that still exists.
    const itemsOnPage = trashQuery.data?.items.length ?? 0;
    if (itemsOnPage <= 1 && page > 1) {
      setPage((current) => Math.max(1, current - 1));
    }
  };

  const restoreMutation = useMutation({
    mutationFn: (storedDocumentId: string) =>
      api.restoreDocument(storedDocumentId),
    onMutate: (storedDocumentId) => setRestoringId(storedDocumentId),
    onSuccess: () => {
      toast({ title: t("toasts.restored") });
      invalidateAll();
    },
    onError: (error) => {
      clientLogger.error("trash.restore-failed", error);
      toast({ variant: "destructive", title: t("toasts.restoreFailed") });
    },
    onSettled: () => setRestoringId(null),
  });

  const deleteMutation = useMutation({
    mutationFn: (storedDocumentId: string) =>
      api.deleteDocumentPermanent(storedDocumentId),
    onSuccess: () => {
      toast({ title: t("toasts.deleted") });
      closeDeleteDialog();
      invalidateAll();
    },
    onError: (error) => {
      clientLogger.error("trash.permanent-delete-failed", error);
      toast({ variant: "destructive", title: t("toasts.deleteFailed") });
    },
  });

  const openDeleteDialog = (doc: StoredDocument) => {
    setDocToDelete(doc);
    setDeleteArmed(false);
  };

  const closeDeleteDialog = () => {
    setDocToDelete(null);
    setDeleteArmed(false);
  };

  // Two-step destructive confirm: first click arms, second click executes.
  const handleConfirmDelete = () => {
    if (!docToDelete) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    deleteMutation.mutate(docToDelete.stored_document_id);
  };

  const documents = trashQuery.data?.items ?? [];
  const pagination = trashQuery.data?.pagination;
  const totalPages = pagination?.total_pages ?? 1;
  const total = pagination?.total ?? 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="flex items-center gap-3 text-3xl font-bold">
          <Trash2 className="h-7 w-7 text-muted-foreground" />
          {t("title")}
        </h1>
        <p className="text-muted-foreground">
          {total > 0 ? t("totalCount", { count: total }) : t("subtitle")}
        </p>
      </div>

      {/* Content */}
      {trashQuery.isPending ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[...Array(8)].map((_, i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
      ) : trashQuery.isError ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed p-12 text-center">
          <p className="text-muted-foreground">{t("errors.loadFailed")}</p>
          <Button variant="outline" onClick={() => trashQuery.refetch()}>
            {t("errors.retry")}
          </Button>
        </div>
      ) : documents.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center">
          <Trash2 className="mb-4 h-12 w-12 text-muted-foreground" />
          <h3 className="mb-2 text-lg font-semibold">{t("empty.title")}</h3>
          <p className="text-muted-foreground">{t("empty.description")}</p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {documents.map((doc) => {
              const isRestoring = restoringId === doc.stored_document_id;
              return (
                <Card key={doc.stored_document_id}>
                  <CardHeader className="flex flex-row items-center space-y-0 pb-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <FileTypeIcon
                        mimeType={doc.mime_type}
                        name={doc.name}
                        className="h-5 w-5 flex-shrink-0"
                      />
                      <h3 className="truncate font-semibold" title={doc.name}>
                        {doc.name}
                      </h3>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-1 text-sm text-muted-foreground">
                      {doc.deleted_at && (
                        <p>{t("deletedAt", { date: formatDate(doc.deleted_at) })}</p>
                      )}
                      <p>{formatBytes(doc.file_size_bytes || 0)}</p>
                    </div>
                  </CardContent>
                  <CardFooter className="gap-2">
                    <Button
                      variant="outline"
                      className="flex-1 gap-2"
                      onClick={() => restoreMutation.mutate(doc.stored_document_id)}
                      disabled={isRestoring || deleteMutation.isPending}
                    >
                      {isRestoring ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          {t("restoring")}
                        </>
                      ) : (
                        <>
                          <RotateCcw className="h-4 w-4" />
                          {t("restore")}
                        </>
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="flex-shrink-0 text-destructive hover:text-destructive"
                      onClick={() => openDeleteDialog(doc)}
                      disabled={isRestoring}
                      title={t("deletePermanently")}
                      aria-label={t("deletePermanently")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </CardFooter>
                </Card>
              );
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-4">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1 || trashQuery.isFetching}
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
                disabled={page === totalPages || trashQuery.isFetching}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </>
      )}

      {/* Permanent delete dialog (double confirmation) */}
      <Dialog
        open={docToDelete !== null}
        onOpenChange={(open) => {
          if (!open) closeDeleteDialog();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("deleteDialog.description", { name: docToDelete?.name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          {deleteArmed && (
            <p className="text-sm font-medium text-destructive">
              {t("deleteDialog.armedHint")}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={closeDeleteDialog}
              disabled={deleteMutation.isPending}
            >
              {t("deleteDialog.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("deleteDialog.deleting")}
                </>
              ) : deleteArmed ? (
                t("deleteDialog.confirmArmed")
              ) : (
                t("deleteDialog.confirm")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
