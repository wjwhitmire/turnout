import pytest

from fieldservice.automation import run_automations, undo_automation
from fieldservice.book import Tx, apply
from fieldservice.money import invoice_state
from fieldservice.util import ServiceError
from fieldservice.workflow import (approve_quote, close_job, create_job, finish_visit, invoice_job, job_state,
                                   move_visit, quote_from_request, record_payment, request_changes, schedule_visit,
                                   send_invoice, send_quote, start_visit, void_invoice, do, create_invoice)

from helpers import base_book, line, run

AT = "2026-10-05T06:00:00-05:00"


def request_book():
    b = base_book()
    b = apply(b, {"action": "create", "kind": "requests", "record": {
        "id": "r1", "client_id": "c1", "property_id": "p1", "date": "2026-10-01", "title": "Fix sprinkler",
        "details": "Zone 2 leaks"}})
    return b


def test_request_to_quote_to_job_to_invoice_with_automation():
    b = request_book()
    b, q = run(b, quote_from_request, "r1", "2026-10-01")
    assert q["title"] == "Fix sprinkler" and q["status"] == "draft"
    r = [x for x in b["requests"] if x["id"] == "r1"][0]
    assert (r["status"], r["quote_id"]) == ("converted", q["id"])
    q = dict(q, lines=[line("l1", 10000, taxable=True), line("l2", 5000, optional=True, selected=False)],
             deposit=3000)
    b = apply(b, {"action": "update", "kind": "quotes", "record": q})
    b, _ = run(b, send_quote, q["id"], "2026-10-01")
    b, _ = run(b, approve_quote, q["id"], ["l2"], "Ann", "2026-10-02")
    b, _ = run(b, record_payment, {"quote_id": q["id"], "date": "2026-10-02", "amount": 3000}, "2026-10-02")
    # automation: the approved quote becomes a job
    b, entries = run_automations(b, "2026-10-03", AT)
    assert [e["rule"] for e in entries] == ["quote_to_job"]
    job = b["jobs"][0]
    assert entries[0]["why"].startswith("Quote Q-0001 was approved on 2026-10-02 by Ann, so it became job J-0001")
    assert [ln["id"] for ln in job["lines"]] == ["l1", "l2"] and not job["lines"][1]["optional"]
    assert [x for x in b["quotes"] if x["id"] == q["id"]][0]["status"] == "converted"
    assert [x for x in b["requests"] if x["id"] == "r1"][0]["job_id"] == job["id"]
    # running again does nothing
    b2, again = run_automations(b, "2026-10-03", AT)
    assert again == []
    # a visit, started and finished across a time zone offset change
    b, v = run(b, schedule_visit, job["id"], "2026-10-04", "08:00", 90, ["m1", "m2"])
    assert job_state(b, job, "2026-10-05") == "late"
    b, _ = run(b, start_visit, v["id"], "2026-10-04T08:05:00-05:00")
    b, _ = run(b, finish_visit, v["id"], "2026-10-04T09:35:00-05:00")
    assert job_state(b, job, "2026-10-05") == "requires_invoicing"
    b, entries = run_automations(b, "2026-10-05", AT)
    assert [e["rule"] for e in entries] == ["timesheets", "draft_invoices"]
    ts = [t for t in b["timesheets"] if t["visit_id"] == v["id"]]
    assert sorted((t["crew_id"], t["minutes"], t["start_time"]) for t in ts) == [("m1", 90, "08:05"),
                                                                                 ("m2", 90, "08:05")]
    inv = b["invoices"][0]
    assert inv["status"] == "draft" and inv["visit_ids"] == [v["id"]]
    st = invoice_state(b, inv, "2026-10-05")
    # $100 taxable + $50 = $150, tax 8.25% of $100 = $8.25, less the $30 deposit already paid
    assert (st["total"], st["paid"], st["balance"]) == (15825, 3000, 12825)
    b, _ = run(b, send_invoice, inv["id"], "2026-10-05")
    b, _ = run(b, record_payment, {"invoice_id": inv["id"], "date": "2026-10-06", "amount": 12825}, "2026-10-06")
    assert invoice_state(b, b["invoices"][0], "2026-10-06")["status"] == "paid"
    b, _ = run(b, close_job, job["id"], "2026-10-06")
    assert job_state(b, [j for j in b["jobs"] if j["id"] == job["id"]][0], "2026-10-07") == "closed"


