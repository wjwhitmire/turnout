"""Automation rules: each one does a repetitive step for the person, says why, and can be
undone.

run_automations(book, today, at) runs every rule that is switched on in Settings and adds one
log entry per action: the rule, a plain sentence saying why, the keys of the things it
handled, and every record it created or changed (before and after). undo_automation(book,
log_id) puts those records back, but only while they are still exactly as the rule left
them, so an undo never overwrites the person's later work. An action whose key is already
in the log (done or undone) is never repeated, so an undone action stays undone. After 60
days an entry keeps its summary and keys but drops the record copies, and can no longer be
undone.

Rules, in the order they run:
  quote_to_job     an approved quote becomes a job
  generate_visits  recurring jobs get their visits created ahead, through today plus the
                   look-ahead in Settings (from today; past dates are never filled in)
  timesheets       a visit with a start and finish time gives each crew member on it a time
                   entry for the minutes between the two stamps
  draft_invoices   completed work gets a draft invoice: a one-off job once every visit is done;
                   a recurring job after each visit, after each calendar month ends, or when
                   the job is closed, as the job's invoicing setting says
  reminders        drafts queued for review: visit reminders the set number of days ahead,
                   overdue invoice follow-ups at the set steps (only the latest step reached is
                   queued), and quote follow-ups the set number of days after sending
Nothing is sent. Drafts wait in the reminders queue.
"""

from __future__ import annotations

from . import messages as W
from .book import Tx
from .money import doc_totals, invoice_state
from .paylinks import payment_options
from .schedule import describe_rule, plan_visits, new_visit
from .util import ServiceError, add_days, day_num, deep_equal, elapsed_minutes, fail, month_end, show, stamp_local
from .workflow import convert_quote, invoice_job

MAX_LOG = 10_000
KEEP_DAYS = 60
RULES = ("quote_to_job", "generate_visits", "timesheets", "draft_invoices", "reminders")
SWITCH = {"quote_to_job": "auto_quote_to_job", "generate_visits": "auto_generate_visits",
          "timesheets": "auto_timesheets", "draft_invoices": "auto_draft_invoices", "reminders": "auto_reminders"}


def log_keys(book: dict) -> set:
    out = set()
    for e in book["log"]:
        for k in e["keys"]:
            out.add(k)
    return out


class Runner:
    def __init__(self, book, today, at):
        self.tx = Tx(book)
        self.today = today
        self.at = at
        self.keys = log_keys(book)
        self.entries = []

    def act(self, rule, keys, why_fn, fn):
        """Run fn inside the Tx and log its changes. why_fn(result) gives the sentence."""
        keys = [k for k in keys if k not in self.keys]
        if not keys:
            return None
        start = len(self.tx.changes)
        snap = self.tx.snapshot()
        try:
            res = fn()
        except ServiceError:
            # The step cannot be done with the data as it is (a line over the cap, say). Nothing
            # of it is kept and no key is logged, so it runs again once the data is fixed.
            self.tx.restore(snap)
            return None
        ch = self.tx.changes[start:]
        if not ch:
            return None
        for k in keys:
            self.keys.add(k)
        eid = self.tx.new_id("a")
        e = {"id": eid, "at": self.at, "rule": rule, "why": why_fn(res)[:500], "keys": keys,
             "changes": [dict(c) for c in ch], "undone": False}
        self.entries.append(e)
        return res


def _name(tx, kind, rid, field="name"):
    r = tx.get(kind, rid)
    return r[field] if r else rid


def rule_quote_to_job(r: Runner):
    tx = r.tx
    for q in list(tx.book["quotes"]):
        if q["status"] != "approved" or q["job_id"]:
            continue
        r.act("quote_to_job", [f"quote_to_job:{q['id']}"],
              lambda j, q=q: (f"Quote {q['number']} was approved on {q['approved_date']}"
                              + (f" by {q['approved_by']}" if q["approved_by"] else "")
                              + f", so it became job {j['number']}. Schedule its visits on the dispatch board."),
              lambda q=q: convert_quote(tx, q["id"], r.today))


