/* Budgets: a plan for the month that adjusts as it goes, and savings goals.
   Fixed bills are only checked, flexible categories get a monthly amount and a pace,
   once-a-year costs fill up month by month, and roll over carries last month's rest.
   Budgets are stored for the whole household; one person's view counts their share. */
import {
  state, t, tn, esc, f, f0, pct, bigMoney, dlab, dlabY, monthYear, TODAY, START, ds, dim, ym, ymAdd, addD, span,
  byCat, amt, tile, cc, rerank, expCats, isIncomeCat, icon, av, pname, couple, GET, PUT, POST, DEL, evalAmt,
} from "../core.js";
import { occurrences } from "../sched.js";
import { toast, errorToast, openDialog, closeDialog, confirmDialog } from "../ui.js";
import { refresh, scopeChips } from "../shell.js";

const KINDS = () => [["flexible", t("Flexible")], ["fixed", t("Fixed")], ["yearly", t("Once a year")]];
const ui = { y: 0, m: 0, loaded: false, error: "", hist: {}, doneOpen: false };
let root = null;

/* ---------- small helpers ---------- */
/* Amounts stay left to right inside right-to-left text */
const bdi = (html) => "<bdi>" + html + "</bdi>";
const m0 = (n) => bdi(esc(f0(n)));
const m = (n, sign) => bdi((sign || "") + esc(f(n)));
const sum = (list, fn) => list.reduce((s, x) => s + fn(x), 0);
/* A household amount for whoever is shown: one person counts an even share */
function share() { return state.scope === "all" ? 1 : 1 / Math.max(state.people.length, 1); }
function budgets() { return (state.budgets || []).map((b) => ({ c: b.category, a: Number(b.amount), kind: b.kind, roll: !!b.rollover })); }
function round10(v) { return v > 0 ? Math.max(10, Math.round(v / 10) * 10) : 0; }
/* The month on screen: its days, how far into it today is, and which day spending counts up to */
function monthInfo(y, mo) {
  const a = ds(y, mo, 1), D = dim(y, mo), end = ds(y, mo, D);
  const cur = a <= TODAY && TODAY <= end;
  const day = cur ? +TODAY.slice(8) : D;
  return { y, m: mo, a, end, D, cur, day, pace: day / D, daysLeft: cur ? D - day + 1 : 0, to: cur ? TODAY : end };
}
function canBack() { const [y, mo] = ymAdd(ui.y, ui.m, -1); return ds(y, mo, dim(y, mo)) >= START; }
function canForward() { return ds(ui.y, ui.m, 1) < TODAY.slice(0, 8) + "01"; }
function txLink(c, a, b) { return "/transactions?cat=" + encodeURIComponent(c) + "&mode=custom&from=" + a + "&to=" + b; }
function bar(ratio, color, tick) {
  return '<div class="w-budbar sm" aria-hidden="true"><span style="width:' + (Math.min(Math.max(ratio, 0), 1) * 100).toFixed(1) + "%;background:" + color + '"></span>' +
    (tick === null ? "" : '<i style="inset-inline-start:' + (tick * 100).toFixed(1) + '%"></i>') + "</div>";
}

/* ---------- the figures ---------- */
/* Everything the page shows for one month, for whoever is shown */
export function compute(y, mo) {
  const mi = monthInfo(y, mo), sc = state.scope, k = share();
  const spent = byCat(mi.a, mi.to, sc);
  const [py, pm] = ymAdd(y, mo, -1), pa = ds(py, pm, 1), pe = ds(py, pm, dim(py, pm));
  const prevSpent = pe >= START ? byCat(pa, pe, sc) : null;
  const list = budgets();
  const flex = list.filter((b) => b.kind === "flexible").map((b) => {
    const base = b.a * k;
    // Roll over: what was left last month, or what went over, moves into this one
    const carry = b.roll && prevSpent ? base - (prevSpent[b.c] || 0) : 0;
    const budget = base + carry, v = spent[b.c] || 0;
    return { c: b.c, base, carry, budget, v, left: budget - v, proj: mi.pace ? v / mi.pace : v, roll: b.roll };
  });
  const fixed = list.filter((b) => b.kind === "fixed").map((b) => ({ c: b.c, budget: b.a * k, v: spent[b.c] || 0 }));
  const yearStart = ds(y, 1, 1), yearSpent = list.some((b) => b.kind === "yearly") ? byCat(yearStart, mi.to, sc) : {};
  const doy = span(yearStart, mi.to), yearDays = span(yearStart, ds(y, 12, 31));
  const yearly = list.filter((b) => b.kind === "yearly").map((b) => ({ c: b.c, budget: b.a * k, v: yearSpent[b.c] || 0, tick: doy / yearDays }));
  const fb = sum(flex, (x) => x.budget), fs = sum(flex, (x) => x.v), proj = sum(flex, (x) => x.proj);
  const status = fs > fb ? "over" : mi.cur && proj > fb * 1.03 ? "watch" : "ok";
  return { mi, flex, fixed, yearly, fb, fs, left: fb - fs, perDay: mi.daysLeft ? (fb - fs) / mi.daysLeft : 0, proj, status };
}

