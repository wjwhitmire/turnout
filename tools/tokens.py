"""Turnout design tokens: the values behind the color tokens in web/src/style.css, and the input to tools/check.py.

Concept: Shop Board and Tailgate. The chrome is asphalt and concrete; the only color on a working
screen is job state (the T-card tabs) and one hi-vis yellow plate for the key answer.
"""
SHARED = ["bg", "surface", "surface-2", "hair", "line", "fg", "muted", "accent", "accent-ink", "mark", "good", "warn", "bad",
          "field", "chart-1", "chart-2", "chart-3", "chart-4", "chart-grid"]
LOCAL = ["nav-bg", "nav-fg", "nav-muted", "nav-hover", "nav-sel", "nav-ind",
         "mark-ink", "reflect", "today", "sel", "row-hover", "drop",
         "st-sched", "st-prog", "st-done", "st-late", "st-bill", "st-hold", "st-ink",
         "paper", "paper-ink", "paper-muted", "paper-rule", "paper-mark"]

# Light: "Tailgate in daylight". Concrete page, white sheets, asphalt ink and asphalt buttons,
# hi-vis yellow only for the key answer plate, job state carried by six checked status colors.
LIGHT = {
    "bg": "#e7e9ec", "surface": "#ffffff", "surface-2": "#f0f2f4", "hair": "#d5d9de", "line": "#6f7681",
    "fg": "#121417", "muted": "#4c535d", "accent": "#1a1d21", "accent-ink": "#ffffff", "mark": "#ffd31a",
    "good": "#127c4a", "warn": "#5c2e05", "bad": "#c4300a", "field": "#ffffff",
    "chart-1": "#1a1d21", "chart-2": "#c2410c", "chart-3": "#8a919b", "chart-4": "#123382", "chart-grid": "#e1e4e8",
    "nav-bg": "#17191c", "nav-fg": "#f2f1ec", "nav-muted": "#a9aeb6", "nav-hover": "#23262b", "nav-sel": "#2e3238", "nav-ind": "#ffd31a",
    "mark-ink": "#121417", "reflect": "#aeb4bd", "today": "#fff5c7", "sel": "#eef1f5", "row-hover": "#f6f7f9", "drop": "#fff8d9",
    "st-sched": "#123382", "st-prog": "#9f10c1", "st-done": "#127c4a", "st-late": "#c4300a", "st-bill": "#5c2e05", "st-hold": "#5d636b",
    "st-ink": "#ffffff",
    "paper": "#ffffff", "paper-ink": "#121417", "paper-muted": "#4c535d", "paper-rule": "#121417", "paper-mark": "#ffd31a",
}
# Dark: "Cab before dawn". Dash charcoal, a warm dome-light white for actions, status colors lit
# like gauge lamps, and the hi-vis plate still yellow because reflective tape glows in headlights.
DARK = {
    "bg": "#111214", "surface": "#1b1d20", "surface-2": "#24272b", "hair": "#30343a", "line": "#7c838d",
    "fg": "#eeede8", "muted": "#aeb3ba", "accent": "#f1efe8", "accent-ink": "#17191c", "mark": "#ffd60a",
    "good": "#34e0a1", "warn": "#f1a842", "bad": "#fa7a67", "field": "#16181b",
    "chart-1": "#eeede8", "chart-2": "#ff8a4c", "chart-3": "#7d848e", "chart-4": "#5c8cef", "chart-grid": "#2b2e33",
    "nav-bg": "#0b0c0d", "nav-fg": "#eeede8", "nav-muted": "#a2a8b0", "nav-hover": "#191b1e", "nav-sel": "#262a30", "nav-ind": "#ffd60a",
    "mark-ink": "#121315", "reflect": "#8d949e", "today": "#2a2610", "sel": "#262a31", "row-hover": "#212428", "drop": "#2d2913",
    "st-sched": "#5c8cef", "st-prog": "#e095e3", "st-done": "#34e0a1", "st-late": "#fa7a67", "st-bill": "#f1a842", "st-hold": "#a2a8b0",
    "st-ink": "#121315",
    "paper": "#ffffff", "paper-ink": "#121417", "paper-muted": "#4c535d", "paper-rule": "#121417", "paper-mark": "#ffd31a",
}

# Job and visit states, their status token, glyph and the word that always travels with the color.
STATUS = [
    ("sched", "Scheduled", "ring", "On the board, not started. Also Upcoming, Today, Awaiting response, Awaiting payment."),
    ("prog", "In progress", "half", "Started and not finished: the crew is on the clock."),
    ("done", "Completed", "check", "Finished. Also Approved, Converted, Paid."),
    ("late", "Late", "alert", "End time passed without a finish, or an invoice past due."),
    ("bill", "Requires invoicing", "tag", "Work done, money not asked for. Also Changes requested."),
    ("hold", "Unscheduled", "dash", "No visit yet. Also Draft, Archived, Cancelled, Void (with a strike)."),
]
