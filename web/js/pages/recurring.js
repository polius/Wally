/* Recurring: everything already promised, in one place.
   What bills cost each month, when the next ones land, what changed, and each rule's story.
   Rules come from /recurring; price changes and payees that look like they repeat are
   worked out here, from past transactions. */
import {
  state, t, tn, esc, f, fk, f0, pct, bigMoney, dlab, dlabW, dlabL, dlabY, monthYear, F, TODAY, addD, ds, ym, ymAdd, dim,
  amt, tile, cc, av, pname, couple, icon, wkOff, dows, rerank, POST, DEL, fromRule, reloadRules, reloadLedger, savePrefs,
} from "../core.js";
import { ruleDates, occurrences, ruleAmt, perMonth, isIncome, nextOf, inDays, ruleHist, describe, shortDesc, PER } from "../sched.js";
import { hover, hideTip, row, chart, el, txt, toast, errorToast, openDialog, seg, trapFocus } from "../ui.js";
import { refresh, scopeChips } from "../shell.js";

const RECENT = 548;          // a price change from the last 18 months is still news
const DETECT_SINCE = 366;    // payees are checked over the last year
const DETECT_MIN = 5;        // seen at least this many times

const phoneMQ = matchMedia("(max-width:767px)");
const wideMQ = matchMedia("(min-width:1280px)");

const ui = { tab: "all", sel: null, open: false, endedOpen: false, order: [], day: null };
let root = null;
let H = new Map();           // history per rule, worked out once per render

/* ---------- small helpers ---------- */
/* Amounts stay left to right inside right-to-left text */
const bdi = (html) => "<bdi>" + html + "</bdi>";
const m = (n, sign) => bdi((sign || "") + esc(f(n)));
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
function dismissed() { return (state.prefs && state.prefs.recDismissed) || {}; }
function dismiss(key) { const d = Object.assign({}, dismissed(), { [key]: 1 }); savePrefs({ recDismissed: d }); }
function keep(r) { return ui.tab === "all" || (ui.tab === "income") === isIncome(r); }
function byNext(list) {
  return list.slice().sort((a, b) => { const x = nextOf(a) || "9", y = nextOf(b) || "9"; return x < y ? -1 : x > y ? 1 : a.n.localeCompare(b.n); });
}
function ruleById(id) { return state.rules.find((r) => r.id === id) || null; }

/* ---------- payees with a steady pattern but no rule ---------- */
export function detectRules() {
  const names = new Set(state.rules.map((r) => norm(r.n)));
  const since = addD(TODAY, -DETECT_SINCE);
  const by = {};
  for (const x of state.tx) {              // newest first
    if (x.d < since) break;
    if (x.d > TODAY || x.rid || x.gr) continue;
    const k = norm(x.n);
    if (!k || names.has(k)) continue;
    (by[k] = by[k] || []).push(x);
  }
  const out = [];
  Object.keys(by).forEach((k) => {
    const l = by[k].slice().reverse();      // oldest first
    if (l.length < DETECT_MIN || l.some((x) => x.type !== l[0].type)) return;
    const days = l.map((x) => +x.d.slice(8));
    if (Math.max(...days) - Math.min(...days) > 3) return;   // bank dates move a day or two
    const gaps = new Set();
    for (let i = 1; i < l.length; i++) { const a = ym(l[i - 1].d), b = ym(l[i].d); gaps.add((b[0] - a[0]) * 12 + b[1] - a[1]); }
    if (gaps.size !== 1) return;
    const every = [...gaps][0];
    if (every < 1 || every > 6) return;
    const last = l[l.length - 1];
    if (last.d < addD(TODAY, -(every * 31 + 10))) return;   // it stopped
    const counts = {};
    days.forEach((d) => { counts[d] = (counts[d] || 0) + 1; });
    const day = +Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a - b)[0];
    const vals = l.map((x) => x.a), avg = sum(vals, (v) => v) / vals.length, mn = Math.min(...vals), mx = Math.max(...vals);
    let q = ym(last.d), next;
    do { q = ymAdd(q[0], q[1], every); next = ds(q[0], q[1], Math.min(day, dim(q[0], q[1]))); } while (next <= TODAY);
    out.push({ key: k, n: last.n, c: last.c, p: last.p, sh: last.sh, type: last.type, every, day, last: last.d, next, avg, varies: mx - mn > avg * 0.05, k: l.length, mn, mx });
  });
  return out.sort((a, b) => b.avg - a.avg);
}

