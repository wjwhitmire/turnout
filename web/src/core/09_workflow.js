// ---- workflow (src/fieldservice/workflow.py): request, quote, job, visit, invoice, payment.

const QUOTE_OPEN = ["draft", "sent", "changes_requested"];
const nice = (s) => s.split("_").join(" ");

function docDefaults(book) {
  const s = book.settings;
  return { tax_rate_milli: s.tax_rate_milli, tax_mode: s.tax_mode, discount_kind: "pct", discount_value: 0 };
}
function linesForWork(lines) { return lines.filter(included).map((ln) => Object.assign({}, ln, { optional: false, selected: true })); }
function argObj(x, what) { if (!isObj(x)) fail("bad_field", `${what}: must be an object.`); return x; }

function createQuote(tx, fields) {
  const q = Object.assign(docDefaults(tx.book), argObj(fields, "quote"));
  if (!q.number) q.number = tx.nextNumber("quote");
  if (!q.valid_until && q.date && tx.book.settings.quote_valid_days) q.valid_until = addDays(q.date, tx.book.settings.quote_valid_days);
  if (!has(fields, "message")) q.message = tx.book.settings.quote_message;
  return tx.create("quotes", q);
}
function quoteFromRequest(tx, requestId, date) {
  const r = tx.need("requests", requestId);
  if (r.status === "converted" || r.status === "archived") fail("bad_state", "This request is already converted or archived.");
  const q = createQuote(tx, { client_id: r.client_id, property_id: r.property_id, request_id: r.id, date, title: r.title, notes: r.details });
  tx.patch("requests", r.id, { status: "converted", quote_id: q.id });
  return q;
}
function jobFromRequest(tx, requestId, date) {
  const r = tx.need("requests", requestId);
  if (r.status === "converted" || r.status === "archived") fail("bad_state", "This request is already converted or archived.");
  const j = createJob(tx, { client_id: r.client_id, property_id: r.property_id, title: r.title, instructions: r.details, kind: "one_off" }, "", "");
  tx.patch("requests", r.id, { status: "converted", job_id: j.id });
  return j;
}
function sendQuote(tx, quoteId, date) {
  const q = tx.need("quotes", quoteId);
  if (!QUOTE_OPEN.includes(q.status)) fail("bad_state", `Quote ${q.number} is ${nice(q.status)} and cannot be sent.`);
  if (!q.lines.length) fail("bad_state", `Quote ${q.number} has no line items.`);
  parseDate(date);
  return tx.patch("quotes", q.id, { status: "sent", sent_date: date });
}
function requestChanges(tx, quoteId, text, date) {
  const q = tx.need("quotes", quoteId);
  if (q.status !== "sent") fail("bad_state", `Quote ${q.number} is not waiting for a response.`);
  parseDate(date);
  return tx.patch("quotes", q.id, { status: "changes_requested", change_request: text });
}
function approveQuote(tx, quoteId, selected, by, date) {
  const q = tx.need("quotes", quoteId);
  if (!QUOTE_OPEN.includes(q.status)) fail("bad_state", `Quote ${q.number} is ${nice(q.status)} and cannot be approved.`);
  if (!q.lines.length) fail("bad_state", `Quote ${q.number} has no line items.`);
  parseDate(date);
  let lines = q.lines;
  if (selected !== null && selected !== undefined) {
    if (!Array.isArray(selected)) fail("bad_field", "selected: must be a list of line ids.");
    const ids = lines.filter((ln) => ln.optional).map((ln) => ln.id);
    for (const s of selected) if (!ids.includes(s)) fail("bad_field", `selected: ${show(s)} is not an optional line on this quote.`);
    lines = lines.map((ln) => (ln.optional ? Object.assign({}, ln, { selected: selected.includes(ln.id) }) : ln));
  }
  return tx.patch("quotes", q.id, { status: "approved", lines, approved_date: date, approved_by: by, sent_date: q.sent_date || date });
}
function convertQuote(tx, quoteId, date) {
  const q = tx.need("quotes", quoteId);
  if (q.status !== "approved") fail("bad_state", `Quote ${q.number} must be approved before it becomes a job.`);
  parseDate(date);
  const j = createJob(tx, { client_id: q.client_id, property_id: q.property_id, quote_id: q.id,
    title: q.title || `Work from quote ${q.number}`, kind: "one_off", lines: linesForWork(q.lines),
    discount_kind: q.discount_kind, discount_value: q.discount_value, tax_rate_milli: q.tax_rate_milli,
    tax_mode: q.tax_mode, instructions: q.notes }, "", "");
  tx.patch("quotes", q.id, { status: "converted", job_id: j.id });
  if (q.request_id) tx.patch("requests", q.request_id, { job_id: j.id });
  return j;
}

