/* Settings › Sign-in: the household's one password, its Emergency Kit, two-step sign-in with its
   recovery codes (one for the household, on everyone's phone), and the browsers signed in. */
import * as core from "../../core.js";
import { t, tn, esc, state, api, GET, POST, PUT, DEL, person } from "../../core.js";
import { openDialog, toast, errorToast, empty } from "../../ui.js";
import { refresh, signOut } from "../../shell.js";
import { group, gi, ico, linkBtn, toggle, field, passwordInput, parseUtc, dayLabel, ago, deviceLabel, isPhoneUA, copyText, download, loadScript, paint } from "./common.js";

const MIN = 8;
let box = null;
let sessions = null;      // null until loaded, or when sign-in is off
let codesLeft = null;

export function mount(el) {
  box = el;
  box.addEventListener("click", onClick);
  render();
  loadExtras();
}
export function update() { if (box) render(); }
export function unmount() { box = null; }

const S = () => state.status || {};
/* With encryption on, or once the password has a salt, the browser sends a login key, never the password */
const encrypted = () => !!(S().vault && S().vault.on);
const keyed = () => !!(S().vault && (S().vault.on || S().vault.kdf));
let vmod = null;
async function vs() { if (!vmod) { vmod = await import("../../vault/session.js"); vmod.bind(core); } return vmod; }
async function proofOf(password) { return keyed() ? (await vs()).proof(password) : password; }

async function loadExtras() {
  try {
    sessions = S().signin ? await GET("/sessions") : null;
    codesLeft = S().two_step ? (await GET("/two-step/recovery-codes")).left : null;
  } catch (e) { /* the rows say what they know */ }
  if (box) render();
}
/* Sign-in changes who Wally thinks is here: read it again, and everything that shows it */
async function reloadStatus() {
  state.status = await GET("/auth/status");
  state.people = state.status.people;
  await loadExtras();
  refresh({ signin: true });
}

function render() {
  const s = S(), on = !!s.signin, two = !!s.two_step;
  const rows = [
    gi(ico("lock"), t("Ask for a password"), encrypted() ? t("On. Needed while encryption is on: the password opens the household’s data.") : on ? t("On. Everyone in the household signs in with the same password.") : t("Off. Anyone who can reach this address sees your finances. Wally asks who you are once on each browser."),
      toggle("si-toggle", on, t("Ask for a password"), !state.me || encrypted() || (on && !!(s.vault && s.vault.required)))),
  ];
  if (on) {
    rows.push(gi(ico("key"), t("Household password"), encrypted() ? t("Everyone uses it, and it opens Wally’s encryption. Changing it signs out every other browser.") : t("Everyone uses it. Changing it signs out every other browser."),
      linkBtn(t("Change"), ' data-act="password" data-k="password"')));
    rows.push(gi(ico("phone"), t("Two-step sign-in"),
      two ? t("On. A code from an authenticator app, the same on everyone’s phone.") : t("Off. The password alone opens Wally."),
      two ? '<span class="w-acts">' + linkBtn(t("Add a phone"), ' data-act="2show" data-k="2show"') + linkBtn(t("Turn off"), ' data-act="2off" data-k="2off"') + "</span>"
        : '<button type="button" class="w-btn ghost" data-act="2on" data-k="2on">' + t("Turn on") + "</button>"));
    if (two) rows.push(gi(ico("file"), t("Recovery codes"),
      (codesLeft === null ? "" : tn(codesLeft, "{n} of 10 left.", "{n} of 10 left.") + " ") + t("Each code signs in once if no phone is at hand."),
      linkBtn(t("New codes"), ' data-act="codes" data-k="codes"')));
  }
  let html = group(t("Sign-in"), rows);
  if (on) {
    let made = null;
    try { made = s.kit ? parseUtc(s.kit) : null; } catch (e) { made = null; }
    html += group(t("If you forget the password"), [
      gi(ico("file"), t("Emergency Kit"), (made ? t("Made {date}.", { date: dayLabel(made) }) + " " : "") +
        t("On the sign-in page, {forgot} takes its recovery key, then a new password. No two-step code is needed.", { forgot: '<b class="w-sstrong2">' + t("Forgot password") + "</b>" }),
        linkBtn(t("Make a new one"), ' data-act="kit" data-k="kit"')),
      gi(ico("alert"), t("Lost the kit too?"), encrypted()
        ? t("Then nobody can open the data, not even whoever runs the server. Keep the kit somewhere safe.")
        : t("Whoever runs the server can turn sign-in off with {cmd}, then you turn it on again with a new password.", { cmd: '<code translate="no">python3 -m api.signin_off</code>' })),
    ]);
    html += browsersGroup();
  }
  paint(box, html);
}

