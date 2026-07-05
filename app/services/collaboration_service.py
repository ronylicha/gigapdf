"""
Collaboration Service - Real-time collaboration management.

Manages collaborative editing sessions, element locks, user presence,
and cursor tracking for real-time multi-user PDF editing.
"""

import logging
from datetime import datetime, timedelta
from uuid import uuid4

from sqlalchemy import and_, delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.models.database import CollaborationSession, ElementLock

logger = logging.getLogger(__name__)


class CollaborationManager:
    """
    Manages real-time collaboration state.

    Handles user presence, element locking, cursor tracking,
    and user color assignment for collaborative editing.
    """

    # Predefined color palette for users
    USER_COLORS = [
        "#3B82F6",  # Blue
        "#10B981",  # Green
        "#F59E0B",  # Amber
        "#EF4444",  # Red
        "#8B5CF6",  # Purple
        "#EC4899",  # Pink
        "#06B6D4",  # Cyan
        "#F97316",  # Orange
        "#14B8A6",  # Teal
        "#6366F1",  # Indigo
        "#84CC16",  # Lime
        "#F43F5E",  # Rose
    ]

    # Lock expiration time (5 minutes of inactivity)
    LOCK_EXPIRATION_SECONDS = 300

    def __init__(self):
        """Initialize collaboration manager."""
        self.logger = logger

    async def create_session(
        self,
        document_id: str,
        user_id: str,
        user_name: str,
        socket_id: str,
    ) -> CollaborationSession:
        """
        Create a new collaboration session for a user.

        Args:
            document_id: Document identifier.
            user_id: User identifier.
            user_name: User display name.
            socket_id: WebSocket connection identifier.

        Returns:
            CollaborationSession: Created session.
        """
        async with get_db_session() as session:
            # Check if user already has an active session
            stmt = select(CollaborationSession).where(
                and_(
                    CollaborationSession.document_id == document_id,
                    CollaborationSession.user_id == user_id,
                    CollaborationSession.is_active,
                )
            )
            result = await session.execute(stmt)
            existing = result.scalar_one_or_none()

            if existing:
                # Reactivate existing session with new socket
                existing.socket_id = socket_id
                existing.last_seen_at = datetime.utcnow()
                existing.is_active = True
                await session.commit()
                await session.refresh(existing)
                self.logger.info(
                    f"Reactivated session for user {user_id} on document {document_id}"
                )
                return existing

            # Assign color to user
            color = await self._assign_user_color(session, document_id)

            # Create new session
            collab_session = CollaborationSession(
                id=str(uuid4()),
                document_id=document_id,
                user_id=user_id,
                user_name=user_name,
                user_color=color,
                socket_id=socket_id,
                is_active=True,
                joined_at=datetime.utcnow(),
                last_seen_at=datetime.utcnow(),
            )

            session.add(collab_session)
            await session.commit()
            await session.refresh(collab_session)

            self.logger.info(
                f"Created collaboration session {collab_session.id} "
                f"for user {user_id} on document {document_id}"
            )

            return collab_session

    async def remove_session(
        self,
        socket_id: str,
    ) -> CollaborationSession | None:
        """
        Remove a collaboration session by socket ID.

        Also releases all element locks held by this session.

        Args:
            socket_id: WebSocket connection identifier.

        Returns:
            CollaborationSession: Removed session, or None if not found.
        """
        async with get_db_session() as session:
            # Find session by socket ID
            stmt = select(CollaborationSession).where(
                CollaborationSession.socket_id == socket_id
            )
            result = await session.execute(stmt)
            collab_session = result.scalar_one_or_none()

            if not collab_session:
                return None

            # Mark as inactive
            collab_session.is_active = False
            collab_session.last_seen_at = datetime.utcnow()

            # Release all locks held by this session
            await self._release_session_locks(
                session, collab_session.id
            )

            await session.commit()
            await session.refresh(collab_session)

            self.logger.info(
                f"Removed collaboration session {collab_session.id} "
                f"for user {collab_session.user_id}"
            )

            return collab_session

    async def get_locked_element_ids(
        self,
        socket_id: str,
    ) -> list[str]:
        """
        List the element ids currently locked by a socket's session.

        Used at disconnect/leave to tell the room which locks are about to be
        released: :meth:`remove_session` deletes the ``ElementLock`` rows but
        does not report which elements were held, and the periodic
        ``cleanup_*`` tasks expire locks silently (no broadcast). Capturing the
        ids BEFORE removal lets the caller emit ``element:unlocked`` so peers
        release the visual lock immediately instead of waiting on their client
        TTL backstop.

        Args:
            socket_id: WebSocket connection identifier.

        Returns:
            list[str]: Element ids held by this socket's session (empty when the
            socket has no active session or holds no locks).
        """
        async with get_db_session() as session:
            result = await session.execute(
                select(CollaborationSession.id).where(
                    CollaborationSession.socket_id == socket_id
                )
            )
            session_id = result.scalar_one_or_none()
            if not session_id:
                return []

            locks = await session.execute(
                select(ElementLock.element_id).where(
                    ElementLock.locked_by_session_id == session_id
                )
            )
            return list(locks.scalars().all())

    async def update_cursor(
        self,
        socket_id: str,
        page: int,
        x: float,
        y: float,
    ) -> CollaborationSession | None:
        """
        Update user cursor position.

        Args:
            socket_id: WebSocket connection identifier.
            page: Current page number.
            x: X coordinate on page.
            y: Y coordinate on page.

        Returns:
            CollaborationSession: Updated session, or None if not found.
        """
        async with get_db_session() as session:
            stmt = (
                update(CollaborationSession)
                .where(CollaborationSession.socket_id == socket_id)
                .values(
                    cursor_page=page,
                    cursor_x=x,
                    cursor_y=y,
                    last_seen_at=datetime.utcnow(),
                )
                .returning(CollaborationSession)
            )

            result = await session.execute(stmt)
            await session.commit()

            updated_session = result.scalar_one_or_none()
            return updated_session

    async def get_active_users(
        self,
        document_id: str,
    ) -> list[CollaborationSession]:
        """
        Get all active users for a document.

        Args:
            document_id: Document identifier.

        Returns:
            list[CollaborationSession]: Active collaboration sessions.
        """
        async with get_db_session() as session:
            stmt = select(CollaborationSession).where(
                and_(
                    CollaborationSession.document_id == document_id,
                    CollaborationSession.is_active,
                )
            )
            result = await session.execute(stmt)
            return list(result.scalars().all())

    async def acquire_lock(
        self,
        document_id: str,
        element_id: str,
        user_id: str,
        session_id: str,
        duration_seconds: int = LOCK_EXPIRATION_SECONDS,
    ) -> tuple[bool, ElementLock | None]:
        """
        Acquire a lock on an element for editing.

        Args:
            document_id: Document identifier.
            element_id: Element identifier.
            user_id: User identifier.
            session_id: Collaboration session identifier.
            duration_seconds: Lock duration in seconds.

        Returns:
            tuple: (success, ElementLock or existing lock)
        """
        async with get_db_session() as session:
            # Check for existing lock
            stmt = select(ElementLock).where(
                and_(
                    ElementLock.document_id == document_id,
                    ElementLock.element_id == element_id,
                )
            )
            result = await session.execute(stmt)
            existing_lock = result.scalar_one_or_none()

            now = datetime.utcnow()

            if existing_lock:
                # Check if lock has expired
                if existing_lock.expires_at > now:
                    # Lock is still valid
                    if existing_lock.locked_by_user_id == user_id:
                        # User already owns the lock - extend it
                        existing_lock.expires_at = now + timedelta(
                            seconds=duration_seconds
                        )
                        await session.commit()
                        await session.refresh(existing_lock)
                        return True, existing_lock
                    else:
                        # Lock held by another user
                        return False, existing_lock
                else:
                    # Lock has expired - delete it
                    await session.delete(existing_lock)

            # Create new lock
            new_lock = ElementLock(
                id=str(uuid4()),
                document_id=document_id,
                element_id=element_id,
                locked_by_user_id=user_id,
                locked_by_session_id=session_id,
                locked_at=now,
                expires_at=now + timedelta(seconds=duration_seconds),
            )

            session.add(new_lock)
            await session.commit()
            await session.refresh(new_lock)

            self.logger.info(
                f"Lock acquired on element {element_id} by user {user_id}"
            )

            return True, new_lock

    async def release_lock(
        self,
        document_id: str,
        element_id: str,
        user_id: str,
    ) -> bool:
        """
        Release a lock on an element.

        Args:
            document_id: Document identifier.
            element_id: Element identifier.
            user_id: User identifier (must own the lock).

        Returns:
            bool: True if lock was released, False if not found or not owned.
        """
        async with get_db_session() as session:
            stmt = delete(ElementLock).where(
                and_(
                    ElementLock.document_id == document_id,
                    ElementLock.element_id == element_id,
                    ElementLock.locked_by_user_id == user_id,
                )
            )

            result = await session.execute(stmt)
            await session.commit()

            if result.rowcount > 0:
                self.logger.info(
                    f"Lock released on element {element_id} by user {user_id}"
                )
                return True

            return False

    async def get_document_locks(
        self,
        document_id: str,
    ) -> list[ElementLock]:
        """
        Get all active locks for a document.

        Args:
            document_id: Document identifier.

        Returns:
            list[ElementLock]: Active element locks.
        """
        async with get_db_session() as session:
            now = datetime.utcnow()

            # Delete expired locks
            delete_stmt = delete(ElementLock).where(
                and_(
                    ElementLock.document_id == document_id,
                    ElementLock.expires_at <= now,
                )
            )
            await session.execute(delete_stmt)

            # Get active locks
            stmt = select(ElementLock).where(
                and_(
                    ElementLock.document_id == document_id,
                    ElementLock.expires_at > now,
                )
            )
            result = await session.execute(stmt)
            await session.commit()

            return list(result.scalars().all())

    async def cleanup_expired_locks(self) -> int:
        """
        Clean up expired locks across all documents.

        Returns:
            int: Number of locks removed.
        """
        async with get_db_session() as session:
            now = datetime.utcnow()

            stmt = delete(ElementLock).where(
                ElementLock.expires_at <= now
            )

            result = await session.execute(stmt)
            await session.commit()

            count = result.rowcount
            if count > 0:
                self.logger.info(f"Cleaned up {count} expired locks")

            return count

    async def cleanup_inactive_sessions(
        self,
        timeout_minutes: int = 60,
    ) -> int:
        """
        Clean up inactive collaboration sessions.

        Args:
            timeout_minutes: Session timeout in minutes.

        Returns:
            int: Number of sessions cleaned up.
        """
        async with get_db_session() as session:
            cutoff_time = datetime.utcnow() - timedelta(minutes=timeout_minutes)

            # Find inactive sessions
            stmt = select(CollaborationSession).where(
                and_(
                    CollaborationSession.is_active,
                    CollaborationSession.last_seen_at < cutoff_time,
                )
            )
            result = await session.execute(stmt)
            inactive_sessions = result.scalars().all()

            # Mark as inactive and release locks
            count = 0
            for collab_session in inactive_sessions:
                collab_session.is_active = False
                await self._release_session_locks(
                    session, collab_session.id
                )
                count += 1

            await session.commit()

            if count > 0:
                self.logger.info(f"Cleaned up {count} inactive sessions")

            return count

    async def _assign_user_color(
        self,
        session: AsyncSession,
        document_id: str,
    ) -> str:
        """
        Assign a unique color to a user.

        Tries to assign a color not currently in use by other active users.

        Args:
            session: Database session.
            document_id: Document identifier.

        Returns:
            str: Hex color code.
        """
        # Get colors already in use
        stmt = select(CollaborationSession.user_color).where(
            and_(
                CollaborationSession.document_id == document_id,
                CollaborationSession.is_active,
            )
        )
        result = await session.execute(stmt)
        used_colors = set(result.scalars().all())

        # Find an unused color
        for color in self.USER_COLORS:
            if color not in used_colors:
                return color

        # All colors in use - return first color (will duplicate)
        return self.USER_COLORS[0]

    async def _release_session_locks(
        self,
        session: AsyncSession,
        session_id: str,
    ) -> int:
        """
        Release all locks held by a collaboration session.

        Args:
            session: Database session.
            session_id: Collaboration session identifier.

        Returns:
            int: Number of locks released.
        """
        stmt = delete(ElementLock).where(
            ElementLock.locked_by_session_id == session_id
        )

        result = await session.execute(stmt)
        count = result.rowcount

        if count > 0:
            self.logger.info(
                f"Released {count} locks for session {session_id}"
            )

        return count


# Global service instance
collaboration_manager = CollaborationManager()
