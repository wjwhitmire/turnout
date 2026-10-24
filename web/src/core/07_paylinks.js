// ---- paylinks (src/fieldservice/paylinks.py): payment links and instructions on documents.

const HANDLE_RE = /^[A-Za-z0-9_.-]{1,60}$/;
const PAY_HOSTS = { stripe: ["buy.stripe.com"], square: ["square.link", "checkout.square.site"] };
const PAY_NAMES = { stripe: "Pay by card", square: "Pay by card", paypal: "PayPal", venmo: "Venmo", cashapp: "Cash App",
  zelle: "Zelle", ach: "Bank transfer", other: "Pay online" };

function httpsLink(url, hosts) {
  const m = /^https:\/\/([A-Za-z0-9.-]{1,253})(\/[A-Za-z0-9._~%/?#=&+:@!$'()*,;-]*)?$/.exec(url);
  if (!m) fail("bad_link", "The payment link must be a full https:// address without spaces.");
  const host = lower(m[1]);
  if (hosts && !hosts.includes(host)) fail("bad_link", `A ${hosts[0]} link was expected, not ${host}.`);
  return url;
}
function pctEncode(s) {
  let out = "";
  for (const b of utf8(s)) {
    const c = String.fromCharCode(b);
    if (/[A-Za-z0-9\-_.~]/.test(c) && b < 128) out += c;
    else out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}
function checkLink(link) { paymentOption(link, 100, "CHECK"); }

function paymentOption(link, amount, ref) {
  const k = link.kind;
  const v = strip(link.value);
  const label = link.label || PAY_NAMES[k];
  const amt = centsText(Math.max(amount, 0));
  let url = "";
  if (k === "stripe" || k === "square") {
    url = httpsLink(v, PAY_HOSTS[k]);
    if (k === "stripe") {
      const safe = cpSlice(ref.replace(/[^A-Za-z0-9_-]/gu, "-"), 200);
      url = url + (url.includes("?") ? "&" : "?") + "client_reference_id=" + safe;
    }
  } else if (k === "paypal" || k === "venmo" || k === "cashapp") {
    const h = v.startsWith("$") || v.startsWith("@") ? v.slice(1) : v;
    if (!HANDLE_RE.test(h)) fail("bad_link", `${PAY_NAMES[k]}: the name may use letters, digits, dot, dash and underscore only.`);
    if (k === "paypal") url = `https://paypal.me/${h}/${amt}USD`;
    else if (k === "venmo") url = `https://venmo.com/${h}?txn=pay&amount=${amt}&note=${pctEncode(ref)}`;
    else url = `https://cash.app/$${h}/${amt}`;
  } else if (k === "other" && v.startsWith("https://")) url = httpsLink(v, null);
  let text;
  if (k === "zelle") text = `Send with Zelle to ${v}. Put ${ref} in the memo.`;
  else if (k === "ach") text = `${v} Reference: ${ref}.`;
  else if (url) text = url;
  else text = v;
  return { label, kind: k, url, text };
}
function paymentOptions(settings, amount, ref) {
  const out = [];
  for (const ln of settings.payment_links) {
    try { out.push(paymentOption(ln, amount, ref)); } catch (e) { if (!(e instanceof ServiceError)) throw e; }
  }
  return out;
}
