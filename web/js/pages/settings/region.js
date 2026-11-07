/* Settings › Language & Region: the language, the household's currency and where its symbol goes, the first
   day of the week and the time zone. Currency, week and time zone open their own lists:
   /settings/region/currency, /week, /timezone (and /language on a phone, where it is a list too). */
import { t, esc, state, f, num, dlabY, TODAY, GET, POST, PUT, DEL, LANGUAGES, LANG, icon, symbol } from "../../core.js";
import { openDialog, toast, errorToast } from "../../ui.js";
import { refresh } from "../../shell.js";
import { gl, gr, addRow, check, minus, fieldRow, gate, phone, val, paint, segK as seg } from "./common.js";
import { setAction, openPane } from "../settings.js";

const SUBS = ["language", "currency", "week", "timezone"];
let box = null;
let sub = "";
let editing = false;   // currency list: Edit puts a delete button on each row
let query = "";        // the search field of the currency and time zone lists
let zones = null;

export function mount(el, s) {
  box = el;
  sub = SUBS.includes(s) ? s : "";
  editing = false; query = "";
  box.addEventListener("click", onClick);
  box.addEventListener("input", onInput);
  box.addEventListener("keydown", onKey);
  render();
}
export function show(s) { sub = SUBS.includes(s) ? s : ""; editing = false; query = ""; closeMenu(); render(); }
export function update() { if (box) render(); }
export function unmount() { closeMenu(); box = null; }
export function meta(s) {
  const titles = { language: t("Language"), currency: t("Currency"), week: t("Week Starts On"), timezone: t("Time Zone") };
  return SUBS.includes(s) ? { title: titles[s], back: { path: "region", label: t("Language & Region") } } : {};
}
export function onAction(act) { if (act === "edit" || act === "done") { editing = act === "edit"; render(); } }

