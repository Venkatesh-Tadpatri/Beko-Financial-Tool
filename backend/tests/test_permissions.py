from __future__ import annotations

import sys

import pytest

from app.services.permissions import SYSTEM_SID, current_user_sid, folder_acl_sids, restrict_to_current_user

pytestmark = pytest.mark.skipif(sys.platform != "win32", reason="Windows ACLs")


def test_data_folder_restricted_to_current_user_and_system(tmp_path):
    folder = tmp_path / "FinancialVisualizationTool"
    (folder / "data").mkdir(parents=True)
    restrict_to_current_user(folder)
    expected = sorted({current_user_sid(), SYSTEM_SID})
    assert folder_acl_sids(folder) == expected
    assert folder_acl_sids(folder / "data") == expected  # children inherit
    (folder / "data" / "app.db").write_bytes(b"x")  # we can still write
