/* Settings › Sign-in & Privacy: who can get in, and who can read. One page in four short groups
   (Sign-in, Privacy, If you forget the password, Browsers). Two-step sign-in, the Emergency Kit,
   the signed-in browsers and what the server can see open their own pages:
   /settings/security/two-step, /kit, /browsers and /server. The encryption work is in js/vault/session.js. */
import * as core from "../../core.js";
import { t, tn, esc, state, icon, api, GET, POST, PUT, DEL, person, num, LANG } from "../../core.js";
import { openDialog, toast, errorToast, dialogError } from "../../ui.js";
import { refresh, signOut } from "../../shell.js";
import { openPane } from "../settings.js";
import { parseUtc, ago, deviceLabel, isPhoneUA, copyText, download, loadScript, paint, size } from "./common.js";

const MIN = 8;
const SUBS = ["two-step", "kit", "browsers", "server"];
let box = null;
let sub = null;            // the sub-page on screen, or null for the page itself
let sessions = null;       // null until loaded, or when sign-in is off
let codesLeft = null;
let check = null;          // /vault/check, with encryption on
let backups = null;        // /backups, before turning encryption on
let vmod = null;

export function mount(el, s) {
  box = el;
  sub = SUBS.includes(s) ? s : null;
  box.addEventListener("click", onClick);
  render();
  load();
}
export function update() { if (box) render(); }
export function unmount() { box = null; }
/* Settings moves between the page and its sub-pages without mounting the pane again */
export function show(s) { sub = SUBS.includes(s) ? s : null; render(); }
/* Settings draws the head: "‹ Sign-in & Privacy" on a sub-page, then its title */
export function meta(s) {
  const phone = matchMedia("(max-width:767px)").matches;
  return { "two-step": { title: phone ? t("Two-step") : t("Two-step sign-in") }, kit: { title: "" }, browsers: { title: t("Signed-in browsers") }, server: { title: t("What the server can see") } }[s] || {};
}

const S = () => state.status || {};
const V = () => S().vault || {};
const encrypted = () => !!V().on;
/* With encryption on, or once the password has a salt, the browser sends a login key, never the password */
const keyed = () => !!(V().on || V().kdf);
async function vs() { if (!vmod) { vmod = await import("../../vault/session.js"); vmod.bind(core); } return vmod; }
async function proofOf(password) { return keyed() ? (await vs()).proof(password) : password; }
/* A wrong password answers 401. That is not "signed out", so it must not reload the app. */
const checked = (method, path, body) => api(method, path, body, { quiet401: true });

async function load() {
  try {
    if (S().signin) sessions = await GET("/sessions"); else sessions = null;
    codesLeft = S().two_step ? (await GET("/two-step/recovery-codes")).left : null;
    if (encrypted()) { await vs(); check = await GET("/vault/check"); }
    else if (S().signin) backups = await GET("/backups");
  } catch (e) { /* the rows say what they know */ }
  if (box) render();
}
/* Sign-in changes who Wally thinks is here: read it again, and everything that shows it */
async function reloadStatus() {
  state.status = await GET("/auth/status");
  state.people = state.status.people;
  await load();
  refresh({ signin: true });
}

