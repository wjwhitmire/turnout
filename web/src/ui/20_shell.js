// ---------------------------------------------------------------- shell: asphalt nav, top bar, routing, Create menu
const NAV = [
  [null, [["home", "Home"], ["schedule", "Schedule"], ["clients", "Clients"], ["requests", "Requests"], ["quotes", "Quotes"], ["jobs", "Jobs"], ["invoices", "Invoices"]]],
  ["Office", [["reports", "Reports"], ["timesheets", "Timesheets"], ["reminders", "Reminders"], ["automations", "Automations"]]],
  ["Crew", [["packets", "Crew packets"], ["crew", "Crew view"]]],
  [null, [["settings", "Settings"]]],
];
const PAGES = {};
const PARENT = { client: "clients", request: "requests", quote: "quotes", job: "jobs", invoice: "invoices" };

function go(page, id) {
  const h = "#" + page + (id ? "/" + id : "");
  if (location.hash === h) render(); else location.hash = h;
}
function readRoute() {
  const h = (location.hash || "#home").slice(1);
  const [page, id] = h.split("/");
  APP.route = { page: PAGES[page] ? page : "home", id: id || "" };
}
function navCounts() {
  return { requests: B().requests.filter((r) => r.status === "new").length, reminders: B().reminders.filter((r) => r.status === "queued").length };
}
function buildNav() {
  const nav = clear($("nav"));
  const brand = el("a", { cls: "brand", href: "#home" }, [markSvg(), el("span", null, [el("b", { id: "product-name", text: C.PRODUCT_NAME }), el("small", { text: "FIELD TOOLS NO. 17" })])]);
  nav.append(el("div", { cls: "nav-top" }, [brand, iconBtn("close", "Close menu", closeDrawer, { cls: "iconbtn only-phone nav-close" })]));
  const counts = navCounts();
  for (const [label, items] of NAV) {
    if (label) nav.append(el("div", { cls: "nav-l", text: label }));
    const ul = el("ul");
    for (const [page, text] of items) {
      const a = el("a", { cls: "nav-a", href: "#" + page, id: "nav-" + page }, [icon(page), el("span", { text })]);
      if (counts[page]) a.append(el("span", { cls: "cnt", "aria-label": counts[page] + (page === "requests" ? " new" : " waiting"), text: String(counts[page]) }));
      if (APP.route.page === page || PARENT[APP.route.page] === page) a.setAttribute("aria-current", "page");
      a.addEventListener("click", closeDrawer);
      ul.append(el("li", null, a));
    }
    nav.append(ul);
  }
  nav.append(el("p", { cls: "nav-note", text: "Your business file lives on this device. Save a backup from Settings." }));
  const s = APP.book.settings;
  $("biz").textContent = s.business_name || APP.book.name || "Your business";
  $("example-flag").hidden = !APP.book.example;
  const ex = clear($("exstrip"));
  ex.hidden = !APP.book.example;
  if (APP.book.example) ex.append(el("span", null, [el("b", { text: "Example data. " }), "This business is invented so you can try every screen."]), btn("Start my own business file", () => startFresh(), "link"));
}
function openDrawer() {
  $("nav").classList.add("open");
  $("scrim").hidden = false;
  $("menu-btn").setAttribute("aria-expanded", "true");
  const first = $("nav").querySelector(".nav-a");
  if (first) first.focus();
}
function closeDrawer() {
  $("nav").classList.remove("open");
  $("scrim").hidden = true;
  $("menu-btn").setAttribute("aria-expanded", "false");
}
function render() {
  readRoute();
  buildNav();
  const main = clear($("main"));
  main.dataset.page = APP.route.page;
  try {
    PAGES[APP.route.page](main, APP.route.id);
  } catch (e) {
    showError(e);
    main.append(el("p", { text: "This page could not be shown." }));
  }
  main.focus({ preventScroll: true });
}
// Page header: optional crumb [label, hash], title, sub line, actions.
function pageHead(title, sub, actions, crumb) {
  return el("div", { cls: "ph" }, [el("div", { cls: "ph-t" }, [crumb ? el("a", { cls: "crumb", href: "#" + crumb[1] }, [icon("chev-l"), el("span", { text: crumb[0] })]) : null,
    el("h1", { text: title }), sub ? el("p", { text: sub }) : null]),
  actions && actions.filter((x) => x).length ? el("div", { cls: "acts" }, actions) : null]);
}