/* What the household spent in each category over the last complete months: the suggestions */
export function suggestions() {
  const [cy, cm] = ym(TODAY);
  const first = TODAY.slice(0, 8) + "01";
  const [y12, m12] = ymAdd(cy, cm, -12), [y6, m6] = ymAdd(cy, cm, -6);
  const from12 = ds(y12, m12, 1), from6 = ds(y6, m6, 1);
  const startMonth = START > from6 ? START : from6;
  let n6 = 0;
  for (let [y, mo] = ym(startMonth); ds(y, mo, 1) < first; [y, mo] = ymAdd(y, mo, 1)) n6++;
  const out = {};
  for (const x of state.tx) {          // newest first
    if (x.d >= first) continue;
    if (x.d < from12) break;
    if (x.type !== "expense") continue;
    const v = amt(x, "all");
    if (!v) continue;
    const o = out[x.c] || (out[x.c] = { six: 0, rec6: 0, year: 0, months: new Set() });
    o.year += v;
    o.months.add(x.d.slice(0, 7));
    if (x.d >= from6) { o.six += v; if (x.rec) o.rec6 += v; }
  }
  Object.keys(out).forEach((c) => {
    const o = out[c];
    o.avg = n6 ? o.six / n6 : 0;
    // A guess at the kind: mostly rules is a fixed bill, a few big months is a once-a-year cost
    o.kind = o.six && o.rec6 / o.six >= 0.8 ? "fixed" : o.months.size <= 3 && o.year >= 300 ? "yearly" : "flexible";
    o.amount = { flexible: round10(o.avg), fixed: Math.round(o.avg), yearly: round10(o.year) };
  });
  return { n: n6, by: out };
}

/* ---------- page ---------- */
export function mount(el) {
  root = el;
  [ui.y, ui.m] = ym(TODAY);
  root.addEventListener("click", onClick);
  render();
  load();
}
export function unmount() { root = null; }
export function update() { if (root) render(); }
export function key(ev) {
  if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") {
    const back = (ev.key === "ArrowLeft") !== (document.documentElement.dir === "rtl");
    if (back ? canBack() : canForward()) { ev.preventDefault(); step(back ? -1 : 1); }
  }
}
async function load() {
  try {
    const [b, g] = await Promise.all([GET("/budgets"), GET("/goals")]);
    state.budgets = b; state.goals = g;
    ui.loaded = true; ui.error = "";
  } catch (e) { ui.error = e.message; ui.loaded = true; }
  render();
}
function step(k) { [ui.y, ui.m] = ymAdd(ui.y, ui.m, k); render(); }

function render() {
  if (!root) return;
  const has = budgets().length > 0;
  const mi = monthInfo(ui.y, ui.m);
  rerank(mi.a, mi.to);
  root.innerHTML =
    '<a class="w-plink bud-back" href="/" data-link>' + icon("left") + t("Dashboard") + "</a>" +
    '<header class="w-head bud-head"><div class="w-title"><h3>' + t("Budgets") + " <span>" + esc(monthYear(ui.y, ui.m)) + "</span></h3>" +
      '<div class="w-step"><button type="button" data-step="-1" aria-label="' + esc(t("Previous month")) + '"' + (canBack() ? "" : " disabled") + ">" + icon("left") + "</button>" +
      '<button type="button" data-step="1" aria-label="' + esc(t("Next month")) + '"' + (canForward() ? "" : " disabled") + ">" + icon("right") + "</button></div></div>" +
      (has ? '<div class="w-head-r"><button type="button" class="w-btn ghost" data-sugg>' + t("Use suggestions") + '</button><button type="button" class="w-btn ghost" data-edit>' + t("Edit budgets") + "</button></div>" : "") +
    "</header>" + scopeChips() +
    (!ui.loaded ? skeleton() : ui.error ? '<section class="w-panel">' + emptyBox("alert", t("Budgets could not be loaded"), esc(ui.error), '<button type="button" class="w-btn ghost" data-retry>' + t("Try again") + "</button>") + "</section>"
      : has ? budgetsHtml(compute(ui.y, ui.m)) : '<section class="w-panel">' + emptyBox("coin", t("No budgets yet"),
        t("Give each category an amount, and Wally shows what is left and how much you can spend each day. Fixed bills are only checked, and once-a-year costs fill up month by month."),
        '<button type="button" class="w-btn primary" data-edit>' + t("Set up budgets") + "</button>") + "</section>") +
    (ui.loaded && !ui.error && !has ? goalsHtml() : "");
}
function emptyBox(ic, title, body, action) {
  return '<div class="w-empty bud-empty"><span class="w-empty-i">' + icon(ic) + "</span><b>" + title + "</b><p>" + body + "</p>" + (action || "") + "</div>";
}
function skeleton() { return '<div class="w-skel" aria-busy="true"><i style="width:30%;height:14px"></i><i style="width:45%;height:40px"></i><i style="height:12px"></i></div>'; }

