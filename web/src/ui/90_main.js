// ---------------------------------------------------------------- start
async function loadKv() {
  const keys = (await idb("kv", "readonly", (s) => s.getAllKeys())) || [];
  for (const k of keys) APP.kv[k] = await dbGet("kv", k);
}
function wireShell() {
  const mb = $("menu-btn");
  mb.append(icon("menu"));
  mb.addEventListener("click", () => ($("nav").classList.contains("open") ? closeDrawer() : openDrawer()));
  $("scrim").addEventListener("click", closeDrawer);
  const cb = $("create-btn");
  cb.append(icon("plus"), el("span", { text: "Create" }), el("kbd", { cls: "only-wide", text: "N" }));
  cb.addEventListener("click", createMenu);
  $("theme-btn").addEventListener("click", () => {
    const dark = document.documentElement.getAttribute("data-theme") === "dark" || (!document.documentElement.getAttribute("data-theme") && matchMedia("(prefers-color-scheme: dark)").matches);
    setTheme(dark ? "light" : "dark");
  });
  const hb = $("help-btn");
  hb.append(icon("help"));
  hb.addEventListener("click", () => { const d = $("method"); d.open = true; d.scrollIntoView({ block: "start" }); d.querySelector("summary").focus(); });
  const q = inp("search", "", { id: "top-search", placeholder: "Search clients", "aria-label": "Search clients" });
  q.addEventListener("keydown", (e) => { if (e.key === "Enter") { setUi("client_q", q.value); setUi("client_f", "all"); go("clients"); } });
  $("search-box").append(icon("search"), q);
  if (window.matchMedia) matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
  applyTheme();
  window.addEventListener("hashchange", render);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $("nav").classList.contains("open")) { closeDrawer(); mb.focus(); return; }
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === "n" && !e.ctrlKey && !e.metaKey && !e.altKey && !document.querySelector("dialog[open]")) { e.preventDefault(); createMenu(); }
  });
}
async function boot() {
  try {
    APP.db = await idbOpen();
    await loadKv();
  } catch (e) {
    APP.db = null;
    toast("This browser is not keeping data here (private window or storage blocked). Changes last until the tab closes.", "warn");
  }
  // ?asof=YYYY-MM-DD pins "today" for the test runs. The rules act on that date, so a link must
  // not be able to set it: it is honored only on this computer's own test server.
  const m = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? /[?&]asof=([0-9]{4}-[0-9]{2}-[0-9]{2})/.exec(location.search) : null;
  if (m) { try { C.parse_date(m[1]); APP.kv.today = m[1]; } catch (e) { /* ignore a bad date */ } }
  let book = null;
  try { book = APP.db ? await dbGet("book", "current") : null; } catch (e) { book = null; }
  if (book) {
    try { book = C.validate_book(book); } catch (e) {
      await dbPut("kv", "unreadable:" + Date.now(), book).catch(() => {});
      toast("The data on this device did not pass its check, so a copy was set aside and the example was loaded. Restore a backup from Settings.", "bad");
      book = null;
    }
  }
  if (!book) book = JSON.parse(JSON.stringify(C.EXAMPLE_BOOK));
  APP.book = book;
  APP.packet = APP.kv.packet || null;
  await saveBook().catch(() => {});
  wireShell();
  // The app must open even if the rules cannot run on this data; the person can still fix it.
  let out = [APP.book, []];
  try { out = C.run_automations(APP.book, T(), nowStamp()); } catch (e) { showError(e); }
  if (out[1].length) { APP.book = out[0]; await saveBook().catch(() => {}); }
  render();
  if (out[1].length) announceAutomations(out[1]);
  document.body.dataset.ready = "1";
}
// the Pages build marks the page when another site frames it; the app is then not mounted at all
if (!document.documentElement.hasAttribute("data-framed")) boot();
