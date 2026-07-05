"""
Unit tests for the collaboration binary-update relay and per-element soft-locks.

Pins the server side of the v1.26 collaboration completion:

- document:update carrying ``type: "binary"`` is relayed UNTOUCHED to the room
  (client_id preserved for anti-echo, emitter excluded via skip_sid) — this is
  what makes a peer reload the PDF after another user saves a new S3 version.
- element_lock (a user selects an element) broadcasts ``element:locked`` to the
  OTHER members of the room (skip_sid=emitter) with the document_id, so a client
  never receives the echo of its own lock.
- element_unlock broadcasts ``element:unlocked`` the same way.
- disconnect releases the socket's held locks AND tells the room (one
  ``element:unlocked`` per element) so peers un-grey immediately instead of
  waiting on the silent 5-min server expiry.
- join replays the already-held locks to the newcomer as ``element:locked``
  events (the client does not consume the join ack).
"""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.api.websocket import (
    disconnect,
    document_update_relay,
    element_lock,
    element_unlock,
    _join_document_impl,
)

SID = "socket-emitter"
NOW = datetime(2026, 7, 5, 12, 0, 0, tzinfo=timezone.utc)


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


def _collab_session(user_id: str = "user-1", user_name: str = "Alice"):
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


JOINED_SESSION = {"user_id": "user-1", "user_name": "Alice", "document_id": "doc-1"}


class TestBinaryUpdateRelay:
    """document:update {type:"binary"} → relayed untouched, emitter excluded."""

    @pytest.mark.asyncio
    async def test_binary_update_relayed_with_skip_sid_untouched(self):
        fake_sio = _make_fake_sio(dict(JOINED_SESSION))
        payload = {
            "document_id": "doc-1",
            "type": "binary",
            "version": 1720180800000,
            "client_id": "client-abc",  # anti-echo marker MUST survive the relay
        }

        with patch("app.api.websocket.sio", fake_sio):
            await document_update_relay(SID, payload)

        fake_sio.emit.assert_awaited_once_with(
            "document:update",
            payload,
            room="document:doc-1",
            skip_sid=SID,
        )
        relayed = fake_sio.emit.await_args.args[1]
        assert relayed["type"] == "binary"
        assert relayed["version"] == 1720180800000
        assert relayed["client_id"] == "client-abc"

    @pytest.mark.asyncio
    async def test_binary_update_from_unjoined_emitter_is_dropped(self):
        fake_sio = _make_fake_sio({"user_id": "user-1", "document_id": None})

        with patch("app.api.websocket.sio", fake_sio):
            await document_update_relay(
                SID, {"document_id": "doc-1", "type": "binary"}
            )

        fake_sio.emit.assert_not_awaited()


class TestElementLock:
    """element_lock / element_unlock broadcast to the room with skip_sid."""

    @pytest.mark.asyncio
    async def test_lock_success_broadcasts_element_locked(self):
        fake_sio = _make_fake_sio(dict(JOINED_SESSION))
        manager = MagicMock()
        manager.get_active_users = AsyncMock(return_value=[_collab_session()])
        lock = SimpleNamespace(expires_at=NOW, locked_by_user_id="user-1")
        manager.acquire_lock = AsyncMock(return_value=(True, lock))

        with (
            patch("app.api.websocket.sio", fake_sio),
            patch("app.api.websocket.collaboration_manager", manager),
        ):
            result = await element_lock(SID, {"element_id": "el-1"})

        assert result["success"] is True
        fake_sio.emit.assert_awaited_once_with(
            "element:locked",
            {
                "element_id": "el-1",
                "locked_by_user_id": "user-1",
                "locked_by_user_name": "Alice",
                "expires_at": NOW.isoformat(),
                "document_id": "doc-1",
            },
            room="document:doc-1",
            skip_sid=SID,
        )

    @pytest.mark.asyncio
    async def test_lock_held_by_other_does_not_broadcast(self):
        fake_sio = _make_fake_sio(dict(JOINED_SESSION))
        manager = MagicMock()
        manager.get_active_users = AsyncMock(return_value=[_collab_session()])
        other = SimpleNamespace(locked_by_user_id="user-2", expires_at=NOW)
        manager.acquire_lock = AsyncMock(return_value=(False, other))

        with (
            patch("app.api.websocket.sio", fake_sio),
            patch("app.api.websocket.collaboration_manager", manager),
        ):
            result = await element_lock(SID, {"element_id": "el-1"})

        assert result["success"] is False
        fake_sio.emit.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_lock_missing_element_id_is_rejected(self):
        fake_sio = _make_fake_sio(dict(JOINED_SESSION))

        with patch("app.api.websocket.sio", fake_sio):
            result = await element_lock(SID, {})

        assert result["success"] is False
        fake_sio.emit.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_unlock_success_broadcasts_element_unlocked(self):
        fake_sio = _make_fake_sio(dict(JOINED_SESSION))
        manager = MagicMock()
        manager.release_lock = AsyncMock(return_value=True)

        with (
            patch("app.api.websocket.sio", fake_sio),
            patch("app.api.websocket.collaboration_manager", manager),
        ):
            result = await element_unlock(SID, {"element_id": "el-1"})

        assert result["success"] is True
        fake_sio.emit.assert_awaited_once_with(
            "element:unlocked",
            {"element_id": "el-1", "document_id": "doc-1"},
            room="document:doc-1",
            skip_sid=SID,
        )


