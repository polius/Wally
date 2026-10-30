/* The Dashboard's widgets below the lead panel: Categories, Coming up, Kept each month and
   Recent. Each has its markup (WIDGETS[key].html) and a renderer (WIDGETS[key].render(r)). Clicks are
   handled once, in dashboard.js, from data-go-* attributes, so every click-through keeps the range. */
import { state, t, esc, TODAY, START, ds, dim, ym, ymAdd, addD, f, f0, fk, pct, num, F, dlab, dlabW, byCat, totals, monthYear, amt, cc, tile, av, pname } from "../../core.js";
import { hover, row, empty, chart, el, txt } from "../../ui.js";
import { occurrences, ruleAmt, isIncome } from "../../sched.js";
import { prevOf } from "./range.js";
import { monLabel } from "./hero.js";

const $ = (id) => document.getElementById(id);

/* ---------- a transaction row ---------- */
export function txRow(x, opts) {
  opts = opts || {};
  const inc = x.type === "income", v = amt(x), part = x.p === null && state.scope !== "all" && Math.abs(v - x.a) > 0.005;
  return '<button type="button" class="w-row" data-go-id="' + esc(x.id) + '">' + tile(x.c) +
    '<div class="d-min"><h6>' + esc(x.n || x.c) + "</h6><p>" + (opts.date ? esc(dlabW(x.d)) + " · " : "") +
    '<span class="d-who">' + av(x.p, "sm") + esc(pname(x.p)) + "</span>" + (opts.compact ? "" : " · " + esc(x.c)) +
    (x.rec ? ' <svg class="i d-rec" role="img" aria-label="' + esc(t("Recurring")) + '"><use href="#i-repeat"/></svg>' : "") +
    (opts.compact ? "" : x.tags.map((g) => ' <span class="w-ht">' + esc(g) + "</span>").join("")) + "</p></div>" +
    '<span class="amt' + (inc ? " pos" : "") + '">' + (inc ? "+" : "") + f(v) + (part ? '<small class="of">' + esc(t("of {amount}", { amount: f(x.a) })) + "</small>" : "") + "</span></button>";
}

/* ---------- Categories: what each took, and how that compares ---------- */
function renderCats(r) {
  const p = prevOf(r), cur = byCat(r.start, r.end), prev = p.ok ? byCat(p.start, p.end) : null;
  const keys = Object.keys(cur).sort((a, b) => cur[b] - cur[a]), tot = keys.reduce((s, k) => s + cur[k], 0) || 1, max = keys.length ? cur[keys[0]] : 1;
  const box = $("cats");
  if (!keys.length) { box.innerHTML = empty("overview", t("No spending yet"), t("Nothing recorded in this range.")); return; }
  box.innerHTML = keys.map((k) => {
    const v = cur[k], pv = prev ? prev[k] || 0 : null;
    let dl = '<span class="w-dl"></span>';
    if (pv != null) {
      if (!pv) dl = '<span class="w-dl">' + t("New") + "</span>";
      else if (v / tot < 0.05 && Math.abs(v - pv) < tot * 0.01) dl = '<span class="w-dl">—</span>';
      else { const d = (v - pv) / pv; dl = '<span class="w-dl ' + (d > 0.1 ? "up-bad" : d < -0.1 ? "dn-good" : "") + '">' + (Math.abs(d) < 0.005 ? t("Same") : (d > 0 ? "+" : "−") + pct(Math.abs(d))) + "</span>"; }
    }
    return '<button type="button" class="w-cat" data-go-cat="' + esc(k) + '" data-k="' + esc(k) + '">' + tile(k) +
      '<span class="nm">' + esc(k) + '</span><span class="w-bar"><span style="width:' + (v / max) * 100 + "%;background:" + cc(k) + '"></span></span><span class="w-amt">' + f(v) + "</span>" + dl + "</button>";
  }).join("");
  box.querySelectorAll("[data-k]").forEach((b) => {
    const k = b.dataset.k;
    hover(b, () => "<b>" + esc(k) + "</b>" + row(t("Spent"), f(cur[k]), cc(k)) + (prev ? row(esc(p.label), f(prev[k] || 0)) : "") + row(t("Share"), pct(cur[k] / tot)));
  });
}