/* ---------- pieces ---------- */
const chev = () => icon("right", "chev");
function row(label, opts) {
  opts = opts || {};
  const tag = opts.go ? "a" : opts.act ? "button" : "div";
  const attrs = (opts.go ? ' href="/settings/security/' + opts.go + '" data-pane="security/' + opts.go + '" data-k="go:' + opts.go + '"' : "") + (opts.act ? ' data-act="' + opts.act + '" data-k="' + opts.act + '"' : "") +
    (tag === "button" ? ' type="button"' : "") + (opts.disabled ? " disabled" : "") + (opts.id ? ' id="' + opts.id + '"' : "");
  if (opts.cls) return "<" + tag + ' class="w-gr ' + opts.cls + '"' + attrs + ">" + label + "</" + tag + ">";
  return "<" + tag + ' class="w-gr"' + attrs + ">" + (opts.lead || "") + '<span class="k">' + label + (opts.sub ? "<small>" + opts.sub + "</small>" : "") + "</span>" +
    (opts.value !== undefined ? '<span class="v">' + opts.value + "</span>" : "") + (opts.right || "") + (opts.go ? chev() : "") + "</" + tag + ">";
}
function sw(id, on, label, disabled) {
  return '<button type="button" class="w-switch" role="switch" id="' + id + '" data-k="' + id + '" aria-checked="' + !!on + '" aria-label="' + esc(label) + '"' + (disabled ? " disabled" : "") + "></button>";
}
const gl = (rows) => '<div class="w-gl">' + rows.join("") + "</div>";
const glh = (s) => '<div class="w-glh">' + s + "</div>";
const glf = (s) => '<p class="w-glf">' + s + "</p>";
/* "Nov 2, 2026", in the language's own order */
const longDay = (d) => new Intl.DateTimeFormat(LANG, { month: "short", day: "numeric", year: "numeric" }).format(d);
function kitDate() { let d = null; try { d = S().kit ? parseUtc(S().kit) : null; } catch (e) { d = null; } return d; }

/* ---------- the page ---------- */
function render() {
  if (!box) return;
  const html = sub === "two-step" && S().two_step ? twoStepPage() : sub === "kit" && S().signin ? kitPage()
    : sub === "browsers" && S().signin ? browsersPage() : sub === "server" && encrypted() ? serverPage() : null;
  if (html === null && sub) { sub = null; setTimeout(() => openPane("security"), 0); }
  paint(box, '<div class="w-sec">' + (html === null ? mainPage() : html) + "</div>");
}

function mainPage() {
  const s = S(), v = V(), on = !!s.signin, enc = encrypted();
  const secure = !!(window.crypto && crypto.subtle && window.isSecureContext !== false);
  let h = "";
  // Sign-in
  const ask = row(t("Ask for a password"), {
    sub: enc ? t("Needed while encryption is on.") : on ? t("Everyone in the household uses the same password.") : t("Off. Anyone who can reach this address sees your finances."),
    right: sw("si-toggle", on, t("Ask for a password"), !state.me || enc || (on && !!v.required)),
  });
  h += glh(t("Sign-in")) + gl(on ? [ask, row(t("Change household password"), { act: "password", right: chev() }),
    row(t("Two-step sign-in"), { go: "two-step", value: s.two_step ? t("On") : t("Off") })] : [ask]);
  // Privacy
  h += glh(t("Privacy"));
  if (enc) {
    const lock = vmod ? vmod.lockOnClose() : false;
    const bad = vmod ? vmod.broken() : 0;
    const rows = [
      row(t("End-to-end encryption"), { sub: v.required ? t("On, and required on this server.") : t("Only your household’s devices can read your data."), right: sw("pv-toggle", true, t("End-to-end encryption"), !!v.required) }),
      row(t("Lock when Wally closes"), { sub: t("Asks for the password each time Wally opens here."), right: sw("pv-lock", lock, t("Lock when Wally closes")) }),
    ];
    if (bad) rows.push(row('<span class="w-bad">' + tn(bad, "{n} record would not open", "{n} records would not open") + "</span>",
      { sub: t("Someone without the key changed them. Wally leaves them out and keeps everything else.") }));
    rows.push(row(t("What the server can see"), { go: "server" }));
    h += gl(rows);
    if (/iPhone|iPad/.test(navigator.userAgent) && !navigator.standalone) h += glf(t("Add Wally to your Home Screen: Safari clears what a website keeps after seven days without a visit."));
  } else {
    const why = !secure ? t("Browsers only encrypt on secure pages: open Wally at its https:// address.")
      : !on ? t("Turn on sign-in first: the household password is the key.")
      : v.required ? t("Off, but required on this server: turn it on to add anything.") : t("Off. Whoever runs this server can read your data.");
    h += gl([row(t("End-to-end encryption"), { sub: why, right: sw("pv-toggle", false, t("End-to-end encryption"), !on || !secure) })]);
    if (on && secure) h += glf(t("Turning it on makes a new Emergency Kit, and sign-in then stays on."));
  }
  if (on) {
    const made = kitDate();
    h += glh(t("If you forget the password")) + gl([row(t("Emergency Kit"), { go: "kit", value: made ? esc(t("Made {date}", { date: longDay(made) })) : "" })]);
    h += glh(t("Browsers")) + gl([row(t("Signed-in browsers"), { go: "browsers", value: sessions === null ? "" : num(sessions.length) }),
      row(t("Sign out of this browser"), { act: "signout", cls: "red" })]);
  }
  return h;
}

