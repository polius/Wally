/* Summary's range: a month, a year, all time or a custom range, the period it is compared with,
   the Custom Range sheet, and links into Transactions that keep the range. ‹ › step a month (or a
   year). The last range is remembered on this browser. */
import { t, tn, esc, TODAY, START, ds, dim, ym, ymAdd, span, addD, mmin, mmax, monthName, monthIn, monthYear, F, dlab, dows, wkOff, icon, num, LANG } from "../../core.js";
import { openDialog } from "../../ui.js";
import { navigate } from "../../shell.js";

export const MODES = ["month", "year", "custom", "all"];
const KEY = "wally.dash.range";

/* What Summary shows. Lives with the module, so it survives leaving and coming back. */
export const view = {
  mode: "month",
  ym: ym(TODAY),        // the month shown in Month mode
  y: +TODAY.slice(0, 4), // the year shown in Year mode
  custom: null,         // [from, to] in Custom mode
  hv: "pace",           // main chart for a year or a long range: pace | ivs | cats
  hoff: {},             // categories hidden from the legend
};

export function loadRange() {
  view.ym = ym(TODAY);
  view.y = +TODAY.slice(0, 4);
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null");
    // 3 months and 12 months were retired: they open as Month and Year
    if (s && (s.mode === "3m" || s.mode === "12m")) s.mode = s.mode === "3m" ? "month" : "year";
    if (s && MODES.includes(s.mode)) {
      const ok = s.mode !== "custom" || (Array.isArray(s.custom) && /^\d{4}-\d\d-\d\d$/.test(s.custom[0]) && /^\d{4}-\d\d-\d\d$/.test(s.custom[1]) && s.custom[0] <= s.custom[1]);
      if (ok) { view.mode = s.mode; view.custom = s.mode === "custom" ? [s.custom[0], mmin(s.custom[1], TODAY)] : null; }
    }
  } catch (e) { /* the current month it is */ }
}
function saveRange() {
  try { localStorage.setItem(KEY, JSON.stringify({ mode: view.mode, custom: view.custom })); } catch (e) { /* fine */ }
}
/* Month mode always opens on the current month, Year on this year; the other modes end today anyway */
export function setMode(mode, custom) {
  view.mode = mode;
  if (mode === "month") view.ym = ym(TODAY);
  if (mode === "year") view.y = +TODAY.slice(0, 4);
  view.custom = mode === "custom" ? custom : null;
  saveRange();
}
export function setMonth(y, m) { view.mode = "month"; view.ym = [y, m]; view.custom = null; saveRange(); }
export function setYear(y) { view.mode = "year"; view.y = y; view.custom = null; saveRange(); }
/* The address for what is shown: another month or year in it, the current one (or a range, which is remembered) plain */
export function pageQuery() {
  const [ty, tm] = ym(TODAY);
  if (view.mode === "month" && (view.ym[0] !== ty || view.ym[1] !== tm)) return "?month=" + view.ym[0] + "-" + String(view.ym[1]).padStart(2, "0");
  if (view.mode === "year" && view.y !== ty) return "?year=" + view.y;
  return "";
}
/* ‹ ›: a month back or forward in Month mode, a year in Year mode */
export function stepMonth(k) {
  if (!canStep(k)) return false;
  if (view.mode === "year") view.y += k;
  else view.ym = ymAdd(view.ym[0], view.ym[1], k);
  return true;
}
export function canStep(k) {
  if (view.mode === "year") { const y = view.y + k; return k < 0 ? y + "-12-31" >= START : y + "-01-01" <= TODAY; }
  if (view.mode !== "month") return false;
  const q = ymAdd(view.ym[0], view.ym[1], k), first = ds(q[0], q[1], 1);
  return k < 0 ? ds(q[0], q[1], dim(q[0], q[1])) >= START : first <= TODAY;
}
export function steps() { return view.mode === "month" || view.mode === "year"; }

/* "Aug – Oct 2026", or "Nov 2025 – Oct 2026" across a new year */
function monthSpan(a, b) {
  if (a[0] === b[0]) return t("{from} – {to}", { from: F.mon[a[1] - 1], to: F.mon[b[1] - 1] + " " + b[0] });
  return t("{from} – {to}", { from: F.mon[a[1] - 1] + " " + a[0], to: F.mon[b[1] - 1] + " " + b[0] });
}

