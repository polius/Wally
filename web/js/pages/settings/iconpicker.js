/* The icon picker of Settings, for categories and tags: the pick, big, in its color; a search; the
   suggested icons; then all of Lucide's. Lucide's list is read the first time the picker opens. Done keeps
   the pick. */
import { t, esc, num, icon, iconsFor, iconHref, CAT_LUCIDE, OWN_DRAWN } from "../../core.js";
import { openDialog } from "../../ui.js";

let lib = null;
const OWNER = Object.fromEntries(Object.entries(CAT_LUCIDE).map(([mine, n]) => [n, mine]));
// All of Lucide's but the ones Wally already shows the same
const libIds = (all) => all.filter((x) => !OWNER[x.n] || OWN_DRAWN.has(OWNER[x.n])).map((x) => x.id);
const loadLib = () => lib || (lib = fetch("/icons/lucide.json").then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then((j) => j.icons.map(([n, tags]) => ({ id: "l-" + n, n, hay: n.replace(/-/g, " ") + " " + tags })))
  .catch((e) => { lib = null; throw e; }));
const glyph = (id) => '<svg class="i" aria-hidden="true"><use href="' + iconHref(id) + '"/></svg>';
const label = (id) => (id.startsWith("l-") ? id.slice(2) : id).replace(/-/g, " ");
/* The grid draws only the icons on screen and near it: each block of eight rows starts empty, as tall
   as it will be, and gets its buttons when it scrolls close. All of Lucide's are about two thousand
   buttons, each a copy of a drawing from another file: built at once, on a phone they took long to
   open, and again on every letter typed. x is a button's place in the whole list, for the arrow keys. */
const PER = 64;
const cells = (ids, from, pick) => ids.map((id, i) => '<button type="button" role="radio" data-i="' + id + '" data-x="' + (from + i) + '" aria-checked="' + (id === pick) + '" aria-label="' + esc(label(id)) + '" title="' + esc(label(id)) + '">' + glyph(id) + "</button>").join("");
function iconGrid(list, scroller) {
  let shown = [], pick = "", seen = null;
  const fill = (b) => {
    if (b.dataset.on) return;
    const from = +b.dataset.from;
    b.innerHTML = cells(shown.slice(from, from + +b.dataset.n), from, pick);
    b.dataset.on = "1";
    if (seen) seen.unobserve(b);
  };
  return {
    /* sections: [[title or "", ids]]; returns false when there's nothing to show */
    draw(sections, current) {
      pick = current;
      shown = [];
      let html = "";
      for (const [title, ids] of sections) {
        if (!ids.length) continue;
        if (title) html += '<div class="w-glh">' + title + "</div>";
        html += '<div class="w-icgrp">';
        // Not drawn yet, it's as tall as its rows will be (settings.css)
        for (let i = 0; i < ids.length; i += PER) { const n = Math.min(PER, ids.length - i); html += '<div class="w-icons" data-from="' + (shown.length + i) + '" data-n="' + n + '" style="--rows:' + Math.ceil(n / 8) + '"></div>'; }
        html += "</div>";
        shown = shown.concat(ids);
      }
      list.innerHTML = html;
      const blocks = [...list.querySelectorAll(".w-icons")];
      if (!blocks.length) return false;
      fill(blocks[0]);
      if (seen) seen.disconnect();
      // A screen ahead, above and below, so a quick scroll doesn't show them empty
      seen = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) fill(e.target); }), { root: scroller, rootMargin: "100% 0px" });
      blocks.slice(1).forEach((b) => seen.observe(b));
      return true;
    },
    picked(id) { pick = id; },
    // The button at a place in the list, drawn first if its block isn't yet
    at(x) {
      x = Math.max(0, Math.min(shown.length - 1, x));
      const b = [...list.querySelectorAll(".w-icons")].find((n) => x >= +n.dataset.from && x < +n.dataset.from + +n.dataset.n);
      if (!b) return null;
      fill(b);
      return b.querySelector('[data-x="' + x + '"]');
    },
    first() { return list.querySelector("[data-i]"); },
  };
}

/* What was typed: every word somewhere in the icon's name or Lucide's words for it. The best first: the
   very name, then names that start or have it, then a category word in any language (cotxe), then
   Lucide's words for it. One of Wally's own takes the place of Lucide's copy. */
