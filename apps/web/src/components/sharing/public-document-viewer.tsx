"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Card, CardContent, CardHeader, Skeleton } from "@giga-pdf/ui";
import { Download, Eye, FileText, LinkIcon } from "lucide-react";
import { Logo } from "@/components/logo";
import { clientLogger } from "@/lib/client-logger";
import { formatBytes } from "@/lib/utils";

/** Shape served by GET /api/v1/sharing/public/{token}. */
interface PublicLinkInfo {
  document_name: string;
  page_count: number;
  file_size_bytes: number;
  permission: "view";
}

type ViewState = "loading" | "ready" | "notFound";

interface PublicDocumentViewerProps {
  token: string;
}

/**
 * Read-only viewer behind a public share link — /public/[token].
 *
 * Anonymous by design: the token IS the capability, no session is required
 * (plain fetch, no ApiClient → no Authorization header, no 401 logout side
 * effects). The PDF itself is rendered by the browser via an <iframe> on the
 * public download endpoint (Content-Disposition: inline), with a download
 * button as a robust fallback (?dl=1 → attachment).
 *
 * Security: the token must NEVER reach the console/logs — error paths log
 * static messages only.
 */
export function PublicDocumentViewer({ token }: PublicDocumentViewerProps) {
  const t = useTranslations("sharing.publicPage");
  // An empty token is invalid by construction — derived at init, no effect.
  const [state, setState] = useState<ViewState>(() =>
    token ? "loading" : "notFound"
  );
  const [info, setInfo] = useState<PublicLinkInfo | null>(null);

  const downloadUrl = `/api/v1/sharing/public/${encodeURIComponent(token)}/download`;

  useEffect(() => {
    if (!token) return;

    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(
          `/api/v1/sharing/public/${encodeURIComponent(token)}`,
          { cache: "no-store" }
        );
        if (cancelled) return;

        if (!response.ok) {
          // Unknown / revoked / expired all collapse into the same state
          // (the backend 404 is intentionally generic).
          setState("notFound");
          return;
        }

        const payload = (await response.json()) as { data: PublicLinkInfo };
        if (cancelled) return;
        setInfo(payload.data);
        setState("ready");
      } catch {
        if (cancelled) return;
        // Static message only — never log the token or the requested URL.
        clientLogger.error("public-viewer.load-failed");
        setState("notFound");
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state === "loading") {
    return (
      <div className="flex min-h-screen flex-col bg-muted/30">
        <PublicViewerHeader />
        <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 p-4">
          <Skeleton className="h-8 w-2/3" data-testid="public-viewer-loading" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="min-h-[60vh] w-full flex-1" />
        </main>
      </div>
    );
  }

  if (state === "notFound" || !info) {
    return (
      <div className="flex min-h-screen flex-col bg-muted/30">
        <PublicViewerHeader />
        <main className="flex flex-1 items-center justify-center p-4">
          <Card className="w-full max-w-md text-center">
            <CardHeader className="items-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <LinkIcon className="h-6 w-6 text-muted-foreground" />
              </div>
              <h1 className="text-lg font-semibold">{t("notFoundTitle")}</h1>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {t("notFoundDescription")}
              </p>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <PublicViewerHeader />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <FileText className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold" title={info.document_name}>
                {info.document_name}
              </h1>
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{t("pageCount", { count: info.page_count })}</span>
                <span aria-hidden>·</span>
                <span>{formatBytes(info.file_size_bytes)}</span>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1">
                  <Eye className="h-3 w-3" />
                  {t("viewOnly")}
                </span>
              </p>
            </div>
          </div>
          <Button asChild size="sm">
            <a href={`${downloadUrl}?dl=true`} download>
              <Download className="mr-2 h-4 w-4" />
              {t("download")}
            </a>
          </Button>
        </div>

        <div className="flex-1 overflow-hidden rounded-lg border bg-background shadow-sm">
          <iframe
            src={downloadUrl}
            title={info.document_name}
            className="h-full min-h-[70vh] w-full"
            data-testid="public-viewer-frame"
          />
        </div>

        <p className="text-center text-xs text-muted-foreground">
          {t("fallbackHint")}
        </p>
      </main>
    </div>
  );
}

/** Sober top bar — logo only, links back to the landing page. */
function PublicViewerHeader() {
  return (
    <header className="flex h-14 items-center border-b bg-background px-4">
      <Logo href="/" size="sm" />
    </header>
  );
}
