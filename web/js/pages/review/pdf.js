/* Month in review as a printed report, in the review's own order: A4 pages laid out here, then the browser's own print, where
   "Save as PDF" makes the file. Text stays text, charts stay vector. It always prints light, whatever
   the theme, and it is the same report from the Export button or from ⌘P / Ctrl+P on the page.
   Pages are filled section by section: a section that doesn't fit starts the next page, so nothing
   is ever cut in two. Each page has the same header and a footer with its number. */
import {
  t, tn, esc, state, f0, pct, TODAY, totals, cat, pname, couple, initial, monthYear, F, dlab, ds, dim, amt,
} from "../../core.js";
import { highlights, dayRows, billRows, sharedText, splitParts } from "../review.js";

/* Paper is white whatever the app's theme, and it prints in black and grey: green and red only for
   money, category colours only on the small dots that name them */
const C = ["#14804A", "#FA5252", "#FD7E14", "#FAB005", "#40C057", "#15AABF", "#228BE6", "#7950F2", "#E64980", "#ADB5BD"];
const col = (k) => C[cat(k).c] || C[9];
const catName = (k) => esc(cat(k).n);
const mon = (q) => F.months[q[1] - 1];
/* A share of spending: under 1% says so rather than 0% */
const share = (x) => (x > 0 && x < 0.005 ? "<" + pct(0.01) : pct(x));
const MAX_CATS = 12;
const LONG = () => new Intl.DateTimeFormat(document.documentElement.lang || undefined, { day: "numeric", month: "long", year: "numeric" });
let NARROW = null;
const narrow = (q) => (NARROW || (NARROW = new Intl.DateTimeFormat(document.documentElement.lang || undefined, { month: "narrow", timeZone: "UTC" }))).format(Date.UTC(q[0], q[1] - 1, 15));

/* ---------- small pieces ---------- */
function delta(cur, ref, goodUp, month) {
  const d = cur - ref;
  if (Math.abs(d) < Math.max(5, Math.abs(ref) * 0.03)) return '<span class="pr-d">' + esc(t("About the same as {month}", { month })) + "</span>";
  const amount = f0(Math.abs(d));
  return '<span class="pr-d ' + ((d > 0) === goodUp ? "good" : "bad") + '">' + (d > 0 ? "↑ " : "↓ ") + esc(d > 0 ? t("{amount} more", { amount }) : t("{amount} less", { amount })) + "</span>";
}
function short(cur, ref) {
  const d = cur - ref;
  if (Math.abs(d) < Math.max(5, Math.abs(ref) * 0.03)) return '<span class="pr-d">' + esc(t("Same")) + "</span>";
  return '<span class="pr-d ' + (d > 0 ? "bad" : "good") + '">' + esc(d > 0 ? t("{amount} more", { amount: f0(d) }) : t("{amount} less", { amount: f0(-d) })) + "</span>";
}
const sw = (k) => '<i class="pr-sw" style="background:' + col(k) + '"></i>';
function avatar(key) { return '<span class="pr-av">' + esc(initial(pname(key))) + "</span>"; }
function section(title, sub, body, cls, extra) {
  return '<section class="pr-sec ' + (cls || "") + '"><h2><span>' + title + (sub ? "<small>" + sub + "</small>" : "") + "</span>" + (extra || "") + "</h2>" + body + "</section>";
}
function splitKey() {
  if (!couple()) return "";
  const ppl = state.people.map((p, i) => '<span><i class="p' + Math.min(i, 5) + '"></i>' + esc(p.name) + "</span>");
  ppl.splice(1, 0, '<span><i class="sh"></i>' + esc(t("Shared")) + "</span>");
  return '<span class="pr-key">' + ppl.join("") + "</span>";
}

