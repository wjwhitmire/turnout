# Turnout

Field Tools No. 17. A free, open-source, local-first office for small trade and service businesses: requests, quotes, jobs, recurring visits, the schedule and dispatch board, crew time, job costing, invoices, payments, reminders and reports, kept on your own device. The product name "Turnout" lives in one constant per language (`src/fieldservice/brand.py`, `web/src/core/00_brand.js`).

Live tool: https://wjwhitmire.github.io/turnout/

**Status: core and working app.** The math lives in two matching implementations: a Python package (`fieldservice`, standard library only) and a browser core (`web/src/core/*.js`, pure functions, no DOM, no network). A parity test replays every Python reference result against the JavaScript and requires exact equality. The browser app (`web/app.html`, `docs/index.html`) wears the Turnout design: an asphalt nav, a yellow key-answer plate (one per view), T-card visits on the dispatch board, and state chips that pair a color with a glyph and a word, in light and dark.

## Quick start

```
pip install -e .[dev]
pytest -q
python tests/make_vectors.py && node web/parity.test.mjs
python web/build_pages.py        # writes web/app.html and docs/index.html

fieldservice example --out example.json
fieldservice verify example.json
fieldservice report aging --backup example.json --csv
fieldservice crossfoot --backup example.json --from 2026-07-01 --to 2026-10-22 --out books.iif
fieldservice page invoices <invoice-id> --backup example.json --out invoice.html
fieldservice packet m-dana --backup example.json --from 2026-10-22 --to 2026-10-28 --at 2026-10-22T06:00:00-05:00
fieldservice automate --backup example.json --today 2026-10-23 --at 2026-10-23T06:00:00-05:00
fieldservice schedule --backup example.json --from 2026-10-26 --to 2026-10-26 --crew m-dana
```

The browser app opens with the example business ("Example: Live Oak Lawn and Irrigation"). Everything in it is invented: names, addresses (example streets in "Sample City"), coordinates, 555-01xx phone numbers, example.com email addresses, prices and four months of history.

## The workflow

The screens follow the order owners already work in, with the industry's ordinary names: **Requests, Quotes, Jobs, Visits, Invoices**, plus **Schedule**, **Timesheets**, **Reminders**, **Reports** and **Settings**. Press **n** (or Create) anywhere to make a client, request, quote, job, invoice or time entry. In a new business file, asking for a request, quote, job or invoice before there is a client opens the client form and then the form you asked for with that client chosen; a time entry before there is a crew member does the same with the crew form.

- **Clients and properties.** A client has any number of service addresses. Coordinates are optional and only feed route order. Client lists import from CSV (header row found by name; first and last name columns, address columns and notes are understood).
- **Requests.** Work a client asked for, with an optional assessment visit. Convert to a quote or straight to a job.
- **Quotes.** Line items from the products and services list or typed in, optional lines the client may choose, a discount, sales tax, a required deposit, and statuses draft, awaiting response, changes requested, approved, converted, archived. Approving records who approved and which optional lines they chose.
- **Jobs.** One-off or recurring. A recurring job has a schedule (below), a visit time and length, a default crew and a checklist copied to every visit, and bills per visit or at a fixed price, after each visit, monthly, or when the job closes. Changing its schedule, visit time, length or crew updates its upcoming visits from today on, except visits moved by hand, started or invoiced.
- **Visits.** On the schedule and dispatch board: Day (one column per crew member plus Unassigned, on a time grid), Week (crew rows by day), Month, and Route. Drag a visit to another crew member, time or day (mouse, pen or touch); holding a card at the edge of the board scrolls it, so a phone reaches columns off screen; a short press opens it. Unscheduled jobs sit in a tray and can be dragged onto the board. Double bookings are flagged. The visit form starts and finishes the visit (time stamps), ticks the checklist, takes notes and photos, moves, skips (recurring) or cancels it.
- **Timesheets.** A week grid by crew member and the entries behind it, with job, travel, shop and other time and an approval mark.
- **Invoices and payments.** From a job (its lines, scaled by the number of visits for per-visit billing) or from scratch. Deposits paid on the quote apply to the job's first invoice. Statuses draft, awaiting payment, past due, paid, void.
- **Client copy.** A read-only page for one quote or invoice that the client opens on any device: lines, totals, ways to pay, and a QR code for the first payment link. No scripts; its own Content-Security-Policy blocks every network request. A PDF of the same document is built on the device once the PDF switch is on.
- **Crew packets.** There is no server, so crews work from files: the office saves a packet for one crew member and a date range; the crew member opens it in this app on their phone (Crew view), starts and finishes visits, ticks checklists, adds notes, photos (shrunk to 1600 pixels) and travel or shop time, and sends the returned file back by any means. The office merges it with a review of conflicts (below). Packets hold no prices.

