import re
import sys
from pathlib import Path

import pytest

from fieldservice.book import apply
from fieldservice.example import TODAY, build_example
from fieldservice.export import (LIST_KINDS, client_page, crossfoot_customers_csv, crossfoot_iif, customer_names,
                                 lines_csv, list_csv, report_csv)
from fieldservice.imports import import_clients_csv
from fieldservice.money import doc_totals
from fieldservice.paylinks import check_link, payment_option
from fieldservice.qr import qr_matrix, qr_svg
from fieldservice.reports import (REPORTS, aging, crew_hours, job_profitability, jobs_by_status, quote_conversion,
                                  revenue_by_month)
from fieldservice.util import ServiceError, parse_csv
from fieldservice.workflow import create_invoice, send_invoice

from helpers import base_book, line, run

EX = build_example()


def test_every_list_exports_and_parses_back():
    for k in LIST_KINDS:
        text = list_csv(EX, k, TODAY)
        rows = parse_csv(text)["rows"]
        assert len(rows) == len(EX[k]) + 1, k
        assert len(set(len(r["cells"]) for r in rows)) == 1, k
    for k in ("quotes", "jobs", "invoices"):
        rows = parse_csv(lines_csv(EX, k))["rows"]
        assert len(rows) == 1 + sum(len(d["lines"]) for d in EX[k])


def test_formula_guard_on_hostile_names():
    b = base_book()
    b = apply(b, {"action": "update", "kind": "clients", "record": dict(b["clients"][0], name="=HYPERLINK(\"x\")",
                                                                        notes="+1 555", tags="@SUM(1)")})
    text = list_csv(b, "clients", TODAY)
    assert "'=HYPERLINK" in text and "'+1 555" in text and "'@SUM" in text


def test_report_csvs():
    data = {"revenue_by_month": revenue_by_month(EX, "2026-07-01", "2026-10-31"),
            "jobs_by_status": jobs_by_status(EX, TODAY), "quote_conversion": quote_conversion(EX, "2026-01-01", TODAY),
            "crew_hours": crew_hours(EX, "2026-10-01", "2026-10-21"), "job_profitability": job_profitability(EX, "", ""),
            "aging": aging(EX, TODAY)}
    assert set(data) == set(REPORTS)
    for name, d in data.items():
        rows = parse_csv(report_csv(name, d))["rows"]
        assert len(rows) >= 2, name
    with pytest.raises(ServiceError):
        report_csv("nope", {})


def test_crossfoot_iif_balances_and_names_are_safe():
    text = crossfoot_iif(EX, "2026-07-01", TODAY)
    lines = text.split("\r\n")
    total = 0
    n = 0
    for ln in lines:
        c = ln.split("\t")
        if c[0] in ("TRNS", "SPL"):
            total += int(c[6].replace(".", "").replace("-", "")) * (-1 if c[6].startswith("-") else 1)
            n += 1
        if c[0] == "ENDTRNS":
            assert total == 0
    assert n > 50
    b = base_book()
    b = apply(b, {"action": "update", "kind": "clients", "record": dict(b["clients"][0], name="Smith: Pool\tCo")})
    b = apply(b, {"action": "update", "kind": "clients", "record": dict(b["clients"][1], name="smith- pool co")})
    names = customer_names(b)
    assert names["c1"] == "Smith- Pool Co" and names["c2"] == "smith- pool co (c2)"
    assert "\t" not in crossfoot_customers_csv(b).split("\r\n")[1]


def _crossfoot():
    p = Path(__file__).resolve().parents[2] / "backoffice" / "src"
    if not p.exists():
        return None
    sys.path.insert(0, str(p))
    try:
        import crossfoot.book  # noqa: F401
        import crossfoot.iif  # noqa: F401
        import crossfoot.imports  # noqa: F401
        import crossfoot.reports  # noqa: F401
        return True
    except Exception:  # noqa: BLE001 - a missing or half-edited copy of Crossfoot means skip
        return None


@pytest.mark.skipif(_crossfoot() is None, reason="Crossfoot source is not next to this repository")
def test_crossfoot_imports_the_file_and_ties_out():
    try:
        _crossfoot_tie_out()
    except ImportError as e:
        pytest.skip(f"the Crossfoot copy next to this repository is incomplete: {e}")


def _crossfoot_tie_out():
    from crossfoot.book import new_company
    from crossfoot.iif import import_iif
    from crossfoot.imports import import_list_csv
    from crossfoot.reports import aging as cf_aging, check_invariants, profit_and_loss
    b = new_company("co", "Test", "2026-01-01T00:00:00Z", template="service")
    r = import_iif(b, crossfoot_iif(EX, "2026-01-01", TODAY), "2026-10-22T00:00:00Z")
    assert r["counts"]["journal_entries"] == 0
    bk = r["book"]
    assert check_invariants(bk, "2026-01-01", "2026-12-31", "accrual") == []
    revenue = sum(doc_totals(i)["revenue"] for i in EX["invoices"] if i["status"] == "sent")
    assert profit_and_loss(bk, "2026-01-01", "2026-12-31", "accrual")["net_income"] == [revenue]
    # the receivable agrees in total (Crossfoot holds the payments unapplied, so its buckets differ)
    assert cf_aging(bk, "ar", TODAY)["totals"]["total"] == aging(EX, TODAY)["total"]["total"]
    r2 = import_list_csv(new_company("c2", "T", "2026-01-01T00:00:00Z"), "customer", crossfoot_customers_csv(EX),
                         "2026-10-22T00:00:00Z")
    assert r2["created"] == len(EX["clients"])


