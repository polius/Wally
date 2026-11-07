/* Settings: grouped like System Settings. A list of panes on the left (or, on a phone, a list
   that opens each pane full screen), and the pane on the right. Each pane is its own module:
   mount(box, sub), update(reason), unmount(), and optionally meta(sub) → {title, back: {path, label}}
   and onAction(act) for the button at the top right of the pane (Edit, Done). A pane can open its own
   pages (a person, a category) at /settings/<pane>/<sub>. */
import { $, t, esc, state, icon, num, GET, LANGUAGES, LANG } from "../core.js";
import { counts } from "./settings/common.js";
import { theme } from "../shell.js";

const langName = () => esc((LANGUAGES.find((l) => l[0] === LANG) || ["", "English"])[1]);
const themeName = () => ({ auto: t("Auto"), light: t("Light"), dark: t("Dark") })[theme()] || t("Auto");
/* Sign-in & Privacy is one page; until its module exists, the two older panes stand in, one under the other */
async function loadSecurity() {
  try { return await import("./settings/security.js"); } catch (e) { return pair(await import("./settings/signin.js"), await import("./settings/privacy.js")); }
}
function pair(a, b) {
  let one = null, two = null;
  return {
    async mount(box) { one = document.createElement("div"); two = document.createElement("div"); one.className = two.className = "w-pane"; box.append(one, two); await a.mount(one); await b.mount(two); },
    update(r) { if (a.update) a.update(r); if (b.update) b.update(r); },
    unmount() { if (a.unmount) a.unmount(); if (b.unmount) b.unmount(); },
  };
}
const PANES = {
  people: { icon: "users", label: () => t("People"), value: () => num(state.people.length), load: () => import("./settings/people.js") },
  categories: { icon: "overview", label: () => t("Categories"), value: () => num(state.categories.length), load: () => import("./settings/categories.js") },
  tags: { icon: "tag", label: () => t("Tags"), value: () => num(state.tags.length), load: () => import("./settings/tags.js") },
  region: { icon: "globe", label: () => t("Language & Region"), value: langName, load: () => import("./settings/region.js") },
  appearance: { icon: "sun", label: () => t("Appearance"), value: themeName, load: () => import("./settings/appearance.js") },
  security: { icon: "lock", label: () => t("Sign-in & Privacy"), value: () => (state.status && state.status.vault && state.status.vault.on ? t("Encrypted") : state.status && state.status.signin ? t("On") : t("Off")), load: loadSecurity },
  import: { icon: "io", label: () => t("Import & Export"), value: () => "", load: () => import("./settings/import.js") },
  keys: { icon: "key", label: () => t("API keys"), value: () => (counts.keys === null ? "" : num(counts.keys)), load: () => import("./settings/keys.js") },
};
const GROUPS = [
  [() => t("Household"), ["people", "categories", "tags"]],
  [() => t("General"), ["region", "appearance"]],
  [() => t("Security"), ["security"]],
  [() => t("Data"), ["import"]],
  [() => t("Advanced"), ["keys"]],
];
/* Older addresses, kept working */
const ALIAS = { signin: "security", privacy: "security", language: "region", currency: "region/currency" };
const FIRST = "people";

let root = null, route = null, phoneMq = null;
let paneId = null, paneSub = "", paneMod = null, paneToken = 0;
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
function wanted() {
  let parts = route.rest.slice();
  if (ALIAS[parts[0]]) parts = ALIAS[parts[0]].split("/").concat(parts.slice(1));
  return PANES[parts[0]] ? { id: parts[0], sub: parts.slice(1).join("/") } : null;
}
function draw() {
  if (!root) return;
  const want = wanted();
  if (phoneMq.matches && !want) return drawList();
  const { id, sub } = want || { id: FIRST, sub: "" };
  const mode = phoneMq.matches ? "full" : "split";
  if (layout !== mode) {
    layout = mode;
    root.innerHTML = mode === "split"
      ? '<header class="w-head"><div class="w-title"><h3>' + t("Settings") + '</h3></div></header><div class="w-set"><nav class="w-setnav" id="set-nav" aria-label="' + esc(t("Settings")) + '"></nav><div class="w-pwrap"><div class="w-phead" id="set-head"></div><section class="w-pane" id="set-pane" tabindex="-1"></section></div></div>'
      : '<header class="w-shead" id="set-head"></header><section class="w-pane" id="set-pane" tabindex="-1"></section>';
    paneId = null;
  }
  renderNav();
  showPane(id, sub);
}
/* Phone: the list of panes, grouped as on desktop */
function drawList() {
  if (paneMod && paneMod.unmount) paneMod.unmount();
  paneMod = null; paneId = null;
  layout = "list";
  document.title = t("Settings") + " · Wally";
  root.innerHTML = '<header class="w-head"><div class="w-title"><h3>' + t("Settings") + '</h3></div></header><div class="w-setroot">' + GROUPS.map(([label, ids]) =>
    '<div class="w-glh">' + label() + '</div><nav class="w-gl w-setlist" aria-label="' + esc(label()) + '">' + ids.map((id) => {
      const p = PANES[id];
      return '<a class="w-gr" href="/settings/' + id + '" data-pane="' + id + '" data-k="pane:' + id + '"><span class="w-sico">' + icon(p.icon) + '</span><span class="k">' + p.label() + '</span><span class="v">' + p.value() + "</span>" + icon("right", "chev") + "</a>";
    }).join("") + "</nav>").join("") + version() + "</div>";
}
function version() { return '<p class="w-setver">Wally ' + esc((state.status && state.status.version) || "") + "</p>"; }

