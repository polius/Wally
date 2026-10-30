/* The Dashboard's range: Month, Year or Custom, the period it is compared
   with, the two-month Custom picker, the phone's range sheet, and links into Transactions that
   keep the range. The last range is remembered on this browser. */
import { t, tn, esc, TODAY, START, ds, dim, ym, ymAdd, span, addD, mmin, mmax, monthName, monthIn, monthYear, F, dlab, dows, wkOff, icon, num } from "../../core.js";
import { openDialog, closeDialog } from "../../ui.js";
import { navigate } from "../../shell.js";

export const MODES = ["month", "year", "custom"];
const KEY = "wally.dash.range";

/* What the Dashboard shows. Lives with the module, so it survives leaving and coming back. */
export const view = {
  mode: "month",
  ym: ym(TODAY),        // the month shown in Month mode
  custom: null,         // [from, to] in Custom mode
  hv: "pace",           // main chart for a year or a long range: pace | ivs | cats
  hoff: {},             // categories hidden from the legend
};

export function loadRange() {
  view.ym = ym(TODAY);
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
/* Month mode always opens on the current month; the other modes are relative to today anyway */
export function setMode(mode, custom) {
  view.mode = mode;
  if (mode === "month") view.ym = ym(TODAY);
  view.custom = mode === "custom" ? custom : null;
  saveRange();
}
export function setMonth(y, m) { view.mode = "month"; view.ym = [y, m]; view.custom = null; saveRange(); }
export function stepMonth(k) {
  const q = ymAdd(view.ym[0], view.ym[1], k);
  if (k < 0 && !canStep(-1)) return false;
  if (k > 0 && !canStep(1)) return false;
  view.ym = q;
  return true;
}
export function canStep(k) {
  if (view.mode !== "month") return false;
  const q = ymAdd(view.ym[0], view.ym[1], k), first = ds(q[0], q[1], 1);
  return k < 0 ? first >= START : first <= TODAY;
}

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
  const now = ym(TODAY);
  let s, e = TODAY, title, sub, noun;
  if (view.mode === "year") { s = now[0] + "-01-01"; title = String(now[0]); sub = t("so far"); noun = String(now[0]); }
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
  if (view.mode === "month") q.set("ym", r.start.slice(0, 7));
  if (view.mode === "custom") { q.set("from", r.start); q.set("to", r.end); }
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
    if (o.ym) { q.set("mode", "month"); q.set("ym", ds(o.ym[0], o.ym[1], 1).slice(0, 7)); }
    else rangeParams().forEach((v, k) => q.set(k, v));
  }
  navigate("/transactions?" + q.toString());
}

/* ---------- Custom: a two-month picker with presets ---------- */
const rp = { view: null, a: null, b: null, hover: null };

function presets() {
  const now = ym(TODAY), first = (q) => ds(q[0], q[1], 1), last = (q) => ds(q[0], q[1], dim(q[0], q[1]));
  const lm = ymAdd(now[0], now[1], -1), ly = now[0] - 1;
  const list = [
    [t("This month"), first(now), TODAY],
    [t("Last month"), first(lm), last(lm)],
    [t("Last 3 months"), first(ymAdd(now[0], now[1], -2)), TODAY],
    [t("Last 6 months"), first(ymAdd(now[0], now[1], -5)), TODAY],
    [t("Year to date"), now[0] + "-01-01", TODAY],
    [t("All of {year}", { year: ly }), ly + "-01-01", ly + "-12-31"],
    [t("All time"), START, TODAY],
  ];
  // Only what has data, and never the same dates twice
  const seen = new Set();
  return list.filter(([, a, b]) => { const k = a + b; if (b < START || seen.has(k)) return false; seen.add(k); return true; })
    .map(([l, a, b]) => [l, mmax(a, START), b]);
}

