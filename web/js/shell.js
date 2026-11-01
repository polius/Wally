/* The frame around every page: sidebar, phone tab bar, the person switch, routing and keys. */
import { $, t, esc, state, av, pname, icon, couple, savePrefs, emit, POST, MOD } from "./core.js";
import { hideTip, dialogOpen } from "./ui.js";

const PAGES = {
  dashboard: () => import("./pages/dashboard.js"),
  transactions: () => import("./pages/transactions.js"),
  recurring: () => import("./pages/recurring.js"),
  settings: () => import("./pages/settings.js"),
  review: () => import("./pages/review.js"),
};
/* Places: three, plus Settings at the foot of the sidebar (and as a fourth tab on phones) */
const NAV = [
  ["dashboard", "/", "overview", () => t("Summary")],
  ["transactions", "/transactions", "list", () => t("Transactions")],
  ["recurring", "/recurring", "repeat", () => t("Recurring")],
];
const SETTINGS = ["settings", "/settings", "settings", () => t("Settings")];

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
function navLabel(name) { const n = NAV.concat([SETTINGS]).find((x) => x[0] === name); return n ? n[3]() : name === "review" ? t("Month in review") : ""; }
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
  closeMenus();
  refresh({ scope: true });
  document.querySelectorAll(".w-pswitch").forEach((w) => { w.outerHTML = scopeSwitch(); });
}
function scopeButtons() {
  const all = '<button type="button" role="menuitemradio" data-scope="all" aria-checked="' + (state.scope === "all") + '">' + av("all") + "<span>" + t("Everyone") + "</span><span>" + state.people.length + "</span></button>";
  return all + state.people.map((p) => {
    const k = String(p.id);
    return '<button type="button" role="menuitemradio" data-scope="' + k + '" aria-checked="' + (state.scope === k) + '">' + av(k) + "<span>" + esc(p.name) + "</span><span>" + (k === state.me ? t("You") : "") + "</span></button>";
  }).join("");
}
const navLink = ([name, href, ic, label]) =>
  '<a href="' + href + '" data-link class="' + (pageName === name ? "on" : "") + '"' + (pageName === name ? ' aria-current="page"' : "") + ' title="' + esc(label()) + '">' + icon(ic) + '<span class="w-lbl">' + label() + "</span></a>";

/* What the signed-in person can do from the foot of the sidebar */
function meActions() {
  const out = [];
  if (state.status && state.status.signin) out.push('<button type="button" role="menuitem" data-signout>' + icon("logout") + "<span>" + t("Sign out") + "</span></button>");
  else if (couple()) out.push('<button type="button" role="menuitem" data-switch>' + icon("users") + "<span>" + t("Switch person") + "</span></button>");
  return out.join("");
}

/* ---------- sidebar: places at the top, Settings and who is signed in at the foot ---------- */
export function renderSide() {
  const side = $("side");
  if (!side) return;
  const me = state.me, acts = meActions();
  side.innerHTML =
    '<a class="w-brand" href="/" data-link><span class="w-mark"></span><span class="w-brand-t">Wally</span></a>' +
    '<nav class="w-nav" aria-label="' + esc(t("Pages")) + '">' + NAV.map(navLink).join("") + "</nav>" +
    '<div class="w-sidefoot"><nav class="w-nav">' + navLink(SETTINGS) + "</nav>" +
    (me ? '<div class="w-me">' + (acts
      ? '<button type="button" class="w-meb" data-menu="me" aria-haspopup="menu" aria-expanded="false">' + av(me) + '<span class="w-lbl">' + esc(pname(me)) + "</span></button>" +
        '<div class="w-menu w-memenu" role="menu" hidden>' + acts + "</div>"
      : '<a class="w-meb" href="/settings/people" data-link>' + av(me) + '<span class="w-lbl">' + esc(pname(me)) + "</span></a>") + "</div>" : "") + "</div>";
}

/* ---------- phone tab bar: the places and Settings, with Add in the middle, in thumb reach ---------- */
function renderTabbar() {
  const bar = $("tabbar");
  const tab = (name, href, ic, label) => '<a href="' + href + '" data-link class="' + (pageName === name ? "on" : "") + '"' + (pageName === name ? ' aria-current="page"' : "") + ">" + icon(ic) + "<span>" + label() + "</span></a>";
  const tabs = NAV.concat([SETTINGS]).map((n) => tab(...n));
  bar.innerHTML = '<div class="w-tabpill">' + tabs.slice(0, 2).join("") +
    '<button type="button" class="w-tabadd" data-open-add aria-label="' + esc(t("Add")) + '">' + icon("plus") + "</button>" + tabs.slice(2).join("") + "</div>";
}