function budgetsHtml(B) {
  const mi = B.mi;
  return summary(B) +
    '<div class="w-grid2 bud-grid"><div class="bud-col">' + flexHtml(B) + fixedHtml(B) + "</div>" +
    '<div class="bud-col">' + yearlyHtml(B) + goalsHtml() +
      '<section class="w-panel"><div class="w-ph"><div><h4>' + t("How it works") + '</h4></div></div><ul class="w-howto">' +
        "<li>" + t("<b>Fixed</b> bills are known in advance. Wally only checks they were paid.") + "</li>" +
        "<li>" + t("<b>Flexible</b> categories get a monthly amount. The tick on each bar is where spending should be by today.") + "</li>" +
        "<li>" + t("<b>Once a year</b> costs, like travel, get a yearly amount and fill up month by month.") + "</li>" +
        "<li>" + t("<b>Roll over</b> moves what is left, or what went over, into next month.") + "</li>" +
        (state.scope !== "all" ? "<li>" + t("Showing {name}: each budget counts an even share, and shared costs count by share.", { name: esc(pname(state.scope)) }) + "</li>" : "") +
      "</ul></section></div></div>";
}

function summary(B) {
  if (!B.flex.length) return "";
  const mi = B.mi, label = { ok: t("On track"), watch: t("Watch"), over: t("Over") }[B.status];
  let line;
  if (!mi.cur) line = B.left >= 0 ? t("{month} ended {amount} under the flexible budget.", { month: esc(monthYear(mi.y, mi.m)), amount: m0(B.left) }) : t("{month} ended {amount} over the flexible budget.", { month: esc(monthYear(mi.y, mi.m)), amount: m0(-B.left) });
  else if (B.status === "over") line = t("Already {amount} over the flexible budget.", { amount: m0(B.fs - B.fb) });
  else if (B.status === "watch") {
    const pull = B.flex.filter((x) => x.proj > x.budget).sort((a, b) => (b.proj - b.budget) - (a.proj - a.budget)).slice(0, 2).map((x) => esc(x.c));
    line = t("At this pace it ends about {amount} over.", { amount: m0(B.proj - B.fb) }) + (pull.length === 2 ? " " + t("{a} and {b} are pulling it up.", { a: pull[0], b: pull[1] }) : pull.length ? " " + t("{a} is pulling it up.", { a: pull[0] }) : "");
  } else line = t("At this pace flexible spending ends the month about {amount} under budget.", { amount: m0(B.fb - B.proj) });
  const sub = mi.cur ? (B.left > 0 ? t("of {total}, {perDay} a day for {days}", { total: m0(B.fb), perDay: m0(B.perDay), days: tn(mi.daysLeft, "{n} day", "{n} days") }) : t("of {total}", { total: m0(B.fb) }))
    : t("of {total}, {spent} spent", { total: m0(B.fb), spent: m0(B.fs) });
  return '<section class="w-panel bud-sum"><div class="w-budsum"><div><span class="w-eyebrow">' + (mi.cur ? t("Flexible spending left") : t("Flexible spending left at the end of the month")) + "</span>" +
    '<div class="w-hnum"><span class="w-big">' + bdi(bigMoney(Math.max(B.left, 0))) + '</span><span class="w-delta"><span>' + sub + "</span></span></div></div>" +
    '<span class="w-spill ' + B.status + '">' + label + "</span></div>" +
    '<div class="w-budbar" role="img" aria-label="' + esc(t("{spent} of {total} spent", { spent: f0(B.fs), total: f0(B.fb) })) + '"><span style="width:' + (Math.min(B.fb > 0 ? B.fs / B.fb : 1, 1) * 100).toFixed(1) + '%"></span>' +
      (mi.cur ? '<i style="inset-inline-start:' + (mi.pace * 100).toFixed(1) + '%"></i>' : "") + "</div>" +
    '<p class="w-budp">' + line + "</p></section>";
}

