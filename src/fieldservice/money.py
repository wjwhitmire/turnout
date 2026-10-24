"""Quote, job and invoice totals, expected cost, payments, balances and invoice status.

The arithmetic is Field Ticket's, on scaled integers: quantity x 1000, discount percent x 100,
tax rate x 1000 (8.25% is 8250). Every division that produces cents rounds half away from
zero. Optional quote lines count only when selected.

  line amount   = round(qty_milli x rate / 1000)
  line cost     = round(qty_milli x cost / 1000)
  subtotal      = sum of included line amounts
  discount      = round(subtotal x pct_x100 / 10000), or min(amount, subtotal)
  discount share per line by largest remainder (shares sum to the discount)
  tax base      = line amount - share, for taxable lines
  tax           = round(sum(bases) x rate_milli / 100000) per document,
                  or sum(round(base x rate_milli / 100000)) per line
  total         = subtotal - discount + tax
"""

from __future__ import annotations

from .util import MAX_CENTS, add_days, allocate, days_between, fail, mul_div


def line_amount(ln: dict) -> int:
    a = mul_div(ln["qty_milli"], ln["rate"], 1000)
    if a > MAX_CENTS:
        fail("too_large", f"Line {ln['name'][:40]}: the amount is over $10,000,000.00. Split it into smaller lines.")
    return a


def included(ln: dict) -> bool:
    return (not ln["optional"]) or ln["selected"]


def doc_totals(doc: dict) -> dict:
    """Totals for a quote, job or invoice record (already validated)."""
    lines = doc["lines"]
    amounts = [line_amount(ln) if included(ln) else 0 for ln in lines]
    subtotal = sum(amounts)
    if doc["discount_kind"] == "pct":
        discount = mul_div(subtotal, doc["discount_value"], 10000)
    else:
        discount = min(doc["discount_value"], subtotal)
    shares = allocate(discount, amounts) if subtotal > 0 else [0] * len(lines)
    rate = doc["tax_rate_milli"]
    out = []
    base_sum = 0
    tax = 0
    cost = 0
    for i, ln in enumerate(lines):
        inc = included(ln)
        base = amounts[i] - shares[i] if inc and ln["taxable"] else 0
        base_sum += base
        t = mul_div(base, rate, 100_000) if doc["tax_mode"] == "line" else 0
        tax += t
        c = mul_div(ln["qty_milli"], ln["cost"], 1000) if inc else 0
        cost += c
        out.append({"id": ln["id"], "included": inc, "amount": amounts[i], "discount": shares[i], "tax_base": base,
                    "tax": t, "cost": c})
    if doc["tax_mode"] == "document":
        tax = mul_div(base_sum, rate, 100_000)
    optional_total = sum(line_amount(ln) for ln in lines if ln["optional"])
    return {"lines": out, "subtotal": subtotal, "discount": discount, "taxable_base": base_sum, "tax": tax,
            "total": subtotal - discount + tax, "cost": cost, "revenue": subtotal - discount,
            "optional_total": optional_total}


def payments_for(book: dict, invoice_id: str) -> list:
    return [p for p in book["payments"] if p["invoice_id"] == invoice_id]


def invoice_state(book: dict, inv: dict, today: str) -> dict:
    """{total, paid, balance, status, days_overdue}. Status is draft, void, paid, overdue,
    or awaiting (sent with money still owed)."""
    t = doc_totals(inv)
    paid = sum(p["amount"] for p in payments_for(book, inv["id"]))
    bal = t["total"] - paid
    over = 0
    if inv["status"] == "void":
        st = "void"
    elif inv["status"] == "draft":
        st = "draft"
    elif bal <= 0:
        st = "paid"
    elif today > inv["due_date"]:
        st = "overdue"
        over = days_between(inv["due_date"], today)
    else:
        st = "awaiting"
    return {"total": t["total"], "tax": t["tax"], "revenue": t["revenue"], "paid": paid, "balance": bal,
            "status": st, "days_overdue": over}


def quote_state(book: dict, q: dict) -> dict:
    t = doc_totals(q)
    dep = sum(p["amount"] for p in book["payments"] if p["quote_id"] == q["id"])
    return {"total": t["total"], "subtotal": t["subtotal"], "tax": t["tax"], "cost": t["cost"],
            "optional_total": t["optional_total"], "deposit_required": q["deposit"], "deposit_paid": dep,
            "deposit_due": max(0, q["deposit"] - dep)}


def due_date(date: str, terms_days: int) -> str:
    return add_days(date, terms_days)


def client_balance(book: dict, client_id: str, today: str) -> dict:
    """Money owed by a client on sent invoices, and unapplied payments (credit)."""
    owed = 0
    over = 0
    for inv in book["invoices"]:
        if inv["client_id"] != client_id:
            continue
        s = invoice_state(book, inv, today)
        if s["status"] in ("awaiting", "overdue", "paid"):
            owed += s["balance"]
        if s["status"] == "overdue":
            over += s["balance"]
    credit = sum(p["amount"] for p in book["payments"] if p["client_id"] == client_id and not p["invoice_id"]
                 and not p["quote_id"])
    return {"balance": owed - credit, "overdue": over, "credit": credit}
