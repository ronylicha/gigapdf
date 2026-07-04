"""Integration tests: owner-or-shared RLS (403) on opening documents & folders,
plus keeping the original format + indexing content at import.

Routes under test:
  GET  /api/v1/storage/documents/{id}            → 403 for non-owner/non-shared
  GET  /api/v1/storage/documents/{id}/versions   → 403 for non-owner/non-shared
  POST /api/v1/storage/documents/{id}/versions   → owner OR edit grantee (403 otherwise)
  GET  /api/v1/storage/folders/{id}/stats        → 403 for non-owner/non-shared
  POST /api/v1/storage/documents (multipart)     → non-PDF stored as-is + indexed

Strategy mirrors test_storage_ged_endpoints.py: ``get_db`` and
``get_current_user`` are overridden, and a scripted ``FakeSession`` returns the
results each handler will consume, in execution order. The access guard issues
ONE extra ``execute`` (the share lookup) for a non-owner, which the scripts
account for.
"""

from __future__ import annotations

import io
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from app.core.database import get_db
from app.middleware.auth import CurrentUser, get_current_user
from app.models.database import DocumentShare, DocumentVersion, Folder, StoredDocument
from app.services.sharing.constants import ShareStatus

OWNER_ID = "owner-rls-0000-0000-0000-000000000001"
SHARED_ID = "shared-rls-0000-0000-0000-000000000002"
STRANGER_ID = "stranger-rls-0000-0000-0000-000000000003"
DOC_ID = "770e8400-e29b-41d4-a716-446655440002"
FOLDER_ID = "660e8400-e29b-41d4-a716-446655440001"


# ---------------------------------------------------------------------------
# Scripted fake AsyncSession (subset used by the read handlers)
# ---------------------------------------------------------------------------

class FakeResult:
    def __init__(self, *, scalar=None, scalars_list=None, rows=None, first=None):
        self._scalar = scalar
        self._scalars_list = scalars_list if scalars_list is not None else []
        self._rows = rows if rows is not None else []
        self._first = first

    def scalar_one_or_none(self):
        return self._scalar

    def scalar(self):
        return self._scalar

    def scalars(self):
        items = list(self._scalars_list)
        return SimpleNamespace(all=lambda: items)

    def all(self):
        return list(self._rows)

    def one(self):
        return self._rows[0]

    def first(self):
        return self._first


class FakeSession:
    """Scripted AsyncSession stand-in.

    ``stamp_timestamps=True`` mimics the server-side ``func.now()`` defaults
    applied on commit (``created_at`` / ``updated_at``) so handlers that
    serialize a freshly-built row (e.g. the upload response) don't hit a
    ``None.isoformat()`` — the real DB would have populated those columns.
    """

    def __init__(
        self,
        results: list[FakeResult] | None = None,
        *,
        stamp_timestamps: bool = False,
    ):
        self._results = list(results or [])
        self.added: list = []
        self.deleted: list = []
        self.commit_count = 0
        self._stamp = stamp_timestamps

    async def execute(self, stmt, *args, **kwargs):
        # DELETE statements (store_ocr_blocks clears the previous semantic index
        # on every reindex, including an empty-text purge) don't consume a
        # scripted result — return an empty one so callers don't have to script
        # the index-clearing step.
        if str(stmt).lstrip().lower().startswith("delete"):
            self.deleted.append(stmt)
            return FakeResult()
        if not self._results:
            raise AssertionError(f"FakeSession: unexpected execute() for: {stmt}")
        return self._results.pop(0)

    def add(self, obj):
        if self._stamp:
            now = datetime.now(UTC)
            if getattr(obj, "created_at", None) is None:
                obj.created_at = now
            if hasattr(obj, "updated_at") and getattr(obj, "updated_at", None) is None:
                obj.updated_at = now
        self.added.append(obj)

    async def delete(self, obj):
        self.deleted.append(obj)

    async def commit(self):
        self.commit_count += 1

    async def rollback(self):
        pass

    async def close(self):
        pass


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
        current_version=2,
        file_size_bytes=1024,
        mime_type="application/pdf",
        original_format="pdf",
        tags=["legal"],
        thumbnail_path=None,
        is_deleted=False,
        deleted_at=None,
        created_at=now,
        updated_at=now,
    )
    defaults.update(overrides)
    doc = StoredDocument(**{k: v for k, v in defaults.items() if k != "extracted_text"})
    doc.extracted_text = overrides.get("extracted_text")
    return doc