let names = null;
function longName(code) {
  try { names = names || new Intl.DisplayNames(LANG, { type: "currency" }); const n = names.of(code); return n && n !== code ? n : ""; } catch (e) { return ""; }
}
export async function reloadCurrency() {
  const c = await GET("/currency");
  const sel = c.currencies.find((x) => x.name === c.selected);
  state.currency = { symbol: sel ? sel.symbol : c.selected, position: c.position, selected: c.selected, currencies: c.currencies };
}
const langName = (code) => (LANGUAGES.find((l) => l[0] === code) || ["", code])[1];
const sample = () => esc(dlabY(TODAY) + " · " + f(1234.56));
const WEEK = () => [["mon", t("Monday")], ["sun", t("Sunday")], ["sat", t("Saturday")]];
function amountLike(pos) {
  const n = new Intl.NumberFormat(LANG, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(1234.56), s = state.currency.symbol || "";
  return pos === "left" ? s + n : n + " " + s;
}
function zoneList() {
  if (!zones) { try { zones = Intl.supportedValuesOf("timeZone"); } catch (e) { zones = []; } }
  const cur = state.config.timezone || "";
  return (cur && !zones.includes(cur) ? [cur] : []).concat(zones);
}

function render() {
  if (!box) return;
  if (sub === "language") return renderLanguages();
  if (sub === "currency") return renderCurrencies();
  if (sub === "week") return renderWeek();
  if (sub === "timezone") return renderZones();
  setAction("");
  const cur = state.currency, sel = (cur.currencies || []).find((c) => c.name === cur.selected);
  const curName = esc((longName(cur.selected) || cur.selected) + (sel ? " (" + sel.symbol + ")" : ""));
  const tz = state.config.timezone || "";
  const lang = phone()
    ? gr({ tag: "a", href: "/settings/region/language", attrs: ' data-pane="region/language" data-k="lang"', k: t("Language"), v: esc(langName(LANG)), chev: true })
    : gr({ k: t("Language"), v: '<span lang="' + LANG + '">' + esc(langName(LANG)) + "</span>" + icon("down", "w-gdown"), act: "lang", attrs: ' aria-haspopup="menu" aria-expanded="false" data-k="lang"' });
  paint(box,
    gl([lang,
      gr({ tag: "a", href: "/settings/region/currency", attrs: ' data-pane="region/currency" data-k="cur"', k: t("Currency"), v: curName, chev: true }),
      gr({ k: t("Amounts"), right: seg("cur-pos", [["left", '<span class="amt">' + esc(amountLike("left")) + "</span>"], ["right", '<span class="amt">' + esc(amountLike("right")) + "</span>"]], cur.position, t("Where the symbol goes"), "w-segm") })]) +
    gl([gr({ tag: "a", href: "/settings/region/week", attrs: ' data-pane="region/week" data-k="week"', k: t("Week starts on"), v: (WEEK().find((w) => w[0] === (state.config.week_start || "mon")) || WEEK()[0])[1], chev: true }),
      gr({ tag: "a", href: "/settings/region/timezone", attrs: ' data-pane="region/timezone" data-k="tz"', k: t("Time zone"), v: esc(tz ? tz.replace(/_/g, " ") : t("The server’s")), chev: true })],
    "", '<span class="amt">' + sample() + "</span>"));
}

/* ---------- the language: a menu on desktop, a list on a phone ---------- */
function renderLanguages() {
  setAction("");
  paint(box, gl(LANGUAGES.map(([code, name]) => gr({ k: '<span lang="' + code + '">' + esc(name) + "</span>", act: "pick-lang", attrs: ' data-lang="' + code + '" data-name="' + esc(name) + '" data-k="lang:' + code + '" aria-pressed="' + (code === LANG) + '"', right: check(code === LANG) })),
    "", t("Dates and amounts follow the language: {sample}", { sample: '<span class="amt">' + sample() + "</span>" })));
}
let menu = null;
function openMenu(row) {
  closeMenu();
  const r = row.getBoundingClientRect();
  menu = document.createElement("div");
  menu.className = "w-popmenu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = LANGUAGES.map(([code, name]) => '<button type="button" role="menuitemradio" aria-checked="' + (code === LANG) + '" data-lang="' + code + '" data-name="' + esc(name) + '" lang="' + code + '">' + esc(name) + (code === LANG ? icon("check") : "") + "</button>").join("");
  document.body.appendChild(menu);
  const w = menu.offsetWidth, h = menu.offsetHeight;
  const rtl = document.dir === "rtl";
  // Like a macOS pop-up: beside the row, the checked language level with it; under the value when there's no room
  const on = menu.querySelector('[aria-checked="true"]') || menu.firstChild;
  const side = rtl ? r.left - 8 - w >= 8 : r.right + 8 + w <= innerWidth - 8;
  menu.style.left = (side ? (rtl ? r.left - 8 - w : r.right + 8) : Math.max(8, rtl ? r.left + 8 : Math.min(innerWidth - w - 8, r.right - w - 8))) + "px";
  menu.style.top = Math.max(8, Math.min(innerHeight - h - 8, side ? r.top + r.height / 2 - on.offsetTop - on.offsetHeight / 2 : r.bottom + 4)) + "px";
  row.setAttribute("aria-expanded", "true");
  (menu.querySelector('[aria-checked="true"]') || menu.firstChild).focus();
  menu.addEventListener("click", (ev) => { const b = ev.target.closest("[data-lang]"); if (b) { closeMenu(); choose(b.dataset.lang, b.dataset.name); } });
  menu.addEventListener("keydown", (ev) => {
    const items = [...menu.querySelectorAll("button")], i = items.indexOf(document.activeElement);
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") { ev.preventDefault(); items[(i + (ev.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus(); }
    else if (ev.key === "Escape" || ev.key === "Tab") { ev.preventDefault(); closeMenu(true); }
  });
  setTimeout(() => document.addEventListener("pointerdown", outside, true), 0);
}
function outside(ev) { if (menu && !menu.contains(ev.target)) closeMenu(); }
function closeMenu(refocus) {
  document.removeEventListener("pointerdown", outside, true);
  if (!menu) return;
  menu.remove(); menu = null;
  const row = box && box.querySelector('[data-act="lang"]');
  if (row) { row.setAttribute("aria-expanded", "false"); if (refocus) row.focus(); }
}
async function choose(code, name) {
  if (code === LANG) return;
  try {
    await PUT("/language/" + code);
    toast(t("{language} selected. Wally reloads in that language.", { language: name }));
    setTimeout(() => location.reload(), 600);
  } catch (e) { errorToast(e); }
}

/* ---------- currencies: the one in use, then every other; search, pick, Edit to change or delete ---------- */
function renderCurrencies() {
  const cur = state.currency;
  const all = cur.currencies || [];
  setAction('<button type="button" data-act="' + (editing ? "done" : "edit") + '"' + (editing ? ' class="on"' : "") + ">" + (editing ? t("Done") : t("Edit")) + "</button>");
  const q = query.trim().toLocaleLowerCase();
  const match = (c) => !q || [c.name, c.symbol, longName(c.name)].some((x) => String(x || "").toLocaleLowerCase().includes(q));
  const row = (c) => {
    const e = esc(c.name), inUse = c.name === cur.selected;
    const lead = (editing && !inUse ? minus(t("Delete {name}", { name: c.name }), ' data-act="delete-cur" data-name="' + e + '" data-k="del:' + e + '"') : "") + '<span class="w-sym" dir="ltr">' + esc(c.symbol) + "</span>";
    const k = esc(longName(c.name) || c.name);
    return editing
      ? gr({ tag: "div", lead, k, sub: '<bdi dir="ltr">' + e + " · " + esc(c.symbol) + "</bdi>", chev: true, act: "edit-cur", attrs: ' role="button" tabindex="0" data-name="' + e + '" data-k="edit:' + e + '"' })
      : gr({ lead, k, sub: '<bdi dir="ltr">' + e + " · " + esc(c.symbol) + "</bdi>", act: "pick-cur", attrs: ' data-name="' + e + '" data-k="pick:' + e + '" aria-pressed="' + inUse + '"', right: check(inUse) });
  };
  const used = all.filter((c) => c.name === cur.selected && match(c)), rest = all.filter((c) => c.name !== cur.selected && match(c));
  const search = '<label class="w-gsearch">' + icon("search") + '<input id="cur-q" type="search" value="' + esc(query) + '" placeholder="' + esc(t("Search {n} currencies", { n: num(all.length) })) + '" aria-label="' + esc(t("Search currencies")) + '" autocomplete="off"></label>';
  const html = (used.length ? gl(used.map(row), t("In use")) : "") + gl(rest.map(row).concat(q ? [] : [addRow(t("Add a currency…"), "add", ' data-k="add"')]), t("All currencies"), t("Wally shows every amount in one currency and never converts."));
  if (!box.querySelector("#cur-q")) paint(box, search + '<div id="cur-list">' + html + "</div>");
  else paint(box.querySelector("#cur-list"), html);
}
async function pickCurrency(name) {
  if (name === state.currency.selected) return;
  try {
    await PUT("/currency/" + encodeURIComponent(name));
    await reloadCurrency();
    refresh({ currency: true });
    toast(t("Amounts are shown in {name} now", { name }));
  } catch (e) { errorToast(e); }
}
/* Edit a currency, or add one that isn't listed. A code already in the list is said under the fields, and the action waits. */
function editCurrency(c) {
  const inUse = c && c.name === state.currency.selected;
  const all = state.currency.currencies || [];
  const taken = (code) => !!code && all.some((x) => x.name === code && (!c || x.name !== c.name));
  // What an amount looks like with the symbol typed
  const looks = (sym) => f(1234.56).replace(symbol(), sym);
  const base = c ? (inUse ? t("The symbol shows next to every amount. In use, so it can’t be deleted.") : t("The symbol shows next to every amount.")) : t("The symbol shows next to every amount.");
  const note = (r) => {
    const code = val(r, "cu-name").toUpperCase(), sym = val(r, "cu-sym");
    if (taken(code)) return t("{code} is already in the list.", { code });
    if (!c && sym) return t("Amounts will look like {amount}.", { amount: looks(sym) });
    return base;
  };
  const name = c ? longName(c.name) || c.name : "";
  openDialog({
    kind: "sheet",
    title: c ? esc(name.charAt(0).toLocaleUpperCase(LANG) + name.slice(1)) : t("New Currency"),
    top: c ? "" : '<span class="w-secico">' + icon("globe") + '</span><b class="w-shtitle w-sht20">' + t("A currency that isn’t listed") + '</b><p class="w-mw360">' + t("Wally shows every amount in one currency and never converts.") + "</p>",
    body: c
      ? '<div class="w-gl"><label class="w-gr"><span class="k">' + t("Code") + '</span><input id="cu-name" class="w-end" value="' + esc(c.name) + '" maxlength="8" autocapitalize="characters" autocomplete="off"></label><label class="w-gr"><span class="k">' + t("Symbol") + '</span><input id="cu-sym" class="w-end" value="' + esc(c.symbol) + '" maxlength="6" autocomplete="off"></label></div>' +
        '<p class="w-glf" id="cu-note" aria-live="polite">' + base + "</p>"
      : '<div class="w-gl"><label class="w-gr"><input id="cu-name" placeholder="' + esc(t("Code, like SEK")) + '" aria-label="' + esc(t("Code")) + '" maxlength="8" autocapitalize="characters" autocomplete="off" autofocus></label><label class="w-gr"><input id="cu-sym" placeholder="' + esc(t("Symbol, like kr")) + '" aria-label="' + esc(t("Symbol")) + '" maxlength="6" autocomplete="off"></label></div>' +
        '<p class="w-glf" id="cu-note" aria-live="polite">' + base + "</p>",
    ok: c ? t("Save") : t("Add"),
    onOpen: (root) => {
      root.querySelector("#cu-note").classList.add("w-cunote");
      root.addEventListener("input", () => { const n = root.querySelector("#cu-note"); n.textContent = note(root); n.classList.toggle("bad", taken(val(root, "cu-name").toUpperCase())); });
      gate(root, (r) => {
        const code = val(r, "cu-name").toUpperCase(), sym = val(r, "cu-sym");
        return !!code && !!sym && !taken(code);
      });
      // Editing one that exists: the fields wait for a tap (no keyboard pops up); Return saves
      if (c) queueMicrotask(() => root.querySelector("[data-dlg-ok]").focus());
    },
    onOk: async (root) => {
      const name = val(root, "cu-name").toUpperCase();
      const sym = val(root, "cu-sym");
      if (!name || !sym) throw new Error(t("Type a code and a symbol."));
      if (c) await PUT("/currency/" + encodeURIComponent(c.name) + "/update", { name, symbol: sym });
      else await POST("/currency", { name, symbol: sym });
      await reloadCurrency();
      refresh({ currency: true });
      toast(c ? t("Saved {name}", { name }) : t("Added {name}", { name }));
    },
  });
}
async function removeCurrency(name) {
  const c = (state.currency.currencies || []).find((x) => x.name === name);
  if (!c) return;
  try {
    await DEL("/currency/" + encodeURIComponent(name));
    await reloadCurrency();
    refresh({ currency: true });
    toast(t("Deleted {name}", { name }), async () => { await POST("/currency", { name: c.name, symbol: c.symbol }); await reloadCurrency(); refresh({ currency: true }); });
  } catch (e) { errorToast(e); }
}
async function setPosition(position) {
  if (position === state.currency.position) return;
  try {
    await PUT("/currency/position/" + position);
    state.currency.position = position;
    refresh({ currency: true });
  } catch (e) { errorToast(e); }
}

/* ---------- the first day of the week, and the time zone ---------- */
function renderWeek() {
  setAction("");
  const now = state.config.week_start || "mon";
  paint(box, gl(WEEK().map(([v, l]) => gr({ k: l, act: "pick-week", attrs: ' data-v="' + v + '" data-k="week:' + v + '" aria-pressed="' + (v === now) + '"', right: check(v === now) })), "", t("Used by the calendars.")));
}
function renderZones() {
  setAction("");
  const tz = state.config.timezone || "", here = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const q = query.trim().toLocaleLowerCase().replace(/ /g, "_");
  const list = zoneList().filter((z) => !q || z.toLocaleLowerCase().includes(q));
  const row = (v, label) => gr({ k: label, act: "pick-tz", attrs: ' data-v="' + esc(v) + '" data-k="tz:' + esc(v) + '" aria-pressed="' + (v === tz) + '"', right: check(v === tz) });
  const html = gl((q ? [] : [row("", t("The server’s time zone"))]).concat(list.map((z) => row(z, esc(z.replace(/_/g, " "))))), "",
    t("Decides when a new day starts for recurring transactions and the nightly backup. This browser is in {zone}.", { zone: esc(here) }));
  const search = '<label class="w-gsearch">' + icon("search") + '<input id="tz-q" type="search" value="' + esc(query) + '" placeholder="' + esc(t("Search")) + '" aria-label="' + esc(t("Search time zones")) + '" autocomplete="off"></label>';
  if (!box.querySelector("#tz-q")) paint(box, search + '<div id="tz-list">' + html + "</div>");
  else paint(box.querySelector("#tz-list"), html);
}
async function save(change, msg) {
  try {
    state.config = await PUT("/config", change);
    refresh({ config: true });
    if (msg) toast(msg);
  } catch (e) { errorToast(e); render(); }
}

/* ---------- events ---------- */
function onInput(ev) {
  if (ev.target.id === "cur-q" || ev.target.id === "tz-q") { query = ev.target.value; render(); }
}
function onKey(ev) {
  if ((ev.key === "Enter" || ev.key === " ") && ev.target.matches('div[role="button"][data-act]')) { ev.preventDefault(); ev.target.click(); return; }
  if (ev.key === "ArrowDown" && ev.target.matches('[data-act="lang"]')) { ev.preventDefault(); openMenu(ev.target); }
}
function onClick(ev) {
  const pos = ev.target.closest("#cur-pos [data-v]");
  if (pos) return setPosition(pos.dataset.v);
  const b = ev.target.closest("[data-act]");
  if (!b) return;
  const a = b.dataset.act;
  if (a === "lang") return menu ? closeMenu() : openMenu(b);
  if (a === "pick-lang") return choose(b.dataset.lang, b.dataset.name);
  if (a === "pick-cur") return pickCurrency(b.dataset.name);
  if (a === "edit-cur") return editCurrency((state.currency.currencies || []).find((c) => c.name === b.dataset.name));
  if (a === "delete-cur") { ev.stopPropagation(); return removeCurrency(b.dataset.name); }
  if (a === "add") return editCurrency(null);
  if (a === "pick-week") { const v = b.dataset.v; if (v !== (state.config.week_start || "mon")) save({ week_start: v }).then(() => openPane("region")); else openPane("region"); return; }
  if (a === "pick-tz") { const v = b.dataset.v; save({ timezone: v }, v ? t("Time zone set to {zone}", { zone: v }) : t("Time zone follows the server")).then(() => openPane("region")); }
}
