"""Unit tests: public link resolution in ShareCrudService.

Behaviour under test (anonymous /public/[token] viewer):
  - ``resolve_public_link`` returns ONLY display metadata for an ACTIVE,
    non-expired public link (name, page count, size, view permission) —
    never the owner identity.
  - Revoked links and deleted documents are filtered by the SQL itself
    (status == ACTIVE join ~is_deleted) → no row → ValueError.
  - An expired link (``expires_at`` in the past) raises ValueError even
    though the row still matches the SQL filters.
  - ``download_public_document`` loads the bytes through the standard
    storage path **with the OWNER identity** (required for at-rest
    decryption) and fails closed when the stored file is missing.

Strategy mirrors tests/unit/test_invitation_autoactivation.py: a scripted
``FakeSession`` is injected by monkeypatching ``get_db_session`` inside the
service module.
"""

from __future__ import annotations

import importlib
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest

from app.models.database import DocumentShare, StoredDocument

# NB: the package __init__ rebinds ``share_crud_service`` to the singleton —
# go through sys.modules to get the real module object (needed to
# monkeypatch get_db_session).
share_crud_module = importlib.import_module(
    "app.services.sharing.share_crud_service"
)
from app.services.sharing.constants import ShareStatus
from app.services.sharing.share_crud_service import ShareCrudService

OWNER_ID = "owner-pub-0000-0000-0000-000000000001"
DOC_ID = "770e8400-e29b-41d4-a716-446655440002"
TOKEN = "tok-public-unit-secret"


# ---------------------------------------------------------------------------
# Scripted fake AsyncSession
# ---------------------------------------------------------------------------


class FakeResult:
    def __init__(self, *, row=None):
        self._row = row

    def first(self):
        return self._row


class FakeSession:
    def __init__(self, results: list[FakeResult]):
        self._results = list(results)

    async def execute(self, stmt, *args, **kwargs):
        if not self._results:
            raise AssertionError(f"FakeSession: unexpected execute() for: {stmt}")
        return self._results.pop(0)

    async def commit(self):
        pass

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
            share_crud_module, "get_db_session", lambda: _CtxSession(session)
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
        name="Contrat 2026.pdf",
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


def _make_public_share(**overrides) -> DocumentShare:
    defaults = dict(
        id="share-pub-0000-0000-0000-000000000042",
        document_id=DOC_ID,
        shared_with_user_id=None,
        share_token=TOKEN,
        permission="view",
        status=ShareStatus.ACTIVE,
        created_by=OWNER_ID,
        expires_at=None,
    )
    defaults.update(overrides)
    return DocumentShare(**defaults)


# ---------------------------------------------------------------------------
# resolve_public_link
# ---------------------------------------------------------------------------


class TestResolvePublicLink:
    @pytest.mark.asyncio
    async def test_active_link_returns_display_metadata_only(self, use_session):
        use_session([FakeResult(row=(_make_public_share(), _make_doc()))])

        result = await ShareCrudService.resolve_public_link(token=TOKEN)

        assert result == {
            "document_name": "Contrat 2026.pdf",
            "page_count": 3,
            "file_size_bytes": 1024,
            "permission": "view",
        }
        # The anonymous payload must never expose the owner identity.
        assert OWNER_ID not in str(result)

    @pytest.mark.asyncio
    async def test_unknown_or_revoked_token_raises(self, use_session):
        """Revoked links never match the SQL (status filter) → no row."""
        use_session([FakeResult(row=None)])

        with pytest.raises(ValueError):
            await ShareCrudService.resolve_public_link(token=TOKEN)

    @pytest.mark.asyncio
    async def test_expired_link_raises(self, use_session):
        expired = _make_public_share(
            expires_at=datetime.now(UTC) - timedelta(days=1)
        )
        use_session([FakeResult(row=(expired, _make_doc()))])

        with pytest.raises(ValueError):
            await ShareCrudService.resolve_public_link(token=TOKEN)

    @pytest.mark.asyncio
    async def test_future_expiry_still_resolves(self, use_session):
        valid = _make_public_share(
            expires_at=datetime.now(UTC) + timedelta(days=7)
        )
        use_session([FakeResult(row=(valid, _make_doc()))])

        result = await ShareCrudService.resolve_public_link(token=TOKEN)

        assert result["document_name"] == "Contrat 2026.pdf"

    @pytest.mark.asyncio
    async def test_empty_token_raises_without_querying(self, use_session):
        session = use_session([])  # no execute() expected

        with pytest.raises(ValueError):
            await ShareCrudService.resolve_public_link(token="")

        assert session._results == []


# ---------------------------------------------------------------------------
# download_public_document
# ---------------------------------------------------------------------------


class TestDownloadPublicDocument:
    @pytest.mark.asyncio
    async def test_loads_bytes_with_owner_identity(self, use_session, monkeypatch):
        """Decryption AAD is bound to (document_id, owner_id) → the storage
        path MUST be invoked with the owner's user id, never the caller's."""
        session = use_session([FakeResult(row=(_make_public_share(), _make_doc()))])

        load = AsyncMock(return_value=b"%PDF-1.4 bytes")
        monkeypatch.setattr(
            "app.services.storage_service.storage_service.load_document_file",
            load,
        )

        data, name = await ShareCrudService.download_public_document(token=TOKEN)

        assert data == b"%PDF-1.4 bytes"
        assert name == "Contrat 2026.pdf"
        load.assert_awaited_once_with(session, DOC_ID, OWNER_ID)

    @pytest.mark.asyncio
    async def test_missing_stored_file_fails_closed(self, use_session, monkeypatch):
        use_session([FakeResult(row=(_make_public_share(), _make_doc()))])
        monkeypatch.setattr(
            "app.services.storage_service.storage_service.load_document_file",
            AsyncMock(return_value=None),
        )

        with pytest.raises(ValueError):
            await ShareCrudService.download_public_document(token=TOKEN)

    @pytest.mark.asyncio
    async def test_download_respects_expiry_guard(self, use_session, monkeypatch):
        expired = _make_public_share(
            expires_at=datetime.now(UTC) - timedelta(minutes=1)
        )
        use_session([FakeResult(row=(expired, _make_doc()))])

        load = AsyncMock()
        monkeypatch.setattr(
            "app.services.storage_service.storage_service.load_document_file",
            load,
        )

        with pytest.raises(ValueError):
            await ShareCrudService.download_public_document(token=TOKEN)

        load.assert_not_awaited()
