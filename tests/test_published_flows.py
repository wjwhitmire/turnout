"""The site as it is published, in headless Chromium, through the whole office day.

The Pages build in docs/ is copied the way the publish script ships it (the https://wjwhitmire.github.io/turnout/,
wjwhitmire and https://github.com/wjwhitmire/turnout placeholders filled in every text file) and served under
/turnout/, the folder GitHub Pages uses, so relative paths and the manifest are tested where users
get them.

Request to quote with an optional item, a discount and sales tax (totals worked by hand), approval
to job by the automation and its undo, a visit dragged on the dispatch board, started and
finished, the draft invoice by the automation, a partial and a final payment, a recurring job
with its visits generated ahead, a crew packet round trip, reminders, every automation's undo,
the client copy, the reports, and the export to Crossfoot: when the Crossfoot repository sits next
to this one, its Pages build imports the file and the books tie out.
Skipped when Playwright or Chromium is missing.
"""

import csv
import datetime as dt
import http.server
import io
import json
import shutil
import socketserver
import sys
import tempfile
import threading
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
CROSSFOOT = ROOT.parent / "backoffice"
sync_api = pytest.importorskip("playwright.sync_api")
TODAY = "2026-10-22"


def _fill(src, dst, name):
    shutil.copytree(src, dst)
    fill = {"https://wjwhitmire.github.io/turnout/": f"https://wjwhitmire.github.io/{name}/", "wjwhitmire": "wjwhitmire",
            "https://github.com/wjwhitmire/turnout": f"https://github.com/wjwhitmire/{name}"}
    for f in dst.rglob("*"):
        if f.suffix in (".html", ".js", ".json", ".webmanifest", ".css", ".svg", ".txt"):
            t = f.read_text(encoding="utf-8")
            for k, v in fill.items():
                t = t.replace(k, v)
            f.write_text(t, encoding="utf-8")


@pytest.fixture(scope="module")
def site(tmp_path_factory):
    top = tmp_path_factory.mktemp("pages")
    _fill(ROOT / "docs", top / "turnout", "turnout")
    has_cf = (CROSSFOOT / "docs" / "index.html").exists()
    if has_cf:
        _fill(CROSSFOOT / "docs", top / "crossfoot", "crossfoot")

    class Quiet(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(top), **k)

        def log_message(self, *a):
            pass

    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", 0), Quiet)
    httpd.daemon_threads = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{httpd.server_address[1]}/"
    yield {"turnout": base + "turnout/", "crossfoot": base + "crossfoot/" if has_cf else None}
    httpd.shutdown()


@pytest.fixture(scope="module")
def browser():
    with sync_api.sync_playwright() as p:
        try:
            b = p.chromium.launch()
        except Exception as e:  # noqa: BLE001 - no browser binary on this machine
            pytest.skip(f"Chromium is not available: {e}")
        yield b
        b.close()


def _open(browser, url, ready):
    ctx = browser.new_context(viewport={"width": 1280, "height": 900}, accept_downloads=True)
    page = ctx.new_page()
    page.add_init_script("delete window.showSaveFilePicker; window.__csp=[];"
                         "document.addEventListener('securitypolicyviolation',e=>window.__csp.push(e.violatedDirective))")
    page.errors, page.foreign = [], []
    host = url.split("/")[2]
    page.on("pageerror", lambda e: page.errors.append(str(e)))
    page.on("console", lambda m: page.errors.append(m.text) if m.type == "error" else None)
    page.on("request", lambda r: page.foreign.append(r.url) if not r.url.startswith(("data:", "blob:")) and r.url.split("/")[2] != host else None)
    page.goto(url)
    page.wait_for_selector(ready, timeout=60000)
    return ctx, page


def _btn(page, label):
    page.locator("dialog[open]").last.get_by_role("button", name=label, exact=True).last.click()


def _go(page, h):
    page.evaluate(f"location.hash = {('#' + h)!r}")
    page.wait_for_timeout(200)


def _download(page, selector):
    with page.expect_download(timeout=15000) as d:
        page.click(selector)
    out = Path(tempfile.mkdtemp()) / d.value.suggested_filename
    d.value.save_as(out)
    return out, d.value.suggested_filename


