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
// The category: on the desktop a combobox (type and Enter); on a phone a page with the list
async function pickCat(p, name) {
  if (!(await p.$("#add-cat"))) { await p.click("#add-catrow"); await p.click('[data-pcat="' + name + '"]'); return; }
  await p.click("#add-cat");
  await p.fill("#add-cat", name);
  await p.keyboard.press("Enter");
}
// Repeat is a page in the sheet, like Calendar's: open it, pick, come back
async function setRepeat(p, fq) {
  await p.click("#add-reprow");
  await p.click('[data-pfq="' + fq + '"]');
}
const back = (p) => p.click('#add-form section:not([hidden]) .w-aback');
const catValue = (p) => p.$("#add-cat").then((n) => (n ? p.inputValue("#add-cat") : text(p, "#add-catv")));
// The date's calendar: open it, step to the month, pick the day
async function pickDate(p, iso) {
  const trigger = (await p.$("#add-pickb")) ? "#add-pickb" : "#add-datecell";
  if (await p.getAttribute(trigger, "aria-expanded") !== "true") await p.click(trigger);
  for (let i = 0; i < 36 && !(await p.$('#add-cal [data-cd="' + iso + '"]')); i++) {
    const first = await p.getAttribute("#add-cal [data-cd]", "data-cd");
    await p.click('#add-cal [data-cm="' + (iso < first ? -1 : 1) + '"]');
  }
  await p.click('#add-cal [data-cd="' + iso + '"]');
}
const clearToast = (p) => p.evaluate(() => { document.getElementById("toast").classList.remove("on"); document.getElementById("toast-t").textContent = ""; });
const shot = async (page, name) => { if (SHOTS) await page.waitForTimeout(450), await page.screenshot({ path: SHOTS + "/" + name + ".png" }); };
const today = (page) => core(page, (c) => c.TODAY);
const addDays = (d, n) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8)) + n * 864e5).toISOString().slice(0, 10);

/* ======================================================================= */
const page = await newPage();
const TODAY = await today(page);

section("Fast path: amount, Enter, three letters, Enter");
await page.click(".w-hadd").catch(() => page.keyboard.press("n"));
await page.waitForSelector("#add-form");
check(await focused(page) === "add-amt", "amount has focus on open");
check(await page.$eval("#add-form", (f) => f.getAttribute("role") === "dialog" && f.getAttribute("aria-modal") === "true"), "sheet is a modal dialog");
check(/Enter an amount/.test(await text(page, "#add-go")), "button says Enter an amount", await text(page, "#add-go"));
await page.keyboard.type("12.40+8.15");
check(/20\.55/.test(await text(page, "#add-calc")), "sum shown before saving", await text(page, "#add-calc"));
check(await page.$eval("#add-amt", (i) => i.scrollWidth <= i.clientWidth), "the whole amount shows, 1s included");
check(/Enter what it was for/.test(await text(page, "#add-go")), "button says what is missing: the name");
await page.keyboard.press("Enter");
check(await focused(page) === "add-name", "Enter moves to the name");
check(await page.inputValue("#add-amt") === "20.55", "sum becomes its total", await page.inputValue("#add-amt"));
await page.keyboard.type("mer");
check(await visible(page, "#add-sugg"), "payee suggestions open");
check(await page.getAttribute("#add-name", "aria-expanded") === "true" && await page.getAttribute("#add-name", "aria-activedescendant") === "add-sg-0", "combobox announces the listbox");
check(await page.$$eval("#add-sugg [role=option]", (l) => l.length) >= 1, "options in a listbox");
await page.keyboard.press("Enter");
check(/^Mercadona/.test(await page.inputValue("#add-name")), "Enter picks the payee", await page.inputValue("#add-name"));
check(await page.inputValue("#add-cat") === "Groceries", "payee fills its category");
check(await page.$eval("#add-name", (n) => n.placeholder) === "What was it for?", "the name is not optional");
check(await text(page, "#lbl-name") === "Merchant", "expense: the name is labelled Merchant");
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

