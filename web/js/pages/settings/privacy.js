/* Settings › Privacy: end-to-end encryption. Turning it on or off, the Emergency Kit, this device,
   and what the server still holds in the clear. The work is in js/vault/session.js. */
import * as core from "../../core.js";
import { t, tn, esc, state, GET, num } from "../../core.js";
import { openDialog, toast, errorToast } from "../../ui.js";
import { openPane } from "../settings.js";
import { group, gi, ico, linkBtn, toggle, field, passwordInput, parseUtc, dayLabel, ago, size, paint, copyText, download } from "./common.js";

let box = null;
let check = null;        // /vault/check, with encryption on
let backups = null;      // /backups, before turning it on
let mod = null;
async function vs() { if (!mod) { mod = await import("../../vault/session.js"); mod.bind(core); } return mod; }

export function mount(el) {
  box = el;
  box.addEventListener("click", onClick);
  render();
  load();
}
export function update() { if (box) render(); }
export function unmount() { box = null; }

const V = () => (state.status && state.status.vault) || {};
async function load() {
  try {
    if (V().on) {
      await vs();
      check = await GET("/vault/check");
    } else backups = await GET("/backups");
  } catch (e) { /* the rows say what they know */ }
  if (box) render();
}
async function reloadStatus() { state.status = await GET("/auth/status"); }

function render() {
  const v = V(), s = state.status || {};
  const on = !!v.on, signin = !!s.signin;
  const secure = !!(window.crypto && crypto.subtle && window.isSecureContext !== false);
  const required = !!v.required;
  let html = group(t("End-to-end encryption"), [
    gi(ico("shield"), t("Encrypt on your devices"),
      on ? (required ? t("On, and required on this server: whoever runs it chose that it can never read your data.") : t("On. Only your household’s devices can read your data. Whoever runs the server can’t."))
        : !secure ? t("Off. Browsers only encrypt on secure pages: open Wally at its https:// address to turn this on.")
        : !signin ? t("Off. Turn on sign-in first: encryption needs the household password.")
        : required ? t("Off, but required on this server: turn it on to add anything.") : t("Off. Whoever runs this server can read your household’s data."),
      toggle("pv-toggle", on, t("Encrypt on your devices"), on ? required : (!signin || !secure))),
  ], "", "");
  if (!on && !signin) html += '<p class="w-hint w-spad">' + linkBtn(t("Open Sign-in"), ' data-act="signin"') + "</p>";

  if (on) {
    const lock = mod ? mod.lockOnClose() : false;
    const records = mod ? mod.records() : null;
    const rows = [
      gi(ico("lock"), t("Lock when Wally closes"), t("Asks for your password each time Wally opens on this browser. Nothing stays unlocked here."), toggle("pv-lock", lock, t("Lock when Wally closes"))),
      gi(ico("monitor"), t("Kept on this browser"), records === null ? "" : tn(records, "{n} encrypted record, opened only in memory.", "{n} encrypted records, opened only in memory.")),
    ];
    const bad = mod ? mod.broken() : 0;
    if (bad) rows.push(gi(ico("alert", "w-ico-bad"), '<span class="w-bad">' + tn(bad, "{n} record would not open", "{n} records would not open") + "</span>",
      t("They were changed by someone without the key, such as whoever runs the server. Wally leaves them out and keeps everything else.")));
    if (/iPhone|iPad/.test(navigator.userAgent) && !navigator.standalone) rows.push(gi(ico("phone"), t("Add Wally to your Home Screen"), t("Safari clears what a website keeps after seven days without a visit. From the Home Screen, Wally keeps it.")));
    html += group(t("This browser"), rows);

    const c = check;
    const clean = c && !c.plain_rows && !c.plain_backups.length && !c.leftover_files.length;
    html += group(t("On the server"), [
      gi(ico(clean ? "check" : "alert", clean ? "" : "w-ico-bad"), c === null ? t("Checking…") : clean ? t("Nothing in the clear") : t("Some data is still in the clear"),
        c === null ? "" : clean ? tn(c.records, "{n} encrypted record. The server can’t open any of them.", "{n} encrypted records. The server can’t open any of them.")
          : [c.plain_rows ? tn(c.plain_rows, "{n} row in Wally’s database.", "{n} rows in Wally’s database.") : "", c.plain_backups.length ? tn(c.plain_backups.length, "{n} backup from before.", "{n} backups from before.") : "", c.leftover_files.length ? t("A file left from turning encryption on.") : ""].filter(Boolean).join(" "),
        linkBtn(t("Check again"), ' data-act="check" data-k="check"')),
      gi(ico("info"), t("What the server can see"), t("People’s names, sign-ins, settings, how many records there are and when they change. Not one amount, name or category.")),
    ]);
  } else if (signin) {
    html += group(t("How it works"), [
      gi(ico("lock"), t("Your password is the key"), t("The household password opens the data on your devices. The server never sees it.")),
      gi(ico("file"), t("A new Emergency Kit"), t("Turning it on makes a new one for the household, to print and keep. The old one stops working.")),
      gi(ico("alert"), t("What changes"), t("API keys stop working and sign-in can’t be turned off. Whoever runs the server can no longer reset a password.")),
    ]);
  }
  paint(box, html);
}

