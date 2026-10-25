/* Settings › People: who is in the household, settling up, turning tags into people, removing someone. */
import { t, tn, esc, state, av, pname, num, f, dlabY, GET, POST, PUT, DEL, reloadLedger, reloadRules, reloadSettle, couple, person, monthYear, ym, LANG } from "../../core.js";
import { openDialog, toast, errorToast } from "../../ui.js";
import { refresh } from "../../shell.js";
import { group, gi, giButton, ico, linkBtn, iconBtn, trashBtn, field, textInput, passwordInput, val, paint } from "./common.js";

const PAYMENTS_SHOWN = 5;
let box = null;
let allPayments = false;

export function mount(el) {
  box = el;
  box.addEventListener("click", onClick);
  render();
}
export function update() { if (box) render(); }
export function unmount() { box = null; }

function render() {
  const people = state.people;
  const own = {};
  let shared = 0;
  for (const tx of state.tx) { if (tx.p === null) shared++; else own[tx.p] = (own[tx.p] || 0) + 1; }
  const first = state.tx.length ? state.tx[state.tx.length - 1].d : null;
  const since = first ? monthYear(...ym(first)) : "";

  const rows = people.map((p, i) => {
    const k = String(p.id);
    const sub = !state.tx.length ? t("No transactions yet") : couple()
      ? tn(own[k] || 0, "{n} own transaction, plus {shared} shared since {since}", "{n} own transactions, plus {shared} shared since {since}", { shared: num(shared), since })
      : tn(own[k] || 0, "{n} transaction", "{n} transactions");
    const acts = '<span class="w-acts">' +
      (people.length > 1 ? iconBtn("arrowup", t("Move {name} up", { name: p.name }), ' data-act="up" data-id="' + k + '" data-k="up:' + k + '"' + (i === 0 ? " disabled" : "")) +
        iconBtn("arrowdown", t("Move {name} down", { name: p.name }), ' data-act="down" data-id="' + k + '" data-k="down:' + k + '"' + (i === people.length - 1 ? " disabled" : "")) : "") +
      linkBtn(t("Rename"), ' data-act="rename" data-id="' + k + '" data-k="rename:' + k + '"') + "</span>";
    return gi(av(k, "lg"), esc(p.name) + (k === state.me ? ' <span class="w-badge">' + t("You") + "</span>" : ""), sub, acts);
  });
  rows.push(giButton('<span class="w-ico w-round">' + '<svg class="i" aria-hidden="true"><use href="#i-plus"/></svg></span>', t("Add a person"),
    state.status && state.status.signin
      ? t("A child, a flatmate, anyone who shares costs. You set a first password; they choose their own when they first sign in.")
      : t("A child, a flatmate, anyone who shares costs. Each person gets their own view."), ' data-act="add" data-k="add"'));

  let html = group(t("People in this household"), rows);
  if (couple()) html += settleGroup();
  html += sharingGroup();
  const others = people.filter((p) => String(p.id) !== state.me);
  if (people.length > 1 && others.length) {
    html += group(t("Removing a person"), others.map((p) => gi(ico("trash", "w-ico-bad"), '<span class="w-bad">' + t("Remove {name} from this household", { name: esc(p.name) }) + "</span>",
      t("Their transactions stay. You choose who they go to."), linkBtn(t("Remove"), ' data-act="remove" data-id="' + p.id + '" data-k="remove:' + p.id + '"', "w-bad"))));
  }
  paint(box, html);
}

function settleGroup() {
  const s = state.settle || { transfers: [], payments: [] };
  const owes = (s.transfers || []).map((x) => t("{from} owes {to} {amount}", { from: esc(pname(x.from)), to: esc(pname(x.to)), amount: '<span class="amt">' + f(Number(x.amount)) + "</span>" }));
  const head = gi(ico("split"), owes.length ? owes.map((o) => '<span class="w-owe">' + o + "</span>").join("") : t("All square"),
    owes.length ? t("Since the last payment. Shared costs are split by each person’s share.") : t("Nobody owes anything since the last payment."),
    '<button type="button" class="w-btn ghost" data-act="settle" data-k="settle">' + t("Settle up") + "</button>");
  const pays = s.payments || [];
  const shown = allPayments ? pays : pays.slice(0, PAYMENTS_SHOWN);
  const rows = [head].concat(shown.map((p) => gi(ico("check"),
    t("{from} paid {to} {amount}", { from: esc(pname(p.from_person)), to: esc(pname(p.to_person)), amount: '<span class="amt">' + f(Number(p.amount)) + "</span>" }),
    t("{date}. Not counted as spending.", { date: dlabY(p.date) }) + (p.note ? " " + esc(p.note) : ""),
    trashBtn(t("Delete this payment"), ' data-act="unpay" data-id="' + p.id + '" data-k="unpay:' + p.id + '"'))));
  if (!pays.length) rows.push(gi(ico("info"), t("No payments yet"), t("When someone pays the other back, Settle up records it here.")));
  if (pays.length > PAYMENTS_SHOWN) {
    rows.push('<div class="w-gmore">' + linkBtn(allPayments ? t("Show fewer") : tn(pays.length, "Show the {n} payment", "Show all {n} payments"), ' data-act="morepay" data-k="morepay"') + "</div>");
  }
  return group(t("Settled payments"), rows, t("Recorded with Settle up"));
}

