/* Transactions: search, filter and fix without leaving the list.
   A range (Month, 3 months, Year, 12 months, All or Custom), a search that looks in every month,
   filters, a calendar, Select mode for bulk changes, and a side panel with every field. */
import { $, state, t, tn, esc, f, ym, ymAdd, ds, dim, addD, TODAY, on, amt, icon, couple, rerank, isIncomeCat, monthYear, dlabL, dlabW, F, pname, cc } from "../core.js";
import { chart, el, txt, hover, row, hideTip, openDialog, seg, empty, trapFocus } from "../ui.js";
import { scopeSwitch } from "../shell.js";
import { dayMap, schedMap, monthGrid, gridHover, noSpendText } from "../calendar.js";
import { S, RANGES, parseQ, withoutWords, txRange, txFiltered, onlyLabel, inLabel, fromQuery, toQuery, clearHay, lastDay, firstDay, filtering } from "./transactions/query.js";
import { TxList, buildItems } from "./transactions/list.js";
import { txPanel, drawHist, dayPanel } from "./transactions/panel.js";
import { deleteTx, bulkDelete, bulkCategory, bulkPerson, exportCsv, views, saveView, deleteView } from "./transactions/actions.js";
import { openRangeSheet, openFilterSheet } from "./transactions/sheets.js";

let root = null;
let list = null;
let mounted = false;
let cur = { list: [], listNoDay: [], R: null, P: null };
let lastPick = null; // for shift-click ranges in Select mode
const MQ = { wide: matchMedia("(min-width: 1280px)"), phone: matchMedia("(max-width: 767px)") };
const layout = () => (MQ.wide.matches ? "wide" : MQ.phone.matches ? "phone" : "slide");
const openAdd = async (o) => (await import("../add.js")).openAdd(o);

/* "/" on this page: the shell asks for the search box */
on("focus-search", () => { if (mounted) focusSearch(); });

/* ---------- page contract ---------- */
export function mount(main, route) {
  root = main;
  mounted = true;
  fromQuery(route.query);
  main.innerHTML = skeleton();
  list = new TxList($("tx-list"));
  main.addEventListener("click", onClick);
  main.addEventListener("change", onChange);
  $("tx-q").addEventListener("input", onSearch);
  $("tx-q").addEventListener("keydown", onSearchKey);
  $("tx-insp").addEventListener("keydown", (ev) => { if (S.open && layout() !== "wide") trapFocus($("tx-insp"), ev); });
  document.addEventListener("click", closePopOutside);
  MQ.wide.addEventListener("change", render);
  MQ.phone.addEventListener("change", render);
  render();
  if (S.sel && route.query.get("id")) {
    requestAnimationFrame(() => {
      list.reveal(S.sel, false, true);
      const p = $("tx-listp");
      if (p) { p.classList.remove("tx-flash"); void p.offsetWidth; p.classList.add("tx-flash"); }
      if (layout() !== "wide") focusPanel();
    });
  }
  // The shell focuses the page once it is mounted; the search box takes it after that
  if (route.query.get("focus") === "search") setTimeout(focusSearch, 0);
}
export function unmount() {
  mounted = false;
  if (list) list.destroy();
  document.removeEventListener("click", closePopOutside);
  MQ.wide.removeEventListener("change", render);
  MQ.phone.removeEventListener("change", render);
  document.documentElement.classList.remove("tx-lock");
}
export function update(reason) {
  if (!mounted) return;
  reason = reason || {};
  clearHay();
  if (typeof reason.restored === "string") S.sel = reason.restored;
  render();
  if (typeof reason.restored === "string") list.reveal(reason.restored);
}

