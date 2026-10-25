/* One month grid, shared by Transactions, Recurring and the Dashboard's Day by day.
   Past days show what was spent; days still to come show bills that will land (dashed). */
import { state, t, tn, esc, ds, dim, addD, wkOff, dows, TODAY, amt, fk, f, cc, tile, dlabL } from "./core.js";
import { occurrences, ruleAmt, isIncome } from "./sched.js";
import { hover, row } from "./ui.js";

/* What happened on each day, for whoever is shown */
export function dayMap(list) {
  const by = {};
  list.forEach((x) => { const v = amt(x); if (v) (by[x.d] = by[x.d] || []).push({ n: x.n, c: x.c, a: v, inc: x.type === "income", id: x.id }); });
  return by;
}
/* What rules will add on each day still to come this month; keep(rule, income) filters */
export function schedMap(y, m, keep) {
  const last = ds(y, m, dim(y, m)), o = {};
  if (last > TODAY) occurrences(addD(TODAY, 1), last).forEach((x) => {
    const r = x.r, v = ruleAmt(r), inc = isIncome(r);
    if (!v || (keep && !keep(r, inc))) return;
    (o[x.d] = o[x.d] || []).push({ n: r.n, c: r.c, a: v, inc, r });
  });
  return o;
}
/* The grid's buttons. key names the data attribute each day carries (data-<key>="2026-10-24").
   Returns {html, ns: no-spend days so far, best: longest no-spend run} */
export function monthGrid(y, m, by, sched, sel, key) {
  const D = dim(y, m), first = ds(y, m, 1);
  let cells = dows().map((d) => '<span class="dow" aria-hidden="true">' + esc(d) + "</span>").join(""), ns = 0, run = 0, best = 0;
  for (let i = 0; i < wkOff(first); i++) cells += "<span></span>";
  for (let d = 1; d <= D; d++) {
    const s = ds(y, m, d), fut = s > TODAY, items = (fut ? sched[s] : by[s]) || [];
    let out = 0, inn = 0;
    const cs = {};
    items.forEach((x) => { if (x.inc) inn += x.a; else { out += x.a; cs[x.c] = (cs[x.c] || 0) + x.a; } });
    if (!fut) { if (!out) { ns++; run++; best = Math.max(best, run); } else run = 0; }
    const ck = Object.keys(cs).sort((a, b) => cs[b] - cs[a]);
    const inc = items.find((x) => x.inc);
    if (inc) ck.push(inc.c);
    const ic = ck.slice(0, 2).map((c) => tile(c, 18)).join("") + (ck.length > 2 ? '<span class="more">+' + (ck.length - 2) + "</span>" : "");
    const label = dlabL(s) + (out ? ", " + t("spent {amount}", { amount: f(out) }) : "") + (inn ? ", " + t("came in {amount}", { amount: f(inn) }) : "") + (fut && items.length ? ", " + t("to come") : "");
    cells += '<button type="button" class="w-rday' + (fut ? " fut" : "") + (s === TODAY ? " t" : "") + (inn && !fut ? " in" : "") + (s === sel ? " sel" : "") + '" data-' + key + '="' + s + '"' +
      (sel !== null && sel !== undefined ? ' aria-pressed="' + (s === sel) + '"' : "") + ' aria-label="' + esc(label) + '"><span class="d">' + d + '</span><span class="ics">' + ic + '</span><span class="v">' +
      (inn ? '<b class="pos">+' + fk(inn) + "</b> " : "") + (out ? fk(out) : "") + "</span></button>";
  }
  return { html: cells, ns, best };
}
export function gridHover(box, key, by, sched) {
  box.querySelectorAll("[data-" + key + "]").forEach((b) => {
    const s = b.getAttribute("data-" + key), items = (s > TODAY ? sched[s] : by[s]) || [];
    if (items.length) hover(b, () => "<b>" + esc(dlabL(s)) + (s > TODAY ? ", " + t("to come") : "") + "</b>" +
      items.slice().sort((a, c) => c.a - a.a).slice(0, 4).map((x) => row(esc(x.n || x.c), (x.inc ? "+" : "") + f(x.a), cc(x.c))).join("") +
      (items.length > 4 ? row(t("And {n} more", { n: items.length - 4 }), "") : ""));
  });
}
export function noSpendText(ns) { return tn(ns, "{n} no-spend day", "{n} no-spend days"); }
