/* Settings › Language: the 13 languages. Changing it reloads Wally in that language. */
import { t, esc, f, dlabY, TODAY, PUT, LANGUAGES, LANG } from "../../core.js";
import { toast, errorToast } from "../../ui.js";
import { group, paint } from "./common.js";

/* Languages someone in the project reads are checked; the rest are machine-drafted */
const CHECKED = ["en", "es", "ca"];
let box = null;

export function mount(el) {
  box = el;
  box.addEventListener("click", (ev) => { const b = ev.target.closest("[data-lang]"); if (b) choose(b.dataset.lang, b.dataset.name); });
  render();
}
export function update() { if (box) render(); }
export function unmount() { box = null; }

function render() {
  const rows = LANGUAGES.map(([code, name]) => {
    const on = code === LANG;
    const note = code === "ar" ? t("Right to left: the layout mirrors, numbers stay left to right") : "";
    return '<button type="button" class="w-gi w-radio" data-lang="' + code + '" data-name="' + esc(name) + '" data-k="lang:' + code + '" aria-pressed="' + on + '" lang="' + code + '">' +
      '<span class="w-ico w-langcode">' + code.toUpperCase() + "</span><div><h6>" + esc(name) + (CHECKED.includes(code) ? "" : ' <span class="w-badge" lang="' + LANG + '">' + t("needs review") + "</span>") + "</h6>" +
      (note ? '<p lang="' + LANG + '">' + note + "</p>" : "") + '</div><span class="ck" aria-hidden="true">' + (on ? "✓" : "") + "</span></button>";
  });
  paint(box, group(t("Language"), rows, t("Dates and amounts follow the language: {sample}", { sample: '<span class="amt">' + esc(dlabY(TODAY) + " · " + f(1234.56)) + "</span>" })) +
    '<p class="w-note2">' + t("Languages marked “needs review” were translated by machine and are not yet checked by a person. English, Español and Català are.") + "</p>");
}

async function choose(code, name) {
  if (code === LANG) return;
  try {
    await PUT("/language/" + code);
    toast(t("{language} selected. Wally reloads in that language.", { language: name }));
    setTimeout(() => location.reload(), 600);
  } catch (e) { errorToast(e); }
}
