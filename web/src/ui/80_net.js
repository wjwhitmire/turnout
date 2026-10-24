// ---------------------------------------------------------------- network features: one gate
// Every request the app can make goes through netScript(), which refuses unless the feature's
// switch is on and the URL's host is on that feature's list. Every switch is off until the person
// turns it on, so with all switches off the page makes no network requests. The Pages build's
// Content-Security-Policy allows only these hosts as a second wall.
const JSPDF = { url: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/4.2.1/jspdf.umd.min.js", sri: "sha384-qovJwSBbRDPP5cEjCp8S0UP66wrvnjaa60XMOGzTNanrThcrGfXfnZkvgY8N1KT3" };
const NET_FEATURES = {
  pdf: { title: "PDF files", hosts: ["cdnjs.cloudflare.com"],
    what: "Loads the jsPDF library (MIT license, about 420 KB) once from cdnjs.cloudflare.com with an integrity check, so Save PDF can build quote and invoice PDFs on this device. No document data is sent anywhere. With this off, save the client page instead; it opens and prints in any browser." },
};
function netSwitches() { return APP.kv.net || {}; }
function netDecision(feature, url) {
  const f = NET_FEATURES[feature];
  if (!f) return { ok: false, reason: "unknown feature" };
  if (netSwitches()[feature] !== true) return { ok: false, reason: f.title + " is off" };
  let u;
  try { u = new URL(url); } catch (e) { return { ok: false, reason: "not a web address" }; }
  if (u.protocol !== "https:") return { ok: false, reason: "only https is allowed" };
  if (!f.hosts.includes(u.hostname)) return { ok: false, reason: u.hostname + " is not on the list for " + f.title };
  return { ok: true };
}
const LOADED = new Map();
function netScript(feature, url, sri) {
  const d = netDecision(feature, url);
  if (!d.ok) return Promise.reject(new C.ServiceError("blocked", "Blocked: " + d.reason + ". Turn it on in Settings, Network."));
  if (LOADED.has(url)) return LOADED.get(url);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = url; s.integrity = sri; s.crossOrigin = "anonymous"; s.referrerPolicy = "no-referrer";
    s.addEventListener("load", resolve);
    s.addEventListener("error", () => { LOADED.delete(url); reject(new Error("Could not load " + new URL(url).hostname + " (offline, or the file did not match its integrity hash).")); });
    document.head.append(s);
  });
  LOADED.set(url, p);
  return p;
}
function networkPanel() {
  const box = el("div", { cls: "stack" }, [el("p", { text: "This app works with no network at all. One optional feature needs a one-time download. It is off until you turn it on, and it lists the only host it may reach." })]);
  for (const k of Object.keys(NET_FEATURES)) {
    const f = NET_FEATURES[k];
    const on = netSwitches()[k] === true;
    const b = el("button", { type: "button", cls: "sw" + (on ? " on" : ""), role: "switch", "aria-checked": on ? "true" : "false", "aria-label": f.title, id: "net-" + k,
      on: { click: async () => { await kvSet("net", Object.assign({}, netSwitches(), { [k]: !on })); toast(f.title + (!on ? " is on." : " is off.")); render(); } } });
    box.append(el("div", { cls: "set-row" }, [el("div", null, [f.title, el("span", { text: (on ? "On. " : "Off. ") + f.what }), el("span", { cls: "mono", text: "Host: " + f.hosts.join(", ") })]), b]));
  }
  box.append(el("p", { cls: "muted", text: "Not offered: sending email or texts for you, card processing, maps and crew sync. Those need a server or an account with another company. Reminders open as drafts in your own email or messages app, payment links point to your own processor, and crews trade job packet files." }));
  return box;
}

