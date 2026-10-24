// ---- schema (src/fieldservice/schema.py): field tables, validation, references, backup.

const KINDS = ["clients", "properties", "crew", "items", "requests", "quotes", "jobs", "visits", "timesheets",
  "expenses", "photos", "invoices", "payments", "reminders"];
const MAX_RECORDS = 100000;
const MAX_BACKUP_CHARS = 64 * 1024 * 1024;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const COORD = { lat: 90000000, lon: 180000000 };

const F = {
  S: (n, req = false) => ({ t: "str", max: n, req }),
  T: (n) => ({ t: "text", max: n }),
  I: (lo, hi, d = 0) => ({ t: "int", lo, hi, d }),
  M: (lo = 0, hi = MAX_CENTS) => ({ t: "cents", lo, hi }),
  E: (...v) => ({ t: "enum", v }),
  B: (d = false) => ({ t: "bool", d }),
  D: (opt = false) => ({ t: "date", opt }),
  TM: () => ({ t: "time" }),
  ST: () => ({ t: "stamp" }),
  R: (k, opt = false) => ({ t: "ref", k, opt }),
  RS: (k, max = 20) => ({ t: "refs", k, max }),
  L: (of, max) => ({ t: "list", of, max }),
};
const ID = { t: "id" };
const LINE_KINDS = ["service", "material", "other"];
const DISC = () => ({ discount_kind: F.E("pct", "amt"), discount_value: F.I(0, MAX_CENTS), tax_rate_milli: F.I(0, 100000),
  tax_mode: F.E("document", "line") });

