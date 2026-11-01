/* Month in review as a printed report: A4 pages laid out here, then the browser's own print, where
   "Save as PDF" makes the file. Text stays text, charts stay vector. It always prints light, whatever
   the theme, and it is the same report from the Export button or from ⌘P / Ctrl+P on the page.
   Pages are filled section by section: a section that doesn't fit starts the next page, so nothing
   is ever cut in two. Each page has the same header and a footer with its number. */
import {
  t, tn, esc, state, f0, fk, pct, TODAY, totals, amt, cat, pname, couple, initial, pindex,
  dows, wkOff, dlab, monthYear, F,
} from "../../core.js";
import { highlights, dayFacts, sharedText, levels } from "../review.js";

/* Light colours, fixed: paper is white whatever the app's theme */
const C = ["#14804A", "#FA5252", "#FD7E14", "#FAB005", "#40C057", "#15AABF", "#228BE6", "#7950F2", "#E64980", "#ADB5BD"];
const HEAT = ["#F0F1F5", "#E6E9FB", "#CDD3F6", "#AAB4EF", "#8592E6", "#5F6EDB"];
const AV = [["#E3E7FF", "#3D47B5"], ["#FFE6D9", "#B0461A"], ["#DDF4E8", "#17663F"], ["#F6E1F5", "#8A2F86"], ["#FFF1C9", "#8A5A00"], ["#DDF1F7", "#126176"]];
const col = (k) => C[cat(k).c] || C[9];
const catName = (k) => esc(cat(k).n);
const mon = (q) => F.months[q[1] - 1];
/* A share of spending: under 1% says so rather than 0% */
const share = (x) => (x > 0 && x < 0.005 ? "<" + pct(0.01) : pct(x));
const MAX_CATS = 12;
const LONG = () => new Intl.DateTimeFormat(document.documentElement.lang || undefined, { day: "numeric", month: "long", year: "numeric" });

/* ---------- small pieces ---------- */
function delta(cur, ref, goodUp, month) {
  const d = cur - ref;
  if (Math.abs(d) < Math.max(5, Math.abs(ref) * 0.03)) return '<span class="pr-d">' + esc(t("About the same as {month}", { month })) + "</span>";
  const amount = f0(Math.abs(d));
  return '<span class="pr-d ' + ((d > 0) === goodUp ? "good" : "bad") + '">' + (d > 0 ? "↑ " : "↓ ") +
    esc(d > 0 ? t("{amount} more than {month}", { amount, month }) : t("{amount} less than {month}", { amount, month })) + "</span>";
}
function short(cur, ref) {
  const d = cur - ref;
  if (Math.abs(d) < Math.max(5, Math.abs(ref) * 0.03)) return '<span class="pr-d">' + esc(t("Same")) + "</span>";
  return '<span class="pr-d ' + (d > 0 ? "bad" : "good") + '">' + (d > 0 ? "↑ " : "↓ ") + esc(d > 0 ? t("{amount} more", { amount: f0(d) }) : t("{amount} less", { amount: f0(-d) })) + "</span>";
}
const sw = (k) => '<i class="pr-sw" style="background:' + col(k) + '"></i>';
function avatar(key) {
  const [bg, fg] = AV[pindex(key) % 6];
  return '<span class="pr-av" style="background:' + bg + ";color:" + fg + '">' + esc(initial(pname(key))) + "</span>";
}
function section(title, sub, body, cls) {
  return '<section class="pr-sec ' + (cls || "") + '"><h2>' + title + (sub ? "<small>" + sub + "</small>" : "") + "</h2>" + body + "</section>";
}

