/* Transactions: search, filter and fix without leaving the list.
   The title is the period ("October ▾": a month, a year, everything or a custom range) with ‹ › to step
   through it; a List | Calendar switch; search with a scope bar and recent searches; Filter (a popover
   on wide screens, a sheet on phones); a ••• menu (Select, export); Select mode for bulk changes, and a
   side panel with every field. */
import { $, state, t, tn, esc, f, f0, ym, ymAdd, ds, addD, TODAY, on, amt, icon, rerank, isIncomeCat, monthYear, dlabW, pname, person, couple } from "../core.js";
import { hideTip, empty, trapFocus, stepLabels } from "../ui.js";
import { headActions, scopeSwitch } from "../shell.js";
import { dayMap, schedMap, monthGrid, gridHover, noSpendText } from "../calendar.js";
import { S, RANGES, parseQ, txRange, txFiltered, scopeLabel, fromQuery, toQuery, clearHay, lastDay, firstDay, filtering, recent, addRecent, clearRecent, bySize } from "./transactions/query.js";
import { TxList, buildItems } from "./transactions/list.js";
import { txPanel, dayPanel } from "./transactions/panel.js";
import { deleteTx, bulkDelete, bulkCategory, bulkPerson, exportCsv } from "./transactions/actions.js";
import { openRangeSheet, openFilter, closeFilter, filterCount } from "./transactions/sheets.js";

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
  if (S.who) state.scope = S.who;
  main.innerHTML = skeleton();
  list = new TxList($("tx-list"));
  main.addEventListener("click", onClick);
  main.addEventListener("change", onChange);
  $("tx-q").addEventListener("input", onSearch);
  $("tx-q").addEventListener("keydown", onSearchKey);
  $("tx-q").addEventListener("focus", onSearchFocus);
  $("tx-q").addEventListener("blur", onSearchBlur);
  $("tx-q").addEventListener("scroll", syncMirror);
  document.addEventListener("pointerdown", onOutside, true);
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
/* The person the address picked is shown on this page only: elsewhere, the person switch's own choice */
function savedScope() {
  let sc = "all";
  try { sc = localStorage.getItem("wally.scope") || "all"; } catch (e) { /* fine */ }
  return sc === "all" || person(sc) ? sc : "all";
}
/* Show one person's money here (or everyone's); null, or the switch's own choice, goes back to it */
function setWho(k) {
  const saved = savedScope();
  S.who = k && k !== saved ? k : null;
  state.scope = S.who || saved;
  document.querySelectorAll(".w-pswitch").forEach((w) => { w.outerHTML = scopeSwitch(); });
}
export function unmount() {
  mounted = false;
  if (S.who) { S.who = null; state.scope = savedScope(); }
  if (list) list.destroy();
  closeFilter();
  document.removeEventListener("pointerdown", onOutside, true);
  MQ.wide.removeEventListener("change", render);
  MQ.phone.removeEventListener("change", render);
  document.documentElement.classList.remove("tx-lock");
}
export function update(reason) {
  if (!mounted) return;
  reason = reason || {};
  clearHay();
  // The person switch was used: its choice now holds here too, and the address stops naming one
  if (reason.scope) S.who = null;
  if (typeof reason.restored === "string") S.sel = reason.restored;
  render();
  if (typeof reason.restored === "string") list.reveal(reason.restored);
}

/* ---------- the page's frame, drawn once ----------
   Wide screens: title ‹ › … List | Calendar, Search, Filter, •••, person, Add.
   Phones: title ‹ › person, then Search, Filter, List | Calendar, •••; while searching, Search and Cancel. */
