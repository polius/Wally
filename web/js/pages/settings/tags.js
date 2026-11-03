/* Settings › Tags: a list that opens each tag's page (name, its transactions, merge, make it a person, delete).
   Edit puts a delete button on each row. */
import { t, tn, esc, state, f, GET, POST, PUT, DEL, icon, person, reloadLedger, av } from "../../core.js";
import { openDialog, toast, errorToast, empty } from "../../ui.js";
import { refresh } from "../../shell.js";
import { gl, gr, addRow, hero, check, minus, fieldRow, nameGate, phone, toggle, val, paint } from "./common.js";
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
    body: fieldRow("tag-new", "", t("Name, like holiday"), ' maxlength="40" autofocus') + '<p class="w-glf" id="tag-new-note" aria-live="polite">' + t("Tags cut across categories: a holiday has food, travel and shopping.") + "</p>",
    ok: t("Add"),
    onOpen: (root) => nameGate(root, "tag-new", (n) => { const g = clean(n); return !g ? t("Type a name first") : state.tags.includes(g) ? esc(t("#{name} is already a tag", { name: g })) : ""; }),
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

/* Another tag's name is refused, as for categories: Merge is the way to put two tags together */
function rename(name) {
  const n = state.tx.filter((tx) => tx.tags.includes("#" + name)).length;
  openDialog({
    kind: "sheet",
    title: t("Rename #{name}", { name: esc(name) }),
    body: '<div class="w-gl"><label class="w-gr"><span class="w-hash">#</span><input id="tr-name" value="' + esc(name) + '" aria-label="' + esc(t("Name")) + '" maxlength="40" autocomplete="off"></label></div>' +
      '<p class="w-glf" id="tr-name-note" aria-live="polite">' + (n ? tn(n, "Its {n} transaction gets the new name.", "Its {n} transactions get the new name.") : "") + "</p>",
    ok: t("Done"),
    onOpen: (root) => {
      root.classList.add("w-sh420");
      root.querySelector("#tr-name").select();
      nameGate(root, "tr-name", (n) => { const to = clean(n); return !to ? t("Type a name first") : to !== name && state.tags.includes(to) ? esc(t("#{name} is already a tag. Merge this one into it instead.", { name: to })) : ""; });
    },
    onOk: async (root) => {
      const to = clean(root.querySelector("#tr-name").value);
      if (!to) throw new Error(t("Type a name first"));
      if (to === name) return;
      if (state.tags.includes(to)) throw new Error(t("#{name} is already a tag. Merge this one into it instead.", { name: esc(to) }));
      await PUT("/tags/" + encodeURIComponent(name), { name: to });
      moveLocally(name, to);
      const here = sub === name;
      if (here) sub = to;   // its page follows the new name
      await reloadTags();
      refresh({ tags: true });
      toast(t("Renamed #{from} to #{to}", { from: name, to }));
      if (here) replaceSub(encodeURIComponent(to));
    },
  });
}

/* Merge: tick the tag its transactions get instead */
function merge(name) {
  const others = state.tags.filter((x) => x !== name);
  let pick = others[0];
  const n = state.tx.filter((tx) => tx.tags.includes("#" + name)).length;
  // The header says what happens, with the number, and follows the tag picked
  const what = () => n ? tn(n, "Its {n} transaction gets #{to} instead.", "Its {n} transactions get #{to} instead.", { to: esc(pick) }) : t("No transactions use it.");
  openDialog({
    kind: "sheet",
    title: t("Merge #{name}", { name: esc(name) }),
    top: tagIco() + '<b class="w-shtitle w-sht20">#' + esc(name) + '</b><p id="tm-what" aria-live="polite">' + what() + "</p>",
    body: '<div class="w-glh">' + t("Merge into") + '</div><div class="w-gl" role="radiogroup" aria-label="' + esc(t("Merge into")) + '">' +
      others.map((x) => '<button type="button" class="w-gr" role="radio" data-to="' + esc(x) + '" aria-checked="' + (x === pick) + '"><span class="k">#' + esc(x) + "</span>" + check(x === pick) + "</button>").join("") + "</div>" +
      '<p class="w-glf">' + t("Then #{name} goes away. A merge can’t be undone.", { name: esc(name) }) + "</p>",
    ok: t("Merge"),
    onOpen(root) {
      root.classList.add("w-sh420");
      root.addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-to]");
        if (!b) return;
        pick = b.dataset.to;
        root.querySelectorAll("[data-to]").forEach((x) => { const on = x === b; x.setAttribute("aria-checked", String(on)); x.querySelector(".w-gck").outerHTML = check(on); });
        root.querySelector("#tm-what").innerHTML = what();
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
    ok: phone() ? t("Delete #{name}", { name: esc(name) }) : t("Delete"),
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

/* Make this a person: every transaction with the tag becomes one person's own. The header says how many, and whose. */
function fromTag(tag) {
  const owner = state.people.find((p) => p.name.toLocaleLowerCase() === tag.toLocaleLowerCase()) || person(state.me) || state.people[0];
  let who = String(owner.id), count = state.tx.filter((tx) => tx.tags.includes("#" + tag)).length;
  const people = state.people.map((p) => '<button type="button" class="w-gr" role="radio" data-who="' + p.id + '" aria-checked="' + (String(p.id) === who) + '">' + av(String(p.id), "w-av26") + '<span class="k">' + esc(p.name) + "</span>" + check(String(p.id) === who) + "</button>").join("");
  const what = () => count ? tn(count, "Its {n} transaction becomes {name}’s own, no longer shared.", "Its {n} transactions become {name}’s own, no longer shared.", { name: esc((person(who) || {}).name || "") })
    : t("No transactions have #{tag}.", { tag: esc(tag) });
  openDialog({
    kind: "sheet",
    title: t("Make #{tag} a Person", { tag: esc(tag) }),
    top: tagIco() + '<b class="w-shtitle w-sht20">#' + esc(tag) + '</b><p id="ft-what" aria-live="polite">' + what() + "</p>",
    body: '<div class="w-glh">' + t("Person") + '</div><div class="w-gl" role="radiogroup" aria-label="' + esc(t("Person")) + '">' + people + "</div>" +
      '<div class="w-gl"><div class="w-gr"><span class="k">' + t("Remove the tag afterwards") + "</span>" + toggle("ft-remove", true, t("Remove the tag afterwards")) + "</div></div>",
    ok: t("Make"),
    onOpen: (root) => {
      root.classList.add("w-sh440");
      const ok = root.querySelector("[data-dlg-ok]");
      const show = () => { root.querySelector("#ft-what").innerHTML = what(); ok.disabled = !count; };
      root.addEventListener("click", (ev) => {
        const sw = ev.target.closest("#ft-remove");
        if (sw) { sw.setAttribute("aria-checked", String(sw.getAttribute("aria-checked") !== "true")); return; }
        const b = ev.target.closest("[data-who]");
        if (!b) return;
        who = b.dataset.who;
        root.querySelectorAll("[data-who]").forEach((x) => { const on = x === b; x.setAttribute("aria-checked", String(on)); x.querySelector(".w-gck").outerHTML = check(on); });
        show();
      });
      show();
      // The server's count is the one that moves
      GET("/people/from-tag/preview?tag=" + encodeURIComponent(tag)).then((r) => { count = r.count; if (root.isConnected) show(); }).catch(() => { /* the local count stands */ });
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
