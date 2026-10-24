import pytest

from fieldservice.book import Tx
from fieldservice.money import client_balance, doc_totals, invoice_state, quote_state
from fieldservice.schema import check_record
from fieldservice.util import ServiceError
from fieldservice.workflow import create_invoice, create_quote, record_payment

from helpers import base_book, line, run


def Q(lines, **kw):
    rec = {"id": "q", "client_id": "c1", "date": "2026-10-01", "lines": lines, "tax_rate_milli": 8250}
    rec.update(kw)
    return check_record("quotes", rec, "q")


def test_hand_checked_totals_document_tax():
    q = Q([line("a", 12500, 19750, taxable=False), line("b", 4275, 3000, taxable=True)])
    t = doc_totals(q)
    # 19.75 h x $125 = $2,468.75; 3 x $42.75 = $128.25 taxable; tax 128.25 x 8.25% = 10.580625 -> 10.58
    assert t["subtotal"] == 259700
    assert t["tax"] == 1058
    assert t["total"] == 260758
    assert t["revenue"] == 259700


def test_per_line_versus_per_document_rounding():
    lines = [line(str(i), 5, 1000, taxable=True) for i in range(3)]
    assert doc_totals(Q(lines, tax_rate_milli=10000, tax_mode="document"))["tax"] == 2   # 1.5 cents rounds to 2
    assert doc_totals(Q(lines, tax_rate_milli=10000, tax_mode="line"))["tax"] == 3       # 0.5 each rounds to 1


def test_discount_shares_and_taxable_base():
    lines = [line("a", 10000, taxable=True), line("b", 20000, taxable=False), line("c", 3333, taxable=True)]
    t = doc_totals(Q(lines, discount_kind="pct", discount_value=1000))       # 10%
    assert t["discount"] == 3333
    assert sum(x["discount"] for x in t["lines"]) == 3333
    assert [x["discount"] for x in t["lines"]] == [1000, 2000, 333]
    assert t["taxable_base"] == (10000 - 1000) + (3333 - 333)
    t2 = doc_totals(Q(lines, discount_kind="amt", discount_value=999999))
    assert t2["discount"] == t2["subtotal"] and t2["total"] == 0
    with pytest.raises(ServiceError):
        Q(lines, discount_kind="pct", discount_value=10001)


def test_optional_lines_count_only_when_selected():
    lines = [line("a", 10000), line("b", 5000, optional=True, selected=False), line("c", 2500, optional=True)]
    t = doc_totals(Q(lines, tax_rate_milli=0))
    assert t["subtotal"] == 12500
    assert t["optional_total"] == 7500
    assert [x["included"] for x in t["lines"]] == [True, False, True]


def test_costs_and_line_cap():
    t = doc_totals(Q([line("a", 6500, 3000, cost=3200)]))
    assert t["cost"] == 9600
    with pytest.raises(ServiceError, match="over"):
        doc_totals(Q([line("a", 1_000_000_000, 2000)]))
    with pytest.raises(ServiceError):
        Q([line("a", 1_000_000_001)])
    with pytest.raises(ServiceError):
        Q([line("a", 100, 1.5)])


def test_invoice_states_and_payments():
    b = base_book()
    b, inv = run(b, create_invoice, {"client_id": "c1", "date": "2026-10-01", "lines": [line("a", 10000)],
                                     "tax_rate_milli": 0})
    assert inv["due_date"] == "2026-10-16"                     # terms 15 days from settings
    assert invoice_state(b, inv, "2026-10-20")["status"] == "draft"
    b, p = run(b, record_payment, {"invoice_id": inv["id"], "date": "2026-10-05", "amount": 4000}, "2026-10-05")
    inv = [i for i in b["invoices"] if i["id"] == inv["id"]][0]
    assert inv["status"] == "sent"                             # a payment on a draft marks it sent
    s = invoice_state(b, inv, "2026-10-16")
    assert (s["status"], s["paid"], s["balance"]) == ("awaiting", 4000, 6000)
    s = invoice_state(b, inv, "2026-10-20")
    assert (s["status"], s["days_overdue"]) == ("overdue", 4)
    with pytest.raises(ServiceError, match="more than the balance"):
        run(b, record_payment, {"invoice_id": inv["id"], "date": "2026-10-20", "amount": 6001}, "2026-10-20")
    b, _ = run(b, record_payment, {"invoice_id": inv["id"], "date": "2026-10-20", "amount": 6000}, "2026-10-20")
    assert invoice_state(b, inv, "2026-12-01")["status"] == "paid"
    assert client_balance(b, "c1", "2026-12-01")["balance"] == 0
    with pytest.raises(ServiceError):
        run(b, record_payment, {"invoice_id": inv["id"], "date": "2026-10-20", "amount": 0}, "2026-10-20")


def test_payment_client_must_match_invoice():
    b = base_book()
    b, inv = run(b, create_invoice, {"client_id": "c1", "date": "2026-10-01", "lines": [line("a", 10000)]})
    with pytest.raises(ServiceError, match="another client"):
        run(b, record_payment, {"invoice_id": inv["id"], "client_id": "c2", "date": "2026-10-05", "amount": 100},
            "2026-10-05")


def test_quote_deposit_state():
    b = base_book()
    b, q = run(b, create_quote, {"client_id": "c1", "date": "2026-10-01", "lines": [line("a", 50000)],
                                 "deposit": 10000})
    assert q["number"] == "Q-0001"
    assert q["valid_until"] == "2026-10-31"
    b, _ = run(b, record_payment, {"quote_id": q["id"], "date": "2026-10-02", "amount": 2500}, "2026-10-02")
    s = quote_state(b, q)
    assert (s["deposit_paid"], s["deposit_due"]) == (2500, 7500)
    tx = Tx(b)
    assert tx.next_number("quote") == "Q-0002"
