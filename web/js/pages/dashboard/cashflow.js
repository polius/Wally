/* Cashflow: where the period's money came from and where it went, as a Sankey diagram, drawn quietly.
   On the left who brought it in (their categories, when one person is shown or the household is one person).
   On the right what it went on by category, then what was kept. Wally can't tell whose income paid for what,
   so people meet in the middle. When more went out than came in, the difference joins the income, so both
   sides always add up. With only one source it flows straight out.
   Every flow is the same soft grey, as the other months are in Kept each month; only Kept has a colour, and a
   flow takes its own while you point at it. With no income at all, every flow is the soft red of Overspent: none
   of that money was covered, and in the current month it says "No income yet", as payday may still be to come.
   The card folds the smallest into "And 3 more". The bigger view
   shows every one, with a list: pointing at a row lights its flow, and the other way round. */
import { state, t, tn, esc, amt, f, f0, pct, cc, couple, pname, pcolor, icon, tile, av, ym, TODAY, monthName, monthYear } from "../../core.js";
import { chart, enlarge, el, hover, row, hideTip, closeDialog } from "../../ui.js";
import { goTx } from "./range.js";
import { eByCat } from "./hero.js";

const MAX_LEFT = 5, MAX_RIGHT = 8;
const sum = (list) => list.reduce((s, x) => s + x.v, 0);
const biggest = (a, b) => b.v - a.v;
/* Never "0%" for money that did move */
const share = (v, total) => (v / total < 0.005 ? "<" + pct(0.01) : pct(v / total));
/* A person's colour, the one on their avatar (see .w-av.c1 to c12) */
const AV = [6, 1, 4, 2, 5, 0, 3, 7, 8, 9, 10, 11];
const personColor = (k) => "var(--av" + AV[pcolor(k) - 1] + ")";

/* ---------- the numbers ---------- */
function incomes(a, b) {
  const out = [];
  for (const x of state.tx) if (x.type === "income" && x.d >= a && x.d <= b) out.push(x);
  return out;
}
const toParts = (o) => Object.keys(o).filter((k) => o[k] > 0).map((k) => ({ name: k, cat: k, v: o[k], color: cc(k) })).sort(biggest);
/* Each person's own income plus their share of what came in shared, as The household counts spending */
function byPerson(list) {
  const who = {};
  const add = (k, c, v) => { if (!v) return; const p = who[k] || (who[k] = {}); p[c] = (p[c] || 0) + v; };
  for (const x of list) {
    if (x.p !== null) add(String(x.p), x.c, x.a);
    else state.people.forEach((p) => add(String(p.id), x.c, amt(x, String(p.id))));
  }
  return Object.keys(who).map((k) => {
    const parts = toParts(who[k]);
    return { name: pname(k), person: k, v: sum(parts), parts, color: personColor(k) };
  }).filter((x) => x.v > 0).sort(biggest);
}
function byCategory(list) {
  const o = {};
  for (const x of list) { const v = amt(x); if (v) o[x.c] = (o[x.c] || 0) + v; }
  return toParts(o);
}
export function cashflow(r) {
  const list = incomes(r.start, r.end);
  const sources = state.scope === "all" && couple() ? byPerson(list) : byCategory(list);
  const uses = toParts(eByCat(r.start, r.end));
  const inn = sum(sources), out = sum(uses), left = inn - out;
  const overName = !r.current ? t("Overspent") : inn > 0 ? t("Overspent so far") : t("No income yet");
  if (left >= 0.5) uses.push({ name: t("Kept"), v: left, color: "var(--s-kept)", kept: true });
  else if (left <= -0.5) sources.push({ name: overName, short: inn > 0 ? t("Overspent") : overName, v: -left, color: "var(--w-bad)", over: true });
  return { sources, uses, inn, out, left, total: Math.max(inn, out), overName };
}
/* The smallest as one row. What is nobody's and no category (Kept, Overspent) always stays. */
function fold(list, max) {
  const can = (x) => x.cat || x.person, some = list.filter(can), rest = list.filter((x) => !can(x)), room = max - rest.length;
  if (some.length <= room) return list;
  const gone = some.slice(room - 1);
  return some.slice(0, room - 1).concat({ name: tn(gone.length, "And {n} more", "And {n} more"), v: sum(gone), color: "var(--w-ink3)", gone: true, parts: gone }, rest);
}
const columns = (d, big) => (big ? [d.sources, d.uses] : [fold(d.sources, MAX_LEFT), fold(d.uses, MAX_RIGHT)]);
const rows = (d, big) => Math.max(...columns(d, big).map((c) => c.length));
const describe = (d) => t("Cashflow") + ": " + d.sources.concat(d.uses).map((x) => x.name + " " + f(x.v)).join(", ");