function createJob(tx, fields, frm, through) {
  const j = Object.assign(docDefaults(tx.book), argObj(fields, "job"));
  if (!j.number) j.number = tx.nextNumber("job");
  const job = tx.create("jobs", j);
  if (job.kind === "recurring" && through) generateVisits(tx, job.id, frm || job.start_date, through);
  return job;
}
function scheduleVisit(tx, jobId, date, startTime, durationMin, crewIds) {
  const job = tx.need("jobs", jobId);
  if (job.status !== "active") fail("bad_state", `Job ${job.number} is ${job.status}; reopen it to add visits.`);
  const v = newVisit(job, date);
  v.start_time = startTime;
  if (durationMin !== null && durationMin !== undefined) v.duration_min = durationMin;
  if (crewIds !== null && crewIds !== undefined) v.crew_ids = crewIds;
  return tx.create("visits", v);
}
function moveVisit(tx, visitId, date, startTime, crewIds) {
  const v = tx.need("visits", visitId);
  if (v.status === "completed" || v.status === "cancelled") fail("bad_state", "A completed or cancelled visit cannot be moved. Reopen it first.");
  const f = { date, start_time: startTime, route_seq: 0 };
  if (crewIds !== null && crewIds !== undefined) f.crew_ids = crewIds;
  return tx.patch("visits", v.id, f);
}
function startVisit(tx, visitId, stamp) {
  const v = tx.need("visits", visitId);
  if (v.status !== "scheduled") fail("bad_state", "Only a scheduled visit can be started.");
  stampLocal(stamp);
  return tx.patch("visits", v.id, { status: "in_progress", started_at: stamp });
}
function finishVisit(tx, visitId, stamp) {
  const v = tx.need("visits", visitId);
  if (v.status !== "scheduled" && v.status !== "in_progress") fail("bad_state", "This visit is already completed or cancelled.");
  stampLocal(stamp);
  if (v.started_at && elapsedMinutes(v.started_at, stamp) < 0) fail("bad_field", "The finish time is before the start time.");
  return tx.patch("visits", v.id, { status: "completed", finished_at: stamp });
}
function cancelVisit(tx, visitId) {
  const v = tx.need("visits", visitId);
  if (v.invoice_id) fail("bad_state", "This visit is on an invoice. Void the invoice first.");
  return tx.patch("visits", v.id, { status: "cancelled" });
}
function reopenVisit(tx, visitId) {
  const v = tx.need("visits", visitId);
  if (v.invoice_id) fail("bad_state", "This visit is on an invoice. Void the invoice first.");
  return tx.patch("visits", v.id, { status: "scheduled", started_at: "", finished_at: "" });
}
function checkItem(tx, visitId, itemId, done, note) {
  const v = tx.need("visits", visitId);
  let found = false;
  const items = v.checklist.map((c) => {
    if (c.id === itemId) { found = true; return Object.assign({}, c, { done, note }); }
    return c;
  });
  if (!found) fail("not_found", `There is no checklist item ${show(itemId)} on this visit.`);
  return tx.patch("visits", v.id, { checklist: items });
}
function closeJob(tx, jobId, date, cancelFuture = true) {
  const j = tx.need("jobs", jobId);
  if (j.status !== "active") fail("bad_state", `Job ${j.number} is already ${j.status}.`);
  parseDate(date);
  if (cancelFuture) {
    for (const v of tx.book.visits.slice()) {
      if (v.job_id === j.id && (v.status === "scheduled" || v.status === "in_progress") && v.date >= date && !v.invoice_id) {
        tx.patch("visits", v.id, { status: "cancelled" });
      }
    }
  }
  return tx.patch("jobs", j.id, { status: "closed", closed_date: date });
}
function reopenJob(tx, jobId) {
  const j = tx.need("jobs", jobId);
  return tx.patch("jobs", j.id, { status: "active", closed_date: "" });
}
// A recurring visit removed from the schedule: delete it and add its date to the job's skipped dates.
function skipVisit(tx, visitId) {
  const v = tx.need("visits", visitId);
  if (v.invoice_id) fail("bad_state", "This visit is on an invoice. Void the invoice first.");
  const j = tx.need("jobs", v.job_id);
  if (v.occurrence && j.rule) {
    const rule = Object.assign({}, j.rule, { exceptions: j.rule.exceptions.concat([v.occurrence]) });
    tx.patch("jobs", j.id, { rule });
  }
  tx.delete("visits", v.id);
  return v;
}

