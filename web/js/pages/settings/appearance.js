/* Settings › Appearance: the theme. Week and time zone live in Language & Region,
   the version at the foot of the list of panes. */
import { t } from "../../core.js";
import { refresh, setTheme, theme } from "../../shell.js";
import { gl, gr, paint, segK as seg } from "./common.js";
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
  ]));
}

function onClick(ev) {
  const b = ev.target.closest("#ap-theme [data-v]");
  if (!b) return;
  setTheme(b.dataset.v);
  render();
  refresh({ theme: true });
}
