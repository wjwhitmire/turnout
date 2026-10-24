// ---------------------------------------------------------------- schedule and dispatch board
// Day: the T-card board, one column per crew member with Unassigned first, on a time grid; drag
// a card to another column or time to reassign or reschedule. Week: crew rows by day. Month: a
// calendar. Route: each crew member's day in the suggested order (straight-line distances between
// the properties' coordinates; no map service).
const SLOT_MIN = 15;
const SLOT_PX = 22;
const HOUR_PX = SLOT_PX * 4;
const MIN_CARD = 44;

PAGES.schedule = function (main) {
  const view = ui("sched_view", "day");
  let date = ui("sched_date", "") || T();
  const shift = (n) => {
    if (view === "month") date = C.add_months(date, n);
    else date = C.add_days(date, view === "week" ? 7 * n : n);
    setUi("sched_date", date);
    render();
  };
  const dateIn = inp("date", date, { id: "sched-date", "aria-label": "Go to date", cls: "only-wide" });
  dateIn.classList.add("only-wide");
  dateIn.addEventListener("change", () => { if (dateIn.value) { setUi("sched_date", dateIn.value); render(); } });
  const label = view === "month" ? date.slice(0, 7) : view === "week" ? "Week of " + shortDate(C.week_start(date)) : dateText(date);
  main.append(pageHead("Schedule", null, [btn("New visit", () => newVisitDialog(date), "primary", { id: "new-visit", icon: "plus" })]));
  main.append(el("div", { cls: "sbar" }, [
    iconBtn("chev-l", "Previous " + view, () => shift(-1), { id: "sched-prev", cls: "iconbtn bordered" }),
    btn("Today", () => { setUi("sched_date", T()); render(); }, "", { id: "sched-today" }),
    iconBtn("chev-r", "Next " + view, () => shift(1), { id: "sched-next", cls: "iconbtn bordered" }),
    el("span", { cls: "date", text: label }), el("span", { cls: "spacer" }), dateIn,
    segmented([["day", "Day"], ["week", "Week"], ["month", "Month"], ["route", "Route"]], view, (v) => { setUi("sched_view", v); render(); }, "Schedule view", "sched-view")]));
  const rng = view === "month" ? [date.slice(0, 8) + "01", C.month_end(date)] : view === "week" ? [C.week_start(date), C.add_days(C.week_start(date), 6)] : [date, date];
  const conflicts = C.find_conflicts(B(), rng[0], rng[1]);
  APP.conflictIds = new Set(conflicts.flatMap((c) => [c.a, c.b]));
  const banner = conflicts.length ? el("div", { cls: "banner", role: "alert", id: "conflicts" }, [glyph("double"), el("div", null, [el("b", { text: `${conflicts.length} double booking${conflicts.length === 1 ? "" : "s"}: ` }),
    conflicts.slice(0, 4).map((c) => { const v = byId("visits", c.b); return `${crewName(c.crew_id)}, ${shortDate(c.date)} ${range(v)} (${c.overlap_min} min overlap). `; }), "Drag one of the two cards, or open it and use Move."])]) : null;
  if (view === "day") dayBoard(main, date, banner);
  else if (view === "week") weekBoard(main, date, banner);
  else if (view === "month") { if (banner) main.append(banner); monthBoard(main, date); }
  else routeBoard(main, date);
};

function crewList() { return B().crew.filter((m) => m.active); }
function initials(name) { return name.split(" ").filter((x) => x).slice(0, 2).map((x) => x[0]).join("").toUpperCase(); }

