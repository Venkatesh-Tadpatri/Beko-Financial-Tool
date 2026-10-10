"""Exact money handling.

Amounts are stored as integer paise (minor units) so figures restored from a
backup reproduce exactly. Conversion to floats happens only at the edge, for
chart rendering.
"""

from __future__ import annotations

import math
import re
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

PAISE_PER_RUPEE = 100
RUPEES_PER_CRORE = 10_000_000
PAISE_PER_CRORE = PAISE_PER_RUPEE * RUPEES_PER_CRORE

_STRIP = re.compile(r"[,\s₹]|INR|Rs\.?", re.IGNORECASE)


class MoneyParseError(ValueError):
    pass


def parse_decimal(value: object) -> Decimal:
    """Parse a cell value from Excel. Accepts numbers, '1,23,456.78', '₹ 100', '(500)' for negatives."""
    if value is None:
        raise MoneyParseError("empty value")
    if isinstance(value, bool):
        raise MoneyParseError("boolean is not a number")
    if isinstance(value, int):
        return Decimal(value)
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            raise MoneyParseError("not a finite number")
        return Decimal(repr(value))
    if isinstance(value, Decimal):
        if not value.is_finite():
            raise MoneyParseError("not a finite number")
        return value
    text = _STRIP.sub("", str(value)).strip()
    negative = text.startswith("(") and text.endswith(")")
    if negative:
        text = text[1:-1]
    if not text:
        raise MoneyParseError("empty value")
    try:
        result = Decimal(text)
    except InvalidOperation as exc:
        raise MoneyParseError(f"not a number: {value!r}") from exc
    if not result.is_finite():
        raise MoneyParseError("not a finite number")
    return -result if negative else result


def to_paise(value: object) -> int:
    rupees = parse_decimal(value)
    return int((rupees * PAISE_PER_RUPEE).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def to_count(value: object) -> int:
    d = parse_decimal(value)
    if d != d.to_integral_value():
        raise MoneyParseError(f"expected a whole number, got {value!r}")
    return int(d)


def paise_to_rupees(paise: int) -> Decimal:
    return Decimal(paise) / PAISE_PER_RUPEE


def paise_to_crore(paise: int) -> float:
    """For charts only."""
    return paise / PAISE_PER_CRORE
