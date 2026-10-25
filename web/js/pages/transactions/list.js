/* Transactions: the list. Rows grouped by day (and by month across several months).
   Up to 500 rows it is plain HTML with sticky day headers; past that only the rows on screen are
   drawn, so 20,000 rows scroll as smoothly as 20. */
import { state, t, esc, f, amt, av, pname, tile, dlabL, monthYear, couple } from "../../core.js";

/* Whose it is: with one person in the household, nothing is shared, so it is theirs */
export function owner(x) { return x.p === null && !couple() && state.people[0] ? String(state.people[0].id) : x.p; }

/* One transaction row. opts: {sel, check (true/false/null), date, tab: false leaves it out of the Tab order} */
export function txRow(x, opts) {
  opts = opts || {};
  const inc = x.type === "income", v = amt(x), part = x.p === null && state.scope !== "all" && Math.abs(v - x.a) > 0.004;
  const check = opts.check === true || opts.check === false;
  const name = x.n || x.c;
  return '<button type="button" class="w-row' + (opts.sel ? " sel" : "") + (check ? " chk" : "") + '" data-id="' + esc(x.id) + '"' +
    (check ? ' aria-pressed="' + opts.check + '"' : opts.sel ? ' aria-current="true"' : "") + (opts.tab === false ? ' tabindex="-1"' : "") + ">" +
    (check ? '<span class="w-cb' + (opts.check ? " on" : "") + '" aria-hidden="true"></span>' : "") + tile(x.c) +
    '<div class="tx-rm"><h6>' + esc(name) + "</h6><p>" + (opts.date ? "<span>" + esc(dlabL(x.d)) + "</span>" : "") +
      '<span class="tx-who">' + av(owner(x), "sm") + esc(pname(owner(x))) + "</span><span>· " + esc(x.c) + "</span>" +
      (x.rec ? '<svg class="i tx-rec" role="img" aria-label="' + esc(t("Recurring")) + '"><use href="#i-repeat"/></svg>' : "") +
      x.tags.map((g) => '<span class="w-ht">' + esc(g) + "</span>").join("") +
      (x.pending ? '<span class="w-ht tx-wait">' + esc(t("Waiting to send")) + "</span>" : "") + "</p></div>" +
    '<span class="amt' + (inc ? " pos" : "") + '">' + (inc ? "+" : "") + f(v) + (part ? '<small class="of">' + esc(t("of {amount}", { amount: f(x.a) })) + "</small>" : "") + "</span></button>";
}

/* The flat list of what is drawn: month headers (across months), day headers, rows */
export function buildItems(list, byMonth) {
  const items = [], spentDay = {}, spentMonth = {};
  for (const x of list) {
    if (x.type !== "expense") continue;
    const v = amt(x);
    spentDay[x.d] = (spentDay[x.d] || 0) + v;
    const k = x.d.slice(0, 7);
    spentMonth[k] = (spentMonth[k] || 0) + v;
  }
  let curD = null, curM = null;
  for (const x of list) {
    if (x.d !== curD) {
      const k = x.d.slice(0, 7);
      if (byMonth && k !== curM) { curM = k; items.push({ k: "m", key: k, spent: spentMonth[k] || 0 }); }
      curD = x.d;
      items.push({ k: "d", d: x.d, spent: spentDay[x.d] || 0 });
    }
    items.push({ k: "r", x });
  }
  return items;
}
function headHtml(it) {
  if (it.k === "m") return '<div class="w-monh" role="heading" aria-level="3">' + esc(monthYear(+it.key.slice(0, 4), +it.key.slice(5, 7))) + "<span>" + (it.spent ? esc(t("{amount} spent", { amount: f(it.spent) })) : "") + "</span></div>";
  return '<div class="w-dayh" role="heading" aria-level="4">' + esc(dlabL(it.d)) + "<span>" + (it.spent ? esc(t("{amount} spent", { amount: f(it.spent) })) : "") + "</span></div>";
}

/* Heights in the windowed list (fixed there by transactions.css) */
const H = { m: 44, d: 38, r: 56 };
const WINDOW_OVER = 500;  // more rows than this: draw only what is on screen
const OVERSCAN = 600;     // px drawn above and below the screen