/* Money kept, the last 12 months: the month in colour, the usual month dashed */
function keptChart(m) {
  const W = 330, H = 118, mg = { l: 2, r: 2, t: 16, b: 18 }, hist = m.hist, u = m.u;
  const P = Math.max(...hist.map((x) => Math.max(x.s.net, 0)), u.n ? u.net : 0, 1), N = Math.max(...hist.map((x) => Math.max(-x.s.net, 0)), 0);
  const k = (H - mg.t - mg.b - (N ? 10 : 0)) / (P + N), z = mg.t + P * k, bw = (W - mg.l - mg.r) / hist.length, bar = Math.min(15, bw * 0.56);
  let out = '<line x1="0" x2="' + W + '" y1="' + z + '" y2="' + z + '" stroke="#D5D8DF" stroke-width=".8"/>';
  if (u.n) { const y = z - u.net * k; out += '<line x1="0" x2="' + W + '" y1="' + y + '" y2="' + y + '" stroke="#6A6F7B" stroke-width=".8" stroke-dasharray="2.5 2.5"/>'; }
  hist.forEach((x, i) => {
    const v = x.s.net, on = x.q[0] === m.q[0] && x.q[1] === m.q[1], hh = Math.max(1, Math.abs(v) * k), x0 = mg.l + bw * i + (bw - bar) / 2, r = Math.min(2.5, hh / 2), cx = x0 + bar / 2;
    const d = v >= 0 ? "M" + x0 + " " + z + "V" + (z - hh + r) + "q0 " + -r + " " + r + " " + -r + "h" + (bar - 2 * r) + "q" + r + " 0 " + r + " " + r + "V" + z + "Z"
      : "M" + x0 + " " + z + "V" + (z + hh - r) + "q0 " + r + " " + r + " " + r + "h" + (bar - 2 * r) + "q" + r + " 0 " + r + " " + -r + "V" + z + "Z";
    out += '<path d="' + d + '" fill="' + (v < 0 ? (on ? "#D13B40" : "#F2B8BA") : on ? "#14804A" : "#CBD0D9") + '"/>';
    out += '<text x="' + cx + '" y="' + (v >= 0 ? z - hh - 4 : z + hh + 9) + '" class="' + (on ? "on" : "") + '">' + esc(fk(v)) + "</text>";
    out += '<text x="' + cx + '" y="' + (H - 4) + '" class="m' + (on ? " on" : "") + '">' + esc(F.mon[x.q[1] - 1]) + "</text>";
  });
  return '<svg class="pr-chart" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(t("Money kept, last {n} months", { n: hist.length })) + '">' + out + "</svg>";
}

