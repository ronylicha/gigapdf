"use client";

import { useState, useEffect } from "react";
import { useTranslations, useLocale } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Button,
  Input,
  Label,
  Textarea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Badge,
  Separator,
  useToast,
} from "@giga-pdf/ui";
import {
  Loader2,
  Send,
  User,
  Shield,
  Eye,
  Trash2,
  Link,
  Copy,
  Check,
  X,
} from "lucide-react";
import { api, DocumentShareInfo, ShareInvitation } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { clientLogger } from "@/lib/client-logger";

interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
  documentName: string;
  onShareSuccess?: () => void;
}

export function ShareDialog({
  open,
  onOpenChange,
  documentId,
  documentName,
  onShareSuccess,
}: ShareDialogProps) {
  const t = useTranslations("sharing");
  const locale = useLocale();
  const { toast } = useToast();
  const { data: session } = useSession();

  // Form states
  const [email, setEmail] = useState("");
  const [permission, setPermission] = useState<"view" | "edit">("edit");
  const [message, setMessage] = useState("");
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Current shares
  const [shares, setShares] = useState<DocumentShareInfo[]>([]);
  const [loadingShares, setLoadingShares] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  // Public link
  const [publicLinkUrl, setPublicLinkUrl] = useState<string | null>(null);
  const [creatingPublicLink, setCreatingPublicLink] = useState(false);
  const [revokingPublicLink, setRevokingPublicLink] = useState(false);
  const [publicLinkCopied, setPublicLinkCopied] = useState(false);

  // Load current shares when dialog opens
  useEffect(() => {
    if (open && documentId) {
      loadShares();
    }
  }, [open, documentId]);

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      setEmail("");
      setMessage("");
      setError(null);
      setSuccess(false);
    }
  }, [open]);

  const loadShares = async () => {
    try {
      setLoadingShares(true);
      const response = await api.getDocumentShares(documentId);
      setShares(response.shares);
      // Check if there's a public link among shares
      const publicShare = response.shares.find((s: DocumentShareInfo) => s.is_public_link);
      if (publicShare?.share_token) {
        setPublicLinkUrl(`${window.location.origin}/public/${publicShare.share_token}`);
      }
    } catch (err) {
      clientLogger.error("share-dialog.load-shares-failed", err);
    } finally {
      setLoadingShares(false);
    }
  };

  /**
   * Fire-and-forget invitation e-mail. An e-mail failure never blocks the
   * share (it is already effective server-side) — it only surfaces as a
   * non-blocking warning toast. The token never reaches the console/logs.
   */
  const notifyInvitee = async (
    invitation: ShareInvitation,
    inviteeEmail: string,
  ) => {
    try {
      const response = await fetch("/api/share/notify", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteeEmail,
          documentName,
          permission: invitation.permission,
          inviterName:
            session?.user?.name || session?.user?.email || undefined,
          locale,
          invitationId: invitation.invitation_id,
          // Existing account → share is already ACTIVE, e-mail links to
          // /shared. No account yet → e-mail carries the invitation link.
          ...(invitation.invitee_user_exists
            ? { shareId: invitation.share_id ?? invitation.invitation_id }
            : { invitationToken: invitation.token }),
        }),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (err) {
      clientLogger.warn("share-dialog.notify-email-failed", err);
      toast({ title: t("dialog.emailWarning") });
    }
  };

  const handleShare = async () => {
    if (!email.trim()) {
      setError(t("dialog.emailRequired"));
      return;
    }

    try {
      setSharing(true);
      setError(null);

      const inviteeEmail = email.trim();
      const invitation = await api.shareDocument({
        document_id: documentId,
        invitee_email: inviteeEmail,
        permission,
        message: message.trim() || undefined,
      });

      // Fire-and-forget: the share is done; the e-mail must not block it.
      void notifyInvitee(invitation, inviteeEmail);

      setSuccess(true);
      setEmail("");
      setMessage("");
      await loadShares();
      onShareSuccess?.();

      // Reset success message after 3 seconds
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      clientLogger.error("share-dialog.share-failed", err);
      setError(t("dialog.error"));
    } finally {
      setSharing(false);
    }
  };

  const handleRevokeShare = async (shareId: string) => {
    try {
      setRevokingId(shareId);
      await api.revokeShare(shareId);
      await loadShares();
    } catch (err) {
      clientLogger.error("share-dialog.revoke-share-failed", err);
    } finally {
      setRevokingId(null);
    }
  };

  const handleUpdatePermission = async (shareId: string, newPermission: "view" | "edit") => {
    try {
      await api.updateSharePermission(shareId, newPermission);
      await loadShares();
    } catch (err) {
      clientLogger.error("share-dialog.update-permission-failed", err);
    }
  };

  const handleCreatePublicLink = async () => {
    try {
      setCreatingPublicLink(true);
      const response = await api.createPublicLink(documentId);
      setPublicLinkUrl(`${window.location.origin}/public/${response.token}`);
    } catch (err) {
      clientLogger.error("share-dialog.create-public-link-failed", err);
    } finally {
      setCreatingPublicLink(false);
    }
  };

  const handleRevokePublicLink = async () => {
    try {
      setRevokingPublicLink(true);
      await api.revokePublicLink(documentId);
      setPublicLinkUrl(null);
    } catch (err) {
      clientLogger.error("share-dialog.revoke-public-link-failed", err);
    } finally {
      setRevokingPublicLink(false);
    }
  };

  const handleCopyPublicLink = async () => {
    if (publicLinkUrl) {
      try {
        await navigator.clipboard.writeText(publicLinkUrl);
        setPublicLinkCopied(true);
        setTimeout(() => setPublicLinkCopied(false), 2000);
      } catch (err) {
        clientLogger.error("share-dialog.copy-failed", err);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("dialog.title")}</DialogTitle>
          <DialogDescription>
            {t("dialog.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Share by email form */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="share-email">{t("dialog.email")}</Label>
              <Input
                id="share-email"
                type="email"
                placeholder={t("dialog.emailPlaceholder")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={sharing}
              />
            </div>

            <div className="space-y-2">
              <Label>{t("dialog.permission")}</Label>
              <Select
                value={permission}
                onValueChange={(value) => setPermission(value as "view" | "edit")}
                disabled={sharing}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="edit">
                    <div className="flex items-center gap-2">
                      <Shield className="h-4 w-4" />
                      {t("dialog.permissions.edit")}
                    </div>
                  </SelectItem>
                  <SelectItem value="view">
                    <div className="flex items-center gap-2">
                      <Eye className="h-4 w-4" />
                      {t("dialog.permissions.view")}
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="share-message">{t("dialog.message")}</Label>
              <Textarea
                id="share-message"
                placeholder={t("dialog.messagePlaceholder")}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                disabled={sharing}
                rows={2}
              />
            </div>

            {error && (
              <div className="text-sm text-destructive">{error}</div>
            )}

            {success && (
              <div className="text-sm text-green-600">{t("dialog.success")}</div>
            )}

            <Button
              onClick={handleShare}
              disabled={sharing || !email.trim()}
              className="w-full"
            >
              {sharing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("dialog.sharing")}
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  {t("dialog.share")}
                </>
              )}
            </Button>
          </div>

          <Separator />

          {/* Current shares */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium">{t("currentShares.title")}</h4>

            {loadingShares ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : shares.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">
                {t("currentShares.noShares")}
              </p>
            ) : (
              <div className="space-y-2">
                {shares.map((share) => (
                  <div
                    key={share.share_id}
                    className="flex items-center justify-between p-2 rounded-lg bg-muted/50"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <User className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                      <span className="text-sm truncate">{share.shared_with?.email || share.invitee_email}</span>
                      <Badge
                        variant={share.permission === "edit" ? "default" : "secondary"}
                        className="flex-shrink-0"
                      >
                        {share.permission === "edit" ? (
                          <Shield className="h-3 w-3 mr-1" />
                        ) : (
                          <Eye className="h-3 w-3 mr-1" />
                        )}
                        {share.permission === "edit"
                          ? t("dialog.permissions.edit")
                          : t("dialog.permissions.view")}
                      </Badge>
                    </div>
                    {share.share_id && (
                      <div className="flex items-center gap-1">
                        <Select
                          value={share.permission}
                          onValueChange={(value) =>
                            handleUpdatePermission(share.share_id!, value as "view" | "edit")
                          }
                        >
                          <SelectTrigger className="h-7 w-auto border-0 bg-transparent">
                            <span className="sr-only">{t("currentShares.changePermission")}</span>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="edit">{t("dialog.permissions.edit")}</SelectItem>
                            <SelectItem value="view">{t("dialog.permissions.view")}</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => handleRevokeShare(share.share_id!)}
                          disabled={revokingId === share.share_id}
                        >
                          {revokingId === share.share_id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <Separator />

          {/* Public link */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium">{t("publicLink.title")}</h4>
            <p className="text-sm text-muted-foreground">
              {t("publicLink.description")}
            </p>

            {publicLinkUrl ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Input
                    value={publicLinkUrl}
                    readOnly
                    className="flex-1 text-xs"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleCopyPublicLink}
                  >
                    {publicLinkCopied ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleRevokePublicLink}
                  disabled={revokingPublicLink}
                  className="w-full"
                >
                  {revokingPublicLink ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <X className="mr-2 h-4 w-4" />
                  )}
                  {t("publicLink.revoke")}
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                onClick={handleCreatePublicLink}
                disabled={creatingPublicLink}
                className="w-full"
              >
                {creatingPublicLink ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Link className="mr-2 h-4 w-4" />
                )}
                {t("publicLink.create")}
              </Button>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("dialog.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
