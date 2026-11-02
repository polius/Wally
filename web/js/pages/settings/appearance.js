/* Settings › Appearance: the theme, and hiding amounts. Week and time zone live in Language & Region,
   the version at the foot of the list of panes. */
import { t, state } from "../../core.js";
import { toast } from "../../ui.js";
import { refresh, setTheme, theme, setHide } from "../../shell.js";
import { gl, gr, toggle, paint, segK as seg } from "./common.js";
import { setAction } from "../settings.js";

let box = null;

export function mount(el) {
  box = el;
  box.addEventListener("click", onClick);
  render();
}
export function update() { if (box) render(); }
export function unmount() { box = null; }

function render() {
  setAction("");
  paint(box, gl([
    gr({ k: t("Theme"), right: seg("ap-theme", [["auto", t("Auto")], ["light", t("Light")], ["dark", t("Dark")]], theme(), t("Theme"), "w-segm") }),
    gr({ k: t("Hide amounts"), sub: t("Blurs every figure, for sharing your screen. {key} toggles it.", { key: "H" }), right: toggle("hide-toggle", state.hide, t("Hide amounts")) }),
  ]));
}

function onClick(ev) {
  if (ev.target.closest("#hide-toggle")) { setHide(!state.hide); render(); toast(state.hide ? t("Amounts hidden") : t("Amounts shown")); return; }
  const b = ev.target.closest("#ap-theme [data-v]");
  if (!b) return;
  setTheme(b.dataset.v);
  render();
  refresh({ theme: true });
}
