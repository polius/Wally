/* The Dashboard under 768 px: compact forms, not a scaled-down desktop. Spent so far with
   Safe to spend, a small pace chart, top categories, a Budgets card (Budgets has no tab on
   phones), bills in the next 7 days, shared costs, recent, then any other widget shown,
   with cash flow as one stacked bar. */
import { state, t, tn, esc, TODAY, ds, dim, ym, addD, f, f0, fk, pct, num, dlabW, cc, tile, icon, byCat, totals, couple, F } from "../../core.js";
import { chart, el, txt, niceMax, hover, row } from "../../ui.js";
import { occurrences, ruleAmt, isIncome, inDays } from "../../sched.js";
import { scopeChips } from "../../shell.js";
import { view, canStep } from "./range.js";
import { paceData, safeInfo, countTo } from "./hero.js";
import { WIDGETS, settleHtml, renderRecent, flowData } from "./widgets.js";

const $ = (id) => document.getElementById(id);

export function phoneHeader(r) {
  return '<header class="w-mh d-mh"><button type="button" class="d-ptitle" id="d-prange" aria-haspopup="dialog" aria-label="' + esc(t("Range: {range}", { range: r.title + " " + r.sub })) + '">' +
    '<span class="d-pt">' + esc(r.title) + "</span>" + icon("down") + "</button>" +
    (view.mode === "month" ? '<div class="w-step d-pstep"><button type="button" id="d-prev" aria-label="' + esc(t("Previous month")) + '"' + (canStep(-1) ? "" : " disabled") + ">" + icon("left") +
      '</button><button type="button" id="d-next" aria-label="' + esc(t("Next month")) + '"' + (canStep(1) ? "" : " disabled") + ">" + icon("right") + "</button></div>" : "") +
    '<button type="button" class="d-picon" data-d-cmd aria-label="' + esc(t("Search or jump")) + '">' + icon("search") + "</button></header>" + scopeChips();
}

/* ---------- markup, in phone order ---------- */
export function phoneHtml(shown) {
  const sec = (k, html) => (shown(k) ? html : "");
  return sec("hero", '<section class="d-phero" data-w="hero"><span class="w-eyebrow" id="ph-eye"></span><span class="w-big" id="ph-big"></span><span class="d-pline" id="ph-line"></span></section>' +
      '<section class="w-panel d-ppace" data-w="hero"><div class="cv" id="ph-pace"></div></section>') +
    sec("cats", '<section class="w-panel" data-w="cats"><div class="w-ph"><h4>' + t("Top categories") + '</h4></div><div id="ph-cats"></div></section>') +
    '<a class="w-panel d-pbud" href="/budgets" data-link id="ph-bud"></a>' +
    sec("upcoming", '<section class="w-panel" data-w="upcoming"><div class="w-ph"><h4>' + t("Coming up · next 7 days") + '</h4></div><div id="ph-up"></div></section>') +
    (couple() ? '<section class="w-panel" data-w="shared"><div class="w-ph"><h4>' + t("Shared costs") + '</h4></div><div id="ph-shared"></div></section>' : "") +
    sec("recent", '<section class="w-panel" data-w="recent"><div class="w-ph"><h4>' + t("Recent") + '</h4><a class="w-link d-hlink" href="/transactions" data-link>' + t("All") + '</a></div><div id="recent"></div></section>') +
    ["savings", "unusual", "flow", "cal", "people", "weekday", "subs", "trends", "payees"].filter((k) => shown(k) && k !== "people").map((k) =>
      k === "flow" ? '<section class="w-panel" data-w="flow"><div class="w-ph"><div><h4>' + t("Cash flow") + '</h4><p id="ph-flowsub"></p></div></div><div id="ph-flow"></div></section>' : WIDGETS[k].html()).join("") +
    '<div class="d-pfoot"><button type="button" class="w-btn ghost" id="d-cust">' + icon("layout") + t("Customize") + '</button><button type="button" class="w-btn ghost" data-review>' + icon("history") + t("Month in review") + "</button></div>";
}

