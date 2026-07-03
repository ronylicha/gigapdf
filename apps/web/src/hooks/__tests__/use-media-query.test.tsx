/**
 * use-media-query.test.tsx
 *
 * SSR/jsdom-safe media-query hook:
 * - no `window.matchMedia` (bare jsdom) → DESKTOP default (false), no crash;
 * - with matchMedia → reads `matches` synchronously and follows "change"
 *   events via useSyncExternalStore.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import {
  useMediaQuery,
  useIsMobile,
  MOBILE_MEDIA_QUERY,
} from "../use-media-query";

type ChangeListener = (ev: { matches: boolean }) => void;

/** Minimal controllable matchMedia stub. */
function installMatchMedia(initialMatches: Record<string, boolean>) {
  const listeners = new Map<string, Set<ChangeListener>>();
  const state = { ...initialMatches };

  const matchMedia = vi.fn((query: string) => ({
    matches: state[query] ?? false,
    media: query,
    addEventListener: (_type: "change", cb: ChangeListener) => {
      if (!listeners.has(query)) listeners.set(query, new Set());
      listeners.get(query)!.add(cb);
    },
    removeEventListener: (_type: "change", cb: ChangeListener) => {
      listeners.get(query)?.delete(cb);
    },
  }));

  (window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia =
    matchMedia as unknown as typeof window.matchMedia;

  return {
    matchMedia,
    setMatches(query: string, matches: boolean) {
      state[query] = matches;
      for (const cb of listeners.get(query) ?? []) {
        cb({ matches });
      }
    },
    listenerCount(query: string) {
      return listeners.get(query)?.size ?? 0;
    },
  };
}

afterEach(() => {
  cleanup();
  // jsdom has no native matchMedia — restore the bare environment.
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
});

describe("useMediaQuery", () => {
  it("defaults to DESKTOP (false) when matchMedia is unavailable (jsdom)", () => {
    expect(window.matchMedia).toBeUndefined();
    const { result } = renderHook(() => useMediaQuery("(max-width: 767px)"));
    expect(result.current).toBe(false);
  });

  it("reads the initial matches value synchronously", () => {
    installMatchMedia({ "(max-width: 767px)": true });
    const { result } = renderHook(() => useMediaQuery("(max-width: 767px)"));
    expect(result.current).toBe(true);
  });

  it("follows 'change' events (resize across the breakpoint)", () => {
    const env = installMatchMedia({ "(max-width: 767px)": false });
    const { result } = renderHook(() => useMediaQuery("(max-width: 767px)"));
    expect(result.current).toBe(false);

    act(() => env.setMatches("(max-width: 767px)", true));
    expect(result.current).toBe(true);

    act(() => env.setMatches("(max-width: 767px)", false));
    expect(result.current).toBe(false);
  });

  it("unsubscribes the change listener on unmount", () => {
    const env = installMatchMedia({ "(max-width: 767px)": false });
    const { unmount } = renderHook(() => useMediaQuery("(max-width: 767px)"));
    expect(env.listenerCount("(max-width: 767px)")).toBe(1);
    unmount();
    expect(env.listenerCount("(max-width: 767px)")).toBe(0);
  });
});

describe("useIsMobile", () => {
  it("is false (desktop) in a bare jsdom environment", () => {
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it("matches the md boundary query when matchMedia reports mobile", () => {
    installMatchMedia({ [MOBILE_MEDIA_QUERY]: true });
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });
});