function twoStepPage() {
  let h = "";
  h += gl([row(t("Two-step sign-in"), { sub: t("A code from an authenticator app, the same on everyone’s phone."), right: sw("ts-toggle", true, t("Two-step sign-in")) })]);
  h += gl([row(t("Add a phone"), { act: "2show", right: chev() })]);
  h += glh(t("Recovery codes")) + gl([row(t("Codes left"), { value: codesLeft === null ? "" : esc(t("{n} of 10", { n: num(codesLeft) })) }),
    row(t("Make new codes"), { act: "codes", cls: "acc" })]);
  h += glf(t("Each code signs in once, if no phone is at hand."));
  return h;
}

function kitPage() {
  const made = kitDate();
  let h = "";
  h += '<div class="w-sechero"><span class="w-secico">' + icon("file") + "</span><b>" + esc(t("Emergency Kit")) + "</b><p>" +
    (made ? esc(t("Made {date}.", { date: longDay(made) })) + " " : "") + esc(t("On the sign-in page, “Forgot password?” takes its recovery key, then a new password.")) + "</p></div>";
  h += gl([row(t("Make a new kit"), { act: "kit", cls: "acc" })]);
  h += glh(t("Lost the kit too?")) + gl(['<div class="w-gr w-gtext">' + (encrypted()
    ? esc(t("Then nobody can open the data, not even whoever runs the server. Keep the kit somewhere safe."))
    : esc(t("Whoever runs the server can turn sign-in off, then you turn it on again with a new password. The README explains how."))) + "</div>"]);
  return h;
}

function browsersPage() {
  let h = "";
  if (sessions === null) return gl(['<div class="w-gr"><div class="w-skel" style="flex:1"><i></i><i style="width:60%"></i></div></div>']);
  h += gl(sessions.map((x) => {
    const seen = parseUtc(x.last_seen), made = parseUtc(x.created_at), who = x.person_id != null ? person(String(x.person_id)) : null;
    return row(esc(deviceLabel(x.label)) + (x.current ? ' <span class="w-badge">' + t("This browser") + "</span>" : ""), {
      lead: '<span class="w-secdev">' + icon(isPhoneUA(x.label) ? "phone" : "monitor") + "</span>",
      sub: (who ? esc(who.name) + " · " : "") + esc(t("Last seen {when} · signed in {date}", { when: x.current ? t("now") : ago(seen), date: made ? longDay(made) : "" })),
    });
  }));
  const others = sessions.filter((x) => !x.current).length;
  h += gl([row(t("Sign out of other browsers"), { act: "others", cls: "red", disabled: !others })]);
  h += glf(others ? tn(others, "Ends {n} other sign-in now. Each sign-in lasts a year.", "Ends {n} other sign-ins now. Each sign-in lasts a year.") : t("Only this browser is signed in. Each sign-in lasts a year."));
  return h;
}

