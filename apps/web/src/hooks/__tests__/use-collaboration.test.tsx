/**
 * Contrat de room de collaboration (useCollaboration → @giga-pdf/api).
 *
 * Régression pinnée : l'éditeur joignait la room du document de SESSION
 * (id Redis recréé PAR UTILISATEUR à chaque /load) → deux collaborateurs du
 * même document n'atterrissaient jamais dans la même room et ne se voyaient
 * jamais. Le contrat est désormais : le hook reçoit le storedDocumentId (le
 * `[id]` de la route éditeur, commun à tous les collaborateurs) et ce même id
 * est utilisé pour (1) le join de la room, (2) TOUTES les émissions
 * (element:*, cursor:move), (3) le filtre des événements reçus
 * (data.document_id).
 *
 * Harnais : spies sur le singleton socketClient (frontière exacte entre les
 * hooks et le transport). PAS de vi.mock("socket.io-client") ni de connect()
 * ici : vitest.config tourne en `isolate: false` (fork partagé entre
 * fichiers) et un double mock de module + état résiduel du singleton
 * empoisonnerait socket-auth-provider.test.ts selon l'ordre d'exécution.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  afterAll,
} from "vitest";
import { renderHook, act } from "@testing-library/react";

import { socketClient } from "@giga-pdf/api";
import { useCollaboration } from "../use-collaboration";
import type { Element } from "@giga-pdf/types";

// Hygiène de fork partagé (`isolate: false`) : ce fichier est le premier
// import RUNTIME non mocké de @giga-pdf/api de la suite. Sans purge, le
// module resterait caché lié au VRAI socket.io-client et
// socket-auth-provider.test.ts (qui mocke socket.io-client à l'évaluation du
// module) hériterait du binding non mocké selon l'ordre du séquenceur →
// `ioMock` jamais appelé, 5 tests rouges. On ré-évalue donc le graphe pour
// les fichiers suivants.
afterAll(() => {
  vi.resetModules();
});

/** Le storedDocumentId — l'id GED/route partagé par tous les collaborateurs. */
const STORED_DOCUMENT_ID = "stored-doc-route-id";
/** Un id de session Redis (par utilisateur) — ne doit JAMAIS servir de room. */
const SESSION_DOCUMENT_ID = "session-doc-user-a";

function installSpies() {
  return {
    join: vi.spyOn(socketClient, "joinDocument").mockImplementation(() => {}),
    leave: vi.spyOn(socketClient, "leaveDocument").mockImplementation(() => {}),
    emit: vi.spyOn(socketClient, "emit").mockImplementation(() => {}),
    cursor: vi
      .spyOn(socketClient, "sendCursorPosition")
      .mockImplementation(() => {}),
    on: vi.spyOn(socketClient, "on").mockImplementation(() => {}),
    off: vi.spyOn(socketClient, "off").mockImplementation(() => {}),
  };
}

let spies: ReturnType<typeof installSpies>;

/** Simule un événement serveur entrant : invoque les handlers enregistrés. */
function dispatch(event: string, payload: unknown): void {
  for (const call of spies.on.mock.calls) {
    if (call[0] === event) {
      (call[1] as (data: unknown) => void)(payload);
    }
  }
}

function makeElement(id: string): Element {
  return {
    elementId: id,
    type: "text",
    bounds: { x: 0, y: 0, width: 100, height: 20 },
    content: "hello",
  } as unknown as Element;
}

