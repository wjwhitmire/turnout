"""Exports: CSV of every list and report, the Crossfoot import files, and the read-only
quote or invoice page for a client.

CSV cells that a spreadsheet would run as a formula (starting with =, +, -, @, tab or
carriage return) get a leading apostrophe. Money is written as plain decimal text.

Crossfoot import (Field Tools No. 15 books): an IIF file that Crossfoot's Settings, Import
reads, with
  !ACCNT  Service Income, Materials Income and Other Income (income accounts; created in
          Crossfoot when missing)
  !CUST   every client with an invoice or payment in the range
  INVOICE each sent invoice dated in the range: Accounts Receivable for the total, one
          income split per line (after its share of the discount), Sales Tax Payable for
          the tax
  PAYMENT each payment dated in the range: Undeposited Funds and Accounts Receivable
Crossfoot imports payments unapplied (IIF has no link from a payment to an invoice); apply
them there. The customer list is also offered as a CSV with Crossfoot's customer columns.
"""

from __future__ import annotations

from . import messages as W
from .money import doc_totals, invoice_state, quote_state
from .paylinks import payment_options
from .qr import qr_svg
from .reports import BUCKETS
from .schema import FIELD_TABLES
from .util import (ServiceError, cents_text, esc_html, fail, lower, milli_text, money, parse_date, pct_text, show,
                   squash, to_csv)

LIST_KINDS = ("clients", "properties", "crew", "items", "requests", "quotes", "jobs", "visits", "timesheets",
              "expenses", "photos", "invoices", "payments", "reminders")


def _cell(f, v):
    t = f["t"]
    if t == "cents":
        return {"$": v}
    if t in ("refs", "ints", "dates", "strs"):
        return ";".join(str(x) for x in v)
    if t == "coord":
        return "" if v is None else v
    if t == "obj":
        return ""
    return v


def list_csv(book: dict, kind: str, today: str) -> str:
    """Every record of one kind as CSV, one column per field (lists of ids joined with ;),
    plus totals for quotes, jobs and invoices and a schedule description for jobs."""
    if kind not in LIST_KINDS:
        fail("bad_kind", f"Unknown list {show(kind)}.")
    tbl = FIELD_TABLES[kind]
    cols = [k for k, f in tbl.items() if f["t"] not in ("list", "obj")]
    extra = []
    if kind in ("quotes", "jobs", "invoices"):
        extra = ["lines", "subtotal", "discount", "tax", "total"]
    if kind == "invoices":
        extra += ["paid", "balance", "state"]
    if kind == "jobs":
        extra = ["schedule"] + extra
    if kind == "visits":
        extra = ["checklist_done", "checklist_items"]
    rows = [cols + extra]
    from .schedule import describe_rule
    for r in book[kind]:
        row = [_cell(tbl[k], r[k]) for k in cols]
        if kind == "jobs":
            row.append(describe_rule(r["rule"]) if r["kind"] == "recurring" and r["rule"] else "")
        if kind in ("quotes", "jobs", "invoices"):
            t = doc_totals(r)
            row += [len(r["lines"]), {"$": t["subtotal"]}, {"$": t["discount"]}, {"$": t["tax"]}, {"$": t["total"]}]
        if kind == "invoices":
            s = invoice_state(book, r, today)
            row += [{"$": s["paid"]}, {"$": s["balance"]}, s["status"]]
        if kind == "visits":
            row += [sum(1 for c in r["checklist"] if c["done"]), len(r["checklist"])]
        rows.append(row)
    return to_csv(rows)


