// ---- qr (src/fieldservice/qr.py): QR Code encoder, byte mode, level M, versions 1 to 40.

const ECC_PER_BLOCK_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28,
  28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
const BLOCKS_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28,
  29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];
const QR_MAX_BYTES = 2331;

function qrRawModules(ver) {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const na = Math.floor(ver / 7) + 2;
    r -= (25 * na - 10) * na - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}
function qrDataCodewords(ver) { return Math.floor(qrRawModules(ver) / 8) - ECC_PER_BLOCK_M[ver] * BLOCKS_M[ver]; }
function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = ((z << 1) ^ ((z >> 7) * 0x11d)) & 0xff;
    z ^= ((y >> i) & 1) * x;
  }
  return z;
}
function rsDivisor(degree) {
  const r = new Array(degree - 1).fill(0).concat([1]);
  let root = 1;
  for (let k = 0; k < degree; k++) {
    for (let j = 0; j < degree; j++) {
      r[j] = gfMul(r[j], root);
      if (j + 1 < degree) r[j] ^= r[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return r;
}
function rsRemainder(data, div) {
  let r = new Array(div.length).fill(0);
  for (const b of data) {
    const f = b ^ r[0];
    r = r.slice(1).concat([0]);
    div.forEach((c, i) => { r[i] ^= gfMul(c, f); });
  }
  return r;
}
function qrAlign(ver) {
  if (ver === 1) return [];
  const na = Math.floor(ver / 7) + 2;
  const size = ver * 4 + 17;
  const step = ver === 32 ? 26 : Math.floor((ver * 4 + na * 2 + 1) / (na * 2 - 2)) * 2;
  const out = [];
  for (let i = 0; i < na - 1; i++) out.push(size - 7 - i * step);
  out.reverse();
  return [6].concat(out);
}
function qrEncodeData(data) {
  if (data.length > QR_MAX_BYTES) fail("too_long", "The text is too long for a QR code.");
  let ver = 0, cc = 0, cap = 0;
  for (let v = 1; v <= 40; v++) {
    cap = qrDataCodewords(v) * 8;
    cc = v < 10 ? 8 : 16;
    if (4 + cc + 8 * data.length <= cap) { ver = v; break; }
  }
  if (!ver) fail("too_long", "The text is too long for a QR code.");
  const bits = [];
  const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >> i) & 1); };
  put(4, 4);
  put(data.length, cc);
  for (const b of data) put(b, 8);
  put(0, Math.min(4, cap - bits.length));
  put(0, (8 - bits.length % 8) % 8);
  let padb = 0xec;
  while (bits.length < cap) { put(padb, 8); padb ^= 0xec ^ 0x11; }
  const cw = [];
  for (let i = 0; i < bits.length; i += 8) { let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j]; cw.push(v); }
  return [ver, cw];
}
function qrAddEcc(ver, data) {
  const nb = BLOCKS_M[ver], ecl = ECC_PER_BLOCK_M[ver];
  const raw = Math.floor(qrRawModules(ver) / 8);
  const nshort = nb - raw % nb;
  const shortLen = Math.floor(raw / nb);
  const div = rsDivisor(ecl);
  const blocks = [];
  let k = 0;
  for (let i = 0; i < nb; i++) {
    const n = shortLen - ecl + (i < nshort ? 0 : 1);
    let dat = data.slice(k, k + n);
    k += n;
    const ecc = rsRemainder(dat, div);
    if (i < nshort) dat = dat.concat([0]);
    blocks.push(dat.concat(ecc));
  }
  const out = [];
  for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - ecl || j >= nshort) out.push(b[i]); });
  return out;
}
class QrGrid {
  constructor(ver) {
    this.ver = ver;
    this.size = ver * 4 + 17;
    this.m = [...Array(this.size)].map(() => new Array(this.size).fill(0));
    this.f = [...Array(this.size)].map(() => new Array(this.size).fill(false));
  }
  setf(x, y, dark) { this.m[y][x] = dark ? 1 : 0; this.f[y][x] = true; }
  functions() {
    const n = this.size;
    for (let i = 0; i < n; i++) { this.setf(6, i, i % 2 === 0); this.setf(i, 6, i % 2 === 0); }
    for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x >= 0 && x < n && y >= 0 && y < n) { const d = Math.max(Math.abs(dx), Math.abs(dy)); this.setf(x, y, d !== 2 && d !== 4); }
      }
    }
    const pos = qrAlign(this.ver);
    const na = pos.length;
    for (let i = 0; i < na; i++) for (let j = 0; j < na; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) this.setf(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    this.formatBits(0);
    if (this.ver >= 7) {
      let rem = this.ver;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >> 11) * 0x1f25);
      const bits = (this.ver << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const b = (bits >> i) & 1, a = n - 11 + i % 3, c = Math.floor(i / 3);
        this.setf(a, c, b);
        this.setf(c, a, b);
      }
    }
  }
  formatBits(mask) {
    const data = (0 << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const n = this.size;
    const g = (i) => (bits >> i) & 1;
    for (let i = 0; i < 6; i++) this.setf(8, i, g(i));
    this.setf(8, 7, g(6));
    this.setf(8, 8, g(7));
    this.setf(7, 8, g(8));
    for (let i = 9; i < 15; i++) this.setf(14 - i, 8, g(i));
    for (let i = 0; i < 8; i++) this.setf(n - 1 - i, 8, g(i));
    for (let i = 8; i < 15; i++) this.setf(8, n - 15 + i, g(i));
    this.setf(8, n - 8, true);
  }
  codewords(cw) {
    const n = this.size;
    let i = 0;
    const total = cw.length * 8;
    for (let right = n - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < n; vert++) for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? n - 1 - vert : vert;
        if (!this.f[y][x] && i < total) { this.m[y][x] = (cw[i >> 3] >> (7 - (i & 7))) & 1; i += 1; }
      }
    }
  }
  mask(k) {
    const n = this.size;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (this.f[y][x]) continue;
      let inv;
      if (k === 0) inv = (x + y) % 2 === 0;
      else if (k === 1) inv = y % 2 === 0;
      else if (k === 2) inv = x % 3 === 0;
      else if (k === 3) inv = (x + y) % 3 === 0;
      else if (k === 4) inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      else if (k === 5) inv = (x * y) % 2 + (x * y) % 3 === 0;
      else if (k === 6) inv = ((x * y) % 2 + (x * y) % 3) % 2 === 0;
      else inv = ((x + y) % 2 + (x * y) % 3) % 2 === 0;
      if (inv) this.m[y][x] ^= 1;
    }
  }
}
const QR_P1 = "10111010000", QR_P2 = "00001011101";
function qrPenalty(m) {
  const n = m.length;
  let score = 0;
  const lines = m.map((r) => r).concat([...Array(n).keys()].map((x) => m.map((r) => r[x])));
  for (const ln of lines) {
    let run = 1;
    for (let i = 1; i <= n; i++) {
      if (i < n && ln[i] === ln[i - 1]) run += 1;
      else { if (run >= 5) score += 3 + run - 5; run = 1; }
    }
    const s = ln.join("");
    for (let i = 0; i < n - 10; i++) { const seg = s.slice(i, i + 11); if (seg === QR_P1 || seg === QR_P2) score += 40; }
  }
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
    const c = m[y][x];
    if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
  }
  let dark = 0;
  for (const r of m) for (const c of r) dark += c;
  const total = n * n;
  const k = Math.floor((Math.abs(dark * 20 - total * 10) + total - 1) / total) - 1;
  return score + Math.max(0, k) * 10;
}
function qrMatrix(text) {
  if (typeof text !== "string" || text === "") fail("bad_field", "QR text: must be non-empty text.");
  const [ver, data] = qrEncodeData(utf8(text));
  const cw = qrAddEcc(ver, data);
  let best = null;
  for (let k = 0; k < 8; k++) {
    const g = new QrGrid(ver);
    g.functions();
    g.codewords(cw);
    g.mask(k);
    g.formatBits(k);
    const p = qrPenalty(g.m);
    if (best === null || p < best[0]) best = [p, k, g];
  }
  const g = best[2];
  return { version: ver, mask: best[1], size: g.size, rows: g.m.map((r) => r.join("")) };
}
function qrSvg(text, px = 4) {
  const q = qrMatrix(text);
  const n = q.size + 8;
  const d = [];
  q.rows.forEach((row, y) => {
    let x = 0;
    while (x < q.size) {
      if (row[x] === "1") {
        const s = x;
        while (x < q.size && row[x] === "1") x += 1;
        d.push(`M${s + 4} ${y + 4}h${x - s}v1h-${x - s}z`);
      } else x += 1;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${n * px}" height="${n * px}" ` +
    `shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${n}" height="${n}" ` +
    `fill="#ffffff"/><path fill="#000000" d="${d.join("")}"/></svg>`;
}
