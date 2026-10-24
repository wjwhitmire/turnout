// ---- export (src/fieldservice/export.py): CSV lists and reports, Crossfoot import files,
// the read-only client page.

const LIST_KINDS = ["clients", "properties", "crew", "items", "requests", "quotes", "jobs", "visits", "timesheets",
  "expenses", "photos", "invoices", "payments", "reminders"];

function csvValue(f, v) {
  const t = f.t;
  if (t === "cents") return { $: v };
  if (t === "refs" || t === "ints" || t === "dates" || t === "strs") return v.map((x) => String(x)).join(";");
  if (t === "coord") return v === null ? "" : v;
  if (t === "obj") return "";
  return v;
}
function listCsv(book, kind, today) {
  if (typeof kind !== "string" || !LIST_KINDS.includes(kind)) fail("bad_kind", `Unknown list ${show(kind)}.`);
  const tbl = FIELD_TABLES[kind];
  const cols = Object.keys(tbl).filter((k) => tbl[k].t !== "list" && tbl[k].t !== "obj");
  let extra = [];
  if (kind === "quotes" || kind === "jobs" || kind === "invoices") extra = ["lines", "subtotal", "discount", "tax", "total"];
  if (kind === "invoices") extra = extra.concat(["paid", "balance", "state"]);
  if (kind === "jobs") extra = ["schedule"].concat(extra);
  if (kind === "visits") extra = ["checklist_done", "checklist_items"];
  const rows = [cols.concat(extra)];
  for (const r of book[kind]) {
    const row = cols.map((k) => csvValue(tbl[k], r[k]));
    if (kind === "jobs") row.push(r.kind === "recurring" && r.rule ? describeRule(r.rule) : "");
    if (kind === "quotes" || kind === "jobs" || kind === "invoices") {
      const t = docTotals(r);
      row.push(r.lines.length, { $: t.subtotal }, { $: t.discount }, { $: t.tax }, { $: t.total });
    }
    if (kind === "invoices") { const s = invoiceState(book, r, today); row.push({ $: s.paid }, { $: s.balance }, s.status); }
    if (kind === "visits") row.push(r.checklist.filter((c) => c.done).length, r.checklist.length);
    rows.push(row);
  }
  return toCsv(rows);
}
function linesCsv(book, kind) {
  if (!["quotes", "jobs", "invoices"].includes(kind)) fail("bad_kind", "Line items exist on quotes, jobs and invoices.");
  const rows = [["document_id", "number", "line_id", "item_id", "name", "description", "kind", "qty", "rate", "cost", "taxable",
    "optional", "selected", "amount"]];
  for (const d of book[kind]) {
    const t = docTotals(d);
    d.lines.forEach((ln, i) => {
      rows.push([d.id, d.number, ln.id, ln.item_id, ln.name, ln.description, ln.kind, milliText(ln.qty_milli), { $: ln.rate },
        { $: ln.cost }, ln.taxable, ln.optional, ln.selected, { $: t.lines[i].amount }]);
    });
  }
  return toCsv(rows);
}
function reportCsv(name, data) {
  let rows;
  if (name === "revenue_by_month") {
    rows = [["month", "invoices", "revenue", "tax", "collected"]];
    for (const r of data.rows.concat([data.total])) rows.push([r.month, r.invoices, { $: r.revenue }, { $: r.tax }, { $: r.collected }]);
  } else if (name === "jobs_by_status") {
    rows = [["status", "count"]].concat(data.rows.map((r) => [r.status, r.count])).concat([["total", data.total]]);
  } else if (name === "quote_conversion") {
    rows = [["measure", "value"]];
    for (const k of ["sent", "approved", "changes_requested", "awaiting", "archived"]) rows.push([k, data[k]]);
    rows.push(["sent_value", { $: data.sent_value }], ["approved_value", { $: data.approved_value }],
      ["conversion_rate", pctText(data.rate_bp)], ["value_conversion_rate", pctText(data.value_rate_bp)]);
  } else if (name === "crew_hours") {
    rows = [["crew_id", "name", "job_hours", "travel_hours", "shop_hours", "other_hours", "total_hours", "available_hours",
      "utilization", "labor_cost", "billable_value"]];
    for (const r of data.rows) {
      rows.push([r.crew_id, r.name, hm(r.job_min), hm(r.travel_min), hm(r.shop_min), hm(r.other_min), hm(r.total_min),
        hm(r.available_min), pctText(r.utilization_bp), { $: r.labor_cost }, { $: r.billable_value }]);
    }
  } else if (name === "job_profitability") {
    rows = [["job_id", "number", "title", "revenue", "revenue_basis", "labor_hours", "labor_cost", "materials", "cost", "profit",
      "margin", "expected_cost"]];
    for (const r of data.rows) {
      rows.push([r.job_id, r.number, r.title, { $: r.revenue }, r.revenue_basis, hm(r.labor_min), { $: r.labor_cost },
        { $: r.materials }, { $: r.cost }, { $: r.profit }, pctText(r.margin_bp), { $: r.expected_cost }]);
    }
    const t = data.total;
    rows.push(["", "", "Total", { $: t.revenue }, "", hm(t.labor_min), { $: t.labor_cost }, { $: t.materials }, { $: t.cost },
      { $: t.profit }, pctText(t.margin_bp), ""]);
  } else if (name === "aging") {
    rows = [["client_id", "name"].concat(BUCKETS).concat(["total"])];
    for (const r of data.rows) rows.push([r.client_id, r.name].concat(BUCKETS.map((b) => ({ $: r[b] }))).concat([{ $: r.total }]));
    rows.push(["", "Total"].concat(BUCKETS.map((b) => ({ $: data.total[b] }))).concat([{ $: data.total.total }]));
  } else fail("bad_report", `Unknown report ${show(name)}.`);
  return toCsv(rows);
}

