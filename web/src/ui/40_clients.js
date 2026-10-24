// ---------------------------------------------------------------- clients, properties, requests
PAGES.clients = function (main) {
  const f = ui("client_f", "all");
  main.append(pageHead("Clients", `${B().clients.length} clients`, [btn("Import CSV", importClientsUi, "", { id: "import-clients", icon: "upload" }), btn("New client", () => editClient(null), "primary", { id: "new-client", icon: "plus" })]));
  const bal = new Map(B().clients.map((c) => [c.id, C.client_balance(B(), c.id, T())]));
  const hasWork = new Set(B().jobs.map((j) => j.client_id));
  const owing = B().clients.filter((c) => bal.get(c.id).balance > 0).length;
  const leads = B().clients.filter((c) => !hasWork.has(c.id)).length;
  main.append(filterBar([["all", "All", B().clients.length], ["owing", "Owes money", owing], ["lead", "Leads", leads]], f, (v) => { setUi("client_f", v); render(); }, "Filter clients"));
  const search = searchBox(ui("client_q", ""), (v) => { setUi("client_q", v); drawList(); }, "Search clients");
  const holder = el("div");
  main.append(search, card("Client list", holder));
  function drawList() {
    const needle = (ui("client_q", "") || "").toLowerCase();
    const rows = B().clients.filter((c) => !needle || (c.name + " " + c.company + " " + c.email + " " + c.phone).toLowerCase().includes(needle))
      .filter((c) => f === "all" || (f === "owing" ? bal.get(c.id).balance > 0 : !hasWork.has(c.id)))
      .sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1))
      .map((c) => {
        const b0 = bal.get(c.id);
        const props = B().properties.filter((p) => p.client_id === c.id);
        return { cells: [el("span", null, [el("a", { cls: "rowlink", href: "#client/" + c.id, text: c.name }), el("span", { cls: "sub", text: props.length ? C.address_line(props[0]) + (props.length > 1 ? ` (+${props.length - 1})` : "") : c.company })]),
          c.phone ? el("span", { cls: "mono", text: c.phone }) : c.email, hasWork.has(c.id) ? statusChip("active") : statusChip("new", "Lead"), money(b0.balance, b0.balance > 0 ? "neg" : "")], onClick: () => go("client", c.id) };
      });
    clear(holder).append(table([{ h: "Name and address" }, { h: "Contact" }, { h: "Status" }, { h: "Balance", n: true }], rows, { empty: "No clients match." }));
  }
  drawList();
};

