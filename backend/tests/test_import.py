from __future__ import annotations

import hashlib
import os
import stat
from datetime import date
from pathlib import Path

import pytest
from openpyxl import Workbook

from app.services import importer
from tests.api_helpers import GOOD, actions, auth, db_exec, make_user, setup_and_login
from tests.helpers import sales_total

SAP_HEADERS = ["Billing Date", "Sold-To Party", "Material", "Net Value", "Billed Quantity"]


def make_xlsx(path: Path, headers: list, rows: list[list], sheet: str = "Export", title_rows: int = 0) -> Path:
    wb = Workbook()
    ws = wb.active
    ws.title = sheet
    for i in range(title_rows):
        ws.append([f"SAP report line {i + 1}"])
    ws.append(headers)
    for r in rows:
        ws.append(r)
    wb.save(path)
    return path


@pytest.fixture
def team(client):
    admin = setup_and_login(client)
    _, editor = make_user(client, admin, "eddie", "editor")
    _, approver = make_user(client, admin, "april", "approver")
    _, admin2 = make_user(client, admin, "adam", "admin")
    _, viewer = make_user(client, admin, "val", "viewer")
    # master data
    def post(path, body):
        r = client.post(f"/api/master/{path}", headers=auth(admin2), json=body)
        assert r.status_code == 201, r.text
        return r.json()["id"]
    d1 = post("divisions", {"code": "RAC", "name": "Room AC"})
    d2 = post("divisions", {"code": "REF", "name": "Refrigeration"})
    s1 = post("segments", {"code": "RES", "name": "Residential"})
    p1 = post("products", {"code": "AC15", "name": "1.5T Split AC", "division_id": d1, "segment_id": s1})
    p2 = post("products", {"code": "FR300", "name": "300L Fridge", "division_id": d2, "segment_id": s1})
    o1 = post("oems", {"code": "OEM1", "name": "Alpha Appliances"})
    o2 = post("oems", {"code": "OEM2", "name": "Beta Retail"})
    post("customer-map", {"customer_code": "C100", "customer_name": "Alpha", "oem_id": o1})
    post("customer-map", {"customer_code": "C200", "customer_name": "Beta", "oem_id": o2})
    post("material-map", {"material_code": "M-AC15", "product_id": p1})
    post("material-map", {"material_code": "M-FR300", "product_id": p2})
    return {"admin": admin, "admin2": admin2, "editor": editor, "approver": approver, "viewer": viewer,
            "ids": {"d1": d1, "d2": d2, "p1": p1, "p2": p2, "o1": o1, "o2": o2}}


def upload(client, token, path, dataset="sales", source="SAP"):
    r = client.post("/api/import/upload", headers=auth(token), json={"dataset_type": dataset, "source_name": source, "path": str(path)})
    assert r.status_code == 201, r.text
    return r.json()


def map_and_stage(client, token, batch_id, sheet="Export", header_row=1, column_map=None):
    if column_map is None:
        prev = client.get(f"/api/import/batches/{batch_id}/sheet", headers=auth(token),
                          params={"sheet": sheet, "header_row": header_row}).json()
        column_map = prev["suggested_map"]
    r = client.post(f"/api/import/batches/{batch_id}/mapping", headers=auth(token),
                    json={"sheet": sheet, "header_row": header_row, "column_map": column_map})
    assert r.status_code == 200, r.text
    return r.json()["summary"]


def full_upload(client, team, tmp_path, rows, name="sales.xlsx"):
    f = make_xlsx(tmp_path / name, SAP_HEADERS, rows)
    b = upload(client, team["editor"], f)["batch"]
    summary = map_and_stage(client, team["editor"], b["id"])
    assert summary["can_submit"], summary
    r = client.post(f"/api/import/batches/{b['id']}/submit", headers=auth(team["editor"]))
    assert r.status_code == 200, r.text
    r = client.post(f"/api/approvals/{b['id']}/approve", headers=auth(team["approver"]), json={"comment": "ok"})
    assert r.status_code == 200, r.text
    return b["id"]


