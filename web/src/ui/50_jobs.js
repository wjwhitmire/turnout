// ---------------------------------------------------------------- jobs, visits, costs, photos
PAGES.jobs = function (main) {
  const f = ui("job_f", "active");
  const all = B().jobs.map((j) => [j, C.job_state(B(), j, T())]);
  const n = (k) => all.filter(([j, s]) => (k === "all" ? true : k === "active" ? j.status === "active" : s === k)).length;
  main.append(pageHead("Jobs", "One-off and recurring work, its visits, and what it earned.", [btn("New job", () => editJob(null), "primary", { id: "new-job", icon: "plus" })]));
  main.append(filterBar([["active", "Active", n("active")], ["late", "Late", n("late")], ["requires_invoicing", "Requires invoicing", n("requires_invoicing")], ["today", "Today", n("today")], ["upcoming", "Upcoming", n("upcoming")], ["unscheduled", "Unscheduled", n("unscheduled")], ["closed", "Closed", n("closed")], ["all", "All", n("all")]], f, (v) => { setUi("job_f", v); render(); }));
  const rows = all.filter(([j, s]) => f === "all" || (f === "active" ? j.status === "active" : s === f))
    .sort((a, b) => (a[0].number < b[0].number ? 1 : -1))
    .map(([j, s]) => {
      const next = sortVisits(B().visits.filter((v) => v.job_id === j.id && v.status === "scheduled" && v.date >= T()))[0];
      return { cells: [el("span", null, [el("a", { cls: "rowlink", href: "#job/" + j.id, text: clientName(j.client_id) }), el("span", { cls: "sub", text: "Job " + j.number + ": " + j.title })]),
        j.kind === "recurring" && j.rule ? el("span", null, [icon("repeat"), " " + C.describe_rule(j.rule)]) : "One-off", next ? shortDate(next.date) : "", statusChip(s)], onClick: () => go("job", j.id) };
    });
  main.append(card("Job list", table([{ h: "Client and job" }, { h: "Schedule" }, { h: "Next visit" }, { h: "Status" }], rows, { empty: "No jobs here." })));
};

function ruleEditor(rule, idp) {
  const r = Object.assign({ freq: "weekly", interval: 1, days: [1], month_mode: "day", month_day: 1, nth: 1, weekday: 1, exceptions: [] }, rule || {});
  const freq = sel([["weekly", "Weekly"], ["monthly", "Monthly"], ["daily", "Every N days"]], r.freq, { id: idp + "-freq" });
  const interval = inp("number", r.interval, { id: idp + "-interval", min: 1, max: 366 });
  const dayBoxes = C.DAY_ABBR.map((d, i) => [i + 1, chk(r.days.includes(i + 1), { id: `${idp}-day-${i + 1}` }), d]);
  const days = el("fieldset", { cls: "days" }, [el("legend", { text: "On these days" })].concat(dayBoxes.map(([, c, d]) => field(d, c))));
  const mode = sel([["day", "On a day of the month"], ["nth", "On a weekday of the month"]], r.month_mode, { id: idp + "-mmode" });
  const mday = sel([[ "-1", "Last day"]].concat([...Array(31).keys()].map((i) => [String(i + 1), String(i + 1)])), String(r.month_day), { id: idp + "-mday" });
  const nth = sel([["1", "1st"], ["2", "2nd"], ["3", "3rd"], ["4", "4th"], ["-1", "Last"]], String(r.nth), { id: idp + "-nth" });
  const wd = sel(C.DAY_ABBR.map((d, i) => [String(i + 1), d]), String(r.weekday), { id: idp + "-wd" });
  const monthly = el("div", { cls: "form" }, [field("Monthly", mode), field("Day", mday, "A day past the month's end falls on its last day"), field("Which", nth), field("Weekday", wd)]);
  const label = el("p", { cls: "muted", "aria-live": "polite" });
  const show = () => {
    days.hidden = freq.value !== "weekly";
    monthly.hidden = freq.value !== "monthly";
    try { label.textContent = C.describe_rule(read()); } catch (e) { label.textContent = e.message; }
  };
  const read = () => C.check_record("rule", { freq: freq.value, interval: intOf(interval.value, "Repeat every") || 1, days: dayBoxes.filter(([, c]) => c.checked).map(([d]) => d),
    month_mode: mode.value, month_day: +mday.value, nth: +nth.value, weekday: +wd.value, exceptions: r.exceptions }, "schedule");
  for (const x of [freq, interval, mode, mday, nth, wd, ...dayBoxes.map(([, c]) => c)]) x.addEventListener("change", show);
  show();
  return { node: el("div", { cls: "rule form" }, [field("Repeats", freq), field("Repeat every (weeks, months or days)", interval), days, monthly, label]), read };
}

