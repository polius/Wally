/* Setting a limit (B3): one sheet, from the Budget page and from a category in Settings.
   The amount (with no limit yet, what is usually spent, rounded up) and Month or Year (the limit for everything is
   always the month's); one sentence on what is usually spent; Remove limit last, in red, with no question asked:
   Undo in the toast brings it back. */
import { t, esc, f, cat, PUT, DEL, reloadBudgets } from "./core.js";
import { openDialog, closeDialog, dialogError, toast, seg } from "./ui.js";
import { refresh } from "./shell.js";
import { EVERYTHING, thisMonth, limitFor, usualMonth, suggested } from "./budget.js";

const label = (category) => (category === EVERYTHING ? t("Everything") : cat(category).n);
const usual = usualMonth;
const parse = (s) => { const v = Number(String(s || "").replace(",", ".").trim()); return Number.isFinite(v) && v > 0 ? v : 0; };

async function save(category, period, amount) {
  await PUT("/budgets", { category, period, amount: String(amount), month: thisMonth() });
  await reloadBudgets();
  refresh({ budget: true });
}

export function openLimit(category) {
  const now = limitFor(category);
  // The limit for everything is always the month's: no Month or Year to choose
  const all = category === EVERYTHING;
  let period = all ? "month" : now ? now.period : "month";
  const u = usual(category);
  // No limit yet: the amount starts from what is usually spent, rounded up
  const start = now ? now.amount : suggested(category) ? suggested(category).toFixed(2) : "";
  const note = category === EVERYTHING
    ? t("You usually spend {amount} a month. Bills count too.", { amount: f(u) })
    : t("You usually spend {amount} a month on {category}. Bills in it count too.", { amount: f(u), category: label(category) });
  openDialog({
    title: esc(label(category)), ok: t("Save"), kind: "sheet",
    body:
      '<div class="w-gl"><label class="w-gr"><span class="k">' + (all ? t("Limit, each month") : t("Limit")) + '</span><input id="lim-amt" class="w-end" inputmode="decimal" autocomplete="off" value="' +
        esc(start) + '" placeholder="' + esc(t("Amount")) + '" aria-label="' + esc(t("Limit")) + '"></label>' +
      (all ? "" : '<div class="w-gr"><span class="k">' + t("Each") + "</span>" + seg("lim-per", [["month", t("Month")], ["year", t("Year")]], period, t("Each"), "sm") + "</div>") + "</div>" +
      '<p class="w-glf">' + esc(note) + "</p>" +
      (now ? '<div class="w-gl"><button type="button" class="w-gr red" id="lim-del">' + t("Remove limit") + "</button></div>" : ""),
    onOpen: (root) => {
      const ok = root.querySelector("[data-dlg-ok]"), input = root.querySelector("#lim-amt");
      const check = () => { ok.disabled = !parse(input.value); };
      input.addEventListener("input", check);
      check();
      if (!all) root.querySelector("#lim-per").addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-v]");
        if (!b) return;
        period = b.dataset.v;
        root.querySelectorAll("#lim-per [data-v]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      });
      const del = root.querySelector("#lim-del");
      if (del) del.addEventListener("click", () => remove(category));
      input.focus();
      input.select();
    },
    onOk: async () => {
      const v = parse(document.getElementById("lim-amt").value);
      if (!v) return false;
      try { await save(category, period, v); }
      catch (e) { dialogError(e.message); return false; }
      toast(t("Limit saved"));
    },
  });
}

/* No limit from this month on; earlier months keep theirs. Undo sets it again. */
export async function remove(category) {
  const was = limitFor(category);
  if (!was) return;
  try {
    await DEL("/budgets?category=" + encodeURIComponent(category) + "&month=" + thisMonth());
    await reloadBudgets();
  } catch (e) { dialogError(e.message); return; }
  closeDialog();
  refresh({ budget: true });
  toast(t("Limit removed"), () => save(category, was.period, was.amount));
}
