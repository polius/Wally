/* Transactions on phones: Range and Filters as sheets from the bottom, as in the phone mocks.
   openDialog already turns into a bottom sheet under 768 px. */
import { state, t, esc, f0, ds, ym, ymAdd, TODAY, monthYear, cc, icon, couple, isIncomeCat } from "../../core.js";
import { openDialog, seg } from "../../ui.js";
import { S, parseQ, withoutWords } from "./query.js";
import { views, exportCsv } from "./actions.js";

/* ---------- Range ---------- */
export function openRangeSheet(apply) {
  const [ty, tm] = ym(TODAY), last = ymAdd(ty, tm, -1);
  const presets = [
    ["this", t("This month"), () => ({ mode: "month", ym: [ty, tm] })],
    ["last", t("Last month"), () => ({ mode: "month", ym: last })],
    ["year", t("Year to date"), () => ({ mode: "year" })],
    ["all", t("All time"), () => ({ mode: "all" })],
  ];
  const isMonth = (q) => S.mode === "month" && S.ym[0] === q[0] && S.ym[1] === q[1];
  let pick = S.mode === "custom" ? "custom" : S.mode === "month" ? (isMonth([ty, tm]) ? "this" : isMonth(last) ? "last" : "month") : S.mode;
  const [ca, cb] = S.custom || [ds(...ymAdd(ty, tm, -2), 1), TODAY];
  const cells = () => presets.map(([k, label]) => '<button type="button" class="w-cell tx-rcell" role="radio" aria-checked="' + (pick === k) + '" data-pr="' + k + '"><span>' + esc(label) + "</span>" + (pick === k ? '<b class="ck">' + icon("check") + "</b>" : "") + "</button>").join("");
  openDialog({
    title: t("Range"),
    ok: t("Apply"),
    body: (pick === "month" ? '<p class="w-hint">' + esc(monthYear(S.ym[0], S.ym[1])) + "</p>" : "") +
      '<div class="w-cells" role="radiogroup" aria-label="' + esc(t("Range")) + '" id="tx-rs">' + cells() + "</div>" +
      '<div class="w-plabel">' + esc(t("Custom")) + '</div><div class="w-cells"><label class="w-cell"><span>' + esc(t("From")) + '</span><input type="date" class="tx-date" id="tx-rfrom" value="' + ca + '" max="' + TODAY + '"></label>' +
      '<label class="w-cell"><span>' + esc(t("To")) + '</span><input type="date" class="tx-date" id="tx-rto" value="' + cb + '"></label></div>',
    onOpen(root) {
      root.querySelector("#tx-rs").addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-pr]");
        if (!b) return;
        pick = b.dataset.pr;
        root.querySelector("#tx-rs").innerHTML = cells();
        root.querySelector('[data-pr="' + pick + '"]').focus();
      });
      root.querySelectorAll(".tx-date").forEach((inp) => inp.addEventListener("change", () => { pick = "custom"; root.querySelector("#tx-rs").innerHTML = cells(); }));
    },
    onOk(root) {
      if (pick === "month") return apply({});
      if (pick === "custom") {
        let a = root.querySelector("#tx-rfrom").value, b = root.querySelector("#tx-rto").value;
        if (!a || !b) throw new Error(t("Pick both dates."));
        if (a > b) [a, b] = [b, a];
        return apply({ mode: "custom", custom: [a, b] });
      }
      apply(presets.find((p) => p[0] === pick)[2]());
    },
  });
}

/* ---------- Filters ----------
   Changes apply as they are made; the button shows how many are left. ctx: {render, list} */
