/* Settings › Categories: colors by rank, counts, add, rename, and delete that asks where transactions go. */
import { t, tn, esc, state, f0, num, GET, POST, PUT, DEL, rerank, byCat, cat, cc, tile, isIncomeCat, monthsIn, START, TODAY, icon, LANG } from "../../core.js";
import { openDialog, toast, errorToast } from "../../ui.js";
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
function render() {
  const monthStart = TODAY.slice(0, 8) + "01";
  const ranked = rerank(monthStart, TODAY, "all");
  const spent = byCat(monthStart, TODAY, "all");
  const s = stats();
  const months = Math.max(1, monthsIn(START, TODAY).length);
  const income = state.categories.filter((c) => isIncomeCat(c));
  const row = (k, rank) => {
    const st = s[k] || { n: 0, v: 0 };
    const sub = st.n ? tn(st.n, "{n} transaction, about {avg} a month", "{n} transactions, about {avg} a month", { avg: '<span class="amt">' + f0(st.v / months) + "</span>" }) : t("No transactions yet");
    const name = esc(k);
    return gi(tile(k), name, sub, '<span class="w-acts">' +
      (rank ? '<span class="w-rank" title="' + esc(t("Rank this month")) + '"><i style="background:' + cc(k) + '"></i>#' + num(rank) + "</span>" : "") +
      linkBtn(t("Rename"), ' data-act="rename" data-name="' + name + '" data-k="rename:' + name + '"') +
      trashBtn(t("Delete {name}", { name: k }), ' data-act="delete" data-name="' + name + '" data-k="delete:' + name + '"') + "</span>");
  };
  const ramp = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((c) => '<span style="background:var(--c' + c + ')"><i>' + (c < 9 ? num(c) : num(9) + "+") + "</i></span>").join("");
  const addRow = '<div class="w-gi w-gadd">' + '<span class="w-ico">' + icon("plus") + '</span><div class="w-inline"><input class="w-mini w-addin" id="cat-new" placeholder="' + esc(t("New category name")) +
    '" aria-label="' + esc(t("New category name")) + '" maxlength="40" autocomplete="off"><span class="w-hint">' + t("Icon is picked from the name") + "</span></div>" +
    '<button type="button" class="w-btn ghost" data-act="add" data-k="add">' + t("Add") + "</button></div>";

  paint(box,
    '<div class="w-explain"><div class="w-ramp" aria-hidden="true">' + ramp + "</div><p>" +
    t("Colors follow rank. The biggest category in the range you are viewing is red, then orange, yellow, green, cyan, blue, violet and pink. The ninth and later are grey. There is nothing to pick: change the range and the colors follow.") + "</p></div>" +
    group(t("Expense categories"), ranked.map((k, i) => row(k, spent[k] ? i + 1 : 0)).concat([addRow]), t("Ranked by this month’s spending")) +
    (income.length ? group(t("Income"), income.map((k) => row(k, 0)), t("Salaries, freelance and refunds. Always green, never ranked.")) : ""));
}

async function onClick(ev) {
  const b = ev.target.closest("[data-act]");
  if (!b) return;
  if (b.dataset.act === "add") return addCategory();
  if (b.dataset.act === "rename") return rename(b.dataset.name);
  if (b.dataset.act === "delete") return remove(b.dataset.name);
}

async function reloadCategories() { state.categories = await GET("/categories"); }

async function addCategory() {
  const input = box.querySelector("#cat-new");
  const name = input.value.trim();
  if (!name) { toast(t("Type a name first")); input.focus(); return; }
  if (state.categories.some((c) => c.toLocaleLowerCase() === name.toLocaleLowerCase())) { toast(t("{name} is already a category", { name })); input.select(); return; }
  try {
    await POST("/categories", { name });
    await reloadCategories();
    refresh({ categories: true });
    toast(t("Added {name}. It takes the next color once it has spending.", { name }));
    const again = box && box.querySelector("#cat-new");
    if (again) again.focus();
  } catch (e) { errorToast(e); }
}

/* Every transaction, rule, budget and import rule that used a category now uses another name */
function renameLocally(from, to) {
  state.tx.forEach((tx) => { if (tx.c === from) tx.c = to; });
  state.rules.forEach((r) => { if (r.c === from) r.c = to; });
  (state.budgets || []).forEach((b) => { if (b.category === from) b.category = to; });
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
      '<select class="w-mini w-sselect" id="cd-to" aria-label="' + esc(t("Move to")) + '">' + others.map((c) => '<option value="' + esc(c) + '"' + (c === pick ? " selected" : "") + ">" + esc(c) + "</option>").join("") + "</select>" +
      "<p>" + t("Budgets and import rules for {name} move too.", { name: esc(name) }) + "</p>",
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
