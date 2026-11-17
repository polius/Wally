/* Budget: what is left of the limits you set, this month and in the months before.
   One number leads (what is left of the limit for everything, and what that is per day), then each
   limit as a row with a bar: the solid part is what was spent, the lighter part what recurring bills
   will still take this month, as the lead's key names them; this month the mark is the even pace by
   today. Hovering a bar shows its parts, what is left or over, and the pace. Categories without a limit come last, with
   what they cost, so the page adds up to the month; this month, one opens the sheet to set its limit.
   With no limit yet, the page is the setup.
   Every figure comes from js/budget.js; the limits are set in js/limit.js. */
import { state, t, tn, esc, f, bigMoney, tile, icon, cat, monthName, dlab, dlabW, TODAY, PUT, reloadBudgets, ym } from "../core.js";
import { toast, errorToast, trapFocus, sw, showTip, moveTip, hideTip, row } from "../ui.js";
import { refresh, headActions } from "../shell.js";
import { EVERYTHING, thisMonth, monthAdd, limitsIn, figure, spentIn, monthSpent, suggestions, anyLimits } from "../budget.js";
import { openLimit, remove } from "../limit.js";

const phoneMQ = matchMedia("(max-width:767px)");
const wideMQ = matchMedia("(min-width:1280px)");
const wide = () => wideMQ.matches, phone = () => phoneMQ.matches;
const ui = { month: null, sel: null, open: false, setup: null, editing: null, more: null };
let root = null;

const bdi = (html) => "<bdi>" + html + "</bdi>";
const m = (n) => bdi(esc(f(n)));
const bigM = (n) => bdi(bigMoney(n).replace(/<\/span>([^<]*)$/, "$1</span>"));
const first = (month) => month + "-01";
const lastDay = (month) => { const [y, mo] = ym(first(month)); return month + "-" + new Date(Date.UTC(y, mo, 0)).getUTCDate(); };
const name = (c) => (c === EVERYTHING ? t("Everything") : cat(c).n);
const monthTitle = (month) => monthName(+month.slice(5, 7)) + (month.slice(0, 4) !== TODAY.slice(0, 4) ? " " + month.slice(0, 4) : "");

/* ---------- page ---------- */
export function mount(el, route) {
  root = el;
  const q = route.query.get("m");
  ui.month = q && /^\d{4}-\d\d$/.test(q) && q <= thisMonth() ? q : thisMonth();
  ui.sel = route.query.get("c");
  ui.open = ui.sel !== null;
  ui.setup = null;
  root.innerHTML =
    '<header class="w-head s-head bg-head"><div class="s-titlew"><h3 class="s-title" id="bg-title"></h3></div>' +
    '<div class="s-steps w-steps" id="bg-steps"><button type="button" class="s-stepb" data-step="-1" aria-label="' + esc(t("Previous month")) + '">' + icon("left") + "</button>" +
    '<button type="button" class="s-stepb" data-step="1" aria-label="' + esc(t("Next month")) + '">' + icon("right") + "</button></div>" +
    // Limits are the household's: the person menu says Everyone, with the people disabled
    headActions("", { household: true }) + "</header>" +
    '<div id="bg-page"></div>';
  root.addEventListener("click", onClick);
  root.addEventListener("keydown", onKeydown);
  root.addEventListener("input", onChange);
  // A bar says what it holds, on hover (a mouse only: on touch, the row and the panel name it)
  root.addEventListener("mouseover", onMark);
  root.addEventListener("mousemove", onMark);
  root.addEventListener("mouseleave", hideTip);
  // Leaving an amount, or Return: it shows as an amount again
  root.addEventListener("focusout", (ev) => { if (ev.target.matches("[data-si]") && ui.setup) { ui.editing = null; setTimeout(render); } });
  root.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && ev.target.matches("[data-si]")) ev.target.blur(); });
  phoneMQ.addEventListener("change", render);
  wideMQ.addEventListener("change", render);
  render();
}
export function unmount() {
  if (root) { root.removeEventListener("click", onClick); root.removeEventListener("keydown", onKeydown); root.removeEventListener("input", onChange); root.removeEventListener("mouseover", onMark); root.removeEventListener("mousemove", onMark); root.removeEventListener("mouseleave", hideTip); }
  hideTip();
  phoneMQ.removeEventListener("change", render);
  wideMQ.removeEventListener("change", render);
  document.documentElement.classList.remove("rec-lock");
  root = null;
}
export function update() { if (root) render(); }

