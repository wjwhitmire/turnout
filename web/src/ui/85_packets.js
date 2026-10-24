// ---------------------------------------------------------------- crew packets: out to a phone and back
// No server: the office saves a packet file for one crew member; they open it in this same app on
// their phone (Crew view), work their visits, and send the returned file back. The office merges it
// and decides any field both sides changed.
PAGES.packets = function (main) {
  main.append(pageHead("Crew packets", "Send a crew member their visits as a file, and merge what they send back.", [btn("Merge a returned packet", importReturnedUi, "", { id: "pk-import", icon: "upload" })]));
  if (!B().crew.length) { main.append(emptyState("No crew yet", "Add crew members in Settings, then send each one their visits as a file.", [btn("Open Settings", () => go("settings"), "primary")])); return; }
  const crew = sel(B().crew.filter((m) => m.active).map((m) => [m.id, m.name]), "", { id: "pk-crew" });
  const frm = inp("date", T(), { id: "pk-from" }), to = inp("date", C.add_days(T(), 6), { id: "pk-to" });
  main.append(grid("g2", [
    card("1. Send visits to a crew member", el("div", { cls: "stack" }, [el("p", { cls: "muted", text: "The packet holds the crew member's open visits in the date range, with client names, phone numbers, addresses, access notes, instructions and checklists. It holds no prices." }),
      el("div", { cls: "form" }, [field("Crew member", crew), field("From", frm), field("To", to)]), el("div", { cls: "acts" }, btn("Save a packet", () => exportPacketUi(crew.value, frm.value, to.value), "primary", { id: "pk-save", icon: "download" }))])),
    el("div", { cls: "stack" }, [
      card("2. On the crew member's phone", el("p", { text: "Open this app, choose Crew view, then Open packet. Start and finish each visit, tick the checklist, add notes, photos and travel time, then Send back." }), [btn("Open crew view", () => go("crew"), "", { id: "pk-crewview", icon: "crew" })]),
      card("3. Merge what came back", el("p", { cls: "muted", text: "Fields only the crew changed are taken. Fields only the office changed are kept. When both changed the same field, you choose." }), [btn("Merge", importReturnedUi, "primary", { id: "pk-import-2", icon: "upload" })])])]));
};
async function exportPacketUi(crewId, frm, to) {
  try {
    const pk = C.export_packet(B(), crewId, frm, to, nowStamp());
    if (!pk.visits.length) { toast("No open visits for that crew member in those dates.", "bad"); return; }
    await saveFile(safeName("packet-" + crewName(crewId) + "-" + frm) + ".json", JSON.stringify(pk), "application/json");
  } catch (e) { showError(e); }
}
function importReturnedUi() {
  pickFile(".json,application/json", async (file) => {
    try {
      const raw = C.parse_json(await readFile(file, 64 * 1024 * 1024));
      const pk = C.read_packet(raw);
      if (pk.kind === "out") { toast("This packet has not been worked yet. Open it in Crew view on the crew member's phone.", "bad"); return; }
      mergeDialog(raw, pk, file.name || "packet.json");
    } catch (e) { showError(e); }
  });
}
function mergeDialog(raw, pk, fileName) {
  const pv = C.merge_preview(B(), raw);
  const show = (x) => (typeof x === "boolean" ? (x ? "Done" : "Not done") : x || "(blank)");
  const picks = pv.conflicts.map((c) => {
    const name = "cf-" + c.visit_id + "-" + c.field.replace(/[^A-Za-z0-9]/g, "-");
    const o = el("input", { type: "radio", name, value: "office", id: name + "-o", cls: "sr" });
    const k = el("input", { type: "radio", name, value: "crew", id: name + "-c", cls: "sr" });
    const lo = el("label", { cls: "pick", for: o.id }, [o, el("span", { cls: "radio" }), el("span", null, [el("small", { text: "Office copy" }), show(c.office)])]);
    const lk = el("label", { cls: "pick", for: k.id }, [k, el("span", { cls: "radio" }), el("span", null, [el("small", { text: "Crew copy" }), show(c.crew)])]);
    const sync = () => { lo.classList.toggle("on", o.checked); lk.classList.toggle("on", k.checked); };
    o.addEventListener("change", sync); k.addEventListener("change", sync);
    const v = byId("visits", c.visit_id);
    const what = c.field.startsWith("checklist:") ? "Checklist: " + ((v.checklist.find((x) => c.field.includes(":" + x.id + ":")) || {}).text || "item") : { notes: "Visit notes", status: "Status", started_at: "Started", finished_at: "Finished" }[c.field] || c.field;
    return [c, o, k, el("div", { cls: "mrow", role: "radiogroup", "aria-label": what }, [el("div", null, [el("span", { cls: "f", text: what }), el("span", { cls: "sub", text: clientName(jobOf(v).client_id) + ", " + shortDate(v.date) + (v.start_time ? ", " + timeText(v.start_time) : "") })]), lo, lk])];
  });
  const nothing = !pv.auto.length && !pv.timesheets.length && !pv.photos.length && !pv.conflicts.length;
  const body = el("div", { cls: "stack" }, [el("p", null, [el("span", { cls: "mono", text: fileName }), ` from ${pk.crew.name}, returned ${shortDate(pk.returned_at.slice(0, 10))}, ${timeText(pk.returned_at.slice(11, 16))}.`]),
    keyrow(plate("Choices needed", String(pv.conflicts.length), `${pv.auto.length} changes, ${pv.timesheets.length} time entries and ${pv.photos.length} photos merge on their own`)),
    nothing ? notice("This file was already merged, or holds no changes. Merging it again changes nothing.", "info") : null,
    pv.skipped.length ? el("div", { cls: "banner" }, [glyph("alert"), el("div", null, pv.skipped.map((s) => el("div", { text: s })))]) : null,
    picks.length ? el("div", { cls: "merge" }, picks.map((p) => p[3])) : null]);
  openDialog({ title: "Merge returned packet", wide: true, body, noFocus: true, actions: [{ label: "Cancel" }, { label: "Merge", primary: true, icon: "check", onClick: async () => {
    const res = {};
    for (const [c, o, k] of picks) {
      if (!o.checked && !k.checked) throw new C.ServiceError("unresolved", "Choose the office copy or the crew copy for every field changed on both sides.");
      res[c.visit_id + "|" + c.field] = o.checked ? "office" : "crew";
    }
    const [book, out] = C.apply_packet(B(), raw, res);
    for (const f of pk.photos) {
      const nid = out.photo_ids[f.id];
      if (nid && f.data) await putPhoto(nid, dataUrlBlob(f.data));
    }
    APP.book = book;
    await act(() => null);
    toast(`Merged: ${out.applied} changes, ${out.timesheets} time entries, ${out.photos} photos.`);
  } }] });
}
function dataUrlBlob(d) {
  const i = d.indexOf(",");
  const mime = d.slice(5, d.indexOf(";"));
  const bin = atob(d.slice(i + 1));
  const a = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) a[k] = bin.charCodeAt(k);
  return new Blob([a], { type: mime });
}