/* ---------- page 1 ---------- */
function titleBlock(m) {
  const who = m.sc === "all" ? (couple() ? state.people.map((p) => esc(p.name)).join(" · ") : "") : esc(pname(m.sc));
  return '<div class="pr-title"><span class="pr-eye">' + esc(t("Month in review")) + "</span><h1>" + esc(monthYear(m.q[0], m.q[1])) + "</h1><p>" +
    esc(LONG().formatRange(new Date(m.a + "T12:00:00"), new Date(m.b + "T12:00:00"))) + (who ? " · " + who : "") + "</p></div>";
}
/* What was kept, and the last 12 months as bars: grey, the month in green */
function heroBlock(m) {
  const { s, hist } = m, kept = s.net >= 0, mx = Math.max(...hist.map((x) => Math.abs(x.s.net)), 1);
  const bars = '<div class="pr-bars"><div class="b">' + hist.map((x) => {
    const on = x.q[0] === m.q[0] && x.q[1] === m.q[1], v = x.s.net;
    return '<i class="' + (on ? "on" : "") + (v < 0 ? " neg" : "") + '" style="height:' + Math.max(3, (Math.abs(v) / mx) * 100).toFixed(1) + '%"></i>';
  }).join("") + '</div><div class="ax">' + hist.map((x) => "<span" + (x.q[0] === m.q[0] && x.q[1] === m.q[1] ? ' class="on"' : "") + ">" + esc(narrow(x.q)) + "</span>").join("") + "</div></div>";
  return '<div class="pr-hero"><div class="pr-heroL"><span class="pr-k">' + esc(kept ? t("Kept") : t("Overspent")) + '</span><div class="pr-big ' + (kept ? "good" : "bad") + '">' + f0(Math.abs(s.net)) + "</div>" +
    "<p>" + m.head + "</p></div>" +
    '<div class="pr-heroR">' + bars + '<div class="pr-cap">' + esc(t("Money kept, last {n} months", { n: hist.length })) + "</div></div></div>";
}
function kpiBlock(m) {
  const { s, prev, u } = m, PM = mon(m.pq);
  const k = (label, cur, p, us, goodUp) => "<div><span>" + esc(label) + "</span><b>" + f0(cur) + "</b>" + (prev ? delta(cur, p, goodUp, PM) : "") +
    (u.n ? "<small>" + esc(t("Usual {amount}", { amount: f0(us) })) + "</small>" : "") + "</div>";
  return '<div class="pr-kpi">' + k(t("Came in"), s.inc, prev && prev.inc, u.inc, true) + k(t("Went out"), s.exp, prev && prev.exp, u.exp, false) +
    k(t("Bills"), s.bills, prev && prev.bills, u.bills, false) + k(t("Everyday"), s.day, prev && prev.day, u.day, false) + "</div>";
}
/* Where it went: a dot names the category, the bar says who spent it */
function catsBlock(m) {
  const { c, cu, keys, s, u } = m;
  if (!keys.length) return section(esc(t("Where it went")), "", '<p class="pr-note">' + esc(t("No spending this month.")) + "</p>");
  const shown = keys.slice(0, MAX_CATS), rest = keys.slice(MAX_CATS), top = c[keys[0]];
  const bar = (k, v) => '<span class="pr-split" style="width:' + ((v / top) * 100).toFixed(1) + '%">' + splitParts(m, k).map((x) => '<i class="' + x.cls + '" style="flex:' + x.v.toFixed(2) + '"></i>').join("") + "</span>";
  let rows = shown.map((k) => '<div class="pr-cr">' + sw(k) + '<b class="n">' + catName(k) + '</b><span class="bar">' + bar(k, c[k]) + '</span><b class="v">' + f0(c[k]) + '</b><span class="sh">' +
    esc(share(c[k] / (s.exp || 1))) + '</span><span class="vs">' + (cu[k] ? short(c[k], cu[k]) : u.n ? '<span class="pr-d">' + esc(t("New")) + "</span>" : "") + "</span></div>").join("");
  if (rest.length) {
    const v = rest.reduce((x, k) => x + c[k], 0);
    rows += '<div class="pr-cr"><i class="pr-sw" style="background:' + C[9] + '"></i><b class="n">' + esc(rest.map((k) => cat(k).n).slice(0, 3).join(", ") + (rest.length > 3 ? "…" : "")) +
      '</b><span class="bar"><span class="pr-split" style="width:' + ((v / top) * 100).toFixed(1) + '%"><i class="p1" style="flex:1"></i></span></span><b class="v">' + f0(v) + '</b><span class="sh">' + esc(share(v / (s.exp || 1))) + '</span><span class="vs"></span></div>';
  }
  return section(esc(t("Where it went")), esc(u.n ? t("against the {n} months before", { n: u.n }) : ""),
    '<div class="pr-cat">' + rows + "</div>" + (couple() ? '<p class="pr-note">' + sharedText(m) + "</p>" : ""), "", splitKey());
}
/* What changed: up on one side, down on the other */
function changedBlock(m) {
  if (!m.u.n) return section(esc(t("What changed")), "", '<p class="pr-note"><b>' + esc(t("The first month")) + "</b> " + esc(t("Next month Wally compares against this one.")) + "</p>");
  const item = (x, up) => {
    const big = up ? m.biggestIn(x.k) : null, amount = f0(Math.abs(x.d));
    return '<div class="pr-li"><b>' + (up ? t("{category}, {amount} more", { category: catName(x.k), amount }) : t("{category}, {amount} less", { category: catName(x.k), amount })) + "</b><p>" +
      (big ? t("Biggest: {name}, {amount} on {date}", { name: esc(big.n || cat(big.c).n), amount: f0(amt(big, m.sc)), date: esc(dlab(big.d)) }) + "."
        : m.c[x.k] ? t("{amount} this month, usually about {usual}", { amount: f0(m.c[x.k] || 0), usual: f0(m.cu[x.k] || 0) }) + "." : t("Nothing this month, usually about {usual}", { usual: f0(m.cu[x.k] || 0) }) + ".") + "</p></div>";
  };
  if (!m.ups.length && !m.downs.length) return section(esc(t("What changed")), "", '<p class="pr-note"><b>' + esc(t("A steady month")) + "</b> " + esc(t("Every category was close to usual.")) + "</p>");
  return section(esc(t("What changed")), "", '<div class="pr-two"><div>' + m.ups.map((x) => item(x, true)).join("") + "</div><div>" + m.downs.map((x) => item(x, false)).join("") + "</div></div>");
}