def _make_share(**overrides) -> DocumentShare:
    defaults = dict(
        id="share-rls-1",
        document_id=DOC_ID,
        shared_with_user_id=SHARED_ID,
        permission="view",
        status=ShareStatus.ACTIVE,
        expires_at=None,
        created_by=OWNER_ID,
    )
    defaults.update(overrides)
    return DocumentShare(**defaults)


def _make_folder(**overrides) -> Folder:
    now = datetime.now(UTC)
    defaults = dict(
        id=FOLDER_ID,
        name="Dossier",
        owner_id=OWNER_ID,
        parent_id=None,
        path="/",
        created_at=now,
        updated_at=now,
    )
    defaults.update(overrides)
    return Folder(**defaults)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def fake_db(app):
    session = FakeSession()

    async def _override():
        yield session

    app.dependency_overrides[get_db] = _override
    yield session
    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(get_current_user, None)


def _as_user(app, user_id: str) -> None:
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        user_id=user_id, email=f"{user_id}@example.com"
    )


@pytest.fixture(autouse=True)
def no_rate_limit(monkeypatch):
    limiter = SimpleNamespace(is_allowed=AsyncMock(return_value=(True, 999, 60)))
    monkeypatch.setattr(
        "app.middleware.rate_limiter.get_rate_limiter",
        AsyncMock(return_value=limiter),
    )


# ---------------------------------------------------------------------------
# GET /documents/{id} — owner-or-shared, 403 otherwise
# ---------------------------------------------------------------------------

class TestGetStoredDocumentRLS:
    def test_owner_can_open(self, client: TestClient, app, fake_db):
        _as_user(app, OWNER_ID)
        fake_db._results = [FakeResult(scalar=_make_doc())]  # only the doc lookup

        resp = client.get(f"/api/v1/storage/documents/{DOC_ID}")

        assert resp.status_code == 200
        assert resp.json()["data"]["stored_document_id"] == DOC_ID

    def test_shared_user_can_open(self, client, app, fake_db):
        _as_user(app, SHARED_ID)
        fake_db._results = [
            FakeResult(scalar=_make_doc()),     # doc lookup
            FakeResult(scalar=_make_share()),   # guard: active share found
        ]

        resp = client.get(f"/api/v1/storage/documents/{DOC_ID}")

        assert resp.status_code == 200
        assert resp.json()["data"]["original_format"] == "pdf"

    def test_stranger_gets_403_not_404(self, client, app, fake_db):
        _as_user(app, STRANGER_ID)
        fake_db._results = [
            FakeResult(scalar=_make_doc()),  # doc exists…
            FakeResult(scalar=None),         # …but no share for the stranger
        ]

        resp = client.get(f"/api/v1/storage/documents/{DOC_ID}")

        assert resp.status_code == 403

    def test_truly_missing_document_is_404(self, client, app, fake_db):
        _as_user(app, OWNER_ID)
        fake_db._results = [FakeResult(scalar=None)]

        resp = client.get(f"/api/v1/storage/documents/{DOC_ID}")

        assert resp.status_code == 404

    def test_expired_share_is_403(self, client, app, fake_db):
        _as_user(app, SHARED_ID)
        expired = _make_share(expires_at=datetime.now(UTC) - timedelta(days=1))
        fake_db._results = [
            FakeResult(scalar=_make_doc()),
            FakeResult(scalar=expired),
        ]

        resp = client.get(f"/api/v1/storage/documents/{DOC_ID}")

        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# GET /documents/{id}/versions — owner-or-shared, 403 otherwise
# ---------------------------------------------------------------------------