/* ---------- renderers ---------- */
function renderHero(r) {
  const tt = totals(r.start, r.end);
  $("ph-eye").textContent = r.current ? t("Spent so far") : t("Spent");
  countTo($("ph-big"), tt.exp);
  const line = $("ph-line");
  if (r.month && r.current) {
    const s = safeInfo(r.start);
    line.innerHTML = s.inc ? tn(Math.max(s.left, 1), "Safe to spend {amount} for {n} day", "Safe to spend {amount} for {n} days", { amount: '<b class="' + (s.per < 0 ? "up-bad" : "acc") + '">' + esc(t("{amount} a day", { amount: (s.per < 0 ? "−" : "") + f0(Math.abs(s.per)) })) + "</b>" })
      : esc(t("No income this month yet"));
  } else line.textContent = t("{income} in, {kept} kept", { income: f0(tt.inc), kept: (tt.net < 0 ? "−" : "") + f0(Math.abs(tt.net)) });
  const d = paceData(r), ci = d.cur.length - 1, len = d.len;
  if (!tt.n) { $("ph-pace").innerHTML = ""; $("ph-pace").closest("section").hidden = true; return; }
  $("ph-pace").closest("section").hidden = false;
  chart("ph-pace", 104, (svg, w, h) => {
    const all = d.cur.concat(d.cmp || []).concat(d.proj || []), mx = niceMax(Math.max(...all, 1));
    const X = (i) => 2 + (len > 1 ? i / (len - 1) : 0.5) * (w - 50), Y = (v) => h - 16 - (v / mx) * (h - 26);
    el("line", { x1: 0, x2: w - 46, y1: h - 16, y2: h - 16, class: "base" }, svg);
    const path = (arr, off) => arr.map((v, i) => (i ? "L" : "M") + X(i + (off || 0)).toFixed(1) + " " + Y(v).toFixed(1)).join("");
    if (d.cmp) el("path", { d: path(d.cmp), fill: "none", stroke: "var(--w-ink3)", "stroke-width": 1.5, "stroke-dasharray": "4 4" }, svg);
    if (d.proj) el("path", { d: path(d.proj, ci), fill: "none", stroke: "var(--w-accent)", "stroke-width": 2.25, "stroke-dasharray": "0.1 5", "stroke-linecap": "round" }, svg);
    const p = path(d.cur);
    el("path", { d: p + "L" + X(ci) + " " + Y(0) + "L" + X(0) + " " + Y(0) + "Z", fill: "var(--w-accent-soft)" }, svg);
    el("path", { d: p, fill: "none", stroke: "var(--w-accent)", "stroke-width": 2.25, "stroke-linejoin": "round" }, svg);
    el("circle", { cx: X(ci), cy: Y(d.cur[ci]), r: 4, fill: "var(--w-accent)", stroke: "var(--w-panel)", "stroke-width": 2 }, svg);
    const a = Y(d.cur[ci]) + 4;
    let b = d.cmp ? Y(d.cmp[d.cmp.length - 1]) + 4 : null;
    if (b !== null && Math.abs(a - b) < 14) b = a + (b >= a ? 14 : -14);
    txt(svg, w - 42, a, fk(d.cur[ci]), "lb acc");
    if (b !== null) txt(svg, w - 42, b, fk(d.cmp[d.cmp.length - 1]), "lbs");
    const s0 = r.start, s1 = addD(r.start, len - 1);
    txt(svg, X(0), h - 3, r.month ? num(1) + " " + F_mon(s0) : F_mon(s0), "ax");
    txt(svg, X(len - 1), h - 3, r.month ? num(len) : F_mon(s1), "ax", "end");
    const hit = el("rect", { x: 0, y: 0, width: w, height: h, fill: "transparent" }, svg);
    hover(hit, () => "<b>" + esc(d.curName) + "</b>" + row(t("Spent so far"), f(d.cur[ci]), "var(--w-accent)") + (d.cmp ? row(esc(d.cmpName), f(d.cmp[ci]), "var(--w-ink3)") : "") +
      (d.proj ? row(t("Projected"), f(d.proj[d.proj.length - 1])) : ""));
  }, () => t("Spent so far: {amount}", { amount: f(d.cur[ci]) }) + (d.cmp ? ". " + t("{name}: {amount}", { name: d.cmpName, amount: f(d.cmp[ci]) }) : ""));
}
const F_mon = (s) => F.mon[+s.slice(5, 7) - 1];

function renderCats(r) {
  const c = byCat(r.start, r.end), keys = Object.keys(c).sort((a, b) => c[b] - c[a]).slice(0, 4), mx = keys.length ? c[keys[0]] : 1;
  $("ph-cats").innerHTML = keys.map((k) => '<button type="button" class="w-mcat d-mcat" data-go-cat="' + esc(k) + '">' + tile(k) + '<span class="d-min">' + esc(k) +
    '<span class="w-bar"><span style="width:' + (c[k] / mx) * 100 + "%;background:" + cc(k) + '"></span></span></span><span class="w-amt">' + f0(c[k]) + "</span></button>").join("") ||
    '<p class="w-hint">' + t("No spending yet in this range.") + "</p>";
}

