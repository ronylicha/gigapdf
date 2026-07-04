"""
Persistent storage endpoints.

Handles saving, loading, versioning, and organizing documents in persistent storage.
"""

import asyncio
import hashlib
import io
import json
import logging
import time
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import cast, delete, func, literal_column, or_, select, true
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import array as pg_array
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import undefer

from app.core.database import get_db, get_db_session
from app.middleware.auth import AuthenticatedUser
from app.middleware.error_handler import (
    InvalidOperationError,
    NotFoundError,
)
from app.middleware.rate_limiter import RateLimitDep
from app.middleware.request_id import get_request_id
from app.models.database import (
    DocumentLayers,
    DocumentVersion,
    Folder,
    OcrBlock,
    StoredDocument,
)
from app.schemas.responses.common import APIResponse, MetaInfo, PaginationInfo
from app.services import content_extraction_service
from app.services.activity_service import ActivityAction, activity_service
from app.services.document_service import document_service
from app.services.embeddings import embedding_service
from app.services.quota_service import quota_service
from app.services.s3_service import s3_service
from app.services.sharing.access_guard import (
    authorize_document_access,
    authorize_folder_access,
)
from app.services.text_chunking import chunk_text_for_embedding
from app.utils.helpers import generate_uuid, now_utc

_logger = logging.getLogger(__name__)

router = APIRouter()


def _count_pdf_pages_sync(pdf_bytes: bytes) -> int:
    """Count PDF pages synchronously via pikepdf (CPU-bound).

    Extracted as a module-level function so it can be safely offloaded
    to a thread pool with asyncio.to_thread() from async handlers,
    preventing the event loop from blocking during PDF parsing.
    """
    import pikepdf  # lazy import — only needed for page counting

    with pikepdf.open(io.BytesIO(pdf_bytes)) as pdf:
        return len(pdf.pages)


# ── GED constants ───────────────────────────────────────────────────────
_MAX_TAGS = 20
_MAX_TAG_LENGTH = 50
_MAX_EXTRACTED_TEXT_CHARS = 500_000
_MAX_DOCUMENT_NAME_LENGTH = 255

_THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024  # 2 MB
_THUMBNAIL_URL_EXPIRES_SECONDS = 7 * 24 * 3600  # 7 days (SigV4 maximum)

# OCR-blocks ingestion limits (semantic search, #85).
_MAX_OCR_BLOCKS = 5000  # per ingest request (guards memory + embedding cost)
_MAX_OCR_BLOCK_TEXT_CHARS = 4000  # per block (e5 truncates long inputs anyway)
_EMBED_BATCH_SIZE = 128  # texts per fastembed batch

# PostgreSQL text-search configuration: 'simple' (no stemming) because the
# stored content is multilingual.
_TSQUERY_CONFIG = literal_column("'simple'")


def _normalize_tags(raw_tags: list[str]) -> list[str]:
    """Normalize a tag list: trim + lowercase, drop empties, dedupe (keep order).

    Raises:
        ValueError: if more than _MAX_TAGS tags remain after normalization,
            or if a tag exceeds _MAX_TAG_LENGTH characters.
    """
    normalized: list[str] = []
    seen: set[str] = set()
    for tag in raw_tags:
        if not isinstance(tag, str):
            raise ValueError("Tags must be strings")
        cleaned = tag.strip().lower()
        if not cleaned:
            continue
        if len(cleaned) > _MAX_TAG_LENGTH:
            raise ValueError(
                f"Tag too long: '{cleaned[:_MAX_TAG_LENGTH]}…' "
                f"(max {_MAX_TAG_LENGTH} characters)"
            )
        if cleaned not in seen:
            seen.add(cleaned)
            normalized.append(cleaned)
    if len(normalized) > _MAX_TAGS:
        raise ValueError(f"Too many tags: {len(normalized)} (max {_MAX_TAGS})")
    return normalized


def _detect_thumbnail_format(data: bytes) -> tuple[str, str] | None:
    """Detect thumbnail image format from magic bytes.

    Returns:
        (extension, content_type) for PNG / JPEG / WebP, or None if the
        bytes do not match any allowed format.
    """
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ("png", "image/png")
    if data.startswith(b"\xff\xd8\xff"):
        return ("jpg", "image/jpeg")
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ("webp", "image/webp")
    return None


# ── Import format handling ──────────────────────────────────────────────
# Documents may now be imported in their original format (kept as-is on S3,
# with export-on-demand). PDF stays the default and its storage path is
# unchanged (back-compatible). Magic-byte signatures recognise common
# document/image formats so we can record a precise mime_type even when the
# client does not send a reliable Content-Type.
_FORMAT_SIGNATURES: tuple[tuple[bytes, str, str], ...] = (
    (b"%PDF-", "pdf", "application/pdf"),
    (b"\x89PNG\r\n\x1a\n", "png", "image/png"),
    (b"\xff\xd8\xff", "jpg", "image/jpeg"),
    (b"GIF87a", "gif", "image/gif"),
    (b"GIF89a", "gif", "image/gif"),
    (b"%!PS", "ps", "application/postscript"),
    (b"{\\rtf", "rtf", "application/rtf"),
)

# ZIP-container Office formats (docx/xlsx/pptx/odt/…) all start with "PK\x03\x04";
# OLE2 legacy Office (doc/xls/ppt) with the compound-document magic. We can't
# distinguish them from magic bytes alone, so we fall back to the extension /
# declared content type for those — magic only confirms the family.
_ZIP_MAGIC = b"PK\x03\x04"
_OLE2_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"