function browsersGroup() {
  if (sessions === null) return group(t("Signed-in browsers"), ['<div class="w-skel"><i></i><i style="width:60%"></i></div>']);
  const rows = sessions.map((x) => {
    const seen = parseUtc(x.last_seen), made = parseUtc(x.created_at), who = x.person_id != null ? person(String(x.person_id)) : null;
    return gi(ico(isPhoneUA(x.label) ? "phone" : "monitor"), esc(deviceLabel(x.label)) + (x.current ? ' <span class="w-badge">' + t("This browser") + "</span>" : ""),
      (who ? esc(who.name) + " · " : "") + t("Last seen {when} · signed in {date}", { when: x.current ? t("now") : ago(seen), date: made ? dayLabel(made) : "" }));
  });
  if (!rows.length) rows.push(empty("globe", t("No other browsers"), ""));
  const others = sessions.filter((x) => !x.current).length;
  rows.push(gi(ico("logout"), t("Sign out everywhere else"), others ? tn(others, "Ends {n} other sign-in now.", "Ends {n} other sign-ins now.") : t("Only this browser is signed in."),
    '<button type="button" class="w-btn ghost" data-act="others" data-k="others"' + (others ? "" : " disabled") + ">" + t("Sign out others") + "</button>"));
  rows.push(gi(ico("back"), t("Sign out of this browser"), "", linkBtn(t("Sign out"), ' data-act="signout" data-k="signout"')));
  return group(t("Signed-in browsers"), rows, t("Each sign-in lasts a year"));
}

/* A wrong password answers 401. That is not "signed out", so it must not reload the app. */
const checked = (method, path, body) => api(method, path, body, { quiet401: true });

/* ---------- actions ---------- */
async function onClick(ev) {
  if (ev.target.closest("#si-toggle:not([disabled])")) return S().signin ? signinOff() : signinOn();
  const b = ev.target.closest("[data-act]");
  if (!b || b.disabled) return;
  switch (b.dataset.act) {
    case "password": return changePassword();
    case "kit": return newKit();
    case "2on": return twoStepOn();
    case "2show": return twoStepShow();
    case "2off": return twoStepOff();
    case "codes": return newCodes();
    case "others": return signOutOthers();
    case "signout": return signOut();
  }
}

function checkNew(pw) {
  if (pw.length < MIN) throw new Error(t("Use at least {n} characters.", { n: MIN }));
}

function signinOn() {
  openDialog({
    title: t("Turn on sign-in?"),
    body: "<p>" + t("Everyone in the household signs in with this password. You stay signed in on this browser.") + "</p>" +
      field(t("Household password"), passwordInput("so-pw", "new-password"), t("At least {n} characters.", { n: MIN })) +
      field(t("The same again"), passwordInput("so-rep", "new-password")),
    ok: t("Turn on sign-in"),
    onOk: async (root) => {
      const pw = root.querySelector("#so-pw").value;
      checkNew(pw);
      if (pw !== root.querySelector("#so-rep").value) throw new Error(t("The two passwords are different."));
      const r = await PUT("/signin", { enabled: true, password: pw });
      await reloadStatus();
      const { showKit } = await import("./privacy.js");
      // The way back in if the password is forgotten, once
      setTimeout(() => showKit(r.kit, () => toast(t("Sign-in is on"))), 0);
    },
  });
}