## Automation

Every repetitive step has an automatic path that says why it ran and can be undone. Rules run when anything changes and when the app opens; each can be switched off in Automations.

| Rule | What it does |
|---|---|
| Approved quote to job | An approved quote becomes a one-off job with the lines the client chose. |
| Recurring visits | Recurring jobs get their visits created through today plus the look-ahead in Settings (60 days by default). Past dates are never filled in. A job whose client is archived makes no new visits; the job says so, with Undo. |
| Time from visits | A visit with a start and finish stamp gives each crew member on it a job time entry for the minutes between them. |
| Draft invoices | A one-off job gets a draft invoice once every visit is complete; a recurring job after each visit, after each calendar month ends, or when it closes, as the job says. |
| Reminder drafts | Visit reminders a set number of days ahead; past due follow-ups at set days after the due date (only the latest step reached is queued); quote follow-ups a set number of days after sending. Email or text, by the client's preference and what contact details they have. |
| Route order (suggested) | The Route view suggests an order for each crew member's day with the distance saved. Applying it (optionally with new start times 15 minutes apart) is logged and undoable. |

Each automatic action writes one log entry: the rule, a plain sentence of why, the keys of what it handled, and every record it created or changed (before and after). Undo restores those records only while they are still exactly as the rule left them, so an undo never overwrites later work. An action whose key is in the log, done or undone, never runs again, so an undone action stays undone. After 60 days an entry keeps its summary and keys and drops the record copies. Past 10,000 entries the oldest are dropped, and the reminders they handled are kept as a compact list so none is queued again. A step that cannot be done with the data as it is (an invoice line over the $10,000,000.00 cap, say) is skipped, leaves nothing behind and runs again once the data is fixed. Nothing is ever sent: reminders are drafts that open in your own email or messages app.

## Method and equations

Money is an integer number of cents everywhere. Quantities are scaled by 1000, percents by 100 and the tax rate by 1000 (8.25% is 8250), so no floating point value touches money. `round(n / d)` rounds half away from zero; the JavaScript side uses BigInt where a product can pass 2^53. This is Field Ticket's arithmetic.

| Quantity | Equation |
|---|---|
| Line amount | `round(qty_milli x rate / 1000)`; optional lines count only when chosen |
| Discount | `round(subtotal x pct_x100 / 10000)`, or `min(amount, subtotal)` |
| Discount share per line | largest remainder over line amounts; shares sum to the discount |
| Tax | `round(sum(taxable bases) x rate_milli / 100000)` once per document, or per line and summed |
| Total | `subtotal - discount + tax` |
| Balance | `total - payments applied` |
| Expected cost | `sum(round(qty_milli x unit cost / 1000))` over included lines |
| Labor cost | `round(minutes x crew hourly cost / 60)` per time entry |
| Materials | `round(qty_milli x unit cost / 1000)` per expense |
| Job profit and margin | `revenue - labor - materials`; margin `round(profit x 10000 / revenue)` basis points |
| Utilization | `round(job minutes x 10000 / round(weekly minutes x days / 7))` basis points |
| Quote conversion | `round(approved x 10000 / sent)` basis points, quotes sent in the range |
| Aging buckets | days past due on the as-of date: current, 1 to 30, 31 to 60, 61 to 90, 91 and over |

Revenue in reports is invoice subtotal less discount, before tax, for sent invoices by invoice date; collected is payments by payment date. Job profitability uses invoiced revenue, or the job's line items for a one-off job not yet invoiced (marked "quoted").

### Scheduling

