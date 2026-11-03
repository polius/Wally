/* Transactions: Custom Range and Filter.
   Custom Range is a sheet (Cancel · Custom Range · Done) with Starts and Ends rows; the month opens under the one being set.
   Filter is a popover under its button on wide screens and a sheet (Reset · Filter · Done) on phones;
   either way, changes apply as they are made. */
import { state, t, tn, esc, f0, ds, dim, ym, ymAdd, TODAY, START, LANG, cc, couple, isIncomeCat, monthYear, wkOff, dows, icon, F } from "../../core.js";
import { openDialog, closeDialog, seg, sw } from "../../ui.js";
import { S, parseQ, withoutWords, lastDay } from "./query.js";

/* ---------- Custom Range ---------- */
const DAY = (s) => new Date(s + "T12:00:00");
const medium = (s) => { try { return new Intl.DateTimeFormat(LANG, { month: "short", day: "numeric", year: "numeric" }).format(DAY(s)); } catch (e) { return s; } };
const daysBetween = (a, b) => Math.round((DAY(b) - DAY(a)) / 864e5) + 1;

export function openRangeSheet(apply) {
  const [ty, tm] = ym(TODAY), last = lastDay(), max = last > ds(ty, tm, dim(ty, tm)) ? last : ds(ty, tm, dim(ty, tm)); // through the end of this month
  let [a, b] = S.custom || [ds(...ymAdd(ty, tm, -2), 1), TODAY];
  let end = "b", view = ym(b), pick = false;
  // The title opens the months of its year, as Calendar's month and year picker does
  const months = () => {
    const [y, m] = view, sy = +START.slice(0, 4), my = ym(max)[0];
    let h = "";
    for (let k = 1; k <= 12; k++) {
      const off = ds(y, k, 1) > max || ds(y, k, dim(y, k)) < START;
      h += '<button type="button" data-rmo="' + k + '"' + (k === m ? ' class="on" aria-current="true"' : "") + (off ? " disabled" : "") + ' aria-label="' + esc(monthYear(y, k)) + '">' + esc(F.mon[k - 1]) + "</button>";
    }
    return '<div class="tx-rch"><button type="button" class="tx-rct on" data-rpick aria-expanded="true">' + esc(String(y)) + icon("right") + '</button><span><button type="button" data-ry="-1" aria-label="' + esc(t("Previous year")) + '"' + (y > sy ? "" : " disabled") + ">" + icon("left") + "</button>" +
      '<button type="button" data-ry="1" aria-label="' + esc(t("Next year")) + '"' + (y < my ? "" : " disabled") + ">" + icon("right") + "</button></span></div>" +
      '<div class="tx-rmon" role="group" aria-label="' + esc(String(y)) + '">' + h + "</div>";
  };
  const grid = () => {
    if (pick) return months();
    const [y, m] = view, first = ds(y, m, 1);
    let h = dows(true).map((d) => '<span class="dw" aria-hidden="true">' + esc(d) + "</span>").join("");
    for (let i = 0; i < wkOff(first); i++) h += "<span></span>";
    for (let d = 1; d <= dim(y, m); d++) {
      const s = ds(y, m, d), edge = s === a || s === b, inside = s > a && s < b;
      h += '<button type="button" data-rd="' + s + '" class="' + (edge ? "e" : inside ? "in" : "") + (s === TODAY ? " td" : "") + '"' + (s > max ? " disabled" : "") +
        ' aria-pressed="' + edge + '" aria-label="' + esc(medium(s)) + '"><span>' + d + "</span></button>";
    }
    const k = y * 12 + m;
    return '<div class="tx-rch"><button type="button" class="tx-rct" data-rpick aria-expanded="false" aria-label="' + esc(t("Choose a month")) + '">' + esc(monthYear(y, m)) + icon("right") + '</button><span><button type="button" data-rm="-1" aria-label="' + esc(t("Previous month")) + '">' + icon("left") + "</button>" +
      '<button type="button" data-rm="1" aria-label="' + esc(t("Next month")) + '"' + (k >= ym(max)[0] * 12 + ym(max)[1] ? " disabled" : "") + ">" + icon("right") + "</button></span></div>" +
      '<div class="tx-rgrid" role="group" aria-label="' + esc(monthYear(y, m)) + '">' + h + "</div>";
  };
  // As in Summary's Custom Range (and Calendar's Starts and Ends): the month opens under the row being set
  const edge = (k) => '<button type="button" class="w-gr" data-end="' + k + '" aria-pressed="' + (end === k) + '"><span class="k">' + esc(k === "a" ? t("Starts") : t("Ends")) +
    '</span><span class="v"><span class="tx-rv' + (end === k ? " on" : "") + '">' + esc(medium(k === "a" ? a : b)) + "</span></span></button>" + (end === k ? '<div class="tx-rcal">' + grid() + "</div>" : "");
  const body = () => '<div class="w-gl tx-rg">' + edge("a") + edge("b") + "</div>" +
    '<p class="w-glf">' + esc(tn(daysBetween(a, b), "{n} day", "{n} days")) + "</p>";
  openDialog({
    kind: "sheet",
    title: esc(t("Custom Range")),
    ok: esc(t("Done")),
    body: '<div id="tx-rbody">' + body() + "</div>",
    onOpen(root) {
      root.classList.add("tx-rngdlg");
      const box = root.querySelector("#tx-rbody");
      box.addEventListener("click", (ev) => {
        const e = ev.target.closest("[data-end]"), d = ev.target.closest("[data-rd]"), mv = ev.target.closest("[data-rm]");
        const pk = ev.target.closest("[data-rpick]"), yr = ev.target.closest("[data-ry]"), mo = ev.target.closest("[data-rmo]");
        let focus = null;
        if (pk) { pick = !pick; focus = "[data-rpick]"; }
        else if (yr && !yr.disabled) { view = [view[0] + +yr.dataset.ry, view[1]]; focus = '[data-ry="' + yr.dataset.ry + '"]'; }
        else if (mo && !mo.disabled) { view = [view[0], +mo.dataset.rmo]; pick = false; focus = "[data-rpick]"; }
        else if (e) { pick = false; end = e.dataset.end; view = ym(end === "a" ? a : b); focus = '[data-end="' + end + '"]'; }
        else if (mv && !mv.disabled) { view = ymAdd(view[0], view[1], +mv.dataset.rm); focus = '[data-rm="' + mv.dataset.rm + '"]'; }
        else if (d && !d.disabled) {
          const s = d.dataset.rd;
          if (end === "a") { a = s; if (b < a) b = a; end = "b"; }
          else { b = s; if (b < a) a = b; }
          focus = '[data-rd="' + s + '"]';
        } else return;
        box.innerHTML = body();
        let n = box.querySelector(focus);
        if (!n || n.disabled) n = box.querySelector("[data-rpick]");
        if (n) n.focus();
      });
    },
    onOk() { apply({ mode: "custom", custom: [a, b] }); },
  });
}

