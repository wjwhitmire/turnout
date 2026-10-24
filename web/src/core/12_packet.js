// ---- packet (src/fieldservice/packet.py): job packets out to a crew member and back, with a
// three-way merge and conflict review.

const MERGE_FIELDS = ["status", "started_at", "finished_at", "notes"];
const CREW_STATUSES = ["scheduled", "in_progress", "completed"];
const DATA_URL_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const MAX_PHOTO_CHARS = 4 * 1024 * 1024;
const MAX_PACKET_PHOTOS = 60;
const PROP_KEYS = ["id", "label", "street", "city", "state", "zip", "lat_e6", "lon_e6", "access_notes"];
const pick = (o, keys) => { const r = {}; for (const k of keys) r[k] = o[k]; return r; };

function exportPacket(book, crewId, frm, to, at) {
  const tx = new Tx(book);
  const m = tx.need("crew", crewId);
  if (dayNum(to) < dayNum(frm) || dayNum(to) - dayNum(frm) > 62) fail("bad_range", "A packet covers 1 to 63 days.");
  parseStamp(at, "exported at");
  let vs = book.visits.filter((v) => v.crew_ids.includes(crewId) && frm <= v.date && v.date <= to && (v.status === "scheduled" || v.status === "in_progress"));
  vs = sortBy(vs, (v) => [v.date, v.route_seq ? v.route_seq : 1000, v.start_time || "99:99", v.id]);
  const jobs = new Map();
  for (const v of vs) jobs.set(v.job_id, tx.need("jobs", v.job_id));
  const cl = new Map(), props = new Map();
  for (const j of jobs.values()) {
    const c = tx.need("clients", j.client_id);
    cl.set(c.id, { id: c.id, name: c.name, phone: c.phone });
    if (j.property_id) { const p = tx.need("properties", j.property_id); props.set(p.id, pick(p, PROP_KEYS)); }
  }
  const s = book.settings;
  const pid = cpSlice(`${crewId}-${frm}-${at.slice(0, 19)}`.replace(/[^A-Za-z0-9_-]/g, ""), 80);
  return { format: PACKET_FORMAT, version: PACKET_VERSION, kind: "out", packet_id: pid, book_id: book.id,
    business: { name: s.business_name, phone: s.phone }, crew: { id: m.id, name: m.name }, from: frm, to, exported_at: at,
    returned_at: "", jobs: [...jobs.values()].map((j) => ({ id: j.id, number: j.number, title: j.title, instructions: j.instructions,
      client_id: j.client_id, property_id: j.property_id })), clients: [...cl.values()], properties: [...props.values()],
    base: vs.map((v) => Object.assign({}, v)), visits: vs.map((v) => Object.assign({}, v)), timesheets: [], photos: [] };
}

const PACKET_KEYS = ["format", "version", "kind", "packet_id", "book_id", "business", "crew", "from", "to", "exported_at",
  "returned_at", "jobs", "clients", "properties", "base", "visits", "timesheets", "photos"];
const IDF = { t: "id" };