// A T-card for a visit. opts: {from, height, stop, compact}
function tcard(v, opts) {
  const o = opts || {};
  const j = jobOf(v);
  const st = visitState(v);
  const [s, g] = stateOf(st);
  const locked = v.status === "completed" || v.status === "cancelled";
  const movable = !locked && o.from !== undefined;
  let cls = "tc vb st-" + v.status + " s-" + s;
  if (s === "hold") cls += " hold";
  if (v.status === "completed") cls += " done";
  if (APP.conflictIds && APP.conflictIds.has(v.id)) cls += " conflict";
  if (o.height !== undefined) { if (o.height < 52) cls += " short"; else if (o.height < 80) cls += " compact"; }
  const word = o.stop ? "Stop " + o.stop : STATUS_TEXT[st];
  const head = el("div", { cls: "tc-h vb-t" }, [glyph(g), el("span", { text: range(v) }), locked ? icon("lock") : j.kind === "recurring" ? icon("repeat") : null, movable ? icon("grip", "i grip") : null, el("span", { cls: "w", text: word })]);
  const body = el("div", { cls: "tc-b" }, [el("span", { cls: "tc-c", text: clientName(j.client_id) }), el("span", { cls: "tc-j vb-s", text: j.title + (v.route_seq && !o.stop ? ", stop " + v.route_seq : "") })]);
  const card = el("div", { cls, tabindex: 0, role: "button", "data-visit": v.id, "aria-label": `${clientName(j.client_id)}, ${j.title}, ${range(v)}, ${STATUS_TEXT[st]}` }, [head, body]);
  if (APP.conflictIds && APP.conflictIds.has(v.id)) card.append(el("span", { cls: "dbl" }, [glyph("double"), "Double booked"]));
  dragSource(card, movable ? { kind: "visit", id: v.id, from: o.from, dur: v.duration_min } : null, () => openVisit(v.id));
  return card;
}