/* ---------- page ---------- */
export function mount(el, route) {
  root = el;
  const id = route.query.get("id");
  ui.sel = id || null;
  ui.open = !!id;
  ui.day = null;
  root.innerHTML =
    '<header class="w-head rec-head"><div class="w-title"><h3>' + t("Recurring") + "</h3></div>" +
      seg("rec-tab", [["all", t("All")], ["expense", t("Bills")], ["income", t("Income")]], ui.tab, t("Show")) +
      '<div class="w-head-r"><button type="button" class="w-btn ghost" id="rec-new">' + icon("plus") + t("New rule") + "</button></div></header>" +
    '<div id="rec-chips"></div>' +
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

function render() {
  if (!root) return;
  H = new Map();
  rerank(TODAY.slice(0, 8) + "01", TODAY);   // category colors by rank this month, as on the Dashboard
  const focus = rememberFocus();
  root.querySelectorAll("#rec-tab button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === ui.tab)));
  root.querySelector("#rec-chips").innerHTML = scopeChips();
  const page = root.querySelector("#rec-page");
  const rules = state.rules.filter((r) => ruleAmt(r) > 0);
  root.querySelector("#rec-tab").hidden = !state.rules.length;

  if (!state.rules.length) {
    const notes = noticed([]);
    page.innerHTML = '<section class="w-panel">' + emptyRules() + "</section>" +
      (notes ? '<section class="w-panel"><div class="w-ph"><div><h4>' + t("Wally noticed") + "</h4><p>" + t("Payees that look like they repeat") + '</p></div></div><div class="w-list">' + notes + "</div></section>" : "");
    setOpen(false);
    return;
  }

  // Keep the selection on something visible
  let sel = ruleById(ui.sel);
  if (sel && superseded(sel)) { sel = latestVersion(sel); ui.sel = sel.id; }
  if (sel && ruleAmt(sel) <= 0) sel = null;
  const listed = rules.filter((r) => !superseded(r));
  const shown = listed.filter(keep);
  if (!sel && wide() && shown.length) {
    const live = byNext(shown.filter((r) => !over(r)));
    sel = live[0] || shown[0];
  }
  ui.sel = sel ? sel.id : null;
  if (!sel) ui.open = false;

  page.innerHTML =
    '<section class="w-panel rec-kpis-p">' + kpis(rules) + "</section>" +
    '<div class="w-grid2 rec-top">' +
      '<section class="w-panel"><div class="w-ph"><div><h4>' + t("Next five weeks") + '</h4><p id="rec-cal-sub"></p></div>' +
        '<div class="w-legend"><span><s class="rec-lg-today"></s>' + t("Today") + '</span><span><s class="rec-lg-in"></s>' + t("Money in") + "</span></div></div>" +
        '<div class="w-rcal rec-cal" id="rec-cal"></div></section>' +
      // Beside the calendar: the day picked in it, over what Wally noticed
      '<div class="rec-side"><section class="w-panel rec-day" id="rec-day" hidden></section>' +
      '<section class="w-panel"><div class="w-ph"><div><h4>' + t("Wally noticed") + "</h4><p>" + t("Price changes, and payees that look like they repeat") + '</p></div></div><div class="w-list" id="rec-notice">' +
        (noticed(rules) || '<div class="w-empty rec-nonew"><b>' + t("Nothing new") + "</b><p>" + t("No price changes or new patterns.") + "</p></div>") + "</div></section></div>" +
    "</div>" +
    '<div class="w-tx rec-body">' +
      '<section class="w-panel rec-list" id="rec-list" aria-label="' + esc(t("Rules")) + '">' + list(listed, shown) + "</section>" +
      '<aside class="w-panel w-insp rec-insp" id="rec-insp" tabindex="-1" aria-label="' + esc(sel ? sel.n : t("Rule")) + '"></aside>' +
    "</div>" +
    '<div class="rec-scrim" data-close hidden></div>';

  calendar();
  if (sel) inspector(sel); else root.querySelector("#rec-insp").innerHTML = '<div class="w-empty"><b>' + t("Nothing selected") + "</b><p>" + t("Pick a rule to see it here.") + "</p></div>";
  setOpen(ui.open && !!sel);
  restoreFocus(focus);
}

function emptyRules() {
  return '<div class="w-empty rec-empty"><span class="w-empty-i">' + icon("repeat") + "</span><b>" + t("Nothing repeats yet") + "</b><p>" +
    t("Add rent, salaries and subscriptions once. Wally adds each one on its day, and the calendars count them before they happen.") +
    '</p><button type="button" class="w-btn primary" data-new>' + icon("plus") + t("New rule") + "</button></div>";
}

/* ---------- the figures at the top ---------- */
function kpis(rules) {
  const live = rules.filter((r) => nextOf(r));
  const bills = live.filter((r) => !isIncome(r)), incs = live.filter(isIncome);
  const billM = sum(bills, (r) => perMonth(r)), incM = sum(incs, (r) => perMonth(r));
  const to30 = addD(TODAY, 30);
  const o30 = occurrences(addD(TODAY, 1), to30).filter((x) => !isIncome(x.r) && ruleAmt(x.r) > 0);
  const sum30 = sum(o30, (x) => ruleAmt(x.r));
  return '<div class="w-kpis solo rec-kpis">' +
    '<div class="w-kpi"><span>' + t("Bills per month") + '</span><b class="amt">' + m(billM) + "</b><small>" + tn(bills.length, "{n} active rule", "{n} active rules") + "</small></div>" +
    '<div class="w-kpi"><span>' + t("Recurring income per month") + '</span><b class="pos amt">' + m(incM) + "</b><small>" + tn(incs.length, "{n} source", "{n} sources") + "</small></div>" +
    '<div class="w-kpi"><span>' + t("Bills take") + "</span><b>" + (incM ? esc(pct(billM / incM)) : "—") + "</b><small>" + (incM ? t("of recurring income") : t("No recurring income")) + "</small></div>" +
    '<div class="w-kpi safe"><span>' + t("Next 30 days") + '</span><b class="amt">' + m(sum30) + "</b><small>" + tn(o30.length, "{n} charge until {date}", "{n} charges until {date}", { date: esc(dlab(to30)) }) + "</small></div>" +
    "</div>";
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
    const ics = items.slice(0, 3).map((x) => tile(x.r.c, 18)).join("") + (items.length > 3 ? '<span class="more">+' + (items.length - 3) + "</span>" : "");
    const day = +d.slice(8) === 1 ? esc(dlab(d)) : +d.slice(8);
    const on = d === ui.day && items.length > 0;
    const cls = "w-rday" + (d < TODAY ? " past" : "") + (d === TODAY ? " t" : "") + (inn ? " in" : "") + (on ? " sel" : "");
    const body = '<span class="d">' + day + '</span><span class="ics">' + ics + '</span><span class="v">' + (inn ? '<b class="pos">' + bdi("+" + esc(fkn(inn))) + "</b> " : "") + (out ? bdi(esc(fkn(out))) : "") + "</span>";
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
/* The day picked in the calendar: what lands on it, each opening its rule */
function dayList(items) {
  const box = root.querySelector("#rec-day");
  box.hidden = !items;
  if (!items) { box.innerHTML = ""; return; }
  box.innerHTML = '<div class="w-ph"><div><h4>' + esc(dlabL(ui.day)) + '</h4></div><button type="button" class="w-x" data-day-close aria-label="' + esc(t("Close")) + '">' + icon("x") + "</button></div>" +
    '<div class="w-list">' + items.map(({ r }) => {
      const inc = isIncome(r), who = couple() ? '<span class="rec-who">' + av(r.p, "sm") + esc(pname(r.p)) + "</span> · " : "";
      return '<button type="button" class="w-rrow rec-drow' + (r.id === ui.sel ? " sel" : "") + '" data-sel="' + r.id + '">' + tile(r.c, 32) +
        '<div class="rec-rn"><h6>' + esc(r.n) + '</h6><p><span class="rec-meta">' + who + esc(shortDesc(r)) + "</span></p></div>" +
        '<span class="amt' + (inc ? " pos" : "") + '">' + (r.varies ? t("about") + " " : "") + m(ruleAmt(r), inc ? "+" : "") + "</span></button>";
    }).join("") + "</div>";
}

/* ---------- Wally noticed ---------- */
function noticed(rules) {
  const dis = dismissed(), out = [];
  // Dates skipped while a rule was paused, offered once
  state.rules.forEach((r) => {
    if (!r.missed || !r.missed.length || ruleAmt(r) <= 0 || !keep(r)) return;
    const n = r.missed.length;
    out.push('<div class="w-li">' + tile(r.c) + "<div><h6>" + tn(n, "{name} skipped {n} date while paused", "{name} skipped {n} dates while paused", { name: esc(r.n) }) + "</h6><p>" +
      esc(r.missed.slice(0, 4).map(dlab).join(", ") + (n > 4 ? ", …" : "")) + " · " + t("{amount} in all", { amount: m(ruleAmt(r) * n) }) +
      '</p></div><span class="w-noticeb"><button type="button" class="w-btn ghost" data-miss-add="' + r.id + '">' + t("Add them") + '</button>' +
      '<button type="button" class="w-x" data-miss-no="' + r.id + '" aria-label="' + esc(t("Dismiss")) + '">' + icon("x") + "</button></span></div>");
  });
  // Price changes
  rules.forEach((r) => {
    if (over(r) || superseded(r) || !keep(r)) return;
    const pc = recentChange(r);
    if (!pc) return;
    const k = "p:" + norm(r.n) + ":" + pc.d;
    if (dis[k]) return;
    const up = pc.to > pc.from, diff = scaled(r, Math.abs(pc.to - pc.from));
    const yearly = (diff * PER[r.freq] * 12) / (r.every || 1);
    const [y, mo] = ym(pc.d);
    out.push('<div class="w-li">' + tile(r.c) + "<div><h6>" + (up ? t("{name} went up {amount}", { name: esc(r.n), amount: m(diff) }) : t("{name} went down {amount}", { name: esc(r.n), amount: m(diff) })) +
      "</h6><p>" + t("From {from} to {to} in {month}. That is {year} a year.", { from: m(scaled(r, pc.from)), to: m(scaled(r, pc.to)), month: esc(monthYear(y, mo)), year: m(yearly) }) +
      '</p></div><span class="w-noticeb"><button type="button" class="w-link" data-sel="' + r.id + '">' + t("View") + "</button>" +
      '<button type="button" class="w-x" data-dis="' + esc(k) + '" aria-label="' + esc(t("Dismiss")) + '">' + icon("x") + "</button></span></div>");
  });
  // Payees with a steady pattern but no rule
  detectRules().forEach((x) => {
    if (dis["d:" + x.key] || amt({ p: x.p, a: x.avg, sh: x.sh }) <= 0) return;
    if (ui.tab !== "all" && (ui.tab === "income") !== (x.type === "income")) return;
    const title = x.every === 1 ? t("{name} looks monthly", { name: esc(x.n) }) : t("{name} looks like every {n} months", { name: esc(x.n), n: x.every });
    const body = x.varies ? t("{n} times on day {day}, between {min} and {max}.", { n: x.k, day: x.day, min: esc(f0(x.mn)), max: esc(f0(x.mx)) })
      : t("{n} times on day {day}, {amount} each.", { n: x.k, day: x.day, amount: m(x.avg) });
    out.push('<div class="w-li">' + tile(x.c) + "<div><h6>" + title + "</h6><p>" + body + '</p></div><span class="w-noticeb">' +
      '<button type="button" class="w-btn ghost" data-mk="' + esc(x.key) + '">' + t("Make it a rule") + "</button>" +
      '<button type="button" class="w-x" data-dis="' + esc("d:" + x.key) + '" aria-label="' + esc(t("Dismiss")) + '">' + icon("x") + "</button></span></div>");
  });
  return out.join("");
}

/* ---------- the list of rules ---------- */
function list(listed, shown) {
  ui.order = [];
  if (!shown.length) {
    const who = state.scope === "all" ? "" : pname(state.scope);
    return '<div class="w-empty"><b>' + t("No rules") + "</b><p>" + (ui.tab === "income" ? t("No recurring income here yet.") : ui.tab === "expense" ? t("No recurring bills here yet.") :
      who ? t("Nothing repeats for {name} yet.", { name: esc(who) }) : t("Nothing repeats yet.")) + "</p></div>";
  }
  const running = shown.filter((r) => !over(r)), ended = shown.filter(over);
  const groups = [[t("Bills and subscriptions"), running.filter((r) => !isIncome(r))], [t("Income"), running.filter(isIncome)]];
  let html = groups.filter((g) => g[1].length).map(([label, l]) => {
    const tot = sum(l.filter((r) => nextOf(r)), (r) => perMonth(r));
    const rows = byNext(l);
    rows.forEach((r) => ui.order.push(r.id));
    return '<div class="w-dayh">' + label + '<span class="amt">' + t("{amount} a month", { amount: m(tot) }) + "</span></div>" + rows.map(ruleRow).join("");
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

function ruleRow(r) {
  const nx = nextOf(r), inc = isIncome(r), h = hist(r).slice(-6).map((x) => amt(x)), pc = recentChange(r);
  const state_ = r.paused ? t("Paused") : nx ? "" : t("Ended");
  const who = couple() ? '<span class="rec-who">' + av(r.p, "sm") + esc(pname(r.p)) + "</span> · " : "";
  const pill = pc && !state_ ? ' <span class="w-pill ' + (pc.to > pc.from ? "bad" : "good") + '">' + (pc.to > pc.from ? "▲ " : "▼ ") +
    '<span class="rec-sr">' + (pc.to > pc.from ? t("went up") : t("went down")) + " </span>" + m(scaled(r, Math.abs(pc.to - pc.from))) + "</span>" : "";
  const nextTxt = nx ? esc(dlabW(nx)) + "<small>" + esc(inDays(nx)) + "</small>" : r.endDate && !r.paused ? esc(t("Ended {date}", { date: dlab(r.endDate) })) : "—";
  const perM = r.freq !== "monthly" || (r.every || 1) !== 1 ? "<small>" + t("{amount} a month", { amount: m(perMonth(r)) }) + "</small>" : "";
  return '<button type="button" class="w-rrow' + (r.id === ui.sel ? " sel" : "") + (state_ ? " off" : "") + '" data-rid="' + r.id + '" aria-pressed="' + (r.id === ui.sel) + '">' +
    tile(r.c, 32) +
    '<div class="rec-rn"><h6>' + esc(r.n) + (state_ ? ' <span class="w-badge">' + state_ + "</span>" : "") + pill + "</h6>" +
      '<p><span class="rec-meta">' + who + esc(shortDesc(r)) + '</span><span class="rec-nxm">' + (nx ? esc(dlabW(nx)) + " · " + esc(inDays(nx)) : esc(state_ || shortDesc(r))) + "</span></p></div>" +
    '<span class="nx">' + nextTxt + "</span>" +
    spark(h.length ? h : [0], cc(r.c)) +
    '<span class="amt' + (inc ? " pos" : "") + '">' + (r.varies ? t("about") + " " : "") + m(ruleAmt(r), inc ? "+" : "") + perM + "</span></button>";
}

function spark(vals, col) {
  const mx = Math.max(...vals, 1), bw = 9, off = 54 - vals.length * bw;
  return '<svg class="rec-spark" viewBox="0 0 54 24" width="54" height="24" aria-hidden="true">' + vals.map((v, i) => {
    const h = Math.max(2, (v / mx) * 22);
    return '<rect x="' + (off + i * bw + bw * 0.18).toFixed(1) + '" y="' + (24 - h).toFixed(1) + '" width="' + (bw * 0.64).toFixed(1) + '" height="' + h.toFixed(1) +
      '" rx="1.5" fill="' + col + '" fill-opacity="' + (i === vals.length - 1 ? 1 : 0.4) + '"/>';
  }).join("") + "</svg>";
}

/* ---------- the rule's side panel (a full-screen sheet on phones) ---------- */
function inspector(r) {
  const box = root.querySelector("#rec-insp");
  const inc = isIncome(r), h = hist(r), paid = sum(h, (x) => amt(x)), pc = change(r);
  const isOver = over(r);
  const next = r.paused ? [] : ruleDates(r, addD(TODAY, 1), "2199-12-31", phone() ? 2 : 5);
  const missed = r.missed && r.missed.length ? '<div class="w-panel rec-miss"><b>' + tn(r.missed.length, "{n} date was skipped while paused", "{n} dates were skipped while paused") + "</b> " +
    esc(r.missed.map(dlab).join(", ")) + '<span class="w-noticeb"><button type="button" class="w-btn ghost" data-miss-add="' + r.id + '">' + t("Add them") + '</button><button type="button" class="w-btn ghost" data-miss-no="' + r.id + '">' + t("Dismiss") + "</button></span></div>" : "";

  if (phone()) {
    const last = h.slice(-3).reverse();
    box.innerHTML =
      '<div class="w-mh rec-mh"><button type="button" class="w-plink" data-close>' + icon("left") + t("Recurring") + '</button><button type="button" class="w-plink" data-act="edit">' + t("Edit") + "</button></div>" +
      '<div class="rec-mhero">' + tile(r.c, 48) + "<b>" + esc(r.n) + '</b><span class="rec-mamt amt' + (inc ? " pos" : "") + '">' + (r.varies ? '<small>' + t("about") + "</small> " : "") + m(ruleAmt(r)) + "</span>" +
        '<span class="w-hint">' + esc(shortDesc(r)) + (couple() ? " · " + esc(pname(r.p)) : "") + (r.paused ? " · " + t("Paused") : "") + "</span></div>" +
      missed +
      (pc ? '<div class="w-panel rec-pc"><b>' + (pc.to > pc.from ? t("Price went up") : t("Price went down")) + "</b> " + t("from {from} to {to} on {date}", { from: m(scaled(r, pc.from)), to: m(scaled(r, pc.to)), date: esc(dlab(pc.d)) }) + "</div>" : "") +
      '<div class="w-plabel">' + t("Next") + '</div><div class="w-cells">' + (next.length ? next.map((d) => '<div class="w-cell"><span>' + esc(dlabW(d)) + "</span><b>" + esc(inDays(d)) + "</b></div>").join("")
        : '<div class="w-cell"><span>' + (r.paused ? t("Paused, nothing scheduled") : t("No more charges")) + "</span></div>") + "</div>" +
      '<div class="w-plabel">' + (inc ? t("Last payments") : t("Last charges")) + '</div><div class="w-cells">' + (last.length ? last.map((x) => '<div class="w-cell"><span>' + esc(dlabY(x.d)) + '</span><b class="amt">' + m(amt(x)) + "</b></div>").join("")
        : '<div class="w-cell"><span>' + t("Nothing added yet") + "</span></div>") + "</div>" +
      '<div class="w-cells rec-mact">' + (isOver ? "" : '<button type="button" class="w-cell" data-act="pause">' + (r.paused ? t("Resume") : t("Pause")) + "</button>" +
        '<button type="button" class="w-cell" data-act="end">' + t("End on a date") + "</button>") +
        '<button type="button" class="w-cell danger" data-act="del">' + t("Delete rule") + "</button></div>";
    return;
  }

  const ends = r.endDate ? (r.endDate < TODAY ? t("Ended on {date}", { date: dlabY(r.endDate) }) : t("On {date}", { date: dlabY(r.endDate) })) : t("Never");
  const shared = r.p === null && couple();
  const whoVal = shared ? (r.sh ? t("Shared") : t("Shared evenly")) + (r.by ? " · " + t("{name} pays", { name: esc(pname(r.by)) }) : "") : esc(pname(r.p));
  const howMany = tn(h.length, "{n} time", "{n} times");
  let story = h.length ? (inc ? t("{times}, {amount} received so far.", { times: howMany, amount: "<b>" + m(paid) + "</b>" }) : t("{times}, {amount} paid so far.", { times: howMany, amount: "<b>" + m(paid) + "</b>" }))
    : next.length ? t("Nothing added yet. The first one is on {date}.", { date: esc(dlab(next[0])) }) : t("Nothing added yet.");
  if (pc) story += " " + t("Changed from {from} to {to} in {month}.", { from: m(scaled(r, pc.from)), to: m(scaled(r, pc.to)), month: esc(monthYear(...ym(pc.d))) });

  box.innerHTML =
    '<div class="rec-ih"><span class="w-eyebrow">' + (inc ? t("Recurring income") : t("Recurring bill")) + "</span>" + (r.paused ? '<span class="w-badge">' + t("Paused") + "</span>" : isOver ? '<span class="w-badge">' + t("Ended") + "</span>" : "") +
      '<button type="button" class="w-x rec-close" data-close aria-label="' + esc(t("Close")) + '">' + icon("x") + "</button></div>" +
    '<div class="rec-iamt"><span class="w-big' + (inc ? " pos" : "") + '">' + (r.varies ? '<span class="rec-about">' + t("about") + " </span>" : "") + bdi(bigMoney(ruleAmt(r))) + "</span>" +
      '<span class="rec-iname">' + esc(r.n) + '</span><span class="rec-idesc">' + esc(describe(r)) + "</span></div>" +
    missed +
    '<div class="w-fields"><div class="w-field"><span>' + t("Category") + '</span><span class="val">' + tile(r.c, 22) + esc(r.c) + "</span></div>" +
      (couple() ? '<div class="w-field"><span>' + t("Who") + '</span><span class="val">' + av(r.p, "sm") + whoVal + "</span></div>" : "") +
      '<div class="w-field"><span>' + t("Started") + '</span><span class="val">' + esc(dlabY(r.start)) + "</span></div>" +
      '<div class="w-field"><span>' + t("Ends") + '</span><span class="val">' + esc(ends) + "</span></div>" +
      (r.note ? '<div class="w-field"><span>' + t("Note") + '</span><span class="val rec-note">' + esc(r.note) + "</span></div>" : "") + "</div>" +
    '<div class="rec-sec"><span class="w-eyebrow">' + t("Next") + '</span><div class="w-next">' +
      (next.length ? next.map((d) => "<span>" + esc(dlabW(d)) + (d.slice(0, 4) !== TODAY.slice(0, 4) ? " " + d.slice(0, 4) : "") + "</span>").join("") : r.paused ? t("Paused, nothing scheduled") : t("No more charges")) + "</div></div>" +
    '<div class="rec-sec"><span class="w-eyebrow">' + t("History") + "</span>" + (h.length ? '<div class="cv" id="c-rhist"></div>' : "") + '<span class="rec-story">' + story + "</span></div>" +
    '<div class="rec-acts">' +
      (isOver ? "" : '<button type="button" class="w-btn ghost" data-act="pause">' + icon(r.paused ? "play" : "pause") + (r.paused ? t("Resume") : t("Pause")) + "</button>") +
      '<button type="button" class="w-btn ghost" data-act="edit">' + icon("edit") + t("Edit") + "</button>" +
      (isOver ? "" : '<button type="button" class="w-btn ghost" data-act="end">' + icon("cal") + t("End…") + "</button>") +
      '<button type="button" class="w-btn ghost danger" data-act="del">' + icon("trash") + t("Delete") + "</button></div>";

  if (h.length) historyChart(r, h.slice(-12), inc);
}

function historyChart(r, hv, inc) {
  chart("c-rhist", 66, (svg, w, hh) => {
    const vals = hv.map((x) => amt(x)), mx = Math.max(...vals, 1), bw = w / Math.max(hv.length, 6);
    hv.forEach((x, i) => {
      const v = vals[i], bh = Math.max(2, (v / mx) * (hh - 18)), x0 = bw * i + bw * 0.2, b = bw * 0.6;
      const rc = el("rect", { x: x0, y: hh - 14 - bh, width: b, height: bh, rx: 2, fill: cc(r.c), "fill-opacity": i === hv.length - 1 ? 1 : 0.45 }, svg);
      hover(rc, "<b>" + esc(dlabY(x.d)) + "</b>" + row(inc ? t("Received") : t("Paid"), m(v)));
      if (i % 2 === hv.length % 2 || hv.length <= 6) txt(svg, x0 + b / 2, hh - 2, F.mon[+x.d.slice(5, 7) - 1], "ax", "middle");
    });
  }, () => t("History of {name}: {n} charges, the last {amount} on {date}", { name: r.n, n: hv.length, amount: f(amt(hv[hv.length - 1])), date: dlabY(hv[hv.length - 1].d) }));
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
  for (const attr of ["data-act", "data-rid", "data-rd", "data-ended", "data-close"]) if (a.hasAttribute(attr)) return "[" + attr + (a.getAttribute(attr) ? '="' + a.getAttribute(attr) + '"' : "") + "]";
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
  if ((b = g("#rec-tab button"))) { ui.tab = b.dataset.v; render(); return; }
  if (g("#rec-new") || g("[data-new]")) { openAddSheet({ repeat: true }); return; }
  if ((b = g("[data-rid]"))) { select(b.dataset.rid); return; }
  if ((b = g("[data-sel]"))) {
    select(b.dataset.sel);
    // Beside the list, the rule can be out of sight: bring it in
    if (wide()) root.querySelector("#rec-insp").scrollIntoView({ block: "nearest", behavior: "smooth" });
    return;
  }
  if ((b = g("[data-rd]"))) { hideTip(); ui.day = ui.day === b.dataset.rd ? null : b.dataset.rd; render(); return; }
  if (g("[data-day-close]")) {
    const d = ui.day;
    ui.day = null; render();
    const c = root.querySelector('[data-rd="' + d + '"]'); if (c) c.focus();
    return;
  }
  if (g("[data-ended]")) { ui.endedOpen = !ui.endedOpen; render(); return; }
  if (g("[data-close]")) { closePanel(); return; }
  if ((b = g("[data-dis]"))) { dismiss(b.dataset.dis); render(); return; }
  if ((b = g("[data-mk]"))) { makeRule(b.dataset.mk); return; }
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

function makeRule(key) {
  const x = detectRules().find((z) => z.key === key);
  if (!x) return;
  openAddSheet({ repeat: true, name: x.n, amount: Math.round(x.avg * 100) / 100, category: x.c, person: x.p, date: x.next, type: x.type, every: x.every, freq: "monthly", about: x.varies });
}

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
    if (was) toast(nr.missed && nr.missed.length ? tn(nr.missed.length, "{name} resumed. {n} skipped date is in Wally noticed.", "{name} resumed. {n} skipped dates are in Wally noticed.", { name: r.n }) : t("{name} resumed", { name: r.n }), () => togglePause(nr, true));
    else toast(t("{name} paused. Nothing is added until you resume it.", { name: r.n }), () => togglePause(nr, true));
  } catch (e) { errorToast(e); if (quiet) throw e; }
}

function endRule(r) {
  const last = hist(r).filter((x) => x.rid === r.id).pop();
  const def = last && last.d > r.start ? (last.d > TODAY ? TODAY : last.d) : (r.start > TODAY ? r.start : TODAY);
  openDialog({
    title: t("End {name}?", { name: esc(r.n) }),
    body: "<p>" + t("What it already added stays. Nothing is added after this day.") + '</p><label class="rec-fld"><span>' + t("Last day") + '</span><div class="w-input"><input type="date" id="rec-end" value="' + def + '" min="' + r.start + '" required></div></label>',
    ok: t("End rule"),
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

function deleteRule(r) {
  const made = state.tx.filter((x) => x.rid === r.id);
  const total = made.reduce((s, x) => s + x.a, 0);
  const opts = made.length ? '<div class="w-opts" role="radiogroup" aria-label="' + esc(t("Past transactions")) + '">' +
    '<label><input type="radio" name="rec-del" value="future" checked><span><b>' + t("Keep past transactions") + "</b><small>" + tn(made.length, "The {n} transaction it added stays, as an ordinary one.", "The {n} transactions it added stay, as ordinary ones.") + "</small></span></label>" +
    '<label><input type="radio" name="rec-del" value="all"><span><b>' + t("Delete them too") + "</b><small>" + tn(made.length, "{n} transaction, {amount}, is deleted.", "{n} transactions, {amount} in all, are deleted.", { amount: m(total) }) + "</small></span></label></div>" : "";
  openDialog({
    title: t("Delete the rule for {name}?", { name: esc(r.n) }),
    body: "<p>" + t("Nothing more is added from it.") + "</p>" + opts,
    ok: t("Delete rule"),
    danger: true,
    onOk: async (dlg) => {
      const pick = dlg.querySelector('input[name="rec-del"]:checked');
      const applyTo = pick ? pick.value : "future";
      await DEL("/recurring/" + r.id, { applyTo });
      await Promise.all([reloadRules(), made.length ? reloadLedger() : null]);
      ui.sel = null; ui.open = false;
      history.replaceState(history.state, "", "/recurring");
      refresh({ rules: true });
      toast(applyTo === "all" && made.length ? tn(made.length, "Deleted {name} and its {n} transaction", "Deleted {name} and its {n} transactions", { name: r.n }) : t("Deleted the rule for {name}. Past transactions stay.", { name: r.n }));
    },
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
