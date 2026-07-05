"""
WebSocket collaboration endpoints for Giga-PDF.

Provides real-time collaboration features including:
- User presence tracking
- Element locking/unlocking
- Cursor position broadcasting
- Document update notifications
"""

import logging

import socketio
from fastapi import HTTPException
from sqlalchemy import select

from app.config import get_settings
from app.core.database import get_db_session
from app.middleware.auth import decode_jwt_token
from app.models.database import StoredDocument
from app.repositories.document_repo import document_sessions
from app.services.collaboration_service import collaboration_manager
from app.services.sharing.access_guard import authorize_document_access

logger = logging.getLogger(__name__)

# Create Socket.IO server
settings = get_settings()

# Configure Redis client manager with TLS support if needed
def get_redis_manager():
    """Create Redis manager with proper TLS configuration.

    Follows redis-py SSL connection pattern:
    https://redis.readthedocs.io/en/stable/examples/ssl_connection_examples.html
    """
    redis_url = settings.socketio_message_queue

    # Check if URL has ssl_ca_certs parameter (needs special handling)
    if "ssl_ca_certs=" in redis_url:
        from urllib.parse import parse_qs, urlparse

        # Parse URL and extract ssl_ca_certs
        parsed = urlparse(redis_url)
        query_params = parse_qs(parsed.query)
        ca_certs = query_params.get("ssl_ca_certs", [None])[0]

        # Rebuild URL without query params
        clean_url = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"

        # Pass SSL options via redis_options as per python-socketio docs
        # https://github.com/miguelgrinberg/python-socketio/issues/318
        return socketio.AsyncRedisManager(
            clean_url,
            redis_options={
                "ssl_cert_reqs": "required",
                "ssl_ca_certs": ca_certs,
            }
        )
    else:
        return socketio.AsyncRedisManager(redis_url)

try:
    client_manager = get_redis_manager()
    logger.info("Socket.IO Redis manager initialized")
except Exception as e:
    logger.warning(f"Failed to create Redis manager: {e}. Using in-memory mode.")
    client_manager = None

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*" if settings.is_development else [],
    logger=settings.app_debug,
    engineio_logger=settings.app_debug,
    client_manager=client_manager,
)

# Create ASGI app
# Mounted at "/socket.io" in FastAPI with socketio_path=""
# See: https://github.com/fastapi/fastapi/issues/3666
sio_app = socketio.ASGIApp(
    socketio_server=sio,
    socketio_path="",
)


# Helper functions
async def get_user_from_auth(auth_data: dict) -> dict | None:
    """
    Extract and validate user from authentication data.

    Args:
        auth_data: Authentication data from client.

    Returns:
        dict: User information with user_id and user_name.

    Raises:
        HTTPException: If authentication fails.
    """
    token = auth_data.get("token")
    if not token:
        raise HTTPException(status_code=401, detail="Missing authentication token")

    try:
        # Verify JWT token
        payload = await decode_jwt_token(token)
        return {
            "user_id": payload.get("sub", payload.get("user_id", "anonymous")),
            "user_name": payload.get("name", payload.get("email", "Unknown User")),
        }
    except Exception as e:
        logger.error(f"Authentication error: {e}")
        raise HTTPException(status_code=401, detail="Invalid authentication token")


async def get_document_room(document_id: str) -> str:
    """
    Get Socket.IO room name for a document.

    Args:
        document_id: Document identifier.

    Returns:
        str: Room name.
    """
    return f"document:{document_id}"