/* ---------- the page's frame, drawn once ---------- */
function skeleton() {
  const first = state.people[0];
  const ph = couple() && first ? t("Search, or try >50 @{name} #holiday food", { name: first.name.split(/\s+/)[0].toLocaleLowerCase() }) : t("Search, or try >50 #holiday food");
  return '<div class="tx-page">' +
    '<div class="w-mh tx-phead"><h3>' + esc(t("Transactions")) + '</h3><div id="tx-pchips"></div></div>' +
    '<div id="tx-none" hidden></div>' +
    '<div class="tx-main" id="tx-main">' +
      '<header class="w-head tx-head">' +
        '<div class="w-title"><h3 id="tx-title" aria-live="polite"></h3></div>' +
        '<div class="w-step tx-step" id="tx-step"><button type="button" data-act="prev" aria-label="' + esc(t("Previous month")) + '">' + icon("left") + '</button><button type="button" data-act="next" aria-label="' + esc(t("Next month")) + '">' + icon("right") + "</button></div>" +
        '<div id="tx-rangew" class="tx-rangew"></div>' +
        '<div class="w-head-r"><label class="w-search tx-search">' + icon("search") + '<input id="tx-q" type="search" enterkeyhint="search" autocomplete="off" spellcheck="false" placeholder="' + esc(ph) + '" aria-label="' + esc(t("Search transactions")) + '"><kbd aria-hidden="true">/</kbd></label></div>' +
      "</header>" +
      '<div class="tx-pbar" id="tx-pbar"></div>' +
      '<div class="w-tools tx-tools" id="tx-tools">' +
        '<div id="tx-vieww" class="tx-vieww"></div><div id="tx-typew" class="tx-desk"></div>' +
        '<div class="tx-catw tx-desk"><button type="button" class="w-chip" id="tx-catbtn" aria-haspopup="true" aria-expanded="false" aria-controls="tx-catpop">' + icon("tag") + '<span id="tx-catlbl"></span>' + icon("down") + "</button>" +
          '<div class="w-pop tx-pop" id="tx-catpop" hidden></div></div>' +
        (couple() ? '<button type="button" class="w-chip tx-desk" id="tx-shared" aria-pressed="false"><span class="w-av shared sm" aria-hidden="true"></span>' + esc(t("Shared only")) + "</button>" : "") +
        '<span id="tx-daychip" class="tx-daychip"></span>' +
        '<div class="w-views" id="tx-views"></div>' +
        '<span class="tx-count" id="tx-count" role="status"></span>' +
        '<button type="button" class="w-chip tx-desk" data-act="export" id="tx-export">' + icon("download") + esc(t("Export")) + "</button>" +
        '<button type="button" class="w-chip tx-desk" data-act="select" id="tx-selmode" aria-pressed="false"></button>' +
      "</div>" +
      '<section class="w-panel tx-stripp"><div class="w-strip"><div class="w-sum" id="tx-sum"></div><div class="cv" id="tx-strip"></div></div></section>' +
      '<div class="w-tx tx-body" id="tx-body">' +
        '<section class="w-panel tx-calp" id="tx-calp" hidden><div class="w-ph"><div><h4 id="tx-cal-h"></h4><p id="tx-cal-sub"></p></div><div class="w-legend">' +
          '<span><s style="background:var(--w-accent-soft);box-shadow:inset 0 0 0 1px var(--w-accent-line)"></s>' + esc(t("Today")) + '</span><span><s style="background:var(--w-good-soft)"></s>' + esc(t("Money in")) + '</span><span><s style="box-shadow:inset 0 0 0 1px var(--w-ink3)"></s>' + esc(t("Still to come")) + "</span>" +
          '</div></div><div class="w-rcal tx-cal" id="tx-cal" role="group" aria-label="' + esc(t("Calendar")) + '"></div></section>' +
        '<section class="w-panel tx-listp" id="tx-listp"><div class="w-txlist" id="tx-list" tabindex="-1" aria-label="' + esc(t("Transactions list")) + '"></div><div class="w-bulk" id="tx-bulk" hidden></div></section>' +
        '<aside class="w-panel w-insp tx-insp" id="tx-insp" aria-label="' + esc(t("Details")) + '"></aside>' +
      "</div>" +
    "</div></div>";
}

/* ---------- drawing ---------- */
let rankKey = "";
function render() {
  if (!mounted || !$("tx-main")) return;
  hideTip();
  $("tx-pchips").innerHTML = scopeSwitch();
  const none = !state.tx.length;
  $("tx-none").hidden = !none;
  $("tx-main").hidden = none;
  root.querySelector(".tx-page").classList.toggle("is-empty", none);
  if (none) {
    $("tx-none").innerHTML = '<section class="w-panel">' + empty("list", esc(t("No transactions yet")), esc(t("Add your first expense, or import a CSV from your bank in Settings.")),
      '<button type="button" class="w-btn primary" data-act="add">' + icon("plus") + esc(t("Add your first expense")) + "</button>") + "</section>";
    document.title = t("Transactions") + " · Wally";
    syncUrl();
    return;
  }
  const P = parseQ(S.q), R = txRange(P);
  const key = R.a + R.b + state.scope + state.tx.length + state.categories.length;
  if (key !== rankKey) { rerank(R.a, R.b); rankKey = key; }
  const shown = txFiltered(R, P), noDay = S.day ? txFiltered(R, P, true) : shown;
  cur = { P, R, list: shown, listNoDay: noDay };
  if (S.sel && !shown.some((x) => x.id === S.sel)) { S.sel = null; S.open = false; }
  if (!S.sel && shown.length) S.sel = shown[0].id;
  if (S.picked.size) { const ids = new Set(shown.map((x) => x.id)); S.picked = new Set([...S.picked].filter((id) => ids.has(id))); }
  const cal = S.view === "cal";
  if (cal) { S.selMode = false; S.picked.clear(); }

  renderHead(R, P);
  renderTools(R, P, shown);
  renderSum(shown);
  renderStrip(R, noDay);
  $("tx-calp").hidden = !cal;
  $("tx-listp").hidden = cal;
  $("tx-body").classList.toggle("cal", cal);
  if (cal) renderCal(R, noDay);
  else { renderList(R, P, shown); renderBulk(shown); renderInsp(); }
  syncUrl();
}

