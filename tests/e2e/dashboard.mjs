/* Dashboard, in a real browser against a fresh demo server.
     BASE=http://localhost:8801 node dashboard.mjs
   The server must be a fresh DEMO=true one: the last scenarios remove a person and then every
   transaction, to check the one-person and empty households. Exits non-zero on any failure,
   console error or page error. SHOTS=<folder> saves a screenshot per scenario. */
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE || "http://localhost:8801";
const SHOTS = process.env.SHOTS || "";
if (SHOTS && !existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log("  ok   " + msg); else { failures++; console.log("  FAIL " + msg); } };
const pad = (n) => String(n).padStart(2, "0");
const now = new Date();
const [CY, CM] = [now.getFullYear(), now.getMonth() + 1];
const ymAdd = (y, m, k) => { const t = y * 12 + m - 1 + k; return [Math.floor(t / 12), (t % 12) + 1]; };
const ymStr = (y, m) => y + "-" + pad(m);
const MONTH = (m) => new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" }).format(Date.UTC(2026, m - 1, 15));
const H = { "X-Wally-Person": "1", "Content-Type": "application/json" };
const api = async (method, path, body) => {
  const r = await fetch(BASE + "/api" + path, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  return text ? JSON.parse(text) : null;
};

const browser = await chromium.launch();
const errors = [];
async function open(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: opts.w || 1440, height: opts.h || 900 }, colorScheme: opts.dark ? "dark" : "light", serviceWorkers: "block", hasTouch: (opts.w || 1440) < 768 });
  await ctx.addInitScript(() => {
    localStorage.setItem("wally.person", "1");
    if (!sessionStorage.getItem("dash-test")) { localStorage.removeItem("wally.dash.range"); sessionStorage.setItem("dash-test", "1"); }
  });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message + " " + (e.stack || "").split("\n").slice(1, 3).join(" ")));
  // Remember every navigation, since the page we land on may tidy its own address
  await page.addInitScript(() => {
    window.__nav = [];
    const push = history.pushState;
    history.pushState = function (s, title, url) { window.__nav.push(String(url)); return push.apply(this, arguments); };
  });
  await page.goto(BASE + (opts.path || "/"), { waitUntil: "networkidle" });
  await page.waitForSelector(opts.wait || "#main[data-page=dashboard] > *");
  await page.waitForTimeout(300);
  return page;
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: SHOTS + "/" + name + ".png" }); };
const text = (page, sel) => page.locator(sel).first().innerText();
const pressed = (page, sel) => page.locator(sel).first().getAttribute("aria-pressed");
const path = async (page) => { const n = await page.evaluate(() => window.__nav[window.__nav.length - 1] || location.pathname + location.search); return n; };
async function backToDash(page) { await page.goBack(); await page.waitForSelector("#d-title"); await page.waitForTimeout(150); }
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

