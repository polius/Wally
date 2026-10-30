/* Transactions: what is shown. The view state, the search language, the range and the filter.
   Nothing here touches the page; it only works out which transactions to show. */
import { state, t, F, LANG, ds, dim, ym, pad, TODAY, START, dlab, monthYear, amt, pname, parseAmt, f0 } from "../../core.js";

/* The view state. It lives as long as the app does; mount() resets it from the address. */
export const S = {
  mode: "month",        // month | year | custom | all
  ym: [0, 0],           // the month shown in month mode and in the calendar
  custom: null,         // [from, to] in custom mode
  searchAll: true,      // a search looks in every month, until "Only this range"
  q: "",                // what is typed in the search box
  type: "all",          // all | expense | income
  cats: new Set(),      // category names picked
  shared: false,        // Shared only
  day: null,            // one day picked in the strip (list view)
  view: "list",         // list | cal
  calDay: null,         // the day picked in the calendar
  sel: null,            // the selected transaction id
  open: false,          // the side panel is open (it slides over the list below 1280 px)
  selMode: false,       // Select mode
  picked: new Set(),    // ids picked in Select mode
};
export function resetView() {
  Object.assign(S, {
    mode: "month", ym: ym(TODAY), custom: null, searchAll: true, q: "", type: "all", cats: new Set(), shared: false,
    day: null, view: "list", calDay: null, sel: null, open: false, selMode: false, picked: new Set(),
  });
}

export const RANGES = ["month", "year", "all"];
const lower = (s) => String(s || "").toLocaleLowerCase(LANG);

/* The last day any range reaches: today, or a later date someone gave a transaction */
export function lastDay() { const top = state.tx[0]; return top && top.d > TODAY ? top.d : TODAY; }
export function firstDay() { return START < TODAY ? START : TODAY.slice(0, 8) + "01"; }
const monthEnd = (y, m) => ds(y, m, dim(y, m));

/* ---------- the search language ----------
   Words search names, categories, tags, amounts, people and notes. Some words are filters:
   >50 and <20 (amounts), #tag, @person or @shared, a category name, a month name, a year. */