// ---------------------------------------------------------------- crew view (on the crew member's phone)
let CREW_OPEN = "";
const ORD = ["1st", "2nd", "3rd"];
PAGES.crew = function (main) {
  const pk = APP.packet;
  const top = el("div", { cls: "crew-top" }, [markSvg(), el("div", { style: "flex:1;min-width:0" }, [el("b", { text: pk ? pk.crew.name : "Crew view" }), el("span", { text: pk ? `${shortDate(pk.from)} to ${shortDate(pk.to)} / ${pk.business.name}` : "Open the packet file the office sent you" })]),
    btn("Open packet", openPacketUi, pk ? "" : "primary", { id: "crew-open", icon: "upload" })]);
  const wrap = el("div", { cls: "crew" }, top);
  main.append(wrap);
  if (!pk) {
    wrap.append(el("div", { cls: "crew-b" }, emptyState("No packet open", "Ask the office for your packet file, then open it here. Your work stays on this phone until you send it back.", [btn("Open packet", openPacketUi, "primary", { icon: "upload" })])));
    return;
  }
  const jobs = new Map(pk.jobs.map((j) => [j.id, j]));
  const clients = new Map(pk.clients.map((c) => [c.id, c]));
  const props = new Map(pk.properties.map((p) => [p.id, p]));
  const vs = sortVisits(pk.visits);
  const open = vs.filter((v) => v.status !== "completed");
  const cur = vs.find((v) => v.id === CREW_OPEN) || open[0] || null;
  const next = open.find((v) => v !== cur && (v.date > T() || v.date === T())) || null;
  const body = el("div", { cls: "crew-b" });
  wrap.append(body);
  const nv = cur && cur.status === "scheduled" ? cur : next;
  if (nv) {
    const j = jobs.get(nv.job_id), p = props.get(j.property_id);
    body.append(plate("Next stop", nv.start_time ? timeText(nv.start_time) : "Any time", (nv.date === T() ? "" : shortDate(nv.date) + ", ") + clientName2(clients, j) + (p ? ", " + p.street : "")));
  } else body.append(plate("Next stop", "Done", open.length ? "Open the stop below" : "Every visit is finished. Send back."));
  let day = "";
  vs.forEach((v, i) => {
    if (v.date !== day) { day = v.date; body.append(el("h3", { cls: "sec", text: dateText(v.date) })); }
    const j = jobs.get(v.job_id), c = clients.get(j.client_id), p = props.get(j.property_id) || null;
    const [stc, g] = stateOf(v.status);
    const n = vs.filter((x) => x.date === v.date).indexOf(v) + 1;
    const when = v.start_time ? range(v) : "Any time";
    if (v !== cur) {
      const a = el("button", { type: "button", cls: "tc stop s-" + stc + (v.status === "completed" ? " done" : ""), "aria-label": `Stop ${n}, ${c.name}, ${when}, ${STATUS_TEXT[v.status]}`, on: { click: () => { CREW_OPEN = v.id; render(); } } },
        [el("div", { cls: "tc-h" }, [el("span", { cls: "stopnum", text: String(n) }), glyph(g), el("span", { text: when }), el("span", { cls: "w", text: "Stop " + n })]),
          el("div", { cls: "tc-b" }, [el("span", { cls: "tc-c", text: c.name }), el("span", { cls: "tc-j", text: j.title + (p ? ", " + p.street : "") })])]);
      body.append(a);
      return;
    }
    const items = v.checklist.map((it) => {
      const b = chk(it.done, { id: `cv-${v.id}-${it.id}`, cls: "cbx big" });
      b.addEventListener("change", () => crewEdit(v.id, { checklist: APP.packet.visits.find((x) => x.id === v.id).checklist.map((x) => (x.id === it.id ? Object.assign({}, x, { done: b.checked }) : x)) }));
      return el("li", { cls: it.done ? "on" : "" }, [b, el("label", { cls: "t", for: b.id, text: it.text })]);
    });
    const notes = inp("textarea", v.notes, { id: "cv-notes-" + v.id });
    notes.addEventListener("change", () => crewEdit(v.id, { notes: notes.value }, false));
    const phs = (APP.kv.crewPhotos || []).filter((f) => f.visit_id === v.id);
    const acts = [];
    if (v.status === "scheduled") acts.push(btn("Start", () => crewEdit(v.id, { status: "in_progress", started_at: nowStamp() }), "big primary", { id: "cv-start-" + v.id, icon: "start" }));
    else if (v.started_at) acts.push(btn("Started " + clockText(v.started_at), null, "big", { icon: "start", disabled: true }));
    if (v.status !== "completed") acts.push(btn("Finish", () => crewEdit(v.id, { status: "completed", finished_at: nowStamp(), started_at: v.started_at || nowStamp() }), "big" + (v.status === "in_progress" ? " primary" : ""), { id: "cv-finish-" + v.id, icon: "finish" }));
    else acts.push(btn("Finished " + clockText(v.finished_at), null, "big", { icon: "finish", disabled: true }));
    const addr = p ? C.address_line(p) : "";
    const tel = c.phone ? c.phone.replace(/[^0-9+]/g, "") : "";
    body.append(el("div", { cls: "tc stop s-" + stc, role: "group", "aria-label": `Stop ${n}, ${STATUS_TEXT[v.status]}` }, [
      el("div", { cls: "tc-h" }, [el("span", { cls: "stopnum", text: String(n) }), glyph(g), el("span", { text: when }), el("span", { cls: "w", text: STATUS_TEXT[v.status] })]),
      el("div", { cls: "tc-b" }, [el("span", { cls: "tc-c", text: c.name }), el("span", { cls: "tc-j", text: "Job " + j.number + ": " + j.title }),
        addr ? el("p", { cls: "addr-t", text: addr }) : null,
        el("div", { cls: "addr" }, [addr ? el("a", { cls: "btn big", href: "geo:0,0?q=" + encodeURIComponent(addr), id: "cv-dir-" + v.id }, [icon("pin"), el("span", { text: "Directions" })]) : null,
          tel ? el("a", { cls: "btn big", href: "tel:" + tel, id: "cv-call-" + v.id }, [icon("phone"), el("span", { text: "Call" })]) : null]),
        p && p.access_notes ? el("div", { cls: "acc" }, [el("b", { text: "Access" }), p.access_notes]) : null,
        j.instructions ? el("div", { cls: "acc" }, [el("b", { text: "Instructions" }), j.instructions]) : null,
        el("div", { cls: "bigacts" }, acts),
        items.length ? el("div", null, [el("div", { cls: "card-h" }, [el("h3", { text: "Checklist" }), el("span", { cls: "prog", text: `${v.checklist.filter((x) => x.done).length} of ${v.checklist.length}` })]), el("ul", { cls: "ckl" }, items)]) : null,
        el("div", { style: "margin-top:12px" }, field("Notes", notes)),
        el("div", { cls: "photos", style: "margin-top:12px" }, [...phs.map((f) => el("figure", { cls: "ph-fig" }, el("img", { src: f.data, alt: f.name }))),
          el("button", { type: "button", cls: "ph-tile ph-add", id: "cv-photo-" + v.id, on: { click: () => crewPhoto(v) } }, [icon("camera"), "Add photo"])])])]));
  });
  const ts = APP.kv.crewTime || [];
  if (ts.length) body.append(el("h3", { cls: "sec", text: "Travel and shop time" }), table([{ h: "Date and kind" }, { h: "Hours", n: true }], ts.map((t) => ({ cells: [shortDate(t.date) + ", " + t.kind, HOURS(t.minutes)] }))));
  wrap.append(el("div", { cls: "crew-bar" }, [btn("Add time", crewTimeDialog, "big", { id: "cv-time", icon: "time" }), btn("Send back", sendBackUi, "big primary", { id: "crew-send", icon: "share" })]));
};
function clientName2(clients, j) { const c = clients.get(j.client_id); return c ? c.name : ""; }
async function openPacketUi() {
  pickFile(".json,application/json", async (file) => {
    try {
      const pk = C.read_packet(C.parse_json(await readFile(file, 64 * 1024 * 1024)));
      APP.packet = Object.assign({}, pk, { kind: "out" });
      await kvSet("packet", APP.packet);
      await kvSet("crewTime", pk.timesheets || []);
      await kvSet("crewPhotos", pk.photos || []);
      go("crew");
    } catch (e) { showError(e); }
  });
}
async function crewEdit(vid, fields, redraw) {
  try {
    APP.packet = C.crew_update(APP.packet, vid, fields);
    await kvSet("packet", APP.packet);
    if (redraw !== false) render();
  } catch (e) { showError(e); }
}
function crewTimeDialog() {
  const pk = APP.packet;
  const d = inp("date", T(), { id: "ct-date" }), h = inp("text", "0:30", { id: "ct-hours" }), k = sel([["travel", "Travel"], ["shop", "Shop"], ["other", "Other"]], "travel", { id: "ct-kind" });
  openDialog({ title: "Add time", body: el("div", { cls: "form" }, [field("Date", d), field("Hours (h:mm)", h), field("Kind", k)]), actions: [{ label: "Cancel" }, { label: "Add", primary: true, onClick: async () => {
    const list = (APP.kv.crewTime || []).slice();
    const rec = C.check_record("timesheets", { id: "k" + Date.now().toString(36), crew_id: pk.crew.id, date: d.value, minutes: parseHours(h.value), kind: k.value, source: "packet" }, "Time");
    list.push(rec);
    await kvSet("crewTime", list);
    render();
  } }] });
}
// Photos are shrunk to at most 1600 pixels on the long side before they go in the packet.
function crewPhoto(v) {
  pickFile("image/*", async (file) => {
    try {
      if (file.size > 25 * 1024 * 1024) throw new C.ServiceError("too_large", "The photo is larger than 25 MB.");
      const data = await shrinkImage(file, 1600, 0.8);
      const list = (APP.kv.crewPhotos || []).slice();
      if (list.length >= 60) throw new C.ServiceError("too_many", "A packet holds at most 60 photos.");
      list.push({ id: "ph" + Date.now().toString(36), job_id: v.job_id, visit_id: v.id, crew_id: APP.packet.crew.id, name: (file.name || "photo.jpg").slice(0, 200), mime: "image/jpeg", size: Math.floor(data.length * 3 / 4), taken_at: nowStamp(), caption: "", data });
      await kvSet("crewPhotos", list);
      toast("Photo added to the packet.");
      render();
    } catch (e) { showError(e); }
  });
}
function shrinkImage(file, maxSide, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.naturalWidth * k));
      c.height = Math.max(1, Math.round(img.naturalHeight * k));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      const d = c.toDataURL("image/jpeg", quality);
      if (d.length > 4 * 1024 * 1024) reject(new C.ServiceError("too_large", "The photo is still too large after shrinking."));
      else resolve(d);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new C.ServiceError("bad_file", "That file could not be read as a photo.")); };
    img.src = url;
  });
}
async function sendBackUi() {
  try {
    const out = C.return_packet(APP.packet, APP.kv.crewTime || [], APP.kv.crewPhotos || [], nowStamp());
    const name = safeName("returned-" + out.crew.name + "-" + out.from) + ".json";
    const text = JSON.stringify(out);
    if (navigator.canShare && typeof File === "function") {
      const f = new File([text], name, { type: "application/json" });
      if (navigator.canShare({ files: [f] })) { try { await navigator.share({ files: [f], title: name }); toast("Shared."); return; } catch (e) { if (e && e.name === "AbortError") return; } }
    }
    await saveFile(name, text, "application/json");
  } catch (e) { showError(e); }
}