// ---------------------------------------------------------------- Create menu (N, then a letter)
const CREATE = [["Client", "client", "C", () => editClient(null)], ["Request", "requests", "R", () => editRequest(null)], ["Quote", "quotes", "Q", () => newQuote(null)],
  ["Job", "jobs", "J", () => editJob(null)], ["Invoice", "invoices", "I", () => newInvoice(null)], ["Time entry", "time", "T", () => editTime(null)]];
function createMenu() {
  if (document.querySelector("dialog.createdlg")) return;
  const d = el("dialog", { cls: "createdlg", "aria-label": "Create" });
  const close = (back) => { d.close(); d.remove(); if (back) $("create-btn").focus(); };
  const menu = el("div", { cls: "create", role: "menu", "aria-label": "Create" }, [el("div", { cls: "hd" }, [el("span", { text: "Create" }), el("span", { text: "N, then a letter" })])]);
  for (const [label, ic, key, fn] of CREATE) {
    menu.append(el("a", { href: "#" + APP.route.page, id: "create-" + label.toLowerCase().replace(/ /g, "-"), role: "menuitem", on: { click: (e) => { e.preventDefault(); close(false); fn(); } } },
      [icon(ic), el("span", { text: label }), el("kbd", { text: key })]));
  }
  d.append(menu);
  d.addEventListener("keydown", (e) => {
    const hit = CREATE.find((c) => c[2] === e.key.toUpperCase());
    if (hit && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); close(false); hit[3](); }
  });
  d.addEventListener("cancel", (e) => { e.preventDefault(); close(true); });
  d.addEventListener("click", (e) => { if (e.target === d) close(true); });
  document.body.append(d);
  const r = $("create-btn").getBoundingClientRect();
  if (window.innerWidth >= 760) { d.style.top = r.bottom + 8 + "px"; d.style.right = Math.max(16, window.innerWidth - r.right) + "px"; }
  d.showModal();
  menu.querySelector("a").focus();
}
// Pills with counts: options [[value, text, count?]]
function filterBar(options, value, onChange, label) {
  const bar = el("div", { cls: "pills", role: "group", "aria-label": label || "Filter" });
  for (const [v, t, n] of options) {
    bar.append(el("button", { type: "button", cls: "pill", "aria-pressed": v === value ? "true" : "false", on: { click: () => onChange(v) } },
      [el("span", { text: t }), n !== undefined && n !== null ? el("span", { cls: "c", text: String(n) }) : null]));
  }
  return bar;
}
function segmented(options, value, onChange, label, id) {
  const g = el("div", { cls: "seg", role: "group", "aria-label": label, id });
  for (const [v, t] of options) g.append(el("button", { type: "button", "aria-pressed": v === value ? "true" : "false", text: t, on: { click: () => onChange(v) } }));
  return g;
}
function searchBox(value, onInput, label) {
  const i = inp("search", value, { placeholder: label, "aria-label": label, id: uid("q") });
  i.addEventListener("input", () => onInput(i.value));
  return el("div", { cls: "search" }, [icon("search"), i]);
}
function ui(key, dflt) { const v = APP.kv["ui:" + key]; return v === undefined ? dflt : v; }
function setUi(key, v) { APP.kv["ui:" + key] = v; dbPut("kv", "ui:" + key, v).catch(() => {}); }

// ---------------------------------------------------------------- theme
function applyTheme() {
  const t = APP.kv.theme || "auto";
  const r = document.documentElement;
  if (t === "auto") r.removeAttribute("data-theme"); else r.setAttribute("data-theme", t);
  const dark = t === "dark" || (t === "auto" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.setAttribute("content", dark ? "#1b1d20" : "#ffffff");
  const b = $("theme-btn");
  if (b) { clear(b).append(icon(dark ? "sun" : "moon")); b.setAttribute("aria-label", dark ? "Switch to light" : "Switch to dark"); }
}
async function setTheme(t) { await kvSet("theme", t).catch(() => { APP.kv.theme = t; }); applyTheme(); }
