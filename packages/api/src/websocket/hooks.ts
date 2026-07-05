import { useEffect, useState, useCallback, useRef } from 'react';
import { socketClient, SocketEvent, SocketEventData } from './client';

/**
 * Hook to manage socket connection
 */
export const useSocket = () => {
  const [isConnected, setIsConnected] = useState(socketClient.isConnected());

  useEffect(() => {
    const handleConnect = () => setIsConnected(true);
    const handleDisconnect = () => setIsConnected(false);

    socketClient.on('connect', handleConnect);
    socketClient.on('disconnect', handleDisconnect);

    // Connect if not already connected
    if (!socketClient.isConnected()) {
      socketClient.connect();
    }

    return () => {
      socketClient.off('connect', handleConnect);
      socketClient.off('disconnect', handleDisconnect);
    };
  }, []);

  const disconnect = useCallback(() => {
    socketClient.disconnect();
  }, []);

  return {
    isConnected,
    connect: () => socketClient.connect(),
    disconnect,
  };
};

/**
 * Hook to subscribe to socket events
 */
export const useSocketEvent = <K extends SocketEvent>(
  event: K,
  callback: (data: SocketEventData[K]) => void,
  enabled = true
) => {
  const callbackRef = useRef(callback);

  // Update ref when callback changes
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return;

    const handler = (data: SocketEventData[K]) => {
      callbackRef.current(data);
    };

    socketClient.on(event, handler);

    return () => {
      socketClient.off(event, handler);
    };
  }, [event, enabled]);
};

/**
 * Hook for document collaboration
 */
export const useDocumentCollaboration = (documentId: string | null) => {
  const [activeUsers, setActiveUsers] = useState<
    Array<{
      id: string;
      name: string;
      avatar?: string;
    }>
  >([]);

  const [cursors, setCursors] = useState<
    Map<
      string,
      {
        userId: string;
        userName: string;
        position: { x: number; y: number };
        pageId?: string;
      }
    >
  >(new Map());

  // Join document room when documentId changes
  useEffect(() => {
    if (!documentId) return;

    socketClient.joinDocument(documentId);

    return () => {
      socketClient.leaveDocument(documentId);
    };
  }, [documentId]);

  // Handle user join
  useSocketEvent(
    'user:join',
    useCallback(
      (data) => {
        if (data.document_id !== documentId) return;

        setActiveUsers((prev) => {
          // Check if user already exists
          if (prev.some((u) => u.id === data.user_id)) return prev;

          return [
            ...prev,
            {
              id: data.user_id,
              name: data.user_name,
              avatar: data.user_avatar,
            },
          ];
        });
      },
      [documentId]
    ),
    !!documentId
  );

  // Handle user leave
  useSocketEvent(
    'user:leave',
    useCallback(
      (data) => {
        if (data.document_id !== documentId) return;

        setActiveUsers((prev) => prev.filter((u) => u.id !== data.user_id));

        // Remove cursor
        setCursors((prev) => {
          const next = new Map(prev);
          next.delete(data.user_id);
          return next;
        });
      },
      [documentId]
    ),
    !!documentId
  );

  // Handle cursor movement
  useSocketEvent(
    'cursor:move',
    useCallback(
      (data) => {
        if (data.document_id !== documentId) return;

        setCursors((prev) => {
          const next = new Map(prev);
          next.set(data.user_id, {
            userId: data.user_id,
            userName: data.user_name,
            position: data.position,
            pageId: data.page_id,
          });
          return next;
        });
      },
      [documentId]
    ),
    !!documentId
  );

  // Send cursor position
  const sendCursorPosition = useCallback(
    (position: { x: number; y: number }, pageId?: string) => {
      if (!documentId) return;
      socketClient.sendCursorPosition(documentId, position, pageId);
    },
    [documentId]
  );

  return {
    activeUsers,
    cursors: Array.from(cursors.values()),
    sendCursorPosition,
  };
};

/**
 * Hook to listen for document updates
 */
export const useDocumentUpdates = (
  documentId: string | null,
  onUpdate?: (data: SocketEventData['document:update']) => void
) => {
  useSocketEvent(
    'document:update',
    useCallback(
      (data) => {
        if (data.document_id === documentId && onUpdate) {
          onUpdate(data);
        }
      },
      [documentId, onUpdate]
    ),
    !!documentId
  );
};