def rule_generate_visits(r: Runner):
    tx = r.tx
    through = add_days(r.today, tx.book["settings"]["visit_horizon_days"])
    for j in list(tx.book["jobs"]):
        try:
            dates = plan_visits(tx.book, j, r.today, through)
        except ServiceError:
            continue
        keys = [f"visit:{j['id']}:{d}" for d in dates]
        fresh = [d for d, k in zip(dates, keys) if k not in r.keys]
        if not fresh:
            continue

        def make(j=j, fresh=fresh):
            return [tx.create("visits", new_visit(j, d, d)) for d in fresh]

        r.act("generate_visits", [f"visit:{j['id']}:{d}" for d in fresh],
              lambda vs, j=j: (f"Job {j['number']} repeats ({describe_rule(j['rule'])}). Visits are kept "
                               f"{tx.book['settings']['visit_horizon_days']} days ahead, so "
                               + (f"1 visit was added on {vs[0]['date']}." if len(vs) == 1 else
                                  f"{len(vs)} visits were added from {vs[0]['date']} through {vs[-1]['date']}.")),
              make)


def rule_timesheets(r: Runner):
    tx = r.tx
    have = set((t["visit_id"], t["crew_id"]) for t in tx.book["timesheets"] if t["visit_id"])
    for v in list(tx.book["visits"]):
        if v["status"] != "completed" or not v["started_at"] or not v["finished_at"]:
            continue
        mins = elapsed_minutes(v["started_at"], v["finished_at"])
        if mins <= 0 or mins > 1440:
            continue
        crew = [c for c in v["crew_ids"] if (v["id"], c) not in have]
        if not crew:
            continue
        d, st = stamp_local(v["started_at"])
        job = tx.need("jobs", v["job_id"])

        def make(v=v, crew=crew, d=d, st=st, mins=mins):
            return [tx.create("timesheets", {"crew_id": c, "date": d, "start_time": f"{st // 60:02d}:{st % 60:02d}",
                                             "minutes": mins, "kind": "job", "job_id": v["job_id"],
                                             "visit_id": v["id"], "source": "visit"}) for c in crew]

        names = ", ".join(_name(tx, "crew", c) for c in crew)
        r.act("timesheets", [f"time:{v['id']}:{c}" for c in crew],
              lambda ts, v=v, job=job, names=names, mins=mins: (
                  f"The visit on {v['date']} for job {job['number']} was started at "
                  f"{W.time_words(v['started_at'][11:16])} and finished at {W.time_words(v['finished_at'][11:16])}, "
                  f"so {names} got {W.hm(mins)} of job time."),
              make)


def rule_draft_invoices(r: Runner):
    tx = r.tx
    for j in list(tx.book["jobs"]):
        if j["status"] == "archived" or not j["lines"]:
            continue
        vs = [v for v in tx.book["visits"] if v["job_id"] == j["id"] and v["status"] != "cancelled"]
        done = [v for v in vs if v["status"] == "completed" and not v["invoice_id"]]
        if not done:
            continue
        open_vs = [v for v in vs if v["status"] in ("scheduled", "in_progress")]
        if j["kind"] == "one_off":
            if open_vs or any(i["job_id"] == j["id"] and i["status"] != "void" for i in tx.book["invoices"]):
                continue
            r.act("draft_invoices", [f"invoice:{j['id']}"],
                  lambda inv, j=j: (f"Every visit on job {j['number']} is complete, so draft invoice {inv['number']} "
                                    f"was made from the job's line items. Review it, then send it."),
                  lambda j=j, done=done: invoice_job(tx, j["id"], r.today, [v["id"] for v in done], ""))
            continue
        t = j["invoice_timing"]
        if t == "after_visit":
            for v in sorted(done, key=lambda v: (v["date"], v["id"])):
                r.act("draft_invoices", [f"invoice:{j['id']}:{v['id']}"],
                      lambda inv, j=j, v=v: (f"Job {j['number']} is invoiced after each visit, and the visit on "
                                             f"{v['date']} is complete, so draft invoice {inv['number']} was made."),
                      lambda j=j, v=v: invoice_job(tx, j["id"], r.today, [v["id"]], ""))
        elif t == "monthly":
            months = {}
            for v in done:
                months.setdefault(v["date"][:7], []).append(v["id"])
            for mo in sorted(months.keys()):
                if month_end(mo + "-01") >= r.today:
                    continue
                ids = sorted(months[mo], key=lambda x: (tx.need("visits", x)["date"], x))
                r.act("draft_invoices", [f"invoice:{j['id']}:{mo}"],
                      lambda inv, j=j, mo=mo, ids=ids: (
                          f"Job {j['number']} is invoiced monthly and {mo} has ended with {len(ids)} completed "
                          f"visit{'s' if len(ids) != 1 else ''}, so draft invoice {inv['number']} was made."),
                      lambda j=j, ids=ids, mo=mo: invoice_job(tx, j["id"], r.today, ids, mo))
        elif j["status"] == "closed":
            ids = [v["id"] for v in sorted(done, key=lambda v: (v["date"], v["id"]))]
            r.act("draft_invoices", [f"invoice:{j['id']}:close"],
                  lambda inv, j=j: (f"Job {j['number']} is invoiced when it closes, and it closed on "
                                    f"{j['closed_date']}, so draft invoice {inv['number']} was made."),
                  lambda j=j, ids=ids: invoice_job(tx, j["id"], r.today, ids, ""))


