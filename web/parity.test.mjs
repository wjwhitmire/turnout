// Parity check: load the browser core (web/src/core/*.js, joined in name order) in node:vm and
// replay every case in tests/vectors.json, written by the Python library. Money is integer cents
// and every value is compared exactly: same keys, same numbers, same text, and for refused calls
// the same error code and message. Large results are compared by the SHA-256 of their canonical
// JSON. A case can use an earlier case's result as an argument ({"$prev": index, "path": [...]}),
// so a chain of steps runs on the JavaScript side's own results.
// Usage: python tests/make_vectors.py && node web/parity.test.mjs
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const coreDir = join(here, "src", "core");
const src = readdirSync(coreDir).filter((f) => f.endsWith(".js")).sort().map((f) => readFileSync(join(coreDir, f), "utf8")).join("\n");
if (/\b(fetch|XMLHttpRequest|WebSocket|sendBeacon|document|window|localStorage|indexedDB|eval|importScripts)\b\s*[.(]/.test(src) || /new Function/.test(src)) {
  console.error("FAIL: the core must not touch the network, the DOM, storage or eval");
  process.exit(1);
}
const ctx = vm.createContext({});
vm.runInContext(src + "\n;globalThis.CORE = CORE;", ctx, { filename: "core.js" });
const C = ctx.CORE;
const V = JSON.parse(readFileSync(join(here, "..", "tests", "vectors.json"), "utf8"));

let checks = 0;
const failures = [];
const fail = (msg) => { if (failures.length < 40) failures.push(msg); else failures.length++; };

function compare(got, want, path) {
  checks++;
  if (want === null || typeof want !== "object") {
    if (got !== want) fail(`${path}: got ${JSON.stringify(got)?.slice(0, 200)}, want ${JSON.stringify(want)?.slice(0, 200)}`);
    return;
  }
  if (Array.isArray(want)) {
    if (!Array.isArray(got) || got.length !== want.length) { fail(`${path}: array length got ${got && got.length}, want ${want.length}`); return; }
    want.forEach((w, i) => compare(got[i], w, `${path}[${i}]`));
    return;
  }
  if (got === null || typeof got !== "object" || Array.isArray(got)) { fail(`${path}: got ${JSON.stringify(got)?.slice(0, 80)}, want an object`); return; }
  const gk = Object.keys(got).sort().join(","), wk = Object.keys(want).sort().join(",");
  if (gk !== wk) fail(`${path}: keys differ\n  got  ${gk}\n  want ${wk}`);
  for (const k of Object.keys(want)) compare(got[k], want[k], `${path}.${k}`);
}
const canon = (v) => Array.isArray(v) ? "[" + v.map(canon).join(",") + "]"
  : v !== null && typeof v === "object" ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}"
    : JSON.stringify(v);
const sha = (v) => createHash("sha256").update(canon(v), "utf8").digest("hex");
const plain = (x) => (x === undefined ? null : JSON.parse(JSON.stringify(x)));

const outs = [];
function resolve(x) {
  if (Array.isArray(x)) return x.map(resolve);
  if (x && typeof x === "object") {
    const keys = Object.keys(x);
    if (keys.length === 1 && keys[0] === "$fx") return JSON.parse(JSON.stringify(V.fixtures[x.$fx]));
    if (keys.length === 2 && keys.includes("$prev")) {
      let v = outs[x.$prev];
      for (const k of x.path) v = v[k];
      return JSON.parse(JSON.stringify(v));
    }
    const o = {};
    for (const k of keys) o[k] = resolve(x[k]);
    return o;
  }
  return x;
}
const inRealm = (x) => vm.runInContext("(" + JSON.stringify(x) + ")", ctx);

const counts = {};
V.cases.forEach((c, idx) => {
  counts[c.fn] = (counts[c.fn] || 0) + 1;
  const where = `#${idx} ${c.fn}#${counts[c.fn]}`;
  const fn = C[c.fn];
  outs.push(null);
  if (typeof fn !== "function") { checks++; fail(`${where}: no JS function`); return; }
  let out, err = null;
  try { out = fn(...resolve(c.args).map(inRealm)); } catch (e) { err = e; }
  if ("error" in c) {
    checks++;
    if (!err) fail(`${where}: expected error ${c.error}, got a result`);
    else if (err.code !== c.error || err.message !== c.message) fail(`${where}: got ${err.code} "${err.message}", want ${c.error} "${c.message}"`);
    return;
  }
  if (err) { checks++; fail(`${where}: threw ${err.code || ""} ${err.message}\n${(err.stack || "").split("\n").slice(1, 4).join("\n")}`); return; }
  const got = plain(out);
  outs[idx] = got;
  if ("sha256" in c) { checks++; if (sha(got) !== c.sha256) fail(`${where}: result differs (sha256)`); }
  else compare(got, c.out, where);
  if ("whys" in c) compare(got[1].map((e) => e.why), c.whys, `${where} whys`);
});

// constants that must agree between the two languages
const K = V.constants;
compare(C.PRODUCT_NAME, K.product_name, "PRODUCT_NAME");
compare(C.SUITE_NUMBER, K.suite_number, "SUITE_NUMBER");
compare(C.BACKUP_FORMAT, K.backup_format, "BACKUP_FORMAT");
compare(C.BACKUP_VERSION, K.backup_version, "BACKUP_VERSION");
compare(C.PACKET_FORMAT, K.packet_format, "PACKET_FORMAT");
compare(C.PACKET_VERSION, K.packet_version, "PACKET_VERSION");
compare(plain(C.FIELD_TABLES), K.field_tables, "FIELD_TABLES");
compare(plain(C.KINDS), K.kinds, "KINDS");
compare(plain(C.REPORTS), K.reports, "REPORTS");
compare(plain(C.JOB_STATES), K.job_states, "JOB_STATES");
checks++;
if (sha(plain(C.EXAMPLE_BOOK)) !== K.example_sha256) fail("the example data in 90_example_data.js differs from the Python example");

// JS-only checks
checks++;
if (C.to_csv([[{ $: -1234 }, "=x", 5]]) !== "-12.34,'=x,5\r\n") fail("to_csv money and guard");

if (failures.length) {
  console.error(failures.join("\n"));
  console.error(`FAIL: ${failures.length} of ${checks} checks failed`);
  process.exit(1);
}
console.log(`ok: ${checks} checks over ${V.cases.length} cases`);