# Extension → (canonical format token, mime type). Used when magic bytes are
# ambiguous (ZIP/OLE2 containers) or absent.
_EXTENSION_MIME: dict[str, tuple[str, str]] = {
    "pdf": ("pdf", "application/pdf"),
    "png": ("png", "image/png"),
    "jpg": ("jpg", "image/jpeg"),
    "jpeg": ("jpg", "image/jpeg"),
    "gif": ("gif", "image/gif"),
    "webp": ("webp", "image/webp"),
    "tif": ("tiff", "image/tiff"),
    "tiff": ("tiff", "image/tiff"),
    "bmp": ("bmp", "image/bmp"),
    "txt": ("txt", "text/plain"),
    "rtf": ("rtf", "application/rtf"),
    "csv": ("csv", "text/csv"),
    "doc": ("doc", "application/msword"),
    "docx": (
        "docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ),
    "xls": ("xls", "application/vnd.ms-excel"),
    "xlsx": (
        "xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ),
    "ppt": ("ppt", "application/vnd.ms-powerpoint"),
    "pptx": (
        "pptx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ),
    "odt": ("odt", "application/vnd.oasis.opendocument.text"),
    "ods": ("ods", "application/vnd.oasis.opendocument.spreadsheet"),
    "odp": ("odp", "application/vnd.oasis.opendocument.presentation"),
}


def _detect_upload_format(
    data: bytes, filename: str | None, content_type: str | None
) -> tuple[str, str]:
    """Resolve an imported file's ``(original_format, mime_type)``.

    Magic bytes win when unambiguous (PDF, PNG, JPEG, GIF…). For ZIP/OLE2
    container formats (Office) the magic only confirms the family, so the
    filename extension (then the declared content type) disambiguates. Falls
    back to ``("bin", content_type or "application/octet-stream")`` when
    nothing matches — the file is still stored verbatim.
    """
    for signature, fmt, mime in _FORMAT_SIGNATURES:
        if data.startswith(signature):
            return fmt, mime

    extension = ""
    if filename and "." in filename:
        extension = filename.rsplit(".", 1)[-1].strip().lower()

    if data.startswith(_ZIP_MAGIC) or data.startswith(_OLE2_MAGIC):
        if extension in _EXTENSION_MIME:
            return _EXTENSION_MIME[extension]
        # Known container but unknown member: keep a generic-but-honest type.
        if data.startswith(_ZIP_MAGIC):
            return "zip", "application/zip"
        return "bin", "application/x-ole-storage"

    if extension in _EXTENSION_MIME:
        return _EXTENSION_MIME[extension]

    return "bin", (content_type or "application/octet-stream")


def _original_document_key(
    user_id: str, document_id: str, version: int, original_format: str
) -> str:
    """S3 key for a stored document version, preserving the original format.

    PDFs keep the historical ``…/v{n}.pdf`` key (identical to
    :meth:`s3_service.get_document_key`) so nothing about existing documents
    changes. Other formats use the same prefix with their own extension.
    """
    if original_format in ("", "pdf"):
        return s3_service.get_document_key(user_id, document_id, version)
    return f"documents/{user_id}/{document_id}/v{version}.{original_format}"


def _next_copy_name(base_name: str, existing_names: set[str]) -> str:
    """Compute the duplicate name: "{name} (copie)", then "(copie 2)", "(copie 3)"…

    The result is guaranteed to fit in _MAX_DOCUMENT_NAME_LENGTH characters
    (the base name is truncated if needed) and to be absent from
    ``existing_names``.
    """
    counter = 1
    while True:
        suffix = " (copie)" if counter == 1 else f" (copie {counter})"
        max_base = _MAX_DOCUMENT_NAME_LENGTH - len(suffix)
        candidate = f"{base_name[:max_base]}{suffix}"
        if candidate not in existing_names:
            return candidate
        counter += 1


def _thumbnail_url_for(thumbnail_path: str | None) -> str | None:
    """Build a presigned GET URL for a thumbnail S3 key.

    Convention: ``stored_documents.thumbnail_path`` stores the raw S3 key
    (``thumbnails/{user_id}/{document_id}.{ext}``); serializers expose a
    presigned URL (7 days — SigV4 maximum) under the ``thumbnail_url`` field.
    Returns None when no thumbnail is set or signing fails.
    """
    if not thumbnail_path:
        return None
    try:
        return s3_service.get_presigned_url(
            thumbnail_path, expires_in=_THUMBNAIL_URL_EXPIRES_SECONDS
        )
    except Exception:  # pragma: no cover — missing S3 credentials, etc.
        _logger.warning("Failed to presign thumbnail URL for %s", thumbnail_path)
        return None


def _serialize_stored_document(doc: StoredDocument) -> dict:
    """Serialize a StoredDocument row to the public list-item shape."""
    return {
        "stored_document_id": doc.id,
        "name": doc.name,
        "page_count": doc.page_count,
        "version": doc.current_version,
        "folder_id": doc.folder_id,
        "tags": doc.tags or [],
        "file_size_bytes": doc.file_size_bytes or 0,
        "mime_type": doc.mime_type or "application/pdf",
        "original_format": doc.original_format or "pdf",
        "created_at": doc.created_at.isoformat(),
        "modified_at": doc.updated_at.isoformat(),
        "thumbnail_url": _thumbnail_url_for(doc.thumbnail_path),
        "deleted_at": doc.deleted_at.isoformat() if doc.deleted_at else None,
    }


async def store_ocr_blocks(
    session: AsyncSession,
    document_id: str,
    blocks: list[dict],
) -> int:
    """Embed and (re-)index a document's OCR blocks for semantic search (#85).

    Idempotent **replace**: all existing ``ocr_blocks`` rows for
    ``document_id`` are deleted first, then the new ``blocks`` are inserted —
    so re-running on a modified document yields a clean, current index (no
    duplicates, no stale blocks).

    Each block is a dict ``{page, bbox, text}`` where ``bbox`` is
    ``{x, y, w, h}`` in PDF user-space points (missing/partial bbox → 0).
    Embeddings are computed in batches via :data:`embedding_service`; if the
    model is unavailable the blocks are still stored (with ``embedding=NULL``)
    so the call never fails — they are simply not semantically searchable
    until a later re-index.

    The caller owns the transaction (this does **not** commit). Returns the
    number of blocks indexed.
    """
    # 1. Clear the previous index for this document (idempotent re-index).
    await session.execute(
        delete(OcrBlock).where(OcrBlock.document_id == document_id)
    )

    # 2. Normalize incoming blocks: keep only those with non-empty text.
    normalized: list[dict] = []
    for block in blocks:
        # Strip NUL (0x00): PostgreSQL text columns reject it (PDF/OCR layers
        # occasionally emit it). Applies to every caller, incl. /ocr-blocks.
        text = (block.get("text") or "").replace("\x00", "").strip()
        if not text:
            continue
        bbox = block.get("bbox") or {}
        try:
            page = int(block.get("page", 0))
        except (TypeError, ValueError):
            page = 0
        normalized.append(
            {
                "page": page,
                "bbox_x": float(bbox.get("x", 0) or 0),
                "bbox_y": float(bbox.get("y", 0) or 0),
                "bbox_w": float(bbox.get("w", 0) or 0),
                "bbox_h": float(bbox.get("h", 0) or 0),
                "text": text[:_MAX_OCR_BLOCK_TEXT_CHARS],
            }
        )

    if not normalized:
        return 0

    # 3. Embed in batches (passage prefix). Embedding runs on a thread to keep
    #    the event loop responsive (fastembed is CPU-bound + synchronous).
    embeddings: list[list[float] | None] = []
    for start in range(0, len(normalized), _EMBED_BATCH_SIZE):
        chunk = normalized[start : start + _EMBED_BATCH_SIZE]
        chunk_vectors = await asyncio.to_thread(
            embedding_service.embed_passages, [b["text"] for b in chunk]
        )
        embeddings.extend(chunk_vectors)

    # 4. Insert the new rows.
    for block, embedding in zip(normalized, embeddings, strict=True):
        session.add(
            OcrBlock(
                document_id=document_id,
                page=block["page"],
                bbox_x=block["bbox_x"],
                bbox_y=block["bbox_y"],
                bbox_w=block["bbox_w"],
                bbox_h=block["bbox_h"],
                text=block["text"],
                embedding=embedding,
            )
        )

    return len(normalized)


async def index_document_content(
    session: AsyncSession,
    document_id: str,
    data: bytes,
    mime_type: str | None,
) -> str:
    """Extract + index a document's text at import time (best-effort).

    Pulls searchable text from the uploaded bytes according to *mime_type*
    (PDF text layer / image OCR — see :mod:`content_extraction_service`),
    persists it on ``StoredDocument.extracted_text`` (feeds the full-text
    ``search_vector``) and, when any text is found, (re-)indexes it as a single
    OCR block with an embedding so the **semantic** search also covers the
    import.

    The caller owns the transaction (this does **not** commit). Never raises:
    a failure here must not fail the import — it just means the document is not
    (yet) searchable. Returns the extracted text (possibly empty).

    Note: server-side extraction is now a stub for every format (the client's
    WASM engine ships the text via ``extracted_text`` on upload — see
    :mod:`content_extraction_service`). This path therefore indexes ``""`` for
    most imports, which simply purges any stale index for the document. It is
    kept so the dispatch shape stays stable and a future server-side extractor
    can re-enable it with zero call-site changes.
    """
    try:
        text = await asyncio.to_thread(
            content_extraction_service.extract_text, data, mime_type
        )
    except Exception:  # noqa: BLE001 — extraction must never break the import
        _logger.warning(
            "index_document_content: extraction failed (doc=%s)",
            document_id,
            exc_info=True,
        )
        text = ""

    text = (text or "").strip()[:_MAX_EXTRACTED_TEXT_CHARS]

    # Single point of truth: persist the full-text material AND (re)build the
    # semantic index from the same text (chunked). Best-effort inside.
    await reindex_document_text(session, document_id, text)
    return text


async def reindex_document_text(
    session: AsyncSession,
    document_id: str,
    text: str | None,
) -> int:
    """(Re)build a document's full-text + semantic index from its plain text.

    This is **the** single entry point that turns a document's extracted text
    into both search indexes, used by every path that creates or mutates a
    document (upload, new version, metadata update, duplicate):

    - sets ``StoredDocument.extracted_text`` (truncated) → feeds the generated
      ``search_vector`` (keyword/full-text search);
    - chunks the text (:func:`chunk_text_for_embedding`) and (re-)indexes the
      chunks as ``ocr_blocks`` via :func:`store_ocr_blocks` (a **replace**, so
      re-running yields a clean current index — no duplicates, no stale rows).

    Empty/whitespace text still calls :func:`store_ocr_blocks` with an **empty**
    list so any previous semantic index is **purged** (a document whose text was
    cleared must not keep stale vectors). The chunks carry ``page=0`` and an
    empty ``bbox`` because the client sends concatenated document text without
    per-block geometry; true positioned OCR blocks (image OCR) keep their bbox
    through the dedicated ``/ocr-blocks`` endpoint.

    The caller **owns the transaction** (this does not commit). Best-effort:
    the whole body is guarded so indexing never fails an upload / version /
    update / duplicate. Returns the number of semantic blocks indexed (0 on any
    failure or empty text).
    """
    try:
        # PostgreSQL text columns reject NUL (0x00); PDF text layers sometimes
        # carry them. Strip before storing extracted_text / chunks.
        normalized = (text or "").replace("\x00", "").strip()[:_MAX_EXTRACTED_TEXT_CHARS]

        # Persist the full-text material on the document row (loaded in this
        # session so the attribute change is part of the caller's transaction).
        doc = (
            await session.execute(
                select(StoredDocument).where(StoredDocument.id == document_id)
            )
        ).scalar_one_or_none()
        if doc is not None:
            doc.extracted_text = normalized or None

        # Build the semantic index: one block per chunk. Empty text → empty
        # list → store_ocr_blocks purges the previous index (REPLACE).
        blocks = (
            [
                {"page": 0, "bbox": {}, "text": chunk}
                for chunk in chunk_text_for_embedding(normalized)
            ]
            if normalized
            else []
        )
        return await store_ocr_blocks(session, document_id, blocks)
    except Exception:  # noqa: BLE001 — indexing must never break the caller
        _logger.warning(
            "reindex_document_text: indexing failed (doc=%s)",
            document_id,
            exc_info=True,
        )
        return 0


async def reindex_document_blocks(
    session: AsyncSession,
    document_id: str,
    blocks: list[dict],
) -> int:
    """(Re)build a document's index from POSITIONED blocks (text + page + bbox).

    The positioned-geometry counterpart of :func:`reindex_document_text`: instead
    of one concatenated text blob (``page=0``, empty bbox), the caller provides
    per-line blocks ``{page, bbox:{x,y,w,h}, text}`` in PDF user-space points.
    This:

    - (re)indexes the semantic ``ocr_blocks`` WITH their geometry via
      :func:`store_ocr_blocks` (a REPLACE), so a search hit can be highlighted on
      the rendered page;
    - sets ``StoredDocument.extracted_text`` to the concatenated block text so the
      generated ``search_vector`` (keyword search) stays in sync.

    This is the single positioned-index entry point shared by the ``/ocr-blocks``
    endpoint, the upload/version-save paths and the server-side backfill — so every
    path produces the SAME index. The caller owns the transaction. Best-effort:
    never raises. Returns the number of blocks indexed.
    """
    try:
        indexed = await store_ocr_blocks(session, document_id, blocks)
        combined = (
            " ".join((b.get("text") or "") for b in blocks if (b.get("text") or "").strip())
            .replace("\x00", "")
            .strip()[:_MAX_EXTRACTED_TEXT_CHARS]
        )
        doc = (
            await session.execute(
                select(StoredDocument).where(StoredDocument.id == document_id)
            )
        ).scalar_one_or_none()
        if doc is not None:
            doc.extracted_text = combined or None
        return indexed
    except Exception:  # noqa: BLE001 — indexing must never break the caller
        _logger.warning(
            "reindex_document_blocks: indexing failed (doc=%s)",
            document_id,
            exc_info=True,
        )
        return 0


class CreateFolderRequest(BaseModel):
    """Request to create a folder."""

    name: str = Field(
        description="Folder name",
        min_length=1,
        max_length=255,
    )
    parent_id: str | None = Field(
        default=None,
        description="Parent folder ID (null for root)",
    )

    class Config:
        json_schema_extra = {
            "example": {
                "name": "Invoices 2026",
                "parent_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
            }
        }


@router.post(
    "/documents",
    response_model=APIResponse[dict],
    status_code=201,
    summary="Save document to storage",
    description="""
Save a document to persistent storage via multipart upload.

The file is stored in its **original format** (PDF, Office, image, …) — it is
**not** forced to PDF; export converts it on demand. PDF remains the default
and its storage path is unchanged.

## Features
- Keeps the original file format (`original_format` + precise `mime_type`)
- **Content indexing** for search: the client (WASM engine) ships the extracted
  text via the `extracted_text` field; the server chunks, embeds and makes it
  full-text + semantic searchable. Best-effort — a failed index never fails the
  upload.
- Automatic version tracking (initial version = 1)
- Tag-based organization for searchability
- Folder hierarchy support
- Storage quota enforcement (personal or organization-based)
- Format detection via magic bytes (+ extension/Content-Type fallback)
- File size limit: 100 MB

## Multipart Form Fields
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| file | file | Yes | File bytes in any supported format (PDF, docx/xlsx/pptx, odt/ods/odp, png/jpg/webp/tiff, …) |
| name | string | Yes | Display name (1-255 characters) |
| folder_id | string | No | Target folder UUID (null for root) |
| tags | string | No | JSON array of tag strings, e.g. `["contract","legal"]` (max 20 tags of 50 chars, normalized lowercase/trim) |
| version_comment | string | No | Comment describing this version |
| extracted_text | string | No | Pre-computed plain text for full-text search (truncated to 500k chars). If omitted, the text is extracted server-side from the file. |
""",
    responses={
        201: {
            "description": "Document saved successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "stored_document_id": "770e8400-e29b-41d4-a716-446655440002",
                            "name": "Contract Agreement 2024",
                            "page_count": 15,
                            "version": 1,
                            "created_at": "2024-01-15T10:30:00Z",
                            "quota_source": "personal"
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-15T10:30:00Z"},
                    }
                }
            },
        },
        400: {"description": "Invalid request or storage quota exceeded"},
        404: {"description": "Document or folder not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''curl -X POST "https://api.giga-pdf.com/api/v1/storage/documents" \\
  -H "Authorization: Bearer $TOKEN" \\
  -F "file=@document.pdf;type=application/pdf" \\
  -F "name=Contract Agreement 2024" \\
  -F "folder_id=660e8400-e29b-41d4-a716-446655440001" \\
  -F 'tags=["contract","legal","2024"]' \\
  -F "version_comment=Initial version" '''
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests, json

with open("document.pdf", "rb") as f:
    response = requests.post(
        "https://api.giga-pdf.com/api/v1/storage/documents",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": ("document.pdf", f, "application/pdf")},
        data={
            "name": "Contract Agreement 2024",
            "folder_id": folder_id,
            "tags": json.dumps(["contract", "legal", "2024"]),
            "version_comment": "Initial version",
        },
    )

stored_doc = response.json()["data"]
print(f"Saved as: {stored_doc['stored_document_id']}")
print(f"Version: {stored_doc['version']}")'''
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const formData = new FormData();
formData.append("file", pdfBlob, "document.pdf");
formData.append("name", "Contract Agreement 2024");
formData.append("folder_id", folderId);
formData.append("tags", JSON.stringify(["contract", "legal", "2024"]));
formData.append("version_comment", "Initial version");

const response = await fetch("https://api.giga-pdf.com/api/v1/storage/documents", {
  method: "POST",
  headers: { "Authorization": `Bearer ${token}` },
  body: formData,
});

const { data: storedDoc } = await response.json();
console.log(`Saved as: ${storedDoc.stored_document_id}`);
console.log(`Version: ${storedDoc.version}`);'''
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '''<?php
$client = new GuzzleHttp\\Client();
$response = $client->post("https://api.giga-pdf.com/api/v1/storage/documents", [
    "headers" => ["Authorization" => "Bearer " . $token],
    "multipart" => [
        ["name" => "file", "contents" => fopen("document.pdf", "r"), "filename" => "document.pdf"],
        ["name" => "name", "contents" => "Contract Agreement 2024"],
        ["name" => "folder_id", "contents" => $folderId],
        ["name" => "tags", "contents" => json_encode(["contract", "legal", "2024"])],
        ["name" => "version_comment", "contents" => "Initial version"],
    ],
]);

$storedDoc = json_decode($response->getBody(), true)["data"];
echo "Saved as: " . $storedDoc["stored_document_id"] . "\\n";
echo "Version: " . $storedDoc["version"] . "\\n";'''
            }
        ]
    },
)
async def save_document(
    user: AuthenticatedUser,
    file: UploadFile = File(..., description="PDF file bytes"),
    name: str = Form(..., min_length=1, max_length=255, description="Display name for the document"),
    folder_id: str | None = Form(default=None, description="Folder UUID (null for root)"),
    tags: str | None = Form(default=None, description='JSON array of tags, e.g. ["contract","legal"]'),
    version_comment: str | None = Form(default=None, description="Comment describing this version"),
    extracted_text: str | None = Form(
        default=None,
        description="Plain text content of the PDF for full-text search "
        "(truncated server-side to 500k characters)",
    ),
) -> APIResponse[dict]:
    """Save a PDF document to persistent storage.

    The frontend sends the rendered PDF bytes (produced by the TypeScript pdf-engine)
    directly as a multipart upload — no active editing session is required.

    Atomicity guarantee (Saga pattern):
      1. Validate PDF bytes (magic bytes + size) + quota.
      2. Commit DB records (StoredDocument + DocumentVersion) first.
      3. Upload to S3 after successful commit.
      4. If S3 upload fails after commit → delete the orphan S3 key (compensation)
         and re-raise so the caller gets a clean error.
         The DB records remain; a reconciliation job can clean them up or
         the next save attempt will reuse/overwrite the same s3_key.
    """
    start_time = time.time()

    # IMPORTANT: ne pas mettre "name" dans extra={} — c'est un attribut
    # réservé de logging.LogRecord. Le passer cause :
    #   KeyError: "Attempt to overwrite 'name' in LogRecord"
    # qui transforme un upload OK en HTTP 500 silencieux. Renommer en
    # "document_name" pour préserver l'info sans collision.
    _logger.info(
        "save_document: starting save",
        extra={"document_name": name, "user_id": user.user_id},
    )

    # ── 1. Read bytes + detect the original format (PDF or other) ───────
    file_bytes = await file.read()
    file_size = len(file_bytes)

    _FILE_SIZE_LIMIT = 250 * 1024 * 1024  # 250 MB
    if file_size > _FILE_SIZE_LIMIT:
        raise HTTPException(
            status_code=400,
            detail=f"File too large: {file_size} bytes (limit: {_FILE_SIZE_LIMIT} bytes)",
        )

    if file_size == 0:
        raise HTTPException(status_code=400, detail="Empty file: no bytes received")

    # Documents are now stored in their ORIGINAL format (export converts on
    # demand). PDF keeps its historical storage path; other formats are kept
    # verbatim on S3 with a precise mime_type.
    original_format, mime_type = _detect_upload_format(
        file_bytes, file.filename, file.content_type
    )
    is_pdf = original_format == "pdf"

    file_hash = hashlib.sha256(file_bytes).hexdigest()
    _logger.debug(
        "save_document: received %d bytes (sha256=%s, format=%s)",
        file_size,
        file_hash[:16],
        original_format,
    )

    # ── 2. Count pages — only meaningful for PDF (pikepdf). Non-PDF imports
    #       have no page concept here (0); the editor derives it on open. ──
    page_count = 0
    if is_pdf:
        try:
            page_count = await asyncio.to_thread(_count_pdf_pages_sync, file_bytes)
        except Exception as exc:
            raise HTTPException(
                status_code=400, detail=f"Cannot read PDF structure: {exc}"
            ) from exc

    # ── 3. Parse + normalize tags (JSON array string → list[str]) ────────
    parsed_tags: list[str] = []
    if tags:
        try:
            parsed_tags = json.loads(tags)
            if not isinstance(parsed_tags, list):
                raise ValueError("tags must be a JSON array")
            parsed_tags = _normalize_tags(parsed_tags)
        except (json.JSONDecodeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=f"Invalid tags format: {exc}") from exc

    # ── 3bis. Truncate extracted text (full-text search material) ────────
    if extracted_text is not None:
        extracted_text = extracted_text[:_MAX_EXTRACTED_TEXT_CHARS]

    # ── 4. Quota check ──────────────────────────────────────────────────
    effective_limits = await quota_service.get_effective_limits(user.user_id)

    if (
        effective_limits.storage_limit_bytes != -1
        and effective_limits.storage_used_bytes + file_size > effective_limits.storage_limit_bytes
    ):
        raise InvalidOperationError(
            f"Storage quota exceeded. Used: {effective_limits.storage_used_bytes}, "
            f"Limit: {effective_limits.storage_limit_bytes}"
        )

    if effective_limits.document_limit != -1 and effective_limits.document_count >= effective_limits.document_limit:
        raise InvalidOperationError(
            f"Document limit exceeded. Limit: {effective_limits.document_limit}"
        )

    # ── 5. Derive IDs before DB commit so S3 key is deterministic ───────
    stored_doc_id = generate_uuid()
    s3_key = _original_document_key(user.user_id, stored_doc_id, 1, original_format)

    # ── 6. Commit DB records first (rollback-safe) ───────────────────────
    # If anything inside the `async with` block raises, SQLAlchemy rolls
    # back automatically — no S3 side-effect has happened yet.
    async with get_db_session() as session:
        stored_doc = StoredDocument(
            id=stored_doc_id,
            name=name,
            owner_id=user.user_id,
            folder_id=folder_id,
            page_count=page_count,
            current_version=1,
            file_size_bytes=file_size,
            mime_type=mime_type,
            original_format=original_format,
            tags=parsed_tags,
            extracted_text=extracted_text,
        )
        session.add(stored_doc)

        version = DocumentVersion(
            document_id=stored_doc_id,
            version_number=1,
            file_path=s3_key,
            file_size_bytes=file_size,
            file_hash=file_hash,
            comment=version_comment,
            created_by=user.user_id,
        )
        session.add(version)
        # session commits on __aexit__ — DB is durable at this point

    _logger.info("save_document: DB committed (stored_doc_id=%s)", stored_doc_id)

    # ── 7. Upload to S3 after DB commit (compensation on failure) ────────
    try:
        s3_service.upload_file(
            file_data=file_bytes,
            key=s3_key,
            content_type=mime_type,
            metadata={
                "document_id": stored_doc_id,
                "user_id": user.user_id,
                "version": "1",
                "name": name,
                "original_format": original_format,
            },
        )
        _logger.info("save_document: S3 upload OK (key=%s)", s3_key)
    except Exception as exc:
        # Compensation: the DB row references this s3_key but the file is
        # absent. Attempt a best-effort delete of any partial upload, then
        # surface the error. The DB rows are left in place; the orphan-gc
        # Celery task will reconcile them.
        _logger.error(
            "save_document: S3 upload failed after DB commit — "
            "compensation: deleting partial s3_key=%s (doc=%s)",
            s3_key,
            stored_doc_id,
            exc_info=True,
        )
        s3_service.delete_file(s3_key)  # best-effort; ignore return value

        raise InvalidOperationError(
            f"Document saved to database but file upload failed: {exc}"
        ) from exc

    # ── 8. Update quota counters ─────────────────────────────────────────
    if effective_limits.is_tenant_based and effective_limits.tenant_id:
        await quota_service.update_tenant_storage(
            effective_limits.tenant_id, file_size, delta_documents=1
        )
    else:
        await quota_service.update_storage_usage(
            user.user_id, file_size, delta_documents=1
        )

    # ── 9. Index content for search (best-effort, never fails the import) ─
    # The client (TS/WASM engine) ships the document text via extracted_text;
    # we index it for BOTH full-text and semantic search (chunked). When the
    # client did not supply any text we fall back to server-side extraction —
    # now a stub for every format, so it indexes nothing until the client OCR /
    # text pipeline runs and posts to /ocr-blocks.
    indexed_text = extracted_text or ""
    try:
        async with get_db_session() as index_session:
            if extracted_text is not None:
                await reindex_document_text(
                    index_session, stored_doc_id, extracted_text
                )
            else:
                indexed_text = await index_document_content(
                    index_session, stored_doc_id, file_bytes, mime_type
                )
    except Exception:  # noqa: BLE001 — indexing must never break the upload
        _logger.warning(
            "save_document: content indexing failed (doc=%s)",
            stored_doc_id,
            exc_info=True,
        )

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "stored_document_id": stored_doc_id,
            "name": name,
            "page_count": page_count,
            "version": 1,
            "original_format": original_format,
            "mime_type": mime_type,
            "content_indexed": bool(indexed_text.strip()),
            "created_at": stored_doc.created_at.isoformat(),
            "quota_source": "tenant" if effective_limits.is_tenant_based else "personal",
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.get(
    "/documents",
    response_model=APIResponse[dict],
    summary="List stored documents",
    description="""
List all documents in persistent storage for the authenticated user.

This endpoint provides paginated access to stored documents with powerful filtering and search capabilities.

## Query Parameters
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| page | integer | 1 | Page number (1-based) |
| per_page | integer | 20 | Items per page (1-100) |
| folder_id | string | null | Filter by folder UUID, empty string for root |
| search | string | null | Full-text search: matches document names (substring) OR extracted PDF content (websearch syntax) |
| tags | string | null | Filter by tags, comma-separated (matches documents having ANY of the tags) |
| tag | string | null | Filter by a single tag (exact match) |
| trashed | boolean | false | If true, list ONLY trashed documents (same pagination/sorting) |

## Response Structure
- **items**: Array of document objects (`deleted_at` is non-null for trashed items)
- **pagination**: Pagination metadata (total, page, per_page, total_pages)

## Trash
Trashed documents (soft-deleted via `DELETE /documents/{id}`) are excluded
from the default listing, from search and from tag filters. Pass
`trashed=true` to browse the trash; documents older than 30 days in the
trash are purged automatically.
""",
    responses={
        200: {
            "description": "Documents retrieved successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "items": [
                                {
                                    "stored_document_id": "770e8400-e29b-41d4-a716-446655440002",
                                    "name": "Contract Agreement 2024",
                                    "page_count": 15,
                                    "version": 2,
                                    "folder_id": "660e8400-e29b-41d4-a716-446655440001",
                                    "tags": ["contract", "legal"],
                                    "file_size_bytes": 1048576,
                                    "created_at": "2024-01-15T10:30:00Z",
                                    "modified_at": "2024-01-16T14:20:00Z"
                                }
                            ],
                            "pagination": {
                                "total": 42,
                                "page": 1,
                                "per_page": 20,
                                "total_pages": 3
                            }
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-15T10:30:00Z"}
                    }
                }
            }
        },
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''curl -X GET "https://api.giga-pdf.com/api/v1/storage/documents?page=1&per_page=20&search=contract" \\
  -H "Authorization: Bearer $TOKEN"'''
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests

response = requests.get(
    "https://api.giga-pdf.com/api/v1/storage/documents",
    params={
        "page": 1,
        "per_page": 20,
        "search": "contract",
        "tags": "legal,2024"
    },
    headers={"Authorization": f"Bearer {token}"}
)

data = response.json()["data"]
for doc in data["items"]:
    print(f"{doc['name']} - {doc['page_count']} pages")

pagination = data["pagination"]
print(f"Page {pagination['page']} of {pagination['total_pages']}")'''
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const params = new URLSearchParams({
  page: "1",
  per_page: "20",
  search: "contract",
  tags: "legal,2024"
});

const response = await fetch(
  `https://api.giga-pdf.com/api/v1/storage/documents?${params}`,
  {
    method: "GET",
    headers: { "Authorization": `Bearer ${token}` }
  }
);

const { data } = await response.json();
data.items.forEach(doc => {
  console.log(`${doc.name} - ${doc.page_count} pages`);
});
console.log(`Page ${data.pagination.page} of ${data.pagination.total_pages}`);'''
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '''<?php
$client = new GuzzleHttp\\Client();
$response = $client->get("https://api.giga-pdf.com/api/v1/storage/documents", [
    "headers" => ["Authorization" => "Bearer " . $token],
    "query" => [
        "page" => 1,
        "per_page" => 20,
        "search" => "contract",
        "tags" => "legal,2024"
    ]
]);

$data = json_decode($response->getBody(), true)["data"];
foreach ($data["items"] as $doc) {
    echo $doc["name"] . " - " . $doc["page_count"] . " pages\\n";
}
echo "Page " . $data["pagination"]["page"] . " of " . $data["pagination"]["total_pages"] . "\\n";'''
            }
        ]
    },
)
async def list_stored_documents(
    user: AuthenticatedUser,
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    folder_id: str | None = Query(default=None),
    search: str | None = Query(default=None),
    tags: str | None = Query(default=None),
    tag: str | None = Query(default=None, description="Filter by a single tag (exact match)"),
    trashed: bool = Query(default=False, description="List only trashed documents"),
    db: AsyncSession = Depends(get_db),
) -> APIResponse[dict]:
    """List stored documents with pagination."""
    start_time = time.time()

    # Build base query.
    # Default: exclude trashed documents. trashed=true: ONLY the trash.
    base_query = select(StoredDocument).where(
        StoredDocument.owner_id == user.user_id,
    )
    if trashed:
        base_query = base_query.where(
            StoredDocument.is_deleted,
            StoredDocument.deleted_at.is_not(None),
        )
    else:
        base_query = base_query.where(~StoredDocument.is_deleted)

    # Filter by folder
    # - None (not provided): no filter, return all documents
    # - '' (empty string): filter for root-level documents (folder_id IS NULL)
    # - UUID: filter for specific folder
    if folder_id is not None:
        if folder_id == '' or folder_id.lower() == 'null':
            # Empty string or 'null' means filter for root-level documents (no folder)
            base_query = base_query.where(StoredDocument.folder_id.is_(None))
        else:
            # Validate that folder_id is a valid UUID before querying
            try:
                uuid.UUID(folder_id)  # Validate UUID format
                base_query = base_query.where(StoredDocument.folder_id == folder_id)
            except ValueError:
                # Invalid UUID format - treat as root-level filter
                base_query = base_query.where(StoredDocument.folder_id.is_(None))

    # Search: name substring OR full-text match on the generated tsvector
    # (name + extracted_text, 'simple' config — multilingual content).
    if search:
        base_query = base_query.where(
            or_(
                StoredDocument.name.ilike(f"%{search}%"),
                StoredDocument.search_vector.bool_op("@@")(
                    func.websearch_to_tsquery(_TSQUERY_CONFIG, search)
                ),
            )
        )

    # Filter by tags (comma-separated, ANY match).
    # tags is a JSON column → cast to JSONB and use the ?| (exists any) operator.
    if tags:
        tag_list = [t.strip() for t in tags.split(",") if t.strip()]
        if tag_list:
            base_query = base_query.where(
                cast(StoredDocument.tags, JSONB).bool_op("?|")(pg_array(tag_list))
            )

    # Filter by a single tag (exact match) — JSONB containment.
    if tag:
        base_query = base_query.where(
            cast(StoredDocument.tags, JSONB).contains([tag])
        )

    # Get total count
    count_query = select(func.count()).select_from(base_query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Order and paginate
    offset = (page - 1) * per_page
    paginated_query = base_query.order_by(StoredDocument.updated_at.desc()).offset(offset).limit(per_page)
    result = await db.execute(paginated_query)
    documents = result.scalars().all()

    # Format results
    items = [_serialize_stored_document(doc) for doc in documents]

    total_pages = (total + per_page - 1) // per_page

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "items": items,
            "pagination": PaginationInfo(
                total=total,
                page=page,
                per_page=per_page,
                total_pages=total_pages,
            ).model_dump(),
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.get(
    "/documents/tags",
    response_model=APIResponse[dict],
    summary="List user document tags",
    description="""
List all distinct tags used across the authenticated user's stored documents.

Intended for tag autocomplete in the document manager UI. Tags from trashed
documents are excluded. The list is deduplicated and sorted alphabetically.

## Response Structure
- **tags**: Array of unique tag strings, sorted alphabetically
""",
    responses={
        200: {
            "description": "Tags retrieved successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {"tags": ["2024", "contract", "facture", "legal"]},
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-15T10:30:00Z"},
                    }
                }
            },
        },
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''curl -X GET "https://api.giga-pdf.com/api/v1/storage/documents/tags" \\
  -H "Authorization: Bearer $TOKEN"'''
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests

response = requests.get(
    "https://api.giga-pdf.com/api/v1/storage/documents/tags",
    headers={"Authorization": f"Bearer {token}"}
)

tags = response.json()["data"]["tags"]
print(f"{len(tags)} tags: {', '.join(tags)}")'''
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const response = await fetch(
  "https://api.giga-pdf.com/api/v1/storage/documents/tags",
  { headers: { "Authorization": `Bearer ${token}` } }
);