/* The range on screen: start, end (never after today), its length, and how to name it */
export function rangeOf() {
  if (view.mode === "month") {
    const [y, m] = view.ym, full = ds(y, m, dim(y, m));
    return { mode: "month", start: ds(y, m, 1), end: mmin(full, TODAY), len: dim(y, m), daily: true, month: true, current: full >= TODAY,
      title: monthName(m), sub: String(y), noun: monthIn(m) };
  }
  let s, e = TODAY, title, sub, noun;
  if (view.mode === "year") {
    const y = view.y;
    s = y + "-01-01"; e = mmin(y + "-12-31", TODAY); title = String(y); sub = e === TODAY ? t("so far") : ""; noun = String(y);
  } else if (view.mode === "all") { s = START; title = t("All time"); sub = ""; noun = t("all time"); }
  else {
    [s, e] = view.custom;
    title = t("{from} – {to}", { from: dlab(s), to: dlab(e) });
    sub = s.slice(0, 4) === e.slice(0, 4) ? s.slice(0, 4) : t("{from} – {to}", { from: s.slice(0, 4), to: e.slice(0, 4) });
    noun = t("this range");
  }
  const len = span(s, e);
  return { mode: view.mode, start: s, end: e, len, daily: len <= 62, month: false, current: e === TODAY, title, sub, noun };
}

/* What a range is compared with: the month before (to the same day while the month runs),
   the same days last year for Year, or the same number of days just before */
export function prevOf(r) {
  if (r.month) {
    const [y, m] = ym(r.start), p = ymAdd(y, m, -1), pd = dim(p[0], p[1]);
    const start = ds(p[0], p[1], 1);
    const end = r.current ? ds(p[0], p[1], Math.min(+TODAY.slice(8), pd)) : ds(p[0], p[1], pd);
    return { start, end, label: monthIn(p[1]), ok: start >= START };
  }
  if (r.mode === "all") return { start: r.start, end: r.end, label: "", ok: false };
  if (r.mode === "year") {
    const py = +r.start.slice(0, 4) - 1, ps = py + "-01-01";
    let pe = py + r.end.slice(4);
    if (pe.slice(5) === "02-29" && dim(py, 2) === 28) pe = py + "-02-28";
    return { start: ps, end: pe, label: t("the same days of {year}", { year: py }), ok: ps >= START };
  }
  const e = addD(r.start, -1), s = addD(e, -(r.len - 1));
  return { start: s, end: e, label: tn(r.len, "the previous {n} day", "the previous {n} days"), ok: s >= START };
}

/* ---------- into Transactions, keeping the range ---------- */
export function rangeParams() {
  const r = rangeOf(), q = new URLSearchParams();
  q.set("mode", view.mode);
  if (view.mode === "month") q.set("month", r.start.slice(0, 7));
  if (view.mode === "custom" || view.mode === "all" || (view.mode === "year" && view.y !== +TODAY.slice(0, 4))) { q.set("mode", "custom"); q.set("from", r.start); q.set("to", r.end); }
  return q;
}
/* goTx({cat}) · goTx({cat, ym:[y,m]}) · goTx({q}) · goTx({id}) · goTx({day}) */
export function goTx(o) {
  let q;
  if (o.id) q = new URLSearchParams({ id: o.id });
  else if (o.day) q = new URLSearchParams({ view: "cal", day: o.day });
  else {
    q = new URLSearchParams();
    if (o.cat) q.set("cat", o.cat);
    if (o.q) q.set("q", o.q);
    if (o.ym) { q.set("mode", "month"); q.set("month", ds(o.ym[0], o.ym[1], 1).slice(0, 7)); }
    else rangeParams().forEach((v, k) => q.set(k, v));
  }
  navigate("/transactions?" + q.toString());
}

/* ---------- Custom Range: a sheet like Calendar's event dates ----------
   Starts and Ends as rows; the calendar opens under the row being set. Picking the first day moves on
   to the last one. Both sizes use the same sheet. */
