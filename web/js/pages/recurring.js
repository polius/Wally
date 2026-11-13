/* Recurring: everything already promised, in one place.
   What bills cost each month, a list in time order (next 7 days, later this month, then by month),
   a five-week calendar a button away, and each rule's story. Rules come from /recurring; price
   changes are worked out here, from past transactions. */
import {
  state, t, tn, esc, f, fk, pct, bigMoney, dlab, dlabW, dlabL, dlabY, monthYear, F, TODAY, addD, ym, amt, tile, cc, av,
  pname, couple, icon, wkOff, dows, rerank, POST, DEL, fromRule, reloadRules, reloadLedger, monthName, monthIn, relDay,
} from "../core.js";
import { ruleDates, occurrences, ruleAmt, perMonth, isIncome, nextOf, inDays, ruleHist, describe, shortDesc, everyN } from "../sched.js";
import { hover, hideTip, row, toast, errorToast, openDialog, closeDialog, dialogError, trapFocus } from "../ui.js";
import { refresh, headActions } from "../shell.js";

const RECENT = 548;          // a price change from the last 18 months is still news

const phoneMQ = matchMedia("(max-width:767px)");
const wideMQ = matchMedia("(min-width:1280px)");

const ui = { tab: "expense", sel: null, open: false, endedOpen: false, order: [], day: null, cal: false, fromDay: false };
let root = null;
let H = new Map();           // history per rule, worked out once per render

/* ---------- small helpers ---------- */
/* Amounts stay left to right inside right-to-left text */
const bdi = (html) => "<bdi>" + html + "</bdi>";
const m = (n, sign) => bdi((sign || "") + esc(f(n)));
/* The big amount: cents and currency small, as in Transactions */
const bigM = (n, sign) => bdi((sign || "") + bigMoney(n).replace(/<\/span>([^<]*)$/, "$1</span>"));
const norm = (s) => String(s || "").trim().toLowerCase();
const wide = () => wideMQ.matches;
const phone = () => phoneMQ.matches;
const fkn = (n) => fk(n).replace(/\s/g, "\u00a0");   // "2.5k €" never breaks inside
const sum = (list, fn) => list.reduce((s, x) => s + fn(x), 0);
function hist(r) { if (!H.has(r.id)) H.set(r.id, ruleHist(r)); return H.get(r.id); }
/* The last time the amount changed, from the cached history (same as sched.priceChange) */
function change(r) {
  if (r.varies) return null;
  const h = hist(r);
  for (let i = h.length - 1; i > 0; i--) if (Math.abs(h[i].a - h[i - 1].a) > 0.005) return { from: h[i - 1].a, to: h[i].a, d: h[i].d };
  return null;
}
function recentChange(r) { const pc = change(r); return pc && pc.d >= addD(TODAY, -RECENT) ? pc : null; }
/* What a full amount is for whoever is shown (shared rules count by share) */
function scaled(r, v) { return r.a ? (v * ruleAmt(r)) / r.a : v; }
/* No date left to come, and not paused: the rule is over */
function over(r) { return !r.paused && !nextOf(r); }
/* An ended rule that a newer version replaced ("from the next charge" makes a new rule) */
function superseded(r) {
  if (!r.endDate) return false;
  return state.rules.some((x) => x !== r && x.type === r.type && norm(x.n) === norm(r.n) && x.start > r.endDate);
}
function latestVersion(r) {
  let best = r;
  state.rules.forEach((x) => { if (x.type === r.type && norm(x.n) === norm(r.n) && x.start > best.start) best = x; });
  return best;
}
function keep(r) { return (ui.tab === "income") === isIncome(r); }
function byNext(list) {
  return list.slice().sort((a, b) => { const x = nextOf(a) || "9", y = nextOf(b) || "9"; return x < y ? -1 : x > y ? 1 : a.n.localeCompare(b.n); });
}
function ruleById(id) { return state.rules.find((r) => r.id === id) || null; }

/* ---------- page ---------- */
export function mount(el, route) {
  root = el;
  const id = route.query.get("id");
  ui.sel = id || null;
  ui.open = !!id;
  ui.day = null;
  // Bills | Income and List | Calendar: in the toolbar on wider screens, in their own row under the title on phones
  root.innerHTML =
    '<header class="w-head s-head rec-head"><div class="s-titlew"><h3 class="s-title">' + t("Recurring") + "</h3></div>" +
      headActions('<div class="rec-ctl rec-ctl-h">' + controls() + "</div>") + "</header>" +
    '<div class="rec-ctl rec-ctl-p">' + controls() + "</div>" +
    '<div id="rec-page"></div>';
  root.addEventListener("click", onClick);
  root.addEventListener("keydown", onKeydown);
  phoneMQ.addEventListener("change", render);
  wideMQ.addEventListener("change", render);
  render();
  if (ui.open && !wide()) focusPanel();
}
export function unmount() {
  // #main outlives the page: take the page's listeners off it
  if (root) {
    root.removeEventListener("click", onClick);
    root.removeEventListener("keydown", onKeydown);
  }
  phoneMQ.removeEventListener("change", render);
  wideMQ.removeEventListener("change", render);
  document.documentElement.classList.remove("rec-lock");
  root = null;
}
export function update() { if (root) render(); }