// ---------------------------------------------------------------- Crossfoot

const INCOME = { service: "Service Income", material: "Materials Income", other: "Other Income" };
function iifText(s) { return squash(String(s).replace(/\t/g, " ").replace(/"/g, "'").replace(/\r/g, " ").replace(/\n/g, " ")); }
function iifDate(d) { const [y, m, dd] = parseDate(d); return `${m}/${dd}/${y}`; }
function customerNames(book) {
  const seen = new Set();
  const out = {};
  for (const c of sortBy(book.clients, (c) => [c.id])) {
    let n = cpSlice(iifText(c.name).replace(/:/g, "-"), 180) || c.id;
    let k = lower(n);
    if (seen.has(k)) { n = `${n} (${c.id})`; k = lower(n); }
    seen.add(k);
    out[c.id] = n;
  }
  return out;
}
function addrParts(book, c) {
  if (c.billing_address) return c.billing_address.split("\n").filter((x) => x).slice(0, 3).concat(["", "", ""]);
  for (const p of book.properties) if (p.client_id === c.id) return [p.street, [p.city, p.state, p.zip].filter((x) => x).join(" "), ""];
  return ["", "", ""];
}
function crossfootIif(book, frm, to) {
  parseDate(frm);
  parseDate(to);
  const names = customerNames(book);
  const terms = book.settings.terms_days;
  const invs = sortBy(book.invoices.filter((i) => i.status === "sent" && frm <= i.date && i.date <= to), (i) => [i.date, i.number, i.id]);
  const pays = sortBy(book.payments.filter((p) => frm <= p.date && p.date <= to), (p) => [p.date, p.id]);
  const used = new Set(invs.map((i) => i.client_id).concat(pays.map((p) => p.client_id)));
  const out = ["!ACCNT\tNAME\tACCNTTYPE\tDESC"];
  for (const k of ["service", "material", "other"]) out.push(`ACCNT\t${INCOME[k]}\tINC\tFrom the field service office`);
  out.push("!CUST\tNAME\tCOMPANYNAME\tEMAIL\tPHONE1\tBADDR1\tBADDR2\tBADDR3\tTERMS\tTAXABLE");
  for (const c of sortBy(book.clients, (c) => [lower(names[c.id]), c.id])) {
    if (!used.has(c.id)) continue;
    const a = addrParts(book, c);
    out.push(["CUST", names[c.id], iifText(c.company), iifText(c.email), iifText(c.phone), iifText(a[0]), iifText(a[1]), iifText(a[2]),
      `Net ${terms}`, "Y"].join("\t"));
  }
  out.push("!TRNS\tTRNSID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO\tDUEDATE");
  out.push("!SPL\tSPLID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO");
  out.push("!ENDTRNS");
  for (const inv of invs) {
    const t = docTotals(inv);
    if (t.total <= 0) continue;
    const nm = names[inv.client_id];
    const d = iifDate(inv.date);
    out.push(["TRNS", "", "INVOICE", d, "Accounts Receivable", nm, centsText(t.total), iifText(inv.number), iifText(inv.subject), iifDate(inv.due_date)].join("\t"));
    inv.lines.forEach((ln, i) => {
      const lt = t.lines[i];
      const net = lt.amount - lt.discount;
      if (!lt.included || net === 0) return;
      out.push(["SPL", "", "INVOICE", d, INCOME[ln.kind], nm, centsText(-net), iifText(inv.number), iifText(ln.name)].join("\t"));
    });
    if (t.tax) out.push(["SPL", "", "INVOICE", d, "Sales Tax Payable", nm, centsText(-t.tax), iifText(inv.number), "Sales tax"].join("\t"));
    out.push("ENDTRNS");
  }
  const invnum = new Map(book.invoices.map((i) => [i.id, i.number]));
  for (const p of pays) {
    const nm = names[p.client_id];
    const d = iifDate(p.date);
    const memo = p.invoice_id ? `Payment for ${invnum.get(p.invoice_id)}` : p.quote_id ? "Deposit" : "Payment";
    const ref = cpSlice(iifText(p.reference), 30);
    out.push(["TRNS", "", "PAYMENT", d, "Undeposited Funds", nm, centsText(p.amount), ref, iifText(`${memo} (${p.method})`)].join("\t"));
    out.push(["SPL", "", "PAYMENT", d, "Accounts Receivable", nm, centsText(-p.amount), ref, iifText(memo)].join("\t"));
    out.push("ENDTRNS");
  }
  return out.join("\r\n") + "\r\n";
}
function crossfootCustomersCsv(book) {
  const names = customerNames(book);
  const rows = [["Customer", "Company", "Email", "Phone", "Billing Address", "City", "State", "Zip", "Terms", "Notes"]];
  const terms = book.settings.terms_days;
  for (const c of sortBy(book.clients, (c) => [lower(names[c.id]), c.id])) {
    let street = "", city = "", state = "", zp = "";
    if (c.billing_address) street = c.billing_address.split("\n").join(", ");
    else {
      for (const p of book.properties) if (p.client_id === c.id) { street = p.street; city = p.city; state = p.state; zp = p.zip; break; }
    }
    rows.push([names[c.id], c.company, c.email, c.phone, street, city, state, zp, `Net ${terms}`, c.notes]);
  }
  return toCsv(rows);
}

// ---------------------------------------------------------------- client page

const CLIENT_CSS = "body{margin:0;background:#eef0f2}.cp{font:400 16px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-se" +
  "rif;color:#121417;padding:16px;--g-cut:#fff;max-width:760px;margin:0 auto}.cp-doc{background:#fff;border:1px s" +
  "olid #d5d9de;border-radius:10px;padding:18px}.cp-biz{display:flex;justify-content:space-between;gap:12px;paddi" +
  "ng-bottom:12px;border-bottom:3px solid #121417}.cp-biz b{font:800 20px/1.15 'Arial Narrow',system-ui,sans-seri" +
  "f;font-stretch:condensed}.cp-biz small{display:block;color:#4c535d;font-size:14px}.cp h1{font:800 22px/1.15 sy" +
  "stem-ui,sans-serif;margin:14px 0 2px}.cp h2{font:700 17px/1.25 system-ui,sans-serif;margin:16px 0 4px}.cp .stl" +
  "{display:inline-flex;align-items:center;gap:6px;min-height:28px;padding:0 9px 0 6px;border:1.5px solid current" +
  "Color;border-radius:4px;color:#123382;font-weight:650;font-size:14px}.cp .stl svg{width:16px;height:16px}.cp ." +
  "s-late{color:#c4300a}.cp .s-done{color:#127c4a}.cp .s-bill{color:#5c2e05}.cp .s-hold{color:#5d636b}.cp .meta{c" +
  "olor:#4c535d;font-size:14px;margin-top:6px}.cp-due{display:flex;flex-direction:column;background:#ffd31a;borde" +
  "r:2px solid #121417;border-radius:6px;padding:10px 14px 0;margin:14px 0;overflow:hidden}.cp-due span{font:700 " +
  "12px/1.2 system-ui,sans-serif;letter-spacing:.09em;text-transform:uppercase}.cp-due b{font:800 34px/1.1 system" +
  "-ui,sans-serif;font-variant-numeric:tabular-nums}.cp-due small{font-size:14px}.cp-due::after{content:'';displa" +
  "y:block;height:8px;margin:10px -14px 0;background:#aeb4bd;border-top:2px solid #121417}.cp .to{display:flex;fl" +
  "ex-wrap:wrap;gap:8px 28px;font-size:15px}.cp .to h3{font:700 12px/1.2 system-ui,sans-serif;letter-spacing:.09e" +
  "m;text-transform:uppercase;color:#4c535d;margin:10px 0 2px}.cp table{width:100%;border-collapse:collapse;font-" +
  "variant-numeric:tabular-nums;font-size:15px}.cp td{padding:8px 0;border-bottom:1px solid #e1e4e8;vertical-alig" +
  "n:top}.cp td.n{text-align:right;white-space:nowrap;padding-left:10px}.cp td small{display:block;color:#4c535d;" +
  "font-size:13px}.cp .opt{display:inline-block;font-size:12px;border:1.5px dashed #5d636b;color:#4c535d;border-r" +
  "adius:4px;padding:0 5px;margin-left:6px}.cp tr.off td{color:#4c535d}.cp tr.off td.n{text-decoration:line-throu" +
  "gh}.cp .tot td{border:0;padding:3px 0}.cp .pay{display:flex;flex-direction:column;gap:8px;margin-top:16px}.cp " +
  ".pay a,.cp .pay div{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:48px;pad" +
  "ding:6px 14px;border:1.5px solid #121417;border-radius:6px;color:#121417;font-weight:650;text-decoration:none;" +
  "overflow-wrap:anywhere}.cp .pay div{font-weight:400}.cp .pay a.first{background:#121417;color:#fff}.cp .qr{dis" +
  "play:flex;gap:12px;align-items:center;margin-top:14px;font-size:14px;color:#4c535d}.cp .qr svg{width:120px;hei" +
  "ght:120px;flex:none}.cp-foot{font-size:13px;color:#4c535d;margin-top:14px}@media print{body{background:#fff}.c" +
  "p-doc{border:0}}";
const CP_GLYPH = { "ring": "<circle cx=\"8\" cy=\"8\" r=\"5.2\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\"/>", "check": "<circle cx=\"8\" cy=\"8\" r=\"6.4\" fill=\"currentColor\"/><path d=\"M5 8.2l2 2 4-4.2\" fill=\"none\" stroke=\"#fff\" stroke-width=\"1.9\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>", "alert": "<path d=\"M8 1.6l7 12.6H1z\" fill=\"currentColor\"/><path d=\"M8 6.2v3.6M8 11.9v.1\" stroke=\"#fff\" stroke-width=\"1.9\" stroke-linecap=\"round\"/>", "tag": "<path d=\"M1.8 3.2h7.4l5 4.8-5 4.8H1.8z\" fill=\"currentColor\"/><circle cx=\"5\" cy=\"8\" r=\"1.4\" fill=\"#fff\"/>", "dash": "<circle cx=\"8\" cy=\"8\" r=\"5.2\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-dasharray=\"3.1 2.35\"/>", "void": "<circle cx=\"8\" cy=\"8\" r=\"5.2\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\"/><path d=\"M4.3 11.7l7.4-7.4\" stroke=\"currentColor\" stroke-width=\"2.2\"/>" };
const QUOTE_STATE = { draft: ["Draft", "s-hold", "dash"], sent: ["Awaiting your response", "s-sched", "ring"],
  changes_requested: ["Changes requested", "s-bill", "tag"], approved: ["Approved", "s-done", "check"], converted: ["Approved", "s-done", "check"],
  archived: ["Closed", "s-hold", "void"] };
const INVOICE_STATE = { draft: ["Draft", "s-hold", "dash"], void: ["Void", "s-hold", "void"], paid: ["Paid", "s-done", "check"],
  overdue: ["Past due", "s-late", "alert"], awaiting: ["Awaiting payment", "s-sched", "ring"] };
function paraHtml(s) { return s.split("\n").map(escHtml).join("<br>"); }
function cpRow(label, value, bold) {
  if (bold) return `<tr><td><b>${escHtml(label)}</b></td><td class="n"><b>${value}</b></td></tr>`;
  return `<tr><td>${escHtml(label)}</td><td class="n">${value}</td></tr>`;
}

function clientPage(book, kind, rid, today) {
  if (kind !== "quotes" && kind !== "invoices") fail("bad_kind", "A client page is made for a quote or an invoice.");
  let doc = null;
  for (const r of book[kind]) if (r.id === rid) doc = r;
  if (doc === null) fail("not_found", `There is no ${kind === "quotes" ? "quote" : "invoice"} ${show(rid)}.`);
  const s = book.settings;
  const client = book.clients.filter((c) => c.id === doc.client_id)[0];
  let prop = null;
  for (const p of book.properties) if (p.id === doc.property_id) prop = p;
  const t = docTotals(doc);
  const isQ = kind === "quotes";
  const title = (isQ ? "Quote " : "Invoice ") + doc.number;
  const h = ['<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'\">",
    '<meta name="referrer" content="no-referrer">',
    `<title>${escHtml(title)} from ${escHtml(s.business_name || "us")}</title><style>${CLIENT_CSS}</style></head>`,
    '<body><div class="cp"><div class="cp-doc">'];
  const contact = [s.phone, s.email].filter((x) => x).map(escHtml).join(" / ");
  h.push(`<div class="cp-biz"><div><b>${escHtml(s.business_name)}</b>` + (contact ? `<small>${contact}</small>` : "") +
    [s.address, s.website, s.license].filter((x) => x).map((x) => `<small>${paraHtml(x)}</small>`).join("") + "</div></div>");
  h.push(`<h1>${escHtml(title)}</h1>`);
  let word, cls, gl, meta, state = null;
  if (isQ) {
    [word, cls, gl] = QUOTE_STATE[doc.status];
    meta = [`Date: ${dateWords(doc.date)}`];
    if (doc.valid_until) meta.push(`Valid until: ${dateWords(doc.valid_until)}`);
    if (doc.approved_date) meta.push(`Approved: ${dateWords(doc.approved_date)}` + (doc.approved_by ? ` by ${doc.approved_by}` : ""));
  } else {
    state = invoiceState(book, doc, today);
    [word, cls, gl] = INVOICE_STATE[state.status];
    meta = [`Date: ${dateWords(doc.date)}`, `Due: ${dateWords(doc.due_date)}`];
  }
  h.push(`<span class="stl ${cls}"><svg viewBox="0 0 16 16" aria-hidden="true">${CP_GLYPH[gl]}</svg>${escHtml(word)}</span>`);
  h.push('<div class="meta">' + meta.map(escHtml).join("<br>") + "</div>");
  let payAmount = 0, qs = null;
  if (isQ) {
    qs = quoteState(book, doc);
    const dep = doc.deposit ? `<small>Deposit required: ${money(doc.deposit)}</small>` : "";
    h.push(`<div class="cp-due"><span>Quote total</span><b>${money(t.total)}</b>${dep}</div>`);
    payAmount = ["sent", "changes_requested", "approved"].includes(doc.status) ? qs.deposit_due : 0;
  } else {
    h.push(`<div class="cp-due"><span>Amount due</span><b>${money(Math.max(state.balance, 0))}</b></div>`);
    payAmount = state.status === "awaiting" || state.status === "overdue" ? state.balance : 0;
  }
  const who = [client.name, client.company].concat(client.billing_address ? [client.billing_address] : []);
  h.push('<div class="to"><div><h3>For</h3>' + who.filter((x) => x).map(paraHtml).join("<br>") + "</div>");
  if (prop !== null) h.push("<div><h3>Service address</h3>" + paraHtml(prop.label ? prop.label + "\n" + addressLine(prop) : addressLine(prop)) + "</div>");
  h.push("</div>");
  const subj = isQ ? doc.title : doc.subject;
  if (subj) h.push(`<h2>${escHtml(subj)}</h2>`);
  h.push("<table><tbody>");
  for (const ln of doc.lines) {
    let tag = "";
    const off = ln.optional && !ln.selected;
    if (ln.optional) tag = '<span class="opt">' + (ln.selected ? "Optional, chosen" : "Optional, not chosen") + "</span>";
    const trc = off ? ' class="off"' : "";
    h.push(`<tr${trc}><td>${escHtml(ln.name)}${tag}<small>Qty ${milliText(ln.qty_milli)} at ${money(ln.rate)}</small>` +
      (ln.description ? `<small>${paraHtml(ln.description)}</small>` : "") + `</td><td class="n">${money(lineAmount(ln))}</td></tr>`);
  }
  h.push('</tbody></table><table class="tot"><tbody>');
  h.push(cpRow("Subtotal", money(t.subtotal)));
  if (t.discount) h.push(cpRow("Discount", money(-t.discount)));
  if (t.tax || doc.tax_rate_milli) h.push(cpRow(`Tax (${milliText(doc.tax_rate_milli)}%)`, money(t.tax)));
  h.push(cpRow("Total", money(t.total), true));
  if (isQ) {
    if (doc.deposit) {
      h.push(cpRow("Deposit required", money(doc.deposit)));
      if (qs.deposit_paid) h.push(cpRow("Deposit received", `(${money(qs.deposit_paid)})`));
    }
    if (t.optional_total && doc.lines.some((ln) => ln.optional && !ln.selected)) h.push('<tr><td colspan="2"><small>Optional items not chosen are not in the total.</small></td></tr>');
  } else {
    if (state.paid) h.push(cpRow("Paid", `(${money(state.paid)})`));
    h.push(cpRow("Balance due", money(state.balance), true));
  }
  h.push("</tbody></table>");
  if (doc.message) h.push(`<h2>Message</h2><div>${paraHtml(doc.message)}</div>`);
  if (payAmount > 0) {
    const opts = paymentOptions(s, payAmount, doc.number);
    if (opts.length) {
      h.push(`<h2>${isQ ? "Pay the deposit" : "Ways to pay"} (${money(payAmount)})</h2><div class="pay">`);
      let first = true;
      for (const o of opts) {
        if (o.url) {
          const fc = first ? ' class="first"' : "";
          h.push(`<a${fc} href="${escHtml(o.url)}" rel="noreferrer"><span>${escHtml(o.label)}: ${escHtml(o.url)}</span><span>&#8594;</span></a>`);
          first = false;
        } else h.push(`<div><span><b>${escHtml(o.label)}:</b> ${escHtml(o.text)}</span></div>`);
      }
      h.push("</div>");
      const links = opts.filter((o) => o.url);
      if (links.length) {
        try { h.push('<div class="qr">' + qrSvg(links[0].url, 3) + "<span>Scan with a phone camera to open the first payment link.</span></div>"); }
        catch (e) { if (!(e instanceof ServiceError)) throw e; }
      }
    }
  }
  if (isQ && (doc.status === "sent" || doc.status === "changes_requested")) {
    const how = [s.phone, s.email].filter((x) => x).join(" or ");
    h.push("<h2>To approve</h2><div>Reply to " + (how ? escHtml(how) : "us") + " with your approval and any optional items you want. This page is a read-only copy.</div>");
  }
  h.push(`<p class="cp-foot">Prepared ${escHtml(dateWords(today))}. This page is a read-only copy for ${escHtml(client.name)}.</p>`);
  h.push("</div></div></body></html>");
  return h.join("\n") + "\n";
}
