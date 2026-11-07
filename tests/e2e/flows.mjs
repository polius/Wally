// Journeys across pages: links between them, figures that follow a change, keys after every page.
// BASE=http://localhost:8891 node flows.mjs   (a fresh DEMO server)
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:8891";
let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "  ok   " : "  FAIL ") + msg); if (!cond) failed++; };
const money = (s) => Number(String(s).replace(/[^\d.,-]/g, "").replace(/,/g, ""));

const browser = await chromium.launch();
async function open(width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block" });
  await ctx.addInitScript(() => localStorage.setItem("wally.person", "1"));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  return { ctx, page, errors };
}

{
  console.log("Desktop journeys");
  const { ctx, page, errors } = await open(1440, 900);
  await page.goto(BASE + "/", { waitUntil: "networkidle" });

  // Every page, then keys on each: nothing a page leaves behind may break another
  for (const path of ["/transactions", "/recurring", "/settings/people", "/review", "/"]) {
    await page.click(`#side a[href="${path === "/review" ? "/" : path.replace(/\/people$/, "")}"]`).catch(() => page.goto(BASE + path));
    if (path === "/review") await page.goto(BASE + path, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    for (const key of ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "1", "2", "Escape"]) await page.keyboard.press(key);
  }
  ok(errors.length === 0, "visiting every page and pressing keys leaves no errors " + errors.slice(0, 2).join(" | "));

  // Dashboard category → Transactions filtered to it, same range
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  const catLink = page.locator('[data-w="cats"] [data-go-cat]').first();
  if (await catLink.count()) {
    const name = await catLink.getAttribute("data-go-cat");
    await catLink.click();
    await page.waitForURL(/\/transactions\?/);
    ok(page.url().includes("cat=" + encodeURIComponent(name)), "a category on Summary opens Transactions filtered to " + name);
    const cats = await page.locator("#main .w-row .tx-rm p").allTextContents();
    ok(cats.length > 0 && cats.every((c) => c.includes(name)), "every row shown is " + name);
  } else ok(false, "Summary has category links");

  // Budgets are gone: the old address falls back to the Dashboard
  await page.goto(BASE + "/budgets", { waitUntil: "networkidle" });
  ok(await page.locator("#main").getAttribute("data-page") === "dashboard" && await page.locator('#side a[href="/budgets"]').count() === 0, "/budgets opens Summary, and nothing links to it");

  // Adding from the Dashboard changes its figures at once
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  const before = money(await page.locator("#s-big").textContent());
  await page.keyboard.press("n");
  await page.waitForSelector("#add-modal:not([hidden])");
  await page.keyboard.type("100");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Journey test");
  await page.click("#add-cat");
  await page.keyboard.press("Enter");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
  await page.waitForSelector("#add-modal", { state: "hidden" });
  await page.waitForTimeout(400);
  const after = money(await page.locator("#s-big").textContent());
  // Summary rounds to whole amounts, so a euro either way
  ok(Math.abs(after - before - 100) <= 1 || Math.abs(after - before - 50) <= 1, `Spent so far moved from ${before} to ${after}`);
  await page.goto(BASE + "/transactions?q=Journey", { waitUntil: "networkidle" });
  ok((await page.locator("#main .w-row").count()) >= 1, "the new expense is found by search");

  // Month in review → Summary on that month
  await page.goto(BASE + "/review", { waitUntil: "networkidle" });
  const toDash = page.locator('a[href^="/?month="]').first();
  if (await toDash.count()) {
    const href = await toDash.getAttribute("href");
    await toDash.click();
    await page.waitForTimeout(500);
    const ym = href.match(/month=(\d{4})-(\d\d)/);
    const title = await page.locator("#s-title").textContent();
    const name = new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" }).format(Date.UTC(+ym[1], +ym[2] - 1, 15));
    ok(title.startsWith(name), `Month in review opens Summary on ${ym[1]}-${ym[2]} (${title.trim()})`);
  } else ok(false, "Month in review links to Summary");

  ok(errors.length === 0, "no errors on desktop " + errors.slice(0, 2).join(" | "));
  await ctx.close();
}

{
  console.log("Phone journeys");
  const { ctx, page, errors } = await open(390, 844);
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  ok(await page.locator("#tabbar").isVisible(), "the tab bar shows on a phone");
  ok(!(await page.locator("#side").isVisible()), "the sidebar is hidden");
  ok(await page.locator("#tabbar .w-tabpill a").count() === 4, "four tabs: Summary, Transactions, Recurring, Settings");
  for (const href of ["/transactions", "/recurring", "/settings", "/"]) {
    await page.click(`#tabbar a[href="${href}"]`);
    await page.waitForTimeout(300);
    ok((await page.locator(`#tabbar a[href="${href}"]`).getAttribute("aria-current")) === "page", "tab " + href + " is current");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    ok(overflow <= 0, "no sideways scroll on " + href);
  }
  // Without the sidebar, the person menu is where you switch person (or sign out)
  await page.click(".w-pswitch-b");
  ok(await page.locator(".w-pswitch-m [data-switch]").isVisible(), "the person menu offers Switch person");
  await page.keyboard.press("Escape");
  const add = await page.locator("#tabbar .w-tabadd").boundingBox();
  ok(add.x >= 0 && add.x + add.width <= 390 && add.y + add.height <= 844, "the ＋ button is whole on screen");
  await page.click("#tabbar .w-tabadd");
  ok(await page.locator("#add-modal").isVisible(), "Add in the tab bar opens the sheet");
  ok(errors.length === 0, "no errors on a phone " + errors.slice(0, 2).join(" | "));
  await ctx.close();
}

await browser.close();
console.log(failed ? failed + " failed" : "all passed");
process.exit(failed ? 1 : 0);
