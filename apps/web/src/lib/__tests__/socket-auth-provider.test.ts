/**
 * Contrat d'authentification du handshake WebSocket (@giga-pdf/api).
 *
 * Le SocketClient lisait getTokenStorage().getAccessToken() (localStorage),
 * jamais alimenté par apps/web (JWT Better Auth en mémoire uniquement) → le
 * handshake partait sans token et le backend refusait toute connexion.
 *
 * Ces tests pinnent le fix : setAuthTokenProvider() branche la même source
 * de token que l'intercepteur axios, la callback `auth` de socket.io la
 * ré-évalue à chaque (re)connexion, et le transport est websocket-only
 * (uvicorn multi-workers derrière nginx sans sticky sessions : le handshake
 * long-polling n'est pas sticky).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ioMock = vi.fn();

vi.mock("socket.io-client", () => ({
  io: (...args: unknown[]) => ioMock(...args),
}));

import {
  socketClient,
  setAuthTokenProvider,
  setApiConfig,
} from "@giga-pdf/api";

type AuthCallback = (data: object) => void;
type IoOptions = {
  auth: (cb: AuthCallback) => void | Promise<void>;
  transports: string[];
};

function makeFakeSocket() {
  return {
    connected: false,
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
  };
}

/** Connecte le client et retourne les options passées à io(). */
function connectAndCaptureOptions(): IoOptions {
  socketClient.connect();
  expect(ioMock).toHaveBeenCalledTimes(1);
  const call = ioMock.mock.calls[0] as [string, IoOptions];
  return call[1];
}

/** Résout le payload fourni par la callback auth de socket.io. */
async function resolveAuthPayload(options: IoOptions): Promise<{ token?: string | null }> {
  let payload: { token?: string | null } = {};
  await options.auth((data) => {
    payload = data as { token?: string | null };
  });
  return payload;
}

describe("SocketClient auth handshake", () => {
  beforeEach(() => {
    ioMock.mockReset();
    ioMock.mockImplementation(() => makeFakeSocket());
    setApiConfig({
      baseURL: "https://example.test/api/v1",
      websocketURL: "wss://example.test",
    });
  });

  afterEach(() => {
    setAuthTokenProvider(null);
    socketClient.disconnect();
  });

  it("provider posé → la callback auth fournit le token du provider", async () => {
    setAuthTokenProvider(async () => "jwt-from-better-auth");

    const options = connectAndCaptureOptions();
    const payload = await resolveAuthPayload(options);

    expect(payload.token).toBe("jwt-from-better-auth");
  });

  it("la callback auth est ré-évaluée à chaque appel (refresh de token couvert)", async () => {
    const tokens = ["token-1", "token-2"];
    setAuthTokenProvider(() => tokens.shift() ?? null);

    const options = connectAndCaptureOptions();

    expect((await resolveAuthPayload(options)).token).toBe("token-1");
    // Simule la reconnexion : socket.io ré-invoque la même callback auth.
    expect((await resolveAuthPayload(options)).token).toBe("token-2");
  });

  it("provider qui throw → token null (pas de crash du handshake)", async () => {
    setAuthTokenProvider(() => {
      throw new Error("token endpoint down");
    });

    const options = connectAndCaptureOptions();
    const payload = await resolveAuthPayload(options);

    expect(payload.token).toBeNull();
  });

  it("sans provider → fallback tokenStorage legacy (null en jsdom vierge)", async () => {
    const options = connectAndCaptureOptions();
    const payload = await resolveAuthPayload(options);

    // Le tokenStorage par défaut lit localStorage (vide ici) → null, mais la
    // callback répond toujours (le handshake part, le backend tranche).
    expect(payload.token).toBeNull();
  });

  it("force le transport websocket-only (pas de long-polling non sticky)", () => {
    const options = connectAndCaptureOptions();

    expect(options.transports).toEqual(["websocket"]);
  });
});