async def _authorize_document_join(document_id: str, user_id: str) -> bool:
    """
    Owner-or-shared gate applied BEFORE entering a document room.

    Mirrors the editor load path (storage.load_stored_document): a stored
    document may be joined by its owner or by a user holding an active,
    non-expired share — enforced by
    :func:`app.services.sharing.access_guard.authorize_document_access`.

    The editor also collaborates on transient SESSION documents (Redis,
    created per-user by ``POST /storage/documents/{id}/load``). Those have no
    share table and are only ever owned by the user who loaded them, so only
    their owner may join. Unknown ids are refused (fail-closed).

    Args:
        document_id: Target document (stored document id or session id).
        user_id: Authenticated user from the socket session.

    Returns:
        bool: True when the user may join the room, False otherwise.
    """
    try:
        async with get_db_session() as db:
            result = await db.execute(
                select(StoredDocument).where(
                    StoredDocument.id == document_id,
                    ~StoredDocument.is_deleted,
                )
            )
            stored_doc = result.scalar_one_or_none()

            if stored_doc is not None:
                try:
                    await authorize_document_access(db, stored_doc, user_id)
                    return True
                except HTTPException:
                    return False
    except Exception as e:
        # DB lookup failure must not grant access — fall through to the
        # session-document check (which does not depend on the database).
        logger.error(
            f"Room authorization lookup failed for document {document_id}: {e}"
        )

    # Not a stored document — transient editing session (Redis-backed).
    try:
        session = await document_sessions.get_session_async(document_id)
    except Exception as e:
        logger.error(f"Session lookup failed for document {document_id}: {e}")
        return False

    return session is not None and session.owner_id == user_id


# Event handlers
@sio.event
async def connect(sid: str, environ: dict, auth: dict) -> bool:
    """
    Handle client connection.

    Args:
        sid: Socket ID.
        environ: ASGI environment.
        auth: Authentication data.

    Returns:
        bool: True to accept connection, False to reject.
    """
    try:
        # Validate authentication
        user = await get_user_from_auth(auth)

        logger.info(
            f"WebSocket connection from user {user['user_id']} (socket: {sid})"
        )

        # Store user info in session
        async with sio.session(sid) as session:
            session["user_id"] = user["user_id"]
            session["user_name"] = user["user_name"]

        return True

    except Exception as e:
        logger.error(f"Connection rejected for {sid}: {e}")
        return False


@sio.event
async def disconnect(sid: str):
    """
    Handle client disconnection.

    Cleans up collaboration session and releases locks.

    Args:
        sid: Socket ID.
    """
    try:
        # Get session info
        async with sio.session(sid) as session:
            user_id = session.get("user_id")
            document_id = session.get("document_id")

        if not document_id:
            logger.info(f"Socket {sid} disconnected (no active document)")
            return

        # Capture the element locks this socket still holds BEFORE removing the
        # session — remove_session releases them in the DB but does not report
        # which ones, and the client relies on element:unlocked to un-grey.
        released_element_ids = await collaboration_manager.get_locked_element_ids(
            sid
        )

        # Remove collaboration session (also releases its element locks)
        collab_session = await collaboration_manager.remove_session(sid)

        if collab_session:
            # Notify other users — "user:leave" with document_id is the
            # contract the web client listens to.
            room = await get_document_room(document_id)
            await sio.emit(
                "user:leave",
                {
                    "document_id": document_id,
                    "user_id": collab_session.user_id,
                    "user_name": collab_session.user_name,
                    "timestamp": collab_session.last_seen_at.isoformat(),
                },
                room=room,
                skip_sid=sid,
            )

            # Release the disconnected user's soft-locks for everyone still in
            # the room. Without this, peers keep the element greyed out until
            # the 5-minute server-side expiry (which is itself silent) or their
            # own client TTL backstop fires.
            for element_id in released_element_ids:
                await sio.emit(
                    "element:unlocked",
                    {"element_id": element_id, "document_id": document_id},
                    room=room,
                    skip_sid=sid,
                )

            logger.info(
                f"User {user_id} left document {document_id} (socket: {sid})"
            )

    except Exception as e:
        logger.error(f"Error handling disconnect for {sid}: {e}")


