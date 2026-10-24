// ---- money (src/fieldservice/money.py): totals, cost, payments, balances, invoice status.

function lineAmount(ln) {
  const a = mulDiv(ln.qty_milli, ln.rate, 1000);
  if (a > MAX_CENTS) fail("too_large", `Line ${cpSlice(ln.name, 40)}: the amount is over $10,000,000.00. Split it into smaller lines.`);
  return a;
}
function included(ln) { return !ln.optional || ln.selected; }

function docTotals(doc) {
  const lines = doc.lines;
  const amounts = lines.map((ln) => (included(ln) ? lineAmount(ln) : 0));
  const subtotal = sum(amounts);
  const discount = doc.discount_kind === "pct" ? mulDiv(subtotal, doc.discount_value, 10000) : Math.min(doc.discount_value, subtotal);
  const shares = subtotal > 0 ? allocate(discount, amounts) : lines.map(() => 0);
  const rate = doc.tax_rate_milli;
  const out = [];
  let baseSum = 0, tax = 0, cost = 0;
  lines.forEach((ln, i) => {
    const inc = included(ln);
    const base = inc && ln.taxable ? amounts[i] - shares[i] : 0;
    baseSum += base;
    const t = doc.tax_mode === "line" ? mulDiv(base, rate, 100000) : 0;
    tax += t;
    const c = inc ? mulDiv(ln.qty_milli, ln.cost, 1000) : 0;
    cost += c;
    out.push({ id: ln.id, included: inc, amount: amounts[i], discount: shares[i], tax_base: base, tax: t, cost: c });
  });
  if (doc.tax_mode === "document") tax = mulDiv(baseSum, rate, 100000);
  const optionalTotal = sum(lines.filter((ln) => ln.optional).map(lineAmount));
  return { lines: out, subtotal, discount, taxable_base: baseSum, tax, total: subtotal - discount + tax, cost,
    revenue: subtotal - discount, optional_total: optionalTotal };
}

function paymentsFor(book, invoiceId) { return book.payments.filter((p) => p.invoice_id === invoiceId); }

function invoiceState(book, inv, today) {
  const t = docTotals(inv);
  const paid = sum(paymentsFor(book, inv.id).map((p) => p.amount));
  const bal = t.total - paid;
  let st, over = 0;
  if (inv.status === "void") st = "void";
  else if (inv.status === "draft") st = "draft";
  else if (bal <= 0) st = "paid";
  else if (today > inv.due_date) { st = "overdue"; over = daysBetween(inv.due_date, today); }
  else st = "awaiting";
  return { total: t.total, tax: t.tax, revenue: t.revenue, paid, balance: bal, status: st, days_overdue: over };
}

function quoteState(book, q) {
  const t = docTotals(q);
  const dep = sum(book.payments.filter((p) => p.quote_id === q.id).map((p) => p.amount));
  return { total: t.total, subtotal: t.subtotal, tax: t.tax, cost: t.cost, optional_total: t.optional_total,
    deposit_required: q.deposit, deposit_paid: dep, deposit_due: Math.max(0, q.deposit - dep) };
}
function dueDate(date, termsDays) { return addDays(date, termsDays); }

function clientBalance(book, clientId, today) {
  let owed = 0, over = 0;
  for (const inv of book.invoices) {
    if (inv.client_id !== clientId) continue;
    const s = invoiceState(book, inv, today);
    if (["awaiting", "overdue", "paid"].includes(s.status)) owed += s.balance;
    if (s.status === "overdue") over += s.balance;
  }
  const credit = sum(book.payments.filter((p) => p.client_id === clientId && !p.invoice_id && !p.quote_id).map((p) => p.amount));
  return { balance: owed - credit, overdue: over, credit };
}
