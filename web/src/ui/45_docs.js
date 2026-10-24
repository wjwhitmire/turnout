// ---------------------------------------------------------------- quotes and invoices
function pctToX100(s, label) {
  const t = String(s).trim();
  if (t === "") return 0;
  const m = /^([0-9]{1,3})(?:\.([0-9]{0,2}))?$/.exec(t);
  if (!m) throw new C.ServiceError("bad_field", `${label}: write a percent like 10 or 7.5.`);
  return +m[1] * 100 + +((m[2] || "") + "00").slice(0, 2);
}
function x100Text(v) { return Math.floor(v / 100) + (v % 100 ? "." + String(v % 100).padStart(2, "0").replace(/0$/, "") : ""); }

// The line item table shared by quotes, jobs and invoices. On a phone each line becomes a card.
function lineEditor(lines, opts) {
  const o = opts || {};
  const rows = lines.map((ln) => Object.assign({}, ln));
  const tbody = el("tbody");
  const totalsBox = el("dl", { cls: "totals", "aria-live": "polite" });
  const items = B().items.filter((i) => !i.archived);
  let n = 0;
  const nextId = () => { let id; do { id = "l" + (++n); } while (rows.some((r) => r.id === id)); return id; };
  function draw() {
    clear(tbody);
    rows.forEach((ln, i) => {
      const itemSel = sel([["", "Custom item"]].concat(items.map((it) => [it.id, it.name])), ln.item_id || "", { id: `${o.idp}-item-${i}`, "aria-label": `Line ${i + 1} product or service` });
      const name = inp("text", ln.name, { id: `${o.idp}-name-${i}`, "aria-label": `Line ${i + 1} name` });
      const desc = inp("text", ln.description, { id: `${o.idp}-desc-${i}`, "aria-label": `Line ${i + 1} description` });
      const qty = inp("text", qtyText(ln.qty_milli), { id: `${o.idp}-qty-${i}`, inputmode: "decimal", "aria-label": `Line ${i + 1} quantity` });
      const rate = inp("text", fmtPlain(ln.rate), { id: `${o.idp}-rate-${i}`, inputmode: "decimal", "aria-label": `Line ${i + 1} rate` });
      const cost = inp("text", fmtPlain(ln.cost), { id: `${o.idp}-cost-${i}`, inputmode: "decimal", "aria-label": `Line ${i + 1} unit cost` });
      const tax = chk(ln.taxable, { id: `${o.idp}-tax-${i}` });
      const opt = chk(ln.optional, { id: `${o.idp}-opt-${i}` });
      const amt = el("td", { cls: "amt", "data-l": "Amount" });
      const tr = el("tr");
      const sync = () => {
        ln.name = name.value; ln.description = desc.value; ln.taxable = tax.checked; ln.optional = o.optional ? opt.checked : false;
        try { ln.qty_milli = C.parse_milli(qty.value, "Quantity"); ln.rate = C.parse_money(rate.value, "Rate"); ln.cost = C.parse_money(cost.value, "Cost"); }
        catch (e) { amt.textContent = e.message; return; }
        amt.textContent = fmt(C.line_amount(ln));
        tr.className = ln.optional && !ln.selected ? "opt" : "";
        drawTotals();
      };
      itemSel.addEventListener("change", () => {
        const it = items.find((x) => x.id === itemSel.value);
        ln.item_id = itemSel.value;
        if (it) { name.value = it.name; desc.value = it.description; rate.value = fmtPlain(it.rate); cost.value = fmtPlain(it.cost); tax.checked = it.taxable; ln.kind = it.kind; }
        sync();
      });
      for (const x of [name, desc, qty, rate, cost]) x.addEventListener("input", sync);
      for (const x of [tax, opt]) x.addEventListener("change", sync);
      const rm = iconBtn("trash", `Remove line ${i + 1}`, () => { rows.splice(i, 1); draw(); });
      add(tr, [el("td", { cls: "ln-name", "data-l": "Product or service" }, [el("div", { cls: "sel" }, [itemSel, icon("chev-d")]), name]),
        el("td", { cls: "ln-desc", "data-l": "Description" }, desc), el("td", { "data-l": "Qty" }, qty), el("td", { "data-l": "Rate" }, rate), amt,
        el("td", { cls: "ln-flags", "data-l": "Options" }, [o.optional ? field("Optional", opt) : null, field("Taxable", tax), el("div", { cls: "fld cost" }, [el("label", { for: cost.id, text: "Your cost" }), cost]),
          ln.optional && !ln.selected ? el("span", { cls: "optchip" }, [glyph("dash"), "Optional, not chosen"]) : null]), el("td", null, rm)]);
      tbody.append(tr);
      sync();
    });
    drawTotals();
  }
  let docFields = () => ({});
  let extra = () => [];
  function drawTotals() {
    try {
      const doc = Object.assign({ discount_kind: "pct", discount_value: 0, tax_rate_milli: 0, tax_mode: "document" }, docFields(), { lines: rows.map((r) => C.check_record("line", r, "line")) });
      const t = C.doc_totals(doc);
      clear(totalsBox);
      const row = (k, v, cls) => totalsBox.append(el("dt", { text: k }), el("dd", { cls: cls || "" }, v));
      row("Subtotal", fmt(t.subtotal));
      if (t.discount) row("Discount", fmt(-t.discount));
      row(`Tax (${qtyText(doc.tax_rate_milli)}% on taxable lines)`, fmt(t.tax));
      totalsBox.append(el("span", { cls: "rule-1" }));
      if (t.optional_total) row("Optional items, not all chosen", fmt(t.optional_total), "muted");
      if (t.cost) row("Expected cost", fmt(t.cost), "muted");
      for (const [k, v] of extra(t)) row(k, v);
      totalsBox.append(plate(o.plateLabel || "Total", fmt(t.total), o.plateSub || null));
    } catch (e) { clear(totalsBox).append(el("p", { cls: "neg", text: e.message })); }
  }
  const table = el("table", { cls: "lines" }, [el("colgroup", null, ["24%", "25%", "9%", "12%", "11%", "14%", "52px"].map((w) => el("col", { style: "width:" + w }))),
    el("thead", null, el("tr", null, [el("th", { text: "Product or service" }), el("th", { text: "Description" }), el("th", { cls: "n", text: "Qty" }), el("th", { cls: "n", text: "Rate" }), el("th", { cls: "n", text: "Amount" }), el("th", { text: "Options" }), el("th", null, el("span", { cls: "sr", text: "Remove" }))])),
    tbody]);
  const addLine = (optional) => { rows.push({ id: nextId(), item_id: "", name: "", description: "", kind: "service", qty_milli: 1000, rate: 0, cost: 0, taxable: false, optional, selected: optional ? false : true }); draw(); };
  if (o.selectNew) rows.forEach(() => {});
  const acts = el("div", { cls: "ln-acts" }, [btn("Add line item", () => addLine(false), "", { id: o.idp + "-add", icon: "plus" }), o.optional ? btn("Add optional item", () => addLine(true), "", { id: o.idp + "-add-opt", icon: "plus" }) : null]);
  draw();
  return { node: el("div", null, [el("div", { cls: "tbl-wrap" }, table), acts]), totals: totalsBox, value: () => rows.map((r) => {
    if (!r.name.trim()) throw new C.ServiceError("bad_field", "Every line needs a name.");
    return r;
  }), setDocFields: (fn) => { docFields = fn; drawTotals(); }, setExtra: (fn) => { extra = fn; drawTotals(); }, redraw: drawTotals };
}
function pricingFields(doc, idp) {
  const kind = sel([["pct", "Percent"], ["amt", "Amount"]], doc.discount_kind, { id: idp + "-dkind" });
  const val = inp("text", doc.discount_kind === "pct" ? x100Text(doc.discount_value) : fmtPlain(doc.discount_value), { id: idp + "-dval", inputmode: "decimal" });
  const rate = inp("text", qtyText(doc.tax_rate_milli), { id: idp + "-tax", inputmode: "decimal" });
  const mode = sel([["document", "Once on the total"], ["line", "On each line"]], doc.tax_mode, { id: idp + "-taxmode" });
  const read = () => ({ discount_kind: kind.value, discount_value: kind.value === "pct" ? pctToX100(val.value, "Discount") : C.parse_money(val.value, "Discount"),
    tax_rate_milli: C.parse_milli(rate.value, "Tax rate"), tax_mode: mode.value });
  return { nodes: [field("Discount type", kind), field("Discount", val), field("Tax rate, percent", rate), field("Round tax", mode)], read, inputs: [kind, val, rate, mode] };
}
function wireTotals(le, pf) {
  le.setDocFields(() => { try { return pf.read(); } catch (e) { return {}; } });
  for (const i of pf.inputs) { i.addEventListener("input", le.redraw); i.addEventListener("change", le.redraw); }
}
function stepper(steps, cur, done) {
  return el("ol", { cls: "stepper", "aria-label": "Progress" }, steps.map(([k, label, when], i) => el("li", { cls: i < done ? "done" : i === cur ? "cur" : "" },
    [i < done ? glyph("check") : null, label, when ? el("small", { text: shortDate(when) }) : null])));
}
function quoteSteps(q) {
  const order = { draft: 0, sent: 1, changes_requested: 1, approved: 2, converted: 3, archived: 1 };
  const c = order[q.status];
  return stepper([["draft", "Draft", q.date], ["sent", q.status === "changes_requested" ? "Changes requested" : "Sent", q.sent_date], ["approved", "Approved", q.approved_date], ["job", "Job", ""]], c, q.status === "converted" ? 4 : c);
}
// A document editor as a full-height sheet with the asphalt action bar.
function docEditor(o) {
  const body = el("div", null, [o.stepper || null, el("div", { cls: "hdr-g" }, o.header), el("h3", { cls: "sec", text: "Line items" }), o.lines.node,
    el("div", { cls: "form-foot" }, [el("div", { cls: "stack" }, o.foot), o.lines.totals])]);
  openDialog({ title: o.title, full: true, wide: true, bar: true, body, actions: [{ label: "Cancel" }, { spacer: true }, { label: "Save", onClick: () => o.save(false) },
    { label: "Save and send", primary: true, icon: "share", onClick: () => o.save(true) }] });
}

