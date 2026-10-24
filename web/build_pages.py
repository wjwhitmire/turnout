"""Build the browser app.

1. web/app.html: the standalone page (no doctype, html, head or body tags). It starts with
   <title>, then the fonts stylesheet, then <style>, then the body markup and two scripts: the
   core (web/src/core/*.js in name order) and the interface (web/src/ui/*.js in name order).
2. docs/index.html: app.html wrapped as a full HTML document for GitHub Pages, with a
   Content-Security-Policy that allows only the host behind the PDF switch, a PWA manifest and a
   service worker that caches the app shell. The fonts stylesheet is replaced by the three
   self-hosted font files, so the page makes no request to another host until a switch is
   turned on. A framing guard keeps the app from starting inside another site's frame.

Run: python web/build_pages.py
"""

import base64
import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "web" / "src"
APP = ROOT / "web" / "app.html"
DOCS = ROOT / "docs"
sys.path.insert(0, str(ROOT / "src"))
from fieldservice.brand import PRODUCT_NAME  # noqa: E402


def read(p):
    return p.read_text(encoding="utf-8")


def joined(folder):
    return "\n".join(f"// ---- {p.parent.name}/{p.name}\n" + read(p) for p in sorted(folder.glob("*.js")))


def build_app():
    core = joined(SRC / "core")
    ui = joined(SRC / "ui").replace("/*ICONS*/", read(SRC / "icons.json").strip())
    if '"' + JSPDF_URL + '"' not in ui:
        raise SystemExit("the jsPDF address in web/src/ui/80_net.js does not match JSPDF_URL in this file")
    for name, js in (("core", core), ("ui", ui)):
        if "</script" in js:
            raise SystemExit(f"the {name} script contains '</script'; it would end the block early")
    t = read(SRC / "app.template.html").replace("{{PRODUCT}}", PRODUCT_NAME)
    for key, val in (("/*STYLE*/", read(SRC / "style.css")), ("<!--BODY-->", read(SRC / "body.html")), ("/*CORE*/", core),
                     ("/*UI*/", ui)):
        t = t.replace(key, val.rstrip("\n"))
    APP.write_text(t, encoding="utf-8")
    return t


JSPDF_URL = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/4.2.1/jspdf.umd.min.js"
CSP = ("default-src 'none'; script-src {SCRIPT_HASHES} " + JSPDF_URL + "; connect-src 'self'; worker-src 'self'; "
       "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; manifest-src 'self'; "
       "frame-src 'self'; form-action 'none'; base-uri 'none'; object-src 'none'")

HEAD = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="{CSP}">
<meta name="referrer" content="no-referrer">
<meta name="description" content="Free, local-first field service office: requests, quotes, jobs, schedule and dispatch, crews, invoices and reports. Runs on your device.">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#1b1d20" media="(prefers-color-scheme: dark)">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="icon-192.png">
"""

# Framing guard: a page that another site puts in a frame could be used to trick clicks (for example
# on Delete all data), and GitHub Pages cannot send a header that forbids framing. When framed, the
# page hides its markup, the interface does not start, and a short notice links to the app in its
# own tab. The script is covered by the Content-Security-Policy hash like the others.
FRAME_GUARD = """<script>
(function () {
  var framed = true;
  try { framed = window.top !== window.self; } catch (e) { framed = true; }
  if (!framed) return;
  document.documentElement.setAttribute("data-framed", "");
  document.addEventListener("DOMContentLoaded", function () {
    var box = document.createElement("div");
    box.id = "framed";
    var h = document.createElement("h1");
    h.textContent = "This page is shown inside another site.";
    var p = document.createElement("p");
    p.textContent = "For your safety {{PRODUCT}} only runs in its own tab.";
    var a = document.createElement("a");
    a.href = location.href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = "Open {{PRODUCT}} in its own tab";
    box.appendChild(h); box.appendChild(p); box.appendChild(a);
    document.body.insertBefore(box, document.body.firstChild);
  });
})();
</script>
<style>html[data-framed] body > :not(#framed){display:none!important}#framed{padding:24px max(16px,env(safe-area-inset-left,0px));font:400 1rem/1.5 system-ui,sans-serif}#framed h1{font-size:1.25rem;margin:0 0 8px}</style>
""".replace("{{PRODUCT}}", PRODUCT_NAME)

SW_REG = """<script>
if ("serviceWorker" in navigator && location.protocol === "https:") {
  try { navigator.serviceWorker.register("sw.js").catch(function () {}); } catch (e) {}
}
</script>
"""


FONT_FACES = """<style>
@font-face{font-family:"Sofia Sans Condensed";src:url(fonts/sofia-sans-condensed-latin-wght-normal.woff2) format("woff2");font-weight:600 800;font-display:swap}
@font-face{font-family:"Sofia Sans";src:url(fonts/sofia-sans-latin-wght-normal.woff2) format("woff2");font-weight:400 700;font-display:swap}
@font-face{font-family:"Reddit Mono";src:url(fonts/reddit-mono-latin-wght-normal.woff2) format("woff2");font-weight:400 600;font-display:swap}
</style>
"""


def build_docs(app):
    app = re.sub(r'<link rel="stylesheet" href="https://fonts.googleapis.com[^>]*>\n?', FONT_FACES, app, count=1)
    app = app.replace('<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n', "", 1)
    style_end = app.index("</style>", app.index("--bg:")) + len("</style>")
    doc = HEAD + FRAME_GUARD + app[:style_end] + "\n</head>\n<body>\n" + app[style_end:].lstrip("\n") + "\n" + SW_REG + "</body>\n</html>\n"
    hashes = []
    for m in re.finditer(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", doc, re.S):
        h = "'sha256-" + base64.b64encode(hashlib.sha256(m.group(1).encode("utf-8")).digest()).decode() + "'"
        if h not in hashes:
            hashes.append(h)
    doc = doc.replace("{CSP}", CSP.replace("{SCRIPT_HASHES}", " ".join(hashes)), 1)
    DOCS.mkdir(exist_ok=True)
    (DOCS / "index.html").write_text(doc, encoding="utf-8")
    for src in sorted((SRC / "pwa").rglob("*")):
        if src.is_file():
            dst = DOCS / src.relative_to(SRC / "pwa")
            dst.parent.mkdir(parents=True, exist_ok=True)
            dst.write_bytes(src.read_bytes())
    man = (DOCS / "manifest.webmanifest")
    man.write_text(man.read_text(encoding="utf-8").replace("{{PRODUCT}}", PRODUCT_NAME), encoding="utf-8")
    shell = hashlib.sha256(doc.encode("utf-8"))
    for p in sorted(DOCS.rglob("*")):
        if p.is_file() and p.name not in ("sw.js", "index.html"):
            shell.update(p.read_bytes())
    sw = DOCS / "sw.js"
    sw.write_text(sw.read_text(encoding="utf-8").replace('"shell-v1"', '"shell-' + shell.hexdigest()[:12] + '"'),
                  encoding="utf-8")
    return DOCS / "index.html"


if __name__ == "__main__":
    a = build_app()
    out = build_docs(a)
    print(f"wrote {APP.relative_to(ROOT)} ({APP.stat().st_size:,} bytes) and {out.relative_to(ROOT)}")
