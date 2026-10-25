/* Browser tests for the add and edit sheet (web/js/add.js).
   Needs a dev server with demo data (people 1 and 2):
     WALLY_DATA=/tmp/wally-add DEMO=true python -m uvicorn utils.dev_server:app --port 8803
   Run:  BASE=http://localhost:8803 node tests/e2e/add.mjs     (playwright must resolve)
   SHOTS=/some/dir also saves screenshots. The last scenarios change the household (3 people, then 1). */
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:8803";
const SHOTS = process.env.SHOTS || "";
let failed = 0, passed = 0;
function check(ok, name, extra) {
  if (ok) { passed++; console.log("  ok   " + name); }
  else { failed++; console.log("  FAIL " + name + (extra !== undefined ? "  → " + JSON.stringify(extra) : "")); }
}
function section(name) { console.log("\n" + name); }

const browser = await chromium.launch();
const errors = [];
let allowNetErrors = false;

async function newPage(opts = {}) {
  const ctx = await browser.newContext({
    viewport: { width: opts.width || 1440, height: opts.height || 900 }, colorScheme: opts.theme || "light",
    serviceWorkers: "block", hasTouch: !!opts.touch, isMobile: !!opts.touch,
  });
  await ctx.addInitScript((who) => { if (!localStorage.getItem("wally.person")) localStorage.setItem("wally.person", who); }, opts.person || "1");
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    if (allowNetErrors && /Failed to load resource|ERR_FAILED/.test(m.text())) return;
    errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForSelector("#app:not([hidden])");
  return page;
}
const api = (page, method, path, body) => page.evaluate(async ([m, p, b]) => {
  const r = await fetch("/api" + p, { method: m, headers: { "Content-Type": "application/json", "X-Wally-Person": localStorage.getItem("wally.person") }, body: b === undefined ? undefined : JSON.stringify(b) });
  const text = await r.text();
  return { status: r.status, data: text ? JSON.parse(text) : null };
}, [method, path, body]);
const core = (page, fn, arg) => page.evaluate(async ([src, a]) => { const c = await import("/js/core.js"); return new Function("c", "a", "return (" + src + ")(c, a)")(c, a); }, [fn.toString(), arg]);
async function open(page, opts) {
  if (opts === undefined) await page.keyboard.press("n");
  else await page.evaluate(async (o) => {
    const m = await import("/js/add.js"), c = await import("/js/core.js");
    if (o.txId) o.tx = c.state.tx.find((x) => x.id === o.txId);
    if (o.ruleId) o.rule = c.state.rules.find((x) => x.id === o.ruleId);
    m.openAdd(o);
  }, opts);
  await page.waitForSelector("#add-form");
}
const isOpen = (page) => page.evaluate(() => !document.getElementById("add-modal").hidden);
const text = (page, sel) => page.$eval(sel, (n) => n.textContent.trim()).catch(() => null);
const visible = (page, sel) => page.$eval(sel, (n) => !!(n.offsetParent || n.getClientRects().length) && !n.closest("[hidden]")).catch(() => false);
const focused = (page) => page.evaluate(() => { const a = document.activeElement; return a ? a.id || a.getAttribute("data-ac") || a.getAttribute("data-aw") || a.tagName : null; });
async function toastText(page, re, timeout = 5000) {
  try {
    await page.waitForFunction((src) => new RegExp(src).test(document.getElementById("toast-t").textContent) && document.getElementById("toast").classList.contains("on"), re.source, { timeout });
  } catch (e) { /* returned below */ }
  return text(page, "#toast-t");
}
async function saveWith(page, keys = "Control+Enter", pathRe = /\/api\/transactions$/) {
  await clearToast(page);
  const resp = page.waitForResponse((r) => pathRe.test(new URL(r.url()).pathname) && r.request().method() !== "GET", { timeout: 8000 });
  await page.keyboard.press(keys);
  const r = await resp;
  return r.json();
}
async function clickSave(page, pathRe = /\/api\/transactions$/) {
  await clearToast(page);
  const resp = page.waitForResponse((r) => pathRe.test(new URL(r.url()).pathname) && r.request().method() !== "GET", { timeout: 8000 });
  await page.click("#add-go");
  return (await resp).json();
}
async function pickCat(p, name) {
  const sel = '#add-cats [data-ac="' + name + '"]';
  if (!(await p.$(sel))) await p.click("#add-cats [data-more]");
  await p.click(sel);
}
const clearToast = (p) => p.evaluate(() => { document.getElementById("toast").classList.remove("on"); document.getElementById("toast-t").textContent = ""; });
const shot = async (page, name) => { if (SHOTS) await page.waitForTimeout(450), await page.screenshot({ path: SHOTS + "/" + name + ".png" }); };
const today = (page) => core(page, (c) => c.TODAY);
const addDays = (d, n) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8)) + n * 864e5).toISOString().slice(0, 10);

/* ======================================================================= */
const page = await newPage();
const TODAY = await today(page);

