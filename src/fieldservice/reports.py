"""Reports: revenue by month, jobs by status, quote conversion, crew hours and utilization,
job profitability, aging of unpaid invoices, and the home page overview.

Definitions:
  revenue        invoice subtotal less discount, before tax, for invoices that are sent (or
                 paid); drafts and void invoices are left out
  collected      payments received, by payment date
  conversion     quotes sent in the range that were approved (approved or converted) divided
                 by quotes sent in the range, in basis points (10000 = 100%)
  available time a crew member's weekly minutes x days in range / 7
  utilization    job minutes / available minutes, in basis points
  labor cost     minutes x the crew member's hourly cost rate / 60, rounded per time entry
  materials      expense quantity x unit cost
  margin         (revenue - labor - materials) / revenue, in basis points
  aging          days past the due date on the as-of date, for the balance left after the
                 payments dated on or before it
"""

from __future__ import annotations

from .money import doc_totals, invoice_state
from .util import add_months, day_num, days_between, div_round, mul_div, parse_date
from .workflow import JOB_STATES, job_state

BUCKETS = ("current", "1_30", "31_60", "61_90", "91_plus")


def months_between(frm: str, to: str) -> list:
    parse_date(frm)
    parse_date(to)
    out = []
    m = frm[:7] + "-01"
    while m <= to:
        out.append(m[:7])
        m = add_months(m, 1)
        if len(out) > 240:
            break
    return out


def _billed(inv) -> bool:
    return inv["status"] == "sent"


def revenue_by_month(book: dict, frm: str, to: str) -> dict:
    months = months_between(frm, to)
    rows = {m: {"month": m, "invoices": 0, "revenue": 0, "tax": 0, "collected": 0} for m in months}
    for inv in book["invoices"]:
        if not _billed(inv) or not (frm <= inv["date"] <= to):
            continue
        t = doc_totals(inv)
        r = rows[inv["date"][:7]]
        r["invoices"] += 1
        r["revenue"] += t["revenue"]
        r["tax"] += t["tax"]
    for p in book["payments"]:
        if frm <= p["date"] <= to:
            rows[p["date"][:7]]["collected"] += p["amount"]
    out = [rows[m] for m in months]
    tot = {"month": "Total", "invoices": sum(r["invoices"] for r in out), "revenue": sum(r["revenue"] for r in out),
           "tax": sum(r["tax"] for r in out), "collected": sum(r["collected"] for r in out)}
    return {"rows": out, "total": tot}


def jobs_by_status(book: dict, today: str) -> dict:
    counts = {s: 0 for s in JOB_STATES}
    ids = {s: [] for s in JOB_STATES}
    for j in book["jobs"]:
        s = job_state(book, j, today)
        counts[s] += 1
        ids[s].append(j["id"])
    return {"rows": [{"status": s, "count": counts[s], "job_ids": ids[s]} for s in JOB_STATES],
            "total": len(book["jobs"])}


def quote_conversion(book: dict, frm: str, to: str) -> dict:
    sent = won = changes = waiting = lost = 0
    sent_v = won_v = 0
    for q in book["quotes"]:
        d = q["sent_date"]
        if not d or not (frm <= d <= to):
            continue
        t = doc_totals(q)["total"]
        sent += 1
        sent_v += t
        if q["status"] in ("approved", "converted"):
            won += 1
            won_v += t
        elif q["status"] == "changes_requested":
            changes += 1
        elif q["status"] == "sent":
            waiting += 1
        elif q["status"] == "archived":
            lost += 1
    return {"sent": sent, "approved": won, "changes_requested": changes, "awaiting": waiting, "archived": lost,
            "sent_value": sent_v, "approved_value": won_v,
            "rate_bp": div_round(won * 10000, sent) if sent else 0,
            "value_rate_bp": mul_div(won_v, 10000, sent_v) if sent_v else 0}


def crew_hours(book: dict, frm: str, to: str) -> dict:
    days = days_between(frm, to) + 1
    if days < 1:
        return {"rows": [], "days": 0}
    rows = []
    for m in book["crew"]:
        ts = [t for t in book["timesheets"] if t["crew_id"] == m["id"] and frm <= t["date"] <= to]
        if not m["active"] and not ts:
            continue
        by = {"job": 0, "travel": 0, "shop": 0, "other": 0}
        cost = 0
        for t in ts:
            by[t["kind"]] += t["minutes"]
            cost += mul_div(t["minutes"], m["cost_rate"], 60)
        total = sum(by.values())
        avail = div_round(m["weekly_minutes"] * days, 7)
        rows.append({"crew_id": m["id"], "name": m["name"], "job_min": by["job"], "travel_min": by["travel"],
                     "shop_min": by["shop"], "other_min": by["other"], "total_min": total, "available_min": avail,
                     "utilization_bp": mul_div(by["job"], 10000, avail) if avail else 0,
                     "labor_cost": cost, "billable_value": mul_div(by["job"], m["bill_rate"], 60)})
    return {"rows": rows, "days": days}