const FIELD_TABLES = {
  settings: {
    business_name: F.S(200), address: F.T(500), phone: F.S(50), email: F.S(200), website: F.S(200),
    license: F.S(100), home_lat_e6: { t: "coord", axis: "lat" }, home_lon_e6: { t: "coord", axis: "lon" },
    tax_rate_milli: F.I(0, 100000), tax_mode: F.E("document", "line"), terms_days: F.I(0, 365, 30),
    quote_valid_days: F.I(0, 365, 30), quote_followup_days: F.I(0, 90, 3), visit_reminder_days: F.I(0, 14, 1),
    overdue_steps: { t: "ints", lo: 1, hi: 365, max: 6, d: [1, 7, 14, 30] },
    visit_horizon_days: F.I(7, 400, 60), quote_prefix: F.S(10), job_prefix: F.S(10), invoice_prefix: F.S(10),
    next_quote: F.I(1, 999999999, 1), next_job: F.I(1, 999999999, 1), next_invoice: F.I(1, 999999999, 1),
    payment_links: F.L("link", 8), auto_quote_to_job: F.B(true), auto_generate_visits: F.B(true),
    auto_draft_invoices: F.B(true), auto_timesheets: F.B(true), auto_reminders: F.B(true),
    day_start: F.TM(), day_end: F.TM(), quote_message: F.T(2000), invoice_message: F.T(2000),
  },
  link: { kind: F.E("stripe", "square", "paypal", "venmo", "cashapp", "zelle", "ach", "other"), label: F.S(60), value: F.S(300, true) },
  line: { id: ID, item_id: F.R("items", true), name: F.S(200, true), description: F.T(1000), kind: F.E(...LINE_KINDS),
    qty_milli: F.I(0, 1000000000, 1000), rate: F.M(), cost: F.M(), taxable: F.B(), optional: F.B(), selected: F.B(true) },
  check: { id: ID, text: F.S(200, true), done: F.B(), note: F.S(500) },
  rule: { freq: F.E("weekly", "monthly", "daily"), interval: F.I(1, 366, 1), days: { t: "ints", lo: 1, hi: 7, max: 7, d: [] },
    month_mode: F.E("day", "nth"), month_day: F.I(-1, 31, 1), nth: F.I(-1, 4, 1), weekday: F.I(1, 7, 1),
    exceptions: { t: "dates", max: 500 } },
  clients: { id: ID, name: F.S(200, true), company: F.S(200), email: F.S(200), phone: F.S(50), billing_address: F.T(500),
    prefer: F.E("email", "text"), tags: F.S(200), notes: F.T(2000), created: F.D(true), archived: F.B() },
  properties: { id: ID, client_id: F.R("clients"), label: F.S(100), street: F.S(200), city: F.S(100), state: F.S(50),
    zip: F.S(20), lat_e6: { t: "coord", axis: "lat" }, lon_e6: { t: "coord", axis: "lon" }, access_notes: F.T(2000) },
  crew: { id: ID, name: F.S(200, true), role: F.S(60), phone: F.S(50), email: F.S(200), cost_rate: F.M(0, 10000000),
    bill_rate: F.M(0, 10000000), weekly_minutes: F.I(0, 10080, 2400), active: F.B(true) },
  items: { id: ID, name: F.S(200, true), description: F.T(1000), kind: F.E(...LINE_KINDS), unit: F.S(20), rate: F.M(),
    cost: F.M(), taxable: F.B(), archived: F.B() },
  requests: { id: ID, client_id: F.R("clients"), property_id: F.R("properties", true), date: F.D(), title: F.S(200, true),
    details: F.T(4000), source: F.S(60), status: F.E("new", "assessment", "converted", "archived"),
    assessment_date: F.D(true), assessment_time: F.TM(), assessment_crew_ids: F.RS("crew"), quote_id: F.R("quotes", true),
    job_id: F.R("jobs", true) },
  quotes: Object.assign({ id: ID, number: F.S(30), client_id: F.R("clients"), property_id: F.R("properties", true),
    request_id: F.R("requests", true), date: F.D(), valid_until: F.D(true), title: F.S(200),
    status: F.E("draft", "sent", "changes_requested", "approved", "converted", "archived"), lines: F.L("line", 200),
    deposit: F.M(), message: F.T(2000), notes: F.T(2000), sent_date: F.D(true), approved_date: F.D(true),
    approved_by: F.S(200), change_request: F.T(2000), job_id: F.R("jobs", true) }, DISC()),
  jobs: Object.assign({ id: ID, number: F.S(30), client_id: F.R("clients"), property_id: F.R("properties", true),
    quote_id: F.R("quotes", true), title: F.S(200, true), instructions: F.T(4000), kind: F.E("one_off", "recurring"),
    rule: { t: "obj", of: "rule" }, start_date: F.D(true), end_date: F.D(true), visit_limit: F.I(0, 1000),
    start_time: F.TM(), duration_min: F.I(0, 1440, 60), crew_ids: F.RS("crew"), lines: F.L("line", 200),
    billing: F.E("per_visit", "fixed"), invoice_timing: F.E("on_completion", "after_visit", "monthly"),
    checklist: F.L("check", 100), status: F.E("active", "closed", "archived"), closed_date: F.D(true), notes: F.T(2000) }, DISC()),
  visits: { id: ID, job_id: F.R("jobs"), date: F.D(), start_time: F.TM(), duration_min: F.I(0, 1440, 60),
    crew_ids: F.RS("crew"), status: F.E("scheduled", "in_progress", "completed", "cancelled"), occurrence: F.D(true),
    started_at: F.ST(), finished_at: F.ST(), checklist: F.L("check", 100), notes: F.T(4000),
    invoice_id: F.R("invoices", true), route_seq: F.I(0, 999) },
  timesheets: { id: ID, crew_id: F.R("crew"), date: F.D(), start_time: F.TM(), minutes: F.I(0, 1440),
    kind: F.E("job", "travel", "shop", "other"), job_id: F.R("jobs", true), visit_id: F.R("visits", true),
    source: F.E("manual", "visit", "packet"), note: F.S(500), approved: F.B() },
  expenses: { id: ID, job_id: F.R("jobs"), visit_id: F.R("visits", true), date: F.D(), description: F.S(200, true),
    kind: F.E("material", "equipment", "subcontract", "permit", "other"), vendor: F.S(200),
    qty_milli: F.I(0, 1000000000, 1000), unit_cost: F.M() },
  photos: { id: ID, job_id: F.R("jobs"), visit_id: F.R("visits", true), crew_id: F.R("crew", true), name: F.S(200, true),
    mime: F.E("image/jpeg", "image/png", "image/webp", "image/heic"), size: F.I(0, 25 * 1024 * 1024), taken_at: F.ST(),
    caption: F.S(500) },
  invoices: Object.assign({ id: ID, number: F.S(30), client_id: F.R("clients"), property_id: F.R("properties", true),
    job_id: F.R("jobs", true), visit_ids: F.RS("visits", 400), date: F.D(), due_date: F.D(), subject: F.S(200),
    status: F.E("draft", "sent", "void"), lines: F.L("line", 400), message: F.T(2000), sent_date: F.D(true),
    period: F.S(7) }, DISC()),
  payments: { id: ID, client_id: F.R("clients"), invoice_id: F.R("invoices", true), quote_id: F.R("quotes", true),
    date: F.D(), amount: F.M(1), method: F.E("card", "cash", "check", "ach", "link", "other"), reference: F.S(100),
    note: F.S(500) },
  reminders: { id: ID, kind: F.E("visit", "invoice_overdue", "quote_followup", "custom"), ref_id: F.S(40),
    step: F.I(0, 365), due_date: F.D(), channel: F.E("email", "text"), to: F.S(200), subject: F.S(200),
    body: F.T(4000), status: F.E("queued", "sent", "dismissed"), created: F.D(), why: F.S(300) },
  log: { id: ID, at: F.ST(), rule: F.S(40, true), why: F.S(500), keys: { t: "strs", len: 120, max: 5000 },
    changes: { t: "changes" }, undone: F.B() },
};

