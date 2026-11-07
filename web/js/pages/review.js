/* Month in review: the month that just closed, read in one direction. Did we do OK (kept, and the
   four totals), where it went (with who spent it inside each bar), what changed against "usual"
   (the average of the 6 months before), each of you, day by day, bills, and what's worth knowing.
   Every figure is worked out here from the ledger, for whoever is shown; "Each of you" always shows
   everyone. On a phone it is a few pages you tap or swipe through. Route: /review?m=YYYY-MM */
import {
  t, tn, esc, state, f, f0, fk, pct, pad, ds, dim, addD, wd, ym, ymAdd, TODAY, START, totals, byCat, amt,
  tile, cat, cc, av, pname, couple, isIncomeCat, dlab, dlabW, monthYear, F, icon,
} from "../core.js";
import { hover, row, hideTip } from "../ui.js";
import { navigate, setScope, closeMenus } from "../shell.js";
import { occurrences, ruleAmt, ruleHist, shortDesc, isIncome } from "../sched.js";

let root = null;
let shown = null;        // [year, month] on screen
let story = 0;           // phone page, from 0
let current = null;      // the figures on screen, for the printed report
let pdf = null;          // review/pdf.js, loaded with the page so ⌘P can use it at once
let STORY = 5;           // pages on the phone: 4 when there is no one else to compare with

/* ---------- months ---------- */
const mkey = (q) => q[0] + "-" + pad(q[1]);
const same = (a, b) => a[0] === b[0] && a[1] === b[1];
function bounds(q) { return [ds(q[0], q[1], 1), ds(q[0], q[1], dim(q[0], q[1]))]; }
function hasData(q) { return ds(q[0], q[1], 1) >= START; }
function lastClosed() { const [y, m] = ym(TODAY); return ymAdd(y, m, -1); }
function parseMonth(s) { const m = /^(\d{4})-(\d{2})$/.exec(s || ""); return m && +m[2] >= 1 && +m[2] <= 12 ? [+m[1], +m[2]] : null; }
function clamp(q) {
  const last = lastClosed(), first = ym(START);
  if (!q || ds(q[0], q[1], 1) > ds(last[0], last[1], 1)) return last;
  if (ds(q[0], q[1], 1) < ds(first[0], first[1], 1)) return first;
  return q;
}
const monthOnly = (q) => F.months[q[1] - 1];
/* One letter a month under the bars, as Apple's charts do */
let NARROW = null;
function narrow(q) {
  if (!NARROW) NARROW = new Intl.DateTimeFormat(document.documentElement.lang || undefined, { month: "narrow", timeZone: "UTC" });
  return NARROW.format(Date.UTC(q[0], q[1] - 1, 15));
}

