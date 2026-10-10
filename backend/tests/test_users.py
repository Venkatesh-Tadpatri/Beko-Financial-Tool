from __future__ import annotations

import re

import pytest

from app.core.security import password_problems, temporary_password
from tests.api_helpers import GOOD, actions, auth, db_exec, login, make_user, setup_and_login


@pytest.fixture
def admin(client):
    return setup_and_login(client)


def test_temporary_passwords_meet_policy_and_differ():
    seen = {temporary_password() for _ in range(200)}
    assert len(seen) == 200
    assert all(not password_problems(p) for p in seen)
    assert all(not re.search(r"[O0Il1]", p) for p in seen)


def test_create_user_shows_temporary_password_once_and_forces_change(client, admin):
    r = client.post("/api/users", headers=auth(admin), json={"username": "priya", "display_name": "Priya S", "role": "editor"})
    assert r.status_code == 201
    body = r.json()
    assert body["user"]["must_change_password"] is True and body["user"]["role"] == "editor"
    temp = body["temporary_password"]
    token = login(client, "priya", temp)
    assert client.get("/api/auth/me", headers=auth(token)).json()["must_change_password"] is True
    assert client.get("/api/users", headers=auth(admin)).status_code == 200
    # the temporary password never appears in the list or the audit log
    assert temp not in client.get("/api/users", headers=auth(admin)).text
    assert all(temp not in (r[0] or "") for r in db_exec(client, "SELECT details FROM audit_log"))
    assert "user_created" in actions(client)


def test_duplicate_and_invalid_usernames(client, admin):
    make_user(client, admin, "ravi", "viewer")
    r = client.post("/api/users", headers=auth(admin), json={"username": "RAVI", "role": "viewer"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "username_taken"
    r = client.post("/api/users", headers=auth(admin), json={"username": "x y", "role": "viewer"})
    assert r.json()["detail"]["code"] == "invalid_username"
    r = client.post("/api/users", headers=auth(admin), json={"username": "boss", "role": "god"})
    assert r.status_code == 422


def test_change_role_signs_the_user_out_and_is_audited(client, admin):
    uid, token = make_user(client, admin, "ravi", "viewer")
    r = client.patch(f"/api/users/{uid}", headers=auth(admin), json={"role": "approver", "display_name": "Ravi K"})
    assert r.status_code == 200 and r.json()["role"] == "approver"
    assert client.get("/api/auth/me", headers=auth(token)).status_code == 401
    assert "approve_data" in client.get("/api/auth/me", headers=auth(login(client, "ravi"))).json()["permissions"]
    details = db_exec(client, "SELECT details FROM audit_log WHERE action='user_updated'")[0][0]
    assert '"role": ["viewer", "approver"]' in details


def test_founder_cannot_be_demoted_or_disabled(client, admin):
    founder_id = client.get("/api/auth/me", headers=auth(admin)).json()["id"]
    _, other = make_user(client, admin, "second", "super_admin")
    r = client.patch(f"/api/users/{founder_id}", headers=auth(other), json={"role": "viewer"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "founder_protected"
    r = client.post(f"/api/users/{founder_id}/disable", headers=auth(other))
    assert r.status_code == 409


def test_cannot_disable_self_and_last_super_admin_rule(client, admin):
    uid, other = make_user(client, admin, "second", "super_admin")
    assert client.post(f"/api/users/{uid}/disable", headers=auth(other)).json()["detail"]["code"] == "cannot_disable_self"
    # demoting the second super admin is fine (the founder remains)
    assert client.patch(f"/api/users/{uid}", headers=auth(admin), json={"role": "admin"}).status_code == 200


def test_disable_signs_out_and_blocks_login_enable_restores(client, admin):
    uid, token = make_user(client, admin, "ravi", "editor")
    assert client.post(f"/api/users/{uid}/disable", headers=auth(admin)).json()["is_active"] is False
    assert client.get("/api/auth/me", headers=auth(token)).status_code == 401
    r = client.post("/api/auth/login", json={"username": "ravi", "password": GOOD})
    assert r.status_code == 401
    assert client.post(f"/api/users/{uid}/enable", headers=auth(admin)).json()["is_active"] is True
    login(client, "ravi")
    assert {"user_disabled", "user_enabled"} <= set(actions(client))


def test_reset_password_forces_change_unlocks_and_signs_out(client, admin):
    uid, token = make_user(client, admin, "ravi", "editor")
    for _ in range(5):
        client.post("/api/auth/login", json={"username": "ravi", "password": "Wrong!Passw0rd"})
    assert client.get("/api/users", headers=auth(admin)).json()[-1]["locked"] is True
    r = client.post(f"/api/users/{uid}/reset-password", headers=auth(admin))
    temp = r.json()["temporary_password"]
    assert r.json()["user"]["locked"] is False and r.json()["user"]["must_change_password"] is True
    assert client.get("/api/auth/me", headers=auth(token)).status_code == 401
    t2 = login(client, "ravi", temp)
    assert client.get("/api/auth/me", headers=auth(t2)).json()["must_change_password"] is True
    assert client.post("/api/auth/login", json={"username": "ravi", "password": GOOD}).status_code == 401


def test_unlock(client, admin):
    uid, _ = make_user(client, admin, "ravi", "editor")
    for _ in range(5):
        client.post("/api/auth/login", json={"username": "ravi", "password": "Wrong!Passw0rd"})
    client.post(f"/api/users/{uid}/unlock", headers=auth(admin))
    login(client, "ravi")


def test_there_is_no_delete_route(client, admin):
    uid, _ = make_user(client, admin, "ravi", "editor")
    assert client.delete(f"/api/users/{uid}", headers=auth(admin)).status_code == 405


def test_unknown_user_404(client, admin):
    assert client.post("/api/users/999/disable", headers=auth(admin)).status_code == 404