# ------------------------------------------------------------------ unit: parsing


@pytest.mark.parametrize(("raw", "expected"), [
    ("15.04.2025", date(2025, 4, 15)), ("2025-04-15", date(2025, 4, 15)), ("15/04/2025", date(2025, 4, 15)),
    (45762, date(2025, 4, 15)), ("15-Apr-2025", date(2025, 4, 15)),
])
def test_parse_date(raw, expected):
    assert importer.parse_date(raw) == expected


@pytest.mark.parametrize(("raw", "fy"), [(2025, 2025), ("2025", 2025), ("FY2025-26", 2025), ("2025-26", 2025), ("FY25-26", 2025)])
def test_parse_fiscal_year(raw, fy):
    assert importer.parse_fiscal_year(raw) == fy


def test_parse_period_and_bucket():
    assert importer.parse_period_no("Q3", "Q") == 3
    assert importer.parse_period_no("Jan", "M") == 10
    assert importer.parse_period_no("007", "M") == 7
    with pytest.raises(ValueError):
        importer.parse_period_no(5, "Q")
    assert importer.normalize_bucket("> 90 days") == "90+"
    assert importer.normalize_bucket("0 - 30") == "0-30"


def test_suggested_mapping_recognises_sap_headers():
    ds = importer.dataset("sales")
    m = importer.suggest_mapping(["Billing Date", "Sold-To Party", "Material", "Net Value", "Billed Quantity", "Other"], ds, None)
    assert m == {"period_date": "Billing Date", "customer_code": "Sold-To Party", "material_code": "Material",
                 "amount": "Net Value", "quantity": "Billed Quantity"}


# ------------------------------------------------------------------ happy path


def test_upload_archive_review_submit_approve(client, team, tmp_path, settings):
    rows = [["15.04.2025", "C100", "M-AC15", "1,25,000.50", 3],
            ["20.04.2025", "C200", "M-FR300", 80000, 2],
            ["05.05.2025", "C100", "M-FR300", 99999.99, 1]]
    f = make_xlsx(tmp_path / "april.xlsx", SAP_HEADERS, rows)
    original = f.read_bytes()
    res = upload(client, team["editor"], f)
    b = res["batch"]
    assert res["sheets"] == ["Export"] and b["status"] == "draft" and b["period_grain"] == "M"

    # archived unchanged and read-only
    archived = settings.paths.uploads_dir / db_exec(client, "SELECT archived_path FROM upload_batches")[0][0]
    assert archived.read_bytes() == original
    assert not os.access(archived, os.W_OK) or not (archived.stat().st_mode & stat.S_IWRITE)

    summary = map_and_stage(client, team["editor"], b["id"])
    assert summary["ready_rows"] == 3 and summary["can_submit"]
    assert [(p["label"], p["rows"], p["total_paise"]) for p in summary["periods"]] == [
        ("Apr 2025", 2, 12_500_050 + 8_000_000), ("May 2025", 1, 9_999_999)]

    r = client.post(f"/api/import/batches/{b['id']}/submit", headers=auth(team["editor"]))
    assert r.json()["status"] == "submitted" and r.json()["backup_warning"] is None

    pending = client.get("/api/approvals/pending", headers=auth(team["approver"])).json()
    assert [p["id"] for p in pending] == [b["id"]] and pending[0]["can_act"] is True

    r = client.post(f"/api/approvals/{b['id']}/approve", headers=auth(team["approver"]), json={"comment": "Checked totals"})
    assert r.json()["status"] == "approved"
    assert sales_total(settings.paths.db_file) == 12_500_050 + 8_000_000 + 9_999_999
    facts = db_exec(client, "SELECT customer_code, oem_id, product_id, division_id, quantity FROM sales_facts ORDER BY id")
    assert facts[0] == ("C100", team["ids"]["o1"], team["ids"]["p1"], team["ids"]["d1"], 3)

    reasons = [b["reason"] for b in client.get("/api/backups", headers=auth(team["admin"])).json()["backups"]]
    assert "upload" in reasons and "approval" in reasons
    assert {"upload", "upload_submitted", "approved"} <= set(actions(client))