class TestListVersionsRLS:
    def test_shared_user_can_list_versions(self, client, app, fake_db):
        _as_user(app, SHARED_ID)
        fake_db._results = [
            FakeResult(scalar=_make_doc()),     # doc lookup
            FakeResult(scalar=_make_share()),   # guard: active share
            FakeResult(scalars_list=[
                DocumentVersion(
                    document_id=DOC_ID, version_number=1,
                    file_path=f"documents/{OWNER_ID}/{DOC_ID}/v1.pdf",
                    file_size_bytes=1024, file_hash="a" * 64, created_by=OWNER_ID,
                    created_at=datetime.now(UTC),
                ),
            ]),
        ]

        resp = client.get(f"/api/v1/storage/documents/{DOC_ID}/versions")

        assert resp.status_code == 200
        assert resp.json()["data"]["current_version"] == 2

    def test_stranger_gets_403(self, client, app, fake_db):
        _as_user(app, STRANGER_ID)
        fake_db._results = [
            FakeResult(scalar=_make_doc()),
            FakeResult(scalar=None),
        ]

        resp = client.get(f"/api/v1/storage/documents/{DOC_ID}/versions")

        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# GET /folders/{id}/stats — owner-or-shared, 403 otherwise
# ---------------------------------------------------------------------------

class TestFolderStatsRLS:
    def test_owner_can_open_folder_stats(self, client, app, fake_db):
        _as_user(app, OWNER_ID)
        fake_db._results = [
            FakeResult(scalar=_make_folder()),   # folder lookup (guard: owner → no share query)
            FakeResult(rows=[]),                  # descendants
            FakeResult(rows=[(0, 0)]),            # doc stats (count, size)
        ]

        resp = client.get(f"/api/v1/storage/folders/{FOLDER_ID}/stats")

        assert resp.status_code == 200
        assert resp.json()["data"]["folder_id"] == FOLDER_ID

    def test_shared_user_can_open_folder_stats(self, client, app, fake_db):
        _as_user(app, SHARED_ID)
        fake_db._results = [
            FakeResult(scalar=_make_folder()),   # folder lookup
            FakeResult(first=("share-1",)),      # guard: shared doc inside subtree
            FakeResult(rows=[]),                  # descendants
            FakeResult(rows=[(2, 4096)]),         # doc stats over folder owner
        ]

        resp = client.get(f"/api/v1/storage/folders/{FOLDER_ID}/stats")

        assert resp.status_code == 200
        assert resp.json()["data"]["document_count"] == 2

    def test_stranger_gets_403(self, client, app, fake_db):
        _as_user(app, STRANGER_ID)
        fake_db._results = [
            FakeResult(scalar=_make_folder()),   # folder exists…
            FakeResult(first=None),              # …no shared doc inside → forbidden
        ]

        resp = client.get(f"/api/v1/storage/folders/{FOLDER_ID}/stats")

        assert resp.status_code == 403

    def test_missing_folder_is_404(self, client, app, fake_db):
        _as_user(app, OWNER_ID)
        fake_db._results = [FakeResult(scalar=None)]

        resp = client.get(f"/api/v1/storage/folders/{FOLDER_ID}/stats")

        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# POST /documents/{id}/versions — owner OR edit grantee saves, 403 otherwise
# ---------------------------------------------------------------------------

class _CtxSession:
    """Wrap a FakeSession in the async-context shape of get_db_session()."""

    def __init__(self, sess: FakeSession):
        self._sess = sess

    async def __aenter__(self):
        return self._sess

    async def __aexit__(self, *a):
        return False


