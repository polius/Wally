/* Settings › Tags: a list that opens each tag's page (name, its transactions, merge, make it a person, delete).
   Edit puts a delete button on each row. */
import { t, tn, esc, state, f, GET, POST, PUT, DEL, icon, person, reloadLedger, av } from "../../core.js";
import { openDialog, toast, errorToast, empty } from "../../ui.js";
import { refresh } from "../../shell.js";
import { gl, gr, addRow, hero, check, minus, fieldRow, gate, phone, toggle, val, paint } from "./common.js";
import { setAction, openPane, replaceSub } from "../settings.js";

let box = null;
let sub = "";          // "" for the list, or a tag (without #) for its page
let editing = false;

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

/* Tag names without "#", with their transactions' count and total */
function stats() {
  const out = {};
  state.tags.forEach((g) => { out[g] = { n: 0, v: 0 }; });
  for (const tx of state.tx) for (const g of tx.tags) { const k = g.slice(1); const s2 = out[k] || (out[k] = { n: 0, v: 0 }); s2.n++; s2.v += tx.a; }
  return out;
}
const clean = (s2) => s2.trim().replace(/^#+/, "").replace(/\s+/g, "-");
const tagIco = () => '<span class="w-ico w-tagico">' + icon("tag") + "</span>";
const line = (st) => st.n ? tn(st.n, "{n} transaction · {total} in total", "{n} transactions · {total} in total", { total: '<span class="amt">' + f(st.v) + "</span>" }) : t("Not used yet");

function render() {
  if (!box) return;
  if (sub) return renderTag();
  const s2 = stats();
  const names = Object.keys(s2).sort((a, b) => s2[b].n - s2[a].n || a.localeCompare(b));
  const rows = names.map((g) => {
    const e = esc(g);
    if (editing) return gr({ lead: minus(t("Delete #{name}", { name: g }), ' data-act="delete" data-name="' + e + '" data-k="del:' + e + '"') + tagIco(), k: "#" + e, sub: line(s2[g]) });
    return gr({ tag: "a", href: "/settings/tags/" + encodeURIComponent(g), attrs: ' data-pane="tags/' + encodeURIComponent(g) + '" data-k="tag:' + e + '"', lead: tagIco(), k: "#" + e, sub: line(s2[g]), chev: true });
  });
  if (!names.length) rows.push('<div class="w-gr w-gempty">' + empty("tag", t("No tags yet"), t("Add #tags to transactions to follow things that cut across categories, like a holiday.")) + "</div>");
  if (!editing) rows.push(addRow(t("Add a tag"), "add", ' data-k="add"'));
  setAction(names.length ? '<button type="button" data-act="' + (editing ? "done" : "edit") + '"' + (editing ? ' class="on"' : "") + ">" + (editing ? t("Done") : t("Edit")) + "</button>" : "");
  paint(box, gl(rows));
}

function renderTag() {
  const g = sub;
  if (!state.tags.includes(g)) { openPane("tags"); return; }
  const st = stats()[g] || { n: 0, v: 0 };
  const e = esc(g);
  const second = [gr({ tag: "a", href: "/transactions?mode=all&q=" + encodeURIComponent("#" + g), k: t("See its transactions"), chev: true, attrs: ' data-k="see"' })];
  if (state.tags.length > 1) second.push(gr({ k: t("Merge into another tag…"), chev: true, act: "merge", attrs: ' data-k="merge"' }));
  if (state.people.length) second.push(gr({ k: t("Make this a person…"), chev: true, act: "fromtag", attrs: ' data-k="fromtag"' }));
  setAction("");
  paint(box, hero(tagIco(), "#" + e, line(st)) + gl([gr({ k: t("Name"), v: "#" + e, chev: true, act: "rename", attrs: ' data-k="rename"' })]) + gl(second) +
    gl([gr({ k: t("Delete tag"), cls: "red", act: "delete", attrs: ' data-name="' + e + '" data-k="delete"' })]));
}

async function onClick(ev) {
  const b = ev.target.closest("[data-act]");
  if (!b) return;
  const name = b.dataset.name || sub;
  if (b.dataset.act === "add") return addTag();
  if (b.dataset.act === "rename") return rename(name);
  if (b.dataset.act === "merge") return merge(name);
  if (b.dataset.act === "delete") return remove(name);
  if (b.dataset.act === "fromtag") return fromTag(name);
}

async function reloadTags() { state.tags = await GET("/tags"); }
function moveLocally(name, to) {
  state.tx.forEach((tx) => { if (tx.tags.includes("#" + name)) tx.tags = [...new Set(tx.tags.map((x) => (x === "#" + name ? "#" + to : x)))]; });
  state.rules.forEach((r) => { if (r.tags.includes("#" + name)) r.tags = [...new Set(r.tags.map((x) => (x === "#" + name ? "#" + to : x)))]; });
}

function addTag() {
  openDialog({
    kind: "sheet",
    title: t("New Tag"),
    body: fieldRow("tag-new", "", t("Name, like holiday"), ' maxlength="40" autofocus') + '<p class="w-glf">' + t("Tags cut across categories: a holiday has food, travel and shopping.") + "</p>",
    ok: t("Add"),
    onOpen: (root) => gate(root, (r) => !!clean(val(r, "tag-new"))),
    onOk: async (root) => {
      const name = clean(val(root, "tag-new"));
      if (!name) throw new Error(t("Type a name first"));
      if (state.tags.includes(name)) throw new Error(t("#{name} is already a tag", { name: esc(name) }));
      await POST("/tags", { name });
      await reloadTags();
      refresh({ tags: true });
      toast(t("Added #{name}", { name }));
    },
  });
}

/* Renaming into a tag that exists merges them, and says so */
function rename(name) {
  openDialog({
    kind: "sheet",
    title: t("Rename #{name}", { name: esc(name) }),
    body: '<div class="w-gl"><label class="w-gr"><span class="w-hash">#</span><input id="tr-name" value="' + esc(name) + '" aria-label="' + esc(t("Name")) + '" maxlength="40" autocomplete="off"></label></div><p class="w-glf" id="tr-hint" aria-live="polite"></p>',
    ok: t("Done"),
    onOpen: (root) => {
      root.classList.add("w-sh420");
      const input = root.querySelector("#tr-name");
      input.select();
      gate(root, (r) => !!clean(val(r, "tr-name")));
      input.addEventListener("input", () => {
        const to = clean(input.value);
        const clash = to !== name && state.tags.includes(to);
        root.querySelector("#tr-hint").textContent = clash ? t("#{name} already exists. The two are merged.", { name: to }) : "";
        root.querySelector("[data-dlg-ok]").textContent = clash ? t("Merge") : t("Done");
      });
    },
    onOk: async (root) => {
      const to = clean(root.querySelector("#tr-name").value);
      if (!to) throw new Error(t("Type a name first"));
      if (to === name) return;
      const merging = state.tags.includes(to);
      await PUT("/tags/" + encodeURIComponent(name), { name: to });
      moveLocally(name, to);
      const here = sub === name;
      if (here) sub = to;   // its page follows the new name
      await reloadTags();
      refresh({ tags: true });
      toast(merging ? t("Merged #{from} into #{to}", { from: name, to }) : t("Renamed #{from} to #{to}", { from: name, to }));
      if (here) replaceSub(encodeURIComponent(to));
    },
  });
}

/* Merge: tick the tag its transactions get instead */
function merge(name) {
  const others = state.tags.filter((x) => x !== name);
  let pick = others[0];
  const n = state.tx.filter((tx) => tx.tags.includes("#" + name)).length;
  openDialog({
    kind: "sheet",
    title: t("Merge #{name}", { name: esc(name) }),
    body: '<div class="w-glh">' + t("Merge into") + '</div><div class="w-gl" role="radiogroup" aria-label="' + esc(t("Merge into")) + '">' +
      others.map((x) => '<button type="button" class="w-gr" role="radio" data-to="' + esc(x) + '" aria-checked="' + (x === pick) + '"><span class="k">#' + esc(x) + "</span>" + check(x === pick) + "</button>").join("") + "</div>" +
      '<p class="w-glf">' + tn(n, "Its {n} transaction gets the tag you pick, and #{name} goes away.", "Its {n} transactions get the tag you pick, and #{name} goes away.", { name: esc(name) }) + "</p>",
    ok: t("Merge"),
    onOpen(root) {
      root.classList.add("w-sh420");
      root.addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-to]");
        if (!b) return;
        pick = b.dataset.to;
        root.querySelectorAll("[data-to]").forEach((x) => { const on = x === b; x.setAttribute("aria-checked", String(on)); x.querySelector(".w-gck").outerHTML = check(on); });
      });
    },
    onOk: async () => {
      await PUT("/tags/" + encodeURIComponent(name), { name: pick });
      moveLocally(name, pick);
      await reloadTags();
      refresh({ tags: true });
      toast(t("Merged #{from} into #{to}", { from: name, to: pick }));
      openPane("tags");
    },
  });
}

