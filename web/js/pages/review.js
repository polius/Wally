/* Month in review (2.1): the month that just closed. What came in, who spent what, and what
   changed against "usual" (the average of the 6 months before). Every figure is worked out here
   from the ledger, for whoever is shown, except the people block, which always shows everyone.
   On a phone it is four pages you tap or swipe through. Route: /review?m=YYYY-MM */
import {
  t, tn, esc, state, f, f0, fk, pct, pad, ds, dim, addD, wd, ym, ymAdd, TODAY, START, totals, byCat, amt,
  tile, cat, av, pname, couple, isIncomeCat, dows, wkOff, dlab, dlabL, dlabW, monthYear, F, savePrefs, icon,
} from "../core.js";
import { hover, row, chart, el, txt, hideTip } from "../ui.js";
import { navigate, setScope, scopeChips } from "../shell.js";
import { occurrences, ruleAmt, ruleHist, shortDesc, isIncome } from "../sched.js";

let root = null;
let shown = null;        // [year, month] on screen
let story = 0;           // phone page, 0 to 3
const STORY = 4;

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
/* Heat levels for the day grid: quantiles of the days with spending */
function levels(vals) {
  const nz = vals.filter((v) => v > 0).sort((a, b) => a - b);
  const q = (p) => nz[Math.floor(p * (nz.length - 1))] || 0;
  const cuts = [q(0.2), q(0.45), q(0.7), q(0.9)];
  return (v) => (v ? 1 + cuts.filter((c) => v > c).length : 0);
}
const catName = (k) => esc(cat(k).n);
/* Who the bars belong to: the designed greys for two people, their avatar colours for more */
function personColor(i) { return state.people.length <= 2 ? (i ? "var(--w-p2)" : "var(--w-p1)") : "var(--av" + (i % 6) + ")"; }

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

  // Categories, coloured by their rank in this month
  const c = byCat(a, b, sc), cu = catUsual(q, sc), cp = hasPrev ? byCat(...bounds(pq), sc) : {};
  const keys = Object.keys(c).filter((k) => c[k] >= 0.5).sort((x, y) => c[y] - c[x]);
  const col = {};
  keys.forEach((k, i) => { col[k] = "var(--c" + (i < 8 ? i + 1 : 9) + ")"; });
  const colOf = (k) => col[k] || "var(--c9)";
  const moved = [...new Set(Object.keys(c).concat(Object.keys(cu)))].filter((k) => !isIncomeCat(k))
    .map((k) => ({ k, d: (c[k] || 0) - (cu[k] || 0) }))
    .filter((x) => u.n && Math.abs(x.d) >= 25 && Math.abs(x.d) >= (cu[x.k] || 0) * 0.15);
  const ups = moved.filter((x) => x.d > 0).sort((x, y) => y.d - x.d).slice(0, 3);
  const downs = moved.filter((x) => x.d < 0).sort((x, y) => x.d - y.d).slice(0, 3);
  const biggestIn = (k) => mine.filter((x) => x.c === k).sort((x, y) => amt(y, sc) - amt(x, sc))[0];

  // The headline
  const who = sc === "all" ? null : pname(sc);
  let head;
  if (s.net >= 0 && s.inc > 0) {
    head = who ? t("{name} kept {amount}, {pct} of what came in.", { name: esc(who), amount: f0(s.net), pct: pct(s.rate) }) : t("You kept {amount}, {pct} of what came in.", { amount: f0(s.net), pct: pct(s.rate) });
    if (hist.length >= 6 && rank <= 3) head += " " + [t("The best month of the last {n}.", { n: hist.length }), t("The second best month of the last {n}.", { n: hist.length }), t("The third best month of the last {n}.", { n: hist.length })][rank - 1];
    else if (u.n && s.net < u.net - 50) head += " " + t("Less than usual, which is about {amount}.", { amount: f0(u.net) });
    else if (u.n && s.net > u.net + 50) head += " " + t("More than usual, which is about {amount}.", { amount: f0(u.net) });
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

  return { q, a, b, D, pq, nq, hasPrev, s, prev, u, hist, c, cu, cp, keys, colOf, ups, downs, biggestIn, head, vals, ns, best, peak, weekday, weekend, billsN, changes, next, big, pay, topPay, tg, topTag, extra, sc };
}