section("Fast path: amount, Enter, three letters, Enter");
await page.click(".w-addbtn").catch(() => page.keyboard.press("n"));
await page.waitForSelector("#add-form");
check(await focused(page) === "add-amt", "amount has focus on open");
check(await page.$eval("#add-form", (f) => f.getAttribute("role") === "dialog" && f.getAttribute("aria-modal") === "true"), "sheet is a modal dialog");
check(/Enter an amount/.test(await text(page, "#add-go")), "button says Enter an amount", await text(page, "#add-go"));
await page.keyboard.type("12.40+8.15");
check(/20\.55/.test(await text(page, "#add-calc")), "sum shown before saving", await text(page, "#add-calc"));
check(/Pick a category/.test(await text(page, "#add-go")), "button says Pick a category");
await page.keyboard.press("Enter");
check(await focused(page) === "add-name", "Enter moves to the name");
check(await page.inputValue("#add-amt") === "20.55", "sum becomes its total", await page.inputValue("#add-amt"));
await page.keyboard.type("mer");
check(await visible(page, "#add-sugg"), "payee suggestions open");
check(await page.getAttribute("#add-name", "aria-expanded") === "true" && await page.getAttribute("#add-name", "aria-activedescendant") === "add-sg-0", "combobox announces the listbox");
check(await page.$$eval("#add-sugg [role=option]", (l) => l.length) >= 1, "options in a listbox");
await page.keyboard.press("Enter");
check(/^Mercadona/.test(await page.inputValue("#add-name")), "Enter picks the payee", await page.inputValue("#add-name"));
check(await page.getAttribute('[data-ac="Groceries"]', "aria-checked") === "true", "payee fills its category");
const whoPicked = await page.$eval("#add-who [aria-checked=true]", (n) => n.dataset.aw);
check(!!whoPicked, "payee fills its person", whoPicked);
await shot(page, "desk-filled");
let saved = await saveWith(page);
check(/^Mercadona/.test(saved.name) && saved.amount === "20.55" && saved.category === "Groceries", "Ctrl+Enter adds", saved);
check(!(await isOpen(page)), "sheet closes after adding");
check(/Added Mercadona/.test(await toastText(page, /Added Mercadona/)), "toast says what was added");
check(await core(page, (c, id) => c.state.tx.some((x) => x.id === id), saved.id), "ledger in the browser has it");
await page.click("#toast-undo");
await toastText(page, /Undone/);
check((await api(page, "GET", "/transactions/id/" + saved.id)).data.length === 0, "Undo removes what was just added");
check(!(await core(page, (c, id) => c.state.tx.some((x) => x.id === id), saved.id)), "and from the browser's ledger");

section("Keys: radio groups, focus trap, Escape");
await open(page);
await page.keyboard.type("4");
const firstCat = await page.$eval('#add-cats [role="radio"][tabindex="0"]', (n) => n.dataset.ac);
await page.focus('#add-cats [role="radio"][tabindex="0"]');
await page.keyboard.press("ArrowRight");
const nowCat = await page.$eval("#add-cats [aria-checked=true]", (n) => n.dataset.ac);
check(nowCat && nowCat !== firstCat && (await focused(page)) === nowCat, "arrows choose within Category", [firstCat, nowCat]);
check(await page.$$eval('#add-cats [role="radio"][tabindex="0"]', (l) => l.length) === 1, "Category is one Tab stop");
await page.keyboard.press("Tab");
check(!(await page.evaluate(() => document.activeElement.getAttribute("role") === "radio")), "Tab leaves the radio group");
await page.focus('#add-who [role="radio"][tabindex="0"]');
const w0 = await page.$eval("#add-who [aria-checked=true]", (n) => n.dataset.aw);
await page.keyboard.press("ArrowRight");
const w1 = await page.$eval("#add-who [aria-checked=true]", (n) => n.dataset.aw);
check(w0 !== w1, "arrows choose within Who", [w0, w1]);
// focus trap
await page.focus("#add-go");
await page.keyboard.press("Tab");
check(await page.evaluate(() => document.getElementById("add-form").contains(document.activeElement)), "Tab stays inside the sheet");
await page.focus("[data-at=expense]");
await page.keyboard.press("Shift+Tab");
check(await focused(page) === "add-go", "Shift+Tab from the first goes to the last", await focused(page));
await page.keyboard.press("Escape");
check(await visible(page, "#dlg .w-dialog"), "Escape asks before discarding");
check(/Discard this expense/.test(await text(page, "#dlg h5")), "asks: Discard this expense?");
await page.click("#dlg [data-dlg-x]");
check(await isOpen(page), "Keep editing keeps the sheet");
await page.keyboard.press("Escape");
await page.click("#dlg [data-dlg-ok]");
check(!(await isOpen(page)), "Discard closes it");
// opening and closing without changes asks nothing; focus returns
await page.focus(".w-addbtn");
await page.keyboard.press("Enter");
await page.waitForSelector("#add-form");
await page.click("[data-close]");
check(!(await isOpen(page)) && !(await visible(page, "#dlg .w-dialog")), "× closes at once when nothing changed");
check(await page.evaluate(() => document.activeElement.classList.contains("w-addbtn")), "focus returns where it was");
await open(page);
await page.keyboard.type("9");
await page.mouse.click(5, 450);
check(await visible(page, "#dlg .w-dialog"), "click outside asks too");
await page.click("#dlg [data-dlg-ok]");

section("Errors under their field");
await open(page);
await page.keyboard.type("abc");
check(/numbers, \+ and −/.test(await text(page, "#add-aerr")) && await visible(page, "#add-aerr"), "letters: error under the amount");
check(await page.getAttribute("#add-amt", "aria-invalid") === "true", "amount marked invalid");
await page.fill("#add-amt", "5-10");
check(/more than zero/.test(await text(page, "#add-aerr")), "negative total: error");
await page.fill("#add-amt", "");
await page.focus("#add-name");
await page.click("#add-go", { force: true });
check(await focused(page) === "add-amt", "main button takes you to what is missing");
await page.fill("#add-amt", "3");
await page.click("#add-go", { force: true });
check(await page.evaluate(() => document.activeElement.getAttribute("role") === "radio" && document.activeElement.closest("#add-cats") !== null), "then to the category");
// a date in the future needs Repeat
await pickCat(page, "Food");
await page.$eval("#add-pick", (n, d) => { n.value = d; n.dispatchEvent(new Event("change", { bubbles: true })); }, addDays(TODAY, 3));
check(/turn on Repeat/.test(await text(page, "#add-derr")), "future date without Repeat: error under the date");
await page.click('[data-ad="today"]');
check(!(await visible(page, "#add-derr")), "error goes when fixed");
// name is optional: takes the category's name
await page.focus("#add-name");
saved = await saveWith(page, "Enter");
check(saved.name === "Food" && saved.category === "Food", "Enter on the name adds; no name takes the category", saved.name);
await toastText(page, /Added/);

