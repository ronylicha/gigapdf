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

/**
 * Régression collaboration (cold-start) : un handler abonné via on() PENDANT
 * que le socket se connecte (cas réel — les hooks de présence/curseur de
 * l'éditeur s'abonnent juste après que joinDocument() a déclenché connect())
 * doit être lié au socket vivant lorsque l'événement 'connect' survient.
 *
 * Avant le fix, on() ne liait le handler que si `socket.connected` (false
 * pendant le handshake) et le 'connect' ne re-liait rien → les events entrants
 * (user:join / cursor:move / element:locked) étaient perdus et la présence des
 * collaborateurs ne s'affichait jamais (emits OK, listeners KO).
 */
describe("SocketClient — liaison des listeners au 'connect' (cold-start)", () => {
  beforeEach(() => {
    ioMock.mockReset();
    setApiConfig({
      baseURL: "https://example.test/api/v1",
      websocketURL: "wss://example.test",
    });
  });

  afterEach(() => {
    socketClient.disconnect();
  });

  it("un listener abonné pendant la connexion est (re)lié quand 'connect' survient", () => {
    // Fake socket qui capture les handlers pour pouvoir déclencher 'connect'.
    const handlers: Record<string, (...a: unknown[]) => void> = {};
    const fake = {
      connected: false,
      on: vi.fn((event: string, cb: (...a: unknown[]) => void) => {
        handlers[event] = cb;
      }),
      off: vi.fn(),
      emit: vi.fn(),
      disconnect: vi.fn(),
    };
    ioMock.mockImplementation(() => fake);

    // Reproduit l'ordre réel : connect() D'ABORD (socket en cours de
    // connexion), PUIS l'abonnement — comme le fait useUserPresence.
    socketClient.connect();
    const onUserJoin = vi.fn();
    socketClient.on("user:join", onUserJoin);

    // Pendant la connexion, le garde de on() (connected === false) n'a pas
    // lié le handler applicatif : seuls les handlers internes de connect()
    // (connect/disconnect/error) sont posés.
    expect(fake.on.mock.calls.map((c) => c[0])).not.toContain("user:join");

    // L'événement 'connect' du socket doit re-lier tous les listeners.
    fake.connected = true;
    handlers["connect"]?.();

    expect(fake.on.mock.calls.map((c) => c[0])).toContain("user:join");

    socketClient.off("user:join", onUserJoin);
  });
});
