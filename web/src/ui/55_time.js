// ---------------------------------------------------------------- timesheets
PAGES.timesheets = function (main) {
  const ws = ui("ts_week", "") || C.week_start(T());
  const days = [0, 1, 2, 3, 4, 5, 6].map((i) => C.add_days(ws, i));
  const move = (n) => { setUi("ts_week", C.add_days(ws, 7 * n)); render(); };
  const week = B().timesheets.filter((x) => x.date >= ws && x.date <= days[6]);
  const waiting = new Set(week.filter((x) => !x.approved).map((x) => x.crew_id));
  main.append(pageHead("Timesheets", "Visits started and finished in the app add job time by themselves (rule: Time from visits).",
    [btn("Export CSV", () => saveFile("timesheets-" + ws + ".csv", C.list_csv(B(), "timesheets", T()), "text/csv;charset=utf-8"), "", { id: "ts-csv", icon: "download" }), btn("Time entry", () => editTime(null), "primary", { id: "add-time", icon: "plus" })]));
  main.append(keyrow(plate("Hours this week", HOURS(week.reduce((a, x) => a + x.minutes, 0)), `${new Set(week.map((x) => x.crew_id)).size} crew, ${waiting.size} waiting for approval`), "Week of " + shortDate(ws) + "."));
  main.append(el("div", { cls: "sbar" }, [iconBtn("chev-l", "Previous week", () => move(-1), { id: "ts-prev", cls: "iconbtn bordered" }), btn("This week", () => { setUi("ts_week", C.week_start(T())); render(); }, "", { id: "ts-this" }), iconBtn("chev-r", "Next week", () => move(1), { id: "ts-next", cls: "iconbtn bordered" }),
    el("span", { cls: "date", text: shortDate(ws) + " to " + shortDate(days[6]) })]));
  const td = (d, kids) => el("td", { cls: d === T() ? "today" : "" }, kids);
  const t = el("table", { cls: "tsg" });
  t.append(el("thead", null, el("tr", null, [el("th", { scope: "col", text: "Crew" })].concat(days.map((d) => el("th", { scope: "col", cls: d === T() ? "today" : "", text: shortDate(d).replace(/,.*$/, "") }))).concat([el("th", { scope: "col", text: "Total" }), el("th", { scope: "col", text: "Labor cost" }), el("th", { scope: "col", text: "Approval" })]))));
  const tb = el("tbody");
  const dayTot = days.map(() => 0);
  let all = 0, allCost = 0;
  for (const m of B().crew) {
    const ts = week.filter((x) => x.crew_id === m.id);
    if (!m.active && !ts.length) continue;
    let tot = 0, cost = 0;
    const cells = days.map((d, i) => { const mins = ts.filter((x) => x.date === d).reduce((a, x) => a + x.minutes, 0); tot += mins; dayTot[i] += mins; return td(d, mins ? HOURS(mins) : ""); });
    for (const x of ts) cost += C.mul_div(x.minutes, m.cost_rate, 60);
    all += tot; allCost += cost;
    const open = ts.filter((x) => !x.approved);
    const appr = !ts.length ? "" : open.length ? btn("Approve", () => act((tx) => { for (const x of open) tx.patch("timesheets", x.id, { approved: true }); }, { automate: false }), "", { id: "approve-" + m.id })
      : el("span", { cls: "ok" }, [glyph("check"), "Approved"]);
    tb.append(el("tr", null, [el("th", { scope: "row" }, el("b", { text: m.name }))].concat(cells).concat([el("td", null, el("b", { text: HOURS(tot) })), el("td", null, money(cost)), el("td", null, appr)])));
  }
  t.append(tb, el("tfoot", null, el("tr", null, [el("td", { text: "Total" })].concat(days.map((d, i) => td(d, dayTot[i] ? HOURS(dayTot[i]) : ""))).concat([el("td", { text: HOURS(all) }), el("td", null, money(allCost)), el("td")]))));
  main.append(el("section", { cls: "card" }, el("div", { cls: "tbl-wrap" }, t)));
  const list = week.slice().sort((a, b) => (a.date + a.start_time < b.date + b.start_time ? -1 : 1));
  main.append(card("Entries", table([{ h: "Crew and date" }, { h: "Hours", n: true }, { h: "Job" }, { h: "Approved" }],
    list.map((x) => ({ cells: [el("span", null, [el("b", { text: crewName(x.crew_id) }), el("span", { cls: "sub", text: shortDate(x.date) + (x.start_time ? ", " + timeText(x.start_time) : "") + ", " + x.kind + (x.source ? ", from " + x.source : "") })]),
      el("span", { cls: "mono", text: HOURS(x.minutes) }), x.job_id ? byId("jobs", x.job_id).number : "", x.approved ? el("span", { cls: "ok" }, [glyph("check"), "Yes"]) : ""], onClick: () => editTime(x) })),
    { empty: "No time this week." }), [btn("Approve all", () => act((tx) => { for (const x of list) if (!x.approved) tx.patch("timesheets", x.id, { approved: true }); }, { automate: false }), "", { id: "approve-time", icon: "check" })]));
};
function editTime(t0) {
  if (!B().crew.length) { toast("Time is kept per crew member. Add the first one; the time entry opens next."); editCrew(null, () => editTime(t0)); return; }
  const t = Object.assign({ crew_id: B().crew[0].id, date: T(), start_time: "", minutes: 60, kind: "job", job_id: "", visit_id: "", source: "manual", note: "", approved: false }, t0 || {});
  const crew = sel(B().crew.map((m) => [m.id, m.name]), t.crew_id, { id: "tm-crew" });
  const date = inp("date", t.date, { id: "tm-date" }), start = inp("time", t.start_time, { id: "tm-start" });
  const end = inp("time", t.start_time ? C.time_str(Math.min(1440, C.parse_time(t.start_time) + t.minutes)) : "", { id: "tm-end" });
  const hours = inp("text", HOURS(t.minutes), { id: "tm-hours", inputmode: "decimal" });
  const kind = sel([["job", "Job"], ["travel", "Travel"], ["shop", "Shop"], ["other", "Other"]], t.kind, { id: "tm-kind" });
  const job = sel([["", "(none)"]].concat(B().jobs.filter((j) => j.status === "active" || j.id === t.job_id).map((j) => [j.id, j.number + " " + clientName(j.client_id)])), t.job_id, { id: "tm-job" });
  const note = inp("text", t.note, { id: "tm-note" });
  const sync = () => { if (start.value && end.value) { let m = C.parse_time(end.value) - C.parse_time(start.value); if (m < 0) m += 1440; hours.value = HOURS(m); } };
  start.addEventListener("change", sync);
  end.addEventListener("change", sync);
  const actions = [{ label: "Cancel" }];
  if (t.id) actions.push({ label: "Delete", danger: true, onClick: () => act((tx) => tx.delete("timesheets", t.id), { automate: false }) });
  actions.push({ label: "Save", primary: true, onClick: () => {
    const rec = Object.assign({}, t, { crew_id: crew.value, date: date.value, start_time: start.value, minutes: parseHours(hours.value), kind: kind.value, job_id: job.value, note: note.value });
    if (rec.visit_id && rec.job_id !== (byId("visits", rec.visit_id) || {}).job_id) rec.visit_id = "";
    return act((tx) => (t.id ? tx.update("timesheets", rec) : tx.create("timesheets", rec)), { automate: false });
  } });
  openDialog({ title: t.id ? "Time entry" : "Add time", body: el("div", { cls: "form" }, [field("Crew member", crew), field("Date", date), field("Start", start), field("End", end), field("Hours (h:mm or decimal)", hours), field("Kind", kind), field("Job", job), field("Note", note)]), actions });
}
// "1:30", "1.5" or "90m" to minutes.
function parseHours(s) {
  const t = String(s).trim();
  let m = /^([0-9]{1,2}):([0-5][0-9])$/.exec(t);
  if (m) return +m[1] * 60 + +m[2];
  m = /^([0-9]{1,4})m$/.exec(t);
  if (m) return +m[1];
  const q = C.parse_milli(t, "Hours");
  return C.mul_div(q, 60, 1000);
}

