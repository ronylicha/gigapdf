"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
  Separator,
  Skeleton,
} from "@giga-pdf/ui";
import {
  Bell,
  Check,
  CheckCheck,
  Shield,
  ShieldOff,
  UserPlus,
  X,
} from "lucide-react";
import { api, type ShareNotification } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Poll cadence for the unread badge (light endpoint, badge only). */
const UNREAD_POLL_INTERVAL_MS = 60_000;
/** How many notifications the popover lists. */
const LIST_PAGE_SIZE = 10;
/** Badge display cap. */
const BADGE_CAP = 99;

const UNREAD_COUNT_QUERY_KEY = ["sharing", "notifications", "unread-count"] as const;
const LIST_QUERY_KEY = ["sharing", "notifications", "list"] as const;

/**
 * Notification bell for the dashboard header.
 *
 * Badge = unread count (polled every 60s + on window focus). The popover
 * lists the ~10 latest sharing notifications; clicking one marks it read and
 * navigates to the relevant place (`/documents/[id]` for owner-side events,
 * `/shared` for invitee-side events). Unknown notification types degrade to
 * the backend title (or a generic label) — never crash on new types.
 */
export function NotificationBell() {
  const t = useTranslations("sharing.notifications");
  const tPermissions = useTranslations("sharing.dialog.permissions");
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const unreadQuery = useQuery({
    queryKey: UNREAD_COUNT_QUERY_KEY,
    queryFn: () => api.getUnreadNotificationCount(),
    refetchInterval: UNREAD_POLL_INTERVAL_MS,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

  const listQuery = useQuery({
    queryKey: LIST_QUERY_KEY,
    queryFn: () => api.getNotifications({ page: 1, per_page: LIST_PAGE_SIZE }),
    enabled: open,
    refetchOnWindowFocus: true,
  });

  const invalidateNotifications = () => {
    void queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: LIST_QUERY_KEY });
  };

  const markReadMutation = useMutation({
    mutationFn: (notificationId: string) =>
      api.markNotificationRead(notificationId),
    onSettled: invalidateNotifications,
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => api.markAllNotificationsRead(),
    onSettled: invalidateNotifications,
  });

  const unreadCount = unreadQuery.data?.unread_count ?? 0;
  const badgeLabel = unreadCount > BADGE_CAP ? `${BADGE_CAP}+` : `${unreadCount}`;
  const notifications = listQuery.data?.notifications ?? [];

  const handleNotificationClick = (notification: ShareNotification) => {
    if (!notification.is_read) {
      markReadMutation.mutate(notification.id);
    }
    setOpen(false);
    router.push(notificationTarget(notification));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={
            unreadCount > 0
              ? t("ariaLabelUnread", { count: unreadCount })
              : t("ariaLabel")
          }
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 ? (
            <span
              data-testid="notification-badge"
              className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground"
            >
              {badgeLabel}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between px-4 py-3">
          <h2 className="text-sm font-semibold">{t("title")}</h2>
          {unreadCount > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => markAllReadMutation.mutate()}
              disabled={markAllReadMutation.isPending}
            >
              <CheckCheck className="h-3.5 w-3.5" />
              {t("markAllAsRead")}
            </Button>
          ) : null}
        </div>
        <Separator />
        {listQuery.isLoading ? (
          <div className="space-y-3 p-4" data-testid="notifications-loading">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : notifications.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            {t("empty")}
          </p>
        ) : (
          <ScrollArea className="max-h-96">
            <ul className="divide-y">
              {notifications.map((notification) => (
                <li key={notification.id}>
                  <button
                    type="button"
                    onClick={() => handleNotificationClick(notification)}
                    className={cn(
                      "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted",
                      !notification.is_read && "bg-muted/50"
                    )}
                  >
                    <NotificationIcon type={notification.type} />
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block truncate text-sm",
                          notification.is_read
                            ? "text-muted-foreground"
                            : "font-medium text-foreground"
                        )}
                      >
                        {notificationText(notification, t, tPermissions)}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {formatRelativeTime(notification.created_at, locale)}
                      </span>
                    </span>
                    {!notification.is_read ? (
                      <span
                        aria-hidden
                        data-testid="unread-dot"
                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary"
                      />
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Known backend notification types (app/services/notification_service.py). */
const NOTIFICATION_ICONS: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  share_invitation: UserPlus,
  share_accepted: Check,
  share_declined: X,
  share_revoked: ShieldOff,
  permission_changed: Shield,
};

function NotificationIcon({ type }: { type: string }) {
  const Icon = NOTIFICATION_ICONS[type] ?? Bell;
  return (
    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
      <Icon className="h-3.5 w-3.5 text-primary" />
    </span>
  );
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * Localized text for a notification, from its type + extra_data (metadata).
 *
 * The backend stores English title/message strings; the localized text is
 * rebuilt client-side from the structured metadata each type carries
 * (document_name always; accepter_email for share_accepted; new_permission
 * for permission_changed). Missing metadata (legacy rows) or an unknown type
 * fall back to the backend title, then to a generic label.
 */
function notificationText(
  notification: ShareNotification,
  t: Translate,
  tPermissions: Translate
): string {
  const meta = (notification.metadata ?? {}) as Record<string, unknown>;
  const documentName =
    (typeof meta.document_name === "string" && meta.document_name) ||
    notification.document?.name ||
    "";
  const fallback = notification.title || t("types.unknown");

  switch (notification.type) {
    case "share_invitation":
      return documentName
        ? t("types.share_invitation", { document: documentName })
        : fallback;
    case "share_accepted": {
      const email =
        typeof meta.accepter_email === "string" ? meta.accepter_email : "";
      return documentName && email
        ? t("types.share_accepted", { email, document: documentName })
        : fallback;
    }
    case "share_declined":
      return documentName
        ? t("types.share_declined", { document: documentName })
        : fallback;
    case "share_revoked":
      return documentName
        ? t("types.share_revoked", { document: documentName })
        : fallback;
    case "permission_changed": {
      const newPermission =
        meta.new_permission === "view" || meta.new_permission === "edit"
          ? tPermissions(meta.new_permission)
          : "";
      return documentName && newPermission
        ? t("types.permission_changed", {
            document: documentName,
            permission: newPermission,
          })
        : fallback;
    }
    default:
      return fallback;
  }
}

/**
 * Where a notification click lands.
 *
 * Owner-side events (someone answered MY invitation) → the document page;
 * invitee-side events (a document was shared with me / my access changed)
 * → the "Shared with me" list.
 */
function notificationTarget(notification: ShareNotification): string {
  switch (notification.type) {
    case "share_accepted":
    case "share_declined":
      return notification.document
        ? `/documents/${notification.document.id}`
        : "/documents";
    default:
      return "/shared";
  }
}

/** Locale-aware relative timestamp ("il y a 3 min") — no date lib needed. */
function formatRelativeTime(iso: string, locale: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";

  const diffSeconds = Math.round((then - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];

  const magnitude = Math.abs(diffSeconds);
  for (const [unit, secondsPerUnit] of units) {
    if (magnitude >= secondsPerUnit) {
      return rtf.format(Math.trunc(diffSeconds / secondsPerUnit), unit);
    }
  }
  return rtf.format(diffSeconds, "second");
}
