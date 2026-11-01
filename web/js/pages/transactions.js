/* Transactions: search, filter and fix without leaving the list.
   The title is the period ("October ▾": a month, the year, everything or a custom range); search,
   Filter (type, categories, amount, shared), a ••• menu (calendar, Select, export), a calendar,
   Select mode for bulk changes, and a side panel with every field. */
import { $, state, t, tn, esc, f, f0, ym, ymAdd, ds, dim, addD, TODAY, on, amt, icon, rerank, isIncomeCat, monthYear, monthName, dlabW, pname, couple } from "../core.js";
import { hideTip, openDialog, empty, trapFocus } from "../ui.js";
import { headActions } from "../shell.js";
import { dayMap, schedMap, monthGrid, gridHover, noSpendText } from "../calendar.js";
import { S, RANGES, parseQ, withoutWords, txRange, txFiltered, onlyLabel, inLabel, fromQuery, toQuery, clearHay, lastDay, firstDay, filtering } from "./transactions/query.js";
import { TxList, buildItems } from "./transactions/list.js";
import { txPanel, dayPanel } from "./transactions/panel.js";
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
  const extra =
    '<button type="button" class="w-btn ghost tx-hb" data-act="filters" aria-haspopup="dialog" id="tx-fbtn">' + icon("filter") + '<span class="tx-hbl">' + esc(t("Filter")) + '</span><b id="tx-nf" hidden></b></button>' +
    '<button type="button" class="w-btn primary tx-hb" data-act="select" id="tx-done" hidden>' + esc(t("Done")) + "</button>" +
    '<div class="tx-morew"><button type="button" class="w-btn ghost tx-hb tx-more" data-menu="more" aria-haspopup="menu" aria-expanded="false" aria-label="' + esc(t("More")) + '">' + icon("more") + "</button>" +
      '<div class="w-menu" id="tx-more" role="menu" hidden></div></div>';
  return '<div class="tx-page">' +
    '<header class="w-head s-head tx-head">' +
      '<div class="s-titlew"><button type="button" class="s-title" data-menu="period" aria-haspopup="menu" aria-expanded="false"><span id="tx-title" aria-live="polite"></span>' + icon("down") + "</button>" +
        '<div class="w-menu s-pmenu" id="tx-pmenu" role="menu" aria-label="' + esc(t("Period")) + '" hidden></div></div>' +
      '<label class="w-search tx-search">' + icon("search") + '<input id="tx-q" type="search" enterkeyhint="search" autocomplete="off" spellcheck="false" placeholder="' + esc(ph) + '" aria-label="' + esc(t("Search transactions")) + '"><kbd aria-hidden="true">/</kbd></label>' +
      headActions(extra) +
    "</header>" +
    '<div id="tx-none" hidden></div>' +
    '<div class="tx-main" id="tx-main">' +
      '<div class="w-tools tx-tools" id="tx-tools">' +
        '<span class="tx-count" id="tx-count" role="status"></span>' +
        '<span id="tx-daychip" class="tx-daychip"></span>' +
        '<div class="w-views" id="tx-views"></div>' +
      "</div>" +
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
  $("tx-calp").hidden = !cal;
  $("tx-listp").hidden = cal;
  $("tx-body").classList.toggle("cal", cal);
  if (cal) renderCal(R, noDay);
  else { renderList(R, P, shown); renderBulk(shown); renderInsp(); }
  syncUrl();
}

function renderHead(R, P) {
  // This year's months need no year
  const sub = R.month && R.sub === TODAY.slice(0, 4) && !R.fromQuery ? "" : R.sub;
  $("tx-title").innerHTML = esc(R.title) + (sub ? " <span>" + esc(sub) + "</span>" : "");
  $("tx-title").parentNode.setAttribute("aria-label", t("Period: {range}", { range: $("tx-title").textContent }));
  // The period menu: recent months, then the year, everything and a custom range
  const [fy, fm] = ym(firstDay()), [ly, lm] = ym(lastDay()), months = [];
  for (let k = 0; k < 13; k++) { const q = ymAdd(ly, lm, -k); if (q[0] * 12 + q[1] < fy * 12 + fm) break; months.push(q); }
  const plain = !R.search && !R.fromQuery, now = +TODAY.slice(0, 4);
  const item = (v, label, on) => '<button type="button" role="menuitemradio" data-pm="' + v + '" aria-checked="' + !!on + '"><span>' + esc(label) + "</span></button>";
  $("tx-pmenu").innerHTML = item("year", t("{year} so far", { year: now }), plain && S.mode === "year") + item("all", t("All time"), plain && S.mode === "all") + item("custom", t("Custom range…"), plain && S.mode === "custom") +
    '<div class="w-menusep" role="separator"></div>' +
    months.map((q) => item(ds(q[0], q[1], 1).slice(0, 7), monthName(q[1]) + (q[0] !== now ? " " + q[0] : ""), plain && S.mode === "month" && S.ym[0] === q[0] && S.ym[1] === q[1])).join("");
  const q = $("tx-q");
  if (q.value !== S.q && document.activeElement !== q) q.value = S.q;
  // Filter shows how many are on; ••• holds the calendar, Select and export
  const nf = S.cats.size + (S.type !== "all") + (S.shared ? 1 : 0) + (P.min !== null || P.max !== null ? 1 : 0);
  const cal = S.view === "cal";
  $("tx-nf").hidden = !nf;
  $("tx-nf").textContent = nf;
  $("tx-fbtn").classList.toggle("on", nf > 0);
  $("tx-fbtn").hidden = S.selMode;
  $("tx-done").hidden = !S.selMode;
  $("tx-more").innerHTML =
    '<button type="button" role="menuitem" data-act="' + (cal ? "view-list" : "view-cal") + '">' + icon(cal ? "list" : "cal") + "<span>" + esc(cal ? t("Show as a list") : t("Show as a calendar")) + "</span></button>" +
    (cal ? "" : '<button type="button" role="menuitem" data-act="select">' + icon("check") + "<span>" + esc(S.selMode ? t("Done selecting") : t("Select")) + "</span></button>") +
    '<button type="button" role="menuitem" data-act="export"' + (cur.list.length ? "" : " disabled") + ">" + icon("download") + "<span>" + esc(t("Export as CSV")) + "</span></button>";
}