export function parseQ(q) {
  const o = { text: [], textIdx: [], min: null, max: null, who: null, tags: [], cats: [], month: null, year: null, chips: [] };
  const words = String(q || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return o;
  const catsBy = new Map();
  state.categories.forEach((c) => catsBy.set(lower(c), c));
  const months = F.months.map(lower);
  const people = state.people.map((p) => [lower(p.name).replace(/\s+/g, ""), String(p.id)]);
  const shared = new Set(["shared", lower(t("Shared")).replace(/\s+/g, "")]);
  for (let i = 0; i < words.length; i++) {
    const w = words[i], lw = lower(w);
    let m;
    // A category name can have several words ("Home cleaning"): the longest match wins
    let hit = null, k = Math.min(4, words.length - i);
    for (; k >= 1; k--) { const name = lower(words.slice(i, i + k).join(" ")); if (catsBy.has(name)) { hit = catsBy.get(name); break; } }
    if ((m = lw.match(/^>(\d[\d.,]*)$/)) && parseAmt(m[1]) !== null) {
      o.min = parseAmt(m[1]); o.chips.push({ label: t("over {amount}", { amount: f0(o.min) }), idx: [i] });
    } else if ((m = lw.match(/^<(\d[\d.,]*)$/)) && parseAmt(m[1]) !== null) {
      o.max = parseAmt(m[1]); o.chips.push({ label: t("under {amount}", { amount: f0(o.max) }), idx: [i] });
    } else if (lw[0] === "@" && lw.length > 1) {
      const who = lw.slice(1);
      const p = shared.has(who) ? ["shared", "shared"] : people.find(([n]) => n === who) || people.find(([n]) => n.startsWith(who));
      if (p) { o.who = p[1]; o.chips.push({ label: p[1] === "shared" ? lower(t("Shared")) : pname(p[1]), idx: [i] }); }
      else { o.text.push(lw); o.textIdx.push(i); }
    } else if (lw[0] === "#" && lw.length > 1) {
      o.tags.push(lw); o.chips.push({ label: w, idx: [i] });
    } else if (hit) {
      o.cats.push(hit); o.chips.push({ label: hit, idx: Array.from({ length: k }, (_, j) => i + j) }); i += k - 1;
    } else if (/^(19|20)\d\d$/.test(lw) && !o.year) {
      o.year = +lw; o.chips.push({ label: lw, idx: [i] });
    } else if (lw.length >= 3 && !o.month && months.some((x) => x.startsWith(lw))) {
      o.month = months.findIndex((x) => x.startsWith(lw)) + 1; o.chips.push({ label: F.months[o.month - 1], idx: [i] });
    } else { o.text.push(lw); o.textIdx.push(i); }
  }
  if (o.text.length) o.chips.push({ label: "“" + o.text.join(" ") + "”", idx: o.textIdx });
  return o;
}
/* The search with some of its words taken out (removing a chip) */
export function withoutWords(q, idx) {
  const drop = new Set(idx);
  return String(q || "").trim().split(/\s+/).filter((w, i) => w && !drop.has(i)).join(" ");
}

/* ---------- the range shown: a month, a longer range, or every month while searching ---------- */
export function txRange(P) {
  P = P || parseQ(S.q);
  const cal = S.view === "cal", last = lastDay(), [ty, tm] = ym(TODAY);
  if (P.month) {
    const y = P.year || (P.month > tm ? ty - 1 : ty);
    return { a: ds(y, P.month, 1), b: monthEnd(y, P.month), month: [y, P.month], title: F.months[P.month - 1], sub: String(y), fromQuery: true };
  }
  if (P.year && !cal) return { a: ds(P.year, 1, 1), b: ds(P.year, 12, 31), title: String(P.year), sub: P.year === ty ? t("so far") : "", fromQuery: true };
  if (!cal && S.q.trim() && S.searchAll && S.mode !== "all") return { a: firstDay(), b: last, search: true, title: t("Search"), sub: t("every month") };
  if (cal || S.mode === "month") {
    const [y, m] = S.ym;
    return { a: ds(y, m, 1), b: monthEnd(y, m), month: [y, m], title: F.months[m - 1], sub: String(y) };
  }
  if (S.mode === "year") return { a: ds(ty, 1, 1), b: last, title: String(ty), sub: t("so far") };
  if (S.mode === "custom" && S.custom) {
    const [a, b] = S.custom;
    return { a, b, title: dlab(a) + " – " + dlab(b), sub: a.slice(0, 4) === b.slice(0, 4) ? a.slice(0, 4) : a.slice(0, 4) + " – " + b.slice(0, 4) };
  }
  const a = firstDay();
  return { a, b: last, title: t("All time"), sub: t("since {month}", { month: monthYear(...ym(a)) }) };
}
/* "Only October 2026", for narrowing a search to the range picked */
export function onlyLabel() {
  const [y, m] = S.ym;
  return {
    month: t("Only {range}", { range: monthYear(y, m) }), year: t("Only {range}", { range: TODAY.slice(0, 4) }),
    custom: t("Only this range"),
  }[S.mode] || "";
}
export function inLabel() {
  const [y, m] = S.ym;
  return {
    month: t("in {range}", { range: monthYear(y, m) }), year: t("in {range}", { range: TODAY.slice(0, 4) }),
    custom: t("in this range"),
  }[S.mode] || "";
}

/* ---------- the filter ---------- */
/* What a word is looked for in, worked out once per transaction */
const HAY = new WeakMap();
export function clearHay() { /* a WeakMap forgets replaced transactions by itself; people renamed need a fresh one */ HAYGEN++; }
let HAYGEN = 0;
function hay(x) {
  let h = HAY.get(x);
  if (!h || h.g !== HAYGEN) {
    const a = x.a.toFixed(2);
    h = { g: HAYGEN, s: lower([x.n, x.c, x.tags.join(" "), a, a.replace(".", ","), pname(x.p), x.note].join(" ")) };
    HAY.set(x, h);
  }
  return h.s;
}
/* The transactions shown, newest first. ignoreDay leaves out the day picked in the strip. */
export function txFiltered(R, P, ignoreDay) {
  const { a, b } = R, sc = state.scope, cats = S.cats, hasCats = cats.size > 0, day = ignoreDay ? null : S.day;
  const tags = P.tags, pcats = P.cats.length ? new Set(P.cats) : null, text = P.text;
  const out = [];
  for (const x of state.tx) {
    if (x.d > b) continue;
    if (x.d < a) break; // the ledger is newest first
    if (day && x.d !== day) continue;
    if (S.shared && x.p !== null) continue;
    if (sc !== "all" && !amt(x)) continue;
    if (S.type !== "all" && x.type !== S.type) continue;
    if (hasCats && !cats.has(x.c)) continue;
    if (P.min !== null && x.a < P.min) continue;
    if (P.max !== null && x.a > P.max) continue;
    if (P.who && (P.who === "shared" ? x.p !== null : x.p !== P.who)) continue;
    if (tags.length && !tags.every((g) => x.tags.some((tg) => lower(tg) === g))) continue;
    if (pcats && !pcats.has(x.c)) continue;
    if (text.length) { const h = hay(x); if (!text.every((w) => h.includes(w))) continue; }
    out.push(x);
  }
  return out;
}

/* Is anything narrowing the list besides the range? */
export function filtering() { return !!(S.q.trim() || S.cats.size || S.shared || S.type !== "all" || S.day); }

/* ---------- the address ---------- */
export function fromQuery(q) {
  resetView();
  const day = q.get("day");
  const okDay = (s) => /^\d{4}-\d\d-\d\d$/.test(s || "");
  // Links from before 3 months and 12 months were retired open as Month and Year
  const mode = { "3m": "month", "12m": "year" }[q.get("mode")] || q.get("mode");
  if (RANGES.includes(mode) || mode === "custom") S.mode = mode;
  if (/^\d{4}-\d\d$/.test(q.get("ym") || "")) { const [y, m] = q.get("ym").split("-").map(Number); if (m >= 1 && m <= 12) S.ym = [y, m]; }
  if (S.mode === "custom") {
    const a = q.get("from"), b = q.get("to");
    if (okDay(a) && okDay(b)) S.custom = a <= b ? [a, b] : [b, a];
    else S.mode = "month";
  }
  q.getAll("cat").forEach((c) => c && S.cats.add(c));
  if (q.get("type") === "expense" || q.get("type") === "income") S.type = q.get("type");
  if (q.get("shared") === "1") S.shared = true;
  if (q.has("q")) { S.q = q.get("q"); S.searchAll = !q.has("mode"); }
  if (q.get("view") === "cal") {
    S.view = "cal"; S.mode = "month";
    if (okDay(day)) { S.calDay = day; S.ym = ym(day); }
  } else if (okDay(day)) {
    S.day = day; S.mode = "month"; S.ym = ym(day);
  }
  const id = q.get("id");
  if (id) {
    const x = state.tx.find((y) => y.id === id);
    if (x) {
      S.sel = x.id; S.open = true; S.view = "list";
      if (x.d < txRange().a || x.d > txRange().b) { S.mode = "month"; S.ym = ym(x.d); S.day = null; }
    }
  }
}
export function toQuery() {
  const q = new URLSearchParams();
  const thisMonth = ym(TODAY);
  if (S.view === "cal") {
    q.set("view", "cal");
    if (S.calDay) q.set("day", S.calDay); else if (S.ym[0] !== thisMonth[0] || S.ym[1] !== thisMonth[1]) q.set("ym", S.ym[0] + "-" + pad(S.ym[1]));
  } else {
    const keepMode = !(S.q.trim() && S.searchAll); // a search in every month says nothing about the range
    if (S.day) q.set("day", S.day);
    else if (keepMode && S.mode !== "month") {
      q.set("mode", S.mode);
      if (S.mode === "custom" && S.custom) { q.set("from", S.custom[0]); q.set("to", S.custom[1]); }
    } else if (keepMode && (S.ym[0] !== thisMonth[0] || S.ym[1] !== thisMonth[1] || S.q.trim())) {
      if (S.q.trim()) q.set("mode", "month");
      q.set("ym", S.ym[0] + "-" + pad(S.ym[1]));
    }
  }
  if (S.q.trim()) q.set("q", S.q.trim());
  S.cats.forEach((c) => q.append("cat", c));
  if (S.type !== "all") q.set("type", S.type);
  if (S.shared) q.set("shared", "1");
  const s = q.toString();
  return "/transactions" + (s ? "?" + s : "");
}
