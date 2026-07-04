"use client";

import { useCallback, useMemo } from "react";
import {
  useDocumentCollaboration,
  useDocumentUpdates,
  usePageUpdates,
  useElementUpdates,
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
  /** Callback quand le document est mis à jour */
  onDocumentUpdate?: (changes: unknown) => void;
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
  /** Émettre un changement de document */
  emitDocumentUpdate: (changes: unknown) => void;
  /** Émettre une création d'élément */
  emitElementCreate: (element: Element) => void;
  /** Émettre une mise à jour d'élément */
  emitElementUpdate: (elementId: string, changes: unknown) => void;
  /** Émettre une suppression d'élément */
  emitElementDelete: (elementId: string) => void;
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
    onPageCreate,
    onPageUpdate,
    onPageDelete,
    onElementCreate,
    onElementUpdate,
    onElementDelete,
    onElementBulkUpdate,
    enabled = true,
  } = options;

  // Utiliser les hooks de collaboration existants
  const {
    activeUsers,
    cursors: rawCursors,
    sendCursorPosition: sendCursor,
  } = useDocumentCollaboration(enabled ? documentId : null);

  // Écouter les mises à jour du document
  useDocumentUpdates(
    enabled ? documentId : null,
    useCallback(
      (data: SocketEventData["document:update"]) => {
        if (onDocumentUpdate) {
          onDocumentUpdate(data.changes);
        }
      },
      [onDocumentUpdate]
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
    emitElementCreate,
    emitElementUpdate,
    emitElementDelete,
  };
}
