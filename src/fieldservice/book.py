"""Changing a book: create, update and delete with validation, id allocation, numbering.

A book is never changed in place. A Tx (transaction) copies each list it touches on first
write, validates every record it writes, checks that references resolve, and records each
change as {kind, id, before, after}. Workflow and automation code runs inside a Tx so the
automation log can show and undo exactly what changed.
"""

from __future__ import annotations

from .schema import KINDS, LABELS, ID_RE, FIELD_TABLES, check_record, check_record_refs, referrers
from .util import fail, show


class Tx:
    def __init__(self, book: dict):
        self.book = dict(book)
        self.copied = set()
        self.changes = []
        self._ids = None
        self._pos = {}

    # ---------------------------------------------------------------- lookups
    def ids(self):
        if self._ids is None:
            self._ids = {}
            for k in KINDS:
                for r in self.book[k]:
                    self._ids[r["id"]] = k
        return self._ids

    def pos(self, kind):
        if kind not in self._pos:
            self._pos[kind] = {r["id"]: i for i, r in enumerate(self.book[kind])}
        return self._pos[kind]

    def get(self, kind, rid):
        i = self.pos(kind).get(rid)
        return None if i is None else self.book[kind][i]

    def need(self, kind, rid):
        r = self.get(kind, rid)
        if r is None:
            fail("not_found", f"There is no {LABELS[kind]} {rid}.")
        return r

    def ix(self):
        """A read view {kind: {id: record}} used by the reference checks."""
        return _View(self)

    def snapshot(self):
        """A private copy of the lists and the change count, for restore()."""
        return {k: (list(v) if isinstance(v, list) else v) for k, v in self.book.items()}, len(self.changes)

    def restore(self, snap):
        """Put the Tx back to a snapshot, dropping every change made since."""
        book, n = snap
        self.book = {k: (list(v) if isinstance(v, list) else v) for k, v in book.items()}
        self.copied = set(k for k, v in self.book.items() if isinstance(v, list))
        del self.changes[n:]
        self._ids = None
        self._pos = {}

    def _own(self, kind):
        if kind not in self.copied:
            self.book[kind] = list(self.book[kind])
            self.copied.add(kind)

    # ---------------------------------------------------------------- ids and numbers
    def new_id(self, prefix: str) -> str:
        ids = self.ids()
        n = self.book["seq"]
        while f"{prefix}{n}" in ids:
            n += 1
        self.book["seq"] = n + 1
        return f"{prefix}{n}"

    def next_number(self, which: str) -> str:
        s = dict(self.book["settings"])
        n = s["next_" + which]
        s["next_" + which] = n + 1
        self.book["settings"] = s
        return f"{s[which + '_prefix']}{n:04d}"

    def set_settings(self, rec: dict):
        self.book["settings"] = check_record("settings", rec, "settings")

    # ---------------------------------------------------------------- writes
    def create(self, kind: str, rec: dict) -> dict:
        if kind not in KINDS:
            fail("bad_kind", f"Unknown record kind {show(kind)}.")
        if not isinstance(rec, dict):
            fail("bad_field", f"{LABELS[kind]}: must be an object.")
        rec = dict(rec)
        if "id" not in rec or rec["id"] == "":
            rec["id"] = self.new_id(PREFIX[kind])
        r = check_record(kind, rec, LABELS[kind])
        ids = self.ids()
        if r["id"] in ids:
            fail("duplicate_id", f"The id {r['id']} is already used by a {LABELS[ids[r['id']]]}.")
        check_record_refs(self.ix(), kind, r)
        self._own(kind)
        self.book[kind].append(r)
        ids[r["id"]] = kind
        self.pos(kind)[r["id"]] = len(self.book[kind]) - 1
        self.changes.append({"kind": kind, "id": r["id"], "before": None, "after": r})
        return r

    def update(self, kind: str, rec: dict) -> dict:
        if kind not in KINDS:
            fail("bad_kind", f"Unknown record kind {show(kind)}.")
        rid = rec.get("id") if isinstance(rec, dict) else None
        i = self.pos(kind).get(rid) if isinstance(rid, str) else None
        if i is None:
            fail("not_found", f"There is no {LABELS[kind]} {show(rid)}.")
        before = self.book[kind][i]
        r = check_record(kind, rec, LABELS[kind])
        check_record_refs(self.ix(), kind, r)
        self._own(kind)
        self.book[kind][i] = r
        self.changes.append({"kind": kind, "id": r["id"], "before": before, "after": r})
        return r

    def patch(self, kind: str, rid: str, fields: dict) -> dict:
        r = dict(self.need(kind, rid))
        r.update(fields)
        return self.update(kind, r)

    def delete(self, kind: str, rid: str, check: bool = True) -> None:
        r = self.need(kind, rid)
        if check:
            for k, fname, many in referrers(kind):
                n = 0
                for x in self.book[k]:
                    if (rid in x[fname]) if many else (x[fname] == rid):
                        n += 1
                if n:
                    fail("in_use", f"This {LABELS[kind]} is used by {n} {LABELS[k]} record{'s' if n != 1 else ''}. "
                                   f"Remove or change those first.")
            for k in ("quotes", "jobs", "invoices"):
                for x in self.book[k]:
                    for ln in x["lines"]:
                        if kind == "items" and ln["item_id"] == rid:
                            fail("in_use", f"This product or service is on {LABELS[k]} {x['number'] or x['id']}. "
                                           f"Archive it instead.")
        self._own(kind)
        i = self.pos(kind)[rid]
        self.book[kind].pop(i)
        self._pos.pop(kind, None)
        self.ids().pop(rid, None)
        self.changes.append({"kind": kind, "id": rid, "before": r, "after": None})

    def put(self, kind: str, rec: dict) -> None:
        """Create or replace without the delete checks (used by undo and packet merge)."""
        if self.get(kind, rec["id"]) is None:
            self.create(kind, rec)
        else:
            self.update(kind, rec)


