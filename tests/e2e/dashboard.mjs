/* Dashboard and settle up, in a real browser against a fresh demo server.
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
  ok(await page.locator("#h-status .w-spill").count() === 1, "status headline shows a pill");
  ok(/On track|Watch|Over/.test(await text(page, "#h-status .w-spill")), "status is On track, Watch or Over");
  ok(await page.locator("#h-kpis .w-kpi").count() === 5, "five key figures this month");
  ok((await text(page, "#kpi-safe")).includes("Safe to spend"), "the fifth figure is Safe to spend");
  ok(await page.locator("#c-hero svg path").count() > 2, "Spent so far chart drawn");
  const visible = async (k) => page.locator('[data-w="' + k + '"]').first().isVisible().catch(() => false);
  ok(await visible("cats") && await visible("upcoming") && await visible("savings") && await visible("unusual") && await visible("recent"), "default six widgets visible");
  ok(!(await visible("flow")) && !(await visible("people")) && !(await visible("cal")), "the others are hidden by default");
  await shot(page, "01-month");

  console.log("Budget-aware status");
  const budgets = await api("GET", "/budgets");
  ok(budgets.length > 0, "demo has budgets");
  const status = await text(page, "#h-status p");
  ok(/over budget|over at this pace|You can spend|Spending has run/.test(status), "status sentence: " + status.slice(0, 80));

  console.log("Ranges, keys and arrows");
  for (const [mode, key, expect] of [["3m", "2", "Last 3 months"], ["year", "3", String(CY)], ["12m", "4", "Last 12 months"]]) {
    await page.click('[data-mode="' + mode + '"]');
    ok((await text(page, "#d-title")).includes(expect), mode + " by click: " + expect);
    ok(await page.locator("#h-kpis .w-kpi").count() === 5 && (await text(page, "#h-kpis .w-kpi.safe")).includes("Kept per month"), mode + ": Kept per month figure");
    ok((await text(page, "#h-eye")).startsWith("Spent so far in"), mode + ": opens on Spent so far");
    await page.click('[data-mode="month"]');
    await page.locator("body").press(key);
    ok((await pressed(page, '[data-mode="' + mode + '"]')) === "true", mode + " by key " + key);
  }
  await page.click('[data-mode="year"]');
  ok((await text(page, "#h-delta")).includes("same days of " + (CY - 1)), "Year compares with the same days last year");
  ok((await text(page, "#h-legend")).includes("Projected"), "Year projects to 31 December");
  await page.locator("body").press("1");
  ok((await pressed(page, '[data-mode="month"]')) === "true", "key 1 back to Month");
  ok(await page.locator("#d-next").isDisabled(), "next month disabled on the current month");
  await page.click("#d-prev");
  const [py, pm] = ymAdd(CY, CM, -1);
  ok((await text(page, "#d-title")).includes(MONTH(pm)), "previous month by arrow");
  ok((await text(page, "#h-status .w-spill")).match(/Kept|Overspent/), "a closed month says Kept or Overspent");
  ok(await page.locator("#h-kpis .w-kpi").count() === 4, "a closed month has four figures");
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
  await page.locator("body").press("5");
  const a = ymStr(py, pm) + "-05", b = ymStr(CY, CM) + "-03";
  await page.click('.d-rng [data-d="' + a + '"]');
  ok(await page.locator("[data-dlg-ok]").isDisabled(), "Apply waits for the last day");
  await page.click('.d-rng [data-d="' + b + '"]');
  ok((await text(page, ".d-rngsum")).includes("days"), "summary shows the number of days");
  await shot(page, "02-picker");
  await page.click("[data-dlg-ok]");
  ok((await pressed(page, '[data-mode="custom"]')) === "true" && (await text(page, '[data-mode="custom"]')).startsWith("Custom:"), "custom range applied");
  ok(await page.locator("#h-view").isHidden(), "a short custom range has no pills");
  await page.locator("body").press("5");
  await page.keyboard.press("Escape");
  ok(await page.locator("#dlg").isHidden(), "Esc closes the picker");
  await page.reload({ waitUntil: "networkidle" }); await page.waitForSelector("#d-title");
  ok((await pressed(page, '[data-mode="custom"]')) === "true", "the range is remembered after a reload");
  await page.click('[data-mode="custom"]');
  await page.click(".d-rng [data-pr]:last-child");
  await page.click("[data-dlg-ok]");
  ok(!(await page.locator("#h-view").isHidden()), "All time shows the pills");

  console.log("Pills, legend and table");
  await page.click('[data-mode="year"]');
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
  await page.click('[data-hv="lines"]');
  ok(await page.locator("#c-hero svg circle").count() > 5, "Category lines draws lines with points");
  await page.click("#h-table");
  ok(await page.locator("#h-tview table tbody tr").count() > 3 && (await pressed(page, "#h-table")) === "true", "Table view of the chart");
  await shot(page, "03-table");
  await page.click("#h-table");
  ok(await page.locator("#h-tview").isHidden() && await page.locator("#c-hero svg").count() === 1, "back to the chart");
  await page.click('[data-hv="pace"]');
  ok((await text(page, "#h-eye")).startsWith("Spent so far"), "back to Spent so far");

  console.log("Compare");
  await page.locator("body").press("1");
  await page.click('[data-cmp="avg3"]');
  ok((await text(page, "#h-legend")).includes("3-month average") && (await text(page, "#h-delta")).includes("3-month average"), "vs 3-month average");
  await page.waitForTimeout(300);
  ok((await api("GET", "/me/prefs")).cmp === "avg3", "compare choice saved per person");
  await page.click('[data-cmp="last"]');
  ok((await text(page, "#h-legend")).includes(MONTH(pm)), "vs last month");

  console.log("Tooltips");
  const box = await page.locator("#c-hero svg").boundingBox();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5);
  ok(await page.locator("#tip.on").count() === 1 && (await text(page, "#tip")).includes("Difference"), "hero chart tooltip with difference");
  await page.locator("#kpi-safe").hover();
  ok((await text(page, "#tip")).includes("Free to spend"), "Safe to spend explains itself");
  await page.locator("#cats [data-k]").first().focus();
  ok((await text(page, "#tip")).includes("Share"), "a category row has a tooltip on focus");
  await page.mouse.move(5, 5);

  console.log("Person switch");
  const allBig = await text(page, "#h-big");
  await page.click('#side [data-scope="2"]');
  await page.waitForTimeout(500);
  const anaBig = await text(page, "#h-big");
  ok(allBig !== anaBig, "Ana's figures differ from everyone's (" + allBig + " → " + anaBig + ")");
  await page.click('#side [data-scope="all"]');
  await page.waitForTimeout(500);

  console.log("Customize");
  await page.click("#d-cust");
  ok(await page.locator("#d-custpop").isVisible() && (await page.getAttribute("#d-cust", "aria-expanded")) === "true", "Customize opens");
  ok(await page.locator("#d-custpop [data-cw]").count() === 13, "13 widgets with two people");
  await page.uncheck('[data-cw="unusual"]');
  ok(!(await visible("unusual")), "Unusual hidden");
  await page.check('[data-cw="flow"]');
  ok(await visible("flow") && await page.locator("#c-flow svg path").count() > 3, "Cash flow shown and drawn");
  await page.keyboard.press("Escape");
  ok(await page.locator("#d-custpop").isHidden(), "Esc closes Customize");
  await page.waitForTimeout(300);
  await page.reload({ waitUntil: "networkidle" }); await page.waitForSelector("#d-title");
  ok(!(await visible("unusual")) && await visible("flow"), "choice kept after a reload");
  await page.click("#d-cust");
  await page.click("[data-cust-all]");
  for (const k of ["flow", "cal", "people", "weekday", "subs", "trends", "payees", "unusual"]) ok(await visible(k), k + " visible with Show all");
  await shot(page, "04-all");
  await page.click("[data-cust-all]");
  ok(!(await visible("flow")) && await visible("unusual"), "Back to the default six");
  await page.click("[data-cust-all]");
  await page.click("#d-title");
  ok(await page.locator("#d-custpop").isHidden(), "clicking outside closes Customize");

  console.log("Click-throughs");
  const go = async (sel, re, name) => {
    await page.locator(sel).first().click();
    await page.waitForTimeout(250);
    const at = await path(page);
    ok(re.test(at), name + ": " + at);
    await backToDash(page);
  };
  await go("#cats [data-go-cat]", new RegExp("^/transactions\\?cat=[^&]+&mode=month&ym=" + ymStr(CY, CM) + "$"), "category keeps Month");
  await page.click('[data-ctab="tags"]');
  await go("#cats [data-go-q]", /^\/transactions\?q=%23/, "tag searches");
  await page.click('[data-ctab="cats"]');
  await go("#recent [data-go-id]", /^\/transactions\?id=[0-9a-f-]{36}$/, "recent opens the transaction");
  await go("#upcoming [data-go-rule]", /^\/recurring\?id=/, "coming up opens the rule");
  await go("#cal-grid [data-go-day]", /^\/transactions\?view=cal&day=\d{4}-\d\d-\d\d$/, "a day opens the calendar");
  await go("#payees [data-go-q]", /^\/transactions\?q=[^&]+&mode=month/, "payee searches");
  await go("#trends [data-go-cat]", /^\/transactions\?cat=[^&]+&mode=month&ym=\d{4}-\d\d$/, "trend card opens its month");
  await go("#unusual [data-go-id], #unusual [data-go-cat]", /^\/transactions\?(id=|cat=)/, "unusual opens what stands out");
  await go("#subs [data-go-rule]", /^\/recurring\?id=/, "subscription opens the rule");
  await page.click('[data-mode="3m"]');
  await go("#cats [data-go-cat]", /&mode=3m$/, "category keeps 3 months");
  await page.click('[data-mode="custom"]');
  await page.click('.d-rng [data-d="' + a + '"]'); await page.click('.d-rng [data-d="' + b + '"]'); await page.click("[data-dlg-ok]");
  await go("#cats [data-go-cat]", new RegExp("&mode=custom&from=" + a + "&to=" + b + "$"), "category keeps Custom");
  await page.click('[data-mode="12m"]');
  ok(await page.locator("#c-cal svg rect").count() > 300, "Day by day is a year grid for long ranges");
  await page.locator("#c-cal [data-go-day]").nth(10).click();
  await page.waitForTimeout(250);
  ok(/view=cal&day=/.test(await path(page)), "a square opens that day");
  await backToDash(page);
  await page.locator("body").press("1");
  await page.click("#d-menu");
  await page.click("#d-menupop [data-review]");
  await page.waitForTimeout(250);
  ok(await path(page) === "/review", "menu › Month in review");
  await backToDash(page);

  console.log("Settle up");
  const before = await api("GET", "/settlements");
  ok(before.transfers.length === 1, "demo has a balance");
  const owed = Number(before.transfers[0].amount);
  ok((await text(page, "#people .w-settle")).includes("owes"), "People widget says who owes whom");
  await page.click("#people [data-settle]");
  ok(Number((await page.inputValue("#st-amount")).replace(",", ".")) === owed, "amount prefilled with what is owed");
  ok(await page.inputValue("#st-date") === now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate()), "date is today");
  await shot(page, "05-settle");
  await page.fill("#st-amount", "abc");
  await page.click("[data-dlg-ok]");
  ok((await text(page, "#dlg-err")).includes("above zero"), "a bad amount is refused");
  await page.fill("#st-amount", String(owed));
  await page.click("[data-dlg-ok]");
  await page.waitForTimeout(500);
  ok((await text(page, "#toast-t")).startsWith("Settled"), "toast confirms the payment");
  ok((await text(page, "#people .w-settle")).includes("All square"), "People widget is all square");
  ok((await api("GET", "/settlements")).payments.length === before.payments.length + 1, "payment recorded");
  await page.click("#toast-undo");
  await page.waitForTimeout(600);
  ok((await api("GET", "/settlements")).payments.length === before.payments.length && (await text(page, "#people .w-settle")).includes("owes"), "Undo removes it");
  await page.click("#people [data-settle]");
  await page.locator(".st-hist [data-st-del]").first().click();
  await page.waitForTimeout(500);
  ok((await api("GET", "/settlements")).payments.length === before.payments.length - 1, "a payment deleted from the history");
  ok(await page.locator("#dlg .st").isVisible(), "the dialog stays open");
  await page.click("#toast-undo");
  await page.waitForTimeout(600);
  ok((await api("GET", "/settlements")).payments.length === before.payments.length, "Undo puts it back");
  ok(Number((await api("GET", "/settlements")).transfers[0].amount) === owed, "balance as before");
  await page.keyboard.press("Escape");
  await page.close();

  console.log("Dark mode and widths");
  for (const [w, dark] of [[1440, true], [1100, false], [900, true], [390, false]]) {
    const p = await open({ w, dark });
    ok(await noOverflow(p), w + " px" + (dark ? " dark" : "") + ": no sideways scroll");
    if (dark) ok(await p.evaluate(() => getComputedStyle(document.querySelector(".w-panel")).backgroundColor) !== "rgb(255, 255, 255)", w + " px: dark panels");
    await shot(p, "06-" + w + (dark ? "-dark" : ""));
    if (w === 390) {
      ok(await p.locator("#d-prange").isVisible() && await p.locator(".w-pchips").isVisible(), "phone: range title and person chips");
      ok((await p.getAttribute("#ph-bud", "href")) === "/budgets", "phone: Budgets card opens /budgets");
      ok(await p.locator("#ph-shared [data-settle]").isVisible(), "phone: shared costs with Settle up");
      await p.click("#d-prange");
      await p.click('[data-pick="last"]');
      ok((await text(p, "#d-prange")).includes(MONTH(pm)), "phone: range sheet picks last month");
      await p.click('.w-pchips [data-scope="1"]');
      await p.waitForTimeout(300);
      ok((await p.getAttribute('.w-pchips [data-scope="1"]', "aria-pressed")) === "true", "phone: person chip");
      await p.click('.w-pchips [data-scope="all"]');
      await p.click("#d-cust");
      ok(await p.locator(".d-custsheet [data-cw]").count() === 13, "phone: Customize as a sheet");
      await p.check('.d-custsheet [data-cw="flow"]');
      await p.click("[data-dlg-ok]");
      ok(await p.locator("#ph-flow .d-fbar span").count() > 2, "phone: cash flow as one stacked bar");
      await p.locator("#ph-bud").click();
      await p.waitForTimeout(250);
      ok(await path(p) === "/budgets", "phone: Budgets card navigates");
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
  ok(await page.locator("[data-settle]").count() === 0, "no settle up with one person");
  await page.click("#d-cust");
  ok(await page.locator("#d-custpop [data-cw]").count() === 12 && await page.locator('[data-cw="people"]').count() === 0, "People widget not offered");
  await page.click("[data-cust-all]");
  ok(await page.locator('[data-w="people"]').count() === 0, "and not drawn with Show all");
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
