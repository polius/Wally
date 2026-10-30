/* Recurring rules in the browser: their dates, what they cost, and how they are described.
   Future dates are never stored; every calendar works them out here, the same way the
   server's engine does (days 29 to 31 fall on a shorter month's last day). */
import { state, t, tn, ds, addD, dim, wd, ym, ymAdd, span, TODAY, amt, dlab, F, num } from "./core.js";

export const PER = { daily: 365.25 / 12, weekly: 52.18 / 12, monthly: 1, yearly: 1 / 12 };

/* The dates of a rule between two days, both included */
export function ruleDates(r, from, to, limit) {
  const out = [], s = r.start, y0 = +s.slice(0, 4), m0 = +s.slice(5, 7), d0 = r.anchor || +s.slice(8), every = r.every || 1;
  const until = r.endDate || "9999-12-31";
  for (let k = 0; k < 40000; k++) {
    let d;
    if (r.freq === "daily") d = addD(s, k * every);
    else if (r.freq === "weekly") d = addD(s, k * 7 * every);
    else if (r.freq === "monthly") { const q = ymAdd(y0, m0, k * every); d = ds(q[0], q[1], Math.min(k === 0 ? +s.slice(8) : d0, dim(q[0], q[1]))); }
    else { const yy = y0 + k * every; d = ds(yy, m0, Math.min(k === 0 ? +s.slice(8) : d0, dim(yy, m0))); }
    if (d > until || d > to) break;
    if (d >= from) { out.push(d); if (limit && out.length >= limit) break; }
  }
  return out;
}
/* Every active rule's dates in a range, in date order */
export function occurrences(from, to) {
  const o = [];
  state.rules.forEach((r) => { if (r.paused) return; ruleDates(r, from, to).forEach((d) => o.push({ d, r })); });
  return o.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
}
/* What a rule costs whoever is shown */
export function ruleAmt(r, sc) { return amt({ p: r.p, a: r.a, sh: r.sh }, sc); }
export function perMonth(r, sc) { return (ruleAmt(r, sc) * PER[r.freq]) / (r.every || 1); }
export function isIncome(r) { return r.type === "income"; }
export function nextOf(r) { return r.paused ? null : ruleDates(r, addD(TODAY, 1), "2199-12-31", 1)[0] || null; }
export function active(r) { return !r.endDate || r.endDate >= TODAY; }
export function inDays(d) {
  const n = span(TODAY, d) - 1;
  return n === 0 ? t("today") : n === 1 ? t("tomorrow") : tn(n, "in {n} day", "in {n} days");
}
/* A rule's past transactions, across its versions (a change "from the next charge" makes a new rule) */
export function ruleHist(r) {
  const name = r.n.trim().toLowerCase();
  const ids = new Set(state.rules.filter((x) => x.n.trim().toLowerCase() === name && x.type === r.type).map((x) => x.id));
  ids.add(r.id);
  return state.tx.filter((x) => ids.has(x.rid)).slice().sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
}
export function priceChange(r) {
  if (r.varies) return null;
  const h = ruleHist(r);
  for (let i = h.length - 1; i > 0; i--) if (Math.abs(h[i].a - h[i - 1].a) > 0.005) return { from: h[i - 1].a, to: h[i].a, d: h[i].d };
  return null;
}
/* "Every 3 days": one string per unit, so every language can agree it with the number */
export function everyN(freq, n) {
  return {
    daily: tn(n, "Every {n} day", "Every {n} days"), weekly: tn(n, "Every {n} week", "Every {n} weeks"),
    monthly: tn(n, "Every {n} month", "Every {n} months"), yearly: tn(n, "Every {n} year", "Every {n} years"),
  }[freq];
}
/* "Every 2 weeks on Saturdays, 16 times" */
export function describe(r) {
  const d = r.start, e = r.every || 1;
  let base;
  if (e === 1) base = { daily: t("Every day"), weekly: t("Every week"), monthly: t("Every month"), yearly: t("Every year") }[r.freq];
  else base = everyN(r.freq, e);
  const on = r.freq === "weekly" ? t("on {day}", { day: F.wd.long[wd(d)] }) : r.freq === "monthly" ? t("on day {d}", { d: r.anchor || +d.slice(8) }) : r.freq === "yearly" ? t("on {date}", { date: dlab(d) }) : "";
  let end = "";
  if (r.end && r.end.type === "count") end = ", " + tn(r.end.count, "{n} time", "{n} times");
  else if (r.endDate) end = ", " + t("until {date}", { date: F.fullYear.format(Date.UTC(+r.endDate.slice(0, 4), +r.endDate.slice(5, 7) - 1, +r.endDate.slice(8))) });
  return base + (on ? " " + on : "") + end;
}
export function shortDesc(r) {
  const d = r.start, e = r.every || 1;
  return {
    daily: e === 1 ? t("Daily") : everyN("daily", e),
    weekly: (e === 1 ? t("Weekly") : everyN("weekly", e)) + ", " + F.wd.short[wd(d)],
    monthly: (e === 1 ? t("Monthly") : everyN("monthly", e)) + ", " + t("day {d}", { d: r.anchor || +d.slice(8) }),
    yearly: (e === 1 ? t("Yearly") : everyN("yearly", e)) + ", " + dlab(d),
  }[r.freq];
}
/* The end date for "after N times" */
export function endAfter(r, count) { const ds_ = ruleDates(Object.assign({}, r, { endDate: null }), r.start, "2199-12-31", count); return ds_[ds_.length - 1]; }
export { num };
