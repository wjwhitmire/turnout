"""Write tests/vectors.json (reference results from the Python library) and
web/src/core/90_example_data.js (the example business for the browser).

web/parity.test.mjs replays every case against the JavaScript core and requires the same
result: same keys, same numbers, same text, and for refused calls the same error code and
message. Large results are compared by the SHA-256 of their canonical JSON.

Usage: python tests/make_vectors.py           write both files
       python tests/make_vectors.py --check   exit 1 if either file is out of date
"""

import copy
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from fieldservice import automation, export, imports, messages, money, packet, paylinks, qr, reports  # noqa: E402
from fieldservice import schedule, schema, util, workflow  # noqa: E402
from fieldservice.book import apply, update_settings  # noqa: E402
from fieldservice.brand import (BACKUP_FORMAT, BACKUP_VERSION, PACKET_FORMAT, PACKET_VERSION, PRODUCT_NAME,  # noqa: E402
                                SUITE_NUMBER)
from fieldservice.example import TODAY, build_example  # noqa: E402

sys.path.insert(0, str(ROOT / "tests"))
from helpers import base_book, line  # noqa: E402

AT = "2026-10-22T06:00:00-05:00"


def canon(x) -> str:
    return json.dumps(x, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha(x) -> str:
    return hashlib.sha256(canon(x).encode("utf-8")).hexdigest()


class Fx:
    def __init__(self, name):
        self.name = name


class Prev:
    def __init__(self, idx, *path):
        self.idx = idx
        self.path = path


class Lcg:
    def __init__(self, s):
        self.s = s

    def n(self, k):
        self.s = (self.s * 1103515245 + 12345) % 2147483648
        return (self.s // 65536) % k


def main():
    ex = build_example()
    bb = base_book()
    fixtures = {"example": ex, "base": bb}
    cases = []

    outs = []

    def real(x):
        if isinstance(x, Fx):
            return copy.deepcopy(fixtures[x.name])
        if isinstance(x, Prev):
            v = outs[x.idx]
            for k in x.path:
                v = v[k]
            return copy.deepcopy(v)
        return copy.deepcopy(x)

    def stored(x):
        if isinstance(x, Fx):
            return {"$fx": x.name}
        if isinstance(x, Prev):
            return {"$prev": x.idx, "path": list(x.path)}
        return x

    def call(fn, *args, big=False):
        """Record one case and return [its index, its output (None when refused)]."""
        f = getattr(MODULES[fn], fn)
        c = {"fn": fn, "args": [stored(a) for a in args]}
        try:
            out = f(*[real(a) for a in args])
            out = json.loads(json.dumps(out))
            if big:
                c["sha256"] = sha(out)
            else:
                c["out"] = out
        except util.ServiceError as e:
            out = None
            c["error"] = e.code
            c["message"] = e.message
        cases.append(c)
        outs.append(out)
        return out

    def last():
        return len(cases) - 1

    # ---------------------------------------------------------------- util
    for n, d in ((5, 2), (-5, 2), (7, 3), (-7, 3), (0, 9), (10 ** 15 + 1, 2), (1, 0)):
        call("div_round", n, d)
    for a, b, d in ((1500, 1999, 1000), (10 ** 9, 10 ** 9, 1000), (-333, 25, 100), (123456789, 987654321, 100000)):
        call("mul_div", a, b, d)
    for amt, w in ((100, [1, 1, 1]), (-100, [1, 1, 1]), (997, [5, 7, 11, 13]), (0, [0, 0]), (5, [1, -1]),
                   (10 ** 9, [10 ** 9, 3, 7]), (7, [-1, -2])):
        call("allocate", amt, w)
    for s, n in (("2024-02-28", 1), ("2023-02-28", 1), ("2100-02-28", 1), ("2026-12-31", 1), ("2026-03-01", -1),
                 ("2026-02-30", 1), ("1900-01-01", -1)):
        call("add_days", s, n)
    for s, n in (("2026-01-31", 1), ("2028-01-31", 1), ("2026-12-15", 1), ("2026-03-31", -1), ("2026-05-31", -15)):
        call("add_months", s, n)
    for s in ("2026-10-22", "2026-11-01", "2000-02-29", "2100-03-01", "1900-01-01"):
        call("weekday", s)
        call("week_start", s)
    for t in ("00:00", "24:00", "13:05", "24:01", "7:00", "07:60", "", None, 5):
        call("parse_time", t)
    for st in ("2026-11-01T01:30:00-05:00", "2026-11-01T01:15:00-06:00", "1970-01-01T00:00:00Z",
               "2026-10-05T08:00", "2026-10-05T25:00:00Z", "2026-10-05T08:00:00+15:00", "2026-02-29T00:00:00Z"):
        call("parse_stamp", st)
    for a, b in (("2026-11-01T01:30:00-05:00", "2026-11-01T01:15:00-06:00"),
                 ("2027-03-14T01:50:00-06:00", "2027-03-14T03:10:00-05:00"),
                 ("2026-10-05T08:00:00Z", "2026-10-05T07:59:30Z"), ("2026-10-05T08:00:00Z", "2026-10-05T07:58:30Z")):
        call("elapsed_minutes", a, b)
    call("stamp_local", "2026-10-05T08:07:00-05:00")
    for c in (0, 5, -5, 123456789, -100000000000):
        call("cents_text", c)
        call("money", c)
    for q in (0, 1500, 2000, 333, -1250, 1000000000):
        call("milli_text", q)
    for bp in (1234, -50, 0, 10000):
        call("pct_text", bp)
    for s in ("$1,234.5", "-12", ".5", "1.234", "abc", "", "10000000.01", "10000000.00", None, "-$3.07", "1e5"):
        call("parse_money", s)
    for s in ("1.25", ".5", "1.2345", "12", "x", "1,000.5"):
        call("parse_milli", s)
    for s, n, ml in (("  a\u0000b\tc  ", 10, False), ("a\r\nb", 10, True), ("a\nb", 10, False), ("x" * 11, 10, False),
                     (5, 10, False), ("\U0001F600" * 3, 3, False), ("\U0001F600" * 4, 3, False),
                     ("  trim ﻿", 10, False)):
        call("clean_text", s, n, "field", ml)
    call("to_csv", [["=SUM(A1)", "+1", "-x", "@cmd", "\tq", "plain", {"$": -1234}, 5, True, None, 'a,"b"', "c\nd"]])
    call("to_csv", [["\uff1dSUM(A1)", "\uff0b1", "\uff0dx", "\uff20cmd", "  =1+1", "\u00a0@x", "\u3000\uff1d1",
                     " plain", "a=b", "\u2212 5"]])
    for t in ("a\tb\n1\t2\n\n", 'a,"multi\nline",c\n', 'a,"never closed\n', "﻿name\nA\n", "a;b;c\r\n1;2;3",
              'x,"q""uote"\r\n', "  , \n,,\n"):
        call("parse_csv", t)
    call("esc_html", "<a href=\"x\">'&'</a>")

    # ---------------------------------------------------------------- schema
    good = {"id": "c9", "name": " Ann ", "email": "a@example.com"}
    hostile = [
        ("clients", good), ("clients", {"id": "c9", "name": ""}), ("clients", {"id": "c9", "name": "x", "evil": 1}),
        ("clients", {"id": "bad id", "name": "x"}), ("clients", {"name": "x"}), ("clients", "nope"),
        ("clients", {"id": "c9", "name": "x", "prefer": "fax"}), ("clients", {"id": "c9", "name": "x", "archived": 1}),
        ("crew", {"id": "m9", "name": "x", "cost_rate": 1.5}), ("crew", {"id": "m9", "name": "x", "weekly_minutes": 10081}),
        ("properties", {"id": "p9", "client_id": "c1", "lat_e6": 90000001}),
        ("properties", {"id": "p9", "client_id": "c1", "lat_e6": 30.5}),
        ("visits", {"id": "v9", "job_id": "j1", "date": "2026-10-05", "start_time": "08:00",
                    "started_at": "2026-10-05T09:00:00-05:00", "finished_at": "2026-10-05T08:00:00-05:00"}),
        ("visits", {"id": "v9", "job_id": "j1", "date": "2026-10-05", "crew_ids": ["m1", "m1"]}),
        ("jobs", {"id": "j9", "client_id": "c1", "title": "t", "kind": "recurring"}),
        ("jobs", {"id": "j9", "client_id": "c1", "title": "t", "kind": "recurring", "start_date": "2026-01-01",
                  "rule": {"freq": "weekly", "days": [7, 1, 1]}}),
        ("jobs", {"id": "j9", "client_id": "c1", "title": "t", "start_date": "2026-02-01", "end_date": "2026-01-01"}),
        ("quotes", {"id": "q9", "client_id": "c1", "date": "2026-01-01", "lines": [{"id": "a", "name": "n"},
                                                                                   {"id": "a", "name": "m"}]}),
        ("quotes", {"id": "q9", "client_id": "c1", "date": "2026-01-01", "discount_value": 10001}),
        ("invoices", {"id": "n9", "client_id": "c1", "date": "2026-02-01", "due_date": "2026-01-01"}),
        ("rule", {"freq": "monthly", "month_day": 0}), ("rule", {"freq": "monthly", "month_mode": "nth", "nth": 0}),
        ("settings", {"overdue_steps": [30, 1, 7, 7]}), ("settings", {"overdue_steps": [0]}),
        ("payments", {"id": "y9", "client_id": "c1", "date": "2026-01-01", "amount": 0}),
        ("reminders", {"id": "w9", "due_date": "2026-01-01", "created": "2026-01-01", "body": "a\r\nb"}),
        ("photos", {"id": "f9", "job_id": "j1", "name": "x", "mime": "image/svg+xml"}),
    ]
    for kind, rec in hostile:
        call("check_record", kind, rec, kind)
    call("validate_book", Fx("example"), big=True)
    bad = copy.deepcopy(bb)
    bad["clients"][0]["name"] = "<b>" * 100
    call("validate_book", bad)
    bad2 = copy.deepcopy(bb)
    bad2["properties"][0]["client_id"] = "ghost"
    call("validate_book", bad2)
    call("import_backup", schema.export_backup(bb, AT))
    call("import_backup", {"format": "field-tools-17-service", "version": 2, "book": bb})
    call("import_backup", {"format": "nope"})
    call("parse_json", '{"a": [1, 2, {"b": "c"}]}')
    call("parse_json", '{"a": NaN}')
    call("parse_json", "[1,")

    # ---------------------------------------------------------------- book changes
    EXF, BB = Fx("example"), Fx("base")
    call("apply", BB, {"action": "create", "kind": "clients", "record": {"name": "New"}})
    call("apply", BB, {"action": "delete", "kind": "clients", "id": "c1"})
    call("apply", BB, {"action": "update", "kind": "clients", "record": {"id": "zz", "name": "x"}})
    call("apply", BB, {"action": "boom", "kind": "clients"})
    call("apply", BB, {"action": "create", "kind": "nope", "record": {}})
    call("apply", BB, {"action": "create", "kind": "jobs", "record": {"client_id": "c2", "property_id": "p1",
                                                                      "title": "x"}})
    call("update_settings", BB, {"tax_rate_milli": 7000, "payment_links": [{"kind": "zelle", "value": "x"}]})
    call("update_settings", BB, {"nope": 1})

    # ---------------------------------------------------------------- money
    r = Lcg(7)
    for k in range(40):
        n = 1 + r.n(6)
        lines = []
        for i in range(n):
            lines.append(schema.check_record("line", {"id": f"l{i}", "name": f"L{i}", "qty_milli": r.n(20000),
                                                      "rate": r.n(500000), "cost": r.n(200000),
                                                      "taxable": r.n(2) == 1, "optional": r.n(4) == 0,
                                                      "selected": r.n(2) == 1}, "line"))
        doc = schema.check_record("quotes", {"id": "q", "client_id": "c1", "date": "2026-01-01", "lines": lines,
                                             "discount_kind": "pct" if r.n(2) else "amt",
                                             "discount_value": r.n(10001), "tax_rate_milli": r.n(12001),
                                             "tax_mode": "line" if r.n(2) else "document"}, "q")
        call("doc_totals", doc)
    for i, inv in enumerate(ex["invoices"][:12]):
        for today in ("2026-08-15", TODAY):
            call("invoice_state", EXF, inv, today)
    for q in ex["quotes"]:
        call("quote_state", EXF, q)
    for c in ex["clients"]:
        call("client_balance", EXF, c["id"], TODAY)

    # ---------------------------------------------------------------- schedule
    r = Lcg(11)
    for k in range(120):
        f = ["weekly", "monthly", "daily"][r.n(3)]
        rule = {"freq": f, "interval": 1 + r.n(4) if f != "daily" else 1 + r.n(30)}
        if f == "weekly":
            rule["days"] = sorted(set(1 + r.n(7) for _ in range(1 + r.n(3))))
        if f == "monthly":
            if r.n(2):
                rule["month_mode"] = "day"
                rule["month_day"] = [-1, 1, 15, 28, 29, 30, 31][r.n(7)]
            else:
                rule["month_mode"] = "nth"
                rule["nth"] = [-1, 1, 2, 3, 4][r.n(5)]
                rule["weekday"] = 1 + r.n(7)
        start = util.add_days("2023-11-20", r.n(1200))
        if r.n(3) == 0:
            rule["exceptions"] = [util.add_days(start, 7 * r.n(10)), util.add_days(start, r.n(60))]
        rule = schema.check_record("rule", rule, "rule")
        frm = util.add_days(start, r.n(200) - 30)
        to = util.add_days(frm, r.n(500))
        end = util.add_days(start, r.n(600)) if r.n(3) == 0 else ""
        limit = r.n(20) if r.n(3) == 0 else 0
        call("occurrences", rule, start, frm, to, end, limit)
        call("describe_rule", rule)
    call("occurrences", schema.check_record("rule", {"freq": "daily"}, "r"), "1900-01-01", "1900-01-01", "2026-01-01")
    for y, m, nth, wd in ((2026, 10, 2, 2), (2026, 10, -1, 5), (2026, 2, 4, 6), (2024, 2, -1, 4), (2100, 2, -1, 7)):
        call("nth_weekday", y, m, nth, wd)
    call("find_conflicts", EXF, "2026-07-01", "2026-12-31")
    for a, b in (([30000000, -95000000], [31000000, -95000000]), ([30000000, -95000000], [30000000, -94000000]),
                 ([30318200, -95471500], [30296400, -95452200]), ([-33865000, 151209000], [-33870000, 151200000]),
                 ([0, 0], [0, 0])):
        call("distance_m", a, b)
    r = Lcg(5)
    for k in range(25):
        stops = []
        for i in range(r.n(9)):
            if r.n(8) == 0:
                stops.append({"id": f"s{i}", "lat_e6": None, "lon_e6": None})
            else:
                stops.append({"id": f"s{i}", "lat_e6": 30000000 + r.n(200000), "lon_e6": -95000000 - r.n(200000)})
        start = [30100000, -95100000] if r.n(2) else None
        call("route_order", stops, start)
    for d in ("2026-10-26", "2026-10-27", "2026-10-22", "2026-11-02"):
        for m in ("m-dana", "m-jordan"):
            call("suggest_route", EXF, m, d)

    # ---------------------------------------------------------------- workflow chain on the base book
    fixtures["flow0"] = apply(bb, {"action": "create", "kind": "requests", "record": {
        "id": "r1", "client_id": "c1", "property_id": "p1", "date": "2026-10-01", "title": "Fix sprinkler"}})
    cur = Fx("flow0")

    def step(name, *args):
        nonlocal cur
        out = call("do", cur, name, list(args))
        if out is not None:
            cur = Prev(last(), 0)
        return out

    step("send_quote", "q8", "2026-10-01")
    q = step("quote_from_request", "r1", "2026-10-01")[1]
    step("quote_from_request", "r1", "2026-10-01")
    step("send_quote", q["id"], "2026-10-01")
    lines = [schema.check_record("line", line("l1", 10000, taxable=True), "l"),
             schema.check_record("line", line("l2", 5000, optional=True, selected=False), "l")]
    out = call("apply", cur, {"action": "update", "kind": "quotes", "record": dict(q, lines=lines, deposit=3000)})
    cur = Prev(last())
    step("send_quote", q["id"], "2026-10-01")
    step("request_changes", q["id"], "Cheaper?", "2026-10-02")
    step("approve_quote", q["id"], ["l1"], "Ann", "2026-10-03")
    step("approve_quote", q["id"], ["l2"], "Ann", "2026-10-03")
    step("record_payment", {"quote_id": q["id"], "date": "2026-10-03", "amount": 3000}, "2026-10-03")
    out = call("run_automations", cur, "2026-10-04", AT)
    cur = Prev(last(), 0)
    job = out[0]["jobs"][0]
    v = step("schedule_visit", job["id"], "2026-10-05", "08:00", 90, ["m1", "m2"])[1]
    step("start_visit", v["id"], "2026-10-05T08:05:00-05:00")
    step("finish_visit", v["id"], "2026-10-05T07:00:00-05:00")
    step("finish_visit", v["id"], "2026-10-05T09:35:00-05:00")
    step("move_visit", v["id"], "2026-10-06", "09:00", None)
    step("check_item", v["id"], "k1", True, "x")
    out = call("run_automations", cur, "2026-10-06", AT)
    cur = Prev(last(), 0)
    auto_idx = last()
    for e in out[1]:
        call("undo_automation", Prev(auto_idx, 0), e["id"])
    call("undo_automation", cur, "nope")
    inv = out[0]["invoices"][0]
    step("send_invoice", inv["id"], "2026-10-06")
    step("record_payment", {"invoice_id": inv["id"], "date": "2026-10-07", "amount": 999999}, "2026-10-07")
    step("record_payment", {"invoice_id": inv["id"], "date": "2026-10-07", "amount": 1000}, "2026-10-07")
    step("void_invoice", inv["id"])
    step("close_job", job["id"], "2026-10-07")
    step("invoice_job", job["id"], "2026-10-07", None, "")
    step("create_job", {"client_id": "c2", "title": "Weekly", "kind": "recurring", "start_date": "2026-10-01",
                        "rule": {"freq": "weekly", "days": [2, 5]}, "start_time": "07:00",
                        "lines": [line("a", 4500)], "crew_ids": ["m2"]}, "", "2026-11-15")
    call("run_automations", cur, "2026-10-20", AT)
    call("run_automations", cur, "2026-11-20", AT)
    # a step that cannot be done (a monthly line over the cap) is skipped; the other rules still run
    out = step("create_job", {"client_id": "c1", "title": "Big monthly", "kind": "recurring", "start_date": "2026-10-01",
                              "rule": {"freq": "weekly", "days": [1]}, "start_time": "08:00",
                              "lines": [line("b", 600_000_000)], "crew_ids": ["m1"], "invoice_timing": "monthly"},
               "2026-10-01", "2026-10-12")
    for bv in [x for x in out[0]["visits"] if x["job_id"] == out[1]["id"]]:
        step("start_visit", bv["id"], bv["date"] + "T08:00:00-05:00")
        step("finish_visit", bv["id"], bv["date"] + "T08:40:00-05:00")
    call("run_automations", cur, "2026-11-01", AT)
    step("create_job", {"client_id": "c1", "title": "Too big", "lines": [line("b", 1_000_000_000, qty=2000)]}, "", "")

    # ---------------------------------------------------------------- automation chain on the example
    cur = EXF
    for d in ("2026-10-23", "2026-10-24", "2026-10-26", "2026-11-01", "2026-11-03"):
        out = call("run_automations", cur, d, f"{d}T06:30:00-05:00", big=True)
        cases[-1]["whys"] = [e["why"] for e in out[1]]
        cur = Prev(last(), 0)
        nb = out[0]
    chain = last()
    for e in [x for x in nb["log"] if x["changes"]][-6:]:
        call("undo_automation", Prev(chain, 0), e["id"], big=True)
    call("undo_automation", Prev(chain, 0), nb["log"][0]["id"])
    # trimming the log keeps the reminder keys of the entries it drops
    nb_log = nb["log"]
    t1 = call("trim_log", nb_log, 5, "2026-11-03T06:30:00-05:00", big=True)
    call("trim_log", t1, 3, "2026-11-04T06:30:00-05:00", big=True)
    call("trim_log", nb_log[:4], 5, "2026-11-04T06:30:00-05:00")
    trimmed = dict(nb, log=t1)
    fixtures["trimmed"] = trimmed
    call("run_automations", Fx("trimmed"), "2026-11-03", "2026-11-03T07:00:00-05:00", big=True)
    # an archived client's recurring jobs make no new visits
    arch = dict(ex, clients=[dict(c, archived=True) if c["id"] == ex["jobs"][0]["client_id"] else c for c in ex["clients"]])
    fixtures["archived"] = arch
    call("plan_visits", Fx("archived"), ex["jobs"][0], "2026-10-22", "2026-12-31")
    call("plan_visits", EXF, ex["jobs"][0], "2026-12-01", "2026-12-31")
    call("run_automations", Fx("archived"), "2026-11-03", "2026-11-03T06:30:00-05:00", big=True)

    # ---------------------------------------------------------------- reports
    for frm, to in (("2026-07-01", "2026-10-31"), ("2026-09-15", "2026-09-15"), ("2026-10-01", "2026-12-31")):
        call("revenue_by_month", EXF, frm, to)
        call("quote_conversion", EXF, frm, to)
        call("crew_hours", EXF, frm, to)
        call("job_profitability", EXF, frm, to)
    call("job_profitability", EXF, "", "")
    for d in ("2026-08-20", "2026-09-30", TODAY, "2027-01-15"):
        call("aging", EXF, d)
        call("jobs_by_status", EXF, d)
        call("overview", EXF, d)

    # ---------------------------------------------------------------- exports
    for k in export.LIST_KINDS:
        call("list_csv", EXF, k, TODAY, big=k in ("visits", "reminders", "timesheets"))
    call("list_csv", EXF, "log", TODAY)
    for k in ("quotes", "jobs", "invoices", "visits"):
        call("lines_csv", EXF, k)
    rep = {"revenue_by_month": reports.revenue_by_month(ex, "2026-07-01", "2026-10-31"),
           "jobs_by_status": reports.jobs_by_status(ex, TODAY),
           "quote_conversion": reports.quote_conversion(ex, "2026-01-01", TODAY),
           "crew_hours": reports.crew_hours(ex, "2026-10-01", "2026-10-21"),
           "job_profitability": reports.job_profitability(ex, "", ""), "aging": reports.aging(ex, TODAY)}
    for k, v in rep.items():
        call("report_csv", k, v)
    call("report_csv", "nope", {})
    call("crossfoot_iif", EXF, "2026-07-01", TODAY)
    call("crossfoot_iif", EXF, "2026-09-01", "2026-09-30")
    call("crossfoot_customers_csv", EXF)
    for inv in ex["invoices"][::5]:
        call("client_page", EXF, "invoices", inv["id"], TODAY)
    for q in ex["quotes"]:
        call("client_page", EXF, "quotes", q["id"], TODAY)
    call("client_page", EXF, "jobs", "x", TODAY)
    call("client_page", EXF, "quotes", "missing", TODAY)
    hostile = copy.deepcopy(bb)
    hostile["clients"][0]["name"] = "<script>alert(1)</script>"
    hostile["settings"]["business_name"] = "\"><img src=x onerror=alert(1)>"
    hostile["settings"]["payment_links"] = [{"kind": "other", "label": "<b>", "value": "https://x.example/a?b=<c>&d"}]
    fixtures["hostile"] = schema.validate_book(hostile)
    out = call("do", Fx("hostile"), "create_invoice", [{"client_id": "c1", "date": "2026-10-01", "status": "sent",
                                                        "subject": "<i>x</i>", "lines": [line("a", 100, name="&amp;")]}])
    call("client_page", Prev(last(), 0), "invoices", out[1]["id"], TODAY)
    for link in ({"kind": "paypal", "label": "", "value": "@shop"}, {"kind": "venmo", "label": "V", "value": "shop-1"},
                 {"kind": "cashapp", "label": "", "value": "$shop"}, {"kind": "stripe", "label": "",
                                                                      "value": "https://buy.stripe.com/abc?x=1"},
                 {"kind": "square", "label": "", "value": "https://square.link/u/AbC"},
                 {"kind": "zelle", "label": "", "value": "pay@example.com"},
                 {"kind": "ach", "label": "", "value": "Routing 000."},
                 {"kind": "other", "label": "", "value": "https://pay.example/x"},
                 {"kind": "other", "label": "", "value": "javascript:alert(1)"},
                 {"kind": "stripe", "label": "", "value": "https://evil.example/x"},
                 {"kind": "stripe", "label": "", "value": "https://BUY.stripe.com/x"},
                 {"kind": "square", "label": "", "value": "https://square.link/u/a b"},
                 {"kind": "paypal", "label": "", "value": "a/b"}):
        call("payment_option", link, 12345, "INV 1/2 é")
    call("payment_options", ex["settings"], 5000, "INV-0001")
    for text in ("hello", "x" * 14, "x" * 15, "https://buy.stripe.com/test_example?client_reference_id=INV-0001",
                 "café ✓ \U0001F600", "A" * 300, "", "x" * 2332):
        call("qr_matrix", text, big=len(text) > 100)
    call("qr_svg", "https://venmo.com/x?txn=pay&amount=1.00&note=a", 3)
    for v in ("2026-10-06", "2028-02-29"):
        call("date_words", v)
    for v in ("", "00:05", "12:00", "13:05", "24:00"):
        call("time_words", v)
    call("hm", 65)
    call("hm", -5)

    # ---------------------------------------------------------------- packets
    pk = call("export_packet", EXF, "m-dana", TODAY, "2026-10-28", AT)
    call("export_packet", EXF, "m-dana", TODAY, "2027-01-28", AT)
    call("export_packet", EXF, "nobody", TODAY, "2026-10-28", AT)
    vid = pk["visits"][0]["id"]
    pk2 = call("crew_update", pk, vid, {"status": "completed", "started_at": "2026-10-22T07:31:00-05:00",
                                        "finished_at": "2026-10-22T08:20:00-05:00", "notes": "Gate latch broken"})
    pk2 = call("crew_update", pk2, vid, {"checklist": [dict(c, done=True) for c in pk2["visits"][0]["checklist"]]})
    call("crew_update", pk, vid, {"crew_ids": []})
    call("crew_update", pk, vid, {"status": "cancelled"})
    ret = call("return_packet", pk2, [{"id": "k1", "crew_id": "m-dana", "date": TODAY, "start_time": "07:00",
                                       "minutes": 20, "kind": "travel", "source": "packet"}],
               [{"id": "ph1", "job_id": pk2["visits"][0]["job_id"], "visit_id": vid, "name": "gate.jpg",
                 "mime": "image/jpeg", "size": 10, "data": "data:image/jpeg;base64,AAAA"}], "2026-10-22T17:00:00-05:00")
    call("merge_preview", EXF, ret)
    call("apply_packet", EXF, ret, {}, big=True)
    office = apply(ex, {"action": "update", "kind": "visits", "record": dict(
        [v for v in ex["visits"] if v["id"] == vid][0], notes="Office note")})
    fixtures["pk_office"] = office
    call("merge_preview", Fx("pk_office"), ret)
    call("apply_packet", Fx("pk_office"), ret, {})
    call("apply_packet", Fx("pk_office"), ret, {f"{vid}|notes": "crew"}, big=True)
    call("apply_packet", Fx("pk_office"), ret, {f"{vid}|notes": "office"}, big=True)
    for mut in (lambda p: p.update(kind="out"), lambda p: p["visits"][0].update(crew_ids=["m-avery"]),
                lambda p: p["photos"][0].update(data="data:text/html;base64,AA=="),
                lambda p: p["photos"][0].update(data="data:image/png;base64,AA=="),
                lambda p: p.update(evil=True), lambda p: p.update(version=2), lambda p: p.update(book_id="other"),
                lambda p: p["timesheets"][0].update(crew_id="m-avery"), lambda p: p["visits"].pop(),
                lambda p: p["visits"][0].update(status="cancelled"), lambda p: p.update(crew="x"),
                lambda p: p["visits"][0]["checklist"].pop(),
                lambda p: [v.update(job_id="j-none") for v in p["base"] + p["visits"]],
                lambda p: [v.update(crew_ids=["m-avery"]) for v in p["base"] + p["visits"]],
                lambda p: p["jobs"][0].update(client_id="c-none"),
                lambda p: p["jobs"][0].update(property_id="p-none"),
                lambda p: p["timesheets"][0].update(visit_id="v-none"),
                lambda p: p["timesheets"][0].update(job_id="j-none"),
                lambda p: p["photos"][0].update(job_id="j-none"),
                lambda p: p["photos"][0].update(crew_id="m-avery")):
        x = copy.deepcopy(ret)
        mut(x)
        call("merge_preview", EXF, x)
    moved = apply(ex, {"action": "update", "kind": "visits", "record": dict(
        [v for v in ex["visits"] if v["id"] == vid][0], crew_ids=["m-avery"])})
    fixtures["pk_moved"] = moved
    call("merge_preview", Fx("pk_moved"), ret)

    # ---------------------------------------------------------------- imports
    text = ("Client list export\n\nFirst Name,Last Name,Email,Mobile,Street 1,City,State,Zip Code,Notes,Extra\n"
            "Cara,Example,cara@example.com,(555) 010-0300,9 Elm,Town,TX,77000,=cmd(),ignored\n,,,,,,,,,\n"
            "Ann Example,,ann@example.com,,,,,,,\n,,nobody@example.com,,,,,,,\n"
            "\U0001F600" + "x" * 250 + ",,\"" + "\U0001F600" * 210 + "\",,\n")
    call("import_clients_csv", BB, text, TODAY)
    call("import_clients_csv", BB, "a,b\n1,2\n", TODAY)

    # keep only fixtures used by a case
    used = set()

    def walk(x):
        if isinstance(x, dict):
            if set(x.keys()) == {"$fx"}:
                used.add(x["$fx"])
            for v in x.values():
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)

    for c in cases:
        walk(c["args"])
    fixtures = {k: v for k, v in fixtures.items() if k in used}
    constants = {"product_name": PRODUCT_NAME, "suite_number": SUITE_NUMBER, "backup_format": BACKUP_FORMAT,
                 "backup_version": BACKUP_VERSION, "packet_format": PACKET_FORMAT, "packet_version": PACKET_VERSION,
                 "field_tables": schema.FIELD_TABLES, "kinds": list(schema.KINDS), "reports": list(reports.REPORTS),
                 "job_states": list(workflow.JOB_STATES), "example_sha256": sha(ex), "today": TODAY}
    vectors = {"constants": constants, "fixtures": fixtures, "cases": cases}
    return vectors, ex


MODULES = {}
for mod in (util, schema, money, schedule, workflow, automation, reports, export, paylinks, qr, messages, packet,
            imports):
    for name in dir(mod):
        if not name.startswith("_"):
            MODULES.setdefault(name, mod)
MODULES["apply"] = sys.modules["fieldservice.book"]
MODULES["update_settings"] = sys.modules["fieldservice.book"]


def example_js(ex) -> str:
    return ("// Generated by tests/make_vectors.py from src/fieldservice/example.py. Do not edit by hand.\n"
            "// The example business: invented names, addresses, coordinates, numbers and history.\n"
            "const EXAMPLE_BOOK = " + json.dumps(ex, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
            + ";\n")


if __name__ == "__main__":
    vec, ex = main()
    vtext = json.dumps(vec, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"
    etext = example_js(ex)
    vp = ROOT / "tests" / "vectors.json"
    ep = ROOT / "web" / "src" / "core" / "90_example_data.js"
    if "--check" in sys.argv:
        ok = vp.exists() and vp.read_text(encoding="utf-8") == vtext and ep.exists() and \
            ep.read_text(encoding="utf-8") == etext
        print("vectors and example data are current" if ok else "vectors or example data are out of date")
        sys.exit(0 if ok else 1)
    vp.write_text(vtext, encoding="utf-8")
    ep.parent.mkdir(parents=True, exist_ok=True)
    ep.write_text(etext, encoding="utf-8")
    print(f"wrote {len(vec['cases'])} cases and {len(vec['fixtures'])} fixtures; example data {len(etext):,} bytes")
