/* Settings › Savings target: the share of income kept before Safe to spend says what is left. */
import { t, esc, state, f0, num, PUT, totals, ymAdd, ds, dim, TODAY } from "../../core.js";
import { toast, errorToast } from "../../ui.js";
import { refresh } from "../../shell.js";
import { group, gi, ico, ctl, paint, segK as seg } from "./common.js";

const PRESETS = [0, 10, 15, 20, 25, 30];
let box = null;

export function mount(el) {
  box = el;
  box.addEventListener("click", (ev) => { const b = ev.target.closest("#sv-seg [data-v]"); if (b) save(Number(b.dataset.v)); });
  box.addEventListener("change", (ev) => { if (ev.target.id === "sv-other") saveTyped(ev.target); });
  box.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && ev.target.id === "sv-other") { ev.preventDefault(); saveTyped(ev.target); } });
  render();
}
export function update() { if (box) render(); }
export function unmount() { box = null; }

/* Income a month over the three months before this one, for the whole household */
function monthlyIncome() {
  const y = +TODAY.slice(0, 4), m = +TODAY.slice(5, 7);
  const [y0, m0] = ymAdd(y, m, -3), [y1, m1] = ymAdd(y, m, -1);
  return totals(ds(y0, m0, 1), ds(y1, m1, dim(y1, m1)), "all").inc / 3;
}
function render() {
  const target = Number(state.config.savings_target ?? 15);
  const inc = monthlyIncome();
  const sub = inc > 0
    ? t("Over the last 3 months about {income} came in a month, so {kept} would be kept each month", { income: '<span class="amt">' + f0(inc) + "</span>", kept: '<span class="amt">' + f0(inc * target / 100) + "</span>" })
    : t("No income in the last 3 months yet. Once income comes in, this share of it is kept first.");
  const other = PRESETS.includes(target) ? "" : String(target);
  paint(box,
    '<div class="w-explain"><p><b class="w-sstrong">' + t("Savings come first.") + "</b> " +
    t("Safe to spend sets this share of the month’s income aside before it says what you can spend. Income still due this month counts as soon as it has a recurring rule, so a salary on the 25th does not make the first weeks look broke.") + "</p></div>" +
    group(t("Savings target"), [gi(ico("coin"), t("Keep this share of income"), sub,
      ctl('<div class="w-inline w-svctl">' + seg("sv-seg", PRESETS.map((v) => [v, num(v) + "%"]), PRESETS.includes(target) ? target : "", t("Savings target"), "sm") +
        '<label class="w-svother"><span class="w-hint">' + t("Other") + '</span><input class="w-mini" id="sv-other" type="number" inputmode="decimal" min="0" max="90" step="1" value="' + esc(other) +
        '" aria-label="' + esc(t("Other share, from 0 to 90 percent")) + '" data-k="sv-other"><span class="w-hint">%</span></label></div>'))],
      t("One target for the household. Each person’s view uses their own income.")));
}

async function save(v) {
  if (!(v >= 0 && v <= 90)) { toast(t("The savings target is a share of income, from 0 to 90.")); return; }
  if (v === Number(state.config.savings_target)) return;
  try {
    state.config = await PUT("/config", { savings_target: v });
    refresh({ config: true });
    toast(t("Savings target set to {n}%. Safe to spend is updated.", { n: num(v) }));
  } catch (e) { errorToast(e); }
}
function saveTyped(input) {
  const raw = input.value.trim().replace(",", ".");
  if (raw === "") return;
  save(Math.round(Number(raw) * 10) / 10);
}
