/* The Dashboard's widgets below the lead panel. Each has its markup (WIDGETS[key].html) and a
   renderer (WIDGETS[key].render(r)). Clicks are handled once, in dashboard.js, from data-go-*
   attributes, so every click-through keeps the range. */
import {
  state, t, tn, esc, TODAY, START, ds, dim, ym, ymAdd, span, addD, wd, wkOff, dows, f, f0, fk, pct, num, num1, bigMoney, monthName, monthIn, monthYear, F,
  dlab, dlabW, dlabY, T, DAY, totals, byCat, byTag, daily, monthsIn, monthBounds, amt, cc, tile, icon, av, pname, couple, catIcon,
} from "../../core.js";
import { chart, el, txt, niceMax, hover, row, showTip, hideTip, empty } from "../../ui.js";
import { occurrences, ruleAmt, isIncome, perMonth, priceChange, shortDesc, active } from "../../sched.js";
import { dayMap, schedMap, monthGrid, gridHover, noSpendText } from "../../calendar.js";
import { view, prevOf } from "./range.js";
import { barPath, monLabel } from "./hero.js";

const $ = (id) => document.getElementById(id);
const dateOf = (s) => (s.slice(0, 4) === TODAY.slice(0, 4) ? dlab(s) : dlabY(s));

/* A typical expense in this household, so thresholds work in any currency (about 20 € in euros) */
let medCache = { tx: null, n: -1, v: 20 };
export function unit() {
  if (medCache.tx === state.tx && medCache.n === state.tx.length) return medCache.v;
  const a = state.tx.filter((x) => x.type === "expense").map((x) => x.a).sort((p, q) => p - q);
  medCache = { tx: state.tx, n: state.tx.length, v: a.length ? Math.max(a[Math.floor(a.length / 2)], 0.01) : 20 };
  return medCache.v;
}
/* Neutral shades for people in charts, so they never clash with category colors */
export function pcol(i) { return i === 0 ? "var(--w-p1)" : i === 1 ? "var(--w-p2)" : "color-mix(in srgb,var(--w-ink) " + Math.max(14, 30 - (i - 2) * 6) + "%,transparent)"; }

/* ---------- a transaction row ---------- */
export function txRow(x, opts) {
  opts = opts || {};
  const inc = x.type === "income", v = amt(x), part = x.p === null && state.scope !== "all" && Math.abs(v - x.a) > 0.005;
  return '<button type="button" class="w-row" data-go-id="' + esc(x.id) + '">' + tile(x.c) +
    '<div class="d-min"><h6>' + esc(x.n || x.c) + "</h6><p>" + (opts.date ? esc(dlabW(x.d)) + " · " : "") +
    '<span class="d-who">' + av(x.p, "sm") + esc(pname(x.p)) + "</span>" + (opts.compact ? "" : " · " + esc(x.c)) +
    (x.rec ? ' <svg class="i d-rec" role="img" aria-label="' + esc(t("Recurring")) + '"><use href="#i-repeat"/></svg>' : "") +
    (opts.compact ? "" : x.tags.map((g) => ' <span class="w-ht">' + esc(g) + "</span>").join("")) + "</p></div>" +
    '<span class="amt' + (inc ? " pos" : "") + '">' + (inc ? "+" : "") + f(v) + (part ? '<small class="of">' + esc(t("of {amount}", { amount: f(x.a) })) + "</small>" : "") + "</span></button>";
}

/* ---------- Categories (or Tags) ---------- */
function budgetOf(name) {
  const b = (state.budgets || []).find((x) => x.category === name && x.kind !== "yearly");
  return b ? Number(b.amount) : 0;
}
function renderCats(r) {
  const p = prevOf(r), tags = view.ctab === "tags";
  const cur = tags ? byTag(r.start, r.end) : byCat(r.start, r.end);
  const prev = p.ok ? (tags ? byTag(p.start, p.end) : byCat(p.start, p.end)) : null;
  const keys = Object.keys(cur).sort((a, b) => cur[b] - cur[a]), tot = keys.reduce((s, k) => s + cur[k], 0) || 1;
  const buds = !tags && r.month && state.scope === "all";
  const max = Math.max(...keys.map((k) => Math.max(cur[k], (prev && prev[k]) || 0, buds ? budgetOf(k) : 0)), 1);
  $("ct").querySelectorAll("[data-ctab]").forEach((b) => b.setAttribute("aria-pressed", String(view.ctab === b.dataset.ctab)));
  $("cat-h").textContent = tags ? t("Tags") : t("Categories");
  const tick = prev ? " " + (r.month && r.current ? t("The tick is {label} by the same day.", { label: p.label }) : t("The tick is {label}.", { label: p.label })) : "";
  $("cat-sub").textContent = keys.length ? (tags ? t("{amount} tagged.", { amount: f(tot) }) : tn(keys.length, "{amount} across {n} category.", "{amount} across {n} categories.", { amount: f(tot) })) + tick : "";
  const share = $("cat-share");
  share.hidden = tags || !keys.length;
  share.innerHTML = tags ? "" : keys.map((k) => '<span tabindex="0" data-tipcat="' + esc(k) + '" style="flex-basis:' + (cur[k] / tot) * 100 + "%;background:" + cc(k) + '" aria-label="' + esc(k + ": " + pct(cur[k] / tot)) + '"></span>').join("");
  share.querySelectorAll("[data-tipcat]").forEach((s) => { const k = s.dataset.tipcat; hover(s, "<b>" + esc(k) + "</b>" + row(t("Spent"), f(cur[k])) + row(t("Share"), pct(cur[k] / tot))); });
  const box = $("cats");
  if (!keys.length) {
    box.innerHTML = tags ? empty("tag", t("No tags in this range"), t("Add a #tag to an expense to see it here, like #holiday.")) : empty("overview", t("No spending yet"), t("Nothing recorded in this range."));
    return;
  }
  box.innerHTML = keys.map((k) => {
    const v = cur[k], pv = prev ? prev[k] || 0 : null, col = tags ? "var(--w-accent)" : cc(k), bud = buds ? budgetOf(k) : 0;
    let dl = '<span class="w-dl"></span>';
    if (pv != null) {
      if (!pv) dl = '<span class="w-dl">' + t("New") + "</span>";
      else if (v / tot < 0.05 && Math.abs(v - pv) < tot * 0.01) dl = '<span class="w-dl" title="' + esc(t("Small change on a small category")) + '">—</span>';
      else { const d = (v - pv) / pv; dl = '<span class="w-dl ' + (d > 0.1 ? "up-bad" : d < -0.1 ? "dn-good" : "") + '">' + (Math.abs(d) < 0.005 ? t("Same") : (d > 0 ? "+" : "−") + pct(Math.abs(d))) + "</span>"; }
    }
    const go = tags ? 'data-go-q="' + esc(k) + '"' : 'data-go-cat="' + esc(k) + '"';
    return '<button type="button" class="w-cat" ' + go + ' data-k="' + esc(k) + '">' + (tags ? '<span class="w-ico">' + icon("tag") + "</span>" : tile(k)) +
      '<span class="nm">' + esc(k) + '</span><span class="w-bar"><span style="width:' + (v / max) * 100 + "%;background:" + col + '"></span>' +
      (pv ? '<i style="inset-inline-start:calc(' + (pv / max) * 100 + '% - 1px)"></i>' : "") + (bud ? '<i class="d-bud" style="inset-inline-start:calc(' + (bud / max) * 100 + '% - 1px)"></i>' : "") +
      '</span><span class="w-amt">' + f(v) + '</span><span class="w-pct">' + pct(v / tot) + "</span>" + dl + "</button>";
  }).join("");
  box.querySelectorAll("[data-k]").forEach((b) => {
    const k = b.dataset.k, bud = buds ? budgetOf(k) : 0;
    hover(b, () => "<b>" + esc(k) + "</b>" + row(t("Spent"), f(cur[k]), tags ? "var(--w-accent)" : cc(k)) + (prev ? row(esc(p.label), f(prev[k] || 0)) : "") +
      (bud ? row(t("Budget"), f(bud)) : "") + row(t("Share"), pct(cur[k] / tot)));
  });
}

