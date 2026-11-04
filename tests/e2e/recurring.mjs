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
const money0 = (n) => (Math.round(n) < 0 ? "−" : "") + new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(Math.abs(Math.round(n))) + " €";
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
  const sum = await text(page, ".rec-sum");
  ok((await text(page, ".rec-big")) === money0(billM), "Bills: one total, every month, " + money0(billM) + " (" + sum.replace(/\n/g, " ") + ")");
  ok(sum.includes(Math.round(billM / incM * 100) + "% of what comes in"), "and the share of income: " + Math.round(billM / incM * 100) + "%");
  ok(/in the next 30 days/.test(sum), "and what the next 30 days hold");
  ok(await page.locator(".rec-kpis,.w-kpi").count() === 0, "no row of key figures");
  ok((await page.locator(".rec-ctl-h [data-rtab]").allInnerTexts()).join("|") === "Bills|Income", "Bills and Income in the toolbar, no All");
  ok(await page.locator(".rec-ctl-h [data-rview]").count() === 2 && await page.locator(".rec-ctl-p").isHidden(), "a List | Calendar switch beside them; no second row on desktop");
  ok(await page.locator(".rec-cal").count() === 0, "the list shows first");
  ok(await page.locator("#rec-list .w-rrow").count() >= 9, "the list shows the bills");
  ok((await text(page, "#rec-list")).includes("Next 7 days") && !(await text(page, "#rec-list")).includes("salary"), "bills in time order, from the next 7 days; no income");
  ok(await page.locator(".rec-endh").count() === 0, "replaced versions (old Netflix, old Spotify) are not listed as ended");
  ok(await page.locator(".rec-nb,#rec-notice").count() === 0 && !(await text(page, "#rec-page")).includes("looks monthly"), "no Wally noticed banner");
  const netflixRow = page.locator(".w-rrow", { hasText: "Netflix" });
  ok(sp(await netflixRow.innerText()).includes("2.00 €") && await netflixRow.locator(".amt .up-bad").count() === 1, "the Netflix row shows the price rise under its amount");
  ok(await page.locator(".w-rrow", { hasText: "Holaluz" }).count() === 0, "payees without a rule are not rules");
  ok(await page.locator(".w-rrow.sel").count() === 1, "the first rule is selected on wide screens");
  const panel = await text(page, "#rec-insp");
  ok(await page.locator("#rec-insp .rec-edit").isVisible() && panel.includes("Recurring bill"), "the panel: Edit at the top right");
  ok((await page.locator("#rec-insp .w-pacts button").allInnerTexts()).join("|") === "Pause|End on a date…|Delete bill", "actions as rows, Delete bill last");
  ok(await page.locator("#rec-insp .w-pacts button.red").innerText() === "Delete bill", "Delete in red");
  ok(await page.locator("#rec-insp .w-next span").count() === 0 && /Next\s*\n?\s*\w{3}, \w{3} \d+/.test(panel), "dates as text, not pills");
  ok(/Last charges/.test(panel) && await page.locator("#rec-insp .rec-sec2 .rec-kv .amt").count() >= 1 && /\d+ times?, [\d,.]+ € paid so far/.test(panel), "Last charges: dates with amounts, the running total under them");
  await shot(page, "rec-1440");

  // The calendar replaces the list
  await page.click(".rec-ctl-h [data-rview=cal]");
  ok(await page.locator("#rec-list").count() === 0 && await page.locator(".rec-cal .w-rday").count() === 35, "Calendar: five weeks in the list's place");
  ok(await page.locator(".rec-cal .w-rday.t").count() === 1, "today is marked once");
  ok(await page.locator(".rec-cal .w-rday.sel").count() === 1 && (await text(page, "#rec-day")).includes("Pick a bill to see it here"), "it opens on the next day with a bill, listed beside it");
  ok(!(await text(page, ".rec-calp")).includes("Click"), "no explanation under the calendar");
  await shot(page, "rec-1440-cal");
  await page.click(".rec-ctl-h [data-rview=list]");
  // Bills and Income
  ok(await page.locator(".rec-cal .w-rday.in").count() === 0, "Bills: the calendar shows no money in");
  await page.click('.rec-ctl-h [data-rtab="income"]');
  ok(await page.locator("#rec-list .w-rrow").count() === 2, "Income shows the two salaries");
  ok((await text(page, ".rec-big")) === money0(incM), "Income: its own total, " + money0(incM));
  ok(!(await text(page, "#rec-page")).includes("Netflix went up"), "Income hides bill notices");
  ok((await text(page, "#rec-insp")).includes("Recurring income"), "the panel follows the tab");
  await page.click('.rec-ctl-h [data-rtab="expense"]');

  // Selecting from the calendar, the panel
  const netflix = byName("Netflix");
  const nxt = nextAfterToday(netflix);
  await page.click(".rec-ctl-h [data-rview=cal]");
  const cell = page.locator('.rec-cal [data-rd="' + nxt + '"]');
  if (await cell.count()) {
    await cell.click();
    ok(await cell.getAttribute("aria-pressed") === "true" && (await text(page, "#rec-day")).includes("Netflix"), "a calendar day lists what lands on it");
    await page.click('#rec-day [data-sel="' + netflix.id + '"]');
    ok((await text(page, "#rec-insp")).includes("Netflix") && await page.locator("#rec-insp [data-to-day]").isVisible(), "an item of the day opens its rule in the same panel, with the day a tap away");
    await page.click("#rec-insp [data-to-day]");
    ok((await text(page, "#rec-day")).includes("Netflix"), "‹ the day goes back to it");
  }
  await page.click(".rec-ctl-h [data-rview=list]");
  await page.click('[data-rid="' + netflix.id + '"]');
  const insp = await text(page, "#rec-insp");
  ok(insp.includes("Every month on day 27"), "the panel describes the rule");
  ok(!insp.includes("Then") && (insp.match(/in \d+ days/g) || []).length === 2, "Next: two dates, each with how far off it is");
  ok(/\d+ times, [\d,.]+ € paid so far/.test(insp) && /Price went up\s*From 11\.99 € to 13\.99 €/.test(insp) && await page.locator("#rec-insp .rec-pcard").count() === 1, "history counts both Netflix versions, and the price change has its own line");
  ok(await page.locator("#rec-insp .rec-hbars i").count() >= 2 && await page.locator("#rec-insp .rec-hbars i.on").count() === 1, "the price moved, so the history bars show, the latest one in the accent");
  ok(page.url().includes("?id=" + netflix.id), "the selection is in the address");
  await page.click('#rec-insp [data-act="edit"]');
  await page.waitForTimeout(200);
  let calls = await addCalls(page);
  ok(calls.length === 1 && calls[0].rule && calls[0].rule.id === netflix.id, "Edit opens the add sheet with the rule");
  ok(await page.locator("#rec-new").count() === 0, "no New rule button: Add with Repeat makes one");

  // Keyboard: arrows move the selection, E edits
  await page.locator(".w-rrow").first().click();
  await page.keyboard.press("ArrowDown");
  const second = await page.locator(".w-rrow").nth(1).getAttribute("data-rid");
  ok(await page.locator('.w-rrow[data-rid="' + second + '"]').getAttribute("aria-pressed") === "true", "↓ selects the next rule");
  await page.keyboard.press("e");
  await page.waitForTimeout(150);
  calls = await addCalls(page);
  ok(calls[1] && calls[1].rule && calls[1].rule.id === second, "E edits the selected rule");

  // Pause and resume
  const gym = byName("DiR Gym");
  await page.click('[data-rid="' + gym.id + '"]');
  await page.click('#rec-insp [data-act="pause"]');
  await page.waitForSelector('.w-rrow.off[data-rid="' + gym.id + '"]');
  ok((await api("GET", "/recurring")).find((r) => r.id === gym.id).paused === true, "Pause pauses the rule on the server");
  ok((await text(page, "#toast")).includes("paused"), "a toast says it is paused");
  ok((await text(page, ".rec-big")) === money0(billM - 39), "a paused rule leaves the monthly total");
  ok((await text(page, "#rec-list")).includes("Paused"), "and waits in a Paused group");
  ok(/Next\s*Paused/.test(await text(page, "#rec-insp")) && await page.locator("#rec-insp .w-badge").innerText() === "Paused", "the panel says it is paused, with nothing next");
  await page.click('#rec-insp [data-act="pause"]');
  await page.waitForTimeout(400);
  ok((await api("GET", "/recurring")).find((r) => r.id === gym.id).paused === false, "Resume resumes it");
  ok((await text(page, ".rec-big")) === money0(billM), "and it counts again");
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
  await page.goto(base + "/recurring?id=" + simyo.id, { waitUntil: "networkidle" });
  await page.waitForSelector("#rec-insp .rec-miss");
  ok((await text(page, "#rec-insp .rec-miss")).includes("2 dates were skipped while paused"), "the rule offers its skipped dates");
  const simyoBefore = (await api("GET", "/transactions/search?text=Simyo")).length;
  await page.click('#rec-insp [data-miss-add="' + simyo.id + '"]');
  await page.waitForTimeout(700);
  const simyoAfter = await api("GET", "/transactions/search?text=Simyo");
  ok(simyoAfter.length === simyoBefore + 2 && simyoAfter.some((x) => x.date === m1) && simyoAfter.some((x) => x.date === m2), "Add them adds the skipped dates");
  ok((await api("GET", "/recurring")).find((r) => r.id === simyo.id).missed === null, "and the offer is gone");
  ok(await page.locator("#rec-insp .rec-miss").count() === 0, "the offer goes away");
  const pepeBefore = (await api("GET", "/transactions/search?text=Pepephone")).length;
  await page.click('[data-rid="' + pepe.id + '"]');
  await page.click('#rec-insp [data-miss-no="' + pepe.id + '"]');
  await page.waitForTimeout(500);
  ok((await api("GET", "/transactions/search?text=Pepephone")).length === pepeBefore && (await api("GET", "/recurring")).find((r) => r.id === pepe.id).missed === null, "Dismiss adds nothing and clears the offer");

  // End on a date
  const swim = byName("Swimming lessons");
  await page.click('[data-rid="' + swim.id + '"]');
  await page.click('#rec-insp [data-act="end"]');
  await page.fill("#rec-end", addD(swim.startDate, -1));
  await page.click("[data-dlg-ok]");
  ok((await text(page, "#dlg .w-shh")).includes("End Swimming lessons") && (await page.locator("#dlg [data-dlg-ok]").innerText()) === "End", "End is a sheet: Cancel · title · End");
  ok(Math.round((await page.locator("#dlg .w-dialog").boundingBox()).width) === 420, "the End sheet is a narrow one");
  ok(await page.locator("#dlg-err").isVisible() && (await text(page, "#dlg-err")).includes("cannot end before it starts"), "End before the start is refused in the dialog");
  const endOn = addD(TODAY, 20);
  await page.fill("#rec-end", endOn);
  await page.click("[data-dlg-ok]");
  await page.waitForTimeout(500);
  ok((await api("GET", "/recurring")).find((r) => r.id === swim.id).endDate === endOn, "End sets the end date on the server");
  const then = await page.locator("#rec-insp .rec-kv", { hasText: "Then" }).count() ? await page.locator("#rec-insp .rec-kv", { hasText: "Then" }).locator("b").innerText() : "";
  ok(then.split(",").filter(Boolean).length < 3, "the panel shows only the dates before the end (" + then + ")");
  // The demo starts the lessons on a day relative to today, so the weekday comes from the rule
  const swimDay = new Date(swim.startDate + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  ok((await text(page, "#rec-insp")).includes("Every 2 weeks on " + swimDay + ", until"), "the description says until when (" + swimDay + ")");

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
  ok((await page.locator('[data-rid="' + digi.id + '"] .rec-rn p').innerText()).startsWith("Ended"), "and opens to show it, marked Ended");

  // Delete, keeping past transactions
  const pepeTx = await api("GET", "/transactions/search?text=Pepephone");
  await page.click('[data-rid="' + pepe.id + '"]');
  await page.click('#rec-insp [data-act="del"]');
  const dl = await text(page, "#dlg");
  ok(await page.locator("#dlg .w-alert.rec-del3").count() === 1 && dl.includes("Delete Pepephone?") && dl.includes("can stay as ordinary ones"), "Delete is an alert that asks about past transactions");
  ok((await page.locator("#dlg [data-dlg-ok]").innerText()) === "Delete bill only" && /Delete bill and its \d+ transactions/.test(await page.locator("#dlg [data-delall]").innerText()), "two answers, keeping them first");
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
  await page.click("#dlg [data-delall]");
  await page.waitForTimeout(700);
  ok((await api("GET", "/transactions/search?text=DiR%20Gym")).length === 0, "Delete them too removes its transactions");
  ok((await text(page, "#toast")).includes("Deleted DiR Gym and its"), "a toast says what went");

  // The person switch
  await page.click(".rec-head .w-pswitch-b"); await page.click('.rec-head .w-pswitch-m [data-scope="2"]');
  await page.waitForTimeout(300);
  ok(sp(await page.locator('.w-rrow', { hasText: "Rent" }).innerText()).includes("625.00 €"), "Ana: shared rent counts her half");
  await page.click('.rec-ctl-h [data-rtab="income"]');
  const ana = await text(page, "#rec-list");
  ok(!ana.includes("Alex salary") && ana.includes("Ana salary"), "Ana: Alex's salary is not hers");
  await page.click('.rec-ctl-h [data-rtab="expense"]');
  await page.click(".rec-head .w-pswitch-b"); await page.click('.rec-head .w-pswitch-m [data-scope="all"]');
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
  await page.click(".rec-ctl-h [data-rview=cal]");
  ok(await page.locator(".rec-body").evaluate((n) => getComputedStyle(n).gridTemplateColumns.split(" ").length) === 1, "one column under 1024 px: the day under the calendar");
  await page.click(".rec-ctl-h [data-rview=list]");
  await page.locator(".w-rrow").first().click();
  ok(await page.locator("#rec-insp.open").isVisible(), "the panel slides over");
  await shot(page, "rec-900-dark");
  await done(page, "900 px dark");

  console.log("Phone, 390 px");
  page = await open(base, "/recurring", { width: 390, height: 844 });
  ok(await page.locator(".rec-head .w-pswitch").isVisible(), "the person switch at the top right");
  ok(await page.locator(".rec-spark").count() === 0, "no sparklines: the history is in each rule");
  ok(/Today|Tomorrow|day|[A-Z][a-z]{2} \d+/.test(await page.locator(".w-rrow .rec-rn p").first().innerText()), "rows say when the next one is: " + await page.locator(".w-rrow .rec-rn p").first().innerText());
  await page.locator(".w-rrow", { hasText: "Netflix" }).click();
  const sheet = page.locator("#rec-insp.open");
  ok(await sheet.isVisible() && (await sheet.boundingBox()).width === 390, "the rule opens as a full-screen sheet");
  const st = await sheet.innerText();
  ok(st.includes("Price went up") && st.includes("Next") && st.includes("Last charges"), "the page shows the price change, next dates and last charges");
  ok(st.includes("Every month on day 27") && await page.locator("#rec-insp .w-gr.red").innerText() === "Delete bill", "it describes the rule; Delete bill alone in its group, in red");
  ok(await page.locator(".w-tabbar").isVisible(), "the tab bar stays, as on a pushed page");
  await shot(page, "rec-390-rule");
  await page.click('#rec-insp [data-act="pause"]');
  await page.waitForTimeout(400);
  ok((await api("GET", "/recurring")).find((r) => r.id === netflix.id).paused === true, "Pause works from the sheet");
  await page.click('#rec-insp [data-act="pause"]');
  await page.waitForTimeout(400);
  await page.click("#rec-insp [data-close]");
  ok(!(await sheet.isVisible()), "‹ Recurring closes the sheet");
  await page.click(".w-pswitch-b");
  await page.click('.w-pswitch-m [data-scope="1"]');
  await page.waitForTimeout(300);
  await page.click('.rec-ctl-p [data-rtab="income"]');
  ok(!(await text(page, "#rec-list")).includes("Ana salary"), "the switch changes the person");
  await page.click('.rec-ctl-p [data-rtab="expense"]');
  await page.click(".rec-ctl-p [data-rview=cal]");
  ok(await page.locator(".rec-cal").isVisible() && (await text(page, "#rec-day h4")).length > 0, "Calendar on the phone: the picked day under it");
  await shot(page, "rec-390");
  await done(page, "390 px");

  console.log("Bills that vary");
  const water = await api("POST", "/recurring", { name: "Aigües de Barcelona", category: "Utilities", amount: "35.00", type: "expense", startDate: addD(TODAY, 3), frequency: "monthly", interval: 2, about: true, tags: [], person_id: 2 });
  page = await open(base, "/recurring?id=" + water.id);
  ok(/about 35\.00 €/.test(await text(page, '[data-rid="' + water.id + '"]')) && /about/.test(await text(page, "#rec-insp .rec-iamt")), "a bill that varies shows “about” its amount");
  ok((await text(page, '[data-rid="' + water.id + '"]')).includes("17.50 € a month"), "every 2 months counts half a month");
  ok(/Nothing added yet/.test(await text(page, "#rec-insp")) && /Next\s*\n?\s*\w{3}, \w{3} \d+\s*\n?\s*in 3 days/.test(await text(page, "#rec-insp")), "a new rule: nothing added yet, and Next says when its first charge is");
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
  ok(await page.locator(".rec-ctl-h").isHidden() && await page.locator(".rec-ctl-p").isHidden(), "no Bills | Income or List | Calendar without rules");
  await page.click("#rec-page [data-new]");
  await page.waitForTimeout(150);
  ok((await addCalls(page))[0].repeat === true, "the empty state's New rule opens the add sheet");
  await shot(page, "rec-empty");
  await done(page, "no rules");

  const empty = await startServer(PORT + 50, false);
  const H2 = { "Content-Type": "application/json" };
  const p1 = await (await fetch(empty.base + "/api/people", { method: "POST", headers: H2, body: JSON.stringify({ name: "Sam" }) })).json();
  page = await open(empty.base, "/recurring", { person: String(p1.id) });
  ok((await text(page, "#rec-page")).includes("Nothing repeats yet") && !(await page.locator(".w-pswitch").first().isVisible()), "a new household of one: empty state, no person switch");
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
