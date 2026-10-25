/* Dashboard: are we on track, where did it go, and what's coming.
   The lead panel (status, main chart, key figures) and up to twelve widgets, chosen under
   Customize and saved per person. Under 768 px it switches to the compact phone layout. */
import { state, t, esc, icon, couple, savePrefs, rerank, on, MOD } from "../core.js";
import { navigate, scopeChips } from "../shell.js";
import { hideTip, openDialog, empty } from "../ui.js";
import { view, loadRange, setMode, setMonth, stepMonth, canStep, rangeOf, goTx, openRange, openRangeSheet, MODES } from "./dashboard/range.js";
import { heroHtml, renderHero } from "./dashboard/hero.js";
import { WIDGETS } from "./dashboard/widgets.js";
import { phoneHeader, phoneHtml, renderPhone } from "./dashboard/phone.js";

const ORDER = ["hero", "cats", "upcoming", "savings", "unusual", "flow", "cal", "people", "weekday", "subs", "trends", "recent", "payees"];
/* Pairs side by side on wide screens; single keys take the full width */
const ROWS = [["hero"], ["cats", "upcoming"], ["savings", "unusual"], ["flow"], ["cal", "people"], ["weekday", "subs"], ["trends"], ["recent", "payees"]];
const DEFAULT = { hero: 1, cats: 1, upcoming: 1, savings: 1, unusual: 1, recent: 1 };
const phoneMQ = matchMedia("(max-width: 767px)");

let root = null, layoutKey = "", mounted = false;

/* ---------- which widgets show ---------- */
function available(k) { return k === "hero" || !WIDGETS[k].when || WIDGETS[k].when(); }
function shown(k) {
  if (!available(k)) return false;
  const w = state.prefs.widgets;
  return w && typeof w[k] === "boolean" ? w[k] : !!DEFAULT[k];
}
function widgetLabel(k) { return k === "hero" ? t("Status and spending") : WIDGETS[k].label(); }
function isDefault() { return ORDER.filter(available).every((k) => shown(k) === !!DEFAULT[k]); }
function allShown() { return ORDER.filter(available).every(shown); }

/* ---------- layout ---------- */
function header() {
  const modes = [["month", t("Month")], ["3m", t("3 months")], ["year", t("Year")], ["12m", t("12 months")], ["custom", t("Custom…")]];
  return '<header class="w-head d-head">' +
    '<div class="w-title"><h3 id="d-title"></h3></div>' +
    '<div class="w-step" id="d-step"><button type="button" id="d-prev" aria-label="' + esc(t("Previous month")) + '">' + icon("left") + '</button><button type="button" id="d-next" aria-label="' + esc(t("Next month")) + '">' + icon("right") + "</button></div>" +
    '<div class="d-rangewrap"><div class="w-seg" id="d-range" role="group" aria-label="' + esc(t("Range")) + '">' +
      modes.map(([k, l], i) => '<button type="button" data-mode="' + k + '" aria-keyshortcuts="' + (i + 1) + '" title="' + esc(l.replace("…", "") + " (" + (i + 1) + ")") + '">' + l + "</button>").join("") + "</div></div>" +
    '<div class="w-head-r">' +
      '<button type="button" class="w-search w-kbtn d-search" data-d-cmd>' + icon("search") + "<span>" + t("Search or jump") + "</span><kbd>" + MOD + "K</kbd></button>" +
      '<button type="button" class="w-btn ghost" id="d-cust" aria-expanded="false" aria-controls="d-custpop">' + icon("layout") + t("Customize") + "</button>" +
      '<button type="button" class="w-btn ghost d-more" id="d-menu" aria-expanded="false" aria-controls="d-menupop" aria-label="' + esc(t("More")) + '">' + icon("more") + "</button>" +
    "</div>" +
    '<div class="w-pop d-pop" id="d-custpop" role="group" aria-label="' + esc(t("Show on dashboard")) + '" hidden></div>' +
    '<div class="w-pop d-pop d-menupop" id="d-menupop" hidden>' +
      '<button type="button" class="d-mi" data-review>' + icon("history") + t("Month in review") + "</button>" +
      (couple() ? '<button type="button" class="d-mi" data-settle>' + icon("users") + t("Settle up") + "</button>" : "") +
    "</div></header>";
}
function customizeHtml() {
  const n = ORDER.filter(available).length;
  return "<h6>" + t("Show on dashboard") + '</h6><div class="d-custlist">' + ORDER.filter(available).map((k) =>
    '<label><input type="checkbox" data-cw="' + k + '"' + (shown(k) ? " checked" : "") + ">" + esc(widgetLabel(k)) + "</label>").join("") + "</div>" +
    '<button type="button" class="w-link d-custall" data-cust-all>' + (allShown() ? t("Back to the default six") : t("Show all {n} widgets", { n })) + "</button>";
}
function desktopHtml() {
  return header() + ROWS.map((keys) => {
    const html = keys.filter(available).map((k) => (k === "hero" ? heroHtml() : WIDGETS[k].html())).join("");
    return keys.length > 1 ? '<div class="w-grid2">' + html + "</div>" : html;
  }).join("");
}
function emptyHtml() {
  return '<header class="w-head d-head"><div class="w-title"><h3>' + t("Dashboard") + "</h3></div></header>" + (phoneMQ.matches ? scopeChips() : "") +
    '<section class="w-panel d-welcome">' + empty("overview", t("Nothing here yet"), t("Add the first expense or income, or import a CSV from your bank. The Dashboard fills in from there."),
      '<div class="d-emptyb"><a class="w-btn ghost" href="/settings/import" data-link>' + t("Import") + '</a><button type="button" class="w-btn ghost" data-add-income>' + t("Add income") +
      '</button><button type="button" class="w-btn primary" data-open-add>' + t("Add expense") + "</button></div>") + "</section>";
}

