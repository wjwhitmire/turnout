// ---- schedule (src/fieldservice/schedule.py): recurrence, visits, conflicts, route order.

const DAY_ABBR = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_NAME = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const ORD = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th", "-1": "last" };
const MAX_SPAN_DAYS = 36600;
const MAX_DATES = 5000;
const pmod = (a, b) => ((a % b) + b) % b;

function nthWeekday(y, m, nth, wd) {
  if (nth > 0) {
    const first = weekday(ymdStr(y, m, 1));
    return 1 + pmod(wd - first, 7) + (nth - 1) * 7;
  }
  const last = daysInMonth(y, m);
  const lw = weekday(ymdStr(y, m, last));
  return last - pmod(lw - wd, 7);
}

function occurrences(rule, start, frm, to, end = "", limit = 0) {
  const s = dayNum(start);
  const lo = Math.max(dayNum(frm), s);
  let hi = dayNum(to);
  if (end) hi = Math.min(hi, dayNum(end));
  if (hi - s > MAX_SPAN_DAYS) fail("too_long", "The schedule date range is longer than 100 years.");
  const out = [];
  if (hi < lo) return out;
  const exc = new Set(rule.exceptions);
  let n = 0;
  const iv = rule.interval, f = rule.freq;
  const take = (z) => {
    n += 1;
    if (limit && n > limit) return false;
    if (z >= lo) {
      const d = dayStr(z);
      if (!exc.has(d)) {
        out.push(d);
        if (out.length > MAX_DATES) fail("too_many", `The schedule makes more than ${MAX_DATES} visits in this date range.`);
      }
    }
    return true;
  };
  if (f === "daily") {
    for (let z = s; z <= hi; z += iv) if (!take(z)) break;
  } else if (f === "weekly") {
    let w = dayNum(weekStart(start));
    let stop = false;
    while (w <= hi && !stop) {
      for (const d of rule.days) {
        const z = w + d - 1;
        if (z < s) continue;
        if (z > hi) { stop = true; break; }
        if (!take(z)) { stop = true; break; }
      }
      w += 7 * iv;
    }
  } else {
    const [y, m] = parseDate(start);
    let k = y * 12 + (m - 1);
    for (;;) {
      const yy = Math.floor(k / 12), mm = (k % 12) + 1;
      if (dayNum(ymdStr(yy, mm, 1)) > hi) break;
      let dd;
      if (rule.month_mode === "day") {
        const dim = daysInMonth(yy, mm);
        dd = rule.month_day === -1 ? dim : Math.min(rule.month_day, dim);
      } else dd = nthWeekday(yy, mm, rule.nth, rule.weekday);
      const z = dayNum(ymdStr(yy, mm, dd));
      if (z > hi) break;
      if (z >= s && !take(z)) break;
      k += iv;
    }
  }
  return out;
}

function describeRule(rule) {
  const iv = rule.interval, f = rule.freq;
  let txt;
  if (f === "daily") txt = iv === 1 ? "Every day" : `Every ${iv} days`;
  else if (f === "weekly") txt = (iv === 1 ? "Every week" : `Every ${iv} weeks`) + " on " + rule.days.map((d) => DAY_ABBR[d - 1]).join(", ");
  else {
    const head = iv === 1 ? "Every month" : `Every ${iv} months`;
    if (rule.month_mode === "day") txt = head + (rule.month_day === -1 ? " on the last day" : ` on day ${rule.month_day}`);
    else txt = head + ` on the ${ORD[String(rule.nth)]} ${DAY_NAME[rule.weekday - 1]}`;
  }
  if (rule.exceptions.length) { const k = rule.exceptions.length; txt += `, ${k} date${k !== 1 ? "s" : ""} skipped`; }
  return txt;
}

function jobVisits(book, jobId) { return book.visits.filter((v) => v.job_id === jobId); }

function newVisit(job, date, occurrence = "") {
  return { job_id: job.id, date, start_time: job.start_time, duration_min: job.duration_min, crew_ids: job.crew_ids.slice(),
    status: "scheduled", occurrence, checklist: job.checklist.map((c) => ({ id: c.id, text: c.text, done: false, note: "" })) };
}
function planVisits(book, job, frm, through) {
  if (job.kind !== "recurring" || job.status !== "active" || job.rule === null) return [];
  if (book.clients.some((c) => c.id === job.client_id && c.archived)) return [];
  const have = new Set(book.visits.filter((v) => v.job_id === job.id && v.occurrence).map((v) => v.occurrence));
  return occurrences(job.rule, job.start_date, frm, through, job.end_date, job.visit_limit).filter((d) => !have.has(d));
}
function generateVisits(tx, jobId, frm, through) {
  const job = tx.need("jobs", jobId);
  return planVisits(tx.book, job, frm, through).map((d) => tx.create("visits", newVisit(job, d, d)));
}

function visitSpan(v) { const z = dayNum(v.date) * 1440 + parseTime(v.start_time); return [z, z + v.duration_min]; }

