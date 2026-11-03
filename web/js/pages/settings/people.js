/* Settings › People: who is in the household. Each person opens their own page (name, switch, remove);
   Edit reorders. Turning a tag into a person lives on the tag's page. */
import { t, tn, esc, state, av, num, icon, GET, POST, PUT, DEL, reloadLedger, reloadRules, couple, person, monthYear, ym, pcolor, initial } from "../../core.js";
import { openDialog, toast, errorToast } from "../../ui.js";
import { refresh } from "../../shell.js";
import { gl, gr, addRow, hero, fieldRow, gate, phone, val, paint } from "./common.js";
import { setAction, openPane } from "../settings.js";

let box = null;
let sub = "";          // "" for the list, or a person's id for their page
let editing = false;   // Edit: drag to reorder

export function mount(el, s) {
  box = el;
  sub = s || "";
  editing = false;
  box.addEventListener("click", onClick);
  box.addEventListener("pointerdown", onGrip);
  box.addEventListener("keydown", onGripKey);
  render();
}
export function show(s) { sub = s || ""; editing = false; render(); }
export function update() { if (box) render(); }
export function unmount() { box = null; }
export function onAction(act) { if (act === "edit" || act === "done") { editing = act === "edit"; render(); } }

function counts() {
  const own = {};
  let shared = 0;
  for (const tx of state.tx) { if (tx.p === null) shared++; else own[tx.p] = (own[tx.p] || 0) + 1; }
  return { own, shared };
}
function since() { const first = state.tx.length ? state.tx[state.tx.length - 1].d : null; return first ? monthYear(...ym(first)) : ""; }

function render() {
  if (!box) return;
  if (sub) return renderPerson();
  const people = state.people;
  const { own, shared } = counts();
  const when = since();
  const rows = people.map((p) => {
    const k = String(p.id);
    const line = !state.tx.length ? t("No transactions yet") : couple()
      ? tn(own[k] || 0, "{n} own · {shared} shared since {since}", "{n} own · {shared} shared since {since}", { shared: num(shared), since: when })
      : tn(own[k] || 0, "{n} transaction", "{n} transactions");
    const name = esc(p.name) + (k === state.me ? '<span class="w-badge">' + t("You") + "</span>" : "");
    if (editing) return gr({ lead: av(k, "lg"), k: name, sub: line, attrs: ' data-id="' + k + '"', right: people.length > 1 ? '<button type="button" class="w-ggrip" data-grip="' + k + '" data-k="grip:' + k + '" aria-label="' + esc(t("Move {name}", { name: p.name })) + '" title="' + esc(t("Drag, or use the arrow keys")) + '">' + icon("grip") + "</button>" : "" });
    return gr({ tag: "a", href: "/settings/people/" + k, attrs: ' data-pane="people/' + k + '" data-k="person:' + k + '"', lead: av(k, "lg"), k: name, sub: line, chev: true });
  });
  if (!editing) rows.push(addRow(t("Add a person"), "add", ' data-k="add"').replace('class="w-gr add"', 'class="w-gr add w36"'));
  setAction(people.length > 1 ? '<button type="button" data-act="' + (editing ? "done" : "edit") + '"' + (editing ? ' class="on"' : "") + ">" + (editing ? t("Done") : t("Edit")) + "</button>" : "");
  paint(box, (phone() ? '<div class="w-glh">' + t("In this household") + "</div>" : "") + gl(rows, "", editing ? t("Drag a person to change the order.") : ""));
}

/* A person's own page: their name, switching to them, removing them */
function renderPerson() {
  const p = person(sub);
  if (!p) { openPane("people"); return; }
  const k = String(p.id), me = k === state.me;
  const { own, shared } = counts();
  const signin = state.status && state.status.signin;
  const line = !state.tx.length ? t("No transactions yet") : couple()
    ? tn(own[k] || 0, "{n} own transaction, plus {shared} shared", "{n} own transactions, plus {shared} shared", { shared: num(shared) })
    : tn(own[k] || 0, "{n} transaction", "{n} transactions");
  const first = [gr({ k: t("Name"), v: esc(p.name), chev: true, act: "rename", attrs: ' data-id="' + k + '" data-k="rename"' }),
    gr({ k: t("Color"), v: '<span role="img" aria-label="' + esc(COLOR_NAMES()[pcolor(k) - 1]) + '">' + av(k) + "</span>", chev: true, act: "color", attrs: ' data-id="' + k + '" data-k="color"' })];
  if (!me && !signin) first.push(gr({ k: t("Switch to {name}", { name: esc(p.name) }), cls: "acc", act: "switch", attrs: ' data-id="' + k + '" data-k="switch"' }));
  if (me && signin) first.push(gr({ k: t("Sign out"), cls: "acc", tag: "button", attrs: ' data-signout data-k="signout"' }));
  setAction("");
  paint(box, hero(av(k), esc(p.name), line) + gl(first) +
    (!me && state.people.length > 1 ? gl([gr({ k: t("Remove from household"), cls: "red", act: "remove", attrs: ' data-id="' + k + '" data-k="remove"' })]) : ""));
}
export function meta(s) { return s ? { title: "" } : {}; }