section("Keys: the category combobox, radio groups, focus trap, Escape");
await open(page);
await page.keyboard.type("4");
await page.focus("#add-cat");
check(await visible(page, "#add-catlist") && await page.getAttribute("#add-cat", "aria-expanded") === "true" && await page.getAttribute("#add-cat", "aria-activedescendant") === "add-co-0", "Category opens its list on focus");
check(await page.$$eval("#add-catlist [role=option]", (l) => l.length) >= 5, "every category is offered");
await page.keyboard.press("ArrowDown");
const second = await text(page, "#add-co-1 b");
await page.keyboard.press("Enter");
check(await page.inputValue("#add-cat") === second && !(await visible(page, "#add-catlist")) && await focused(page) === "add-cat", "arrows and Enter pick a category", second);
await page.keyboard.type("gro");
check(await text(page, "#add-co-0 b") === "Groceries", "typing filters the list");
await page.keyboard.press("Tab");
check(await page.inputValue("#add-cat") === "Groceries" && await focused(page) !== "add-cat", "Tab takes the match and moves on");
await page.focus("#add-cat");
await page.keyboard.type("Board games");
check(/New category/.test(await text(page, "#add-catlist")), "a name that matches nothing is offered as a new category");
await page.keyboard.press("Escape");
check(await isOpen(page) && !(await visible(page, "#add-catlist")) && await page.inputValue("#add-cat") === "Groceries", "Escape closes the list and keeps the category");
await page.keyboard.type("Board games");
await page.keyboard.press("Enter");
check(await page.inputValue("#add-cat") === "Board games", "Enter takes the new category");
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
await page.focus(".w-hadd");
await page.keyboard.press("Enter");
await page.waitForSelector("#add-form");
await page.click("[data-close]");
check(!(await isOpen(page)) && !(await visible(page, "#dlg .w-dialog")), "× closes at once when nothing changed");
check(await page.evaluate(() => document.activeElement.classList.contains("w-hadd")), "focus returns where it was");
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
check(await focused(page) === "add-name" && /Enter what it was for/.test(await text(page, "#add-nerr")) && await page.getAttribute("#add-name", "aria-invalid") === "true", "then to the name, with the error under it");
await page.fill("#add-name", "Errand");
check(!(await visible(page, "#add-nerr")), "the error goes once a name is typed");
await page.click("#add-go", { force: true });
check(await focused(page) === "add-cat", "then to the category");
// a date in the future needs Repeat
await pickCat(page, "Food");
await page.click("#add-pickb");
// On the last day of a month, tomorrow is not in the grid at all: the next month cannot be opened
const tomorrow = '#add-cal [data-cd="' + addDays(TODAY, 1) + '"]';
const tomorrowOff = (await page.$(tomorrow)) ? await page.isDisabled(tomorrow) : await page.isDisabled('#add-cal [data-cm="1"]');
check(tomorrowOff && !(await page.isDisabled('#add-cal [data-cd="' + TODAY + '"]')), "without Repeat, days after today cannot be picked");
await setRepeat(page, "monthly"); await back(page);
await pickDate(page, addDays(TODAY, 3));
await setRepeat(page, "never"); await back(page);
check(/turn on Repeat/.test(await text(page, "#add-derr")), "future date without Repeat: error under the date");
await page.click('[data-ad="today"]');
check(!(await visible(page, "#add-derr")), "error goes when fixed");
await page.focus("#add-name");
saved = await saveWith(page, "Enter");
check(saved.name === "Errand" && saved.category === "Food", "Enter on the name adds", saved.name);
await toastText(page, /Added/);

section("Duplicate warning");
await open(page);
await page.keyboard.type("7");
await pickCat(page, "Food");
check(await page.locator("#add-budget").count() === 0, "no budget hint under the category");
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
  await page.fill("#add-name", "Shared lunch");
  await pickCat(page, "Food");
  await page.click('[data-aw="shared"]');
  if (setup) await setup();
  return clickSave(page);
}
saved = await sharedSave("10.01", async () => { await page.selectOption("#add-bysel", "1"); });
check(JSON.stringify(saved.shares) === JSON.stringify({ 1: 501, 2: 500 }) && saved.paid_by === 1, "10.01 paid by Alex: 5.01 / 5.00", saved.shares);
await toastText(page, /Added/);
saved = await sharedSave("10.01", async () => { await page.selectOption("#add-bysel", "2"); });
check(saved.shares["1"] === 500 && saved.shares["2"] === 501 && saved.paid_by === 2, "paid by Ana: the spare cent is Ana's", saved.shares);
await toastText(page, /Added/);
saved = await sharedSave("0.01", async () => { await page.selectOption("#add-bysel", "1"); });
check(saved.shares["1"] === 1 && !saved.shares["2"], "0.01: the one cent is the payer's", saved.shares);
await toastText(page, /Added/);
// by income
saved = await sharedSave("100", async () => {
  await page.selectOption("#add-smsel", "income");
  const lab = await page.$eval('#add-smsel option[value="income"]', (n) => n.textContent);
  check(/By income \d+\/\d+/.test(lab), "By income shows the split", lab);
  check(/^By income: /.test(await text(page, "#add-splitnote")), "under the rows: each person's part by income", await text(page, "#add-splitnote"));
});
const [ia, ib] = [saved.shares["1"], saved.shares["2"]];
const expectA = await core(page, (c) => {
  const [y, m] = c.ym(c.TODAY), q = c.ymAdd(y, m, -3), from = c.ds(q[0], q[1], 1);
  const a = c.totals(from, c.TODAY, "1").inc, b = c.totals(from, c.TODAY, "2").inc;
  return Math.floor((10000 * a) / (a + b));
});
check(ia + ib === 10000 && Math.abs(ia - expectA) <= 1, "By income: shares from income, adding up", { ia, ib, expectA });
await toastText(page, /Added/);
// custom: a row per person, the first typed, the other gets the rest
saved = await sharedSave("50", async () => {
  await page.selectOption("#add-smsel", "custom");
  check(await visible(page, "#add-split-a") && await visible(page, "#sp-v1"), "Custom: a row per person");
  await page.fill("#add-split-a", "15");
  check(/35\.00/.test(await text(page, "#sp-v1")) && /30%/.test(await text(page, "#sp-p0")), "typing one part sets the other", await text(page, "#sp-v1"));
});
check(saved.shares["1"] === 1500 && saved.shares["2"] === 3500, "Custom: 15.00 / 35.00", saved.shares);
await toastText(page, /Added/);
saved = await sharedSave("50", async () => {
  await page.selectOption("#add-smsel", "custom");
  await page.fill("#add-split-a", "12.34");
  check(/37\.66/.test(await text(page, "#sp-v1")), "typed part: the other gets the rest", await text(page, "#sp-v1"));
});
check(saved.shares["1"] === 1234 && saved.shares["2"] === 3766, "Custom typed: exact cents", saved.shares);
await toastText(page, /Added/);