/* Person chips, for Month in review's story */
export function scopeChips() {
  if (!couple()) return "";
  return '<div class="w-pchips" role="group" aria-label="' + esc(t("Show money for")) + '">' + scopeButtons().replace(/role="menuitemradio"/g, "").replace(/aria-checked=/g, "aria-pressed=") + "</div>";
}
/* The person menu at the top right of a page: whose money is shown ("Everyone ▾"). On a phone,
   where the sidebar is gone, it also holds Switch person or Sign out. */
export function scopeSwitch() {
  const acts = meActions(), phoneActs = acts ? '<div class="w-menusep w-ponly" role="separator"></div>' + acts.replace(/role="menuitem"/g, 'role="menuitem" class="w-ponly"') : "";
  if (!couple()) {
    // Alone: nothing to switch; phones still need a way to sign out
    if (!acts || !state.me) return "";
    return '<div class="w-pswitch w-ponly"><button type="button" class="w-pswitch-b" data-menu="scope" aria-haspopup="menu" aria-expanded="false" aria-label="' + esc(pname(state.me)) + '">' +
      av(state.me) + icon("down") + '</button><div class="w-menu w-pswitch-m" role="menu" hidden>' + acts + "</div></div>";
  }
  const who = state.scope === "all" ? t("Everyone") : pname(state.scope);
  return '<div class="w-pswitch"><button type="button" class="w-pswitch-b" data-menu="scope" aria-haspopup="menu" aria-expanded="false" aria-label="' + esc(t("Showing") + ": " + who) + '">' +
    av(state.scope) + '<span class="w-pswho">' + esc(who) + "</span>" + icon("down") + '</button><div class="w-menu w-pswitch-m" role="menu" aria-label="' + esc(t("Show money for")) + '" hidden>' + scopeButtons() + phoneActs + "</div></div>";
}
/* The page's own actions: the person menu, then Add (phones add from the tab bar) */
export function headActions(extra) {
  return '<div class="w-hact">' + (extra || "") + scopeSwitch() +
    '<button type="button" class="w-btn primary w-hadd" data-open-add title="' + esc(t("Add")) + ' (N)">' + icon("plus") + "<span>" + t("Add") + "</span><kbd>N</kbd></button></div>";
}

/* ---------- menus: one open at a time, Escape and a click outside close it ---------- */
export function closeMenus(focusBack) {
  document.querySelectorAll(".w-menu:not([hidden])").forEach((m) => {
    m.hidden = true;
    const b = m.previousElementSibling;
    if (b) { b.setAttribute("aria-expanded", "false"); if (focusBack) b.focus(); }
  });
}
export function toggleMenu(b) {
  const m = b.nextElementSibling, was = !m.hidden;
  closeMenus();
  if (was) return;
  m.hidden = false;
  b.setAttribute("aria-expanded", "true");
  (m.querySelector('[aria-checked="true"]') || m.querySelector("button,a")).focus();
}
function menuKeys(ev) {
  const m = ev.target.closest(".w-menu");
  if (!m) return false;
  const items = [...m.querySelectorAll("button,a")].filter((n) => n.offsetParent !== null);
  const i = items.indexOf(document.activeElement);
  if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    ev.preventDefault();
    const k = ev.key === "ArrowDown" ? 1 : -1;
    items[(i + k + items.length) % items.length].focus();
    return true;
  }
  if (ev.key === "Tab") { closeMenus(); return false; }
  return false;
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
    const mb = ev.target.closest("[data-menu]");
    if (mb) { toggleMenu(mb); return; }
    const inMenu = ev.target.closest(".w-menu");
    if (!inMenu || ev.target.closest("a,button")) closeMenus();
    const sc = ev.target.closest("[data-scope]");
    if (sc) { setScope(sc.dataset.scope); return; }
    if (ev.target.closest("[data-signout]")) { handlers.signOut && handlers.signOut(); return; }
    if (ev.target.closest("[data-switch]")) { handlers.switchPerson && handlers.switchPerson(); return; }
  });
  window.addEventListener("popstate", () => show());
  document.addEventListener("keydown", (ev) => {
    if (ev.defaultPrevented) return;
    if (ev.key === "Escape" && document.querySelector(".w-menu:not([hidden])")) { ev.preventDefault(); closeMenus(true); return; }
    if (menuKeys(ev)) return;
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
  // An encrypted household's key and copy leave this browser with you
  try { if (localStorage.getItem("wally.vault") === "1") await (await import("./vault/session.js")).forget(); } catch (e) { /* signing out anyway */ }
  try { await POST("/logout"); } catch (e) { /* signed out anyway */ }
  location.href = "/";
}
export { savePrefs };
