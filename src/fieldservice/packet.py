"""Job packets: hand a crew member their visits as a file, take the file back with times,
checklists, notes and photos, and merge it with a review of conflicts.

There is no server. The office exports a packet for one crew member and a date range; the
crew member opens it in this same app on their own phone (Crew view), works through the
visits, and sends the returned packet back by any means (message, email, shared folder).

Merge is three-way per field. The packet carries each visit as it was when exported
(base); the office copy may have changed since (office); the crew sends theirs (crew).
  crew == base              nothing to do
  office == base            the crew's value is taken
  office == crew            nothing to do
  otherwise                 a conflict the person resolves: keep office or take crew
Checklist items merge per item (done and note). Time entries and photos from the crew are
added; one already present (same crew member, visit, date, start and minutes; or same
photo name, size and time) is skipped, so merging a packet twice changes nothing.
Prices are not in the packet.
"""

from __future__ import annotations

import re

from .book import Tx
from .brand import PACKET_FORMAT, PACKET_VERSION
from .schema import check_field, check_record, FIELD_TABLES
from .util import ServiceError, clean_text, day_num, fail, is_int, parse_stamp, show

MERGE_FIELDS = ("status", "started_at", "finished_at", "notes")
CREW_STATUSES = ("scheduled", "in_progress", "completed")
DATA_URL = re.compile(r"data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}")
MAX_PHOTO_CHARS = 4 * 1024 * 1024
MAX_PACKET_PHOTOS = 60


def export_packet(book: dict, crew_id: str, frm: str, to: str, at: str) -> dict:
    tx = Tx(book)
    m = tx.need("crew", crew_id)
    if day_num(to) < day_num(frm) or day_num(to) - day_num(frm) > 62:
        fail("bad_range", "A packet covers 1 to 63 days.")
    parse_stamp(at, "exported at")
    vs = [v for v in book["visits"] if crew_id in v["crew_ids"] and frm <= v["date"] <= to
          and v["status"] in ("scheduled", "in_progress")]
    vs.sort(key=lambda v: (v["date"], v["route_seq"] if v["route_seq"] else 1000, v["start_time"] or "99:99", v["id"]))
    jobs = {}
    for v in vs:
        jobs[v["job_id"]] = tx.need("jobs", v["job_id"])
    cl = {}
    props = {}
    for j in jobs.values():
        c = tx.need("clients", j["client_id"])
        cl[c["id"]] = {"id": c["id"], "name": c["name"], "phone": c["phone"]}
        if j["property_id"]:
            p = tx.need("properties", j["property_id"])
            props[p["id"]] = {k: p[k] for k in ("id", "label", "street", "city", "state", "zip", "lat_e6", "lon_e6",
                                                 "access_notes")}
    s = book["settings"]
    pid = re.sub(r"[^A-Za-z0-9_-]", "", f"{crew_id}-{frm}-{at[:19]}")[:80]
    return {"format": PACKET_FORMAT, "version": PACKET_VERSION, "kind": "out", "packet_id": pid,
            "book_id": book["id"], "business": {"name": s["business_name"], "phone": s["phone"]},
            "crew": {"id": m["id"], "name": m["name"]}, "from": frm, "to": to, "exported_at": at, "returned_at": "",
            "jobs": [{"id": j["id"], "number": j["number"], "title": j["title"], "instructions": j["instructions"],
                      "client_id": j["client_id"], "property_id": j["property_id"]} for j in jobs.values()],
            "clients": list(cl.values()), "properties": list(props.values()),
            "base": [dict(v) for v in vs], "visits": [dict(v) for v in vs], "timesheets": [], "photos": []}


PACKET_KEYS = ("format", "version", "kind", "packet_id", "book_id", "business", "crew", "from", "to", "exported_at",
               "returned_at", "jobs", "clients", "properties", "base", "visits", "timesheets", "photos")


