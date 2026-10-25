/* Settings › Tags: counts, add, rename, merge (renaming into a tag that exists) and delete. */
import { t, tn, esc, state, f, GET, POST, PUT, DEL, icon } from "../../core.js";
import { openDialog, toast, errorToast } from "../../ui.js";
import { refresh } from "../../shell.js";
import { group, gi, ico, linkBtn, trashBtn, field, textInput, val, paint } from "./common.js";
import { empty } from "../../ui.js";

let box = null;

export function mount(el) {
  box = el;
  box.addEventListener("click", onClick);
  box.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && ev.target.id === "tag-new") { ev.preventDefault(); addTag(); } });
  render();
}
export function update() { if (box) render(); }
export function unmount() { box = null; }

/* Tag names without "#", with their transactions' count and total */
function stats() {
  const out = {};
  state.tags.forEach((g) => { out[g] = { n: 0, v: 0 }; });
  for (const tx of state.tx) for (const g of tx.tags) { const k = g.slice(1); const s = out[k] || (out[k] = { n: 0, v: 0 }); s.n++; s.v += tx.a; }
  return out;
}
const clean = (s) => s.trim().replace(/^#+/, "").replace(/\s+/g, "-");

function render() {
  const s = stats();
  const names = Object.keys(s).sort((a, b) => s[b].n - s[a].n || a.localeCompare(b));
  const addRow = '<div class="w-gi w-gadd"><span class="w-ico">' + icon("plus") + '</span><div class="w-inline"><input class="w-mini w-addin" id="tag-new" placeholder="' + esc(t("New tag, like #holiday")) +
    '" aria-label="' + esc(t("New tag")) + '" maxlength="40" autocomplete="off"></div><button type="button" class="w-btn ghost" data-act="add" data-k="add">' + t("Add") + "</button></div>";
  const rows = names.map((g) => {
    const e = esc(g);
    return gi(ico("tag"), "#" + e, s[g].n ? tn(s[g].n, "{n} transaction, {total} in total", "{n} transactions, {total} in total", { total: '<span class="amt">' + f(s[g].v) + "</span>" }) : t("Not used yet"),
      '<span class="w-acts">' + linkBtn(t("Rename"), ' data-act="rename" data-name="' + e + '" data-k="rename:' + e + '"') +
      (names.length > 1 ? linkBtn(t("Merge"), ' data-act="merge" data-name="' + e + '" data-k="merge:' + e + '"') : "") +
      trashBtn(t("Delete #{name}", { name: g }), ' data-act="delete" data-name="' + e + '" data-k="delete:' + e + '"') + "</span>");
  });
  paint(box,
    group(t("Tags"), (names.length ? rows : [empty("tag", t("No tags yet"), t("Add #tags to transactions to follow things that cut across categories, like a holiday."))]).concat([addRow]), t("Deleting a tag removes it from its transactions, never the transactions")) +
    '<p class="w-note2">' + t("Tags cut across categories: a holiday has food, travel and shopping. The dashboard’s Categories widget can switch to Tags.") + "</p>");
}

async function onClick(ev) {
  const b = ev.target.closest("[data-act]");
  if (!b) return;
  const name = b.dataset.name;
  if (b.dataset.act === "add") return addTag();
  if (b.dataset.act === "rename") return rename(name, false);
  if (b.dataset.act === "merge") return rename(name, true);
  if (b.dataset.act === "delete") return remove(name);
}

async function reloadTags() { state.tags = await GET("/tags"); }

async function addTag() {
  const input = box.querySelector("#tag-new");
  const name = clean(input.value);
  if (!name) { toast(t("Type a name first")); input.focus(); return; }
  if (state.tags.includes(name)) { toast(t("#{name} is already a tag", { name })); input.select(); return; }
  try {
    await POST("/tags", { name });
    await reloadTags();
    refresh({ tags: true });
    toast(t("Added #{name}", { name }));
    const again = box && box.querySelector("#tag-new");
    if (again) again.focus();
  } catch (e) { errorToast(e); }
}

/* Renaming into an existing tag merges them: every transaction keeps one of the two */
function rename(name, merge) {
  const others = state.tags.filter((g) => g !== name);
  openDialog({
    title: merge ? t("Merge #{name} into another tag", { name: esc(name) }) : t("Rename #{name}", { name: esc(name) }),
    body: merge
      ? "<p>" + t("Its transactions get the other tag instead, and #{name} goes away.", { name: esc(name) }) + "</p>" +
        field(t("Merge into"), '<select class="w-mini w-sselect" id="tr-name">' + others.map((g) => '<option value="' + esc(g) + '">#' + esc(g) + "</option>").join("") + "</select>")
      : field(t("Name"), textInput("tr-name", name, ' maxlength="40"')) + '<p class="w-hint" id="tr-hint" aria-live="polite"></p>',
    ok: merge ? t("Merge") : t("Rename"),
    onOpen: (root) => {
      const input = root.querySelector("#tr-name");
      if (merge) return;
      input.select();
      // Typing the name of a tag that exists turns the rename into a merge, and says so
      input.addEventListener("input", () => {
        const to = clean(input.value);
        const clash = to !== name && state.tags.includes(to);
        root.querySelector("#tr-hint").textContent = clash ? t("#{name} already exists. The two are merged.", { name: to }) : "";
        root.querySelector("[data-dlg-ok]").textContent = clash ? t("Merge") : t("Rename");
      });
    },
    onOk: async (root) => {
      const to = clean(root.querySelector("#tr-name").value);
      if (!to) throw new Error(t("Type a name first"));
      if (to === name) return;
      const merging = state.tags.includes(to);
      await PUT("/tags/" + encodeURIComponent(name), { name: to });
      state.tx.forEach((tx) => { if (tx.tags.includes("#" + name)) tx.tags = [...new Set(tx.tags.map((g) => (g === "#" + name ? "#" + to : g)))]; });
      state.rules.forEach((r) => { if (r.tags.includes("#" + name)) r.tags = [...new Set(r.tags.map((g) => (g === "#" + name ? "#" + to : g)))]; });
      await reloadTags();
      refresh({ tags: true });
      toast(merging ? t("Merged #{from} into #{to}", { from: name, to }) : t("Renamed #{from} to #{to}", { from: name, to }));
    },
  });
}

function remove(name) {
  const n = state.tx.filter((tx) => tx.tags.includes("#" + name)).length;
  openDialog({
    title: t("Delete #{name}?", { name: esc(name) }),
    body: "<p>" + (n ? tn(n, "It is removed from {n} transaction. The transaction stays.", "It is removed from {n} transactions. The transactions stay.") : t("No transactions use it.")) + "</p>",
    ok: t("Delete tag"),
    danger: true,
    onOk: async () => {
      await DEL("/tags/" + encodeURIComponent(name));
      state.tx.forEach((tx) => { tx.tags = tx.tags.filter((g) => g !== "#" + name); });
      state.rules.forEach((r) => { r.tags = r.tags.filter((g) => g !== "#" + name); });
      await reloadTags();
      refresh({ tags: true });
      toast(t("Deleted #{name}", { name }));
    },
  });
}