/* ---------- the page ---------- */
export function mount(el, route) {
  root = el;
  shown = clamp(parseMonth(route.query.get("m")));
  story = 0;
  render();
}
export function update() { render(); }
export function unmount() { root = null; }
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
    root.innerHTML = '<div class="w-mrpage"><div class="w-mrev w-mrempty">' + header(null) +
      '<div class="w-empty"><span class="w-empty-i">' + icon("cal") + "</span><b>" + t("No month to review yet") + "</b><p>" +
      t("Month in review looks back at a month once it is over. The first one opens on the 1st of next month.") + '</p><a class="w-btn ghost" href="/" data-link>' + t("Open the Dashboard") + "</a></div></div></div>";
    wireHeader(null);
    return;
  }
  shown = clamp(shown);
  const m = compute(shown, state.scope);
  root.innerHTML = '<div class="w-mrpage"><article class="w-mrev" aria-labelledby="mr-title">' + desktop(m) + "</article>" + phoneStory(m) + "</div>";
  wireHeader(m);
  wireDesktop(m);
  wireStory(m);
  drawChart(m);
}

function goMonth(q) {
  shown = clamp(q);
  story = 0;
  history.replaceState(history.state, "", "/review?m=" + mkey(shown));
  render();
}

/* Title, Household / person, arrows through closed months, close */
function header(m) {
  const q = m ? m.q : lastClosed(), isLast = same(q, lastClosed()), canPrev = m && m.hasPrev;
  const scopeSeg = couple() && m ? '<div class="w-seg sm" role="group" aria-label="' + esc(t("Whose money")) + '">' +
    [["all", t("Household")]].concat(state.people.map((p) => [String(p.id), esc(p.name)])).map(([v, l]) =>
      '<button type="button" data-mrsc="' + v + '" aria-pressed="' + (state.scope === v) + '">' + l + "</button>").join("") + "</div>" : "";
  const nextName = monthOnly(ymAdd(q[0], q[1], 1));
  return '<header class="w-mrh"><span class="w-mark" aria-hidden="true"></span><div class="t"><h1 id="mr-title">' + esc(monthYear(q[0], q[1])) + "</h1><p>" +
    (m ? t("Month in review, {from} to {to}", { from: esc(dlab(m.a)), to: esc(dlab(m.b)) }) : t("Month in review")) + "</p></div>" + scopeSeg +
    (m ? '<div class="w-mrstep"><button type="button" id="mr-prev" aria-label="' + esc(t("Previous month")) + '"' + (canPrev ? "" : " disabled") + ">" + icon("left") + "</button>" +
      '<button type="button" id="mr-next" aria-label="' + esc(t("Next month")) + '"' + (isLast ? ' disabled title="' + esc(t("{month} is not over yet", { month: nextName })) + '"' : "") + ">" + icon("right") + "</button></div>" : "") +
    '<button type="button" class="w-x" data-mr-close aria-label="' + esc(t("Close")) + '">' + icon("x") + "</button></header>";
}
function wireHeader(m) {
  root.querySelectorAll("[data-mr-close]").forEach((b) => b.addEventListener("click", () => navigate("/")));
  root.querySelectorAll("[data-mrsc]").forEach((b) => b.addEventListener("click", () => setScope(b.dataset.mrsc)));
  if (!m) return;
  root.querySelectorAll("#mr-prev,[data-mr-prev]").forEach((b) => b.addEventListener("click", () => goMonth(m.pq)));
  root.querySelectorAll("#mr-next,[data-mr-next]").forEach((b) => b.addEventListener("click", () => goMonth(m.nq)));
}