def read_packet(obj) -> dict:
    """Check a packet file (sent out or returned) and return a normalised copy."""
    if not isinstance(obj, dict) or obj.get("format") != PACKET_FORMAT:
        fail("bad_packet", "This is not a job packet file.")
    if not is_int(obj.get("version")) or obj["version"] < 1 or obj["version"] > PACKET_VERSION:
        fail("bad_packet", "This job packet was made by a different version of the program.")
    for k in sorted(obj.keys()):
        if k not in PACKET_KEYS:
            fail("bad_packet", f"packet: unknown field {k[:40]}.")
    if obj.get("kind") not in ("out", "return"):
        fail("bad_packet", "packet.kind: must be out or return.")
    out = {"format": PACKET_FORMAT, "version": obj["version"], "kind": obj["kind"]}
    out["packet_id"] = check_field({"t": "str", "max": 80, "req": True}, obj.get("packet_id"), "packet.packet_id")
    out["book_id"] = check_field({"t": "id"}, obj.get("book_id"), "packet.book_id")
    b = obj.get("business")
    if not isinstance(b, dict):
        fail("bad_packet", "packet.business: must be an object.")
    out["business"] = {"name": clean_text(b.get("name", ""), 200, "packet.business.name"),
                       "phone": clean_text(b.get("phone", ""), 50, "packet.business.phone")}
    c = obj.get("crew")
    if not isinstance(c, dict):
        fail("bad_packet", "packet.crew: must be an object.")
    out["crew"] = {"id": check_field({"t": "id"}, c.get("id"), "packet.crew.id"),
                   "name": clean_text(c.get("name", ""), 200, "packet.crew.name")}
    out["from"] = check_field({"t": "date", "opt": False}, obj.get("from"), "packet.from")
    out["to"] = check_field({"t": "date", "opt": False}, obj.get("to"), "packet.to")
    out["exported_at"] = check_field({"t": "stamp"}, obj.get("exported_at", ""), "packet.exported_at")
    out["returned_at"] = check_field({"t": "stamp"}, obj.get("returned_at", ""), "packet.returned_at")

    def lst(k, mx):
        v = obj.get(k, [])
        if not isinstance(v, list) or len(v) > mx:
            fail("bad_packet", f"packet.{k}: must be a list of at most {mx} entries.")
        return v

    out["jobs"] = []
    for i, j in enumerate(lst("jobs", 2000)):
        p = f"packet.jobs[{i}]"
        if not isinstance(j, dict):
            fail("bad_packet", f"{p}: must be an object.")
        out["jobs"].append({"id": check_field({"t": "id"}, j.get("id"), p + ".id"),
                            "number": clean_text(j.get("number", ""), 30, p + ".number"),
                            "title": clean_text(j.get("title", ""), 200, p + ".title"),
                            "instructions": clean_text(j.get("instructions", ""), 4000, p + ".instructions", True),
                            "client_id": check_field({"t": "id"}, j.get("client_id"), p + ".client_id"),
                            "property_id": j.get("property_id", "") if j.get("property_id", "") == "" else
                            check_field({"t": "id"}, j.get("property_id"), p + ".property_id")})
    out["clients"] = []
    for i, c in enumerate(lst("clients", 2000)):
        p = f"packet.clients[{i}]"
        if not isinstance(c, dict):
            fail("bad_packet", f"{p}: must be an object.")
        out["clients"].append({"id": check_field({"t": "id"}, c.get("id"), p + ".id"),
                               "name": clean_text(c.get("name", ""), 200, p + ".name"),
                               "phone": clean_text(c.get("phone", ""), 50, p + ".phone")})
    out["properties"] = []
    for i, x in enumerate(lst("properties", 2000)):
        p = f"packet.properties[{i}]"
        if not isinstance(x, dict):
            fail("bad_packet", f"{p}: must be an object.")
        rec = dict({k: x.get(k) for k in ("id", "label", "street", "city", "state", "zip", "lat_e6", "lon_e6",
                                          "access_notes") if k in x}, client_id="c")
        r = check_record("properties", rec, p)
        out["properties"].append({k: r[k] for k in ("id", "label", "street", "city", "state", "zip", "lat_e6",
                                                    "lon_e6", "access_notes")})
    out["base"] = [check_record("visits", v, f"packet.base[{i}]") for i, v in enumerate(lst("base", 2000))]
    out["visits"] = [check_record("visits", v, f"packet.visits[{i}]") for i, v in enumerate(lst("visits", 2000))]
    if [v["id"] for v in out["base"]] != [v["id"] for v in out["visits"]]:
        fail("bad_packet", "packet.visits: the visits do not match the ones that were sent out.")
    for i, (a, b) in enumerate(zip(out["base"], out["visits"])):
        for k in FIELD_TABLES["visits"]:
            if k in MERGE_FIELDS or k == "checklist":
                continue
            if a[k] != b[k]:
                fail("bad_packet", f"packet.visits[{i}].{k}: a crew packet cannot change this field.")
        if [c["id"] for c in a["checklist"]] != [c["id"] for c in b["checklist"]]:
            fail("bad_packet", f"packet.visits[{i}].checklist: the checklist items do not match.")
        if b["status"] not in CREW_STATUSES:
            fail("bad_packet", f"packet.visits[{i}].status: must be one of {', '.join(CREW_STATUSES)}.")
    # Everything the crew view shows must be in the packet, and every visit must be the crew member's.
    job_ids = set(j["id"] for j in out["jobs"])
    client_ids = set(c["id"] for c in out["clients"])
    prop_ids = set(x["id"] for x in out["properties"])
    visit_ids = set(v["id"] for v in out["visits"])
    for i, j in enumerate(out["jobs"]):
        if j["client_id"] not in client_ids:
            fail("bad_packet", f"packet.jobs[{i}].client_id: the client is not in the packet.")
        if j["property_id"] and j["property_id"] not in prop_ids:
            fail("bad_packet", f"packet.jobs[{i}].property_id: the property is not in the packet.")
    for i, v in enumerate(out["base"]):
        if v["job_id"] not in job_ids:
            fail("bad_packet", f"packet.visits[{i}].job_id: the job is not in the packet.")
        if out["crew"]["id"] not in v["crew_ids"]:
            fail("bad_packet", f"packet.visits[{i}].crew_ids: the visit is not the packet's crew member's.")
    out["timesheets"] = []
    for i, t in enumerate(lst("timesheets", 2000)):
        if not isinstance(t, dict):
            fail("bad_packet", f"packet.timesheets[{i}]: must be an object.")
        r = check_record("timesheets", t, f"packet.timesheets[{i}]")
        if r["crew_id"] != out["crew"]["id"]:
            fail("bad_packet", f"packet.timesheets[{i}].crew_id: must be the packet's crew member.")
        if r["visit_id"] and r["visit_id"] not in visit_ids:
            fail("bad_packet", f"packet.timesheets[{i}].visit_id: the visit is not in the packet.")
        if r["job_id"] and r["job_id"] not in job_ids:
            fail("bad_packet", f"packet.timesheets[{i}].job_id: the job is not in the packet.")
        out["timesheets"].append(r)
    out["photos"] = []
    total = 0
    for i, f in enumerate(lst("photos", MAX_PACKET_PHOTOS)):
        p = f"packet.photos[{i}]"
        if not isinstance(f, dict):
            fail("bad_packet", f"{p}: must be an object.")
        data = f.get("data", "")
        meta = {k: v for k, v in f.items() if k != "data"}
        r = check_record("photos", meta, p)
        if r["job_id"] not in job_ids or (r["visit_id"] and r["visit_id"] not in visit_ids):
            fail("bad_packet", f"{p}: the photo's job or visit is not in the packet.")
        if r["crew_id"] and r["crew_id"] != out["crew"]["id"]:
            fail("bad_packet", f"{p}.crew_id: must be the packet's crew member.")
        if data != "":
            if not isinstance(data, str) or len(data) > MAX_PHOTO_CHARS or not DATA_URL.fullmatch(data):
                fail("bad_packet", f"{p}.data: must be a JPEG, PNG or WebP image of at most 3 MB.")
            if data[11:data.index(";")] != r["mime"][6:]:
                fail("bad_packet", f"{p}.data: the image type does not match the photo's type.")
            total += len(data)
        r["data"] = data
        out["photos"].append(r)
    if total > 48 * 1024 * 1024:
        fail("bad_packet", "packet.photos: the photos are larger than 48 MB in total.")
    return out


