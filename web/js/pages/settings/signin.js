/* Settings › Sign-in: the household's sign-in, your own password, two-step sign-in with recovery codes,
   the browsers you are signed in on, and where everyone else stands. */
import { t, tn, esc, state, av, api, GET, POST, PUT, DEL, person } from "../../core.js";
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
const me = () => (state.me ? person(state.me) : null);

async function loadExtras() {
  const m = me();
  try {
    sessions = S().signin && m ? await GET("/me/sessions") : null;
    codesLeft = m && m.two_step ? (await GET("/me/two-step/recovery-codes")).left : null;
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
  const s = S(), m = me();
  const on = !!s.signin, req = !!s.require_two_step;
  let html = group(t("Sign-in"), [
    gi(ico("lock"), t("Ask for a password"), on ? t("On. Each person signs in with their own password.") : t("Off. Anyone who can reach this address sees your finances. Wally asks who you are once on each browser."),
      toggle("si-toggle", on, t("Ask for a password"), !m)),
    gi(ico("key"), t("Require two-step for everyone"), on ? t("Recommended when Wally can be reached from outside your home") : t("Turn on sign-in first"),
      toggle("req2-toggle", on && req, t("Require two-step for everyone"), !on)),
  ]);

  if (m) {
    const rows = [
      gi(ico("key"), t("Password"), m.has_password ? t("Only you know it. Changing it signs out your other browsers.") : t("Not chosen yet. You choose it when you turn sign-in on, or now."),
        linkBtn(m.has_password ? t("Change") : t("Choose"), ' data-act="password" data-k="password"')),
      gi(ico("lock"), t("Two-step sign-in"),
        m.two_step ? (on && req ? t("On. Required for everyone in this household.") : t("On. Asks for a code from your authenticator app.")) : t("Off. Your password alone opens Wally."),
        m.two_step ? (on && req ? "<span></span>" : linkBtn(t("Turn off"), ' data-act="2off" data-k="2off"')) : '<button type="button" class="w-btn ghost" data-act="2on" data-k="2on">' + t("Turn on") + "</button>"),
    ];
    if (m.two_step) rows.push(gi(ico("file"), t("Recovery codes"),
      (codesLeft === null ? "" : tn(codesLeft, "{n} of 10 left.", "{n} of 10 left.") + " ") + t("Each signs you in once if you lose your phone."),
      linkBtn(t("New codes"), ' data-act="codes" data-k="codes"')));
    if (on) rows.push(gi(ico("back"), t("Sign out of this browser"), "", linkBtn(t("Sign out"), ' data-act="signout" data-k="signout"')));
    html += group(t("Your sign-in · {name}", { name: esc(m.name) }), rows);
    if (on) html += browsersGroup();
  }

  html += group(t("Household"), state.people.map((p) => {
    const k = String(p.id);
    const pw = p.has_password ? t("Password set") : s.household_password ? t("Uses the household password") : t("No password yet");
    const badge = on && req && !p.two_step ? '<span class="w-badge">' + t("Asked at next sign-in") + "</span>" : "<span></span>";
    return gi(av(k, "lg"), esc(p.name) + (k === state.me ? ' <span class="w-badge">' + t("You") + "</span>" : ""), pw + " · " + (p.two_step ? t("Two-step on") : t("Two-step off")), badge);
  }), t("Each person manages their own sign-in"));

  html += group(t("If someone forgets their password"), [gi(ico("file"), t("Recovery file"),
    t("On the sign-in page, {forgot} writes a one-time password for that person to {file} in Wally’s data folder. It also turns off their two-step sign-in. Only someone with access to the server can read the file, and it is deleted after it is used.",
      { forgot: '<b class="w-sstrong2">' + t("Forgot password") + "</b>", file: "<code>password.txt</code>" }))]);
  paint(box, html);
}

function browsersGroup() {
  if (sessions === null) return group(t("Signed-in browsers"), ['<div class="w-skel"><i></i><i style="width:60%"></i></div>']);
  const rows = sessions.map((x) => {
    const seen = parseUtc(x.last_seen), made = parseUtc(x.created_at);
    return gi(ico(isPhoneUA(x.label) ? "phone" : "monitor"), esc(deviceLabel(x.label)) + (x.current ? ' <span class="w-badge">' + t("This browser") + "</span>" : ""),
      t("Last seen {when} · signed in {date}", { when: x.current ? t("now") : ago(seen), date: made ? dayLabel(made) : "" }));
  });
  if (!rows.length) rows.push(empty("globe", t("No other browsers"), ""));
  const others = sessions.filter((x) => !x.current).length;
  rows.push(gi(ico("logout"), t("Sign out everywhere else"), others ? tn(others, "Ends {n} other sign-in now.", "Ends {n} other sign-ins now.") : t("You are signed in only here."),
    '<button type="button" class="w-btn ghost" data-act="others" data-k="others"' + (others ? "" : " disabled") + ">" + t("Sign out others") + "</button>"));
  return group(t("Signed-in browsers"), rows, t("Each sign-in lasts a year"));
}

/* A wrong password answers 401. That is not "signed out", so it must not reload the app. */
const checked = (method, path, body) => api(method, path, body, { quiet401: true });

/* ---------- actions ---------- */
async function onClick(ev) {
  if (ev.target.closest("#si-toggle:not([disabled])")) return S().signin ? signinOff() : signinOn();
  if (ev.target.closest("#req2-toggle:not([disabled])")) return requireTwoStep();
  const b = ev.target.closest("[data-act]");
  if (!b || b.disabled) return;
  switch (b.dataset.act) {
    case "password": return changePassword();
    case "2on": return twoStepOn();
    case "2off": return twoStepOff();
    case "codes": return newCodes();
    case "others": return signOutOthers();
    case "signout": return signOut();
  }
}

function checkNew(pw, who) {
  if (pw.length < MIN) throw new Error(who ? t("{name}’s first password needs at least {n} characters.", { name: who, n: MIN }) : t("Use at least {n} characters.", { n: MIN }));
}

function signinOn() {
  const m = me(), s = S();
  const others = state.people.filter((p) => String(p.id) !== state.me && !p.has_password);
  openDialog({
    title: t("Turn on sign-in?"),
    body: "<p>" + t("Each person signs in with their own password. You stay signed in on this browser.") + "</p>" +
      (m.has_password ? "<p>" + t("You sign in with the password you already have.") + "</p>" : field(t("Your password"), passwordInput("so-me", "new-password"), t("At least {n} characters.", { n: MIN }))) +
      others.map((p) => field(t("First password for {name}", { name: esc(p.name) }), passwordInput("so-p" + p.id, "new-password"),
        s.household_password ? t("Optional: without one, {name} uses the household password.", { name: esc(p.name) }) : t("{name} chooses their own at their first sign-in.", { name: esc(p.name) }))).join("") +
      '<label class="w-scheck"><input type="checkbox" id="so-req"' + (s.require_two_step ? " checked" : "") + "> " + t("Require two-step for everyone") + "</label>",
    ok: t("Turn on sign-in"),
    onOk: async (root) => {
      const passwords = {};
      if (!m.has_password) { const pw = root.querySelector("#so-me").value; checkNew(pw); passwords[m.id] = pw; }
      for (const p of others) {
        const pw = root.querySelector("#so-p" + p.id).value;
        if (!pw && s.household_password) continue;
        checkNew(pw, p.name);
        passwords[p.id] = pw;
      }
      await PUT("/signin", { enabled: true, require_two_step: root.querySelector("#so-req").checked, passwords });
      await reloadStatus();
      toast(t("Sign-in is on"));
    },
  });
}

function signinOff() {
  const m = me();
  openDialog({
    title: t("Turn off sign-in?"),
    body: "<p>" + t("Anyone who can open this address will see and change your finances, and the API needs no key. “Added by” will record what people say, not who signed in.") + "</p>" +
      field(t("Your password"), passwordInput("sf-pw", "current-password")),
    ok: t("Turn off"),
    cancel: t("Keep it on"),
    danger: true,
    onOk: async (root) => {
      await checked("PUT", "/signin", { enabled: false, current: root.querySelector("#sf-pw").value });
      // With sign-in off this browser says who it is, as it did before
      try { localStorage.setItem("wally.person", String(m.id)); } catch (e) { /* fine */ }
      state.status.signin = false;
      await reloadStatus();
      toast(t("Sign-in is off"));
    },
  });
}

async function requireTwoStep() {
  const on = !S().require_two_step;
  try {
    await PUT("/signin", { enabled: true, require_two_step: on });
    await reloadStatus();
    toast(on ? t("Anyone without two-step is asked to turn it on at their next sign-in") : t("Two-step sign-in is optional again"));
  } catch (e) { errorToast(e); }
}

function changePassword() {
  const m = me(), s = S();
  const askCurrent = s.signin && (m.has_password || s.household_password);
  openDialog({
    title: m.has_password ? t("Change your password") : t("Choose your password"),
    body: (askCurrent ? field(t("Current password"), passwordInput("pw-cur", "current-password")) : "") +
      field(t("New password"), passwordInput("pw-new", "new-password"), t("At least {n} characters.", { n: MIN })) +
      field(t("Repeat the new password"), passwordInput("pw-rep", "new-password")) +
      (m.has_password && s.signin ? "<p>" + t("Your other browsers are signed out.") + "</p>" : ""),
    ok: m.has_password ? t("Change password") : t("Save password"),
    onOk: async (root) => {
      const pw = root.querySelector("#pw-new").value;
      checkNew(pw);
      if (pw !== root.querySelector("#pw-rep").value) throw new Error(t("The two new passwords are not the same."));
      await checked("PUT", "/me/password", { current: askCurrent ? root.querySelector("#pw-cur").value : "", new: pw });
      await reloadStatus();
      toast(m.has_password ? t("Password changed") : t("Password saved"));
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

async function twoStepOn() {
  let setup, svg;
  try {
    setup = await POST("/me/two-step/setup");
    svg = await qrSvg(setup.uri);
  } catch (e) { return errorToast(e); }
  const spaced = setup.secret.match(/.{1,4}/g).join(" ");
  openDialog({
    title: t("Turn on two-step sign-in"),
    body: "<p>" + t("1. Scan this with an authenticator app, like 1Password, Google Authenticator or Aegis.") + "</p>" + svg +
      '<div class="w-keybox"><code id="ts-secret">' + esc(spaced) + '</code><button type="button" class="w-btn ghost" data-copy>' + t("Copy") + "</button></div>" +
      "<p>" + t("Can’t scan it? Type the key above into the app instead.") + "</p>" +
      "<p>" + t("2. Type the 6-digit code the app shows.") + "</p>" +
      '<div class="w-input"><input id="ts-code" class="w-sicode" placeholder="123 456" aria-label="' + esc(t("6-digit code")) + '" inputmode="numeric" autocomplete="one-time-code" maxlength="7" autofocus></div>',
    ok: t("Turn on"),
    onOpen: (root) => {
      root.querySelector("[data-copy]").addEventListener("click", () => copyText(setup.secret, t("Key copied")));
      // Sent as soon as the sixth digit is typed
      root.querySelector("#ts-code").addEventListener("input", (ev) => { if (ev.target.value.replace(/\D/g, "").length === 6) root.querySelector("[data-dlg-ok]").click(); });
    },
    onOk: async (root) => {
      const code = root.querySelector("#ts-code").value.replace(/\D/g, "");
      if (code.length !== 6) throw new Error(t("Type the 6 digits the app shows."));
      const r = await POST("/me/two-step/confirm", { code });
      await reloadStatus();
      showCodes(r.recovery_codes, t("Two-step sign-in is on. Recovery codes saved."));
    },
  });
}

function showCodes(codes, done) {
  const text = codes.join("\n");
  openDialog({
    title: t("Save your recovery codes"),
    body: "<p>" + t("If you lose your phone, each code signs you in once. Keep them somewhere safe, like a password manager. These replace any earlier codes.") + "</p>" +
      '<div class="w-codes" id="rc-codes">' + codes.map((c) => "<span>" + esc(c) + "</span>").join("") + "</div>" +
      '<div class="w-inline"><button type="button" class="w-btn ghost" data-copy>' + t("Copy") + '</button><button type="button" class="w-btn ghost" data-save>' + t("Download") + "</button></div>",
    ok: t("I’ve saved them"),
    noCancel: true,
    onOpen: (root) => {
      root.querySelector("[data-copy]").addEventListener("click", () => copyText(text, t("Codes copied")));
      root.querySelector("[data-save]").addEventListener("click", () => download("wally-recovery-codes.txt", t("Wally recovery codes for {name}", { name: me() ? me().name : "" }) + "\n\n" + text + "\n"));
    },
    onOk: () => { toast(done); },
  });
}

/* Turning two-step off and new codes ask for your password when sign-in is on */
function passwordField() { return S().signin ? field(t("Your password"), passwordInput("ts-pw", "current-password")) : ""; }
function typedPassword(root) { const n = root.querySelector("#ts-pw"); return n ? n.value : ""; }

function twoStepOff() {
  openDialog({
    title: t("Turn off two-step sign-in?"),
    body: "<p>" + t("Your password alone will open Wally again, and your recovery codes stop working.") + "</p>" + passwordField(),
    ok: t("Turn off"),
    cancel: t("Keep it on"),
    danger: true,
    onOk: async (root) => {
      await checked("DELETE", "/me/two-step", { password: typedPassword(root) });
      await reloadStatus();
      toast(t("Two-step sign-in is off"));
    },
  });
}

function newCodes() {
  openDialog({
    title: t("Make new recovery codes?"),
    body: "<p>" + t("Your old codes stop working. You see the new ones once.") + "</p>" + passwordField(),
    ok: t("Make new codes"),
    onOk: async (root) => {
      const r = await checked("POST", "/me/two-step/recovery-codes", { password: typedPassword(root) });
      codesLeft = r.recovery_codes.length;
      showCodes(r.recovery_codes, t("New recovery codes saved"));
      render();
    },
  });
}

async function signOutOthers() {
  try {
    await DEL("/me/sessions/others");
    const before = sessions ? sessions.filter((x) => !x.current).length : 0;
    await loadExtras();
    toast(tn(before, "Signed out of {n} other browser", "Signed out of {n} other browsers"));
  } catch (e) { errorToast(e); }
}
