/* Sign-in and the full-screen steps before the app, on real servers.
   Starts three servers of its own: the demo household, an empty database, and a copy of a v1 database.
     REPO=/path/to/Wally PYTHON=/path/to/python PORT=8806 node signin.mjs
   Screenshots go to SHOTS (a folder) when it is set. */
import { chromium } from "playwright";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac, createHash, randomBytes } from "node:crypto";

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
  const env = { ...process.env, WALLY_DATA: data };
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
/* Emergency Kit keys, as Wally makes them: 31 random bytes and a check byte, in Crockford base32 */
const ABC = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function keyFrom(body) {
  const raw = Buffer.concat([body, createHash("sha256").update(body).digest().subarray(0, 1)]);
  const bits = [...raw].map((b) => b.toString(2).padStart(8, "0")).join("").padEnd(260, "0");
  let out = "";
  for (let i = 0; i < 52; i++) out += ABC[parseInt(bits.slice(i * 5, i * 5 + 5), 2)];
  return out.match(/.{4}/g).join("-");
}
function checks(key) {
  const s = key.replace(/-/g, "");
  const bits = [...s].map((c) => ABC.indexOf(c).toString(2).padStart(5, "0")).join("");
  const raw = Buffer.from(Array.from({ length: 32 }, (_, i) => parseInt(bits.slice(i * 8, i * 8 + 8), 2)));
  return !bits.slice(256).includes("1") && raw[31] === createHash("sha256").update(raw.subarray(0, 31)).digest()[0];
}
const otherKey = () => keyFrom(randomBytes(31));
/* The key with one character changed, so that its check byte no longer matches */
function typo(key) {
  for (let i = 0; i < key.length; i++) {
    if (key[i] === "-") continue;
    const k = key.slice(0, i) + (key[i] === "A" ? "B" : "A") + key.slice(i + 1);
    if (!checks(k)) return k;
  }
  throw new Error("no typo found");
}
/* What whoever runs the server types: python3 -m api.signin_off, on that server's data */
function signinOff(dataDir) {
  const r = spawnSync(PYTHON, ["-m", "api.signin_off"], { cwd: REPO, env: { ...process.env, WALLY_DATA: dataDir }, encoding: "utf8" });
  return { code: r.status, text: (r.stdout || "") + (r.stderr || "") };
}

/* The server takes each 30-second code once, for the whole household (everyone shares the secret).
   The next code it will take: this period's or the next one's, or wait for a new period. */