def _queue(r: Runner, key: str, client: dict, kind: str, ref_id: str, step: int, why: str, draft_fn):
    ch = W.pick_channel(client)
    if ch is None:
        return
    d = draft_fn(ch)
    r.act("reminders", [key], lambda rem: why,
          lambda: r.tx.create("reminders", {"kind": kind, "ref_id": ref_id, "step": step, "due_date": r.today,
                                            "channel": ch, "to": W.contact_for(client, ch), "subject": d["subject"],
                                            "body": d["body"], "status": "queued", "created": r.today,
                                            "why": why[:300]}))


def rule_reminders(r: Runner):
    tx = r.tx
    s = tx.book["settings"]
    today = r.today
    if s["visit_reminder_days"] > 0:
        last = add_days(today, s["visit_reminder_days"])
        for v in sorted(tx.book["visits"], key=lambda v: (v["date"], v["start_time"], v["id"])):
            if v["status"] != "scheduled" or not (today < v["date"] <= last):
                continue
            job = tx.need("jobs", v["job_id"])
            client = tx.need("clients", job["client_id"])
            prop = tx.get("properties", job["property_id"]) if job["property_id"] else None
            days = day_num(v["date"]) - day_num(today)
            _queue(r, f"remind:visit:{v['id']}:{v['date']}", client, "visit", v["id"], days,
                   f"{client['name']} has a visit on {v['date']} for job {job['number']}; reminders go out "
                   f"{s['visit_reminder_days']} day{'s' if s['visit_reminder_days'] != 1 else ''} ahead.",
                   lambda ch, client=client, prop=prop, job=job, v=v: W.visit_reminder(s, client, prop, job, v, ch))
    steps = s["overdue_steps"]
    for inv in sorted(tx.book["invoices"], key=lambda i: (i["due_date"], i["id"])):
        st = invoice_state(tx.book, inv, today)
        if st["status"] != "overdue":
            continue
        reached = [k for k in steps if st["days_overdue"] >= k]
        if not reached:
            continue
        step = reached[-1]
        key = f"remind:invoice:{inv['id']}:{step}"
        client = tx.need("clients", inv["client_id"])
        links = payment_options(s, st["balance"], inv["number"])
        _queue(r, key, client, "invoice_overdue", inv["id"], step,
               f"Invoice {inv['number']} is {st['days_overdue']} days past due with {W.money(st['balance'])} "
               f"owing; the {step}-day follow-up is due.",
               lambda ch, client=client, inv=inv, st=st, links=links: W.overdue_reminder(
                   s, client, inv, st, st["days_overdue"], links, ch))
    fd = s["quote_followup_days"]
    if fd > 0:
        for q in sorted(tx.book["quotes"], key=lambda q: (q["sent_date"], q["id"])):
            if q["status"] != "sent" or not q["sent_date"] or add_days(q["sent_date"], fd) > today:
                continue
            client = tx.need("clients", q["client_id"])
            total = doc_totals(q)["total"]
            _queue(r, f"remind:quote:{q['id']}:{q['sent_date']}", client, "quote_followup", q["id"], fd,
                   f"Quote {q['number']} was sent on {q['sent_date']} and has had no answer for {fd} "
                   f"day{'s' if fd != 1 else ''}.",
                   lambda ch, client=client, q=q, total=total: W.quote_followup(s, client, q, total, ch))