const { data: { tags } } = await response.json();
console.log(`${tags.length} tags:`, tags);'''
            },
        ]
    },
)
async def list_document_tags(
    user: AuthenticatedUser,
    db: AsyncSession = Depends(get_db),
) -> APIResponse[dict]:
    """List distinct tags across the user's (non-trashed) stored documents."""
    start_time = time.time()

    # Expand the JSON tags array with jsonb_array_elements_text.
    # In PostgreSQL, set-returning functions in FROM are implicitly LATERAL,
    # so the function can reference stored_documents.tags directly.
    doc_tags = func.jsonb_array_elements_text(
        cast(StoredDocument.tags, JSONB)
    ).table_valued("value", name="doc_tags")

    stmt = (
        select(doc_tags.c.value)
        .distinct()
        .select_from(StoredDocument)
        .join(doc_tags, true())
        .where(
            StoredDocument.owner_id == user.user_id,
            ~StoredDocument.is_deleted,
            StoredDocument.tags.is_not(None),
            func.jsonb_typeof(cast(StoredDocument.tags, JSONB)) == "array",
        )
        .order_by(doc_tags.c.value)
    )
    result = await db.execute(stmt)
    tag_values = [row[0] for row in result.all()]

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={"tags": tag_values},
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.get(
    "/documents/{stored_document_id}",
    response_model=APIResponse[dict],
    summary="Get stored document",
    description="""
Retrieve a single document from persistent storage by its UUID.

Returns the same serialized shape as the listing endpoint (id, name, size,
tags, thumbnail_url, page_count, folder_id, version, created_at,
modified_at, deleted_at).

## Permissions
- **Owner**: always allowed.
- **Shared user**: allowed (active share grant on the document).
- **Anyone else**: **403 Forbidden** (the document exists but is not yours).

## Trashed documents
By default, a soft-deleted document returns **404**. Pass
`?include_trashed=true` (owner only) to retrieve it anyway.
""",
    responses={
        200: {
            "description": "Document retrieved successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "stored_document_id": "550e8400-e29b-41d4-a716-446655440000",
                            "name": "Contract Q4 2025.pdf",
                            "page_count": 12,
                            "version": 3,
                            "folder_id": None,
                            "tags": ["contract", "legal"],
                            "file_size_bytes": 204800,
                            "created_at": "2025-11-01T09:00:00Z",
                            "modified_at": "2025-11-15T14:30:00Z",
                            "thumbnail_url": "https://cdn.example.com/thumb.jpg",
                            "deleted_at": None,
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2025-11-15T14:30:00Z"},
                    }
                }
            },
        },
        403: {"description": "You do not have access to this document"},
        404: {"description": "Document not found"},
    },
)
async def get_stored_document(
    stored_document_id: str,
    user: AuthenticatedUser,
    include_trashed: bool = False,
    db: AsyncSession = Depends(get_db),
) -> APIResponse[dict]:
    """Return a single stored document the user owns or has been shared.

    Access: owner OR active share grant. A non-owner without a grant gets
    **403** (not 404). ``include_trashed`` browses the trash and is restricted
    to the owner.
    """
    start = time.perf_counter()

    # Load by id (ownership is enforced by the access guard, not the query, so
    # shared users can open the document too — and IDOR is closed by the guard).
    query = select(StoredDocument).where(StoredDocument.id == stored_document_id)
    if not include_trashed:
        query = query.where(~StoredDocument.is_deleted)

    result = await db.execute(query)
    stored_doc = result.scalar_one_or_none()
    if not stored_doc:
        raise NotFoundError(f"Document not found: {stored_document_id}")

    # Owner-or-shared gate → 403 for anyone else. The trash is owner-only.
    decision = await authorize_document_access(db, stored_doc, user.user_id)
    if include_trashed and not decision.is_owner:
        raise HTTPException(
            status_code=403, detail="You do not have access to this document"
        )

    processing_time = int((time.perf_counter() - start) * 1000)
    return APIResponse(
        success=True,
        data=_serialize_stored_document(stored_doc),
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.post(
    "/documents/{stored_document_id}/load",
    response_model=APIResponse[dict],
    summary="Load stored document to session",
    description="""
Load a document from persistent storage into an active editing session.

This endpoint downloads the latest version of a stored document and creates a new editing session. The returned document_id can be used with all document manipulation APIs (annotations, text editing, page operations, etc.).

## Path Parameters
| Parameter | Type | Description |
|-----------|------|-------------|
| stored_document_id | string | UUID of the stored document |

## Use Cases
- Resume editing a previously saved document
- Create a working copy of a stored document
- Access document for annotation or modification

## Response
Returns a session document_id that can be used with the Document APIs.
""",
    responses={
        200: {
            "description": "Document loaded successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "document_id": "880e8400-e29b-41d4-a716-446655440003",
                            "stored_document_id": "770e8400-e29b-41d4-a716-446655440002",
                            "name": "Contract Agreement 2024",
                            "page_count": 15
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-15T10:30:00Z"}
                    }
                }
            }
        },
        403: {"description": "You do not have access to this document"},
        404: {"description": "Stored document not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''curl -X POST "https://api.giga-pdf.com/api/v1/storage/documents/770e8400-e29b-41d4-a716-446655440002/load" \\
  -H "Authorization: Bearer $TOKEN"'''
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests

stored_doc_id = "770e8400-e29b-41d4-a716-446655440002"
response = requests.post(
    f"https://api.giga-pdf.com/api/v1/storage/documents/{stored_doc_id}/load",
    headers={"Authorization": f"Bearer {token}"}
)

session = response.json()["data"]
document_id = session["document_id"]
print(f"Loaded '{session['name']}' with {session['page_count']} pages")
print(f"Session document ID: {document_id}")

# Now use document_id with Document APIs for editing'''
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const storedDocId = "770e8400-e29b-41d4-a716-446655440002";
const response = await fetch(
  `https://api.giga-pdf.com/api/v1/storage/documents/${storedDocId}/load`,
  {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}` }
  }
);

const { data: session } = await response.json();
const documentId = session.document_id;
console.log(`Loaded '${session.name}' with ${session.page_count} pages`);
console.log(`Session document ID: ${documentId}`);

// Now use documentId with Document APIs for editing'''
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '''<?php
$storedDocId = "770e8400-e29b-41d4-a716-446655440002";
$client = new GuzzleHttp\\Client();
$response = $client->post(
    "https://api.giga-pdf.com/api/v1/storage/documents/{$storedDocId}/load",
    ["headers" => ["Authorization" => "Bearer " . $token]]
);

$session = json_decode($response->getBody(), true)["data"];
$documentId = $session["document_id"];
echo "Loaded '" . $session["name"] . "' with " . $session["page_count"] . " pages\\n";
echo "Session document ID: " . $documentId . "\\n";

// Now use $documentId with Document APIs for editing'''
            }
        ]
    },
)
async def load_stored_document(
    stored_document_id: str,
    user: AuthenticatedUser,
    db: AsyncSession = Depends(get_db),
) -> APIResponse[dict]:
    """Load (open) a stored document into an editing session.

    Access: owner OR active share grant — a non-owner without a grant gets
    **403** (not 404). The file is read from the **owner's** S3 prefix so a
    shared user can open it.
    """
    start_time = time.time()

    # Load by id; the access guard (not the query) enforces owner-or-shared.
    result = await db.execute(
        select(StoredDocument).where(
            StoredDocument.id == stored_document_id,
            ~StoredDocument.is_deleted,
        )
    )
    stored_doc = result.scalar_one_or_none()

    if not stored_doc:
        raise NotFoundError(f"Stored document not found: {stored_document_id}")

    # Owner-or-shared gate → 403 for anyone else.
    await authorize_document_access(db, stored_doc, user.user_id)

    # Download from S3 — keyed by the OWNER's id and the original format so
    # shared documents (and non-PDF originals) resolve to the right object.
    s3_key = _original_document_key(
        stored_doc.owner_id,
        stored_document_id,
        stored_doc.current_version,
        stored_doc.original_format or "pdf",
    )

    try:
        file_data = s3_service.download_file(s3_key)
    except Exception as e:
        raise NotFoundError(f"Document file not found in storage: {str(e)}")

    # Upload to session (owned by the requesting user's session)
    document_id, document = await document_service.upload_document(
        file_data=file_data,
        filename=f"{stored_doc.name}.pdf",
        owner_id=user.user_id,
    )

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "document_id": document_id,
            "stored_document_id": stored_document_id,
            "name": stored_doc.name,
            "page_count": document.metadata.page_count,
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.post(
    "/documents/{stored_document_id}/duplicate",
    response_model=APIResponse[dict],
    status_code=201,
    summary="Duplicate stored document",
    description="""
Duplicate a stored document into a new independent document.

The PDF file is copied **server-side on S3** (no download/re-upload through
the API) and a new database record is created.

## Path Parameters
| Parameter | Type | Description |
|-----------|------|-------------|
| stored_document_id | string | UUID of the document to duplicate |

## Behavior
- New name: `"{name} (copie)"` — suffix incremented (`(copie 2)`, `(copie 3)`…)
  if the name is already taken in the same folder
- Same folder and same tags as the source
- Version history and shares are **NOT** copied (the copy starts at version 1)
- Storage quota is checked and consumed exactly like an upload
- Encrypted documents are transparently re-encrypted for the new document ID

## Errors
- 400: storage quota or document limit exceeded
- 404: source document not found (or trashed)
""",
    responses={
        201: {
            "description": "Document duplicated successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "stored_document_id": "990e8400-e29b-41d4-a716-446655440004",
                            "name": "Contract Agreement 2024 (copie)",
                            "page_count": 15,
                            "version": 1,
                            "folder_id": "660e8400-e29b-41d4-a716-446655440001",
                            "tags": ["contract", "legal"],
                            "file_size_bytes": 1048576,
                            "created_at": "2024-01-18T14:00:00Z",
                            "modified_at": "2024-01-18T14:00:00Z",
                            "thumbnail_url": None,
                            "deleted_at": None,
                            "source_document_id": "770e8400-e29b-41d4-a716-446655440002",
                            "quota_source": "personal",
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-18T14:00:00Z"},
                    }
                }
            },
        },
        400: {"description": "Storage quota exceeded"},
        404: {"description": "Stored document not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''curl -X POST "https://api.giga-pdf.com/api/v1/storage/documents/770e8400-e29b-41d4-a716-446655440002/duplicate" \\
  -H "Authorization: Bearer $TOKEN"'''
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests

stored_doc_id = "770e8400-e29b-41d4-a716-446655440002"
response = requests.post(
    f"https://api.giga-pdf.com/api/v1/storage/documents/{stored_doc_id}/duplicate",
    headers={"Authorization": f"Bearer {token}"}
)

copy = response.json()["data"]
print(f"Duplicated as: {copy['name']} ({copy['stored_document_id']})")'''
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const storedDocId = "770e8400-e29b-41d4-a716-446655440002";
const response = await fetch(
  `https://api.giga-pdf.com/api/v1/storage/documents/${storedDocId}/duplicate`,
  {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}` }
  }
);

const { data: copy } = await response.json();
console.log(`Duplicated as: ${copy.name} (${copy.stored_document_id})`);'''
            },
        ]
    },
)
async def duplicate_stored_document(
    stored_document_id: str,
    user: AuthenticatedUser,
    db: AsyncSession = Depends(get_db),
) -> APIResponse[dict]:
    """Duplicate a stored document (server-side S3 copy + new DB record).

    Order of operations:
      1. Validate source ownership + quota (like an upload).
      2. Copy the file on S3 first — for encrypted documents the DEK is
         bound to the document ID (AES-GCM AAD), so the copy must be
         re-encrypted and the new encrypted DEK is only known after upload.
      3. Commit DB records; on failure, delete the new S3 object
         (compensation) so no orphan file remains.
    """
    start_time = time.time()

    # ── 1. Source document (ownership + not trashed) ─────────────────────
    result = await db.execute(
        select(StoredDocument)
        .options(undefer(StoredDocument.extracted_text))
        .where(
            StoredDocument.id == stored_document_id,
            StoredDocument.owner_id == user.user_id,
            ~StoredDocument.is_deleted,
        )
    )
    source_doc = result.scalar_one_or_none()

    if not source_doc:
        raise NotFoundError(f"Stored document not found: {stored_document_id}")

    # Current version row (file path + encryption material)
    version_result = await db.execute(
        select(DocumentVersion).where(
            DocumentVersion.document_id == stored_document_id,
            DocumentVersion.version_number == source_doc.current_version,
        )
    )
    source_version = version_result.scalar_one_or_none()

    if not source_version:
        raise NotFoundError(
            f"Current version not found for document: {stored_document_id}"
        )

    file_size = source_doc.file_size_bytes or 0

    # ── 2. Quota check — same rules as an upload ─────────────────────────
    effective_limits = await quota_service.get_effective_limits(user.user_id)

    if (
        effective_limits.storage_limit_bytes != -1
        and effective_limits.storage_used_bytes + file_size > effective_limits.storage_limit_bytes
    ):
        raise InvalidOperationError(
            f"Storage quota exceeded. Used: {effective_limits.storage_used_bytes}, "
            f"Limit: {effective_limits.storage_limit_bytes}"
        )

    if effective_limits.document_limit != -1 and effective_limits.document_count >= effective_limits.document_limit:
        raise InvalidOperationError(
            f"Document limit exceeded. Limit: {effective_limits.document_limit}"
        )

    # ── 3. Compute the copy name ("{name} (copie)", incremented) ─────────
    sibling_filter = [
        StoredDocument.owner_id == user.user_id,
        ~StoredDocument.is_deleted,
    ]
    if source_doc.folder_id is None:
        sibling_filter.append(StoredDocument.folder_id.is_(None))
    else:
        sibling_filter.append(StoredDocument.folder_id == source_doc.folder_id)

    names_result = await db.execute(select(StoredDocument.name).where(*sibling_filter))
    existing_names = {row[0] for row in names_result.all()}
    copy_name = _next_copy_name(source_doc.name, existing_names)

    # ── 4. Copy the file on S3 ───────────────────────────────────────────
    new_doc_id = generate_uuid()
    source_key = source_version.file_path
    new_key = s3_service.get_document_key(user.user_id, new_doc_id, 1)

    new_encryption_key: str | None = None
    new_is_encrypted = False

    try:
        if source_version.is_encrypted and source_version.encryption_key:
            # The AES-256-GCM DEK is bound to (document_id, user_id) via AAD:
            # a raw S3 copy would be undecryptable under the new document ID.
            # Decrypt with the source identity, re-encrypt for the copy.
            plaintext = s3_service.download_encrypted_document(
                key=source_key,
                encrypted_dek=source_version.encryption_key,
                document_id=stored_document_id,
                user_id=user.user_id,
            )
            if plaintext is None:
                raise NotFoundError(
                    f"Document file not found in storage: {source_key}"
                )
            _, new_encryption_key = s3_service.upload_encrypted_document(
                document_data=plaintext,
                key=new_key,
                document_id=new_doc_id,
                user_id=user.user_id,
                metadata={
                    "document_id": new_doc_id,
                    "user_id": user.user_id,
                    "version": "1",
                    "duplicated_from": stored_document_id,
                },
            )
            new_is_encrypted = True
        else:
            # Fast path: server-side S3 copy — no bytes through the API.
            s3_service.copy_file(
                source_key=source_key,
                dest_key=new_key,
                content_type="application/pdf",
                metadata={
                    "document_id": new_doc_id,
                    "user_id": user.user_id,
                    "version": "1",
                    "duplicated_from": stored_document_id,
                },
            )
    except NotFoundError:
        raise
    except Exception as exc:
        _logger.error(
            "duplicate: S3 copy failed (%s -> %s)", source_key, new_key, exc_info=True
        )
        raise InvalidOperationError(f"Failed to copy document file: {exc}") from exc

    # ── 5. DB records (compensation: drop the S3 copy on failure) ────────
    created_at = now_utc()
    try:
        new_doc = StoredDocument(
            id=new_doc_id,
            name=copy_name,
            owner_id=user.user_id,
            folder_id=source_doc.folder_id,
            page_count=source_doc.page_count,
            current_version=1,
            file_size_bytes=file_size,
            mime_type=source_doc.mime_type,
            tags=list(source_doc.tags or []),
            extracted_text=source_doc.extracted_text,
            created_at=created_at,
            updated_at=created_at,
        )
        db.add(new_doc)

        new_version = DocumentVersion(
            document_id=new_doc_id,
            version_number=1,
            file_path=new_key,
            file_size_bytes=source_version.file_size_bytes,
            file_hash=source_version.file_hash,
            comment=f"Duplicated from '{source_doc.name}'",
            created_by=user.user_id,
            encryption_key=new_encryption_key,
            is_encrypted=new_is_encrypted,
        )
        db.add(new_version)
        await db.commit()
    except Exception as exc:
        _logger.error(
            "duplicate: DB commit failed — compensation: deleting s3_key=%s",
            new_key,
            exc_info=True,
        )
        s3_service.delete_file(new_key)  # best-effort compensation
        raise InvalidOperationError(f"Failed to duplicate document: {exc}") from exc

    # ── 6. Quota counters — same as an upload ────────────────────────────
    if effective_limits.is_tenant_based and effective_limits.tenant_id:
        await quota_service.update_tenant_storage(
            effective_limits.tenant_id, file_size, delta_documents=1
        )
    else:
        await quota_service.update_storage_usage(
            user.user_id, file_size, delta_documents=1
        )

    # ── 7. Activity log ──────────────────────────────────────────────────
    await activity_service.log_activity(
        user_id=user.user_id,
        action=ActivityAction.COPY,
        document_id=new_doc_id,
        user_email=user.email,
        extra_data={
            "source_document_id": stored_document_id,
            "source_name": source_doc.name,
            "name": copy_name,
        },
        tenant_id=effective_limits.tenant_id if effective_limits.is_tenant_based else None,
    )

    # ── 8. Build the duplicate's search index (best-effort) ──────────────
    # ocr_blocks are keyed by document_id, so the copy starts with an EMPTY
    # semantic index even though extracted_text was copied verbatim. Re-index
    # from the source text so the duplicate is immediately searchable (full-text
    # was already copied via the column; this adds the semantic vectors). The
    # duplicate row is already durably committed above, so a failure here only
    # means "not yet semantically searchable" — never a lost duplicate.
    if source_doc.extracted_text:
        await reindex_document_text(db, new_doc_id, source_doc.extracted_text)
        try:
            await db.commit()
        except Exception:  # noqa: BLE001 — index commit is best-effort
            _logger.warning(
                "duplicate: search-index commit failed (doc=%s)",
                new_doc_id,
                exc_info=True,
            )
            await db.rollback()

    processing_time = int((time.time() - start_time) * 1000)

    data = _serialize_stored_document(new_doc)
    data["source_document_id"] = stored_document_id
    data["quota_source"] = "tenant" if effective_limits.is_tenant_based else "personal"

    return APIResponse(
        success=True,
        data=data,
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.get(
    "/documents/{stored_document_id}/versions",
    response_model=APIResponse[dict],
    summary="List document versions",
    description="""
List all versions of a stored document with their metadata.

Every time a document is saved to storage, a new version is created. This endpoint returns the complete version history, allowing you to track changes over time and restore previous versions.

## Path Parameters
| Parameter | Type | Description |
|-----------|------|-------------|
| stored_document_id | string | UUID of the stored document |

## Response Structure
- **stored_document_id**: The document's unique identifier
- **current_version**: The latest version number
- **versions**: Array of version objects (newest first)
  - version: Version number
  - created_at: ISO 8601 timestamp
  - created_by: User ID who created this version
  - comment: Optional version comment
  - size_bytes: File size of this version
""",
    responses={
        200: {
            "description": "Versions retrieved successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "stored_document_id": "770e8400-e29b-41d4-a716-446655440002",
                            "current_version": 3,
                            "versions": [
                                {
                                    "version": 3,
                                    "created_at": "2024-01-17T09:15:00Z",
                                    "created_by": "user-uuid",
                                    "comment": "Final review changes",
                                    "size_bytes": 1150000
                                },
                                {
                                    "version": 2,
                                    "created_at": "2024-01-16T14:20:00Z",
                                    "created_by": "user-uuid",
                                    "comment": "Updated terms on page 5",
                                    "size_bytes": 1120000
                                },
                                {
                                    "version": 1,
                                    "created_at": "2024-01-15T10:30:00Z",
                                    "created_by": "user-uuid",
                                    "comment": "Initial version",
                                    "size_bytes": 1048576
                                }
                            ]
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-15T10:30:00Z"}
                    }
                }
            }
        },
        403: {"description": "You do not have access to this document"},
        404: {"description": "Stored document not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''curl -X GET "https://api.giga-pdf.com/api/v1/storage/documents/770e8400-e29b-41d4-a716-446655440002/versions" \\
  -H "Authorization: Bearer $TOKEN"'''
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests

stored_doc_id = "770e8400-e29b-41d4-a716-446655440002"
response = requests.get(
    f"https://api.giga-pdf.com/api/v1/storage/documents/{stored_doc_id}/versions",
    headers={"Authorization": f"Bearer {token}"}
)

data = response.json()["data"]
print(f"Current version: {data['current_version']}")

for version in data["versions"]:
    print(f"v{version['version']}: {version['comment']} ({version['size_bytes']} bytes)")'''
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const storedDocId = "770e8400-e29b-41d4-a716-446655440002";
const response = await fetch(
  `https://api.giga-pdf.com/api/v1/storage/documents/${storedDocId}/versions`,
  {
    method: "GET",
    headers: { "Authorization": `Bearer ${token}` }
  }
);

