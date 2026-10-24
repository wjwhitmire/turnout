"""The office workflow: request, quote, job, visit, invoice, payment.

Each step is a function on a Tx (see book.py) so the automation rules can run the same
steps and log exactly what changed. The public wrappers at the bottom take a book and
return [new_book, result].
"""

from __future__ import annotations

from .book import Tx
from .money import doc_totals, included, invoice_state
from .schedule import generate_visits, new_visit
from .util import add_days, elapsed_minutes, fail, is_int, parse_date, show, stamp_local

QUOTE_OPEN = ("draft", "sent", "changes_requested")


def _doc_defaults(book: dict) -> dict:
    s = book["settings"]
    return {"tax_rate_milli": s["tax_rate_milli"], "tax_mode": s["tax_mode"], "discount_kind": "pct",
            "discount_value": 0}


def _lines_for_work(lines: list) -> list:
    """Lines a client approved: optional lines only when selected, all marked required."""
    out = []
    for ln in lines:
        if included(ln):
            out.append(dict(ln, optional=False, selected=True))
    return out


def _obj(x, what):
    if not isinstance(x, dict):
        fail("bad_field", f"{what}: must be an object.")
    return x


# ---------------------------------------------------------------- requests and quotes

def create_quote(tx: Tx, fields: dict) -> dict:
    q = dict(_doc_defaults(tx.book))
    q.update(_obj(fields, "quote"))
    if not q.get("number"):
        q["number"] = tx.next_number("quote")
    if not q.get("valid_until") and q.get("date") and tx.book["settings"]["quote_valid_days"]:
        q["valid_until"] = add_days(q["date"], tx.book["settings"]["quote_valid_days"])
    if "message" not in fields:
        q["message"] = tx.book["settings"]["quote_message"]
    return tx.create("quotes", q)


def quote_from_request(tx: Tx, request_id: str, date: str) -> dict:
    r = tx.need("requests", request_id)
    if r["status"] in ("converted", "archived"):
        fail("bad_state", "This request is already converted or archived.")
    q = create_quote(tx, {"client_id": r["client_id"], "property_id": r["property_id"], "request_id": r["id"],
                          "date": date, "title": r["title"], "notes": r["details"]})
    tx.patch("requests", r["id"], {"status": "converted", "quote_id": q["id"]})
    return q


def job_from_request(tx: Tx, request_id: str, date: str) -> dict:
    r = tx.need("requests", request_id)
    if r["status"] in ("converted", "archived"):
        fail("bad_state", "This request is already converted or archived.")
    j = create_job(tx, {"client_id": r["client_id"], "property_id": r["property_id"], "title": r["title"],
                        "instructions": r["details"], "kind": "one_off"}, "", "")
    tx.patch("requests", r["id"], {"status": "converted", "job_id": j["id"]})
    return j


def send_quote(tx: Tx, quote_id: str, date: str) -> dict:
    q = tx.need("quotes", quote_id)
    if q["status"] not in QUOTE_OPEN:
        fail("bad_state", f"Quote {q['number']} is {q['status'].replace('_', ' ')} and cannot be sent.")
    if not q["lines"]:
        fail("bad_state", f"Quote {q['number']} has no line items.")
    parse_date(date)
    return tx.patch("quotes", q["id"], {"status": "sent", "sent_date": date})


def request_changes(tx: Tx, quote_id: str, text: str, date: str) -> dict:
    q = tx.need("quotes", quote_id)
    if q["status"] != "sent":
        fail("bad_state", f"Quote {q['number']} is not waiting for a response.")
    parse_date(date)
    return tx.patch("quotes", q["id"], {"status": "changes_requested", "change_request": text})


