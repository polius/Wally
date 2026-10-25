/* Transactions: changing them. Delete with Undo, bulk changes with Undo, CSV export and saved views.
   Every change updates the ledger held in the browser and then calls refresh(). */
import { state, t, tn, esc, f, GET, PUT, POST, DEL, toApi, upsertTx, removeTx, reloadLedger, pname, person, TODAY } from "../../core.js";
import { toast, errorToast, confirmDialog } from "../../ui.js";
import { refresh } from "../../shell.js";

/* Run async jobs a few at a time */
async function pool(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

/* What POST /transactions/restore needs to put a transaction back as it was, with its id.
   The ledger only says whether a row was imported; the bank reference is fetched before deleting. */
async function restoreBodies(list) {
  const refs = {};
  await pool(list.filter((x) => x.im), 8, async (x) => {
    try { const r = await GET("/transactions/id/" + x.id); if (r && r[0]) refs[x.id] = r[0].import_ref || null; } catch (e) { /* restored without it */ }
  });
  return list.map((x) => Object.assign(toApi(x), {
    id: x.id, recurringID: x.rid || "", group_id: x.gr || null, source: x.src || null,
    created_by: x.cb === null || x.cb === undefined ? null : Number(x.cb), import_ref: refs[x.id] || null,
  }));
}
async function restore(bodies, selectId) {
  upsertTx(await POST("/transactions/restore", bodies));
  refresh({ restored: selectId || true });
}

/* One transaction deletes straight away, with Undo. onUndo(id) runs after it is back. */
export async function deleteTx(x, onUndo) {
  // Not sent yet: it only lives on this device, in the add sheet's queue
  if (x.pending) {
    const { dequeue } = await import("../../add/queue.js");
    dequeue(x.gr || x.id);
    removeTx([x.id]);
    refresh({ deleted: [x.id] });
    toast(t("Deleted {name}, {amount}", { name: x.n || x.c, amount: f(x.a) }));
    return;
  }
  try {
    const bodies = await restoreBodies([x]);
    await DEL("/transactions/" + x.id);
    removeTx([x.id]);
    refresh({ deleted: [x.id] });
    toast(t("Deleted {name}, {amount}", { name: x.n || x.c, amount: f(x.a) }), async () => { await restore(bodies, x.id); if (onUndo) onUndo(x.id); });
  } catch (e) { errorToast(e); }
}

/* Several ask first */
export async function bulkDelete(list) {
  list = list.filter((x) => !x.pending);  // waiting to send: changed from the add sheet
  if (!list.length) return false;
  if (list.length > 1) {
    const total = list.reduce((s, x) => s + x.a, 0);
    const ok = await confirmDialog(esc(tn(list.length, "Delete {n} transaction?", "Delete {n} transactions?")),
      esc(t("{amount} in total. You can undo for a few seconds afterwards.", { amount: f(total) })), esc(t("Delete {n}", { n: list.length })), true);
    if (!ok) return false;
  }
  try {
    const bodies = await restoreBodies(list);
    const ids = list.map((x) => x.id);
    await POST("/transactions/bulk", { ids, action: "delete" });
    removeTx(ids);
    refresh({ deleted: ids });
    toast(tn(list.length, "Deleted {n} transaction", "Deleted {n} transactions"), () => restore(bodies));
    return true;
  } catch (e) { errorToast(e); return false; }
}

/* Change the category of the expenses picked. Undo puts each one back. */
export async function bulkCategory(list, category) {
  list = list.filter((x) => !x.pending);  // waiting to send: changed from the add sheet
  const exp = list.filter((x) => x.type === "expense" && x.c !== category);
  if (!exp.length) { toast(t("Nothing to change: income keeps its category")); return; }
  const before = {};
  exp.forEach((x) => { (before[x.c] = before[x.c] || []).push(x.id); });
  try {
    await POST("/transactions/bulk", { ids: exp.map((x) => x.id), action: "update", category });
    await reloadLedger();
    refresh({ bulk: true });
    toast(tn(exp.length, "Moved {n} to {category}", "Moved {n} to {category}", { category }), async () => {
      await pool(Object.entries(before), 4, ([c, ids]) => POST("/transactions/bulk", { ids, action: "update", category: c }));
      await reloadLedger();
      refresh({ bulk: true });
    });
  } catch (e) { errorToast(e); }
}

/* Give the transactions picked to one person, or share them evenly ("shared") */
export async function bulkPerson(list, key) {
  list = list.filter((x) => !x.pending);  // waiting to send: changed from the add sheet
  const target = key === "shared" ? null : key;
  const change = list.filter((x) => x.p !== target || (target === null && x.shc));
  if (!change.length) { toast(t("Nothing to change")); return; }
  const originals = change.map((x) => Object.assign({}, x));
  try {
    await POST("/transactions/bulk", { ids: change.map((x) => x.id), action: "update", person_id: target === null ? null : Number(target), set_person: true });
    await reloadLedger();
    refresh({ bulk: true });
    const who = target === null ? t("shared") : pname(target);
    toast(tn(change.length, "Set {n} to {who}", "Set {n} to {who}", { who }), async () => {
      // Personal ones go back in one call per person; shared ones keep their own shares and payer
      const mine = {};
      originals.filter((x) => x.p !== null).forEach((x) => { (mine[x.p] = mine[x.p] || []).push(x.id); });
      await pool(Object.entries(mine), 4, ([p, ids]) => POST("/transactions/bulk", { ids, action: "update", person_id: Number(p), set_person: true }));
      await pool(originals.filter((x) => x.p === null), 6, (x) => PUT("/transactions/" + x.id, toApi(x)));
      await reloadLedger();
      refresh({ bulk: true });
    });
  } catch (e) { errorToast(e); }
}

/* ---------- CSV ---------- */
const COLUMNS = ["date", "name", "category", "amount", "type", "tags", "person", "paid_by", "shares", "note"];
function cell(v) {
  let s = String(v == null ? "" : v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // a spreadsheet must not run it as a formula
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export function csvOf(list) {
  const lines = [COLUMNS.join(",")];
  for (const x of list) {
    const shares = x.shc ? Object.entries(x.shc).map(([k, c]) => pname(k) + " " + (c / 100).toFixed(2)).join("; ") : "";
    lines.push([
      x.d, x.n, x.c, x.a.toFixed(2), x.type, x.tags.join(" "), x.p === null ? "Shared" : pname(x.p),
      x.p === null && x.by !== null && person(x.by) ? pname(x.by) : "", shares, x.note,
    ].map(cell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
export function exportCsv(list) {
  if (!list.length) { toast(t("Nothing to export")); return; }
  const blob = new Blob(["﻿" + csvOf(list)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "wally-transactions-" + TODAY + ".csv";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast(tn(list.length, "Exported {n} transaction as CSV", "Exported {n} transactions as CSV"));
}

/* ---------- saved views ---------- */
export function views() { return Array.isArray(state.config.saved_views) ? state.config.saved_views : []; }
async function putViews(list) { state.config = await PUT("/config", { saved_views: list }); refresh({ views: true }); }
export async function saveView(name, query) {
  await putViews(views().filter((v) => v.name !== name).concat([{ name, query }]));
  toast(t("Saved the view “{name}”", { name }));
}
export async function deleteView(i) {
  const list = views().slice(), gone = list.splice(i, 1)[0];
  if (!gone) return;
  try {
    await putViews(list);
    toast(t("Deleted the view “{name}”", { name: gone.name }), async () => {
      const now = views().slice();
      now.splice(Math.min(i, now.length), 0, gone);
      await putViews(now);
    });
  } catch (e) { errorToast(e); }
}