const { data } = await response.json();
console.log(`Current version: ${data.current_version}`);

data.versions.forEach(version => {
  console.log(`v${version.version}: ${version.comment} (${version.size_bytes} bytes)`);
});'''
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '''<?php
$storedDocId = "770e8400-e29b-41d4-a716-446655440002";
$client = new GuzzleHttp\\Client();
$response = $client->get(
    "https://api.giga-pdf.com/api/v1/storage/documents/{$storedDocId}/versions",
    ["headers" => ["Authorization" => "Bearer " . $token]]
);

$data = json_decode($response->getBody(), true)["data"];
echo "Current version: " . $data["current_version"] . "\\n";

foreach ($data["versions"] as $version) {
    echo "v" . $version["version"] . ": " . $version["comment"] . " (" . $version["size_bytes"] . " bytes)\\n";
}'''
            }
        ]
    },
)
async def list_versions(
    stored_document_id: str,
    user: AuthenticatedUser,
    db: AsyncSession = Depends(get_db),
) -> APIResponse[dict]:
    """List document versions (owner or shared user; 403 otherwise)."""
    start_time = time.time()

    # Load by id; owner-or-shared is enforced by the access guard below.
    result = await db.execute(
        select(StoredDocument).where(
            StoredDocument.id == stored_document_id,
        )
    )
    stored_doc = result.scalar_one_or_none()

    if not stored_doc:
        raise NotFoundError(f"Stored document not found: {stored_document_id}")

    # Owner-or-shared gate → 403 for anyone else.
    await authorize_document_access(db, stored_doc, user.user_id)

    # Get versions
    versions_result = await db.execute(
        select(DocumentVersion).where(
            DocumentVersion.document_id == stored_document_id
        ).order_by(DocumentVersion.version_number.desc())
    )
    versions = versions_result.scalars().all()

    version_list = []
    for v in versions:
        version_list.append({
            "version": v.version_number,
            "created_at": v.created_at.isoformat(),
            "created_by": v.created_by,
            "comment": v.comment,
            "size_bytes": v.file_size_bytes,
        })

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "stored_document_id": stored_document_id,
            "current_version": stored_doc.current_version,
            "versions": version_list,
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.post(
    "/documents/{stored_document_id}/versions",
    response_model=APIResponse[dict],
    summary="Create new version",
    description="""
Create a new version of a stored document via multipart PDF upload.

The frontend sends the rendered PDF bytes (produced by the TypeScript pdf-engine) directly,
without requiring an active editing session. Previous versions are preserved, allowing for
version history tracking and rollback capabilities.

## Path Parameters
| Parameter | Type | Description |
|-----------|------|-------------|
| stored_document_id | string | UUID of the stored document to update |

## Multipart Form Fields
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| file | file | Yes | PDF file bytes |
| comment | string | No | Description of changes in this version |
| extracted_text | string | No | Updated plain text of the edited document (truncated to 500k chars). When provided, the full-text + semantic search index is rebuilt (re-vectorized) for this document so search reflects the new content. |

## Use Cases
- Save incremental changes while editing
- Create checkpoints before major modifications
- Track document evolution with descriptive comments
- Keep search in sync with edits (pass `extracted_text` to re-vectorize)

## Permissions
- **Owner**: always allowed.
- **Shared user with edit grant**: allowed — the version is stored under the
  owner's prefix and `created_by` records the invited editor.
- **View-only grant / anyone else**: **403 Forbidden**.

## File Constraints
- Maximum size: 100 MB
- Must be a valid PDF (starts with `%PDF-`)
""",
    responses={
        201: {
            "description": "Version created successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "stored_document_id": "770e8400-e29b-41d4-a716-446655440002",
                            "version": 4,
                            "created_at": "2024-01-18T11:45:00Z"
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-18T11:45:00Z"}
                    }
                }
            }
        },
        403: {"description": "You do not have edit access to this document"},
        404: {"description": "Stored document or session document not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''curl -X POST "https://api.giga-pdf.com/api/v1/storage/documents/770e8400-e29b-41d4-a716-446655440002/versions" \\
  -H "Authorization: Bearer $TOKEN" \\
  -F "file=@document.pdf;type=application/pdf" \\
  -F "comment=Updated legal terms on page 5" '''
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests

stored_doc_id = "770e8400-e29b-41d4-a716-446655440002"
with open("document.pdf", "rb") as f:
    response = requests.post(
        f"https://api.giga-pdf.com/api/v1/storage/documents/{stored_doc_id}/versions",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": ("document.pdf", f, "application/pdf")},
        data={"comment": "Updated legal terms on page 5"},
    )

new_version = response.json()["data"]
print(f"Created version {new_version['version']}")
print(f"Saved at: {new_version['created_at']}")'''
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const storedDocId = "770e8400-e29b-41d4-a716-446655440002";

const formData = new FormData();
formData.append("file", pdfBlob, "document.pdf");
formData.append("comment", "Updated legal terms on page 5");

const response = await fetch(
  `https://api.giga-pdf.com/api/v1/storage/documents/${storedDocId}/versions`,
  {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}` },
    body: formData,
  }
);

const { data: newVersion } = await response.json();
console.log(`Created version ${newVersion.version}`);
console.log(`Saved at: ${newVersion.created_at}`);'''
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '''<?php
$storedDocId = "770e8400-e29b-41d4-a716-446655440002";
$client = new GuzzleHttp\\Client();
$response = $client->post(
    "https://api.giga-pdf.com/api/v1/storage/documents/{$storedDocId}/versions",
    [
        "headers" => ["Authorization" => "Bearer " . $token],
        "multipart" => [
            ["name" => "file", "contents" => fopen("document.pdf", "r"), "filename" => "document.pdf"],
            ["name" => "comment", "contents" => "Updated legal terms on page 5"],
        ],
    ]
);

$newVersion = json_decode($response->getBody(), true)["data"];
echo "Created version " . $newVersion["version"] . "\\n";
echo "Saved at: " . $newVersion["created_at"] . "\\n";'''
            }
        ]
    },
)
async def create_version(
    stored_document_id: str,
    user: AuthenticatedUser,
    file: UploadFile = File(..., description="PDF file bytes"),
    comment: str | None = Form(default=None, description="Description of changes in this version"),
    extracted_text: str | None = Form(
        default=None,
        description="Updated plain text of the edited document for full-text + "
        "semantic search (truncated to 500k chars). When provided, the search "
        "index is rebuilt (re-vectorized) for this document.",
    ),
) -> APIResponse[dict]:
    """Create a new version of a stored document via multipart PDF upload.

    The frontend sends the rendered PDF bytes directly — no active editing session required.

    Access: owner OR active **edit** share grant (mirrors the editor load
    endpoint) — a view-only grantee or a stranger gets **403**. The version is
    written under the **owner's** S3 prefix (symmetric with the load path) and
    ``created_by`` records the actual author (the current user, who may be an
    invited editor).

    When ``extracted_text`` is provided, the document's search index is rebuilt
    from it (full-text material + chunked semantic ``ocr_blocks``, a REPLACE) so
    the index always reflects the latest edited content.

    Atomicity guarantee (Saga pattern):
      1. Validate PDF bytes (magic bytes + size) + authorize (owner-or-edit-share).
      2. Commit new DocumentVersion + updated StoredDocument to DB first.
      3. Upload new version to S3 after successful commit.
      4. If S3 upload fails → compensate by deleting the partial upload
         and rolling back current_version in a separate DB transaction,
         then re-raise so the caller gets a clean error.
    """
    start_time = time.time()

    # ── 1. Read + validate PDF bytes ────────────────────────────────────
    doc_bytes = await file.read()
    file_size = len(doc_bytes)

    _FILE_SIZE_LIMIT = 250 * 1024 * 1024  # 250 MB
    if file_size > _FILE_SIZE_LIMIT:
        raise HTTPException(
            status_code=400,
            detail=f"File too large: {file_size} bytes (limit: {_FILE_SIZE_LIMIT} bytes)",
        )

    if not doc_bytes.startswith(b"%PDF-"):
        raise HTTPException(status_code=400, detail="Invalid PDF format: missing %PDF- header")

    file_hash = hashlib.sha256(doc_bytes).hexdigest()
    _logger.debug("create_version: received %d bytes (sha256=%s)", file_size, file_hash[:16])

    # ── 2. Count pages via pikepdf (offloaded — CPU-bound, not async-safe) ─
    try:
        page_count = await asyncio.to_thread(_count_pdf_pages_sync, doc_bytes)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Cannot read PDF structure: {exc}") from exc

    # ── 3. Commit DB records first ───────────────────────────────────────
    new_version_number: int
    s3_key: str

    async with get_db_session() as session:
        # Load by id; the access guard (not the query) enforces owner-or-shared
        # — EXACTLY the same pattern as the editor load endpoint above.
        result = await session.execute(
            select(StoredDocument).where(
                StoredDocument.id == stored_document_id,
                ~StoredDocument.is_deleted,
            )
        )
        stored_doc = result.scalar_one_or_none()

        if not stored_doc:
            raise NotFoundError(f"Stored document not found: {stored_document_id}")

        # Owner-or-shared gate; saving requires an EDIT grant (view-only → 403).
        decision = await authorize_document_access(session, stored_doc, user.user_id)
        if not decision.can_edit:
            raise HTTPException(
                status_code=403,
                detail="You do not have edit access to this document",
            )

        owner_id = stored_doc.owner_id
        new_version_number = stored_doc.current_version + 1
        # Version files live under the OWNER's S3 prefix (symmetric with the
        # load path) so an invited editor's save stays with the document.
        s3_key = s3_service.get_document_key(owner_id, stored_document_id, new_version_number)

        version = DocumentVersion(
            document_id=stored_document_id,
            version_number=new_version_number,
            file_path=s3_key,
            file_size_bytes=file_size,
            file_hash=file_hash,
            comment=comment,
            created_by=user.user_id,
        )
        session.add(version)

        stored_doc.current_version = new_version_number
        stored_doc.page_count = page_count
        stored_doc.file_size_bytes = file_size

        # Re-vectorize from the edited text (best-effort, same transaction):
        # rebuilds full-text + semantic index so search reflects the new
        # version. Skipped when the client did not ship updated text — the
        # previous index then stays as-is. ``ocr_blocks`` are keyed by
        # document_id (unchanged across versions), so this is a clean REPLACE.
        if extracted_text is not None:
            await reindex_document_text(session, stored_document_id, extracted_text)
        # session commits on __aexit__ — version row + updated StoredDocument are durable

    _logger.info(
        "create_version: DB committed (stored_doc_id=%s, version=%d)",
        stored_document_id,
        new_version_number,
    )

    # ── 4. Upload to S3 after DB commit (compensation on failure) ────────
    try:
        s3_service.upload_file(
            file_data=doc_bytes,
            key=s3_key,
            content_type="application/pdf",
            metadata={
                "document_id": stored_document_id,
                # Object metadata mirrors the key prefix (the document OWNER);
                # author_id records who actually saved (may be an edit grantee).
                "user_id": owner_id,
                "author_id": user.user_id,
                "version": str(new_version_number),
            },
        )
        _logger.info(
            "create_version: S3 upload OK (key=%s)", s3_key
        )
    except Exception as exc:
        # Compensation: revert current_version in DB and delete any partial upload.
        _logger.error(
            "create_version: S3 upload failed after DB commit — "
            "compensation: reverting version to %d, deleting s3_key=%s",
            new_version_number - 1,
            s3_key,
            exc_info=True,
        )
        s3_service.delete_file(s3_key)  # best-effort; ignore return value

        # Revert DB: roll back version bump and delete orphan DocumentVersion row.
        try:
            async with get_db_session() as rollback_session:
                result = await rollback_session.execute(
                    select(StoredDocument).where(
                        StoredDocument.id == stored_document_id,
                    )
                )
                stored_doc_rb = result.scalar_one_or_none()
                if stored_doc_rb:
                    stored_doc_rb.current_version = new_version_number - 1

                ver_result = await rollback_session.execute(
                    select(DocumentVersion).where(
                        DocumentVersion.document_id == stored_document_id,
                        DocumentVersion.version_number == new_version_number,
                    )
                )
                orphan_version = ver_result.scalar_one_or_none()
                if orphan_version:
                    await rollback_session.delete(orphan_version)
        except Exception as rb_exc:
            _logger.error(
                "create_version: compensation DB rollback also failed: %s", rb_exc
            )

        raise InvalidOperationError(
            f"Version {new_version_number} committed to database but file upload failed: {exc}"
        ) from exc

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "stored_document_id": stored_document_id,
            "version": new_version_number,
            "created_at": version.created_at.isoformat(),
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.post(
    "/documents/{stored_document_id}/restore-original",
    response_model=APIResponse[dict],
    summary="Restore document to original version (v1)",
    description="""
Restore a stored document to its very first uploaded version (v1).

A new version is created that is a binary-identical copy of v1 and
becomes the new current version. The intermediate versions remain in
the version history (soft, never deleted) so the restore operation is
itself reversible by listing versions and copying any of them forward.

## Why this exists
Before the editor moved to a "PDF native + invisible Fabric overlay"
pipeline (commit 3e13c33), every save baked the parsed Fabric IText
overlays back into the PDF on top of the native glyphs. Successive
saves accumulated duplicates that show up as "shadowed" titles. This
endpoint resets the document to its pristine pre-edit state without
losing version history.

## Behavior
- Downloads v1 binary from S3
- Uploads it as version `current_version + 1` with auto-comment
  "Restored from v1 (original)"
- Sets `current_version = N+1` (existing versions kept intact)
- Returns the new current version metadata
""",
    responses={
        200: {"description": "Document restored to original (v1)"},
        404: {"description": "Stored document or v1 file not found"},
    },
)
async def restore_original(
    stored_document_id: str,
    user: AuthenticatedUser,
) -> APIResponse[dict]:
    """Restore stored document to v1 (original) by copying it forward."""
    start_time = time.time()

    # ── 1. Fetch stored doc + verify ownership ───────────────────────────
    async with get_db_session() as session:
        result = await session.execute(
            select(StoredDocument).where(
                StoredDocument.id == stored_document_id,
                StoredDocument.owner_id == user.user_id,
                ~StoredDocument.is_deleted,
            )
        )
        stored_doc = result.scalar_one_or_none()
        if not stored_doc:
            raise NotFoundError(f"Stored document not found: {stored_document_id}")

        # If already on v1, no-op (still safe to call repeatedly).
        if stored_doc.current_version == 1:
            return APIResponse(
                success=True,
                data={
                    "stored_document_id": stored_document_id,
                    "current_version": 1,
                    "restored_from": 1,
                    "noop": True,
                },
                meta=MetaInfo(
                    request_id=get_request_id(),
                    timestamp=now_utc(),
                    processing_time_ms=int((time.time() - start_time) * 1000),
                ),
            )

    # ── 2. Download v1 binary from S3 ────────────────────────────────────
    v1_key = s3_service.get_document_key(user.user_id, stored_document_id, 1)
    try:
        v1_bytes = s3_service.download_file(v1_key)
    except Exception as exc:
        raise NotFoundError(
            f"Original (v1) file not found in storage: {exc}"
        ) from exc

    if not v1_bytes.startswith(b"%PDF-"):
        raise InvalidOperationError("Stored v1 file is not a valid PDF")

    file_hash = hashlib.sha256(v1_bytes).hexdigest()
    file_size = len(v1_bytes)

    # ── 3. Re-count pages on the v1 binary (defensive: stored_doc.page_count
    #       may have drifted after edits that added/removed pages). ────────
    try:
        page_count = await asyncio.to_thread(_count_pdf_pages_sync, v1_bytes)
    except Exception as exc:
        raise InvalidOperationError(f"Cannot read v1 PDF structure: {exc}") from exc

    # ── 4. Commit DB: bump current_version, insert version row ──────────
    new_version_number: int
    new_s3_key: str
    new_version_created_at: datetime

    async with get_db_session() as session:
        result = await session.execute(
            select(StoredDocument).where(
                StoredDocument.id == stored_document_id,
                StoredDocument.owner_id == user.user_id,
            )
        )
        stored_doc = result.scalar_one_or_none()
        if not stored_doc:
            raise NotFoundError(f"Stored document not found: {stored_document_id}")

        new_version_number = stored_doc.current_version + 1
        new_s3_key = s3_service.get_document_key(
            user.user_id, stored_document_id, new_version_number
        )

        version = DocumentVersion(
            document_id=stored_document_id,
            version_number=new_version_number,
            file_path=new_s3_key,
            file_size_bytes=file_size,
            file_hash=file_hash,
            comment="Restored from v1 (original)",
            created_by=user.user_id,
        )
        session.add(version)

        stored_doc.current_version = new_version_number
        stored_doc.page_count = page_count
        stored_doc.file_size_bytes = file_size
        await session.flush()
        new_version_created_at = version.created_at

    _logger.info(
        "restore_original: DB committed (stored_doc_id=%s, new_version=%d)",
        stored_document_id,
        new_version_number,
    )

    # ── 5. Upload to S3 with compensation on failure ─────────────────────
    try:
        s3_service.upload_file(
            file_data=v1_bytes,
            key=new_s3_key,
            content_type="application/pdf",
            metadata={
                "document_id": stored_document_id,
                "user_id": user.user_id,
                "version": str(new_version_number),
                "restored_from": "1",
            },
        )
    except Exception as exc:
        _logger.error(
            "restore_original: S3 upload failed — compensation: revert to v%d, "
            "delete s3_key=%s",
            new_version_number - 1,
            new_s3_key,
            exc_info=True,
        )
        s3_service.delete_file(new_s3_key)  # best-effort
        try:
            async with get_db_session() as rb:
                rb_doc = (
                    await rb.execute(
                        select(StoredDocument).where(
                            StoredDocument.id == stored_document_id
                        )
                    )
                ).scalar_one_or_none()
                if rb_doc:
                    rb_doc.current_version = new_version_number - 1
                orphan = (
                    await rb.execute(
                        select(DocumentVersion).where(
                            DocumentVersion.document_id == stored_document_id,
                            DocumentVersion.version_number == new_version_number,
                        )
                    )
                ).scalar_one_or_none()
                if orphan:
                    await rb.delete(orphan)
        except Exception as rb_exc:
            _logger.error(
                "restore_original: compensation rollback also failed: %s", rb_exc
            )
        raise InvalidOperationError(
            f"Restore committed to DB but S3 upload failed: {exc}"
        ) from exc

    return APIResponse(
        success=True,
        data={
            "stored_document_id": stored_document_id,
            "current_version": new_version_number,
            "restored_from": 1,
            "created_at": new_version_created_at.isoformat(),
            "page_count": page_count,
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=int((time.time() - start_time) * 1000),
        ),
    )


