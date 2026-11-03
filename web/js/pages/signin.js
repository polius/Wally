/* The full-screen steps before the app: sign in, first run, the upgrade from 1.x, saving the
   household's Emergency Kit, getting back in with it, unlocking an encrypted household, and
   "who is using this browser".
   app.js decides which one comes first (nextGate) and calls mountGate; done() reloads Wally. */
import * as core from "../core.js";
import { t, tn, esc, state, GET, POST, PUT, av, pname, person, icon, loadLanguage, LANGUAGES, LANG, PCOLORS } from "../core.js";
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
const si = { step: "who", p: null, rec: false, err: "", wait: 0, shake: false };
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

/* Like a Mac's login window: no card. Whoever is signing in picks their face; then their face, their
   name and one password field, with the arrow that sends it inside the field. Mistakes shake the
   field and are said under it, in a space kept for them so nothing moves. */
function renderSignin() {
  const s = si.step, name = si.p ? esc(pname(si.p)) : "";
  if (s === "who") {
    paint(facePicker(t("Who is signing in?"), "", "", (b) => go("pw", b.dataset.prof)), ".w-who");
    return;
  }
  if (s === "nokit") {
    // Upgraded from 1.x and nobody has signed in since: there is no Emergency Kit yet. The server command is in the README.
    paint('<main class="w-lock wide" aria-labelledby="gate-h"><div class="w-lockhero"><span class="w-mark w-lockmark" aria-hidden="true"></span><h1 id="gate-h">' + t("There is no Emergency Kit yet") + "</h1><p>" +
      t("Wally 1 had none, so only whoever runs the server can help: they can turn sign-in off, then you turn it on again with a new password.") + "</p></div>" +
      '<div class="w-locklinks"><button type="button" class="w-link w-silink acc" id="si-back" data-autofocus>' + t("Back to sign in") + "</button></div></main>");
    root.querySelector("#si-back").addEventListener("click", () => go(si.p ? "pw" : "household"));
    return;
  }
  const code = s === "code", household = s === "household", bad = !!si.err && !si.wait;
  const face = household ? '<span class="w-mark w-lockmark" aria-hidden="true"></span>' : av(si.p, "w-lockav");
  let title, sub = "", input, links;
  if (code) {
    title = t("Two-step sign-in");
    sub = si.rec ? t("Enter one of your recovery codes") : t("Enter the 6-digit code from your authenticator app");
    input = si.rec
      ? '<input id="si-in" class="w-sicode" placeholder="xxxx-xxxx" aria-label="' + esc(t("Recovery code")) + '" autocomplete="off" autocapitalize="off" spellcheck="false"'
      : '<input id="si-in" class="w-sicode" placeholder="123 456" aria-label="' + esc(t("6-digit code")) + '" inputmode="numeric" pattern="[0-9 ]*" autocomplete="one-time-code" maxlength="7"';
    input += ' aria-invalid="' + bad + '" aria-describedby="si-msg">';
    links = '<button type="button" class="w-link w-silink" id="si-alt">' + (si.rec ? t("Use the authenticator app") : t("Use a recovery code")) + "</button>" +
      '<button type="button" class="w-link w-silink" id="si-nophone">' + t("No phone or codes?") + "</button>";
  } else {
    // Nobody to pick yet (just upgraded from 1.x): Wally's mark, and what to type. Otherwise the name says it all.
    title = household ? t("Sign in") : name;
    sub = household ? t("Enter the household password") : "";
    input = (household ? "" : '<input type="text" class="w-sr" autocomplete="username" value="' + name + '" tabindex="-1" aria-hidden="true" readonly>') +
      '<input type="password" id="si-in" placeholder="' + esc(t("Household password")) + '" aria-label="' + esc(t("Household password")) + '" aria-invalid="' + bad + '" aria-describedby="si-msg" autocomplete="current-password">' + eye("si-in");
    links = (!household && state.people.length > 1 ? '<button type="button" class="w-link w-silink" id="si-not">' + t("Not {name}?", { name }) + "</button>" : "") +
      '<button type="button" class="w-link w-silink" id="si-forgot">' + t("Forgot password?") + "</button>";
  }
  const msg = si.wait ? waitText() : si.err;
  // Said where the password is typed, so everyone knows who can read their data
  const sealed = !code && status.vault && status.vault.on ? '<p class="w-sienc w-lnote">' + icon("lock") + "<span>" + t("End-to-end encrypted: whoever runs this server can’t read your data.") + "</span></p>" : "";
  const shake = si.shake;
  si.shake = false;
  paint('<main class="w-lock" aria-labelledby="gate-h">' +
    '<div class="w-lockhero">' + face + '<h1 id="gate-h">' + title + "</h1>" + (sub ? "<p>" + sub + "</p>" : "") + "</div>" +
    '<form id="si-form" class="w-lockform" novalidate><div class="w-lockfield' + (bad ? " err" : "") + (shake ? " shake" : "") + '">' + input +
      '<button class="w-lockgo" type="submit" id="si-go" aria-label="' + esc(t("Sign in")) + '"' + (si.wait ? " disabled" : "") + ">" + icon("right") + "</button></div>" +
      '<p class="w-lockmsg" id="si-msg" role="alert">' + msg + "</p></form>" +
    '<div class="w-locklinks">' + links + "</div>" + sealed + "</main>", "#si-in");
  wireEyes();
  const input0 = root.querySelector("#si-in");
  root.querySelector("#si-form").addEventListener("submit", (ev) => { ev.preventDefault(); submitSignin(input0.value); });
  if (code) {
    root.querySelector("#si-alt").addEventListener("click", () => { si.rec = !si.rec; go("code"); });
    // Encrypted: the Emergency Kit stands in for two-step. Otherwise a one-time password from the server turns it off.
    root.querySelector("#si-nophone").addEventListener("click", forgot);
    // The code goes as soon as the sixth digit is typed or pasted
    if (!si.rec) input0.addEventListener("input", () => { if (input0.value.replace(/\D/g, "").length === 6) submitSignin(input0.value); });
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
    if (msg) msg.textContent = "";
  }, 1000);
}