section("Budget hint and duplicate warning");
await open(page);
await page.keyboard.type("7");
await pickCat(page, "Food");
const bud = await text(page, "#add-budget");
check(/^Food: .* (left|over) this month/.test(bud || ""), "budget hint after choosing a category", bud);
check(/after this|goes .* over/.test(bud || "") || /over this month/.test(bud || ""), "hint counts this amount", bud);
await pickCat(page, "Food");
await page.fill("#add-name", "Dup check");
await page.keyboard.press("Escape"); // closes suggestions if any
if (await visible(page, "#dlg .w-dialog")) await page.click("#dlg [data-dlg-x]");
saved = await clickSave(page);
await toastText(page, /Added Dup check/);
await open(page);
await page.keyboard.type("7");
await page.fill("#add-name", "Dup check");
await pickCat(page, "Food");
check(await visible(page, "#add-dup") && /Already added\?/.test(await text(page, "#add-dup")), "same name, amount and day: duplicate warning");
await page.click('[data-ad="yesterday"]');
check(!(await visible(page, "#add-dup")), "no warning on another day");
await page.keyboard.press("Escape");
await page.click("#dlg [data-dlg-ok]");

section("Who, shares and the spare cent");
async function sharedSave(amount, setup) {
  await open(page);
  await page.keyboard.type(amount);
  await pickCat(page, "Food");
  await page.click('[data-aw="shared"]');
  if (setup) await setup();
  return clickSave(page);
}
saved = await sharedSave("10.01", async () => { await page.click('#add-by [data-by="1"]'); });
check(JSON.stringify(saved.shares) === JSON.stringify({ 1: 501, 2: 500 }) && saved.paid_by === 1, "10.01 paid by Alex: 5.01 / 5.00", saved.shares);
await toastText(page, /Added/);
saved = await sharedSave("10.01", async () => { await page.click('#add-by [data-by="2"]'); });
check(saved.shares["1"] === 500 && saved.shares["2"] === 501 && saved.paid_by === 2, "paid by Ana: the spare cent is Ana's", saved.shares);
await toastText(page, /Added/);
saved = await sharedSave("0.01", async () => { await page.click('#add-by [data-by="1"]'); });
check(saved.shares["1"] === 1 && !saved.shares["2"], "0.01: the one cent is the payer's", saved.shares);
await toastText(page, /Added/);
// by income
saved = await sharedSave("100", async () => {
  await page.click('[data-sm="income"]');
  const lab = await text(page, "#sm-income");
  check(/By income \d+\/\d+/.test(lab), "By income shows the split", lab);
  check(/last three months/.test(await text(page, "#sm-hint")), "hint: from the last three months of income");
});
const [ia, ib] = [saved.shares["1"], saved.shares["2"]];
const expectA = await core(page, (c) => {
  const [y, m] = c.ym(c.TODAY), q = c.ymAdd(y, m, -3), from = c.ds(q[0], q[1], 1);
  const a = c.totals(from, c.TODAY, "1").inc, b = c.totals(from, c.TODAY, "2").inc;
  return Math.floor((10000 * a) / (a + b));
});
check(ia + ib === 10000 && Math.abs(ia - expectA) <= 1, "By income: shares from income, adding up", { ia, ib, expectA });
await toastText(page, /Added/);
// custom: drag
saved = await sharedSave("50", async () => {
  await page.click('[data-sm="custom"]');
  check(await visible(page, "#add-split-r") && await visible(page, "#add-split-a"), "Custom: slider and typed part");
  await page.$eval("#add-split-r", (n) => { n.value = "30"; n.dispatchEvent(new Event("input", { bubbles: true })); });
  check(/15\.00/.test(await text(page, "#sp-v1").then(() => page.inputValue("#add-split-a"))), "drag sets the parts");
});
check(saved.shares["1"] === 1500 && saved.shares["2"] === 3500, "Custom 30%: 15.00 / 35.00", saved.shares);
await toastText(page, /Added/);
saved = await sharedSave("50", async () => {
  await page.click('[data-sm="custom"]');
  await page.fill("#add-split-a", "12.34");
  check(/37\.66/.test(await text(page, "#sp-v1")), "typed part: the other gets the rest", await text(page, "#sp-v1"));
});
check(saved.shares["1"] === 1234 && saved.shares["2"] === 3766, "Custom typed: exact cents", saved.shares);
await toastText(page, /Added/);

section("Income");
await open(page, { type: "income" });
check(!(await visible(page, "#add-catrow")), "income hides the Category row");
check(await text(page, "#lbl-who") === "Whose", "Who becomes Whose");
await page.keyboard.type("2450");
await page.click('[data-aw="shared"]');
check(!(await visible(page, "#add-byrow")), "income has no Paid by");
check(/Add income · /.test(await text(page, "#add-go")), "button: Add income · amount");
saved = await clickSave(page);
check(saved.type === "income" && saved.category === "Income" && saved.paid_by === null, "saved as income", { t: saved.type, c: saved.category, b: saved.paid_by });
await toastText(page, /Added/);
await open(page);
await page.click("[data-at=income]");
check(!(await visible(page, "#add-catrow")), "switching to Income hides Category");
await page.click("[data-at=expense]");
check(await visible(page, "#add-catrow"), "and back");
await page.click("[data-close]");

section("Date, tags and note");
await open(page);
await page.keyboard.type("4.20");
await pickCat(page, "Food");
await page.click('[data-ad="yesterday"]');
await page.fill("#add-tag", "Road Trip");
await page.press("#add-tag", "Enter");
check(await page.$$eval("#add-tags [data-tg]", (l) => l.map((n) => n.dataset.tg).join()) === "#road-trip", "tag added as #road-trip");
await page.fill("#add-tag", "coffee");
await page.press("#add-tag", ",");
await page.press("#add-tag", "Backspace");
check(await page.$$eval("#add-tags [data-tg]", (l) => l.length) === 1, "Backspace on an empty tag field removes the last tag");
check(await page.$$eval("#add-taglist option", (l) => l.some((o) => o.value === "#coffee")), "tag suggestions from the household's tags");
await page.fill("#add-tag", "holiday");
await page.fill("#add-note", "Paid in cash");
saved = await clickSave(page);
check(saved.date === addDays(TODAY, -1), "Yesterday", saved.date);
check(saved.tags.join() === "road-trip,holiday", "tags saved, including one still typed", saved.tags);
check(saved.note === "Paid in cash", "note saved");
await toastText(page, /Added/);
await open(page);
await page.keyboard.type("3");
await pickCat(page, "Food");
await page.$eval("#add-pick", (n, d) => { n.value = d; n.dispatchEvent(new Event("change", { bubbles: true })); }, addDays(TODAY, -40));
check(await page.getAttribute("#add-pickb", "aria-pressed") === "true", "Other date shows the day picked");
saved = await clickSave(page);
check(saved.date === addDays(TODAY, -40), "other date saved", saved.date);
await toastText(page, /Added/);