function renderHead(R, P) {
  $("tx-title").innerHTML = esc(R.title) + (R.sub ? " <span" + (R.month ? "" : ' class="sm"') + ">" + esc(R.sub) + "</span>" : "");
  const step = !!R.month && !R.fromQuery;
  $("tx-step").style.visibility = step ? "visible" : "hidden";
  const [fy, fm] = ym(firstDay()), [ly, lm] = ym(lastDay()), [y, m] = S.ym;
  root.querySelectorAll('[data-act="prev"]').forEach((b) => { b.disabled = !step || y * 12 + m <= fy * 12 + fm; });
  root.querySelectorAll('[data-act="next"]').forEach((b) => { b.disabled = !step || y * 12 + m >= ly * 12 + lm; });
  const cal = S.view === "cal";
  const items = [["month", t("Month")], ["year", t("Year")], ["all", t("All")]];
  if (S.mode === "custom" && !cal) items.push(["custom", t("Custom")]);
  const pressed = R.search || R.fromQuery ? "" : cal ? "month" : S.mode;
  $("tx-rangew").innerHTML = seg("tx-range", items.map(([k, l]) => [k, esc(l)]), pressed, t("Range"), "tx-range");
  $("tx-rangew").querySelectorAll("button").forEach((b, i) => { b.dataset.tr = b.dataset.v; if (i < 3) b.title = String(i + 1); });
  const q = $("tx-q");
  if (q.value !== S.q && document.activeElement !== q) q.value = S.q;
  // Phones: the range and the filters open as sheets
  const nf = S.cats.size + (S.type !== "all") + (S.shared ? 1 : 0) + (P.min !== null || P.max !== null ? 1 : 0);
  $("tx-pbar").innerHTML =
    '<button type="button" class="w-chip" data-act="range" aria-haspopup="dialog">' + icon("cal") + "<span>" + esc(R.title + (R.sub && R.month ? " " + R.sub : "")) + "</span>" + icon("down") + "</button>" +
    (step ? '<div class="w-step"><button type="button" data-act="prev" aria-label="' + esc(t("Previous month")) + '"' + (y * 12 + m <= fy * 12 + fm ? " disabled" : "") + ">" + icon("left") + '</button><button type="button" data-act="next" aria-label="' + esc(t("Next month")) + '"' + (y * 12 + m >= ly * 12 + lm ? " disabled" : "") + ">" + icon("right") + "</button></div>" : "") +
    '<button type="button" class="w-chip' + (nf ? " on" : "") + '" data-act="filters" aria-haspopup="dialog">' + icon("filter") + esc(t("Filters")) + (nf ? " <b>" + nf + "</b>" : "") + "</button>" +
    (cal ? "" : '<button type="button" class="w-chip' + (S.selMode ? " on" : "") + '" data-act="select" aria-pressed="' + S.selMode + '">' + esc(S.selMode ? t("Done") : t("Select")) + "</button>");
}

function renderTools(R, P, shown) {
  const cal = S.view === "cal";
  $("tx-vieww").innerHTML = seg("tx-view", [["list", esc(t("List"))], ["cal", esc(t("Calendar"))]], S.view, t("View"));
  $("tx-typew").innerHTML = seg("tx-type", [["all", esc(t("All"))], ["expense", esc(t("Expenses"))], ["income", esc(t("Income"))]], S.type, t("Type"));
  const ck = [...S.cats];
  $("tx-catlbl").textContent = !ck.length ? t("All categories") : ck.length === 1 ? ck[0] : tn(ck.length, "{n} category", "{n} categories");
  $("tx-catbtn").classList.toggle("on", ck.length > 0);
  if (!$("tx-catpop").hidden) drawCatPop();
  const sh = $("tx-shared");
  if (sh) { sh.classList.toggle("on", S.shared); sh.setAttribute("aria-pressed", String(S.shared)); }
  $("tx-daychip").innerHTML = S.day && !cal
    ? '<button type="button" class="w-chip on" data-act="dayx" aria-label="' + esc(t("Show every day, not only {day}", { day: dlabW(S.day) })) + '">' + icon("cal") + esc(dlabW(S.day)) + icon("x", "x") + "</button>" : "";
  // What the search found, and saved views
  let h = "";
  if (P.chips.length) {
    h += '<span class="w-parsed">' + esc(t("Showing")) + "</span>" + P.chips.map((c, i) => '<button type="button" class="w-chip on tx-qchip" data-chip="' + i + '" aria-label="' + esc(t("Remove {filter}", { filter: c.label })) + '">' + esc(c.label) + icon("x", "x") + "</button>").join("");
    if (!views().some((v) => v.query === S.q.trim())) h += '<button type="button" class="w-link tx-lk" data-act="save-view">' + esc(t("Save view")) + "</button>";
    if (!R.fromQuery && !cal && S.mode !== "all") {
      h += R.search
        ? '<span class="w-parsed">' + esc(t("in every month")) + '</span><button type="button" class="w-link tx-lk" data-act="only">' + esc(onlyLabel()) + "</button>"
        : '<span class="w-parsed">' + esc(inLabel()) + '</span><button type="button" class="w-link tx-lk" data-act="everym">' + esc(t("Search every month")) + "</button>";
    }
  } else if (views().length) {
    h += '<span class="w-parsed">' + esc(t("Views")) + "</span>" + views().map((v, i) =>
      '<span class="tx-view"><button type="button" class="w-chip" data-view="' + i + '">' + esc(v.name) + '</button><button type="button" class="tx-viewx" data-viewx="' + i + '" aria-label="' + esc(t("Delete the view {name}", { name: v.name })) + '">' + icon("x") + "</button></span>").join("");
  }
  $("tx-views").innerHTML = h;
  $("tx-views").hidden = !h;
  const n = shown.length;
  $("tx-count").textContent = state.scope === "all" ? tn(n, "{n} transaction", "{n} transactions") : tn(n, "{n} transaction for {name}", "{n} transactions for {name}", { name: pname(state.scope) });
  $("tx-export").hidden = cal;
  $("tx-export").disabled = !n;
  const sm = $("tx-selmode");
  sm.hidden = cal;
  sm.textContent = S.selMode ? t("Done") : t("Select");
  sm.classList.toggle("on", S.selMode);
  sm.setAttribute("aria-pressed", String(S.selMode));
}