let sending = false;
async function submitSignin(value) {
  if (sending || si.wait) return;
  const code = si.step === "code";
  if (!value.trim()) { si.err = code ? t("Enter the code first.") : t("Enter your password first."); si.shake = true; renderSignin(); return; }
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
    const what = !code ? t("That password isn’t right.")
      : si.rec ? t("That recovery code isn’t right, or it was already used.")
      : t("That code isn’t right. Codes change every 30 seconds, so use the newest one.");
    // The last wrong try starts the wait straight away. The tries left aren't counted out loud.
    if (!d.tries_left) return startWait(30);
    si.err = what;
    si.shake = true;
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
  // Title and faces only, like the sign-in picker
  paint(facePicker(t("Who’s using Wally?"), "", "", (b) => {
    write("wally.person", b.dataset.prof);
    finish();
  }), ".w-who");
}
/* Big faces, one tap: they come in one after another, and the chosen one comes forward while
   the rest step back. Arrows move between them. */
function facePicker(title, sub, foot, onPick) {
  const people = state.people;
  setTimeout(() => wirePicker(onPick));
  return '<main class="w-who" aria-labelledby="gate-h" tabindex="-1">' +
    '<div class="w-whohead"><h1 id="gate-h">' + title + "</h1>" + (sub ? "<p>" + sub + "</p>" : "") + "</div>" +
    '<ul class="w-wholist' + (people.length > 4 ? " many" : "") + '">' + people.map((p, i) =>
      '<li style="--i:' + i + '"><button type="button" class="w-whop w-prof" data-prof="' + p.id + '">' + av(String(p.id), "w-whoav") + '<span class="w-whon">' + esc(p.name) + "</span></button></li>").join("") + "</ul>" +
    (foot ? '<p class="w-whofoot">' + foot + "</p>" : "") + "</main>";
}
function wirePicker(onPick) {
  const box = root.querySelector(".w-who");
  if (!box || box.dataset.wired) return;
  box.dataset.wired = "1";
  const btns = [...box.querySelectorAll("[data-prof]")];
  btns.forEach((b) => b.addEventListener("click", () => {
    if (box.classList.contains("picked")) return;
    b.classList.add("on");
    box.classList.add("picked");
    // A moment for the chosen face to come forward, unless motion is turned down
    setTimeout(() => onPick(b), matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 380);
  }));
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
}

/* ======================= saving the household's Emergency Kit ======================= */
/* After the upgrade from 1.x, or turning encryption off: the household has no kit yet. Whoever
   signs in next makes one and saves it. */
const kg = { key: "", qr: "", saved: false, err: "" };
async function startKit() {
  paint(onbFrame({ key: "kit-wait", ico: "file", title: t("Save the household’s Emergency Kit"), sub: t("Getting it ready…") }));
  try {
    kg.key = (await POST("/kit", {}, { quiet401: true })).key;
    kg.qr = await (await import("../vault/kit.js")).qrSvg(kg.key);
  } catch (e) {
    // Someone else in the household saved it a moment ago: nothing to do here
    if (e.status === 409) return finish();
    paint(onbFrame({ key: "kit-err", ico: "file", title: t("Save the household’s Emergency Kit"), sub: apiMessage(e), next: t("Try again"), body: '<div class="w-locklinks">' + signOutLink() + "</div>" }));
    root.querySelector("#onb-next").addEventListener("click", startKit);
    wireSignOut();
    return;
  }
  renderKit();
}
/* The same step as in setup: the key beside its QR code, a switch, then Wally */
function renderKit() {
  paint(onbFrame({ key: "kit", ico: "file", title: t("Save the household’s Emergency Kit"), next: t("Open Wally"), nextOff: !kg.saved,
    sub: t("If you forget the password or can’t get a two-step code, this recovery key gets you back in. Wally keeps no copy it can read, so it can’t show it again."),
    body: kitBody(kg.key, kg.qr, kg.saved, "") }), "#onb-dl");
  wireKit(kg.key, (on) => { kg.saved = on; });
  root.querySelector("#onb-next").addEventListener("click", () => { if (kg.saved) finish(); });
}
/* The kit as a designed PDF, made in this browser: the key never leaves it */
async function downloadKit(key) { (await import("../vault/kit.js")).downloadKitPdf(key); }

async function copy(text, btn) {
  try { await navigator.clipboard.writeText(text); } catch (e) { return; }
  const before = btn.innerHTML;
  btn.textContent = t("Copied");
  setTimeout(() => { if (btn.isConnected) btn.innerHTML = before; }, 1600);
}

/* ======================= first run, and the upgrade from 1.x ======================= */
/* Every step has the same shape, as a phone's setup does: Back and how far along at the top, a
   symbol, one title and a sentence or two on why, what to do, then one button, with "Not now" under
   it when the step can wait. Steps come in from the side; a step drawn again (a name added, the
   language changed) doesn't move. */
let onbShown = "";
function onbFrame(o) {
  const dots = o.count > 1 ? '<ol class="w-onbdots" aria-label="' + esc(t("Step {n} of {total}", { n: o.at + 1, total: o.count })) + '">' +
    Array.from({ length: o.count }, (_, i) => '<li class="' + (i === o.at ? "on" : i < o.at ? "done" : "") + '"></li>').join("") + "</ol>" : "<span></span>";
  const top = '<div class="w-onbtop">' + (o.back ? '<button type="button" class="w-onbback" id="onb-back">' + icon("left") + "<span>" + t("Back") + "</span></button>" : "<span></span>") + dots + "<span></span></div>";
  const ico = o.ico === "mark" ? '<span class="w-mark w-onbmark" aria-hidden="true"></span>' : '<span class="w-onbico">' + icon(o.ico) + "</span>";
  const foot = '<div class="w-onbfoot">' +
    (o.next ? '<button type="button" class="w-btn primary" id="onb-next"' + (o.nextOff ? " disabled" : "") + ">" + o.next + "</button>" : "") +
    (o.alt ? '<button type="button" class="w-link w-onbalt" id="onb-skip">' + o.alt + "</button>" : "") + "</div>";
  const enter = o.key !== onbShown;
  onbShown = o.key;
  return '<main class="w-onb' + (enter ? " enter" : "") + '" aria-labelledby="gate-h">' + top +
    '<div class="w-onbb"><div class="w-onbhero">' + ico + '<h1 id="gate-h">' + o.title + "</h1>" + (o.sub ? '<p class="w-onbp">' + o.sub + "</p>" : "") + "</div>" +
    (o.body || "") + '<p class="w-err" id="onb-err" role="alert" hidden></p></div>' + foot + "</main>";
}
function onbError(msg) { const e = root.querySelector("#onb-err"); if (e) { e.innerHTML = msg || ""; e.hidden = !msg; } }
/* Encrypting, step by step, under the button */
function progress() {
  const prog = root.querySelector("#onb-prog");
  return (step, n, total) => {
    if (!prog) return;
    prog.hidden = false;
    prog.textContent = { keys: t("Making keys from your password…"), pause: t("Pausing Wally for everyone…"), seal: t("Encrypting {n} of {total}…"), check: t("Reading everything back to compare…"), switch: t("Switching to the new file…") }[step]
      .replace("{n}", String(n || 0)).replace("{total}", String(total || 0));
  };
}