/* ---------- desktop and tablet ---------- */
function desktop(m) {
  const { s, prev, u } = m, PM = monthOnly(m.pq);
  const kpi = (label, cur, p, us, goodUp) => "<div><span>" + label + "</span><b>" + f0(cur) + "</b>" + (prev ? cmp(cur, p, goodUp, PM) : "") +
    (u.n ? "<small>" + t("Usual {amount}", { amount: f0(us) }) + "</small>" : "") + "</div>";
  let html = header(m) +
    '<section class="w-mrs" aria-label="' + esc(t("Summary")) + '"><div class="w-mrhero"><div><span class="k">' + (s.net >= 0 ? t("Kept") : t("Overspent")) + '</span><div class="big amt' + (s.net < 0 ? " neg" : "") + '">' + f0(Math.abs(s.net)) + "</div><p>" + m.head + "</p></div>" +
    '<div><div class="cv" id="mr-c12"></div><div class="w-mrcap">' + (u.n ? t("Money kept, last {n} months. The dashed line is the 6-month average. Click a month to open it.", { n: m.hist.length }) : t("Money kept, last {n} months. Click a month to open it.", { n: m.hist.length })) + "</div></div></div>" +
    '<div class="w-mrk">' + kpi(t("Came in"), s.inc, prev && prev.inc, u.inc, true) + kpi(t("Went out"), s.exp, prev && prev.exp, u.exp, false) +
      kpi(t("Bills"), s.bills, prev && prev.bills, u.bills, false) + kpi(t("Everyday spending"), s.day, prev && prev.day, u.day, false) + "</div></section>";
  if (couple()) html += peopleSection(m);
  html += '<div class="w-mr2"><section class="w-mrcol" aria-labelledby="mr-where"><h2 id="mr-where">' + t("Where it went") + "<small>" + t("Colours follow this month’s ranking") + "</small></h2>" + catTable(m) + "</section>" +
    '<section class="w-mrcol" aria-labelledby="mr-chg"><h2 id="mr-chg">' + t("What changed") + "<small>" + (m.u.n ? t("Against the {n} months before", { n: m.u.n }) : t("Nothing to compare with yet")) + "</small></h2>" + movers(m) + "</section></div>";
  html += '<div class="w-mr2"><section class="w-mrcol" aria-labelledby="mr-days"><h2 id="mr-days">' + t("Day by day") + "<small>" + (m.sc === "all" ? t("Household, without bills") : t("{name}, without bills", { name: esc(pname(m.sc)) })) + "</small></h2>" + dayGrid(m, "mrd") + dayFacts(m) + "</section>" +
    '<section class="w-mrcol" aria-labelledby="mr-bills"><h2 id="mr-bills">' + t("Bills") + "<small>" + tn(m.billsN, "{n} payment, {amount}", "{n} payments, {amount}", { amount: f0(s.bills) }) + "</small></h2>" + bills(m) + "</section></div>";
  html += '<section class="w-mrs" aria-labelledby="mr-know"><h2 id="mr-know">' + t("Worth knowing") + '</h2><div class="w-mrhl">' + highlights(m).map((x) => "<div><span>" + x[0] + "</span><b>" + x[1] + "</b><p>" + x[2] + "</p></div>").join("") + "</div></section>";
  html += '<footer class="w-mrf"><span class="w-hint">' + t("Shown once each month, to each person, when they first open Wally. Any month opens again from the Dashboard.") + '</span><div><a class="w-btn ghost" href="/transactions?ym=' + mkey(m.q) + '" data-link>' + t("See transactions") + '</a><a class="w-btn primary" href="/?ym=' + mkey(m.q) + '" data-link>' + t("Open on the Dashboard") + "</a></div></footer>";
  return html;
}