function renderSum(shown) {
  let inc = 0, out = 0;
  for (const x of shown) { if (x.type === "income") inc += amt(x); else out += amt(x); }
  $("tx-sum").innerHTML = '<div><span>' + esc(t("In")) + '</span><b class="pos">' + f(inc) + "</b></div><div><span>" + esc(t("Out")) + "</span><b>" + f(out) + "</b></div><div><span>" + esc(t("Net")) + "</span><b>" + f(inc - out) + "</b></div>";
}

/* The strip: one bar a day in a month, one bar a month across months. Click a bar to narrow. */
function renderStrip(R, noDay) {
  if (R.month) {
    const [y, m] = R.month, D = dim(y, m), vals = new Array(D).fill(0);
    for (const x of noDay) if (x.type === "expense") vals[+x.d.slice(8) - 1] += amt(x);
    const pk = S.view === "cal" ? S.calDay : S.day;
    chart("tx-strip", 70, (svg, w, h) => {
      const sorted = vals.slice().sort((a, b) => a - b), cap = Math.max(sorted[Math.floor(D * 0.9)] * 1.25, 1), bw = w / D, mb = 16;
      for (let i = 0; i < D; i++) {
        const s = ds(y, m, i + 1), v = vals[i], x0 = bw * i + bw * 0.16, bwid = bw * 0.68;
        if (s > TODAY && !v) { el("rect", { x: x0, y: h - mb - 2, width: bwid, height: 2, rx: 1, fill: "var(--w-line)" }, svg); continue; }
        const hh = Math.max(2, (Math.min(v, cap) / cap) * (h - mb - 6)), lit = !pk || pk === s;
        const rc = el("rect", { x: x0, y: h - mb - hh, width: bwid, height: hh, rx: Math.min(3, bwid / 2), fill: lit ? "var(--w-accent)" : "var(--h3)", "fill-opacity": lit ? (pk ? 1 : 0.85) : 0.7, class: "tx-bar" }, svg);
        if (v > cap) el("path", { d: "M" + (x0 - 1) + " " + (h - mb - hh + 6) + "l" + (bwid + 2) + " -3", stroke: "var(--w-panel)", "stroke-width": 2 }, svg);
        hover(rc, "<b>" + esc(dlabL(s)) + "</b>" + row(esc(t("Spent")), f(v)) + (v > cap ? row(esc(t("Bar")), esc(t("cut to fit"))) : ""));
        rc.addEventListener("click", () => {
          hideTip();
          if (S.view === "cal") S.calDay = s; else { S.day = S.day === s ? null : s; S.sel = null; }
          render();
        });
        if (i === 0 || (i + 1) % 5 === 0) txt(svg, x0 + bwid / 2, h - 3, String(i + 1), "ax", "middle");
      }
    }, t("Spending each day in {month}, {total} in all", { month: monthYear(y, m), total: f(vals.reduce((a, b) => a + b, 0)) }));
    return;
  }
  // Months
  const months = [];
  let c = ym(R.a);
  const e = ym(R.b < lastDay() ? R.b : lastDay());
  while (c[0] * 12 + c[1] <= e[0] * 12 + e[1]) { months.push(c); c = ymAdd(c[0], c[1], 1); }
  const idx = {}, vals = months.map(() => 0);
  months.forEach((q, i) => { idx[q[0] + "-" + String(q[1]).padStart(2, "0")] = i; });
  for (const x of noDay) if (x.type === "expense") { const i = idx[x.d.slice(0, 7)]; if (i !== undefined) vals[i] += amt(x); }
  chart("tx-strip", 70, (svg, w, h) => {
    const mx = Math.max(...vals, 1), bw = w / months.length, mb = 16, every = months.length > 13 ? Math.max(3, Math.ceil(months.length / 12)) : 1;
    months.forEach((q, i) => {
      const v = vals[i], hh = Math.max(2, (v / mx) * (h - mb - 6)), b = Math.min(bw * 0.64, 28), x0 = bw * i + (bw - b) / 2; // few months: slim bars, centred
      const rc = el("rect", { x: x0, y: h - mb - hh, width: b, height: hh, rx: Math.min(3, b / 2), fill: "var(--w-accent)", "fill-opacity": 0.85, class: "tx-bar" }, svg);
      hover(rc, "<b>" + esc(monthYear(q[0], q[1])) + "</b>" + row(esc(t("Spent")), f(v)) + '<div class="tx-tiphint">' + esc(t("Click to open the month")) + "</div>");
      rc.addEventListener("click", () => { hideTip(); S.mode = "month"; S.ym = q; S.searchAll = false; S.day = null; S.sel = null; render(); });
      if (i % every === 0) txt(svg, x0 + b / 2, h - 3, F.mon[q[1] - 1] + (q[1] === 1 || i === 0 ? " " + String(q[0]).slice(2) : ""), "ax", "middle");
    });
  }, t("Spending each month, {total} in all", { total: f(vals.reduce((a, b) => a + b, 0)) }));
}

