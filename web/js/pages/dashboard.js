/* Summary, the page at /: how this month is going, where it's heading, then the details.
   The title is the period ("November ▾"): ‹ › beside it step a month (or a year), and it opens a short
   menu: This month, Last month, This year, All time, Custom range….
   The layout and its sections are in dashboard/summary.js; this file wires the page. */
import { state, t, esc, icon, rerank, TODAY, ym, monthName } from "../core.js";
import { navigate, headActions } from "../shell.js";
import { hideTip, empty, stepLabels } from "../ui.js";
import { view, loadRange, setMode, setMonth, setYear, pageQuery, stepMonth, canStep, steps, rangeOf, goTx, openRange, MODES } from "./dashboard/range.js";
import { summaryHtml, renderSummary, periodMenu, toggleList, openKept, openYear } from "./dashboard/summary.js";
import { openCashflow } from "./dashboard/cashflow.js";

const $ = (id) => document.getElementById(id);
let root = null, layoutKey = "";

/* ---------- layout ---------- */
function header() {
  return '<header class="w-head s-head"><div class="s-titlew">' +
    '<button type="button" class="s-title" data-menu="period" aria-haspopup="menu" aria-expanded="false"><span id="s-title"></span>' + icon("down") + "</button>" +
    '<div class="w-menu s-pmenu" id="s-pmenu" role="menu" aria-label="' + esc(t("Period")) + '" hidden></div></div>' +
    '<div class="s-steps w-steps" id="s-steps"><button type="button" class="s-stepb" data-step="-1">' + icon("left") + "</button>" +
    '<button type="button" class="s-stepb" data-step="1">' + icon("right") + "</button></div>" + headActions() + "</header>";
}
function emptyHtml() {
  return '<header class="w-head s-head"><div class="s-titlew"><h3 class="s-title">' + t("Summary") + "</h3></div>" + headActions() + "</header>" +
    '<section class="w-panel d-welcome">' + empty("overview", t("Nothing here yet"), t("Add the first expense or income, or import a CSV from your bank. Summary fills in from there."),
      '<div class="d-emptyb"><a class="w-btn ghost" href="/settings/import" data-link>' + t("Import") + '</a><button type="button" class="w-btn ghost" data-add-income>' + t("Add income") +
      '</button><button type="button" class="w-btn primary" data-open-add>' + t("Add expense") + "</button></div>") + "</section>";
}
function layout() {
  const none = !state.tx.length;
  layoutKey = (none ? "empty" : "summary") + ":" + state.people.length;
  hideTip();
  root.innerHTML = none ? emptyHtml() : header() + summaryHtml();
  if (!none) render();
}

/* ---------- drawing ---------- */
function titleOf(r) {
  if (r.month) { const [y, m] = ym(r.start); return esc(monthName(m)) + (y !== +TODAY.slice(0, 4) ? " <span>" + y + "</span>" : ""); }
  return esc(r.title);
}
function render() {
  const r = rangeOf();
  rerank(r.start, r.end, "all");
  $("s-title").innerHTML = titleOf(r);
  // Every month, with and without its year, so ‹ › don't move as the name gets longer or shorter
  // A month with its year, or any long name, is set smaller on phones
  $("s-title").parentNode.classList.toggle("s-long", !!$("s-title").querySelector("span") || $("s-title").textContent.length > 12);
  $("s-title").parentNode.setAttribute("aria-label", t("Period: {range}", { range: $("s-title").textContent }));
  $("s-pmenu").innerHTML = periodMenu();
  $("s-steps").hidden = !steps();
  stepLabels($("s-steps"), view.mode === "year");
  $("s-steps").querySelector('[data-step="-1"]').disabled = !canStep(-1);
  $("s-steps").querySelector('[data-step="1"]').disabled = !canStep(1);
  renderSummary(r);
  syncUrl();
}
/* The address follows ‹ › and the period menu, so a reload or a shared link opens the same month or year */
function syncUrl() {
  if (location.pathname !== "/") return;
  const u = "/" + pageQuery();
  if (location.pathname + location.search !== u) history.replaceState(history.state, "", u);
}
function pickCustom() { openRange(rangeOf(), render); }
function goMonth(q) { hideTip(); setMonth(+q.slice(0, 4), +q.slice(5)); render(); }