/* The people rows, shared by first run and the upgrade */
function initialOf(name) { const c = [...String(name || "").trim()][0]; return c ? c.toLocaleUpperCase(LANG) : ""; }
function faceOf(name, i) { const c = initialOf(name); return '<span class="w-av c' + PCOLORS[i % 8] + (c ? "" : " none") + '" data-av="' + i + '" aria-hidden="true">' + (c ? esc(c) : icon("user")) + "</span>"; }
function peopleRows(names, created) {
  // One group of rows, as in Contacts: a face that fills in as the name is typed, the name, then You or a red minus
  if (created.length) {
    return '<ul class="w-gl w-onbgl w-onbppl">' + created.map((p) => '<li class="w-gr">' + av(String(p.id)) + '<span class="k">' + esc(p.name) + "</span>" + (p.id === created[0].id ? '<span class="w-badge">' + t("You") + "</span>" : "") + "</li>").join("") + "</ul>" +
      '<p class="w-glf">' + t("Names can be changed later in Settings › People.") + "</p>";
  }
  return '<div class="w-gl w-onbgl w-onbpl" id="onb-names">' + names.map((n, i) =>
    '<div class="w-gr w-onbper">' + faceOf(n, i) +
    '<input class="w-onbpin" data-name="' + i + '" value="' + esc(n) + '" maxlength="40" placeholder="' + esc(i === 0 ? t("Your name") : t("Name")) + '" autocomplete="' + (i === 0 ? "name" : "off") + '" aria-label="' + esc(i === 0 ? t("Your name") : t("Name of person {n}", { n: i + 1 })) + '">' +
    (i === 0 ? '<span class="w-badge">' + t("You") + "</span>"
      : '<button type="button" class="w-onbdrop" data-drop="' + i + '" aria-label="' + esc(t("Remove person {n}", { n: i + 1 })) + '">' + icon("minus") + "</button>") + "</div>").join("") +
    '<button type="button" class="w-gr add w-onbadd" id="onb-add"><span class="w-onbaddi">' + icon("plus") + "</span>" + t("Add someone") + "</button></div>";
}
function readNames(names) { root.querySelectorAll("[data-name]").forEach((i) => { names[+i.dataset.name] = i.value; }); }
function wireNames(names, rerender) {
  const add = root.querySelector("#onb-add");
  if (add) add.addEventListener("click", () => { readNames(names); names.push(""); rerender(); const list = root.querySelectorAll("[data-name]"); list[list.length - 1].focus(); });
  root.querySelectorAll("[data-drop]").forEach((b) => b.addEventListener("click", () => { readNames(names); names.splice(+b.dataset.drop, 1); rerender(); }));
  root.querySelectorAll("[data-name]").forEach((i) => {
    i.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); root.querySelector("#onb-next").click(); } });
    // The face fills in as the name is typed
    i.addEventListener("input", () => { const f = root.querySelector('[data-av="' + i.dataset.name + '"]'); if (f) f.outerHTML = faceOf(i.value, +i.dataset.name); });
  });
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

/* What encrypting means, in everyday words: the same list whether it's chosen or required */
function whatItMeans(others) {
  const item = (ic, b, sm) => "<li>" + icon(ic) + "<span><b>" + b + "</b>" + sm + "</span></li>";
  return '<ul class="w-onbmeans">' +
    item("key", t("Your password is the key."), t("Nobody can reset it for you, not even whoever runs the server.")) +
    item("file", t("You save an Emergency Kit."), t("One for the household, to print or keep in a password manager. It gets you back in if you forget the password.")) +
    (others ? item("users", t("Everyone uses the same password."), t("Each person types it once on their own phone or computer.")) : "") + "</ul>";
}
/* The household's Emergency Kit: the recovery key, its QR code, and a tick before going on */
function kitBody(key, qr, saved, note) {
  return '<div class="w-kitbox"><span class="w-kitqr">' + qr + '</span><div class="w-kitside">' + keyGroups(key) +
    '<div class="w-kitbtns"><button type="button" class="w-btn ghost" id="onb-dl">' + icon("download") + t("Download PDF") + '</button><button type="button" class="w-btn ghost" id="onb-copy">' + icon("copy") + t("Copy") + "</button></div></div></div>" +
    '<div class="w-gl w-onbgl"><label class="w-gr" for="onb-saved"><span class="k">' + t("I saved the Emergency Kit somewhere safe") + "</span>" +
    '<button type="button" class="w-switch" role="switch" id="onb-saved" aria-checked="' + !!saved + '"></button></label></div>' +
    (note ? '<p class="w-glf">' + note + "</p>" : "");
}
function wireKit(key, onTick) {
  root.querySelector("#onb-dl").addEventListener("click", () => downloadKit(key));
  root.querySelector("#onb-copy").addEventListener("click", (ev) => copy(key, ev.currentTarget));
  const sw = root.querySelector("#onb-saved");
  sw.addEventListener("click", () => {
    const on = sw.getAttribute("aria-checked") !== "true";
    sw.setAttribute("aria-checked", String(on));
    onTick(on);
    root.querySelector("#onb-next").disabled = !on;
  });
}
function pwFields(id, label, value, confirm) {
  return '<div class="w-gl w-onbgl w-onbfields"><div class="w-gr"><input type="password" id="' + id + '" placeholder="' + esc(label) + '" aria-label="' + esc(label) + '" autocomplete="' + (confirm ? "new-password" : "current-password") + '" value="' + esc(value || "") + '">' + eye(id) + "</div>" +
    (confirm ? '<div class="w-gr"><input type="password" id="' + id + '2" placeholder="' + esc(t("Confirm password")) + '" aria-label="' + esc(t("Confirm password")) + '" autocomplete="new-password" value="' + esc(value || "") + '"></div>' : "") + "</div>";
}
/* A row that opens a list, as in iOS Settings: the label, the value and a chevron, with the native
   list (a menu on a computer, a wheel on a phone) under the whole row */
