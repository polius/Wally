/* The full-screen steps before the app: sign in, first run, the upgrade from 1.x, saving the
   household's Emergency Kit, getting back in with it, unlocking an encrypted household, and
   "who is using this browser".
   app.js decides which one comes first (nextGate) and calls mountGate; done() reloads Wally. */
import * as core from "../core.js";
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
  ({ signin: startSignin, welcome: startWelcome, people: startPeople, kit: startKit, who: renderWho,
     unlock: () => startVault("unlock", s.me && String(s.me.id)) }[kind] || startSignin)();
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
async function signOutNow() {
  try { if (read("wally.vault") === "1") await (await vs()).forget(); } catch (e) { /* signing out anyway */ }
  try { await POST("/logout"); } catch (e) { /* signed out anyway */ }
  location.href = "/";
}
const signOutLink = () => '<button type="button" class="w-link w-silink" data-signout-gate>' + t("Sign out") + "</button>";
function wireSignOut() { const b = root.querySelector("[data-signout-gate]"); if (b) b.addEventListener("click", signOutNow); }

/* ======================= sign in ======================= */
const si = { step: "who", p: null, rec: false, err: "", wait: 0 };
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
    paint(card(mark() + head(t("Who is signing in?"), t("Everyone uses the household password")) +
      '<div class="w-profiles" role="list">' + state.people.map((p) =>
        '<div role="listitem"><button type="button" class="w-prof" data-prof="' + p.id + '">' + bigAv(String(p.id)) + "<span>" + esc(p.name) + "</span></button></div>").join("") + "</div>" +
      '<span class="w-hint">' + t("Wally remembers the last person on this browser") + "</span>"));
    root.querySelectorAll("[data-prof]").forEach((b) => b.addEventListener("click", () => go("pw", b.dataset.prof)));
    return;
  }
  if (s === "nokit") {
    // Upgraded from 1.x and nobody has signed in since: there is no Emergency Kit yet
    paint(card(mark() + head(t("There is no Emergency Kit yet"), t("Wally 1 had none, so only whoever runs the server can help. They can turn sign-in off with this command, then you turn it on again with a new password:")) +
      '<div class="w-keybox w-sifile"><code translate="no">docker exec wally python3 -m api.signin_off</code></div>' +
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
    links = '<div class="w-silinks"><button type="button" class="w-link w-silink" id="si-alt">' + (si.rec ? t("Use the authenticator app") : t("Use a recovery code")) + "</button>" +
      '<button type="button" class="w-link w-silink" id="si-nophone">' + t("No phone or codes?") + "</button></div>";
  } else {
    top = household ? mark() + head(t("Sign in"), t("Enter the household password")) : bigAv(si.p) + head(t("Hi, {name}", { name }), t("Enter the household password"));
    field = (household ? "" : '<input type="text" class="w-sr" autocomplete="username" value="' + name + '" tabindex="-1" aria-hidden="true" readonly>') +
      '<div class="w-input' + (bad ? " err" : "") + '"><input type="password" id="si-in" placeholder="' + esc(t("Password")) + '" aria-label="' + esc(t("Password")) + '" aria-invalid="' + bad + '" aria-describedby="si-msg" autocomplete="current-password">' + eye("si-in") + "</div>";
    links = '<div class="w-silinks">' + (!household && state.people.length > 1 ? '<button type="button" class="w-link w-silink" id="si-not">' + t("Not {name}?", { name }) + "</button>" : "") +
      '<button type="button" class="w-link w-silink" id="si-forgot">' + t("Forgot password?") + "</button></div>";
  }
  const msg = si.wait ? waitText() : si.err;
  // Said where the password is typed, so everyone knows who can read their data
  const sealed = !code && status.vault && status.vault.on ? '<p class="w-hint w-sienc">' + icon("lock") + t("End-to-end encrypted: whoever runs this server can’t read your data.") + "</p>" : "";
  paint(card(top + '<form id="si-form" class="w-siform" novalidate>' + field +
    '<p class="w-err" id="si-msg" role="alert"' + (msg ? "" : " hidden") + ">" + msg + "</p>" +
    '<button class="w-btn primary w-submit" type="submit" id="si-go"' + (si.wait ? " disabled" : "") + ">" + t("Sign in") + "</button></form>" + links + sealed), "#si-in");
  wireEyes();
  const input = root.querySelector("#si-in");
  root.querySelector("#si-form").addEventListener("submit", (ev) => { ev.preventDefault(); submitSignin(input.value); });
  if (code) {
    root.querySelector("#si-alt").addEventListener("click", () => { si.rec = !si.rec; go("code"); });
    // Encrypted: the Emergency Kit stands in for two-step. Otherwise a one-time password from the server turns it off.
    root.querySelector("#si-nophone").addEventListener("click", forgot);
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
      return await signedIn();
    }
    const body = { person_id: si.p ? Number(si.p) : null, password: value };
    si.unlock = null;
    // With a salt the password is never sent: the browser makes a login key from it
    const kdf = await GET("/vault/kdf");
    if (kdf.salt) {
      const k = await (await vs()).crypto.fromPassword(value, kdf.salt);
      body.password = k.login;
      si.unlock = k.unlock;
    }
    const r = await POST("/login", body, { quiet401: true });
    if (r && r.code_needed) { si.rec = false; return go("code"); }
    await signedIn();
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
async function signedIn() {
  if (si.p) write(LAST, si.p);
  clearInterval(countdown);
  if (status.vault && status.vault.on && si.unlock) {
    // The same password opens the household key on this browser: no second step
    try { await (await vs()).unlockWith(si.unlock, si.p); }
    catch (e) { si.unlock = null; return finish(); }
    si.unlock = null;
    return finish(true);
  }
  finish();
}
/* Forgot the password, or no two-step code at hand: the household's Emergency Kit */
function forgot() {
  if (!status.kit || !si.p) return go("nokit");
  startVault("recover", si.p);
}

/* ======================= who is using this browser (sign-in off) ======================= */
/* A profile picker: big faces, one tap. Arrows move between them; the choice is remembered here. */
function renderWho() {
  const people = state.people;
  paint('<main class="w-who" aria-labelledby="gate-h" tabindex="-1">' +
    '<div class="w-whohead"><h1 id="gate-h">' + t("Who’s using Wally?") + "</h1><p>" + t("Wally remembers you on this browser and notes who adds each transaction.") + "</p></div>" +
    '<ul class="w-wholist' + (people.length > 4 ? " many" : "") + '">' + people.map((p, i) =>
      '<li style="--i:' + i + '"><button type="button" class="w-whop" data-prof="' + p.id + '">' + av(String(p.id), "w-whoav") + '<span class="w-whon">' + esc(p.name) + "</span></button></li>").join("") + "</ul>" +
    '<p class="w-whofoot">' + t("No password needed while sign-in is off.") + "</p></main>", ".w-who");
  const box = root.querySelector(".w-who"), btns = [...box.querySelectorAll("[data-prof]")];
  btns.forEach((b) => b.addEventListener("click", () => pick(b)));
  box.addEventListener("keydown", (ev) => {
    const i = btns.indexOf(document.activeElement), rtl = document.documentElement.dir === "rtl";
    const step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1, ArrowDown: 1, ArrowUp: -1 }[ev.key];
    let to = null;
    if (step) to = i < 0 ? (step > 0 ? 0 : btns.length - 1) : (i + step + btns.length) % btns.length;
    else if (ev.key === "Home") to = 0;
    else if (ev.key === "End") to = btns.length - 1;
    if (to === null) return;
    ev.preventDefault();
    btns[to].focus();
  });
  function pick(b) {
    if (box.classList.contains("picked")) return;
    write("wally.person", b.dataset.prof);
    b.classList.add("on");
    box.classList.add("picked");
    // A moment for the chosen face to come forward, unless motion is turned down
    setTimeout(finish, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 380);
  }
}

/* ======================= saving the household's Emergency Kit ======================= */
/* After the upgrade from 1.x, or turning encryption off: the household has no kit yet. Whoever
   signs in next makes one and saves it. */
const kg = { key: "", qr: "", saved: false, err: "" };
async function startKit() {
  paint(card(mark() + head(t("Save the household’s Emergency Kit"), t("Getting it ready…"))));
  try {
    kg.key = (await POST("/kit", {}, { quiet401: true })).key;
    kg.qr = await (await import("../vault/kit.js")).qrSvg(kg.key);
  } catch (e) {
    // Someone else in the household saved it a moment ago: nothing to do here
    if (e.status === 409) return finish();
    paint(card(mark() + head(t("Save the household’s Emergency Kit"), apiMessage(e)) + '<button type="button" class="w-btn primary w-submit w-wide" id="kg-retry">' + t("Try again") + "</button>" + signOutLink()));
    root.querySelector("#kg-retry").addEventListener("click", startKit);
    wireSignOut();
    return;
  }
  renderKit();
}
function renderKit() {
  paint(card(mark() + head(t("Save the household’s Emergency Kit"), t("If you forget the password or can’t get a two-step code, this recovery key gets you back in. Wally keeps no copy it can read, so it can’t show it again.")) +
    '<div class="w-kit">' + kg.qr + keyGroups(kg.key) + "</div>" +
    '<div class="w-silinks"><button type="button" class="w-btn ghost" id="kg-print">' + icon("file") + t("Print or save as PDF") + '</button><button type="button" class="w-btn ghost" id="kg-dl">' + icon("download") + t("Download") + '</button><button type="button" class="w-btn ghost" id="kg-copy">' + icon("copy") + t("Copy") + "</button></div>" +
    '<label class="w-sichk"><input type="checkbox" id="kg-saved"' + (kg.saved ? " checked" : "") + ">" + t("I saved it somewhere safe") + "</label>" +
    '<button type="button" class="w-btn primary w-submit w-wide" id="kg-done"' + (kg.saved ? "" : " disabled") + ">" + t("Open Wally") + "</button>", "wide"), "#kg-print");
  root.querySelector("#kg-print").addEventListener("click", async () => (await import("../vault/kit.js")).printKit(kg.key));
  root.querySelector("#kg-dl").addEventListener("click", () => downloadKit(kg.key));
  root.querySelector("#kg-copy").addEventListener("click", (ev) => copy(kg.key, ev.currentTarget));
  root.querySelector("#kg-saved").addEventListener("change", (ev) => { kg.saved = ev.target.checked; root.querySelector("#kg-done").disabled = !kg.saved; });
  root.querySelector("#kg-done").addEventListener("click", () => finish());
}
async function downloadKit(key) {
  const kit = await import("../vault/kit.js");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([kit.kitText(key)], { type: "text/plain" }));
  a.download = "wally-emergency-kit.txt";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
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

/* ---------- first run: Basics, People, Privacy, Your data ---------- */
/* Privacy asks who runs the server once sign-in is on: when it's someone else, Wally is encrypted
   now, before there is anything to encrypt. With WALLY_ENCRYPTION=required it isn't a question. */
const onb = { step: 0, names: [""], people: [], pw: false, data: "add", currency: null, who: "", secret: "", plainKit: "", kit: "", qr: "", saved: false, sealed: false };
const mustEncrypt = () => !!(status.vault && status.vault.required);
const canEncrypt = () => !!(window.crypto && crypto.subtle && window.isSecureContext !== false);
function onbSteps() { return ["basics", "people", ...(onb.pw || mustEncrypt() ? ["privacy"] : []), "data"]; }

async function startWelcome() {
  if (mustEncrypt()) onb.pw = true;
  try { onb.currency = await GET("/currency"); } catch (e) { onb.currency = null; }
  renderWelcome();
}
function renderWelcome() {
  const keys = onbSteps(), k = keys[onb.step];
  const labels = { basics: t("Basics"), people: t("People"), privacy: t("Privacy"), data: t("Your data") };
  let body, foot;
  if (k === "basics") {
    const c = onb.currency;
    const sample = new Intl.NumberFormat(LANG, { minimumFractionDigits: 2 }).format(12);
    const sel = c && c.currencies.find((x) => x.name === c.selected), sym = sel ? sel.symbol : "€";
    body = '<h1 id="gate-h">' + t("Welcome to Wally") + '</h1><p class="w-onbp">' + t("Wally keeps track of what your household spends and earns. Your data stays on this server.") + "</p>" +
      '<div class="w-onbf">' +
      '<label class="w-onbrow"><span>' + t("Language") + '</span><select class="w-mini" id="onb-lang">' + LANGUAGES.map(([code, n]) => '<option value="' + code + '"' + (code === LANG ? " selected" : "") + ">" + esc(n) + "</option>").join("") + "</select></label>" +
      (c ? '<label class="w-onbrow"><span>' + t("Currency") + '</span><select class="w-mini" id="onb-cur">' + c.currencies.map((x) => '<option value="' + esc(x.name) + '"' + (x.name === c.selected ? " selected" : "") + ">" + esc(x.name) + " · " + esc(x.symbol) + "</option>").join("") + "</select></label>" +
        '<div class="w-onbrow"><span id="onb-pos-l">' + t("Symbol") + '</span><div class="w-seg sm" id="onb-pos" role="group" aria-labelledby="onb-pos-l">' +
        [["left", sym + sample], ["right", sample + " " + sym]].map(([v, l]) => '<button type="button" data-v="' + v + '" aria-pressed="' + (c.position === v) + '">' + esc(l) + "</button>").join("") + "</div></div>" : "") +
      "</div>";
    foot = "<span></span>" + nextBtn(t("Continue"));
  } else if (k === "people") {
    const locked = mustEncrypt();
    body = '<h1 id="gate-h">' + t("Who shares this household?") + '</h1><p class="w-onbp">' + t("Each person gets their own view. Costs you share are split between you.") + "</p>" +
      peopleRows(onb.names, onb.people) +
      (onb.people.length ? "" : '<div class="w-onbf w-onbpw"><div class="w-onbrow"><span id="onb-pw-l">' + t("Password") + '</span><span class="w-inline w-nowrap"><button type="button" class="w-switch" role="switch" id="onb-pw" aria-checked="' + onb.pw + '" aria-labelledby="onb-pw-l"' + (locked ? " disabled" : "") + "></button>" +
        '<input class="w-mini" type="password" id="onb-pwd" placeholder="' + esc(t("Choose a password")) + '" aria-label="' + esc(t("Password")) + '" autocomplete="new-password"' + (onb.pw ? "" : " hidden") + "></span></div>" +
        '<p class="w-hint">' + (locked ? t("Needed on this server: your password is the key to your data. At least 8 characters.")
          : onb.pw ? t("Wally asks for it when it opens. Everyone in the household uses this one password.") : t("Off: anyone who can reach this server can open Wally. Turn it on in Settings › Sign-in at any time.")) + "</p></div>") +
      '<p class="w-hint">' + t("Living alone? Keep just yourself. The person switch then stays hidden.") + "</p>";
    foot = backBtn() + nextBtn(t("Continue"));
  } else if (k === "privacy") {
    ({ body, foot } = privacyStep());
  } else {
    body = '<h1 id="gate-h">' + t("Bring your data") + '</h1><p class="w-onbp">' + t("You can always import more later from Settings.") + "</p>" +
      '<div class="w-choices two" role="radiogroup" aria-labelledby="gate-h">' +
      [["import", "io", t("Import a CSV"), t("From Wally 1, or from your bank. You map the columns before anything is saved.")],
       ["add", "plus", t("Start empty"), t("Add your first expense right away.")]].map(([key, ic, b, sm]) =>
        '<button type="button" class="w-choice" role="radio" data-onb-data="' + key + '" aria-checked="' + (onb.data === key) + '" aria-pressed="' + (onb.data === key) + '"><span class="w-ico">' + icon(ic) + "</span><b>" + b + "</b><small>" + sm + "</small></button>").join("") + "</div>";
    foot = (onb.kit ? "<span></span>" : backBtn()) + nextBtn(onb.data === "import" ? t("Choose a file") : t("Open Wally"));
  }
  paint(onbFrame(keys.map((x) => labels[x]), onb.step, body, foot, k === "basics" || k === "data"), k === "people" && !onb.people.length ? "[data-name]" : k === "privacy" && !onb.who && !onb.kit && !mustEncrypt() ? "[data-who]" : "#onb-next");
  wireWelcome();
}

/* What encrypting means, in everyday words: the same list whether it's chosen or required */
function whatItMeans(others) {
  return '<ul class="w-onbmeans">' +
    "<li>" + icon("lock") + "<span><b>" + t("Your password is the key.") + "</b> " + t("Nobody can reset it for you, not even whoever runs the server.") + "</span></li>" +
    "<li>" + icon("file") + "<span><b>" + t("You save an Emergency Kit.") + "</b> " + t("One for the household, to print or keep in a password manager. It gets you back in if you forget the password.") + "</span></li>" +
    (others ? "<li>" + icon("users") + "<span><b>" + t("Everyone uses the same password.") + "</b> " + t("Each person types it once on their own phone or computer.") + "</span></li>" : "") +
    "<li>" + icon("phone") + "<span><b>" + t("Phone shortcuts and API keys are off.") + "</b> " + t("They talk to the server, and the server can’t read your data.") + "</span></li></ul>";
}
function privacyStep() {
  const others = onb.people.length > 1;
  // The household's Emergency Kit: made with the password, or anew as Wally was encrypted
  if (onb.kit) {
    const body = '<h1 id="gate-h">' + t("Save the household’s Emergency Kit") + '</h1><p class="w-onbp">' +
      (onb.sealed ? t("Wally is encrypted. If you forget your password, this recovery key gets you back in. Wally keeps no copy it can read, so it can’t show it again.")
        : t("If you forget the password or can’t get a two-step code, this recovery key gets you back in. Wally keeps no copy it can read, so it can’t show it again.")) + "</p>" +
      '<div class="w-kit">' + onb.qr + keyGroups(onb.kit) + "</div>" +
      '<div class="w-silinks w-onbkit"><button type="button" class="w-btn ghost" id="onb-print">' + icon("file") + t("Print or save as PDF") + '</button><button type="button" class="w-btn ghost" id="onb-dl">' + icon("download") + t("Download") + '</button><button type="button" class="w-btn ghost" id="onb-copy">' + icon("copy") + t("Copy") + "</button></div>" +
      '<label class="w-sichk"><input type="checkbox" id="onb-saved"' + (onb.saved ? " checked" : "") + ">" + t("I saved my Emergency Kit somewhere safe") + "</label>";
    return { body, foot: "<span></span>" + nextBtn(t("Continue")) };
  }
  const secure = canEncrypt();
  if (mustEncrypt()) {
    const body = '<h1 id="gate-h">' + t("This server encrypts your data") + '</h1><p class="w-onbp">' +
      t("Whoever runs this server set it up so that Wally locks everything on your devices before it’s saved. They can’t read your household’s money: not one amount, name or category.") + "</p>" +
      (secure ? whatItMeans(others) : '<p class="w-err">' + t("This needs a secure connection. Open Wally at its https:// address to finish setting up.") + "</p>") +
      '<p class="w-hint" id="onb-prog" aria-live="polite" hidden></p>';
    return { body, foot: backBtn() + (secure ? nextBtn(t("Encrypt and continue")) : "") };
  }
  const choice = (key, title, sub, extra) =>
    '<button type="button" class="w-choice" role="radio" data-who="' + key + '" aria-checked="' + (onb.who === key) + '" aria-pressed="' + (onb.who === key) + '"' + (extra || "") + ">" +
    '<span class="w-ico">' + icon(key === "else" ? "shield" : "users") + "</span><b>" + title + "</b><small>" + sub + "</small></button>";
  const body = '<h1 id="gate-h">' + t("Who runs this server?") + '</h1><p class="w-onbp">' +
    t("Wally keeps your household’s money on a server. Whoever runs it can open the files on it, so Wally can lock everything first.") + "</p>" +
    '<div class="w-choices two" role="radiogroup" aria-labelledby="gate-h">' +
    choice("me", t("Me, or someone here"), t("Wally works as usual. Whoever runs the server can read your data, and that’s you.")) +
    choice("else", t("Someone else") + ' <span class="w-badge">' + t("Recommended") + "</span>",
      secure ? t("Wally locks everything on your devices before it’s saved. The server stores only what it can’t read.") : t("Needs a secure connection: open Wally at its https:// address to choose this."), secure ? "" : " disabled") +
    "</div>" +
    (onb.who === "else" ? '<p class="w-onbp w-onbmeanh">' + t("What changes:") + "</p>" + whatItMeans(others) : "") +
    '<p class="w-hint">' + t("You can change this later in Settings › Privacy.") + "</p>" +
    '<p class="w-hint" id="onb-prog" aria-live="polite" hidden></p>';
  return { body, foot: backBtn() + nextBtn(onb.who === "else" ? t("Encrypt and continue") : t("Continue")) };
}
/* Encrypt the new household now: there is almost nothing yet, so it takes a moment */
async function savePrivacy() {
  if (onb.kit) {
    if (!onb.saved) { onbError(t("Save your Emergency Kit first, then tick the box.")); return false; }
    onb.secret = "";
    return true;
  }
  if (!mustEncrypt()) {
    if (!onb.who) { onbError(t("Choose who runs this server.")); return false; }
    if (onb.who === "me") {
      // Not encrypted: the kit made with the password
      onb.secret = "";
      onb.kit = onb.plainKit;
      onb.plainKit = "";
      onb.qr = await (await import("../vault/kit.js")).qrSvg(onb.kit);
      renderWelcome();
      return false;
    }
  }
  const prog = root.querySelector("#onb-prog");
  const say = (step, n, total) => {
    if (!prog) return;
    prog.hidden = false;
    prog.textContent = { keys: t("Making keys from your password…"), pause: t("Pausing Wally for everyone…"), seal: t("Encrypting {n} of {total}…"), check: t("Reading everything back to compare…"), switch: t("Switching to the new file…") }[step]
      .replace("{n}", String(n || 0)).replace("{total}", String(total || 0));
  };
  const session = await vs();
  state.me = String(onb.people[0].id);
  const r = await session.turnOn(onb.secret, say);
  onb.secret = "";
  // Encrypting replaced the kit made with the password
  onb.plainKit = "";
  onb.kit = r.recoveryKey;
  onb.sealed = true;
  onb.qr = await (await import("../vault/kit.js")).qrSvg(r.recoveryKey);
  renderWelcome();
  return false;
}
function wireWelcome() {
  const keys = onbSteps(), k = keys[onb.step];
  const next = root.querySelector("#onb-next"), back = root.querySelector("#onb-back"), skip = root.querySelector("#onb-skip");
  if (back) back.addEventListener("click", () => { if (k === "people") readNames(onb.names); onb.step--; renderWelcome(); });
  if (skip) skip.addEventListener("click", () => (k === "basics" ? (onb.step = 1, renderWelcome()) : openWally("skip")));
  if (next) next.addEventListener("click", async () => {
    busy(next, true);
    try {
      if (k === "basics") await saveBasics();
      else if (k === "people") { if (!(await savePeople())) return busy(next, false); }
      else if (k === "privacy") { if (!(await savePrivacy())) return busy(root.querySelector("#onb-next"), false); }
      else return openWally(onb.data);
      onb.step++;
      renderWelcome();
    } catch (e) {
      const prog = root.querySelector("#onb-prog");
      if (prog) prog.hidden = true;
      onbError(apiMessage(e));
      busy(next, false);
    }
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
  const pw = root.querySelector("#onb-pw:not([disabled])");
  if (pw) pw.addEventListener("click", () => { readNames(onb.names); onb.pw = !onb.pw; renderWelcome(); root.querySelector(onb.pw ? "#onb-pwd" : "#onb-pw").focus(); });
  wireNames(onb.names, () => renderWelcome());
  root.querySelectorAll("[data-onb-data]").forEach((b) => b.addEventListener("click", () => { onb.data = b.dataset.onbData; renderWelcome(); root.querySelector('[data-onb-data="' + onb.data + '"]').focus(); }));
  root.querySelectorAll("[data-who]:not([disabled])").forEach((b) => b.addEventListener("click", () => { onb.who = b.dataset.who; onbError(""); renderWelcome(); root.querySelector('[data-who="' + onb.who + '"]').focus(); }));
  if (onb.kit && k === "privacy") {
    root.querySelector("#onb-print").addEventListener("click", async () => (await import("../vault/kit.js")).printKit(onb.kit));
    root.querySelector("#onb-dl").addEventListener("click", () => downloadKit(onb.kit));
    root.querySelector("#onb-copy").addEventListener("click", (ev) => copy(onb.kit, ev.currentTarget));
    root.querySelector("#onb-saved").addEventListener("change", (ev) => { onb.saved = ev.target.checked; onbError(""); });
  }
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
    const r = await PUT("/signin", { enabled: true, password });
    state.status.signin = true;
    // Shown on the next step, unless encrypting there makes a new one
    onb.plainKit = r.kit || "";
    // Kept in memory for the next step only, where it may become the household's key
    onb.secret = password;
  }
  return true;
}
async function openWally(choice) {
  try { await PUT("/config", { onboarded: true }); } catch (e) { return onbError(apiMessage(e)); }
  location.href = choice === "import" ? "/settings/import" : choice === "add" ? "/?add=1" : "/";
}

/* ---------- after the upgrade from 1.x: there is data, but no people yet ---------- */
const up = { step: 0, names: [""], people: [], tags: [], picks: {}, preview: null, remove: true };

function startPeople() { if (status.upgrade) return startReport(); renderUpgrade(); }

/* What the upgrade kept and changed, checked against the old data, before anything else */
let money = (v) => v;
async function startReport() {
  try {
    const c = await GET("/currency");
    const sel = c.currencies.find((x) => x.name === c.selected), sym = sel ? sel.symbol : c.selected;
    const nf = new Intl.NumberFormat(LANG, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    money = (v) => (c.position === "left" ? sym + nf.format(Number(v)) : nf.format(Number(v)) + " " + sym);
  } catch (e) { /* plain numbers */ }
  renderReport();
}
function renderReport() {
  const r = status.upgrade, k = r.kept;
  const day = (d) => new Intl.DateTimeFormat(LANG, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)));
  const row = (label, value) => '<div class="w-onbrow"><span>' + label + "</span><b>" + value + "</b></div>";
  const list = (items) => '<ul class="w-onblist">' + items.slice(0, 8).map((x) => "<li><span>" + esc(day(x.date)) + "</span><span>" + esc(x.name || "—") + "</span><b>" + esc(money(x.amount)) + "</b></li>").join("") +
    (items.length > 8 ? '<li class="w-hint">' + tn(items.length - 8, "and {n} more, in the report", "and {n} more, in the report") + "</li>" : "") + "</ul>";
  let body = '<h1 id="gate-h">' + t("Your data came across") + '</h1><p class="w-onbp">' +
    t("Before keeping Wally 2.0, Wally compared every transaction, rule, category and setting with your old data. Nothing was lost.") + "</p>" +
    '<div class="w-onbf">' +
    row(t("Transactions"), tn(k.transactions, "{n} transaction", "{n} transactions") + (k.first ? " · " + esc(day(k.first)) + " – " + esc(day(k.last)) : "")) +
    row(t("Spent"), esc(money(k.expense))) + row(t("Earned"), esc(money(k.income))) +
    row(t("Recurring"), tn(k.rules, "{n} rule", "{n} rules")) +
    row(t("Categories and tags"), tn(k.categories, "{n} category", "{n} categories") + " · " + tn(k.tags, "{n} tag", "{n} tags")) + "</div>";
  if (r.removed.length) {
    body += '<h2 class="w-onbh2">' + t("One thing changed") + '</h2><p class="w-onbp">' +
      tn(r.removed.length, "Wally 1 added {n} recurring charge in advance, for a date after today. Wally 2.0 adds each one on its day, so it was taken out and comes back then:",
        "Wally 1 added {n} recurring charges in advance, for dates after today. Wally 2.0 adds each one on its day, so they were taken out and come back then:") + "</p>" + list(r.removed);
  }
  for (const n of r.notes || []) {
    if (n.kind === "decimals") body += '<p class="w-hint">' + tn(n.count, "{n} amount has more than two decimals. It is kept as typed and shown to the cent.", "{n} amounts have more than two decimals. They are kept as typed and shown to the cent.") + "</p>";
    if (n.kind === "categories") body += '<p class="w-hint">' + tn(n.count, "{n} category was used but missing from your list. It is listed now.", "{n} categories were used but missing from your list. They are listed now.") + "</p>";
  }
  if (r.backup) body += '<p class="w-hint">' + t("A copy of your old data is in {file}, in Wally’s data folder. With it, Wally 1 opens your data as it was.", { file: "<code>backups/" + esc(r.backup) + "</code>" }) + "</p>";
  const foot = '<a class="w-btn ghost" href="/api/upgrade/report" download id="rep-dl">' + icon("download") + t("Download the report") + "</a>" + nextBtn(t("Continue"));
  paint('<main class="w-onb" aria-labelledby="gate-h"><div class="w-onbh"><span class="w-mark" role="img" aria-label="Wally"></span><span class="w-onbtag">' + t("Wally 2.0") + "</span></div>" +
    '<div class="w-onbb">' + body + '<p class="w-err" id="onb-err" role="alert" hidden></p></div><div class="w-onbfoot">' + foot + "</div></main>", "#onb-next");
  root.querySelector("#onb-next").addEventListener("click", async (ev) => {
    busy(ev.currentTarget, true);
    try { await POST("/upgrade/seen"); } catch (e) { /* shown again next time */ }
    status.upgrade = null;
    renderUpgrade();
  });
}
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
    body = '<h1 id="gate-h">' + t("Now sign in as yourself") + '</h1><p class="w-onbp">' + t("Pick your name, then type the household password, as before.") + "</p>" +
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


/* ======================= unlocking, and getting back in with the Emergency Kit ======================= */
/* With encryption on, the household password opens the household key on this browser. Forgot it, or
   no two-step code at hand? The recovery key from the household's Emergency Kit gets you back in,
   with or without encryption, and a new password follows, for everyone. */
let vmod = null;
async function vs() { if (!vmod) { vmod = await import("../vault/session.js"); vmod.bind(core); } return vmod; }
const vg = { step: "unlock", p: null, err: "", text: "", found: null, signedIn: false };

function startVault(step, p) {
  Object.assign(vg, { step, p: p || vg.p, err: "", text: "", found: null, signedIn: !!(status && status.signed_in) });
  renderVault();
}
function vgo(step) { vg.step = step; vg.err = ""; renderVault(); }
function others() { return state.people.filter((p) => String(p.id) !== String(vg.p)); }

const sealed = () => !!(status.vault && status.vault.on);
function renderVault() {
  if (sealed() && !canEncrypt()) {
    // Browsers only encrypt on secure pages: there is nothing this page can do
    paint(card(mark() + head(t("Open Wally over HTTPS"), t("This household is encrypted, and browsers only encrypt on secure pages. Open Wally at its https:// address.")) + (vg.signedIn ? signOutLink() : "")));
    wireSignOut();
    return;
  }
  const s = vg.step, name = esc(pname(vg.p)), msg = vg.err;
  const errP = '<p class="w-err" id="vg-msg" role="alert"' + (msg ? "" : " hidden") + ">" + msg + "</p>";
  const submit = (label) => '<button class="w-btn primary w-submit" type="submit" id="vg-go">' + label + "</button>";
  const bad = msg ? " err" : "";
  let html;
  if (s === "unlock") {
    html = bigAv(vg.p) + head(t("Unlock Wally"), t("Wally is encrypted. Enter the household password to open it on this browser.")) +
      '<form id="vg-form" class="w-siform" novalidate><input type="text" class="w-sr" autocomplete="username" value="' + name + '" tabindex="-1" aria-hidden="true" readonly>' +
      '<div class="w-input' + bad + '"><input type="password" id="vg-in" placeholder="' + esc(t("Password")) + '" aria-label="' + esc(t("Password")) + '" autocomplete="current-password" aria-describedby="vg-msg">' + eye("vg-in") + "</div>" +
      errP + submit(t("Unlock")) + "</form>" +
      '<div class="w-silinks"><button type="button" class="w-link w-silink" id="vg-forgot">' + t("Forgot password?") + "</button>" + signOutLink() + "</div>";
  } else if (s === "recover") {
    html = bigAv(vg.p) + head(t("Use your recovery key"), t("It’s on the household’s Emergency Kit: 52 letters and digits, in groups of four. It works without two-step sign-in too.")) +
      '<form id="vg-form" class="w-siform" novalidate><div class="w-input' + bad + '">' +
      '<textarea id="vg-in" class="w-sikey" rows="3" placeholder="XXXX-XXXX-XXXX-…" aria-label="' + esc(t("Recovery key")) + '" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-describedby="vg-msg">' + esc(vg.text) + "</textarea>" +
      "</div>" + errP + submit(t("Continue")) + "</form>" +
      '<div class="w-silinks"><button type="button" class="w-link w-silink" id="vg-help">' + t("Lost it too?") + "</button>" + (vg.signedIn ? signOutLink() : '<button type="button" class="w-link w-silink" id="vg-back">' + t("Back to sign in") + "</button>") + "</div>";
  } else if (s === "help") {
    const list = others();
    const last = sealed()
      ? t("Only your password or your recovery key can open this household’s data. Nobody else, not even whoever runs the server, can open it.")
      : t("Whoever runs the server can turn sign-in off with this command, then you turn it on again with a new password:");
    html = bigAv(vg.p) + head(t("Lost the Emergency Kit too?"), list.length
      ? t("Ask {names}: everyone in the household signs in with the same password.", { names: esc(new Intl.ListFormat(LANG, { type: "disjunction" }).format(list.map((p) => p.name))) })
      : last) +
      (list.length ? '<p class="w-sip">' + last + "</p>" : "") +
      (sealed() ? "" : '<div class="w-keybox w-sifile"><code translate="no">docker exec wally python3 -m api.signin_off</code></div>') +
      '<div class="w-silinks"><button type="button" class="w-link w-silink" id="vg-rec">' + t("Use my recovery key") + "</button></div>";
  } else if (s === "newpw") {
    html = bigAv(vg.p) + head(t("Choose a new household password"), t("At least 8 characters. It replaces the old one for everyone: every other browser asks for the new one.")) +
      '<form id="vg-form" class="w-siform" novalidate><input type="text" class="w-sr" autocomplete="username" value="' + esc(t("Household")) + '" tabindex="-1" aria-hidden="true" readonly>' +
      '<div class="w-input' + bad + '"><input type="password" id="vg-in" placeholder="' + esc(t("New password")) + '" aria-label="' + esc(t("New password")) + '" autocomplete="new-password" aria-describedby="vg-msg">' + eye("vg-in") + "</div>" +
      '<div class="w-input' + bad + '"><input type="password" id="vg-in2" placeholder="' + esc(t("The same again")) + '" aria-label="' + esc(t("The same again")) + '" autocomplete="new-password" aria-describedby="vg-msg">' + eye("vg-in2") + "</div>" +
      errP + submit(t("Save password")) + "</form>";
  }
  paint(card(html, s === "help" ? "wide" : ""), "#vg-in");
  wireEyes();
  wireSignOut();
  const on = (id, fn) => { const n = root.querySelector(id); if (n) n.addEventListener("click", fn); };
  const form = root.querySelector("#vg-form");
  if (form) form.addEventListener("submit", (ev) => { ev.preventDefault(); submitVault(); });
  on("#vg-forgot", () => startVault("recover", vg.p));
  on("#vg-help", () => vgo("help"));
  on("#vg-rec", () => { vg.text = ""; vgo("recover"); });
  on("#vg-back", () => go("pw", vg.p));
}
function keyGroups(key) { return '<code class="w-kitkey" translate="no">' + key.split("-").map((g) => "<span>" + esc(g) + "</span>").join("") + "</code>"; }

let vsending = false;
async function submitVault() {
  if (vsending) return;
  const input = root.querySelector("#vg-in");
  const value = input ? input.value : "";
  const s = vg.step;
  if (s !== "newpw" && !value.trim()) { vg.err = s === "unlock" ? t("Enter your password first.") : t("Enter the code first."); return renderVault(); }
  vsending = true;
  busy(root.querySelector("#vg-go"), true);
  try {
    const session = await vs();
    if (s === "unlock") {
      await session.unlockWithPassword(value, vg.p);
      return finish(true);
    }
    if (s === "recover") {
      vg.text = value;
      // Encrypted: the browser opens the household key with it. Otherwise the server checks it.
      if (sealed()) vg.found = await session.prove(vg.p, value);
      else { await POST("/kit/recover", { person_id: Number(vg.p), key: value }, { quiet401: true }); vg.found = {}; }
      return vgo("newpw");
    }
    if (s === "newpw") {
      const a = value, b = root.querySelector("#vg-in2").value;
      if (a.length < 8) { vg.err = t("Use at least 8 characters."); return renderVault(); }
      if (a !== b) { vg.err = t("The two passwords are different."); return renderVault(); }
      if (sealed()) await session.setup(vg.found, a, vg.p);
      else {
        // Where the browser can, the server never sees the new password: only a login key made from it
        let body = { new: a };
        if (canEncrypt()) { const salt = session.crypto.newSalt(); body = { new: (await session.crypto.fromPassword(a, salt)).login, salt }; }
        await POST("/kit/password", body, { quiet401: true });
      }
      vg.found = null;
      write(LAST, vg.p);
      return finish(true);
    }
  } catch (e) {
    vaultError(e);
  } finally {
    vsending = false;
    const go = root.querySelector("#vg-go");
    if (go) busy(go, false);
  }
}
function vaultError(e) {
  const d = e && e.detail && typeof e.detail === "object" ? e.detail : {};
  if (e.status === 429) vg.err = tn(d.retry_after || 30, "Too many tries. Wait {n} second, then try again.", "Too many tries. Wait {n} seconds, then try again.");
  else if (e.status === 401 && vg.step === "unlock") vg.err = t("That password isn’t right. Try again, or use Forgot password.");
  else if (e.status === 401 && d.tries_left !== undefined) {
    vg.err = t("That recovery key isn’t right.") + " " + tn(d.tries_left, "{n} try left.", "{n} tries left.");
  } else if (e.status === 401 && vg.step === "newpw") { vg.err = t("That took too long. Start again."); vg.step = "recover"; }
  else vg.err = apiMessage(e);
  renderVault();
}