async def _join_document_impl(sid: str, data: dict) -> dict:
    """
    Join a document collaboration room.

    Shared implementation behind both event names: the historical
    ``join_document`` and the ``document:join`` contract the web client
    actually emits (packages/api/src/websocket/client.ts joinDocument()).

    Args:
        sid: Socket ID.
        data: Event data containing document_id.

    Returns:
        dict: Response with session info and active users.
    """
    try:
        document_id = data.get("document_id") if isinstance(data, dict) else None
        if not document_id:
            return {
                "success": False,
                "error": "Missing document_id",
            }

        # Get user from session (do NOT mark the document as joined yet —
        # the element relays trust session["document_id"], so it must only
        # be set after the authorization gate below).
        async with sio.session(sid) as session:
            user_id = session.get("user_id")
            user_name = session.get("user_name")

        if not user_id:
            return {
                "success": False,
                "error": "Not authenticated",
            }

        # Owner-or-shared gate (same rule as the editor load endpoint).
        if not await _authorize_document_join(document_id, user_id):
            logger.warning(
                f"User {user_id} denied access to document {document_id} "
                f"room (socket: {sid})"
            )
            await sio.emit(
                "error",
                {
                    "event": "document:join",
                    "document_id": document_id,
                    "message": "You do not have access to this document",
                },
                to=sid,
            )
            return {
                "success": False,
                "error": "Access denied to this document",
            }

        async with sio.session(sid) as session:
            session["document_id"] = document_id

        # Create collaboration session
        collab_session = await collaboration_manager.create_session(
            document_id=document_id,
            user_id=user_id,
            user_name=user_name,
            socket_id=sid,
        )

        # Join Socket.IO room (coroutine since python-socketio 5.10 — an
        # un-awaited call is a silent no-op and the user never joins).
        room = await get_document_room(document_id)
        await sio.enter_room(sid, room)

        # Get other active users
        active_users = await collaboration_manager.get_active_users(document_id)

        # Get active locks
        active_locks = await collaboration_manager.get_document_locks(document_id)

        # Notify other users — "user:join" with document_id is the contract
        # the web client listens to (packages/api/src/websocket/hooks.ts
        # filters on data.document_id).
        await sio.emit(
            "user:join",
            {
                "document_id": document_id,
                "user_id": collab_session.user_id,
                "user_name": collab_session.user_name,
                "user_color": collab_session.user_color,
                "timestamp": collab_session.joined_at.isoformat(),
            },
            room=room,
            skip_sid=sid,
        )

        # Presence backfill: the client does not consume the ack, it only
        # builds presence from "user:join" events — replay the already
        # active users to the newcomer so both sides see each other.
        for active_user in active_users:
            if active_user.socket_id == sid:
                continue
            await sio.emit(
                "user:join",
                {
                    "document_id": document_id,
                    "user_id": active_user.user_id,
                    "user_name": active_user.user_name,
                    "user_color": active_user.user_color,
                },
                to=sid,
            )

        # Lock backfill: the client does not consume the join ack (it builds
        # collaboration state purely from broadcast events), so replay the
        # already-held element locks to the newcomer as "element:locked" events
        # — the same shape the live element_lock handler broadcasts — so the
        # editor greys them out on arrival instead of only after the next
        # lock/unlock. ElementLock rows carry no display name; resolve it from
        # the active users, falling back to a neutral label.
        user_name_by_id = {u.user_id: u.user_name for u in active_users}
        for lock in active_locks:
            await sio.emit(
                "element:locked",
                {
                    "element_id": lock.element_id,
                    "locked_by_user_id": lock.locked_by_user_id,
                    "locked_by_user_name": user_name_by_id.get(
                        lock.locked_by_user_id, "Unknown"
                    ),
                    "expires_at": lock.expires_at.isoformat(),
                    "document_id": document_id,
                },
                to=sid,
            )

        logger.info(
            f"User {user_id} joined document {document_id} (socket: {sid})"
        )

        return {
            "success": True,
            "session": {
                "session_id": collab_session.id,
                "user_color": collab_session.user_color,
            },
            "active_users": [
                {
                    "user_id": u.user_id,
                    "user_name": u.user_name,
                    "user_color": u.user_color,
                    "cursor_page": u.cursor_page,
                    "cursor_x": u.cursor_x,
                    "cursor_y": u.cursor_y,
                }
                for u in active_users
                if u.socket_id != sid
            ],
            "active_locks": [
                {
                    "element_id": lock.element_id,
                    "locked_by_user_id": lock.locked_by_user_id,
                    "expires_at": lock.expires_at.isoformat(),
                }
                for lock in active_locks
            ],
        }

    except Exception as e:
        logger.error(f"Error joining document: {e}")
        return {
            "success": False,
            "error": str(e),
        }