function pickRow(id, label, value, options, aria) {
  return '<label class="w-gr w-grpick"><span class="k">' + label + '</span><span class="v">' + value + '</span>' + icon("right", "chev") +
    '<select id="' + id + '" aria-label="' + esc(aria || label) + '">' + options + "</select></label>";
}
// "Euro (€)": the currency's name in the app's language, then its symbol
function currencyLabel(x) {
  let n = x.name;
  try { if (/^[A-Z]{3}$/.test(x.name)) n = new Intl.DisplayNames([LANG], { type: "currency" }).of(x.name) || x.name; } catch (e) { /* the code */ }
  n = n.charAt(0).toLocaleUpperCase(LANG) + n.slice(1);
  return x.symbol && x.symbol !== x.name ? n + " (" + x.symbol + ")" : n;
}

/* ---------- first run: Welcome, People, Password, Encrypt, Emergency Kit, Your data ---------- */
/* One question a step. The password is kept in memory until the Encrypt step, where it is saved
   and, unless that waits, becomes the key to the household's data. Over plain HTTP browsers can't
   encrypt: that step is left out and the kit is made with the password. With
   WALLY_ENCRYPTION=required, neither the password nor encrypting can wait. */
// pw: a password, unless "Not now" says otherwise, so the dots count its steps from the start
const onb = { step: 0, names: [""], people: [], pw: true, secret: "", pwSaved: false, data: "add", currency: null, plainKit: "", kit: "", qr: "", saved: false, sealed: false };
const mustEncrypt = () => !!(status.vault && status.vault.required);
const canEncrypt = () => !!(window.crypto && crypto.subtle && window.isSecureContext !== false);
function onbSteps() {
  const pw = onb.pw || mustEncrypt();
  return ["basics", "people", "password", ...(pw && (canEncrypt() || mustEncrypt()) ? ["encrypt"] : []), ...(pw ? ["kit"] : []), "data"];
}

