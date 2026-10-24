// ---- automation (src/fieldservice/automation.py): rules that do repetitive steps, say why,
// and can be undone.

const MAX_LOG = 10000;
const KEEP_DAYS = 60;
const RULES = ["quote_to_job", "generate_visits", "timesheets", "draft_invoices", "reminders"];
const SWITCH = { quote_to_job: "auto_quote_to_job", generate_visits: "auto_generate_visits", timesheets: "auto_timesheets",
  draft_invoices: "auto_draft_invoices", reminders: "auto_reminders" };
const RULE_TITLES = { quote_to_job: "Approved quote to job", generate_visits: "Recurring visits", timesheets: "Time from visits",
  draft_invoices: "Draft invoices", reminders: "Reminder drafts" };

function logKeys(book) { const out = new Set(); for (const e of book.log) for (const k of e.keys) out.add(k); return out; }

class Runner {
  constructor(book, today, at) { this.tx = new Tx(book); this.today = today; this.at = at; this.keys = logKeys(book); this.entries = []; }
  act(rule, keys, whyFn, fn) {
    keys = keys.filter((k) => !this.keys.has(k));
    if (!keys.length) return null;
    const start = this.tx.changes.length;
    const snap = this.tx.snapshot();
    let res;
    try { res = fn(); } catch (e) {
      // The step cannot be done with the data as it is (a line over the cap, say). Nothing of it
      // is kept and no key is logged, so it runs again once the data is fixed.
      if (!(e instanceof ServiceError)) throw e;
      this.tx.restore(snap);
      return null;
    }
    const ch = this.tx.changes.slice(start);
    if (!ch.length) return null;
    for (const k of keys) this.keys.add(k);
    const eid = this.tx.newId("a");
    this.entries.push({ id: eid, at: this.at, rule, why: cpSlice(whyFn(res), 500), keys, changes: ch.map((c) => Object.assign({}, c)), undone: false });
    return res;
  }
}
function crewName(tx, rid) { const r = tx.get("crew", rid); return r ? r.name : rid; }

