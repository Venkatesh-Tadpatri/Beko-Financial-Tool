from __future__ import annotations

import logging
from datetime import timedelta

import pytest
from fastapi import Depends
from sqlalchemy import text

from app.api.deps import Principal, require
from app.core import clock
from app.core.permissions import Perm
from app.models.base import utcnow
from app.services import audit

GOOD = "Str0ng!Passw0rd"
ADMIN = {"username": "founder", "password": GOOD, "confirm_password": GOOD, "display_name": "Founder"}


class Clock:
    def __init__(self):
        self.offset = timedelta()

    def __call__(self):
        return utcnow() + self.offset

    def advance(self, **kw):
        self.offset += timedelta(**kw)


@pytest.fixture
def fake_clock(monkeypatch):
    c = Clock()
    monkeypatch.setattr(clock, "now", c)
    return c


@pytest.fixture
def app_client(client):
    """Client with an extra route guarded by a permission, to exercise the guards."""

    @client.app.get("/api/_test/upload")
    def _probe(p: Principal = Depends(require(Perm.UPLOAD_DATA))):
        return {"ok": True}

    return client


def setup_admin(client):
    r = client.post("/api/setup/super-admin", json=ADMIN)
    assert r.status_code == 201, r.text
    return r.json()


def login(client, username="founder", password=GOOD):
    return client.post("/api/auth/login", json={"username": username, "password": password})


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def db_exec(client, sql, **params):
    with client.app.state.fvt.session_factory() as s:
        rows = s.execute(text(sql), params)
        out = rows.fetchall() if rows.returns_rows else None
        s.commit()
        return out


def audit_actions(client):
    return [r[0] for r in db_exec(client, "SELECT action FROM audit_log ORDER BY id")]


# ------------------------------------------------------------------ first run


def test_fresh_install_needs_setup_and_nothing_else_is_reachable(app_client):
    s = app_client.get("/api/system/status").json()
    assert s["needs_setup"] is True and s["mode"] == "ready"
    assert app_client.get("/api/auth/me").status_code == 401
    assert app_client.get("/api/_test/upload").status_code == 401
    assert login(app_client).status_code == 401


@pytest.mark.parametrize(("password", "fragment"), [
    ("Sh0rt!", "at least 10 characters"),
    ("alllowercase1!", "an upper-case letter"),
    ("ALLUPPERCASE1!", "a lower-case letter"),
    ("NoDigitsHere!!", "a digit"),
    ("NoSymbols12345", "a symbol"),
    ("Founder!12345", "not containing the username"),
])
def test_setup_enforces_password_policy(client, password, fragment):
    r = client.post("/api/setup/super-admin", json={**ADMIN, "password": password, "confirm_password": password})
    assert r.status_code == 400
    assert fragment in r.json()["detail"]["message"]


def test_setup_rejects_mismatch_and_bad_username(client):
    r = client.post("/api/setup/super-admin", json={**ADMIN, "confirm_password": GOOD + "x"})
    assert r.json()["detail"]["code"] == "password_mismatch"
    r = client.post("/api/setup/super-admin", json={**ADMIN, "username": "a b"})
    assert r.json()["detail"]["code"] == "invalid_username"


def test_email_address_works_as_username(client):
    r = client.post("/api/setup/super-admin", json={**ADMIN, "username": "admin@beko-technologies.com"})
    assert r.status_code == 201, r.text
    assert login(client, username="Admin@Beko-Technologies.com").status_code == 200


def test_setup_works_once_only(client):
    user = setup_admin(client)
    assert user["role"] == "super_admin" and "manage_users" in user["permissions"]
    r = client.post("/api/setup/super-admin", json={**ADMIN, "username": "intruder"})
    assert r.status_code == 409
    assert client.get("/api/system/status").json()["needs_setup"] is False
    assert db_exec(client, "SELECT is_founder FROM users")[0][0] == 1


# ------------------------------------------------------------------ login


