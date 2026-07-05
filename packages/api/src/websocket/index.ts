/**
 * Export WebSocket client and hooks
 */
export { socketClient, setAuthTokenProvider } from './client';
export type { SocketEvent, SocketEventData, AuthTokenProvider } from './client';

export {
  useSocket,
  useSocketEvent,
  useDocumentCollaboration,
  useDocumentUpdates,
  usePageUpdates,
  useElementUpdates,
  useElementLocks,
  useJobStatus,
} from './hooks';
