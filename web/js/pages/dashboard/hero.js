/* Summary's chart data and its longer charts: the running total with its projection, and for a
   year or a long range, Income vs spending and By category. */
import {
  t, esc, TODAY, START, ds, dim, ym, ymAdd, addD, span, num, f, fk, monthName, monthIn, monthYear, F,
  dlab, dlabL, dlabY, totals, daily, cum, extend, monthsIn, monthBounds, cc, state, amt, T, tile, tagTile, tagColor, UNTAGGED,
} from "../../core.js";
import { el, txt, niceMax, hover, row } from "../../ui.js";
import { prevOf } from "./range.js";

const DASH = '<div class="r d-sum"><span>';

/* ---------- small helpers ---------- */
/* Spending: every expense, bills included. The notices can leave bills out (bills=false), so a
   yearly bill doesn't read as a category "well above usual". */
const spent = (x, bills) => x.type === "expense" && (bills || !x.rec);
export function eDaily(a, len, sc) {
  const arr = new Array(len).fill(0), t0 = T(a);
  for (const x of state.tx) {
    if (!spent(x, true)) continue;
    const i = Math.round((T(x.d) - t0) / 86400000);
    if (i < 0 || i >= len) continue;
    arr[i] += amt(x, sc);
  }
  return arr;
}
export function eTotal(a, b, sc) { let v = 0; for (const x of state.tx) if (x.d >= a && x.d <= b && spent(x, true)) v += amt(x, sc); return v; }
export function eByCat(a, b, sc, bills = true) { const o = {}; for (const x of state.tx) { if (x.d < a || x.d > b || !spent(x, bills)) continue; const v = amt(x, sc); if (v) o[x.c] = (o[x.c] || 0) + v; } return o; }
/* An expense with several tags counts evenly under each, so the tags add up to what was spent */
export function eByTag(a, b, sc) {
  const o = {};
  for (const x of state.tx) {
    if (x.d < a || x.d > b || !spent(x, true)) continue;
    const v = amt(x, sc);
    if (!v) continue;
    const tags = x.tags.length ? x.tags : [UNTAGGED];
    for (const g of tags) o[g] = (o[g] || 0) + v / tags.length;
  }
  return o;
}
/* The two ways Summary splits spending, for the cards and the chart. go is a row's link, null when it has none. */
export const BY_CAT = { sum: eByCat, color: cc, tile, name: (k) => k, go: (k) => 'data-go-cat="' + esc(k) + '"',
  chartLabel: (range) => t("Spending by category and month in {range}", { range }) };
export const BY_TAG = { sum: eByTag, color: tagColor, tile: tagTile, name: (k) => (k === UNTAGGED ? t("Untagged") : k), go: (k) => (k === UNTAGGED ? null : 'data-go-tag="' + esc(k) + '"'),
  chartLabel: (range) => t("Spending by tag and month in {range}", { range }) };
export const anyTags = () => state.tx.some((x) => x.type === "expense" && x.tags.length);
function monthCum(y, m) { return cum(eDaily(ds(y, m, 1), dim(y, m))); }
function haveMonth(y, m, back) { const q = ymAdd(y, m, -back); return ds(q[0], q[1], 1) >= START; }
/* "Oct 26" on an axis: the year only on January and on the first label */
export function monLabel(y, m, withYear, short) { return F.mon[m - 1] + (withYear ? (short ? " ’" + String(y).slice(2) : " " + y) : ""); }

/* ---------- the running total: this range, the one before it (the dashed line), and a projection
   shaped like the last three months ---------- */
