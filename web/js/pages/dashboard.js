/* Dashboard: are we on track, where did it go, and what's coming.
   The lead panel (main chart and key figures), then Categories and Recent, then Kept each
   month and Coming up. Under 768 px it switches to the compact phone layout. */
import { state, t, esc, icon, rerank, on } from "../core.js";
import { navigate, scopeSwitch } from "../shell.js";
import { hideTip, empty } from "../ui.js";
import { view, loadRange, setMode, setMonth, stepMonth, canStep, rangeOf, goTx, openRange, openRangeSheet, MODES } from "./dashboard/range.js";
import { heroHtml, renderHero } from "./dashboard/hero.js";
import { WIDGETS } from "./dashboard/widgets.js";
import { phoneHeader, phoneHtml, renderPhone } from "./dashboard/phone.js";

/* Pairs side by side on wide screens; single keys take the full width */
const ROWS = [["hero"], ["cats", "recent"], ["kept", "upcoming"]];
const WIDGET_KEYS = ["cats", "recent", "kept", "upcoming"];
const phoneMQ = matchMedia("(max-width: 767px)");

let root = null, layoutKey = "", mounted = false;

/* ---------- layout ---------- */
function header() {
  const modes = [["month", t("Month")], ["year", t("Year")], ["custom", t("Custom…")]];
  return '<header class="w-head d-head">' +
    '<div class="w-title"><h3 id="d-title"></h3></div>' +
    '<div class="w-step" id="d-step"><button type="button" id="d-prev" aria-label="' + esc(t("Previous month")) + '">' + icon("left") + '</button><button type="button" id="d-next" aria-label="' + esc(t("Next month")) + '">' + icon("right") + "</button></div>" +
    '<div class="d-rangewrap"><div class="w-seg" id="d-range" role="group" aria-label="' + esc(t("Range")) + '">' +
      modes.map(([k, l], i) => '<button type="button" data-mode="' + k + '" aria-keyshortcuts="' + (i + 1) + '" title="' + esc(l.replace("…", "") + " (" + (i + 1) + ")") + '">' + l + "</button>").join("") + "</div></div>" +
    '<div class="w-head-r">' +
      '<button type="button" class="w-btn ghost" data-review>' + icon("history") + t("Month in review") + "</button>" +
    "</div></header>";
}
function desktopHtml() {
  return header() + ROWS.map((keys) => {
    const html = keys.map((k) => (k === "hero" ? heroHtml() : WIDGETS[k].html())).join("");
    return keys.length > 1 ? '<div class="w-grid2">' + html + "</div>" : html;
  }).join("");
}
function emptyHtml() {
  return '<header class="w-head d-head"><div class="w-title"><h3>' + t("Dashboard") + "</h3></div>" + (phoneMQ.matches ? scopeSwitch() : "") + "</header>" +
    '<section class="w-panel d-welcome">' + empty("overview", t("Nothing here yet"), t("Add the first expense or income, or import a CSV from your bank. The Dashboard fills in from there."),
      '<div class="d-emptyb"><a class="w-btn ghost" href="/settings/import" data-link>' + t("Import") + '</a><button type="button" class="w-btn ghost" data-add-income>' + t("Add income") +
      '</button><button type="button" class="w-btn primary" data-open-add>' + t("Add expense") + "</button></div>") + "</section>";
}

function layout() {
  const none = !state.tx.length, phone = phoneMQ.matches;
  layoutKey = (none ? "empty" : phone ? "phone" : "desk") + ":" + state.people.length;
  hideTip();
  if (none) root.innerHTML = emptyHtml();
  else if (phone) root.innerHTML = '<div id="d-phead"></div>' + phoneHtml();
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
function render() {
  const r = rangeOf();
  rerank(r.start, r.end, "all");
  renderHead(r);
  if (phoneMQ.matches) { renderPhone(r); return; }
  renderHero(r);
  WIDGET_KEYS.forEach((k) => WIDGETS[k].render(r));
}
/* ---------- events ---------- */
function rangeChanged() { render(); }
function onClick(ev) {
  const tgt = ev.target;
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
  if ((x = b("[data-lg]"))) { const k = x.dataset.lg; if (view.hoff[k]) delete view.hoff[k]; else view.hoff[k] = 1; renderHero(rangeOf()); const again = root.querySelector('[data-lg="' + CSS.escape(k) + '"]'); if (again) again.focus(); return; }
  if ((x = b("[data-go-cat]"))) { hideTip(); goTx(x.dataset.goYm ? { cat: x.dataset.goCat, ym: x.dataset.goYm.split("-").map(Number) } : { cat: x.dataset.goCat }); return; }
  if ((x = b("[data-go-q]"))) { hideTip(); goTx({ q: x.dataset.goQ }); return; }
  if ((x = b("[data-go-id]"))) { hideTip(); goTx({ id: x.dataset.goId }); return; }
  if ((x = b("[data-go-day]"))) { hideTip(); goTx({ day: x.dataset.goDay }); return; }
  // A month in Kept each month opens that month here
  if ((x = b("[data-go-month]"))) { hideTip(); const q = x.getAttribute("data-go-month"); setMonth(+q.slice(0, 4), +q.slice(5)); rangeChanged(); return; }
  if ((x = b("[data-go-rule]"))) { hideTip(); navigate("/recurring?id=" + encodeURIComponent(x.dataset.goRule)); return; }
  if (b("[data-review]")) { navigate("/review"); return; }
  if (b("[data-new-rule]")) { import("../add.js").then((m) => m.openAdd({ repeat: true })); return; }
  if (b("[data-add-income]")) { import("../add.js").then((m) => m.openAdd({ type: "income" })); return; }
}
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
  if (root) { root.removeEventListener("click", onClick); root.classList.remove("d-phone"); }
  phoneMQ.removeEventListener("change", onMedia);
  root = null;
}
/* Keys: 1 to 3 pick a range, ← → step months */
export function key(ev) {
  if (!root || !state.tx.length) return;
  const i = ["1", "2", "3"].indexOf(ev.key);
  if (i >= 0) {
    ev.preventDefault();
    if (MODES[i] === "custom") { if (!phoneMQ.matches) openRange(rangeOf(), rangeChanged); else openRangeSheet(rangeOf(), rangeChanged); }
    else { setMode(MODES[i]); rangeChanged(); }
  } else if ((ev.key === "ArrowLeft" || ev.key === "ArrowRight") && !ev.target.closest("[role=group],.w-pop,svg")) {
    const back = (ev.key === "ArrowLeft") !== (document.documentElement.dir === "rtl");
    if (stepMonth(back ? -1 : 1)) { ev.preventDefault(); rangeChanged(); }
  }
}

/* Budgets arrive after the first page is drawn: the phone's Budgets card is about them */
on("change", (d) => { if (mounted && root && d && d.extras && state.tx.length) render(); });
