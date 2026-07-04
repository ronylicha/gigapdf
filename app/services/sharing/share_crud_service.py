"""
Share CRUD service — manages the lifecycle of DocumentShare records and public links.

Responsibilities:
  - Revoking individual shares (revoke_share)
  - Creating / revoking public view-only links (create_public_link, revoke_public_link)
  - Listing shares for a specific document (get_document_shares)
  - Listing shares *by* the authenticated user (get_shared_by_me)
  - Listing shares *with* the authenticated user (get_shared_with_me)
"""

import logging
import secrets
from datetime import timedelta
from typing import Literal

from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.core.database import get_db_session
from app.models.database import (
    DocumentShare,
    DocumentShareInvitation,
    ShareNotification,
    StoredDocument,
    UserQuota,
)
from app.models.tenant import TenantDocument, TenantMember
from app.utils.helpers import generate_uuid, now_utc

from .constants import InvitationStatus, SharePermission, ShareStatus

logger = logging.getLogger(__name__)


def _generate_token() -> str:
    """Generate a cryptographically secure random token."""
    return secrets.token_urlsafe(32)


class ShareCrudService:
    """Manages DocumentShare records and public link tokens."""

    @staticmethod
    async def revoke_share(share_id: str, revoker_id: str) -> dict:
        """
        Revoke an active document share.

        The associated invitation (if any) is also marked as revoked.
        The shared user receives a notification.

        Args:
            share_id: Share record to revoke.
            revoker_id: Must be the document owner.

        Returns:
            dict: ``{"share_id": str, "status": "revoked"}``.

        Raises:
            ValueError: If the share is not found, *revoker_id* does not own
                the document, or the share is already revoked.
        """
        async with get_db_session() as session:
            result = await session.execute(
                select(DocumentShare)
                .options(selectinload(DocumentShare.invitation))
                .where(DocumentShare.id == share_id)
            )
            share = result.scalar_one_or_none()

            if not share:
                raise ValueError("Share not found")

            doc_result = await session.execute(
                select(StoredDocument).where(
                    StoredDocument.id == share.document_id,
                    StoredDocument.owner_id == revoker_id,
                )
            )
            document = doc_result.scalar_one_or_none()

            if not document:
                raise ValueError("You don't have permission to revoke this share")

            if share.status == ShareStatus.REVOKED:
                raise ValueError("Share is already revoked")

            share.status = ShareStatus.REVOKED
            share.revoked_at = now_utc()
            share.revoked_by = revoker_id

            if share.invitation:
                share.invitation.status = InvitationStatus.REVOKED

            if share.shared_with_user_id:
                notification = ShareNotification(
                    id=generate_uuid(),
                    user_id=share.shared_with_user_id,
                    notification_type="share_revoked",
                    document_id=share.document_id,
                    title="Access revoked",
                    message=f"Your access to '{document.name}' has been revoked",
                    extra_data={
                        "document_name": document.name,
                        "revoker_id": revoker_id,
                    },
                )
                session.add(notification)

            await session.commit()

            logger.info("Share %s revoked by %s", share_id, revoker_id)

            return {"share_id": share_id, "status": ShareStatus.REVOKED}

    @staticmethod
    async def get_document_shares(document_id: str, owner_id: str) -> list[dict]:
        """
        Return all active shares and pending invitations for a document.

        Args:
            document_id: Target document.
            owner_id: Must own the document (authorisation check).

        Returns:
            list[dict]: Combined list of active shares and pending invitations.

        Raises:
            ValueError: If the document is not found or *owner_id* does not own it.
        """
        async with get_db_session() as session:
            doc_result = await session.execute(
                select(StoredDocument).where(
                    StoredDocument.id == document_id,
                    StoredDocument.owner_id == owner_id,
                )
            )
            if not doc_result.scalar_one_or_none():
                raise ValueError("Document not found or you don't have access")

            query = (
                select(DocumentShare)
                .where(
                    DocumentShare.document_id == document_id,
                    DocumentShare.status == ShareStatus.ACTIVE,
                )
                .order_by(DocumentShare.created_at.desc())
            )

            result = await session.execute(query)
            shares = result.scalars().all()

            share_list: list[dict] = []
            for share in shares:
                shared_user = None
                if share.shared_with_user_id:
                    user_result = await session.execute(
                        select(UserQuota).where(
                            UserQuota.user_id == share.shared_with_user_id
                        )
                    )
                    shared_user = user_result.scalar_one_or_none()

                share_list.append(
                    {
                        "share_id": share.id,
                        "shared_with": (
                            {
                                "user_id": share.shared_with_user_id,
                                "email": shared_user.email if shared_user else None,
                            }
                            if share.shared_with_user_id
                            else None
                        ),
                        "is_public_link": share.share_token is not None,
                        "share_token": share.share_token,
                        "permission": share.permission,
                        "created_at": (
                            share.created_at.isoformat() if share.created_at else None
                        ),
                        "expires_at": (
                            share.expires_at.isoformat() if share.expires_at else None
                        ),
                    }
                )

            # Append pending invitations as well
            inv_query = (
                select(DocumentShareInvitation)
                .where(
                    DocumentShareInvitation.document_id == document_id,
                    DocumentShareInvitation.status == InvitationStatus.PENDING,
                )
            )
            inv_result = await session.execute(inv_query)
            invitations = inv_result.scalars().all()

            for inv in invitations:
                share_list.append(
                    {
                        "invitation_id": inv.id,
                        "invitee_email": inv.invitee_email,
                        "permission": inv.permission,
                        "status": "pending",
                        "created_at": (
                            inv.created_at.isoformat() if inv.created_at else None
                        ),
                        "expires_at": (
                            inv.expires_at.isoformat() if inv.expires_at else None
                        ),
                    }
                )

            return share_list

    @staticmethod
    async def get_shared_by_me(
        user_id: str,
        page: int = 1,
        per_page: int = 20,
    ) -> dict:
        """
        Return a paginated list of shares created by *user_id*.

        Args:
            user_id: Document owner whose shares are listed.
            page: 1-indexed page number.
            per_page: Records per page.

        Returns:
            dict: ``{"shares": list, "total": int, "page": int, ...}``.
        """
        async with get_db_session() as session:
            count_query = (
                select(func.count(DocumentShare.id))
                .join(StoredDocument, DocumentShare.document_id == StoredDocument.id)
                .where(
                    StoredDocument.owner_id == user_id,
                    DocumentShare.status == ShareStatus.ACTIVE,
                    ~StoredDocument.is_deleted,
                )
            )
            total_result = await session.execute(count_query)
            total = total_result.scalar() or 0

            query = (
                select(DocumentShare, StoredDocument)
                .join(StoredDocument, DocumentShare.document_id == StoredDocument.id)
                .where(
                    StoredDocument.owner_id == user_id,
                    DocumentShare.status == ShareStatus.ACTIVE,
                    ~StoredDocument.is_deleted,
                )
                .order_by(DocumentShare.created_at.desc())
                .offset((page - 1) * per_page)
                .limit(per_page)
            )

            result = await session.execute(query)
            shares = result.all()

            share_list: list[dict] = []
            for share, doc in shares:
                shared_user = None
                if share.shared_with_user_id:
                    user_result = await session.execute(
                        select(UserQuota).where(
                            UserQuota.user_id == share.shared_with_user_id
                        )
                    )
                    shared_user = user_result.scalar_one_or_none()

                share_list.append(
                    {
                        "share_id": share.id,
                        "document": {
                            "id": doc.id,
                            "name": doc.name,
                            "page_count": doc.page_count,
                            "thumbnail_path": doc.thumbnail_path,
                        },
                        "shared_with": (
                            {
                                "user_id": share.shared_with_user_id,
                                "email": shared_user.email if shared_user else None,
                            }
                            if share.shared_with_user_id
                            else None
                        ),
                        "is_public_link": share.share_token is not None,
                        "permission": share.permission,
                        "created_at": (
                            share.created_at.isoformat() if share.created_at else None
                        ),
                        "expires_at": (
                            share.expires_at.isoformat() if share.expires_at else None
                        ),
                    }
                )

            return {
                "shares": share_list,
                "total": total,
                "page": page,
                "per_page": per_page,
                "total_pages": (
                    (total + per_page - 1) // per_page if total > 0 else 0
                ),
            }

    @staticmethod
    async def get_shared_with_me(
        user_id: str,
        user_email: str,
        user_quota_id: str | None = None,
        page: int = 1,
        per_page: int = 20,
        source_filter: Literal["direct", "organization", "all"] | None = "all",
    ) -> dict:
        """
        Return a paginated list of documents shared *with* the authenticated user.

        Combines direct shares (``DocumentShare``) and organisation shares
        (``TenantDocument``) depending on *source_filter*.

        Args:
            user_id: Authenticated user.
            user_email: User e-mail (currently unused, reserved for future use).
            user_quota_id: Quota ID required for tenant-based lookups.
            page: 1-indexed page number.
            per_page: Records per page.
            source_filter: ``"direct"``, ``"organization"``, or ``"all"``.

        Returns:
            dict: ``{"documents": list, "total": int, "page": int, ...}``.
        """
        async with get_db_session() as session:
            shared_documents: list[dict] = []

            if source_filter in ["direct", "all"]:
                direct_query = (
                    select(DocumentShare, StoredDocument)
                    .join(StoredDocument, DocumentShare.document_id == StoredDocument.id)
                    .where(
                        DocumentShare.shared_with_user_id == user_id,
                        DocumentShare.status == ShareStatus.ACTIVE,
                        ~StoredDocument.is_deleted,
                    )
                    .order_by(DocumentShare.created_at.desc())
                )

                direct_result = await session.execute(direct_query)
                for share, doc in direct_result.all():
                    owner_result = await session.execute(
                        select(UserQuota).where(UserQuota.user_id == doc.owner_id)
                    )
                    owner = owner_result.scalar_one_or_none()

                    shared_documents.append(
                        {
                            "id": doc.id,
                            "name": doc.name,
                            "page_count": doc.page_count,
                            "file_size_bytes": doc.file_size_bytes,
                            "thumbnail_path": doc.thumbnail_path,
                            "created_at": (
                                doc.created_at.isoformat() if doc.created_at else None
                            ),
                            "updated_at": (
                                doc.updated_at.isoformat() if doc.updated_at else None
                            ),
                            "share_source": "direct",
                            "share_id": share.id,
                            "permission": share.permission,
                            "shared_at": (
                                share.created_at.isoformat()
                                if share.created_at
                                else None
                            ),
                            "owner": {
                                "user_id": doc.owner_id,
                                "email": owner.email if owner else None,
                            },
                        }
                    )

            if source_filter in ["organization", "all"] and user_quota_id:
                membership_result = await session.execute(
                    select(TenantMember).where(
                        TenantMember.user_id == user_quota_id,
                        TenantMember.is_active,
                    )
                )
                memberships = membership_result.scalars().all()

                for membership in memberships:
                    tenant_docs_query = (
                        select(TenantDocument, StoredDocument)
                        .join(
                            StoredDocument,
                            TenantDocument.document_id == StoredDocument.id,
                        )
                        .where(
                            TenantDocument.tenant_id == membership.tenant_id,
                            ~StoredDocument.is_deleted,
                            StoredDocument.owner_id != user_id,
                        )
                    )

                    tenant_result = await session.execute(tenant_docs_query)
                    for tenant_doc, doc in tenant_result.all():
                        owner_result = await session.execute(
                            select(UserQuota).where(UserQuota.user_id == doc.owner_id)
                        )
                        owner = owner_result.scalar_one_or_none()

                        permission = (
                            "edit"
                            if membership.role in ["owner", "admin", "manager"]
                            else "view"
                        )

                        shared_documents.append(
                            {
                                "id": doc.id,
                                "name": doc.name,
                                "page_count": doc.page_count,
                                "file_size_bytes": doc.file_size_bytes,
                                "thumbnail_path": doc.thumbnail_path,
                                "created_at": (
                                    doc.created_at.isoformat()
                                    if doc.created_at
                                    else None
                                ),
                                "updated_at": (
                                    doc.updated_at.isoformat()
                                    if doc.updated_at
                                    else None
                                ),
                                "share_source": "organization",
                                "tenant_id": membership.tenant_id,
                                "permission": permission,
                                "shared_at": (
                                    tenant_doc.added_at.isoformat()
                                    if tenant_doc.added_at
                                    else None
                                ),
                                "owner": {
                                    "user_id": doc.owner_id,
                                    "email": owner.email if owner else None,
                                },
                            }
                        )

            shared_documents.sort(
                key=lambda x: x.get("shared_at") or "",
                reverse=True,
            )

            total = len(shared_documents)
            start_idx = (page - 1) * per_page
            paginated_docs = shared_documents[start_idx : start_idx + per_page]

            return {
                "documents": paginated_docs,
                "total": total,
                "page": page,
                "per_page": per_page,
                "total_pages": (total + per_page - 1) // per_page if total > 0 else 0,
            }

    @staticmethod
    async def create_public_link(
        document_id: str,
        owner_id: str,
        expires_in_days: int | None = None,
    ) -> dict:
        """
        Create a view-only public link for a document.

        If an active public link already exists for the document, it is returned
        instead of creating a new one.

        Args:
            document_id: Target document.
            owner_id: Must own the document.
            expires_in_days: Optional expiration in days (``None`` = no expiry).

        Returns:
            dict: Token, expiry, and whether the link already existed.

        Raises:
            ValueError: If the document is not found or *owner_id* does not own it.
        """
        async with get_db_session() as session:
            doc_result = await session.execute(
                select(StoredDocument).where(
                    StoredDocument.id == document_id,
                    StoredDocument.owner_id == owner_id,
                    ~StoredDocument.is_deleted,
                )
            )
            document = doc_result.scalar_one_or_none()

            if not document:
                raise ValueError(
                    "Document not found or you don't have permission"
                )

            existing_result = await session.execute(
                select(DocumentShare).where(
                    DocumentShare.document_id == document_id,
                    DocumentShare.share_token.isnot(None),
                    DocumentShare.status == ShareStatus.ACTIVE,
                )
            )
            existing = existing_result.scalar_one_or_none()

            if existing:
                return {
                    "share_id": existing.id,
                    "token": existing.share_token,
                    "permission": existing.permission,
                    "expires_at": (
                        existing.expires_at.isoformat()
                        if existing.expires_at
                        else None
                    ),
                    "already_existed": True,
                }

            token = _generate_token()
            expires_at = (
                now_utc() + timedelta(days=expires_in_days)
                if expires_in_days
                else None
            )

            share_id = generate_uuid()
            share = DocumentShare(
                id=share_id,
                document_id=document_id,
                share_token=token,
                permission=SharePermission.VIEW,
                expires_at=expires_at,
                created_by=owner_id,
                status=ShareStatus.ACTIVE,
            )
            session.add(share)
            await session.commit()

            logger.info("Created public link %s for document %s", share_id, document_id)

            return {
                "share_id": share_id,
                "token": token,
                "permission": SharePermission.VIEW,
                "expires_at": expires_at.isoformat() if expires_at else None,
                "already_existed": False,
            }

    @staticmethod
    async def _get_active_public_share(
        session, token: str
    ) -> tuple[DocumentShare, StoredDocument]:
        """
        Resolve an ACTIVE, non-expired public link token.

        The query filters on ``share_token`` + ``status == ACTIVE`` + document
        not deleted, so revoked links and deleted documents never match. The
        expiry check happens in Python (``expires_at`` may be NULL = no expiry).

        Security note: the *token* is a capability secret — it must never be
        logged or embedded in error messages (callers map ``ValueError`` to a
        generic 404).

        Args:
            session: Active async DB session.
            token: The public link token (``DocumentShare.share_token``).

        Returns:
            tuple: ``(share, document)``.

        Raises:
            ValueError: If no active link matches or the link has expired.
        """
        if not token:
            raise ValueError("Public link not found")

        result = await session.execute(
            select(DocumentShare, StoredDocument)
            .join(StoredDocument, DocumentShare.document_id == StoredDocument.id)
            .where(
                DocumentShare.share_token == token,
                DocumentShare.status == ShareStatus.ACTIVE,
                ~StoredDocument.is_deleted,
            )
        )
        row = result.first()
        if row is None:
            raise ValueError("Public link not found")

        share, document = row

        if share.expires_at is not None and share.expires_at <= now_utc():
            raise ValueError("Public link expired")

        return share, document

    @staticmethod
    async def resolve_public_link(token: str) -> dict:
        """
        Resolve a public link token into display metadata (UNAUTHENTICATED).

        Powers the public ``/public/[token]`` viewer page: only non-sensitive
        display fields are returned (never the owner identity, never IDs that
        would allow enumeration of other endpoints).

        Args:
            token: The public link token.

        Returns:
            dict: ``{document_name, page_count, file_size_bytes, permission}``.

        Raises:
            ValueError: If the link is unknown, revoked, or expired.
        """
        async with get_db_session() as session:
            _share, document = await ShareCrudService._get_active_public_share(
                session, token
            )

            return {
                "document_name": document.name,
                "page_count": document.page_count,
                "file_size_bytes": document.file_size_bytes,
                "permission": SharePermission.VIEW,
            }

    @staticmethod
    async def download_public_document(token: str) -> tuple[bytes, str]:
        """
        Load the PDF bytes behind a public link (UNAUTHENTICATED).

        Reuses the standard storage download path (current version, S3,
        decryption) **with the OWNER identity**: documents are encrypted at
        rest with an AAD bound to ``(document_id, owner_id)``, so the owner's
        user id is required for decryption — the anonymous caller only ever
        receives the plaintext bytes, never key material.

        Args:
            token: The public link token.

        Returns:
            tuple: ``(pdf_bytes, document_name)``.

        Raises:
            ValueError: If the link is unknown/revoked/expired or the stored
                file cannot be loaded.
        """
        # Lazy import to keep sharing services import-light (and cycle-free).
        from app.services.storage_service import storage_service

        async with get_db_session() as session:
            share, document = await ShareCrudService._get_active_public_share(
                session, token
            )

            data = await storage_service.load_document_file(
                session, document.id, document.owner_id
            )

            if data is None:
                # Log by share/document id only — NEVER the token.
                logger.error(
                    "Public link %s: stored file missing for document %s",
                    share.id,
                    document.id,
                )
                raise ValueError("Document file unavailable")

            return data, document.name

    @staticmethod
    async def revoke_public_link(document_id: str, owner_id: str) -> dict:
        """
        Revoke the public link for a document.

        Args:
            document_id: Target document.
            owner_id: Must own the document.

        Returns:
            dict: ``{"status": "revoked", "share_id": str}``.

        Raises:
            ValueError: If no active public link exists or *owner_id* does not
                own the document.
        """
        async with get_db_session() as session:
            result = await session.execute(
                select(DocumentShare).where(
                    DocumentShare.document_id == document_id,
                    DocumentShare.share_token.isnot(None),
                    DocumentShare.status == ShareStatus.ACTIVE,
                )
            )
            share = result.scalar_one_or_none()

            if not share:
                raise ValueError("No public link found for this document")

            doc_result = await session.execute(
                select(StoredDocument).where(
                    StoredDocument.id == document_id,
                    StoredDocument.owner_id == owner_id,
                )
            )
            if not doc_result.scalar_one_or_none():
                raise ValueError("You don't have permission to revoke this link")

            share.status = ShareStatus.REVOKED
            share.revoked_at = now_utc()
            share.revoked_by = owner_id

            await session.commit()

            return {"status": "revoked", "share_id": share.id}


share_crud_service = ShareCrudService()
