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
  for (const path of ["/transactions", "/recurring", "/budgets", "/settings/people", "/review", "/"]) {
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
    ok(page.url().includes("cat=" + encodeURIComponent(name)), "a category on the Dashboard opens Transactions filtered to " + name);
    const cats = await page.locator("#main .w-row .tx-rm p").allTextContents();
    ok(cats.length > 0 && cats.every((c) => c.includes(name)), "every row shown is " + name);
  } else ok(false, "Dashboard has category links");

  // Budgets → Transactions for that category this month
  await page.goto(BASE + "/budgets", { waitUntil: "networkidle" });
  const brow = page.locator('.w-brow[href*="cat=Groceries"]');
  await brow.click();
  await page.waitForURL(/\/transactions\?/);
  await page.waitForTimeout(300);
  const rows = await page.locator("#main .w-row .tx-rm p").allTextContents();
  ok(rows.length > 0 && rows.every((c) => c.includes("Groceries")), "a budget row opens this month's Groceries (" + rows.length + " rows)");

  // Adding from the Dashboard changes its figures at once
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  const before = money(await page.locator("#main .w-big").first().textContent());
  await page.keyboard.press("n");
  await page.waitForSelector("#add-modal:not([hidden])");
  await page.keyboard.type("100");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Journey test");
  await page.locator('#add-modal [role="radiogroup"] [role="radio"]').first().click().catch(() => {});
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
  await page.waitForSelector("#add-modal", { state: "hidden" });
  await page.waitForTimeout(400);
  const after = money(await page.locator("#main .w-big").first().textContent());
  ok(Math.abs(after - before - 100) < 0.01 || Math.abs(after - before - 50) < 0.01, `Spent so far moved from ${before} to ${after}`);
  await page.goto(BASE + "/transactions?q=Journey", { waitUntil: "networkidle" });
  ok((await page.locator("#main .w-row").count()) >= 1, "the new expense is found by search");

  // Month in review → the Dashboard on that month
  await page.goto(BASE + "/review", { waitUntil: "networkidle" });
  const toDash = page.locator('a[href^="/?ym="]').first();
  if (await toDash.count()) {
    const href = await toDash.getAttribute("href");
    await toDash.click();
    await page.waitForTimeout(500);
    const ym = href.match(/ym=(\d{4})-(\d\d)/);
    const title = await page.locator("#main h3").first().textContent();
    ok(title.includes(ym[1]), `Month in review opens the Dashboard on ${ym[1]}-${ym[2]} (${title.trim()})`);
  } else ok(false, "Month in review links to the Dashboard");

  ok(errors.length === 0, "no errors on desktop " + errors.slice(0, 2).join(" | "));
  await ctx.close();
}

{
  console.log("Phone journeys");
  const { ctx, page, errors } = await open(390, 844);
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  ok(await page.locator("#tabbar").isVisible(), "the tab bar shows on a phone");
  ok(!(await page.locator("#side").isVisible()), "the sidebar is hidden");
  for (const href of ["/transactions", "/recurring", "/settings", "/"]) {
    await page.click(`#tabbar a[href="${href}"]`);
    await page.waitForTimeout(300);
    ok((await page.locator(`#tabbar a[href="${href}"]`).getAttribute("aria-current")) === "page", "tab " + href + " is current");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    ok(overflow <= 0, "no sideways scroll on " + href);
  }
  await page.click("#tabbar .w-tabadd");
  ok(await page.locator("#add-modal").isVisible(), "Add in the tab bar opens the sheet");
  ok(errors.length === 0, "no errors on a phone " + errors.slice(0, 2).join(" | "));
  await ctx.close();
}

await browser.close();
console.log(failed ? failed + " failed" : "all passed");
process.exit(failed ? 1 : 0);
