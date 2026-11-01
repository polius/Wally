/* Summary (the page at /), in a real browser against a fresh demo server.
     BASE=http://localhost:8801 node dashboard.mjs
   The server must be a fresh DEMO=true one: the last scenarios remove a person and then every
   transaction, to check the one-person and empty households. Exits non-zero on any failure,
   console error or page error. SHOTS=<folder> saves a screenshot per scenario.
   WALLY_TODAY=2026-12-31 runs it on that day: give the server the same variable (run.sh does). */
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE || "http://localhost:8801";
const SHOTS = process.env.SHOTS || "";
if (SHOTS && !existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log("  ok   " + msg); else { failures++; console.log("  FAIL " + msg); } };
const pad = (n) => String(n).padStart(2, "0");
// Any day of the year: the browser's clock is set to it, and the server makes its demo up to it
const FIXED = process.env.WALLY_TODAY ? new Date(process.env.WALLY_TODAY + "T12:00:00") : null;
const now = FIXED || new Date();
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
  if (FIXED) await page.clock.install({ time: FIXED });
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
async function backToDash(page) { await page.goBack(); await page.waitForSelector("#s-title"); await page.waitForTimeout(150); }
const lastDay = now.getDate() === new Date(CY, CM, 0).getDate();
const yearEnd = CM === 12 && lastDay;
const pickPeriod = async (page, v) => { await page.click(".s-title"); await page.click('#s-pmenu [data-pm="' + v + '"]'); await page.waitForTimeout(200); };
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