// ---------------------------------------------------------------- quotes
PAGES.quotes = function (main) {
  const f = ui("quote_f", "open");
  const cnt = (k) => B().quotes.filter((q) => (k === "all" ? true : k === "open" ? ["draft", "sent", "changes_requested", "approved"].includes(q.status) : q.status === k)).length;
  main.append(pageHead("Quotes", "Price the work, send it, and turn approved quotes into jobs.", [btn("New quote", () => newQuote(null), "primary", { id: "new-quote", icon: "plus" })]));
  main.append(filterBar([["open", "Open", cnt("open")], ["draft", "Draft", cnt("draft")], ["sent", "Awaiting response", cnt("sent")], ["changes_requested", "Changes requested", cnt("changes_requested")], ["approved", "Approved", cnt("approved")], ["converted", "Converted", cnt("converted")], ["archived", "Archived", cnt("archived")], ["all", "All", cnt("all")]], f, (v) => { setUi("quote_f", v); render(); }));
  const rows = B().quotes.filter((q) => f === "all" || (f === "open" ? ["draft", "sent", "changes_requested", "approved"].includes(q.status) : q.status === f))
    .slice().sort((a, b) => (a.date + a.number < b.date + b.number ? 1 : -1))
    .map((q) => ({ cells: [el("span", null, [el("a", { cls: "rowlink", href: "#quote/" + q.id, text: clientName(q.client_id) }), el("span", { cls: "sub", text: q.number + ", " + shortDate(q.date) + (q.title ? ", " + q.title : "") })]), statusChip(q.status), money(C.doc_totals(q).total)], onClick: () => go("quote", q.id) }));
  main.append(card("Quote list", table([{ h: "Client and quote" }, { h: "Status" }, { h: "Total", n: true }], rows, { empty: "No quotes here." })));
};
function newQuote(pre) {
  if (!clientOptions().length) { toast("A quote is for a client. Add the client; the quote opens next."); editClient(null, (id) => newQuote(Object.assign({}, pre || {}, { client_id: id }))); return; }
  editQuote(Object.assign({ client_id: "", property_id: "", date: T(), valid_until: "", title: "", lines: [], deposit: 0, message: B().settings.quote_message, notes: "",
    discount_kind: "pct", discount_value: 0, tax_rate_milli: B().settings.tax_rate_milli, tax_mode: B().settings.tax_mode, status: "draft" }, pre || {}));
}
function editQuote(q) {
  const cp = clientPropertyPick(q.client_id, q.property_id, "qt");
  const title = inp("text", q.title, { id: "qt-title" }), date = inp("date", q.date, { id: "qt-date" }), valid = inp("date", q.valid_until, { id: "qt-valid" });
  const deposit = inp("text", fmtPlain(q.deposit), { id: "qt-deposit", inputmode: "decimal" });
  const message = inp("textarea", q.message, { id: "qt-message" }), notes = inp("textarea", q.notes, { id: "qt-notes" });
  const le = lineEditor(q.lines, { idp: "qt", optional: true, selectNew: true, plateLabel: "Quote total", plateSub: "Changes as the client picks options" });
  const pf = pricingFields(q, "qt");
  wireTotals(le, pf);
  le.setExtra(() => { try { const d = C.parse_money(deposit.value, "Deposit"); return d ? [["Deposit required", fmt(d)]] : []; } catch (e) { return []; } });
  deposit.addEventListener("input", le.redraw);
  const [cf, pfld] = cp.nodes;
  cf.classList.add("w2");
  pfld.classList.add("w2");
  const tf = field("Title", title);
  tf.classList.add("w2");
  docEditor({ title: q.id ? "Edit quote " + q.number : "New quote", stepper: q.id ? quoteSteps(q) : null,
    header: [cf, pfld, field("Date", date), field("Valid until", valid, "Blank uses the setting"), tf, ...pf.nodes, field("Deposit required", deposit)], lines: le,
    foot: [field("Message to the client", message), field("Internal notes", notes, "Never shown to the client")],
    save: async (send) => {
      const rec = Object.assign({}, q, { client_id: cp.client(), property_id: cp.property(), title: title.value, date: date.value, valid_until: valid.value,
        deposit: C.parse_money(deposit.value, "Deposit"), message: message.value, notes: notes.value, lines: le.value() }, pf.read());
      const saved = await act((tx) => (q.id ? tx.update("quotes", rec) : STEP(tx, "create_quote", [rec])), { render: false });
      go("quote", saved.id);
      if (send) sendDialog("quotes", byId("quotes", saved.id));
    } });
}
PAGES.quote = function (main, id) {
  const q = byId("quotes", id);
  if (!q) { main.append(el("p", { text: "That quote is not in this file." })); return; }
  const st = C.quote_state(B(), q);
  const open = ["draft", "sent", "changes_requested"].includes(q.status);
  const acts = [];
  if (open) acts.push(btn("Edit", () => editQuote(q), "", { id: "edit-quote", icon: "edit" }));
  acts.push(btn("Client copy", () => clientCopyDialog("quotes", q), "", { id: "quote-client-copy", icon: "share" }));
  if (q.deposit && st.deposit_due) acts.push(btn("Record deposit", () => paymentDialog({ quote_id: q.id, amount: st.deposit_due }), "", { id: "quote-deposit", icon: "dollar" }));
  if (open || q.status === "approved") acts.push(btn("Archive", () => act((tx) => tx.patch("quotes", q.id, { status: "archived" }))));
  if (q.status === "sent") acts.push(btn("Changes requested", () => changesDialog(q), "", { id: "changes-quote" }));
  if (open) acts.push(btn("Mark approved", () => approveDialog(q), q.status === "sent" ? "primary" : "", { id: "approve-quote", icon: "check" }));
  if (open) acts.push(btn(q.status === "sent" ? "Send again" : "Send", () => sendDialog("quotes", q), q.status === "sent" ? "" : "primary", { id: "send-quote", icon: "share" }));
  if (q.status === "approved" && !q.job_id) acts.push(btn("Convert to job", async () => { const j = await act((tx) => STEP(tx, "convert_quote", [q.id, T()]), { render: false }); go("job", j.id); }, "primary", { id: "convert-quote" }));
  if (q.job_id) acts.push(btn("Open job", () => go("job", q.job_id), "primary", { id: "open-job", icon: "jobs" }));
  main.append(quoteSteps(q), pageHead("Quote " + q.number, clientName(q.client_id) + (q.title ? ": " + q.title : ""), acts, ["Quotes", "quotes"]));
  main.append(keyrow(plate("Quote total", fmt(st.total), q.deposit ? `Deposit ${fmt(q.deposit)}` + (st.deposit_paid ? `, ${fmt(st.deposit_paid)} received` : "") : "No deposit required"), q.status === "changes_requested" ? "The client asked for changes: " + q.change_request : null));
  main.append(grid("g-7-5", [card("Line items", docLinesTable(q)), card("Summary", kv([["Status", statusChip(q.status)], ["Client", el("a", { href: "#client/" + q.client_id, text: clientName(q.client_id) })], ["Property", propOf(q) ? C.address_line(propOf(q)) : ""],
    ["Date", dateText(q.date)], ["Valid until", dateText(q.valid_until)], ["Sent", dateText(q.sent_date)], ["Approved", q.approved_date ? dateText(q.approved_date) + (q.approved_by ? " by " + q.approved_by : "") : ""],
    ["Changes asked for", q.change_request], ["Message", q.message], ["Internal notes", q.notes], ["Request", q.request_id ? el("a", { href: "#request/" + q.request_id, text: "Open request" }) : ""]]))]));
};
function docLinesTable(doc) {
  const t = C.doc_totals(doc);
  const rows = doc.lines.map((ln, i) => {
    const off = ln.optional && !ln.selected;
    const tr = el("tr", { cls: off ? "off" : "" }, [el("td", { cls: "full" }, [el("b", { text: ln.name }), ln.optional ? el("span", { cls: "optchip" }, [glyph(ln.selected ? "check" : "dash"), ln.selected ? "Optional, chosen" : "Optional, not chosen"]) : null, ln.description ? el("span", { cls: "sub", text: ln.description }) : null]),
      el("td", { cls: "n" }, el("span", { cls: "sub", text: qtyText(ln.qty_milli) + " at " + fmt(ln.rate) + (ln.taxable ? ", taxable" : "") })), el("td", { cls: "n" }, money(t.lines[i].amount))]);
    return tr;
  });
  const tot = el("dl", { cls: "totals" });
  const row = (k, v) => tot.append(el("dt", { text: k }), el("dd", null, v));
  row("Subtotal", fmt(t.subtotal));
  if (t.discount) row("Discount", fmt(-t.discount));
  row("Tax (" + qtyText(doc.tax_rate_milli) + "%)", fmt(t.tax));
  tot.append(el("span", { cls: "rule-1" }));
  tot.append(el("dt", { cls: "big", text: "Total" }), el("dd", { cls: "big", text: fmt(t.total) }));
  if (t.cost) row("Expected cost", fmt(t.cost));
  return el("div", { cls: "stack" }, [table([{ h: "Item" }, { h: "Qty and rate", n: true }, { h: "Amount", n: true }], rows, { empty: "No line items yet." }), tot]);
}
function approveDialog(q) {
  const opts = q.lines.filter((ln) => ln.optional).map((ln) => [ln.id, chk(ln.selected, { id: "ap-" + ln.id }), ln]);
  const by = inp("text", clientName(q.client_id), { id: "ap-by" });
  openDialog({ title: "Mark quote " + q.number + " approved", body: el("div", { cls: "form" }, [field("Approved by", by), opts.length ? el("fieldset", null, [el("legend", { text: "Optional items the client chose" })].concat(opts.map(([, c, ln]) => field(ln.name + " (" + fmt(C.line_amount(ln)) + ")", c)))) : null,
    notice(B().settings.auto_quote_to_job ? "The quote becomes a job right away (rule: Approved quote to job). You can undo that." : "Convert it to a job when you are ready.", "automations")]),
  actions: [{ label: "Cancel" }, { label: "Approve", primary: true, icon: "check", onClick: async () => {
    await act((tx) => STEP(tx, "approve_quote", [q.id, opts.map(([id, c]) => (c.checked ? id : null)).filter((x) => x), by.value, T()]));
    toast("Quote approved.");
  } }] });
}
function changesDialog(q) {
  const t = inp("textarea", q.change_request, { id: "ch-text" });
  openDialog({ title: "Changes requested", body: el("div", { cls: "form" }, [field("What the client wants changed", t)]),
    actions: [{ label: "Cancel" }, { label: "Save", primary: true, onClick: () => act((tx) => STEP(tx, "request_changes", [q.id, t.value, T()])) }] });
}