/* ---------- events ---------- */
function onClick(ev) {
  const b = (sel) => ev.target.closest(sel);
  let x;
  if ((x = b("[data-pm]"))) {
    const v = x.dataset.pm;
    if (v === "custom") { setTimeout(pickCustom); return; }
    if (v === "this") setMode("month");
    else if (v === "last") { const now = [+TODAY.slice(0, 4), +TODAY.slice(5, 7)], q = now[1] === 1 ? [now[0] - 1, 12] : [now[0], now[1] - 1]; setMonth(q[0], q[1]); }
    else setMode(v);
    render();
    return;
  }
  if ((x = b("[data-step]"))) { if (stepMonth(+x.dataset.step)) { hideTip(); render(); } return; }
  if ((x = b("[data-hv]"))) { view.hv = x.dataset.hv; render(); return; }
  if ((x = b('[data-act="cats-all"],[data-act="tags-all"]'))) { toggleList(x.dataset.act.split("-")[0]); render(); return; }
  if (b('[data-act="cashflow-big"]')) { openCashflow(rangeOf()); return; }
  if (b('[data-act="kept-big"]')) { openKept(rangeOf(), goMonth); return; }
  if (b('[data-act="year-big"]')) { openYear(rangeOf()); return; }
  if ((x = b("[data-go-cat]"))) { hideTip(); goTx({ cat: x.dataset.goCat }); return; }
  if ((x = b("[data-go-tag]"))) { hideTip(); goTx({ tag: x.dataset.goTag }); return; }
  if ((x = b("[data-go-person]"))) { hideTip(); goTx({ person: x.dataset.goPerson }); return; }
  if ((x = b("[data-go-id]"))) { hideTip(); goTx({ id: x.dataset.goId }); return; }
  // A month in Kept each month opens that month here
  if ((x = b("[data-go-month]"))) { goMonth(x.getAttribute("data-go-month")); return; }
  if ((x = b("[data-go-rule]"))) { hideTip(); navigate("/recurring?id=" + encodeURIComponent(x.dataset.goRule)); return; }
  if (b("[data-new-rule]")) { import("../add.js").then((m) => m.openAdd({ repeat: true })); return; }
  if (b("[data-add-income]")) { import("../add.js").then((m) => m.openAdd({ type: "income" })); return; }
}
function onDay(ev) { goTx({ day: ev.detail }); }
/* Phones: a sideways swipe on the hero moves a month */
let touch = null;
function onTouchStart(ev) {
  // Not on the chart: a finger moving along it reads the days
  const h = ev.target.closest(".s-hero") && !ev.target.closest(".s-chart");
  touch = h && ev.touches.length === 1 ? { x: ev.touches[0].clientX, y: ev.touches[0].clientY } : null;
}
function onTouchEnd(ev) {
  if (!touch || view.mode !== "month") return;
  const p = ev.changedTouches[0], dx = p.clientX - touch.x, dy = p.clientY - touch.y;
  touch = null;
  if (Math.abs(dx) < 60 || Math.abs(dy) > 40) return;
  const next = (dx < 0) !== (document.documentElement.dir === "rtl");
  if (stepMonth(next ? 1 : -1)) { hideTip(); render(); }
}

/* ---------- the page contract ---------- */
export function mount(el, route) {
  root = el;
  loadRange();
  // The address names a month (/?month=2026-09, as Month in review's "Open in Summary" does) or a year (/?year=2025)
  const q = route && route.query.get("month");
  if (/^\d{4}-\d\d$/.test(q || "") && +q.slice(5) >= 1 && +q.slice(5) <= 12 && q <= TODAY.slice(0, 7)) setMonth(+q.slice(0, 4), +q.slice(5));
  const y = route && route.query.get("year");
  if (/^(19|20)\d\d$/.test(y || "") && +y <= +TODAY.slice(0, 4)) setYear(+y);
  root.addEventListener("click", onClick);
  root.addEventListener("s-day", onDay);
  root.addEventListener("touchstart", onTouchStart, { passive: true });
  root.addEventListener("touchend", onTouchEnd, { passive: true });
  layout();
}
export function update() {
  if (!root) return;
  const key = (!state.tx.length ? "empty" : "summary") + ":" + state.people.length;
  if (key !== layoutKey) layout(); else render();
}
export function unmount() {
  if (root) {
    root.removeEventListener("click", onClick);
    root.removeEventListener("s-day", onDay);
    root.removeEventListener("touchstart", onTouchStart);
    root.removeEventListener("touchend", onTouchEnd);
  }
  root = null;
}
/* Keys: 1 to 4 pick Month, Year, Custom or All time; ← → step months (or years) */
export function key(ev) {
  if (!root || !state.tx.length) return;
  const i = ["1", "2", "3", "4"].indexOf(ev.key);
  if (i >= 0) {
    ev.preventDefault();
    if (MODES[i] === "custom") pickCustom();
    else { setMode(MODES[i]); render(); }
  } else if ((ev.key === "ArrowLeft" || ev.key === "ArrowRight") && !ev.target.closest("[role=group],.w-menu,.w-pop,svg")) {
    const back = (ev.key === "ArrowLeft") !== (document.documentElement.dir === "rtl");
    if (stepMonth(back ? -1 : 1)) { ev.preventDefault(); render(); }
  }
}
