import pytest

from fieldservice.book import Tx
from fieldservice.schedule import (apply_route, describe_rule, distance_m, find_conflicts, nth_weekday, occurrences,
                                   route_order, suggest_route)
from fieldservice.schema import check_record
from fieldservice.util import ServiceError, weekday
from fieldservice.workflow import create_job, schedule_visit

from helpers import base_book, line, run


def R(**kw):
    return check_record("rule", kw, "rule")


def test_weekly_on_days_and_interval_anchor():
    r = R(freq="weekly", days=[1, 4])
    assert occurrences(r, "2026-10-01", "2026-10-01", "2026-10-15") == [
        "2026-10-01", "2026-10-05", "2026-10-08", "2026-10-12", "2026-10-15"]
    # every 2 weeks, counted from the week of the start date (Thu Oct 1 is in the week of Mon Sep 28)
    r2 = R(freq="weekly", interval=2, days=[1])
    assert occurrences(r2, "2026-10-01", "2026-10-01", "2026-11-01") == ["2026-10-12", "2026-10-26"]
    # a window that starts later keeps the same anchor
    assert occurrences(r2, "2026-10-01", "2026-10-20", "2026-11-30") == ["2026-10-26", "2026-11-09", "2026-11-23"]


def test_monthly_day_clamps_to_month_end_and_leap_years():
    r = R(freq="monthly", month_mode="day", month_day=31)
    assert occurrences(r, "2026-01-01", "2026-01-01", "2026-05-31") == [
        "2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]
    r29 = R(freq="monthly", month_mode="day", month_day=29, interval=12)
    assert occurrences(r29, "2027-02-01", "2027-01-01", "2030-12-31") == [
        "2027-02-28", "2028-02-29", "2029-02-28", "2030-02-28"]
    last = R(freq="monthly", month_mode="day", month_day=-1)
    assert occurrences(last, "2100-01-15", "2100-01-01", "2100-03-31") == ["2100-01-31", "2100-02-28", "2100-03-31"]
    # the start date's month counts only from the start date on
    assert occurrences(R(freq="monthly", month_day=5), "2026-10-06", "2026-10-01", "2026-12-31") == [
        "2026-11-05", "2026-12-05"]


def test_monthly_nth_weekday():
    assert nth_weekday(2026, 10, 2, 2) == 13          # 2nd Tuesday of Oct 2026
    assert nth_weekday(2026, 10, -1, 5) == 30         # last Friday
    assert nth_weekday(2026, 2, 4, 6) == 28           # 4th Saturday in a February that starts on a Sunday
    assert nth_weekday(2024, 2, -1, 4) == 29          # last Thursday, leap day
    r = R(freq="monthly", month_mode="nth", nth=1, weekday=1, interval=3)
    got = occurrences(r, "2026-01-01", "2026-01-01", "2026-12-31")
    assert got == ["2026-01-05", "2026-04-06", "2026-07-06", "2026-10-05"]
    assert all(weekday(d) == 1 for d in got)


def test_every_n_days_across_leap_day_and_year_end():
    r = R(freq="daily", interval=10)
    assert occurrences(r, "2028-02-19", "2028-02-19", "2028-03-15") == ["2028-02-19", "2028-02-29", "2028-03-10"]
    assert occurrences(R(freq="daily", interval=3), "2026-12-29", "2026-12-29", "2027-01-05") == [
        "2026-12-29", "2027-01-01", "2027-01-04"]


def test_exceptions_limit_and_end():
    r = R(freq="weekly", days=[3], exceptions=["2026-10-14"])
    assert occurrences(r, "2026-10-01", "2026-10-01", "2026-10-31") == ["2026-10-07", "2026-10-21", "2026-10-28"]
    # the limit counts the series before exceptions are removed
    assert occurrences(r, "2026-10-01", "2026-10-01", "2026-12-31", limit=3) == ["2026-10-07", "2026-10-21"]
    assert occurrences(r, "2026-10-01", "2026-10-01", "2026-12-31", end="2026-10-21") == ["2026-10-07", "2026-10-21"]
    assert occurrences(r, "2026-10-01", "2026-11-01", "2026-10-01") == []
    with pytest.raises(ServiceError):
        occurrences(R(freq="daily"), "1900-01-01", "1900-01-01", "2026-01-01")


def test_bad_rules_refused():
    with pytest.raises(ServiceError, match="at least one day"):
        R(freq="weekly", days=[])
    with pytest.raises(ServiceError):
        R(freq="weekly", days=[8])
    with pytest.raises(ServiceError):
        R(freq="monthly", month_day=0)
    with pytest.raises(ServiceError):
        R(freq="monthly", month_mode="nth", nth=5)
    with pytest.raises(ServiceError):
        R(freq="yearly")
    assert describe_rule(R(freq="weekly", interval=2, days=[1, 4])) == "Every 2 weeks on Mon, Thu"
    assert describe_rule(R(freq="monthly", month_mode="nth", nth=-1, weekday=5)) == "Every month on the last Friday"
    assert describe_rule(R(freq="monthly", month_day=-1, interval=3)) == "Every 3 months on the last day"
    assert describe_rule(R(freq="daily", interval=14, exceptions=["2026-01-01"])) == "Every 14 days, 1 date skipped"


def test_wall_clock_kept_across_daylight_saving():
    b = base_book()
    b, j = run(b, create_job, {"client_id": "c1", "title": "Mow", "kind": "recurring",
                               "rule": {"freq": "weekly", "days": [6]}, "start_date": "2026-10-24",
                               "start_time": "08:00", "duration_min": 60, "crew_ids": ["m1"]}, "", "2026-11-15")
    vs = sorted((v["date"], v["start_time"]) for v in b["visits"])
    # Oct 31 is before the US change on Nov 1 and Nov 7 after it; both stay at 08:00 local.
    assert vs == [("2026-10-24", "08:00"), ("2026-10-31", "08:00"), ("2026-11-07", "08:00"), ("2026-11-14", "08:00")]


def test_conflicts_per_crew_member_including_overnight():
    b = base_book()
    b, j = run(b, create_job, {"client_id": "c1", "title": "A", "kind": "one_off"}, "", "")
    b, v1 = run(b, schedule_visit, j["id"], "2026-10-05", "08:00", 120, ["m1", "m2"])
    b, v2 = run(b, schedule_visit, j["id"], "2026-10-05", "09:30", 60, ["m1"])
    b, v3 = run(b, schedule_visit, j["id"], "2026-10-05", "10:00", 30, ["m1"])     # touches v1's end: no conflict
    b, v4 = run(b, schedule_visit, j["id"], "2026-10-05", "", 600, ["m1"])         # any time: never conflicts
    b, v5 = run(b, schedule_visit, j["id"], "2026-10-05", "23:00", 180, ["m2"])
    b, v6 = run(b, schedule_visit, j["id"], "2026-10-06", "01:00", 60, ["m2"])     # inside v5 after midnight
    c = find_conflicts(b, "2026-10-05", "2026-10-06")
    assert c == [
        {"crew_id": "m1", "a": v1["id"], "b": v2["id"], "date": "2026-10-05", "overlap_min": 30},
        {"crew_id": "m1", "a": v2["id"], "b": v3["id"], "date": "2026-10-05", "overlap_min": 30},
        {"crew_id": "m2", "a": v5["id"], "b": v6["id"], "date": "2026-10-06", "overlap_min": 60},
    ]
    # a window starting on the 6th still sees the overnight overlap
    assert len(find_conflicts(b, "2026-10-06", "2026-10-06")) == 1
    b2 = dict(b, visits=[dict(v, status="cancelled") if v["id"] == v2["id"] else v for v in b["visits"]])
    assert len(find_conflicts(b2, "2026-10-05", "2026-10-05")) == 0


def test_distance_and_nearest_neighbour():
    # one degree of latitude is about 111.2 km
    assert abs(distance_m([30000000, -95000000], [31000000, -95000000]) - 111195.08) < 1
    # one degree of longitude at 30 degrees north is about 96.3 km
    assert abs(distance_m([30000000, -95000000], [30000000, -94000000]) - 96297.32) < 5
    stops = [{"id": "far", "lat_e6": 30100000, "lon_e6": -95000000},
             {"id": "near", "lat_e6": 30010000, "lon_e6": -95000000},
             {"id": "mid", "lat_e6": 30050000, "lon_e6": -95000000},
             {"id": "nocoord", "lat_e6": None, "lon_e6": None}]
    r = route_order(stops, [30000000, -95000000])
    assert r["order"] == ["near", "mid", "far", "nocoord"]
    assert r["unplaced"] == ["nocoord"]
    assert abs(r["distance_m"] - 11120) <= 1
    # ties go to the earlier stop in the list
    tie = [{"id": "a", "lat_e6": 30000000, "lon_e6": -94990000}, {"id": "b", "lat_e6": 30000000, "lon_e6": -95010000}]
    assert route_order(tie, [30000000, -95000000])["order"] == ["a", "b"]
    assert route_order([], None)["order"] == []


def test_suggest_and_apply_route_is_undoable_data():
    b = base_book()
    b, j1 = run(b, create_job, {"client_id": "c2", "property_id": "p2", "title": "Far", "kind": "one_off",
                                "duration_min": 60}, "", "")
    b, j2 = run(b, create_job, {"client_id": "c1", "property_id": "p1", "title": "Near", "kind": "one_off",
                                "duration_min": 90}, "", "")
    b, vf = run(b, schedule_visit, j1["id"], "2026-10-05", "08:00", None, ["m1"])
    b, vn = run(b, schedule_visit, j2["id"], "2026-10-05", "10:00", None, ["m1"])
    s = suggest_route(b, "m1", "2026-10-05")
    assert s["current_order"] == [vf["id"], vn["id"]]
    assert s["order"] == [vn["id"], vf["id"]]
    assert s["saved_m"] > 0
    tx = Tx(b)
    apply_route(tx, "m1", "2026-10-05", s["order"], True, 15)
    got = {v["id"]: (v["route_seq"], v["start_time"]) for v in tx.book["visits"]}
    assert got[vn["id"]] == (1, "08:00") and got[vf["id"]] == (2, "09:45")
    assert len(tx.changes) == 2
    with pytest.raises(ServiceError):
        apply_route(Tx(b), "m2", "2026-10-05", s["order"], False, 0)
    with pytest.raises(ServiceError):
        apply_route(Tx(b), "m1", "2026-10-05", s["order"], True, 999)