section("Income");
await open(page, { type: "income" });
check(!(await visible(page, "#add-catrow")), "income hides the Category row");
check(await text(page, "#lbl-who") === "Who", "income says Who too");
await page.keyboard.type("2450");
check(/Enter where it is from/.test(await text(page, "#add-go")), "income: button asks where it is from");
check(await text(page, "#lbl-name") === "Source", "income: the name is labelled Source");
await page.fill("#add-name", "Side job");
await page.click('[data-aw="shared"]');
check(!(await visible(page, "#add-byrow")), "income has no Paid by");
check(await text(page, "#add-go") === "Add Income", "button: Add Income");
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
await page.fill("#add-name", "Road snack");
await pickCat(page, "Food");
await page.click('[data-ad="yesterday"]');
check(await visible(page, "#add-tag") && await visible(page, "#add-note"), "with an amount, Tags and Note join the second group");
const tagsNow = () => page.$$eval("#add-tags [data-tg]", (l) => l.map((n) => n.dataset.tg).join());
check(await page.getAttribute("#add-tag", "placeholder") === "Add a tag", "a short placeholder: Add a tag");
const tagW = async () => Math.round((await page.locator("#add-tag").boundingBox()).width);
const tw0 = await tagW();
await page.click("#add-tag");
check(await tagW() === tw0, "the tag field keeps its width when it gets the focus", [tw0, await tagW()]);
await page.keyboard.type("Road Trip ");
check(await tagsNow() === "#road,#trip" && await page.inputValue("#add-tag") === "", "a space ends a tag: “Road Trip ” is #road and #trip", await tagsNow());
check(await page.getAttribute("#add-tag", "placeholder") === "+ tag", "then the placeholder says + tag");
await page.keyboard.type("coffee,");
check(await tagsNow() === "#road,#trip,#coffee", "a comma ends a tag too", await tagsNow());
await page.press("#add-tag", "Backspace");
check(await tagsNow() === "#road,#trip", "Backspace on an empty tag field removes the last tag", await tagsNow());
check(await page.$$eval("#add-taglist option", (l) => l.some((o) => o.value === "#coffee")), "tag suggestions from the household's tags");
await page.keyboard.type("hol");
await page.click('#add-tags [data-tg="#trip"]');
check(await tagsNow() === "#road" && await page.inputValue("#add-tag") === "hol" && await page.evaluate(() => document.activeElement.id) === "add-tag",
  "× removes a tag and leaves the focus, and the half-typed tag, in the field", [await tagsNow(), await page.inputValue("#add-tag")]);