function readPacket(obj) {
  if (!isObj(obj) || obj.format !== PACKET_FORMAT) fail("bad_packet", "This is not a job packet file.");
  if (!isInt(obj.version) || obj.version < 1 || obj.version > PACKET_VERSION) fail("bad_packet", "This job packet was made by a different version of the program.");
  for (const k of sortedKeys(obj)) if (!PACKET_KEYS.includes(k)) fail("bad_packet", `packet: unknown field ${cpSlice(k, 40)}.`);
  if (obj.kind !== "out" && obj.kind !== "return") fail("bad_packet", "packet.kind: must be out or return.");
  const g = (o, k, d) => (has(o, k) ? o[k] : d);
  const out = { format: PACKET_FORMAT, version: obj.version, kind: obj.kind };
  out.packet_id = checkField({ t: "str", max: 80, req: true }, g(obj, "packet_id", null), "packet.packet_id");
  out.book_id = checkField(IDF, g(obj, "book_id", null), "packet.book_id");
  const b = g(obj, "business", null);
  if (!isObj(b)) fail("bad_packet", "packet.business: must be an object.");
  out.business = { name: cleanText(g(b, "name", ""), 200, "packet.business.name"), phone: cleanText(g(b, "phone", ""), 50, "packet.business.phone") };
  const c = g(obj, "crew", null);
  if (!isObj(c)) fail("bad_packet", "packet.crew: must be an object.");
  out.crew = { id: checkField(IDF, g(c, "id", null), "packet.crew.id"), name: cleanText(g(c, "name", ""), 200, "packet.crew.name") };
  out.from = checkField({ t: "date", opt: false }, g(obj, "from", null), "packet.from");
  out.to = checkField({ t: "date", opt: false }, g(obj, "to", null), "packet.to");
  out.exported_at = checkField({ t: "stamp" }, g(obj, "exported_at", ""), "packet.exported_at");
  out.returned_at = checkField({ t: "stamp" }, g(obj, "returned_at", ""), "packet.returned_at");
  const lst = (k, mx) => {
    const v = g(obj, k, []);
    if (!Array.isArray(v) || v.length > mx) fail("bad_packet", `packet.${k}: must be a list of at most ${mx} entries.`);
    return v;
  };
  out.jobs = lst("jobs", 2000).map((j, i) => {
    const p = `packet.jobs[${i}]`;
    if (!isObj(j)) fail("bad_packet", `${p}: must be an object.`);
    const pidv = g(j, "property_id", "");
    return { id: checkField(IDF, g(j, "id", null), p + ".id"), number: cleanText(g(j, "number", ""), 30, p + ".number"),
      title: cleanText(g(j, "title", ""), 200, p + ".title"), instructions: cleanText(g(j, "instructions", ""), 4000, p + ".instructions", true),
      client_id: checkField(IDF, g(j, "client_id", null), p + ".client_id"),
      property_id: pidv === "" ? pidv : checkField(IDF, pidv, p + ".property_id") };
  });
  out.clients = lst("clients", 2000).map((x, i) => {
    const p = `packet.clients[${i}]`;
    if (!isObj(x)) fail("bad_packet", `${p}: must be an object.`);
    return { id: checkField(IDF, g(x, "id", null), p + ".id"), name: cleanText(g(x, "name", ""), 200, p + ".name"),
      phone: cleanText(g(x, "phone", ""), 50, p + ".phone") };
  });
  out.properties = lst("properties", 2000).map((x, i) => {
    const p = `packet.properties[${i}]`;
    if (!isObj(x)) fail("bad_packet", `${p}: must be an object.`);
    const rec = {};
    for (const k of PROP_KEYS) if (has(x, k)) rec[k] = x[k];
    rec.client_id = "c";
    return pick(checkRecord("properties", rec, p), PROP_KEYS);
  });
  out.base = lst("base", 2000).map((v, i) => checkRecord("visits", v, `packet.base[${i}]`));
  out.visits = lst("visits", 2000).map((v, i) => checkRecord("visits", v, `packet.visits[${i}]`));
  if (out.base.map((v) => v.id).join("\u0000") !== out.visits.map((v) => v.id).join("\u0000") || out.base.length !== out.visits.length) {
    fail("bad_packet", "packet.visits: the visits do not match the ones that were sent out.");
  }
  out.base.forEach((a, i) => {
    const bv = out.visits[i];
    for (const k of Object.keys(FIELD_TABLES.visits)) {
      if (MERGE_FIELDS.includes(k) || k === "checklist") continue;
      if (!deepEqual(a[k], bv[k])) fail("bad_packet", `packet.visits[${i}].${k}: a crew packet cannot change this field.`);
    }
    if (a.checklist.map((x) => x.id).join("\u0000") !== bv.checklist.map((x) => x.id).join("\u0000") || a.checklist.length !== bv.checklist.length) {
      fail("bad_packet", `packet.visits[${i}].checklist: the checklist items do not match.`);
    }
    if (!CREW_STATUSES.includes(bv.status)) fail("bad_packet", `packet.visits[${i}].status: must be one of ${CREW_STATUSES.join(", ")}.`);
  });
  // Everything the crew view shows must be in the packet, and every visit must be the crew member's.
  const jobIds = new Set(out.jobs.map((j) => j.id));
  const clientIds = new Set(out.clients.map((x) => x.id));
  const propIds = new Set(out.properties.map((x) => x.id));
  const visitIds = new Set(out.visits.map((v) => v.id));
  out.jobs.forEach((j, i) => {
    if (!clientIds.has(j.client_id)) fail("bad_packet", `packet.jobs[${i}].client_id: the client is not in the packet.`);
    if (j.property_id && !propIds.has(j.property_id)) fail("bad_packet", `packet.jobs[${i}].property_id: the property is not in the packet.`);
  });
  out.base.forEach((v, i) => {
    if (!jobIds.has(v.job_id)) fail("bad_packet", `packet.visits[${i}].job_id: the job is not in the packet.`);
    if (!v.crew_ids.includes(out.crew.id)) fail("bad_packet", `packet.visits[${i}].crew_ids: the visit is not the packet's crew member's.`);
  });
  out.timesheets = lst("timesheets", 2000).map((t, i) => {
    if (!isObj(t)) fail("bad_packet", `packet.timesheets[${i}]: must be an object.`);
    const r = checkRecord("timesheets", t, `packet.timesheets[${i}]`);
    if (r.crew_id !== out.crew.id) fail("bad_packet", `packet.timesheets[${i}].crew_id: must be the packet's crew member.`);
    if (r.visit_id && !visitIds.has(r.visit_id)) fail("bad_packet", `packet.timesheets[${i}].visit_id: the visit is not in the packet.`);
    if (r.job_id && !jobIds.has(r.job_id)) fail("bad_packet", `packet.timesheets[${i}].job_id: the job is not in the packet.`);
    return r;
  });
  let total = 0;
  out.photos = lst("photos", MAX_PACKET_PHOTOS).map((f, i) => {
    const p = `packet.photos[${i}]`;
    if (!isObj(f)) fail("bad_packet", `${p}: must be an object.`);
    const data = g(f, "data", "");
    const meta = {};
    for (const k of Object.keys(f)) if (k !== "data") meta[k] = f[k];
    const r = checkRecord("photos", meta, p);
    if (!jobIds.has(r.job_id) || (r.visit_id && !visitIds.has(r.visit_id))) fail("bad_packet", `${p}: the photo's job or visit is not in the packet.`);
    if (r.crew_id && r.crew_id !== out.crew.id) fail("bad_packet", `${p}.crew_id: must be the packet's crew member.`);
    if (data !== "") {
      if (typeof data !== "string" || data.length > MAX_PHOTO_CHARS || !DATA_URL_RE.test(data)) fail("bad_packet", `${p}.data: must be a JPEG, PNG or WebP image of at most 3 MB.`);
      if (data.slice(11, data.indexOf(";")) !== r.mime.slice(6)) fail("bad_packet", `${p}.data: the image type does not match the photo's type.`);
      total += data.length;
    }
    r.data = data;
    return r;
  });
  if (total > 48 * 1024 * 1024) fail("bad_packet", "packet.photos: the photos are larger than 48 MB in total.");
  return out;
}