// ---------------------------------------------------------------- invoices
PAGES.invoices = function (main) {
  const f = ui("inv_f", "open");
  const all = B().invoices.map((n) => [n, C.invoice_state(B(), n, T())]);
  const sumOf = (k) => all.filter(([, s]) => s.status === k).reduce((a, [, s]) => a + (k === "paid" || k === "draft" ? s.total : s.balance), 0);
  const nOf = (k) => all.filter(([, s]) => s.status === k).length;
  const paid30 = all.filter(([n, s]) => s.status === "paid" && n.date >= C.add_days(T(), -30));
  main.append(pageHead("Invoices", "Bill the work and collect.", [btn("New invoice", () => newInvoice(null), "primary", { id: "new-invoice", icon: "plus" })]));
  main.append(keyrow(plate("Past due", fmt(sumOf("overdue")), `${nOf("overdue")} invoice${nOf("overdue") === 1 ? "" : "s"}`), "Past due follow-ups are queued as drafts in Reminders at the steps set in Settings."));
  const ov = (k, label, st, value, count) => el("a", { cls: "ov s-" + st, href: "#invoices", on: { click: (e) => { e.preventDefault(); setUi("inv_f", k); render(); } } },
    [el("span", { cls: "k" }, [glyph(stateOf(k === "paid" ? "paid" : k)[1]), label]), el("span", { cls: "v", text: fmt(value) }), el("span", { cls: "s", text: `${count} invoice${count === 1 ? "" : "s"}` })]);
  main.append(el("div", { cls: "ovr" }, [ov("draft", "Draft", "hold", sumOf("draft"), nOf("draft")), ov("awaiting", "Awaiting payment", "sched", sumOf("awaiting"), nOf("awaiting")),
    ov("overdue", "Past due", "late", sumOf("overdue"), nOf("overdue")), ov("paid", "Paid, 30 days", "done", paid30.reduce((a, [, s]) => a + s.total, 0), paid30.length)]));
  main.append(filterBar([["open", "Open", nOf("draft") + nOf("awaiting") + nOf("overdue")], ["draft", "Draft", nOf("draft")], ["awaiting", "Awaiting payment", nOf("awaiting")], ["overdue", "Past due", nOf("overdue")], ["paid", "Paid", nOf("paid")], ["void", "Void", nOf("void")], ["all", "All", all.length]], f, (v) => { setUi("inv_f", v); render(); }));
  const rows = all.filter(([, s]) => f === "all" || (f === "open" ? ["draft", "awaiting", "overdue"].includes(s.status) : s.status === f))
    .sort((a, b) => (a[0].date + a[0].number < b[0].date + b[0].number ? 1 : -1))
    .map(([n, s]) => {
      const due = C.days_between(T(), n.due_date);
      const word = s.status === "overdue" ? `Past due ${s.days_overdue} days` : s.status === "awaiting" ? (due === 0 ? "Due today" : `Due in ${due} day${due === 1 ? "" : "s"}`) : null;
      return { cells: [el("span", { cls: "num-id", text: n.number }), el("span", null, [el("a", { cls: "rowlink", href: "#invoice/" + n.id, text: clientName(n.client_id) }), el("span", { cls: "sub", text: shortDate(n.date) + (n.subject ? ", " + n.subject : "") })]),
        statusChip(s.status, word), money(s.total), el("b", null, money(s.balance))], onClick: () => go("invoice", n.id) };
    });
  main.append(card("Invoice list", table([{ h: "No." }, { h: "Client" }, { h: "Status" }, { h: "Total", n: true, hide: true }, { h: "Balance", n: true }], rows, { empty: "No invoices here." })));
};
function newInvoice(pre) {
  if (!clientOptions().length) { toast("An invoice is for a client. Add the client; the invoice opens next."); editClient(null, (id) => newInvoice(Object.assign({}, pre || {}, { client_id: id }))); return; }
  editInvoice(Object.assign({ client_id: "", property_id: "", date: T(), due_date: "", subject: "", lines: [], message: B().settings.invoice_message,
    discount_kind: "pct", discount_value: 0, tax_rate_milli: B().settings.tax_rate_milli, tax_mode: B().settings.tax_mode }, pre || {}));
}
function editInvoice(n) {
  const cp = clientPropertyPick(n.client_id, n.property_id, "iv");
  const subject = inp("text", n.subject, { id: "iv-subject" }), date = inp("date", n.date, { id: "iv-date" }), due = inp("date", n.due_date, { id: "iv-due" });
  const message = inp("textarea", n.message, { id: "iv-message" });
  const le = lineEditor(n.lines, { idp: "iv", plateLabel: "Invoice total" });
  const pf = pricingFields(n, "iv");
  wireTotals(le, pf);
  const [cf, pfld] = cp.nodes;
  cf.classList.add("w2");
  pfld.classList.add("w2");
  const sf = field("Subject", subject);
  sf.classList.add("w2");
  docEditor({ title: n.id ? "Edit invoice " + n.number : "New invoice", header: [cf, pfld, field("Date", date), field("Due date", due, "Blank uses the payment terms in Settings"), sf, ...pf.nodes],
    lines: le, foot: [field("Message to the client", message), notice("How the client pays: the payment links in Settings print on the client copy with a QR code. Record each payment when it arrives.", "dollar")],
    save: async (send) => {
      const rec = Object.assign({}, n, { client_id: cp.client(), property_id: cp.property(), subject: subject.value, date: date.value, due_date: due.value, message: message.value, lines: le.value() }, pf.read());
      if (n.id && !rec.due_date) rec.due_date = C.add_days(rec.date, B().settings.terms_days);
      const saved = await act((tx) => (n.id ? tx.update("invoices", rec) : STEP(tx, "create_invoice", [rec])), { render: false });
      go("invoice", saved.id);
      if (send) sendDialog("invoices", byId("invoices", saved.id));
    } });
}
PAGES.invoice = function (main, id) {
  const n = byId("invoices", id);
  if (!n) { main.append(el("p", { text: "That invoice is not in this file." })); return; }
  const s = C.invoice_state(B(), n, T());
  const pays = B().payments.filter((p) => p.invoice_id === n.id);
  const deposits = pays.filter((p) => p.quote_id);
  const acts = [];
  if (n.status !== "void" && !pays.length) acts.push(btn("Edit", () => editInvoice(n), "", { id: "edit-invoice", icon: "edit" }));
  acts.push(btn("Client copy", () => clientCopyDialog("invoices", n), "", { id: "invoice-client-copy", icon: "share" }));
  if (n.status !== "void") acts.push(btn("Void", async () => { if (await confirmDialog("Void invoice", `Void invoice ${n.number}? Its visits can be invoiced again.`, "Void", true)) await act((tx) => STEP(tx, "void_invoice", [n.id]), { automate: false }); }, "danger"));
  if (n.status !== "void") acts.push(btn(n.status === "draft" ? "Send" : "Send again", () => sendDialog("invoices", n), n.status === "draft" ? "primary" : "", { id: "send-invoice", icon: "share" }));
  if (s.balance > 0 && n.status !== "void") acts.push(btn("Record payment", () => paymentDialog({ invoice_id: n.id, amount: s.balance }), n.status === "draft" ? "" : "primary", { id: "record-payment", icon: "dollar" }));
  main.append(stepper([["draft", "Draft", n.date], ["sent", "Sent", n.sent_date], ["paid", "Paid", ""]], n.status === "draft" ? 0 : s.status === "paid" ? 3 : 1, n.status === "draft" ? 0 : s.status === "paid" ? 3 : 1));
  main.append(pageHead("Invoice " + n.number, clientName(n.client_id) + (n.subject ? ": " + n.subject : ""), acts, ["Invoices", "invoices"]));
  main.append(keyrow(plate("Balance due", fmt(s.balance), deposits.length ? `After the ${fmt(deposits.reduce((a, p) => a + p.amount, 0))} quote deposit` : s.paid ? `${fmt(s.paid)} paid` : "Nothing paid yet"),
    s.status === "overdue" ? `${s.days_overdue} days past due.` : s.status === "awaiting" ? "Due " + dateText(n.due_date) + "." : null));
  main.append(grid("g-7-5", [card("Line items", docLinesTable(n)), el("div", { cls: "stack" }, [card("Summary", kv([["Status", statusChip(s.status)], ["Client", el("a", { href: "#client/" + n.client_id, text: clientName(n.client_id) })], ["Date", dateText(n.date)], ["Due", dateText(n.due_date) + (s.days_overdue ? ` (${s.days_overdue} days past due)` : "")],
    ["Job", n.job_id ? el("a", { href: "#job/" + n.job_id, text: byId("jobs", n.job_id).number }) : ""], ["Visits", n.visit_ids.length ? n.visit_ids.map((v) => shortDate(byId("visits", v).date)).join(", ") : ""],
    ["Total", money(s.total)], ["Paid", money(s.paid)], ["Message", n.message]])),
  card("Payments", table([{ h: "Date" }, { h: "Method" }, { h: "Reference" }, { h: "Amount", n: true }], pays.map((p) => ({ cells: [shortDate(p.date), p.method, p.reference, money(p.amount)], onClick: () => paymentDialog(p) })), { empty: "No payments yet." }))])]));
};
function paymentDialog(p0) {
  const p = Object.assign({ date: T(), method: "card", reference: "", note: "" }, p0);
  const amount = inp("text", fmtPlain(p.amount || 0), { id: "pay-amount", inputmode: "decimal" }), date = inp("date", p.date, { id: "pay-date" });
  const method = sel([["card", "Card"], ["cash", "Cash"], ["check", "Check"], ["ach", "Bank transfer"], ["link", "Payment link"], ["other", "Other"]], p.method, { id: "pay-method" });
  const ref = inp("text", p.reference, { id: "pay-ref" }), note = inp("text", p.note, { id: "pay-note" });
  const actions = [{ label: "Cancel" }];
  if (p.id) actions.push({ label: "Delete", danger: true, onClick: () => act((tx) => tx.delete("payments", p.id), { automate: false }) });
  actions.push({ label: "Save", primary: true, onClick: async () => {
    const rec = Object.assign({}, p, { amount: C.parse_money(amount.value, "Amount"), date: date.value, method: method.value, reference: ref.value, note: note.value });
    if (p.id) {
      // An edited payment may not take an invoice past paid, the same rule as recording one.
      const inv = rec.invoice_id ? byId("invoices", rec.invoice_id) : null;
      if (inv && rec.amount > C.invoice_state(B(), inv, T()).balance + p0.amount) throw new C.ServiceError("overpaid", `The payment is more than the balance of invoice ${inv.number}.`);
      await act((tx) => tx.update("payments", rec));
    }
    else await act((tx) => STEP(tx, "record_payment", [rec, T()]));
    toast("Payment recorded.");
  } });
  openDialog({ title: p.id ? "Payment" : "Record payment", body: el("div", { cls: "form" }, [field("Amount", amount), field("Date", date), field("Method", method), field("Reference (check number, processor id)", ref), field("Note", note),
    notice("Card data never enters this program. Record payments made by card, link, check or cash after the money arrives.", "lock")]), actions });
}