/* "(November)", "(November 2025)", "(2026)", "(All time)", "(1 Jan – 5 Mar)" */
function periodName(r) {
  if (!r.month) return r.title;
  const [y, m] = ym(r.start);
  return y === +TODAY.slice(0, 4) ? monthName(m) : monthYear(y, m);
}
export const cashflowTitle = (r) => esc(t("Cashflow")) + ' <span class="s-per">(' + esc(periodName(r)) + ")</span>";
/* The bigger view opens with the chart's own story, left to right: what came in, what went out, what's left */
function stats(d, r) {
  const over = d.left <= -0.5;
  const stat = (name, v, cls) => '<div' + (cls ? ' class="' + cls + '"' : "") + "><span>" + esc(name) + '</span><b class="amt">' + esc(f0(v)) + "</b></div>";
  const last = over ? d.overName : d.inn > 0 ? t("Kept") + " · " + share(Math.max(d.left, 0), d.inn) : t("Kept");
  return '<div class="w-gl s-cfstats">' + stat(t("Came in"), d.inn) + stat(t("Went out"), d.out) + stat(last, Math.abs(d.left), over ? "over" : "kept") + "</div>";
}

/* ---------- the diagram ---------- */
const textWidth = (svg, s, cls) => { const n = el("text", { class: cls }, svg); n.textContent = s; const v = n.getComputedTextLength(); n.remove(); return v; };
function fit(node, s, max) {
  node.textContent = s;
  for (let c = s; node.getComputedTextLength() > max && c.length > 1;) { c = c.slice(0, -1); node.textContent = c.trimEnd() + "…"; }
}
/* Up to three lines, for a name with its side to itself and the room to wrap */
function wrap(svg, s, max) {
  const lines = [];
  for (const word of s.split(" ")) {
    const longer = lines.length ? lines[lines.length - 1] + " " + word : "";
    if (longer && textWidth(svg, longer, "lb") <= max) lines[lines.length - 1] = longer;
    else lines.push(word);
  }
  return lines.length > 3 ? [lines[0], lines[1], lines.slice(2).join(" ")] : lines;
}
/* A band from one side to the other; its outer end (r0 on the left, r1 on the right) is softly rounded */
const ribbon = (x0, y0, x1, y1, h, r0, r1) => {
  const m = (x0 + x1) / 2;
  return "M" + (x0 + r0) + " " + y0 + "C" + m + " " + y0 + " " + m + " " + y1 + " " + (x1 - r1) + " " + y1 + "Q" + x1 + " " + y1 + " " + x1 + " " + (y1 + r1) + "V" + (y1 + h - r1) +
    "Q" + x1 + " " + (y1 + h) + " " + (x1 - r1) + " " + (y1 + h) + "C" + m + " " + (y1 + h) + " " + m + " " + (y0 + h) + " " + (x0 + r0) + " " + (y0 + h) + "Q" + x0 + " " + (y0 + h) + " " + x0 + " " + (y0 + h - r0) + "V" + (y0 + r0) + "Q" + x0 + " " + y0 + " " + (x0 + r0) + " " + y0 + "Z";
};

const flowClass = (x, ht, d) => "cf" + (x.kept ? " kept" : x.over || d.inn <= 0 ? " over" : ht < 6 ? " thin" : "");

/* Wide screens: the rows are the labels. Came in on the left, Went out on the right, each as tall as its money
   needs, and every flow lands on its own row. The rows are laid out first; the flows are then drawn to meet them. */
