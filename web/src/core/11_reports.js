// ---- reports (src/fieldservice/reports.py)

const BUCKETS = ["current", "1_30", "31_60", "61_90", "91_plus"];
const REPORTS = ["revenue_by_month", "jobs_by_status", "quote_conversion", "crew_hours", "job_profitability", "aging"];

function monthsBetween(frm, to) {
  parseDate(frm);
  parseDate(to);
  const out = [];
  let m = frm.slice(0, 7) + "-01";
  while (m <= to) {
    out.push(m.slice(0, 7));
    m = addMonths(m, 1);
    if (out.length > 240) break;
  }
  return out;
}
const billed = (inv) => inv.status === "sent";

function revenueByMonth(book, frm, to) {
  const months = monthsBetween(frm, to);
  const rows = new Map(months.map((m) => [m, { month: m, invoices: 0, revenue: 0, tax: 0, collected: 0 }]));
  for (const inv of book.invoices) {
    if (!billed(inv) || !(frm <= inv.date && inv.date <= to)) continue;
    const t = docTotals(inv);
    const r = rows.get(inv.date.slice(0, 7));
    r.invoices += 1; r.revenue += t.revenue; r.tax += t.tax;
  }
  for (const p of book.payments) if (frm <= p.date && p.date <= to) rows.get(p.date.slice(0, 7)).collected += p.amount;
  const out = months.map((m) => rows.get(m));
  const tot = { month: "Total", invoices: sum(out.map((r) => r.invoices)), revenue: sum(out.map((r) => r.revenue)),
    tax: sum(out.map((r) => r.tax)), collected: sum(out.map((r) => r.collected)) };
  return { rows: out, total: tot };
}
function jobsByStatus(book, today) {
  const counts = {}, ids = {};
  for (const s of JOB_STATES) { counts[s] = 0; ids[s] = []; }
  for (const j of book.jobs) { const s = jobState(book, j, today); counts[s] += 1; ids[s].push(j.id); }
  return { rows: JOB_STATES.map((s) => ({ status: s, count: counts[s], job_ids: ids[s] })), total: book.jobs.length };
}
function quoteConversion(book, frm, to) {
  let sent = 0, won = 0, changes = 0, waiting = 0, lost = 0, sentV = 0, wonV = 0;
  for (const q of book.quotes) {
    const d = q.sent_date;
    if (!d || !(frm <= d && d <= to)) continue;
    const t = docTotals(q).total;
    sent += 1; sentV += t;
    if (q.status === "approved" || q.status === "converted") { won += 1; wonV += t; }
    else if (q.status === "changes_requested") changes += 1;
    else if (q.status === "sent") waiting += 1;
    else if (q.status === "archived") lost += 1;
  }
  return { sent, approved: won, changes_requested: changes, awaiting: waiting, archived: lost, sent_value: sentV,
    approved_value: wonV, rate_bp: sent ? divRound(won * 10000, sent) : 0, value_rate_bp: sentV ? mulDiv(wonV, 10000, sentV) : 0 };
}
function crewHours(book, frm, to) {
  const days = daysBetween(frm, to) + 1;
  if (days < 1) return { rows: [], days: 0 };
  const rows = [];
  for (const m of book.crew) {
    const ts = book.timesheets.filter((t) => t.crew_id === m.id && frm <= t.date && t.date <= to);
    if (!m.active && !ts.length) continue;
    const by = { job: 0, travel: 0, shop: 0, other: 0 };
    let cost = 0;
    for (const t of ts) { by[t.kind] += t.minutes; cost += mulDiv(t.minutes, m.cost_rate, 60); }
    const total = by.job + by.travel + by.shop + by.other;
    const avail = divRound(m.weekly_minutes * days, 7);
    rows.push({ crew_id: m.id, name: m.name, job_min: by.job, travel_min: by.travel, shop_min: by.shop, other_min: by.other,
      total_min: total, available_min: avail, utilization_bp: avail ? mulDiv(by.job, 10000, avail) : 0, labor_cost: cost,
      billable_value: mulDiv(by.job, m.bill_rate, 60) });
  }
  return { rows, days };
}
function jobCosts(book, job) {
  const crew = new Map(book.crew.map((m) => [m.id, m]));
  let laborMin = 0, labor = 0;
  for (const t of book.timesheets) if (t.job_id === job.id) { laborMin += t.minutes; labor += mulDiv(t.minutes, crew.get(t.crew_id).cost_rate, 60); }
  const mats = sum(book.expenses.filter((x) => x.job_id === job.id).map((x) => mulDiv(x.qty_milli, x.unit_cost, 1000)));
  const invs = book.invoices.filter((i) => i.job_id === job.id && i.status !== "void");
  let revenue, basis;
  if (invs.length) { revenue = sum(invs.map((i) => docTotals(i).revenue)); basis = "invoiced"; }
  else { revenue = job.kind === "one_off" ? docTotals(job).revenue : 0; basis = revenue ? "quoted" : "none"; }
  const cost = labor + mats;
  const profit = revenue - cost;
  return { job_id: job.id, number: job.number, title: job.title, revenue, revenue_basis: basis, labor_min: laborMin,
    labor_cost: labor, materials: mats, cost, profit, margin_bp: revenue > 0 ? mulDiv(profit, 10000, revenue) : 0,
    expected_cost: docTotals(job).cost };
}
function jobProfitability(book, frm, to) {
  const rows = [];
  for (const j of book.jobs) {
    if (frm && to) {
      const dates = book.visits.filter((v) => v.job_id === j.id).map((v) => v.date)
        .concat(book.invoices.filter((i) => i.job_id === j.id).map((i) => i.date))
        .concat(book.timesheets.filter((t) => t.job_id === j.id).map((t) => t.date))
        .concat(book.expenses.filter((x) => x.job_id === j.id).map((x) => x.date));
      if (!dates.some((d) => frm <= d && d <= to)) continue;
    }
    rows.push(jobCosts(book, j));
  }
  const tot = {};
  for (const k of ["revenue", "labor_min", "labor_cost", "materials", "cost", "profit"]) tot[k] = sum(rows.map((r) => r[k]));
  tot.margin_bp = tot.revenue > 0 ? mulDiv(tot.profit, 10000, tot.revenue) : 0;
  return { rows, total: tot };
}
function bucketOf(days) {
  if (days <= 0) return "current";
  if (days <= 30) return "1_30";
  if (days <= 60) return "31_60";
  if (days <= 90) return "61_90";
  return "91_plus";
}
function aging(book, asOf) {
  dayNum(asOf);
  const clients = new Map(book.clients.map((c) => [c.id, c]));
  const per = new Map();
  const items = [];
  for (const inv of book.invoices) {
    if (!billed(inv) || inv.date > asOf) continue;
    const total = docTotals(inv).total;
    const paid = sum(book.payments.filter((p) => p.invoice_id === inv.id && p.date <= asOf).map((p) => p.amount));
    const bal = total - paid;
    if (bal <= 0) continue;
    const days = daysBetween(inv.due_date, asOf);
    const b = bucketOf(days);
    items.push({ invoice_id: inv.id, number: inv.number, client_id: inv.client_id, date: inv.date, due_date: inv.due_date,
      days: Math.max(days, 0), bucket: b, balance: bal });
    if (!per.has(inv.client_id)) {
      const row = { client_id: inv.client_id, name: clients.get(inv.client_id).name, total: 0 };
      for (const k of BUCKETS) row[k] = 0;
      per.set(inv.client_id, row);
    }
    const row = per.get(inv.client_id);
    row[b] += bal;
    row.total += bal;
  }
  const rows = sortBy([...per.values()], (r) => [-r.total, r.name, r.client_id]);
  const tot = {};
  for (const k of BUCKETS) tot[k] = sum(rows.map((r) => r[k]));
  tot.total = sum(rows.map((r) => r.total));
  return { rows, total: tot, items: sortBy(items, (i) => [i.due_date, i.number, i.invoice_id]) };
}
function overview(book, today) {
  const st = book.invoices.map((i) => invoiceState(book, i, today));
  const js = jobsByStatus(book, today);
  const cnt = {};
  for (const r of js.rows) cnt[r.status] = r.count;
  const count = (xs, f) => xs.filter(f).length;
  return {
    visits_today: count(book.visits, (v) => v.date === today && v.status !== "cancelled"),
    visits_done_today: count(book.visits, (v) => v.date === today && v.status === "completed"),
    new_requests: count(book.requests, (r) => r.status === "new" || r.status === "assessment"),
    quotes_draft: count(book.quotes, (q) => q.status === "draft"),
    quotes_awaiting: count(book.quotes, (q) => q.status === "sent" || q.status === "changes_requested"),
    quotes_approved: count(book.quotes, (q) => q.status === "approved"),
    jobs_late: cnt.late, jobs_requires_invoicing: cnt.requires_invoicing,
    invoices_draft: count(st, (s) => s.status === "draft"),
    invoices_awaiting: count(st, (s) => s.status === "awaiting"),
    invoices_overdue: count(st, (s) => s.status === "overdue"),
    receivable: sum(st.filter((s) => s.status === "awaiting" || s.status === "overdue").map((s) => s.balance)),
    overdue_amount: sum(st.filter((s) => s.status === "overdue").map((s) => s.balance)),
    reminders_queued: count(book.reminders, (r) => r.status === "queued"),
  };
}
