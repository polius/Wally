/* Summary: how this month is going, where it's heading, then the details.
   One layout for every width. Two columns on wide screens: the month on screen on the left (spent
   and its projection, categories, what's coming), how things move over the months on the right
   (the month's recap, kept each month, then those months added up as savings). On a phone the same sections stack
   in that order, with Recent after Categories. Clicks are handled in dashboard.js from data-* attributes. */
import {
  state, t, tn, esc, TODAY, START, ds, dim, ym, ymAdd, span, addD, wd, f, f0, fk, pct, num, F, LANG, dlab, monthName, monthIn, monthYear,
  totals, byCat, amt, cc, tile, pname, couple, icon, isIncomeCat, relDay,
} from "../../core.js";
import { chart, el, txt, hover, row, showTip, hideTip, empty } from "../../ui.js";
import { occurrences, ruleAmt, isIncome } from "../../sched.js";
import { view, prevOf } from "./range.js";
import { paceData, paceLabel, heroMonthly, heroCats, monthsOf, monLabel } from "./hero.js";

const $ = (id) => document.getElementById(id);
const phone = matchMedia("(max-width: 767px)");

/* ---------- small helpers ---------- */
/* A whole amount that counts to its new value when the period changes */
const still = matchMedia("(prefers-reduced-motion: reduce)");
function countTo(node, to) {
  const from = typeof node._v === "number" ? node._v : null;
  node._v = to;
  if (from === null || Math.round(from) === Math.round(to) || still.matches) { node.textContent = f0(to); return; }
  const t0 = performance.now();
  const step = (now) => {
    if (node._v !== to) return;
    const k = Math.min(1, (now - t0) / 400), e = 1 - Math.pow(1 - k, 3);
    node.textContent = f0(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
/* "↓ 188 € less than September at this point": green when it is good news, red when it isn't */
function changeLine(diff, goodWhenUp, what) {
  if (Math.abs(diff) < 0.5) return '<span class="s-ch">' + esc(t("The same as {what}", { what })) + "</span>";
  const up = diff > 0, good = up === goodWhenUp;
  return '<span class="s-ch"><b class="' + (good ? "dn-good" : "up-bad") + '">' + (up ? "↑ " : "↓ ") + esc(f0(Math.abs(diff))) + "</b> " +
    esc(up ? t("more than {what}", { what }) : t("less than {what}", { what })) + "</span>";
}
/* What the period is compared with, as it reads at the end of a sentence */
function againstWhat(r, p) {
  if (r.month) return r.current ? t("{month} at this point", { month: monthIn(+p.start.slice(5, 7)) }) : monthIn(+p.start.slice(5, 7));
  return p.label;
}
const sec = (id, title, link) => '<section class="s-sec" data-w="' + id + '"><div class="s-sh"><h4>' + title + "</h4>" + (link || "") + '</div><div class="s-body" id="s-' + id + '"></div></section>';
const seeAll = (attrs) => '<button type="button" class="w-link s-all" ' + attrs + ">" + t("See all") + "</button>";

/* ---------- markup ---------- */
export function summaryHtml() {
  return '<div class="s-grid">' +
    '<div class="s-col">' +
      '<section class="s-sec s-hero" data-w="hero" aria-label="' + esc(t("Spent so far")) + '"><div class="s-body">' +
        '<div class="s-heroh"><div><div class="s-eye" id="s-eye"></div><div class="s-big amt" id="s-big"></div></div>' +
          '<div class="w-seg sm s-view" id="s-view" role="group" aria-label="' + esc(t("Chart")) + '" hidden></div></div>' +
        '<div class="s-lines" id="s-lines"></div>' +
        '<div class="cv s-chart" id="c-hero"></div><div id="s-heroempty" hidden></div>' +
      "</div></section>" +
      sec("cats", t("Categories"), seeAll('data-act="cats-all" aria-expanded="false"')) +
      sec("recent", t("Recent"), '<a class="w-link s-all" href="/transactions" data-link>' + t("See all") + "</a>") +
      sec("upcoming", t("Coming up"), '<a class="w-link s-all" href="/recurring" data-link>' + t("See all") + "</a>") +
    "</div>" +
    // The right: how things move over the months, opened by the month's recap
    '<div class="s-col s-evo">' +
      '<div id="s-recapw"></div>' +
      sec("kept", t("Kept each month"), '<span class="s-avg" id="s-avg"></span>') +
      sec("savings", t("Savings")) +
    "</div></div>";
}

export function renderSummary(r) {
  renderHero(r);
  renderCats(r);
  renderRecent(r);
  renderSavings(r);
  renderKept(r);
  renderUpcoming();
  renderRecap(r);
}

/* ---------- the hero: spent, where it's heading, against last month ---------- */
function renderHero(r) {
  const tt = totals(r.start, r.end), p = prevOf(r), d = paceData(r), ci = d.cur.length - 1;
  // On the period's last day there is nothing left to project
  if (d.proj && d.proj.length < 2) d.proj = null;
  $("s-eye").textContent = r.month ? (r.current ? t("Spent so far") : t("Spent")) : r.current ? t("Spent so far in {range}", { range: r.noun }) : t("Spent in {range}", { range: r.noun });
  countTo($("s-big"), tt.exp);
  const none = !tt.n;
  $("s-heroempty").hidden = !none;
  $("c-hero").hidden = none;
  const viewSeg = $("s-view");
  viewSeg.hidden = r.daily || none;
  if (!r.daily) {
    const pill = (v, l) => '<button type="button" data-hv="' + v + '" aria-pressed="' + (view.hv === v) + '">' + l + "</button>";
    viewSeg.innerHTML = pill("pace", t("Spent")) + pill("ivs", t("Income vs spending")) + pill("cats", t("By category"));
  }
  if (none) {
    $("s-lines").innerHTML = "";
    $("s-heroempty").innerHTML = empty("overview", esc(r.current ? t("Nothing in {range} yet", { range: r.noun }) : t("Nothing recorded in {range}", { range: r.noun })),
      t("Add the first expense, or import a CSV from your bank."),
      '<div class="d-emptyb"><a class="w-btn ghost" href="/settings/import" data-link>' + t("Import") + '</a><button type="button" class="w-btn primary" data-open-add>' + t("Add expense") + "</button></div>");
    return;
  }
  // Two short lines: where it's heading, and how that compares
  let lines = "";
  if (d.proj) lines += '<span class="s-proj">' + t("On track for {amount} by {date}", { amount: "<b>≈ " + esc(f0(d.proj[d.proj.length - 1])) + "</b>", date: esc(dlab(addD(r.start, d.len - 1))) }) + "</span>";
  if (d.cmp) lines += changeLine(d.cur[ci] - d.cmp[ci], false, againstWhat(r, p));
  else if (p.ok && !r.daily) { const pt = totals(p.start, p.end); lines += changeLine(tt.exp - pt.exp, false, againstWhat(r, p)); }
  $("s-lines").innerHTML = lines;

  if (!r.daily && view.hv !== "pace") {
    const months = monthsOf(r);
    if (view.hv === "cats") {
      const tot = byCat(r.start, r.end), keys = Object.keys(tot).sort((a, b) => tot[b] - tot[a]);
      months.forEach((x) => { x.cats = byCat(x.a, x.b); });
      chart("c-hero", (w) => (w < 560 ? 200 : 260), (svg, w, h) => heroCats(svg, w, h, months, keys),
        () => t("Spending by category and month in {range}", { range: r.noun }) + ": " + keys.slice(0, 5).map((k) => k + " " + f0(tot[k])).join(", "));
    } else {
      chart("c-hero", (w) => (w < 560 ? 200 : 260), (svg, w, h) => heroMonthly(svg, w, h, months),
        () => t("Income and spending by month in {range}", { range: r.noun }) + ": " + months.map((x) => monthYear(x.y, x.m) + " " + f0(x.inc) + " / " + f0(x.exp)).join(", "));
    }
    return;
  }
  const xlab = paceLabel(r, d.len);
  const label = () => t("Spent so far: {amount} by {date}", { amount: f(d.cur[ci]), date: dlab(r.end) }) + (d.cmp ? ". " + t("{name}: {amount}", { name: d.cmpName, amount: f(d.cmp[ci]) }) : "") +
    (d.proj ? ". " + t("Projected: {amount}", { amount: f(d.proj[d.proj.length - 1]) }) : "");
  chart("c-hero", (w) => (w < 480 ? 150 : w < 700 ? 190 : 220), (svg, w, h) => pace(svg, w, h, { r, d, xlab }), label);
}

/* This period as a line, the one before it dashed, the projection dotted to the end, labels at the
   line ends instead of a legend, and no axes */
function pace(svg, w, h, o) {
  const { r, d } = o, len = d.len, ci = d.cur.length - 1, narrow = w < 480;
  const m = { l: 2, r: narrow ? 70 : 92, t: 12, b: 22 };
  const all = d.cur.concat(d.cmp || []).concat(d.proj || []);
  const ymax = Math.max(...all, 1) * 1.08;
  const X = (i) => m.l + (len > 1 ? i / (len - 1) : 0.5) * (w - m.l - m.r), Y = (v) => h - m.b - (v / ymax) * (h - m.t - m.b);
  const defs = el("defs", {}, svg), g = el("linearGradient", { id: "s-hgrad", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  el("stop", { offset: 0, "stop-color": "var(--w-accent)", "stop-opacity": 0.22 }, g);
  el("stop", { offset: 1, "stop-color": "var(--w-accent)", "stop-opacity": 0.02 }, g);
  el("line", { x1: m.l, x2: w - m.r, y1: h - m.b, y2: h - m.b, class: "base" }, svg);
  const path = (arr, off) => arr.map((v, j) => (j ? "L" : "M") + X(j + (off || 0)).toFixed(1) + " " + Y(v).toFixed(1)).join("");
  const line = path(d.cur);
  if (r.current && ci < len - 1) el("line", { x1: X(ci), x2: X(ci), y1: m.t - 6, y2: h - m.b, stroke: "var(--w-line)", "stroke-width": 1 }, svg);
  el("path", { d: line + "L" + X(ci) + " " + Y(0) + "L" + X(0) + " " + Y(0) + "Z", fill: "url(#s-hgrad)" }, svg);
  if (d.cmp) el("path", { d: path(d.cmp), fill: "none", stroke: "var(--w-ink3)", "stroke-width": 1.5, "stroke-dasharray": "4 4", "stroke-linejoin": "round" }, svg);
  if (d.proj) el("path", { d: path(d.proj, ci), fill: "none", stroke: "var(--w-accent)", "stroke-width": 2.5, "stroke-dasharray": "0.1 6", "stroke-linecap": "round" }, svg);
  el("path", { d: line, fill: "none", stroke: "var(--w-accent)", "stroke-width": 2.5, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
  el("circle", { cx: X(ci), cy: Y(d.cur[ci]), r: 4.5, fill: "var(--w-accent)", stroke: "var(--s-card)", "stroke-width": 2.5 }, svg);
  // The x axis: the first day, today, the last day
  const ax = (i, s, anchor) => txt(svg, X(i), h - 4, s, "ax", anchor);
  ax(0, o.xlab(0, true), "start");
  if (r.current && ci < len - 1 && ci > len * 0.12 && ci < len * 0.88) ax(ci, t("Today"), "middle");
  ax(len - 1, r.current && ci === len - 1 ? t("Today") : o.xlab(len - 1, true), "end");
  // Labels at the line ends, nudged apart so they never overlap
  const ends = [];
  if (d.proj) ends.push({ y: Y(d.proj[d.proj.length - 1]), a: "≈ " + f0(d.proj[d.proj.length - 1]), b: t("projected"), cls: "acc" });
  else ends.push({ y: Y(d.cur[ci]), a: f0(d.cur[ci]), b: d.curName, cls: "acc" });
  if (d.cmp) ends.push({ y: Y(d.cmp[d.cmp.length - 1]), a: f0(d.cmp[d.cmp.length - 1]), b: d.cmpShort, cls: "lb2" });
  ends.sort((a, b) => a.y - b.y);
  for (let e = 1; e < ends.length; e++) if (ends[e].y - ends[e - 1].y < 30) ends[e].y = ends[e - 1].y + 30;
  const top = Math.max(m.t + 4, Math.min(...ends.map((e) => e.y)));
  if (ends[0].y < top) { const k = top - ends[0].y; ends.forEach((e) => { e.y += k; }); }
  ends.forEach((e) => { txt(svg, w - m.r + 8, e.y, e.a, "lb " + e.cls); txt(svg, w - m.r + 8, e.y + 14, e.b, "lbs"); });
  // Crosshair and tooltip; a mouse click on a day opens its transactions
  const cross = el("line", { y1: m.t, y2: h - m.b, stroke: "var(--w-ink3)", "stroke-width": 1, opacity: 0 }, svg);
  const d1 = el("circle", { r: 4.5, fill: "var(--s-card)", stroke: "var(--w-accent)", "stroke-width": 2.5, opacity: 0 }, svg);
  const d2 = el("circle", { r: 4, fill: "var(--s-card)", stroke: "var(--w-ink3)", "stroke-width": 2, opacity: 0 }, svg);
  const hit = el("rect", { x: m.l, y: 0, width: w - m.l - m.r, height: h, fill: "transparent" }, svg);
  const at = (ev) => { const b = svg.getBoundingClientRect(); return Math.max(0, Math.min(len - 1, Math.round(((ev.clientX - b.left - m.l) / (w - m.l - m.r)) * (len - 1)))); };
  let mouse = true;
  const move = (ev) => {
    const i = at(ev);
    mouse = ev.pointerType === "mouse";
    const cv = i <= ci ? d.cur[i] : d.proj ? d.proj[i - ci] : null, cmpv = d.cmp ? d.cmp[i] : null;
    cross.setAttribute("x1", X(i)); cross.setAttribute("x2", X(i)); cross.setAttribute("opacity", 1);
    if (cv != null) { d1.setAttribute("cx", X(i)); d1.setAttribute("cy", Y(cv)); d1.setAttribute("opacity", 1); } else d1.setAttribute("opacity", 0);
    if (cmpv != null) { d2.setAttribute("cx", X(i)); d2.setAttribute("cy", Y(cmpv)); d2.setAttribute("opacity", 1); } else d2.setAttribute("opacity", 0);
    let html = "<b>" + esc(o.xlab(i, true, true)) + "</b>";
    if (cv != null) html += row(i <= ci ? esc(d.curName) : t("Projected"), f(cv), "var(--w-accent)");
    if (cmpv != null) html += row(esc(d.cmpName), f(cmpv), "var(--w-ink3)");
    if (cv != null && cmpv != null && cmpv > 0) {
      const df = cv - cmpv;
      html += row(t("Difference"), '<span class="' + (df > 0 ? "up-bad" : "dn-good") + '">' + (df > 0 ? "+" : "−") + f(Math.abs(df)) + " (" + pct(Math.abs(df) / cmpv) + ")</span>");
    }
    const spent = i <= ci ? d.cur[i] - (i ? d.cur[i - 1] : 0) : 0;
    if (i <= ci) html += row(t("That day"), f(spent)) + (mouse && spent > 0 ? '<small class="w-tiphint">' + t("Click to see its transactions") + "</small>" : "");
    hit.style.cursor = mouse && spent > 0 ? "pointer" : "";
    showTip(html, ev);
  };
  hit.addEventListener("click", (ev) => {
    const i = at(ev);
    if (mouse && i <= ci && d.cur[i] - (i ? d.cur[i - 1] : 0) > 0) { hideTip(); hit.dispatchEvent(new CustomEvent("s-day", { bubbles: true, detail: addD(r.start, i) })); }
  });
  const clear = () => { cross.setAttribute("opacity", 0); d1.setAttribute("opacity", 0); d2.setAttribute("opacity", 0); hideTip(); };
  let later = 0;
  hit.addEventListener("pointermove", (ev) => { clearTimeout(later); move(ev); });
  hit.addEventListener("pointerdown", (ev) => { clearTimeout(later); move(ev); });
  // A finger lifts as soon as it taps: the day stays on screen a moment to be read
  hit.addEventListener("pointerleave", (ev) => { clearTimeout(later); if (ev.pointerType === "mouse") clear(); else later = setTimeout(clear, 3000); });
}

/* ---------- Categories: one stacked bar, then the biggest few ---------- */
let catsOpen = false;
export function toggleCats() { catsOpen = !catsOpen; }
function renderCats(r) {
  const cur = byCat(r.start, r.end), p = prevOf(r), prev = p.ok ? byCat(p.start, p.end) : null;
  const keys = Object.keys(cur).filter((k) => cur[k] > 0).sort((a, b) => cur[b] - cur[a]);
  const tot = keys.reduce((s, k) => s + cur[k], 0);
  const box = $("s-cats"), all = box.closest(".s-sec").querySelector('[data-act="cats-all"]');
  if (!keys.length) { box.innerHTML = '<p class="s-none">' + t("No spending yet in this range.") + "</p>"; all.hidden = true; return; }
  const top = 4, shown = catsOpen ? keys : keys.slice(0, top);
  all.hidden = keys.length <= top;
  all.textContent = catsOpen ? t("Show less") : t("See all");
  all.setAttribute("aria-expanded", String(catsOpen));
  // Short enough for one line under the name: "15% less than September"
  const what = r.month ? monthIn(+p.start.slice(5, 7)) : p.label;
  const note = (k) => {
    if (!prev) return "";
    const v = cur[k], pv = prev[k] || 0;
    if (!pv) return v / tot >= 0.05 ? '<small>' + esc(t("None in {what}", { what })) + "</small>" : "";
    const dlt = (v - pv) / pv;
    if (Math.abs(dlt) <= 0.1 || (v / tot < 0.05 && Math.abs(v - pv) < tot * 0.01)) return "";
    return '<small class="' + (dlt > 0 ? "up-bad" : "") + '">' + esc(dlt > 0 ? t("{pct} more than {what}", { pct: pct(dlt), what }) : t("{pct} less than {what}", { pct: pct(-dlt), what })) + "</small>";
  };
  box.innerHTML = '<div class="s-stack" role="img" aria-label="' + esc(keys.slice(0, 5).map((k) => k + " " + pct(cur[k] / tot)).join(", ")) + '">' +
      keys.map((k) => '<i style="flex:' + cur[k].toFixed(2) + ";background:" + cc(k) + '" data-k="' + esc(k) + '"></i>').join("") + "</div>" +
    shown.map((k) => '<button type="button" class="s-row" data-go-cat="' + esc(k) + '">' + tile(k) +
      '<span class="s-nm"><span>' + esc(k) + "</span>" + note(k) + '</span><span class="s-am amt">' + esc(f0(cur[k])) + "</span></button>").join("");
  box.querySelectorAll(".s-stack i").forEach((n) => hover(n, () => row(esc(n.dataset.k), f(cur[n.dataset.k]) + " · " + pct(cur[n.dataset.k] / tot), cc(n.dataset.k))));
}

/* ---------- Recent (phones): the last few, with relative days ---------- */
function renderRecent(r) {
  const list = [];
  for (const x of state.tx) { if (x.d > r.end) continue; if (x.d < r.start) break; if (amt(x) > 0) list.push(x); if (list.length >= 4) break; }
  $("s-recent").innerHTML = list.map((x) => {
    const inc = x.type === "income", v = amt(x);
    return '<button type="button" class="s-row" data-go-id="' + esc(x.id) + '">' + tile(x.c) + '<span class="s-nm"><span>' + esc(x.n || x.c) + "</span><small>" +
      esc(relDay(x.d) + " · " + (couple() ? pname(x.p) : x.c)) + '</small></span><span class="s-am amt' + (inc ? " pos" : "") + '">' + (inc ? "+" : "") + esc(f(v)) + "</span></button>";
  }).join("") || '<p class="s-none">' + t("Nothing in this range yet.") + "</p>";
}

/* ---------- Savings: what was kept, added up over twelve months, and where it heads in three ----------
   The line is the running total at each month's end (this month so far); the dotted part adds the
   average of the last three whole months, month by month. */
function renderSavings(r) {
  const [ey, em] = ym(r.end), months = [];
  for (let i = 11; i >= 0; i--) {
    const [y, mo] = ymAdd(ey, em, -i), a = ds(y, mo, 1);
    if (a < START.slice(0, 8) + "01") continue;
    const end = ds(y, mo, dim(y, mo)), x = totals(a, end < TODAY ? end : TODAY);
    months.push({ y, m: mo, net: x.net, partial: end > TODAY });
  }
  const box = $("s-savings");
  if (!months.length) { box.innerHTML = '<p class="s-none">' + esc(t("No spending yet in this range.")) + "</p>"; return; }
  let acc = 0;
  months.forEach((x) => { acc += x.net; x.acc = acc; });
  const whole = months.filter((x) => !x.partial).slice(-3), avg = whole.length ? whole.reduce((s0, x) => s0 + x.net, 0) / whole.length : null;
  const last = months[months.length - 1], proj = [];
  if (r.current && avg !== null) for (let k = 1; k <= 3; k++) { const [y, mo] = ymAdd(last.y, last.m, k); proj.push({ y, m: mo, acc: last.acc + avg * k }); }
  const over = last.acc < 0;
  let html = '<div class="s-eyes">' + esc(tn(months.length, "Saved in the last {n} month", "Saved in the last {n} months")) + "</div>" +
    '<div class="s-keptn"><b class="amt' + (over ? " up-bad" : "") + '">' + esc((over ? "−" : "") + f0(Math.abs(last.acc))) + "</b></div>";
  if (proj.length) {
    const pe = proj[proj.length - 1];
    html += '<div class="s-proj">' + t("On track for {amount} by {date}", { amount: "<b>≈ " + esc(f0(pe.acc)) + "</b>", date: esc(dlab(ds(pe.y, pe.m, dim(pe.y, pe.m)))) }) + "</div>";
  }
  // The month on screen: how much of what came in stayed
  if (r.month) {
    const tt = totals(r.start, r.end), p = prevOf(r), pt = p.ok ? totals(p.start, p.end) : null;
    if (tt.inc > 0) {
      let line = t("{month}: {pct} of income kept", { month: monthName(+r.start.slice(5, 7)), pct: pct(Math.max(0, tt.rate)) });
      if (pt && pt.rate != null && tt.rate != null) {
        const pts = Math.round((tt.rate - pt.rate) * 100);
        if (pts) line = t("{share}, {change}", { share: line, change: pts > 0 ? tn(pts, "up {n} point", "up {n} points") : tn(-pts, "down {n} point", "down {n} points") });
      }
      html += '<p class="s-keptsub">' + esc(line) + "</p>";
    }
  }
  html += '<div class="cv s-keptc" id="c-sav"></div>';
  box.innerHTML = html;
  const all = months.concat(proj), n = all.length;
  chart("c-sav", (w) => (w < 360 ? 120 : 140), (svg, w, h) => {
    const narrow = w < 360, mg = { l: 4, r: proj.length ? (narrow ? 58 : 66) : 8, t: 14, b: 18 };
    const vals = all.map((x) => x.acc).concat([0]), hi = Math.max(...vals), lo = Math.min(...vals), span0 = hi - lo || 1;
    const X = (i) => mg.l + (n > 1 ? i / (n - 1) : 0.5) * (w - mg.l - mg.r), Y = (v) => mg.t + (h - mg.t - mg.b) * (1 - (v - lo) / span0);
    const defs = el("defs", {}, svg), g = el("linearGradient", { id: "s-sgrad", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el("stop", { offset: 0, "stop-color": "var(--w-good)", "stop-opacity": 0.22 }, g);
    el("stop", { offset: 1, "stop-color": "var(--w-good)", "stop-opacity": 0.02 }, g);
    if (lo < 0) el("line", { x1: mg.l, x2: w - mg.r, y1: Y(0), y2: Y(0), class: "grid" }, svg);
    el("line", { x1: mg.l, x2: w - mg.r, y1: h - mg.b, y2: h - mg.b, class: "base" }, svg);
    const ci = months.length - 1;
    const path = (from, to) => { let d = ""; for (let i = from; i <= to; i++) d += (i === from ? "M" : "L") + X(i).toFixed(1) + " " + Y(all[i].acc).toFixed(1); return d; };
    const line = path(0, ci);
    el("path", { d: line + "L" + X(ci) + " " + (h - mg.b) + "L" + X(0) + " " + (h - mg.b) + "Z", fill: "url(#s-sgrad)" }, svg);
    if (proj.length) el("path", { d: path(ci, n - 1), fill: "none", stroke: "var(--w-good)", "stroke-width": 2.5, "stroke-dasharray": "0.1 6", "stroke-linecap": "round" }, svg);
    el("path", { d: line, fill: "none", stroke: "var(--w-good)", "stroke-width": 2.5, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
    el("circle", { cx: X(ci), cy: Y(last.acc), r: 4, fill: "var(--w-good)", stroke: "var(--s-card)", "stroke-width": 2 }, svg);
    // Three labels, never crowded: where it starts, this month, where the projection ends
    const lab = (x) => F.mon[x.m - 1] + (x.m === 1 || x === all[0] ? " ’" + String(x.y).slice(2) : "");
    txt(svg, X(0), h - 3, lab(all[0]), "ax", "start");
    if (ci > 0) txt(svg, X(ci), h - 3, F.mon[last.m - 1], "lb", proj.length ? "middle" : "end");
    if (proj.length) txt(svg, X(n - 1), h - 3, lab(all[n - 1]), "ax", "end");
    if (proj.length) { const pe = proj[proj.length - 1]; txt(svg, X(n - 1) + 8, Y(pe.acc) + 4, "≈ " + fk(pe.acc), "lb pos"); }
    // One hover band a month
    const bw = (w - mg.l - mg.r) / Math.max(n - 1, 1);
    all.forEach((x, i) => {
      const hit = el("rect", { x: X(i) - bw / 2, y: 0, width: bw, height: h, fill: "transparent" }, svg);
      hover(hit, () => "<b>" + esc(monthYear(x.y, x.m)) + (x.partial ? ", " + esc(t("so far")) : "") + "</b>" +
        (i <= ci ? row(t("Kept"), f(x.net), "var(--w-good)") + row(t("Saved by then"), f(x.acc)) : row(t("Projected"), f(x.acc), "var(--w-good)")));
    });
  }, () => tn(months.length, "Saved in the last {n} month", "Saved in the last {n} months") + ": " + f0(last.acc) + (proj.length ? ". " + t("Projected: {amount}", { amount: f0(proj[proj.length - 1].acc) }) : ""));
}

/* ---------- Kept each month: the number, the change, twelve bars ---------- */
function renderKept(r) {
  const tt = totals(r.start, r.end), p = prevOf(r), pt = p.ok ? totals(p.start, p.end) : null;
  const [ey, em] = ym(r.end), [sy, sm] = ym(r.start), months = [];
  const n = Math.max(12, (ey - sy) * 12 + em - sm + 1), long = n > 12;
  for (let i = n - 1; i >= 0; i--) {
    const [y, mo] = ymAdd(ey, em, -i), a = ds(y, mo, 1);
    if (a < START.slice(0, 8) + "01") continue;
    const end = ds(y, mo, dim(y, mo)), x = totals(a, end < TODAY ? end : TODAY);
    months.push({ y, m: mo, a, net: x.net, inc: x.inc, exp: x.exp, partial: end > TODAY, on: end >= r.start && a <= r.end });
  }
  const done = months.filter((x) => !x.partial), avg = done.length ? done.reduce((s, x) => s + x.net, 0) / done.length : null;
  $("s-avg").innerHTML = avg === null ? "" : '<i aria-hidden="true"></i>' + esc(t("Average {amount}", { amount: f0(avg) }));
  const over = tt.net < 0, soFar = r.current;
  let html = '<div class="s-keptn"><b class="amt' + (over ? " up-bad" : "") + '">' + esc(f0(Math.abs(tt.net))) + "</b>" +
    (over ? '<span class="up-bad">' + esc(soFar ? t("overspent so far") : t("overspent")) + "</span>" : soFar ? "<span>" + esc(t("so far")) + "</span>" : "") + "</div>";
  if (pt) html += '<div class="s-keptvs">' + changeLine(tt.net - pt.net, true, againstWhat(r, p)) + "</div>";
  html += '<div class="cv s-keptc" id="c-kept"></div>';
  $("s-kept").innerHTML = html;
  chart("c-kept", (w) => (w < 360 ? 116 : 136), (svg, w, h) => {
    const mg = { l: 2, r: 2, t: 18, b: 18 };
    const P = Math.max(...months.map((x) => Math.max(x.net, 0)), avg > 0 ? avg : 0, 1), N = Math.max(...months.map((x) => Math.max(-x.net, 0)), avg < 0 ? -avg : 0, 0);
    const k = (h - mg.t - mg.b) / (P + N), z = mg.t + P * k, bw = (w - mg.l - mg.r) / Math.max(months.length, 1), bar = Math.max(3, Math.min(24, bw * (long ? 0.7 : 0.56)));
    el("line", { x1: mg.l, x2: w - mg.r, y1: z, y2: z, class: "base" }, svg);
    months.forEach((x, i) => {
      const v = x.net, hh = Math.max(1, Math.abs(v) * k), x0 = mg.l + bw * i + (bw - bar) / 2, rr = Math.min(4, hh / 2, bar / 2);
      const d = v >= 0 ? "M" + x0 + " " + z + "V" + (z - hh + rr) + "q0 " + -rr + " " + rr + " " + -rr + "h" + (bar - 2 * rr) + "q" + rr + " 0 " + rr + " " + rr + "V" + z + "Z"
        : "M" + x0 + " " + z + "V" + (z + hh - rr) + "q0 " + rr + " " + rr + " " + rr + "h" + (bar - 2 * rr) + "q" + rr + " 0 " + rr + " " + -rr + "V" + z + "Z";
      el("path", { d, fill: v < 0 ? "var(--w-bad)" : x.on ? "var(--w-good)" : "var(--w-fill2)", "fill-opacity": x.on && x.partial ? 0.55 : v < 0 && !x.on ? 0.5 : 1 }, svg);
      const lab = w < 360 ? F.mon[x.m - 1].charAt(0) : F.mon[x.m - 1];
      if (!long) txt(svg, x0 + bar / 2, h - 3, lab, x.on ? "lb" : "ax", "middle");
      else if (i === 0 || x.m === 1) txt(svg, x0 + bar / 2, h - 3, monLabel(x.y, x.m, true, true), "ax", i === 0 ? "start" : "middle");
      if (x.on && months.filter((o) => o.on).length === 1) {
        const last = i === months.length - 1;
        txt(svg, last ? x0 + bar : x0 + bar / 2, v >= 0 ? z - hh - 5 : z + hh + 12, fk(v), "lb halo", last ? "end" : "middle");
      }
      const hit = el("rect", { x: mg.l + bw * i, y: 0, width: bw, height: h, fill: "transparent", tabindex: "0", role: "button", "aria-label": monthYear(x.y, x.m), "data-go-month": x.a.slice(0, 7) }, svg);
      hit.style.cursor = "pointer";
      hover(hit, "<b>" + esc(monthYear(x.y, x.m)) + (x.partial ? ", " + esc(t("so far")) : "") + "</b>" + row(t("Came in"), f(x.inc), "var(--w-good)") + row(t("Went out"), f(x.exp)) +
        row(v >= 0 ? t("Kept") : t("Overspent"), f(Math.abs(v))));
    });
    if (avg !== null) { const ay = z - avg * k; el("line", { x1: mg.l, x2: w - mg.r, y1: ay, y2: ay, stroke: "var(--w-ink3)", "stroke-dasharray": "3 3", "stroke-width": 1 }, svg); }
  }, () => t("Kept each month") + ": " + months.map((x) => monthYear(x.y, x.m) + " " + f0(x.net)).join(", "));
}

/* ---------- Coming up: the next three, however far away ---------- */
function renderUpcoming() {
  const occ = occurrences(addD(TODAY, 1), addD(TODAY, 62)).filter((x) => ruleAmt(x.r) > 0).slice(0, 3);
  const box = $("s-upcoming");
  if (!occ.length) {
    box.innerHTML = state.rules.length ? '<p class="s-none">' + t("Nothing scheduled in the next two months.") + "</p>"
      : '<div class="s-none">' + t("Rent, salaries and subscriptions can repeat on their own.") + ' <button type="button" class="w-link" data-new-rule>' + t("Add a repeating expense") + "</button></div>";
    return;
  }
  box.innerHTML = occ.map((x) => {
    const v = ruleAmt(x.r), inc = isIncome(x.r);
    return '<button type="button" class="s-row" data-go-rule="' + esc(x.r.id) + '">' + tile(x.r.c) + '<span class="s-nm"><span>' + esc(x.r.n || x.r.c) + "</span><small>" +
      esc(relDay(x.d) + " · " + pname(x.r.p)) + '</small></span><span class="s-am amt' + (inc ? " pos" : "") + '">' + (inc ? "+" : "") + esc(f(v)) + "</span></button>";
  }).join("");
}

/* ---------- the recap of the month on screen: open once the month is over ---------- */
function renderRecap(r) {
  const w = $("s-recapw");
  if (!r.month || r.start < START.slice(0, 8) + "01") { w.innerHTML = ""; return; }
  const [y, m] = ym(r.start), end = ds(y, m, dim(y, m)), title = esc(t("Your {month} recap", { month: monthIn(m) }));
  if (end >= TODAY) {
    // Not over yet: say when it opens, and keep last month's one tap away
    const q = ymAdd(y, m, -1), prev = ds(q[0], q[1], 1), next = addD(end, 1);
    w.innerHTML = '<div class="s-recap off"><span class="s-recapi">' + icon("history") + "</span><span><b>" + title + "</b><small>" +
      esc(next === addD(TODAY, 1) ? t("Ready tomorrow.") : t("Ready on {date}.", { date: dlab(next) })) + "</small></span>" +
      (prev >= START.slice(0, 8) + "01" && totals(prev, ds(q[0], q[1], dim(q[0], q[1]))).n ? '<a class="w-link s-recapl" href="/review?m=' + prev.slice(0, 7) + '" data-link>' + esc(t("{month} recap", { month: monthIn(q[1]) })) + "</a>" : "") + "</div>";
    return;
  }
  const tt = totals(r.start, end);
  if (!tt.n) { w.innerHTML = ""; return; }
  w.innerHTML = '<a class="s-recap" href="/review?m=' + r.start.slice(0, 7) + '" data-link><span class="s-recapi">' + icon("history") + "</span><span><b>" + title + "</b><small>" +
    esc(tt.net >= 0 ? t("You kept {amount}. A few things worth knowing.", { amount: f0(tt.net) }) : t("You overspent {amount}. A few things worth knowing.", { amount: f0(-tt.net) })) +
    "</small></span>" + icon("right", "s-chev") + "</a>";
}

/* ---------- the period menu under the title ---------- */
export function periodMenu() {
  const now = ym(TODAY), items = [];
  for (let k = 0; k < 13; k++) { const q = ymAdd(now[0], now[1], -k); if (ds(q[0], q[1], 1) < START.slice(0, 8) + "01") break; items.push(q); }
  const isOn = (q) => view.mode === "month" && view.ym[0] === q[0] && view.ym[1] === q[1];
  return '<button type="button" role="menuitemradio" data-pm="year" aria-checked="' + (view.mode === "year") + '"><span>' + esc(t("{year} so far", { year: now[0] })) + "</span></button>" +
    '<button type="button" role="menuitemradio" data-pm="custom" aria-checked="' + (view.mode === "custom") + '"><span>' + esc(t("Custom range…")) + "</span></button>" +
    '<div class="w-menusep" role="separator"></div>' +
    items.map((q) => '<button type="button" role="menuitemradio" data-pm="' + ds(q[0], q[1], 1).slice(0, 7) + '" aria-checked="' + isOn(q) + '"><span>' +
      esc(monthName(q[1]) + (q[0] !== now[0] ? " " + q[0] : "")) + "</span></button>").join("");
}