const LABELS = { clients: "client", properties: "property", crew: "crew member", items: "product or service",
  requests: "request", quotes: "quote", jobs: "job", visits: "visit", timesheets: "time entry", expenses: "expense",
  photos: "photo", invoices: "invoice", payments: "payment", reminders: "reminder" };

function fieldDefault(f) {
  const t = f.t;
  if (["str", "text", "date", "time", "stamp", "ref"].includes(t)) return "";
  if (t === "int" || t === "bool") return f.d;
  if (t === "cents") return f.lo <= 0 ? 0 : f.lo;
  if (t === "enum") return f.v[0];
  if (t === "coord" || t === "obj") return null;
  if (t === "ints") return (f.d || []).slice();
  return [];
}
function intField(v, lo, hi, p, what = "a whole number") {
  if (!isInt(v) || v < lo || v > hi) fail("bad_field", `${p}: must be ${what} from ${lo} to ${hi}.`);
  return v;
}
const numSort = (a, b) => a - b;
function uniqSorted(xs, numeric) {
  const s = [...new Set(xs)];
  return numeric ? s.sort(numSort) : s.sort();
}

function checkField(f, v, p) {
  const t = f.t;
  if (t === "id") {
    if (typeof v !== "string" || !ID_RE.test(v)) fail("bad_field", `${p}: must be an id of 1 to 40 letters, digits, - or _.`);
    return v;
  }
  if (t === "str" || t === "text") {
    const s = cleanText(v, f.max, p, t === "text");
    if (f.req && s === "") fail("bad_field", `${p}: is required.`);
    return s;
  }
  if (t === "int") return intField(v, f.lo, f.hi, p);
  if (t === "cents") return intField(v, f.lo, f.hi, p, "a whole number of cents");
  if (t === "bool") {
    if (typeof v !== "boolean") fail("bad_field", `${p}: must be true or false.`);
    return v;
  }
  if (t === "enum") {
    if (!f.v.includes(v)) fail("bad_field", `${p}: must be one of ${f.v.join(", ")}.`);
    return v;
  }
  if (t === "date") {
    if (v === "" && f.opt) return "";
    parseDate(v, p);
    return v;
  }
  if (t === "time") {
    if (v === "") return "";
    parseTime(v, p);
    return v;
  }
  if (t === "stamp") {
    if (v === "") return "";
    parseStamp(v, p);
    return v;
  }
  if (t === "coord") {
    if (v === null) return null;
    const lim = COORD[f.axis];
    return intField(v, -lim, lim, p, "a whole number of millionths of a degree");
  }
  if (t === "ref") {
    if (v === "" && f.opt) return "";
    if (typeof v !== "string" || !ID_RE.test(v)) fail("bad_field", `${p}: must name a ${LABELS[f.k]}.`);
    return v;
  }
  if (t === "refs") {
    if (!Array.isArray(v) || v.length > f.max) fail("bad_field", `${p}: must be a list of at most ${f.max} ids.`);
    const out = [];
    v.forEach((x, i) => {
      if (typeof x !== "string" || !ID_RE.test(x)) fail("bad_field", `${p}[${i}]: must name a ${LABELS[f.k]}.`);
      if (out.includes(x)) fail("bad_field", `${p}: ${x} is listed twice.`);
      out.push(x);
    });
    return out;
  }
  if (t === "ints") {
    if (!Array.isArray(v) || v.length > f.max) fail("bad_field", `${p}: must be a list of at most ${f.max} numbers.`);
    return uniqSorted(v.map((x, i) => intField(x, f.lo, f.hi, `${p}[${i}]`)), true);
  }
  if (t === "strs") {
    if (!Array.isArray(v) || v.length > f.max) fail("bad_field", `${p}: must be a list of at most ${f.max} entries.`);
    return v.map((x, i) => {
      if (typeof x !== "string") fail("bad_field", `${p}[${i}]: must be text.`);
      return cleanText(x, f.len, `${p}[${i}]`);
    });
  }
  if (t === "dates") {
    if (!Array.isArray(v) || v.length > f.max) fail("bad_field", `${p}: must be a list of at most ${f.max} dates.`);
    v.forEach((x, i) => parseDate(x, `${p}[${i}]`));
    return uniqSorted(v, false);
  }
  if (t === "list") {
    if (!Array.isArray(v) || v.length > f.max) fail("bad_field", `${p}: must be a list of at most ${f.max} entries.`);
    const out = v.map((x, i) => checkRecord(f.of, x, `${p}[${i}]`));
    if (out.length && has(FIELD_TABLES[f.of], "id")) {
      const seen = new Set();
      for (const x of out) {
        if (seen.has(x.id)) fail("bad_field", `${p}: the id ${x.id} is used twice.`);
        seen.add(x.id);
      }
    }
    return out;
  }
  if (t === "obj") {
    if (v === null) return null;
    return checkRecord(f.of, v, p);
  }
  if (t === "changes") return checkChanges(v, p);
  fail("bad_field_type", `${p}: unknown field type ${t}.`);
}