def approve_quote(tx: Tx, quote_id: str, selected, by: str, date: str) -> dict:
    """Approve a quote. selected is the list of optional line ids the client chose, or None
    to keep the current choices."""
    q = tx.need("quotes", quote_id)
    if q["status"] not in QUOTE_OPEN:
        fail("bad_state", f"Quote {q['number']} is {q['status'].replace('_', ' ')} and cannot be approved.")
    if not q["lines"]:
        fail("bad_state", f"Quote {q['number']} has no line items.")
    parse_date(date)
    lines = q["lines"]
    if selected is not None:
        if not isinstance(selected, list):
            fail("bad_field", "selected: must be a list of line ids.")
        ids = [ln["id"] for ln in lines if ln["optional"]]
        for s in selected:
            if s not in ids:
                fail("bad_field", f"selected: {show(s)} is not an optional line on this quote.")
        lines = [dict(ln, selected=(ln["id"] in selected)) if ln["optional"] else ln for ln in lines]
    return tx.patch("quotes", q["id"], {"status": "approved", "lines": lines, "approved_date": date,
                                        "approved_by": by, "sent_date": q["sent_date"] or date})


def convert_quote(tx: Tx, quote_id: str, date: str) -> dict:
    """An approved quote becomes a one-off job with the chosen lines."""
    q = tx.need("quotes", quote_id)
    if q["status"] != "approved":
        fail("bad_state", f"Quote {q['number']} must be approved before it becomes a job.")
    parse_date(date)
    j = create_job(tx, {"client_id": q["client_id"], "property_id": q["property_id"], "quote_id": q["id"],
                        "title": q["title"] or f"Work from quote {q['number']}", "kind": "one_off",
                        "lines": _lines_for_work(q["lines"]), "discount_kind": q["discount_kind"],
                        "discount_value": q["discount_value"], "tax_rate_milli": q["tax_rate_milli"],
                        "tax_mode": q["tax_mode"], "instructions": q["notes"]}, "", "")
    tx.patch("quotes", q["id"], {"status": "converted", "job_id": j["id"]})
    if q["request_id"]:
        tx.patch("requests", q["request_id"], {"job_id": j["id"]})
    return j


# ---------------------------------------------------------------- jobs and visits

def create_job(tx: Tx, fields: dict, frm: str, through: str) -> dict:
    """A new job. A recurring job gets its visits from frm (or its start date) through the
    given date."""
    j = dict(_doc_defaults(tx.book))
    j.update(_obj(fields, "job"))
    if not j.get("number"):
        j["number"] = tx.next_number("job")
    job = tx.create("jobs", j)
    if job["kind"] == "recurring" and through:
        generate_visits(tx, job["id"], frm or job["start_date"], through)
    return job


def schedule_visit(tx: Tx, job_id: str, date: str, start_time: str, duration_min, crew_ids) -> dict:
    job = tx.need("jobs", job_id)
    if job["status"] != "active":
        fail("bad_state", f"Job {job['number']} is {job['status']}; reopen it to add visits.")
    v = new_visit(job, date)
    v["start_time"] = start_time
    if duration_min is not None:
        v["duration_min"] = duration_min
    if crew_ids is not None:
        v["crew_ids"] = crew_ids
    return tx.create("visits", v)


def move_visit(tx: Tx, visit_id: str, date: str, start_time: str, crew_ids) -> dict:
    """Reschedule or reassign a visit (the dispatch board's drag and drop)."""
    v = tx.need("visits", visit_id)
    if v["status"] in ("completed", "cancelled"):
        fail("bad_state", "A completed or cancelled visit cannot be moved. Reopen it first.")
    f = {"date": date, "start_time": start_time, "route_seq": 0}
    if crew_ids is not None:
        f["crew_ids"] = crew_ids
    return tx.patch("visits", v["id"], f)


def start_visit(tx: Tx, visit_id: str, stamp: str) -> dict:
    v = tx.need("visits", visit_id)
    if v["status"] != "scheduled":
        fail("bad_state", "Only a scheduled visit can be started.")
    stamp_local(stamp)
    return tx.patch("visits", v["id"], {"status": "in_progress", "started_at": stamp})


