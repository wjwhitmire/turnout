"""The example business: "Example: Live Oak Lawn and Irrigation".

Everything here is invented: the business, its clients, addresses, coordinates, phone
numbers (555-01xx), email addresses (example.com), prices and history. It is built by
replaying plain office steps and the automation rules day by day from July 1 to October 22,
2026, through the same functions a person uses, so every screen and report has content.
"""

from __future__ import annotations

from .automation import run_automations
from .book import Tx, apply, update_settings
from .money import invoice_state
from .schema import blank_book
from .util import add_days, day_num, parse_time
from .workflow import (add_time, approve_quote, create_job, create_quote, finish_visit, quote_from_request,
                       record_payment, request_changes, schedule_visit, send_invoice, send_quote, start_visit,
                       check_item, close_job)

START = "2026-07-01"
TODAY = "2026-10-22"
OFF = "-05:00"


class Rand:
    """A small fixed linear congruential generator, so the example is the same every time."""

    def __init__(self, seed):
        self.s = seed

    def next(self, n):
        self.s = (self.s * 1103515245 + 12345) % 2147483648
        return (self.s // 65536) % n


def stamp(date, minutes):
    return f"{date}T{minutes // 60:02d}:{minutes % 60:02d}:00{OFF}"


def L(lid, item, qty_milli, **kw):
    rec = {"id": lid, "item_id": item["id"], "name": item["name"], "description": item["description"],
           "kind": item["kind"], "qty_milli": qty_milli, "rate": item["rate"], "cost": item["cost"],
           "taxable": item["taxable"]}
    rec.update(kw)
    return rec


def build_example() -> dict:
    b = blank_book("example", "Example: Live Oak Lawn and Irrigation", START)
    b["example"] = True
    b = update_settings(b, {
        "business_name": "Example: Live Oak Lawn and Irrigation", "address": "1200 Example Loop\nSample City, TX 77000",
        "phone": "(555) 010-0100", "email": "office@example.com", "website": "https://example.com",
        "license": "Irrigator license EX-0000 (example)", "home_lat_e6": 30310000, "home_lon_e6": -95460000,
        "tax_rate_milli": 8250, "tax_mode": "document", "terms_days": 15, "quote_followup_days": 4,
        "visit_reminder_days": 1, "visit_horizon_days": 45,
        "payment_links": [{"kind": "stripe", "label": "Pay by card", "value": "https://buy.stripe.com/test_example"},
                          {"kind": "venmo", "label": "Venmo", "value": "Example-LiveOak"},
                          {"kind": "zelle", "label": "Zelle", "value": "office@example.com"}],
        "quote_message": "Thank you for the chance to quote this work. Prices include cleanup and haul-off.",
        "invoice_message": "Thank you for your business. Questions about this invoice? Call the office.",
    })
    tx = Tx(b)
    crew = [tx.create("crew", r) for r in (
        {"id": "m-dana", "name": "Dana Ruiz", "role": "Crew lead", "phone": "(555) 010-0111", "cost_rate": 2800,
         "bill_rate": 6500, "weekly_minutes": 2400},
        {"id": "m-avery", "name": "Avery Cole", "role": "Lawn technician", "phone": "(555) 010-0112",
         "cost_rate": 2100, "bill_rate": 5500, "weekly_minutes": 2400},
        {"id": "m-jordan", "name": "Jordan Pike", "role": "Irrigation technician", "phone": "(555) 010-0113",
         "cost_rate": 2600, "bill_rate": 8500, "weekly_minutes": 2400})]
    dana, avery, jordan = (c["id"] for c in crew)
    it = {}
    for r in (
            {"id": "i-mow", "name": "Weekly mowing", "description": "Mow, edge, trim and blow hard surfaces",
             "kind": "service", "unit": "visit", "rate": 6500, "cost": 0},
            {"id": "i-irr", "name": "Irrigation inspection", "description": "Run every zone, adjust heads, report",
             "kind": "service", "unit": "visit", "rate": 8500, "cost": 0},
            {"id": "i-head", "name": "Sprinkler head replacement", "description": "Rotor or spray head, installed",
             "kind": "material", "unit": "each", "rate": 1800, "cost": 600, "taxable": True},
            {"id": "i-mulch", "name": "Hardwood mulch, installed", "description": "Double-shredded, 3 inch depth",
             "kind": "material", "unit": "cu yd", "rate": 6500, "cost": 3200, "taxable": True},
            {"id": "i-trim", "name": "Shrub trimming", "description": "Hand and power shears, debris hauled",
             "kind": "service", "unit": "hour", "rate": 6000, "cost": 0},
            {"id": "i-drip", "name": "Drip line repair kit", "description": "Fittings, tubing and emitters",
             "kind": "material", "unit": "each", "rate": 4200, "cost": 1500, "taxable": True},
            {"id": "i-labor", "name": "Labor", "description": "General landscape labor", "kind": "service",
             "unit": "hour", "rate": 6500, "cost": 0},
            {"id": "i-sod", "name": "St. Augustine sod, installed", "description": "Pallet, about 450 sq ft",
             "kind": "material", "unit": "pallet", "rate": 42500, "cost": 21000, "taxable": True}):
        it[r["id"]] = tx.create("items", r)

    clients = {}
    data = [
        ("c-ortega", "Maria Ortega", "", "maria.ortega@example.com", "(555) 010-0201", "email",
         "418 Example Oak Dr", 30318200, -95471500),
        ("c-brooks", "Terrence Brooks", "", "t.brooks@example.com", "(555) 010-0202", "text",
         "77 Sample Creek Ct", 30296400, -95452200),
        ("c-nguyen", "Linh Nguyen", "", "linh.nguyen@example.com", "(555) 010-0203", "email",
         "2310 Example Pine Ln", 30325100, -95440800),
        ("c-hoa", "Cedar Point HOA (example)", "Cedar Point Homeowners Association", "board@example.com",
         "(555) 010-0204", "email", "1 Commons Way (entrance beds)", 30335900, -95482000),
        ("c-patel", "Ravi Patel", "", "ravi.patel@example.com", "(555) 010-0205", "email",
         "905 Sample Ridge Rd", 30289700, -95478300),
        ("c-fisher", "Grace Fisher", "", "", "(555) 010-0206", "text", "56 Example Hollow", 30301800, -95436600),
        ("c-dental", "Bright Smile Dental (example)", "Bright Smile Dental LLC", "frontdesk@example.com",
         "(555) 010-0207", "email", "300 Example Pkwy, Suite 2", 30312700, -95495400),
        ("c-young", "Marcus Young", "", "marcus.young@example.com", "", "email", "14 Sample Grove", 30342200,
         -95458800),
        ("c-alvarez", "Sofia Alvarez", "", "sofia.alvarez@example.com", "(555) 010-0209", "email",
         "632 Example Meadow Dr", 30279900, -95462500),
        ("c-kim", "Daniel Kim", "", "daniel.kim@example.com", "(555) 010-0210", "text", "88 Sample Bend",
         30306600, -95501900),
    ]
    props = {}
    for cid, name, comp, email, phone, prefer, street, lat, lon in data:
        clients[cid] = tx.create("clients", {"id": cid, "name": name, "company": comp, "email": email,
                                             "phone": phone, "prefer": prefer, "created": START})
        props[cid] = tx.create("properties", {"id": "p-" + cid[2:], "client_id": cid, "street": street,
                                              "city": "Sample City", "state": "TX", "zip": "77000", "lat_e6": lat,
                                              "lon_e6": lon,
                                              "access_notes": "Side gate code 0000 (example)." if cid == "c-patel"
                                              else ""})
    b = tx.book

    def run(fn, *args):
        nonlocal b
        t = Tx(b)
        r = fn(t, *args)
        b = t.book
        return r

    check = [{"id": "k1", "text": "Gate closed and latched"}, {"id": "k2", "text": "Clippings blown off drive"}]
    irr_check = [{"id": "k1", "text": "Controller set to season schedule"}, {"id": "k2", "text": "All zones run"},
                 {"id": "k3", "text": "Leaks or broken heads noted"}]
    weekly = lambda days, iv=1: {"freq": "weekly", "interval": iv, "days": days}

    # Recurring maintenance
    jobs = {}
    for key, cid, day, start, timing in (("mow-ortega", "c-ortega", 1, "10:30", "monthly"),
                                         ("mow-nguyen", "c-nguyen", 1, "09:15", "monthly"),
                                         ("mow-patel", "c-patel", 2, "08:00", "monthly"),
                                         ("mow-alvarez", "c-alvarez", 2, "09:30", "monthly"),
                                         ("mow-fisher", "c-fisher", 1, "08:00", "monthly"),
                                         ("mow-dental", "c-dental", 4, "07:30", "after_visit")):
        jobs[key] = run(create_job, {"client_id": cid, "property_id": props[cid]["id"], "title": "Weekly lawn care",
                                     "kind": "recurring", "rule": weekly([day]), "start_date": "2026-07-06",
                                     "start_time": start, "duration_min": 45, "crew_ids": [dana, avery],
                                     "lines": [L("l1", it["i-mow"], 1000)], "billing": "per_visit",
                                     "invoice_timing": timing, "checklist": check,
                                     "instructions": "Bag clippings in the back yard only."
                                     if cid == "c-nguyen" else ""}, START, START)
    jobs["mow-brooks"] = run(create_job, {"client_id": "c-brooks", "property_id": props["c-brooks"]["id"],
                                          "title": "Lawn care every other week", "kind": "recurring",
                                          "rule": weekly([3], 2), "start_date": "2026-07-08", "start_time": "10:30",
                                          "duration_min": 60, "crew_ids": [dana, avery],
                                          "lines": [L("l1", it["i-mow"], 1000, rate=8000)], "billing": "per_visit",
                                          "invoice_timing": "after_visit", "checklist": check}, START, START)
    jobs["irr-hoa"] = run(create_job, {"client_id": "c-hoa", "property_id": props["c-hoa"]["id"],
                                       "title": "Monthly irrigation check, common areas", "kind": "recurring",
                                       "rule": {"freq": "monthly", "month_mode": "nth", "nth": 2, "weekday": 3},
                                       "start_date": "2026-07-01", "start_time": "13:00", "duration_min": 120,
                                       "crew_ids": [jordan], "lines": [L("l1", it["i-irr"], 1000, rate=24000)],
                                       "billing": "fixed", "invoice_timing": "monthly", "checklist": irr_check},
                         START, START)
    jobs["irr-kim"] = run(create_job, {"client_id": "c-kim", "property_id": props["c-kim"]["id"],
                                       "title": "Irrigation check, last Friday of the month", "kind": "recurring",
                                       "rule": {"freq": "monthly", "month_mode": "nth", "nth": -1, "weekday": 5},
                                       "start_date": "2026-07-01", "start_time": "", "duration_min": 60,
                                       "crew_ids": [jordan], "lines": [L("l1", it["i-irr"], 1000)],
                                       "billing": "per_visit", "invoice_timing": "after_visit",
                                       "checklist": irr_check}, START, START)

    rnd = Rand(17)
    events = {}

    def on(date, fn):
        events.setdefault(date, []).append(fn)

    # One-off work from requests and quotes
    def e_mulch_request(d):
        nonlocal b
        b = apply(b, {"action": "create", "kind": "requests", "record": {
            "id": "r-mulch", "client_id": "c-ortega", "property_id": props["c-ortega"]["id"], "date": d,
            "title": "Mulch front beds", "details": "Front beds look thin. Wants a price for fresh mulch and "
                                                   "trimming the hollies.", "source": "Phone"}})
        q = run(quote_from_request, "r-mulch", d)
        q = dict(q, lines=[L("l1", it["i-mulch"], 6000), L("l2", it["i-trim"], 3000),
                           L("l3", it["i-head"], 4000, optional=True, selected=False,
                             description="Replace four worn spray heads in the front bed")], deposit=20000)
        b = apply(b, {"action": "update", "kind": "quotes", "record": q})
        run(send_quote, q["id"], d)
        events.setdefault("_q", {})["mulch"] = q["id"]
    on("2026-08-03", e_mulch_request)

    def e_mulch_approve(d):
        qid = events["_q"]["mulch"]
        run(approve_quote, qid, ["l3"], "Maria Ortega", d)
        run(record_payment, {"quote_id": qid, "date": d, "amount": 20000, "method": "card",
                             "reference": "Deposit"}, d)
    on("2026-08-06", e_mulch_approve)

    def e_mulch_schedule(d):
        j = [x for x in b["jobs"] if x["quote_id"] == events["_q"]["mulch"]][0]
        events["_q"]["mulch_job"] = j["id"]
        run(schedule_visit, j["id"], "2026-08-12", "08:00", 360, [dana, avery])
    on("2026-08-07", e_mulch_schedule)

    def e_mulch_costs(d):
        j = events["_q"]["mulch_job"]
        nonlocal b
        b = apply(b, {"action": "create", "kind": "expenses", "record": {
            "job_id": j, "date": d, "description": "Hardwood mulch, 6 cu yd", "kind": "material",
            "vendor": "Example Landscape Supply", "qty_milli": 6000, "unit_cost": 3150}})
        b = apply(b, {"action": "create", "kind": "expenses", "record": {
            "job_id": j, "date": d, "description": "Spray heads", "kind": "material",
            "vendor": "Example Irrigation Supply", "qty_milli": 4000, "unit_cost": 575}})
        v = [x for x in b["visits"] if x["job_id"] == j][0]
        for k, nm in enumerate(("front-beds-before.jpg", "front-beds-after.jpg")):
            b = apply(b, {"action": "create", "kind": "photos", "record": {
                "job_id": j, "visit_id": v["id"], "crew_id": dana, "name": nm, "mime": "image/jpeg",
                "size": 1843200 + k * 20480, "taken_at": stamp(d, 8 * 60 + 5 + k * 330),
                "caption": "Before" if k == 0 else "After"}})
    on("2026-08-12", e_mulch_costs)

    def e_sod_request(d):
        nonlocal b
        b = apply(b, {"action": "create", "kind": "requests", "record": {
            "id": "r-sod", "client_id": "c-young", "property_id": props["c-young"]["id"], "date": d,
            "title": "Replace dead patch of lawn", "details": "About 900 sq ft of dead grass by the driveway.",
            "source": "Website form"}})
        q = run(quote_from_request, "r-sod", d)
        q = dict(q, lines=[L("l1", it["i-sod"], 2000), L("l2", it["i-labor"], 4000),
                           L("l3", it["i-drip"], 1000, optional=True, selected=False)])
        b = apply(b, {"action": "update", "kind": "quotes", "record": q})
        run(send_quote, q["id"], d)
        events["_q"]["sod"] = q["id"]
    on("2026-09-08", e_sod_request)

    def e_sod_approve(d):
        run(approve_quote, events["_q"]["sod"], [], "Marcus Young", d)
    on("2026-09-11", e_sod_approve)

    def e_sod_schedule(d):
        j = [x for x in b["jobs"] if x["quote_id"] == events["_q"]["sod"]][0]
        run(schedule_visit, j["id"], "2026-09-17", "08:00", 300, [dana, avery, jordan])
        nonlocal_b_expense(j["id"], "2026-09-17", "St. Augustine sod, 2 pallets", 2000, 20500)
    on("2026-09-14", e_sod_schedule)

    def e_young_mowing(d):
        run(create_job, {"client_id": "c-young", "property_id": props["c-young"]["id"], "title": "Weekly lawn care",
                         "kind": "recurring", "rule": weekly([1]), "start_date": "2026-09-21", "start_time": "08:45",
                         "duration_min": 45, "crew_ids": [dana, avery], "lines": [L("l1", it["i-mow"], 1000)],
                         "billing": "per_visit", "invoice_timing": "monthly", "checklist": check}, d, d)
    on("2026-09-18", e_young_mowing)

    def nonlocal_b_expense(jid, d, desc, q, c):
        nonlocal b
        b = apply(b, {"action": "create", "kind": "expenses", "record": {
            "job_id": jid, "date": d, "description": desc, "kind": "material", "vendor": "Example Turf Farm",
            "qty_milli": q, "unit_cost": c}})

    def e_repair(d):
        nonlocal b
        b = apply(b, {"action": "create", "kind": "requests", "record": {
            "id": "r-leak", "client_id": "c-fisher", "property_id": props["c-fisher"]["id"], "date": d,
            "title": "Leak by the back patio", "details": "Water pooling after the system runs.", "source": "Text"}})
        q = run(quote_from_request, "r-leak", d)
        q = dict(q, lines=[L("l1", it["i-drip"], 2000), L("l2", it["i-labor"], 1500)])
        b = apply(b, {"action": "update", "kind": "quotes", "record": q})
        run(send_quote, q["id"], d)
        run(approve_quote, q["id"], None, "Grace Fisher (by phone)", d)
        events["_q"]["leak"] = q["id"]
    on("2026-10-12", e_repair)

    def e_repair_schedule(d):
        j = [x for x in b["jobs"] if x["quote_id"] == events["_q"]["leak"]][0]
        run(schedule_visit, j["id"], "2026-10-20", "14:00", 90, [jordan])
    on("2026-10-13", e_repair_schedule)

    def e_quotes_open(d):
        nonlocal b
        # waiting on an answer (a follow-up gets queued)
        q = run(create_quote, {"client_id": "c-patel", "property_id": props["c-patel"]["id"], "date": d,
                               "title": "Fall color beds", "lines": [L("l1", it["i-labor"], 6000),
                                                                    L("l2", it["i-mulch"], 3000)]})
        run(send_quote, q["id"], d)
        # changes requested
        q2 = run(create_quote, {"client_id": "c-dental", "property_id": props["c-dental"]["id"], "date": d,
                                "title": "Front entrance refresh", "lines": [L("l1", it["i-sod"], 1000),
                                                                            L("l2", it["i-mulch"], 4000)]})
        run(send_quote, q2["id"], d)
        run(request_changes, q2["id"], "Please price it without the sod.", add_days(d, 2))
        # a draft
        run(create_quote, {"client_id": "c-alvarez", "property_id": props["c-alvarez"]["id"], "date": TODAY,
                           "title": "Drip conversion, side beds", "lines": [L("l1", it["i-drip"], 3000),
                                                                         L("l2", it["i-labor"], 3000)]})
    on("2026-10-14", e_quotes_open)

    def e_lost(d):
        q = run(create_quote, {"client_id": "c-brooks", "property_id": props["c-brooks"]["id"], "date": d,
                               "title": "Backyard sod", "lines": [L("l1", it["i-sod"], 3000)]})
        run(send_quote, q["id"], d)
        nonlocal b
        b = apply(b, {"action": "update", "kind": "quotes", "record": dict(
            [x for x in b["quotes"] if x["id"] == q["id"]][0], status="archived",
            notes="Client went with a neighbor's nephew.")})
    on("2026-08-20", e_lost)

    def e_requests_open(d):
        nonlocal b
        b = apply(b, {"action": "create", "kind": "requests", "record": {
            "client_id": "c-hoa", "property_id": props["c-hoa"]["id"], "date": d, "title": "Winterize backflow",
            "details": "Board asks for a price to insulate the backflow preventer.", "source": "Email",
            "status": "assessment", "assessment_date": "2026-10-27", "assessment_time": "10:00",
            "assessment_crew_ids": [jordan]}})
        b = apply(b, {"action": "create", "kind": "requests", "record": {
            "client_id": "c-kim", "property_id": props["c-kim"]["id"], "date": TODAY,
            "title": "Front yard drainage", "details": "Water sits along the walk after rain.", "source": "Phone"}})
    on("2026-10-21", e_requests_open)

    slow = {"c-brooks": 40, "c-patel": 6, "c-dental": 25, "c-kim": 10}
    never = {"c-young"}
    paid_on = {}
    late_visit = None
    z = day_num(START)
    while z <= day_num(TODAY):
        from .util import day_str
        d = day_str(z)
        y = add_days(d, -1)
        # yesterday's work is finished
        for v in sorted(b["visits"], key=lambda v: (v["date"], v["start_time"], v["id"])):
            if v["date"] != y or v["status"] != "scheduled":
                continue
            job = [j for j in b["jobs"] if j["id"] == v["job_id"]][0]
            if job["kind"] == "one_off" and v["date"] == "2026-10-20":
                late_visit = v["id"]
                continue
            st = parse_time(v["start_time"]) if v["start_time"] else 13 * 60
            st += rnd.next(20) - 5
            dur = v["duration_min"] + rnd.next(31) - 15
            run(start_visit, v["id"], stamp(y, st))
            for c in v["checklist"]:
                run(check_item, v["id"], c["id"], True, "")
            if v["checklist"] and rnd.next(6) == 0:
                run(check_item, v["id"], v["checklist"][-1]["id"], True, "Noted a broken head in zone 3.")
            run(finish_visit, v["id"], stamp(y, st + dur))
        # shop time Monday mornings
        if (z + 3) % 7 == 0:
            for c in (dana, avery, jordan):
                run(add_time, {"crew_id": c, "date": d, "start_time": "07:00", "minutes": 30, "kind": "shop",
                               "note": "Equipment check"})
        for fn in events.get(d, []):
            fn(d)
        b, _ = run_automations(b, d, f"{d}T06:30:00{OFF}")
        # close one-off jobs whose work is done and invoiced, and send yesterday's drafts
        for inv in list(b["invoices"]):
            if inv["status"] == "draft" and inv["date"] < d and d < "2026-10-21":
                run(send_invoice, inv["id"], d)
                delay = slow.get(inv["client_id"], 3 + rnd.next(5))
                if inv["client_id"] not in never:
                    paid_on.setdefault(add_days(d, delay), []).append(inv["id"])
        for nid in paid_on.get(d, []):
            inv = [i for i in b["invoices"] if i["id"] == nid][0]
            st = invoice_state(b, inv, d)
            if st["balance"] > 0:
                run(record_payment, {"invoice_id": nid, "date": d, "amount": st["balance"],
                                     "method": ["card", "check", "ach", "link"][rnd.next(4)],
                                     "reference": f"{inv['number']}"}, d)
        for r in list(b["reminders"]):
            if r["status"] == "queued" and r["created"] < add_days(d, -1):
                b = apply(b, {"action": "update", "kind": "reminders", "record": dict(r, status="sent")})
        for j in list(b["jobs"]):
            if j["kind"] == "one_off" and j["status"] == "active":
                vs = [v for v in b["visits"] if v["job_id"] == j["id"]]
                if vs and all(v["status"] == "completed" for v in vs) and \
                        any(i["job_id"] == j["id"] and i["status"] == "sent" for i in b["invoices"]):
                    run(close_job, j["id"], d)
        z += 1
    # Today: the morning is under way
    for v in sorted(b["visits"], key=lambda v: (v["start_time"], v["id"])):
        if v["date"] == TODAY and v["start_time"] and v["start_time"] < "08:00" and v["status"] == "scheduled":
            run(start_visit, v["id"], stamp(TODAY, parse_time(v["start_time"]) + 4))
    b = dict(b)
    b["example"] = True
    _ = late_visit
    return b