await page.keyboard.type("iday");
await page.fill("#add-note", "Paid in cash");
saved = await clickSave(page);
check(saved.date === addDays(TODAY, -1), "Yesterday", saved.date);
check(saved.tags.join() === "road,holiday", "tags saved, including one still typed", saved.tags);
check(saved.note === "Paid in cash", "note saved");
await toastText(page, /Added/);
await open(page);
await page.keyboard.type("3");
await page.fill("#add-name", "Old receipt");
await pickCat(page, "Food");
await page.click("#add-pickb");
check(await visible(page, "#add-cal") && await page.evaluate(() => document.activeElement.dataset.cd) === TODAY, "Other date opens the calendar on today, focused");
await page.keyboard.press("ArrowLeft");
await page.keyboard.press("ArrowUp");
check(await page.evaluate(() => document.activeElement.dataset.cd) === addDays(TODAY, -8), "arrows move by a day and a week");
await page.keyboard.press("PageUp");
check(await page.getAttribute("#add-cal [data-cd]", "data-cd") < addDays(TODAY, -8).slice(0, 8) + "01", "Page Up goes to the month before");
await page.keyboard.press("Escape");
check(!(await visible(page, "#add-cal")) && await visible(page, "#add-modal") && await page.evaluate(() => document.activeElement.dataset.ad) === "today", "Escape closes the calendar, not the sheet");
await pickDate(page, addDays(TODAY, -40));
check(!(await visible(page, "#add-cal")) && await page.getAttribute("#add-pickb", "aria-pressed") === "true" && await focused(page) === "add-pickb", "Other date shows the day picked, the calendar closed");
saved = await clickSave(page);
check(saved.date === addDays(TODAY, -40), "other date saved", saved.date);
await toastText(page, /Added/);

section("Add another (Shift+Cmd+Enter)");
await open(page);
await page.keyboard.type("2");
await page.fill("#add-name", "Kiosk");
await pickCat(page, "Food");
await page.click('[data-aw="2"]');
await page.click('[data-ad="yesterday"]');
saved = await saveWith(page, "Shift+Control+Enter");
check(saved.person_id === 2, "first one saved");
check(await isOpen(page), "sheet stays open");
check(await page.inputValue("#add-amt") === "" && await focused(page) === "add-amt", "amount cleared and focused");
check(await page.getAttribute('[data-aw="2"]', "aria-checked") === "true" && await page.getAttribute('[data-ad="yesterday"]', "aria-pressed") === "true", "keeps the date and the person");
await page.keyboard.type("3");
await page.fill("#add-name", "Kiosk");
await pickCat(page, "Food");
saved = await clickSave(page);
check(saved.person_id === 2 && saved.date === addDays(TODAY, -1), "second one has the same person and date");
await toastText(page, /Added/);

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
  await page.click("#add-reprow");
  check(await visible(page, '[data-pstep="repeat"]') && !(await visible(page, '[data-pstep="main"]')), "Repeat opens as a page in the sheet");
  check(await page.getAttribute('[data-pfq="never"]', "aria-checked") === "true", "starts at Never");
  await page.click('[data-pfq="monthly"]');
  check(await page.getAttribute('[data-pfq="monthly"]', "aria-checked") === "true" && await page.inputValue("#add-endsel") === "never", "Every month, never ending");
  check(/^Next: .+, .+, .+/.test(await text(page, "#add-next")), "the next three dates", await text(page, "#add-next"));
  await back(page);
  check(await focused(page) === "add-reprow" && await text(page, "#add-repv") === "Every month", "back at Repeat, showing the choice", await text(page, "#add-repv"));
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
  await setRepeat(page, "monthly"); await back(page);
  await pickDate(page, start2);
  await setRepeat(page, "biweekly");
  await page.selectOption("#add-endsel", "count");
  await page.fill("#add-count", "4");
  const sum = await text(page, "#add-rsum");
  check(/2 more up to today are added too/.test(sum), "every 2 weeks, 4 times: the past dates are named", sum);
  check(/Every 2 weeks, 4 times/.test(await page.evaluate(async () => { document.querySelector('#add-form section:not([hidden]) .w-aback').click(); return document.getElementById("add-repv").textContent; })), "the row says Every 2 weeks, 4 times");
});
check(r.rule.frequency === "weekly" && r.rule.interval === 2 && r.rule.startDate === start2 && r.rule.endDate === addDays(start2, 42), "after 4 times becomes an end date", [r.rule.startDate, r.rule.endDate]);
check(JSON.stringify(r.made) === JSON.stringify([start2, addDays(start2, 14), addDays(start2, 28)]), "past dates added by the server", r.made);
const swimRule = r.rule;

