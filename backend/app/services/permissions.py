"""Lock the data folder down to the current Windows user (plus SYSTEM) on first run."""

from __future__ import annotations

import csv
import io
import logging
import subprocess
import sys
from pathlib import Path

log = logging.getLogger(__name__)

SYSTEM_SID = "S-1-5-18"
_NO_WINDOW = 0x08000000  # CREATE_NO_WINDOW


def current_user_sid() -> str:
    out = subprocess.run(["whoami", "/user", "/fo", "csv", "/nh"], capture_output=True, text=True,
                         check=True, creationflags=_NO_WINDOW).stdout
    row = next(csv.reader(io.StringIO(out.strip())))
    sid = row[1]
    if not sid.startswith("S-1-"):
        raise RuntimeError(f"unexpected whoami output: {out!r}")
    return sid


def restrict_to_current_user(folder: Path) -> None:
    """Remove inherited permissions and grant Full Control only to the current user and SYSTEM.

    Children inherit from `folder`, so existing and future files are covered.
    """
    if sys.platform != "win32":
        return
    sid = current_user_sid()
    subprocess.run(
        ["icacls", str(folder), "/inheritance:r",
         "/grant:r", f"*{sid}:(OI)(CI)F", f"*{SYSTEM_SID}:(OI)(CI)F", "/Q"],
        capture_output=True, text=True, check=True, creationflags=_NO_WINDOW,
    )
    log.info("data folder permissions restricted to the current user")


def folder_acl_sids(folder: Path) -> list[str]:
    """SIDs with an entry on `folder` (for tests and the admin diagnostics screen)."""
    out = subprocess.run(["powershell", "-NoProfile", "-Command",
                          f"(Get-Acl -LiteralPath '{folder}').Access | "
                          "ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value }"],
                         capture_output=True, text=True, check=True, creationflags=_NO_WINDOW).stdout
    return sorted({line.strip() for line in out.splitlines() if line.strip()})