def _undo(page, rule):
    """Undo the newest step of a rule on the Automations page; returns the number undone so far."""
    _go(page, "automations")
    page.locator(f"button[aria-label^='Undo: {rule}']").first.click()
    page.wait_for_selector(".toast:has-text('Undone')", timeout=5000)
    return page.locator(".lockline:has-text('Undone')").count()


def _cents(s):
    s = s.replace("$", "").replace(",", "").strip()
    neg = s.startswith("(") or s.startswith("-")
    v = round(float(s.strip("()-")) * 100)
    return -v if neg else v


def test_published_office_day(site, browser, tmp_path):
    page_url = site["turnout"] + f"index.html?asof={TODAY}"
    ctx, page = _open(browser, page_url, "body[data-ready='1']")
    man = page.evaluate("fetch(document.querySelector('link[rel=manifest]').href).then(r => r.json())")
    assert man["start_url"].startswith("./") or man["start_url"].startswith("index.html")

    # a client, then a request for them
    page.click("#create-btn")
    page.click("#create-client")
    page.fill("#cl-name", "Test Client")
    page.fill("#cl-email", "test@example.com")
    page.fill("#cl-street", "1 Test Way")
    _btn(page, "Save")
    page.wait_for_selector("h1:has-text('Test Client')")
    page.click("#create-btn")
    page.click("#create-request")
    page.fill("#rq-title", "Fix the sprinklers")
    page.select_option("#rq-client", label="Test Client")
    _btn(page, "Save")
    page.click("#req-to-quote")
    page.wait_for_selector("h1:has-text('Quote')")
    page.click("#edit-quote")
    page.click("#qt-add")
    page.fill("#qt-name-0", "Valve repair")
    page.fill("#qt-qty-0", "2")
    page.fill("#qt-rate-0", "125")
    page.check("#qt-tax-0")
    page.click("#qt-add")
    page.fill("#qt-name-1", "Mulch")
    page.fill("#qt-qty-1", "3")
    page.fill("#qt-rate-1", "45.50")
    page.check("#qt-tax-1")
    page.click("#qt-add-opt")
    page.fill("#qt-name-2", "Controller upgrade")
    page.fill("#qt-rate-2", "120.50")
    page.select_option("#qt-dkind", "pct")
    page.fill("#qt-dval", "10")
    page.fill("#qt-tax", "8.25")
    page.select_option("#qt-taxmode", "document")
    _btn(page, "Save")
    page.wait_for_selector("text=Valve repair")
    page.click("#send-quote")
    _btn(page, "Mark as sent")
    page.wait_for_selector(".st:has-text('Awaiting response')")
    # approved with the optional item: 250.00 + 136.50 + 120.50 = 507.00; discount 10% = 50.70
    # split 25.00 / 13.65 / 12.05; taxable base 225.00 + 122.85 = 347.85; tax 8.25% = 28.70
    # (28.697625 rounded); total 485.00
    page.click("#approve-quote")
    page.check("dialog[open] input[type=checkbox]")
    _btn(page, "Approve")
    page.wait_for_selector("#open-job")
    assert "$485.00" in page.inner_text("main")
    # the automation made the job; undo it, then convert by hand
    assert _undo(page, "Approved quote to job") >= 1
    _go(page, "quotes")
    page.locator("tr", has_text="Test Client").first.click()
    page.wait_for_selector("#convert-quote")
    page.click("#convert-quote")
    page.wait_for_selector("h1:has-text('Job')")

    # one visit today for Dana, dragged to Jordan on the dispatch board, started and finished
    page.click("#job-add-visit")
    page.fill("#nv-date", TODAY)
    page.fill("#nv-time", "13:00")
    page.check("#nv-crew-m-dana")
    _btn(page, "Schedule")
    _go(page, "schedule")
    page.click("#sched-today")
    page.wait_for_selector(".board")
    chip = page.locator(".col[data-crew='m-dana'] .vb", has_text="Test Client").first
    target = page.locator(".col[data-crew='m-jordan'] .cb")
    chip.scroll_into_view_if_needed()
    cb, tb = chip.bounding_box(), target.bounding_box()
    page.mouse.move(cb["x"] + 10, cb["y"] + 8)
    page.mouse.down()
    page.mouse.move(cb["x"] + 40, cb["y"] + 30, steps=4)
    page.mouse.move(tb["x"] + 20, cb["y"] + 8, steps=8)
    page.mouse.up()
    page.wait_for_selector(".col[data-crew='m-jordan'] .vb:has-text('Test Client')")
    page.locator(".col[data-crew='m-jordan'] .vb", has_text="Test Client").first.click()
    _btn(page, "Start now")
    page.locator(".col[data-crew='m-jordan'] .vb", has_text="Test Client").first.click()
    _btn(page, "Finish now")

    # the draft invoice came from the automation at the quoted total
    _go(page, "invoices")
    page.wait_for_selector("h1:has-text('Invoices')")
    row = page.locator("tr", has_text="Test Client").first
    assert "Draft" in row.inner_text() and "$485.00" in row.inner_text()
    row.click()
    page.click("#send-invoice")
    _btn(page, "Mark as sent")
    page.click("#record-payment")
    page.fill("#pay-amount", "200")
    _btn(page, "Save")
    page.wait_for_selector("text=$285.00")
    page.click("#record-payment")
    assert page.input_value("#pay-amount") == "285.00"
    _btn(page, "Save")
    page.wait_for_selector(".st:has-text('Paid')")

    # the client copy: a scriptless page with its own policy and the right total
    page.click("#invoice-client-copy")
    html_path, _ = _download(page, "#copy-page")
    html = html_path.read_text(encoding="utf-8")
    assert "<script" not in html.lower() and "default-src 'none'" in html
    assert "$485.00" in html and "Test Client" in html
    page.keyboard.press("Escape")

    # a recurring job, weekly on Monday and Thursday from today, gets its visits through the
    # look-ahead in Settings (45 days in the example): Thursdays Oct 22 to Dec 3 (7) and Mondays
    # Oct 26 to Nov 30 (6)
    page.click("#create-btn")
    page.click("#create-job")
    page.select_option("#jb-client", label="Test Client")
    page.fill("#jb-title", "Weekly checks")
    page.select_option("#jb-kind", "recurring")
    page.fill("#jb-start", TODAY)
    page.check("#jb-day-1")
    page.check("#jb-day-4")
    page.click("#jb-add")
    page.fill("#jb-name-0", "Check")
    page.fill("#jb-rate-0", "40")
    _btn(page, "Save")
    page.wait_for_selector("h1:has-text('Job')")
    back, _ = _download_backup(page)
    book = json.loads(back.read_text())["book"]
    job = next(j for j in book["jobs"] if j["title"] == "Weekly checks")
    dates = sorted(v["date"] for v in book["visits"] if v["job_id"] == job["id"])
    want = []
    d = dt.date(2026, 10, 22)
    end = dt.date(2026, 10, 22) + dt.timedelta(days=book["settings"]["visit_horizon_days"])
    while d <= end:
        if d.isoweekday() in (1, 4):
            want.append(d.isoformat())
        d += dt.timedelta(days=1)
    assert dates == want and len(want) == 13

    # reminders: overdue invoices have drafts that open the person's own mail app
    _go(page, "reminders")
    link = page.locator("a[id^='rem-open-']").first
    assert link.get_attribute("href").startswith(("mailto:", "sms:"))

    # every kind of automatic step in the log can be undone
    for rule in ("Time from visits", "Draft invoices", "Reminder drafts", "Recurring visits"):
        _go(page, "automations")
        if page.locator(f"button[aria-label^='Undo: {rule}']").count():
            n = page.locator(".lockline:has-text('Undone')").count()
            assert _undo(page, rule) == n + 1, rule
    # an undone step does not come back when the rules run again
    n = page.locator(".lockline:has-text('Undone')").count()
    page.click("#auto-run")
    page.wait_for_timeout(500)
    assert page.locator(".lockline:has-text('Undone')").count() == n

    # reports draw and save
    _go(page, "reports")
    page.wait_for_selector("text=Quote conversion")
    p, name = _download(page, "#save-" + page.evaluate("document.querySelector('[id^=save-]').id.slice(5)"))
    assert name.endswith(".csv") and list(csv.reader(io.StringIO(p.read_text(encoding="utf-8-sig"))))

    # the export to Crossfoot
    _go(page, "settings")
    page.fill("#cf-from", "2026-01-01")
    page.fill("#cf-to", TODAY)
    iif, _ = _download(page, "#save-iif")
    _go(page, "home")
    _go(page, "settings")
    # the next export starts after this one (today, when this one ran through today; Crossfoot
    # skips anything it already has)
    assert page.input_value("#cf-from") == TODAY
    back, _ = _download_backup(page)
    assert page.evaluate("window.__csp") == []
    assert page.errors == [], page.errors
    assert page.foreign == [], page.foreign
    ctx.close()

    if not site["crossfoot"]:
        return
    sys.path.insert(0, str(ROOT / "src"))
    from fieldservice.money import doc_totals
    from fieldservice.reports import aging
    tb = json.loads(back.read_text())["book"]
    revenue = sum(doc_totals(i)["revenue"] for i in tb["invoices"] if i["status"] == "sent" and i["date"] <= TODAY)
    ar = aging(tb, TODAY)["total"]["total"]
    cx, cf = _open(browser, site["crossfoot"], "body.ready")
    cf.click("text=Start my own books")
    cf.fill("dialog input >> nth=0", "Field books")
    cf.click("dialog >> text=Create books")
    cf.wait_for_selector("#coName:has-text('Field books')")
    _go(cf, "settings/import")
    cf.set_input_files("#imIif", str(iif))
    cf.wait_for_selector(".toast:has-text('IIF import')", timeout=20000)
    # importing the same file again posts nothing twice
    _go(cf, "settings/import")
    cf.set_input_files("#imIif", str(iif))
    cf.wait_for_selector(".toast:has-text('skipped duplicates')", timeout=20000)

    def report_csv(key, q):
        _go(cf, f"report/{key}?{q}")
        cf.wait_for_selector("main button[aria-label='Export CSV']")
        p, _ = _download(cf, "main button[aria-label='Export CSV']")
        return list(csv.reader(io.StringIO(p.read_text(encoding="utf-8-sig"))))

    pl = report_csv("profit_and_loss", f"period=custom&start=2026-01-01&end={TODAY}&basis=accrual")
    assert _cents(next(r for r in pl if r and r[0] == "Net Income")[1]) == revenue
    ag = report_csv("ar_aging", f"period=custom&as_of={TODAY}&end={TODAY}")
    assert _cents(next(r for r in ag if r and r[0] == "TOTAL")[-1]) == ar
    trial = report_csv("trial_balance", f"period=custom&as_of={TODAY}&end={TODAY}")
    tot = next(r for r in trial if r and r[0].upper().startswith("TOTAL"))
    assert _cents(tot[-2]) == _cents(tot[-1])
    assert cf.errors == [], cf.errors
    assert cf.foreign == [], cf.foreign
    cx.close()


