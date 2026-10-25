/* The Recurring page, on real servers: figures checked against the API by hand, every list,
   filter and panel action, Wally noticed, the person switch, widths, dark, Arabic and the empty state.
   Starts its own servers (a demo household, then an empty one):
     REPO=/path/to/Wally PYTHON=/path/to/python PORT=8804 node recurring.mjs
   The add sheet is replaced by a stub that records how it was opened, so these tests check
   what this page asks of it. Screenshots go to SHOTS (a folder) when it is set. */
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = process.env.REPO || process.cwd();
const PYTHON = process.env.PYTHON || "python3";
const PORT = +(process.env.PORT || 8804);
const SHOTS = process.env.SHOTS || "";
if (SHOTS && !existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log("  ok  " + msg); else { failures++; console.log("  FAIL " + msg); } };
const servers = [];
const pad = (n) => String(n).padStart(2, "0");
const d0 = new Date();
const TODAY = d0.getFullYear() + "-" + pad(d0.getMonth() + 1) + "-" + pad(d0.getDate());
const addD = (s, n) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8)) + n * 864e5).toISOString().slice(0, 10);
const money = (n) => (n < 0 ? "−" : "") + new Intl.NumberFormat("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n)) + " €";
const PER = { daily: 365.25 / 12, weekly: 52.18 / 12, monthly: 1, yearly: 1 / 12 };

async function startServer(port, demo) {
  const data = mkdtempSync(join(tmpdir(), "wally-rec-"));
  const env = { ...process.env, WALLY_DATA: data };
  if (demo) env.DEMO = "true"; else delete env.DEMO;
  const proc = spawn(PYTHON, ["-m", "uvicorn", "utils.dev_server:app", "--port", String(port)], { cwd: REPO, env, stdio: "ignore" });
  servers.push(proc);
  const base = "http://localhost:" + port;
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(base + "/api/auth/status"); if (r.ok) return { base, db: join(data, "wally.db") }; } catch (e) { /* not yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server on " + port + " did not start");
}
function sql(db, query, params) {
  execFileSync(PYTHON, ["-c", "import sqlite3,sys,json;c=sqlite3.connect(sys.argv[1]);c.execute(sys.argv[2],json.loads(sys.argv[3]));c.commit()", db, query, JSON.stringify(params || [])]);
}

const browser = await chromium.launch();
const ADD_STUB = "export function openAdd(o){(window.__add=window.__add||[]).push(JSON.parse(JSON.stringify(o||{},(k,v)=>k==='raw'?undefined:v)));} export function flushQueue(){}";
async function open(base, path, { width = 1440, height = 900, theme = "light", person = "1" } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme, serviceWorkers: "block" });
  await ctx.addInitScript((p) => { if (!sessionStorage.getItem("init")) { localStorage.setItem("wally.person", p); localStorage.removeItem("wally.scope"); sessionStorage.setItem("init", "1"); } }, person);
  await ctx.route("**/js/add.js", (r) => r.fulfill({ contentType: "text/javascript", body: ADD_STUB }));
  const page = await ctx.newPage();
  page.errors = [];
  page.on("console", (m) => { if (m.type() === "error") page.errors.push(m.text()); });
  page.on("pageerror", (e) => page.errors.push("PAGEERROR " + e.message));
  await page.goto(base + path, { waitUntil: "networkidle" });
  await page.waitForSelector("#rec-page");
  return page;
}
async function shot(page, name) { if (SHOTS) await page.screenshot({ path: join(SHOTS, name + ".png"), fullPage: true }); }
const sp = (s) => s.replace(/[\u00a0\u202f]/g, " ");     // money is joined to its symbol with a no-break space
const text = async (page, sel) => sp(await page.locator(sel).first().innerText());
const addCalls = (page) => page.evaluate(() => window.__add || []);
async function done(page, label) { ok(page.errors.length === 0, label + ": no console errors" + (page.errors.length ? " — " + page.errors.join(" | ") : "")); await page.context().close(); }

try {
  const { base, db } = await startServer(PORT, true);
  const H = { "Content-Type": "application/json", "X-Wally-Person": "1" };
  const api = async (method, path, body) => { const r = await fetch(base + "/api" + path, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) }); return r.json(); };
  const rules = await api("GET", "/recurring");
  const byName = (n) => rules.filter((r) => r.name === n).sort((a, b) => (a.startDate < b.startDate ? 1 : -1))[0];
  /* Hand calculation of the KPIs, from the API */
  const nextAfterToday = (r) => {
    if (r.paused) return null;
    const s = r.startDate, every = r.interval || 1;
    for (let k = 0; k < 5000; k++) {
      let d;
      if (r.frequency === "weekly") d = addD(s, 7 * every * k);
      else if (r.frequency === "daily") d = addD(s, every * k);
      else {
        const months = r.frequency === "monthly" ? k * every : k * every * 12;
        const y = +s.slice(0, 4) + Math.floor((+s.slice(5, 7) - 1 + months) / 12), mo = (+s.slice(5, 7) - 1 + months) % 12 + 1;
        const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
        d = y + "-" + pad(mo) + "-" + pad(Math.min(r.anchor_day || +s.slice(8), last));
      }
      if (r.endDate && d > r.endDate) return null;
      if (d > TODAY) return d;
    }
    return null;
  };
  const live = rules.filter((r) => nextAfterToday(r));
  const billM = live.filter((r) => r.type === "expense").reduce((s, r) => s + Number(r.amount) * PER[r.frequency] / (r.interval || 1), 0);
  const incM = live.filter((r) => r.type === "income").reduce((s, r) => s + Number(r.amount) * PER[r.frequency] / (r.interval || 1), 0);

  console.log("Recurring at 1440 px");
  let page = await open(base, "/recurring");
  const k = (await page.locator(".rec-kpis .w-kpi").allInnerTexts()).map(sp);
  ok(k[0].includes(money(billM)), "Bills per month is " + money(billM) + " (" + k[0].replace(/\n/g, " ") + ")");
  ok(k[1].includes(money(incM)), "Recurring income per month is " + money(incM));
  ok(k[2].includes(Math.round(billM / incM * 100) + "%"), "Bills take " + Math.round(billM / incM * 100) + "% of income");
  ok(/\d+ charges until/.test(k[3]), "Next 30 days says how many charges");
  ok(await page.locator(".rec-cal .w-rday").count() === 35, "the calendar has five weeks");
  ok(await page.locator(".rec-cal .w-rday.t").count() === 1, "today is marked once");
  ok(await page.locator("#rec-list .w-rrow").count() >= 11, "the list shows the rules");
  ok((await text(page, "#rec-list")).includes("Bills and subscriptions") && (await text(page, "#rec-list")).includes("Income"), "bills and income groups");
  ok(await page.locator(".rec-endh").count() === 0, "replaced versions (old Netflix, old Spotify) are not listed as ended");
  const notice = await text(page, "#rec-notice");
  ok(/Netflix went up 2\.00 €/.test(notice) && /From 11\.99 € to 13\.99 €/.test(notice), "Wally noticed the Netflix price change");
  ok(/Holaluz looks monthly/.test(notice), "Wally noticed Holaluz repeats monthly");
  ok(/Aigües de Barcelona looks like every 2 months/.test(notice), "Wally noticed the water bill every 2 months");
  const netflixRow = page.locator(".w-rrow", { hasText: "Netflix" });
  ok(sp(await netflixRow.innerText()).includes("2.00 €") && await netflixRow.locator(".w-pill.bad").count() === 1, "the Netflix row shows the price rise");
  ok(await page.locator(".w-rrow", { hasText: "Holaluz" }).count() === 0, "payees without a rule are not rules");
  ok(await page.locator(".w-rrow.sel").count() === 1, "the first rule is selected on wide screens");
  await shot(page, "rec-1440");

  // Filters
  await page.click('#rec-tab [data-v="expense"]');
  ok(!(await text(page, "#rec-list")).includes("salary"), "Bills hides income");
  ok(await page.locator(".rec-cal .w-rday.in").count() === 0, "Bills: the calendar shows no money in");
  await page.click('#rec-tab [data-v="income"]');
  ok(await page.locator("#rec-list .w-rrow").count() === 2, "Income shows the two salaries");
  ok(!(await text(page, "#rec-notice")).includes("Netflix"), "Income hides bill notices");
  await page.click('#rec-tab [data-v="all"]');

  // Selecting from the calendar, the panel
  const netflix = byName("Netflix");
  const nxt = nextAfterToday(netflix);
  const cell = page.locator('.rec-cal [data-rd="' + nxt + '"]');
  if (await cell.count()) {
    await cell.click();
    ok(await cell.getAttribute("aria-pressed") === "true" && (await text(page, "#rec-day")).includes("Netflix"), "a calendar day lists what lands on it");
    await page.click('#rec-day [data-sel="' + netflix.id + '"]');
    ok((await text(page, "#rec-insp")).includes("Netflix"), "an item of the day opens its rule");
    await page.click("#rec-day [data-day-close]");
    ok(await page.locator("#rec-day").isHidden() && await cell.getAttribute("aria-pressed") === "false", "the day list closes");
  }
  await page.click('[data-sel="' + netflix.id + '"]');
  const insp = await text(page, "#rec-insp");
  ok(insp.includes("Every month on day 27"), "the panel describes the rule");
  ok(await page.locator("#rec-insp .w-next span").count() === 5, "the panel shows the next five dates");
  ok(/\d+ times, [\d,.]+ € paid so far\. Changed from 11\.99 € to 13\.99 €/.test(insp), "history counts both Netflix versions and the change");
  ok(await page.locator("#c-rhist svg rect").count() > 3, "history chart is drawn");
  ok(page.url().includes("?id=" + netflix.id), "the selection is in the address");
  await page.click('#rec-insp [data-act="edit"]');
  await page.waitForTimeout(200);
  let calls = await addCalls(page);
  ok(calls.length === 1 && calls[0].rule && calls[0].rule.id === netflix.id, "Edit opens the add sheet with the rule");
  await page.click("#rec-new");
  await page.waitForTimeout(200);
  calls = await addCalls(page);
  ok(calls[1] && calls[1].repeat === true && !calls[1].rule, "New rule opens the add sheet with Repeat on");
  await page.click('.w-li:has-text("Holaluz") [data-mk]');
  await page.waitForTimeout(200);
  calls = await addCalls(page);
  const mk = calls[2] || {};
  ok(mk.repeat && mk.name === "Holaluz" && mk.category === "Utilities" && mk.person === "1" && mk.date > TODAY && mk.date.slice(8) === "13" && mk.about === true && mk.amount > 40,
    "Make it a rule prefills the add sheet (" + JSON.stringify(mk) + ")");

  // Keyboard: arrows move the selection, E edits
  await page.locator(".w-rrow").first().click();
  await page.keyboard.press("ArrowDown");
  const second = await page.locator(".w-rrow").nth(1).getAttribute("data-rid");
  ok(await page.locator('.w-rrow[data-rid="' + second + '"]').getAttribute("aria-pressed") === "true", "↓ selects the next rule");
  await page.keyboard.press("e");
  await page.waitForTimeout(150);
  calls = await addCalls(page);
  ok(calls[3] && calls[3].rule && calls[3].rule.id === second, "E edits the selected rule");

  // Dismiss a notice; it stays dismissed after a reload (kept in the person's preferences)
  await page.click('.w-li:has-text("Aigües") [data-dis]');
  ok(!(await text(page, "#rec-notice")).includes("Aigües"), "a notice can be dismissed");
  await page.waitForTimeout(300);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("#rec-notice");
  ok(!(await text(page, "#rec-notice")).includes("Aigües"), "the dismissal is remembered");

  // Pause and resume
  const gym = byName("DiR Gym");
  await page.click('[data-rid="' + gym.id + '"]');
  await page.click('#rec-insp [data-act="pause"]');
  await page.waitForSelector('.w-rrow[data-rid="' + gym.id + '"] .w-badge');
  ok((await api("GET", "/recurring")).find((r) => r.id === gym.id).paused === true, "Pause pauses the rule on the server");
  ok((await text(page, "#toast")).includes("paused"), "a toast says it is paused");
  ok((await text(page, ".rec-kpis .w-kpi")).includes(money(billM - 39)), "a paused rule leaves the monthly total");
  ok((await text(page, "#rec-insp")).includes("Paused, nothing scheduled"), "the panel shows nothing scheduled");
  await page.click('#rec-insp [data-act="pause"]');
  await page.waitForTimeout(400);
  ok((await api("GET", "/recurring")).find((r) => r.id === gym.id).paused === false, "Resume resumes it");
  ok((await text(page, ".rec-kpis .w-kpi")).includes(money(billM)), "and it counts again");
  await page.click('#rec-insp [data-act="pause"]');
  await page.waitForTimeout(300);
  await page.click("#toast-undo");
  await page.waitForTimeout(500);
  ok((await api("GET", "/recurring")).find((r) => r.id === gym.id).paused === false, "Undo after Pause resumes it");

  // Dates missed while paused (set on the server as a resume after a long pause would)
  const simyo = byName("Simyo"), pepe = byName("Pepephone");
  const m1 = addD(TODAY.slice(0, 8) + "01", -10), m2 = addD(TODAY.slice(0, 8) + "01", -9);
  sql(db, "UPDATE recurringtransaction SET missed=? WHERE name='Simyo'", [JSON.stringify([m1, m2])]);
  sql(db, "UPDATE recurringtransaction SET missed=? WHERE name='Pepephone'", [JSON.stringify([m1])]);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("#rec-notice");
  ok((await text(page, "#rec-notice")).includes("Simyo skipped 2 dates while paused"), "skipped dates are offered once");
  const simyoBefore = (await api("GET", "/transactions/search?text=Simyo")).length;
  await page.click('#rec-notice [data-miss-add="' + simyo.id + '"]');
  await page.waitForTimeout(700);
  const simyoAfter = await api("GET", "/transactions/search?text=Simyo");
  ok(simyoAfter.length === simyoBefore + 2 && simyoAfter.some((x) => x.date === m1) && simyoAfter.some((x) => x.date === m2), "Add them adds the skipped dates");
  ok((await api("GET", "/recurring")).find((r) => r.id === simyo.id).missed === null, "and the offer is gone");
  ok(!(await text(page, "#rec-notice")).includes("Simyo skipped"), "the notice goes away");
  const pepeBefore = (await api("GET", "/transactions/search?text=Pepephone")).length;
  await page.click('#rec-notice [data-miss-no="' + pepe.id + '"]');
  await page.waitForTimeout(500);
  ok((await api("GET", "/transactions/search?text=Pepephone")).length === pepeBefore && (await api("GET", "/recurring")).find((r) => r.id === pepe.id).missed === null, "Dismiss adds nothing and clears the offer");

  // End on a date
  const swim = byName("Swimming lessons");
  await page.click('[data-rid="' + swim.id + '"]');
  await page.click('#rec-insp [data-act="end"]');
  await page.fill("#rec-end", addD(swim.startDate, -1));
  await page.click("[data-dlg-ok]");
  ok(await page.locator("#dlg-err").isVisible() && (await text(page, "#dlg-err")).includes("cannot end before it starts"), "End before the start is refused in the dialog");
  const endOn = addD(TODAY, 20);
  await page.fill("#rec-end", endOn);
  await page.click("[data-dlg-ok]");
  await page.waitForTimeout(500);
  ok((await api("GET", "/recurring")).find((r) => r.id === swim.id).endDate === endOn, "End sets the end date on the server");
  const chips = await page.locator("#rec-insp .w-next span").allInnerTexts();
  ok(chips.length >= 1 && chips.length < 5, "the panel shows only the dates before the end (" + chips.join(", ") + ")");
  ok((await text(page, "#rec-insp")).includes("Every 2 weeks on Saturday, until"), "the description says until when");

  // End today: it moves to the collapsed Ended group
  const digi = byName("Digi Fibra");
  await page.click('[data-rid="' + digi.id + '"]');
  await page.click('#rec-insp [data-act="end"]');
  await page.fill("#rec-end", TODAY);
  await page.click("[data-dlg-ok]");
  await page.waitForTimeout(500);
  ok(await page.locator(".rec-endh").count() === 1, "an ended rule goes into an Ended group");
  ok(await page.locator(".rec-endh").getAttribute("aria-expanded") === "true", "the group opens while its rule is selected");
  await page.click('[data-rid="' + netflix.id + '"]');
  await page.click(".rec-endh");
  ok(await page.locator('[data-rid="' + digi.id + '"]').count() === 0, "the Ended group collapses");
  await page.click(".rec-endh");
  ok(await page.locator('[data-rid="' + digi.id + '"] .w-badge').innerText() === "Ended", "and opens to show it, marked Ended");

  // Delete, keeping past transactions
  const pepeTx = await api("GET", "/transactions/search?text=Pepephone");
  await page.click('[data-rid="' + pepe.id + '"]');
  await page.click('#rec-insp [data-act="del"]');
  ok((await text(page, "#dlg")).includes("Keep past transactions") && (await text(page, "#dlg")).includes("Delete them too"), "Delete asks about past transactions");
  await page.click("[data-dlg-ok]");
  await page.waitForTimeout(700);
  const pepeLeft = await api("GET", "/transactions/search?text=Pepephone");
  ok(!(await api("GET", "/recurring")).some((r) => r.id === pepe.id), "the rule is deleted");
  ok(pepeLeft.length === pepeTx.length && pepeLeft.every((x) => !x.recurringID), "past transactions stay, as ordinary ones");
  ok(await page.locator('[data-rid="' + pepe.id + '"]').count() === 0, "it leaves the list");
  ok(!page.url().includes("?id="), "the address no longer points at it");

  // Delete, with its transactions
  await page.click('[data-rid="' + gym.id + '"]');
  await page.click('#rec-insp [data-act="del"]');
  await page.check('input[name="rec-del"][value="all"]');
  await page.click("[data-dlg-ok]");
  await page.waitForTimeout(700);
  ok((await api("GET", "/transactions/search?text=DiR%20Gym")).length === 0, "Delete them too removes its transactions");
  ok((await text(page, "#toast")).includes("Deleted DiR Gym and its"), "a toast says what went");

  // The person switch
  await page.click('.w-side [data-scope="2"]');
  await page.waitForTimeout(300);
  const ana = await text(page, "#rec-list");
  ok(!ana.includes("Alex salary") && ana.includes("Ana salary"), "Ana: Alex's salary is not hers");
  ok(sp(await page.locator('.w-rrow', { hasText: "Rent" }).innerText()).includes("625.00 €"), "Ana: shared rent counts her half");
  await page.click('.w-side [data-scope="all"]');
  await done(page, "1440 px");

  console.log("Deep link and the slide-over panel at 1100 px");
  page = await open(base, "/recurring?id=" + netflix.id, { width: 1100 });
  ok(await page.locator("#rec-insp.open").isVisible(), "a link with ?id opens the rule");
  ok(await page.locator(".rec-scrim").isVisible(), "over a scrim");
  await page.keyboard.press("Escape");
  ok(!(await page.locator("#rec-insp").isVisible()), "Escape closes it");
  ok(await page.evaluate(() => document.activeElement && document.activeElement.dataset.rid) === netflix.id, "focus goes back to the row");
  await page.locator(".w-rrow").nth(2).click();
  ok(await page.locator("#rec-insp.open").isVisible(), "a row opens the panel");
  await page.click("#rec-insp [data-close]");
  ok(!(await page.locator("#rec-insp").isVisible()), "× closes it");
  await shot(page, "rec-1100");
  await done(page, "1100 px");

  console.log("900 px, dark");
  page = await open(base, "/recurring", { width: 900, theme: "dark" });
  ok(await page.locator(".rec-top").evaluate((n) => getComputedStyle(n).gridTemplateColumns.split(" ").length) === 1, "one column under 1024 px");
  await page.locator(".w-rrow").first().click();
  ok(await page.locator("#rec-insp.open").isVisible(), "the panel slides over");
  await shot(page, "rec-900-dark");
  await done(page, "900 px dark");

  console.log("Phone, 390 px");
  page = await open(base, "/recurring", { width: 390, height: 844 });
  ok(await page.locator(".w-pchips").isVisible(), "person chips at the top");
  ok(!(await page.locator(".w-rrow .rec-spark").first().isVisible()), "rows drop the sparkline");
  ok(/in \d+ days|tomorrow|today/.test(await page.locator(".w-rrow .rec-nxm").first().innerText()), "rows say when the next one is");
  await page.locator(".w-rrow", { hasText: "Netflix" }).click();
  const sheet = page.locator("#rec-insp.open");
  ok(await sheet.isVisible() && (await sheet.boundingBox()).width === 390, "the rule opens as a full-screen sheet");
  const st = await sheet.innerText();
  ok(st.includes("Price went up") && st.includes("Next") && st.includes("Last charges"), "the sheet shows the price change, next dates and last charges");
  await shot(page, "rec-390-rule");
  await page.click('#rec-insp [data-act="pause"]');
  await page.waitForTimeout(400);
  ok((await api("GET", "/recurring")).find((r) => r.id === netflix.id).paused === true, "Pause works from the sheet");
  await page.click('#rec-insp [data-act="pause"]');
  await page.waitForTimeout(400);
  await page.click("#rec-insp [data-close]");
  ok(!(await sheet.isVisible()), "‹ Recurring closes the sheet");
  await page.click('.w-pchips [data-scope="1"]');
  ok(!(await text(page, "#rec-list")).includes("Ana salary"), "the chips switch the person");
  await shot(page, "rec-390");
  await done(page, "390 px");

  console.log("Bills that vary");
  const water = await api("POST", "/recurring", { name: "Aigües de Barcelona", category: "Utilities", amount: "35.00", type: "expense", startDate: addD(TODAY, 3), frequency: "monthly", interval: 2, about: true, tags: [], person_id: 2 });
  page = await open(base, "/recurring?id=" + water.id);
  ok(/about 35\.00 €/.test(await text(page, '[data-rid="' + water.id + '"]')) && /about/.test(await text(page, "#rec-insp .rec-iamt")), "a bill that varies shows “about” its amount");
  ok((await text(page, '[data-rid="' + water.id + '"]')).includes("17.50 € a month"), "every 2 months counts half a month");
  ok((await text(page, "#rec-insp")).includes("Nothing added yet. The first one is on"), "a new rule says when its first charge is");
  await done(page, "varying bill");

  console.log("Arabic");
  await api("PUT", "/language/ar");
  page = await open(base, "/recurring", { width: 1440 });
  ok(await page.evaluate(() => document.documentElement.dir) === "rtl", "right to left");
  const box = await page.locator(".rec-body .rec-list").boundingBox(), ib = await page.locator("#rec-insp").boundingBox();
  ok(ib.x < box.x, "the panel sits on the left in Arabic");
  await shot(page, "rec-ar");
  await done(page, "Arabic");
  await api("PUT", "/language/en");

  console.log("No rules");
  for (const r of await api("GET", "/recurring")) await api("DELETE", "/recurring/" + r.id, { applyTo: "future" });
  page = await open(base, "/recurring");
  ok((await text(page, "#rec-page")).includes("Nothing repeats yet"), "the empty state explains rules");
  ok((await text(page, "#rec-page")).includes("looks monthly"), "Wally still offers payees that repeat");
  ok(await page.locator("#rec-tab").isHidden(), "no filter without rules");
  await page.click("#rec-page [data-new]");
  await page.waitForTimeout(150);
  ok((await addCalls(page))[0].repeat === true, "the empty state's New rule opens the add sheet");
  await shot(page, "rec-empty");
  await done(page, "no rules");

  const empty = await startServer(PORT + 50, false);
  const H2 = { "Content-Type": "application/json" };
  const p1 = await (await fetch(empty.base + "/api/people", { method: "POST", headers: H2, body: JSON.stringify({ name: "Sam" }) })).json();
  page = await open(empty.base, "/recurring", { person: String(p1.id) });
  ok((await text(page, "#rec-page")).includes("Nothing repeats yet") && await page.locator(".w-pchips").count() === 0, "a new household of one: empty state, no person switch");
  await done(page, "empty household");
} catch (e) {
  failures++;
  console.log("  FAIL " + (e && e.stack || e));
} finally {
  await browser.close();
  servers.forEach((p) => p.kill());
}
console.log(failures ? failures + " failed" : "all passed");
process.exit(failures ? 1 : 0);