def job_costs(book: dict, job: dict) -> dict:
    crew = {m["id"]: m for m in book["crew"]}
    labor_min = 0
    labor = 0
    for t in book["timesheets"]:
        if t["job_id"] == job["id"]:
            labor_min += t["minutes"]
            labor += mul_div(t["minutes"], crew[t["crew_id"]]["cost_rate"], 60)
    mats = sum(mul_div(x["qty_milli"], x["unit_cost"], 1000) for x in book["expenses"] if x["job_id"] == job["id"])
    invs = [i for i in book["invoices"] if i["job_id"] == job["id"] and i["status"] != "void"]
    if invs:
        revenue = sum(doc_totals(i)["revenue"] for i in invs)
        basis = "invoiced"
    else:
        revenue = doc_totals(job)["revenue"] if job["kind"] == "one_off" else 0
        basis = "quoted" if revenue else "none"
    cost = labor + mats
    profit = revenue - cost
    return {"job_id": job["id"], "number": job["number"], "title": job["title"], "revenue": revenue,
            "revenue_basis": basis, "labor_min": labor_min, "labor_cost": labor, "materials": mats,
            "cost": cost, "profit": profit, "margin_bp": mul_div(profit, 10000, revenue) if revenue > 0 else 0,
            "expected_cost": doc_totals(job)["cost"]}


def job_profitability(book: dict, frm: str, to: str) -> dict:
    """Every job with a visit, invoice, time entry or expense dated in [frm, to]; blank frm
    and to mean every job."""
    rows = []
    for j in book["jobs"]:
        if frm and to:
            dates = ([v["date"] for v in book["visits"] if v["job_id"] == j["id"]]
                     + [i["date"] for i in book["invoices"] if i["job_id"] == j["id"]]
                     + [t["date"] for t in book["timesheets"] if t["job_id"] == j["id"]]
                     + [x["date"] for x in book["expenses"] if x["job_id"] == j["id"]])
            if not any(frm <= d <= to for d in dates):
                continue
        rows.append(job_costs(book, j))
    tot = {k: sum(r[k] for r in rows) for k in ("revenue", "labor_min", "labor_cost", "materials", "cost", "profit")}
    tot["margin_bp"] = mul_div(tot["profit"], 10000, tot["revenue"]) if tot["revenue"] > 0 else 0
    return {"rows": rows, "total": tot}


def bucket_of(days: int) -> str:
    if days <= 0:
        return "current"
    if days <= 30:
        return "1_30"
    if days <= 60:
        return "31_60"
    if days <= 90:
        return "61_90"
    return "91_plus"


def aging(book: dict, as_of: str) -> dict:
    day_num(as_of)
    clients = {c["id"]: c for c in book["clients"]}
    per = {}
    items = []
    for inv in book["invoices"]:
        if not _billed(inv) or inv["date"] > as_of:
            continue
        total = doc_totals(inv)["total"]
        paid = sum(p["amount"] for p in book["payments"] if p["invoice_id"] == inv["id"] and p["date"] <= as_of)
        bal = total - paid
        if bal <= 0:
            continue
        days = days_between(inv["due_date"], as_of)
        b = bucket_of(days)
        items.append({"invoice_id": inv["id"], "number": inv["number"], "client_id": inv["client_id"],
                      "date": inv["date"], "due_date": inv["due_date"], "days": max(days, 0), "bucket": b,
                      "balance": bal})
        row = per.setdefault(inv["client_id"], dict({"client_id": inv["client_id"],
                                                      "name": clients[inv["client_id"]]["name"], "total": 0},
                                                     **{k: 0 for k in BUCKETS}))
        row[b] += bal
        row["total"] += bal
    rows = sorted(per.values(), key=lambda r: (-r["total"], r["name"], r["client_id"]))
    tot = dict({k: sum(r[k] for r in rows) for k in BUCKETS}, total=sum(r["total"] for r in rows))
    items.sort(key=lambda i: (i["due_date"], i["number"], i["invoice_id"]))
    return {"rows": rows, "total": tot, "items": items}


def overview(book: dict, today: str) -> dict:
    """Counts for the home page."""
    st = [invoice_state(book, i, today) for i in book["invoices"]]
    js = jobs_by_status(book, today)
    cnt = {r["status"]: r["count"] for r in js["rows"]}
    return {
        "visits_today": sum(1 for v in book["visits"] if v["date"] == today and v["status"] != "cancelled"),
        "visits_done_today": sum(1 for v in book["visits"] if v["date"] == today and v["status"] == "completed"),
        "new_requests": sum(1 for r in book["requests"] if r["status"] in ("new", "assessment")),
        "quotes_draft": sum(1 for q in book["quotes"] if q["status"] == "draft"),
        "quotes_awaiting": sum(1 for q in book["quotes"] if q["status"] in ("sent", "changes_requested")),
        "quotes_approved": sum(1 for q in book["quotes"] if q["status"] == "approved"),
        "jobs_late": cnt["late"], "jobs_requires_invoicing": cnt["requires_invoicing"],
        "invoices_draft": sum(1 for s in st if s["status"] == "draft"),
        "invoices_awaiting": sum(1 for s in st if s["status"] == "awaiting"),
        "invoices_overdue": sum(1 for s in st if s["status"] == "overdue"),
        "receivable": sum(s["balance"] for s in st if s["status"] in ("awaiting", "overdue")),
        "overdue_amount": sum(s["balance"] for s in st if s["status"] == "overdue"),
        "reminders_queued": sum(1 for r in book["reminders"] if r["status"] == "queued"),
    }


REPORTS = ("revenue_by_month", "jobs_by_status", "quote_conversion", "crew_hours", "job_profitability", "aging")