function drawRange(root, focusDay) {
  const box = root.querySelector(".d-rng");
  const ps = presets();
  box.querySelector(".w-presets").innerHTML = "<span>" + t("Presets") + "</span>" + ps.map((p, i) =>
    '<button type="button" data-pr="' + i + '" aria-pressed="' + (rp.a === p[1] && rp.b === p[2]) + '">' + esc(p[0]) + "</button>").join("");
  let lo = rp.a, hi = rp.b || rp.hover;
  if (lo && hi && hi < lo) { const x = lo; lo = hi; hi = x; }
  let html = "";
  [0, 1].forEach((k) => {
    const [y, m] = ymAdd(rp.view[0], rp.view[1], k), D = dim(y, m), first = ds(y, m, 1);
    html += '<div class="w-mon"><h6>' + esc(monthYear(y, m)) + '</h6><div class="w-mgrid" role="group" aria-label="' + esc(monthYear(y, m)) + '">' +
      dows(true).map((d) => '<span class="dw" aria-hidden="true">' + esc(d) + "</span>").join("");
    for (let i = 0; i < wkOff(first); i++) html += "<span></span>";
    for (let d = 1; d <= D; d++) {
      const s = ds(y, m, d), off = s > TODAY || s < START, cls = [];
      if (lo && hi && s > lo && s < hi) cls.push("in");
      if (s === lo) cls.push("s");
      if (s === hi) cls.push("e");
      if (lo && !hi && s === lo) cls.push("s", "e");
      if (s === TODAY) cls.push("td");
      const picked = s === rp.a || s === rp.b;
      html += '<button type="button" data-d="' + s + '" class="' + cls.join(" ") + '"' + (off ? " disabled" : "") + ' aria-pressed="' + picked + '" aria-label="' + esc(F.fullYear.format(Date.UTC(y, m - 1, d))) + '"><span>' + num(d) + "</span></button>";
    }
    html += "</div></div>";
  });
  box.querySelector(".w-months").innerHTML = html;
  box.querySelector(".d-rngsum").innerHTML = rp.a && rp.b
    ? t("{from} to {to}, {days}", { from: "<b>" + esc(F.fullYear.format(Date.UTC(+rp.a.slice(0, 4), +rp.a.slice(5, 7) - 1, +rp.a.slice(8)))) + "</b>", to: "<b>" + esc(F.fullYear.format(Date.UTC(+rp.b.slice(0, 4), +rp.b.slice(5, 7) - 1, +rp.b.slice(8)))) + "</b>", days: tn(span(rp.a, rp.b), "{n} day", "{n} days") })
    : rp.a ? t("Pick the last day") : t("Pick the first day");
  const ok = root.querySelector("[data-dlg-ok]");
  if (ok) ok.disabled = !(rp.a && rp.b);
  box.querySelector("[data-rv='-1']").disabled = ds(rp.view[0], rp.view[1], 1) <= START;
  const nx = ymAdd(rp.view[0], rp.view[1], 2);
  box.querySelector("[data-rv='1']").disabled = ds(nx[0], nx[1], 1) > TODAY;
  if (focusDay) { const b = box.querySelector('[data-d="' + focusDay + '"]'); if (b) b.focus(); }
}

