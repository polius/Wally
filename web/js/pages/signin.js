/* The full-screen steps before the app: sign in, first run, the upgrade from 1.x,
   choosing your own password, turning on two-step sign-in, and "who is using this browser".
   app.js decides which one comes first (nextGate) and calls mountGate; done() reloads Wally. */
import { t, tn, esc, state, GET, POST, PUT, av, pname, person, icon, loadLanguage, LANGUAGES, LANG } from "../core.js";
import { trapFocus } from "../ui.js";

let root = null;      // #gate
let status = null;    // /auth/status
let finish = null;    // done(): reloads Wally

const LAST = "wally.lastSignin";
function read(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
function write(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* fine */ } }

export function mountGate(el, kind, s, done) {
  root = el;
  status = s;
  finish = done;
  state.status = s;
  state.people = s.people || [];
  root.classList.add("w-gate");
  root.addEventListener("keydown", (ev) => { const card = root.firstElementChild; if (card) trapFocus(card, ev); });
  ({ signin: startSignin, welcome: startWelcome, people: startPeople, password: renderPassword, twostep: startTwoStep, who: renderWho }[kind] || startSignin)();
}

/* ---------- shared pieces ---------- */
function paint(html, focusSel) {
  root.innerHTML = html;
  const target = (focusSel && root.querySelector(focusSel)) || root.querySelector("[data-autofocus]") || root.querySelector("input,button");
  if (target) target.focus({ preventScroll: true });
}
function head(title, sub) { return '<div class="w-sihead"><h1 id="gate-h">' + title + "</h1>" + (sub ? "<p>" + sub + "</p>" : "") + "</div>"; }
function card(inner, cls) { return '<main class="w-signcard' + (cls ? " " + cls : "") + '" aria-labelledby="gate-h">' + inner + "</main>"; }
function bigAv(key) { return av(key, "xl"); }
function mark() { return '<span class="w-mark lg" role="img" aria-label="Wally"></span>'; }
function eye(id) { return '<button type="button" class="w-eye" data-eye="' + id + '" aria-label="' + esc(t("Show password")) + '" aria-pressed="false">' + icon("eye") + "</button>"; }
function wireEyes() {
  root.querySelectorAll("[data-eye]").forEach((b) => b.addEventListener("click", () => {
    const input = document.getElementById(b.dataset.eye), show = input.type === "password";
    input.type = show ? "text" : "password";
    b.setAttribute("aria-pressed", String(show));
    b.setAttribute("aria-label", show ? t("Hide password") : t("Show password"));
  }));
}
function busy(btn, on) { if (!btn) return; btn.disabled = on; btn.setAttribute("aria-busy", String(on)); }
/* The API answers in English; a translation, when there is one, is used */
function apiMessage(e) { return esc(t(e && e.message ? e.message : "Something went wrong.")); }
async function signOutNow() { try { await POST("/logout"); } catch (e) { /* signed out anyway */ } location.href = "/"; }
const signOutLink = () => '<button type="button" class="w-link w-silink" data-signout-gate>' + t("Sign out") + "</button>";
function wireSignOut() { const b = root.querySelector("[data-signout-gate]"); if (b) b.addEventListener("click", signOutNow); }

/* ======================= sign in ======================= */
const si = { step: "who", p: null, rec: false, err: "", wait: 0, forgotFile: "" };
let countdown = null;

function startSignin() {
  const people = state.people, last = read(LAST);
  if (!people.length) si.step = "household";           // upgraded from 1.x: the household password, nobody to pick yet
  else if (people.length === 1) { si.p = String(people[0].id); si.step = "pw"; }
  else if (last && person(last)) { si.p = last; si.step = "pw"; }
  else si.step = "who";
  renderSignin();
}
function go(step, p) {
  si.step = step; si.err = "";
  if (p !== undefined) si.p = p;
  if (step !== "code") si.rec = false;
  renderSignin();
}

