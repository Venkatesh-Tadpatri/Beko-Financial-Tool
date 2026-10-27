"""Every API route is checked for every role, by calling the API directly.

New routes are picked up automatically. A route without a permission guard
fails test_every_route_is_classified unless it is deliberately listed as public
or 'signed-in only'.
"""

from __future__ import annotations

import re

import pytest
from fastapi.routing import APIRoute

from app.core.permissions import MIN_ROLE, Perm
from app.models import Role
from tests.api_helpers import ROLES, auth, make_user, setup_and_login

PUBLIC = {
    ("GET", "/api/health"), ("GET", "/api/system/status"), ("POST", "/api/setup/super-admin"),
    ("POST", "/api/auth/login"), ("POST", "/api/auth/change-password-at-login"), ("POST", "/api/system/shutdown"),
    ("GET", "/api/recovery/backups"), ("POST", "/api/recovery/restore"),
}
SIGNED_IN_ONLY = {
    ("GET", "/api/auth/me"), ("POST", "/api/auth/logout"), ("POST", "/api/auth/heartbeat"),
    ("POST", "/api/auth/change-password"),
}
# Routes that authenticate inside their own short transaction (restore).
SELF_GUARDED = {
    ("POST", "/api/backups/{filename}/restore"): Perm.MANAGE_BACKUPS,
    ("POST", "/api/backups/restore-file"): Perm.MANAGE_BACKUPS,
    ("POST", "/api/import/batches/{batch_id}/submit"): Perm.UPLOAD_DATA,
    ("POST", "/api/import/batches/{batch_id}/delete"): Perm.ADMIN_DATA,
    ("POST", "/api/approvals/{batch_id}/approve"): Perm.APPROVE_DATA,
    ("POST", "/api/overrides"): Perm.OVERRIDE_DATA,
}


def _route_perm(route: APIRoute) -> Perm | None:
    stack = list(route.dependant.dependencies)
    while stack:
        dep = stack.pop()
        name = getattr(dep.call, "__name__", "")
        if name.startswith("require_"):
            return Perm(name.removeprefix("require_"))
        stack.extend(dep.dependencies)
    return None


def _flatten(routes):
    for r in routes:
        inner = getattr(r, "original_router", None)  # FastAPI keeps included routers nested
        if inner is not None:
            yield from _flatten(inner.routes)
        else:
            yield r


def _routes(app):
    for r in _flatten(app.routes):
        if isinstance(r, APIRoute) and r.path.startswith("/api/"):
            for m in r.methods:
                yield m, r.path, r


def test_every_route_is_classified(client):
    assert len(list(_routes(client.app))) >= 25  # guards against the walk silently finding nothing
    unguarded = []
    for method, path, route in _routes(client.app):
        key = (method, path)
        if key in PUBLIC or key in SIGNED_IN_ONLY or key in SELF_GUARDED:
            continue
        if _route_perm(route) is None:
            unguarded.append(key)
    assert unguarded == [], f"routes without a permission guard: {unguarded}"


@pytest.fixture
def tokens(client):
    admin = setup_and_login(client)
    out = {"super_admin": admin}
    for role in ROLES[:-1]:
        out[role] = make_user(client, admin, f"user_{role}", role)[1]
    return out


def _concrete(path: str) -> str:
    return re.sub(r"\{[^}]+\}", "1", path)


def test_each_role_gets_exactly_its_permissions(client, tokens):
    checked = 0
    for method, path, route in _routes(client.app):
        perm = SELF_GUARDED.get((method, path)) or _route_perm(route)
        if perm is None:
            continue
        for role in ROLES:
            r = client.request(method, _concrete(path), headers=auth(tokens[role]), json={})
            allowed = Role(role).at_least(MIN_ROLE[perm])
            if allowed:
                assert r.status_code != 403, f"{role} wrongly refused {method} {path}"
            else:
                assert r.status_code == 403, f"{role} reached {method} {path} ({r.status_code})"
            checked += 1
    assert checked >= 5 * 12


def test_viewer_cannot_reach_backup_or_user_management_directly(client, tokens):
    v = auth(tokens["viewer"])
    for method, path in [("GET", "/api/users"), ("POST", "/api/users"), ("POST", "/api/users/1/reset-password"),
                         ("GET", "/api/backups"), ("POST", "/api/backups"), ("POST", "/api/backups/x.db/restore"),
                         ("GET", "/api/audit")]:
        assert client.request(method, path, headers=v, json={}).status_code == 403, (method, path)


def test_no_route_is_reachable_without_signing_in(client, tokens):
    for method, path, route in _routes(client.app):
        if (method, path) in PUBLIC:
            continue
        r = client.request(method, _concrete(path), json={})
        assert r.status_code in (401, 503), f"{method} {path} answered {r.status_code} without a session"
