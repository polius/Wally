/* Month in review and the command bar (2.1), on real servers.
   Starts a demo server and an empty one of its own:
     REPO=/path/to/Wally PYTHON=/path/to/python PORT=8806 node review.mjs
   Screenshots go to SHOTS (a folder) when it is set. */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = process.env.REPO || process.cwd();
const PYTHON = process.env.PYTHON || "python3";
const PORT = +(process.env.PORT || 8806);
const SHOTS = process.env.SHOTS || "";
if (SHOTS && !existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log("  ok  " + msg); else { failures++; console.log("  FAIL " + msg); } };
const servers = [];
async function startServer(port, demo) {
  const data = mkdtempSync(join(tmpdir(), "wally-review-"));
  const env = { ...process.env, WALLY_DATA: data };
  if (demo) env.DEMO = "true"; else delete env.DEMO;
  servers.push(spawn(PYTHON, ["-m", "uvicorn", "utils.dev_server:app", "--port", String(port)], { cwd: REPO, env, stdio: "ignore" }));
  const base = "http://localhost:" + port;
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(base + "/api/auth/status")).ok) return base; } catch (e) { /* not yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server on " + port + " did not start");
}
const api = (base, path, method = "GET", body) => fetch(base + "/api" + path, { method, headers: { "Content-Type": "application/json", "X-Wally-Person": "1" }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());

/* The month that closed last, in this machine's day, as the browser works it out */
const now = new Date();
const lastClosed = now.getMonth() === 0 ? [now.getFullYear() - 1, 12] : [now.getFullYear(), now.getMonth()];
const mk = (q) => q[0] + "-" + String(q[1]).padStart(2, "0");
const prevOf = (q) => (q[1] === 1 ? [q[0] - 1, 12] : [q[0], q[1] - 1]);
const LAST = mk(lastClosed), PREV = mk(prevOf(lastClosed));
const euros = (s) => Number(String(s).replace(/[^\d-−]/g, "").replace("−", "-"));
const near = (a, b, d = 1) => Math.abs(a - b) <= d;

const browser = await chromium.launch();
async function open(base, path, { width = 1440, height = 900, theme = "light", person = "1", touch = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme, serviceWorkers: "block", hasTouch: touch });
  await ctx.addInitScript((p) => { localStorage.setItem("wally.person", p); localStorage.removeItem("wally.scope"); }, person);
  const page = await ctx.newPage();
  page.errors = [];
  page.on("console", (m) => { if (m.type() === "error") page.errors.push(m.text()); });
  page.on("pageerror", (e) => page.errors.push("PAGEERROR " + e.message + " " + (e.stack || "").split("\n")[1]));
  await page.goto(base + path, { waitUntil: "networkidle" });
  return page;
}
const shot = async (page, name, full) => { if (SHOTS) await page.waitForTimeout(350), await page.screenshot({ path: join(SHOTS, name + ".png"), fullPage: !!full }); };
/* Errors raised inside other pages' modules (reached through links and the command bar) are reported, not counted */
const OTHERS = /\/js\/pages\/(dashboard|transactions|recurring|budgets|settings)/;
const noErrors = (page, what) => {
  const mine = page.errors.filter((e) => !OTHERS.test(e)), theirs = page.errors.filter((e) => OTHERS.test(e));
  if (theirs.length) console.log("  note " + what + ": errors in other pages: " + [...new Set(theirs)].join(" | "));
  ok(mine.length === 0, what + ": no console errors" + (mine.length ? " — " + mine.join(" | ") : ""));
};
const kpi = (page, i) => page.locator(".w-mrev .w-mrk > div").nth(i).locator("b").textContent();

