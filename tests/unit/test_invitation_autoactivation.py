"""Unit tests: invitation auto-activation for existing users.

Behaviour under test (Google-Docs sharing):
  - ``InvitationService.share_document`` with an invitee that already has an
    account creates an ACTIVE ``DocumentShare`` immediately, marks the
    invitation trace ACCEPTED and emits the in-app notification.
  - With an unknown e-mail the historical PENDING flow is preserved: no
    share, no notification, the caller e-mails the token.
  - ``InvitationService.get_invitation_by_token`` is a read-only lookup that
    reports the effective status (expired past the deadline) without
    mutating the row.

Strategy mirrors tests/integration/api/test_storage_access_rls.py: a scripted
``FakeSession`` is injected by monkeypatching ``get_db_session`` inside the
service module, returning the results each call will consume in order.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.models.database import (
    DocumentShare,
    DocumentShareInvitation,
    ShareNotification,
    StoredDocument,
    UserQuota,
)
# NB: the package __init__ rebinds the ``invitation_service`` attribute to the
# module-level SINGLETON, shadowing the submodule — both ``from … import`` and
# ``import … as`` resolve to the instance. Go through sys.modules to get the
# real module object (needed to monkeypatch get_db_session).
import importlib

invitation_module = importlib.import_module(
    "app.services.sharing.invitation_service"
)
from app.services.sharing.constants import InvitationStatus, ShareStatus
from app.services.sharing.invitation_service import InvitationService

OWNER_ID = "owner-inv-0000-0000-0000-000000000001"
INVITEE_ID = "invitee-inv-0000-0000-0000-000000000002"
INVITEE_EMAIL = "invitee@example.com"
DOC_ID = "770e8400-e29b-41d4-a716-446655440002"


# ---------------------------------------------------------------------------
# Scripted fake AsyncSession
# ---------------------------------------------------------------------------

class FakeResult:
    def __init__(self, *, scalar=None, rows=None):
        self._scalar = scalar
        self._rows = rows if rows is not None else []

    def scalar_one_or_none(self):
        return self._scalar

    def all(self):
        return list(self._rows)


class FakeSession:
    def __init__(self, results: list[FakeResult]):
        self._results = list(results)
        self.added: list = []
        self.commit_count = 0

    async def execute(self, stmt, *args, **kwargs):
        if not self._results:
            raise AssertionError(f"FakeSession: unexpected execute() for: {stmt}")
        return self._results.pop(0)

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        self.commit_count += 1

    async def rollback(self):
        pass

    async def close(self):
        pass


class _CtxSession:
    def __init__(self, sess: FakeSession):
        self._sess = sess

    async def __aenter__(self):
        return self._sess

    async def __aexit__(self, *a):
        return False


@pytest.fixture
def use_session(monkeypatch):
    """Install a scripted FakeSession as the service's DB session."""

    def _install(results: list[FakeResult]) -> FakeSession:
        session = FakeSession(results)
        monkeypatch.setattr(
            invitation_module, "get_db_session", lambda: _CtxSession(session)
        )
        return session

    return _install


# ---------------------------------------------------------------------------
# Factories
# ---------------------------------------------------------------------------

def _make_doc(**overrides) -> StoredDocument:
    now = datetime.now(UTC)
    defaults = dict(
        id=DOC_ID,
        name="Contrat.pdf",
        owner_id=OWNER_ID,
        folder_id=None,
        page_count=3,
        current_version=1,
        file_size_bytes=1024,
        mime_type="application/pdf",
        original_format="pdf",
        tags=[],
        thumbnail_path=None,
        is_deleted=False,
        deleted_at=None,
        created_at=now,
        updated_at=now,
    )
    defaults.update(overrides)
    return StoredDocument(**defaults)


def _make_invitee_quota() -> UserQuota:
    return UserQuota(user_id=INVITEE_ID, email=INVITEE_EMAIL)


def _make_invitation(**overrides) -> DocumentShareInvitation:
    now = datetime.now(UTC)
    defaults = dict(
        id="inv-0000-0000-0000-000000000042",
        document_id=DOC_ID,
        inviter_id=OWNER_ID,
        invitee_email=INVITEE_EMAIL,
        invitee_user_id=None,
        token="tok-secret",
        permission="edit",
        message=None,
        status=InvitationStatus.PENDING,
        expires_at=now + timedelta(days=7),
        responded_at=None,
        created_at=now,
    )
    defaults.update(overrides)
    invitation = DocumentShareInvitation(**defaults)
    invitation.document = _make_doc()
    return invitation


# ---------------------------------------------------------------------------
# share_document — auto-activation for an existing invitee
# ---------------------------------------------------------------------------