class TestDisconnectReleasesLocks:
    """On disconnect, the socket's locks are released AND broadcast to the room."""

    @pytest.mark.asyncio
    async def test_disconnect_broadcasts_unlock_per_held_element(self):
        fake_sio = _make_fake_sio(dict(JOINED_SESSION))
        manager = MagicMock()
        manager.get_locked_element_ids = AsyncMock(return_value=["el-1", "el-2"])
        manager.remove_session = AsyncMock(return_value=_collab_session())

        with (
            patch("app.api.websocket.sio", fake_sio),
            patch("app.api.websocket.collaboration_manager", manager),
        ):
            await disconnect(SID)

        # Locks captured BEFORE removal (remove_session deletes them).
        manager.get_locked_element_ids.assert_awaited_once_with(SID)
        manager.remove_session.assert_awaited_once_with(SID)

        emitted = [
            (call.args[0], call.args[1])
            for call in fake_sio.emit.await_args_list
        ]
        assert ("user:leave", emitted[0][1]) == ("user:leave", emitted[0][1])
        unlocks = [payload for name, payload in emitted if name == "element:unlocked"]
        assert {"element_id": "el-1", "document_id": "doc-1"} in unlocks
        assert {"element_id": "el-2", "document_id": "doc-1"} in unlocks

    @pytest.mark.asyncio
    async def test_disconnect_without_document_does_not_touch_locks(self):
        fake_sio = _make_fake_sio({"user_id": "user-1", "document_id": None})
        manager = MagicMock()
        manager.get_locked_element_ids = AsyncMock(return_value=[])
        manager.remove_session = AsyncMock(return_value=None)

        with (
            patch("app.api.websocket.sio", fake_sio),
            patch("app.api.websocket.collaboration_manager", manager),
        ):
            await disconnect(SID)

        manager.get_locked_element_ids.assert_not_awaited()
        fake_sio.emit.assert_not_awaited()


class TestJoinLockBackfill:
    """A newcomer receives the already-held locks as element:locked events."""

    @pytest.mark.asyncio
    async def test_join_replays_active_locks_to_newcomer(self):
        session_data = {"user_id": "user-2", "user_name": "Bob"}
        fake_sio = _make_fake_sio(session_data)

        manager = MagicMock()
        manager.create_session = AsyncMock(
            return_value=_collab_session(user_id="user-2", user_name="Bob")
        )
        # An existing user (Alice) holds a lock on el-9.
        alice = SimpleNamespace(
            socket_id="socket-alice",
            user_id="user-1",
            user_name="Alice",
            user_color="#FF6B6B",
            cursor_page=None,
            cursor_x=None,
            cursor_y=None,
        )
        manager.get_active_users = AsyncMock(return_value=[alice])
        manager.get_document_locks = AsyncMock(
            return_value=[
                SimpleNamespace(
                    element_id="el-9",
                    locked_by_user_id="user-1",
                    expires_at=NOW,
                )
            ]
        )

        with (
            patch("app.api.websocket.sio", fake_sio),
            patch("app.api.websocket.collaboration_manager", manager),
            patch(
                "app.api.websocket._authorize_document_join",
                AsyncMock(return_value=True),
            ),
        ):
            result = await _join_document_impl(SID, {"document_id": "doc-1"})

        assert result["success"] is True
        locked_events = [
            call
            for call in fake_sio.emit.await_args_list
            if call.args[0] == "element:locked"
        ]
        assert len(locked_events) == 1
        payload = locked_events[0].args[1]
        assert payload["element_id"] == "el-9"
        assert payload["locked_by_user_id"] == "user-1"
        assert payload["locked_by_user_name"] == "Alice"
        assert payload["document_id"] == "doc-1"
        # Replayed only to the newcomer, not broadcast.
        assert locked_events[0].kwargs.get("to") == SID