class TestCreateVersionRLS:
    """The editor save path (create_version) honours the shared-edit grant.

    The version must land under the OWNER's S3 prefix (symmetric with the
    load endpoint) and ``created_by`` must record the actual author.
    """

    PDF_BYTES = b"%PDF-1.4\n" + b"%fake body\n" * 8

    @pytest.fixture
    def harness(self, app, monkeypatch):
        """Patch get_db_session / page counting / S3 for the versions route."""
        from app.api.v1 import storage as storage_module

        session = FakeSession(stamp_timestamps=True)
        monkeypatch.setattr(
            storage_module, "get_db_session", lambda: _CtxSession(session)
        )
        monkeypatch.setattr(storage_module, "_count_pdf_pages_sync", lambda b: 1)

        upload_file = MagicMock(return_value={"key": "x"})
        monkeypatch.setattr(storage_module.s3_service, "upload_file", upload_file)

        yield SimpleNamespace(session=session, upload_file=upload_file)
        app.dependency_overrides.pop(get_current_user, None)

    def _post_version(self, client):
        return client.post(
            f"/api/v1/storage/documents/{DOC_ID}/versions",
            files={"file": ("doc.pdf", io.BytesIO(self.PDF_BYTES), "application/pdf")},
            data={"comment": "edited in browser"},
        )

    def test_owner_can_save_version(self, client, app, harness):
        _as_user(app, OWNER_ID)
        harness.session._results = [
            FakeResult(scalar=_make_doc()),  # doc lookup (guard: owner → no share query)
        ]

        resp = self._post_version(client)

        assert resp.status_code == 200, resp.text
        assert resp.json()["data"]["version"] == 3
        kwargs = harness.upload_file.call_args.kwargs
        assert kwargs["key"] == f"documents/{OWNER_ID}/{DOC_ID}/v3.pdf"

    def test_edit_grantee_can_save_under_owner_prefix(self, client, app, harness):
        _as_user(app, SHARED_ID)
        harness.session._results = [
            FakeResult(scalar=_make_doc()),                      # doc lookup
            FakeResult(scalar=_make_share(permission="edit")),   # guard: edit grant
        ]

        resp = self._post_version(client)

        assert resp.status_code == 200, resp.text
        assert resp.json()["data"]["version"] == 3

        # Version file lands under the OWNER's prefix, never the grantee's.
        kwargs = harness.upload_file.call_args.kwargs
        assert kwargs["key"] == f"documents/{OWNER_ID}/{DOC_ID}/v3.pdf"
        assert kwargs["metadata"]["user_id"] == OWNER_ID
        assert kwargs["metadata"]["author_id"] == SHARED_ID

        # The version row records the actual author (the invited editor).
        version = next(
            o for o in harness.session.added if isinstance(o, DocumentVersion)
        )
        assert version.created_by == SHARED_ID
        assert version.version_number == 3

    def test_view_grantee_gets_403(self, client, app, harness):
        _as_user(app, SHARED_ID)
        harness.session._results = [
            FakeResult(scalar=_make_doc()),
            FakeResult(scalar=_make_share(permission="view")),  # view-only grant
        ]

        resp = self._post_version(client)

        assert resp.status_code == 403
        harness.upload_file.assert_not_called()

    def test_stranger_gets_403(self, client, app, harness):
        _as_user(app, STRANGER_ID)
        harness.session._results = [
            FakeResult(scalar=_make_doc()),  # doc exists…
            FakeResult(scalar=None),         # …but no share for the stranger
        ]

        resp = self._post_version(client)

        assert resp.status_code == 403
        harness.upload_file.assert_not_called()

    def test_missing_document_is_404(self, client, app, harness):
        _as_user(app, OWNER_ID)
        harness.session._results = [FakeResult(scalar=None)]

        resp = self._post_version(client)

        assert resp.status_code == 404
        harness.upload_file.assert_not_called()


# ---------------------------------------------------------------------------
# POST /documents — keep original (non-PDF) format + index content
# ---------------------------------------------------------------------------

