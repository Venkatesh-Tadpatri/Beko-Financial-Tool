from __future__ import annotations

import shutil

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from tests.api_helpers import GOOD, actions, auth, db_exec, login, make_user, setup_and_login
from tests.helpers import sales_total


@pytest.fixture
def admin(client):
    return setup_and_login(client)


def test_list_backup_now_and_usage(client, admin):
    r = client.post("/api/backups", headers=auth(admin))
    assert r.status_code == 201 and r.json()["reason"] == "manual" and r.json()["verify_ok"] is True
    body = client.get("/api/backups", headers=auth(admin)).json()
    assert [b["reason"] for b in body["backups"]][:2] == ["manual", "daily"]
    u = body["usage"]
    assert u["count"] == 2 and u["used_bytes"] > 0 and u["disk_free_bytes"] > 0 and u["max_total_bytes"] > 0
    assert "backup_created" in actions(client)


def test_verify_endpoint(client, admin):
    name = client.post("/api/backups", headers=auth(admin)).json()["filename"]
    assert client.post(f"/api/backups/{name}/verify", headers=auth(admin)).json()["ok"] is True
    assert client.post("/api/backups/app-nope.db/verify", headers=auth(admin)).status_code == 404


def test_settings_change_locations_and_cap(client, admin, tmp_path):
    s = client.get("/api/backups/settings", headers=auth(admin)).json()
    assert s["max_total_backup_gb"] == 5.0 and s["secondary_backup_dir"] == ""
    second = tmp_path / "onedrive"
    r = client.put("/api/backups/settings", headers=auth(admin),
                   json={"backup_dir": s["backup_dir"], "secondary_backup_dir": str(second), "max_total_backup_gb": 2})
    assert r.status_code == 200 and r.json()["max_total_backup_gb"] == 2.0
    name = client.post("/api/backups", headers=auth(admin)).json()["filename"]
    assert (second / name).is_file()
    r = client.put("/api/backups/settings", headers=auth(admin),
                   json={"backup_dir": "relative\\path", "secondary_backup_dir": "", "max_total_backup_gb": 2})
    assert r.json()["detail"]["code"] == "invalid_folder"
    r = client.put("/api/backups/settings", headers=auth(admin),
                   json={"backup_dir": s["backup_dir"], "secondary_backup_dir": s["backup_dir"], "max_total_backup_gb": 2})
    assert r.json()["detail"]["code"] == "same_folder"
    assert "backup_settings_changed" in actions(client)


def test_restore_requires_password_and_brings_back_exact_state(client, admin, settings):
    good = client.post("/api/backups", headers=auth(admin)).json()["filename"]
    make_user(client, admin, "later", "viewer")  # a change made after the backup
    r = client.post(f"/api/backups/{good}/restore", headers=auth(admin), json={"password": "Wrong!Passw0rd"})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "wrong_password"

    r = client.post(f"/api/backups/{good}/restore", headers=auth(admin), json={"password": GOOD})
    assert r.status_code == 200, r.text
    result = r.json()
    assert result["restart_required"] and result["pre_restore_backup"].endswith("pre_restore.db")
    assert client.get("/api/health").json()["mode"] == "restarting"
    assert client.get("/api/auth/me", headers=auth(admin)).status_code == 503

    # Relaunch (what Electron does): the user created after the backup is gone; the restore is audited.
    with TestClient(create_app(settings), headers={"X-App-Key": settings.app_key}) as again:
        names = [r[0] for r in db_exec(again, "SELECT username FROM users")]
        assert names == ["founder"]
        acts = [r[0] for r in db_exec(again, "SELECT action FROM audit_log ORDER BY id")]
        assert acts[-1] == "restore"
        token = login(again, "founder")
        listed = [b["filename"] for b in again.get("/api/backups", headers=auth(token)).json()["backups"]]
        assert result["pre_restore_backup"] in listed


def test_restore_from_external_file(client, admin, tmp_path, settings):
    good = client.post("/api/backups", headers=auth(admin)).json()["filename"]
    usb = tmp_path / "usb" / "copy.db"
    usb.parent.mkdir()
    shutil.copyfile(settings.paths.default_backup_dir / good, usb)
    r = client.post("/api/backups/restore-file", headers=auth(admin), json={"path": str(usb), "password": GOOD})
    assert r.status_code == 200 and r.json()["restored_from"] == "copy.db"
    bad = tmp_path / "bad.db"
    bad.write_text("nope")
    with TestClient(create_app(settings), headers={"X-App-Key": settings.app_key}) as again:
        t = login(again, "founder")
        r = again.post("/api/backups/restore-file", headers=auth(t), json={"path": str(bad), "password": GOOD})
        assert r.json()["detail"]["code"] == "invalid_backup"
        r = again.post("/api/backups/restore-file", headers=auth(t), json={"path": "relative.db", "password": GOOD})
        assert r.json()["detail"]["code"] == "invalid_file"