section("Add another");
await open(page);
await page.keyboard.type("2");
await pickCat(page, "Food");
await page.click('[data-aw="2"]');
await page.click('[data-ad="yesterday"]');
saved = await saveWith(page, "Shift+Control+Enter");
check(saved.person_id === 2, "first one saved");
check(await isOpen(page), "sheet stays open");
check(await page.inputValue("#add-amt") === "" && await focused(page) === "add-amt", "amount cleared and focused");
check(await page.getAttribute('[data-aw="2"]', "aria-checked") === "true" && await page.getAttribute('[data-ad="yesterday"]', "aria-pressed") === "true", "keeps the date and the person");
await page.keyboard.type("3");
await pickCat(page, "Food");
saved = await clickSave(page);
check(saved.person_id === 2 && saved.date === addDays(TODAY, -1), "second one has the same person and date");
await toastText(page, /Added/);
// "Add another" button
await open(page);
await page.keyboard.type("1");
await pickCat(page, "Food");
const p1 = page.waitForResponse((r) => r.url().endsWith("/api/transactions") && r.request().method() === "POST");
await page.click("#add-more");
await p1;
check(await isOpen(page), "Add another button keeps the sheet open");
await page.click("[data-close]");

section("Repeat");
async function ruleSave(setup) {
  await open(page);
  await setup();
  await clearToast(page);
  const resp = page.waitForResponse((r) => r.url().endsWith("/api/recurring") && r.request().method() === "POST");
  await page.click("#add-go");
  const rule = await (await resp).json();
  await toastText(page, /Added/);
  const made = (await core(page, (c, id) => c.state.tx.filter((x) => x.rid === id).map((x) => x.d).sort(), rule.id));
  return { rule, made };
}
let r = await ruleSave(async () => {
  await page.keyboard.type("15.99");
  await page.fill("#add-name", "Streamy");
  await pickCat(page, "Entertainment");
  await page.click("#add-rep");
  check(await visible(page, "#add-reppanel"), "Repeat opens its panel");
  check(await page.getAttribute('[data-fq="monthly"]', "aria-pressed") === "true" && await page.getAttribute('[data-end="never"]', "aria-pressed") === "true", "starts at Monthly, never ending");
  check(/^Every month on day \d+, starting/.test(await text(page, "#add-rsum")), "summary before saving", await text(page, "#add-rsum"));
  check(await page.$$eval("#add-next span", (l) => l.length) === 3, "next three dates shown");
  check(await text(page, "#lbl-date") === "Starts", "Date becomes Starts");
});
check(r.rule.frequency === "monthly" && r.rule.interval === 1 && r.rule.endDate === null && r.rule.startDate === TODAY, "monthly rule created", r.rule);
check(r.made.length === 1 && r.made[0] === TODAY, "today's one is added by the server", r.made);
await page.click("#toast-undo");
await toastText(page, /Undone/);
check((await api(page, "GET", "/recurring/" + r.rule.id)).data.length === 0 && !(await core(page, (c, id) => c.state.tx.some((x) => x.rid === id), r.rule.id)), "Undo removes the rule and what it made");

const start2 = addDays(TODAY, -30);
r = await ruleSave(async () => {
  await page.keyboard.type("32");
  await page.fill("#add-name", "Swim class");
  await pickCat(page, "Healthcare");
  await page.click("#add-rep");
  await page.$eval("#add-pick", (n, d) => { n.value = d; n.dispatchEvent(new Event("change", { bubbles: true })); }, start2);
  await page.click('[data-fq="biweekly"]');
  await page.click('[data-end="count"]');
  await page.fill("#add-count", "4");
  const sum = await text(page, "#add-rsum");
  check(/Every 2 weeks on \w+, 4 times, starting .*, last one/.test(sum) && /2 more up to today are added too/.test(sum), "every 2 weeks, 4 times: summary with past dates", sum);
});
check(r.rule.frequency === "weekly" && r.rule.interval === 2 && r.rule.startDate === start2 && r.rule.endDate === addDays(start2, 42), "after 4 times becomes an end date", [r.rule.startDate, r.rule.endDate]);
check(JSON.stringify(r.made) === JSON.stringify([start2, addDays(start2, 14), addDays(start2, 28)]), "past dates added by the server", r.made);
const swimRule = r.rule;

