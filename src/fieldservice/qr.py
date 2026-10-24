"""QR Code encoder (ISO/IEC 18004 Model 2): byte mode, error correction level M, versions 1
to 40, automatic mask choice. Used to print a payment link on quotes and invoices; it runs
on the device, so the link never goes to a QR service.

Method follows the public description of the standard and Project Nayuki's reference
implementation (MIT license): Reed-Solomon over GF(256) with polynomial 0x11D, block
interleaving, the eight masks, and the four penalty rules.
"""

from __future__ import annotations

from .util import fail

ECC_PER_BLOCK_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28,
                   28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28]
BLOCKS_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28,
            29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49]
MAX_BYTES = 2331


def utf8(text: str) -> list:
    return list(text.encode("utf-8"))


def raw_modules(ver: int) -> int:
    r = (16 * ver + 128) * ver + 64
    if ver >= 2:
        na = ver // 7 + 2
        r -= (25 * na - 10) * na - 55
        if ver >= 7:
            r -= 36
    return r


def data_codewords(ver: int) -> int:
    return raw_modules(ver) // 8 - ECC_PER_BLOCK_M[ver] * BLOCKS_M[ver]


def gf_mul(x: int, y: int) -> int:
    z = 0
    for i in range(7, -1, -1):
        z = ((z << 1) ^ ((z >> 7) * 0x11D)) & 0xFF
        z ^= ((y >> i) & 1) * x
    return z


def rs_divisor(degree: int) -> list:
    r = [0] * (degree - 1) + [1]
    root = 1
    for _ in range(degree):
        for j in range(degree):
            r[j] = gf_mul(r[j], root)
            if j + 1 < degree:
                r[j] ^= r[j + 1]
        root = gf_mul(root, 0x02)
    return r


def rs_remainder(data: list, div: list) -> list:
    r = [0] * len(div)
    for b in data:
        f = b ^ r[0]
        r = r[1:] + [0]
        for i, c in enumerate(div):
            r[i] ^= gf_mul(c, f)
    return r


def align_positions(ver: int) -> list:
    if ver == 1:
        return []
    na = ver // 7 + 2
    size = ver * 4 + 17
    step = 26 if ver == 32 else (ver * 4 + na * 2 + 1) // (na * 2 - 2) * 2
    out = [size - 7 - i * step for i in range(na - 1)]
    out.reverse()
    return [6] + out


def encode_data(data: list):
    """[version, codewords] for the smallest version that holds the bytes."""
    if len(data) > MAX_BYTES:
        fail("too_long", "The text is too long for a QR code.")
    for ver in range(1, 41):
        cap = data_codewords(ver) * 8
        cc = 8 if ver < 10 else 16
        need = 4 + cc + 8 * len(data)
        if need <= cap:
            break
    else:
        fail("too_long", "The text is too long for a QR code.")
    bits = []

    def put(v, n):
        for i in range(n - 1, -1, -1):
            bits.append((v >> i) & 1)

    put(4, 4)
    put(len(data), cc)
    for b in data:
        put(b, 8)
    put(0, min(4, cap - len(bits)))
    put(0, (8 - len(bits) % 8) % 8)
    pad = 0xEC
    while len(bits) < cap:
        put(pad, 8)
        pad ^= 0xEC ^ 0x11
    cw = [int("".join(str(x) for x in bits[i:i + 8]), 2) for i in range(0, len(bits), 8)]
    return ver, cw


def add_ecc(ver: int, data: list) -> list:
    nb = BLOCKS_M[ver]
    ecl = ECC_PER_BLOCK_M[ver]
    raw = raw_modules(ver) // 8
    nshort = nb - raw % nb
    short_len = raw // nb
    div = rs_divisor(ecl)
    blocks = []
    k = 0
    for i in range(nb):
        n = short_len - ecl + (0 if i < nshort else 1)
        dat = data[k:k + n]
        k += n
        ecc = rs_remainder(dat, div)
        if i < nshort:
            dat = dat + [0]
        blocks.append(dat + ecc)
    out = []
    for i in range(len(blocks[0])):
        for j, b in enumerate(blocks):
            if i != short_len - ecl or j >= nshort:
                out.append(b[i])
    return out


