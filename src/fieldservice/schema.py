"""Data model: field tables for every record, validation, cross-record rules, and the
versioned JSON backup.

One business is one JSON object (a "book"): settings plus one list per record kind. Every
record is checked against its field table: known keys only, text trimmed with control
characters removed and length capped, whole cents in range, real dates and clock times,
enums, and references that resolve. Money never passes through a float.
"""

from __future__ import annotations

import json
import re

from .brand import BACKUP_FORMAT, BACKUP_VERSION, PRODUCT_NAME
from .util import (MAX_CENTS, ServiceError, clean_text, fail, is_int, mul_div, parse_date, parse_stamp, parse_time)

KINDS = ("clients", "properties", "crew", "items", "requests", "quotes", "jobs", "visits", "timesheets",
         "expenses", "photos", "invoices", "payments", "reminders")
MAX_RECORDS = 100_000
MAX_BACKUP_CHARS = 64 * 1024 * 1024
ID_RE = re.compile(r"[A-Za-z0-9_-]{1,40}")
COORD = {"lat": 90_000_000, "lon": 180_000_000}


def S(n, req=False):
    return {"t": "str", "max": n, "req": req}


def T(n):
    return {"t": "text", "max": n}


def I(lo, hi, d=0):
    return {"t": "int", "lo": lo, "hi": hi, "d": d}


def M(lo=0, hi=MAX_CENTS):
    return {"t": "cents", "lo": lo, "hi": hi}


def E(*vals):
    return {"t": "enum", "v": list(vals)}


def B(d=False):
    return {"t": "bool", "d": d}


def D(opt=False):
    return {"t": "date", "opt": opt}


def TM():
    return {"t": "time"}


def ST():
    return {"t": "stamp"}


def R(kind, opt=False):
    return {"t": "ref", "k": kind, "opt": opt}


def RS(kind, mx=20):
    return {"t": "refs", "k": kind, "max": mx}


def L(sub, mx):
    return {"t": "list", "of": sub, "max": mx}


ID = {"t": "id"}
LINE_KINDS = ("service", "material", "other")
DISC = {"discount_kind": E("pct", "amt"), "discount_value": I(0, MAX_CENTS), "tax_rate_milli": I(0, 100_000),
        "tax_mode": E("document", "line")}