class TestUploadKeepsOriginalFormat:
    @pytest.fixture
    def services(self, monkeypatch):
        from app.api.v1 import storage as storage_module

        limits = SimpleNamespace(
            storage_used_bytes=0,
            storage_limit_bytes=5 * 1024 * 1024 * 1024,
            document_count=0,
            document_limit=1000,
            is_tenant_based=False,
            tenant_id=None,
        )
        mocks = SimpleNamespace(
            get_effective_limits=AsyncMock(return_value=limits),
            update_storage_usage=AsyncMock(),
            upload_file=MagicMock(return_value={"key": "x"}),
            delete_file=MagicMock(return_value=True),
            log_activity=AsyncMock(return_value="activity-id"),
            extract_text=MagicMock(return_value=""),
        )
        qs = storage_module.quota_service
        monkeypatch.setattr(qs, "get_effective_limits", mocks.get_effective_limits)
        monkeypatch.setattr(qs, "update_storage_usage", mocks.update_storage_usage)
        s3 = storage_module.s3_service
        monkeypatch.setattr(s3, "upload_file", mocks.upload_file)
        monkeypatch.setattr(s3, "delete_file", mocks.delete_file)
        # index_document_content runs in its own get_db_session(); make the
        # extraction a no-op so the test does not need a real DB session there.
        monkeypatch.setattr(
            storage_module.content_extraction_service, "extract_text",
            mocks.extract_text,
        )
        return mocks

    def test_png_upload_is_stored_as_image_not_pdf(self, client, app, services, monkeypatch):
        """A PNG import keeps its format: image mime, .png S3 key, no pikepdf."""
        from app.api.v1 import storage as storage_module

        _as_user(app, OWNER_ID)

        captured = {}

        # The upload path uses get_db_session() (not the get_db dependency).
        # Patch it to a context manager yielding a FakeSession we can inspect.
        commit_session = FakeSession([
            FakeResult(scalar=_make_doc()),  # index_document_content doc lookup
        ])

        class _CtxSession:
            def __init__(self, sess):
                self._sess = sess

            async def __aenter__(self):
                return self._sess

            async def __aexit__(self, *a):
                return False

        sessions = [
            _CtxSession(FakeSession(stamp_timestamps=True)),
            _CtxSession(commit_session),
        ]

        def _get_db_session():
            return sessions.pop(0)

        monkeypatch.setattr(storage_module, "get_db_session", _get_db_session)

        png_bytes = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
        resp = client.post(
            "/api/v1/storage/documents",
            files={"file": ("scan.png", io.BytesIO(png_bytes), "image/png")},
            data={"name": "Scanned page"},
        )

        assert resp.status_code == 201, resp.text
        data = resp.json()["data"]
        assert data["original_format"] == "png"
        assert data["mime_type"] == "image/png"
        assert data["page_count"] == 0  # no PDF page concept

        # Uploaded verbatim with the image content-type, under a .png key.
        services.upload_file.assert_called_once()
        kwargs = services.upload_file.call_args.kwargs
        assert kwargs["content_type"] == "image/png"
        assert kwargs["key"].endswith(".png")
        assert kwargs["file_data"] == png_bytes

    def test_pdf_upload_path_unchanged(self, client, app, services, monkeypatch):
        """A PDF import is still stored as PDF under the historical .pdf key."""
        from app.api.v1 import storage as storage_module

        _as_user(app, OWNER_ID)

        # page counting offloaded to a thread → stub it deterministically.
        monkeypatch.setattr(storage_module, "_count_pdf_pages_sync", lambda b: 1)

        class _CtxSession:
            def __init__(self, sess):
                self._sess = sess

            async def __aenter__(self):
                return self._sess

            async def __aexit__(self, *a):
                return False

        commit_session = FakeSession([FakeResult(scalar=_make_doc())])
        sessions = [
            _CtxSession(FakeSession(stamp_timestamps=True)),
            _CtxSession(commit_session),
        ]
        monkeypatch.setattr(
            storage_module, "get_db_session", lambda: sessions.pop(0)
        )

        pdf_bytes = b"%PDF-1.4\n" + b"%fake body\n" * 8
        resp = client.post(
            "/api/v1/storage/documents",
            files={"file": ("doc.pdf", io.BytesIO(pdf_bytes), "application/pdf")},
            data={"name": "A PDF"},
        )

        assert resp.status_code == 201, resp.text
        data = resp.json()["data"]
        assert data["original_format"] == "pdf"
        assert data["page_count"] == 1
        kwargs = services.upload_file.call_args.kwargs
        assert kwargs["content_type"] == "application/pdf"
        assert kwargs["key"].endswith("/v1.pdf")