function render() {
  if (!root) return;
  const page = root.querySelector("#bg-page");
  root.querySelector("#bg-title").textContent = monthTitle(ui.month);
  const steps = root.querySelector("#bg-steps");
  steps.querySelector('[data-step="1"]').disabled = ui.month >= thisMonth();
  steps.querySelector('[data-step="-1"]').disabled = !anyLimits() || !state.tx.length || first(ui.month) <= state.tx[state.tx.length - 1].d.slice(0, 8) + "01";
  if (!anyLimits()) { page.innerHTML = setup(); setOpen(false); return; }

  const now = ui.month === thisMonth();
  const limits = limitsIn(ui.month).filter((b) => b.period === "month" || now);
  const all = limits.find((b) => b.category === EVERYTHING) || null;
  const cats = limits.filter((b) => b.category !== EVERYTHING);
  const monthly = cats.filter((b) => b.period === "month").sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category));
  const yearly = cats.filter((b) => b.period === "year").sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category));
  // Keep the selection on a limit that is shown; on a wide screen something is always selected
  const shown = monthly.concat(yearly);
  if (ui.sel !== null && !shown.some((b) => b.category === ui.sel)) ui.sel = null;
  if (ui.sel === null && wide() && shown.length && now) ui.sel = shown[0].category;
  if (ui.sel === null) ui.open = false;
  const panel = now && shown.length;

  page.innerHTML =
    // With its bar, the lead is a card, as the Summary's number with its chart is (not on phones)
    '<section class="rec-sum bg-sum' + (all ? " bg-card" : "") + '" aria-live="polite">' + lead(all) + "</section>" +
    '<div class="' + (panel ? "w-tx rec-body" : "bg-one") + '">' +
      '<section class="w-panel rec-list bg-list" aria-label="' + esc(t("Limits")) + '">' + groups(monthly, yearly, limits) + "</section>" +
      (panel ? '<aside class="w-panel w-insp rec-insp bg-insp" id="bg-insp" tabindex="-1" aria-label="' + esc(ui.sel !== null ? name(ui.sel) : t("Limit")) + '"></aside>' : "") +
    "</div>" +
    '<div class="rec-scrim" data-close hidden></div>';
  if (panel) {
    const b = shown.find((x) => x.category === ui.sel);
    const box = root.querySelector("#bg-insp");
    if (b) inspector(box, b); else box.innerHTML = '<div class="w-empty"><b>' + t("Nothing selected") + "</b><p>" + t("Pick a limit to see it here.") + "</p></div>";
  }
  setOpen(ui.open && ui.sel !== null);
}