function checkRecord(kind, rec, path) {
  const tbl = FIELD_TABLES[kind];
  if (!isObj(rec)) fail("bad_field", `${path}: must be an object.`);
  for (const k of sortedKeys(rec)) if (!has(tbl, k)) fail("bad_field", `${path}: unknown field ${cpSlice(k, 40)}.`);
  const out = {};
  for (const k of Object.keys(tbl)) {
    const f = tbl[k];
    const v = has(rec, k) ? rec[k] : fieldDefault(f);
    if (f.t === "id" && !has(rec, k)) fail("bad_field", `${path}.${k}: is required.`);
    out[k] = checkField(f, v === undefined ? null : v, `${path}.${k}`);
  }
  semantic(kind, out, path);
  return out;
}

function semantic(kind, r, path) {
  if (kind === "rule") {
    if (r.freq === "weekly" && !r.days.length) fail("bad_rule", `${path}: a weekly schedule needs at least one day of the week.`);
    if (r.month_day === 0) fail("bad_rule", `${path}.month_day: must be 1 to 31, or -1 for the last day.`);
    if (r.nth === 0) fail("bad_rule", `${path}.nth: must be 1 to 4, or -1 for the last one.`);
  } else if (kind === "jobs") {
    if (r.kind === "recurring") {
      if (r.rule === null) fail("bad_job", `${path}: a recurring job needs a schedule.`);
      if (r.start_date === "") fail("bad_job", `${path}: a recurring job needs a start date.`);
    }
    if (r.start_date && r.end_date && r.end_date < r.start_date) fail("bad_job", `${path}: the end date is before the start date.`);
  } else if (kind === "invoices") {
    if (r.due_date < r.date) fail("bad_field", `${path}.due_date: is before the invoice date.`);
  } else if (kind === "visits") {
    if (r.started_at && r.finished_at && parseStamp(r.finished_at) < parseStamp(r.started_at)) fail("bad_field", `${path}.finished_at: is before the start.`);
  }
  if ((kind === "quotes" || kind === "jobs" || kind === "invoices") && r.discount_kind === "pct" && r.discount_value > 10000) {
    fail("bad_field", `${path}.discount_value: a percent discount is at most 100.00 (10000).`);
  }
  if (kind === "quotes" || kind === "jobs" || kind === "invoices") {
    r.lines.forEach((ln, i) => {
      if (mulDiv(ln.qty_milli, ln.rate, 1000) > MAX_CENTS) fail("too_large", `${path}.lines[${i}]: the amount is over $10,000,000.00. Split it into smaller lines.`);
    });
  }
}

