/* Settings › Categories: a list, biggest spender first (the order that gives each its color), that opens
   each category's page (name, icon, its transactions, merge, delete). Edit puts a delete button on each row. Deleting asks where its transactions go. */
import { t, tn, esc, state, f0, PUT, POST, DEL, GET, paintColors, catRank, cat, cc, tile, isIncomeCat, catIcon, CAT_ICONS, monthsIn, START, TODAY, icon, reloadCategories } from "../../core.js";
import { openDialog, toast, errorToast } from "../../ui.js";
import { refresh } from "../../shell.js";
import { gl, gr, addRow, hero, check, minus, fieldRow, nameGate, sameName, phone, val, paint } from "./common.js";
import { setAction, openPane, replaceSub } from "../settings.js";
import { openIconPicker } from "./iconpicker.js";

let box = null;
let sub = "";          // "" for the list, or a category's name for its page
let editing = false;   // Edit: a red minus on each row

export function mount(el, s) {
  box = el;
  sub = s ? decodeURIComponent(s) : "";
  editing = false;
  box.addEventListener("click", onClick);
  render();
}
export function show(s) { sub = s ? decodeURIComponent(s) : ""; editing = false; render(); }
export function update() { if (box) render(); }
export function unmount() { box = null; }
export function meta(s) { return s ? { title: "" } : {}; }
export function onAction(act) { if (act === "edit" || act === "done") { editing = act === "edit"; render(); } }

function stats() {
  const out = {};
  for (const tx of state.tx) { const s2 = out[tx.c] || (out[tx.c] = { n: 0, v: 0 }); s2.n++; s2.v += tx.a; }
  return out;
}
function line(k, st, months) {
  return st.n ? tn(st.n, "{n} transaction · about {avg} a month", "{n} transactions · about {avg} a month", { avg: '<span class="amt">' + f0(st.v / months) + "</span>" }) : t("No transactions yet");
}
const months = () => Math.max(1, monthsIn(START, TODAY).length);
const href = (k) => "/settings/categories/" + encodeURIComponent(k);

function render() {
  if (!box) return;
  if (sub) return renderCategory();
  const s2 = stats(), m = months();
  paintColors();
  const ranked = catRank();
  const income = state.categories.filter((c) => isIncomeCat(c));
  const row = (k) => {
    const name = esc(k);
    if (editing) return gr({ lead: minus(t("Delete {name}", { name: k }), ' data-act="delete" data-name="' + name + '" data-k="del:' + name + '"') + tile(k), k: name, sub: line(k, s2[k] || { n: 0 }, m) });
    return gr({ tag: "a", href: href(k), attrs: ' data-pane="categories/' + encodeURIComponent(k) + '" data-k="cat:' + name + '"', lead: tile(k), k: name, sub: line(k, s2[k] || { n: 0 }, m), chev: true });
  };
  const rows = ranked.map(row);
  rows.push(addRow(t("Add a category"), "add", ' data-k="add"'));
  setAction('<button type="button" data-act="' + (editing ? "done" : "edit") + '"' + (editing ? ' class="on"' : "") + ">" + (editing ? t("Done") : t("Edit")) + "</button>");
  paint(box, gl(rows, t("Expenses")) + (income.length ? gl(income.map(row), t("Income")) : ""));
}

/* A category's own page: name, icon, its transactions, merging and deleting */
function renderCategory() {
  const k = sub;
  if (!state.categories.includes(k)) { openPane("categories"); return; }
  const st = stats()[k] || { n: 0, v: 0 };
  const income = isIncomeCat(k), name = esc(k);
  const first = [gr({ k: t("Name"), v: name, chev: true, act: "rename", attrs: ' data-k="rename"' }),
    gr({ k: t("Icon"), v: icon(cat(k).i), chev: true, act: "icon", attrs: ' data-k="icon"' })];
  const same = state.categories.filter((x) => x !== k && isIncomeCat(x) === income);
  const second = [gr({ tag: "a", href: "/transactions?mode=all&cat=" + encodeURIComponent(k), k: t("See its transactions"), chev: true, attrs: ' data-k="see"' })];
  if (same.length) second.push(gr({ k: t("Merge into another…"), chev: true, act: "merge", attrs: ' data-k="merge"' }));
  setAction("");
  paint(box, hero(tile(k), name, line(k, st, months())) + gl(first) + gl(second) +
    (state.categories.length > 1 ? gl([gr({ k: t("Delete category"), cls: "red", act: "delete", attrs: ' data-name="' + name + '" data-k="delete"' })]) : ""));
}