/* ---------- Filter ---------- */
export function filterCount(P) {
  P = P || parseQ(S.q);
  return S.cats.size + (S.type !== "all" ? 1 : 0) + (S.shared ? 1 : 0) + (P.min !== null || P.max !== null ? 1 : 0);
}
let fctx = null;
function amounts() {
  const P = parseQ(S.q);
  return [["any", t("Any"), P.min === null && P.max === null], ["over", t("Over {amount}", { amount: f0(50) }), P.min === 50 && P.max === null], ["under", t("Under {amount}", { amount: f0(10) }), P.max === 10 && P.min === null]];
}
function filterBody(phone) {
  const cats = state.categories.filter((c) => !isIncomeCat(c)).concat(state.categories.filter(isIncomeCat));
  const am = amounts(), n = fctx ? fctx.list().length : 0;
  return seg("tx-ftype", [["all", t("All")], ["expense", t("Expenses")], ["income", t("Income")]], S.type, t("Type"), "tx-fseg") +
    '<div class="tx-flabel">' + esc(t("Categories")) + '</div><div class="w-chips tx-fchips">' +
      cats.map((c) => { const on = S.cats.has(c), col = cc(c); return '<button type="button" class="w-chip' + (on ? " tx-con" : "") + '" data-fc="' + esc(c) + '" aria-pressed="' + on + '"' + (on ? ' style="--cc:' + col + '"' : "") + '><span class="w-cdot" style="background:' + col + '"></span>' + esc(c) + "</button>"; }).join("") + "</div>" +
    '<div class="tx-flabel">' + esc(t("Amount")) + "</div>" + seg("tx-famt", am.map(([k, l]) => [k, l]), (am.find((x) => x[2]) || ["custom"])[0], t("Amount"), "tx-fseg") +
    (couple() ? '<div class="tx-fshared"><span id="tx-fsl">' + esc(t("Shared only")) + "</span>" + sw("tx-fsw", S.shared, t("Shared only")) + "</div>" : "") +
    (phone ? '<p class="tx-fn">' + esc(tn(n, "{n} transaction", "{n} transactions")) + "</p>"
      : '<div class="tx-ffoot"><button type="button" class="w-link" data-f="reset">' + esc(t("Reset")) + '</button><span class="tx-fn">' + esc(tn(n, "{n} transaction", "{n} transactions")) + "</span></div>");
}
/* One change from the filter: apply it, redraw the page and the filter, keep the focus where it was */
function change(b, host, phone) {
  if (b.closest("#tx-ftype")) S.type = b.dataset.v;
  else if (b.closest("#tx-famt")) {
    const P = parseQ(S.q);
    const idx = P.chips.filter((ch) => /^[<>]/.test(S.q.trim().split(/\s+/)[ch.idx[0]] || "")).flatMap((ch) => ch.idx);
    let q = withoutWords(S.q, idx);
    if (b.dataset.v === "over") q = (q + " >50").trim();
    if (b.dataset.v === "under") q = (q + " <10").trim();
    fctx.setQ(q);
  } else if (b.dataset.fc !== undefined) { const c = b.dataset.fc; if (S.cats.has(c)) S.cats.delete(c); else S.cats.add(c); }
  else if (b.id === "tx-fsw") S.shared = !S.shared;
  else if (b.dataset.f === "reset") { S.type = "all"; S.cats = new Set(); S.shared = false; fctx.setQ(""); }
  else return;
  S.sel = null;
  const sel = b.id ? "#" + b.id : b.closest(".w-seg") ? "#" + b.closest(".w-seg").id + ' [data-v="' + b.dataset.v + '"]' : b.dataset.fc !== undefined ? '[data-fc="' + CSS.escape(b.dataset.fc) + '"]' : null;
  fctx.render();
  host.innerHTML = filterBody(phone);
  const again = (sel && host.querySelector(sel)) || host.querySelector('[data-f="reset"]') || host.querySelector("button");
  if (again && host.contains(again)) again.focus();
}
/* ctx: {render, list, setQ, phone, button} */
export function openFilter(ctx) {
  if (ctx.phone) return openFilterSheet(ctx);
  const pop = document.getElementById("tx-fpop");
  if (!pop) return;
  if (!pop.hidden) return closeFilter(true);
  fctx = ctx;
  pop.innerHTML = filterBody(false);
  pop.hidden = false;
  ctx.button.setAttribute("aria-expanded", "true");
  pop.onclick = (ev) => { const b = ev.target.closest("button"); if (b) change(b, pop, false); };
  pop.onkeydown = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); ev.preventDefault(); closeFilter(true); } };
  const first = pop.querySelector('#tx-ftype [aria-pressed="true"]') || pop.querySelector("button");
  if (first) first.focus();
}
export function closeFilter(focusBack) {
  const pop = document.getElementById("tx-fpop");
  if (!pop || pop.hidden) return;
  pop.hidden = true;
  pop.innerHTML = "";
  const b = document.getElementById("tx-fbtn");
  if (b) { b.setAttribute("aria-expanded", "false"); if (focusBack) b.focus(); }
}
function openFilterSheet(ctx) {
  fctx = ctx;
  openDialog({
    kind: "sheet",
    title: esc(t("Filter")),
    ok: esc(t("Done")),
    noCancel: true,
    body: '<div id="tx-fbody" class="tx-fbody">' + filterBody(true) + "</div>",
    onOpen(r) {
      // Reset sits where Cancel would: it clears the filter and keeps the sheet open
      const head = r.querySelector(".w-shh");
      head.firstElementChild.outerHTML = '<button type="button" class="w-dlgx" data-f="reset">' + esc(t("Reset")) + "</button>";
      const host = r.querySelector("#tx-fbody");
      head.firstElementChild.addEventListener("click", (ev) => change(ev.currentTarget, host, true));
      host.addEventListener("click", (ev) => { const b = ev.target.closest("button"); if (b) change(b, host, true); });
    },
    onOk() { closeDialog(); },
  });
}
