/* Settle up: who owes whom from shared costs, recording a payment, and the payment history.
   Opens from the Dashboard's People widget and from Settings › People. A payment is not
   spending: it only brings the balance back to zero. */
import { state, t, tn, esc, POST, DEL, TODAY, f, symbol, num, dlab, dlabY, decSep, parseAmt, pname, av, icon, couple, reloadSettle } from "./core.js";
import { openDialog, dialogError, toast, errorToast } from "./ui.js";
import { refresh } from "./shell.js";

const shownCount = () => (matchMedia("(max-width: 767px)").matches ? 3 : 6); // payments listed before "Show all"
let pick = 0;    // which suggested payment is chosen, with three or more people
let showAll = false;

const dateOf = (s) => (s.slice(0, 4) === TODAY.slice(0, 4) ? dlab(s) : dlabY(s));
/* 12.5 → "12,50" in the reader's language, for the amount field */
function plain(n) { return n.toFixed(2).replace(".", decSep()); }

/* Shared costs since the last payment, to say what the balance is made of */
function sharedSince() {
  const last = state.settle.payments && state.settle.payments[0];
  const n = state.tx.filter((x) => x.p === null && x.type === "expense" && x.by && (!last || x.d > last.date)).length;
  return { last, n };
}

function body() {
  const tr = state.settle.transfers || [], pays = state.settle.payments || [];
  if (pick >= tr.length) pick = 0;
  let html = '<div class="st">';
  if (!tr.length) {
    html += '<div class="w-settle even"><div><b>' + t("All square") + "</b><p>" + t("No one owes anything. Shared costs with a payer start a new balance.") + "</p></div></div>";
  } else {
    if (tr.length > 1) {
      html += '<div class="w-opts" role="radiogroup" aria-label="' + esc(t("Payment")) + '">' + tr.map((x, i) =>
        '<label><input type="radio" name="st-pick" value="' + i + '"' + (i === pick ? " checked" : "") + "><span><b>" +
        esc(t("{from} pays {to}", { from: pname(String(x.from)), to: pname(String(x.to)) })) + "</b><small>" + f(Number(x.amount)) + "</small></span></label>").join("") + "</div>";
    }
    const x = tr[pick], from = String(x.from), to = String(x.to), { last, n } = sharedSince();
    const left = state.currency.position === "left", cur = '<span class="st-cur" aria-hidden="true">' + esc(symbol()) + "</span>";
    html += '<div class="st-who">' + av(from, "st-av") + icon("right", "st-arrow") + av(to, "st-av") + "</div>" +
      '<b class="st-line">' + esc(t("{from} pays {to}", { from: pname(from), to: pname(to) })) + "</b>" +
      '<label class="st-amt"><span class="st-sr">' + t("Amount") + "</span>" + (left ? cur : "") + '<input id="st-amount" inputmode="decimal" autocomplete="off" value="' + plain(Number(x.amount)) + '" aria-describedby="st-for">' + (left ? "" : cur) + "</label>" +
      '<span class="w-hint" id="st-for">' + esc(last ? tn(n, "For {n} shared cost since {date}", "For {n} shared costs since {date}", { date: dateOf(last.date) }) : tn(n, "For {n} shared cost", "For {n} shared costs")) + "</span>" +
      '<div class="w-cells"><label class="w-cell"><span>' + t("Date") + '</span><input type="date" id="st-date" class="st-date" value="' + TODAY + '" max="' + TODAY + '"></label></div>' +
      '<p class="w-hint st-note">' + t("By transfer or cash. Not counted as spending. The balance starts again from zero.") + "</p>";
  }
  if (pays.length) {
    const list = showAll ? pays : pays.slice(0, shownCount());
    html += '<div class="w-plabel">' + t("Earlier payments") + '</div><div class="w-cells st-hist">' + list.map((p) =>
      '<div class="w-cell"><span>' + esc(t("{from} paid {to}", { from: pname(String(p.from_person)), to: pname(String(p.to_person)) })) + (p.note ? ' <small class="st-pnote">' + esc(p.note) + "</small>" : "") +
      '</span><b class="amt">' + f(Number(p.amount)) + " · " + esc(dateOf(p.date)) + '</b><button type="button" class="st-del" data-st-del="' + p.id + '" aria-label="' +
      esc(t("Delete the payment of {amount} on {date}", { amount: f(Number(p.amount)), date: dateOf(p.date) })) + '">' + icon("trash") + "</button></div>").join("") + "</div>" +
      (pays.length > shownCount() && !showAll ? '<button type="button" class="w-link st-more" data-st-all>' + esc(t("Show all {n} payments", { n: num(pays.length) })) + "</button>" : "");
  }
  return html + "</div>";
}