r = await ruleSave(async () => {
  await page.keyboard.type("5");
  await page.fill("#add-name", "Plant food");
  await pickCat(page, "Shopping");
  await setRepeat(page, "custom");
  check(await focused(page) === "add-every", "Custom focuses Every");
  await page.fill("#add-every", "3");
  await page.selectOption("#add-unit", "daily");
  await page.selectOption("#add-endsel", "until");
  await page.fill("#add-until", TODAY);
  check(/after/.test(await text(page, "#add-rerr")), "last date must be after the start", await text(page, "#add-rerr"));
  check(/Fix the highlighted field/.test(await text(page, "#add-go")), "button names the problem");
  await page.fill("#add-until", addDays(TODAY, 30));
  await back(page);
  check(/^Every 3 days/.test(await text(page, "#add-repv")), "every 3 days on the row", await text(page, "#add-repv"));
});
check(r.rule.frequency === "daily" && r.rule.interval === 3 && r.rule.endDate === addDays(TODAY, 30), "every 3 days until a date", r.rule);
r = await ruleSave(async () => {
  await page.keyboard.type("49");
  await page.fill("#add-name", "Domain name");
  await pickCat(page, "Utilities");
  await setRepeat(page, "yearly");
  check(await page.getAttribute('[data-pfq="yearly"]', "aria-checked") === "true", "Every year checked");
  await back(page);
});
check(r.rule.frequency === "yearly" && r.rule.interval === 1, "yearly rule");
r = await ruleSave(async () => {
  await page.keyboard.type("1.50");
  await page.fill("#add-name", "Bread");
  await pickCat(page, "Groceries");
  await setRepeat(page, "daily");
  await page.selectOption("#add-endsel", "count");
  await page.fill("#add-count", "5");
  await back(page);
});
check(r.rule.frequency === "daily" && r.rule.endDate === addDays(TODAY, 4), "daily, 5 times", r.rule.endDate);
r = await ruleSave(async () => {
  await page.keyboard.type("9");
  await page.fill("#add-name", "Weekly box");
  await pickCat(page, "Groceries");
  await setRepeat(page, "weekly");
  await back(page);
});
check(r.rule.frequency === "weekly" && r.rule.interval === 1, "weekly rule");
// openAdd({repeat:true})
await open(page, { repeat: true });
check(await text(page, "#add-repv") === "Every month", "openAdd({repeat:true}) opens with Repeat on", await text(page, "#add-repv"));
await page.click("[data-close]");
// "Make it a rule" from Recurring: everything prefilled
await open(page, { repeat: true, name: "Power", amount: 61.5, category: "Utilities", person: null, date: addDays(TODAY, 5), type: "expense", freq: "monthly", every: 2, about: true });
check(await page.inputValue("#add-name") === "Power" && await page.inputValue("#add-amt") === "61.50" && await page.inputValue("#add-cat") === "Utilities"
  && await page.getAttribute('[data-aw="shared"]', "aria-checked") === "true" && /^Every 2 months/.test(await text(page, "#add-repv")), "prefill: name, amount, category, person, every 2 months", await text(page, "#add-repv"));
await clearToast(page);
let pre = page.waitForResponse((x) => x.url().endsWith("/api/recurring") && x.request().method() === "POST");
await page.click("#add-go");
pre = await (await pre).json();
check(pre.about === true && pre.interval === 2 && pre.frequency === "monthly" && pre.person_id === null && pre.startDate === addDays(TODAY, 5), "rule saved with about, interval and a future start", pre);
check(!(await core(page, (c, id) => c.state.tx.some((x) => x.rid === id), pre.id)), "a future start adds nothing yet");
await toastText(page, /Added Power/);
await open(page, { name: "Corner shop", amount: "3,20", category: "Groceries", person: "2", date: addDays(TODAY, -2) });
check(await page.inputValue("#add-name") === "Corner shop" && await page.getAttribute('[data-aw="2"]', "aria-checked") === "true" && await page.getAttribute("#add-pickb", "aria-pressed") === "true" && /^3[.,]20$/.test(await page.inputValue("#add-amt")) && await text(page, "#add-go") === "Add Expense", "prefill for a plain transaction", [await page.inputValue("#add-amt"), await text(page, "#add-go")]);
await page.keyboard.press("Escape");
if (await visible(page, "#dlg .w-dialog")) await page.click("#dlg [data-dlg-ok]");

section("Edit a transaction, delete and Undo");
const victim = (await core(page, (c, d) => c.state.tx.find((x) => x.type === "expense" && !x.rec && !x.gr && x.p !== null && x.d < d), TODAY));
await open(page, { txId: victim.id });
check(/Edit expense/.test(await text(page, "#add-title")) && await text(page, "#add-htitle") === "Transaction" && !(await visible(page, "#add-editing")), "edit: Cancel · Transaction · Save, no Editing pill");
check(await page.inputValue("#add-name") === victim.n, "fields filled");
check(await visible(page, "#add-del") && await text(page, "#add-del") === "Delete transaction", "edit shows Delete transaction as the last row");
check(await focused(page) === "add-form", "editing selects nothing");
await page.fill("#add-amt", "77.70");
check(await text(page, "#add-go") === "Save" && await page.getAttribute("#add-go", "aria-disabled") === "false", "Save at the top");
saved = await clickSave(page, /\/api\/transactions\/[0-9a-f-]+$/);
check(saved.id === victim.id && saved.amount === "77.70", "PUT saved the change");
await toastText(page, /Saved/);
await page.click("#toast-undo");
await toastText(page, /Undone/);
check((await api(page, "GET", "/transactions/id/" + victim.id)).data[0].amount === victim.a.toFixed(2), "Undo restores the previous values");
await open(page, { txId: victim.id });
await page.click("#add-amt");
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
check(!(await visible(page, "#add-reprow")), "no Repeat row on it");
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
check(await page.inputValue("#add-amt") === "32.00" && /until/.test(await text(page, "#add-repv")) && await text(page, "#add-htitle") === "Bill", "rule fields filled", await text(page, "#add-repv"));
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
await page.click("#add-cat");
check(/Split across categories/.test(await text(page, "#add-catlist [role=option]:last-child")), "Split is the last choice in the category list");
await page.click("#add-catlist [role=option]:last-child");
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
  const box = await p.$eval("#add-form", (n) => { const r = n.getBoundingClientRect(); return { l: r.left, r: r.right, b: r.bottom, sw: document.documentElement.scrollWidth }; });
  check(box.l >= 0 && box.r <= w && box.sw <= w, w + "px " + theme + ": sheet fits", box);
  const goBox = await p.$eval("#add-go", (n) => n.getBoundingClientRect().bottom);
  check(goBox <= h, w + "px: main button visible", goBox);
  await shot(p, "desk-" + w + "-" + theme);
  await p.context().close();
}

