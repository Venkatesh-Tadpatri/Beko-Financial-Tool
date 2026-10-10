r"""Non-secret local settings kept in %APPDATA%\FinancialVisualizationTool\config.json.

These live outside the database on purpose: the backup locations must be
readable when the database itself is damaged.
"""

from __future__ import annotations

import json
import os
import threading
from dataclasses import asdict, dataclass
from pathlib import Path

GIB = 1024**3
DEFAULT_MAX_TOTAL_BYTES = 5 * GIB
MIN_MAX_TOTAL_BYTES = 100 * 1024**2

_lock = threading.Lock()


@dataclass
class LocalConfig:
    backup_dir: str | None = None  # None = default %APPDATA%\...\backups
    secondary_backup_dir: str | None = None
    max_total_backup_bytes: int = DEFAULT_MAX_TOTAL_BYTES
    permissions_applied: bool = False


def atomic_write_text(path: Path, text: str) -> None:
    """Write via temp file + fsync + rename, so a crash never leaves a half-written file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def load(config_file: Path) -> LocalConfig:
    with _lock:
        try:
            raw = json.loads(config_file.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            return LocalConfig()
        known = {k: raw[k] for k in LocalConfig.__dataclass_fields__ if k in raw}
        return LocalConfig(**known)


def save(config_file: Path, cfg: LocalConfig) -> None:
    if cfg.max_total_backup_bytes < MIN_MAX_TOTAL_BYTES:
        raise ValueError("backup size cap must be at least 100 MB")
    with _lock:
        atomic_write_text(config_file, json.dumps(asdict(cfg), indent=2))