export function key(ev) {
  const k = ev.key;
  if (k === "Escape" && ui.open && !wide()) { ev.preventDefault(); closePanel(); return; }
  if (k === "ArrowDown" || k === "ArrowUp") {
    if (!ui.order.length) return;
    ev.preventDefault();
    const i = ui.order.indexOf(ui.sel);
    const j = i < 0 ? 0 : Math.max(0, Math.min(ui.order.length - 1, i + (k === "ArrowDown" ? 1 : -1)));
    select(ui.order[j], { keepClosed: !ui.open && !wide() });
    const b = root.querySelector('[data-rid="' + ui.order[j] + '"]');
    if (b) { b.focus(); b.scrollIntoView({ block: "nearest" }); }
    return;
  }
  const r = ruleById(ui.sel);
  if (!r) return;
  if (k === "e" || k === "E") { ev.preventDefault(); editRule(r); }
  else if (k === "Backspace" || k === "Delete") { ev.preventDefault(); deleteRule(r); }
}

/* Bills | Income, then List | Calendar */
function controls() {
  return '<div class="w-seg rec-tabs" role="group" aria-label="' + esc(t("Show")) + '">' +
      [["expense", t("Bills")], ["income", t("Income")]].map(([v, l]) => '<button type="button" data-rtab="' + v + '" aria-pressed="' + (ui.tab === v) + '">' + l + "</button>").join("") + "</div>" +
    '<div class="w-seg rec-views" role="group" aria-label="' + esc(t("View")) + '">' +
      '<button type="button" data-rview="list" aria-pressed="' + !ui.cal + '" aria-label="' + esc(t("List")) + '" title="' + esc(t("List")) + '">' + icon("list") + "</button>" +
      '<button type="button" data-rview="cal" aria-pressed="' + ui.cal + '" aria-label="' + esc(t("Calendar")) + '" title="' + esc(t("Calendar")) + '">' + icon("cal") + "</button></div>";
}
/* The first day ahead with something on it: what the calendar opens on */
function firstDay() {
  const o = occurrences(TODAY, addD(TODAY, 34)).filter((x) => ruleAmt(x.r) > 0 && keep(x.r)).sort((a, b) => (a.d < b.d ? -1 : 1));
  return o.length ? o[0].d : null;
}

function render() {
  if (!root) return;
  H = new Map();
  rerank(TODAY.slice(0, 8) + "01", TODAY);
  const focus = rememberFocus();
  root.querySelectorAll("[data-rtab]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.rtab === ui.tab)));
  root.querySelectorAll("[data-rview]").forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.rview === "cal") === ui.cal)));
  const page = root.querySelector("#rec-page");
  const rules = state.rules.filter((r) => ruleAmt(r) > 0);
  root.querySelectorAll(".rec-ctl").forEach((c) => { c.hidden = !state.rules.length; });

  if (!state.rules.length) {
    page.innerHTML = '<section class="w-panel">' + emptyRules() + "</section>";
    setOpen(false);
    return;
  }

  // Keep the selection on something visible
  let sel = ruleById(ui.sel);
  if (sel && superseded(sel)) { sel = latestVersion(sel); ui.sel = sel.id; }
  if (sel && ruleAmt(sel) <= 0) sel = null;
  if (sel && !keep(sel)) sel = null;      // Bills | Income: the panel follows the tab
  const listed = rules.filter((r) => !superseded(r));
  const shown = listed.filter(keep);
  if (!sel && wide() && shown.length) {
    const live = byNext(shown.filter((r) => !over(r)));
    sel = live[0] || shown[0];
  }
  ui.sel = sel ? sel.id : null;
  if (!sel) ui.open = false;

  // The calendar replaces the list; beside it, the picked day (or a bill opened from it)
  if (ui.cal && !ui.day) ui.day = firstDay();
  const calSide = ui.cal && !(ui.fromDay && sel);
  page.innerHTML =
    '<section class="rec-sum" aria-label="' + esc(t("Every month")) + '">' + summary(rules) + "</section>" +
    '<div class="w-tx rec-body' + (ui.cal ? " rec-calv" : "") + '">' +
      (ui.cal
        ? '<section class="w-panel rec-calp" aria-labelledby="rec-cal-h"><div class="rec-calh"><div><h4 id="rec-cal-h">' + t("Next five weeks") + '</h4><p id="rec-cal-sub"></p></div>' +
            '<div class="w-legend rec-legend"><span><i class="rec-lg-today"></i>' + t("Today") + '</span><span><i class="rec-lg-in"></i>' + t("Money in") + "</span></div></div>" +
            '<div class="w-rcal rec-cal" id="rec-cal"></div></section>'
        : '<section class="w-panel rec-list" id="rec-list" aria-label="' + esc(t("Rules")) + '">' + list(listed, shown) + "</section>") +
      (calSide ? '<aside class="w-panel rec-day" id="rec-day" aria-live="polite"></aside>'
        : '<aside class="w-panel w-insp rec-insp" id="rec-insp" tabindex="-1" aria-label="' + esc(sel ? sel.n : t("Rule")) + '"></aside>') +
    "</div>" +
    '<div class="rec-scrim" data-close hidden></div>';

  if (ui.cal) calendar();
  if (!calSide) {
    if (sel) inspector(sel); else root.querySelector("#rec-insp").innerHTML = '<div class="w-empty"><b>' + t("Nothing selected") + "</b><p>" + t("Pick a rule to see it here.") + "</p></div>";
  }
  setOpen(ui.open && !!sel && !calSide);
  restoreFocus(focus);
}

