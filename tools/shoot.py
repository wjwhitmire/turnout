"""Screenshot every page of the Pages build at 400 and 1280 px in light and dark.

    python3 web/build_pages.py && python3 tools/shoot.py

Writes PNGs to shots/ (not committed) and prints, per shot, any problem found: sideways scroll,
a control smaller than 44 px, a web font that did not load, a request to another host, or a
script error. Exits 1 when any problem is found.
"""

import functools
import http.server
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
OUT = ROOT / "shots"

PAGES = ["home", "schedule", "schedule:week", "schedule:month", "schedule:route", "clients", "client", "requests", "request",
         "quotes", "quote", "quote-editor", "jobs", "job", "visit", "invoices", "invoice", "timesheets", "reminders",
         "automations", "reports", "packets", "crew", "settings", "create"]

SMALL = """() => {
  const bad = [];
  const sel = 'button, a.btn, a.nav-a, a.rowlink, a.crumb, a.link, .pill, .seg button, input:not([type=checkbox]):not([type=radio]):not(.sr), select';
  for (const e of document.querySelectorAll(sel)) {
    if (e.closest('.sr, [hidden], .tc, .sw, .ghost, .foot details:not([open]) ul')) continue;
    if (e.classList.contains('sw')) continue;
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const st = getComputedStyle(e);
    if (st.visibility === 'hidden' || st.display === 'none') continue;
    if (r.height < 43.5 || r.width < 43.5) bad.push((e.id || e.className || e.tagName) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  }
  return bad.slice(0, 8);
}"""


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def serve():
    h = functools.partial(Quiet, directory=str(DOCS))
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_address[1]}"


def go(page, h):
    page.evaluate(f"location.hash = '#{h}'")
    page.wait_for_timeout(150)


def show(page, name):
    page.evaluate("document.querySelectorAll('dialog').forEach((d) => { d.close(); d.remove(); }); document.getElementById('toasts').textContent = ''")
    base, _, view = name.partition(":")
    if base == "schedule":
        go(page, "schedule")
        page.locator("#sched-view button", has_text=(view or "day").title()).click()
        if not view:
            page.click("#sched-today")
    elif base in ("client", "request", "job"):
        go(page, base + "s")
        page.locator("main tr.click").first.click()
    elif base == "quote":
        go(page, "quotes")
        page.locator(".pill", has_text="Awaiting response").click()
        page.locator("main tr.click").first.click()
    elif base == "invoice":
        go(page, "invoices")
        page.locator(".pill", has_text="Past due").click()
        page.locator("main tr.click").first.click()
    elif base == "quote-editor":
        go(page, "quotes")
        page.locator(".pill", has_text="Draft").click()
        page.locator("main tr.click").first.click()
        page.click("#edit-quote")
    elif base == "visit":
        go(page, "home")
        page.locator(".vrow.s-prog").first.click()
    elif base == "create":
        go(page, "home")
        page.click("#create-btn")
    else:
        go(page, base)
    page.wait_for_timeout(250)


def load_packet(page, tmp):
    go(page, "packets")
    page.select_option("#pk-crew", "m-dana")
    page.fill("#pk-from", "2026-10-22")
    page.fill("#pk-to", "2026-10-28")
    with page.expect_download() as d:
        page.click("#pk-save")
    d.value.save_as(tmp)
    go(page, "crew")
    with page.expect_file_chooser() as fc:
        page.click("#crew-open")
    fc.value.set_files(tmp)
    page.wait_for_selector("#crew-send")


def main():
    OUT.mkdir(exist_ok=True)
    srv, origin = serve()
    url = origin + "/index.html?asof=2026-10-22"
    problems = 0
    with sync_playwright() as p:
        b = p.chromium.launch()
        for scheme in ("light", "dark"):
            for width in (400, 1280):
                ctx = b.new_context(viewport={"width": width, "height": 900}, color_scheme=scheme, accept_downloads=True)
                page = ctx.new_page()
                errors, foreign = [], []
                page.on("pageerror", lambda e: errors.append(str(e)))
                page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
                page.on("request", lambda r: foreign.append(r.url) if not r.url.startswith(origin) else None)
                page.add_init_script("delete window.showSaveFilePicker")
                page.goto(url)
                page.wait_for_selector("body[data-ready='1']")
                # a packet for the crew view
                load_packet(page, str(OUT / "packet.json"))
                page.evaluate("document.fonts.ready")
                for name in PAGES:
                    show(page, name)
                    tag = name.replace(":", "-")
                    path = OUT / f"{tag}-{width}-{scheme}.png"
                    full = not page.locator("dialog[open]").count()
                    page.screenshot(path=str(path), full_page=full)
                    issues = []
                    sw = page.evaluate("document.documentElement.scrollWidth")
                    if sw > width:
                        issues.append(f"scrollWidth {sw}")
                    small = page.evaluate(SMALL)
                    if small:
                        issues.append("small: " + ", ".join(small))
                    fonts = page.evaluate("[...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family).join(',')")
                    for fam in ("Sofia Sans Condensed", "Sofia Sans", "Reddit Mono"):
                        if fam not in fonts:
                            issues.append("font not loaded: " + fam)
                    if errors:
                        issues.append("errors: " + "; ".join(errors[:3]))
                        errors.clear()
                    if issues:
                        problems += 1
                        print(path.name, " | ".join(issues))
                if width == 400:
                    show(page, "home")
                    page.click("#menu-btn")
                    page.wait_for_timeout(200)
                    page.screenshot(path=str(OUT / f"drawer-{width}-{scheme}.png"))
                (OUT / "packet.json").unlink(missing_ok=True)
                if foreign:
                    problems += 1
                    print("foreign requests:", foreign[:5])
                ctx.close()
        b.close()
    srv.shutdown()
    print(f"{problems} shots with problems; files in {OUT}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
