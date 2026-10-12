"""Built-in Super Admin and changing a password from the sign-in screen."""

from __future__ import annotations

import dataclasses
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.services.bootstrap import DEFAULT_ADMIN_USERNAME
from tests.api_helpers import GOOD, actions, auth, db_exec, login, make_user, setup_and_login

STARTING = "Bekohyd@2026"


@pytest.fixture
def fresh(settings):
    """The application exactly as installed: built-in admin enabled."""
    s = dataclasses.replace(settings, bootstrap_admin=True)
    with TestClient(create_app(s), headers={"X-App-Key": s.app_key}) as c:
        yield c


@pytest.mark.real_hashing
def test_fresh_install_has_the_built_in_admin_who_must_change_password(fresh):
    status = fresh.get("/api/system/status").json()
    assert status["needs_setup"] is False
    assert fresh.post("/api/setup/super-admin", json={"username": "x", "password": GOOD, "confirm_password": GOOD}).status_code == 409

    token = login(fresh, DEFAULT_ADMIN_USERNAME, STARTING)
    me = fresh.get("/api/auth/me", headers=auth(token)).json()
    assert me["role"] == "super_admin" and me["must_change_password"] is True
    # nothing else is reachable with the starting password
    r = fresh.get("/api/users", headers=auth(token))
    assert r.status_code == 403 and r.json()["detail"]["code"] == "password_change_required"

    r = fresh.post("/api/auth/change-password", headers=auth(token),
                   json={"current_password": STARTING, "new_password": GOOD, "confirm_password": GOOD})
    assert r.status_code == 204
    assert fresh.get("/api/users", headers=auth(token)).status_code == 200
    assert fresh.post("/api/auth/login", json={"username": DEFAULT_ADMIN_USERNAME, "password": STARTING}).status_code == 401
    assert actions(fresh)[0] == "default_admin_created"


def test_built_in_admin_is_created_once_and_is_protected(fresh, settings):
    rows = db_exec(fresh, "SELECT username, is_founder, must_change_password FROM users")
    assert rows == [(DEFAULT_ADMIN_USERNAME, 1, 1)]
    fresh.app.state.fvt.close_database()
    s = dataclasses.replace(settings, bootstrap_admin=True)
    with TestClient(create_app(s), headers={"X-App-Key": s.app_key}) as again:  # restart: not created twice
        assert db_exec(again, "SELECT COUNT(*) FROM users")[0][0] == 1


def test_starting_password_is_not_in_the_source_code():
    app_dir = Path(__file__).resolve().parents[1] / "app"
    for f in app_dir.rglob("*.py"):
        assert STARTING not in f.read_text(encoding="utf-8"), f


# ------------------------------------------------------------------ change password from the sign-in screen


def _change(client, username, current, new, confirm=None):
    return client.post("/api/auth/change-password-at-login",
                       json={"username": username, "current_password": current, "new_password": new,
                             "confirm_password": confirm or new})


def test_change_password_from_sign_in_screen(client):
    admin = setup_and_login(client)
    _, token = make_user(client, admin, "ravi", "editor")
    new = "Brand!New2026x"
    assert _change(client, "ravi", GOOD, new, "nope").json()["detail"]["code"] == "password_mismatch"
    assert _change(client, "ravi", GOOD, GOOD).json()["detail"]["code"] == "password_reused"
    assert _change(client, "ravi", GOOD, "weak").json()["detail"]["code"] == "weak_password"
    assert _change(client, "RAVI", GOOD, new).status_code == 204
    assert client.get("/api/auth/me", headers=auth(token)).status_code == 401  # other sessions signed out
    assert client.post("/api/auth/login", json={"username": "ravi", "password": GOOD}).status_code == 401
    login(client, "ravi", new)
    last = db_exec(client, "SELECT details FROM audit_log WHERE action = 'password_changed' ORDER BY id DESC LIMIT 1")[0][0]
    assert "sign_in_screen" in last


def test_change_from_sign_in_screen_counts_towards_lockout(client):
    admin = setup_and_login(client)
    make_user(client, admin, "ravi", "editor")
    for _ in range(4):
        assert _change(client, "ravi", "Wrong!Passw0rd", "Brand!New2026x").status_code == 401
    assert client.post("/api/auth/login", json={"username": "ravi", "password": "Wrong!Passw0rd"}).status_code == 401
    r = _change(client, "ravi", GOOD, "Brand!New2026x")
    assert r.status_code == 423  # locked after 5 failures in total
    unknown = _change(client, "nobody", GOOD, "Brand!New2026x")
    assert unknown.status_code == 401 and unknown.json()["detail"]["message"] == "Invalid username or password."


def test_forced_change_can_also_be_done_from_sign_in_screen(client):
    admin = setup_and_login(client)
    r = client.post("/api/users", headers=auth(admin), json={"username": "priya", "role": "viewer",
                                                              "password": "Start!Pass2026x", "confirm_password": "Start!Pass2026x"})
    assert r.status_code == 201
    assert _change(client, "priya", "Start!Pass2026x", "Brand!New2026x").status_code == 204
    t = login(client, "priya", "Brand!New2026x")
    assert client.get("/api/auth/me", headers=auth(t)).json()["must_change_password"] is False
