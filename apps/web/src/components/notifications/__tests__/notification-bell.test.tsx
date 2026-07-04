/**
 * Tests for NotificationBell — the dashboard header notification center.
 *
 * Covered:
 *   - the badge reflects the unread count (and caps at 99+), hidden at 0
 *   - opening the popover fetches and renders the latest notifications with
 *     localized per-type texts built from extra_data metadata
 *   - clicking an UNREAD notification calls markNotificationRead and
 *     navigates to the type-dependent target (/shared vs /documents/[id])
 *   - clicking a READ notification navigates without marking again
 *   - "mark all as read" calls the bulk endpoint
 *   - an unknown notification type degrades to the backend title
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { createContext, useContext } from 'react';

// vitest.config.ts runs with isolate:false — RTL auto-cleanup does not fire
// across files sharing the fork, so clean the DOM explicitly (repo convention).
afterEach(cleanup);

// ── Mocks (must be declared before imports) ───────────────────────────────────

const pushSpy = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushSpy }),
}));

vi.mock('next-intl', () => ({
  // Namespaced key + inlined values so per-type texts are assertable.
  useTranslations: (ns?: string) => (key: string, values?: Record<string, unknown>) => {
    const base = ns ? `${ns}.${key}` : key;
    if (!values) return base;
    const inline = Object.entries(values)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join('|');
    return `${base}|${inline}`;
  },
  useLocale: () => 'fr',
}));

vi.mock('@/lib/api', () => ({
  api: {
    getUnreadNotificationCount: vi.fn(),
    getNotifications: vi.fn(),
    markNotificationRead: vi.fn().mockResolvedValue({ marked_as_read: true }),
    markAllNotificationsRead: vi.fn().mockResolvedValue({ marked_count: 2 }),
  },
}));

// Radix Popover replaced by a controlled stand-in faithful to the contract
// (open/onOpenChange + content rendered only when open) so the "fetch the
// list on open" behaviour is really exercised (same strategy as the editor
// toolbar menu tests).
vi.mock('@giga-pdf/ui', () => {
  const PopoverCtx = createContext<{
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }>({});

  const Popover = ({
    children,
    open,
    onOpenChange,
  }: {
    children?: React.ReactNode;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }) => (
    <PopoverCtx.Provider value={{ open, onOpenChange }}>
      <div>{children}</div>
    </PopoverCtx.Provider>
  );

  const PopoverTrigger = ({ children }: { children?: React.ReactNode; asChild?: boolean }) => {
    const ctx = useContext(PopoverCtx);
    return (
      <span
        data-testid="popover-trigger"
        onClick={() => ctx.onOpenChange?.(!ctx.open)}
      >
        {children}
      </span>
    );
  };

  const PopoverContent = ({ children }: { children?: React.ReactNode; align?: string; className?: string }) => {
    const ctx = useContext(PopoverCtx);
    return ctx.open ? <div data-testid="popover-content">{children}</div> : null;
  };

  const Button = ({
    children,
    asChild: _asChild,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    children?: React.ReactNode;
    asChild?: boolean;
    variant?: string;
    size?: string;
  }) => {
    const { variant: _v, size: _s, ...rest } = props as Record<string, unknown>;
    return <button {...(rest as object)}>{children}</button>;
  };

  return {
    Popover,
    PopoverTrigger,
    PopoverContent,
    Button,
    ScrollArea: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Separator: () => <hr />,
    Skeleton: ({ ...props }: Record<string, unknown>) => <div {...props} />,
  };
});

import { NotificationBell } from '../notification-bell';
import { api, type ShareNotification } from '@/lib/api';

const getUnreadMock = vi.mocked(api.getUnreadNotificationCount);
const getNotificationsMock = vi.mocked(api.getNotifications);
const markReadMock = vi.mocked(api.markNotificationRead);
const markAllReadMock = vi.mocked(api.markAllNotificationsRead);

function makeNotification(overrides: Partial<ShareNotification> = {}): ShareNotification {
  return {
    id: 'notif-1',
    type: 'share_invitation',
    title: 'Document shared with you',
    message: "You now have access to 'Contrat.pdf'",
    document: { id: 'doc-1', name: 'Contrat.pdf' },
    metadata: { document_name: 'Contrat.pdf', permission: 'edit' },
    is_read: false,
    created_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    ...overrides,
  };
}

function listResponse(notifications: ShareNotification[]) {
  return {
    notifications,
    total: notifications.length,
    page: 1,
    per_page: 10,
    total_pages: 1,
  };
}

function renderBell() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <NotificationBell />
    </QueryClientProvider>,
  );
}

async function openPopover() {
  renderBell();
  fireEvent.click(screen.getByTestId('popover-trigger'));
  await waitFor(() => expect(screen.getByTestId('popover-content')).toBeInTheDocument());
}

beforeEach(() => {
  vi.clearAllMocks();
  getUnreadMock.mockResolvedValue({ unread_count: 0 });
  getNotificationsMock.mockResolvedValue(listResponse([]));
  markReadMock.mockResolvedValue({ marked_as_read: true });
  markAllReadMock.mockResolvedValue({ marked_count: 2 });
});

describe('NotificationBell — badge', () => {
  it('shows the unread count', async () => {
    getUnreadMock.mockResolvedValue({ unread_count: 3 });

    renderBell();

    expect(await screen.findByTestId('notification-badge')).toHaveTextContent('3');
  });

  it('caps the badge at 99+', async () => {
    getUnreadMock.mockResolvedValue({ unread_count: 142 });

    renderBell();

    expect(await screen.findByTestId('notification-badge')).toHaveTextContent('99+');
  });

  it('hides the badge when everything is read', async () => {
    getUnreadMock.mockResolvedValue({ unread_count: 0 });

    renderBell();

    await waitFor(() => expect(getUnreadMock).toHaveBeenCalled());
    expect(screen.queryByTestId('notification-badge')).not.toBeInTheDocument();
  });
});

describe('NotificationBell — list', () => {
  it('fetches the latest notifications when opened and renders localized texts', async () => {
    getNotificationsMock.mockResolvedValue(
      listResponse([
        makeNotification(),
        makeNotification({
          id: 'notif-2',
          type: 'share_accepted',
          metadata: { document_name: 'Contrat.pdf', accepter_email: 'alice@example.com' },
          is_read: true,
        }),
      ]),
    );

    await openPopover();

    await waitFor(() =>
      expect(getNotificationsMock).toHaveBeenCalledWith({ page: 1, per_page: 10 }),
    );
    expect(
      await screen.findByText(
        'sharing.notifications.types.share_invitation|document=Contrat.pdf',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'sharing.notifications.types.share_accepted|email=alice@example.com|document=Contrat.pdf',
      ),
    ).toBeInTheDocument();
  });

  it('shows an empty state when there is nothing', async () => {
    await openPopover();

    expect(await screen.findByText('sharing.notifications.empty')).toBeInTheDocument();
  });

  it('degrades gracefully on an unknown notification type', async () => {
    getNotificationsMock.mockResolvedValue(
      listResponse([
        makeNotification({
          id: 'notif-x',
          type: 'brand_new_type',
          title: 'Something new happened',
          metadata: null,
          document: null,
        }),
      ]),
    );

    await openPopover();

    expect(await screen.findByText('Something new happened')).toBeInTheDocument();
  });
});

describe('NotificationBell — interactions', () => {
  it('marks an unread notification read and navigates to /shared', async () => {
    getUnreadMock.mockResolvedValue({ unread_count: 1 });
    getNotificationsMock.mockResolvedValue(listResponse([makeNotification()]));

    await openPopover();

    fireEvent.click(
      await screen.findByText(
        'sharing.notifications.types.share_invitation|document=Contrat.pdf',
      ),
    );

    await waitFor(() => expect(markReadMock).toHaveBeenCalledWith('notif-1'));
    expect(pushSpy).toHaveBeenCalledWith('/shared');
  });

  it('navigates owner-side events to the document page', async () => {
    getNotificationsMock.mockResolvedValue(
      listResponse([
        makeNotification({
          id: 'notif-2',
          type: 'share_accepted',
          metadata: { document_name: 'Contrat.pdf', accepter_email: 'alice@example.com' },
        }),
      ]),
    );

    await openPopover();

    fireEvent.click(
      await screen.findByText(
        'sharing.notifications.types.share_accepted|email=alice@example.com|document=Contrat.pdf',
      ),
    );

    await waitFor(() => expect(pushSpy).toHaveBeenCalledWith('/documents/doc-1'));
  });

  it('does not re-mark an already read notification', async () => {
    getNotificationsMock.mockResolvedValue(
      listResponse([makeNotification({ is_read: true })]),
    );

    await openPopover();

    fireEvent.click(
      await screen.findByText(
        'sharing.notifications.types.share_invitation|document=Contrat.pdf',
      ),
    );

    await waitFor(() => expect(pushSpy).toHaveBeenCalledWith('/shared'));
    expect(markReadMock).not.toHaveBeenCalled();
  });

  it('marks everything read from the header action', async () => {
    getUnreadMock.mockResolvedValue({ unread_count: 2 });
    getNotificationsMock.mockResolvedValue(
      listResponse([makeNotification(), makeNotification({ id: 'notif-2' })]),
    );

    await openPopover();

    fireEvent.click(await screen.findByText('sharing.notifications.markAllAsRead'));

    await waitFor(() => expect(markAllReadMock).toHaveBeenCalled());
  });
});