function flexHtml(B) {
  if (!B.flex.length) return "";
  const mi = B.mi;
  const rows = B.flex.slice().sort((a, b) => b.v / Math.max(b.budget, 0.01) - a.v / Math.max(a.budget, 0.01)).map((x) => {
    const over = x.v > x.budget, ahead = mi.cur && !over && x.v > x.budget * mi.pace * 1.1;
    const notes = [t("{spent} of {budget}", { spent: m0(x.v), budget: m0(x.budget) })];
    if (x.carry) notes.push(t("{amount} rolled over", { amount: bdi((x.carry > 0 ? "+" : "−") + esc(f0(Math.abs(x.carry)))) }));
    if (mi.cur && !over && x.left > 0) notes.push(t("{amount} a day", { amount: m0(x.left / mi.daysLeft) }));
    if (ahead) notes.push(t("ahead of pace"));
    return '<a class="w-brow" href="' + txLink(x.c, mi.a, mi.end) + '" data-link>' + tile(x.c) + '<div><div class="w-brh"><b>' + esc(x.c) + '</b><span class="' + (over ? "up-bad" : "") + '">' +
      (over ? t("{amount} over", { amount: m0(x.v - x.budget) }) : t("{amount} left", { amount: m0(x.left) })) + "</span></div>" +
      bar(x.budget > 0 ? x.v / x.budget : 1, over ? "var(--w-bad)" : cc(x.c), mi.cur ? mi.pace : null) + "<p>" + notes.join(" · ") + "</p></div></a>";
  }).join("");
  return '<section class="w-panel"><div class="w-ph"><div><h4>' + t("Flexible") + "</h4><p>" + (mi.cur ? t("The tick is where spending should be by today") : t("What each category had, and what it spent")) +
    '</p></div><b class="num">' + m0(B.fs) + " / " + m0(B.fb) + "</b></div>" + rows + "</section>";
}

function fixedHtml(B) {
  if (!B.fixed.length) return "";
  const mi = B.mi;
  const due = mi.cur ? occurrences(addD(TODAY, 1), mi.end) : [];
  const rows = B.fixed.map((x) => {
    const paid = x.v >= x.budget * 0.95, over = x.v > x.budget * 1.05;
    const next = !paid && due.find((o) => o.r.c === x.c && o.r.type === "expense");
    const status = over ? t("{amount} more than planned", { amount: m0(x.v - x.budget) }) : paid ? t("Paid") : mi.cur ? t("{amount} still due", { amount: m0(x.budget - x.v) }) : t("{amount} not paid", { amount: m0(x.budget - x.v) });
    return '<div class="w-brow fixed">' + tile(x.c) + '<div><div class="w-brh"><b>' + esc(x.c) + '</b><span class="' + (over ? "up-bad" : paid ? "bud-paid" : "") + '">' + (paid && !over ? icon("check") : "") + status + "</span></div>" +
      "<p>" + t("{spent} of {budget}", { spent: m0(x.v), budget: m0(x.budget) }) + (next ? " · " + t("{name} due {date}", { name: esc(next.r.n), date: esc(dlab(next.d)) }) : "") + "</p></div></div>";
  }).join("");
  return '<section class="w-panel"><div class="w-ph"><div><h4>' + t("Fixed") + "</h4><p>" + t("Bills Wally expects every month") + "</p></div></div>" + rows + "</section>";
}

function yearlyHtml(B) {
  if (!B.yearly.length) return "";
  const y = B.mi.y;
  const rows = B.yearly.map((x) => {
    const over = x.v > x.budget;
    return '<div class="w-brow fixed">' + tile(x.c) + '<div><div class="w-brh"><b>' + esc(x.c) + '</b><span class="' + (over ? "up-bad" : "") + '">' +
      (over ? t("{amount} over for {year}", { amount: m0(x.v - x.budget), year: y }) : t("{amount} left for {year}", { amount: m0(x.budget - x.v), year: y })) + "</span></div>" +
      bar(x.budget > 0 ? x.v / x.budget : 1, over ? "var(--w-bad)" : cc(x.c), x.tick) +
      "<p>" + t("{spent} of {budget} this year. Set aside {monthly} a month.", { spent: m0(x.v), budget: m0(x.budget), monthly: m0(x.budget / 12) }) + "</p></div></div>";
  }).join("");
  return '<section class="w-panel"><div class="w-ph"><div><h4>' + t("Once a year") + "</h4><p>" + t("Filled month by month, spent when it happens") + "</p></div></div>" + rows + "</section>";
}