function editJob(j0) {
  if (!clientOptions().length) { toast("A job is for a client. Add the client; the job opens next."); editClient(null, (id) => editJob(Object.assign({}, j0 || {}, { client_id: id }))); return; }
  const s = B().settings;
  const j = Object.assign({ client_id: "", property_id: "", title: "", instructions: "", kind: "one_off", rule: null, start_date: T(), end_date: "", visit_limit: 0, start_time: "08:00", duration_min: 60,
    crew_ids: [], lines: [], billing: "per_visit", invoice_timing: "monthly", checklist: [], notes: "", discount_kind: "pct", discount_value: 0, tax_rate_milli: s.tax_rate_milli, tax_mode: s.tax_mode }, j0 || {});
  const cp = clientPropertyPick(j.client_id, j.property_id, "jb");
  const title = inp("text", j.title, { id: "jb-title" }), instr = inp("textarea", j.instructions, { id: "jb-instructions" });
  const kind = sel([["one_off", "One-off"], ["recurring", "Recurring"]], j.kind, { id: "jb-kind" });
  const re = ruleEditor(j.rule, "jb");
  const start = inp("date", j.start_date, { id: "jb-start" }), end = inp("date", j.end_date, { id: "jb-end" }), limit = inp("number", j.visit_limit || "", { id: "jb-limit", min: 0, max: 1000 });
  const time = inp("time", j.start_time, { id: "jb-time" }), dur = inp("number", j.duration_min, { id: "jb-dur", min: 0, max: 1440, step: 15 });
  const crew = crewChecks(j.crew_ids, "jb-crew");
  const billing = sel([["per_visit", "Per visit"], ["fixed", "Fixed price per invoice"]], j.billing, { id: "jb-billing" });
  const timing = sel([["monthly", "Monthly, after the month ends"], ["after_visit", "After each visit"], ["on_completion", "When the job closes"]], j.invoice_timing, { id: "jb-timing" });
  const checklist = inp("textarea", j.checklist.map((c) => c.text).join("\n"), { id: "jb-checklist", rows: 4 });
  const le = lineEditor(j.lines, { idp: "jb", plateLabel: "Job total", plateSub: "Per visit for recurring jobs billed per visit" });
  const pf = pricingFields(j, "jb");
  wireTotals(le, pf);
  const rec = el("div", { cls: "form" }, [re.node, field("Ends on (optional)", end), field("Stop after this many visits (optional)", limit), field("Bill", billing), field("Invoice", timing)]);
  const showKind = () => { rec.hidden = kind.value !== "recurring"; };
  kind.addEventListener("change", showKind);
  showKind();
  const w2 = (x) => { x.classList.add("w2"); return x; };
  openDialog({ title: j.id ? "Edit job " + j.number : "New job", wide: true, full: true, bar: true, body: el("div", null, [el("div", { cls: "hdr-g" }, [w2(cp.nodes[0]), w2(cp.nodes[1]), w2(field("Title", title)), field("Job type", kind),
    field("First visit date", start), field("Start time", time, "Blank for any time"), field("Visit length, minutes", dur), w2(field("Instructions for the crew", instr))]), crew.node, rec,
    el("h3", { cls: "sec", text: "Line items" }), le.node, el("div", { cls: "form-foot" }, [el("div", { cls: "stack" }, [field("Checklist, one item per line", checklist, "Copied to every visit"), el("div", { cls: "form" }, pf.nodes)]), le.totals])]),
  actions: [{ label: "Cancel" }, { spacer: true }, { label: "Save", primary: true, onClick: async () => {
    const isRec = kind.value === "recurring";
    const texts = checklist.value.split("\n").map((x) => x.trim()).filter((x) => x).slice(0, 100);
    const old = j.checklist;
    let n = old.reduce((m, c) => Math.max(m, +c.id.replace(/[^0-9]/g, "") || 0), 0);
    const used = new Set();
    const items = texts.map((t) => {
      const same = old.find((c) => c.text === t && !used.has(c.id));
      const id = same ? same.id : "k" + (++n);
      used.add(id);
      return { id, text: t };
    });
    const r = Object.assign({}, j, { client_id: cp.client(), property_id: cp.property(), title: title.value, instructions: instr.value, kind: kind.value, rule: isRec ? re.read() : j.rule,
      start_date: start.value, end_date: isRec ? end.value : j.end_date, visit_limit: isRec ? intOf(limit.value, "Visit limit") : j.visit_limit, start_time: time.value,
      duration_min: intOf(dur.value, "Visit length"), crew_ids: crew.value(), billing: billing.value, invoice_timing: timing.value, checklist: items, lines: le.value() }, pf.read());
    if (!isRec && !j.id) r.rule = null;
    let resynced = 0;
    const saved = await act((tx) => {
      if (j.id) {
        const up = tx.update("jobs", r);
        if (up.kind === "recurring" && up.status === "active") resynced = resyncVisits(tx, j, up);
        return up;
      }
      const created = STEP(tx, "create_job", [r, "", ""]);
      if (created.kind === "recurring") C.STEPS.generate_visits(tx, created.id, created.start_date, C.add_days(T(), B().settings.visit_horizon_days));
      else if (created.start_date) STEP(tx, "schedule_visit", [created.id, created.start_date, created.start_time, created.duration_min, created.crew_ids]);
      return created;
    }, { render: false });
    go("job", saved.id);
    if (resynced) toast(`${resynced} upcoming visit${resynced === 1 ? "" : "s"} updated to match the job.`);
  } }] });
}
// After a recurring job's schedule or visit defaults change, bring its upcoming visits in line, the
// way the paid tools ask to "update future visits". Only scheduled visits from today on that the
// series made and nobody moved by hand are touched; a visit on an invoice or with time, photos or
// costs on it stays. Dates the new schedule adds are created now.
function resyncVisits(tx, old, job) {
  const today = T();
  const through = C.add_days(today, B().settings.visit_horizon_days);
  const sig = (x) => JSON.stringify([x.kind, x.rule, x.start_date, x.end_date, x.visit_limit]);
  const schedChanged = sig(old) !== sig(job);
  const defaults = (x) => JSON.stringify([x.start_time, x.duration_min, x.crew_ids]);
  const defChanged = defaults(old) !== defaults(job);
  if (!schedChanged && !defChanged) return 0;
  const keep = schedChanged ? new Set(C.occurrences(job.rule, job.start_date, today, through, job.end_date, job.visit_limit)) : null;
  let n = 0;
  for (const v of tx.book.visits.slice()) {
    if (v.job_id !== job.id || v.status !== "scheduled" || !v.occurrence || v.date !== v.occurrence || v.date < today || v.invoice_id) continue;
    if (keep && !keep.has(v.occurrence)) {
      try { tx.delete("visits", v.id); n++; } catch (e) { if (!(e instanceof C.ServiceError)) throw e; }
      continue;
    }
    if (defChanged && defaults(v) === defaults(old)) { tx.patch("visits", v.id, { start_time: job.start_time, duration_min: job.duration_min, crew_ids: job.crew_ids }); n++; }
  }
  if (schedChanged) n += C.STEPS.generate_visits(tx, job.id, today, through).length;
  return n;
}