/* ---------- the sections ---------- */
function titleBlock(m) {
  const who = m.sc === "all" ? (couple() ? state.people.map((p) => esc(p.name)).join(" · ") : "") : esc(pname(m.sc));
  return '<div class="pr-title"><span class="pr-eye">' + esc(t("Month in review")) + "</span><h1>" + esc(monthYear(m.q[0], m.q[1])) + "</h1><p>" +
    esc(LONG().formatRange(new Date(m.a + "T12:00:00"), new Date(m.b + "T12:00:00"))) + (who ? " · " + who : "") + "</p></div>";
}
function heroBlock(m) {
  const { s, u, hist } = m, kept = s.net >= 0;
  return '<div class="pr-hero"><div class="pr-heroL"><span class="pr-k">' + esc(kept ? t("Kept") : t("Overspent")) + '</span><div class="pr-big ' + (kept ? "good" : "bad") + '">' + f0(Math.abs(s.net)) + "</div>" +
    "<p>" + m.head + "</p></div>" +
    '<div class="pr-heroR">' + keptChart(m) + '<div class="pr-cap">' + esc(t("Money kept, last {n} months", { n: hist.length })) + (u.n ? ". " + esc(t("The dashed line is usual.")) : "") + "</div></div></div>";
}
function kpiBlock(m) {
  const { s, prev, u } = m, PM = mon(m.pq);
  const k = (label, cur, p, us, goodUp) => "<div><span>" + esc(label) + "</span><b>" + f0(cur) + "</b>" + (prev ? delta(cur, p, goodUp, PM) : "") +
    (u.n ? "<small>" + esc(t("Usual {amount}", { amount: f0(us) })) + "</small>" : "") + "</div>";
  return '<div class="pr-kpi">' + k(t("Came in"), s.inc, prev && prev.inc, u.inc, true) + k(t("Went out"), s.exp, prev && prev.exp, u.exp, false) +
    k(t("Bills"), s.bills, prev && prev.bills, u.bills, false) + k(t("Everyday spending"), s.day, prev && prev.day, u.day, false) + "</div>" +
    '<p class="pr-foot">' + (u.n ? esc(tn(u.n, "Usual is the average of the month before.", "Usual is the average of the {n} months before.")) + " " : "") +
    esc(t("Bills are recurring payments; everyday spending is everything else.")) + "</p>";
}
function peopleBlock(m) {
  if (!couple()) return "";
  const { a, b } = m;
  const cards = state.people.map((p) => {
    const key = String(p.id), tt = totals(a, b, key);
    let own = 0, paid = 0;
    for (const x of state.tx) {
      if (x.type !== "expense" || x.d < a || x.d > b) continue;
      if (x.p === key) own += x.a;
      if (x.p === null && x.by === key) paid += x.a;
    }
    const kept = tt.net >= 0, spent = tt.inc ? Math.min(tt.exp / tt.inc, 1) : 1;
    const li = (k, v) => "<li><span>" + esc(k) + "</span><b>" + v + "</b></li>";
    return '<div class="pr-person"><div class="pr-ph">' + avatar(key) + "<b>" + esc(p.name) + '</b><span class="pr-pill ' + (kept ? "good" : "bad") + '">' +
      esc(kept ? (tt.inc ? t("Kept {pct}", { pct: pct(tt.rate) }) : t("Nothing spent")) : t("Over by {amount}", { amount: f0(-tt.net) })) + "</span></div>" +
      '<div class="pr-trio"><div><span>' + esc(t("Earned")) + "</span><b>" + f0(tt.inc) + "</b></div><div><span>" + esc(t("Spent")) + "</span><b>" + f0(tt.exp) + "</b></div><div><span>" +
      esc(kept ? t("Kept") : t("Over")) + '</span><b class="' + (kept ? "good" : "bad") + '">' + f0(Math.abs(tt.net)) + "</b></div></div>" +
      '<div class="pr-split"><span style="flex:' + spent + '"></span><span style="flex:' + (1 - spent) + '"></span></div>' +
      '<ul class="pr-facts">' + li(t("On their own"), f0(own)) + li(t("Their share of shared costs"), f0(tt.exp - own)) + li(t("Paid for shared costs"), f0(paid)) + "</ul></div>";
  }).join("");
  const names = state.people.length === 2 ? t("{a} and {b}", { a: esc(state.people[0].name), b: esc(state.people[1].name) }) : esc(t("Everyone"));
  return section(names, esc(t("Each person’s spending includes their share of shared costs")),
    '<div class="pr-people n' + Math.min(state.people.length, 3) + '">' + cards + '</div><p class="pr-note">' + sharedText(m) + "</p>");
}
function catsBlock(m) {
  const { c, cu, keys, s, u } = m;
  if (!keys.length) return section(esc(t("Where it went")), "", '<p class="pr-note">' + esc(t("No spending this month.")) + "</p>");
  const shown = keys.slice(0, MAX_CATS), rest = keys.slice(MAX_CATS), top = c[keys[0]];
  const row = (color, name, share, v, vs) => '<div class="pr-cr"><i class="pr-sw" style="background:' + color + '"></i><b class="n">' + name +
    '</b><span class="bar"><span style="width:' + ((v / top) * 100).toFixed(1) + "%;background:" + color + '"></span></span><b class="v">' + f0(v) + '</b><span class="sh">' + share + '</span><span class="vs">' + vs + "</span></div>";
  let rows = shown.map((k) => row(col(k), catName(k), esc(share(c[k] / (s.exp || 1))), c[k],
    cu[k] ? short(c[k], cu[k]) : u.n ? '<span class="pr-d">' + esc(t("New")) + "</span>" : "")).join("");
  if (rest.length) {
    const v = rest.reduce((x, k) => x + c[k], 0);
    rows += row(C[9], esc(rest.map((k) => cat(k).n).slice(0, 3).join(", ") + (rest.length > 3 ? "…" : "")),
      esc(share(v / (s.exp || 1))), v, "");
  }
  return section(esc(t("Where it went")), esc(u.n ? t("Against the {n} months before", { n: u.n }) : ""),
    '<div class="pr-cat"><div class="pr-cr hd"><span></span><span>' + esc(t("Category")) + "</span><span></span><span>" + esc(F.mon[m.q[1] - 1]) + "</span><span>%</span><span>" + esc(u.n ? t("Against usual") : "") + "</span></div>" + rows + "</div>");
}
function changedBlock(m) {
  if (!m.u.n) return section(esc(t("What changed")), "", '<p class="pr-note"><b>' + esc(t("The first month")) + "</b> " + esc(t("Next month Wally compares against this one.")) + "</p>");
  const item = (x, up) => {
    const big = up ? m.biggestIn(x.k) : null, amount = f0(Math.abs(x.d));
    return '<div class="pr-li">' + sw(x.k) + "<div><b>" + (up ? t("{category}, {amount} more", { category: catName(x.k), amount }) : t("{category}, {amount} less", { category: catName(x.k), amount })) + "</b><p>" +
      (big ? t("Biggest: {name}, {amount} on {date}.", { name: esc(big.n || cat(big.c).n), amount: f0(amt(big, m.sc)), date: esc(dlab(big.d)) })
        : t("{amount} this month, usually about {usual}.", { amount: f0(m.c[x.k] || 0), usual: f0(m.cu[x.k] || 0) })) + "</p></div></div>";
  };
  const col2 = (h, list, up) => list.length ? '<div class="pr-mv"><h3>' + esc(h) + "</h3>" + list.map((x) => item(x, up)).join("") + "</div>" : "";
  const body = col2(t("Up"), m.ups, true) + col2(t("Down"), m.downs, false);
  return section(esc(t("What changed")), esc(t("Against the {n} months before", { n: m.u.n })),
    body ? '<div class="pr-two">' + body + "</div>" : '<p class="pr-note"><b>' + esc(t("A steady month")) + "</b> " + esc(t("Every category was close to usual.")) + "</p>");
}
function daysBlock(m) {
  const lv = levels(m.vals);
  let cells = dows(true).map((d) => '<span class="dow">' + esc(d) + "</span>").join("");
  for (let j = 0; j < wkOff(m.a); j++) cells += "<span></span>";
  m.vals.forEach((v, i) => {
    const L = lv(v);
    cells += '<span class="c' + (L >= 4 ? " hi" : "") + '" style="background:' + HEAT[L] + '">' + (i + 1) + "</span>";
  });
  return section(esc(t("Day by day")), m.sc === "all" ? esc(t("Household, without bills")) : esc(t("{name}, without bills", { name: pname(m.sc) })),
    '<div class="pr-days"><div class="pr-grid">' + cells + '</div><div class="pr-dfacts">' + dayFacts(m) + "</div></div>");
}
function billsBlock(m) {
  const PM = m.hasPrev ? mon(m.pq) : null, nx = m.next;
  const list = m.changes.length ? m.changes.slice(0, 8).map((x) => '<div class="pr-li">' + sw(x.c) + "<div><b>" + x.h + "</b><p>" + x.p + "</p></div></div>").join("") +
      (m.changes.length > 8 ? '<p class="pr-note">' + esc(tn(m.changes.length - 8, "And {n} more", "And {n} more")) + "</p>" : "")
    : '<p class="pr-note"><b>' + esc(t("No changes")) + "</b> " + esc(PM ? t("Same bills, same prices as {month}.", { month: PM }) : t("Same bills, same prices as before.")) + "</p>";
  const nextLine = nx.n ? tn(nx.n, "{amount} in {n} bill.", "{amount} in {n} bills.", { amount: f0(nx.sum) }) + (nx.first ? " " + t("First: {name} on {date}.", { name: esc(nx.first.n), date: esc(dlab(nx.first.d)) }) : "") : t("No bills.");
  return section(esc(t("Bills")), esc(tn(m.billsN, "{n} payment, {amount}", "{n} payments, {amount}", { amount: f0(m.s.bills) })),
    list + '<p class="pr-next"><b>' + esc(mon(m.nq)) + ":</b> " + nextLine + "</p>");
}
function knowBlock(m) {
  return section(esc(t("Worth knowing")), "", '<div class="pr-know">' + highlights(m).map((x) => "<div><span>" + x[0] + "</span><b>" + x[1] + "</b><p>" + x[2] + "</p></div>").join("") + "</div>");
}