function signinOff() {
  const m = state.me;
  openDialog({
    title: t("Turn off sign-in?"),
    body: "<p>" + t("Anyone who can open this address will see and change your finances, and the API needs no key. “Added by” will record what people say, not who signed in.") + "</p>" +
      "<p>" + t("The password and two-step sign-in are removed. Turning sign-in on again asks for a new password.") + "</p>" +
      field(t("Password"), passwordInput("sf-pw", "current-password")),
    ok: t("Turn off"),
    cancel: t("Keep it on"),
    danger: true,
    onOk: async (root) => {
      await checked("PUT", "/signin", { enabled: false, current: await proofOf(root.querySelector("#sf-pw").value) });
      // With sign-in off this browser says who it is, as it did before
      try { if (m) localStorage.setItem("wally.person", String(m)); } catch (e) { /* fine */ }
      state.status.signin = false;
      await reloadStatus();
      toast(t("Sign-in is off"));
    },
  });
}

function changePassword() {
  openDialog({
    title: t("Change the household password"),
    body: field(t("Current password"), passwordInput("pw-cur", "current-password")) +
      field(t("New password"), passwordInput("pw-new", "new-password"), t("At least {n} characters.", { n: MIN })) +
      field(t("Repeat the new password"), passwordInput("pw-rep", "new-password")) +
      "<p>" + t("Every other browser is signed out. Tell everyone in the household the new password.") + "</p>",
    ok: t("Change password"),
    onOk: async (root) => {
      const pw = root.querySelector("#pw-new").value;
      checkNew(pw);
      if (pw !== root.querySelector("#pw-rep").value) throw new Error(t("The two new passwords are not the same."));
      const cur = root.querySelector("#pw-cur").value;
      if (keyed() || (window.crypto && crypto.subtle && window.isSecureContext !== false)) await (await vs()).changePassword(cur, pw);
      else await checked("PUT", "/password", { current: cur, new: pw });
      await reloadStatus();
      toast(t("Password changed"));
    },
  });
}

/* A new Emergency Kit: the old one stops working */
function newKit() {
  openDialog({
    title: t("Make a new Emergency Kit?"),
    body: "<p>" + t("The old recovery key stops working. You see the new one once.") + "</p>" + field(t("Password"), passwordInput("kit-pw", "current-password")),
    ok: t("Make a new one"),
    onOk: async (root) => {
      const pw = root.querySelector("#kit-pw").value;
      const key = encrypted() ? await (await vs()).newRecoveryKey(pw) : (await checked("POST", "/kit", { current: await proofOf(pw) })).key;
      const { showKit } = await import("./privacy.js");
      setTimeout(() => showKit(key, async () => { toast(t("New Emergency Kit saved")); await reloadStatus(); }), 0);
    },
  });
}

/* The setup code as an SVG drawn from the otpauth:// address */
async function qrSvg(uri) {
  await loadScript("/js/vendors/qrcode.js");
  const qr = window.qrcode(0, "M");
  qr.addData(uri);
  qr.make();
  const n = qr.getModuleCount();
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += "M" + c + " " + r + "h1v1h-1z";
  return '<svg class="w-qr" viewBox="0 0 ' + n + " " + n + '" shape-rendering="crispEdges" role="img" aria-label="' + esc(t("Setup code for the authenticator app")) + '"><path fill="currentColor" d="' + d + '"/></svg>';
}

/* The secret, to scan or to type: on turning two-step on, and to add another phone later */
function scanBody(setup, svg, steps) {
  const spaced = setup.secret.match(/.{1,4}/g).join(" ");
  return "<p>" + (steps ? t("1. Scan this with an authenticator app, like 1Password, Google Authenticator or Aegis.") : t("Scan this with the authenticator app on the new phone. It shows the same codes as everyone else’s.")) + "</p>" + svg +
    '<div class="w-keybox"><code id="ts-secret">' + esc(spaced) + '</code><button type="button" class="w-btn ghost" data-copy>' + t("Copy") + "</button></div>" +
    "<p>" + t("Can’t scan it? Type the key above into the app instead.") + "</p>";
}