/* ---------- Coming up: recurring money in the next 10 days ---------- */
function renderUpcoming() {
  const to = addD(TODAY, 10), occ = occurrences(addD(TODAY, 1), to).filter((x) => ruleAmt(x.r) > 0);
  let out = 0, inn = 0;
  occ.forEach((x) => { const v = ruleAmt(x.r); if (isIncome(x.r)) inn += v; else out += v; });
  const box = $("upcoming");
  if (!occ.length) {
    box.innerHTML = state.rules.length ? empty("repeat", t("Nothing scheduled"), t("No recurring money in the next 10 days."))
      : empty("repeat", t("No recurring rules yet"), t("Rent, salaries and subscriptions can repeat on their own."), '<button type="button" class="w-btn ghost" data-new-rule>' + t("Add a repeating expense") + "</button>");
    $("upcoming-f").hidden = true;
    return;
  }
  box.innerHTML = occ.slice(0, 5).map((x) => {
    const v = ruleAmt(x.r), inc = isIncome(x.r), share = x.r.p === null && state.scope !== "all";
    return '<button type="button" class="w-li d-lib" data-go-rule="' + esc(x.r.id) + '"><span class="w-date"><b>' + num(+x.d.slice(8)) + "</b><span>" + esc(F.mon[+x.d.slice(5, 7) - 1]) +
      '</span></span><div class="d-min"><h6>' + esc(x.r.n || x.r.c) + '</h6><p><span class="w-cdot" style="background:' + cc(x.r.c) + '"></span>' + esc(x.r.c) + " · " + esc(pname(x.r.p)) +
      (share ? " · " + t("your share") : "") + '</p></div><span class="w-amt' + (inc ? " pos" : "") + '">' + (inc ? "+" : "") + f(v) + "</span></button>";
  }).join("");
  const vars = { out: "<b>" + f(out) + "</b>", in: '<b class="pos">' + f(inn) + "</b>", date: esc(dlab(to)), n: occ.length - 5 };
  $("upcoming-f").hidden = false;
  $("upcoming-f").innerHTML = occ.length > 5 ? t("{out} going out and {in} coming in by {date}, including {n} not shown.", vars) : t("{out} going out and {in} coming in by {date}.", vars);
}