r = await ruleSave(async () => {
  await page.keyboard.type("5");
  await page.fill("#add-name", "Plant food");
  await pickCat(page, "Shopping");
  await page.click("#add-rep");
  await page.click('[data-fq="custom"]');
  check(await focused(page) === "add-every", "Custom focuses Every");
  await page.fill("#add-every", "3");
  await page.selectOption("#add-unit", "daily");
  await page.click('[data-end="until"]');
  await page.fill("#add-until", TODAY);
  check(/after/.test(await text(page, "#add-rerr")), "last date must be after the start", await text(page, "#add-rerr"));
  check(/Fix the highlighted field/.test(await text(page, "#add-go")), "button names the problem");
  await page.fill("#add-until", addDays(TODAY, 30));
  check(/^Every 3 days/.test(await text(page, "#add-rsum")), "every 3 days summary", await text(page, "#add-rsum"));
});
check(r.rule.frequency === "daily" && r.rule.interval === 3 && r.rule.endDate === addDays(TODAY, 30), "every 3 days until a date", r.rule);
r = await ruleSave(async () => {
  await page.keyboard.type("49");
  await page.fill("#add-name", "Domain name");
  await pickCat(page, "Utilities");
  await page.click("#add-rep");
  await page.click('[data-fq="yearly"]');
  check(/^Every year on/.test(await text(page, "#add-rsum")), "yearly summary");
});
check(r.rule.frequency === "yearly" && r.rule.interval === 1, "yearly rule");
r = await ruleSave(async () => {
  await page.keyboard.type("1.50");
  await page.fill("#add-name", "Bread");
  await pickCat(page, "Groceries");
  await page.click("#add-rep");
  await page.click('[data-fq="daily"]');
  await page.click('[data-end="count"]');
  await page.fill("#add-count", "5");
});
check(r.rule.frequency === "daily" && r.rule.endDate === addDays(TODAY, 4), "daily, 5 times", r.rule.endDate);
r = await ruleSave(async () => {
  await page.keyboard.type("9");
  await page.fill("#add-name", "Weekly box");
  await pickCat(page, "Groceries");
  await page.click("#add-rep");
  await page.click('[data-fq="weekly"]');
});
check(r.rule.frequency === "weekly" && r.rule.interval === 1, "weekly rule");
// openAdd({repeat:true})
await open(page, { repeat: true });
check(await page.getAttribute("#add-rep", "aria-checked") === "true" && await visible(page, "#add-reppanel"), "openAdd({repeat:true}) opens with Repeat on");
await page.click("[data-close]");
// "Make it a rule" from Recurring: everything prefilled
await open(page, { repeat: true, name: "Power", amount: 61.5, category: "Utilities", person: null, date: addDays(TODAY, 5), type: "expense", freq: "monthly", every: 2, about: true });
check(await page.inputValue("#add-name") === "Power" && await page.inputValue("#add-amt") === "61.50" && await page.getAttribute('[data-ac="Utilities"]', "aria-checked") === "true"
  && await page.getAttribute('[data-aw="shared"]', "aria-checked") === "true" && await page.getAttribute('[data-fq="custom"]', "aria-pressed") === "true"
  && await page.inputValue("#add-every") === "2" && await page.inputValue("#add-unit") === "monthly", "prefill: name, amount, category, person, every 2 months");
await clearToast(page);
let pre = page.waitForResponse((x) => x.url().endsWith("/api/recurring") && x.request().method() === "POST");
await page.click("#add-go");
pre = await (await pre).json();
check(pre.about === true && pre.interval === 2 && pre.frequency === "monthly" && pre.person_id === null && pre.startDate === addDays(TODAY, 5), "rule saved with about, interval and a future start", pre);
check(!(await core(page, (c, id) => c.state.tx.some((x) => x.rid === id), pre.id)), "a future start adds nothing yet");
await toastText(page, /Added Power/);
await open(page, { name: "Corner shop", amount: "3,20", category: "Groceries", person: "2", date: addDays(TODAY, -2) });
check(await page.inputValue("#add-name") === "Corner shop" && await page.getAttribute('[data-aw="2"]', "aria-checked") === "true" && await page.getAttribute("#add-pickb", "aria-pressed") === "true" && /3\.20/.test(await text(page, "#add-go")), "prefill for a plain transaction");
await page.keyboard.press("Escape");
if (await visible(page, "#dlg .w-dialog")) await page.click("#dlg [data-dlg-ok]");

section("Edit a transaction, delete and Undo");
const victim = (await core(page, (c, d) => c.state.tx.find((x) => x.type === "expense" && !x.rec && !x.gr && x.p !== null && x.d < d), TODAY));
await open(page, { txId: victim.id });
check(/Edit expense/.test(await text(page, "#add-title")) && /Editing · /.test(await text(page, "#add-editing")), "edit title and Editing pill");
check(await page.inputValue("#add-name") === victim.n, "fields filled");
check(!(await visible(page, "#add-more")) && await visible(page, "#add-del"), "edit shows Delete, not Add another");
await page.fill("#add-amt", "77.70");
check(/Save changes · /.test(await text(page, "#add-go")), "button: Save changes · amount");
saved = await clickSave(page, /\/api\/transactions\/[0-9a-f-]+$/);
check(saved.id === victim.id && saved.amount === "77.70", "PUT saved the change");
await toastText(page, /Saved/);
await page.click("#toast-undo");
await toastText(page, /Undone/);
check((await api(page, "GET", "/transactions/id/" + victim.id)).data[0].amount === victim.a.toFixed(2), "Undo restores the previous values");
await open(page, { txId: victim.id });
await page.keyboard.type("1");
await page.keyboard.press("Escape");
check(/Discard your changes/.test(await text(page, "#dlg h5")), "edit asks: Discard your changes?");
await page.click("#dlg [data-dlg-x]");
const delResp = page.waitForResponse((x) => x.request().method() === "DELETE");
await page.click("#add-del");
await delResp;
await toastText(page, /Deleted/);
check(!(await isOpen(page)) && (await api(page, "GET", "/transactions/id/" + victim.id)).data.length === 0, "Delete removes it");
await page.click("#toast-undo");
await toastText(page, /Undone/);
check((await api(page, "GET", "/transactions/id/" + victim.id)).data.length === 1 && await core(page, (c, id) => c.state.tx.some((x) => x.id === id), victim.id), "Undo puts it back with its id");

