/* First run with encryption: the "Who runs this server?" step, and WALLY_ENCRYPTION=required.
     REPO=/path/to/Wally PYTHON=/path/to/python PORT=8941 node vault-setup.mjs
   Starts its own servers. Screenshots go to SHOTS (a folder) when it is set. */
import { chromium } from "playwright";
import { spawn, execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir, networkInterfaces } from "node:os";
import { createServer } from "node:net";
import { join } from "node:path";

const REPO = process.env.REPO || process.cwd();
const PYTHON = process.env.PYTHON || "python3";
const PORT = +(process.env.PORT || 8941);
const SHOTS = process.env.SHOTS || "";
if (SHOTS && !existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log("  ok  " + msg); else { failures++; console.log("  FAIL " + msg); } };
const servers = [];
let port = PORT;

/* The next port nothing else is listening on */
async function freePort() {
  for (;;) {
    const p = port++;
    const free = await new Promise((resolve) => { const s = createServer(); s.once("error", () => resolve(false)); s.listen(p, "0.0.0.0", () => s.close(() => resolve(true))); });
    if (free) return p;
  }
}
async function startServer({ required = false, data = null, host = "127.0.0.1" } = {}) {
  data = data || mkdtempSync(join(tmpdir(), "wally-setup-"));
  const p = await freePort();
  const env = { ...process.env, WALLY_DATA: data };
  delete env.DEMO;
  if (required) env.WALLY_ENCRYPTION = "required"; else delete env.WALLY_ENCRYPTION;
  const proc = spawn(PYTHON, ["-m", "uvicorn", "utils.dev_server:app", "--port", String(p), "--host", host], { cwd: REPO, env, stdio: "ignore" });
  servers.push(proc);
  const base = "http://localhost:" + p;
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(base + "/api/health"); if (r.ok) return { base, data, port: p, proc, required }; } catch (e) { /* not yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server did not start");
}
const stop = async (s) => { const done = new Promise((r) => s.proc.once("exit", r)); s.proc.kill("SIGKILL"); await done; };
/* What whoever runs the server types when the kit is lost too: python3 -m api.signin_off */
const signinOff = (srv) => { const r = spawnSync(PYTHON, ["-m", "api.signin_off"], { cwd: REPO, env: { ...process.env, WALLY_DATA: srv.data, ...(srv.required ? { WALLY_ENCRYPTION: "required" } : {}) }, encoding: "utf8" }); return { code: r.status, text: (r.stdout || "") + (r.stderr || "") }; };
const recover = async (srv, person_id, key) => (await fetch(srv.base + "/api/kit/recover", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ person_id, key }) })).status;
const check = (...args) => JSON.parse(execFileSync(PYTHON, [join(REPO, "tests/vault_check.py"), ...args], { cwd: REPO, encoding: "utf8", maxBuffer: 1 << 26 }));

const browser = await chromium.launch();
async function device(base) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  const page = await ctx.newPage();
  page.errors = [];
  page.on("console", (m) => { if (m.type() === "error" && !/status of (400|401|403|404|409)/.test(m.text())) page.errors.push(m.text()); });
  page.on("pageerror", (e) => page.errors.push("PAGEERROR " + e.message));
  await page.goto(base + "/", { waitUntil: "networkidle" });
  return page;
}
const shot = async (page, name) => { if (SHOTS) { await page.waitForTimeout(300); await page.screenshot({ path: join(SHOTS, name + ".png"), fullPage: true }); } };
const gate = (page) => page.locator("#gate").innerText();
const appShown = (page, timeout = 20000) => page.waitForSelector("#app:not([hidden])", { timeout }).then(() => true, () => false);
const noErrors = (page, what) => ok(page.errors.length === 0, what + ": no console errors" + (page.errors.length ? " — " + page.errors.join(" | ") : ""));
const status = async (base) => (await fetch(base + "/api/auth/status")).json();

/* Basics, then People: Alex and Ana, with a password */
async function basicsAndPeople(page, { toggle = true } = {}) {
  await page.waitForSelector("#onb-next");
  await page.click("#onb-next");
  await page.waitForSelector("[data-name]");
  await page.fill('[data-name="0"]', "Alex");
  await page.click("#onb-add");
  await page.fill('[data-name="1"]', "Ana");
  if (toggle) await page.click("#onb-pw");
  await page.fill("#onb-pwd", "alex-pass-1");
  await page.click("#onb-next");
}