def test_client_page_is_escaped_and_scriptless():
    b = base_book()
    b = apply(b, {"action": "update", "kind": "clients", "record": dict(
        b["clients"][0], name="<script>alert(1)</script>", company="\"><img src=x onerror=alert(1)>")})
    s = dict(b["settings"], payment_links=[{"kind": "stripe", "label": "Card", "value": "https://buy.stripe.com/abc"},
                                           {"kind": "zelle", "label": "", "value": "pay@example.com"}])
    b = dict(b, settings=s)
    b, inv = run(b, create_invoice, {"client_id": "c1", "property_id": "p1", "date": "2026-10-01",
                                     "subject": "<b>Spring</b>", "lines": [line("a", 12345, name="Mulch & <edge>",
                                                                                description="line1\nline2")]})
    b, _ = run(b, send_invoice, inv["id"], "2026-10-01")
    html = client_page(b, "invoices", inv["id"], "2026-10-20")
    assert "<script" not in html.lower()
    assert "&lt;script&gt;" in html and "Mulch &amp; &lt;edge&gt;" in html and "line1<br>line2" in html
    assert "Content-Security-Policy" in html and "default-src 'none'" in html
    assert "https://buy.stripe.com/abc?client_reference_id=INV-0001" in html
    assert "Send with Zelle to pay@example.com" in html
    assert "<svg" in html and "Past due" in html
    assert not re.search(r"<[^>]*\son[a-z]+=", html)
    with pytest.raises(ServiceError):
        client_page(b, "jobs", "x", TODAY)


def test_quote_page_for_example():
    q = [x for x in EX["quotes"] if x["status"] == "sent"][0]
    html = client_page(EX, "quotes", q["id"], TODAY)
    assert "Awaiting your response" in html and "To approve" in html


def test_payment_links():
    o = payment_option({"kind": "paypal", "label": "", "value": "@shop"}, 12345, "INV-1")
    assert o == {"label": "PayPal", "kind": "paypal", "url": "https://paypal.me/shop/123.45USD",
                 "text": "https://paypal.me/shop/123.45USD"}
    o = payment_option({"kind": "venmo", "label": "V", "value": "shop-1"}, 500, "INV 1/2")
    assert o["url"] == "https://venmo.com/shop-1?txn=pay&amount=5.00&note=INV%201%2F2"
    assert payment_option({"kind": "cashapp", "label": "", "value": "$shop"}, 100, "x")["url"] == \
        "https://cash.app/$shop/1.00"
    assert payment_option({"kind": "ach", "label": "", "value": "Routing 000 Account 000."}, 1, "INV-9")["text"] == \
        "Routing 000 Account 000. Reference: INV-9."
    for bad in ({"kind": "stripe", "label": "", "value": "http://buy.stripe.com/x"},
                {"kind": "stripe", "label": "", "value": "https://evil.example/x"},
                {"kind": "square", "label": "", "value": "https://square.link/u/a b"},
                {"kind": "paypal", "label": "", "value": "a/b"},
                {"kind": "other", "label": "", "value": "https://x.example/\"><script>"},
                {"kind": "venmo", "label": "", "value": "javascript:alert(1)"}):
        with pytest.raises(ServiceError):
            check_link(bad)
    assert payment_option({"kind": "other", "label": "", "value": "javascript:alert(1)"}, 1, "x")["url"] == ""


def test_qr_codes_decode():
    cv2 = pytest.importorskip("cv2")
    np = pytest.importorskip("numpy")
    det = cv2.QRCodeDetector()
    for text in ("https://buy.stripe.com/test_example?client_reference_id=INV-0001",
                 "https://venmo.com/x?txn=pay&amount=12.34&note=INV-0002", "A" * 300, "café ✓"):
        q = qr_matrix(text)
        m = np.array([[0 if c == "1" else 255 for c in r] for r in q["rows"]], dtype=np.uint8)
        img = cv2.resize(np.pad(m, 4, constant_values=255), None, fx=8, fy=8, interpolation=cv2.INTER_NEAREST)
        got, _, _ = det.detectAndDecode(img)
        assert got == text, (text, q["version"])


def test_qr_known_sizes():
    assert qr_matrix("hello")["version"] == 1
    assert qr_matrix("x" * 14)["version"] == 1        # 14 bytes is version 1 at level M
    assert qr_matrix("x" * 15)["version"] == 2
    assert qr_matrix("x" * 2331)["version"] == 40
    with pytest.raises(ServiceError):
        qr_matrix("x" * 2332)
    with pytest.raises(ServiceError):
        qr_matrix("")
    assert qr_svg("hi").startswith("<svg")


def test_client_import_csv():
    b = base_book()
    text = ("Client list export\n\nFirst Name,Last Name,Email,Mobile,Street 1,City,State,Zip Code,Notes,Extra\n"
            "Cara,Example,cara@example.com,(555) 010-0300,9 Elm,Town,TX,77000,=cmd(),ignored\n"
            ",,,,,,,,,\n"
            "Ann Example,,ann@example.com,,,,,,,\n"
            ",,nobody@example.com,,,,,,,\n")
    b2, res = import_clients_csv(b, text, "2026-10-22")
    assert res["clients"] == 1 and res["properties"] == 1
    assert any("already a client" in s for s in res["skipped"]) and any("no name" in s for s in res["skipped"])
    c = b2["clients"][-1]
    assert (c["name"], c["notes"], c["prefer"]) == ("Cara Example", "=cmd()", "email")
    with pytest.raises(ServiceError, match="header row"):
        import_clients_csv(b, "a,b\n1,2\n", "2026-10-22")
    b3, _ = import_clients_csv(b, "Name,Email\n" + "N,\"" + "x" * 300 + "\"\n", "2026-10-22")
    assert len(b3["clients"][-1]["email"]) == 200
