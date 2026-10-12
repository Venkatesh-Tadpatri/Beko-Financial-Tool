"""User management (Super Admin only). Users are never deleted, only disabled."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import Principal, get_db, require
from app.core import clock
from app.core.permissions import Perm
from app.core.security import hash_password, password_problems, username_problem
from app.models import User, UserSession
from app.schemas.users import CreateUserRequest, ResetPasswordRequest, UpdateUserRequest, UserRow
from app.services import audit

router = APIRouter(prefix="/api/users", tags=["users"])
manage = require(Perm.MANAGE_USERS)


def _err(code: int, key: str, message: str) -> HTTPException:
    return HTTPException(code, detail={"code": key, "message": message})


def row(u: User) -> UserRow:
    now = clock.now()
    return UserRow(id=u.id, username=u.username, display_name=u.display_name, role=u.role, is_active=u.is_active,
                   is_founder=u.is_founder, must_change_password=u.must_change_password,
                   locked=bool(u.locked_until and u.locked_until > now), last_login_at=u.last_login_at,
                   created_at=u.created_at)


def _get(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise _err(404, "not_found", "User not found.")
    return user


def _revoke_sessions(db: Session, user: User, reason: str) -> None:
    now = clock.now()
    for s in db.scalars(select(UserSession).where(UserSession.user_id == user.id, UserSession.revoked_at.is_(None))):
        s.revoked_at = now
        s.revoke_reason = reason


def _flush_guarded(db: Session) -> None:
    """Database triggers are the last line of defence; turn their refusal into a clear message."""
    try:
        db.flush()
    except IntegrityError as exc:
        text = str(exc.orig)
        if "at least one active super admin" in text:
            raise _err(409, "last_super_admin", "At least one active Super Admin must always exist.") from exc
        if "founder" in text:
            raise _err(409, "founder_protected", "The original Super Admin cannot be changed this way.") from exc
        raise


@router.get("", response_model=list[UserRow])
def list_users(_: Principal = Depends(manage), db: Session = Depends(get_db)) -> list[UserRow]:
    return [row(u) for u in db.scalars(select(User).order_by(User.username))]


def _check_new_password(username: str, password: str, confirm: str) -> None:
    if password != confirm:
        raise _err(400, "password_mismatch", "The passwords do not match.")
    if problems := password_problems(password, username):
        raise _err(400, "weak_password", "Password must have " + ", ".join(problems) + ".")


@router.post("", response_model=UserRow, status_code=status.HTTP_201_CREATED)
def create_user(body: CreateUserRequest, p: Principal = Depends(manage), db: Session = Depends(get_db)) -> UserRow:
    username = body.username.strip()
    if problem := username_problem(username):
        raise _err(400, "invalid_username", problem)
    if db.scalar(select(User).where(User.username == username)):
        raise _err(409, "username_taken", f'The username "{username}" is already in use.')
    _check_new_password(username, body.password, body.confirm_password)
    user = User(username=username, display_name=body.display_name.strip() or username, role=body.role,
                password_hash=hash_password(body.password), must_change_password=True)
    db.add(user)
    db.flush()
    audit.record(db, "user_created", user=p.user, entity_type="user", entity_id=user.id,
                 details={"username": username, "role": body.role})
    return row(user)


@router.patch("/{user_id}", response_model=UserRow)
def update_user(user_id: int, body: UpdateUserRequest, p: Principal = Depends(manage),
                db: Session = Depends(get_db)) -> UserRow:
    user = _get(db, user_id)
    changes: dict = {}
    if body.display_name is not None and body.display_name.strip() != user.display_name:
        changes["display_name"] = [user.display_name, body.display_name.strip()]
        user.display_name = body.display_name.strip()
    if body.role is not None and body.role != user.role:
        if user.is_founder:
            raise _err(409, "founder_protected", "The original Super Admin's role cannot be changed.")
        changes["role"] = [user.role, body.role]
        user.role = body.role
        _revoke_sessions(db, user, "role_changed")  # new permissions take effect at next sign-in
    if changes:
        _flush_guarded(db)
        audit.record(db, "user_updated", user=p.user, entity_type="user", entity_id=user.id,
                     details={"username": user.username, "changes": changes})
    return row(user)


@router.post("/{user_id}/disable", response_model=UserRow)
def disable_user(user_id: int, p: Principal = Depends(manage), db: Session = Depends(get_db)) -> UserRow:
    user = _get(db, user_id)
    if user.is_founder:
        raise _err(409, "founder_protected", "The original Super Admin cannot be disabled.")
    if user.id == p.user.id:
        raise _err(409, "cannot_disable_self", "You cannot disable your own account.")
    if user.is_active:
        user.is_active = False
        _revoke_sessions(db, user, "disabled")
        _flush_guarded(db)
        audit.record(db, "user_disabled", user=p.user, entity_type="user", entity_id=user.id,
                     details={"username": user.username})
    return row(user)


@router.post("/{user_id}/enable", response_model=UserRow)
def enable_user(user_id: int, p: Principal = Depends(manage), db: Session = Depends(get_db)) -> UserRow:
    user = _get(db, user_id)
    if not user.is_active:
        user.is_active = True
        audit.record(db, "user_enabled", user=p.user, entity_type="user", entity_id=user.id,
                     details={"username": user.username})
    return row(user)


@router.post("/{user_id}/reset-password", response_model=UserRow)
def reset_password(user_id: int, body: ResetPasswordRequest, p: Principal = Depends(manage),
                   db: Session = Depends(get_db)) -> UserRow:
    user = _get(db, user_id)
    _check_new_password(user.username, body.password, body.confirm_password)
    user.password_hash = hash_password(body.password)
    user.must_change_password = True
    user.failed_attempts = 0
    user.locked_until = None
    _revoke_sessions(db, user, "password_reset")
    audit.record(db, "password_reset", user=p.user, entity_type="user", entity_id=user.id,
                 details={"username": user.username})
    return row(user)


@router.post("/{user_id}/unlock", response_model=UserRow)
def unlock_user(user_id: int, p: Principal = Depends(manage), db: Session = Depends(get_db)) -> UserRow:
    user = _get(db, user_id)
    user.failed_attempts = 0
    user.locked_until = None
    audit.record(db, "user_unlocked", user=p.user, entity_type="user", entity_id=user.id,
                 details={"username": user.username})
    return row(user)