/* ---------- figures ---------- */
/* Totals for a month, with bills (recurring expenses) and everyday spending apart */
function stats(q, sc) {
  const [a, b] = bounds(q), s = totals(a, b, sc);
  let bills = 0;
  for (const x of state.tx) if (x.rec && x.type === "expense" && x.d >= a && x.d <= b) bills += amt(x, sc);
  s.bills = bills;
  s.day = s.exp - bills;
  return s;
}
/* "Usual": the average of up to 6 months before, counting only months Wally has data for */
function usual(q, sc) {
  const o = { inc: 0, exp: 0, net: 0, bills: 0, day: 0 };
  let n = 0;
  for (let i = 1; i <= 6; i++) {
    const p = ymAdd(q[0], q[1], -i);
    if (!hasData(p)) break;
    const s = stats(p, sc);
    for (const k in o) o[k] += s[k];
    n++;
  }
  for (const k in o) o[k] /= Math.max(n, 1);
  o.n = n;
  return o;
}
function catUsual(q, sc) {
  const o = {};
  let n = 0;
  for (let i = 1; i <= 6; i++) {
    const p = ymAdd(q[0], q[1], -i);
    if (!hasData(p)) break;
    const [a, b] = bounds(p), c = byCat(a, b, sc);
    for (const k in c) o[k] = (o[k] || 0) + c[k];
    n++;
  }
  for (const k in o) o[k] /= Math.max(n, 1);
  return o;
}
/* "€40 more than August"; good or bad colour only when the change is real */
function cmp(cur, prev, goodUp, month, short) {
  const d = cur - prev;
  if (Math.abs(d) < Math.max(5, Math.abs(prev) * 0.03)) return '<span class="w-mrd">' + (short ? t("Same") : t("About the same as {month}", { month })) + "</span>";
  const amount = f0(Math.abs(d)), cls = (d > 0) === goodUp ? "good" : "bad";
  const text = short ? (d > 0 ? t("{amount} more", { amount }) : t("{amount} less", { amount }))
    : d > 0 ? t("{amount} more than {month}", { amount, month }) : t("{amount} less than {month}", { amount, month });
  return '<span class="w-mrd ' + cls + '">' + text + "</span>";
}
const catName = (k) => esc(cat(k).n);
/* Everything the month needs, worked out once per render */
function compute(q, sc) {
  const [a, b] = bounds(q), D = dim(q[0], q[1]);
  const pq = ymAdd(q[0], q[1], -1), hasPrev = hasData(pq), nq = ymAdd(q[0], q[1], 1);
  const s = stats(q, sc), prev = hasPrev ? stats(pq, sc) : null, u = usual(q, sc);
  const spendIn = (x) => x.type === "expense" && x.d >= a && x.d <= b && amt(x, sc) > 0;
  const mine = state.tx.filter(spendIn);

  // 12 months of money kept, for the chart and the ranking
  const hist = [];
  for (let i = 11; i >= 0; i--) { const hq = ymAdd(q[0], q[1], -i); if (hasData(hq)) hist.push({ q: hq, s: stats(hq, sc) }); }
  const rank = 1 + hist.filter((h) => h.s.net > s.net + 0.005).length;

  // Categories, biggest first, each in its own color
  const c = byCat(a, b, sc), cu = catUsual(q, sc), cp = hasPrev ? byCat(...bounds(pq), sc) : {};
  const keys = Object.keys(c).filter((k) => c[k] >= 0.5).sort((x, y) => c[y] - c[x]);
  const colOf = (k) => cc(k);
  const moved = [...new Set(Object.keys(c).concat(Object.keys(cu)))].filter((k) => !isIncomeCat(k))
    .map((k) => ({ k, d: (c[k] || 0) - (cu[k] || 0) }))
    .filter((x) => u.n && Math.abs(x.d) >= 25 && Math.abs(x.d) >= (cu[x.k] || 0) * 0.15);
  const ups = moved.filter((x) => x.d > 0).sort((x, y) => y.d - x.d).slice(0, 3);
  const downs = moved.filter((x) => x.d < 0).sort((x, y) => x.d - y.d).slice(0, 3);
  const biggestIn = (k) => mine.filter((x) => x.c === k).sort((x, y) => amt(y, sc) - amt(x, sc))[0];
  // Who spent it, per category: each person's own, and shared (for one person: their own and their share)
  const parts = {};
  mine.forEach((x) => { const o = (parts[x.c] = parts[x.c] || { sh: 0 }), v = amt(x, sc); if (x.p === null) o.sh += v; else o[x.p] = (o[x.p] || 0) + v; });

  // The headline
  const who = sc === "all" ? null : pname(sc);
  let head;
  if (s.net >= 0 && s.inc > 0) {
    // The number is right above: the sentence says what it means
    head = t("{pct} of what came in.", { pct: pct(s.rate) });
    const off = u.n ? (s.net - u.net) / Math.max(Math.abs(u.net), 1) : 0;
    if (hist.length >= 6 && rank <= 3) head += " " + [t("The best month of the last {n}.", { n: hist.length }), t("The second best month of the last {n}.", { n: hist.length }), t("The third best month of the last {n}.", { n: hist.length })][rank - 1];
    else if (u.n && s.net < u.net - 50) head += " " + (off > -0.15 ? t("A bit less than usual ({amount}).", { amount: f0(u.net) }) : t("Less than usual ({amount}).", { amount: f0(u.net) }));
    else if (u.n && s.net > u.net + 50) head += " " + (off < 0.15 ? t("A bit more than usual ({amount}).", { amount: f0(u.net) }) : t("More than usual ({amount}).", { amount: f0(u.net) }));
  } else if (s.net >= 0) {
    head = who ? t("Nothing went out for {name}.", { name: esc(who) }) : t("Nothing went out.");
  } else {
    head = who ? t("{name} spent {amount} more than came in.", { name: esc(who), amount: f0(-s.net) }) : t("You spent {amount} more than came in.", { amount: f0(-s.net) });
    if (ups[0]) head += " " + t("Mostly {category}, {amount} above usual.", { category: catName(ups[0].k), amount: f0(ups[0].d) });
  }

  // Day by day, without bills
  const vals = new Array(D).fill(0);
  mine.forEach((x) => { if (!x.rec) vals[+x.d.slice(8) - 1] += amt(x, sc); });
  let ns = 0, run = 0, best = 0, peak = 0;
  vals.forEach((v, i) => { if (v < 0.005) { ns++; run++; best = Math.max(best, run); } else run = 0; if (v > vals[peak]) peak = i; });
  const wsum = [0, 0], wcnt = [0, 0];
  for (let d = a; d <= b; d = addD(d, 1)) wcnt[wd(d) % 6 === 0 ? 1 : 0]++;
  mine.forEach((x) => { if (!x.rec) wsum[wd(x.d) % 6 === 0 ? 1 : 0] += amt(x, sc); });
  const weekday = wsum[0] / Math.max(wcnt[0], 1), weekend = wsum[1] / Math.max(wcnt[1], 1);

  // Bills, and what changed in them
  const billsN = mine.filter((x) => x.rec).length, changes = [];
  state.rules.forEach((r) => {
    if (isIncome(r) || !ruleAmt(r, sc)) return;
    const h = ruleHist(r), inMonth = h.filter((x) => x.rid === r.id && x.d >= a && x.d <= b);
    if (r.start >= a && r.start <= b) changes.push({ c: r.c, h: t("{name} started", { name: esc(r.n) }), p: esc(shortDesc(r)) + ", " + f(r.a) + "." });
    inMonth.forEach((x) => {
      const k = h.indexOf(x), before = k > 0 ? h[k - 1] : null;
      if (before && !r.varies && Math.abs(x.a - before.a) > 0.005) {
        changes.push({ c: r.c, h: x.a > before.a ? t("{name} went up", { name: esc(r.n) }) : t("{name} went down", { name: esc(r.n) }),
          p: t("{from} to {to}. That is {year} a year.", { from: f(before.a), to: f(x.a), year: f0(Math.abs(x.a - before.a) * (r.freq === "monthly" ? 12 / (r.every || 1) : r.freq === "weekly" ? 52 / (r.every || 1) : 1)) }) });
      }
    });
    if (r.freq === "yearly" && inMonth.length) changes.push({ c: r.c, h: t("{name}, once a year", { name: esc(r.n) }), p: t("{amount} on {date}.", { amount: f(inMonth[0].a), date: dlab(inMonth[0].d) }) });
  });
  // The month after: what the rules will add, or what they did add for a month already over
  const [na, nb] = bounds(nq);
  let next;
  if (nb < TODAY) {
    const list = state.tx.filter((x) => x.rec && x.type === "expense" && x.d >= na && x.d <= nb && amt(x, sc) > 0).sort((x, y) => (x.d < y.d ? -1 : 1));
    next = { n: list.length, sum: list.reduce((v, x) => v + amt(x, sc), 0), first: list[0] ? { n: list[0].n, d: list[0].d } : null };
  } else {
    const list = occurrences(na, nb).filter((x) => !isIncome(x.r) && ruleAmt(x.r, sc) > 0);
    next = { n: list.length, sum: list.reduce((v, x) => v + ruleAmt(x.r, sc), 0), first: list[0] ? { n: list[0].r.n, d: list[0].d } : null };
  }

  // Small things worth knowing
  const big = mine.filter((x) => !x.rec).sort((x, y) => amt(y, sc) - amt(x, sc))[0];
  const pay = {};
  mine.forEach((x) => { if (x.rec || !x.n) return; const o = (pay[x.n] = pay[x.n] || { k: 0, s: 0 }); o.k++; o.s += amt(x, sc); });
  const topPay = Object.keys(pay).sort((x, y) => pay[y].k - pay[x].k || pay[y].s - pay[x].s)[0];
  const tg = {};
  mine.forEach((x) => x.tags.forEach((g) => { const o = (tg[g] = tg[g] || { k: 0, s: 0 }); o.k++; o.s += amt(x, sc); }));
  const topTag = Object.keys(tg).sort((x, y) => tg[y].s - tg[x].s)[0];
  const extra = state.tx.filter((x) => x.type === "income" && !x.rec && x.d >= a && x.d <= b && amt(x, sc) > 0);

  return { q, a, b, D, pq, nq, hasPrev, s, prev, u, hist, c, cu, cp, keys, colOf, ups, downs, biggestIn, head, vals, ns, best, peak, weekday, weekend, billsN, changes, next, big, pay, topPay, tg, topTag, extra, sc, parts };
}