const rp = { a: null, b: null, edge: "a", view: null, pick: false };
const DAYF = () => new Intl.DateTimeFormat(LANG, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
const dayLabel = (s) => DAYF().format(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8)));

/* The calendar's title opens the months of its year, as Calendar's month and year picker does */
function pickHtml() {
  const [y, m] = rp.view, sy = +START.slice(0, 4), ty = +TODAY.slice(0, 4);
  let h = '<div class="d-cal"><div class="d-calh"><button type="button" class="d-calt on" data-rpick aria-expanded="true">' + esc(String(y)) + icon("right") + "</button><span>" +
    '<button type="button" class="d-calnav" data-ry="-1" aria-label="' + esc(t("Previous year")) + '"' + (y > sy ? "" : " disabled") + ">" + icon("left") + "</button>" +
    '<button type="button" class="d-calnav" data-ry="1" aria-label="' + esc(t("Next year")) + '"' + (y < ty ? "" : " disabled") + ">" + icon("right") + "</button></span></div>" +
    '<div class="d-calm" role="group" aria-label="' + esc(String(y)) + '">';
  for (let k = 1; k <= 12; k++) {
    const off = ds(y, k, 1) > TODAY || ds(y, k, dim(y, k)) < START;
    h += '<button type="button" data-rmo="' + k + '"' + (k === m ? ' class="on" aria-current="true"' : "") + (off ? " disabled" : "") + ' aria-label="' + esc(monthYear(y, k)) + '">' + esc(F.mon[k - 1]) + "</button>";
  }
  return h + "</div></div>";
}
function calHtml() {
  if (rp.pick) return pickHtml();
  const [y, m] = rp.view, D = dim(y, m), first = ds(y, m, 1);
  const prevOk = ds(y, m, 1) > START, nx = ymAdd(y, m, 1), nextOk = ds(nx[0], nx[1], 1) <= TODAY;
  let h = '<div class="d-cal"><div class="d-calh"><button type="button" class="d-calt" data-rpick aria-expanded="false" aria-label="' + esc(t("Choose a month")) + '">' + esc(monthYear(y, m)) + icon("right") + "</button><span>" +
    '<button type="button" class="d-calnav" data-rv="-1" aria-label="' + esc(t("Earlier months")) + '"' + (prevOk ? "" : " disabled") + ">" + icon("left") + "</button>" +
    '<button type="button" class="d-calnav" data-rv="1" aria-label="' + esc(t("Later months")) + '"' + (nextOk ? "" : " disabled") + ">" + icon("right") + "</button></span></div>" +
    '<div class="d-calg" role="group" aria-label="' + esc(monthYear(y, m)) + '">' + dows(true).map((d) => '<span class="dw" aria-hidden="true">' + esc(d) + "</span>").join("");
  for (let i = 0; i < wkOff(first); i++) h += "<span></span>";
  for (let d = 1; d <= D; d++) {
    const s = ds(y, m, d), off = s > TODAY || s < START, cls = [];
    if (s === rp.a || s === rp.b) cls.push("on");
    else if (rp.a && rp.b && s > rp.a && s < rp.b) cls.push("in");
    if (s === TODAY) cls.push("td");
    h += '<button type="button" data-d="' + s + '" class="' + cls.join(" ") + '"' + (off ? " disabled" : "") + ' aria-pressed="' + (s === rp.a || s === rp.b) + '" aria-label="' + esc(F.fullYear.format(Date.UTC(y, m - 1, d))) + '">' + num(d) + "</button>";
  }
  return h + "</div></div>";
}
function edgeRow(k) {
  const v = k === "a" ? rp.a : rp.b, on = rp.edge === k;
  return '<button type="button" class="w-gr d-edge" data-edge="' + k + '" aria-expanded="' + on + '"><span class="k">' + (k === "a" ? t("Starts") : t("Ends")) +
    '</span><span class="v"><span class="d-tok' + (on ? " on" : "") + '">' + esc(v ? dayLabel(v) : "") + "</span></span></button>";
}
function drawRange(root, focusDay) {
  root.querySelector(".d-rng").innerHTML = edgeRow("a") + (rp.edge === "a" ? calHtml() : "") + edgeRow("b") + (rp.edge === "b" ? calHtml() : "");
  root.querySelector(".d-rngsum").textContent = rp.a && rp.b ? tn(span(rp.a, rp.b), "{n} day", "{n} days") : "";
  const ok = root.querySelector("[data-dlg-ok]");
  if (ok) ok.disabled = !(rp.a && rp.b);
  if (focusDay) { const b = root.querySelector('[data-d="' + focusDay + '"]') || root.querySelector('[data-edge="' + rp.edge + '"]'); if (b) b.focus(); }
}

