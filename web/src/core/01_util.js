// ---- util (src/fieldservice/util.py): errors, integer money math, dates, clock times, stamps,
// text and CSV. Products of money and rates can pass 2**53, so they are computed with BigInt.

const MAX_CENTS = 1000000000;
const SAFE_INT = 9007199254740991;
const MAX_FILE_CHARS = 5 * 1024 * 1024;
const MAX_ROWS = 50000;
const MAX_FIELD_CHARS = 10000;

class ServiceError extends Error {
  constructor(code, message) { super(message); this.code = code; this.name = "ServiceError"; }
}
function fail(code, message) { throw new ServiceError(code, message); }

// ---------------------------------------------------------------- integers

function isInt(x) { return typeof x === "number" && Number.isInteger(x) && x >= -SAFE_INT && x <= SAFE_INT; }
function bigFloorDiv(a, b) {
  let q = a / b;
  if ((a % b !== 0n) && ((a < 0n) !== (b < 0n))) q -= 1n;
  return q;
}
function divRound(n, d) {
  if (d <= 0) fail("bad_divisor", "Divisor must be positive.");
  const a = Math.abs(n) * 2 + d;
  let q;
  if (a <= SAFE_INT) q = Math.floor(a / (2 * d));
  else q = Number((BigInt(Math.abs(n)) * 2n + BigInt(d)) / (2n * BigInt(d)));
  return n >= 0 ? q : -q;
}
function mulDiv(a, b, d) {
  const p = a * b;
  if (Math.abs(p) <= SAFE_INT / 4) return divRound(p, d);
  if (d <= 0) fail("bad_divisor", "Divisor must be positive.");
  const P = BigInt(a) * BigInt(b), D = BigInt(d);
  const neg = P < 0n, A = neg ? -P : P;
  const q = (A * 2n + D) / (2n * D);
  return Number(neg ? -q : q);
}
function sum(xs) { let s = 0; for (const x of xs) s += x; return s; }

function allocate(amount, weights) {
  const n = weights.length;
  const total = sum(weights);
  if (total === 0) {
    if (amount === 0) return new Array(n).fill(0);
    fail("bad_allocation", "Cannot split an amount across lines that add up to zero.");
  }
  if (total < 0) return allocate(-amount, weights.map((w) => -w)).map((x) => -x);
  if (amount < 0) return allocate(-amount, weights).map((x) => -x);
  const A = BigInt(amount), T = BigInt(total);
  const base = [], rem = [];
  for (const w of weights) {
    const p = A * BigInt(w);
    const b = bigFloorDiv(p, T);
    base.push(Number(b));
    rem.push(p - b * T);
  }
  const left = amount - sum(base);
  const order = [...Array(n).keys()].sort((x, y) => (rem[x] > rem[y] ? -1 : rem[x] < rem[y] ? 1 : x - y));
  for (const k of order.slice(0, left)) base[k] += 1;
  return base;
}

// ---------------------------------------------------------------- text

const WS = " \t\n\r\f\v ﻿";
const WS_EDGE = new RegExp("^[" + WS + "]+|[" + WS + "]+$", "g");
const WS_RUN = new RegExp("[" + WS + "]+", "g");
const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function strip(s) { return s.replace(WS_EDGE, ""); }
function squash(s) { return strip(s).replace(WS_RUN, " "); }
function lower(s) { return s.replace(/[A-Z]+/g, (m) => m.toLowerCase()); }
function upper(s) { return s.replace(/[a-z]+/g, (m) => m.toUpperCase()); }
function cpLen(s) { let n = 0; for (const _ of s) n++; return n; } // eslint-disable-line no-unused-vars
function cpSlice(s, n) { return s.length <= n ? s : Array.from(s).slice(0, n).join(""); }
function show(x) { return typeof x === "string" ? cpSlice(x, 40) : "(not text)"; }

function cleanText(s, maxLen, name, multiline = false) {
  if (s === null || s === undefined) return "";
  if (typeof s !== "string") fail("bad_field", `${name}: must be text.`);
  let t = s.replace(CTRL, "").replace(LONE, "\ufffd");
  if (!multiline) t = t.replace(/\r/g, " ").replace(/\n/g, " ");
  else t = t.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  t = strip(t);
  if (cpLen(t) > maxLen) fail("bad_field", `${name}: must be at most ${maxLen} characters.`);
  return t;
}