section("A transaction made by a rule, and the rule");
const madeTx = await core(page, (c, id) => c.state.tx.find((x) => x.rid === id), swimRule.id);
await open(page, { txId: madeTx.id });
check(/Comes from a rule\. Saving changes only this one\./.test(await text(page, "#add-rep-l")), "says it changes only itself");
check(!(await visible(page, "#add-rep")), "no Repeat switch on it");
await page.fill("#add-amt", "35");
saved = await clickSave(page, /\/api\/transactions\/[0-9a-f-]+$/);
check(saved.recurringID === swimRule.id && saved.amount === "35.00", "saved only this one, still linked to its rule");
await toastText(page, /Saved/);
check(Number((await api(page, "GET", "/recurring/" + swimRule.id)).data[0].amount) === 32, "the rule is unchanged");
await open(page, { txId: madeTx.id });
await page.click("[data-rule-edit]");
check(/Edit recurring expense/.test(await text(page, "#add-title")), "links to the rule, in the same sheet");
await page.fill("#add-amt", "40");
await page.click("#add-go");
await page.waitForSelector("#dlg .w-dialog");
check(/From the next charge/.test(await text(page, "#dlg")) && /All, including past ones/.test(await text(page, "#dlg")), "asks: from the next charge, or all");
let putResp = page.waitForResponse((x) => /\/api\/recurring\//.test(x.url()) && x.request().method() === "PUT");
await page.click("#dlg [data-dlg-ok]");
let put = await (await putResp).json();
await toastText(page, /Saved/);
const later = (await api(page, "GET", "/recurring")).data;
const oldRule = later.find((x) => x.id === swimRule.id), newRule = later.find((x) => x.id === put.id);
check(put.id !== swimRule.id && Number(newRule.amount) === 40 && oldRule.endDate < newRule.startDate, "From the next charge: a new rule from the next date", { old: oldRule.endDate, start: newRule.startDate });
check((await api(page, "GET", "/transactions/id/" + madeTx.id)).data[0].amount === "35.00", "past ones stay as they are");
await page.click("#toast-undo");
await toastText(page, /Undone/);
const afterUndo = (await api(page, "GET", "/recurring")).data;
check(!afterUndo.some((x) => x.id === put.id) && afterUndo.find((x) => x.id === swimRule.id).endDate === swimRule.endDate, "Undo brings the old rule back as it was");
// all
await open(page, { ruleId: swimRule.id });
check(await page.inputValue("#add-amt") === "32.00" && await page.getAttribute('[data-end="until"]', "aria-pressed") === "true", "rule fields filled");
await page.fill("#add-amt", "33");
await page.click("#add-go");
await page.waitForSelector("#dlg .w-dialog");
await page.check('input[name="add-apply"][value="all"]');
putResp = page.waitForResponse((x) => /\/api\/recurring\//.test(x.url()) && x.request().method() === "PUT");
await page.click("#dlg [data-dlg-ok]");
put = await (await putResp).json();
await toastText(page, /Saved/);
const amounts = await core(page, (c, id) => c.state.tx.filter((x) => x.rid === id).map((x) => x.a), swimRule.id);
check(put.id === swimRule.id && amounts.length === 3 && amounts.every((a) => a === 33), "All, including past ones: every one it made changes", amounts);
// cancel the question keeps the sheet
await open(page, { ruleId: swimRule.id });
await page.fill("#add-amt", "34");
await page.click("#add-go");
await page.waitForSelector("#dlg .w-dialog");
await page.click("#dlg [data-dlg-x]");
check(await isOpen(page), "Cancel on the question keeps the sheet open");
await page.keyboard.press("Escape");
await page.click("#dlg [data-dlg-ok]");

section("Split a receipt");
await open(page);
await page.keyboard.type("86.40");
await page.fill("#add-name", "Hypermarket");
await pickCat(page, "Groceries");
await page.click("[data-splitrx]");
check(await visible(page, "#add-parts") && !(await visible(page, "#add-catrow")), "Split shows the parts");
check(!(await visible(page, "#add-reprow")), "no Repeat on a split receipt");
await page.fill('[data-pa="0"]', "61.20");
await page.selectOption('[data-pc="1"]', "Shopping");
await page.fill('[data-pa="1"]', "18.95");
check(/Left to assign\s*6\.25/.test(await text(page, "#add-left")), "remaining shown live", await text(page, "#add-left"));
check(/Assign 6\.25.*more/.test(await text(page, "#add-go")), "button: Assign … more", await text(page, "#add-go"));
await page.fill('[data-pa="1"]', "30");
check(/Take .* off the parts/.test(await text(page, "#add-go")) && /Too much/.test(await text(page, "#add-left")), "too much is named too");
await page.fill('[data-pa="1"]', "18.95");
await page.click("[data-addpart]");
await page.selectOption('[data-pc="2"]', "Utilities");
check(/Left to assign\s*0\.00/.test(await text(page, "#add-left")), "an empty part takes what is left");
check(await page.getAttribute('[data-pa="2"]', "placeholder") === "6.25", "and shows it");
let gResp = page.waitForResponse((x) => x.url().endsWith("/api/transactions/group"));
await page.click("#add-go");
let group = await (await gResp).json();
check(group.length === 3 && new Set(group.map((x) => x.group_id)).size === 1 && group.map((x) => x.amount).join() === "61.20,18.95,6.25", "POST /transactions/group with three parts", group.map((x) => x.amount));
await toastText(page, /split in 3/);
// edit the group
await open(page, { txId: group[1].id });
check(await page.$$eval("[data-pa]", (l) => l.length) === 3 && /86\.40/.test(await page.inputValue("#add-amt")), "editing a part edits its group");
await page.click('[data-rmpart="2"]');
await page.fill('[data-pa="1"]', "");
const groupSaves = [];
page.on("response", (x) => { if (/\/api\/transactions/.test(x.url()) && x.request().method() !== "GET") groupSaves.push(x.request().method()); });
await page.click("#add-go");
await toastText(page, /Saved Hypermarket/);
const g2 = (await api(page, "GET", "/transactions/search?text=Hypermarket")).data.filter((x) => x.group_id === group[0].group_id).map((x) => x.amount).sort();
check(JSON.stringify(g2) === JSON.stringify(["25.20", "61.20"]), "edited group: two parts, the rest moved to the empty one", g2);
await page.click("#toast-undo");
await toastText(page, /Undone/);
const g3 = (await api(page, "GET", "/transactions/search?text=Hypermarket")).data.filter((x) => x.group_id === group[0].group_id).map((x) => x.amount).sort();
check(JSON.stringify(g3) === JSON.stringify(["18.95", "6.25", "61.20"]), "Undo restores the three parts", g3);
// delete the group
await open(page, { txId: group[0].id });
await page.click("#add-del");
await toastText(page, /Deleted/);
check((await api(page, "GET", "/transactions/search?text=Hypermarket")).data.length === 0, "Delete removes the whole receipt");

section("Offline queue");
allowNetErrors = true;
await page.route("**/api/transactions", (route) => (route.request().method() === "POST" ? route.abort() : route.continue()));
await open(page);
await page.keyboard.type("6.66");
await page.fill("#add-name", "Offline bakery");
await pickCat(page, "Food");
await page.click("#add-go");
check(/No connection/.test(await toastText(page, /No connection/)), "save while offline: kept on this device");
check(!(await isOpen(page)), "sheet closes");
check(await visible(page, "#add-queue") && /1 waiting to send/.test(await text(page, "#add-queue")), "Waiting to send note shown");
check(await core(page, (c) => c.state.tx.some((x) => x.pending && x.n === "Offline bakery")), "counted in the ledger as pending");
check(await page.evaluate(() => JSON.parse(localStorage.getItem("wally.queue")).length) === 1, "kept in localStorage");
// survives a reload
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector("#app:not([hidden])");
await page.waitForTimeout(500);
check(await visible(page, "#add-queue"), "still waiting after a reload");
// edit it while it waits
const pendingTx = await core(page, (c) => c.state.tx.find((x) => x.pending));
await open(page, { txId: pendingTx.id });
check(/Waiting to send/.test(await text(page, "#add-editing")), "a waiting one says so in the sheet");
await page.fill("#add-amt", "6.70");
await page.click("#add-go");
await toastText(page, /still waiting/);
check(await page.evaluate(() => JSON.parse(localStorage.getItem("wally.queue"))[0].body.amount) === "6.70", "editing changes it where it waits");
await page.unroute("**/api/transactions");
const sent = page.waitForResponse((x) => x.url().endsWith("/api/transactions") && x.request().method() === "POST");
await page.evaluate(() => window.dispatchEvent(new Event("online")));
const sentTx = await (await sent).json();
await toastText(page, /Sent 1 transaction/);
check(sentTx.name === "Offline bakery" && sentTx.amount === "6.70", "sent when back online");
check(!(await visible(page, "#add-queue")) && !(await core(page, (c) => c.state.tx.some((x) => x.pending))), "note gone, no pending rows left");
check(await core(page, (c, id) => c.state.tx.some((x) => x.id === id), sentTx.id), "the sent one is in the ledger");
allowNetErrors = false;

section("Dark, widths and screenshots");
for (const [w, h, theme] of [[1440, 900, "dark"], [900, 900, "light"], [1100, 800, "light"]]) {
  const p = await newPage({ width: w, height: h, theme });
  await open(p);
  await p.keyboard.type("90");
  await p.click('[data-aw="shared"]');
  await p.click("#add-rep");
  const box = await p.$eval("#add-form", (n) => { const r = n.getBoundingClientRect(); return { l: r.left, r: r.right, b: r.bottom, sw: document.documentElement.scrollWidth }; });
  check(box.l >= 0 && box.r <= w && box.sw <= w, w + "px " + theme + ": sheet fits", box);
  const goBox = await p.$eval("#add-go", (n) => n.getBoundingClientRect().bottom);
  check(goBox <= h, w + "px: main button visible", goBox);
  await shot(p, "desk-" + w + "-" + theme);
  await p.context().close();
}

section("Phone: keypad, details, Repeat");
{
  const p = await newPage({ width: 390, height: 844, theme: "dark", touch: true });
  await p.click(".w-tabadd");
  await p.waitForSelector("#add-form.w-addp");
  const sheet = await p.$eval("#add-form", (n) => n.getBoundingClientRect());
  check(sheet.height > 800 && sheet.bottom >= 843, "phone: full height from the bottom", sheet);
  check(await visible(p, "#add-keypad") && await visible(p, '[data-pstep="amt"]') && !(await visible(p, '[data-pstep="details"]')), "step 1: keypad");
  check(await p.getAttribute("#add-amt", "inputmode") === "none", "no phone keyboard over the keypad");
  for (const k of ["1", "2", "+", "3"]) await p.click('[data-k="' + k + '"]');
  check(await p.inputValue("#add-amt") === "12+3" && /15\.00/.test(await text(p, "#add-calc")), "keypad sums", await p.inputValue("#add-amt"));
  await p.click('[data-k="back"]');
  await p.click('[data-k="."]');
  await p.click('[data-k="5"]');
  check(await p.inputValue("#add-amt") === "12+0.5", "decimal and back", await p.inputValue("#add-amt"));
  const keyH = await p.$eval('[data-k="5"]', (n) => n.getBoundingClientRect().height);
  check(keyH >= 44, "keys at least 44 px", keyH);
  await shot(p, "phone-1");
  check(await p.$$eval("#add-again [data-again]", (l) => l.length) >= 1, "Again payees shown");
  await p.click('[data-k="next"]');
  check(await visible(p, '[data-pstep="details"]') && /12\.50/.test(await text(p, "#add-pback")), "Next: details, with the amount to go back");
  check(/Pick a category/.test(await text(p, "#add-go")), "main button names what is missing");
  await pickCat(p, "Food");
  await p.click('#add-who [data-aw="shared"]');
  check(await visible(p, "#add-eachcell") && /6\.25/.test(await text(p, "#add-each")), "Each pays when even", await text(p, "#add-each"));
  const go = await p.$eval("#add-go", (n) => n.getBoundingClientRect());
  check(go.bottom <= 844 && go.top > 600 && go.height >= 44, "main button in thumb reach", go);
  check(/Add expense · 12\.50/.test(await text(p, "#add-go")), "main button shows the amount");
  await shot(p, "phone-2");
  await p.click("#add-repcell");
  check(await visible(p, '[data-pstep="repeat"]'), "Repeat is its own step");
  await p.click('[data-pfq="biweekly"]');
  check(await p.getAttribute('[data-pfq="biweekly"]', "aria-checked") === "true" && await visible(p, '[data-pfq="biweekly"] .ck'), "checkmark on the choice");
  await p.click('[data-end="count"]');
  await p.fill("#add-count", "12");
  check(/Every 2 weeks on \w+, 12 times/.test(await text(p, "#add-rsum")) && await p.$$eval("#add-next span", (l) => l.length) === 3, "summary and next dates");
  await shot(p, "phone-3");
  await p.click(".w-pdone");
  check(/Every 2 weeks, 12 times/.test(await text(p, "#add-repv")), "Repeat cell shows the choice", await text(p, "#add-repv"));
  await p.click("#add-repcell");
  await p.click('[data-pfq="never"]');
  await p.click(".w-pdone");
  check(await text(p, "#add-repv") === "Never", "Never turns it off");
  const resp = p.waitForResponse((x) => x.url().endsWith("/api/transactions") && x.request().method() === "POST");
  await p.click("#add-go");
  const tx = await (await resp).json();
  check(tx.amount === "12.50" && tx.category === "Food" && tx.person_id === null, "saved from the phone", tx);
  await toastText(p, /Added/);
  // Again: one tap
  await p.click(".w-tabadd");
  await p.waitForSelector("#add-form");
  const againName = await p.$eval('[data-again="0"]', (n) => n.textContent);
  await p.click('[data-again="0"]');
  check(await visible(p, '[data-pstep="details"]') && againName.startsWith(await p.inputValue("#add-name")) && /Add expense/.test(await text(p, "#add-go")), "Again fills the payee and its usual amount", againName);
  await p.click('#add-form section:not([hidden]) [data-close]');
  if (await visible(p, "#dlg .w-dialog")) await p.click("#dlg [data-dlg-ok]");
  // edit on the phone
  const one = await core(p, (c) => c.state.tx.find((x) => x.type === "expense" && !x.gr));
  await open(p, { txId: one.id });
  check(await visible(p, '[data-pstep="details"]') && await visible(p, "#add-delcell"), "phone edit: details with Delete");
  await shot(p, "phone-edit");
  await p.click('#add-form section:not([hidden]) [data-close]');
  await p.context().close();
}

section("Arabic, right to left");
{
  await api(page, "PUT", "/language/ar");
  const p = await newPage({ width: 1440, height: 900 });
  await open(p);
  check(await p.evaluate(() => document.documentElement.dir) === "rtl", "page is right to left");
  await p.keyboard.type("12+3");
  const calc = await p.$eval("#add-calc", (n) => n.getBoundingClientRect().left), amt = await p.$eval("#add-amt", (n) => n.getBoundingClientRect().left);
  check(calc < amt, "total sits at the start side (left) in RTL", { calc, amt });
  await shot(p, "desk-ar");
  await p.context().close();
  const p2 = await newPage({ width: 390, height: 844 });
  await open(p2);
  await shot(p2, "phone-ar");
  await p2.context().close();
  await api(page, "PUT", "/language/en");
}

section("Three people: shares for N");
await api(page, "POST", "/people", { name: "Sam" });
{
  const p = await newPage();
  await open(p);
  await p.keyboard.type("10");
  await pickCat(p, "Food");
  check(await p.$$eval("#add-who [data-aw]", (l) => l.length) === 4, "three people and Shared");
  await p.click('[data-aw="shared"]');
  check(/Equal parts/.test(await text(p, "#sm-hint")), "hint for three: equal parts");
  await p.click('#add-by [data-by="1"]');
  let resp = p.waitForResponse((x) => x.url().endsWith("/api/transactions") && x.request().method() === "POST");
  await p.click("#add-go");
  let tx = await (await resp).json();
  check(JSON.stringify(tx.shares) === JSON.stringify({ 1: 334, 2: 333, 3: 333 }), "10.00 three ways: 3.34 / 3.33 / 3.33, spare to the payer", tx.shares);
  await toastText(p, /Added/);
  await open(p);
  await p.keyboard.type("10");
  await pickCat(p, "Food");
  await p.click('[data-aw="shared"]');
  await p.click('[data-sm="custom"]');
  check(await p.$$eval("[data-cust]", (l) => l.length) === 3, "Custom: one field per person");
  await p.fill('[data-cust="1"]', "5");
  await p.fill('[data-cust="2"]', "3");
  await p.fill('[data-cust="3"]', "1");
  check(/1\.00.*left to share/.test(await text(p, "#sp-left")) && /Share 1\.00.*more/.test(await text(p, "#add-go")), "remaining shown, button names it", [await text(p, "#sp-left"), await text(p, "#add-go")]);
  await p.fill('[data-cust="3"]', "2");
  resp = p.waitForResponse((x) => x.url().endsWith("/api/transactions") && x.request().method() === "POST");
  await p.click("#add-go");
  tx = await (await resp).json();
  check(JSON.stringify(tx.shares) === JSON.stringify({ 1: 500, 2: 300, 3: 200 }), "custom shares saved exactly", tx.shares);
  await toastText(p, /Added/);
  await p.context().close();
}

section("One person: no Who, no Shared");
{
  const people = (await api(page, "GET", "/people")).data;
  for (const x of people.filter((x) => x.id !== 1)) await api(page, "DELETE", "/people/" + x.id, { move_to: 1 });
  const p = await newPage();
  await open(p);
  check(!(await visible(p, "#add-whorow")) && !(await visible(p, '[data-aw="shared"]')), "no Who row and no Shared");
  await p.keyboard.type("4");
  await pickCat(p, "Food");
  const resp = p.waitForResponse((x) => x.url().endsWith("/api/transactions") && x.request().method() === "POST");
  await p.click("#add-go");
  const tx = await (await resp).json();
  check(tx.person_id === 1 && tx.shares === null, "saved as the one person's", tx.person_id);
  await toastText(p, /Added/);
  await p.click(".w-addbtn").catch(() => {});
  await p.context().close();
}

console.log("\n" + passed + " passed, " + failed + " failed");
if (errors.length) { console.log("Console errors:\n  " + errors.join("\n  ")); }
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
