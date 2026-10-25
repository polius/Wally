/* Transactions: the side panel. One transaction with every field, or one day of the calendar.
   On phones the same panel is a full-screen detail, laid out as the phone mock. */
import { state, t, tn, esc, f, f0, amt, av, pname, person, tile, icon, bigMoney, dlab, dlabL, TODAY, F, monthYear, couple, cc } from "../../core.js";
import { describe, shortDesc } from "../../sched.js";
import { chart, el, txt, hover, row } from "../../ui.js";
import { txRow, owner } from "./list.js";

const thisYear = () => +TODAY.slice(0, 4);
function dateText(d) { return dlabL(d) + (d.slice(0, 4) === TODAY.slice(0, 4) ? "" : " " + d.slice(0, 4)); }

/* Who shares a shared transaction: the people in its shares, or everyone */
function sharers(x) {
  const keys = x.shc ? Object.keys(x.shc).filter((k) => x.shc[k] > 0 && person(k)) : [];
  return keys.length ? keys : state.people.map((p) => String(p.id));
}
const shareOf = (x, k) => (x.sh ? x.sh[k] || 0 : x.a / state.people.length);
/* Who it belongs to, in words */
function whoText(x) {
  if (x.p !== null) return esc(pname(x.p));
  if (!couple()) return esc(pname(owner(x)));
  const keys = sharers(x), cents = keys.map((k) => (x.shc ? x.shc[k] : 0));
  const even = !x.shc || Math.max(...cents) - Math.min(...cents) <= 1; // an even split differs by a cent at most
  if (even && keys.length === state.people.length) return esc(t("Shared evenly, {amount} each", { amount: f(x.a / keys.length) }));
  return esc(t("Split: {parts}", { parts: keys.map((k) => pname(k) + " " + f(shareOf(x, k))).join(", ") }));
}
/* For a shared expense: who paid, and what the others owe them */
function paidBy(x) {
  if (x.p !== null || x.type !== "expense" || !couple() || x.by === null || !person(x.by)) return null;
  const others = sharers(x).filter((k) => k !== x.by);
  if (!others.length) return { by: x.by, owe: "" };
  const owe = others.length === 1
    ? t("{name} owes {amount}", { name: pname(others[0]), amount: f(shareOf(x, others[0])) })
    : t("the others owe {amount}", { amount: f(others.reduce((s, k) => s + shareOf(x, k), 0)) });
  return { by: x.by, owe };
}
function ruleOf(x) { return x.rid ? state.rules.find((r) => r.id === x.rid) || null : null; }
function siblings(x) { return x.gr ? state.tx.filter((y) => y.gr === x.gr && y.id !== x.id) : []; }
function history(x) {
  const y = thisYear(), name = x.n, months = new Array(12).fill(0);
  let n = 0, total = 0;
  if (name) for (const z of state.tx) {
    if (z.n !== name || z.type !== x.type || +z.d.slice(0, 4) !== y) continue;
    months[+z.d.slice(5, 7) - 1] += z.a; n++; total += z.a;
  }
  return { y, months, n, total };
}
function audit(x) {
  const on = x.ca ? dlab(x.ca.slice(0, 10)) : dlab(x.d);
  let s = x.cb !== null && person(x.cb) ? t("Added by {name} on {date}", { name: pname(x.cb), date: on }) : t("Added on {date}", { date: on });
  if (x.rec) s = x.cb !== null ? t("Added by {name} on {date}, from the rule", { name: pname(x.cb), date: on }) : t("Added on {date}, from the rule", { date: on });
  return s;
}
const muted = (s) => '<button type="button" class="tx-add" data-act="edit">' + esc(s) + "</button>";

