/* The command bar (2.1), ⌘K or Ctrl+K anywhere: search, jump to any page, settings pane, rule or
   category, find a transaction by name, or add one by typing it: "12 coffee ana". */
import { $, t, esc, state, f, dlabW, cat, tile, av, couple, icon, LANG } from "./core.js";
import { navigate, setScope, setHide } from "./shell.js";
import { trapFocus, hideTip } from "./ui.js";
import { shortDesc } from "./sched.js";

const MAX = 12;
let items = [];
let hl = 0;
let back = null;   // where focus goes back to on close

/* Settings panes, as Settings names them */
const PANES = [
  ["people", "users", () => t("People")], ["categories", "overview", () => t("Categories")], ["tags", "tag", () => t("Tags")],
  ["currency", "coin", () => t("Currency")], ["import", "io", () => t("Import and export")], ["keys", "key", () => t("API keys")],
  ["signin", "lock", () => t("Sign-in")], ["language", "globe", () => t("Language")], ["appearance", "layout", () => t("Appearance")],
];

/* Text for matching: lower case, without accents, so "cafe" finds "Café" */
const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase(LANG);
const matches = (hay, words) => { const h = fold(hay); return words.every((w) => h.includes(w)); };
const glyph = (id) => icon(id);
const add = (o) => import("./add.js").then((m) => m.openAdd(o));

/* "12 coffee ana", "4,50 bakery @kim": an amount, a name, and maybe who */
function quickAdd(q) {
  const m = q.trim().match(/^(\d+(?:[.,]\d{1,2})?)\s+(.+)$/);
  if (!m) return null;
  const amount = Number(m[1].replace(",", "."));
  let words = m[2].trim().split(/\s+/), who = null;
  const last = fold(words[words.length - 1].replace(/^@/, ""));
  const p = words.length > 1 || m[2].startsWith("@") ? state.people.find((x) => fold(x.name) === last || fold(x.name).split(/\s+/)[0] === last) : null;
  if (p) { who = String(p.id); words = words.slice(0, -1); }
  const typed = words.join(" ").replace(/^@/, "");
  // The payee it most likely is, from what was added before
  const counts = {};
  if (typed) for (const x of state.tx) if (x.type === "expense" && x.n && fold(x.n).includes(fold(typed))) { const o = (counts[x.n] = counts[x.n] || { k: 0, cats: {} }); o.k++; o.cats[x.c] = (o.cats[x.c] || 0) + 1; }
  const guess = Object.keys(counts).sort((a, b) => counts[b].k - counts[a].k)[0];
  const category = guess ? Object.keys(counts[guess].cats).sort((a, b) => counts[guess].cats[b] - counts[guess].cats[a])[0] : null;
  const name = guess || typed;
  if (!name && !who) return null;
  const label = who ? t("Add {amount} {name} for {person}", { amount: f(amount), name, person: state.people.find((x) => String(x.id) === who).name }) : t("Add {amount} {name}", { amount: f(amount), name });
  const opts = { amount, name };
  if (who) opts.person = who;
  if (category) opts.category = category;
  return { g: t("Add"), l: label, s: category ? cat(category).n : t("Pick a category next"), ic: category ? tile(category, 22) : glyph("plus"), run: () => add(opts) };
}

function build(q) {
  const words = fold(q.trim()).split(/\s+/).filter(Boolean), out = [];
  const quick = quickAdd(q);
  if (quick) out.push(quick);
  const go = (path) => () => navigate(path);
  const fixed = [
    [t("Go to"), t("Dashboard"), "overview", go("/")],
    [t("Go to"), t("Transactions"), "list", go("/transactions")],
    [t("Go to"), t("Recurring"), "repeat", go("/recurring")],
    [t("Go to"), t("Budgets"), "coin", go("/budgets")],
    [t("Go to"), t("Month in review"), "cal", go("/review")],
    [t("Go to"), t("Settings"), "settings", go("/settings")],
    [t("Add"), t("New expense"), "plus", () => add()],
    [t("Add"), t("New income"), "income", () => add({ type: "income" })],
    [t("Add"), t("New recurring"), "repeat", () => add({ repeat: true })],
  ];
  const show = [];
  if (couple()) {
    show.push([t("Show"), t("Everyone"), null, () => setScope("all"), av("all", "sm")]);
    state.people.forEach((p) => show.push([t("Show"), t("Only {name}", { name: p.name }), null, () => setScope(String(p.id)), av(String(p.id), "sm")]));
  }
  show.push([t("Show"), state.hide ? t("Show amounts") : t("Hide amounts"), "eye", () => setHide(!state.hide)]);
  const panes = PANES.map(([k, ic, label]) => [t("Settings"), label(), ic, go("/settings/" + k), null, t("Settings") + " " + label()]);
  const list = words.length ? fixed.concat(panes, show) : fixed;
  list.forEach(([g, l, ic, run, lead, hay]) => { if (!words.length || matches((hay || g + " " + l), words)) out.push({ g, l, ic: lead || glyph(ic), run }); });

  if (words.length && !quick) {
    // Rules, categories, then transactions by name
    state.rules.filter((r) => matches(r.n, words)).slice(0, 3).forEach((r) =>
      out.push({ g: t("Recurring"), l: r.n, s: shortDesc(r) + " · " + f(r.a), ic: tile(r.c, 22), run: go("/recurring?id=" + encodeURIComponent(r.id)) }));
    state.categories.filter((c) => matches(c, words)).slice(0, 3).forEach((c) =>
      out.push({ g: t("Categories"), l: cat(c).n, s: t("Transactions in {category}", { category: cat(c).n }), ic: tile(c, 22), run: go("/transactions?q=" + encodeURIComponent(c)) }));
    if (q.trim().length >= 2) {
      let n = 0;
      for (const x of state.tx) {
        if (n >= 4) break;
        if (!x.n || !matches(x.n, words)) continue;
        n++;
        out.push({ g: t("Transactions"), l: x.n + ", " + f(x.a), s: dlabW(x.d) + " · " + cat(x.c).n, ic: tile(x.c, 22), run: go("/transactions?id=" + encodeURIComponent(x.id)) });
      }
      out.push({ g: t("Search"), l: t("Search transactions for “{q}”", { q: q.trim() }), ic: glyph("search"), run: go("/transactions?q=" + encodeURIComponent(q.trim())) });
    }
  }
  return out.slice(0, MAX);
}

