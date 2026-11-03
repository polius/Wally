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
  ok(await page.locator(".s-steps [data-step]").count() === 2 && await page.locator('.s-steps [data-step="1"]').isDisabled(), "‹ › beside the title; › waits at this month");
  ok(await page.locator("#c-hero svg path").count() >= 2, "Everyday spending chart drawn");
  ok((await text(page, "#s-eye")) === "Everyday spending", "the headline is everyday spending");
  const left = await page.locator(".s-left > [data-w]").evaluateAll((n) => n.map((x) => x.dataset.w).join(","));
  const right = await page.locator(".s-right > [data-w]").evaluateAll((n) => n.map((x) => x.dataset.w).join(","));
  ok(left === "hero,cats,recent,upcoming", "the month on the left: " + left);
  ok(right === "notice,people,kept,year", "the context on the right: " + right);
  ok(await page.locator('[data-w="recent"]').isVisible() && await page.locator("#s-recent .s-row").count() <= 4, "Recent on desktop too, four at most");
  ok(await page.locator('[data-w="savings"]').count() === 0, "This year replaces Savings");
  ok((await text(page, "#s-big")).includes("€") && !(await text(page, "#s-big")).includes("."), "the headline is a rounded total: " + await text(page, "#s-big"));
  const lines = await text(page, "#s-lines");
  ok(lastDay ? !lines.includes("Usually") : lines.includes("Usually") && lines.includes("≈"), "where it usually ends up, in words (unless today is the last day): " + lines.replace(/\n/g, " / "));
  ok(lines.includes(MONTH(pm) + " at this point"), "compared with last month at this point");
  ok(!lines.includes("Bills"), "no Bills line in the headline card");
  ok((await text(page, "#c-hero")).includes(MONTH(pm)), "the dashed line names last month and its total");
  ok(await page.locator("#s-recapw a.s-recap").count() === 0 && (await text(page, "#s-recapw")) === "", "no recap card while the month runs");
  ok((await text(page, "#s-catsnote")).startsWith("without bills"), "Categories leave bills out: " + await text(page, "#s-catsnote"));
  ok((await text(page, '[data-w="people"]')).includes("share of shared costs"), "The household: own and shared, per person");
  ok((await text(page, '[data-w="year"] h4')) === "This year" && (await text(page, "#s-year")).includes("kept since January"), "This year: kept since January");
  ok(await page.locator('[data-w="notice"]').isHidden() || await page.locator("#s-notice .s-notice").count() <= 3, "Worth noticing: hidden or at most three lines");
  await shot(page, "01-month");

  console.log("Period menu, keys and arrows");
  await page.click(".s-title");
  ok(await page.locator("#s-pmenu").isVisible(), "the title opens the period menu");
  const items = await page.locator("#s-pmenu [data-pm]").allInnerTexts();
  ok(items.join("|") === "This month|Last month|This year|All time|Custom range…", "five shortcuts: " + items.join("|"));
  ok((await page.getAttribute('#s-pmenu [data-pm="this"]', "aria-checked")) === "true", "this month is ticked");
  await page.keyboard.press("Escape");
  ok(await page.locator("#s-pmenu").isHidden(), "Esc closes the menu");
  await pickPeriod(page, "last");
  ok((await text(page, "#s-title")).startsWith(MONTH(pm)), "Last month shows it");
  ok(!(await text(page, "#s-lines")).includes("Usually"), "a closed month has no projection");
  ok((await text(page, "#s-recapw")).includes("Your " + MONTH(pm) + " recap") && await page.getAttribute("#s-recapw a.s-recap", "href") === "/review?m=" + ymStr(py, pm), "a finished month has its recap");
  await page.click('.s-steps [data-step="1"]');
  ok((await text(page, "#s-title")).startsWith(MONTH(CM)), "› steps forward");
  await page.click('.s-steps [data-step="-1"]');
  ok((await text(page, "#s-title")).startsWith(MONTH(pm)), "‹ steps back");
  await page.locator("body").press("ArrowRight");
  ok((await text(page, "#s-title")).startsWith(MONTH(CM)), "→ steps forward");
  await page.locator("body").press("ArrowRight");
  ok((await text(page, "#s-title")).startsWith(MONTH(CM)), "not past this month");
  await page.locator("body").press("2");
  ok((await text(page, "#s-title")) === String(CY), "key 2: the year");
  ok((await text(page, "#s-lines")).includes("same days of " + (CY - 1)), "Year compares with the same days last year");
  if (yearEnd) ok(!(await text(page, "#s-lines")).includes("Usually"), "Year: nothing to project on its last day");
  else ok((await text(page, "#s-lines")).includes("by Dec 31"), "Year projects to 31 December");
  await page.click('.s-steps [data-step="-1"]');
  ok((await text(page, "#s-title")) === String(CY - 1), "‹ in a year steps a year back");
  await page.locator("body").press("4");
  ok((await text(page, "#s-title")) === "All time" && await page.locator(".s-steps").isHidden(), "key 4: All time, without arrows");
  await page.locator("body").press("1");
  ok((await text(page, "#s-title")).startsWith(MONTH(CM)), "key 1: back to this month");

  console.log("Custom range");
  await page.locator("body").press("3");
  ok(await page.locator(".d-rng").isVisible() && (await text(page, ".w-shh")).includes("Custom Range"), "key 3 opens the Custom Range sheet");
  ok(await page.locator(".d-rng [data-edge]").count() === 2 && await page.locator(".d-rng .d-calg").count() === 1, "Starts and Ends, one calendar");
  // Days that exist and aren't in the future, whatever today is
  const a = ymStr(py, pm) + "-05", b = ymStr(CY, CM) + "-" + pad(Math.min(3, now.getDate()));
  // The calendar's title opens the months of its year (Calendar's month picker)
  await page.click(".d-rng [data-rpick]");
  ok(await page.locator(".d-rng .d-calm button").count() === 12 && (await text(page, ".d-rng .d-calm .on")).length > 0, "the title opens the twelve months, this one marked");
  if (py !== CY) await page.click('.d-rng [data-ry="-1"]');
  await page.click('.d-rng [data-rmo="' + pm + '"]');
  ok(await page.locator('.d-rng [data-d="' + a + '"]').count() === 1 && (await page.getAttribute(".d-rng [data-rpick]", "aria-expanded")) === "false", "picking a month shows its days");
  await page.click('.d-rng [data-d="' + a + '"]');
  ok((await page.getAttribute('.d-rng [data-edge="b"]', "aria-expanded")) === "true", "the first day moves on to the last");
  await page.click('.d-rng [data-rv="1"]');
  await page.click('.d-rng [data-d="' + b + '"]');
  ok((await text(page, ".d-rngsum")).includes("days"), "the number of days");
  await shot(page, "02-picker");
  await page.click("[data-dlg-ok]");
  ok((await text(page, "#s-title")).includes("–"), "custom range applied: " + await text(page, "#s-title"));
  ok(await page.locator("#s-view").isHidden() && await page.locator(".s-steps").isHidden(), "a short custom range: no chart views, no arrows");
  await page.reload({ waitUntil: "networkidle" }); await page.waitForSelector("#s-title");
  ok((await text(page, "#s-title")).includes("–"), "the range is remembered after a reload");
  await pickPeriod(page, "all");
  ok(!(await page.locator("#s-view").isHidden()), "All time shows the chart views");
  ok(await page.locator("#c-kept [data-go-month]").count() > 12, "All time: Kept each month shows every month (" + await page.locator("#c-kept [data-go-month]").count() + ")");

  console.log("Chart views");
  ok((await page.locator("#s-view button").allInnerTexts()).join("|") === "Everyday|Income vs spending|By category", "three chart views");
  await page.click('[data-hv="ivs"]');
  ok(await page.locator("#c-hero svg path").count() > 4, "Income vs spending bars");
  await page.click('[data-hv="cats"]');
  ok(await page.locator("#c-hero svg path").count() > 4, "By category bars");
  await page.click('[data-hv="pace"]');
  ok(await page.locator("#c-hero svg path").count() >= 2, "back to the running total");
  await page.locator("body").press("1");

  console.log("Tooltips");
  // Early in a month there are few past days: last month has them all
  const early = now.getDate() < 4;
  if (early) await pickPeriod(page, "last");
  const box = await page.locator("#c-hero svg").boundingBox();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
  ok(await page.locator("#tip.on").count() === 1 && (await text(page, "#tip")).includes(early ? MONTH(pm) : MONTH(CM)), "hero chart tooltip");
  await page.mouse.move(5, 5);
  let dayX = null;
  for (let fr = 0.05; fr < 0.9 && dayX === null; fr += 0.02) {
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

  console.log("Categories");
  await pickPeriod(page, "last");
  const rows = await page.locator("#s-cats .s-row").count();
  ok(rows > 0 && rows <= 6, "the biggest six: " + rows);
  ok((await text(page, "#s-cats .s-row small")).startsWith(MONTH(ymAdd(CY, CM, -2)[1]) + ":"), "each against the month before: " + await text(page, "#s-cats .s-row small"));
  if (await page.locator('[data-act="cats-all"]').isVisible()) {
    await page.click('[data-act="cats-all"]');
    ok(await page.locator("#s-cats .s-row").count() > rows && (await text(page, '[data-act="cats-all"]')) === "Show less", "Show all lists every category");
    await page.click('[data-act="cats-all"]');
  }
  // A category keeps its color whatever its rank: the same one in two months
  const colorFor = (p, sel, name) => p.locator(sel, { hasText: name }).first().locator(".w-ico").evaluate((e) => getComputedStyle(e).color);
  const names = await page.locator("#s-cats .s-row .s-nm > span").allInnerTexts();
  const cols = await Promise.all(names.map((n) => colorFor(page, "#s-cats .s-row", n)));
  await page.click('.s-steps [data-step="-1"]');
  const before = await page.locator("#s-cats .s-row .s-nm > span").allInnerTexts();
  const same = names.filter((n) => before.includes(n));
  let kept = same.length > 0;
  for (const n of same) kept = kept && (await colorFor(page, "#s-cats .s-row", n)) === cols[names.indexOf(n)];
  ok(kept, "each category keeps its color from month to month (" + same.join(", ") + ")");
  ok(new Set(cols).size === cols.length, "different categories, different colors");
  await pickPeriod(page, "this");

  console.log("Person switch");
  const allPeople = await text(page, "#s-people");
  await page.click(".s-head .w-pswitch-b");
  ok(await page.locator(".s-head .w-pswitch-m").isVisible() && await page.locator(".s-head .w-pswitch-m [data-switch]").isHidden(), "Everyone ▾ opens the people (Switch person is in the sidebar)");
  await page.click('.s-head .w-pswitch-m [data-scope="2"]');
  await page.waitForTimeout(500);
  ok((await text(page, ".s-head .w-pswitch-b")).includes("Ana"), "the menu names who is shown");
  ok((await text(page, "#s-kept")) !== "" && (await text(page, "#s-people")) === allPeople, "The household stays the whole household");
  await page.click(".s-head .w-pswitch-b");
  await page.click('.s-head .w-pswitch-m [data-scope="all"]');
  await page.waitForTimeout(500);

  console.log("Kept each month, This year");
  ok(await page.locator("#c-kept [data-go-month]").count() === 12, "twelve months up to this one");
  ok((await text(page, "#s-avg")).startsWith("Average"), "the average is named: " + await text(page, "#s-avg"));
  await page.locator("#c-kept [data-go-month]").nth(9).hover();
  ok((await text(page, "#tip")).includes("Came in") && (await text(page, "#tip")).includes("Went out"), "a bar explains its month");
  await page.locator("#c-kept [data-go-month]").nth(9).click();
  await page.waitForTimeout(300);
  ok((await text(page, "#s-title")).startsWith(MONTH(ymAdd(CY, CM, -2)[1])), "a bar opens its month: " + await text(page, "#s-title"));
  await page.locator("body").press("1");
  ok(await page.locator("#c-year svg path").count() >= 2, "This year: a line since January");
  if (CM < 12) ok((await text(page, "#s-year")).includes("on track for") && (await text(page, "#s-year")).includes("Dec 31"), "and where it heads by December 31");

  console.log("Click-throughs");
  const go = async (sel, re, name) => {
    await page.locator(sel).first().click();
    await page.waitForTimeout(250);
    const at = await path(page);
    ok(re.test(at), name + ": " + at);
    await backToDash(page);
  };
  await pickPeriod(page, "last");
  await go("#s-cats [data-go-cat]", new RegExp("^/transactions\\?cat=[^&]+&mode=month&ym=" + ymStr(py, pm) + "$"), "category keeps Month");
  await go("#s-upcoming [data-go-rule]", /^\/recurring\?id=/, "coming up opens the rule");
  await pickPeriod(page, "last");
  await go("#s-recapw a", new RegExp("^/review\\?m=" + ymStr(py, pm) + "$"), "the recap opens that month's review");
  await go("#s-recent [data-go-id]", /^\/transactions\?id=/, "a recent row opens the transaction");
  await page.locator("body").press("2");
  await go("#s-cats [data-go-cat]", /&mode=year$/, "category keeps Year");
  await page.locator("body").press("1");
  await pickPeriod(page, "custom");
  await page.click('.d-rng [data-rv="-1"]'); await page.click('.d-rng [data-d="' + a + '"]'); await page.click('.d-rng [data-rv="1"]'); await page.click('.d-rng [data-d="' + b + '"]'); await page.click("[data-dlg-ok]");
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
      ok(await p.locator(".s-title").isVisible() && await p.locator(".s-steps").isVisible() && await p.locator(".s-head .w-pswitch").isVisible() && await p.locator(".w-hadd").isHidden(), "phone: the period title with ‹ ›, the person menu top right, Add in the tab bar");
      ok(await p.evaluate(() => { const e = document.getElementById("s-title"); return e.scrollWidth <= e.clientWidth; }), "phone: the month's name fits");
      const order = await p.evaluate(() => [...document.querySelectorAll(".s-grid [data-w]")].filter((n) => !n.hidden).sort((x, y) => x.getBoundingClientRect().top - y.getBoundingClientRect().top).map((n) => n.dataset.w).join(","));
      ok(/^hero,(notice,)?cats,recent,upcoming,people,kept,year$/.test(order), "phone: one column in reading order: " + order);
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
      await p.click('#s-pmenu [data-pm="last"]');
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
