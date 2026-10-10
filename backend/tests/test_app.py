from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


def test_health_with_app_key(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["mode"] == "ready"


def test_requests_without_or_with_wrong_app_key_are_refused(settings):
    with TestClient(create_app(settings)) as c:
        assert c.get("/api/health").status_code == 403
        assert c.get("/api/health", headers={"X-App-Key": "wrong"}).status_code == 403


def test_startup_creates_data_folders_and_database(client, settings):
    p = settings.paths
    for d in (p.data_dir, p.default_backup_dir, p.uploads_dir, p.logs_dir, p.exports_dir):
        assert d.is_dir()
    assert p.db_file.is_file()


def test_settings_refuse_missing_or_short_app_key(monkeypatch):
    monkeypatch.delenv("FVT_APP_KEY", raising=False)
    with pytest.raises(RuntimeError):
        Settings.from_env()
    monkeypatch.setenv("FVT_APP_KEY", "short")
    with pytest.raises(RuntimeError):
        Settings.from_env()


def test_sidecar_announces_port_and_serves(tmp_path):
    """Start run.py as Electron would and talk to it over a real socket."""
    import httpx

    backend = Path(__file__).resolve().parents[1]
    key = "k" * 40
    env = {**os.environ, "FVT_APP_KEY": key, "FVT_DATA_DIR": str(tmp_path / "data")}
    proc = subprocess.Popen([sys.executable, "run.py"], cwd=backend, env=env,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        line = proc.stdout.readline().strip()
        assert line.startswith("FVT_READY port="), proc.stderr.read() if proc.poll() is not None else line
        port = int(line.split("=", 1)[1])
        r = httpx.get(f"http://127.0.0.1:{port}/api/health", headers={"X-App-Key": key}, timeout=10)
        assert r.status_code == 200
        r = httpx.post(f"http://127.0.0.1:{port}/api/system/shutdown", headers={"X-App-Key": key}, timeout=10)
        assert r.status_code == 202
        assert proc.wait(timeout=20) == 0  # graceful exit
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait(timeout=10)


def test_sidecar_exits_when_parent_process_dies(tmp_path):
    backend = Path(__file__).resolve().parents[1]
    parent = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(600)"])
    env = {**os.environ, "FVT_APP_KEY": "k" * 40, "FVT_DATA_DIR": str(tmp_path / "data"),
           "FVT_PARENT_PID": str(parent.pid)}
    proc = subprocess.Popen([sys.executable, "run.py"], cwd=backend, env=env,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        assert proc.stdout.readline().startswith("FVT_READY")
        parent.kill()  # Electron crashes
        assert proc.wait(timeout=30) == 0
    finally:
        for p in (proc, parent):
            if p.poll() is None:
                p.kill()
