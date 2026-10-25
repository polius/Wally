/* Settings: grouped like System Settings. A list of panes on the left (or, on a phone, a list
   that opens each pane full screen), and the pane on the right. Each pane is its own module. */
import { $, t, esc, state, icon, num, GET, LANGUAGES, LANG } from "../core.js";
import { counts } from "./settings/common.js";

const PANES = {
  people: { icon: "users", label: () => t("People"), value: () => num(state.people.length), load: () => import("./settings/people.js") },
  categories: { icon: "overview", label: () => t("Categories"), value: () => num(state.categories.length), load: () => import("./settings/categories.js") },
  tags: { icon: "tag", label: () => t("Tags"), value: () => num(state.tags.length), load: () => import("./settings/tags.js") },
  currency: { icon: "coin", label: () => t("Currency"), value: () => esc(state.currency.selected || ""), load: () => import("./settings/currency.js") },
  savings: { icon: "overview", label: () => t("Savings target"), value: () => num(Number(state.config.savings_target ?? 15)) + "%", load: () => import("./settings/savings.js") },
  import: { icon: "io", label: () => t("Import and export"), value: () => "", load: () => import("./settings/import.js") },
  rules: { icon: "split", label: () => t("Rules"), value: () => num((state.irules || []).length), load: () => import("./settings/rules.js") },
  backups: { icon: "file", label: () => t("Backups"), value: () => (state.config.nightly_backup ? t("Daily") : t("Off")), load: () => import("./settings/backups.js") },
  keys: { icon: "key", label: () => t("API keys"), value: () => (counts.keys === null ? "" : num(counts.keys)), load: () => import("./settings/keys.js") },
  signin: { icon: "lock", label: () => t("Sign-in"), value: () => (state.status && state.status.signin ? t("On") : t("Off")), load: () => import("./settings/signin.js") },
  language: { icon: "globe", label: () => t("Language"), value: () => esc((LANGUAGES.find((l) => l[0] === LANG) || ["", "English"])[1]), load: () => import("./settings/language.js") },
  appearance: { icon: "layout", label: () => t("Appearance"), value: () => "", load: () => import("./settings/appearance.js") },
};
const GROUPS = [
  [() => t("Household"), ["people", "categories", "tags"]],
  [() => t("Money"), ["currency", "savings"]],
  [() => t("Data"), ["import", "rules", "backups", "keys"]],
  [() => t("App"), ["signin", "language", "appearance"]],
];
const FIRST = "people";

let root = null, route = null, phoneMq = null;
let paneId = null, paneMod = null, paneToken = 0;
let layout = "";            // "split" (sidebar of panes + pane), "list" (phone list) or "full" (phone pane)
let lastKey = null, dlgWatch = null;

export function mount(el, r) {
  root = el;
  route = r;
  layout = ""; paneId = null; paneMod = null;
  phoneMq = matchMedia("(max-width:767px)");
  phoneMq.addEventListener("change", draw);
  root.addEventListener("click", onClick);
  // After a dialog closes, focus goes back to what opened it, even when the pane was redrawn meanwhile
  dlgWatch = new MutationObserver(() => { if ($("dlg").hidden) setTimeout(refocus, 0); });
  dlgWatch.observe($("dlg"), { attributes: true, attributeFilter: ["hidden"] });
  draw();
  if (counts.keys === null) GET("/api-keys").then((k) => { counts.keys = k.length; update(); }).catch(() => { /* shown in the pane */ });
}
export function unmount() {
  if (paneMod && paneMod.unmount) paneMod.unmount();
  phoneMq.removeEventListener("change", draw);
  root.removeEventListener("click", onClick);
  dlgWatch.disconnect();
  paneMod = null; paneId = null; root = null;
}
export function update(reason) {
  if (!root) return;
  if (layout === "list") { drawList(); return; }
  renderNav();
  if (paneMod && paneMod.update) paneMod.update(reason || {});
}