function names() {
  const n = state.people.map((p) => esc(p.name));
  return n.length === 2 ? t("{a} and {b}", { a: n[0], b: n[1] }) : t("Everyone");
}
function personCard(m, key) {
  const { a, b, sc } = m, PM = monthOnly(m.pq);
  const tt = totals(a, b, key), pc = {};
  let own = 0, paid = 0, big = null;
  for (const x of state.tx) {
    if (x.type !== "expense" || x.d < a || x.d > b) continue;
    const v = amt(x, key);
    if (v && !x.rec) pc[x.c] = (pc[x.c] || 0) + v;
    if (x.p === key) { own += x.a; if (!x.rec && (!big || x.a > big.a)) big = x; }
    if (x.p === null && x.by === key) paid += x.a;
  }
  const top = Object.keys(pc).sort((x, y) => pc[y] - pc[x])[0];
  const pe = m.hasPrev ? totals(...bounds(m.pq), key).exp : null;
  const spent = tt.inc ? Math.min(tt.exp / tt.inc, 1) : 1, kept = tt.net >= 0;
  const fact = (k, v) => "<li><span>" + k + "</span><b>" + v + "</b></li>";
  return '<div class="w-mrp' + (sc !== "all" && sc !== key ? " dim" : "") + '"><div class="w-mrph">' + av(key, "lg") + "<b>" + esc(pname(key)) + '</b><span class="w-pill ' + (kept ? "good" : "bad") + '">' +
      (kept ? (tt.inc ? t("Kept {pct}", { pct: pct(tt.rate) }) : t("Nothing spent")) : t("Over by {amount}", { amount: f0(-tt.net) })) + "</span></div>" +
    '<div class="w-mrtrio"><div><span>' + t("Earned") + '</span><b class="amt">' + f0(tt.inc) + "</b></div><div><span>" + t("Spent") + '</span><b class="amt">' + f0(tt.exp) + "</b></div><div><span>" + (kept ? t("Kept") : t("Over")) + '</span><b class="amt" style="color:var(--w-' + (kept ? "good" : "bad") + ')">' + f0(Math.abs(tt.net)) + "</b></div></div>" +
    '<div class="w-mrrate" role="img" aria-label="' + esc(t("{name} spent {spent} of {earned}", { name: pname(key), spent: f0(tt.exp), earned: f0(tt.inc) })) + '"><span style="flex:' + spent + ';background:var(--w-p2)"></span><span style="flex:' + (1 - spent) + ';background:var(--w-good)"></span></div>' +
    '<ul class="w-mrfacts">' + fact(t("On their own"), f0(own)) + fact(t("Their share of shared costs"), f0(tt.exp - own)) + fact(t("Paid for shared costs"), f0(paid)) +
      (top ? fact(t("Most on, not counting bills"), catName(top) + ", " + f0(pc[top])) : "") +
      (big ? fact(t("Biggest purchase"), esc(big.n || cat(big.c).n) + ", " + f0(big.a)) : "") +
      (pe !== null ? "<li><span>" + t("Against {month}", { month: PM }) + "</span>" + cmp(tt.exp, pe, false, PM) + "</li>" : "") + "</ul></div>";
}
function peopleSection(m) {
  const { a, b } = m, ids = state.people.map((p) => String(p.id));
  // Who spent on what: the whole household, by category; each person's own, and shared
  const ws = {};
  for (const x of state.tx) {
    if (x.type !== "expense" || x.d < a || x.d > b) continue;
    const o = (ws[x.c] = ws[x.c] || { sh: 0, tot: 0 });
    if (x.p === null) o.sh += x.a; else o[x.p] = (o[x.p] || 0) + x.a;
    o.tot += x.a;
  }
  const wk = Object.keys(ws).filter((k) => ws[k].tot >= 0.5).sort((x, y) => ws[y].tot - ws[x].tot), wmax = wk.length ? ws[wk[0]].tot : 1;
  const W = (v) => ((v / wmax) * 100).toFixed(2) + "%";
  const rows = wk.map((k) => {
    const o = ws[k];
    const segs = ids.map((id, i) => (o[id] ? '<span style="width:' + W(o[id]) + ";background:" + personColor(i) + '"></span>' : ""));
    // Shared sits between the first person and the others, as in the legend
    const bar = segs[0] + (o.sh ? '<span class="hatch" style="width:' + W(o.sh) + '"></span>' : "") + segs.slice(1).join("");
    return '<div class="w-mrwr" tabindex="0" data-ws="' + esc(k) + '"><span>' + catName(k) + '</span><div class="bar">' + bar + '</div><b class="amt">' + f0(o.tot) + "</b></div>";
  }).join("");
  const legend = state.people.map((p, i) => '<span><s style="background:' + personColor(i) + '"></s>' + t("{name} only", { name: esc(p.name) }) + "</span>");
  legend.splice(1, 0, '<span><s class="hatch"></s>' + t("Shared") + "</span>");
  return '<section class="w-mrs" aria-labelledby="mr-ppl"><h2 id="mr-ppl">' + names() + "<small>" + t("Each person’s spending includes their share of shared costs") + "</small></h2>" +
    '<div class="w-mrpp">' + ids.map((id) => personCard(m, id)).join("") + "</div>" +
    '<h2 class="w-mrh2">' + t("Who spent on what") + "<small>" + t("The whole household, by category") + '</small></h2><div class="w-legend">' + legend.join("") + "</div>" +
    (rows ? '<div class="w-mrws">' + rows + "</div>" : '<p class="w-hint">' + t("No spending this month.") + "</p>") +
    '<div class="w-mrshared">' + av(null) + '<span id="mr-shared">' + sharedText(m) + "</span></div></section>";
}
/* Shared costs this month, and who paid them */
function sharedText(m) {
  const { a, b } = m, by = {};
  let n = 0, tot = 0;
  for (const x of state.tx) {
    if (x.p !== null || x.type !== "expense" || x.d < a || x.d > b) continue;
    n++; tot += x.a;
    if (x.by) by[x.by] = (by[x.by] || 0) + x.a;
  }
  if (!n) return t("No shared costs this month.");
  let text = tn(n, "{amount} in {n} shared cost.", "{amount} in {n} shared costs.", { amount: "<b>" + f0(tot) + "</b>" });
  const payers = state.people.filter((p) => by[String(p.id)]).map((p) => t("{name} paid {amount}", { name: esc(p.name), amount: f0(by[String(p.id)]) }));
  if (payers.length) text += " " + payers.join(", ") + ".";
  return text;
}

