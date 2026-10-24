// ---------------------------------------------------------------- base: DOM, icons, formatting, dialogs, files
// Every piece of user text reaches the page through textContent or an attribute value, never
// through innerHTML. The only markup parsed here is the fixed icon set.
const C = CORE;
const ART = /*ICONS*/;
const $ = (id) => document.getElementById(id);
const SVGNS = "http://www.w3.org/2000/svg";

function el(tag, attrs, kids) {
  const e = document.createElement(tag);
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === "cls") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k === "on") { for (const ev of Object.keys(v)) e.addEventListener(ev, v[ev]); }
      else if (k === "value") e.value = v;
      else if (k === "checked") e.checked = !!v;
      else if (k === "selected") e.selected = !!v;
      else if (k === "disabled") e.disabled = !!v;
      else e.setAttribute(k, v === true ? "" : String(v));
    }
  }
  if (kids !== undefined && kids !== null) add(e, kids);
  return e;
}
function add(parent, kids) {
  for (const k of Array.isArray(kids) ? kids : [kids]) {
    if (k === null || k === undefined || k === false) continue;
    if (Array.isArray(k)) add(parent, k);
    else parent.append(typeof k === "string" || typeof k === "number" ? document.createTextNode(String(k)) : k);
  }
  return parent;
}
function clear(e) { while (e.firstChild) e.removeChild(e.firstChild); return e; }
let UID = 0;
const uid = (p) => (p || "f") + "-" + (++UID);

// ---------------------------------------------------------------- icons (fixed markup from icons.json)
const SVG_CACHE = new Map();
function parsed(key, markup, box) {
  let t = SVG_CACHE.get(key);
  if (!t) {
    t = new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + box + '">' + markup + "</svg>", "image/svg+xml").documentElement;
    SVG_CACHE.set(key, t);
  }
  return t;
}
function icon(name, cls) {
  const s = document.createElementNS(SVGNS, "svg");
  s.setAttribute("class", cls || "i");
  s.setAttribute("viewBox", "0 0 24 24");
  for (const [k, v] of [["fill", "none"], ["stroke", "currentColor"], ["stroke-width", "2"], ["stroke-linecap", "round"], ["stroke-linejoin", "round"], ["aria-hidden", "true"]]) s.setAttribute(k, v);
  for (const n of parsed("i:" + name, ART.icons[name] || "", "0 0 24 24").childNodes) s.append(document.importNode(n, true));
  return s;
}
function glyph(name, cls) {
  const s = document.createElementNS(SVGNS, "svg");
  s.setAttribute("class", cls || "g");
  s.setAttribute("viewBox", "0 0 16 16");
  s.setAttribute("aria-hidden", "true");
  for (const n of parsed("g:" + name, ART.glyphs[name] || "", "0 0 16 16").childNodes) s.append(document.importNode(n, true));
  return s;
}
function markSvg() {
  const t = new DOMParser().parseFromString(ART.mark, "image/svg+xml").documentElement;
  const s = document.importNode(t, true);
  s.setAttribute("aria-hidden", "true");
  return s;
}

// ---------------------------------------------------------------- controls
function field(label, input, hint) {
  if (!input.id) input.id = uid("in");
  if (input.type === "checkbox") return el("label", { cls: "chk", for: input.id }, [input, el("span", { text: label })]);
  if (input.tagName === "INPUT" || input.tagName === "TEXTAREA") input.classList.add("inp");
  const control = input.tagName === "SELECT" ? el("div", { cls: "sel" }, [input, icon("chev-d")]) : input;
  if (input.tagName === "SELECT") input.classList.add("inp");
  return el("div", { cls: "fld" }, [el("label", { for: input.id, text: label }), control, hint ? el("span", { cls: "hint", text: hint }) : null]);
}
function inp(type, value, attrs) {
  const e = el(type === "textarea" ? "textarea" : "input", Object.assign(type === "textarea" ? { rows: 3 } : { type }, attrs || {}, { value: value === null || value === undefined ? "" : String(value) }));
  e.classList.add("inp");
  if (attrs && attrs.inputmode === "decimal") e.classList.add("n");
  return e;
}
function sel(options, value, attrs) {
  const s = el("select", attrs || {});
  s.classList.add("inp");
  for (const o of options) {
    const [v, t] = Array.isArray(o) ? o : [o, o];
    s.append(el("option", { value: v, text: t, selected: v === value }));
  }
  return s;
}
function chk(checked, attrs) { return el("input", Object.assign({ type: "checkbox", checked, cls: "cbx" }, attrs || {})); }
// btn(text, onClick, cls, attrs): cls takes "primary", "danger", "ghost", "big", "link" or "" (secondary).
function btn(text, onClick, cls, attrs) {
  const a = Object.assign({}, attrs || {});
  const ic = a.icon;
  delete a.icon;
  const base = cls === "link" ? "link" : "btn" + (cls ? " " + cls : "");
  return el("button", Object.assign({ type: "button", cls: base, on: { click: onClick } }, a), [ic ? icon(ic) : null, el("span", { text })]);
}
function iconBtn(name, label, onClick, attrs) {
  return el("button", Object.assign({ type: "button", cls: "iconbtn", "aria-label": label, title: label, on: { click: onClick } }, attrs || {}), icon(name));
}

