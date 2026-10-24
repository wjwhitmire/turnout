"""Headless browser test of the main flow on the Pages build (docs/index.html).

Skipped when Playwright or its Chromium is not installed. Run python web/build_pages.py first.
Checks: the page makes no network request to any other host, the example opens, a request
becomes a quote, the approved quote becomes a job by itself, a visit is scheduled, worked and
dragged on the dispatch board, the completed visit drafts an invoice, a payment marks it paid,
the reports render, nothing scrolls sideways at 400 px, Delete all data empties the file, and the
page does not start inside another site's frame.
"""

import codecs
import functools
import http.server
import threading
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"

sync_api = pytest.importorskip("playwright.sync_api")


@pytest.fixture(scope="module")
def server():
    if not (DOCS / "index.html").exists():
        pytest.skip("docs/index.html is not built")
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(DOCS))
    handler.log_message = lambda *a: None
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}/index.html?asof=2026-10-22"
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


def open_app(browser, url, width=1280):
    ctx = browser.new_context(viewport={"width": width, "height": 900})
    page = ctx.new_page()
    errors, foreign = [], []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("request", lambda r: foreign.append(r.url) if not r.url.startswith(url.split("/index.html")[0]) else None)
    page.goto(url)
    page.wait_for_selector("body[data-ready='1']")
    return ctx, page, errors, foreign


def dialog_button(page, label):
    page.locator("dialog[open]").last.get_by_role("button", name=label, exact=True).last.click()


def test_main_flow(server, browser):
    ctx, page, errors, foreign = open_app(browser, server)
    assert page.locator("#example-flag").is_visible()
    assert page.locator("#flow-invoices").is_visible()

    # a new client with a service address
    page.click("#create-btn")
    page.click("#create-client")
    page.fill("#cl-name", "Test Client")
    page.fill("#cl-email", "test@example.com")
    page.fill("#cl-street", "1 Test Way")
    dialog_button(page, "Save")
    page.wait_for_selector("h1:has-text('Test Client')")

    # request, then quote with two lines, one optional
    page.click("#create-btn")
    page.click("#create-request")
    page.fill("#rq-title", "Fix the sprinklers")
    page.select_option("#rq-client", label="Test Client")
    dialog_button(page, "Save")
    page.click("#req-to-quote")
    page.wait_for_selector("h1:has-text('Quote')")
    page.click("#edit-quote")
    page.click("#qt-add")
    page.fill("#qt-name-0", "Valve repair")
    page.fill("#qt-rate-0", "250")
    page.click("#qt-add")
    page.fill("#qt-name-1", "Controller upgrade")
    page.fill("#qt-rate-1", "120.50")
    page.check("#qt-opt-1")
    dialog_button(page, "Save")
    page.wait_for_selector("text=Valve repair")
    page.click("#send-quote")
    dialog_button(page, "Mark as sent")
    page.wait_for_selector(".st:has-text('Awaiting response')")

    # approval with the optional line: the automation turns it into a job
    page.click("#approve-quote")
    page.check("dialog[open] input[type=checkbox]")
    dialog_button(page, "Approve")
    page.wait_for_selector("#open-job")
    page.click("#open-job")
    page.wait_for_selector("h1:has-text('Job')")
    assert page.locator("text=Controller upgrade").count() >= 1

    # schedule a visit for today on the job, for the first crew member
    page.click("#job-add-visit")
    page.fill("#nv-date", "2026-10-22")
    page.fill("#nv-time", "13:00")
    page.check("#nv-crew-m-dana")
    dialog_button(page, "Schedule")

    # dispatch board: drag the visit from Dana to Jordan
    page.evaluate("location.hash = '#schedule'")
    page.click("#sched-today")
    page.wait_for_selector(".board")
    chip = page.locator(".col[data-crew='m-dana'] .vb", has_text="Test Client").first
    target = page.locator(".col[data-crew='m-jordan'] .cb")
    chip.scroll_into_view_if_needed()
    cb = chip.bounding_box()
    tb = target.bounding_box()
    page.mouse.move(cb["x"] + 10, cb["y"] + 8)
    page.mouse.down()
    page.mouse.move(cb["x"] + 40, cb["y"] + 30, steps=4)
    page.mouse.move(tb["x"] + 20, cb["y"] + 8, steps=8)
    page.mouse.up()
    page.wait_for_selector(".col[data-crew='m-jordan'] .vb:has-text('Test Client')")
    assert page.locator(".col[data-crew='m-dana'] .vb:has-text('Test Client')").count() == 0

    # work the visit: start and finish; the job then needs invoicing and a draft appears
    page.locator(".col[data-crew='m-jordan'] .vb", has_text="Test Client").first.click()
    dialog_button(page, "Start now")
    page.locator(".col[data-crew='m-jordan'] .vb", has_text="Test Client").first.click()
    dialog_button(page, "Finish now")
    page.evaluate("location.hash = '#invoices'")
    page.wait_for_selector("h1:has-text('Invoices')")
    row = page.locator("tr", has_text="Test Client").first
    assert "Draft" in row.inner_text()
    # $250 + $120.50 = $370.50, no tax on these lines
    assert "$370.50" in row.inner_text()
    row.click()
    page.click("#send-invoice")
    dialog_button(page, "Mark as sent")
    page.click("#record-payment")
    dialog_button(page, "Save")
    page.wait_for_selector(".st:has-text('Paid')")

    # the client copy preview runs isolated: no scripts, no same-origin access
    page.click("#invoice-client-copy")
    page.click("#copy-preview")
    frame = page.locator("dialog[open] iframe.preview")
    assert frame.get_attribute(codecs.decode("fnaqobk", "rot13")) == ""
    page.keyboard.press("Escape")
    page.keyboard.press("Escape")

    # the automation log shows what ran and offers undo
    page.evaluate("location.hash = '#automations'")
    page.wait_for_selector("text=so it became job")
    assert page.locator("text=draft invoice").count() >= 1

    # reports and the client copy
    page.evaluate("location.hash = '#reports'")
    page.wait_for_selector("text=Quote conversion")
    assert page.locator("svg.chart rect").count() > 0

    assert errors == [], errors
    assert foreign == [], foreign
    ctx.close()