/* ---------- the page ---------- */
export function mount(el, route) {
  root = el;
  shown = clamp(parseMonth(route.query.get("m")));
  story = 0;
  import("./review/pdf.js").then((x) => { pdf = x; });
  addEventListener("beforeprint", onBeforePrint);
  render();
}
export function update() { render(); }
export function unmount() { root = null; current = null; removeEventListener("beforeprint", onBeforePrint); }
/* ⌘P / Ctrl+P prints the report, not the screen */
function onBeforePrint() { if (current && pdf) pdf.beforePrint(current); }
async function exportPdf() {
  if (!current) return;
  hideTip();
  closeMenus();
  (pdf || (pdf = await import("./review/pdf.js"))).exportPdf(current);
}
export function key(ev) {
  if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") {
    const rtl = document.documentElement.dir === "rtl", back = (ev.key === "ArrowLeft") !== rtl;
    const btn = root && root.querySelector(back ? "#mr-prev" : "#mr-next");
    if (btn && !btn.disabled) { ev.preventDefault(); btn.click(); }
  }
}

function render() {
  if (!root) return;
  hideTip();
  const last = lastClosed();
  if (!state.tx.length || !hasData(last)) {
    current = null;
    root.innerHTML = '<div class="w-mrpage"><div class="w-mrev w-mrempty">' + header(null) +
      '<div class="w-empty"><span class="w-empty-i">' + icon("cal") + "</span><b>" + t("No month to review yet") + "</b><p>" +
      t("Month in review looks back at a month once it is over. The first one is ready on the 1st of next month.") + "</p><a class=\"w-btn ghost\" href=\"/\" data-link>" + t("Open Summary") + "</a></div></div></div>";
    wireHeader(null);
    return;
  }
  shown = clamp(shown);
  const m = (current = compute(shown, state.scope));
  STORY = couple() ? 5 : 4;
  story = Math.min(story, STORY - 1);
  root.innerHTML = '<div class="w-mrpage"><article class="w-mrev" aria-labelledby="mr-title">' + desktop(m) + "</article>" + phoneStory(m) + "</div>";
  wireHeader(m);
  wireDesktop(m);
  wireStory(m);
}

