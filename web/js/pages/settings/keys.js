/* Settings › API keys: create (shown once), list with owner and last use, delete;
   and how to add from a phone's lock screen with an iOS Shortcut or Android HTTP Shortcuts. */
import { t, esc, state, GET, POST, DEL, pname, expCats, icon, TODAY } from "../../core.js";
import { openDialog, toast, errorToast, empty } from "../../ui.js";
import { refresh } from "../../shell.js";
import { group, gi, ico, trashBtn, parseUtc, dayLabel, ago, copyText, counts, paint } from "./common.js";

let box = null;
let keys = null;
let failed = null;

export function mount(el) {
  box = el;
  box.addEventListener("click", onClick);
  box.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && ev.target.id === "key-name") { ev.preventDefault(); create(); } });
  render();
  load();
}
export function update() { if (box) render(); }
export function unmount() { box = null; }

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

function render() {
  const signin = state.status && state.status.signin;
  let rows;
  if (keys === null) rows = ['<div class="w-skel"><i></i><i style="width:60%"></i></div>'];
  else if (failed) rows = [empty("alert", t("API keys can’t be listed"), esc(failed))];
  else rows = keys.map((k) => {
    const used = parseUtc(k.last_used), made = parseUtc(k.created_at);
    const parts = ["<code>" + esc(k.prefix) + "…</code>", esc(pname(k.person_id)), t("created {date}", { date: made ? dayLabel(made) : "" }), used ? t("last used {when}", { when: ago(used) }) : t("never used")];
    return gi(ico("key"), esc(k.name || t("Unnamed key")), parts.join(" · "), trashBtn(t("Delete {name}", { name: k.name || t("Unnamed key") }), ' data-act="delete" data-id="' + esc(k.id) + '" data-k="del:' + esc(k.id) + '"'));
  });
  if (keys && !keys.length && !failed) rows = [empty("key", t("No API keys yet"), t("A key lets a script, a spreadsheet or a phone shortcut add and read transactions."))];
  rows.push('<div class="w-gi w-gadd"><span class="w-ico">' + icon("plus") + '</span><div class="w-inline"><input class="w-mini w-addin" id="key-name" placeholder="' + esc(t("What is this key for?")) +
    '" aria-label="' + esc(t("Key name")) + '" maxlength="60" autocomplete="off"></div><button type="button" class="w-btn ghost" data-act="create" data-k="create">' + t("Create key") + "</button></div>");
  const example = 'curl -H "X-API-Key: wly_…" \\\n  "' + location.origin + "/api/transactions/between?from=" + TODAY.slice(0, 8) + "01&to=" + TODAY + '"';
  paint(box,
    (signin ? "" : '<div class="w-explain"><p>' + t("Sign-in is off, so anyone who can reach Wally can use the API, with or without a key. A key still tells Wally who added what. Turn on sign-in in {link} to require one.",
      { link: '<a class="w-link" href="/settings/signin" data-pane="signin">' + t("Sign-in") + "</a>" }) + "</p></div>") +
    group(t("API keys"), rows, t("A key is shown once, when it is created")) +
    '<div class="w-sgroup"><div class="w-glabel"><span>' + t("Using a key") + '</span><span><a class="w-link" href="/api/docs" target="_blank" rel="noopener">' + t("Open API docs (/api/docs)") + "</a></span></div>" +
    '<pre class="w-code">' + esc(example) + "</pre></div>" +
    group(t("Add from your phone’s lock screen"), [
      gi(ico("phone"), t("iPhone: Shortcut"), t("Asks for amount and name, then sends it to Wally with your key. Add it to the lock screen or the Action button."),
        '<button type="button" class="w-btn ghost" data-act="ios" data-k="ios">' + t("Show steps") + "</button>"),
      gi(ico("phone"), t("Android: HTTP Shortcuts"), t("A home screen or lock screen shortcut with the free HTTP Shortcuts app. Wally shows the request to paste."),
        '<button type="button" class="w-btn ghost" data-act="android" data-k="android">' + t("Show request") + "</button>"),
    ]));
}

async function onClick(ev) {
  const b = ev.target.closest("[data-act]");
  if (!b || b.disabled) return;
  if (b.dataset.act === "create") return create();
  if (b.dataset.act === "delete") return remove(b.dataset.id);
  if (b.dataset.act === "ios") return steps("ios");
  if (b.dataset.act === "android") return steps("android");
}

async function create() {
  const input = box.querySelector("#key-name");
  const name = input.value.trim();
  if (!name) { toast(t("Say what the key is for first")); input.focus(); return; }
  try {
    const k = await POST("/api-keys", { name });
    await load();
    openDialog({
      title: t("Copy your new key"),
      body: "<p>" + t("It is shown only this once. Put it where the tool that uses it can read it.") + "</p>" +
        '<div class="w-keybox"><code id="key-raw">' + esc(k.key) + '</code><button type="button" class="w-btn ghost" data-copy>' + icon("copy") + t("Copy") + "</button></div>",
      ok: t("Done"),
      noCancel: true,
      onOpen: (root) => root.querySelector("[data-copy]").addEventListener("click", () => copyText(k.key, t("Key copied"))),
    });
  } catch (e) { errorToast(e); }
}

function remove(id) {
  const k = keys.find((x) => x.id === id);
  if (!k) return;
  openDialog({
    title: t("Delete {name}?", { name: esc(k.name || t("Unnamed key")) }),
    body: "<p>" + t("Anything using it stops working. This can’t be undone: a new key would be different.") + "</p>",
    ok: t("Delete key"),
    danger: true,
    onOk: async () => {
      await DEL("/api-keys/" + encodeURIComponent(id));
      await load();
      toast(t("Deleted {name}. Anything using it stops working.", { name: k.name || t("Unnamed key") }));
    },
  });
}

function steps(kind) {
  const ios = kind === "ios";
  const req = request(ios ? [t("Amount"), t("Name")] : ["{amount}", "{name}"]);
  const list = ios
    ? [t("Create a key above, and copy it."), t("In the Shortcuts app, make a new shortcut. Add “Ask for Input” for a number, with the prompt Amount, and another for text, with the prompt Name."),
      t("Add “Get Contents of URL”. Set the method to POST, add the header X-API-Key with your key, and a JSON body with the fields below. Use the two answers for amount and name."),
      t("Add the shortcut to the lock screen as a widget, or to the Action button.")]
    : [t("Create a key above, and copy it."), t("In HTTP Shortcuts, create a regular shortcut. Add two variables, amount and name, that ask for a value every time."),
      t("Paste the request below: the method, the address, the two headers and the body. Replace “your key” with your key."),
      t("Add the shortcut to the home screen, or to quick settings.")];
  openDialog({
    title: ios ? t("Add from an iPhone") : t("Add from an Android phone"),
    wide: true,
    body: '<ol class="w-steps2">' + list.map((s) => "<li>" + s + "</li>").join("") + "</ol>" +
      '<pre class="w-code" id="sc-req">' + esc(req) + "</pre>" +
      '<button type="button" class="w-btn ghost w-scopy" data-copy>' + icon("copy") + t("Copy the request") + "</button>",
    ok: t("Done"),
    noCancel: true,
    onOpen: (root) => root.querySelector("[data-copy]").addEventListener("click", () => copyText(req, t("Request copied"))),
  });
}