// ---------------------------------------------------------------- formatting
const fmt = (c) => C.money(c);
const fmtPlain = (c) => C.cents_text(c);
const qtyText = (q) => C.milli_text(q);
function money(c, cls) { return el("span", { cls: "money" + (c < 0 ? " neg" : "") + (cls ? " " + cls : ""), text: fmt(c) }); }
function dateText(d) { if (!d) return ""; try { return C.date_words(d); } catch (e) { return d; } }
function shortDate(d) { if (!d) return ""; try { const w = C.date_words(d); return w.slice(0, w.lastIndexOf(",")); } catch (e) { return d; } }
function timeText(t) { return C.time_words(t); }
function range(v) {
  if (!v.start_time) return "Any time";
  const a = C.parse_time(v.start_time);
  return timeText(v.start_time).replace(/ (AM|PM)$/, "") + " to " + timeText(C.time_str(Math.min(1440, a + v.duration_min)));
}
const HOURS = (m) => C.hm(m);

// Job state: color, glyph and word always together.
const STATE = { scheduled: ["sched", "ring"], sent: ["sched", "ring"], awaiting: ["sched", "ring"], upcoming: ["sched", "ring"],
  today: ["sched", "ring"], active: ["sched", "ring"], assessment: ["sched", "ring"], queued: ["sched", "ring"],
  in_progress: ["prog", "half"], completed: ["done", "check"], approved: ["done", "check"], converted: ["done", "check"],
  paid: ["done", "check"], closed: ["done", "check"], late: ["late", "alert"], overdue: ["late", "alert"],
  requires_invoicing: ["bill", "tag"], changes_requested: ["bill", "tag"], draft: ["hold", "dash"], new: ["hold", "dash"],
  unscheduled: ["hold", "dash"], archived: ["hold", "void"], cancelled: ["hold", "void"], void: ["hold", "void"],
  dismissed: ["hold", "void"] };
const STATUS_TEXT = { draft: "Draft", sent: "Awaiting response", awaiting: "Awaiting payment", changes_requested: "Changes requested",
  approved: "Approved", converted: "Converted", archived: "Archived", paid: "Paid", overdue: "Past due", void: "Void", late: "Late",
  requires_invoicing: "Requires invoicing", today: "Today", upcoming: "Upcoming", unscheduled: "Unscheduled", active: "Active",
  closed: "Closed", scheduled: "Scheduled", in_progress: "In progress", completed: "Completed", cancelled: "Cancelled",
  new: "New", assessment: "Assessment", queued: "To review", dismissed: "Dismissed" };
function stateOf(s) { return STATE[s] || ["hold", "dash"]; }
function statusChip(s, word) {
  const [st, g] = stateOf(s);
  const voided = g === "void";
  return el("span", { cls: "st s-" + st + (voided ? " void" : "") }, [glyph(g), el("span", { cls: "t", text: word || STATUS_TEXT[s] || s })]);
}

// The one key answer per view.
function plate(label, value, sub, small) {
  return el("div", { cls: "plate" + (small ? " sm" : ""), role: "group", "aria-label": label }, [el("span", { cls: "plate-l", text: label }),
    el("span", { cls: "plate-v", text: value }), sub ? el("span", { cls: "plate-s", text: sub }) : null]);
}
function keyrow(pl, ctx) { return el("div", { cls: "keyrow" }, [pl, ctx ? el("p", { cls: "ctx", text: ctx }) : null]); }