try {
  /* ---------- reset prefs, so the defaults show ---------- */
  await api("PUT", "/me/prefs", { widgets: null, cmp: "last" });

  console.log("Opening");
  let page = await open();
  const [py, pm] = ymAdd(CY, CM, -1);
  ok((await text(page, "#s-title")).startsWith(MONTH(CM)), "opens on the current month, the period is the title");
  ok(await page.locator("#h-kpis,.w-kpi").count() === 0, "no row of key figures: Kept each month carries them");
  ok(await page.locator("#c-hero svg path").count() > 2, "Spent so far chart drawn");
  const widgets = await page.locator("#main [data-w]").evaluateAll((n) => [...new Set(n.map((x) => x.dataset.w))].join(","));
  ok(widgets === "hero,cats,recent,upcoming,kept,savings", "the sections, in order: " + widgets);
  ok(await page.locator(".s-evo > :first-child #s-recapw, .s-evo > #s-recapw:first-child").count() === 1, "the right column, how things move, opens with the month's recap");
  ok(await page.locator('[data-w="recent"]').isHidden(), "Recent is a phone section; wide screens have Transactions in the sidebar");
  ok((await text(page, "#s-big")).includes("€") && !(await text(page, "#s-big")).includes("."), "the hero is a rounded total: " + await text(page, "#s-big"));
  const lines = await text(page, "#s-lines");
  ok(lastDay ? !lines.includes("On track for") : lines.includes("On track for") && lines.includes("≈"), "the projection to the month's end, in words (unless today is the last day)");
  ok(lines.includes(MONTH(pm) + " at this point"), "compared with last month at this point: " + lines.replace(/\n/g, " / "));
  ok(await page.locator("#c-hero .chart .lb.acc").count() === 1, "the line ends are labelled, no legend");
  const recap = await text(page, "#s-recapw");
  ok(recap.includes("Your " + MONTH(CM) + " recap") && recap.includes("Ready"), "this month's recap, and when it is ready: " + recap.replace(/\n/g, " / "));
  ok(await page.locator("#s-recapw a.s-recap").count() === 0, "a month not over has no recap to open yet");
  ok(await page.getAttribute("#s-recapw a", "href") === "/review?m=" + ymStr(py, pm) && recap.includes(MONTH(pm) + " recap"), "last month's stays a tap away");
  ok(await page.locator("#d-cust,[data-d-cmd],#h-table,#h-cmp,[data-cmp],#d-range,#d-step").count() === 0, "no Customize, Table, compare, range buttons or arrows");
  await shot(page, "01-month");

  console.log("Period menu, keys and arrows");
  await page.click(".s-title");
  ok(await page.locator("#s-pmenu").isVisible(), "the title opens the period menu");
  const items = await page.locator("#s-pmenu [data-pm]").allInnerTexts();
  ok(items[0].startsWith(String(CY)) && items[1] === "Custom range…" && items.includes(MONTH(CM)), "the year, a custom range, then months: " + items.slice(0, 4).join("|"));
  ok((await page.getAttribute('#s-pmenu [data-pm="' + ymStr(CY, CM) + '"]', "aria-checked")) === "true", "this month is ticked");
  await page.keyboard.press("Escape");
  ok(await page.locator("#s-pmenu").isHidden(), "Esc closes the menu");
  await pickPeriod(page, ymStr(py, pm));
  ok((await text(page, "#s-title")).startsWith(MONTH(pm)), "picking a month shows it");
  ok(!(await text(page, "#s-lines")).includes("On track for"), "a closed month has no projection");
  ok((await text(page, "#s-recapw")).includes("Your " + MONTH(pm) + " recap") && await page.getAttribute("#s-recapw a.s-recap", "href") === "/review?m=" + ymStr(py, pm), "the recap follows the month on screen");
  await page.locator("body").press("ArrowRight");
  ok((await text(page, "#s-title")).startsWith(MONTH(CM)), "→ steps forward");
  await page.locator("body").press("ArrowRight");
  ok((await text(page, "#s-title")).startsWith(MONTH(CM)), "not past this month");
  await page.locator("body").press("ArrowLeft");
  ok((await text(page, "#s-title")).startsWith(MONTH(pm)), "← steps back");
  await page.locator("body").press("2");
  ok((await text(page, "#s-title")).includes(String(CY)) && (await text(page, "#s-title")).includes("so far"), "key 2: the year so far");
  ok((await text(page, "#s-eye")).startsWith("Spent so far in"), "Year: Spent so far in the year");
  ok((await text(page, "#s-lines")).includes("same days of " + (CY - 1)), "Year compares with the same days last year");
  // On 31 December the year is done: nothing is left to project
  if (yearEnd) ok(!(await text(page, "#s-lines")).includes("On track for"), "Year: nothing to project on its last day");
  else ok((await text(page, "#s-lines")).includes("by Dec 31"), "Year projects to 31 December");
  await page.locator("body").press("1");
  ok((await text(page, "#s-title")).startsWith(MONTH(CM)), "key 1: back to this month");

  console.log("Custom range");
  await page.locator("body").press("3");
  ok(await page.locator(".d-rng").isVisible(), "key 3 opens the two-month picker");
  ok(await page.locator(".d-rng .w-mon").count() === 2, "two months side by side");
  await page.click('.d-rng [data-pr="1"]'); // Last month
  await page.click("[data-dlg-ok]");
  ok((await text(page, "#s-title")).startsWith(MONTH(pm)), "preset Last month becomes that month");
  await page.locator("body").press("1");
  await pickPeriod(page, "custom");
  // Days that exist and aren't in the future, whatever today is
  const a = ymStr(py, pm) + "-05", b = ymStr(CY, CM) + "-" + pad(Math.min(3, now.getDate()));
  await page.click('.d-rng [data-d="' + a + '"]');
  ok(await page.locator("[data-dlg-ok]").isDisabled(), "Apply waits for the last day");
  await page.click('.d-rng [data-d="' + b + '"]');
  ok((await text(page, ".d-rngsum")).includes("days"), "summary shows the number of days");
  await shot(page, "02-picker");
  await page.click("[data-dlg-ok]");
  ok((await text(page, "#s-title")).includes("–"), "custom range applied: " + await text(page, "#s-title"));
  ok(await page.locator("#s-view").isHidden(), "a short custom range has no chart views");
  await page.reload({ waitUntil: "networkidle" }); await page.waitForSelector("#s-title");
  ok((await text(page, "#s-title")).includes("–"), "the range is remembered after a reload");
  await pickPeriod(page, "custom");
  await page.click(".d-rng [data-pr]:last-child");
  await page.click("[data-dlg-ok]");
  ok(!(await page.locator("#s-view").isHidden()), "All time shows the chart views");
  ok(await page.locator("#c-kept [data-go-month]").count() > 12, "All time: Kept each month shows every month (" + await page.locator("#c-kept [data-go-month]").count() + ")");

  console.log("Chart views");
  // On All time, which is long whatever the date (early in January, the year so far is a few days, shown day by day)
  ok((await page.locator("#s-view button").allInnerTexts()).join("|") === "Spent|Income vs spending|By category", "three chart views");
  await page.click('[data-hv="ivs"]');
  ok(await page.locator("#c-hero svg path").count() > 4, "Income vs spending bars");
  await page.click('[data-hv="cats"]');
  ok(await page.locator("#c-hero svg path").count() > 4, "By category bars");
  await page.click('[data-hv="pace"]');
  ok(await page.locator("#c-hero .chart .lb.acc").count() === 1, "back to the running total");
  await page.locator("body").press("1");

  console.log("Tooltips");
  // Early in a month there are no past days yet: last month has them all
  const early = now.getDate() < 4;
  if (early) await pickPeriod(page, ymStr(py, pm));
  const box = await page.locator("#c-hero svg").boundingBox();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
  ok(await page.locator("#tip.on").count() === 1 && (await text(page, "#tip")).includes("Difference"), "hero chart tooltip with the difference");
  await page.locator(".s-stack i").first().hover();
  ok((await text(page, "#tip")).includes("%"), "the stacked bar names each part");
  await page.mouse.move(5, 5);
  // A day on the chart that spent something opens its transactions
  let dayX = null;
  for (let fr = 0.05; fr < 0.6 && dayX === null; fr += 0.02) {
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
  if (early) { await page.locator("body").press("1"); await page.waitForTimeout(200); }

  console.log("Categories");
  const rows = await page.locator("#s-cats .s-row").count();
  ok(rows > 0 && rows <= 4, "the biggest four: " + rows);
  if (await page.locator('[data-act="cats-all"]').isVisible()) {
    await page.click('[data-act="cats-all"]');
    ok(await page.locator("#s-cats .s-row").count() > rows && (await text(page, '[data-act="cats-all"]')) === "Show less", "See all lists every category");
    await page.click('[data-act="cats-all"]');
  }
  // A category keeps its color whatever its rank: the same one in two months, and in Settings
  const colorFor = (p, sel, name) => p.locator(sel, { hasText: name }).first().locator(".w-ico").evaluate((e) => getComputedStyle(e).color);
  const names = await page.locator("#s-cats .s-row .s-nm > span").allInnerTexts();
  const cols = await Promise.all(names.map((n) => colorFor(page, "#s-cats .s-row", n)));
  await pickPeriod(page, ymStr(py, pm));
  const before = await page.locator("#s-cats .s-row .s-nm > span").allInnerTexts();
  const same = names.filter((n) => before.includes(n));
  let kept = same.length > 0;
  for (const n of same) kept = kept && (await colorFor(page, "#s-cats .s-row", n)) === cols[names.indexOf(n)];
  ok(kept, "each category keeps its color from month to month (" + same.join(", ") + ")");
  ok(new Set(cols).size === cols.length, "the biggest four have four different colors");
  await pickPeriod(page, ymStr(CY, CM));

  console.log("Person switch");
  const allBig = await text(page, "#s-big");
  await page.click(".s-head .w-pswitch-b");
  ok(await page.locator(".s-head .w-pswitch-m").isVisible() && await page.locator(".s-head .w-pswitch-m [data-switch]").isHidden(), "Everyone ▾ opens the people (Switch person is in the sidebar)");
  await page.click('.s-head .w-pswitch-m [data-scope="2"]');
  await page.waitForTimeout(500);
  const anaBig = await text(page, "#s-big");
  ok(allBig !== anaBig, "Ana's figures differ from everyone's (" + allBig + " → " + anaBig + ")");
  ok((await text(page, ".s-head .w-pswitch-b")).includes("Ana"), "the menu names who is shown");
  await page.click(".s-head .w-pswitch-b");
  await page.click('.s-head .w-pswitch-m [data-scope="all"]');
  await page.waitForTimeout(500);

  console.log("Kept each month");
  ok(await page.locator("#c-kept [data-go-month]").count() === 12, "twelve months up to this one");
  ok((await text(page, "#s-avg")).startsWith("Average"), "the average is named: " + await text(page, "#s-avg"));
  ok(/more than|less than|same as/i.test(await text(page, ".s-keptvs")), "kept against last month: " + await text(page, ".s-keptvs"));
  ok(!(await text(page, '[data-w="kept"]')).includes("came in"), "Kept each month leaves income to its own section");

  console.log("Savings");
  ok((await text(page, "#s-savings .s-eyes")).startsWith("Saved in the last"), "savings added up over the months: " + await text(page, "#s-savings .s-eyes"));
  ok(/€/.test(await text(page, "#s-savings .s-keptn b")), "the total: " + await text(page, "#s-savings .s-keptn b"));
  ok((await text(page, "#s-savings .s-proj")).includes("On track for"), "and where it heads in three months: " + await text(page, "#s-savings .s-proj"));
  ok((await text(page, "#s-savings .s-keptsub")).includes("of income kept"), "this month's share of income kept: " + await text(page, "#s-savings .s-keptsub"));
  ok(await page.locator("#c-sav svg path").count() >= 3, "a rising line with its dotted projection");
  await page.locator("#c-sav svg rect").nth(3).hover();
  ok((await text(page, "#tip")).includes("Saved by then"), "a month on the line says what was saved by then");
  await page.mouse.move(5, 5);
  await page.locator("#c-kept [data-go-month]").nth(9).hover();
  ok((await text(page, "#tip")).includes("Came in") && (await text(page, "#tip")).includes("Went out"), "a bar explains its month");
  await page.locator("#c-kept [data-go-month]").nth(9).click();
  await page.waitForTimeout(300);
  ok((await text(page, "#s-title")).startsWith(MONTH(ymAdd(CY, CM, -2)[1])), "a bar opens its month: " + await text(page, "#s-title"));
  await page.locator("body").press("1");

  console.log("Click-throughs");
  const go = async (sel, re, name) => {
    await page.locator(sel).first().click();
    await page.waitForTimeout(250);
    const at = await path(page);
    ok(re.test(at), name + ": " + at);
    await backToDash(page);
  };
  await go("#s-cats [data-go-cat]", new RegExp("^/transactions\\?cat=[^&]+&mode=month&ym=" + ymStr(CY, CM) + "$"), "category keeps Month");
  await go("#s-upcoming [data-go-rule]", /^\/recurring\?id=/, "coming up opens the rule");
  await go("#s-recapw a", new RegExp("^/review\\?m=" + ymStr(py, pm) + "$"), "the recap opens last month's review");
  await page.locator("body").press("2");
  await go("#s-cats [data-go-cat]", /&mode=year$/, "category keeps Year");
  await pickPeriod(page, "custom");
  await page.click('.d-rng [data-d="' + a + '"]'); await page.click('.d-rng [data-d="' + b + '"]'); await page.click("[data-dlg-ok]");
  await go("#s-cats [data-go-cat]", new RegExp("&mode=custom&from=" + a + "&to=" + b + "$"), "category keeps Custom");
  await page.locator("body").press("1");
  ok(await page.locator("#main [data-settle]").count() === 0 && !(await text(page, "#main")).includes("owes"), "no Settle up and no who-owes-whom");
  await page.close();

  console.log("Dark mode and widths");
  for (const [w, dark] of [[1440, true], [1100, false], [900, true], [390, false]]) {
    const p = await open({ w, dark });
    ok(await noOverflow(p), w + " px" + (dark ? " dark" : "") + ": no sideways scroll");
    if (dark) ok(await p.evaluate(() => getComputedStyle(document.querySelector(".s-sec[data-w=cats]")).backgroundColor) !== "rgb(255, 255, 255)", w + " px: dark cards");
    await shot(p, "06-" + w + (dark ? "-dark" : ""));
    if (w === 390) {
      ok(await p.locator(".s-title").isVisible() && await p.locator(".s-head .w-pswitch").isVisible() && await p.locator(".w-hadd").isHidden(), "phone: the period title, the person menu top right, Add in the tab bar");
      ok(await p.locator("#tabbar .w-tabpill a").count() === 4 && await p.locator("#tabbar .w-tabadd").isVisible(), "phone: four tabs and a separate ＋");
      ok(await p.locator('[data-w="recent"]').isVisible() && await p.locator("#s-recent .s-row").count() > 0 && await p.locator("#s-recent .s-row").count() <= 4, "phone: Recent, four rows");
      ok(/Today|Yesterday|day/.test(await text(p, "#s-recent .s-row small")), "phone: Recent says when in words: " + await text(p, "#s-recent .s-row small"));
      ok(await p.locator("#c-kept svg").count() === 1, "phone: Kept each month drawn");
      // No hover on a phone: a tap shows the day and stays on the page
      const hb = await p.locator("#c-hero svg").boundingBox();
      await p.touchscreen.tap(hb.x + hb.width * 0.2, hb.y + hb.height * 0.5);
      await p.waitForTimeout(600);
      ok(await p.locator("#tip.on").count() === 1 && new URL(p.url()).pathname === "/" && !(await text(p, "#tip")).includes("Click"), "phone: a tap on the chart shows that day, without leaving Summary");
      await p.click(".s-title");
      await p.click('#s-pmenu [data-pm="' + ymStr(py, pm) + '"]');
      ok((await text(p, "#s-title")).startsWith(MONTH(pm)), "phone: the title menu picks last month");
      await p.click(".w-pswitch-b");
      ok(await p.locator(".w-pswitch-m").isVisible() && await p.locator(".w-pswitch-m [data-switch]").isVisible(), "phone: the person menu holds Switch person");
      await p.click('.w-pswitch-m [data-scope="1"]');
      await p.waitForTimeout(300);
      ok((await p.getAttribute('.w-pswitch-m [data-scope="1"]', "aria-checked")) === "true" && await p.locator(".w-pswitch-m").isHidden(), "phone: picking a person shows them and closes the menu");
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
  ok(await page.locator(".s-head .w-pswitch").isHidden() && await page.locator("#c-kept svg").count() === 1, "one person: no person menu, Summary as usual");
  await shot(page, "08-one");
  await page.close();

  console.log("Empty household");
  const led = await api("GET", "/ledger");
  await api("POST", "/transactions/bulk", { ids: led.rows.map((r) => r[0]), action: "delete" });
  page = await open({ wait: ".d-welcome" });
  ok((await text(page, ".d-welcome")).includes("Nothing here yet"), "empty Summary explains what to do");
  ok(await page.locator(".d-welcome [data-open-add]").count() === 1, "with Add expense");
  await page.locator("body").press("2");
  ok(await page.locator(".d-welcome").isVisible(), "range keys do nothing on an empty Summary");
  await shot(page, "09-empty");
  const p2 = await open({ w: 390, wait: ".d-welcome" });
  ok(await noOverflow(p2), "empty Summary on a phone");
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