function dayBoard(main, date, banner) {
  const s = B().settings;
  const vs = B().visits.filter((v) => v.date === date && v.status !== "cancelled");
  let lo = C.parse_time(s.day_start || "07:00"), hi = C.parse_time(s.day_end || "17:00");
  for (const v of vs) if (v.start_time) { const a = C.parse_time(v.start_time); lo = Math.min(lo, a); hi = Math.max(hi, a + v.duration_min); }
  const top = Math.max(0, Math.floor(lo / 60) * 60), bottom = Math.min(1440, Math.max(top + 240, Math.ceil(hi / 60) * 60));
  const rows = (bottom - top) / 60;
  const cols = [{ id: "", name: "Unassigned" }].concat(crewList());
  const unassigned = vs.filter((v) => !v.crew_ids.length).length;
  main.append(keyrow(plate("Unassigned today", String(unassigned), `${vs.length} visit${vs.length === 1 ? "" : "s"} on the board`), "Empty the Unassigned column first: drag each card onto a crew member, or press it and use Move."));
  if (banner) main.append(banner);
  const jump = el("div", { cls: "pills only-narrow", role: "group", "aria-label": "Jump to crew member" });
  const board = el("div", { cls: "board", style: `--cols:${cols.length};--rows:${rows}` });
  const hrs = el("div", { cls: "hrs" });
  for (let m = top + 60; m < bottom; m += 60) hrs.append(el("span", { style: `top:${((m - top) / 60) * HOUR_PX}px`, text: timeText(C.time_str(m)).replace(":00", "") }));
  const isToday = date === T();
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nowY = ((nowMin - top) / 60) * HOUR_PX;
  const showNow = isToday && nowMin > top && nowMin < bottom;
  if (showNow) hrs.append(el("span", { cls: "now-k", style: `--y:${nowY}px`, text: timeText(C.time_str(nowMin)).replace(/ [AP]M$/, ""), "aria-label": "Now, " + timeText(C.time_str(nowMin)) }));
  board.append(el("div", { cls: "hours" }, [el("div", { cls: "col-h" }), el("div", { cls: "any-h", text: "Any time" }), hrs]));
  cols.forEach((c, idx) => {
    const mine = vs.filter((v) => (c.id ? v.crew_ids.includes(c.id) : !v.crew_ids.length));
    const mins = mine.reduce((a, v) => a + v.duration_min, 0);
    const head = el("div", { cls: "col-h" }, [el("span", { cls: "ava", "aria-hidden": "true", text: c.id ? initials(c.name) : "?" }),
      el("div", null, [el("b", { text: c.name }), el("span", { text: `${mine.length} visit${mine.length === 1 ? "" : "s"}` + (c.id ? `, ${HOURS(mins)} h` : "") })])]);
    const any = el("div", { cls: "any drop", "data-date": date, "data-crew": c.id, "data-time": "", "data-name": c.name });
    for (const v of mine.filter((v) => !v.start_time)) any.append(tcard(v, { from: c.id }));
    const body = el("div", { cls: "cb drop", "data-date": date, "data-crew": c.id, "data-top": String(top), "data-name": c.name });
    if (showNow) body.append(el("div", { cls: "now", style: `top:${nowY}px` }));
    for (const v of mine.filter((v) => v.start_time)) {
      const st = C.parse_time(v.start_time);
      const y = Math.max(0, ((st - top) / SLOT_MIN) * SLOT_PX);
      const h = Math.max(MIN_CARD, (v.duration_min / SLOT_MIN) * SLOT_PX - 2);
      const b = tcard(v, { from: c.id, height: h });
      b.style.top = y + "px";
      b.style.height = h + "px";
      body.append(b);
    }
    board.append(el("div", { cls: "col" + (c.id ? "" : " un"), "data-crew": c.id }, [head, any, body]));
    jump.append(el("button", { type: "button", cls: "pill", "aria-pressed": idx === 1 ? "true" : "false", on: { click: (e) => {
      board.querySelectorAll(".col")[idx].scrollIntoView({ inline: "start", block: "nearest" });
      for (const p of jump.children) p.setAttribute("aria-pressed", p === e.currentTarget ? "true" : "false");
    } } }, [el("span", { text: c.id ? c.name.split(" ")[0] : "Unassigned" }), el("span", { cls: "c", text: String(mine.length) })]));
  });
  const wrap = el("div", { cls: "board-wrap", role: "region", "aria-label": "Dispatch board, " + dateText(date), tabindex: 0 }, board);
  main.append(jump, wrap);
  if (window.innerWidth < 760 && cols.length > 1) requestAnimationFrame(() => { const c1 = board.querySelectorAll(".col")[1]; if (c1) wrap.scrollLeft = c1.offsetLeft - 48; });
  const waiting = B().jobs.filter((j) => C.job_state(B(), j, T()) === "unscheduled");
  const tray = el("div", { cls: "tray-l" });
  for (const j of waiting) {
    const ch = el("div", { cls: "tc s-hold hold job-chip", tabindex: 0, role: "button", "data-job": j.id, "aria-label": `${clientName(j.client_id)}, ${j.title}, Job ${j.number}, Unscheduled` }, [
      el("div", { cls: "tc-h" }, [glyph("dash"), el("span", { text: "Job " + j.number }), icon("grip", "i grip"), el("span", { cls: "w", text: "Unscheduled" })]),
      el("div", { cls: "tc-b" }, [el("span", { cls: "tc-c", text: clientName(j.client_id) }), el("span", { cls: "tc-j", text: j.title })])]);
    dragSource(ch, { kind: "job", id: j.id, dur: j.duration_min }, () => newVisitDialog(date, j.id));
    tray.append(ch);
  }
  main.append(el("div", { cls: "tray card", id: "tray" }, [el("div", { cls: "card-h" }, [el("h2", { text: "Unscheduled jobs" }), el("span", { cls: "muted", text: "Drag onto the board, or press one to pick a time." })]),
    waiting.length ? tray : el("p", { cls: "muted", text: "Every active job has a visit." })]));
}