/* ---------- one transaction ---------- */
export function txPanel(x, phone) {
  if (!x) return '<div class="w-empty"><b>' + esc(t("Nothing selected")) + "</b>" + esc(t("Pick a transaction to see it here.")) + "</div>";
  const inc = x.type === "income", rule = ruleOf(x), pb = paidBy(x), sibs = siblings(x), h = history(x);
  const repeats = x.rec
    ? '<a href="/recurring?id=' + encodeURIComponent(x.rid) + '" data-link class="w-link tx-rep">' + icon("repeat") + esc(rule ? describe(rule) : t("Repeats")) + "</a>"
    : '<span class="tx-mut">' + esc(t("Never")) + "</span>";
  const tags = x.tags.length ? '<span class="tx-tags">' + x.tags.map((g) => '<span class="w-ht">' + esc(g) + "</span>").join("") + "</span>" : muted(t("Add a tag"));
  const note = x.note ? '<span class="tx-note">' + esc(x.note) + "</span>" : muted(t("Add a note"));
  const fields = [
    [t("Category"), tile(x.c, 22) + "<span>" + esc(x.c) + "</span>"],
    [inc ? t("Whose") : t("Who"), av(owner(x), "sm") + "<span>" + whoText(x) + "</span>"],
    pb && [t("Paid by"), av(pb.by, "sm") + "<span>" + esc(pname(pb.by)) + (pb.owe ? '<span class="tx-mut">, ' + esc(pb.owe) + "</span>" : "") + "</span>"],
    [t("Date"), "<span>" + esc(dateText(x.d)) + "</span>"],
    [t("Tags"), tags],
    [t("Note"), note],
    [t("Repeats"), repeats],
    x.src && [t("Imported from"), '<span class="tx-src">' + esc(x.src.name || "") + (x.src.date ? '<span class="tx-mut"> · ' + esc(dlab(x.src.date)) + "</span>" : "") + "</span>"],
  ].filter(Boolean);
  const sibHtml = sibs.length
    ? '<div class="tx-sibs"><span class="w-eyebrow">' + icon("receipt") + esc(t("Split receipt, {n} parts", { n: sibs.length + 1 })) + '</span><div class="w-list">' +
      sibs.map((y) => '<button type="button" class="w-li tx-sib" data-sib="' + esc(y.id) + '">' + tile(y.c) + '<div><h6>' + esc(y.n || y.c) + "</h6><p>" + esc(y.c) + '</p></div><span class="w-amt">' + f(y.a) + "</span></button>").join("") +
      "</div></div>"
    : "";
  const histText = h.n ? esc(tn(h.n, "{n} time", "{n} times")) + ", <b>" + f(h.total) + "</b> " + esc(t("in total, about {amount} each.", { amount: f0(h.total / h.n) })) : "";
  const name = x.n || x.c;

  if (phone) {
    const cellsOf = (list) => '<div class="w-cells">' + list.map(([k, v]) => '<div class="w-cell"><span>' + esc(k) + '</span><b class="tx-cv">' + v + "</b></div>").join("") + "</div>";
    return '<div class="w-mh tx-dnav"><button type="button" class="w-plink" data-act="close">' + icon("left") + esc(t("Transactions")) + '</button><button type="button" class="w-plink" data-act="edit">' + esc(t("Edit")) + "</button></div>" +
      '<div class="tx-dhero">' + tile(x.c, 48) + "<b>" + esc(name) + '</b><span class="w-big' + (inc ? " pos" : "") + '">' + (inc ? "+" : "") + bigMoney(x.a) + '</span><span class="w-hint">' + esc(dateText(x.d)) + " · " + esc(audit(x)) + "</span></div>" +
      cellsOf(fields) + sibHtml +
      (h.n ? cellsOf([[t("This payee in {year}", { year: h.y }), esc(tn(h.n, "{n} time", "{n} times")) + " · " + f(h.total)]]) : "") +
      '<div class="w-cells"><button type="button" class="w-cell tx-cellbtn" data-act="dup">' + icon("copy") + esc(t("Duplicate")) + '</button><button type="button" class="w-cell tx-cellbtn danger" data-act="del">' + icon("trash") + esc(t("Delete transaction")) + "</button></div>";
  }
  return '<div class="tx-ih"><span class="w-eyebrow">' + esc(inc ? t("Income") : t("Expense")) + '</span><span class="w-kbd"><span><kbd>E</kbd>' + esc(t("edit")) + '</span></span><button type="button" class="tx-close" data-act="close" aria-label="' + esc(t("Close")) + '">' + icon("x") + "</button></div>" +
    '<div class="tx-iamt"><span class="w-big' + (inc ? " pos" : "") + '">' + (inc ? "+" : "") + bigMoney(x.a) + '</span><span class="tx-iname">' + esc(name) + "</span></div>" +
    '<div class="w-fields">' + fields.map(([k, v]) => '<div class="w-field"><span>' + esc(k) + '</span><span class="val">' + v + "</span></div>").join("") + "</div>" +
    sibHtml +
    (x.n ? '<div class="tx-hist"><span class="w-eyebrow">' + esc(t("{name} in {year}", { name: x.n, year: h.y })) + '</span><div class="cv" id="tx-hist"></div><span class="tx-histt">' + histText + "</span></div>" : "") +
    '<p class="w-audit">' + esc(audit(x)) + "</p>" +
    '<div class="w-actions"><button type="button" class="w-btn ghost" data-act="edit">' + esc(t("Edit")) + '</button><button type="button" class="w-btn ghost" data-act="dup">' + icon("copy") + esc(t("Duplicate")) + '</button><button type="button" class="w-btn ghost danger" data-act="del">' + icon("trash") + esc(t("Delete")) + "</button></div>" +
    '<div class="w-kbd tx-keys"><span><kbd>↑</kbd><kbd>↓</kbd>' + esc(t("move")) + "</span><span><kbd>D</kbd>" + esc(t("duplicate")) + "</span><span><kbd>⌫</kbd>" + esc(t("delete")) + "</span></div>";
}
/* The payee's year, one bar a month */
export function drawHist(x) {
  if (!x || !x.n || !document.getElementById("tx-hist")) return;
  const h = history(x), cur = +TODAY.slice(5, 7), sel = x.d.slice(0, 4) === String(h.y) ? +x.d.slice(5, 7) : 0;
  const col = x.type === "income" ? "var(--w-good)" : cc(x.c);
  chart("tx-hist", 58, (svg, w, hh) => {
    const mx = Math.max(...h.months, 1), bw = w / 12;
    for (let i = 0; i < 12; i++) {
      const v = h.months[i], bh = v ? Math.max(3, (v / mx) * (hh - 18)) : 2, x0 = bw * i + bw * 0.2, b = bw * 0.6;
      const rc = el("rect", { x: x0, y: hh - 14 - bh, width: b, height: bh, rx: 2, fill: v && i < cur ? col : "var(--w-line)", "fill-opacity": i + 1 === sel ? 1 : 0.45 }, svg);
      if (i < cur) hover(rc, "<b>" + esc(monthYear(h.y, i + 1)) + "</b>" + row(esc(x.type === "income" ? t("Came in") : t("Spent")), f(v)));
      txt(svg, x0 + b / 2, hh - 2, F.mon[i].slice(0, 1), "ax", "middle");
    }
  }, t("{name} each month in {year}", { name: x.n, year: h.y }));
}