function emptyRules() {
  return '<div class="w-empty rec-empty"><span class="w-empty-i">' + icon("repeat") + "</span><b>" + t("Nothing repeats yet") + "</b><p>" +
    t("Add rent, salaries and subscriptions once. Wally adds each one on its day, and the calendars count them before they happen.") +
    '</p><button type="button" class="w-btn primary" data-new>' + icon("plus") + t("New rule") + "</button></div>";
}

/* ---------- the figures at the top: one total, then what it means ---------- */
function summary(rules) {
  const live = rules.filter((r) => nextOf(r));
  const bills = live.filter((r) => !isIncome(r)), incs = live.filter(isIncome);
  const billM = sum(bills, (r) => perMonth(r)), incM = sum(incs, (r) => perMonth(r));
  const to30 = addD(TODAY, 30), inc = ui.tab === "income";
  const o30 = occurrences(addD(TODAY, 1), to30).filter((x) => isIncome(x.r) === inc && ruleAmt(x.r) > 0);
  const sum30 = sum(o30, (x) => ruleAmt(x.r));
  const big = inc ? incM : billM, n = inc ? incs.length : bills.length;
  let line = inc ? tn(n, "{n} source", "{n} sources") : incM ? t("{pct} of what comes in", { pct: pct(billM / incM) }) : tn(n, "{n} active rule", "{n} active rules");
  const soon = o30.length ? t("{amount} in the next 30 days", { amount: f(sum30) }) : t("Nothing in the next 30 days");
  return '<span class="rec-eye">' + esc(t("Every month")) + '</span><b class="rec-big amt' + (inc ? " pos" : "") + '">' + bdi(bigMoney(big)) + "</b>" +
    '<span class="rec-line">' + esc(line) + " · " + esc(soon) + "</span>";
}

/* ---------- five weeks: when money leaves and arrives ---------- */
function calendar() {
  const start = addD(TODAY, -wkOff(TODAY)), end = addD(start, 34);
  const occ = occurrences(start, end).filter((x) => ruleAmt(x.r) > 0 && keep(x.r));
  const byDay = {};
  occ.forEach((x) => { (byDay[x.d] = byDay[x.d] || []).push(x); });
  root.querySelector("#rec-cal-sub").textContent = t("{from} to {to}", { from: dlab(start), to: dlab(end) });
  let cells = dows().map((d) => '<span class="dow" aria-hidden="true">' + esc(d) + "</span>").join("");
  for (let i = 0; i < 35; i++) {
    const d = addD(start, i), items = byDay[d] || [];
    let out = 0, inn = 0;
    items.forEach((x) => { if (isIncome(x.r)) inn += ruleAmt(x.r); else out += ruleAmt(x.r); });
    const ics = items.slice(0, 3).map((x) => tile(x.r.c, 20)).join("") + (items.length > 3 ? '<span class="more">+' + (items.length - 3) + "</span>" : "");
    const day = +d.slice(8) === 1 ? esc(dlab(d)) : +d.slice(8);
    const on = d === ui.day && items.length > 0;
    const cls = "w-rday" + (d < TODAY ? " past" : "") + (d === TODAY ? " t" : "") + (inn ? " in" : "") + (on ? " sel" : "");
    const body = '<span class="d">' + day + '</span><span class="ics">' + ics + '</span><span class="v">' + (inn ? '<b class="pos">' + bdi("+" + esc(fkn(inn))) + "</b>" : "") + (out ? "<b>" + bdi(esc(fkn(out))) + "</b>" : "") + "</span>";
    if (!items.length) { cells += '<span class="' + cls + ' rec-none" aria-hidden="true">' + body + "</span>"; continue; }
    const label = dlabL(d) + ": " + items.map((x) => x.r.n + (couple() ? " (" + pname(x.r.p) + ")" : "") + " " + (isIncome(x.r) ? "+" : "") + f(ruleAmt(x.r))).join(", ");
    cells += '<button type="button" class="' + cls + '" data-rd="' + d + '" aria-label="' + esc(label) + '" aria-pressed="' + on + '" aria-controls="rec-day">' + body + "</button>";
  }
  const box = root.querySelector("#rec-cal");
  box.innerHTML = cells;
  // The picked day lists its items beside the calendar, so only the others get a tooltip
  box.querySelectorAll("[data-rd]:not(.sel)").forEach((b) => {
    const items = byDay[b.dataset.rd];
    hover(b, () => "<b>" + esc(dlabL(b.dataset.rd)) + "</b>" + items.map((x) => row(esc(x.r.n) + (couple() ? '<small class="rec-tipw"> · ' + esc(pname(x.r.p)) + "</small>" : ""), m(ruleAmt(x.r), isIncome(x.r) ? "+" : ""), cc(x.r.c))).join(""));
  });
  dayList(byDay[ui.day]);
}
/* The day picked in the calendar: what lands on it, each opening its rule.
   Beside the calendar on wider screens; under it, with the day as a heading, on phones. */
