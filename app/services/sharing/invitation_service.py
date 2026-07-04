"""
Invitation service — manages the full lifecycle of share invitations.

Responsibilities:
  - Creating invitations (share_document)
  - Accepting / declining invitations
  - Listing pending invitations for a user
"""

import logging
import secrets
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import get_db_session
from app.models.database import (
    DocumentShare,
    DocumentShareInvitation,
    ShareNotification,
    StoredDocument,
    UserQuota,
)
from app.utils.helpers import generate_uuid, now_utc

from .constants import InvitationStatus, SharePermission, ShareStatus

logger = logging.getLogger(__name__)


def _generate_token() -> str:
    """Generate a cryptographically secure random token."""
    return secrets.token_urlsafe(32)


class InvitationService:
    """Manages document share invitations."""

    @staticmethod
    async def share_document(
        document_id: str,
        inviter_id: str,
        invitee_email: str,
        permission: str = SharePermission.EDIT,
        message: str | None = None,
        expires_in_days: int = 7,
    ) -> dict:
        """
        Share a document by creating an invitation.

        If the invitee is already a registered user, the share is activated
        **immediately** (Google-Docs behaviour): a ``DocumentShare`` with
        status ACTIVE is created, the invitation row is kept as an ACCEPTED
        audit trace, and an in-app notification is sent.  Otherwise the
        invitation stays PENDING and the caller is responsible for sending an
        invitation e-mail containing the returned token (the invitee accepts
        after signing up).

        Args:
            document_id: Document to share.
            inviter_id: User ID of the sharer (must own the document).
            invitee_email: Recipient e-mail address.
            permission: ``SharePermission.VIEW`` or ``SharePermission.EDIT``.
            message: Optional personal message included in the invitation.
            expires_in_days: Days until the invitation expires (default 7).
                Only governs the acceptance window of a PENDING invitation;
                an auto-activated share does not expire (same semantics as a
                share created through :meth:`accept_invitation`).

        Returns:
            dict: Invitation details including token, expiry, invitee info
            and — when the invitee already has an account — the ``share_id``
            of the immediately-activated share.

        Raises:
            ValueError: If the document is not found, not owned by *inviter_id*,
                or an active invitation already exists for *invitee_email*.
        """
        async with get_db_session() as session:
            # Verify document exists and belongs to the inviter
            doc_result = await session.execute(
                select(StoredDocument).where(
                    StoredDocument.id == document_id,
                    StoredDocument.owner_id == inviter_id,
                    ~StoredDocument.is_deleted,
                )
            )
            document = doc_result.scalar_one_or_none()

            if not document:
                raise ValueError(
                    "Document not found or you don't have permission to share it"
                )

            # Guard against duplicate invitations
            existing_check = await session.execute(
                select(DocumentShareInvitation).where(
                    DocumentShareInvitation.document_id == document_id,
                    DocumentShareInvitation.invitee_email == invitee_email,
                    DocumentShareInvitation.status.in_(
                        [InvitationStatus.PENDING, InvitationStatus.ACCEPTED]
                    ),
                )
            )
            existing_invitation = existing_check.scalar_one_or_none()

            if existing_invitation:
                if existing_invitation.status == InvitationStatus.ACCEPTED:
                    raise ValueError("Document is already shared with this user")
                raise ValueError("An invitation is already pending for this email")

            # Resolve whether the invitee is already a registered user
            user_result = await session.execute(
                select(UserQuota).where(UserQuota.email == invitee_email)
            )
            existing_user = user_result.scalar_one_or_none()

            invitation_id = generate_uuid()
            token = _generate_token()
            expires_at = now_utc() + timedelta(days=expires_in_days)

            invitation = DocumentShareInvitation(
                id=invitation_id,
                document_id=document_id,
                inviter_id=inviter_id,
                invitee_email=invitee_email,
                invitee_user_id=existing_user.user_id if existing_user else None,
                token=token,
                permission=permission,
                message=message,
                status=InvitationStatus.PENDING,
                expires_at=expires_at,
            )
            session.add(invitation)

            share_id: str | None = None

            if existing_user:
                # Auto-activation: the invitee already has an account, so the
                # share is granted immediately — no accept/decline friction.
                # The invitation row is kept as an ACCEPTED audit trace, and
                # (like a share created via accept_invitation) the active
                # share itself carries no expiry.
                invitation.status = InvitationStatus.ACCEPTED
                invitation.responded_at = now_utc()

                share_id = generate_uuid()
                share = DocumentShare(
                    id=share_id,
                    document_id=document_id,
                    shared_with_user_id=existing_user.user_id,
                    permission=permission,
                    created_by=inviter_id,
                    status=ShareStatus.ACTIVE,
                    invitation_id=invitation_id,
                )
                session.add(share)

                notification = ShareNotification(
                    id=generate_uuid(),
                    user_id=existing_user.user_id,
                    notification_type="share_invitation",
                    document_id=document_id,
                    share_invitation_id=invitation_id,
                    title="Document shared with you",
                    message=f"You now have access to '{document.name}'",
                    extra_data={
                        "document_name": document.name,
                        "inviter_id": inviter_id,
                        "permission": permission,
                        "share_id": share_id,
                    },
                )
                session.add(notification)

            await session.commit()

            logger.info(
                "Created share invitation %s for document %s from %s to %s "
                "(auto_activated=%s)",
                invitation_id,
                document_id,
                inviter_id,
                invitee_email,
                share_id is not None,
            )

            return {
                "invitation_id": invitation_id,
                "token": token,
                "invitee_email": invitee_email,
                "invitee_user_exists": existing_user is not None,
                "permission": permission,
                "expires_at": expires_at.isoformat(),
                "document_name": document.name,
                "share_id": share_id,
            }

    @staticmethod
    async def accept_invitation(
        token: str,
        user_id: str,
        user_email: str,
    ) -> dict:
        """
        Accept a share invitation identified by *token*.

        Creates the corresponding ``DocumentShare`` record and notifies the
        original inviter.

        Args:
            token: Invitation token (from the invitation e-mail / URL).
            user_id: ID of the user accepting.
            user_email: E-mail of the user accepting (must match the invitation).

        Returns:
            dict: Resulting share details (share_id, document info, permission).

        Raises:
            ValueError: If the token is invalid, already used, or expired.
        """
        async with get_db_session() as session:
            result = await session.execute(
                select(DocumentShareInvitation)
                .options(selectinload(DocumentShareInvitation.document))
                .where(DocumentShareInvitation.token == token)
            )
            invitation = result.scalar_one_or_none()

            if not invitation:
                raise ValueError("Invitation not found")

            if invitation.status != InvitationStatus.PENDING:
                raise ValueError(f"Invitation is {invitation.status}")

            if invitation.expires_at < now_utc():
                invitation.status = InvitationStatus.EXPIRED
                await session.commit()
                raise ValueError("Invitation has expired")

            if invitation.invitee_email.lower() != user_email.lower():
                raise ValueError("This invitation is for a different email address")

            invitation.status = InvitationStatus.ACCEPTED
            invitation.invitee_user_id = user_id
            invitation.responded_at = now_utc()

            share_id = generate_uuid()
            share = DocumentShare(
                id=share_id,
                document_id=invitation.document_id,
                shared_with_user_id=user_id,
                permission=invitation.permission,
                created_by=invitation.inviter_id,
                status=ShareStatus.ACTIVE,
                invitation_id=invitation.id,
            )
            session.add(share)

            inviter_notification = ShareNotification(
                id=generate_uuid(),
                user_id=invitation.inviter_id,
                notification_type="share_accepted",
                document_id=invitation.document_id,
                share_invitation_id=invitation.id,
                title="Invitation accepted",
                message=(
                    f"{user_email} accepted your invitation to access "
                    f"'{invitation.document.name}'"
                ),
                extra_data={
                    "document_name": invitation.document.name,
                    "accepter_email": user_email,
                    "accepter_id": user_id,
                },
            )
            session.add(inviter_notification)

            await session.commit()

            logger.info(
                "User %s accepted invitation %s for document %s",
                user_id,
                invitation.id,
                invitation.document_id,
            )

            return {
                "share_id": share_id,
                "document_id": invitation.document_id,
                "document_name": invitation.document.name,
                "permission": invitation.permission,
            }

    @staticmethod
    async def decline_invitation(token: str, user_id: str) -> dict:
        """
        Decline a share invitation.

        Notifies the inviter of the refusal.

        Args:
            token: Invitation token.
            user_id: ID of the user declining.

        Returns:
            dict: ``{"invitation_id": ..., "status": "declined"}``.

        Raises:
            ValueError: If the token is invalid or the invitation is not pending.
        """
        async with get_db_session() as session:
            result = await session.execute(
                select(DocumentShareInvitation)
                .options(selectinload(DocumentShareInvitation.document))
                .where(DocumentShareInvitation.token == token)
            )
            invitation = result.scalar_one_or_none()

            if not invitation:
                raise ValueError("Invitation not found")

            if invitation.status != InvitationStatus.PENDING:
                raise ValueError(f"Invitation is {invitation.status}")

            invitation.status = InvitationStatus.DECLINED
            invitation.responded_at = now_utc()

            inviter_notification = ShareNotification(
                id=generate_uuid(),
                user_id=invitation.inviter_id,
                notification_type="share_declined",
                document_id=invitation.document_id,
                share_invitation_id=invitation.id,
                title="Invitation declined",
                message=(
                    f"Your invitation to share '{invitation.document.name}' was declined"
                ),
                extra_data={
                    "document_name": invitation.document.name,
                },
            )
            session.add(inviter_notification)

            await session.commit()

            logger.info("User %s declined invitation %s", user_id, invitation.id)

            return {
                "invitation_id": invitation.id,
                "status": InvitationStatus.DECLINED,
            }

    @staticmethod
    async def get_invitation_by_token(token: str) -> dict:
        """
        Return the details of a share invitation identified by *token*.

        Read-only: the invitation status is **not** mutated (unlike
        :meth:`accept_invitation`, which stamps EXPIRED). An invitation past
        its expiry date is reported with the effective status ``expired``.

        Args:
            token: Invitation token (from the invitation e-mail / URL).

        Returns:
            dict: Invitation details (document, inviter, permission, status).

        Raises:
            ValueError: If no invitation exists for *token*.
        """
        async with get_db_session() as session:
            result = await session.execute(
                select(DocumentShareInvitation)
                .options(selectinload(DocumentShareInvitation.document))
                .where(DocumentShareInvitation.token == token)
            )
            invitation = result.scalar_one_or_none()

            if not invitation:
                raise ValueError("Invitation not found")

            inviter_result = await session.execute(
                select(UserQuota).where(UserQuota.user_id == invitation.inviter_id)
            )
            inviter = inviter_result.scalar_one_or_none()

            effective_status = invitation.status
            if (
                invitation.status == InvitationStatus.PENDING
                and invitation.expires_at < now_utc()
            ):
                effective_status = InvitationStatus.EXPIRED

            document = invitation.document

            return {
                "invitation_id": invitation.id,
                "status": effective_status,
                "invitee_email": invitation.invitee_email,
                "document": {
                    "id": document.id,
                    "name": document.name,
                    "page_count": document.page_count,
                    "thumbnail_path": document.thumbnail_path,
                },
                "inviter": {
                    "user_id": invitation.inviter_id,
                    "email": inviter.email if inviter else None,
                },
                "permission": invitation.permission,
                "message": invitation.message,
                "created_at": (
                    invitation.created_at.isoformat() if invitation.created_at else None
                ),
                "expires_at": (
                    invitation.expires_at.isoformat() if invitation.expires_at else None
                ),
            }

    @staticmethod
    async def get_pending_invitations(user_email: str) -> list[dict]:
        """
        Return all non-expired, pending invitations addressed to *user_email*.

        Args:
            user_email: Recipient e-mail to look up.

        Returns:
            list[dict]: Invitation details sorted by creation date (newest first).
        """
        async with get_db_session() as session:
            query = (
                select(DocumentShareInvitation, StoredDocument)
                .join(
                    StoredDocument,
                    DocumentShareInvitation.document_id == StoredDocument.id,
                )
                .where(
                    DocumentShareInvitation.invitee_email == user_email,
                    DocumentShareInvitation.status == InvitationStatus.PENDING,
                    DocumentShareInvitation.expires_at > now_utc(),
                    ~StoredDocument.is_deleted,
                )
                .order_by(DocumentShareInvitation.created_at.desc())
            )

            result = await session.execute(query)
            invitations = result.all()

            invitation_list: list[dict] = []
            for inv, doc in invitations:
                inviter_result = await session.execute(
                    select(UserQuota).where(UserQuota.user_id == inv.inviter_id)
                )
                inviter = inviter_result.scalar_one_or_none()

                invitation_list.append(
                    {
                        "invitation_id": inv.id,
                        "token": inv.token,
                        "document": {
                            "id": doc.id,
                            "name": doc.name,
                            "page_count": doc.page_count,
                            "thumbnail_path": doc.thumbnail_path,
                        },
                        "inviter": {
                            "user_id": inv.inviter_id,
                            "email": inviter.email if inviter else None,
                        },
                        "permission": inv.permission,
                        "message": inv.message,
                        "created_at": (
                            inv.created_at.isoformat() if inv.created_at else None
                        ),
                        "expires_at": (
                            inv.expires_at.isoformat() if inv.expires_at else None
                        ),
                    }
                )

            return invitation_list


# Module-level singleton — matches the pattern used in the rest of the codebase.
invitation_service = InvitationService()
