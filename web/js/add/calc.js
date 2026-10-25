/* The add sheet's arithmetic and memory: shares in cents, income weights, payees seen before,
   category use and what a budget has left. Nothing here touches the page. */
import { state, totals, TODAY, ds, ym, ymAdd, dim, addD, evalAmt as coreEval, catIcon, isIncomeCat } from "../core.js";

/* What was typed in the amount field: {v, expr, ok}. v is in euros, rounded to cents.
   ok is false for anything that is not numbers, + and −. */
export function readAmount(raw) {
  const s = String(raw || "").trim();
  if (!s) return { v: 0, expr: false, ok: true, empty: true };
  const clean = s.replace(/[\s€$£¥₹₩₺₽₪]/g, "").replace(/−/g, "-");
  if (!/^[\d.,+\-]+$/.test(clean) || /[+\-]$/.test(clean)) {
    // A sum still being typed ("12+") counts as what is there so far
    const partial = clean.replace(/[+\-]+$/, "");
    if (partial && /^[\d.,+\-]+$/.test(partial) && partial !== clean) {
      const v = coreEval(partial);
      if (v !== null) return { v, expr: /\d[+\-]/.test(partial), ok: true, partial: true };
    }
    return { v: NaN, expr: false, ok: false };
  }
  const v = coreEval(clean);
  if (v === null) return { v: NaN, expr: false, ok: false };
  return { v, expr: /\d[+\-]/.test(clean), ok: true };
}
export const cents = (euros) => Math.round(euros * 100);

/* ---------- shares ---------- */
export function peopleKeys() { return state.people.map((p) => String(p.id)); }

/* Shares in whole cents from weights. Each gets the floor of its exact part; the spare cents go
   to whoever paid first, then to the largest remainders, so they always add up. */
export function sharesByWeight(total, weights, payer) {
  const keys = peopleKeys();
  const sum = keys.reduce((s, k) => s + (weights[k] || 0), 0);
  if (!sum) return evenShares(total, payer);
  const out = {}, rest = [];
  let given = 0;
  keys.forEach((k) => {
    const exact = (total * (weights[k] || 0)) / sum;
    const c = Math.floor(exact + 1e-9);
    out[k] = c; given += c;
    rest.push([k, exact - c]);
  });
  let spare = total - given;
  const order = rest.sort((a, b) => (a[0] === payer ? -1 : b[0] === payer ? 1 : b[1] - a[1])).map((x) => x[0]);
  for (let i = 0; spare > 0; i = (i + 1) % order.length, spare--) out[order[i]]++;
  return out;
}
/* As the server does it: equal parts, the spare cents to whoever paid, then in household order */
export function evenShares(total, payer) {
  const keys = peopleKeys();
  if (!keys.length) return {};
  const base = Math.floor(total / keys.length);
  let spare = total - base * keys.length;
  const out = {};
  keys.forEach((k) => { out[k] = base; });
  const order = keys.slice().sort((a, b) => (a === payer ? -1 : b === payer ? 1 : 0));
  for (let i = 0; spare > 0; i++, spare--) out[order[i]]++;
  return out;
}

/* Income from the 1st of the month three months ago to today, for each person */
export function incomeFrom() { const [y, m] = ym(TODAY); const q = ymAdd(y, m, -3); return ds(q[0], q[1], 1); }
export function incomeWeights() {
  const from = incomeFrom(), o = {};
  peopleKeys().forEach((k) => { o[k] = Math.max(0, totals(from, TODAY, k).inc); });
  return o;
}
/* Whole percentages that add up to 100, for labels like "By income 46/54" */
export function percents(weights) {
  const keys = peopleKeys(), sum = keys.reduce((s, k) => s + (weights[k] || 0), 0);
  if (!sum) return Object.fromEntries(keys.map((k, i) => [k, Math.floor(100 / keys.length) + (i < 100 % keys.length ? 1 : 0)]));
  const out = {}, rest = [];
  let given = 0;
  keys.forEach((k) => { const e = (100 * (weights[k] || 0)) / sum, c = Math.floor(e); out[k] = c; given += c; rest.push([k, e - c]); });
  rest.sort((a, b) => b[1] - a[1]);
  for (let i = 0; given < 100; i++, given++) out[rest[i % rest.length][0]]++;
  return out;
}
export function sameShares(a, b) {
  const keys = new Set(Object.keys(a || {}).concat(Object.keys(b || {})));
  for (const k of keys) if ((a[k] || 0) !== (b[k] || 0)) return false;
  return true;
}

