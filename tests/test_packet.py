import copy
import json

import pytest

from fieldservice.automation import run_automations
from fieldservice.book import apply
from fieldservice.packet import apply_packet, crew_update, export_packet, merge_preview, read_packet, return_packet
from fieldservice.util import ServiceError
from fieldservice.workflow import check_item, create_job, schedule_visit

from helpers import base_book, line, run

AT = "2026-10-05T06:00:00-05:00"


def packet_book():
    b = base_book()
    b, j = run(b, create_job, {"client_id": "c1", "property_id": "p1", "title": "Mow", "kind": "one_off",
                               "lines": [line("l1", 9900)], "checklist": [{"id": "k1", "text": "Gate"},
                                                                          {"id": "k2", "text": "Blow drive"}]}, "", "")
    b, v1 = run(b, schedule_visit, j["id"], "2026-10-05", "08:00", 60, ["m1"])
    b, v2 = run(b, schedule_visit, j["id"], "2026-10-06", "08:00", 60, ["m1", "m2"])
    b, v3 = run(b, schedule_visit, j["id"], "2026-10-06", "13:00", 60, ["m2"])
    return b, j, v1, v2, v3


def crew_round_trip(pk, v1, v2):
    pk = crew_update(pk, v1["id"], {"status": "completed", "started_at": "2026-10-05T08:02:00-05:00",
                                    "finished_at": "2026-10-05T09:00:00-05:00", "notes": "Dog in yard"})
    chk = [dict(c, done=True) for c in [x for x in pk["visits"] if x["id"] == v1["id"]][0]["checklist"]]
    pk = crew_update(pk, v1["id"], {"checklist": chk})
    pk = crew_update(pk, v2["id"], {"status": "in_progress", "started_at": "2026-10-06T08:00:00-05:00"})
    ts = [{"id": "k-1", "crew_id": "m1", "date": "2026-10-05", "start_time": "07:30", "minutes": 25,
           "kind": "travel", "source": "packet"}]
    ph = [{"id": "ph1", "job_id": v1["job_id"], "visit_id": v1["id"], "crew_id": "m1", "name": "after.jpg",
           "mime": "image/jpeg", "size": 12, "taken_at": "2026-10-05T08:59:00-05:00", "data": "data:image/jpeg;base64,AAAA"}]
    return return_packet(pk, ts, ph, "2026-10-06T18:00:00-05:00")


def test_export_holds_only_the_crew_members_open_visits_and_no_prices():
    b, j, v1, v2, v3 = packet_book()
    pk = export_packet(b, "m1", "2026-10-05", "2026-10-06", AT)
    assert [v["id"] for v in pk["visits"]] == [v1["id"], v2["id"]]
    assert pk["clients"] == [{"id": "c1", "name": "Ann Example", "phone": "(555) 010-0001"}]
    assert "lines" not in json.dumps(pk["jobs"]) and "rate" not in json.dumps(pk)
    assert read_packet(json.loads(json.dumps(pk)))["visits"] == pk["visits"]
    with pytest.raises(ServiceError):
        export_packet(b, "m1", "2026-10-05", "2026-12-31", AT)


def test_clean_merge_takes_crew_changes_and_is_idempotent():
    b, j, v1, v2, v3 = packet_book()
    pk = crew_round_trip(export_packet(b, "m1", "2026-10-05", "2026-10-06", AT), v1, v2)
    pv = merge_preview(b, pk)
    assert pv["conflicts"] == []
    fields = sorted((a["visit_id"], a["field"]) for a in pv["auto"])
    assert (v1["id"], "status") in fields and (v1["id"], "checklist:k2:done") in fields
    assert (v2["id"], "started_at") in fields
    b2, res = apply_packet(b, pk, {})
    assert res["timesheets"] == 1 and res["photos"] == 1 and res["skipped"] == []
    got = {v["id"]: v for v in b2["visits"]}
    assert got[v1["id"]]["status"] == "completed" and got[v1["id"]]["notes"] == "Dog in yard"
    assert all(c["done"] for c in got[v1["id"]]["checklist"])
    assert got[v2["id"]]["status"] == "in_progress"
    assert [t["source"] for t in b2["timesheets"]] == ["packet"]
    assert res["photo_ids"] == {"ph1": b2["photos"][0]["id"]}
    # the completed visit now gives the crew member job time through the automation rule
    b3, entries = run_automations(b2, "2026-10-07", AT, ["timesheets"])
    assert sorted(t["minutes"] for t in b3["timesheets"]) == [25, 58]
    # merging the same packet again changes nothing
    b4, res2 = apply_packet(b2, pk, {})
    assert res2 == {"applied": 0, "timesheets": 0, "photos": 0, "photo_ids": {}, "skipped": []}
    assert b4["visits"] == b2["visits"]