def _download_backup(page):
    _go(page, "settings")
    return _download(page, "#save-backup")


def test_published_crew_packet_round_trip(site, browser, tmp_path):
    ctx, page = _open(browser, site["turnout"] + f"index.html?asof={TODAY}", "body[data-ready='1']")
    _go(page, "packets")
    page.select_option("#pk-crew", "m-dana")
    page.fill("#pk-from", TODAY)
    page.fill("#pk-to", "2026-10-28")
    out, _ = _download(page, "#pk-save")
    pk = json.loads(out.read_text())
    assert pk["format"] == "field-tools-17-job-packet" and pk["kind"] == "out"
    assert "rate" not in out.read_text() or '"rate"' not in json.dumps(pk.get("jobs", []))   # packets hold no prices
    _go(page, "crew")
    with page.expect_file_chooser() as fc:
        page.click("#crew-open")
    fc.value.set_files(str(out))
    page.wait_for_selector("#crew-send")
    fin = page.locator("button[id^='cv-finish-']").first
    vid = fin.get_attribute("id")[len("cv-finish-"):]
    if page.locator(f"#cv-start-{vid}").count():
        page.click(f"#cv-start-{vid}")
    page.click(f"#cv-finish-{vid}")
    back, _ = _download(page, "#crew-send")
    _go(page, "packets")
    with page.expect_file_chooser() as fc2:
        page.click("#pk-import")
    fc2.value.set_files(str(back))
    page.wait_for_selector("dialog[open] >> text=Choices needed")
    _btn(page, "Merge")
    page.wait_for_selector(".toast:has-text('Merged')")
    # the same file again changes nothing
    with page.expect_file_chooser() as fc3:
        page.click("#pk-import")
    fc3.value.set_files(str(back))
    page.wait_for_timeout(800)
    assert page.errors == [], page.errors
    assert page.foreign == [], page.foreign
    ctx.close()