function serverPage() {
  const c = check, records = vmod ? vmod.records() : null;
  const clean = c && !c.plain_rows && !c.plain_backups.length && !c.leftover_files.length;
  let h = "";
  h += gl([
    row(c === null ? t("Checking…") : clean ? t("Nothing in the clear") : '<span class="w-bad">' + t("Some data is still in the clear") + "</span>", {
      lead: '<span class="w-secdev' + (c && !clean ? " bad" : "") + '">' + icon(c && !clean ? "alert" : "shield") + "</span>",
      sub: c === null ? "" : clean ? tn(c.records, "{n} encrypted record. The server can’t open any of them.", "{n} encrypted records. The server can’t open any of them.")
        : [c.plain_rows ? tn(c.plain_rows, "{n} row in Wally’s database.", "{n} rows in Wally’s database.") : "", c.plain_backups.length ? tn(c.plain_backups.length, "{n} backup from before.", "{n} backups from before.") : "", c.leftover_files.length ? t("A file left from turning encryption on.") : ""].filter(Boolean).join(" "),
    }),
    row(t("Check again"), { act: "check", cls: "acc" }),
  ]);
  h += glf(t("The server sees people’s names, sign-ins, settings, how many records there are and when they change. Not one amount, name or category."));
  if (records !== null) h += glh(t("This browser")) + gl([row(t("Kept here"), { value: esc(tn(records, "{n} encrypted record", "{n} encrypted records")) })]) +
    glf(t("Opened only in memory, while Wally is open."));
  return h;
}

/* ---------- moving between the page and its sub-pages: links with data-pane, which Settings follows ---------- */
function go(s) { openPane("security" + (s ? "/" + s : "")); }

/* ---------- actions ---------- */
async function onClick(ev) {
  if (ev.target.closest("#si-toggle:not([disabled])")) return S().signin ? signinOff() : signinOn();
  if (ev.target.closest("#pv-toggle:not([disabled])")) return encrypted() ? encryptOff() : encryptOn();
  if (ev.target.closest("#ts-toggle")) return twoStepOff();
  if (ev.target.closest("#pv-lock")) {
    const s = await vs(), on = !s.lockOnClose();
    await s.setLockOnClose(on);
    toast(on ? t("Wally locks when it closes on this browser") : t("Wally stays unlocked on this browser"));
    return render();
  }
  // Two-step while it is off opens its setup sheet, not a page
  const g = ev.target.closest('a[data-pane="security/two-step"]');
  if (g && !S().two_step && !(ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); ev.stopPropagation(); return twoStepOn(); }
  const b = ev.target.closest("[data-act]");
  if (!b || b.disabled) return;
  switch (b.dataset.act) {
    case "password": return changePassword();
    case "kit": return newKit();
    case "2show": return twoStepShow();
    case "codes": return newCodes();
    case "others": return signOutOthers();
    case "signout": return signOut();
    case "check": check = null; render(); return load();
  }
}

/* ---------- dialog bodies ---------- */
const pwRow = (id, ph, ac, focus) => '<label class="w-gr"><input type="password" id="' + id + '" placeholder="' + esc(ph) + '" aria-label="' + esc(ph) + '" autocomplete="' + (ac || "current-password") + '"' + (focus ? " autofocus" : "") + "></label>";
/* An alert that asks for the household password: a picture, the question, one field, Cancel and the action */
function passwordAlert(o) {
  const id = o.id || "al-pw";
  return openDialog({
    kind: "alert",
    top: '<span class="w-alead' + (o.danger ? " red" : "") + '">' + icon(o.icon) + "</span>",
    title: o.title,
    body: "<p>" + o.text + '</p><input type="password" class="w-afld" id="' + id + '" placeholder="' + esc(t("Household password")) + '" aria-label="' + esc(t("Household password")) + '" autocomplete="current-password">' +
      (o.progress ? '<p class="w-hint" id="pv-progress" aria-live="polite" hidden></p>' : ""),
    ok: o.ok,
    danger: o.danger,
    onOpen: (root) => {
      root.classList.add("w-falert");
      const ok = root.querySelector("[data-dlg-ok]"), pw = root.querySelector("#" + id);
      pw.addEventListener("input", () => dialogError(""));
      pw.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); ev.stopPropagation(); ok.click(); } });
      setTimeout(() => pw.focus(), 0);
    },
    // The action stays lit, as in an iOS alert; with the field empty it asks for the password instead
    onOk: (root) => {
      const pw = root.querySelector("#" + id);
      if (!pw.value) { dialogError(t("Enter your password first.")); setTimeout(() => pw.focus(), 0); return false; }
      return o.onOk(pw.value, root);
    },
  });
}
/* A sheet, which on a phone rises to just under the top, like a full iOS sheet */
function sheet(o) {
  const open = o.onOpen;
  return openDialog(Object.assign({}, o, { kind: "sheet", onOpen: (root) => { root.classList.add("w-shfull"); if (open) open(root); } }));
}
/* A sheet's main button waits until its fields are filled in */
function gate(root, test) {
  const ok = root.querySelector("[data-dlg-ok]");
  const upd = () => { ok.disabled = !test(root); };
  root.addEventListener("input", () => { upd(); dialogError(""); });
  upd();
}
function checkNew(pw) { if (pw.length < MIN) throw new Error(t("Use at least {n} characters.", { n: MIN })); }