@sio.event
async def join_document(sid: str, data: dict) -> dict:
    """Historical event name — delegates to the shared join implementation."""
    return await _join_document_impl(sid, data)


@sio.on("document:join")
async def document_join(sid: str, data: dict) -> dict:
    """Client contract event name (SocketClient.joinDocument) — same logic."""
    return await _join_document_impl(sid, data)


async def _leave_document_impl(sid: str, data: dict) -> dict:
    """
    Leave a document collaboration room.

    Shared implementation behind both event names: the historical
    ``leave_document`` and the ``document:leave`` contract the web client
    actually emits (packages/api/src/websocket/client.ts leaveDocument()).

    Args:
        sid: Socket ID.
        data: Event data.

    Returns:
        dict: Response with success status.
    """
    try:
        async with sio.session(sid) as session:
            document_id = session.get("document_id")
            if not document_id:
                return {
                    "success": False,
                    "error": "Not in a document",
                }

            session["document_id"] = None

        # Capture held locks before removal (see the disconnect handler).
        released_element_ids = await collaboration_manager.get_locked_element_ids(
            sid
        )

        # Remove collaboration session (also releases its element locks)
        collab_session = await collaboration_manager.remove_session(sid)

        if collab_session:
            # Leave Socket.IO room (coroutine since python-socketio 5.10 —
            # an un-awaited call is a silent no-op).
            room = await get_document_room(document_id)
            await sio.leave_room(sid, room)

            # Notify other users — "user:leave" with document_id is the
            # contract the web client listens to.
            await sio.emit(
                "user:leave",
                {
                    "document_id": document_id,
                    "user_id": collab_session.user_id,
                    "user_name": collab_session.user_name,
                    "timestamp": collab_session.last_seen_at.isoformat(),
                },
                room=room,
            )

            # Release the leaver's soft-locks for the rest of the room.
            for element_id in released_element_ids:
                await sio.emit(
                    "element:unlocked",
                    {"element_id": element_id, "document_id": document_id},
                    room=room,
                    skip_sid=sid,
                )

            logger.info(
                f"User {collab_session.user_id} left document {document_id}"
            )

        return {"success": True}

    except Exception as e:
        logger.error(f"Error leaving document: {e}")
        return {
            "success": False,
            "error": str(e),
        }


@sio.event
async def leave_document(sid: str, data: dict) -> dict:
    """Historical event name — delegates to the shared leave implementation."""
    return await _leave_document_impl(sid, data)


@sio.on("document:leave")
async def document_leave(sid: str, data: dict) -> dict:
    """Client contract event name (SocketClient.leaveDocument) — same logic."""
    return await _leave_document_impl(sid, data)