async function onClick(ev) {
  if (ev.target.closest("#pv-toggle:not([disabled])")) return V().on ? turnOff() : turnOn();
  if (ev.target.closest("#pv-lock")) {
    const s = await vs(), on = !s.lockOnClose();
    await s.setLockOnClose(on);
    toast(on ? t("Wally locks when it closes on this browser") : t("Wally stays unlocked on this browser"));
    return render();
  }
  const b = ev.target.closest("[data-act]");
  if (!b) return;
  if (b.dataset.act === "signin") return openPane("signin");
  if (b.dataset.act === "check") { check = null; render(); return load(); }
}

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

function turnOn() {
  const list = (backups || []);
  openDialog({
    title: t("Turn on end-to-end encryption?"),
    body: "<p>" + t("Everything is encrypted on this browser before it’s stored. The server keeps only what it can’t read.") + "</p>" +
      '<ul class="w-slist">' +
      "<li>" + t("You get a new Emergency Kit, and the old one stops working. It’s the only way back in if you forget the password: whoever runs the server can’t help any more.") + "</li>" +
      "<li>" + t("Everyone keeps signing in with the same password. Other browsers ask for it once, to unlock.") + "</li>" +
      "<li>" + t("API keys stop working, and sign-in can’t be turned off.") + "</li>" +
      "<li>" + t("Wally is read-only for everyone for about a minute.") + "</li>" +
      (list.length ? "<li>" + tn(list.length, "The {n} backup on the server is in the clear, so it’s deleted. Download it first if you want it:", "The {n} backups on the server are in the clear, so they’re deleted. Download them first if you want them:") +
        ' <span class="w-sbackups">' + list.map((b) => '<a href="/api/backups/' + encodeURIComponent(b.name) + '" download>' + esc(b.name) + " · " + size(b.size) + "</a>").join("") + "</span></li>" : "") +
      "</ul>" +
      field(t("Password"), passwordInput("pv-pw", "current-password")) +
      '<p class="w-hint" id="pv-progress" aria-live="polite" hidden></p>',
    ok: t("Turn on encryption"),
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

function turnOff() {
  const word = t("turn off");
  openDialog({
    title: t("Turn off encryption?"),
    body: "<p>" + t("This browser opens everything and stores it on the server in the clear, where whoever runs it can read it.") + "</p>" +
      "<p>" + t("The password stays the same. The Emergency Kit stops working: Wally gives you a new one. The encrypted copy is kept as a backup.") + "</p>" +
      field(t("Password"), passwordInput("pv-pw", "current-password")) +
      field(t("Type “{word}” to confirm", { word }), '<div class="w-input"><input id="pv-word" autocomplete="off" spellcheck="false"></div>') +
      '<p class="w-hint" id="pv-progress" aria-live="polite" hidden></p>',
    ok: t("Turn off encryption"),
    danger: true,
    onOk: async (root) => {
      const pw = root.querySelector("#pv-pw").value;
      // The word in this language, or in English, whatever the keyboard makes easier
      const typed = root.querySelector("#pv-word").value.trim().normalize("NFC").toLocaleLowerCase(core.LANG);
      if (typed !== word.normalize("NFC").toLocaleLowerCase(core.LANG) && typed !== "turn off") throw new Error(t("Type “{word}” to confirm.", { word }));
      if (!pw) throw new Error(t("Enter your password first."));
      const s = await vs();
      try { await s.turnOff(pw, progress(root)); }
      catch (e) { const p = root.querySelector("#pv-progress"); if (p) p.hidden = true; throw e; }
      toast(t("Encryption is off"));
      setTimeout(() => location.reload(), 600);
    },
  });
}

/* The recovery key, once: print it, download it or copy it, and say it's saved */
export async function showKit(key, then) {
  const kit = await import("../../vault/kit.js");
  const qr = await kit.qrSvg(key);
  openDialog({
    title: t("Save the household’s Emergency Kit"),
    body: "<p>" + t("If you forget the password or can’t get a two-step code, this recovery key gets you back in. Wally keeps no copy it can read, so it can’t show it again.") + "</p>" +
      '<div class="w-kit">' + qr + kit.keyGroups(key) + "</div>" +
      '<div class="w-inline"><button type="button" class="w-btn ghost" data-print>' + t("Print or save as PDF") + '</button><button type="button" class="w-btn ghost" data-save>' + t("Download") + '</button><button type="button" class="w-btn ghost" data-copy>' + t("Copy") + "</button></div>" +
      '<label class="w-scheck"><input type="checkbox" id="kit-saved"> ' + t("I saved it somewhere safe") + "</label>",
    ok: t("Done"),
    noCancel: true,
    sticky: true,
    onOpen: (root) => {
      const ok = root.querySelector("[data-dlg-ok]");
      if (ok) ok.disabled = true;
      root.querySelector("#kit-saved").addEventListener("change", (ev) => { if (ok) ok.disabled = !ev.target.checked; });
      root.querySelector("[data-print]").addEventListener("click", () => kit.printKit(key));
      root.querySelector("[data-save]").addEventListener("click", () => download("wally-emergency-kit.txt", kit.kitText(key)));
      root.querySelector("[data-copy]").addEventListener("click", () => copyText(key, t("Recovery key copied")));
    },
    onOk: () => { if (then) then(); },
  });
}

export { ago };