// ---------------------------------------------------------------- drag and drop
// Mouse and pen start a drag after a short move; touch starts after a 300 ms press and hold, so a
// swipe still scrolls the board. A short press opens the card. Escape puts the card back.
function dragSource(node, info, onClick) {
  node.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } });
  node.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const touch = e.pointerType === "touch";
    const x0 = e.clientX, y0 = e.clientY;
    let lifted = null, over = null, preview = null, origin = null, moved = false, timer = null, cancelled = false, last = e, edgeTimer = null;
    // Near an edge of the board (or the window) the board scrolls while a card is held there, so a
    // phone can reach a crew column or hour that is off screen.
    const wrap = node.closest(".board-wrap");
    const edgeScroll = () => {
      if (!lifted) return;
      const zone = 36, step = 14;
      const r = wrap ? wrap.getBoundingClientRect() : { left: 0, right: innerWidth, top: 0, bottom: innerHeight };
      let dx = 0, dy = 0;
      if (last.clientX < Math.max(r.left, 0) + zone) dx = -step; else if (last.clientX > Math.min(r.right, innerWidth) - zone) dx = step;
      if (last.clientY < zone) dy = -step; else if (last.clientY > innerHeight - zone) dy = step;
      if (dx && wrap) wrap.scrollLeft += dx;
      if (dy) window.scrollBy(0, dy);
      if (dx || dy) place(last);
    };
    const lift = () => {
      if (!info || lifted) return;
      lifted = node.cloneNode(true);
      lifted.classList.add("lifted", "ghost");
      lifted.classList.remove("conflict");
      lifted.style.width = node.offsetWidth + "px";
      lifted.style.height = Math.min(node.offsetHeight, 120) + "px";
      lifted.style.top = "0px";
      document.body.append(lifted);
      document.body.classList.add("is-dragging");
      if (wrap) wrap.style.scrollSnapType = "none";   // column snapping would undo each small step
      edgeTimer = setInterval(edgeScroll, 50);
      node.classList.add("dragging");
      if (node.parentNode && node.parentNode.classList.contains("cb")) {
        origin = el("div", { cls: "slot-origin", style: `top:${node.style.top};height:${node.style.height}`, text: "Moving" });
        node.parentNode.append(origin);
      }
      place(last);
    };
    const stopTouchScroll = (ev) => { if (lifted) ev.preventDefault(); };
    const place = (ev) => {
      lifted.style.left = ev.clientX + 10 + "px";
      lifted.style.top = ev.clientY + 10 + "px";
      lifted.hidden = true;
      const t = document.elementFromPoint(ev.clientX, ev.clientY);
      lifted.hidden = false;
      const d = t ? t.closest(".drop") : null;
      if (over && over !== d) over.classList.remove("over");
      if (preview) { preview.remove(); preview = null; }
      if (d) { d.classList.add("over"); preview = dropPreview(info, d, ev.clientY); }
      over = d;
    };
    const move = (ev) => {
      last = ev;
      const far = Math.hypot(ev.clientX - x0, ev.clientY - y0) >= 8;
      if (far) moved = true;
      if (touch && !lifted) { if (far) { clearTimeout(timer); cleanup(); } return; }
      if (!info) return;
      if (!lifted && far) lift();
      if (lifted) { ev.preventDefault(); place(ev); }
    };
    const key = (ev) => { if (ev.key === "Escape" && lifted) { cancelled = true; up(ev); } };
    const cleanup = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
      document.removeEventListener("keydown", key);
      document.removeEventListener("touchmove", stopTouchScroll);
    };
    const up = (ev) => {
      clearTimeout(timer);
      clearInterval(edgeTimer);
      if (wrap) wrap.style.scrollSnapType = "";
      cleanup();
      if (over) over.classList.remove("over");
      if (preview) preview.remove();
      if (origin) origin.remove();
      if (!lifted) { if (ev.type === "pointerup" && !moved) onClick(); return; }
      lifted.remove();
      document.body.classList.remove("is-dragging");
      node.classList.remove("dragging");
      if (over && !cancelled && ev.type === "pointerup") dropOn(info, over, ev.clientY);
    };
    document.addEventListener("pointermove", move, { passive: false });
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
    document.addEventListener("keydown", key);
    document.addEventListener("touchmove", stopTouchScroll, { passive: false });
    if (touch && info) timer = setTimeout(() => { if (!moved) lift(); }, 300);
  });
}
function dropTarget(zone, clientY) {
  const t = { date: zone.dataset.date, crew: zone.dataset.crew };
  if (zone.dataset.time !== undefined) t.time = zone.dataset.time;
  else if (zone.dataset.top !== undefined) {
    const r = zone.getBoundingClientRect();
    const slot = Math.max(0, Math.round((clientY - r.top) / SLOT_PX));
    t.time = C.time_str(Math.min(1440 - SLOT_MIN, +zone.dataset.top + slot * SLOT_MIN));
  }
  return t;
}
// The drop preview: the snapped slot at the card's length with a tag naming crew member and time,
// red with the overlap when the drop would double-book.
function dropPreview(info, zone, clientY) {
  const t = dropTarget(zone, clientY);
  const name = zone.dataset.name || (t.crew ? crewName(t.crew) : "Unassigned");
  const dur = info.dur || 60;
  let overlap = 0;
  if (t.crew && t.time) {
    const a = C.parse_time(t.time), b = a + dur;
    for (const v of B().visits) {
      if (v.id === info.id || v.status === "cancelled" || v.date !== t.date || !v.start_time || !v.crew_ids.includes(t.crew)) continue;
      const x = C.parse_time(v.start_time), y = x + v.duration_min;
      overlap = Math.max(overlap, Math.min(b, y) - Math.max(a, x));
    }
  }
  const text = t.time === undefined ? name : t.time === "" ? name + ", Any time" : overlap > 0 ? `${name.split(" ")[0]}, ${overlap} min overlap` : `${name}, ${range({ start_time: t.time, duration_min: dur })}`;
  const lbl = el("span", { cls: "drop-lbl" }, [overlap > 0 ? glyph("double") : null, text]);
  if (zone.classList.contains("cb")) {
    const y = ((C.parse_time(t.time) - +zone.dataset.top) / SLOT_MIN) * SLOT_PX;
    const p = el("div", { cls: "drop-ok" + (overlap > 0 ? " drop-warn" : ""), style: `top:${y}px;height:${Math.max(MIN_CARD, (dur / SLOT_MIN) * SLOT_PX - 2)}px` }, lbl);
    zone.append(p);
    return p;
  }
  const p = el("div", { cls: "drop-ok drop-band" }, lbl);
  zone.append(p);
  return p;
}
async function dropOn(info, zone, clientY) {
  const t = dropTarget(zone, clientY);
  try {
    if (info.kind === "job") {
      await act((tx) => STEP(tx, "schedule_visit", [info.id, t.date, t.time || "", null, t.crew ? [t.crew] : []]));
      toast("Visit scheduled.");
      return;
    }
    const v = byId("visits", info.id);
    let crew = v.crew_ids.slice();
    if (t.crew !== undefined && t.crew !== info.from) {
      crew = crew.filter((c) => c !== info.from);
      if (t.crew && !crew.includes(t.crew)) crew.push(t.crew);
    }
    const time = t.time === undefined ? v.start_time : t.time;
    await act((tx) => STEP(tx, "move_visit", [v.id, t.date || v.date, time, crew]));
    toast(`Moved to ${crew.map(crewName).join(", ") || "Unassigned"}, ${shortDate(t.date || v.date)} ${time ? timeText(time) : "any time"}.`);
  } catch (e) { showError(e); }
}
// Run a workflow step inside the current transaction.
function STEP(tx, name, args) { return C.STEPS[name](tx, ...args); }