function layout() {
  const none = !state.tx.length, phone = phoneMQ.matches;
  layoutKey = (none ? "empty" : phone ? "phone" : "desk") + ":" + state.people.length;
  hideTip();
  if (none) root.innerHTML = emptyHtml();
  else if (phone) root.innerHTML = '<div id="d-phead"></div>' + phoneHtml(shown);
  else root.innerHTML = desktopHtml();
  root.classList.toggle("d-phone", phone && !none);
  if (!none) render();
}

/* ---------- drawing ---------- */
function renderHead(r) {
  if (phoneMQ.matches) { document.getElementById("d-phead").innerHTML = phoneHeader(r); return; }
  document.getElementById("d-title").innerHTML = esc(r.title) + (r.sub ? " <span" + (r.month ? "" : ' class="sm"') + ">" + esc(r.sub) + "</span>" : "");
  root.querySelectorAll("#d-range [data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(view.mode === b.dataset.mode)));
  root.querySelector('#d-range [data-mode="custom"]').textContent = view.mode === "custom" ? t("Custom: {range}", { range: r.title }) : t("Custom…");
  document.getElementById("d-step").style.visibility = view.mode === "month" ? "visible" : "hidden";
  document.getElementById("d-prev").disabled = !canStep(-1);
  document.getElementById("d-next").disabled = !canStep(1);
}
function applyVisibility() {
  root.querySelectorAll("[data-w]").forEach((p) => { if (WIDGETS[p.dataset.w] || p.dataset.w === "hero") p.hidden = !shown(p.dataset.w); });
  root.querySelectorAll(".w-grid2").forEach((g) => {
    const vis = [...g.children].filter((c) => !c.hidden);
    g.hidden = !vis.length;
    g.classList.toggle("solo", vis.length === 1);
  });
}
function render() {
  const r = rangeOf();
  rerank(r.start, r.end, "all");
  renderHead(r);
  if (phoneMQ.matches) { renderPhone(r, shown); return; }
  applyVisibility();
  if (shown("hero")) renderHero(r);
  ORDER.forEach((k) => { if (k !== "hero" && shown(k)) WIDGETS[k].render(r); });
}
function renderOne(k) {
  const r = rangeOf();
  if (k === "hero") renderHero(r); else WIDGETS[k].render(r);
}

/* ---------- popovers: Customize and the menu ---------- */
function popOpen(id) { const p = document.getElementById(id); return p && !p.hidden; }
function closePops(focusBack) {
  [["d-custpop", "d-cust"], ["d-menupop", "d-menu"]].forEach(([pid, bid]) => {
    const p = document.getElementById(pid), b = document.getElementById(bid);
    if (p && !p.hidden) { p.hidden = true; if (b) { b.setAttribute("aria-expanded", "false"); if (focusBack) b.focus(); } }
  });
}
function togglePop(pid, bid) {
  const p = document.getElementById(pid), was = !p.hidden;
  closePops();
  if (was) return;
  if (pid === "d-custpop") p.innerHTML = customizeHtml();
  p.hidden = false;
  document.getElementById(bid).setAttribute("aria-expanded", "true");
  const first = p.querySelector("input,button");
  if (first) first.focus();
}
function openCustomizeSheet() {
  openDialog({
    title: t("Show on dashboard"), ok: t("Done"), noCancel: true, body: '<div class="d-custsheet">' + customizeHtml().replace(/^<h6>.*?<\/h6>/, "") + "</div>",
    onOpen(dlg) {
      dlg.addEventListener("change", (ev) => { if (ev.target.dataset.cw) setWidget(ev.target.dataset.cw, ev.target.checked); });
      dlg.addEventListener("click", (ev) => { if (ev.target.closest("[data-cust-all]")) { toggleAll(); dlg.querySelector(".d-custsheet").innerHTML = customizeHtml().replace(/^<h6>.*?<\/h6>/, ""); } });
    },
    onOk() { layout(); },
  });
}
function setWidget(k, on) {
  const w = Object.assign({}, state.prefs.widgets || {});
  ORDER.forEach((x) => { if (typeof w[x] !== "boolean") w[x] = !!DEFAULT[x]; });
  w[k] = on;
  savePrefs({ widgets: w });
  if (phoneMQ.matches) return; // the sheet redraws the page when it closes
  applyVisibility();
  if (on) renderOne(k);
  const all = root.querySelector("[data-cust-all]");
  if (all) all.textContent = allShown() ? t("Back to the default six") : t("Show all {n} widgets", { n: ORDER.filter(available).length });
}
function toggleAll() {
  const showAll = !allShown(), w = {};
  ORDER.forEach((k) => { w[k] = showAll || !!DEFAULT[k]; });
  savePrefs({ widgets: w });
  if (phoneMQ.matches) return;
  const p = document.getElementById("d-custpop");
  p.innerHTML = customizeHtml();
  render();
  p.querySelector("[data-cust-all]").focus();
}

/* ---------- events ---------- */
function rangeChanged() { closePops(); render(); }
function onClick(ev) {
  const tgt = ev.target;
  if (!tgt.closest("#d-custpop,#d-cust,#d-menupop,#d-menu")) closePops();
  const b = (sel) => tgt.closest(sel);
  let x;
  if ((x = b("[data-mode]"))) {
    if (x.dataset.mode === "custom") { openRange(rangeOf(), rangeChanged); return; }
    setMode(x.dataset.mode); rangeChanged(); return;
  }
  if (b("#d-prev")) { if (stepMonth(-1)) rangeChanged(); return; }
  if (b("#d-next")) { if (stepMonth(1)) rangeChanged(); return; }
  if (b("#d-prange")) { openRangeSheet(rangeOf(), rangeChanged); return; }
  if ((x = b("[data-hv]"))) { view.hv = x.dataset.hv; renderHero(rangeOf()); return; }
  if (b("#h-table")) { view.table = !view.table; renderHero(rangeOf()); return; }
  if ((x = b("[data-cmp]"))) { if (!x.disabled) { savePrefs({ cmp: x.dataset.cmp }); renderHero(rangeOf()); } return; }
  if ((x = b("[data-lg]"))) { const k = x.dataset.lg; if (view.hoff[k]) delete view.hoff[k]; else view.hoff[k] = 1; renderHero(rangeOf()); const again = root.querySelector('[data-lg="' + CSS.escape(k) + '"]'); if (again) again.focus(); return; }
  if ((x = b("[data-ctab]"))) { view.ctab = x.dataset.ctab; WIDGETS.cats.render(rangeOf()); return; }
  if ((x = b("[data-go-cat]"))) { hideTip(); goTx(x.dataset.goYm ? { cat: x.dataset.goCat, ym: x.dataset.goYm.split("-").map(Number) } : { cat: x.dataset.goCat }); return; }
  if ((x = b("[data-go-q]"))) { hideTip(); goTx({ q: x.dataset.goQ }); return; }
  if ((x = b("[data-go-id]"))) { hideTip(); goTx({ id: x.dataset.goId }); return; }
  if ((x = b("[data-go-day]"))) { hideTip(); goTx({ day: x.dataset.goDay }); return; }
  if ((x = b("[data-go-rule]"))) { hideTip(); navigate("/recurring?id=" + encodeURIComponent(x.dataset.goRule)); return; }
  if (b("[data-settle]")) { closePops(); import("../settle.js").then((m) => m.openSettle()); return; }
  if (b("[data-review]")) { closePops(); navigate("/review"); return; }
  if (b("[data-d-cmd]")) { import("../cmd.js").then((m) => m.openCmd && m.openCmd()); return; }
  if (b("[data-new-rule]")) { import("../add.js").then((m) => m.openAdd({ repeat: true })); return; }
  if (b("[data-add-income]")) { import("../add.js").then((m) => m.openAdd({ type: "income" })); return; }
  if (b("#d-cust")) { if (phoneMQ.matches) openCustomizeSheet(); else togglePop("d-custpop", "d-cust"); return; }
  if (b("#d-menu")) { togglePop("d-menupop", "d-menu"); return; }
  if (b("[data-cust-all]")) { toggleAll(); return; }
}
function onChange(ev) { if (ev.target.dataset.cw) setWidget(ev.target.dataset.cw, ev.target.checked); }
function onKeydown(ev) {
  if (ev.key === "Escape" && (popOpen("d-custpop") || popOpen("d-menupop"))) { ev.preventDefault(); ev.stopPropagation(); closePops(true); }
}
function onDocClick(ev) { if (root && ev.target.isConnected && !root.contains(ev.target)) closePops(); }
function onMedia() { if (root) layout(); }

/* ---------- the page contract ---------- */
export function mount(el, route) {
  root = el;
  mounted = true;
  loadRange();
  // Links such as Month in review's "Open on the Dashboard" name a month: /?ym=2026-09
  const ym = route && route.query.get("ym");
  if (/^\d{4}-\d\d$/.test(ym || "")) setMonth(+ym.slice(0, 4), +ym.slice(5));
  root.addEventListener("click", onClick);
  root.addEventListener("change", onChange);
  root.addEventListener("keydown", onKeydown);
  document.addEventListener("click", onDocClick);
  phoneMQ.addEventListener("change", onMedia);
  layout();
}
export function update() {
  if (!root) return;
  const none = !state.tx.length, key = (none ? "empty" : phoneMQ.matches ? "phone" : "desk") + ":" + state.people.length;
  if (key !== layoutKey) layout(); else render();
}
export function unmount() {
  mounted = false;
  if (root) { root.removeEventListener("click", onClick); root.removeEventListener("change", onChange); root.removeEventListener("keydown", onKeydown); root.classList.remove("d-phone"); }
  document.removeEventListener("click", onDocClick);
  phoneMQ.removeEventListener("change", onMedia);
  root = null;
}
/* Keys: 1 to 5 pick a range, ← → step months, Esc closes a popover */
export function key(ev) {
  if (!root || !state.tx.length) return;
  const i = ["1", "2", "3", "4", "5"].indexOf(ev.key);
  if (i >= 0) {
    ev.preventDefault();
    if (MODES[i] === "custom") { if (!phoneMQ.matches) openRange(rangeOf(), rangeChanged); else openRangeSheet(rangeOf(), rangeChanged); }
    else { setMode(MODES[i]); rangeChanged(); }
  } else if ((ev.key === "ArrowLeft" || ev.key === "ArrowRight") && !ev.target.closest("[role=group],.w-pop,svg")) {
    const back = (ev.key === "ArrowLeft") !== (document.documentElement.dir === "rtl");
    if (stepMonth(back ? -1 : 1)) { ev.preventDefault(); rangeChanged(); }
  } else if (ev.key === "Escape") closePops(true);
}

/* Budgets arrive after the first page is drawn: the status headline becomes budget-aware */
on("change", (d) => { if (mounted && root && d && d.extras && state.tx.length) render(); });
