/* Transactions page, end to end, in a real browser.
   Run against a dev server:
     demo data:      WALLY_DATA=<dir> DEMO=true uvicorn utils.dev_server:app --port 8802
     empty + 20k:    WALLY_DATA=<fresh dir> uvicorn utils.dev_server:app --port 8802   (then SUITE=perf)
   BASE=http://localhost:8802 [SUITE=demo|perf] node transactions.mjs
   The add sheet is replaced by a stub that records what it was opened with, so this page is tested on its own. */
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE || "http://localhost:8802";
const SUITE = process.env.SUITE || "demo";
let fails = 0;
const errors = [];
function ok(cond, msg, extra) {
  if (cond) console.log("  ok   " + msg);
  else { fails++; console.log("  FAIL " + msg + (extra !== undefined ? "  → " + JSON.stringify(extra) : "")); }
}
const section = (s) => console.log("\n" + s);
const wait = (p, ms) => p.waitForTimeout(ms || 150);

const ADD_STUB = "export function openAdd(o){(window.__adds=window.__adds||[]).push(o===undefined?null:JSON.parse(JSON.stringify(o)));} export function flushQueue(){}";

let browser;
async function newPage(o) {
  o = o || {};
  const ctx = await browser.newContext({ viewport: { width: o.w || 1440, height: o.h || 900 }, colorScheme: o.theme || "light", serviceWorkers: "block", acceptDownloads: true });
  await ctx.addInitScript(() => { localStorage.setItem("wally.person", "1"); localStorage.removeItem("wally.scope"); });
  await ctx.route("**/js/add.js", (r) => r.fulfill({ contentType: "application/javascript", body: ADD_STUB }));
  const p = await ctx.newPage();
  p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  p.on("pageerror", (e) => errors.push("PAGEERROR " + e.message));
  return p;
}
async function go(p, path) { await p.goto(BASE + path, { waitUntil: "networkidle" }); await p.waitForSelector("#tx-main:not([hidden]), #tx-none:not([hidden])"); await wait(p, 120); }
const api = async (method, path, body) => {
  const r = await fetch(BASE + "/api" + path, { method, headers: { "Content-Type": "application/json", "X-Wally-Person": "1" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  return text ? JSON.parse(text) : null;
};
/* Read the browser's own data */
const core = (p, fn, arg) => p.evaluate(async ([src, arg]) => { const c = await import("/js/core.js"); return new Function("c", "arg", "return (" + src + ")(c, arg)")(c, arg); }, [fn.toString(), arg]);
const title = (p) => p.$eval("#tx-title", (e) => e.textContent.trim());
const countN = async (p) => +(await p.$eval("#tx-count", (e) => e.textContent)).replace(/[^\d]/g, "");
const rows = (p) => p.$$eval("#tx-list .w-row", (es) => es.map((e) => ({ id: e.dataset.id, name: e.querySelector("h6").textContent, sub: e.querySelector("p").textContent, amt: e.querySelector(".amt").textContent, pos: e.querySelector(".amt").classList.contains("pos"), shared: !!e.querySelector(".tx-who .w-av.shared") })));
const selId = (p) => p.$eval('#tx-list [aria-current="true"]', (e) => e.dataset.id).catch(() => null);
const pressed = (p, sel) => p.$$eval(sel + ' [aria-pressed="true"]', (es) => es.map((e) => e.dataset.v));
const url = (p) => new URL(p.url());
const toastText = (p) => p.$eval("#toast", (e) => (e.classList.contains("on") ? e.querySelector("#toast-t").textContent : ""));
async function typeSearch(p, q) { await p.fill("#tx-q", q); await wait(p, 200); }
async function undo(p) { await p.click("#toast-undo"); await wait(p, 600); }
async function download(p, click) {
  const [dl] = await Promise.all([p.waitForEvent("download"), click()]);
  return { name: dl.suggestedFilename(), text: fs.readFileSync(await dl.path(), "utf8") };
}

/* ============================== demo data ============================== */
async function demo() {
  let p = await newPage();
  await go(p, "/transactions");
  const TODAY = await core(p, (c) => c.TODAY);
  const [ty, tm] = [+TODAY.slice(0, 4), +TODAY.slice(5, 7)];
  const months = await core(p, (c) => c.F.months);
  await wait(p, 200);

  section("Month view and arrows");
  ok((await title(p)) === months[tm - 1] + " " + ty, "opens on this month", await title(p));
  const inMonth = await core(p, (c) => c.state.tx.filter((x) => x.d.slice(0, 7) === c.TODAY.slice(0, 7)).length);
  ok((await countN(p)) === inMonth, "count is this month's transactions", [await countN(p), inMonth]);
  ok(await p.$eval('[data-act="next"]', (b) => b.disabled), "next month is off on the current month");
  ok((await pressed(p, "#tx-range")).join() === "month", "Month is pressed");
  await p.click('#tx-step [data-act="prev"]'); await wait(p);
  const pm = tm === 1 ? 12 : tm - 1, py = tm === 1 ? ty - 1 : ty;
  ok((await title(p)) === months[pm - 1] + " " + py, "previous month", await title(p));
  ok(url(p).searchParams.get("ym") === py + "-" + String(pm).padStart(2, "0"), "address has ym", p.url());
  const rs = await rows(p);
  const prevMonthAll = await core(p, (c, k) => c.state.tx.filter((x) => x.d.slice(0, 7) === k).length, py + "-" + String(pm).padStart(2, "0"));
  ok(rs.length === prevMonthAll && rs.length > 0, "every transaction of the month is listed", [rs.length, prevMonthAll]);
  await p.click('#tx-step [data-act="next"]'); await wait(p);
  ok((await title(p)) === months[tm - 1] + " " + ty, "next month back to this one");
  const first = await core(p, (c) => c.START);
  await go(p, "/transactions?ym=" + first.slice(0, 7));
  ok(await p.$eval('#tx-step [data-act="prev"]', (b) => b.disabled), "previous is off on the first month");

  section("Ranges and keys 1 to 5");
  await go(p, "/transactions");
  for (const [k, label, key] of [["3m", "Last 3 months", "2"], ["year", String(ty), "3"], ["12m", "Last 12 months", "4"], ["all", "All time", "5"], ["month", months[tm - 1], "1"]]) {
    await p.click('#tx-range [data-v="' + k + '"]'); await wait(p);
    ok((await title(p)).startsWith(label), k + " title", await title(p));
    ok((await pressed(p, "#tx-range")).join() === k, k + " pressed");
    if (k !== "month") ok(url(p).searchParams.get("mode") === k, k + " in the address", p.url());
    await p.click("#tx-list"); await p.keyboard.press(key); await wait(p);
    ok((await pressed(p, "#tx-range")).join() === k, "key " + key + " picks " + k);
  }
  await p.click('#tx-range [data-v="all"]'); await wait(p);
  const all = await core(p, (c) => c.state.tx.length);
  ok((await countN(p)) === all, "All shows every transaction", [await countN(p), all]);
  ok(await p.$eval("#tx-list", (e) => e.classList.contains("tx-win")), "over 500 rows: the windowed list");
  ok((await p.$$("#tx-list .w-monh")).length >= 1, "All is grouped by month");
  await p.click('#tx-range [data-v="12m"]'); await wait(p);
  const bars = await p.$$("#tx-strip rect.tx-bar");
  ok(bars.length === 12, "12 months: one bar a month", bars.length);
  await bars[5].click(); await wait(p);
  ok((await pressed(p, "#tx-range")).join() === "month" && url(p).searchParams.get("ym"), "a month bar opens the month", p.url());

  section("Custom range from the address");
  await go(p, "/transactions?mode=custom&from=" + ty + "-02-03&to=" + ty + "-03-10");
  ok((await pressed(p, "#tx-range")).join() === "custom", "Custom is shown and pressed");
  const cust = await core(p, (c, y) => c.state.tx.filter((x) => x.d >= y + "-02-03" && x.d <= y + "-03-10").length, ty);
  ok((await countN(p)) === cust, "custom range count", [await countN(p), cust]);
  ok(url(p).searchParams.get("from") === ty + "-02-03", "custom range stays in the address");

  section("Search in every month, and Only this range");
  await go(p, "/transactions");
  await typeSearch(p, "mercadona");
  ok((await title(p)).startsWith("Search"), "title says Search", await title(p));
  let rr = await rows(p);
  ok(rr.length > 20 && rr.every((r) => /mercadona/i.test(r.name)), "every month, only Mercadona", rr.length);
  ok((await p.$$("#tx-list .w-monh")).length > 3, "grouped by month");
  const total = await core(p, (c) => c.state.tx.filter((x) => /mercadona/i.test(x.n)).length);
  ok((await countN(p)) === total, "count matches every Mercadona", [await countN(p), total]);
  ok(url(p).searchParams.get("q") === "mercadona" && !url(p).searchParams.get("mode"), "address has the search", p.url());
  await p.click('[data-act="only"]'); await wait(p);
  ok((await title(p)) === months[tm - 1] + " " + ty, "Only this month narrows to the month", await title(p));
  ok((await countN(p)) < total, "fewer after narrowing");
  ok(url(p).searchParams.get("mode") === "month", "narrowed search keeps its range in the address", p.url());
  await p.click('[data-act="everym"]'); await wait(p);
  ok((await countN(p)) === total, "Search every month widens again");
  await typeSearch(p, "MERCADONA");
  ok((await countN(p)) === total, "search is case-insensitive");

  section("Search language");
  await typeSearch(p, ">50");
  rr = await rows(p);
  const amounts = await core(p, (c, ids) => ids.map((id) => c.state.tx.find((x) => x.id === id).a), rr.map((r) => r.id));
  ok(rr.length && amounts.every((a) => a >= 50), ">50 keeps amounts over 50", rr.length);
  ok(await p.$eval("#tx-views", (e) => /over 50/.test(e.textContent)), "chip says over 50");
  await typeSearch(p, "<20");
  const am2 = await core(p, (c, ids) => ids.map((id) => c.state.tx.find((x) => x.id === id).a), (await rows(p)).map((r) => r.id));
  ok(am2.length && am2.every((a) => a <= 20), "<20 keeps amounts under 20");
  await typeSearch(p, "@ana");
  rr = await rows(p);
  const owners = await core(p, (c, ids) => ids.map((id) => c.state.tx.find((x) => x.id === id).p), rr.map((r) => r.id));
  ok(rr.length && owners.every((o) => o === "2"), "@ana keeps Ana's own", [rr.length, [...new Set(owners)]]);
  await typeSearch(p, "@Shared");
  const sh = await core(p, (c, ids) => ids.map((id) => c.state.tx.find((x) => x.id === id).p), (await rows(p)).map((r) => r.id));
  ok(sh.length && sh.every((o) => o === null), "@shared keeps shared ones");
  await typeSearch(p, "#coffee");
  rr = await rows(p);
  ok(rr.length && rr.every((r) => r.sub.includes("#coffee")), "#coffee keeps tagged ones", rr.length);
  await typeSearch(p, "groceries");
  rr = await rows(p);
  ok(rr.length && rr.every((r) => r.sub.includes("Groceries")), "a category name filters by category");
  ok(await p.$eval("#tx-views", (e) => e.textContent.includes("Groceries")), "category chip");
  const pastMonth = tm > 3 ? tm - 2 : tm + 1; // a month name: the latest one that is not in the future
  const mname = months[pastMonth - 1];
  await typeSearch(p, mname.slice(0, 3).toLowerCase());
  const my = pastMonth > tm ? ty - 1 : ty;
  ok((await title(p)) === mname + " " + my, "a month name opens that month", await title(p));
  await typeSearch(p, "mercadona >50 @alex");
  rr = await rows(p);
  const combo = await core(p, (c, ids) => ids.map((id) => { const x = c.state.tx.find((y) => y.id === id); return x.a >= 50 && x.p === "1" && /mercadona/i.test(x.n); }), rr.map((r) => r.id));
  ok(combo.length && combo.every(Boolean), "words and filters combine", combo.length);
  ok((await p.$$("#tx-views [data-chip]")).length === 3, "three chips");

  section("Removing chips");
  await typeSearch(p, "mercadona >50");
  await p.click('#tx-views [data-chip="0"]'); await wait(p);
  ok((await p.inputValue("#tx-q")) === "mercadona", "removing the amount chip leaves the word", await p.inputValue("#tx-q"));
  await p.click('#tx-views [data-chip="0"]'); await wait(p);
  ok((await p.inputValue("#tx-q")) === "" && (await title(p)) === months[tm - 1] + " " + ty, "removing the last chip clears the search");

  section("Type, categories, Shared only");
  await go(p, "/transactions?mode=3m");
  await p.click('#tx-type [data-v="income"]'); await wait(p);
  rr = await rows(p);
  ok(rr.length && rr.every((r) => r.pos), "Income only", rr.length);
  ok(url(p).searchParams.get("type") === "income", "type in the address");
  await p.click('#tx-type [data-v="expense"]'); await wait(p);
  ok((await rows(p)).every((r) => !r.pos), "Expenses only");
  await p.click('#tx-type [data-v="all"]'); await wait(p);
  await p.click("#tx-catbtn"); await wait(p);
  ok(!(await p.$eval("#tx-catpop", (e) => e.hidden)), "category picker opens");
  await p.check('#tx-catpop [data-tc="Food"]'); await wait(p);
  await p.check('#tx-catpop [data-tc="Groceries"]'); await wait(p);
  ok((await p.$eval("#tx-catlbl", (e) => e.textContent)) === "2 categories", "label says 2 categories");
  rr = await rows(p);
  ok(rr.length && rr.every((r) => /Food|Groceries/.test(r.sub)), "only the categories picked");
  ok(url(p).searchParams.getAll("cat").sort().join() === "Food,Groceries", "categories in the address", p.url());
  await p.keyboard.press("Escape"); await wait(p);
  ok(await p.$eval("#tx-catpop", (e) => e.hidden), "Escape closes the picker");
  await p.click("#tx-catbtn"); await p.click('[data-act="cats-clear"]'); await wait(p);
  ok((await p.$eval("#tx-catlbl", (e) => e.textContent)) === "All categories", "Clear");
  await p.click("#tx-shared"); await wait(p);
  rr = await rows(p);
  ok(rr.length && rr.every((r) => r.shared), "Shared only", rr.length);
  await p.click("#tx-shared"); await wait(p);

  section("A bar in the strip picks a day");
  await go(p, "/transactions");
  const dayWith = await core(p, (c) => c.state.tx.find((x) => x.d.slice(0, 7) === c.TODAY.slice(0, 7) && x.type === "expense").d);
  const dbars = await p.$$("#tx-strip rect.tx-bar");
  await dbars[+dayWith.slice(8) - 1].click(); await wait(p);
  rr = await rows(p);
  const dayCount = await core(p, (c, d) => c.state.tx.filter((x) => x.d === d).length, dayWith);
  ok(rr.length === dayCount && (await p.$("#tx-daychip .w-chip")), "only that day, with a day chip", [rr.length, dayCount]);
  ok(url(p).searchParams.get("day") === dayWith, "day in the address");
  await p.click('[data-act="dayx"]'); await wait(p);
  ok((await countN(p)) === inMonth, "the chip clears the day");

  section("The person switch");
  await p.click('#side [data-scope="1"]'); await wait(p);
  ok((await p.$eval("#tx-count", (e) => e.textContent)).includes("for Alex"), "count says for Alex");
  rr = await rows(p);
  const scoped = await core(p, (c, ids) => ids.map((id) => c.state.tx.find((x) => x.id === id).p), rr.map((r) => r.id));
  ok(scoped.every((o) => o === "1" || o === null), "Alex sees his own and shared");
  await p.click('#side [data-scope="all"]'); await wait(p);

  section("Keyboard: move, edit, duplicate, delete and undo");
  await go(p, "/transactions");
  const s0 = await selId(p);
  ok(!!s0, "the first row is selected");
  await p.focus("#tx-list");
  await p.keyboard.press("ArrowDown"); await wait(p);
  const s1 = await selId(p);
  ok(s1 && s1 !== s0, "↓ moves the selection");
  const inspName = await p.$eval("#tx-insp .tx-iname", (e) => e.textContent);
  ok(inspName === (await rows(p)).find((r) => r.id === s1).name, "the panel follows", inspName);
  await p.keyboard.press("ArrowUp"); await wait(p);
  ok((await selId(p)) === s0, "↑ moves back");
  ok(await p.evaluate(() => document.activeElement && document.activeElement.dataset.id), "focus stays on the selected row");
  await p.keyboard.press("e"); await wait(p);
  let adds = await p.evaluate(() => window.__adds || []);
  ok(adds.length && adds[adds.length - 1].tx && adds[adds.length - 1].tx.id === s0, "E opens the edit sheet with it");
  await p.keyboard.press("d"); await wait(p);
  adds = await p.evaluate(() => window.__adds || []);
  ok(adds[adds.length - 1].date === TODAY && adds[adds.length - 1].name === (await rows(p))[0].name, "D duplicates to today");
  const before = await countN(p);
  const doomed = await core(p, (c, id) => c.state.tx.find((x) => x.id === id), s0);
  await p.keyboard.press("Backspace"); await wait(p, 500);
  ok((await countN(p)) === before - 1 && !(await rows(p)).some((r) => r.id === s0), "⌫ deletes straight away");
  ok((await toastText(p)).startsWith("Deleted " + (doomed.n || doomed.c)), "a toast offers Undo", await toastText(p));
  ok((await selId(p)) === s1, "the next row takes the selection");
  let gone = await api("GET", "/transactions/id/" + s0).catch(() => null);
  ok(!gone || gone.detail || (Array.isArray(gone) && !gone.length), "gone from the server");
  await undo(p);
  ok((await countN(p)) === before && (await rows(p)).some((r) => r.id === s0), "Undo brings it back");
  const back = await api("GET", "/transactions/id/" + s0);
  ok(Array.isArray(back) && back[0] && back[0].id === s0 && Number(back[0].amount) === doomed.a, "with the same id and amount");
  ok((await selId(p)) === s0, "and selects it");
  await p.focus("#tx-list"); await p.keyboard.press("Delete"); await wait(p, 500);
  ok(!(await rows(p)).some((r) => r.id === s0), "Delete key deletes too");
  await undo(p);

  section("The side panel");
  const noted = await core(p, (c) => { const x = c.state.tx.find((y) => y.note && y.d <= c.TODAY); return x && x.id; });
  if (noted) {
    await go(p, "/transactions?id=" + noted);
    ok((await selId(p)) === noted, "?id= selects the row");
    const note = await core(p, (c, id) => c.state.tx.find((x) => x.id === id).note, noted);
    ok(await p.$eval("#tx-insp", (e, n) => e.textContent.includes(n), note), "the note is shown");
  } else ok(true, "(no note in the demo data)");
  const rec = await core(p, (c) => { const x = c.state.tx.find((y) => y.rid); return x && x.id; });
  await go(p, "/transactions?id=" + rec);
  const href = await p.$eval("#tx-insp .tx-rep", (a) => a.getAttribute("href"));
  const rid = await core(p, (c, id) => c.state.tx.find((x) => x.id === id).rid, rec);
  ok(href === "/recurring?id=" + encodeURIComponent(rid), "Repeats links to the rule", href);
  ok(await p.$eval("#tx-insp .w-audit", (e) => /Added (by|on)/.test(e.textContent)), "Added by");
  ok(!!(await p.$("#tx-hist svg")), "the payee's year as a chart");
  // A split receipt part, and an imported one: made through restore so they carry a group and a source
  const sp = await core(p, (c) => c.TODAY);
  const gid = "e2e-split";
  const made = await api("POST", "/transactions/restore", [
    { id: "11111111-2222-4333-8444-555555555551", name: "E2E Market", category: "Groceries", tags: [], amount: "30.00", type: "expense", date: sp, person_id: 1, group_id: gid, note: "" },
    { id: "11111111-2222-4333-8444-555555555552", name: "E2E Market", category: "Shopping", tags: [], amount: "12.50", type: "expense", date: sp, person_id: 1, group_id: gid, note: "" },
    { id: "11111111-2222-4333-8444-555555555553", name: "E2E Bank", category: "Food", tags: ["e2e"], amount: "9.99", type: "expense", date: sp, person_id: 2, source: { name: "COMPRA TARJ E2E BANK 1234", date: sp }, import_ref: "e2e-ref-1", note: "From the bank" },
  ]);
  ok(Array.isArray(made) && made.length === 3, "made test transactions");
  await go(p, "/transactions?id=11111111-2222-4333-8444-555555555551");
  ok(await p.$eval("#tx-insp .tx-sibs", (e) => e.textContent.includes("Split receipt, 2 parts")), "split receipt siblings");
  await p.click('#tx-insp [data-sib="11111111-2222-4333-8444-555555555552"]'); await wait(p);
  ok((await selId(p)) === "11111111-2222-4333-8444-555555555552", "a sibling opens");
  await go(p, "/transactions?id=11111111-2222-4333-8444-555555555553");
  ok(await p.$eval("#tx-insp", (e) => e.textContent.includes("COMPRA TARJ E2E BANK 1234")), "Imported from the bank text");
  await p.click('#tx-insp [data-act="dup"]'); await wait(p);
  adds = await p.evaluate(() => window.__adds || []);
  ok(adds[adds.length - 1].date === TODAY && adds[adds.length - 1].name === "E2E Bank" && adds[adds.length - 1].amount === 9.99, "Duplicate opens the sheet prefilled for today", adds[adds.length - 1]);
  await p.click('#tx-insp [data-act="edit"]'); await wait(p);
  adds = await p.evaluate(() => window.__adds || []);
  ok(adds[adds.length - 1].tx && adds[adds.length - 1].tx.id === "11111111-2222-4333-8444-555555555553", "Edit opens the sheet with it");
  await p.click('#tx-insp [data-act="del"]'); await wait(p, 600);
  ok(!(await rows(p)).some((r) => r.id.endsWith("553")), "Delete in the panel");
  await undo(p);
  const im = await api("GET", "/transactions/id/11111111-2222-4333-8444-555555555553");
  ok(im[0] && im[0].import_ref === "e2e-ref-1" && im[0].source && im[0].note === "From the bank", "Undo keeps the bank reference, source and note", im[0]);

  section("Calendar");
  await go(p, "/transactions");
  await p.click('#tx-view [data-v="cal"]'); await wait(p);
  ok(!(await p.$eval("#tx-calp", (e) => e.hidden)) && (await p.$$("#tx-cal .w-rday")).length >= 28, "the month grid");
  ok(url(p).searchParams.get("view") === "cal", "view=cal in the address");
  const lastOfMonth = await core(p, (c) => c.ds(+c.TODAY.slice(0, 4), +c.TODAY.slice(5, 7), c.dim(+c.TODAY.slice(0, 4), +c.TODAY.slice(5, 7))));
  if (lastOfMonth > TODAY) ok((await p.$$("#tx-cal .w-rday.fut")).length === +lastOfMonth.slice(8) - +TODAY.slice(8), "days still to come are dashed");
  await p.click('#tx-cal [data-cd="' + dayWith + '"]'); await wait(p);
  ok(await p.$eval('#tx-cal [data-cd="' + dayWith + '"]', (e) => e.classList.contains("sel")), "a day is picked");
  const dayNow = await core(p, (c, d) => c.state.tx.filter((x) => x.d === d).length, dayWith);
  ok((await p.$$("#tx-insp .w-row")).length === dayNow, "its transactions on the right", dayNow);
  ok(url(p).searchParams.get("day") === dayWith, "the day in the address");
  await p.keyboard.press("ArrowRight"); await wait(p);
  ok((await p.$eval("#tx-cal .w-rday.sel", (e) => e.dataset.cd)) !== dayWith, "arrows move the day");
  await p.click('#tx-cal [data-cd="' + dayWith + '"]'); await wait(p);
  await p.click('[data-act="cal-open"]'); await wait(p);
  ok((await p.$eval("#tx-listp", (e) => !e.hidden)) && url(p).searchParams.get("day") === dayWith, "Show in list opens the day in the list");

  section("Select mode and bulk changes");
  await go(p, "/transactions");
  await p.click("#tx-selmode"); await wait(p);
  ok(!(await p.$eval("#tx-bulk", (e) => e.hidden)), "the bulk bar");
  let r3 = (await rows(p)).filter((r) => !r.pos).slice(0, 3);
  for (const r of r3.slice(0, 2)) await p.click('#tx-list [data-id="' + r.id + '"]');
  await p.click('#tx-list [data-id="' + r3[2].id + '"]', { modifiers: ["Shift"] }); await wait(p);
  ok(/^3 selected/.test(await p.$eval(".tx-bkn", (e) => e.textContent)), "3 picked (one by Shift-click)", await p.$eval(".tx-bkn", (e) => e.textContent));
  const cats0 = await core(p, (c, ids) => ids.map((id) => c.state.tx.find((x) => x.id === id).c), r3.map((r) => r.id));
  const target = cats0.includes("Travel") ? "Healthcare" : "Travel";
  await p.selectOption("#bk-cat", target); await wait(p, 700);
  let cats1 = await core(p, (c, ids) => ids.map((id) => c.state.tx.find((x) => x.id === id).c), r3.map((r) => r.id));
  ok(cats1.every((x) => x === target), "category changed", cats1);
  ok((await toastText(p)).startsWith("Moved 3 to " + target), "toast", await toastText(p));
  await undo(p);
  cats1 = await core(p, (c, ids) => ids.map((id) => c.state.tx.find((x) => x.id === id).c), r3.map((r) => r.id));
  ok(cats1.join() === cats0.join(), "Undo puts each category back", cats1);
  const own0 = await core(p, (c, ids) => ids.map((id) => { const x = c.state.tx.find((y) => y.id === id); return [x.p, x.shc && JSON.stringify(x.shc), x.by]; }), r3.map((r) => r.id));
  await p.selectOption("#bk-who", "shared"); await wait(p, 700);
  let own1 = await core(p, (c, ids) => ids.map((id) => c.state.tx.find((x) => x.id === id).p), r3.map((r) => r.id));
  ok(own1.every((x) => x === null), "set to shared", own1);
  await undo(p);
  own1 = await core(p, (c, ids) => ids.map((id) => { const x = c.state.tx.find((y) => y.id === id); return [x.p, x.shc && JSON.stringify(x.shc), x.by]; }), r3.map((r) => r.id));
  ok(JSON.stringify(own1) === JSON.stringify(own0), "Undo puts each person back", [own0, own1]);
  const exp = await download(p, () => p.click("#bk-exp"));
  ok(exp.text.trim().split(/\r?\n/).length === 4, "export selected: header and 3 rows", exp.text.split("\n").length);
  await p.click("#bk-del"); await wait(p);
  ok(await p.$eval("#dlg .w-dialog h5", (e) => e.textContent === "Delete 3 transactions?"), "several ask first");
  await p.click("#dlg [data-dlg-ok]"); await wait(p, 700);
  ok(!(await rows(p)).some((r) => r3.some((x) => x.id === r.id)), "deleted");
  ok((await toastText(p)) === "Deleted 3 transactions", "toast", await toastText(p));
  await undo(p);
  ok(r3.every(async () => true) && (await rows(p)).filter((r) => r3.some((x) => x.id === r.id)).length === 3, "Undo brings the 3 back");
  await p.click("#bk-all"); await wait(p);
  ok(new RegExp("^" + (await countN(p)) + " selected").test(await p.$eval(".tx-bkn", (e) => e.textContent)), "Select all");
  await p.click("#bk-all"); await wait(p);
  ok(/^0 selected/.test(await p.$eval(".tx-bkn", (e) => e.textContent)), "Select none");
  await p.keyboard.press("Escape"); await wait(p);
  ok(await p.$eval("#tx-bulk", (e) => e.hidden), "Escape leaves Select mode");

  section("Export the list");
  await go(p, "/transactions?q=e2e");
  const csv = await download(p, () => p.click("#tx-export"));
  const lines = csv.text.replace(/^﻿/, "").trim().split(/\r?\n/);
  ok(lines[0] === "date,name,category,amount,type,tags,person,paid_by,shares,note", "CSV header", lines[0]);
  ok(lines.length - 1 === (await countN(p)), "one line per transaction shown", [lines.length - 1, await countN(p)]);
  ok(lines.some((l) => l === TODAY + ",E2E Bank,Food,9.99,expense,#e2e,Ana,,,From the bank"), "a row as written", lines);
  ok(/^wally-transactions-\d{4}-\d\d-\d\d\.csv$/.test(csv.name), "file name", csv.name);
  await go(p, "/transactions?q=" + encodeURIComponent("@shared") + "&mode=month");
  const csv2 = await download(p, () => p.click("#tx-export"));
  const l2 = csv2.text.replace(/^﻿/, "").trim().split(/\r?\n/)[1] || "";
  ok(/,Shared,(Alex|Ana),Alex \d+\.\d\d; Ana \d+\.\d\d,/.test(l2), "shared rows: Shared, who paid, the shares", l2);

  section("Saved views");
  await go(p, "/transactions");
  await typeSearch(p, "#coffee >5");
  await p.click('[data-act="save-view"]'); await wait(p);
  await p.fill("#tx-vname", "Coffee e2e");
  await p.click("#dlg [data-dlg-ok]"); await wait(p, 500);
  let cfg = await api("GET", "/config");
  ok(cfg.saved_views.some((v) => v.name === "Coffee e2e" && v.query === "#coffee >5"), "saved on the server", cfg.saved_views);
  ok(!(await p.$('[data-act="save-view"]')), "Save view is gone for a saved search");
  await typeSearch(p, "");
  ok(await p.$eval("#tx-views", (e) => e.textContent.includes("Coffee e2e")), "listed as a chip");
  const vi = await p.$$eval("#tx-views [data-view]", (es) => es.findIndex((e) => e.textContent === "Coffee e2e"));
  await p.click('#tx-views [data-view="' + vi + '"]'); await wait(p);
  ok((await p.inputValue("#tx-q")) === "#coffee >5" && (await title(p)).startsWith("Search"), "a view applies its search in every month");
  await typeSearch(p, "");
  await p.click('#tx-views [data-viewx="' + vi + '"]'); await wait(p, 500);
  cfg = await api("GET", "/config");
  ok(!cfg.saved_views.some((v) => v.name === "Coffee e2e"), "deleted");
  await undo(p);
  cfg = await api("GET", "/config");
  ok(cfg.saved_views.some((v) => v.name === "Coffee e2e"), "Undo keeps it");
  await p.click('#tx-views [data-viewx="' + vi + '"]'); await wait(p, 500);
  await typeSearch(p, "#coffee");
  await p.click('[data-act="save-view"]'); await wait(p);
  await p.fill("#tx-vname", "");
  await p.click("#dlg [data-dlg-ok]"); await wait(p);
  ok(await p.$eval("#dlg-err", (e) => !e.hidden && e.textContent.length > 0), "a view needs a name");
  await p.keyboard.press("Escape");

  section("Deep links");
  const d3 = TODAY.slice(0, 8) + "03";
  await go(p, "/transactions?view=cal&day=" + d3);
  ok((await p.$eval("#tx-cal .w-rday.sel", (e) => e.dataset.cd)) === d3, "view=cal&day=");
  await go(p, "/transactions?cat=Food");
  ok((await p.$eval("#tx-catlbl", (e) => e.textContent)) === "Food" && (await rows(p)).every((r) => r.sub.includes("Food")), "cat=");
  await go(p, "/transactions?mode=year");
  ok((await pressed(p, "#tx-range")).join() === "year", "mode=year");
  await go(p, "/transactions?mode=month&ym=" + first.slice(0, 7));
  ok((await title(p)) === months[+first.slice(5, 7) - 1] + " " + first.slice(0, 4), "mode=month&ym=");
  await go(p, "/transactions?q=mercadona");
  ok((await title(p)).startsWith("Search") && (await p.inputValue("#tx-q")) === "mercadona", "q=");
  const old = await core(p, (c) => c.state.tx[c.state.tx.length - 5].id);
  await go(p, "/transactions?id=" + old);
  ok((await selId(p)) === old, "id= selects an old one, in its month");
  const vis = await p.$eval('#tx-list [data-id="' + old + '"]', (e) => { const r = e.getBoundingClientRect(), b = document.getElementById("tx-list").getBoundingClientRect(); return r.top >= b.top - 1 && r.bottom <= b.bottom + 1; });
  ok(vis, "and scrolls to it");
  await go(p, "/transactions?focus=search");
  ok(await p.evaluate(() => document.activeElement.id === "tx-q"), "focus=search");
  await p.click("#tx-list"); await p.keyboard.press("/"); await wait(p);
  ok(await p.evaluate(() => document.activeElement.id === "tx-q"), "/ on the page focuses the search");
  await p.keyboard.press("Escape");

  section("Empty states");
  await go(p, "/transactions");
  await typeSearch(p, "zzqxv");
  ok(await p.$eval("#tx-list", (e) => e.textContent.includes("No transactions match “zzqxv”")), "no search results");
  await p.click('[data-act="only"]'); await wait(p);
  ok(!!(await p.$('#tx-list [data-act="everym"]')), "it offers every month when narrowed");
  await p.click('#tx-list [data-act="clear"]'); await wait(p);
  ok((await p.inputValue("#tx-q")) === "", "Clear filters");
  await go(p, "/transactions?mode=custom&from=2001-01-01&to=2001-01-31");
  ok(await p.$eval("#tx-list", (e) => e.textContent.includes("Nothing in this range yet")), "nothing in this range");
  await p.click('#tx-list [data-act="add"]'); await wait(p);
  ok((await p.evaluate(() => (window.__adds || []).length)) > 0, "Add expense opens the sheet");

  section("1100 px: the panel slides over the list");
  p = await newPage({ w: 1100, h: 800 });
  await go(p, "/transactions");
  ok(!(await p.$eval("#tx-body", (e) => e.classList.contains("open"))), "closed at first");
  await p.click("#tx-list .w-row >> nth=2"); await wait(p, 400);
  ok(await p.$eval("#tx-body", (e) => e.classList.contains("open")), "a click opens it");
  const box = await p.$eval("#tx-insp", (e) => { const r = e.getBoundingClientRect(); return [r.right, innerWidth, getComputedStyle(e).position]; });
  ok(box[2] === "fixed" && Math.abs(box[0] - box[1]) < 2, "over the list, at the edge", box);
  await p.keyboard.press("Escape"); await wait(p, 350);
  ok(!(await p.$eval("#tx-body", (e) => e.classList.contains("open"))), "Escape closes it");
  ok(await p.evaluate(() => !!document.activeElement.dataset.id), "focus goes back to the row");
  await p.keyboard.press("Enter"); await wait(p, 350);
  ok(await p.$eval("#tx-body", (e) => e.classList.contains("open")), "Enter opens it");
  await p.click('#tx-insp [data-act="close"]'); await wait(p, 350);

  section("900 px, dark");
  p = await newPage({ w: 900, h: 800, theme: "dark" });
  await go(p, "/transactions?mode=12m");
  ok((await p.$$("#tx-list .w-row")).length > 50, "list at 900 px");
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no sideways scroll");

  section("390 px: phone");
  p = await newPage({ w: 390, h: 844 });
  await go(p, "/transactions");
  ok(await p.$eval(".tx-phead", (e) => getComputedStyle(e).display !== "none") && !!(await p.$("#tx-pchips .w-pchips")), "phone header with person chips");
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no sideways scroll");
  const tap = (await rows(p))[1];
  await p.click('#tx-list [data-id="' + tap.id + '"]'); await wait(p, 400);
  ok(await p.$eval("#tx-insp", (e) => { const r = e.getBoundingClientRect(); return getComputedStyle(e).visibility === "visible" && r.left === 0 && r.width === innerWidth; }), "a row opens full screen");
  ok(await p.$eval("#tx-insp .tx-dhero", (e, n) => e.textContent.includes(n), tap.name), "with its name");
  await p.click('#tx-insp [data-act="close"]'); await wait(p, 400);
  ok(await p.$eval("#tx-insp", (e) => getComputedStyle(e).visibility === "hidden"), "‹ Transactions closes it");
  await p.click('#tx-pbar [data-act="filters"]'); await wait(p, 300);
  ok(await p.$eval("#dlg h5", (e) => e.textContent === "Filters"), "Filters sheet");
  await p.click('#tx-ftype [data-v="income"]'); await wait(p);
  const showN = await p.$eval("#dlg [data-dlg-ok]", (e) => e.textContent);
  await p.click("#dlg [data-dlg-ok]"); await wait(p);
  ok((await rows(p)).every((r) => r.pos) && showN === "Show " + (await countN(p)), "income only, Show n matches", showN);
  ok(await p.$eval('#tx-pbar [data-act="filters"]', (e) => e.textContent.includes("1")), "Filters says 1 is on");
  await p.click('#tx-pbar [data-act="filters"]'); await wait(p, 300);
  await p.click('#dlg [data-f="reset"]'); await p.click("#dlg [data-dlg-ok]"); await wait(p);
  await p.click('#tx-pbar [data-act="range"]'); await wait(p, 300);
  await p.click('#dlg [data-pr="3m"]'); await p.click("#dlg [data-dlg-ok]"); await wait(p);
  ok((await title(p)).startsWith("Last 3 months"), "Range sheet: Last 3 months", await title(p));
  await p.click('#tx-pbar [data-act="range"]'); await wait(p, 300);
  await p.fill("#tx-rfrom", ty + "-01-05"); await p.dispatchEvent("#tx-rfrom", "change");
  await p.fill("#tx-rto", ty + "-01-20"); await p.dispatchEvent("#tx-rto", "change");
  await p.click("#dlg [data-dlg-ok]"); await wait(p);
  ok(url(p).searchParams.get("mode") === "custom" && url(p).searchParams.get("from") === ty + "-01-05", "Range sheet: custom dates", p.url());
  await go(p, "/transactions?view=cal");
  ok((await p.$$("#tx-cal .w-rday")).length >= 28, "calendar on the phone");
  await p.screenshot({ path: "/dev/null" }).catch(() => {});

  section("Arabic");
  await api("PUT", "/language/ar");
  p = await newPage();
  await go(p, "/transactions");
  ok(await p.evaluate(() => document.documentElement.dir === "rtl"), "right to left");
  ok((await p.$$("#tx-list .w-row")).length > 0, "rows drawn");
  await p.click("#tx-list .w-row >> nth=1"); await p.click('#tx-view [data-v="cal"]'); await wait(p);
  await api("PUT", "/language/en");

  // Tidy up the test rows
  for (const id of ["551", "552", "553"]) await api("DELETE", "/transactions/11111111-2222-4333-8444-555555555" + id);
}

/* ============================== empty household, then 20,000 rows ============================== */
async function perf() {
  let people = await api("GET", "/people");
  if (!people.length) { await api("POST", "/people", { name: "Alex" }); await api("POST", "/people", { name: "Ana" }); }
  await api("PUT", "/config", { onboarded: true });
  const ledger = await api("GET", "/ledger");
  if (!ledger.rows.length) {
    section("No transactions at all");
    const p = await newPage();
    await go(p, "/transactions");
    ok(!(await p.$eval("#tx-none", (e) => e.hidden)) && (await p.$eval("#tx-none", (e) => e.textContent.includes("No transactions yet"))), "empty page");
    await p.click('#tx-none [data-act="add"]'); await wait(p);
    ok((await p.evaluate(() => (window.__adds || []).length)) === 1, "“Add your first expense” opens the add sheet");
    await p.context().close();
    section("Adding 20,000 transactions");
    const names = ["Mercadona", "Carrefour", "Bonpreu", "Zara", "Repsol", "Cafe Nomada", "Netflix", "Renfe", "Farmacia", "Decathlon"];
    const cats = ["Groceries", "Groceries", "Groceries", "Shopping", "Car", "Food", "Entertainment", "Travel", "Healthcare", "Shopping"];
    const today = new Date();
    let batch = [];
    for (let i = 0; i < 20000; i++) {
      const d = new Date(today.getTime() - Math.floor(i / 9) * 864e5).toISOString().slice(0, 10);
      const k = i % 10;
      batch.push({ name: names[k], category: cats[k], tags: i % 7 === 0 ? ["coffee"] : [], amount: (5 + ((i * 37) % 200) + (i % 100) / 100).toFixed(2), type: i % 50 === 0 ? "income" : "expense", date: d, person_id: i % 3 === 0 ? null : (i % 3), note: "" });
      if (batch.length === 2000) { await api("POST", "/transactions/import", batch); batch = []; }
    }
  }
  section("20,000 rows");
  const p = await newPage();
  const t0 = Date.now();
  await go(p, "/transactions?mode=all");
  const loadMs = Date.now() - t0;
  const n = await countN(p);
  ok(n >= 20000, "all " + n + " listed", n);
  const dom = await p.$$eval("#tx-list .w-row", (es) => es.length);
  ok(dom < 150, "only what is on screen is drawn (" + dom + " rows in the page)");
  console.log("     page ready in " + loadMs + " ms");
  // Scroll the list end to end and measure frames
  const frames = await p.evaluate(async () => {
    const box = document.getElementById("tx-list"), times = [];
    let last = performance.now();
    for (let i = 0; i < 120; i++) {
      box.scrollTop = (box.scrollHeight - box.clientHeight) * (i / 119);
      await new Promise((r) => requestAnimationFrame(r));
      const now = performance.now(); times.push(now - last); last = now;
    }
    times.sort((a, b) => a - b);
    return { median: times[60], p95: times[114], max: times[119], rowsAtEnd: box.querySelectorAll(".w-row").length };
  });
  console.log("     scroll frames: median " + frames.median.toFixed(1) + " ms, p95 " + frames.p95.toFixed(1) + " ms, max " + frames.max.toFixed(1) + " ms");
  ok(frames.p95 < 40, "scrolling stays smooth (p95 frame under 40 ms)", frames);
  ok(frames.rowsAtEnd > 0 && frames.rowsAtEnd < 150, "rows drawn at the end of the list");
  const lastRow = await p.evaluate(async () => { const c = await import("/js/core.js"); return c.state.tx[c.state.tx.length - 1].id; });
  ok(!!(await p.$('#tx-list [data-id="' + lastRow + '"]')), "the oldest row is reachable");
  // Search across 20,000
  await p.fill("#tx-q", "");
  const ts = await p.evaluate(async () => {
    const q = document.getElementById("tx-q"), out = [];
    for (const s of ["m", "me", "mer", "merc", "merca"]) {
      const t0 = performance.now(); q.value = s; q.dispatchEvent(new Event("input"));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      out.push(performance.now() - t0);
    }
    return out;
  });
  console.log("     search keystrokes: " + ts.map((x) => x.toFixed(0)).join(", ") + " ms");
  ok(Math.max(...ts) < 250, "each keystroke redraws in under 250 ms", ts);
  // Keyboard through a long list
  await p.fill("#tx-q", ""); await wait(p, 300);
  await p.focus("#tx-list");
  const tk = Date.now();
  for (let i = 0; i < 40; i++) await p.keyboard.press("ArrowDown");
  const per = (Date.now() - tk) / 40;
  console.log("     ↓ " + per.toFixed(0) + " ms a step");
  const sid = await selId(p);
  const idx = await p.evaluate(async (id) => { const c = await import("/js/core.js"); return c.state.tx.findIndex((x) => x.id === id); }, sid);
  ok(idx === 40, "↓ 40 times selects the 41st", idx);
  ok(per < 120, "arrows keep up");
  // Select all and bulk delete a part, then undo
  await p.goto(BASE + "/transactions?q=bonpreu&mode=month", { waitUntil: "networkidle" }); await wait(p, 300);
  ok((await countN(p)) > 0, "a narrowed list");
}

(async () => {
  browser = await chromium.launch();
  try {
    if (SUITE === "perf") await perf(); else await demo();
  } catch (e) {
    fails++;
    console.log("  FAIL exception: " + (e && e.stack || e));
  }
  await browser.close();
  section("Console errors");
  ok(errors.length === 0, "no console errors", errors);
  console.log("\n" + (fails ? fails + " failed" : "all passed"));
  process.exit(fails ? 1 : 0);
})();