// ---------------------------------------------------------------- dates and time on this device
function pad2(n) { return String(n).padStart(2, "0"); }
function localDate(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
function today() { return localDate(new Date()); }
function nowStamp() {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const a = Math.abs(off);
  return localDate(d) + "T" + pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds()) + sign + pad2(Math.floor(a / 60)) + ":" + pad2(a % 60);
}

// ---------------------------------------------------------------- toasts and dialogs
// actions: [{label, onClick}]; automatic steps pass Why and Undo.
function toast(text, tone, actions) {
  const box = $("toasts");
  const t = el("div", { cls: "toast" + (tone ? " " + tone : ""), role: "status" }, [tone === "bad" ? glyph("alert") : null, el("span", { text })]);
  const list = Array.isArray(actions) ? actions : actions ? [actions] : [];
  for (const a of list) t.append(btn(a.label, () => { t.remove(); a.onClick(); }, "link"));
  t.append(btn("Close", () => t.remove(), "link", { "aria-label": "Close message" }));
  // Keep at most three messages so a burst of them never covers the board the person is working on.
  while (box.children.length >= 3) box.firstChild.remove();
  box.append(t);
  setTimeout(() => t.remove(), list.length ? 12000 : 5000);
}
// A sheet dialog: header with title and close, body, footer actions. o.wide for documents,
// o.bar for the asphalt action bar, o.head for extra header content (a status chip).
function openDialog(o) {
  const d = el("dialog", { cls: "dlg" + (o.wide ? " wide" : "") + (o.full ? " full" : ""), "aria-label": o.title });
  const close = () => { d.close(); d.remove(); };
  const head = el("div", { cls: "sheet-h" }, [el("h2", { text: o.title }), o.head || null, iconBtn("close", "Close", close)]);
  const body = el("div", { cls: "sheet-b" });
  if (o.body) body.append(o.body);
  const foot = el("div", { cls: o.bar ? "actionbar" : "sheet-f" });
  const acts = o.actions || [{ label: "Close" }];
  acts.forEach((a, i) => {
    if (a.spacer) { foot.append(el("span", { cls: "sp" })); return; }
    const b = btn(a.label, async () => {
      if (a.onClick) {
        try { const keep = await a.onClick(); if (keep === true) return; } catch (e) { showError(e); return; }
      }
      close();
    }, a.primary ? "primary" : a.danger ? "danger" : "", { icon: a.icon });
    if (i === 0 && acts.length > 1 && !acts.some((x) => x.spacer)) foot.append(b, el("span", { cls: "sp" }));
    else foot.append(b);
  });
  d.append(el("div", { cls: "sheet" }, [head, body, foot]));
  d.addEventListener("cancel", () => d.remove());
  document.body.append(d);
  d.showModal();
  const f = body.querySelector("input,select,textarea");
  if (f && !o.noFocus) f.focus();
  return { close, el: d };
}
function confirmDialog(title, text, label, danger) {
  return new Promise((resolve) => {
    openDialog({ title, body: el("p", { text }), actions: [{ label: "Cancel", onClick: () => resolve(false) },
      { label, primary: !danger, danger: !!danger, onClick: () => resolve(true) }] });
  });
}
function showError(e) {
  if (e && e.name === "ServiceError") toast(e.message, "bad");
  else { toast("Something went wrong: " + (e && e.message ? e.message : String(e)), "bad"); if (typeof console !== "undefined") console.error(e); }
}