/* ---------- drawing ---------- */
function frame() {
  const w = $("cmd");
  w.innerHTML = '<div class="w-cmd" role="dialog" aria-modal="true" aria-label="' + esc(t("Command bar")) + '">' +
    '<label class="w-cmdin">' + icon("search") + '<input id="cmd-q" type="text" role="combobox" aria-expanded="true" aria-controls="cmd-res" aria-autocomplete="list" autocomplete="off" spellcheck="false" enterkeyhint="go" placeholder="' + esc(t("Search, jump, or type “12 coffee” to add")) + '" aria-label="' + esc(t("Command")) + '">' +
    '<button type="button" class="w-cmdx" data-cmd-x aria-label="' + esc(t("Close")) + '"><kbd>Esc</kbd></button></label>' +
    '<div class="w-cmdres" id="cmd-res" role="listbox" aria-label="' + esc(t("Results")) + '"></div>' +
    '<div class="w-cmdhint" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd>' + t("Move") + "</span><span><kbd>↵</kbd>" + t("Open") + "</span><span><kbd>Esc</kbd>" + t("Close") + "</span></div></div>";
  const input = $("cmd-q");
  input.addEventListener("input", () => { hl = 0; render(); });
  // A modal: focus never leaves it while it is open, even when a page finishes drawing behind it
  document.addEventListener("focusin", (ev) => { if (!w.hidden && !w.contains(ev.target)) input.focus(); });
  w.addEventListener("keydown", onKey);
  w.addEventListener("click", (ev) => {
    if (ev.target === w || ev.target.closest("[data-cmd-x]")) return closeCmd();
    const o = ev.target.closest("[data-ci]");
    if (o) runCmd(+o.dataset.ci);
  });
  w.addEventListener("mousemove", (ev) => { const o = ev.target.closest("[data-ci]"); if (o && +o.dataset.ci !== hl) { hl = +o.dataset.ci; mark(); } });
}
function render() {
  const q = $("cmd-q").value;
  items = build(q);
  hl = Math.min(hl, Math.max(items.length - 1, 0));
  let html = "", group = null, gi = 0;
  items.forEach((x, i) => {
    if (x.g !== group) { if (group !== null) html += "</div>"; group = x.g; gi++; html += '<div role="group" aria-labelledby="cmd-g' + gi + '"><div class="w-cmdg" id="cmd-g' + gi + '">' + esc(x.g) + "</div>"; }
    html += '<div role="option" id="cmd-o' + i + '" class="w-cmdi" data-ci="' + i + '" aria-selected="false">' + (x.ic || "") + '<span class="l">' + esc(x.l) + "</span>" + (x.s ? "<small>" + esc(x.s) + "</small>" : "") + "</div>";
  });
  if (group !== null) html += "</div>";
  $("cmd-res").innerHTML = html || '<div class="w-empty" role="status"><b>' + t("Nothing found") + "</b>" + t("Try a payee, a page, or “12 coffee”.") + "</div>";
  mark();
}
/* Move the highlight without drawing the list again */
function mark() {
  const res = $("cmd-res");
  res.querySelectorAll("[data-ci]").forEach((o) => {
    const on = +o.dataset.ci === hl;
    o.classList.toggle("hl", on);
    o.setAttribute("aria-selected", String(on));
    const k = o.querySelector("kbd");
    if (on && !k) o.insertAdjacentHTML("beforeend", '<kbd aria-hidden="true">↵</kbd>');
    else if (!on && k) k.remove();
  });
  const cur = $("cmd-o" + hl), input = $("cmd-q");
  if (cur) { input.setAttribute("aria-activedescendant", cur.id); cur.scrollIntoView({ block: "nearest" }); }
  else input.removeAttribute("aria-activedescendant");
}
function onKey(ev) {
  if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    ev.preventDefault();
    if (!items.length) return;
    hl = (hl + (ev.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    mark();
  } else if (ev.key === "Enter" && !ev.isComposing) {
    ev.preventDefault();
    runCmd(hl);
  } else if (ev.key === "Escape") {
    ev.preventDefault();
    ev.stopPropagation();
    closeCmd();
  } else trapFocus($("cmd").firstChild, ev);
}

/* ---------- open, close, run ---------- */
export function openCmd() {
  const w = $("cmd");
  if (!w.hidden) return closeCmd();   // ⌘K again closes it
  hideTip();
  back = document.activeElement;
  if (!w.firstChild) frame();
  $("cmd-q").value = "";
  hl = 0;
  render();
  w.hidden = false;
  $("cmd-q").focus();
}
export function closeCmd() {
  const w = $("cmd");
  if (w.hidden) return;
  w.hidden = true;
  if (back && document.contains(back)) back.focus();
  back = null;
}
export function runCmd(i) {
  const x = items[i];
  if (!x) return;
  closeCmd();
  x.run();
}
