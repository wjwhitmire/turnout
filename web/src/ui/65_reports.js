// ---------------------------------------------------------------- reports
PAGES.reports = function (main) {
  const t = T();
  const preset = ui("rep_preset", "ytd");
  let frm = ui("rep_from", ""), to = ui("rep_to", "");
  if (preset === "month") { frm = t.slice(0, 8) + "01"; to = C.month_end(t); }
  else if (preset === "last") { const p = C.add_months(t.slice(0, 8) + "01", -1); frm = p; to = C.month_end(p); }
  else if (preset === "ytd") { frm = t.slice(0, 4) + "-01-01"; to = t; }
  else if (preset === "12m") { frm = C.add_months(t.slice(0, 8) + "01", -11); to = C.month_end(t); }
  if (!frm || !to) { frm = t.slice(0, 4) + "-01-01"; to = t; }
  const mStart = t.slice(0, 8) + "01";
  const mtd = C.revenue_by_month(B(), mStart, t).total.revenue;
  const pStart = C.add_months(mStart, -1);
  const pSame = C.add_days(pStart, Math.min(C.days_between(mStart, t), C.days_between(pStart, C.month_end(pStart))));
  const prev = C.revenue_by_month(B(), pStart, pSame).total.revenue;
  const FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const mName = FULL[+t.slice(5, 7) - 1];
  const change = prev ? Math.round(((mtd - prev) * 1000) / prev) / 10 : null;
  main.append(pageHead("Reports", "Revenue is invoiced before tax by invoice date; collected is payments by payment date.",
    [btn("Export to Crossfoot", () => go("settings"), "", { id: "rep-crossfoot", icon: "download" })]));
  main.append(keyrow(plate(`Revenue, ${mName} to date`, fmt(mtd), change === null ? "Nothing invoiced last month by this day" : `${change >= 0 ? "Up" : "Down"} ${Math.abs(change)}% on ${FULL[+pStart.slice(5, 7) - 1]} at the same day`),
    `The tables below cover ${dateText(frm)} to ${dateText(to)}.`));
  const fIn = inp("date", frm, { id: "rep-from" }), tIn = inp("date", to, { id: "rep-to" });
  const apply = () => { if (fIn.value && tIn.value && fIn.value <= tIn.value) { setUi("rep_preset", "custom"); setUi("rep_from", fIn.value); setUi("rep_to", tIn.value); render(); } };
  fIn.addEventListener("change", apply);
  tIn.addEventListener("change", apply);
  main.append(el("div", { cls: "sbar" }, [filterBar([["month", "This month"], ["last", "Last month"], ["ytd", "Year to date"], ["12m", "Last 12 months"], ["custom", "Custom"]], preset, (v) => { setUi("rep_preset", v); if (v === "custom") { setUi("rep_from", frm); setUi("rep_to", to); } render(); }, "Date range"), el("div", { cls: "range-f" }, [field("From", fIn), field("To", tIn)])]));
  const B0 = B();
  const csvBtns = (name, data, id) => [btn("Copy", () => copyText(C.report_csv(name, data), "CSV"), "ghost", { id: "copy-" + id, "aria-label": "Copy CSV" }), btn("CSV", () => saveFile(name + "-" + frm + "-" + to + ".csv", C.report_csv(name, data), "text/csv;charset=utf-8"), "", { id: "save-" + id, icon: "download", "aria-label": "Save CSV" })];

  const rev = C.revenue_by_month(B0, frm, to);
  const qc = C.quote_conversion(B0, frm, to);
  const ch = C.crew_hours(B0, frm, to);
  const left = card("Revenue and collected", [revenueChart(rev.rows), table([{ h: "Month" }, { h: "Invoices", n: true }, { h: "Revenue", n: true }, { h: "Tax", n: true }, { h: "Collected", n: true }],
    rev.rows.concat([rev.total]).map((r) => ({ cells: [r.month, el("span", { cls: "num", text: String(r.invoices) }), money(r.revenue), money(r.tax), money(r.collected)] })))], csvBtns("revenue_by_month", rev, "rev"));
  const meters = ch.rows.map((r) => el("div", { cls: "mtr" }, [el("div", { cls: "mtr-h" }, [el("span", { text: r.name }), el("span", { cls: "n", text: C.pct_text(r.utilization_bp) })]),
    el("div", { cls: "meter s-sched", role: "img", "aria-label": `${r.name}: ${C.pct_text(r.utilization_bp)} of available hours` }, el("i", { style: `width:${Math.max(0, Math.min(100, r.utilization_bp / 100))}%` })),
    el("span", { cls: "sub", text: `${HOURS(r.total_min)} of ${HOURS(r.available_min)} h, labor ${fmt(r.labor_cost)}` })]));
  const right = el("div", { cls: "stack" }, [
    card("Quote conversion", [el("div", { cls: "ov s-done", style: "border:0;padding:0" }, [el("span", { cls: "v", text: C.pct_text(qc.rate_bp) }), el("span", { cls: "s", text: `${qc.approved} approved of ${qc.sent} sent` })]),
      kv([["Changes requested", String(qc.changes_requested)], ["Still waiting", String(qc.awaiting)], ["Archived (lost)", String(qc.archived)], ["Value sent", money(qc.sent_value)], ["Value approved", money(qc.approved_value)], ["Value conversion", C.pct_text(qc.value_rate_bp)]])], csvBtns("quote_conversion", qc, "quotes")),
    card("Crew utilization", meters.length ? meters : el("p", { cls: "muted", text: "No crew yet." }), csvBtns("crew_hours", ch, "crew"))]);
  main.append(grid("g-8-4", [left, right]));

  const js = C.jobs_by_status(B0, t);
  main.append(card("Jobs by status (today)", table([{ h: "Status" }, { h: "Jobs", n: true }], js.rows.filter((r) => r.count).map((r) => ({ cells: [statusChip(r.status), el("span", { cls: "num", text: String(r.count) })], onClick: () => { setUi("job_f", r.status === "closed" ? "closed" : r.status); go("jobs"); } }))), csvBtns("jobs_by_status", js, "jobs")));

  const jp = C.job_profitability(B0, frm, to);
  main.append(card("Job profitability", table([{ h: "Job" }, { h: "" }, { h: "Revenue", n: true }, { h: "Labor", n: true }, { h: "Materials", n: true }, { h: "Profit", n: true }, { h: "Margin", n: true }],
    jp.rows.map((r) => ({ cells: [el("span", null, [el("b", { text: r.number }), el("span", { cls: "sub", text: r.title + (r.revenue_basis === "quoted" ? " (quoted)" : "") })]), "", money(r.revenue), money(r.labor_cost), money(r.materials), money(r.profit, r.profit < 0 ? "bad" : ""), C.pct_text(r.margin_bp)], onClick: () => go("job", r.job_id) }))
      .concat([{ cells: [el("strong", { text: "Total" }), "", money(jp.total.revenue), money(jp.total.labor_cost), money(jp.total.materials), money(jp.total.profit), C.pct_text(jp.total.margin_bp)] }])), csvBtns("job_profitability", jp, "profit")));

  const ag = C.aging(B0, t);
  main.append(card("Unpaid invoices by age (today)", table([{ h: "Client" }, { h: "Current", n: true }, { h: "1-30", n: true }, { h: "31-60", n: true }, { h: "61-90", n: true }, { h: "91+", n: true }, { h: "Total", n: true }],
    ag.rows.map((r) => ({ cells: [r.name, money(r.current), money(r["1_30"]), money(r["31_60"]), money(r["61_90"]), money(r["91_plus"]), money(r.total)], onClick: () => go("client", r.client_id) }))
      .concat([{ cells: [el("strong", { text: "Total" }), money(ag.total.current), money(ag.total["1_30"]), money(ag.total["31_60"]), money(ag.total["61_90"]), money(ag.total["91_plus"]), money(ag.total.total)] }])), csvBtns("aging", ag, "aging")));
};
function revenueChart(rows) {
  if (!rows.length) return null;
  const W = Math.max(360, rows.length * 112 + 40), H = 240, L = 48, Bt = 30, top = 20;
  const max = Math.max(1, ...rows.map((r) => Math.max(r.revenue, r.collected)));
  const step = niceStep(max / 3);
  const topV = step * 3 >= max ? step * 3 : step * 4;
  const y = (v) => top + (H - top - Bt) * (1 - v / topV);
  const kids = [];
  for (let v = 0; v <= topV; v += step) {
    kids.push(svgEl("line", { x1: L, x2: W - 10, y1: y(v).toFixed(1), y2: y(v).toFixed(1), stroke: "var(--chart-grid)" }));
    kids.push(svgEl("text", { cls: "ax", x: L - 6, y: (y(v) + 4).toFixed(1), "text-anchor": "end", text: "$" + (v >= 100000 ? Math.round(v / 100000) + "k" : Math.round(v / 100)) }));
  }
  const bw = (W - L - 10) / rows.length;
  rows.forEach((r, i) => {
    const x = L + i * bw;
    const w = Math.min(46, bw * 0.38);
    [["revenue", "var(--chart-1)", -1], ["collected", "var(--chart-2)", 1]].forEach(([k, fill, side]) => {
      const bx = x + bw / 2 + (side < 0 ? -w - 2 : 2);
      kids.push(svgEl("rect", { x: bx.toFixed(1), width: w.toFixed(1), y: y(r[k]).toFixed(1), height: Math.max(0, H - Bt - y(r[k])).toFixed(1), rx: 2, fill }, [svgEl("title", { text: `${r.month} ${k}: ${fmt(r[k])}` })]));
    });
    kids.push(svgEl("text", { cls: "ax", x: (x + bw / 2).toFixed(1), y: H - 10, "text-anchor": "middle", text: C.MONTHS[+r.month.slice(5, 7) - 1].slice(0, 3) + (rows.length > 12 ? " " + r.month.slice(2, 4) : "") }));
  });
  const svg = svgEl("svg", { cls: "chart", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Revenue and money collected by month" }, kids);
  return el("div", null, [el("div", { cls: "chart-wrap" }, svg), el("div", { cls: "lg" }, [el("span", null, [el("i", { style: "background:var(--chart-1)" }), "Revenue (sent invoices, before tax)"]), el("span", null, [el("i", { style: "background:var(--chart-2)" }), "Collected"])])]);
}
function niceStep(v) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, v))));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
function svgEl(tag, attrs, kids) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k of Object.keys(attrs || {})) {
    if (k === "text") e.textContent = attrs[k];
    else if (k === "cls") e.setAttribute("class", attrs[k]);
    else e.setAttribute(k, String(attrs[k]));
  }
  for (const c of kids || []) e.append(c);
  return e;
}