function remove(name) {
  const n = state.tx.filter((tx) => tx.tags.includes("#" + name)).length;
  openDialog({
    kind: "alert",
    top: tagIco().replace("w-tagico", "w-tagico w-tag48"),
    title: t("Delete #{name}?", { name: esc(name) }),
    body: "<p>" + (n ? tn(n, "It is removed from {n} transaction. The transaction stays.", "It is removed from {n} transactions. The transactions stay.") : t("No transactions use it.")) + "</p>",
    ok: phone() ? t("Delete Tag") : t("Delete"),
    danger: true,
    onOk: async () => {
      await DEL("/tags/" + encodeURIComponent(name));
      state.tx.forEach((tx) => { tx.tags = tx.tags.filter((x) => x !== "#" + name); });
      state.rules.forEach((r) => { r.tags = r.tags.filter((x) => x !== "#" + name); });
      await reloadTags();
      refresh({ tags: true });
      toast(t("Deleted #{name}", { name }));
      if (sub) openPane("tags");
    },
  });
}

/* Make this a person: every transaction with the tag becomes one person's own */
function fromTag(tag) {
  const owner = state.people.find((p) => p.name.toLocaleLowerCase() === tag.toLocaleLowerCase()) || person(state.me) || state.people[0];
  let who = String(owner.id), count = 0;
  const people = state.people.map((p) => '<button type="button" class="w-gr" role="radio" data-who="' + p.id + '" aria-checked="' + (String(p.id) === who) + '">' + av(String(p.id), "w-av26") + '<span class="k">' + esc(p.name) + "</span>" + check(String(p.id) === who) + "</button>").join("");
  openDialog({
    kind: "sheet",
    title: t("Make #{tag} a Person", { tag: esc(tag) }),
    body: '<p class="w-shlead2">' + t("Every transaction with #{tag} becomes that person’s own, and stops being shared.", { tag: esc(tag) }) + "</p>" +
      '<div class="w-glh">' + t("Person") + '</div><div class="w-gl" role="radiogroup" aria-label="' + esc(t("Person")) + '">' + people + "</div>" +
      '<div class="w-gl"><div class="w-gr"><span class="k">' + t("Remove the tag afterwards") + "</span>" + toggle("ft-remove", true, t("Remove the tag afterwards")) + "</div></div>" +
      '<p class="w-glf" id="ft-preview" aria-live="polite"></p>',
    ok: t("Move"),
    onOpen: (root) => {
      root.classList.add("w-sh440");
      const preview = async () => {
        const out = root.querySelector("#ft-preview");
        const p = person(who);
        try {
          const r = await GET("/people/from-tag/preview?tag=" + encodeURIComponent(tag));
          count = r.count;
          if (out.isConnected) out.innerHTML = tn(r.count, "{n} transaction has #{tag}. It becomes {name}’s.", "{n} transactions have #{tag}. They become {name}’s.", { tag: esc(tag), name: esc(p ? p.name : "") });
        } catch (e) { if (out.isConnected) out.textContent = e.message; }
      };
      root.addEventListener("click", (ev) => {
        const sw = ev.target.closest("#ft-remove");
        if (sw) { sw.setAttribute("aria-checked", String(sw.getAttribute("aria-checked") !== "true")); return; }
        const b = ev.target.closest("[data-who]");
        if (!b) return;
        who = b.dataset.who;
        root.querySelectorAll("[data-who]").forEach((x) => { const on = x === b; x.setAttribute("aria-checked", String(on)); x.querySelector(".w-gck").outerHTML = check(on); });
        preview();
      });
      preview();
    },
    onOk: async (root) => {
      if (!count) throw new Error(t("No transactions have this tag."));
      const p = person(who);
      const r = await POST("/people/" + who + "/from-tag", { tag, remove_tag: root.querySelector("#ft-remove").getAttribute("aria-checked") === "true" });
      await reloadLedger();
      state.tags = await GET("/tags");
      refresh({ data: true });
      toast(tn(r.count, "Moved {n} transaction to {name}", "Moved {n} transactions to {name}", { name: p.name }));
      if (!state.tags.includes(tag)) openPane("tags");
    },
  });
}