function dayList(items) {
  const box = root.querySelector("#rec-day");
  if (!box) return;
  if (!items || !ui.day) { box.innerHTML = '<div class="w-empty rec-dayhint"><span class="w-empty-i">' + icon("cal") + "</span><b>" + t("Pick a day") + "</b></div>"; return; }
  const out = sum(items.filter((x) => !isIncome(x.r)), (x) => ruleAmt(x.r)), inn = sum(items.filter((x) => isIncome(x.r)), (x) => ruleAmt(x.r));
  const nb = items.filter((x) => !isIncome(x.r)).length, ni = items.length - nb;
  const count = [nb ? tn(nb, "{n} bill", "{n} bills") : "", ni ? tn(ni, "{n} payment", "{n} payments") : ""].filter(Boolean).join(" · ");
  const rows = items.map(({ r }) => {
    const inc = isIncome(r);
    return '<button type="button" class="w-rrow rec-drow" data-sel="' + r.id + '">' + tile(r.c, 40) +
      '<div class="rec-rn"><h6>' + esc(r.n) + "</h6><p>" + esc(whoText(r) || shortDesc(r)) + "</p></div>" +
      '<span class="amt' + (inc ? " pos" : "") + '">' + (r.varies ? t("about") + " " : "") + m(ruleAmt(r), inc ? "+" : "") + "</span></button>";
  }).join("");
  box.innerHTML =
    '<div class="rec-dayh"><h4>' + esc(dlabL(ui.day)) + "</h4><span>" + esc(ui.day === TODAY ? t("today") : inDays(ui.day)) + "</span></div>" +
    '<div class="rec-daysum"><b class="amt' + (!out && inn ? " pos" : "") + '">' + (out ? m(out) : m(inn, "+")) + "</b><span>" + esc(count) + "</span></div>" +
    '<div class="rec-dayrows">' + rows + "</div>" +
    '<p class="rec-dayfoot">' + t("Pick a bill to see it here, with Edit, Pause and End.") + "</p>";
}
/* "Shared · Alex pays", or the person's name; nothing when there is one person */
function whoText(r) {
  if (!couple()) return "";
  if (r.p !== null) return pname(r.p);
  return t("Shared") + (r.by ? " · " + t("{name} pays", { name: pname(r.by) }) : "");
}

/* ---------- the list of rules, in time order ---------- */
function list(listed, shown) {
  ui.order = [];
  if (!shown.length) {
    const who = state.scope === "all" ? "" : pname(state.scope);
    return '<div class="w-empty"><b>' + t("No rules") + "</b><p>" + (ui.tab === "income" ? t("No recurring income here yet.") : who ? t("Nothing repeats for {name} yet.", { name: esc(who) }) : t("No recurring bills here yet.")) + "</p></div>";
  }
  const running = shown.filter((r) => !over(r)), ended = shown.filter(over);
  // Next 7 days, then the rest of that month, then month by month; paused at the end
  const week = addD(TODAY, 7), groups = [], at = {};
  const put = (key, label, r) => { if (!at[key]) { at[key] = { label, rows: [] }; groups.push(at[key]); } at[key].rows.push(r); };
  byNext(running).forEach((r) => {
    const nx = nextOf(r);
    if (!nx) return put("paused", t("Paused"), r);
    if (nx <= week) return put("week", t("Next 7 days"), r);
    const [y, mo] = ym(nx), weekMonth = week.slice(0, 7) === nx.slice(0, 7);
    const yr = y !== +TODAY.slice(0, 4) ? " " + y : "";
    put(nx.slice(0, 7), weekMonth ? t("Later in {month}", { month: monthIn(mo) + yr }) : monthName(mo) + yr, r);
  });
  if (at.paused) { groups.splice(groups.indexOf(at.paused), 1); groups.push(at.paused); }
  let html = groups.map((g) => {
    g.rows.forEach((r) => ui.order.push(r.id));
    const tot = sum(g.rows, (r) => (nextOf(r) ? ruleAmt(r) : 0));
    return '<div class="w-dayh">' + esc(g.label) + (tot ? '<span class="amt">' + bdi(esc((ui.tab === "income" ? "+" : "") + f(tot))) + "</span>" : "") + "</div>" + g.rows.map(ruleRow).join("");
  }).join("");
  if (ended.length) {
    if (!ui.endedOpen && ended.some((r) => r.id === ui.sel)) ui.endedOpen = true;
    html += '<button type="button" class="w-dayh rec-endh" data-ended aria-expanded="' + ui.endedOpen + '">' + t("Ended") + "<span>" + ended.length + icon("chev") + "</span></button>";
    if (ui.endedOpen) {
      const rows = ended.slice().sort((a, b) => (a.endDate < b.endDate ? 1 : -1));
      rows.forEach((r) => ui.order.push(r.id));
      html += rows.map(ruleRow).join("");
    }
  }
  return html;
}