/* ---------- layout ---------- */
function wanted() { const p = route.rest[0]; return PANES[p] ? p : null; }
function draw() {
  if (!root) return;
  const want = wanted();
  if (phoneMq.matches && !want) return drawList();
  const id = want || FIRST;
  const mode = phoneMq.matches ? "full" : "split";
  if (layout !== mode) {
    layout = mode;
    root.innerHTML = mode === "split"
      ? '<header class="w-head"><div class="w-title"><h3>' + t("Settings") + '</h3></div></header><div class="w-set"><nav class="w-setnav" id="set-nav" aria-label="' + esc(t("Settings")) + '"></nav><section class="w-pane" id="set-pane" tabindex="-1"></section></div>'
      : '<header class="w-shead"><a href="/settings" class="w-sback" data-pane-back>' + icon("left") + "<span>" + t("Settings") + '</span></a><h3 id="set-title"></h3></header><section class="w-pane" id="set-pane" tabindex="-1"></section>';
    paneId = null;
  }
  renderNav();
  showPane(id);
}
/* Phone: the list of panes, grouped as on desktop */
function drawList() {
  if (paneMod && paneMod.unmount) paneMod.unmount();
  paneMod = null; paneId = null;
  layout = "list";
  root.innerHTML = '<header class="w-head"><div class="w-title"><h3>' + t("Settings") + "</h3></div></header>" + GROUPS.map(([label, ids]) =>
    '<div class="w-plabel">' + label() + '</div><nav class="w-cells" aria-label="' + esc(label()) + '">' + ids.map((id) => {
      const p = PANES[id];
      return '<a class="w-cell w-scell" href="/settings/' + id + '" data-pane="' + id + '" data-k="pane:' + id + '"><span>' + icon(p.icon) + p.label() + "</span><b>" + p.value() + icon("right") + "</b></a>";
    }).join("") + "</nav>").join("") + version();
}
function version() { return '<p class="w-setver">Wally ' + esc((state.status && state.status.version) || "") + "</p>"; }

function renderNav() {
  const nav = root && root.querySelector("#set-nav");
  if (!nav) return;
  nav.innerHTML = GROUPS.map(([label, ids]) => '<div class="grp"><span>' + label() + "</span>" + ids.map((id) => {
    const p = PANES[id], on = id === (paneId || wanted() || FIRST);
    return '<a href="/settings/' + id + '" data-pane="' + id + '" data-k="pane:' + id + '"' + (on ? ' aria-current="page"' : "") + ">" + icon(p.icon) + p.label() + "<span>" + p.value() + "</span></a>";
  }).join("") + "</div>").join("") + version();
}

async function showPane(id) {
  if (id === paneId && paneMod) { if (paneMod.update) paneMod.update({}); return; }
  if (paneMod && paneMod.unmount) paneMod.unmount();
  paneMod = null;
  paneId = id;
  const token = ++paneToken;
  const p = PANES[id];
  const old = root.querySelector("#set-pane");
  const box = old.cloneNode(false);           // a fresh box, so no listener of the last pane is left on it
  box.setAttribute("aria-label", p.label());
  old.replaceWith(box);
  const title = root.querySelector("#set-title");
  if (title) title.textContent = p.label();
  document.title = p.label() + " · " + t("Settings") + " · Wally";
  renderNav();
  const mod = await p.load();
  if (token !== paneToken || !root) return;
  paneMod = mod;
  await mod.mount(box);
}

/* Moving between panes stays on this page: only the pane is drawn again */
function go(path) {
  history.pushState(null, "", path);
  const parts = path.replace(/^\/+|\/+$/g, "").split("/");
  route = { name: "settings", rest: parts.slice(1), query: new URLSearchParams("") };
  draw();
  const box = root.querySelector("#set-pane");
  if (phoneMq.matches) window.scrollTo(0, 0);
  if (box && layout === "full") box.focus({ preventScroll: true });
}
function onClick(ev) {
  const keyed = ev.target.closest("[data-k]");
  if (keyed) lastKey = keyed.dataset.k;
  if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button) return;
  const a = ev.target.closest("a[data-pane]");
  if (a) { ev.preventDefault(); if (a.dataset.pane !== paneId || layout === "list") go("/settings/" + a.dataset.pane); return; }
  if (ev.target.closest("a[data-pane-back]")) { ev.preventDefault(); go("/settings"); }
}
function refocus() {
  if (!root || !lastKey) return;
  const a = document.activeElement;
  if (a && a !== document.body && document.contains(a)) return;
  const again = root.querySelector('[data-k="' + CSS.escape(lastKey) + '"]');
  if (again) again.focus();
  else { const box = root.querySelector("#set-pane"); if (box) box.focus({ preventScroll: true }); }
}
/* Panes open each other ("Turn it on in Sign-in") */
export function openPane(id) { if (root) go("/settings/" + id); }
