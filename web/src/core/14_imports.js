// ---- imports (src/fieldservice/imports.py): client list CSV import.

const IMPORT_COLUMNS = {
  name: ["name", "client", "client name", "customer", "customer name", "display name", "full name", "contact name"],
  first: ["first name", "first", "given name"],
  last: ["last name", "last", "surname", "family name"],
  company: ["company", "company name", "business", "business name"],
  email: ["email", "e-mail", "email address", "primary email"],
  phone: ["phone", "phone number", "mobile", "mobile phone", "cell", "main phone", "primary phone"],
  street: ["street", "address", "street 1", "street1", "address 1", "address line 1", "service street", "property address", "billing street"],
  street2: ["street 2", "street2", "address 2", "address line 2"],
  city: ["city", "town", "service city", "billing city"],
  state: ["state", "province", "region", "service state", "billing state"],
  zip: ["zip", "zip code", "postal code", "postcode", "service zip", "billing zip"],
  notes: ["notes", "note", "comments"],
  tags: ["tags", "tag", "labels"],
};
function headerKey(s) { return squash(lower(s)).replace(/:+$/, "").replace(/^\*+|\*+$/g, ""); }

function importClientsCsv(book, text, today) {
  const rows = parseCsv(text).rows;
  let hi = -1, cols = {};
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const c = {};
    rows[i].cells.forEach((cell, j) => {
      const k = headerKey(cell);
      for (const role of Object.keys(IMPORT_COLUMNS)) {
        if (!has(c, role) && IMPORT_COLUMNS[role].includes(k)) { c[role] = j; break; }
      }
    });
    if (has(c, "name") || has(c, "first") || has(c, "last") || has(c, "company")) { hi = i; cols = c; break; }
  }
  if (hi < 0) fail("bad_csv", "Could not find the header row. The file needs a name (or first and last name, or company) column.");
  const tx = new Tx(book);
  const have = new Set(book.clients.map((c) => lower(c.name) + "\u0000" + lower(c.email)));
  let created = 0, props = 0;
  const skipped = [];
  const cell = (r, role) => { const j = has(cols, role) ? cols[role] : null; return j !== null && j < r.cells.length ? squash(r.cells[j]) : ""; };
  for (const r of rows.slice(hi + 1)) {
    const n = r.line;
    const name = cell(r, "name") || squash(cell(r, "first") + " " + cell(r, "last")) || cell(r, "company");
    if (!name) { skipped.push(`Line ${n}: no name; skipped.`); continue; }
    if (lower(name).startsWith("total")) continue;
    const key = lower(cpSlice(name, 200)) + "\u0000" + lower(cpSlice(cell(r, "email"), 200));
    if (have.has(key)) { skipped.push(`Line ${n}: ${cpSlice(name, 60)} is already a client; skipped.`); continue; }
    have.add(key);
    try {
      const c = tx.create("clients", { name: cpSlice(name, 200), company: cpSlice(cell(r, "company"), 200), email: cpSlice(cell(r, "email"), 200),
        phone: cpSlice(cell(r, "phone"), 50), notes: cpSlice(cell(r, "notes"), 2000), tags: cpSlice(cell(r, "tags"), 200),
        prefer: cell(r, "email") || !cell(r, "phone") ? "email" : "text", created: today });
      created += 1;
      const street = squash(cell(r, "street") + " " + cell(r, "street2"));
      if (street) {
        tx.create("properties", { client_id: c.id, street: cpSlice(street, 200), city: cpSlice(cell(r, "city"), 100),
          state: cpSlice(cell(r, "state"), 50), zip: cpSlice(cell(r, "zip"), 20) });
        props += 1;
      }
    } catch (e) {
      if (e instanceof ServiceError) fail(e.code, `Line ${n}: ${e.message}`);
      throw e;
    }
  }
  return [tx.book, { clients: created, properties: props, skipped }];
}