// ---------------------------------------------------------------- reminders queue
const REM_RULE = { visit: "Visit reminder", invoice_overdue: "Past due follow-up", quote_followup: "Quote follow-up", custom: "Reminder" };
PAGES.reminders = function (main) {
  const f = ui("rem_f", "queued");
  const n = (k) => B().reminders.filter((r) => k === "all" || r.status === k).length;
  main.append(pageHead("Reminders", "Drafts the automation rules wrote for you. Nothing is sent until you send it from your own email or phone."));
  main.append(keyrow(plate("To review", String(n("queued")), `${n("sent")} sent, ${n("dismissed")} dismissed`), "Each draft says which rule wrote it and why."));
  main.append(filterBar([["queued", "To review", n("queued")], ["sent", "Sent", n("sent")], ["dismissed", "Dismissed", n("dismissed")], ["all", "All", n("all")]], f, (v) => { setUi("rem_f", v); render(); }));
  const list = B().reminders.filter((r) => f === "all" || r.status === f).slice().sort((a, b) => (a.created + a.id < b.created + b.id ? 1 : -1));
  if (!list.length) { main.append(emptyState("Nothing to review", "When a visit is coming up, an invoice goes past due or a quote sits unanswered, a draft lands here.", [])); return; }
  const box = el("div", { cls: "rem" });
  for (const r of list.slice(0, 200)) {
    const step = r.kind === "invoice_overdue" && r.step ? `, day ${r.step}` : "";
    const open = r.channel === "email" ? el("a", { cls: "btn primary", href: mailto(r.to, r.subject, r.body), id: "rem-open-" + r.id }, [icon("mail"), el("span", { text: "Open email draft" })])
      : el("a", { cls: "btn primary", href: smsto(r.to, r.body), id: "rem-open-" + r.id }, [icon("text"), el("span", { text: "Open text draft" })]);
    const acts = r.status === "queued" ? [open, btn("Copy", () => copyText((r.subject ? r.subject + "\n\n" : "") + r.body, "Draft"), "", { icon: "copy" }),
      btn("Mark sent", () => act((tx) => tx.patch("reminders", r.id, { status: "sent" }), { automate: false }), "", { id: "rem-sent-" + r.id, icon: "check" }),
      btn("Dismiss", () => act((tx) => tx.patch("reminders", r.id, { status: "dismissed" }), { automate: false }), "ghost", { id: "rem-dismiss-" + r.id })] : [statusChip(r.status)];
    box.append(el("section", { cls: "card" }, [el("div", { cls: "rem-h" }, [icon(r.channel === "email" ? "mail" : "text"), el("b", { text: REM_RULE[r.kind] || "Reminder" }), el("span", { cls: "to", text: "To " + r.to }), el("span", { cls: "rule" }, [icon("reminders"), (REM_RULE[r.kind] || "Reminder") + step])]),
      el("div", { cls: "why" }, [icon("why"), el("span", null, [el("b", { text: "Why: " }), r.why])]),
      el("div", { cls: "draft" }, [r.subject ? el("span", { cls: "subj", text: r.subject }) : null, r.body]), el("div", { cls: "acts" }, acts)]));
  }
  main.append(box);
};