async function startWelcome() {
  if (mustEncrypt()) onb.pw = true;
  try { onb.currency = await GET("/currency"); } catch (e) { onb.currency = null; }
  renderWelcome();
}
function renderWelcome() {
  const keys = onbSteps(), k = keys[onb.step];
  const others = onb.people.length > 1 || onb.names.filter((n) => n.trim()).length > 1;
  const o = { key: "onb-" + k, count: keys.length, at: onb.step, back: onb.step > 0 };
  let focus = "#onb-next";
  if (k === "basics") {
    const c = onb.currency;
    const sample = new Intl.NumberFormat(LANG, { minimumFractionDigits: 2 }).format(12);
    const sel = c && c.currencies.find((x) => x.name === c.selected), sym = sel ? sel.symbol : "€";
    Object.assign(o, { ico: "mark", title: t("Welcome to Wally"), sub: t("Keep track of what your household spends and earns. Your data stays on this server."), next: t("Continue") });
    const langName = (LANGUAGES.find(([code]) => code === LANG) || ["", LANG])[1];
    o.body = '<div class="w-gl w-onbgl">' +
      pickRow("onb-lang", t("Language"), esc(langName), LANGUAGES.map(([code, n]) => '<option value="' + code + '"' + (code === LANG ? " selected" : "") + ">" + esc(n) + "</option>").join("")) +
      (c ? pickRow("onb-cur", t("Currency"), esc(currencyLabel(sel || { name: c.selected, symbol: sym })), c.currencies.map((x) => '<option value="' + esc(x.name) + '"' + (x.name === c.selected ? " selected" : "") + ">" + esc(currencyLabel(x)) + "</option>").join("")) +
        '<div class="w-gr"><span class="k" id="onb-pos-l">' + t("Amounts") + '</span><div class="w-seg" id="onb-pos" role="group" aria-labelledby="onb-pos-l">' +
        [["left", sym + sample], ["right", sample + " " + sym]].map(([v, l]) => '<button type="button" data-v="' + v + '" aria-pressed="' + (c.position === v) + '">' + esc(l) + "</button>").join("") + "</div></div>" : "") +
      "</div>";
  } else if (k === "people") {
    Object.assign(o, { ico: "users", title: t("Who shares this household?"), sub: t("Add everyone who spends from it, starting with you. Each person gets their own view, and costs you share are split between you."), next: t("Continue") });
    o.body = peopleRows(onb.names, onb.people) + (onb.people.length ? "" : '<p class="w-glf">' + t("Living alone? Just add yourself.") + "</p>");
    if (!onb.people.length) focus = "[data-name]";
  } else if (k === "password") {
    const must = mustEncrypt();
    Object.assign(o, { ico: "lock", title: t("Create a household password"), next: t("Continue"), alt: must ? "" : t("Not now"),
      sub: others ? t("Wally asks for it when it opens. Everyone in the household uses this one password.") : t("Wally asks for it when it opens.") });
    o.body = pwFields("onb-pwd", t("Password"), onb.secret, true) +
      '<p class="w-glf">' + (must ? t("Needed on this server: your password is the key to your data. At least 8 characters.")
        : t("At least 8 characters. Without a password, anyone who can reach this server can open Wally.")) + "</p>";
    focus = "#onb-pwd";
  } else if (k === "encrypt") {
    const must = mustEncrypt(), secure = canEncrypt();
    Object.assign(o, { ico: "shield", back: o.back && !onb.pwSaved,
      title: must ? t("This server encrypts your data") : t("Encrypt your data"),
      sub: must ? t("Whoever runs this server set it up so that Wally locks everything on your devices before it’s saved. They can’t read your household’s money: not one amount, name or category.")
        : t("Everything is locked on your devices before it’s saved. The server stores only what it can’t read, so not even whoever runs it can see your money."),
      next: secure ? t("Encrypt") : "", alt: must ? "" : t("Not now") });
    o.body = (secure ? whatItMeans(others) : '<p class="w-err">' + t("This needs a secure connection. Open Wally at its https:// address to finish setting up.") + "</p>") +
      (must ? "" : '<p class="w-hint w-onbnote">' + t("You can turn it off later in Settings › Sign-in & Privacy.") + "</p>") +
      '<p class="w-hint w-onbprog" id="onb-prog" aria-live="polite" hidden></p>';
  } else if (k === "kit") {
    Object.assign(o, { ico: "file", back: false, title: t("Save the household’s Emergency Kit"), next: t("Continue"), nextOff: !onb.saved,
      sub: onb.sealed ? t("Wally is encrypted. If you forget your password, this recovery key gets you back in. Wally keeps no copy it can read, so it can’t show it again.")
        : t("If you forget the password or can’t get a two-step code, this recovery key gets you back in. Wally keeps no copy it can read, so it can’t show it again.") });
    o.body = kitBody(onb.kit, onb.qr, onb.saved, onb.sealed || canEncrypt() ? "" : t("Your data isn’t encrypted: browsers only encrypt on secure pages. Open Wally at its https:// address, then turn it on in Settings › Sign-in & Privacy."));
    focus = "#onb-dl";
  } else {
    // No going back into the kit: it was shown once, and ticked
    Object.assign(o, { ico: "download", back: o.back && !onb.kit, title: t("Bring your data"), sub: t("You can always import more later from Settings."), next: onb.data === "import" ? t("Choose a file") : t("Open Wally") });
    o.body = '<div class="w-gl w-onbgl w-onbpick" role="radiogroup" aria-labelledby="gate-h">' +
      [["import", "upload", t("Import a CSV"), t("From Wally 1, or from your bank. You map the columns before anything is saved.")],
       ["add", "plus", t("Start empty"), t("Add your first expense right away.")]].map(([key, ic, b, sm]) =>
        '<button type="button" class="w-gr" role="radio" data-onb-data="' + key + '" aria-checked="' + (onb.data === key) + '"><span class="w-onbsico">' + icon(ic) + '</span><span class="k">' + b + "<small>" + sm + '</small></span><span class="w-onbradio">' + icon("check") + "</span></button>").join("") + "</div>";
  }
  paint(onbFrame(o), focus);
  wireEyes();
  wireWelcome(k);
}
function wireWelcome(k) {
  const next = root.querySelector("#onb-next"), back = root.querySelector("#onb-back"), skip = root.querySelector("#onb-skip");
  const go = (by) => { onb.step += by; renderWelcome(); };
  const keep = () => { if (k === "people") readNames(onb.names); if (k === "password") onb.secret = root.querySelector("#onb-pwd").value; };
  if (back) back.addEventListener("click", () => { keep(); go(-1); });
  if (skip) skip.addEventListener("click", async () => {
    busy(skip, true);
    try {
      if (k === "password") { onb.pw = false; onb.secret = ""; return go(1); }
      // Encrypting can wait: the password is saved, and the kit made with it is the household's
      if (k === "encrypt") { await savePassword(); await plainKitNow(); return go(1); }
    } catch (e) { onbError(apiMessage(e)); busy(skip, false); }
  });
  if (next) next.addEventListener("click", async () => {
    busy(next, true);
    try {
      if (k === "basics") await saveBasics();
      else if (k === "people") { if (!(await savePeople())) return busy(next, false); }
      else if (k === "password") { if (!(await choosePassword())) return busy(next, false); }
      else if (k === "encrypt") await encryptNow();
      else if (k === "kit") { if (!onb.saved) return busy(next, false); }
      else return openWally(onb.data);
      go(1);
    } catch (e) {
      const prog = root.querySelector("#onb-prog");
      if (prog) prog.hidden = true;
      onbError(apiMessage(e));
      busy(next, false);
    }
  });
  if (k === "password") root.querySelectorAll("#onb-pwd, #onb-pwd2").forEach((i) => i.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); next.click(); } }));
  if (k === "kit") wireKit(onb.kit, (on) => { onb.saved = on; onbError(""); });
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
  const people = await createPeople(onb.names);
  if (!people) return false;
  onb.people = people;
  // The first person is whoever is setting Wally up, on this browser
  write("wally.person", String(people[0].id));
  write(LAST, String(people[0].id));
  return true;
}
/* Checked here, kept in memory, saved on the next step. Where browsers can't encrypt, saved now. */
async function choosePassword() {
  const a = root.querySelector("#onb-pwd"), b = root.querySelector("#onb-pwd2");
  if (a.value.length < 8) { onbError(t("Use at least 8 characters.")); a.focus(); return false; }
  if (a.value !== b.value) { onbError(t("The passwords don’t match.")); b.focus(); return false; }
  onb.pw = true;
  onb.secret = a.value;
  if (!onbSteps().includes("encrypt")) { await savePassword(); await plainKitNow(); }
  return true;
}
async function savePassword() {
  if (onb.pwSaved) return;
  const r = await PUT("/signin", { enabled: true, password: onb.secret });
  state.status.signin = true;
  onb.pwSaved = true;
  // The kit made with the password: the household's, unless encrypting makes a new one
  onb.plainKit = r.kit || "";
}
/* Not encrypted: the kit made with the password */
async function plainKitNow() {
  onb.secret = "";
  onb.kit = onb.plainKit;
  onb.plainKit = "";
  onb.qr = await (await import("../vault/kit.js")).qrSvg(onb.kit);
}
/* Encrypt the new household now: there is almost nothing yet, so it takes a moment */
async function encryptNow() {
  await savePassword();
  const session = await vs();
  state.me = String(onb.people[0].id);
  const r = await session.turnOn(onb.secret, progress());
  onb.secret = "";
  // Encrypting replaced the kit made with the password
  onb.plainKit = "";
  onb.kit = r.recoveryKey;
  onb.sealed = true;
  onb.qr = await (await import("../vault/kit.js")).qrSvg(r.recoveryKey);
}
async function openWally(choice) {
  try { await PUT("/config", { onboarded: true }); } catch (e) { return onbError(apiMessage(e)); }
  location.href = choice === "import" ? "/settings/import" : choice === "add" ? "/?add=1" : "/";
}

/* ---------- after the upgrade from 1.x: there is data, but no people yet ---------- */
/* People, then tags if there are any, then encrypting where sign-in is on and browsers can,
   then the household's Emergency Kit. The 1.x password is asked again to encrypt: signing in
   reloaded Wally, and nothing keeps it. */
