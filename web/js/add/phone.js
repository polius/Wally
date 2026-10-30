/* The add sheet on a phone: everything on one page, and Repeat as its own sheet. The amount is typed on a
   keypad with + and −, open only while the amount is typed; under it, what it was for, which suggests the
   payees that amount most likely is; then the details. The main button always shows the amount and sits
   in thumb reach. The pieces shared with the desktop sheet keep the same ids. */
import { t, esc, icon, decSep, symbol, state, TODAY, span } from "../core.js";
import { FQ_LABELS, UNITS } from "./repeat.js";

export const isPhone = () => matchMedia("(max-width: 767px)").matches;

function cur() { return '<span class="cur" aria-hidden="true">' + esc(symbol()) + "</span>"; }
function amountField() {
  const left = !state.currency || state.currency.position !== "right";
  return (left ? cur() : "") +
    '<input id="add-amt" inputmode="none" autocomplete="off" placeholder="0" aria-label="' + esc(t("Amount")) + '" aria-describedby="add-calc add-aerr">' +
    (left ? "" : cur());
}
const CK = '<b class="ck" aria-hidden="true"><svg class="i"><use href="#i-check"/></svg></b>';
const KEYS = () => ["1", "2", "3", "+", "4", "5", "6", "−", "7", "8", "9", "back", decSep(), "0", "00", "next"];
function keyHtml(k) {
  if (k === "back") return '<button type="button" class="op" data-k="back" aria-label="' + esc(t("Delete last digit")) + '">' + icon("back") + "</button>";
  if (k === "next") return '<button type="button" class="go" data-k="next" id="add-knext">' + t("Next") + "</button>";
  const op = k === "+" || k === "−";
  return '<button type="button"' + (op ? ' class="op"' : "") + ' data-k="' + esc(k) + '"' + (op ? ' aria-label="' + esc(k === "+" ? t("Plus") : t("Minus")) + '"' : "") + ">" + esc(k) + "</button>";
}

