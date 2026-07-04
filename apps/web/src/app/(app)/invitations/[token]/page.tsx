"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  Skeleton,
  useToast,
} from "@giga-pdf/ui";
import {
  Check,
  Clock,
  Eye,
  FileText,
  Loader2,
  MailQuestion,
  Shield,
  X,
} from "lucide-react";
import { api, InvitationDetails } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { clientLogger } from "@/lib/client-logger";
import { AuthGuard } from "@/components/auth/auth-guard";
import { Logo } from "@/components/logo";

// Auth by cookies + locale by cookie → dynamic rendering, like every
// authenticated page under (app)/*.
export const dynamic = "force-dynamic";

type ViewState = "loading" | "ready" | "notFound";

/**
 * Invitation landing page — /invitations/[token].
 *
 * The link mailed to an invitee WITHOUT an account lands here (an existing
 * account gets its share auto-activated and is pointed at /shared instead).
 * Unauthenticated visitors are sent to /login by the AuthGuard, sign up /
 * sign in, then come back through the e-mail link to accept or decline.
 */
export default function InvitationPage() {
  return (
    <AuthGuard>
      <InvitationContent />
    </AuthGuard>
  );
}

function InvitationContent() {
  const t = useTranslations("sharing.invitationPage");
  const tPermissions = useTranslations("sharing.dialog.permissions");
  const params = useParams<{ token: string }>();
  const token = params?.token ?? "";
  const router = useRouter();
  const { toast } = useToast();
  const { data: session } = useSession();

  const [state, setState] = useState<ViewState>("loading");
  const [invitation, setInvitation] = useState<InvitationDetails | null>(null);
  const [responding, setResponding] = useState<"accept" | "decline" | null>(
    null,
  );

  const loadInvitation = useCallback(async () => {
    try {
      const details = await api.getInvitationByToken(token);
      setInvitation(details);
      setState("ready");
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      if (status === 404) {
        setState("notFound");
        return;
      }
      clientLogger.error("invitation-page.load-failed", err);
      setState("notFound");
    }
  }, [token]);

  useEffect(() => {
    if (token) {
      void loadInvitation();
    } else {
      setState("notFound");
    }
  }, [token, loadInvitation]);

  const handleAccept = async () => {
    try {
      setResponding("accept");
      await api.acceptInvitation(token);
      toast({ title: t("acceptedToast") });
      router.push("/shared");
    } catch (err) {
      clientLogger.error("invitation-page.accept-failed", err);
      toast({ title: t("acceptFailed"), variant: "destructive" });
      setResponding(null);
      // The invitation may have expired or been handled elsewhere — refresh.
      void loadInvitation();
    }
  };

  const handleDecline = async () => {
    try {
      setResponding("decline");
      await api.declineInvitation(token);
      toast({ title: t("declinedToast") });
      router.push("/dashboard");
    } catch (err) {
      clientLogger.error("invitation-page.decline-failed", err);
      toast({ title: t("declineFailed"), variant: "destructive" });
      setResponding(null);
      void loadInvitation();
    }
  };

  const wrongAccount =
    invitation !== null &&
    !!session?.user?.email &&
    session.user.email.toLowerCase() !== invitation.invitee_email.toLowerCase();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/30 px-4 py-10">
      <div className="mb-8">
        <Logo href="/dashboard" size="sm" />
      </div>

      <Card className="w-full max-w-md">
        {state === "loading" ? (
          <>
            <CardHeader>
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </CardHeader>
            <CardContent className="space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </CardContent>
            <CardFooter className="gap-2">
              <Skeleton className="h-10 w-full" />
            </CardFooter>
          </>
        ) : state === "notFound" ? (
          <StatusPanel
            icon={<MailQuestion className="h-10 w-10 text-muted-foreground" />}
            title={t("notFoundTitle")}
            description={t("notFoundDescription")}
            actionLabel={t("goToDashboard")}
            actionHref="/dashboard"
          />
        ) : invitation && invitation.status === "expired" ? (
          <StatusPanel
            icon={<Clock className="h-10 w-10 text-muted-foreground" />}
            title={t("expiredTitle")}
            description={t("expiredDescription")}
            actionLabel={t("goToDashboard")}
            actionHref="/dashboard"
          />
        ) : invitation && invitation.status === "accepted" ? (
          <StatusPanel
            icon={<Check className="h-10 w-10 text-green-600" />}
            title={t("acceptedTitle")}
            description={t("acceptedDescription")}
            actionLabel={t("goToShared")}
            actionHref="/shared"
          />
        ) : invitation &&
          (invitation.status === "declined" ||
            invitation.status === "revoked") ? (
          <StatusPanel
            icon={<X className="h-10 w-10 text-muted-foreground" />}
            title={
              invitation.status === "declined"
                ? t("declinedTitle")
                : t("revokedTitle")
            }
            description={
              invitation.status === "declined"
                ? t("declinedDescription")
                : t("revokedDescription")
            }
            actionLabel={t("goToDashboard")}
            actionHref="/dashboard"
          />
        ) : invitation ? (
          <>
            <CardHeader className="space-y-1">
              <h1 className="text-xl font-semibold">{t("title")}</h1>
              <p className="text-sm text-muted-foreground">
                {t("invitedBy", {
                  email:
                    invitation.inviter.email ?? t("someoneFallback"),
                })}
              </p>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className="flex items-center gap-3 rounded-lg border bg-muted/50 p-3">
                <FileText className="h-8 w-8 flex-shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {invitation.document.name}
                  </p>
                  <Badge
                    variant={
                      invitation.permission === "edit" ? "default" : "secondary"
                    }
                    className="mt-1"
                  >
                    {invitation.permission === "edit" ? (
                      <Shield className="mr-1 h-3 w-3" />
                    ) : (
                      <Eye className="mr-1 h-3 w-3" />
                    )}
                    {invitation.permission === "edit"
                      ? tPermissions("edit")
                      : tPermissions("view")}
                  </Badge>
                </div>
              </div>

              {invitation.message ? (
                <blockquote className="border-l-2 pl-3 text-sm italic text-muted-foreground">
                  {invitation.message}
                </blockquote>
              ) : null}

              {wrongAccount ? (
                <p className="rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-200">
                  {t("wrongAccount", { email: invitation.invitee_email })}
                </p>
              ) : null}
            </CardContent>

            <CardFooter className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={handleDecline}
                disabled={responding !== null}
              >
                {responding === "decline" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <X className="mr-2 h-4 w-4" />
                )}
                {t("decline")}
              </Button>
              <Button
                className="flex-1"
                onClick={handleAccept}
                disabled={responding !== null}
              >
                {responding === "accept" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Check className="mr-2 h-4 w-4" />
                )}
                {t("accept")}
              </Button>
            </CardFooter>
          </>
        ) : null}
      </Card>
    </div>
  );
}

function StatusPanel({
  icon,
  title,
  description,
  actionLabel,
  actionHref,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel: string;
  actionHref: string;
}) {
  return (
    <>
      <CardHeader className="items-center text-center">
        {icon}
        <h1 className="mt-2 text-xl font-semibold">{title}</h1>
      </CardHeader>
      <CardContent>
        <p className="text-center text-sm text-muted-foreground">
          {description}
        </p>
      </CardContent>
      <CardFooter>
        <Button asChild className="w-full">
          <Link href={actionHref}>{actionLabel}</Link>
        </Button>
      </CardFooter>
    </>
  );
}