/* ---------- what leads: what is left of the limit for everything, or the month's spending ---------- */
function lead(all) {
  const now = ui.month === thisMonth();
  if (!all) {
    const spent = spentIn(EVERYTHING, first(ui.month), now ? TODAY : lastDay(ui.month));
    return '<span class="rec-eye">' + t("Spending") + '</span><b class="rec-big amt">' + bdi(bigMoney(spent)) + "</b>" +
      '<span class="rec-line">' + t("No limit for the whole month.") + (now ? ' <button type="button" class="w-link" data-limit="">' + t("Set one") + "</button>" : "") + "</span>";
  }
  const fg = figure(all, ui.month);
  const eye = now ? (fg.over ? t("Over the limit") : t("Left to spend"))
    : fg.over ? t("Over at the end of {month}", { month: monthName(+ui.month.slice(5, 7)) }) : t("Left at the end of {month}", { month: monthName(+ui.month.slice(5, 7)) });
  // What that is a day, as the panel says it; over the limit there is no such line. Then spent against the limit as a bar
  const line = now && fg.perDay !== null ? t("{amount} a day until {date}", { amount: f(fg.perDay), date: dlab(lastDay(ui.month)) }) : "";
  // The limit sits over the bar's end, as iPhone Storage puts its total: on the per-day line's right, or under it when
  // there is no room (a narrow phone, a long language). Under the bar a key: each part named, with its amount
  return '<span class="rec-eye">' + esc(eye) + '</span><b class="rec-big amt">' + bdi(bigMoney(Math.abs(fg.left))) + "</b>" +
    '<div class="bg-top">' + (line ? '<span class="rec-line">' + esc(line) + "</span>" : "") +
      '<span class="bg-lim">' + esc(t("Limit")) + " <b>" + m(fg.limit) + "</b></span></div>" +
    '<div class="bg-lead">' + bar(fg, false, name(EVERYTHING)) +
      '<div class="bg-key"><span><i class="sp' + (fg.over ? " over" : "") + '"></i>' + esc(t("Spent")) + " <b>" + m(fg.spent) + "</b></span>" +
        (fg.due > 0.004 ? '<span><i class="du' + (fg.over ? " over" : "") + '"></i>' + esc(t("Bills still due")) + " <b>" + m(fg.due) + "</b></span>" : "") + "</div></div>";
}

/* ---------- the limits, then what has none ---------- */
function groups(monthly, yearly, limits) {
  const now = ui.month === thisMonth();
  let html = "";
  if (monthly.length) html += '<div class="w-dayh">' + t("Each month") + "</div>" + monthly.map(limitRow).join("");
  if (yearly.length) html += '<div class="w-dayh">' + t("Each year") + "</div>" + yearly.map(limitRow).join("");
  // Categories without a limit, with what they cost this month: the page adds up to the month
  const limited = new Set(limits.map((b) => b.category));
  const totals = {};
  const a = first(ui.month), b = now ? TODAY : lastDay(ui.month);
  for (const x of state.tx) if (x.type === "expense" && x.d >= a && x.d <= b && !limited.has(x.c)) totals[x.c] = (totals[x.c] || 0) + x.a;
  const free = Object.keys(totals).filter((c) => totals[c] > 0.004).sort((x, y) => totals[y] - totals[x]);
  if (free.length) {
    const sum = free.reduce((s, c) => s + totals[c], 0);
    html += '<div class="w-dayh">' + t("No limit") + '<span class="amt">' + m(sum) + "</span></div>" +
      free.map((c) => {
        // This month, a category without a limit opens the sheet to set one
        const tag = now ? 'button type="button" data-limit="' + esc(c) + '" aria-label="' + esc(cat(c).n + ": " + f(totals[c]) + ". " + t("Limit for {category}", { category: cat(c).n })) + '"' : "div";
        return "<" + tag + ' class="w-rrow bg-none">' + tile(c, 32) + '<div class="rec-rn"><h6>' + esc(cat(c).n) + '</h6></div><span class="amt">' + m(totals[c]) + "</span></" + tag.split(" ")[0] + ">";
      }).join("");
  }
  if (!monthly.length && !yearly.length && !free.length) html += '<div class="w-empty"><b>' + t("Nothing spent") + "</b></div>";
  return html;
}
function bar(fg, year, label) {
  const pct = Math.min(100, (fg.spent / fg.limit) * 100), due = Math.max(0, Math.min(100 - pct, (fg.due / fg.limit) * 100));
  // Over the limit (bills still due included): the whole bar is red. With a mouse, the whole bar says what it holds
  return '<div class="bg-bar' + (fg.over ? " over" : "") + '" aria-hidden="true" data-n="' + esc(label) + '" data-s="' + fg.spent + '" data-d="' + fg.due + '" data-l="' + fg.left + '"' +
      (fg.today !== null ? ' data-e="' + fg.even + '"' : "") + (year ? " data-year" : "") + '><i style="width:' + pct.toFixed(2) + '%"></i>' +
    (due > 0.05 ? '<i class="due" style="inset-inline-start:' + pct.toFixed(2) + "%;width:" + due.toFixed(2) + '%"></i>' : "") +
    // This month, the even share by today: where spending would be if the limit went evenly
    (fg.today !== null ? '<u style="inset-inline-start:calc(' + (fg.today * 100).toFixed(2) + '% - 0.75px)"></u>' : "") + "</div>";
}
let onTip = false;
function onMark(ev) {
  const bar = ev.target.closest && ev.target.closest(".bg-bar[data-n]");
  if (!bar || !matchMedia("(hover:hover)").matches) { if (onTip) { hideTip(); onTip = false; } return; }
  if (onTip && ev.type === "mousemove") { moveTip(ev); return; }
  onTip = true;
  showTip(barTip(bar), ev);
}
/* A bar's tooltip: its parts (spent, bills still due) and what is left or over; this month, spent against the even
   pace by today (the mark), and how far apart they are */