def lines_csv(book: dict, kind: str) -> str:
    """Line items of every quote, job or invoice: one row per line."""
    if kind not in ("quotes", "jobs", "invoices"):
        fail("bad_kind", "Line items exist on quotes, jobs and invoices.")
    rows = [["document_id", "number", "line_id", "item_id", "name", "description", "kind", "qty", "rate", "cost",
             "taxable", "optional", "selected", "amount"]]
    for d in book[kind]:
        t = doc_totals(d)
        for ln, lt in zip(d["lines"], t["lines"]):
            rows.append([d["id"], d["number"], ln["id"], ln["item_id"], ln["name"], ln["description"], ln["kind"],
                         milli_text(ln["qty_milli"]), {"$": ln["rate"]}, {"$": ln["cost"]}, ln["taxable"],
                         ln["optional"], ln["selected"], {"$": lt["amount"]}])
    return to_csv(rows)


def report_csv(name: str, data: dict) -> str:
    """One report's result (from reports.py) as CSV."""
    if name == "revenue_by_month":
        rows = [["month", "invoices", "revenue", "tax", "collected"]]
        for r in data["rows"] + [data["total"]]:
            rows.append([r["month"], r["invoices"], {"$": r["revenue"]}, {"$": r["tax"]}, {"$": r["collected"]}])
    elif name == "jobs_by_status":
        rows = [["status", "count"]] + [[r["status"], r["count"]] for r in data["rows"]] + [["total", data["total"]]]
    elif name == "quote_conversion":
        rows = [["measure", "value"]]
        for k in ("sent", "approved", "changes_requested", "awaiting", "archived"):
            rows.append([k, data[k]])
        rows.append(["sent_value", {"$": data["sent_value"]}])
        rows.append(["approved_value", {"$": data["approved_value"]}])
        rows.append(["conversion_rate", pct_text(data["rate_bp"])])
        rows.append(["value_conversion_rate", pct_text(data["value_rate_bp"])])
    elif name == "crew_hours":
        rows = [["crew_id", "name", "job_hours", "travel_hours", "shop_hours", "other_hours", "total_hours",
                 "available_hours", "utilization", "labor_cost", "billable_value"]]
        for r in data["rows"]:
            rows.append([r["crew_id"], r["name"], W.hm(r["job_min"]), W.hm(r["travel_min"]), W.hm(r["shop_min"]),
                         W.hm(r["other_min"]), W.hm(r["total_min"]), W.hm(r["available_min"]),
                         pct_text(r["utilization_bp"]), {"$": r["labor_cost"]}, {"$": r["billable_value"]}])
    elif name == "job_profitability":
        rows = [["job_id", "number", "title", "revenue", "revenue_basis", "labor_hours", "labor_cost", "materials",
                 "cost", "profit", "margin", "expected_cost"]]
        for r in data["rows"]:
            rows.append([r["job_id"], r["number"], r["title"], {"$": r["revenue"]}, r["revenue_basis"],
                         W.hm(r["labor_min"]), {"$": r["labor_cost"]}, {"$": r["materials"]}, {"$": r["cost"]},
                         {"$": r["profit"]}, pct_text(r["margin_bp"]), {"$": r["expected_cost"]}])
        t = data["total"]
        rows.append(["", "", "Total", {"$": t["revenue"]}, "", W.hm(t["labor_min"]), {"$": t["labor_cost"]},
                     {"$": t["materials"]}, {"$": t["cost"]}, {"$": t["profit"]}, pct_text(t["margin_bp"]), ""])
    elif name == "aging":
        rows = [["client_id", "name"] + list(BUCKETS) + ["total"]]
        for r in data["rows"]:
            rows.append([r["client_id"], r["name"]] + [{"$": r[b]} for b in BUCKETS] + [{"$": r["total"]}])
        rows.append(["", "Total"] + [{"$": data["total"][b]} for b in BUCKETS] + [{"$": data["total"]["total"]}])
    else:
        fail("bad_report", f"Unknown report {show(name)}.")
    return to_csv(rows)


# ---------------------------------------------------------------- Crossfoot

INCOME = {"service": "Service Income", "material": "Materials Income", "other": "Other Income"}


def _iif(s: str) -> str:
    return squash(str(s).replace("\t", " ").replace('"', "'").replace("\r", " ").replace("\n", " "))


