/* Repeat in the add sheet: the rule being described, its summary and its next dates. */
import { t, tn, esc, TODAY, addD, dlab, dlabW, mmax, LANG } from "../core.js";
import { ruleDates, describe, endAfter, everyN } from "../sched.js";

/* The quick choices, as [frequency, every] */
export const FQ = { daily: ["daily", 1], weekly: ["weekly", 1], biweekly: ["weekly", 2], monthly: ["monthly", 1], yearly: ["yearly", 1] };
export const FQ_LABELS = () => [
  ["daily", t("Daily")], ["weekly", t("Weekly")], ["biweekly", t("Every 2 weeks")], ["monthly", t("Monthly")], ["yearly", t("Yearly")], ["custom", t("Custom")],
];
export const UNITS = () => [["daily", t("days")], ["weekly", t("weeks")], ["monthly", t("months")], ["yearly", t("years")]];

/* Which quick choice a frequency and interval is */
export function fqOf(freq, every) {
  for (const k in FQ) if (FQ[k][0] === freq && FQ[k][1] === (every || 1)) return k;
  return "custom";
}
export const clampInt = (v, lo, hi, dflt) => { const n = parseInt(v, 10); return isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt; };

/* The rule the sheet describes: {start, freq, every, end:{type, until|count}, endDate} */
export function formRule(ad, start) {
  const [freq, every] = ad.fq === "custom" ? [ad.unit, clampInt(ad.every, 1, 99, 1)] : FQ[ad.fq];
  const r = { start, freq, every, anchor: null, end: { type: ad.end }, endDate: null };
  if (ad.end === "until") { r.end.until = ad.until; r.endDate = ad.until || null; }
  if (ad.end === "count") { r.end.count = clampInt(ad.count, 2, 999, 2); r.endDate = endAfter(r, r.end.count); }
  return r;
}
export function lc1(s) { return s ? s.charAt(0).toLocaleLowerCase(LANG) + s.slice(1) : s; }
/* A short date, with the year only when it is not the year of `ref` (today by default) */
const FMT = {};
function fmt(key, opts) {
  const k = LANG + key;
  return FMT[k] || (FMT[k] = new Intl.DateTimeFormat(LANG, Object.assign({ timeZone: "UTC" }, opts)));
}
export function withYear(d, ref) {
  if (d.slice(0, 4) === (ref || TODAY).slice(0, 4)) return dlab(d);
  return fmt("dmy", { day: "numeric", month: "short", year: "numeric" }).format(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8)));
}
export function withYearW(d, ref) {
  if (d.slice(0, 4) === (ref || TODAY).slice(0, 4)) return dlabW(d);
  return fmt("wdmy", { weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8)));
}

/* "Every 2 weeks on Saturday, 12 times, starting Sat 24 Oct, last one 27 Mar 2027." with notes */
export function summaryHtml(r) {
  const last = r.end.type === "count" ? r.endDate : null;
  let s = last
    ? t("{rule}, starting {date}, last one {last}.", { rule: describe(r), date: withYearW(r.start, TODAY), last: withYear(last, r.start) })
    : t("{rule}, starting {date}.", { rule: describe(r), date: withYearW(r.start, TODAY) });
  s = esc(s);
  const past = r.start < TODAY ? ruleDates(r, addD(r.start, 1), TODAY).length : 0;
  if (past) s += "<small>" + esc(tn(past, "It started in the past, so {n} more up to today is added too.", "It started in the past, so {n} more up to today are added too.")) + "</small>";
  const d0 = +r.start.slice(8);
  if (r.freq === "monthly" && d0 > 28) s += "<small>" + esc(t("In shorter months it falls on the last day.")) + "</small>";
  else if (r.freq === "yearly" && r.start.slice(5) === "02-29") s += "<small>" + esc(t("In other years it falls on 28 February.")) + "</small>";
  return s;
}
/* The next three dates after the start (or after today, for a rule that started in the past) */
export function nextDates(r) {
  if (r.end.type === "until" && !r.end.until) return [];
  return ruleDates(r, addD(mmax(r.start, TODAY), 1), "2199-12-31", 3);
}
export function nextHtml(r) {
  const nx = nextDates(r);
  return nx.length ? esc(t("Next")) + " " + nx.map((d) => "<span>" + esc(withYearW(d, r.start)) + "</span>").join("") : esc(t("No more after this one"));
}
/* Short label for the phone's Repeat cell: "Every 2 weeks, 12 times" */
export function shortLabel(ad) {
  if (!ad.rep) return t("Never");
  const base = ad.fq === "custom"
    ? everyN(ad.unit, clampInt(ad.every, 1, 99, 1))
    : FQ_LABELS().find((x) => x[0] === ad.fq)[1];
  if (ad.end === "count") return base + ", " + tn(clampInt(ad.count, 2, 999, 2), "{n} time", "{n} times");
  if (ad.end === "until" && ad.until) return base + ", " + t("until {date}", { date: withYear(ad.until) });
  return base;
}