export function openFilterSheet(ctx) {
  const amountChoices = () => {
    const P = parseQ(S.q);
    return [["any", t("Any"), P.min === null && P.max === null], ["over", t("Over {amount}", { amount: f0(50) }), P.min === 50 && P.max === null], ["under", t("Under {amount}", { amount: f0(10) }), P.max === 10 && P.min === null]];
  };
  const cats = () => state.categories.filter((c) => !isIncomeCat(c)).concat(state.categories.filter(isIncomeCat));
  const body = () =>
    '<button type="button" class="w-link tx-reset" data-f="reset">' + esc(t("Reset")) + "</button>" +
    '<div class="w-plabel">' + esc(t("Type")) + "</div>" + seg("tx-ftype", [["all", t("All")], ["expense", t("Expenses")], ["income", t("Income")]], S.type, t("Type"), "tx-fseg") +
    '<div class="w-plabel">' + esc(t("Categories")) + '</div><div class="w-chips tx-fchips">' +
      cats().map((c) => { const on = S.cats.has(c), col = cc(c); return '<button type="button" class="w-chip' + (on ? " tx-con" : "") + '" data-fc="' + esc(c) + '" aria-pressed="' + on + '"' + (on ? ' style="--cc:' + col + '"' : "") + '><span class="w-cdot" style="background:' + col + '"></span>' + esc(c) + "</button>"; }).join("") + "</div>" +
    '<div class="w-plabel">' + esc(t("Amount")) + '</div><div class="w-chips tx-fchips">' +
      amountChoices().map(([k, label, on]) => '<button type="button" class="w-chip' + (on ? " on" : "") + '" data-fa="' + k + '" aria-pressed="' + on + '">' + esc(label) + "</button>").join("") + "</div>" +
    (couple() ? '<div class="w-chips tx-fchips"><button type="button" class="w-chip' + (S.shared ? " on" : "") + '" data-f="shared" aria-pressed="' + S.shared + '"><span class="w-av shared sm"></span>' + esc(t("Shared only")) + "</button></div>" : "") +
    (views().length ? '<div class="w-plabel">' + esc(t("Saved views")) + '</div><div class="w-chips tx-fchips">' + views().map((v, i) => '<button type="button" class="w-chip" data-fv="' + i + '">' + esc(v.name) + "</button>").join("") + "</div>" : "") +
    '<button type="button" class="w-btn ghost tx-fexp" data-f="export">' + icon("download") + esc(t("Export these as CSV")) + "</button>";
  const okText = () => t("Show {n}", { n: ctx.list().length });
  let root;
  const redraw = () => {
    ctx.render();
    root.querySelector("#tx-fbody").innerHTML = body();
    root.querySelector("[data-dlg-ok]").textContent = okText();
  };
  root = openDialog({
    title: t("Filters"),
    body: '<div id="tx-fbody" class="tx-fbody">' + body() + "</div>",
    ok: okText(),
    cancel: t("Close"),
    onOpen(r) {
      r.querySelector("#tx-fbody").addEventListener("click", (ev) => {
        const b = ev.target.closest("button");
        if (!b) return;
        if (b.closest("#tx-ftype")) { S.type = b.dataset.v; }
        else if (b.dataset.fc !== undefined) { const c = b.dataset.fc; if (S.cats.has(c)) S.cats.delete(c); else S.cats.add(c); }
        else if (b.dataset.fa) {
          const P = parseQ(S.q);
          const idx = P.chips.filter((ch) => /^[<>]/.test(S.q.trim().split(/\s+/)[ch.idx[0]] || "")).flatMap((ch) => ch.idx);
          let q = withoutWords(S.q, idx);
          if (b.dataset.fa === "over") q = (q + " >50").trim();
          if (b.dataset.fa === "under") q = (q + " <10").trim();
          ctx.setQ(q);
        } else if (b.dataset.f === "shared") S.shared = !S.shared;
        else if (b.dataset.fv !== undefined) { const v = views()[+b.dataset.fv]; if (v) { ctx.setQ(v.query, true); } }
        else if (b.dataset.f === "reset") { S.type = "all"; S.cats = new Set(); S.shared = false; ctx.setQ(""); }
        else if (b.dataset.f === "export") { exportCsv(ctx.list()); return; }
        else return;
        S.sel = null;
        redraw();
      });
    },
  });
}