@sio.event
async def element_lock(sid: str, data: dict) -> dict:
    """
    Lock an element for editing.

    Args:
        sid: Socket ID.
        data: Event data containing element_id.

    Returns:
        dict: Response with lock status.
    """
    try:
        element_id = data.get("element_id")
        if not element_id:
            return {
                "success": False,
                "error": "Missing element_id",
            }

        # Get session info
        async with sio.session(sid) as session:
            user_id = session.get("user_id")
            document_id = session.get("document_id")

        if not document_id or not user_id:
            return {
                "success": False,
                "error": "Not in a document",
            }

        # Get collaboration session ID
        active_users = await collaboration_manager.get_active_users(document_id)
        collab_session = next(
            (u for u in active_users if u.socket_id == sid),
            None,
        )

        if not collab_session:
            return {
                "success": False,
                "error": "No active collaboration session",
            }

        # Acquire lock
        success, lock = await collaboration_manager.acquire_lock(
            document_id=document_id,
            element_id=element_id,
            user_id=user_id,
            session_id=collab_session.id,
        )

        if success:
            # Notify other users
            room = await get_document_room(document_id)
            await sio.emit(
                "element:locked",
                {
                    "element_id": element_id,
                    "locked_by_user_id": user_id,
                    "locked_by_user_name": collab_session.user_name,
                    "expires_at": lock.expires_at.isoformat(),
                    "document_id": document_id,
                },
                room=room,
                skip_sid=sid,
            )

            return {
                "success": True,
                "lock": {
                    "element_id": element_id,
                    "expires_at": lock.expires_at.isoformat(),
                },
            }
        else:
            # Lock held by another user
            return {
                "success": False,
                "error": "Element locked by another user",
                "locked_by": lock.locked_by_user_id if lock else None,
                "expires_at": lock.expires_at.isoformat() if lock else None,
            }

    except Exception as e:
        logger.error(f"Error locking element: {e}")
        return {
            "success": False,
            "error": str(e),
        }


@sio.event
async def element_unlock(sid: str, data: dict) -> dict:
    """
    Unlock an element.

    Args:
        sid: Socket ID.
        data: Event data containing element_id.

    Returns:
        dict: Response with unlock status.
    """
    try:
        element_id = data.get("element_id")
        if not element_id:
            return {
                "success": False,
                "error": "Missing element_id",
            }

        # Get session info
        async with sio.session(sid) as session:
            user_id = session.get("user_id")
            document_id = session.get("document_id")

        if not document_id or not user_id:
            return {
                "success": False,
                "error": "Not in a document",
            }

        # Release lock
        success = await collaboration_manager.release_lock(
            document_id=document_id,
            element_id=element_id,
            user_id=user_id,
        )

        if success:
            # Notify other users
            room = await get_document_room(document_id)
            await sio.emit(
                "element:unlocked",
                {
                    "element_id": element_id,
                    "document_id": document_id,
                },
                room=room,
                skip_sid=sid,
            )

            return {"success": True}
        else:
            return {
                "success": False,
                "error": "Lock not found or not owned by user",
            }

    except Exception as e:
        logger.error(f"Error unlocking element: {e}")
        return {
            "success": False,
            "error": str(e),
        }


@sio.event
async def cursor_move(sid: str, data: dict) -> None:
    """
    Broadcast cursor movement.

    Args:
        sid: Socket ID.
        data: Event data containing page, x, y coordinates.
    """
    try:
        page = data.get("page")
        x = data.get("x")
        y = data.get("y")

        if page is None or x is None or y is None:
            return

        # Get session info
        async with sio.session(sid) as session:
            user_id = session.get("user_id")
            user_name = session.get("user_name")
            document_id = session.get("document_id")

        if not document_id:
            return

        # Update cursor position in database
        await collaboration_manager.update_cursor(
            socket_id=sid,
            page=page,
            x=x,
            y=y,
        )

        # Broadcast to other users in room
        room = await get_document_room(document_id)
        await sio.emit(
            "cursor:moved",
            {
                "user_id": user_id,
                "user_name": user_name,
                "page": page,
                "x": x,
                "y": y,
            },
            room=room,
            skip_sid=sid,
        )

    except Exception as e:
        logger.error(f"Error broadcasting cursor movement: {e}")