let lastCounter = -1;
async function freshCode(secret) {
  for (;;) {
    const now = Math.floor(Date.now() / 30000);
    for (const step of [0, 1]) if (now + step > lastCounter) { lastCounter = now + step; return totp(secret, step); }
    await new Promise((r) => setTimeout(r, 1000));
  }
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
/* Sign out lives in Settings › People, on your own row */
const signOutVia = async (page) => { await page.goto(new URL("/settings/people", page.url()).href, { waitUntil: "networkidle" }); await page.click("#set-pane [data-signout]"); };
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
    await page.waitForSelector("#gate .w-whop");
    ok((await gateText(page)).includes("Who’s using Wally?"), "who: asks who is using Wally");
    ok(await page.locator("#gate .w-whop").count() === 2, "who: lists both people");
    await page.waitForTimeout(700);
    await shot(page, "who");
    await page.keyboard.press("Tab");
    await page.keyboard.press("ArrowRight");
    ok(await page.evaluate(() => document.activeElement.dataset.prof) === "2", "who: arrows move between people");
    await page.keyboard.press("Enter");
    ok(await appShown(page), "who: picking a person opens the app");
    ok(await page.evaluate(() => localStorage.getItem("wally.person")) === "2", "who: remembered on this browser");
    noErrors(page, "who");
    await page.context().close();
  }

  // Turn sign-in on through the API: one household password for everyone, and its Emergency Kit
  let kit;
  {
    const r = await fetch(demo.base + "/api/signin", { method: "PUT", headers: { "Content-Type": "application/json", "X-Wally-Person": "1" }, body: JSON.stringify({ enabled: true, password: "household1" }) });
    const body = await r.json();
    kit = body.kit;
    ok(r.ok && body.signin === true, "API: sign-in turned on, with the household password");
    ok(/^([0-9A-Z]{4}-){12}[0-9A-Z]{4}$/.test(kit || "") && checks(kit), "API: and the household's Emergency Kit, made by the server (" + kit + ")");
    const st = await (await fetch(demo.base + "/api/auth/status")).json();
    ok(st.signin && st.two_step === false && !("require_two_step" in st) && !("needs_two_step" in st) && !("household_password" in st) && !("must_change_password" in st), "API: status says two_step, and nothing per person");
    ok(!st.signed_in && typeof st.kit === "string" && !isNaN(Date.parse(st.kit)), "API: status says when the kit was made, even signed out (" + st.kit + ")");
    const kdf = await (await fetch(demo.base + "/api/vault/kdf")).json();
    ok(!("one_time" in kdf), "API: /vault/kdf has no one_time");
    const gone = (await fetch(demo.base + "/api/login/recover", { method: "POST" })).status;
    ok(gone === 404 || gone === 405, "API: /login/recover is gone (" + gone + ")");
    ok(st.people.every((p) => !("has_password" in p) && !("two_step" in p)), "API: people carry no password or two-step of their own");
  }

  // Wrong passwords, not counted out loud, the wait after ten, then the right one
  const alex = await open(demo.base);
  {
    const page = alex;
    await page.waitForSelector("#gate .w-prof");
    ok((await gateText(page)).includes("Who is signing in?"), "signin: who is signing in");
    ok((await gateText(page)).includes("Everyone uses the household password"), "signin: says everyone uses the household password");
    await shot(page, "signin-who");
    await page.click('[data-prof="1"]');
    ok((await gateText(page)).includes("Hi, Alex") && (await gateText(page)).includes("Enter the household password"), "signin: the household password, for the person picked");
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
    ok((await page.textContent("#si-msg")).trim() === "That password isn’t right.", "signin: a wrong password says only that, with no tries counted");
    ok(await page.getAttribute("#si-in", "aria-invalid") === "true", "signin: field marked invalid");
    await shot(page, "signin-wrong");
    for (let n = 2; n <= 9; n++) {
      await page.fill("#si-in", "wrong-" + n);
      await Promise.all([page.waitForResponse((r) => r.url().endsWith("/api/login") && r.status() === 401), page.press("#si-in", "Enter")]);
    }
    ok(!/Wait/.test(await page.textContent("#si-msg")), "signin: nine wrong tries, still no wait");
    await page.fill("#si-in", "wrong-10");
    await page.press("#si-in", "Enter");
    await page.waitForFunction(() => /Wait \d+ seconds/.test(document.getElementById("si-msg").textContent));
    const first = await page.textContent("#si-msg");
    ok(await page.isDisabled("#si-go"), "signin: tenth wrong try: Sign in waits");
    await page.waitForTimeout(2100);
    const later = await page.textContent("#si-msg");
    ok(+first.match(/(\d+) seconds/)[1] > +later.match(/(\d+) seconds?/)[1], "signin: the wait counts down live (" + first.match(/\d+/)[0] + " → " + later.match(/\d+/)[0] + ")");
    await shot(page, "signin-wait");
    // An eleventh try from a fresh page is refused by the server (429) with its own wait
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector("#gate .w-prof");
    await page.click('[data-prof="1"]');
    await page.fill("#si-in", "wrong-6");
    await page.press("#si-in", "Enter");
    await page.waitForFunction(() => /Wait \d+ seconds/.test(document.getElementById("si-msg").textContent));
    ok(true, "signin: the server's 429 shows the wait");
    const secs = +(await page.textContent("#si-msg")).match(/(\d+) seconds/)[1];
    await page.waitForFunction(() => !document.getElementById("si-go").disabled, null, { timeout: (secs + 3) * 1000 });
    ok(await page.locator("#si-msg").isHidden(), "signin: the message goes when the wait is over");
    await page.fill("#si-in", "household1");
    await page.press("#si-in", "Enter");
    ok(await appShown(page), "signin: the household password opens the app for Alex");
    ok(await page.evaluate(() => localStorage.getItem("wally.lastSignin")) === "1", "signin: remembers Alex on this browser");
    const st = await page.evaluate(() => fetch("/api/auth/status").then((r) => r.json()));
    ok(st.me && st.me.id === 1 && !(await page.locator("#gate").isVisible()), "signin: signed in as Alex, nothing more to do");
    noErrors(page, "signin");
  }

  // Ana, on her phone: the same password, under her own name
  const ana = await open(demo.base, { width: 390, height: 844 });
  {
    const page = ana;
    await page.waitForSelector("#gate .w-prof");
    await page.click('[data-prof="2"]');
    ok((await gateText(page)).includes("Hi, Ana"), "same password: Ana picks her name");
    await shot(page, "signin-password-phone");
    await page.fill("#si-in", "household1");
    await page.press("#si-in", "Enter");
    ok(await appShown(page), "same password: the household password opens the app for Ana too");
    const st = await page.evaluate(() => fetch("/api/auth/status").then((r) => r.json()));
    ok(st.me && st.me.id === 2, "same password: signed in as Ana, not asked to choose her own");
    noErrors(page, "Ana signs in");
  }

  // Signed-in browsers: who is on each
  {
    const page = alex;
    const sessions = await page.evaluate(() => fetch("/api/sessions").then((r) => r.json()));
    // (the API call that turned sign-in on is a third one, as Alex)
    ok(sessions.length === 3 && sessions.every((s) => s.person_id === 1 || s.person_id === 2) && sessions.some((s) => s.person_id === 1 && s.current) && sessions.some((s) => s.person_id === 2 && !s.current), "sessions: every browser listed, each with who is on it");
    await page.goto(demo.base + "/settings/signin", { waitUntil: "networkidle" });
    await page.waitForFunction(() => /Last seen/.test(document.getElementById("set-pane").textContent));
    const pane = await page.textContent("#set-pane");
    ok(/Ana · Last seen/.test(pane) && /Alex · Last seen/.test(pane), "Settings › Sign-in: Signed-in browsers shows who is on each");
    ok(pane.includes("Household password") && pane.includes("Two-step sign-in") && !pane.includes("Recovery codes"), "Settings › Sign-in: the household password and two-step rows, no recovery codes while two-step is off");
    await shot(page, "settings-signin-browsers");
  }

  // Two-step for the household: Alex turns it on (with the household password), through the API
  let secret, codes;
  {
    const page = alex;
    const setup = await (await page.request.post(demo.base + "/api/two-step/setup")).json();
    secret = setup.secret;
    ok(/^[A-Z2-7]{32}$/.test(secret) && setup.uri.startsWith("otpauth://totp/"), "two-step: a secret to scan");
    const bad = await page.request.post(demo.base + "/api/two-step/confirm", { data: { code: totp(secret), password: "not-the-one" }, failOnStatusCode: false });
    ok(bad.status() === 401, "two-step: turning it on with a wrong password is refused (" + bad.status() + ")");
    const wrongCode = await page.request.post(demo.base + "/api/two-step/confirm", { data: { code: "000000", password: "household1" }, failOnStatusCode: false });
    ok(wrongCode.status() === 400, "two-step: a wrong code is refused");
    const r = await page.request.post(demo.base + "/api/two-step/confirm", { data: { code: totp(secret), password: "household1" } });
    codes = (await r.json()).recovery_codes;
    ok(codes.length === 10, "two-step: on, with ten recovery codes for the household");
    const st = await page.evaluate(() => fetch("/api/auth/status").then((r) => r.json()));
    ok(st.two_step === true, "two-step: status says it is on");
  }

  // Alex signs out and in: the password, then the code (wrong, then right, typed digit by digit)
  {
    const page = alex;
    await signOutVia(page);
    await page.waitForSelector("#si-in");
    ok((await gateText(page)).includes("Hi, Alex"), "remember: after Sign out, Wally goes straight to Alex");
    await page.fill("#si-in", "household1");
    await page.press("#si-in", "Enter");
    await page.waitForSelector(".w-sicode");
    ok(await page.getAttribute("#si-in", "autocomplete") === "one-time-code" && await page.getAttribute("#si-in", "inputmode") === "numeric", "code: one-time-code and numeric keyboard");
    ok(await page.locator("#si-nophone").isVisible() && (await page.textContent("#si-nophone")).includes("No phone or codes?"), "code: a “No phone or codes?” link");
    await page.locator("#si-in").pressSequentially("111111");
    await page.waitForSelector(".w-input.err");
    ok((await page.textContent("#si-msg")).includes("Codes change every 30 seconds"), "code: wrong code explained, sent without pressing Sign in");
    await shot(page, "code-wrong");
    await page.locator("#si-in").pressSequentially(await freshCode(secret));
    ok(await appShown(page), "code: the right code opens the app");
    noErrors(page, "code");
  }

  // Ana, on a second browser: the same password and a code from the same secret
  const ana2 = await open(demo.base);
  {
    const page = ana2;
    await page.waitForSelector("#gate .w-prof");
    await page.click('[data-prof="2"]');
    await page.fill("#si-in", "household1");
    await page.press("#si-in", "Enter");
    await page.waitForSelector(".w-sicode");
    ok((await gateText(page)).includes("Two-step sign-in"), "shared two-step: Ana is asked for a code too");
    await page.locator("#si-in").pressSequentially(await freshCode(secret));
    ok(await appShown(page), "shared two-step: a code from the household's secret signs Ana in");
    const st = await page.evaluate(() => fetch("/api/auth/status").then((r) => r.json()));
    ok(st.me && st.me.id === 2, "shared two-step: as Ana");
    noErrors(page, "shared two-step");
  }

  // Add a phone: the password, then the same secret again
  {
    const page = alex;
    await page.goto(demo.base + "/settings/signin", { waitUntil: "networkidle" });
    await page.waitForFunction(() => /10 of 10 left/.test(document.getElementById("set-pane").textContent));
    ok(true, "Settings › Sign-in: 10 of 10 recovery codes left");
    ok(await page.locator('[data-act="2off"]').count() === 1, "Settings › Sign-in: two-step can be turned off");
    await page.click('[data-act="2show"]');
    await page.waitForSelector("#ts-pw");
    ok(await page.locator("#ts-secret").count() === 0, "Add a phone: asks for the password before showing anything");
    await page.fill("#ts-pw", "not-the-one");
    await page.click("#dlg [data-dlg-ok]");
    await page.waitForFunction(() => { const e = document.getElementById("dlg-err"); return e && !e.hidden && e.textContent; });
    ok(/not right/.test(await page.textContent("#dlg-err")), "Add a phone: a wrong password is refused");
    await page.fill("#ts-pw", "household1");
    await page.click("#dlg [data-dlg-ok]");
    await page.waitForSelector("#ts-secret");
    ok((await page.textContent("#ts-secret")).replace(/\s/g, "") === secret, "Add a phone: shows the same secret as everyone's phone");
    ok(await page.locator("#dlg svg.w-qr").count() === 1, "Add a phone: with its QR code");
    await shot(page, "add-a-phone");
    await page.click("#dlg [data-dlg-ok]");
    await page.waitForFunction(() => document.getElementById("dlg").hidden);
    noErrors(page, "add a phone");
  }

  // A recovery code, once
  {
    const page = alex;
    await signOutVia(page);
    await page.waitForSelector("#si-in");
    await page.fill("#si-in", "household1");
    await page.press("#si-in", "Enter");
    await page.waitForSelector(".w-sicode");
    await page.click("#si-alt");
    ok((await gateText(page)).includes("Enter one of your recovery codes"), "recovery: asks for a recovery code");
    await page.fill("#si-in", codes[0]);
    await page.press("#si-in", "Enter");
    ok(await appShown(page), "recovery: a recovery code signs in");
    await signOutVia(page);
    await page.waitForSelector("#si-in");
    await page.fill("#si-in", "household1");
    await page.press("#si-in", "Enter");
    await page.waitForSelector(".w-sicode");
    await page.click("#si-alt");
    await page.fill("#si-in", codes[0]);
    await page.press("#si-in", "Enter");
    await page.waitForSelector(".w-input.err");
    ok((await page.textContent("#si-msg")).includes("already used"), "recovery: a used code is refused");
    await page.fill("#si-in", codes[1]);
    await page.press("#si-in", "Enter");
    ok(await appShown(page), "recovery: another code signs in");
    noErrors(page, "recovery");
  }

  // Alex changes the household password: Ana's browsers are signed out, and she signs in with the new one
  {
    const page = alex;
    await page.goto(demo.base + "/settings/signin", { waitUntil: "networkidle" });
    await page.waitForSelector('[data-act="password"]');
    await page.click('[data-act="password"]');
    await page.fill("#pw-cur", "household1");
    await page.fill("#pw-new", "household2");
    await page.fill("#pw-rep", "household2");
    await page.click("#dlg [data-dlg-ok]");
    await page.waitForFunction(() => document.getElementById("toast").classList.contains("on") && /Password changed/.test(document.getElementById("toast-t").textContent), null, { timeout: 15000 });
    ok(true, "change password: changed in Settings › Sign-in");
    const sessions = await page.evaluate(() => fetch("/api/sessions").then((r) => r.json()));
    ok(sessions.length === 1 && sessions[0].current, "change password: only this browser is still signed in");
    await ana.reload({ waitUntil: "networkidle" });
    await ana.waitForSelector("#si-in");
    ok((await gateText(ana)).includes("Hi, Ana"), "change password: Ana's phone is signed out");
    await ana2.reload({ waitUntil: "networkidle" });
    ok(await ana2.locator("#si-in").count() === 1 && !(await ana2.locator("#app").isVisible()), "change password: and her other browser too");
    await ana.fill("#si-in", "household1");
    await ana.press("#si-in", "Enter");
    await ana.waitForSelector(".w-input.err");
    ok(true, "change password: the old one no longer works");
    await ana.fill("#si-in", "household2");
    await ana.press("#si-in", "Enter");
    await ana.waitForSelector(".w-sicode");
    await ana.locator("#si-in").pressSequentially(await freshCode(secret));
    ok(await appShown(ana), "change password: Ana signs in with the new one (and the same two-step)");
    noErrors(page, "change password"); noErrors(ana, "Ana after the new password");
    await ana2.context().close();
  }

  // No phone or codes, and the password forgotten: the Emergency Kit, without a code, then a new household password
  {
    const page = alex;
    await signOutVia(page);
    await page.waitForSelector("#si-in");
    await page.fill("#si-in", "household2");
    await page.press("#si-in", "Enter");
    await page.waitForSelector("#si-nophone");
    await page.click("#si-nophone");
    await page.waitForSelector("textarea#vg-in");
    ok((await gateText(page)).includes("Use your recovery key") && (await gateText(page)).includes("It works without two-step sign-in too."), "no phone: asks for the recovery key, which works without two-step");
    // Lost it too: whoever runs the server can turn sign-in off
    await page.click("#vg-help");
    await page.waitForSelector("#vg-rec");
    const help = await gateText(page);
    ok(help.includes("Ask Ana") && help.includes("docker exec wally python3 -m api.signin_off"), "Lost it too?: ask Ana, or whoever runs the server, with the command");
    await shot(page, "lost-kit-too");
    await page.click("#vg-rec");
    await page.waitForSelector("textarea#vg-in");
    // A key from another kit: not this household's
    await page.fill("#vg-in", otherKey());
    await page.click("#vg-go");
    await page.waitForFunction(() => !document.getElementById("vg-msg").hidden);
    ok((await page.textContent("#vg-msg")).trim() === "That recovery key isn’t right.", "kit: a wrong key is refused, with no tries counted (" + (await page.textContent("#vg-msg")) + ")");
    // One letter mistyped: caught by the check digit
    await page.fill("#vg-in", typo(kit));
    await page.click("#vg-go");
    await page.waitForFunction(() => /typo/.test(document.getElementById("vg-msg").textContent));
    ok(true, "kit: a mistyped key is caught (" + (await page.textContent("#vg-msg")) + ")");
    await shot(page, "kit-typo");
    // In lower case, without dashes: still the key
    await page.fill("#vg-in", kit.toLowerCase().replace(/-/g, ""));
    await page.click("#vg-go");
    await page.waitForSelector("#vg-in2");
    ok((await gateText(page)).includes("Choose a new household password"), "kit: the right key (lower case, no dashes), no code, then “Choose a new household password”");
    await shot(page, "choose-household-password");
    await page.fill("#vg-in", "short");
    await page.fill("#vg-in2", "short");
    await page.click("#vg-go");
    await page.waitForFunction(() => /at least 8/.test(document.getElementById("vg-msg").textContent));
    ok(true, "new password: too short is refused");
    await page.fill("#vg-in", "household3");
    await page.fill("#vg-in2", "household-typo");
    await page.click("#vg-go");
    await page.waitForFunction(() => /different/.test(document.getElementById("vg-msg").textContent));
    ok(true, "new password: different passwords are refused");
    await page.fill("#vg-in", "household3");
    await page.fill("#vg-in2", "household3");
    await page.click("#vg-go");
    ok(await appShown(page), "new password: then the app opens, without a code");
    const st = await page.evaluate(() => fetch("/api/auth/status").then((r) => r.json()));
    ok(st.me && st.me.id === 1 && st.two_step === true && !!st.kit, "new password: signed in as Alex; two-step stays on, and so does the kit");
    const sessions = await page.evaluate(() => fetch("/api/sessions").then((r) => r.json()));
    ok(sessions.length === 1 && sessions[0].current, "new password: every other browser is signed out");
    noErrors(page, "kit");
    // Ana: signed out, and in with the new password and the same two-step
    await ana.reload({ waitUntil: "networkidle" });
    await ana.waitForSelector("#si-in");
    ok((await gateText(ana)).includes("Hi, Ana"), "new password: Ana's phone is signed out");
    await ana.fill("#si-in", "household3");
    await ana.press("#si-in", "Enter");
    await ana.waitForSelector(".w-sicode");
    await ana.locator("#si-in").pressSequentially(await freshCode(secret));
    ok(await appShown(ana), "new password: Ana signs in with it, and the household's code");
    noErrors(ana, "Ana after the kit");
    // Forgot password on the password step: the same recovery key, and the kit still works
    const other = await open(demo.base);
    await other.waitForSelector("#gate .w-prof");
    await other.click('[data-prof="2"]');
    await other.click("#si-forgot");
    await other.waitForSelector("textarea#vg-in");
    ok((await gateText(other)).includes("Use your recovery key"), "forgot: Forgot password? asks for the recovery key too");
    await other.click("#vg-back");
    // On a browser that hasn't signed in before, Back starts sign-in over, at the names
    await other.waitForSelector("#si-forgot, #gate .w-prof");
    ok(/Hi, Ana|Who is signing in\?/.test(await gateText(other)), "forgot: Back to sign in");
    noErrors(other, "forgot");
    await other.context().close();
  }

  // Whoever runs the server, when the kit is lost too: python3 -m api.signin_off
  {
    const out = signinOff(demo.data);
    ok(out.code === 0 && /Sign-in is off/.test(out.text), "signin_off: turns sign-in off (" + out.text.trim() + ")");
    const st = await (await fetch(demo.base + "/api/auth/status")).json();
    ok(st.signin === false && st.kit === null && st.two_step === false, "signin_off: no password, kit or two-step left");
    await alex.reload({ waitUntil: "networkidle" });
    await alex.waitForSelector("#gate .w-whop");
    ok((await gateText(alex)).includes("Who’s using Wally?"), "signin_off: the signed-in browser now asks who is using it");
    const again = signinOff(demo.data);
    ok(again.code === 0 && /already off/.test(again.text), "signin_off: a second time, it says it is already off");
    noErrors(alex, "signin_off");
    await ana.context().close();
    await alex.context().close();
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
    ok((await page.locator('[data-av="0"]').innerText()).trim() === "S", "welcome: the face fills in as the name is typed");
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
    // With a password: who runs the server (tests/e2e/vault-setup.mjs covers the other answer)
    await page.waitForSelector("[data-who]");
    ok((await gateText(page)).includes("Who runs this server?"), "welcome: step 3, who runs the server");
    await page.click('[data-who="me"]');
    await page.click("#onb-next");
    // Not encrypted: the Emergency Kit made with the password
    await page.waitForSelector(".w-kitkey");
    ok((await gateText(page)).includes("Save the household’s Emergency Kit") && !(await gateText(page)).includes("Wally is encrypted"), "welcome: Me: the household's Emergency Kit, not encrypted");
    const onbKit = (await page.locator(".w-kitkey").innerText()).replace(/\s+/g, "-");
    ok(checks(onbKit), "welcome: a real recovery key (" + onbKit + ")");
    ok(await page.locator("#onb-dl").count() === 1 && await page.locator("#onb-copy").count() === 1 && (await page.locator("#onb-dl").innerText()).includes("Download PDF"), "welcome: Download PDF and Copy");
    await shot(page, "welcome-kit");
    await page.click("#onb-next");
    await page.waitForSelector("#onb-err:not([hidden])");
    ok((await page.textContent("#onb-err")).includes("Save your Emergency Kit first"), "welcome: Continue waits for the tick");
    await page.check("#onb-saved");
    await page.click("#onb-next");
    await page.waitForSelector("[data-onb-data]");
    ok((await gateText(page)).includes("Bring your data"), "welcome: step 4, your data");
    ok(await page.locator("#onb-back").count() === 0, "welcome: no Back into the kit");
    await shot(page, "welcome-3");
    await page.click('[data-onb-data="import"]');
    ok((await page.textContent("#onb-next")).includes("Choose a file"), "welcome: Import a CSV says Choose a file");
    await page.click("#onb-next");
    await page.waitForURL("**/settings/import");
    ok(await appShown(page), "welcome: Import opens the app at Settings › Import");
    const st = await page.evaluate(() => fetch("/api/auth/status").then((r) => r.json()));
    ok(st.onboarded && st.people.length === 2 && st.signin && st.me && st.me.name === "Sam" && !!st.kit, "welcome: onboarded, two people, sign-in on with a kit, signed in as Sam");
    // The kit from the welcome screen is the household's: it gets Kim in, below, if needed
    const probe = await browser.newContext();
    const rec = await probe.request.post(empty.base + "/api/kit/recover", { data: { person_id: st.people[1].id, key: onbKit }, failOnStatusCode: false });
    ok(rec.status() === 200, "welcome: the kit shown at setup is the one the server checks");
    await probe.close();
    const cur = await page.evaluate(() => fetch("/api/currency").then((r) => r.json()));
    ok(cur.selected === "USD" && cur.position === "left", "welcome: currency and symbol position saved");
    noErrors(page, "welcome");
    // Kim, on another browser: the same password, under her own name
    const kim = await open(empty.base);
    await kim.waitForSelector("#gate .w-prof");
    await kim.click('#gate .w-prof:has-text("Kim")');
    await kim.fill("#si-in", "household-pass");
    await kim.press("#si-in", "Enter");
    ok(await appShown(kim), "welcome: Kim signs in with the household password chosen at setup");
    const kst = await kim.evaluate(() => fetch("/api/auth/status").then((r) => r.json()));
    ok(kst.me && kst.me.name === "Kim" && !(await kim.locator("#gate").isVisible()), "welcome: as Kim, with nothing more to choose");
    noErrors(kim, "welcome, Kim");
    await kim.context().close();
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
    // Forgot it: Wally 1 had no Emergency Kit, so only whoever runs the server can help
    ok((await (await fetch(v1.base + "/api/auth/status")).json()).kit === null, "upgrade: no kit yet");
    await page.click("#si-forgot");
    await page.waitForSelector(".w-sifile");
    ok((await gateText(page)).includes("There is no Emergency Kit yet") && (await page.textContent(".w-sifile code")) === "docker exec wally python3 -m api.signin_off", "upgrade: forgot says there is no kit yet, with the command for whoever runs the server");
    await shot(page, "upgrade-forgot");
    await page.click("#si-back");
    await page.waitForSelector("#si-forgot");
    ok((await gateText(page)).includes("Enter the household password"), "upgrade: back on the household password");
    // Remembered after all: the 1.x household password (tests/fixtures/v1.db)
    const household = "household";
    await page.fill("#si-in", household);
    await page.press("#si-in", "Enter");
    // First, the welcome to 2.0: what's new, and that the data came across
    await page.waitForSelector("#gate .w-wel #wel-go");
    ok(true, "upgrade: the 1.x household password signs in");
    const welcome = await gateText(page);
    ok(welcome.includes("Wally 2.0") && /\d+ transactions came across, checked one by one/.test(welcome), "upgrade: welcome to 2.0, with the transactions that came across");
    ok(await page.locator("#gate .w-welfeat li").count() === 4, "upgrade: four things that are new");
    const text = await page.evaluate(async () => (await fetch("/api/upgrade/report")).text());
    ok(text.includes("Kept, and checked one by one against the old database"), "upgrade: the downloaded report is plain text");
    await shot(page, "upgrade-welcome");
    await page.click("#wel-go");
    await page.waitForSelector("[data-name]");
    ok(await page.evaluate(() => localStorage.getItem("wally.welcomed")) === "1", "upgrade: this browser remembers the welcome was seen");
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector("[data-name]");
    ok(!(await page.locator("#gate .w-wel").count()), "upgrade: the welcome is shown once");
    ok((await gateText(page)).includes("Who uses Wally?"), "upgrade: asks who uses Wally");
    await page.fill('[data-name="0"]', "Alex");
    await page.click("#onb-add");
    await page.keyboard.type("Ana");
    await shot(page, "upgrade-people");
    await page.click("#onb-next");
    await page.waitForSelector("[data-tagfor]");
    ok((await gateText(page)).includes("Tagged with someone’s name?"), "upgrade: offers to turn tags into people");
    const ids = await page.$$eval("[data-tagfor]", (l) => l.map((s) => s.dataset.tagfor));
    const picked = await page.$$eval("[data-tagfor]", (l) => l.map((s) => s.value));
    ok(picked.join() === "alex,ana", "upgrade: the tag with each person’s name is picked (" + picked + ")");
    ok(await page.$eval(`[data-tagfor="${ids[0]}"] option[value="ana"]`, (o) => o.disabled), "upgrade: a tag picked for Ana is greyed out for Alex");
    const counts = () => page.$$eval("[id^=tagn-]", (l) => l.map((e) => (e.hidden ? "" : e.textContent)).join(" / "));
    await page.waitForFunction(() => document.getElementById("tagn-shared").textContent);
    ok((await counts()) === "1 transaction becomes Alex’s / 3 transactions become Ana’s / 1 transaction has more than one of these tags and stays shared",
      "upgrade: counted together, a transaction with both tags stays shared (" + (await counts()) + ")");
    await shot(page, "upgrade-tags");
    await page.selectOption(`[data-tagfor="${ids[0]}"]`, "");
    await page.waitForFunction(() => /4 transactions/.test(document.getElementById("gate").innerText));
    ok((await counts()) === " / 4 transactions become Ana’s / ", "upgrade: without Alex’s tag, it becomes Ana’s (" + (await counts()) + ")");
    await page.selectOption(`[data-tagfor="${ids[0]}"]`, "alex");
    await page.waitForFunction(() => document.getElementById("tagn-shared").textContent);
    ok(await page.locator("#gate .w-steps").count() === 0 && await page.locator(".w-onbfoot #onb-skip").count() === 1, "upgrade: no stepper for two short steps, and Skip sits next to Continue");
    // The "You" row is this browser now: no signing out and in again
    const mid = await page.evaluate(() => fetch("/api/auth/status").then((r) => r.json()));
    ok(mid.me && mid.me.name === "Alex", "upgrade: this browser became Alex, on the You row, without a second sign-in");
    // Back: nothing is lost, and the tags are applied only at the end
    await page.click("#onb-back");
    await page.waitForFunction(() => document.getElementById("gate").innerText.includes("Who uses Wally?"));
    ok((await page.$$eval(".w-onbppl li > span:not(.w-av):not(.w-badge)", (l) => l.map((x) => x.textContent.trim()))).join() === "Alex,Ana" && !(await page.$("#onb-back")), "upgrade: back on People, the people already added, and no Back on the first step");
    await page.click("#onb-next");
    await page.waitForSelector("[data-tagfor]");
    ok((await page.$$eval("[data-tagfor]", (l) => l.map((s) => s.value))).join() === "alex,ana", "upgrade: back on Tags, the picks are as they were left");
    await page.click("#onb-next");
    // Signed in as a person, with no kit yet: Wally makes one and asks to save it
    await page.waitForSelector("#kg-saved", { timeout: 10000 });
    ok((await gateText(page)).includes("Save the household’s Emergency Kit"), "upgrade: signed in as yourself, Wally makes the household's Emergency Kit");
    const upKit = (await page.locator(".w-kitkey").innerText()).replace(/\s+/g, "-");
    ok(checks(upKit) && await page.locator("#gate svg").count() >= 1, "upgrade: a recovery key, with its QR code");
    ok(await page.locator("#kg-dl").count() === 1 && await page.locator("#kg-copy").count() === 1, "upgrade: Download PDF and Copy");
    ok(await page.isDisabled("#kg-done"), "upgrade: Open Wally waits for the tick");
    await shot(page, "upgrade-kit");
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#kg-dl")]);
    const upPdf = readFileSync(await dl.path(), "latin1");
    ok(dl.suggestedFilename() === "wally-emergency-kit.pdf" && upPdf.startsWith("%PDF-") && upKit.split("-").every((g) => upPdf.includes(g)), "upgrade: the kit downloads as a PDF, with its key");
    await page.check("#kg-saved");
    await page.click("#kg-done");
    ok(await appShown(page), "upgrade: then the app, with no second sign-in and no password of their own to choose");
    const kst2 = await page.evaluate(() => fetch("/api/auth/status").then((r) => r.json()));
    ok(!!kst2.kit, "upgrade: the household has its kit now");
    await page.reload({ waitUntil: "networkidle" });
    ok(await appShown(page) && !(await page.locator("#kg-saved").count()), "upgrade: and isn't asked again");
    const ust = await page.evaluate(() => fetch("/api/auth/status").then((r) => r.json()));
    ok(ust.me && ust.me.name === "Alex", "upgrade: signed in as Alex");
    const usage = await page.evaluate((ids) => Promise.all(ids.map((id) => fetch("/api/people/" + id + "/usage").then((r) => r.json()))), ids);
    ok(usage[0].own === 1 && usage[1].own === 3, "upgrade: tagged transactions became theirs, the rest stay shared");
    const dinner = await page.evaluate(() => fetch("/api/transactions").then((r) => r.json()).then((l) => l.find((x) => x.name === "Dinner")));
    ok(dinner.person_id === null && dinner.tags.length === 0, "upgrade: tagged with both, it stays shared and loses the tags");
    noErrors(page, "upgrade");
    // Arabic, dark, on a phone: the sign-in screen mirrors
    await page.evaluate(() => fetch("/api/language/ar", { method: "PUT" }));
    await signOutVia(page);
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
