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

/* ---------- one transaction ----------
   Wide screens: the date with Edit at the top right, the amount and the name, plain rows, then
   Duplicate and Delete transaction as rows (Delete last, in red), as on the phone.
   Phones: a page with ‹ Transactions and Edit, the amount, grouped rows and the same two actions. */
export function txPanel(x, phone) {
  if (!x) return '<div class="w-empty"><b>' + esc(t("Nothing selected")) + "</b>" + esc(t("Pick a transaction to see it here.")) + "</div>";
  const inc = x.type === "income", rule = ruleOf(x), pb = paidBy(x), sibs = siblings(x), h = history(x);
  const repText = x.rec ? (rule ? describe(rule) : t("Repeats")) : null;
  const tags = x.tags.length ? '<span class="tx-tags">' + x.tags.map((g) => '<span class="w-ht">' + esc(g) + "</span>").join("") + "</span>" : muted(t("Add a tag"));
  const note = x.note ? '<span class="tx-note">' + esc(x.note) + "</span>" : muted(t("Add a note"));
  const fields = [
    [t("Category"), tile(x.c, 22) + "<span>" + esc(x.c) + "</span>"],
    [t("Who"), av(owner(x), "sm") + "<span>" + whoText(x) + "</span>"],
    pb && [t("Paid by"), av(pb, "sm") + "<span>" + esc(pname(pb)) + "</span>"],
    [t("Date"), "<span>" + esc(dateText(x.d)) + "</span>"],
    [t("Tags"), tags],
    [t("Note"), note],
    [t("Repeats"), repText ? "<span>" + esc(repText) + "</span>" : '<span class="tx-mut">' + esc(t("Never")) + "</span>", repText],
    x.src && [t("Imported from"), '<span class="tx-src">' + esc(x.src.name || "") + (x.src.date ? '<span class="tx-mut"> · ' + esc(dlab(x.src.date)) + "</span>" : "") + "</span>"],
  ].filter(Boolean);
  const sibHtml = sibs.length
    ? '<div class="tx-sibs"><span class="w-eyebrow">' + icon("receipt") + esc(t("Split receipt, {n} parts", { n: sibs.length + 1 })) + '</span><div class="w-list">' +
      sibs.map((y) => '<button type="button" class="w-li tx-sib" data-sib="' + esc(y.id) + '">' + tile(y.c) + '<div><h6>' + esc(y.n || y.c) + "</h6><p>" + esc(y.c) + '</p></div><span class="w-amt">' + f(y.a) + "</span></button>").join("") +
      "</div></div>"
    : "";
  const name = x.n || x.c, ruleHref = x.rec ? "/recurring?id=" + encodeURIComponent(x.rid) : "";

  if (phone) {
    const row = ([k, v, link]) => link
      ? '<a class="w-gr" href="' + ruleHref + '" data-link><span class="k">' + esc(k) + '</span><span class="v tx-cv">' + v + "</span>" + icon("right", "chev") + "</a>"
      : '<div class="w-gr"><span class="k">' + esc(k) + '</span><span class="v tx-cv">' + v + "</span></div>";
    return '<div class="w-mh tx-dnav"><button type="button" class="w-plink" data-act="close">' + icon("left") + esc(t("Transactions")) + '</button><button type="button" class="w-plink" data-act="edit">' + esc(t("Edit")) + "</button></div>" +
      '<div class="tx-dhero">' + tile(x.c, 52) + "<b>" + esc(name) + '</b><span class="w-big' + (inc ? " pos" : "") + '">' + (inc ? "+" : "") + big(x.a) + '</span><span class="w-hint">' + esc(dateText(x.d)) + " · " + esc(audit(x)) + "</span></div>" +
      '<div class="w-gl">' + fields.map(row).join("") + "</div>" + sibHtml +
      (h.n ? '<div class="w-gl"><div class="w-gr"><span class="k">' + esc(t("This payee in {year}", { year: h.y })) + '</span><span class="v">' + esc(tn(h.n, "{n} time", "{n} times")) + " · " + f(h.total) + "</span></div></div>" : "") +
      '<div class="w-gl"><button type="button" class="w-gr acc" data-act="dup">' + esc(t("Duplicate")) + '</button><button type="button" class="w-gr red" data-act="del">' + esc(t("Delete transaction")) + "</button></div>";
  }
  // Wide screens: nothing is lost; the year's history is one line and who added it is the last row
  const rows = fields.filter(([k]) => k !== t("Date") && !((k === t("Tags") && !x.tags.length) || (k === t("Note") && !x.note)));
  if (h.n > 1) rows.push([t("This year"), "<span>" + esc(tn(h.n, "{n} time", "{n} times")) + " · " + f(h.total) + "</span>"]);
  rows.push([t("Added"), '<span class="tx-mut">' + esc(added(x)) + "</span>"]);
  const kv = ([k, v, link]) => link
    ? '<a class="tx-kvr tx-kvl" href="' + ruleHref + '" data-link><span>' + esc(k) + '</span><span class="val">' + v + "</span></a>"
    : '<div class="tx-kvr"><span>' + esc(k) + '</span><span class="val">' + v + "</span></div>";
  return '<div class="tx-ih"><span class="tx-idate">' + esc(cap(dateText(x.d))) + '</span><span class="tx-ihr"><button type="button" class="tx-edit" data-act="edit" title="' + esc(t("Edit")) + ' (E)">' + esc(t("Edit")) + "</button>" +
      '<button type="button" class="tx-close" data-act="close" aria-label="' + esc(t("Close")) + '">' + icon("x") + "</button></span></div>" +
    '<div class="tx-iamt"><span class="w-big amt' + (inc ? " pos" : "") + '">' + (inc ? "+" : "") + big(x.a) + '</span><span class="tx-iname">' + esc(name) + "</span></div>" +
    '<div class="tx-kv">' + rows.map(kv).join("") + "</div>" +
    sibHtml +
    '<div class="w-pacts tx-pacts"><button type="button" data-act="dup" title="' + esc(t("Duplicate")) + ' (D)">' + esc(t("Duplicate")) + '</button><button type="button" class="red" data-act="del" title="' + esc(t("Delete")) + ' (⌫)">' + esc(t("Delete transaction")) + "</button></div>";
}
const cap = (s) => s.charAt(0).toLocaleUpperCase() + s.slice(1);
/* The big amount: the cents and what follows them (" €") small, as one tail */
const big = (n) => bigMoney(n).replace(/<\/span>([^<]*)$/, "$1</span>");
/* ---------- one day of the calendar ----------
   Wide screens: the day on the right, its total and its transactions. Phones: the day's list under the calendar. */