/* On phones a row is only marked while its detail is open; elsewhere the selection always shows */
/* Only the selected row is in the Tab order; ↑ ↓ move from there */
function rowOpts(x) {
  const tab = x.id === S.sel;
  return S.selMode ? { check: S.picked.has(x.id), tab } : { sel: tab && (S.open || layout() !== "phone"), tab };
}
function renderList(R, P, shown) {
  list.set(buildItems(shown, !R.month), rowOpts, emptyList(R, P));
}
function emptyList(R, P) {
  const add = '<button type="button" class="w-btn primary" data-act="add">' + icon("plus") + esc(t("Add expense")) + "</button>";
  const clear = '<button type="button" class="w-link" data-act="clear">' + esc(t("Clear filters")) + "</button>";
  if (P.chips.length) {
    const every = !R.search && !R.fromQuery && S.mode !== "all" ? '<button type="button" class="w-btn ghost" data-act="everym">' + esc(t("Search every month")) + "</button>" : "";
    return empty("search", esc(t("No transactions match “{q}”", { q: S.q.trim() })), esc(t("Search looks in names, categories, tags and amounts. Clear the filters to search everything.")), '<div class="tx-emptyb">' + every + clear + "</div>");
  }
  if (filtering()) return empty("filter", esc(t("No matches")), esc(t("Try another filter, or clear them.")), clear);
  const title = R.month ? t("Nothing in {month} yet", { month: monthYear(R.month[0], R.month[1]) }) : t("Nothing in this range yet");
  return empty("list", esc(title), esc(t("Add the first expense, or pick another range.")), add);
}

function renderBulk(shown) {
  const bar = $("tx-bulk");
  bar.hidden = !S.selMode;
  if (!S.selMode) return;
  const picked = shown.filter((x) => S.picked.has(x.id)), n = picked.length, dis = n ? "" : " disabled";
  const tot = picked.reduce((s, x) => s + (x.type === "income" ? -x.a : x.a), 0);
  const cats = state.categories.filter((c) => !isIncomeCat(c));
  bar.innerHTML = '<button type="button" class="w-link" id="bk-all">' + esc(n && n === shown.length ? t("Select none") : t("Select all {n}", { n: shown.length })) + "</button>" +
    '<span class="tx-bkn" role="status">' + esc(tn(n, "{n} selected", "{n} selected")) + (n ? " · " + f(Math.abs(tot)) : "") + '</span><span class="tx-grow"></span>' +
    '<select class="w-mini" id="bk-cat" aria-label="' + esc(t("Change category")) + '"' + dis + '><option value="">' + esc(t("Category…")) + "</option>" + cats.map((c) => '<option value="' + esc(c) + '">' + esc(c) + "</option>").join("") + "</select>" +
    (couple() ? '<select class="w-mini" id="bk-who" aria-label="' + esc(t("Change who")) + '"' + dis + '><option value="">' + esc(t("Who…")) + "</option>" + state.people.map((p) => '<option value="' + p.id + '">' + esc(p.name) + "</option>").join("") + '<option value="shared">' + esc(t("Shared evenly")) + "</option></select>" : "") +
    '<button type="button" class="w-btn ghost" id="bk-exp"' + dis + ">" + icon("download") + esc(t("Export")) + '</button><button type="button" class="w-btn ghost danger" id="bk-del"' + dis + ">" + icon("trash") + esc(t("Delete")) + "</button>";
}

function selected() { return S.sel ? cur.list.find((x) => x.id === S.sel) || null : null; }
function renderInsp() {
  const x = selected(), lay = layout(), box = $("tx-insp");
  const open = S.open && !!x && lay !== "wide";
  box.innerHTML = txPanel(x, lay === "phone");
  if (lay !== "phone") drawHist(x);
  $("tx-body").classList.toggle("open", open);
  box.setAttribute("role", open ? "dialog" : "complementary");
  if (open) box.setAttribute("aria-modal", "true"); else box.removeAttribute("aria-modal");
  document.documentElement.classList.toggle("tx-lock", open && lay === "phone");
}