/* ---------- page 2 ---------- */
function peopleBlock(m) {
  if (!couple()) return "";
  const { a, b } = m, PM = mon(m.pq);
  const cards = state.people.map((p) => {
    const key = String(p.id), tt = totals(a, b, key);
    let own = 0, paid = 0;
    for (const x of state.tx) {
      if (x.type !== "expense" || x.d < a || x.d > b) continue;
      if (x.p === key) own += x.a;
      if (x.p === null && x.by === key) paid += x.a;
    }
    const pe = m.hasPrev ? totals(ds(m.pq[0], m.pq[1], 1), ds(m.pq[0], m.pq[1], dim(m.pq[0], m.pq[1])), key).exp : null;
    const kept = tt.net >= 0;
    const li = (k, v) => "<li><span>" + esc(k) + "</span><b>" + v + "</b></li>";
    return '<div class="pr-person"><div class="pr-ph">' + avatar(key) + "<b>" + esc(p.name) + '</b><span class="pr-kept ' + (kept ? "good" : "bad") + '">' +
      esc(kept ? (tt.inc ? t("Kept {amount} · {pct}", { amount: f0(tt.net), pct: pct(tt.rate) }) : t("Nothing spent")) : t("Over by {amount}", { amount: f0(-tt.net) })) + "</span></div>" +
      '<ul class="pr-facts">' + li(t("Earned"), f0(tt.inc)) + li(t("Spent, with their share"), f0(tt.exp)) + li(t("On their own"), f0(own)) + li(t("Their share of shared costs"), f0(tt.exp - own)) +
      li(t("Paid for shared costs"), f0(paid)) + (pe !== null ? "<li><span>" + esc(t("Against {month}", { month: PM })) + "</span>" + short(tt.exp, pe) + "</li>" : "") + "</ul></div>";
  }).join("");
  return section(esc(t("Each of you")), esc(t("spending includes each person’s share of shared costs")), '<div class="pr-people n' + Math.min(state.people.length, 3) + '">' + cards + "</div>");
}
function daysBillsBlock(m) {
  const list = (rows) => '<ul class="pr-kv">' + rows.map(([k, v]) => "<li><span>" + k + "</span><b>" + v + "</b></li>").join("") + "</ul>";
  return '<div class="pr-two">' +
    section(esc(t("Day by day")), m.sc === "all" ? esc(t("household, without bills")) : esc(t("{name}, without bills", { name: pname(m.sc) })), list(dayRows(m))) +
    section(esc(t("Bills")), esc(tn(m.billsN, "{n} payment, {amount}", "{n} payments, {amount}", { amount: f0(m.s.bills) })), list(pdfBills(m))) + "</div>";
}
/* Bills on paper: against last month, next month's total, and its first bill on a line of its own */
function pdfBills(m) {
  const rows = billRows(m), nx = m.next, next = rows[rows.length - 1];
  const out = rows.slice(1, -1);
  out.push([next[0], nx.n ? esc(tn(nx.n, "{amount} in {n} bill", "{amount} in {n} bills", { amount: f0(nx.sum) })) : next[1]]);
  if (nx.n && nx.first) out.push([esc(t("First")), esc(t("{name} on {date}", { name: nx.first.n, date: dlab(nx.first.d) }))]);
  return out;
}
function knowBlock(m) {
  return section(esc(t("Worth knowing")), "", '<div class="pr-know">' + highlights(m).map((x) => "<div><span>" + x[0] + "</span><b>" + x[1] + "</b>" + (x[2] ? "<p>" + x[2] + "</p>" : "") + "</div>").join("") + "</div>");
}

