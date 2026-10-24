# Testing Turnout

This file records the full function test of October 23, 2026: what was tested, how, the result for each function, and what is still open. The browser tests ran against the published form of the site (the Pages build in `docs/` with the publish placeholders filled, served under `/turnout/`), not the development copy, unless the row says otherwise.

## How to rerun

```
pip install -e .[dev] playwright
pytest -q                                              # library, workflow, browser tests
python tests/make_vectors.py --check && node web/parity.test.mjs   # Python and JavaScript agree exactly
python web/build_pages.py                              # rebuild web/app.html and docs/
python tools/check.py                                  # contrast checks of the tokens
```

`tests/test_published_flows.py` also imports the Crossfoot export into Crossfoot's own Pages build when the Crossfoot repository (folder `backoffice`) sits next to this one; without it that part is skipped.

Test counts: 89 before this pass, 93 after (4 new browser tests in `tests/test_published_flows.py`). Parity: 726 cases, 32,277 checks, unchanged (no core change).

## How each kind of function was tested

- Screens: all 14 pages and the not-found route at 1280 px and 400 px (touch), light and dark, with page errors, console errors, Content-Security-Policy violations, requests to other hosts, sideways scroll and small touch targets recorded. None found. The switches measure 52 by 30 px but carry a 60 by 46 px hit area.
- Controls: every visible button, tab, checkbox and select on every page clicked at 1280 px (199 controls), with downloads saved and opened (every report CSV, the timesheet CSV, list and line-item CSVs, the backup, the job packet, the Crossfoot IIF and customer list). No errors.
- Money: a quote with two taxable lines, an optional line, a 10% discount and 8.25% tax worked by hand to $485.00 (discount split 25.00, 13.65, 12.05 by largest remainder; tax on 347.85 is 28.697625, rounded to 28.70); the app's quote, job, draft invoice, balance after a $200.00 payment ($285.00) and the client copy all show it.
- Schedule: a weekly Monday and Thursday job from October 22 gets exactly the 13 dates through the 45-day look-ahead the example sets; month-end, leap day, year 2100, last-weekday and every-N-days rules checked against a calendar.
- Reports: revenue and collected by month, A/R aging buckets, quote conversion and crew hours and utilization recomputed from the example's records by hand; all match.
- Export to Crossfoot: the IIF file from the published app imported into Crossfoot's published app; net income equals invoiced revenue, A/R equals Turnout's aging total, the trial balance foots, and importing the same file again posts nothing twice.

## Function inventory and results

Result: Pass, Fixed (found and fixed in this pass), or Note (works as documented; see Known limits).

| Function | How tested | Result |
|---|---|---|
| Navigation, drawer at phone width, theme, search | sweep, crawl | Pass |
| Create menu and keys (N, then C, R, Q, J, I, T) | keys pressed in the browser, each opens its form | Pass |
| Home: today, flow tiles, automation feed with Undo, Run now | crawl | Pass |
| Clients and properties, client tabs, archive, CSV import | crawl; hostile CSV (empty, binary, JSON, 60,000 rows refused, formula text kept as data and guarded on export, unicode) | Pass |
| Requests: new, assessment visit, to quote, to job | published flow | Pass |
| Quotes: lines, optional items, discount, tax once or per line, deposit, send, changes requested, approve with chosen options, convert, archive | published flow with hand totals | Pass |
| Jobs: one-off and recurring (weekly, monthly by day or weekday, every N days), visit time, crew, checklist, billing per visit or fixed, invoice timing, close, reopen, expenses, job costing | published flow; schedule edge cases | Pass |
| Visits: schedule, start, finish, checklist, notes, photos, move, skip, cancel | published flow; test_workflow.py | Pass |
| Dispatch board: Day, Week, Month, Route, today, previous, next, conflicts, tray | sweep; drag with the mouse in the published flow | Pass |
| Dispatch drag with touch | press and hold, then drag, at 400 px | Fixed: a card could not reach a crew column off screen; holding it at the edge now scrolls the board |
| Messages over the board | published flow | Fixed: a burst of messages stacked over the board and caught the pointer; at most three show |
| Route order suggestion, apply, retime, undo | test_schedule.py distances and order; crawl | Pass |
| Timesheets: week grid, entries, add, approve, approve all, CSV | crawl; probe of approve | Pass |
| Time entry with no crew member yet | new business file test | Fixed: "Add a crew member in Settings first" became the crew form, then the time entry |
| Request, quote, job or invoice with no client yet | new business file test | Fixed: opens the client form, then the form asked for with that client chosen |
| Invoices: from a job or from scratch, send, partial and full payment, edit payment, void, past due | published flow | Pass |
| Client copy page (no scripts, its own policy, QR code), preview in an isolated frame, PDF behind its switch | page downloaded and checked; test_export.py decodes the QR code | Pass |
| Reminders: queue, open email or text draft, copy, mark sent, dismiss | published flow (mailto link), probe of dismiss | Pass |
| Automations: five rules with switches, log with why and record changes, Undo for each rule, Run now, an undone step stays undone | published flow undoes Approved quote to job, Time from visits, Draft invoices and Reminder drafts and runs the rules again | Pass |
| Reports: revenue, quote conversion, crew hours, jobs by status, job profitability, aging; period buttons; copy and save CSV | hand recompute; CSV opened | Pass |
| Crew packets: export, crew view on a phone, start and finish, notes and time, return file, office merge with choices, the same file twice changes nothing | published round trip | Pass |
| Settings: business, tax, terms, messages, reminder steps, look-ahead, payment links, items, crew, data | crawl | Pass |
| Backup and restore, CSV lists and line items, delete all, load example, start a new file | downloads opened; test_browser.py | Pass |
| Export to Crossfoot (IIF and customer CSV) | imported into Crossfoot and tied out | Pass |
| Next export starts after the last one | published flow | Fixed (automation addendum) |
| Network switch (PDF files): off by default, refusal without it | zero outside requests on every page and click | Pass |
| Framed by another site: notice only | test_browser.py | Pass |
| PWA manifest under /turnout/ | fetched in the published flow | Pass |
| Single file web/app.html from file:// | every page draws; data persists in IndexedDB | Note: it loads the Google Fonts stylesheet the page contract names |
| Command line: example, verify, report, csv, crossfoot, page, packet, automate, schedule | each run; a bad file gives a message and exit code 2 | Pass |
| Python library and JavaScript core | pytest; parity replay | Pass |

## Automation audit (owner addendum)

| Decision point | Before | After |
|---|---|---|
| New request, quote, job or invoice with no client | Message "Add a client first." and the client form; the request was lost | Client form, then the original form with that client chosen |
| New time entry with no crew | Message "Add a crew member in Settings first." and nothing else | Crew form, then the time entry |
| Crossfoot export date range | From January 1 every time | From the day after the last export, with the reason shown |
| Approved quote to job, visits ahead, time from visits, draft invoices, reminder drafts | Already automatic with why and Undo | Kept |
| Tax rate, terms, messages on new documents | Already filled from Settings | Kept |
| Client, property, prices, crew on a visit | Asked | Kept: only the person knows them; the property is preselected when the client has one |

## Known limits

- The single-file `web/app.html` asks Google Fonts for its stylesheet, as the page contract requires; the Pages build makes no request with its switch off.
- Saving a file uses the browser's save dialog where the File System Access API exists; headless tests use the download path.
- Route order is straight-line, as documented.