/* The calendar: the shared month grid, bills still to come dashed, a day on the right */
function renderCal(R, noDay) {
  const [y, m] = R.month, mk = ds(y, m, 1).slice(0, 7);
  if (!S.calDay || S.calDay.slice(0, 7) !== mk) S.calDay = TODAY.slice(0, 7) === mk ? TODAY : noDay.length ? noDay[0].d : ds(y, m, 1);
  const by = dayMap(noDay);
  const sched = S.q.trim() ? {} : schedMap(y, m, (r, inc) => !((S.type !== "all" && (S.type === "income") !== inc) || (S.cats.size && !S.cats.has(r.c)) || (S.shared && r.p !== null)));
  const g = monthGrid(y, m, by, sched, S.calDay, "cd");
  $("tx-cal").innerHTML = g.html;
  gridHover($("tx-cal"), "cd", by, sched);
  $("tx-cal-h").textContent = monthYear(y, m);
  const fut = ds(y, m, dim(y, m)) > TODAY;
  $("tx-cal-sub").textContent = noSpendText(g.ns) + ". " + (fut ? t("Dashed days show bills still to come.") + " " : "") + (layout() === "wide" ? t("Pick a day to see it on the right.") : t("Pick a day to see it below."));
  $("tx-insp").innerHTML = dayPanel(S.calDay, noDay, sched, layout() === "wide");
  $("tx-insp").setAttribute("role", "complementary");
  $("tx-body").classList.remove("open");
  document.documentElement.classList.remove("tx-lock");
}

/* ---------- the category picker ---------- */
function drawCatPop() {
  const cats = state.categories.filter((c) => !isIncomeCat(c)).concat(state.categories.filter(isIncomeCat));
  $("tx-catpop").innerHTML = "<h6>" + esc(t("Categories")) + "</h6>" + cats.map((c, i) =>
    '<label><input type="checkbox" data-tc="' + esc(c) + '"' + (S.cats.has(c) ? " checked" : "") + '><span class="w-cdot" style="background:' + cc(c) + '"></span>' + esc(c) + "</label>").join("") +
    '<button type="button" class="w-btn ghost tx-popclear" data-act="cats-clear">' + esc(t("Clear")) + "</button>";
}
function toggleCatPop(show) {
  const pop = $("tx-catpop"), btn = $("tx-catbtn");
  if (!pop) return;
  show = show === undefined ? pop.hidden : show;
  if (show) drawCatPop();
  pop.hidden = !show;
  btn.setAttribute("aria-expanded", String(show));
  if (show) { const first = pop.querySelector("input"); if (first) first.focus(); }
}
function closePopOutside(ev) {
  const pop = $("tx-catpop");
  if (pop && !pop.hidden && !ev.target.closest("#tx-catpop") && !ev.target.closest("#tx-catbtn")) toggleCatPop(false);
}

/* ---------- actions ---------- */
function setQ(q, all) {
  const was = S.q.trim();
  S.q = q;
  if (!was || all) S.searchAll = true;
  S.sel = null; S.open = false;
  const inp = $("tx-q");
  if (inp) inp.value = q;
}
function setRange(mode) {
  const was = S.mode;
  S.mode = mode;
  if (mode === "month" && was !== "month") S.ym = ym(TODAY);
  S.searchAll = false; S.day = null; S.sel = null; S.open = false;
  if (mode !== "month") S.view = "list";
  render();
}
function step(k) {
  const [ny, nm] = ymAdd(S.ym[0], S.ym[1], k), [fy, fm] = ym(firstDay()), [ly, lm] = ym(lastDay());
  if (ny * 12 + nm < fy * 12 + fm || ny * 12 + nm > ly * 12 + lm) return;
  S.ym = [ny, nm]; S.mode = "month"; S.day = null; S.sel = null; S.open = false; S.calDay = null;
  render();
}
function focusSearch() { const q = $("tx-q"); if (q) { q.focus(); q.select(); } }
function focusPanel() { const b = $("tx-insp").querySelector('[data-act="close"]') || $("tx-insp").querySelector("button"); if (b) b.focus(); }
function closePanel() {
  if (!S.open) return false;
  S.open = false;
  renderInsp();
  if (S.sel) { list.redraw([S.sel]); list.reveal(S.sel, true); }
  return true;
}
function select(id, o) {
  o = o || {};
  const old = S.sel;
  S.sel = id;
  if (o.open) S.open = true;
  list.redraw([old, id]);
  list.reveal(id, o.focus);
  renderInsp();
  if (o.open && layout() !== "wide") focusPanel();
}
function move(dir) {
  const rows = list.rows;
  if (!rows.length || S.view !== "list") return;
  let i = rows.findIndex((x) => x.id === S.sel);
  i = i < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, i + dir));
  select(rows[i].id, { focus: true });
}
function edit(x) { if (x) openAdd({ tx: x }); }
function duplicate(x) {
  if (!x) return;
  openAdd({ date: TODAY, name: x.n, amount: x.a, category: x.c, person: x.p, type: x.type, tags: x.tags.slice(), note: x.note, shares: x.shc, by: x.by, duplicateOf: x.id });
}
function remove(x) {
  if (!x) return;
  // The next row takes the selection, so ⌫ ⌫ ⌫ works through a list
  const rows = list.rows, i = rows.findIndex((y) => y.id === x.id), next = rows[i + 1] || rows[i - 1];
  S.sel = next ? next.id : null;
  const hadFocus = $("tx-list").contains(document.activeElement);
  deleteTx(x).then(() => { if (hadFocus && S.sel && mounted) list.reveal(S.sel, true); });
}
function saveViewDialog() {
  const name = cur.P.chips.map((c) => c.label).join(", ");
  openDialog({
    title: esc(t("Save this view")),
    body: '<p>' + esc(t("Saved views appear under the search box, and in Filters on the phone.")) + '</p><div class="w-input"><input id="tx-vname" maxlength="40" aria-label="' + esc(t("Name")) + '" value="' + esc(name.charAt(0).toLocaleUpperCase() + name.slice(1)) + '"></div>',
    ok: esc(t("Save view")),
    async onOk(r) {
      const nm = r.querySelector("#tx-vname").value.trim();
      if (!nm) throw new Error(t("Give the view a name."));
      await saveView(nm, S.q.trim());
    },
  });
}

