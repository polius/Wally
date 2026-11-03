/* Settings › API keys: the keys (each opens its page, with Delete), creating one (shown once), how to add from a
   phone's lock screen with an iOS Shortcut or Android HTTP Shortcuts, and how to use a key. */
import * as core from "../../core.js";
import { t, esc, state, num, GET, POST, DEL, pname, expCats, icon, TODAY } from "../../core.js";
import { openDialog, toast, errorToast, empty, seg as uiSeg } from "../../ui.js";
import { refresh } from "../../shell.js";
import { gl, gr, addRow, hero, sico, gate, phone, val, parseUtc, dayLabel, ago, copyText, counts, paint } from "./common.js";
import { setAction, openPane } from "../settings.js";

let box = null;
let sub = "";        // "" for the list, or a key's id for its page
let keys = null;
let failed = null;

export function mount(el, s) {
  box = el;
  sub = s || "";
  box.addEventListener("click", onClick);
  render();
  load();
}
export function show(s) { sub = s || ""; render(); }
export function update() { if (box) render(); }
export function unmount() { box = null; }
export function meta(s) { return s ? { title: "" } : {}; }

async function load() {
  try { keys = await GET("/api-keys"); failed = null; counts.keys = keys.length; } catch (e) { keys = []; failed = e.message; }
  if (box) refresh({ keys: true });
}

/* What a phone shortcut sends: amount and name asked each time, the rest fixed */
function shortcutBody() {
  const misc = state.categories.find((c) => /^misc/i.test(c)) || expCats()[0] || "Miscellaneous";
  const body = { amount: "AMOUNT", name: "NAME", category: misc, type: "expense" };
  if (state.me) body.person_id = Number(state.me);
  return body;
}
function request(placeholders) {
  const body = JSON.stringify(shortcutBody(), null, 2).replace('"AMOUNT"', '"' + placeholders[0] + '"').replace('"NAME"', '"' + placeholders[1] + '"');
  return "POST " + location.origin + "/api/transactions\nX-API-Key: " + t("your key") + "\nContent-Type: application/json\n\n" + body;
}

const sealed = () => !!(state.status && state.status.vault && state.status.vault.on);
const keyName = (k) => k.name || t("Unnamed key");
const can = (k) => (k.scope === "read" ? t("Read only") : t("Read and write"));
const keyPic = (big) => '<span class="w-sico' + (big ? " w-sico48" : "") + '">' + icon("key") + "</span>";
/* A sheet's header, as in Sign-in & Privacy: the picture, a 20px title, one sentence */
const sheetTop = (ico, title, text) => '<span class="w-secico">' + icon(ico) + '</span><b class="w-shtitle w-sht20">' + title + '</b><p class="w-mw360">' + text + "</p>";
const scopeNote = (scope) => (scope === "read" ? t("It can read what’s in Wally, but not change anything.") : t("It can read what’s in Wally and change it, like adding transactions."));

function render() {
  if (!box) return;
  setAction("");
  const v = (state.status && state.status.vault) || {};
  if (v.api_keys === false) {
    // WALLY_ENCRYPTION=required: a key would let the server open the data while a call runs
    paint(box, gl([gr({ lead: sico("shield"), k: t("Off on this server"), sub: t("Whoever runs this server chose that it can never read your household’s data, and a key would let it while a call runs.") })]));
    return;
  }
  if (sub) return renderKey();
  const signin = state.status && state.status.signin;
  let rows;
  if (keys === null) rows = ['<div class="w-gr"><div class="w-skel"><i></i><i style="width:60%"></i></div></div>'];
  else if (failed) rows = ['<div class="w-gr w-gempty">' + empty("alert", t("API keys can’t be listed"), esc(failed)) + "</div>"];
  else rows = keys.map((k) => {
    const used = parseUtc(k.last_used);
    return gr({ tag: "a", href: "/settings/keys/" + encodeURIComponent(k.id), attrs: ' data-pane="keys/' + encodeURIComponent(k.id) + '" data-act="key" data-k="key:' + esc(k.id) + '"', lead: keyPic(), k: esc(keyName(k)),
      sub: '<code class="w-kpre">' + esc(k.prefix) + "…</code> · " + can(k) + " · " + (used ? t("last used {when}", { when: ago(used) }) : t("never used")), chev: true });
  });
  rows.push(addRow(t("Create a key…"), "create", ' data-k="create"'));
  // On a phone the address breaks where it reads well (the spans only show there); copying isn't offered
  const brk = '<span class="w-mbr">\n  </span>';
  const example = esc('curl -H "X-API-Key: wly_…" \\\n  "' + location.origin + "/api/transactions") + brk + esc("/between?from=" + TODAY.slice(0, 8) + "01") + brk + esc("&to=" + TODAY + '"');
  paint(box,
    gl(rows, t("Keys"), t("A key lets a script, a spreadsheet or a phone shortcut add and read transactions. It’s shown once, when it’s created.")) +
    (signin ? "" : '<p class="w-glf w-glf2">' + t("Sign-in is off, so anyone who can reach Wally can use the API. {link} to require a key.",
      { link: '<a class="w-link" href="/settings/security" data-pane="security">' + t("Turn on sign-in") + "</a>" }) + "</p>") +
    gl([gr({ lead: sico("phone"), k: t("iPhone: Shortcut"), sub: t("Asks for amount and name, then sends it to Wally."), chev: true, act: "ios", attrs: ' data-k="ios"' }),
      gr({ lead: sico("phone"), k: t("Android: HTTP Shortcuts"), sub: t("A home or lock screen shortcut, with the free app."), chev: true, act: "android", attrs: ' data-k="android"' })], t("Add from your phone’s lock screen")) +
    '<div class="w-glh w-glh2"><span>' + t("Using a key") + '</span><a href="/api/docs" target="_blank" rel="noopener">' + t("API docs") + "</a></div>" +
    '<pre class="w-code">' + example + "</pre>");
}

