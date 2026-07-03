"use client";

/**
 * useMediaQuery / useIsMobile — SSR-safe media-query subscription.
 *
 * Built on useSyncExternalStore so the value is read synchronously during
 * render and updates via the MediaQueryList "change" event.
 *
 * Defaults are DESKTOP-first:
 * - `getServerSnapshot` returns false (query not matched) so SSR markup is the
 *   desktop layout; the client corrects after hydration if needed.
 * - Environments without `window.matchMedia` (jsdom test runs) also resolve to
 *   false — existing component tests keep rendering the desktop layout without
 *   any matchMedia mock.
 */
import { useCallback, useSyncExternalStore } from "react";

function hasMatchMedia(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function";
}

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!hasMatchMedia()) {
        return () => {};
      }
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onStoreChange);
      return () => mql.removeEventListener("change", onStoreChange);
    },
    [query],
  );

  const getSnapshot = useCallback(() => {
    if (!hasMatchMedia()) {
      return false; // desktop default (jsdom / non-browser)
    }
    return window.matchMedia(query).matches;
  }, [query]);

  // Desktop default at SSR: the query is considered not matched.
  const getServerSnapshot = useCallback(() => false, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Tailwind `md` breakpoint boundary: below 768px is "mobile". */
export const MOBILE_MEDIA_QUERY = "(max-width: 767px)";

/** Tailwind `lg` breakpoint boundary: below 1024px is "compact" (drawer panels). */
export const COMPACT_MEDIA_QUERY = "(max-width: 1023px)";

/** True below the `md` breakpoint (<768px). Desktop (false) at SSR/jsdom. */
export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_MEDIA_QUERY);
}