function ruleQuoteToJob(r) {
  const tx = r.tx;
  for (const q of tx.book.quotes.slice()) {
    if (q.status !== "approved" || q.job_id) continue;
    r.act("quote_to_job", [`quote_to_job:${q.id}`],
      (j) => `Quote ${q.number} was approved on ${q.approved_date}` + (q.approved_by ? ` by ${q.approved_by}` : "") +
        `, so it became job ${j.number}. Schedule its visits on the dispatch board.`,
      () => convertQuote(tx, q.id, r.today));
  }
}
function ruleGenerateVisits(r) {
  const tx = r.tx;
  const through = addDays(r.today, tx.book.settings.visit_horizon_days);
  for (const j of tx.book.jobs.slice()) {
    let dates;
    try { dates = planVisits(tx.book, j, r.today, through); } catch (e) { if (e instanceof ServiceError) continue; throw e; }
    const fresh = dates.filter((d) => !r.keys.has(`visit:${j.id}:${d}`));
    if (!fresh.length) continue;
    r.act("generate_visits", fresh.map((d) => `visit:${j.id}:${d}`),
      (vs) => `Job ${j.number} repeats (${describeRule(j.rule)}). Visits are kept ${tx.book.settings.visit_horizon_days} days ahead, so ` +
        (vs.length === 1 ? `1 visit was added on ${vs[0].date}.` : `${vs.length} visits were added from ${vs[0].date} through ${vs[vs.length - 1].date}.`),
      () => fresh.map((d) => tx.create("visits", newVisit(j, d, d))));
  }
}
function ruleTimesheets(r) {
  const tx = r.tx;
  const have = new Set(tx.book.timesheets.filter((t) => t.visit_id).map((t) => t.visit_id + "\u0000" + t.crew_id));
  for (const v of tx.book.visits.slice()) {
    if (v.status !== "completed" || !v.started_at || !v.finished_at) continue;
    const mins = elapsedMinutes(v.started_at, v.finished_at);
    if (mins <= 0 || mins > 1440) continue;
    const crew = v.crew_ids.filter((c) => !have.has(v.id + "\u0000" + c));
    if (!crew.length) continue;
    const [d, st] = stampLocal(v.started_at);
    const job = tx.need("jobs", v.job_id);
    const names = crew.map((c) => crewName(tx, c)).join(", ");
    r.act("timesheets", crew.map((c) => `time:${v.id}:${c}`),
      () => `The visit on ${v.date} for job ${job.number} was started at ${timeWords(v.started_at.slice(11, 16))} and finished at ` +
        `${timeWords(v.finished_at.slice(11, 16))}, so ${names} got ${hm(mins)} of job time.`,
      () => crew.map((c) => tx.create("timesheets", { crew_id: c, date: d, start_time: pad(Math.floor(st / 60), 2) + ":" + pad(st % 60, 2),
        minutes: mins, kind: "job", job_id: v.job_id, visit_id: v.id, source: "visit" })));
  }
}
function ruleDraftInvoices(r) {
  const tx = r.tx;
  for (const j of tx.book.jobs.slice()) {
    if (j.status === "archived" || !j.lines.length) continue;
    const vs = tx.book.visits.filter((v) => v.job_id === j.id && v.status !== "cancelled");
    const done = vs.filter((v) => v.status === "completed" && !v.invoice_id);
    if (!done.length) continue;
    const openVs = vs.filter((v) => v.status === "scheduled" || v.status === "in_progress");
    if (j.kind === "one_off") {
      if (openVs.length || tx.book.invoices.some((i) => i.job_id === j.id && i.status !== "void")) continue;
      r.act("draft_invoices", [`invoice:${j.id}`],
        (inv) => `Every visit on job ${j.number} is complete, so draft invoice ${inv.number} was made from the job's line items. Review it, then send it.`,
        () => invoiceJob(tx, j.id, r.today, done.map((v) => v.id), ""));
      continue;
    }
    const t = j.invoice_timing;
    if (t === "after_visit") {
      for (const v of sortBy(done, (v) => [v.date, v.id])) {
        r.act("draft_invoices", [`invoice:${j.id}:${v.id}`],
          (inv) => `Job ${j.number} is invoiced after each visit, and the visit on ${v.date} is complete, so draft invoice ${inv.number} was made.`,
          () => invoiceJob(tx, j.id, r.today, [v.id], ""));
      }
    } else if (t === "monthly") {
      const months = new Map();
      for (const v of done) { const mo = v.date.slice(0, 7); if (!months.has(mo)) months.set(mo, []); months.get(mo).push(v.id); }
      for (const mo of [...months.keys()].sort()) {
        if (monthEnd(mo + "-01") >= r.today) continue;
        const ids = sortBy(months.get(mo), (x) => [tx.need("visits", x).date, x]);
        r.act("draft_invoices", [`invoice:${j.id}:${mo}`],
          (inv) => `Job ${j.number} is invoiced monthly and ${mo} has ended with ${ids.length} completed visit${ids.length !== 1 ? "s" : ""}, so draft invoice ${inv.number} was made.`,
          () => invoiceJob(tx, j.id, r.today, ids, mo));
      }
    } else if (j.status === "closed") {
      const ids = sortBy(done, (v) => [v.date, v.id]).map((v) => v.id);
      r.act("draft_invoices", [`invoice:${j.id}:close`],
        (inv) => `Job ${j.number} is invoiced when it closes, and it closed on ${j.closed_date}, so draft invoice ${inv.number} was made.`,
        () => invoiceJob(tx, j.id, r.today, ids, ""));
    }
  }
}
function queueReminder(r, key, client, kind, refId, step, why, draftFn) {
  const ch = pickChannel(client);
  if (ch === null) return;
  const d = draftFn(ch);
  r.act("reminders", [key], () => why,
    () => r.tx.create("reminders", { kind, ref_id: refId, step, due_date: r.today, channel: ch, to: contactFor(client, ch),
      subject: d.subject, body: d.body, status: "queued", created: r.today, why: cpSlice(why, 300) }));
}
function ruleReminders(r) {
  const tx = r.tx;
  const s = tx.book.settings;
  const today = r.today;
  if (s.visit_reminder_days > 0) {
    const last = addDays(today, s.visit_reminder_days);
    for (const v of sortBy(tx.book.visits, (v) => [v.date, v.start_time, v.id])) {
      if (v.status !== "scheduled" || !(today < v.date && v.date <= last)) continue;
      const job = tx.need("jobs", v.job_id);
      const client = tx.need("clients", job.client_id);
      const prop = job.property_id ? tx.get("properties", job.property_id) : null;
      const days = dayNum(v.date) - dayNum(today);
      queueReminder(r, `remind:visit:${v.id}:${v.date}`, client, "visit", v.id, days,
        `${client.name} has a visit on ${v.date} for job ${job.number}; reminders go out ${s.visit_reminder_days} day${s.visit_reminder_days !== 1 ? "s" : ""} ahead.`,
        (ch) => visitReminder(s, client, prop, job, v, ch));
    }
  }
  const steps = s.overdue_steps;
  for (const inv of sortBy(tx.book.invoices, (i) => [i.due_date, i.id])) {
    const st = invoiceState(tx.book, inv, today);
    if (st.status !== "overdue") continue;
    const reached = steps.filter((k) => st.days_overdue >= k);
    if (!reached.length) continue;
    const step = reached[reached.length - 1];
    const client = tx.need("clients", inv.client_id);
    const links = paymentOptions(s, st.balance, inv.number);
    queueReminder(r, `remind:invoice:${inv.id}:${step}`, client, "invoice_overdue", inv.id, step,
      `Invoice ${inv.number} is ${st.days_overdue} days past due with ${money(st.balance)} owing; the ${step}-day follow-up is due.`,
      (ch) => overdueReminder(s, client, inv, st, st.days_overdue, links, ch));
  }
  const fd = s.quote_followup_days;
  if (fd > 0) {
    for (const q of sortBy(tx.book.quotes, (q) => [q.sent_date, q.id])) {
      if (q.status !== "sent" || !q.sent_date || addDays(q.sent_date, fd) > today) continue;
      const client = tx.need("clients", q.client_id);
      const total = docTotals(q).total;
      queueReminder(r, `remind:quote:${q.id}:${q.sent_date}`, client, "quote_followup", q.id, fd,
        `Quote ${q.number} was sent on ${q.sent_date} and has had no answer for ${fd} day${fd !== 1 ? "s" : ""}.`,
        (ch) => quoteFollowup(s, client, q, total, ch));
    }
  }
}
const RULE_FNS = { quote_to_job: ruleQuoteToJob, generate_visits: ruleGenerateVisits, timesheets: ruleTimesheets,
  draft_invoices: ruleDraftInvoices, reminders: ruleReminders };