def test_undo_restores_and_is_not_redone():
    b = request_book()
    b, q = run(b, quote_from_request, "r1", "2026-10-01")
    b = apply(b, {"action": "update", "kind": "quotes", "record": dict(q, lines=[line("l1", 1000)])})
    b, _ = run(b, approve_quote, q["id"], None, "", "2026-10-02")
    b, entries = run_automations(b, "2026-10-03", AT)
    e = entries[0]
    b, done = undo_automation(b, e["id"])
    assert done["undone"] is True
    assert b["jobs"] == []
    assert [x for x in b["quotes"] if x["id"] == q["id"]][0]["status"] == "approved"
    with pytest.raises(ServiceError, match="already undone"):
        undo_automation(b, e["id"])
    b, entries = run_automations(b, "2026-10-04", AT)
    assert entries == []                      # an undone action stays undone


def test_undo_refused_when_records_changed_since():
    b = request_book()
    b, q = run(b, quote_from_request, "r1", "2026-10-01")
    b = apply(b, {"action": "update", "kind": "quotes", "record": dict(q, lines=[line("l1", 1000)])})
    b, _ = run(b, approve_quote, q["id"], None, "", "2026-10-02")
    b, entries = run_automations(b, "2026-10-03", AT)
    job = b["jobs"][0]
    b = apply(b, {"action": "update", "kind": "jobs", "record": dict(job, title="Renamed by the office")})
    with pytest.raises(ServiceError, match="changed after this automation"):
        undo_automation(b, entries[0]["id"])
    with pytest.raises(ServiceError):
        undo_automation(b, "nope")


def recurring_book(timing="after_visit", billing="per_visit"):
    b = base_book()
    b, j = run(b, create_job, {"client_id": "c1", "property_id": "p1", "title": "Mow", "kind": "recurring",
                               "rule": {"freq": "weekly", "days": [1]}, "start_date": "2026-09-28",
                               "start_time": "08:00", "duration_min": 45, "crew_ids": ["m1"],
                               "lines": [line("l1", 5500)], "billing": billing, "invoice_timing": timing,
                               "checklist": [{"id": "k1", "text": "Gate closed"}]}, "", "")
    return b, j


def test_visits_generated_ahead_from_today_only():
    b, j = recurring_book()
    s = dict(b["settings"], visit_horizon_days=14)
    b = dict(b, settings=s)
    b, entries = run_automations(b, "2026-10-07", AT, ["generate_visits"])
    assert [v["date"] for v in b["visits"]] == ["2026-10-12", "2026-10-19"]
    assert b["visits"][0]["checklist"] == [{"id": "k1", "text": "Gate closed", "done": False, "note": ""}]
    assert "2 visits were added from 2026-10-12 through 2026-10-19" in entries[0]["why"]
    b, more = run_automations(b, "2026-10-14", AT, ["generate_visits"])
    assert [v["date"] for v in b["visits"]] == ["2026-10-12", "2026-10-19", "2026-10-26"]
    # undoing the second run removes only its visit and it is not generated again
    b, _ = undo_automation(b, more[0]["id"])
    assert [v["date"] for v in b["visits"]] == ["2026-10-12", "2026-10-19"]
    b, again = run_automations(b, "2026-10-14", AT, ["generate_visits"])
    assert again == []


def test_monthly_invoicing_waits_for_month_end():
    b, j = recurring_book(timing="monthly")
    b, _ = run(b, lambda tx: __import__("fieldservice.schedule", fromlist=["x"]).generate_visits(
        tx, j["id"], "2026-09-28", "2026-10-31"))
    for v in list(b["visits"]):
        if v["date"] <= "2026-10-12":
            b, _ = run(b, start_visit, v["id"], v["date"] + "T08:00:00-05:00")
            b, _ = run(b, finish_visit, v["id"], v["date"] + "T08:40:00-05:00")
    b, e1 = run_automations(b, "2026-10-20", AT, ["draft_invoices"])
    # September's one visit is billed; October has not ended
    assert len(e1) == 1 and b["invoices"][0]["period"] == "2026-09"
    assert b["invoices"][0]["lines"][0]["qty_milli"] == 1000
    b, e2 = run_automations(b, "2026-11-01", AT, ["draft_invoices"])
    assert b["invoices"][1]["period"] == "2026-10"
    assert b["invoices"][1]["lines"][0]["qty_milli"] == 2000       # two visits at $55
    assert b["invoices"][1]["subject"] == "Mow (2026-10)"


def test_fixed_price_and_on_completion():
    b, j = recurring_book(timing="on_completion", billing="fixed")
    b, v = run(b, schedule_visit, j["id"], "2026-10-05", "08:00", 30, ["m1"])
    b, _ = run(b, start_visit, v["id"], "2026-10-05T08:00:00-05:00")
    b, _ = run(b, finish_visit, v["id"], "2026-10-05T08:30:00-05:00")
    b, e = run_automations(b, "2026-10-06", AT, ["draft_invoices"])
    assert e == []                                        # waits for the job to close
    b, _ = run(b, close_job, j["id"], "2026-10-06")
    b, e = run_automations(b, "2026-10-07", AT, ["draft_invoices"])
    assert len(e) == 1 and b["invoices"][0]["lines"][0]["qty_milli"] == 1000