function findConflicts(book, frm, to) {
  const lo = dayNum(frm) - 1, hi = dayNum(to);
  const per = new Map();
  for (const v of book.visits) {
    if (v.status === "cancelled" || !v.start_time || v.duration_min === 0) continue;
    const z = dayNum(v.date);
    if (z < lo || z > hi) continue;
    const sp = visitSpan(v);
    for (const c of v.crew_ids) { if (!per.has(c)) per.set(c, []); per.get(c).push([sp[0], sp[1], v.id, v.date]); }
  }
  const out = [];
  const f0 = dayNum(frm);
  for (const c of [...per.keys()].sort()) {
    const xs = sortBy(per.get(c), (t) => [t[0], t[1], t[2]]);
    for (let i = 0; i < xs.length; i++) {
      for (let j = i + 1; j < xs.length; j++) {
        if (xs[j][0] >= xs[i][1]) break;
        const ov = Math.min(xs[i][1], xs[j][1]) - xs[j][0];
        if (dayNum(xs[j][3]) < f0 && dayNum(xs[i][3]) < f0) continue;
        out.push({ crew_id: c, a: xs[i][2], b: xs[j][2], date: xs[j][3], overlap_min: ov });
      }
    }
  }
  return out;
}

const PI = 3.141592653589793;
const EARTH_M = 6371008.8;
function cosSeries(x) {
  const x2 = x * x;
  let r = 1.0, t = 1.0;
  for (let k = 1; k < 10; k++) { t = -t * x2 / ((2 * k - 1) * (2 * k)); r = r + t; }
  return r;
}
function distanceM(a, b) {
  const la = a[0] * PI / 180000000.0;
  const lb = b[0] * PI / 180000000.0;
  const dl = (b[1] - a[1]) * PI / 180000000.0;
  const x = dl * cosSeries((la + lb) / 2.0);
  const y = lb - la;
  return EARTH_M * Math.sqrt(x * x + y * y);
}
function roundHalf(x) { return x >= 0 ? Math.floor(x + 0.5) : -Math.floor(-x + 0.5); }
const hasCoord = (s) => s.lat_e6 !== null && s.lon_e6 !== null;

function routeOrder(stops, start = null) {
  const pts = stops.filter(hasCoord);
  const unplaced = stops.filter((s) => !hasCoord(s)).map((s) => s.id);
  const order = [], legs = [];
  let total = 0.0;
  const left = pts.map((_, i) => i);
  let cur = start;
  if (cur === null && pts.length) cur = [pts[0].lat_e6, pts[0].lon_e6];
  while (left.length) {
    let best = -1, bd = 0.0;
    for (const i of left) {
      const d = distanceM(cur, [pts[i].lat_e6, pts[i].lon_e6]);
      if (best < 0 || d < bd) { best = i; bd = d; }
    }
    order.push(pts[best].id);
    legs.push(roundHalf(bd));
    total += bd;
    cur = [pts[best].lat_e6, pts[best].lon_e6];
    left.splice(left.indexOf(best), 1);
  }
  return { order: order.concat(unplaced), distance_m: roundHalf(total), legs_m: legs, unplaced };
}
function pathDistance(stops, start = null) {
  const pts = stops.filter(hasCoord).map((s) => [s.lat_e6, s.lon_e6]);
  let total = 0.0;
  let cur = start !== null ? start : (pts.length ? pts[0] : null);
  for (const p of pts) { total += distanceM(cur, p); cur = p; }
  return roundHalf(total);
}
function dayStops(book, crewId, date) {
  const jobs = new Map(book.jobs.map((j) => [j.id, j]));
  const props = new Map(book.properties.map((p) => [p.id, p]));
  let vs = book.visits.filter((v) => v.date === date && v.crew_ids.includes(crewId) && v.status !== "cancelled");
  vs = sortBy(vs, (v) => [v.route_seq ? v.route_seq : 1000, v.start_time || "99:99", v.id]);
  return vs.map((v) => {
    const p = props.get(jobs.get(v.job_id).property_id) || null;
    return { id: v.id, lat_e6: p ? p.lat_e6 : null, lon_e6: p ? p.lon_e6 : null };
  });
}
function suggestRoute(book, crewId, date) {
  const s = book.settings;
  const home = s.home_lat_e6 !== null && s.home_lon_e6 !== null ? [s.home_lat_e6, s.home_lon_e6] : null;
  const stops = dayStops(book, crewId, date);
  const r = routeOrder(stops, home);
  const cur = pathDistance(stops, home);
  r.current_order = stops.map((x) => x.id);
  r.current_m = cur;
  r.saved_m = cur - r.distance_m;
  return r;
}
function applyRoute(tx, crewId, date, order, retime, gapMin) {
  if (gapMin < 0 || gapMin > 240) fail("bad_field", "gap: must be 0 to 240 minutes.");
  const vs = order.map((vid) => tx.need("visits", vid));
  for (const v of vs) if (v.date !== date || !v.crew_ids.includes(crewId)) fail("bad_route", `Visit ${v.id} is not on this crew member's day.`);
  let t = null;
  if (retime) {
    const firsts = vs.filter((v) => v.start_time).map((v) => parseTime(v.start_time));
    t = firsts.length ? Math.min(...firsts) : parseTime(tx.book.settings.day_start || "08:00");
  }
  return vs.map((v, i) => {
    const f = { route_seq: i + 1 };
    if (retime) {
      if (t + v.duration_min > 1440) fail("bad_route", "The day runs past midnight with these visit lengths. Shorten the gap or move a visit.");
      f.start_time = pad(Math.floor(t / 60), 2) + ":" + pad(t % 60, 2);
      t += v.duration_min + gapMin;
    }
    return tx.patch("visits", v.id, f);
  });
}
function crewDay(book, crewId, date) { return dayStops(book, crewId, date).map((s) => s.id); }