function checkChanges(v, p) {
  if (!Array.isArray(v) || v.length > 5000) fail("bad_field", `${p}: must be a list of at most 5000 changes.`);
  return v.map((c, i) => {
    const q = `${p}[${i}]`;
    if (!isObj(c) || sortedKeys(c).join(",") !== "after,before,id,kind") fail("bad_field", `${q}: must have kind, id, before and after.`);
    if (!KINDS.includes(c.kind)) fail("bad_field", `${q}.kind: must be one of ${KINDS.join(", ")}.`);
    checkField(ID, c.id, q + ".id");
    const b = c.before === null ? null : checkRecord(c.kind, c.before, q + ".before");
    const a = c.after === null ? null : checkRecord(c.kind, c.after, q + ".after");
    if (a === null && b === null) fail("bad_field", `${q}: before and after cannot both be empty.`);
    return { kind: c.kind, id: c.id, before: b, after: a };
  });
}

// ---------------------------------------------------------------- the book

const BOOK_KEYS = ["id", "name", "example", "created", "seq", "settings", ...KINDS, "log"];

function blankSettings(name = "") {
  const s = checkRecord("settings", {}, "settings");
  s.business_name = name;
  s.quote_prefix = "Q-";
  s.job_prefix = "J-";
  s.invoice_prefix = "INV-";
  s.day_start = "07:00";
  s.day_end = "17:00";
  return s;
}
function blankBook(bid, name, created) {
  parseDate(created, "created");
  const b = { id: bid, name: cleanText(name, 200, "name"), example: false, created, seq: 1,
    settings: blankSettings(cleanText(name, 200, "name")) };
  for (const k of KINDS) b[k] = [];
  b.log = [];
  return b;
}
function index(book) {
  const out = {};
  for (const k of KINDS) { const m = new Map(); for (const r of book[k]) m.set(r.id, r); out[k] = m; }
  return out;
}
const getOr = (o, k, d) => (has(o, k) ? o[k] : d);

function validateBook(book) {
  if (!isObj(book)) fail("bad_backup", "book: must be an object.");
  for (const k of sortedKeys(book)) if (!BOOK_KEYS.includes(k)) fail("bad_backup", `book: unknown field ${cpSlice(k, 40)}.`);
  const out = {
    id: checkField(ID, getOr(book, "id", null), "book.id"),
    name: cleanText(getOr(book, "name", ""), 200, "book.name"),
    example: checkField(F.B(), getOr(book, "example", false), "book.example"),
    created: checkField(F.D(), getOr(book, "created", ""), "book.created"),
    seq: checkField(F.I(1, 999999999), getOr(book, "seq", 1), "book.seq"),
    settings: checkRecord("settings", getOr(book, "settings", {}), "settings"),
  };
  for (const k of [...KINDS, "log"]) {
    const v = getOr(book, k, []);
    if (!Array.isArray(v) || v.length > MAX_RECORDS) fail("bad_backup", `${k}: must be a list of at most ${MAX_RECORDS} records.`);
    out[k] = v.map((r, i) => checkRecord(k, r, `${k}[${i}]`));
  }
  validateRefs(out);
  return out;
}