async function twoStepOn() {
  let setup, svg;
  try {
    setup = await POST("/two-step/setup");
    svg = await qrSvg(setup.uri);
  } catch (e) { return errorToast(e); }
  openDialog({
    title: t("Turn on two-step sign-in"),
    body: "<p>" + t("One code for the household: everyone scans the same one, on their own phone.") + "</p>" + scanBody(setup, svg, true) +
      "<p>" + t("2. Type the 6-digit code the app shows.") + "</p>" +
      '<div class="w-input"><input id="ts-code" class="w-sicode" placeholder="123 456" aria-label="' + esc(t("6-digit code")) + '" inputmode="numeric" autocomplete="one-time-code" maxlength="7" autofocus></div>' +
      passwordField(),
    ok: t("Turn on"),
    onOpen: (root) => {
      root.querySelector("[data-copy]").addEventListener("click", () => copyText(setup.secret, t("Key copied")));
    },
    onOk: async (root) => {
      const code = root.querySelector("#ts-code").value.replace(/\D/g, "");
      if (code.length !== 6) throw new Error(t("Type the 6 digits the app shows."));
      const r = await checked("POST", "/two-step/confirm", { code, password: await typedPassword(root) });
      await reloadStatus();
      showCodes(r.recovery_codes, t("Two-step sign-in is on. Recovery codes saved."));
    },
  });
}

/* The same secret again, for a new phone or someone new in the household */
function twoStepShow() {
  openDialog({
    title: t("Add a phone"),
    body: "<p>" + t("Wally shows the household’s two-step QR code again, to scan on another phone.") + "</p>" + field(t("Password"), passwordInput("ts-pw", "current-password")),
    ok: t("Show the code"),
    onOk: async (root) => {
      const setup = await checked("POST", "/two-step/show", { password: await proofOf(root.querySelector("#ts-pw").value) });
      const svg = await qrSvg(setup.uri);
      setTimeout(() => openDialog({
        title: t("Add a phone"),
        body: scanBody(setup, svg, false),
        ok: t("Done"),
        noCancel: true,
        onOpen: (r) => r.querySelector("[data-copy]").addEventListener("click", () => copyText(setup.secret, t("Key copied"))),
      }), 0);
    },
  });
}

function showCodes(codes, done) {
  const text = codes.join("\n");
  openDialog({
    title: t("Save your recovery codes"),
    body: "<p>" + t("If no phone is at hand, each code signs someone in once. Keep them with the household’s papers or in a password manager. These replace any earlier codes.") + "</p>" +
      '<div class="w-codes" id="rc-codes">' + codes.map((c) => "<span>" + esc(c) + "</span>").join("") + "</div>" +
      '<div class="w-inline"><button type="button" class="w-btn ghost" data-copy>' + t("Copy") + '</button><button type="button" class="w-btn ghost" data-save>' + t("Download") + "</button></div>",
    ok: t("I’ve saved them"),
    noCancel: true,
    onOpen: (root) => {
      root.querySelector("[data-copy]").addEventListener("click", () => copyText(text, t("Codes copied")));
      root.querySelector("[data-save]").addEventListener("click", () => download("wally-recovery-codes.txt", t("Wally recovery codes") + "\n\n" + text + "\n"));
    },
    onOk: () => { toast(done); },
  });
}

function passwordField() { return field(t("Password"), passwordInput("ts-pw", "current-password")); }
function typedPassword(root) { const n = root.querySelector("#ts-pw"); return proofOf(n ? n.value : ""); }

function twoStepOff() {
  openDialog({
    title: t("Turn off two-step sign-in?"),
    body: "<p>" + t("The password alone will open Wally again for everyone, and the recovery codes stop working.") + "</p>" + passwordField(),
    ok: t("Turn off"),
    cancel: t("Keep it on"),
    danger: true,
    onOk: async (root) => {
      await checked("DELETE", "/two-step", { password: await typedPassword(root) });
      await reloadStatus();
      toast(t("Two-step sign-in is off"));
    },
  });
}

function newCodes() {
  openDialog({
    title: t("Make new recovery codes?"),
    body: "<p>" + t("The old codes stop working. You see the new ones once.") + "</p>" + passwordField(),
    ok: t("Make new codes"),
    onOk: async (root) => {
      const r = await checked("POST", "/two-step/recovery-codes", { password: await typedPassword(root) });
      codesLeft = r.recovery_codes.length;
      showCodes(r.recovery_codes, t("New recovery codes saved"));
      render();
    },
  });
}

async function signOutOthers() {
  try {
    await DEL("/sessions/others");
    const before = sessions ? sessions.filter((x) => !x.current).length : 0;
    await loadExtras();
    toast(tn(before, "Signed out of {n} other browser", "Signed out of {n} other browsers"));
  } catch (e) { errorToast(e); }
}