class TestShareDocumentAutoActivation:
    async def test_existing_user_gets_active_share_immediately(self, use_session):
        session = use_session([
            FakeResult(scalar=_make_doc()),           # document lookup (owner)
            FakeResult(scalar=None),                  # no duplicate invitation
            FakeResult(scalar=_make_invitee_quota()),  # invitee HAS an account
        ])

        result = await InvitationService.share_document(
            document_id=DOC_ID,
            inviter_id=OWNER_ID,
            invitee_email=INVITEE_EMAIL,
            permission="edit",
        )

        assert result["invitee_user_exists"] is True
        assert result["share_id"] is not None

        shares = [o for o in session.added if isinstance(o, DocumentShare)]
        assert len(shares) == 1
        share = shares[0]
        assert share.status == ShareStatus.ACTIVE
        assert share.shared_with_user_id == INVITEE_ID
        assert share.permission == "edit"
        assert share.created_by == OWNER_ID
        # The active share does not expire (same as the accept flow); only
        # the invitation acceptance window carries the expiry.
        assert share.expires_at is None

        invitations = [
            o for o in session.added if isinstance(o, DocumentShareInvitation)
        ]
        assert len(invitations) == 1
        invitation = invitations[0]
        assert invitation.status == InvitationStatus.ACCEPTED
        assert invitation.invitee_user_id == INVITEE_ID
        assert invitation.responded_at is not None
        assert share.invitation_id == invitation.id

        notifications = [o for o in session.added if isinstance(o, ShareNotification)]
        assert len(notifications) == 1
        notif = notifications[0]
        assert notif.user_id == INVITEE_ID
        assert notif.notification_type == "share_invitation"
        # extra_data (the mapped JSON column) must actually be populated —
        # the ``metadata=`` kwarg was silently dropped by SQLAlchemy.
        assert notif.extra_data["share_id"] == share.id
        assert notif.extra_data["permission"] == "edit"

        assert session.commit_count == 1

    async def test_requested_permission_is_honoured(self, use_session):
        session = use_session([
            FakeResult(scalar=_make_doc()),
            FakeResult(scalar=None),
            FakeResult(scalar=_make_invitee_quota()),
        ])

        result = await InvitationService.share_document(
            document_id=DOC_ID,
            inviter_id=OWNER_ID,
            invitee_email=INVITEE_EMAIL,
            permission="view",
        )

        assert result["permission"] == "view"
        share = next(o for o in session.added if isinstance(o, DocumentShare))
        assert share.permission == "view"

    async def test_unknown_email_keeps_pending_flow(self, use_session):
        session = use_session([
            FakeResult(scalar=_make_doc()),  # document lookup (owner)
            FakeResult(scalar=None),         # no duplicate invitation
            FakeResult(scalar=None),         # invitee has NO account
        ])

        result = await InvitationService.share_document(
            document_id=DOC_ID,
            inviter_id=OWNER_ID,
            invitee_email="stranger@example.com",
            permission="edit",
        )

        assert result["invitee_user_exists"] is False
        assert result["share_id"] is None
        assert result["token"]  # caller e-mails the token

        assert not any(isinstance(o, DocumentShare) for o in session.added)
        assert not any(isinstance(o, ShareNotification) for o in session.added)

        invitation = next(
            o for o in session.added if isinstance(o, DocumentShareInvitation)
        )
        assert invitation.status == InvitationStatus.PENDING
        assert invitation.invitee_user_id is None
        assert session.commit_count == 1

    async def test_duplicate_active_invitation_still_rejected(self, use_session):
        use_session([
            FakeResult(scalar=_make_doc()),
            FakeResult(scalar=_make_invitation(status=InvitationStatus.ACCEPTED)),
        ])

        with pytest.raises(ValueError, match="already shared"):
            await InvitationService.share_document(
                document_id=DOC_ID,
                inviter_id=OWNER_ID,
                invitee_email=INVITEE_EMAIL,
            )

    async def test_document_not_owned_is_rejected(self, use_session):
        use_session([FakeResult(scalar=None)])  # owner-scoped lookup finds nothing

        with pytest.raises(ValueError, match="not found"):
            await InvitationService.share_document(
                document_id=DOC_ID,
                inviter_id="not-the-owner",
                invitee_email=INVITEE_EMAIL,
            )


# ---------------------------------------------------------------------------
# get_invitation_by_token — read-only lookup
# ---------------------------------------------------------------------------

class TestGetInvitationByToken:
    async def test_returns_details_for_pending_invitation(self, use_session):
        session = use_session([
            FakeResult(scalar=_make_invitation()),
            FakeResult(scalar=UserQuota(user_id=OWNER_ID, email="owner@example.com")),
        ])

        result = await InvitationService.get_invitation_by_token("tok-secret")

        assert result["status"] == InvitationStatus.PENDING
        assert result["document"]["name"] == "Contrat.pdf"
        assert result["inviter"]["email"] == "owner@example.com"
        assert result["permission"] == "edit"
        assert result["invitee_email"] == INVITEE_EMAIL
        # Strictly read-only: nothing persisted.
        assert session.commit_count == 0
        assert session.added == []

    async def test_expired_invitation_reports_expired_without_mutation(
        self, use_session
    ):
        expired = _make_invitation(
            expires_at=datetime.now(UTC) - timedelta(days=1)
        )
        session = use_session([
            FakeResult(scalar=expired),
            FakeResult(scalar=None),
        ])

        result = await InvitationService.get_invitation_by_token("tok-secret")

        assert result["status"] == InvitationStatus.EXPIRED
        # The row itself keeps its stored status (no write in a GET).
        assert expired.status == InvitationStatus.PENDING
        assert session.commit_count == 0

    async def test_already_accepted_invitation_reports_accepted(self, use_session):
        use_session([
            FakeResult(scalar=_make_invitation(status=InvitationStatus.ACCEPTED)),
            FakeResult(scalar=None),
        ])

        result = await InvitationService.get_invitation_by_token("tok-secret")

        assert result["status"] == InvitationStatus.ACCEPTED

    async def test_unknown_token_raises(self, use_session):
        use_session([FakeResult(scalar=None)])

        with pytest.raises(ValueError, match="not found"):
            await InvitationService.get_invitation_by_token("nope")

