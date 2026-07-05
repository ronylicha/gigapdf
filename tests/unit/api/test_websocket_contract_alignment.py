"""
Unit tests for the Socket.IO client/server event contract alignment.

The web client (packages/api/src/websocket/client.ts + hooks.ts) emits
document:join / document:leave / cursor:move / document:update and listens to
user:join / user:leave / cursor:move / document:update. These tests pin the
server side of that contract:

- document:join / document:leave aliases delegate to the join/leave logic
- enter_room / leave_room are AWAITED (coroutines since python-socketio 5.10)
- join is gated by the owner-or-shared authorization (access_guard) BEFORE
  entering the room; a denied user gets an error event + failure ack and the
  socket session is NOT marked as joined
- presence events are emitted under the names/shapes the client listens to
  (user:join / user:leave, with document_id)
- cursor:move relays the client payload shape ({position: {x, y}, page_id})
- document:update is relayed untouched (client_id preserved for anti-echo)
"""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.api.websocket import (
    _authorize_document_join,
    _join_document_impl,
    _leave_document_impl,
    cursor_move_relay,
    document_update_relay,
)

SID = "socket-emitter"
NOW = datetime(2026, 7, 3, 12, 0, 0, tzinfo=timezone.utc)


class _FakeSessionCtx:
    """Mimic socketio.AsyncServer.session() async context manager."""

    def __init__(self, data: dict):
        self._data = data

    async def __aenter__(self) -> dict:
        return self._data

    async def __aexit__(self, exc_type, exc, tb) -> bool:
        return False


def _make_fake_sio(session_data: dict) -> MagicMock:
    fake_sio = MagicMock()
    fake_sio.session = MagicMock(return_value=_FakeSessionCtx(session_data))
    fake_sio.emit = AsyncMock()
    fake_sio.enter_room = AsyncMock()
    fake_sio.leave_room = AsyncMock()
    return fake_sio


def _make_collab_session(user_id: str = "user-1", user_name: str = "Alice"):
    return SimpleNamespace(
        id="collab-session-1",
        user_id=user_id,
        user_name=user_name,
        user_color="#FF6B6B",
        joined_at=NOW,
        last_seen_at=NOW,
        socket_id=SID,
        cursor_page=None,
        cursor_x=None,
        cursor_y=None,
    )


def _make_fake_manager(active_users: list | None = None) -> MagicMock:
    manager = MagicMock()
    manager.create_session = AsyncMock(return_value=_make_collab_session())
    manager.remove_session = AsyncMock(return_value=_make_collab_session())
    manager.get_active_users = AsyncMock(return_value=active_users or [])
    manager.get_document_locks = AsyncMock(return_value=[])
    # disconnect/leave capture the socket's held locks before removal to
    # broadcast element:unlocked to the room (v1.26 soft-locks).
    manager.get_locked_element_ids = AsyncMock(return_value=[])
    manager.update_cursor = AsyncMock()
    return manager