PAGES.client = function (main, id) {
  const c = byId("clients", id);
  if (!c) { main.append(el("p", { text: "That client is not in this file." })); return; }
  const bal = C.client_balance(B(), c.id, T());
  const ph = pageHead(c.name, c.company, [btn("Edit", () => editClient(c), "", { id: "edit-client", icon: "edit" }), btn("New request", () => editRequest({ client_id: c.id })),
    btn("New job", () => editJob({ client_id: c.id })), btn("New invoice", () => newInvoice({ client_id: c.id })), btn("New quote", () => newQuote({ client_id: c.id }), "primary", { id: "client-new-quote", icon: "plus" })], ["Clients", "clients"]);
  const contact = el("div", { cls: "contact" }, [c.phone ? el("a", { href: "tel:" + c.phone.replace(/[^0-9+]/g, "") }, [icon("phone"), el("span", { cls: "mono", text: c.phone })]) : null,
    c.email ? el("a", { href: "mailto:" + encodeURIComponent(c.email) }, [icon("mail"), c.email]) : null]);
  ph.firstChild.append(contact);
  main.append(ph, keyrow(plate("Balance owed", fmt(bal.balance), bal.overdue ? fmt(bal.overdue) + " past due" : "Nothing past due"), "Sent invoices less payments, less any unapplied credit."));
  const tab = ui("client_tab", "overview");
  const tabs = el("div", { cls: "tabs", role: "tablist" });
  for (const [k, t] of [["overview", "Overview"], ["work", "Work"], ["billing", "Billing"], ["notes", "Notes"]]) {
    tabs.append(el("button", { type: "button", role: "tab", "aria-selected": tab === k ? "true" : "false", id: "client-tab-" + k, text: t, on: { click: () => { setUi("client_tab", k); render(); } } }));
  }
  main.append(tabs);
  const props = B().properties.filter((p) => p.client_id === c.id);
  const propCards = el("div", { cls: "grid g2" }, props.map((p) => el("div", { cls: "prop", tabindex: 0, role: "button", on: { click: () => editProperty(c.id, p) } }, [icon("property"),
    el("div", null, [el("b", { text: (p.label ? p.label + ": " : "") + C.address_line(p) }), el("span", { cls: "sub", text: p.lat_e6 !== null ? degText(p.lat_e6) + ", " + degText(p.lon_e6) : "No coordinates" }),
      p.access_notes ? el("span", { cls: "sub", text: "Access: " + p.access_notes }) : null])])));
  const reqs = B().requests.filter((r) => r.client_id === c.id);
  const quotes = B().quotes.filter((r) => r.client_id === c.id);
  const jobs = B().jobs.filter((r) => r.client_id === c.id);
  const invs = B().invoices.filter((r) => r.client_id === c.id);
  const work = table([{ h: "Type" }, { h: "Number" }, { h: "Title" }, { h: "Date" }, { h: "Status" }, { h: "Amount", n: true }], [
    ...reqs.map((r) => ({ cells: ["Request", "", r.title, shortDate(r.date), statusChip(r.status), ""], onClick: () => go("request", r.id) })),
    ...quotes.map((q) => ({ cells: ["Quote", el("span", { cls: "num-id", text: q.number }), q.title, shortDate(q.date), statusChip(q.status), money(C.doc_totals(q).total)], onClick: () => go("quote", q.id) })),
    ...jobs.map((j) => ({ cells: ["Job", el("span", { cls: "num-id", text: j.number }), j.title, shortDate(j.start_date), statusChip(C.job_state(B(), j, T())), ""], onClick: () => go("job", j.id) })),
  ]);
  const billing = table([{ h: "Invoice" }, { h: "Date" }, { h: "Status" }, { h: "Total", n: true }, { h: "Balance", n: true }],
    invs.map((n) => { const s0 = C.invoice_state(B(), n, T()); return { cells: [el("span", { cls: "num-id", text: n.number }), shortDate(n.date), statusChip(s0.status), money(s0.total), money(s0.balance)], onClick: () => go("invoice", n.id) }; }));
  if (tab === "overview") {
    main.append(grid("g-7-5", [card("Contact", kv([["Email", c.email], ["Phone", c.phone], ["Reminders go by", c.prefer === "text" ? "Text message" : "Email"], ["Billing address", c.billing_address], ["Tags", c.tags]])),
      card("Properties", props.length ? propCards : el("p", { cls: "muted", text: "No service address yet." }), [btn("Add property", () => editProperty(c.id, null), "", { id: "add-property", icon: "plus" })])]));
  } else if (tab === "work") main.append(card("Work", work));
  else if (tab === "billing") main.append(card("Billing", billing));
  else main.append(card("Notes", c.notes ? el("p", { text: c.notes }) : el("p", { cls: "muted", text: "No notes. Edit the client to add some." })));
  main.append(el("div", { cls: "danger-zone", style: "margin-top:16px" }, [el("div", null, [el("b", { text: c.archived ? "Archived client" : "Archive client" }),
    el("span", { cls: "sub", text: c.archived ? "Hidden from new work. Their recurring jobs make no new visits." : "Hides the client from new work and stops their recurring jobs making new visits. Nothing is deleted." })]),
    btn(c.archived ? "Unarchive" : "Archive", () => setClientArchived(c.id, !c.archived), "", { id: "archive-client", icon: c.archived ? "undo" : "skip" })]));
  main.append(el("div", { cls: "danger-zone", style: "margin-top:16px" }, [el("div", null, [el("b", { text: "Delete client" }), el("span", { cls: "sub", text: "Only works when nothing else uses the client." })]),
    btn("Delete client", async () => {
      if (!(await confirmDialog("Delete client", `Delete ${c.name}? This only works when nothing else uses the client.`, "Delete", true))) return;
      try { await act((tx) => tx.delete("clients", c.id), { render: false }); go("clients"); } catch (e) { showError(e); }
    }, "danger", { icon: "trash" })]));
};

