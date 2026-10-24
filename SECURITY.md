# Security

## The library and the browser core

- No network calls of any kind, in Python or in the browser core. The parity test refuses a core that mentions network, DOM, storage or eval calls.
- No eval, no `new Function`, no pickle, no shell calls.
- Every file reader is capped: CSV at 5 MB, 50,000 rows and 10,000 characters per field; backups and job packets at 64 MB; packet photos at 3 MB each, 60 per packet and 48 MB in total, and only as JPEG, PNG or WebP data. A capped file is refused with a clear message.
- Imported backups and returned job packets are parsed as JSON and checked against strict field tables: known keys only, length caps, control characters removed, lone surrogates replaced, whole cents in range, real dates, times and stamps, references that resolve. A returned packet cannot change anything but a visit's status, stamps, notes and checklist, cannot carry time or photos for another crew member, and cannot touch a visit that is not assigned to its crew member in the office copy. A failed check changes nothing.
- CSV exports prefix any cell that starts with `=`, `+`, `-`, `@`, tab or carriage return, or their full-width forms, even after leading spaces, with an apostrophe.
- The read-only client page escapes every value, contains no scripts, and carries its own Content-Security-Policy (`default-src 'none'`). The in-app preview shows it in an isolated frame with no permissions.
- Payment links are checked before they are printed: https only, the expected host for Stripe and Square, plain handles for PayPal, Venmo and Cash App. Card data never enters the program.
- The CLI reads only the files named on its command line and writes only to standard output or the `--out` path given.

## The browser app

- Data stays in this browser's IndexedDB on this device. Delete all data in Settings erases it.
- One optional network feature (PDF files: jsPDF from cdnjs.cloudflare.com with a pinned SHA-384 integrity hash) is off until switched on and goes through one gate function. With it off the page makes no requests; the headless browser test checks this. The Pages build carries a Content-Security-Policy with script hashes and only that host.
- The GitHub Pages build refuses to run inside another site's frame (Pages cannot send a header that forbids framing): a framed page shows only a notice with a link that opens the app in its own tab, so a hidden frame cannot be used to trick clicks such as Delete all data. A headless test loads the page in a frame to confirm it.
- User text reaches the page only through `textContent` and attribute values, never `innerHTML`. No inline event handlers.

## Reporting an issue

Open a GitHub issue titled "Security" with a description and steps to reproduce. For anything sensitive, use GitHub's private vulnerability reporting on this repository instead of a public issue.
