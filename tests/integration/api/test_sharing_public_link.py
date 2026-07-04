"""Integration tests: public link resolution endpoints (UNAUTHENTICATED).

Covers the two anonymous routes powering the /public/[token] viewer page:

  - ``GET /api/v1/sharing/public/{token}``           → display metadata
  - ``GET /api/v1/sharing/public/{token}/download``  → PDF bytes

Guards under test:
  - both routes work WITHOUT any Authorization header (capability = token);
  - unknown / revoked / expired tokens are a generic 404 (anti-enumeration,
    the service maps all causes to ValueError);
  - responses carry ``X-Robots-Tag: noindex`` + ``Cache-Control: no-store``;
  - the download serves ``Content-Disposition: inline`` by default and
    ``attachment`` with ``?dl=1`` (RFC 5987 filename for non-ASCII names);
  - the token NEVER leaks into application log records.
"""

from __future__ import annotations

import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

TOKEN = "tok-public-secret-abcdefghijklmnop"


def _application_log_text(caplog) -> str:
    """
    Concatenate the messages logged by APPLICATION loggers only.

    The TestClient's own ``httpx`` logger echoes the requested URL client-side
    ("HTTP Request: GET http://testserver/..."), which is a test artifact —
    the invariant under test is that OUR backend loggers (``app.*``) never
    log the capability token.
    """
    return "\n".join(
        record.getMessage()
        for record in caplog.records
        if record.name.startswith("app")
    )

PUBLIC_INFO_PAYLOAD = {
    "document_name": "Contrat 2026.pdf",
    "page_count": 3,
    "file_size_bytes": 1024,
    "permission": "view",
}

PDF_BYTES = b"%PDF-1.4 fake-public-pdf-bytes"


@pytest.fixture(autouse=True)
def no_rate_limit(monkeypatch):
    limiter = SimpleNamespace(is_allowed=AsyncMock(return_value=(True, 999, 60)))
    monkeypatch.setattr(
        "app.middleware.rate_limiter.get_rate_limiter",
        AsyncMock(return_value=limiter),
    )


class TestGetPublicLinkInfoEndpoint:
    """GET /api/v1/sharing/public/{token} — anonymous metadata resolution."""

    def test_valid_token_returns_document_info_without_auth(
        self, client, monkeypatch
    ):
        """A valid token resolves WITHOUT any Authorization header."""
        resolve = AsyncMock(return_value=dict(PUBLIC_INFO_PAYLOAD))
        monkeypatch.setattr(
            "app.api.v1.sharing.share_service.resolve_public_link", resolve
        )

        resp = client.get(f"/api/v1/sharing/public/{TOKEN}")

        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data == PUBLIC_INFO_PAYLOAD
        resolve.assert_awaited_once_with(token=TOKEN)

    def test_info_response_is_noindex_and_no_store(self, client, monkeypatch):
        monkeypatch.setattr(
            "app.api.v1.sharing.share_service.resolve_public_link",
            AsyncMock(return_value=dict(PUBLIC_INFO_PAYLOAD)),
        )

        resp = client.get(f"/api/v1/sharing/public/{TOKEN}")

        assert "noindex" in resp.headers.get("X-Robots-Tag", "")
        assert "no-store" in resp.headers.get("Cache-Control", "")

    @pytest.mark.parametrize(
        "cause",
        ["Public link not found", "Public link expired"],
        ids=["unknown-or-revoked", "expired"],
    )
    def test_invalid_token_is_generic_404(self, client, monkeypatch, cause):
        """Unknown/revoked/expired all collapse into the same generic 404."""
        monkeypatch.setattr(
            "app.api.v1.sharing.share_service.resolve_public_link",
            AsyncMock(side_effect=ValueError(cause)),
        )

        resp = client.get(f"/api/v1/sharing/public/{TOKEN}")

        assert resp.status_code == 404
        detail = resp.json()["detail"]
        assert detail == "Public link not found or expired"
        assert TOKEN not in detail

    def test_token_never_appears_in_logs(self, client, monkeypatch, caplog):
        monkeypatch.setattr(
            "app.api.v1.sharing.share_service.resolve_public_link",
            AsyncMock(side_effect=ValueError("Public link not found")),
        )

        with caplog.at_level(logging.DEBUG):
            client.get(f"/api/v1/sharing/public/{TOKEN}")

        assert TOKEN not in _application_log_text(caplog)


class TestDownloadPublicLinkEndpoint:
    """GET /api/v1/sharing/public/{token}/download — anonymous PDF stream."""

    def test_valid_token_streams_pdf_inline(self, client, monkeypatch):
        download = AsyncMock(return_value=(PDF_BYTES, "Contrat 2026.pdf"))
        monkeypatch.setattr(
            "app.api.v1.sharing.share_service.download_public_document", download
        )

        resp = client.get(f"/api/v1/sharing/public/{TOKEN}/download")

        assert resp.status_code == 200
        assert resp.content == PDF_BYTES
        assert resp.headers["Content-Type"] == "application/pdf"
        disposition = resp.headers["Content-Disposition"]
        assert disposition.startswith("inline;")
        assert 'filename="Contrat 2026.pdf"' in disposition
        assert "noindex" in resp.headers.get("X-Robots-Tag", "")
        assert "no-store" in resp.headers.get("Cache-Control", "")
        download.assert_awaited_once_with(token=TOKEN)

    def test_dl_flag_forces_attachment(self, client, monkeypatch):
        monkeypatch.setattr(
            "app.api.v1.sharing.share_service.download_public_document",
            AsyncMock(return_value=(PDF_BYTES, "Contrat.pdf")),
        )

        resp = client.get(f"/api/v1/sharing/public/{TOKEN}/download?dl=true")

        assert resp.status_code == 200
        assert resp.headers["Content-Disposition"].startswith("attachment;")

    def test_non_ascii_name_uses_rfc5987_with_ascii_fallback(
        self, client, monkeypatch
    ):
        monkeypatch.setattr(
            "app.api.v1.sharing.share_service.download_public_document",
            AsyncMock(return_value=(PDF_BYTES, 'Résumé "été".pdf')),
        )

        resp = client.get(f"/api/v1/sharing/public/{TOKEN}/download")

        disposition = resp.headers["Content-Disposition"]
        # Quotes stripped from the fallback (header-injection safety) and the
        # UTF-8 name carried via RFC 5987 filename*.
        assert 'filename="Rsum t.pdf"' in disposition
        assert "filename*=UTF-8''R%C3%A9sum%C3%A9%20%C3%A9t%C3%A9.pdf" in disposition

    @pytest.mark.parametrize(
        "cause",
        [
            "Public link not found",
            "Public link expired",
            "Document file unavailable",
        ],
        ids=["unknown-or-revoked", "expired", "file-missing"],
    )
    def test_download_respects_the_same_guards(self, client, monkeypatch, cause):
        monkeypatch.setattr(
            "app.api.v1.sharing.share_service.download_public_document",
            AsyncMock(side_effect=ValueError(cause)),
        )

        resp = client.get(f"/api/v1/sharing/public/{TOKEN}/download")

        assert resp.status_code == 404
        assert resp.json()["detail"] == "Public link not found or expired"

    def test_download_token_never_appears_in_logs(
        self, client, monkeypatch, caplog
    ):
        monkeypatch.setattr(
            "app.api.v1.sharing.share_service.download_public_document",
            AsyncMock(return_value=(PDF_BYTES, "Contrat.pdf")),
        )

        with caplog.at_level(logging.DEBUG):
            client.get(f"/api/v1/sharing/public/{TOKEN}/download")

        assert TOKEN not in _application_log_text(caplog)