/* A rule: when it lands next and who it's for; the amount, with a month's worth when it isn't monthly */
function ruleRow(r) {
  const nx = nextOf(r), inc = isIncome(r), pc = recentChange(r);
  const state_ = r.paused ? t("Paused") : nx ? "" : t("Ended");
  const bits = [];
  if (nx) bits.push(relDay(nx));
  else if (r.endDate && !r.paused) bits.push(t("Ended {date}", { date: dlab(r.endDate) }));
  else bits.push(state_);
  if (couple()) bits.push(pname(r.p));
  // How often, when it isn't monthly ("Every 2 weeks", "Yearly"); the day is already said
  if (r.freq !== "monthly" || (r.every || 1) !== 1) bits.push((r.every || 1) === 1 ? { daily: t("Daily"), weekly: t("Weekly"), monthly: t("Monthly"), yearly: t("Yearly") }[r.freq] : everyN(r.freq, r.every));
  const up = pc && !state_ ? '<small class="' + (pc.to > pc.from ? "up-bad" : "dn-good") + '">' + (pc.to > pc.from ? "↑ " : "↓ ") +
    '<span class="rec-sr">' + (pc.to > pc.from ? t("went up") : t("went down")) + " </span>" + m(scaled(r, Math.abs(pc.to - pc.from))) + "</small>" : "";
  const perM = !up && (r.freq !== "monthly" || (r.every || 1) !== 1) ? "<small>" + t("{amount} a month", { amount: m(perMonth(r)) }) + "</small>" : "";
  return '<button type="button" class="w-rrow' + (r.id === ui.sel && !ui.cal ? " sel" : "") + (state_ ? " off" : "") + '" data-rid="' + r.id + '" aria-pressed="' + (r.id === ui.sel) + '">' +
    tile(r.c, 40) +
    '<div class="rec-rn"><h6>' + esc(r.n) + "</h6><p>" + esc(bits.join(" · ")) + "</p></div>" +
    '<span class="amt' + (inc ? " pos" : "") + '">' + (r.varies ? t("about") + " " : "") + m(ruleAmt(r), inc ? "+" : "") + up + perM + "</span></button>";
}

/* ---------- the rule's side panel (a full-screen page on phones) ----------
   As on the phone, and in Contacts and Calendar: Edit at the top right, the facts as rows,
   the actions as rows at the bottom with Delete last, in red. */