function barTip(el) {
  const d = el.dataset, spent = +d.s, due = +d.d, left = +d.l, over = el.classList.contains("over");
  const css = getComputedStyle(el), col = (v) => css.getPropertyValue(v).trim();
  let html = '<b class="bg-tiph">' + esc(d.n) + "</b>" +
    row(esc(t("Spent")), m(spent), col(over ? "--bg-overc" : "--bg-spent")) +
    (due > 0.004 ? row(esc(t("Bills still due")), m(due), col("--bg-due")) : "") +
    '<div class="r d-sum"><span>' + esc(over ? t("Over the limit") : t("Left to spend")) + "</span><b" + (over ? ' class="bg-bad"' : "") + ">" + m(Math.abs(left)) + "</b></div>";
  if (d.e !== undefined) {
    const even = +d.e, ahead = spent - even > 0.004;
    html += '<div class="bg-tippace">' + row('<i class="bg-tk"></i>' + esc(t("Even pace by today")), m(even)) +
      row(esc(ahead ? t("Above the even pace") : t("Below the even pace")), '<span class="' + (ahead ? "bg-bad" : "bg-good") + '">' + m(Math.abs(spent - even)) + "</span>") + "</div>" +
      '<small class="w-tiphint">' + esc(t("Where you’d be today if you spent the same amount each day.")) + "</small>";
  }
  return html;
}
function limitRow(b) {
  const fg = figure(b, ui.month), now = ui.month === thisMonth();
  // One line: spent of the limit. Bills still due are the bar's hatched part; they are named only when they are what puts it over
  const sub = t("{spent} of {limit}", { spent: f(fg.spent), limit: f(fg.limit) }) + (fg.over && fg.spent <= fg.limit && fg.due > 0.004 ? " · " + t("{amount} still due", { amount: f(fg.due) }) : "");
  const sel = now && b.category === ui.sel;
  const label = name(b.category) + ": " + sub + ". " + (fg.over ? t("{amount} over", { amount: f(-fg.left) }) : t("{amount} left", { amount: f(fg.left) }));
  return '<' + (now ? 'button type="button"' : "div") + ' class="w-rrow bg-row' + (sel ? " sel" : "") + '"' + (now ? ' data-bid="' + esc(b.category) + '" aria-pressed="' + sel + '"' : "") + ' aria-label="' + esc(label) + '">' +
    tile(b.category, 40) + '<div class="rec-rn"><h6>' + esc(name(b.category)) + "</h6><p>" + esc(sub) + "</p></div>" +
    '<span class="amt">' + m(Math.abs(fg.left)) + '<small class="' + (fg.over ? "over" : "") + '">' + (fg.over ? t("over") : t("left")) + "</small></span>" +
    // The bar runs under the amount too, the width of the lead's
    bar(fg, b.period === "year", name(b.category)) + "</" + (now ? "button" : "div") + ">";
}