def finish_visit(tx: Tx, visit_id: str, stamp: str) -> dict:
    v = tx.need("visits", visit_id)
    if v["status"] not in ("scheduled", "in_progress"):
        fail("bad_state", "This visit is already completed or cancelled.")
    stamp_local(stamp)
    f = {"status": "completed", "finished_at": stamp}
    if v["started_at"] and elapsed_minutes(v["started_at"], stamp) < 0:
        fail("bad_field", "The finish time is before the start time.")
    return tx.patch("visits", v["id"], f)


def cancel_visit(tx: Tx, visit_id: str) -> dict:
    v = tx.need("visits", visit_id)
    if v["invoice_id"]:
        fail("bad_state", "This visit is on an invoice. Void the invoice first.")
    return tx.patch("visits", v["id"], {"status": "cancelled"})


def reopen_visit(tx: Tx, visit_id: str) -> dict:
    v = tx.need("visits", visit_id)
    if v["invoice_id"]:
        fail("bad_state", "This visit is on an invoice. Void the invoice first.")
    return tx.patch("visits", v["id"], {"status": "scheduled", "started_at": "", "finished_at": ""})


def check_item(tx: Tx, visit_id: str, item_id: str, done: bool, note: str) -> dict:
    v = tx.need("visits", visit_id)
    items = []
    found = False
    for c in v["checklist"]:
        if c["id"] == item_id:
            c = dict(c, done=done, note=note)
            found = True
        items.append(c)
    if not found:
        fail("not_found", f"There is no checklist item {show(item_id)} on this visit.")
    return tx.patch("visits", v["id"], {"checklist": items})


def close_job(tx: Tx, job_id: str, date: str, cancel_future: bool = True) -> dict:
    """Close a job. Unfinished visits on or after the date are cancelled."""
    j = tx.need("jobs", job_id)
    if j["status"] != "active":
        fail("bad_state", f"Job {j['number']} is already {j['status']}.")
    parse_date(date)
    if cancel_future:
        for v in list(tx.book["visits"]):
            if v["job_id"] == j["id"] and v["status"] in ("scheduled", "in_progress") and v["date"] >= date \
                    and not v["invoice_id"]:
                tx.patch("visits", v["id"], {"status": "cancelled"})
    return tx.patch("jobs", j["id"], {"status": "closed", "closed_date": date})


def reopen_job(tx: Tx, job_id: str) -> dict:
    j = tx.need("jobs", job_id)
    return tx.patch("jobs", j["id"], {"status": "active", "closed_date": ""})


def skip_visit(tx: Tx, visit_id: str) -> dict:
    """Take a recurring visit off the schedule: delete it and add its date to the job's
    skipped dates, so it is not generated again."""
    v = tx.need("visits", visit_id)
    if v["invoice_id"]:
        fail("bad_state", "This visit is on an invoice. Void the invoice first.")
    j = tx.need("jobs", v["job_id"])
    if v["occurrence"] and j["rule"]:
        rule = dict(j["rule"], exceptions=j["rule"]["exceptions"] + [v["occurrence"]])
        tx.patch("jobs", j["id"], {"rule": rule})
    tx.delete("visits", v["id"])
    return v


# ---------------------------------------------------------------- invoices and payments

def _scale_lines(lines: list, n: int) -> list:
    out = []
    for ln in lines:
        q = ln["qty_milli"] * n
        if q > 1_000_000_000:
            fail("too_large", f"Line {ln['name'][:40]}: the quantity for {n} visits is over 1,000,000.")
        out.append(dict(ln, qty_milli=q))
    return out


def create_invoice(tx: Tx, fields: dict) -> dict:
    inv = dict(_doc_defaults(tx.book))
    inv.update(_obj(fields, "invoice"))
    s = tx.book["settings"]
    if not inv.get("number"):
        inv["number"] = tx.next_number("invoice")
    if not inv.get("due_date"):
        inv["due_date"] = add_days(inv["date"], s["terms_days"])
    if "message" not in fields:
        inv["message"] = s["invoice_message"]
    return tx.create("invoices", inv)