def test_template_is_saved_and_reused_with_sheet_and_header_row(client, team, tmp_path):
    headers = ["Posting Date", "Customer", "Item Code", "Amount INR"]
    f1 = make_xlsx(tmp_path / "a.xlsx", headers, [["2025-06-01", "C100", "M-AC15", 10]], sheet="Data", title_rows=2)
    b1 = upload(client, team["editor"], f1, source="SAP-North")["batch"]
    cmap = {"period_date": "Posting Date", "customer_code": "Customer", "material_code": "Item Code", "amount": "Amount INR"}
    map_and_stage(client, team["editor"], b1["id"], sheet="Data", header_row=3, column_map=cmap)

    f2 = make_xlsx(tmp_path / "b.xlsx", headers, [["2025-07-01", "C200", "M-FR300", 20]], sheet="Data", title_rows=2)
    b2 = upload(client, team["editor"], f2, source="SAP-North")["batch"]
    assert b2["sheet_name"] == "Data" and b2["header_row"] == 3
    prev = client.get(f"/api/import/batches/{b2['id']}/sheet", headers=auth(team["editor"]),
                      params={"sheet": "Data", "header_row": 3}).json()
    assert prev["suggested_map"] == cmap and prev["from_template"] is True


# ------------------------------------------------------------------ validation


def test_validation_flags_and_fixes(client, team, tmp_path):
    rows = [
        ["15.04.2025", "C100", "M-AC15", 1000, 1],      # 2 ok
        ["15.04.2025", None, "M-AC15", 1000, 1],        # 3 missing customer
        ["15.04.2025", "C100", "M-UNKNOWN", 1000, 1],   # 4 unmapped material
        ["15.04.2025", "C999", "M-AC15", 1000, 1],      # 5 unmapped customer
        ["15.04.2025", "C100", "M-AC15", -500, 1],      # 6 negative -> warning only
        ["15.04.2025", "C100", "M-AC15", "abc", 1],     # 7 bad number
        ["31.02.2025", "C100", "M-AC15", 1000, 1],      # 8 bad date
        ["15.04.2025", "C100", "M-AC15", 1000, 1],      # 9 exact duplicate of row 2 -> excluded
    ]
    f = make_xlsx(tmp_path / "bad.xlsx", SAP_HEADERS, rows)
    b = upload(client, team["editor"], f)["batch"]
    s = map_and_stage(client, team["editor"], b["id"])
    assert s["total_rows"] == 8 and s["excluded_rows"] == 1 and s["error_rows"] == 5 and s["warning_rows"] == 1
    assert not s["can_submit"]
    assert s["issue_counts"] == {"missing": 1, "unmapped_material": 1, "unmapped_customer": 1, "negative": 1,
                                 "bad_number": 1, "bad_date": 1}

    errors = client.get(f"/api/import/batches/{b['id']}/rows", headers=auth(team["editor"]), params={"filter": "errors"}).json()
    assert [r["row_no"] for r in errors["rows"]] == [3, 4, 5, 7, 8]
    excluded = client.get(f"/api/import/batches/{b['id']}/rows", headers=auth(team["editor"]), params={"filter": "excluded"}).json()
    assert excluded["rows"][0]["issues"][0]["code"] == "duplicate"

    r = client.post(f"/api/import/batches/{b['id']}/submit", headers=auth(team["editor"]))
    assert r.status_code == 409 and r.json()["detail"]["code"] == "has_errors"

    def edit(row_no, **body):
        r = client.patch(f"/api/import/batches/{b['id']}/rows/{row_no}", headers=auth(team["editor"]), json=body)
        assert r.status_code == 200, r.text
        return r.json()["summary"]

    edit(3, values={"customer_code": "C200"})
    edit(7, values={"amount": "1500.25"})
    edit(8, values={"period_date": "28.02.2026"})
    edit(4, excluded=True)
    # the Admin maps the missing customer code, then the editor re-checks
    client.post("/api/master/customer-map", headers=auth(team["admin2"]),
                json={"customer_code": "C999", "oem_id": team["ids"]["o2"]})
    s = client.post(f"/api/import/batches/{b['id']}/validate", headers=auth(team["editor"])).json()["summary"]
    assert s["error_rows"] == 0 and s["can_submit"] and s["warning_rows"] == 1
    rows_after = client.get(f"/api/import/batches/{b['id']}/rows", headers=auth(team["editor"])).json()["rows"]
    edited = next(r for r in rows_after if r["row_no"] == 7)
    assert edited["values"]["amount"] == "1500.25" and edited["edited_fields"] == ["amount"]
    assert client.post(f"/api/import/batches/{b['id']}/submit", headers=auth(team["editor"])).status_code == 200