/* ---------- Coming up: recurring money in the next 10 days ---------- */
function renderUpcoming() {
  const to = addD(TODAY, 10), occ = occurrences(addD(TODAY, 1), to).filter((x) => ruleAmt(x.r) > 0);
  let out = 0, inn = 0;
  occ.forEach((x) => { const v = ruleAmt(x.r); if (isIncome(x.r)) inn += v; else out += v; });
  const box = $("upcoming");
  if (!occ.length) {
    box.innerHTML = state.rules.length ? empty("repeat", t("Nothing scheduled"), t("No recurring money in the next 10 days."))
      : empty("repeat", t("No recurring rules yet"), t("Rent, salaries and subscriptions can repeat on their own."), '<button type="button" class="w-btn ghost" data-new-rule>' + t("Add a repeating expense") + "</button>");
    $("upcoming-f").hidden = true;
    return;
  }
  box.innerHTML = occ.slice(0, 5).map((x) => {
    const v = ruleAmt(x.r), inc = isIncome(x.r), share = x.r.p === null && state.scope !== "all";
    return '<button type="button" class="w-li d-lib" data-go-rule="' + esc(x.r.id) + '"><span class="w-date"><b>' + num(+x.d.slice(8)) + "</b><span>" + esc(F.mon[+x.d.slice(5, 7) - 1]) +
      '</span></span><div class="d-min"><h6>' + esc(x.r.n || x.r.c) + '</h6><p><span class="w-cdot" style="background:' + cc(x.r.c) + '"></span>' + esc(x.r.c) + " · " + esc(pname(x.r.p)) +
      (share ? " · " + t("your share") : "") + '</p></div><span class="w-amt' + (inc ? " pos" : "") + '">' + (inc ? "+" : "") + f(v) + "</span></button>";
  }).join("");
  const vars = { out: "<b>" + f(out) + "</b>", in: '<b class="pos">' + f(inn) + "</b>", date: esc(dlab(to)), n: occ.length - 5 };
  $("upcoming-f").hidden = false;
  $("upcoming-f").innerHTML = occ.length > 5 ? t("{out} going out and {in} coming in by {date}, including {n} not shown.", vars) : t("{out} going out and {in} coming in by {date}.", vars);
}

/* ---------- Kept each month: one bar a month, so a better or worse month shows at once ----------
   The twelve months up to the one on screen, or every month of a longer Custom range (All time
   shows the whole history). Months in the range are green, the dashed line is the average of the
   complete months, and a month that overspent goes below the line in red. */
