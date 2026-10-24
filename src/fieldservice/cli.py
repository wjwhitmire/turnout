"""Command line: build the example, check a backup, run reports and exports.

Reads only the files named on the command line (each capped at 64 MB) and writes only to
standard output or the --out path given.
"""

from __future__ import annotations

import argparse
import json
import sys

from .automation import run_automations
from .example import TODAY, build_example
from .export import client_page, crossfoot_customers_csv, crossfoot_iif, list_csv, report_csv, LIST_KINDS
from .packet import export_packet
from .reports import REPORTS, aging, crew_hours, job_profitability, jobs_by_status, quote_conversion, revenue_by_month
from .schedule import find_conflicts, suggest_route
from .schema import MAX_BACKUP_CHARS, export_backup, import_backup, parse_json
from .util import ServiceError


def _read(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        text = f.read(MAX_BACKUP_CHARS + 1)
    if len(text) > MAX_BACKUP_CHARS:
        raise ServiceError("too_large", f"{path} is larger than 64 MB.")
    return text


def _book(path: str) -> dict:
    return import_backup(parse_json(_read(path)))


def _out(text: str, path) -> None:
    if path:
        with open(path, "w", encoding="utf-8", newline="") as f:
            f.write(text)
    else:
        sys.stdout.write(text)


def run_report(book, name, frm, to, today):
    if name == "revenue_by_month":
        return revenue_by_month(book, frm, to)
    if name == "jobs_by_status":
        return jobs_by_status(book, today)
    if name == "quote_conversion":
        return quote_conversion(book, frm, to)
    if name == "crew_hours":
        return crew_hours(book, frm, to)
    if name == "job_profitability":
        return job_profitability(book, frm, to)
    return aging(book, today)


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="fieldservice", description="Field service office core: reports and exports.")
    sub = p.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("example", help="write the example business as a backup file")
    e.add_argument("--out")
    v = sub.add_parser("verify", help="check a backup file")
    v.add_argument("backup")
    r = sub.add_parser("report", help="run a report")
    r.add_argument("name", choices=REPORTS)
    r.add_argument("--backup", required=True)
    r.add_argument("--from", dest="frm", default="2026-01-01")
    r.add_argument("--to", default=TODAY)
    r.add_argument("--today", default=TODAY)
    r.add_argument("--csv", action="store_true")
    c = sub.add_parser("csv", help="export one list as CSV")
    c.add_argument("kind", choices=LIST_KINDS)
    c.add_argument("--backup", required=True)
    c.add_argument("--today", default=TODAY)
    c.add_argument("--out")
    x = sub.add_parser("crossfoot", help="write the Crossfoot import file (IIF) or customer list (CSV)")
    x.add_argument("--backup", required=True)
    x.add_argument("--from", dest="frm", default="2026-01-01")
    x.add_argument("--to", default=TODAY)
    x.add_argument("--customers", action="store_true")
    x.add_argument("--out")
    g = sub.add_parser("page", help="write the read-only client page for a quote or invoice")
    g.add_argument("kind", choices=("quotes", "invoices"))
    g.add_argument("id")
    g.add_argument("--backup", required=True)
    g.add_argument("--today", default=TODAY)
    g.add_argument("--out")
    k = sub.add_parser("packet", help="write a job packet for one crew member")
    k.add_argument("crew_id")
    k.add_argument("--backup", required=True)
    k.add_argument("--from", dest="frm", required=True)
    k.add_argument("--to", required=True)
    k.add_argument("--at", required=True, help="time stamp, like 2026-10-22T06:00:00-05:00")
    k.add_argument("--out")
    a = sub.add_parser("automate", help="run the automation rules and print what they did")
    a.add_argument("--backup", required=True)
    a.add_argument("--today", required=True)
    a.add_argument("--at", required=True)
    a.add_argument("--out", help="write the updated backup here")
    s = sub.add_parser("schedule", help="conflicts in a date range, or a suggested route for one crew day")
    s.add_argument("--backup", required=True)
    s.add_argument("--from", dest="frm", required=True)
    s.add_argument("--to", required=True)
    s.add_argument("--crew")
    args = p.parse_args(argv)
    try:
        if args.cmd == "example":
            _out(json.dumps(export_backup(build_example(), TODAY + "T00:00:00Z"), indent=1) + "\n", args.out)
        elif args.cmd == "verify":
            b = _book(args.backup)
            print(f"ok: {b['name']}: " + ", ".join(f"{len(b[k])} {k}" for k in LIST_KINDS))
        elif args.cmd == "report":
            b = _book(args.backup)
            data = run_report(b, args.name, args.frm, args.to, args.today)
            _out(report_csv(args.name, data) if args.csv else json.dumps(data, indent=1) + "\n", None)
        elif args.cmd == "csv":
            _out(list_csv(_book(args.backup), args.kind, args.today), args.out)
        elif args.cmd == "crossfoot":
            b = _book(args.backup)
            _out(crossfoot_customers_csv(b) if args.customers else crossfoot_iif(b, args.frm, args.to), args.out)
        elif args.cmd == "page":
            _out(client_page(_book(args.backup), args.kind, args.id, args.today), args.out)
        elif args.cmd == "packet":
            pk = export_packet(_book(args.backup), args.crew_id, args.frm, args.to, args.at)
            _out(json.dumps(pk, indent=1) + "\n", args.out)
        elif args.cmd == "automate":
            b, entries = run_automations(_book(args.backup), args.today, args.at)
            for en in entries:
                print(f"[{en['rule']}] {en['why']}")
            if args.out:
                _out(json.dumps(export_backup(b, args.at), indent=1) + "\n", args.out)
        elif args.cmd == "schedule":
            b = _book(args.backup)
            if args.crew:
                print(json.dumps(suggest_route(b, args.crew, args.frm), indent=1))
            else:
                print(json.dumps(find_conflicts(b, args.frm, args.to), indent=1))
    except ServiceError as err:
        print(f"error: {err.message}", file=sys.stderr)
        return 2
    except OSError as err:
        print(f"error: {err.strerror}: {err.filename}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
