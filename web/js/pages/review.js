/* Month in review: the month that just closed, read in one direction. Did we do OK (kept, and the
   four totals), where it went (with who spent it inside each bar), what changed against "usual"
   (the average of the 6 months before), the month's limits when it had any, each of you, day by day, bills,
   and what's worth knowing.
   Every figure is worked out here from the ledger, for whoever is shown; "Each of you" always shows
   everyone. On a phone it is a few pages you tap or swipe through. Route: /review?m=YYYY-MM */
import {
  t, tn, esc, state, f, fk, pct, pad, ds, dim, addD, wd, ym, ymAdd, TODAY, START, totals, byCat, amt,
  tile, cat, cc, av, pname, ppastel, couple, isIncomeCat, dlab, dlabW, monthYear, F, icon, bigMoney } from "../core.js";
import { hover, row, hideTip } from "../ui.js";
import { navigate, setScope, closeMenus } from "../shell.js";
import { occurrences, ruleAmt, ruleHist, shortDesc, isIncome, nextOf, perMonth } from "../sched.js";
import { EVERYTHING, limitsIn, figure } from "../budget.js";

let root = null;
let shown = null;        // [year, month] on screen, in Month in review
let span = null;         // or a whole year, { y }, or all time, { all: true }: Year in review and All time
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
  const amount = f(Math.abs(d)), cls = (d > 0) === goodUp ? "good" : "bad";
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
  const keys = Object.keys(c).filter((k) => c[k] >= 0.005).sort((x, y) => c[y] - c[x]);
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
    else if (u.n && s.net < u.net - 50) head += " " + (off > -0.15 ? t("A bit less than usual ({amount}).", { amount: f(u.net) }) : t("Less than usual ({amount}).", { amount: f(u.net) }));
    else if (u.n && s.net > u.net + 50) head += " " + (off < 0.15 ? t("A bit more than usual ({amount}).", { amount: f(u.net) }) : t("More than usual ({amount}).", { amount: f(u.net) }));
  } else if (s.net >= 0) {
    head = who ? t("Nothing went out for {name}.", { name: esc(who) }) : t("Nothing went out.");
  } else {
    head = who ? t("{name} spent {amount} more than came in.", { name: esc(who), amount: f(-s.net) }) : t("You spent {amount} more than came in.", { amount: f(-s.net) });
    if (ups[0]) head += " " + t("Mostly {category}, {amount} above usual.", { category: catName(ups[0].k), amount: f(ups[0].d) });
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
          p: t("{from} to {to}. That is {year} a year.", { from: f(before.a), to: f(x.a), year: f(Math.abs(x.a - before.a) * (r.freq === "monthly" ? 12 / (r.every || 1) : r.freq === "weekly" ? 52 / (r.every || 1) : 1)) }) });
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

  return { q, a, b, D, pq, nq, hasPrev, s, prev, u, hist, c, cu, cp, keys, colOf, ups, downs, biggestIn, head, vals, ns, best, peak, weekday, weekend, billsN, changes, next, big, pay, topPay, tg, topTag, extra, sc, parts,
    budget: sc === "all" ? budgetOf(q) : null };
}
/* The month's limits, as Budget showed them when it ended: the limit for everything first, then the
   categories, largest limit first. Limits are the household's, so only the household's recap has them;
   a yearly limit belongs to its year, not to one month. Nothing when the month had none. */
function budgetOf(q) {
  const month = mkey(q);
  const rows = limitsIn(month).filter((b) => b.period === "month")
    .sort((x, y) => (x.category === EVERYTHING) - (y.category === EVERYTHING) ? (x.category === EVERYTHING ? -1 : 1) : Number(y.amount) - Number(x.amount) || x.category.localeCompare(y.category))
    .map((b) => ({ k: b.category, fg: figure(b, month) }));
  if (!rows.length) return null;
  const kept = rows.filter((r) => !r.fg.over).length;
  return { month, rows, kept, total: rows.length };
}
/* The section's verdict. The limit for everything is the month, the categories its parts, so they are not counted
   together: first what was left of, or over, the month's limit, then how many categories stayed within theirs.
   "Within every limit" when nothing went over. Parts: [text, "good" | "bad" | ""]. */
export function budgetHeadParts(bg) {
  if (bg.kept === bg.total) return [[t("Within every limit"), "good"]];
  const all = bg.rows.find((r) => r.k === EVERYTHING), cats = bg.rows.filter((r) => r.k !== EVERYTHING), out = [];
  if (all) out.push(all.fg.over ? [t("{amount} over", { amount: f(-all.fg.left) }), "bad"] : [t("{amount} left", { amount: f(all.fg.left) }), "good"]);
  if (cats.length) out.push([tn(cats.length, "{n} of {total} category within", "{n} of {total} categories within", { n: cats.filter((r) => !r.fg.over).length, total: cats.length }), ""]);
  return out;
}
const budgetHeadHtml = (bg) => budgetHeadParts(bg).map(([s, c]) => '<span class="' + (c ? "w-mr" + c : "") + '">' + esc(s) + "</span>").join(" · ");
export const budgetName = (k) => (k === EVERYTHING ? t("Everything") : cat(k).n);

/* ---------- a year, or all time ----------
   The same story as a month, read over a longer span. A year compares with the year before (the same
   days of it while the year runs); all time has nothing before it, so it says what a month costs on
   average instead. Its bars are the months of the year, or the years. */