function renderSignin() {
  const s = si.step, name = si.p ? esc(pname(si.p)) : "";
  if (s === "who") {
    paint(card(mark() + head(t("Who is signing in?"), t("Each person has their own password")) +
      '<div class="w-profiles" role="list">' + state.people.map((p) =>
        '<div role="listitem"><button type="button" class="w-prof" data-prof="' + p.id + '">' + bigAv(String(p.id)) + "<span>" + esc(p.name) + "</span></button></div>").join("") + "</div>" +
      '<span class="w-hint">' + t("Wally remembers the last person on this browser") + "</span>"));
    root.querySelectorAll("[data-prof]").forEach((b) => b.addEventListener("click", () => go("pw", b.dataset.prof)));
    return;
  }
  if (s === "forgot") {
    // Before anyone has been added, it is the household password that was forgotten
    paint(card(mark() + head(t("Check the server"), si.p ? t("Wally wrote a one-time password for {name} to this file on the server:", { name }) : t("Wally wrote a new household password to this file on the server:")) +
      '<div class="w-keybox w-sifile"><code>' + esc(si.forgotFile) + "</code></div>" +
      '<p class="w-sip">' + (si.p
        ? t("Sign in with it, then choose a new password. It works once, then it is removed from the file. It also turns off two-step sign-in for {name}, who can turn it back on in Settings. If you can’t reach the server, ask whoever runs it.", { name })
        : t("Sign in with it. It replaces the old household password: everyone you add next signs in with it the first time, then chooses their own. If you can’t reach the server, ask whoever runs it.")) + "</p>" +
      '<button type="button" class="w-btn primary w-submit w-wide" id="si-back" data-autofocus>' + t("Back to sign in") + "</button>"));
    root.querySelector("#si-back").addEventListener("click", () => go(si.p ? "pw" : "household"));
    return;
  }
  const code = s === "code", household = s === "household", bad = !!si.err && !si.wait;
  let top, field, links;
  if (code) {
    top = bigAv(si.p) + head(t("Two-step sign-in"), si.rec ? t("Enter one of your recovery codes") : t("Enter the 6-digit code from your authenticator app"));
    field = si.rec
      ? '<input id="si-in" class="w-sicode" placeholder="xxxx-xxxx" aria-label="' + esc(t("Recovery code")) + '" autocomplete="off" autocapitalize="off" spellcheck="false"'
      : '<input id="si-in" class="w-sicode" placeholder="123 456" aria-label="' + esc(t("6-digit code")) + '" inputmode="numeric" pattern="[0-9 ]*" autocomplete="one-time-code" maxlength="7"';
    field = '<div class="w-input' + (bad ? " err" : "") + '">' + field + ' aria-invalid="' + bad + '" aria-describedby="si-msg"></div>';
    links = '<button type="button" class="w-link w-silink" id="si-alt">' + (si.rec ? t("Use the authenticator app") : t("Use a recovery code")) + "</button>";
  } else {
    top = household ? mark() + head(t("Sign in"), t("Enter the household password")) : bigAv(si.p) + head(t("Hi, {name}", { name }), t("Enter your password"));
    field = (household ? "" : '<input type="text" class="w-sr" autocomplete="username" value="' + name + '" tabindex="-1" aria-hidden="true" readonly>') +
      '<div class="w-input' + (bad ? " err" : "") + '"><input type="password" id="si-in" placeholder="' + esc(t("Password")) + '" aria-label="' + esc(t("Password")) + '" aria-invalid="' + bad + '" aria-describedby="si-msg" autocomplete="current-password">' + eye("si-in") + "</div>";
    links = '<div class="w-silinks">' + (!household && state.people.length > 1 ? '<button type="button" class="w-link w-silink" id="si-not">' + t("Not {name}?", { name }) + "</button>" : "") +
      '<button type="button" class="w-link w-silink" id="si-forgot">' + t("Forgot password?") + "</button></div>";
  }
  const msg = si.wait ? waitText() : si.err;
  paint(card(top + '<form id="si-form" class="w-siform" novalidate>' + field +
    '<p class="w-err" id="si-msg" role="alert"' + (msg ? "" : " hidden") + ">" + msg + "</p>" +
    '<button class="w-btn primary w-submit" type="submit" id="si-go"' + (si.wait ? " disabled" : "") + ">" + t("Sign in") + "</button></form>" + links), "#si-in");
  wireEyes();
  const input = root.querySelector("#si-in");
  root.querySelector("#si-form").addEventListener("submit", (ev) => { ev.preventDefault(); submitSignin(input.value); });
  if (code) {
    root.querySelector("#si-alt").addEventListener("click", () => { si.rec = !si.rec; go("code"); });
    // The code goes as soon as the sixth digit is typed or pasted
    if (!si.rec) input.addEventListener("input", () => { if (input.value.replace(/\D/g, "").length === 6) submitSignin(input.value); });
  } else {
    const not = root.querySelector("#si-not");
    if (not) not.addEventListener("click", () => go("who", null));
    root.querySelector("#si-forgot").addEventListener("click", forgot);
  }
}
function waitText() { return tn(si.wait, "Too many tries. Wait {n} second, then try again.", "Too many tries. Wait {n} seconds, then try again."); }
function startWait(seconds) {
  clearInterval(countdown);
  si.wait = Math.max(1, Math.ceil(seconds));
  si.err = "";
  renderSignin();
  countdown = setInterval(() => {
    si.wait--;
    const msg = root.querySelector("#si-msg");
    if (si.wait > 0) { if (msg) msg.textContent = waitText(); return; }
    clearInterval(countdown);
    si.wait = 0;
    const go = root.querySelector("#si-go");
    if (go) go.disabled = false;
    if (msg) { msg.textContent = ""; msg.hidden = true; }
  }, 1000);
}