try {
  /* ================= Someone else runs it: encrypted at setup ================= */
  console.log("Someone else runs the server");
  const a = await startServer();
  let page = await device(a.base);
  await basicsAndPeople(page);
  await page.waitForSelector("[data-who]");
  const text = await gate(page);
  ok(text.includes("Who runs this server?") && text.includes("Me, or someone here") && text.includes("Someone else"), "after People, Wally asks who runs the server");
  ok(text.includes("Privacy"), "as its own step, Privacy");
  ok(!text.includes("What changes"), "nothing more until a choice is made");
  await page.click("#onb-next");
  ok((await page.locator("#onb-err").innerText()).includes("Choose who runs this server"), "Continue asks for a choice first");
  await page.click('[data-who="else"]');
  const means = await gate(page);
  ok(means.includes("Your password is the key.") && means.includes("You save an Emergency Kit.") && means.includes("Everyone uses the same password.") && !means.includes("code") && means.includes("Phone shortcuts and API keys are off."),
    "choosing Someone else says, in four plain lines, what changes");
  ok(await page.locator("#onb-next").innerText() === "Encrypt and continue", "and the button says what it does");
  await shot(page, "setup-question");
  await page.click("#onb-next");
  await page.waitForSelector(".w-kitkey", { timeout: 30000 });
  ok((await gate(page)).includes("Save the household’s Emergency Kit") && (await gate(page)).includes("Wally is encrypted."), "encrypted at once: the encrypted Emergency Kit follows, and only that one");
  const sealedKit = (await page.locator(".w-kitkey").innerText()).replace(/\s+/g, "-");
  ok(/^([0-9A-Z]{4}-){12}[0-9A-Z]{4}$/.test(sealedKit), "a 52-character recovery key");
  ok(await page.locator("[data-code]").count() === 0 && !(await gate(page)).includes("code"), "one kit for the household, and no codes for anyone");
  ok(await page.locator("#onb-back").count() === 0, "there is no going back to before encrypting");
  await shot(page, "setup-kit");
  await page.click("#onb-next");
  ok((await page.locator("#onb-err").innerText()).includes("Save your Emergency Kit first"), "Continue waits for the kit to be saved");
  await page.check("#onb-saved");
  await page.click("#onb-next");
  await page.waitForSelector("[data-onb-data]");
  ok(await page.locator("#onb-back").count() === 0, "Your data: no Back into the kit");
  await page.click('[data-onb-data="add"]');
  await page.click("#onb-next");
  ok(await appShown(page), "Wally opens, encrypted");
  ok(await page.evaluate(async () => (await import("/js/core.js")).vaultOn()), "and answers from this browser’s encrypted copy");
  const created = await page.evaluate(async () => (await import("/js/core.js")).POST("/transactions", { name: "Fruiteria Rosa", category: "Groceries", amount: "12.30", date: new Date().toISOString().slice(0, 10) }));
  ok(created && created.id, "the first transaction is saved");
  const inside = check("open", join(a.data, "wally.db"), "alex-pass-1");
  ok(inside.counts.transaction === 0 && inside.counts.category === 0 && inside.items.some((i) => i.includes("Fruiteria Rosa")), "nothing in the clear: the first transaction exists only encrypted");
  ok(!check("grep", join(a.data, "wally.db"), "Fruiteria").Fruiteria, "its name is nowhere in the file");
  noErrors(page, "setup, encrypted");
  // Ana signs in with the same password, and it opens the household key in the same step
  const ana = await device(a.base);
  await ana.click('[data-prof="2"]');
  await ana.fill("#si-in", "alex-pass-1");
  await ana.click("#si-go");
  ok(await appShown(ana), "Ana signs in with the household password, unlocked in the same step");
  ok((await status(a.base)).vault.on && await ana.evaluate(async () => (await import("/js/core.js")).vaultOn()), "her browser answers from its encrypted copy");
  ok(await ana.evaluate(async (id) => (await import("/js/core.js")).state.tx.some((t) => t.id === id), created.id), "and sees Alex’s first transaction");
  noErrors(ana, "Ana signs in, encrypted");
  // Adding someone while encrypted: a name, and they sign in with the same password
  await page.goto(a.base + "/settings/people", { waitUntil: "networkidle" });
  await page.waitForSelector('[data-act="add"]');
  ok(!(await page.locator("#set-pane").innerText()).includes("code"), "People: no codes, and no sign-in status per person");
  await page.click('[data-act="add"]');
  await page.waitForSelector("#np-name");
  ok(await page.locator("#dlg input").count() === 1 && await page.locator('#dlg input[type="password"]').count() === 0, "encrypted: Add a person asks only for a name");
  await page.fill("#np-name", "Sam");
  await page.click("#dlg [data-dlg-ok]");
  await page.waitForFunction(() => document.getElementById("dlg").hidden, null, { timeout: 10000 });
  ok(await page.locator("#dlg .w-kitcode, #dlg [data-code]").count() === 0 && (await page.locator("#set-pane").innerText()).includes("Sam"), "Sam is added, and no code is shown");
  const sam = await device(a.base);
  await sam.click('#gate .w-prof:has-text("Sam")');
  await sam.fill("#si-in", "alex-pass-1");
  await sam.click("#si-go");
  ok(await appShown(sam), "Sam signs in with the household password");
  ok(await sam.evaluate(async (id) => { const c = await import("/js/core.js"); return c.state.me && c.state.tx.some((t) => t.id === id); }, created.id), "and reads the household’s data");
  ok((await sam.evaluate(() => fetch("/api/auth/status").then((r) => r.json()))).me.name === "Sam", "as Sam");
  noErrors(sam, "Sam, encrypted"); noErrors(page, "adding Sam");
  await sam.context().close();
  // Whoever runs the server can't turn sign-in off on an encrypted household
  const refused = signinOff(a);
  ok(refused.code === 1 && /encrypted/.test(refused.text), "api.signin_off is refused while encrypted (exit " + refused.code + ")");
  const still = await status(a.base);
  ok(still.signin && still.vault.on && !!still.kit, "and sign-in, encryption and the kit stay as they were");
  // The sign-in page says it is encrypted
  const fresh = await device(a.base);
  await fresh.click('[data-prof="1"]');
  ok((await gate(fresh)).includes("End-to-end encrypted: whoever runs this server can’t read your data."), "the sign-in page says the data is encrypted");
  await shot(fresh, "signin-encrypted");
  await fresh.context().close(); await ana.context().close(); await page.context().close();

  /* ================= I run it: as before ================= */
  console.log("\nI run the server");
  const b = await startServer();
  page = await device(b.base);
  await basicsAndPeople(page);
  await page.waitForSelector("[data-who]");
  await page.click('[data-who="me"]');
  ok(!(await gate(page)).includes("What changes"), "choosing Me changes nothing and says nothing more");
  ok(await page.locator("#onb-next").innerText() === "Continue", "the button is plain Continue");
  await page.click("#onb-back");
  await page.waitForSelector("[data-name], .w-onbppl");
  await page.click("#onb-next");
  await page.waitForSelector("[data-who]");
  ok(await page.locator('[data-who="me"][aria-checked="true"]').count() === 1, "Back keeps the choice");
  await page.click("#onb-next");
  // Not encrypted: the kit made with the password
  await page.waitForSelector(".w-kitkey", { timeout: 15000 });
  const meText = await gate(page);
  ok(meText.includes("Save the household’s Emergency Kit") && !meText.includes("Wally is encrypted."), "Me: the household's Emergency Kit, made with the password");
  const meKit = (await page.locator(".w-kitkey").innerText()).replace(/\s+/g, "-");
  await shot(page, "setup-kit-me");
  await page.click("#onb-next");
  ok((await page.locator("#onb-err").innerText()).includes("Save your Emergency Kit first"), "Continue waits for the tick");
  await page.check("#onb-saved");
  await page.click("#onb-next");
  await page.waitForSelector("[data-onb-data]");
  ok(await page.locator("#onb-back").count() === 0, "no Back into the kit");
  await page.click('[data-onb-data="add"]');
  await page.click("#onb-next");
  ok(await appShown(page), "Wally opens");
  const bst = await status(b.base);
  ok(!bst.vault.on && !!bst.kit, "not encrypted, with a kit");
  ok(await recover(b, 2, meKit) === 200, "the kit shown at setup is the household's");
  noErrors(page, "setup, not encrypted");
  await page.context().close();

  // Without a password there is no question: encryption needs one
  const c = await startServer();
  page = await device(c.base);
  await page.click("#onb-next");
  await page.waitForSelector("[data-name]");
  await page.fill('[data-name="0"]', "Alex");
  await page.click("#onb-next");
  await page.waitForSelector("[data-onb-data]");
  ok(!(await gate(page)).includes("Privacy"), "sign-in off: no Privacy step");
  await page.context().close();

  /* ================= WALLY_ENCRYPTION=required ================= */
  console.log("\nWALLY_ENCRYPTION=required");
  const r = await startServer({ required: true });
  page = await device(r.base);
  await page.click("#onb-next");
  await page.waitForSelector("[data-name]");
  ok(await page.locator("#onb-pw").isDisabled() && await page.getAttribute("#onb-pw", "aria-checked") === "true", "the password can’t be switched off");
  ok((await gate(page)).includes("Needed on this server: your password is the key to your data."), "and it says why");
  await page.fill('[data-name="0"]', "Alex");
  await page.fill("#onb-pwd", "alex-pass-1");
  await page.click("#onb-next");
  await page.waitForFunction(() => document.getElementById("gate").innerText.includes("This server encrypts your data"), null, { timeout: 10000 }).catch(() => {});
  const req = await gate(page);
  ok(req.includes("This server encrypts your data") && !req.includes("Who runs this server?"), "no question: it explains that this server always encrypts");
  ok(req.includes("Whoever runs this server set it up") && req.includes("Your password is the key."), "who decided it, and what it means");
  await shot(page, "setup-required");
  await page.click("#onb-next");
  await page.waitForSelector(".w-kitkey", { timeout: 30000 });
  await page.check("#onb-saved");
  await page.click("#onb-next");
  await page.waitForSelector("[data-onb-data]");
  await page.click('[data-onb-data="add"]');
  await page.click("#onb-next");
  ok(await appShown(page), "Wally opens, encrypted");
  await page.goto(r.base + "/settings/privacy", { waitUntil: "networkidle" });
  await page.waitForSelector("#pv-toggle");
  ok(await page.locator("#pv-toggle").isDisabled() && (await page.locator("#set-pane").innerText()).includes("required on this server"), "Privacy: on, and it can’t be turned off");
  await page.goto(r.base + "/settings/signin", { waitUntil: "networkidle" });
  await page.waitForSelector("#si-toggle");
  ok(await page.locator("#si-toggle").isDisabled(), "Sign-in can’t be turned off");
  const rOff = signinOff(r);
  ok(rOff.code === 1 && (await status(r.base)).signin, "api.signin_off is refused on a server that requires encryption");
  noErrors(page, "required setup");
  await page.context().close();

  // An unencrypted household on a server that now requires it
  console.log("\nRequired, on a household made before");
  const old = await startServer();
  const api = async (method, path, body, headers) => fetch(old.base + "/api" + path, { method, headers: { "content-type": "application/json", "x-wally-person": "1", ...(headers || {}) }, body: body ? JSON.stringify(body) : undefined });
  await api("POST", "/people", { name: "Alex" });
  await api("POST", "/transactions", { name: "Mercadona", category: "Groceries", amount: "20", date: new Date().toISOString().slice(0, 10) });
  await api("PUT", "/config", { onboarded: true });
  await api("PUT", "/signin", { enabled: true, password: "alex-pass-1" });
  await stop(old);
  const now = await startServer({ required: true, data: old.data });
  page = await device(now.base);
  await page.fill("#si-in", "alex-pass-1");
  await page.click("#si-go");
  ok(await appShown(page), "Alex signs in");
  ok((await page.locator("#banner").innerText()).includes("This server keeps every household encrypted."), "a banner says the server keeps households encrypted");
  const blocked = await page.evaluate(async () => { try { await (await import("/js/core.js")).POST("/transactions", { name: "x", category: "Food", amount: "1", date: new Date().toISOString().slice(0, 10) }); return "saved"; } catch (e) { return e.message; } });
  ok(/Turn on encryption/.test(blocked), "nothing new is saved in the clear: " + blocked);
  await page.click("#banner a");
  await page.waitForSelector("#pv-toggle:not([disabled])");
  await page.click("#pv-toggle");
  await page.fill("#pv-pw", "alex-pass-1");
  await page.click("[data-dlg-ok]");
  await page.waitForSelector("#kit-saved", { timeout: 30000 });
  await page.check("#kit-saved");
  await page.click("#dlg [data-dlg-ok]");
  ok(await appShown(page, 30000) && (await status(now.base)).vault.on, "turning it on from the banner works");
  ok(check("grep", join(now.data, "wally.db"), "Mercadona").Mercadona === false, "and the old transaction is now encrypted too");
  noErrors(page, "required, after");
  await page.context().close();

  /* ================= not HTTPS ================= */
  const ip = Object.values(networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal);
  if (ip) {
    console.log("\nOver plain HTTP");
    const h = await startServer({ host: "0.0.0.0" });
    const ctx = await browser.newContext({ serviceWorkers: "block" });
    page = await ctx.newPage();
    await page.goto("http://" + ip.address + ":" + h.port + "/", { waitUntil: "networkidle" });
    await basicsAndPeople(page);
    await page.waitForSelector("[data-who]");
    ok(await page.locator('[data-who="else"]').isDisabled() && (await gate(page)).includes("Needs a secure connection"), "Someone else needs HTTPS, and says so");
    // Without encryption, the kit works on plain http too
    const http = "http://" + ip.address + ":" + h.port;
    await page.click('[data-who="me"]');
    await page.click("#onb-next");
    await page.waitForSelector(".w-kitkey", { timeout: 15000 });
    const httpKit = (await page.locator(".w-kitkey").innerText()).replace(/\s+/g, "-");
    ok(/^([0-9A-Z]{4}-){12}[0-9A-Z]{4}$/.test(httpKit), "plain http: the kit is made at setup");
    await page.check("#onb-saved");
    await page.click("#onb-next");
    await page.waitForSelector("[data-onb-data]");
    await page.click('[data-onb-data="add"]');
    await page.click("#onb-next");
    ok(await appShown(page), "plain http: Wally opens");
    const ctx2 = await browser.newContext({ serviceWorkers: "block" });
    const ana = await ctx2.newPage();
    ana.errors = [];
    ana.on("pageerror", (e) => ana.errors.push("PAGEERROR " + e.message));
    await ana.goto(http + "/", { waitUntil: "networkidle" });
    await ana.click('[data-prof="2"]');
    await ana.click("#si-forgot");
    await ana.waitForSelector("textarea#vg-in");
    ok((await gate(ana)).includes("Use your recovery key"), "plain http: Forgot password asks for the recovery key");
    await ana.fill("#vg-in", httpKit);
    await ana.click("#vg-go");
    await ana.waitForSelector("#vg-in2");
    await ana.fill("#vg-in", "ana-new-pass");
    await ana.fill("#vg-in2", "ana-new-pass");
    await ana.click("#vg-go");
    ok(await appShown(ana), "plain http: the kit and a new password sign Ana in");
    ok((await ana.evaluate(() => fetch("/api/auth/status").then((r) => r.json()))).me.name === "Ana", "as Ana");
    await page.reload({ waitUntil: "networkidle" });
    ok(await page.locator("#si-in").count() === 1, "plain http: Alex's browser is signed out");
    await page.fill("#si-in", "ana-new-pass");
    await page.click("#si-go");
    ok(await appShown(page), "and signs in with the new password");
    ok(ana.errors.length === 0, "plain http: no page errors" + (ana.errors.length ? " — " + ana.errors.join(" | ") : ""));
    await ctx2.close();
    await ctx.close();
  }
} catch (e) {
  failures++;
  console.log("  FAIL " + (e.stack || e));
} finally {
  await browser.close();
  servers.forEach((s) => s.kill("SIGKILL"));
}
console.log(failures ? "\n" + failures + " failed" : "\nAll setup checks passed.");
process.exit(failures ? 1 : 0);
