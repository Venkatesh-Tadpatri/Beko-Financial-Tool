"""Indian financial year (April to March) helpers.

A financial year is identified by the calendar year it starts in:
fy=2025 is FY2025-26 (1 Apr 2025 .. 31 Mar 2026). Fiscal month 1 = April,
12 = March.

Grains: M (12 per year), Q (4), H (2), Y (1). Facts may be *stored* at
M, Q or Y (configured per dataset type). H is a reporting grain only.
"""

from __future__ import annotations

import calendar
from datetime import date

GRAINS = ("M", "Q", "H", "Y")
STORAGE_GRAINS = ("M", "Q", "Y")
_MONTHS_PER = {"M": 1, "Q": 3, "H": 6, "Y": 12}
_MONTH_ABBR = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"]


def _check_grain(grain: str) -> None:
    if grain not in GRAINS:
        raise ValueError(f"unknown grain {grain!r}")


def fy_of(d: date) -> int:
    return d.year if d.month >= 4 else d.year - 1


def fiscal_month_of(d: date) -> int:
    return (d.month - 4) % 12 + 1


def calendar_month(fy: int, fiscal_month: int) -> tuple[int, int]:
    """(year, month) of a fiscal month."""
    if not 1 <= fiscal_month <= 12:
        raise ValueError("fiscal_month must be 1..12")
    month = (fiscal_month + 2) % 12 + 1
    return (fy if fiscal_month <= 9 else fy + 1), month


def periods_per_year(grain: str) -> int:
    _check_grain(grain)
    return 12 // _MONTHS_PER[grain]


def months_of(grain: str, period_no: int) -> range:
    """Fiscal months covered by period `period_no` of `grain`."""
    _check_grain(grain)
    if not 1 <= period_no <= periods_per_year(grain):
        raise ValueError(f"period_no {period_no} out of range for grain {grain}")
    size = _MONTHS_PER[grain]
    start = (period_no - 1) * size + 1
    return range(start, start + size)


def period_of_month(grain: str, fiscal_month: int) -> int:
    _check_grain(grain)
    return (fiscal_month - 1) // _MONTHS_PER[grain] + 1


def can_roll_up(stored: str, requested: str) -> bool:
    """True if data stored at `stored` grain can be summed into `requested` periods."""
    _check_grain(stored)
    _check_grain(requested)
    return _MONTHS_PER[requested] >= _MONTHS_PER[stored] and _MONTHS_PER[requested] % _MONTHS_PER[stored] == 0


def roll_up_period(stored: str, stored_no: int, requested: str) -> int:
    if not can_roll_up(stored, requested):
        raise ValueError(f"cannot roll {stored} up to {requested}")
    first_month = months_of(stored, stored_no)[0]
    return period_of_month(requested, first_month)


def period_bounds(fy: int, grain: str, period_no: int) -> tuple[date, date]:
    months = months_of(grain, period_no)
    y1, m1 = calendar_month(fy, months[0])
    y2, m2 = calendar_month(fy, months[-1])
    return date(y1, m1, 1), date(y2, m2, calendar.monthrange(y2, m2)[1])


def days_in_period(fy: int, grain: str, period_no: int) -> int:
    start, end = period_bounds(fy, grain, period_no)
    return (end - start).days + 1


def fy_label(fy: int) -> str:
    return f"FY{fy}-{(fy + 1) % 100:02d}"


def period_label(fy: int, grain: str, period_no: int) -> str:
    _check_grain(grain)
    if grain == "Y":
        return fy_label(fy)
    if grain == "M":
        year, _ = calendar_month(fy, period_no)
        return f"{_MONTH_ABBR[period_no - 1]} {year}"
    return f"{grain}{period_no} {fy_label(fy)}"