function editClient(c, then) {
  const r = c || { name: "", company: "", email: "", phone: "", billing_address: "", prefer: "email", tags: "", notes: "" };
  const f = { name: inp("text", r.name, { id: "cl-name", required: true, autocomplete: "off" }), company: inp("text", r.company, { id: "cl-company" }),
    email: inp("email", r.email, { id: "cl-email" }), phone: inp("tel", r.phone, { id: "cl-phone" }),
    prefer: sel([["email", "Email"], ["text", "Text message"]], r.prefer, { id: "cl-prefer" }), billing_address: inp("textarea", r.billing_address, { id: "cl-billing" }),
    tags: inp("text", r.tags, { id: "cl-tags" }), notes: inp("textarea", r.notes, { id: "cl-notes" }) };
  const street = inp("text", "", { id: "cl-street" }), city = inp("text", "", { id: "cl-city" }), state = inp("text", "", { id: "cl-state" }), zip = inp("text", "", { id: "cl-zip" });
  const body = el("div", { cls: "form" }, [field("Name", f.name), field("Company", f.company), field("Email", f.email), field("Phone", f.phone), field("Reminders go by", f.prefer),
    field("Billing address", f.billing_address), field("Tags", f.tags), field("Notes", f.notes),
    c ? null : el("fieldset", null, [el("legend", { text: "Service address (optional)" }), field("Street", street), field("City", city), field("State", state), field("Zip", zip)])]);
  openDialog({ title: c ? "Edit client" : "New client", body, actions: [{ label: "Cancel" }, { label: "Save", primary: true, onClick: async () => {
    const rec = Object.assign({}, c || { created: T() });
    for (const k of Object.keys(f)) rec[k] = f[k].value;
    const id = await act((tx) => {
      const saved = c ? tx.update("clients", rec) : tx.create("clients", rec);
      if (!c && street.value.trim()) tx.create("properties", { client_id: saved.id, street: street.value, city: city.value, state: state.value, zip: zip.value });
      return saved.id;
    }, { render: false });
    if (!c && then) then(id); else go("client", id);
  } }] });
}

// Decimal degrees typed by a person to whole millionths, without floating point.
function parseDeg(s, label, lim) {
  const t = String(s).trim();
  if (t === "") return null;
  const m = /^(-?)([0-9]{1,3})(?:\.([0-9]{0,6}))?$/.exec(t);
  if (!m) throw new C.ServiceError("bad_field", `${label}: write decimal degrees like 30.318200 (at most 6 decimals).`);
  const v = (+m[2] * 1000000 + +((m[3] || "") + "000000").slice(0, 6)) * (m[1] ? -1 : 1);
  if (Math.abs(v) > lim) throw new C.ServiceError("bad_field", `${label}: is out of range.`);
  return v;
}
function degText(e6) { if (e6 === null) return ""; const s = e6 < 0 ? "-" : ""; const a = Math.abs(e6); return s + Math.floor(a / 1000000) + "." + String(a % 1000000).padStart(6, "0"); }