/* ---------- Edit: drag a row by its handle, or move it with the arrow keys ---------- */
let drag = null;
function onGrip(ev) {
  const g = ev.target.closest("[data-grip]");
  if (!g || !editing) return;
  ev.preventDefault();
  const row = g.closest(".w-gr"), list = row.parentElement;
  drag = { row, list, id: g.dataset.grip, y: ev.clientY, moved: false };
  row.classList.add("dragging");
  g.setPointerCapture(ev.pointerId);
  const move = (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.y;
    drag.row.style.transform = "translateY(" + dy + "px)";
    const rows = [...drag.list.querySelectorAll(".w-gr")].filter((r) => r !== drag.row);
    const mid = drag.row.getBoundingClientRect().top + drag.row.offsetHeight / 2;
    const before = rows.find((r) => { const b = r.getBoundingClientRect(); return mid < b.top + b.height / 2; });
    const next = before || null;
    if (next !== drag.row.nextElementSibling) {
      const top0 = drag.row.getBoundingClientRect().top;
      drag.list.insertBefore(drag.row, next);
      drag.y += drag.row.getBoundingClientRect().top - top0;
      drag.row.style.transform = "translateY(" + (e.clientY - drag.y) + "px)";
      drag.moved = true;
    }
  };
  const up = () => {
    g.removeEventListener("pointermove", move);
    g.removeEventListener("pointerup", up);
    g.removeEventListener("pointercancel", up);
    if (!drag) return;
    drag.row.style.transform = ""; drag.row.classList.remove("dragging");
    const ids = [...drag.list.querySelectorAll("[data-id]")].map((r) => Number(r.dataset.id));
    const moved = drag.moved; drag = null;
    if (moved) saveOrder(ids);
  };
  g.addEventListener("pointermove", move);
  g.addEventListener("pointerup", up);
  g.addEventListener("pointercancel", up);
}
function onGripKey(ev) {
  const g = ev.target.closest("[data-grip]");
  if (!g || (ev.key !== "ArrowUp" && ev.key !== "ArrowDown")) return;
  ev.preventDefault();
  const ids = state.people.map((p) => p.id);
  const i = ids.indexOf(Number(g.dataset.grip)), j = i + (ev.key === "ArrowUp" ? -1 : 1);
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  saveOrder(ids);
}
async function saveOrder(ids) {
  try {
    state.people = await PUT("/people/order", ids);
    if (state.status) state.status.people = state.people;
    refresh({ people: true });
  } catch (e) { errorToast(e); render(); }
}

/* ---------- actions ---------- */
async function onClick(ev) {
  const b = ev.target.closest("[data-act]");
  if (!b || b.disabled) return;
  const id = b.dataset.id;
  switch (b.dataset.act) {
    case "add": return addPerson();
    case "rename": return renamePerson(id);
    case "color": return pickColor(id);
    case "switch": return switchTo(id);
    case "remove": return removePerson(id);
  }
}
/* Sign-in is off: this browser takes Wally on trust, so it can simply be someone else */
function switchTo(id) {
  try { localStorage.setItem("wally.person", String(id)); } catch (e) { /* fine */ }
  location.href = "/";
}

/* Eight colors, by the same numbers as categories; each swatch is the avatar as it will look */
const COLOR_NAMES = () => [t("Red"), t("Orange"), t("Yellow"), t("Green"), t("Cyan"), t("Blue"), t("Violet"), t("Pink")];
function pickColor(id) {
  const p = person(id);
  if (!p) return;
  const now = pcolor(id), face = esc(initial(p.name));
  let pick = now;
  openDialog({
    kind: "sheet",
    title: t("Color for {name}", { name: esc(p.name) }),
    body: '<div class="w-swatches w-avsw" role="radiogroup" aria-label="' + esc(t("Color")) + '">' + COLOR_NAMES().map((label, i) =>
      '<button type="button" class="w-av c' + (i + 1) + '" role="radio" data-c="' + (i + 1) + '" aria-checked="' + (now === i + 1) + '" aria-label="' + esc(label) + '" title="' + esc(label) + '">' + face + "</button>").join("") + "</div>",
    ok: t("Done"),
    onOpen(root) {
      root.classList.add("w-sh400");
      (root.querySelector('[aria-checked="true"]') || root.querySelector("[data-c]")).focus();
      root.addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-c]");
        if (!b) return;
        pick = +b.dataset.c;
        root.querySelectorAll("[data-c]").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
      });
    },
    onOk: async () => {
      if (pick === now) return;
      await PUT("/people/" + id, { color: pick });
      await reloadPeople();
      refresh({ people: true });
    },
  });
}

