/* Settings › Rules: import rules that fill in category and person from a payee's name. */
import { t, tn, esc, state, GET, POST, PUT, DEL, tile, pname, icon, expCats } from "../../core.js";
import { openDialog, toast, errorToast, empty } from "../../ui.js";
import { refresh } from "../../shell.js";
import { group, gi, ico, linkBtn, iconBtn, trashBtn, toggle, field, textInput, val, paint } from "./common.js";

let box = null;

export function mount(el) {
  box = el;
  box.addEventListener("click", onClick);
  box.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && ev.target.id === "rule-m") { ev.preventDefault(); add(); } });
  render();
  // Rules come with the extras; fetch them if they are not here yet
  if (!state.irules || !state.irules.length) reload().then(() => box && render()).catch(() => { /* the list stays as it is */ });
}
export function update() { if (box) render(); }
export function unmount() { box = null; }

async function reload() { state.irules = await GET("/rules"); }

/* "Shared", a person, or "keeps the person" */
function whoText(r) { return !r.set_person ? t("keeps the person") : r.person_id === null ? t("Shared") : esc(pname(r.person_id)); }
function whoOptions(sel) {
  const opts = [["keep", t("Keep the person")]].concat(state.people.length >= 2 ? [["shared", t("Shared")]] : []).concat(state.people.map((p) => [String(p.id), esc(p.name)]));
  return opts.map(([v, l]) => '<option value="' + v + '"' + (v === sel ? " selected" : "") + ">" + l + "</option>").join("");
}
function whoValue(r) { return !r.set_person ? "keep" : r.person_id === null ? "shared" : String(r.person_id); }
function whoBody(v) { return { set_person: v !== "keep", person_id: v === "keep" || v === "shared" ? null : Number(v) }; }
function catOptions(sel) {
  const list = state.categories.slice();
  if (sel && !list.includes(sel)) list.unshift(sel);
  const first = sel || expCats()[0];
  return list.map((c) => '<option value="' + esc(c) + '"' + (c === first ? " selected" : "") + ">" + esc(c) + "</option>").join("");
}

function render() {
  const rules = state.irules || [];
  const rows = rules.map((r, i) => {
    const sub = t("Sets {category}, {who}", { category: esc(r.category), who: whoText(r) }) + " · " + tn(r.uses, "used {n} time", "used {n} times");
    return gi(tile(r.category), t("Name contains {text}", { text: "<code>" + esc(r.match) + "</code>" }) + (r.learned ? ' <span class="w-badge">' + t("Learned from your edits") + "</span>" : ""), sub,
      '<span class="w-acts">' +
      (rules.length > 1 ? iconBtn("arrowup", t("Move up"), ' data-act="up" data-id="' + r.id + '" data-k="up:' + r.id + '"' + (i === 0 ? " disabled" : "")) +
        iconBtn("arrowdown", t("Move down"), ' data-act="down" data-id="' + r.id + '" data-k="down:' + r.id + '"' + (i === rules.length - 1 ? " disabled" : "")) : "") +
      linkBtn(t("Edit"), ' data-act="edit" data-id="' + r.id + '" data-k="edit:' + r.id + '"') +
      trashBtn(t("Delete the rule for {text}", { text: r.match }), ' data-act="delete" data-id="' + r.id + '" data-k="delete:' + r.id + '"') + "</span>");
  });
  const addRow = '<div class="w-gi w-gadd"><span class="w-ico">' + icon("plus") + '</span><div class="w-inline">' +
    '<input class="w-mini w-addin" id="rule-m" placeholder="' + esc(t("Name contains…")) + '" aria-label="' + esc(t("Name contains")) + '" maxlength="80" autocomplete="off">' +
    '<select class="w-mini" id="rule-c" aria-label="' + esc(t("Category")) + '">' + catOptions("") + "</select>" +
    '<select class="w-mini" id="rule-p" aria-label="' + esc(t("Whose")) + '">' + whoOptions(state.people.length >= 2 ? "shared" : "keep") + "</select></div>" +
    '<button type="button" class="w-btn ghost" data-act="add" data-k="add">' + t("Add rule") + "</button></div>";
  paint(box,
    '<div class="w-explain"><p><b class="w-sstrong">' + t("Rules fill in category and person for you.") + "</b> " +
    t("They run on imports and when you type a name in the add sheet. When you fix a category by hand, Wally offers to make a rule from it.") + "</p></div>" +
    group(t("Rules"), (rows.length ? rows : [empty("split", t("No rules yet"), t("Add one below, or let Wally offer one when you fix a category twice."))]).concat([addRow]), t("Checked from top to bottom")) +
    group(t("Learning"), [gi(ico("repeat"), t("Offer a rule when I fix a category"), t("After the same fix twice, Wally asks before creating anything"),
      toggle("learn-toggle", state.config.learn_rules, t("Offer a rule when I fix a category")))]));
}

