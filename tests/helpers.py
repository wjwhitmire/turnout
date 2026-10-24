"""Small builders for tests."""

from fieldservice.book import Tx
from fieldservice.schema import blank_book


def line(lid, rate, qty=1000, **kw):
    r = {"id": lid, "name": kw.pop("name", f"Line {lid}"), "qty_milli": qty, "rate": rate}
    r.update(kw)
    return r


def base_book():
    """A business with two clients, a property each, two crew members and settings."""
    b = blank_book("b1", "Test Co", "2026-01-01")
    tx = Tx(b)
    s = dict(b["settings"])
    s.update({"business_name": "Test Co", "phone": "(555) 010-0000", "email": "office@example.com",
              "tax_rate_milli": 8250, "terms_days": 15, "home_lat_e6": 30000000, "home_lon_e6": -95000000})
    tx.set_settings(s)
    tx.create("clients", {"id": "c1", "name": "Ann Example", "email": "ann@example.com", "phone": "(555) 010-0001"})
    tx.create("clients", {"id": "c2", "name": "Bob Sample", "phone": "(555) 010-0002", "prefer": "text"})
    tx.create("properties", {"id": "p1", "client_id": "c1", "street": "1 Example St", "city": "Town", "state": "TX",
                             "zip": "77000", "lat_e6": 30010000, "lon_e6": -95010000})
    tx.create("properties", {"id": "p2", "client_id": "c2", "street": "2 Sample Rd", "lat_e6": 30020000,
                             "lon_e6": -94990000})
    tx.create("crew", {"id": "m1", "name": "Crew One", "cost_rate": 3000, "bill_rate": 6000})
    tx.create("crew", {"id": "m2", "name": "Crew Two", "cost_rate": 2400, "weekly_minutes": 1200})
    return tx.book


def run(book, fn, *args):
    tx = Tx(book)
    r = fn(tx, *args)
    return tx.book, r
