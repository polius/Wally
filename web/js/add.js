/* The add and edit sheet: one sheet for every kind of money, from a coffee to a yearly bill.
   Fast for the everyday (amount, Enter, three letters, Enter) and complete for the rest: shares,
   tags, a note, repeats, split receipts. On a phone it becomes three steps with a keypad.

   openAdd()                        new expense
   openAdd({type: "income"})        new income
   openAdd({repeat: true})          new recurring rule (Repeat already on)
   openAdd({tx})                    edit a transaction (a split receipt edits its whole group)
   openAdd({rule})                  edit a recurring rule
   openAdd({date, person, name, amount, category, type})   prefilled
   flushQueue()                     send what was saved while Wally couldn't be reached */
import {
  $, t, tn, esc, state, GET, POST, PUT, DEL, TODAY, addD, ym, dim, ds, ymAdd, f, dlab, dlabL, monthName,
  icon, tile, cat, cc, av, pname, person, couple, symbol, decSep, upsertTx, removeTx, toApi, fromRule, reloadRules, reloadLedger,
  LANG,
} from "./core.js";
import { toast, openDialog, trapFocus, hideTip, dialogOpen } from "./ui.js";
import { refresh } from "./shell.js";
import { describe, nextOf } from "./sched.js";
import * as C from "./add/calc.js";
import * as Q from "./add/queue.js";
import { fqOf, formRule, nextText, notesHtml, lc1, shortLabel, clampInt, withYear as dShort, withYearW as dShortW } from "./add/repeat.js";
import { isPhone, typeSeg, catBox, press, pickList, freqCells, KEYPAD, chev, phoneAmount, repeatPage, catPage, splitPage } from "./add/phone.js";
import { calHtml, calKey, monthStep } from "./add/datepick.js";

export { flushQueue } from "./add/queue.js";

/* ---------- the sheet's state ---------- */
let ad = blank("expense");
let opener = null;          // where focus goes back to on close
let layout = "";            // "desk" or "phone"
let cache = { payees: [], cats: [], tags: [], incomeW: {} };
let built = { split: "", parts: "" }; // which structure the share and part rows were drawn for

function me() { return state.me && person(state.me) ? state.me : state.people.length ? String(state.people[0].id) : null; }
function keys() { return C.peopleKeys(); }
function blank(type) {
  return {
    mode: "tx", type: type || "expense", amt: "", name: "", cat: null, who: null, sm: "even", pct: 50, custCents: null, custFor: 0, cust: {},
    by: null, date: "today", cal: null, calF: "", tags: [], tagDraft: "", note: "",
    rep: false, fq: "monthly", every: "3", unit: "weekly", end: "never", until: "", count: "12", about: false,
    split: false, parts: [], sugg: [], hl: 0, catQ: null, copts: [], chl: 0, touched: {}, edit: null, group: null, rule: null,
    step: "main", from: "", scroll: 0, busy: false, serr: "", amtTried: false, nameTried: false, snap: "", repeatOpen: false, more: false,
  };
}
function reset(type) {
  ad = blank(type);
  ad.who = me();
  ad.by = me();
  if (ad.type === "income") ad.cat = C.incomeCategory();
}
const isEdit = () => !!(ad.edit || ad.group || ad.rule);
const form = () => $("add-form");
const dateOf = () => (ad.date === "today" ? TODAY : ad.date === "yesterday" ? addD(TODAY, -1) : ad.date);
const normDate = (d) => (d === TODAY ? "today" : d === addD(TODAY, -1) ? "yesterday" : d);
const inAmount = (v) => v.toFixed(2).replace(".", decSep());
const shared = () => ad.who === "shared" && couple();
const fromRuleTx = () => !!(ad.edit && ad.edit.rec && ad.edit.rid && !ad.group);
const editing = () => ad.edit || (ad.group && ad.group[0]) || null;
const pending = () => !!(editing() && editing().pending);
const canRepeat = () => !ad.split && !ad.group && !pending() && !fromRuleTx();

