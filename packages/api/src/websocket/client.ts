import { io, Socket } from 'socket.io-client';
import { getApiConfig } from '../config';
import { getTokenStorage } from '../client';

export type SocketEvent =
  | 'connect'
  | 'disconnect'
  | 'error'
  | 'document:update'
  | 'document:delete'
  | 'page:create'
  | 'page:update'
  | 'page:delete'
  | 'element:create'
  | 'element:update'
  | 'element:delete'
  | 'element:bulk-update'
  | 'cursor:move'
  | 'user:join'
  | 'user:leave'
  | 'job:status'
  | 'export:complete'
  | 'ocr:complete';

export interface SocketEventData {
  'connect': void;
  'disconnect': string;
  'error': Error;
  'document:update': {
    document_id: string;
    user_id: string;
    changes: unknown;
  };
  'document:delete': {
    document_id: string;
    user_id: string;
  };
  'page:create': {
    document_id: string;
    page: unknown;
    user_id: string;
  };
  'page:update': {
    document_id: string;
    page_id: string;
    changes: unknown;
    user_id: string;
  };
  'page:delete': {
    document_id: string;
    page_id: string;
    user_id: string;
  };
  'element:create': {
    document_id: string;
    element: unknown;
    user_id: string;
    /** Page cible (1-indexée). Requis par le récepteur pour router l'élément vers la bonne page. */
    page_number?: number;
    /** Identifiant du client émetteur (anti-écho) — estampillé automatiquement par SocketClient.emit. */
    client_id?: string;
  };
  'element:update': {
    document_id: string;
    element_id: string;
    changes: unknown;
    user_id: string;
    /** Identifiant du client émetteur (anti-écho) — estampillé automatiquement par SocketClient.emit. */
    client_id?: string;
  };
  'element:delete': {
    document_id: string;
    element_id: string;
    user_id: string;
    /** Identifiant du client émetteur (anti-écho) — estampillé automatiquement par SocketClient.emit. */
    client_id?: string;
  };
  'element:bulk-update': {
    document_id: string;
    elements: Array<{ id: string; changes: unknown }>;
    user_id: string;
  };
  'cursor:move': {
    document_id: string;
    user_id: string;
    user_name: string;
    position: { x: number; y: number };
    page_id?: string;
  };
  'user:join': {
    document_id: string;
    user_id: string;
    user_name: string;
    user_avatar?: string;
  };
  'user:leave': {
    document_id: string;
    user_id: string;
  };
  'job:status': {
    job_id: string;
    status: string;
    progress?: number;
    error?: string;
  };
  'export:complete': {
    export_id: string;
    document_id: string;
    status: string;
  };
  'ocr:complete': {
    job_id: string;
    document_id: string;
    status: string;
  };
}

/**
 * Fournisseur de token d'authentification pour le handshake WebSocket.
 *
 * Le tokenStorage par défaut (localStorage) n'est jamais alimenté par
 * apps/web : le JWT Better Auth vit EN MÉMOIRE uniquement (anti-XSS, voir
 * apps/web/src/lib/auth-token.ts). L'app hôte installe donc un provider via
 * setAuthTokenProvider() — la même source que l'intercepteur axios — et la
 * callback `auth` de socket.io le ré-évalue à CHAQUE (re)connexion, ce qui
 * couvre le refresh du token. Sans provider, fallback sur le tokenStorage
 * historique (compat consommateurs existants).
 */
export type AuthTokenProvider = () => string | null | Promise<string | null>;

let authTokenProvider: AuthTokenProvider | null = null;

/**
 * Installe (ou retire avec `null`) la source de token utilisée par le
 * handshake socket.io. À appeler une fois au boot de l'app hôte.
 */
export function setAuthTokenProvider(provider: AuthTokenProvider | null): void {
  authTokenProvider = provider;
}

/** Résout le token courant : provider installé, sinon tokenStorage legacy. */
async function resolveAuthToken(): Promise<string | null> {
  try {
    if (authTokenProvider) {
      return (await authTokenProvider()) ?? null;
    }
    return getTokenStorage().getAccessToken();
  } catch {
    return null;
  }
}

/**
 * Génère un identifiant unique par onglet/instance de client.
 * Utilisé pour l'anti-écho : un client ignore les événements de collaboration
 * qui portent son propre client_id (cas d'un relay serveur sans skip_sid).
 */
function generateClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `client_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * WebSocket client for real-time collaboration
 */
class SocketClient {
  private socket: Socket | null = null;
  private listeners: Map<string, Set<(data: unknown) => void>> = new Map();
  /** Identifiant stable de CE client (par onglet) — sert d'identité d'émetteur. */
  private readonly clientId: string = generateClientId();
  /**
   * callback original → wrapper anti-écho. Nécessaire pour que off() puisse
   * désenregistrer exactement la fonction passée à socket.io par on().
   */
  private wrappedCallbacks = new WeakMap<
    (data: unknown) => void,
    (data: unknown) => void
  >();

  /**
   * Identifiant unique de ce client (stable pour la durée de vie de l'onglet).
   * À comparer au champ `client_id` des payloads entrants pour l'anti-écho.
   */
  getClientId(): string {
    return this.clientId;
  }

  /** Un payload entrant est-il l'écho d'un événement émis par CE client ? */
  private isOwnEcho(data: unknown): boolean {
    return (
      typeof data === 'object' &&
      data !== null &&
      (data as { client_id?: unknown }).client_id === this.clientId
    );
  }

  /**
   * Retourne (et mémoïse) le wrapper d'un callback qui filtre l'écho de nos
   * propres événements avant de déléguer. Les événements sans client_id
   * (présence, jobs, événements serveur) passent inchangés.
   */
  private getWrappedCallback(
    callback: (data: unknown) => void
  ): (data: unknown) => void {
    let wrapped = this.wrappedCallbacks.get(callback);
    if (!wrapped) {
      wrapped = (data: unknown) => {
        if (this.isOwnEcho(data)) return;
        callback(data);
      };
      this.wrappedCallbacks.set(callback, wrapped);
    }
    return wrapped;
  }

  /**
   * Connect to WebSocket server
   */
  connect(): Socket {
    if (this.socket?.connected) {
      return this.socket;
    }

    const config = getApiConfig();

    this.socket = io(config.websocketURL, {
      // Callback form : ré-évaluée par socket.io à chaque tentative de
      // (re)connexion → le token est toujours frais (gère le refresh JWT).
      auth: async (cb) => {
        cb({ token: await resolveAuthToken() });
      },
      // websocket only : le backend tourne en uvicorn multi-workers derrière
      // nginx SANS sticky sessions. Le handshake HTTP long-polling n'est pas
      // sticky (l'AsyncRedisManager couvre le broadcast inter-workers, pas le
      // handshake) → un upgrade polling→websocket échoue aléatoirement.
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
    });

    // Set up event listeners
    this.socket.on('connect', () => {
      console.log('[Socket] Connected');
    });

    this.socket.on('disconnect', (reason) => {
      console.log('[Socket] Disconnected:', reason);
    });

    this.socket.on('error', (error) => {
      console.error('[Socket] Error:', error);
    });

    // Re-attach all listeners
    this.listeners.forEach((callbacks, event) => {
      callbacks.forEach((callback) => {
        this.socket?.on(event, callback);
      });
    });

    return this.socket;
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  /**
   * Check if socket is connected
   */
  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  /**
   * Join a document room for real-time updates
   */
  joinDocument(documentId: string): void {
    if (!this.socket?.connected) {
      this.connect();
    }
    this.socket?.emit('document:join', { document_id: documentId });
  }

  /**
   * Leave a document room
   */
  leaveDocument(documentId: string): void {
    this.socket?.emit('document:leave', { document_id: documentId });
  }

  /**
   * Subscribe to a socket event
   */
  on<K extends SocketEvent>(event: K, callback: (data: SocketEventData[K]) => void): void {
    // Le wrapper filtre l'écho de nos propres événements (client_id identique)
    // avant de déléguer au callback applicatif. C'est lui qui est enregistré
    // côté socket.io et dans listeners (pour la ré-attache au reconnect).
    const wrapped = this.getWrappedCallback(callback as (data: unknown) => void);

    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(wrapped);

    if (this.socket?.connected) {
      this.socket.on(event as string, wrapped);
    }
  }

  /**
   * Unsubscribe from a socket event
   */
  off<K extends SocketEvent>(
    event: K,
    callback: (data: SocketEventData[K]) => void
  ): void {
    // on() enregistre le wrapper anti-écho, pas le callback brut — il faut
    // donc désenregistrer ce même wrapper (fallback brut par sécurité).
    const wrapped =
      this.wrappedCallbacks.get(callback as (data: unknown) => void) ??
      (callback as (data: unknown) => void);

    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.delete(wrapped);
      if (callbacks.size === 0) {
        this.listeners.delete(event);
      }
    }

    if (this.socket?.connected) {
      this.socket.off(event as string, wrapped);
    }
  }

  /**
   * Emit a socket event
   */
  emit<K extends SocketEvent>(event: K, data: SocketEventData[K]): void {
    if (!this.socket?.connected) {
      this.connect();
    }
    // Estampille l'identité de CE client sur tout payload objet. À la
    // réception, le wrapper de on() ignore les événements portant notre
    // propre client_id — aucune boucle d'écho possible même si le serveur
    // rediffuse à toute la room sans skip_sid. Un client_id explicitement
    // fourni par l'appelant a priorité (spread après).
    const payload =
      typeof data === 'object' && data !== null
        ? { client_id: this.clientId, ...(data as Record<string, unknown>) }
        : data;
    this.socket?.emit(event, payload);
  }

  /**
   * Send cursor position update
   */
  sendCursorPosition(
    documentId: string,
    position: { x: number; y: number },
    pageId?: string
  ): void {
    this.socket?.emit('cursor:move', {
      document_id: documentId,
      position,
      page_id: pageId,
    });
  }

  /**
   * Get the underlying socket instance
   */
  getSocket(): Socket | null {
    return this.socket;
  }
}

// Singleton instance
export const socketClient = new SocketClient();
