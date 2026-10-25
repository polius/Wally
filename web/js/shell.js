/* The frame around every page: sidebar, phone tab bar, the person switch, routing and keys. */
import { $, t, esc, state, av, pname, icon, couple, savePrefs, emit, POST, MOD } from "./core.js";
import { hideTip, dialogOpen } from "./ui.js";

const PAGES = {
  dashboard: () => import("./pages/dashboard.js"),
  transactions: () => import("./pages/transactions.js"),
  recurring: () => import("./pages/recurring.js"),
  budgets: () => import("./pages/budgets.js"),
  settings: () => import("./pages/settings.js"),
  review: () => import("./pages/review.js"),
};
const NAV = [
  ["dashboard", "/", "overview", () => t("Dashboard")],
  ["transactions", "/transactions", "list", () => t("Transactions")],
  ["recurring", "/recurring", "repeat", () => t("Recurring")],
  ["budgets", "/budgets", "coin", () => t("Budgets")],
  ["settings", "/settings", "settings", () => t("Settings")],
];

let page = null;       // the page module on screen
let pageName = "";
let pageToken = 0;

/* ---------- routing ---------- */
export function route(path) {
  const [p, query] = (path || location.pathname + location.search).split("?");
  const parts = p.replace(/^\/+|\/+$/g, "").split("/");
  const name = parts[0] === "" ? "dashboard" : parts[0];
  return { name: PAGES[name] ? name : "dashboard", rest: parts.slice(1), query: new URLSearchParams(query || "") };
}
export function navigate(path, opts) {
  opts = opts || {};
  if (opts.replace) history.replaceState(opts.state || null, "", path);
  else if (path !== location.pathname + location.search) history.pushState(opts.state || null, "", path);
  return show();
}
export async function show() {
  const r = route();
  const token = ++pageToken;
  hideTip();
  const mod = await PAGES[r.name]();
  if (token !== pageToken) return;
  if (page && page.unmount) page.unmount();
  // Each page gets a fresh #main, so nothing a page attached to it outlives the page
  const old = $("main");
  const main = old.cloneNode(false);
  old.replaceWith(main);
  const same = pageName === r.name;
  pageName = r.name;
  page = mod;
  main.dataset.page = r.name;
  document.title = (r.name === "dashboard" ? "" : navLabel(r.name) + " · ") + "Wally";
  mod.mount(main, r);
  renderSide();
  renderTabbar();
  // Move focus to the new page, unless a dialog, the add sheet or the command bar opened meanwhile
  const overlay = dialogOpen() || !$("add-modal").hidden || !$("cmd").hidden;
  if (!same) { window.scrollTo(0, 0); if (!overlay) main.focus({ preventScroll: true }); }
}
function navLabel(name) { const n = NAV.find((x) => x[0] === name); return n ? n[3]() : name === "review" ? t("Month in review") : ""; }
/* Something changed (a save, an undo, the person switch): every visible figure is worked out again */
export function refresh(reason) {
  if (page && page.update) page.update(reason || {});
  renderSide();
  emit("change", reason || {});
}
export function currentPage() { return pageName; }

/* ---------- the person switch ---------- */
export function setScope(sc) {
  state.scope = sc;
  try { localStorage.setItem("wally.scope", sc); } catch (e) { /* fine */ }
  refresh({ scope: true });
}
function scopeButtons(cls) {
  const all = '<button type="button" data-scope="all" aria-pressed="' + (state.scope === "all") + '">' + av("all") + "<span>" + t("Everyone") + "</span><span>" + state.people.length + "</span></button>";
  return all + state.people.map((p) => {
    const k = String(p.id);
    return '<button type="button" data-scope="' + k + '" aria-pressed="' + (state.scope === k) + '">' + av(k) + "<span>" + esc(p.name) + "</span><span>" + (k === state.me ? t("You") : "") + "</span></button>";
  }).join("");
}

/* ---------- sidebar ---------- */
export function renderSide() {
  const side = $("side");
  if (!side) return;
  const s = state.status || {};
  const me = state.me;
  side.innerHTML =
    '<a class="w-brand" href="/" data-link><span class="w-mark"></span><span class="w-brand-t">Wally</span></a>' +
    '<button class="w-btn primary w-addbtn" type="button" data-open-add title="' + esc(t("Add")) + ' (N)">' + icon("plus") + '<span class="w-lbl">' + t("Add") + "</span><kbd>N</kbd></button>" +
    '<nav class="w-nav">' + NAV.map(([name, href, ic, label]) =>
      '<a href="' + href + '" data-link class="' + (pageName === name ? "on" : "") + '"' + (pageName === name ? ' aria-current="page"' : "") + ' title="' + esc(label()) + '">' + icon(ic) + '<span class="w-lbl">' + label() + "</span></a>").join("") + "</nav>" +
    (couple() ? '<div class="w-scope" role="group" aria-label="' + esc(t("Show money for")) + '"><div class="w-scope-h">' + t("Showing") + "</div>" + scopeButtons() + "</div>" +
      '<div class="w-scope-mini"><button type="button" class="w-scope-av" data-scope-menu aria-haspopup="true" aria-label="' + esc(t("Showing")) + '">' + av(state.scope) + "</button></div>" : "") +
    '<div class="w-side-foot">' +
      (me ? '<div class="w-me">' + av(me, "sm") + '<span class="w-lbl">' + esc(pname(me)) + "</span>" + (state.people.length > 1 ? '<button type="button" class="w-so" data-switch>' + t("Switch") + "</button>" : "") + "</div>" : "") +
      (s.signin ? '<button type="button" class="w-so" data-signout>' + t("Sign out") + "</button>" : "") +
    "</div>";
}