RULE_FNS = {"quote_to_job": rule_quote_to_job, "generate_visits": rule_generate_visits,
            "timesheets": rule_timesheets, "draft_invoices": rule_draft_invoices, "reminders": rule_reminders}


def run_automations(book: dict, today: str, at: str, only=None) -> list:
    """Run the switched-on rules (or only the named ones). Returns [new_book, new log entries]."""
    day_num(today)
    stamp_local(at)
    r = Runner(book, today, at)
    for name in RULES:
        if only is not None and name not in only:
            continue
        if not book["settings"][SWITCH[name]]:
            continue
        RULE_FNS[name](r)
    b = r.tx.book
    cut = add_days(today, -KEEP_DAYS)
    old = [e for e in book["log"] if e["changes"] and e["at"][:10] < cut]
    if r.entries or old:
        log = [dict(e, changes=[]) if e["changes"] and e["at"][:10] < cut else e for e in book["log"]] + r.entries
        b["log"] = trim_log(log, MAX_LOG, at)
    return [b, r.entries]


KEPT = "kept_keys"
KEPT_WHY = "Reminders handled by steps too old to keep in the log, kept so they are never queued again."


def trim_log(log: list, cap: int, at: str) -> list:
    """Keep the newest cap entries. The reminder keys of the entries dropped (and of earlier
    kept_keys entries) are carried in compact kept_keys entries at the front, so dropping old
    entries never queues a reminder again."""
    normal = [e for e in log if e["rule"] != KEPT]
    if len(normal) <= cap:
        return log
    drop = normal[:len(normal) - cap]
    seen = set()
    carried = []
    for e in [e for e in log if e["rule"] == KEPT] + drop:
        for k in e["keys"]:
            if (e["rule"] == KEPT or k.startswith("remind:")) and k not in seen:
                seen.add(k)
                carried.append(k)
    last = drop[-1]["id"]
    kept = [{"id": f"kept{i // 5000}-{last}"[:40], "at": at, "rule": KEPT, "why": KEPT_WHY,
             "keys": carried[i:i + 5000], "changes": [], "undone": False} for i in range(0, len(carried), 5000)]
    return kept + normal[len(normal) - cap:]


def undo_automation(book: dict, log_id: str) -> list:
    """Undo one automation log entry. Refused when any record it touched has changed since.
    Returns [new_book, the entry]."""
    idx = -1
    for i, e in enumerate(book["log"]):
        if e["id"] == log_id:
            idx = i
    if idx < 0:
        fail("not_found", f"There is no automation entry {show(log_id)}.")
    e = book["log"][idx]
    if e["undone"]:
        fail("bad_state", "This automation was already undone.")
    if not e["changes"]:
        fail("too_old", f"Automations older than {KEEP_DAYS} days keep only their summary, so this one cannot be "
                        f"undone automatically.")
    tx = Tx(book)
    for c in reversed(e["changes"]):
        cur = tx.get(c["kind"], c["id"])
        if not deep_equal(cur, c["after"]):
            from .schema import LABELS
            fail("changed_since", f"The {LABELS[c['kind']]} {c['id']} was changed after this automation ran, so it "
                                  f"cannot be undone automatically. Change it back by hand.")
        if c["before"] is None:
            tx.delete(c["kind"], c["id"])
        else:
            tx.put(c["kind"], c["before"])
    b = tx.book
    log = list(book["log"])
    log[idx] = dict(e, undone=True)
    b["log"] = log
    return [b, log[idx]]