@sio.on("cursor:move")
async def cursor_move_relay(sid: str, data: dict) -> None:
    """
    Broadcast cursor movement using the CLIENT contract.

    The web client emits ``cursor:move`` with
    ``{document_id, position: {x, y}, page_id?}``
    (packages/api/src/websocket/client.ts sendCursorPosition) and listens to
    ``cursor:move`` carrying
    ``{document_id, user_id, user_name, position, page_id?}``
    (packages/api/src/websocket/hooks.ts useDocumentCollaboration).

    The historical ``cursor_move`` handler ({page, x, y} → "cursor:moved")
    is kept above for backward compatibility.

    Args:
        sid: Socket ID.
        data: Client payload with document_id, position {x, y} and page_id.
    """
    try:
        if not isinstance(data, dict):
            return

        position = data.get("position")
        if not isinstance(position, dict):
            return
        x = position.get("x")
        y = position.get("y")
        if x is None or y is None:
            return
        page_id = data.get("page_id")

        # Get session info
        async with sio.session(sid) as session:
            user_id = session.get("user_id")
            user_name = session.get("user_name")
            document_id = session.get("document_id")

        if not document_id:
            return

        # Emitter must target the room it joined (same rule as the relays).
        target_document_id = data.get("document_id")
        if target_document_id and target_document_id != document_id:
            logger.debug(
                f"cursor:move: emitter {sid} targets {target_document_id!r} "
                f"but joined {document_id!r}, dropped"
            )
            return

        # Best-effort persistence: the collaboration session stores an
        # integer page number while the client contract carries an opaque
        # page_id — persist only when coercible, the broadcast below is the
        # source of truth for live cursors.
        page_number: int | None = None
        if page_id is not None:
            try:
                page_number = int(page_id)
            except (TypeError, ValueError):
                page_number = None
        if page_number is not None:
            await collaboration_manager.update_cursor(
                socket_id=sid,
                page=page_number,
                x=x,
                y=y,
            )

        # Broadcast to other users in room, under the name the client listens
        # to and with the payload shape it expects.
        room = await get_document_room(document_id)
        await sio.emit(
            "cursor:move",
            {
                "document_id": document_id,
                "user_id": user_id,
                "user_name": user_name,
                "position": {"x": x, "y": y},
                "page_id": page_id,
            },
            room=room,
            skip_sid=sid,
        )

    except Exception as e:
        logger.error(f"Error relaying cursor movement: {e}")


@sio.event
async def document_update(sid: str, data: dict) -> None:
    """
    Broadcast document updates.

    Args:
        sid: Socket ID.
        data: Event data containing update information.
    """
    try:
        # Get session info
        async with sio.session(sid) as session:
            user_id = session.get("user_id")
            user_name = session.get("user_name")
            document_id = session.get("document_id")

        if not document_id:
            return

        # Broadcast update to other users — "document:update" with document_id
        # is the contract the web client listens to (hooks.ts filters on
        # data.document_id; nothing ever listened to "document:updated").
        room = await get_document_room(document_id)
        await sio.emit(
            "document:update",
            {
                "document_id": document_id,
                "user_id": user_id,
                "user_name": user_name,
                "update_type": data.get("update_type", "unknown"),
                "affected_elements": data.get("affected_elements", []),
                "affected_pages": data.get("affected_pages", []),
                "timestamp": data.get("timestamp"),
                "changes": data.get("changes"),
                "data": data.get("data", {}),
            },
            room=room,
            skip_sid=sid,
        )

        logger.debug(
            f"Document update broadcast from user {user_id} "
            f"on document {document_id}"
        )

    except Exception as e:
        logger.error(f"Error broadcasting document update: {e}")


# ---------------------------------------------------------------------------
# Element collaboration relays (scene graph sync)
#
# The client emits element:create / element:update / element:delete on every
# local mutation (see packages/api/src/websocket/client.ts SocketEventData).
# The server is a pure relay: it validates that the emitter joined the room
# of the targeted document, then rebroadcasts the UNTOUCHED payload to the
# room (skip_sid=emitter). client_id is preserved — receivers use it for
# anti-echo filtering. Persistence is NOT done here: the scene graph goes
# through the REST elements API.
# ---------------------------------------------------------------------------

