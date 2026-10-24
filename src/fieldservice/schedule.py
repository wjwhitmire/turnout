"""Scheduling math: recurrence rules, visit generation, conflicts, route order.

Dates are calendar dates and visit times are wall-clock times ("08:00") on that date, with
no time zone attached. A weekly 08:00 visit stays at 08:00 across a daylight saving change
because the series is built from calendar days, never by adding 7 x 24 hours to an instant.
Elapsed working time is measured from time stamps that carry the device's UTC offset (see
util.parse_stamp), so a shift that crosses the change is still counted exactly.

Recurrence rules:
  daily    every N days from the start date
  weekly   every N weeks on the chosen weekdays; weeks run Monday to Sunday and are counted
           from the week that holds the start date
  monthly  every N months, on a day of the month (a day past the month's end moves to the
           month's last day, so "the 31st" is Feb 28 or 29) or on the nth weekday
           ("2nd Tuesday", "last Friday")
Exceptions remove single dates from the series. A visit limit counts dates of the series
before exceptions are removed.
"""

from __future__ import annotations

import math

from .util import (add_days, day_num, day_str, days_in_month, fail, parse_date, parse_time, week_start, weekday,
                   ymd_str)

DAY_ABBR = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
DAY_NAME = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
ORD = {1: "1st", 2: "2nd", 3: "3rd", 4: "4th", -1: "last"}
MAX_SPAN_DAYS = 36_600
MAX_DATES = 5000


def nth_weekday(y: int, m: int, nth: int, wd: int) -> int:
    """Day of the month of the nth (1..4, or -1 for last) ISO weekday wd in month m."""
    if nth > 0:
        first = weekday(ymd_str(y, m, 1))
        return 1 + (wd - first) % 7 + (nth - 1) * 7
    last = days_in_month(y, m)
    lw = weekday(ymd_str(y, m, last))
    return last - (lw - wd) % 7


def occurrences(rule: dict, start: str, frm: str, to: str, end: str = "", limit: int = 0) -> list:
    """Dates of the series that fall in [frm, to], in order. The series starts at start and
    stops at end (if given) and after limit dates (if > 0)."""
    s = day_num(start)
    lo = max(day_num(frm), s)
    hi = day_num(to)
    if end:
        hi = min(hi, day_num(end))
    if hi - s > MAX_SPAN_DAYS:
        fail("too_long", "The schedule date range is longer than 100 years.")
    out = []
    if hi < lo:
        return out
    exc = set(rule["exceptions"])
    n = 0
    iv = rule["interval"]
    f = rule["freq"]

    def take(z):
        nonlocal n
        n += 1
        if limit and n > limit:
            return False
        if z >= lo:
            d = day_str(z)
            if d not in exc:
                out.append(d)
                if len(out) > MAX_DATES:
                    fail("too_many", f"The schedule makes more than {MAX_DATES} visits in this date range.")
        return True

    if f == "daily":
        z = s
        while z <= hi:
            if not take(z):
                break
            z += iv
    elif f == "weekly":
        w = day_num(week_start(start))
        days = rule["days"]
        stop = False
        while w <= hi and not stop:
            for d in days:
                z = w + d - 1
                if z < s:
                    continue
                if z > hi:
                    stop = True
                    break
                if not take(z):
                    stop = True
                    break
            w += 7 * iv
    else:
        y, m, _ = parse_date(start)
        k = y * 12 + (m - 1)
        while True:
            yy, mm = k // 12, k % 12 + 1
            if day_num(ymd_str(yy, mm, 1)) > hi:
                break
            if rule["month_mode"] == "day":
                dim = days_in_month(yy, mm)
                dd = dim if rule["month_day"] == -1 else min(rule["month_day"], dim)
            else:
                dd = nth_weekday(yy, mm, rule["nth"], rule["weekday"])
            z = day_num(ymd_str(yy, mm, dd))
            if z > hi:
                break
            if z >= s and not take(z):
                break
            k += iv
    return out


def describe_rule(rule: dict) -> str:
    """Plain words for a rule: 'Every 2 weeks on Mon, Thu'."""
    iv = rule["interval"]
    f = rule["freq"]
    if f == "daily":
        txt = "Every day" if iv == 1 else f"Every {iv} days"
    elif f == "weekly":
        days = ", ".join(DAY_ABBR[d - 1] for d in rule["days"])
        txt = ("Every week" if iv == 1 else f"Every {iv} weeks") + " on " + days
    else:
        head = "Every month" if iv == 1 else f"Every {iv} months"
        if rule["month_mode"] == "day":
            md = rule["month_day"]
            txt = head + (" on the last day" if md == -1 else f" on day {md}")
        else:
            txt = head + f" on the {ORD[rule['nth']]} {DAY_NAME[rule['weekday'] - 1]}"
    if rule["exceptions"]:
        k = len(rule["exceptions"])
        txt += f", {k} date{'s' if k != 1 else ''} skipped"
    return txt