/* ---------- Edit budgets: every category, saved at once ---------- */
function openEditor() {
  const S = suggestions();
  const current = {};
  budgets().forEach((b) => { current[b.c] = b; });
  const cats = [...new Set(expCats().concat(Object.keys(current)))].filter((c) => current[c] || !isIncomeCat(c));
  const hint = (c, kind) => {
    const s = S.by[c];
    if (!s) return t("Nothing spent lately");
    return kind === "yearly" ? t("Last 12 months: {amount}", { amount: m0(s.year) }) : t("Usually {amount} a month", { amount: m0(s.avg) });
  };
  const rowHtml = (c) => {
    const b = current[c], kind = b ? b.kind : (S.by[c] && S.by[c].kind) || "flexible";
    return '<div class="bud-er" data-cat="' + esc(c) + '">' + tile(c, 28) + '<div class="bud-ern"><b>' + esc(c) + '</b><small data-hint>' + hint(c, kind) + "</small></div>" +
      '<select class="w-mini" data-kind aria-label="' + esc(t("Kind of budget for {name}", { name: c })) + '">' + KINDS().map(([v, l]) => '<option value="' + v + '"' + (v === kind ? " selected" : "") + ">" + l + "</option>").join("") + "</select>" +
      '<input class="w-mini bud-amt" data-amt inputmode="decimal" autocomplete="off" placeholder="' + esc(t("None")) + '" aria-label="' + esc(t("Amount for {name}", { name: c })) + '" value="' + (b ? esc(String(b.a)) : "") + '">' +
      '<label class="bud-roll"><input type="checkbox" data-roll' + (b && b.roll ? " checked" : "") + (kind !== "flexible" ? " disabled" : "") + ">" + t("Roll over") + "</label></div>";
  };
  openDialog({
    title: t("Edit budgets"),
    wide: true,
    body: "<p>" + t("Amounts are for the whole household. Once a year amounts are for the year. Leave an amount empty for no budget.") + "</p>" +
      (S.n ? '<button type="button" class="w-link bud-fill" data-fill>' + t("Fill in from the last {n} months", { n: S.n }) + "</button>" : "") +
      '<div class="bud-ed">' + (cats.length ? cats.map(rowHtml).join("") : '<p class="w-hint">' + t("Add a category in Settings first.") + "</p>") + "</div>",
    ok: t("Save budgets"),
    onOpen: (dlg) => {
      dlg.addEventListener("change", (ev) => {
        const sel = ev.target.closest("[data-kind]");
        if (!sel) return;
        const r = sel.closest(".bud-er"), roll = r.querySelector("[data-roll]");
        roll.disabled = sel.value !== "flexible";
        if (roll.disabled) roll.checked = false;
        r.querySelector("[data-hint]").textContent = hint(r.dataset.cat, sel.value);
      });
      const fill = dlg.querySelector("[data-fill]");
      if (fill) fill.addEventListener("click", () => {
        dlg.querySelectorAll(".bud-er").forEach((r) => {
          const s = S.by[r.dataset.cat];
          if (!s) return;
          const kind = r.querySelector("[data-kind]").value, v = s.amount[kind];
          if (v > 0) r.querySelector("[data-amt]").value = String(v);
        });
      });
      const first = dlg.querySelector("[data-amt]");
      if (first) first.focus();
    },
    onOk: async (dlg) => {
      const out = [];
      for (const r of dlg.querySelectorAll(".bud-er")) {
        const raw = r.querySelector("[data-amt]").value.trim();
        if (!raw) continue;
        const v = evalAmt(raw);
        if (v === null || !(v > 0)) { r.querySelector("[data-amt]").focus(); throw new Error(t("Check the amount for {name}.", { name: r.dataset.cat })); }
        const kind = r.querySelector("[data-kind]").value;
        out.push({ category: r.dataset.cat, amount: v.toFixed(2), kind, rollover: kind === "flexible" && r.querySelector("[data-roll]").checked });
      }
      await save(out, t("Budgets saved"));
    },
  });
}
function apiList() { return (state.budgets || []).map((b) => ({ category: b.category, amount: String(b.amount), kind: b.kind, rollover: !!b.rollover })); }
async function save(list, msg) {
  const before = apiList();
  state.budgets = await PUT("/budgets", list);
  refresh({ budgets: true });
  toast(msg, async () => { state.budgets = await PUT("/budgets", before); refresh({ budgets: true }); });
}
/* Use suggestions: flexible budgets become the average of the last months */
async function useSuggestions() {
  const S = suggestions();
  if (!S.n) { toast(t("There is not a full month of spending to learn from yet.")); return; }
  let changed = 0;
  const list = apiList().map((b) => {
    const s = S.by[b.category];
    if (b.kind !== "flexible" || !s || !s.amount.flexible || Number(b.amount) === s.amount.flexible) return b;
    changed++;
    return Object.assign({}, b, { amount: s.amount.flexible.toFixed(2) });
  });
  if (!changed) { toast(t("Your flexible budgets already match your spending.")); return; }
  try { await save(list, tn(S.n, "Flexible budgets set to your average of the last month", "Flexible budgets set to your average of the last {n} months")); } catch (e) { errorToast(e); }
}

