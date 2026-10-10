"""Create a backup fixture at the current schema head for the migration release gate.

    .venv\\Scripts\\python.exe -m tests.fixtures.make_fixture

Run this once per released schema version and commit the file, so every
future migration is tested against databases created by older releases.
Before each release also copy a real customer backup into tests/fixtures/backups/.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from app.core.config import DataPaths
from app.core.db import make_engine, make_session_factory
from app.services.backup import BackupService
from app.services.migrations import head_revision, upgrade_to_head
from tests.helpers import make_user_and_batch

OUT = Path(__file__).resolve().parent / "backups"


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        paths = DataPaths(Path(tmp))
        paths.ensure()
        engine = make_engine(paths.db_file)
        upgrade_to_head(engine)
        factory = make_session_factory(engine)
        for amount in (1_000_00, 2_500_00, 99_999_99):
            make_user_and_batch(factory, rows=200, amount_paise=amount)
        engine.dispose()
        entry = BackupService(paths).create("manual")
        OUT.mkdir(parents=True, exist_ok=True)
        target = OUT / f"schema-{head_revision()}.db"
        target.write_bytes((paths.default_backup_dir / entry.filename).read_bytes())
        print(f"wrote {target}")


if __name__ == "__main__":
    main()