function editProperty(clientId, p) {
  const r = p || { label: "", street: "", city: "", state: "", zip: "", lat_e6: null, lon_e6: null, access_notes: "" };
  const f = { label: inp("text", r.label, { id: "pr-label" }), street: inp("text", r.street, { id: "pr-street" }), city: inp("text", r.city, { id: "pr-city" }),
    state: inp("text", r.state, { id: "pr-state" }), zip: inp("text", r.zip, { id: "pr-zip" }), access_notes: inp("textarea", r.access_notes, { id: "pr-access" }) };
  const lat = inp("text", degText(r.lat_e6), { id: "pr-lat", inputmode: "decimal" }), lon = inp("text", degText(r.lon_e6), { id: "pr-lon", inputmode: "decimal" });
  const body = el("div", { cls: "form" }, [field("Label", f.label, "For example Main house or Rental on 5th"), field("Street", f.street), field("City", f.city), field("State", f.state), field("Zip", f.zip),
    field("Latitude", lat, "Decimal degrees, used only for route order. Copy them from any map on your phone."), field("Longitude", lon), field("Access notes (gate codes, pets)", f.access_notes)]);
  const actions = [{ label: "Cancel" }];
  if (p) actions.push({ label: "Delete", danger: true, onClick: async () => { await act((tx) => tx.delete("properties", p.id)); } });
  actions.push({ label: "Save", primary: true, onClick: async () => {
    const rec = Object.assign({}, r, { client_id: clientId });
    for (const k of Object.keys(f)) rec[k] = f[k].value;
    rec.lat_e6 = parseDeg(lat.value, "Latitude", 90000000);
    rec.lon_e6 = parseDeg(lon.value, "Longitude", 180000000);
    if ((rec.lat_e6 === null) !== (rec.lon_e6 === null)) throw new C.ServiceError("bad_field", "Enter both latitude and longitude, or neither.");
    await act((tx) => (p ? tx.update("properties", rec) : tx.create("properties", rec)));
  } });
  openDialog({ title: p ? "Edit property" : "New property", body, actions });
}
function propertyOptions(clientId) { return [["", "(none)"]].concat(B().properties.filter((p) => p.client_id === clientId).map((p) => [p.id, (p.label ? p.label + ": " : "") + C.address_line(p)])); }
async function setClientArchived(id, on) {
  try {
    await act((tx) => tx.patch("clients", id, { archived: on }));
    const name = clientName(id);
    if (on) toast(name + " is archived. Their recurring jobs make no new visits.", "", [{ label: "Undo", onClick: () => setClientArchived(id, false) }]);
    else toast(name + " is active again. Recurring visits resume from today.");
  } catch (e) { showError(e); }
}
function clientOptions() { return B().clients.filter((c) => !c.archived).slice().sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1)).map((c) => [c.id, c.name]); }
// A client select that refreshes a property select.
function clientPropertyPick(clientId, propertyId, idp) {
  const opts = clientOptions();
  const cs = sel(opts, clientId || (opts[0] ? opts[0][0] : ""), { id: idp + "-client" });
  const ps = sel(propertyOptions(cs.value), propertyId || "", { id: idp + "-property" });
  if (!propertyId && ps.options.length > 1) ps.value = ps.options[1].value;
  cs.addEventListener("change", () => { const n = sel(propertyOptions(cs.value), "", { id: ps.id }); clear(ps); for (const o of [...n.options]) ps.append(o); if (ps.options.length > 1) ps.value = ps.options[1].value; });
  return { nodes: [field("Client", cs), field("Property", ps)], client: () => cs.value, property: () => ps.value };
}

