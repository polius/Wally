/* Sign-in and the full-screen steps before the app, on real servers.
   Starts three servers of its own: the demo household, an empty database, and a copy of a v1 database.
     REPO=/path/to/Wally PYTHON=/path/to/python PORT=8806 node signin.mjs
   Screenshots go to SHOTS (a folder) when it is set. */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdtempSync, copyFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";

const REPO = process.env.REPO || process.cwd();
const PYTHON = process.env.PYTHON || "python3";
const PORT = +(process.env.PORT || 8806);
const SHOTS = process.env.SHOTS || "";
if (SHOTS && !existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log("  ok  " + msg); else { failures++; console.log("  FAIL " + msg); } };
const servers = [];

async function startServer(port, opts) {
  const data = mkdtempSync(join(tmpdir(), "wally-signin-"));
  if (opts.copy) copyFileSync(opts.copy, join(data, "wally.db"));
  const env = { ...process.env, WALLY_DATA: data, WALLY_RECOVERY_FILE: join(data, "password.txt") };
  if (opts.demo) env.DEMO = "true"; else delete env.DEMO;
  const proc = spawn(PYTHON, ["-m", "uvicorn", "utils.dev_server:app", "--port", String(port)], { cwd: REPO, env, stdio: "ignore" });
  servers.push(proc);
  const base = "http://localhost:" + port;
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(base + "/api/auth/status"); if (r.ok) return { base, data }; } catch (e) { /* not yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server on " + port + " did not start");
}

/* RFC 6238, as the server does it */
function base32(s) {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of s.replace(/[\s=]/g, "").toUpperCase()) bits += abc.indexOf(ch).toString(2).padStart(5, "0");
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
function totp(secret, step = 0) {
  const counter = Math.floor(Date.now() / 30000) + step, buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", base32(secret)).update(buf).digest(), o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, "0");
}

const browser = await chromium.launch();
async function open(base, { width = 1440, height = 900, person, theme = "light" } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme, serviceWorkers: "block" });
  if (person) await ctx.addInitScript((p) => localStorage.setItem("wally.person", p), person);
  const page = await ctx.newPage();
  page.errors = [];
  page.on("console", (m) => { if (m.type() === "error") page.errors.push(m.text()); });
  page.on("pageerror", (e) => page.errors.push("PAGEERROR " + e.message));
  await page.goto(base + "/", { waitUntil: "networkidle" });
  return page;
}
const shot = async (page, name) => { if (SHOTS) await page.waitForTimeout(350), await page.screenshot({ path: join(SHOTS, name + ".png") }); };
const gateText = (page) => page.locator("#gate").innerText();
const appShown = (page) => page.waitForSelector("#app:not([hidden])", { timeout: 8000 }).then(() => true, () => false);
/* Wrong passwords and codes are answered 400, 401 or 429 on purpose here; the browser logs those
   responses. Anything else in the console is a failure. */
const EXPECTED = /^Failed to load resource: the server responded with a status of (400|401|429)/;
const noErrors = (page, what) => {
  const errs = page.errors.filter((e) => !EXPECTED.test(e));
  ok(errs.length === 0, what + ": no console errors" + (errs.length ? " — " + errs.join(" | ") : ""));
};