/* ---------- a limit's panel (a page of its own on phones) ---------- */
function inspector(box, b) {
  const fg = figure(b), c = b.category, year = b.period === "year";
  const txs = state.tx.filter((x) => x.type === "expense" && x.c === c && x.d >= (year ? TODAY.slice(0, 4) + "-01-01" : first(ui.month)) && x.d <= TODAY);
  const lastMonths = year ? [] : [1, 2, 3].map((k) => monthAdd(ui.month, -k)).filter((mo) => state.tx.length && first(mo) >= state.tx[state.tx.length - 1].d.slice(0, 8) + "01");
  const kv = (k, v) => '<div class="rec-kv"><span>' + k + "</span><b>" + v + "</b></div>";
  const leftLine = fg.over ? t("over for {category}", { category: name(c) }) : t("left for {category}", { category: name(c) });
  const perDay = fg.perDay !== null ? t("{amount} a day until {date}", { amount: f(fg.perDay), date: dlab(lastDay(ui.month)) }) : year ? t("This year") : "";
  // Spent of the limit, and the bills still to come: the pace is the bar's mark, the history is Last months below
  const facts = kv(year ? t("Spent this year") : t("Spent"), bdi(esc(t("{spent} of {limit}", { spent: f(fg.spent), limit: f(fg.limit) })))) +
    (fg.due > 0.004 ? kv(t("Bills still due"), m(fg.due)) : "");
  // The last three; See all shows the rest here, in the panel, until another limit is picked
  const all = ui.more === c;
  const list = (all ? txs : txs.slice(0, 3)).map((x) => kv(esc(x.n || cat(x.c).n) + " · " + esc(dlabW(x.d)), '<span class="amt">' + m(x.a) + "</span>")).join("");
  const seeAll = txs.length > 3 ? '<p class="rec-cap"><button type="button" class="w-link" data-more aria-expanded="' + all + '">' + (all ? t("Show less") : tn(txs.length, "See all {n} transaction", "See all {n} transactions")) + "</button></p>" : "";
  const months = lastMonths.length ? '<div class="rec-sec2"><div class="rec-sh">' + t("Last months") + "</div>" + lastMonths.map((mo) => kv(esc(monthTitle(mo)), '<span class="amt">' + m(monthSpent(c, mo)) + "</span>")).join("") + "</div>" : "";
  const thisMonthSec = '<div class="rec-sec2"><div class="rec-sh">' + (year ? t("This year") : t("This month")) + "</div>" + (list || kv(t("Nothing spent yet"), "")) + seeAll + "</div>";
  if (phone()) {
    box.innerHTML =
      '<div class="w-mh rec-mh"><button type="button" class="w-plink" data-close>' + icon("left") + t("Budget") + '</button><button type="button" class="w-plink" data-edit>' + t("Edit") + "</button></div>" +
      '<div class="rec-mhero"><b>' + esc(name(c)) + '</b><span class="rec-mamt amt">' + bigM(Math.abs(fg.left)) + "</span>" +
        '<span class="rec-msub">' + esc([fg.over ? t("over") : t("left"), perDay].filter(Boolean).join(" · ")) + "</span></div>" +
      '<div class="rec-kvs">' + facts + "</div>" + thisMonthSec + months +
      '<div class="w-gl rec-macts"><button type="button" class="w-gr red" data-remove>' + t("Remove limit") + "</button></div>";
    return;
  }
  box.innerHTML =
    '<div class="rec-ih"><span class="rec-eye2">' + (year ? t("Limit, each year") : t("Limit, each month")) + "</span>" +
      '<button type="button" class="w-plink rec-edit" data-edit>' + t("Edit") + "</button>" +
      '<button type="button" class="w-x rec-close" data-close aria-label="' + esc(t("Close")) + '">' + icon("x") + "</button></div>" +
    '<div class="rec-iamt"><span class="rec-amt w-big amt' + (fg.over ? " bg-overamt" : "") + '">' + bigM(Math.abs(fg.left)) + "</span>" +
      '<span class="rec-iname">' + esc(leftLine) + "</span>" + (perDay ? '<span class="rec-idesc">' + esc(perDay) + "</span>" : "") + "</div>" +
    '<div class="rec-kvs">' + facts + "</div>" + thisMonthSec + months +
    '<div class="w-pacts rec-acts"><button type="button" class="red" data-remove>' + t("Remove limit") + "</button></div>";
}