def _iif_date(d: str) -> str:
    y, m, dd = parse_date(d)
    return f"{m}/{dd}/{y}"


def customer_names(book: dict) -> dict:
    """A unique Crossfoot customer name for every client. A colon would start a sub-customer
    in Crossfoot, so it becomes a dash; a repeated name gets the client id added."""
    seen = {}
    out = {}
    for c in sorted(book["clients"], key=lambda c: c["id"]):
        n = _iif(c["name"]).replace(":", "-")[:180] or c["id"]
        k = lower(n)
        if k in seen:
            n = f"{n} ({c['id']})"
            k = lower(n)
        seen[k] = 1
        out[c["id"]] = n
    return out


def _addr_parts(book, c):
    if c["billing_address"]:
        return [x for x in c["billing_address"].split("\n") if x][:3] + ["", "", ""]
    for p in book["properties"]:
        if p["client_id"] == c["id"]:
            return [p["street"], " ".join(x for x in [p["city"], p["state"], p["zip"]] if x), ""]
    return ["", "", ""]


def crossfoot_iif(book: dict, frm: str, to: str) -> str:
    parse_date(frm)
    parse_date(to)
    names = customer_names(book)
    terms = book["settings"]["terms_days"]
    invs = sorted([i for i in book["invoices"] if i["status"] == "sent" and frm <= i["date"] <= to],
                  key=lambda i: (i["date"], i["number"], i["id"]))
    pays = sorted([p for p in book["payments"] if frm <= p["date"] <= to], key=lambda p: (p["date"], p["id"]))
    used = set(i["client_id"] for i in invs) | set(p["client_id"] for p in pays)
    out = ["!ACCNT\tNAME\tACCNTTYPE\tDESC"]
    for k in ("service", "material", "other"):
        out.append(f"ACCNT\t{INCOME[k]}\tINC\tFrom the field service office")
    out.append("!CUST\tNAME\tCOMPANYNAME\tEMAIL\tPHONE1\tBADDR1\tBADDR2\tBADDR3\tTERMS\tTAXABLE")
    for c in sorted(book["clients"], key=lambda c: (lower(names[c["id"]]), c["id"])):
        if c["id"] not in used:
            continue
        a = _addr_parts(book, c)
        out.append("\t".join(["CUST", names[c["id"]], _iif(c["company"]), _iif(c["email"]), _iif(c["phone"]),
                              _iif(a[0]), _iif(a[1]), _iif(a[2]), f"Net {terms}", "Y"]))
    out.append("!TRNS\tTRNSID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO\tDUEDATE")
    out.append("!SPL\tSPLID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO")
    out.append("!ENDTRNS")
    for inv in invs:
        t = doc_totals(inv)
        if t["total"] <= 0:
            continue
        nm = names[inv["client_id"]]
        d = _iif_date(inv["date"])
        out.append("\t".join(["TRNS", "", "INVOICE", d, "Accounts Receivable", nm, cents_text(t["total"]),
                              _iif(inv["number"]), _iif(inv["subject"]), _iif_date(inv["due_date"])]))
        for ln, lt in zip(inv["lines"], t["lines"]):
            net = lt["amount"] - lt["discount"]
            if not lt["included"] or net == 0:
                continue
            out.append("\t".join(["SPL", "", "INVOICE", d, INCOME[ln["kind"]], nm, cents_text(-net),
                                  _iif(inv["number"]), _iif(ln["name"])]))
        if t["tax"]:
            out.append("\t".join(["SPL", "", "INVOICE", d, "Sales Tax Payable", nm, cents_text(-t["tax"]),
                                  _iif(inv["number"]), "Sales tax"]))
        out.append("ENDTRNS")
    invnum = {i["id"]: i["number"] for i in book["invoices"]}
    for p in pays:
        nm = names[p["client_id"]]
        d = _iif_date(p["date"])
        memo = f"Payment for {invnum[p['invoice_id']]}" if p["invoice_id"] else "Deposit" if p["quote_id"] else "Payment"
        ref = _iif(p["reference"])[:30]
        out.append("\t".join(["TRNS", "", "PAYMENT", d, "Undeposited Funds", nm, cents_text(p["amount"]), ref,
                              _iif(f"{memo} ({p['method']})")]))
        out.append("\t".join(["SPL", "", "PAYMENT", d, "Accounts Receivable", nm, cents_text(-p["amount"]), ref,
                              _iif(memo)]))
        out.append("ENDTRNS")
    return "\r\n".join(out) + "\r\n"