export function paceData(r) {
  const p = prevOf(r), days = span(r.start, r.end), cur = cum(eDaily(r.start, days));
  let len = r.len, cmp = null, cmpName = "", cmpShort = "", proj = null, label = "", avg3 = null;
  if (r.month) {
    const [y, m] = ym(r.start);
    if (haveMonth(y, m, 3)) {
      avg3 = [1, 2, 3].map((k) => { const q = ymAdd(y, m, -k); return extend(monthCum(q[0], q[1]), len); })
        .reduce((a, b) => a.map((v, i) => v + b[i])).map((v) => v / 3);
    }
    if (haveMonth(y, m, 1)) { const q = ymAdd(y, m, -1); cmp = extend(monthCum(q[0], q[1]), len); cmpName = cmpShort = monthName(q[1]); label = monthIn(q[1]); }
    if (r.current && avg3) { const ci = cur.length - 1; proj = []; for (let i = ci; i < len; i++) proj.push(cur[ci] + (avg3[i] - avg3[ci])); }
  } else if (r.mode === "year") {
    const py = +r.start.slice(0, 4) - 1, ly = py + "-01-01";
    len = span(r.start, r.start.slice(0, 4) + "-12-31");
    if (ly >= START) {
      cmp = extend(cum(eDaily(ly, span(ly, py + "-12-31"))), len); cmpName = cmpShort = String(py); label = p.label;
      if (r.current) { const ci = cur.length - 1; proj = []; for (let i = ci; i < len; i++) proj.push(cur[ci] + (cmp[i] - cmp[ci])); }
    }
  } else if (p.ok) {
    cmp = extend(cum(eDaily(p.start, span(p.start, p.end))), len); cmpName = t("Previous period"); cmpShort = t("previous"); label = p.label;
  }
  const curName = r.month ? monthName(+r.start.slice(5, 7)) : r.mode === "year" ? r.start.slice(0, 4) : t("This range");
  return { len, cur, cmp, cmpName, cmpShort, proj, label, curName };
}
/* The axis label for day i of the pace chart */
export function paceLabel(r, len) {
  const isLong = len > 62;
  return (i, first, full) => {
    const s = addD(r.start, i);
    if (full) return isLong ? dlabY(s) : dlabL(s);
    if (isLong) return monLabel(+s.slice(0, 4), +s.slice(5, 7), +s.slice(5, 7) === 1 || i === 0);
    return first || +s.slice(8) === 1 ? dlab(s) : num(+s.slice(8));
  };
}