/* Budgets has no tab on phones: this card opens it */
function renderBudgets() {
  const box = $("ph-bud");
  const flex = (state.budgets || []).filter((b) => b.kind === "flexible");
  if (!flex.length) {
    box.innerHTML = '<span class="w-ico">' + icon("coin") + '</span><span class="d-min"><b>' + t("Budgets") + "</b><small>" + t("Set a monthly amount for the categories that vary") + "</small></span>" + icon("right", "d-chev");
    return;
  }
  const now = ym(TODAY), a = ds(now[0], now[1], 1), end = ds(now[0], now[1], dim(now[0], now[1])), spent = byCat(a, TODAY, "all");
  const cap = flex.reduce((s, b) => s + Number(b.amount), 0), used = flex.reduce((s, b) => s + (spent[b.category] || 0), 0), left = cap - used;
  const days = Math.max(1, Math.round((Date.parse(end) - Date.parse(TODAY)) / 864e5));
  const tick = (+TODAY.slice(8) / dim(now[0], now[1])) * 100;
  box.innerHTML = '<span class="d-min"><span class="w-eyebrow">' + (left >= 0 ? t("Flexible left") : t("Flexible over")) + '</span><b class="d-pbig amt">' + f0(Math.abs(left)) + "</b>" +
    '<span class="w-budbar sm"><span style="width:' + Math.min(used / cap, 1) * 100 + "%" + (left < 0 ? ";background:var(--w-bad)" : "") + '"></span><i style="inset-inline-start:' + tick + '%"></i></span>' +
    '<small class="w-hint">' + esc(left > 0 ? tn(days, "{amount} a day for {n} day", "{amount} a day for {n} days", { amount: f0(left / days) }) : t("Budgets")) + "</small></span>" + icon("right", "d-chev");
  box.setAttribute("aria-label", t("Budgets") + ": " + (left >= 0 ? t("Flexible left") : t("Flexible over")) + " " + f0(Math.abs(left)));
}

function renderUpcoming() {
  const occ = occurrences(addD(TODAY, 1), addD(TODAY, 7)).filter((x) => !isIncome(x.r) && ruleAmt(x.r) > 0);
  $("ph-up").innerHTML = occ.slice(0, 4).map((x) => '<button type="button" class="w-mrow d-mrow" data-go-rule="' + esc(x.r.id) + '">' + tile(x.r.c) + '<div class="d-min"><b>' + esc(x.r.n || x.r.c) +
    "</b><small>" + esc(dlabW(x.d) + " · " + inDays(x.d)) + '</small></div><span class="amt">' + f(ruleAmt(x.r)) + "</span></button>").join("") +
    (occ.length > 4 ? '<p class="w-hint">' + esc(tn(occ.length - 4, "And {n} more", "And {n} more")) + "</p>" : "") ||
    '<p class="w-hint">' + t("No bills this week") + "</p>";
}

/* Cash flow as one stacked bar: where the income went */
function renderFlowBar(r) {
  const d = flowData(r);
  $("ph-flowsub").textContent = d.total ? t("{income} came in, {spent} went out", { income: f0(d.inc), spent: f0(d.exp) }) : t("No money in or out in this range");
  if (!d.total) { $("ph-flow").innerHTML = ""; return; }
  const col = (x) => (x.saved ? "var(--w-accent)" : x.c ? cc(x.c) : "var(--c9)");
  $("ph-flow").innerHTML = '<div class="w-share d-fbar">' + d.Rn.map((x, i) => '<span tabindex="0" data-fi="' + i + '" style="flex-basis:' + (x.v / d.total) * 100 + "%;background:" + col(x) + '"></span>').join("") + "</div>" +
    '<div class="d-flist">' + d.Rn.slice(0, 8).map((x) => '<div class="d-frow"><span class="w-cdot" style="background:' + col(x) + '"></span><span class="d-min">' + esc(x.n) + '</span><span class="amt">' + f0(x.v) + '</span><span class="w-pct">' + (d.inc ? pct(x.v / d.inc) : "—") + "</span></div>").join("") + "</div>";
  $("ph-flow").querySelectorAll("[data-fi]").forEach((s) => { const x = d.Rn[+s.dataset.fi]; hover(s, "<b>" + esc(x.n) + "</b>" + row(t("Amount"), f(x.v)) + row(t("Share of income"), d.inc ? pct(x.v / d.inc) : "—")); });
}

export function renderPhone(r, shown) {
  if (shown("hero")) renderHero(r);
  if (shown("cats")) renderCats(r);
  renderBudgets();
  if (shown("upcoming")) renderUpcoming();
  if (couple()) $("ph-shared").innerHTML = settleHtml(true);
  if (shown("recent")) renderRecent(r, 5);
  ["savings", "unusual", "cal", "weekday", "subs", "trends", "payees"].forEach((k) => { if (shown(k)) WIDGETS[k].render(r); });
  if (shown("flow")) renderFlowBar(r);
}
