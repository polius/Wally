/* End-to-end encryption in real browsers, against a real server, with several devices at once.
     REPO=/path/to/Wally PYTHON=/path/to/python PORT=8897 node vault.mjs
   What the server stores is checked from outside with tests/vault_check.py, which opens it with a
   second implementation of the crypto. Screenshots go to SHOTS (a folder) when it is set. */
import { chromium } from "playwright";
import { spawn, execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, createHmac } from "node:crypto";

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
  const env = { ...process.env, WALLY_DATA: data, WALLY_PAUSE_SECONDS: String(PAUSE) };
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
/* What whoever runs the server types when the kit is lost too: python3 -m api.signin_off */
const signinOff = () => { const r = spawnSync(PYTHON, ["-m", "api.signin_off"], { cwd: REPO, env: { ...process.env, WALLY_DATA: data }, encoding: "utf8" }); return { code: r.status, text: (r.stdout || "") + (r.stderr || "") }; };
/* The plain kit, checked by the server (no browser needed) */
const plainRecover = async (person_id, key) => (await fetch(base + "/api/kit/recover", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ person_id, key }) })).status;
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
// Back at sign-in: their face and name, and the password field
const atPassword = (page, name, timeout = 15000) => page.waitForFunction((n) => !document.getElementById("gate").hidden && document.getElementById("si-in") && document.getElementById("gate-h").textContent === n, name, { timeout }).then(() => true, () => false);
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

