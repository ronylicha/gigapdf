"""
Permission service — checks and updates access rights on shares.

Responsibilities:
  - Checking whether a user has access to a document (check_access)
  - Updating the permission level of an existing share (update_permission)
"""

import logging

from sqlalchemy import select

from app.core.database import get_db_session
from app.models.database import (
    DocumentShare,
    ShareNotification,
    StoredDocument,
)
from app.models.tenant import TenantDocument, TenantMember
from app.utils.helpers import generate_uuid, now_utc

from .constants import SharePermission, ShareStatus

logger = logging.getLogger(__name__)


class PermissionService:
    """Checks and updates access rights for document shares."""

    @staticmethod
    async def check_access(
        document_id: str,
        user_id: str,
        user_email: str | None = None,
        user_quota_id: str | None = None,
    ) -> dict:
        """
        Determine whether *user_id* has access to *document_id* and at which level.

        Access is evaluated in priority order:

        1. **Ownership** — the user owns the document.
        2. **Direct share** — an active ``DocumentShare`` record exists.
        3. **Organisation share** — the document belongs to a tenant the user
           is a member of.

        Args:
            document_id: Target document.
            user_id: Requesting user.
            user_email: User e-mail (reserved for future invitation-based lookup).
            user_quota_id: Quota ID used to resolve tenant memberships.

        Returns:
            dict: ``{"has_access": bool, "permission"?: str, "source"?: str, ...}``.
        """
        async with get_db_session() as session:
            doc_result = await session.execute(
                select(StoredDocument).where(
                    StoredDocument.id == document_id,
                    ~StoredDocument.is_deleted,
                )
            )
            document = doc_result.scalar_one_or_none()

            if not document:
                return {"has_access": False, "reason": "document_not_found"}

            if document.owner_id == user_id:
                return {
                    "has_access": True,
                    "permission": "owner",
                    "source": "ownership",
                }

            # Direct share
            share_result = await session.execute(
                select(DocumentShare).where(
                    DocumentShare.document_id == document_id,
                    DocumentShare.shared_with_user_id == user_id,
                    DocumentShare.status == ShareStatus.ACTIVE,
                )
            )
            share = share_result.scalar_one_or_none()

            if share:
                if share.expires_at and share.expires_at < now_utc():
                    return {"has_access": False, "reason": "share_expired"}

                return {
                    "has_access": True,
                    "permission": share.permission,
                    "source": "direct_share",
                    "share_id": share.id,
                }

            # Organisation share
            if user_quota_id:
                membership_result = await session.execute(
                    select(TenantMember).where(
                        TenantMember.user_id == user_quota_id,
                        TenantMember.is_active,
                    )
                )
                memberships = membership_result.scalars().all()

                for membership in memberships:
                    tenant_doc_result = await session.execute(
                        select(TenantDocument).where(
                            TenantDocument.tenant_id == membership.tenant_id,
                            TenantDocument.document_id == document_id,
                        )
                    )
                    if tenant_doc_result.scalar_one_or_none():
                        permission = (
                            "edit"
                            if membership.role in ["owner", "admin", "manager"]
                            else "view"
                        )
                        return {
                            "has_access": True,
                            "permission": permission,
                            "source": "organization",
                            "tenant_id": membership.tenant_id,
                            "role": membership.role,
                        }

            return {"has_access": False, "reason": "no_access"}

    @staticmethod
    async def update_permission(
        share_id: str,
        owner_id: str,
        new_permission: str,
    ) -> dict:
        """
        Update the permission level of an existing share.

        Only the document owner can change permission levels.  The shared user
        receives a notification about the change.

        Args:
            share_id: Target share record.
            owner_id: Document owner (for authorisation).
            new_permission: New permission level (``"view"`` or ``"edit"``).

        Returns:
            dict: ``{"share_id": str, "permission": str, "old_permission": str}``.

        Raises:
            ValueError: If *new_permission* is invalid, the share is not found,
                or *owner_id* does not own the document.
        """
        if new_permission not in [SharePermission.VIEW, SharePermission.EDIT]:
            raise ValueError("Invalid permission level")

        async with get_db_session() as session:
            result = await session.execute(
                select(DocumentShare).where(DocumentShare.id == share_id)
            )
            share = result.scalar_one_or_none()

            if not share:
                raise ValueError("Share not found")

            doc_result = await session.execute(
                select(StoredDocument).where(
                    StoredDocument.id == share.document_id,
                    StoredDocument.owner_id == owner_id,
                )
            )
            document = doc_result.scalar_one_or_none()

            if not document:
                raise ValueError("You don't have permission to modify this share")

            old_permission = share.permission
            share.permission = new_permission

            if share.shared_with_user_id:
                notification = ShareNotification(
                    id=generate_uuid(),
                    user_id=share.shared_with_user_id,
                    notification_type="permission_changed",
                    document_id=share.document_id,
                    title="Permission updated",
                    message=(
                        f"Your access to '{document.name}' changed from "
                        f"{old_permission} to {new_permission}"
                    ),
                    extra_data={
                        "document_name": document.name,
                        "old_permission": old_permission,
                        "new_permission": new_permission,
                    },
                )
                session.add(notification)

            await session.commit()

            return {
                "share_id": share_id,
                "permission": new_permission,
                "old_permission": old_permission,
            }


permission_service = PermissionService()
