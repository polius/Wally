/* Start Wally: who is here, which screen comes first, then the app. */
import * as core from "./core.js";
import { $, t, state, GET, loadAll, loadLanguage, on, person, refreshToday, esc, TODAY, F, T } from "./core.js";
import { initToast, initDialogs } from "./ui.js";
import { initShell, show, setHandlers, setHide, signOut, refresh } from "./shell.js";

let vaultMod = null;   // js/vault/session.js, loaded only for an encrypted household
async function vaultSession() {
  if (!vaultMod) { vaultMod = await import("./vault/session.js"); vaultMod.bind(core); }
  return vaultMod;
}
function hadVault() { try { return localStorage.getItem("wally.vault") === "1"; } catch (e) { return false; } }

async function boot() {
  initToast();
  initDialogs();
  initShell();
  try { setHide(localStorage.getItem("wally.hide") === "1"); } catch (e) { /* fine */ }
  await enter();
}

/* Everything after the first paint. Also run again, without reloading, once this browser has
   unlocked an encrypted household, so keys kept only in memory are not lost. */
async function enter(soft) {
  if (soft) { $("gate").hidden = true; $("gate").innerHTML = ""; $("boot").hidden = false; }
  let status;
  try {
    status = await GET("/auth/status", { quiet401: true });
  } catch (e) {
    return fatal(t("Wally can’t be reached"), e.message);
  }
  state.status = status;
  await loadLanguage(status.language || "en");

  if (status.read_only) return fatal(t("Wally is read-only"), esc(status.read_only));
  banners(status);

  const v = status.vault || {};
  // Encryption turned off elsewhere, or this browser's sign-in ended: nothing of it stays here
  if (hadVault() && (!v.on || !status.signed_in)) await (await vaultSession()).forget();

  const gate = await import("./pages/signin.js");
  const done = (s) => (s ? enter(true) : location.reload());
  let next = nextGate(status);
  if (!next && v.on) {
    const session = await vaultSession();
    try {
      if (!(await session.resume(status))) next = "unlock";
    } catch (e) {
      if (e.status === 401) return location.reload();
      return fatal(t("Wally can’t be reached"), esc(e.message));
    }
    if (!next) { core.useVault(session); session.startSync(); }
  }
  if (next) {
    gate.mountGate($("gate"), next, status, done);
    $("gate").hidden = false;
    $("boot").hidden = true;
    return;
  }
  await startApp();
  if (v.on) catchUp();
}

/* With encryption on, this browser adds the recurring charges that are due, as the server does
   for a household without it. Two devices doing it at once add each charge once. */
async function catchUp() {
  try {
    const r = await (await vaultSession()).runEngine();
    if (r && r.added) await core.reloadAll();
  } catch (e) { /* tried again when the day changes */ }
}

/* Which full-screen step comes before the app, if any */
function nextGate(s) {
  if (s.signin && !s.signed_in) return "signin";
  if (!s.people.length && !s.onboarded) return "welcome";
  if (!s.people.length) return "people";
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
  await show();
  // Upgraded from 1.x: the welcome to 2.0, once for each person
  if (state.status && state.status.upgrade && state.status.me) (await import("./welcome.js")).welcomeOnce(state.status.upgrade);
  if (params.has("add")) { history.replaceState(null, "", location.pathname); add.openAdd(); }

  // A new day while Wally stays open: today moves, and the figures with it
  setInterval(() => { const before = TODAY; refreshToday(); if (TODAY !== before) { refresh({ day: true }); if (core.vaultOn()) catchUp(); } }, 60000);

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

/* The banner along the top: the demo, a conversion under way, and encryption turned off by someone */
const SEEN = "wally.seenEvents";
function banners(status) {
  const parts = [];
  if (status.demo) parts.push("<span><b>" + t("Demo.") + "</b> " + t("Sample data. Nothing you change is kept after the container stops.") + "</span>");
  const v = status.vault || {};
  if (v.paused) parts.push("<span><b>" + esc(v.paused.direction === "on" ? t("{name} is encrypting Wally.", { name: v.paused.by }) : t("{name} is turning off encryption.", { name: v.paused.by })) + "</b> " + t("Back in a minute.") + "</span>");
  if (v.required && !v.on && status.signed_in && status.onboarded) {
    parts.push("<span><b>" + t("This server keeps every household encrypted.") + "</b> " + t("Turn on encryption to add anything.") + ' <a class="w-link" href="/settings/privacy" data-link>' + t("Open Privacy") + "</a></span>");
  }
  let seen = [];
  try { seen = JSON.parse(localStorage.getItem(SEEN) || "[]"); } catch (e) { seen = []; }
  const name = (id) => { const p = (status.people || []).find((x) => x.id === id); return p ? p.name : t("Someone"); };
  const off = v.turned_off;
  if (off && !seen.includes("off:" + off.at) && status.signed_in) {
    parts.push('<span>' + esc(t("{name} turned off encryption on {date}. Whoever runs the server can read your data again.", { name: name(off.by), date: F.dayMonth ? F.dayMonth.format(T(off.at.slice(0, 10))) : off.at.slice(0, 10) })) +
      ' <button type="button" class="w-link" data-seen="off:' + esc(off.at) + '">' + t("OK") + "</button></span>");
  }
  if (!parts.length) { $("banner").hidden = true; return; }
  banner(parts.join(" "));
  $("banner").querySelectorAll("[data-seen]").forEach((b) => b.addEventListener("click", () => {
    seen.push(/^\d+$/.test(b.dataset.seen) ? Number(b.dataset.seen) : b.dataset.seen);
    try { localStorage.setItem(SEEN, JSON.stringify(seen.slice(-50))); } catch (e) { /* fine */ }
    b.parentElement.remove();
    if (!$("banner").textContent.trim()) $("banner").hidden = true;
  }));
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

on("signedout", async () => {
  // The session ended (a year, "Sign out others", a new password elsewhere): the key and the copy go too
  if (hadVault()) { try { await (await vaultSession()).forget(); } catch (e) { /* reloading anyway */ } }
  if (!$("app").hidden) location.reload();
});
on("remote", () => refresh({ data: true, remote: true }));
on("encrypted", () => location.reload());
boot();
