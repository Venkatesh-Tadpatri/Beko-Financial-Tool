from __future__ import annotations

from sqlalchemy import text

GOOD = "Str0ng!Passw0rd"
ROLES = ("viewer", "editor", "approver", "admin", "super_admin")


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def setup_and_login(client, username="founder", password=GOOD) -> str:
    r = client.post("/api/setup/super-admin",
                    json={"username": username, "password": password, "confirm_password": password})
    assert r.status_code == 201, r.text
    return login(client, username, password)


def login(client, username, password=GOOD) -> str:
    r = client.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def make_user(client, admin_token: str, username: str, role: str, password: str = GOOD) -> tuple[int, str]:
    """Create a user through the API, then set their own password. Returns (id, token)."""
    r = client.post("/api/users", headers=auth(admin_token), json={"username": username, "role": role})
    assert r.status_code == 201, r.text
    uid, temp = r.json()["user"]["id"], r.json()["temporary_password"]
    token = login(client, username, temp)
    r = client.post("/api/auth/change-password", headers=auth(token),
                    json={"current_password": temp, "new_password": password, "confirm_password": password})
    assert r.status_code == 204, r.text
    return uid, token


def db_exec(client, sql, **params):
    with client.app.state.fvt.session_factory() as s:
        rows = s.execute(text(sql), params)
        out = rows.fetchall() if rows.returns_rows else None
        s.commit()
        return out


def actions(client) -> list[str]:
    return [r[0] for r in db_exec(client, "SELECT action FROM audit_log ORDER BY id")]