function skeleton() {
  const extra =
    '<div class="w-seg tx-vsw" id="tx-vsw" role="group" aria-label="' + esc(t("View")) + '">' +
      '<button type="button" data-view="list" aria-pressed="true" aria-label="' + esc(t("List")) + '" title="' + esc(t("List")) + '">' + icon("list") + "</button>" +
      '<button type="button" data-view="cal" aria-pressed="false" aria-label="' + esc(t("Calendar")) + '" title="' + esc(t("Calendar")) + '">' + icon("cal") + "</button></div>" +
    '<div class="tx-searchw" id="tx-searchw"><label class="w-search tx-search" id="tx-sbox">' + icon("search") +
      '<span class="tx-field"><span class="tx-mirror" id="tx-mirror" aria-hidden="true"></span><input id="tx-q" type="search" enterkeyhint="search" autocomplete="off" spellcheck="false" placeholder="' + esc(t("Search")) + '" aria-label="' + esc(t("Search transactions")) + '" title="' + esc(t("Search")) + ' (/)"></span>' +
      '<button type="button" class="tx-qx" data-act="qx" aria-label="' + esc(t("Clear search")) + '" hidden>' + icon("x") + "</button></label>" +
      '<div class="tx-recent" id="tx-recent" hidden></div></div>' +
    '<button type="button" class="tx-cancel" data-act="cancel" hidden>' + esc(t("Cancel")) + "</button>" +
    '<div class="tx-fw"><button type="button" class="w-btn ghost tx-hb" data-act="filters" aria-haspopup="dialog" aria-expanded="false" id="tx-fbtn">' + icon("filter") + '<span class="tx-hbl" id="tx-fl">' + esc(t("Filter")) + "</span></button>" +
      '<div class="tx-fpop" id="tx-fpop" role="dialog" aria-label="' + esc(t("Filter")) + '" hidden></div></div>' +
    '<button type="button" class="w-btn primary tx-hb" data-act="select" id="tx-done" hidden>' + esc(t("Done")) + "</button>" +
    '<div class="tx-morew"><button type="button" class="w-btn ghost tx-hb tx-more" data-menu="more" aria-haspopup="menu" aria-expanded="false" aria-label="' + esc(t("More")) + '">' + icon("more") + "</button>" +
      '<div class="w-menu" id="tx-more" role="menu" hidden></div></div>';
  return '<div class="tx-page">' +
    '<header class="w-head s-head tx-head" id="tx-head">' +
      '<div class="s-titlew"><button type="button" class="s-title" data-menu="period" aria-haspopup="menu" aria-expanded="false"><span id="tx-title" aria-live="polite"></span>' + icon("down") + "</button>" +
        '<div class="w-menu s-pmenu" id="tx-pmenu" role="menu" aria-label="' + esc(t("Period")) + '" hidden></div></div>' +
      '<div class="tx-step w-steps" id="tx-step"><button type="button" data-act="prev">' + icon("left") + '</button><button type="button" data-act="next">' + icon("right") + "</button></div>" +
      '<span class="tx-brk" aria-hidden="true"></span>' +
      headActions(extra) +
    "</header>" +
    '<div id="tx-none" hidden></div>' +
      '<div class="tx-qrec" id="tx-qrec" hidden></div>' +
    '<div class="tx-main" id="tx-main">' +
      '<div class="w-tools tx-tools" id="tx-tools">' +
        '<div class="w-seg tx-scope" id="tx-scope" role="group" aria-label="' + esc(t("Search in")) + '" hidden></div>' +
        '<span class="tx-count" id="tx-count" role="status"></span>' +
        '<span id="tx-daychip" class="tx-daychip"></span>' +
      "</div>" +
      '<div class="w-tx tx-body" id="tx-body">' +
        '<section class="w-panel tx-calp" id="tx-calp" hidden><div class="tx-calh"><h4 id="tx-cal-h"></h4><div class="w-legend tx-leg">' +
          '<span><s class="lt"></s>' + esc(t("Today")) + '</span><span><s class="li"></s>' + esc(t("Money in")) + '</span><span><s class="lf"></s>' + esc(t("Still to come")) + "</span>" +
          '</div></div><div class="w-rcal tx-cal" id="tx-cal" role="group" aria-label="' + esc(t("Calendar")) + '"></div>' +
          '<div class="tx-calleg tx-leg" aria-hidden="true"><span><s class="lt"></s>' + esc(t("Today")) + '</span><span><s class="li"></s>' + esc(t("Money in")) + '</span><span><s class="lf"></s>' + esc(t("Still to come")) + "</span></div></section>" +
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
    // Nothing to step through, search or filter yet: the page is just titled, with Add
    $("tx-title").textContent = t("Transactions");
    $("tx-title").parentNode.removeAttribute("aria-label");
    document.title = t("Transactions") + " · Wally";
    syncUrl();
    return;
  }
  const P = parseQ(S.q), R = txRange(P);
  const key = R.a + R.b + state.scope + state.tx.length + state.categories.length;
  if (key !== rankKey) { rerank(R.a, R.b); rankKey = key; }
  const cal = S.view === "cal";
  let shown = txFiltered(R, P);
  const noDay = S.day ? txFiltered(R, P, true) : shown;
  if (S.sort === "amount" && !cal) shown = bySize(shown);
  cur = { P, R, list: shown, listNoDay: noDay };
  if (S.sel && !shown.some((x) => x.id === S.sel)) { S.sel = null; S.open = false; }
  if (!S.sel && shown.length) S.sel = shown[0].id;
  if (S.picked.size) { const ids = new Set(shown.map((x) => x.id)); S.picked = new Set([...S.picked].filter((id) => ids.has(id))); }
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
  // The title names the period picked, even while a search looks in every month
  const T = R.search ? txRange(P, true) : R;
  const sub = T.month && T.sub === TODAY.slice(0, 4) && !T.fromQuery ? "" : T.sub;
  $("tx-title").innerHTML = esc(T.title) + (sub ? " <span>" + esc(sub) + "</span>" : "");
  $("tx-title").parentNode.setAttribute("aria-label", t("Period: {range}", { range: $("tx-title").textContent }));
  $("tx-title").parentNode.classList.toggle("tx-long", !!$("tx-title").querySelector("span") || $("tx-title").textContent.length > 12);
  // Five shortcuts; ‹ › step through the rest
  const [ty, tm] = ym(TODAY), last = ymAdd(ty, tm, -1), plain = !R.fromQuery;
  const isM = (q) => S.mode === "month" && S.ym[0] === q[0] && S.ym[1] === q[1];
  const item = (v, label, on) => '<button type="button" role="menuitemradio" data-pm="' + v + '" aria-checked="' + !!on + '"><span>' + esc(label) + "</span></button>";
  $("tx-pmenu").innerHTML = item("this", t("This month"), plain && isM([ty, tm])) + item("last", t("Last month"), plain && isM(last)) +
    item("year", t("This year"), plain && S.mode === "year" && S.y === ty) + item("all", t("All time"), plain && S.mode === "all") +
    '<div class="w-menusep" role="separator"></div>' + item("custom", t("Custom range…"), plain && S.mode === "custom");
  const cal = S.view === "cal", st = stepOk();
  const [pb, nb] = $("tx-step").querySelectorAll("button");
  pb.disabled = !st.prev; nb.disabled = !st.next;
  stepLabels($("tx-step"), S.mode === "year");
  $("tx-step").hidden = R.fromQuery;
  $("tx-vsw").querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.view === "cal") === cal)));
  $("tx-vsw").hidden = S.selMode;
  // Search: filter words show as tokens, × clears; on phones Cancel replaces the buttons while searching
  const q = $("tx-q");
  if (q.value !== S.q && document.activeElement !== q) q.value = S.q;
  syncMirror();
  $("tx-head").querySelector(".tx-qx").hidden = !q.value;
  searchState();
  // Filter says how many are on; ••• holds Select and export
  const nf = filterCount(P);
  $("tx-fl").textContent = nf ? t("Filter · {n}", { n: nf }) : t("Filter");
  $("tx-fbtn").classList.toggle("on", nf > 0);
  $("tx-fbtn").setAttribute("aria-label", nf ? t("Filter, {n} on", { n: nf }) : t("Filter"));
  $("tx-fbtn").hidden = S.selMode;
  $("tx-done").hidden = !S.selMode;
  $("tx-more").innerHTML =
    (cal ? "" : '<button type="button" role="menuitem" data-act="select">' + icon("check") + "<span>" + esc(S.selMode ? t("Done selecting") : t("Select")) + "</span></button>") +
    '<button type="button" role="menuitem" data-act="export"' + (cur.list.length ? "" : " disabled") + ">" + icon("download") + "<span>" + esc(t("Export as CSV")) + "</span></button>";
}
/* Can ‹ › move? A month or a year, within the ledger's first and last day */
function stepOk() {
  const [fy, fm] = ym(firstDay()), [ly, lm] = ym(lastDay());
  if (S.view === "cal" || S.mode === "month") { const k = S.ym[0] * 12 + S.ym[1]; return { prev: k > fy * 12 + fm, next: k < ly * 12 + lm }; }
  if (S.mode === "year") return { prev: S.y > fy, next: S.y < +TODAY.slice(0, 4) };
  return { prev: false, next: false };
}
/* The search box: filter words (#tag, @person, >50, a category, a month) drawn as tokens behind the text */
function syncMirror() {
  const q = $("tx-q"), m = $("tx-mirror");
  if (!q || !m) return;
  const v = q.value, P = parseQ(v), tok = new Set();
  P.chips.forEach((c) => { if (c.label.charAt(0) !== "“") c.idx.forEach((i) => tok.add(i)); });
  let i = -1;
  m.innerHTML = v.replace(/(\s+)|(\S+)/g, (all, sp, w) => (sp ? esc(sp) : (i++, tok.has(i) ? '<span class="tok">' + esc(w) + "</span>" : esc(w))));
  m.scrollLeft = q.scrollLeft;
  q.classList.toggle("mirrored", tok.size > 0);
}
/* Searching: the head and the page change while the box is in use */
function qActive() { const q = $("tx-q"); return !!q && (document.activeElement === q || !!S.q.trim()); }
function searchState() {
  const q = $("tx-q"), focused = document.activeElement === q, active = qActive(), blank = focused && !q.value.trim(), phone = layout() === "phone";
  $("tx-head").classList.toggle("searching", active);
  $("tx-head").querySelector(".tx-cancel").hidden = !(phone && active);
  // Recent searches and hints: a popover under the box, or the page itself on a phone
  const pop = $("tx-recent"), page = $("tx-qrec");
  pop.hidden = !(blank && !phone);
  page.hidden = !(blank && phone);
  root.querySelector(".tx-page").classList.toggle("qblank", blank && phone);
  if (blank) { pop.innerHTML = phone ? "" : recentHtml(false); page.innerHTML = phone ? recentHtml(true) : ""; }
}
function recentHtml(phone) {
  const first = state.people[0], who = couple() && first ? "@" + first.name.split(/\s+/)[0].toLocaleLowerCase() : null;
  const tries = [[">50", t("amount over {amount}", { amount: "50" }), ">"], who && [who, t("a person"), "@"], ["#tag", t("a tag"), "#"]].filter(Boolean);
  const rec = recent();
  if (phone) {
    return (rec.length ? '<div class="w-glh">' + esc(t("Recent")) + '</div><div class="w-gl">' + rec.map((r) => '<button type="button" class="w-gr" data-rq="' + esc(r) + '">' + icon("history", "tx-rqi") + '<span class="k">' + esc(r) + "</span></button>").join("") +
        '<button type="button" class="w-gr acc" data-act="rclear">' + esc(t("Clear Recent")) + "</button></div>" : "") +
      '<div class="w-glh">' + esc(t("Try")) + '</div><div class="w-gl">' + tries.map(([k, d, ins]) => '<button type="button" class="w-gr" data-rins="' + esc(ins) + '"><span class="k"><span class="tok">' + esc(k) + '</span></span><span class="v">' + esc(d) + "</span></button>").join("") + "</div>";
  }
  return (rec.length ? '<div class="tx-rh">' + esc(t("Recent")) + "</div>" + rec.map((r) => '<button type="button" data-rq="' + esc(r) + '">' + icon("history", "tx-rqi") + "<span>" + esc(r) + "</span></button>").join("") + '<div class="w-menusep" role="separator"></div>' : "") +
    '<div class="tx-rh">' + esc(t("Try")) + "</div>" + tries.map(([k, d, ins]) => '<button type="button" data-rins="' + esc(ins) + '"><span class="tok">' + esc(k) + "</span><small>" + esc(d) + "</small></button>").join("");
}