def invoice_job(tx: Tx, job_id: str, date: str, visit_ids=None, period: str = "") -> dict:
    """Draft an invoice for a job.

    One-off job, or a recurring job billed at a fixed price: the job's lines once.
    Recurring job billed per visit: the job's lines times the number of visits billed.
    visit_ids defaults to every completed visit not yet invoiced. Deposits paid on the
    quote are applied to the job's first invoice."""
    j = tx.need("jobs", job_id)
    parse_date(date)
    if visit_ids is None:
        visit_ids = [v["id"] for v in tx.book["visits"] if v["job_id"] == j["id"] and v["status"] == "completed"
                     and not v["invoice_id"]]
    for vid in visit_ids:
        v = tx.need("visits", vid)
        if v["job_id"] != j["id"]:
            fail("bad_ref", f"Visit {vid} is not on job {j['number']}.")
        if v["invoice_id"]:
            fail("bad_state", f"Visit {vid} is already on an invoice.")
    if not j["lines"]:
        fail("bad_state", f"Job {j['number']} has no line items to invoice.")
    if j["kind"] == "recurring" and j["billing"] == "per_visit":
        if not visit_ids:
            fail("bad_state", f"Job {j['number']} has no completed visits to invoice.")
        lines = _scale_lines(j["lines"], len(visit_ids))
    else:
        lines = [dict(ln) for ln in j["lines"]]
    subject = j["title"]
    if period:
        subject = f"{j['title']} ({period})"
    elif j["kind"] == "recurring" and len(visit_ids) == 1:
        subject = f"{j['title']} ({tx.need('visits', visit_ids[0])['date']})"
    inv = create_invoice(tx, {"client_id": j["client_id"], "property_id": j["property_id"], "job_id": j["id"],
                              "visit_ids": list(visit_ids), "date": date, "subject": subject[:200], "lines": lines,
                              "discount_kind": j["discount_kind"], "discount_value": j["discount_value"],
                              "tax_rate_milli": j["tax_rate_milli"], "tax_mode": j["tax_mode"], "period": period})
    for vid in visit_ids:
        tx.patch("visits", vid, {"invoice_id": inv["id"]})
    if j["quote_id"]:
        first = not any(x["job_id"] == j["id"] and x["id"] != inv["id"] and x["status"] != "void"
                        for x in tx.book["invoices"])
        if first:
            for p in list(tx.book["payments"]):
                if p["quote_id"] == j["quote_id"] and not p["invoice_id"]:
                    tx.patch("payments", p["id"], {"invoice_id": inv["id"]})
    return inv


def send_invoice(tx: Tx, invoice_id: str, date: str) -> dict:
    inv = tx.need("invoices", invoice_id)
    if inv["status"] == "void":
        fail("bad_state", f"Invoice {inv['number']} is void.")
    parse_date(date)
    return tx.patch("invoices", inv["id"], {"status": "sent", "sent_date": inv["sent_date"] or date})


def void_invoice(tx: Tx, invoice_id: str) -> dict:
    inv = tx.need("invoices", invoice_id)
    if any(p["invoice_id"] == inv["id"] for p in tx.book["payments"]):
        fail("bad_state", f"Invoice {inv['number']} has payments. Delete or move them first.")
    for vid in inv["visit_ids"]:
        tx.patch("visits", vid, {"invoice_id": ""})
    return tx.patch("invoices", inv["id"], {"status": "void", "visit_ids": []})


def record_payment(tx: Tx, fields: dict, today: str) -> dict:
    """Record money received. On an invoice it may not exceed the balance; a payment on a
    draft invoice marks the invoice sent."""
    p = dict(_obj(fields, "payment"))
    if p.get("invoice_id"):
        inv = tx.need("invoices", p["invoice_id"])
        p.setdefault("client_id", inv["client_id"])
        st = invoice_state(tx.book, inv, today)
        if inv["status"] == "void":
            fail("bad_state", f"Invoice {inv['number']} is void.")
        amt = p.get("amount")
        if is_int(amt) and amt > st["balance"]:
            fail("overpaid", f"The payment is more than the balance of invoice {inv['number']}.")
        if inv["status"] == "draft":
            tx.patch("invoices", inv["id"], {"status": "sent", "sent_date": p.get("date") or today})
    elif p.get("quote_id"):
        q = tx.need("quotes", p["quote_id"])
        p.setdefault("client_id", q["client_id"])
    return tx.create("payments", p)