function signinOn() {
  sheet({
    title: t("Turn On Sign-in"),
    body: '<p class="w-shlead">' + t("Everyone in the household signs in with this password. You stay signed in on this browser.") + "</p>" +
      '<div class="w-gl">' + pwRow("so-pw", t("Household password"), "new-password", true) + pwRow("so-rep", t("The same again"), "new-password") + "</div>" +
      '<p class="w-glf">' + t("At least {n} characters.", { n: MIN }) + "</p>",
    ok: t("Turn On"),
    onOpen: (root) => gate(root, (r) => r.querySelector("#so-pw").value.length >= MIN && !!r.querySelector("#so-rep").value),
    onOk: async (root) => {
      const pw = root.querySelector("#so-pw").value;
      checkNew(pw);
      if (pw !== root.querySelector("#so-rep").value) throw new Error(t("The two passwords are different."));
      const r = await PUT("/signin", { enabled: true, password: pw });
      await reloadStatus();
      // The way back in if the password is forgotten, once
      setTimeout(() => showKit(r.kit, () => toast(t("Sign-in is on"))), 0);
    },
  });
}

function signinOff() {
  const m = state.me;
  passwordAlert({
    id: "sf-pw",
    icon: "lock", danger: true,
    title: t("Turn off sign-in?"),
    text: t("Anyone who can open this address will see and change your finances. The password and two-step are removed."),
    ok: t("Turn Off"),
    onOk: async (pw) => {
      await checked("PUT", "/signin", { enabled: false, current: await proofOf(pw) });
      // With sign-in off this browser says who it is, as it did before
      try { if (m) localStorage.setItem("wally.person", String(m)); } catch (e) { /* fine */ }
      state.status.signin = false;
      await reloadStatus();
      toast(t("Sign-in is off"));
    },
  });
}