class TestDocumentJoin:
    """document:join / join_document — authorization + awaited enter_room."""

    @pytest.mark.asyncio
    async def test_authorized_join_enters_room_and_emits_user_join(self):
        session_data = {"user_id": "user-1", "user_name": "Alice"}
        fake_sio = _make_fake_sio(session_data)
        fake_manager = _make_fake_manager()

        with (
            patch("app.api.websocket.sio", fake_sio),
            patch("app.api.websocket.collaboration_manager", fake_manager),
            patch(
                "app.api.websocket._authorize_document_join",
                AsyncMock(return_value=True),
            ) as mock_auth,
        ):
            result = await _join_document_impl(SID, {"document_id": "doc-1"})

        assert result["success"] is True
        mock_auth.assert_awaited_once_with("doc-1", "user-1")
        # Fix 3: enter_room is a coroutine — it MUST be awaited
        fake_sio.enter_room.assert_awaited_once_with(SID, "document:doc-1")
        # The socket session is marked as joined (element relays rely on it)
        assert session_data["document_id"] == "doc-1"
        # Fix 2: presence broadcast under the CLIENT contract, with document_id
        fake_sio.emit.assert_awaited_once_with(
            "user:join",
            {
                "document_id": "doc-1",
                "user_id": "user-1",
                "user_name": "Alice",
                "user_color": "#FF6B6B",
                "timestamp": NOW.isoformat(),
            },
            room="document:doc-1",
            skip_sid=SID,
        )

    @pytest.mark.asyncio
    async def test_join_backfills_existing_users_to_newcomer(self):
        existing = SimpleNamespace(
            socket_id="socket-other",
            user_id="user-2",
            user_name="Bob",
            user_color="#4ECDC4",
            cursor_page=None,
            cursor_x=None,
            cursor_y=None,
        )
        fake_sio = _make_fake_sio({"user_id": "user-1", "user_name": "Alice"})
        fake_manager = _make_fake_manager(active_users=[existing])

        with (
            patch("app.api.websocket.sio", fake_sio),
            patch("app.api.websocket.collaboration_manager", fake_manager),
            patch(
                "app.api.websocket._authorize_document_join",
                AsyncMock(return_value=True),
            ),
        ):
            result = await _join_document_impl(SID, {"document_id": "doc-1"})

        assert result["success"] is True
        # Second emit = replay of the already-active user, targeted to the
        # newcomer only (the client builds presence from user:join events).
        backfill_call = fake_sio.emit.await_args_list[1]
        assert backfill_call.args[0] == "user:join"
        assert backfill_call.args[1]["document_id"] == "doc-1"
        assert backfill_call.args[1]["user_id"] == "user-2"
        assert backfill_call.kwargs == {"to": SID}

    @pytest.mark.asyncio
    async def test_denied_join_does_not_enter_room(self):
        session_data = {"user_id": "user-1", "user_name": "Alice"}
        fake_sio = _make_fake_sio(session_data)
        fake_manager = _make_fake_manager()

        with (
            patch("app.api.websocket.sio", fake_sio),
            patch("app.api.websocket.collaboration_manager", fake_manager),
            patch(
                "app.api.websocket._authorize_document_join",
                AsyncMock(return_value=False),
            ),
        ):
            result = await _join_document_impl(SID, {"document_id": "doc-1"})

        assert result["success"] is False
        fake_sio.enter_room.assert_not_awaited()
        fake_manager.create_session.assert_not_awaited()
        # The socket session must NOT be marked as joined (element relays
        # trust session["document_id"])
        assert "document_id" not in session_data
        # The client is told why (error event targeted at the emitter)
        fake_sio.emit.assert_awaited_once()
        event, payload = fake_sio.emit.await_args.args
        assert event == "error"
        assert payload["event"] == "document:join"
        assert payload["document_id"] == "doc-1"
        assert fake_sio.emit.await_args.kwargs == {"to": SID}

    @pytest.mark.asyncio
    async def test_join_without_document_id_fails(self):
        fake_sio = _make_fake_sio({"user_id": "user-1", "user_name": "Alice"})

        with patch("app.api.websocket.sio", fake_sio):
            result = await _join_document_impl(SID, {})

        assert result["success"] is False
        fake_sio.enter_room.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_join_unauthenticated_fails_before_authorization(self):
        fake_sio = _make_fake_sio({})

        with (
            patch("app.api.websocket.sio", fake_sio),
            patch(
                "app.api.websocket._authorize_document_join",
                AsyncMock(return_value=True),
            ) as mock_auth,
        ):
            result = await _join_document_impl(SID, {"document_id": "doc-1"})

        assert result["success"] is False
        mock_auth.assert_not_awaited()
        fake_sio.enter_room.assert_not_awaited()