function allIds(book) {
  const seen = new Map();
  for (const k of KINDS) {
    for (const r of book[k]) {
      if (seen.has(r.id)) fail("duplicate_id", `${k}: the id ${r.id} is already used by a ${LABELS[seen.get(r.id)]}.`);
      seen.set(r.id, k);
    }
  }
  return seen;
}
function validateRefs(book) {
  allIds(book);
  const ix = index(book);
  const look = (kind, id) => ix[kind].get(id) || null;
  for (const k of KINDS) for (const r of book[k]) checkRecordRefs(look, k, r);
}
function need(look, kind, ref, path) {
  if (ref && !look(kind, ref)) fail("bad_ref", `${path}: there is no ${LABELS[kind]} ${ref}.`);
}
// look(kind, id) returns the record or null.
function checkRecordRefs(look, kind, r) {
  const path = `${kind} ${r.id}`;
  const tbl = FIELD_TABLES[kind];
  for (const k of Object.keys(tbl)) {
    const f = tbl[k];
    if (f.t === "ref") need(look, f.k, r[k], `${path}.${k}`);
    else if (f.t === "refs") for (const x of r[k]) need(look, f.k, x, `${path}.${k}`);
    else if (f.t === "list" && f.of === "line") r[k].forEach((ln, i) => need(look, "items", ln.item_id, `${path}.${k}[${i}].item_id`));
  }
  const pid = has(r, "property_id") ? r.property_id : "";
  if (pid && has(r, "client_id") && look("properties", pid).client_id !== r.client_id) fail("bad_ref", `${path}: property ${pid} belongs to another client.`);
  if (kind === "invoices") {
    if (r.job_id && look("jobs", r.job_id).client_id !== r.client_id) fail("bad_ref", `${path}: job ${r.job_id} belongs to another client.`);
    for (const v of r.visit_ids) if (r.job_id && look("visits", v).job_id !== r.job_id) fail("bad_ref", `${path}: visit ${v} is not on job ${r.job_id}.`);
  }
  if (kind === "payments") {
    if (r.invoice_id && look("invoices", r.invoice_id).client_id !== r.client_id) fail("bad_ref", `${path}: invoice ${r.invoice_id} belongs to another client.`);
    if (r.quote_id && look("quotes", r.quote_id).client_id !== r.client_id) fail("bad_ref", `${path}: quote ${r.quote_id} belongs to another client.`);
  }
  if (kind === "jobs" && r.quote_id && look("quotes", r.quote_id).client_id !== r.client_id) fail("bad_ref", `${path}: quote ${r.quote_id} belongs to another client.`);
  if ((kind === "timesheets" || kind === "expenses" || kind === "photos") && r.visit_id && r.job_id) {
    if (look("visits", r.visit_id).job_id !== r.job_id) fail("bad_ref", `${path}: visit ${r.visit_id} is not on job ${r.job_id}.`);
  }
}
function referrers(kind) {
  const out = [];
  for (const k of KINDS) for (const fname of Object.keys(FIELD_TABLES[k])) {
    const f = FIELD_TABLES[k][fname];
    if ((f.t === "ref" || f.t === "refs") && f.k === kind) out.push([k, fname, f.t === "refs"]);
  }
  return out;
}

// ---------------------------------------------------------------- backup

function exportBackup(book, exportedAt) {
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, app: PRODUCT_NAME, exported_at: exportedAt, book };
}
function parseJson(text) {
  if (typeof text !== "string") fail("bad_file", "The file could not be read as text.");
  if (text.length > MAX_BACKUP_CHARS) fail("too_large", "The file is larger than 64 MB.");
  try { return JSON.parse(text); } catch (e) { fail("bad_json", "The file is not valid JSON."); }
}
function importBackup(obj) {
  if (!isObj(obj) || obj.format !== BACKUP_FORMAT) fail("bad_backup", "This is not a backup file from this program.");
  const v = obj.version;
  if (!isInt(v) || v < 1) fail("bad_backup", "The backup has no valid version number.");
  if (v > BACKUP_VERSION) fail("newer_backup", `This backup was made by a newer version (format ${v}). Update the program first.`);
  for (const k of sortedKeys(obj)) if (!["format", "version", "app", "exported_at", "book"].includes(k)) fail("bad_backup", `backup: unknown field ${cpSlice(k, 40)}.`);
  return validateBook(getOr(obj, "book", null));
}
