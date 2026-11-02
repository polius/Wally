/* The add sheet's pieces: the phone's amount and keypad, and the pages pushed inside the sheet on both
   layouts (Repeat; on a phone also Category and Split). The phone types the amount on a keypad with + and −,
   open only while the amount is typed. The pieces shared with the desktop sheet keep the same ids. */
import { t, esc, icon, decSep, symbol, state, TODAY, span } from "../core.js";
import { FQ_LABELS, UNITS } from "./repeat.js";

export const isPhone = () => matchMedia("(max-width: 767px)").matches;

function cur() { return '<span class="cur" aria-hidden="true">' + esc(symbol()) + "</span>"; }
function amountField() {
  const left = !state.currency || state.currency.position !== "right";
  return (left ? cur() : "") +
    '<input id="add-amt" inputmode="none" autocomplete="off" placeholder="0' + esc(decSep()) + '00" aria-label="' + esc(t("Amount")) + '" aria-describedby="add-calc add-aerr">' +
    (left ? "" : cur());
}
const KEYS = () => ["1", "2", "3", "+", "4", "5", "6", "−", "7", "8", "9", "back", decSep(), "0", "00", "next"];
function keyHtml(k) {
  if (k === "back") return '<button type="button" class="op" data-k="back" aria-label="' + esc(t("Delete last digit")) + '">' + icon("back") + "</button>";
  if (k === "next") return '<button type="button" class="go" data-k="next" id="add-knext">' + t("Next") + "</button>";
  const op = k === "+" || k === "−";
  return '<button type="button"' + (op ? ' class="op"' : "") + ' data-k="' + esc(k) + '"' + (op ? ' aria-label="' + esc(k === "+" ? t("Plus") : t("Minus")) + '"' : "") + ">" + esc(k) + "</button>";
}

export const KEYPAD = () => '<div class="w-keys k4 w-pkeys" id="add-keypad" role="group" aria-label="' + esc(t("Keypad")) + '">' + KEYS().map(keyHtml).join("") + "</div>";
export const chev = (down) => icon(down ? "down" : "right", "chev");
/* A page pushed inside the sheet (Repeat, Category, Split): ‹ Back · title */
export function pageHead(title) {
  return '<div class="w-grab" aria-hidden="true"></div><div class="w-ah w-ahp"><button type="button" class="w-alink w-aback" data-step="main">' + icon("left") + t("Back") + '</button><b class="w-atitle">' + title + "</b><span></span></div>";
}
/* The amount on a phone: typed on the keypad */
export function phoneAmount() {
  return '<div class="w-pamt" id="add-amtrow">' + amountField() + '</div><p class="w-pcalc" id="add-calc" aria-live="polite"></p>';
}
/* Repeat, a page of its own on both layouts, like Calendar's */
export function repeatPage() {
  return '<section class="w-apage" data-pstep="repeat" hidden>' + pageHead(t("Repeat")) +
    '<div class="w-gl" id="add-pfreq" role="radiogroup" aria-label="' + esc(t("How often")) + '"></div>' +
    '<div class="w-gl" id="add-custom" hidden><div class="w-gr"><span class="k" id="lbl-every">' + t("Every") + '</span><span class="v w-aevery"><input id="add-every" type="number" min="1" max="99" inputmode="numeric" class="w-anum" aria-labelledby="lbl-every">' +
      '<span class="w-apop"><select id="add-unit" aria-label="' + esc(t("Unit")) + '">' + UNITS().map(([v, l]) => '<option value="' + v + '">' + l + "</option>").join("") + "</select>" + chev(true) + "</span></span></div></div>" +
    '<div class="w-gl" id="add-pends"><div class="w-gr"><span class="k" id="lbl-ends">' + t("End repeat") + '</span><span class="v w-apop"><select id="add-endsel" aria-labelledby="lbl-ends">' +
      '<option value="never">' + t("Never") + '</option><option value="until">' + t("On a date") + '</option><option value="count">' + t("After a number of times") + "</option></select>" + chev() + "</span></div>" +
      '<div class="w-gr" id="add-untilrow" hidden><span class="k" id="lbl-until">' + t("End date") + '</span><input type="date" id="add-until" class="w-adate" aria-labelledby="lbl-until"></div>' +
      '<div class="w-gr" id="add-countw" hidden><span class="k" id="lbl-count">' + t("Times") + '</span><input id="add-count" type="number" min="2" max="999" inputmode="numeric" class="w-anum" aria-labelledby="lbl-count"></div></div>' +
    '<p class="w-err w-glf" id="add-rerr" hidden role="alert"></p>' +
    '<p class="w-glf w-anext" id="add-next"></p><p class="w-glf" id="add-rsum"></p>' +
    "</section>";
}
/* Category on a phone: a page with the list, a new one, or split across categories */
export function catPage() {
  return '<section class="w-apage" data-pstep="cat" hidden>' + pageHead(t("Category")) +
    '<div class="w-gl" id="add-pcats" role="group" aria-label="' + esc(t("Category")) + '"></div>' +
    '<div class="w-gl"><label class="w-gr">' + icon("plus", "w-aplus") + '<input id="add-newcat" autocomplete="off" enterkeyhint="done" placeholder="' + esc(t("New category")) + '" aria-label="' + esc(t("New category")) + '"></label></div>' +
    "</section>";
}
/* How a shared cost is split, on a phone: a page with the ways, each person's part and who paid */
export function splitPage() {
  return '<section class="w-apage" data-pstep="split" hidden>' + pageHead(t("Split")) +
    '<div class="w-gl" id="add-smlist" role="radiogroup" aria-label="' + esc(t("How to share")) + '"></div>' +
    '<div class="w-gl" id="add-custrows" hidden></div>' +
    '<p class="w-glf" id="add-each"></p>' +
    '<p class="w-err w-glf" id="add-cerr" hidden role="alert"></p>' +
    '<div class="w-gl" id="add-bygrp"><div class="w-gr"><span class="k" id="lbl-by">' + t("Paid by") + '</span><span class="v w-apop"><select id="add-bysel" aria-labelledby="lbl-by"></select>' + chev(false) + "</span></div></div>" +
    '<p class="w-glf" id="add-owes"></p>' +
    "</section>";
}
/* The category field on the desktop: pick from its list, or type to filter or name a new one */
export function catBox() {
  return '<div class="w-catbox"><span class="w-caticon" id="add-caticon" aria-hidden="true"></span>' +
    '<input id="add-cat" autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-controls="add-catlist" aria-expanded="false" aria-labelledby="lbl-cat" enterkeyhint="done">' + icon("down", "w-catchev") +
    '<div class="w-sugg w-catlist" id="add-catlist" hidden role="listbox" aria-labelledby="lbl-cat"></div></div>';
}
export function typeSeg() {
  return '<div class="w-seg" role="group" aria-label="' + esc(t("Type")) + '" id="add-type"><button type="button" data-at="expense" aria-pressed="true">' + t("Expense") + '</button><button type="button" data-at="income" aria-pressed="false">' + t("Income") + "</button></div>";
}