function inspector(r) {
  const box = root.querySelector("#rec-insp");
  const inc = isIncome(r), h = hist(r), paid = sum(h, (x) => amt(x)), pc = change(r);
  const isOver = over(r);
  const next = r.paused ? [] : ruleDates(r, addD(TODAY, 1), "2199-12-31", phone() ? 2 : 4);
  const missed = r.missed && r.missed.length ? '<div class="w-panel rec-miss"><b>' + tn(r.missed.length, "{n} date was skipped while paused", "{n} dates were skipped while paused") + "</b> " +
    esc(r.missed.map(dlab).join(", ")) + '<span class="w-noticeb"><button type="button" class="w-btn ghost" data-miss-add="' + r.id + '">' + t("Add them") + '</button><button type="button" class="w-btn ghost" data-miss-no="' + r.id + '">' + t("Dismiss") + "</button></span></div>" : "";
  const del = inc ? t("Delete income") : t("Delete bill");
  const who = whoText(r);
  const pcText = pc ? t("From {from} to {to} on {date}", { from: m(scaled(r, pc.from)), to: m(scaled(r, pc.to)), date: esc(dlab(pc.d)) }) : "";

  if (phone()) {
    const last = h.slice(-3).reverse();
    const gr = (k, v, cls) => '<div class="w-gr"><span class="k">' + k + '</span><span class="v' + (cls ? " " + cls : "") + '">' + v + "</span></div>";
    box.innerHTML =
      '<div class="w-mh rec-mh"><button type="button" class="w-plink" data-close>' + icon("left") + t("Recurring") + '</button><button type="button" class="w-plink" data-act="edit">' + t("Edit") + "</button></div>" +
      '<div class="rec-mhero">' + "<b>" + esc(r.n) + '</b><span class="rec-mamt amt' + (inc ? " pos" : "") + '">' + (r.varies ? "<small>" + t("about") + "</small> " : "") + bigM(ruleAmt(r)) + "</span>" +
        '<span class="rec-msub">' + esc([describe(r), who, r.paused ? t("Paused") : isOver ? t("Ended") : ""].filter(Boolean).join(" · ")) + "</span></div>" +
      missed +
      (pc ? '<div class="w-gl rec-pcg"><div class="w-gr"><span class="rec-pci' + (pc.to > pc.from ? "" : " down") + '">' + icon("trend") + '</span><span class="k">' +
        (pc.to > pc.from ? t("Price went up") : t("Price went down")) + "<small>" + pcText + "</small></span></div></div>" : "") +
      '<div class="w-glh">' + t("Next") + '</div><div class="w-gl">' + (next.length ? next.map((d) => gr(esc(dlabW(d)), esc(inDays(d)))).join("")
        : '<div class="w-gr"><span class="k">' + (r.paused ? t("Paused, nothing scheduled") : t("No more charges")) + "</span></div>") + "</div>" +
      '<div class="w-glh">' + (inc ? t("Last payments") : t("Last charges")) + '</div><div class="w-gl">' + (last.length ? last.map((x) => gr(esc(dlabY(x.d)), '<span class="amt">' + m(amt(x)) + "</span>")).join("")
        : '<div class="w-gr"><span class="k">' + t("Nothing added yet") + "</span></div>") + "</div>" +
      (isOver ? "" : '<div class="w-gl rec-macts"><button type="button" class="w-gr acc" data-act="pause">' + (r.paused ? t("Resume") : t("Pause")) + "</button>" +
        '<button type="button" class="w-gr acc" data-act="end">' + t("End on a date…") + "</button></div>") +
      '<div class="w-gl rec-macts"><button type="button" class="w-gr red" data-act="del">' + del + "</button></div>";
    return;
  }

  const ends = r.endDate ? (r.endDate < TODAY ? t("Ended on {date}", { date: dlabY(r.endDate) }) : t("On {date}", { date: dlabY(r.endDate) })) : null;
  const howMany = tn(h.length, "{n} time", "{n} times");
  const story = h.length ? (inc ? t("{times}, {amount} received so far", { times: howMany, amount: m(paid) }) : t("{times}, {amount} paid so far", { times: howMany, amount: m(paid) }))
    : next.length ? t("Nothing added yet. The first one is on {date}.", { date: esc(dlab(next[0])) }) : t("Nothing added yet.");
  const kv = (k, v, cls) => '<div class="rec-kv"><span>' + k + '</span><b class="' + (cls || "") + '">' + v + "</b></div>";
  const yr = (d) => esc(dlabW(d)) + (d > addD(TODAY, 330) ? " " + d.slice(0, 4) : "");
  // The bars only say something when the amount moves
  const last12 = h.slice(-12), moves = last12.some((x) => Math.abs(amt(x) - amt(last12[0])) > 0.005);
  const last = h.slice(-3).reverse();
  box.innerHTML =
    (ui.cal && ui.fromDay && ui.day ? '<button type="button" class="w-plink rec-back" data-to-day>' + icon("left") + esc(dlabL(ui.day)) + "</button>" : "") +
    '<div class="rec-ih"><span class="rec-eye2">' + (inc ? t("Recurring income") : t("Recurring bill")) + "</span>" + (r.paused ? '<span class="w-badge">' + t("Paused") + "</span>" : isOver ? '<span class="w-badge">' + t("Ended") + "</span>" : "") +
      '<button type="button" class="w-plink rec-edit" data-act="edit">' + t("Edit") + "</button>" +
      '<button type="button" class="w-x rec-close" data-close aria-label="' + esc(t("Close")) + '">' + icon("x") + "</button></div>" +
    '<div class="rec-iamt"><span class="rec-amt w-big amt' + (inc ? " pos" : "") + '">' + (r.varies ? '<span class="rec-about">' + t("about") + " </span>" : "") + bigM(ruleAmt(r), inc ? "+" : "") + "</span>" +
      '<span class="rec-iname">' + esc(r.n) + '</span><span class="rec-idesc">' + esc(describe(r)) + "</span></div>" +
    missed +
    (pc ? '<div class="rec-pcard"><span class="rec-pci' + (pc.to > pc.from ? "" : " down") + '">' + icon("trend") + "</span><span><b>" + (pc.to > pc.from ? t("Price went up") : t("Price went down")) + "</b><small>" + pcText + "</small></span></div>" : "") +
    '<div class="rec-kvs">' + kv(t("Category"), tile(r.c, 24) + esc(r.c), "ic") + (who ? kv(t("Who"), esc(who)) : "") + kv(t("Started"), esc(dlabY(r.start))) + (ends ? kv(t("Ends"), esc(ends)) : "") + "</div>" +
    (r.note ? '<div class="rec-pnote"><span>' + t("Note") + "</span><p>" + esc(r.note) + "</p></div>" : "") +
    '<div class="rec-sec2"><div class="rec-sh">' + t("Next") + "</div>" + (next.length ? next.slice(0, 2).map((d) => kv(yr(d), esc(inDays(d)), "dim")).join("") : kv(r.paused ? t("Paused, nothing scheduled") : t("No more charges"), "", "dim")) + "</div>" +
    '<div class="rec-sec2"><div class="rec-sh">' + (inc ? t("Last payments") : t("Last charges")) + "</div>" +
      (moves ? histBars(r, last12, inc) : "") +
      (last.length ? last.map((x) => kv(esc(dlabY(x.d)), '<span class="amt">' + m(amt(x)) + "</span>")).join("") : kv(t("Nothing added yet"), "", "dim")) +
      (h.length ? '<p class="rec-cap">' + story + "</p>" : "") + "</div>" +
    '<div class="w-pacts rec-acts">' +
      (isOver ? "" : '<button type="button" data-act="pause">' + (r.paused ? t("Resume") : t("Pause")) + "</button>" +
        '<button type="button" data-act="end">' + t("End on a date…") + "</button>") +
      '<button type="button" class="red" data-act="del">' + del + "</button></div>";
  box.querySelectorAll("[data-hb]").forEach((b) => { const x = last12[+b.dataset.hb]; hover(b, "<b>" + esc(dlabY(x.d)) + "</b>" + row(inc ? t("Received") : t("Paid"), m(amt(x)))); });
}

/* The last charges as bars: grey, the latest in the accent; one label in two, the latest always */
function histBars(r, hv, inc) {
  const vals = hv.map((x) => amt(x)), mx = Math.max(...vals, 1), n = hv.length;
  const label = t("History of {name}: {n} charges, the last {amount} on {date}", { name: r.n, n, amount: f(vals[n - 1]), date: dlabY(hv[n - 1].d) });
  return '<div class="rec-hist" role="img" aria-label="' + esc(label) + '"><div class="rec-hbars">' +
    hv.map((x, i) => '<i data-hb="' + i + '" class="' + (i === n - 1 ? "on" : "") + '" style="height:' + Math.max(6, (vals[i] / mx) * 100).toFixed(1) + '%"></i>').join("") + "</div>" +
    '<div class="rec-hax" aria-hidden="true">' + hv.map((x, i) => "<span" + (i === n - 1 ? ' class="on"' : "") + ">" + (i % 2 === 0 || i === n - 1 ? esc(F.mon[+x.d.slice(5, 7) - 1]) : "") + "</span>").join("") + "</div></div>";
}