function crewUpdate(packet, visitId, fields) {
  const p = Object.assign({}, packet);
  let found = false;
  p.visits = packet.visits.map((v) => {
    if (v.id !== visitId) return v;
    found = true;
    let nv = Object.assign({}, v);
    for (const k of sortedKeys(fields)) {
      if (!MERGE_FIELDS.includes(k) && k !== "checklist") fail("bad_field", `The crew view cannot change ${cpSlice(k, 40)}.`);
      nv[k] = fields[k];
    }
    nv = checkRecord("visits", nv, "visit");
    if (!CREW_STATUSES.includes(nv.status)) fail("bad_field", `status: must be one of ${CREW_STATUSES.join(", ")}.`);
    return nv;
  });
  if (!found) fail("not_found", `There is no visit ${show(visitId)} in this packet.`);
  return p;
}

function flatVisit(v) {
  const out = {};
  for (const f of MERGE_FIELDS) out[f] = v[f];
  for (const c of v.checklist) { out[`checklist:${c.id}:done`] = c.done; out[`checklist:${c.id}:note`] = c.note; }
  return out;
}
const tsKey = (t) => stableJson([t.crew_id, t.visit_id, t.date, t.start_time, t.minutes, t.kind]);
const photoKey = (f) => stableJson([f.visit_id, f.name, f.size, f.taken_at]);

