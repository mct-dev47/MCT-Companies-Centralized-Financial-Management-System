from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.dependencies import AdminUser
from app.db.session import get_db
from app.models.invitation import InvitationOutbox
from app.schemas.auth import MessageResponse
from app.services.user_service import UserService, UserValidationError

router = APIRouter()


@router.post("/{job_id}/replay", response_model=MessageResponse, summary="Administrative replay for dead-letter invitation job")
def replay_invitation_job(
    job_id: int,
    _: AdminUser,
    db: Session = Depends(get_db),
):
    """
    Administrative recovery for an invitation outbox job.
    Validates current user state, revokes obsolete invitations,
    and enqueues a fresh invitation and outbox job.
    """
    job = db.query(InvitationOutbox).filter(InvitationOutbox.job_id == job_id).first()
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invitation outbox job not found.",
        )

    try:
        UserService(db).reinvite_user(job.user_id)
        return MessageResponse(
            message=f"Fresh invitation successfully generated and enqueued for user {job.user_id}.",
            success=True,
        )
    except UserValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

