/* Settings › Currency: the household's currency, where its symbol goes, and the list of currencies. */
import { t, esc, state, f, num, GET, POST, PUT, DEL, LANG } from "../../core.js";
import { openDialog, toast, errorToast } from "../../ui.js";
import { refresh } from "../../shell.js";
import { group, gi, giButton, ico, ctl, linkBtn, trashBtn, field, textInput, val, paint, segK as seg } from "./common.js";

const SHOWN = 8;
let box = null;
let showAll = false;

export function mount(el) {
  box = el;
  box.addEventListener("click", onClick);
  box.addEventListener("change", onChange);
  render();
}
export function update() { if (box) render(); }
export function unmount() { box = null; }

let names = null;
function longName(code) {
  try { names = names || new Intl.DisplayNames(LANG, { type: "currency" }); const n = names.of(code); return n && n !== code ? n : ""; } catch (e) { return ""; }
}
export async function reloadCurrency() {
  const c = await GET("/currency");
  const sel = c.currencies.find((x) => x.name === c.selected);
  state.currency = { symbol: sel ? sel.symbol : c.selected, position: c.position, selected: c.selected, currencies: c.currencies };
}

function render() {
  const cur = state.currency;
  // The one in use first, then the rest in order
  const list = (cur.currencies || []).slice().sort((a, b) => (b.name === cur.selected) - (a.name === cur.selected));
  const option = (c) => '<option value="' + esc(c.name) + '"' + (c.name === cur.selected ? " selected" : "") + ">" + esc([c.name, c.symbol, longName(c.name)].filter(Boolean).join(" · ")) + "</option>";
  const main = group(t("Currency"), [
    gi(ico("coin"), t("Main currency"), t("Every amount is shown in it. Wally does not convert between currencies."),
      ctl('<select class="w-mini w-sselect" id="cur-sel" aria-label="' + esc(t("Main currency")) + '" data-k="cur-sel">' + list.map(option).join("") + "</select>")),
    gi(ico("coin"), t("Symbol position"), t("Preview: {sample}. Separators follow the language.", { sample: '<b class="w-sstrong amt" id="cur-preview">' + esc(f(1234.56)) + "</b>" }),
      ctl(seg("cur-pos", [["left", t("Before the amount")], ["right", t("After the amount")]], cur.position, t("Symbol position"), "sm"))),
  ]);
  const shown = showAll ? list : list.slice(0, SHOWN);
  const rows = shown.map((c) => {
    const e = esc(c.name), inUse = c.name === cur.selected;
    return gi('<span class="w-ico w-sym">' + esc(c.symbol) + "</span>", e + (longName(c.name) ? " · " + esc(longName(c.name)) : "") + (inUse ? ' <span class="w-badge">' + t("In use") + "</span>" : ""),
      t("Symbol {symbol}", { symbol: esc(c.symbol) }),
      '<span class="w-acts">' + linkBtn(t("Edit"), ' data-act="edit" data-name="' + e + '" data-k="edit:' + e + '"') +
      (inUse ? "" : trashBtn(t("Delete {name}", { name: c.name }), ' data-act="delete" data-name="' + e + '" data-k="delete:' + e + '"')) + "</span>");
  });
  if (list.length > SHOWN) rows.push('<div class="w-gmore">' + linkBtn(showAll ? t("Show fewer") : t("Show all {n} currencies", { n: num(list.length) }), ' data-act="more" data-k="more"') + "</div>");
  rows.push(giButton(ico("plus"), t("Add a currency"), t("Code and symbol, for example SEK and kr"), ' data-act="add" data-k="add"'));
  paint(box, main + group(t("Your currencies"), rows, t("{n} in the list", { n: num(list.length) })));
}

async function onChange(ev) {
  if (ev.target.id !== "cur-sel") return;
  const name = ev.target.value;
  try {
    await PUT("/currency/" + encodeURIComponent(name));
    await reloadCurrency();
    refresh({ currency: true });
    toast(t("Amounts are shown in {name} now", { name }));
  } catch (e) { errorToast(e); }
}

async function onClick(ev) {
  const pos = ev.target.closest("#cur-pos [data-v]");
  if (pos) return setPosition(pos.dataset.v);
  const b = ev.target.closest("[data-act]");
  if (!b) return;
  const name = b.dataset.name;
  if (b.dataset.act === "more") { showAll = !showAll; return render(); }
  if (b.dataset.act === "add") return edit(null);
  if (b.dataset.act === "edit") return edit((state.currency.currencies || []).find((c) => c.name === name));
  if (b.dataset.act === "delete") return remove(name);
}

async function setPosition(position) {
  if (position === state.currency.position) return;
  try {
    await PUT("/currency/position/" + position);
    state.currency.position = position;
    refresh({ currency: true });
  } catch (e) { errorToast(e); }
}

function edit(c) {
  openDialog({
    title: c ? t("Edit {name}", { name: esc(c.name) }) : t("Add a currency"),
    body: '<div class="w-sfields2">' + field(t("Code"), textInput("cu-name", c ? c.name : "", ' maxlength="8" placeholder="SEK" autocapitalize="characters"')) +
      field(t("Symbol"), textInput("cu-sym", c ? c.symbol : "", ' maxlength="6" placeholder="kr"')) + "</div>",
    ok: c ? t("Save") : t("Add currency"),
    onOk: async (root) => {
      const name = val(root, "cu-name").toUpperCase();
      const symbol = val(root, "cu-sym");
      if (!name || !symbol) throw new Error(t("Type a code and a symbol."));
      if (c) await PUT("/currency/" + encodeURIComponent(c.name) + "/update", { name, symbol });
      else await POST("/currency", { name, symbol });
      await reloadCurrency();
      refresh({ currency: true });
      toast(c ? t("Saved {name}", { name }) : t("Added {name}", { name }));
    },
  });
}

async function remove(name) {
  const c = (state.currency.currencies || []).find((x) => x.name === name);
  if (!c) return;
  try {
    await DEL("/currency/" + encodeURIComponent(name));
    await reloadCurrency();
    refresh({ currency: true });
    toast(t("Deleted {name}", { name }), async () => { await POST("/currency", { name: c.name, symbol: c.symbol }); await reloadCurrency(); refresh({ currency: true }); });
  } catch (e) { errorToast(e); }
}