function catTable(m) {
  const { c, keys, cu, s, colOf } = m;
  if (!keys.length) return '<p class="w-hint">' + t("No spending this month.") + "</p>";
  return '<div class="w-mrcat"><div class="w-mrcr hd" aria-hidden="true"><span></span><span>' + t("Category") + "</span><span></span><span>" + esc(F.mon[m.q[1] - 1]) + "</span><span>" + t("Against usual") + "</span></div>" +
    keys.map((k) => '<a class="w-mrcr" href="/transactions?ym=' + mkey(m.q) + "&cat=" + encodeURIComponent(k) + '" data-link data-cat="' + esc(k) + '">' + tile(k, 26, colOf(k)) +
      '<span class="n"><b>' + catName(k) + "</b><small>" + t("{pct} of spending", { pct: pct(c[k] / (s.exp || 1)) }) + '</small></span><span class="bar" aria-hidden="true"><span style="width:' + ((c[k] / c[keys[0]]) * 100).toFixed(1) + "%;background:" + colOf(k) + '"></span></span><b class="amt">' + f0(c[k]) + "</b>" +
      (cu[k] ? cmp(c[k], cu[k], false, "", true) : m.u.n ? '<span class="w-mrd">' + t("New") + "</span>" : "<span></span>") + "</a>").join("") + "</div>";
}
function moverItem(m, x, up) {
  const big = up ? m.biggestIn(x.k) : null, amount = f0(Math.abs(x.d));
  return '<div class="w-li">' + tile(x.k, null, m.colOf(x.k)) + "<div><h6>" + (up ? t("{category}, {amount} more", { category: catName(x.k), amount }) : t("{category}, {amount} less", { category: catName(x.k), amount })) + "</h6><p>" +
    (big ? t("Biggest: {name}, {amount} on {date}.", { name: esc(big.n || cat(big.c).n), amount: f0(amt(big, m.sc)), date: esc(dlab(big.d)) })
      : t("{amount} this month, usually about {usual}.", { amount: f0(m.c[x.k] || 0), usual: f0(m.cu[x.k] || 0) })) + "</p></div></div>";
}
function movers(m) {
  if (!m.u.n) return '<div class="w-empty"><b>' + t("The first month") + "</b>" + t("Next month Wally compares against this one.") + "</div>";
  const html = (m.ups.length ? '<div class="w-mrmv"><h3>' + t("Up") + "</h3>" + m.ups.map((x) => moverItem(m, x, true)).join("") + "</div>" : "") +
    (m.downs.length ? '<div class="w-mrmv"><h3>' + t("Down") + "</h3>" + m.downs.map((x) => moverItem(m, x, false)).join("") + "</div>" : "");
  return html || '<div class="w-empty"><b>' + t("A steady month") + "</b>" + t("Every category was close to usual.") + "</div>";
}
function dayGrid(m, cls) {
  const lv = levels(m.vals);
  let cells = dows(true).map((d) => '<span class="dow" aria-hidden="true">' + esc(d) + "</span>").join("");
  for (let j = 0; j < wkOff(m.a); j++) cells += '<span aria-hidden="true"></span>';
  m.vals.forEach((v, i) => {
    const d = ds(m.q[0], m.q[1], i + 1), L = lv(v);
    cells += '<a class="c' + (L >= 4 ? " hi" : "") + (v < 0.005 ? " z" : "") + '" href="/transactions?day=' + d + '" data-link data-d="' + d + '" style="background:var(--h' + L + ')" aria-label="' + esc(dlabL(d) + ", " + (v < 0.005 ? t("no spending") : t("spent {amount}", { amount: f(v) }))) + '">' + (i + 1) + "</a>";
  });
  return '<div class="w-mrcal ' + cls + '">' + cells + "</div>";
}
function dayFacts(m) {
  const fact = (k, v) => "<li><span>" + k + "</span><b>" + v + "</b></li>";
  const ratio = m.weekday > 0.005 ? t("{x}× a weekday", { x: (m.weekend / m.weekday).toLocaleString(document.documentElement.lang, { maximumFractionDigits: 1, minimumFractionDigits: 1 }) }) : "–";
  return '<ul class="w-mrfacts">' + fact(t("No-spend days"), m.best > 1 ? t("{n}, longest run {run}", { n: m.ns, run: m.best }) : String(m.ns)) +
    (m.vals[m.peak] > 0 ? fact(t("Busiest day"), esc(dlabW(ds(m.q[0], m.q[1], m.peak + 1))) + ", " + f0(m.vals[m.peak])) : "") +
    fact(t("Average day"), f0(m.s.day / m.D)) + fact(t("A weekend day costs"), ratio) + "</ul>";
}
function bills(m) {
  const PM = m.hasPrev ? monthOnly(m.pq) : null;
  const list = m.changes.length ? m.changes.map((x) => '<div class="w-li">' + tile(x.c) + "<div><h6>" + x.h + "</h6><p>" + x.p + "</p></div></div>").join("")
    : '<div class="w-empty"><b>' + t("No changes") + "</b>" + (PM ? t("Same bills, same prices as {month}.", { month: PM }) : t("Same bills, same prices as before.")) + "</div>";
  const nx = m.next;
  const nextLine = nx.n ? tn(nx.n, "{amount} in {n} bill.", "{amount} in {n} bills.", { amount: f0(nx.sum) }) + (nx.first ? " " + t("First: {name} on {date}.", { name: esc(nx.first.n), date: esc(dlab(nx.first.d)) }) : "") : t("No bills.");
  return list + '<div class="w-mrshared w-mrnext">' + icon("cal") + "<span><b>" + esc(monthOnly(m.nq)) + ":</b> " + nextLine + "</span></div>";
}
function highlights(m) {
  const { big, pay, topPay, tg, topTag, extra, sc } = m;
  return [
    [t("Biggest purchase"), big ? esc(big.n || cat(big.c).n) + ", " + f0(amt(big, sc)) : t("None"), big ? catName(big.c) + ", " + esc(dlabL(big.d)) + "." : ""],
    [t("Most visits"), topPay ? esc(topPay) : t("None"), topPay ? tn(pay[topPay].k, "{n} time, {amount} in all.", "{n} times, {amount} in all.", { amount: f0(pay[topPay].s) }) : ""],
    [t("Top tag"), topTag ? esc(topTag) : t("No tags"), topTag ? tn(tg[topTag].k, "{n} time, {amount} in all.", "{n} times, {amount} in all.", { amount: f0(tg[topTag].s) }) : t("Tags added while adding show up here.")],
    [t("Extra income"), extra.length ? f0(extra.reduce((v, x) => v + amt(x, sc), 0)) : t("Regular income only"),
      extra.length ? t("{names}, on top of regular income.", { names: extra.slice(0, 3).map((x) => esc(x.n || cat(x.c).n)).join(", ") }) : t("Nothing beyond the regular income.")],
  ];
}
function wireDesktop(m) {
  const PM = monthOnly(m.pq), M = monthOnly(m.q);
  root.querySelectorAll(".w-mrev [data-cat]").forEach((x) => {
    const k = x.dataset.cat;
    hover(x, () => "<b>" + catName(k) + ", " + esc(M) + "</b>" + row(t("Spent"), f(m.c[k]), m.colOf(k)) + (m.hasPrev ? row(esc(PM), f(m.cp[k] || 0)) : "") + (m.u.n ? row(t("Usual"), f(m.cu[k] || 0)) : ""));
  });
  root.querySelectorAll("[data-ws]").forEach((x) => {
    const k = x.dataset.ws, { a, b } = m, o = { sh: 0 };
    for (const tx of state.tx) { if (tx.type !== "expense" || tx.d < a || tx.d > b || tx.c !== k) continue; if (tx.p === null) o.sh += tx.a; else o[tx.p] = (o[tx.p] || 0) + tx.a; }
    hover(x, () => "<b>" + catName(k) + "</b>" + state.people.map((p, i) => row(t("{name} only", { name: esc(p.name) }), f(o[String(p.id)] || 0), personColor(i))).join("") + row(t("Shared"), f(o.sh)));
  });
  root.querySelectorAll(".w-mrev [data-d]").forEach((x) => {
    const d = x.dataset.d;
    hover(x, () => "<b>" + esc(dlabL(d)) + "</b>" + row(t("Spent"), f(m.vals[+d.slice(8) - 1])));
  });
}