try {
  const base = await startServer(PORT, true);
  console.log("Demo household: " + base + ", last closed month " + LAST);
  const sum = await api(base, `/summary/monthly?from=${PREV}&to=${LAST}`);
  const M = sum.months.find((m) => m.month === LAST);
  const before = await api(base, `/summary/monthly?from=${mk([lastClosed[0] - 1, lastClosed[1]])}&to=${PREV}`);

  /* ---------- the figures against the API ---------- */
  {
    const page = await open(base, "/review");
    await page.waitForSelector(".w-mrev .w-mrk");
    const title = await page.textContent("#mr-title");
    ok(new RegExp(String(lastClosed[0])).test(title), "review: opens on the last closed month (" + title + ")");
    ok(page.url().endsWith("/review"), "review: /review with no month is the last closed one");
    ok(euros(await kpi(page, 0)) === Math.round(M.income / 100), "review: Came in = /summary/monthly income (" + (await kpi(page, 0)) + ")");
    ok(euros(await kpi(page, 1)) === Math.round(M.expense / 100), "review: Went out = /summary/monthly expense");
    ok(euros(await kpi(page, 2)) === Math.round(M.recurring / 100), "review: Bills = /summary/monthly recurring");
    ok(euros(await kpi(page, 3)) === Math.round((M.expense - M.recurring) / 100), "review: Everyday = expense − recurring");
    ok(euros(await page.textContent(".w-mrhero .big")) === Math.round(Math.abs(M.income - M.expense) / 100), "review: Kept = income − expense");
    // Usual: the average of the 6 months before
    const six = before.months.filter((m) => m.month < LAST).slice(-6);
    const usualExp = six.reduce((s, m) => s + m.expense, 0) / six.length / 100;
    const usualText = await page.locator(".w-mrev .w-mrk > div").nth(1).locator("small").textContent();
    ok(near(euros(usualText), Math.round(usualExp)), "review: usual = average of the 6 months before (" + usualText + " vs " + Math.round(usualExp) + ")");
    // Categories
    const rows = await page.$$eval(".w-mrev a.w-mrcr", (l) => l.map((a) => [a.dataset.cat, a.querySelector(":scope > b").textContent]));
    const catOk = rows.every(([c, v]) => M.categories[c] && euros(v) === Math.round(M.categories[c].total / 100));
    ok(rows.length > 3 && catOk, "review: every category total matches the API (" + rows.length + " categories)");
    const firstColor = await page.$eval(".w-mrev a.w-mrcr .bar span", (s) => s.style.background);
    ok(firstColor.includes("--c1"), "review: the biggest category takes the first colour");
    // People: always everyone, each by share
    const cards = page.locator(".w-mrp");
    ok(await cards.count() === 2, "review: the people block shows both people");
    for (const [i, id] of [[0, "1"], [1, "2"]]) {
      const spent = euros(await cards.nth(i).locator(".w-mrtrio > div").nth(1).locator("b").textContent());
      ok(near(spent, M.people[id].expense / 100), "review: person " + id + " spent matches the API by share (" + spent + " vs " + (M.people[id].expense / 100).toFixed(2) + ")");
    }
    const shared = await page.textContent("#mr-shared");
    ok(/shared cost/.test(shared) && !/owed|closed even/.test(shared), "review: shared costs and who paid them, no who-owed-whom (" + shared.slice(0, 90) + "…)");
    await shot(page, "review-1440", true);

    // Scope: every figure but the people block
    await page.click('.w-mrh [data-mrsc="1"]');
    await page.waitForFunction(() => document.querySelector('.w-mrh [data-mrsc="1"]').getAttribute("aria-pressed") === "true");
    ok(near(euros(await kpi(page, 1)), M.people["1"].expense / 100), "scope: Went out becomes Alex’s share");
    ok(await page.locator(".w-mrp").count() === 2 && await page.locator(".w-mrp.dim").count() === 1, "scope: the people block still shows both, the other dimmed");
    ok((await page.textContent(".w-mrhero p")).startsWith("Alex"), "scope: the headline is about Alex");
    await page.click('.w-mrh [data-mrsc="all"]');

    // Arrows through closed months, and the keyboard
    ok(await page.isDisabled("#mr-next"), "arrows: next is off on the last closed month");
    await page.click("#mr-prev");
    await page.waitForFunction((p) => location.search === "?m=" + p, PREV);
    ok(true, "arrows: previous month, in the address");
    await page.locator("body").press("ArrowRight");
    await page.waitForFunction((p) => location.search === "?m=" + p, LAST);
    ok(true, "arrows: → goes forward again");
    // The chart: one bar per month, click to open
    const bars = page.locator("#mr-c12 rect[role=button]");
    ok(await bars.count() >= 6, "chart: a bar per month (" + await bars.count() + ")");
    await bars.nth(0).click();
    await page.waitForFunction((l) => location.search !== "?m=" + l, LAST);
    ok(true, "chart: clicking a month opens it");
    // Out of range months are clamped
    await page.goto(base + "/review?m=2099-01", { waitUntil: "networkidle" });
    ok((await page.textContent("#mr-title")).includes(String(lastClosed[0])), "review: a month not over yet shows the last closed one");
    // Tooltips and links
    await page.hover(".w-mrev a.w-mrcr >> nth=0");
    ok(await page.locator("#tip.on").count() === 1 && (await page.textContent("#tip")).includes("Usual"), "tooltip: a category says spent, last month and usual");
    const cat0 = await page.getAttribute(".w-mrev a.w-mrcr >> nth=0", "data-cat");
    await page.click(".w-mrev a.w-mrcr >> nth=0");
    await page.waitForURL("**/transactions?**");
    ok(page.url().includes("ym=" + LAST) && page.url().includes("cat=" + encodeURIComponent(cat0)), "link: a category opens its transactions for the month");
    await page.goBack();
    await page.waitForSelector(".w-mrev");
    await page.click(".w-mrev [data-mr-close]");
    await page.waitForFunction(() => location.pathname === "/");
    ok(true, "close: back to the Dashboard");
    noErrors(page, "review");
    await page.context().close();
  }

  /* ---------- shown once a month ---------- */
  {
    await api(base, "/me/prefs", "PUT", { reviewed: "2000-01" });
    const page = await open(base, "/");
    await page.waitForFunction((l) => location.search === "?m=" + l, LAST, { timeout: 6000 }).catch(() => {});
    ok(page.url().endsWith("/review?m=" + LAST), "first of month: opening Wally shows the month that closed");
    ok((await api(base, "/me/prefs")).reviewed === LAST, "first of month: remembered for this person");
    await page.goto(base + "/", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    ok(new URL(page.url()).pathname === "/", "first of month: shown once, not again");
    // Another person has not seen it yet
    const ana = await open(base, "/", { person: "2" });
    await ana.waitForTimeout(800);
    ok(new URL(ana.url()).pathname === "/" && (await api(base, "/me/prefs")).reviewed === LAST, "first of month: a person using Wally for the first time is not shown it, only noted");
    await ana.context().close();
    // A link to somewhere else is not interrupted
    await api(base, "/me/prefs", "PUT", { reviewed: "2000-01" });
    await page.goto(base + "/transactions", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    ok(new URL(page.url()).pathname === "/transactions", "first of month: a link to another page is not interrupted");
    await api(base, "/me/prefs", "PUT", { reviewed: LAST });
    noErrors(page, "first of month");
    await page.context().close();
  }

  /* ---------- the phone: four pages ---------- */
  {
    const page = await open(base, "/review", { width: 390, height: 844, touch: true });
    await page.waitForSelector(".w-mrstory");
    ok(await page.locator(".w-mrev").isHidden() && await page.locator('[data-sp="0"]').isVisible(), "phone: the story, page 1");
    ok(await page.locator(".w-tabbar").isHidden(), "phone: full screen, no tab bar");
    await shot(page, "review-phone-1");
    await page.click("#mr-snext");
    ok(await page.locator('[data-sp="1"]').isVisible(), "phone: Tap for more → page 2, where it went");
    await shot(page, "review-phone-2");
    const box = await page.locator("#mr-pages").boundingBox();
    await page.mouse.click(box.x + box.width * 0.8, box.y + 40);
    ok(await page.locator('[data-sp="2"]').isVisible(), "phone: tapping the page goes on → page 3");
    await shot(page, "review-phone-3");
    await page.mouse.click(box.x + box.width * 0.1, box.y + 40);
    ok(await page.locator('[data-sp="1"]').isVisible(), "phone: tapping the start side goes back");
    // A swipe
    await page.evaluate(() => {
      const el = document.getElementById("mr-pages");
      const touch = (x) => new Touch({ identifier: 1, target: el, clientX: x, clientY: 200 });
      el.dispatchEvent(new TouchEvent("touchstart", { touches: [touch(300)], changedTouches: [touch(300)], bubbles: true }));
      el.dispatchEvent(new TouchEvent("touchend", { touches: [], changedTouches: [touch(120)], bubbles: true }));
    });
    ok(await page.locator('[data-sp="2"]').isVisible(), "phone: swiping goes on");
    await page.click("#mr-snext");
    ok(await page.locator('[data-sp="3"]').isVisible() && await page.locator("#mr-snext").isHidden(), "phone: page 4 is the last");
    await shot(page, "review-phone-4");
    await page.click(".w-mrstory [data-mr-prev]");
    ok((await page.textContent(".w-mrstop .w-hint")).length > 0 && page.url().endsWith("?m=" + PREV) && await page.locator('[data-sp="0"]').isVisible(), "phone: the arrows step months, from page 1");
    await page.click(".w-mrstory [data-mr-close]");
    await page.waitForFunction(() => location.pathname === "/");
    ok(true, "phone: close goes to the Dashboard");
    noErrors(page, "phone");
    await page.context().close();
  }

  /* ---------- dark, tablet, Arabic ---------- */
  {
    const page = await open(base, "/review", { width: 900, height: 900, theme: "dark" });
    await page.waitForSelector(".w-mrev .w-mrk");
    const over = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    ok(!over, "tablet: nothing wider than the screen");
    await shot(page, "review-900-dark", true);
    await page.setViewportSize({ width: 1100, height: 900 });
    await shot(page, "review-1100-dark");
    await page.evaluate(() => fetch("/api/language/ar", { method: "PUT", headers: { "X-Wally-Person": "1" } }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector(".w-mrev .w-mrk");
    ok(await page.evaluate(() => document.documentElement.dir) === "rtl", "arabic: right to left");
    await shot(page, "review-ar", true);
    await page.setViewportSize({ width: 390, height: 844 });
    await shot(page, "review-ar-phone");
    await page.evaluate(() => fetch("/api/language/en", { method: "PUT", headers: { "X-Wally-Person": "1" } }));
    noErrors(page, "dark and Arabic");
    await page.context().close();
  }

  /* ---------- the command bar ---------- */
  {
    const page = await open(base, "/");
    await page.waitForSelector("#app:not([hidden])");
    await page.waitForTimeout(300);
    const before = await page.evaluate(() => document.activeElement && document.activeElement.tagName);
    await page.keyboard.press("Control+k");
    await page.waitForSelector("#cmd:not([hidden])");
    ok(await page.evaluate(() => document.activeElement.id) === "cmd-q", "cmd: Ctrl+K opens it, focus in the box");
    ok(await page.getAttribute("#cmd .w-cmd", "aria-modal") === "true" && await page.getAttribute("#cmd-q", "role") === "combobox", "cmd: a modal dialog with a combobox");
    await shot(page, "cmd-open");
    await page.keyboard.press("Escape");
    ok(await page.locator("#cmd").isHidden(), "cmd: Esc closes it");
    ok(await page.evaluate(() => document.activeElement && document.activeElement.tagName) === before, "cmd: focus goes back");
    await page.keyboard.press("Control+k");
    await page.keyboard.press("Control+k");
    ok(await page.locator("#cmd").isHidden(), "cmd: Ctrl+K again closes it");
    // Jump to a page with arrows and Enter
    await page.keyboard.press("Control+k");
    await page.keyboard.type("recur");
    const first = await page.textContent(".w-cmdi.hl .l");
    ok(first === "Recurring", "cmd: typing finds Recurring (" + first + ")");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => location.pathname === "/recurring" && document.getElementById("main").dataset.page === "recurring");
    ok(await page.locator("#cmd").isHidden(), "cmd: Enter jumps to Recurring and closes");
    // A settings pane, down the list with the arrows
    await page.keyboard.press("Control+k");
    await page.keyboard.type("api keys");
    const labels = await page.locator(".w-cmdi .l").allTextContents();
    const idx = labels.indexOf("API keys");
    ok(idx >= 0, "cmd: finds the API keys pane");
    for (let i = 0; i < idx; i++) await page.keyboard.press("ArrowDown");
    ok(await page.getAttribute("#cmd-q", "aria-activedescendant") === "cmd-o" + idx, "cmd: arrows move the highlight (aria-activedescendant)");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => location.pathname === "/settings/keys");
    ok(true, "cmd: Settings › API keys");
    // Month in review
    await page.keyboard.press("Control+k");
    await page.keyboard.type("month in");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => location.pathname === "/review");
    ok(true, "cmd: Month in review");
    // A transaction by name, a rule, a category
    const ledger = await api(base, "/ledger");
    const ni = ledger.columns.indexOf("name"), ii = ledger.columns.indexOf("id");
    const payee = ledger.rows[0][ni];
    await page.keyboard.press("Control+k");
    await page.keyboard.type(payee);
    const groups = await page.locator(".w-cmdg").allTextContents();
    ok(groups.includes("Transactions") && groups.includes("Search"), "cmd: finds transactions by name (" + payee + ")");
    const txIndex = (await page.locator(".w-cmdi .l").allTextContents()).findIndex((l) => l.startsWith(payee + ","));
    await page.locator(".w-cmdi").nth(txIndex).click();
    const picked = await page.waitForFunction(() => location.pathname === "/transactions" && new URLSearchParams(location.search).get("id")).then((h) => h.jsonValue());
    ok(ledger.rows.some((r) => r[ii].replace(/-/g, "") === picked.replace(/-/g, "") && r[ni] === payee), "cmd: the transaction opens selected");
    const rules = await api(base, "/recurring");
    await page.keyboard.press("Control+k");
    await page.keyboard.type(rules[0].name);
    await page.locator(".w-cmdg", { hasText: "Recurring" }).waitFor();
    await page.locator('[role=group]:has(.w-cmdg:text-is("Recurring")) .w-cmdi').first().click();
    await page.waitForFunction(() => location.pathname === "/recurring" && location.search.includes("id="));
    ok(true, "cmd: a rule opens in Recurring (" + rules[0].name + ")");
    // Show only one person, hide amounts
    await page.keyboard.press("Control+k");
    await page.keyboard.type("only ana");
    await page.keyboard.press("Enter");
    ok(await page.evaluate(() => localStorage.getItem("wally.scope")) === "2", "cmd: Show only Ana");
    await page.keyboard.press("Control+k");
    await page.keyboard.type("hide am");
    await page.keyboard.press("Enter");
    ok(await page.evaluate(() => document.documentElement.classList.contains("w-hide")), "cmd: Hide amounts");
    await page.keyboard.press("Control+k");
    await page.keyboard.type("show am");
    await page.keyboard.press("Enter");
    ok(!(await page.evaluate(() => document.documentElement.classList.contains("w-hide"))), "cmd: Show amounts");
    await page.keyboard.press("Control+k");
    await page.keyboard.type("everyone");
    await page.keyboard.press("Enter");
    // Nothing found
    await page.keyboard.press("Control+k");
    await page.keyboard.type("§");
    ok((await page.textContent("#cmd-res")).includes("Nothing found"), "cmd: nothing found says what to try");
    // Tab stays inside
    for (let i = 0; i < 4; i++) await page.keyboard.press("Tab");
    ok(await page.evaluate(() => document.getElementById("cmd").contains(document.activeElement)), "cmd: Tab stays inside");
    await page.click("#cmd", { position: { x: 10, y: 10 } });
    ok(await page.locator("#cmd").isHidden(), "cmd: a click outside closes it");
    // Quick add: "12 coffee ana"
    const coffee = ledger.rows.find((r) => r[ni] && /caf|coffee/i.test(r[ni]));
    const word = coffee ? coffee[ni].split(/\s+/)[0].toLowerCase() : "coffee";
    await page.keyboard.press("Control+k");
    await page.keyboard.type("12 " + word + " ana");
    const add = await page.textContent(".w-cmdi.hl .l");
    ok(/^Add 12[.,]00/.test(add) && add.endsWith("for Ana"), "cmd: quick add reads amount, payee and person (" + add + ")");
    await shot(page, "cmd-quickadd");
    await page.keyboard.press("Enter");
    await page.waitForSelector("#add-modal:not([hidden])");
    const amt = await page.inputValue("#add-amt").catch(() => "");
    ok(/^12/.test(amt), "cmd: the add sheet opens with the amount (" + amt + ")");
    await page.keyboard.press("Escape");
    // Phone width
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    if (!(await page.locator("#add-modal").isHidden())) { await page.keyboard.press("Escape"); const d = page.locator("[data-dlg-ok]"); if (await d.count()) await d.click(); }
    await page.keyboard.press("Control+k");
    await page.waitForSelector("#cmd:not([hidden])");
    const w = await page.$eval("#cmd .w-cmd", (e) => e.getBoundingClientRect().width);
    ok(w > 360, "cmd: full width on a phone");
    await shot(page, "cmd-phone");
    await page.click("[data-cmd-x]");
    ok(await page.locator("#cmd").isHidden(), "cmd: the Esc key cap closes it on touch");
    noErrors(page, "command bar");
    await page.context().close();
  }

  /* ---------- nothing to review yet ---------- */
  {
    const empty = await startServer(PORT + 1, false);
    await api(empty, "/people", "POST", { name: "Sam" });
    await api(empty, "/config", "PUT", { onboarded: true });
    const page = await open(empty, "/review");
    await page.waitForSelector(".w-mrempty");
    ok((await page.textContent(".w-mrempty")).includes("No month to review yet"), "empty: no month to review yet");
    await page.waitForTimeout(400);
    ok(new URL(page.url()).pathname === "/review", "empty: the first-of-month check does nothing");
    await shot(page, "review-empty");
    await page.keyboard.press("Control+k");
    await page.keyboard.type("12 bread");
    ok((await page.textContent(".w-cmdi.hl small")).includes("Pick a category"), "empty: quick add with nothing to learn from asks for a category next");
    noErrors(page, "empty");
    await page.context().close();
  }
} catch (e) {
  failures++;
  console.log("  FAIL " + (e.stack || e.message));
} finally {
  await browser.close();
  servers.forEach((p) => p.kill());
}
console.log(failures ? failures + " failed" : "all passed");
process.exit(failures ? 1 : 0);
