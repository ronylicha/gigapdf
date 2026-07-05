"use client";

import { useCallback, useMemo } from "react";
import {
  useDocumentCollaboration,
  useDocumentUpdates,
  usePageUpdates,
  useElementUpdates,
  useElementLocks,
  socketClient,
  type SocketEventData,
} from "@giga-pdf/api";
import type { Element, PageObject } from "@giga-pdf/types";

interface UseCollaborationOptions {
  /**
   * ID du document à collaborer — le storedDocumentId (le `[id]` de la route
   * éditeur, commun à tous les collaborateurs), JAMAIS l'id de session Redis
   * retourné par /load (recréé par utilisateur : chacun finirait seul dans sa
   * propre room). Sert au join de la room, aux émissions ET au filtre des
   * événements reçus (data.document_id).
   */
  documentId: string | null;
  /** Callback quand le document est mis à jour (changement de scene graph). */
  onDocumentUpdate?: (changes: unknown) => void;
  /**
   * Callback quand un PAIR a reconstruit le binaire PDF (nouvelle version S3
   * via createDocumentVersion). Le récepteur doit recharger le binaire — voir
   * page.tsx (garde anti-perte de saisie + reload debouncé).
   */
  onDocumentBinaryUpdate?: (info: {
    documentId: string;
    version?: number | string;
  }) => void;
  /** Callback quand un AUTRE utilisateur verrouille un élément. */
  onElementLocked?: (data: SocketEventData["element:locked"]) => void;
  /** Callback quand un élément est déverrouillé (unlock explicite ou expiration serveur). */
  onElementUnlocked?: (data: SocketEventData["element:unlocked"]) => void;
  /** Callback quand une page est créée */
  onPageCreate?: (page: PageObject) => void;
  /** Callback quand une page est mise à jour */
  onPageUpdate?: (pageId: string, changes: unknown) => void;
  /** Callback quand une page est supprimée */
  onPageDelete?: (pageId: string) => void;
  /** Callback quand un élément est créé */
  onElementCreate?: (element: Element) => void;
  /** Callback quand un élément est mis à jour */
  onElementUpdate?: (elementId: string, changes: unknown) => void;
  /** Callback quand un élément est supprimé */
  onElementDelete?: (elementId: string) => void;
  /** Callback quand plusieurs éléments sont mis à jour */
  onElementBulkUpdate?: (elements: Array<{ id: string; changes: unknown }>) => void;
  /** Activé ou non */
  enabled?: boolean;
}

interface CollaboratorInfo {
  id: string;
  name: string;
  avatar?: string;
  color: string;
}

interface CursorInfo {
  userId: string;
  userName: string;
  position: { x: number; y: number };
  pageId?: string;
  color: string;
}

interface UseCollaborationReturn {
  /** Liste des collaborateurs connectés */
  collaborators: CollaboratorInfo[];
  /** Liste des curseurs des autres utilisateurs */
  cursors: CursorInfo[];
  /** Envoyer la position du curseur */
  sendCursorPosition: (position: { x: number; y: number }, pageId?: string) => void;
  /** Nombre de collaborateurs */
  collaboratorCount: number;
  /** WebSocket connecté */
  isConnected: boolean;
  /** Émettre un changement de document (scene graph). */
  emitDocumentUpdate: (changes: unknown) => void;
  /**
   * Émettre une notification de reconstruction du binaire (nouvelle version S3).
   * À appeler APRÈS confirmation du save (createDocumentVersion) — les pairs
   * rechargent alors le binaire. L'émetteur ne reçoit jamais son propre écho.
   */
  emitBinaryUpdate: (version?: number | string) => void;
  /** Émettre une création d'élément */
  emitElementCreate: (element: Element) => void;
  /** Émettre une mise à jour d'élément */
  emitElementUpdate: (elementId: string, changes: unknown) => void;
  /** Émettre une suppression d'élément */
  emitElementDelete: (elementId: string) => void;
  /** Verrouiller un élément (sélection) — soft-lock coopératif. */
  emitElementLock: (elementId: string) => void;
  /** Déverrouiller un élément (désélection). */
  emitElementUnlock: (elementId: string) => void;
}