def test_login_and_me(client):
    setup_admin(client)
    r = login(client)
    assert r.status_code == 200
    body = r.json()
    assert body["idle_timeout_seconds"] == 900 and len(body["token"]) >= 40
    me = client.get("/api/auth/me", headers=auth(body["token"]))
    assert me.status_code == 200 and me.json()["username"] == "founder"


def test_username_is_case_insensitive_at_login(client):
    setup_admin(client)
    assert login(client, username="FOUNDER").status_code == 200


def test_wrong_password_and_unknown_user_look_identical(client):
    setup_admin(client)
    a, b = login(client, password="Wrong!Passw0rd"), login(client, username="nobody")
    assert a.status_code == b.status_code == 401
    assert a.json() == b.json()


def test_lockout_after_five_failures_for_five_minutes(client, fake_clock):
    setup_admin(client)
    for _ in range(5):
        assert login(client, password="Wrong!Passw0rd").status_code == 401
    r = login(client)  # correct password, but locked
    assert r.status_code == 423 and "5 minutes" in r.json()["detail"]["message"]
    fake_clock.advance(minutes=4, seconds=50)
    assert login(client).status_code == 423
    fake_clock.advance(seconds=15)
    assert login(client).status_code == 200
    assert "account_locked" in audit_actions(client)


def test_success_resets_failure_counter(client):
    setup_admin(client)
    for _ in range(4):
        login(client, password="Wrong!Passw0rd")
    assert login(client).status_code == 200
    for _ in range(4):
        login(client, password="Wrong!Passw0rd")
    assert login(client).status_code == 200  # still not locked


def test_disabled_user_cannot_log_in(client):
    setup_admin(client)
    db_exec(client, "INSERT INTO users (username, display_name, password_hash, role, is_active, is_founder, "
                    "must_change_password, failed_attempts, created_at, updated_at) "
                    "SELECT 'ex', 'Ex', password_hash, 'viewer', 0, 0, 0, 0, created_at, updated_at FROM users")
    r = login(client, username="ex")
    assert r.status_code == 401 and r.json()["detail"]["code"] == "invalid_credentials"


# ------------------------------------------------------------------ sessions


def test_logout_revokes_token(client):
    setup_admin(client)
    token = login(client).json()["token"]
    assert client.post("/api/auth/logout", headers=auth(token)).status_code == 204
    assert client.get("/api/auth/me", headers=auth(token)).status_code == 401
    assert audit_actions(client)[-1] == "logout"


def test_idle_timeout_signs_out_after_15_minutes(client, fake_clock):
    setup_admin(client)
    token = login(client).json()["token"]
    fake_clock.advance(minutes=14)
    assert client.get("/api/auth/me", headers=auth(token)).status_code == 200  # activity resets the timer
    fake_clock.advance(minutes=14)
    assert client.post("/api/auth/heartbeat", headers=auth(token)).status_code == 204
    fake_clock.advance(minutes=15, seconds=1)
    r = client.get("/api/auth/me", headers=auth(token))
    assert r.status_code == 401 and r.json()["detail"]["code"] == "session_expired"
    assert client.get("/api/auth/me", headers=auth(token)).json()["detail"]["code"] == "not_authenticated"
    rows = db_exec(client, "SELECT action, details FROM audit_log ORDER BY id DESC LIMIT 1")
    assert rows[0][0] == "logout" and "idle_timeout" in rows[0][1]


def test_garbage_tokens_rejected(client):
    setup_admin(client)
    for h in ({}, {"Authorization": "Bearer "}, {"Authorization": "Bearer abc"}, {"Authorization": "Basic x"}):
        assert client.get("/api/auth/me", headers=h).status_code == 401


# ------------------------------------------------------------------ password change


