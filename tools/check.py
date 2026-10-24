"""Contrast (WCAG 2.x) and color-vision checks for Turnout tokens.
Run: python3 tools/check.py   (exit 1 on any failure; prints the contrast tables as markdown)."""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tokens import DARK, LIGHT, LOCAL, SHARED  # noqa: E402


def rgb(h):
    h = h.lstrip('#')
    return [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]


def lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def lum(h):
    r, g, b = [lin(c) for c in rgb(h)]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def cr(a, b):
    la, lb = sorted([lum(a), lum(b)], reverse=True)
    return (la + 0.05) / (lb + 0.05)


# Machado, Oliveira and Fernandes (2009), severity 1.0, applied in linear RGB.
M = {"protan": [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
     "deutan": [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
     "tritan": [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]]}


def sim(h, kind):
    v = [lin(c) for c in rgb(h)]
    return [max(0, min(1, sum(M[kind][i][j] * v[j] for j in range(3)))) for i in range(3)]


def lab_lin(v):
    X = 0.4124 * v[0] + 0.3576 * v[1] + 0.1805 * v[2]
    Y = 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]
    Z = 0.0193 * v[0] + 0.1192 * v[1] + 0.9505 * v[2]

    def f(t):
        return t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116
    fx, fy, fz = f(X / 0.95047), f(Y), f(Z / 1.08883)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def lab(h, kind=None):
    return lab_lin(sim(h, kind) if kind else [lin(c) for c in rgb(h)])


STATUS_KEYS = ["st-sched", "st-prog", "st-done", "st-late", "st-bill", "st-hold"]
TEXT = [("fg", "bg"), ("fg", "surface"), ("fg", "surface-2"), ("fg", "field"), ("fg", "sel"), ("fg", "row-hover"),
        ("fg", "today"), ("fg", "drop"),
        ("muted", "bg"), ("muted", "surface"), ("muted", "surface-2"), ("muted", "sel"), ("muted", "today"),
        ("accent", "surface"), ("accent", "bg"), ("accent", "surface-2"), ("accent-ink", "accent"),
        ("mark-ink", "mark"), ("good", "surface"), ("warn", "surface"), ("bad", "surface"), ("bad", "surface-2"), ("bad", "sel"),
        ("surface", "fg"), ("nav-fg", "nav-bg"), ("nav-muted", "nav-bg"), ("nav-fg", "nav-sel"), ("nav-fg", "nav-hover"),
        ("paper-ink", "paper"), ("paper-muted", "paper"), ("mark-ink", "paper-mark")]
TEXT += [(k, "surface") for k in STATUS_KEYS] + [(k, "surface-2") for k in STATUS_KEYS] + [("st-ink", k) for k in STATUS_KEYS]
GFX = [("line", "surface"), ("line", "field"), ("line", "bg"), ("nav-ind", "nav-sel"), ("nav-ind", "nav-bg"),
       ("chart-1", "field"), ("chart-2", "field"), ("chart-3", "field"), ("chart-4", "field"),
       ("fg", "surface"), ("fg", "drop"), ("bad", "drop"), ("accent", "bg")]
GFX += [(k, "surface") for k in STATUS_KEYS]
# The key answer plate is a filled shape: its edge must clear 3:1 against the sheet it sits on,
# either through the yellow fill itself (dark theme) or through its mark-ink rim (light theme).
PLATE = [("surface",), ("bg",), ("surface-2",)]
SETS = {"job status (T-card tabs)": STATUS_KEYS,
        "job status plus key plate": STATUS_KEYS + ["mark"],
        "chart series": ["chart-1", "chart-2", "chart-3", "chart-4"],
        "status words (good, warn, bad)": ["good", "warn", "bad"],
        "actions against alarms (accent, bad, mark)": ["accent", "bad", "mark"]}
NEED_DE = 12


def main():
    fail = 0
    rows = []
    for name, T in (("light", LIGHT), ("dark", DARK)):
        assert set(T) == set(SHARED + LOCAL), (name, set(T) ^ set(SHARED + LOCAL))
    for kind, pairs, need in (("text", TEXT, 4.5), ("graphic", GFX, 3.0)):
        for a, b in pairs:
            lv, dv = cr(LIGHT[a], LIGHT[b]), cr(DARK[a], DARK[b])
            ok = lv >= need and dv >= need
            fail += not ok
            rows.append(f"| --{a} on --{b} | {kind} {need}:1 | {lv:.2f} | {dv:.2f} | {'pass' if ok else 'FAIL'} |")
    for (b,) in PLATE:
        lv = max(cr(LIGHT["mark"], LIGHT[b]), cr(LIGHT["mark-ink"], LIGHT[b]))
        dv = max(cr(DARK["mark"], DARK[b]), cr(DARK["mark-ink"], DARK[b]))
        ok = lv >= 3 and dv >= 3
        fail += not ok
        rows.append(f"| key plate edge on --{b} (fill or rim) | graphic 3.0:1 | {lv:.2f} | {dv:.2f} | {'pass' if ok else 'FAIL'} |")
    print("| Pair | Need | Light | Dark | Result |\n|---|---|---|---|---|")
    print("\n".join(rows))
    for T, n in ((LIGHT, 'light'), (DARK, 'dark')):
        for s in ("good", "warn", "bad"):
            for r in ("accent", "mark"):
                if T[s].lower() == T[r].lower():
                    print("ROLE CLASH", n, s, r)
                    fail += 1
    print(f"\nColor-vision check: minimum CIE76 dE between members, normal / protanopia / deuteranopia / tritanopia (need >= {NEED_DE})\n")
    print("| Set | Theme | Normal | Protanopia | Deuteranopia | Tritanopia | Result |\n|---|---|---|---|---|---|---|")
    for sname, keys in SETS.items():
        for n, T in (("light", LIGHT), ("dark", DARK)):
            mins = []
            for kind in (None, "protan", "deutan", "tritan"):
                L = [lab(T[k], kind) for k in keys]
                mins.append(min(math.dist(L[i], L[j]) for i in range(len(L)) for j in range(i + 1, len(L))))
            ok = min(mins) >= NEED_DE
            fail += not ok
            print(f"| {sname} | {n} | {mins[0]:.1f} | {mins[1]:.1f} | {mins[2]:.1f} | {mins[3]:.1f} | {'pass' if ok else 'FAIL'} |")
    print("\nFAILURES:", fail)
    sys.exit(1 if fail else 0)


if __name__ == '__main__':
    main()
