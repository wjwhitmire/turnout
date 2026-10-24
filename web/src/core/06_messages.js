// ---- messages (src/fieldservice/messages.py): reminder drafts and date words.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function dateWords(s) {
  const [y, m, d] = parseDate(s);
  return `${WDAYS[weekday(s) - 1]}, ${MONTHS[m - 1]} ${d}, ${y}`;
}
function timeWords(t) {
  if (!t) return "any time";
  const m = parseTime(t);
  const h = Math.floor(m / 60) % 24;
  const ap = h < 12 ? "AM" : "PM";
  const h12 = h % 12 || 12;
  return `${h12}:${pad(m % 60, 2)} ${ap}`;
}
function hm(minutes) {
  const sign = minutes < 0 ? "-" : "";
  minutes = Math.abs(minutes);
  return `${sign}${Math.floor(minutes / 60)}:${pad(minutes % 60, 2)}`;
}
function firstName(name) { const parts = name.split(" "); return parts.length && parts[0] ? parts[0] : name; }
function addressLine(p) {
  if (p === null) return "";
  const bits = [p.street, [p.city, p.state, p.zip].filter((x) => x).join(" ")];
  return bits.filter((b) => b).join(", ");
}
function signature(s) { return [s.business_name, s.phone, s.email].filter((x) => x).join("\n"); }
function payLines(s, links) {
  if (!links.length) return "";
  const out = ["", "Ways to pay:"];
  for (const ln of links) out.push(`- ${ln.label}: ${ln.text}`);
  return out.join("\n");
}
function visitReminder(s, client, prop, job, visit, channel) {
  const biz = s.business_name || "We";
  const when = dateWords(visit.date);
  const at = visit.start_time ? ` at ${timeWords(visit.start_time)}` : " (any time that day)";
  const where = addressLine(prop);
  if (channel === "text") {
    return { subject: "", body: `${biz}: reminder of your visit on ${when}${at}` + (where ? ` at ${where}` : "") + ". Reply here to change it." };
  }
  const body = `Hi ${firstName(client.name)},\n\n` +
    `This is a reminder that ${biz} is scheduled for ${job.title} on ${when}${at}` + (where ? ` at ${where}` : "") + ".\n\n" +
    "If that time no longer works, reply to this message and we will find another.\n\n" + signature(s);
  return { subject: `Reminder: visit on ${when}`, body };
}
function overdueReminder(s, client, inv, state, days, links, channel) {
  const biz = s.business_name || "Our office";
  if (channel === "text") {
    return { subject: "", body: `${biz}: invoice ${inv.number} for ${money(state.balance)} was due ${dateWords(inv.due_date)}. ` +
      (links.length ? `Pay: ${links[0].text}` : "Reply here with any questions.") };
  }
  const body = `Hi ${firstName(client.name)},\n\n` +
    `Invoice ${inv.number} for ${money(state.total)} was due on ${dateWords(inv.due_date)}, ` +
    `${days} day${days !== 1 ? "s" : ""} ago. The balance is ${money(state.balance)}.\n` +
    payLines(s, links) + "\n\n" +
    "If you have already paid, thank you, and please ignore this note.\n\n" + signature(s);
  return { subject: `Invoice ${inv.number} is past due`, body };
}
function quoteFollowup(s, client, q, total, channel) {
  const biz = s.business_name || "We";
  if (channel === "text") {
    return { subject: "", body: `${biz}: checking in on quote ${q.number} (${money(total)}) sent ${dateWords(q.sent_date)}. Any questions?` };
  }
  const body = `Hi ${firstName(client.name)},\n\n` +
    `We sent quote ${q.number} for ${q.title || "the work you asked about"} (${money(total)}) on ` +
    `${dateWords(q.sent_date)}. Do you have any questions, or would you like to go ahead?` +
    (q.valid_until ? ` The quote is good through ${dateWords(q.valid_until)}.` : "") +
    "\n\n" + signature(s);
  return { subject: `Following up on quote ${q.number}`, body };
}
function pickChannel(client) {
  const hasC = { email: !!client.email, text: !!client.phone };
  if (hasC[client.prefer]) return client.prefer;
  const other = client.prefer === "email" ? "text" : "email";
  return hasC[other] ? other : null;
}
function contactFor(client, channel) { return channel === "email" ? client.email : client.phone; }