PAGES.requests = function (main) {
  const f = ui("req_f", "open");
  main.append(pageHead("Requests", "Work clients asked for. Assess it, then turn it into a quote or a job.", [btn("New request", () => editRequest(null), "primary", { id: "new-request", icon: "plus" })]));
  const cnt = (k) => B().requests.filter((r) => (k === "open" ? r.status === "new" || r.status === "assessment" : k === "all" || r.status === k)).length;
  main.append(filterBar([["open", "Open", cnt("open")], ["converted", "Converted", cnt("converted")], ["archived", "Archived", cnt("archived")], ["all", "All", cnt("all")]], f, (v) => { setUi("req_f", v); render(); }));
  const rows = B().requests.filter((r) => f === "all" || (f === "open" ? r.status === "new" || r.status === "assessment" : r.status === f))
    .slice().sort((a, b) => (a.date < b.date ? 1 : -1))
    .map((r) => ({ cells: [shortDate(r.date), clientName(r.client_id), r.title, r.assessment_date ? shortDate(r.assessment_date) + " " + (r.assessment_time ? timeText(r.assessment_time) : "") : "", statusChip(r.status)], onClick: () => go("request", r.id) }));
  main.append(card("Request list", table([{ h: "Received" }, { h: "Client" }, { h: "Title" }, { h: "Assessment" }, { h: "Status" }], rows, { empty: "No requests here." })));
};
PAGES.request = function (main, id) {
  const r = byId("requests", id);
  if (!r) { main.append(el("p", { text: "That request is not in this file." })); return; }
  const open = r.status === "new" || r.status === "assessment";
  main.append(pageHead(r.title, clientName(r.client_id), [
    btn("Edit", () => editRequest(r), "", { id: "edit-request", icon: "edit" }),
    open ? btn("Convert to quote", async () => { const q = await act((tx) => STEP(tx, "quote_from_request", [r.id, T()]), { render: false }); go("quote", q.id); }, "primary", { id: "req-to-quote" }) : null,
    open ? btn("Convert to job", async () => { const j = await act((tx) => STEP(tx, "job_from_request", [r.id, T()]), { render: false }); go("job", j.id); }, "", { id: "req-to-job" }) : null,
    open ? btn("Archive", () => act((tx) => tx.patch("requests", r.id, { status: "archived" }))) : null], ["Requests", "requests"]));
  main.append(card("Details", kv([["Client", el("a", { href: "#client/" + r.client_id, text: clientName(r.client_id) })], ["Property", propOf(r) ? C.address_line(propOf(r)) : ""], ["Received", dateText(r.date)], ["Source", r.source],
    ["Status", statusChip(r.status)], ["Details", r.details], ["Assessment", r.assessment_date ? dateText(r.assessment_date) + (r.assessment_time ? " at " + timeText(r.assessment_time) : "") + (r.assessment_crew_ids.length ? ", " + r.assessment_crew_ids.map(crewName).join(", ") : "") : ""],
    ["Quote", r.quote_id ? el("a", { href: "#quote/" + r.quote_id, text: byId("quotes", r.quote_id).number }) : ""], ["Job", r.job_id ? el("a", { href: "#job/" + r.job_id, text: byId("jobs", r.job_id).number }) : ""]])));
};
function editRequest(r0) {
  const r = Object.assign({ client_id: "", property_id: "", date: T(), title: "", details: "", source: "", status: "new", assessment_date: "", assessment_time: "", assessment_crew_ids: [] }, r0 || {});
  if (!clientOptions().length) { toast("A request is for a client. Add the client; the request opens next."); editClient(null, (id) => editRequest(Object.assign({}, r0 || {}, { client_id: id }))); return; }
  const cp = clientPropertyPick(r.client_id, r.property_id, "rq");
  const f = { date: inp("date", r.date, { id: "rq-date" }), title: inp("text", r.title, { id: "rq-title" }), details: inp("textarea", r.details, { id: "rq-details" }),
    source: inp("text", r.source, { id: "rq-source" }), assessment_date: inp("date", r.assessment_date, { id: "rq-adate" }), assessment_time: inp("time", r.assessment_time, { id: "rq-atime" }) };
  const crew = crewChecks(r.assessment_crew_ids, "rq-crew");
  openDialog({ title: r.id ? "Edit request" : "New request", body: el("div", { cls: "form" }, [...cp.nodes, field("Received", f.date), field("What they need", f.title), field("Details", f.details), field("Came in by", f.source, "Phone, website, referral"),
    field("Assessment date (optional)", f.assessment_date), field("Assessment time", f.assessment_time), crew.node]),
  actions: [{ label: "Cancel" }, { label: "Save", primary: true, onClick: async () => {
    const rec = Object.assign({}, r, { client_id: cp.client(), property_id: cp.property(), assessment_crew_ids: crew.value() });
    for (const k of Object.keys(f)) rec[k] = f[k].value;
    if (rec.status === "new" && rec.assessment_date) rec.status = "assessment";
    const saved = await act((tx) => (r.id ? tx.update("requests", rec) : tx.create("requests", rec)), { render: false });
    go("request", saved.id);
  } }] });
}
function importClientsUi() {
  pickFile(".csv,.txt,text/csv", async (file) => {
    try {
      const text = await readFile(file, 5 * 1024 * 1024);
      const [book, res] = C.import_clients_csv(B(), text, T());
      const ok = await confirmDialog("Import clients", `${res.clients} new clients and ${res.properties} properties will be added.` + (res.skipped.length ? ` ${res.skipped.length} rows skipped: ${res.skipped.slice(0, 3).join(" ")}` : ""), "Import");
      if (ok) await setBook(book, `${res.clients} clients imported.`);
    } catch (e) { showError(e); }
  });
}
