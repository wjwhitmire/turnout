// ---- book (src/fieldservice/book.py): Tx, create, update, delete, ids and numbers.

const PREFIX = { clients: "c", properties: "p", crew: "m", items: "i", requests: "r", quotes: "q", jobs: "j", visits: "v",
  timesheets: "t", expenses: "x", photos: "f", invoices: "n", payments: "y", reminders: "w" };

class Tx {
  constructor(book) {
    this.book = Object.assign({}, book);
    this.copied = new Set();
    this.changes = [];
    this._ids = null;
    this._pos = new Map();
    this.look = (k, id) => this.get(k, id);
  }
  ids() {
    if (this._ids === null) {
      this._ids = new Map();
      for (const k of KINDS) for (const r of this.book[k]) this._ids.set(r.id, k);
    }
    return this._ids;
  }
  pos(kind) {
    if (!this._pos.has(kind)) { const m = new Map(); this.book[kind].forEach((r, i) => m.set(r.id, i)); this._pos.set(kind, m); }
    return this._pos.get(kind);
  }
  get(kind, rid) {
    const i = this.pos(kind).get(rid);
    return i === undefined ? null : this.book[kind][i];
  }
  need(kind, rid) {
    const r = this.get(kind, rid);
    if (r === null) fail("not_found", `There is no ${LABELS[kind]} ${rid}.`);
    return r;
  }
  // A private copy of the lists and the change count, for restore().
  snapshot() {
    const b = {};
    for (const k of Object.keys(this.book)) b[k] = Array.isArray(this.book[k]) ? this.book[k].slice() : this.book[k];
    return [b, this.changes.length];
  }
  // Put the Tx back to a snapshot, dropping every change made since.
  restore(snap) {
    const [book, n] = snap;
    this.book = {};
    this.copied = new Set();
    for (const k of Object.keys(book)) {
      this.book[k] = Array.isArray(book[k]) ? book[k].slice() : book[k];
      if (Array.isArray(book[k])) this.copied.add(k);
    }
    this.changes.length = n;
    this._ids = null;
    this._pos = new Map();
  }
  own(kind) {
    if (!this.copied.has(kind)) { this.book[kind] = this.book[kind].slice(); this.copied.add(kind); }
  }
  newId(prefix) {
    const ids = this.ids();
    let n = this.book.seq;
    while (ids.has(`${prefix}${n}`)) n += 1;
    this.book.seq = n + 1;
    return `${prefix}${n}`;
  }
  nextNumber(which) {
    const s = Object.assign({}, this.book.settings);
    const n = s["next_" + which];
    s["next_" + which] = n + 1;
    this.book.settings = s;
    return `${s[which + "_prefix"]}${pad(n, 4)}`;
  }
  setSettings(rec) { this.book.settings = checkRecord("settings", rec, "settings"); }
  create(kind, rec) {
    if (!KINDS.includes(kind)) fail("bad_kind", `Unknown record kind ${show(kind)}.`);
    if (!isObj(rec)) fail("bad_field", `${LABELS[kind]}: must be an object.`);
    rec = Object.assign({}, rec);
    if (!has(rec, "id") || rec.id === "") rec.id = this.newId(PREFIX[kind]);
    const r = checkRecord(kind, rec, LABELS[kind]);
    const ids = this.ids();
    if (ids.has(r.id)) fail("duplicate_id", `The id ${r.id} is already used by a ${LABELS[ids.get(r.id)]}.`);
    checkRecordRefs(this.look, kind, r);
    this.own(kind);
    this.book[kind].push(r);
    ids.set(r.id, kind);
    this.pos(kind).set(r.id, this.book[kind].length - 1);
    this.changes.push({ kind, id: r.id, before: null, after: r });
    return r;
  }
  update(kind, rec) {
    if (!KINDS.includes(kind)) fail("bad_kind", `Unknown record kind ${show(kind)}.`);
    const rid = isObj(rec) && has(rec, "id") ? rec.id : null;
    const i = typeof rid === "string" ? this.pos(kind).get(rid) : undefined;
    if (i === undefined) fail("not_found", `There is no ${LABELS[kind]} ${show(rid)}.`);
    const before = this.book[kind][i];
    const r = checkRecord(kind, rec, LABELS[kind]);
    checkRecordRefs(this.look, kind, r);
    this.own(kind);
    this.book[kind][i] = r;
    this.changes.push({ kind, id: r.id, before, after: r });
    return r;
  }
  patch(kind, rid, fields) { return this.update(kind, Object.assign({}, this.need(kind, rid), fields)); }
  delete(kind, rid, check = true) {
    const r = this.need(kind, rid);
    if (check) {
      for (const [k, fname, many] of referrers(kind)) {
        let n = 0;
        for (const x of this.book[k]) if (many ? x[fname].includes(rid) : x[fname] === rid) n += 1;
        if (n) fail("in_use", `This ${LABELS[kind]} is used by ${n} ${LABELS[k]} record${n !== 1 ? "s" : ""}. Remove or change those first.`);
      }
      for (const k of ["quotes", "jobs", "invoices"]) for (const x of this.book[k]) for (const ln of x.lines) {
        if (kind === "items" && ln.item_id === rid) fail("in_use", `This product or service is on ${LABELS[k]} ${x.number || x.id}. Archive it instead.`);
      }
    }
    this.own(kind);
    const i = this.pos(kind).get(rid);
    this.book[kind].splice(i, 1);
    this._pos.delete(kind);
    this.ids().delete(rid);
    this.changes.push({ kind, id: rid, before: r, after: null });
  }
  put(kind, rec) {
    if (this.get(kind, rec.id) === null) this.create(kind, rec);
    else this.update(kind, rec);
  }
}

function apply(book, op) {
  if (!isObj(op)) fail("bad_op", "The change must be an object.");
  const tx = new Tx(book);
  const a = op.action, kind = op.kind;
  if (!KINDS.includes(kind)) fail("bad_kind", `Unknown record kind ${show(kind)}.`);
  if (a === "create") tx.create(kind, has(op, "record") ? op.record : null);
  else if (a === "update") tx.update(kind, has(op, "record") ? op.record : null);
  else if (a === "delete") {
    const rid = op.id;
    if (typeof rid !== "string" || !ID_RE.test(rid)) fail("bad_op", "delete: needs the record id.");
    tx.delete(kind, rid);
  } else fail("bad_op", "action: must be one of create, update, delete.");
  return tx.book;
}
function applyAll(book, ops) { for (const op of ops) book = apply(book, op); return book; }
function updateSettings(book, fields) {
  if (!isObj(fields)) fail("bad_op", "settings: must be an object.");
  const tx = new Tx(book);
  const s = Object.assign({}, book.settings);
  for (const k of sortedKeys(fields)) {
    if (!has(FIELD_TABLES.settings, k)) fail("bad_field", `settings: unknown field ${cpSlice(k, 40)}.`);
    s[k] = fields[k];
  }
  tx.setSettings(s);
  return tx.book;
}