def test_forced_password_change_blocks_everything_else(app_client):
    setup_admin(app_client)
    token = login(app_client).json()["token"]
    db_exec(app_client, "UPDATE users SET must_change_password = 1")
    assert app_client.get("/api/auth/me", headers=auth(token)).json()["must_change_password"] is True
    r = app_client.get("/api/_test/upload", headers=auth(token))
    assert r.status_code == 403 and r.json()["detail"]["code"] == "password_change_required"
    new = "N3w!Secure#Pass"
    r = app_client.post("/api/auth/change-password", headers=auth(token),
                        json={"current_password": GOOD, "new_password": new, "confirm_password": new})
    assert r.status_code == 204
    assert app_client.get("/api/_test/upload", headers=auth(token)).status_code == 200


def test_change_password_rules_and_other_sessions_signed_out(client):
    setup_admin(client)
    t1 = login(client).json()["token"]
    t2 = login(client).json()["token"]
    def change(cur, new, conf=None):
        return client.post("/api/auth/change-password", headers=auth(t1),
                           json={"current_password": cur, "new_password": new, "confirm_password": conf or new})
    assert change("Wrong!Passw0rd", "N3w!Secure#Pass").json()["detail"]["code"] == "wrong_password"
    assert change(GOOD, GOOD).json()["detail"]["code"] == "password_reused"
    assert change(GOOD, "weak").json()["detail"]["code"] == "weak_password"
    assert change(GOOD, "N3w!Secure#Pass", "different").json()["detail"]["code"] == "password_mismatch"
    assert change(GOOD, "N3w!Secure#Pass").status_code == 204
    assert client.get("/api/auth/me", headers=auth(t1)).status_code == 200
    assert client.get("/api/auth/me", headers=auth(t2)).status_code == 401
    assert login(client).status_code == 401
    assert login(client, password="N3w!Secure#Pass").status_code == 200


# ------------------------------------------------------------------ secrets at rest


def test_passwords_are_not_readable_in_the_database_file(client, settings, caplog):
    caplog.set_level(logging.DEBUG)
    setup_admin(client)
    login(client)
    login(client, password="Wrong!Guess123")
    token = login(client).json()["token"]
    client.app.state.fvt.close_database()  # flush WAL into the file
    blob = b"".join(p.read_bytes() for p in settings.paths.data_dir.iterdir() if p.is_file())
    for secret in (GOOD, "Wrong!Guess123", token):
        assert secret.encode() not in blob
        assert secret.encode("utf-16-le") not in blob
        assert secret not in caplog.text
    assert b"$argon2id$" in blob


def test_audit_log_records_and_chain_verifies(client):
    setup_admin(client)
    token = login(client).json()["token"]
    login(client, password="Wrong!Passw0rd")
    client.post("/api/auth/logout", headers=auth(token))
    assert audit_actions(client) == ["setup_super_admin", "login", "login_failed", "logout"]
    with client.app.state.fvt.session_factory() as s:
        assert audit.verify_chain(s) == {"ok": True, "entries_checked": 4, "first_bad_id": None}
        s.rollback()


def test_audit_chain_detects_tampering_outside_the_app(client):
    setup_admin(client)
    login(client)
    db_exec(client, "DROP TRIGGER trg_audit_log_no_update")  # what an attacker with the file could do
    db_exec(client, "UPDATE audit_log SET username = 'someone_else' WHERE action = 'login'")
    with client.app.state.fvt.session_factory() as s:
        result = audit.verify_chain(s)
        s.rollback()
    assert result["ok"] is False and result["first_bad_id"] == 2


@pytest.mark.real_hashing
def test_production_hash_parameters():
    from app.core.security import hash_password

    h = hash_password("Str0ng!Passw0rd")
    assert h.startswith("$argon2id$") and "m=65536,t=3,p=4" in h


def test_audit_refuses_secret_fields(session_factory):
    with session_factory() as s:
        with pytest.raises(ValueError):
            audit.record(s, "x", details={"password": "nope"})


def test_routes_refuse_while_in_recovery(client):
    from app.state import Mode
    client.app.state.fvt.mode = Mode.RECOVERY
    assert login(client).status_code == 503
    assert client.get("/api/auth/me").status_code == 503
    assert client.get("/api/system/status").json()["mode"] == "recovery"