function mergePreview(book, packet) {
  const pk = readPacket(packet);
  if (pk.kind !== "return") fail("bad_packet", "This packet has not been sent back by the crew yet.");
  if (pk.book_id !== book.id) fail("bad_packet", "This packet belongs to another business file.");
  const cur = new Map(book.visits.map((v) => [v.id, v]));
  const auto = [], conflicts = [], skipped = [];
  pk.base.forEach((b, i) => {
    const c = pk.visits[i];
    const o = cur.get(b.id);
    if (o === undefined) {
      if (!deepEqual(flatVisit(b), flatVisit(c))) skipped.push(`Visit ${b.id} on ${b.date} was deleted in the office; the crew's changes to it were not merged.`);
      return;
    }
    if (!o.crew_ids.includes(pk.crew.id)) {
      if (!deepEqual(flatVisit(b), flatVisit(c))) skipped.push(`Visit ${b.id} on ${b.date} is no longer assigned to ${pk.crew.name}; the crew's changes to it were not merged.`);
      return;
    }
    const fb = flatVisit(b), fo = flatVisit(o), fc = flatVisit(c);
    for (const k of Object.keys(fc)) {
      if (!has(fo, k)) { skipped.push(`Visit ${b.id}: checklist item ${k.split(":")[1]} was removed in the office.`); continue; }
      if (fc[k] === fb[k] || fo[k] === fc[k]) continue;
      if (fo[k] === fb[k]) auto.push({ visit_id: b.id, field: k, value: fc[k] });
      else conflicts.push({ visit_id: b.id, field: k, base: fb[k], office: fo[k], crew: fc[k] });
    }
  });
  const have = new Set(book.timesheets.map(tsKey));
  const crewIds = new Set(book.crew.map((m) => m.id));
  const ts = [];
  for (const t of pk.timesheets) {
    if (!crewIds.has(t.crew_id)) { skipped.push(`A time entry for crew member ${t.crew_id} was skipped: not in this business file.`); continue; }
    if (t.visit_id && !cur.has(t.visit_id)) { skipped.push(`A time entry on ${t.date} was skipped: its visit was deleted in the office.`); continue; }
    if (have.has(tsKey(t))) continue;
    have.add(tsKey(t));
    ts.push(t);
  }
  const ph = [];
  const seen = new Set(book.photos.map(photoKey));
  for (const f of pk.photos) {
    if (f.visit_id && !cur.has(f.visit_id)) { skipped.push(`Photo ${f.name} was skipped: its visit was deleted in the office.`); continue; }
    if (seen.has(photoKey(f))) continue;
    seen.add(photoKey(f));
    const meta = {};
    for (const k of Object.keys(f)) if (k !== "data") meta[k] = f[k];
    ph.push(meta);
  }
  return { auto, conflicts, timesheets: ts, photos: ph, skipped };
}
function setField(v, field, value) {
  if (field.startsWith("checklist:")) {
    const [, cid, part] = field.split(":");
    v.checklist = v.checklist.map((c) => (c.id === cid ? Object.assign({}, c, { [part]: value }) : c));
  } else v[field] = value;
}
function applyPacket(book, packet, resolutions) {
  const pv = mergePreview(book, packet);
  if (!isObj(resolutions)) fail("bad_field", "resolutions: must be an object.");
  const chosen = [];
  for (const c of pv.conflicts) {
    const k = `${c.visit_id}|${c.field}`;
    const r = has(resolutions, k) ? resolutions[k] : null;
    if (r !== "office" && r !== "crew") fail("unresolved", `Choose office or crew for ${c.field} on visit ${c.visit_id}.`);
    if (r === "crew") chosen.push({ visit_id: c.visit_id, field: c.field, value: c.crew });
  }
  const tx = new Tx(book);
  const changes = new Map();
  for (const a of pv.auto.concat(chosen)) {
    const v = changes.get(a.visit_id) || Object.assign({}, tx.need("visits", a.visit_id));
    setField(v, a.field, a.value);
    changes.set(a.visit_id, v);
  }
  for (const vid of [...changes.keys()].sort()) {
    try { tx.update("visits", changes.get(vid)); } catch (e) { if (e instanceof ServiceError) fail(e.code, `Visit ${vid}: ${e.message}`); throw e; }
  }
  for (const t of pv.timesheets) {
    const rec = Object.assign({}, t);
    delete rec.id;
    rec.source = "packet";
    tx.create("timesheets", rec);
  }
  const ids = {};
  for (const f of pv.photos) {
    const rec = Object.assign({}, f);
    const old = rec.id;
    delete rec.id;
    ids[old] = tx.create("photos", rec).id;
  }
  return [tx.book, { applied: pv.auto.length + chosen.length, timesheets: pv.timesheets.length, photos: pv.photos.length, photo_ids: ids, skipped: pv.skipped }];
}
function returnPacket(packet, timesheets, photos, at) {
  return readPacket(Object.assign({}, packet, { kind: "return", returned_at: at, timesheets, photos }));
}