class TestDocumentLeave:
    """document:leave / leave_document — awaited leave_room + user:leave."""

    @pytest.mark.asyncio
    async def test_leave_awaits_leave_room_and_emits_user_leave(self):
        session_data = {
            "user_id": "user-1",
            "user_name": "Alice",
            "document_id": "doc-1",
        }
        fake_sio = _make_fake_sio(session_data)
        fake_manager = _make_fake_manager()

        with (
            patch("app.api.websocket.sio", fake_sio),
            patch("app.api.websocket.collaboration_manager", fake_manager),
        ):
            result = await _leave_document_impl(SID, {})

        assert result["success"] is True
        # Fix 3: leave_room is a coroutine — it MUST be awaited
        fake_sio.leave_room.assert_awaited_once_with(SID, "document:doc-1")
        assert session_data["document_id"] is None
        # Fix 2: contract name + document_id for the client-side filter
        event, payload = fake_sio.emit.await_args.args
        assert event == "user:leave"
        assert payload["document_id"] == "doc-1"
        assert payload["user_id"] == "user-1"

    @pytest.mark.asyncio
    async def test_leave_when_not_joined_fails(self):
        fake_sio = _make_fake_sio({"user_id": "user-1"})

        with patch("app.api.websocket.sio", fake_sio):
            result = await _leave_document_impl(SID, {})

        assert result["success"] is False
        fake_sio.leave_room.assert_not_awaited()


class TestCursorMoveRelay:
    """cursor:move — client payload in, client payload out."""

    @pytest.mark.asyncio
    async def test_relays_client_shape_with_skip_sid(self):
        fake_sio = _make_fake_sio(
            {"user_id": "user-1", "user_name": "Alice", "document_id": "doc-1"}
        )
        fake_manager = _make_fake_manager()

        with (
            patch("app.api.websocket.sio", fake_sio),
            patch("app.api.websocket.collaboration_manager", fake_manager),
        ):
            await cursor_move_relay(
                SID,
                {
                    "document_id": "doc-1",
                    "position": {"x": 12.5, "y": 34.0},
                    "page_id": "page-uuid-1",
                },
            )

        fake_sio.emit.assert_awaited_once_with(
            "cursor:move",
            {
                "document_id": "doc-1",
                "user_id": "user-1",
                "user_name": "Alice",
                "position": {"x": 12.5, "y": 34.0},
                "page_id": "page-uuid-1",
            },
            room="document:doc-1",
            skip_sid=SID,
        )
        # Opaque page_id (not an int) → no DB persistence attempt
        fake_manager.update_cursor.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_integer_page_id_is_persisted(self):
        fake_sio = _make_fake_sio(
            {"user_id": "user-1", "user_name": "Alice", "document_id": "doc-1"}
        )
        fake_manager = _make_fake_manager()

        with (
            patch("app.api.websocket.sio", fake_sio),
            patch("app.api.websocket.collaboration_manager", fake_manager),
        ):
            await cursor_move_relay(
                SID,
                {
                    "document_id": "doc-1",
                    "position": {"x": 1, "y": 2},
                    "page_id": "3",
                },
            )

        fake_manager.update_cursor.assert_awaited_once_with(
            socket_id=SID, page=3, x=1, y=2
        )
        fake_sio.emit.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_document_mismatch_is_dropped(self):
        fake_sio = _make_fake_sio(
            {"user_id": "user-1", "user_name": "Alice", "document_id": "doc-1"}
        )

        with patch("app.api.websocket.sio", fake_sio):
            await cursor_move_relay(
                SID,
                {"document_id": "doc-2", "position": {"x": 1, "y": 2}},
            )

        fake_sio.emit.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_missing_position_is_dropped(self):
        fake_sio = _make_fake_sio(
            {"user_id": "user-1", "user_name": "Alice", "document_id": "doc-1"}
        )

        with patch("app.api.websocket.sio", fake_sio):
            await cursor_move_relay(SID, {"document_id": "doc-1"})

        fake_sio.emit.assert_not_awaited()


class TestDocumentUpdateRelay:
    """document:update — pure relay, client_id preserved (anti-echo)."""

    @pytest.mark.asyncio
    async def test_relays_payload_untouched(self):
        fake_sio = _make_fake_sio(
            {"user_id": "user-1", "user_name": "Alice", "document_id": "doc-1"}
        )
        payload = {
            "document_id": "doc-1",
            "user_id": "user-1",
            "changes": {"title": "New title"},
            "client_id": "client-abc",
        }

        with patch("app.api.websocket.sio", fake_sio):
            await document_update_relay(SID, payload)

        fake_sio.emit.assert_awaited_once_with(
            "document:update",
            payload,
            room="document:doc-1",
            skip_sid=SID,
        )
        assert fake_sio.emit.await_args.args[1]["client_id"] == "client-abc"

    @pytest.mark.asyncio
    async def test_emitter_not_joined_is_dropped(self):
        fake_sio = _make_fake_sio({"user_id": "user-1", "document_id": None})

        with patch("app.api.websocket.sio", fake_sio):
            await document_update_relay(
                SID, {"document_id": "doc-1", "changes": {}}
            )

        fake_sio.emit.assert_not_awaited()