try {
  /* ---------- reset prefs, so the defaults show ---------- */
  await api("PUT", "/me/prefs", { widgets: null, cmp: "last" });

  console.log("Opening");
  let page = await open();
  ok((await text(page, "#d-title")).includes(MONTH(CM)), "opens on the current month");
  ok((await pressed(page, '[data-mode="month"]')) === "true", "Month is pressed");
  ok(await page.locator("#h-status").count() === 0, "no status bar");
  ok(await page.locator("#h-kpis .w-kpi").count() === 3, "three key figures: income, kept, savings rate");
  ok(!(await text(page, "#h-kpis")).includes("Spending") && !(await text(page, "#main")).includes("Safe to spend"), "no repeated spending, no Safe to spend");
  ok(await page.locator("#c-hero svg path").count() > 2, "Spent so far chart drawn");
  const widgets = await page.locator("#main [data-w]").evaluateAll((n) => [...new Set(n.map((x) => x.dataset.w))].join(","));
  ok(widgets === "hero,cats,recent,kept,upcoming", "the fixed widgets, in order: " + widgets);
  ok(await page.locator("#d-cust").count() === 0 && await page.locator("[data-d-cmd]").count() === 0 && await page.locator("#h-table,#h-cmp,[data-cmp]").count() === 0, "no Customize, search, Table or compare buttons");
  ok((await text(page, "#h-legend")).includes(MONTH(ymAdd(CY, CM, -1)[1])), "the dashed line is always last month");
  await shot(page, "01-month");

  console.log("Ranges, keys and arrows");
  ok((await page.locator("#d-range button").allInnerTexts()).join("|") === "Month|Year|Custom…", "Month, Year and Custom only");
  await page.click('[data-mode="year"]');
  ok((await text(page, "#d-title")).includes(String(CY)), "Year by click");
  ok(await page.locator("#h-kpis .w-kpi").count() === 4 && (await text(page, "#h-kpis")).includes("Kept per month"), "Year: Kept per month figure");
  ok((await text(page, "#h-eye")).startsWith("Spent so far in"), "Year opens on Spent so far");
  ok((await text(page, "#h-delta")).includes("same days of " + (CY - 1)), "Year compares with the same days last year");
  ok((await text(page, "#h-legend")).includes("Projected"), "Year projects to 31 December");
  await page.locator("body").press("1");
  ok((await pressed(page, '[data-mode="month"]')) === "true", "key 1 back to Month");
  await page.locator("body").press("2");
  ok((await pressed(page, '[data-mode="year"]')) === "true", "key 2 picks Year");
  await page.locator("body").press("1");
  ok(await page.locator("#d-next").isDisabled(), "next month disabled on the current month");
  await page.click("#d-prev");
  const [py, pm] = ymAdd(CY, CM, -1);
  ok((await text(page, "#d-title")).includes(MONTH(pm)), "previous month by arrow");
  ok(await page.locator("#h-kpis .w-kpi").count() === 3, "a closed month has three figures");
  await page.locator("body").press("ArrowRight");
  ok((await text(page, "#d-title")).includes(MONTH(CM)), "→ steps forward");
  await page.locator("body").press("ArrowLeft");
  ok((await text(page, "#d-title")).includes(MONTH(pm)), "← steps back");
  await page.click("#d-next");

  console.log("Custom range");
  await page.click('[data-mode="custom"]');
  ok(await page.locator(".d-rng").isVisible(), "Custom opens the two-month picker");
  ok(await page.locator(".d-rng .w-mon").count() === 2, "two months side by side");
  await page.click('.d-rng [data-pr="1"]'); // Last month
  await page.click("[data-dlg-ok]");
  ok((await pressed(page, '[data-mode="month"]')) === "true" && (await text(page, "#d-title")).includes(MONTH(pm)), "preset Last month becomes Month mode");
  await page.locator("body").press("1");
  await page.locator("body").press("3");
  const a = ymStr(py, pm) + "-05", b = ymStr(CY, CM) + "-03";
  await page.click('.d-rng [data-d="' + a + '"]');
  ok(await page.locator("[data-dlg-ok]").isDisabled(), "Apply waits for the last day");
  await page.click('.d-rng [data-d="' + b + '"]');
  ok((await text(page, ".d-rngsum")).includes("days"), "summary shows the number of days");
  await shot(page, "02-picker");
  await page.click("[data-dlg-ok]");
  ok((await pressed(page, '[data-mode="custom"]')) === "true" && (await text(page, '[data-mode="custom"]')).startsWith("Custom:"), "custom range applied");
  ok(await page.locator("#h-view").isHidden(), "a short custom range has no pills");
  await page.locator("body").press("3");
  await page.keyboard.press("Escape");
  ok(await page.locator("#dlg").isHidden(), "Esc closes the picker");
  await page.reload({ waitUntil: "networkidle" }); await page.waitForSelector("#d-title");
  ok((await pressed(page, '[data-mode="custom"]')) === "true", "the range is remembered after a reload");
  await page.click('[data-mode="custom"]');
  await page.click(".d-rng [data-pr]:last-child");
  await page.click("[data-dlg-ok]");
  ok(!(await page.locator("#h-view").isHidden()), "All time shows the pills");
  ok(await page.locator("#c-kept [data-go-month]").count() > 12, "All time: Kept each month shows every month (" + await page.locator("#c-kept [data-go-month]").count() + ")");

  console.log("Pills and legend");
  await page.click('[data-mode="year"]');
  ok((await page.locator("#h-view button").allInnerTexts()).join("|") === "Spent so far|Income vs spending|By category", "three chart views");
  await page.click('[data-hv="ivs"]');
  ok((await text(page, "#h-legend")).includes("Income") && await page.locator("#c-hero svg path").count() > 4, "Income vs spending bars");
  await page.click('[data-hv="cats"]');
  const lg = page.locator("#h-legend [data-lg]");
  ok(await lg.count() > 2, "By category legend lists categories");
  const firstCat = await lg.first().innerText();
  await lg.first().click();
  ok((await pressed(page, "#h-legend [data-lg]")) === "false", "legend hides " + firstCat);
  await page.locator("#h-legend [data-lg]").first().click();
  ok((await pressed(page, "#h-legend [data-lg]")) === "true", "and shows it again");
  await page.click('[data-hv="pace"]');
  ok((await text(page, "#h-eye")).startsWith("Spent so far"), "back to Spent so far");
  await page.locator("body").press("1");

  console.log("Tooltips");
  const box = await page.locator("#c-hero svg").boundingBox();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5);
  ok(await page.locator("#tip.on").count() === 1 && (await text(page, "#tip")).includes("Difference"), "hero chart tooltip with difference");
  await page.locator("#cats [data-k]").first().focus();
  ok((await text(page, "#tip")).includes("Share"), "a category row has a tooltip on focus");
  await page.mouse.move(5, 5);
  // A day on the chart that spent something opens its transactions
  let dayX = null;
  for (let fr = 0.1; fr < 0.75 && dayX === null; fr += 0.03) {
    await page.mouse.move(box.x + box.width * fr, box.y + box.height * 0.5);
    if ((await text(page, "#tip")).includes("Click to see its transactions")) dayX = box.x + box.width * fr;
  }
  ok(dayX !== null && (await text(page, "#tip")).includes("That day"), "a past day's tooltip shows what was spent that day");
  await page.mouse.click(dayX, box.y + box.height * 0.5);
  await page.waitForURL(/\/transactions\?view=cal&day=\d{4}-\d\d-\d\d/);
  ok(true, "clicking it opens that day in Transactions: " + new URL(page.url()).search);
  await page.goBack();
  await page.waitForSelector("#c-hero svg");
  await page.mouse.move(5, 5);

  console.log("Person switch");
  const allBig = await text(page, "#h-big");
  await page.click('#side [data-scope="2"]');
  await page.waitForTimeout(500);
  const anaBig = await text(page, "#h-big");
  ok(allBig !== anaBig, "Ana's figures differ from everyone's (" + allBig + " → " + anaBig + ")");
  await page.click('#side [data-scope="all"]');
  await page.waitForTimeout(500);

  console.log("Kept each month");
  ok(await page.locator("#c-kept [data-go-month]").count() === 12, "twelve months up to this one");
  ok((await text(page, "#kept-avg")).startsWith("Average"), "the average is named: " + await text(page, "#kept-avg"));
  await page.locator("#c-kept [data-go-month]").nth(9).hover();
  ok((await text(page, "#tip")).includes("Came in") && (await text(page, "#tip")).includes("Went out"), "a bar explains its month");
  await page.locator("#c-kept [data-go-month]").nth(9).click();
  await page.waitForTimeout(300);
  ok((await text(page, "#d-title")).includes(MONTH(ymAdd(CY, CM, -2)[1])), "a bar opens its month: " + await text(page, "#d-title"));
  await page.locator("body").press("1");

  console.log("Click-throughs");
  const go = async (sel, re, name) => {
    await page.locator(sel).first().click();
    await page.waitForTimeout(250);
    const at = await path(page);
    ok(re.test(at), name + ": " + at);
    await backToDash(page);
  };
  await go("#cats [data-go-cat]", new RegExp("^/transactions\\?cat=[^&]+&mode=month&ym=" + ymStr(CY, CM) + "$"), "category keeps Month");
  await go("#recent [data-go-id]", /^\/transactions\?id=[0-9a-f-]{36}$/, "recent opens the transaction");
  await go("#upcoming [data-go-rule]", /^\/recurring\?id=/, "coming up opens the rule");
  await page.click('[data-mode="year"]');
  await go("#cats [data-go-cat]", /&mode=year$/, "category keeps Year");
  await page.click('[data-mode="custom"]');
  await page.click('.d-rng [data-d="' + a + '"]'); await page.click('.d-rng [data-d="' + b + '"]'); await page.click("[data-dlg-ok]");
  await go("#cats [data-go-cat]", new RegExp("&mode=custom&from=" + a + "&to=" + b + "$"), "category keeps Custom");
  await page.locator("body").press("1");
  await page.click(".d-head [data-review]");
  await page.waitForTimeout(250);
  ok(await path(page) === "/review", "header › Month in review");
  await backToDash(page);
  ok(await page.locator("#main [data-settle]").count() === 0 && !(await text(page, "#main")).includes("owes"), "no Settle up and no who-owes-whom");
  await page.close();

  console.log("Dark mode and widths");
  for (const [w, dark] of [[1440, true], [1100, false], [900, true], [390, false]]) {
    const p = await open({ w, dark });
    ok(await noOverflow(p), w + " px" + (dark ? " dark" : "") + ": no sideways scroll");
    if (dark) ok(await p.evaluate(() => getComputedStyle(document.querySelector(".w-panel")).backgroundColor) !== "rgb(255, 255, 255)", w + " px: dark panels");
    await shot(p, "06-" + w + (dark ? "-dark" : ""));
    if (w === 390) {
      ok(await p.locator("#d-prange").isVisible() && await p.locator(".d-mh .w-pswitch").isVisible() && await p.locator(".w-pchips").count() === 0, "phone: range title, person switch top right, no chips row");
      ok(/less|more/.test(await text(p, "#ph-line")) && !(await text(p, "#main")).includes("Safe to spend"), "phone: compared with last month, no Safe to spend");
      ok(await p.locator("#ph-bud").count() === 0, "phone: no Budgets card");
      ok(await p.locator("#ph-shared,#d-cust,[data-w=unusual]").count() === 0, "phone: no shared costs card, Customize or Unusual");
      ok(await p.locator("#c-kept svg").count() === 1, "phone: Kept each month drawn");
      await p.click("#d-prange");
      ok((await p.locator("[data-pick]").allInnerTexts()).join("|").replace(/✓/g, "").replace(/\s+\|/g, "|").trim() !== "", "phone: range sheet opens");
      await p.click('[data-pick="last"]');
      ok((await text(p, "#d-prange")).includes(MONTH(pm)), "phone: range sheet picks last month");
      await p.click(".w-pswitch-b");
      ok(await p.locator(".w-pswitch-m").isVisible(), "phone: the switch opens a menu");
      await p.click('.w-pswitch-m [data-scope="1"]');
      await p.waitForTimeout(300);
      ok((await p.getAttribute('.w-pswitch-m [data-scope="1"]', "aria-pressed")) === "true" && await p.locator(".w-pswitch-m").isHidden(), "phone: picking a person shows them and closes the menu");
      await p.click(".w-pswitch-b");
      await p.click('.w-pswitch-m [data-scope="all"]');
    }
    await p.close();
  }

  console.log("Arabic");
  await api("PUT", "/language/ar");
  page = await open();
  ok(await page.evaluate(() => document.documentElement.dir) === "rtl", "right to left");
  ok(await noOverflow(page), "no sideways scroll in Arabic");
  await shot(page, "07-ar");
  await page.close();
  await api("PUT", "/language/en");

  console.log("One person");
  await api("DELETE", "/people/2", { move_to: 1 });
  page = await open();
  ok(await page.locator("#side .w-scope").count() === 0 && await page.locator("#c-kept svg").count() === 1, "one person: no Showing switch, the Dashboard as usual");
  await shot(page, "08-one");
  await page.close();

  console.log("Empty household");
  const led = await api("GET", "/ledger");
  await api("POST", "/transactions/bulk", { ids: led.rows.map((r) => r[0]), action: "delete" });
  page = await open({ wait: ".d-welcome" });
  ok((await text(page, ".d-welcome")).includes("Nothing here yet"), "empty dashboard explains what to do");
  ok(await page.locator(".d-welcome [data-open-add]").count() === 1, "with Add expense");
  await page.locator("body").press("2");
  ok(await page.locator(".d-welcome").isVisible(), "range keys do nothing on an empty dashboard");
  await shot(page, "09-empty");
  const p2 = await open({ w: 390, wait: ".d-welcome" });
  ok(await noOverflow(p2), "empty dashboard on a phone");
  await p2.close();
  await page.close();
} catch (e) {
  failures++;
  console.log("  FAIL " + (e && e.stack || e));
}

await browser.close();
const real = errors.filter((e) => !/favicon/.test(e));
real.forEach((e) => console.log("  console: " + e));
ok(!real.length, "no console or page errors");
console.log(failures ? failures + " failed" : "all passed");
process.exit(failures ? 1 : 0);