// ---------------------------------------------------------------- sending and client copies
function docMessage(kind, doc) {
  const s = B().settings;
  const isQ = kind === "quotes";
  const t = C.doc_totals(doc);
  const client = byId("clients", doc.client_id);
  const amount = isQ ? C.quote_state(B(), doc).deposit_due : C.invoice_state(B(), doc, T()).balance;
  const links = amount > 0 ? C.payment_options(s, amount, doc.number) : [];
  const subject = (isQ ? "Quote " : "Invoice ") + doc.number + " from " + (s.business_name || "us");
  const lines = [`Hi ${client.name.split(" ")[0]},`, "", isQ ? `Here is quote ${doc.number}${doc.title ? " for " + doc.title : ""}: ${fmt(t.total)}.` : `Here is invoice ${doc.number}${doc.subject ? " for " + doc.subject : ""}: ${fmt(t.total)}, due ${dateText(doc.due_date)}.`];
  if (doc.message) lines.push("", doc.message);
  if (links.length) { lines.push("", isQ ? `Deposit to get on the schedule: ${fmt(amount)}` : "Ways to pay:"); for (const o of links) lines.push(`- ${o.label}: ${o.text}`); }
  if (isQ) lines.push("", "Reply to this message to approve, or to ask for changes.");
  lines.push("", "The full " + (isQ ? "quote" : "invoice") + " is attached.", "", [s.business_name, s.phone].filter((x) => x).join("\n"));
  return { to: client.email, phone: client.phone, subject, body: lines.join("\n") };
}
function sendDialog(kind, doc) {
  const m = docMessage(kind, doc);
  const isQ = kind === "quotes";
  const body = el("div", { cls: "stack" }, [
    el("p", { text: "1. Save the client copy (a read-only page, or a PDF). 2. Send it from your own email or phone. 3. Mark it sent." }),
    el("div", { cls: "acts" }, [btn("Save client page", () => saveClientPage(kind, doc), "", { id: "send-page", icon: "download" }), btn("Save PDF", () => savePdf(kind, doc), "", { id: "send-pdf", icon: "print" })]),
    el("div", { cls: "acts" }, [m.to ? el("a", { cls: "btn", href: mailto(m.to, m.subject, m.body), id: "send-email" }, [icon("mail"), el("span", { text: "Open email draft" })]) : null,
      m.phone ? el("a", { cls: "btn", href: smsto(m.phone, m.subject + "\n" + m.body), id: "send-text" }, [icon("text"), el("span", { text: "Open text draft" })]) : null,
      btn("Copy message", () => copyText(m.subject + "\n\n" + m.body, "Message"), "", { id: "send-copy", icon: "copy" })]),
    el("div", { cls: "draft" }, [el("span", { cls: "subj", text: m.subject }), m.body])]);
  openDialog({ title: (isQ ? "Send quote " : "Send invoice ") + doc.number, wide: true, body, actions: [{ label: "Close" }, { label: "Mark as sent", primary: true, icon: "check", onClick: async () => {
    await act((tx) => STEP(tx, isQ ? "send_quote" : "send_invoice", [doc.id, T()]));
    toast((isQ ? "Quote " : "Invoice ") + doc.number + " marked sent.");
  } }] });
}
function clientCopyDialog(kind, doc) {
  openDialog({ title: "Client copy", body: el("div", { cls: "stack" }, [el("p", { text: "A read-only page the client can open on any phone or computer: the lines, totals, and ways to pay with a QR code for your payment link. It contains no scripts and loads nothing from the internet." }),
    el("div", { cls: "acts" }, [btn("Save page", () => saveClientPage(kind, doc), "primary", { id: "copy-page", icon: "download" }), btn("Save PDF", () => savePdf(kind, doc), "", { id: "copy-pdf", icon: "print" }), btn("Preview", () => previewClientPage(kind, doc), "", { id: "copy-preview" })])]) });
}
function saveClientPage(kind, doc) {
  const html = C.client_page(B(), kind, doc.id, T());
  return saveFile(safeName((kind === "quotes" ? "quote-" : "invoice-") + doc.number) + ".html", html, "text/html;charset=utf-8");
}
function previewClientPage(kind, doc) {
  const html = C.client_page(B(), kind, doc.id, T());
  const frame = el("iframe", { cls: "preview", title: "Client copy preview" });
  frame.setAttribute("sandbox", "");
  frame.srcdoc = html;
  openDialog({ title: "Preview", wide: true, body: frame });
}