/* ---------- opening and closing the panel below 1280 px ---------- */
function setOpen(open) {
  const box = root.querySelector("#rec-insp"), scrim = root.querySelector(".rec-scrim");
  if (!box) return;
  const overlay = open && !wide();
  box.classList.toggle("open", overlay);
  if (scrim) scrim.hidden = !overlay;
  if (overlay) { box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); }
  else { box.removeAttribute("role"); box.removeAttribute("aria-modal"); }
  document.documentElement.classList.toggle("rec-lock", overlay && phone());
}
function focusPanel() { const box = root && root.querySelector("#rec-insp.open"); if (box) box.focus(); }
function select(id, opts) {
  ui.sel = id;
  ui.open = !(opts && opts.keepClosed);
  history.replaceState(history.state, "", "/recurring?id=" + encodeURIComponent(id));
  render();
  if (ui.open && !wide()) focusPanel();
}
function closePanel() {
  const id = ui.sel;
  ui.open = false;
  if (!wide()) ui.sel = null;
  history.replaceState(history.state, "", "/recurring");
  render();
  const b = root.querySelector('[data-rid="' + id + '"]');
  if (b) b.focus();
}
function rememberFocus() {
  const a = document.activeElement;
  if (!root || !a || !root.contains(a)) return null;
  for (const attr of ["data-act", "data-rid", "data-rd", "data-ended", "data-close", "data-rtab", "data-rview"]) if (a.hasAttribute(attr)) return "[" + attr + (a.getAttribute(attr) ? '="' + a.getAttribute(attr) + '"' : "") + "]";
  return null;
}
function restoreFocus(sel) { if (!sel) return; const n = root.querySelector(sel); if (n) n.focus({ preventScroll: true }); }

/* ---------- events ---------- */
function onKeydown(ev) {
  const box = root.querySelector("#rec-insp.open");
  if (box && box.contains(ev.target)) {
    if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); closePanel(); }
    else trapFocus(box, ev);
  }
}
async function onClick(ev) {
  const g = (sel) => ev.target.closest(sel);
  let b;
  if ((b = g("[data-rtab]"))) { if (ui.tab !== b.dataset.rtab) { ui.tab = b.dataset.rtab; ui.day = null; ui.fromDay = false; render(); } return; }
  if ((b = g("[data-rview]"))) { const cal = b.dataset.rview === "cal"; if (cal !== ui.cal) { ui.cal = cal; ui.day = null; ui.fromDay = false; render(); } return; }
  if (g("[data-to-day]")) { ui.fromDay = false; render(); return; }
  if (g("[data-new]")) { openAddSheet({ repeat: true }); return; }
  if ((b = g("[data-rid]"))) { select(b.dataset.rid); return; }
  if ((b = g("[data-sel]"))) {
    // A bill picked from the day opens in the same side panel, with the day a tap away
    ui.fromDay = true;
    select(b.dataset.sel);
    const box = root.querySelector("#rec-insp");
    if (box && wide()) box.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return;
  }
  if ((b = g("[data-rd]"))) { hideTip(); ui.day = b.dataset.rd; ui.fromDay = false; render(); return; }
  if (g("[data-ended]")) { ui.endedOpen = !ui.endedOpen; render(); return; }
  if (g("[data-close]")) { closePanel(); return; }
  if ((b = g("[data-miss-add]"))) { missed(b.dataset.missAdd, true); return; }
  if ((b = g("[data-miss-no]"))) { missed(b.dataset.missNo, false); return; }
  if ((b = g("[data-act]"))) {
    const r = ruleById(ui.sel);
    if (!r) return;
    const act = b.dataset.act;
    if (act === "pause") togglePause(r);
    else if (act === "edit") editRule(r);
    else if (act === "end") endRule(r);
    else if (act === "del") deleteRule(r);
  }
}

/* ---------- actions ---------- */
async function openAddSheet(opts) {
  try { const { openAdd } = await import("../add.js"); openAdd(opts); } catch (e) { errorToast(e); }
}
function editRule(r) { openAddSheet({ rule: r }); }

/* Put the API's answer in place of the rule in the browser */
function replaceRule(apiRule) {
  const r = fromRule(apiRule);
  const i = state.rules.findIndex((x) => x.id === r.id);
  if (i >= 0) state.rules[i] = r; else state.rules.push(r);
  return r;
}

async function togglePause(r, quiet) {
  const was = r.paused;
  try {
    const out = await POST("/recurring/" + r.id + (was ? "/resume" : "/pause"));
    const nr = replaceRule(out);
    if (nr.lastRun !== r.lastRun && !was) await reloadLedger();   // pausing first catches up anything due
    refresh({ rules: true });
    if (quiet) return;
    if (was) toast(nr.missed && nr.missed.length ? tn(nr.missed.length, "{name} resumed. It skipped {n} date: add it from the rule.", "{name} resumed. It skipped {n} dates: add them from the rule.", { name: r.n }) : t("{name} resumed", { name: r.n }), () => togglePause(nr, true));
    else toast(t("{name} paused. Nothing is added until you resume it.", { name: r.n }), () => togglePause(nr, true));
  } catch (e) { errorToast(e); if (quiet) throw e; }
}