/* ---------- events ---------- */
function onClick(ev) {
  const tgt = ev.target;
  const act = tgt.closest("[data-act]");
  if (act && !act.disabled) {
    const a = act.dataset.act, x = selected();
    switch (a) {
      case "prev": return step(-1);
      case "next": return step(1);
      case "range": return openRangeSheet((o) => { Object.assign(S, o, { searchAll: false, day: null, sel: null, open: false }); if (S.mode !== "month") S.view = "list"; render(); });
      case "filters": return openFilterSheet({ render, list: () => cur.list, setQ });
      case "select": S.selMode = !S.selMode; S.picked = new Set(); S.open = false; lastPick = null; return render();
      case "export": return exportCsv(cur.list);
      case "only": S.searchAll = false; S.sel = null; return render();
      case "everym": S.searchAll = true; if (S.mode === "all") S.mode = "month"; S.sel = null; return render();
      case "save-view": return saveViewDialog();
      case "clear": setQ(""); S.cats = new Set(); S.type = "all"; S.shared = false; S.day = null; return render();
      case "dayx": S.day = null; return render();
      case "add": return openAdd();
      case "cats-clear": S.cats = new Set(); toggleCatPop(false); $("tx-catbtn").focus(); return render();
      case "close": return closePanel();
      case "edit": return edit(x);
      case "dup": return duplicate(x);
      case "del": return remove(x);
      case "cal-open": S.view = "list"; S.day = S.calDay; S.sel = null; return render();
    }
    return;
  }
  const tr = tgt.closest("[data-tr]");
  if (tr) return setRange(tr.dataset.tr);
  const v = tgt.closest("#tx-view [data-v]");
  if (v && v.dataset.v !== S.view) {
    if (v.dataset.v === "cal") { const R = txRange(); S.ym = R.month || ym(R.b < TODAY ? R.b : TODAY); S.mode = "month"; S.calDay = S.day; S.day = null; S.selMode = false; S.picked = new Set(); }
    S.view = v.dataset.v; S.open = false;
    return render();
  }
  const ty = tgt.closest("#tx-type [data-v]");
  if (ty) { S.type = ty.dataset.v; S.sel = null; return render(); }
  if (tgt.closest("#tx-catbtn")) return toggleCatPop();
  if (tgt.closest("#tx-shared")) { S.shared = !S.shared; S.sel = null; return render(); }
  const chip = tgt.closest("[data-chip]");
  if (chip) { const c = cur.P.chips[+chip.dataset.chip]; if (c) { setQ(withoutWords(S.q, c.idx)); render(); const next = $("tx-views").querySelector("[data-chip]") || $("tx-q"); next.focus(); } return; }
  const vw = tgt.closest("[data-view]");
  if (vw) { const view = views()[+vw.dataset.view]; if (view) { setQ(view.query, true); render(); } return; }
  const vx = tgt.closest("[data-viewx]");
  if (vx) return deleteView(+vx.dataset.viewx);
  const sib = tgt.closest("[data-sib]");
  if (sib) {
    const y = state.tx.find((z) => z.id === sib.dataset.sib);
    if (y && !cur.list.some((z) => z.id === y.id)) { S.mode = "month"; S.ym = ym(y.d); S.day = null; S.searchAll = false; setQ(""); S.cats = new Set(); S.type = "all"; S.shared = false; S.sel = y.id; render(); }
    if (y) select(y.id, { open: S.open });
    return;
  }
  const cd = tgt.closest("[data-cd]");
  if (cd) { hideTip(); S.calDay = cd.dataset.cd; render(); const b = $("tx-cal").querySelector('[data-cd="' + S.calDay + '"]'); if (b) b.focus(); return; }
  if (tgt.closest("#bk-all")) {
    if (S.picked.size === cur.list.length) S.picked = new Set(); else S.picked = new Set(cur.list.map((x) => x.id));
    renderList(cur.R, cur.P, cur.list); renderBulk(cur.list); return;
  }
  if (tgt.closest("#bk-exp")) return exportCsv(cur.list.filter((x) => S.picked.has(x.id)));
  if (tgt.closest("#bk-del")) { bulkDelete(cur.list.filter((x) => S.picked.has(x.id))).then((ok) => { if (ok) { S.picked = new Set(); renderBulk(cur.list); } }); return; }
  const r = tgt.closest("[data-id]");
  if (r) {
    const id = r.dataset.id;
    if (r.closest("#tx-insp")) { // a row in the calendar's day panel: open it in the list
      S.view = "list"; S.day = S.calDay; S.sel = id; S.open = layout() !== "wide"; render(); list.reveal(id, layout() === "wide"); if (S.open) focusPanel(); return;
    }
    if (S.selMode) {
      const rows = list.rows;
      if (ev.shiftKey && lastPick) {
        const a = rows.findIndex((x) => x.id === lastPick), b = rows.findIndex((x) => x.id === id), on = !S.picked.has(id);
        rows.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((x) => (on ? S.picked.add(x.id) : S.picked.delete(x.id)));
        list.redraw(rows.slice(Math.min(a, b), Math.max(a, b) + 1).map((x) => x.id));
      } else { if (S.picked.has(id)) S.picked.delete(id); else S.picked.add(id); list.redraw([id]); }
      lastPick = id;
      renderBulk(cur.list);
      return;
    }
    // A click selects; on narrower screens it also opens the panel. Enter (a click with no pointer) opens it everywhere.
    const keyboard = ev.detail === 0;
    select(id, { open: layout() !== "wide" || keyboard });
    if (keyboard && layout() === "wide") { const b = $("tx-insp").querySelector('[data-act="edit"]'); if (b) b.focus(); }
  }
}
function onChange(ev) {
  const tgt = ev.target;
  if (tgt.dataset.tc !== undefined) {
    if (tgt.checked) S.cats.add(tgt.dataset.tc); else S.cats.delete(tgt.dataset.tc);
    S.sel = null;
    render();
    return;
  }
  if (tgt.id === "bk-cat" && tgt.value) return bulkCategory(cur.list.filter((x) => S.picked.has(x.id)), tgt.value);
  if (tgt.id === "bk-who" && tgt.value) return bulkPerson(cur.list.filter((x) => S.picked.has(x.id)), tgt.value);
}
let searchFrame = 0;
function onSearch(ev) {
  setQ(ev.target.value);
  cancelAnimationFrame(searchFrame);
  searchFrame = requestAnimationFrame(render);
}
function onSearchKey(ev) {
  if (ev.key === "Escape") {
    ev.stopPropagation();
    if (ev.target.value) { setQ(""); render(); } else ev.target.blur();
  } else if (ev.key === "ArrowDown" || ev.key === "Enter") {
    if (ev.key === "Enter") ev.preventDefault();
    if (cur.list.length && S.view === "list") { ev.preventDefault(); select(S.sel || cur.list[0].id, { focus: true }); }
  }
}