FIELD_TABLES = {
    "settings": {
        "business_name": S(200), "address": T(500), "phone": S(50), "email": S(200), "website": S(200),
        "license": S(100), "home_lat_e6": {"t": "coord", "axis": "lat"}, "home_lon_e6": {"t": "coord", "axis": "lon"},
        "tax_rate_milli": I(0, 100_000), "tax_mode": E("document", "line"), "terms_days": I(0, 365, 30),
        "quote_valid_days": I(0, 365, 30), "quote_followup_days": I(0, 90, 3), "visit_reminder_days": I(0, 14, 1),
        "overdue_steps": {"t": "ints", "lo": 1, "hi": 365, "max": 6, "d": [1, 7, 14, 30]},
        "visit_horizon_days": I(7, 400, 60), "quote_prefix": S(10), "job_prefix": S(10), "invoice_prefix": S(10),
        "next_quote": I(1, 999_999_999, 1), "next_job": I(1, 999_999_999, 1), "next_invoice": I(1, 999_999_999, 1),
        "payment_links": L("link", 8), "auto_quote_to_job": B(True), "auto_generate_visits": B(True),
        "auto_draft_invoices": B(True), "auto_timesheets": B(True), "auto_reminders": B(True),
        "day_start": TM(), "day_end": TM(), "quote_message": T(2000), "invoice_message": T(2000),
    },
    "link": {"kind": E("stripe", "square", "paypal", "venmo", "cashapp", "zelle", "ach", "other"), "label": S(60),
             "value": S(300, True)},
    "line": {"id": ID, "item_id": R("items", True), "name": S(200, True), "description": T(1000), "kind": E(*LINE_KINDS),
             "qty_milli": I(0, 1_000_000_000, 1000), "rate": M(), "cost": M(), "taxable": B(), "optional": B(),
             "selected": B(True)},
    "check": {"id": ID, "text": S(200, True), "done": B(), "note": S(500)},
    "rule": {"freq": E("weekly", "monthly", "daily"), "interval": I(1, 366, 1), "days": {"t": "ints", "lo": 1, "hi": 7, "max": 7, "d": []},
             "month_mode": E("day", "nth"), "month_day": I(-1, 31, 1), "nth": I(-1, 4, 1), "weekday": I(1, 7, 1),
             "exceptions": {"t": "dates", "max": 500}},
    "clients": {"id": ID, "name": S(200, True), "company": S(200), "email": S(200), "phone": S(50),
                "billing_address": T(500), "prefer": E("email", "text"), "tags": S(200), "notes": T(2000),
                "created": D(True), "archived": B()},
    "properties": {"id": ID, "client_id": R("clients"), "label": S(100), "street": S(200), "city": S(100),
                   "state": S(50), "zip": S(20), "lat_e6": {"t": "coord", "axis": "lat"},
                   "lon_e6": {"t": "coord", "axis": "lon"}, "access_notes": T(2000)},
    "crew": {"id": ID, "name": S(200, True), "role": S(60), "phone": S(50), "email": S(200),
             "cost_rate": M(0, 10_000_000), "bill_rate": M(0, 10_000_000), "weekly_minutes": I(0, 10080, 2400),
             "active": B(True)},
    "items": {"id": ID, "name": S(200, True), "description": T(1000), "kind": E(*LINE_KINDS), "unit": S(20),
              "rate": M(), "cost": M(), "taxable": B(), "archived": B()},
    "requests": {"id": ID, "client_id": R("clients"), "property_id": R("properties", True), "date": D(),
                 "title": S(200, True), "details": T(4000), "source": S(60),
                 "status": E("new", "assessment", "converted", "archived"), "assessment_date": D(True),
                 "assessment_time": TM(), "assessment_crew_ids": RS("crew"), "quote_id": R("quotes", True),
                 "job_id": R("jobs", True)},
    "quotes": dict({"id": ID, "number": S(30), "client_id": R("clients"), "property_id": R("properties", True),
                    "request_id": R("requests", True), "date": D(), "valid_until": D(True), "title": S(200),
                    "status": E("draft", "sent", "changes_requested", "approved", "converted", "archived"),
                    "lines": L("line", 200), "deposit": M(), "message": T(2000), "notes": T(2000),
                    "sent_date": D(True), "approved_date": D(True), "approved_by": S(200), "change_request": T(2000),
                    "job_id": R("jobs", True)}, **DISC),
    "jobs": dict({"id": ID, "number": S(30), "client_id": R("clients"), "property_id": R("properties", True),
                  "quote_id": R("quotes", True), "title": S(200, True), "instructions": T(4000),
                  "kind": E("one_off", "recurring"), "rule": {"t": "obj", "of": "rule"}, "start_date": D(True),
                  "end_date": D(True), "visit_limit": I(0, 1000), "start_time": TM(), "duration_min": I(0, 1440, 60),
                  "crew_ids": RS("crew"), "lines": L("line", 200), "billing": E("per_visit", "fixed"),
                  "invoice_timing": E("on_completion", "after_visit", "monthly"), "checklist": L("check", 100),
                  "status": E("active", "closed", "archived"), "closed_date": D(True), "notes": T(2000)}, **DISC),
    "visits": {"id": ID, "job_id": R("jobs"), "date": D(), "start_time": TM(), "duration_min": I(0, 1440, 60),
               "crew_ids": RS("crew"), "status": E("scheduled", "in_progress", "completed", "cancelled"),
               "occurrence": D(True), "started_at": ST(), "finished_at": ST(), "checklist": L("check", 100),
               "notes": T(4000), "invoice_id": R("invoices", True), "route_seq": I(0, 999)},
    "timesheets": {"id": ID, "crew_id": R("crew"), "date": D(), "start_time": TM(), "minutes": I(0, 1440),
                   "kind": E("job", "travel", "shop", "other"), "job_id": R("jobs", True), "visit_id": R("visits", True),
                   "source": E("manual", "visit", "packet"), "note": S(500), "approved": B()},
    "expenses": {"id": ID, "job_id": R("jobs"), "visit_id": R("visits", True), "date": D(), "description": S(200, True),
                 "kind": E("material", "equipment", "subcontract", "permit", "other"), "vendor": S(200),
                 "qty_milli": I(0, 1_000_000_000, 1000), "unit_cost": M()},
    "photos": {"id": ID, "job_id": R("jobs"), "visit_id": R("visits", True), "crew_id": R("crew", True),
               "name": S(200, True), "mime": E("image/jpeg", "image/png", "image/webp", "image/heic"),
               "size": I(0, 25 * 1024 * 1024), "taken_at": ST(), "caption": S(500)},
    "invoices": dict({"id": ID, "number": S(30), "client_id": R("clients"), "property_id": R("properties", True),
                      "job_id": R("jobs", True), "visit_ids": RS("visits", 400), "date": D(), "due_date": D(),
                      "subject": S(200), "status": E("draft", "sent", "void"), "lines": L("line", 400),
                      "message": T(2000), "sent_date": D(True), "period": S(7)}, **DISC),
    "payments": {"id": ID, "client_id": R("clients"), "invoice_id": R("invoices", True), "quote_id": R("quotes", True),
                 "date": D(), "amount": M(1), "method": E("card", "cash", "check", "ach", "link", "other"),
                 "reference": S(100), "note": S(500)},
    "reminders": {"id": ID, "kind": E("visit", "invoice_overdue", "quote_followup", "custom"), "ref_id": S(40),
                  "step": I(0, 365), "due_date": D(), "channel": E("email", "text"), "to": S(200), "subject": S(200),
                  "body": T(4000), "status": E("queued", "sent", "dismissed"), "created": D(), "why": S(300)},
    "log": {"id": ID, "at": ST(), "rule": S(40, True), "why": S(500), "keys": {"t": "strs", "len": 120, "max": 5000},
            "changes": {"t": "changes"}, "undone": B()},
}