/* End on a date: a sheet, the last day as a row; the date reads like the rest of the app */
function endRule(r) {
  const last = hist(r).filter((x) => x.rid === r.id).pop();
  const def = last && last.d > r.start ? (last.d > TODAY ? TODAY : last.d) : (r.start > TODAY ? r.start : TODAY);
  openDialog({
    kind: "sheet",
    title: t("End {name}", { name: esc(r.n) }),
    body: '<div class="w-gl"><label class="w-gr rec-endrow"><span class="k">' + t("Last day") + '</span><span class="rec-datep"><span id="rec-endl">' + esc(dlabW(def) + ", " + def.slice(0, 4)) + "</span>" +
      '<input type="date" id="rec-end" value="' + def + '" min="' + r.start + '" required aria-label="' + esc(t("Last day")) + '"></span></label></div>' +
      '<p class="w-glf">' + t("What it already added stays. Nothing is added after this day.") + "</p>",
    ok: t("End"),
    onOpen: (dlg) => {
      dlg.classList.add("rec-endsheet");
      const inp = dlg.querySelector("#rec-end"), lab = dlg.querySelector("#rec-endl");
      inp.addEventListener("click", () => { try { inp.showPicker(); } catch (e) { /* the field still works by typing */ } });
      inp.addEventListener("change", () => { if (inp.value) lab.textContent = dlabW(inp.value) + ", " + inp.value.slice(0, 4); });
      // The date is already chosen: focus the action, as Calendar does, not the field
      setTimeout(() => { const ok = dlg.querySelector("[data-dlg-ok]"); if (ok) ok.focus(); }, 0);
    },
    onOk: async (dlg) => {
      const d = dlg.querySelector("#rec-end").value;
      if (!d) throw new Error(t("Choose a date."));
      if (d < r.start) throw new Error(t("A rule cannot end before it starts."));
      const out = await POST("/recurring/" + r.id + "/end", { date: d });
      replaceRule(out);
      refresh({ rules: true });
      toast(d < TODAY ? t("{name} ended on {date}", { name: r.n, date: dlab(d) }) : t("{name} ends on {date}", { name: r.n, date: dlab(d) }));
    },
  });
}

/* Delete: an alert, like deleting a repeating event in Calendar. Keeping what it added comes first. */
function deleteRule(r) {
  const made = state.tx.filter((x) => x.rid === r.id);
  const total = made.reduce((s, x) => s + x.a, 0);
  const inc = isIncome(r);
  const go = async (applyTo) => {
    await DEL("/recurring/" + r.id, { applyTo });
    await Promise.all([reloadRules(), applyTo === "all" && made.length ? reloadLedger() : null]);
    ui.sel = null; ui.open = false; ui.fromDay = false;
    history.replaceState(history.state, "", "/recurring");
    refresh({ rules: true });
    toast(applyTo === "all" && made.length ? tn(made.length, "Deleted {name} and its {n} transaction", "Deleted {name} and its {n} transactions", { name: r.n }) : t("Deleted {name}. Past transactions stay.", { name: r.n }));
  };
  const all = made.length ? '<button type="button" class="w-dlgok danger rec-delall" data-delall>' +
    (inc ? tn(made.length, "Delete income and its {n} transaction", "Delete income and its {n} transactions") : tn(made.length, "Delete bill and its {n} transaction", "Delete bill and its {n} transactions")) + "</button>" : "";
  openDialog({
    kind: "alert",
    top: tile(r.c, 48),
    title: t("Delete {name}?", { name: esc(r.n) }),
    body: "<p>" + (made.length ? tn(made.length, "Nothing more is added from it. The transaction it added ({amount}) can stay as an ordinary one.", "Nothing more is added from it. The {n} transactions it added ({amount}) can stay as ordinary ones.", { amount: m(total) }) : t("Nothing more is added from it.")) + "</p>" + all,
    ok: made.length ? (inc ? t("Delete income only") : t("Delete bill only")) : inc ? t("Delete income") : t("Delete bill"),
    danger: true,
    onOpen: (dlg) => {
      if (!made.length) return;
      dlg.classList.add("rec-del3");
      dlg.querySelector("[data-delall]").addEventListener("click", async (ev) => {
        const b = ev.currentTarget;
        b.disabled = true;
        try { await go("all"); closeDialog(); } catch (e) { dialogError(e.message || t("Something went wrong.")); b.disabled = false; }
      });
    },
    onOk: () => go("future"),
  });
}

async function missed(id, add) {
  const r = ruleById(id);
  if (!r) return;
  const n = (r.missed || []).length;
  try {
    const out = await POST("/recurring/" + id + "/missed", { add });
    replaceRule(out);
    if (add) await reloadLedger();
    refresh({ rules: true });
    toast(add ? tn(n, "Added {n} transaction for {name}", "Added {n} transactions for {name}", { name: r.n }) : t("Skipped dates dismissed"));
  } catch (e) { errorToast(e); }
}