const DOCK = matchMedia("(min-width:1024px)"), ROW = 58;
function layoutRows(root, d) {
  const lists = [[d.sources, "l"], [d.uses, "r"]];
  const need = (list, k) => list.reduce((s, x) => s + Math.max(ROW, x.v * k + 10), 0);
  const most = Math.max(d.sources.length, d.uses.length) * ROW;
  const room = Math.max(most, Math.min(innerHeight - 340, 620));
  let lo = 0, hi = room / d.total;
  for (let i = 0; i < 30; i++) { const k = (lo + hi) / 2; if (Math.max(need(d.sources, k), need(d.uses, k)) <= room) lo = k; else hi = k; }
  lists.forEach(([list, p]) => list.forEach((x, i) => { root.querySelector('.s-cflist [data-k="' + p + i + '"]').style.minHeight = Math.round(Math.max(ROW, x.v * lo + 10)) + "px"; }));
  return lo;
}
const clearRows = (root) => root.querySelectorAll(".s-cflist [data-k]").forEach((n) => { n.style.minHeight = ""; });
const pageTop = (n) => { let y = 0; for (; n; n = n.offsetParent) y += n.offsetTop; return y; };
function docked(svg, w, h, d, k) {
  const box = svg.parentNode, root = box.closest(".s-cfdlg"), base = pageTop(box);
  const seat = (list, p) => list.map((x, i) => {
    const n = root.querySelector('.s-cflist [data-k="' + p + i + '"]');
    return { ...x, key: p + i, ht: Math.max(3, x.v * k), cy: pageTop(n) - base + n.offsetHeight / 2 };
  });
  const L = seat(d.sources, "l"), R = seat(d.uses, "r"), mid = L.length > 1, seam = 4, hubX = mid ? Math.round(w / 2) : 0;
  const height = (list) => list.reduce((s, x) => s + x.ht + seam, -seam), hubH = Math.max(height(R), mid ? height(L) : 0);
  const hubY = mid ? (h - hubH) / 2 : L[0].cy - hubH / 2;
  const flows = (list, right) => {
    let at = hubY;
    list.forEach((x) => {
      const g = el("g", { class: flowClass(x, x.ht, d), style: "--c:" + x.color, "data-k": x.key }, svg), y = x.cy - x.ht / 2;
      if (x.cat || x.person) g.style.cursor = "pointer";
      const path = el("path", { class: "fl", d: right ? ribbon(mid ? hubX + seam : 0, at, w, y, x.ht, 0, 0) : ribbon(0, y, hubX - seam, at, x.ht, 0, 0) }, g);
      if (x.ht < 8) { path.setAttribute("stroke", "transparent"); path.setAttribute("stroke-width", 8); }
      at += x.ht + seam;
    });
  };
  flows(R, true);
  if (mid) flows(L, false);
}