// ---------------------------------------------------------------- automations: switches, log and undo
const RULE_ICON = { quote_to_job: "quotes", generate_visits: "repeat", timesheets: "time", draft_invoices: "invoices", reminders: "reminders", route_order: "route" };
function ruleName(rule) { return C.RULE_TITLES[rule] || (rule === "route_order" ? "Route order" : rule); }
function ruleChip(rule) { return el("span", { cls: "rule" }, [icon(RULE_ICON[rule] || "automations"), ruleName(rule)]); }
PAGES.automations = function (main) {
  const s = B().settings;
  main.append(pageHead("Automations", "Each rule does a repetitive step for you, says why, and can be undone. Rules run whenever you change something and when the app opens.", [btn("Run now", runAutomationsNow, "primary", { id: "auto-run", icon: "automations" })]));
  const sw = el("div");
  for (const name of C.RULES) {
    const key = C.SWITCH[name];
    const on = !!s[key];
    const b = el("button", { type: "button", cls: "sw" + (on ? " on" : ""), role: "switch", "aria-checked": on ? "true" : "false", "aria-label": C.RULE_TITLES[name], id: "sw-" + name,
      on: { click: async () => { await setBook(C.update_settings(B(), { [key]: !on }), C.RULE_TITLES[name] + (!on ? " is on." : " is off.")); } } });
    sw.append(el("div", { cls: "swrow" }, [el("span", { cls: "t" }, [el("b", { text: C.RULE_TITLES[name] }), el("span", { text: RULE_HELP[name](s) })]), b]));
  }
  const log = B().log.filter((e) => e.rule !== "kept_keys").reverse();
  const shown = ui("auto_n", 20);
  main.append(grid("g-7-5", [card("What ran", el("div", null, [autoList(log.slice(0, shown), false), log.length > shown ? btn(`Show ${Math.min(50, log.length - shown)} more`, () => { setUi("auto_n", shown + 50); render(); }, "", { id: "auto-more" }) : null]), [el("span", { cls: "muted", text: log.length + " steps" })]),
    el("div", { cls: "stack" }, [card("Rules", sw), notice("An undone step never runs again for the same item. After 60 days an entry keeps its sentence and drops the record copies, so it can no longer be undone.", "info")])]));
};
const RULE_HELP = {
  quote_to_job: () => "An approved quote becomes a one-off job with the items the client chose.",
  generate_visits: (s) => `Recurring jobs get their visits created ${s.visit_horizon_days} days ahead (change it in Settings).`,
  timesheets: () => "A visit with a start and finish time gives each crew member on it a job time entry.",
  draft_invoices: () => "Completed work gets a draft invoice: one-off jobs when every visit is done, recurring jobs after each visit, monthly, or when the job closes.",
  reminders: (s) => `Drafts for visit reminders ${s.visit_reminder_days} day(s) ahead, past due invoices at ${s.overdue_steps.join(", ")} days, and quotes unanswered after ${s.quote_followup_days} days.`,
};
function recName(kind, rec) {
  if (!rec) return C.LABELS[kind];
  const label = C.LABELS[kind];
  const cap = label.charAt(0).toUpperCase() + label.slice(1);
  if (rec.number) return cap + " " + rec.number;
  if (kind === "visits") { const j = byId("jobs", rec.job_id); return "Visit " + shortDate(rec.date) + (j ? ", job " + j.number : ""); }
  if (kind === "timesheets") return "Time, " + crewName(rec.crew_id) + ", " + shortDate(rec.date);
  if (kind === "reminders") return "Reminder to " + rec.to;
  return cap + (rec.name ? " " + rec.name : "");
}
function recSummary(kind, rec) {
  if (!rec) return "Nothing";
  const bits = [];
  if (rec.status) bits.push(STATUS_TEXT[rec.status] || rec.status);
  if (kind === "visits") bits.push(rec.start_time ? timeText(rec.start_time) : "any time");
  if (kind === "timesheets") bits.push(HOURS(rec.minutes) + " h");
  if (rec.lines) { try { bits.push(fmt(C.doc_totals(rec).total)); } catch (e) { /* ignore */ } bits.push(rec.lines.length + " line" + (rec.lines.length === 1 ? "" : "s")); }
  return bits.join(", ") || "Saved";
}
// Why the Undo is off: the first record that differs from what the rule left.
function lockReason(e) {
  for (const c of e.changes) {
    const cur = (B()[c.kind] || []).find((r) => r.id === c.id) || null;
    if (!C.deep_equal(cur, c.after)) return `${recName(c.kind, cur || c.after)} was ${cur ? "edited" : "removed"} after this ran, so undo is off to keep your ${cur ? "edit" : "change"}.`;
  }
  return "";
}
function whyText(text) {
  const m = /((?:draft )?(?:invoice|job|quote) [0-9A-Za-z-]+)/i.exec(text);
  if (!m) return el("span", { text });
  return el("span", null, [text.slice(0, m.index), el("b", { text: m[1] }), text.slice(m.index + m[1].length)]);
}
function autoList(entries, compact) {
  if (!entries.length) return el("p", { cls: "muted", text: "Nothing has run yet." });
  const ul = el("ul", { cls: "auto" });
  for (const e of entries) {
    const at = e.at.slice(0, 10) === T() ? timeText(e.at.slice(11, 16)) : shortDate(e.at.slice(0, 10)) + ", " + timeText(e.at.slice(11, 16));
    const main = el("div", null, [el("div", { cls: "meta" }, [el("span", { cls: "mono", text: at }), ruleChip(e.rule)]), el("div", { cls: "why" }, [icon("why"), whyText(e.why)])]);
    const side = el("div", { cls: "side" });
    let lock = "";
    if (e.undone) main.append(el("div", { cls: "lockline" }, [icon("undo"), "Undone. It will not run again for the same item."]));
    else if (!e.changes.length) main.append(el("div", { cls: "lockline" }, [icon("info"), "Details dropped after 60 days."]));
    else if ((lock = lockReason(e))) main.append(el("div", { cls: "lockline" }, [icon("lock"), lock]));
    else side.append(btn("Undo", () => undoAuto(e.id), "", { id: "undo-" + e.id, icon: "undo", "aria-label": "Undo: " + ruleName(e.rule) + ", " + e.why.slice(0, 80) }));
    const li = el("li", { cls: e.undone ? "undone" : "" }, [main, side]);
    if (!compact && e.changes.length) {
      const g = el("div", { cls: "chg" }, [el("span", { cls: "h", text: "Record" }), el("span", { cls: "h", text: "Before" }), el("span", { cls: "h", text: "After" })]);
      for (const c of e.changes.slice(0, 30)) g.append(el("span", { text: recName(c.kind, c.after || c.before) }), el("span", { cls: "was", text: recSummary(c.kind, c.before) }), el("span", { text: c.after ? (c.before ? "" : "Created, ") + recSummary(c.kind, c.after) : "Deleted" }));
      if (e.changes.length > 30) g.append(el("span", { cls: "muted", text: `and ${e.changes.length - 30} more` }));
      li.append(el("details", null, [el("summary", null, [icon("list"), `What changed (${e.changes.length})`]), g]));
    }
    ul.append(li);
  }
  return ul;
}
async function undoAuto(id) {
  try {
    const out = C.undo_automation(B(), id);
    await setBook(out[0], "Undone. It will not run again for the same item.");
  } catch (e) { showError(e); }
}
