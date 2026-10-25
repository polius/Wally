/* Start Wally: who is here, which screen comes first, then the app. */
import { $, t, state, GET, loadAll, loadLanguage, on, person, refreshToday, esc, TODAY } from "./core.js";
import { initToast, initDialogs } from "./ui.js";
import { initShell, show, setHandlers, setHide, signOut, navigate, refresh } from "./shell.js";

async function boot() {
  initToast();
  initDialogs();
  initShell();
  try { setHide(localStorage.getItem("wally.hide") === "1"); } catch (e) { /* fine */ }

  let status;
  try {
    status = await GET("/auth/status", { quiet401: true });
  } catch (e) {
    return fatal(t("Wally can’t be reached"), e.message);
  }
  state.status = status;
  await loadLanguage(status.language || "en");

  if (status.read_only) return fatal(t("Wally is read-only"), esc(status.read_only));
  if (status.demo) banner("<b>" + t("Demo.") + "</b> " + t("Sample data. Nothing you change is kept after the container stops."));

  const gate = await import("./pages/signin.js");
  const next = nextGate(status);
  if (next) {
    gate.mountGate($("gate"), next, status, () => location.reload());
    $("gate").hidden = false;
    $("boot").hidden = true;
    return;
  }
  await startApp();
}

/* Which full-screen step comes before the app, if any */
function nextGate(s) {
  if (s.signin && !s.signed_in) return "signin";
  if (!s.people.length && !s.onboarded) return "welcome";
  if (!s.people.length) return "people";
  if (s.must_change_password) return "password";
  if (s.needs_two_step) return "twostep";
  if (!s.signin) {
    // With sign-in off, Wally asks who you are once on each browser, and takes it on trust
    let who = null;
    try { who = localStorage.getItem("wally.person"); } catch (e) { /* fine */ }
    if (!who || !s.people.some((p) => String(p.id) === who)) {
      if (s.people.length === 1) localStorage.setItem("wally.person", String(s.people[0].id));
      else return "who";
    }
  }
  return null;
}

async function startApp() {
  try {
    await loadAll();
  } catch (e) {
    if (e.status === 401) return location.reload();
    return fatal(t("Wally can’t be reached"), e.message);
  }
  let scope = "all";
  try { scope = localStorage.getItem("wally.scope") || "all"; } catch (e) { /* fine */ }
  state.scope = scope === "all" || person(scope) ? scope : "all";

  const add = await import("./add.js");
  const cmd = await import("./cmd.js");
  setHandlers({
    openAdd: (o) => add.openAdd(o),
    openCmd: () => cmd.openCmd(),
    signOut,
    switchPerson,
  });

  $("boot").hidden = true;
  $("app").hidden = false;
  const params = new URLSearchParams(location.search);
  // Wally opens on the page chosen in Settings, unless a link says otherwise
  const open = state.config.open_on;
  if (location.pathname === "/" && open && open !== "dashboard" && !params.has("add")) await navigate("/" + open, { replace: true });
  else await show();
  if (params.has("add")) { history.replaceState(null, "", location.pathname); add.openAdd(); }

  const review = await import("./pages/review.js");
  review.maybeShowOnFirstOfMonth && review.maybeShowOnFirstOfMonth();

  // A new day while Wally stays open: today moves, and the figures with it
  setInterval(() => { const before = TODAY; refreshToday(); if (TODAY !== before) refresh({ day: true }); }, 60000);

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("/sw.js").catch(() => { /* works without it */ });
  }
  add.flushQueue && add.flushQueue();
}

async function switchPerson() {
  if (state.status && state.status.signin) return signOut();
  try { localStorage.removeItem("wally.person"); } catch (e) { /* fine */ }
  location.href = "/";
}

function banner(msg) {
  const b = $("banner");
  b.innerHTML = msg;
  b.hidden = false;
  const measure = () => document.documentElement.style.setProperty("--banner-h", b.offsetHeight + "px");
  measure();
  new ResizeObserver(measure).observe(b);
}
function fatal(title, body) {
  $("boot").hidden = true;
  const g = $("gate");
  g.innerHTML = '<div class="w-gatecard" role="alert"><span class="w-mark lg"></span><h1>' + title + "</h1><p>" + (body || "") + '</p><button type="button" class="w-btn primary" onclick="location.reload()">' + t("Try again") + "</button></div>";
  g.hidden = false;
}

on("signedout", () => { if (!$("app").hidden) location.reload(); });
boot();