describe("useCollaboration — room = storedDocumentId", () => {
  beforeEach(() => {
    spies = installSpies();
  });

  afterEach(() => {
    // Restaure les méthodes réelles du singleton — aucun état résiduel pour
    // les autres fichiers de test (fork partagé, isolate: false).
    vi.restoreAllMocks();
  });

  it("joint la room du storedDocumentId fourni", () => {
    renderHook(() =>
      useCollaboration({ documentId: STORED_DOCUMENT_ID, enabled: true }),
    );

    expect(spies.join).toHaveBeenCalledWith(STORED_DOCUMENT_ID);
    // Garde-fou régression : la room n'est jamais celle d'un doc de session.
    expect(spies.join).not.toHaveBeenCalledWith(SESSION_DOCUMENT_ID);
  });

  it("enabled: false → aucun join", () => {
    renderHook(() =>
      useCollaboration({ documentId: STORED_DOCUMENT_ID, enabled: false }),
    );

    expect(spies.join).not.toHaveBeenCalled();
  });

  it("émet element:update avec le MÊME storedDocumentId que le join", () => {
    const { result } = renderHook(() =>
      useCollaboration({ documentId: STORED_DOCUMENT_ID, enabled: true }),
    );

    act(() => {
      result.current.emitElementUpdate("el-1", { content: "updated" });
    });

    expect(spies.emit).toHaveBeenCalledWith("element:update", {
      document_id: STORED_DOCUMENT_ID,
      element_id: "el-1",
      changes: { content: "updated" },
      user_id: "",
    });
  });

  it("émet element:create et element:delete avec le storedDocumentId", () => {
    const { result } = renderHook(() =>
      useCollaboration({ documentId: STORED_DOCUMENT_ID, enabled: true }),
    );

    act(() => {
      result.current.emitElementCreate(makeElement("el-new"));
      result.current.emitElementDelete("el-gone");
    });

    expect(spies.emit).toHaveBeenCalledWith(
      "element:create",
      expect.objectContaining({ document_id: STORED_DOCUMENT_ID }),
    );
    expect(spies.emit).toHaveBeenCalledWith(
      "element:delete",
      expect.objectContaining({
        document_id: STORED_DOCUMENT_ID,
        element_id: "el-gone",
      }),
    );
  });

  it("émet la position curseur vers la room du storedDocumentId", () => {
    const { result } = renderHook(() =>
      useCollaboration({ documentId: STORED_DOCUMENT_ID, enabled: true }),
    );

    act(() => {
      result.current.sendCursorPosition({ x: 10, y: 20 }, "page-1");
    });

    expect(spies.cursor).toHaveBeenCalledWith(
      STORED_DOCUMENT_ID,
      { x: 10, y: 20 },
      "page-1",
    );
  });

  it("quitte la room du storedDocumentId au unmount", () => {
    const { unmount } = renderHook(() =>
      useCollaboration({ documentId: STORED_DOCUMENT_ID, enabled: true }),
    );

    unmount();

    expect(spies.leave).toHaveBeenCalledWith(STORED_DOCUMENT_ID);
  });

  it("réception : user:join est filtré sur le storedDocumentId", () => {
    const { result } = renderHook(() =>
      useCollaboration({ documentId: STORED_DOCUMENT_ID, enabled: true }),
    );

    // Événement d'une AUTRE room (ex. un id de session) → ignoré.
    act(() => {
      dispatch("user:join", {
        document_id: SESSION_DOCUMENT_ID,
        user_id: "user-b",
        user_name: "Bob",
      });
    });
    expect(result.current.collaborators).toHaveLength(0);

    // Événement de NOTRE room → collaborateur visible.
    act(() => {
      dispatch("user:join", {
        document_id: STORED_DOCUMENT_ID,
        user_id: "user-b",
        user_name: "Bob",
      });
    });
    expect(result.current.collaborators).toHaveLength(1);
    expect(result.current.collaborators[0]).toMatchObject({
      id: "user-b",
      name: "Bob",
    });
    expect(result.current.collaboratorCount).toBe(1);
  });

  it("réception : element:update d'une autre room n'atteint pas le callback", () => {
    const onElementUpdate = vi.fn();
    renderHook(() =>
      useCollaboration({
        documentId: STORED_DOCUMENT_ID,
        enabled: true,
        onElementUpdate,
      }),
    );

    act(() => {
      dispatch("element:update", {
        document_id: SESSION_DOCUMENT_ID,
        element_id: "el-1",
        changes: { content: "other room" },
        user_id: "user-b",
      });
    });
    expect(onElementUpdate).not.toHaveBeenCalled();

    act(() => {
      dispatch("element:update", {
        document_id: STORED_DOCUMENT_ID,
        element_id: "el-1",
        changes: { content: "same room" },
        user_id: "user-b",
      });
    });
    expect(onElementUpdate).toHaveBeenCalledWith("el-1", {
      content: "same room",
    });
  });
});