/* ---------- pages ---------- */
function sheet(m, first) {
  const s = document.createElement("div");
  s.className = "pr-sheet";
  s.innerHTML = '<header class="pr-head"><span class="pr-brand"><i></i>Wally</span><span>' +
    esc(monthYear(m.q[0], m.q[1])) + " · " + esc(m.sc === "all" ? t("Household") : pname(m.sc)) + "</span></header>" +
    '<div class="pr-body' + (first ? " first" : "") + '"></div><footer class="pr-pfoot"><span>' + esc(t("Created {date}", { date: LONG().format(new Date(TODAY + "T12:00:00")) })) + '</span><span class="pr-pn"></span></footer>';
  return s;
}
function build(m) {
  document.getElementById("w-print")?.remove();
  const root = document.createElement("div");
  root.id = "w-print";
  root.className = "pr";
  root.dir = document.documentElement.dir || "ltr";
  root.lang = document.documentElement.lang;
  document.body.appendChild(root);
  // Page 1 answers "how did we do"; page 2 starts with the people
  const blocks = [[titleBlock(m)], [heroBlock(m)], [kpiBlock(m)], [catsBlock(m)], [changedBlock(m)], [peopleBlock(m), true], [daysBillsBlock(m), !couple()], [knowBlock(m)]].filter((x) => x[0]);
  let page = sheet(m, true), body = page.querySelector(".pr-body");
  root.appendChild(page);
  const next = () => { page = sheet(m, false); root.appendChild(page); body = page.querySelector(".pr-body"); };
  for (const [html, fresh] of blocks) {
    if (fresh && body.children.length) next();
    const box = document.createElement("div");
    box.className = "pr-blk";
    box.innerHTML = html;
    body.appendChild(box);
    // Doesn't fit: the section starts the next page
    if (body.scrollHeight > body.clientHeight + 1 && body.children.length > 1) {
      box.remove();
      next();
      body.appendChild(box);
    }
  }
  const pages = root.querySelectorAll(".pr-pn");
  pages.forEach((p, i) => { p.textContent = t("Page {n} of {total}", { n: i + 1, total: pages.length }); });
  return root;
}

/* The browser names the file after the page title */
function fileTitle(m) { return "Wally – " + monthYear(m.q[0], m.q[1]) + (m.sc === "all" ? "" : " – " + pname(m.sc)); }

let restore = null;
function cleanUp() {
  document.getElementById("w-print")?.remove();
  document.body.classList.remove("pr-on");
  if (restore !== null) { document.title = restore; restore = null; }
  removeEventListener("afterprint", cleanUp);
}
function arm(m) {
  if (restore === null) restore = document.title;
  document.title = fileTitle(m);
  document.body.classList.add("pr-on");
  addEventListener("afterprint", cleanUp);
}

/* The Export button: lay out, wait for the logo, then print */
export async function exportPdf(m) {
  const root = build(m);
  await Promise.all([...root.querySelectorAll("img")].map((i) => i.decode().catch(() => {})));
  arm(m);
  print();
}
/* ⌘P / Ctrl+P on the page: the same report, laid out just before printing */
export function beforePrint(m) {
  if (document.body.classList.contains("pr-on")) return;
  build(m);
  arm(m);
}