def add_time(tx: Tx, fields: dict) -> dict:
    t = dict(_obj(fields, "time entry"))
    if t.get("visit_id") and not t.get("job_id"):
        t["job_id"] = tx.need("visits", t["visit_id"])["job_id"]
    return tx.create("timesheets", t)


def visit_minutes(v: dict) -> int:
    """Minutes between a visit's start and finish stamps, or its planned length."""
    if v["started_at"] and v["finished_at"]:
        return max(0, elapsed_minutes(v["started_at"], v["finished_at"]))
    return 0


# ---------------------------------------------------------------- job state

JOB_STATES = ("late", "requires_invoicing", "today", "upcoming", "unscheduled", "active", "closed", "archived")


def job_state(book: dict, job: dict, today: str) -> str:
    """One status for lists and reports:
    late (a scheduled visit is in the past), requires_invoicing (completed visits not on an
    invoice, or a closed job never invoiced), today, upcoming (next visit after today),
    unscheduled (active with no open visits), active, closed, archived."""
    if job["status"] == "archived":
        return "archived"
    vs = [v for v in book["visits"] if v["job_id"] == job["id"] and v["status"] != "cancelled"]
    uninvoiced = [v for v in vs if v["status"] == "completed" and not v["invoice_id"]]
    has_inv = any(i["job_id"] == job["id"] and i["status"] != "void" for i in book["invoices"])
    if job["status"] == "closed":
        if job["lines"] and (uninvoiced if job["kind"] == "recurring" else not has_inv):
            return "requires_invoicing"
        return "closed"
    open_vs = [v for v in vs if v["status"] in ("scheduled", "in_progress")]
    if any(v["date"] < today for v in open_vs):
        return "late"
    if job["lines"] and job["kind"] == "one_off" and vs and not open_vs and not has_inv:
        return "requires_invoicing"
    if job["kind"] == "recurring" and uninvoiced and job["invoice_timing"] == "after_visit":
        return "requires_invoicing"
    if any(v["date"] == today for v in open_vs):
        return "today"
    if open_vs:
        return "upcoming"
    if not vs:
        return "unscheduled"
    return "active"


# ---------------------------------------------------------------- public wrappers

def _run(book, fn, *args):
    tx = Tx(book)
    r = fn(tx, *args)
    return [tx.book, r]


def do(book: dict, step: str, args: list) -> list:
    """Run one workflow step by name: do(book, "send_quote", [quote_id, date]).
    Returns [new_book, result]."""
    fn = STEPS.get(step) if isinstance(step, str) else None
    if fn is None:
        fail("bad_step", f"Unknown step {show(step)}.")
    if not isinstance(args, list):
        fail("bad_step", "args: must be a list.")
    return _run(book, fn, *args)


STEPS = {"create_quote": create_quote, "quote_from_request": quote_from_request, "job_from_request": job_from_request,
         "send_quote": send_quote, "request_changes": request_changes, "approve_quote": approve_quote,
         "convert_quote": convert_quote, "create_job": create_job, "schedule_visit": schedule_visit,
         "move_visit": move_visit, "start_visit": start_visit, "finish_visit": finish_visit,
         "cancel_visit": cancel_visit, "reopen_visit": reopen_visit, "check_item": check_item,
         "close_job": close_job, "reopen_job": reopen_job, "invoice_job": invoice_job,
         "create_invoice": create_invoice, "send_invoice": send_invoice, "void_invoice": void_invoice,
         "record_payment": record_payment, "add_time": add_time, "generate_visits": generate_visits,
         "skip_visit": skip_visit}


def quote_total(book, quote_id):
    return doc_totals([q for q in book["quotes"] if q["id"] == quote_id][0])