const firstYear = () => +START.slice(0, 4);
function spanBounds(sp) {
  if (sp.all) return [START, TODAY];
  const a = sp.y + "-01-01" < START ? START : sp.y + "-01-01", end = sp.y + "-12-31";
  return [a, end < TODAY ? end : TODAY];
}
function statsAB(a, b, sc) {
  const s = totals(a, b, sc);
  let bills = 0;
  for (const x of state.tx) if (x.rec && x.type === "expense" && x.d >= a && x.d <= b) bills += amt(x, sc);
  s.bills = bills;
  s.day = s.exp - bills;
  return s;
}
const monthsIn = (a, b) => { const [y0, m0] = ym(a), [y1, m1] = ym(b); return (y1 - y0) * 12 + m1 - m0 + 1; };
function computeSpan(sp, sc) {
  const [a, b] = spanBounds(sp), year = !sp.all, running = b === TODAY;
  // The year before, to the same day while this one runs
  let pa = null, pb = null;
  if (year && ds(sp.y - 1, 1, 1) >= START) {
    pa = ds(sp.y - 1, 1, 1);
    pb = running ? sp.y - 1 + b.slice(4) : ds(sp.y - 1, 12, 31);
    if (pb.slice(5) === "02-29" && dim(sp.y - 1, 2) === 28) pb = ds(sp.y - 1, 2, 28);
  }
  const hasPrev = !!pa, PY = year ? String(sp.y - 1) : "";
  const s = statsAB(a, b, sc), prev = hasPrev ? statsAB(pa, pb, sc) : null, nm = monthsIn(a, b);
  const spendIn = (x) => x.type === "expense" && x.d >= a && x.d <= b && amt(x, sc) > 0;
  const mine = state.tx.filter(spendIn);

  // The bars: each month of the year, or each year; a click opens it
  const hist = [], last = lastClosed();
  // Every month of the span; under the bars a letter a month, or for all time the year where one starts
  for (let k = 0, n = monthsIn(a, b); k < n; k++) {
    const q = ymAdd(+a.slice(0, 4), +a.slice(5, 7), k), [ma, mb] = bounds(q);
    const closed = ds(q[0], q[1], 1) <= ds(last[0], last[1], 1);
    hist.push({ key: mkey(q), lab: monthYear(q[0], q[1]) + (closed ? "" : ", " + t("so far")), ax: year ? narrow(q) : k === 0 || q[1] === 1 ? String(q[0]) : "",
      s: statsAB(ma, mb < TODAY ? mb : TODAY, sc), go: closed ? { q } : null });
  }
  // One colour: the best whole month in green, the rest grey
  const bestBar = hist.filter((x) => x.go).reduce((x, y) => (!x || y.s.net > x.s.net ? y : x), null);
  if (bestBar && bestBar.s.net > 0) bestBar.on = true;

  // Categories, against the year before (a year), or as a share of the spending (all time)
  const c = byCat(a, b, sc), cp = hasPrev ? byCat(pa, pb, sc) : {};
  const keys = Object.keys(c).filter((k) => c[k] >= 0.005).sort((x, y) => c[y] - c[x]);
  const moved = !hasPrev ? [] : [...new Set(Object.keys(c).concat(Object.keys(cp)))].filter((k) => !isIncomeCat(k))
    .map((k) => ({ k, d: (c[k] || 0) - (cp[k] || 0) }))
    .filter((x) => Math.abs(x.d) >= 100 && Math.abs(x.d) >= (cp[x.k] || 0) * 0.15);
  const ups = moved.filter((x) => x.d > 0).sort((x, y) => y.d - x.d).slice(0, 3);
  const downs = moved.filter((x) => x.d < 0).sort((x, y) => x.d - y.d).slice(0, 3);
  const biggestIn = (k) => mine.filter((x) => x.c === k).sort((x, y) => amt(y, sc) - amt(x, sc))[0];
  const parts = {};
  mine.forEach((x) => { const o = (parts[x.c] = parts[x.c] || { sh: 0 }), v = amt(x, sc); if (x.p === null) o.sh += v; else o[x.p] = (o[x.p] || 0) + v; });

  // The headline
  const who = sc === "all" ? null : pname(sc);
  let head;
  if (s.net >= 0 && s.inc > 0) {
    head = t("{pct} of what came in.", { pct: pct(s.rate) });
    if (!year) head += " " + t("About {amount} a month.", { amount: f(s.net / nm) });
    else if (prev && s.net > prev.net + 100) head += " " + t("More than {period} ({amount}).", { period: PY, amount: f(prev.net) });
    else if (prev && s.net < prev.net - 100) head += " " + t("Less than {period} ({amount}).", { period: PY, amount: f(prev.net) });
  } else if (s.net >= 0) {
    head = who ? t("Nothing went out for {name}.", { name: esc(who) }) : t("Nothing went out.");
  } else {
    head = who ? t("{name} spent {amount} more than came in.", { name: esc(who), amount: f(-s.net) }) : t("You spent {amount} more than came in.", { amount: f(-s.net) });
  }

  // Month by month: the best and the hardest whole months, what a month costs, days without spending
  const months = [];
  for (let k = 0; k < nm; k++) {
    const q = ymAdd(+a.slice(0, 4), +a.slice(5, 7), k), [ma, mb] = bounds(q);
    if (mb < TODAY) months.push({ q, s: statsAB(ma, mb, sc) });
  }
  const best = months.length > 1 ? months.reduce((x, y) => (y.s.net > x.s.net ? y : x)) : null;
  const worst = months.length > 1 ? months.reduce((x, y) => (y.s.net < x.s.net ? y : x)) : null;
  const spentDays = new Set(mine.filter((x) => !x.rec).map((x) => x.d));
  let nDays = 0;
  for (let d = a; d <= b; d = addD(d, 1)) nDays++;

  // Bills: what they came to, what changed in them, and what they cost each month now
  const billsN = mine.filter((x) => x.rec).length, changes = [];
  state.rules.forEach((r) => {
    if (isIncome(r) || !ruleAmt(r, sc)) return;
    const h = ruleHist(r), inSpan = h.filter((x) => x.rid === r.id && x.d >= a && x.d <= b);
    if (r.start >= a && r.start <= b && r.start > START) changes.push({ c: r.c, h: t("{name} started", { name: esc(r.n) }) });
    inSpan.forEach((x) => {
      const k = h.indexOf(x), before = k > 0 ? h[k - 1] : null;
      if (before && !r.varies && Math.abs(x.a - before.a) > 0.005) changes.push({ c: r.c, h: x.a > before.a ? t("{name} went up", { name: esc(r.n) }) : t("{name} went down", { name: esc(r.n) }) });
    });
  });
  const billNow = state.rules.filter((r) => !isIncome(r) && nextOf(r)).reduce((v, r) => v + perMonth(r, sc), 0);

  // Small things worth knowing
  const big = mine.filter((x) => !x.rec).sort((x, y) => amt(y, sc) - amt(x, sc))[0];
  const pay = {};
  mine.forEach((x) => { if (x.rec || !x.n) return; const o = (pay[x.n] = pay[x.n] || { k: 0, s: 0 }); o.k++; o.s += amt(x, sc); });
  const topPay = Object.keys(pay).sort((x, y) => pay[y].k - pay[x].k || pay[y].s - pay[x].s)[0];
  const tg = {};
  mine.forEach((x) => x.tags.forEach((g) => { const o = (tg[g] = tg[g] || { k: 0, s: 0 }); o.k++; o.s += amt(x, sc); }));
  const topTag = Object.keys(tg).sort((x, y) => tg[y].s - tg[x].s)[0];
  const extra = state.tx.filter((x) => x.type === "income" && !x.rec && x.d >= a && x.d <= b && amt(x, sc) > 0);

  return { kind: year ? "year" : "all", sp, a, b, pa, pb, running, hasPrev, PY, nm, s, prev, hist, c, cp, keys, ups, downs, biggestIn, head,
    months, best, worst, spentDays, nDays, billsN, changes, billNow, big, pay, topPay, tg, topTag, extra, sc, parts };
}
/* Where a span's links go: Transactions and Summary over the same year, or all time */
const spanTx = (m) => "/transactions?" + (m.kind === "year" ? "mode=year&year=" + m.sp.y : "mode=all");
const spanSum = (m) => (m.kind === "year" ? "/?year=" + m.sp.y : "/?range=all");
export const spanTitle = (m) => (m.kind === "year" ? String(m.sp.y) : t("All time"));
export const spanSub = (m) => (m.kind === "year" ? (m.running ? t("Year so far") : t("Year in review")) : t("Since {date}", { date: monthYear(+START.slice(0, 4), +START.slice(5, 7)) }));

