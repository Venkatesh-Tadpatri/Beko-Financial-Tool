from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from app.core import fiscal
from app.core.money import MoneyParseError, paise_to_crore, parse_decimal, to_count, to_paise


@pytest.mark.parametrize(
    ("d", "fy", "fm"),
    [
        (date(2025, 4, 1), 2025, 1),
        (date(2025, 12, 31), 2025, 9),
        (date(2026, 1, 1), 2025, 10),
        (date(2026, 3, 31), 2025, 12),
        (date(2026, 4, 1), 2026, 1),
    ],
)
def test_fiscal_year_and_month(d, fy, fm):
    assert fiscal.fy_of(d) == fy
    assert fiscal.fiscal_month_of(d) == fm
    assert fiscal.calendar_month(fy, fm) == (d.year, d.month)


def test_period_months():
    assert list(fiscal.months_of("Q", 4)) == [10, 11, 12]
    assert list(fiscal.months_of("H", 2)) == [7, 8, 9, 10, 11, 12]
    assert list(fiscal.months_of("Y", 1)) == list(range(1, 13))
    with pytest.raises(ValueError):
        fiscal.months_of("Q", 5)


def test_roll_up_rules():
    assert fiscal.can_roll_up("M", "Q") and fiscal.can_roll_up("Q", "H") and fiscal.can_roll_up("Q", "Y")
    assert not fiscal.can_roll_up("Q", "M") and not fiscal.can_roll_up("Y", "H")
    assert fiscal.roll_up_period("M", 7, "Q") == 3
    assert fiscal.roll_up_period("Q", 3, "H") == 2


def test_period_bounds_and_days_including_leap_year():
    assert fiscal.period_bounds(2025, "Q", 4) == (date(2026, 1, 1), date(2026, 3, 31))
    assert fiscal.days_in_period(2023, "Y", 1) == 366  # Feb 2024
    assert fiscal.days_in_period(2024, "Y", 1) == 365
    assert fiscal.days_in_period(2025, "M", 11) == 28  # Feb 2026


def test_labels():
    assert fiscal.fy_label(2025) == "FY2025-26"
    assert fiscal.fy_label(1999) == "FY1999-00"
    assert fiscal.period_label(2025, "Q", 2) == "Q2 FY2025-26"
    assert fiscal.period_label(2025, "M", 10) == "Jan 2026"


@pytest.mark.parametrize(
    ("raw", "paise"),
    [
        (100, 10000),
        (0.1 + 0.2, 30),  # float noise is rounded, not truncated
        ("1,23,456.78", 12345678),
        ("₹ 1,000", 100000),
        ("Rs. 50.005", 5001),  # half-up
        ("(500)", -50000),
        ("-12.5", -1250),
        (Decimal("2.345"), 235),
    ],
)
def test_to_paise(raw, paise):
    assert to_paise(raw) == paise


@pytest.mark.parametrize("bad", [None, "", "abc", float("nan"), float("inf"), True, "1.2.3"])
def test_to_paise_rejects(bad):
    with pytest.raises(MoneyParseError):
        to_paise(bad)


def test_counts_and_crore():
    assert to_count("1,000") == 1000
    with pytest.raises(MoneyParseError):
        to_count("1.5")
    assert paise_to_crore(1_000_000_000) == 1.0
    assert parse_decimal("  42 ") == Decimal(42)