section("Phone: one page, the keypad while the amount is typed, Repeat");
{
  const p = await newPage({ width: 390, height: 844, theme: "dark", touch: true });
  await p.click(".w-tabadd");
  await p.waitForSelector("#add-form.w-addp");
  await p.waitForTimeout(350);
  const sheet = await p.$eval("#add-form", (n) => n.getBoundingClientRect());
  check(sheet.top <= 0.5 && sheet.height >= 843 && sheet.width === 390, "phone: the whole screen", sheet);
  check(await p.$$eval(".w-grab", (l) => l.length) === 0, "no grabber: the sheet can’t be dragged");
  check(await visible(p, "#add-keypad") && await visible(p, "#add-name") && await visible(p, "#add-catrow") && !(await visible(p, "#add-go")),
    "one page: the keypad in the main button’s place, with the name and categories above it");
  const pad = await p.$eval("#add-keypad", (n) => n.getBoundingClientRect());
  check(pad.bottom >= 843 && pad.top > 844 / 2, "the keypad sits at the bottom, in thumb reach", pad);
  check(await p.getAttribute("#add-amt", "inputmode") === "none", "no phone keyboard over the keypad");
  for (const k of ["1", "2", "+", "3"]) await p.tap('[data-k="' + k + '"]');
  check(await p.inputValue("#add-amt") === "12+3" && /15\.00/.test(await text(p, "#add-calc")), "keypad sums", await p.inputValue("#add-amt"));
  check(await focused(p) === "add-amt", "keys leave the focus in the amount");
  await p.tap('[data-k="back"]');
  await p.tap('[data-k="."]');
  await p.tap('[data-k="5"]');
  check(await p.inputValue("#add-amt") === "12+0.5", "decimal and back", await p.inputValue("#add-amt"));
  check(await p.$eval("#add-amt", (i) => i.scrollWidth <= i.clientWidth), "phone: the whole amount shows");
  const keyH = await p.$eval('[data-k="5"]', (n) => n.getBoundingClientRect().height);
  check(keyH >= 44, "keys at least 44 px", keyH);
  check(await p.$$eval("#add-form .w-chip", (l) => l.every((c) => c.closest("#add-tags"))), "no chips but tags");
  check(await text(p, "#add-amt").then(() => p.getAttribute("#add-amt", "placeholder")) === "0.00", "phone: 0.00 like the desktop");
  const catH = await p.$eval("#add-catrow", (n) => [n.getBoundingClientRect().height, parseFloat(getComputedStyle(n).fontSize)]);
  check(catH[0] >= 44 && catH[1] >= 16, "phone: rows are touch size, with text iOS won't zoom", catH);
  await shot(p, "phone-1");
  check(await text(p, "#add-knext") === "Next", "the keypad’s last key: Next, with no name yet");
  await p.tap("#add-knext");
  check(await focused(p) === "add-name" && !(await visible(p, "#add-keypad")), "Next: on to the name, with the phone’s keyboard instead of the keypad");
  check(await p.inputValue("#add-amt") === "12.50", "the sum is worked out", await p.inputValue("#add-amt"));
  const likely = await p.$$eval("#add-sugg [data-si]", (l) => l.map((b) => b.querySelector("small").textContent));
  check(likely.length >= 1 && likely.length <= 3 && likely.every((x) => / times|Every /.test(x)), "the name suggests the likely payees, with their category and usual amount", likely);
  check(await p.$("#add-sugg [aria-selected=true]") === null && await p.getAttribute("#add-name", "aria-activedescendant") === null, "none picked yet");
  await p.press("#add-name", "Enter");
  check(await p.inputValue("#add-name") === "" && await text(p, "#add-nerr") === "Enter what it was for", "Done on an empty name does not pick one: it asks for the name");
  check(await visible(p, "#add-go") && await text(p, "#add-go") === "Enter what it was for", "the main button is back, naming what is missing", await text(p, "#add-go"));
  await shot(p, "phone-name");
  await p.tap("#add-amt");
  check(await visible(p, "#add-keypad") && !(await visible(p, "#add-go")), "a tap on the amount: the keypad again");
  await p.tap("#lbl-who");
  check(!(await visible(p, "#add-keypad")) && await visible(p, "#add-go"), "a tap anywhere else closes it");
  await p.tap("#add-amt");
  await p.keyboard.press("Escape");
  check(!(await visible(p, "#add-keypad")) && await isOpen(p), "Escape closes the keypad, not the sheet");
  await p.tap("#add-name");
  await p.fill("#add-name", "Newsstand");
  check(!(await visible(p, "#add-picks")), "typing a name hides the picks");
  await p.press("#add-name", "Enter");
  check(await focused(p) !== "add-name" && !(await visible(p, "#add-keypad")), "Enter: the keyboard goes, to show the page");
  check(/Pick a category/.test(await text(p, "#add-go")), "main button names what is missing");
  await pickCat(p, "Food");
  await p.click('#add-who [data-aw="shared"]');
  check(/^Half each: .*6\.25/.test(await text(p, "#add-splitnote")) && await text(p, "#add-smv") === "Evenly", "Split row says Evenly, each part under it", await text(p, "#add-splitnote"));
  await p.click("#add-smrow");
  check(await visible(p, '[data-pstep="split"]') && /Each pays 6\.25/.test(await text(p, "#add-each")) && /owes .* 6\.25\s.*for this\./.test(await text(p, "#add-owes")), "the Split page: each part and who owes whom", [await text(p, "#add-each"), await text(p, "#add-owes")]);
  await back(p);
  const go = await p.$eval("#add-go", (n) => n.getBoundingClientRect());
  check(go.bottom <= 844 && go.top > 600 && go.height >= 44, "main button in thumb reach", go);
  check(await text(p, "#add-go") === "Add Expense", "main button: Add Expense");
  await shot(p, "phone-2");
  await p.click("#add-reprow");
  check(await visible(p, '[data-pstep="repeat"]') && !(await visible(p, '[data-pstep="main"]')), "Repeat opens over the page");
  await p.click('[data-pfq="biweekly"]');
  check(await p.getAttribute('[data-pfq="biweekly"]', "aria-checked") === "true" && await visible(p, '[data-pfq="biweekly"] .w-ack'), "checkmark on the choice");
  await p.selectOption("#add-endsel", "count");
  await p.fill("#add-count", "12");
  check(/^Next: /.test(await text(p, "#add-next")), "the next dates", await text(p, "#add-next"));
  await shot(p, "phone-3");
  await back(p);
  check(await focused(p) === "add-reprow" && /Every 2 weeks, 12 times/.test(await text(p, "#add-repv")), "back on the page, at Repeat, showing the choice", await text(p, "#add-repv"));
  check(await p.$eval("#add-amt", (i) => i.scrollWidth <= i.clientWidth && i.value === "12.50"), "the amount still shows whole");
  await p.click("#add-reprow");
  await p.click('[data-pfq="never"]');
  await back(p);
  check(await text(p, "#add-repv") === "Never", "Never turns it off");
  const resp = p.waitForResponse((x) => x.url().endsWith("/api/transactions") && x.request().method() === "POST");
  await p.click("#add-go");
  const tx = await (await resp).json();
  check(tx.amount === "12.50" && tx.category === "Food" && tx.person_id === null, "saved from the phone", tx);
  await toastText(p, /Added/);
  // a pick: the payee and its category, and the amount stays as typed
  await p.click(".w-tabadd");
  await p.waitForSelector("#add-form.kp");
  await p.tap('[data-k="7"]');
  await p.tap("#add-knext");
  const pickName = await p.$eval('[data-si="0"] b', (n) => n.textContent);
  await p.tap('[data-si="0"]');
  check(await p.inputValue("#add-name") === pickName && (await catValue(p)) !== "Pick" && !(await visible(p, "#add-keypad")) && await focused(p) !== "add-name" && await text(p, "#add-go") === "Add Expense" && /^7([.,]00)?$/.test(await p.inputValue("#add-amt")),
    "a pick fills the payee and category, keeps the amount, and it is ready to add", pickName);
  await p.click('#add-form section:not([hidden]) [data-close]');
  if (await visible(p, "#dlg .w-dialog")) await p.click("#dlg [data-dlg-ok]");
  // edit on the phone: everything shows, no keypad until the amount is tapped
  const one = await core(p, (c) => c.state.tx.find((x) => x.type === "expense" && !x.gr));
  await open(p, { txId: one.id });
  check(!(await visible(p, "#add-keypad")) && await visible(p, "#add-name") && await visible(p, "#add-del") && await focused(p) === "add-form" && await text(p, "#add-go") === "Save", "phone edit: Save at the top, Delete as the last row, no keypad");
  await shot(p, "phone-edit");
  await p.tap("#add-amt");
  check(await visible(p, "#add-keypad") && await text(p, "#add-knext") === "Done", "editing the amount: the keypad, with Done");
  await p.click('#add-form section:not([hidden]) [data-close]');
  if (await visible(p, "#dlg .w-dialog")) await p.click("#dlg [data-dlg-ok]");
  // Split across categories, from the phone's Category page
  await p.waitForTimeout(400);
  await open(p, {});
  await p.tap('[data-k="9"]');
  await p.tap("#add-knext");
  await p.evaluate(() => document.activeElement.blur());
  await p.click("#add-catrow");
  await p.click("[data-psplit]");
  check(await visible(p, "#add-parts") && !(await visible(p, "#add-catrow")), "phone: Split across categories shows the parts");
  await p.click('#add-form section:not([hidden]) [data-close]');
  if (await visible(p, "#dlg .w-dialog")) await p.click("#dlg [data-dlg-ok]");
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
  // the date cell opens the calendar under it; right to left, the left arrow goes to the next day
  await p2.click('[data-k="5"]');
  await p2.fill("#add-name", "Date check");
  await p2.press("#add-name", "Enter");
  await p2.click("#add-datecell");
  check(await visible(p2, "#add-cal") && await p2.getAttribute("#add-datecell", "aria-expanded") === "true", "phone: the date cell opens the calendar");
  await p2.keyboard.press("ArrowRight");
  await p2.keyboard.press("ArrowLeft");
  await p2.keyboard.press("ArrowLeft");
  check(await p2.evaluate(() => document.activeElement.dataset.cd) === TODAY, "right to left: arrows follow the reading direction, and stop at today");
  await p2.keyboard.press("ArrowRight");
  await p2.keyboard.press("Enter");
  check(!(await visible(p2, "#add-cal")) && await focused(p2) === "add-datecell" && await p2.getAttribute("#add-datecell", "aria-expanded") === "false", "picking a day closes it, back on the cell");
  await p2.context().close();
  await api(page, "PUT", "/language/en");
}