function search(q, all, suggested) {
  const words = q.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const w0 = words[0], best = new Map();
  const add = (id, score) => { if (!best.has(id) || best.get(id) > score) best.set(id, score); };
  const byName = (n) => (n === w0 ? 0 : n.startsWith(w0) || n.split("-").some((p) => p.startsWith(w0)) ? 1 : n.includes(w0) ? 2 : 4);
  iconsFor(q).forEach((id) => add(id, 3));
  suggested.forEach((id) => { if (words.every((w) => id.includes(w))) add(id, byName(id)); });
  for (const x of all || []) {
    if (!words.every((w) => x.hay.includes(w))) continue;
    const mine = OWNER[x.n], score = byName(x.n);
    if (mine) add(mine, score);
    if (!mine || OWN_DRAWN.has(mine)) add(x.id, score);
  }
  return [...best].map((e, i) => [e[0], e[1], i]).sort((x, y) => x[1] - y[1] || x[2] - y[2]).map((e) => e[0]);
}

/* title: already escaped. now: the icon's id. suggested: the ids shown first. save(id): when Done changes it. */
export function openIconPicker({ title, now, color, suggested, save }) {
  let pick = now, all = null;
  openDialog({
    kind: "sheet",
    title,
    top: '<div class="w-icprev"><span class="w-ico">' + glyph(now) + "</span></div>" +
      '<label class="w-gsearch w-icsearch">' + icon("search") + '<input type="search" id="ic-q" autocomplete="off" spellcheck="false" placeholder="' + esc(t("Search icons")) + '" aria-label="' + esc(t("Search icons")) + '"></label>',
    body: '<div id="ic-list" role="radiogroup" aria-label="' + esc(t("Icon")) + '"></div>',
    ok: t("Done"),
    onOpen(root) {
      root.classList.add("w-icdlg");
      root.style.setProperty("--ic", color);
      const list = root.querySelector("#ic-list"), q = root.querySelector("#ic-q");
      const grid = iconGrid(list, list.parentElement);
      const draw = () => {
        const found = search(q.value, all, suggested);
        if (found) {
          if (!grid.draw([["", found]], pick)) list.innerHTML = '<p class="w-icnone">' + esc(t("No icons match “{q}”.", { q: q.value.trim() })) + "</p>";
          return;
        }
        grid.draw([[t("Suggested"), suggested], [t("All icons"), all ? libIds(all) : []]], pick);
        if (!all) list.insertAdjacentHTML("beforeend", '<div class="w-glh">' + t("All icons") + '</div><p class="w-icnone" id="ic-wait">' + t("Loading…") + "</p>");
      };
      draw();
      loadLib().then((x) => { all = x; q.placeholder = t("Search {n} icons", { n: num(libIds(x).length + suggested.length) }); if (root.isConnected) draw(); })
        .catch(() => { const w = root.querySelector("#ic-wait"); if (w) w.textContent = t("All icons need a connection. Try again in a moment."); });
      // Each letter draws the first blocks found again, no more: quick even on a phone
      q.addEventListener("input", () => { draw(); list.parentElement.scrollTop = 0; });
      // Enter in the search picks the first icon found
      q.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); const f = grid.first(); if (f) f.click(); } });
      list.addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-i]");
        if (!b) return;
        pick = b.dataset.i;
        grid.picked(pick);
        list.querySelectorAll('[aria-checked="true"]').forEach((x) => x.setAttribute("aria-checked", "false"));
        list.querySelectorAll('[data-i="' + pick + '"]').forEach((x) => x.setAttribute("aria-checked", "true"));
        root.querySelector(".w-icprev use").setAttribute("href", iconHref(pick));
      });
      // Arrow keys move through the grid, eight to a row
      list.addEventListener("keydown", (ev) => {
        const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 8, ArrowUp: -8 }[ev.key];
        const from = ev.target.closest("[data-x]");
        if (!step || !from) return;
        ev.preventDefault();
        const rtl = getComputedStyle(root).direction === "rtl" && Math.abs(step) === 1 ? -1 : 1;
        const to = grid.at(+from.dataset.x + step * rtl);
        if (!to) return;
        to.focus();
        to.click();
      });
      // On a computer, straight into the search. On a touch screen the keyboard would cover the icons
      // as the sheet opens: the search is a tap away
      (matchMedia("(pointer:coarse)").matches ? root.querySelector("[data-dlg-ok]") : q).focus();
    },
    onOk: async () => {
      if (pick !== now) await save(pick);
    },
  });
}