/* ---------- phone tab bar: Add in the middle, in thumb reach ---------- */
function renderTabbar() {
  const bar = $("tabbar");
  const tab = (name, href, ic, label) => '<a href="' + href + '" data-link class="' + (pageName === name ? "on" : "") + '"' + (pageName === name ? ' aria-current="page"' : "") + ">" + icon(ic) + "<span>" + label + "</span></a>";
  bar.innerHTML = tab("dashboard", "/", "overview", t("Dashboard")) + tab("transactions", "/transactions", "list", t("Transactions")) +
    '<button type="button" class="w-tabadd" data-open-add aria-label="' + esc(t("Add")) + '">' + icon("plus") + "</button>" +
    tab("recurring", "/recurring", "repeat", t("Recurring")) + tab("settings", "/settings", "settings", t("Settings"));
}

/* Person chips for the top of phone pages (the sidebar is gone there) */
export function scopeChips() {
  if (!couple()) return "";
  return '<div class="w-pchips" role="group" aria-label="' + esc(t("Show money for")) + '">' + scopeButtons() + "</div>";
}

/* ---------- hide amounts, for sharing a screen ---------- */
export function setHide(on) {
  state.hide = on;
  document.documentElement.classList.toggle("w-hide", on);
  try { localStorage.setItem("wally.hide", on ? "1" : ""); } catch (e) { /* fine */ }
}
export function setTheme(mode) {
  if (mode === "light" || mode === "dark") document.documentElement.setAttribute("data-theme", mode);
  else document.documentElement.removeAttribute("data-theme");
  // The browser bar follows the chosen theme; Auto lets each tag's media query pick
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    const dark = mode === "dark" || (mode !== "light" && m.media.includes("dark"));
    m.content = dark ? "#0E0F12" : "#F4F5F8";
  });
  try { localStorage.setItem("wally.theme", mode); } catch (e) { /* fine */ }
}
export function theme() { try { return localStorage.getItem("wally.theme") || "auto"; } catch (e) { return "auto"; } }

/* ---------- wiring ---------- */
let handlers = {};
export function setHandlers(h) { handlers = Object.assign(handlers, h); }
export function typing(ev) {
  const n = ev.target;
  return n && (n.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName));
}
export function initShell() {
  document.addEventListener("click", (ev) => {
    const a = ev.target.closest("a[data-link]");
    if (a && !ev.metaKey && !ev.ctrlKey && !ev.shiftKey && a.origin === location.origin) { ev.preventDefault(); navigate(a.pathname + a.search); return; }
    if (ev.target.closest("[data-open-add]")) { handlers.openAdd && handlers.openAdd(); return; }
    if (ev.target.closest("[data-open-cmd]")) { handlers.openCmd && handlers.openCmd(); return; }
    const sc = ev.target.closest("[data-scope]");
    if (sc) { setScope(sc.dataset.scope); return; }
    if (ev.target.closest("[data-scope-menu]")) { const order = ["all"].concat(state.people.map((p) => String(p.id))); setScope(order[(order.indexOf(state.scope) + 1) % order.length]); return; }
    if (ev.target.closest("[data-signout]")) { handlers.signOut && handlers.signOut(); return; }
    if (ev.target.closest("[data-switch]")) { handlers.switchPerson && handlers.switchPerson(); return; }
  });
  window.addEventListener("popstate", () => show());
  document.addEventListener("keydown", (ev) => {
    if (ev.defaultPrevented) return;
    const overlay = dialogOpen() || !$("add-modal").hidden || !$("cmd").hidden;
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "k") { ev.preventDefault(); if (!overlay || !$("cmd").hidden) handlers.openCmd && handlers.openCmd(); return; }
    if (overlay || typing(ev) || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const k = ev.key;
    if (k === "n" || k === "N") { ev.preventDefault(); handlers.openAdd && handlers.openAdd(); }
    else if (k === "h" || k === "H") { setHide(!state.hide); }
    else if (k === "/") { ev.preventDefault(); if (pageName !== "transactions") navigate("/transactions?focus=search"); else emit("focus-search"); }
    else if (page && page.key) page.key(ev);
  });
}
export { MOD };
export async function signOut() {
  try { await POST("/logout"); } catch (e) { /* signed out anyway */ }
  location.href = "/";
}
export { savePrefs };