# ---------------------------------------------------------------- visits

def job_visits(book: dict, job_id: str) -> list:
    return [v for v in book["visits"] if v["job_id"] == job_id]


def new_visit(job: dict, date: str, occurrence: str = "") -> dict:
    return {"job_id": job["id"], "date": date, "start_time": job["start_time"], "duration_min": job["duration_min"],
            "crew_ids": list(job["crew_ids"]), "status": "scheduled", "occurrence": occurrence,
            "checklist": [{"id": c["id"], "text": c["text"], "done": False, "note": ""} for c in job["checklist"]]}


def plan_visits(book: dict, job: dict, frm: str, through: str) -> list:
    """Occurrence dates of a recurring job in [frm, through] that have no visit yet. A job whose
    client is archived makes no new visits."""
    if job["kind"] != "recurring" or job["status"] != "active" or job["rule"] is None:
        return []
    if any(c["id"] == job["client_id"] and c["archived"] for c in book["clients"]):
        return []
    have = set(v["occurrence"] for v in book["visits"] if v["job_id"] == job["id"] and v["occurrence"])
    dates = occurrences(job["rule"], job["start_date"], frm, through, job["end_date"], job["visit_limit"])
    return [d for d in dates if d not in have]


def generate_visits(tx, job_id: str, frm: str, through: str) -> list:
    """Create the missing visits of a recurring job in [frm, through]. Returns the new visits."""
    job = tx.need("jobs", job_id)
    out = []
    for d in plan_visits(tx.book, job, frm, through):
        out.append(tx.create("visits", new_visit(job, d, d)))
    return out


def _span(v):
    z = day_num(v["date"]) * 1440 + parse_time(v["start_time"])
    return [z, z + v["duration_min"]]


def find_conflicts(book: dict, frm: str, to: str) -> list:
    """Visits that overlap in time for the same crew member, on dates in [frm, to].

    A visit with no start time (any time that day) or no length never conflicts.
    Cancelled visits are ignored. Overnight visits are compared across midnight.
    Returns [{crew_id, a, b, date, overlap_min}], a starting no later than b."""
    lo = day_num(frm) - 1
    hi = day_num(to)
    per = {}
    for v in book["visits"]:
        if v["status"] == "cancelled" or not v["start_time"] or v["duration_min"] == 0:
            continue
        z = day_num(v["date"])
        if z < lo or z > hi:
            continue
        sp = _span(v)
        for c in v["crew_ids"]:
            per.setdefault(c, []).append([sp[0], sp[1], v["id"], v["date"]])
    out = []
    for c in sorted(per.keys()):
        xs = sorted(per[c], key=lambda t: (t[0], t[1], t[2]))
        for i in range(len(xs)):
            for j in range(i + 1, len(xs)):
                if xs[j][0] >= xs[i][1]:
                    break
                ov = min(xs[i][1], xs[j][1]) - xs[j][0]
                if day_num(xs[j][3]) < day_num(frm) and day_num(xs[i][3]) < day_num(frm):
                    continue
                out.append({"crew_id": c, "a": xs[i][2], "b": xs[j][2], "date": xs[j][3], "overlap_min": ov})
    return out


# ---------------------------------------------------------------- route order

PI = 3.141592653589793
EARTH_M = 6371008.8


def _cos(x: float) -> float:
    """cos(x) for |x| <= pi/2 by its Taylor series to x**18, in a fixed order of operations so
    both languages get the same double."""
    x2 = x * x
    r = 1.0
    t = 1.0
    for k in range(1, 10):
        t = -t * x2 / ((2 * k - 1) * (2 * k))
        r = r + t
    return r


def distance_m(a: list, b: list) -> float:
    """Straight-line distance in meters between [lat_e6, lon_e6] points (equirectangular
    approximation, good to well under 1% within a service area). Not a driving distance."""
    la = a[0] * PI / 180_000_000.0
    lb = b[0] * PI / 180_000_000.0
    dl = (b[1] - a[1]) * PI / 180_000_000.0
    x = dl * _cos((la + lb) / 2.0)
    y = lb - la
    return EARTH_M * math.sqrt(x * x + y * y)


def _round(x: float) -> int:
    return int(x + 0.5) if x >= 0 else -int(-x + 0.5)