function goMonth(q) {
  shown = clamp(q);
  story = 0;
  history.replaceState(history.state, "", "/review?m=" + mkey(shown));
  render();
}

/* Household / each person: one segmented control, on every size */
function scopeSeg(m) {
  if (!couple() || !m) return "";
  return '<div class="w-seg sm w-mrsc" role="group" aria-label="' + esc(t("Whose money")) + '">' +
    [["all", t("Household")]].concat(state.people.map((p) => [String(p.id), esc(p.name)])).map(([v, l]) =>
      '<button type="button" data-mrsc="' + v + '" aria-pressed="' + (state.scope === v) + '">' + l + "</button>").join("") + "</div>";
}
/* ‹ › through closed months, ••• (Export as PDF), close */
function tools(m, id) {
  const q = m ? m.q : lastClosed(), isLast = same(q, lastClosed()), canPrev = m && m.hasPrev;
  const nextName = monthOnly(ymAdd(q[0], q[1], 1));
  return (m ? '<button type="button" class="w-mrc"' + (id ? ' id="mr-prev"' : " data-mr-prev") + ' aria-label="' + esc(t("Previous month")) + '"' + (canPrev ? "" : " disabled") + ">" + icon("left") + "</button>" +
      '<button type="button" class="w-mrc"' + (id ? ' id="mr-next"' : " data-mr-next") + ' aria-label="' + esc(t("Next month")) + '"' + (isLast ? ' disabled title="' + esc(t("{month} is not over yet", { month: nextName })) + '"' : "") + ">" + icon("right") + "</button>" +
      '<div class="w-mrmore"><button type="button" class="w-mrc" data-menu="mrmore" aria-haspopup="menu" aria-expanded="false" aria-label="' + esc(t("More")) + '">' + icon("more") + "</button>" +
        '<div class="w-menu" role="menu" hidden><button type="button" role="menuitem" data-mr-pdf>' + icon("download") + t("Export as PDF") + "</button></div></div>" : "") +
    '<button type="button" class="w-mrc" data-mr-close aria-label="' + esc(t("Close")) + '">' + icon("x") + "</button>";
}
function header(m) {
  const q = m ? m.q : lastClosed();
  return '<header class="w-mrh"><div class="t"><h1 id="mr-title">' + esc(monthYear(q[0], q[1])) + "</h1><p>" + t("Month in review") + "</p></div>" +
    scopeSeg(m) + '<div class="w-mrtools">' + tools(m, true) + "</div></header>";
}
function wireHeader(m) {
  root.querySelectorAll("[data-mr-close]").forEach((b) => b.addEventListener("click", () => navigate("/")));
  root.querySelectorAll("[data-mrsc]").forEach((b) => b.addEventListener("click", () => setScope(b.dataset.mrsc)));
  if (!m) return;
  root.querySelectorAll("[data-mr-pdf]").forEach((b) => b.addEventListener("click", exportPdf));
  root.querySelectorAll("#mr-prev,[data-mr-prev]").forEach((b) => b.addEventListener("click", () => goMonth(m.pq)));
  root.querySelectorAll("#mr-next,[data-mr-next]").forEach((b) => b.addEventListener("click", () => goMonth(m.nq)));
}