Dates are calendar dates (proleptic Gregorian, H. Hinnant's `days_from_civil` and `civil_from_days`) and visit times are wall-clock times on that date with no time zone. Series are built from calendar days, never by adding 24-hour steps to an instant, so a weekly 08:00 visit stays at 08:00 across daylight saving changes.

- **Every N days** from the start date.
- **Weekly** on chosen weekdays every N weeks. Weeks run Monday to Sunday and are counted from the week that holds the start date; days before the start date in that week are skipped.
- **Monthly on a day** every N months. A day past the month's end falls on its last day (the 31st is April 30, February 28 or 29); `-1` is always the last day.
- **Monthly on the nth weekday** (1st to 4th, or last) every N months: `1 + (weekday - weekday of the 1st) mod 7 + 7(n - 1)`, or for the last, `last day - (weekday of the last day - weekday) mod 7`.
- Skipped dates are removed from the series. A visit limit counts series dates before skips. An end date stops the series.

Worked time comes from start and finish stamps that carry the device's UTC offset (`2026-11-01T01:30:00-05:00`), so a shift across a clock change is exact: 01:30 CDT to 01:15 CST is 45 minutes.

Conflicts: two visits of the same crew member overlap when one starts before the other ends, on absolute minutes (`day number x 1440 + start`), so overnight visits are compared across midnight. Visits with no start time ("any time") never conflict.

Route order: nearest neighbour from the shop's coordinates (or the first stop), ties to the earlier stop. Distance is the equirectangular approximation `R x sqrt((dlon x cos(mean lat))^2 + dlat^2)` with R = 6,371,008.8 m (mean Earth radius); cosine by its Taylor series to x^18 so both languages compute the same double. It is a straight-line suggestion, not a driving route, and ignores roads and traffic. No map service is used.

### Merging a returned packet

Three-way per field. The packet carries each visit as it was when exported (base); the office copy may have changed since (office); the crew sends theirs (crew). Crew equals base: nothing. Office equals base: the crew's value is taken. Office equals crew: nothing. Otherwise the person chooses office or crew. Checklist items merge per item. Time entries and photos are added; an entry already present (same crew member, visit, date, start, minutes and kind; or same photo name, size and time) is skipped, so merging the same file twice changes nothing. A crew packet cannot change any other visit field, add visits or checklist items, or carry time for another crew member. Every visit in it must be assigned to the packet's crew member, and every visit, time entry and photo must point at a job in the packet. A visit the office has since given to someone else is not merged; the review says so.

## Payment links

Settings holds up to eight: a Stripe Payment Link (`https://buy.stripe.com/...`, the document number added as `client_reference_id`), a Square payment link, a PayPal.Me name (amount in the link), a Venmo user name (amount and note in the link), a Cash App $Cashtag (amount in the link), Zelle details and bank transfer instructions (text only), or any other https link. Each is checked before it is printed. The link is text on the page and in the QR code; this program never contacts a payment service and never sees card data. Record each payment when it arrives.

The QR encoder is built in (ISO/IEC 18004 Model 2, byte mode, error correction level M, versions 1 to 40, eight masks chosen by the four penalty rules; method after Project Nayuki's reference implementation, MIT). Its output is checked by decoding with OpenCV in the tests.

## Exports and imports

- **Backup:** `{"format": "field-tools-17-service", "version": 1, "book": {...}}`. Restoring checks every record against strict field tables and every reference; a failed check changes nothing.
- **CSV:** every list (one column per field, lists of ids joined with `;`, totals on quotes, jobs and invoices), line items of quotes, jobs or invoices, and every report. A cell that starts with `=`, `+`, `-`, `@`, tab or carriage return, or their full-width forms, even after leading spaces, gets a leading apostrophe.
- **Crossfoot** (Field Tools No. 15, bookkeeping): an IIF file for Crossfoot's Settings, Import, with income accounts (Service Income, Materials Income, Other Income; created there when missing), every client with an invoice or payment in the range (a colon in a name becomes a dash, since Crossfoot reads it as a sub-customer; repeated names get the client id), each sent invoice (Accounts Receivable for the total, one income split per line after its discount share, Sales Tax Payable for the tax) and each payment (Undeposited Funds and Accounts Receivable). Crossfoot imports payments unapplied because IIF does not link a payment to its invoice; apply them there. The From date starts the day after the last export (or today, when the last one ran through today), and Crossfoot skips anything it already has, so overlapping exports are safe. The customer list is also offered as CSV with Crossfoot's customer column names. A test imports the example's file into Crossfoot (when its source sits next to this repository) and checks that every transaction becomes an invoice or payment form, the books tie out, net income equals invoiced revenue, and the receivable equals this program's aging total.
- **Job packet:** `{"format": "field-tools-17-job-packet", "version": 1, "kind": "out" | "return", ...}`.
- **Client list CSV** import.

## Local-first and security

- Data lives in this browser's IndexedDB on this device (photo files kept apart from the business file). Save to a file through the File System Access API where the browser offers it, else a download. Delete all data in Settings erases the business file, photos and settings.
- One optional network feature, PDF files (jsPDF 4.2.1 from cdnjs.cloudflare.com with a pinned SHA-384 integrity hash), is off until switched on, and goes through one gate function that checks the switch and the host. With it off the page makes no network request at all; the browser test asserts that. The Pages build's Content-Security-Policy allows only that host for scripts, as a second wall. The Pages build serves its fonts (Sofia Sans Condensed, Sofia Sans and Reddit Mono, latin, SIL Open Font License, licenses in `docs/fonts/`) from its own origin; the fonts stylesheet named in `web/app.html` is used only by that standalone file.
- User text reaches the page only through `textContent` and attribute values. No `eval`, no `new Function`, no inline event handlers.
- Files read are capped: CSV 5 MB and 50,000 rows, backups and packets 64 MB, photos 25 MB (packet photos 3 MB each, 60 per packet, 48 MB total, JPEG, PNG or WebP data only).

## Limits

- Single business, single device. Moving between devices is by backup file. Crews have no live sync; they trade packet files.
- Nothing is sent for you: no email, text or card processing service is built in.
- Route order is a straight-line suggestion and does not know roads. It needs coordinates you enter.
- Times have no time zone. A business that works across zones should enter local times for each property.
- US dollars only. One tax rate per document; no compound or multi-jurisdiction tax.
- Photos are stored only on the device that took them (or in the office after a packet merge); backups hold photo details, not the image files.
- Text sorting and length caps agree between the two languages for every character in the Basic Multilingual Plane; caps count code points.
- The PDF uses jsPDF's built-in Helvetica, which covers Latin-1; other characters print as `?`. The client page shows them correctly.

## Design

Tokens and component CSS live in `web/src/style.css`; the color values are also listed in `tools/tokens.py`. `python3 tools/check.py` checks their contrast; `python3 tools/shoot.py` (after `python3 web/build_pages.py`) screenshots every page at 400 and 1280 px in light and dark into `shots/` (not committed) and reports sideways scroll, controls under 44 px, fonts that did not load, script errors and requests to other hosts.

## Validation

- `pytest`: recurrence edge cases (month ends, February 29 in leap and non-leap years, the year 2100, nth and last weekdays, every N days across a leap day, skips, limits, end dates), wall-clock visits across daylight saving changes, time stamps across fall-back and spring-forward, conflicts including overnight visits, nearest-neighbour route and distances against known values, money math hand-checked (document and line tax rounding, discount shares, optional lines, caps), the full request to paid-invoice flow with automation, undo and its refusals, monthly and fixed-price invoicing, reminder queues, packet export, merge, conflicts, idempotence and hostile packets, CSV formula guard and hostile CSV files, hostile backups, client page escaping, payment link checks, QR decoding, the CLI, repository rules, and a headless browser run of the main flow (create a client, request to quote, approval to job by automation, drag on the dispatch board, finish a visit, draft invoice, payment, reports, a crew packet round trip, every page at 400 px without sideways scroll, delete all, and zero network requests). `tests/test_published_flows.py` runs the filled Pages copy served under /turnout/ through the office day with totals worked by hand, every automation's undo, the client copy, a crew packet round trip, a new business file with no dead ends, and the export imported into Crossfoot's own Pages build (when that repository sits next to this one) with the books tying out. TESTING.md lists every function tested and how.
- `python tests/make_vectors.py && node web/parity.test.mjs`: about 700 reference cases, including chained workflows and automation runs on the example business, replayed against the browser core with exact equality, including error codes and messages.

## License

MIT. Copyright 2026 Will Whitmire.

Third-party code loaded only when switched on: jsPDF 4.2.1 (MIT).