/* ---------- Savings over time: kept since the first month, running ---------- */
function renderSavings(r) {
  const months = monthsIn(START, r.end);
  let run = 0;
  const pts = months.map(([y, m]) => { const b = monthBounds(y, m); if (b[1] > r.end) b[1] = r.end; const tt = totals(b[0], b[1]); run += tt.net; return { y, m, v: run, net: tt.net }; });
  const n = pts.length, last = pts[n - 1];
  const done = pts.slice(-7, -1), avg = done.reduce((s, x) => s + x.net, 0) / Math.max(done.length, 1);
  const year = last.y, before = pts.filter((x) => x.y < year).pop(), ytd = last.v - (before ? before.v : 0);
  countToHtml($("sav-big"), last.v);
  let sub = t("Kept since {month}.", { month: esc(monthYear(pts[0].y, pts[0].m)) });
  if (r.end === TODAY && done.length) {
    const rest = 12 - last.m + (1 - +TODAY.slice(8) / dim(last.y, last.m));
    sub += " " + t("At this pace {amount} kept in {year}.", { amount: "<b>" + f0(ytd + avg * rest) + "</b>", year });
  } else if (last.m === 12 || r.end < TODAY) sub += " " + t("{amount} kept in {year}.", { amount: "<b>" + f0(ytd) + "</b>", year });
  $("sav-sub").innerHTML = sub;
  const extra = r.end === TODAY && done.length ? 2 : 0;
  chart("c-sav", 190, (svg, w, h) => {
    const m = { l: 46, r: 12, t: 12, b: 24 }, lo = Math.min(0, ...pts.map((p) => p.v)), hiV = Math.max(last.v + avg * extra, ...pts.map((p) => p.v), 1);
    const ymax = niceMax(hiV * 1.05), ymin = lo < 0 ? -niceMax(-lo * 1.05) : 0;
    const X = (i) => m.l + (n - 1 + extra ? i / (n - 1 + extra) : 0.5) * (w - m.l - m.r), Y = (v) => h - m.b - ((v - ymin) / (ymax - ymin)) * (h - m.t - m.b);
    for (let k = 0; k <= 4; k++) { const v = ymin + ((ymax - ymin) / 4) * k; el("line", { x1: m.l, x2: w - m.r, y1: Y(v), y2: Y(v), class: k ? "grid" : "base" }, svg); txt(svg, m.l - 8, Y(v) + 4, (v < 0 ? "−" : "") + fk(Math.abs(v)), "ax", "end"); }
    const defs = el("defs", {}, svg), g = el("linearGradient", { id: "d-sgrad", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el("stop", { offset: 0, "stop-color": "var(--w-good)", "stop-opacity": 0.22 }, g); el("stop", { offset: 1, "stop-color": "var(--w-good)", "stop-opacity": 0 }, g);
    const d = pts.map((p, i) => (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(p.v).toFixed(1)).join("");
    el("path", { d: d + "L" + X(n - 1) + " " + Y(Math.max(0, ymin)) + "L" + X(0) + " " + Y(Math.max(0, ymin)) + "Z", fill: "url(#d-sgrad)" }, svg);
    if (extra) el("path", { d: "M" + X(n - 1) + " " + Y(last.v) + "L" + X(n + 1) + " " + Y(last.v + avg * 2), fill: "none", stroke: "var(--w-good)", "stroke-width": 2.25, "stroke-dasharray": "0.1 6", "stroke-linecap": "round" }, svg);
    el("path", { d, fill: "none", stroke: "var(--w-good)", "stroke-width": 2.25, "stroke-linejoin": "round" }, svg);
    let lastX = -99;
    pts.forEach((p, i) => {
      if (!(p.m === 1 || i === 0 || i === n - 1)) return;
      const x = X(i);
      if (i === n - 1 || x - lastX > 64) { txt(svg, x, h - 6, monLabel(p.y, p.m, true), "ax", i === 0 ? "start" : i === n - 1 && !extra ? "end" : "middle"); lastX = x; }
    });
    el("circle", { cx: X(n - 1), cy: Y(last.v), r: 4.5, fill: "var(--w-good)", stroke: "var(--w-panel)", "stroke-width": 2 }, svg);
    const hit = el("rect", { x: m.l, y: m.t, width: w - m.l - m.r, height: h - m.t - m.b, fill: "transparent" }, svg);
    const move = (ev) => {
      const b = svg.getBoundingClientRect(), i = Math.max(0, Math.min(n - 1, Math.round(((ev.clientX - b.left - m.l) / (w - m.l - m.r)) * (n - 1 + extra)))), p = pts[i];
      showTip("<b>" + esc(monthYear(p.y, p.m)) + "</b>" + row(t("Kept in the month"), (p.net < 0 ? "−" : "") + f(Math.abs(p.net))) + row(t("Kept in total"), (p.v < 0 ? "−" : "") + f(Math.abs(p.v)), "var(--w-good)"), ev);
    };
    hit.addEventListener("pointermove", move); hit.addEventListener("pointerdown", move); hit.addEventListener("pointerleave", hideTip);
  }, () => t("Kept in total: {amount} since {month}", { amount: f(last.v), month: monthYear(pts[0].y, pts[0].m) }));
}
function countToHtml(node, v) { node.innerHTML = (v < 0 ? "−" : "") + bigMoney(Math.abs(v)); }

/* ---------- Unusual: only what clearly stands out ---------- */
function renderUnusual(r) {
  const u = unit(), cards = [], idx = {};
  for (const x of state.tx) { if (x.type !== "expense" || x.d >= r.start) continue; const k = x.n.toLowerCase(); const o = idx[k] || (idx[k] = { k: 0, s: 0 }); o.k++; o.s += x.a; }
  for (const x of state.tx) {
    if (x.type !== "expense" || x.rec || x.d < r.start || x.d > r.end || !x.n) continue;
    const o = idx[x.n.toLowerCase()];
    if (o && o.k >= 4 && x.a >= u * 1.5 && x.a > 2 * (o.s / o.k)) {
      const avg = o.s / o.k;
      cards.push({ s: x.a / avg, h: t("{name} was {times}× its usual", { name: x.n, times: num1(x.a / avg) }), p: t("{amount} on {date}. Usually about {usual}.", { amount: f(x.a), date: dateOf(x.d), usual: f0(avg) }), c: x.c, go: 'data-go-id="' + esc(x.id) + '"' });
    } else if (!o && x.a >= u * 5) {
      cards.push({ s: 3, h: t("First time at {name}", { name: x.n }), p: t("{amount} on {date}, {category}.", { amount: f(x.a), date: dateOf(x.d), category: x.c }), c: x.c, go: 'data-go-id="' + esc(x.id) + '"' });
    }
  }
  if (r.month) {
    const cur = byCat(r.start, r.end), days = span(r.start, r.end), avg = {}, [y, m] = ym(r.start);
    let k = 0;
    [1, 2, 3].forEach((b) => {
      const q = ymAdd(y, m, -b);
      if (ds(q[0], q[1], 1) < START) return;
      k++;
      const o = byCat(ds(q[0], q[1], 1), ds(q[0], q[1], Math.min(days, dim(q[0], q[1]))));
      Object.keys(o).forEach((c) => { avg[c] = (avg[c] || 0) + o[c]; });
    });
    if (k) Object.keys(cur).forEach((c) => {
      const a = (avg[c] || 0) / k;
      if (a > 0 && cur[c] >= a * 1.4 && cur[c] - a >= u * 2.5) cards.push({ s: cur[c] / a, h: t("{category} is {pct} above usual", { category: c, pct: pct(cur[c] / a - 1) }), p: r.current ? t("{amount} so far, against about {usual} by this day in a usual month.", { amount: f0(cur[c]), usual: f0(a) }) : t("{amount}, against about {usual} in a usual month.", { amount: f0(cur[c]), usual: f0(a) }), c, go: 'data-go-cat="' + esc(c) + '"' });
    });
  }
  cards.sort((a, b) => b.s - a.s);
  $("unusual").innerHTML = cards.slice(0, 3).map((x) => '<button type="button" class="w-li w-unu" ' + x.go + ">" + tile(x.c) + '<div class="d-min"><h6>' + esc(x.h) + "</h6><p>" + esc(x.p) + "</p></div>" + icon("right", "d-chev") + "</button>").join("") ||
    empty("check", t("Nothing unusual"), r.month ? t("Spending looks like a normal month.") : t("Spending looks normal in this range."));
  $("unu-sub").textContent = cards.length > 3 ? t("The 3 biggest of {n} things that stand out", { n: num(cards.length) }) : cards.length ? t("Only what clearly stands out") : t("Checked every payee and category");
}

/* ---------- Cash flow: income sources → categories and what was kept ---------- */
export function flowData(r) {
  const src = {}, cats = byCat(r.start, r.end);
  for (const x of state.tx) { if (x.type !== "income" || x.d < r.start || x.d > r.end) continue; const v = amt(x); if (v) { const k = x.n || x.c; src[k] = (src[k] || 0) + v; } }
  let S = Object.keys(src).map((k) => ({ n: k, v: src[k] })).sort((a, b) => b.v - a.v);
  const inc = S.reduce((s, x) => s + x.v, 0), exp = Object.keys(cats).reduce((s, k) => s + cats[k], 0), net = inc - exp;
  if (S.length > 4) { const rest = S.slice(3); S = S.slice(0, 3); S.push({ n: t("Other income"), v: rest.reduce((s, x) => s + x.v, 0) }); }
  if (net < 0) S.push({ n: t("From savings"), v: -net, deficit: true });
  const leftName = r.current ? t("Left") : t("Saved"), Rn = [];
  if (net > 0) Rn.push({ n: leftName, v: net, saved: true });
  let other = 0;
  const otherN = [], ref = Math.max(inc, exp);
  Object.keys(cats).sort((a, b) => cats[b] - cats[a]).forEach((k) => { if (cats[k] / ref < 0.025) { other += cats[k]; otherN.push(k); } else Rn.push({ n: k, v: cats[k], c: k }); });
  if (other) Rn.push(otherN.length === 1 ? { n: otherN[0], v: other, c: otherN[0] } : { n: t("Other"), v: other, c: null, sub: otherN.join(", ") });
  return { S, Rn, inc, exp, net, total: Math.max(inc, exp), leftName };
}
function renderFlow(r) {
  const d = flowData(r);
  $("flow-saved-l").textContent = d.leftName;
  $("flow-sub").textContent = d.total ? (r.month ? t("Where {month}'s income went", { month: monthIn(+r.start.slice(5, 7)) }) : t("Where this range's income went")) + (d.net < 0 ? ". " + t("Spending ran {amount} past income.", { amount: f0(-d.net) }) : "") : t("No money in or out in this range");
  const { S, Rn, inc, total } = d;
  chart("c-flow", () => Math.max(320, Rn.length * 34 + 30), (svg, w, h) => {
    if (!total) { txt(svg, w / 2, h / 2, t("Nothing to show for this range"), "lb2", "middle"); return; }
    const pad = 14, GAP = 6, NW = 10, usable = h - pad * 2 - GAP * (Rn.length - 1), k = usable / total;
    const xS = 0, xM = Math.round(w * 0.34), xR = w - Math.min(220, w * 0.36);
    const defs = el("defs", {}, svg), links = el("g", {}, svg), nodes = el("g", {}, svg), labs = el("g", {}, svg);
    const band = (x0, a0, b0, x1, a1, b1) => { const c = (x0 + x1) / 2; return "M" + x0 + " " + a0 + "C" + c + " " + a0 + " " + c + " " + a1 + " " + x1 + " " + a1 + "L" + x1 + " " + b1 + "C" + c + " " + b1 + " " + c + " " + b0 + " " + x0 + " " + b0 + "Z"; };
    const sH = total * k + 12 * (S.length - 1), mY = (h - total * k) / 2, lefts = [];
    let sy = (h - sH) / 2, mCur = mY;
    S.forEach((s) => {
      const hh = s.v * k, col = s.deficit ? "var(--w-bad)" : "var(--w-accent)", op = s.deficit ? 0.16 : 0.14;
      const p = el("path", { d: band(xS + NW, sy, sy + hh, xM, mCur, mCur + hh), fill: col, "fill-opacity": op }, links);
      hover(p, "<b>" + esc(s.n) + "</b>" + row(t("Amount"), f(s.v)) + row(t("Share of income"), inc ? pct(s.v / inc) : "—"));
      p.addEventListener("pointerenter", () => p.setAttribute("fill-opacity", 0.3)); p.addEventListener("pointerleave", () => p.setAttribute("fill-opacity", op));
      el("rect", { x: xS, y: sy, width: NW, height: Math.max(hh, 1.5), rx: 2, fill: col }, nodes);
      lefts.push({ y: sy + hh / 2, n: s.n, v: s.v, p: inc ? s.v / inc : 0 });
      sy += hh + 12; mCur += hh;
    });
    el("rect", { x: xM, y: mY, width: NW, height: total * k, rx: 2, fill: "var(--w-accent)" }, nodes);
    const mt = txt(labs, xM + NW + 10, mY + 14, "", "lb halo");
    el("tspan", {}, mt).textContent = t("Income") + " ";
    el("tspan", { class: "lb2" }, mt).textContent = f(inc);
    let ry = pad, mOut = mY;
    const rights = [];
    Rn.forEach((d2, i) => {
      const hh = d2.v * k, col = d2.saved ? "var(--w-accent)" : d2.c ? cc(d2.c) : "var(--c9)";
      const gr = el("linearGradient", { id: "d-fg" + i, x1: 0, y1: 0, x2: 1, y2: 0 }, defs);
      el("stop", { offset: 0, "stop-color": "var(--w-accent)", "stop-opacity": 0.16 }, gr); el("stop", { offset: 1, "stop-color": col, "stop-opacity": d2.saved ? 0.42 : 0.38 }, gr);
      const p = el("path", { d: band(xM + NW, mOut, mOut + hh, xR, ry, ry + hh), fill: "url(#d-fg" + i + ")" }, links);
      hover(p, "<b>" + esc(d2.n) + "</b>" + (d2.sub ? '<div class="d-tipsub">' + esc(d2.sub) + "</div>" : "") + row(t("Amount"), f(d2.v)) + row(t("Share of income"), inc ? pct(d2.v / inc) : "—"));
      p.addEventListener("pointerenter", () => { p.style.filter = "saturate(1.6) brightness(.95)"; }); p.addEventListener("pointerleave", () => { p.style.filter = ""; });
      if (d2.c) { p.style.cursor = "pointer"; p.dataset.goCat = d2.c; }
      el("rect", { x: xR, y: ry, width: NW, height: Math.max(hh, 2), rx: 2, fill: col }, nodes);
      rights.push({ y: ry + hh / 2, n: d2.n, v: d2.v, p: inc ? d2.v / inc : 0, saved: d2.saved });
      ry += hh + GAP; mOut += hh;
    });
    const place = (list, minGap) => { for (let i = 1; i < list.length; i++) if (list[i].ly - list[i - 1].ly < minGap) list[i].ly = list[i - 1].ly + minGap; const over = list.length ? list[list.length - 1].ly - (h - 8) : 0; if (over > 0) list.forEach((l) => { l.ly -= over; }); };
    lefts.forEach((l) => { l.ly = l.y; }); place(lefts, 30);
    lefts.forEach((l) => { const tx = txt(labs, xS + NW + 10, l.ly - 2, l.n, "lb halo"); tx.setAttribute("style", "font-weight:600"); txt(labs, xS + NW + 10, l.ly + 13, f(l.v) + "  " + pct(l.p), "lbs halo"); });
    rights.forEach((l) => { l.ly = l.y; }); place(rights, 19);
    rights.forEach((l) => {
      if (Math.abs(l.ly - l.y) > 4) el("path", { d: "M" + (xR + NW + 1) + " " + l.y + "L" + (xR + NW + 7) + " " + l.ly, fill: "none", stroke: "var(--w-line)", "stroke-width": 1 }, labs);
      const tx = txt(labs, xR + NW + 10, l.ly + 4, "", "lb"), a1 = el("tspan", {}, tx);
      a1.textContent = l.n;
      if (l.saved) a1.setAttribute("style", "fill:var(--w-accent-ink);font-weight:600");
      const a2 = el("tspan", { class: "lbs", dx: 8 }, tx);
      a2.textContent = f(l.v) + " · " + pct(l.p);
    });
  }, () => t("Cash flow: {income} income, {spent} spent", { income: f(d.inc), spent: f(d.exp) }) + ". " + Rn.slice(0, 6).map((x) => x.n + " " + f0(x.v)).join(", "));
}

/* ---------- Day by day: the month grid, or one row per month for longer ranges ---------- */
export const CAL_LEG = () => '<span><s style="background:var(--w-accent-soft);box-shadow:inset 0 0 0 1px var(--w-accent-line)"></s>' + t("Today") +
  '</span><span><s style="background:var(--w-good-soft)"></s>' + t("Money in") + '</span><span><s style="box-shadow:inset 0 0 0 1px var(--w-ink3)"></s>' + t("Still to come") + "</span>";
function levels(vals) {
  const nz = vals.filter((v) => v > 0).sort((a, b) => a - b), q = (p) => nz[Math.floor(p * (nz.length - 1))] || 0, cuts = [q(0.2), q(0.45), q(0.7), q(0.9)];
  return (v) => (v ? 1 + cuts.filter((c) => v > c).length : 0);
}
function renderCal(r) {
  const leg = $("cal-leg"), grid = $("cal-grid"), year = $("c-cal");
  if (r.month) {
    const [y, m] = ym(r.start), by = dayMap(state.tx.filter((x) => x.d >= r.start && x.d <= r.end)), sched = schedMap(y, m), g = monthGrid(y, m, by, sched, null, "go-day");
    grid.hidden = false; year.hidden = true;
    grid.innerHTML = '<div class="w-rcal">' + g.html + "</div>";
    gridHover(grid, "go-day", by, sched);
    leg.className = "w-legend d-calleg"; leg.innerHTML = CAL_LEG();
    $("cal-sub").innerHTML = "<b>" + esc(noSpendText(g.ns)) + "</b>" + (g.best > 1 ? esc(", " + t("longest run {n}", { n: num(g.best) })) : "") + ". " + t("A day opens it in the Transactions calendar.");
    return;
  }
  grid.hidden = true; grid.innerHTML = ""; year.hidden = false;
  leg.className = "w-heat-l"; leg.innerHTML = "<span>" + t("Less spending") + '</span><i style="background:var(--h1)"></i><i style="background:var(--h2)"></i><i style="background:var(--h3)"></i><i style="background:var(--h4)"></i><i style="background:var(--h5)"></i><span>' + t("More spending") + "</span>";
  $("cal-sub").textContent = t("One row per month, one square per day. Click a day to see its transactions.");
  const mons = monthsIn(r.start, r.end), vals = daily(r.start, r.len), lv = levels(vals), t0 = T(r.start);
  const cellOf = (w) => Math.max(6, Math.min(16, Math.floor((w - 44) / 31) - 2));
  chart("c-cal", (w) => mons.length * (cellOf(w) + 3) + 20, (svg, w) => {
    const cs = cellOf(w), g = cs + 2, gy = cs + 3, x0 = 44;
    [1, 10, 20, 31].forEach((d) => txt(svg, x0 + (d - 1) * g + cs / 2, 10, num(d), "ax", "middle"));
    mons.forEach(([yy, mm], ri) => {
      const y0 = 18 + ri * gy;
      txt(svg, 0, y0 + cs - 3, monLabel(yy, mm, mm === 1 || ri === 0, true), "ax");
      for (let d = 1; d <= dim(yy, mm); d++) {
        const s = ds(yy, mm, d);
        if (s < r.start || s > r.end) { el("rect", { x: x0 + (d - 1) * g, y: y0, width: cs, height: cs, rx: 3, fill: "none", stroke: "var(--w-line2)" }, svg); continue; }
        const i = Math.round((T(s) - t0) / DAY), v = vals[i];
        const rc = el("rect", { x: x0 + (d - 1) * g, y: y0, width: cs, height: cs, rx: 3, fill: "var(--h" + lv(v) + ")" }, svg);
        if (!lv(v)) rc.setAttribute("fill", "var(--w-fill)");
        rc.style.cursor = "pointer";
        rc.dataset.goDay = s;
        hover(rc, "<b>" + esc(dlabY(s)) + "</b>" + row(t("Spent"), f(v)));
        if (s === TODAY) el("rect", { x: x0 + (d - 1) * g - 1.5, y: y0 - 1.5, width: cs + 3, height: cs + 3, rx: 4, fill: "none", stroke: "var(--w-accent)", "stroke-width": 1.5, "pointer-events": "none" }, svg);
      }
    });
  }, () => t("Spending per day in {range}", { range: r.noun }));
}

/* ---------- People and settle up ---------- */
function sharedSince() {
  const last = state.settle.payments && state.settle.payments[0];
  const since = last ? last.date : null;
  const n = state.tx.filter((x) => x.p === null && x.type === "expense" && x.by && (!since || x.d > since)).length;
  return { last, n };
}
export function settleHtml(compact) {
  const tr = state.settle.transfers || [], { last, n } = sharedSince();
  if (!tr.length) return '<div class="w-settle even"><div><b>' + t("All square") + "</b><p>" + esc(last ? t("No one owes anything since {date}.", { date: dateOf(last.date) }) : t("No one owes anything.")) + "</p></div></div>";
  const x = tr[0], from = pname(String(x.from)), to = pname(String(x.to)), amount = f(Number(x.amount));
  const line = t("{from} owes {to} {amount}", { from, to, amount });
  const more = tr.length > 1 ? " " + tn(tr.length - 1, "And {n} more payment.", "And {n} more payments.") : "";
  const why = last ? tn(n, "From {n} shared cost since {date}.", "From {n} shared costs since {date}.", { date: dateOf(last.date) }) : tn(n, "From {n} shared cost.", "From {n} shared costs.");
  return '<div class="w-settle' + (compact ? " d-settle-m" : "") + '"><div><b>' + esc(line) + "</b><p>" + esc(compact ? t("Since the last payment") + "." + more : why + (tr.length === 1 ? " " + t("{name} paid more of them.", { name: to }) : "") + more) +
    '</p></div><button type="button" class="w-btn primary" data-settle>' + t("Settle up") + "</button></div>";
}
function renderPeople(r) {
  const box = $("people");
  const own = {}, ppl = state.people.map((p) => String(p.id));
  let sharedT = 0, sharedN = 0;
  ppl.forEach((k) => { own[k] = 0; });
  for (const x of state.tx) { if (x.type !== "expense" || x.d < r.start || x.d > r.end) continue; if (x.p === null) { sharedT += x.a; sharedN++; } else if (x.p in own) own[x.p] += x.a; }
  let rows = "";
  ppl.forEach((k) => {
    const tt = totals(r.start, r.end, k), dimmed = state.scope !== "all" && state.scope !== k, sp = tt.inc ? Math.min(tt.exp / tt.inc, 1) : 1;
    rows += '<div class="w-person' + (dimmed ? " dim" : "") + '">' + av(k, "lg") + '<div><h5>' + esc(pname(k)) + (k === state.me ? ' <span class="w-badge">' + t("You") + "</span>" : "") +
      '</h5><div class="w-trio"><div><span>' + t("Earned") + "</span><b>" + f(tt.inc) + "</b></div><div><span>" + t("Spent") + "</span><b>" + f(tt.exp) + "</b></div><div><span>" + (tt.net >= 0 ? t("Kept") : t("Over")) +
      '</span><b class="' + (tt.net >= 0 ? "d-kept" : "up-bad") + '">' + f(Math.abs(tt.net)) + '</b></div></div><div class="w-rate" role="img" aria-label="' + esc(t("Spent {pct} of what was earned", { pct: tt.inc ? pct(tt.exp / tt.inc) : "—" })) +
      '"><span style="width:' + sp * 100 + '%;background:var(--w-p2)"></span><span style="flex:1;background:var(--w-accent)"></span></div></div></div>';
  });
  const tot = ppl.reduce((s, k) => s + own[k], 0) + sharedT || 1;
  rows += '<div class="d-paid"><div class="d-paidh"><span>' + t("Household spending, by who paid") + "</span><b>" + f(tot === 1 && !sharedT ? 0 : tot) + "</b></div>" +
    '<div class="w-split3">' + ppl.map((k, i) => '<span style="flex-basis:' + (own[k] / tot) * 100 + "%;background:" + pcol(i) + '"></span>').join("") + '<span class="hatch" style="flex:1"></span></div>' +
    '<div class="w-legend">' + ppl.map((k, i) => '<span><s style="background:' + pcol(i) + '"></s>' + esc(pname(k)) + " " + f0(own[k]) + "</span>").join("") +
    '<span><s class="hatch"></s>' + esc(t("Shared {amount} ({n})", { amount: f0(sharedT), n: num(sharedN) })) + "</span></div></div>";
  box.innerHTML = settleHtml() + rows;
}

/* ---------- Weekday pattern ---------- */
function renderWeekday(r) {
  const a = r.len < 60 ? addD(r.end, -89) : r.start, sums = [0, 0, 0, 0, 0, 0, 0], cnt = [0, 0, 0, 0, 0, 0, 0], days = [0, 0, 0, 0, 0, 0, 0];
  for (let d = a; d <= r.end; d = addD(d, 1)) { cnt[wkOff(d)]++; days[wkOff(d)] = wd(d); }
  for (const x of state.tx) { if (x.type !== "expense" || x.rec || x.d < a || x.d > r.end) continue; sums[wkOff(x.d)] += amt(x); }
  const avg = sums.map((s, i) => (cnt[i] ? s / cnt[i] : 0)), weekend = (i) => days[i] === 0 || days[i] === 6;
  const wk = avg.filter((_, i) => !weekend(i)), we = avg.filter((_, i) => weekend(i));
  const wkday = wk.reduce((s, v) => s + v, 0) / Math.max(wk.length, 1), wkend = we.reduce((s, v) => s + v, 0) / Math.max(we.length, 1);
  $("wd-sub").innerHTML = esc(a === r.start ? t("Average per day, not counting bills, in this range.") : t("Average per day, not counting bills, over the last 90 days.")) +
    (wkday > 0 ? " " + t("Weekends cost {times} a weekday.", { times: "<b>" + num1(wkend / wkday) + "×</b>" }) : "");
  const labels = dows(false);
  chart("c-wd", 170, (svg, w, h) => {
    const m = { t: 18, b: 22 }, mx = Math.max(...avg, 1), bw = w / 7, b = Math.min(44, bw * 0.56);
    labels.forEach((l, i) => {
      const hh = Math.max(2, (avg[i] / mx) * (h - m.t - m.b)), x0 = bw * i + (bw - b) / 2, y0 = h - m.b;
      const p = el("path", { d: barPath(x0, y0, b, hh, 5), fill: weekend(i) ? "var(--w-accent)" : "var(--w-p2)" }, svg);
      hover(p, "<b>" + esc(F.wd.long[days[i]]) + "</b>" + row(t("Average spent"), f(avg[i])));
      txt(svg, x0 + b / 2, y0 - hh - 6, fk(avg[i]), "lbs", "middle");
      txt(svg, x0 + b / 2, h - 5, l, "ax", "middle");
    });
  }, () => t("Average spent per weekday") + ": " + labels.map((l, i) => l + " " + f0(avg[i])).join(", "));
}

/* ---------- Subscriptions: small recurring bills, rent and insurance left out ---------- */
const INSURANCE = /insurance|seguro|assegur|assurance|versicherung|assicura|страхов|保险|保険|보험|बीमा|تأمين/i;
export function subscriptions() {
  const cap = unit() * 5;
  return state.rules.filter((x) => !isIncome(x) && active(x) && !x.paused && catIcon(x.c) !== "rent" && !INSURANCE.test(x.n) && ruleAmt(x) > 0 && perMonth(x) < cap)
    .sort((a, b) => perMonth(b) - perMonth(a));
}
function renderSubs() {
  const subs = subscriptions(), yr = subs.reduce((s, x) => s + perMonth(x) * 12, 0);
  $("subs-big").innerHTML = f0(yr) + '<span class="c"> ' + t("a year") + "</span>";
  $("subs-big").hidden = !subs.length;
  $("subs").innerHTML = subs.slice(0, 5).map((x) => {
    const pc = priceChange(x);
    return '<button type="button" class="w-li d-lib" data-go-rule="' + esc(x.id) + '">' + tile(x.c) + '<div class="d-min"><h6>' + esc(x.n || x.c) + (pc && pc.to > pc.from ? ' <span class="w-pill bad">+' + f(pc.to - pc.from) + "</span>" : "") +
      "</h6><p>" + esc(shortDesc(x)) + '</p></div><span class="w-amt">' + f0(perMonth(x) * 12) + "<small>" + t("a year") + "</small></span></button>";
  }).join("") || empty("repeat", t("No subscriptions"), t("Small repeating bills, like streaming or a phone plan, show up here."));
  $("subs-sub").textContent = subs.length ? tn(subs.length, "{n} subscription or small bill. Rent and insurance are left out.", "{n} subscriptions and small bills. Rent and insurance are left out.") : "";
}

/* ---------- Category trends: six months per top category against its own average ---------- */
function renderTrends(r) {
  const cats = byCat(r.start, r.end), keys = Object.keys(cats).sort((a, b) => cats[b] - cats[a]).slice(0, 6), e = ym(r.end);
  const months = [];
  for (let i = 5; i >= 0; i--) months.push(ymAdd(e[0], e[1], -i));
  const per = months.map(([y, m]) => { const b = monthBounds(y, m); return b[0] > TODAY ? {} : byCat(b[0], b[1]); });
  $("tr-sub").textContent = t("Six months to {month} for the top categories. The dashed line is the average of the five months before.", { month: monthIn(e[1]) });
  const box = $("trends");
  if (!keys.length) { box.innerHTML = '<div class="d-span">' + empty("overview", t("No spending yet"), t("Trends appear once there is spending in this range.")) + "</div>"; return; }
  box.innerHTML = keys.map((k, ix) => {
    const vals = per.map((o) => o[k] || 0), avg = vals.slice(0, 5).reduce((a, b) => a + b, 0) / 5, lastV = vals[5], d = avg ? (lastV - avg) / avg : null;
    const change = d == null ? "" : Math.abs(d) < 0.005 ? t("Same as avg") : (d > 0 ? t("{pct} over avg", { pct: '<b class="' + (d > 0.1 ? "up-bad" : d < -0.1 ? "dn-good" : "") + '">' + pct(Math.abs(d)) + "</b>" }) : t("{pct} under avg", { pct: '<b class="' + (d > 0.1 ? "up-bad" : d < -0.1 ? "dn-good" : "") + '">' + pct(Math.abs(d)) + "</b>" }));
    return '<button type="button" class="w-trend" data-go-cat="' + esc(k) + '" data-go-ym="' + ds(e[0], e[1], 1).slice(0, 7) + '"><header>' + tile(k) + "<b>" + esc(k) + '</b></header><div class="row"><b>' + f0(lastV) + "</b><span>" + change + '</span></div><div class="cv" id="tr-' + ix + '"></div></button>';
  }).join("");
  keys.forEach((k, ix) => {
    const vals = per.map((o) => o[k] || 0), avg = vals.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
    chart("tr-" + ix, 62, (svg, w, h) => {
      const mx = Math.max(...vals, avg, 1), bw = w / 6, b = Math.min(22, bw * 0.56), Y = (v) => h - 14 - (v / mx) * (h - 20);
      vals.forEach((v, i) => {
        const hh = Math.max(2, h - 14 - Y(v)), x0 = bw * i + (bw - b) / 2;
        const p = el("path", { d: barPath(x0, h - 14, b, hh, 4), fill: cc(k), "fill-opacity": i === 5 ? 1 : 0.32 }, svg);
        const [yy, mm] = months[i];
        hover(p, "<b>" + esc(k + ", " + monthYear(yy, mm)) + "</b>" + row(t("Spent"), f(v)) + (i === 5 && ds(yy, mm, dim(yy, mm)) > TODAY ? row(t("Note"), t("so far")) : ""));
        txt(svg, x0 + b / 2, h - 2, F.mon[mm - 1].slice(0, 1), "ax", "middle");
      });
      el("line", { x1: 0, x2: w, y1: Y(avg), y2: Y(avg), stroke: "var(--w-ink3)", "stroke-width": 1, "stroke-dasharray": "3 3" }, svg);
    }, () => k + ": " + months.map(([yy, mm], i) => F.mon[mm - 1] + " " + f0(vals[i])).join(", "));
  });
}

/* ---------- Recent and Where it goes most ---------- */
function renderRecent(r, limit) {
  const list = [];
  for (const x of state.tx) { if (x.d > r.end) continue; if (x.d < r.start) break; if (amt(x) > 0) list.push(x); if (list.length >= (limit || 6)) break; }
  $("recent").innerHTML = list.map((x) => txRow(x, { date: true, compact: limit && limit < 6 })).join("") || empty("list", t("No transactions"), t("Nothing in this range yet."));
}
function renderPayees(r) {
  const m = {};
  for (const x of state.tx) {
    if (x.type !== "expense" || x.rec || x.d < r.start || x.d > r.end || !x.n) continue;
    const v = amt(x);
    if (!v) continue;
    const k = x.n.toLowerCase(), o = m[k] || (m[k] = { n: x.n, c: x.c, v: 0, k: 0 });
    o.v += v; o.k++;
  }
  const list = Object.values(m).sort((a, b) => b.v - a.v).slice(0, 6), mx = list.length ? list[0].v : 1;
  $("payees").innerHTML = list.map((x) => '<button type="button" class="w-li d-lib" data-go-q="' + esc(x.n) + '">' + tile(x.c) + '<div class="d-min"><h6>' + esc(x.n) + "</h6><p>" +
    esc(tn(x.k, "{n} time, about {amount} each", "{n} times, about {amount} each", { amount: f0(x.v / x.k) })) + '</p><div class="w-thin"><span style="width:' + (x.v / mx) * 100 + "%;background:" + cc(x.c) + '"></span></div></div><span class="w-amt">' + f(x.v) + "</span></button>").join("") ||
    empty("search", t("No payees yet"), t("Payees appear once there is everyday spending in this range."));
}

/* ---------- markup ---------- */
/* A panel heading; sub is a line of text, or {id} for one filled in by the renderer */
const ph = (title, sub, right) => '<div class="w-ph"><div><h4>' + title + "</h4>" + (sub && sub.id ? '<p id="' + sub.id + '"></p>' : "<p>" + sub + "</p>") + "</div>" + (right || "") + "</div>";
export const WIDGETS = {
  cats: {
    label: () => t("Categories"),
    html: () => '<section class="w-panel" data-w="cats"><div class="w-ph"><div><h4 id="cat-h">' + t("Categories") + '</h4><p id="cat-sub"></p></div>' +
      '<div class="w-seg sm" id="ct" role="group" aria-label="' + esc(t("Group by")) + '"><button type="button" data-ctab="cats" aria-pressed="true">' + t("Categories") + '</button><button type="button" data-ctab="tags" aria-pressed="false">' + t("Tags") + "</button></div></div>" +
      '<div class="w-share" id="cat-share"></div><div class="w-cats" id="cats"></div></section>',
    render: renderCats,
  },
  upcoming: {
    label: () => t("Coming up"),
    html: () => '<section class="w-panel" data-w="upcoming">' + ph(t("Coming up"), t("Recurring money in and out, next 10 days"), '<a class="w-link d-hlink" href="/recurring" data-link>' + t("All recurring") + "</a>") +
      '<div class="w-list" id="upcoming"></div><p class="w-foot" id="upcoming-f"></p></section>',
    render: renderUpcoming,
  },
  savings: {
    label: () => t("Savings over time"),
    html: () => '<section class="w-panel" data-w="savings">' + ph(t("Savings over time"), { id: "sav-sub" }, '<span class="w-big sm" id="sav-big"></span>') + '<div class="cv" id="c-sav"></div></section>',
    render: renderSavings,
  },
  unusual: {
    label: () => t("Unusual"),
    html: () => '<section class="w-panel" data-w="unusual">' + ph(t("Unusual"), { id: "unu-sub" }) + '<div class="w-list" id="unusual"></div></section>',
    render: renderUnusual,
  },
  flow: {
    label: () => t("Cash flow"),
    html: () => '<section class="w-panel" data-w="flow">' + ph(t("Cash flow"), { id: "flow-sub" }, '<div class="w-legend d-flowleg"><span><s style="background:var(--w-accent-soft);box-shadow:inset 0 0 0 1px var(--w-accent-line)"></s>' + t("Income") +
      '</span><span><s style="background:var(--w-accent)"></s><span id="flow-saved-l">' + t("Saved") + '</span></span><span><s style="background:linear-gradient(90deg,var(--c1),var(--c2),var(--c3),var(--c5),var(--c6),var(--c7))"></s>' + t("Categories") + "</span></div>") +
      '<div class="cv" id="c-flow"></div></section>',
    render: renderFlow,
  },
  cal: {
    label: () => t("Day by day"),
    html: () => '<section class="w-panel" data-w="cal"><div class="w-ph"><div><h4>' + t("Day by day") + '</h4><p id="cal-sub"></p></div><div id="cal-leg"></div></div><div id="cal-grid"></div><div class="cv" id="c-cal" hidden></div></section>',
    render: renderCal,
  },
  people: {
    label: () => t("People and settle up"),
    html: () => '<section class="w-panel" data-w="people">' + ph(t("People"), t("Who owes whom, and what each person earned, spent and kept")) + '<div class="w-people" id="people"></div></section>',
    render: renderPeople,
    when: couple,
  },
  weekday: {
    label: () => t("Weekday pattern"),
    html: () => '<section class="w-panel" data-w="weekday">' + ph(t("Weekday pattern"), { id: "wd-sub" }) + '<div class="cv" id="c-wd"></div></section>',
    render: renderWeekday,
  },
  subs: {
    label: () => t("Subscriptions"),
    html: () => '<section class="w-panel" data-w="subs">' + ph(t("Subscriptions"), { id: "subs-sub" }, '<span class="w-big sm" id="subs-big"></span>') + '<div class="w-list" id="subs"></div></section>',
    render: renderSubs,
  },
  trends: {
    label: () => t("Category trends"),
    html: () => '<section class="w-panel" data-w="trends">' + ph(t("Category trends"), { id: "tr-sub" }) + '<div class="w-trends" id="trends"></div></section>',
    render: renderTrends,
  },
  recent: {
    label: () => t("Recent"),
    html: () => '<section class="w-panel" data-w="recent">' + ph(t("Recent"), t("Latest in this range"), '<a class="w-link d-hlink" href="/transactions" data-link>' + t("All transactions") + "</a>") + '<div id="recent"></div></section>',
    render: renderRecent,
  },
  payees: {
    label: () => t("Where it goes most"),
    html: () => '<section class="w-panel" data-w="payees">' + ph(t("Where it goes most"), t("Top payees in this range, not counting recurring bills")) + '<div class="w-list" id="payees"></div></section>',
    render: renderPayees,
  },
};
export { renderRecent };