/* ---------- pages ---------- */
function sheet(m, first) {
  const s = document.createElement("div");
  s.className = "pr-sheet";
  s.innerHTML = '<header class="pr-head"><span class="pr-brand"><img src="/icons/icon-192.png" alt="">Wally</span><span>' +
    esc(monthYear(m.q[0], m.q[1])) + " · " + esc(m.sc === "all" ? t("Household") : pname(m.sc)) + "</span></header>" +
    '<div class="pr-body' + (first ? " first" : "") + '"></div><footer class="pr-pfoot"><span>' + esc(t("Created {date}", { date: LONG().format(new Date(TODAY + "T12:00:00")) })) + '</span><span class="pr-pn"></span></footer>';
  return s;
}
function build(m) {
  document.getElementById("w-print")?.remove();
  const root = document.createElement("div");
  root.id = "w-print";
  root.className = "pr";
  root.dir = document.documentElement.dir || "ltr";
  root.lang = document.documentElement.lang;
  document.body.appendChild(root);
  const blocks = [titleBlock(m), heroBlock(m), kpiBlock(m), catsBlock(m), knowBlock(m), peopleBlock(m), changedBlock(m), billsBlock(m), daysBlock(m)].filter(Boolean);
  let page = sheet(m, true), body = page.querySelector(".pr-body");
  root.appendChild(page);
  for (const html of blocks) {
    const box = document.createElement("div");
    box.className = "pr-blk";
    box.innerHTML = html;
    body.appendChild(box);
    // Doesn't fit: the section starts the next page
    if (body.scrollHeight > body.clientHeight + 1 && body.children.length > 1) {
      box.remove();
      page = sheet(m, false);
      root.appendChild(page);
      body = page.querySelector(".pr-body");
      body.appendChild(box);
    }
  }
  const pages = root.querySelectorAll(".pr-pn");
  pages.forEach((p, i) => { p.textContent = t("Page {n} of {total}", { n: i + 1, total: pages.length }); });
  return root;
}

/* The browser names the file after the page title */
function fileTitle(m) { return "Wally – " + monthYear(m.q[0], m.q[1]) + (m.sc === "all" ? "" : " – " + pname(m.sc)); }

let restore = null;
function cleanUp() {
  document.getElementById("w-print")?.remove();
  document.body.classList.remove("pr-on");
  if (restore !== null) { document.title = restore; restore = null; }
  removeEventListener("afterprint", cleanUp);
}
function arm(m) {
  if (restore === null) restore = document.title;
  document.title = fileTitle(m);
  document.body.classList.add("pr-on");
  addEventListener("afterprint", cleanUp);
}

/* The Export button: lay out, wait for the logo, then print */
export async function exportPdf(m) {
  const root = build(m);
  await Promise.all([...root.querySelectorAll("img")].map((i) => i.decode().catch(() => {})));
  arm(m);
  print();
}
/* ⌘P / Ctrl+P on the page: the same report, laid out just before printing */
export function beforePrint(m) {
  if (document.body.classList.contains("pr-on")) return;
  build(m);
  arm(m);
}