def test_mapping_must_cover_required_fields(client, team, tmp_path):
    f = make_xlsx(tmp_path / "x.xlsx", SAP_HEADERS, [["15.04.2025", "C100", "M-AC15", 1, 1]])
    b = upload(client, team["editor"], f)["batch"]
    r = client.post(f"/api/import/batches/{b['id']}/mapping", headers=auth(team["editor"]),
                    json={"sheet": "Export", "header_row": 1, "column_map": {"period_date": "Billing Date", "amount": "Net Value"}})
    assert r.status_code == 400 and "SAP customer code" in r.json()["detail"]["message"]
    r = client.post(f"/api/import/batches/{b['id']}/mapping", headers=auth(team["editor"]),
                    json={"sheet": "Export", "header_row": 1, "column_map": {"customer_code": "Sold-To Party",
                          "material_code": "Material", "amount": "Net Value"}})
    assert r.json()["detail"]["message"].startswith("Map a date column")


def test_rejects_non_excel_files(client, team, tmp_path):
    f = tmp_path / "data.csv"
    f.write_text("a,b\n1,2")
    r = client.post("/api/import/upload", headers=auth(team["editor"]), json={"dataset_type": "sales", "path": str(f)})
    assert r.status_code == 400 and "xlsx" in r.json()["detail"]["message"]
    fake = tmp_path / "fake.xlsx"
    fake.write_text("not a zip")
    r = client.post("/api/import/upload", headers=auth(team["editor"]), json={"dataset_type": "sales", "path": str(fake)})
    assert r.status_code == 400


# ------------------------------------------------------------------ approval rules


def _submitted(client, team, tmp_path, rows=None, name="s.xlsx"):
    f = make_xlsx(tmp_path / name, SAP_HEADERS, rows or [["15.04.2025", "C100", "M-AC15", 100, 1]])
    b = upload(client, team["editor"], f)["batch"]
    map_and_stage(client, team["editor"], b["id"])
    client.post(f"/api/import/batches/{b['id']}/submit", headers=auth(team["editor"]))
    return b["id"]


def test_uploader_cannot_approve_own_upload(client, team, tmp_path):
    f = make_xlsx(tmp_path / "own.xlsx", SAP_HEADERS, [["15.04.2025", "C100", "M-AC15", 100, 1]])
    b = upload(client, team["approver"], f)["batch"]
    map_and_stage(client, team["approver"], b["id"])
    client.post(f"/api/import/batches/{b['id']}/submit", headers=auth(team["approver"]))
    r = client.post(f"/api/approvals/{b['id']}/approve", headers=auth(team["approver"]), json={})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "own_upload"


