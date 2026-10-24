"""Draft wording for reminders (email and text), and date and time words.

Drafts are plain text. The person reviews every draft in the reminders queue and sends it
from their own email or phone; nothing is sent by the program.
"""

from __future__ import annotations

from .util import money, parse_date, parse_time, weekday

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
WDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def date_words(s: str) -> str:
    """'2026-10-06' to 'Tue, Oct 6, 2026'."""
    y, m, d = parse_date(s)
    return f"{WDAYS[weekday(s) - 1]}, {MONTHS[m - 1]} {d}, {y}"


def time_words(t: str) -> str:
    """'13:05' to '1:05 PM'; '' to 'any time'."""
    if not t:
        return "any time"
    m = parse_time(t)
    h = (m // 60) % 24
    ap = "AM" if h < 12 else "PM"
    h12 = h % 12 or 12
    return f"{h12}:{m % 60:02d} {ap}"


def hm(minutes: int) -> str:
    """Minutes as h:mm."""
    sign = "-" if minutes < 0 else ""
    minutes = abs(minutes)
    return f"{sign}{minutes // 60}:{minutes % 60:02d}"


def first_name(name: str) -> str:
    parts = name.split(" ")
    return parts[0] if parts and parts[0] else name


def address_line(p) -> str:
    if p is None:
        return ""
    bits = [p["street"], " ".join(x for x in [p["city"], p["state"], p["zip"]] if x)]
    return ", ".join(b for b in bits if b)


def signature(s: dict) -> str:
    return "\n".join(x for x in [s["business_name"], s["phone"], s["email"]] if x)


def pay_lines(s: dict, links: list) -> str:
    if not links:
        return ""
    out = ["", "Ways to pay:"]
    for ln in links:
        out.append(f"- {ln['label']}: {ln['text']}")
    return "\n".join(out)


def visit_reminder(s: dict, client: dict, prop, job: dict, visit: dict, channel: str) -> dict:
    biz = s["business_name"] or "We"
    when = date_words(visit["date"])
    at = f" at {time_words(visit['start_time'])}" if visit["start_time"] else " (any time that day)"
    where = address_line(prop)
    if channel == "text":
        body = (f"{biz}: reminder of your visit on {when}{at}"
                + (f" at {where}" if where else "") + ". Reply here to change it.")
        return {"subject": "", "body": body}
    body = (f"Hi {first_name(client['name'])},\n\n"
            f"This is a reminder that {biz} is scheduled for {job['title']} on {when}{at}"
            + (f" at {where}" if where else "") + ".\n\n"
            "If that time no longer works, reply to this message and we will find another.\n\n" + signature(s))
    return {"subject": f"Reminder: visit on {when}", "body": body}


def overdue_reminder(s: dict, client: dict, inv: dict, state: dict, days: int, links: list, channel: str) -> dict:
    biz = s["business_name"] or "Our office"
    if channel == "text":
        body = (f"{biz}: invoice {inv['number']} for {money(state['balance'])} was due "
                f"{date_words(inv['due_date'])}. "
                + (f"Pay: {links[0]['text']}" if links else "Reply here with any questions."))
        return {"subject": "", "body": body}
    body = (f"Hi {first_name(client['name'])},\n\n"
            f"Invoice {inv['number']} for {money(state['total'])} was due on {date_words(inv['due_date'])}, "
            f"{days} day{'s' if days != 1 else ''} ago. The balance is {money(state['balance'])}.\n"
            + pay_lines(s, links) + "\n\n"
            "If you have already paid, thank you, and please ignore this note.\n\n" + signature(s))
    return {"subject": f"Invoice {inv['number']} is past due", "body": body}


def quote_followup(s: dict, client: dict, q: dict, total: int, channel: str) -> dict:
    biz = s["business_name"] or "We"
    if channel == "text":
        body = (f"{biz}: checking in on quote {q['number']} ({money(total)}) sent {date_words(q['sent_date'])}. "
                "Any questions?")
        return {"subject": "", "body": body}
    body = (f"Hi {first_name(client['name'])},\n\n"
            f"We sent quote {q['number']} for {q['title'] or 'the work you asked about'} ({money(total)}) on "
            f"{date_words(q['sent_date'])}. Do you have any questions, or would you like to go ahead?"
            + (f" The quote is good through {date_words(q['valid_until'])}." if q["valid_until"] else "")
            + "\n\n" + signature(s))
    return {"subject": f"Following up on quote {q['number']}", "body": body}


def pick_channel(client: dict):
    """The client's preferred channel if they have that contact, else the other one, else
    None."""
    has = {"email": bool(client["email"]), "text": bool(client["phone"])}
    if has[client["prefer"]]:
        return client["prefer"]
    other = "text" if client["prefer"] == "email" else "email"
    return other if has[other] else None


def contact_for(client: dict, channel: str) -> str:
    return client["email"] if channel == "email" else client["phone"]