class UpdateDocumentRequest(BaseModel):
    """Request to update a stored document (rename, tags, extracted text).

    All fields are optional but at least one must be provided.
    """

    name: str | None = Field(
        default=None,
        description="New name for the document",
        min_length=1,
        max_length=255,
    )
    extracted_text: str | None = Field(
        default=None,
        description="Plain text content of the PDF for full-text search "
        "(truncated server-side to 500k characters). Explicit null clears it.",
    )
    tags: list[str] | None = Field(
        default=None,
        description="Replacement tag list (max 20 tags of 50 chars, "
        "normalized lowercase/trim). Empty list clears all tags.",
    )

    @field_validator("tags")
    @classmethod
    def _validate_tags(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        try:
            return _normalize_tags(value)
        except ValueError as exc:
            raise ValueError(str(exc)) from exc

    class Config:
        json_schema_extra = {
            "example": {
                "name": "Q1 Financial Report (final).pdf",
                "extracted_text": "Quarterly results... revenue grew 12% ...",
                "tags": ["finance", "q1", "report"],
            }
        }


# Backwards-compatible alias (historical name of the rename-only request model)
RenameDocumentRequest = UpdateDocumentRequest


@router.patch(
    "/documents/{stored_document_id}",
    response_model=APIResponse[dict],
    summary="Update stored document (rename, tags, extracted text)",
    description="""
Update a document in persistent storage: rename it, replace its tags and/or
refresh its extracted text (full-text search material) after an edit.

All body fields are optional — provide only the ones to change. At least one
field is required. The update is logged in the activity history for audit
purposes.

## Path Parameters
| Parameter | Type | Description |
|-----------|------|-------------|
| stored_document_id | string | UUID of the stored document to update |

## Request Body
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | No | New display name (1-255 characters) |
| extracted_text | string | No | Plain text content for full-text search (truncated to 500k chars, null clears it) |
| tags | string[] | No | Replacement tag list (max 20 tags of 50 chars, normalized lowercase/trim, `[]` clears) |

## Notes
- Renaming does not affect version history
- Updates are recorded in the activity log
- `tags` fully REPLACES the existing tag list
""",
    responses={
        200: {
            "description": "Document renamed successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "stored_document_id": "770e8400-e29b-41d4-a716-446655440002",
                            "name": "Updated Contract 2024",
                            "updated_at": "2024-01-18T12:00:00Z"
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-18T12:00:00Z"}
                    }
                }
            }
        },
        404: {"description": "Stored document not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''curl -X PATCH "https://api.giga-pdf.com/api/v1/storage/documents/770e8400-e29b-41d4-a716-446655440002" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "Updated Contract 2024"}'  '''
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests

stored_doc_id = "770e8400-e29b-41d4-a716-446655440002"
response = requests.patch(
    f"https://api.giga-pdf.com/api/v1/storage/documents/{stored_doc_id}",
    headers={"Authorization": f"Bearer {token}"},
    json={"name": "Updated Contract 2024"}
)

renamed = response.json()["data"]
print(f"Document renamed to: {renamed['name']}")
print(f"Updated at: {renamed['updated_at']}")'''
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const storedDocId = "770e8400-e29b-41d4-a716-446655440002";
const response = await fetch(
  `https://api.giga-pdf.com/api/v1/storage/documents/${storedDocId}`,
  {
    method: "PATCH",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ name: "Updated Contract 2024" })
  }
);

const { data: renamed } = await response.json();
console.log(`Document renamed to: ${renamed.name}`);
console.log(`Updated at: ${renamed.updated_at}`);'''
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '''<?php
$storedDocId = "770e8400-e29b-41d4-a716-446655440002";
$client = new GuzzleHttp\\Client();
$response = $client->patch(
    "https://api.giga-pdf.com/api/v1/storage/documents/{$storedDocId}",
    [
        "headers" => [
            "Authorization" => "Bearer " . $token,
            "Content-Type" => "application/json"
        ],
        "json" => ["name" => "Updated Contract 2024"]
    ]
);

$renamed = json_decode($response->getBody(), true)["data"];
echo "Document renamed to: " . $renamed["name"] . "\\n";
echo "Updated at: " . $renamed["updated_at"] . "\\n";'''
            }
        ]
    },
)
async def update_stored_document(
    stored_document_id: str,
    request: UpdateDocumentRequest,
    user: AuthenticatedUser,
    db: AsyncSession = Depends(get_db),
) -> APIResponse[dict]:
    """Update stored document metadata (name / tags / extracted_text)."""
    start_time = time.time()

    provided_fields = request.model_fields_set
    if not provided_fields:
        raise HTTPException(
            status_code=400,
            detail="At least one of 'name', 'extracted_text' or 'tags' must be provided",
        )
    if "name" in provided_fields and request.name is None:
        raise HTTPException(status_code=400, detail="'name' cannot be null")

    # Get stored document
    result = await db.execute(
        select(StoredDocument).where(
            StoredDocument.id == stored_document_id,
            StoredDocument.owner_id == user.user_id,
            ~StoredDocument.is_deleted,
        )
    )
    stored_doc = result.scalar_one_or_none()

    if not stored_doc:
        raise NotFoundError(f"Stored document not found: {stored_document_id}")

    # Store old name for activity log
    old_name = stored_doc.name
    updated_fields: list[str] = []

    # Apply updates
    if "name" in provided_fields and request.name is not None:
        stored_doc.name = request.name
        updated_fields.append("name")

    if "tags" in provided_fields and request.tags is not None:
        stored_doc.tags = request.tags
        updated_fields.append("tags")

    if "extracted_text" in provided_fields:
        # Re-vectorize on every text change: this updates the full-text material
        # (StoredDocument.extracted_text → search_vector) AND rebuilds the
        # semantic ocr_blocks index from the new text (chunked, REPLACE).
        # Explicit null clears both (empty list purges the previous index).
        # reindex_document_text reloads the row in this session and is
        # best-effort, so a failure here never fails the metadata update.
        await reindex_document_text(db, stored_document_id, request.extracted_text)
        updated_fields.append("extracted_text")

    if not updated_fields:
        raise HTTPException(
            status_code=400,
            detail="At least one of 'name', 'extracted_text' or 'tags' must be provided",
        )

    stored_doc.updated_at = now_utc()
    await db.commit()

    # Log the update activity (RENAME action kept when the name changed,
    # EDIT otherwise — both carry the list of updated fields)
    name_changed = "name" in updated_fields and request.name != old_name
    extra_data: dict = {"updated_fields": updated_fields}
    if name_changed:
        extra_data.update({"old_name": old_name, "new_name": request.name})
    await activity_service.log_activity(
        user_id=user.user_id,
        action=ActivityAction.RENAME if name_changed else ActivityAction.EDIT,
        document_id=stored_document_id,
        user_email=user.email,
        extra_data=extra_data,
    )

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "stored_document_id": stored_document_id,
            "name": stored_doc.name,
            "tags": stored_doc.tags or [],
            "updated_at": stored_doc.updated_at.isoformat(),
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


class OcrBlockBBox(BaseModel):
    """Bounding box of an OCR block in PDF user-space points."""

    x: float = Field(default=0.0, description="Left edge (PDF points)")
    y: float = Field(default=0.0, description="Bottom edge (PDF points, y-up)")
    w: float = Field(default=0.0, description="Width (PDF points)")
    h: float = Field(default=0.0, description="Height (PDF points)")


class OcrBlockIn(BaseModel):
    """One OCR text block to index for semantic search."""

    page: int = Field(ge=0, description="0-based or 1-based page index (stored as-is)")
    text: str = Field(min_length=1, description="OCR text of the block")
    bbox: OcrBlockBBox | None = Field(default=None, description="Block bounding box")

    class Config:
        json_schema_extra = {
            "example": {
                "page": 0,
                "text": "INVOICE N° 2026-0042",
                "bbox": {"x": 72.0, "y": 760.0, "w": 220.0, "h": 18.0},
            }
        }


class IndexOcrBlocksRequest(BaseModel):
    """Request body for (re-)indexing a document's OCR blocks."""

    blocks: list[OcrBlockIn] = Field(
        description="OCR blocks to index (replaces any existing index for the document)",
    )

    class Config:
        json_schema_extra = {
            "example": {
                "blocks": [
                    {
                        "page": 0,
                        "text": "INVOICE N° 2026-0042",
                        "bbox": {"x": 72.0, "y": 760.0, "w": 220.0, "h": 18.0},
                    },
                    {
                        "page": 0,
                        "text": "Total due: 1 250,00 €",
                        "bbox": {"x": 360.0, "y": 120.0, "w": 150.0, "h": 14.0},
                    },
                ]
            }
        }