def crossfoot_customers_csv(book: dict) -> str:
    names = customer_names(book)
    rows = [["Customer", "Company", "Email", "Phone", "Billing Address", "City", "State", "Zip", "Terms", "Notes"]]
    terms = book["settings"]["terms_days"]
    for c in sorted(book["clients"], key=lambda c: (lower(names[c["id"]]), c["id"])):
        street = city = state = zp = ""
        if c["billing_address"]:
            street = c["billing_address"].replace("\n", ", ")
        else:
            for p in book["properties"]:
                if p["client_id"] == c["id"]:
                    street, city, state, zp = p["street"], p["city"], p["state"], p["zip"]
                    break
        rows.append([names[c["id"]], c["company"], c["email"], c["phone"], street, city, state, zp, f"Net {terms}",
                     c["notes"]])
    return to_csv(rows)


# ---------------------------------------------------------------- client page

CSS = ("body{margin:0;background:#eef0f2}"
       ".cp{font:400 16px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#121417;"
       "padding:16px;--g-cut:#fff;max-width:760px;margin:0 auto}"
       ".cp-doc{background:#fff;border:1px solid #d5d9de;border-radius:10px;padding:18px}"
       ".cp-biz{display:flex;justify-content:space-between;gap:12px;padding-bottom:12px;border-bottom:3px solid #121417}"
       ".cp-biz b{font:800 20px/1.15 'Arial Narrow',system-ui,sans-serif;font-stretch:condensed}"
       ".cp-biz small{display:block;color:#4c535d;font-size:14px}"
       ".cp h1{font:800 22px/1.15 system-ui,sans-serif;margin:14px 0 2px}"
       ".cp h2{font:700 17px/1.25 system-ui,sans-serif;margin:16px 0 4px}"
       ".cp .stl{display:inline-flex;align-items:center;gap:6px;min-height:28px;padding:0 9px 0 6px;"
       "border:1.5px solid currentColor;border-radius:4px;color:#123382;font-weight:650;font-size:14px}"
       ".cp .stl svg{width:16px;height:16px}"
       ".cp .s-late{color:#c4300a}.cp .s-done{color:#127c4a}.cp .s-bill{color:#5c2e05}.cp .s-hold{color:#5d636b}"
       ".cp .meta{color:#4c535d;font-size:14px;margin-top:6px}"
       ".cp-due{display:flex;flex-direction:column;background:#ffd31a;border:2px solid #121417;border-radius:6px;"
       "padding:10px 14px 0;margin:14px 0;overflow:hidden}"
       ".cp-due span{font:700 12px/1.2 system-ui,sans-serif;letter-spacing:.09em;text-transform:uppercase}"
       ".cp-due b{font:800 34px/1.1 system-ui,sans-serif;font-variant-numeric:tabular-nums}"
       ".cp-due small{font-size:14px}"
       ".cp-due::after{content:'';display:block;height:8px;margin:10px -14px 0;background:#aeb4bd;border-top:2px solid #121417}"
       ".cp .to{display:flex;flex-wrap:wrap;gap:8px 28px;font-size:15px}.cp .to h3{font:700 12px/1.2 system-ui,sans-serif;"
       "letter-spacing:.09em;text-transform:uppercase;color:#4c535d;margin:10px 0 2px}"
       ".cp table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;font-size:15px}"
       ".cp td{padding:8px 0;border-bottom:1px solid #e1e4e8;vertical-align:top}"
       ".cp td.n{text-align:right;white-space:nowrap;padding-left:10px}"
       ".cp td small{display:block;color:#4c535d;font-size:13px}"
       ".cp .opt{display:inline-block;font-size:12px;border:1.5px dashed #5d636b;color:#4c535d;border-radius:4px;padding:0 5px;margin-left:6px}"
       ".cp tr.off td{color:#4c535d}.cp tr.off td.n{text-decoration:line-through}"
       ".cp .tot td{border:0;padding:3px 0}"
       ".cp .pay{display:flex;flex-direction:column;gap:8px;margin-top:16px}"
       ".cp .pay a,.cp .pay div{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:48px;"
       "padding:6px 14px;border:1.5px solid #121417;border-radius:6px;color:#121417;font-weight:650;text-decoration:none;"
       "overflow-wrap:anywhere}"
       ".cp .pay div{font-weight:400}.cp .pay a.first{background:#121417;color:#fff}"
       ".cp .qr{display:flex;gap:12px;align-items:center;margin-top:14px;font-size:14px;color:#4c535d}"
       ".cp .qr svg{width:120px;height:120px;flex:none}"
       ".cp-foot{font-size:13px;color:#4c535d;margin-top:14px}"
       "@media print{body{background:#fff}.cp-doc{border:0}}")