async function reloadPeople() {
  state.people = await GET("/people");
  if (state.status) state.status.people = state.people;
}

function addPerson() {
  const signin = state.status && state.status.signin;
  openDialog({
    kind: "sheet",
    title: t("Add a Person"),
    body: fieldRow("np-name", "", t("Name"), ' maxlength="40" autofocus') +
      '<p class="w-glf">' + (signin ? t("A child, a flatmate, anyone who shares costs. They sign in with the household password.") : t("A child, a flatmate, anyone who shares costs. Each person gets their own view.")) + "</p>",
    ok: t("Add"),
    onOpen: (root) => { root.classList.add("w-sh420"); gate(root, (r) => !!val(r, "np-name")); },
    onOk: async (root) => {
      const name = val(root, "np-name");
      if (!name) throw new Error(t("Type their name."));
      await POST("/people", { name });
      await reloadPeople();
      refresh({ people: true });
      toast(t("Added {name}", { name }));
    },
  });
}

function renamePerson(id) {
  const p = person(id);
  if (!p) return;
  openDialog({
    kind: "sheet",
    title: t("Rename {name}", { name: esc(p.name) }),
    body: fieldRow("rp-name", p.name, t("Name"), ' maxlength="40"') + '<p class="w-glf">' + t("Everyone in the household sees the new name.") + "</p>",
    ok: t("Done"),
    onOpen: (root) => { root.classList.add("w-sh420"); root.querySelector("#rp-name").select(); gate(root, (r) => !!val(r, "rp-name")); },
    onOk: async (root) => {
      const name = val(root, "rp-name");
      if (!name) throw new Error(t("Type their name."));
      if (name === p.name) return;
      await PUT("/people/" + id, { name });
      await reloadPeople();
      refresh({ people: true });
      toast(t("Renamed to {name}", { name }));
    },
  });
}

async function removePerson(id) {
  const p = person(id);
  if (!p) return;
  let usage;
  try { usage = await GET("/people/" + id + "/usage"); } catch (e) { return errorToast(e); }
  const left = state.people.filter((x) => String(x.id) !== String(id));
  const heir = left.find((x) => String(x.id) === state.me) || left[0];
  const many = left.length >= 2 && (usage.own || usage.rules);
  const name = esc(p.name);
  // Whole sentences, so every language can word each one its own way
  const parts = [];
  if (!usage.own && !usage.rules) parts.push(t("Their part of shared costs goes to whoever paid."));
  else if (many) parts.push(t("Their transactions and recurring rules move to the person you pick."));
  else {
    parts.push(tn(usage.own, "{name}’s {n} transaction moves to {to}.", "{name}’s {n} transactions move to {to}.", { name, to: esc(heir.name) }));
    if (usage.rules) parts.push(tn(usage.rules, "So does {n} recurring rule.", "So do {n} recurring rules."));
  }
  if (usage.shared) parts.push(t("Shared costs stay shared."));
  parts.push(t("Nothing is deleted."));
  if (state.status && state.status.signin) parts.push(t("They still know the household password."));
  const text = parts.join(" ");
  const pick = many ? '<label class="w-pop2"><span>' + t("Move them to") + '</span><select id="rp-to">' + left.map((x) => '<option value="' + x.id + '"' + (x.id === heir.id ? " selected" : "") + ">" + esc(x.name) + "</option>").join("") +
    '<option value="shared">' + t("Shared") + "</option></select></label>" : "";
  openDialog({
    kind: "alert",
    top: av(String(p.id), "lg w-av48"),
    title: t("Remove {name}?", { name }),
    body: "<p>" + text + "</p>" + pick,
    onOpen: (root) => setTimeout(() => root.focus(), 0),
    ok: phone() ? t("Remove {name}", { name }) : t("Remove"),
    danger: true,
    onOk: async (root) => {
      const sel = root.querySelector("#rp-to");
      const to = sel ? sel.value : String(heir.id);
      await DEL("/people/" + id, { move_to: to === "shared" ? null : Number(to) });
      if (state.scope === String(id)) { state.scope = "all"; try { localStorage.setItem("wally.scope", "all"); } catch (e) { /* fine */ } }
      await Promise.all([reloadPeople(), reloadLedger(), reloadRules()]);
      refresh({ people: true, data: true });
      toast(t("Removed {name}", { name: p.name }));
      openPane("people");
    },
  });
}