/* ---------- charts ---------- */
function grid(svg, m, w, h, ymax, Y, steps) {
  for (let k = 0; k <= steps; k++) {
    const v = (ymax / steps) * k;
    el("line", { x1: m.l, x2: w - m.r, y1: Y(v), y2: Y(v), class: k ? "grid" : "base" }, svg);
    txt(svg, m.l - 10, Y(v) + 4, fk(v), "ax", "end");
  }
}
export function barPath(x0, base, width, hh, r) {
  r = Math.min(r, hh / 2, width / 2);
  return "M" + x0 + " " + base + "V" + (base - hh + r) + "q0 " + -r + " " + r + " " + -r + "h" + (width - 2 * r) + "q" + r + " 0 " + r + " " + r + "V" + base + "Z";
}
export function heroMonthly(svg, w, h, months) {
  const m = { l: 50, r: 16, t: 16, b: 26 };
  const ymax = niceMax(Math.max(...months.map((x) => Math.max(x.inc, x.exp)), 1));
  const Y = (v) => h - m.b - (v / ymax) * (h - m.t - m.b);
  grid(svg, m, w, h, ymax, Y, 4);
  const bw = (w - m.l - m.r) / months.length, bar = Math.min(26, bw * 0.3), skip = bw < 34 ? 2 : 1;
  months.forEach((x, i) => {
    const cx = m.l + bw * i + bw / 2;
    [[x.inc, "var(--w-good)", -1], [x.exp, "var(--w-accent)", 1]].forEach(([v, col, side]) => {
      const hh = Math.max(1, ((h - m.t - m.b) * v) / ymax), x0 = cx + (side < 0 ? -bar - 2 : 2);
      el("path", { d: barPath(x0, h - m.b, bar, hh, 4), fill: col, "fill-opacity": side < 0 ? 0.75 : 1 }, svg);
    });
    if (i % skip === 0) txt(svg, cx, h - 7, monLabel(x.y, x.m, x.m === 1 || i === 0), "ax", "middle");
    const hit = el("rect", { x: m.l + bw * i, y: m.t, width: bw, height: h - m.t - m.b, fill: "transparent" }, svg);
    hover(hit, "<b>" + esc(monthYear(x.y, x.m)) + (x.partial ? ", " + t("so far") : "") + "</b>" + row(t("Income"), f(x.inc), "var(--w-good)") + row(t("Spending"), f(x.exp), "var(--w-accent)") +
      row(x.inc >= x.exp ? t("Kept") : t("Overspent"), f(Math.abs(x.inc - x.exp))));
  });
}
export function heroCats(svg, w, h, months, keys, by) {
  const m = { l: 50, r: 16, t: 16, b: 26 };
  if (!keys.length) { txt(svg, w / 2, h / 2, t("All categories are hidden. Click one in the legend to show it."), "lb2", "middle"); return; }
  const sum = (x) => keys.reduce((s, k) => s + (x.cats[k] || 0), 0);
  const ymax = niceMax(Math.max(...months.map(sum), 1));
  const Y = (v) => h - m.b - (v / ymax) * (h - m.t - m.b), bw = (w - m.l - m.r) / months.length, X = (i) => m.l + bw * i + bw / 2;
  const band = el("rect", { y: m.t, width: bw, height: h - m.t - m.b, rx: 8, fill: "var(--w-fill)", opacity: 0 }, svg);
  grid(svg, m, w, h, ymax, Y, 4);
  const skip = bw < 34 ? 2 : 1;
  months.forEach((x, i) => { if (i % skip === 0) txt(svg, X(i), h - 7, monLabel(x.y, x.m, x.m === 1 || i === 0), x.partial ? "lb" : "ax", "middle"); });
  const bar = Math.min(44, bw * 0.58);
  months.forEach((x, i) => {
    let y0 = h - m.b;
    const x0 = X(i) - bar / 2, vis = keys.filter((k) => x.cats[k] > 0), last = vis[vis.length - 1];
    vis.forEach((k) => {
      const hh = (x.cats[k] / ymax) * (h - m.t - m.b), top = y0 - hh, r = k === last ? Math.min(4, hh / 2) : 0;
      el("path", { d: "M" + x0 + " " + y0 + "V" + (top + r) + (r ? "q0 " + -r + " " + r + " " + -r : "") + "H" + (x0 + bar - r) + (r ? "q" + r + " 0 " + r + " " + r : "") + "V" + y0 + "Z",
        fill: by.color(k), stroke: "var(--w-panel)", "stroke-width": 1.5, "fill-opacity": x.partial ? 0.75 : 1 }, svg);
      y0 = top;
    });
  });
  months.forEach((x, i) => {
    const hit = el("rect", { x: m.l + bw * i, y: m.t, width: bw, height: h - m.t, fill: "transparent" }, svg);
    hit.addEventListener("pointerenter", () => { band.setAttribute("x", m.l + bw * i); band.setAttribute("opacity", 1); });
    hit.addEventListener("pointerleave", () => band.setAttribute("opacity", 0));
    hover(hit, () => {
      const ks = keys.filter((k) => x.cats[k]).sort((a, b) => x.cats[b] - x.cats[a]);
      return "<b>" + esc(monthYear(x.y, x.m)) + (x.partial ? ", " + t("so far") : "") + "</b>" + ks.map((k) => row(esc(by.name(k)), f(x.cats[k]), by.color(k))).join("") +
        DASH + t("Total shown") + "</span><b>" + f(sum(x)) + "</b></div>";
    });
  });
}

export function monthsOf(r) {
  return monthsIn(r.start, r.end).map(([y, m]) => {
    const b = monthBounds(y, m);
    if (b[0] < r.start) b[0] = r.start;
    if (b[1] > r.end) b[1] = r.end;
    const tt = totals(b[0], b[1]);
    return { y, m, a: b[0], b: b[1], inc: tt.inc, exp: tt.exp, partial: b[1] === TODAY && b[1] !== ds(y, m, dim(y, m)) };
  });
}