class _FakeDbCtx:
    """Mimic get_db_session() async context manager."""

    def __init__(self, db):
        self._db = db

    async def __aenter__(self):
        return self._db

    async def __aexit__(self, exc_type, exc, tb) -> bool:
        return False


def _make_fake_db(stored_doc) -> MagicMock:
    db = MagicMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none = MagicMock(return_value=stored_doc)
    db.execute = AsyncMock(return_value=execute_result)
    return db


class TestAuthorizeDocumentJoin:
    """Owner-or-shared gate: stored documents via access_guard, session
    documents via the transient registry (owner only)."""

    @pytest.mark.asyncio
    async def test_stored_document_authorized_by_access_guard(self):
        stored_doc = SimpleNamespace(id="doc-1", owner_id="user-1")
        fake_db = _make_fake_db(stored_doc)

        with (
            patch(
                "app.api.websocket.get_db_session",
                MagicMock(return_value=_FakeDbCtx(fake_db)),
            ),
            patch(
                "app.api.websocket.authorize_document_access",
                AsyncMock(return_value=SimpleNamespace(is_owner=True)),
            ) as mock_guard,
        ):
            assert await _authorize_document_join("doc-1", "user-1") is True

        mock_guard.assert_awaited_once_with(fake_db, stored_doc, "user-1")

    @pytest.mark.asyncio
    async def test_stored_document_guard_403_denies_join(self):
        stored_doc = SimpleNamespace(id="doc-1", owner_id="owner-9")
        fake_db = _make_fake_db(stored_doc)

        with (
            patch(
                "app.api.websocket.get_db_session",
                MagicMock(return_value=_FakeDbCtx(fake_db)),
            ),
            patch(
                "app.api.websocket.authorize_document_access",
                AsyncMock(
                    side_effect=HTTPException(status_code=403, detail="nope")
                ),
            ),
        ):
            assert await _authorize_document_join("doc-1", "user-1") is False

    @pytest.mark.asyncio
    async def test_session_document_owner_is_allowed(self):
        fake_db = _make_fake_db(None)  # not a stored document
        fake_sessions = MagicMock()
        fake_sessions.get_session_async = AsyncMock(
            return_value=SimpleNamespace(owner_id="user-1")
        )

        with (
            patch(
                "app.api.websocket.get_db_session",
                MagicMock(return_value=_FakeDbCtx(fake_db)),
            ),
            patch("app.api.websocket.document_sessions", fake_sessions),
        ):
            assert await _authorize_document_join("session-1", "user-1") is True

    @pytest.mark.asyncio
    async def test_session_document_non_owner_is_denied(self):
        fake_db = _make_fake_db(None)
        fake_sessions = MagicMock()
        fake_sessions.get_session_async = AsyncMock(
            return_value=SimpleNamespace(owner_id="someone-else")
        )

        with (
            patch(
                "app.api.websocket.get_db_session",
                MagicMock(return_value=_FakeDbCtx(fake_db)),
            ),
            patch("app.api.websocket.document_sessions", fake_sessions),
        ):
            assert await _authorize_document_join("session-1", "user-1") is False

    @pytest.mark.asyncio
    async def test_unknown_document_is_denied(self):
        fake_db = _make_fake_db(None)
        fake_sessions = MagicMock()
        fake_sessions.get_session_async = AsyncMock(return_value=None)

        with (
            patch(
                "app.api.websocket.get_db_session",
                MagicMock(return_value=_FakeDbCtx(fake_db)),
            ),
            patch("app.api.websocket.document_sessions", fake_sessions),
        ):
            assert await _authorize_document_join("ghost", "user-1") is False