@router.post(
    "/documents/{stored_document_id}/ocr-blocks",
    response_model=APIResponse[dict],
    summary="Index document OCR blocks for semantic search",
    description="""
Ingest a document's OCR text blocks (page + bounding box + text) and build the
semantic-search index for that document.

The OCR text itself is produced on the TypeScript engine side
(`doc.ocr()` / `doc.ocrText()`); this endpoint receives the structured blocks
and, for each block, computes a 384-d embedding (multilingual model) stored in
pgvector. Queries are answered by `POST /api/v1/search/semantic`.

This operation is an **idempotent replace**: every call clears the document's
previous OCR index and rebuilds it from the provided blocks, so re-indexing an
edited document keeps the index current without duplicates.

Only the document **owner** can index it. If the embedding model is
temporarily unavailable the blocks are still stored (without embeddings) and
become searchable after a later re-index — the call does not fail.

## Request Body
| Field | Type | Description |
|-------|------|-------------|
| blocks | array | OCR blocks: `{ page, text, bbox?: { x, y, w, h } }` |
""",
)
async def index_ocr_blocks(
    stored_document_id: str,
    request: IndexOcrBlocksRequest,
    user: AuthenticatedUser,
    _rl: RateLimitDep,
    db: AsyncSession = Depends(get_db),
) -> APIResponse[dict]:
    """Embed and index a document's OCR blocks (owner-only, idempotent)."""
    start_time = time.time()

    if len(request.blocks) > _MAX_OCR_BLOCKS:
        raise HTTPException(
            status_code=400,
            detail=f"Too many OCR blocks: {len(request.blocks)} (max {_MAX_OCR_BLOCKS})",
        )

    # Ownership check (IDOR): only the owner of a non-trashed document can index it.
    result = await db.execute(
        select(StoredDocument).where(
            StoredDocument.id == stored_document_id,
            StoredDocument.owner_id == user.user_id,
            ~StoredDocument.is_deleted,
        )
    )
    stored_doc = result.scalar_one_or_none()
    if not stored_doc:
        raise NotFoundError(f"Stored document not found: {stored_document_id}")

    # Single positioned-index entry point: stores the geometry-carrying blocks
    # (semantic) AND keeps StoredDocument.extracted_text (keyword search) in sync.
    blocks_payload = [block.model_dump() for block in request.blocks]
    indexed = await reindex_document_blocks(db, stored_document_id, blocks_payload)
    stored_doc.updated_at = now_utc()

    await db.commit()

    processing_time = int((time.time() - start_time) * 1000)
    return APIResponse(
        success=True,
        data={
            "stored_document_id": stored_document_id,
            "blocks_indexed": indexed,
            "semantic_search_available": embedding_service.is_available,
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.delete(
    "/documents/{stored_document_id}",
    response_model=APIResponse[dict],
    summary="Delete stored document (trash or permanent)",
    description="""
Move a document to the trash (soft delete) or delete it permanently.

By default this endpoint performs a **soft delete**: the document is moved to
the trash (`deleted_at` timestamp set) and can be restored with
`POST /documents/{id}/restore`. Trashed documents are excluded from listings,
search, sharing and folder statistics, and are **purged automatically after
30 days**.

With `permanent=true` the document is **permanently deleted**: all version
files and the thumbnail are removed from S3 and the database records are
erased. This works both on active documents and on documents already in the
trash (empty-trash use case). This operation is irreversible.

## Path Parameters
| Parameter | Type | Description |
|-----------|------|-------------|
| stored_document_id | string | UUID of the stored document to delete |

## Query Parameters
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| permanent | boolean | false | If true, permanently delete (S3 files + versions + DB) |

## Behavior
- Soft delete: document moved to trash, restorable for 30 days
- Storage quota is freed when the document leaves the active space
  (soft delete) — a permanent delete of an already-trashed document does
  not free quota twice
- Activity is logged for audit purposes

## Notes
- Quota is adjusted based on source (personal or organization)
- Deleted documents are not returned in default list queries
  (use `GET /documents?trashed=true` to browse the trash)
""",
    responses={
        200: {
            "description": "Document deleted successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "stored_document_id": "770e8400-e29b-41d4-a716-446655440002",
                            "deleted": True,
                            "quota_source": "personal"
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-18T12:30:00Z"}
                    }
                }
            }
        },
        404: {"description": "Stored document not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''curl -X DELETE "https://api.giga-pdf.com/api/v1/storage/documents/770e8400-e29b-41d4-a716-446655440002" \\
  -H "Authorization: Bearer $TOKEN"'''
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests

stored_doc_id = "770e8400-e29b-41d4-a716-446655440002"
response = requests.delete(
    f"https://api.giga-pdf.com/api/v1/storage/documents/{stored_doc_id}",
    headers={"Authorization": f"Bearer {token}"}
)

result = response.json()["data"]
if result["deleted"]:
    print(f"Document {stored_doc_id} deleted")
    print(f"Quota source: {result['quota_source']}")'''
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const storedDocId = "770e8400-e29b-41d4-a716-446655440002";
const response = await fetch(
  `https://api.giga-pdf.com/api/v1/storage/documents/${storedDocId}`,
  {
    method: "DELETE",
    headers: { "Authorization": `Bearer ${token}` }
  }
);

const { data: result } = await response.json();
if (result.deleted) {
  console.log(`Document ${storedDocId} deleted`);
  console.log(`Quota source: ${result.quota_source}`);
}'''
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '''<?php
$storedDocId = "770e8400-e29b-41d4-a716-446655440002";
$client = new GuzzleHttp\\Client();
$response = $client->delete(
    "https://api.giga-pdf.com/api/v1/storage/documents/{$storedDocId}",
    ["headers" => ["Authorization" => "Bearer " . $token]]
);

$result = json_decode($response->getBody(), true)["data"];
if ($result["deleted"]) {
    echo "Document " . $storedDocId . " deleted\\n";
    echo "Quota source: " . $result["quota_source"] . "\\n";
}'''
            }
        ]
    },
)
async def delete_stored_document(
    stored_document_id: str,
    user: AuthenticatedUser,
    permanent: bool = Query(
        default=False,
        description="If true, permanently delete the document (S3 + versions + DB)",
    ),
    db: AsyncSession = Depends(get_db),
) -> APIResponse[dict]:
    """Delete stored document (soft delete by default, hard with permanent=true)."""
    start_time = time.time()
    _logger.info(
        f"Deleting document {stored_document_id} for user {user.user_id} "
        f"(permanent={permanent})"
    )

    try:
        # Get effective limits to determine quota source (tenant or personal)
        effective_limits = await quota_service.get_effective_limits(user.user_id)
    except Exception as e:
        _logger.error(f"Error getting effective limits: {e}", exc_info=True)
        raise

    # Get stored document.
    # Permanent delete also targets documents already in the trash
    # (empty-trash use case); soft delete only targets active documents.
    doc_filter = [
        StoredDocument.id == stored_document_id,
        StoredDocument.owner_id == user.user_id,
    ]
    if not permanent:
        doc_filter.append(~StoredDocument.is_deleted)

    result = await db.execute(select(StoredDocument).where(*doc_filter))
    stored_doc = result.scalar_one_or_none()

    if not stored_doc:
        raise NotFoundError(f"Stored document not found: {stored_document_id}")

    file_size = stored_doc.file_size_bytes or 0
    was_trashed = stored_doc.is_deleted

    if permanent:
        # ── Hard delete: S3 files + versions + DB row ────────────────────
        versions_result = await db.execute(
            select(DocumentVersion.file_path).where(
                DocumentVersion.document_id == stored_document_id
            )
        )
        s3_keys = [row[0] for row in versions_result.all() if row[0]]
        thumbnail_key = stored_doc.thumbnail_path

        # DB first (cascades versions, shares, invitations, activity logs);
        # S3 cleanup after commit is best-effort — an orphan S3 object is
        # recoverable, a dangling DB row pointing to a deleted file is not.
        await db.delete(stored_doc)
        await db.commit()

        for key in s3_keys:
            s3_service.delete_file(key)  # best-effort
        if thumbnail_key:
            s3_service.delete_file(thumbnail_key)  # best-effort
    else:
        # ── Soft delete: move to trash ───────────────────────────────────
        stored_doc.is_deleted = True
        stored_doc.deleted_at = now_utc()
        await db.commit()

    # Update quota (tenant or personal based on membership).
    # The quota was already freed at soft-delete time, so a permanent
    # delete of an already-trashed document must NOT free it twice.
    if not was_trashed and file_size > 0:
        if effective_limits.is_tenant_based and effective_limits.tenant_id:
            await quota_service.update_tenant_storage(
                effective_limits.tenant_id, -file_size, delta_documents=-1
            )
        else:
            await quota_service.update_storage_usage(
                user.user_id, -file_size, delta_documents=-1
            )

    # Log the delete activity.
    # For a permanent delete the document row (and its FK-cascaded activity
    # logs) no longer exists — log without document FK to keep an audit trace.
    await activity_service.log_activity(
        user_id=user.user_id,
        action=ActivityAction.DELETE,
        document_id=None if permanent else stored_document_id,
        user_email=user.email,
        extra_data={
            "file_size_bytes": file_size,
            "permanent": permanent,
            "stored_document_id": stored_document_id,
        },
        tenant_id=effective_limits.tenant_id if effective_limits.is_tenant_based else None,
    )

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "stored_document_id": stored_document_id,
            "deleted": True,
            "permanent": permanent,
            "quota_source": "tenant" if effective_limits.is_tenant_based else "personal",
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.post(
    "/documents/{stored_document_id}/restore",
    response_model=APIResponse[dict],
    summary="Restore document from trash",
    description="""
Restore a trashed (soft-deleted) document back to the active space.

The document becomes visible again in listings, search, sharing and folder
statistics, and the storage quota it occupies is consumed again.

## Path Parameters
| Parameter | Type | Description |
|-----------|------|-------------|
| stored_document_id | string | UUID of the trashed document to restore |

## Errors
- 404: the document does not exist, belongs to another user, or is NOT in
  the trash
""",
    responses={
        200: {
            "description": "Document restored successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "stored_document_id": "770e8400-e29b-41d4-a716-446655440002",
                            "name": "Contract Agreement 2024",
                            "restored": True,
                            "quota_source": "personal",
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-18T15:00:00Z"},
                    }
                }
            },
        },
        404: {"description": "Document not found in trash"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''curl -X POST "https://api.giga-pdf.com/api/v1/storage/documents/770e8400-e29b-41d4-a716-446655440002/restore" \\
  -H "Authorization: Bearer $TOKEN"'''
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests

stored_doc_id = "770e8400-e29b-41d4-a716-446655440002"
response = requests.post(
    f"https://api.giga-pdf.com/api/v1/storage/documents/{stored_doc_id}/restore",
    headers={"Authorization": f"Bearer {token}"}
)

result = response.json()["data"]
print(f"Restored: {result['name']}")'''
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const storedDocId = "770e8400-e29b-41d4-a716-446655440002";
const response = await fetch(
  `https://api.giga-pdf.com/api/v1/storage/documents/${storedDocId}/restore`,
  {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}` }
  }
);

const { data: result } = await response.json();
console.log(`Restored: ${result.name}`);'''
            },
        ]
    },
)
async def restore_stored_document(
    stored_document_id: str,
    user: AuthenticatedUser,
    db: AsyncSession = Depends(get_db),
) -> APIResponse[dict]:
    """Restore a soft-deleted document from the trash."""
    start_time = time.time()

    effective_limits = await quota_service.get_effective_limits(user.user_id)

    # Only documents currently in the trash can be restored
    result = await db.execute(
        select(StoredDocument).where(
            StoredDocument.id == stored_document_id,
            StoredDocument.owner_id == user.user_id,
            StoredDocument.is_deleted,
        )
    )
    stored_doc = result.scalar_one_or_none()

    if not stored_doc:
        raise NotFoundError(f"Document not found in trash: {stored_document_id}")

    file_size = stored_doc.file_size_bytes or 0

    # Restore
    stored_doc.is_deleted = False
    stored_doc.deleted_at = None
    stored_doc.updated_at = now_utc()
    await db.commit()

    # Re-consume the quota that was freed at soft-delete time
    if file_size > 0:
        if effective_limits.is_tenant_based and effective_limits.tenant_id:
            await quota_service.update_tenant_storage(
                effective_limits.tenant_id, file_size, delta_documents=1
            )
        else:
            await quota_service.update_storage_usage(
                user.user_id, file_size, delta_documents=1
            )

    # Log the restore activity
    await activity_service.log_activity(
        user_id=user.user_id,
        action=ActivityAction.RESTORE,
        document_id=stored_document_id,
        user_email=user.email,
        extra_data={"file_size_bytes": file_size},
        tenant_id=effective_limits.tenant_id if effective_limits.is_tenant_based else None,
    )

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "stored_document_id": stored_document_id,
            "name": stored_doc.name,
            "restored": True,
            "quota_source": "tenant" if effective_limits.is_tenant_based else "personal",
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.post(
    "/documents/{stored_document_id}/thumbnail",
    response_model=APIResponse[dict],
    summary="Upload document thumbnail",
    description="""
Upload (or replace) the thumbnail image of a stored document.

The frontend renders the first page of the PDF and uploads the resulting
image here. The image is stored on S3 under the `thumbnails/` prefix and a
presigned URL is exposed as `thumbnail_url` in document listings.

## Path Parameters
| Parameter | Type | Description |
|-----------|------|-------------|
| stored_document_id | string | UUID of the stored document |

## Multipart Form Fields
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| file | file | Yes | Image bytes — PNG, JPEG or WebP, max 2 MB (magic bytes validated) |

## Behavior
- Re-uploading replaces the previous thumbnail
- The returned `thumbnail_url` is a presigned URL valid 7 days; listings
  always return a fresh one

## Errors
- 400: file too large (> 2 MB) or not a PNG/JPEG/WebP image
- 404: document not found (or trashed)
""",
    responses={
        200: {
            "description": "Thumbnail uploaded successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "thumbnail_url": "https://s3.fr-par.scw.cloud/bucket/thumbnails/user/doc.png?X-Amz-..."
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-18T15:30:00Z"},
                    }
                }
            },
        },
        400: {"description": "Invalid image (format or size)"},
        404: {"description": "Stored document not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''curl -X POST "https://api.giga-pdf.com/api/v1/storage/documents/770e8400-e29b-41d4-a716-446655440002/thumbnail" \\
  -H "Authorization: Bearer $TOKEN" \\
  -F "file=@thumbnail.png;type=image/png"'''
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests

stored_doc_id = "770e8400-e29b-41d4-a716-446655440002"
with open("thumbnail.png", "rb") as f:
    response = requests.post(
        f"https://api.giga-pdf.com/api/v1/storage/documents/{stored_doc_id}/thumbnail",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": ("thumbnail.png", f, "image/png")},
    )

print(response.json()["data"]["thumbnail_url"])'''
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const formData = new FormData();
formData.append("file", thumbnailBlob, "thumbnail.png");

const response = await fetch(
  `https://api.giga-pdf.com/api/v1/storage/documents/${storedDocId}/thumbnail`,
  {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}` },
    body: formData,
  }
);

const { data } = await response.json();
console.log(data.thumbnail_url);'''
            },
        ]
    },
)
async def upload_document_thumbnail(
    stored_document_id: str,
    user: AuthenticatedUser,
    file: UploadFile = File(..., description="Thumbnail image (PNG/JPEG/WebP, max 2 MB)"),
    db: AsyncSession = Depends(get_db),
) -> APIResponse[dict]:
    """Upload or replace the thumbnail of a stored document."""
    start_time = time.time()

    # ── 1. Read + validate image bytes (size + magic bytes) ──────────────
    image_bytes = await file.read()

    if len(image_bytes) > _THUMBNAIL_MAX_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"Thumbnail too large: {len(image_bytes)} bytes "
            f"(limit: {_THUMBNAIL_MAX_BYTES} bytes)",
        )

    detected = _detect_thumbnail_format(image_bytes)
    if detected is None:
        raise HTTPException(
            status_code=400,
            detail="Invalid thumbnail format: PNG, JPEG or WebP required "
            "(magic bytes validation failed)",
        )
    extension, content_type = detected

    # ── 2. Ownership check ───────────────────────────────────────────────
    result = await db.execute(
        select(StoredDocument).where(
            StoredDocument.id == stored_document_id,
            StoredDocument.owner_id == user.user_id,
            ~StoredDocument.is_deleted,
        )
    )
    stored_doc = result.scalar_one_or_none()

    if not stored_doc:
        raise NotFoundError(f"Stored document not found: {stored_document_id}")

    # ── 3. Upload to S3 (deterministic key — re-upload overwrites) ───────
    thumbnail_key = s3_service.get_thumbnail_key(
        user.user_id, stored_document_id, extension
    )
    old_key = stored_doc.thumbnail_path

    try:
        s3_service.upload_file(
            file_data=image_bytes,
            key=thumbnail_key,
            content_type=content_type,
            metadata={"document_id": stored_document_id, "user_id": user.user_id},
        )
    except Exception as exc:
        _logger.error(
            "thumbnail: S3 upload failed (key=%s)", thumbnail_key, exc_info=True
        )
        raise InvalidOperationError(f"Thumbnail upload failed: {exc}") from exc

    # If the extension changed (e.g. png → webp), drop the stale object
    if old_key and old_key != thumbnail_key:
        s3_service.delete_file(old_key)  # best-effort

    # ── 4. Persist the S3 key (serializers expose a presigned URL) ───────
    stored_doc.thumbnail_path = thumbnail_key
    stored_doc.updated_at = now_utc()
    await db.commit()

    # Log the thumbnail update
    await activity_service.log_activity(
        user_id=user.user_id,
        action=ActivityAction.EDIT,
        document_id=stored_document_id,
        user_email=user.email,
        extra_data={"updated_fields": ["thumbnail"], "thumbnail_key": thumbnail_key},
    )

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={"thumbnail_url": _thumbnail_url_for(thumbnail_key)},
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.get(
    "/folders",
    response_model=APIResponse[dict],
    summary="List folders",
    description="""
List all folders for the authenticated user.

Returns a flat list of all folders with parent_id relationships that can be used to build a tree structure. Folders are ordered by path for easier hierarchical display.

## Response Structure
- **folders**: Array of folder objects
  - folder_id: Unique folder identifier
  - name: Folder display name
  - parent_id: Parent folder UUID (null for root folders)
  - path: Full path string for hierarchy
  - created_at: ISO 8601 creation timestamp

## Building a Folder Tree
Use parent_id relationships to construct the folder hierarchy. Root folders have parent_id = null.
""",
    responses={
        200: {
            "description": "Folders retrieved successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "folders": [
                                {
                                    "folder_id": "660e8400-e29b-41d4-a716-446655440001",
                                    "name": "Legal Documents",
                                    "parent_id": None,
                                    "path": "/",
                                    "created_at": "2024-01-10T08:00:00Z"
                                },
                                {
                                    "folder_id": "660e8400-e29b-41d4-a716-446655440002",
                                    "name": "Contracts",
                                    "parent_id": "660e8400-e29b-41d4-a716-446655440001",
                                    "path": "/660e8400-e29b-41d4-a716-446655440001/",
                                    "created_at": "2024-01-10T08:15:00Z"
                                }
                            ]
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-15T10:30:00Z"}
                    }
                }
            }
        },
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''curl -X GET "https://api.giga-pdf.com/api/v1/storage/folders" \\
  -H "Authorization: Bearer $TOKEN"'''
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests

response = requests.get(
    "https://api.giga-pdf.com/api/v1/storage/folders",
    headers={"Authorization": f"Bearer {token}"}
)

folders = response.json()["data"]["folders"]

# Build folder tree
root_folders = [f for f in folders if f["parent_id"] is None]
for folder in root_folders:
    print(f"/{folder['name']}")
    children = [f for f in folders if f["parent_id"] == folder["folder_id"]]
    for child in children:
        print(f"  /{child['name']}")'''
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const response = await fetch("https://api.giga-pdf.com/api/v1/storage/folders", {
  method: "GET",
  headers: { "Authorization": `Bearer ${token}` }
});

const { data: { folders } } = await response.json();

// Build folder tree
const rootFolders = folders.filter(f => f.parent_id === null);
rootFolders.forEach(folder => {
  console.log(`/${folder.name}`);
  const children = folders.filter(f => f.parent_id === folder.folder_id);
  children.forEach(child => {
    console.log(`  /${child.name}`);
  });
});'''
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '''<?php
$client = new GuzzleHttp\\Client();
$response = $client->get("https://api.giga-pdf.com/api/v1/storage/folders", [
    "headers" => ["Authorization" => "Bearer " . $token]
]);

$folders = json_decode($response->getBody(), true)["data"]["folders"];

// Build folder tree
$rootFolders = array_filter($folders, fn($f) => $f["parent_id"] === null);
foreach ($rootFolders as $folder) {
    echo "/" . $folder["name"] . "\\n";
    $children = array_filter($folders, fn($f) => $f["parent_id"] === $folder["folder_id"]);
    foreach ($children as $child) {
        echo "  /" . $child["name"] . "\\n";
    }
}'''
            }
        ]
    },
)
async def list_folders(
    user: AuthenticatedUser,
    db: AsyncSession = Depends(get_db),
) -> APIResponse[dict]:
    """List user folders."""
    start_time = time.time()

    result = await db.execute(
        select(Folder).where(
            Folder.owner_id == user.user_id
        ).order_by(Folder.path)
    )
    folders = result.scalars().all()

    folder_list = []
    for folder in folders:
        folder_list.append({
            "folder_id": folder.id,
            "name": folder.name,
            "parent_id": folder.parent_id,
            "path": folder.path,
            "created_at": folder.created_at.isoformat(),
        })

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={"folders": folder_list},
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.post(
    "/folders",
    response_model=APIResponse[dict],
    status_code=201,
    summary="Create folder",
    description="""
Create a new folder for organizing documents.

Folders can be nested to create a hierarchical structure. The path is automatically calculated based on the parent folder.

## Request Body
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | Yes | Folder name (1-255 characters) |
| parent_id | string | No | Parent folder UUID (null for root) |

## Path Calculation
- Root folders have path = "/"
- Nested folders have path = "{parent_path}{parent_id}/"
""",
    responses={
        201: {
            "description": "Folder created successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "folder_id": "660e8400-e29b-41d4-a716-446655440003",
                            "name": "Legal Documents",
                            "parent_id": None,
                            "path": "/",
                            "created_at": "2024-01-18T13:00:00Z"
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-18T13:00:00Z"}
                    }
                }
            }
        },
        404: {"description": "Parent folder not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''# Create root folder
curl -X POST "https://api.giga-pdf.com/api/v1/storage/folders" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "Legal Documents"}'

# Create nested folder
curl -X POST "https://api.giga-pdf.com/api/v1/storage/folders" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "Contracts", "parent_id": "660e8400-e29b-41d4-a716-446655440001"}' '''
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests

# Create root folder
response = requests.post(
    "https://api.giga-pdf.com/api/v1/storage/folders",
    headers={"Authorization": f"Bearer {token}"},
    json={"name": "Legal Documents"}
)
root_folder = response.json()["data"]
print(f"Created folder: {root_folder['folder_id']}")

# Create nested folder
response = requests.post(
    "https://api.giga-pdf.com/api/v1/storage/folders",
    headers={"Authorization": f"Bearer {token}"},
    json={"name": "Contracts", "parent_id": root_folder["folder_id"]}
)
nested_folder = response.json()["data"]
print(f"Created nested folder: {nested_folder['path']}")'''
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''// Create root folder
let response = await fetch("https://api.giga-pdf.com/api/v1/storage/folders", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ name: "Legal Documents" })
});
const rootFolder = (await response.json()).data;
console.log(`Created folder: ${rootFolder.folder_id}`);

// Create nested folder
response = await fetch("https://api.giga-pdf.com/api/v1/storage/folders", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ name: "Contracts", parent_id: rootFolder.folder_id })
});
const nestedFolder = (await response.json()).data;
console.log(`Created nested folder: ${nestedFolder.path}`);'''
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '''<?php
$client = new GuzzleHttp\\Client();

// Create root folder
$response = $client->post("https://api.giga-pdf.com/api/v1/storage/folders", [
    "headers" => [
        "Authorization" => "Bearer " . $token,
        "Content-Type" => "application/json"
    ],
    "json" => ["name" => "Legal Documents"]
]);
$rootFolder = json_decode($response->getBody(), true)["data"];
echo "Created folder: " . $rootFolder["folder_id"] . "\\n";

// Create nested folder
$response = $client->post("https://api.giga-pdf.com/api/v1/storage/folders", [
    "headers" => [
        "Authorization" => "Bearer " . $token,
        "Content-Type" => "application/json"
    ],
    "json" => ["name" => "Contracts", "parent_id" => $rootFolder["folder_id"]]
]);
$nestedFolder = json_decode($response->getBody(), true)["data"];
echo "Created nested folder: " . $nestedFolder["path"] . "\\n";'''
            }
        ]
    },
)
async def create_folder(
    request: CreateFolderRequest,
    user: AuthenticatedUser,
    db: AsyncSession = Depends(get_db),
) -> APIResponse[dict]:
    """Create a new folder."""
    start_time = time.time()

    # Calculate path
    if request.parent_id:
        result = await db.execute(
            select(Folder).where(
                Folder.id == request.parent_id,
                Folder.owner_id == user.user_id,
            )
        )
        parent = result.scalar_one_or_none()
        if not parent:
            raise NotFoundError(f"Parent folder not found: {request.parent_id}")
        path = f"{parent.path}{parent.id}/"
    else:
        path = "/"

    # Create folder
    folder_id = generate_uuid()
    created_at = now_utc()
    folder = Folder(
        id=folder_id,
        name=request.name,
        owner_id=user.user_id,
        parent_id=request.parent_id,
        path=path,
        created_at=created_at,
    )
    db.add(folder)
    await db.commit()

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "folder_id": folder_id,
            "name": request.name,
            "parent_id": request.parent_id,
            "path": path,
            "created_at": created_at.isoformat(),
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


class RenameFolderRequest(BaseModel):
    """Request to rename a folder."""

    name: str = Field(
        description="New folder name",
        min_length=1,
        max_length=255,
    )

    class Config:
        json_schema_extra = {"example": {"name": "Archived invoices"}}


@router.patch(
    "/folders/{folder_id}",
    response_model=APIResponse[dict],
    summary="Rename folder",
    description="""
Rename a folder.

The new name must not already be used by another folder of the same parent
(sibling uniqueness) — a 409 Conflict is returned otherwise.

## Path Parameters
| Parameter | Type | Description |
|-----------|------|-------------|
| folder_id | string | UUID of the folder to rename |

## Request Body
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | Yes | New folder name (1-255 characters) |

## Errors
- 404: folder not found or owned by another user
- 409: a sibling folder already uses this name
""",
    responses={
        200: {
            "description": "Folder renamed successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "folder_id": "660e8400-e29b-41d4-a716-446655440001",
                            "name": "Contrats 2024",
                            "parent_id": None,
                            "path": "/",
                            "created_at": "2024-01-10T08:00:00Z",
                            "updated_at": "2024-01-18T16:00:00Z",
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-18T16:00:00Z"},
                    }
                }
            },
        },
        404: {"description": "Folder not found"},
        409: {"description": "A sibling folder already uses this name"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''curl -X PATCH "https://api.giga-pdf.com/api/v1/storage/folders/660e8400-e29b-41d4-a716-446655440001" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "Contrats 2024"}' '''
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests

folder_id = "660e8400-e29b-41d4-a716-446655440001"
response = requests.patch(
    f"https://api.giga-pdf.com/api/v1/storage/folders/{folder_id}",
    headers={"Authorization": f"Bearer {token}"},
    json={"name": "Contrats 2024"},
)

if response.status_code == 409:
    print("Name already taken in this parent folder")
else:
    folder = response.json()["data"]
    print(f"Folder renamed to: {folder['name']}")'''
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const folderId = "660e8400-e29b-41d4-a716-446655440001";
const response = await fetch(
  `https://api.giga-pdf.com/api/v1/storage/folders/${folderId}`,
  {
    method: "PATCH",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ name: "Contrats 2024" })
  }
);