/* ---------- the pieces, shared by the desktop sheet and the phone pages ---------- */
/* Money kept, the last 12 months: bars, the month shown in green; a click opens a month */
function keptBars(m, cls) {
  const { hist, q } = m, mx = Math.max(...hist.map((x) => Math.abs(x.s.net)), 1);
  const label = t("Money kept, last {n} months", { n: hist.length }) + ": " + hist.map((x) => monthYear(x.q[0], x.q[1]) + " " + f0(x.s.net)).join(", ");
  return '<div class="w-mrbars ' + (cls || "") + '" role="group" aria-label="' + esc(label) + '"><div class="b">' + hist.map((x) => {
    const on = same(x.q, q), v = x.s.net;
    return '<button type="button" class="' + (on ? "on" : "") + (v < 0 ? " neg" : "") + '" data-mrm="' + mkey(x.q) + '" style="height:' + Math.max(3, (Math.abs(v) / mx) * 100).toFixed(1) + '%" aria-label="' + esc(monthYear(x.q[0], x.q[1]) + ", " + (v >= 0 ? t("kept {amount}", { amount: f0(v) }) : t("overspent {amount}", { amount: f0(-v) }))) + '"' + (on ? ' aria-current="true"' : "") + "></button>";
  }).join("") + '</div><div class="ax" aria-hidden="true">' + hist.map((x) => "<span" + (same(x.q, q) ? ' class="on"' : "") + ">" + esc(narrow(x.q)) + "</span>").join("") + "</div></div>";
}
/* The four totals, each against the month before */
function tiles(m) {
  const { s, prev } = m, PM = monthOnly(m.pq);
  const tl = (label, cur, p, goodUp) => '<div class="w-mrtile"><span>' + label + '</span><b class="amt">' + f0(cur) + "</b>" + (prev ? cmpPrev(cur, p, goodUp, PM) : "") + "</div>";
  return '<div class="w-mrtiles">' + tl(t("Came in"), s.inc, prev && prev.inc, true) + tl(t("Went out"), s.exp, prev && prev.exp, false) +
    tl(t("Bills"), s.bills, prev && prev.bills, false) + tl(t("Everyday"), s.day, prev && prev.day, false) + "</div>";
}
/* "Same as September", "283 € less" */
function cmpPrev(cur, prev, goodUp, month) {
  const d = cur - prev;
  if (Math.abs(d) < Math.max(5, Math.abs(prev) * 0.03)) return '<span class="w-mrd">' + t("Same as {month}", { month }) + "</span>";
  const amount = f0(Math.abs(d));
  return '<span class="w-mrd ' + ((d > 0) === goodUp ? "good" : "bad") + '">' + (d > 0 ? t("{amount} more", { amount }) : t("{amount} less", { amount })) + "</span>";
}
/* Who the bar belongs to, in the legend's order: the first person, shared, then the others */
export function splitParts(m, k) {
  const o = m.parts[k] || { sh: 0 }, ids = state.people.map((p) => String(p.id));
  const out = [];
  ids.forEach((id, i) => { if (i === 1) out.push({ cls: "sh", v: o.sh }); out.push({ cls: "p" + Math.min(i, 5), v: o[id] || 0, id }); });
  if (ids.length < 2) out.push({ cls: "sh", v: o.sh });
  return out.filter((x) => x.v > 0.005);
}
export function splitBar(m, k, width) {
  return '<span class="w-mrsplit" style="width:' + width + '%">' + splitParts(m, k).map((x) => '<i class="' + x.cls + '" style="flex:' + x.v.toFixed(2) + '"></i>').join("") + "</span>";
}
export function splitKey() {
  if (!couple()) return "";
  const ppl = state.people.map((p, i) => '<span><i class="p' + Math.min(i, 5) + '"></i>' + esc(p.name) + "</span>");
  ppl.splice(1, 0, '<span><i class="sh"></i>' + t("Shared") + "</span>");
  return '<span class="w-mrkey">' + ppl.join("") + "</span>";
}
/* Against usual, in a word or two */
function vsUsual(m, k) { return m.cu[k] ? cmp(m.c[k], m.cu[k], false, "", true) : m.u.n ? '<span class="w-mrd">' + t("New") + "</span>" : "<span></span>"; }
function whereRows(m) {
  const { c, keys } = m;
  if (!keys.length) return '<p class="w-hint">' + t("No spending this month.") + "</p>";
  const top = c[keys[0]];
  return '<div class="w-mrwhere">' + keys.map((k) => '<a class="w-mrwrow" href="/transactions?month=' + mkey(m.q) + "&cat=" + encodeURIComponent(k) + '" data-link data-cat="' + esc(k) + '">' +
    '<span class="n">' + tile(k, 30) + "<b>" + catName(k) + "</b></span>" + '<span class="bar">' + splitBar(m, k, ((c[k] / top) * 100).toFixed(1)) + "</span>" +
    '<b class="amt">' + f0(c[k]) + "</b>" + vsUsual(m, k) + "</a>").join("") + "</div>";
}
/* What changed: up on one side, down on the other */
function changedItem(m, x, up) {
  const big = up ? m.biggestIn(x.k) : null, amount = f0(Math.abs(x.d));
  return '<div class="w-mrchg">' + tile(x.k, 36) + "<div><b>" + (up ? t("{category}, {amount} more", { category: catName(x.k), amount }) : t("{category}, {amount} less", { category: catName(x.k), amount })) + "</b><p>" +
    (big ? t("Biggest: {name}, {amount} on {date}", { name: esc(big.n || cat(big.c).n), amount: f0(amt(big, m.sc)), date: esc(dlab(big.d)) })
      : (m.c[x.k] ? t("{amount} this month, usually about {usual}", { amount: f0(m.c[x.k] || 0), usual: f0(m.cu[x.k] || 0) }) : t("Nothing this month, usually about {usual}", { usual: f0(m.cu[x.k] || 0) }))) + "</p></div></div>";
}
function changed(m) {
  if (!m.u.n) return '<p class="w-hint"><b>' + t("The first month") + "</b> " + t("Next month Wally compares against this one.") + "</p>";
  if (!m.ups.length && !m.downs.length) return '<p class="w-hint"><b>' + t("A steady month") + "</b> " + t("Every category was close to usual.") + "</p>";
  return '<div class="w-mrchgs"><div>' + m.ups.map((x) => changedItem(m, x, true)).join("") + "</div><div>" + m.downs.map((x) => changedItem(m, x, false)).join("") + "</div></div>";
}
/* Each of you: earned, spent with their share, kept, against the month before */
function person(m, key) {
  const { a, b, sc } = m, PM = monthOnly(m.pq);
  const tt = totals(a, b, key), kept = tt.net >= 0;
  const pe = m.hasPrev ? totals(...bounds(m.pq), key).exp : null;
  const kv = (k, v) => '<div class="w-mrkv"><span>' + k + "</span><b>" + v + "</b></div>";
  return '<div class="w-mrpc' + (sc !== "all" && sc !== key ? " dim" : "") + '"><div class="h">' + av(key, "lg") + "<b>" + esc(pname(key)) + '</b><span class="' + (kept ? "good" : "bad") + '">' +
      (kept ? t("Kept {amount}", { amount: f0(tt.net) }) : t("Over by {amount}", { amount: f0(-tt.net) })) + "</span></div>" +
    kv(t("Earned"), '<span class="amt">' + f0(tt.inc) + "</span>") + kv(t("Spent, with their share"), '<span class="amt">' + f0(tt.exp) + "</span>") +
    (pe !== null ? kv(t("Against {month}", { month: PM }), cmp(tt.exp, pe, false, PM, true)) : "") + "</div>";
}
/* Day by day, as four facts */
export function dayRows(m) {
  const ratio = m.weekday > 0.005 ? t("{x}× a weekday", { x: (m.weekend / m.weekday).toLocaleString(document.documentElement.lang, { maximumFractionDigits: 1, minimumFractionDigits: 1 }) }) : "–";
  return [[t("Days without spending"), m.best > 1 ? t("{n}, longest run {run}", { n: m.ns, run: m.best }) : String(m.ns)]]
    .concat(m.vals[m.peak] > 0 ? [[t("Busiest day"), esc(dlabW(ds(m.q[0], m.q[1], m.peak + 1))) + " · " + f0(m.vals[m.peak])]] : [])
    .concat([[t("Average day"), f0(m.s.day / m.D)], [t("A weekend day costs"), ratio]]);
}
/* Bills: this month, against the one before, and the next */
export function billRows(m) {
  const PM = m.hasPrev ? monthOnly(m.pq) : null, nx = m.next;
  const rows = [[t("In {month}", { month: monthOnly(m.q) }), tn(m.billsN, "{n} bill", "{n} bills") + " · " + f0(m.s.bills)]];
  if (PM) rows.push([t("Against {month}", { month: PM }), m.changes.length ? m.changes.slice(0, 2).map((x) => x.h).join(", ") + (m.changes.length > 2 ? " " + tn(m.changes.length - 2, "and {n} more", "and {n} more") : "") : t("Same bills, same prices")]);
  rows.push([esc(monthOnly(m.nq)), nx.n ? (nx.first ? t("{amount}, first {name} on {date}", { amount: f0(nx.sum), name: esc(nx.first.n), date: esc(dlab(nx.first.d)) }) : f0(nx.sum)) : t("No bills")]);
  return rows;
}
const kvList = (rows) => rows.map(([k, v]) => '<div class="w-mrkv"><span>' + k + "</span><b>" + v + "</b></div>").join("");
/* Small things worth knowing */
export function highlights(m) {
  const { big, pay, topPay, tg, topTag, extra, sc } = m;
  return [
    [t("Biggest purchase"), big ? esc(big.n || cat(big.c).n) + ", " + f0(amt(big, sc)) : t("None"), big ? catName(big.c) + ", " + esc(dlab(big.d)) : ""],
    [t("Most visits"), topPay ? esc(topPay) : t("None"), topPay ? tn(pay[topPay].k, "{n} time, {amount}", "{n} times, {amount}", { amount: f0(pay[topPay].s) }) : ""],
    [t("Top tag"), topTag ? esc(topTag) : t("No tags"), topTag ? tn(tg[topTag].k, "{n} time, {amount}", "{n} times, {amount}", { amount: f0(tg[topTag].s) }) : ""],
    [t("Extra income"), extra.length ? f0(extra.reduce((v, x) => v + amt(x, sc), 0)) : t("None"),
      extra.length ? extra.slice(0, 3).map((x) => esc(x.n || cat(x.c).n)).join(", ") : t("Only the usual")],
  ];
}
const knowTiles = (m) => '<div class="w-mrtiles">' + highlights(m).map((x) => '<div class="w-mrtile k"><span>' + x[0] + "</span><b>" + x[1] + "</b>" + (x[2] ? '<span class="s">' + x[2] + "</span>" : "") + "</div>").join("") + "</div>";

