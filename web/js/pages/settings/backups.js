/* Settings › Backups: nightly copies, backing up by hand, downloading, restoring and deleting. */
import { t, tn, esc, state, GET, POST, PUT, DEL, dlabW, api } from "../../core.js";
import { openDialog, toast, errorToast, empty } from "../../ui.js";
import { refresh } from "../../shell.js";
import { group, gi, ico, linkBtn, trashBtn, toggle, parseLocal, localISO, clock, size, paint } from "./common.js";

let box = null;
let list = null;          // null while loading
let failed = null;
let working = false;

export function mount(el) {
  box = el;
  box.addEventListener("click", onClick);
  box.addEventListener("change", (ev) => { if (ev.target.id === "bk-file" && ev.target.files[0]) { restoreFile(ev.target.files[0]); ev.target.value = ""; } });
  render();
  load();
}
export function update() { if (box) render(); }
export function unmount() { box = null; }

async function load() {
  try { list = await GET("/backups"); failed = null; } catch (e) { failed = e.message; list = []; }
  if (box) render();
}

const KIND = () => ({ auto: [t("Automatic"), "repeat"], manual: [t("Made by hand"), "file"], upgrade: [t("Before an upgrade"), "shield"], restore: [t("Before a restore"), "history"] });
function when(b) { const d = parseLocal(b.created); return d ? t("{day}, {time}", { day: dlabW(localISO(d)), time: clock(d) }) : esc(b.name); }

function render() {
  const nightly = !!state.config.nightly_backup;
  const kinds = KIND();
  let rows;
  if (list === null) rows = ['<div class="w-skel"><i></i><i></i><i style="width:60%"></i></div>'];
  else if (failed) rows = [empty("alert", t("Backups can’t be listed"), esc(failed))];
  else if (!list.length) rows = [empty("file", t("No backups yet"), t("Back up now, or leave nightly backups on and the first one is made tonight at 03:00."))];
  else rows = list.map((b) => {
    const [label, ic] = kinds[b.kind] || kinds.manual;
    const n = esc(b.name);
    return gi(ico(ic), when(b), label + " · " + size(b.size),
      '<span class="w-acts"><a class="w-link" href="/api/backups/' + encodeURIComponent(b.name) + '" download="wally-' + n + '" data-k="dl:' + n + '">' + t("Download") + "</a>" +
      linkBtn(t("Restore"), ' data-act="restore" data-name="' + n + '" data-k="rs:' + n + '"') +
      trashBtn(t("Delete this backup"), ' data-act="delete" data-name="' + n + '" data-k="del:' + n + '"') + "</span>");
  });
  paint(box,
    group(t("Automatic backups"), [
      gi(ico("file"), t("Back up every night at 03:00"), t("Keeps the last 14 nights in the backups folder, next to the database"), toggle("nightly-toggle", nightly, t("Back up every night"))),
      gi(ico("io"), t("Back up now"), t("Makes a copy of the database as it is right now"), '<button type="button" class="w-btn ghost" data-act="now" data-k="now"' + (working ? " disabled" : "") + ">" + t("Back up now") + "</button>"),
      gi(ico("upload"), t("Restore from a file"), t("A backup you downloaded earlier. The data now is backed up first."),
        '<label class="w-btn ghost" data-k="upload">' + t("Choose a file") + '<input type="file" id="bk-file" accept=".db,.sqlite,.sqlite3,application/octet-stream,application/vnd.sqlite3" class="w-vh"></label>'),
    ]) +
    group(t("Backups"), rows, list && list.length ? tn(list.length, "{n} kept", "{n} kept") : ""));
}

async function onClick(ev) {
  if (ev.target.closest("#nightly-toggle")) return setNightly();
  const b = ev.target.closest("[data-act]");
  if (!b || b.disabled) return;
  const name = b.dataset.name;
  if (b.dataset.act === "now") return backupNow();
  if (b.dataset.act === "restore") return restore(list.find((x) => x.name === name));
  if (b.dataset.act === "delete") return remove(list.find((x) => x.name === name));
}

async function setNightly() {
  const on = !state.config.nightly_backup;
  try {
    state.config = await PUT("/config", { nightly_backup: on });
    refresh({ config: true });
    toast(on ? t("Nightly backups on") : t("Nightly backups off. Back up by hand before big changes."));
  } catch (e) { errorToast(e); }
}

async function backupNow() {
  working = true; render();
  try {
    const b = await POST("/backups");
    await load();
    toast(t("Backed up. {size} saved.", { size: size(b.size) }));
  } catch (e) { errorToast(e); }
  working = false;
  if (box) render();
}

/* After a restore everything on screen is out of date, and the sign-in may be too: start again */
function restart() { setTimeout(() => location.assign("/settings/backups"), 1200); }
const AFTER = () => t("Everything added or changed after it is replaced. Wally backs up the current data first, so you can undo this. You may need to sign in again.");

function restore(b) {
  if (!b) return;
  openDialog({
    title: t("Restore the backup from {when}?", { when: when(b) }),
    body: "<p>" + AFTER() + "</p>",
    ok: t("Restore"),
    danger: true,
    onOk: async () => {
      await POST("/backups/" + encodeURIComponent(b.name) + "/restore");
      toast(t("Restored. The data from before is saved as a backup too."));
      restart();
    },
  });
}

function restoreFile(file) {
  openDialog({
    title: t("Restore from {file}?", { file: esc(file.name) }),
    body: "<p>" + AFTER() + "</p>",
    ok: t("Restore"),
    danger: true,
    onOk: async () => {
      const form = new FormData();
      form.append("file", file);
      await api("POST", "/backups/upload", form);
      toast(t("Restored. The data from before is saved as a backup too."));
      restart();
    },
  });
}

function remove(b) {
  if (!b) return;
  openDialog({
    title: t("Delete the backup from {when}?", { when: when(b) }),
    body: "<p>" + t("The file is deleted from the server. This can’t be undone.") + "</p>",
    ok: t("Delete backup"),
    danger: true,
    onOk: async () => {
      await DEL("/backups/" + encodeURIComponent(b.name));
      await load();
      toast(t("Backup deleted"));
    },
  });
}