if (response.status === 409) {
  console.warn("Name already taken in this parent folder");
} else {
  const { data: folder } = await response.json();
  console.log(`Folder renamed to: ${folder.name}`);
}'''
            },
        ]
    },
)
async def rename_folder(
    folder_id: str,
    request: RenameFolderRequest,
    user: AuthenticatedUser,
    db: AsyncSession = Depends(get_db),
) -> APIResponse[dict]:
    """Rename a folder (409 if the name is already taken in the same parent)."""
    start_time = time.time()

    # Get folder (ownership check)
    result = await db.execute(
        select(Folder).where(
            Folder.id == folder_id,
            Folder.owner_id == user.user_id,
        )
    )
    folder = result.scalar_one_or_none()

    if not folder:
        raise NotFoundError(f"Folder not found: {folder_id}")

    # Sibling uniqueness: same owner + same parent + same name → 409
    sibling_filter = [
        Folder.owner_id == user.user_id,
        Folder.id != folder_id,
        Folder.name == request.name,
    ]
    if folder.parent_id is None:
        sibling_filter.append(Folder.parent_id.is_(None))
    else:
        sibling_filter.append(Folder.parent_id == folder.parent_id)

    conflict_result = await db.execute(
        select(func.count()).select_from(Folder).where(*sibling_filter)
    )
    if (conflict_result.scalar() or 0) > 0:
        raise HTTPException(
            status_code=409,
            detail=f"A folder named '{request.name}' already exists in this location",
        )

    # Rename
    old_name = folder.name
    folder.name = request.name
    folder.updated_at = now_utc()
    await db.commit()

    # Log the rename activity (folder resource)
    await activity_service.log_activity(
        user_id=user.user_id,
        action=ActivityAction.RENAME,
        document_id=None,
        user_email=user.email,
        resource_type="folder",
        extra_data={
            "folder_id": folder_id,
            "old_name": old_name,
            "new_name": request.name,
        },
    )

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "folder_id": folder_id,
            "name": folder.name,
            "parent_id": folder.parent_id,
            "path": folder.path,
            "created_at": folder.created_at.isoformat(),
            "updated_at": folder.updated_at.isoformat(),
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.delete(
    "/folders/{folder_id}",
    response_model=APIResponse[dict],
    summary="Delete folder",
    description="""
Delete a folder and optionally its contents.

By default, folders containing documents cannot be deleted (returns 400 error). Use the cascade parameter to soft-delete all documents within the folder along with the folder itself.

## Path Parameters
| Parameter | Type | Description |
|-----------|------|-------------|
| folder_id | string | UUID of the folder to delete |

## Query Parameters
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| cascade | boolean | false | If true, soft-delete all documents in folder |

## Behavior
- Without cascade: Fails if folder contains documents
- With cascade: Soft-deletes all documents, then deletes folder
- Child folders are also deleted (SQL cascade)
""",
    responses={
        200: {
            "description": "Folder deleted successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "folder_id": "660e8400-e29b-41d4-a716-446655440001",
                            "deleted": True
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-18T13:30:00Z"}
                    }
                }
            }
        },
        400: {"description": "Folder not empty (use cascade=true to delete contents)"},
        404: {"description": "Folder not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''# Delete empty folder
curl -X DELETE "https://api.giga-pdf.com/api/v1/storage/folders/660e8400-e29b-41d4-a716-446655440001" \\
  -H "Authorization: Bearer $TOKEN"

# Delete folder with contents
curl -X DELETE "https://api.giga-pdf.com/api/v1/storage/folders/660e8400-e29b-41d4-a716-446655440001?cascade=true" \\
  -H "Authorization: Bearer $TOKEN"'''
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests

folder_id = "660e8400-e29b-41d4-a716-446655440001"

# Try to delete folder
response = requests.delete(
    f"https://api.giga-pdf.com/api/v1/storage/folders/{folder_id}",
    headers={"Authorization": f"Bearer {token}"}
)

if response.status_code == 400:
    # Folder not empty, retry with cascade
    response = requests.delete(
        f"https://api.giga-pdf.com/api/v1/storage/folders/{folder_id}",
        params={"cascade": True},
        headers={"Authorization": f"Bearer {token}"}
    )

result = response.json()["data"]
print(f"Folder deleted: {result['deleted']}")'''
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const folderId = "660e8400-e29b-41d4-a716-446655440001";

// Try to delete folder
let response = await fetch(
  `https://api.giga-pdf.com/api/v1/storage/folders/${folderId}`,
  {
    method: "DELETE",
    headers: { "Authorization": `Bearer ${token}` }
  }
);

if (response.status === 400) {
  // Folder not empty, retry with cascade
  response = await fetch(
    `https://api.giga-pdf.com/api/v1/storage/folders/${folderId}?cascade=true`,
    {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${token}` }
    }
  );
}

const { data: result } = await response.json();
console.log(`Folder deleted: ${result.deleted}`);'''
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '''<?php
$folderId = "660e8400-e29b-41d4-a716-446655440001";
$client = new GuzzleHttp\\Client();

try {
    // Try to delete folder
    $response = $client->delete(
        "https://api.giga-pdf.com/api/v1/storage/folders/{$folderId}",
        ["headers" => ["Authorization" => "Bearer " . $token]]
    );
} catch (GuzzleHttp\\Exception\\ClientException $e) {
    if ($e->getResponse()->getStatusCode() === 400) {
        // Folder not empty, retry with cascade
        $response = $client->delete(
            "https://api.giga-pdf.com/api/v1/storage/folders/{$folderId}",
            [
                "headers" => ["Authorization" => "Bearer " . $token],
                "query" => ["cascade" => true]
            ]
        );
    }
}

$result = json_decode($response->getBody(), true)["data"];
echo "Folder deleted: " . ($result["deleted"] ? "true" : "false") . "\\n";'''
            }
        ]
    },
)
async def delete_folder(
    folder_id: str,
    user: AuthenticatedUser,
    cascade: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
) -> APIResponse[dict]:
    """Delete folder."""
    start_time = time.time()

    # Get folder
    result = await db.execute(
        select(Folder).where(
            Folder.id == folder_id,
            Folder.owner_id == user.user_id,
        )
    )
    folder = result.scalar_one_or_none()

    if not folder:
        raise NotFoundError(f"Folder not found: {folder_id}")

    # Check if folder has documents
    count_result = await db.execute(
        select(func.count()).select_from(StoredDocument).where(
            StoredDocument.folder_id == folder_id,
            ~StoredDocument.is_deleted,
        )
    )
    doc_count = count_result.scalar() or 0

    if doc_count > 0 and not cascade:
        raise InvalidOperationError(
            f"Folder contains {doc_count} documents. Use cascade=true to delete all."
        )

    # Delete documents if cascade
    if cascade:
        docs_result = await db.execute(
            select(StoredDocument).where(
                StoredDocument.folder_id == folder_id
            )
        )
        docs = docs_result.scalars().all()
        for doc in docs:
            doc.is_deleted = True
            doc.deleted_at = now_utc()

    # Delete folder (cascade delete children via SQLAlchemy relationship)
    await db.delete(folder)
    await db.commit()

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "folder_id": folder_id,
            "deleted": True,
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


class MoveDocumentRequest(BaseModel):
    """Request to move a document to a folder."""

    folder_id: str | None = Field(
        default=None,
        description="Target folder ID (null for root)",
    )

    class Config:
        json_schema_extra = {
            "example": {"folder_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6"}
        }


@router.patch(
    "/documents/{stored_document_id}/move",
    response_model=APIResponse[dict],
    summary="Move document to folder",
    description="""
Move a document to a different folder.

This endpoint allows reorganizing documents by moving them between folders. The move operation is logged in the activity history for audit purposes.

## Path Parameters
| Parameter | Type | Description |
|-----------|------|-------------|
| stored_document_id | string | UUID of the document to move |

## Request Body
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| folder_id | string | No | Target folder UUID (null to move to root) |

## Notes
- Moving to root: set folder_id to null
- Activity is logged with old and new folder IDs
""",
    responses={
        200: {
            "description": "Document moved successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "stored_document_id": "770e8400-e29b-41d4-a716-446655440002",
                            "folder_id": "660e8400-e29b-41d4-a716-446655440001",
                            "moved": True
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-18T14:00:00Z"}
                    }
                }
            }
        },
        404: {"description": "Document or folder not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''# Move to folder
curl -X PATCH "https://api.giga-pdf.com/api/v1/storage/documents/770e8400-e29b-41d4-a716-446655440002/move" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"folder_id": "660e8400-e29b-41d4-a716-446655440001"}'

# Move to root
curl -X PATCH "https://api.giga-pdf.com/api/v1/storage/documents/770e8400-e29b-41d4-a716-446655440002/move" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"folder_id": null}' '''
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests

doc_id = "770e8400-e29b-41d4-a716-446655440002"
target_folder = "660e8400-e29b-41d4-a716-446655440001"

response = requests.patch(
    f"https://api.giga-pdf.com/api/v1/storage/documents/{doc_id}/move",
    headers={"Authorization": f"Bearer {token}"},
    json={"folder_id": target_folder}
)

result = response.json()["data"]
print(f"Document moved to folder: {result['folder_id']}")

# Move to root
response = requests.patch(
    f"https://api.giga-pdf.com/api/v1/storage/documents/{doc_id}/move",
    headers={"Authorization": f"Bearer {token}"},
    json={"folder_id": None}
)'''
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const docId = "770e8400-e29b-41d4-a716-446655440002";
const targetFolder = "660e8400-e29b-41d4-a716-446655440001";

const response = await fetch(
  `https://api.giga-pdf.com/api/v1/storage/documents/${docId}/move`,
  {
    method: "PATCH",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ folder_id: targetFolder })
  }
);

const { data: result } = await response.json();
console.log(`Document moved to folder: ${result.folder_id}`);

// Move to root
await fetch(`https://api.giga-pdf.com/api/v1/storage/documents/${docId}/move`, {
  method: "PATCH",
  headers: {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ folder_id: null })
});'''
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '''<?php
$docId = "770e8400-e29b-41d4-a716-446655440002";
$targetFolder = "660e8400-e29b-41d4-a716-446655440001";
$client = new GuzzleHttp\\Client();

$response = $client->patch(
    "https://api.giga-pdf.com/api/v1/storage/documents/{$docId}/move",
    [
        "headers" => [
            "Authorization" => "Bearer " . $token,
            "Content-Type" => "application/json"
        ],
        "json" => ["folder_id" => $targetFolder]
    ]
);

$result = json_decode($response->getBody(), true)["data"];
echo "Document moved to folder: " . $result["folder_id"] . "\\n";

// Move to root
$client->patch(
    "https://api.giga-pdf.com/api/v1/storage/documents/{$docId}/move",
    [
        "headers" => [
            "Authorization" => "Bearer " . $token,
            "Content-Type" => "application/json"
        ],
        "json" => ["folder_id" => null]
    ]
);'''
            }
        ]
    },
)
async def move_document(
    stored_document_id: str,
    request: MoveDocumentRequest,
    user: AuthenticatedUser,
    db: AsyncSession = Depends(get_db),
) -> APIResponse[dict]:
    """Move document to a folder."""
    start_time = time.time()

    # Get document
    result = await db.execute(
        select(StoredDocument).where(
            StoredDocument.id == stored_document_id,
            StoredDocument.owner_id == user.user_id,
            ~StoredDocument.is_deleted,
        )
    )
    document = result.scalar_one_or_none()

    if not document:
        raise NotFoundError(f"Document not found: {stored_document_id}")

    # Verify target folder exists (if provided)
    if request.folder_id:
        folder_result = await db.execute(
            select(Folder).where(
                Folder.id == request.folder_id,
                Folder.owner_id == user.user_id,
            )
        )
        folder = folder_result.scalar_one_or_none()
        if not folder:
            raise NotFoundError(f"Folder not found: {request.folder_id}")

    # Move document
    old_folder_id = document.folder_id
    document.folder_id = request.folder_id
    document.updated_at = now_utc()
    await db.commit()

    # Log the move activity
    await activity_service.log_activity(
        user_id=user.user_id,
        action=ActivityAction.MOVE,
        document_id=stored_document_id,
        user_email=user.email,
        extra_data={"old_folder_id": old_folder_id, "new_folder_id": request.folder_id},
    )

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "stored_document_id": stored_document_id,
            "folder_id": request.folder_id,
            "moved": True,
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


class MoveFolderRequest(BaseModel):
    """Request to move a folder to another folder."""

    parent_id: str | None = Field(
        default=None,
        description="Target parent folder ID (null for root)",
    )

    class Config:
        json_schema_extra = {
            "example": {"parent_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6"}
        }