LABELS = {"clients": "client", "properties": "property", "crew": "crew member", "items": "product or service",
          "requests": "request", "quotes": "quote", "jobs": "job", "visits": "visit", "timesheets": "time entry",
          "expenses": "expense", "photos": "photo", "invoices": "invoice", "payments": "payment",
          "reminders": "reminder"}


def _default(f):
    t = f["t"]
    if t in ("str", "text", "date", "time", "stamp", "ref"):
        return ""
    if t == "int":
        return f["d"]
    if t == "cents":
        return 0 if f["lo"] <= 0 else f["lo"]
    if t == "bool":
        return f["d"]
    if t == "enum":
        return f["v"][0]
    if t == "coord" or t == "obj":
        return None
    if t == "ints":
        return list(f.get("d", []))
    return []


def _int_field(v, lo, hi, p, what="a whole number"):
    if not is_int(v) or v < lo or v > hi:
        fail("bad_field", f"{p}: must be {what} from {lo} to {hi}.")
    return int(v)


def check_field(f, v, p):
    t = f["t"]
    if t == "id":
        if not isinstance(v, str) or not ID_RE.fullmatch(v):
            fail("bad_field", f"{p}: must be an id of 1 to 40 letters, digits, - or _.")
        return v
    if t in ("str", "text"):
        s = clean_text(v, f["max"], p, t == "text")
        if f.get("req") and s == "":
            fail("bad_field", f"{p}: is required.")
        return s
    if t == "int":
        return _int_field(v, f["lo"], f["hi"], p)
    if t == "cents":
        return _int_field(v, f["lo"], f["hi"], p, "a whole number of cents")
    if t == "bool":
        if not isinstance(v, bool):
            fail("bad_field", f"{p}: must be true or false.")
        return v
    if t == "enum":
        if v not in f["v"]:
            fail("bad_field", f"{p}: must be one of {', '.join(f['v'])}.")
        return v
    if t == "date":
        if v == "" and f["opt"]:
            return ""
        parse_date(v, p)
        return v
    if t == "time":
        if v == "":
            return ""
        parse_time(v, p)
        return v
    if t == "stamp":
        if v == "":
            return ""
        parse_stamp(v, p)
        return v
    if t == "coord":
        if v is None:
            return None
        lim = COORD[f["axis"]]
        return _int_field(v, -lim, lim, p, "a whole number of millionths of a degree")
    if t == "ref":
        if v == "" and f["opt"]:
            return ""
        if not isinstance(v, str) or not ID_RE.fullmatch(v):
            fail("bad_field", f"{p}: must name a {LABELS[f['k']]}.")
        return v
    if t == "refs":
        if not isinstance(v, list) or len(v) > f["max"]:
            fail("bad_field", f"{p}: must be a list of at most {f['max']} ids.")
        out = []
        for i, x in enumerate(v):
            if not isinstance(x, str) or not ID_RE.fullmatch(x):
                fail("bad_field", f"{p}[{i}]: must name a {LABELS[f['k']]}.")
            if x in out:
                fail("bad_field", f"{p}: {x} is listed twice.")
            out.append(x)
        return out
    if t == "ints":
        if not isinstance(v, list) or len(v) > f["max"]:
            fail("bad_field", f"{p}: must be a list of at most {f['max']} numbers.")
        out = sorted(set(_int_field(x, f["lo"], f["hi"], f"{p}[{i}]") for i, x in enumerate(v)))
        return out
    if t == "strs":
        if not isinstance(v, list) or len(v) > f["max"]:
            fail("bad_field", f"{p}: must be a list of at most {f['max']} entries.")
        out = []
        for i, x in enumerate(v):
            if not isinstance(x, str):
                fail("bad_field", f"{p}[{i}]: must be text.")
            out.append(clean_text(x, f["len"], f"{p}[{i}]"))
        return out
    if t == "dates":
        if not isinstance(v, list) or len(v) > f["max"]:
            fail("bad_field", f"{p}: must be a list of at most {f['max']} dates.")
        for i, x in enumerate(v):
            parse_date(x, f"{p}[{i}]")
        return sorted(set(v))
    if t == "list":
        if not isinstance(v, list) or len(v) > f["max"]:
            fail("bad_field", f"{p}: must be a list of at most {f['max']} entries.")
        out = [check_record(f["of"], x, f"{p}[{i}]") for i, x in enumerate(v)]
        if out and "id" in FIELD_TABLES[f["of"]]:
            seen = set()
            for x in out:
                if x["id"] in seen:
                    fail("bad_field", f"{p}: the id {x['id']} is used twice.")
                seen.add(x["id"])
        return out
    if t == "obj":
        if v is None:
            return None
        return check_record(f["of"], v, p)
    if t == "changes":
        return _check_changes(v, p)
    fail("bad_field_type", f"{p}: unknown field type {t}.")