/* ---------- savings goals ---------- */
function goalsShown() {
  return (state.goals || []).filter((g) => state.scope === "all" || g.person_id === null || String(g.person_id) === state.scope);
}
/* Months left to the due date, counting this one when the date is later this month */
function monthsLeft(due) {
  const [cy, cm] = ym(TODAY), [dy, dm] = ym(due);
  return Math.max(1, (dy * 12 + dm) - (cy * 12 + cm));
}
export function goalMath(g) {
  const target = Number(g.target), saved = Number(g.saved), left = Math.max(target - saved, 0);
  const reached = saved >= target - 0.005;
  const late = !!g.due && g.due < TODAY && !reached;
  const months = g.due && !late && !reached ? monthsLeft(g.due) : 0;
  return { target, saved, left, reached, late, months, perMonth: months ? left / months : 0, ratio: target > 0 ? saved / target : 0 };
}
function goalsHtml() {
  const goals = goalsShown(), open = goals.filter((g) => !g.done), done = goals.filter((g) => g.done);
  const body = goals.length ? '<div class="bud-glist">' + open.map(goalCard).join("") + "</div>" +
    (done.length ? '<button type="button" class="w-dayh bud-doneh" data-done-toggle aria-expanded="' + ui.doneOpen + '">' + t("Done") + "<span>" + done.length + icon("chev") + "</span></button>" +
      (ui.doneOpen ? '<div class="bud-dlist">' + done.map(doneRow).join("") + "</div>" : "") : "")
    : emptyBox("target", t("No savings goals yet"), t("Saving for a trip, a car or a rainy day? Set a target and a date, and Wally works out how much to put aside each month."),
      '<button type="button" class="w-btn primary" data-g-new>' + icon("plus") + t("New goal") + "</button>");
  return '<section class="w-panel bud-goals" aria-labelledby="bud-goals-h"><div class="w-ph"><div><h4 id="bud-goals-h">' + t("Savings goals") + "</h4><p>" + t("Money put aside for something bigger") + "</p></div>" +
    (goals.length ? '<button type="button" class="w-btn ghost" data-g-new>' + icon("plus") + t("New goal") + "</button>" : "") + "</div>" + body + "</section>";
}
function goalCard(g) {
  const x = goalMath(g), id = g.id;
  const meta = [];
  if (couple()) meta.push(g.person_id === null ? t("Household") : t("For {name}", { name: esc(pname(String(g.person_id))) }));
  if (g.due) meta.push(t("by {date}", { date: esc(dlabY(g.due)) }));
  let line;
  if (x.reached) line = '<span class="bud-gok">' + icon("check") + t("Reached. Mark it done when the money is spent or put to use.") + "</span>";
  else if (x.late) line = t("The date has passed. {amount} to go.", { amount: m0(x.left) });
  else if (g.due) line = t("{amount} a month to get there", { amount: "<b>" + m0(x.perMonth) + "</b>" }) + " · " + tn(x.months, "{n} month left", "{n} months left");
  else line = t("{amount} to go", { amount: m0(x.left) });
  const who = {};
  (g.entries || []).forEach((e) => { const k = e.person_id === null ? "" : String(e.person_id); who[k] = (who[k] || 0) + Number(e.amount); });
  const whoHtml = couple() && Object.keys(who).length ? '<div class="bud-gwho">' + Object.keys(who).sort((a, b) => who[b] - who[a]).map((k) =>
    '<span>' + av(k || null, "sm") + esc(k ? pname(k) : t("Someone")) + ' <b class="amt">' + m0(who[k]) + "</b></span>").join("") + "</div>" : "";
  const n = (g.entries || []).length, openHist = !!ui.hist[id];
  return '<article class="bud-goal" data-gid="' + id + '">' +
    '<header class="bud-gh"><span class="w-ico bud-gi">' + icon("target") + '</span><div class="bud-gt"><h5>' + esc(g.name) + "</h5>" + (meta.length ? "<p>" + meta.join(" · ") + "</p>" : "") + "</div>" +
      '<button type="button" class="w-x" data-g-edit aria-label="' + esc(t("Edit {name}", { name: g.name })) + '">' + icon("edit") + "</button></header>" +
    '<div class="bud-gnum"><span class="w-big sm">' + bdi(bigMoney(x.saved)) + '</span><span class="bud-gof">' + t("of {target}", { target: m0(x.target) }) + '</span><span class="w-pill' + (x.reached ? " good" : "") + '">' + esc(pct(Math.min(x.ratio, 9.99))) + "</span></div>" +
    '<div class="w-budbar sm" role="img" aria-label="' + esc(t("{saved} of {target} saved", { saved: f0(x.saved), target: f0(x.target) })) + '"><span style="width:' + (Math.min(x.ratio, 1) * 100).toFixed(1) + "%;background:" + (x.reached ? "var(--w-good)" : "var(--w-accent)") + '"></span></div>' +
    '<p class="bud-gline">' + line + "</p>" + whoHtml +
    '<div class="bud-gacts"><button type="button" class="w-btn ghost" data-g-add>' + icon("plus") + t("Add money") + "</button>" +
      (x.saved > 0 ? '<button type="button" class="w-btn ghost" data-g-out>' + icon("minus") + t("Take out") + "</button>" : "") +
      (x.reached ? '<button type="button" class="w-btn primary" data-g-done>' + icon("check") + t("Mark done") + "</button>" : "") +
      (n ? '<button type="button" class="w-link bud-ghb" data-g-hist aria-expanded="' + openHist + '">' + tn(n, "History ({n})", "History ({n})") + icon("chev") + "</button>" : "") + "</div>" +
    (openHist ? '<ul class="bud-ghist">' + g.entries.map((e) => '<li>' + (couple() ? av(e.person_id === null ? null : String(e.person_id), "sm") : "") + '<span class="bud-ghd">' + esc(dlabY(e.date)) +
      (couple() ? " · " + esc(e.person_id === null ? t("Someone") : pname(String(e.person_id))) : "") + '</span><b class="amt ' + (Number(e.amount) < 0 ? "" : "pos") + '">' + m(Number(e.amount), Number(e.amount) > 0 ? "+" : "") + "</b>" +
      '<button type="button" class="w-x" data-e-del="' + e.id + '" aria-label="' + esc(t("Delete the entry of {date}", { date: dlabY(e.date) })) + '">' + icon("trash") + "</button></li>").join("") + "</ul>" : "") +
    "</article>";
}
function doneRow(g) {
  const x = goalMath(g);
  return '<div class="bud-drow" data-gid="' + g.id + '"><span class="w-ico bud-gi done">' + icon("check") + '</span><div><b>' + esc(g.name) + "</b><small>" + t("{saved} of {target}", { saved: m0(x.saved), target: m0(x.target) }) + "</small></div>" +
    '<button type="button" class="w-btn ghost" data-g-undone>' + t("Not done") + '</button><button type="button" class="w-x" data-g-edit aria-label="' + esc(t("Edit {name}", { name: g.name })) + '">' + icon("edit") + "</button></div>";
}