def test_two_level_approval_chain(client, team, tmp_path, settings):
    r = client.put("/api/approvals/levels", headers=auth(team["admin2"]), json={"dataset_type": "sales", "roles": ["approver", "admin"]})
    assert r.status_code == 200 and r.json()["sales"] == ["approver", "admin"]
    bid = _submitted(client, team, tmp_path)
    r = client.post(f"/api/approvals/{bid}/approve", headers=auth(team["approver"]), json={})
    assert r.json()["status"] == "submitted" and r.json()["current_level"] == 2
    assert sales_total(settings.paths.db_file) == 0  # not live yet
    r = client.post(f"/api/approvals/{bid}/approve", headers=auth(team["approver"]), json={})
    assert r.status_code == 403  # already decided at level 1 and level 2 needs Admin
    r = client.post(f"/api/approvals/{bid}/approve", headers=auth(team["admin2"]), json={})
    assert r.json()["status"] == "approved" and sales_total(settings.paths.db_file) == 10_000
    assert [d["decision"] for d in r.json()["decisions"]] == ["approved", "approved"]


def test_levels_must_not_go_down(client, team):
    r = client.put("/api/approvals/levels", headers=auth(team["admin2"]), json={"dataset_type": "*", "roles": ["admin", "approver"]})
    assert r.status_code == 400


def test_reject_needs_reason_then_reopen(client, team, tmp_path):
    bid = _submitted(client, team, tmp_path)
    assert client.post(f"/api/approvals/{bid}/reject", headers=auth(team["approver"]), json={"comment": ""}).status_code == 400
    r = client.post(f"/api/approvals/{bid}/reject", headers=auth(team["approver"]), json={"comment": "Wrong month"})
    assert r.json()["status"] == "rejected" and r.json()["decisions"][0]["comment"] == "Wrong month"
    r = client.post(f"/api/import/batches/{bid}/reopen", headers=auth(team["editor"]))
    assert r.json()["status"] == "draft"


# ------------------------------------------------------------------ versioning


def test_new_upload_replaces_only_the_periods_it_covers_and_keeps_history(client, team, tmp_path, settings):
    a = full_upload(client, team, tmp_path, [["15.04.2025", "C100", "M-AC15", 100, 1],
                                             ["15.05.2025", "C100", "M-AC15", 200, 1]], "a.xlsx")
    b = full_upload(client, team, tmp_path, [["10.05.2025", "C200", "M-FR300", 500, 1]], "b.xlsx")
    current = db_exec(client, "SELECT fiscal_month, batch_id FROM period_versions WHERE valid_to IS NULL ORDER BY fiscal_month")
    assert current == [(1, a), (2, b)]
    history = db_exec(client, "SELECT fiscal_month, batch_id FROM period_versions WHERE valid_to IS NOT NULL")
    assert history == [(2, a)]
    statuses = dict(db_exec(client, "SELECT id, status FROM upload_batches"))
    assert statuses[a] == "approved" and statuses[b] == "approved"
    detail = client.get(f"/api/import/batches/{a}", headers=auth(team["viewer"])).json()
    assert detail["current_months"] == 1

    c = full_upload(client, team, tmp_path, [["01.04.2025", "C200", "M-AC15", 50, 1]], "c.xlsx")
    statuses = dict(db_exec(client, "SELECT id, status FROM upload_batches"))
    assert statuses[a] == "superseded" and statuses[c] == "approved"
    # superseded facts are still in the database (history), only no longer current
    assert db_exec(client, "SELECT COUNT(*) FROM sales_facts WHERE batch_id = :a", a=a)[0][0] == 2


def test_partial_replacement_of_a_quarter_is_refused(client, team, tmp_path):
    assert client.put("/api/settings/datasets", headers=auth(team["admin2"]),
                      json={"dataset_type": "sales", "period_grain": "Q"}).status_code == 200
    full_upload(client, team, tmp_path, [["15.04.2025", "C100", "M-AC15", 100, 1]], "q.xlsx")
    client.put("/api/settings/datasets", headers=auth(team["admin2"]), json={"dataset_type": "sales", "period_grain": "M"})
    bid = _submitted(client, team, tmp_path, [["15.05.2025", "C100", "M-AC15", 100, 1]], "m.xlsx")
    r = client.post(f"/api/approvals/{bid}/approve", headers=auth(team["approver"]), json={})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "partial_period"
    assert "Q1 FY2025-26" in r.json()["detail"]["message"]
    assert db_exec(client, "SELECT status FROM upload_batches WHERE id = :b", b=bid)[0][0] == "submitted"


