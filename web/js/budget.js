/* The budget, worked out here from the limits (/budgets), the ledger and the recurring rules, as every
   other figure is. The rules, exactly:
   - A limit has a category ("" is everything), an amount, a period (month or year) and the months it
     applies (since … until). A change made in a month applies from that month on.
   - Spent: expenses in the category, dated in the period, up to today; bills included, for the whole
     household (the Summary's Categories card, for Everyone).
   - Bills still due (monthly limits, this month only): the recurring bills in the category after
     today and before the month ends, from rules that are not paused, at their current amount.
   - Left = limit − spent − bills still due; below zero it is "over". For a year, limit − spent.
   - A day = left ÷ the days from today to the month's end, today included; this month only, when left > 0.
   - Today's mark: the day of the month ÷ its days, or the day of the year ÷ its days.
   Amounts are never rounded. */
import { state, TODAY, ds, dim, ym, ymAdd, addD, span, byCat, START } from "./core.js";
import { ruleDates, ruleAmt } from "./sched.js";

export const EVERYTHING = "";
export const thisMonth = () => TODAY.slice(0, 7);
const first = (month) => month + "-01";
const last = (month) => { const [y, m] = ym(first(month)); return ds(y, m, dim(y, m)); };
export function monthAdd(month, k) { const [y, m] = ym(first(month)); const q = ymAdd(y, m, k); return q[0] + "-" + (q[1] < 10 ? "0" : "") + q[1]; }

/* The limits in force in a month: at most one per category */
export function limitsIn(month) {
  return (state.budgets || []).filter((b) => b.since <= month && (!b.until || b.until >= month));
}
export function limitFor(category, month) { return limitsIn(month || thisMonth()).find((b) => b.category === category) || null; }
export function anyLimits() { return (state.budgets || []).length > 0; }

/* What was spent between two days: one category, or everything */
export function spentIn(category, a, b) {
  const o = byCat(a, b, "all");
  if (category !== EVERYTHING) return o[category] || 0;
  let v = 0;
  for (const k in o) v += o[k];
  return v;
}
/* Recurring bills still to come this month, after today */
export function dueIn(category, a, b) {
  let v = 0;
  for (const r of state.rules) {
    if (r.paused || r.type === "income" || (category !== EVERYTHING && r.c !== category)) continue;
    const n = ruleDates(r, a, b).length;
    if (n) v += n * ruleAmt(r, "all");
  }
  return v;
}

/* Every figure of one limit in one month */
export function figure(b, month) {
  month = month || thisMonth();
  const now = month === thisMonth(), year = b.period === "year";
  const a = year ? month.slice(0, 4) + "-01-01" : first(month);
  const end = year ? month.slice(0, 4) + "-12-31" : last(month);
  const upTo = now ? (TODAY < end ? TODAY : end) : end;
  const limit = Number(b.amount);
  const spent = spentIn(b.category, a, upTo);
  const due = now && !year ? dueIn(b.category, addD(TODAY, 1), end) : 0;
  const left = limit - spent - due;
  const days = now ? span(TODAY, last(month)) : 0;
  return {
    b, limit, spent, due, left, over: left < -0.004,
    perDay: now && !year && left > 0.004 ? left / days : null, days,
    today: now ? (span(a, TODAY) - 1 + 0.5) / span(a, end) : null,
  };
}

/* What a category (or everything) usually costs by this day of the month: the last three months, as Worth noticing does */
export function usuallyByNow(category) {
  const [y, m] = ym(TODAY), day = +TODAY.slice(8);
  let v = 0, n = 0;
  for (let k = 1; k <= 3; k++) {
    const q = ymAdd(y, m, -k), a = ds(q[0], q[1], 1);
    if (a < START) continue;
    v += spentIn(category, a, ds(q[0], q[1], Math.min(day, dim(q[0], q[1]))));
    n++;
  }
  return n ? v / n : null;
}
/* A month's total, for the last months */
export function monthSpent(category, month) { return spentIn(category, first(month), last(month)); }

/* The first time: a limit for everything and one per category, each from the last three full months,
   rounded up (to the next ten for a category, the next hundred for everything). Categories that are
   almost all recurring bills (rent) are left out: a limit there says nothing. The biggest everyday
   ones start switched on. With less than one full month of history there is nothing to go by. */
export function suggestions() {
  const now = thisMonth(), months = [1, 2, 3].map((k) => monthAdd(now, -k)).filter((mo) => first(mo) >= START);
  const avg = (cat) => months.reduce((s, mo) => s + monthSpent(cat, mo), 0) / months.length;
  const fromBills = {}, total = {}, count = {}, inMonth = {};
  for (const x of state.tx) {
    if (x.type !== "expense" || !months.length || x.d < first(months[months.length - 1]) || x.d > last(months[0])) continue;
    total[x.c] = (total[x.c] || 0) + x.a;
    if (x.rec) fromBills[x.c] = (fromBills[x.c] || 0) + x.a;
    else { count[x.c] = (count[x.c] || 0) + 1; (inMonth[x.c] = inMonth[x.c] || new Set()).add(x.d.slice(0, 7)); }
  }
  // Everyday: bought in every one of those months, at least twice a month, and not mostly bills (travel is not)
  const everydayCat = (c) => (fromBills[c] || 0) / total[c] < 0.5 && (inMonth[c] ? inMonth[c].size : 0) === months.length && (count[c] || 0) >= 2 * months.length;
  const up = (v, step) => (v > 0 ? Math.ceil(v / step) * step : null);
  const cats = Object.keys(total).filter((c) => total[c] > 0 && (fromBills[c] || 0) / total[c] < 0.9)
    .map((c) => ({ category: c, usual: avg(c) })).sort((a, b) => b.usual - a.usual);
  let everyday = 0;
  cats.forEach((s) => {
    s.amount = months.length ? up(s.usual, 10) : null;
    s.on = !!s.amount && everydayCat(s.category) && everyday++ < 3;
  });
  const usual = months.length ? avg(EVERYTHING) : 0;
  return { history: months.length > 0, everything: { category: EVERYTHING, usual, amount: months.length ? up(usual, 100) : null, on: months.length > 0 }, cats };
}

/* The toast after adding an expense (B5): what is left, or how far over. null when there is no limit. */
export function afterAdding(category, date) {
  if (!date || date.slice(0, 7) !== thisMonth()) return null;
  const own = limitFor(category);
  if (own && own.period === "month") { const fg = figure(own); return { category, left: fg.left, over: fg.over }; }
  const all = limitFor(EVERYTHING);
  if (all && all.period === "month") { const fg = figure(all); return { category: EVERYTHING, left: fg.left, over: fg.over }; }
  return null;
}

/* Worth noticing (B4): the largest overrun of a monthly limit this month, if any */
export function largestOverrun() {
  let worst = null;
  for (const b of limitsIn(thisMonth())) {
    if (b.period !== "month") continue;
    const fg = figure(b);
    if (fg.over && (!worst || fg.left < worst.left)) worst = fg;
  }
  return worst;
}