function goalById(id) { return (state.goals || []).find((g) => String(g.id) === String(id)) || null; }
function putGoal(apiGoal) {
  const i = state.goals.findIndex((g) => g.id === apiGoal.id);
  if (i >= 0) state.goals[i] = apiGoal; else state.goals.push(apiGoal);
  refresh({ goals: true });
}
function goalBody(g) { return { name: g.name, target: Number(g.target).toFixed(2), due: g.due || null, person_id: g.person_id === undefined ? null : g.person_id }; }

function goalDialog(g) {
  const people = couple() ? '<label class="bud-fld"><span>' + t("For") + '</span><select class="w-mini" id="g-who"><option value="">' + t("Household") + "</option>" +
    state.people.map((p) => '<option value="' + p.id + '"' + (g && g.person_id === p.id ? " selected" : "") + ">" + esc(p.name) + "</option>").join("") + "</select></label>" : "";
  openDialog({
    title: g ? t("Edit goal") : t("New savings goal"),
    body: '<div class="bud-form"><label class="bud-fld"><span>' + t("Name") + '</span><div class="w-input"><input id="g-name" maxlength="60" autocomplete="off" placeholder="' + esc(t("A trip, a new car, a rainy day")) + '" value="' + (g ? esc(g.name) : "") + '"></div></label>' +
      '<label class="bud-fld"><span>' + t("Target") + '</span><div class="w-input"><input id="g-target" inputmode="decimal" autocomplete="off" value="' + (g ? esc(String(Number(g.target))) : "") + '"></div></label>' +
      '<label class="bud-fld"><span>' + t("By when") + ' <small>' + t("optional") + '</small></span><div class="w-input"><input id="g-due" type="date" value="' + (g && g.due ? g.due : "") + '"></div></label>' + people + "</div>" +
      (g ? '<div class="bud-gdel"><button type="button" class="w-btn ghost danger" data-g-del>' + icon("trash") + t("Delete goal") + "</button></div>" : ""),
    ok: g ? t("Save") : t("Create goal"),
    onOpen: (dlg) => {
      const del = dlg.querySelector("[data-g-del]");
      if (del) del.addEventListener("click", () => { closeDialog(); deleteGoal(g); });
    },
    onOk: async (dlg) => {
      const name = dlg.querySelector("#g-name").value.trim();
      const target = evalAmt(dlg.querySelector("#g-target").value);
      const due = dlg.querySelector("#g-due").value || null;
      const who = dlg.querySelector("#g-who");
      if (!name) { dlg.querySelector("#g-name").focus(); throw new Error(t("Give the goal a name.")); }
      if (target === null || !(target > 0)) { dlg.querySelector("#g-target").focus(); throw new Error(t("The target must be more than zero.")); }
      const body = { name, target: target.toFixed(2), due, person_id: who && who.value ? Number(who.value) : (who ? null : g ? g.person_id : null) };
      const out = g ? await PUT("/goals/" + g.id, body) : await POST("/goals", body);
      putGoal(out);
      toast(g ? t("Saved {name}", { name }) : t("Created {name}", { name }));
    },
  });
}

async function deleteGoal(g) {
  const n = (g.entries || []).length;
  const ok = await confirmDialog(t("Delete {name}?", { name: esc(g.name) }), n ? tn(n, "Its {n} entry is deleted too. This does not touch any transaction.", "Its {n} entries are deleted too. This does not touch any transaction.") : t("This does not touch any transaction."), t("Delete goal"), true);
  if (!ok) return;
  try {
    await DEL("/goals/" + g.id);
    state.goals = state.goals.filter((x) => x.id !== g.id);
    refresh({ goals: true });
    toast(t("Deleted {name}", { name: g.name }), async () => {
      // Undo: the goal and its entries again
      let out = await POST("/goals", goalBody(g));
      for (const e of (g.entries || []).slice().reverse()) out = await POST("/goals/" + out.id + "/entries", { date: e.date, amount: Number(e.amount).toFixed(2), person_id: e.person_id });
      if (g.done) out = await PUT("/goals/" + out.id + "?done=true", goalBody(g));
      putGoal(out);
    });
  } catch (e) { errorToast(e); }
}

