"""First-run setup, login, logout, session and password change."""

from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import __version__
from app.api.deps import (
    Principal,
    current_principal,
    current_principal_allow_pw_change,
    get_db,
    get_state,
)
from app.core import clock
from app.core.db import transaction
from app.core.permissions import perms_for
from app.core.security import (
    hash_password,
    needs_rehash,
    new_session_token,
    password_problems,
    token_hash,
    username_problem,
    verify_password,
)
from app.models import Role, User, UserSession
from app.schemas.auth import (
    ChangePasswordAtLoginRequest,
    ChangePasswordRequest,
    LoginRequest,
    LoginResponse,
    SetupRequest,
    SystemStatus,
    UserOut,
)
from app.services import audit
from app.state import AppState, Mode

router = APIRouter(prefix="/api")

POLICY_TEXT = "At least 10 characters, with an upper-case letter, a lower-case letter, a digit and a symbol."
GENERIC_LOGIN_ERROR = "Invalid username or password."


def _bad_request(code: str, message: str) -> HTTPException:
    return HTTPException(status.HTTP_400_BAD_REQUEST, detail={"code": code, "message": message})


def _policy_error(problems: list[str]) -> HTTPException:
    return _bad_request("weak_password", "Password must have " + ", ".join(problems) + ".")


def user_out(user: User) -> UserOut:
    return UserOut(id=user.id, username=user.username, display_name=user.display_name, role=user.role,
                   must_change_password=user.must_change_password, permissions=perms_for(user.role))


# ------------------------------------------------------------------ status / setup


@router.get("/system/status", response_model=SystemStatus)
def system_status(state: AppState = Depends(get_state)) -> SystemStatus:
    needs_setup = False
    if state.mode == Mode.READY and state.session_factory is not None:
        with state.session_factory() as s:
            needs_setup = (s.scalar(select(func.count()).select_from(User)) or 0) == 0
            s.rollback()
    recovery = None
    if state.mode == Mode.RECOVERY:
        recovery = {"code": state.recovery_code, "message": state.problems[0] if state.problems else ""}
    return SystemStatus(mode=state.mode.value, needs_setup=needs_setup, version=__version__,
                        recovery=recovery, password_policy=POLICY_TEXT)


@router.post("/setup/super-admin", status_code=status.HTTP_201_CREATED, response_model=UserOut)
def setup_super_admin(body: SetupRequest, db: Session = Depends(get_db)) -> UserOut:
    # get_db opened the transaction with BEGIN IMMEDIATE, so two simultaneous
    # setup requests cannot both see zero users.
    if (db.scalar(select(func.count()).select_from(User)) or 0) > 0:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            detail={"code": "already_set_up", "message": "The super admin already exists."})
    username = body.username.strip()
    if problem := username_problem(username):
        raise _bad_request("invalid_username", problem)
    if body.password != body.confirm_password:
        raise _bad_request("password_mismatch", "The passwords do not match.")
    if problems := password_problems(body.password, username):
        raise _policy_error(problems)
    now = clock.now()
    user = User(username=username, display_name=body.display_name.strip() or username,
                password_hash=hash_password(body.password), role=Role.SUPER_ADMIN.value, is_founder=True,
                password_changed_at=now)
    db.add(user)
    db.flush()
    audit.record(db, "setup_super_admin", user=user, entity_type="user", entity_id=user.id)
    return user_out(user)


# ------------------------------------------------------------------ login / logout