const up = { step: 0, names: [""], people: [], tags: null, picks: {}, preview: null, remove: true, kit: "", qr: "", saved: false, sealed: false };

function startPeople() { if (status.upgrade) return startReport(); startUpgrade(); }

/* Welcome to 2.0 first: what's new, and that the data came across */
async function startReport() {
  const w = await import("../welcome.js");
  paint(w.welcomeCard(status.upgrade), ".w-wel");
  w.wireCard(root.querySelector(".w-wel"));
  root.querySelector("#wel-go").addEventListener("click", async (ev) => {
    busy(ev.currentTarget, true);
    await w.markSeen();
    // Whoever upgraded is about to pick themselves on this browser: not shown to them again
    w.rememberHere();
    status.upgrade = null;
    startUpgrade();
  });
}
/* The tags first, so the steps are known from the start */
async function startUpgrade() {
  if (up.tags === null) { try { up.tags = await GET("/tags"); } catch (e) { up.tags = []; } }
  renderUpgrade();
}
function upgradeSteps() {
  const steps = ["people"];
  if (up.tags.length) steps.push("tags");
  if (status.signin && canEncrypt() && (!sealed() || up.sealed)) steps.push("encrypt");
  if (status.signin && (!status.kit || up.kit)) steps.push("kit");
  return steps;
}
function renderUpgrade() {
  const steps = upgradeSteps(), kind = steps[up.step];
  const o = { key: "up-" + kind, count: steps.length, at: up.step, back: up.step > 0 };
  let focus = "#onb-next";
  if (kind === "people") {
    Object.assign(o, { ico: "users", title: t("Who’s in your household?"), next: t("Continue"),
      sub: t("Wally 2.0 knows whose each expense is. Add everyone who uses Wally, starting with you.") });
    o.body = peopleRows(up.names, up.people) + (up.people.length ? "" : '<p class="w-glf">' + t("Everything already in Wally starts out shared by the household.") + "</p>");
    if (!up.people.length) focus = "[data-name]";
  } else if (kind === "tags") {
    const example = "#" + (Object.values(up.picks)[0] || up.tags[0]);
    Object.assign(o, { ico: "tag", title: t("Did you tag personal expenses?"), next: t("Continue"), alt: t("Not now"),
      sub: t("If you marked what one person spent with a tag, like {tag}, choose it here. Those transactions become theirs, and everything else stays shared.", { tag: "<b>" + esc(example) + "</b>" }) });
    // Each person is a row; their tag opens a short list, as a row in iOS Settings does
    o.body = '<div class="w-gl w-onbgl w-onbtags">' + up.people.map((p) =>
        '<label class="w-gr w-grpick w-onbtagrow">' + av(String(p.id)) + '<span class="k">' + esc(p.name) + '<small id="tagn-' + p.id + '" aria-live="polite">' + tagCountText(p) + "</small></span>" +
        '<span class="v" data-tagv="' + p.id + '">' + (up.picks[p.id] ? "#" + esc(up.picks[p.id]) : t("No tag")) + "</span>" + icon("right", "chev") +
        '<select data-tagfor="' + p.id + '" aria-label="' + esc(t("Tag for {name}", { name: p.name })) + '"><option value="">' + t("No tag") + "</option>" +
        up.tags.map((g) => '<option value="' + esc(g) + '"' + (up.picks[p.id] === g ? " selected" : "") + ">#" + esc(g) + "</option>").join("") + "</select></label>").join("") + "</div>" +
      '<p class="w-glf" id="tagn-shared" aria-live="polite"' + (sharedText() ? "" : " hidden") + ">" + sharedText() + "</p>" +
      '<div class="w-gl w-onbgl"><label class="w-gr" for="up-rm"><span class="k">' + t("Remove the tag from those transactions") + '</span><button type="button" class="w-switch" role="switch" id="up-rm" aria-checked="' + !!up.remove + '"></button></label></div>';
    focus = "#onb-next";
  } else if (kind === "encrypt") {
    Object.assign(o, { ico: "shield", title: t("Encrypt your data"), next: t("Encrypt"), alt: t("Not now"),
      sub: t("Wally 2.0 can lock everything on your devices before it’s saved. The server stores only what it can’t read, so not even whoever runs it can see your money.") });
    o.body = whatItMeans(up.people.length > 1) +
      '<p class="w-glh w-onblabel">' + t("To start, enter the household password.") + "</p>" + pwFields("up-pw", t("Household password"), "", false) +
      '<p class="w-hint w-onbnote">' + t("You can turn it off later in Settings › Sign-in & Privacy.") + "</p>" +
      '<p class="w-hint w-onbprog" id="onb-prog" aria-live="polite" hidden></p>';
    focus = "#up-pw";
  } else {
    Object.assign(o, { ico: "file", back: false, title: t("Save the household’s Emergency Kit"), next: t("Open Wally"), nextOff: !up.saved,
      sub: up.sealed ? t("Wally is encrypted. If you forget your password, this recovery key gets you back in. Wally keeps no copy it can read, so it can’t show it again.")
        : t("If you forget the password or can’t get a two-step code, this recovery key gets you back in. Wally keeps no copy it can read, so it can’t show it again.") });
    o.body = kitBody(up.kit, up.qr, up.saved, "");
    focus = "#onb-dl";
  }
  paint(onbFrame(o), focus);
  wireEyes();
  wireUpgrade(kind);
}
function wireUpgrade(kind) {
  const next = root.querySelector("#onb-next"), back = root.querySelector("#onb-back"), skip = root.querySelector("#onb-skip");
  // Back keeps everything as it was left: the people are already added, the tags are applied when leaving their step
  if (back) back.addEventListener("click", () => { if (kind === "people") readNames(up.names); up.step--; renderUpgrade(); });
  if (kind === "people") wireNames(up.names, () => renderUpgrade());
  if (kind === "tags") {
    root.querySelectorAll("[data-tagfor]").forEach((sel) => sel.addEventListener("change", () => {
      if (sel.value) up.picks[sel.dataset.tagfor] = sel.value; else delete up.picks[sel.dataset.tagfor];
      const v = root.querySelector('[data-tagv="' + sel.dataset.tagfor + '"]');
      if (v) v.textContent = sel.value ? "#" + sel.value : t("No tag");
      markTaken();
      previewTags();
    }));
    markTaken();
    if (!up.preview) previewTags();
    const rm = root.querySelector("#up-rm");
    rm.addEventListener("click", () => { up.remove = !up.remove; rm.setAttribute("aria-checked", String(up.remove)); });
  }
  if (kind === "kit") {
    wireKit(up.kit, (on) => { up.saved = on; onbError(""); });
    next.addEventListener("click", () => { if (up.saved) finish(up.sealed); });
    return;
  }
  if (skip) skip.addEventListener("click", async () => {
    busy(skip, true);
    try {
      if (kind === "tags") { up.picks = {}; up.preview = null; return upgradeNext(); }
      // Not encrypted: the household still needs its kit, made now
      await makePlainKit();
      upgradeNext();
    } catch (e) { onbError(apiMessage(e)); busy(skip, false); }
  });
  const pw = root.querySelector("#up-pw");
  if (pw) pw.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); next.click(); } });
  next.addEventListener("click", async () => {
    if (kind === "encrypt" && !pw.value) { onbError(t("Enter your password first.")); return pw.focus(); }
    busy(next, true);
    try {
      if (kind === "people") {
        if (!up.people.length) {
          readNames(up.names);
          const people = await createPeople(up.names);
          if (!people) return busy(next, false);
          up.people = people;
          await becomeYou(people[0]);
          // A tag with someone's name, or their first name, is most likely theirs
          for (const p of people) {
            const full = p.name.trim().toLocaleLowerCase(LANG), first = full.split(/\s+/)[0];
            const tag = up.tags.find((g) => g.toLocaleLowerCase(LANG) === full) || up.tags.find((g) => g.toLocaleLowerCase(LANG) === first);
            if (tag && !Object.values(up.picks).includes(tag)) up.picks[p.id] = tag;
          }
        }
      } else if (kind === "tags") await applyTags();
      else if (kind === "encrypt") await encryptUpgrade(pw.value);
      upgradeNext();
    } catch (e) {
      const prog = root.querySelector("#onb-prog");
      if (prog) prog.hidden = true;
      onbError(kind === "encrypt" && e.status === 401 ? t("That password isn’t right.") : apiMessage(e));
      busy(next, false);
    }
  });
}
/* This browser is whoever typed their name on the "You" row: with sign-in on, the sign-in made with
   the 1.x password becomes theirs; with it off, the browser remembers them, as "Who's using Wally?" would */
