"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  Button,
  Input,
  Skeleton,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  Badge,
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
  DropdownMenuTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@giga-pdf/ui";
import {
  Search,
  MoreVertical,
  Eye,
  Download,
  ExternalLink,
  Loader2,
  Users,
  Clock,
  Shield,
  Filter,
  RefreshCw,
  Trash2,
  User,
  Building2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { FileTypeIcon } from "@/components/dashboard/file-type-icon";
import { api, SharedWithMeDocument } from "@/lib/api";
import { clientLogger } from "@/lib/client-logger";
import { formatDate, formatBytes } from "@/lib/utils";
import { cn } from "@/lib/utils";

type SourceFilter = "all" | "direct" | "organization";

export default function SharedWithMePage() {
  const t = useTranslations("shared");
  const router = useRouter();

  // Data states
  const [documents, setDocuments] = useState<SharedWithMeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search and pagination
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // Filters
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");

  // Dialog states
  const [selectedDoc, setSelectedDoc] = useState<SharedWithMeDocument | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [removing, setRemoving] = useState(false);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const loadDocuments = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await api.getSharedWithMe({
        page,
        per_page: 20,
        source: sourceFilter,
      });

      // Filter locally if searching
      let filteredDocs = response.documents;
      if (debouncedSearch) {
        filteredDocs = filteredDocs.filter((doc) =>
          doc.name.toLowerCase().includes(debouncedSearch.toLowerCase())
        );
      }

      setDocuments(filteredDocs);
      setTotalPages(response.total_pages);
      setTotal(response.total);
    } catch (err) {
      clientLogger.error("shared.load-failed", err);
      setError(t("errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [page, sourceFilter, debouncedSearch, t]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  const handleOpenEditor = async (doc: SharedWithMeDocument) => {
    router.push(`/editor/${doc.id}`);
  };

  const handlePreview = async (doc: SharedWithMeDocument) => {
    try {
      setPreviewLoading(true);
      setSelectedDoc(doc);
      setPreviewOpen(true);
      const result = await api.loadDocument(doc.id);
      const downloadUrl = api.getDocumentDownloadUrl(result.document_id);
      setPreviewUrl(downloadUrl);
    } catch (err) {
      clientLogger.error("shared.load-preview-failed", err);
      setPreviewOpen(false);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleDownload = async (doc: SharedWithMeDocument) => {
    try {
      setLoadingId(doc.id);
      const result = await api.loadDocument(doc.id);
      const downloadUrl = api.getDocumentDownloadUrl(result.document_id);
      window.open(downloadUrl, "_blank");
    } catch (err) {
      clientLogger.error("shared.download-failed", err);
    } finally {
      setLoadingId(null);
    }
  };

  const handleRemoveFromList = async () => {
    if (!selectedDoc) return;

    try {
      setRemoving(true);
      // For direct shares, we can revoke the share
      // For organization shares, we just hide it from view
      if (selectedDoc.share_source === "direct" && selectedDoc.share_id) {
        await api.revokeShare(selectedDoc.share_id);
      }
      setRemoveDialogOpen(false);
      setSelectedDoc(null);
      await loadDocuments();
    } catch (err) {
      clientLogger.error("shared.remove-document-failed", err);
    } finally {
      setRemoving(false);
    }
  };

  const getPermissionBadge = (permission: string) => {
    if (permission === "edit" || permission === "write") {
      return (
        <Badge variant="default" className="gap-1">
          <Shield className="h-3 w-3" />
          {t("permissions.edit")}
        </Badge>
      );
    }
    return (
      <Badge variant="secondary" className="gap-1">
        <Eye className="h-3 w-3" />
        {t("permissions.view")}
      </Badge>
    );
  };

  const getSourceBadge = (shareSource: string) => {
    if (shareSource === "organization") {
      return (
        <Badge variant="outline" className="gap-1">
          <Building2 className="h-3 w-3" />
          {t("source.organization")}
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="gap-1">
        <User className="h-3 w-3" />
        {t("source.individual")}
      </Badge>
    );
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t("title")}</h1>
          <p className="text-muted-foreground">
            {total > 0 ? t("totalCount", { count: total }) : t("subtitle")}
          </p>
        </div>
        <Button variant="outline" onClick={loadDocuments} disabled={loading}>
          <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
          {t("refresh")}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("search")}
            className="pl-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select
            value={sourceFilter}
            onValueChange={(value) => setSourceFilter(value as SourceFilter)}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder={t("filters.all")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filters.all")}</SelectItem>
              <SelectItem value="direct">{t("filters.individual")}</SelectItem>
              <SelectItem value="organization">{t("filters.organization")}</SelectItem>
            </SelectContent>
          </Select>
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
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[...Array(8)].map((_, i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      ) : documents.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center">
          <Users className="mb-4 h-12 w-12 text-muted-foreground" />
          <h3 className="mb-2 text-lg font-semibold">{t("noDocuments.title")}</h3>
          <p className="text-muted-foreground">
            {debouncedSearch
              ? t("noDocuments.noResultsDescription", { search: debouncedSearch })
              : t("noDocuments.description")}
          </p>
        </div>
      ) : (
        <>
          {/* Document Grid */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {documents.map((doc) => (
              <Card key={doc.id} className="group hover:shadow-lg transition-shadow">
                <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                  <div className="flex items-center space-x-2 min-w-0 flex-1">
                    <FileTypeIcon name={doc.name} className="h-5 w-5 flex-shrink-0" />
                    <h3 className="font-semibold truncate" title={doc.name}>
                      {doc.name}
                    </h3>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 flex-shrink-0"
                        disabled={loadingId === doc.id}
                      >
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem onClick={() => handlePreview(doc)}>
                        <Eye className="mr-2 h-4 w-4" />
                        {t("menu.preview")}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleDownload(doc)}>
                        <Download className="mr-2 h-4 w-4" />
                        {t("menu.download")}
                      </DropdownMenuItem>
                      {doc.permission === "edit" && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => handleOpenEditor(doc)}>
                            <ExternalLink className="mr-2 h-4 w-4" />
                            {t("menu.openEditor")}
                          </DropdownMenuItem>
                        </>
                      )}
                      {doc.share_source === "direct" && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => {
                              setSelectedDoc(doc);
                              setRemoveDialogOpen(true);
                            }}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            {t("menu.remove")}
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      {getPermissionBadge(doc.permission)}
                      {getSourceBadge(doc.share_source)}
                    </div>
                    <div className="space-y-1 text-sm text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <User className="h-3 w-3" />
                        <span className="truncate">{doc.owner.email || doc.owner.user_id}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock className="h-3 w-3" />
                        <span>{formatDate(new Date(doc.shared_at))}</span>
                      </div>
                      {doc.file_size_bytes && (
                        <p>{formatBytes(doc.file_size_bytes)}</p>
                      )}
                    </div>
                  </div>
                </CardContent>
                <CardFooter>
                  <Button
                    variant="default"
                    className="w-full"
                    onClick={() => handleOpenEditor(doc)}
                    disabled={loadingId === doc.id}
                  >
                    {loadingId === doc.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <ExternalLink className="mr-2 h-4 w-4" />
                        {doc.permission === "edit" ? t("open") : t("view")}
                      </>
                    )}
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>

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

      {/* Preview Modal */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="sm:max-w-5xl h-[90dvh] flex flex-col p-0">
          <DialogHeader className="px-6 py-4 border-b flex-shrink-0">
            <DialogTitle className="truncate pr-4">{selectedDoc?.name}</DialogTitle>
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
                title={selectedDoc?.name}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                {t("preview.noPreview")}
              </div>
            )}
          </div>
          <DialogFooter className="px-6 py-4 border-t flex-shrink-0">
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>
              {t("preview.close")}
            </Button>
            <Button onClick={() => selectedDoc && handleDownload(selectedDoc)}>
              <Download className="mr-2 h-4 w-4" />
              {t("menu.download")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove Confirmation Dialog */}
      <Dialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("removeDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("removeDialog.description", { name: selectedDoc?.name || "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRemoveDialogOpen(false)}
              disabled={removing}
            >
              {t("removeDialog.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleRemoveFromList}
              disabled={removing}
            >
              {removing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("removeDialog.removing")}
                </>
              ) : (
                t("removeDialog.confirm")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