export class TxList {
  constructor(box) {
    this.box = box;
    this.items = [];
    this.rows = [];        // the row items, in order (for ↑ ↓)
    this.index = new Map(); // id → item index
    this.windowed = false;
    this.range = [-1, -1];
    this.rowOpts = () => ({});
    this.onScroll = () => { if (this.windowed) this.paint(); };
    box.addEventListener("scroll", this.onScroll, { passive: true });
    window.addEventListener("scroll", this.onScroll, { passive: true });
    window.addEventListener("resize", this.onScroll, { passive: true });
  }
  destroy() {
    this.box.removeEventListener("scroll", this.onScroll);
    window.removeEventListener("scroll", this.onScroll);
    window.removeEventListener("resize", this.onScroll);
  }
  /* items from buildItems; rowOpts(x) gives each row's options; empty is the HTML when there is nothing */
  set(items, rowOpts, empty) {
    this.items = items;
    this.rowOpts = rowOpts;
    this.rows = [];
    this.index = new Map();
    items.forEach((it, i) => { if (it.k === "r") { this.index.set(it.x.id, i); this.rows.push(it.x); } });
    this.windowed = this.rows.length > WINDOW_OVER;
    this.box.classList.toggle("tx-win", this.windowed);
    if (!items.length) { this.box.innerHTML = empty || ""; return; }
    if (!this.windowed) {
      this.box.innerHTML = items.map((it) => (it.k === "r" ? txRow(it.x, rowOpts(it.x)) : headHtml(it))).join("");
      return;
    }
    // Windowed: a spacer as tall as the whole list, and only the visible slice drawn in it
    this.tops = new Float64Array(items.length + 1);
    for (let i = 0; i < items.length; i++) this.tops[i + 1] = this.tops[i] + H[items[i].k];
    this.box.innerHTML = '<div class="tx-pin" aria-hidden="true"></div><div class="tx-vpad" style="height:' + this.tops[items.length] + 'px"><div class="tx-vwin"></div></div>';
    this.pad = this.box.querySelector(".tx-vpad");
    this.win = this.box.querySelector(".tx-vwin");
    this.pin = this.box.querySelector(".tx-pin");
    this.range = [-1, -1];
    this.paint(true);
  }
  /* The part of the list on screen, in list pixels: the list scrolls by itself on desktop, with the page on phones */
  viewport() {
    const b = this.box;
    if (b.scrollHeight > b.clientHeight + 1) return [b.scrollTop, b.scrollTop + b.clientHeight];
    const top = this.pad.getBoundingClientRect().top;
    return [Math.max(0, -top), Math.max(0, -top) + innerHeight];
  }
  at(px) { // the item at a pixel offset (binary search)
    let lo = 0, hi = this.items.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.tops[mid] <= px) lo = mid; else hi = mid - 1; }
    return lo;
  }
  paint(force) {
    if (!this.windowed || !this.pad || !this.pad.isConnected) return;
    const [vt, vb] = this.viewport();
    const i0 = this.at(Math.max(0, vt - OVERSCAN)), i1 = this.at(vb + OVERSCAN);
    if (force || i0 !== this.range[0] || i1 !== this.range[1]) {
      this.range = [i0, i1];
      let html = "";
      for (let i = i0; i <= i1; i++) { const it = this.items[i]; html += it.k === "r" ? txRow(it.x, this.rowOpts(it.x)) : headHtml(it); }
      this.win.style.transform = "translateY(" + this.tops[i0] + "px)";
      this.win.innerHTML = html;
    }
    // The day header of the first row on screen stays pinned at the top, as sticky headers do
    const first = this.at(vt);
    let h = -1;
    if (this.items[first].k === "r") for (let i = first; i >= 0; i--) if (this.items[i].k === "d") { h = i; break; }
    const html = h >= 0 && vt > 0 ? headHtml(this.items[h]) : "";
    if (this.pin.innerHTML !== html) this.pin.innerHTML = html;
  }
  /* Draw the selection again (and the checks in Select mode) without rebuilding the list */
  redraw(ids) {
    if (this.windowed) { this.paint(true); return; }
    (ids || []).forEach((id) => {
      const i = this.index.get(id), old = this.row(id);
      if (i === undefined || !old) return;
      const tmp = document.createElement("div");
      tmp.innerHTML = txRow(this.items[i].x, this.rowOpts(this.items[i].x));
      const had = document.activeElement === old;
      old.replaceWith(tmp.firstChild);
      if (had) this.row(id).focus({ preventScroll: true });
    });
  }
  row(id) { return this.box.querySelector('[data-id="' + id + '"]'); }
  /* Scroll so a row is on screen, then (optionally) focus it */
  reveal(id, focus, center) {
    const i = this.index.get(id);
    if (i === undefined) return;
    if (this.windowed) {
      const top = this.tops[i], bot = this.tops[i + 1], [vt, vb] = this.viewport(), pinH = H.d + 4;
      const scrolls = this.box.scrollHeight > this.box.clientHeight + 1;
      let delta = 0;
      if (center) delta = top - vt - (vb - vt) / 3;
      else if (top - pinH < vt) delta = top - pinH - vt;
      else if (bot > vb - (scrolls ? 0 : 90)) delta = bot - vb + (scrolls ? 0 : 90);
      if (delta) { if (scrolls) this.box.scrollTop += delta; else window.scrollBy(0, delta); }
      this.paint(true);
    }
    const el = this.row(id);
    if (!el) return;
    if (!this.windowed) {
      const b = this.box;
      if (b.scrollHeight > b.clientHeight + 1) { // the list scrolls by itself: move only the list, never the page
        const r = el.getBoundingClientRect(), br = b.getBoundingClientRect(), pinH = H.d + 4;
        if (center) b.scrollTop += r.top - br.top - b.clientHeight / 3;
        else if (r.top < br.top + pinH) b.scrollTop -= br.top + pinH - r.top;
        else if (r.bottom > br.bottom) b.scrollTop += r.bottom - br.bottom;
      } else el.scrollIntoView({ block: center ? "center" : "nearest" });
    }
    if (focus) el.focus({ preventScroll: true });
  }
}