function scaleLines(lines, n) {
  return lines.map((ln) => {
    const q = ln.qty_milli * n;
    if (q > 1000000000) fail("too_large", `Line ${cpSlice(ln.name, 40)}: the quantity for ${n} visits is over 1,000,000.`);
    return Object.assign({}, ln, { qty_milli: q });
  });
}
function createInvoice(tx, fields) {
  const inv = Object.assign(docDefaults(tx.book), argObj(fields, "invoice"));
  const s = tx.book.settings;
  if (!inv.number) inv.number = tx.nextNumber("invoice");
  if (!inv.due_date) inv.due_date = addDays(inv.date, s.terms_days);
  if (!has(fields, "message")) inv.message = s.invoice_message;
  return tx.create("invoices", inv);
}
function invoiceJob(tx, jobId, date, visitIds = null, period = "") {
  const j = tx.need("jobs", jobId);
  parseDate(date);
  if (visitIds === null || visitIds === undefined) {
    visitIds = tx.book.visits.filter((v) => v.job_id === j.id && v.status === "completed" && !v.invoice_id).map((v) => v.id);
  }
  for (const vid of visitIds) {
    const v = tx.need("visits", vid);
    if (v.job_id !== j.id) fail("bad_ref", `Visit ${vid} is not on job ${j.number}.`);
    if (v.invoice_id) fail("bad_state", `Visit ${vid} is already on an invoice.`);
  }
  if (!j.lines.length) fail("bad_state", `Job ${j.number} has no line items to invoice.`);
  let lines;
  if (j.kind === "recurring" && j.billing === "per_visit") {
    if (!visitIds.length) fail("bad_state", `Job ${j.number} has no completed visits to invoice.`);
    lines = scaleLines(j.lines, visitIds.length);
  } else lines = j.lines.map((ln) => Object.assign({}, ln));
  let subject = j.title;
  if (period) subject = `${j.title} (${period})`;
  else if (j.kind === "recurring" && visitIds.length === 1) subject = `${j.title} (${tx.need("visits", visitIds[0]).date})`;
  const inv = createInvoice(tx, { client_id: j.client_id, property_id: j.property_id, job_id: j.id, visit_ids: visitIds.slice(),
    date, subject: cpSlice(subject, 200), lines, discount_kind: j.discount_kind, discount_value: j.discount_value,
    tax_rate_milli: j.tax_rate_milli, tax_mode: j.tax_mode, period });
  for (const vid of visitIds) tx.patch("visits", vid, { invoice_id: inv.id });
  if (j.quote_id) {
    const first = !tx.book.invoices.some((x) => x.job_id === j.id && x.id !== inv.id && x.status !== "void");
    if (first) {
      for (const p of tx.book.payments.slice()) if (p.quote_id === j.quote_id && !p.invoice_id) tx.patch("payments", p.id, { invoice_id: inv.id });
    }
  }
  return inv;
}
function sendInvoice(tx, invoiceId, date) {
  const inv = tx.need("invoices", invoiceId);
  if (inv.status === "void") fail("bad_state", `Invoice ${inv.number} is void.`);
  parseDate(date);
  return tx.patch("invoices", inv.id, { status: "sent", sent_date: inv.sent_date || date });
}
function voidInvoice(tx, invoiceId) {
  const inv = tx.need("invoices", invoiceId);
  if (tx.book.payments.some((p) => p.invoice_id === inv.id)) fail("bad_state", `Invoice ${inv.number} has payments. Delete or move them first.`);
  for (const vid of inv.visit_ids) tx.patch("visits", vid, { invoice_id: "" });
  return tx.patch("invoices", inv.id, { status: "void", visit_ids: [] });
}
function recordPayment(tx, fields, today) {
  const p = Object.assign({}, argObj(fields, "payment"));
  if (p.invoice_id) {
    const inv = tx.need("invoices", p.invoice_id);
    if (!has(p, "client_id")) p.client_id = inv.client_id;
    const st = invoiceState(tx.book, inv, today);
    if (inv.status === "void") fail("bad_state", `Invoice ${inv.number} is void.`);
    const amt = p.amount;
    if (isInt(amt) && amt > st.balance) fail("overpaid", `The payment is more than the balance of invoice ${inv.number}.`);
    if (inv.status === "draft") tx.patch("invoices", inv.id, { status: "sent", sent_date: p.date || today });
  } else if (p.quote_id) {
    const q = tx.need("quotes", p.quote_id);
    if (!has(p, "client_id")) p.client_id = q.client_id;
  }
  return tx.create("payments", p);
}
function addTime(tx, fields) {
  const t = Object.assign({}, argObj(fields, "time entry"));
  if (t.visit_id && !t.job_id) t.job_id = tx.need("visits", t.visit_id).job_id;
  return tx.create("timesheets", t);
}
function visitMinutes(v) { return v.started_at && v.finished_at ? Math.max(0, elapsedMinutes(v.started_at, v.finished_at)) : 0; }