async function onClick(ev) {
  if (ev.target.closest("#learn-toggle")) return learn();
  const b = ev.target.closest("[data-act]");
  if (!b || b.disabled) return;
  const id = Number(b.dataset.id);
  switch (b.dataset.act) {
    case "add": return add();
    case "edit": return edit(id);
    case "delete": return remove(id);
    case "up": case "down": return move(id, b.dataset.act === "up" ? -1 : 1);
  }
}

async function learn() {
  const on = !state.config.learn_rules;
  try {
    state.config = await PUT("/config", { learn_rules: on });
    refresh({ config: true });
    toast(on ? t("Wally offers a rule after the same fix twice") : t("Wally won’t offer rules"));
  } catch (e) { errorToast(e); }
}

async function add() {
  const input = box.querySelector("#rule-m");
  const match = input.value.trim();
  if (!match) { toast(t("Type part of the name first")); input.focus(); return; }
  try {
    await POST("/rules", { match, category: box.querySelector("#rule-c").value, ...whoBody(box.querySelector("#rule-p").value) });
    await reload();
    refresh({ rules: true });
    toast(t("Rule added. It applies to new entries and imports."));
    const again = box && box.querySelector("#rule-m");
    if (again) again.focus();
  } catch (e) { errorToast(e); }
}

function edit(id) {
  const r = state.irules.find((x) => x.id === id);
  if (!r) return;
  openDialog({
    title: t("Edit rule"),
    body: field(t("Name contains"), textInput("re-m", r.match, ' maxlength="80"')) +
      '<div class="w-sfields2">' + field(t("Category"), '<select class="w-mini w-sselect" id="re-c">' + catOptions(r.category) + "</select>") +
      field(t("Whose"), '<select class="w-mini w-sselect" id="re-p">' + whoOptions(whoValue(r)) + "</select>") + "</div>",
    ok: t("Save rule"),
    onOk: async (root) => {
      const match = val(root, "re-m");
      if (!match) throw new Error(t("Type part of the name first"));
      await PUT("/rules/" + id, { match, category: root.querySelector("#re-c").value, ...whoBody(root.querySelector("#re-p").value) });
      await reload();
      refresh({ rules: true });
      toast(t("Rule saved"));
    },
  });
}

async function remove(id) {
  const rules = state.irules;
  const i = rules.findIndex((x) => x.id === id);
  if (i < 0) return;
  const gone = rules[i];
  try {
    await DEL("/rules/" + id);
    await reload();
    refresh({ rules: true });
    // Undo puts it back where it was
    toast(t("Deleted the rule for {text}", { text: gone.match }), async () => {
      const back = await POST("/rules", { match: gone.match, category: gone.category, person_id: gone.person_id, set_person: gone.set_person });
      const ids = state.irules.map((x) => x.id);
      ids.splice(i, 0, back.id);
      state.irules = await PUT("/rules/order", ids);
      refresh({ rules: true });
    });
  } catch (e) { errorToast(e); }
}

async function move(id, step) {
  const ids = state.irules.map((x) => x.id);
  const i = ids.indexOf(id), j = i + step;
  if (j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  try {
    state.irules = await PUT("/rules/order", ids);
    refresh({ rules: true });
  } catch (e) { errorToast(e); }
}