async function onClick(ev) {
  const b = ev.target.closest("[data-act]");
  if (!b) return;
  const name = b.dataset.name || sub;
  if (b.dataset.act === "add") return addCategory();
  if (b.dataset.act === "rename") return rename(name);
  if (b.dataset.act === "delete") return remove(name);
  if (b.dataset.act === "icon") return pickIcon(name);
  if (b.dataset.act === "merge") return merge(name);
}

function pickIcon(name) {
  openIconPicker({
    title: t("Icon for {name}", { name: esc(name) }), now: cat(name).i, color: cc(name), suggested: CAT_ICONS,
    save: async (pick) => {
      // The icon the name would pick is no choice at all: the category goes back to following its name
      await PUT("/categories/" + encodeURIComponent(name), { icon: pick === catIcon(name) ? "" : pick });
      await reloadCategories();
      refresh({ categories: true });
    },
  });
}

function addCategory() {
  openDialog({
    kind: "sheet",
    title: t("New Category"),
    body: fieldRow("cat-new", "", t("Name"), ' maxlength="40" autofocus') + '<p class="w-glf" id="cat-new-note" aria-live="polite">' + t("The icon is picked from the name. You can change it later.") + "</p>",
    ok: t("Add"),
    onOpen: (root) => nameGate(root, "cat-new", (n) => { const c = state.categories.find((x) => sameName(x, n)); return c ? esc(t("{name} is already a category", { name: c })) : ""; }),
    onOk: async (root) => {
      const name = val(root, "cat-new");
      if (!name) throw new Error(t("Type a name first"));
      if (state.categories.some((c) => c.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error(t("{name} is already a category", { name: esc(name) }));
      await POST("/categories", { name });
      await reloadCategories();
      refresh({ categories: true });
      toast(t("Added {name}", { name }));
    },
  });
}

/* Every transaction, recurring rule and import rule that used a category now uses another name */
function renameLocally(from, to) {
  state.tx.forEach((tx) => { if (tx.c === from) tx.c = to; });
  state.rules.forEach((r) => { if (r.c === from) r.c = to; });
  (state.irules || []).forEach((r) => { if (r.category === from) r.category = to; });
}

function rename(name) {
  openDialog({
    kind: "sheet",
    title: t("Rename {name}", { name: esc(name) }),
    body: fieldRow("cr-name", name, t("Name"), ' maxlength="40"') + '<p class="w-glf" id="cr-name-note" aria-live="polite">' + (state.icons[name] ? "" : t("The icon is picked from the name.")) + "</p>",
    ok: t("Done"),
    onOpen: (root) => {
      root.classList.add("w-sh420");
      root.querySelector("#cr-name").select();
      // Another category's name: Merge is the way to put the two together
      nameGate(root, "cr-name", (n) => { const c = state.categories.find((x) => x !== name && sameName(x, n)); return c ? esc(t("{name} is already a category. Merge this one into it instead.", { name: c })) : ""; });
    },
    onOk: async (root) => {
      const to = val(root, "cr-name");
      if (!to) throw new Error(t("Type a name first"));
      if (to === name) return;
      if (state.categories.some((c) => c !== name && c.toLocaleLowerCase() === to.toLocaleLowerCase())) throw new Error(t("{name} is already a category. Merge this one into it instead.", { name: esc(to) }));
      await PUT("/categories/" + encodeURIComponent(name), { name: to });
      renameLocally(name, to);
      const here = sub === name;
      if (here) sub = to;   // its page follows the new name
      await reloadCategories();
      refresh({ categories: true });
      toast(t("Renamed {from} to {to}", { from: name, to }));
      if (here) replaceSub(encodeURIComponent(to));
    },
  });
}

/* What happens to a category's transactions and recurring rules, said with where they go */
function moves(usage, to) {
  const v = { to: esc(to) };
  if (!usage.transactions) return usage.recurring ? tn(usage.recurring, "Its {n} recurring rule moves to {to}.", "Its {n} recurring rules move to {to}.", v) : t("No transactions use it.");
  return tn(usage.transactions, "Its {n} transaction moves to {to}.", "Its {n} transactions move to {to}.", v) +
    (usage.recurring ? " " + tn(usage.recurring, "So does its {n} recurring rule.", "So do its {n} recurring rules.") : "");
}

/* Merging is deleting with somewhere to go: every transaction and rule moves to the one picked */
async function merge(name) {
  let usage;
  try { usage = await GET("/categories/" + encodeURIComponent(name) + "/usage"); } catch (e) { return errorToast(e); }
  const income = isIncomeCat(name);
  const same = state.categories.filter((c) => c !== name && isIncomeCat(c) === income);
  let pick = same.find((c) => catIcon(c) === "misc") || same[0];
  // The header says what happens, with the numbers, and follows the category picked
  openDialog({
    kind: "sheet",
    title: t("Merge {name}", { name: esc(name) }),
    top: tile(name) + '<b class="w-shtitle w-sht20">' + esc(name) + '</b><p id="cm-what" aria-live="polite">' + moves(usage, pick) + "</p>",
    body: '<div class="w-glh">' + t("Merge into") + '</div><div class="w-gl" role="radiogroup" aria-label="' + esc(t("Merge into")) + '">' +
      same.map((c) => '<button type="button" class="w-gr" role="radio" data-to="' + esc(c) + '" aria-checked="' + (c === pick) + '">' + tile(c) + '<span class="k">' + esc(c) + "</span>" + check(c === pick) + "</button>").join("") + "</div>" +
      '<p class="w-glf">' + t("Then {name} goes away. A merge can’t be undone.", { name: esc(name) }) + "</p>",
    ok: t("Merge"),
    onOpen(root) {
      root.addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-to]");
        if (!b) return;
        pick = b.dataset.to;
        root.querySelectorAll("[data-to]").forEach((x) => { const on = x === b; x.setAttribute("aria-checked", String(on)); x.querySelector(".w-gck").outerHTML = check(on); });
        root.querySelector("#cm-what").innerHTML = moves(usage, pick);
      });
    },
    onOk: async () => {
      if (!pick) throw new Error(t("Pick where to move them."));
      await DEL("/categories/" + encodeURIComponent(name) + "?move_to=" + encodeURIComponent(pick));
      renameLocally(name, pick);
      await reloadCategories();
      refresh({ categories: true, data: true });
      toast(t("Merged {from} into {to}", { from: name, to: pick }));
      openPane("categories");
    },
  });
}