def test_non_super_admin_cannot_restore(client, admin):
    good = client.post("/api/backups", headers=auth(admin)).json()["filename"]
    _, adm = make_user(client, admin, "anil", "admin")
    r = client.post(f"/api/backups/{good}/restore", headers=auth(adm), json={"password": GOOD})
    assert r.status_code == 403
    assert client.get("/api/health").json()["mode"] == "ready"


# ------------------------------------------------------------------ recovery mode


def _corrupt(db):
    data = bytearray(db.read_bytes())
    for start in range(4096, len(data), 4096 * 2):
        data[start:start + 4096] = b"\x5a" * 4096
    db.write_bytes(bytes(data))


def test_recovery_restore_with_credentials_from_the_backup(client, admin, settings):
    good = client.post("/api/backups", headers=auth(admin)).json()["filename"]
    client.app.state.fvt.close_database()
    _corrupt(settings.paths.db_file)

    with TestClient(create_app(settings), headers={"X-App-Key": settings.app_key}) as rec:
        assert rec.get("/api/system/status").json()["mode"] == "recovery"
        assert rec.post("/api/auth/login", json={"username": "founder", "password": GOOD}).status_code == 503
        listed = rec.get("/api/recovery/backups").json()
        assert good in [b["filename"] for b in listed]
        r = rec.post("/api/recovery/restore", json={"filename": good, "username": "founder", "password": "Wrong!Pass1"})
        assert r.status_code == 401
        r = rec.post("/api/recovery/restore", json={"filename": good, "username": "FOUNDER", "password": GOOD})
        assert r.status_code == 200 and "damaged_copy" in r.json()

    with TestClient(create_app(settings), headers={"X-App-Key": settings.app_key}) as again:
        assert again.get("/api/system/status").json()["mode"] == "ready"
        last = db_exec(again, "SELECT action, details FROM audit_log ORDER BY id DESC LIMIT 1")[0]
        assert last[0] == "restore" and '"mode": "recovery"' in last[1]
        login(again, "founder")


def test_recovery_routes_closed_when_healthy(client, admin):
    assert client.get("/api/recovery/backups").status_code == 409
    assert client.post("/api/recovery/restore", json={"username": "a", "password": "b"}).status_code == 409


def test_recovery_throttles_guessing(client, admin, settings, monkeypatch):
    from app.api import backups as backups_api

    monkeypatch.setattr(backups_api, "_failures", [])
    good = client.post("/api/backups", headers=auth(admin)).json()["filename"]
    client.app.state.fvt.close_database()
    _corrupt(settings.paths.db_file)
    with TestClient(create_app(settings), headers={"X-App-Key": settings.app_key}) as rec:
        for _ in range(5):
            rec.post("/api/recovery/restore", json={"filename": good, "username": "founder", "password": "x"})
        r = rec.post("/api/recovery/restore", json={"filename": good, "username": "founder", "password": GOOD})
        assert r.status_code == 423


def test_restore_refused_cleanly_when_another_program_holds_the_file(client, admin, settings):
    import sqlite3

    good = client.post("/api/backups", headers=auth(admin)).json()["filename"]
    viewer = sqlite3.connect(str(settings.paths.db_file))  # e.g. app.db open in a database viewer
    viewer.execute("BEGIN")
    viewer.execute("SELECT COUNT(*) FROM users").fetchone()  # holds a read snapshot
    try:
        r = client.post(f"/api/backups/{good}/restore", headers=auth(admin), json={"password": GOOD})
    finally:
        viewer.close()
    assert r.status_code == 409 and r.json()["detail"]["code"] == "restore_failed"
    assert client.get("/api/health").json()["mode"] == "ready"  # still usable
    assert client.get("/api/auth/me", headers=auth(admin)).status_code == 200


def test_figures_identical_after_restore(client, admin, settings):
    from tests.helpers import make_user_and_batch

    make_user_and_batch(client.app.state.fvt.session_factory, rows=300, amount_paise=987_654)
    before = sales_total(settings.paths.db_file)
    good = client.post("/api/backups", headers=auth(admin)).json()["filename"]
    db_exec(client, "UPDATE sales_facts SET amount_paise = 1")
    client.post(f"/api/backups/{good}/restore", headers=auth(admin), json={"password": GOOD})
    assert sales_total(settings.paths.db_file) == before == 300 * 987_654
