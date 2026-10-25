/* The Dashboard's lead panel: the status headline, the main chart (Spent so far, Income vs
   spending, By category, Category lines, or the same as a table) and five key figures ending
   in Safe to spend. */
import {
  state, t, tn, esc, TODAY, START, ds, dim, ym, ymAdd, span, addD, f, f0, fk, pct, num, bigMoney, monthName, monthIn, monthYear, F,
  dlab, dlabW, dlabL, dlabY, totals, byCat, daily, cum, extend, monthsIn, monthBounds, cc, savingsTarget, amt, mmin,
} from "../../core.js";
import { chart, el, txt, niceMax, hover, row, showTip, hideTip, empty } from "../../ui.js";
import { occurrences, ruleAmt, isIncome, active } from "../../sched.js";
import { view, prevOf } from "./range.js";

const $ = (id) => document.getElementById(id);
const DASH = '<div class="r d-sum"><span>';

/* ---------- small helpers ---------- */
export function cmpMode() { return state.prefs.cmp === "avg3" ? "avg3" : "last"; }
function monthCum(y, m) { return cum(daily(ds(y, m, 1), dim(y, m))); }
function haveMonth(y, m, back) { const q = ymAdd(y, m, -back); return ds(q[0], q[1], 1) >= START; }
/* "Oct 26" on an axis: the year only on January and on the first label */
export function monLabel(y, m, withYear, short) { return F.mon[m - 1] + (withYear ? (short ? " ’" + String(y).slice(2) : " " + y) : ""); }
function signed(n, fmt) { return (n < 0 ? "−" : "") + (fmt || f)(Math.abs(n)); }