/* A key's own page: what it can do, whose it is, when it was used; delete */
function renderKey() {
  if (keys === null) { paint(box, ""); return; }
  const k = keys.find((x) => String(x.id) === sub);
  if (!k) { openPane("keys"); return; }
  const used = parseUtc(k.last_used), made = parseUtc(k.created_at);
  paint(box, hero(keyPic(), esc(keyName(k)), '<code class="w-kpre">' + esc(k.prefix) + "…</code>") +
    gl([gr({ k: t("Can"), v: can(k) }), gr({ k: t("Who"), v: esc(pname(k.person_id)) }), gr({ k: t("Created"), v: made ? dayLabel(made) : "" }), gr({ k: t("Last used"), v: used ? ago(used) : t("never") })]) +
    gl([gr({ k: t("Delete key"), cls: "red", act: "delete", attrs: ' data-id="' + esc(k.id) + '" data-k="delete"' })]));
}

async function onClick(ev) {
  const b = ev.target.closest("[data-act]");
  if (!b || b.disabled) return;
  if (b.dataset.act === "create") return create();
  if (b.dataset.act === "delete") return remove(b.dataset.id);
  if (b.dataset.act === "ios") return steps("ios");
  if (b.dataset.act === "android") return steps("android");
}

/* A sheet: what it's for and what it can do. Encrypted, it also needs the password: the browser makes
   the key and locks the household key under it. */
const MAX_KEYS = 5;   // each person's, as the server allows
function create() {
  let scope = "write";
  const full = (keys || []).filter((k) => String(k.person_id) === String(state.me)).length >= MAX_KEYS;
  openDialog({
    kind: "sheet",
    title: t("New Key"),
    top: sheetTop("key", t("API key"), t("A key lets a script, a spreadsheet or a phone shortcut add and read transactions. It’s shown once, when it’s created.")),
    body: '<div class="w-gl"><label class="w-gr"><input id="key-name" placeholder="' + esc(t("What is this key for?")) + '" aria-label="' + esc(t("Key name")) + '" maxlength="60" autocomplete="off" autofocus></label>' +
      '<div class="w-gr"><span class="k">' + t("Can") + "</span>" + uiSeg("key-scope", [["write", t("Read and write")], ["read", t("Read only")]], scope, t("What the key can do"), "sm") + "</div></div>" +
      '<p class="w-glf" id="key-scopef">' + scopeNote(scope) + "</p>" +
      (full ? '<p class="w-glf w-keyfull">' + t("You have {n} keys, the most each person can have. Delete one first.", { n: num(MAX_KEYS) }) + "</p>" : "") +
      (sealed() ? '<div class="w-gl"><label class="w-gr"><input type="password" id="key-pw" placeholder="' + esc(t("Household password")) + '" aria-label="' + esc(t("Household password")) + '" autocomplete="current-password"></label></div>' +
        '<p class="w-glf">' + t("Wally is encrypted. While a call made with this key runs, the server opens the data it needs, then forgets it.") + "</p>" : ""),
    ok: t("Create"),
    onOpen: (root) => {
      gate(root, (r) => !full && !!val(r, "key-name") && (!sealed() || !!(r.querySelector("#key-pw") || {}).value));
      root.addEventListener("click", (ev) => {
        const s2 = ev.target.closest("#key-scope [data-v]");
        if (!s2) return;
        scope = s2.dataset.v;
        root.querySelectorAll("#key-scope [data-v]").forEach((x) => x.setAttribute("aria-pressed", String(x === s2)));
        root.querySelector("#key-scopef").textContent = scopeNote(scope);
      });
    },
    onOk: async (root) => {
      const name = val(root, "key-name");
      if (!name) throw new Error(t("Say what the key is for first"));
      let k;
      if (sealed()) {
        const pw = root.querySelector("#key-pw").value;
        if (!pw) throw new Error(t("Enter your password first."));
        const s2 = await import("../../vault/session.js");
        s2.bind(core);
        k = await s2.makeApiKey(pw, name, scope);
      } else k = await POST("/api-keys", { name, scope });
      setTimeout(() => showKey(k, name), 0);
    },
  });
}

