"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { StatsCards } from "@/components/dashboard/stats-cards";
import { DocumentGrid } from "@/components/dashboard/document-grid";
import { Button, Progress, Skeleton, useToast } from "@giga-pdf/ui";
import { Plus, Upload, X } from "lucide-react";
import { api, StoredDocument, QuotaSummary } from "@/lib/api";
import { clientLogger } from "@/lib/client-logger";
import {
  isAbortError,
  type UploadProgressEvent,
} from "@/lib/upload-with-progress";

/** Map a byte-level progress event onto a [base, base+span] percent window. */
function percentInWindow(
  event: UploadProgressEvent,
  base: number,
  span: number,
): number | null {
  if (event.total === null || event.total <= 0) return null;
  return Math.round(base + span * Math.min(1, event.loaded / event.total));
}

interface DashboardDocument {
  id: string;
  name: string;
  size: number;
  createdAt: Date;
  updatedAt: Date;
}

export default function DashboardPage() {
  const t = useTranslations("dashboard");
  const tDocs = useTranslations("documents");
  const router = useRouter();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [documents, setDocuments] = useState<DashboardDocument[]>([]);
  const [quota, setQuota] = useState<QuotaSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  // Real byte-level percent (0–100) across the two transfers, null = unknown.
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  // Cancels the in-flight upload (Annuler button while uploading).
  const uploadAbortRef = useRef<AbortController | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch documents and quota in parallel
      const [docsResponse, quotaResponse] = await Promise.all([
        api.listDocuments({ per_page: 6 }).catch(() => ({ items: [], pagination: { total: 0, page: 1, per_page: 6, total_pages: 0 } })),
        api.getQuota().catch(() => null),
      ]);

      // Transform documents to the expected format
      const transformedDocs: DashboardDocument[] = docsResponse.items.map((doc: StoredDocument) => ({
        id: doc.stored_document_id,
        name: doc.name,
        size: doc.file_size_bytes || 0,
        createdAt: new Date(doc.created_at),
        updatedAt: new Date(doc.modified_at),
      }));

      setDocuments(transformedDocs);
      setQuota(quotaResponse);
    } catch (err) {
      clientLogger.error("dashboard.load-failed", err);
      setError(tDocs("upload.error"));
    } finally {
      setLoading(false);
    }
  };

  const handleNewDocument = () => {
    fileInputRef.current?.click();
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError(tDocs("upload.error"));
      return;
    }

    const controller = new AbortController();
    uploadAbortRef.current = controller;

    try {
      setUploading(true);
      setUploadPercent(0);
      setError(null);

      // Upload the document — XHR transport reports real byte progress.
      // Two sequential transfers: session upload maps to 0–50%, storage save
      // to 50–100% (the intermediate download is not byte-tracked).
      const uploadResult = await api.uploadDocument(file, {
        signal: controller.signal,
        onProgress: (ev) => setUploadPercent(percentInWindow(ev, 0, 50)),
      });

      // Fetch the PDF Blob from the server before saving
      const { getAuthToken } = await import("@/lib/api");
      const token = await getAuthToken();
      const downloadRes = await fetch(
        `/api/v1/documents/${uploadResult.document_id}/download`,
        {
          credentials: "include",
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          signal: controller.signal,
        }
      );
      if (!downloadRes.ok) {
        throw new Error(`Failed to download PDF: ${downloadRes.status}`);
      }
      const pdfBlob = await downloadRes.blob();
      setUploadPercent(50);

      // Save to storage with the PDF Blob
      await api.saveDocument({
        file: pdfBlob,
        name: file.name.replace(".pdf", ""),
        tags: [],
        signal: controller.signal,
        onProgress: (ev) => setUploadPercent(percentInWindow(ev, 50, 50)),
      });
      setUploadPercent(100);

      toast({ title: tDocs("upload.success") });

      // Reload dashboard data
      await loadDashboardData();

    } catch (err) {
      if (isAbortError(err)) {
        // User cancel: neutral feedback, no error banner.
        toast({ title: tDocs("import.cancelled") });
      } else {
        clientLogger.error("dashboard.upload-failed", err);
        const message =
          err instanceof Error ? err.message : tDocs("upload.error");
        setError(message);
        toast({ variant: "destructive", title: tDocs("upload.error"), description: message });
      }
    } finally {
      // ALL paths (success, failure, cancel) reset the uploading state.
      uploadAbortRef.current = null;
      setUploading(false);
      setUploadPercent(null);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  // Cancel the in-flight upload (aborts every transfer).
  const handleCancelUpload = () => {
    uploadAbortRef.current?.abort();
  };

  const totalDocuments = quota?.documents.count ?? documents.length;
  const totalSize = quota?.storage.used_bytes ?? documents.reduce((acc, doc) => acc + doc.size, 0);
  const recentDocuments = documents.filter(
    (doc) => doc.updatedAt > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  ).length;

  if (loading) {
    return (
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-9 w-48" />
            <Skeleton className="mt-2 h-5 w-96" />
          </div>
          <Skeleton className="h-10 w-36" />
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
        <div>
          <Skeleton className="mb-4 h-8 w-48" />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-48" />
            <Skeleton className="h-48" />
            <Skeleton className="h-48" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf"
        className="hidden"
        onChange={handleFileUpload}
      />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t("title")}</h1>
          <p className="text-muted-foreground">
            {t("welcome")}
          </p>
        </div>
        <Button
          className="gap-2 pointer-coarse:min-h-11"
          onClick={handleNewDocument}
          disabled={uploading}
        >
          {uploading ? (
            <>
              <Upload className="h-4 w-4 animate-pulse" />
              {tDocs("upload.uploading")}
            </>
          ) : (
            <>
              <Plus className="h-4 w-4" />
              {t("newDocument")}
            </>
          )}
        </Button>
      </div>

      {/* Real byte-level upload progress + cancel. The upload flow's `finally`
          resets uploading/uploadPercent on success, error AND cancel, so this
          block always dismisses on its own. */}
      {uploading && (
        <div
          className="flex items-center gap-3 rounded-lg border bg-muted/50 p-3"
          aria-live="polite"
        >
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>{tDocs("upload.uploading")}</span>
              {uploadPercent !== null && <span>{uploadPercent}%</span>}
            </div>
            {uploadPercent !== null ? (
              <Progress value={uploadPercent} />
            ) : (
              <Progress value={100} className="animate-pulse" />
            )}
          </div>
          <Button
            variant="outline"
            onClick={handleCancelUpload}
            className="pointer-coarse:min-h-11 pointer-coarse:min-w-11"
          >
            <X className="mr-2 h-4 w-4" aria-hidden="true" />
            {tDocs("import.cancel")}
          </Button>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}

      <StatsCards
        totalDocuments={totalDocuments}
        totalSize={totalSize}
        recentDocuments={recentDocuments}
      />

      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-2xl font-bold">{t("recentDocuments")}</h2>
          {documents.length > 0 && (
            <Button variant="outline" onClick={() => router.push("/documents")}>
              {t("allDocuments")}
            </Button>
          )}
        </div>

        {documents.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center">
            <Upload className="mb-4 h-12 w-12 text-muted-foreground" />
            <h3 className="mb-2 text-lg font-semibold">{t("noDocuments.title")}</h3>
            <p className="mb-4 text-muted-foreground">
              {t("noDocuments.description")}
            </p>
            <Button onClick={handleNewDocument}>
              <Plus className="mr-2 h-4 w-4" />
              {t("uploadDocument")}
            </Button>
          </div>
        ) : (
          <DocumentGrid documents={documents} onDelete={loadDashboardData} />
        )}
      </div>
    </div>
  );
}