/* Draw the dialog's inside again, keeping it open (after a delete or an undo) */
function redraw(root) {
  if (!root || !root.isConnected) return;
  root.querySelector(".st").outerHTML = body();
  const has = (state.settle.transfers || []).length > 0, ok = root.querySelector("[data-dlg-ok]"), x = root.querySelector("[data-dlg-x]");
  if (ok) ok.hidden = !has;
  if (x) x.textContent = has ? t("Cancel") : t("Close");
}

async function removePayment(id, root) {
  const p = state.settle.payments.find((x) => String(x.id) === String(id));
  if (!p) return;
  try {
    await DEL("/settlements/" + p.id);
    await reloadSettle();
    refresh({ settle: true });
    redraw(root);
    const focus = root && root.querySelector("[data-st-del]") || root && root.querySelector("[data-dlg-x]");
    if (focus) focus.focus();
    toast(t("Deleted the payment of {amount}", { amount: f(Number(p.amount)) }), async () => {
      await POST("/settlements", { date: p.date, from_person: p.from_person, to_person: p.to_person, amount: p.amount, note: p.note || "" });
      await reloadSettle();
      refresh({ settle: true });
      redraw(root);
    });
  } catch (e) { if (root && root.isConnected) dialogError(e.message); else errorToast(e); }
}

export function openSettle() {
  if (!couple()) return;
  pick = 0; showAll = false;
  const has = (state.settle.transfers || []).length > 0;
  openDialog({
    title: t("Settle up"),
    body: body(),
    ok: t("Record payment"),
    cancel: has ? t("Cancel") : t("Close"),
    onOpen(root) {
      root.classList.add("st-dlg");
      const ok = root.querySelector("[data-dlg-ok]");
      if (ok) ok.hidden = !has;
      root.addEventListener("change", (ev) => {
        if (ev.target.name === "st-pick") { pick = +ev.target.value; redraw(root); const r = root.querySelector('[name="st-pick"]:checked'); if (r) r.focus(); }
      });
      root.addEventListener("click", (ev) => {
        const del = ev.target.closest("[data-st-del]");
        if (del) { removePayment(del.dataset.stDel, root); return; }
        if (ev.target.closest("[data-st-all]")) { showAll = true; redraw(root); const b = root.querySelector(".st-hist [data-st-del]"); if (b) b.focus(); }
      });
    },
    async onOk(root) {
      const x = (state.settle.transfers || [])[pick];
      if (!x) return;
      const amount = parseAmt(root.querySelector("#st-amount").value), date = root.querySelector("#st-date").value || TODAY;
      if (!amount || amount <= 0) { root.querySelector("#st-amount").focus(); throw new Error(t("Type an amount above zero.")); }
      if (date > TODAY) throw new Error(t("The date can’t be in the future."));
      const saved = await POST("/settlements", { date, from_person: Number(x.from), to_person: Number(x.to), amount: amount.toFixed(2), note: "" });
      await reloadSettle();
      refresh({ settle: true });
      toast(t("Settled: {from} paid {to} {amount}", { from: pname(String(x.from)), to: pname(String(x.to)), amount: f(amount) }), async () => {
        await DEL("/settlements/" + saved.id);
        await reloadSettle();
        refresh({ settle: true });
      });
    },
  });
}