def test_reminders_queue_visit_overdue_and_quote_followup():
    b, j = recurring_book()
    b, v = run(b, schedule_visit, j["id"], "2026-10-06", "09:00", 30, ["m1"])
    b, inv = run(b, create_invoice, {"client_id": "c1", "job_id": j["id"], "date": "2026-09-01",
                                     "lines": [line("a", 5500)]})
    b, _ = run(b, send_invoice, inv["id"], "2026-09-01")       # due 2026-09-16
    b = apply(b, {"action": "create", "kind": "quotes", "record": {
        "id": "q9", "number": "Q-9", "client_id": "c2", "date": "2026-09-28", "lines": [line("a", 2000)]}})
    b, _ = run(b, send_quote, "q9", "2026-09-28")
    b, entries = run_automations(b, "2026-10-05", AT, ["reminders"])
    kinds = sorted((r["kind"], r["channel"], r["step"]) for r in b["reminders"])
    # visit tomorrow (email to Ann), invoice 19 days late: only the 14-day step, quote followed up by text to Bob
    assert kinds == [("invoice_overdue", "email", 14), ("quote_followup", "text", 3), ("visit", "email", 1)]
    vis = [r for r in b["reminders"] if r["kind"] == "visit"][0]
    assert vis["subject"] == "Reminder: visit on Tue, Oct 6, 2026"
    assert "at 9:00 AM at 1 Example St, Town TX 77000" in vis["body"]
    over = [r for r in b["reminders"] if r["kind"] == "invoice_overdue"][0]
    assert "19 days ago" in over["body"] and over["to"] == "ann@example.com"
    qf = [r for r in b["reminders"] if r["kind"] == "quote_followup"][0]
    assert qf["to"] == "(555) 010-0002" and qf["subject"] == ""
    b, again = run_automations(b, "2026-10-05", AT, ["reminders"])
    assert again == []
    b, later = run_automations(b, "2026-10-17", AT, ["reminders"])
    assert [r["step"] for r in b["reminders"] if r["kind"] == "invoice_overdue"] == [14, 30]


def test_switches_turn_rules_off():
    b = request_book()
    b, q = run(b, quote_from_request, "r1", "2026-10-01")
    b = apply(b, {"action": "update", "kind": "quotes", "record": dict(q, lines=[line("l1", 1000)])})
    b, _ = run(b, approve_quote, q["id"], None, "", "2026-10-02")
    b = dict(b, settings=dict(b["settings"], auto_quote_to_job=False))
    b, entries = run_automations(b, "2026-10-03", AT)
    assert entries == [] and b["jobs"] == []


def test_state_rules_refuse_bad_steps():
    b = request_book()
    b, q = run(b, quote_from_request, "r1", "2026-10-01")
    with pytest.raises(ServiceError, match="already converted"):
        run(b, quote_from_request, "r1", "2026-10-01")
    with pytest.raises(ServiceError, match="no line items"):
        run(b, send_quote, q["id"], "2026-10-01")
    b = apply(b, {"action": "update", "kind": "quotes", "record": dict(q, lines=[line("l1", 1000)])})
    with pytest.raises(ServiceError, match="not waiting"):
        run(b, request_changes, q["id"], "x", "2026-10-02")
    with pytest.raises(ServiceError, match="not an optional line"):
        run(b, approve_quote, q["id"], ["l1"], "", "2026-10-02")
    with pytest.raises(ServiceError):
        do(b, "no_such_step", [])
    b, j = recurring_book()
    b, v = run(b, schedule_visit, j["id"], "2026-10-06", "09:00", 30, ["m1"])
    with pytest.raises(ServiceError, match="before the start"):
        b2, _ = run(b, start_visit, v["id"], "2026-10-06T09:00:00-05:00")
        run(b2, finish_visit, v["id"], "2026-10-06T08:00:00-05:00")
    b, _ = run(b, move_visit, v["id"], "2026-10-07", "10:00", ["m2"])
    assert [x for x in b["visits"] if x["id"] == v["id"]][0]["crew_ids"] == ["m2"]
    b, _ = run(b, finish_visit, v["id"], "2026-10-07T11:00:00-05:00")
    with pytest.raises(ServiceError, match="cannot be moved"):
        run(b, move_visit, v["id"], "2026-10-08", "10:00", None)
    b, inv = run(b, invoice_job, j["id"], "2026-10-08", None, "")
    with pytest.raises(ServiceError, match="already on an invoice"):
        run(b, invoice_job, j["id"], "2026-10-08", [v["id"]], "")
    b, _ = run(b, void_invoice, inv["id"])
    assert [x for x in b["visits"] if x["id"] == v["id"]][0]["invoice_id"] == ""