/* The amount, in euros, when it is a usable one (0 otherwise) */
function amount() { const r = C.readAmount(ad.amt); return r.ok && r.v > 0 ? r.v : 0; }
function addName() { return ad.name.trim() || (ad.split ? "" : ad.cat || ""); }
function allTagsChosen() {
  const out = ad.tags.slice(), draft = cleanTag(ad.tagDraft);
  if (draft && !out.includes(draft)) out.push(draft);
  return out;
}
function cleanTag(s) { const g = String(s || "").trim().replace(/^#*/, "").replace(/\s+/g, "-").toLowerCase(); return g ? "#" + g : ""; }

/* ---------- shares ---------- */
function payer() { return ad.type === "expense" ? ad.by || me() : me(); }
function pct2() { // the first person's percent, with two people
  const [k0] = keys();
  if (ad.sm === "even") return 50;
  if (ad.sm === "income") return C.percents(cache.incomeW)[k0];
  return ad.pct;
}
function custTyped() { // 3+ people, Custom: what was typed for each, in cents (NaN when unreadable)
  const o = {};
  keys().forEach((k) => { const r = C.readAmount(ad.cust[k]); o[k] = r.empty ? 0 : r.ok && r.v >= 0 ? C.cents(r.v) : NaN; });
  return o;
}
/* Each person's part of a total in cents. Always adds up; the spare cent goes to whoever paid. */
function sharesFor(total) {
  const ks = keys(), by = payer();
  if (ad.sm === "even") return C.evenShares(total, by);
  if (ad.sm === "income") return C.sharesByWeight(total, cache.incomeW, by);
  if (ks.length === 2) {
    if (ad.custCents !== null && ad.custFor === total) return { [ks[0]]: ad.custCents, [ks[1]]: total - ad.custCents };
    return C.sharesByWeight(total, { [ks[0]]: ad.pct, [ks[1]]: 100 - ad.pct }, by);
  }
  const typed = custTyped();
  if (ks.some((k) => isNaN(typed[k]))) return C.evenShares(total, by);
  const sum = ks.reduce((s, k) => s + typed[k], 0);
  if (sum === total) return typed;
  return C.sharesByWeight(total, typed, by);
}
/* Start Custom from what the current mode gives, so nothing jumps */
function seedCustom() {
  const total = C.cents(amount()), ks = keys();
  if (ks.length === 2) { ad.pct = pct2(); ad.custCents = null; return; }
  const sh = total ? sharesFor(total) : {};
  ad.cust = Object.fromEntries(ks.map((k) => [k, total ? inAmount((sh[k] || 0) / 100) : ""]));
}
function detectShares(shc, total, by) {
  if (!shc || !couple()) return;
  if (C.sameShares(shc, C.evenShares(total, by))) { ad.sm = "even"; return; }
  if (C.sameShares(shc, C.sharesByWeight(total, cache.incomeW, by))) { ad.sm = "income"; return; }
  ad.sm = "custom";
  const ks = keys();
  if (ks.length === 2) { ad.custCents = shc[ks[0]] || 0; ad.custFor = total; ad.pct = total ? (ad.custCents / total) * 100 : 50; }
  else ad.cust = Object.fromEntries(ks.map((k) => [k, inAmount((shc[k] || 0) / 100)]));
}

/* ---------- split receipt ---------- */
/* Each part's cents. One part left empty takes what is left. */
function partCents() {
  const total = C.cents(amount());
  const vals = ad.parts.map((p) => { const r = C.readAmount(p.amt); return r.empty ? null : r.ok ? C.cents(r.v) : NaN; });
  const empties = vals.filter((v) => v === null).length;
  const typed = vals.reduce((s, v) => s + (v > 0 ? v : 0), 0);
  return vals.map((v) => (v === null && empties === 1 && total - typed > 0 ? total - typed : v));
}
function partsLeft() { const c = partCents(); return C.cents(amount()) - c.reduce((s, v) => s + (v > 0 ? v : 0), 0); }

/* ---------- what is wrong, if anything ---------- */
function problem() {
  const raw = ad.amt.trim(), r = C.readAmount(raw);
  if (raw && !r.ok) return { f: "amt", m: t("Use numbers, + and − only, like 12.40+8.15.") };
  if (raw && r.v <= 0) return { f: "amt", m: t("The total must be more than zero.") };
  if (r.v >= 1e8) return { f: "amt", m: t("That is more than Wally can keep. Use less than 100,000,000.") };
  if (ad.split) {
    const pc = partCents();
    if (ad.parts.some((p) => !p.c)) return { f: "parts", btn: t("Pick a category") };
    if (pc.some((v) => v !== null && (isNaN(v) || v <= 0))) return { f: "parts", m: t("Each part needs an amount more than zero."), btn: t("Fix the highlighted field") };
    if (pc.some((v) => v === null)) return { f: "parts", m: t("Give each part an amount, or leave just one empty."), btn: t("Fix the highlighted field") };
    const left = partsLeft();
    if (amount() && left) return { f: "parts", btn: left > 0 ? t("Assign {amount} more", { amount: f(left / 100) }) : t("Take {amount} off the parts", { amount: f(-left / 100) }) };
  }
  if (shared() && ad.sm === "custom" && keys().length > 2 && amount()) {
    const typed = custTyped(), ks = keys();
    if (ks.some((k) => isNaN(typed[k]))) return { f: "cust", m: t("Use numbers only, like 12.40."), btn: t("Fix the highlighted field") };
    const left = C.cents(amount()) - ks.reduce((s, k) => s + typed[k], 0);
    if (left) return { f: "cust", m: left > 0 ? t("{amount} left to share", { amount: f(left / 100) }) : t("{amount} more than the total", { amount: f(-left / 100) }), btn: left > 0 ? t("Share {amount} more", { amount: f(left / 100) }) : t("Take {amount} off the shares", { amount: f(-left / 100) }) };
  }
  const rep = ad.rep || ad.mode === "rule";
  if (!rep && dateOf() > TODAY) return { f: "date", m: t("Pick today or an earlier day, or turn on Repeat.") };
  if (rep && ad.end === "until") {
    if (!ad.until) return { f: "rep", m: t("Pick the last date, or choose another way to end.") };
    if (ad.until <= dateOf()) return { f: "rep", m: t("The last date must be after {date}.", { date: dlab(dateOf()) }) };
  }
  return null;
}
const named = () => !!ad.name.trim();
const needName = () => (ad.type === "income" ? t("Enter where it is from") : t("Enter what it was for"));
function ready() { return amount() > 0 && named() && (ad.split || ad.cat) && ad.who && !problem(); }

/* ---------- markup: one sheet of grouped rows, like Calendar's event sheet ----------
   Adding: the type and Close (desktop) or Cancel and the type (phone) on top, the amount, then two groups:
   what and who, then when; the main button at the bottom names what is missing. Editing: Cancel · title · Save
   on top, and Delete as the last row, in red. Repeat (and, on a phone, Category and Split) open as pages. */
function amountRow() {
  const left = state.currency.position !== "right";
  const cur = '<span class="cur" aria-hidden="true">' + esc(symbol()) + "</span>";
  return '<label class="w-amount" id="add-amtrow">' + (left ? cur : "") +
    '<input id="add-amt" inputmode="decimal" autocomplete="off" placeholder="0' + esc(decSep()) + '00" aria-label="' + esc(t("Amount")) + '" aria-describedby="add-calc add-aerr">' +
    (left ? "" : cur) + '<span class="w-calc" id="add-calc" aria-live="polite"></span></label>';
}
function headHtml() {
  const phone = layout === "phone";
  if (isEdit()) return '<div class="w-ah"><button type="button" class="w-alink" data-close>' + t("Cancel") + '</button><b class="w-atitle" id="add-htitle"></b>' +
    '<button class="w-alink w-asave" type="submit" id="add-go">' + t("Save") + "</button></div>" + '<div class="w-atype">' + typeSeg() + "</div>";
  if (phone) return '<div class="w-ah"><button type="button" class="w-alink" data-close>' + t("Cancel") + "</button>" + typeSeg() + "</div>";
  return '<div class="w-ah">' + typeSeg() + '<button type="button" class="w-x w-addx" data-close aria-label="' + esc(t("Close")) + '">' + icon("x") + "</button></div>";
}
function sheetHtml() {
  const phone = layout === "phone", edit = isEdit(), dateSeg = !phone && !edit;
  const catRow = phone
    ? '<button type="button" class="w-gr" id="add-catrow" data-step="cat"><span class="k" id="lbl-cat">' + t("Category") + '</span><span class="v" id="add-catv"></span>' + chev() + "</button>"
    : '<div class="w-gr w-acatrow" id="add-catrow"><span class="k" id="lbl-cat">' + t("Category") + "</span>" + catBox() + "</div>";
  const splitRows = phone
    ? '<button type="button" class="w-gr" data-step="split" id="add-smrow"><span class="k">' + t("Split") + '</span><span class="v" id="add-smv"></span>' + chev() + "</button>" +
      '<button type="button" class="w-gr" data-step="split" id="add-byrow"><span class="k">' + t("Paid by") + '</span><span class="v" id="add-byv"></span>' + chev() + "</button>"
    : '<div class="w-gr"><span class="k" id="lbl-sm">' + t("Split") + '</span><span class="v w-apop"><select id="add-smsel" aria-labelledby="lbl-sm"></select>' + chev(true) + "</span></div>" +
      '<div class="w-gr" id="add-byrow"><span class="k" id="lbl-by">' + t("Paid by") + '</span><span class="v w-apop"><select id="add-bysel" aria-labelledby="lbl-by"></select>' + chev(true) + "</span></div>" +
      '<div id="add-custrows" class="w-acust" hidden></div>';
  const dateRow = dateSeg
    ? '<div class="w-gr" id="add-daterow"><span class="k" id="lbl-date"></span><div class="w-seg w-aseg" id="add-date" role="group" aria-labelledby="lbl-date"></div></div>'
    : '<button type="button" class="w-gr" id="add-datecell" aria-expanded="false" aria-controls="add-cal"><span class="k" id="lbl-date"></span><span class="v" id="add-datev"></span>' + chev() + "</button>";
  const main = '<section class="w-apage" data-pstep="main">' + (phone ? '<div class="w-grab" aria-hidden="true"></div>' : "") + headHtml() +
    (phone ? phoneAmount() : amountRow()) +
    '<p class="w-acap" id="add-editing" hidden></p>' +
    '<p class="w-err w-acenter" id="add-aerr" hidden role="alert"></p>' +
    '<div class="w-gl w-ag" id="add-g1">' +
      '<div class="w-gr w-aname" id="add-namerow"><label for="add-name" id="lbl-name" class="vh"></label>' +
        '<input id="add-name" autocomplete="off" aria-required="true" aria-describedby="add-nerr" role="combobox" aria-autocomplete="list" aria-controls="add-sugg" aria-expanded="false" enterkeyhint="done">' +
        '<div class="w-sugg" id="add-sugg" hidden role="listbox" aria-label="' + esc(t("Known payees")) + '"></div></div>' +
      catRow +
      '<div class="w-aparts" id="add-parts" hidden></div>' +
      '<div class="w-gr" id="add-whorow"><span class="k" id="lbl-who">' + t("Who") + '</span><div class="w-seg w-aseg" id="add-who" role="radiogroup" aria-labelledby="lbl-who"></div></div>' +
      '<div class="w-asplit" id="add-split" hidden>' + splitRows + "</div>" +
    "</div>" +
    '<p class="w-glf" id="add-splitnote" hidden></p>' +
    (phone ? "" : '<p class="w-err w-glf" id="add-cerr" hidden role="alert"></p>') +
    '<p class="w-err w-glf" id="add-nerr" hidden role="alert"></p>' +
    '<div class="w-gl w-ag" id="add-g2">' +
      dateRow +
      '<div class="w-dcal w-acal" id="add-cal" hidden role="group" aria-labelledby="lbl-date"></div>' +
      '<button type="button" class="w-gr" id="add-reprow" data-step="repeat"><span class="k">' + t("Repeat") + '</span><span class="v" id="add-repv"></span>' + chev(dateSeg) + "</button>" +
      '<div class="w-gr" id="add-tagrow"><span class="k" id="lbl-tags">' + t("Tags") + '</span><span class="v w-atags" role="group" aria-labelledby="lbl-tags"><span id="add-tags" class="w-contents"></span>' +
        '<input id="add-tag" list="add-taglist" autocomplete="off" aria-label="' + esc(t("Add a tag")) + '"><datalist id="add-taglist"></datalist></span></div>' +
      '<label class="w-gr" id="add-noterow"><input id="add-note" autocomplete="off" placeholder="' + esc(t("Note")) + '" aria-label="' + esc(t("Note")) + '"></label>' +
    "</div>" +
    '<p class="w-glf" id="add-rep-l" hidden></p>' +
    '<p class="w-err w-glf" id="add-derr" hidden role="alert"></p>' +
    '<p class="w-dup" id="add-dup" hidden></p>' +
    '<p class="w-err w-glf" id="add-serr" hidden role="alert"></p>' +
    (edit ? '<div class="w-gl" id="add-delgrp" hidden><button type="button" class="w-gr red" id="add-del"></button></div>' : "") +
    (edit ? "" : '<div class="' + (phone ? "w-pfoot" : "w-afoot") + '"><button class="w-btn primary w-submit" type="submit" id="add-go"></button></div>') +
    (phone ? KEYPAD() : "") +
    "</section>";
  return '<h2 class="vh" id="add-title"></h2>' + main + repeatPage() + (phone ? catPage() + splitPage() : "");
}

/* ---------- drawing ---------- */
function setText(id, s) { const n = $(id); if (n && n.textContent !== s) n.textContent = s; }
function setHtml(id, s) { const n = $(id); if (n && n.innerHTML !== s) n.innerHTML = s; }
function show(id, on) { const n = $(id); if (n) n.hidden = !on; }
function setVal(id, v) { const n = $(id); if (n && n.value !== v && document.activeElement !== n) n.value = v; }
function pressed(box, attr, val) {
  const b = $(box);
  if (b) b.querySelectorAll("[" + attr + "]").forEach((x) => {
    const on = x.getAttribute(attr) === String(val);
    x.setAttribute(x.getAttribute("role") === "radio" ? "aria-checked" : "aria-pressed", String(on));
  });
}
function radioChip(attr, val, on, stop, inner) {
  return '<button type="button" class="w-chip' + (on ? " on" : "") + '" role="radio" data-' + attr + '="' + esc(val) + '" aria-checked="' + on + '" tabindex="' + (on || stop ? 0 : -1) + '">' + inner + "</button>";
}

function render() {
  if (!form()) return;
  const inc = ad.type === "income", rule = ad.mode === "rule", ed = ad.edit || (ad.group && ad.group[0]);
  const a = amount(), phone = layout === "phone", edit = isEdit();
  // The page first, so the amount below is measured where it shows
  document.querySelectorAll("#add-form [data-pstep]").forEach((s) => { s.hidden = s.dataset.pstep !== ad.step; });
  const title = rule ? (inc ? t("Edit recurring income") : t("Edit recurring expense")) : ed ? (inc ? t("Edit income") : t("Edit expense")) : inc ? t("New income") : t("New expense");
  setText("add-title", title);
  setText("add-htitle", rule ? (inc ? t("Income") : t("Bill")) : t("Transaction"));
  pressed("add-type", "data-at", ad.type);
  const cap = pending() ? t("Waiting to send") : "";
  setText("add-editing", cap);
  show("add-editing", !!cap);

  // amount
  setVal("add-amt", ad.amt);
  const r = C.readAmount(ad.amt);
  setText("add-calc", r.ok && r.expr && r.v > 0 ? "= " + f(r.v) : "");
  sizeAmount();
  const amtRow = $("add-amtrow");
  if (amtRow) amtRow.classList.toggle("empty", !ad.amt);

  // name
  setVal("add-name", ad.name);
  const nm = $("add-name");
  if (nm) nm.placeholder = inc ? t("Where is it from?") : t("What was it for?");
  setText("lbl-name", inc ? t("Source") : t("Merchant"));

  // category, or the parts of a split receipt
  show("add-catrow", !inc && !ad.split);
  if (!inc && !ad.split) renderCat();
  show("add-parts", ad.split);
  if (ad.split) renderParts();

  // who and how it is shared
  show("add-whorow", couple());
  if (couple()) setHtml("add-who", whoHtml());
  show("add-split", shared());
  renderSplit();

  // date
  setText("lbl-date", ad.rep || rule ? t("Starts") : t("Date"));
  renderDate();

  // tags and note: once there is an amount, or when they hold something; always when editing
  setHtml("add-tags", ad.tags.map((g) => '<button type="button" class="w-chip on" data-tg="' + esc(g) + '" aria-label="' + esc(t("Remove tag {tag}", { tag: g })) + '">' + esc(g) + icon("x", "x") + "</button>").join(""));
  const tagIn = $("add-tag");
  if (tagIn) {
    tagIn.placeholder = ad.tags.length ? t("+ tag") : t("Add a tag");
    setVal("add-tag", ad.tagDraft);
  }
  setHtml("add-taglist", cache.tags.filter((g) => !ad.tags.includes(g)).slice(0, 200).map((g) => '<option value="' + esc(g) + '">').join(""));
  setVal("add-note", ad.note);
  // Tags and a note are always there, so nothing moves when the amount is typed
  const extra = true;
  show("add-tagrow", extra);
  show("add-noterow", extra);

  renderRepeat();

  // errors, under the field they belong to
  const er = problem();
  const showAmt = er && er.f === "amt";
  const amtMsg = showAmt ? er.m : ad.amtTried && !a ? t("Enter an amount") : "";
  setText("add-aerr", amtMsg); show("add-aerr", !!amtMsg);
  if (amtRow) amtRow.classList.toggle("err", !!amtMsg);
  const ai = $("add-amt");
  if (ai) ai.setAttribute("aria-invalid", String(!!amtMsg));
  const nameMsg = ad.nameTried && !named() ? needName() : "";
  setText("add-nerr", nameMsg); show("add-nerr", !!nameMsg);
  if (nm) nm.setAttribute("aria-invalid", String(!!nameMsg));
  for (const [id, fld] of [["add-derr", "date"], ["add-rerr", "rep"], ["add-cerr", "cust"]]) {
    const m = er && er.f === fld && er.m ? er.m : "";
    setText(id, m); show(id, !!m);
  }
  setText("add-serr", ad.serr); show("add-serr", !!ad.serr);

  renderDup(a);

  // The main button names what is missing; editing, Save sits at the top and greys until it can save
  const ok = ready();
  const go = $("add-go");
  if (go) {
    go.setAttribute("aria-disabled", String(!ok || ad.busy));
    if (!edit) setText("add-go", ok ? (inc ? t("Add Income") : t("Add Expense"))
      : !a ? t("Enter an amount") : !named() ? needName() : !ad.split && !ad.cat ? t("Pick a category") : (er && er.btn) || t("Fix the highlighted field"));
  }
  const canDelete = !!(ad.edit || ad.group);
  show("add-delgrp", canDelete);
  setText("add-del", t("Delete transaction"));

  if (phone) renderPhone(a);
  renderPages();
}

/* The amount field is as wide as what is typed, so the currency sign sits next to it */
function sizeAmount() {
  const i = $("add-amt");
  if (!i) return;
  // Measured by the field itself: a canvas has no tabular digits, so every 1 came out short
  const empty = !i.value;
  if (empty) i.value = i.placeholder || "0";
  i.style.width = "0";
  i.style.width = i.scrollWidth + 2 + "px";
  if (empty) i.value = "";
}
/* Who: a segmented control, Alex | Ana | Shared */
function whoHtml() {
  const list = keys().map((k) => [k, esc(pname(k))]);
  list.push(["shared", t("Shared")]);
  const anyOn = list.some((x) => x[0] === ad.who);
  return list.map((x, i) => '<button type="button" role="radio" data-aw="' + esc(x[0]) + '" aria-checked="' + (ad.who === x[0]) + '" aria-pressed="' + (ad.who === x[0]) + '" tabindex="' + (ad.who === x[0] || (!anyOn && i === 0) ? 0 : -1) + '">' + x[1] + "</button>").join("");
}

/* ---------- shares: Split and Paid by ---------- */
function smLabel(k) {
  const ks = keys(), pc = C.percents(cache.incomeW), anyIncome = ks.some((x) => cache.incomeW[x] > 0);
  if (k === "even") return t("Evenly");
  if (k === "income") return ks.length === 2 && anyIncome ? t("By income {a}/{b}", { a: pc[ks[0]], b: pc[ks[1]] }) : t("By income");
  return t("Custom");
}
function payerLabel(k) { return esc(pname(k)) + (k === state.me ? " (" + esc(t("you")) + ")" : ""); }
/* "Half each: Alex 21.25 €, Ana 21.25 €" */
function sharesLine(sh) {
  const ks = keys();
  if (!sh) return ad.sm === "income" ? (ks.some((k) => cache.incomeW[k] > 0) ? t("From the last three months of income") : t("No income in the last three months, so evenly")) : "";
  const parts = ks.map((k) => t("{name} {amount}", { name: pname(k), amount: f((sh[k] || 0) / 100) }));
  const list = new Intl.ListFormat(LANG, { type: "unit", style: "short" }).format(parts);
  if (ad.sm === "even") return ks.length === 2 ? t("Half each: {list}", { list }) : t("Equal parts: {list}", { list });
  if (ad.sm === "income") return t("By income: {list}", { list });
  return list;
}
function renderSplit() {
  const ks = keys(), two = ks.length === 2, total = C.cents(amount()), cust = ad.sm === "custom", on = shared();
  const sh = on && total ? sharesFor(total) : null;
  const exp = ad.type === "expense";
  // Desktop: two pop-up rows
  const smSel = $("add-smsel");
  if (smSel) {
    const opts = ["even", "income", "custom"].map((k) => '<option value="' + k + '">' + esc(smLabel(k)) + "</option>").join("");
    if (smSel.dataset.k !== opts) { smSel.innerHTML = opts; smSel.dataset.k = opts; }
    smSel.value = ad.sm;
  }
  const by = $("add-bysel");
  if (by) {
    const opts = ks.map((k) => '<option value="' + esc(k) + '">' + (layout === "phone" ? payerLabel(k) : esc(pname(k))) + "</option>").join("");
    if (by.dataset.k !== opts) { by.innerHTML = opts; by.dataset.k = opts; }
    by.value = payer();
  }
  show("add-byrow", exp);
  show("add-bygrp", exp);
  // Phone: the rows say what the Split page holds
  setText("add-smv", smLabel(ad.sm).replace(/ \d+\/\d+$/, ""));
  setHtml("add-byv", esc(pname(payer())));
  // Custom: each person's part
  const box = $("add-custrows");
  if (box) {
    box.hidden = !(on && cust);
    const key = ks.join(",") + "|" + layout + "|" + cust;
    if (on && cust && built.split !== key) { built.split = key; box.innerHTML = custRowsHtml(ks, two); }
    if (on && cust) {
      ks.forEach((k, i) => {
        if (two) {
          if (i === 0) { const inp = $("add-split-a"); if (inp && document.activeElement !== inp) inp.value = total && sh ? inAmount((sh[k] || 0) / 100) : ""; }
          else setText("sp-v1", sh ? inAmount((sh[k] || 0) / 100) : "—");
        } else { const inp = $("sp-in" + i); if (inp && document.activeElement !== inp && inp.value !== (ad.cust[k] || "")) inp.value = ad.cust[k] || ""; }
        setText("sp-p" + i, total && sh ? Math.round(((sh[k] || 0) / total) * 100) + "%" : "");
      });
    }
  }
  // Under the rows: each person's part, and on a phone's Split page who owes whom
  const line = on ? (cust && !two ? custLeftLine(total) : sharesLine(sh)) : "";
  setText("add-splitnote", line);
  // With Custom, the rows themselves say each part; only what is left to share stays under them
  show("add-splitnote", !!line && !(cust && two) && !(cust && layout === "phone"));
  const vals = sh ? Object.values(sh) : [];
  const equal = sh && ad.sm === "even" && vals.every((v) => v === vals[0]);
  setText("add-each", equal ? t("Each pays {amount}.", { amount: f(vals[0] / 100) }) : cust ? (two ? "" : custLeftLine(total)) : sharesLine(sh));
  show("add-each", !!$("add-each") && !!$("add-each").textContent);
  setText("add-owes", exp && sh ? owesLine(sh, total) : "");
  // The phone's Split page lists the ways, with a checkmark
  const list = $("add-smlist");
  if (list) setHtml("add-smlist", ["even", "income", "custom"].map((k) => '<button type="button" class="w-gr" role="radio" data-sm="' + k + '" aria-checked="' + (ad.sm === k) + '" tabindex="' + (ad.sm === k ? 0 : -1) + '"><span class="k">' + esc(k === "income" ? t("By income") : smLabel(k)) + "</span>" +
    (k === "income" && smLabel(k) !== t("By income") ? '<span class="v">' + esc(smLabel(k).replace(t("By income"), "").trim()) + "</span>" : "") + (ad.sm === k ? icon("check", "w-ack") : k === "custom" ? icon("right", "chev w-ack") : "") + "</button>").join(""));
}
function custRowsHtml(ks, two) {
  return ks.map((k, i) => '<div class="w-gr"><span class="k">' + esc(pname(k)) + '</span><small class="w-apct" id="sp-p' + i + '"></small>' +
    (two && i === 1 ? '<b class="w-aval" id="sp-v1"></b>'
      : '<input ' + (two ? 'id="add-split-a"' : 'id="sp-in' + i + '" data-cust="' + esc(k) + '"') + ' class="w-anum w-aamt" inputmode="decimal" autocomplete="off" placeholder="0' + esc(decSep()) + '00" aria-label="' + esc(t("{name}’s part", { name: pname(k) })) + '">') +
    "</div>").join("");
}
function custLeftLine(total) {
  const ks = keys(), typed = custTyped(), left = total - ks.reduce((s, k) => s + (typed[k] || 0), 0);
  if (!total) return "";
  return left > 0 ? t("{amount} left to share", { amount: f(left / 100) }) : left < 0 ? t("{amount} more than the total", { amount: f(-left / 100) }) : t("All shared");
}
/* "Ana owes Alex 21.25 € for this." */
function owesLine(sh, total) {
  const by = payer(), others = keys().filter((k) => k !== by && (sh[k] || 0) > 0);
  if (!others.length || !total) return "";
  if (others.length === 1) return t("{name} owes {payer} {amount} for this.", { name: pname(others[0]), payer: pname(by), amount: f((sh[others[0]] || 0) / 100) });
  return t("The others owe {payer} {amount} for this.", { payer: pname(by), amount: f(others.reduce((s, k) => s + (sh[k] || 0), 0) / 100) });
}

function renderParts() {
  const box = $("add-parts");
  if (!box) return;
  const options = cache.cats;
  const key = ad.parts.length + "|" + options.length + "|" + layout;
  if (built.parts !== key) {
    built.parts = key;
    box.innerHTML = '<div class="w-gr w-parth"><span class="k" id="lbl-parts">' + t("Split across categories") + '</span><button type="button" class="w-link" data-nosplit>' + t("Don’t split") + "</button></div>" +
      '<div role="group" aria-labelledby="lbl-parts">' + ad.parts.map((p, i) => '<div class="w-gr w-partrow" id="add-part' + i + '"><span class="w-cdot" id="add-pdot' + i + '"></span>' +
        '<span class="w-apop w-partcatw"><select class="w-partcat" data-pc="' + i + '" aria-label="' + esc(t("Category of part {n}", { n: i + 1 })) + '"><option value="">' + t("Pick a category") + "</option>" +
        options.map((c) => '<option value="' + esc(c) + '">' + esc(c) + "</option>").join("") + "</select>" + chev(true) + "</span>" +
        '<input class="w-anum w-aamt w-partamt" data-pa="' + i + '" inputmode="decimal" autocomplete="off" aria-label="' + esc(t("Amount of part {n}", { n: i + 1 })) + '">' +
        (ad.parts.length > 2 ? '<button type="button" class="w-x" data-rmpart="' + i + '" aria-label="' + esc(t("Remove part {n}", { n: i + 1 })) + '">' + icon("x") + "</button>" : "") + "</div>").join("") + "</div>" +
      '<button type="button" class="w-gr add" data-addpart>' + icon("plus") + '<span class="k">' + t("Add a part") + "</span></button>" +
      '<div class="w-gr w-aleft" id="add-left" aria-live="polite"></div>' +
      '<p class="w-err w-glf" id="add-perr" hidden role="alert"></p>';
  }
  const pc = partCents();
  ad.parts.forEach((p, i) => {
    const sel = box.querySelector('[data-pc="' + i + '"]');
    if (sel && sel.value !== p.c) sel.value = p.c;
    const inp = box.querySelector('[data-pa="' + i + '"]');
    if (inp) {
      if (document.activeElement !== inp && inp.value !== p.amt) inp.value = p.amt;
      inp.placeholder = !p.amt && pc[i] > 0 ? inAmount(pc[i] / 100) : "0" + decSep() + "00";
      const bad = p.amt && (isNaN(pc[i]) || pc[i] <= 0);
      inp.setAttribute("aria-invalid", String(!!bad));
    }
    const dot = $("add-pdot" + i);
    if (dot) dot.style.background = p.c ? cc(p.c) : "var(--w-line)";
  });
  const left = partsLeft();
  setHtml("add-left", '<span class="k">' + esc(left >= 0 ? t("Left to assign") : t("Too much")) + '</span><b class="v">' + esc(f(Math.abs(left) / 100)) + "</b>");
  const lb = $("add-left");
  if (lb) lb.classList.toggle("bad", !!left && amount() > 0);
  const er = problem();
  const m = er && er.f === "parts" && er.m ? er.m : "";
  setText("add-perr", m); show("add-perr", !!m);
}

function renderDate() {
  const d = dateOf(), other = ad.date.length === 10, open = !!ad.cal;
  if ($("add-datecell")) {
    // Adding, the day reads Today; editing, the date itself, as Calendar shows an event's
    setText("add-datev", isEdit() ? dShortW(d) : ad.date === "today" ? t("Today") : ad.date === "yesterday" ? t("Yesterday") : dShortW(d));
    $("add-datecell").setAttribute("aria-expanded", String(open));
  } else {
    setHtml("add-date", [["today", t("Today")], ["yesterday", t("Yesterday")]].map(([k, l]) => '<button type="button" data-ad="' + k + '" aria-pressed="' + (ad.date === k) + '">' + l + "</button>").join("") +
      '<button type="button" id="add-pickb" aria-pressed="' + other + '" aria-expanded="' + open + '" aria-controls="add-cal">' + (other ? esc(dShortW(d)) : t("Other…")) + "</button>");
  }
  show("add-cal", open);
  if (!open) return;
  // Without Repeat, only today or earlier
  const max = ad.rep || ad.mode === "rule" ? null : TODAY;
  if (max && ad.calF > max) ad.calF = max;
  setHtml("add-cal", calHtml(ad.cal, d, ad.calF, max));
}
/* The calendar opens on the month of the date, and closes back to what opened it */
function openCal(on) {
  const d = dateOf();
  ad.cal = on ? ym(d) : null;
  ad.calF = d;
  render();
  // All of it in sight, above the phone's main button
  if (on) { focusDay(); $("add-cal").scrollIntoView({ block: "nearest", behavior: "smooth" }); }
}
function focusDay() { const b = $("add-cal").querySelector('[data-cd="' + ad.calF + '"]'); if (b) b.focus({ preventScroll: true }); }
function calClosed() {
  const n = $("add-datecell") || form().querySelector('#add-date [aria-pressed="true"]');
  if (n) n.focus();
}

function renderRepeat() {
  const rule = ad.mode === "rule", fromRule = fromRuleTx(), can = canRepeat();
  show("add-reprow", (can || rule) && !fromRule);
  setText("add-repv", rule && !ad.rep ? shortLabel(Object.assign({}, ad, { rep: true })) : shortLabel(ad));
  const known = !ad.rep && !isEdit() && ad.name.trim() ? state.rules.find((x) => x.n.trim().toLowerCase() === ad.name.trim().toLowerCase() && x.type === ad.type) : null;
  let label = "";
  if (fromRule) {
    const rr = state.rules.find((x) => x.id === ad.edit.rid);
    label = esc(t("Comes from a rule. Saving changes only this one.")) + (rr ? ' <button type="button" class="w-link" data-rule-edit>' + t("Change the rule") + "</button>" : "");
  } else if (known) label = esc(t("Already repeats {rule}. This adds one extra.", { rule: lc1(describe(known)) }));
  setHtml("add-rep-l", label);
  show("add-rep-l", !!label);
}
/* The pages pushed inside the sheet */
function renderPages() {
  const rule = ad.mode === "rule", on = ad.rep || rule;
  if (ad.step === "repeat") {
    setHtml("add-pfreq", freqCells(Object.assign({}, ad, { rep: on }), !rule));
    show("add-custom", on && ad.fq === "custom");
    setVal("add-every", ad.every);
    const unit = $("add-unit");
    if (unit && unit.value !== ad.unit) unit.value = ad.unit;
    show("add-pends", on);
    const es = $("add-endsel");
    if (es && es.value !== ad.end) es.value = ad.end;
    show("add-untilrow", ad.end === "until");
    show("add-countw", ad.end === "count");
    setVal("add-until", ad.until);
    setVal("add-count", ad.count);
    const until = $("add-until");
    if (until) until.min = addD(dateOf(), 1);
    const r = formRule(ad, dateOf());
    setText("add-next", on ? nextText(r) : "");
    show("add-next", on);
    setHtml("add-rsum", on ? notesHtml(r) : "");
    show("add-rsum", on && !!notesHtml(r));
  }
  if (ad.step === "cat") {
    const opts = cache.cats.slice();
    const rows = opts.map((c) => '<button type="button" class="w-gr" data-pcat="' + esc(c) + '" aria-pressed="' + (ad.cat === c) + '">' + tile(c) + '<span class="k">' + esc(c) + "</span>" + (ad.cat === c ? icon("check", "w-ack") : "") + "</button>");
    if (opts.length && !ad.rule) rows.push('<button type="button" class="w-gr" data-psplit><span class="w-ico w-conew">' + icon("split") + '</span><span class="k">' + t("Split across categories") + "</span></button>");
    setHtml("add-pcats", rows.join(""));
  }
}

function renderDup(a) {
  const box = $("add-dup");
  if (!box) return;
  const nm = addName().toLowerCase(), d = dateOf(), skip = new Set((ad.group || (ad.edit ? [ad.edit] : [])).map((x) => x.id));
  const dup = a > 0 && nm && !ad.rule ? state.tx.find((x) => x.d === d && !skip.has(x.id) && Math.abs(x.a - a) < 0.005 && x.n.toLowerCase() === nm) : null;
  box.hidden = !dup;
  if (dup) box.innerHTML = "<b>" + esc(t("Already added?")) + "</b> " + esc(t("{name}, {amount} is already on {date}. Add it only if it really happened twice.", { name: dup.n, amount: f(dup.a), date: dlabL(dup.d) }));
}

/* ---------- phone ---------- */
function renderPhone() {
  setText("add-knext", named() ? t("Done") : t("Next"));
  setHtml("add-catv", ad.cat ? tile(ad.cat) + esc(ad.cat) : t("Pick"));
}
// A page opens over the sheet and comes back to the row that opened it
function goStep(step, from) {
  const box = form();
  keypad(false);
  closeSugg(); closeCat();
  if (ad.step === "main") { ad.scroll = box.scrollTop; ad.from = from || (document.activeElement && document.activeElement.id) || ""; }
  ad.step = step;
  render();
  box.scrollTop = step === "main" ? ad.scroll : 0;
  const target = step === "main" ? (ad.from && $(ad.from)) || $("add-reprow")
    : document.querySelector('[data-pstep="' + step + '"] [aria-checked="true"], [data-pstep="' + step + '"] [aria-pressed="true"]') || document.querySelector('[data-pstep="' + step + '"] .w-gr');
  if (target) target.focus({ preventScroll: true });
}
/* The keypad is open while the amount is typed, in the main button's place */
function keypad(open) {
  const box = form();
  if (!box || layout !== "phone" || box.classList.contains("kp") === open) return;
  box.classList.toggle("kp", open);
  if (open) { closeSugg(); $("add-amtrow").scrollIntoView({ block: "nearest" }); return; }
  const i = $("add-amt");
  if (document.activeElement === i) i.blur();
  normalizeAmount();
}
// Its last key: on to what it was for, or done
function keypadDone() {
  if (!amount()) { ad.amtTried = true; render(); return; }
  keypad(false);
  if (!named()) $("add-name").focus();
}

/* ---------- payee suggestions: a combobox and its listbox ---------- */
function suggOpen() { const b = $("add-sugg"); return b && !b.hidden; }
function closeSugg() { const b = $("add-sugg"), i = $("add-name"); if (b) b.hidden = true; if (i) { i.setAttribute("aria-expanded", "false"); i.removeAttribute("aria-activedescendant"); } }
function renderSugg() {
  const q = ad.name.trim().toLowerCase(), box = $("add-sugg"), inp = $("add-name");
  if (!box || !inp) return;
  // On a phone, before anything is typed: the payees this amount most likely is, none picked yet,
  // and few enough to stay clear of the phone's keyboard
  const likely = !q && layout === "phone" && !isEdit() && !ad.rule;
  ad.sugg = likely ? pickList(cache.payees, ad.type, amount()).slice(0, 3) : !q || ad.rule ? [] : cache.payees
    .filter((x) => x.type === ad.type && x.n.toLowerCase().includes(q) && x.n.toLowerCase() !== q)
    .sort((a, b) => a.n.toLowerCase().indexOf(q) - b.n.toLowerCase().indexOf(q) || b.k - a.k)
    .slice(0, 6);
  if (!ad.sugg.length || document.activeElement !== inp) { closeSugg(); return; }
  ad.hl = Math.min(ad.hl, ad.sugg.length - 1);
  box.innerHTML = ad.sugg.map((x, i) => {
    const rr = state.rules.find((r) => r.n === x.n && r.type === x.type);
    const usual = x.p === "shared" ? t("{category}, usually shared, about {amount}", { category: x.c, amount: f(x.avg) }) : t("{category}, usually {person}, about {amount}", { category: x.c, person: pname(x.p), amount: f(x.avg) });
    const more = rr ? lc1(describe(rr)) : tn(x.k, "{n} time", "{n} times");
    return '<button type="button" role="option" id="add-sg-' + i + '" tabindex="-1" aria-selected="' + (i === ad.hl) + '" class="' + (i === ad.hl ? "hl" : "") + '" data-si="' + i + '">' +
      tile(x.c) + "<span><b>" + esc(x.n) + "</b><small>" + esc(usual + " · " + more) + "</small></span>" + (i === ad.hl ? '<span class="w-kbd"><kbd>↵</kbd></span>' : "<span></span>") + "</button>";
  }).join("");
  box.hidden = false;
  inp.setAttribute("aria-expanded", "true");
  if (ad.hl < 0) inp.removeAttribute("aria-activedescendant"); else inp.setAttribute("aria-activedescendant", "add-sg-" + ad.hl);
}
function validWho(p) {
  if (p === "shared") return couple() ? "shared" : null;
  return person(p) ? String(p) : null;
}
/* A payee typed in full fills in what has not been chosen by hand */
function applyMemory() {
  const q = ad.name.trim().toLowerCase();
  if (!q || isEdit()) return;
  const x = cache.payees.find((p) => p.type === ad.type && p.n.toLowerCase() === q);
  if (!x) return;
  if (!ad.touched.cat && ad.type === "expense" && !ad.split && x.c) ad.cat = x.c;
  if (!ad.touched.who && validWho(x.p)) ad.who = validWho(x.p);
  if (!ad.tags.length) ad.tags = x.tags.slice();
}
function pickPayee(x, keepAmount) {
  ad.name = x.n;
  if (ad.type === "expense" && !ad.split && x.c) ad.cat = x.c;
  if (validWho(x.p)) ad.who = validWho(x.p);
  ad.sm = "even";
  if (!amount() && !keepAmount) ad.amt = inAmount(x.avg);
  ad.tags = x.tags.slice();
  ad.touched.cat = ad.touched.who = 1;
}
function pickSugg(i) {
  const x = ad.sugg[i];
  if (!x) return;
  pickPayee(x);
  const field = $("add-name");
  if (field) field.value = ad.name; // the field has focus, so render() leaves it alone
  closeSugg();
  render();
  // Picked on a phone, it is ready to add: the keyboard goes, to show the button
  if (layout === "phone" && field) field.blur();
}

/* ---------- category on the desktop: a combobox; typing filters, or names a new one ---------- */
function renderCat() {
  setVal("add-cat", ad.cat || "");
  const inp = $("add-cat");
  if (inp) inp.placeholder = cache.cats.length ? t("Pick") : t("Name a category, like Groceries");
  setHtml("add-caticon", ad.cat ? tile(ad.cat) : "");
  // The field is as wide as its text, so the icon sits next to it
  if (inp && document.activeElement !== inp) { inp.style.width = "0"; inp.style.width = Math.min(220, inp.scrollWidth + 2) + "px"; }
}
function catOpen() { const b = $("add-catlist"); return b && !b.hidden; }
const SPLIT = "\u0000split"; // the list's last option: split a receipt across categories
function openCat() {
  ad.catQ = "";
  ad.copts = cache.cats.slice();
  if (ad.copts.length && !ad.rule) ad.copts.push(SPLIT);
  ad.chl = Math.max(0, ad.copts.indexOf(ad.cat));
  renderCatList();
}
function closeCat() {
  const b = $("add-catlist"), i = $("add-cat");
  ad.catQ = null;
  if (b) b.hidden = true;
  if (i) { i.setAttribute("aria-expanded", "false"); i.removeAttribute("aria-activedescendant"); i.value = ad.cat || ""; }
}
function filterCat(q) {
  ad.catQ = q;
  const k = q.trim().toLowerCase();
  // Matches keep their usual order, those starting with what was typed first; a new name comes last
  ad.copts = cache.cats.filter((c) => c.toLowerCase().includes(k)).sort((a, b) => (a.toLowerCase().indexOf(k) > 0) - (b.toLowerCase().indexOf(k) > 0));
  if (k && !cache.cats.some((c) => c.toLowerCase() === k)) ad.copts.push(q.trim());
  ad.chl = 0;
  renderCatList();
}
function renderCatList() {
  const box = $("add-catlist"), inp = $("add-cat");
  if (!box || !inp) return;
  if (!ad.copts.length) { box.hidden = true; inp.setAttribute("aria-expanded", "false"); inp.removeAttribute("aria-activedescendant"); return; }
  box.innerHTML = ad.copts.map((c, i) => {
    if (c === SPLIT) return '<button type="button" role="option" id="add-co-' + i + '" tabindex="-1" aria-selected="' + (i === ad.chl) + '" class="w-cosplit' + (i === ad.chl ? " hl" : "") + '" data-co="' + i + '">' +
      '<span class="w-ico w-conew">' + icon("split") + "</span><span><b>" + t("Split across categories") + "</b></span><span></span></button>";
    const known = cache.cats.includes(c);
    return '<button type="button" role="option" id="add-co-' + i + '" tabindex="-1" aria-selected="' + (i === ad.chl) + '" class="' + (i === ad.chl ? "hl" : "") + '" data-co="' + i + '">' +
      (known ? tile(c) + "<span><b>" + esc(c) + "</b></span>" : '<span class="w-ico w-conew">' + icon("plus") + "</span><span><b>" + esc(c) + "</b><small>" + t("New category") + "</small></span>") +
      (c === ad.cat ? icon("check", "w-coon") : "<span></span>") + "</button>";
  }).join("");
  box.hidden = false;
  inp.setAttribute("aria-expanded", "true");
  inp.setAttribute("aria-activedescendant", "add-co-" + ad.chl);
  const hl = $("add-co-" + ad.chl);
  if (hl) hl.scrollIntoView({ block: "nearest" });
}
function pickCat(i) {
  const c = ad.copts[i];
  if (!c) return;
  if (c === SPLIT) { closeCat(); toggleSplit(); return; }
  ad.cat = c;
  ad.touched.cat = 1;
  closeCat();
  render();
  // Still in the field: what is typed next replaces it; on a phone the keyboard goes
  const inp = $("add-cat");
  if (inp && document.activeElement === inp) { if (layout === "phone") inp.blur(); else inp.select(); }
}

/* ---------- open and close ---------- */
function fillTx(tx) {
  const group = tx.gr ? state.tx.filter((x) => x.gr === tx.gr).sort((a, b) => (a.ca < b.ca ? -1 : a.ca > b.ca ? 1 : 0)) : [];
  reset(tx.type);
  if (group.length > 1) {
    ad.group = group;
    ad.split = true;
    ad.parts = group.map((x) => ({ c: x.c, amt: inAmount(x.a), id: x.id }));
    ad.amt = inAmount(group.reduce((s, x) => s + x.ac, 0) / 100);
  } else {
    ad.edit = tx;
    ad.amt = inAmount(tx.a);
  }
  const first = ad.group ? ad.group[0] : tx;
  ad.cat = first.c;
  ad.name = tx.n;
  ad.who = tx.p === null ? (couple() ? "shared" : me()) : validWho(tx.p) || me();
  ad.by = tx.by && person(tx.by) ? tx.by : me();
  detectShares(first.shc, first.ac, payer());
  ad.date = normDate(tx.d);
  ad.tags = tx.tags.slice();
  ad.note = tx.note || "";
  ad.touched = { cat: 1, who: 1 };
}
function fillRule(r) {
  reset(r.type);
  ad.mode = "rule";
  ad.rule = r;
  ad.amt = inAmount(r.a);
  ad.name = r.n;
  ad.cat = r.c;
  ad.who = r.p === null ? (couple() ? "shared" : me()) : validWho(r.p) || me();
  ad.by = r.by && person(r.by) ? r.by : me();
  detectShares(r.shc, r.ac, payer());
  ad.date = r.start;
  ad.tags = r.tags.slice();
  ad.note = r.note || "";
  ad.rep = true;
  ad.fq = fqOf(r.freq, r.every);
  if (ad.fq === "custom") { ad.every = String(r.every); ad.unit = r.freq; }
  ad.end = r.endDate ? "until" : "never";
  ad.until = r.endDate || "";
  ad.about = !!r.varies;
  ad.touched = { cat: 1, who: 1 };
}
function fill(o) {
  if (o.rule) return fillRule(o.rule);
  if (o.tx) return fillTx(o.tx);
  reset(o.type === "income" ? "income" : "expense");
  if (o.repeat) ad.rep = true;
  if (o.date) ad.date = normDate(o.date);
  if (o.person !== undefined) { const w = validWho(o.person === null ? "shared" : String(o.person)); if (w) { ad.who = w; ad.touched.who = 1; } }
  if (o.name) ad.name = String(o.name);
  if (o.amount) ad.amt = typeof o.amount === "number" ? inAmount(o.amount) : String(o.amount);
  if (o.category && ad.type === "expense") { ad.cat = o.category; ad.touched.cat = 1; }
  if (o.freq && ["daily", "weekly", "monthly", "yearly"].includes(o.freq)) {
    const every = clampInt(o.every, 1, 99, 1);
    ad.fq = fqOf(o.freq, every);
    if (ad.fq === "custom") { ad.every = String(every); ad.unit = o.freq; }
  }
  if (o.about) ad.about = true;
}
function build() {
  layout = isPhone() ? "phone" : "desk";
  built = { split: "", parts: "" };
  $("add-modal").innerHTML = '<form class="w-sheet w-add' + (layout === "phone" ? " w-addp" : "") + '" id="add-form" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="add-title" autocomplete="off" novalidate>' +
    sheetHtml() + "</form>";
}
function focusStart() {
  const i = $("add-amt");
  // Editing, everything shows as it is: nothing selected, no keypad over it
  if (isEdit()) { form().focus({ preventScroll: true }); return; }
  if (i) { i.focus(); if (layout !== "phone") i.select(); }
}
export function openAdd(o) {
  o = o || {};
  const wrap = $("add-modal");
  if (!wrap.hidden || !state.people.length) return;
  opener = document.activeElement;
  hideTip();
  cache = { payees: C.payeeIndex(), cats: C.catUsage(), tags: C.allTags(), incomeW: C.incomeWeights() };
  fill(o);
  build();
  wrap.hidden = false;
  document.documentElement.classList.add("w-addopen");
  render();
  ad.snap = snapshot();
  focusStart();
  if (document.fonts) document.fonts.ready.then(sizeAmount);
}
function closeNow() {
  const wrap = $("add-modal");
  if (wrap.hidden) return;
  wrap.hidden = true;
  wrap.innerHTML = "";
  document.documentElement.classList.remove("w-addopen");
  reset();
  const back = opener;
  opener = null;
  if (back && document.contains(back) && back.focus) back.focus({ preventScroll: true });
}
function snapshot() {
  return JSON.stringify([ad.type, ad.amt.trim(), ad.name.trim(), ad.cat, ad.who, ad.sm, ad.pct, ad.custCents, ad.cust, ad.by, dateOf(), ad.tags, ad.tagDraft.trim(), ad.note.trim(),
    ad.rep, ad.rep ? [ad.fq, ad.every, ad.unit, ad.end, ad.until, ad.count] : 0, ad.split, ad.split ? ad.parts.map((p) => [p.c, p.amt]) : 0]);
}
function discard(then) {
  const ed = isEdit();
  openDialog({
    title: ed ? t("Discard your changes?") : ad.type === "income" ? t("Discard this income?") : t("Discard this expense?"),
    body: "<p>" + esc(ed ? t("{name} stays as it was.", { name: ad.rule ? ad.rule.n : (ad.edit || ad.group[0]).n || t("It") }) : t("Nothing you typed is saved.")) + "</p>",
    kind: "alert", ok: t("Discard"), cancel: t("Keep Editing"), danger: true,
    onOk: () => { then(); },
  });
}
function requestClose() {
  if ($("add-modal").hidden) return;
  if (snapshot() === ad.snap) { closeNow(); return; }
  discard(closeNow);
}
/* Move to another thing in the same sheet (the rule behind a transaction) */
function switchTo(o) {
  const go = () => { fill(o); build(); render(); ad.snap = snapshot(); focusStart(); };
  if (snapshot() === ad.snap) go(); else discard(go);
}

/* ---------- saving ---------- */
function body(euros, category) {
  const c = C.cents(euros), sh = shared();
  return {
    name: ad.name.trim() || category, category, tags: allTagsChosen().map((g) => g.replace(/^#/, "")), amount: (c / 100).toFixed(2),
    type: ad.type, date: dateOf(), person_id: sh ? null : Number(ad.who), shares: sh ? sharesFor(c) : null,
    paid_by: sh && ad.type === "expense" ? Number(payer()) : null, note: ad.note.trim(),
  };
}
function partBodies() {
  const pc = partCents();
  return ad.parts.map((p, i) => Object.assign(body(pc[i] / 100, p.c), { name: ad.name.trim() || p.c }));
}
function ruleBody() {
  const r = formRule(ad, dateOf()), b = body(amount(), ad.cat);
  delete b.date;
  return Object.assign(b, { startDate: r.start, endDate: r.endDate || null, frequency: r.freq, interval: r.every, about: !!ad.about });
}
function ruleOf(raw) {
  const k = ["name", "category", "tags", "amount", "type", "startDate", "endDate", "frequency", "interval", "person_id", "shares", "paid_by", "note", "about"];
  return Object.fromEntries(k.map((x) => [x, raw[x] === undefined ? null : raw[x]]));
}
async function fullRows(list) {
  const rows = await Promise.all(list.map((x) => GET("/transactions/id/" + x.id)));
  return rows.map((r) => r && r[0]).filter(Boolean);
}
async function restoreRows(rows) { if (rows.length) upsertTx(await POST("/transactions/restore", rows)); }
async function deleteRows(list) { await Promise.all(list.map((x) => DEL("/transactions/" + x.id))); removeTx(list.map((x) => x.id)); }
const nameOf = (b) => b.name || b.category;
function waiting(kind, payload, qid) {
  const item = Q.enqueue(kind, payload, qid);
  return { msg: t("No connection. {name} is kept on this device and sent when Wally is back.", { name: nameOf(kind === "group" ? payload[0] : payload) }), undo: () => { Q.dequeue(item.qid); refresh({ tx: true }); }, offline: true };
}

/* A new transaction, or changes to one */
async function saveTx() {
  const b = body(amount(), ad.cat);
  if (ad.edit) {
    const prev = ad.edit;
    upsertTx(await PUT("/transactions/" + prev.id, b));
    return {
      msg: t("Saved {name}, {amount}", { name: nameOf(b), amount: f(amount()) }),
      undo: async () => { upsertTx(await PUT("/transactions/" + prev.id, toApi(prev))); refresh({ tx: true }); },
    };
  }
  let res;
  try { res = await POST("/transactions", b); } catch (e) { if (e.status === 0) return waiting("tx", b); throw e; }
  upsertTx(res);
  return {
    msg: t("Added {name}, {amount}", { name: nameOf(b), amount: f(amount()) }), id: res.id,
    undo: async () => { await DEL("/transactions/" + res.id); removeTx([res.id]); refresh({ tx: true }); },
  };
}
/* A split receipt: new, edited part by part, or turned back into one transaction */
async function saveGroup() {
  const old = ad.group || (ad.edit ? [ad.edit] : []);
  const gid = ad.group ? ad.group[0].gr : null;
  const parts = ad.split ? partBodies() : [body(amount(), ad.cat)];
  const msgName = nameOf(parts[0]);
  const msg = ad.split ? t("Saved {name}, {amount}, split in {n}", { name: msgName, amount: f(amount()), n: parts.length }) : t("Saved {name}, {amount}", { name: msgName, amount: f(amount()) });
  if (!old.length) {
    let res;
    try { res = await POST("/transactions/group", parts); } catch (e) { if (e.status === 0) return waiting("group", parts); throw e; }
    upsertTx(res);
    return {
      msg: t("Added {name}, {amount}, split in {n}", { name: msgName, amount: f(amount()), n: parts.length }),
      undo: async () => { await deleteRows(res.map((x) => ({ id: x.id }))); refresh({ tx: true }); },
    };
  }
  if (gid && parts.length > 1) {
    // Same group: change the parts it has, add new ones, remove the ones taken out
    const kept = old.slice(0, parts.length), gone = old.slice(parts.length), added = [];
    const goneRows = await fullRows(gone);
    for (let i = 0; i < kept.length; i++) upsertTx(await PUT("/transactions/" + kept[i].id, parts[i]));
    for (const p of parts.slice(kept.length)) { const r = await POST("/transactions", Object.assign({}, p, { group_id: gid })); upsertTx(r); added.push(r); }
    await deleteRows(gone);
    return {
      msg,
      undo: async () => {
        for (const x of kept) upsertTx(await PUT("/transactions/" + x.id, toApi(x)));
        await deleteRows(added);
        await restoreRows(goneRows);
        refresh({ tx: true });
      },
    };
  }
  // One transaction becomes a split receipt, or a receipt becomes one transaction again
  const before = await fullRows(old);
  const res = parts.length > 1 ? await POST("/transactions/group", parts) : [await POST("/transactions", parts[0])];
  await deleteRows(old);
  upsertTx(res);
  return { msg, undo: async () => { await deleteRows(res.map((x) => ({ id: x.id }))); await restoreRows(before); refresh({ tx: true }); } };
}
/* A new rule (Repeat on). Its dates up to today become transactions on the server. */
async function saveNewRule() {
  const b = ruleBody();
  const created = await POST("/recurring", b);
  let before = [];
  if (ad.edit) { before = await fullRows([ad.edit]); await deleteRows([ad.edit]); }
  await Promise.all([reloadRules(), reloadLedger()]);
  const r = fromRule(created), made = state.tx.filter((x) => x.rid === created.id).length;
  const extra = made - (r.start <= TODAY ? 1 : 0);
  const vars = { name: nameOf(b), amount: f(amount()), rule: lc1(describe(r)) };
  return {
    msg: extra > 0 ? tn(extra, "Added {name}, {amount}, {rule}, plus {n} up to today", "Added {name}, {amount}, {rule}, plus {n} up to today", vars) : t("Added {name}, {amount}, {rule}", vars),
    undo: async () => {
      await DEL("/recurring/" + created.id, { applyTo: "all" });
      await restoreRows(before);
      await Promise.all([reloadRules(), reloadLedger()]);
      refresh({ tx: true, rules: true });
    },
  };
}
/* Changes to a rule. When it already made transactions, ask which ones change. */
async function saveRule() {
  const old = ad.rule, raw = ruleOf(old.raw), next = ruleBody(), changes = {};
  for (const k in next) {
    const a = next[k], b = raw[k];
    const same = k === "amount" ? Number(a) === Number(b) : k === "shares" ? C.sameShares(a || {}, b || {}) : JSON.stringify(a) === JSON.stringify(b);
    if (!same) changes[k] = a;
  }
  if (["amount", "person_id", "shares", "paid_by"].some((k) => k in changes)) ["amount", "person_id", "shares", "paid_by"].forEach((k) => { changes[k] = next[k]; });
  if (!Object.keys(changes).length) return { msg: t("Nothing changed"), quiet: true };
  const made = state.tx.filter((x) => x.rid === old.id).length;
  let applyTo = "all";
  if (made) {
    applyTo = await askApply(old, made, changes);
    if (!applyTo) return null;
  }
  const res = await PUT("/recurring/" + old.id, Object.assign({}, changes, { applyTo }));
  await Promise.all([reloadRules(), reloadLedger()]);
  const name = res.name || res.category;
  const msg = res.id !== old.id ? t("Saved {name}. The change starts {date}.", { name, date: dShort(res.startDate) })
    : made ? tn(made, "Saved {name} and the {n} transaction it made", "Saved {name} and the {n} transactions it made", { name }) : t("Saved {name}", { name });
  return {
    msg,
    undo: async () => {
      if (res.id !== old.id) {
        await DEL("/recurring/" + res.id, { applyTo: "all" });
        await PUT("/recurring/" + old.id, { endDate: raw.endDate, applyTo: "all" });
      } else await PUT("/recurring/" + old.id, Object.assign({}, raw, { applyTo: "all" }));
      await Promise.all([reloadRules(), reloadLedger()]);
      refresh({ tx: true, rules: true });
    },
  };
}
function askApply(old, made, changes) {
  const nextCharge = nextOf(old);
  const startsLater = !("startDate" in changes) || changes.startDate > TODAY;
  const when = "startDate" in changes ? changes.startDate : nextCharge;
  return new Promise((resolve) => {
    let done = false;
    openDialog({
      title: t("Change {name}?", { name: old.n || old.c }),
      body: '<div class="w-gl w-opts2" role="radiogroup" aria-label="' + esc(t("Which ones change")) + '">' +
        '<label class="w-gr"><span class="k">' + t("From the next charge") + "<small>" +
          esc(startsLater && when ? tn(made, "The {n} it already made stays as it is. The change starts {date}.", "The {n} it already made stay as they are. The change starts {date}.", { date: dShort(when) })
            : startsLater ? tn(made, "The {n} it already made stays as it is.", "The {n} it already made stay as they are.") : t("Not possible with a start date in the past.")) + "</small></span>" +
          '<input type="radio" name="add-apply" value="later"' + (startsLater ? " checked" : " disabled") + "></label>" +
        '<label class="w-gr"><span class="k">' + t("All, including past ones") + "<small>" +
          esc(tn(made, "The {n} it already made changes too.", "The {n} it already made change too.")) + "</small></span>" +
          '<input type="radio" name="add-apply" value="all"' + (startsLater ? "" : " checked") + "></label></div>",
      ok: t("Change"),
      onOk: (root) => { done = true; const c = root.querySelector('input[name="add-apply"]:checked'); resolve(c ? c.value : "later"); },
    });
    const obs = new MutationObserver(() => { if ($("dlg").hidden) { obs.disconnect(); if (!done) resolve(null); } });
    obs.observe($("dlg"), { attributes: true, attributeFilter: ["hidden"] });
  });
}
/* An entry still waiting to be sent: change it where it waits */
function saveQueued() {
  const qid = editing().qid, prev = Q.queueItem(qid);
  if (ad.split) waiting("group", partBodies(), qid); else waiting("tx", body(amount(), ad.cat), qid);
  Q.flushQueue();
  return {
    msg: t("Saved. It is still waiting to be sent."),
    undo: prev ? () => { Q.enqueue(prev.kind, prev.body, prev.qid); refresh({ tx: true }); } : null,
  };
}

async function commit(another) {
  if (ad.busy) return;
  if (!ready()) { ad.amtTried = true; render(); focusMissing(); return; }
  if (isEdit()) another = false;
  ad.busy = true;
  ad.serr = "";
  render();
  let done = null;
  try {
    if (ad.mode === "rule") done = await saveRule();
    else if (pending()) done = saveQueued();
    else if (ad.split || ad.group) done = await saveGroup();
    else if (ad.rep && canRepeat()) done = await saveNewRule();
    else done = await saveTx();
  } catch (e) {
    ad.busy = false;
    ad.serr = e.status === 0 ? t("Wally can’t be reached. Check your connection and try again.") : e.message;
    render();
    const go = $("add-go");
    if (go) go.focus();
    return;
  }
  ad.busy = false;
  if (!done) { render(); return; }
  refresh({ tx: true, rules: ad.mode === "rule" || ad.rep });
  if (!done.quiet || another) toast(done.msg, done.undo || undefined);
  if (another) {
    const keep = { type: ad.type, who: ad.who, sm: ad.sm, pct: ad.pct, cust: ad.cust, by: ad.by, date: ad.date };
    cache.payees = C.payeeIndex();
    reset(keep.type);
    Object.assign(ad, keep);
    ad.touched = { who: 1 };
    render();
    ad.snap = snapshot();
    const i = $("add-amt");
    if (i) i.focus();
  } else closeNow();
}
function focusMissing() {
  const er = problem();
  const box = form();
  if (!box) return;
  let target = null;
  if (ad.step !== "main" && !(er && er.f === "rep" && ad.step === "repeat")) goStep("main");
  if (!amount() || (er && er.f === "amt")) target = $("add-amt");
  if (!target && !named()) { ad.nameTried = true; render(); target = $("add-name"); }
  if (!target && !ad.split && !ad.cat) target = $("add-cat") || $("add-catrow");
  if (!target && er) {
    if (er.f === "parts") target = box.querySelector('#add-parts select[data-pc]:invalid, #add-parts [aria-invalid="true"]') || [...box.querySelectorAll("#add-parts [data-pc]")].find((s) => !s.value) || box.querySelector("#add-parts [data-pa]");
    else if (er.f === "cust") { if (layout === "phone") { goStep("split"); return; } target = box.querySelector("[data-cust]"); }
    else if (er.f === "date") target = $("add-pickb") || $("add-datecell");
    else if (er.f === "rep") { if (ad.step !== "repeat") { ad.step = "repeat"; render(); } target = $("add-until"); }
  }
  if (target) target.focus();
}

/* Delete from the edit sheet, with Undo */
async function deleteCurrent() {
  const list = ad.group || [ad.edit];
  const name = list[0].n || list[0].c;
  if (pending()) {
    const item = Q.queueItem(editing().qid);
    Q.dequeue(item ? item.qid : editing().qid);
    closeNow();
    refresh({ tx: true });
    toast(t("Deleted {name}", { name }), item ? () => { Q.enqueue(item.kind, item.body, item.qid); refresh({ tx: true }); } : undefined);
    return;
  }
  try {
    const rows = await fullRows(list);
    await deleteRows(list);
    closeNow();
    refresh({ tx: true });
    toast(t("Deleted {name}", { name }), async () => { await restoreRows(rows); refresh({ tx: true }); });
  } catch (e) {
    ad.serr = e.message;
    render();
  }
}

/* ---------- typing in the sheet ---------- */
function normalizeAmount() {
  const r = C.readAmount(ad.amt);
  if (r.ok && (r.expr || r.partial) && r.v > 0) { ad.amt = inAmount(r.v); const i = $("add-amt"); if (i) i.value = ad.amt; render(); }
}
function addTag() {
  const g = cleanTag(ad.tagDraft);
  ad.tagDraft = "";
  const i = $("add-tag");
  if (i) i.value = "";
  if (g && !ad.tags.includes(g)) ad.tags.push(g);
  render();
}
function setType(type) {
  if (ad.type === type) return;
  ad.type = type;
  ad.cat = type === "income" ? C.incomeCategory() : ad.edit && ad.edit.type === "expense" ? ad.edit.c : null;
  if (type === "income") ad.split = false;
  ad.touched.cat = 0;
  applyMemory();
  render();
}
function toggleSplit() {
  if (!ad.split) {
    ad.split = true;
    ad.rep = false;
    ad.parts = [{ c: ad.cat || "", amt: "" }, { c: "", amt: "" }];
    render();
    const s = form().querySelector('[data-pc="' + (ad.cat ? 1 : 0) + '"]');
    if (s) s.focus();
  } else {
    ad.split = false;
    ad.cat = (ad.parts.find((p) => p.c) || {}).c || ad.cat;
    ad.parts = [];
    render();
    const c = $("add-cat");
    if (c) c.focus();
  }
}
function setSm(k) {
  if (k === "custom" && ad.sm !== "custom") seedCustom();
  ad.sm = k;
  render();
}
function refocus(box, attr, val) { const b = $(box); if (!b) return; const n = [...b.querySelectorAll("[" + attr + "]")].find((x) => x.getAttribute(attr) === val); if (n) n.focus(); }

function onClick(ev) {
  const at = (sel) => ev.target.closest(sel);
  let x;
  if (at("[data-close]")) return requestClose();
  if ((x = at("[data-at]"))) return setType(x.dataset.at);
  if (at("[data-nosplit]")) return toggleSplit();
  if (at("#add-cat")) { if (!catOpen()) openCat(); return; }
  if ((x = at("[data-aw]"))) {
    ad.who = x.dataset.aw; ad.touched.who = 1; render(); refocus("add-who", "data-aw", ad.who); return;
  }
  if ((x = at("[data-sm]"))) { setSm(x.dataset.sm); refocus("add-smlist", "data-sm", ad.sm); return; }
  // Its own attribute: a NUL in markup (SPLIT) reads back as U+FFFD, so it never matched
  if (at("[data-psplit]")) { goStep("main"); toggleSplit(); return; }
  if ((x = at("[data-pcat]"))) {
    ad.cat = x.dataset.pcat; ad.touched.cat = 1; goStep("main"); return;
  }
  if ((x = at("[data-ad]"))) { ad.date = x.dataset.ad; ad.cal = null; render(); refocus("add-date", "data-ad", ad.date); return; }
  if (at("#add-pickb") || at("#add-datecell")) return openCal(!ad.cal);
  if ((x = at("[data-cd]"))) { ad.date = normDate(x.dataset.cd); ad.cal = null; render(); calClosed(); return; }
  if ((x = at("[data-cm]"))) {
    const k = +x.dataset.cm;
    ad.cal = ymAdd(ad.cal[0], ad.cal[1], k);
    ad.calF = monthStep(ad.calF, k);
    render();
    const b = $("add-cal").querySelector('[data-cm="' + k + '"]');
    if (b && !b.disabled) b.focus(); else focusDay();
    return;
  }
  if ((x = at("[data-tg]"))) { ad.tags = ad.tags.filter((g) => g !== x.dataset.tg); render(); const i = $("add-tag"); if (i) i.focus(); return; }
  if ((x = at("[data-pfq]"))) {
    const k = x.dataset.pfq;
    if (k === "never") ad.rep = false; else { ad.rep = true; ad.fq = k; }
    render();
    if (k === "custom") $("add-every").focus(); else refocus("add-pfreq", "data-pfq", k);
    return;
  }
  if (at("[data-addpart]")) { ad.parts.push({ c: "", amt: "" }); render(); const s = form().querySelector('[data-pc="' + (ad.parts.length - 1) + '"]'); if (s) s.focus(); return; }
  if ((x = at("[data-rmpart]"))) { ad.parts.splice(+x.dataset.rmpart, 1); render(); const s = form().querySelector("[data-addpart]"); if (s) s.focus(); return; }
  if (at("#add-del")) return deleteCurrent();
  if (at("[data-rule-edit]")) { const rr = state.rules.find((r) => r.id === ad.edit.rid); if (rr) switchTo({ rule: rr }); return; }
  if ((x = at("[data-k]"))) {
    const k = x.dataset.k;
    if (k === "next") return keypadDone();
    ad.amt = press(ad.amt, k);
    ad.amtTried = false;
    $("add-amt").value = ad.amt; // the field keeps the focus, so render() leaves it alone
    render();
    return;
  }
  if ((x = at("[data-step]"))) return goStep(x.dataset.step, x.id);
}
function onInput(ev) {
  const n = ev.target, id = n.id;
  if (id === "add-amt") { ad.amt = n.value; ad.amtTried = false; ad.custCents = null; render(); return; }
  if (id === "add-name") { ad.name = n.value; ad.hl = n.value.trim() ? 0 : -1; applyMemory(); renderSugg(); render(); return; }
  if (id === "add-note") { ad.note = n.value; return; }
  // A space or a comma ends a tag, so the next one can be typed straight away (a pasted "holiday food" is two)
  if (id === "add-tag") {
    if (!/[\s,]/.test(n.value)) { ad.tagDraft = n.value; return; }
    const parts = n.value.split(/[\s,]+/), rest = parts.pop();
    for (const p of parts) { const g = cleanTag(p); if (g && !ad.tags.includes(g)) ad.tags.push(g); }
    ad.tagDraft = rest;
    n.value = rest;
    render();
    return;
  }
  if (id === "add-cat") { filterCat(n.value); return; }
  if (id === "add-split-r") { ad.sm = "custom"; ad.pct = +n.value; ad.custCents = null; render(); return; }
  if (id === "add-split-a") {
    const a = amount(), r = C.readAmount(n.value);
    if (a > 0 && r.ok && !r.empty) { const c = Math.max(0, Math.min(C.cents(a), C.cents(r.v))); ad.custCents = c; ad.custFor = C.cents(a); ad.pct = (c / C.cents(a)) * 100; }
    render();
    return;
  }
  if (n.dataset.cust !== undefined) { ad.cust[n.dataset.cust] = n.value; render(); return; }
  if (n.dataset.pa !== undefined) { ad.parts[+n.dataset.pa].amt = n.value; render(); return; }
  if (id === "add-every") { ad.every = n.value; render(); return; }
  if (id === "add-count") { ad.count = n.value; render(); return; }
  if (id === "add-until") { ad.until = n.value; render(); return; }
}
function onChange(ev) {
  const n = ev.target, id = n.id;
  if (id === "add-unit") { ad.unit = n.value; render(); return; }
  if (id === "add-bysel") { ad.by = n.value; ad.custCents = null; render(); return; }
  if (id === "add-smsel") { setSm(n.value); return; }
  if (id === "add-endsel") {
    ad.end = n.value;
    if (ad.end === "until" && !ad.until) { const [y, m] = ym(dateOf()), q = ymAdd(y, m, 6); ad.until = ds(q[0], q[1], Math.min(+dateOf().slice(8), dim(q[0], q[1]))); }
    render();
    const focusIn = ad.end === "until" ? $("add-until") : ad.end === "count" ? $("add-count") : null;
    if (focusIn) focusIn.focus();
    return;
  }
  if (id === "add-tag" && cache.tags.includes(cleanTag(n.value))) { ad.tagDraft = n.value; addTag(); return; }
  if (n.dataset.pc !== undefined) { ad.parts[+n.dataset.pc].c = n.value; render(); return; }
  if (id === "add-every") { ad.every = String(clampInt(n.value, 1, 99, 1)); n.value = ad.every; render(); return; }
  if (id === "add-count") { ad.count = String(clampInt(n.value, 2, 999, 2)); n.value = ad.count; render(); }
}
function radioKeys(ev) {
  const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[ev.key];
  const home = ev.key === "Home", end = ev.key === "End";
  if (!dir && !home && !end) return false;
  const box = ev.target.closest('[role="radiogroup"]');
  if (!box) return false;
  const rs = [...box.querySelectorAll('[role="radio"]')].filter((r) => !r.hidden && r.offsetParent !== null);
  const i = rs.indexOf(ev.target);
  if (i < 0) return false;
  ev.preventDefault();
  const rtl = document.documentElement.dir === "rtl" && (ev.key === "ArrowLeft" || ev.key === "ArrowRight") ? -1 : 1;
  const j = home ? 0 : end ? rs.length - 1 : (i + dir * rtl + rs.length) % rs.length;
  rs[j].click();
  return true;
}
function onKey(ev) {
  const wrap = $("add-modal");
  if (wrap.hidden || dialogOpen()) return;
  const n = ev.target, id = n && n.id;
  if (ev.key === "Escape") {
    ev.preventDefault();
    if (suggOpen()) { closeSugg(); return; }
    if (catOpen()) { closeCat(); n.select(); return; }
    if (ad.cal) { ad.cal = null; render(); calClosed(); return; }
    if (layout === "phone" && form().classList.contains("kp")) { keypad(false); return; }
    if (ad.step !== "main") { goStep("main"); return; }
    requestClose();
    return;
  }
  // Tab after typing takes the highlighted category, as Enter does
  if (ev.key === "Tab" && id === "add-cat" && catOpen() && ad.catQ.trim()) pickCat(ad.chl);
  if (ev.key === "Tab") { trapFocus(form(), ev); return; }
  if (!wrap.contains(n)) return;
  if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); commit(ev.shiftKey); return; }
  if (id === "add-name" && suggOpen()) {
    if (ev.key === "ArrowDown") { ev.preventDefault(); ad.hl = Math.min(ad.sugg.length - 1, ad.hl + 1); renderSugg(); return; }
    if (ev.key === "ArrowUp") { ev.preventDefault(); ad.hl = Math.max(0, ad.hl - 1); renderSugg(); return; }
  }
  if (id === "add-cat" && (ev.key === "ArrowDown" || ev.key === "ArrowUp")) {
    ev.preventDefault();
    if (!catOpen()) openCat();
    else { ad.chl = (ad.chl + (ev.key === "ArrowDown" ? 1 : -1) + ad.copts.length) % ad.copts.length; renderCatList(); }
    return;
  }
  if (id === "add-tag" && ev.key === "Backspace" && !n.value && ad.tags.length) { ad.tags.pop(); render(); return; }
  if (n.dataset && n.dataset.cd) {
    const to = calKey(ev.key, n.dataset.cd, document.documentElement.dir === "rtl");
    if (!to) return;
    ev.preventDefault();
    const max = ad.rep || ad.mode === "rule" ? null : TODAY;
    ad.calF = max && to > max ? max : to;
    ad.cal = ym(ad.calF);
    render();
    focusDay();
    return;
  }
  if (ev.key === "Enter" && !ev.shiftKey && !ev.altKey) {
    if (id === "add-amt") { ev.preventDefault(); normalizeAmount(); if (layout === "phone") keypadDone(); else $("add-name").focus(); return; }
    if (id === "add-name") {
      ev.preventDefault();
      if (suggOpen() && ad.hl >= 0) pickSugg(ad.hl);
      else if (layout !== "phone") commit(false);
      else if (named()) n.blur();
      else { ad.nameTried = true; render(); }
      return;
    }
    if (id === "add-cat") { ev.preventDefault(); if (catOpen()) pickCat(ad.chl); else if (layout === "phone") n.blur(); else commit(false); return; }
    if (id === "add-tag") { ev.preventDefault(); addTag(); return; }
    if (id === "add-newcat") { ev.preventDefault(); const v = n.value.trim(); if (v) { ad.cat = v; ad.touched.cat = 1; n.value = ""; goStep("main"); } return; }
    if (n.dataset && n.dataset.pa !== undefined) {
      ev.preventDefault();
      const i = +n.dataset.pa, pc = partCents();
      if (!ad.parts[i].amt && pc[i] > 0) { ad.parts[i].amt = inAmount(pc[i] / 100); n.value = ad.parts[i].amt; render(); }
      const nx = form().querySelector('[data-pc="' + (i + 1) + '"]') || form().querySelector("[data-addpart]");
      if (nx) nx.focus();
      return;
    }
    if (n.tagName === "INPUT") { ev.preventDefault(); return; }
  }
  radioKeys(ev);
}

/* ---------- wiring, once ---------- */
function init() {
  const wrap = $("add-modal");
  if (!wrap || wrap.dataset.ready) return;
  wrap.dataset.ready = "1";
  wrap.addEventListener("mousedown", (ev) => {
    if (ev.target === wrap) { ev.preventDefault(); requestClose(); return; }
    const s = ev.target.closest("[data-si]");
    if (s) { ev.preventDefault(); pickSugg(+s.dataset.si); }
    const co = ev.target.closest("[data-co]");
    if (co) { ev.preventDefault(); pickCat(+co.dataset.co); }
    // Removing a tag keeps the focus, and anything half typed, in the tag field
    if (ev.target.closest("[data-tg]")) ev.preventDefault();
    // Keys leave the focus, and the caret, in the amount
    if (ev.target.closest("#add-keypad")) ev.preventDefault();
  });
  // A tap on the amount opens the keypad, also when the field still has focus; a tap anywhere else closes it
  wrap.addEventListener("pointerdown", (ev) => {
    if (layout !== "phone" || !form()) return;
    if (ev.target.closest("#add-amtrow")) keypad(true);
    else if (!ev.target.closest("#add-keypad, #add-type")) keypad(false);
  });
  wrap.addEventListener("click", onClick);
  wrap.addEventListener("input", onInput);
  wrap.addEventListener("change", onChange);
  wrap.addEventListener("submit", (ev) => { ev.preventDefault(); commit(false); });
  wrap.addEventListener("focusin", (ev) => {
    const id = ev.target.id;
    if (id === "add-name") { if (!ad.name.trim()) ad.hl = -1; renderSugg(); }
    if (id === "add-cat") { openCat(); ev.target.select(); }
    if (id === "add-amt") keypad(true);
    else if (/^(INPUT|SELECT|TEXTAREA)$/.test(ev.target.tagName)) keypad(false);
  });
  wrap.addEventListener("focusout", (ev) => {
    if (ev.target.id === "add-name") setTimeout(() => { if (document.activeElement !== $("add-name")) closeSugg(); }, 150);
    if (ev.target.id === "add-cat") closeCat(); // left without picking: back to the category it had
    if (ev.target.id === "add-amt" && layout !== "phone") normalizeAmount();
    if (ev.target.id === "add-tag" && ad.tagDraft.trim()) addTag();
  });
  document.addEventListener("keydown", onKey);
  // Crossing the phone breakpoint while open redraws the sheet in the other layout
  matchMedia("(max-width: 767px)").addEventListener("change", () => {
    if (wrap.hidden) return;
    const keepFocus = document.activeElement && document.activeElement.id;
    build(); render();
    const n = keepFocus && $(keepFocus);
    if (n) n.focus(); else focusStart();
  });
  Q.initQueue();
}
init();
