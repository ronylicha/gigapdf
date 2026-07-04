"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import {
  apiClient,
  setApiConfig,
  setAuthTokenProvider,
  QueryProvider,
} from "@giga-pdf/api";
import { getAuthToken } from "@/lib/auth-token";

// The shared apiClient (packages/api) attaches its bearer token from
// localStorage by default — but the better-auth JWT is kept IN MEMORY only
// (anti-XSS, see lib/auth-token.ts). Without this, every editor request that
// goes through apiClient (notably the document /layers query, v1.9.0) sends NO
// Authorization header → 401 → the client's 401 handler then logs the user out
// and the editor breaks on scroll. Install an async request interceptor that
// injects the in-memory token. Module-level + guard so it registers exactly
// once (survives React StrictMode's double effect run), browser-only.
let apiAuthInterceptorInstalled = false;
function installApiAuthInterceptor(): void {
  if (apiAuthInterceptorInstalled) return;
  apiAuthInterceptorInstalled = true;
  apiClient.interceptors.request.use(async (config) => {
    const token = await getAuthToken();
    if (token) {
      config.headers = config.headers ?? {};
      (config.headers as Record<string, string>).Authorization = `Bearer ${token}`;
    }
    return config;
  });
}
if (typeof window !== "undefined") {
  installApiAuthInterceptor();
  // Même source de token pour le handshake WebSocket : le SocketClient lisait
  // getTokenStorage() (localStorage, jamais alimenté ici) → auth vide → toute
  // connexion collaboration refusée par le backend. La callback `auth` de
  // socket.io ré-évalue ce provider à chaque (re)connexion (refresh couvert).
  setAuthTokenProvider(getAuthToken);
}

// Lazy load ThemeProvider to avoid SSG issues
const DynamicThemeProvider = dynamic(
  () => import("next-themes").then((mod) => mod.ThemeProvider),
  { ssr: false }
);

// Configure API client with Next.js environment variables
function ApiConfigProvider({ children }: { children?: React.ReactNode }) {
  useEffect(() => {
    // Set API configuration from Next.js environment variables. This runs in the
    // browser, so fall back to the CURRENT ORIGIN (prod: https://giga-pdf.com)
    // instead of the internal dev URL — NEXT_PUBLIC_API_URL is inlined at build
    // time and, when unset, the old localhost:8000 fallback leaked into the
    // bundle and got blocked by CSP (editor layers + fonts). Dev sets the var
    // explicitly, so this fallback is prod/same-origin only.
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || window.location.origin;
    const wsUrl =
      process.env.NEXT_PUBLIC_WS_URL ||
      `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;

    setApiConfig({
      baseURL: `${apiUrl}/api/v1`,
      websocketURL: wsUrl,
    });
  }, []);

  return <>{children}</>;
}

export function Providers({ children }: { children?: React.ReactNode }) {
  return (
    <QueryProvider>
      <DynamicThemeProvider
        attribute="class"
        defaultTheme="light"
        enableSystem
        disableTransitionOnChange
      >
        <ApiConfigProvider>{children as React.ReactNode}</ApiConfigProvider>
      </DynamicThemeProvider>
    </QueryProvider>
  );
}