/* ---------- one day of the calendar ---------- */
export function dayPanel(d, list, sched, wide) {
  const fut = d > TODAY, items = fut ? [] : list.filter((x) => x.d === d), sc = fut ? sched[d] || [] : [];
  let out = 0, inn = 0;
  items.forEach((x) => { if (x.type === "income") inn += amt(x); else out += amt(x); });
  sc.forEach((x) => { if (x.inc) inn += x.a; else out += x.a; });
  const rows = items.map((x) => txRow(x)).join("") +
    sc.map((x) => '<div class="w-li">' + tile(x.c) + "<div><h6>" + esc(x.n || x.c) + "</h6><p>" + esc(x.c) + " · " + esc(shortDesc(x.r)) + '</p></div><span class="w-amt' + (x.inc ? " pos" : "") + '">' + (x.inc ? "+" : "") + f(x.a) + "</span></div>").join("");
  return '<div class="tx-ih"><span class="w-eyebrow">' + esc(fut ? t("Still to come") : d === TODAY ? t("Today") : t("Day")) + "</span>" +
      (items.length ? '<button type="button" class="w-link tx-calopen" data-act="cal-open">' + esc(t("Show in list")) + "</button>" : "") + "</div>" +
    '<div class="tx-iamt"><span class="tx-iname">' + esc(dateText(d)) + '</span><span class="w-big">' + bigMoney(out) + '</span><span class="tx-daysub">' + esc(fut ? t("in bills") : t("spent")) +
      (inn ? ' · <b class="pos">+' + f(inn) + "</b> " + esc(t("in")) : "") + "</span></div>" +
    '<div class="w-list tx-daylist">' + (rows || '<div class="w-empty"><b>' + esc(fut ? t("Nothing scheduled") : t("No spending")) + "</b>" + esc(fut ? t("No recurring bills on this day.") : t("A no-spend day.")) + "</div>") + "</div>" +
    '<p class="w-audit">' + esc(fut ? t("From your recurring rules. Wally adds them on the day.") : items.length ? (wide ? t("Pick a transaction to open it in the list.") : t("Tap a transaction to open it.")) : "") + "</p>";
}