async function remove(name) {
  let usage;
  try { usage = await GET("/categories/" + encodeURIComponent(name) + "/usage"); } catch (e) { return errorToast(e); }
  const back = () => { if (sub) openPane("categories"); };
  if (!usage.transactions && !usage.recurring) {
    openDialog({
      kind: "alert", top: tile(name, 48), title: t("Delete {name}?", { name: esc(name) }), body: "<p>" + t("No transactions use it.") + "</p>",
      ok: phone() ? t("Delete {name}", { name: esc(name) }) : t("Delete"), danger: true,
      onOk: async () => {
        await DEL("/categories/" + encodeURIComponent(name));
        await reloadCategories();
        refresh({ categories: true });
        toast(t("Deleted {name}", { name }), async () => { await POST("/categories", { name }); await reloadCategories(); refresh({ categories: true }); });
        back();
      },
    });
    return;
  }
  const others = state.categories.filter((c) => c !== name);
  const income = isIncomeCat(name);
  // Suggest a category of the same kind: Miscellaneous for spending, another income category for income
  const same = others.filter((c) => isIncomeCat(c) === income);
  const pick = same.find((c) => catIcon(c) === "misc") || same[0] || others[0];
  openDialog({
    kind: "alert",
    top: tile(name, 48),
    title: t("Delete {name}?", { name: esc(name) }),
    body: '<p id="cd-what">' + moves(usage, pick) + '</p><label class="w-pop2"><span>' + t("Move them to") + '</span><select id="cd-to">' + others.map((c) => '<option value="' + esc(c) + '"' + (c === pick ? " selected" : "") + ">" + esc(c) + "</option>").join("") + "</select></label>",
    ok: phone() ? t("Delete {name}", { name: esc(name) }) : t("Delete"),
    danger: true,
    onOpen: (root) => {
      root.classList.add("w-stack", "w-hsheet");
      const sel = root.querySelector("#cd-to");
      sel.addEventListener("change", () => { root.querySelector("#cd-what").innerHTML = moves(usage, sel.value); });
      setTimeout(() => root.focus(), 0);
    },
    onOk: async (root) => {
      const to = root.querySelector("#cd-to").value;
      if (!to) throw new Error(t("Pick where to move them."));
      await DEL("/categories/" + encodeURIComponent(name) + "?move_to=" + encodeURIComponent(to));
      renameLocally(name, to);
      await reloadCategories();
      refresh({ categories: true, data: true });
      toast(tn(usage.transactions, "Deleted {name}. {n} transaction moved to {to}.", "Deleted {name}. {n} transactions moved to {to}.", { name, to }));
      back();
    },
  });
}