/* ---------- desktop and tablet: one sheet, top to bottom ---------- */
function desktop(m) {
  const { s } = m;
  const sec = (id, title, body, extra) => '<section class="w-mrs" aria-labelledby="' + id + '"><div class="w-mrsh2"><h2 id="' + id + '">' + title + "</h2>" + (extra || "") + "</div>" + body + "</section>";
  let html = header(m) +
    '<section class="w-mrs w-mrtop" aria-label="' + esc(t("Summary")) + '"><div class="w-mrhero"><div><span class="k">' + (s.net >= 0 ? t("Kept") : t("Overspent")) + '</span><div class="big amt' + (s.net < 0 ? " neg" : "") + '">' + f0(Math.abs(s.net)) + "</div><p>" + m.head + "</p></div>" +
    keptBars(m) + "</div>" + tiles(m) + "</section>";
  html += sec("mr-where", t("Where it went"), whereRows(m) + (couple() ? '<p class="w-mrnote" id="mr-shared">' + sharedText(m) + "</p>" : ""), splitKey());
  html += sec("mr-chg", t("What changed"), changed(m));
  if (couple()) html += sec("mr-ppl", t("Each of you"), '<div class="w-mrpcs">' + state.people.map((p) => person(m, String(p.id))).join("") + "</div>");
  html += '<div class="w-mr2"><section class="w-mrcol" aria-labelledby="mr-days"><h2 id="mr-days">' + t("Day by day") + "</h2>" + kvList(dayRows(m)) + "</section>" +
    '<section class="w-mrcol" aria-labelledby="mr-bills"><h2 id="mr-bills">' + t("Bills") + "</h2>" + kvList(billRows(m)) + "</section></div>";
  html += sec("mr-know", t("Worth knowing"), knowTiles(m));
  html += '<footer class="w-mrf"><a class="w-btn ghost" href="/transactions?month=' + mkey(m.q) + '" data-link>' + t("See transactions") + '</a><a class="w-btn primary" href="/?month=' + mkey(m.q) + '" data-link>' + t("Open in Summary") + "</a></footer>";
  return html;
}