GLYPH = {"ring": '<circle cx="8" cy="8" r="5.2" fill="none" stroke="currentColor" stroke-width="2.2"/>',
         "check": '<circle cx="8" cy="8" r="6.4" fill="currentColor"/><path d="M5 8.2l2 2 4-4.2" fill="none" '
                  'stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
         "alert": '<path d="M8 1.6l7 12.6H1z" fill="currentColor"/><path d="M8 6.2v3.6M8 11.9v.1" stroke="#fff" '
                  'stroke-width="1.9" stroke-linecap="round"/>',
         "tag": '<path d="M1.8 3.2h7.4l5 4.8-5 4.8H1.8z" fill="currentColor"/><circle cx="5" cy="8" r="1.4" fill="#fff"/>',
         "dash": '<circle cx="8" cy="8" r="5.2" fill="none" stroke="currentColor" stroke-width="2.2" '
                 'stroke-dasharray="3.1 2.35"/>',
         "void": '<circle cx="8" cy="8" r="5.2" fill="none" stroke="currentColor" stroke-width="2.2"/><path '
                 'd="M4.3 11.7l7.4-7.4" stroke="currentColor" stroke-width="2.2"/>'}
QUOTE_STATE = {"draft": ("Draft", "s-hold", "dash"), "sent": ("Awaiting your response", "s-sched", "ring"),
               "changes_requested": ("Changes requested", "s-bill", "tag"), "approved": ("Approved", "s-done", "check"),
               "converted": ("Approved", "s-done", "check"), "archived": ("Closed", "s-hold", "void")}
INVOICE_STATE = {"draft": ("Draft", "s-hold", "dash"), "void": ("Void", "s-hold", "void"), "paid": ("Paid", "s-done", "check"),
                 "overdue": ("Past due", "s-late", "alert"), "awaiting": ("Awaiting payment", "s-sched", "ring")}


def _p(s: str) -> str:
    return "<br>".join(esc_html(x) for x in s.split("\n"))


def _row(label: str, value: str, bold: bool = False) -> str:
    if bold:
        return f"<tr><td><b>{esc_html(label)}</b></td><td class=\"n\"><b>{value}</b></td></tr>"
    return f"<tr><td>{esc_html(label)}</td><td class=\"n\">{value}</td></tr>"


