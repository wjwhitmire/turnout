"""Payment links and instructions printed on quotes and invoices.

The business pastes its own link or handle in Settings. Nothing here contacts a payment
service: the link is text on the page and in the QR code, and the client's own phone opens
it. Card data never touches this program. When the money arrives, the person records the
payment.

  stripe   a Stripe Payment Link (https://buy.stripe.com/...); the document number is added
           as client_reference_id
  square   a Square payment link (https://square.link/... or https://checkout.square.site/...)
  paypal   a PayPal.Me name; the link carries the amount (paypal.me/name/12.34USD)
  venmo    a Venmo user name; the link carries the amount and a note
  cashapp  a Cash App $Cashtag; the link carries the amount
  zelle    the email or phone the business receives Zelle payments at (instructions only)
  ach      bank transfer instructions (instructions only)
  other    any https link, or instructions
"""

from __future__ import annotations

import re

from .util import ServiceError, cents_text, fail, lower, strip

HANDLE = re.compile(r"[A-Za-z0-9_.-]{1,60}")
HOSTS = {"stripe": ("buy.stripe.com",), "square": ("square.link", "checkout.square.site")}
NAMES = {"stripe": "Pay by card", "square": "Pay by card", "paypal": "PayPal", "venmo": "Venmo",
         "cashapp": "Cash App", "zelle": "Zelle", "ach": "Bank transfer", "other": "Pay online"}


def _https(url: str, hosts) -> str:
    m = re.fullmatch(r"https://([A-Za-z0-9.-]{1,253})(/[A-Za-z0-9._~%/?#=&+:@!$'()*,;-]*)?", url)
    if not m:
        fail("bad_link", "The payment link must be a full https:// address without spaces.")
    host = lower(m.group(1))
    if hosts and host not in hosts:
        fail("bad_link", f"A {hosts[0]} link was expected, not {host}.")
    return url


def _enc(s: str) -> str:
    out = []
    for b in s.encode("utf-8"):
        c = chr(b)
        if ("A" <= c <= "Z") or ("a" <= c <= "z") or ("0" <= c <= "9") or c in "-_.~":
            out.append(c)
        else:
            out.append("%" + format(b, "02X"))
    return "".join(out)


def check_link(link: dict) -> None:
    """Refuse a payment link setting that would print a broken or unexpected link."""
    payment_option(link, 100, "CHECK")


def payment_option(link: dict, amount: int, ref: str) -> dict:
    """{label, kind, url, text} for one payment setting, for a document of amount cents
    numbered ref. url is "" for instructions."""
    k = link["kind"]
    v = strip(link["value"])
    label = link["label"] or NAMES[k]
    amt = cents_text(max(amount, 0))
    url = ""
    if k in ("stripe", "square"):
        url = _https(v, HOSTS[k])
        if k == "stripe":
            safe = re.sub(r"[^A-Za-z0-9_-]", "-", ref)[:200]
            url = url + ("&" if "?" in url else "?") + "client_reference_id=" + safe
    elif k in ("paypal", "venmo", "cashapp"):
        h = v[1:] if v.startswith("$") or v.startswith("@") else v
        if not HANDLE.fullmatch(h):
            fail("bad_link", f"{NAMES[k]}: the name may use letters, digits, dot, dash and underscore only.")
        if k == "paypal":
            url = f"https://paypal.me/{h}/{amt}USD"
        elif k == "venmo":
            url = f"https://venmo.com/{h}?txn=pay&amount={amt}&note={_enc(ref)}"
        else:
            url = f"https://cash.app/${h}/{amt}"
    elif k == "other" and v.startswith("https://"):
        url = _https(v, None)
    if k == "zelle":
        text = f"Send with Zelle to {v}. Put {ref} in the memo."
    elif k == "ach":
        text = f"{v} Reference: {ref}."
    elif url:
        text = url
    else:
        text = v
    return {"label": label, "kind": k, "url": url, "text": text}


def payment_options(settings: dict, amount: int, ref: str) -> list:
    """Every configured payment option for a document. A setting that no longer passes
    its check is left out rather than printed."""
    out = []
    for ln in settings["payment_links"]:
        try:
            out.append(payment_option(ln, amount, ref))
        except ServiceError:  # a bad setting is skipped; the Settings page shows why
            continue
    return out