/* Shared costs this month, and who paid them */
export function sharedText(m) {
  const { a, b } = m, by = {};
  let n = 0, tot = 0;
  for (const x of state.tx) {
    if (x.p !== null || x.type !== "expense" || x.d < a || x.d > b) continue;
    n++; tot += x.a;
    if (x.by) by[x.by] = (by[x.by] || 0) + x.a;
  }
  if (!n) return t("No shared costs this month.");
  let text = tn(n, "{amount} in {n} shared cost.", "{amount} in {n} shared costs.", { amount: f0(tot) });
  const payers = state.people.filter((p) => by[String(p.id)]).map((p) => t("{name} paid {amount}", { name: esc(p.name), amount: f0(by[String(p.id)]) }));
  if (payers.length) text += " " + payers.join(", ") + ".";
  return text;
}

function wireDesktop(m) {
  const PM = monthOnly(m.pq), M = monthOnly(m.q);
  root.querySelectorAll("[data-cat]").forEach((x) => {
    const k = x.dataset.cat;
    hover(x, () => "<b>" + catName(k) + ", " + esc(M) + "</b>" + splitParts(m, k).map((p) => row(p.cls === "sh" ? t("Shared") : esc(pname(p.id)), f(p.v))).join("") +
      (m.hasPrev ? row(esc(PM), f(m.cp[k] || 0)) : "") + (m.u.n ? row(t("Usual"), f(m.cu[k] || 0)) : ""));
  });
  root.querySelectorAll("[data-mrm]").forEach((x) => {
    const h = m.hist.find((y) => mkey(y.q) === x.dataset.mrm);
    if (!h) return;
    hover(x, "<b>" + esc(monthYear(h.q[0], h.q[1])) + "</b>" + row(t("Came in"), f(h.s.inc)) + row(t("Went out"), f(h.s.exp)) + row(h.s.net >= 0 ? t("Kept") : t("Overspent"), f(Math.abs(h.s.net))));
    x.addEventListener("click", (ev) => { ev.stopPropagation(); hideTip(); goMonth(h.q); });
  });
}