def test_conflicts_need_a_choice():
    b, j, v1, v2, v3 = packet_book()
    pk = crew_round_trip(export_packet(b, "m1", "2026-10-05", "2026-10-06", AT), v1, v2)
    # meanwhile the office edits the same note and the same checklist item
    b = apply(b, {"action": "update", "kind": "visits", "record": dict(
        [v for v in b["visits"] if v["id"] == v1["id"]][0], notes="Call before arriving")})
    b, _ = run(b, check_item, v1["id"], "k1", True, "Done by office")
    pv = merge_preview(b, pk)
    assert pv["conflicts"] == [{"visit_id": v1["id"], "field": "notes", "base": "", "office": "Call before arriving",
                                "crew": "Dog in yard"}]
    # k1 done is the same on both sides (no conflict); the office's note on k1 stays
    with pytest.raises(ServiceError, match="Choose office or crew"):
        apply_packet(b, pk, {})
    b2, _ = apply_packet(b, pk, {f"{v1['id']}|notes": "crew"})
    v = [x for x in b2["visits"] if x["id"] == v1["id"]][0]
    assert v["notes"] == "Dog in yard" and v["checklist"][0]["note"] == "Done by office"
    b3, _ = apply_packet(b, pk, {f"{v1['id']}|notes": "office"})
    assert [x for x in b3["visits"] if x["id"] == v1["id"]][0]["notes"] == "Call before arriving"


def test_deleted_visit_in_office_is_reported():
    b, j, v1, v2, v3 = packet_book()
    pk = crew_round_trip(export_packet(b, "m1", "2026-10-05", "2026-10-06", AT), v1, v2)
    b = apply(b, {"action": "delete", "kind": "visits", "id": v2["id"]})
    b2, res = apply_packet(b, pk, {})
    assert any("deleted in the office" in s for s in res["skipped"])


def test_hostile_packets_are_refused():
    b, j, v1, v2, v3 = packet_book()
    pk = export_packet(b, "m1", "2026-10-05", "2026-10-06", AT)
    with pytest.raises(ServiceError, match="not been sent back"):
        merge_preview(b, pk)
    good = crew_round_trip(pk, v1, v2)
    cases = []
    x = copy.deepcopy(good); x["visits"][0]["crew_ids"] = ["m2"]; cases.append((x, "cannot change"))
    x = copy.deepcopy(good); x["visits"][0]["invoice_id"] = "n1"; cases.append((x, "cannot change"))
    x = copy.deepcopy(good); x["visits"][0]["status"] = "cancelled"; cases.append((x, "must be one of"))
    x = copy.deepcopy(good); x["visits"].pop(); cases.append((x, "do not match"))
    x = copy.deepcopy(good); x["timesheets"][0]["crew_id"] = "m2"; cases.append((x, "packet's crew member"))
    x = copy.deepcopy(good); x["photos"][0]["data"] = "data:text/html;base64,PHNjcmlwdD4="; cases.append((x, "JPEG"))
    x = copy.deepcopy(good); x["photos"][0]["data"] = "data:image/png;base64,AAAA"; cases.append((x, "type does not"))
    x = copy.deepcopy(good); x["evil"] = 1; cases.append((x, "unknown field"))
    x = copy.deepcopy(good); x["format"] = "other"; cases.append((x, "not a job packet"))
    x = copy.deepcopy(good); x["version"] = 99; cases.append((x, "different version"))
    x = copy.deepcopy(good); x["visits"][0]["notes"] = "x" * 4001; cases.append((x, "at most 4000"))
    x = copy.deepcopy(good); x["book_id"] = "other"; cases.append((x, "another business"))
    x = copy.deepcopy(good); x["jobs"][0]["client_id"] = "c9"; cases.append((x, "client is not in the packet"))
    x = copy.deepcopy(good); x["jobs"] = []; cases.append((x, "job is not in the packet"))
    x = copy.deepcopy(good)
    for v in x["base"] + x["visits"]:
        v["crew_ids"] = ["m2"]
    cases.append((x, "not the packet's crew member's"))
    x = copy.deepcopy(good); x["timesheets"][0]["visit_id"] = v3["id"]; cases.append((x, "visit is not in the packet"))
    x = copy.deepcopy(good); x["photos"][0]["visit_id"] = v3["id"]; cases.append((x, "job or visit is not in"))
    x = copy.deepcopy(good); x["photos"][0]["crew_id"] = "m2"; cases.append((x, "packet's crew member"))
    for pkt, msg in cases:
        with pytest.raises(ServiceError, match=msg):
            merge_preview(b, pkt)
    with pytest.raises(ServiceError):
        crew_update(pk, v1["id"], {"crew_ids": []})
    with pytest.raises(ServiceError):
        crew_update(pk, "nope", {"notes": "x"})


def test_visit_reassigned_in_office_is_not_merged():
    b, j, v1, v2, v3 = packet_book()
    pk = crew_round_trip(export_packet(b, "m1", "2026-10-05", "2026-10-06", AT), v1, v2)
    b = apply(b, {"action": "update", "kind": "visits", "record": dict(
        [v for v in b["visits"] if v["id"] == v1["id"]][0], crew_ids=["m2"])})
    b2, res = apply_packet(b, pk, {})
    assert any("no longer assigned" in s for s in res["skipped"])
    assert [v for v in b2["visits"] if v["id"] == v1["id"]][0]["status"] == "scheduled"