function runAutomations(book, today, at, only = null) {
  dayNum(today);
  stampLocal(at);
  const r = new Runner(book, today, at);
  for (const name of RULES) {
    if (only !== null && only !== undefined && !only.includes(name)) continue;
    if (!book.settings[SWITCH[name]]) continue;
    RULE_FNS[name](r);
  }
  const b = r.tx.book;
  const cut = addDays(today, -KEEP_DAYS);
  const old = book.log.filter((e) => e.changes.length && e.at.slice(0, 10) < cut);
  if (r.entries.length || old.length) {
    const log = book.log.map((e) => (e.changes.length && e.at.slice(0, 10) < cut ? Object.assign({}, e, { changes: [] }) : e)).concat(r.entries);
    b.log = trimLog(log, MAX_LOG, at);
  }
  return [b, r.entries];
}

const KEPT = "kept_keys";
const KEPT_WHY = "Reminders handled by steps too old to keep in the log, kept so they are never queued again.";
// Keep the newest cap entries. The reminder keys of the entries dropped (and of earlier kept_keys
// entries) are carried in compact kept_keys entries at the front, so dropping old entries never
// queues a reminder again.
function trimLog(log, cap, at) {
  const normal = log.filter((e) => e.rule !== KEPT);
  if (normal.length <= cap) return log;
  const drop = normal.slice(0, normal.length - cap);
  const seen = new Set(), carried = [];
  for (const e of log.filter((x) => x.rule === KEPT).concat(drop)) {
    for (const k of e.keys) if ((e.rule === KEPT || k.startsWith("remind:")) && !seen.has(k)) { seen.add(k); carried.push(k); }
  }
  const last = drop[drop.length - 1].id;
  const kept = [];
  for (let i = 0; i < carried.length; i += 5000) kept.push({ id: `kept${Math.floor(i / 5000)}-${last}`.slice(0, 40), at, rule: KEPT, why: KEPT_WHY, keys: carried.slice(i, i + 5000), changes: [], undone: false });
  return kept.concat(normal.slice(normal.length - cap));
}
function undoAutomation(book, logId) {
  let idx = -1;
  book.log.forEach((e, i) => { if (e.id === logId) idx = i; });
  if (idx < 0) fail("not_found", `There is no automation entry ${show(logId)}.`);
  const e = book.log[idx];
  if (e.undone) fail("bad_state", "This automation was already undone.");
  if (!e.changes.length) fail("too_old", `Automations older than ${KEEP_DAYS} days keep only their summary, so this one cannot be undone automatically.`);
  const tx = new Tx(book);
  for (const c of e.changes.slice().reverse()) {
    const cur = tx.get(c.kind, c.id);
    if (!deepEqual(cur, c.after)) {
      fail("changed_since", `The ${LABELS[c.kind]} ${c.id} was changed after this automation ran, so it cannot be undone automatically. Change it back by hand.`);
    }
    if (c.before === null) tx.delete(c.kind, c.id);
    else tx.put(c.kind, c.before);
  }
  const b = tx.book;
  const log = book.log.slice();
  log[idx] = Object.assign({}, e, { undone: true });
  b.log = log;
  return [b, log[idx]];
}