/* ---------- phone: pages to tap or swipe through, in the same order ---------- */
function phoneStory(m) {
  const { s, keys, c } = m;
  const pageWrap = (i, label, body) => '<section class="w-mrsp" data-sp="' + i + '"' + (i === story ? "" : " hidden") + ' aria-label="' + esc(t("Page {n} of {total}: {title}", { n: i + 1, total: STORY, title: label })) + '">' + body + "</section>";
  const pages = [];
  pages.push([t("Kept"), '<div class="w-pmr"><span class="k">' + (s.net >= 0 ? t("Kept") : t("Overspent")) + '</span><div class="big amt' + (s.net < 0 ? " neg" : "") + '">' + f0(Math.abs(s.net)) + "</div><p>" + m.head + "</p></div>" +
    keptBars(m, "ph") + tiles(m)]);
  const top = keys.length ? c[keys[0]] : 1;
  pages.push([t("Where it went"), '<h2 class="w-mrsh">' + t("Where it went") + "</h2>" + splitKey() +
    (keys.length ? '<div class="w-mrcard">' + keys.slice(0, 6).map((k) => '<a class="w-mrpw" href="/transactions?month=' + mkey(m.q) + "&cat=" + encodeURIComponent(k) + '" data-link><span class="top">' + tile(k, 30) + "<b>" + catName(k) + '</b><span class="amt">' + f0(c[k]) + "</span></span>" +
      splitBar(m, k, ((c[k] / top) * 100).toFixed(1)) + vsUsual(m, k) + "</a>").join("") + "</div>" : '<p class="w-hint">' + t("No spending this month.") + "</p>") +
    (couple() ? '<p class="w-mrnote">' + sharedText(m) + "</p>" : "")]);
  pages.push([t("What changed"), '<h2 class="w-mrsh">' + t("What changed") + "</h2>" + changed(m)]);
  if (couple()) pages.push([t("Each of you"), '<h2 class="w-mrsh">' + t("Each of you") + '</h2><div class="w-mrpcs">' + state.people.map((p) => person(m, String(p.id))).join("") + "</div>"]);
  pages.push([t("Day by day"), '<h2 class="w-mrsh">' + t("Day by day") + '</h2><div class="w-mrcard">' + kvList(dayRows(m)) + "</div>" +
    '<h2 class="w-mrsh sm">' + t("Bills") + '</h2><div class="w-mrcard">' + kvList(billRows(m)) + "</div>" +
    '<h2 class="w-mrsh sm">' + t("Worth knowing") + "</h2>" + knowTiles(m) +
    '<div class="w-mrsfoot"><a class="w-btn ghost" href="/transactions?month=' + mkey(m.q) + '" data-link>' + t("See transactions") + '</a><a class="w-btn primary" href="/?month=' + mkey(m.q) + '" data-link>' + t("Open in Summary") + "</a></div>"]);
  const bars = '<div class="w-story" aria-hidden="true">' + pages.map((x, i) => '<i class="' + (i <= story ? "on" : "") + '"></i>').join("") + "</div>";
  return '<div class="w-mrstory" aria-roledescription="' + esc(t("story")) + '">' + bars +
    '<div class="w-mrstop"><span class="w-mrsm">' + esc(monthYear(m.q[0], m.q[1])) + "</span>" + tools(m, false) + "</div>" +
    scopeSeg(m) +
    '<div class="w-mrspages" id="mr-pages">' + pages.map((x, i) => pageWrap(i, x[0], x[1])).join("") + "</div>" +
    '<div class="w-mrsctl"><button type="button" class="w-mrsback" id="mr-sback"' + (story ? "" : " hidden") + ">" + t("Back") + '</button><span class="w-mrsn" aria-live="polite">' + t("{n} of {total}", { n: story + 1, total: STORY }) + "</span>" +
    '<button type="button" class="w-btn primary" id="mr-snext"' + (story < STORY - 1 ? "" : " hidden") + ">" + t("Tap for more") + "</button></div></div>";
}
function setStory(i) {
  story = Math.max(0, Math.min(STORY - 1, i));
  const box = root && root.querySelector(".w-mrstory");
  if (!box) return;
  box.querySelectorAll("[data-sp]").forEach((p) => { p.hidden = +p.dataset.sp !== story; });
  box.querySelectorAll(".w-story i").forEach((b, k) => b.classList.toggle("on", k <= story));
  box.querySelector("#mr-sback").hidden = story === 0;
  box.querySelector("#mr-snext").hidden = story === STORY - 1;
  box.querySelector(".w-mrsn").textContent = t("{n} of {total}", { n: story + 1, total: STORY });
  window.scrollTo(0, 0);
}
function wireStory() {
  const box = root.querySelector(".w-mrstory");
  if (!box) return;
  box.querySelector("#mr-sback").addEventListener("click", () => { setStory(story - 1); box.querySelector(story ? "#mr-sback" : "#mr-snext").focus(); });
  box.querySelector("#mr-snext").addEventListener("click", () => { setStory(story + 1); box.querySelector(story < STORY - 1 ? "#mr-snext" : "#mr-sback").focus(); });
  const pages = box.querySelector("#mr-pages");
  // Tap the page: the start side goes back, the rest goes on. Links and buttons keep their own job.
  pages.addEventListener("click", (ev) => {
    if (ev.target.closest("a,button")) return;
    const r = pages.getBoundingClientRect(), rtl = document.documentElement.dir === "rtl";
    const startSide = rtl ? ev.clientX > r.right - r.width * 0.3 : ev.clientX < r.left + r.width * 0.3;
    setStory(story + (startSide ? -1 : 1));
  });
  let x0 = null, y0 = null;
  pages.addEventListener("touchstart", (ev) => { x0 = ev.touches[0].clientX; y0 = ev.touches[0].clientY; }, { passive: true });
  pages.addEventListener("touchend", (ev) => {
    if (x0 === null) return;
    const dx = ev.changedTouches[0].clientX - x0, dy = ev.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
    const rtl = document.documentElement.dir === "rtl";
    setStory(story + ((dx < 0) !== rtl ? 1 : -1));
  });
}