function diagram(svg, w, h, d, big, r) {
  const roomy = big && w >= 560, namesOnly = big || w < 280; // the bigger view has its list; a very narrow card has no room
  const [L, R] = columns(d, big).map((c) => c.map((x) => ({ ...x, name: (!roomy && x.short) || x.name })));
  const mid = L.length > 1, top = 4, bottom = 4, avail = h - top - bottom, thin = 3;

  // Labels stay off the flows, in columns as wide as their longest line, within reason
  const widest = (list, fn, cls) => Math.max(...list.map((x) => textWidth(svg, fn(x), cls)));
  const nameW = (list) => widest(list, (x) => x.name, "lb"), amtW = (list) => widest(list, (x) => f0(x.v), "lbam");
  const leftW = Math.min(namesOnly ? nameW(L) : Math.max(nameW(L), amtW(L)), w * 0.28);
  const amtR = namesOnly ? 0 : amtW(R), rightW = Math.min(nameW(R) + (namesOnly ? 0 : 14 + amtR), w * (big ? 0.34 : 0.48));
  const space = big ? 20 : 12; // between the labels and the flows
  const leftX = Math.ceil(leftW) + space, rightX = Math.floor(w - rightW) - space;
  const hubX = mid ? Math.round((leftX + rightX) / 2) : leftX;

  // Rows stand far enough apart for their labels; the scale gives way if they don't fit
  const pitchL = big ? 28 : namesOnly ? 22 : 40, pitchR = big ? 28 : namesOnly ? 22 : 24, gap = roomy ? 22 : big ? 16 : 10;
  const n = Math.max(L.length, R.length);
  let k = Math.max(0.01, (avail - (n - 1) * gap) / d.total);
  const th = (v) => Math.max(thin, v * k);
  const place = (list, pitch) => {
    let y = top;
    list.forEach((x, i) => {
      if (i) { const p = list[i - 1]; y = Math.max(y + gap, p.y + th(p.v) / 2 + pitch - th(x.v) / 2); }
      x.y = y;
      y += th(x.v);
    });
    return y - top;
  };
  for (let i = 0; i < 24 && (place(L, pitchL) > avail + 0.5 || place(R, pitchR) > avail + 0.5); i++) k *= 0.92;
  const centre = (list, pitch) => { const ext = place(list, pitch); list.forEach((x) => { x.y += (avail - ext) / 2; }); };
  centre(L, pitchL); centre(R, pitchR);

  // Where each flow meets the middle, a hair apart so they read as separate
  const seam = big ? 4 : 2;
  const meet = (list) => { let at = 0; list.forEach((x) => { x.at = at; at += th(x.v) + seam; }); return at - seam; };
  const hubH = Math.max(meet(R), mid ? meet(L) : 0), hubY = top + (avail - hubH) / 2;
  R.concat(mid ? L : []).forEach((x) => { x.at += hubY; });

  const summary = () => "<b>" + esc(L[0].name) + "</b>" + row(esc(t("Came in")), esc(f(d.inn)), "var(--w-good)") + row(esc(t("Went out")), esc(f(d.out))) +
    row(esc(d.left >= 0 ? t("Kept") : d.inn > 0 ? t("Overspent") : d.overName), esc(f(Math.abs(d.left))));

  const text = (g, x, cy, item, right) => {
    if (right || namesOnly) {
      const a = el("text", { x, y: cy + 5, class: "lb" }, g);
      fit(a, item.name, (right ? rightW - (namesOnly ? 0 : amtR + 14) : leftW));
      if (right && !namesOnly) el("text", { x: w, y: cy + 5, class: "lbam", "text-anchor": "end" }, g).textContent = f0(item.v);
    } else {
      const a = el("text", { x, y: cy - 3, class: "lb" }, g);
      fit(a, item.name, leftW);
      el("text", { x, y: cy + 15, class: "lbam" }, g).textContent = f0(item.v);
    }
  };

  const item = (x, right, key) => {
    const ht = th(x.v), cy = x.y + ht / 2, clickable = x.cat || x.person || x.gone;
    const g = el("g", { class: flowClass(x, ht, d), style: "--c:" + x.color }, svg);
    const x0 = right ? (mid ? hubX + seam : leftX) : leftX, x1 = right ? rightX : hubX - seam, round = Math.min(4, ht / 2);
    const path = el("path", { class: "fl", d: right ? ribbon(x0, x.at, x1, x.y, ht, mid ? 0 : round, round) : ribbon(x0, x.y, x1, x.at, ht, round, 0) }, g);
    if (ht < 8) { path.setAttribute("stroke", "transparent"); path.setAttribute("stroke-width", 8); }
    text(g, right ? rightX + space : 0, cy, x, right);
    const slot = Math.max(ht, 22);
    el("rect", { x: right ? rightX : 0, y: cy - slot / 2, width: right ? w - rightX : leftX, height: slot, fill: "transparent" }, g);

    if (big) { g.setAttribute("data-k", key); if (clickable) g.style.cursor = "pointer"; return; }

    // The card: hover names it; click opens its transactions
    if (clickable) { g.setAttribute("tabindex", 0); g.setAttribute("role", "button"); g.setAttribute("aria-label", x.name + " " + f(x.v)); }
    const lit = (on) => g.classList.toggle("on", on);
    g.addEventListener("mouseenter", () => lit(true));
    g.addEventListener("mouseleave", () => lit(false));
    g.addEventListener("focus", () => lit(true));
    g.addEventListener("blur", () => lit(false));
    g.addEventListener("touchstart", () => { lit(true); setTimeout(() => lit(false), 2500); }, { passive: true });
    hover(g, () => row(esc(x.name), esc(f(x.v)) + " · " + esc(share(x.v, d.total)), x.color) + (x.parts ? x.parts.slice(0, 8).map((o) => row(esc(o.name), esc(f(o.v)), o.color)).join("") : "") +
      ((x.cat || x.person) && matchMedia("(hover:hover)").matches ? '<small class="w-tiphint">' + esc(t("Click to see its transactions")) + "</small>" : ""));
    if (!clickable) return;
    g.style.cursor = "pointer";
    let touched = false;
    g.addEventListener("pointerdown", (ev) => { touched = ev.pointerType === "touch"; });
    const go = () => {
      hideTip();
      if (x.gone) { openCashflow(r); return; }
      goTx(x.person ? { person: x.person, income: true } : { cat: x.cat });
    };
    g.addEventListener("click", () => { if (!touched || x.gone) go(); });
    g.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); go(); } });
  };

  R.forEach((x, i) => item(x, true, "r" + i));
  if (mid) L.forEach((x, i) => item(x, false, "l" + i));
  else {
    // One source: its name beside where everything starts
    const g = el("g", { class: "cf" }, svg), cy = hubY + hubH / 2;
    const names = wrap(svg, L[0].name, leftW), step = 18, first = cy + 6 - (names.length - (namesOnly ? 1 : 0)) * step / 2;
    names.forEach((s, i) => fit(el("text", { x: 0, y: first + i * step, class: "lb" }, g), s, leftW));
    if (!namesOnly) el("text", { x: 0, y: first + names.length * step, class: "lbam" }, g).textContent = f0(L[0].v);
    el("rect", { x: 0, y: cy - 36, width: leftX, height: 72, fill: "transparent" }, g);
    if (big) g.setAttribute("data-k", "l0"); else hover(g, summary);
  }
}

