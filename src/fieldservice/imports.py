"""Client list import from CSV: a client list exported from another field service or
accounting program, or a spreadsheet.

The header row is found by its column names (even below title rows); columns are matched by
name, never by position, and unknown columns are ignored. A row with a street address also
makes a property. A client whose name and email match one already on file is skipped and
reported. Every problem names its line. Nothing changes unless the whole file imports.
"""

from __future__ import annotations

from .book import Tx
from .util import ServiceError, fail, lower, parse_csv, squash

COLUMNS = {
    "name": ("name", "client", "client name", "customer", "customer name", "display name", "full name", "contact name"),
    "first": ("first name", "first", "given name"),
    "last": ("last name", "last", "surname", "family name"),
    "company": ("company", "company name", "business", "business name"),
    "email": ("email", "e-mail", "email address", "primary email"),
    "phone": ("phone", "phone number", "mobile", "mobile phone", "cell", "main phone", "primary phone"),
    "street": ("street", "address", "street 1", "street1", "address 1", "address line 1", "service street",
               "property address", "billing street"),
    "street2": ("street 2", "street2", "address 2", "address line 2"),
    "city": ("city", "town", "service city", "billing city"),
    "state": ("state", "province", "region", "service state", "billing state"),
    "zip": ("zip", "zip code", "postal code", "postcode", "service zip", "billing zip"),
    "notes": ("notes", "note", "comments"),
    "tags": ("tags", "tag", "labels"),
}


def _hk(s: str) -> str:
    return squash(lower(s)).rstrip(":").strip("*")


def import_clients_csv(book: dict, text, today: str) -> list:
    rows = parse_csv(text)["rows"]
    hi = -1
    cols = {}
    for i, r in enumerate(rows[:30]):
        c = {}
        for j, cell in enumerate(r["cells"]):
            k = _hk(cell)
            for role, names in COLUMNS.items():
                if role not in c and k in names:
                    c[role] = j
                    break
        if "name" in c or "first" in c or "last" in c or "company" in c:
            hi, cols = i, c
            break
    if hi < 0:
        fail("bad_csv", "Could not find the header row. The file needs a name (or first and last name, or "
                        "company) column.")
    tx = Tx(book)
    have = set((lower(c["name"]), lower(c["email"])) for c in book["clients"])
    created = 0
    props = 0
    skipped = []

    def cell(r, role):
        j = cols.get(role)
        return squash(r["cells"][j]) if j is not None and j < len(r["cells"]) else ""

    for r in rows[hi + 1:]:
        n = r["line"]
        name = cell(r, "name") or squash(cell(r, "first") + " " + cell(r, "last")) or cell(r, "company")
        if not name:
            skipped.append(f"Line {n}: no name; skipped.")
            continue
        if lower(name).startswith("total"):
            continue
        key = (lower(name[:200]), lower(cell(r, "email")[:200]))
        if key in have:
            skipped.append(f"Line {n}: {name[:60]} is already a client; skipped.")
            continue
        have.add(key)
        try:
            c = tx.create("clients", {"name": name[:200], "company": cell(r, "company")[:200],
                                      "email": cell(r, "email")[:200], "phone": cell(r, "phone")[:50],
                                      "notes": cell(r, "notes")[:2000], "tags": cell(r, "tags")[:200],
                                      "prefer": "email" if cell(r, "email") or not cell(r, "phone") else "text",
                                      "created": today})
            created += 1
            street = squash(cell(r, "street") + " " + cell(r, "street2"))
            if street:
                tx.create("properties", {"client_id": c["id"], "street": street[:200], "city": cell(r, "city")[:100],
                                         "state": cell(r, "state")[:50], "zip": cell(r, "zip")[:20]})
                props += 1
        except ServiceError as e:
            fail(e.code, f"Line {n}: {e.message}")
    return [tx.book, {"clients": created, "properties": props, "skipped": skipped}]
