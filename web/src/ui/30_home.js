// ---------------------------------------------------------------- home: the day at a glance
PAGES.home = function (main) {
  const t = T();
  const ov = C.overview(B(), t);
  const todays = B().visits.filter((v) => v.date === t && v.status !== "cancelled");
  const unassigned = todays.filter((v) => !v.crew_ids.length).length;
  const late = B().visits.filter((v) => v.date < t && (v.status === "scheduled" || v.status === "in_progress")).length;
  const dbl = C.find_conflicts(B(), t, t).length;
  main.append(pageHead(dateText(t), "What needs doing today, from new requests to money owed."));
  main.append(keyrow(plate("Visits today", String(todays.length), `${unassigned} unassigned, ${late} late, ${dbl} double booking${dbl === 1 ? "" : "s"}`),
    "Requests turn into quotes, quotes into jobs, jobs into invoices. Each stage shows what is waiting on you."));
  const stage = (title, ic, page, lines, id) => {
    const a = el("a", { cls: "stage", href: "#" + page, id }, [el("h2", null, [icon(ic), title])]);
    for (const [n, label, tone] of lines) {
      a.append(el("div", { cls: "ln" + (tone === "bad" ? " alarm" : tone === "warn" ? " warn" : "") }, [el("span", { cls: "v", text: String(n) }),
        tone === "bad" ? glyph("alert") : tone === "warn" ? glyph("tag") : null, el("span", { text: label })]));
    }
    return a;
  };
  main.append(el("div", { cls: "pipe" }, [
    stage("Requests", "requests", "requests", [[ov.new_requests, "new or awaiting assessment"]], "flow-requests"),
    stage("Quotes", "quotes", "quotes", [[ov.quotes_draft, "draft"], [ov.quotes_awaiting, "awaiting response"], [ov.quotes_approved, "approved"]], "flow-quotes"),
    stage("Jobs", "jobs", "jobs", [[ov.jobs_late, "late", ov.jobs_late ? "bad" : ""], [ov.jobs_requires_invoicing, "requires invoicing", ov.jobs_requires_invoicing ? "warn" : ""], [ov.visits_today, "visits today"]], "flow-jobs"),
    stage("Invoices", "invoices", "invoices", [[ov.invoices_draft, "draft"], [ov.invoices_awaiting, "awaiting payment"], [ov.invoices_overdue, "past due, " + fmt(ov.overdue_amount), ov.invoices_overdue ? "bad" : ""]], "flow-invoices")]));
  const rows = sortVisits(todays).map(visitRow);
  const left = card("Today's visits", rows.length ? el("div", null, rows) : el("p", { cls: "muted", text: "No visits today." }), [btn("Open schedule", () => go("schedule"), "", { icon: "schedule" })]);
  const attention = [];
  const what = (href, text, cid) => el("span", null, [el("a", { cls: "rowlink", href, text }), el("span", { cls: "sub", text: clientName(cid) })]);
  for (const j of B().jobs) {
    const s = C.job_state(B(), j, t);
    if (s === "late" || s === "requires_invoicing") attention.push({ cells: [statusChip(s), what("#job/" + j.id, "Job " + j.number + ": " + j.title, j.client_id)], onClick: () => go("job", j.id) });
  }
  for (const inv of B().invoices) {
    const s = C.invoice_state(B(), inv, t);
    if (s.status === "overdue") attention.push({ cells: [statusChip("overdue", `Past due ${s.days_overdue} days`), what("#invoice/" + inv.id, `Invoice ${inv.number}: ${fmt(s.balance)}`, inv.client_id)], onClick: () => go("invoice", inv.id) });
  }
  for (const q of B().quotes) if (q.status === "approved" && !q.job_id) attention.push({ cells: [statusChip("approved"), what("#quote/" + q.id, "Quote " + q.number + " is approved", q.client_id)], onClick: () => go("quote", q.id) });
  const right = el("div", { cls: "stack" }, [
    card("Needs attention", table([{ h: "Status" }, { h: "What" }], attention, { empty: "Nothing is late or waiting." })),
    card("Recent automatic steps", autoList(B().log.filter((e) => e.rule !== "kept_keys").slice(-3).reverse(), true), [btn("Run now", runAutomationsNow, "", { id: "run-auto", icon: "automations" })]),
    ov.reminders_queued ? el("p", null, el("a", { cls: "link", href: "#reminders" }, [icon("reminders"), `${ov.reminders_queued} reminder draft${ov.reminders_queued === 1 ? "" : "s"} waiting for review`])) : null]);
  main.append(grid("g-7-5", [left, right]));
};

function sortVisits(vs) {
  return vs.slice().sort((a, b) => (a.date + (a.start_time || "99:99") + a.id < b.date + (b.start_time || "99:99") + b.id ? -1 : 1));
}
function visitState(v) {
  if (v.status === "scheduled" && v.date < T()) return "late";
  return v.status;
}
function visitRow(v) {
  const j = jobOf(v);
  const st = visitState(v);
  const tm = v.start_time ? timeText(v.start_time).split(" ") : ["Any", "time"];
  const a = el("a", { cls: "vrow s-" + stateOf(st)[0], href: "#" + APP.route.page, "data-visit": v.id }, [el("span", { cls: "tm" }, [tm[0], el("small", { text: tm[1] })]),
    el("span", { cls: "who" }, [el("b", { text: clientName(j.client_id) }), el("span", { text: j.title + " / " + (v.crew_ids.map(crewName).join(", ") || "Unassigned") })]), statusChip(st)]);
  a.addEventListener("click", (e) => { e.preventDefault(); openVisit(v.id); });
  return a;
}
async function runAutomationsNow() {
  const out = C.run_automations(B(), T(), nowStamp());
  if (!out[1].length) { toast("Nothing to do: every rule is up to date."); return; }
  APP.book = out[0];
  await saveBook();
  announceAutomations(out[1]);
  render();
}