async function showKey(k, name) {
  await load();
  const half = Math.ceil(k.key.length / 2);
  openDialog({
    kind: "sheet",
    title: "",
    top: sheetTop("key", t("“{name}” Key", { name: esc(name || k.name || "") }), t("It’s shown only this once. Put it where the tool that uses it can read it.")),
    body: '<div class="w-seckey w-keybox2"><code id="key-raw" translate="no">' + esc(k.key.slice(0, half)) + "<wbr>" + esc(k.key.slice(half)) + "</code></div>" +
      '<div class="w-secbtns"><button type="button" class="w-btn ghost" data-copy>' + icon("copy") + t("Copy key") + "</button></div>",
    ok: t("Done"),
    noCancel: true,
    onOpen: (root) => root.querySelector("[data-copy]").addEventListener("click", () => copyText(k.key, t("Key copied"))),
  });
}

function remove(id) {
  const k = keys.find((x) => String(x.id) === String(id));
  if (!k) return;
  openDialog({
    kind: "alert",
    top: keyPic(true),
    title: t("Delete “{name}”?", { name: esc(keyName(k)) }),
    body: "<p>" + (parseUtc(k.last_used) ? t("It was last used {when}. Anything using it stops working, and this can’t be undone.", { when: ago(parseUtc(k.last_used)) })
      : t("It has never been used. This can’t be undone.")) + "</p>",
    ok: phone() ? t("Delete Key") : t("Delete"),
    danger: true,
    onOk: async () => {
      await DEL("/api-keys/" + encodeURIComponent(id));
      await load();
      toast(t("Deleted {name}. Anything using it stops working.", { name: keyName(k) }));
      openPane("keys");
    },
  });
}

/* The steps to add from a phone's lock screen, numbered as in Two-step sign-in; the request sits under the step that uses it */
function steps(kind) {
  const ios = kind === "ios";
  const req = request(ios ? [t("Amount"), t("Name")] : ["{amount}", "{name}"]);
  const list = ios
    ? [t("Create a key, and copy it."), t("In Shortcuts, make a new shortcut with two “Ask for Input” actions: a number, Amount, and text, Name."),
      t("Add “Get Contents of URL”: method POST, header X-API-Key with your key, and the body below."),
      t("Add the shortcut to the lock screen as a widget, or to the Action button.")]
    : [t("Create a key, and copy it."), t("In HTTP Shortcuts, create a regular shortcut with two variables, amount and name, that ask every time."),
      t("Paste the request below, and replace “your key” with your key."),
      t("Add the shortcut to the home screen, or to quick settings.")];
  const reqBox = '<pre class="w-code" id="sc-req">' + esc(req) + "</pre>" +
    '<div class="w-secbtns"><button type="button" class="w-btn ghost" data-copy>' + icon("copy") + t("Copy the request") + "</button></div>";
  openDialog({
    kind: "sheet",
    title: ios ? t("iPhone Shortcut") : t("Android Shortcut"),
    body: '<p class="w-shlead">' + (ios ? t("Asks for amount and name, then sends it to Wally.") : t("A home or lock screen shortcut, with the free app.")) + "</p>" +
      list.map((s2, i) => '<div class="w-shstep w-shstep2"><span class="w-shstepn" aria-hidden="true">' + num(i + 1) + "</span><b>" + s2 + "</b></div>" + (i === 2 ? reqBox : "")).join(""),
    ok: t("Done"),
    noCancel: true,
    onOpen: (root) => { root.classList.add("w-sh520", "w-shfull"); root.querySelector("[data-copy]").addEventListener("click", () => copyText(req, t("Request copied"))); },
  });
}