async function becomeYou(me) {
  write("wally.person", String(me.id));
  write(LAST, String(me.id));
  if (status.signin) await POST("/me/claim", { person_id: me.id });
}
async function applyTags() {
  const tags = pickedTags();
  if (Object.keys(tags).length) await POST("/people/from-tags", { tags, remove_tag: up.remove });
  up.picks = {};
  up.preview = null;
}
async function encryptUpgrade(password) {
  const session = await vs();
  state.me = String(up.people[0].id);
  const r = await session.turnOn(password, progress());
  up.sealed = true;
  up.kit = r.recoveryKey;
  up.qr = await (await import("../vault/kit.js")).qrSvg(up.kit);
}
/* Not encrypting: the kit, as whoever signs in first after the upgrade would make it */
async function makePlainKit() {
  if (status.kit) return;
  try {
    up.kit = (await POST("/kit", {}, { quiet401: true })).key;
  } catch (e) {
    // Someone else in the household saved it a moment ago
    if (e.status === 409) { status.kit = true; return; }
    throw e;
  }
  up.qr = await (await import("../vault/kit.js")).qrSvg(up.kit);
}
function upgradeNext() {
  up.step++;
  if (up.step >= upgradeSteps().length) return finish(up.sealed);
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
/* How many become theirs, and what a few of them are, so it's plain what the tag meant */
function tagCountText(p) {
  if (!up.picks[p.id]) return t("Nothing changes for {name}", { name: esc(p.name) });
  if (!up.preview) return t("Counting…");
  const n = up.preview.counts[p.id] || 0;
  const seen = (up.preview.examples || {})[p.id] || [];
  return tn(n, "{n} transaction becomes theirs", "{n} transactions become theirs") +
    (seen.length ? '<span class="w-onbseen">' + seen.map(esc).join(", ") + (n > seen.length ? "…" : "") + "</span>" : "");
}
function sharedText() {
  return up.preview && up.preview.shared ? tn(up.preview.shared, "{n} transaction is tagged for more than one person, so it stays shared.", "{n} transactions are tagged for more than one person, so they stay shared.") : "";
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
const vg = { step: "unlock", p: null, err: "", text: "", found: null, signedIn: false, shake: false };

function startVault(step, p) {
  Object.assign(vg, { step, p: p || vg.p, err: "", text: "", found: null, signedIn: !!(status && status.signed_in) });
  renderVault();
}
function vgo(step) { vg.step = step; vg.err = ""; renderVault(); }
function others() { return state.people.filter((p) => String(p.id) !== String(vg.p)); }

const sealed = () => !!(status.vault && status.vault.on);
/* The same look as signing in: no card. A face (or a key, or Wally's mark), a title, one rounded field
   with the arrow inside, quiet links under it. A mistake turns the field red and shakes it. */
function lockScreen(o) {
  return '<main class="w-lock wide" aria-labelledby="gate-h"><div class="w-lockhero">' + o.top + '<h1 id="gate-h">' + o.title + "</h1>" + (o.sub ? "<p>" + o.sub + "</p>" : "") + "</div>" +
    (o.form || "") + (o.links ? '<div class="w-locklinks">' + o.links + "</div>" : "") + (o.note ? '<p class="w-sienc w-lnote">' + icon("lock") + "<span>" + o.note + "</span></p>" : "") + "</main>";
}
const goBtn = (label, off) => '<button class="w-lockgo" type="submit" id="vg-go" aria-label="' + esc(label) + '"' + (off ? " disabled" : "") + ">" + icon("right") + "</button>";
const keyIcon = () => '<span class="w-lockkey" aria-hidden="true">' + icon("key") + "</span>";
function renderVault() {
  if (sealed() && !canEncrypt()) {
    // Browsers only encrypt on secure pages: there is nothing this page can do
    paint(lockScreen({ top: '<span class="w-mark w-lockmark" aria-hidden="true"></span>', title: t("Open Wally over HTTPS"),
      sub: t("This household is encrypted, and browsers only encrypt on secure pages. Open Wally at its https:// address."), links: vg.signedIn ? signOutLink() : "" }));
    wireSignOut();
    return;
  }
  const s = vg.step, name = esc(pname(vg.p)), msg = vg.err, bad = !!msg;
  const shake = bad && vg.shake ? " shake" : "";
  vg.shake = false;
  const msgP = '<p class="w-lockmsg" id="vg-msg" role="alert">' + msg + "</p>";
  const links = (...l) => l.filter(Boolean).join("");
  const link = (id, label, acc) => '<button type="button" class="w-link w-silink' + (acc ? " acc" : "") + '" id="' + id + '">' + label + "</button>";
  let html;
  if (s === "unlock") {
    html = lockScreen({ top: av(vg.p, "w-lockav"), title: name,
      form: '<form id="vg-form" class="w-lockform" novalidate><div class="w-lockfield' + (bad ? " err" : "") + shake + '"><input type="text" class="w-sr" autocomplete="username" value="' + name + '" tabindex="-1" aria-hidden="true" readonly>' +
        '<input type="password" id="vg-in" placeholder="' + esc(t("Household password")) + '" aria-label="' + esc(t("Household password")) + '" autocomplete="current-password" aria-invalid="' + bad + '" aria-describedby="vg-msg">' + eye("vg-in") + goBtn(t("Unlock")) + "</div>" + msgP + "</form>",
      links: links(link("vg-forgot", t("Forgot password?")), signOutLink()),
      note: t("End-to-end encrypted: whoever runs this server can’t read your data.") });
  } else if (s === "recover") {
    html = lockScreen({ top: keyIcon(), title: t("Use your recovery key"),
      sub: t("It’s on the household’s Emergency Kit: letters and digits in groups of four. It works without two-step sign-in too."),
      form: '<form id="vg-form" class="w-lockform" novalidate><div class="w-lockfield key' + (bad ? " err" : "") + shake + '">' +
        '<textarea id="vg-in" class="w-sikey" rows="1" placeholder="XXXX-XXXX-XXXX-XXXX-…" aria-label="' + esc(t("Recovery key")) + '" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-invalid="' + bad + '" aria-describedby="vg-msg">' + esc(vg.text) + "</textarea>" +
        goBtn(t("Continue")) + "</div>" + msgP + "</form>",
      links: links(link("vg-help", t("Lost it too?")), vg.signedIn ? signOutLink() : link("vg-back", t("Back to sign in"))) });
  } else if (s === "help") {
    const list = others();
    // One sentence on who can help; how the data is protected goes in the small note
    const sub = list.length
      ? t("Ask {names}: everyone in the household signs in with the same password.", { names: esc(new Intl.ListFormat(LANG, { type: "disjunction" }).format(list.map((p) => p.name))) })
      : sealed() ? t("Only your password or your recovery key can open this household’s data.")
      : t("Whoever runs the server can turn sign-in off, then you turn it on again with a new password.");
    html = lockScreen({ top: av(vg.p, "w-lockav"), title: t("Lost the Emergency Kit too?"), sub,
      links: links(link("vg-rec", t("Use my recovery key"), true), vg.signedIn ? signOutLink() : link("vg-back", t("Back to sign in"))),
      note: sealed() ? t("Only the password or the recovery key can open your data. Not even whoever runs the server can.") : "" });
  } else if (s === "newpw") {
    // Both fields in one rounded group, the arrow on the second
    const typed = vg.typed || ["", ""];
    vg.typed = null;
    html = lockScreen({ top: av(vg.p, "w-lockav"), title: t("Choose a new household password"),
      sub: t("At least 8 characters. It replaces the old one for everyone: every other browser asks for the new one."),
      form: '<form id="vg-form" class="w-lockform" novalidate><input type="text" class="w-sr" autocomplete="username" value="' + esc(t("Household")) + '" tabindex="-1" aria-hidden="true" readonly>' +
        '<div class="w-lockgroup' + (bad ? " err" : "") + shake + '"><div class="w-lockrow"><input type="password" id="vg-in" placeholder="' + esc(t("New password")) + '" aria-label="' + esc(t("New password")) + '" autocomplete="new-password" value="' + esc(typed[0]) + '" aria-invalid="' + bad + '" aria-describedby="vg-msg">' + eye("vg-in") + '<span class="w-lockgap"></span></div>' +
        '<div class="w-lockrow"><input type="password" id="vg-in2" placeholder="' + esc(t("The same again")) + '" aria-label="' + esc(t("The same again")) + '" autocomplete="new-password" value="' + esc(typed[1]) + '" aria-invalid="' + bad + '" aria-describedby="vg-msg">' + eye("vg-in2") + goBtn(t("Save password")) + "</div></div>" + msgP + "</form>" });
  }
  paint(html, "#vg-in");
  wireEyes();
  wireSignOut();
  const on = (id, fn) => { const n = root.querySelector(id); if (n) n.addEventListener("click", fn); };
  const form = root.querySelector("#vg-form");
  if (form) form.addEventListener("submit", (ev) => { ev.preventDefault(); submitVault(); });
  const key = root.querySelector("textarea#vg-in");
  if (key) {
    // One line that grows as the key is typed; Return sends it
    const fit = () => { key.style.height = "auto"; key.style.height = key.scrollHeight + "px"; };
    key.addEventListener("input", fit);
    key.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); submitVault(); } });
    fit();
  }
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
  if (s !== "newpw" && !value.trim()) { vg.err = s === "unlock" ? t("Enter your password first.") : t("Enter the code first."); vg.shake = true; return renderVault(); }
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
      // What was typed stays, so it can be corrected
      if (a.length < 8) { vg.err = t("Use at least 8 characters."); vg.shake = true; vg.typed = [a, b]; return renderVault(); }
      if (a !== b) { vg.err = t("The two passwords are different."); vg.shake = true; vg.typed = [a, b]; return renderVault(); }
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
  else if (e.status === 401 && vg.step === "unlock") vg.err = t("That password isn’t right.");
  else if (e.status === 401 && d.tries_left !== undefined) {
    vg.err = t("That recovery key isn’t right.");
  } else if (e.status === 401 && vg.step === "newpw") { vg.err = t("That took too long. Start again."); vg.step = "recover"; }
  else vg.err = apiMessage(e);
  vg.shake = true;
  renderVault();
}