const JOB_STATES = ["late", "requires_invoicing", "today", "upcoming", "unscheduled", "active", "closed", "archived"];
function jobState(book, job, today) {
  if (job.status === "archived") return "archived";
  const vs = book.visits.filter((v) => v.job_id === job.id && v.status !== "cancelled");
  const uninvoiced = vs.filter((v) => v.status === "completed" && !v.invoice_id);
  const hasInv = book.invoices.some((i) => i.job_id === job.id && i.status !== "void");
  if (job.status === "closed") {
    if (job.lines.length && (job.kind === "recurring" ? uninvoiced.length : !hasInv)) return "requires_invoicing";
    return "closed";
  }
  const openVs = vs.filter((v) => v.status === "scheduled" || v.status === "in_progress");
  if (openVs.some((v) => v.date < today)) return "late";
  if (job.lines.length && job.kind === "one_off" && vs.length && !openVs.length && !hasInv) return "requires_invoicing";
  if (job.kind === "recurring" && uninvoiced.length && job.invoice_timing === "after_visit") return "requires_invoicing";
  if (openVs.some((v) => v.date === today)) return "today";
  if (openVs.length) return "upcoming";
  if (!vs.length) return "unscheduled";
  return "active";
}

const STEPS = { create_quote: createQuote, quote_from_request: quoteFromRequest, job_from_request: jobFromRequest,
  send_quote: sendQuote, request_changes: requestChanges, approve_quote: approveQuote, convert_quote: convertQuote,
  create_job: createJob, schedule_visit: scheduleVisit, move_visit: moveVisit, start_visit: startVisit,
  finish_visit: finishVisit, cancel_visit: cancelVisit, reopen_visit: reopenVisit, check_item: checkItem,
  close_job: closeJob, reopen_job: reopenJob, invoice_job: invoiceJob, create_invoice: createInvoice,
  send_invoice: sendInvoice, void_invoice: voidInvoice, record_payment: recordPayment, add_time: addTime,
  generate_visits: generateVisits, skip_visit: skipVisit };

function doStep(book, step, args) {
  const fn = typeof step === "string" && has(STEPS, step) ? STEPS[step] : null;
  if (fn === null) fail("bad_step", `Unknown step ${show(step)}.`);
  if (!Array.isArray(args)) fail("bad_step", "args: must be a list.");
  const tx = new Tx(book);
  const r = fn(tx, ...args);
  return [tx.book, r];
}