/* ---------- memory of what was added before ---------- */
function median(l) { const s = l.slice().sort((a, b) => a - b), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; }
function top(o) { let best = null; for (const k in o) if (best === null || o[k] > o[best]) best = k; return best; }

/* Every payee seen, with what it usually is: category, person ("shared" or a key), tags and amount */
export function payeeIndex() {
  const m = new Map(), since = addD(TODAY, -90);
  for (const t of state.tx) {
    if (!t.n || t.pending) continue;
    const key = t.type + "\u0000" + t.n.toLowerCase();
    let x = m.get(key);
    if (!x) { x = { n: t.n, type: t.type, k: 0, k90: 0, tot: 0, as: [], ps: {}, tg: {}, last: t.d, c: t.c, cd: t.d }; m.set(key, x); }
    x.k++; x.tot += t.a; x.as.push(t.a);
    if (t.d >= since && !t.rec) x.k90++; // typed in lately, not added by a repeat rule
    if (t.d >= x.cd) { x.c = t.c; x.cd = t.d; } // the category it had last time, as in 1.x
    const pk = t.p === null ? "shared" : t.p;
    x.ps[pk] = (x.ps[pk] || 0) + 1;
    t.tags.forEach((g) => { x.tg[g] = (x.tg[g] || 0) + 1; });
    if (t.d > x.last) x.last = t.d;
  }
  return [...m.values()].map((x) => {
    x.p = top(x.ps); x.avg = Math.round((x.tot / x.k) * 100) / 100;
    // The usual amount and how far it strays, in ratios (2 to 3 € is as far as 20 to 30 €)
    const ls = x.as.map((a) => Math.log(Math.max(a, 0.01)));
    x.lmed = median(ls);
    x.lspread = Math.max(median(ls.map((l) => Math.abs(l - x.lmed))) * 1.5, 0.1);
    delete x.as;
    x.tags = Object.keys(x.tg).filter((g) => x.tg[g] * 2 >= x.k);
    return x;
  });
}
/* Expense categories, most used first, then the ones never used */
export function catUsage() {
  const o = {};
  for (const t of state.tx) if (t.type === "expense") o[t.c] = (o[t.c] || 0) + 1;
  const used = Object.keys(o).sort((a, b) => o[b] - o[a] || a.localeCompare(b));
  const unused = state.categories.filter((c) => !(c in o) && !isIncomeCat(c));
  return used.concat(unused);
}
/* The category an income gets: the one income usually has */
export function incomeCategory() {
  const o = {};
  for (const t of state.tx) if (t.type === "income") o[t.c] = (o[t.c] || 0) + 1;
  return top(o) || state.categories.find((c) => catIcon(c) === "income") || "Income";
}
/* Tags in use, most used first ("#coffee") */
export function allTags() {
  const o = {};
  state.tags.forEach((g) => { o["#" + g] = 0; });
  for (const t of state.tx) t.tags.forEach((g) => { o[g] = (o[g] || 0) + 1; });
  return Object.keys(o).sort((a, b) => o[b] - o[a] || a.localeCompare(b));
}

/* ---------- budgets ---------- */
/* What a category's budget has left in the period of a date (its month, or its year for yearly
   budgets), for the whole household, leaving out the transactions being edited. */
export function budgetLeft(category, date, skipIds) {
  const b = (state.budgets || []).find((x) => x.category === category);
  if (!b) return null;
  const [y, m] = ym(date);
  const yearly = b.kind === "yearly";
  const from = yearly ? ds(y, 1, 1) : ds(y, m, 1), to = yearly ? ds(y, 12, 31) : ds(y, m, dim(y, m));
  let spent = 0;
  for (const t of state.tx) {
    if (t.type !== "expense" || t.c !== category || t.d < from || t.d > to || (skipIds && skipIds.has(t.id))) continue;
    spent += t.a;
  }
  const amount = Number(b.amount) || 0;
  return { budget: b, amount, spent, left: Math.round((amount - spent) * 100) / 100, yearly, y, m };
}