const JOB_WHY = { late: "A visit from before today is still open. Finish it, move it, or cancel it.", requires_invoicing: "Completed work has no invoice yet.",
  today: "A visit is on the board today.", upcoming: "The next visit is on the board.", unscheduled: "No visit is on the board yet. Add one, or drag the job from the tray on the Schedule.",
  closed: "This job is closed. Reopen it to add visits.", active: "" };
PAGES.job = function (main, id) {
  const j = byId("jobs", id);
  if (!j) { main.append(el("p", { text: "That job is not in this file." })); return; }
  const state = C.job_state(B(), j, T());
  const vs = sortVisits(B().visits.filter((v) => v.job_id === j.id));
  const invs = B().invoices.filter((n) => n.job_id === j.id);
  const draftInv = invs.find((n) => n.status === "draft");
  const acts = [btn("Edit", () => editJob(j), "", { id: "edit-job", icon: "edit" })];
  if (j.status === "active") acts.push(btn("Add visit", () => newVisitDialog(T(), j.id), "", { id: "job-add-visit", icon: "plus" }));
  const uninvoiced = vs.filter((v) => v.status === "completed" && !v.invoice_id);
  if (j.lines.length && (uninvoiced.length || (j.kind === "one_off" && !invs.some((n) => n.status !== "void")) || (j.kind === "recurring" && j.billing === "fixed"))) {
    acts.push(btn("Invoice now", async () => { const n = await act((tx) => STEP(tx, "invoice_job", [j.id, T(), j.kind === "recurring" && j.billing === "per_visit" ? null : uninvoiced.map((v) => v.id), ""]), { render: false }); go("invoice", n.id); }, state === "requires_invoicing" ? "primary" : "", { id: "invoice-job", icon: "invoices" }));
  } else if (draftInv) acts.push(btn("Open draft invoice", () => go("invoice", draftInv.id), "primary", { id: "open-draft-invoice", icon: "invoices" }));
  if (j.status === "active") acts.push(btn("Close job", async () => { if (await confirmDialog("Close job", "Close this job? Its unfinished visits from today on are cancelled.", "Close job")) await act((tx) => STEP(tx, "close_job", [j.id, T(), true])); }, "", { id: "close-job" }));
  else acts.push(btn("Reopen", () => act((tx) => STEP(tx, "reopen_job", [j.id])), "", { id: "reopen-job" }));
  main.append(pageHead("Job " + j.number, clientName(j.client_id) + ": " + j.title, acts, ["Jobs", "jobs"]));
  const jc = byId("clients", j.client_id);
  if (jc && jc.archived && j.kind === "recurring" && j.status === "active") {
    main.append(el("div", { cls: "notice", id: "job-archived-note" }, [icon("info"), el("span", { text: "The client is archived, so this job makes no new visits." }),
      btn("Undo", () => setClientArchived(jc.id, false), "link", { id: "job-unarchive" })]));
  }
  const [stc] = stateOf(state);
  let why = JOB_WHY[state] || "";
  if (state === "requires_invoicing" && draftInv) {
    const made = B().log.slice().reverse().find((e) => e.changes && e.changes.some((c) => c.kind === "invoices" && c.id === draftInv.id));
    why = `Draft invoice ${draftInv.number} is waiting for you to send it` + (made ? `; it was made by the rule ${ruleName(made.rule)}.` : ".");
  }
  if (why) main.append(el("div", { cls: "banner", style: `border-color:var(--st-${stc})` }, [el("span", { style: `color:var(--st-${stc})` }, glyph(stateOf(state)[1])),
    el("div", null, [el("b", { style: `color:var(--st-${stc})`, text: (STATUS_TEXT[state] || state) + ". " }), why])]));
  const p = propOf(j);
  const left = el("div", { cls: "stack" }, [
    card("Overview", kv([["Client", el("a", { href: "#client/" + j.client_id, text: clientName(j.client_id) })], ["Property", p ? C.address_line(p) : ""], ["Access", p ? p.access_notes : ""],
      ["Schedule", j.kind === "recurring" && j.rule ? C.describe_rule(j.rule) + ", from " + shortDate(j.start_date) + (j.end_date ? " to " + shortDate(j.end_date) : "") + (j.visit_limit ? `, ${j.visit_limit} visits` : "") : `One-off, ${vs.length} visit${vs.length === 1 ? "" : "s"}`],
      ["Visit time", (j.start_time ? timeText(j.start_time) : "Any time") + ", " + j.duration_min + " min"], ["Crew", j.crew_ids.map(crewName).join(", ")],
      ["Billing", j.kind === "recurring" ? (j.billing === "fixed" ? "Fixed price" : "Per visit") + ", " + { monthly: "monthly", after_visit: "after each visit", on_completion: "when the job closes" }[j.invoice_timing] : "Once the work is done"],
      ["Instructions", j.instructions], ["Quote", j.quote_id ? el("a", { href: "#quote/" + j.quote_id, text: byId("quotes", j.quote_id).number }) : ""]]), [statusChip(state)]),
    card("Visits", table([{ h: "When and crew" }, { h: "Checklist" }, { h: "Status" }, { h: "Invoice" }], vs.map((v) => ({ cells: [el("span", null, [el("b", { text: shortDate(v.date) + ", " + (v.start_time ? timeText(v.start_time) : "any time") }), el("span", { cls: "sub", text: v.crew_ids.map(crewName).join(", ") || "Unassigned" })]),
      v.checklist.length ? el("span", { cls: "mono", text: `${v.checklist.filter((c) => c.done).length}/${v.checklist.length}` }) : "", statusChip(visitState(v)), v.invoice_id ? byId("invoices", v.invoice_id).number : ""], onClick: () => openVisit(v.id) })), { empty: "No visits yet." }),
      j.status === "active" ? [btn("Add visit", () => newVisitDialog(T(), j.id), "", { icon: "plus" })] : null),
    card("Line items", docLinesTable(j))]);
  const costs = C.job_costs(B(), j);
  const ex = B().expenses.filter((x) => x.job_id === j.id);
  const ts = B().timesheets.filter((t) => t.job_id === j.id).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
  const ph = B().photos.filter((f) => f.job_id === j.id);
  const right = el("div", { cls: "stack" }, [
    card("Job costing", el("div", { cls: "stack" }, [plate("Profit", fmt(costs.profit), "Margin " + C.pct_text(costs.margin_bp)),
      kv([["Revenue", money(costs.revenue)], ["Revenue from", { invoiced: "Invoices", quoted: "Job line items (not invoiced yet)", none: "Nothing invoiced yet" }[costs.revenue_basis]],
        ["Labor", HOURS(costs.labor_min) + " hours, " + fmt(costs.labor_cost)], ["Materials and other costs", money(costs.materials)],
        ["Expected cost from line items", costs.expected_cost ? money(costs.expected_cost) : null]]),
      notice("Labor is each time entry's hours at that crew member's cost rate. Revenue counts invoices once there are any, otherwise the job's line items.", "info")])),
    card("Expenses", table([{ h: "Description" }, { h: "Date" }, { h: "Cost", n: true }], ex.map((x) => ({ cells: [el("span", null, [el("b", { text: x.description }), el("span", { cls: "sub", text: [x.vendor, qtyText(x.qty_milli) + " at " + fmt(x.unit_cost)].filter((y) => y).join(", ") })]), shortDate(x.date), money(C.mul_div(x.qty_milli, x.unit_cost, 1000))], onClick: () => editExpense(j.id, x) })), { empty: "No expenses yet." }),
      [btn("Add expense", () => editExpense(j.id, null), "", { id: "add-expense", icon: "plus" })]),
    card("Time", table([{ h: "Crew" }, { h: "Date" }, { h: "Hours", n: true }], ts.map((t) => ({ cells: [el("span", null, [el("b", { text: crewName(t.crew_id) }), el("span", { cls: "sub", text: t.kind + (t.source ? ", from " + t.source : "") })]), shortDate(t.date), el("span", { cls: "mono", text: HOURS(t.minutes) })], onClick: () => editTime(t) })), { empty: "No time yet." })),
    ph.length ? card("Photos", photoGrid(ph)) : null,
    card("Invoices", table([{ h: "Invoice" }, { h: "Status" }, { h: "Total", n: true }], invs.map((n) => { const s = C.invoice_state(B(), n, T()); return { cells: [el("span", null, [el("a", { cls: "rowlink", href: "#invoice/" + n.id, text: n.number }), el("span", { cls: "sub", text: shortDate(n.date) })]), statusChip(s.status), money(s.total)], onClick: () => go("invoice", n.id) }; }), { empty: "No invoices yet." }))]);
  main.append(grid("g-7-5", [left, right]));
};