def route_order(stops: list, start=None) -> dict:
    """Nearest-neighbour order: from start (or the first stop), always go to the closest
    stop not yet visited; ties go to the earlier stop in the list. stops are
    {id, lat_e6, lon_e6}; stops without coordinates keep their order at the end.
    Returns {order, distance_m, legs_m, unplaced}."""
    pts = [s for s in stops if s["lat_e6"] is not None and s["lon_e6"] is not None]
    unplaced = [s["id"] for s in stops if s["lat_e6"] is None or s["lon_e6"] is None]
    order = []
    legs = []
    total = 0.0
    left = list(range(len(pts)))
    cur = start
    if cur is None and pts:
        cur = [pts[0]["lat_e6"], pts[0]["lon_e6"]]
    while left:
        best = -1
        bd = 0.0
        for i in left:
            d = distance_m(cur, [pts[i]["lat_e6"], pts[i]["lon_e6"]])
            if best < 0 or d < bd:
                best, bd = i, d
        order.append(pts[best]["id"])
        legs.append(_round(bd))
        total += bd
        cur = [pts[best]["lat_e6"], pts[best]["lon_e6"]]
        left.remove(best)
    return {"order": order + unplaced, "distance_m": _round(total), "legs_m": legs, "unplaced": unplaced}


def path_distance(stops: list, start=None) -> int:
    """Length in meters of visiting the stops with coordinates in the given order."""
    pts = [[s["lat_e6"], s["lon_e6"]] for s in stops if s["lat_e6"] is not None and s["lon_e6"] is not None]
    total = 0.0
    cur = start if start is not None else (pts[0] if pts else None)
    for p in pts:
        total += distance_m(cur, p)
        cur = p
    return _round(total)


def day_stops(book: dict, crew_id: str, date: str) -> list:
    """The crew member's visits that day in their current order (route_seq, then start time,
    then id), with the property coordinates."""
    jobs = {j["id"]: j for j in book["jobs"]}
    props = {p["id"]: p for p in book["properties"]}
    vs = [v for v in book["visits"] if v["date"] == date and crew_id in v["crew_ids"] and v["status"] != "cancelled"]
    vs = sorted(vs, key=lambda v: (v["route_seq"] if v["route_seq"] else 1000, v["start_time"] or "99:99", v["id"]))
    out = []
    for v in vs:
        p = props.get(jobs[v["job_id"]]["property_id"])
        out.append({"id": v["id"], "lat_e6": p["lat_e6"] if p else None, "lon_e6": p["lon_e6"] if p else None})
    return out


def suggest_route(book: dict, crew_id: str, date: str) -> dict:
    """The suggested order for one crew member's day, with the distance saved against the
    current order. Starts from the business's home base when it has coordinates."""
    s = book["settings"]
    home = [s["home_lat_e6"], s["home_lon_e6"]] if s["home_lat_e6"] is not None and s["home_lon_e6"] is not None else None
    stops = day_stops(book, crew_id, date)
    r = route_order(stops, home)
    cur = path_distance(stops, home)
    r["current_order"] = [x["id"] for x in stops]
    r["current_m"] = cur
    r["saved_m"] = cur - r["distance_m"]
    return r


def apply_route(tx, crew_id: str, date: str, order: list, retime: bool, gap_min: int) -> list:
    """Number the day's visits in the given order (route_seq 1, 2, ...). With retime, also
    set start times one after another from the first visit's start (or the business day
    start), leaving gap_min minutes between visits for the drive."""
    if gap_min < 0 or gap_min > 240:
        fail("bad_field", "gap: must be 0 to 240 minutes.")
    vs = [tx.need("visits", vid) for vid in order]
    for v in vs:
        if v["date"] != date or crew_id not in v["crew_ids"]:
            fail("bad_route", f"Visit {v['id']} is not on this crew member's day.")
    t = None
    if retime:
        firsts = [parse_time(v["start_time"]) for v in vs if v["start_time"]]
        t = min(firsts) if firsts else parse_time(tx.book["settings"]["day_start"] or "08:00")
    out = []
    for i, v in enumerate(vs):
        f = {"route_seq": i + 1}
        if retime:
            if t + v["duration_min"] > 1440:
                fail("bad_route", "The day runs past midnight with these visit lengths. Shorten the gap or move a visit.")
            f["start_time"] = f"{t // 60:02d}:{t % 60:02d}"
            t += v["duration_min"] + gap_min
        out.append(tx.patch("visits", v["id"], f))
    return out


def crew_day(book: dict, crew_id: str, date: str) -> list:
    """The visit ids for a crew member's day in route order."""
    return [s["id"] for s in day_stops(book, crew_id, date)]


def window_dates(frm: str, to: str) -> list:
    out = []
    z = day_num(frm)
    while z <= day_num(to):
        out.append(day_str(z))
        z += 1
        if len(out) > 400:
            fail("too_long", "The date range is longer than 400 days.")
    return out


__all__ = ["occurrences", "describe_rule", "generate_visits", "plan_visits", "find_conflicts", "route_order",
           "suggest_route", "apply_route", "distance_m", "nth_weekday", "add_days"]