section("Three people: shares for N");
await api(page, "POST", "/people", { name: "Sam" });
{
  const p = await newPage();
  await open(p);
  await p.keyboard.type("10");
  await p.fill("#add-name", "Dinner for three");
  await pickCat(p, "Food");
  check(await p.$$eval("#add-who [data-aw]", (l) => l.length) === 4, "three people and Shared");
  await p.click('[data-aw="shared"]');
  check(/^Equal parts: /.test(await text(p, "#add-splitnote")), "for three: equal parts", await text(p, "#add-splitnote"));
  await p.selectOption("#add-bysel", "1");
  let resp = p.waitForResponse((x) => x.url().endsWith("/api/transactions") && x.request().method() === "POST");
  await p.click("#add-go");
  let tx = await (await resp).json();
  check(JSON.stringify(tx.shares) === JSON.stringify({ 1: 334, 2: 333, 3: 333 }), "10.00 three ways: 3.34 / 3.33 / 3.33, spare to the payer", tx.shares);
  await toastText(p, /Added/);
  await open(p);
  await p.keyboard.type("10");
  await p.fill("#add-name", "Dinner for three");
  await pickCat(p, "Food");
  await p.click('[data-aw="shared"]');
  await p.selectOption("#add-smsel", "custom");
  check(await p.$$eval("[data-cust]", (l) => l.length) === 3, "Custom: one field per person");
  await p.fill('[data-cust="1"]', "5");
  await p.fill('[data-cust="2"]', "3");
  await p.fill('[data-cust="3"]', "1");
  check(/1\.00.*left to share/.test(await text(p, "#add-splitnote")) && /Share 1\.00.*more/.test(await text(p, "#add-go")), "remaining shown, button names it", [await text(p, "#add-splitnote"), await text(p, "#add-go")]);
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
  await p.fill("#add-name", "Stamps");
  await pickCat(p, "Food");
  const resp = p.waitForResponse((x) => x.url().endsWith("/api/transactions") && x.request().method() === "POST");
  await p.click("#add-go");
  const tx = await (await resp).json();
  check(tx.person_id === 1 && tx.shares === null, "saved as the one person's", tx.person_id);
  await toastText(p, /Added/);
  await p.click(".w-hadd").catch(() => {});
  await p.context().close();
}

console.log("\n" + passed + " passed, " + failed + " failed");
if (errors.length) { console.log("Console errors:\n  " + errors.join("\n  ")); }
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