try {
  /* ================= the demo household ================= */
  const demo = await startServer(PORT, { demo: true });
  console.log("Demo household: " + demo.base);

  // Who is using this browser (sign-in off)
  {
    const page = await open(demo.base);
    await page.waitForSelector("#gate .w-prof");
    ok((await gateText(page)).includes("Who is using Wally on this browser?"), "who: asks who is using this browser");
    ok(await page.locator("#gate .w-prof").count() === 2, "who: lists both people");
    await shot(page, "who");
    await page.locator("#gate .w-prof").nth(1).focus();
    await page.keyboard.press("Enter");
    ok(await appShown(page), "who: picking a person opens the app");
    ok(await page.evaluate(() => localStorage.getItem("wally.person")) === "2", "who: remembered on this browser");
    noErrors(page, "who");
    await page.context().close();
  }

  // Turn sign-in on through the API, with first passwords
  {
    const r = await fetch(demo.base + "/api/signin", { method: "PUT", headers: { "Content-Type": "application/json", "X-Wally-Person": "1" }, body: JSON.stringify({ enabled: true, passwords: { 1: "alexpass1", 2: "anapass12" } }) });
    ok(r.ok, "API: sign-in turned on");
  }

  // Wrong passwords, tries left, the wait, then the right one
  const alex = await open(demo.base);
  {
    const page = alex;
    await page.waitForSelector("#gate .w-prof");
    ok((await gateText(page)).includes("Who is signing in?"), "signin: who is signing in");
    await shot(page, "signin-who");
    await page.click('[data-prof="1"]');
    ok((await gateText(page)).includes("Hi, Alex"), "signin: password step for the person picked");
    ok(await page.evaluate(() => document.activeElement.id) === "si-in", "signin: focus in the password field");
    ok(await page.getAttribute("#si-in", "autocomplete") === "current-password", "signin: password manager friendly");
    await page.click("#si-not");
    ok(await page.locator("#gate .w-prof").count() === 2, "signin: Not Alex? goes back to the names");
    await page.click('[data-prof="1"]');
    await page.fill("#si-in", "wrong-one");
    await page.click("[data-eye]");
    ok(await page.getAttribute("#si-in", "type") === "text", "signin: show password");
    await page.press("#si-in", "Enter");
    await page.waitForSelector(".w-input.err");
    ok((await page.textContent("#si-msg")).includes("4 tries left"), "signin: wrong password says 4 tries left");
    ok(await page.getAttribute("#si-in", "aria-invalid") === "true", "signin: field marked invalid");
    await shot(page, "signin-wrong");
    for (const left of [3, 2, 1]) {
      await page.fill("#si-in", "wrong-" + left);
      await page.press("#si-in", "Enter");
      await page.waitForFunction((n) => document.getElementById("si-msg").textContent.includes(n + (n === 1 ? " try left" : " tries left")), left);
    }
    ok(true, "signin: tries left counts down to 1");
    await page.fill("#si-in", "wrong-5");
    await page.press("#si-in", "Enter");
    await page.waitForFunction(() => /Wait \d+ seconds/.test(document.getElementById("si-msg").textContent));
    const first = await page.textContent("#si-msg");
    ok(await page.isDisabled("#si-go"), "signin: fifth wrong try: Sign in waits");
    await page.waitForTimeout(2100);
    const later = await page.textContent("#si-msg");
    ok(+first.match(/(\d+) seconds/)[1] > +later.match(/(\d+) seconds?/)[1], "signin: the wait counts down live (" + first.match(/\d+/)[0] + " → " + later.match(/\d+/)[0] + ")");
    await shot(page, "signin-wait");
    // A sixth try from a fresh page is refused by the server (429) with its own wait
    await page.reload({ waitUntil: "networkidle" });
    await page.click('[data-prof="1"]');
  }

  // Ana: first password, then she chooses her own
  {
    const page = await open(demo.base, { width: 390, height: 844 });
    await page.waitForSelector("#gate .w-prof");
    await page.click('[data-prof="2"]');
    await shot(page, "signin-password-phone");
    await page.fill("#si-in", "anapass12");
    await page.press("#si-in", "Enter");
    await page.waitForSelector("#pw-new");
    ok((await gateText(page)).includes("Choose your own password"), "must-change: asks Ana to choose her own");
    await page.fill("#pw-new", "short");
    await page.fill("#pw-again", "short");
    await page.press("#pw-again", "Enter");
    await page.waitForSelector("#pw-msg:not([hidden])");
    ok((await page.textContent("#pw-msg")).includes("at least 8"), "must-change: too short is refused");
    await page.fill("#pw-new", "anas-own-pass");
    await page.fill("#pw-again", "anas-own-typo");
    await page.press("#pw-again", "Enter");
    await page.waitForFunction(() => document.getElementById("pw-msg").textContent.includes("different"));
    ok(true, "must-change: different passwords are refused");
    await shot(page, "must-change-phone");
    await page.fill("#pw-new", "anas-own-pass");
    await page.fill("#pw-again", "anas-own-pass");
    await page.click("#pw-go");
    ok(await appShown(page), "must-change: then the app opens");
    const st = await page.evaluate(() => fetch("/api/auth/status").then((r) => r.json()));
    ok(st.me && st.me.id === 2 && !st.must_change_password, "must-change: signed in as Ana, no longer asked");
    noErrors(page, "must-change");
    await page.context().close();
  }

  // Alex, after the wait: the server's own 429 and countdown, then the right password
  {
    const page = alex;
    await page.fill("#si-in", "wrong-6");
    await page.press("#si-in", "Enter");
    await page.waitForFunction(() => /Wait \d+ seconds/.test(document.getElementById("si-msg").textContent));
    ok(true, "signin: the server's 429 shows the wait");
    const secs = +(await page.textContent("#si-msg")).match(/(\d+) seconds/)[1];
    await page.waitForFunction(() => !document.getElementById("si-go").disabled, null, { timeout: (secs + 3) * 1000 });
    ok(await page.locator("#si-msg").isHidden(), "signin: the message goes when the wait is over");
    await page.fill("#si-in", "alexpass1");
    await page.press("#si-in", "Enter");
    ok(await appShown(page), "signin: the right password opens the app");
    ok(await page.evaluate(() => localStorage.getItem("wally.lastSignin")) === "1", "signin: remembers Alex on this browser");
    noErrors(page, "signin");
  }

  // Two-step required for the household: Alex sets it up
  let secret, codes;
  {
    const page = alex;
    const r = await page.request.put(demo.base + "/api/signin", { data: { enabled: true, require_two_step: true } });
    ok(r.ok(), "API: two-step required for everyone");
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector("#ts-in");
    ok(await page.locator(".w-qr svg").count() === 1, "two-step: QR code drawn");
    secret = (await page.textContent("#ts-key")).replace(/\s/g, "");
    ok(/^[A-Z2-7]{32}$/.test(secret), "two-step: key shown to type");
    await shot(page, "twostep-setup");
    await page.fill("#ts-in", "000000");
    await page.waitForSelector("#ts-msg:not([hidden])");
    ok((await page.textContent("#ts-msg")).includes("not right"), "two-step: a wrong code is refused");
    await page.locator("#ts-in").pressSequentially(totp(secret));
    await page.waitForSelector(".w-codes");
    codes = await page.locator(".w-codes code").allTextContents();
    ok(codes.length === 10, "two-step: ten recovery codes");
    await shot(page, "twostep-codes");
    await page.click("#rc-done");
    ok(await appShown(page), "two-step: then the app opens");
    noErrors(page, "two-step setup");
  }

  // Sign out, sign in with the code: wrong, then right (typed digit by digit)
  {
    const page = alex;
    await page.click("[data-signout]");
    await page.waitForSelector("#si-in");
    ok((await gateText(page)).includes("Hi, Alex"), "remember: after Sign out, Wally goes straight to Alex");
    await page.fill("#si-in", "alexpass1");
    await page.press("#si-in", "Enter");
    await page.waitForSelector(".w-sicode");
    ok(await page.getAttribute("#si-in", "autocomplete") === "one-time-code" && await page.getAttribute("#si-in", "inputmode") === "numeric", "code: one-time-code and numeric keyboard");
    await page.locator("#si-in").pressSequentially("111111");
    await page.waitForSelector(".w-input.err");
    ok((await page.textContent("#si-msg")).includes("Codes change every 30 seconds"), "code: wrong code explained, sent without pressing Sign in");
    await shot(page, "code-wrong");
    await page.locator("#si-in").pressSequentially(totp(secret, 1));
    ok(await appShown(page), "code: the right code opens the app");
    noErrors(page, "code");
  }

  // A recovery code, once
  {
    const page = alex;
    await page.click("[data-signout]");
    await page.waitForSelector("#si-in");
    await page.fill("#si-in", "alexpass1");
    await page.press("#si-in", "Enter");
    await page.waitForSelector(".w-sicode");
    await page.click("#si-alt");
    ok((await gateText(page)).includes("Enter one of your recovery codes"), "recovery: asks for a recovery code");
    await page.fill("#si-in", codes[0]);
    await page.press("#si-in", "Enter");
    ok(await appShown(page), "recovery: a recovery code signs in");
    await page.click("[data-signout]");
    await page.waitForSelector("#si-in");
    await page.fill("#si-in", "alexpass1");
    await page.press("#si-in", "Enter");
    await page.waitForSelector(".w-sicode");
    await page.click("#si-alt");
    await page.fill("#si-in", codes[0]);
    await page.press("#si-in", "Enter");
    await page.waitForSelector(".w-input.err");
    ok((await page.textContent("#si-msg")).includes("already used"), "recovery: a used code is refused");
    noErrors(page, "recovery");
  }

  // Forgot password: a one-time password in the file, which also turns two-step off
  {
    const page = alex;
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector("#si-forgot");
    await page.click("#si-forgot");
    await page.waitForSelector(".w-sifile");
    const file = await page.textContent(".w-sifile code");
    ok(file === join(demo.data, "password.txt") || file.endsWith("password.txt"), "forgot: names the file on the server");
    ok((await gateText(page)).includes("turns off two-step"), "forgot: says two-step is turned off");
    await shot(page, "forgot");
    const line = readFileSync(join(demo.data, "password.txt"), "utf8").split("\n").find((l) => l.startsWith("Alex: "));
    ok(!!line, "forgot: the file has a line for Alex");
    await page.click("#si-back");
    await page.fill("#si-in", line.slice(6).trim());
    await page.press("#si-in", "Enter");
    await page.waitForSelector("#pw-new");
    ok(true, "forgot: the one-time password signs in without a code, and asks for a new password");
    await page.fill("#pw-new", "alex-new-pass");
    await page.fill("#pw-again", "alex-new-pass");
    await page.press("#pw-again", "Enter");
    await page.waitForSelector("#ts-in");
    ok(true, "forgot: two-step was off, and the household requires it: set up again");
    const s2 = (await page.textContent("#ts-key")).replace(/\s/g, "");
    await page.fill("#ts-in", totp(s2));
    await page.waitForSelector(".w-codes");
    await page.click("#rc-done");
    ok(await appShown(page), "forgot: back in the app");
    noErrors(page, "forgot");
    await page.context().close();
  }

  /* ================= an empty database: first run ================= */
  const empty = await startServer(PORT + 1, {});
  console.log("Empty database: " + empty.base);
  {
    const page = await open(empty.base);
    await page.waitForSelector(".w-onb");
    ok((await gateText(page)).includes("Welcome to Wally"), "welcome: shown on an empty database");
    await shot(page, "welcome-1");
    await page.selectOption("#onb-cur", "USD");
    await page.click('#onb-pos [data-v="left"]');
    await page.click("#onb-next");
    await page.waitForSelector("[data-name]");
    ok((await gateText(page)).includes("Who shares this household?"), "welcome: step 2, people");
    await page.click("#onb-next");
    await page.waitForSelector("#onb-err:not([hidden])");
    ok((await page.textContent("#onb-err")).includes("your own name"), "welcome: a name is needed");
    await page.fill('[data-name="0"]', "Sam");
    await page.click("#onb-add");
    ok(await page.evaluate(() => document.activeElement.dataset.name) === "1", "welcome: Add someone focuses the new row");
    await page.keyboard.type("Kim");
    await page.click("#onb-add");
    await page.keyboard.type("Extra");
    await page.click('[data-drop="2"]');
    ok(await page.locator("[data-name]").count() === 2, "welcome: a row can be removed");
    await page.click("#onb-pw");
    await page.fill("#onb-pwd", "short");
    await page.click("#onb-next");
    await page.waitForFunction(() => document.getElementById("onb-err").textContent.includes("8"));
    ok(true, "welcome: a short password is refused");
    await page.fill("#onb-pwd", "household-pass");
    await shot(page, "welcome-2");
    await page.click("#onb-next");
    await page.waitForSelector("[data-onb-data]");
    ok((await gateText(page)).includes("Bring your data"), "welcome: step 3, your data");
    await shot(page, "welcome-3");
    await page.click('[data-onb-data="import"]');
    ok((await page.textContent("#onb-next")).includes("Choose a file"), "welcome: Import a CSV says Choose a file");
    await page.click("#onb-next");
    await page.waitForURL("**/settings/import");
    ok(await appShown(page), "welcome: Import opens the app at Settings › Import");
    const st = await page.evaluate(() => fetch("/api/auth/status").then((r) => r.json()));
    ok(st.onboarded && st.people.length === 2 && st.signin && st.me && st.me.name === "Sam", "welcome: onboarded, two people, sign-in on, signed in as Sam");
    const cur = await page.evaluate(() => fetch("/api/currency").then((r) => r.json()));
    ok(cur.selected === "USD" && cur.position === "left", "welcome: currency and symbol position saved");
    noErrors(page, "welcome");
    await page.context().close();
  }

  /* ================= upgrade from v1: the household password, then people ================= */
  const v1 = await startServer(PORT + 2, { copy: join(REPO, "tests/fixtures/v1.db") });
  console.log("v1 database: " + v1.base);
  {
    const page = await open(v1.base);
    await page.waitForSelector("#si-in");
    ok((await gateText(page)).includes("Enter the household password"), "upgrade: the household password, nobody to pick");
    await shot(page, "upgrade-household");
    await page.fill("#si-in", "nope-nope");
    await page.press("#si-in", "Enter");
    await page.waitForSelector(".w-input.err");
    ok(true, "upgrade: a wrong household password is refused");
    await page.fill("#si-in", "household");
    await page.press("#si-in", "Enter");
    await page.waitForSelector("[data-name]");
    ok((await gateText(page)).includes("Who uses Wally?"), "upgrade: asks who uses Wally");
    await page.fill('[data-name="0"]', "Alex");
    await page.click("#onb-add");
    await page.keyboard.type("Ana");
    await shot(page, "upgrade-people");
    await page.click("#onb-next");
    await page.waitForSelector("[data-tagfor]");
    ok((await gateText(page)).includes("Turn a tag into a person"), "upgrade: offers to turn a tag into a person");
    const ids = await page.$$eval("[data-tagfor]", (l) => l.map((s) => s.dataset.tagfor));
    await page.selectOption(`[data-tagfor="${ids[1]}"]`, "ana");
    await page.waitForFunction((id) => /\d+ transactions? becomes?/.test(document.getElementById("tagn-" + id).textContent), ids[1]);
    const preview = await page.textContent("#tagn-" + ids[1]);
    ok(preview.includes("become Ana’s") || preview.includes("becomes Ana’s"), "upgrade: preview counts the tag (" + preview + ")");
    await shot(page, "upgrade-tags");
    await page.click("#onb-next");
    await page.waitForFunction(() => document.getElementById("gate").innerText.includes("Now sign in as yourself"));
    ok(true, "upgrade: then each person signs in as themselves");
    await page.click("#onb-next");
    await page.waitForSelector("#gate .w-prof");
    await page.click("#gate .w-prof >> nth=0");
    await page.fill("#si-in", "household");
    await page.press("#si-in", "Enter");
    await page.waitForSelector("#pw-new");
    ok(true, "upgrade: the household password is the first password, and must be changed");
    await page.fill("#pw-new", "alex-own-pass");
    await page.fill("#pw-again", "alex-own-pass");
    await page.press("#pw-again", "Enter");
    ok(await appShown(page), "upgrade: then the app");
    const usage = await page.evaluate((ids) => Promise.all(ids.map((id) => fetch("/api/people/" + id + "/usage").then((r) => r.json()))), ids);
    ok(usage[1].own === 3 && usage[0].own === 0, "upgrade: tagged transactions became Ana’s, the rest stay shared");
    noErrors(page, "upgrade");
    // Arabic, dark, on a phone: the sign-in screen mirrors
    await page.evaluate(() => fetch("/api/language/ar", { method: "PUT" }));
    await page.click("[data-signout]");
    await page.waitForSelector("#si-in");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "dark" });
    ok(await page.evaluate(() => document.documentElement.dir) === "rtl", "arabic: right to left");
    await shot(page, "signin-ar-dark-phone");
    noErrors(page, "arabic");
    await page.context().close();
  }
} catch (e) {
  failures++;
  console.log("  FAIL " + (e.stack || e.message));
} finally {
  await browser.close();
  servers.forEach((p) => p.kill());
}
console.log(failures ? failures + " failed" : "all passed");
process.exit(failures ? 1 : 0);