function renderTools(R, P, shown) {
  const cal = S.view === "cal";
  $("tx-daychip").innerHTML = S.day && !cal
    ? '<button type="button" class="w-chip on" data-act="dayx" aria-label="' + esc(t("Show every day, not only {day}", { day: dlabW(S.day) })) + '">' + icon("cal") + esc(dlabW(S.day)) + icon("x", "x") + "</button>" : "";
  // While searching, a scope bar: every month, or only the range picked (like Mail's All Mailboxes | Inbox)
  const sc = $("tx-scope"), scoped = S.q.trim() && !R.fromQuery && !cal && S.mode !== "all";
  sc.hidden = !scoped;
  sc.innerHTML = scoped ? '<button type="button" data-sc="all" aria-pressed="' + !!R.search + '">' + esc(t("All months")) + '</button><button type="button" data-sc="range" aria-pressed="' + !R.search + '">' + esc(scopeLabel()) + "</button>" : "";
  // One line instead of a chart: how many, what came in, what went out
  let inc = 0, out = 0;
  for (const x of shown) { if (x.type === "income") inc += amt(x); else out += amt(x); }
  const n = shown.length;
  $("tx-count").innerHTML = '<span class="tx-n">' + esc(state.scope === "all" ? tn(n, "{n} transaction", "{n} transactions") : tn(n, "{n} transaction for {name}", "{n} transactions for {name}", { name: pname(state.scope) })) + "</span>" +
    (inc ? '<span class="tx-sumi">' + esc(t("In")) + ' <b class="pos amt">' + esc(f0(inc)) + "</b></span>" : "") + (out ? '<span class="tx-sumi">' + esc(t("Out")) + ' <b class="amt">' + esc(f0(out)) + "</b></span>" : "");
}