/* ---------- the page ---------- */
export function mount(el, route) {
  root = el;
  const qy = route.query.get("y");
  span = route.query.has("all") ? { all: true } : /^(19|20)\d\d$/.test(qy || "") && +qy <= +TODAY.slice(0, 4) && +qy >= firstYear() ? { y: +qy } : null;
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
  const m = (current = span ? computeSpan(span, state.scope) : compute(shown, state.scope));
  STORY = (couple() ? 5 : 4) - (m.kind === "all" ? 1 : 0) + (m.budget ? 1 : 0);
  story = Math.min(story, STORY - 1);
  root.innerHTML = '<div class="w-mrpage"><article class="w-mrev" aria-labelledby="mr-title">' + desktop(m) + "</article>" + phoneStory(m) + "</div>";
  wireHeader(m);
  wireDesktop(m);
  wireStory(m);
}

function goMonth(q) {
  shown = clamp(q);
  span = null;
  story = 0;
  history.replaceState(history.state, "", "/review?m=" + mkey(shown));
  render();
}
function goYear(y) {
  span = { y };
  story = 0;
  history.replaceState(history.state, "", "/review?y=" + y);
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
const moreMenu = () => '<div class="w-mrmore"><button type="button" class="w-mrc" data-menu="mrmore" aria-haspopup="menu" aria-expanded="false" aria-label="' + esc(t("More")) + '">' + icon("more") + "</button>" +
  '<div class="w-menu" role="menu" hidden><button type="button" role="menuitem" data-mr-pdf>' + icon("download") + t("Export as PDF") + "</button></div></div>";
function tools(m, id) {
  if (m && m.kind) {
    // A year steps a year; all time has nowhere to step
    const y = m.sp.y, close = '<button type="button" class="w-mrc" data-mr-close aria-label="' + esc(t("Close")) + '">' + icon("x") + "</button>";
    if (m.kind === "all") return moreMenu() + close;
    return '<button type="button" class="w-mrc"' + (id ? ' id="mr-prev"' : " data-mr-prev") + ' aria-label="' + esc(t("Previous year")) + '"' + (y > firstYear() ? "" : " disabled") + ">" + icon("left") + "</button>" +
      '<button type="button" class="w-mrc"' + (id ? ' id="mr-next"' : " data-mr-next") + ' aria-label="' + esc(t("Next year")) + '"' + (y < +TODAY.slice(0, 4) ? "" : " disabled") + ">" + icon("right") + "</button>" + moreMenu() + close;
  }
  const q = m ? m.q : lastClosed(), isLast = same(q, lastClosed()), canPrev = m && m.hasPrev;
  const nextName = monthOnly(ymAdd(q[0], q[1], 1));
  return (m ? '<button type="button" class="w-mrc"' + (id ? ' id="mr-prev"' : " data-mr-prev") + ' aria-label="' + esc(t("Previous month")) + '"' + (canPrev ? "" : " disabled") + ">" + icon("left") + "</button>" +
      '<button type="button" class="w-mrc"' + (id ? ' id="mr-next"' : " data-mr-next") + ' aria-label="' + esc(t("Next month")) + '"' + (isLast ? ' disabled title="' + esc(t("{month} is not over yet", { month: nextName })) + '"' : "") + ">" + icon("right") + "</button>" +
      moreMenu() : "") +
    '<button type="button" class="w-mrc" data-mr-close aria-label="' + esc(t("Close")) + '">' + icon("x") + "</button>";
}
function header(m) {
  const q = m && !m.kind ? m.q : lastClosed();
  return '<header class="w-mrh"><div class="t"><h1 id="mr-title">' + esc(m && m.kind ? spanTitle(m) : monthYear(q[0], q[1])) + "</h1><p>" + (m && m.kind ? esc(spanSub(m)) : t("Month in review")) + "</p></div>" +
    scopeSeg(m) + '<div class="w-mrtools">' + tools(m, true) + "</div></header>";
}
function wireHeader(m) {
  root.querySelectorAll("[data-mr-close]").forEach((b) => b.addEventListener("click", () => navigate("/")));
  root.querySelectorAll("[data-mrsc]").forEach((b) => b.addEventListener("click", () => setScope(b.dataset.mrsc)));
  if (!m) return;
  root.querySelectorAll("[data-mr-pdf]").forEach((b) => b.addEventListener("click", exportPdf));
  root.querySelectorAll("#mr-prev,[data-mr-prev]").forEach((b) => b.addEventListener("click", () => (m.kind ? goYear(m.sp.y - 1) : goMonth(m.pq))));
  root.querySelectorAll("#mr-next,[data-mr-next]").forEach((b) => b.addEventListener("click", () => (m.kind ? goYear(m.sp.y + 1) : goMonth(m.nq))));
}

/* ---------- the pieces, shared by the desktop sheet and the phone pages ---------- */
/* Money kept, the last 12 months: bars, the month shown in green; a click opens a month */
function keptBars(m, cls) {
  if (m.kind) {
    const { hist } = m, mx = Math.max(...hist.map((x) => Math.abs(x.s.net)), 1);
    const label = t("Money kept, month by month") + ": " + hist.map((x) => x.lab + " " + f(x.s.net)).join(", ");
    return '<div class="w-mrbars ' + (m.kind === "all" ? "long " : "") + (cls || "") + '" role="group" aria-label="' + esc(label) + '"><div class="b">' + hist.map((x) => {
      const v = x.s.net;
      return '<button type="button" class="' + (x.on ? "on" : "") + (v < 0 ? " neg" : "") + '" data-mrm="' + x.key + '" style="height:' + Math.max(3, (Math.abs(v) / mx) * 100).toFixed(1) + '%" aria-label="' + esc(x.lab + ", " + (v >= 0 ? t("kept {amount}", { amount: f(v) }) : t("overspent {amount}", { amount: f(-v) }))) + '"' + (x.go ? "" : " disabled") + "></button>";
    }).join("") + '</div><div class="ax" aria-hidden="true">' + hist.map((x) => "<span>" + esc(x.ax) + "</span>").join("") + "</div></div>";
  }
  const { hist, q } = m, mx = Math.max(...hist.map((x) => Math.abs(x.s.net)), 1);
  const label = t("Money kept, last {n} months", { n: hist.length }) + ": " + hist.map((x) => monthYear(x.q[0], x.q[1]) + " " + f(x.s.net)).join(", ");
  return '<div class="w-mrbars ' + (cls || "") + '" role="group" aria-label="' + esc(label) + '"><div class="b">' + hist.map((x) => {
    const on = same(x.q, q), v = x.s.net;
    return '<button type="button" class="' + (on ? "on" : "") + (v < 0 ? " neg" : "") + '" data-mrm="' + mkey(x.q) + '" style="height:' + Math.max(3, (Math.abs(v) / mx) * 100).toFixed(1) + '%" aria-label="' + esc(monthYear(x.q[0], x.q[1]) + ", " + (v >= 0 ? t("kept {amount}", { amount: f(v) }) : t("overspent {amount}", { amount: f(-v) }))) + '"' + (on ? ' aria-current="true"' : "") + "></button>";
  }).join("") + '</div><div class="ax" aria-hidden="true">' + hist.map((x) => "<span" + (same(x.q, q) ? ' class="on"' : "") + ">" + esc(narrow(x.q)) + "</span>").join("") + "</div></div>";
}
/* The four totals, each against the month before */
function tiles(m) {
  const { s, prev } = m, PM = m.kind ? m.PY : monthOnly(m.pq);
  if (m.kind === "all") {
    // Nothing before all time: what a month comes to instead
    const tl = (label, cur) => '<div class="w-mrtile"><span>' + label + '</span><b class="amt">' + bigMoney(cur) + '</b><span class="w-mrd">' + t("{amount} a month", { amount: f(cur / m.nm) }) + "</span></div>";
    return '<div class="w-mrtiles">' + tl(t("Came in"), s.inc) + tl(t("Went out"), s.exp) + tl(t("Bills"), s.bills) + tl(t("Everyday"), s.day) + "</div>";
  }
  const tl = (label, cur, p, goodUp) => '<div class="w-mrtile"><span>' + label + '</span><b class="amt">' + bigMoney(cur) + "</b>" + (prev ? cmpPrev(cur, p, goodUp, PM) : "") + "</div>";
  return '<div class="w-mrtiles">' + tl(t("Came in"), s.inc, prev && prev.inc, true) + tl(t("Went out"), s.exp, prev && prev.exp, false) +
    tl(t("Bills"), s.bills, prev && prev.bills, false) + tl(t("Everyday"), s.day, prev && prev.day, false) + "</div>";
}
/* "Same as September", "283 € less" */
function cmpPrev(cur, prev, goodUp, month) {
  const d = cur - prev;
  if (Math.abs(d) < Math.max(5, Math.abs(prev) * 0.03)) return '<span class="w-mrd">' + t("Same as {month}", { month }) + "</span>";
  const amount = f(Math.abs(d));
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
  return '<span class="w-mrsplit" style="width:' + width + '%">' + splitParts(m, k).map((x) => '<i class="' + x.cls + '" style="flex:' + x.v.toFixed(2) + (x.id ? ";background:" + ppastel(x.id) : "") + '"></i>').join("") + "</span>";
}
/* Who is who in the bars: each person in their own colour (their avatar's, as a pastel, so a red-orange never reads as "over"), shared hatched */
export function splitKey() {
  if (!couple()) return "";
  const ppl = state.people.map((p, i) => '<span><i class="p' + Math.min(i, 5) + '" style="background:' + ppastel(String(p.id)) + '"></i>' + esc(p.name) + "</span>");
  ppl.splice(1, 0, '<span><i class="sh"></i>' + t("Shared") + "</span>");
  return '<span class="w-mrkey">' + ppl.join("") + "</span>";
}
/* Against usual, in a word or two */
function vsUsual(m, k) {
  // A year: against the year before. All time: its share of the spending.
  if (m.kind === "all" || (m.kind === "year" && !m.hasPrev)) {
    const tot = m.keys.reduce((v, x) => v + m.c[x], 0), x = tot ? m.c[k] / tot : 0;
    return '<span class="w-mrd" title="' + esc(t("{pct} of spending", { pct: pct(x) })) + '">' + (x > 0 && x < 0.005 ? "<" + pct(0.01) : pct(x)) + "</span>";
  }
  if (m.kind === "year") return m.cp[k] ? cmp(m.c[k], m.cp[k], false, "", true) : '<span class="w-mrd">' + t("New") + "</span>";
  return m.cu[k] ? cmp(m.c[k], m.cu[k], false, "", true) : m.u.n ? '<span class="w-mrd">' + t("New") + "</span>" : "<span></span>";
}
const catHref = (m, k) => (m.kind ? spanTx(m) : "/transactions?month=" + mkey(m.q)) + "&cat=" + encodeURIComponent(k);
function whereRows(m) {
  const { c, keys } = m;
  if (!keys.length) return '<p class="w-hint">' + (m.kind ? t("No spending.") : t("No spending this month.")) + "</p>";
  const top = c[keys[0]];
  return '<div class="w-mrwhere">' + keys.map((k) => '<a class="w-mrwrow" href="' + catHref(m, k) + '" data-link data-cat="' + esc(k) + '">' +
    '<span class="n">' + tile(k, 30) + "<b>" + catName(k) + "</b></span>" + '<span class="bar">' + splitBar(m, k, ((c[k] / top) * 100).toFixed(1)) + "</span>" +
    '<b class="amt">' + f(c[k]) + "</b>" + vsUsual(m, k) + "</a>").join("") + "</div>";
}
/* The month's limits: spent against each, as Budget draws it, and what was left or over; a row opens Budget on that month */
const budIcon = (k, size) => (k === EVERYTHING ? '<span class="w-ico w-mrall">' + icon("wallet") + "</span>" : tile(k, size));
function budBar(fg) {
  return '<span class="w-mrbud' + (fg.over ? " over" : "") + '"><i style="width:' + Math.min(100, (fg.spent / fg.limit) * 100).toFixed(1) + '%"></i></span>';
}
// Looking back, what was left is good news, so green, as "less" is in Where it went; over is red
const budLeft = (fg) => '<span class="w-mrd ' + (fg.over ? "bad" : "good") + '">' + esc(fg.over ? t("{amount} over", { amount: f(-fg.left) }) : t("{amount} left", { amount: f(fg.left) })) + "</span>";
const budOf = (fg) => esc(t("{spent} of {limit}", { spent: f(fg.spent), limit: f(fg.limit) }));
/* The limit for everything leads, as on Budget: heavier, a thicker bar, set apart from the categories under it */
const isAll = (r) => r.k === EVERYTHING;
function budgetRows(m) {
  const bg = m.budget;
  return '<div class="w-mrwhere">' + bg.rows.map((r) => '<a class="w-mrwrow w-mrbrow' + (isAll(r) ? " all" : "") + '" href="/budget?m=' + bg.month + '" data-link>' +
    '<span class="n">' + budIcon(r.k, 30) + "<b>" + esc(budgetName(r.k)) + "</b></span>" + '<span class="bar">' + budBar(r.fg) + "</span>" +
    '<span class="amt">' + budOf(r.fg) + "</span>" + budLeft(r.fg) + "</a>").join("") + "</div>";
}
function budgetPhone(m) {
  const bg = m.budget;
  return '<h2 class="w-mrsh">' + t("Budget") + '</h2><p class="w-mrnote">' + budgetHeadHtml(bg) + "</p>" +
    // On a phone the limit for everything is a card of its own, above the categories'
    [bg.rows.filter(isAll), bg.rows.filter((r) => !isAll(r))].filter((g) => g.length).map((g) => '<div class="w-mrcard">' + g.map((r) =>
      '<a class="w-mrpw' + (isAll(r) ? " all" : "") + '" href="/budget?m=' + bg.month + '" data-link><span class="top">' + budIcon(r.k, 30) + "<b>" + esc(budgetName(r.k)) + "</b>" + budLeft(r.fg) + "</span>" +
      budBar(r.fg) + '<span class="w-mrd">' + budOf(r.fg) + "</span></a>").join("") + "</div>").join("");
}

/* What changed: up on one side, down on the other */
function changedItem(m, x, up) {
  const big = up ? m.biggestIn(x.k) : null, amount = f(Math.abs(x.d));
  if (m.kind) {
    return '<div class="w-mrchg">' + tile(x.k, 36) + "<div><b>" + (up ? t("{category}, {amount} more", { category: catName(x.k), amount }) : t("{category}, {amount} less", { category: catName(x.k), amount })) + "</b><p>" +
      (big ? t("Biggest: {name}, {amount} on {date}", { name: esc(big.n || cat(big.c).n), amount: f(amt(big, m.sc)), date: esc(dlab(big.d)) })
        : t("{amount}, against {before} in {period}", { amount: f(m.c[x.k] || 0), before: f(m.cp[x.k] || 0), period: m.PY })) + "</p></div></div>";
  }
  return '<div class="w-mrchg">' + tile(x.k, 36) + "<div><b>" + (up ? t("{category}, {amount} more", { category: catName(x.k), amount }) : t("{category}, {amount} less", { category: catName(x.k), amount })) + "</b><p>" +
    (big ? t("Biggest: {name}, {amount} on {date}", { name: esc(big.n || cat(big.c).n), amount: f(amt(big, m.sc)), date: esc(dlab(big.d)) })
      : (m.c[x.k] ? t("{amount} this month, usually about {usual}", { amount: f(m.c[x.k] || 0), usual: f(m.cu[x.k] || 0) }) : t("Nothing this month, usually about {usual}", { usual: f(m.cu[x.k] || 0) }))) + "</p></div></div>";
}
function changed(m) {
  if (m.kind === "year") {
    if (!m.hasPrev) return '<p class="w-hint"><b>' + t("The first year") + "</b> " + t("Next year Wally compares against this one.") + "</p>";
    if (!m.ups.length && !m.downs.length) return '<p class="w-hint"><b>' + t("A steady year") + "</b> " + t("Every category was close to {period}.", { period: m.PY }) + "</p>";
    return '<div class="w-mrchgs"><div>' + m.ups.map((x) => changedItem(m, x, true)).join("") + "</div><div>" + m.downs.map((x) => changedItem(m, x, false)).join("") + "</div></div>";
  }
  if (!m.u.n) return '<p class="w-hint"><b>' + t("The first month") + "</b> " + t("Next month Wally compares against this one.") + "</p>";
  if (!m.ups.length && !m.downs.length) return '<p class="w-hint"><b>' + t("A steady month") + "</b> " + t("Every category was close to usual.") + "</p>";
  return '<div class="w-mrchgs"><div>' + m.ups.map((x) => changedItem(m, x, true)).join("") + "</div><div>" + m.downs.map((x) => changedItem(m, x, false)).join("") + "</div></div>";
}
/* Each of you: earned, spent with their share, kept, against the month before */
function person(m, key) {
  const { a, b, sc } = m, PM = m.kind ? m.PY : monthOnly(m.pq);
  const tt = totals(a, b, key), kept = tt.net >= 0;
  const pe = !m.hasPrev ? null : m.kind ? totals(m.pa, m.pb, key).exp : totals(...bounds(m.pq), key).exp;
  const kv = (k, v) => '<div class="w-mrkv"><span>' + k + "</span><b>" + v + "</b></div>";
  return '<div class="w-mrpc' + (sc !== "all" && sc !== key ? " dim" : "") + '"><div class="h">' + av(key, "lg") + "<b>" + esc(pname(key)) + '</b><span class="' + (kept ? "good" : "bad") + '">' +
      (kept ? t("Kept {amount}", { amount: f(tt.net) }) : t("Over by {amount}", { amount: f(-tt.net) })) + "</span></div>" +
    kv(t("Earned"), '<span class="amt">' + f(tt.inc) + "</span>") + kv(t("Spent, with their share"), '<span class="amt">' + f(tt.exp) + "</span>") +
    (pe !== null ? kv(t("Against {month}", { month: PM }), cmp(tt.exp, pe, false, PM, true)) : "") + "</div>";
}
/* Day by day, as four facts */
export function dayRows(m) {
  const ratio = m.weekday > 0.005 ? t("{x}× a weekday", { x: (m.weekend / m.weekday).toLocaleString(document.documentElement.lang, { maximumFractionDigits: 1, minimumFractionDigits: 1 }) }) : "–";
  return [[t("Days without spending"), m.best > 1 ? t("{n}, longest run {run}", { n: m.ns, run: m.best }) : String(m.ns)]]
    .concat(m.vals[m.peak] > 0 ? [[t("Busiest day"), esc(dlabW(ds(m.q[0], m.q[1], m.peak + 1))) + " · " + f(m.vals[m.peak])]] : [])
    .concat([[t("Average day"), f(m.s.day / m.D)], [t("A weekend day costs"), ratio]]);
}
/* Bills: this month, against the one before, and the next */
export function billRows(m) {
  const PM = m.hasPrev ? monthOnly(m.pq) : null, nx = m.next;
  const rows = [[t("In {month}", { month: monthOnly(m.q) }), tn(m.billsN, "{n} bill", "{n} bills") + " · " + f(m.s.bills)]];
  if (PM) rows.push([t("Against {month}", { month: PM }), m.changes.length ? m.changes.slice(0, 2).map((x) => x.h).join(", ") + (m.changes.length > 2 ? " " + tn(m.changes.length - 2, "and {n} more", "and {n} more") : "") : t("Same bills, same prices")]);
  rows.push([esc(monthOnly(m.nq)), nx.n ? (nx.first ? t("{amount}, first {name} on {date}", { amount: f(nx.sum), name: esc(nx.first.n), date: esc(dlab(nx.first.d)) }) : f(nx.sum)) : t("No bills")]);
  return rows;
}
/* A year or all time, month by month, as four facts */
export function monthRows(m) {
  const mo = (x) => (m.kind === "year" ? F.months[x.q[1] - 1] : monthYear(x.q[0], x.q[1]));
  const rows = [];
  if (m.best) rows.push([t("Best month"), esc(mo(m.best)) + " · " + (m.best.s.net >= 0 ? t("kept {amount}", { amount: f(m.best.s.net) }) : t("overspent {amount}", { amount: f(-m.best.s.net) }))]);
  if (m.worst && m.worst !== m.best) rows.push([t("Hardest month"), esc(mo(m.worst)) + " · " + (m.worst.s.net >= 0 ? t("kept {amount}", { amount: f(m.worst.s.net) }) : t("overspent {amount}", { amount: f(-m.worst.s.net) }))]);
  rows.push([t("Average month"), t("{amount} spent", { amount: f(m.s.exp / m.nm) })]);
  rows.push([t("Days without spending"), t("{n} of {total}", { n: m.nDays - m.spentDays.size, total: m.nDays })]);
  return rows;
}
export function spanBillRows(m) {
  const rows = [[m.kind === "year" ? t("In {month}", { month: String(m.sp.y) }) : t("Since {date}", { date: monthYear(+START.slice(0, 4), +START.slice(5, 7)) }), tn(m.billsN, "{n} bill", "{n} bills") + " · " + f(m.s.bills)]];
  rows.push([t("Changes"), m.changes.length ? m.changes.slice(0, 2).map((x) => x.h).join(", ") + (m.changes.length > 2 ? " " + tn(m.changes.length - 2, "and {n} more", "and {n} more") : "") : t("Same bills, same prices")]);
  rows.push([t("Every month now"), f(m.billNow)]);
  return rows;
}
const kvList = (rows) => rows.map(([k, v]) => '<div class="w-mrkv"><span>' + k + "</span><b>" + v + "</b></div>").join("");
/* Small things worth knowing */
export function highlights(m) {
  const { big, pay, topPay, tg, topTag, extra, sc } = m;
  return [
    [t("Biggest purchase"), big ? esc(big.n || cat(big.c).n) + ", " + f(amt(big, sc)) : t("None"), big ? catName(big.c) + ", " + esc(dlab(big.d)) : ""],
    [t("Most visits"), topPay ? esc(topPay) : t("None"), topPay ? tn(pay[topPay].k, "{n} time, {amount}", "{n} times, {amount}", { amount: f(pay[topPay].s) }) : ""],
    [t("Top tag"), topTag ? esc(topTag) : t("No tags"), topTag ? tn(tg[topTag].k, "{n} time, {amount}", "{n} times, {amount}", { amount: f(tg[topTag].s) }) : ""],
    [t("Extra income"), extra.length ? f(extra.reduce((v, x) => v + amt(x, sc), 0)) : t("None"),
      extra.length ? [...new Set(extra.map((x) => x.n || cat(x.c).n))].slice(0, 3).map(esc).join(", ") : t("Only the usual")],
  ];
}
const knowTiles = (m) => '<div class="w-mrtiles">' + highlights(m).map((x) => '<div class="w-mrtile k"><span>' + x[0] + "</span><b>" + x[1] + "</b>" + (x[2] ? '<span class="s">' + x[2] + "</span>" : "") + "</div>").join("") + "</div>";

/* ---------- desktop and tablet: one sheet, top to bottom ---------- */
function desktop(m) {
  const { s } = m;
  const sec = (id, title, body, extra) => '<section class="w-mrs" aria-labelledby="' + id + '"><div class="w-mrsh2"><h2 id="' + id + '">' + title + "</h2>" + (extra || "") + "</div>" + body + "</section>";
  let html = header(m) +
    '<section class="w-mrs w-mrtop" aria-label="' + esc(t("Summary")) + '"><div class="w-mrhero"><div><span class="k">' + (s.net >= 0 ? t("Kept") : t("Overspent")) + '</span><div class="big amt' + (s.net < 0 ? " neg" : "") + '">' + bigMoney(Math.abs(s.net)) + "</div><p>" + m.head + "</p></div>" +
    keptBars(m) + "</div>" + tiles(m) + "</section>";
  html += sec("mr-where", t("Where it went"), whereRows(m) + (couple() ? '<p class="w-mrnote" id="mr-shared">' + sharedText(m) + "</p>" : ""), splitKey());
  if (m.kind !== "all") html += sec("mr-chg", t("What changed"), changed(m));
  if (m.budget) html += sec("mr-bud", t("Budget"), budgetRows(m), '<span class="w-mrd">' + budgetHeadHtml(m.budget) + "</span>");
  if (couple()) html += sec("mr-ppl", t("Each of you"), '<div class="w-mrpcs">' + state.people.map((p) => person(m, String(p.id))).join("") + "</div>");
  html += '<div class="w-mr2"><section class="w-mrcol" aria-labelledby="mr-days"><h2 id="mr-days">' + (m.kind ? t("Month by month") : t("Day by day")) + "</h2>" + kvList(m.kind ? monthRows(m) : dayRows(m)) + "</section>" +
    '<section class="w-mrcol" aria-labelledby="mr-bills"><h2 id="mr-bills">' + t("Bills") + "</h2>" + kvList(m.kind ? spanBillRows(m) : billRows(m)) + "</section></div>";
  html += sec("mr-know", t("Worth knowing"), knowTiles(m));
  html += '<footer class="w-mrf"><a class="w-btn ghost" href="' + (m.kind ? spanTx(m) : "/transactions?month=" + mkey(m.q)) + '" data-link>' + t("See transactions") + '</a><a class="w-btn primary" href="' + (m.kind ? spanSum(m) : "/?month=" + mkey(m.q)) + '" data-link>' + t("Open in Summary") + "</a></footer>";
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
  if (!n) return m.kind ? t("No shared costs.") : t("No shared costs this month.");
  let text = tn(n, "{amount} in {n} shared cost.", "{amount} in {n} shared costs.", { amount: f(tot) });
  const payers = state.people.filter((p) => by[String(p.id)]).map((p) => t("{name} paid {amount}", { name: esc(p.name), amount: f(by[String(p.id)]) }));
  if (payers.length) text += " " + payers.join(", ") + ".";
  return text;
}

function wireDesktop(m) {
  if (m.kind) {
    root.querySelectorAll("[data-cat]").forEach((x) => {
      const k = x.dataset.cat;
      hover(x, () => "<b>" + catName(k) + ", " + esc(spanTitle(m)) + "</b>" + splitParts(m, k).map((p) => row(p.cls === "sh" ? t("Shared") : esc(pname(p.id)), f(p.v))).join("") +
        (m.hasPrev ? row(esc(m.PY), f(m.cp[k] || 0)) : ""));
    });
    root.querySelectorAll("[data-mrm]").forEach((x) => {
      const h = m.hist.find((y) => y.key === x.dataset.mrm);
      if (!h) return;
      hover(x, "<b>" + esc(h.lab) + "</b>" + row(t("Came in"), f(h.s.inc)) + row(t("Went out"), f(h.s.exp)) + row(h.s.net >= 0 ? t("Kept") : t("Overspent"), f(Math.abs(h.s.net))));
      if (h.go) x.addEventListener("click", (ev) => { ev.stopPropagation(); hideTip(); goMonth(h.go.q); });
    });
    return;
  }
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
  pages.push([t("Kept"), '<div class="w-pmr"><span class="k">' + (s.net >= 0 ? t("Kept") : t("Overspent")) + '</span><div class="big amt' + (s.net < 0 ? " neg" : "") + '">' + bigMoney(Math.abs(s.net)) + "</div><p>" + m.head + "</p></div>" +
    keptBars(m, "ph") + tiles(m)]);
  const top = keys.length ? c[keys[0]] : 1;
  pages.push([t("Where it went"), '<h2 class="w-mrsh">' + t("Where it went") + "</h2>" + splitKey() +
    (keys.length ? '<div class="w-mrcard">' + keys.slice(0, 6).map((k) => '<a class="w-mrpw" href="' + catHref(m, k) + '" data-link><span class="top">' + tile(k, 30) + "<b>" + catName(k) + '</b><span class="amt">' + f(c[k]) + "</span></span>" +
      splitBar(m, k, ((c[k] / top) * 100).toFixed(1)) + vsUsual(m, k) + "</a>").join("") + "</div>" : '<p class="w-hint">' + (m.kind ? t("No spending.") : t("No spending this month.")) + "</p>") +
    (couple() ? '<p class="w-mrnote">' + sharedText(m) + "</p>" : "")]);
  if (m.kind !== "all") pages.push([t("What changed"), '<h2 class="w-mrsh">' + t("What changed") + "</h2>" + changed(m)]);
  if (m.budget) pages.push([t("Budget"), budgetPhone(m)]);
  if (couple()) pages.push([t("Each of you"), '<h2 class="w-mrsh">' + t("Each of you") + '</h2><div class="w-mrpcs">' + state.people.map((p) => person(m, String(p.id))).join("") + "</div>"]);
  const dayT = m.kind ? t("Month by month") : t("Day by day");
  pages.push([dayT, '<h2 class="w-mrsh">' + dayT + '</h2><div class="w-mrcard">' + kvList(m.kind ? monthRows(m) : dayRows(m)) + "</div>" +
    '<h2 class="w-mrsh sm">' + t("Bills") + '</h2><div class="w-mrcard">' + kvList(m.kind ? spanBillRows(m) : billRows(m)) + "</div>" +
    '<h2 class="w-mrsh sm">' + t("Worth knowing") + "</h2>" + knowTiles(m) +
    '<div class="w-mrsfoot"><a class="w-btn ghost" href="' + (m.kind ? spanTx(m) : "/transactions?month=" + mkey(m.q)) + '" data-link>' + t("See transactions") + '</a><a class="w-btn primary" href="' + (m.kind ? spanSum(m) : "/?month=" + mkey(m.q)) + '" data-link>' + t("Open in Summary") + "</a></div>"]);
  const bars = '<div class="w-story" aria-hidden="true">' + pages.map((x, i) => '<i class="' + (i <= story ? "on" : "") + '"></i>').join("") + "</div>";
  return '<div class="w-mrstory" aria-roledescription="' + esc(t("story")) + '">' + bars +
    '<div class="w-mrstop"><span class="w-mrsm">' + esc(m.kind ? spanTitle(m) : monthYear(m.q[0], m.q[1])) + "</span>" + tools(m, false) + "</div>" +
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
