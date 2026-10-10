"""Runtime configuration.

Everything comes from environment variables set by the Electron main process
when it spawns the sidecar. Nothing secret has a default: the app key is
generated fresh by Electron on every launch.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

APP_FOLDER_NAME = "FinancialVisualizationTool"


def default_data_root() -> Path:
    appdata = os.environ.get("APPDATA")
    if not appdata:
        raise RuntimeError("APPDATA is not set; cannot locate the data folder")
    return Path(appdata) / APP_FOLDER_NAME


@dataclass(frozen=True)
class DataPaths:
    r"""Layout of %APPDATA%\FinancialVisualizationTool."""

    root: Path

    @property
    def data_dir(self) -> Path:
        return self.root / "data"

    @property
    def db_file(self) -> Path:
        return self.data_dir / "app.db"

    @property
    def default_backup_dir(self) -> Path:
        return self.root / "backups"

    @property
    def uploads_dir(self) -> Path:
        return self.root / "uploads"

    @property
    def logs_dir(self) -> Path:
        return self.root / "logs"

    @property
    def exports_dir(self) -> Path:
        return self.root / "exports"

    @property
    def config_file(self) -> Path:
        """Non-secret local settings (backup locations). Readable even if the DB is not."""
        return self.root / "config.json"

    def ensure(self) -> None:
        for d in (self.data_dir, self.default_backup_dir, self.uploads_dir, self.logs_dir, self.exports_dir):
            d.mkdir(parents=True, exist_ok=True)


@dataclass(frozen=True)
class Settings:
    paths: DataPaths
    app_key: str
    port: int = 0
    allowed_origins: tuple[str, ...] = field(default_factory=tuple)
    idle_timeout_minutes: int = 15
    lockout_threshold: int = 5
    lockout_minutes: int = 5
    apply_permissions: bool = False  # restrict data-folder ACL on first run (on in the real app)
    background_jobs: bool = False  # hourly daily-backup check (on in the real app)

    @classmethod
    def from_env(cls) -> "Settings":
        app_key = os.environ.get("FVT_APP_KEY", "")
        if len(app_key) < 32:
            raise RuntimeError("FVT_APP_KEY must be provided by the desktop shell (>= 32 chars)")
        root = Path(os.environ["FVT_DATA_DIR"]) if os.environ.get("FVT_DATA_DIR") else default_data_root()
        origins = tuple(o for o in os.environ.get("FVT_ALLOWED_ORIGINS", "").split(",") if o)
        return cls(
            paths=DataPaths(root),
            app_key=app_key,
            port=int(os.environ.get("FVT_PORT", "0")),
            allowed_origins=origins,
            apply_permissions=True,
            background_jobs=True,
        )
