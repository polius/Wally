/* Settings › Appearance: theme, hide amounts, week start, the page Wally opens on, and the time zone. */
import { t, esc, state, PUT, icon } from "../../core.js";
import { toast, errorToast } from "../../ui.js";
import { refresh, setTheme, theme, setHide } from "../../shell.js";
import { group, gi, ico, ctl, toggle, paint, segK as seg } from "./common.js";

let box = null;
let zones = null;

export function mount(el) {
  box = el;
  box.addEventListener("click", onClick);
  box.addEventListener("change", (ev) => { if (ev.target.id === "tz-sel") save({ timezone: ev.target.value }, ev.target.value ? t("Time zone set to {zone}", { zone: ev.target.value }) : t("Time zone follows the server")); });
  render();
}
export function update() { if (box) render(); }
export function unmount() { box = null; }

function zoneList() {
  if (!zones) { try { zones = Intl.supportedValuesOf("timeZone"); } catch (e) { zones = []; } }
  const cur = state.config.timezone || "";
  return (cur && !zones.includes(cur) ? [cur] : []).concat(zones);
}
function render() {
  const cfg = state.config;
  const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const tz = cfg.timezone || "";
  paint(box,
    group(t("Appearance"), [
      gi(ico("sun"), t("Theme"), t("Auto follows the device"), ctl(seg("ap-theme", [["auto", t("Auto")], ["light", t("Light")], ["dark", t("Dark")]], theme(), t("Theme"), "sm"))),
      gi(ico("eye"), t("Hide amounts"), t("Blurs every figure, for sharing your screen. {key} toggles it.", { key: '<kbd class="w-k">H</kbd>' }), toggle("hide-toggle", state.hide, t("Hide amounts"))),
      gi(ico("cal"), t("Week starts on"), t("Used by the calendars"), ctl(seg("ap-week", [["mon", t("Monday")], ["sun", t("Sunday")], ["sat", t("Saturday")]], cfg.week_start || "mon", t("Week starts on"), "sm"))),
      gi(ico("overview"), t("Open on"), t("The page Wally shows when it opens"), ctl(seg("ap-open", [["dashboard", t("Dashboard")], ["transactions", t("Transactions")], ["recurring", t("Recurring")], ["budgets", t("Budgets")]], cfg.open_on || "dashboard", t("Open on"), "sm"))),
    ]) +
    group(t("Time"), [
      gi(ico("globe"), t("Time zone"), t("Decides when a new day starts for recurring transactions and the nightly backup. This browser is in {zone}.", { zone: esc(here) }),
        ctl('<select class="w-mini w-sselect" id="tz-sel" data-k="tz" aria-label="' + esc(t("Time zone")) + '"><option value=""' + (tz ? "" : " selected") + ">" + t("The server’s time zone") + "</option>" +
          zoneList().map((z) => '<option value="' + esc(z) + '"' + (z === tz ? " selected" : "") + ">" + esc(z.replace(/_/g, " ")) + "</option>").join("") + "</select>")),
    ]) +
    group(t("About"), [gi('<span class="w-mark w-about-mark" aria-hidden="true"></span>', "Wally " + esc((state.status && state.status.version) || ""),
      t("Self-hosted. Your data stays in one SQLite file on your server."), '<a class="w-link" href="/api/docs" target="_blank" rel="noopener">' + t("API docs") + icon("ext") + "</a>")]));
}

async function save(change, msg) {
  try {
    state.config = await PUT("/config", change);
    refresh({ config: true });
    if (msg) toast(msg);
  } catch (e) { errorToast(e); render(); }
}

function onClick(ev) {
  if (ev.target.closest("#hide-toggle")) { setHide(!state.hide); render(); toast(state.hide ? t("Amounts hidden") : t("Amounts shown")); return; }
  const b = ev.target.closest(".w-seg [data-v]");
  if (!b) return;
  const v = b.dataset.v, id = b.closest(".w-seg").id;
  if (id === "ap-theme") { setTheme(v); render(); }
  else if (id === "ap-week" && v !== state.config.week_start) save({ week_start: v });
  else if (id === "ap-open" && v !== state.config.open_on) save({ open_on: v });
}