/**
 * Hook to listen for page updates
 */
export const usePageUpdates = (
  documentId: string | null,
  onPageCreate?: (data: SocketEventData['page:create']) => void,
  onPageUpdate?: (data: SocketEventData['page:update']) => void,
  onPageDelete?: (data: SocketEventData['page:delete']) => void
) => {
  useSocketEvent(
    'page:create',
    useCallback(
      (data) => {
        if (data.document_id === documentId && onPageCreate) {
          onPageCreate(data);
        }
      },
      [documentId, onPageCreate]
    ),
    !!documentId
  );

  useSocketEvent(
    'page:update',
    useCallback(
      (data) => {
        if (data.document_id === documentId && onPageUpdate) {
          onPageUpdate(data);
        }
      },
      [documentId, onPageUpdate]
    ),
    !!documentId
  );

  useSocketEvent(
    'page:delete',
    useCallback(
      (data) => {
        if (data.document_id === documentId && onPageDelete) {
          onPageDelete(data);
        }
      },
      [documentId, onPageDelete]
    ),
    !!documentId
  );
};

/**
 * Hook to listen for element updates
 */
export const useElementUpdates = (
  documentId: string | null,
  onElementCreate?: (data: SocketEventData['element:create']) => void,
  onElementUpdate?: (data: SocketEventData['element:update']) => void,
  onElementDelete?: (data: SocketEventData['element:delete']) => void,
  onElementBulkUpdate?: (data: SocketEventData['element:bulk-update']) => void
) => {
  useSocketEvent(
    'element:create',
    useCallback(
      (data) => {
        if (data.document_id === documentId && onElementCreate) {
          onElementCreate(data);
        }
      },
      [documentId, onElementCreate]
    ),
    !!documentId
  );

  useSocketEvent(
    'element:update',
    useCallback(
      (data) => {
        if (data.document_id === documentId && onElementUpdate) {
          onElementUpdate(data);
        }
      },
      [documentId, onElementUpdate]
    ),
    !!documentId
  );

  useSocketEvent(
    'element:delete',
    useCallback(
      (data) => {
        if (data.document_id === documentId && onElementDelete) {
          onElementDelete(data);
        }
      },
      [documentId, onElementDelete]
    ),
    !!documentId
  );

  useSocketEvent(
    'element:bulk-update',
    useCallback(
      (data) => {
        if (data.document_id === documentId && onElementBulkUpdate) {
          onElementBulkUpdate(data);
        }
      },
      [documentId, onElementBulkUpdate]
    ),
    !!documentId
  );
};

/**
 * Hook to listen for per-element soft-lock events.
 *
 * The server broadcasts `element:locked` / `element:unlocked` only to the OTHER
 * members of the room (skip_sid=emitter), so a client never receives the echo
 * of its own lock — the stored locks are, by construction, held by others. The
 * broadcasts are room-scoped server-side; when they carry a `document_id` we
 * still honour it as defence in depth (mismatched ids are dropped).
 */
export const useElementLocks = (
  documentId: string | null,
  onLocked?: (data: SocketEventData['element:locked']) => void,
  onUnlocked?: (data: SocketEventData['element:unlocked']) => void
) => {
  useSocketEvent(
    'element:locked',
    useCallback(
      (data) => {
        if (data.document_id && data.document_id !== documentId) return;
        onLocked?.(data);
      },
      [documentId, onLocked]
    ),
    !!documentId
  );

  useSocketEvent(
    'element:unlocked',
    useCallback(
      (data) => {
        if (data.document_id && data.document_id !== documentId) return;
        onUnlocked?.(data);
      },
      [documentId, onUnlocked]
    ),
    !!documentId
  );
};

/**
 * Hook to listen for job status updates
 */
export const useJobStatus = (
  jobId: string | null,
  onStatusUpdate?: (data: SocketEventData['job:status']) => void
) => {
  useSocketEvent(
    'job:status',
    useCallback(
      (data) => {
        if (data.job_id === jobId && onStatusUpdate) {
          onStatusUpdate(data);
        }
      },
      [jobId, onStatusUpdate]
    ),
    !!jobId
  );
};
