/* Settings › Categories: each one's color, counts, add, rename, and delete that asks where transactions go. */
import { t, tn, esc, state, f0, PUT, POST, DEL, GET, rerank, cat, cc, tile, isIncomeCat, monthsIn, START, TODAY, icon, LANG, reloadCategories } from "../../core.js";
import { openDialog, closeDialog, toast, errorToast } from "../../ui.js";
import { refresh } from "../../shell.js";
import { group, gi, linkBtn, trashBtn, field, textInput, val, paint } from "./common.js";

let box = null;

export function mount(el) {
  box = el;
  box.addEventListener("click", onClick);
  box.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && ev.target.id === "cat-new") { ev.preventDefault(); addCategory(); } });
  render();
}
export function update() { if (box) render(); }
export function unmount() { box = null; }

function stats() {
  const out = {};
  for (const tx of state.tx) { const s = out[tx.c] || (out[tx.c] = { n: 0, v: 0 }); s.n++; s.v += tx.a; }
  return out;
}
const COLOR_NAMES = () => [t("Red"), t("Orange"), t("Yellow"), t("Green"), t("Cyan"), t("Blue"), t("Violet"), t("Pink"), t("Grey")];
function render() {
  const ranked = rerank(START, TODAY, "all");
  const s = stats();
  const months = Math.max(1, monthsIn(START, TODAY).length);
  const income = state.categories.filter((c) => isIncomeCat(c));
  const row = (k, income) => {
    const st = s[k] || { n: 0, v: 0 };
    const sub = st.n ? tn(st.n, "{n} transaction, about {avg} a month", "{n} transactions, about {avg} a month", { avg: '<span class="amt">' + f0(st.v / months) + "</span>" }) : t("No transactions yet");
    const name = esc(k), c = cat(k).c;
    return gi(tile(k), name, sub, '<span class="w-acts">' +
      (income ? "" : '<button type="button" class="w-swb" data-act="color" data-name="' + name + '" data-k="color:' + name + '" aria-label="' + esc(t("Color of {name}: {color}", { name: k, color: COLOR_NAMES()[(c >= 1 && c <= 9 ? c : 9) - 1] })) + '"><i style="background:' + cc(k) + '"></i></button>') +
      linkBtn(t("Rename"), ' data-act="rename" data-name="' + name + '" data-k="rename:' + name + '"') +
      trashBtn(t("Delete {name}", { name: k }), ' data-act="delete" data-name="' + name + '" data-k="delete:' + name + '"') + "</span>");
  };
  const addRow = '<div class="w-gi w-gadd">' + '<span class="w-ico">' + icon("plus") + '</span><div class="w-inline"><input class="w-mini w-addin" id="cat-new" placeholder="' + esc(t("New category name")) +
    '" aria-label="' + esc(t("New category name")) + '" maxlength="40" autocomplete="off"><span class="w-hint">' + t("Icon is picked from the name") + "</span></div>" +
    '<button type="button" class="w-btn ghost" data-act="add" data-k="add">' + t("Add") + "</button></div>";

  paint(box,
    group(t("Expense categories"), ranked.map((k) => row(k, false)).concat([addRow]), t("Biggest spender first. Each keeps its color.")) +
    (income.length ? group(t("Income"), income.map((k) => row(k, true)), t("Salaries, freelance and refunds. Always green.")) : ""));
}

async function onClick(ev) {
  const b = ev.target.closest("[data-act]");
  if (!b) return;
  if (b.dataset.act === "add") return addCategory();
  if (b.dataset.act === "rename") return rename(b.dataset.name);
  if (b.dataset.act === "delete") return remove(b.dataset.name);
  if (b.dataset.act === "color") return pickColor(b.dataset.name);
}

/* Eight colors to choose from; the one in use is ringed */
function pickColor(name) {
  const now = cat(name).c;
  openDialog({
    title: t("Color for {name}", { name: esc(name) }),
    body: '<div class="w-swpick" role="radiogroup" aria-label="' + esc(t("Color")) + '">' + COLOR_NAMES().map((label, i) =>
      '<button type="button" role="radio" data-c="' + (i + 1) + '" aria-checked="' + (now === i + 1) + '" aria-label="' + esc(label) + '" title="' + esc(label) + '"><i style="background:var(--c' + (i + 1) + ')"></i></button>').join("") + "</div>",
    onOpen(root) {
      const on = root.querySelector('[aria-checked="true"]') || root.querySelector("[data-c]");
      on.focus();
      root.addEventListener("click", async (ev) => {
        const b = ev.target.closest("[data-c]");
        if (!b) return;
        try {
          await PUT("/categories/" + encodeURIComponent(name), { color: +b.dataset.c });
          await reloadCategories();
          closeDialog();
          refresh({ categories: true });
        } catch (e) { errorToast(e); }
      });
    },
  });
}