export function openRange(r, onApply) {
  rp.a = r.start; rp.b = r.end; rp.hover = null;
  const e = ym(rp.b);
  rp.view = ymAdd(e[0], e[1], -1);
  if (ds(rp.view[0], rp.view[1], 1) < START) rp.view = ym(START);
  openDialog({
    title: t("Choose a date range"),
    wide: true,
    ok: t("Apply"),
    body: '<div class="d-rng"><div class="w-presets"></div><div class="w-picker"><div class="w-mnav">' +
      '<button type="button" class="w-step d-rngstep" data-rv="-1" aria-label="' + esc(t("Earlier months")) + '">' + icon("left") + "</button>" +
      '<button type="button" class="w-step d-rngstep" data-rv="1" aria-label="' + esc(t("Later months")) + '">' + icon("right") + "</button></div>" +
      '<div class="w-months"></div><p class="d-rngsum" aria-live="polite"></p></div></div>',
    onOpen(root) {
      root.classList.add("d-rngdlg");
      drawRange(root);
      root.addEventListener("click", (ev) => {
        const day = ev.target.closest("[data-d]");
        if (day && !day.disabled) {
          const s = day.dataset.d;
          if (!rp.a || rp.b) { rp.a = s; rp.b = null; }
          else if (s < rp.a) { rp.b = rp.a; rp.a = s; }
          else rp.b = s;
          rp.hover = null;
          drawRange(root, s);
          return;
        }
        const pr = ev.target.closest("[data-pr]");
        if (pr) { const p = presets()[+pr.dataset.pr]; rp.a = p[1]; rp.b = p[2]; const q = ym(p[2]); rp.view = ymAdd(q[0], q[1], -1); drawRange(root); pr.ownerDocument.querySelector('[data-pr="' + pr.dataset.pr + '"]').focus(); return; }
        const st = ev.target.closest("[data-rv]");
        if (st && !st.disabled) { rp.view = ymAdd(rp.view[0], rp.view[1], +st.dataset.rv); drawRange(root); const again = root.querySelector('[data-rv="' + st.dataset.rv + '"]'); if (again && !again.disabled) again.focus(); }
      });
      root.addEventListener("mouseover", (ev) => {
        const b = ev.target.closest("[data-d]");
        if (!b || b.disabled || !rp.a || rp.b || rp.hover === b.dataset.d) return;
        rp.hover = b.dataset.d;
        root.querySelectorAll(".w-mgrid [data-d]").forEach((x) => {
          const s = x.dataset.d, lo = rp.a < rp.hover ? rp.a : rp.hover, hi = rp.a < rp.hover ? rp.hover : rp.a;
          x.classList.toggle("in", s > lo && s < hi);
          x.classList.toggle("s", s === lo);
          x.classList.toggle("e", s === hi);
        });
      });
    },
    onOk() {
      if (!(rp.a && rp.b)) return false;
      applyDates(rp.a, rp.b);
      onApply();
    },
  });
}
/* A whole calendar month (or this month so far) is shown as Month, anything else as Custom */
function applyDates(a, b) {
  const [y, m] = ym(b), monthEnd = ds(y, m, dim(y, m));
  if (a.slice(8) === "01" && a.slice(0, 7) === b.slice(0, 7) && (b === monthEnd || b === TODAY)) setMonth(+a.slice(0, 4), +a.slice(5, 7));
  else setMode("custom", [a, b]);
}

/* ---------- phones: the range as a sheet ---------- */
export function openRangeSheet(r, onApply) {
  const now = ym(TODAY), lm = ymAdd(now[0], now[1], -1);
  const items = [
    ["month", t("This month")],
    ["last", t("Last month")],
    ["year", t("Year to date")],
  ];
  const on = (k) => (k === "month" ? view.mode === "month" && view.ym[0] === now[0] && view.ym[1] === now[1]
    : k === "last" ? view.mode === "month" && view.ym[0] === lm[0] && view.ym[1] === lm[1] : view.mode === k);
  openDialog({
    title: t("Range"),
    ok: t("Apply"),
    body: '<div class="w-cells d-sheetlist" role="group" aria-label="' + esc(t("Range")) + '">' + items.map(([k, l]) =>
      '<button type="button" class="w-cell" data-pick="' + k + '" aria-pressed="' + on(k) + '"><span>' + l + "</span>" + (on(k) ? '<b class="ck" aria-hidden="true">✓</b>' : "") + "</button>").join("") + "</div>" +
      '<div class="w-plabel">' + t("Custom") + '</div><div class="w-cells">' +
      '<label class="w-cell"><span>' + t("From") + '</span><input type="date" class="d-date" id="d-rfrom" min="' + START + '" max="' + TODAY + '" value="' + r.start + '"></label>' +
      '<label class="w-cell"><span>' + t("To") + '</span><input type="date" class="d-date" id="d-rto" min="' + START + '" max="' + TODAY + '" value="' + r.end + '"></label></div>',
    onOpen(root) {
      root.classList.add("d-sheet");
      root.addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-pick]");
        if (!b) return;
        const k = b.dataset.pick;
        if (k === "last") setMonth(lm[0], lm[1]); else setMode(k);
        closeDialog();
        onApply();
      });
    },
    onOk(root) {
      const a = root.querySelector("#d-rfrom").value, b = root.querySelector("#d-rto").value;
      if (!a || !b) throw new Error(t("Pick both dates."));
      if (a > b) throw new Error(t("The first day comes after the last one."));
      applyDates(mmax(a, START), mmin(b, TODAY));
      onApply();
    },
  });
}