// Couleurs pour les collaborateurs
const COLLABORATOR_COLORS = [
  "#FF6B6B", // Rouge
  "#4ECDC4", // Cyan
  "#45B7D1", // Bleu
  "#96CEB4", // Vert
  "#FFEAA7", // Jaune
  "#DDA0DD", // Rose
  "#98D8C8", // Turquoise
  "#F7DC6F", // Or
  "#BB8FCE", // Violet
  "#F8B500", // Orange
];

/**
 * Hook pour la collaboration temps réel dans l'éditeur
 */
export function useCollaboration(options: UseCollaborationOptions): UseCollaborationReturn {
  const {
    documentId,
    onDocumentUpdate,
    onDocumentBinaryUpdate,
    onPageCreate,
    onPageUpdate,
    onPageDelete,
    onElementCreate,
    onElementUpdate,
    onElementDelete,
    onElementBulkUpdate,
    onElementLocked,
    onElementUnlocked,
    enabled = true,
  } = options;

  // Utiliser les hooks de collaboration existants
  const {
    activeUsers,
    cursors: rawCursors,
    sendCursorPosition: sendCursor,
  } = useDocumentCollaboration(enabled ? documentId : null);

  // Écouter les mises à jour du document. Deux natures partagent l'événement
  // `document:update` : (1) un changement de scene graph (legacy, `changes`) ;
  // (2) une reconstruction du binaire (`type === "binary"`) émise après un save
  // — le récepteur recharge alors le document plutôt que de merger un diff.
  useDocumentUpdates(
    enabled ? documentId : null,
    useCallback(
      (data: SocketEventData["document:update"]) => {
        if (data.type === "binary") {
          onDocumentBinaryUpdate?.({
            documentId: data.document_id,
            ...(data.version !== undefined ? { version: data.version } : {}),
          });
          return;
        }
        onDocumentUpdate?.(data.changes);
      },
      [onDocumentUpdate, onDocumentBinaryUpdate]
    )
  );

  // Écouter les verrous d'éléments des AUTRES utilisateurs (soft-lock). Le
  // serveur ne rediffuse jamais l'écho de nos propres verrous (skip_sid) : tout
  // verrou reçu est, par construction, détenu par un tiers.
  useElementLocks(
    enabled ? documentId : null,
    useCallback(
      (data: SocketEventData["element:locked"]) => {
        onElementLocked?.(data);
      },
      [onElementLocked]
    ),
    useCallback(
      (data: SocketEventData["element:unlocked"]) => {
        onElementUnlocked?.(data);
      },
      [onElementUnlocked]
    )
  );

  // Écouter les mises à jour des pages
  usePageUpdates(
    enabled ? documentId : null,
    useCallback(
      (data: SocketEventData["page:create"]) => {
        if (onPageCreate) {
          onPageCreate(data.page as PageObject);
        }
      },
      [onPageCreate]
    ),
    useCallback(
      (data: SocketEventData["page:update"]) => {
        if (onPageUpdate) {
          onPageUpdate(data.page_id, data.changes);
        }
      },
      [onPageUpdate]
    ),
    useCallback(
      (data: SocketEventData["page:delete"]) => {
        if (onPageDelete) {
          onPageDelete(data.page_id);
        }
      },
      [onPageDelete]
    )
  );

  // Écouter les mises à jour des éléments
  useElementUpdates(
    enabled ? documentId : null,
    useCallback(
      (data: SocketEventData["element:create"]) => {
        if (onElementCreate) {
          onElementCreate(data.element as Element);
        }
      },
      [onElementCreate]
    ),
    useCallback(
      (data: SocketEventData["element:update"]) => {
        if (onElementUpdate) {
          onElementUpdate(data.element_id, data.changes);
        }
      },
      [onElementUpdate]
    ),
    useCallback(
      (data: SocketEventData["element:delete"]) => {
        if (onElementDelete) {
          onElementDelete(data.element_id);
        }
      },
      [onElementDelete]
    ),
    useCallback(
      (data: SocketEventData["element:bulk-update"]) => {
        if (onElementBulkUpdate) {
          onElementBulkUpdate(data.elements);
        }
      },
      [onElementBulkUpdate]
    )
  );

  // Générer des couleurs stables pour chaque utilisateur
  const userColorMap = useMemo(() => {
    const map = new Map<string, string>();
    activeUsers.forEach((user, index) => {
      const colorIndex = index % COLLABORATOR_COLORS.length;
      map.set(user.id, COLLABORATOR_COLORS[colorIndex] ?? COLLABORATOR_COLORS[0]!);
    });
    return map;
  }, [activeUsers]);

  // Transformer les utilisateurs actifs avec leurs couleurs
  const collaborators = useMemo<CollaboratorInfo[]>(() => {
    return activeUsers.map((user) => ({
      id: user.id,
      name: user.name,
      avatar: user.avatar,
      color: userColorMap.get(user.id) ?? COLLABORATOR_COLORS[0]!,
    }));
  }, [activeUsers, userColorMap]);

  // Transformer les curseurs avec les couleurs
  const cursors = useMemo<CursorInfo[]>(() => {
    return rawCursors.map((cursor) => ({
      userId: cursor.userId,
      userName: cursor.userName,
      position: cursor.position,
      pageId: cursor.pageId,
      color: userColorMap.get(cursor.userId) ?? COLLABORATOR_COLORS[0]!,
    }));
  }, [rawCursors, userColorMap]);

  // Vérifier si connecté
  const isConnected = socketClient.isConnected();

  // Fonctions pour émettre des changements
  const emitDocumentUpdate = useCallback(
    (changes: unknown) => {
      if (!documentId || !enabled) return;
      socketClient.emit("document:update", {
        document_id: documentId,
        user_id: "", // Le serveur ajoutera l'ID de l'utilisateur
        changes,
      });
    },
    [documentId, enabled]
  );

  // Notification de reconstruction du binaire : le champ `type: "binary"`
  // discrimine des changements de scene graph. Le serveur relaie tel quel (pure
  // relay, client_id préservé) ; l'émetteur ne reçoit jamais son propre écho
  // (skip_sid côté serveur + filtre client_id côté socketClient).
  const emitBinaryUpdate = useCallback(
    (version?: number | string) => {
      if (!documentId || !enabled) return;
      socketClient.emit("document:update", {
        document_id: documentId,
        type: "binary",
        ...(version !== undefined ? { version } : {}),
      });
    },
    [documentId, enabled]
  );

  const emitElementCreate = useCallback(
    (element: Element) => {
      if (!documentId || !enabled) return;
      socketClient.emit("element:create", {
        document_id: documentId,
        element,
        user_id: "",
      });
    },
    [documentId, enabled]
  );

  const emitElementUpdate = useCallback(
    (elementId: string, changes: unknown) => {
      if (!documentId || !enabled) return;
      socketClient.emit("element:update", {
        document_id: documentId,
        element_id: elementId,
        changes,
        user_id: "",
      });
    },
    [documentId, enabled]
  );

  const emitElementDelete = useCallback(
    (elementId: string) => {
      if (!documentId || !enabled) return;
      socketClient.emit("element:delete", {
        document_id: documentId,
        element_id: elementId,
        user_id: "",
      });
    },
    [documentId, enabled]
  );

  // Soft-locks per-élément. Noms d'événements en underscore : le serveur les lie
  // via @sio.event (basé sur le nom de fonction element_lock/element_unlock).
  const emitElementLock = useCallback(
    (elementId: string) => {
      if (!documentId || !enabled || !elementId) return;
      socketClient.emit("element_lock", {
        document_id: documentId,
        element_id: elementId,
      });
    },
    [documentId, enabled]
  );

  const emitElementUnlock = useCallback(
    (elementId: string) => {
      if (!documentId || !enabled || !elementId) return;
      socketClient.emit("element_unlock", {
        document_id: documentId,
        element_id: elementId,
      });
    },
    [documentId, enabled]
  );

  // Wrapper pour sendCursorPosition
  const sendCursorPosition = useCallback(
    (position: { x: number; y: number }, pageId?: string) => {
      if (enabled) {
        sendCursor(position, pageId);
      }
    },
    [sendCursor, enabled]
  );

  return {
    collaborators,
    cursors,
    sendCursorPosition,
    collaboratorCount: collaborators.length,
    isConnected,
    emitDocumentUpdate,
    emitBinaryUpdate,
    emitElementCreate,
    emitElementUpdate,
    emitElementDelete,
    emitElementLock,
    emitElementUnlock,
  };
}