let sending = false;
async function submitSignin(value) {
  if (sending || si.wait) return;
  const code = si.step === "code";
  if (!value.trim()) { si.err = code ? t("Enter the code first.") : t("Enter your password first."); renderSignin(); return; }
  sending = true;
  busy(root.querySelector("#si-go"), true);
  try {
    if (code) {
      await POST("/login/code", si.rec ? { recovery_code: value.trim() } : { code: value.replace(/\D/g, "") }, { quiet401: true });
      return signedIn();
    }
    const r = await POST("/login", { person_id: si.p ? Number(si.p) : null, password: value }, { quiet401: true });
    if (r && r.code_needed) { si.rec = false; return go("code"); }
    signedIn();
  } catch (e) {
    loginError(e, code);
  } finally {
    sending = false;
    busy(root.querySelector("#si-go"), !!si.wait);
  }
}
function loginError(e, code) {
  const d = e.detail && typeof e.detail === "object" ? e.detail : {};
  if (e.status === 429) return startWait(d.retry_after || 30);
  if (e.status === 401 && d.tries_left !== undefined) {
    const what = !code ? t("That password isn’t right. Try again, or use Forgot password.")
      : si.rec ? t("That recovery code isn’t right, or it was already used.")
      : t("That code isn’t right. Codes change every 30 seconds, so use the newest one.");
    // The last wrong try starts the wait straight away
    if (!d.tries_left) return startWait(30);
    si.err = what + " " + tn(d.tries_left, "{n} try left.", "{n} tries left.");
    return renderSignin();
  }
  if (code && e.status === 401) { si.step = "pw"; si.err = t("That took too long. Sign in again."); return renderSignin(); }
  if (e.status === 404) { si.step = "who"; si.p = null; }
  si.err = apiMessage(e);
  renderSignin();
}
function signedIn() {
  if (si.p) write(LAST, si.p);
  clearInterval(countdown);
  finish();
}
async function forgot() {
  const btn = root.querySelector("#si-forgot");
  busy(btn, true);
  try {
    const r = await POST("/login/recover", { person_id: si.p ? Number(si.p) : null });
    si.forgotFile = r.file || "password.txt";
    go("forgot");
  } catch (e) {
    si.err = apiMessage(e);
    renderSignin();
  }
}

/* ======================= who is using this browser (sign-in off) ======================= */
function renderWho() {
  paint(card(mark() + head(t("Who is using Wally on this browser?"), t("Wally notes who adds each transaction. Sign-in is off, so it takes your word for it.")) +
    '<div class="w-profiles" role="list">' + state.people.map((p) =>
      '<div role="listitem"><button type="button" class="w-prof" data-prof="' + p.id + '">' + bigAv(String(p.id)) + "<span>" + esc(p.name) + "</span></button></div>").join("") + "</div>" +
    '<span class="w-hint">' + t("Wally remembers it on this browser. Switch at any time.") + "</span>"));
  root.querySelectorAll("[data-prof]").forEach((b) => b.addEventListener("click", () => { write("wally.person", b.dataset.prof); finish(); }));
}

/* ======================= choose your own password ======================= */
function renderPassword(err) {
  const me = status.me ? String(status.me.id) : null;
  paint(card((me ? bigAv(me) : mark()) + head(t("Choose your own password"), t("You signed in with a password someone else knows. Choose one only you know, of at least 8 characters.")) +
    '<form id="pw-form" class="w-siform" novalidate>' +
    '<input type="text" class="w-sr" autocomplete="username" value="' + esc(me ? pname(me) : "") + '" tabindex="-1" aria-hidden="true" readonly>' +
    '<div class="w-input' + (err ? " err" : "") + '"><input type="password" id="pw-new" placeholder="' + esc(t("New password")) + '" aria-label="' + esc(t("New password")) + '" autocomplete="new-password" aria-describedby="pw-msg">' + eye("pw-new") + "</div>" +
    '<div class="w-input' + (err ? " err" : "") + '"><input type="password" id="pw-again" placeholder="' + esc(t("The same again")) + '" aria-label="' + esc(t("The same again")) + '" autocomplete="new-password" aria-describedby="pw-msg">' + eye("pw-again") + "</div>" +
    '<p class="w-err" id="pw-msg" role="alert"' + (err ? "" : " hidden") + ">" + (err || "") + "</p>" +
    '<button class="w-btn primary w-submit" type="submit" id="pw-go">' + t("Save password") + "</button></form>" + signOutLink()), "#pw-new");
  wireEyes();
  wireSignOut();
  root.querySelector("#pw-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const a = root.querySelector("#pw-new").value, b = root.querySelector("#pw-again").value;
    if (a.length < 8) return renderPassword(t("Use at least 8 characters."));
    if (a !== b) return renderPassword(t("The two passwords are different."));
    const btn = root.querySelector("#pw-go");
    busy(btn, true);
    try { await PUT("/me/password", { new: a }); finish(); }
    catch (e) { renderPassword(apiMessage(e)); }
  });
}

