/* First run with encryption: the "Who runs this server?" step, and WALLY_ENCRYPTION=required.
     REPO=/path/to/Wally PYTHON=/path/to/python PORT=8941 node vault-setup.mjs
   Starts its own servers. Screenshots go to SHOTS (a folder) when it is set. */
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
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
  const env = { ...process.env, WALLY_DATA: data, WALLY_RECOVERY_FILE: join(data, "password.txt") };
  delete env.DEMO;
  if (required) env.WALLY_ENCRYPTION = "required"; else delete env.WALLY_ENCRYPTION;
  const proc = spawn(PYTHON, ["-m", "uvicorn", "utils.dev_server:app", "--port", String(p), "--host", host], { cwd: REPO, env, stdio: "ignore" });
  servers.push(proc);
  const base = "http://localhost:" + p;
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(base + "/api/health"); if (r.ok) return { base, data, port: p, proc }; } catch (e) { /* not yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server did not start");
}
const stop = async (s) => { const done = new Promise((r) => s.proc.once("exit", r)); s.proc.kill("SIGKILL"); await done; };
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
  ok(means.includes("Your password is the key.") && means.includes("You save an Emergency Kit.") && means.includes("Everyone else gets a code.") && means.includes("Phone shortcuts and API keys are off."),
    "choosing Someone else says, in four plain lines, what changes");
  ok(await page.locator("#onb-next").innerText() === "Encrypt and continue", "and the button says what it does");
  await shot(page, "setup-question");
  await page.click("#onb-next");
  await page.waitForSelector(".w-kitkey", { timeout: 30000 });
  ok((await gate(page)).includes("Save your Emergency Kit"), "encrypted at once: the Emergency Kit follows");
  ok(await page.locator("[data-code]").count() === 1, "with a code for Ana on the same page");
  const anaCode = await page.getAttribute("[data-code]", "data-code");
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
  const inside = check("open", join(a.data, "wally.db"), "alex-pass-1", "1");
  ok(inside.counts.transaction === 0 && inside.counts.category === 0 && inside.items.some((i) => i.includes("Fruiteria Rosa")), "nothing in the clear: the first transaction exists only encrypted");
  ok(!check("grep", join(a.data, "wally.db"), "Fruiteria").Fruiteria, "its name is nowhere in the file");
  noErrors(page, "setup, encrypted");
  // Ana joins with her code
  const ana = await device(a.base);
  await ana.click('[data-prof="2"]');
  await ana.fill("#si-in", "alex-pass-1");
  await ana.click("#si-go");
  await ana.waitForSelector("#vg-in", { timeout: 15000 });
  ok((await gate(ana)).includes("Enter the code"), "Ana is asked for her code, not the shared first password");
  await ana.fill("#vg-in", anaCode);
  await ana.click("#vg-go");
  await ana.waitForSelector("#vg-in2", { timeout: 15000 });
  await ana.fill("#vg-in", "ana-own-pass");
  await ana.fill("#vg-in2", "ana-own-pass");
  await ana.click("#vg-go");
  await ana.waitForSelector("#vg-saved", { timeout: 30000 });
  await ana.check("#vg-saved");
  await ana.click("#vg-done");
  ok(await appShown(ana), "Ana joins with her code and her own password");
  ok(await ana.evaluate(async (id) => (await import("/js/core.js")).state.tx.some((t) => t.id === id), created.id), "and sees Alex’s first transaction");
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
  await page.click("#onb-next");
  await page.waitForSelector("[data-onb-data]");
  await page.click("#onb-back");
  ok(await page.locator('[data-who="me"][aria-checked="true"]').count() === 1, "Back keeps the choice");
  await page.click("#onb-next");
  await page.waitForSelector("[data-onb-data]");
  await page.click('[data-onb-data="add"]');
  await page.click("#onb-next");
  ok(await appShown(page), "Wally opens");
  ok(!(await status(b.base)).vault.on, "not encrypted");
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
  noErrors(page, "required setup");
  await page.context().close();

  // An unencrypted household on a server that now requires it
  console.log("\nRequired, on a household made before");
  const old = await startServer();
  const api = async (method, path, body, headers) => fetch(old.base + "/api" + path, { method, headers: { "content-type": "application/json", "x-wally-person": "1", ...(headers || {}) }, body: body ? JSON.stringify(body) : undefined });
  await api("POST", "/people", { name: "Alex" });
  await api("POST", "/transactions", { name: "Mercadona", category: "Groceries", amount: "20", date: new Date().toISOString().slice(0, 10) });
  await api("PUT", "/config", { onboarded: true });
  await api("PUT", "/signin", { enabled: true, passwords: { 1: "alex-pass-1" } });
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