// ---------------------------------------------------------------- dates

const DATE_RE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
function isLeap(y) { return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0); }
function daysInMonth(y, m) { return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]; }
function validYmd(y, m, d) { return y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m); }
function parseDate(s, name = "date") {
  if (typeof s !== "string") fail("bad_date", `${name}: must be a date written YYYY-MM-DD.`);
  const m = DATE_RE.exec(s);
  if (!m) fail("bad_date", `${name}: must be a date written YYYY-MM-DD.`);
  const y = +m[1], mo = +m[2], d = +m[3];
  if (!validYmd(y, mo, d)) fail("bad_date", `${name}: ${s} is not a real calendar date.`);
  return [y, mo, d];
}
const pad = (n, w) => String(n).padStart(w, "0");
function ymdStr(y, m, d) { return pad(y, 4) + "-" + pad(m, 2) + "-" + pad(d, 2); }
function daysFromCivil(y, m, d) {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor((y >= 0 ? y : y - 399) / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}
function civilFromDays(z) {
  z += 719468;
  const era = Math.floor((z >= 0 ? z : z - 146096) / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return [y + (m <= 2 ? 1 : 0), m, d];
}
function dayNum(s) { const [y, m, d] = parseDate(s); return daysFromCivil(y, m, d); }
function dayStr(z) { const [y, m, d] = civilFromDays(z); return ymdStr(y, m, d); }
function addDays(s, n) { return dayStr(dayNum(s) + n); }
function daysBetween(a, b) { return dayNum(b) - dayNum(a); }
function addMonths(s, n) {
  const [y, m, d] = parseDate(s);
  const k = y * 12 + (m - 1) + n;
  const y2 = Math.floor(k / 12), m2 = k - y2 * 12 + 1;
  return ymdStr(y2, m2, Math.min(d, daysInMonth(y2, m2)));
}
function monthStart(s) { return s.slice(0, 8) + "01"; }
function monthEnd(s) { const [y, m] = parseDate(s); return ymdStr(y, m, daysInMonth(y, m)); }
function weekday(s) { return ((((dayNum(s) + 3) % 7) + 7) % 7) + 1; }
function weekStart(s) { return addDays(s, 1 - weekday(s)); }

// ---------------------------------------------------------------- clock times and stamps

const TIME_RE = /^([0-9]{2}):([0-9]{2})$/;
const STAMP_RE = /^([0-9]{4}-[0-9]{2}-[0-9]{2})T([0-9]{2}):([0-9]{2})(?::([0-9]{2}))?(Z|[+-][0-9]{2}:[0-9]{2})$/;

function parseTime(s, name = "time") {
  if (typeof s !== "string") fail("bad_time", `${name}: must be a time written HH:MM.`);
  const m = TIME_RE.exec(s);
  if (!m) fail("bad_time", `${name}: must be a time written HH:MM.`);
  const h = +m[1], mi = +m[2];
  if (mi > 59 || h > 24 || (h === 24 && mi !== 0)) fail("bad_time", `${name}: ${s} is not a time of day.`);
  return h * 60 + mi;
}
function timeStr(minutes) {
  const m = minutes !== 1440 ? ((minutes % 1440) + 1440) % 1440 : 1440;
  return pad(Math.floor(m / 60), 2) + ":" + pad(m % 60, 2);
}
function parseStamp(s, name = "time stamp") {
  if (typeof s !== "string") fail("bad_stamp", `${name}: must be a time stamp like 2026-10-05T08:00:00-05:00.`);
  const m = STAMP_RE.exec(s);
  if (!m) fail("bad_stamp", `${name}: must be a time stamp like 2026-10-05T08:00:00-05:00.`);
  const days = dayNum(m[1]);
  const h = +m[2], mi = +m[3], sec = +(m[4] || "0");
  if (h > 23 || mi > 59 || sec > 59) fail("bad_stamp", `${name}: ${s} is not a time of day.`);
  let off = 0;
  const z = m[5];
  if (z !== "Z") {
    const oh = +z.slice(1, 3), om = +z.slice(4, 6);
    if (oh > 14 || om > 59) fail("bad_stamp", `${name}: ${z} is not a UTC offset.`);
    off = (oh * 60 + om) * (z[0] === "+" ? 1 : -1);
  }
  return days * 86400 + h * 3600 + mi * 60 + sec - off * 60;
}
function stampLocal(s) {
  parseStamp(s);
  return [s.slice(0, 10), +s.slice(11, 13) * 60 + +s.slice(14, 16)];
}
function elapsedMinutes(a, b) {
  const d = parseStamp(b, "end") - parseStamp(a, "start");
  return d >= 0 ? Math.floor(d / 60) : -Math.floor(-d / 60);
}

// ---------------------------------------------------------------- money text

function centsText(c) {
  const sign = c < 0 ? "-" : "";
  c = Math.abs(c);
  return `${sign}${Math.floor(c / 100)}.${pad(c % 100, 2)}`;
}
function money(c) {
  const sign = c < 0 ? "-" : "";
  c = Math.abs(c);
  let whole = String(Math.floor(c / 100));
  const groups = [];
  while (whole.length > 3) { groups.unshift(whole.slice(-3)); whole = whole.slice(0, -3); }
  groups.unshift(whole);
  return `${sign}$${groups.join(",")}.${pad(c % 100, 2)}`;
}
function milliText(q) {
  const sign = q < 0 ? "-" : "";
  q = Math.abs(q);
  const frac = pad(q % 1000, 3).replace(/0+$/, "");
  return `${sign}${Math.floor(q / 1000)}` + (frac ? "." + frac : "");
}
function pctText(bp) {
  const sign = bp < 0 ? "-" : "";
  bp = Math.abs(bp);
  return `${sign}${Math.floor(bp / 100)}.${pad(bp % 100, 2)}%`;
}
function parseMoney(s, name = "amount") {
  if (typeof s !== "string") fail("bad_amount", `${name}: must be an amount like 1234.50.`);
  let t = strip(s).split(",").join("").split("$").join("");
  const neg = t.startsWith("-");
  if (neg) t = t.slice(1);
  const m = /^(?:([0-9]{1,10})(?:\.([0-9]{0,2}))?|\.([0-9]{1,2}))$/.exec(t);
  if (!m) fail("bad_amount", `${name}: "${cpSlice(s, 20)}" is not an amount.`);
  let c;
  if (m[3] !== undefined) c = +((m[3] + "0").slice(0, 2));
  else c = +m[1] * 100 + +(((m[2] || "") + "00").slice(0, 2));
  if (c > MAX_CENTS) fail("bad_amount", `${name}: must be at most $10,000,000.00.`);
  return neg ? -c : c;
}
function parseMilli(s, name = "quantity") {
  if (typeof s !== "string") fail("bad_quantity", `${name}: must be a number like 1.5.`);
  const t = strip(s).split(",").join("");
  const m = /^(?:([0-9]{1,7})(?:\.([0-9]{0,3}))?|\.([0-9]{1,3}))$/.exec(t);
  if (!m) fail("bad_quantity", `${name}: "${cpSlice(s, 20)}" is not a number with at most 3 decimals.`);
  if (m[3] !== undefined) return +((m[3] + "00").slice(0, 3));
  return +m[1] * 1000 + +(((m[2] || "") + "000").slice(0, 3));
}

// ---------------------------------------------------------------- CSV

// A spreadsheet may run a cell as a formula when it starts with one of these, including the
// full-width forms some input methods type, and including after leading spaces.
const FORMULA_START = ["=", "+", "-", "@", "\t", "\r", "\uff1d", "\uff0b", "\uff0d", "\uff20"];
function csvCell(v) {
  let text;
  if (v === null || v === undefined) text = "";
  else if (typeof v === "boolean") text = v ? "yes" : "no";
  else if (typeof v === "number") text = String(v);
  else {
    text = String(v);
    const lead = text.replace(/^[ \u00a0\u3000]+/, "");
    if (FORMULA_START.some((p) => lead.startsWith(p))) text = "'" + text;
  }
  if (/[,"\n\r]/.test(text)) text = '"' + text.replace(/"/g, '""') + '"';
  return text;
}
const isMoneyCell = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && Object.prototype.hasOwnProperty.call(v, "$");
function toCsv(rows) {
  return rows.map((row) => row.map((v) => (isMoneyCell(v) ? centsText(v.$) : csvCell(v))).join(",")).join("\r\n") + "\r\n";
}
function checkSize(text, what = "file") {
  if (typeof text !== "string") fail("bad_file", `The ${what} could not be read as text.`);
  if (text.length > MAX_FILE_CHARS) fail("too_large", `The ${what} is larger than 5 MB. Split it into smaller files.`);
  return text;
}
function countOf(s, sub) { let n = 0, i = 0; for (;;) { const k = s.indexOf(sub, i); if (k < 0) return n; n++; i = k + sub.length; } }
function sniffDelimiter(first) {
  let best = ",", bc = 0;
  for (const d of [",", "\t", ";", "|"]) { const c = countOf(first, d); if (c > bc) { bc = c; best = d; } }
  return best;
}
function parseCsv(text, delimiter = "") {
  text = checkSize(text);
  if (text.startsWith("﻿")) text = text.slice(1);
  if (delimiter === "") {
    const nl = text.indexOf("\n");
    delimiter = sniffDelimiter(nl < 0 ? text : text.slice(0, nl));
  }
  const rows = [];
  let row = [], field = [], i = 0, line = 1, rowLine = 1, inQuotes = false, started = false;
  const n = text.length;
  const push = () => {
    rows.push({ line: rowLine, cells: row });
    if (rows.length > MAX_ROWS) fail("too_many_rows", `The file has more than ${MAX_ROWS} rows. Split it into smaller files.`);
  };
  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < n && text[i + 1] === '"') { field.push('"'); i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      if (ch === "\n") line += 1;
      field.push(ch);
    } else if (ch === '"' && !started) {
      inQuotes = true; started = true;
    } else if (ch === delimiter) {
      row.push(field.join("")); field = []; started = false;
    } else if (ch === "\r" || ch === "\n") {
      row.push(field.join("")); field = []; started = false;
      push();
      row = [];
      if (ch === "\r" && i + 1 < n && text[i + 1] === "\n") i += 1;
      line += 1; rowLine = line;
    } else {
      field.push(ch); started = true;
    }
    if (field.length > MAX_FIELD_CHARS) fail("field_too_long", `Line ${rowLine}: a field is longer than ${MAX_FIELD_CHARS} characters.`);
    i += 1;
  }
  if (inQuotes) fail("bad_csv", `Line ${rowLine}: a quoted field is never closed.`);
  if (started || row.length) { row.push(field.join("")); push(); }
  const out = [];
  for (const r of rows) {
    const cells = r.cells.map(strip);
    if (cells.some((c) => c !== "")) out.push({ line: r.line, cells });
  }
  return { delimiter, rows: out };
}

// ---------------------------------------------------------------- small shared helpers

function utf8(text) {
  const out = [];
  for (const ch of text) {
    let c = ch.codePointAt(0);
    if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}
function escHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
// Compare tuples the way Python sorts them (numbers by value, strings by code unit).
function cmp(a, b) {
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}
function sortBy(xs, key) { return xs.map((x, i) => [key(x), i, x]).sort((p, q) => cmp(p[0], q[0]) || p[1] - q[1]).map((p) => p[2]); }
function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
function stableJson(x) {
  if (x === null || typeof x !== "object") return JSON.stringify(x === undefined ? null : x);
  if (Array.isArray(x)) return "[" + x.map(stableJson).join(",") + "]";
  return "{" + Object.keys(x).sort().map((k) => JSON.stringify(k) + ":" + stableJson(x[k])).join(",") + "}";
}
function deepEqual(a, b) { return stableJson(a) === stableJson(b); }
function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
function isObj(x) { return x !== null && typeof x === "object" && !Array.isArray(x); }
function sortedKeys(o) { return Object.keys(o).sort(); }
