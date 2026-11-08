/* Summary: how this month is going, where it's heading, then the details.
   Two columns on wide screens that fill independently: the month on the left (Spending,
   Categories, Recent, Coming up), the context on the right (the recap when one is ready, Worth noticing,
   The household, Kept each month, This year). On a phone the same cards stack in reading order (see
   dashboard.css). Spending is every expense, bills (what a recurring rule made) included.
   Clicks are handled in dashboard.js from data-* attributes. */
import {
  state, t, tn, esc, TODAY, START, ds, dim, ym, ymAdd, span, addD, f, f0, fk, pct, num, F, dlab, monthName, monthIn, monthYear,
  totals, amt, tile, pname, couple, icon, relDay, av, T, UNTAGGED,
} from "../../core.js";
import { chart, el, txt, hover, row, showTip, hideTip, empty } from "../../ui.js";
import { occurrences, ruleAmt, isIncome, ruleHist, nextOf } from "../../sched.js";
import { view, prevOf } from "./range.js";
import { heroMonthly, heroCats, monthsOf, monLabel, paceData, paceLabel, eByCat, BY_CAT, BY_TAG, anyTags } from "./hero.js";

const $ = (id) => document.getElementById(id);

/* ---------- small helpers ---------- */
/* A whole amount that counts to its new value when the period changes */
const still = matchMedia("(prefers-reduced-motion: reduce)");
function countTo(node, to) {
  const from = typeof node._v === "number" ? node._v : null;
  node._v = to;
  if (from === null || Math.round(from) === Math.round(to) || still.matches) { node.textContent = f0(to); return; }
  const t0 = performance.now();
  const step = (now) => {
    if (node._v !== to) return;
    const k = Math.min(1, (now - t0) / 400), e = 1 - Math.pow(1 - k, 3);
    node.textContent = f0(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
/* "↓ 45 € less than October at this point": the arrow and amount green when it is good news, red when it isn't */
function changeLine(diff, goodWhenUp, what) {
  if (Math.abs(diff) < 0.5) return '<span class="s-ch">' + esc(t("The same as {what}", { what })) + "</span>";
  const up = diff > 0, good = up === goodWhenUp;
  return '<span class="s-ch"><b class="' + (good ? "dn-good" : "up-bad") + '">' + (up ? "↑ " : "↓ ") + esc(f0(Math.abs(diff))) + "</b> " +
    esc(up ? t("more than {what}", { what }) : t("less than {what}", { what })) + "</span>";
}
/* What the period is compared with, as it reads at the end of a sentence */
function againstWhat(r, p) {
  if (r.month) return r.current ? t("{month} at this point", { month: monthIn(+p.start.slice(5, 7)) }) : monthIn(+p.start.slice(5, 7));
  return p.label;
}
/* A card: a title, something on its right, and its body */
const sec = (id, title, right) => '<section class="s-sec" data-w="' + id + '"><div class="s-sh"><h4>' + title + "</h4>" + (right || "") + '</div><div class="s-body" id="s-' + id + '"></div></section>';
const seeAll = (href) => '<a class="w-link s-all" href="' + href + '" data-link>' + t("See all") + "</a>";
/* attrs null: a row with nowhere to go */
const rowHtml = (attrs, lead, name, sub, amount, cls, under) => (attrs === null ? '<div class="s-row">' : '<button type="button" class="s-row" ' + attrs + ">") + lead + '<span class="s-nm"><span>' + esc(name) + "</span>" +
  (sub ? "<small>" + esc(sub) + "</small>" : "") + '</span><span class="s-am amt' + (cls ? " " + cls : "") + '">' + esc(amount) + (under || "") + "</span>" + (attrs === null ? "</div>" : "</button>");
/* Biggest first, with what has no tags after every tag */
const largest = (o) => (a, b) => (a === UNTAGGED) - (b === UNTAGGED) || o[b] - o[a];
/* The period in a card's corner: "this month", "October", "2026" */
function periodWord(r) { return r.month ? (r.current ? t("this month") : monthName(+r.start.slice(5, 7))) : r.title; }

/* ---------- markup ---------- */
export function summaryHtml() {
  return '<div class="s-grid">' +
    '<div class="s-col s-left">' +
      '<section class="s-sec s-hero" data-w="hero" aria-labelledby="s-eye"><div class="s-body">' +
        '<div class="s-heroh"><div><div class="s-eye" id="s-eye"></div><div class="s-big amt" id="s-big"></div></div>' +
          '<div class="w-seg sm s-view" id="s-view" role="group" aria-label="' + esc(t("Chart")) + '" hidden></div></div>' +
        '<div class="s-lines" id="s-lines"></div>' +
        '<div class="cv s-chart" id="c-hero"></div><div id="s-heroempty" hidden></div>' +
      "</div></section>" +
      sec("cats", t("Categories")) +
      sec("tags", t("Tags")) +
      sec("recent", t("Recent"), seeAll("/transactions")) +
      sec("upcoming", t("Coming up"), seeAll("/recurring")) +
    "</div>" +
    '<div class="s-col s-right">' +
      '<div class="s-recapw" id="s-recapw"></div>' +
      sec("notice", t("Worth noticing")) +
      sec("people", t("The household"), '<span class="s-note" id="s-peoplenote"></span>') +
      sec("kept", t("Kept each month"), '<span class="s-note" id="s-avg"></span>') +
      sec("year", t("This year")) +
    "</div></div>";
}

export function renderSummary(r) {
  renderHero(r);
  renderSplit(r, "cats", BY_CAT);
  renderSplit(r, "tags", BY_TAG);
  renderUpcoming();
  renderRecent(r);
  renderRecap(r);
  renderNotice(r);
  renderPeople(r);
  renderKept(r);
  renderYear(r);
}
const show = (id, on) => { const n = document.querySelector('.s-sec[data-w="' + id + '"]'); if (n) n.hidden = !on; };

/* ---------- Spending: the number, where it usually ends up, against last month ---------- */
function renderHero(r) {
  const tt = totals(r.start, r.end), p = prevOf(r), d = paceData(r), ci = d.cur.length - 1, tagged = anyTags();
  if (view.hv === "tags" && !tagged) view.hv = "pace";
  if (d.proj && d.proj.length < 2) d.proj = null;
  $("s-eye").textContent = t("Spending");
  countTo($("s-big"), d.cur[ci] || 0);
  const none = !tt.n;
  $("s-heroempty").hidden = !none;
  $("c-hero").hidden = none;
  const viewSeg = $("s-view");
  viewSeg.hidden = r.daily || none;
  if (!r.daily) {
    const pill = (v, l) => '<button type="button" data-hv="' + v + '" aria-pressed="' + (view.hv === v) + '">' + l + "</button>";
    const scrolled = viewSeg.scrollLeft; // picking a pill that was scrolled to keeps it in view
    viewSeg.innerHTML = pill("pace", t("Spending")) + pill("ivs", t("Income vs spending")) + pill("cats", t("By category")) + (tagged ? pill("tags", t("By tag")) : "");
    viewSeg.scrollLeft = scrolled;
  }
  if (none) {
    $("s-lines").innerHTML = "";
    $("s-heroempty").innerHTML = empty("overview", esc(r.current ? t("Nothing in {range} yet", { range: r.noun }) : t("Nothing recorded in {range}", { range: r.noun })),
      t("Add the first expense, or import a CSV from your bank."),
      '<div class="d-emptyb"><a class="w-btn ghost" href="/settings/import" data-link>' + t("Import") + '</a><button type="button" class="w-btn primary" data-open-add>' + t("Add expense") + "</button></div>");
    return;
  }
  // Two short lines: where it usually ends up, and how that compares
  let lines = "";
  if (d.proj) lines += '<span class="s-proj">' + t("Usually {amount} by {date}", { amount: "<b>≈ " + esc(f0(d.proj[d.proj.length - 1])) + "</b>", date: esc(dlab(addD(r.start, d.len - 1))) }) + "</span>";
  if (d.cmp) lines += changeLine(d.cur[ci] - d.cmp[ci], false, againstWhat(r, p));
  $("s-lines").innerHTML = lines;

  if (!r.daily && view.hv !== "pace") {
    const months = monthsOf(r);
    if (view.hv === "cats" || view.hv === "tags") {
      const by = view.hv === "tags" ? BY_TAG : BY_CAT, tot = by.sum(r.start, r.end), keys = Object.keys(tot).sort(largest(tot));
      months.forEach((x) => { x.cats = by.sum(x.a, x.b); });
      chart("c-hero", (w) => (w < 560 ? 200 : 260), (svg, w, h) => heroCats(svg, w, h, months, keys, by),
        () => by.chartLabel(r.noun) + ": " + keys.slice(0, 5).map((k) => by.name(k) + " " + f0(tot[k])).join(", "));
    } else {
      chart("c-hero", (w) => (w < 560 ? 200 : 260), (svg, w, h) => heroMonthly(svg, w, h, months),
        () => t("Income and spending by month in {range}", { range: r.noun }) + ": " + months.map((x) => monthYear(x.y, x.m) + " " + f0(x.inc) + " / " + f0(x.exp)).join(", "));
    }
    return;
  }
  const xlab = paceLabel(r, d.len);
  const label = () => t("Spending: {amount} by {date}", { amount: f(d.cur[ci]), date: dlab(r.end) }) + (d.cmp ? ". " + t("{name}: {amount}", { name: d.cmpName, amount: f(d.cmp[d.cmp.length - 1]) }) : "") +
    (d.proj ? ". " + t("Usually: {amount}", { amount: f(d.proj[d.proj.length - 1]) }) : "");
  chart("c-hero", (w) => (w < 480 ? 120 : Math.min(200, Math.round((w * 150) / 560))), (svg, w, h) => pace(svg, w, h, { r, d, xlab }), label);
}

/* This period as a line from the first day to today, the one before it dashed across the whole
   period with its total at the end, and no axes but the first and last days */
function pace(svg, w, h, o) {
  const { r, d } = o, len = d.len, ci = d.cur.length - 1;
  const m = { l: 6, r: 6, t: 22, b: 22 };
  const all = d.cur.concat(d.cmp || []);
  const ymax = Math.max(...all, 1) * 1.04;
  const X = (i) => m.l + (len > 1 ? i / (len - 1) : 0.5) * (w - m.l - m.r), Y = (v) => h - m.b - (v / ymax) * (h - m.t - m.b);
  const defs = el("defs", {}, svg), g = el("linearGradient", { id: "s-hgrad", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  el("stop", { offset: 0, "stop-color": "var(--w-accent)", "stop-opacity": 0.2 }, g);
  el("stop", { offset: 1, "stop-color": "var(--w-accent)", "stop-opacity": 0.02 }, g);
  el("line", { x1: m.l, x2: w - m.r, y1: h - m.b, y2: h - m.b, class: "base" }, svg);
  const path = (arr) => arr.map((v, j) => (j ? "L" : "M") + X(j).toFixed(1) + " " + Y(v).toFixed(1)).join("");
  const line = path(d.cur);
  if (d.cmp) el("path", { d: path(d.cmp), fill: "none", stroke: "var(--w-ink3)", "stroke-width": 1.6, "stroke-dasharray": "4 4", "stroke-linejoin": "round" }, svg);
  if (ci > 0) {
    el("path", { d: line + "L" + X(ci) + " " + Y(0) + "L" + X(0) + " " + Y(0) + "Z", fill: "url(#s-hgrad)" }, svg);
    el("path", { d: line, fill: "none", stroke: "var(--w-accent)", "stroke-width": 2.5, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
  }
  el("circle", { cx: X(ci), cy: Y(d.cur[ci]), r: 4.5, fill: "var(--w-accent)", stroke: "var(--s-card)", "stroke-width": 2 }, svg);
  // The x axis: the first day and the last one
  txt(svg, X(0) - 4, h - 4, o.xlab(0, true), "ax", "start");
  txt(svg, X(len - 1) + 4, h - 4, o.xlab(len - 1, true), "ax", "end");
  // The comparison's total, at the end of its line
  if (d.cmp) {
    const v = d.cmp[d.cmp.length - 1], y = Math.max(12, Y(v) - 10);
    txt(svg, X(len - 1), y, t("{name} {amount}", { name: d.cmpName, amount: f0(v) }), "lb2", "end");
  }
  // Crosshair and tooltip; a mouse click on a day opens its transactions
  const cross = el("line", { y1: m.t, y2: h - m.b, stroke: "var(--w-ink3)", "stroke-width": 1, opacity: 0 }, svg);
  const d1 = el("circle", { r: 4.5, fill: "var(--s-card)", stroke: "var(--w-accent)", "stroke-width": 2.5, opacity: 0 }, svg);
  const d2 = el("circle", { r: 4, fill: "var(--s-card)", stroke: "var(--w-ink3)", "stroke-width": 2, opacity: 0 }, svg);
  const hit = el("rect", { x: m.l, y: 0, width: w - m.l - m.r, height: h, fill: "transparent" }, svg);
  const at = (ev) => { const b = svg.getBoundingClientRect(); return Math.max(0, Math.min(len - 1, Math.round(((ev.clientX - b.left - m.l) / (w - m.l - m.r)) * (len - 1)))); };
  let mouse = true;
  const move = (ev) => {
    const i = at(ev);
    mouse = ev.pointerType === "mouse";
    const cv = i <= ci ? d.cur[i] : null, cmpv = d.cmp ? d.cmp[i] : null;
    cross.setAttribute("x1", X(i)); cross.setAttribute("x2", X(i)); cross.setAttribute("opacity", 1);
    if (cv != null) { d1.setAttribute("cx", X(i)); d1.setAttribute("cy", Y(cv)); d1.setAttribute("opacity", 1); } else d1.setAttribute("opacity", 0);
    if (cmpv != null) { d2.setAttribute("cx", X(i)); d2.setAttribute("cy", Y(cmpv)); d2.setAttribute("opacity", 1); } else d2.setAttribute("opacity", 0);
    let html = "<b>" + esc(o.xlab(i, true, true)) + "</b>";
    if (cv != null) html += row(esc(d.curName), f(cv), "var(--w-accent)");
    if (cmpv != null) html += row(esc(d.cmpName), f(cmpv), "var(--w-ink3)");
    const spent = i <= ci ? d.cur[i] - (i ? d.cur[i - 1] : 0) : 0;
    if (i <= ci) html += row(t("That day"), f(spent)) + (mouse && spent > 0 ? '<small class="w-tiphint">' + t("Click to see its transactions") + "</small>" : "");
    hit.style.cursor = mouse && spent > 0 ? "pointer" : "";
    showTip(html, ev);
  };
  hit.addEventListener("click", (ev) => {
    const i = at(ev);
    if (mouse && i <= ci && d.cur[i] - (i ? d.cur[i - 1] : 0) > 0) { hideTip(); hit.dispatchEvent(new CustomEvent("s-day", { bubbles: true, detail: addD(r.start, i) })); }
  });
  const clear = () => { cross.setAttribute("opacity", 0); d1.setAttribute("opacity", 0); d2.setAttribute("opacity", 0); hideTip(); };
  let later = 0;
  hit.addEventListener("pointermove", (ev) => { clearTimeout(later); move(ev); });
  hit.addEventListener("pointerdown", (ev) => { clearTimeout(later); move(ev); });
  hit.addEventListener("pointerleave", (ev) => { clearTimeout(later); if (ev.pointerType === "mouse") clear(); else later = setTimeout(clear, 3000); });
}

/* ---------- Categories and Tags: all spending, bills included, each against the period before by the same date ---------- */
const listOpen = { cats: false, tags: false };
export function toggleList(id) { listOpen[id] = !listOpen[id]; }
function renderSplit(r, id, by) {
  const p = prevOf(r), cur = by.sum(r.start, r.end), prev = p.ok ? by.sum(p.start, p.end) : null;
  const spent = Object.keys(cur).filter((k) => cur[k] > 0).sort(largest(cur));
  // Early in a month a short list: what was spent, then what had been spent by now last time
  const quiet = prev ? Object.keys(prev).filter((k) => prev[k] > 0 && !(cur[k] > 0)).sort(largest(prev)) : [];
  const keys = spent.length ? spent.concat(spent.length < 3 ? quiet.slice(0, 3 - spent.length) : []).sort((a, b) => (a === UNTAGGED) - (b === UNTAGGED)) : [];
  // Nothing to show, or only what has no tags
  const any = keys.some((k) => k !== UNTAGGED);
  show(id, any);
  if (!any) return;
  const top = 6, shown = listOpen[id] ? keys : keys.slice(0, top);
  const pm = p.ok && r.month ? monthName(+p.start.slice(5, 7)) : p.ok && r.mode === "year" ? p.start.slice(0, 4) : "";
  const note = (k) => !prev ? "" : r.month && r.current ? t("{month} by now: {amount}", { month: pm, amount: f0(prev[k] || 0) })
    : pm ? t("{period}: {amount}", { period: pm, amount: f0(prev[k] || 0) }) : t("Before: {amount}", { amount: f0(prev[k] || 0) });
  // How much it moved against the same period before, as Recurring shows a price change: up in red, down in green.
  // Nothing when there was nothing before, or when it rounds to 0 %.
  const change = (k) => {
    const a = cur[k] || 0, b = prev ? prev[k] || 0 : 0;
    if (!b || !a) return "";
    const x = (a - b) / b;
    if (Math.abs(x) < 0.005) return "";
    const up = x > 0, label = (up ? t("went up") : t("went down")) + " " + pct(Math.abs(x));
    return '<small class="s-chg ' + (up ? "up-bad" : "dn-good") + '" aria-label="' + esc(label) + '">' + (up ? "↑ " : "↓ ") + esc(pct(Math.abs(x))) + "</small>";
  };
  // One bar with every group's share of the spending, in its own color, biggest first
  const tot = spent.reduce((s, k) => s + cur[k], 0);
  const bar = tot > 0 ? '<div class="s-stack" role="img" aria-label="' + esc(spent.slice(0, 5).map((k) => by.name(k) + " " + pct(cur[k] / tot)).join(", ")) + '">' +
    spent.map((k) => '<i style="flex:' + cur[k].toFixed(2) + ";background:" + by.color(k) + '" data-k="' + esc(k) + '"></i>').join("") + "</div>" : "";
  $("s-" + id).innerHTML = bar + shown.map((k) => rowHtml(by.go(k), by.tile(k), by.name(k), note(k), f0(cur[k] || 0), "", change(k))).join("") +
    (keys.length > top ? '<button type="button" class="s-more w-link" data-act="' + id + '-all" aria-expanded="' + listOpen[id] + '">' + (listOpen[id] ? t("Show less") : t("Show all")) + "</button>" : "");
  $("s-" + id).querySelectorAll(".s-stack i").forEach((n) => hover(n, () => row(esc(by.name(n.dataset.k)), f0(cur[n.dataset.k]) + " · " + pct(cur[n.dataset.k] / tot), by.color(n.dataset.k))));
}

/* ---------- Coming up: the next three, however far away ---------- */
function renderUpcoming() {
  const occ = occurrences(addD(TODAY, 1), addD(TODAY, 62)).filter((x) => ruleAmt(x.r) > 0).slice(0, 3);
  const box = $("s-upcoming");
  if (!occ.length) {
    box.innerHTML = state.rules.length ? '<p class="s-none">' + t("Nothing scheduled in the next two months.") + "</p>"
      : '<div class="s-none">' + t("Rent, salaries and subscriptions can repeat on their own.") + ' <button type="button" class="w-link" data-new-rule>' + t("Add a repeating expense") + "</button></div>";
    return;
  }
  box.innerHTML = occ.map((x) => {
    const v = ruleAmt(x.r), inc = isIncome(x.r);
    return rowHtml('data-go-rule="' + esc(x.r.id) + '"', tile(x.r.c), x.r.n || x.r.c, relDay(x.d) + " · " + pname(x.r.p), (inc ? "+" : "") + f(v), inc ? "pos" : "");
  }).join("");
}

/* ---------- Recent: the last four in the period ---------- */
function renderRecent(r) {
  const list = [];
  for (const x of state.tx) { if (x.d > r.end) continue; if (x.d < r.start) break; if (amt(x) > 0) list.push(x); if (list.length >= 4) break; }
  show("recent", list.length > 0);
  $("s-recent").innerHTML = list.map((x) => {
    const inc = x.type === "income", v = amt(x);
    const sub = [relDay(x.d), couple() ? pname(x.p) : x.c].concat(x.tags.slice(0, 2)).join(" · ");
    return rowHtml('data-go-id="' + esc(x.id) + '"', tile(x.c), x.n || x.c, sub, (inc ? "+" : "") + f(v), inc ? "pos" : "");
  }).join("");
}

/* ---------- the month's recap: only once there is one to read ---------- */
function renderRecap(r) {
  const w = $("s-recapw");
  if (!r.month || r.start < START.slice(0, 8) + "01") { w.innerHTML = ""; return; }
  const [y, m] = ym(r.start), end = ds(y, m, dim(y, m));
  const tt = end < TODAY ? totals(r.start, end) : null;
  if (!tt || !tt.n) { w.innerHTML = ""; return; }
  w.innerHTML = '<a class="s-recap" href="/review?m=' + r.start.slice(0, 7) + '" data-link><span class="s-recapi">' + icon("history") + "</span><span><b>" +
    esc(t("Your {month} recap", { month: monthIn(m) })) + "</b><small>" +
    esc(tt.net >= 0 ? t("You kept {amount}. A few things worth knowing.", { amount: f0(tt.net) }) : t("You overspent {amount}. A few things worth knowing.", { amount: f0(-tt.net) })) +
    "</small></span>" + icon("right", "s-chev") + "</a>";
}

/* ---------- Worth noticing: one to three lines, only when something is true ----------
   A bill whose next charge costs more or less than the last one, a price that changed in the last month,
   a yearly bill due within six weeks, a category well above what it usually is by now. */
function notices(r) {
  const out = [], seen = new Set(), soon = addD(TODAY, 42), month = addD(TODAY, -31);
  if (r.current) {
    state.rules.filter((x) => !x.paused && !x.varies && x.type !== "income" && ruleAmt(x) > 0).forEach((x) => {
      const key = x.n.trim().toLowerCase();
      if (seen.has(key)) return;
      const next = nextOf(x), h = ruleHist(x), last = h[h.length - 1];
      if (next && next <= soon && last && Math.abs(last.a - x.a) > 0.005) {
        seen.add(key);
        const up = x.a > last.a, by = Math.abs(x.a - last.a);
        out.push({ ico: "trend", cls: up ? "bad" : "good", w: 3, title: up ? t("{name} goes up {amount}", { name: x.n, amount: fk(by) }) : t("{name} goes down {amount}", { name: x.n, amount: fk(by) }),
          sub: t("From {from} to {to} on {date}.", { from: f(last.a), to: f(x.a), date: dlab(next) }) });
        return;
      }
      for (let i = h.length - 1; i > 0; i--) {
        if (h[i].d < month) break;
        if (Math.abs(h[i].a - h[i - 1].a) > 0.005) {
          seen.add(key);
          const up = h[i].a > h[i - 1].a;
          out.push({ ico: "trend", cls: up ? "bad" : "good", w: 2, title: up ? t("{name} went up {amount}", { name: x.n, amount: fk(Math.abs(h[i].a - h[i - 1].a)) }) : t("{name} went down {amount}", { name: x.n, amount: fk(Math.abs(h[i].a - h[i - 1].a)) }),
            sub: t("From {from} to {to} on {date}.", { from: f(h[i - 1].a), to: f(h[i].a), date: dlab(h[i].d) }) });
          return;
        }
      }
      if (x.freq === "yearly" && next && next <= soon) {
        seen.add(key);
        out.push({ ico: "cal", cls: "", w: 1, title: t("{name} is due on {date}", { name: x.n, date: dlab(next) }), sub: t("A yearly bill: {amount}.", { amount: f(ruleAmt(x)) }) });
      }
    });
  }
  // A category well above usual: after the first week, against the last three months by the same day
  if (r.month && r.current && +TODAY.slice(8) >= 8) {
    const [y, m] = ym(r.start), day = +TODAY.slice(8), cur = eByCat(r.start, r.end, undefined, false), usual = {};
    [1, 2, 3].forEach((k) => { const q = ymAdd(y, m, -k), a = ds(q[0], q[1], 1); if (a < START) return; const b = ds(q[0], q[1], Math.min(day, dim(q[0], q[1]))), o = eByCat(a, b, undefined, false); Object.keys(o).forEach((c) => { usual[c] = (usual[c] || 0) + o[c] / 3; }); });
    Object.keys(cur).forEach((c) => {
      const u = usual[c] || 0;
      if (u > 0 && cur[c] >= u * 1.5 && cur[c] - u >= 40) out.push({ cat: c, w: 2, title: t("{category} is well above usual", { category: c }), sub: t("{amount} so far; usually about {usual} by now.", { amount: f0(cur[c]), usual: f0(u) }) });
    });
  }
  return out.sort((a, b) => b.w - a.w).slice(0, 3);
}
function renderNotice(r) {
  const list = notices(r);
  show("notice", list.length > 0);
  $("s-notice").innerHTML = list.map((x) => '<div class="s-notice">' + (x.cat ? tile(x.cat) : '<span class="w-ico s-nico ' + x.cls + '">' + icon(x.ico) + "</span>") +
    '<span class="s-nm"><span>' + esc(x.title) + "</span><small>" + esc(x.sub) + "</small></span></div>").join("");
}

/* ---------- The household: what each person spent, their own plus their share of shared costs ---------- */
function renderPeople(r) {
  show("people", couple());
  if (!couple()) return;
  $("s-peoplenote").textContent = periodWord(r);
  const rows = state.people.map((pp) => {
    const k = String(pp.id);
    let own = 0, share = 0;
    for (const x of state.tx) {
      if (x.d < r.start || x.d > r.end || x.type !== "expense") continue;
      if (x.p === k) own += x.a; else if (x.p === null) share += amt(x, k);
    }
    const parts = [];
    if (own >= 0.5) parts.push(t("{amount} own", { amount: f0(own) }));
    if (share >= 0.5) parts.push(t("{amount} share of shared costs", { amount: f0(share) }));
    return '<button type="button" class="s-person" data-go-person="' + esc(k) + '">' + av(k, "lg") + '<span class="s-nm"><span>' + esc(pp.name) + "</span><small>" +
      esc(parts.length ? parts.join(" · ") : r.current ? t("Nothing yet this month") : t("Nothing in this period")) + '</small></span><span class="s-am amt">' + esc(f0(own + share)) + "</span></button>";
  });
  // Who paid the shared costs, when one person paid them all
  const shared = state.tx.filter((x) => x.d >= r.start && x.d <= r.end && x.type === "expense" && x.p === null);
  let foot = "";
  if (shared.length) {
    const payers = new Set(shared.map((x) => x.by));
    if (payers.size === 1 && [...payers][0] !== null) {
      const who = pname([...payers][0]);
      foot = shared.length === 1
        ? (state.people.length === 2 ? t("{name} paid {item} for both.", { name: who, item: shared[0].n || shared[0].c }) : t("{name} paid {item} for everyone.", { name: who, item: shared[0].n || shared[0].c }))
        : tn(shared.length, "{name} paid the shared cost.", "{name} paid all {n} shared costs.", { name: who });
    }
  }
  $("s-people").innerHTML = rows.join("") + (foot ? '<p class="s-foot">' + esc(foot) + "</p>" : "");
}

/* ---------- Kept each month: the number and twelve bars ---------- */
function renderKept(r) {
  const tt = totals(r.start, r.end);
  const [ey, em] = ym(r.end), [sy, sm] = ym(r.start), months = [];
  const n = Math.max(12, (ey - sy) * 12 + em - sm + 1), long = n > 12;
  for (let i = n - 1; i >= 0; i--) {
    const [y, mo] = ymAdd(ey, em, -i), a = ds(y, mo, 1);
    if (a < START.slice(0, 8) + "01") continue;
    const end = ds(y, mo, dim(y, mo)), x = totals(a, end < TODAY ? end : TODAY);
    months.push({ y, m: mo, a, net: x.net, inc: x.inc, exp: x.exp, partial: end > TODAY, on: end >= r.start && a <= r.end });
  }
  const done = months.filter((x) => !x.partial), avg = done.length ? done.reduce((s0, x) => s0 + x.net, 0) / done.length : null;
  $("s-avg").innerHTML = avg === null ? "" : '<span class="s-dk">' + esc(t("Average {amount}", { amount: f0(avg) })) + '</span><span class="s-ph">' + esc(t("Avg {amount}", { amount: f0(avg) })) + "</span>";
  const over = tt.net < 0, soFar = r.current;
  $("s-kept").innerHTML = '<div class="s-keptn"><b class="amt' + (over ? " up-bad" : "") + '">' + esc(f0(Math.abs(tt.net))) + "</b>" +
    (over ? '<span class="up-bad">' + esc(soFar ? t("overspent so far") : t("overspent")) + "</span>" : soFar ? "<span>" + esc(t("so far")) + "</span>" : "") + "</div>" +
    '<div class="cv s-keptc" id="c-kept"></div>';
  chart("c-kept", (w) => (w < 360 ? 104 : 112), (svg, w, h) => {
    const mg = { l: 0, r: 0, t: 4, b: 20 };
    const P = Math.max(...months.map((x) => Math.max(x.net, 0)), 1), N = Math.max(...months.map((x) => Math.max(-x.net, 0)), 0);
    const k = (h - mg.t - mg.b) / (P + N), z = mg.t + P * k, bw = (w - mg.l - mg.r) / Math.max(months.length, 1), gap = Math.min(8, bw * 0.28), bar = Math.max(3, bw - gap);
    months.forEach((x, i) => {
      const v = x.net, hh = Math.max(1, Math.abs(v) * k), x0 = mg.l + bw * i + gap / 2, rr = Math.min(4, hh / 2, bar / 2);
      const d = v >= 0 ? "M" + x0 + " " + z + "V" + (z - hh + rr) + "q0 " + -rr + " " + rr + " " + -rr + "h" + (bar - 2 * rr) + "q" + rr + " 0 " + rr + " " + rr + "V" + z + "Z"
        : "M" + x0 + " " + z + "V" + (z + hh - rr) + "q0 " + rr + " " + rr + " " + rr + "h" + (bar - 2 * rr) + "q" + rr + " 0 " + rr + " " + -rr + "V" + z + "Z";
      el("path", { d, fill: v < 0 ? "var(--w-bad)" : x.on ? "var(--s-kept)" : "var(--w-fill2)", "fill-opacity": v < 0 && !x.on ? 0.5 : 1 }, svg);
      if (!long) txt(svg, x0 + bar / 2, h - 4, F.mon[x.m - 1].charAt(0).toLocaleUpperCase(), x.on ? "lb" : "ax", "middle");
      else if (i === 0 || x.m === 1) txt(svg, x0 + bar / 2, h - 4, monLabel(x.y, x.m, true, true), "ax", i === 0 ? "start" : "middle");
      const hit = el("rect", { x: mg.l + bw * i, y: 0, width: bw, height: h, fill: "transparent", tabindex: "0", role: "button", "aria-label": monthYear(x.y, x.m), "data-go-month": x.a.slice(0, 7) }, svg);
      hit.style.cursor = "pointer";
      hover(hit, "<b>" + esc(monthYear(x.y, x.m)) + (x.partial ? ", " + esc(t("so far")) : "") + "</b>" + row(t("Came in"), f(x.inc), "var(--w-good)") + row(t("Went out"), f(x.exp)) +
        row(v >= 0 ? t("Kept") : t("Overspent"), f(Math.abs(v))));
    });
  }, () => t("Kept each month") + ": " + months.map((x) => monthYear(x.y, x.m) + " " + f0(x.net)).join(", "));
}

/* ---------- This year: kept since January, and where it is heading by December 31 ----------
   The line is the running total at each month's end (this month so far). The dotted part assumes the
   rest of the year goes like the last three whole months. */
function renderYear(r) {
  const y = +r.end.slice(0, 4), now = +TODAY.slice(0, 4), cur = y === now, last = cur ? +TODAY.slice(5, 7) : 12, months = [];
  for (let mo = 1; mo <= last; mo++) {
    const a = ds(y, mo, 1), end = ds(y, mo, dim(y, mo));
    if (end < START) { months.push({ m: mo, net: 0, none: true }); continue; }
    months.push({ m: mo, net: totals(a, end < TODAY ? end : TODAY).net });
  }
  const sec0 = document.querySelector('.s-sec[data-w="year"]');
  sec0.querySelector("h4").textContent = cur ? t("This year") : String(y);
  if (months.every((x) => x.none)) { show("year", false); return; }
  show("year", true);
  let acc = 0;
  months.forEach((x) => { acc += x.net; x.acc = acc; });
  const kept = acc;
  // The last three whole months set the pace for the rest of the year
  const whole = [];
  for (let k = 1; k <= 3; k++) { const q = ymAdd(+TODAY.slice(0, 4), +TODAY.slice(5, 7), -k); if (ds(q[0], q[1], 1) >= START) whole.push(totals(ds(q[0], q[1], 1), ds(q[0], q[1], dim(q[0], q[1]))).net); }
  const avg = whole.length ? whole.reduce((a, b) => a + b, 0) / whole.length : null;
  const proj = [];
  if (cur && avg !== null && last < 12) {
    const base = kept - months[last - 1].net + Math.max(months[last - 1].net, avg);
    proj.push(base);
    for (let mo = last + 1; mo <= 12; mo++) proj.push(proj[proj.length - 1] + avg);
  }
  const over = kept < 0, end = proj.length ? proj[proj.length - 1] : null;
  $("s-year").innerHTML = '<div class="s-keptn"><b class="amt' + (over ? " up-bad" : "") + '">' + esc((over ? "−" : "") + f0(Math.abs(kept))) + "</b></div>" +
    '<p class="s-yearsub">' + (over ? esc(t("overspent since January")) : esc(t("kept since January"))) +
    (end !== null ? " · " + t("on track for {amount} by {date}", { amount: '<b class="' + (end < 0 ? "up-bad" : "dn-good") + '">≈ ' + esc(f0(end)) + "</b>", date: esc(dlab(y + "-12-31")) }) : "") + "</p>" +
    '<div class="cv s-yearc" id="c-year"></div>';
  chart("c-year", () => 108, (svg, w, h) => {
    const mg = { l: 0, r: 0, t: 8, b: 20 }, slots = 12, col = (w - mg.l - mg.r) / slots;
    const vals = months.map((x) => x.acc).concat(proj, [0]), hi = Math.max(...vals), lo = Math.min(...vals), sp = hi - lo || 1;
    const X = (i) => mg.l + (i + 0.5) * col, Y = (v) => mg.t + (h - mg.t - mg.b) * (1 - (v - lo) / sp);
    const defs = el("defs", {}, svg), g = el("linearGradient", { id: "s-ygrad", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el("stop", { offset: 0, "stop-color": "var(--w-good)", "stop-opacity": 0.2 }, g);
    el("stop", { offset: 1, "stop-color": "var(--w-good)", "stop-opacity": 0.04 }, g);
    if (lo < 0) el("line", { x1: mg.l, x2: w - mg.r, y1: Y(0), y2: Y(0), class: "grid" }, svg);
    const ci = months.length - 1;
    let line = "";
    months.forEach((x, i) => { line += (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(x.acc).toFixed(1); });
    el("path", { d: line + "L" + X(ci) + " " + Y(Math.max(lo, 0)) + "L" + X(0) + " " + Y(Math.max(lo, 0)) + "Z", fill: "url(#s-ygrad)" }, svg);
    el("path", { d: line, fill: "none", stroke: "var(--w-good)", "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
    if (proj.length) {
      let pd = "M" + X(ci).toFixed(1) + " " + Y(months[ci].acc).toFixed(1);
      proj.forEach((v, j) => { pd += "L" + X(ci + j).toFixed(1) + " " + Y(v).toFixed(1); });
      el("path", { d: pd, fill: "none", stroke: "var(--w-good)", "stroke-width": 2, "stroke-dasharray": "2 4", "stroke-linecap": "round" }, svg);
    }
    // Jan, Apr, Jul, Oct, this month in bold, Dec: never two labels side by side
    // Jan, Apr, Jul, Oct, Dec and this month in bold, each centred under its month
    const marks = new Set([0, 3, 6, 9, 11]);
    if (cur) marks.add(ci);
    for (let i = 0; i < slots; i++) if (marks.has(i)) txt(svg, X(i), h - 4, F.mon[i], cur && i === ci ? "lb s-axb" : "ax", "middle");
    months.forEach((x, i) => {
      const hit = el("rect", { x: X(i) - col / 2, y: 0, width: col, height: h, fill: "transparent" }, svg);
      hover(hit, () => "<b>" + esc(monthYear(y, x.m)) + (cur && i === ci ? ", " + esc(t("so far")) : "") + "</b>" + row(t("Kept"), f(x.net), "var(--w-good)") + row(t("Since January"), f(x.acc)));
    });
  }, () => t("This year") + ": " + f0(kept) + (end !== null ? ". " + t("Projected: {amount}", { amount: f0(end) }) : ""));
}

/* ---------- the period menu under the title: five shortcuts ---------- */
export function periodMenu() {
  const now = ym(TODAY), lm = ymAdd(now[0], now[1], -1);
  const isMonth = (q) => view.mode === "month" && view.ym[0] === q[0] && view.ym[1] === q[1];
  const item = (v, l, on, dis) => '<button type="button" role="menuitemradio" data-pm="' + v + '" aria-checked="' + on + '"' + (dis ? " disabled" : "") + "><span>" + esc(l) + "</span></button>";
  return item("this", t("This month"), isMonth(now)) +
    item("last", t("Last month"), isMonth(lm), ds(lm[0], lm[1], dim(lm[0], lm[1])) < START) +
    item("year", t("This year"), view.mode === "year" && view.y === now[0]) +
    item("all", t("All time"), view.mode === "all") +
    '<div class="w-menusep" role="separator"></div>' +
    item("custom", t("Custom range…"), view.mode === "custom");
}