export function dayPanel(d, list, sched, wide, phone) {
  const fut = d > TODAY, items = fut ? [] : list.filter((x) => x.d === d), sc = fut ? sched[d] || [] : [];
  let out = 0, inn = 0;
  items.forEach((x) => { if (x.type === "income") inn += amt(x); else out += amt(x); });
  sc.forEach((x) => { if (x.inc) inn += x.a; else out += x.a; });
  const rows = items.map((x) => txRow(x)).join("") +
    sc.map((x) => '<div class="w-li">' + tile(x.c) + "<div><h6>" + esc(x.n || x.c) + "</h6><p>" + esc(x.c) + " · " + esc(shortDesc(x.r)) + '</p></div><span class="w-amt' + (x.inc ? " pos" : "") + '">' + (x.inc ? "+" : "") + f(x.a) + "</span></div>").join("");
  const none = '<div class="w-empty"><b>' + esc(fut ? t("Nothing scheduled") : t("No spending")) + "</b>" + esc(fut ? t("No recurring bills on this day.") : t("A no-spend day.")) + "</div>";
  if (phone) {
    return '<div class="tx-dsh"><h3>' + esc(cap(dateText(d))) + "</h3><span>" + (out || inn ? esc(fut ? t("{amount} in bills", { amount: f(out) }) : t("{amount} spent", { amount: f(out) })) : "") + "</span></div>" +
      '<div class="w-panel tx-dlist"><div class="w-list tx-daylist">' + (rows || none) + "</div></div>";
  }
  return '<div class="tx-ih"><span class="tx-idate">' + esc(fut ? t("Still to come") : d === TODAY ? t("Today") : t("Day")) + "</span>" +
      (items.length ? '<button type="button" class="tx-edit tx-calopen" data-act="cal-open">' + esc(t("Show in List")) + "</button>" : "") + "</div>" +
    '<div class="tx-iamt"><span class="tx-iname">' + esc(cap(dateText(d))) + '</span><span class="w-big">' + bigMoney(out) + '</span><span class="tx-daysub">' + esc(fut ? t("in bills") : t("spent")) +
      (inn ? ' · <b class="pos">+' + f(inn) + " " + esc(t("in")) + "</b>" : "") + "</span></div>" +
    '<div class="w-list tx-daylist">' + (rows || none) + "</div>";
}