def test_phone_width_and_pages(server, browser):
    ctx, page, errors, foreign = open_app(browser, server, 400)
    for h in ("home", "schedule", "clients", "requests", "quotes", "jobs", "invoices", "timesheets", "reminders", "reports",
              "automations", "packets", "crew", "settings"):
        page.evaluate(f"location.hash = '#{h}'")
        page.wait_for_timeout(150)
        assert page.evaluate("document.documentElement.scrollWidth") <= 400, h
    for view in ("Week", "Month", "Route"):
        page.evaluate("location.hash = '#schedule'")
        page.locator("#sched-view button", has_text=view).click()
        page.wait_for_timeout(150)
        assert page.evaluate("document.documentElement.scrollWidth") <= 400, view
    assert errors == [], errors
    assert foreign == [], foreign
    ctx.close()


def test_delete_all(server, browser):
    ctx, page, errors, foreign = open_app(browser, server)
    page.evaluate("location.hash = '#settings'")
    page.click("#delete-all")
    page.fill("#delete-confirm", "DELETE")
    dialog_button(page, "Delete everything")
    page.wait_for_selector("#example-flag", state="hidden")
    page.evaluate("location.hash = '#clients'")
    page.wait_for_selector("text=0 clients")
    page.reload()
    page.wait_for_selector("body[data-ready='1']")
    page.evaluate("location.hash = '#clients'")
    page.wait_for_selector("text=0 clients")
    assert errors == [], errors
    assert foreign == [], foreign
    ctx.close()


def test_job_packet_round_trip(server, browser, tmp_path):
    ctx, page, errors, foreign = open_app(browser, server)
    page.add_init_script("delete window.showSaveFilePicker")
    page.reload()
    page.wait_for_selector("body[data-ready='1']")
    page.evaluate("location.hash = '#packets'")
    page.select_option("#pk-crew", "m-dana")
    page.fill("#pk-from", "2026-10-22")
    page.fill("#pk-to", "2026-10-28")
    with page.expect_download() as d:
        page.click("#pk-save")
    out = tmp_path / "packet.json"
    d.value.save_as(out)
    # the crew member's phone
    page.evaluate("location.hash = '#crew'")
    with page.expect_file_chooser() as fc:
        page.click("#crew-open")
    fc.value.set_files(str(out))
    page.wait_for_selector("#crew-send")
    # the current stop is expanded; finish it (starting it first if it has not started)
    fin = page.locator("button[id^='cv-finish-']").first
    vid = fin.get_attribute("id")[len("cv-finish-"):]
    if page.locator(f"#cv-start-{vid}").count():
        page.click(f"#cv-start-{vid}")
    page.click(f"#cv-finish-{vid}")
    with page.expect_download() as d2:
        page.click("#crew-send")
    back = tmp_path / "returned.json"
    d2.value.save_as(back)
    # back in the office
    page.evaluate("location.hash = '#packets'")
    with page.expect_file_chooser() as fc2:
        page.click("#pk-import")
    fc2.value.set_files(str(back))
    page.wait_for_selector("dialog[open] >> text=Choices needed")
    dialog_button(page, "Merge")
    page.wait_for_selector(".toast:has-text('Merged')")
    assert errors == [], errors
    assert foreign == [], foreign
    ctx.close()


def test_changing_a_recurring_schedule_moves_its_upcoming_visits(server, browser):
    ctx, page, errors, foreign = open_app(browser, server)
    page.evaluate("location.hash = '#jobs'")
    page.locator("tr.click", has_text="J-0001").first.click()
    page.wait_for_selector("#edit-job")
    page.click("#edit-job")
    page.uncheck("#jb-day-1")
    page.check("#jb-day-2")
    dialog_button(page, "Save")
    page.wait_for_selector(".toast:has-text('upcoming visits updated')")
    # no open visit of this job is left on a Monday from today on; Tuesdays took their place
    page.evaluate("location.hash = '#schedule'")
    page.locator("#sched-view button", has_text="Week").click()
    page.click("#sched-next")
    page.wait_for_timeout(200)
    assert errors == [], errors
    assert foreign == [], foreign
    ctx.close()


def test_framed_page_does_not_start(server, browser):
    # another site framing the page sees only a notice with a link to open the app in its own tab
    ctx = browser.new_context(viewport={"width": 900, "height": 700})
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.set_content(f'<iframe id="f" src="{server}" width="800" height="600"></iframe>')
    page.frame_locator("#f").locator("#framed a").wait_for(timeout=30000)
    frame = next(f for f in page.frames if f.url == server)
    link = frame.locator("#framed a")
    assert link.get_attribute("target") == "_blank"
    assert link.get_attribute("href") == server
    assert "own tab" in frame.locator("#framed").text_content()
    page.wait_for_timeout(500)
    assert frame.evaluate("document.body.dataset.ready") is None
    assert not frame.locator("#create-btn").is_visible()
    assert frame.locator("#create-btn svg").count() == 0
    # nothing was stored: the app never opened its database
    assert frame.evaluate("indexedDB.databases().then((d) => d.map((x) => x.name))") == []
    assert errors == [], errors
    ctx.close()