def check_record(kind: str, rec, path: str) -> dict:
    """A validated, normalised copy of one record. Missing fields take their defaults;
    unknown fields are refused."""
    tbl = FIELD_TABLES[kind]
    if not isinstance(rec, dict):
        fail("bad_field", f"{path}: must be an object.")
    for k in sorted(rec.keys()):
        if k not in tbl:
            fail("bad_field", f"{path}: unknown field {k[:40]}.")
    out = {}
    for k, f in tbl.items():
        v = rec[k] if k in rec else _default(f)
        if f["t"] in ("id",) and k not in rec:
            fail("bad_field", f"{path}.{k}: is required.")
        out[k] = check_field(f, v, f"{path}.{k}")
    _semantic(kind, out, path)
    return out


def _semantic(kind, r, path):
    if kind == "rule":
        if r["freq"] == "weekly" and not r["days"]:
            fail("bad_rule", f"{path}: a weekly schedule needs at least one day of the week.")
        if r["month_day"] == 0:
            fail("bad_rule", f"{path}.month_day: must be 1 to 31, or -1 for the last day.")
        if r["nth"] == 0:
            fail("bad_rule", f"{path}.nth: must be 1 to 4, or -1 for the last one.")
    elif kind == "jobs":
        if r["kind"] == "recurring":
            if r["rule"] is None:
                fail("bad_job", f"{path}: a recurring job needs a schedule.")
            if r["start_date"] == "":
                fail("bad_job", f"{path}: a recurring job needs a start date.")
        if r["start_date"] and r["end_date"] and r["end_date"] < r["start_date"]:
            fail("bad_job", f"{path}: the end date is before the start date.")
    elif kind == "invoices":
        if r["due_date"] < r["date"]:
            fail("bad_field", f"{path}.due_date: is before the invoice date.")
    elif kind == "visits":
        if r["started_at"] and r["finished_at"]:
            if parse_stamp(r["finished_at"]) < parse_stamp(r["started_at"]):
                fail("bad_field", f"{path}.finished_at: is before the start.")
    if kind in ("quotes", "jobs", "invoices") and r["discount_kind"] == "pct" and r["discount_value"] > 10000:
        fail("bad_field", f"{path}.discount_value: a percent discount is at most 100.00 (10000).")
    if kind in ("quotes", "jobs", "invoices"):
        for i, ln in enumerate(r["lines"]):
            if mul_div(ln["qty_milli"], ln["rate"], 1000) > MAX_CENTS:
                fail("too_large", f"{path}.lines[{i}]: the amount is over $10,000,000.00. Split it into smaller lines.")