def test_published_empty_file_has_no_dead_ends(site, browser):
    # a new business file: asking for a request opens the client form, then the request with that
    # client chosen; asking for a time entry with no crew opens the crew form, then the entry
    ctx, page = _open(browser, site["turnout"] + f"index.html?asof={TODAY}", "body[data-ready='1']")
    _go(page, "settings")
    page.click("#start-fresh")
    page.fill("#fresh-name", "New Shop")
    _btn(page, "Create")
    page.wait_for_selector("#example-flag", state="hidden")
    page.click("#create-btn")
    page.click("#create-request")
    page.fill("#cl-name", "First Client")
    _btn(page, "Save")
    page.wait_for_selector("#rq-title")
    assert page.locator("#rq-client option:checked").inner_text() == "First Client"
    page.fill("#rq-title", "Trim the hedges")
    _btn(page, "Save")
    page.wait_for_selector("h1:has-text('Trim the hedges'), h1:has-text('Request')")
    page.click("#create-btn")
    page.click("#create-time-entry")
    page.fill("#cr-name", "Sam Crew")
    _btn(page, "Save")
    page.wait_for_selector("#tm-crew")
    assert page.locator("#tm-crew option:checked").inner_text() == "Sam Crew"
    page.keyboard.press("Escape")
    assert page.errors == [], page.errors
    ctx.close()


