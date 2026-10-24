"""Shared helpers: errors, integer money math, dates, clock times, time stamps, text, CSV.

Money is always an integer number of cents and rates are scaled integers, so no float
ever touches a money value. The JS core (web/src/core/01_util.js) mirrors every function
here and web/parity.test.mjs checks the two against tests/vectors.json.

Text handling is ASCII-defined (whitespace set, case folding, digits) so the Python and JS
versions agree on every input, including hostile ones.
"""

from __future__ import annotations

import re

MAX_CENTS = 1_000_000_000            # $10,000,000.00 cap on any money field and any line amount
SAFE_INT = 9_007_199_254_740_991     # 2**53 - 1, the largest integer both languages hold exactly
MAX_FILE_CHARS = 5 * 1024 * 1024     # import cap: 5 MB of text
MAX_ROWS = 50_000                    # import cap: rows per file
MAX_FIELD_CHARS = 10_000             # import cap: characters in one CSV field


class ServiceError(ValueError):
    """Bad input or a refused change. code is stable and machine readable; message is for people."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def fail(code: str, message: str):
    raise ServiceError(code, message)


# ---------------------------------------------------------------- integers

def is_int(x) -> bool:
    """A whole number both languages hold exactly. 5.0 counts (JSON cannot tell 5 from 5.0)."""
    if isinstance(x, bool):
        return False
    if isinstance(x, int):
        return -SAFE_INT <= x <= SAFE_INT
    if isinstance(x, float):
        return x == x and x.is_integer() and -SAFE_INT <= x <= SAFE_INT
    return False


def div_round(n: int, d: int) -> int:
    """n / d rounded to the nearest integer, halves away from zero. d > 0."""
    if d <= 0:
        fail("bad_divisor", "Divisor must be positive.")
    q = (abs(n) * 2 + d) // (2 * d)
    return q if n >= 0 else -q


def mul_div(a: int, b: int, d: int) -> int:
    """a * b / d rounded half away from zero, exact for any size of a * b."""
    return div_round(a * b, d)


def allocate(amount: int, weights: list) -> list:
    """Split amount across weights in proportion, largest remainder method.

    Each share is floor(amount x w / total); the cents left over go one each to the
    largest remainders, ties to the earlier entry. Shares always sum to amount exactly.
    """
    n = len(weights)
    total = sum(weights)
    if total == 0:
        if amount == 0:
            return [0] * n
        fail("bad_allocation", "Cannot split an amount across lines that add up to zero.")
    if total < 0:
        return [-x for x in allocate(-amount, [-w for w in weights])]
    if amount < 0:
        return [-x for x in allocate(-amount, weights)]
    base = [(amount * w) // total for w in weights]
    rem = [amount * w - base[i] * total for i, w in enumerate(weights)]
    left = amount - sum(base)
    order = sorted(range(n), key=lambda k: (-rem[k], k))
    for k in order[:left]:
        base[k] += 1
    return base


# ---------------------------------------------------------------- text

WS = " \t\n\r\f\v ﻿"
_WS_EDGE = re.compile("^[" + WS + "]+|[" + WS + "]+$")
_WS_RUN = re.compile("[" + WS + "]+")
_CTRL = re.compile("[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]")
_LONE = re.compile("[\ud800-\udfff]")     # a lone surrogate (a valid pair is one code point here)
_UPPER = {c: c + 32 for c in range(65, 91)}
_LOWER = {c: c - 32 for c in range(97, 123)}


def strip(s: str) -> str:
    return _WS_EDGE.sub("", s)


def squash(s: str) -> str:
    """Trim and collapse inner whitespace runs to one space."""
    return _WS_RUN.sub(" ", strip(s))


def lower(s: str) -> str:
    """ASCII-only lower case, identical in both languages."""
    return s.translate(_UPPER)


def upper(s: str) -> str:
    return s.translate(_LOWER)


def clean_text(s, max_len: int, name: str, multiline: bool = False) -> str:
    """Validate and normalise a text field: control characters removed, a lone surrogate
    replaced with U+FFFD, trimmed, length capped (in Unicode code points)."""
    if s is None:
        return ""
    if not isinstance(s, str):
        fail("bad_field", f"{name}: must be text.")
    t = _LONE.sub("\ufffd", _CTRL.sub("", s))
    if not multiline:
        t = t.replace("\r", " ").replace("\n", " ")
    else:
        t = t.replace("\r\n", "\n").replace("\r", "\n")
    t = strip(t)
    if len(t) > max_len:
        fail("bad_field", f"{name}: must be at most {max_len} characters.")
    return t


# ---------------------------------------------------------------- dates

_DATE = re.compile(r"([0-9]{4})-([0-9]{2})-([0-9]{2})")


def is_leap(y: int) -> bool:
    return y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)


def days_in_month(y: int, m: int) -> int:
    return [31, 29 if is_leap(y) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]


def valid_ymd(y: int, m: int, d: int) -> bool:
    return 1900 <= y <= 2200 and 1 <= m <= 12 and 1 <= d <= days_in_month(y, m)


def parse_date(s, name: str = "date") -> list:
    """'YYYY-MM-DD' to [y, m, d]. Years 1900 to 2200."""
    if not isinstance(s, str):
        fail("bad_date", f"{name}: must be a date written YYYY-MM-DD.")
    m = _DATE.fullmatch(s)
    if not m:
        fail("bad_date", f"{name}: must be a date written YYYY-MM-DD.")
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if not valid_ymd(y, mo, d):
        fail("bad_date", f"{name}: {s} is not a real calendar date.")
    return [y, mo, d]


def ymd_str(y: int, m: int, d: int) -> str:
    return f"{y:04d}-{m:02d}-{d:02d}"


def days_from_civil(y: int, m: int, d: int) -> int:
    """Days since 1970-01-01 (H. Hinnant's algorithm, proleptic Gregorian)."""
    y -= 1 if m <= 2 else 0
    era = (y if y >= 0 else y - 399) // 400
    yoe = y - era * 400
    doy = (153 * (m + (-3 if m > 2 else 9)) + 2) // 5 + d - 1
    doe = yoe * 365 + yoe // 4 - yoe // 100 + doy
    return era * 146097 + doe - 719468


def civil_from_days(z: int) -> list:
    z += 719468
    era = (z if z >= 0 else z - 146096) // 146097
    doe = z - era * 146097
    yoe = (doe - doe // 1460 + doe // 36524 - doe // 146096) // 365
    y = yoe + era * 400
    doy = doe - (365 * yoe + yoe // 4 - yoe // 100)
    mp = (5 * doy + 2) // 153
    d = doy - (153 * mp + 2) // 5 + 1
    m = mp + (3 if mp < 10 else -9)
    return [y + (1 if m <= 2 else 0), m, d]


def day_num(s: str) -> int:
    y, m, d = parse_date(s)
    return days_from_civil(y, m, d)


def day_str(z: int) -> str:
    y, m, d = civil_from_days(z)
    return ymd_str(y, m, d)


def add_days(s: str, n: int) -> str:
    return day_str(day_num(s) + n)


def days_between(a: str, b: str) -> int:
    """b - a in days."""
    return day_num(b) - day_num(a)


def add_months(s: str, n: int) -> str:
    """Same day n months later, clamped to the month's last day."""
    y, m, d = parse_date(s)
    k = y * 12 + (m - 1) + n
    y2, m2 = k // 12, k % 12 + 1
    return ymd_str(y2, m2, min(d, days_in_month(y2, m2)))


def month_start(s: str) -> str:
    return s[:8] + "01"


def month_end(s: str) -> str:
    y, m, _ = parse_date(s)
    return ymd_str(y, m, days_in_month(y, m))


def weekday(s: str) -> int:
    """ISO weekday: 1 = Monday ... 7 = Sunday."""
    return (day_num(s) + 3) % 7 + 1


def week_start(s: str) -> str:
    """The Monday on or before s."""
    return add_days(s, 1 - weekday(s))


# ---------------------------------------------------------------- clock times and stamps

_TIME = re.compile(r"([0-9]{2}):([0-9]{2})")
_STAMP = re.compile(r"([0-9]{4}-[0-9]{2}-[0-9]{2})T([0-9]{2}):([0-9]{2})(?::([0-9]{2}))?(Z|[+-][0-9]{2}:[0-9]{2})")


def parse_time(s, name: str = "time") -> int:
    """'HH:MM' (00:00 to 24:00) to minutes after midnight."""
    if not isinstance(s, str):
        fail("bad_time", f"{name}: must be a time written HH:MM.")
    m = _TIME.fullmatch(s)
    if not m:
        fail("bad_time", f"{name}: must be a time written HH:MM.")
    h, mi = int(m.group(1)), int(m.group(2))
    if mi > 59 or h > 24 or (h == 24 and mi != 0):
        fail("bad_time", f"{name}: {s} is not a time of day.")
    return h * 60 + mi


def time_str(minutes: int) -> str:
    """Minutes after midnight to 'HH:MM'; values past 24:00 wrap to the next day."""
    m = minutes % 1440 if minutes != 1440 else 1440
    return f"{m // 60:02d}:{m % 60:02d}"


def parse_stamp(s, name: str = "time stamp") -> int:
    """ISO 8601 local time with its UTC offset ('2026-11-01T01:30:00-05:00' or ...Z) to
    seconds since 1970-01-01 UTC. The offset is what the device clock reported, so elapsed
    time across a daylight saving change is exact."""
    if not isinstance(s, str):
        fail("bad_stamp", f"{name}: must be a time stamp like 2026-10-05T08:00:00-05:00.")
    m = _STAMP.fullmatch(s)
    if not m:
        fail("bad_stamp", f"{name}: must be a time stamp like 2026-10-05T08:00:00-05:00.")
    days = day_num(m.group(1))
    h, mi, sec = int(m.group(2)), int(m.group(3)), int(m.group(4) or "0")
    if h > 23 or mi > 59 or sec > 59:
        fail("bad_stamp", f"{name}: {s} is not a time of day.")
    off = 0
    z = m.group(5)
    if z != "Z":
        oh, om = int(z[1:3]), int(z[4:6])
        if oh > 14 or om > 59:
            fail("bad_stamp", f"{name}: {z} is not a UTC offset.")
        off = (oh * 60 + om) * (1 if z[0] == "+" else -1)
    return days * 86400 + h * 3600 + mi * 60 + sec - off * 60


def stamp_local(s: str) -> list:
    """The local date and minutes after midnight written in a stamp: [date, minutes]."""
    parse_stamp(s)
    return [s[:10], int(s[11:13]) * 60 + int(s[14:16])]


def elapsed_minutes(a: str, b: str) -> int:
    """Whole minutes from stamp a to stamp b, rounded down. Negative if b is before a."""
    d = parse_stamp(b, "end") - parse_stamp(a, "start")
    return d // 60 if d >= 0 else -((-d) // 60)


# ---------------------------------------------------------------- money text

def cents_text(c: int) -> str:
    """Plain decimal text for CSV: -1234.5 dollars is -1234.50, no separators."""
    sign = "-" if c < 0 else ""
    c = abs(c)
    return f"{sign}{c // 100}.{c % 100:02d}"


def money(c: int) -> str:
    """Display text: -$1,234.50."""
    sign = "-" if c < 0 else ""
    c = abs(c)
    whole = str(c // 100)
    groups = []
    while len(whole) > 3:
        groups.insert(0, whole[-3:])
        whole = whole[:-3]
    groups.insert(0, whole)
    return f"{sign}${','.join(groups)}.{c % 100:02d}"


def milli_text(q: int) -> str:
    """A scaled quantity (x1000) as short text: 1500 is 1.5, 2000 is 2."""
    sign = "-" if q < 0 else ""
    q = abs(q)
    frac = f"{q % 1000:03d}".rstrip("0")
    return f"{sign}{q // 1000}" + ("." + frac if frac else "")


def pct_text(bp: int) -> str:
    """Basis points as a percent with two decimals: 1234 is 12.34%."""
    sign = "-" if bp < 0 else ""
    bp = abs(bp)
    return f"{sign}{bp // 100}.{bp % 100:02d}%"


def parse_money(s, name: str = "amount") -> int:
    """'$1,234.5' or '1234.50' or '-12' to cents. At most two decimals."""
    if not isinstance(s, str):
        fail("bad_amount", f"{name}: must be an amount like 1234.50.")
    t = strip(s).replace(",", "").replace("$", "")
    neg = t.startswith("-")
    if neg:
        t = t[1:]
    m = re.fullmatch(r"([0-9]{1,10})(?:\.([0-9]{0,2}))?|\.([0-9]{1,2})", t)
    if not m:
        fail("bad_amount", f"{name}: \"{s[:20]}\" is not an amount.")
    if m.group(3) is not None:
        c = int((m.group(3) + "0")[:2])
    else:
        c = int(m.group(1)) * 100 + int(((m.group(2) or "") + "00")[:2])
    if c > MAX_CENTS:
        fail("bad_amount", f"{name}: must be at most $10,000,000.00.")
    return -c if neg else c


def parse_milli(s, name: str = "quantity") -> int:
    """'1.5' to 1500. At most three decimals, not negative."""
    if not isinstance(s, str):
        fail("bad_quantity", f"{name}: must be a number like 1.5.")
    t = strip(s).replace(",", "")
    m = re.fullmatch(r"([0-9]{1,7})(?:\.([0-9]{0,3}))?|\.([0-9]{1,3})", t)
    if not m:
        fail("bad_quantity", f"{name}: \"{s[:20]}\" is not a number with at most 3 decimals.")
    if m.group(3) is not None:
        return int((m.group(3) + "00")[:3])
    return int(m.group(1)) * 1000 + int(((m.group(2) or "") + "000")[:3])


# ---------------------------------------------------------------- CSV

# A spreadsheet may run a cell as a formula when it starts with one of these, including the
# full-width forms some input methods type, and including after leading spaces.
FORMULA_START = ("=", "+", "-", "@", "\t", "\r", "\uff1d", "\uff0b", "\uff0d", "\uff20")


def csv_cell(v) -> str:
    """One CSV field. Text that a spreadsheet would run as a formula gets a leading apostrophe."""
    if v is None:
        text = ""
    elif isinstance(v, bool):
        text = "yes" if v else "no"
    elif isinstance(v, int):
        text = str(v)
    else:
        text = str(v)
        if text.lstrip(" \u00a0\u3000").startswith(FORMULA_START):
            text = "'" + text
    if any(ch in text for ch in ',"\n\r'):
        text = '"' + text.replace('"', '""') + '"'
    return text


def to_csv(rows: list) -> str:
    """Rows to CSV. A cell given as {"$": cents} is money and is written as plain decimal
    text (its leading minus is safe because the program wrote it)."""
    out = []
    for row in rows:
        cells = []
        for v in row:
            if isinstance(v, dict) and "$" in v:
                cells.append(cents_text(v["$"]))
            else:
                cells.append(csv_cell(v))
        out.append(",".join(cells))
    return "\r\n".join(out) + "\r\n"


def check_size(text, what: str = "file") -> str:
    if not isinstance(text, str):
        fail("bad_file", f"The {what} could not be read as text.")
    if len(text) > MAX_FILE_CHARS:
        fail("too_large", f"The {what} is larger than 5 MB. Split it into smaller files.")
    return text


def sniff_delimiter(first_line: str) -> str:
    best, bc = ",", 0
    for d in (",", "\t", ";", "|"):
        c = first_line.count(d)
        if c > bc:
            best, bc = d, c
    return best


def parse_csv(text, delimiter: str = "") -> dict:
    """RFC 4180 CSV with quoted fields, doubled quotes and CRLF or LF line ends.

    The delimiter is detected from the first line when not given (comma, tab, semicolon or
    pipe). Blank lines are dropped. Capped at 5 MB, 50,000 rows and 10,000 characters per
    field. Returns {"delimiter", "rows"}; each row keeps its 1-based line number.
    """
    text = check_size(text)
    if text.startswith("﻿"):
        text = text[1:]
    if delimiter == "":
        nl = text.find("\n")
        delimiter = sniff_delimiter(text if nl < 0 else text[:nl])
    rows = []
    row = []
    field = []
    i = 0
    n = len(text)
    line = 1
    row_line = 1
    in_quotes = False
    started = False

    def push():
        rows.append({"line": row_line, "cells": row})
        if len(rows) > MAX_ROWS:
            fail("too_many_rows", f"The file has more than {MAX_ROWS} rows. Split it into smaller files.")

    while i < n:
        ch = text[i]
        if in_quotes:
            if ch == '"':
                if i + 1 < n and text[i + 1] == '"':
                    field.append('"')
                    i += 2
                    continue
                in_quotes = False
                i += 1
                continue
            if ch == "\n":
                line += 1
            field.append(ch)
        elif ch == '"' and not started:
            in_quotes = True
            started = True
        elif ch == delimiter:
            row.append("".join(field))
            field = []
            started = False
        elif ch == "\r" or ch == "\n":
            row.append("".join(field))
            field = []
            started = False
            push()
            row = []
            if ch == "\r" and i + 1 < n and text[i + 1] == "\n":
                i += 1
            line += 1
            row_line = line
        else:
            field.append(ch)
            started = True
        if len(field) > MAX_FIELD_CHARS:
            fail("field_too_long", f"Line {row_line}: a field is longer than {MAX_FIELD_CHARS} characters.")
        i += 1
    if in_quotes:
        fail("bad_csv", f"Line {row_line}: a quoted field is never closed.")
    if started or row:
        row.append("".join(field))
        push()
    out = []
    for r in rows:
        cells = [strip(c) for c in r["cells"]]
        if any(c != "" for c in cells):
            out.append({"line": r["line"], "cells": cells})
    return {"delimiter": delimiter, "rows": out}


# ---------------------------------------------------------------- small shared helpers

def esc_html(s: str) -> str:
    """Escape text for HTML element content and double-quoted attribute values."""
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;").replace("'", "&#39;"))


def deep_equal(a, b) -> bool:
    """Equality of JSON values (records hold only text, whole numbers, booleans, lists,
    objects and null, and every field has one type, so == is exact here)."""
    return a == b


def show(x) -> str:
    """A value for an error message: text cut to 40 characters, anything else a fixed word."""
    return x[:40] if isinstance(x, str) else "(not text)"