class _View:
    """dict-like {kind: {id: record}} over a Tx, without building full indexes."""

    def __init__(self, tx):
        self.tx = tx

    def __getitem__(self, kind):
        return _KindView(self.tx, kind)


class _KindView:
    def __init__(self, tx, kind):
        self.tx = tx
        self.kind = kind

    def __contains__(self, rid):
        return self.tx.get(self.kind, rid) is not None

    def __getitem__(self, rid):
        return self.tx.need(self.kind, rid)


PREFIX = {"clients": "c", "properties": "p", "crew": "m", "items": "i", "requests": "r", "quotes": "q", "jobs": "j",
          "visits": "v", "timesheets": "t", "expenses": "x", "photos": "f", "invoices": "n", "payments": "y",
          "reminders": "w"}


def apply(book: dict, op: dict) -> dict:
    """One plain change: {"action": "create"|"update"|"delete", "kind", "record"} (delete
    takes "id"). Returns the new book."""
    if not isinstance(op, dict):
        fail("bad_op", "The change must be an object.")
    tx = Tx(book)
    a = op.get("action")
    kind = op.get("kind")
    if kind not in KINDS:
        fail("bad_kind", f"Unknown record kind {show(kind)}.")
    if a == "create":
        tx.create(kind, op.get("record"))
    elif a == "update":
        tx.update(kind, op.get("record"))
    elif a == "delete":
        rid = op.get("id")
        if not isinstance(rid, str) or not ID_RE.fullmatch(rid):
            fail("bad_op", "delete: needs the record id.")
        tx.delete(kind, rid)
    else:
        fail("bad_op", "action: must be one of create, update, delete.")
    return tx.book


def apply_all(book: dict, ops: list) -> dict:
    for op in ops:
        book = apply(book, op)
    return book


def update_settings(book: dict, fields: dict) -> dict:
    if not isinstance(fields, dict):
        fail("bad_op", "settings: must be an object.")
    tx = Tx(book)
    s = dict(book["settings"])
    for k in sorted(fields.keys()):
        if k not in FIELD_TABLES["settings"]:
            fail("bad_field", f"settings: unknown field {k[:40]}.")
        s[k] = fields[k]
    tx.set_settings(s)
    return tx.book