// ---------------------------------------------------------------- files: save and copy
function safeName(s) { return String(s || "file").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "file"; }
async function saveFile(name, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: type || "text/plain;charset=utf-8" });
  if (window.showSaveFilePicker && APP.kv.useFilePicker !== false) {
    try {
      const h = await window.showSaveFilePicker({ suggestedName: name });
      const w = await h.createWritable();
      await w.write(blob);
      await w.close();
      toast("Saved " + name + ".");
      return;
    } catch (e) {
      if (e && e.name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.setAttribute("download", name);
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast("Downloaded " + name + ".");
}
async function copyText(text, what) {
  try { await navigator.clipboard.writeText(text); toast((what || "Text") + " copied."); }
  catch (e) {
    const ta = el("textarea", { cls: "inp copybox", rows: 10, readonly: true, "aria-label": "Text to copy" });
    ta.value = text;
    openDialog({ title: "Copy by hand", body: el("div", { cls: "stack" }, [el("p", { text: "Copying is blocked here. Select the text and copy it." }), ta]) });
    ta.select();
  }
}
function readFile(file, max, asData) {
  return new Promise((resolve, reject) => {
    if (file.size > max) { reject(new C.ServiceError("too_large", `${file.name} is larger than ${Math.round(max / 1048576)} MB.`)); return; }
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("The file could not be read."));
    if (asData) r.readAsDataURL(file); else r.readAsText(file);
  });
}
function pickFile(accept, cb) {
  const i = el("input", { type: "file", accept, cls: "sr", "aria-label": "Choose a file" });
  i.addEventListener("change", () => { if (i.files && i.files[0]) cb(i.files[0]); i.remove(); });
  document.body.append(i);
  i.click();
}
function mailto(to, subject, body) { return "mailto:" + encodeURIComponent(to || "") + "?subject=" + encodeURIComponent(subject || "") + "&body=" + encodeURIComponent(body || ""); }
function smsto(to, body) { return "sms:" + encodeURIComponent((to || "").replace(/[^0-9+]/g, "")) + "?&body=" + encodeURIComponent(body || ""); }

// ---------------------------------------------------------------- tables, cards, lists
// cols: [{h, n, full}] ; rows: [{cells, onClick}] or elements. Tables reflow into cards on phones.
function table(cols, rows, opts) {
  const o = opts || {};
  const t = el("table", { cls: "tbl" + (o.noReflow ? "" : " reflow") });
  if (o.caption) t.append(el("caption", { cls: "sr", text: o.caption }));
  t.append(el("thead", null, el("tr", null, cols.map((c) => el("th", { cls: c.n ? "n" : "", scope: "col", text: c.h })))));
  const tb = el("tbody");
  for (const r of rows) {
    if (r instanceof Element) { tb.append(r); continue; }
    const tr = el("tr", null, r.cells.map((cell, i) => el("td", { cls: [cols[i] && cols[i].n ? "n" : "", cols[i] && cols[i].full ? "full" : "", cols[i] && cols[i].hide ? "hide-n" : "", i === 0 && !(cols[0] && cols[0].n) ? "full" : ""].filter((x) => x).join(" ") }, cell)));
    if (r.onClick) {
      tr.className = "click";
      tr.tabIndex = 0;
      tr.addEventListener("click", r.onClick);
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter") r.onClick(); });
    }
    tb.append(tr);
  }
  t.append(tb);
  if (!rows.length) tb.append(el("tr", null, el("td", { colspan: cols.length, cls: "muted full", text: o.empty || "Nothing here yet." })));
  return el("div", { cls: "tbl-wrap" }, t);
}
function card(title, kids, actions, extra) {
  return el("section", { cls: "card" + (extra ? " " + extra : "") }, [el("div", { cls: "card-h" }, [el("h2", { text: title }), actions && actions.length ? el("div", { cls: "acts" }, actions) : null]), kids]);
}
function kv(pairs) {
  const dl = el("dl", { cls: "kv" });
  for (const [k, v] of pairs) { if (v === null || v === undefined || v === "") continue; dl.append(el("dt", { text: k }), el("dd", null, v)); }
  return dl;
}
function grid(cls, kids) { return el("div", { cls: "grid " + cls }, kids); }
function notice(text, ic) { return el("div", { cls: "notice" }, [icon(ic || "info"), el("span", { text })]); }
function emptyState(title, text, actions) {
  const NS = SVGNS;
  const s = document.createElementNS(NS, "svg");
  s.setAttribute("viewBox", "0 0 180 100");
  s.setAttribute("aria-hidden", "true");
  const P = (tag, a) => { const n = document.createElementNS(NS, tag); for (const k of Object.keys(a)) n.setAttribute(k, a[k]); s.append(n); return n; };
  P("rect", { x: 4, y: 6, width: 172, height: 88, rx: 6, fill: "none", stroke: "var(--line)", "stroke-width": 2 });
  for (const x of [48, 92, 136]) P("path", { d: `M${x} 6v88`, stroke: "var(--line)", "stroke-width": 1.5 });
  P("rect", { x: 98, y: 30, width: 32, height: 10, rx: 2, fill: "var(--mark)", stroke: "var(--mark-ink)", "stroke-width": 1.5 });
  P("rect", { x: 104, y: 40, width: 20, height: 16, fill: "var(--mark)", stroke: "var(--mark-ink)", "stroke-width": 1.5 });
  return el("div", { cls: "empty" }, [s, el("h3", { text: title }), el("p", { cls: "muted", text }), actions && actions.length ? el("div", { cls: "acts" }, actions) : null]);
}