def test_approval_rechecks_master_data(client, team, tmp_path):
    bid = _submitted(client, team, tmp_path)
    mid = next(m["id"] for m in client.get("/api/master/material-map", headers=auth(team["admin2"])).json()
               if m["material_code"] == "M-AC15")
    client.patch(f"/api/master/material-map/{mid}", headers=auth(team["admin2"]), json={"is_active": False})
    r = client.post(f"/api/approvals/{bid}/approve", headers=auth(team["approver"]), json={})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "no_longer_valid"


def test_changing_a_mapping_repoints_approved_facts(client, team, tmp_path):
    full_upload(client, team, tmp_path, [["15.04.2025", "C100", "M-AC15", 100, 1]])
    mid = next(m["id"] for m in client.get("/api/master/material-map", headers=auth(team["admin2"])).json()
               if m["material_code"] == "M-AC15")
    r = client.patch(f"/api/master/material-map/{mid}", headers=auth(team["admin2"]), json={"product_id": team["ids"]["p2"]})
    assert r.status_code == 200
    assert db_exec(client, "SELECT product_id, division_id FROM sales_facts")[0] == (team["ids"]["p2"], team["ids"]["d2"])
    last = db_exec(client, "SELECT details FROM audit_log WHERE action = 'master_updated' ORDER BY id DESC LIMIT 1")[0][0]
    assert '"facts_updated": 1' in last


# ------------------------------------------------------------------ other datasets


def test_quarterly_balance_sheet_with_fiscal_year_and_quarter(client, team, tmp_path, settings):
    headers = ["Year", "Quarter", "Equity", "Debt"]
    f = make_xlsx(tmp_path / "bs.xlsx", headers, [["FY2025-26", "Q1", 5_00_00_000, 1_00_00_000],
                                                  ["FY2025-26", "Q2", 5_20_00_000, 90_00_000],
                                                  ["FY2025-26", "Q2", 5_25_00_000, 90_00_000]])  # conflicting Q2
    b = upload(client, team["editor"], f, dataset="balance_sheet")["batch"]
    assert b["period_grain"] == "Q"
    s = map_and_stage(client, team["editor"], b["id"], column_map={"fiscal_year": "Year", "period_no": "Quarter",
                                                                   "total_equity": "Equity", "total_debt": "Debt"})
    assert s["issue_counts"] == {"conflict": 1} and not s["can_submit"]
    client.patch(f"/api/import/batches/{b['id']}/rows/4", headers=auth(team["editor"]), json={"excluded": True})
    client.post(f"/api/import/batches/{b['id']}/submit", headers=auth(team["editor"]))
    r = client.post(f"/api/approvals/{b['id']}/approve", headers=auth(team["approver"]), json={})
    assert r.json()["status"] == "approved"
    metrics = db_exec(client, "SELECT period_no, metric, value FROM metric_facts ORDER BY period_no, metric")
    assert metrics == [(1, "total_debt", 1_00_00_000 * 100), (1, "total_equity", 5_00_00_000 * 100),
                       (2, "total_debt", 90_00_000 * 100), (2, "total_equity", 5_20_00_000 * 100)]


def test_receivables_ageing_buckets(client, team, tmp_path):
    f = make_xlsx(tmp_path / "ar.xlsx", ["As of", "Customer", "Bucket", "Outstanding"],
                  [["30.06.2025", "C100", "0 - 30", 1000], ["30.06.2025", "C100", ">90 days", 500], ["30.06.2025", "C200", "45", 1]])
    b = upload(client, team["editor"], f, dataset="receivables")["batch"]
    s = map_and_stage(client, team["editor"], b["id"], column_map={"period_date": "As of", "customer_code": "Customer",
                                                                   "ageing_bucket": "Bucket", "amount": "Outstanding"})
    assert s["issue_counts"] == {"bad_bucket": 1}


