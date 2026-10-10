"""Acceptance: killing the process during an upload leaves the database intact."""

from __future__ import annotations

import sqlite3
import subprocess
import sys
import time
from pathlib import Path

import pytest

from app.services.startup import run_startup
from app.state import AppState, Mode
from tests.helpers import make_user_and_batch, sales_total

BACKEND = Path(__file__).resolve().parents[1]
ROWS = 60_000


@pytest.mark.parametrize("delay", [0.0, 0.05, 0.2, 0.5, 1.0, 2.0])
def test_kill_during_upload_leaves_previous_state(settings, engine, session_factory, delay):
    make_user_and_batch(session_factory, rows=100, amount_paise=1000)  # the "previous state"
    db = settings.paths.db_file
    previous_total = sales_total(db)
    engine.dispose()

    proc = subprocess.Popen([sys.executable, "-m", "tests.crash_writer", str(db), str(ROWS)],
                            cwd=BACKEND, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    assert proc.stdout.readline().strip() == "WRITING", proc.stderr.read()
    time.sleep(delay)
    proc.kill()  # TerminateProcess: no cleanup, no rollback, like a crash
    proc.wait(timeout=30)

    state = AppState(settings)
    run_startup(state)  # integrity check runs here
    assert state.mode == Mode.READY, state.problems
    state.close_database()

    conn = sqlite3.connect(str(db))
    batches = conn.execute("SELECT COUNT(*) FROM upload_batches WHERE original_filename = 'crash.xlsx'").fetchone()[0]
    facts = conn.execute("SELECT COUNT(*) FROM sales_facts WHERE customer_code = 'X'").fetchone()[0]
    conn.close()
    # All or nothing: the upload is either completely absent or completely present.
    assert (batches, facts) in {(0, 0), (1, ROWS)}
    if batches == 0:
        assert sales_total(db) == previous_total