function weekBoard(main, date, banner) {
  const ws = C.week_start(date);
  const days = [0, 1, 2, 3, 4, 5, 6].map((i) => C.add_days(ws, i));
  const rows = [{ id: "", name: "Unassigned" }].concat(crewList());
  const inWeek = B().visits.filter((v) => v.date >= days[0] && v.date <= days[6] && v.status !== "cancelled");
  let booked = 0, avail = 0;
  for (const m of crewList()) { avail += m.weekly_minutes; booked += inWeek.filter((v) => v.crew_ids.includes(m.id)).reduce((a, v) => a + v.duration_min, 0); }
  const pct = avail ? C.pct_text(C.mul_div(booked, 10000, avail)) : "0.00%";
  main.append(keyrow(plate("Crew hours booked", pct.replace(/\.00%$/, "%"), `${HOURS(booked)} of ${HOURS(avail)} hours this week`), "Booked visit time against each crew member's weekly hours."));
  if (banner) main.append(banner);
  const t = el("table", { cls: "wk" });
  t.append(el("thead", null, el("tr", null, [el("th", { scope: "col", cls: "crew", text: "Crew" })].concat(days.map((d) => el("th", { scope: "col", cls: d === T() ? "today" : "" }, [
    el("a", { href: "#schedule", cls: "daylink", text: C.DAY_ABBR[C.weekday(d) - 1] + " " + (+d.slice(8)), on: { click: (e) => { e.preventDefault(); setUi("sched_view", "day"); setUi("sched_date", d); render(); } } }),
    el("small", { text: `${inWeek.filter((v) => v.date === d).length} visits` })]))))));
  const tb = el("tbody");
  for (const r of rows) {
    const tr = el("tr", null, el("th", { scope: "row", cls: "crew", text: r.name }));
    for (const d of days) {
      const cell = el("td", { cls: "drop" + (d === T() ? " today" : ""), "data-date": d, "data-crew": r.id, "data-name": r.name });
      for (const v of sortVisits(inWeek.filter((v) => v.date === d && (r.id ? v.crew_ids.includes(r.id) : !v.crew_ids.length)))) cell.append(tcard(v, { from: r.id }));
      tr.append(cell);
    }
    tb.append(tr);
  }
  t.append(tb);
  main.append(el("div", { cls: "wk-wrap" }, t));
}
function monthBoard(main, date) {
  const first = date.slice(0, 8) + "01";
  const last = C.month_end(date);
  const g = el("div", { cls: "mo" });
  for (const d of C.DAY_ABBR) g.append(el("div", { cls: "dh", text: d }));
  let d = C.week_start(first);
  const end = C.add_days(C.week_start(last), 6);
  while (d <= end) {
    const vs = B().visits.filter((v) => v.date === d && v.status !== "cancelled");
    const dd = d;
    const bars = el("span", { cls: "bars", "aria-hidden": "true" });
    for (const v of sortVisits(vs).slice(0, 4)) bars.append(el("i", { cls: "s-" + stateOf(visitState(v))[0] }));
    g.append(el("a", { cls: "d" + (d.slice(0, 7) !== date.slice(0, 7) ? " other" : "") + (d === T() ? " today" : ""), href: "#schedule", "aria-label": dateText(d) + `, ${vs.length} visits`,
      on: { click: (e) => { e.preventDefault(); setUi("sched_view", "day"); setUi("sched_date", dd); render(); } } },
    [el("span", { cls: "dn", text: String(+d.slice(8)) }), el("span", { cls: "cnt2", text: vs.length ? `${vs.length} visit${vs.length === 1 ? "" : "s"}` : "" }), bars]));
    d = C.add_days(d, 1);
  }
  main.append(g);
}