class _Grid:
    def __init__(self, ver):
        self.ver = ver
        self.size = ver * 4 + 17
        self.m = [[0] * self.size for _ in range(self.size)]
        self.f = [[False] * self.size for _ in range(self.size)]

    def setf(self, x, y, dark):
        self.m[y][x] = 1 if dark else 0
        self.f[y][x] = True

    def functions(self):
        n = self.size
        for i in range(n):
            self.setf(6, i, i % 2 == 0)
            self.setf(i, 6, i % 2 == 0)
        for cx, cy in ((3, 3), (n - 4, 3), (3, n - 4)):
            for dy in range(-4, 5):
                for dx in range(-4, 5):
                    x, y = cx + dx, cy + dy
                    if 0 <= x < n and 0 <= y < n:
                        d = max(abs(dx), abs(dy))
                        self.setf(x, y, d not in (2, 4))
        pos = align_positions(self.ver)
        na = len(pos)
        for i in range(na):
            for j in range(na):
                if (i == 0 and j == 0) or (i == 0 and j == na - 1) or (i == na - 1 and j == 0):
                    continue
                for dy in range(-2, 3):
                    for dx in range(-2, 3):
                        self.setf(pos[i] + dx, pos[j] + dy, max(abs(dx), abs(dy)) != 1)
        self.format_bits(0)
        if self.ver >= 7:
            rem = self.ver
            for _ in range(12):
                rem = (rem << 1) ^ ((rem >> 11) * 0x1F25)
            bits = self.ver << 12 | rem
            for i in range(18):
                b = (bits >> i) & 1
                a = n - 11 + i % 3
                c = i // 3
                self.setf(a, c, b)
                self.setf(c, a, b)

    def format_bits(self, mask):
        data = 0 << 3 | mask
        rem = data
        for _ in range(10):
            rem = (rem << 1) ^ ((rem >> 9) * 0x537)
        bits = (data << 10 | rem) ^ 0x5412
        n = self.size
        g = lambda i: (bits >> i) & 1
        for i in range(6):
            self.setf(8, i, g(i))
        self.setf(8, 7, g(6))
        self.setf(8, 8, g(7))
        self.setf(7, 8, g(8))
        for i in range(9, 15):
            self.setf(14 - i, 8, g(i))
        for i in range(8):
            self.setf(n - 1 - i, 8, g(i))
        for i in range(8, 15):
            self.setf(8, n - 15 + i, g(i))
        self.setf(8, n - 8, True)

    def codewords(self, cw):
        n = self.size
        i = 0
        total = len(cw) * 8
        right = n - 1
        while right >= 1:
            if right == 6:
                right = 5
            for vert in range(n):
                for j in range(2):
                    x = right - j
                    upward = ((right + 1) & 2) == 0
                    y = n - 1 - vert if upward else vert
                    if not self.f[y][x] and i < total:
                        self.m[y][x] = (cw[i >> 3] >> (7 - (i & 7))) & 1
                        i += 1
            right -= 2

    def mask(self, k):
        n = self.size
        for y in range(n):
            for x in range(n):
                if self.f[y][x]:
                    continue
                if k == 0:
                    inv = (x + y) % 2 == 0
                elif k == 1:
                    inv = y % 2 == 0
                elif k == 2:
                    inv = x % 3 == 0
                elif k == 3:
                    inv = (x + y) % 3 == 0
                elif k == 4:
                    inv = (x // 3 + y // 2) % 2 == 0
                elif k == 5:
                    inv = x * y % 2 + x * y % 3 == 0
                elif k == 6:
                    inv = (x * y % 2 + x * y % 3) % 2 == 0
                else:
                    inv = ((x + y) % 2 + x * y % 3) % 2 == 0
                if inv:
                    self.m[y][x] ^= 1


P1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0]
P2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1]


def penalty(m: list) -> int:
    n = len(m)
    score = 0
    lines = [m[y] for y in range(n)] + [[m[y][x] for y in range(n)] for x in range(n)]
    for ln in lines:
        run = 1
        for i in range(1, n + 1):
            if i < n and ln[i] == ln[i - 1]:
                run += 1
            else:
                if run >= 5:
                    score += 3 + run - 5
                run = 1
        for i in range(n - 10):
            seg = ln[i:i + 11]
            if seg == P1 or seg == P2:
                score += 40
    for y in range(n - 1):
        for x in range(n - 1):
            c = m[y][x]
            if c == m[y][x + 1] == m[y + 1][x] == m[y + 1][x + 1]:
                score += 3
    dark = sum(sum(r) for r in m)
    total = n * n
    k = (abs(dark * 20 - total * 10) + total - 1) // total - 1
    score += max(0, k) * 10
    return score


def qr_matrix(text: str) -> dict:
    """The QR symbol for text: {version, mask, size, rows} where rows are strings of 0 and 1
    (1 is a dark module), without the quiet zone."""
    if not isinstance(text, str) or text == "":
        fail("bad_field", "QR text: must be non-empty text.")
    ver, data = encode_data(utf8(text))
    cw = add_ecc(ver, data)
    best = None
    for k in range(8):
        g = _Grid(ver)
        g.functions()
        g.codewords(cw)
        g.mask(k)
        g.format_bits(k)
        p = penalty(g.m)
        if best is None or p < best[0]:
            best = (p, k, g)
    g = best[2]
    return {"version": ver, "mask": best[1], "size": g.size, "rows": ["".join(str(c) for c in r) for r in g.m]}


def qr_svg(text: str, px: int = 4) -> str:
    """An SVG image of the QR code with a 4-module quiet zone, dark on white."""
    q = qr_matrix(text)
    n = q["size"] + 8
    d = []
    for y, row in enumerate(q["rows"]):
        x = 0
        while x < q["size"]:
            if row[x] == "1":
                s = x
                while x < q["size"] and row[x] == "1":
                    x += 1
                d.append(f"M{s + 4} {y + 4}h{x - s}v1h-{x - s}z")
            else:
                x += 1
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {n} {n}" width="{n * px}" height="{n * px}" '
            f'shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="{n}" height="{n}" '
            f'fill="#ffffff"/><path fill="#000000" d="{"".join(d)}"/></svg>')