/* ---------- the first time: the setup (B2) ---------- */
function setup() {
  if (!ui.setup) {
    const s = suggestions();
    ui.setup = [s.everything].concat(s.cats).map((x) => ({ category: x.category, usual: x.usual, amount: x.amount ? x.amount.toFixed(2) : "", on: x.on }));
    ui.hasHistory = s.history;
  }
  const rowOf = (x, i) => '<div class="w-rrow bg-row bg-sug">' + (x.category === EVERYTHING ? '<span class="w-ico bg-all">' + icon("wallet") + "</span>" : tile(x.category, 40)) +
    '<div class="rec-rn"><h6>' + esc(name(x.category)) + "</h6><p>" + (ui.hasHistory ? esc(t("Usually {amount}", { amount: f(x.usual) })) : esc(t("Not enough history yet"))) + "</p></div>" +
    '<span class="bg-sugv">' + (ui.editing === i || !x.amount
      ? '<input class="bg-suga" data-si="' + i + '" inputmode="decimal" autocomplete="off" value="' + esc(x.amount) + '" placeholder="' + esc(t("Amount")) + '" aria-label="' + esc(t("Limit for {category}", { category: name(x.category) })) + '">'
      : '<button type="button" class="bg-sugb' + (x.on ? "" : " off") + '" data-ei="' + i + '" aria-label="' + esc(t("Limit for {category}", { category: name(x.category) }) + ": " + f(Number(x.amount))) + '">' + m(Number(x.amount)) + "</button>") +
    sw("bg-sw" + i, x.on, t("Limit for {category}", { category: name(x.category) })).replace('class="w-switch"', 'class="w-switch" data-sw="' + i + '"') + "</span></div>";
  const ready = ui.setup.some((x) => x.on && Number(String(x.amount).replace(",", ".")) > 0);
  return '<section class="rec-sum bg-sum"><span class="rec-eye">' + t("Budget") + '</span><b class="bg-hello">' + t("See what’s left as you spend") + "</b>" +
      '<span class="rec-line">' + (ui.hasHistory ? t("Set a limit for the month, for a category, or both. These come from your last three months, rounded up.") : t("Set a limit for the month, for a category, or both.")) + "</span></section>" +
    '<div class="bg-one bg-setup"><section class="w-panel rec-list bg-list">' +
      '<div class="w-dayh">' + t("The whole month") + "</div>" + rowOf(ui.setup[0], 0) +
      (ui.setup.length > 1 ? '<div class="w-dayh">' + t("Categories") + "</div>" + ui.setup.slice(1).map((x, i) => rowOf(x, i + 1)).join("") : "") +
      '<div class="bg-cta"><button type="button" class="w-btn primary" data-start' + (ready ? "" : " disabled") + ">" + t("Start with these") + "</button></div>" +
    "</section></div>";
}
async function start(btn) {
  btn.disabled = true;
  const month = thisMonth();
  try {
    for (const x of ui.setup) {
      const v = Number(String(x.amount).replace(",", "."));
      if (x.on && v > 0) await PUT("/budgets", { category: x.category, period: "month", amount: String(v), month });
    }
    await reloadBudgets();
  } catch (e) { btn.disabled = false; errorToast(e); return; }
  ui.setup = null;
  toast(t("Budget started"));
  refresh({ budget: true });
}

