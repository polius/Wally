/* The Dashboard under 768 px: compact forms, not a scaled-down desktop. Spent so far against
   last month, a small pace chart, top categories, recent, kept each month and bills in the
   next 7 days. */
import { t, tn, esc, TODAY, addD, f, f0, fk, pct, num, dlab, dlabW, cc, tile, icon, byCat, totals, F } from "../../core.js";
import { chart, el, txt, niceMax, hover, row } from "../../ui.js";
import { occurrences, ruleAmt, isIncome, inDays } from "../../sched.js";
import { scopeSwitch } from "../../shell.js";
import { view, canStep } from "./range.js";
import { paceData, countTo } from "./hero.js";
import { WIDGETS, renderRecent } from "./widgets.js";

const $ = (id) => document.getElementById(id);

export function phoneHeader(r) {
  return '<header class="w-mh d-mh"><button type="button" class="d-ptitle" id="d-prange" aria-haspopup="dialog" aria-label="' + esc(t("Range: {range}", { range: r.title + " " + r.sub })) + '">' +
    '<span class="d-pt">' + esc(r.title) + "</span>" + icon("down") + "</button>" +
    (view.mode === "month" ? '<div class="w-step d-pstep"><button type="button" id="d-prev" aria-label="' + esc(t("Previous month")) + '"' + (canStep(-1) ? "" : " disabled") + ">" + icon("left") +
      '</button><button type="button" id="d-next" aria-label="' + esc(t("Next month")) + '"' + (canStep(1) ? "" : " disabled") + ">" + icon("right") + "</button></div>" : "") +
    scopeSwitch() + "</header>";
}

/* ---------- markup, in phone order ---------- */
export function phoneHtml() {
  return '<section class="d-phero" data-w="hero"><span class="w-eyebrow" id="ph-eye"></span><span class="w-big" id="ph-big"></span><span class="d-pline" id="ph-line"></span></section>' +
    '<section class="w-panel d-ppace" data-w="hero"><div class="cv" id="ph-pace"></div></section>' +
    '<section class="w-panel" data-w="cats"><div class="w-ph"><h4>' + t("Top categories") + '</h4></div><div id="ph-cats"></div></section>' +
    '<section class="w-panel" data-w="recent"><div class="w-ph"><h4>' + t("Recent") + '</h4><a class="w-link d-hlink" href="/transactions" data-link>' + t("All") + '</a></div><div id="recent"></div></section>' +
    WIDGETS.kept.html() +
    '<section class="w-panel" data-w="upcoming"><div class="w-ph"><h4>' + t("Coming up · next 7 days") + '</h4></div><div id="ph-up"></div></section>' +
    '<div class="d-pfoot"><button type="button" class="w-btn ghost" data-review>' + icon("history") + t("Month in review") + "</button></div>";
}

/* ---------- renderers ---------- */
function renderHero(r) {
  const tt = totals(r.start, r.end);
  $("ph-eye").textContent = r.current ? t("Spent so far") : t("Spent");
  countTo($("ph-big"), tt.exp);
  const d = paceData(r), ci = d.cur.length - 1, len = d.len, line = $("ph-line");
  // Against the month before, to the same day; or, without one, what came in and was kept
  if (d.cmp && tt.n) {
    const df = d.cur[ci] - d.cmp[ci], up = df > 0, vars = { amount: f0(Math.abs(df)), pct: pct(Math.abs(df) / Math.max(d.cmp[ci], 1)) };
    line.innerHTML = '<b class="' + (up ? "up-bad" : "dn-good") + '">' + esc(up ? t("{amount} more ({pct})", vars) : t("{amount} less ({pct})", vars)) + "</b> " +
      esc(r.current && r.month ? t("than {what} by {date}", { what: d.label, date: dlab(r.end) }) : t("than {what}", { what: d.label }));
  } else line.textContent = t("{income} in, {kept} kept", { income: f0(tt.inc), kept: (tt.net < 0 ? "−" : "") + f0(Math.abs(tt.net)) });
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

function renderUpcoming() {
  const occ = occurrences(addD(TODAY, 1), addD(TODAY, 7)).filter((x) => !isIncome(x.r) && ruleAmt(x.r) > 0);
  $("ph-up").innerHTML = occ.slice(0, 4).map((x) => '<button type="button" class="w-mrow d-mrow" data-go-rule="' + esc(x.r.id) + '">' + tile(x.r.c) + '<div class="d-min"><b>' + esc(x.r.n || x.r.c) +
    "</b><small>" + esc(dlabW(x.d) + " · " + inDays(x.d)) + '</small></div><span class="amt">' + f(ruleAmt(x.r)) + "</span></button>").join("") +
    (occ.length > 4 ? '<p class="w-hint">' + esc(tn(occ.length - 4, "And {n} more", "And {n} more")) + "</p>" : "") ||
    '<p class="w-hint">' + t("No bills this week") + "</p>";
}

export function renderPhone(r) {
  renderHero(r);
  renderCats(r);
  WIDGETS.kept.render(r);
  renderUpcoming();
  renderRecent(r, 5);
}