def client_page(book: dict, kind: str, rid: str, today: str) -> str:
    """A read-only HTML page for a client: one quote or invoice with its lines, totals and
    ways to pay (with a QR code for the first payment link). No scripts and no web fonts; a
    Content-Security-Policy in the page blocks any network request."""
    if kind not in ("quotes", "invoices"):
        fail("bad_kind", "A client page is made for a quote or an invoice.")
    doc = None
    for r in book[kind]:
        if r["id"] == rid:
            doc = r
    if doc is None:
        fail("not_found", f"There is no {'quote' if kind == 'quotes' else 'invoice'} {show(rid)}.")
    s = book["settings"]
    client = [c for c in book["clients"] if c["id"] == doc["client_id"]][0]
    prop = None
    for p in book["properties"]:
        if p["id"] == doc["property_id"]:
            prop = p
    t = doc_totals(doc)
    is_q = kind == "quotes"
    title = ("Quote " if is_q else "Invoice ") + doc["number"]
    h = ["<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">",
         "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
         "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; "
         "img-src data:; base-uri 'none'; form-action 'none'\">",
         "<meta name=\"referrer\" content=\"no-referrer\">",
         f"<title>{esc_html(title)} from {esc_html(s['business_name'] or 'us')}</title><style>{CSS}</style></head>",
         "<body><div class=\"cp\"><div class=\"cp-doc\">"]
    contact = " / ".join(esc_html(x) for x in [s["phone"], s["email"]] if x)
    h.append(f"<div class=\"cp-biz\"><div><b>{esc_html(s['business_name'])}</b>"
             + (f"<small>{contact}</small>" if contact else "")
             + "".join(f"<small>{_p(x)}</small>" for x in [s["address"], s["website"], s["license"]] if x)
             + "</div></div>")
    h.append(f"<h1>{esc_html(title)}</h1>")
    if is_q:
        word, cls, gl = QUOTE_STATE[doc["status"]]
        meta = [f"Date: {W.date_words(doc['date'])}"]
        if doc["valid_until"]:
            meta.append(f"Valid until: {W.date_words(doc['valid_until'])}")
        if doc["approved_date"]:
            meta.append(f"Approved: {W.date_words(doc['approved_date'])}"
                        + (f" by {doc['approved_by']}" if doc["approved_by"] else ""))
        state = None
    else:
        state = invoice_state(book, doc, today)
        word, cls, gl = INVOICE_STATE[state["status"]]
        meta = [f"Date: {W.date_words(doc['date'])}", f"Due: {W.date_words(doc['due_date'])}"]
    h.append(f"<span class=\"stl {cls}\"><svg viewBox=\"0 0 16 16\" aria-hidden=\"true\">{GLYPH[gl]}</svg>"
             f"{esc_html(word)}</span>")
    h.append("<div class=\"meta\">" + "<br>".join(esc_html(x) for x in meta) + "</div>")
    pay_amount = 0
    if is_q:
        qs = quote_state(book, doc)
        dep = ""
        if doc["deposit"]:
            dep = f"<small>Deposit required: {money(doc['deposit'])}</small>"
        h.append(f"<div class=\"cp-due\"><span>Quote total</span><b>{money(t['total'])}</b>{dep}</div>")
        pay_amount = qs["deposit_due"] if doc["status"] in ("sent", "changes_requested", "approved") else 0
    else:
        h.append(f"<div class=\"cp-due\"><span>Amount due</span><b>{money(max(state['balance'], 0))}</b></div>")
        pay_amount = state["balance"] if state["status"] in ("awaiting", "overdue") else 0
    who = [client["name"], client["company"]] + ([client["billing_address"]] if client["billing_address"] else [])
    h.append("<div class=\"to\"><div><h3>For</h3>" + "<br>".join(_p(x) for x in who if x) + "</div>")
    if prop is not None:
        h.append("<div><h3>Service address</h3>" + _p(prop["label"] + "\n" + W.address_line(prop)
                                                     if prop["label"] else W.address_line(prop)) + "</div>")
    h.append("</div>")
    subj = doc["title"] if is_q else doc["subject"]
    if subj:
        h.append(f"<h2>{esc_html(subj)}</h2>")
    h.append("<table><tbody>")
    for ln in doc["lines"]:
        tag = ""
        off = ln["optional"] and not ln["selected"]
        if ln["optional"]:
            tag = "<span class=\"opt\">" + ("Optional, chosen" if ln["selected"] else "Optional, not chosen") + "</span>"
        trc = ' class="off"' if off else ""
        h.append(f"<tr{trc}><td>{esc_html(ln['name'])}{tag}"
                 f"<small>Qty {milli_text(ln['qty_milli'])} at {money(ln['rate'])}</small>"
                 + (f"<small>{_p(ln['description'])}</small>" if ln["description"] else "")
                 + f"</td><td class=\"n\">{money(line_amt(ln))}</td></tr>")
    h.append("</tbody></table><table class=\"tot\"><tbody>")
    h.append(_row("Subtotal", money(t["subtotal"])))
    if t["discount"]:
        h.append(_row("Discount", money(-t["discount"])))
    if t["tax"] or doc["tax_rate_milli"]:
        h.append(_row(f"Tax ({milli_text(doc['tax_rate_milli'])}%)", money(t["tax"])))
    h.append(_row("Total", money(t["total"]), True))
    if is_q:
        if doc["deposit"]:
            h.append(_row("Deposit required", money(doc["deposit"])))
            if qs["deposit_paid"]:
                h.append(_row("Deposit received", f"({money(qs['deposit_paid'])})"))
        if t["optional_total"] and any(ln["optional"] and not ln["selected"] for ln in doc["lines"]):
            h.append("<tr><td colspan=\"2\"><small>Optional items not chosen are not in the total.</small></td></tr>")
    else:
        if state["paid"]:
            h.append(_row("Paid", f"({money(state['paid'])})"))
        h.append(_row("Balance due", money(state["balance"]), True))
    h.append("</tbody></table>")
    if doc["message"]:
        h.append(f"<h2>Message</h2><div>{_p(doc['message'])}</div>")
    if pay_amount > 0:
        opts = payment_options(s, pay_amount, doc["number"])
        if opts:
            h.append(f"<h2>{'Pay the deposit' if is_q else 'Ways to pay'} ({money(pay_amount)})</h2><div class=\"pay\">")
            first = True
            for o in opts:
                if o["url"]:
                    fc = ' class="first"' if first else ""
                    h.append(f"<a{fc} href=\"{esc_html(o['url'])}\" rel=\"noreferrer\">"
                             f"<span>{esc_html(o['label'])}: {esc_html(o['url'])}</span><span>&#8594;</span></a>")
                    first = False
                else:
                    h.append(f"<div><span><b>{esc_html(o['label'])}:</b> {esc_html(o['text'])}</span></div>")
            h.append("</div>")
            links = [o for o in opts if o["url"]]
            if links:
                try:
                    h.append("<div class=\"qr\">" + qr_svg(links[0]["url"], 3)
                             + "<span>Scan with a phone camera to open the first payment link.</span></div>")
                except ServiceError:
                    pass
    if is_q and doc["status"] in ("sent", "changes_requested"):
        how = " or ".join(x for x in [s["phone"], s["email"]] if x)
        h.append("<h2>To approve</h2><div>Reply to " + (esc_html(how) if how else "us")
                 + " with your approval and any optional items you want. This page is a read-only copy.</div>")
    h.append(f"<p class=\"cp-foot\">Prepared {esc_html(W.date_words(today))}. This page is a read-only copy for "
             f"{esc_html(client['name'])}.</p>")
    h.append("</div></div></body></html>")
    return "\n".join(h) + "\n"


def line_amt(ln):
    from .money import line_amount
    return line_amount(ln)
