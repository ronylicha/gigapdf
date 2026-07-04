"""
Document sharing service — backward-compatible facade.

This module previously contained a 1 048-line God Class.  It has been
decomposed into focused sub-services under ``app/services/sharing/``:

  - ``sharing.invitation_service``  — invitation lifecycle (create, accept, decline, list)
  - ``sharing.permission_service``  — access checks and permission updates
  - ``sharing.share_crud_service``  — CRUD on shares and public links

This file is kept as a **thin delegation facade** so that all existing
callers (routers, other services) continue to work without modification:

    from app.services.share_service import share_service, SharePermission

All symbols that were previously defined here are re-exported unchanged.

Deprecation notice
------------------
Direct use of ``ShareService`` (the monolithic class) is deprecated.
New code should import from ``app.services.sharing`` and use the
focused sub-services.  The facade will be removed once all internal
consumers have been migrated (see /docs/share-service-decomposition.md).
"""


from app.services.sharing.constants import (
    InvitationStatus,
    SharePermission,
    ShareStatus,
)
from app.services.sharing.invitation_service import InvitationService
from app.services.sharing.permission_service import PermissionService
from app.services.sharing.share_crud_service import ShareCrudService

# ---------------------------------------------------------------------------
# Re-export constants — maintains ``from app.services.share_service import SharePermission``
# ---------------------------------------------------------------------------
__all__ = [
    "SharePermission",
    "InvitationStatus",
    "ShareStatus",
    "ShareService",
    "share_service",
]


class ShareService:
    """
    Facade over the sharing sub-services.

    .. deprecated::
        Prefer importing from ``app.services.sharing`` directly.
        This class delegates every call to the appropriate sub-service and
        will be removed in a future release.
    """

    # ------------------------------------------------------------------
    # Invitation operations — delegates to InvitationService
    # ------------------------------------------------------------------

    @staticmethod
    async def share_document(
        document_id: str,
        inviter_id: str,
        invitee_email: str,
        permission: str = SharePermission.EDIT,
        message=None,
        expires_in_days: int = 7,
    ) -> dict:
        """Delegate to :meth:`InvitationService.share_document`."""
        return await InvitationService.share_document(
            document_id=document_id,
            inviter_id=inviter_id,
            invitee_email=invitee_email,
            permission=permission,
            message=message,
            expires_in_days=expires_in_days,
        )

    @staticmethod
    async def accept_invitation(token: str, user_id: str, user_email: str) -> dict:
        """Delegate to :meth:`InvitationService.accept_invitation`."""
        return await InvitationService.accept_invitation(
            token=token,
            user_id=user_id,
            user_email=user_email,
        )

    @staticmethod
    async def decline_invitation(token: str, user_id: str) -> dict:
        """Delegate to :meth:`InvitationService.decline_invitation`."""
        return await InvitationService.decline_invitation(token=token, user_id=user_id)

    @staticmethod
    async def get_pending_invitations(user_email: str) -> list[dict]:
        """Delegate to :meth:`InvitationService.get_pending_invitations`."""
        return await InvitationService.get_pending_invitations(user_email=user_email)

    @staticmethod
    async def get_invitation_by_token(token: str) -> dict:
        """Delegate to :meth:`InvitationService.get_invitation_by_token`."""
        return await InvitationService.get_invitation_by_token(token=token)

    # ------------------------------------------------------------------
    # Permission operations — delegates to PermissionService
    # ------------------------------------------------------------------

    @staticmethod
    async def check_access(
        document_id: str,
        user_id: str,
        user_email=None,
        user_quota_id=None,
    ) -> dict:
        """Delegate to :meth:`PermissionService.check_access`."""
        return await PermissionService.check_access(
            document_id=document_id,
            user_id=user_id,
            user_email=user_email,
            user_quota_id=user_quota_id,
        )

    @staticmethod
    async def update_permission(
        share_id: str,
        owner_id: str,
        new_permission: str,
    ) -> dict:
        """Delegate to :meth:`PermissionService.update_permission`."""
        return await PermissionService.update_permission(
            share_id=share_id,
            owner_id=owner_id,
            new_permission=new_permission,
        )

    # ------------------------------------------------------------------
    # Share CRUD + public links — delegates to ShareCrudService
    # ------------------------------------------------------------------

    @staticmethod
    async def revoke_share(share_id: str, revoker_id: str) -> dict:
        """Delegate to :meth:`ShareCrudService.revoke_share`."""
        return await ShareCrudService.revoke_share(
            share_id=share_id,
            revoker_id=revoker_id,
        )

    @staticmethod
    async def get_document_shares(document_id: str, owner_id: str) -> list[dict]:
        """Delegate to :meth:`ShareCrudService.get_document_shares`."""
        return await ShareCrudService.get_document_shares(
            document_id=document_id,
            owner_id=owner_id,
        )

    @staticmethod
    async def get_shared_by_me(
        user_id: str,
        page: int = 1,
        per_page: int = 20,
    ) -> dict:
        """Delegate to :meth:`ShareCrudService.get_shared_by_me`."""
        return await ShareCrudService.get_shared_by_me(
            user_id=user_id,
            page=page,
            per_page=per_page,
        )

    @staticmethod
    async def get_shared_with_me(
        user_id: str,
        user_email: str,
        user_quota_id=None,
        page: int = 1,
        per_page: int = 20,
        source_filter=None,
    ) -> dict:
        """Delegate to :meth:`ShareCrudService.get_shared_with_me`."""
        return await ShareCrudService.get_shared_with_me(
            user_id=user_id,
            user_email=user_email,
            user_quota_id=user_quota_id,
            page=page,
            per_page=per_page,
            source_filter=source_filter if source_filter is not None else "all",
        )

    @staticmethod
    async def create_public_link(
        document_id: str,
        owner_id: str,
        expires_in_days=None,
    ) -> dict:
        """Delegate to :meth:`ShareCrudService.create_public_link`."""
        return await ShareCrudService.create_public_link(
            document_id=document_id,
            owner_id=owner_id,
            expires_in_days=expires_in_days,
        )

    @staticmethod
    async def revoke_public_link(document_id: str, owner_id: str) -> dict:
        """Delegate to :meth:`ShareCrudService.revoke_public_link`."""
        return await ShareCrudService.revoke_public_link(
            document_id=document_id,
            owner_id=owner_id,
        )

    @staticmethod
    async def resolve_public_link(token: str) -> dict:
        """Delegate to :meth:`ShareCrudService.resolve_public_link`."""
        return await ShareCrudService.resolve_public_link(token=token)

    @staticmethod
    async def download_public_document(token: str) -> tuple[bytes, str]:
        """Delegate to :meth:`ShareCrudService.download_public_document`."""
        return await ShareCrudService.download_public_document(token=token)


# Singleton — identical name kept for backward compatibility.
share_service = ShareService()