function routeBoard(main, date) {
  const s = B().settings;
  const routes = crewList().map((m) => [m, C.suggest_route(B(), m.id, date)]).filter(([, r]) => r.current_order.length);
  const saved = routes.reduce((a, [, r]) => a + Math.max(0, r.saved_m), 0);
  main.append(keyrow(plate("Straight-line distance saved", (saved / 1000).toFixed(1) + " km", `${routes.length} crew day${routes.length === 1 ? "" : "s"}, ${dateText(date)}`),
    "Each crew member's stops in nearest-neighbour order from the shop. Straight lines between the coordinates you entered, not roads."));
  if (s.home_lat_e6 === null) main.append(notice("Add the shop's coordinates in Settings to start each route from home base."));
  if (!routes.length) main.append(emptyState("No stops on this day", "Pick a day with visits. Everything stays on this device.", [btn("Today", () => { setUi("sched_date", T()); render(); })]));
  const ord = (n) => n + (n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th");
  for (const [m, r] of routes) {
    const stops = el("ol", { cls: "stops" });
    r.order.forEach((vid, i) => {
      const v = byId("visits", vid);
      const p = propOf(jobOf(v));
      const was = r.current_order.indexOf(vid) + 1;
      const li = el("li", { tabindex: 0, role: "button", on: { click: () => openVisit(vid) } }, [el("span", { cls: "stops-n" }, el("span", { cls: "no", text: String(i + 1) })),
        el("span", null, [el("b", { text: clientName(jobOf(v).client_id) }), el("span", { cls: "sub", text: (p ? C.address_line(p) : "(no address)") + ", booked " + (v.start_time ? timeText(v.start_time) : "any time") + (i < r.legs_m.length ? ", leg " + (r.legs_m[i] / 1000).toFixed(1) + " km" : "") })]),
        el("span", { cls: "was", text: was === i + 1 ? "now " + ord(was) : "was " + ord(was) })]);
      stops.append(li);
    });
    const acts = r.saved_m > 0 ? [btn("Apply this order", () => applyRouteUi(m.id, date, r.order, false), "primary", { id: "route-apply-" + m.id }), btn("Apply with times 15 min apart", () => applyRouteUi(m.id, date, r.order, true), "", { id: "route-retime-" + m.id })] : [];
    const note = r.saved_m > 0 ? `Suggested order: ${(r.distance_m / 1000).toFixed(1)} km instead of ${(r.current_m / 1000).toFixed(1)} km, ${(r.saved_m / 1000).toFixed(1)} km shorter.`
      : `The current order is already the shortest found (${(r.distance_m / 1000).toFixed(1)} km).`;
    main.append(card(m.name, el("div", { cls: "route" }, [el("div", null, [stops, el("div", { cls: "saved" }, acts), notice(note, "route")]), routeSketch(r, home(s))]), null, "route-card"));
  }
}
function home(s) { return s.home_lat_e6 !== null && s.home_lon_e6 !== null ? [s.home_lat_e6, s.home_lon_e6] : null; }
async function applyRouteUi(crewId, date, order, retime) {
  try {
    const before = B();
    const tx = new C.Tx(before);
    C.apply_route(tx, crewId, date, order, retime, 15);
    const entry = { id: tx.newId("a"), at: nowStamp(), rule: "route_order", why: `${crewName(crewId)}'s visits on ${date} were put in the suggested order` + (retime ? " with new start times, 15 minutes apart for the drive." : "."), keys: [], changes: tx.changes, undone: false };
    tx.book.log = before.log.concat([entry]);
    await setBook(C.validate_book(tx.book), "Route applied. Undo it from Automations.");
  } catch (e) { showError(e); }
}
// A plain sketch of the stops on their coordinates: no map tiles, no network.
function routeSketch(r, homePt) {
  const pt = (vid) => { const v = byId("visits", vid); const p = propOf(jobOf(v)); return p && p.lat_e6 !== null ? [p.lat_e6, p.lon_e6] : null; };
  const pts = r.order.map(pt).filter((x) => x);
  if (pts.length < 2) return el("p", { cls: "muted", text: "Add coordinates to the properties to see the sketch." });
  const all = pts.concat(homePt ? [homePt] : []);
  const la0 = Math.min(...all.map((p) => p[0])), la1 = Math.max(...all.map((p) => p[0])), lo0 = Math.min(...all.map((p) => p[1])), lo1 = Math.max(...all.map((p) => p[1]));
  const W = 480, H = 300, P = 26;
  const sx = (lo) => P + ((lo - lo0) / Math.max(1, lo1 - lo0)) * (W - 2 * P);
  const sy = (la) => H - P - ((la - la0) / Math.max(1, la1 - la0)) * (H - 2 * P);
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("class", "sketch");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Sketch of the stops: suggested order solid, current order dashed");
  const N = (tag, a) => { const n = document.createElementNS(SVGNS, tag); for (const k of Object.keys(a)) n.setAttribute(k, a[k]); svg.append(n); return n; };
  const line = (seq, a) => N("polyline", Object.assign({ points: seq.map((p) => sx(p[1]).toFixed(1) + "," + sy(p[0]).toFixed(1)).join(" "), fill: "none" }, a));
  const cur = r.current_order.map(pt).filter((x) => x);
  line((homePt ? [homePt] : []).concat(cur), { stroke: "var(--chart-3)", "stroke-width": 2, "stroke-dasharray": "6 5" });
  line((homePt ? [homePt] : []).concat(pts), { stroke: "var(--accent)", "stroke-width": 3 });
  if (homePt) N("rect", { x: sx(homePt[1]) - 8, y: sy(homePt[0]) - 8, width: 16, height: 16, fill: "var(--mark)", stroke: "var(--mark-ink)", "stroke-width": 2 });
  pts.forEach((p, i) => {
    N("circle", { cx: sx(p[1]), cy: sy(p[0]), r: 12, fill: "var(--accent)" });
    const t = N("text", { x: sx(p[1]), y: sy(p[0]) + 5, "text-anchor": "middle", fill: "var(--accent-ink)", style: "font:800 14px var(--display)" });
    t.textContent = String(i + 1);
  });
  return el("div", null, [svg, el("p", { cls: "lg" }, [el("span", null, [el("i", { style: "background:var(--accent)" }), "Suggested order"]), el("span", null, [el("i", { style: "background:var(--chart-3)" }), "Current order (dashed)"]),
    homePt ? el("span", null, [el("i", { style: "background:var(--mark);outline:2px solid var(--mark-ink)" }), "Shop"]) : null])]);
}

function newVisitDialog(date, jobId) {
  const jobs = B().jobs.filter((j) => j.status === "active");
  if (!jobs.length) { toast("Create a job first."); return; }
  const js = sel(jobs.map((j) => [j.id, `${j.number} ${clientName(j.client_id)}: ${j.title}`]), jobId || jobs[0].id, { id: "nv-job" });
  const d = inp("date", date, { id: "nv-date" });
  const t = inp("time", "08:00", { id: "nv-time" });
  const dur = inp("number", 60, { id: "nv-dur", min: 0, max: 1440, step: 15 });
  const crewBox = crewChecks([], "nv-crew");
  openDialog({ title: "New visit", body: el("div", { cls: "form" }, [field("Job", js), field("Date", d), field("Start time (blank for any time)", t), field("Length, minutes", dur), crewBox.node]),
    actions: [{ label: "Cancel" }, { label: "Schedule", primary: true, onClick: async () => {
      await act((tx) => STEP(tx, "schedule_visit", [js.value, d.value, t.value, intOf(dur.value, "Length"), crewBox.value()]));
      toast("Visit scheduled.");
    } }] });
}
function crewChecks(selected, idp) {
  const boxes = crewList().map((m) => [m.id, chk(selected.includes(m.id), { id: idp + "-" + m.id })]);
  const node = el("fieldset", { cls: "crew-pick" }, [el("legend", { text: "Crew" })].concat(boxes.map(([id, c]) => field(crewName(id), c))));
  return { node, value: () => boxes.filter(([, c]) => c.checked).map(([id]) => id) };
}
function intOf(s, label) {
  const t = String(s).trim();
  if (t === "") return 0;
  if (!/^[0-9]{1,9}$/.test(t)) throw new C.ServiceError("bad_field", `${label}: must be a whole number.`);
  return +t;
}