def _check_changes(v, p):
    """Automation log changes: [{kind, id, before, after}] where before or after is a record
    of that kind or null (null before means the change created it)."""
    if not isinstance(v, list) or len(v) > 5000:
        fail("bad_field", f"{p}: must be a list of at most 5000 changes.")
    out = []
    for i, c in enumerate(v):
        q = f"{p}[{i}]"
        if not isinstance(c, dict) or sorted(c.keys()) != ["after", "before", "id", "kind"]:
            fail("bad_field", f"{q}: must have kind, id, before and after.")
        if c["kind"] not in KINDS:
            fail("bad_field", f"{q}.kind: must be one of {', '.join(KINDS)}.")
        check_field(ID, c["id"], q + ".id")
        b = None if c["before"] is None else check_record(c["kind"], c["before"], q + ".before")
        a = None if c["after"] is None else check_record(c["kind"], c["after"], q + ".after")
        if a is None and b is None:
            fail("bad_field", f"{q}: before and after cannot both be empty.")
        out.append({"kind": c["kind"], "id": c["id"], "before": b, "after": a})
    return out


# ---------------------------------------------------------------- the book

BOOK_KEYS = ("id", "name", "example", "created", "seq", "settings") + KINDS + ("log",)


def blank_settings(name: str = "") -> dict:
    s = check_record("settings", {}, "settings")
    s["business_name"] = name
    s["quote_prefix"] = "Q-"
    s["job_prefix"] = "J-"
    s["invoice_prefix"] = "INV-"
    s["day_start"] = "07:00"
    s["day_end"] = "17:00"
    return s


def blank_book(bid: str, name: str, created: str) -> dict:
    parse_date(created, "created")
    b = {"id": bid, "name": clean_text(name, 200, "name"), "example": False, "created": created, "seq": 1,
         "settings": blank_settings(clean_text(name, 200, "name"))}
    for k in KINDS:
        b[k] = []
    b["log"] = []
    return b


def index(book: dict) -> dict:
    """{kind: {id: record}} for every kind."""
    return {k: {r["id"]: r for r in book[k]} for k in KINDS}


def validate_book(book) -> dict:
    """A validated copy of a whole book: every record, unique ids, references."""
    if not isinstance(book, dict):
        fail("bad_backup", "book: must be an object.")
    for k in sorted(book.keys()):
        if k not in BOOK_KEYS:
            fail("bad_backup", f"book: unknown field {k[:40]}.")
    out = {"id": check_field(ID, book.get("id"), "book.id"),
           "name": clean_text(book.get("name", ""), 200, "book.name"),
           "example": check_field(B(), book.get("example", False), "book.example"),
           "created": check_field(D(), book.get("created", ""), "book.created"),
           "seq": check_field(I(1, 999_999_999), book.get("seq", 1), "book.seq"),
           "settings": check_record("settings", book.get("settings", {}), "settings")}
    for k in KINDS + ("log",):
        v = book.get(k, [])
        if not isinstance(v, list) or len(v) > MAX_RECORDS:
            fail("bad_backup", f"{k}: must be a list of at most {MAX_RECORDS} records.")
        out[k] = [check_record(k, r, f"{k}[{i}]") for i, r in enumerate(v)]
    validate_refs(out)
    return out


def _ids(book):
    seen = {}
    for k in KINDS:
        for r in book[k]:
            if r["id"] in seen:
                fail("duplicate_id", f"{k}: the id {r['id']} is already used by a {LABELS[seen[r['id']]]}.")
            seen[r["id"]] = k
    return seen


def validate_refs(book: dict) -> None:
    """Every reference resolves to a record of the right kind, and linked records agree."""
    _ids(book)
    ix = index(book)
    for k in KINDS:
        for r in book[k]:
            check_record_refs(ix, k, r)