function changePassword() {
  sheet({
    title: t("Change Password"),
    body: '<div class="w-gl">' + pwRow("pw-cur", t("Current password"), "current-password", true) + "</div>" +
      '<div class="w-gl">' + pwRow("pw-new", t("New password"), "new-password") + pwRow("pw-rep", t("The new one again"), "new-password") + "</div>" +
      '<p class="w-glf">' + t("At least {n} characters. Every other browser is signed out: tell everyone the new password.", { n: MIN }) + "</p>",
    ok: t("Change"),
    onOpen: (root) => gate(root, (r) => !!r.querySelector("#pw-cur").value && r.querySelector("#pw-new").value.length >= MIN && !!r.querySelector("#pw-rep").value),
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
  passwordAlert({
    id: "kit-pw",
    icon: "file",
    title: t("Make a new Emergency Kit?"),
    text: t("The old recovery key stops working. You see the new one once."),
    ok: t("Make New Kit"),
    onOk: async (pw) => {
      const key = encrypted() ? await (await vs()).newRecoveryKey(pw) : (await checked("POST", "/kit", { current: await proofOf(pw) })).key;
      setTimeout(() => showKit(key, async () => { toast(t("New Emergency Kit saved")); await reloadStatus(); }), 0);
    },
  });
}

/* The recovery key, once: download the PDF or copy it, and say it is saved. The same design as the kit step in setup. */
export async function showKit(key, then) {
  const kit = await import("../../vault/kit.js");
  const qr = await kit.qrSvg(key);
  sheet({
    title: "",
    top: '<span class="w-secico">' + icon("file") + "</span><b class=\"w-shtitle\">" + t("Save the household’s Emergency Kit") + "</b><p>" +
      t("If you forget the password or can’t get a two-step code, this recovery key gets you back in. Wally can’t show it again.") + "</p>",
    body: '<div class="w-seckey">' + qr + keyLines(key) + "</div>" +
      '<div class="w-secbtns"><button type="button" class="w-btn ghost" data-save>' + icon("io") + t("Download PDF") + '</button><button type="button" class="w-btn ghost" data-copy>' + icon("copy") + t("Copy") + "</button></div>" +
      '<div class="w-gl"><div class="w-gr"><span class="k" id="kit-saved-l">' + t("I saved it somewhere safe") + '</span><button type="button" class="w-switch" role="switch" id="kit-saved" aria-checked="false" aria-labelledby="kit-saved-l"></button></div></div>',
    ok: t("Done"),
    noCancel: true,
    sticky: true,
    wide: true,
    onOpen: (root) => {
      root.classList.add("w-kitsheet");
      const ok = root.querySelector("[data-dlg-ok]"), s = root.querySelector("#kit-saved");
      if (ok) ok.disabled = true;
      s.addEventListener("click", () => { const on = s.getAttribute("aria-checked") !== "true"; s.setAttribute("aria-checked", String(on)); if (ok) ok.disabled = !on; });
      root.querySelector("[data-save]").addEventListener("click", () => kit.downloadKitPdf(key));
      root.querySelector("[data-copy]").addEventListener("click", () => copyText(key, t("Recovery key copied")));
    },
    onOk: () => { if (then) then(); },
  });
}

/* The key in three lines, 4 + 4 + 5 groups, as on the printed kit */
function keyLines(key) {
  const g = key.split("-").map(esc), lines = [g.slice(0, 4), g.slice(4, 8), g.slice(8)].filter((l) => l.length);
  return '<code class="w-kitkey w-seclines" translate="no">' + lines.map((l) => "<span>" + l.join(" ") + "</span>").join("") + "</code>";
}

/* ---------- two-step ---------- */
/* The setup code as an SVG drawn from the otpauth:// address */
async function qrCode(uri) {
  await loadScript("/js/vendors/qrcode.js");
  const qr = window.qrcode(0, "M");
  qr.addData(uri);
  qr.make();
  const n = qr.getModuleCount();
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += "M" + c + " " + r + "h1v1h-1z";
  return '<svg class="w-qr" viewBox="-2 -2 ' + (n + 4) + " " + (n + 4) + '" shape-rendering="crispEdges" role="img" aria-label="' + esc(t("Setup code for the authenticator app")) + '"><rect x="-2" y="-2" width="' + (n + 4) + '" height="' + (n + 4) + '" fill="#fff"/><path fill="#111" d="' + d + '"/></svg>';
}
function scanBox(setup, svg) {
  const spaced = setup.secret.match(/.{1,4}/g).join(" ");
  return '<div class="w-seckey w-secscan">' + svg + '<div class="w-secsecret"><code id="ts-secret" translate="no">' + esc(spaced) + '</code><button type="button" class="w-link" data-copy>' + t("Copy") + "</button></div></div>";
}

async function twoStepOn() {
  let setup, svg;
  try {
    setup = await POST("/two-step/setup");
    svg = await qrCode(setup.uri);
  } catch (e) { return errorToast(e); }
  sheet({
    title: t("Two-Step Sign-in"),
    wide: true,
    body: '<p class="w-shlead">' + t("One code for the household: everyone scans the same one, on their own phone.") + "</p>" +
      '<div class="w-glh">' + t("1 · Scan it with an authenticator app") + "</div>" + scanBox(setup, svg) +
      '<p class="w-glf">' + t("Like 1Password, Google Authenticator or Aegis. Can’t scan? Type the key instead.") + "</p>" +
      '<div class="w-glh">' + t("2 · Type the code it shows") + "</div>" +
      '<div class="w-gl"><label class="w-gr"><input id="ts-code" placeholder="' + esc(t("6-digit code")) + '" aria-label="' + esc(t("6-digit code")) + '" inputmode="numeric" autocomplete="one-time-code" maxlength="7"></label>' +
      pwRow("ts-pw", t("Household password")) + "</div>",
    ok: t("Turn On"),
    onOpen: (root) => {
      root.classList.add("w-sh480");
      root.querySelector("[data-copy]").addEventListener("click", () => copyText(setup.secret, t("Key copied")));
      gate(root, (r) => r.querySelector("#ts-code").value.replace(/\D/g, "").length === 6 && !!r.querySelector("#ts-pw").value);
      setTimeout(() => root.querySelector("#ts-code").focus(), 0);
    },
    onOk: async (root) => {
      const code = root.querySelector("#ts-code").value.replace(/\D/g, "");
      if (code.length !== 6) throw new Error(t("Type the 6 digits the app shows."));
      const r = await checked("POST", "/two-step/confirm", { code, password: await proofOf(root.querySelector("#ts-pw").value) });
      await reloadStatus();
      if (box) go("two-step");
      showCodes(r.recovery_codes, t("Two-step sign-in is on. Recovery codes saved."));
    },
  });
}

/* The same secret again, for a new phone or someone new in the household */
function twoStepShow() {
  passwordAlert({
    id: "ts-pw",
    icon: "phone",
    title: t("Add a phone?"),
    text: t("Wally shows the household’s two-step code again, to scan on another phone."),
    ok: t("Show Code"),
    onOk: async (pw) => {
      const setup = await checked("POST", "/two-step/show", { password: await proofOf(pw) });
      const svg = await qrCode(setup.uri);
      setTimeout(() => sheet({
        title: t("Add a Phone"),
        body: '<p class="w-shlead">' + t("Scan this with the authenticator app on the new phone. It shows the same codes as everyone else’s.") + "</p>" + scanBox(setup, svg),
        ok: t("Done"),
        noCancel: true,
        onOpen: (r) => r.querySelector("[data-copy]").addEventListener("click", () => copyText(setup.secret, t("Key copied"))),
      }), 0);
    },
  });
}

function showCodes(codes, done) {
  const text = codes.join("\n");
  sheet({
    title: t("Recovery Codes"),
    body: '<p class="w-shlead">' + t("If no phone is at hand, each code signs someone in once. Keep them with the household’s papers. They replace any earlier codes.") + "</p>" +
      '<div class="w-seckey"><div class="w-codes" id="rc-codes">' + codes.map((c) => "<span>" + esc(c) + "</span>").join("") + "</div></div>" +
      '<div class="w-secbtns"><button type="button" class="w-btn ghost" data-save>' + icon("io") + t("Download") + '</button><button type="button" class="w-btn ghost" data-copy>' + icon("copy") + t("Copy") + "</button></div>",
    ok: t("Done"),
    noCancel: true,
    onOpen: (root) => {
      root.querySelector("[data-copy]").addEventListener("click", () => copyText(text, t("Codes copied")));
      root.querySelector("[data-save]").addEventListener("click", () => download("wally-recovery-codes.txt", t("Wally recovery codes") + "\n\n" + text + "\n"));
    },
    onOk: () => { toast(done); },
  });
}

function twoStepOff() {
  passwordAlert({
    id: "ts-pw",
    icon: "phone", danger: true,
    title: t("Turn off two-step sign-in?"),
    text: t("The password alone will open Wally again for everyone, and the recovery codes stop working."),
    ok: t("Turn Off"),
    onOk: async (pw) => {
      await checked("DELETE", "/two-step", { password: await proofOf(pw) });
      await reloadStatus();
      toast(t("Two-step sign-in is off"));
      if (box) go(null);
    },
  });
}

function newCodes() {
  passwordAlert({
    id: "ts-pw",
    icon: "file",
    title: t("Make new recovery codes?"),
    text: t("The old codes stop working. You see the new ones once."),
    ok: t("Make New Codes"),
    onOk: async (pw) => {
      const r = await checked("POST", "/two-step/recovery-codes", { password: await proofOf(pw) });
      codesLeft = r.recovery_codes.length;
      setTimeout(() => showCodes(r.recovery_codes, t("New recovery codes saved")), 0);
      render();
    },
  });
}

async function signOutOthers() {
  try {
    const before = sessions ? sessions.filter((x) => !x.current).length : 0;
    await DEL("/sessions/others");
    await load();
    toast(tn(before, "Signed out of {n} other browser", "Signed out of {n} other browsers"));
  } catch (e) { errorToast(e); }
}

/* ---------- encryption ---------- */
const STEPS = () => ({
  keys: t("Making keys from your password…"),
  pause: t("Pausing Wally for everyone…"),
  seal: t("Encrypting {n} of {total}…"),
  open: t("Opening {n} of {total}…"),
  check: t("Reading everything back to compare…"),
  switch: t("Switching to the new file…"),
});
function progress(root) {
  return (step, n, total) => {
    const p = root.querySelector("#pv-progress");
    if (p) { p.hidden = false; p.textContent = STEPS()[step].replace("{n}", num(n || 0)).replace("{total}", num(total || 0)); }
  };
}

function encryptOn() {
  const list = backups || [];
  sheet({
    title: t("Turn On Encryption"),
    top: '<span class="w-secico">' + icon("shield") + '</span><b class="w-shtitle w-sht20">' + t("End-to-end encryption") + '</b><p class="w-mw360">' +
      t("Only your household’s devices will read your data. Whoever runs the server can’t, and can’t reset the password either.") + "</p>",
    body: '<div class="w-gl">' + pwRow("pv-pw", t("Household password"), "current-password", true) + "</div>" +
      '<p class="w-glf">' + t("You get a new Emergency Kit next. Sign-in stays on, and API keys need to be made again.") +
      (list.length ? " " + tn(list.length, "The {n} backup on the server is in the clear, so it’s deleted:", "The {n} backups on the server are in the clear, so they’re deleted:") +
        ' <span class="w-sbackups">' + list.map((b) => '<a href="/api/backups/' + encodeURIComponent(b.name) + '" download>' + esc(b.name) + " · " + size(b.size) + "</a>").join("") + "</span>" : "") + "</p>" +
      '<p class="w-hint" id="pv-progress" aria-live="polite" hidden></p>',
    ok: t("Turn On"),
    onOpen: (root) => gate(root, (r) => !!r.querySelector("#pv-pw").value),
    onOk: async (root) => {
      const pw = root.querySelector("#pv-pw").value;
      if (!pw) throw new Error(t("Enter your password first."));
      const s = await vs();
      let r;
      try { r = await s.turnOn(pw, progress(root)); }
      catch (e) { const p = root.querySelector("#pv-progress"); if (p) p.hidden = true; throw e; }
      setTimeout(() => showKit(r.recoveryKey, () => location.reload()), 0);
    },
  });
}

function encryptOff() {
  passwordAlert({
    id: "pv-pw",
    icon: "shield", danger: true, progress: true,
    title: t("Turn off encryption?"),
    text: t("Your data is stored on the server in the clear again. The Emergency Kit stops working; you get a new one."),
    ok: t("Turn Off"),
    onOk: async (pw, root) => {
      if (!pw) throw new Error(t("Enter your password first."));
      const s = await vs();
      try { await s.turnOff(pw, progress(root)); }
      catch (e) { const p = root.querySelector("#pv-progress"); if (p) p.hidden = true; throw e; }
      toast(t("Encryption is off"));
      setTimeout(() => location.reload(), 600);
    },
  });
}

export { ago };