/* ======================= two-step sign-in, required by the household ======================= */
const ts = { secret: "", uri: "", qr: "", codes: null, err: "" };
async function startTwoStep() {
  paint(card(mark() + head(t("Turn on two-step sign-in"), t("Getting a code ready…"))));
  try {
    const [r, qr] = await Promise.all([POST("/me/two-step/setup"), loadQr()]);
    ts.secret = r.secret; ts.uri = r.uri;
    if (qr) {
      const q = qr(0, "M");
      q.addData(r.uri);
      q.make();
      ts.qr = q.createSvgTag({ cellSize: 4, margin: 3, scalable: true, alt: t("QR code for your authenticator app") });
    }
    renderTwoStep();
  } catch (e) {
    paint(card(mark() + head(t("Turn on two-step sign-in"), apiMessage(e)) + '<button type="button" class="w-btn primary w-submit w-wide" id="ts-retry">' + t("Try again") + "</button>" + signOutLink()));
    root.querySelector("#ts-retry").addEventListener("click", startTwoStep);
    wireSignOut();
  }
}
function loadQr() {
  return new Promise((resolve) => {
    if (window.qrcode) return resolve(window.qrcode);
    const s = document.createElement("script");
    s.src = "/js/vendors/qrcode.js";
    s.onload = () => resolve(window.qrcode || null);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
}
function groupKey(secret) { return secret.replace(/(.{4})/g, "$1 ").trim(); }
function renderTwoStep() {
  if (ts.codes) return renderCodes();
  const bad = !!ts.err;
  paint(card(mark() + head(t("Turn on two-step sign-in"), t("This household asks everyone for a code from an authenticator app when they sign in. Any authenticator app works.")) +
    '<ol class="w-tsteps">' +
    "<li><b>" + (ts.qr ? t("Scan this with your authenticator app") : t("Add Wally to your authenticator app with this key")) + "</b>" +
      (ts.qr ? '<div class="w-qr">' + ts.qr + "</div>" : "") +
      (ts.qr ? '<span class="w-hint">' + t("Can’t scan it? Type this key instead:") + "</span>" : "") +
      '<div class="w-keybox"><code id="ts-key">' + esc(groupKey(ts.secret)) + '</code><button type="button" class="w-btn ghost" id="ts-copy">' + t("Copy") + "</button></div></li>" +
    "<li><b>" + t("Enter the 6-digit code it shows") + "</b>" +
      '<form id="ts-form" class="w-siform" novalidate><div class="w-input' + (bad ? " err" : "") + '"><input id="ts-in" class="w-sicode" placeholder="123 456" aria-label="' + esc(t("6-digit code")) + '" inputmode="numeric" autocomplete="one-time-code" maxlength="7" aria-invalid="' + bad + '" aria-describedby="ts-msg"></div>' +
      '<p class="w-err" id="ts-msg" role="alert"' + (bad ? "" : " hidden") + ">" + (ts.err || "") + "</p>" +
      '<button class="w-btn primary w-submit" type="submit" id="ts-go">' + t("Turn on") + "</button></form></li></ol>" + signOutLink(), "wide"), "#ts-in");
  wireSignOut();
  root.querySelector("#ts-copy").addEventListener("click", (ev) => copy(ts.secret, ev.currentTarget));
  const input = root.querySelector("#ts-in");
  input.addEventListener("input", () => { if (input.value.replace(/\D/g, "").length === 6) confirmTwoStep(input.value); });
  root.querySelector("#ts-form").addEventListener("submit", (ev) => { ev.preventDefault(); confirmTwoStep(input.value); });
}
let confirming = false;
async function confirmTwoStep(value) {
  const code = value.replace(/\D/g, "");
  if (confirming) return;
  if (code.length !== 6) { ts.err = t("Enter the 6 digits your app shows."); return renderTwoStep(); }
  confirming = true;
  busy(root.querySelector("#ts-go"), true);
  try { ts.codes = (await POST("/me/two-step/confirm", { code })).recovery_codes; ts.err = ""; }
  catch (e) { ts.err = apiMessage(e); }
  finally { confirming = false; }
  renderTwoStep();
}
function renderCodes() {
  const text = ts.codes.join("\n");
  paint(card(mark() + head(t("Save your recovery codes"), t("If you lose your phone, each of these signs you in once. Wally keeps only a scrambled copy, so it can’t show them again.")) +
    '<ul class="w-codes" aria-label="' + esc(t("Recovery codes")) + '">' + ts.codes.map((c) => "<li><code>" + esc(c) + "</code></li>").join("") + "</ul>" +
    '<div class="w-silinks"><button type="button" class="w-btn ghost" id="rc-copy">' + icon("copy") + t("Copy") + '</button><button type="button" class="w-btn ghost" id="rc-dl">' + icon("download") + t("Download") + "</button></div>" +
    '<button type="button" class="w-btn primary w-submit w-wide" id="rc-done">' + t("I saved them. Open Wally") + "</button>", "wide"), "#rc-copy");
  root.querySelector("#rc-copy").addEventListener("click", (ev) => copy(text, ev.currentTarget));
  root.querySelector("#rc-dl").addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([t("Wally recovery codes") + "\n\n" + text + "\n"], { type: "text/plain" }));
    a.download = "wally-recovery-codes.txt";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  root.querySelector("#rc-done").addEventListener("click", finish);
}
async function copy(text, btn) {
  try { await navigator.clipboard.writeText(text); } catch (e) { return; }
  const before = btn.innerHTML;
  btn.textContent = t("Copied");
  setTimeout(() => { if (btn.isConnected) btn.innerHTML = before; }, 1600);
}

/* ======================= first run, and the upgrade from 1.x ======================= */
/* Both use the same three-step card: a header with the steps, a body, and Back / Continue. */
function onbFrame(steps, at, body, foot, skip) {
  return '<main class="w-onb" aria-labelledby="gate-h"><div class="w-onbh"><span class="w-mark" role="img" aria-label="Wally"></span><ol class="w-steps">' +
    steps.map((x, i) => '<li class="' + (i === at ? "on" : i < at ? "done" : "") + '"' + (i === at ? ' aria-current="step"' : "") + "><span>" + (i < at ? icon("check") : i + 1) + '</span><em>' + x + "</em></li>").join("") + "</ol>" +
    (skip ? '<button type="button" class="w-link w-onbskip" id="onb-skip">' + t("Skip") + "</button>" : "") + "</div>" +
    '<div class="w-onbb">' + body + '<p class="w-err" id="onb-err" role="alert" hidden></p></div><div class="w-onbfoot">' + foot + "</div></main>";
}
function onbError(msg) { const e = root.querySelector("#onb-err"); if (e) { e.innerHTML = msg || ""; e.hidden = !msg; } }
const backBtn = () => '<button type="button" class="w-btn ghost" id="onb-back">' + t("Back") + "</button>";
const nextBtn = (label) => '<button type="button" class="w-btn primary" id="onb-next">' + label + "</button>";

/* The people rows, shared by first run and the upgrade */
function peopleRows(names, created) {
  if (created.length) {
    return '<ul class="w-onbppl">' + created.map((p) => "<li>" + av(String(p.id)) + "<span>" + esc(p.name) + "</span></li>").join("") + "</ul>" +
      '<p class="w-hint">' + t("Names can be changed later in Settings › People.") + "</p>";
  }
  return '<div class="w-onbf" id="onb-names">' + names.map((n, i) =>
    '<label class="w-onbrow"><span>' + (i === 0 ? t("You") : t("Person {n}", { n: i + 1 })) + '</span><span class="w-onbname"><input class="w-mini" data-name="' + i + '" value="' + esc(n) + '" maxlength="40" autocomplete="' + (i === 0 ? "name" : "off") + '" aria-label="' + esc(i === 0 ? t("Your name") : t("Name of person {n}", { n: i + 1 })) + '">' +
    (i > 0 ? '<button type="button" class="w-x" data-drop="' + i + '" aria-label="' + esc(t("Remove person {n}", { n: i + 1 })) + '">' + icon("x") + "</button>" : "") + "</span></label>").join("") +
    '<div class="w-onbrow"><span></span><button type="button" class="w-link" id="onb-add">' + icon("plus") + t("Add someone") + "</button></div></div>";
}
function readNames(names) { root.querySelectorAll("[data-name]").forEach((i) => { names[+i.dataset.name] = i.value; }); }
function wireNames(names, rerender) {
  const add = root.querySelector("#onb-add");
  if (add) add.addEventListener("click", () => { readNames(names); names.push(""); rerender(); const list = root.querySelectorAll("[data-name]"); list[list.length - 1].focus(); });
  root.querySelectorAll("[data-drop]").forEach((b) => b.addEventListener("click", () => { readNames(names); names.splice(+b.dataset.drop, 1); rerender(); }));
  root.querySelectorAll("[data-name]").forEach((i) => i.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); root.querySelector("#onb-next").click(); } }));
}
/* Adds everyone typed; returns the people created, or null after showing why not */
async function createPeople(names) {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (!clean.length) { onbError(t("Add your own name first.")); root.querySelector("[data-name]").focus(); return null; }
  const seen = new Set();
  for (const n of clean) {
    const k = n.toLocaleLowerCase(LANG);
    if (seen.has(k)) { onbError(t("Two people are called {name}. Give each a different name.", { name: esc(n) })); return null; }
    seen.add(k);
  }
  const out = [];
  for (const name of clean) out.push(await POST("/people", { name }));
  state.people = out;
  return out;
}