def _need(ix, kind, ref, path):
    if ref and ref not in ix[kind]:
        fail("bad_ref", f"{path}: there is no {LABELS[kind]} {ref}.")


def check_record_refs(ix, kind: str, r: dict) -> None:
    path = f"{kind} {r['id']}"
    tbl = FIELD_TABLES[kind]
    for k, f in tbl.items():
        if f["t"] == "ref":
            _need(ix, f["k"], r[k], f"{path}.{k}")
        elif f["t"] == "refs":
            for x in r[k]:
                _need(ix, f["k"], x, f"{path}.{k}")
        elif f["t"] == "list" and f["of"] == "line":
            for i, ln in enumerate(r[k]):
                _need(ix, "items", ln["item_id"], f"{path}.{k}[{i}].item_id")
    pid = r.get("property_id", "")
    if pid and "client_id" in r and ix["properties"][pid]["client_id"] != r["client_id"]:
        fail("bad_ref", f"{path}: property {pid} belongs to another client.")
    if kind == "invoices":
        if r["job_id"] and ix["jobs"][r["job_id"]]["client_id"] != r["client_id"]:
            fail("bad_ref", f"{path}: job {r['job_id']} belongs to another client.")
        for v in r["visit_ids"]:
            if r["job_id"] and ix["visits"][v]["job_id"] != r["job_id"]:
                fail("bad_ref", f"{path}: visit {v} is not on job {r['job_id']}.")
    if kind == "payments":
        if r["invoice_id"] and ix["invoices"][r["invoice_id"]]["client_id"] != r["client_id"]:
            fail("bad_ref", f"{path}: invoice {r['invoice_id']} belongs to another client.")
        if r["quote_id"] and ix["quotes"][r["quote_id"]]["client_id"] != r["client_id"]:
            fail("bad_ref", f"{path}: quote {r['quote_id']} belongs to another client.")
    if kind == "jobs" and r["quote_id"] and ix["quotes"][r["quote_id"]]["client_id"] != r["client_id"]:
        fail("bad_ref", f"{path}: quote {r['quote_id']} belongs to another client.")
    if kind in ("timesheets", "expenses", "photos") and r.get("visit_id") and r.get("job_id"):
        if ix["visits"][r["visit_id"]]["job_id"] != r["job_id"]:
            fail("bad_ref", f"{path}: visit {r['visit_id']} is not on job {r['job_id']}.")


# Which kinds point at a kind (for delete checks): [(kind, field, is_list)]
def referrers(kind: str) -> list:
    out = []
    for k in KINDS:
        for fname, f in FIELD_TABLES[k].items():
            if f["t"] in ("ref", "refs") and f["k"] == kind:
                out.append([k, fname, f["t"] == "refs"])
    return out


# ---------------------------------------------------------------- backup

def export_backup(book: dict, exported_at: str) -> dict:
    return {"format": BACKUP_FORMAT, "version": BACKUP_VERSION, "app": PRODUCT_NAME, "exported_at": exported_at,
            "book": book}


def _reject_constant(name):
    fail("bad_json", "The file is not valid JSON.")


def parse_json(text):
    if not isinstance(text, str):
        fail("bad_file", "The file could not be read as text.")
    if len(text) > MAX_BACKUP_CHARS:
        fail("too_large", "The file is larger than 64 MB.")
    try:
        return json.loads(text, parse_constant=_reject_constant)
    except ServiceError:
        raise
    except (ValueError, RecursionError):
        fail("bad_json", "The file is not valid JSON.")


def import_backup(obj) -> dict:
    """A validated book from a backup object. Nothing on the device changes unless this
    returns."""
    if not isinstance(obj, dict) or obj.get("format") != BACKUP_FORMAT:
        fail("bad_backup", "This is not a backup file from this program.")
    v = obj.get("version")
    if not is_int(v) or v < 1:
        fail("bad_backup", "The backup has no valid version number.")
    if v > BACKUP_VERSION:
        fail("newer_backup", f"This backup was made by a newer version (format {v}). Update the program first.")
    for k in sorted(obj.keys()):
        if k not in ("format", "version", "app", "exported_at", "book"):
            fail("bad_backup", f"backup: unknown field {k[:40]}.")
    return validate_book(obj.get("book"))