/* On phones a row is only marked while its detail is open; elsewhere the selection always shows */
/* Only the selected row is in the Tab order; ↑ ↓ move from there */
/* Sorted by amount there are no day headers, so each row says its date */
function rowOpts(x) {
  const tab = x.id === S.sel, date = S.sort === "amount";
  return S.selMode ? { check: S.picked.has(x.id), tab, date } : { sel: tab && (S.open || layout() !== "phone"), tab, date };
}
function renderList(R, P, shown) {
  $("tx-list").classList.toggle("tx-flat", S.sort === "amount");
  list.set(buildItems(shown, !R.month, S.sort === "amount"), rowOpts, emptyList(R, P));
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
  const g = monthGrid(y, m, by, sched, S.calDay, "cd", layout() === "phone");
  $("tx-cal").innerHTML = g.html;
  gridHover($("tx-cal"), "cd", by, sched);
  $("tx-cal-h").textContent = monthYear(y, m);
  $("tx-cal").setAttribute("aria-description", noSpendText(g.ns));
  $("tx-insp").innerHTML = dayPanel(S.calDay, noDay, sched, layout() === "wide", layout() === "phone");
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
  if (mode === "year") S.y = +TODAY.slice(0, 4);
  S.searchAll = false; S.day = null; S.sel = null; S.open = false;
  if (mode !== "month") S.view = "list";
  render();
}
/* ‹ ›: one month (or one year in year view) back or forward */
function step(k) {
  const ok = stepOk();
  if ((k < 0 && !ok.prev) || (k > 0 && !ok.next)) return;
  if (S.view !== "cal" && S.mode === "year") S.y += k;
  else { S.ym = ymAdd(S.ym[0], S.ym[1], k); S.mode = "month"; S.calDay = null; }
  S.day = null; S.sel = null; S.open = false;
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
/* ---------- events ---------- */
function onClick(ev) {
  const tgt = ev.target;
  const act = tgt.closest("[data-act]");
  if (act && !act.disabled) {
    const a = act.dataset.act, x = selected();
    switch (a) {
      case "filters": return openFilter({ render, list: () => cur.list, setQ, setWho, phone: layout() === "phone", button: act });
      case "prev": return step(-1);
      case "next": return step(1);
      case "select": S.selMode = !S.selMode; S.picked = new Set(); S.open = false; lastPick = null; return render();
      case "export": return exportCsv(cur.list);
      case "everym": S.searchAll = true; if (S.mode === "all") S.mode = "month"; S.sel = null; return render();
      case "qx": setQ(""); render(); $("tx-q").focus(); return;
      case "cancel": setQ(""); $("tx-q").blur(); return render();
      case "rclear": clearRecent(); searchState(); $("tx-q").focus(); return;
      case "clear": setQ(""); S.cats = new Set(); S.type = "all"; S.shared = false; S.day = null; setWho(null); return render();
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
    const [ty, tm] = ym(TODAY);
    S.mode = "month"; S.ym = v === "last" ? ymAdd(ty, tm, -1) : [ty, tm]; S.searchAll = false; S.day = null; S.sel = null; S.open = false; S.calDay = null;
    return render();
  }
  const vw = tgt.closest("[data-view]");
  if (vw) { if (vw.dataset.view === "cal") { if (S.view !== "cal") showCal(); } else if (S.view !== "list") { S.view = "list"; S.open = false; render(); } return; }
  const scb = tgt.closest("[data-sc]");
  if (scb) { S.searchAll = scb.dataset.sc === "all"; S.sel = null; return render(); }
  const rq = tgt.closest("[data-rq],[data-rins]");
  if (rq) {
    const q = $("tx-q");
    if (rq.dataset.rq !== undefined) { setQ(rq.dataset.rq, true); addRecent(rq.dataset.rq); render(); q.blur(); return; }
    q.value = rq.dataset.rins; q.focus(); q.setSelectionRange(q.value.length, q.value.length); setQ(q.value); render(); return;
  }
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
  syncMirror();
  $("tx-head").querySelector(".tx-qx").hidden = !ev.target.value;
  searchState();
  cancelAnimationFrame(searchFrame);
  searchFrame = requestAnimationFrame(render);
}
function onSearchFocus() { closeFilter(); searchState(); }
function onSearchBlur() {
  if (S.q.trim()) addRecent(S.q);
  // Let a click on a recent search land before the popover goes
  setTimeout(() => { if (mounted && document.activeElement !== $("tx-q")) searchState(); }, 0);
}
/* A press outside the search box or the filter popover closes them */
function onOutside(ev) {
  if (!mounted) return;
  const tg = ev.target;
  if (tg.closest && (tg.closest("#tx-recent") || tg.closest("#tx-qrec"))) { ev.preventDefault(); return; } // keep the box focused
  if (tg.closest && !tg.closest(".tx-fw") && !tg.closest("#dlg")) closeFilter();
}
function onSearchKey(ev) {
  if (ev.key === "Escape") {
    ev.stopPropagation();
    if (ev.target.value) { setQ(""); render(); } else ev.target.blur();
  } else if (ev.key === "ArrowDown" || ev.key === "Enter") {
    if (ev.key === "Enter") { ev.preventDefault(); addRecent(S.q); if (layout() === "phone") ev.target.blur(); }
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
    if (!$("tx-fpop").hidden) return closeFilter(true);
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