/* A total that counts to its new value when the range changes */
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
export function countTo(node, to) {
  const from = typeof node._v === "number" ? node._v : null;
  node._v = to;
  if (from === null || from === to || reduceMotion.matches) { node.innerHTML = bigMoney(to); return; }
  const t0 = performance.now(), dur = 400;
  const step = (now) => {
    if (node._v !== to) return;
    const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    node.innerHTML = bigMoney(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ---------- the running total: this range, what it is set against, and a projection ---------- */
export function paceData(r) {
  const p = prevOf(r), days = span(r.start, r.end), cur = cum(daily(r.start, days));
  let len = r.len, cmp = null, cmpName = "", cmpShort = "", proj = null, label = "", avg3 = null;
  if (r.month) {
    const [y, m] = ym(r.start);
    if (haveMonth(y, m, 3)) {
      avg3 = [1, 2, 3].map((k) => { const q = ymAdd(y, m, -k); return extend(monthCum(q[0], q[1]), len); })
        .reduce((a, b) => a.map((v, i) => v + b[i])).map((v) => v / 3);
    }
    if (cmpMode() === "avg3" && avg3) { cmp = avg3; cmpName = t("3-month average"); cmpShort = t("3-month avg"); label = t("the 3-month average"); }
    else if (haveMonth(y, m, 1)) { const q = ymAdd(y, m, -1); cmp = extend(monthCum(q[0], q[1]), len); cmpName = cmpShort = monthName(q[1]); label = monthIn(q[1]); }
    if (r.current && avg3) { const ci = cur.length - 1; proj = []; for (let i = ci; i < len; i++) proj.push(cur[ci] + (avg3[i] - avg3[ci])); }
  } else if (r.mode === "year") {
    const py = +r.start.slice(0, 4) - 1, ly = py + "-01-01";
    len = span(r.start, r.start.slice(0, 4) + "-12-31");
    if (ly >= START) {
      cmp = extend(cum(daily(ly, span(ly, py + "-12-31"))), len); cmpName = cmpShort = String(py); label = p.label;
      if (r.current) { const ci = cur.length - 1; proj = []; for (let i = ci; i < len; i++) proj.push(cur[ci] + (cmp[i] - cmp[ci])); }
    }
  } else if (p.ok) {
    cmp = extend(cum(daily(p.start, span(p.start, p.end))), len); cmpName = t("Previous period"); cmpShort = t("previous"); label = p.label;
  }
  const curName = r.month ? monthName(+r.start.slice(5, 7)) : r.mode === "year" ? r.start.slice(0, 4) : t("This range");
  return { len, cur, cmp, cmpName, cmpShort, proj, label, curName, avg3: !!avg3 };
}
/* The axis label for day i of the pace chart */
function paceLabel(r, len) {
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
function heroDaily(svg, w, h, o) {
  const m = { l: 50, r: w < 560 ? 84 : 118, t: 20, b: 26 }, len = o.len;
  const all = o.cur.concat(o.cmp || []).concat(o.proj || []);
  const ymax = niceMax(Math.max(...all, 1) * 1.04);
  const X = (i) => m.l + (len > 1 ? i / (len - 1) : 0.5) * (w - m.l - m.r), Y = (v) => h - m.b - (v / ymax) * (h - m.t - m.b);
  const defs = el("defs", {}, svg), g = el("linearGradient", { id: "d-hgrad", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  el("stop", { offset: 0, "stop-color": "var(--w-accent)", "stop-opacity": 0.24 }, g);
  el("stop", { offset: 1, "stop-color": "var(--w-accent)", "stop-opacity": 0 }, g);
  grid(svg, m, w, h, ymax, Y, 4);
  if (o.ticks) o.ticks.forEach((i) => txt(svg, X(i), h - 7, o.xlab(i, i === 0), "ax", i === 0 ? "start" : "middle"));
  else {
    const step = len > 45 ? 7 : len > 20 ? (w < 560 ? 7 : 5) : len > 10 ? 2 : 1;
    for (let i = 0; i < len; i += step) { if (i > 0 && len - 1 - i < step * 0.6) continue; txt(svg, X(i), h - 7, o.xlab(i, i === 0), "ax", i === 0 ? "start" : "middle"); }
    if (len > 1) txt(svg, X(len - 1), h - 7, o.xlab(len - 1, false), "ax", "middle");
  }
  const path = (arr, off) => arr.map((v, j) => (j ? "L" : "M") + X(j + (off || 0)).toFixed(1) + " " + Y(v).toFixed(1)).join("");
  const ci = o.cur.length - 1, line = path(o.cur);
  el("path", { d: line + "L" + X(ci) + " " + Y(0) + "L" + X(0) + " " + Y(0) + "Z", fill: "url(#d-hgrad)" }, svg);
  if (o.cmp) el("path", { d: path(o.cmp), fill: "none", stroke: "var(--w-ink3)", "stroke-width": 1.75, "stroke-dasharray": "5 5", "stroke-linejoin": "round" }, svg);
  if (o.proj) el("path", { d: path(o.proj, ci), fill: "none", stroke: "var(--w-accent)", "stroke-width": 2.5, "stroke-dasharray": "0.1 6", "stroke-linecap": "round" }, svg);
  el("path", { d: line, fill: "none", stroke: "var(--w-accent)", "stroke-width": 2.5, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
  if (o.today) { el("line", { x1: X(ci), x2: X(ci), y1: m.t - 6, y2: h - m.b, stroke: "var(--w-line)", "stroke-width": 1 }, svg); txt(svg, X(ci), m.t - 9, t("Today"), "ax", "middle"); }
  el("circle", { cx: X(ci), cy: Y(o.cur[ci]), r: 5, fill: "var(--w-accent)", stroke: "var(--w-panel)", "stroke-width": 2.5 }, svg);
  // Labels at the end of each line, nudged apart so they never overlap
  const ends = [];
  if (o.proj) ends.push({ y: Y(o.proj[o.proj.length - 1]), a: "≈ " + f0(o.proj[o.proj.length - 1]), b: t("projected"), cls: "acc" });
  else ends.push({ y: Y(o.cur[ci]), a: f0(o.cur[ci]), b: o.curName, cls: "acc" });
  if (o.cmp) ends.push({ y: Y(o.cmp[o.cmp.length - 1]), a: f0(o.cmp[o.cmp.length - 1]), b: o.cmpShort, cls: "lb2" });
  ends.sort((a, b) => a.y - b.y);
  for (let e = 1; e < ends.length; e++) if (ends[e].y - ends[e - 1].y < 32) ends[e].y = ends[e - 1].y + 32;
  ends.forEach((e) => { txt(svg, w - m.r + 12, e.y, e.a, "lb " + e.cls); txt(svg, w - m.r + 12, e.y + 15, e.b, "lbs"); });
  // Crosshair and tooltip
  const cross = el("line", { y1: m.t, y2: h - m.b, stroke: "var(--w-ink3)", "stroke-width": 1, opacity: 0 }, svg);
  const d1 = el("circle", { r: 4.5, fill: "var(--w-panel)", stroke: "var(--w-accent)", "stroke-width": 2.5, opacity: 0 }, svg);
  const d2 = el("circle", { r: 4, fill: "var(--w-panel)", stroke: "var(--w-ink3)", "stroke-width": 2, opacity: 0 }, svg);
  const hit = el("rect", { x: m.l, y: m.t, width: w - m.l - m.r, height: h - m.t - m.b, fill: "transparent" }, svg);
  const move = (ev) => {
    const b = svg.getBoundingClientRect(), i = Math.max(0, Math.min(len - 1, Math.round(((ev.clientX - b.left - m.l) / (w - m.l - m.r)) * (len - 1))));
    const cv = i <= ci ? o.cur[i] : o.proj ? o.proj[i - ci] : null, cmpv = o.cmp ? o.cmp[i] : null;
    cross.setAttribute("x1", X(i)); cross.setAttribute("x2", X(i)); cross.setAttribute("opacity", 1);
    if (cv != null) { d1.setAttribute("cx", X(i)); d1.setAttribute("cy", Y(cv)); d1.setAttribute("opacity", 1); } else d1.setAttribute("opacity", 0);
    if (cmpv != null) { d2.setAttribute("cx", X(i)); d2.setAttribute("cy", Y(cmpv)); d2.setAttribute("opacity", 1); } else d2.setAttribute("opacity", 0);
    let html = "<b>" + esc(o.xlab(i, true, true)) + "</b>";
    if (cv != null) html += row(i <= ci ? esc(o.curName) : t("Projected"), f(cv), "var(--w-accent)");
    if (cmpv != null) html += row(esc(o.cmpName), f(cmpv), "var(--w-ink3)");
    if (cv != null && cmpv != null) { const df = cv - cmpv; html += row(t("Difference"), '<span class="' + (df > 0 ? "up-bad" : "dn-good") + '">' + (df > 0 ? "+" : "−") + f(Math.abs(df)) + "</span>"); }
    showTip(html, ev);
  };
  hit.addEventListener("pointermove", move);
  hit.addEventListener("pointerdown", move);
  hit.addEventListener("pointerleave", () => { cross.setAttribute("opacity", 0); d1.setAttribute("opacity", 0); d2.setAttribute("opacity", 0); hideTip(); });
}
/* A rounded-top bar from the baseline */
export function barPath(x0, base, width, hh, r) {
  r = Math.min(r, hh / 2, width / 2);
  return "M" + x0 + " " + base + "V" + (base - hh + r) + "q0 " + -r + " " + r + " " + -r + "h" + (width - 2 * r) + "q" + r + " 0 " + r + " " + r + "V" + base + "Z";
}
function heroMonthly(svg, w, h, months) {
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
function heroCats(svg, w, h, months, keys, lines) {
  const m = { l: 50, r: 16, t: 16, b: 26 };
  if (!keys.length) { txt(svg, w / 2, h / 2, t("All categories are hidden. Click one in the legend to show it."), "lb2", "middle"); return; }
  const sum = (x) => keys.reduce((s, k) => s + (x.cats[k] || 0), 0);
  const ymax = niceMax(Math.max(...months.map((x) => (lines ? Math.max(...keys.map((k) => x.cats[k] || 0)) : sum(x))), 1));
  const Y = (v) => h - m.b - (v / ymax) * (h - m.t - m.b), bw = (w - m.l - m.r) / months.length, X = (i) => m.l + bw * i + bw / 2;
  const band = el("rect", { y: m.t, width: bw, height: h - m.t - m.b, rx: 8, fill: "var(--w-fill)", opacity: 0 }, svg);
  grid(svg, m, w, h, ymax, Y, 4);
  const skip = bw < 34 ? 2 : 1;
  months.forEach((x, i) => { if (i % skip === 0) txt(svg, X(i), h - 7, monLabel(x.y, x.m, x.m === 1 || i === 0), x.partial ? "lb" : "ax", "middle"); });
  if (lines) {
    keys.slice().reverse().forEach((k) => {
      const pts = months.map((x, i) => [X(i), Y(x.cats[k] || 0)]);
      el("path", { d: pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(""), fill: "none", stroke: cc(k), "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
      pts.forEach((p) => el("circle", { cx: p[0], cy: p[1], r: 3, fill: cc(k), stroke: "var(--w-panel)", "stroke-width": 1.5 }, svg));
    });
  } else {
    const bar = Math.min(44, bw * 0.58);
    months.forEach((x, i) => {
      let y0 = h - m.b;
      const x0 = X(i) - bar / 2, vis = keys.filter((k) => x.cats[k] > 0), last = vis[vis.length - 1];
      vis.forEach((k) => {
        const hh = (x.cats[k] / ymax) * (h - m.t - m.b), top = y0 - hh, r = k === last ? Math.min(4, hh / 2) : 0;
        el("path", { d: "M" + x0 + " " + y0 + "V" + (top + r) + (r ? "q0 " + -r + " " + r + " " + -r : "") + "H" + (x0 + bar - r) + (r ? "q" + r + " 0 " + r + " " + r : "") + "V" + y0 + "Z",
          fill: cc(k), stroke: "var(--w-panel)", "stroke-width": 1.5, "fill-opacity": x.partial ? 0.75 : 1 }, svg);
        y0 = top;
      });
    });
  }
  months.forEach((x, i) => {
    const hit = el("rect", { x: m.l + bw * i, y: m.t, width: bw, height: h - m.t, fill: "transparent" }, svg);
    hit.addEventListener("pointerenter", () => { band.setAttribute("x", m.l + bw * i); band.setAttribute("opacity", 1); });
    hit.addEventListener("pointerleave", () => band.setAttribute("opacity", 0));
    hover(hit, () => {
      const ks = keys.filter((k) => x.cats[k]).sort((a, b) => x.cats[b] - x.cats[a]);
      return "<b>" + esc(monthYear(x.y, x.m)) + (x.partial ? ", " + t("so far") : "") + "</b>" + ks.map((k) => row(esc(k), f(x.cats[k]), cc(k))).join("") +
        DASH + t("Total shown") + "</span><b>" + f(sum(x)) + "</b></div>";
    });
  });
}
function heroTable(rows, head) {
  $("h-tview").innerHTML = '<div class="w-tview"><table class="w-table"><thead><tr>' + head.map((x, i) => '<th scope="col"' + (i ? ' class="d-num"' : "") + ">" + esc(x) + "</th>").join("") +
    "</tr></thead><tbody>" + rows.map((r) => "<tr>" + r.map((c, i) => (i ? '<td class="d-num amt">' : '<th scope="row">') + c + (i ? "</td>" : "</th>")).join("") + "</tr>").join("") + "</tbody></table></div>";
}

/* ---------- figures under the chart ---------- */
function deltaHtml(cur, prev, goodWhenUp, fmt) {
  if (prev == null || !isFinite(prev)) return "<small>" + t("No earlier data") + "</small>";
  const d = cur - prev;
  if (Math.abs(d) < 0.005) return "<small>" + t("Same as before") + "</small>";
  const up = d > 0, cls = up === goodWhenUp ? "up-good" : "up-bad", mag = fmt ? fmt(Math.abs(d)) : f0(Math.abs(d));
  return "<small>" + t("{change} than before", { change: '<b class="' + cls + '">' + (up ? t("{amount} more", { amount: mag }) : t("{amount} less", { amount: mag })) + "</b>" }) + "</small>";
}

/* Usual everyday spending a day: the three months before this one, bills left out */
export function typicalDaily(sc) {
  const now = ym(TODAY), e = ymAdd(now[0], now[1], -1), s = ymAdd(now[0], now[1], -3);
  let a = ds(s[0], s[1], 1);
  const b = ds(e[0], e[1], dim(e[0], e[1]));
  if (a < START) a = START;
  if (b < a) return 0;
  let tot = 0;
  for (const x of state.tx) if (x.type === "expense" && !x.rec && x.d >= a && x.d <= b) tot += amt(x, sc);
  return tot / span(a, b);
}

/* Safe to spend this month: income so far and still due, minus the savings target, what is
   spent, and bills still due, shared over the days left */
export function safeInfo(start, sc) {
  sc = sc || state.scope;
  const [y, m] = ym(start), endM = ds(y, m, dim(y, m)), tt = totals(start, mmin(endM, TODAY), sc), left = span(TODAY, endM) - 1;
  let bills = 0, due = 0;
  if (left > 0) occurrences(addD(TODAY, 1), endM).forEach((x) => { const v = ruleAmt(x.r, sc); if (isIncome(x.r)) due += v; else bills += v; });
  const inc = tt.inc + due, target = inc * savingsTarget(), free = inc - target - tt.exp - bills;
  const rules = state.rules.filter((x) => !x.paused && active(x) && ruleAmt(x, sc) > 0).length;
  return { t: tt, left, bills, due, inc, target, free, per: free / Math.max(left, 1), rules };
}

/* Budget-aware: the flexible budget that will run over the most this month at this pace */
export function budgetWarning(r) {
  if (state.scope !== "all" || !r.month || !r.current || !state.budgets || !state.budgets.length) return null;
  const spent = byCat(r.start, r.end, "all"), day = +TODAY.slice(8), D = r.len;
  let worst = null;
  state.budgets.forEach((b) => {
    if (b.kind !== "flexible") return;
    const s = spent[b.category] || 0, cap = Number(b.amount);
    if (!s || !cap) return;
    const already = s > cap, over = already ? s - cap : (s / day) * D - cap;
    if (over < 1 || (!already && day < 5)) return; // too early in the month to call it
    if (!worst || over > worst.over) worst = { c: b.category, over, already };
  });
  return worst;
}

export function renderStatus(r) {
  const box = $("h-status");
  const tt = totals(r.start, r.end);
  if (!tt.n && !(r.month && r.current)) { box.hidden = true; return; }
  box.hidden = false;
  const target = num(Number(state.config.savings_target ?? 15)) + "%";
  if (r.month && r.current) {
    const s = safeInfo(r.start), typ = typicalDaily(), bud = budgetWarning(r);
    let key, sent;
    if (!s.inc) {
      key = "watch";
      sent = t("No income recorded this month yet. Add it, or a repeating income, to see what is safe to spend.");
    } else {
      // The pill is about the household's money as a whole; a budget running over is told, not flagged
      key = s.per < 0 ? "over" : s.per < typ * 0.8 ? "watch" : "ok";
      if (key === "over") sent = t("Spending has run {amount} past what is left after bills and the {pct} savings target. The month will save less than planned.", { amount: "<b>" + f0(-s.free) + "</b>", pct: target });
      else if (!s.left) sent = t("The month ends today: <b>{amount}</b> is left after bills and <b>{saved}</b> kept for savings.", { amount: f0(s.free), saved: f0(s.target) });
      // Far above the usual pace, a daily figure means nothing: say what is left
      else if (typ > 0 && s.per > typ * 2)
        sent = tn(s.left, "<b>{amount}</b> is left for the next {n} day after {bills} in bills and <b>{saved}</b> kept for savings, well ahead of your usual pace.",
          "<b>{amount}</b> is left for the next {n} days after {bills} in bills and <b>{saved}</b> kept for savings, well ahead of your usual pace.", { amount: f0(s.free), bills: f0(s.bills), saved: f0(s.target) });
      else {
        sent = tn(s.left, "You can spend <b>{amount} a day</b> for the next {n} day, after {bills} in bills and <b>{saved}</b> kept for savings.",
          "You can spend <b>{amount} a day</b> for the next {n} days, after {bills} in bills and <b>{saved}</b> kept for savings.", { amount: f0(s.per), bills: f0(s.bills), saved: f0(s.target) });
        if (typ > 0) sent += " " + (s.per < typ * 0.8 ? t("That is less than your usual {amount} a day.", { amount: f0(typ) }) : t("Your usual is {amount} a day.", { amount: f0(typ) }));
      }
      if (bud) sent += " " + esc(bud.already ? t("{category} is already {amount} over budget.", { category: bud.c, amount: f0(bud.over) }) : t("{category} will run {amount} over at this pace.", { category: bud.c, amount: f0(bud.over) }));
    }
    const pill = { ok: t("On track"), watch: t("Watch"), over: t("Over") }[key];
    box.className = "w-status " + key;
    box.innerHTML = '<span class="w-spill">' + pill + "</span><p>" + sent + '</p><a class="w-link" href="/settings/savings" data-link>' +
      esc(t("{pct} target", { pct: target })) + " · " + esc(tn(s.rules, "{n} rule", "{n} rules")) + "</a>";
  } else {
    const ok = tt.net >= 0, amount = "<b>" + esc((ok ? t("{amount} kept", { amount: f0(Math.abs(tt.net)) }) : t("{amount} overspent", { amount: f0(Math.abs(tt.net)) }))) + "</b>";
    let sent = r.month ? t("{month} closed with {amount}", { month: esc(monthYear(...ym(r.start))), amount }) : t("Across {range}: {amount}", { range: esc(r.noun), amount });
    sent += tt.rate != null ? ", " + t("{pct} of income.", { pct: pct(Math.abs(tt.rate)) }) : ".";
    box.className = "w-status " + (ok ? "ok" : "over");
    box.innerHTML = '<span class="w-spill">' + (ok ? t("Kept") : t("Overspent")) + "</span><p>" + sent + "</p><span></span>";
  }
}

function renderKpis(r, tt, pt) {
  const k = $("h-kpis");
  let html =
    '<div class="w-kpi"><span>' + t("Income") + '</span><b class="pos">' + f(tt.inc) + "</b>" + deltaHtml(tt.inc, pt && pt.inc, true) + "</div>" +
    '<div class="w-kpi"><span>' + t("Spending") + "</span><b>" + f(tt.exp) + "</b>" + deltaHtml(tt.exp, pt && pt.exp, false) + "</div>" +
    '<div class="w-kpi"><span>' + (tt.net >= 0 ? t("Kept") : t("Overspent")) + "</span><b>" + f(Math.abs(tt.net)) + "</b>" + deltaHtml(tt.net, pt && pt.net, true) + "</div>" +
    '<div class="w-kpi"><span>' + t("Savings rate") + "</span><b>" + (tt.rate == null ? "—" : pct(tt.rate)) + "</b>" +
      (tt.rate != null && pt && pt.rate != null ? deltaHtml(tt.rate * 100, pt.rate * 100, true, (x) => tn(Math.round(x), "{n} pt", "{n} pts")) : "<small>&nbsp;</small>") + "</div>";
  let n = 4, si = null;
  if (r.month && r.current) {
    si = safeInfo(r.start);
    const target = num(Number(state.config.savings_target ?? 15)) + "%";
    html += '<div class="w-kpi safe" id="kpi-safe" tabindex="0"><span>' + t("Safe to spend") + "</span>" +
      (si.inc ? '<b class="' + (si.per < 0 ? "up-bad" : "") + '">' + signed(si.per, f0) + '<span class="d-unit"> ' + t("a day") + "</span></b>" +
        "<small>" + (si.left ? tn(si.left, "for {n} day, after bills and {pct} saved", "for {n} days, after bills and {pct} saved", { pct: target }) : t("today, after bills and {pct} saved", { pct: target })) + "</small>"
        : "<b>—</b><small>" + t("No income this month yet") + "</small>") + "</div>";
    n = 5;
  } else if (!r.month) {
    const mo = monthsIn(r.start, r.end).length;
    html += '<div class="w-kpi safe"><span>' + t("Kept per month") + "</span><b>" + signed(tt.net / mo, f0) + "</b><small>" + tn(mo, "average over {n} month", "average over {n} months") + "</small></div>";
    n = 5;
  }
  k.innerHTML = html;
  k.style.setProperty("--n", n);
  if (si && si.inc) {
    const target = num(Number(state.config.savings_target ?? 15)) + "%";
    hover($("kpi-safe"), () => "<b>" + t("Safe to spend") + "</b>" + row(t("Income this month"), f(si.inc)) + (si.due ? row(t("of it still to come"), f(si.due)) : "") +
      row(t("Savings target, {pct}", { pct: target }), "−" + f(si.target)) + row(t("Spent so far"), "−" + f(si.t.exp)) + row(t("Bills still due"), "−" + f(si.bills)) +
      DASH + t("Free to spend") + "</span><b>" + signed(si.free) + "</b></div>" + row(t("Days left"), num(si.left)));
  }
}

/* ---------- the panel ---------- */
export function renderHero(r) {
  const tt = totals(r.start, r.end), p = prevOf(r), pt = p.ok ? totals(p.start, p.end) : null;
  const delta = $("h-delta"), legend = $("h-legend");
  $("h-hh").classList.toggle("d-wide", !r.daily && (view.hv === "cats" || view.hv === "lines"));
  countTo($("h-big"), tt.exp);
  $("h-cmp").hidden = !r.month;
  $("h-view").hidden = r.daily;
  $("h-view").querySelectorAll("[data-hv]").forEach((b) => b.setAttribute("aria-pressed", String(view.hv === b.dataset.hv)));
  $("h-table").setAttribute("aria-pressed", String(view.table));
  $("h-table").classList.toggle("on", view.table);
  renderStatus(r);
  renderKpis(r, tt, pt);

  // Nothing in the range: a short empty line instead of a blank chart
  const none = !tt.n;
  $("h-empty").hidden = !none;
  $("h-chartwrap").hidden = none;
  if (none) {
    $("h-empty").innerHTML = empty("overview", esc(r.current ? t("Nothing in {range} yet", { range: r.noun }) : t("Nothing recorded in {range}", { range: r.noun })),
      t("Add the first expense, or import a CSV from your bank."),
      '<div class="d-emptyb"><a class="w-btn ghost" href="/settings/import" data-link>' + t("Import") + '</a><button type="button" class="w-btn primary" data-open-add>' + t("Add expense") + "</button></div>");
    $("h-eye").textContent = r.current ? t("Spent so far") : t("Spent");
    delta.className = "w-delta"; delta.innerHTML = "";
    legend.innerHTML = "";
    return;
  }
  const cmpBtns = $("h-cmp").querySelectorAll("[data-cmp]");
  cmpBtns.forEach((b) => b.setAttribute("aria-pressed", String(cmpMode() === b.dataset.cmp)));
  if (r.daily || view.hv === "pace") renderPace(r, p, delta, legend);
  else renderMonthly(r, p, tt, pt, delta, legend);
}

function renderPace(r, p, delta, legend) {
  const d = paceData(r), idx = d.cur.length - 1, len = d.len;
  $("h-cmp").querySelector('[data-cmp="avg3"]').disabled = r.month && !d.avg3;
  if (d.cmp) {
    const df = d.cur[idx] - d.cmp[idx], up = df > 0;
    delta.className = "w-delta " + (up ? "bad" : "good");
    delta.innerHTML = "<b>" + esc((up ? t("{amount} more ({pct})", { amount: f0(Math.abs(df)), pct: pct(Math.abs(df) / Math.max(d.cmp[idx], 1)) }) : t("{amount} less ({pct})", { amount: f0(Math.abs(df)), pct: pct(Math.abs(df) / Math.max(d.cmp[idx], 1)) }))) + "</b><span>" +
      esc(r.current && (r.month || r.mode === "year") ? t("than {what} by {date}", { what: d.label, date: dlab(r.end) }) : t("than {what}", { what: d.label })) + "</span>";
  } else {
    delta.className = "w-delta";
    delta.innerHTML = r.month ? "" : "<span>" + esc(t("No data before {month} to compare", { month: monthYear(...ym(START)) })) + "</span>";
  }
  legend.innerHTML = "<span><i></i>" + esc(d.curName) + "</span>" + (d.cmp ? '<span><i class="dash"></i>' + esc(d.cmpName) + "</span>" : "") + (d.proj ? '<span><i class="dot"></i>' + t("Projected") + "</span>" : "");
  $("h-eye").textContent = r.month ? (r.current ? t("Spent so far") : t("Spent")) : r.current ? t("Spent so far in {range}", { range: r.noun }) : t("Spent in {range}", { range: r.noun });
  const isLong = len > 62, xlab = paceLabel(r, len);
  let ticks = null;
  if (isLong) { ticks = []; for (let i = 0; i < len; i++) if (i === 0 || (addD(r.start, i).slice(8) === "01" && i > 8)) ticks.push(i); }
  showChart(!view.table);
  if (view.table) {
    const rows = [];
    for (let i = 0; i < len; i++) {
      const s = addD(r.start, i);
      const v = i < d.cur.length ? f(d.cur[i]) : d.proj ? "≈ " + f(d.proj[i - idx] || 0) : "—";
      rows.push([esc(isLong ? dlabY(s) : dlabW(s)), v].concat(d.cmp ? [f(d.cmp[i])] : []));
    }
    heroTable(rows, [t("Day"), t("{name}, running total", { name: d.curName })].concat(d.cmp ? [d.cmpName] : []));
    return;
  }
  const label = () => t("Spent so far: {amount} by {date}", { amount: f(d.cur[idx]), date: dlab(r.end) }) + (d.cmp ? ". " + t("{name}: {amount}", { name: d.cmpName, amount: f(d.cmp[idx]) }) : "") +
    (d.proj ? ". " + t("Projected: {amount}", { amount: f(d.proj[d.proj.length - 1]) }) : "");
  chart("c-hero", (w) => (w < 560 ? 220 : 280), (svg, w, h) => heroDaily(svg, w, h, { len, cur: d.cur, cmp: d.cmp, proj: d.proj, today: r.current, curName: d.curName, cmpName: d.cmpName, cmpShort: d.cmpShort, ticks, xlab }), label);
}

function monthsOf(r) {
  return monthsIn(r.start, r.end).map(([y, m]) => {
    const b = monthBounds(y, m);
    if (b[0] < r.start) b[0] = r.start;
    if (b[1] > r.end) b[1] = r.end;
    const tt = totals(b[0], b[1]);
    return { y, m, a: b[0], b: b[1], inc: tt.inc, exp: tt.exp, partial: b[1] === TODAY && b[1] !== ds(y, m, dim(y, m)) };
  });
}
function renderMonthly(r, p, tt, pt, delta, legend) {
  const months = monthsOf(r);
  if (pt) {
    const d2 = tt.exp - pt.exp, up = d2 > 0;
    delta.className = "w-delta " + (up ? "bad" : "good");
    delta.innerHTML = "<b>" + esc((up ? t("{amount} more ({pct})", { amount: f0(Math.abs(d2)), pct: pct(Math.abs(d2) / Math.max(pt.exp, 1)) }) : t("{amount} less ({pct})", { amount: f0(Math.abs(d2)), pct: pct(Math.abs(d2) / Math.max(pt.exp, 1)) }))) + "</b><span>" + esc(t("than {what}", { what: p.label })) + "</span>";
  } else { delta.className = "w-delta"; delta.innerHTML = "<span>" + esc(t("No data before {month} to compare", { month: monthYear(...ym(START)) })) + "</span>"; }
  $("h-eye").textContent = r.current ? t("Spent so far in {range}", { range: r.noun }) : t("Spent in {range}", { range: r.noun });
  showChart(!view.table);
  if (view.hv !== "ivs") {
    const tot = byCat(r.start, r.end), keys = Object.keys(tot).sort((a, b) => tot[b] - tot[a]);
    months.forEach((x) => { x.cats = byCat(x.a, x.b); });
    legend.innerHTML = keys.map((k) => '<button type="button" class="lg" data-lg="' + esc(k) + '" aria-pressed="' + !view.hoff[k] + '"><s style="background:' + cc(k) + '"></s>' + esc(k) + "</button>").join("");
    const vis = keys.filter((k) => !view.hoff[k]);
    if (view.table) heroTable(months.map((x) => [esc(monthYear(x.y, x.m))].concat(vis.map((k) => f0(x.cats[k] || 0)))), [t("Month")].concat(vis));
    else chart("c-hero", (w) => (w < 560 ? 220 : 280), (svg, w, h) => heroCats(svg, w, h, months, vis, view.hv === "lines"),
      () => t("Spending by category and month in {range}", { range: r.noun }) + ": " + vis.slice(0, 5).map((k) => k + " " + f0(tot[k])).join(", "));
  } else {
    legend.innerHTML = '<span><s style="background:var(--w-good);opacity:.75"></s>' + t("Income") + '</span><span><s style="background:var(--w-accent)"></s>' + t("Spending") + "</span>";
    if (view.table) heroTable(months.map((x) => [esc(monthYear(x.y, x.m)), f(x.inc), f(x.exp), signed(x.inc - x.exp)]), [t("Month"), t("Income"), t("Spending"), t("Kept")]);
    else chart("c-hero", (w) => (w < 560 ? 220 : 280), (svg, w, h) => heroMonthly(svg, w, h, months),
      () => t("Income and spending by month in {range}", { range: r.noun }) + ": " + months.map((x) => monthYear(x.y, x.m) + " " + f0(x.inc) + " / " + f0(x.exp)).join(", "));
  }
}
function showChart(on) { $("c-hero").hidden = !on; $("h-tview").hidden = on; if (on) $("h-tview").innerHTML = ""; }

/* The panel's markup; renderHero fills it */
export function heroHtml() {
  const pill = (v, l) => '<button type="button" data-hv="' + v + '" aria-pressed="false">' + l + "</button>";
  return '<section class="w-panel d-hero" data-w="hero" aria-label="' + esc(t("Status and spending")) + '">' +
    '<div class="w-status" id="h-status"></div>' +
    '<div class="w-hh" id="h-hh"><div><div class="w-eyebrow" id="h-eye"></div><div class="w-hnum"><span class="w-big" id="h-big"></span><span class="w-delta" id="h-delta"></span></div></div>' +
    '<div class="w-hright"><div class="w-hctl">' +
      '<div class="w-seg sm" id="h-view" role="group" aria-label="' + esc(t("Chart")) + '" hidden>' + pill("pace", t("Spent so far")) + pill("ivs", t("Income vs spending")) + pill("cats", t("By category")) + pill("lines", t("Category lines")) + "</div>" +
      '<button type="button" class="w-btn ghost w-tbtn" id="h-table" aria-pressed="false">' + t("Table") + "</button></div>" +
      '<div class="w-seg sm" id="h-cmp" role="group" aria-label="' + esc(t("Compare with")) + '"><button type="button" data-cmp="last">' + t("vs last month") + '</button><button type="button" data-cmp="avg3">' + t("vs 3-month average") + "</button></div>" +
      '<div class="w-legend" id="h-legend"></div></div></div>' +
    '<div id="h-chartwrap"><div class="cv" id="c-hero"></div><div class="d-tview" id="h-tview" hidden></div></div>' +
    '<div id="h-empty" hidden></div>' +
    '<div class="w-kpis" id="h-kpis"></div></section>';
}
