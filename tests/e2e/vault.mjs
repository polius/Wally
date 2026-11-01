/* End-to-end encryption in real browsers, against a real server, with several devices at once.
     REPO=/path/to/Wally PYTHON=/path/to/python PORT=8897 node vault.mjs
   What the server stores is checked from outside with tests/vault_check.py, which opens it with a
   second implementation of the crypto. Screenshots go to SHOTS (a folder) when it is set. */
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const REPO = process.env.REPO || process.cwd();
const PYTHON = process.env.PYTHON || "python3";
const PORT = +(process.env.PORT || 8897);
const SHOTS = process.env.SHOTS || "";
if (SHOTS && !existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });
const PAUSE = 6;

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log("  ok  " + msg); else { failures++; console.log("  FAIL " + msg); } };
const section = (s) => console.log("\n" + s);

/* ---------- the server ---------- */
let server = null;
const data = mkdtempSync(join(tmpdir(), "wally-vault-"));
const DB = join(data, "wally.db");
const base = "http://localhost:" + PORT;
async function startServer() {
  const env = { ...process.env, WALLY_DATA: data, WALLY_RECOVERY_FILE: join(data, "password.txt"), WALLY_PAUSE_SECONDS: String(PAUSE) };
  delete env.DEMO;
  server = spawn(PYTHON, ["-m", "uvicorn", "utils.dev_server:app", "--port", String(PORT)], { cwd: REPO, env, stdio: ["ignore", "ignore", "pipe"] });
  server.stderr.on("data", (d) => { if (/Traceback|ERROR/.test(String(d))) process.stderr.write("[server] " + d); });
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(base + "/api/health"); if (r.ok) return; } catch (e) { /* not yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server did not start");
}
async function stopServer(signal = "SIGTERM") {
  if (!server) return;
  const done = new Promise((r) => server.once("exit", r));
  server.kill(signal);
  await done;
  server = null;
}
const digest = () => createHash("sha256").update(readFileSync(DB)).digest("hex");
const check = (...args) => JSON.parse(execFileSync(PYTHON, [join(REPO, "tests/vault_check.py"), ...args], { cwd: REPO, encoding: "utf8", maxBuffer: 1 << 28 }));

/* A client of the API with its own cookies, for setting things up */
function apiClient() {
  let cookie = "";
  const fn = async (method, path, body, headers) => {
    const r = await fetch(base + "/api" + path, { method, headers: { "content-type": "application/json", cookie, ...(headers || {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) {
      const kv = c.split(";")[0], k = kv.split("=")[0];
      cookie = cookie.split("; ").filter((x) => x && !x.startsWith(k + "=")).concat(/=$/.test(kv) || /Max-Age=0/i.test(c) ? [] : [kv]).join("; ");
    }
    const text = await r.text();
    let out; try { out = JSON.parse(text); } catch (e) { out = text; }
    if (!r.ok) { const e = new Error(method + " " + path + " " + r.status + " " + text); e.status = r.status; throw e; }
    return out;
  };
  return fn;
}

/* ---------- browsers ---------- */
const browser = await chromium.launch();
const EXPECTED = /status of (400|401|403|404|409|410|429|503)/;
async function device({ width = 1280, height = 860, clock } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block" });
  const page = await ctx.newPage();
  if (clock) await page.clock.install({ time: clock });
  page.errors = [];
  page.on("console", (m) => { if (m.type() === "error" && !EXPECTED.test(m.text())) page.errors.push(m.text()); });
  page.on("pageerror", (e) => page.errors.push("PAGEERROR " + e.message));
  page.on("dialog", (d) => d.dismiss().catch(() => {}));
  return page;
}
const shot = async (page, name) => { if (SHOTS) { await page.waitForTimeout(300); await page.screenshot({ path: join(SHOTS, name + ".png") }); } };
const appShown = (page, timeout = 15000) => page.waitForSelector("#app:not([hidden])", { timeout }).then(() => true, () => false);
const gateShown = (page, text, timeout = 15000) => page.waitForFunction((t) => !document.getElementById("gate").hidden && document.getElementById("gate").innerText.includes(t), text, { timeout }).then(() => true, () => false);
const noErrors = (page, what) => ok(page.errors.length === 0, what + ": no console errors" + (page.errors.length ? " — " + page.errors.join(" | ") : ""));
/* Run in the page, with core.js and the vault session, the same module instances the app uses */
const inPage = (page, fn, arg) => page.evaluate(async ([src, a]) => {
  const core = await import("/js/core.js");
  const session = await import("/js/vault/session.js");
  const store = await import("/js/vault/store.js");
  return (0, eval)("(" + src + ")")({ core, session, store }, a);
}, [fn.toString(), arg]);
/* Wait until fn (run in the page) returns true */
async function until(page, fn, arg, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await inPage(page, fn, arg).catch(() => false)) return true; await page.waitForTimeout(150); }
  return false;
}
const ledger = (page) => inPage(page, async ({ core }) => (await core.GET("/ledger")).rows.map((r) => JSON.stringify(r)).sort());
const syncPage = (page) => inPage(page, async ({ session }) => session.syncNow());
const hasKeys = (page) => page.evaluate(() => new Promise((resolve) => {
  const r = indexedDB.open("wally-vault");
  r.onupgradeneeded = () => { r.transaction.abort(); resolve(false); };
  r.onerror = () => resolve(false);
  r.onsuccess = () => {
    const d = r.result;
    if (!d.objectStoreNames.contains("keys")) { d.close(); return resolve(false); }
    const g = d.transaction("keys").objectStore("keys").get("household");
    g.onsuccess = () => { d.close(); resolve(!!g.result); };
    g.onerror = () => { d.close(); resolve(false); };
  };
}));

async function signIn(page, personId, password) {
  await page.goto(base + "/", { waitUntil: "networkidle" });
  await page.waitForSelector("#si-in, [data-prof]", { timeout: 10000 });
  if (await page.locator('[data-prof="' + personId + '"]').count()) await page.click('[data-prof="' + personId + '"]');
  else {
    const name = personId === 1 ? "Alex" : "Ana";
    if (!(await page.locator("#gate").innerText()).includes(name)) { await page.click("#si-not"); await page.click('[data-prof="' + personId + '"]'); }
  }
  await page.fill("#si-in", password);
  await page.click("#si-go");
}

const TODAY = new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const WORDS = ["Mercadona", "Farmacia", "Therapy", "Café", "AMAZON", "Netflix", "holiday", "weekly", "Kids", "Fruiteria", "23.45"];

try {
  await startServer();
  /* ================= a plain household, with some of everything ================= */
  section("A plain household");
  const setup = apiClient();
  const ALEX = (await setup("POST", "/people", { name: "Alex" })).id;
  const ANA = (await setup("POST", "/people", { name: "Ana" })).id;
  const as = { "x-wally-person": String(ALEX) };
  await setup("POST", "/transactions", { name: "Mercadona", category: "Groceries", amount: "23.45", date: daysAgo(2), paid_by: ALEX, note: "Café y pan", tags: ["weekly"] }, as);
  await setup("POST", "/transactions", { name: "Farmacia Sant Jordi", category: "Healthcare", amount: "7.10", date: daysAgo(1), person_id: ANA }, as);
  await setup("POST", "/transactions", { name: "Dentist", category: "Therapy", amount: "80.00", date: daysAgo(3), shares: { [ALEX]: 2000, [ANA]: 6000 } }, as);
  await setup("POST", "/transactions", { name: "Salary", category: "Income", amount: "2450", type: "income", date: daysAgo(5), person_id: ALEX }, as);
  await setup("POST", "/recurring", { name: "Netflix", category: "Entertainment", amount: "13.99", startDate: daysAgo(70), frequency: "monthly", paid_by: ANA }, as);
  await setup("POST", "/import/commit", { rows: [{ date: daysAgo(4), name: "AMAZON MKTPLACE 99", amount: "-15.20", import_ref: "ref-1", action: "add", category: "Shopping" }] }, as);
  await setup("POST", "/categories", { name: "Kids", color: 3 }, as);
  await setup("POST", "/tags", { name: "holiday" }, as);
  await setup("PUT", "/signin", { enabled: true, passwords: { [ALEX]: "alex-pass-1", [ANA]: "ana-pass-1" } }, as);
  ok(check("plain", DB).items.length >= 15, "the household has some of everything, in the clear");

  /* ================= Alex turns encryption on, in the browser ================= */
  section("Turning encryption on");
  const alex1 = await device();
  await signIn(alex1, ALEX, "alex-pass-1");
  ok(await appShown(alex1), "Alex signs in (encryption off)");
  const plainLedger = await ledger(alex1);
  // Alex's second device, open on the plain household while encryption is turned on
  const alex2 = await device({ width: 390, height: 844 });
  await signIn(alex2, ALEX, "alex-pass-1");
  ok(await appShown(alex2), "Alex signs in on a phone too");

  await alex1.goto(base + "/settings/privacy", { waitUntil: "networkidle" });
  await shot(alex1, "privacy-off");
  // Taken now: opening the app gave the new categories their colors
  const plainBefore = check("plain", DB).items;
  await alex1.click("#pv-toggle");
  ok((await alex1.locator("#dlg").innerText()).includes("Turn on end-to-end encryption?"), "the dialog explains what changes");
  await alex1.fill("#pv-pw", "wrong-password");
  await alex1.click("[data-dlg-ok]");
  await alex1.waitForFunction(() => !document.getElementById("dlg-err").hidden, null, { timeout: 15000 });
  ok((await alex1.locator("#dlg-err").innerText()).length > 0 && !check("grep", DB, "VAULT_ID").VAULT_ID, "a wrong password changes nothing");
  await alex1.fill("#pv-pw", "alex-pass-1");
  await alex1.click("[data-dlg-ok]");
  await alex1.waitForFunction(() => document.querySelector("#dlg h5") && document.querySelector("#dlg h5").textContent.includes("Emergency Kit"), null, { timeout: 60000 });
  await shot(alex1, "kit-dialog");
  const alexKey = (await alex1.locator("#dlg .w-kitkey").innerText()).replace(/\s+/g, "-");
  ok(/^([0-9A-Z]{4}-){12}[0-9A-Z]{4}$/.test(alexKey), "the Emergency Kit shows a 52-character recovery key");
  ok(await alex1.locator("#dlg [data-dlg-ok]").isDisabled(), "Done waits until the kit is saved");
  await alex1.keyboard.press("Escape");
  ok(await alex1.locator("#dlg .w-kitkey").count() === 1, "Escape doesn't close the kit");
  await alex1.check("#kit-saved");
  await alex1.click("#dlg [data-dlg-ok]");
  await alex1.waitForSelector("#dlg [data-code]", { timeout: 10000 });
  const anaCode = await alex1.getAttribute("#dlg [data-code]", "data-code");
  ok(/^[0-9A-Z]{5}(-[0-9A-Z]{5}){3}$/.test(anaCode), "Ana gets a 20-character code");
  await alex1.click("#dlg [data-dlg-ok]");
  ok(await appShown(alex1, 20000), "Wally opens again, encrypted");
  ok(await hasKeys(alex1), "the household key is kept on this browser");

  const after = check("open", DB, "alex-pass-1", String(ALEX));
  ok(JSON.stringify(after.items) === JSON.stringify(plainBefore), "every item, opened with Alex’s password from outside the browser, is exactly what was there before (" + after.items.length + ")");
  ok(after.counts.transaction === 0 && after.counts.category === 0 && after.counts.tag === 0 && after.counts.recurringtransaction === 0, "no table holds data in the clear");
  const hits = Object.entries(check("grep", DB, ...WORDS)).filter(([, v]) => v).map(([k]) => k);
  ok(hits.length === 0, "no name, note, category, tag or amount is anywhere in wally.db" + (hits.length ? " — found " + hits.join(", ") : ""));
  ok(JSON.stringify(await ledger(alex1)) === JSON.stringify(plainLedger), "the app shows the same ledger as before, row for row");
  ok(!existsSync(join(data, "wally.prev.db")) && !existsSync(join(data, "wally.next.db")) && !existsSync(join(data, "conversion.json")), "no old file, new file or journal is left");
  noErrors(alex1, "turning on");

  /* ================= encryption turned on elsewhere: Unlock once ================= */
  section("A device that was open meanwhile");
  await alex2.reload({ waitUntil: "networkidle" });
  ok(await gateShown(alex2, "Unlock Wally"), "Alex’s phone asks to unlock, once");
  await shot(alex2, "unlock-phone");
  await alex2.fill("#vg-in", "nope-nope");
  await alex2.click("#vg-go");
  await alex2.waitForFunction(() => !document.getElementById("vg-msg").hidden, null, { timeout: 15000 });
  ok((await alex2.locator("#vg-msg").innerText()).includes("isn’t right"), "a wrong password says so");
  await alex2.fill("#vg-in", "alex-pass-1");
  await alex2.click("#vg-go");
  ok(await appShown(alex2), "the right one opens it");
  ok(JSON.stringify(await ledger(alex2)) === JSON.stringify(plainLedger), "the phone has the same ledger");
  await alex2.reload({ waitUntil: "networkidle" });
  ok(await appShown(alex2), "and opens without asking again");
  noErrors(alex2, "unlocking");

  /* ================= Ana uses her code ================= */
  section("A second person");
  const ana1 = await device();
  await signIn(ana1, ANA, "ana-pass-1");
  ok(await gateShown(ana1, "Enter the code"), "Ana is asked for the code, not her old password");
  await shot(ana1, "invite");
  await ana1.fill("#vg-in", "AAAAA-AAAAA-AAAAA-AAAAA");
  await ana1.click("#vg-go");
  await ana1.waitForFunction(() => !document.getElementById("vg-msg").hidden, null, { timeout: 15000 });
  ok((await ana1.locator("#vg-msg").innerText()).length > 0, "a mistyped code is caught before it is sent");
  await ana1.fill("#vg-in", anaCode.toLowerCase().replace(/-/g, " "));
  await ana1.click("#vg-go");
  ok(await gateShown(ana1, "Choose a new password"), "the right code (typed in lower case, with spaces) asks for a new password");
  await ana1.fill("#vg-in", "ana-new-pass");
  await ana1.fill("#vg-in2", "ana-new-pass");
  await ana1.click("#vg-go");
  ok(await gateShown(ana1, "Save your Emergency Kit", 30000), "then her own Emergency Kit");
  const anaKey = (await ana1.locator(".w-kitkey").innerText()).replace(/\s+/g, "-");
  ok(await ana1.locator("#vg-done").isDisabled(), "Open Wally waits until she says it is saved");
  await ana1.check("#vg-saved");
  await ana1.click("#vg-done");
  ok(await appShown(ana1), "Ana is in");
  ok(JSON.stringify(await ledger(ana1)) === JSON.stringify(plainLedger), "with the same ledger");
  const again = await device();
  await again.goto(base + "/", { waitUntil: "networkidle" });
  const reuse = await again.evaluate(async (code) => {
    const s = await import("/js/vault/session.js"); s.bind(await import("/js/core.js"));
    try { await s.prove("code", 2, code); return "worked"; } catch (e) { return e.status; }
  }, anaCode);
  ok(reuse === 404, "the code works once");
  await again.context().close();
  noErrors(ana1, "Ana’s first sign-in");

  /* ================= several devices ================= */
  section("Two devices, the same household");
  // A transaction added through the app on one device shows on the other
  await alex1.goto(base + "/transactions", { waitUntil: "networkidle" });
  await alex1.keyboard.press("n");
  await alex1.waitForSelector("#add-modal:not([hidden])");
  const created = await inPage(alex1, async ({ core }) => core.POST("/transactions", { name: "Fruiteria Rosa", category: "Groceries", amount: "12.30", date: new Date().toISOString().slice(0, 10), tags: ["market"] }));
  await alex1.keyboard.press("Escape");
  ok(created && created.id && created.amount === "12.30", "a transaction is saved, encrypted");
  ok(!check("grep", DB, "Fruiteria").Fruiteria, "and its name is nowhere on the server");
  await ana1.evaluate(() => window.dispatchEvent(new Event("focus")));
  ok(await until(ana1, async ({ core }, id) => core.state.tx.some((t) => t.id === id && t.n === "Fruiteria Rosa"), created.id), "Ana’s browser shows it as soon as it gets focus");
  ok(await ana1.locator("#main").innerText().then((x) => x.length > 0), "and the page is drawn again");

  // The same transaction edited on two devices: different fields both kept
  const t1 = created.id;
  await syncPage(alex2);
  await inPage(alex1, async ({ core }, id) => core.PUT("/transactions/" + id, { name: "Fruiteria Rosa Mercat" }), t1);
  const merged = await inPage(alex2, async ({ core }, id) => core.PUT("/transactions/" + id, { amount: "14.00" }), t1);
  ok(merged.name === "Fruiteria Rosa Mercat" && merged.amount === "14.00", "edited on two devices: one changed the name, the other the amount, and both are kept");
  // The same field: the later save wins
  await syncPage(ana1);
  await inPage(alex1, async ({ core }, id) => core.PUT("/transactions/" + id, { note: "first" }), t1);
  const later = await inPage(ana1, async ({ core }, id) => core.PUT("/transactions/" + id, { note: "second" }), t1);
  ok(later.note === "second" && later.name === "Fruiteria Rosa Mercat" && later.amount === "14.00", "the same field on two devices: the later save wins, the rest stays");
  // Edit against delete
  await syncPage(ana1);
  await inPage(alex1, async ({ core }, id) => core.DEL("/transactions/" + id), t1);
  const gone = await inPage(ana1, async ({ core }, id) => { try { await core.PUT("/transactions/" + id, { note: "too late" }); return "saved"; } catch (e) { return e.message; } }, t1);
  ok(gone === "Deleted on another device.", "editing what another device deleted says “Deleted on another device.”");
  ok(!(await inPage(ana1, async ({ core }, id) => (await core.GET("/transactions/id/" + id)).length, t1)), "and it stays deleted");

  // A category renamed on one device while another adds to it
  await syncPage(ana1);
  const cats = await Promise.all([
    inPage(alex1, async ({ core }) => core.PUT("/categories/Therapy", { name: "Health care" })),
    inPage(ana1, async ({ core }) => core.POST("/transactions", { name: "Psychologist", category: "Therapy", amount: "60", date: new Date().toISOString().slice(0, 10) })),
  ]);
  await syncPage(alex1); await syncPage(ana1);
  const [la, lb] = [await ledger(alex1), await ledger(ana1)];
  ok(JSON.stringify(la) === JSON.stringify(lb), "after a rename and an add at the same moment, both devices agree (" + la.length + " rows)");
  ok(cats[0].name === "Health care", "the rename went through");

  // Recurring charges due on two devices at once: each date added once
  const rule = await inPage(alex1, async ({ core }) => core.POST("/recurring", { name: "Gym", category: "Healthcare", amount: "39", startDate: new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10), frequency: "daily", person_id: 1 }));
  ok(rule && rule.last_run, "a daily rule is made, with its charges up to today");
  const ahead = Date.now() + 3 * 864e5;
  const [p1, p2] = [await device({ clock: ahead }), await device({ clock: ahead })];
  await Promise.all([signIn(p1, ALEX, "alex-pass-1"), signIn(p2, ALEX, "alex-pass-1")]);
  await Promise.all([appShown(p1, 30000), appShown(p2, 30000)]);
  await p1.waitForTimeout(2500);
  await Promise.all([syncPage(p1), syncPage(p2)]);
  const gym = await inPage(p1, async ({ core }, rid) => (await core.GET("/ledger")).rows.filter((r) => r[12] === rid).map((r) => r[1]).sort(), rule.id);
  const gym2 = await inPage(p2, async ({ core }, rid) => (await core.GET("/ledger")).rows.filter((r) => r[12] === rid).map((r) => r[1]).sort(), rule.id);
  ok(gym.length === 6 && new Set(gym).size === 6 && JSON.stringify(gym) === JSON.stringify(gym2), "two devices opening three days later add each due charge once (" + gym.join(", ") + ")");
  noErrors(p1, "device three days later"); noErrors(p2, "the other device three days later");
  await p1.context().close(); await p2.context().close();

  /* ================= when it asks again ================= */
  section("When Wally asks again");
  // Storage cleared, session still valid (Safari's seven days): the password only
  await alex2.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase("wally-vault"); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
  await alex2.reload({ waitUntil: "networkidle" });
  ok(await gateShown(alex2, "Unlock Wally"), "storage cleared: the phone asks for the password only");
  await alex2.fill("#vg-in", "alex-pass-1");
  await alex2.click("#vg-go");
  ok(await appShown(alex2), "and opens");
  await syncPage(alex1);
  ok(JSON.stringify(await ledger(alex2)) === JSON.stringify(await ledger(alex1)), "downloading everything again gives the same ledger");

  // Lock when Wally closes
  await alex2.goto(base + "/settings/privacy", { waitUntil: "networkidle" });
  await shot(alex2, "privacy-phone");
  await alex2.waitForSelector("#pv-lock", { timeout: 8000 });
  await alex2.click("#pv-lock");
  await alex2.waitForTimeout(300);
  ok(!(await hasKeys(alex2)), "“Lock when Wally closes” leaves no key on this browser");
  await alex2.reload({ waitUntil: "networkidle" });
  ok(await gateShown(alex2, "Unlock Wally"), "so it asks each time Wally opens");
  await alex2.fill("#vg-in", "alex-pass-1");
  await alex2.click("#vg-go");
  ok(await appShown(alex2), "and opens, with the key in memory only");
  ok(!(await hasKeys(alex2)), "still no key stored");
  // Moving around inside Wally keeps it open; only a new page load asks again
  await alex2.evaluate(() => { history.pushState(null, "", "/settings/privacy"); dispatchEvent(new PopStateEvent("popstate")); });
  await alex2.waitForSelector("#pv-lock", { timeout: 8000 });
  ok(await appShown(alex2, 1000), "moving between pages keeps it unlocked");
  await alex2.click("#pv-lock");
  await alex2.waitForTimeout(300);
  ok(await hasKeys(alex2), "turning it off keeps the key on this browser again");

  // Sign out others: the other device's next contact wipes it
  await alex1.goto(base + "/settings/signin", { waitUntil: "networkidle" });
  await alex1.waitForSelector('[data-act="others"]:not([disabled])', { timeout: 10000 });
  await alex1.click('[data-act="others"]');
  await alex1.waitForTimeout(500);
  await alex2.evaluate(() => window.dispatchEvent(new Event("focus")));
  ok(await gateShown(alex2, "Hi, Alex", 15000) || await gateShown(alex2, "Who is signing in", 2000), "signed out elsewhere: the phone is back at sign-in");
  ok(!(await hasKeys(alex2)), "and its key and copy are gone");
  await signIn(alex2, ALEX, "alex-pass-1");
  ok(await appShown(alex2, 20000), "a new device signs in with the password, and is unlocked in the same step");

  // Sign out
  const ana2 = await device();
  await signIn(ana2, ANA, "ana-new-pass");
  ok(await appShown(ana2, 20000), "Ana signs in on a second browser with her new password");
  await ana2.goto(base + "/settings/people", { waitUntil: "networkidle" });
  await ana2.click("#set-pane [data-signout]");
  await ana2.waitForURL(base + "/", { timeout: 10000 });
  await ana2.waitForTimeout(500);
  ok(!(await hasKeys(ana2)), "signing out leaves no key on that browser");
  await ana2.context().close();

  /* ================= getting back in ================= */
  section("Getting back in");
  // Alex forgot the password: the Emergency Kit
  const alex3 = await device();
  await alex3.goto(base + "/", { waitUntil: "networkidle" });
  await alex3.click('[data-prof="' + ALEX + '"]').catch(() => {});
  await alex3.click("#si-forgot");
  ok(await gateShown(alex3, "Use your recovery key"), "Forgot password asks for the recovery key");
  await shot(alex3, "recover");
  await alex3.fill("#vg-in", alexKey.toLowerCase());
  await alex3.click("#vg-go");
  ok(await gateShown(alex3, "Choose a new password"), "the key from the kit works");
  await alex3.fill("#vg-in", "alex-pass-2");
  await alex3.fill("#vg-in2", "alex-pass-2");
  await alex3.click("#vg-go");
  ok(await appShown(alex3, 30000), "a new password, and Wally opens (the same kit stays valid)");
  await alex1.evaluate(() => window.dispatchEvent(new Event("focus")));
  ok(await gateShown(alex1, "Alex", 15000), "a new password signs out Alex’s other browsers");

  // Ana lost both: Alex helps her back in
  await alex3.goto(base + "/settings/people", { waitUntil: "networkidle" });
  await alex3.waitForSelector('[data-act="help"][data-id="' + ANA + '"]', { timeout: 10000 });
  await alex3.click('[data-act="help"][data-id="' + ANA + '"]');
  await shot(alex3, "help-dialog");
  await alex3.fill("#pc-pw", "alex-pass-2");
  await alex3.click("[data-dlg-ok]");
  await alex3.waitForSelector("#dlg .w-kitcode", { timeout: 20000 });
  const helpCode = (await alex3.locator("#dlg .w-kitcode").innerText()).replace(/\s+/g, "-");
  await alex3.click("#dlg [data-dlg-ok]");
  ok(/^[0-9A-Z]{5}(-[0-9A-Z]{5}){3}$/.test(helpCode), "Alex gets a one-use code for Ana");
  const ana3 = await device();
  await ana3.goto(base + "/", { waitUntil: "networkidle" });
  await ana3.click('[data-prof="' + ANA + '"]').catch(() => {});
  await ana3.click("#si-forgot");
  await ana3.click("#vg-help");
  ok(await gateShown(ana3, "Alex can let you back in"), "“Lost it too?” says who can help");
  await shot(ana3, "ask-for-help");
  await ana3.click("#vg-have");
  await ana3.fill("#vg-in", helpCode);
  await ana3.click("#vg-go");
  ok(await gateShown(ana3, "Choose a new password"), "the code opens it");
  await ana3.fill("#vg-in", "ana-pass-3");
  await ana3.fill("#vg-in2", "ana-pass-3");
  await ana3.click("#vg-go");
  ok(await gateShown(ana3, "Save your Emergency Kit", 30000), "and she gets a new Emergency Kit");
  await ana3.check("#vg-saved");
  await ana3.click("#vg-done");
  ok(await appShown(ana3), "Ana is back in");
  const oldKitStillWorks = await ana3.evaluate(async (key) => {
    const s = await import("/js/vault/session.js"); s.bind(await import("/js/core.js"));
    try { await s.prove("recovery", 2, key); return true; } catch (e) { return e.status; }
  }, anaKey);
  ok(oldKitStillWorks === 401, "her old recovery key stops working");
  await ana1.evaluate(() => window.dispatchEvent(new Event("focus")));
  ok(await gateShown(ana1, "Ana", 15000), "her other browser is signed out");
  await alex3.reload({ waitUntil: "networkidle" });
  ok((await alex3.locator("#banner").innerText()).includes("Alex helped Ana back in"), "everyone sees “Alex helped Ana back in”");
  await shot(alex3, "helped-banner");
  noErrors(alex3, "getting back in"); noErrors(ana3, "Ana back in");

  /* ================= the server stays in the dark ================= */
  section("What the server holds");
  await syncPage(alex3);
  const now = check("open", DB, "alex-pass-2", String(ALEX));
  const fromApp = await inPage(alex3, async ({ store }) => [...store.vault.recs.values()].filter((r) => r.obj).length);
  ok(now.items.length === fromApp, "the server has exactly the records the app has (" + fromApp + ")");
  const hits2 = Object.entries(check("grep", DB, ...WORDS, "Psychologist", "Gym", "market")).filter(([, v]) => v).map(([k]) => k);
  ok(hits2.length === 0, "still nothing readable in wally.db" + (hits2.length ? " — found " + hits2.join(", ") : ""));
  await alex3.goto(base + "/settings/privacy", { waitUntil: "networkidle" });
  await alex3.waitForFunction(() => document.getElementById("set-pane").innerText.includes("Nothing in the clear"), null, { timeout: 10000 }).catch(() => {});
  ok((await alex3.locator("#set-pane").innerText()).includes("Nothing in the clear"), "Settings › Privacy confirms nothing is in the clear");
  await shot(alex3, "privacy-on");

  /* ================= stopping half-way ================= */
  section("Turning off, stopped half-way");
  // The browser goes away mid-way: after the pause, nothing changed
  const quitter = await device();
  await signIn(quitter, ALEX, "alex-pass-2");
  await appShown(quitter, 20000);
  await quitter.waitForTimeout(1500);
  let encrypted = digest();
  await quitter.route("**/api/vault/convert/plain", () => {}); // never answered: as if the tab closed
  await quitter.goto(base + "/settings/privacy", { waitUntil: "networkidle" });
  await quitter.click("#pv-toggle");
  await quitter.fill("#pv-pw", "alex-pass-2");
  await quitter.fill("#pv-word", "turn off");
  await quitter.click("[data-dlg-ok]");
  await ana3.waitForTimeout(1500);
  const paused = await (await fetch(base + "/api/auth/status")).json();
  ok(paused.vault.paused && paused.vault.paused.by === "Alex", "while it runs, everyone sees “Alex is turning off encryption”");
  const blocked = await inPage(ana3, async ({ core }) => { try { await core.POST("/transactions", { name: "x", category: "Food", amount: "1", date: new Date().toISOString().slice(0, 10) }); return "saved"; } catch (e) { return e.status + " " + e.message; } });
  ok(/^503 Alex is turning off/.test(blocked) || /^503 Alex is decrypting/.test(blocked), "and saving waits: " + blocked);
  await quitter.context().close();
  await new Promise((r) => setTimeout(r, (PAUSE + 2) * 1000));
  await fetch(base + "/api/auth/status");
  ok(digest() === encrypted && !existsSync(join(data, "wally.next.db")) && !existsSync(join(data, "conversion.json")), "the browser closed: after the pause the half-built file is gone and wally.db is untouched");
  ok(!(await (await fetch(base + "/api/auth/status")).json()).vault.paused, "and the household is writable again");

  // The server stops mid-way: on restart, nothing changed
  const victim = await device();
  await signIn(victim, ALEX, "alex-pass-2");
  await appShown(victim, 20000);
  await victim.waitForTimeout(1500);
  encrypted = digest();
  let killed = null;
  await victim.route("**/api/vault/convert/readback*", async (route) => { killed = stopServer("SIGKILL"); await killed; route.abort(); });
  await victim.goto(base + "/settings/privacy", { waitUntil: "networkidle" });
  await victim.click("#pv-toggle");
  await victim.fill("#pv-pw", "alex-pass-2");
  await victim.fill("#pv-word", "turn off");
  await victim.click("[data-dlg-ok]");
  await victim.waitForFunction(() => !document.getElementById("dlg-err").hidden, null, { timeout: 30000 }).catch(() => {});
  ok(killed !== null && existsSync(join(data, "wally.next.db")), "the server was killed with the new file half-built");
  await startServer();
  ok(digest() === encrypted && !existsSync(join(data, "wally.next.db")) && !existsSync(join(data, "conversion.json")), "after a restart, wally.db is the old file, untouched");
  await victim.context().close();

  /* ================= turning off ================= */
  section("Turning encryption off");
  const beforeOff = check("open", DB, "alex-pass-2", String(ALEX)).items;
  await alex3.reload({ waitUntil: "networkidle" });
  await appShown(alex3);
  const encLedger = await ledger(alex3);
  await alex3.goto(base + "/settings/privacy", { waitUntil: "networkidle" });
  await alex3.click("#pv-toggle");
  await shot(alex3, "turn-off");
  await alex3.fill("#pv-pw", "alex-pass-2");
  await alex3.fill("#pv-word", "turn of");
  await alex3.click("[data-dlg-ok]");
  await alex3.waitForFunction(() => !document.getElementById("dlg-err").hidden, null, { timeout: 5000 });
  ok((await alex3.locator("#dlg-err").innerText()).includes("turn off"), "it needs “turn off” typed exactly");
  await alex3.fill("#pv-word", "turn off");
  await alex3.click("[data-dlg-ok]");
  ok(await appShown(alex3, 60000) && await until(alex3, async ({ core }) => core.state.status && core.state.status.vault && !core.state.status.vault.on, null, 30000), "Wally opens again, in the clear");
  const plainAfter = check("plain", DB).items;
  ok(JSON.stringify(plainAfter) === JSON.stringify(beforeOff), "every item in the clear is exactly what was encrypted (" + plainAfter.length + ")");
  ok(JSON.stringify(await ledger(alex3)) === JSON.stringify(encLedger), "the app shows the same ledger, now from the server");
  ok(!(await hasKeys(alex3)), "no key is left on the browser");
  await ana3.evaluate(() => window.dispatchEvent(new Event("focus")));
  await ana3.waitForTimeout(3000);
  ok(await appShown(ana3) && !(await hasKeys(ana3)), "Ana’s open browser notices, forgets its copy and reloads in the clear");
  ok(JSON.stringify(await ledger(ana3)) === JSON.stringify(encLedger), "and shows the same ledger");
  noErrors(alex3, "turning off"); noErrors(ana3, "Ana after turning off");

  /* ================= and on again, with more data ================= */
  section("A bigger household");
  const big = apiClient();
  const kdf = await big("GET", "/vault/kdf?person_id=" + ALEX);
  const rows = [];
  for (let i = 0; i < 5000; i++) rows.push({ name: "Shop " + (i % 97), category: ["Groceries", "Food", "Shopping", "Travel"][i % 4], amount: String(5 + (i % 50) + 0.25), date: daysAgo(i % 700), person_id: i % 3 ? ALEX : null });
  const login = await alex3.evaluate(async ([pw, salt]) => (await (await import("/js/vault/crypto.js")).fromPassword(pw, salt)).login, ["alex-pass-2", kdf.salt]);
  await big("POST", "/login", { person_id: ALEX, password: login });
  await big("POST", "/transactions/import", rows);
  await alex3.reload({ waitUntil: "networkidle" });
  await appShown(alex3, 30000);
  const plainBig = check("plain", DB).items;
  await alex3.goto(base + "/settings/privacy", { waitUntil: "networkidle" });
  await alex3.click("#pv-toggle");
  await alex3.fill("#pv-pw", "alex-pass-2");
  const t0 = Date.now();
  await alex3.click("[data-dlg-ok]");
  await alex3.waitForSelector("#dlg .w-kitkey", { timeout: 120000 });
  const took = (Date.now() - t0) / 1000;
  ok(took < 60, "turning on with " + plainBig.length + " items took " + took.toFixed(1) + " s");
  await alex3.check("#kit-saved");
  await alex3.click("#dlg [data-dlg-ok]");
  await alex3.waitForSelector("#dlg [data-code]");
  await alex3.click("#dlg [data-dlg-ok]");
  await appShown(alex3, 30000);
  const t1b = Date.now();
  await alex3.reload({ waitUntil: "networkidle" });
  await appShown(alex3, 30000);
  ok((Date.now() - t1b) / 1000 < 8, "opening Wally with " + plainBig.length + " encrypted records takes " + ((Date.now() - t1b) / 1000).toFixed(1) + " s");
  ok(JSON.stringify(check("open", DB, "alex-pass-2", String(ALEX)).items) === JSON.stringify(plainBig), "every one of them opens to exactly what it was");
  const t2 = Date.now();
  await inPage(alex3, async ({ core }) => core.PUT("/categories/Travel", { name: "Trips" }));
  ok((Date.now() - t2) / 1000 < 10, "renaming a category on 1,250 transactions takes " + ((Date.now() - t2) / 1000).toFixed(1) + " s");
  noErrors(alex3, "a bigger household");
} catch (e) {
  failures++;
  console.log("  FAIL " + (e.stack || e));
} finally {
  await browser.close();
  await stopServer();
}
console.log(failures ? "\n" + failures + " failed" : "\nAll encryption checks passed.");
process.exit(failures ? 1 : 0);