/* ---------- the card ---------- */
export function drawCashflow(id, d, r) {
  chart(id, () => Math.max(200, 20 + rows(d, false) * 28), (svg, w, h) => diagram(svg, w, h, d, false, r), () => describe(d));
}

/* ---------- the bigger view: the answer, the diagram, and every line of it ---------- */
const lead = (x) => (x.person ? av(x.person, "lg") : x.cat ? tile(x.cat)
  : '<span class="w-ico" style="background:color-mix(in srgb,' + (x.kept ? "var(--w-good)" : x.color) + " 15%,transparent);color:" + (x.kept ? "var(--w-good)" : x.color) + '">' + icon(x.kept ? "savings" : "alert") + "</span>");
function listRow(x, key, total) {
  const tag = x.cat || x.person ? 'button type="button"' : "div";
  return "<" + tag + ' class="s-row" data-k="' + key + '">' + lead(x) + '<span class="s-nm"><span>' + esc(x.short || x.name) + "</span><small>" + esc(share(x.v, total)) + '</small></span><span class="s-am amt">' + esc(f0(x.v)) + "</span>" + (x.cat || x.person ? icon("right", "s-chev") : '<span class="s-chev"></span>') + "</" + tag.split(" ")[0] + ">";
}
export function openCashflow(r) {
  const d = cashflow(r);
  const item = (k) => (k[0] === "l" ? d.sources : d.uses)[+k.slice(1)];
  const section = (title, list, p) => '<div class="' + (p === "l" ? "s-cfin" : "s-cfout") + '"><h6 class="s-cfh">' + esc(title) + '</h6><div class="w-gl s-cfg">' + list.map((x, i) => listRow(x, p + i, d.total)).join("") + "</div></div>";
  let scale = 0;
  enlarge({
    title: cashflowTitle(r),
    cls: "s-cfx",
    head: '<div class="s-bighead">' + stats(d, r) + "</div>",
    foot: '<div class="s-cflist">' + section(t("Came in"), d.sources, "l") + section(t("Went out"), d.uses, "r") + "</div>",
    h: () => {
      const root = document.querySelector(".s-cfx");
      if (DOCK.matches) {
        scale = layoutRows(root, d);
        return Math.max(root.querySelector(".s-cfin").offsetHeight, root.querySelector(".s-cfout").offsetHeight);
      }
      clearRows(root);
      // Tall enough to show the whole list when the window has the room
      return Math.max(360, Math.min(innerHeight - 290, Math.max(500, 96 + (d.sources.length + d.uses.length) * 62)), 20 + rows(d, true) * 32);
    },
    min: () => 20 + rows(d, true) * 30,
    max: 320,
    draw: (svg, w, h) => (DOCK.matches ? docked(svg, w, h, d, scale) : diagram(svg, w, h, d, true, r)),
    label: () => describe(d),
    open(root) {
      // Pointing lights a row and its flow together. A finger lights it first; a second tap opens it.
      let chosen = null, touch = false;
      const keyOf = (ev) => { const n = ev.target.closest && ev.target.closest("[data-k]"); return n ? n.dataset.k : null; };
      const paint = (k) => root.querySelectorAll("[data-k]").forEach((n) => n.classList.toggle("on", n.dataset.k === k));
      root.addEventListener("pointerdown", (ev) => { touch = ev.pointerType === "touch"; });
      root.addEventListener("mouseover", (ev) => { if (!touch) paint(keyOf(ev)); });
      root.addEventListener("focusin", (ev) => { if (!touch && ev.target.matches(":focus-visible")) paint(keyOf(ev)); });
      root.addEventListener("click", (ev) => {
        const k = keyOf(ev);
        if (!k) return;
        if (touch && chosen !== k) {
          chosen = k;
          paint(k);
          const line = root.querySelector('.s-cflist [data-k="' + k + '"]');
          if (line) line.scrollIntoView({ block: "nearest" });
          return;
        }
        const x = item(k);
        if (!x.cat && !x.person) return;
        closeDialog();
        goTx(x.person ? { person: x.person, income: true } : { cat: x.cat });
      });
    },
  });
}
