"""Integration tests: GET /api/v1/sharing/invitations/{token} (read-only lookup).

The endpoint powers the /invitations/[token] landing page: an authenticated
invitee reviews the invitation (document, inviter, permission, status) before
accepting or declining.

Also guards the route-ordering invariant: the literal
``/invitations/pending`` route must keep matching BEFORE the ``{token}``
parameterised route (FastAPI matches in declaration order).
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.middleware.auth import CurrentUser, get_current_user

USER_ID = "user-lookup-0000-0000-0000-000000000001"
TOKEN = "tok-lookup-secret"

INVITATION_PAYLOAD = {
    "invitation_id": "inv-lookup-42",
    "status": "pending",
    "invitee_email": "invitee@example.com",
    "document": {
        "id": "770e8400-e29b-41d4-a716-446655440002",
        "name": "Contrat.pdf",
        "page_count": 3,
        "thumbnail_path": None,
    },
    "inviter": {"user_id": "owner-1", "email": "owner@example.com"},
    "permission": "edit",
    "message": "Please review",
    "created_at": "2026-07-01T10:00:00+00:00",
    "expires_at": "2026-07-08T10:00:00+00:00",
}


@pytest.fixture(autouse=True)
def no_rate_limit(monkeypatch):
    limiter = SimpleNamespace(is_allowed=AsyncMock(return_value=(True, 999, 60)))
    monkeypatch.setattr(
        "app.middleware.rate_limiter.get_rate_limiter",
        AsyncMock(return_value=limiter),
    )


@pytest.fixture
def as_user(app):
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        user_id=USER_ID, email="invitee@example.com"
    )
    yield
    app.dependency_overrides.pop(get_current_user, None)


class TestGetInvitationByTokenEndpoint:
    def test_returns_invitation_details(self, client, as_user, monkeypatch):
        monkeypatch.setattr(
            "app.api.v1.sharing.share_service.get_invitation_by_token",
            AsyncMock(return_value=dict(INVITATION_PAYLOAD)),
        )

        resp = client.get(f"/api/v1/sharing/invitations/{TOKEN}")

        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["status"] == "pending"
        assert data["document"]["name"] == "Contrat.pdf"
        assert data["inviter"]["email"] == "owner@example.com"
        assert data["permission"] == "edit"

    def test_unknown_token_is_404(self, client, as_user, monkeypatch):
        monkeypatch.setattr(
            "app.api.v1.sharing.share_service.get_invitation_by_token",
            AsyncMock(side_effect=ValueError("Invitation not found")),
        )

        resp = client.get(f"/api/v1/sharing/invitations/{TOKEN}")

        assert resp.status_code == 404

    def test_pending_literal_route_not_captured_by_token(
        self, client, as_user, monkeypatch
    ):
        """GET /invitations/pending must keep hitting the pending-list route."""
        lookup = AsyncMock(return_value=dict(INVITATION_PAYLOAD))
        pending = AsyncMock(return_value=[])
        monkeypatch.setattr(
            "app.api.v1.sharing.share_service.get_invitation_by_token", lookup
        )
        monkeypatch.setattr(
            "app.api.v1.sharing.share_service.get_pending_invitations", pending
        )

        resp = client.get("/api/v1/sharing/invitations/pending")

        assert resp.status_code == 200
        assert resp.json()["data"] == {"invitations": [], "count": 0}
        pending.assert_awaited_once()
        lookup.assert_not_awaited()