export function openRange(r, onApply) {
  rp.a = r.start; rp.b = r.end; rp.edge = "a"; rp.pick = false;
  rp.view = ym(rp.a);
  openDialog({
    kind: "sheet",
    title: t("Custom Range"),
    ok: t("Done"),
    body: '<div class="w-gl d-rng"></div><p class="w-glf d-rngsum" aria-live="polite"></p>',
    onOpen(root) {
      root.classList.add("d-rngdlg");
      drawRange(root);
      root.addEventListener("click", (ev) => {
        const day = ev.target.closest("[data-d]");
        if (day && !day.disabled) {
          const s = day.dataset.d;
          // The first day moves on to the last one, on the same month: it is usually near
          if (rp.edge === "a") { rp.a = s; if (rp.b && rp.b < s) rp.b = s; rp.edge = "b"; }
          else if (s < rp.a) { rp.b = rp.a; rp.a = s; }
          else rp.b = s;
          drawRange(root, rp.edge === "b" ? null : s);
          const again = root.querySelector('[data-d="' + s + '"]') || root.querySelector('[data-edge="' + rp.edge + '"]');
          if (again) again.focus();
          return;
        }
        const pk = ev.target.closest("[data-rpick]"), yr = ev.target.closest("[data-ry]"), mo = ev.target.closest("[data-rmo]");
        if (pk) { rp.pick = !rp.pick; drawRange(root); root.querySelector("[data-rpick]").focus(); return; }
        if (yr && !yr.disabled) { rp.view = [rp.view[0] + +yr.dataset.ry, rp.view[1]]; drawRange(root); const again = root.querySelector('[data-ry="' + yr.dataset.ry + '"]'); (again && !again.disabled ? again : root.querySelector("[data-rpick]")).focus(); return; }
        if (mo && !mo.disabled) { rp.view = [rp.view[0], +mo.dataset.rmo]; rp.pick = false; drawRange(root); root.querySelector("[data-rpick]").focus(); return; }
        const e = ev.target.closest("[data-edge]");
        if (e) { rp.pick = false; rp.edge = e.dataset.edge; rp.view = ym(rp.edge === "a" ? rp.a : rp.b); drawRange(root); root.querySelector('[data-edge="' + rp.edge + '"]').focus(); return; }
        const st = ev.target.closest("[data-rv]");
        if (st && !st.disabled) { rp.view = ymAdd(rp.view[0], rp.view[1], +st.dataset.rv); drawRange(root); const again = root.querySelector('[data-rv="' + st.dataset.rv + '"]'); if (again && !again.disabled) again.focus(); }
      });
    },
    onOk() {
      if (!(rp.a && rp.b)) return false;
      applyDates(rp.a, rp.b);
      onApply();
    },
  });
}
/* A whole calendar month (or this month so far) is shown as Month, a whole year as Year, anything else as Custom */
function applyDates(a, b) {
  const [y, m] = ym(b), monthEnd = ds(y, m, dim(y, m));
  if (a.slice(8) === "01" && a.slice(0, 7) === b.slice(0, 7) && (b === monthEnd || b === TODAY)) setMonth(+a.slice(0, 4), +a.slice(5, 7));
  else if (a.slice(5) === "01-01" && a.slice(0, 4) === b.slice(0, 4) && (b.slice(5) === "12-31" || b === TODAY)) { view.mode = "year"; view.y = +a.slice(0, 4); view.custom = null; saveRange(); }
  else setMode("custom", [a, b]);
}