# ------------------------------------------------------------------ overrides, history, reimport


def test_override_needs_password_and_reason_and_is_logged(client, team, tmp_path, settings):
    full_upload(client, team, tmp_path, [["15.04.2025", "C100", "M-AC15", 100, 1]])
    fid = db_exec(client, "SELECT id FROM sales_facts")[0][0]
    body = {"fact_table": "sales_facts", "fact_id": fid, "field": "amount_paise", "new_value": "150.50",
            "reason": "Credit note posted late in SAP", "password": "Wrong!Passw0rd"}
    r = client.post("/api/overrides", headers=auth(team["approver"]), json=body)
    assert r.json()["detail"]["code"] == "wrong_password"
    r = client.post("/api/overrides", headers=auth(team["approver"]), json={**body, "password": GOOD, "reason": "x"})
    assert r.json()["detail"]["code"] == "reason_required"
    r = client.post("/api/overrides", headers=auth(team["editor"]), json={**body, "password": GOOD})
    assert r.status_code == 403  # editors cannot override
    r = client.post("/api/overrides", headers=auth(team["approver"]), json={**body, "password": GOOD})
    assert r.status_code == 200 and r.json()["old_value"] == "100" and r.json()["new_value"] == "150.5"
    assert sales_total(settings.paths.db_file) == 15_050
    last = db_exec(client, "SELECT action, details FROM audit_log ORDER BY id DESC LIMIT 1")[0]
    assert last[0] == "override" and "Credit note" in last[1]


def test_reimport_from_archive(client, team, tmp_path):
    a = full_upload(client, team, tmp_path, [["15.04.2025", "C100", "M-AC15", 100, 1]])
    r = client.post(f"/api/import/batches/{a}/reimport", headers=auth(team["editor"]))
    assert r.status_code == 201
    new = r.json()["batch"]
    assert new["status"] == "draft" and new["reimport_of"] == a and r.json()["summary"]["ready_rows"] == 1


def test_same_file_twice_is_flagged(client, team, tmp_path):
    full_upload(client, team, tmp_path, [["15.04.2025", "C100", "M-AC15", 100, 1]], "dup.xlsx")
    res = upload(client, team["editor"], tmp_path / "dup.xlsx")
    assert res["duplicate_of"]["status"] == "approved"


def test_discard_draft(client, team, tmp_path):
    f = make_xlsx(tmp_path / "d.xlsx", SAP_HEADERS, [["15.04.2025", "C100", "M-AC15", 100, 1]])
    b = upload(client, team["editor"], f)["batch"]
    map_and_stage(client, team["editor"], b["id"])
    assert client.post(f"/api/import/batches/{b['id']}/discard", headers=auth(team["editor"])).status_code == 204
    assert db_exec(client, "SELECT COUNT(*) FROM upload_batches")[0][0] == 0
    assert db_exec(client, "SELECT COUNT(*) FROM staging_rows")[0][0] == 0


def test_large_upload_is_handled(client, team, tmp_path, settings):
    rows = [[f"{(i % 28) + 1:02d}.0{4 + i % 6}.2025", "C100" if i % 2 else "C200", "M-AC15" if i % 3 else "M-FR300", i + 1, 1]
            for i in range(20_000)]
    full_upload(client, team, tmp_path, rows, "big.xlsx")
    assert sales_total(settings.paths.db_file) == sum(range(1, 20_001)) * 100


def test_archive_file_is_byte_identical(tmp_path):
    f = make_xlsx(tmp_path / "orig.xlsx", SAP_HEADERS, [["15.04.2025", "C100", "M-AC15", 1, 1]])
    rel, digest = importer.archive_file(f, tmp_path / "uploads")
    assert digest == hashlib.sha256(f.read_bytes()).hexdigest()
    assert (tmp_path / "uploads" / rel).read_bytes() == f.read_bytes()
    # uploading the same file again reuses the archived copy
    assert importer.archive_file(f, tmp_path / "uploads") == (rel, digest)