// ---------------------------------------------------------------- PDF (jsPDF, after the switch is on)
const latin1 = (s) => String(s).replace(/[^\x20-\x7e\xa0-\xff\n]/g, "?");
async function savePdf(kind, doc) {
  if (netSwitches().pdf !== true) {
    openDialog({ title: "PDF is off", body: el("p", { text: "Building a PDF needs the jsPDF library, downloaded once from cdnjs.cloudflare.com. Turn on PDF files in Settings, Network, or save the client page instead (it prints to PDF from any browser)." }),
      actions: [{ label: "Close" }, { label: "Save client page", onClick: () => saveClientPage(kind, doc) }, { label: "Open Settings", primary: true, onClick: () => go("settings") }] });
    return;
  }
  try {
    await netScript("pdf", JSPDF.url, JSPDF.sri);
    const blob = buildPdf(kind, doc);
    await saveFile(safeName((kind === "quotes" ? "quote-" : "invoice-") + doc.number) + ".pdf", blob, "application/pdf");
  } catch (e) { showError(e); }
}
// Letter page in points, laid out like the on-screen paper: header, 3 pt rule, three address
// columns, the line table, then ways to pay on the left and totals ending in the yellow plate.
function buildPdf(kind, doc) {
  const pdf = new window.jspdf.jsPDF({ unit: "pt", format: "letter", compress: true });
  const s = B().settings;
  const isQ = kind === "quotes";
  const t = C.doc_totals(doc);
  const client = byId("clients", doc.client_id);
  const W = 612, H = 792, M = 46, R = W - M;
  const text = (str, x, yy, opt) => pdf.text(latin1(str), x, yy, opt || {});
  const font = (w, size) => { pdf.setFont("helvetica", w); pdf.setFontSize(size); };
  const gray = (v) => pdf.setTextColor(v, v, v);
  let y = M + 14;
  font("bold", 18); text(s.business_name || "", M, y);
  font("normal", 9); gray(70);
  let ly = y + 15;
  for (const ln of [s.address, [s.phone, s.email].filter((x) => x).join("  "), s.license].filter((x) => x).join("\n").split("\n")) { text(ln, M, ly); ly += 11; }
  gray(0);
  font("bold", 30); pdf.setCharSpace(1.2); text(isQ ? "QUOTE" : "INVOICE", R, y + 8, { align: "right" }); pdf.setCharSpace(0);
  const job = doc.job_id ? byId("jobs", doc.job_id) : null;
  const meta = [[isQ ? "Quote no." : "Invoice no.", doc.number], ["Date", dateText(doc.date)], isQ ? ["Valid until", doc.valid_until ? dateText(doc.valid_until) : ""] : ["Due", dateText(doc.due_date)], ["Job", job ? job.number : ""]].filter((m) => m[1]);
  let ry = y + 26;
  for (const [k, v] of meta) { font("normal", 9); gray(90); text(k, R - 120, ry); gray(0); font("bold", 9); text(v, R, ry, { align: "right" }); ry += 12; }
  y = Math.max(ly, ry) + 8;
  pdf.setLineWidth(3); pdf.line(M, y, R, y); y += 22;
  const p = propOf(doc);
  const colW = (R - M) / 3;
  const block = (title, lines, x) => { font("bold", 8); gray(90); pdf.setCharSpace(0.8); text(title.toUpperCase(), x, y); pdf.setCharSpace(0); gray(0); font("normal", 10); let yy = y + 14; for (const ln of lines) { const w = pdf.splitTextToSize(latin1(ln), colW - 12); pdf.text(w, x, yy); yy += 12 * w.length; } return yy; };
  const subj = isQ ? doc.title : doc.subject;
  y = Math.max(block("Bill to", [client.name, client.company, ...String(client.billing_address || "").split("\n"), client.email, client.phone].filter((x) => x), M),
    block("Service address", p ? [p.label, C.address_line(p)].filter((x) => x) : ["Same as billing"], M + colW),
    block("Work", [subj || (job ? job.title : ""), job ? "Job " + job.number : ""].filter((x) => x), M + 2 * colW)) + 14;
  const cols = [M, 380, 460, R];
  const head = () => {
    font("bold", 8); gray(90); pdf.setCharSpace(0.6);
    text("ITEM", cols[0], y); text("QTY", cols[1], y, { align: "right" }); text("RATE", cols[2], y, { align: "right" }); text("AMOUNT", cols[3], y, { align: "right" });
    pdf.setCharSpace(0); gray(0);
    y += 6; pdf.setLineWidth(1.5); pdf.line(M, y, R, y); y += 15;
  };
  head();
  pdf.setLineWidth(0.5);
  doc.lines.forEach((ln, i) => {
    if (y > H - 150) { pdf.addPage(); y = M + 14; head(); }
    const off = ln.optional && !ln.selected;
    font("bold", 10); if (off) gray(110);
    const wrapped = pdf.splitTextToSize(latin1(ln.name + (ln.optional ? (ln.selected ? " (optional, chosen)" : " (optional, not chosen)") : "")), 300);
    pdf.text(wrapped, cols[0], y);
    font("normal", 10);
    text(qtyText(ln.qty_milli), cols[1], y, { align: "right" }); text(fmt(ln.rate), cols[2], y, { align: "right" }); text(fmt(t.lines[i].amount), cols[3], y, { align: "right" });
    y += 12 * wrapped.length;
    if (ln.description) { font("normal", 8.5); gray(90); const d = pdf.splitTextToSize(latin1(ln.description), 300); pdf.text(d, cols[0], y); y += 10.5 * d.length; }
    gray(0);
    y += 5; pdf.setDrawColor(200); pdf.line(M, y, R, y); pdf.setDrawColor(0); y += 13;
  });
  if (y > H - 220) { pdf.addPage(); y = M + 14; }
  y += 4;
  const top = y;
  // totals, right
  const tot = [["Subtotal", fmt(t.subtotal)]];
  if (t.discount) tot.push(["Discount", fmt(-t.discount)]);
  tot.push([`Tax (${qtyText(doc.tax_rate_milli)}%)`, fmt(t.tax)]);
  let due = 0, plateL = "", plateV = 0;
  if (isQ) {
    const qs = C.quote_state(B(), doc);
    if (t.optional_total) tot.push(["Optional, not chosen", fmt(t.optional_total)]);
    if (doc.deposit) tot.push(["Deposit required", fmt(doc.deposit)]);
    due = qs.deposit_due; plateL = "Quote total"; plateV = t.total;
  } else {
    const st = C.invoice_state(B(), doc, T());
    tot.push(["Total", fmt(t.total)]);
    if (st.paid) tot.push(["Paid", "(" + fmt(st.paid) + ")"]);
    due = st.status === "awaiting" || st.status === "overdue" ? st.balance : 0; plateL = "Balance due"; plateV = st.balance;
  }
  const tx = 360;
  for (const [k, v] of tot) { font("normal", 10); text(k, tx, y); text(v, R, y, { align: "right" }); y += 15; }
  y += 2;
  pdf.setFillColor(255, 211, 26); pdf.setDrawColor(0); pdf.setLineWidth(1.5);
  pdf.rect(tx - 8, y, R - tx + 8, 40, "FD");
  font("bold", 8); pdf.setCharSpace(0.8); text(plateL.toUpperCase(), tx, y + 15); pdf.setCharSpace(0);
  font("bold", 18); text(fmt(plateV), R - 8, y + 29, { align: "right" });
  const totBottom = y + 40;
  // ways to pay, left
  y = top;
  const opts = due > 0 ? C.payment_options(s, due, doc.number) : [];
  if (opts.length) {
    font("bold", 8); gray(90); pdf.setCharSpace(0.8); text((isQ ? "Pay the deposit, " : "Ways to pay, ").toUpperCase() + fmt(due), M, y); pdf.setCharSpace(0); gray(0); y += 14;
    font("normal", 9.5);
    for (const o of opts) { const lines = pdf.splitTextToSize(latin1(o.label + ": " + o.text), 280); pdf.text(lines, M, y); y += 11.5 * lines.length + 3; }
    const first = opts.find((o) => o.url);
    if (first) {
      const q = C.qr_matrix(first.url);
      const size = 96, cell = size / (q.size + 8);
      pdf.setFillColor(0, 0, 0);
      q.rows.forEach((row, r) => { for (let c = 0; c < row.length; c++) if (row[c] === "1") pdf.rect(M + (c + 4) * cell, y + (r + 4) * cell, cell, cell, "F"); });
      font("normal", 8.5); gray(70); text("Scan to pay with " + first.label, M + size + 6, y + size / 2); gray(0);
      y += size;
    }
  }
  y = Math.max(y, totBottom) + 18;
  if (doc.message) { font("normal", 10); const m = pdf.splitTextToSize(latin1(doc.message), R - M); if (y + 12 * m.length > H - 60) { pdf.addPage(); y = M + 14; } pdf.text(m, M, y); }
  const n = pdf.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    pdf.setPage(i);
    font("normal", 8); gray(110);
    text(`${isQ ? "Quote" : "Invoice"} ${doc.number}, ${client.name}`, M, H - 28); text(`Page ${i} of ${n}`, R, H - 28, { align: "right" });
    gray(0);
  }
  return pdf.output("blob");
}