# Event names contain ":" so they cannot use @sio.event (function-name based).
_ELEMENT_RELAY_REQUIRED_FIELDS: dict[str, tuple[str, ...]] = {
    "element:create": ("document_id", "element"),
    "element:update": ("document_id", "element_id"),
    "element:delete": ("document_id", "element_id"),
    # document:update follows the same pure-relay contract: the client emits
    # {document_id, user_id, changes, client_id} and listens to the SAME
    # event name (hooks.ts useDocumentUpdates filters on data.document_id).
    "document:update": ("document_id",),
}


async def _relay_element_event(event: str, sid: str, data: dict) -> None:
    """
    Relay an element collaboration event to the document room.

    Light validation only (same pattern as document_update):
    - payload is a dict carrying the required fields for the event
    - the emitter has joined the room of the targeted document

    The payload is rebroadcast AS-IS (client_id included — receivers rely
    on it for anti-echo).
    """
    try:
        if not isinstance(data, dict):
            logger.debug(f"{event}: non-dict payload from {sid}, dropped")
            return

        required = _ELEMENT_RELAY_REQUIRED_FIELDS.get(event, ("document_id",))
        missing = [field for field in required if not data.get(field)]
        if missing:
            logger.debug(f"{event}: missing fields {missing} from {sid}, dropped")
            return

        # Get session info (populated by connect/join_document)
        async with sio.session(sid) as session:
            user_id = session.get("user_id")
            joined_document_id = session.get("document_id")

        # Emitter must have joined the room of the document it targets
        if not joined_document_id or joined_document_id != data["document_id"]:
            logger.debug(
                f"{event}: emitter {sid} (user {user_id}) has not joined "
                f"document {data['document_id']!r}, dropped"
            )
            return

        # Rebroadcast the untouched payload to the room, excluding the emitter
        room = await get_document_room(joined_document_id)
        await sio.emit(event, data, room=room, skip_sid=sid)

        logger.debug(
            f"{event} relayed from user {user_id} "
            f"on document {joined_document_id} (socket: {sid})"
        )

    except Exception as e:
        logger.error(f"Error relaying {event}: {e}")


@sio.on("element:create")
async def element_create(sid: str, data: dict) -> None:
    """
    Relay element creation to collaborators.

    Payload: {document_id, element, user_id, page_number?, client_id}
    """
    await _relay_element_event("element:create", sid, data)


@sio.on("element:update")
async def element_update(sid: str, data: dict) -> None:
    """
    Relay element update to collaborators.

    Payload: {document_id, element_id, changes, user_id, client_id}
    """
    await _relay_element_event("element:update", sid, data)


@sio.on("element:delete")
async def element_delete(sid: str, data: dict) -> None:
    """
    Relay element deletion to collaborators.

    Payload: {document_id, element_id, user_id, client_id}
    """
    await _relay_element_event("element:delete", sid, data)


@sio.on("document:update")
async def document_update_relay(sid: str, data: dict) -> None:
    """
    Relay a document-level update using the CLIENT contract.

    The web client emits AND listens to ``document:update`` (see
    useCollaboration.emitDocumentUpdate / useDocumentUpdates). The payload is
    rebroadcast untouched (client_id preserved for anti-echo). The historical
    ``document_update`` handler above is kept for backward compatibility.

    Payload: {document_id, user_id, changes, client_id}
    """
    await _relay_element_event("document:update", sid, data)


# Periodic cleanup tasks
async def cleanup_task():
    """
    Periodic cleanup of expired locks and inactive sessions.

    Should be run as a background task.
    """
    import asyncio

    while True:
        try:
            # Cleanup every 5 minutes
            await asyncio.sleep(300)

            # Clean expired locks
            await collaboration_manager.cleanup_expired_locks()

            # Clean inactive sessions (60 minute timeout)
            await collaboration_manager.cleanup_inactive_sessions(timeout_minutes=60)

        except Exception as e:
            logger.error(f"Error in cleanup task: {e}")


def get_socketio_app() -> socketio.ASGIApp:
    """
    Get the Socket.IO ASGI application.

    Returns:
        socketio.ASGIApp: Socket.IO application for mounting.
    """
    return sio_app
