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
   - The even pace by today (the mark on each bar, and its tooltip): the limit spread evenly over the period, up to the end of
     today (the day of the month ÷ its days, or the day of the year ÷ its days).
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
  // A limit left on a category deleted on another device meanwhile is not shown
  return (state.budgets || []).filter((b) => b.since <= month && (!b.until || b.until >= month) && (b.category === EVERYTHING || state.categories.includes(b.category)));
}
export function limitFor(category, month) { return limitsIn(month || thisMonth()).find((b) => b.category === category) || null; }

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
  const upTo = TODAY < end ? TODAY : end;   // never what is dated after today
  const limit = Number(b.amount);
  const spent = spentIn(b.category, a, upTo);
  const due = now && !year ? dueIn(b.category, addD(TODAY, 1), end) : 0;
  const left = limit - spent - due;
  const days = now ? span(TODAY, last(month)) : 0;
  return {
    b, limit, spent, due, left, over: left < -0.004,
    perDay: now && !year && left > 0.004 ? left / days : null, days,
    today: now ? span(a, TODAY) / span(a, end) : null,
    even: now ? (limit * span(a, TODAY)) / span(a, end) : null,
  };
}

/* A month's total, for the last months */
export function monthSpent(category, month) { return spentIn(category, first(month), last(month)); }
/* The last three full months that have history */
export function pastMonths() { const now = thisMonth(); return [1, 2, 3].map((k) => monthAdd(now, -k)).filter((mo) => first(mo) >= START); }
/* What is usually spent in a month: the average of those months */
export function usualMonth(category) { const ms = pastMonths(); return ms.length ? ms.reduce((s, mo) => s + monthSpent(category, mo), 0) / ms.length : 0; }

/* A limit to start from: what is usually spent, rounded up to the next hundred for everything and the next ten
   for a category. null with no full month of history. */
export function suggested(category) {
  const v = usualMonth(category), step = category === EVERYTHING ? 100 : 10;
  return v > 0.004 ? Math.ceil(v / step) * step : null;
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