def crew_update(packet: dict, visit_id: str, fields: dict) -> dict:
    """The crew view's edit: change status, stamps, notes or checklist of one visit in a
    packet. Returns the new packet."""
    p = dict(packet)
    vs = []
    found = False
    for v in p["visits"]:
        if v["id"] == visit_id:
            found = True
            nv = dict(v)
            for k in sorted(fields.keys()):
                if k not in MERGE_FIELDS and k != "checklist":
                    fail("bad_field", f"The crew view cannot change {k[:40]}.")
                nv[k] = fields[k]
            nv = check_record("visits", nv, "visit")
            if nv["status"] not in CREW_STATUSES:
                fail("bad_field", f"status: must be one of {', '.join(CREW_STATUSES)}.")
            v = nv
        vs.append(v)
    if not found:
        fail("not_found", f"There is no visit {show(visit_id)} in this packet.")
    p["visits"] = vs
    return p


def _flat(v: dict) -> dict:
    out = {f: v[f] for f in MERGE_FIELDS}
    for c in v["checklist"]:
        out[f"checklist:{c['id']}:done"] = c["done"]
        out[f"checklist:{c['id']}:note"] = c["note"]
    return out


def _ts_key(t):
    return (t["crew_id"], t["visit_id"], t["date"], t["start_time"], t["minutes"], t["kind"])


def _photo_key(f):
    return (f["visit_id"], f["name"], f["size"], f["taken_at"])