/* The whole phone sheet: the page, and Repeat over it */
export function phoneHtml() {
  return '<h2 class="vh" id="add-title"></h2>' +
    '<section class="w-pstep" data-pstep="main">' +
      '<div class="w-grab" aria-hidden="true"></div>' +
      '<div class="w-mh"><button type="button" class="w-plink" data-close>' + t("Cancel") + "</button>" + typeSeg() + "</div>" +
      '<span class="w-pill w-peditp" id="add-editing" hidden></span>' +
      '<div class="w-pamt" id="add-amtrow">' + amountField() + '</div>' +
      '<p class="w-pcalc" id="add-calc" aria-live="polite"></p>' +
      '<p class="w-err w-pcenter" id="add-aerr" hidden role="alert"></p>' +
      '<div id="add-namerow"><div class="w-plabel" id="lbl-name"></div>' +
        '<div class="w-input"><input id="add-name" autocomplete="off" aria-labelledby="lbl-name" aria-required="true" aria-describedby="add-nerr" role="combobox" aria-autocomplete="list" aria-controls="add-sugg" aria-expanded="false" enterkeyhint="done"><div class="w-sugg" id="add-sugg" hidden role="listbox" aria-label="' + esc(t("Known payees")) + '"></div></div></div>' +
      '<p class="w-err" id="add-nerr" hidden role="alert"></p>' +
      '<div id="add-catrow"><div class="w-plabel" id="lbl-cat">' + t("Category") + "</div>" + catBox() + "</div>" +
      '<div class="w-sub w-parts" id="add-parts" hidden></div>' +
      '<p class="w-budget" id="add-budget" hidden></p>' +
      '<div id="add-whorow"><div class="w-plabel" id="lbl-who"></div><div class="w-chips w-pscroll" id="add-who" role="radiogroup" aria-labelledby="lbl-who"></div></div>' +
      '<div class="w-psplit" id="add-split" hidden>' + splitInner(false) + "</div>" +
      '<div class="w-cells" id="add-cells">' +
        '<label class="w-cell" id="add-bycell"><span>' + t("Paid by") + '</span><select id="add-bysel" class="w-cellsel"></select></label>' +
        '<div class="w-cell" id="add-eachcell"><span>' + t("Each pays") + '</span><b id="add-each"></b></div>' +
        '<button type="button" class="w-cell w-pdate" id="add-datecell" aria-expanded="false" aria-controls="add-cal"><span id="lbl-date"></span><b id="add-datev"></b></button>' +
        '<div class="w-dcal w-pdcal" id="add-cal" hidden role="group" aria-labelledby="lbl-date"></div>' +
        '<p class="w-err w-pcell" id="add-derr" hidden role="alert"></p>' +
        '<button type="button" class="w-cell" id="add-repcell" data-step="repeat"><span>' + t("Repeat") + '</span><b class="acc" id="add-repv"></b></button>' +
        '<div class="w-cell w-pnote" id="add-reprule" hidden><span id="add-rep-l"></span></div>' +
        '<div class="w-cell w-ptags"><span id="lbl-tags">' + t("Tags") + '</span><div class="w-chips" role="group" aria-labelledby="lbl-tags"><span id="add-tags" class="w-contents"></span><input id="add-tag" class="w-mini" list="add-taglist" autocomplete="off" aria-label="' + esc(t("Add a tag")) + '"><datalist id="add-taglist"></datalist></div></div>' +
        '<label class="w-cell"><span>' + t("Note") + '</span><input id="add-note" class="w-cellin" autocomplete="off" placeholder="' + esc(t("Optional")) + '"></label>' +
      "</div>" +
      '<p class="w-dup" id="add-dup" hidden></p>' +
      '<p class="w-err" id="add-serr" hidden role="alert"></p>' +
      '<div class="w-pfoot"><button class="w-btn primary w-submit" type="submit" id="add-go"></button>' +
        '<div class="w-cells" id="add-delcell" hidden><button type="button" class="w-cell w-pdel" id="add-del">' + t("Delete") + "</button></div></div>" +
      // In the main button's place while the amount is typed
      '<div class="w-keys k4 w-pkeys" id="add-keypad" role="group" aria-label="' + esc(t("Keypad")) + '">' + KEYS().map(keyHtml).join("") + "</div>" +
    "</section>" +
    /* Repeat */
    '<section class="w-pstep" data-pstep="repeat">' +
      '<div class="w-grab" aria-hidden="true"></div>' +
      '<div class="w-mh"><button type="button" class="w-plink" data-step="main">' + icon("left") + t("Back") + '</button><b class="w-ptitle">' + t("Repeat") + '</b><button type="button" class="w-plink w-pdone" data-step="main">' + t("Done") + "</button></div>" +
      '<div class="w-cells" id="add-pfreq" role="radiogroup" aria-label="' + esc(t("How often")) + '"></div>' +
      '<div class="w-cells w-pcustom" id="add-custom" hidden><div class="w-cell"><span>' + t("Every") + '</span><span class="w-inline"><input id="add-every" type="number" min="1" max="99" inputmode="numeric" class="w-mini w-num" aria-label="' + esc(t("Interval")) + '"><select id="add-unit" class="w-mini" aria-label="' + esc(t("Unit")) + '">' + UNITS().map(([v, l]) => '<option value="' + v + '">' + l + "</option>").join("") + "</select></span></div></div>" +
      '<div id="add-pends"><div class="w-plabel" id="lbl-ends">' + t("Ends") + '</div><div class="w-cells" id="add-end" role="radiogroup" aria-labelledby="lbl-ends">' +
        '<div class="w-cell w-pend" data-endcell="never"><button type="button" role="radio" data-end="never">' + t("Never") + "</button>" + CK + "</div>" +
        '<div class="w-cell w-pend" data-endcell="until"><button type="button" role="radio" data-end="until">' + t("On a date") + '</button><input type="date" id="add-until" class="w-mini" aria-label="' + esc(t("Last date")) + '" hidden>' + CK + "</div>" +
        '<div class="w-cell w-pend" data-endcell="count"><button type="button" role="radio" data-end="count">' + t("After") + '</button><span class="w-inline" id="add-countw" hidden><input id="add-count" type="number" min="2" max="999" inputmode="numeric" class="w-mini w-num" aria-label="' + esc(t("Number of times")) + '">' + t("times") + "</span>" + CK + "</div>" +
      "</div></div>" +
      '<p class="w-err" id="add-rerr" hidden role="alert"></p>' +
      '<div class="w-rsum" id="add-rsumw"><p id="add-rsum"></p><div class="w-next" id="add-next"></div></div>' +
    "</section>";
}
/* The category field, the same on both layouts: pick from its list, or type to filter or name a new one */
export function catBox() {
  return '<div class="w-catbox"><span class="w-caticon" id="add-caticon" aria-hidden="true"></span>' +
    '<input id="add-cat" class="w-mini" autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-controls="add-catlist" aria-expanded="false" aria-labelledby="lbl-cat" enterkeyhint="done">' + icon("down", "w-catchev") +
    '<div class="w-sugg w-catlist" id="add-catlist" hidden role="listbox" aria-labelledby="lbl-cat"></div></div>';
}
export function typeSeg() {
  return '<div class="w-seg sm" role="group" aria-label="' + esc(t("Type")) + '" id="add-type"><button type="button" data-at="expense" aria-pressed="true">' + t("Expense") + '</button><button type="button" data-at="income" aria-pressed="false">' + t("Income") + "</button></div>";
}
/* The share controls, the same on both layouts (Paid by is a cell on the phone) */
export function splitInner(withBy) {
  return '<div class="w-subh"><div class="w-seg sm" role="group" aria-label="' + esc(t("How to share")) + '" id="add-splitmode"><button type="button" data-sm="even">' + t("Evenly") +
    '</button><button type="button" data-sm="income" id="sm-income">' + t("By income") + '</button><button type="button" data-sm="custom">' + t("Custom") + '</button></div><span class="w-hint" id="sm-hint"></span></div>' +
    '<input type="range" id="add-split-r" min="0" max="100" step="1" class="w-range" hidden>' +
    '<div id="add-splitv"></div>' +
    '<p class="w-err" id="add-cerr" hidden role="alert"></p>' +
    (withBy ? '<div class="w-inline" id="add-byrow"><span class="lbl w-bylbl">' + t("Paid by") + '</span><div class="w-seg sm" role="group" aria-label="' + esc(t("Paid by")) + '" id="add-by"></div></div>' : "");
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
/* Repeat as checkmark cells: Never, Daily … Custom › */
export function freqCells(ad, canStop) {
  const items = (canStop ? [["never", t("Never")]] : []).concat(FQ_LABELS());
  return items.map(([k, label]) => {
    const on = k === "never" ? !ad.rep : ad.rep && ad.fq === k;
    return '<button type="button" class="w-cell" role="radio" aria-checked="' + on + '" tabindex="' + (on ? 0 : -1) + '" data-pfq="' + k + '"><span>' + label + "</span>" +
      (on ? '<b class="ck" aria-hidden="true">' + icon("check") + "</b>" : k === "custom" ? '<b class="w-chev" aria-hidden="true">' + icon("right") + "</b>" : "") + "</button>";
  }).join("");
}