def test_delete_refused_while_in_use():
    b, j = recurring_book()
    with pytest.raises(ServiceError, match="used by 1 property"):
        apply(b, {"action": "delete", "kind": "clients", "id": "c1"})
    with pytest.raises(ServiceError, match="already used"):
        apply(b, {"action": "create", "kind": "clients", "record": {"id": "c2", "name": "Dup"}})
    with pytest.raises(ServiceError, match="belongs to another client"):
        apply(b, {"action": "create", "kind": "jobs", "record": {"client_id": "c2", "property_id": "p1",
                                                                 "title": "x", "number": "J-9"}})
    tx = Tx(b)
    tx.delete("crew", "m2")
    assert [m["id"] for m in tx.book["crew"]] == ["m1"]


def test_a_step_that_cannot_be_done_is_skipped_and_the_rest_still_run():
    # Two visits at $6,000,000 each would make a $12,000,000 monthly line, over the cap.
    b, j = recurring_book(timing="monthly")
    b = apply(b, {"action": "update", "kind": "jobs", "record": dict(j, lines=[line("l1", 600_000_000)])})
    b, _ = run(b, lambda tx: __import__("fieldservice.schedule", fromlist=["x"]).generate_visits(
        tx, j["id"], "2026-10-01", "2026-10-12"))
    for v in list(b["visits"]):
        b, _ = run(b, start_visit, v["id"], v["date"] + "T08:00:00-05:00")
        b, _ = run(b, finish_visit, v["id"], v["date"] + "T08:40:00-05:00")
    b2, entries = run_automations(b, "2026-11-01", AT)
    assert b2["invoices"] == [] and all(e["rule"] != "draft_invoices" for e in entries)
    assert any(e["rule"] == "timesheets" for e in entries)
    assert all(v["invoice_id"] == "" for v in b2["visits"])
    # nothing was logged for the skipped step, so it runs once the price is fixed
    b3 = apply(b2, {"action": "update", "kind": "jobs", "record": dict(
        [x for x in b2["jobs"] if x["id"] == j["id"]][0], lines=[line("l1", 5500)])})
    b4, entries = run_automations(b3, "2026-11-01", AT, ["draft_invoices"])
    assert len(entries) == 1 and b4["invoices"][0]["lines"][0]["qty_milli"] == 2000


def test_a_line_over_the_cap_is_refused_when_saved():
    b = base_book()
    with pytest.raises(ServiceError, match="over \\$10,000,000.00"):
        run(b, create_job, {"client_id": "c1", "title": "Big", "lines": [line("l1", 1_000_000_000, qty=2000)]}, "", "")


def test_trimming_the_log_never_queues_a_reminder_again():
    from fieldservice.automation import trim_log
    from fieldservice.example import build_example
    b = build_example()
    b, _ = run_automations(b, "2026-10-23", "2026-10-23T06:30:00-05:00")
    assert any(e["rule"] == "reminders" for e in b["log"])
    # cutting the log down by plain slicing would forget the handled reminders
    naive = dict(b, log=b["log"][-2:])
    _, again = run_automations(naive, "2026-10-23", "2026-10-23T07:00:00-05:00", ["reminders"])
    assert again
    kept = dict(b, log=trim_log(b["log"], 2, "2026-10-23T06:45:00-05:00"))
    assert kept["log"][0]["rule"] == "kept_keys" and len([e for e in kept["log"] if e["rule"] != "kept_keys"]) == 2
    _, again = run_automations(kept, "2026-10-23", "2026-10-23T07:00:00-05:00", ["reminders"])
    assert again == []
    # trimming again carries the kept keys forward
    twice = trim_log(kept["log"] + kept["log"][-2:], 1, "2026-10-24T06:00:00-05:00")
    assert set(kept["log"][0]["keys"]) <= set(k for e in twice if e["rule"] == "kept_keys" for k in e["keys"])


def test_an_archived_clients_recurring_job_makes_no_new_visits():
    b, j = recurring_book()
    b = apply(b, {"action": "update", "kind": "clients", "record": dict(b["clients"][0], archived=True)})
    b2, entries = run_automations(b, "2026-10-07", AT, ["generate_visits"])
    assert entries == [] and b2["visits"] == []
    b3 = apply(b, {"action": "update", "kind": "clients", "record": dict(b["clients"][0], archived=False)})
    _, entries = run_automations(b3, "2026-10-07", AT, ["generate_visits"])
    assert len(entries) == 1