/* Page keys (the shell leaves out typing, overlays and modifier keys) */
export function key(ev) {
  const k = ev.key, a = document.activeElement;
  const inList = a && $("tx-list") && $("tx-list").contains(a);
  const blank = !a || a === document.body || a === root;
  const neutral = blank || inList || (a.closest && a.closest("#tx-insp"));
  if (/^[1-3]$/.test(k)) { ev.preventDefault(); return setRange(RANGES[+k - 1]); }
  if (k === "Escape") {
    if (!$("tx-catpop").hidden) { toggleCatPop(false); $("tx-catbtn").focus(); return; }
    if (closePanel()) return;
    if (S.selMode) { S.selMode = false; S.picked = new Set(); return render(); }
    if (S.day) { S.day = null; return render(); }
    return;
  }
  if (a && a.closest && a.closest("#tx-catpop")) return;
  // The calendar: arrows move the day
  if (a && a.closest && a.closest("#tx-cal") && /^Arrow/.test(k)) {
    ev.preventDefault();
    const d = addD(S.calDay, { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[k] * (document.dir === "rtl" && /Left|Right/.test(k) ? -1 : 1));
    if (d.slice(0, 7) !== S.calDay.slice(0, 7)) return;
    S.calDay = d; render();
    const b = $("tx-cal").querySelector('[data-cd="' + d + '"]'); if (b) b.focus();
    return;
  }
  if (S.view !== "list") return;
  if ((k === "ArrowDown" || k === "ArrowUp") && neutral) { ev.preventDefault(); return move(k === "ArrowDown" ? 1 : -1); }
  const x = selected();
  if (!x) return;
  if ((k === "e" || k === "E") && !S.selMode) { ev.preventDefault(); return edit(x); }
  if ((k === "d" || k === "D") && !S.selMode) { ev.preventDefault(); return duplicate(x); }
  if ((k === "Backspace" || k === "Delete") && (neutral || a.closest("#tx-bulk"))) {
    ev.preventDefault();
    if (S.selMode) { if (S.picked.size) bulkDelete(cur.list.filter((y) => S.picked.has(y.id))).then((ok) => { if (ok) { S.picked = new Set(); renderBulk(cur.list); } }); return; }
    return remove(x);
  }
  if (k === "Enter" && blank) { ev.preventDefault(); select(x.id, { open: true }); }
  if (k === "Enter" && a === $("tx-list")) { ev.preventDefault(); select(x.id, { open: true, focus: layout() === "wide" }); }
}

/* Keep the address in step with what is shown, so it can be shared, kept or reloaded */
function syncUrl() {
  if (location.pathname !== "/transactions") return;
  const u = toQuery();
  if (location.pathname + location.search !== u) history.replaceState(history.state, "", u);
}
