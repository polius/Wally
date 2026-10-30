/* Budgets (2.1) and savings goals (2.2), on a real demo server.
   Every figure is checked against a hand calculation from the API's ledger: flexible pace and
   per-day amounts, roll over, once a year, suggestions, the person switch, goals.
     REPO=/path/to/Wally PYTHON=/path/to/python PORT=8804 node budgets.mjs
   Screenshots go to SHOTS (a folder) when it is set. */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
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
const now = new Date();
const TODAY = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
const [CY, CM] = [now.getFullYear(), now.getMonth() + 1];
const dim = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const ymAdd = (y, m, k) => { const t = y * 12 + m - 1 + k; return [Math.floor(t / 12), (t % 12) + 1]; };
const ds = (y, m, d) => y + "-" + pad(m) + "-" + pad(d);
const sp = (s) => s.replace(/[  ]/g, " ");
const f0 = (n) => (Math.round(n) < 0 ? "−" : "") + new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(Math.abs(Math.round(n))) + " €";
const f2 = (n) => new Intl.NumberFormat("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n)) + " €";
const MONTH = (y, m) => new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(Date.UTC(y, m - 1, 15));

async function startServer(port) {
  const data = mkdtempSync(join(tmpdir(), "wally-bud-"));
  const proc = spawn(PYTHON, ["-m", "uvicorn", "utils.dev_server:app", "--port", String(port)], { cwd: REPO, env: { ...process.env, WALLY_DATA: data, DEMO: "true" }, stdio: "ignore" });
  servers.push(proc);
  const base = "http://localhost:" + port;
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(base + "/api/auth/status"); if (r.ok) return base; } catch (e) { /* not yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server on " + port + " did not start");
}

const browser = await chromium.launch();
async function open(base, path, { width = 1440, height = 900, theme = "light" } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme, serviceWorkers: "block" });
  await ctx.addInitScript(() => { if (!sessionStorage.getItem("init")) { localStorage.setItem("wally.person", "1"); localStorage.removeItem("wally.scope"); sessionStorage.setItem("init", "1"); } });
  const page = await ctx.newPage();
  page.errors = [];
  page.on("console", (m) => { if (m.type() === "error") page.errors.push(m.text()); });
  page.on("pageerror", (e) => page.errors.push("PAGEERROR " + e.message));
  await page.goto(base + path, { waitUntil: "networkidle" });
  await page.waitForSelector(".bud-goals");
  return page;
}
async function shot(page, name) { if (SHOTS) await page.screenshot({ path: join(SHOTS, name + ".png"), fullPage: true }); }
const text = async (page, sel) => sp(await page.locator(sel).first().innerText());
async function done(page, label) { ok(page.errors.length === 0, label + ": no console errors" + (page.errors.length ? " — " + page.errors.join(" | ") : "")); await page.context().close(); }
const settle = (page) => page.waitForTimeout(450);

try {
  const base = await startServer(PORT);
  const H = { "Content-Type": "application/json", "X-Wally-Person": "1" };
  const api = async (method, path, body) => { const r = await fetch(base + "/api" + path, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) }); return r.json(); };
  const people = await api("GET", "/people");
  const L = await api("GET", "/ledger");
  const col = Object.fromEntries(L.columns.map((c, i) => [c, i]));
  const tx = L.rows.map((r) => ({ d: r[col.date], c: r[col.category], cents: r[col.cents], type: r[col.type], p: r[col.person_id] ?? null, sh: r[col.shares] || null }));
  /* What someone spent: their own, plus their share of shared costs */
  const spent = (cat, from, to, who = "all") => tx.reduce((s, x) => {
    if (x.type !== "e" || x.c !== cat || x.d < from || x.d > to) return s;
    if (who === "all" || String(x.p) === who) return s + x.cents / 100;
    if (x.p === null) return s + (x.sh ? (x.sh[who] || 0) : x.cents / people.length) / 100;
    return s;
  }, 0);
  const budgets0 = await api("GET", "/budgets");
  const B = Object.fromEntries(budgets0.map((b) => [b.category, b]));
  const day = +TODAY.slice(8), D = dim(CY, CM), a = ds(CY, CM, 1), daysLeft = D - day + 1;
  const [PY, PM] = ymAdd(CY, CM, -1), pa = ds(PY, PM, 1), pe = ds(PY, PM, dim(PY, PM));
  function expect(who) {
    const k = who === "all" ? 1 : 1 / people.length;
    const flex = budgets0.filter((b) => b.kind === "flexible").map((b) => {
      const base_ = Number(b.amount) * k, carry = b.rollover ? base_ - spent(b.category, pa, pe, who) : 0, v = spent(b.category, a, TODAY, who);
      return { c: b.category, budget: base_ + carry, carry, v };
    });
    const fb = flex.reduce((s, x) => s + x.budget, 0), fs = flex.reduce((s, x) => s + x.v, 0);
    return { flex, fb, fs, left: fb - fs, perDay: (fb - fs) / daysLeft, k };
  }

  console.log("Budgets, this month, everyone");
  let page = await open(base, "/budgets");
  let E = expect("all");
  let sum = await text(page, ".bud-sum");
  ok(sum.includes(f2(Math.max(E.left, 0))), "flexible left is " + f2(E.left) + " (" + sum.split("\n").slice(0, 3).join(" ") + ")");
  const forDays = daysLeft + (daysLeft === 1 ? " day" : " days");
  ok(sum.includes("of " + f0(E.fb) + ", " + f0(E.perDay) + " a day for " + forDays), "of " + f0(E.fb) + ", " + f0(E.perDay) + " a day for " + forDays);
  const tick = await page.locator(".bud-sum .w-budbar > i").evaluate((n) => n.style.insetInlineStart);
  ok(Math.abs(parseFloat(tick) - day / D * 100) < 0.1, "the pace tick is at day " + day + " of " + D);
  for (const x of E.flex) {
    const r = sp(await page.locator(".w-brow", { hasText: x.c }).first().innerText());
    const label = x.v > x.budget ? f0(x.v - x.budget) + " over" : f0(x.budget - x.v) + " left";
    ok(r.includes(label) && r.includes(f0(x.v) + " of " + f0(x.budget)), x.c + ": " + label + ", " + f0(x.v) + " of " + f0(x.budget));
    if (x.carry) ok(r.includes((x.carry > 0 ? "+" : "−") + f0(Math.abs(x.carry)) + " rolled over"), x.c + " rolls over " + f0(x.carry) + " from last month");
  }
  ok(!/Fixed|How it works/.test(await text(page, "main")), "no Fixed budgets and no How it works card");
  const tv = spent("Travel", ds(CY, 1, 1), TODAY);
  const travel = sp(await page.locator(".w-brow", { hasText: "Travel" }).innerText());
  ok(travel.includes((tv > 2400 ? f0(tv - 2400) + " over for " : f0(2400 - tv) + " left for ") + CY) && travel.includes("Set aside 200 € a month"), "Travel, once a year: " + f0(tv) + " of 2,400 € this year");
  ok((await page.locator('.w-brow[href*="cat=Groceries"]').getAttribute("href")).includes("mode=custom&from=" + a), "a flexible row links to its transactions this month");
  await shot(page, "bud-1440");

  // The person switch: budgets count an even share, shared costs count by share
  await page.click('.w-side [data-scope="2"]');
  await settle(page);
  E = expect("2");
  sum = await text(page, ".bud-sum");
  ok(sum.includes("of " + f0(E.fb)) && sum.includes(f2(Math.max(E.left, 0))) && (E.left > 0 || sum.includes("Already " + f0(-E.left) + " over")),
    "Ana: " + (E.left > 0 ? f2(E.left) + " left" : f0(-E.left) + " over") + " of " + f0(E.fb));
  const food = E.flex.find((x) => x.c === "Food");
  ok(sp(await page.locator(".w-brow", { hasText: "Food" }).innerText()).includes(f0(food.v) + " of " + f0(food.budget)), "Ana: Food " + f0(food.v) + " of " + f0(food.budget) + " (her half plus her roll over)");
  await page.click('.w-side [data-scope="all"]');
  await settle(page);

  // Last month
  await page.click('[data-step="-1"]');
  ok((await text(page, ".bud-head h3")).includes(MONTH(PY, PM)), "the arrows go to " + MONTH(PY, PM));
  const [P2Y, P2M] = ymAdd(PY, PM, -1), p2a = ds(P2Y, P2M, 1), p2e = ds(P2Y, P2M, dim(P2Y, P2M));
  const flexPrev = budgets0.filter((b) => b.kind === "flexible").map((b) => { const base_ = Number(b.amount); return { budget: base_ + (b.rollover ? base_ - spent(b.category, p2a, p2e) : 0), v: spent(b.category, pa, pe) }; });
  const lp = flexPrev.reduce((s, x) => s + x.budget - x.v, 0);
  sum = await text(page, ".bud-sum");
  ok(sum.includes(MONTH(PY, PM) + " ended " + f0(Math.abs(lp)) + (lp >= 0 ? " under" : " over") + " the flexible budget."), "last month ended " + f0(lp) + (lp >= 0 ? " under" : " over"));
  ok(await page.locator(".bud-sum .w-budbar > i").count() === 0, "no pace tick for a finished month");
  ok(await page.locator('[data-step="1"]').isEnabled(), "forward is possible from last month");
  await page.keyboard.press("ArrowRight");
  ok((await text(page, ".bud-head h3")).includes(MONTH(CY, CM)), "→ comes back to this month");
  ok(await page.locator('[data-step="1"]').isDisabled(), "no months after this one");

  // Use suggestions: flexible budgets become the average of the last 6 complete months
  const sugg = {};
  for (const b of budgets0.filter((x) => x.kind === "flexible")) {
    let s = 0;
    for (let i = 1; i <= 6; i++) { const [y, m] = ymAdd(CY, CM, -i); s += spent(b.category, ds(y, m, 1), ds(y, m, dim(y, m))); }
    sugg[b.category] = s > 0 ? Math.max(10, Math.round(s / 6 / 10) * 10) : 0;
  }
  await page.click("[data-sugg]");
  await settle(page);
  let now_ = Object.fromEntries((await api("GET", "/budgets")).map((b) => [b.category, b]));
  ok(Object.keys(sugg).every((c) => Number(now_[c].amount) === sugg[c]), "Use suggestions sets " + JSON.stringify(sugg));
  ok(Number(now_.Travel.amount) === 2400, "once-a-year budgets are left alone");
  ok((await text(page, "#toast")).includes("average of the last 6 months"), "a toast says what happened");
  await page.click("#toast-undo");
  await settle(page);
  now_ = Object.fromEntries((await api("GET", "/budgets")).map((b) => [b.category, b]));
  ok(budgets0.every((b) => Number(now_[b.category].amount) === Number(b.amount)), "Undo puts the budgets back");

  // Edit budgets
  await page.click(".bud-head [data-edit]");
  const row = (c) => page.locator('.bud-er[data-cat="' + c + '"]');
  ok(await page.locator(".bud-er").count() >= 8, "the sheet lists every spending category");
  ok(!(await page.locator('.bud-er[data-cat="Income"]').count()), "but not income");
  await row("Food").locator("[data-amt]").fill("abc");
  await page.click("[data-dlg-ok]");
  ok((await text(page, "#dlg-err")).includes("Check the amount for Food"), "a bad amount is caught");
  await row("Food").locator("[data-amt]").fill("260");
  await row("Groceries").locator("[data-amt]").fill("600");
  await row("Groceries").locator("[data-roll]").check();
  ok((await row("Entertainment").locator("[data-kind] option").allInnerTexts()).join("|") === "Flexible|Once a year", "kinds: Flexible or Once a year");
  await row("Entertainment").locator("[data-kind]").selectOption("yearly");
  ok(await row("Entertainment").locator("[data-roll]").isDisabled(), "roll over is only for flexible budgets");
  await row("Shopping").locator("[data-amt]").fill("");
  await row("Healthcare").locator("[data-amt]").fill("100+20");
  await page.click("[data-dlg-ok]");
  await settle(page);
  now_ = Object.fromEntries((await api("GET", "/budgets")).map((b) => [b.category, b]));
  ok(Number(now_.Groceries.amount) === 600 && now_.Groceries.rollover === true, "Groceries saved as 600 €, rolling over");
  ok(now_.Entertainment.kind === "yearly" && !now_.Shopping && Number(now_.Healthcare.amount) === 120, "kind changed, a cleared amount removes the budget, sums work");
  const gc = 600 - spent("Groceries", pa, pe);
  ok(sp(await page.locator(".w-brow", { hasText: "Groceries" }).innerText()).includes((gc > 0 ? "+" : "−") + f0(Math.abs(gc)) + " rolled over"), "Groceries now rolls over " + f0(gc));
  await page.click("#toast-undo");
  await settle(page);
  ok((await api("GET", "/budgets")).length === budgets0.length, "Undo restores the old budgets");

  // Savings goals
  let goals = await api("GET", "/goals");
  const japan = goals[0];
  const months = (+japan.due.slice(0, 4) * 12 + +japan.due.slice(5, 7)) - (CY * 12 + CM);
  const per = (4000 - Number(japan.saved)) / months;
  let card = sp(await page.locator(".bud-goal", { hasText: "Japan trip" }).innerText()).replace(/\s+/g, " ");
  ok(card.includes(f2(Number(japan.saved)) + "of 4,000 €") || card.includes(f2(Number(japan.saved))), "Japan trip shows " + f2(Number(japan.saved)) + " saved");
  ok(card.includes(f0(per) + " a month to get there") && card.includes(months + " months left"), "and " + f0(per) + " a month for " + months + " months");
  const byWho = {};
  japan.entries.forEach((e) => { byWho[e.person_id] = (byWho[e.person_id] || 0) + Number(e.amount); });
  ok(Object.entries(byWho).every(([pid, v]) => card.includes(people.find((p) => p.id === +pid).name + " " + f0(v))), "who put money in: " + JSON.stringify(byWho));

  const gsel = (n) => page.locator(".bud-goal", { hasText: n });
  await gsel("Japan trip").locator("[data-g-add]").click();
  await page.fill("#e-amt", "0");
  await page.click("[data-dlg-ok]");
  ok((await text(page, "#dlg-err")).includes("more than zero"), "an amount of zero is refused");
  await page.fill("#e-amt", "300");
  await page.selectOption("#e-who", "2");
  await page.click("[data-dlg-ok]");
  await settle(page);
  goals = await api("GET", "/goals");
  ok(Number(goals[0].saved) === Number(japan.saved) + 300 && goals[0].entries.some((e) => Number(e.amount) === 300 && e.person_id === 2 && e.date === TODAY), "Add money adds 300 € from Ana today");
  ok((await text(page, ".bud-goal")).includes(f0((4000 - Number(japan.saved) - 300) / months) + " a month"), "the monthly amount goes down");
  await page.click("#toast-undo");
  await settle(page);
  ok(Number((await api("GET", "/goals"))[0].saved) === Number(japan.saved), "Undo takes it out again");
  await gsel("Japan trip").locator("[data-g-out]").click();
  await page.fill("#e-amt", "99999");
  await page.click("[data-dlg-ok]");
  ok((await text(page, "#dlg-err")).includes("at most"), "can't take out more than was saved");
  await page.fill("#e-amt", "100");
  await page.click("[data-dlg-ok]");
  await settle(page);
  goals = await api("GET", "/goals");
  ok(Number(goals[0].saved) === Number(japan.saved) - 100, "Take out takes 100 € out");
  await gsel("Japan trip").locator("[data-g-hist]").click();
  const n0 = await page.locator(".bud-ghist li").count();
  ok(n0 === goals[0].entries.length, "History lists every entry (" + n0 + ")");
  ok(sp(await page.locator(".bud-ghist li").first().innerText()).includes("−100.00 €"), "the newest first, money out with a minus");
  await page.locator(".bud-ghist li").first().locator("[data-e-del]").click();
  await settle(page);
  goals = await api("GET", "/goals");
  ok(goals[0].entries.length === n0 - 1 && Number(goals[0].saved) === Number(japan.saved), "an entry can be deleted");
  await page.click("#toast-undo");
  await settle(page);
  ok((await api("GET", "/goals"))[0].entries.length === n0, "Undo puts the entry back");

  await page.click(".bud-goals .w-ph [data-g-new]");
  await page.click("[data-dlg-ok]");
  ok((await text(page, "#dlg-err")).includes("Give the goal a name"), "a goal needs a name");
  await page.fill("#g-name", "Emergency fund");
  await page.fill("#g-target", "-5");
  await page.click("[data-dlg-ok]");
  ok((await text(page, "#dlg-err")).includes("more than zero"), "and a target above zero");
  await page.fill("#g-target", "1000");
  await page.click("[data-dlg-ok]");
  await settle(page);
  ok(sp(await gsel("Emergency fund").innerText()).includes("1,000 € to go"), "a goal without a date says what is left");
  await gsel("Emergency fund").locator("[data-g-add]").click();
  await page.fill("#e-amt", "1000");
  await page.click("[data-dlg-ok]");
  await settle(page);
  ok((await gsel("Emergency fund").innerText()).includes("Reached") && await gsel("Emergency fund").locator("[data-g-done]").count() === 1, "a reached goal offers Mark done");
  await gsel("Emergency fund").locator("[data-g-done]").click();
  await settle(page);
  ok((await api("GET", "/goals")).find((g) => g.name === "Emergency fund").done === true, "Mark done marks it done");
  ok(await gsel("Emergency fund").count() === 0 && (await text(page, ".bud-doneh")).includes("1"), "it moves into a collapsed Done group");
  await page.click(".bud-doneh");
  await page.locator(".bud-drow", { hasText: "Emergency fund" }).locator("[data-g-undone]").click();
  await settle(page);
  ok((await api("GET", "/goals")).find((g) => g.name === "Emergency fund").done === false && await gsel("Emergency fund").count() === 1, "Not done opens it again");

  await gsel("Emergency fund").locator("[data-g-edit]").click();
  await page.fill("#g-name", "Rainy day");
  await page.fill("#g-due", ds(CY + 1, 1, 1));
  await page.selectOption("#g-who", "1");
  await page.click("[data-dlg-ok]");
  await settle(page);
  const rainy = (await api("GET", "/goals")).find((g) => g.name === "Rainy day");
  ok(rainy && rainy.due === ds(CY + 1, 1, 1) && rainy.person_id === 1, "Edit saves the name, date and person");
  await page.click('.w-side [data-scope="2"]');
  await settle(page);
  ok(await gsel("Rainy day").count() === 0 && await gsel("Japan trip").count() === 1, "Ana doesn't see Alex's goal, but sees the household's");
  await page.click('.w-side [data-scope="all"]');
  await settle(page);
  await gsel("Rainy day").locator("[data-g-edit]").click();
  await page.click("[data-g-del]");
  ok((await text(page, "#dlg")).includes("Delete Rainy day?"), "deleting asks first");
  await page.click("[data-dlg-ok]");
  await settle(page);
  ok(!(await api("GET", "/goals")).some((g) => g.name === "Rainy day"), "the goal is deleted");
  await page.click("#toast-undo");
  await page.waitForTimeout(900);
  const back = (await api("GET", "/goals")).find((g) => g.name === "Rainy day");
  ok(back && back.entries.length === 1 && Number(back.saved) === 1000 && back.person_id === 1, "Undo brings it back with its money");
  await shot(page, "bud-goals");
  await done(page, "1440 px");

  console.log("An old Fixed budget");
  await api("PUT", "/budgets", budgets0.map((b) => ({ category: b.category, amount: String(b.amount), kind: b.kind, rollover: !!b.rollover })).concat([{ category: "Rent", amount: "1250", kind: "fixed", rollover: false }]));
  page = await open(base, "/budgets");
  ok(!(await text(page, "main")).includes("Rent"), "an old Fixed budget is not shown");
  await done(page, "old fixed");

  console.log("No budgets");
  await api("PUT", "/budgets", []);
  page = await open(base, "/budgets");
  ok((await text(page, "main")).includes("No budgets yet") && await page.locator("[data-sugg]").count() === 0, "the empty state explains budgets");
  await page.click("main [data-edit]");
  await page.click("[data-fill]");
  const filled = await page.locator('.bud-er[data-cat="Groceries"] [data-amt]').inputValue();
  ok(+filled > 0 && +filled % 10 === 0, "Fill in from the last months fills in Groceries (" + filled + ")");
  ok(await page.locator('.bud-er[data-cat="Rent"] [data-amt]').inputValue() === "", "Rent, paid by a rule, is a bill: no budget suggested");
  await page.click("[data-dlg-ok]");
  await settle(page);
  ok((await api("GET", "/budgets")).length >= 5 && await page.locator(".bud-sum").count() === 1, "Set up budgets creates them");
  await shot(page, "bud-setup");
  await done(page, "no budgets");

  console.log("1100, 900 px and dark");
  page = await open(base, "/budgets", { width: 1100 });
  ok(await page.locator(".bud-grid").evaluate((n) => getComputedStyle(n).gridTemplateColumns.split(" ").length) === 2, "two columns at 1100 px");
  await shot(page, "bud-1100");
  await done(page, "1100 px");
  page = await open(base, "/budgets", { width: 900, theme: "dark" });
  ok(await page.locator(".bud-grid").evaluate((n) => getComputedStyle(n).gridTemplateColumns.split(" ").length) === 1, "one column at 900 px");
  await shot(page, "bud-900-dark");
  await done(page, "900 px dark");

  console.log("Phone, 390 px");
  page = await open(base, "/budgets", { width: 390, height: 844 });
  ok(await page.locator(".bud-back").isVisible(), "a way back to the Dashboard");
  ok(await page.locator(".bud-head .w-pswitch").isVisible(), "the person switch at the top right");
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= 390), "nothing wider than the screen");
  await page.click(".bud-head [data-edit]");
  await page.waitForTimeout(400);
  const dlg = await page.locator(".w-dialog").boundingBox();
  ok(dlg.width === 390 && dlg.y + dlg.height <= 845, "Edit budgets is a sheet from the bottom");
  await shot(page, "bud-390-edit");
  await page.keyboard.press("Escape");
  await page.click(".w-pswitch-b");
  await page.click('.w-pswitch-m [data-scope="1"]');
  await page.waitForTimeout(300);
  ok(await page.locator('.w-pswitch-m [data-scope="1"]').getAttribute("aria-pressed") === "true", "the switch changes the person");
  await shot(page, "bud-390");
  await done(page, "390 px");

  console.log("Arabic");
  await api("PUT", "/language/ar");
  page = await open(base, "/budgets");
  ok(await page.evaluate(() => document.documentElement.dir) === "rtl", "right to left");
  const barBox = await page.locator(".bud-sum .w-budbar").boundingBox(), fill = await page.locator(".bud-sum .w-budbar > span").boundingBox();
  ok(Math.abs(fill.x + fill.width - (barBox.x + barBox.width)) < 2, "bars fill from the right");
  await shot(page, "bud-ar");
  await done(page, "Arabic");
  await api("PUT", "/language/en");
} catch (e) {
  failures++;
  console.log("  FAIL " + (e && e.stack || e));
} finally {
  await browser.close();
  servers.forEach((p) => p.kill());
}
console.log(failures ? failures + " failed" : "all passed");
process.exit(failures ? 1 : 0);