function renderNav() {
  const nav = root && root.querySelector("#set-nav");
  if (!nav) return;
  const cur = paneId || (wanted() || { id: FIRST }).id;
  nav.innerHTML = GROUPS.map(([label, ids]) => '<div class="grp"><span>' + label() + "</span>" + ids.map((id) => {
    const p = PANES[id], on = id === cur;
    return '<a href="/settings/' + id + '" data-pane="' + id + '" data-k="pane:' + id + '"' + (on ? ' aria-current="page"' : "") + ">" + icon(p.icon) + '<span class="l">' + p.label() + '</span><span class="v">' + p.value() + "</span></a>";
  }).join("") + "</div>").join("") + version();
}

/* The pane's head: a way back, its title, and its button (Edit). On a phone the title is large, under the way back. */
function meta() {
  const p = PANES[paneId];
  const m = (paneMod && paneMod.meta && paneMod.meta(paneSub)) || {};
  const title = m.title !== undefined ? m.title : paneSub ? "" : p.label();
  const back = m.back || (paneSub ? { path: paneId, label: p.label() } : layout === "full" ? { path: "", label: t("Settings") } : null);
  return { title, back };
}
export function renderHead() {
  const h = root && root.querySelector("#set-head");
  if (!h || !paneId) return;
  if (paneMod && paneMod.ownHead && paneSub) { h.innerHTML = '<span id="set-act" hidden></span>'; root.classList.add("w-subpage"); return; }
  const { title, back } = meta();
  const act = h.querySelector("#set-act");
  const keep = act ? act.innerHTML : "";
  const b = back ? '<a class="w-sback" href="/settings' + (back.path ? "/" + back.path : "") + '" data-pane="' + back.path + '" data-k="back">' + icon("left") + "<span>" + back.label + "</span></a>" : "";
  h.innerHTML = layout === "full"
    ? '<div class="w-pnav">' + (b || "<span></span>") + '<span id="set-act"></span></div>' + (title ? '<h3 id="set-title">' + title + "</h3>" : "")
    : b + (title || keep ? '<div class="w-pth"><h4 id="set-title">' + title + '</h4><span id="set-act"></span></div>' : '<span id="set-act" hidden></span>');
  const again = h.querySelector("#set-act");
  if (again && keep) { again.innerHTML = keep; again.hidden = false; }
  root.classList.toggle("w-subpage", !!paneSub);
}

async function showPane(id, sub) {
  sub = sub || "";
  if (id === paneId && sub === paneSub && paneMod) { if (paneMod.update) paneMod.update({}); renderHead(); return; }
  if (id === paneId && paneMod && paneMod.show) {
    paneSub = sub;
    const h = root.querySelector("#set-act"); if (h) h.innerHTML = "";
    renderHead();
    await paneMod.show(sub);
    renderHead();
    return;
  }
  if (paneMod && paneMod.unmount) paneMod.unmount();
  paneMod = null;
  paneId = id; paneSub = sub;
  const token = ++paneToken;
  const p = PANES[id];
  const old = root.querySelector("#set-pane");
  const box = old.cloneNode(false);           // a fresh box, so no listener of the last pane is left on it
  box.setAttribute("aria-label", p.label());
  old.replaceWith(box);
  const act = root.querySelector("#set-act"); if (act) act.innerHTML = "";
  document.title = p.label() + " · " + t("Settings") + " · Wally";
  renderNav();
  renderHead();
  const mod = await p.load();
  if (token !== paneToken || !root) return;
  paneMod = mod;
  await mod.mount(box, sub);
  renderHead();
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
  const act = ev.target.closest("#set-act [data-act]");
  if (act) { if (paneMod && paneMod.onAction) paneMod.onAction(act.dataset.act, act); return; }
  const a = ev.target.closest("a[data-pane]");
  if (a) {
    ev.preventDefault();
    const path = a.dataset.pane;
    if (!path) { go("/settings"); return; }
    go("/settings/" + path);
  }
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
/* An item's page that changes its address (renamed): the same page, the new address */
export function replaceSub(sub) {
  if (!root || !paneId) return;
  paneSub = sub;
  const path = "/settings/" + paneId + (sub ? "/" + sub : "");
  history.replaceState(null, "", path);
  route = { name: "settings", rest: path.split("/").slice(2), query: new URLSearchParams("") };
}
/* A pane's top-right button: Edit, Done, Add */
export function setAction(html) {
  const a = root && root.querySelector("#set-act");
  if (!a) return;
  a.innerHTML = html || "";
  a.hidden = !html;
  if (layout === "split" && !a.closest(".w-pth") && html) renderHead();
}