function renderKept(r) {
  const [ey, em] = ym(r.end), [sy, sm] = ym(r.start), months = [];
  const n = Math.max(12, (ey - sy) * 12 + em - sm + 1), long = n > 12;
  for (let i = n - 1; i >= 0; i--) {
    const [y, m] = ymAdd(ey, em, -i), a = ds(y, m, 1);
    if (a < START.slice(0, 8) + "01") continue;
    const end = ds(y, m, dim(y, m)), tt = totals(a, end < TODAY ? end : TODAY);
    months.push({ y, m, a, net: tt.net, inc: tt.inc, exp: tt.exp, partial: end > TODAY, on: end >= r.start && a <= r.end });
  }
  const done = months.filter((x) => !x.partial), avg = done.length ? done.reduce((s, x) => s + x.net, 0) / done.length : null;
  $("kept-avg").innerHTML = avg === null ? "" : '<span><i class="dash"></i>' + esc(t("Average {amount} a month", { amount: f0(avg) })) + "</span>";
  // Beside Coming up on a wide screen it is as tall; on a phone it stays short
  chart("c-kept", (w) => (w > 480 ? 300 : 170), (svg, w, h) => {
    const mg = { l: 6, r: 6, t: 22, b: 22 };
    const P = Math.max(...months.map((x) => Math.max(x.net, 0)), avg > 0 ? avg : 0, 1), N = Math.max(...months.map((x) => Math.max(-x.net, 0)), avg < 0 ? -avg : 0, 0);
    const k = (h - mg.t - mg.b) / (P + N), z = mg.t + P * k, bw = (w - mg.l - mg.r) / Math.max(months.length, 1), bar = Math.max(2, Math.min(26, bw * (long ? 0.7 : 0.55)));
    el("line", { x1: mg.l, x2: w - mg.r, y1: z, y2: z, class: "base" }, svg);
    months.forEach((x, i) => {
      const v = x.net, hh = Math.max(1, Math.abs(v) * k), x0 = mg.l + bw * i + (bw - bar) / 2, rr = Math.min(4, hh / 2, bar / 2);
      const d = v >= 0 ? "M" + x0 + " " + z + "V" + (z - hh + rr) + "q0 " + -rr + " " + rr + " " + -rr + "h" + (bar - 2 * rr) + "q" + rr + " 0 " + rr + " " + rr + "V" + z + "Z"
        : "M" + x0 + " " + z + "V" + (z + hh - rr) + "q0 " + rr + " " + rr + " " + rr + "h" + (bar - 2 * rr) + "q" + rr + " 0 " + rr + " " + -rr + "V" + z + "Z";
      el("path", { d, fill: v < 0 ? "var(--w-bad)" : x.on ? "var(--w-good)" : "var(--w-p2)", "fill-opacity": x.on ? (x.partial ? 0.6 : long ? 0.85 : 1) : v < 0 ? 0.5 : 0.55 }, svg);
      // Many months: only January (with its year) and the first month are named
      if (!long) txt(svg, x0 + bar / 2, h - 6, F.mon[x.m - 1], x.on ? "lb" : "ax", "middle");
      else if (i === 0 || x.m === 1) txt(svg, x0 + bar / 2, h - 6, monLabel(x.y, x.m, true, true), "ax", i === 0 ? "start" : "middle");
      if (x.on && months.filter((o) => o.on).length === 1) txt(svg, x0 + bar / 2, v >= 0 ? z - hh - 6 : z + hh + 13, fk(v), "lb halo", "middle");
      const hit = el("rect", { x: mg.l + bw * i, y: 0, width: bw, height: h, fill: "transparent", tabindex: "0", role: "button", "aria-label": monthYear(x.y, x.m), "data-go-month": x.a.slice(0, 7) }, svg);
      hit.style.cursor = "pointer";
      hover(hit, "<b>" + esc(monthYear(x.y, x.m)) + (x.partial ? ", " + esc(t("so far")) : "") + "</b>" + row(t("Came in"), f(x.inc), "var(--w-good)") + row(t("Went out"), f(x.exp)) +
        row(v >= 0 ? t("Kept") : t("Overspent"), f(Math.abs(v))));
    });
    if (avg !== null) { const ay = z - avg * k; el("line", { x1: mg.l, x2: w - mg.r, y1: ay, y2: ay, stroke: "var(--w-ink3)", "stroke-dasharray": "3 3", "stroke-width": 1 }, svg); }
  }, () => t("Kept each month") + ": " + months.map((x) => monthYear(x.y, x.m) + " " + f0(x.net)).join(", "));
}

/* ---------- Recent ---------- */
function renderRecent(r, limit) {
  const list = [];
  for (const x of state.tx) { if (x.d > r.end) continue; if (x.d < r.start) break; if (amt(x) > 0) list.push(x); if (list.length >= (limit || 6)) break; }
  $("recent").innerHTML = list.map((x) => txRow(x, { date: true, compact: limit && limit < 6 })).join("") || empty("list", t("No transactions"), t("Nothing in this range yet."));
}
/* ---------- markup ---------- */
const ph = (title, right) => '<div class="w-ph"><div><h4>' + title + "</h4></div>" + (right || "") + "</div>";
export const WIDGETS = {
  cats: {
    html: () => '<section class="w-panel" data-w="cats">' + ph(t("Categories")) + '<div class="w-cats" id="cats"></div></section>',
    render: renderCats,
  },
  upcoming: {
    html: () => '<section class="w-panel" data-w="upcoming">' + ph(t("Coming up"), '<a class="w-link d-hlink" href="/recurring" data-link>' + t("All recurring") + "</a>") +
      '<div class="w-list" id="upcoming"></div><p class="w-foot" id="upcoming-f"></p></section>',
    render: renderUpcoming,
  },
  kept: {
    html: () => '<section class="w-panel" data-w="kept">' + ph(t("Kept each month"), '<div class="w-legend d-keptleg" id="kept-avg"></div>') + '<div class="cv" id="c-kept"></div></section>',
    render: renderKept,
  },
  recent: {
    html: () => '<section class="w-panel" data-w="recent">' + ph(t("Recent"), '<a class="w-link d-hlink" href="/transactions" data-link>' + t("All transactions") + "</a>") + '<div id="recent"></div></section>',
    render: renderRecent,
  },
};
export { renderRecent };