function editExpense(jobId, x0) {
  const x = Object.assign({ job_id: jobId, date: T(), description: "", kind: "material", vendor: "", qty_milli: 1000, unit_cost: 0 }, x0 || {});
  const f = { date: inp("date", x.date, { id: "ex-date" }), description: inp("text", x.description, { id: "ex-desc" }), vendor: inp("text", x.vendor, { id: "ex-vendor" }),
    kind: sel([["material", "Materials"], ["equipment", "Equipment"], ["subcontract", "Subcontractor"], ["permit", "Permit or fee"], ["other", "Other"]], x.kind, { id: "ex-kind" }) };
  const qty = inp("text", qtyText(x.qty_milli), { id: "ex-qty", inputmode: "decimal" }), cost = inp("text", fmtPlain(x.unit_cost), { id: "ex-cost", inputmode: "decimal" });
  const actions = [{ label: "Cancel" }];
  if (x.id) actions.push({ label: "Delete", danger: true, onClick: () => act((tx) => tx.delete("expenses", x.id), { automate: false }) });
  actions.push({ label: "Save", primary: true, onClick: () => {
    const rec = Object.assign({}, x, { date: f.date.value, description: f.description.value, vendor: f.vendor.value, kind: f.kind.value, qty_milli: C.parse_milli(qty.value, "Quantity"), unit_cost: C.parse_money(cost.value, "Unit cost") });
    return act((tx) => (x.id ? tx.update("expenses", rec) : tx.create("expenses", rec)), { automate: false });
  } });
  openDialog({ title: x.id ? "Expense" : "Add expense", body: el("div", { cls: "form two" }, [field("Date", f.date), field("Description", f.description), field("Kind", f.kind), field("Vendor", f.vendor), field("Quantity", qty), field("Unit cost", cost)]), actions });
}

