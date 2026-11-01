/* Transactions: the side panel. One transaction with every field, or one day of the calendar.
   On phones the same panel is a full-screen detail, laid out as the phone mock. */
import { state, t, tn, esc, f, amt, av, pname, person, tile, icon, bigMoney, dlab, dlabL, TODAY, couple } from "../../core.js";
import { describe, shortDesc } from "../../sched.js";
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
/* For a shared expense: who paid it */
function paidBy(x) {
  if (x.p !== null || x.type !== "expense" || !couple() || x.by === null || !person(x.by)) return null;
  return x.by;
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
/* Who added it and when, for the panel's last row: "Alex · Oct 30 · from the rule" */
function added(x) {
  const parts = [];
  if (x.cb !== null && person(x.cb)) parts.push(pname(x.cb));
  parts.push(dlab(x.ca ? x.ca.slice(0, 10) : x.d));
  if (x.rec) parts.push(t("from the rule"));
  return parts.join(" · ");
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
    pb && [t("Paid by"), av(pb, "sm") + "<span>" + esc(pname(pb)) + "</span>"],
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
  const name = x.n || x.c;

  if (phone) {
    const cellsOf = (list) => '<div class="w-cells">' + list.map(([k, v]) => '<div class="w-cell"><span>' + esc(k) + '</span><b class="tx-cv">' + v + "</b></div>").join("") + "</div>";
    return '<div class="w-mh tx-dnav"><button type="button" class="w-plink" data-act="close">' + icon("left") + esc(t("Transactions")) + '</button><button type="button" class="w-plink" data-act="edit">' + esc(t("Edit")) + "</button></div>" +
      '<div class="tx-dhero">' + tile(x.c, 48) + "<b>" + esc(name) + '</b><span class="w-big' + (inc ? " pos" : "") + '">' + (inc ? "+" : "") + bigMoney(x.a) + '</span><span class="w-hint">' + esc(dateText(x.d)) + " · " + esc(audit(x)) + "</span></div>" +
      cellsOf(fields) + sibHtml +
      (h.n ? cellsOf([[t("This payee in {year}", { year: h.y }), esc(tn(h.n, "{n} time", "{n} times")) + " · " + f(h.total)]]) : "") +
      '<div class="w-cells"><button type="button" class="w-cell tx-cellbtn" data-act="dup">' + icon("copy") + esc(t("Duplicate")) + '</button><button type="button" class="w-cell tx-cellbtn danger" data-act="del">' + icon("trash") + esc(t("Delete transaction")) + "</button></div>";
  }
  // Wide screens: the date, the amount and the name, then plain rows; nothing is lost, the
  // year's history is one line and who added it is the last row
  const rows = fields.filter(([k]) => k !== t("Date") && !((k === t("Tags") && !x.tags.length) || (k === t("Note") && !x.note)));
  if (h.n > 1) rows.push([t("This year"), "<span>" + esc(tn(h.n, "{n} time", "{n} times")) + " · " + f(h.total) + "</span>"]);
  rows.push([t("Added"), '<span class="tx-mut">' + esc(added(x)) + "</span>"]);
  return '<div class="tx-ih"><span class="tx-idate">' + esc(cap(dateText(x.d))) + '</span><button type="button" class="tx-close" data-act="close" aria-label="' + esc(t("Close")) + '">' + icon("x") + "</button></div>" +
    '<div class="tx-iamt"><span class="w-big amt' + (inc ? " pos" : "") + '">' + (inc ? "+" : "") + bigMoney(x.a) + '</span><span class="tx-iname">' + esc(name) + "</span></div>" +
    '<div class="tx-kv">' + rows.map(([k, v]) => '<div class="tx-kvr"><span>' + esc(k) + '</span><span class="val">' + v + "</span></div>").join("") + "</div>" +
    sibHtml +
    '<div class="tx-acts"><button type="button" class="w-btn ghost" data-act="edit" title="' + esc(t("Edit")) + ' (E)">' + esc(t("Edit")) + '</button><button type="button" class="w-btn ghost" data-act="dup" title="' + esc(t("Duplicate")) + ' (D)">' + esc(t("Duplicate")) +
      '</button><button type="button" class="w-btn ghost danger" data-act="del" title="' + esc(t("Delete")) + ' (⌫)">' + esc(t("Delete")) + "</button></div>";
}
const cap = (s) => s.charAt(0).toLocaleUpperCase() + s.slice(1);
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
