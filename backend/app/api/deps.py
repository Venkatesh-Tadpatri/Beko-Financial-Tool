"""Request dependencies: database session, authenticated user, permission checks."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import timedelta

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import clock
from app.core.permissions import Perm, has_perm
from app.core.security import token_hash
from app.models import User, UserSession
from app.services import audit
from app.state import AppState, Mode


def get_state(request: Request) -> AppState:
    return request.app.state.fvt


def get_db(state: AppState = Depends(get_state)) -> Iterator[Session]:
    """One transaction per request: commit on success, roll back on any error (including HTTPException)."""
    if state.mode != Mode.READY or state.session_factory is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail={"code": "not_ready", "mode": state.mode.value})
    session = state.session_factory()
    try:
        yield session
        session.commit()
    except BaseException:
        session.rollback()
        raise
    finally:
        session.close()


@dataclass
class Principal:
    user: User
    session: UserSession


def _unauthorized(code: str, message: str) -> HTTPException:
    return HTTPException(status.HTTP_401_UNAUTHORIZED, detail={"code": code, "message": message},
                         headers={"WWW-Authenticate": "Bearer"})


def _expire_idle(state: AppState, sess_id: int) -> None:
    """Revoke and audit an idle session in its own transaction (the request itself is rejected)."""
    with state.session_factory() as s:  # type: ignore[misc]
        sess = s.get(UserSession, sess_id)
        if sess is not None and sess.revoked_at is None:
            sess.revoked_at = clock.now()
            sess.revoke_reason = "idle_timeout"
            user = s.get(User, sess.user_id)
            audit.record(s, "logout", user=user, entity_type="session", entity_id=sess.id,
                         details={"reason": "idle_timeout"})
        s.commit()


def _authenticate(request: Request, db: Session, state: AppState) -> Principal:
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        raise _unauthorized("not_authenticated", "Please sign in.")
    sess = db.scalar(select(UserSession).where(UserSession.token_hash == token_hash(header[7:].strip())))
    if sess is None or sess.revoked_at is not None:
        raise _unauthorized("not_authenticated", "Please sign in.")
    now = clock.now()
    if now - sess.last_activity_at > timedelta(minutes=state.settings.idle_timeout_minutes):
        sess_id = sess.id
        db.rollback()  # release this request's write lock before the separate audit transaction
        _expire_idle(state, sess_id)
        raise _unauthorized("session_expired", "You were signed out after 15 minutes of inactivity.")
    user = db.get(User, sess.user_id)
    if user is None or not user.is_active:
        raise _unauthorized("not_authenticated", "Please sign in.")
    sess.last_activity_at = now
    return Principal(user, sess)


def current_principal_allow_pw_change(request: Request, db: Session = Depends(get_db),
                                      state: AppState = Depends(get_state)) -> Principal:
    """Authenticated, even if the user must still change their password (me / change-password / logout)."""
    return _authenticate(request, db, state)


def current_principal(principal: Principal = Depends(current_principal_allow_pw_change)) -> Principal:
    if principal.user.must_change_password:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            detail={"code": "password_change_required",
                                    "message": "You must change your password before continuing."})
    return principal


def authenticate_short(request: Request, state: AppState, perm: Perm, db: Session) -> Principal:
    """Same checks as require(perm), for routes that manage their own (short) transaction."""
    principal = _authenticate(request, db, state)
    if principal.user.must_change_password:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail={"code": "password_change_required",
                                                               "message": "You must change your password before continuing."})
    if not has_perm(principal.user.role, perm):
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            detail={"code": "forbidden", "message": "You do not have permission for this."})
    return principal


@contextmanager
def short_transaction(request: Request, state: AppState, perm: Perm) -> Iterator[tuple[Session, Principal]]:
    """Authenticate and do the work in one transaction that is COMMITTED when the block ends,
    so the caller can act on the committed result (e.g. take a backup that includes it)."""
    if state.mode != Mode.READY or state.session_factory is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail={"code": "not_ready", "mode": state.mode.value})
    session = state.session_factory()
    try:
        principal = authenticate_short(request, state, perm, session)
        yield session, principal
        session.commit()
    except BaseException:
        session.rollback()
        raise
    finally:
        session.close()


def require(perm: Perm):
    """Route dependency: authenticated, password current, and holding `perm`."""

    def dependency(principal: Principal = Depends(current_principal)) -> Principal:
        if not has_perm(principal.user.role, perm):
            raise HTTPException(status.HTTP_403_FORBIDDEN,
                                detail={"code": "forbidden", "message": "You do not have permission for this."})
        return principal

    dependency.__name__ = f"require_{perm.value}"
    return dependency