/* One bar per month of money kept; the month shown in colour */
function drawChart(m) {
  const { hist, u, q } = m;
  const label = t("Money kept, last {n} months", { n: hist.length }) + ": " + hist.map((x) => monthYear(x.q[0], x.q[1]) + " " + f0(x.s.net)).join(", ");
  chart("mr-c12", 150, (svg, w, h) => {
    const mg = { l: 6, r: 6, t: 20, b: 22 };
    const P = Math.max(...hist.map((x) => Math.max(x.s.net, 0)), u.n ? u.net : 0, 1), N = Math.max(...hist.map((x) => Math.max(-x.s.net, 0)), 0);
    const k = (h - mg.t - mg.b) / (P + N), z = mg.t + P * k, bw = (w - mg.l - mg.r) / hist.length, bar = Math.min(22, bw * 0.55);
    el("line", { x1: mg.l, x2: w - mg.r, y1: z, y2: z, class: "base" }, svg);
    hist.forEach((x, i) => {
      const v = x.s.net, on = same(x.q, q), hh = Math.max(1, Math.abs(v) * k), x0 = mg.l + bw * i + (bw - bar) / 2, r = Math.min(4, hh / 2);
      const d = v >= 0 ? "M" + x0 + " " + z + "V" + (z - hh + r) + "q0 " + -r + " " + r + " " + -r + "h" + (bar - 2 * r) + "q" + r + " 0 " + r + " " + r + "V" + z + "Z"
        : "M" + x0 + " " + z + "V" + (z + hh - r) + "q0 " + r + " " + r + " " + r + "h" + (bar - 2 * r) + "q" + r + " 0 " + r + " " + -r + "V" + z + "Z";
      el("path", { d, fill: v >= 0 ? (on ? "var(--w-good)" : "var(--w-p2)") : "var(--w-bad)", "fill-opacity": on ? 1 : v >= 0 ? 0.55 : 0.5 }, svg);
      txt(svg, x0 + bar / 2, h - 6, F.mon[x.q[1] - 1], on ? "lb" : "ax", "middle");
      if (on) txt(svg, x0 + bar / 2, v >= 0 ? z - hh - 6 : z + hh + 13, fk(v), "lb halo", "middle");
      const hit = el("rect", { x: mg.l + bw * i, y: 0, width: bw, height: h, fill: "transparent", tabindex: "0", role: "button", "aria-label": monthYear(x.q[0], x.q[1]) }, svg);
      hit.style.cursor = "pointer";
      hover(hit, "<b>" + esc(monthYear(x.q[0], x.q[1])) + "</b>" + row(t("Came in"), f(x.s.inc), "var(--w-good)") + row(t("Went out"), f(x.s.exp)) + row(v >= 0 ? t("Kept") : t("Overspent"), f(Math.abs(v))));
      const open = () => { hideTip(); goMonth(x.q); };
      hit.addEventListener("click", open);
      hit.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); open(); } });
    });
    if (u.n) { const uy = z - u.net * k; el("line", { x1: mg.l, x2: w - mg.r, y1: uy, y2: uy, stroke: "var(--w-ink3)", "stroke-dasharray": "3 3", "stroke-width": 1 }, svg); }
  }, label);
}

