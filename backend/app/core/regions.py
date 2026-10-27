"""GST state codes (the 2-digit "Region" column in SAP sales registers) and their sales zones.

Zones follow the usual four-way split for Indian sales reporting. Central states
(Madhya Pradesh, Chhattisgarh) are grouped with West, Rajasthan with North and
the North-East with East.
"""

from __future__ import annotations

import re

ZONES = ("North", "South", "East", "West")
UNASSIGNED = "Unassigned"

# code: (state, zone)
STATES: dict[str, tuple[str, str]] = {
    "01": ("Jammu & Kashmir", "North"),
    "02": ("Himachal Pradesh", "North"),
    "03": ("Punjab", "North"),
    "04": ("Chandigarh", "North"),
    "05": ("Uttarakhand", "North"),
    "06": ("Haryana", "North"),
    "07": ("Delhi", "North"),
    "08": ("Rajasthan", "North"),
    "09": ("Uttar Pradesh", "North"),
    "10": ("Bihar", "East"),
    "11": ("Sikkim", "East"),
    "12": ("Arunachal Pradesh", "East"),
    "13": ("Nagaland", "East"),
    "14": ("Manipur", "East"),
    "15": ("Mizoram", "East"),
    "16": ("Tripura", "East"),
    "17": ("Meghalaya", "East"),
    "18": ("Assam", "East"),
    "19": ("West Bengal", "East"),
    "20": ("Jharkhand", "East"),
    "21": ("Odisha", "East"),
    "22": ("Chhattisgarh", "West"),
    "23": ("Madhya Pradesh", "West"),
    "24": ("Gujarat", "West"),
    "25": ("Daman & Diu", "West"),
    "26": ("Dadra & Nagar Haveli and Daman & Diu", "West"),
    "27": ("Maharashtra", "West"),
    "28": ("Andhra Pradesh (old)", "South"),
    "29": ("Karnataka", "South"),
    "30": ("Goa", "West"),
    "31": ("Lakshadweep", "South"),
    "32": ("Kerala", "South"),
    "33": ("Tamil Nadu", "South"),
    "34": ("Puducherry", "South"),
    "35": ("Andaman & Nicobar Islands", "East"),
    "36": ("Telangana", "South"),
    "37": ("Andhra Pradesh", "South"),
    "38": ("Ladakh", "North"),
}

_LEADING_DIGITS = re.compile(r"^\s*(\d{1,2})(?:\.0+)?(?!\d)")


def normalise_code(raw: str | None) -> str | None:
    """'27', '9', '09', '27.0' or '27-Maharashtra' -> '27' / '09'. Anything else -> None."""
    if raw is None:
        return None
    m = _LEADING_DIGITS.match(str(raw))
    return m.group(1).zfill(2) if m else None


def lookup(raw: str | None) -> tuple[str | None, str, str]:
    """(code, state name, zone) for a raw Region value. Unknown codes go to the Unassigned zone."""
    code = normalise_code(raw)
    if code in STATES:
        state, zone = STATES[code]
        return code, state, zone
    if code is not None:
        return code, f"State code {code}", UNASSIGNED
    return None, "Not specified", UNASSIGNED