function renderTools(R, P, shown) {
  const cal = S.view === "cal";
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
  // One line instead of a chart: how many, what came in, what went out
  let inc = 0, out = 0;
  for (const x of shown) { if (x.type === "income") inc += amt(x); else out += amt(x); }
  const n = shown.length;
  $("tx-count").innerHTML = esc(state.scope === "all" ? tn(n, "{n} transaction", "{n} transactions") : tn(n, "{n} transaction for {name}", "{n} transactions for {name}", { name: pname(state.scope) })) +
    (n ? '<span class="tx-sumi">' + esc(t("In")) + ' <b class="pos amt">' + esc(f0(inc)) + '</b></span><span class="tx-sumi">' + esc(t("Out")) + ' <b class="amt">' + esc(f0(out)) + "</b></span>" : "");
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

/* ---------- actions ---------- */
function setQ(q, all) {
  const was = S.q.trim();
  S.q = q;
  if (!was || all) S.searchAll = true;
  S.sel = null; S.open = false;
  const inp = $("tx-q");
  if (inp) inp.value = q;
}
function showCal() {
  const R = txRange();
  S.ym = R.month || ym(R.b < TODAY ? R.b : TODAY); S.mode = "month"; S.calDay = S.day; S.day = null; S.selMode = false; S.picked = new Set();
  S.view = "cal"; S.open = false;
  render();
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
      case "filters": return openFilterSheet({ render, list: () => cur.list, setQ });
      case "view-cal": return showCal();
      case "view-list": S.view = "list"; S.open = false; return render();
      case "select": S.selMode = !S.selMode; S.picked = new Set(); S.open = false; lastPick = null; return render();
      case "export": return exportCsv(cur.list);
      case "only": S.searchAll = false; S.sel = null; return render();
      case "everym": S.searchAll = true; if (S.mode === "all") S.mode = "month"; S.sel = null; return render();
      case "save-view": return saveViewDialog();
      case "clear": setQ(""); S.cats = new Set(); S.type = "all"; S.shared = false; S.day = null; return render();
      case "dayx": S.day = null; return render();
      case "add": return openAdd();
      case "close": return closePanel();
      case "edit": return edit(x);
      case "dup": return duplicate(x);
      case "del": return remove(x);
      case "cal-open": S.view = "list"; S.day = S.calDay; S.sel = null; return render();
    }
    return;
  }
  const pm = tgt.closest("[data-pm]");
  if (pm) {
    const v = pm.dataset.pm;
    if (v === "custom") return setTimeout(() => openRangeSheet((o) => { Object.assign(S, o, { searchAll: false, day: null, sel: null, open: false }); if (S.mode !== "month") S.view = "list"; render(); }));
    if (v === "year" || v === "all") return setRange(v);
    S.mode = "month"; S.ym = [+v.slice(0, 4), +v.slice(5)]; S.searchAll = false; S.day = null; S.sel = null; S.open = false; S.calDay = null;
    return render();
  }
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
    if (closePanel()) return;
    if (S.selMode) { S.selMode = false; S.picked = new Set(); return render(); }
    if (S.day) { S.day = null; return render(); }
    return;
  }
  // ← → step months when nothing else uses them
  if ((k === "ArrowLeft" || k === "ArrowRight") && (blank || inList) && S.mode === "month" && !S.q.trim()) {
    ev.preventDefault();
    return step((k === "ArrowLeft") !== (document.documentElement.dir === "rtl") ? -1 : 1);
  }
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
