// ---------------------------------------------------------------- storage: IndexedDB on this device
// Stores: book (the business file), kv (settings for this screen and the network switches),
// files (photo bytes, kept apart from the book so backups stay small).
const APP = { db: null, book: null, kv: {}, packet: null, route: { page: "home", id: "" }, memo: new Map(), lastAuto: [] };
const DB_NAME = "field-tools-17";
const STORES = ["book", "kv", "files"];

function idbOpen() {
  return new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(DB_NAME, 1); } catch (e) { reject(e); return; }
    req.onupgradeneeded = () => { for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("Another tab is upgrading the data. Close it and reload."));
  });
}
function idb(store, mode, fn) {
  return new Promise((resolve, reject) => {
    if (!APP.db) { resolve(undefined); return; }
    const tx = APP.db.transaction(store, mode);
    const st = tx.objectStore(store);
    let out;
    const r = fn(st);
    if (r && "onsuccess" in r) r.onsuccess = () => { out = r.result; };
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Storage refused the write (the device may be full)."));
  });
}
const dbGet = (store, key) => idb(store, "readonly", (s) => s.get(key));
const dbPut = (store, key, val) => idb(store, "readwrite", (s) => s.put(val, key));
const dbDel = (store, key) => idb(store, "readwrite", (s) => s.delete(key));
const dbClear = (store) => idb(store, "readwrite", (s) => s.clear());
async function kvSet(key, val) { APP.kv[key] = val; await dbPut("kv", key, val); }

async function saveBook() { APP.memo.clear(); await dbPut("book", "current", APP.book); }
const putPhoto = (id, blob) => dbPut("files", "photo:" + id, blob);
const getPhoto = (id) => dbGet("files", "photo:" + id);
const delPhoto = (id) => dbDel("files", "photo:" + id);

function memo(key, fn) { if (!APP.memo.has(key)) APP.memo.set(key, fn()); return APP.memo.get(key); }
function B() { return APP.book; }
function byId(kind, id) { return memo("ix:" + kind, () => new Map(APP.book[kind].map((r) => [r.id, r]))).get(id) || null; }
function clientName(id) { const c = byId("clients", id); return c ? c.name : "(no client)"; }
function crewName(id) { const c = byId("crew", id); return c ? c.name : id; }
function jobOf(v) { return byId("jobs", v.job_id); }
function propOf(rec) { return rec && rec.property_id ? byId("properties", rec.property_id) : null; }
function T() { return APP.kv.today || today(); }

// Run one change: fn(tx) inside a transaction, then the automation rules, then save and redraw.
// Returns fn's result. Errors leave the book as it was.
async function act(fn, opts) {
  const o = opts || {};
  const tx = new C.Tx(APP.book);
  const res = fn(tx);
  let book = tx.book;
  let entries = [];
  if (o.automate !== false) {
    const out = C.run_automations(book, T(), nowStamp());
    book = out[0];
    entries = out[1];
  }
  APP.book = book;
  await saveBook();
  if (entries.length) announceAutomations(entries);
  if (o.render !== false) render();
  return res;
}
async function setBook(book, msg) {
  APP.book = book;
  await saveBook();
  render();
  if (msg) toast(msg);
}
function announceAutomations(entries) {
  APP.lastAuto = entries;
  const first = entries[0];
  const text = entries.length === 1 ? C.RULE_TITLES[first.rule] + ": " + first.why : `${entries.length} automatic steps ran. ${C.RULE_TITLES[first.rule]}: ${first.why}`;
  toast(text, "", [{ label: "Why", onClick: () => whyDialog(entries) }, { label: "Undo", onClick: () => undoBatch(entries) }]);
}
function whyDialog(entries) {
  openDialog({ title: "Why this ran", body: el("ul", { cls: "auto" }, entries.map((e) => el("li", null, el("div", null, [el("div", { cls: "meta" }, [ruleChip(e.rule)]), el("div", { cls: "why" }, [icon("why"), el("span", { text: e.why })])])))),
    actions: [{ label: "Close" }, { label: "Open Automations", primary: true, onClick: () => go("automations") }] });
}
async function undoBatch(entries) {
  let b = B();
  try {
    for (const e of entries.slice().reverse()) b = C.undo_automation(b, e.id)[0];
    await setBook(b, entries.length === 1 ? "Undone. It will not run again for the same item." : `${entries.length} steps undone. They will not run again for the same items.`);
  } catch (e) { showError(e); }
}