/* ---------- the panel below 1280 px: over the list, or a page on phones ---------- */
function setOpen(open) {
  const box = root.querySelector("#bg-insp"), scrim = root.querySelector(".rec-scrim");
  if (!box) { document.documentElement.classList.remove("rec-lock"); return; }
  const overlay = open && !wide();
  box.classList.toggle("open", overlay);
  if (scrim) scrim.hidden = !overlay;
  if (overlay) { box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); }
  else { box.removeAttribute("role"); box.removeAttribute("aria-modal"); }
  document.documentElement.classList.toggle("rec-lock", overlay && phone());
}
function where() { const q = new URLSearchParams(); if (ui.month !== thisMonth()) q.set("m", ui.month); if (ui.open && ui.sel !== null) q.set("c", ui.sel); const s = q.toString(); return "/budget" + (s ? "?" + s : ""); }
function select(category) {
  ui.sel = category;
  ui.open = true;
  history.replaceState(history.state, "", where());
  render();
  const box = root.querySelector("#bg-insp.open");
  if (box) box.focus();
}
function closePanel() {
  const c = ui.sel;
  ui.open = false;
  if (!wide()) ui.sel = null;
  history.replaceState(history.state, "", where());
  render();
  const b = [...root.querySelectorAll("[data-bid]")].find((x) => x.dataset.bid === c);
  if (b) b.focus();
}

/* ---------- events ---------- */
function onKeydown(ev) {
  const box = root.querySelector("#bg-insp.open");
  if (box && box.contains(ev.target)) {
    if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); closePanel(); }
    else trapFocus(box, ev);
  }
}
/* Keys from the shell: Escape closes the panel; ← → step months */
export function key(ev) {
  if (ev.key === "Escape" && ui.open) { closePanel(); return; }
  if ((ev.key === "ArrowLeft" || ev.key === "ArrowRight") && document.activeElement && !document.activeElement.closest("input")) {
    const k = (ev.key === "ArrowLeft") !== (document.documentElement.dir === "rtl") ? -1 : 1;
    const b = root.querySelector('[data-step="' + k + '"]');
    if (b && !b.disabled && !b.parentNode.hidden) { ev.preventDefault(); b.click(); }
  }
}
/* Typing an amount in the setup: kept, and Start follows it, without drawing the list again */
function onChange(ev) {
  const i = ev.target.closest("[data-si]");
  if (!i || !ui.setup) return;
  ui.setup[+i.dataset.si].amount = i.value;
  const ok = ui.setup.some((x) => x.on && Number(String(x.amount).replace(",", ".")) > 0);
  const s = root.querySelector("[data-start]");
  if (s) s.disabled = !ok;
}
function onClick(ev) {
  const g = (sel) => ev.target.closest(sel);
  let b;
  if ((b = g("[data-step]"))) { ui.month = monthAdd(ui.month, +b.dataset.step); ui.open = false; ui.sel = null; history.replaceState(history.state, "", where()); render(); return; }
  if ((b = g("[data-bid]"))) { select(b.dataset.bid); return; }
  if (g("[data-close]")) { closePanel(); return; }
  if (g("[data-edit]")) { openLimit(ui.sel); return; }
  if (g("[data-remove]")) { const c = ui.sel; ui.open = false; remove(c); return; }
  if ((b = g("[data-limit]"))) { openLimit(b.dataset.limit); return; }
  if (g("[data-more]")) { ui.more = ui.more === ui.sel ? null : ui.sel; render(); const m2 = root.querySelector("[data-more]"); if (m2) m2.focus(); return; }
  if ((b = g("[data-sw]"))) {
    const x = ui.setup[+b.dataset.sw];
    x.on = !x.on;
    // Switched on with no amount: the field takes the focus
    render();
    if (x.on && !x.amount) { const input = root.querySelector('[data-si="' + b.dataset.sw + '"]'); if (input) input.focus(); }
    return;
  }
  if ((b = g("[data-start]"))) { start(b); return; }
  // An amount in the setup: selected, it becomes a field
  if ((b = g("[data-ei]"))) {
    ui.editing = +b.dataset.ei;
    render();
    const input = root.querySelector('[data-si="' + b.dataset.ei + '"]');
    if (input) { input.focus(); input.select(); }
  }
}