/* Keypad: what a key does to the amount typed so far */
export function press(value, key) {
  const v = value || "";
  if (key === "back") return v.slice(0, -1);
  if (key === "+" || key === "−") {
    if (!v) return v;
    return /[+−\-]$/.test(v) ? v.slice(0, -1) + key : v + key;
  }
  if (key === "." || key === ",") {
    const lastPart = v.split(/[+−\-]/).pop();
    if (/[.,]/.test(lastPart)) return v;
    return v + (lastPart ? "" : "0") + key;
  }
  // At most two decimals in each part of a sum
  const lastPart = v.split(/[+−\-]/).pop();
  const dec = lastPart.match(/[.,](\d*)$/);
  if (dec && dec[1].length + key.length > 2) return v;
  if (lastPart === "0" && key !== "00") return v.slice(0, -1) + key;
  if (!lastPart && key === "00") return v + "0";
  return v + key;
}

/* Payees to suggest before a name is typed. The amount just typed says the most (2,40 is the café, 64 the
   supermarket), then how often and how lately the payee was used */
export function pickList(payees, type, amount) {
  // How often and how lately, times how likely this amount is there: a payee whose amounts vary
  // a lot (a supermarket) makes any one amount less likely than one that always costs about that
  const score = (x) => {
    const z = (Math.log(amount) - x.lmed) / x.lspread;
    return x.k90 / (1 + (span(x.last, TODAY) - 1) / 30) * (amount > 0 ? 1 / (x.lspread * (1 + z * z)) : 1);
  };
  return payees.filter((x) => x.type === type && x.k90 > 0)
    .map((x) => [x, score(x)]).sort((a, b) => b[1] - a[1]).slice(0, 4).map((e) => e[0]);
}
/* Repeat as rows with a checkmark: Never, Every day … Custom */
export function freqCells(ad, canStop) {
  const items = (canStop ? [["never", t("Never")]] : []).concat(FQ_LABELS());
  return items.map(([k, label]) => {
    const on = k === "never" ? !ad.rep : ad.rep && ad.fq === k;
    return '<button type="button" class="w-gr" role="radio" aria-checked="' + on + '" tabindex="' + (on ? 0 : -1) + '" data-pfq="' + k + '"><span class="k">' + label + "</span>" +
      (on ? icon("check", "w-ack") : k === "custom" ? icon("right", "chev w-ack") : "") + "</button>";
  }).join("");
}