def merge_preview(book: dict, packet: dict) -> dict:
    """What merging a returned packet would do: {auto, conflicts, timesheets, photos,
    skipped}."""
    pk = read_packet(packet)
    if pk["kind"] != "return":
        fail("bad_packet", "This packet has not been sent back by the crew yet.")
    if pk["book_id"] != book["id"]:
        fail("bad_packet", "This packet belongs to another business file.")
    cur = {v["id"]: v for v in book["visits"]}
    auto = []
    conflicts = []
    skipped = []
    for b, c in zip(pk["base"], pk["visits"]):
        o = cur.get(b["id"])
        if o is None:
            if _flat(b) != _flat(c):
                skipped.append(f"Visit {b['id']} on {b['date']} was deleted in the office; the crew's changes to it "
                               f"were not merged.")
            continue
        if pk["crew"]["id"] not in o["crew_ids"]:
            if _flat(b) != _flat(c):
                skipped.append(f"Visit {b['id']} on {b['date']} is no longer assigned to {pk['crew']['name']}; the "
                               f"crew's changes to it were not merged.")
            continue
        fb, fo, fc = _flat(b), _flat(o), _flat(c)
        for k in fc:
            if k not in fo:
                skipped.append(f"Visit {b['id']}: checklist item {k.split(':')[1]} was removed in the office.")
                continue
            if fc[k] == fb[k] or fo[k] == fc[k]:
                continue
            if fo[k] == fb[k]:
                auto.append({"visit_id": b["id"], "field": k, "value": fc[k]})
            else:
                conflicts.append({"visit_id": b["id"], "field": k, "base": fb[k], "office": fo[k], "crew": fc[k]})
    have = set(_ts_key(t) for t in book["timesheets"])
    ts = []
    for t in pk["timesheets"]:
        if t["crew_id"] not in {m["id"] for m in book["crew"]}:
            skipped.append(f"A time entry for crew member {t['crew_id']} was skipped: not in this business file.")
            continue
        if t["visit_id"] and t["visit_id"] not in cur:
            skipped.append(f"A time entry on {t['date']} was skipped: its visit was deleted in the office.")
            continue
        if _ts_key(t) in have:
            continue
        have.add(_ts_key(t))
        ts.append(t)
    ph = []
    seen = set(_photo_key(f) for f in book["photos"])
    for f in pk["photos"]:
        if f["visit_id"] and f["visit_id"] not in cur:
            skipped.append(f"Photo {f['name']} was skipped: its visit was deleted in the office.")
            continue
        if _photo_key(f) in seen:
            continue
        seen.add(_photo_key(f))
        ph.append({k: v for k, v in f.items() if k != "data"})
    return {"auto": auto, "conflicts": conflicts, "timesheets": ts, "photos": ph, "skipped": skipped}


def _set(v: dict, field: str, value):
    if field.startswith("checklist:"):
        _, cid, part = field.split(":")
        v["checklist"] = [dict(c, **{part: value}) if c["id"] == cid else c for c in v["checklist"]]
    else:
        v[field] = value


def apply_packet(book: dict, packet: dict, resolutions: dict) -> list:
    """Merge a returned packet. resolutions maps "visit_id|field" to "office" or "crew" for
    every conflict. Returns [new_book, {applied, timesheets, photos, photo_ids, skipped}]
    where photo_ids maps each packet photo id to its new id."""
    pv = merge_preview(book, packet)
    if not isinstance(resolutions, dict):
        fail("bad_field", "resolutions: must be an object.")
    pick = []
    for c in pv["conflicts"]:
        k = f"{c['visit_id']}|{c['field']}"
        r = resolutions.get(k)
        if r not in ("office", "crew"):
            fail("unresolved", f"Choose office or crew for {c['field']} on visit {c['visit_id']}.")
        if r == "crew":
            pick.append({"visit_id": c["visit_id"], "field": c["field"], "value": c["crew"]})
    tx = Tx(book)
    changes = {}
    for a in pv["auto"] + pick:
        v = changes.get(a["visit_id"]) or dict(tx.need("visits", a["visit_id"]))
        _set(v, a["field"], a["value"])
        changes[a["visit_id"]] = v
    for vid in sorted(changes.keys()):
        try:
            tx.update("visits", changes[vid])
        except ServiceError as e:
            fail(e.code, f"Visit {vid}: {e.message}")
    for t in pv["timesheets"]:
        rec = dict(t)
        rec.pop("id")
        rec["source"] = "packet"
        tx.create("timesheets", rec)
    ids = {}
    for f in pv["photos"]:
        rec = dict(f)
        old = rec.pop("id")
        r = tx.create("photos", rec)
        ids[old] = r["id"]
    return [tx.book, {"applied": len(pv["auto"]) + len(pick), "timesheets": len(pv["timesheets"]),
                      "photos": len(pv["photos"]), "photo_ids": ids, "skipped": pv["skipped"]}]


def return_packet(packet: dict, timesheets: list, photos: list, at: str) -> dict:
    """The crew view's Send back: the packet marked returned with the crew's time entries and
    photos."""
    p = dict(packet, kind="return", returned_at=at, timesheets=timesheets, photos=photos)
    return read_packet(p)