// ---------------------------------------------------------------- the visit sheet
function clockText(stamp) { return stamp ? timeText(stamp.slice(11, 16)) : ""; }
function checklistBox(v, big) {
  const items = v.checklist.map((c) => [c, chk(c.done, { id: "vc-" + c.id, "aria-label": c.text }), inp("text", c.note, { id: "vn-" + c.id, "aria-label": "Note for " + c.text, placeholder: "Note" })]);
  const prog = el("span", { cls: "prog" });
  const ul = el("ul", { cls: "ckl" });
  const sync = () => { prog.textContent = `${items.filter(([, b]) => b.checked).length} of ${items.length}`; };
  for (const [c, b, n] of items) {
    const li = el("li", { cls: c.done ? "on" : "" }, [b, el("label", { cls: "t", for: b.id, text: c.text }), big ? null : n]);
    b.addEventListener("change", () => { li.className = b.checked ? "on" : ""; sync(); });
    ul.append(li);
  }
  sync();
  return { node: items.length ? el("div", null, [el("div", { cls: "card-h" }, [el("h3", { text: "Checklist" }), prog]), ul]) : null, items };
}
function openVisit(id) {
  const v = byId("visits", id);
  if (!v) return;
  const j = jobOf(v);
  const p = propOf(j);
  const st = visitState(v);
  const box = el("div", null);
  box.append(kv([["Job", el("a", { href: "#job/" + j.id, text: j.number + " " + j.title })], ["Client", clientName(j.client_id)], ["Address", p ? C.address_line(p) : ""], ["Access", p ? p.access_notes : ""],
    ["When", dateText(v.date) + ", " + (v.start_time ? timeText(v.start_time) : "any time") + ", " + v.duration_min + " min"], ["Crew", v.crew_ids.map(crewName).join(", ") || "Unassigned"],
    ["Started", v.started_at ? el("span", { cls: "mono", text: clockText(v.started_at) }) : ""], ["Finished", v.finished_at ? el("span", { cls: "mono", text: clockText(v.finished_at) }) : ""], ["Instructions", j.instructions],
    ["Invoice", v.invoice_id ? el("a", { href: "#invoice/" + v.invoice_id, text: byId("invoices", v.invoice_id).number }) : ""]]));
  const open = v.status === "scheduled" || v.status === "in_progress";
  let dlg = null;
  const ck = checklistBox(v, false);
  const notes = inp("textarea", v.notes, { id: "visit-notes" });
  const save = (extra) => act((tx) => {
    let cur = tx.need("visits", v.id);
    const list = cur.checklist.map((c) => { const it = ck.items.find(([x]) => x.id === c.id); return it ? Object.assign({}, c, { done: it[1].checked, note: it[2].value }) : c; });
    cur = tx.patch("visits", v.id, { checklist: list, notes: notes.value });
    if (extra) extra(tx);
    return cur;
  });
  const run = async (fn) => { try { await fn(); if (dlg) dlg.close(); } catch (e) { showError(e); } };
  if (open) {
    const startB = v.status === "scheduled" ? btn("Start now", () => run(() => save((tx) => STEP(tx, "start_visit", [v.id, nowStamp()]))), "big primary", { icon: "start", id: "visit-start" })
      : btn("Started " + clockText(v.started_at), null, "big", { icon: "start", disabled: true });
    const finB = btn("Finish now", () => run(() => save((tx) => STEP(tx, "finish_visit", [v.id, nowStamp()]))), "big" + (v.status === "in_progress" ? " primary" : ""), { icon: "finish", id: "visit-finish" });
    box.append(el("div", { cls: "bigacts" }, [startB, finB]));
  }
  if (ck.node) box.append(ck.node);
  box.append(el("div", { style: "margin-top:14px" }, field("Visit notes", notes)));
  const ph = B().photos.filter((f) => f.visit_id === v.id);
  const canPhoto = v.status !== "cancelled" && !v.invoice_id;
  if (ph.length || canPhoto) {
    const g = photoGrid(ph);
    if (canPhoto) g.append(el("button", { type: "button", cls: "ph-tile ph-add", id: "visit-photo", on: { click: () => addPhoto(v) } }, [icon("camera"), "Add photo"]));
    box.append(el("div", { style: "margin-top:14px" }, g));
  }
  const actions = [];
  if (open) actions.push({ label: "Move", icon: "schedule", onClick: () => { moveDialog(v); } });
  if (open && j.kind === "recurring" && v.occurrence) actions.push({ label: "Skip this date", danger: true, onClick: async () => { if (await confirmDialog("Skip visit", "Remove this visit and skip its date in the schedule?", "Skip", true)) await act((tx) => STEP(tx, "skip_visit", [v.id])); } });
  else if (open) actions.push({ label: "Cancel visit", danger: true, onClick: () => act((tx) => STEP(tx, "cancel_visit", [v.id])) });
  if ((v.status === "completed" || v.status === "cancelled") && !v.invoice_id) actions.push({ label: "Reopen", onClick: () => act((tx) => STEP(tx, "reopen_visit", [v.id])) });
  actions.push({ spacer: true }, { label: "Save", primary: !open, onClick: () => save(null) });
  dlg = openDialog({ title: "Visit, " + shortDate(v.date), head: statusChip(st), wide: true, body: box, actions, noFocus: true });
}
function moveDialog(v) {
  const d = inp("date", v.date, { id: "mv-date" }), t = inp("time", v.start_time, { id: "mv-time" });
  const crew = crewChecks(v.crew_ids, "mv-crew");
  openDialog({ title: "Move visit", body: el("div", { cls: "form" }, [field("Date", d), field("Start time", t, "Blank for any time"), crew.node]),
    actions: [{ label: "Cancel" }, { label: "Move", primary: true, onClick: () => act((tx) => STEP(tx, "move_visit", [v.id, d.value, t.value, crew.value()])) }] });
}
function addPhoto(v) {
  pickFile("image/jpeg,image/png,image/webp", async (file) => {
    try {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new C.ServiceError("bad_file", "Choose a JPEG, PNG or WebP photo.");
      if (file.size > 25 * 1024 * 1024) throw new C.ServiceError("too_large", "The photo is larger than 25 MB.");
      const rec = await act((tx) => tx.create("photos", { job_id: v.job_id, visit_id: v.id, name: file.name.slice(0, 200) || "photo", mime: file.type, size: file.size, taken_at: nowStamp(), crew_id: v.crew_ids[0] || "" }), { automate: false, render: false });
      await putPhoto(rec.id, file);
      toast("Photo added.");
      render();
    } catch (e) { showError(e); }
  });
}
function photoGrid(list) {
  const g = el("div", { cls: "photos" });
  for (const f of list) {
    const fig = el("figure", { cls: "ph-fig" }, [el("figcaption", { text: f.caption || f.name })]);
    getPhoto(f.id).then((blob) => {
      if (!blob) { fig.prepend(el("div", { cls: "ph-tile", text: "Not on this device" })); return; }
      const url = URL.createObjectURL(blob);
      fig.prepend(el("img", { src: url, alt: f.caption || f.name, loading: "lazy" }));
    }).catch(() => {});
    g.append(fig);
  }
  return g;
}