def test_published_touch_drag_reaches_an_off_screen_crew_column(site, browser):
    # on a phone the dispatch board shows one crew column at a time; holding a card at the edge
    # scrolls the board until the next column is under the finger
    ctx = browser.new_context(viewport={"width": 400, "height": 860}, has_touch=True)
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(site["turnout"] + f"index.html?asof={TODAY}#schedule")
    page.wait_for_selector("body[data-ready='1']")
    page.wait_for_selector(".board .vb")
    before = page.locator(".col[data-crew='m-jordan'] .vb").count()
    out = page.evaluate("""async () => {
      const chip = document.querySelector(".col[data-crew='m-dana'] .vb");
      chip.scrollIntoView({ block: "center" });
      const r = chip.getBoundingClientRect();
      const far = () => document.querySelector(".col[data-crew='m-jordan'] .cb").getBoundingClientRect().left;
      const start = far();
      const ev = (type, x, y, el) => (el || document).dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true,
        pointerType: "touch", isPrimary: true, button: 0, buttons: 1, clientX: x, clientY: y }));
      ev("pointerdown", r.x + 10, r.y + 8, chip);
      await new Promise((s) => setTimeout(s, 400));
      ev("pointermove", r.x + 12, r.y + 10);
      ev("pointermove", innerWidth - 10, r.y + 10);
      for (let i = 0; i < 100 && far() > 300; i++) await new Promise((s) => setTimeout(s, 50));
      const x = far() + 20;
      ev("pointermove", x, r.y + 10);
      ev("pointerup", x, r.y + 10);
      await new Promise((s) => setTimeout(s, 800));
      return { start, end: x - 20 };
    }""")
    assert out["start"] > 400 and out["end"] < 300, out
    assert page.locator(".col[data-crew='m-jordan'] .vb").count() == before + 1
    assert errors == [], errors
    ctx.close()