/* Tags named like people, e.g. #ana, from before Wally knew about people */
function nameTags() {
  const names = new Set(state.people.map((p) => p.name.toLocaleLowerCase()));
  return state.tags.filter((g) => names.has(g.toLocaleLowerCase()));
}
function sharingGroup() {
  if (!state.tags.length || !state.people.length) return "";
  const found = nameTags();
  let sub;
  if (found.length) {
    const set = new Set(found.map((g) => "#" + g));
    const n = state.tx.filter((tx) => tx.tags.some((g) => set.has(g))).length;
    sub = tn(n, "Found {tags} on {n} transaction. Move it to its owner.", "Found {tags} on {n} transactions. Move them to their owners.",
      { tags: new Intl.ListFormat(LANG, { type: "conjunction" }).format(found.map((g) => "#" + g)).replace(/#[^\s,،、]+/g, (m) => "<b>" + esc(m) + "</b>") });
  } else sub = t("Every transaction with a tag, like #holiday, becomes one person’s own.");
  return group(t("Sharing"), [giButton(ico("tag"), t("Turn a tag into a person"), sub, ' data-act="fromtag" data-k="fromtag"')]);
}

/* ---------- actions ---------- */
async function onClick(ev) {
  const b = ev.target.closest("[data-act]");
  if (!b || b.disabled) return;
  const id = b.dataset.id;
  switch (b.dataset.act) {
    case "add": return addPerson();
    case "rename": return renamePerson(id);
    case "up": case "down": return move(id, b.dataset.act === "up" ? -1 : 1);
    case "remove": return removePerson(id);
    case "settle": return settle();
    case "unpay": return deletePayment(id);
    case "morepay": allPayments = !allPayments; return render();
    case "fromtag": return fromTag();
  }
}

async function reloadPeople() {
  state.people = await GET("/people");
  if (state.status) state.status.people = state.people;
}

function addPerson() {
  const signin = state.status && state.status.signin;
  const household = state.status && state.status.household_password;
  openDialog({
    title: t("Add a person"),
    body: field(t("Name"), textInput("np-name", "", ' maxlength="40" autofocus')) +
      (signin ? field(t("First password"), passwordInput("np-pw", "new-password"),
        household ? t("Optional: without one they sign in with the household password. They choose their own when they first sign in.") : t("At least 8 characters. They choose their own when they first sign in.")) : ""),
    ok: t("Add person"),
    onOk: async (root) => {
      const name = val(root, "np-name");
      if (!name) throw new Error(t("Type their name."));
      const password = signin ? root.querySelector("#np-pw").value : "";
      if (signin && !household && password.length < 8) throw new Error(t("Give them a first password of at least 8 characters."));
      await POST("/people", { name, password });
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
    title: t("Rename {name}", { name: esc(p.name) }),
    body: field(t("Name"), textInput("rp-name", p.name, ' maxlength="40"')),
    ok: t("Rename"),
    onOpen: (root) => root.querySelector("#rp-name").select(),
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

async function move(id, step) {
  const ids = state.people.map((p) => p.id);
  const i = ids.indexOf(Number(id)), j = i + step;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  try {
    state.people = await PUT("/people/order", ids);
    if (state.status) state.status.people = state.people;
    refresh({ people: true });
  } catch (e) { errorToast(e); }
}

async function removePerson(id) {
  const p = person(id);
  if (!p) return;
  let usage;
  try { usage = await GET("/people/" + id + "/usage"); } catch (e) { return errorToast(e); }
  const left = state.people.filter((x) => String(x.id) !== String(id));
  const heir = left.find((x) => String(x.id) === state.me) || left[0];
  const options = left.map((x) => [String(x.id), esc(x.name), t("They become {name}’s own.", { name: esc(x.name) })]);
  if (left.length >= 2) options.push(["shared", t("Shared"), t("Split between everyone still here.")]);
  const radios = '<div class="w-opts" role="radiogroup" aria-label="' + esc(t("Move their transactions to")) + '">' + options.map(([v, label, small]) =>
    '<label><input type="radio" name="rp-to" value="' + v + '"' + (v === String(heir.id) ? " checked" : "") + "><span><b>" + label + "</b><small>" + small + "</small></span></label>").join("") + "</div>";
  const parts = [tn(usage.own, "{n} transaction of their own", "{n} transactions of their own")];
  if (usage.shared) parts.push(tn(usage.shared, "{n} shared one", "{n} shared ones"));
  if (usage.rules) parts.push(tn(usage.rules, "{n} recurring rule", "{n} recurring rules"));
  openDialog({
    title: t("Remove {name}?", { name: esc(p.name) }),
    body: "<p>" + t("{name} has {list}. Nothing is deleted.", { name: esc(p.name), list: new Intl.ListFormat(LANG, { type: "conjunction" }).format(parts) }) + "</p>" +
      (usage.own || usage.rules ? "<p>" + t("Move their transactions and rules to:") + "</p>" + radios : "") +
      "<p>" + t("Their part of shared costs goes to whoever you choose, or to whoever paid. Their settle-up payments, sign-ins and API keys are deleted.") + "</p>",
    ok: t("Remove {name}", { name: esc(p.name) }),
    danger: true,
    onOk: async (root) => {
      const pick = root.querySelector('input[name="rp-to"]:checked');
      const to = pick ? pick.value : String(heir.id);
      await DEL("/people/" + id, { move_to: to === "shared" ? null : Number(to) });
      if (state.scope === String(id)) { state.scope = "all"; try { localStorage.setItem("wally.scope", "all"); } catch (e) { /* fine */ } }
      await Promise.all([reloadPeople(), reloadLedger(), reloadRules(), reloadSettle()]);
      refresh({ people: true, data: true });
      toast(t("Removed {name}", { name: p.name }));
    },
  });
}

async function settle() {
  try {
    const m = await import("../../settle.js");
    await m.openSettle();
  } catch (e) { errorToast(e); }
}

async function deletePayment(id) {
  const p = (state.settle.payments || []).find((x) => String(x.id) === String(id));
  if (!p) return;
  try {
    await DEL("/settlements/" + id);
    await reloadSettle();
    refresh({ settle: true });
    toast(t("Deleted the payment of {amount}", { amount: f(Number(p.amount)) }), async () => {
      await POST("/settlements", { date: p.date, from_person: p.from_person, to_person: p.to_person, amount: p.amount, note: p.note || "" });
      await reloadSettle();
      refresh({ settle: true });
    });
  } catch (e) { errorToast(e); }
}

function fromTag() {
  const found = nameTags();
  const counts = {};
  state.tx.forEach((tx) => tx.tags.forEach((g) => { counts[g] = (counts[g] || 0) + 1; }));
  const start = found[0] || state.tags[0];
  const owner = state.people.find((p) => p.name.toLocaleLowerCase() === String(start).toLocaleLowerCase()) || person(state.me) || state.people[0];
  let count = 0;
  openDialog({
    title: t("Turn a tag into a person"),
    body: "<p>" + t("Every transaction with the tag becomes that person’s own, and stops being shared.") + "</p>" +
      field(t("Tag"), '<select class="w-mini w-sselect" id="ft-tag">' + state.tags.map((g) => '<option value="' + esc(g) + '"' + (g === start ? " selected" : "") + ">#" + esc(g) + " · " + num(counts["#" + g] || 0) + "</option>").join("") + "</select>") +
      field(t("Person"), '<select class="w-mini w-sselect" id="ft-person">' + state.people.map((p) => '<option value="' + p.id + '"' + (p.id === owner.id ? " selected" : "") + ">" + esc(p.name) + "</option>").join("") + "</select>") +
      '<label class="w-scheck"><input type="checkbox" id="ft-remove" checked> ' + t("Remove the tag from them afterwards") + "</label>" +
      '<p class="w-spreview" id="ft-preview" aria-live="polite"></p>',
    ok: t("Move transactions"),
    onOpen: (root) => {
      const preview = async () => {
        const tag = root.querySelector("#ft-tag").value;
        const who = person(root.querySelector("#ft-person").value);
        const out = root.querySelector("#ft-preview");
        try {
          const r = await GET("/people/from-tag/preview?tag=" + encodeURIComponent(tag));
          count = r.count;
          if (out.isConnected) out.innerHTML = tn(r.count, "{n} transaction has #{tag}. It becomes {name}’s.", "{n} transactions have #{tag}. They become {name}’s.", { tag: esc(tag), name: esc(who ? who.name : "") });
        } catch (e) { if (out.isConnected) out.textContent = e.message; }
      };
      root.querySelector("#ft-tag").addEventListener("change", preview);
      root.querySelector("#ft-person").addEventListener("change", preview);
      preview();
    },
    onOk: async (root) => {
      const tag = root.querySelector("#ft-tag").value;
      const who = person(root.querySelector("#ft-person").value);
      if (!count) throw new Error(t("No transactions have this tag."));
      const r = await POST("/people/" + who.id + "/from-tag", { tag, remove_tag: root.querySelector("#ft-remove").checked });
      await reloadLedger();
      state.tags = await GET("/tags");
      refresh({ data: true });
      toast(tn(r.count, "Moved {n} transaction to {name}", "Moved {n} transactions to {name}", { name: who.name }));
    },
  });
}