/* Two-step codes, as an authenticator app works them out (RFC 6238) */
function base32(str) {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of str.replace(/[\s=]/g, "").toUpperCase()) bits += abc.indexOf(ch).toString(2).padStart(5, "0");
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
function totpAt(secret, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", base32(secret)).update(buf).digest(), o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, "0");
}
/* The server takes each 30-second code once for the whole household: the next one it will take */
let lastCounter = -1;
async function freshCode(secret) {
  for (;;) {
    const now = Math.floor(Date.now() / 30000);
    for (const c of [now, now + 1]) if (c > lastCounter) { lastCounter = c; return totpAt(secret, c); }
    await new Promise((r) => setTimeout(r, 1000));
  }
}
const HP1 = "house-pass-1", HP2 = "house-pass-2";

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
  const plainKit = (await setup("PUT", "/signin", { enabled: true, password: HP1 }, as)).kit;
  ok(await plainRecover(ANA, plainKit) === 200, "sign-in on: the household has a kit, checked by the server");
  ok(check("plain", DB).items.length >= 15, "the household has some of everything, in the clear");

  /* ================= Alex turns encryption on, in the browser ================= */
  section("Turning encryption on");
  const alex1 = await device();
  await signIn(alex1, ALEX, HP1);
  ok(await appShown(alex1), "Alex signs in (encryption off)");
  const plainLedger = await ledger(alex1);
  // Alex's second device, open on the plain household while encryption is turned on
  const alex2 = await device({ width: 390, height: 844 });
  await signIn(alex2, ALEX, HP1);
  ok(await appShown(alex2), "Alex signs in on a phone too");
  // Ana, signed in on her own browser while encryption is turned on
  const ana0 = await device();
  await signIn(ana0, ANA, HP1);
  ok(await appShown(ana0), "Ana signs in with the same household password (encryption off)");

  await alex1.goto(base + "/settings/privacy", { waitUntil: "networkidle" });
  await shot(alex1, "privacy-off");
  // Taken now: opening the app gave the new categories their colors
  const plainBefore = check("plain", DB).items;
  await alex1.click("#pv-toggle");
  const onText = await alex1.locator("#dlg").innerText();
  ok(onText.includes("Turn on end-to-end encryption?") && onText.includes("Everyone keeps signing in with the same password.") && !onText.includes("code"), "the dialog explains what changes: no codes, everyone keeps the same password");
  await alex1.fill("#pv-pw", "wrong-password");
  await alex1.click("[data-dlg-ok]");
  await alex1.waitForFunction(() => !document.getElementById("dlg-err").hidden, null, { timeout: 15000 });
  ok((await alex1.locator("#dlg-err").innerText()).length > 0 && !check("grep", DB, "VAULT_ID").VAULT_ID, "a wrong password changes nothing");
  await alex1.fill("#pv-pw", HP1);
  await alex1.click("[data-dlg-ok]");
  await alex1.waitForFunction(() => document.querySelector("#dlg h5") && document.querySelector("#dlg h5").textContent.includes("Emergency Kit"), null, { timeout: 60000 });
  await shot(alex1, "kit-dialog");
  const alexKey = (await alex1.locator("#dlg .w-kitkey").innerText()).replace(/\s+/g, "-");
  ok(/^([0-9A-Z]{4}-){12}[0-9A-Z]{4}$/.test(alexKey), "the Emergency Kit shows a 52-character recovery key");
  ok(await alex1.locator("#dlg [data-dlg-ok]").isDisabled(), "Done waits until the kit is saved");
  await alex1.keyboard.press("Escape");
  ok(await alex1.locator("#dlg .w-kitkey").count() === 1, "Escape doesn't close the kit");
  await alex1.check("#kit-saved");
  ok((await alex1.locator("#dlg h5").innerText()).includes("household’s Emergency Kit"), "one Emergency Kit, for the household");
  await alex1.click("#dlg [data-dlg-ok]");
  await alex1.waitForLoadState("networkidle");
  ok(await appShown(alex1, 20000), "Wally opens again, encrypted");
  ok(await alex1.locator("#dlg [data-code]").count() === 0 && !(await alex1.locator("#dlg").isVisible()), "no codes for anyone after the kit");
  ok(await hasKeys(alex1), "the household key is kept on this browser");
  ok(await plainRecover(ALEX, plainKit) === 401, "the kit from before encryption stops working");

  const after = check("open", DB, HP1);
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
  await alex2.fill("#vg-in", HP1);
  await alex2.click("#vg-go");
  ok(await appShown(alex2), "the right one opens it");
  ok(JSON.stringify(await ledger(alex2)) === JSON.stringify(plainLedger), "the phone has the same ledger");
  await alex2.reload({ waitUntil: "networkidle" });
  ok(await appShown(alex2), "and opens without asking again");
  noErrors(alex2, "unlocking");
  // Ana's browser, signed in before encryption: the same unlock, with the same password
  await ana0.reload({ waitUntil: "networkidle" });
  ok(await gateShown(ana0, "Unlock Wally"), "Ana’s browser, already signed in, asks to unlock once");
  ok((await ana0.locator("#gate").innerText()).includes("Enter the household password"), "with the household password");
  await shot(ana0, "unlock-ana");
  await ana0.fill("#vg-in", HP1);
  await ana0.click("#vg-go");
  ok(await appShown(ana0), "the same password opens it for Ana");
  ok(JSON.stringify(await ledger(ana0)) === JSON.stringify(plainLedger), "with the same ledger");
  ok(await hasKeys(ana0), "and the household key is kept on her browser");
  noErrors(ana0, "Ana unlocking");

  /* ================= a second person, on a new browser ================= */
  section("A second person");
  const ana1 = await device();
  await signIn(ana1, ANA, HP1);
  ok(await appShown(ana1), "Ana signs in on a new browser with the household password, unlocked in the same step");
  ok(!(await ana1.locator("#gate").isVisible()), "no code, no new password, no Emergency Kit of her own");
  ok(JSON.stringify(await ledger(ana1)) === JSON.stringify(plainLedger), "with the same ledger");
  const st1 = await inPage(ana1, async ({ core }) => core.GET("/auth/status"));
  ok(st1.me && st1.me.id === ANA, "as Ana");
  noErrors(ana1, "Ana’s first encrypted sign-in");

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
  await Promise.all([signIn(p1, ALEX, HP1), signIn(p2, ALEX, HP1)]);
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
  await alex2.fill("#vg-in", HP1);
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
  await alex2.fill("#vg-in", HP1);
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

  // Sign out others: every other browser in the household, Ana's too; their next contact wipes them
  await alex1.goto(base + "/settings/signin", { waitUntil: "networkidle" });
  await alex1.waitForSelector('[data-act="others"]:not([disabled])', { timeout: 10000 });
  await alex1.waitForFunction(() => /Ana · Last seen/.test(document.getElementById("set-pane").innerText), null, { timeout: 10000 }).catch(() => {});
  ok(/Ana · Last seen/.test(await alex1.locator("#set-pane").innerText()), "Signed-in browsers shows Ana’s browsers too");
  await alex1.click('[data-act="others"]');
  await alex1.waitForTimeout(500);
  await alex2.evaluate(() => window.dispatchEvent(new Event("focus")));
  ok(await atPassword(alex2, "Alex", 15000) || await gateShown(alex2, "Who is signing in", 2000), "signed out elsewhere: the phone is back at sign-in");
  ok(!(await hasKeys(alex2)), "and its key and copy are gone");
  for (const [pg, name] of [[ana0, "Ana’s first browser"], [ana1, "Ana’s second browser"]]) {
    await pg.evaluate(() => window.dispatchEvent(new Event("focus")));
    ok(await atPassword(pg, "Ana", 15000), "signed out elsewhere: " + name + " is back at sign-in");
    ok(!(await hasKeys(pg)), "and its key is gone");
  }
  await ana0.context().close();
  await signIn(alex2, ALEX, HP1);
  ok(await appShown(alex2, 20000), "a new device signs in with the password, and is unlocked in the same step");
  await signIn(ana1, ANA, HP1);
  ok(await appShown(ana1, 20000), "and so does Ana");

  // Sign out
  const ana2 = await device();
  await signIn(ana2, ANA, HP1);
  ok(await appShown(ana2, 20000), "Ana signs in on another browser");
  await ana2.goto(base + "/settings/people", { waitUntil: "networkidle" });
  await ana2.click("#set-pane [data-signout]");
  await ana2.waitForURL(base + "/", { timeout: 10000 });
  await ana2.waitForTimeout(500);
  ok(!(await hasKeys(ana2)), "signing out leaves no key on that browser");
  await ana2.context().close();

  /* ================= getting back in ================= */
  section("Getting back in");
  // Two-step on, for the household, from Settings › Sign-in
  await alex1.goto(base + "/settings/signin", { waitUntil: "networkidle" });
  await alex1.click('[data-act="2on"]');
  await alex1.waitForSelector("#ts-secret");
  const secret = (await alex1.textContent("#ts-secret")).replace(/\s/g, "");
  await alex1.fill("#ts-code", totpAt(secret, Math.floor(Date.now() / 30000)));
  await alex1.fill("#ts-pw", HP1);
  await alex1.click("#dlg [data-dlg-ok]");
  await alex1.waitForSelector("#rc-codes", { timeout: 15000 });
  await alex1.click("#dlg [data-dlg-ok]");
  ok((await inPage(alex1, async ({ core }) => core.GET("/auth/status"))).two_step === true, "two-step is on for the household (turned on with the password, encrypted)");
  const off = signinOff();
  ok(off.code === 1 && /encrypted/.test(off.text), "api.signin_off is refused while encrypted (" + off.text.trim() + ")");
  const afterOff = await (await fetch(base + "/api/auth/status")).json();
  ok(afterOff.signin && afterOff.vault.on && !!afterOff.kit && afterOff.two_step, "and nothing changed");

  // Alex forgot the password and has no phone: the Emergency Kit, without a code
  const alex3 = await device();
  await signIn(alex3, ALEX, HP1);
  await alex3.waitForSelector(".w-sicode", { timeout: 15000 });
  ok(await alex3.locator("#si-nophone").count() === 1, "the code step has “No phone or codes?”");
  await alex3.click("#si-nophone");
  ok(await gateShown(alex3, "Use your recovery key"), "No phone or codes? asks for the recovery key");
  ok((await alex3.locator("#gate").innerText()).includes("It works without two-step sign-in too."), "and says it works without two-step");
  await shot(alex3, "recover");
  await alex3.click("#vg-help");
  ok(await gateShown(alex3, "Ask Ana"), "“Lost it too?” says to ask Ana, who uses the same password");
  const lost = await alex3.locator("#gate").innerText();
  ok(lost.includes("Nobody else, not even whoever runs the server, can open it.") && !lost.includes("signin_off"), "encrypted: nobody else can open it, and no command for the server");
  await alex3.click("#vg-rec");
  ok(await gateShown(alex3, "Use your recovery key"), "and back to the recovery key");
  await alex3.fill("#vg-in", "AAAA-AAAA");
  await alex3.click("#vg-go");
  await alex3.waitForFunction(() => !document.getElementById("vg-msg").hidden, null, { timeout: 15000 });
  ok((await alex3.locator("#vg-msg").innerText()).length > 0, "a mistyped key is refused");
  await alex3.fill("#vg-in", alexKey.toLowerCase());
  await alex3.click("#vg-go");
  ok(await gateShown(alex3, "Choose a new household password"), "the key from the kit works, with two-step on and no code");
  await shot(alex3, "recover-newpw");
  await alex3.fill("#vg-in", HP2);
  await alex3.fill("#vg-in2", HP2);
  await alex3.click("#vg-go");
  ok(await appShown(alex3, 30000), "a new household password, and Wally opens, without a code");
  const st3 = await inPage(alex3, async ({ core }) => core.GET("/auth/status"));
  ok(st3.me && st3.me.id === ALEX && st3.two_step === true, "signed in as Alex; two-step stays on for everyone’s phones");
  const sess = await inPage(alex3, async ({ core }) => core.GET("/sessions"));
  ok(sess.length === 1 && sess[0].current, "every other browser is signed out on the server");
  await alex1.evaluate(() => window.dispatchEvent(new Event("focus")));
  ok(await atPassword(alex1, "Alex", 15000), "Alex’s other browser is back at sign-in");
  await ana1.evaluate(() => window.dispatchEvent(new Event("focus")));
  ok(await atPassword(ana1, "Ana", 15000), "and so is Ana’s");
  // Forgot password from the password step: the same recovery key
  await alex1.click("#si-forgot");
  ok(await gateShown(alex1, "Use your recovery key"), "Forgot password asks for the recovery key too");
  await alex1.click("#vg-back");
  ok(await atPassword(alex1, "Alex"), "Back to sign in");
  // Ana: the new password, and a code from the same secret
  await signIn(ana1, ANA, HP2);
  await ana1.waitForSelector(".w-sicode", { timeout: 15000 });
  await ana1.locator("#si-in").pressSequentially(await freshCode(secret));
  ok(await appShown(ana1, 20000), "Ana signs in with the new password and the household’s two-step code, unlocked");
  ok(JSON.stringify(await ledger(ana1)) === JSON.stringify(await ledger(alex3)), "with the same ledger");

  // Settings › Sign-in, encrypted: what to do if the password is forgotten
  await alex3.goto(base + "/settings/signin", { waitUntil: "networkidle" });
  await alex3.waitForSelector('[data-act="2off"]');
  const forgotText = await alex3.locator("#set-pane").innerText();
  ok(forgotText.includes("If you forget the password") && forgotText.includes("Emergency Kit"), "Settings › Sign-in: the Emergency Kit gets you back in");
  ok(!forgotText.includes("password.txt") && !forgotText.includes("signin_off") && forgotText.includes("Then nobody can open the data, not even whoever runs the server."), "Settings › Sign-in, encrypted: lost the kit too means nobody can open it; no password.txt, no command");
  // A new kit, made in this browser: the old one stops working
  const proveIn = async (key) => { const d = await device(); await d.goto(base + "/", { waitUntil: "networkidle" });
    const r = await d.evaluate(async ([k, id]) => { const s = await import("/js/vault/session.js"); s.bind(await import("/js/core.js")); try { await s.prove(id, k); return 200; } catch (e) { return e.status; } }, [key, ALEX]);
    await d.context().close(); return r; };
  await alex3.click('[data-act="kit"]');
  await alex3.fill("#kit-pw", HP2);
  await alex3.click("#dlg [data-dlg-ok]");
  await alex3.waitForSelector("#kit-saved", { timeout: 20000 });
  const newKey = (await alex3.locator("#dlg .w-kitkey").innerText()).replace(/\s+/g, "-");
  await alex3.check("#kit-saved");
  await alex3.click("#dlg [data-dlg-ok]");
  await alex3.waitForFunction(() => document.getElementById("dlg").hidden, null, { timeout: 10000 });
  ok(newKey !== alexKey && await proveIn(alexKey) === 401, "encrypted: a new kit, and the old one stops working");
  ok(await proveIn(newKey) === 200, "the new kit opens the household key");
  await alex3.goto(base + "/settings/signin", { waitUntil: "networkidle" });
  await alex3.waitForSelector('[data-act="2off"]');
  await alex3.click('[data-act="2off"]');
  await alex3.fill("#ts-pw", HP2);
  await alex3.click("#dlg [data-dlg-ok]");
  await alex3.waitForFunction(() => document.getElementById("dlg").hidden, null, { timeout: 15000 });
  ok((await inPage(alex3, async ({ core }) => core.GET("/auth/status"))).two_step === false, "two-step off again, with the new password");
  await alex3.reload({ waitUntil: "networkidle" });
  await appShown(alex3);
  ok(!(await alex3.locator("#banner").textContent()).includes("helped"), "no “helped back in” banner");
  noErrors(alex3, "getting back in"); noErrors(ana1, "Ana back in");

  /* ================= the server stays in the dark ================= */
  section("What the server holds");
  await syncPage(alex3);
  const now = check("open", DB, HP2);
  const fromApp = await inPage(alex3, async ({ store }) => [...store.vault.recs.values()].filter((r) => r.obj).length);
  ok(now.items.length === fromApp, "the server has exactly the records the app has (" + fromApp + ")");
  const hits2 = Object.entries(check("grep", DB, ...WORDS, "Psychologist", "Gym", "market")).filter(([, v]) => v).map(([k]) => k);
  ok(hits2.length === 0, "still nothing readable in wally.db" + (hits2.length ? " — found " + hits2.join(", ") : ""));
  await alex3.goto(base + "/settings/privacy", { waitUntil: "networkidle" });
  await alex3.waitForFunction(() => document.getElementById("set-pane").innerText.includes("Nothing in the clear"), null, { timeout: 10000 }).catch(() => {});
  ok((await alex3.locator("#set-pane").innerText()).includes("Nothing in the clear"), "Settings › Privacy confirms nothing is in the clear");
  const priv = await alex3.locator("#set-pane").innerText();
  ok(!priv.includes("Recently") && !priv.includes("helped") && await alex3.locator('#set-pane [data-act="kit"]').count() === 0, "Settings › Privacy: no “Recently” group, and the kit lives in Settings › Sign-in now");
  await shot(alex3, "privacy-on");

  /* ================= stopping half-way ================= */
  section("Turning off, stopped half-way");
  // The browser goes away mid-way: after the pause, nothing changed
  const quitter = await device();
  await signIn(quitter, ALEX, HP2);
  await appShown(quitter, 20000);
  await quitter.waitForTimeout(1500);
  let encrypted = digest();
  await quitter.route("**/api/vault/convert/plain", () => {}); // never answered: as if the tab closed
  await quitter.goto(base + "/settings/privacy", { waitUntil: "networkidle" });
  await quitter.click("#pv-toggle");
  await quitter.fill("#pv-pw", HP2);
  await quitter.fill("#pv-word", "turn off");
  await quitter.click("[data-dlg-ok]");
  await ana1.waitForTimeout(1500);
  const paused = await (await fetch(base + "/api/auth/status")).json();
  ok(paused.vault.paused && paused.vault.paused.by === "Alex", "while it runs, everyone sees “Alex is turning off encryption”");
  const blocked = await inPage(ana1, async ({ core }) => { try { await core.POST("/transactions", { name: "x", category: "Food", amount: "1", date: new Date().toISOString().slice(0, 10) }); return "saved"; } catch (e) { return e.status + " " + e.message; } });
  ok(/^503 Alex is turning off/.test(blocked) || /^503 Alex is decrypting/.test(blocked), "and saving waits: " + blocked);
  await quitter.context().close();
  await new Promise((r) => setTimeout(r, (PAUSE + 2) * 1000));
  await fetch(base + "/api/auth/status");
  ok(digest() === encrypted && !existsSync(join(data, "wally.next.db")) && !existsSync(join(data, "conversion.json")), "the browser closed: after the pause the half-built file is gone and wally.db is untouched");
  ok(!(await (await fetch(base + "/api/auth/status")).json()).vault.paused, "and the household is writable again");

  // The server stops mid-way: on restart, nothing changed
  const victim = await device();
  await signIn(victim, ALEX, HP2);
  await appShown(victim, 20000);
  await victim.waitForTimeout(1500);
  encrypted = digest();
  let killed = null;
  await victim.route("**/api/vault/convert/readback*", async (route) => { killed = stopServer("SIGKILL"); await killed; route.abort(); });
  await victim.goto(base + "/settings/privacy", { waitUntil: "networkidle" });
  await victim.click("#pv-toggle");
  await victim.fill("#pv-pw", HP2);
  await victim.fill("#pv-word", "turn off");
  await victim.click("[data-dlg-ok]");
  await victim.waitForFunction(() => !document.getElementById("dlg-err").hidden, null, { timeout: 30000 }).catch(() => {});
  ok(killed !== null && existsSync(join(data, "wally.next.db")), "the server was killed with the new file half-built");
  await startServer();
  ok(digest() === encrypted && !existsSync(join(data, "wally.next.db")) && !existsSync(join(data, "conversion.json")), "after a restart, wally.db is the old file, untouched");
  await victim.context().close();

  /* ================= turning off ================= */
  section("Turning encryption off");
  const beforeOff = check("open", DB, HP2).items;
  await alex3.reload({ waitUntil: "networkidle" });
  await appShown(alex3);
  const encLedger = await ledger(alex3);
  await alex3.goto(base + "/settings/privacy", { waitUntil: "networkidle" });
  await alex3.click("#pv-toggle");
  await shot(alex3, "turn-off");
  await alex3.fill("#pv-pw", HP2);
  await alex3.fill("#pv-word", "turn of");
  await alex3.click("[data-dlg-ok]");
  await alex3.waitForFunction(() => !document.getElementById("dlg-err").hidden, null, { timeout: 5000 });
  ok((await alex3.locator("#dlg-err").innerText()).includes("turn off"), "it needs “turn off” typed exactly");
  await alex3.fill("#pv-word", "turn off");
  await alex3.click("[data-dlg-ok]");
  // The encrypted kit went with the encryption: on reload Wally makes a plain one and asks to save it
  ok(await gateShown(alex3, "Save the household’s Emergency Kit", 60000), "turned off: Wally makes a new kit for the household");
  await alex3.waitForSelector("#kg-saved");
  const plainKit2 = (await alex3.locator(".w-kitkey").innerText()).replace(/\s+/g, "-");
  ok(await alex3.isDisabled("#kg-done"), "Open Wally waits until it is saved");
  await shot(alex3, "kit-after-off");
  await alex3.check("#kg-saved");
  await alex3.click("#kg-done");
  ok(await appShown(alex3, 30000) && await until(alex3, async ({ core }) => core.state.status && core.state.status.vault && !core.state.status.vault.on, null, 30000), "Wally opens again, in the clear");
  ok(newKey !== plainKit2 && await plainRecover(ALEX, plainKit2) === 200 && await plainRecover(ALEX, newKey) === 401, "the new kit works, and the encrypted one doesn’t");
  const plainAfter = check("plain", DB).items;
  ok(JSON.stringify(plainAfter) === JSON.stringify(beforeOff), "every item in the clear is exactly what was encrypted (" + plainAfter.length + ")");
  ok(JSON.stringify(await ledger(alex3)) === JSON.stringify(encLedger), "the app shows the same ledger, now from the server");
  ok(!(await hasKeys(alex3)), "no key is left on the browser");
  await ana1.evaluate(() => window.dispatchEvent(new Event("focus")));
  await ana1.waitForTimeout(3000);
  ok(await appShown(ana1) && !(await hasKeys(ana1)), "Ana’s open browser notices, forgets its copy and reloads in the clear");
  ok(JSON.stringify(await ledger(ana1)) === JSON.stringify(encLedger), "and shows the same ledger");
  noErrors(alex3, "turning off"); noErrors(ana1, "Ana after turning off");

  /* ================= and on again, with more data ================= */
  section("A bigger household");
  const big = apiClient();
  const kdf = await big("GET", "/vault/kdf");
  const rows = [];
  for (let i = 0; i < 5000; i++) rows.push({ name: "Shop " + (i % 97), category: ["Groceries", "Food", "Shopping", "Travel"][i % 4], amount: String(5 + (i % 50) + 0.25), date: daysAgo(i % 700), person_id: i % 3 ? ALEX : null });
  const login = await alex3.evaluate(async ([pw, salt]) => (await (await import("/js/vault/crypto.js")).fromPassword(pw, salt)).login, [HP2, kdf.salt]);
  await big("POST", "/login", { person_id: ALEX, password: login });
  await big("POST", "/transactions/import", rows);
  await alex3.reload({ waitUntil: "networkidle" });
  await appShown(alex3, 30000);
  const plainBig = check("plain", DB).items;
  await alex3.goto(base + "/settings/privacy", { waitUntil: "networkidle" });
  await alex3.click("#pv-toggle");
  await alex3.fill("#pv-pw", HP2);
  const t0 = Date.now();
  await alex3.click("[data-dlg-ok]");
  await alex3.waitForSelector("#dlg .w-kitkey", { timeout: 120000 });
  const took = (Date.now() - t0) / 1000;
  ok(took < 60, "turning on with " + plainBig.length + " items took " + took.toFixed(1) + " s");
  await alex3.check("#kit-saved");
  await alex3.click("#dlg [data-dlg-ok]");
  await appShown(alex3, 30000);
  const t1b = Date.now();
  await alex3.reload({ waitUntil: "networkidle" });
  await appShown(alex3, 30000);
  ok((Date.now() - t1b) / 1000 < 8, "opening Wally with " + plainBig.length + " encrypted records takes " + ((Date.now() - t1b) / 1000).toFixed(1) + " s");
  ok(JSON.stringify(check("open", DB, HP2).items) === JSON.stringify(plainBig), "every one of them opens to exactly what it was");
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