/* ---------- first run: Basics, People, Your data ---------- */
const onb = { step: 0, names: [""], people: [], pw: false, data: "add", currency: null };

async function startWelcome() {
  try { onb.currency = await GET("/currency"); } catch (e) { onb.currency = null; }
  renderWelcome();
}
function renderWelcome() {
  const steps = [t("Basics"), t("People"), t("Your data")], s = onb.step;
  let body, foot;
  if (s === 0) {
    const c = onb.currency;
    const sample = new Intl.NumberFormat(LANG, { minimumFractionDigits: 2 }).format(12);
    const sel = c && c.currencies.find((x) => x.name === c.selected), sym = sel ? sel.symbol : "€";
    body = '<h1 id="gate-h">' + t("Welcome to Wally") + '</h1><p class="w-onbp">' + t("Wally keeps track of what your household spends and earns. Your data stays on this server.") + "</p>" +
      '<div class="w-onbf">' +
      '<label class="w-onbrow"><span>' + t("Language") + '</span><select class="w-mini" id="onb-lang">' + LANGUAGES.map(([k, n]) => '<option value="' + k + '"' + (k === LANG ? " selected" : "") + ">" + esc(n) + "</option>").join("") + "</select></label>" +
      (c ? '<label class="w-onbrow"><span>' + t("Currency") + '</span><select class="w-mini" id="onb-cur">' + c.currencies.map((x) => '<option value="' + esc(x.name) + '"' + (x.name === c.selected ? " selected" : "") + ">" + esc(x.name) + " · " + esc(x.symbol) + "</option>").join("") + "</select></label>" +
        '<div class="w-onbrow"><span id="onb-pos-l">' + t("Symbol") + '</span><div class="w-seg sm" id="onb-pos" role="group" aria-labelledby="onb-pos-l">' +
        [["left", sym + sample], ["right", sample + " " + sym]].map(([v, l]) => '<button type="button" data-v="' + v + '" aria-pressed="' + (c.position === v) + '">' + esc(l) + "</button>").join("") + "</div></div>" : "") +
      "</div>";
    foot = "<span></span>" + nextBtn(t("Continue"));
  } else if (s === 1) {
    body = '<h1 id="gate-h">' + t("Who shares this household?") + '</h1><p class="w-onbp">' + t("Each person gets their own view. Costs you share are split between you.") + "</p>" +
      peopleRows(onb.names, onb.people) +
      (onb.people.length ? "" : '<div class="w-onbf w-onbpw"><div class="w-onbrow"><span id="onb-pw-l">' + t("Password") + '</span><span class="w-inline w-nowrap"><button type="button" class="w-switch" role="switch" id="onb-pw" aria-checked="' + onb.pw + '" aria-labelledby="onb-pw-l"></button>' +
        '<input class="w-mini" type="password" id="onb-pwd" placeholder="' + esc(t("Choose a password")) + '" aria-label="' + esc(t("Password")) + '" autocomplete="new-password"' + (onb.pw ? "" : " hidden") + "></span></div>" +
        '<p class="w-hint">' + (onb.pw ? t("Wally asks for it when it opens. Everyone uses it the first time, then chooses their own.") : t("Off: anyone who can reach this server can open Wally. Turn it on in Settings › Sign-in at any time.")) + "</p></div>") +
      '<p class="w-hint">' + t("Living alone? Keep just yourself. The person switch then stays hidden.") + "</p>";
    foot = backBtn() + nextBtn(t("Continue"));
  } else {
    body = '<h1 id="gate-h">' + t("Bring your data") + '</h1><p class="w-onbp">' + t("You can always import more later from Settings.") + "</p>" +
      '<div class="w-choices two" role="radiogroup" aria-labelledby="gate-h">' +
      [["import", "io", t("Import a CSV"), t("From Wally 1, or from your bank. You map the columns before anything is saved.")],
       ["add", "plus", t("Start empty"), t("Add your first expense right away.")]].map(([k, ic, b, sm]) =>
        '<button type="button" class="w-choice" role="radio" data-onb-data="' + k + '" aria-checked="' + (onb.data === k) + '" aria-pressed="' + (onb.data === k) + '"><span class="w-ico">' + icon(ic) + "</span><b>" + b + "</b><small>" + sm + "</small></button>").join("") + "</div>";
    foot = backBtn() + nextBtn(onb.data === "import" ? t("Choose a file") : t("Open Wally"));
  }
  paint(onbFrame(steps, s, body, foot, s !== 1), s === 1 && !onb.people.length ? "[data-name]" : "#onb-next");
  wireWelcome();
}
function wireWelcome() {
  const next = root.querySelector("#onb-next"), back = root.querySelector("#onb-back"), skip = root.querySelector("#onb-skip");
  if (back) back.addEventListener("click", () => { if (onb.step === 1) readNames(onb.names); onb.step--; renderWelcome(); });
  if (skip) skip.addEventListener("click", () => (onb.step === 0 ? (onb.step = 1, renderWelcome()) : openWally("skip")));
  next.addEventListener("click", async () => {
    busy(next, true);
    try {
      if (onb.step === 0) await saveBasics();
      else if (onb.step === 1) { if (!(await savePeople())) return busy(next, false); }
      else return openWally(onb.data);
      onb.step++;
      renderWelcome();
    } catch (e) { onbError(apiMessage(e)); busy(next, false); }
  });
  const lang = root.querySelector("#onb-lang");
  if (lang) lang.addEventListener("change", async () => {
    try { await PUT("/language/" + lang.value); } catch (e) { return onbError(apiMessage(e)); }
    await loadLanguage(lang.value);
    renderWelcome();
    root.querySelector("#onb-lang").focus();
  });
  const cur = root.querySelector("#onb-cur");
  if (cur) cur.addEventListener("change", () => { onb.currency.selected = cur.value; renderWelcome(); root.querySelector("#onb-cur").focus(); });
  root.querySelectorAll("#onb-pos button").forEach((b) => b.addEventListener("click", () => {
    onb.currency.position = b.dataset.v;
    root.querySelectorAll("#onb-pos button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  }));
  const pw = root.querySelector("#onb-pw");
  if (pw) pw.addEventListener("click", () => { readNames(onb.names); onb.pw = !onb.pw; renderWelcome(); root.querySelector(onb.pw ? "#onb-pwd" : "#onb-pw").focus(); });
  wireNames(onb.names, () => renderWelcome());
  root.querySelectorAll("[data-onb-data]").forEach((b) => b.addEventListener("click", () => { onb.data = b.dataset.onbData; renderWelcome(); root.querySelector('[data-onb-data="' + onb.data + '"]').focus(); }));
}
async function saveBasics() {
  const c = onb.currency;
  if (!c) return;
  await PUT("/currency/" + encodeURIComponent(c.selected));
  await PUT("/currency/position/" + c.position);
}
async function savePeople() {
  if (onb.people.length) return true;
  readNames(onb.names);
  const password = onb.pw ? root.querySelector("#onb-pwd").value : "";
  if (onb.pw && password.length < 8) { onbError(t("Use at least 8 characters.")); root.querySelector("#onb-pwd").focus(); return false; }
  const people = await createPeople(onb.names);
  if (!people) return false;
  onb.people = people;
  // The first person is whoever is setting Wally up, on this browser
  write("wally.person", String(people[0].id));
  write(LAST, String(people[0].id));
  if (password) {
    const passwords = Object.fromEntries(people.map((p) => [String(p.id), password]));
    await PUT("/signin", { enabled: true, passwords });
    state.status.signin = true;
  }
  return true;
}
async function openWally(choice) {
  try { await PUT("/config", { onboarded: true }); } catch (e) { return onbError(apiMessage(e)); }
  location.href = choice === "import" ? "/settings/import" : choice === "add" ? "/?add=1" : "/";
}

/* ---------- after the upgrade from 1.x: there is data, but no people yet ---------- */
const up = { step: 0, names: [""], people: [], tags: [], picks: {}, preview: null, remove: true };

function startPeople() { renderUpgrade(); }
function upgradeSteps() {
  const steps = [t("People")];
  if (up.tags.length || !up.people.length) steps.push(t("Tags"));
  if (status.signin) steps.push(t("Sign in"));
  return steps;
}
function renderUpgrade() {
  const steps = upgradeSteps(), s = up.step;
  const kind = s === 0 ? "people" : steps[s] === t("Tags") ? "tags" : "signin";
  let body, foot;
  if (kind === "people") {
    body = '<h1 id="gate-h">' + t("Who uses Wally?") + '</h1><p class="w-onbp">' + t("Wally now keeps track of who spent what. Add the people in your household. Everything already in Wally stays shared between them.") + "</p>" +
      peopleRows(up.names, up.people);
    foot = "<span></span>" + nextBtn(t("Continue"));
  } else if (kind === "tags") {
    body = '<h1 id="gate-h">' + t("Turn a tag into a person") + '</h1><p class="w-onbp">' + t("If you tagged transactions with someone’s name, they can become theirs. Everything else stays shared.") + "</p>" +
      '<div class="w-onbf">' + up.people.map((p) => '<label class="w-onbrow"><span class="w-onbwho">' + av(String(p.id)) + esc(p.name) + '</span><span class="w-onbtag"><select class="w-mini" data-tagfor="' + p.id + '"><option value="">' + t("No tag") + "</option>" +
        up.tags.map((g) => '<option value="' + esc(g) + '"' + (up.picks[p.id] === g ? " selected" : "") + ">#" + esc(g) + "</option>").join("") + '</select><small class="w-hint" id="tagn-' + p.id + '" aria-live="polite">' + tagCountText(p) + "</small></span></label>").join("") +
      '<p class="w-hint" id="tagn-shared" aria-live="polite"' + (sharedText() ? "" : " hidden") + ">" + sharedText() + "</p>" +
      '<label class="w-sichk"><input type="checkbox" id="up-rm"' + (up.remove ? " checked" : "") + ">" + t("Remove the tag from those transactions") + "</label></div>";
    foot = backBtn() + nextBtn(t("Continue"));
  } else {
    body = '<h1 id="gate-h">' + t("Now sign in as yourself") + '</h1><p class="w-onbp">' + t("Each person signs in with the household password the first time, then chooses their own.") + "</p>" +
      '<ul class="w-onbppl">' + up.people.map((p) => "<li>" + av(String(p.id)) + "<span>" + esc(p.name) + "</span></li>").join("") + "</ul>";
    foot = backBtn() + nextBtn(t("Sign in"));
  }
  paint(onbFrame(steps, s, body, foot, kind === "tags"), kind === "people" && !up.people.length ? "[data-name]" : kind === "tags" ? "select" : "#onb-next");
  wireNames(up.names, () => renderUpgrade());
  root.querySelectorAll("[data-tagfor]").forEach((sel) => sel.addEventListener("change", () => {
    if (sel.value) up.picks[sel.dataset.tagfor] = sel.value; else delete up.picks[sel.dataset.tagfor];
    markTaken();
    previewTags();
  }));
  if (kind === "tags") { markTaken(); if (!up.preview) previewTags(); }
  const rm = root.querySelector("#up-rm");
  if (rm) rm.addEventListener("change", () => { up.remove = rm.checked; });
  const skip = root.querySelector("#onb-skip"), back = root.querySelector("#onb-back");
  if (skip) skip.addEventListener("click", () => { up.picks = {}; up.preview = null; upgradeNext(); });
  // Back keeps everything as it was left: the people are already added, the tags are applied only at the end
  if (back) back.addEventListener("click", () => { up.step--; renderUpgrade(); });
  const next = root.querySelector("#onb-next");
  next.addEventListener("click", async () => {
    busy(next, true);
    try {
      if (kind === "people") {
        if (!up.people.length) {
          readNames(up.names);
          const people = await createPeople(up.names);
          if (!people) return busy(next, false);
          up.people = people;
          try { up.tags = await GET("/tags"); } catch (e) { up.tags = []; }
          // A tag with someone's name is most likely theirs
          for (const p of people) {
            const tag = up.tags.find((g) => g.toLocaleLowerCase() === p.name.trim().toLocaleLowerCase());
            if (tag) up.picks[p.id] = tag;
          }
        }
      } else if (kind === "tags") {
        if (s === steps.length - 1) await applyTags();
      } else {
        await applyTags();
        try { await POST("/logout"); } catch (e) { /* signed out anyway */ }
        return finish();
      }
      upgradeNext();
    } catch (e) { onbError(apiMessage(e)); busy(next, false); }
  });
}
async function applyTags() {
  const tags = pickedTags();
  if (Object.keys(tags).length) await POST("/people/from-tags", { tags, remove_tag: up.remove });
  up.picks = {};
}
function upgradeNext() {
  up.step++;
  if (up.step >= upgradeSteps().length) return finish();
  renderUpgrade();
}
function pickedTags() {
  const tags = {};
  for (const p of up.people) if (up.picks[p.id]) tags[up.picks[p.id]] = p.id;
  return tags;
}
// A tag goes to one person: it is greyed out for the others
function markTaken() {
  root.querySelectorAll("[data-tagfor]").forEach((sel) => sel.querySelectorAll("option").forEach((o) => {
    o.disabled = !!o.value && Object.entries(up.picks).some(([id, g]) => g === o.value && id !== sel.dataset.tagfor);
  }));
}
function tagCountText(p) {
  if (!up.picks[p.id]) return "";
  if (!up.preview) return t("Counting…");
  return tn(up.preview.counts[p.id] || 0, "{n} transaction becomes {name}’s", "{n} transactions become {name}’s", { name: esc(p.name) });
}
function sharedText() {
  return up.preview && up.preview.shared ? tn(up.preview.shared, "{n} transaction has more than one of these tags and stays shared", "{n} transactions have more than one of these tags and stay shared") : "";
}
// Counted together, as they will be converted: a transaction with two people's tags stays shared
let previewSeq = 0;
async function previewTags() {
  const seq = ++previewSeq, tags = pickedTags();
  up.preview = null;
  showCounts();
  if (!Object.keys(tags).length) return;
  try {
    const r = await POST("/people/from-tags/preview", { tags, remove_tag: up.remove });
    if (seq === previewSeq) { up.preview = r; showCounts(); }
  } catch (e) { if (seq === previewSeq) onbError(apiMessage(e)); }
}
function showCounts() {
  for (const p of up.people) { const out = root.querySelector("#tagn-" + p.id); if (out) out.innerHTML = tagCountText(p); }
  const shared = root.querySelector("#tagn-shared");
  if (shared) { shared.textContent = sharedText(); shared.hidden = !shared.textContent; }
}