/* ---------- phone: four pages to tap or swipe through ---------- */
function phoneStory(m) {
  const { s, hist, keys, c, colOf, sc } = m;
  const mx = Math.max(...hist.map((x) => Math.max(x.s.net, 0)), 1);
  const pageWrap = (i, label, body) => '<section class="w-mrsp" data-sp="' + i + '"' + (i === story ? "" : " hidden") + ' aria-label="' + esc(t("Page {n} of {total}: {title}", { n: i + 1, total: STORY, title: label })) + '">' + body + "</section>";
  const mrow = (left, title, sub, right) => '<div class="w-mrow">' + left + "<div><b>" + title + "</b>" + (sub ? "<small>" + sub + "</small>" : "") + "</div><span>" + right + "</span></div>";
  const p1 = '<div class="w-pmr"><span class="k">' + (s.net >= 0 ? t("Kept") : t("Overspent")) + '</span><div class="big amt"' + (s.net < 0 ? ' style="color:var(--w-bad)"' : "") + ">" + f0(Math.abs(s.net)) + "</div><p>" + m.head + "</p>" +
    '<div class="w-pspark" aria-hidden="true">' + hist.map((x) => '<i class="' + (same(x.q, m.q) ? "on" : "") + '" style="height:' + Math.max(4, (Math.max(x.s.net, 0) / mx) * 100) + '%"></i>').join("") + "</div>" +
    '<span class="w-hint">' + t("Last {n} months", { n: hist.length }) + "</span></div>" +
    (couple() ? state.people.map((p) => {
      const k = String(p.id), tt = totals(m.a, m.b, k);
      return mrow(av(k, "lg"), esc(p.name), t("Spent {spent} of {earned}", { spent: f0(tt.exp), earned: f0(tt.inc) }), '<span style="color:var(--w-' + (tt.net >= 0 ? "good" : "bad") + ')">' + (tt.net >= 0 ? t("Kept {amount}", { amount: f0(tt.net) }) : t("Overspent {amount}", { amount: f0(-tt.net) })) + "</span>");
    }).join("") : "");
  const changed = m.ups.concat(m.downs).sort((x, y) => Math.abs(y.d) - Math.abs(x.d)).slice(0, 3);
  const p2 = '<h2 class="w-mrsh">' + t("Where it went") + "</h2>" + (keys.length ? keys.slice(0, 5).map((k) => mrow(tile(k, null, colOf(k)), catName(k), t("{pct} of spending", { pct: pct(c[k] / (s.exp || 1)) }), f0(c[k]))).join("") : '<p class="w-hint">' + t("No spending this month.") + "</p>") +
    '<h3 class="w-mrsh sm">' + t("What changed") + "</h3>" + (changed.length ? changed.map((x) => mrow(tile(x.k, null, colOf(x.k)), catName(x.k), t("Against usual"), '<span class="w-mrd ' + (x.d > 0 ? "bad" : "good") + '">' + (x.d > 0 ? t("{amount} more", { amount: f0(x.d) }) : t("{amount} less", { amount: f0(-x.d) })) + "</span>")).join("")
      : '<p class="w-hint">' + (m.u.n ? t("Every category was close to usual.") : t("Next month Wally compares against this one.")) + "</p>");
  const p3 = '<h2 class="w-mrsh">' + t("Day by day") + "</h2>" + dayGrid(m, "ph") + dayFacts(m) +
    '<h3 class="w-mrsh sm">' + t("Bills") + "</h3>" + mrow('<span class="w-ico">' + icon("repeat") + "</span>", tn(m.billsN, "{n} payment", "{n} payments"), m.changes.length ? tn(m.changes.length, "{n} change", "{n} changes") : t("No changes"), f0(s.bills)) +
    mrow('<span class="w-ico">' + icon("cal") + "</span>", esc(monthOnly(m.nq)), m.next.first ? t("First: {name} on {date}.", { name: esc(m.next.first.n), date: esc(dlab(m.next.first.d)) }) : t("No bills."), f0(m.next.sum));
  const p4 = '<h2 class="w-mrsh">' + t("Worth knowing") + "</h2>" + highlights(m).map((x) => '<div class="w-mrow w-mrkn"><div><small>' + x[0] + "</small><b>" + x[1] + "</b>" + (x[2] ? "<small>" + x[2] + "</small>" : "") + "</div></div>").join("") +
    '<div class="w-mrsfoot"><a class="w-btn ghost" href="/transactions?ym=' + mkey(m.q) + '" data-link>' + t("See transactions") + '</a><a class="w-btn primary" href="/?ym=' + mkey(m.q) + '" data-link>' + t("Open on the Dashboard") + "</a></div>";
  const bars = '<div class="w-story" aria-hidden="true">' + [0, 1, 2, 3].map((i) => '<i class="' + (i <= story ? "on" : "") + '"></i>').join("") + "</div>";
  return '<div class="w-mrstory" aria-roledescription="' + esc(t("story")) + '">' + bars +
    '<div class="w-mrstop"><button type="button" class="w-mrsnav" data-mr-prev' + (m.hasPrev ? "" : " disabled") + ' aria-label="' + esc(t("Previous month")) + '">' + icon("left") + '</button><span class="w-hint">' + esc(monthYear(m.q[0], m.q[1])) + "</span>" +
    '<button type="button" class="w-mrsnav" data-mr-next' + (same(m.q, lastClosed()) ? " disabled" : "") + ' aria-label="' + esc(t("Next month")) + '">' + icon("right") + '</button><button type="button" class="w-x" data-mr-close aria-label="' + esc(t("Close")) + '">' + icon("x") + "</button></div>" +
    (couple() ? '<div class="w-mrschips">' + scopeChips() + "</div>" : "") +
    '<div class="w-mrspages" id="mr-pages">' + pageWrap(0, t("Kept"), p1) + pageWrap(1, t("Where it went"), p2) + pageWrap(2, t("Day by day"), p3) + pageWrap(3, t("Worth knowing"), p4) + "</div>" +
    '<div class="w-mrsctl"><button type="button" class="w-btn ghost" id="mr-sback"' + (story ? "" : " hidden") + ">" + t("Back") + '</button><span class="w-hint" aria-live="polite">' + t("{n} of {total}", { n: story + 1, total: STORY }) + "</span>" +
    '<button type="button" class="w-btn ' + (story < STORY - 1 ? "primary" : "ghost") + '" id="mr-snext"' + (story < STORY - 1 ? "" : " hidden") + ">" + t("Tap for more") + "</button></div></div>";
}
function setStory(i) {
  story = Math.max(0, Math.min(STORY - 1, i));
  const box = root && root.querySelector(".w-mrstory");
  if (!box) return;
  box.querySelectorAll("[data-sp]").forEach((p) => { p.hidden = +p.dataset.sp !== story; });
  box.querySelectorAll(".w-story i").forEach((b, k) => b.classList.toggle("on", k <= story));
  box.querySelector("#mr-sback").hidden = story === 0;
  box.querySelector("#mr-snext").hidden = story === STORY - 1;
  box.querySelector(".w-mrsctl .w-hint").textContent = t("{n} of {total}", { n: story + 1, total: STORY });
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

/* ---------- shown once a month ----------
   To each person, the first time they open Wally in a new month, if the month that closed has data.
   The very first time someone uses Wally there is nothing to celebrate yet: it is noted, not shown. */
export async function maybeShowOnFirstOfMonth() {
  if (!state.me) return;
  const last = lastClosed(), k = mkey(last), seen = state.prefs && state.prefs.reviewed;
  if (seen && seen >= k) return;
  if (!seen || !state.tx.length || !hasData(last)) { await savePrefs({ reviewed: k }); return; }
  // Only when Wally opens on its first page, not from a link to something else
  const addOpen = document.getElementById("add-modal") && !document.getElementById("add-modal").hidden;
  if (location.pathname !== "/" || location.search || addOpen) return;
  await savePrefs({ reviewed: k });
  navigate("/review?m=" + k);
}