def _check_credentials(db: Session, settings, username: str, password: str) -> tuple[User | None, HTTPException | None]:
    """Shared by sign-in and change-password-at-sign-in: same lockout, same generic errors, same audit."""
    now = clock.now()
    user = db.scalar(select(User).where(User.username == username))
    if user is not None and user.locked_until is not None and user.locked_until > now:
        minutes = max(1, int((user.locked_until - now).total_seconds() // 60) + 1)
        audit.record(db, "login_blocked", user=user, details={"reason": "locked"})
        return None, HTTPException(status.HTTP_423_LOCKED, detail={
            "code": "account_locked",
            "message": f"Too many failed attempts. Try again in {minutes} minute{'s' if minutes > 1 else ''}."})
    if not verify_password(user.password_hash if user else None, password):
        if user is None:
            audit.record(db, "login_failed", username=username[:64], details={"reason": "unknown_user"})
        else:
            user.failed_attempts += 1
            if user.failed_attempts >= settings.lockout_threshold:
                user.locked_until = now + timedelta(minutes=settings.lockout_minutes)
                user.failed_attempts = 0
                audit.record(db, "account_locked", user=user, details={"minutes": settings.lockout_minutes})
            else:
                audit.record(db, "login_failed", user=user,
                             details={"reason": "bad_password", "attempt": user.failed_attempts})
        return None, HTTPException(status.HTTP_401_UNAUTHORIZED,
                                   detail={"code": "invalid_credentials", "message": GENERIC_LOGIN_ERROR})
    if not user.is_active:
        audit.record(db, "login_failed", user=user, details={"reason": "disabled"})
        return None, HTTPException(status.HTTP_401_UNAUTHORIZED,
                                   detail={"code": "invalid_credentials", "message": GENERIC_LOGIN_ERROR})
    user.failed_attempts = 0
    user.locked_until = None
    return user, None


def _require_ready(state: AppState) -> None:
    if state.mode != Mode.READY or state.session_factory is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail={"code": "not_ready", "mode": state.mode.value})


def _new_password_error(username: str, current: str, new: str, confirm: str) -> HTTPException | None:
    if new != confirm:
        return _bad_request("password_mismatch", "The new passwords do not match.")
    if new == current:
        return _bad_request("password_reused", "The new password must be different from the current one.")
    if problems := password_problems(new, username):
        return _policy_error(problems)
    return None


@router.post("/auth/login", response_model=LoginResponse)
def login(body: LoginRequest, state: AppState = Depends(get_state)) -> LoginResponse:
    _require_ready(state)
    settings = state.settings
    # Failed attempts must be committed even though the request fails, so this
    # route manages its own transaction and raises only after it commits.
    error: HTTPException | None = None
    result: LoginResponse | None = None
    with transaction(state.session_factory) as db:
        now = clock.now()
        user, error = _check_credentials(db, settings, body.username.strip(), body.password)
        if user is not None:
            user.last_login_at = now
            if needs_rehash(user.password_hash):
                user.password_hash = hash_password(body.password)
            token = new_session_token()
            sess = UserSession(token_hash=token_hash(token), user_id=user.id, created_at=now, last_activity_at=now)
            db.add(sess)
            db.flush()
            audit.record(db, "login", user=user, entity_type="session", entity_id=sess.id)
            result = LoginResponse(token=token, user=user_out(user),
                                   idle_timeout_seconds=settings.idle_timeout_minutes * 60)
    if error is not None:
        raise error
    assert result is not None
    return result


@router.post("/auth/change-password-at-login", status_code=status.HTTP_204_NO_CONTENT)
def change_password_at_login(body: ChangePasswordAtLoginRequest, state: AppState = Depends(get_state)) -> None:
    """Change a password from the sign-in screen with username + current password.

    Wrong credentials count towards the same 5-attempt lockout as sign-in. On
    success every session of the user is signed out; they then sign in normally.
    """
    _require_ready(state)
    error: HTTPException | None = None
    with transaction(state.session_factory) as db:
        username = body.username.strip()
        user, error = _check_credentials(db, state.settings, username, body.current_password)
        if user is not None:
            error = _new_password_error(user.username, body.current_password, body.new_password, body.confirm_password)
            if error is None:
                now = clock.now()
                user.password_hash = hash_password(body.new_password)
                user.must_change_password = False
                user.password_changed_at = now
                for s in db.scalars(select(UserSession).where(UserSession.user_id == user.id,
                                                              UserSession.revoked_at.is_(None))):
                    s.revoked_at, s.revoke_reason = now, "password_changed"
                audit.record(db, "password_changed", user=user, entity_type="user", entity_id=user.id,
                             details={"from": "sign_in_screen"})
    if error is not None:
        raise error


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(p: Principal = Depends(current_principal_allow_pw_change), db: Session = Depends(get_db)) -> None:
    p.session.revoked_at = clock.now()
    p.session.revoke_reason = "logout"
    audit.record(db, "logout", user=p.user, entity_type="session", entity_id=p.session.id,
                 details={"reason": "user"})


@router.get("/auth/me", response_model=UserOut)
def me(p: Principal = Depends(current_principal_allow_pw_change)) -> UserOut:
    return user_out(p.user)


@router.post("/auth/heartbeat", status_code=status.HTTP_204_NO_CONTENT)
def heartbeat(_: Principal = Depends(current_principal)) -> None:
    """Sent by the UI only when the user is actually active; refreshes the idle timer."""


@router.post("/auth/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(body: ChangePasswordRequest, request: Request,
                    p: Principal = Depends(current_principal_allow_pw_change),
                    db: Session = Depends(get_db)) -> None:
    user = p.user
    if not verify_password(user.password_hash, body.current_password):
        raise _bad_request("wrong_password", "Your current password is not correct.")
    if error := _new_password_error(user.username, body.current_password, body.new_password, body.confirm_password):
        raise error
    now = clock.now()
    user.password_hash = hash_password(body.new_password)
    user.must_change_password = False
    user.password_changed_at = now
    # Sign out every other session of this user.
    for other in db.scalars(select(UserSession).where(UserSession.user_id == user.id,
                                                      UserSession.revoked_at.is_(None),
                                                      UserSession.id != p.session.id)):
        other.revoked_at = now
        other.revoke_reason = "password_changed"
    audit.record(db, "password_changed", user=user, entity_type="user", entity_id=user.id)