@router.patch(
    "/folders/{folder_id}/move",
    response_model=APIResponse[dict],
    summary="Move folder to another folder",
    description="""
Move a folder to a different parent folder.

This endpoint allows reorganizing the folder hierarchy by moving folders. All descendant folders and their paths are automatically updated.

## Path Parameters
| Parameter | Type | Description |
|-----------|------|-------------|
| folder_id | string | UUID of the folder to move |

## Request Body
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| parent_id | string | No | Target parent folder UUID (null for root) |

## Validation Rules
- Cannot move a folder into itself
- Cannot move a folder into one of its descendants (circular reference)

## Notes
- All descendant folder paths are automatically updated
- Moving to root: set parent_id to null
""",
    responses={
        200: {
            "description": "Folder moved successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "folder_id": "660e8400-e29b-41d4-a716-446655440002",
                            "parent_id": "660e8400-e29b-41d4-a716-446655440001",
                            "path": "/660e8400-e29b-41d4-a716-446655440001/",
                            "moved": True
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-18T14:30:00Z"}
                    }
                }
            }
        },
        400: {"description": "Cannot move folder into itself or its descendant"},
        404: {"description": "Folder or target parent not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''# Move to parent folder
curl -X PATCH "https://api.giga-pdf.com/api/v1/storage/folders/660e8400-e29b-41d4-a716-446655440002/move" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"parent_id": "660e8400-e29b-41d4-a716-446655440001"}'

# Move to root
curl -X PATCH "https://api.giga-pdf.com/api/v1/storage/folders/660e8400-e29b-41d4-a716-446655440002/move" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"parent_id": null}' '''
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests

folder_id = "660e8400-e29b-41d4-a716-446655440002"
target_parent = "660e8400-e29b-41d4-a716-446655440001"

response = requests.patch(
    f"https://api.giga-pdf.com/api/v1/storage/folders/{folder_id}/move",
    headers={"Authorization": f"Bearer {token}"},
    json={"parent_id": target_parent}
)

result = response.json()["data"]
print(f"Folder moved to: {result['path']}")

# Move to root
response = requests.patch(
    f"https://api.giga-pdf.com/api/v1/storage/folders/{folder_id}/move",
    headers={"Authorization": f"Bearer {token}"},
    json={"parent_id": None}
)'''
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const folderId = "660e8400-e29b-41d4-a716-446655440002";
const targetParent = "660e8400-e29b-41d4-a716-446655440001";

const response = await fetch(
  `https://api.giga-pdf.com/api/v1/storage/folders/${folderId}/move`,
  {
    method: "PATCH",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ parent_id: targetParent })
  }
);

const { data: result } = await response.json();
console.log(`Folder moved to: ${result.path}`);

// Move to root
await fetch(`https://api.giga-pdf.com/api/v1/storage/folders/${folderId}/move`, {
  method: "PATCH",
  headers: {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ parent_id: null })
});'''
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '''<?php
$folderId = "660e8400-e29b-41d4-a716-446655440002";
$targetParent = "660e8400-e29b-41d4-a716-446655440001";
$client = new GuzzleHttp\\Client();

$response = $client->patch(
    "https://api.giga-pdf.com/api/v1/storage/folders/{$folderId}/move",
    [
        "headers" => [
            "Authorization" => "Bearer " . $token,
            "Content-Type" => "application/json"
        ],
        "json" => ["parent_id" => $targetParent]
    ]
);

$result = json_decode($response->getBody(), true)["data"];
echo "Folder moved to: " . $result["path"] . "\\n";

// Move to root
$client->patch(
    "https://api.giga-pdf.com/api/v1/storage/folders/{$folderId}/move",
    [
        "headers" => [
            "Authorization" => "Bearer " . $token,
            "Content-Type" => "application/json"
        ],
        "json" => ["parent_id" => null]
    ]
);'''
            }
        ]
    },
)
async def move_folder(
    folder_id: str,
    request: MoveFolderRequest,
    user: AuthenticatedUser,
    db: AsyncSession = Depends(get_db),
) -> APIResponse[dict]:
    """Move folder to another folder."""
    start_time = time.time()

    # Can't move folder into itself
    if folder_id == request.parent_id:
        raise InvalidOperationError("Cannot move folder into itself")

    # Get folder to move
    result = await db.execute(
        select(Folder).where(
            Folder.id == folder_id,
            Folder.owner_id == user.user_id,
        )
    )
    folder = result.scalar_one_or_none()

    if not folder:
        raise NotFoundError(f"Folder not found: {folder_id}")

    # Verify target parent folder exists (if provided)
    new_path = "/"
    if request.parent_id:
        parent_result = await db.execute(
            select(Folder).where(
                Folder.id == request.parent_id,
                Folder.owner_id == user.user_id,
            )
        )
        parent_folder = parent_result.scalar_one_or_none()
        if not parent_folder:
            raise NotFoundError(f"Parent folder not found: {request.parent_id}")

        # Check if target is a descendant of the folder being moved
        if parent_folder.path.startswith(folder.path + folder.id + "/"):
            raise InvalidOperationError("Cannot move folder into its own descendant")

        new_path = f"{parent_folder.path}{parent_folder.id}/"

    # Update folder
    old_path = folder.path
    folder.parent_id = request.parent_id
    folder.path = new_path
    folder.updated_at = now_utc()

    # Update paths of all descendants
    descendants_result = await db.execute(
        select(Folder).where(
            Folder.owner_id == user.user_id,
            Folder.path.startswith(old_path + folder_id + "/"),
        )
    )
    descendants = descendants_result.scalars().all()

    for descendant in descendants:
        # Replace old path prefix with new path prefix
        descendant.path = descendant.path.replace(
            old_path + folder_id + "/",
            new_path + folder_id + "/",
            1
        )

    await db.commit()

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "folder_id": folder_id,
            "parent_id": request.parent_id,
            "path": new_path,
            "moved": True,
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.get(
    "/folders/{folder_id}/stats",
    response_model=APIResponse[dict],
    summary="Get folder statistics",
    description="""
Get comprehensive statistics for a folder including total size and counts (recursive).

This endpoint calculates statistics for the specified folder and all its descendants, providing a complete picture of the folder's contents.

## Path Parameters
| Parameter | Type | Description |
|-----------|------|-------------|
| folder_id | string | UUID of the folder to analyze |

## Response Structure
- **folder_id**: The analyzed folder's UUID
- **total_size_bytes**: Combined size of all documents (recursive)
- **document_count**: Total number of documents (recursive)
- **folder_count**: Number of subfolders (not including the folder itself)

## Use Cases
- Display folder size in file browser UI
- Check folder contents before deletion
- Monitor storage usage by folder
""",
    responses={
        200: {
            "description": "Folder statistics retrieved successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "folder_id": "660e8400-e29b-41d4-a716-446655440001",
                            "total_size_bytes": 52428800,
                            "document_count": 15,
                            "folder_count": 3
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2024-01-18T15:00:00Z"}
                    }
                }
            }
        },
        403: {"description": "You do not have access to this folder"},
        404: {"description": "Folder not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''curl -X GET "https://api.giga-pdf.com/api/v1/storage/folders/660e8400-e29b-41d4-a716-446655440001/stats" \\
  -H "Authorization: Bearer $TOKEN"'''
            },
            {
                "lang": "python",
                "label": "Python",
                "source": '''import requests

folder_id = "660e8400-e29b-41d4-a716-446655440001"
response = requests.get(
    f"https://api.giga-pdf.com/api/v1/storage/folders/{folder_id}/stats",
    headers={"Authorization": f"Bearer {token}"}
)

stats = response.json()["data"]
size_mb = stats["total_size_bytes"] / (1024 * 1024)
print(f"Folder size: {size_mb:.2f} MB")
print(f"Documents: {stats['document_count']}")
print(f"Subfolders: {stats['folder_count']}")'''
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const folderId = "660e8400-e29b-41d4-a716-446655440001";
const response = await fetch(
  `https://api.giga-pdf.com/api/v1/storage/folders/${folderId}/stats`,
  {
    method: "GET",
    headers: { "Authorization": `Bearer ${token}` }
  }
);

const { data: stats } = await response.json();
const sizeMB = (stats.total_size_bytes / (1024 * 1024)).toFixed(2);
console.log(`Folder size: ${sizeMB} MB`);
console.log(`Documents: ${stats.document_count}`);
console.log(`Subfolders: ${stats.folder_count}`);'''
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '''<?php
$folderId = "660e8400-e29b-41d4-a716-446655440001";
$client = new GuzzleHttp\\Client();
$response = $client->get(
    "https://api.giga-pdf.com/api/v1/storage/folders/{$folderId}/stats",
    ["headers" => ["Authorization" => "Bearer " . $token]]
);

$stats = json_decode($response->getBody(), true)["data"];
$sizeMB = number_format($stats["total_size_bytes"] / (1024 * 1024), 2);
echo "Folder size: " . $sizeMB . " MB\\n";
echo "Documents: " . $stats["document_count"] . "\\n";
echo "Subfolders: " . $stats["folder_count"] . "\\n";'''
            }
        ]
    },
)
async def get_folder_stats(
    folder_id: str,
    user: AuthenticatedUser,
    db: AsyncSession = Depends(get_db),
) -> APIResponse[dict]:
    """Get folder statistics (size, document count, etc.).

    Access: owner OR a user who has an active share on a document inside the
    folder subtree. Anyone else gets **403** (not 404).
    """
    start_time = time.time()

    # Load by id; owner-or-shared is enforced by the access guard below.
    result = await db.execute(select(Folder).where(Folder.id == folder_id))
    folder = result.scalar_one_or_none()

    if not folder:
        raise NotFoundError(f"Folder not found: {folder_id}")

    # Owner-or-shared gate → 403 for anyone else.
    await authorize_folder_access(db, folder, user.user_id)
    # Stats are computed over the folder OWNER's documents (correct counts for
    # an owner; a shared viewer sees the same subtree they were granted into).
    stats_owner_id = folder.owner_id

    # Get all folders in this subtree (including the folder itself)
    folder_ids = [folder_id]
    descendants_result = await db.execute(
        select(Folder.id).where(
            Folder.owner_id == stats_owner_id,
            Folder.path.startswith(folder.path + folder_id + "/"),
        )
    )
    folder_ids.extend([f[0] for f in descendants_result.all()])

    # Count subfolders (excluding the folder itself)
    subfolder_count = len(folder_ids) - 1

    # Get document stats for all folders in subtree
    stats_result = await db.execute(
        select(
            func.count(StoredDocument.id),
            func.coalesce(func.sum(StoredDocument.file_size_bytes), 0)
        ).where(
            StoredDocument.owner_id == stats_owner_id,
            StoredDocument.folder_id.in_(folder_ids),
            ~StoredDocument.is_deleted,
        )
    )
    stats = stats_result.one()
    document_count = stats[0] or 0
    total_size = stats[1] or 0

    processing_time = int((time.time() - start_time) * 1000)

    return APIResponse(
        success=True,
        data={
            "folder_id": folder_id,
            "total_size_bytes": total_size,
            "document_count": document_count,
            "folder_count": subfolder_count,
        },
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


# ── Editor layers (cross-session persistence) ───────────────────────────
# Persist an OPAQUE editor-layers blob per stored document so the web editor
# can restore user layers + element→layer membership on reload. The blob shape
# is `{"layers": [...], "membership": {"<elementId>": "<layerId>"}}`; the API
# stores it as opaque JSONB and does NOT enforce its internal schema.

_DEFAULT_LAYERS_DATA: dict = {"layers": [], "membership": {}}


class DocumentLayersData(BaseModel):
    """Opaque-ish editor-layers blob.

    Permissive on purpose: ``layers`` is a list of arbitrary layer objects and
    ``membership`` maps element IDs to layer IDs. The server persists this
    verbatim; the editor owns the internal schema.
    """

    layers: list[dict] = Field(
        default_factory=list,
        description="Editor layer objects (opaque to the server)",
    )
    membership: dict[str, str] = Field(
        default_factory=dict,
        description="Map of elementId → layerId (opaque to the server)",
    )

    class Config:
        json_schema_extra = {
            "example": {
                "layers": [
                    {"id": "layer-1", "name": "Background", "visible": True},
                    {"id": "layer-2", "name": "Annotations", "visible": True},
                ],
                "membership": {
                    "elem-aaaa": "layer-1",
                    "elem-bbbb": "layer-2",
                },
            }
        }


async def _load_document_for_layers(
    db: AsyncSession,
    stored_document_id: str,
    user_id: str,
    *,
    require_edit: bool,
) -> StoredDocument:
    """Load a non-trashed document and authorize layer access (owner-or-shared).

    Mirrors the storage read endpoints: the document is loaded by id and the
    owner-or-shared guard closes the IDOR gap — a non-owner without a grant
    gets **403**, a missing/trashed document gets **404**. When *require_edit*
    is set (write path), a view-only grantee is rejected with **403**.
    """
    result = await db.execute(
        select(StoredDocument).where(
            StoredDocument.id == stored_document_id,
            ~StoredDocument.is_deleted,
        )
    )
    stored_doc = result.scalar_one_or_none()
    if not stored_doc:
        raise NotFoundError(f"Document not found: {stored_document_id}")

    decision = await authorize_document_access(db, stored_doc, user_id)
    if require_edit and not decision.can_edit:
        raise HTTPException(
            status_code=403,
            detail="You do not have edit access to this document",
        )
    return stored_doc


@router.get(
    "/documents/{stored_document_id}/layers",
    response_model=APIResponse[DocumentLayersData],
    summary="Get editor layers for a document",
    description="""
Return the persisted editor-layers blob for a stored document.

The blob restores the editor's user layers and the element→layer membership
on reload. When a document has no saved layers yet, an empty default
(`{"layers": [], "membership": {}}`) is returned.

## Permissions
- **Owner**: always allowed.
- **Shared user**: allowed (active share grant on the document).
- **Anyone else**: **403 Forbidden**.

## Errors
- 403: you do not have access to this document
- 404: document not found (or trashed)
""",
    responses={
        200: {
            "description": "Editor layers retrieved successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "layers": [
                                {"id": "layer-1", "name": "Background", "visible": True}
                            ],
                            "membership": {"elem-aaaa": "layer-1"},
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2026-06-21T10:30:00Z"},
                    }
                }
            },
        },
        403: {"description": "You do not have access to this document"},
        404: {"description": "Document not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''curl -X GET "https://api.giga-pdf.com/api/v1/storage/documents/770e8400-e29b-41d4-a716-446655440002/layers" \\
  -H "Authorization: Bearer $TOKEN"'''
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const storedDocId = "770e8400-e29b-41d4-a716-446655440002";
const response = await fetch(
  `https://api.giga-pdf.com/api/v1/storage/documents/${storedDocId}/layers`,
  { headers: { "Authorization": `Bearer ${token}` } }
);

const { data } = await response.json();
console.log(`${data.layers.length} layers restored`);'''
            },
        ]
    },
)
async def get_document_layers(
    stored_document_id: str,
    user: AuthenticatedUser,
    db: AsyncSession = Depends(get_db),
) -> APIResponse[DocumentLayersData]:
    """Return the editor-layers blob for a document (owner-or-shared).

    Falls back to an empty default when no layers row exists yet.
    """
    start_time = time.time()

    # Authorize (owner-or-shared) — 403 for others, 404 if missing/trashed.
    await _load_document_for_layers(
        db, stored_document_id, user.user_id, require_edit=False
    )

    result = await db.execute(
        select(DocumentLayers).where(
            DocumentLayers.stored_document_id == stored_document_id
        )
    )
    row = result.scalar_one_or_none()
    blob = row.data if row and row.data else dict(_DEFAULT_LAYERS_DATA)

    processing_time = int((time.time() - start_time) * 1000)
    return APIResponse(
        success=True,
        data=DocumentLayersData(
            layers=blob.get("layers", []),
            membership=blob.get("membership", {}),
        ),
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )


@router.put(
    "/documents/{stored_document_id}/layers",
    response_model=APIResponse[DocumentLayersData],
    summary="Save editor layers for a document",
    description="""
Upsert the editor-layers blob for a stored document.

Creates the layers row on first save, otherwise overwrites it and bumps
``updated_at``. The body is stored **verbatim** (opaque blob); the server does
not enforce its internal schema beyond the permissive
`{layers: [...], membership: {elementId: layerId}}` envelope.

## Permissions
- **Owner**: always allowed.
- **Shared user with edit grant**: allowed.
- **View-only grant / anyone else**: **403 Forbidden**.

## Errors
- 403: you do not have edit access to this document
- 404: document not found (or trashed)
""",
    responses={
        200: {
            "description": "Editor layers saved successfully",
            "content": {
                "application/json": {
                    "example": {
                        "success": True,
                        "data": {
                            "layers": [
                                {"id": "layer-1", "name": "Background", "visible": True}
                            ],
                            "membership": {"elem-aaaa": "layer-1"},
                        },
                        "meta": {"request_id": "uuid", "timestamp": "2026-06-21T10:30:00Z"},
                    }
                }
            },
        },
        403: {"description": "You do not have edit access to this document"},
        404: {"description": "Document not found"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": '''curl -X PUT "https://api.giga-pdf.com/api/v1/storage/documents/770e8400-e29b-41d4-a716-446655440002/layers" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"layers":[{"id":"layer-1","name":"Background","visible":true}],"membership":{"elem-aaaa":"layer-1"}}' '''
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": '''const storedDocId = "770e8400-e29b-41d4-a716-446655440002";
const response = await fetch(
  `https://api.giga-pdf.com/api/v1/storage/documents/${storedDocId}/layers`,
  {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      layers: [{ id: "layer-1", name: "Background", visible: true }],
      membership: { "elem-aaaa": "layer-1" },
    }),
  }
);

const { data } = await response.json();
console.log(`${data.layers.length} layers saved`);'''
            },
        ]
    },
)
async def save_document_layers(
    stored_document_id: str,
    payload: DocumentLayersData,
    user: AuthenticatedUser,
    _rl: RateLimitDep,
    db: AsyncSession = Depends(get_db),
) -> APIResponse[DocumentLayersData]:
    """Upsert the editor-layers blob for a document (owner or edit-grantee).

    Inserts the row when absent, otherwise overwrites ``data`` and bumps
    ``updated_at``. The blob is validated only against the permissive envelope
    and stored verbatim.
    """
    start_time = time.time()

    # Authorize edit (owner OR edit grant) — 403 otherwise, 404 if missing.
    await _load_document_for_layers(
        db, stored_document_id, user.user_id, require_edit=True
    )

    blob = {"layers": payload.layers, "membership": payload.membership}

    result = await db.execute(
        select(DocumentLayers).where(
            DocumentLayers.stored_document_id == stored_document_id
        )
    )
    row = result.scalar_one_or_none()

    if row is None:
        row = DocumentLayers(
            stored_document_id=stored_document_id,
            data=blob,
        )
        db.add(row)
    else:
        row.data = blob
        row.updated_at = now_utc()

    await db.commit()

    processing_time = int((time.time() - start_time) * 1000)
    return APIResponse(
        success=True,
        data=DocumentLayersData(
            layers=blob["layers"],
            membership=blob["membership"],
        ),
        meta=MetaInfo(
            request_id=get_request_id(),
            timestamp=now_utc(),
            processing_time_ms=processing_time,
        ),
    )
