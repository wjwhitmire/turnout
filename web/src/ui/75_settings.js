// ---------------------------------------------------------------- settings, catalog, crew, data
PAGES.settings = function (main) {
  const s = B().settings;
  main.append(pageHead("Settings", "Your business, prices, crew, automation timing, payment links, and your data.", [btn("Save settings", () => save(), "primary", { id: "save-settings-top", icon: "check" })]));
  const theme = APP.kv.theme || "auto";
  main.append(card("Appearance", el("div", { cls: "set-row" }, [el("div", null, ["Theme", el("span", { text: "Match this device, or always light or dark" })]),
    segmented([["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]], theme, async (v) => { await setTheme(v); render(); }, "Appearance", "set-theme")])));
  const f = {
    business_name: inp("text", s.business_name, { id: "set-name" }), address: inp("textarea", s.address, { id: "set-address" }), phone: inp("tel", s.phone, { id: "set-phone" }),
    email: inp("email", s.email, { id: "set-email" }), website: inp("text", s.website, { id: "set-website" }), license: inp("text", s.license, { id: "set-license" }),
    tax_mode: sel([["document", "Once on the total"], ["line", "On each line"]], s.tax_mode, { id: "set-taxmode" }),
    quote_prefix: inp("text", s.quote_prefix, { id: "set-qp" }), job_prefix: inp("text", s.job_prefix, { id: "set-jp" }), invoice_prefix: inp("text", s.invoice_prefix, { id: "set-ip" }),
    day_start: inp("time", s.day_start, { id: "set-daystart" }), day_end: inp("time", s.day_end, { id: "set-dayend" }),
    quote_message: inp("textarea", s.quote_message, { id: "set-qmsg" }), invoice_message: inp("textarea", s.invoice_message, { id: "set-imsg" }) };
  const nums = { terms_days: inp("number", s.terms_days, { id: "set-terms", min: 0, max: 365 }), quote_valid_days: inp("number", s.quote_valid_days, { id: "set-valid", min: 0, max: 365 }),
    visit_horizon_days: inp("number", s.visit_horizon_days, { id: "set-horizon", min: 7, max: 400 }), visit_reminder_days: inp("number", s.visit_reminder_days, { id: "set-vrem", min: 0, max: 14 }),
    quote_followup_days: inp("number", s.quote_followup_days, { id: "set-qfu", min: 0, max: 90 }), next_quote: inp("number", s.next_quote, { id: "set-nq", min: 1 }),
    next_job: inp("number", s.next_job, { id: "set-nj", min: 1 }), next_invoice: inp("number", s.next_invoice, { id: "set-ni", min: 1 }) };
  const tax = inp("text", qtyText(s.tax_rate_milli), { id: "set-tax", inputmode: "decimal" });
  const steps = inp("text", s.overdue_steps.join(", "), { id: "set-steps" });
  const lat = inp("text", degText(s.home_lat_e6), { id: "set-lat", inputmode: "decimal" }), lon = inp("text", degText(s.home_lon_e6), { id: "set-lon", inputmode: "decimal" });
  const save = async () => {
    try {
      const rec = {};
      for (const k of Object.keys(f)) rec[k] = f[k].value;
      for (const k of Object.keys(nums)) rec[k] = intOf(nums[k].value, k.replace(/_/g, " "));
      rec.tax_rate_milli = C.parse_milli(tax.value, "Tax rate");
      rec.overdue_steps = steps.value.split(/[ ,]+/).filter((x) => x).map((x) => intOf(x, "Follow-up days"));
      rec.home_lat_e6 = parseDeg(lat.value, "Latitude", 90000000);
      rec.home_lon_e6 = parseDeg(lon.value, "Longitude", 180000000);
      if ((rec.home_lat_e6 === null) !== (rec.home_lon_e6 === null)) throw new C.ServiceError("bad_field", "Enter both latitude and longitude, or neither.");
      const book = C.update_settings(B(), rec);
      book.name = rec.business_name || book.name;
      await setBook(book, "Settings saved.");
    } catch (e) { showError(e); }
  };
  main.append(card("Business", el("div", { cls: "form two" }, [field("Business name", f.business_name), field("Address", f.address), field("Phone", f.phone), field("Email", f.email), field("Website", f.website), field("License or tax id", f.license),
    field("Shop latitude", lat, "Routes start here. Decimal degrees."), field("Shop longitude", lon), field("Work day starts", f.day_start), field("Work day ends", f.day_end)])));
  main.append(card("Prices and numbering", el("div", { cls: "form two" }, [field("Sales tax rate, percent", tax), field("Round tax", f.tax_mode), field("Payment terms, days", nums.terms_days), field("Quotes valid for, days", nums.quote_valid_days),
    field("Quote prefix", f.quote_prefix), field("Next quote number", nums.next_quote), field("Job prefix", f.job_prefix), field("Next job number", nums.next_job), field("Invoice prefix", f.invoice_prefix), field("Next invoice number", nums.next_invoice),
    field("Default quote message", f.quote_message), field("Default invoice message", f.invoice_message)])));
  main.append(card("Automation timing", el("div", { cls: "form two" }, [field("Create recurring visits this many days ahead", nums.visit_horizon_days), field("Visit reminders, days before (0 is off)", nums.visit_reminder_days),
    field("Past due follow-ups, days after the due date", steps, "Up to 6 steps, like 1, 7, 14, 30"), field("Follow up on unanswered quotes after, days (0 is off)", nums.quote_followup_days)]),
  [btn("Save settings", save, "primary", { id: "save-settings" })]));
  main.append(el("div", { cls: "acts" }, [btn("Save settings", save, "primary", { id: "save-settings-2", icon: "check" })]));
  main.append(payLinksCard(), catalogCard(), crewCard(), card("Network", networkPanel()), dataCard());
};

function payLinksCard() {
  const links = B().settings.payment_links;
  const rows = links.map((l, i) => {
    let status = "";
    try { C.check_link(l); } catch (e) { status = e.message; }
    return { cells: [C.PAY_NAMES[l.kind], l.label, l.value, status ? statusChip("late", status) : statusChip("completed", "OK")], onClick: () => editPayLink(i) };
  });
  return card("Payment links", [el("p", { cls: "muted small", text: "Printed on quotes and invoices as a link and a QR code. Clients pay through your own processor; card data never touches this program. Record each payment when it arrives." }),
    table([{ h: "Kind" }, { h: "Label" }, { h: "Link or handle" }, { h: "Check" }], rows, { empty: "No payment links yet." })], [btn("Add payment link", () => editPayLink(-1), "", { id: "add-paylink", icon: "plus" })]);
}
function editPayLink(i) {
  const links = B().settings.payment_links.slice();
  const l = i >= 0 ? links[i] : { kind: "stripe", label: "", value: "" };
  const kind = sel(Object.keys(C.PAY_NAMES).map((k) => [k, C.PAY_NAMES[k] + (k === "stripe" ? " (Stripe Payment Link)" : k === "square" ? " (Square link)" : "")]), l.kind, { id: "pl-kind" });
  const label = inp("text", l.label, { id: "pl-label" }), value = inp("text", l.value, { id: "pl-value" });
  const hint = el("p", { cls: "muted small", "aria-live": "polite" });
  const show = () => { hint.textContent = { stripe: "Paste a link that starts with https://buy.stripe.com/", square: "Paste a link from square.link or checkout.square.site", paypal: "Your PayPal.Me name", venmo: "Your Venmo user name", cashapp: "Your $Cashtag", zelle: "The email or phone you receive Zelle at", ach: "Bank name and the details you share for transfers", other: "Any https link, or instructions" }[kind.value]; };
  kind.addEventListener("change", show);
  show();
  const actions = [{ label: "Cancel" }];
  if (i >= 0) actions.push({ label: "Remove", danger: true, onClick: () => setBook(C.update_settings(B(), { payment_links: links.filter((_, k) => k !== i) }), "Removed.") });
  actions.push({ label: "Save", primary: true, onClick: () => {
    const rec = C.check_record("link", { kind: kind.value, label: label.value, value: value.value }, "Payment link");
    C.check_link(rec);
    if (i >= 0) links[i] = rec; else links.push(rec);
    return setBook(C.update_settings(B(), { payment_links: links }), "Payment link saved.");
  } });
  openDialog({ title: "Payment link", body: el("div", { cls: "form" }, [field("Kind", kind), field("Label shown to clients", label), field("Link or handle", value), hint]), actions });
}
function catalogCard() {
  const rows = B().items.map((it) => ({ cells: [it.name, it.kind, it.unit, money(it.rate), money(it.cost), it.taxable ? "Yes" : "", it.archived ? "Archived" : ""], onClick: () => editItem(it) }));
  return card("Products and services", table([{ h: "Name" }, { h: "Kind" }, { h: "Unit" }, { h: "Price", n: true }, { h: "Cost", n: true }, { h: "Taxable" }, { h: "" }], rows), [btn("Add item", () => editItem(null), "", { id: "add-item", icon: "plus" })]);
}
function editItem(it0) {
  const it = Object.assign({ name: "", description: "", kind: "service", unit: "", rate: 0, cost: 0, taxable: false, archived: false }, it0 || {});
  const name = inp("text", it.name, { id: "it-name" }), desc = inp("textarea", it.description, { id: "it-desc" }), unit = inp("text", it.unit, { id: "it-unit" });
  const kind = sel([["service", "Service"], ["material", "Material"], ["other", "Other"]], it.kind, { id: "it-kind" });
  const rate = inp("text", fmtPlain(it.rate), { id: "it-rate", inputmode: "decimal" }), cost = inp("text", fmtPlain(it.cost), { id: "it-cost", inputmode: "decimal" });
  const tax = chk(it.taxable, { id: "it-tax" }), arch = chk(it.archived, { id: "it-arch" });
  openDialog({ title: it.id ? "Edit item" : "New item", body: el("div", { cls: "form" }, [field("Name", name), field("Description", desc), field("Kind", kind), field("Unit", unit), field("Price", rate), field("Your cost", cost), field("Taxable", tax), field("Archived", arch)]),
    actions: [{ label: "Cancel" }, { label: "Save", primary: true, onClick: () => {
      const rec = Object.assign({}, it, { name: name.value, description: desc.value, kind: kind.value, unit: unit.value, rate: C.parse_money(rate.value, "Price"), cost: C.parse_money(cost.value, "Cost"), taxable: tax.checked, archived: arch.checked });
      return act((tx) => (it.id ? tx.update("items", rec) : tx.create("items", rec)), { automate: false });
    } }] });
}
function crewCard() {
  const rows = B().crew.map((m) => ({ cells: [m.name, m.role, money(m.cost_rate), money(m.bill_rate), HOURS(m.weekly_minutes), m.active ? "Active" : "Inactive"], onClick: () => editCrew(m) }));
  return card("Crew members", table([{ h: "Name" }, { h: "Role" }, { h: "Cost per hour", n: true }, { h: "Bill rate", n: true }, { h: "Hours per week", n: true }, { h: "" }], rows), [btn("Add crew member", () => editCrew(null), "", { id: "add-crew", icon: "plus" })]);
}
function editCrew(m0, then) {
  const m = Object.assign({ name: "", role: "", phone: "", email: "", cost_rate: 0, bill_rate: 0, weekly_minutes: 2400, active: true }, m0 || {});
  const name = inp("text", m.name, { id: "cr-name" }), role = inp("text", m.role, { id: "cr-role" }), phone = inp("tel", m.phone, { id: "cr-phone" }), email = inp("email", m.email, { id: "cr-email" });
  const cost = inp("text", fmtPlain(m.cost_rate), { id: "cr-cost", inputmode: "decimal" }), bill = inp("text", fmtPlain(m.bill_rate), { id: "cr-bill", inputmode: "decimal" });
  const week = inp("text", HOURS(m.weekly_minutes), { id: "cr-week" }), active = chk(m.active, { id: "cr-active" });
  openDialog({ title: m.id ? "Edit crew member" : "New crew member", body: el("div", { cls: "form" }, [field("Name", name), field("Role", role), field("Phone", phone), field("Email", email),
    field("Cost per hour (wage plus taxes and benefits)", cost, "Used for job costing"), field("Bill rate per hour", bill), field("Hours available per week", week, "Used for utilization"), field("Active", active)]),
  actions: [{ label: "Cancel" }, { label: "Save", primary: true, onClick: () => {
    const rec = Object.assign({}, m, { name: name.value, role: role.value, phone: phone.value, email: email.value, cost_rate: C.parse_money(cost.value, "Cost per hour"), bill_rate: C.parse_money(bill.value, "Bill rate"), weekly_minutes: parseHours(week.value), active: active.checked });
    return act((tx) => (m.id ? tx.update("crew", rec) : tx.create("crew", rec)), { automate: false }).then((saved) => { if (!m.id && then) then(saved); return saved; });
  } }] });
}

function dataCard() {
  const kinds = sel(C.LIST_KINDS.map((k) => [k, k]), "clients", { id: "csv-kind" });
  // The next export starts the day after the last one ended, so nothing is left out; Crossfoot skips
  // anything it already has if the ranges overlap.
  const lastTo = ui("cf_last_to", "");
  const cfFrom = inp("date", !lastTo ? T().slice(0, 4) + "-01-01" : lastTo < T() ? C.add_days(lastTo, 1) : T(), { id: "cf-from" }), cfTo = inp("date", T(), { id: "cf-to" });
  const box = el("div", { cls: "stack" }, [
    el("p", { text: "Everything lives in this browser on this device. Save a backup often, and before clearing browser data." }),
    el("div", { cls: "acts" }, [btn("Save backup", saveBackup, "primary", { id: "save-backup", icon: "download" }), btn("Restore backup", restoreBackup, "", { id: "restore-backup", icon: "upload" })]),
    el("h3", { cls: "sec", text: "CSV" }), el("div", { cls: "row-form" }, [field("List", kinds), btn("Save CSV", () => saveFile(kinds.value + ".csv", C.list_csv(B(), kinds.value, T()), "text/csv;charset=utf-8"), "", { id: "save-csv" }),
      btn("Save line items CSV", () => { const k = ["quotes", "jobs", "invoices"].includes(kinds.value) ? kinds.value : "invoices"; saveFile(k + "-lines.csv", C.lines_csv(B(), k), "text/csv;charset=utf-8"); }, "", { id: "save-lines-csv" })]),
    el("h3", { cls: "sec", text: "Crossfoot (bookkeeping)" }), el("p", { cls: "muted small", text: "An IIF file with your clients, sent invoices and payments for Crossfoot's Settings, Import. Payments arrive unapplied; apply them in Crossfoot. The customer list is also offered as CSV." + (lastTo ? ` From starts the day after your last export, which ran to ${dateText(lastTo)}.` : "") }),
    el("div", { cls: "row-form" }, [field("From", cfFrom), field("To", cfTo), btn("Save IIF for Crossfoot", async () => { await saveFile("crossfoot-" + cfFrom.value + "-" + cfTo.value + ".iif", C.crossfoot_iif(B(), cfFrom.value, cfTo.value), "text/plain;charset=utf-8"); setUi("cf_last_to", cfTo.value); }, "", { id: "save-iif" }),
      btn("Save customer list CSV", () => saveFile("crossfoot-customers.csv", C.crossfoot_customers_csv(B()), "text/csv;charset=utf-8"), "", { id: "save-customers" })]),
    el("h3", { cls: "sec", text: "Start over" }),
    el("div", { cls: "acts" }, [btn("Load the example business", loadExample, "", { id: "load-example" }), btn("Start a new business file", startFresh, "", { id: "start-fresh" })]),
    el("div", { cls: "danger-zone" }, [el("div", null, [el("b", { text: "Delete all data" }), el("span", { cls: "sub", text: "Erases the business file, photos and settings on this device." })]), btn("Delete all", deleteAll, "danger", { id: "delete-all", icon: "trash" })]),
  ]);
  return card("Your data", box);
}
async function saveBackup() {
  const text = JSON.stringify(C.export_backup(B(), nowStamp()));
  await saveFile("field-service-backup-" + T() + ".json", text, "application/json");
  await kvSet("lastBackup", T());
}
function restoreBackup() {
  pickFile(".json,application/json", async (file) => {
    try {
      const text = await readFile(file, 64 * 1024 * 1024);
      const book = C.import_backup(C.parse_json(text));
      if (!(await confirmDialog("Restore backup", `Replace everything on this device with "${book.name}" (${book.clients.length} clients, ${book.jobs.length} jobs, ${book.invoices.length} invoices)?`, "Replace", true))) return;
      await setBook(book, "Backup restored.");
    } catch (e) { showError(e); }
  });
}
async function loadExample() {
  if (!(await confirmDialog("Load example", "Replace the data on this device with the example business? Save a backup first if you need your data.", "Load example", true))) return;
  await dbClear("files");
  await setBook(JSON.parse(JSON.stringify(C.EXAMPLE_BOOK)), "Example business loaded. Everything in it is invented.");
  go("home");
}
async function startFresh() {
  const name = inp("text", "", { id: "fresh-name" });
  openDialog({ title: "New business file", body: el("div", { cls: "form" }, [el("p", { text: "This replaces the data on this device. Save a backup first if you need it." }), field("Business name", name)]),
    actions: [{ label: "Cancel" }, { label: "Create", primary: true, onClick: async () => {
      const b = C.blank_book("b" + Date.now().toString(36), name.value || "My business", T());
      await dbClear("files");
      await setBook(b, "New business file created.");
      go("settings");
    } }] });
}
async function deleteAll() {
  const word = inp("text", "", { id: "delete-confirm", autocomplete: "off" });
  openDialog({ title: "Delete all data", body: el("div", { cls: "form" }, [el("p", { text: "This erases the business file, photos and settings from this browser. It cannot be undone. Type DELETE to confirm." }), field("Type DELETE", word)]),
    actions: [{ label: "Cancel" }, { label: "Delete everything", danger: true, onClick: async () => {
      if (word.value.trim() !== "DELETE") { toast("Type DELETE to confirm.", "bad"); return true; }
      for (const s of STORES) await dbClear(s);
      APP.kv = {};
      APP.packet = null;
      CREW_OPEN = "";
      APP.book = C.blank_book("b" + Date.now().toString(36), "My business", T());
      await saveBook();
      toast("All data deleted.");
      go("settings");
    } }] });
}