function moneyDialog(g, out) {
  const x = goalMath(g);
  const who = couple() ? '<label class="bud-fld"><span>' + t("Who") + '</span><select class="w-mini" id="e-who">' +
    state.people.map((p) => '<option value="' + p.id + '"' + (String(p.id) === state.me ? " selected" : "") + ">" + esc(p.name) + "</option>").join("") + "</select></label>" : "";
  openDialog({
    title: out ? t("Take money out of {name}", { name: esc(g.name) }) : t("Add money to {name}", { name: esc(g.name) }),
    body: "<p>" + (out ? t("Saved so far: {amount}.", { amount: m(x.saved) }) : x.reached ? t("The target is reached.") : t("{amount} to go.", { amount: m(x.left) })) + "</p>" +
      '<div class="bud-form"><label class="bud-fld"><span>' + t("Amount") + '</span><div class="w-input"><input id="e-amt" inputmode="decimal" autocomplete="off" autofocus' +
      (!out && x.perMonth ? ' placeholder="' + esc(String(Math.ceil(x.perMonth))) + '"' : "") + "></div></label>" +
      '<label class="bud-fld"><span>' + t("Date") + '</span><div class="w-input"><input id="e-date" type="date" value="' + TODAY + '"></div></label>' + who + "</div>",
    ok: out ? t("Take out") : t("Add money"),
    onOk: async (dlg) => {
      const v = evalAmt(dlg.querySelector("#e-amt").value);
      const date = dlg.querySelector("#e-date").value;
      if (v === null || !(v > 0)) { dlg.querySelector("#e-amt").focus(); throw new Error(t("Enter an amount more than zero.")); }
      if (out && v > x.saved + 0.005) throw new Error(t("You can take out at most {amount}.", { amount: f(x.saved) }));
      if (!date) throw new Error(t("Choose a date."));
      const sel = dlg.querySelector("#e-who");
      const person_id = sel ? Number(sel.value) : state.me ? Number(state.me) : null;
      const before = new Set((g.entries || []).map((e) => e.id));
      const res = await POST("/goals/" + g.id + "/entries", { date, amount: (out ? -v : v).toFixed(2), person_id });
      putGoal(res);
      const added = (res.entries || []).find((e) => !before.has(e.id));
      const undo = added ? async () => putGoal(await DEL("/goals/" + g.id + "/entries/" + added.id)) : null;
      toast(out ? t("Took {amount} out of {name}", { amount: f(v), name: g.name }) : t("Added {amount} to {name}", { amount: f(v), name: g.name }), undo);
    },
  });
}

async function setDone(g, done) {
  try {
    putGoal(await PUT("/goals/" + g.id + "?done=" + done, goalBody(g)));
    toast(done ? t("{name} is done", { name: g.name }) : t("{name} is open again", { name: g.name }), async () => putGoal(await PUT("/goals/" + g.id + "?done=" + !done, goalBody(g))));
  } catch (e) { errorToast(e); }
}

async function deleteEntry(g, eid) {
  const e = (g.entries || []).find((x) => String(x.id) === String(eid));
  if (!e) return;
  try {
    putGoal(await DEL("/goals/" + g.id + "/entries/" + e.id));
    toast(t("Entry deleted"), async () => putGoal(await POST("/goals/" + g.id + "/entries", { date: e.date, amount: Number(e.amount).toFixed(2), person_id: e.person_id })));
  } catch (err) { errorToast(err); }
}

/* ---------- events ---------- */
function onClick(ev) {
  const g = (sel) => ev.target.closest(sel);
  let b;
  if ((b = g("[data-step]"))) { step(+b.dataset.step); return; }
  if (g("[data-edit]")) { openEditor(); return; }
  if (g("[data-sugg]")) { useSuggestions(); return; }
  if (g("[data-retry]")) { ui.loaded = false; render(); load(); return; }
  if (g("[data-g-new]")) { goalDialog(null); return; }
  if (g("[data-done-toggle]")) { ui.doneOpen = !ui.doneOpen; render(); return; }
  const card = g("[data-gid]");
  const goal = card && goalById(card.dataset.gid);
  if (!goal) return;
  if (g("[data-g-edit]")) goalDialog(goal);
  else if (g("[data-g-add]")) moneyDialog(goal, false);
  else if (g("[data-g-out]")) moneyDialog(goal, true);
  else if (g("[data-g-done]")) setDone(goal, true);
  else if (g("[data-g-undone]")) setDone(goal, false);
  else if (g("[data-g-hist]")) { ui.hist[goal.id] = !ui.hist[goal.id]; render(); const t2 = root.querySelector('[data-gid="' + goal.id + '"] [data-g-hist]'); if (t2) t2.focus(); }
  else if ((b = g("[data-e-del]"))) deleteEntry(goal, b.dataset.eDel);
}