async function addCategory() {
  const input = box.querySelector("#cat-new");
  const name = input.value.trim();
  if (!name) { toast(t("Type a name first")); input.focus(); return; }
  if (state.categories.some((c) => c.toLocaleLowerCase() === name.toLocaleLowerCase())) { toast(t("{name} is already a category", { name })); input.select(); return; }
  try {
    await POST("/categories", { name });
    await reloadCategories();
    refresh({ categories: true });
    toast(t("Added {name}", { name }));
    const again = box && box.querySelector("#cat-new");
    if (again) again.focus();
  } catch (e) { errorToast(e); }
}

/* Every transaction, recurring rule and import rule that used a category now uses another name */
function renameLocally(from, to) {
  state.tx.forEach((tx) => { if (tx.c === from) tx.c = to; });
  state.rules.forEach((r) => { if (r.c === from) r.c = to; });
  (state.irules || []).forEach((r) => { if (r.category === from) r.category = to; });
}

function rename(name) {
  openDialog({
    title: t("Rename {name}", { name: esc(name) }),
    body: "<p>" + t("Every transaction and rule in it moves with it.") + "</p>" + field(t("Name"), textInput("cr-name", name, ' maxlength="40"')),
    ok: t("Rename"),
    onOpen: (root) => root.querySelector("#cr-name").select(),
    onOk: async (root) => {
      const to = val(root, "cr-name");
      if (!to) throw new Error(t("Type a name first"));
      if (to === name) return;
      if (state.categories.some((c) => c !== name && c.toLocaleLowerCase() === to.toLocaleLowerCase())) throw new Error(t("{name} is already a category. Delete this one instead, and move its transactions there.", { name: esc(to) }));
      await PUT("/categories/" + encodeURIComponent(name), { name: to });
      renameLocally(name, to);
      await reloadCategories();
      refresh({ categories: true });
      toast(t("Renamed {from} to {to}", { from: name, to }));
    },
  });
}

async function remove(name) {
  let usage;
  try { usage = await GET("/categories/" + encodeURIComponent(name) + "/usage"); } catch (e) { return errorToast(e); }
  if (!usage.transactions && !usage.recurring) {
    // Nothing uses it: delete straight away, with Undo
    try {
      await DEL("/categories/" + encodeURIComponent(name));
      await reloadCategories();
      refresh({ categories: true });
      toast(t("Deleted {name}", { name }), async () => { await POST("/categories", { name }); await reloadCategories(); refresh({ categories: true }); });
    } catch (e) { errorToast(e); }
    return;
  }
  const others = state.categories.filter((c) => c !== name);
  const income = isIncomeCat(name);
  // Suggest a category of the same kind: Miscellaneous for spending, another income category for income
  const same = others.filter((c) => isIncomeCat(c) === income);
  const pick = same.find((c) => cat(c).i === "misc") || same[0] || others[0];
  const used = [];
  if (usage.transactions) used.push(tn(usage.transactions, "{n} transaction", "{n} transactions"));
  if (usage.recurring) used.push(tn(usage.recurring, "{n} recurring rule", "{n} recurring rules"));
  openDialog({
    title: t("Delete {name}?", { name: esc(name) }),
    body: "<p>" + t("{list} use {name}. Move them to:", { list: new Intl.ListFormat(LANG, { type: "conjunction" }).format(used), name: esc(name) }) + "</p>" +
      '<select class="w-mini w-sselect" id="cd-to" aria-label="' + esc(t("Move to")) + '">' + others.map((c) => '<option value="' + esc(c) + '"' + (c === pick ? " selected" : "") + ">" + esc(c) + "</option>").join("") + "</select>",
    ok: t("Delete and move"),
    danger: true,
    onOk: async (root) => {
      const to = root.querySelector("#cd-to").value;
      if (!to) throw new Error(t("Pick where to move them."));
      await DEL("/categories/" + encodeURIComponent(name) + "?move_to=" + encodeURIComponent(to));
      renameLocally(name, to);
      await reloadCategories();
      refresh({ categories: true, data: true });
      toast(tn(usage.transactions, "Deleted {name}. {n} transaction moved to {to}.", "Deleted {name}. {n} transactions moved to {to}.", { name, to }));
    },
  });
}
