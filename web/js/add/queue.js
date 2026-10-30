/* The offline queue: a new transaction saved while Wally can't be reached is kept on this device,
   shown as "Waiting to send", and sent when the connection comes back. */
import { $, t, tn, state, POST, uid, fromApi, upsertTx, icon, esc } from "../core.js";
import { toast } from "../ui.js";
import { refresh } from "../shell.js";

const KEY = "wally.queue";
let busy = false, again = false, timer = null;

export function queued() { try { return JSON.parse(localStorage.getItem(KEY) || "[]") || []; } catch (e) { return []; } }
function store(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { /* this browser keeps nothing */ } }

/* item: {qid, kind:"tx"|"group", body (one transaction, or the parts of a receipt), at} */
export function enqueue(kind, body, qid) {
  const list = queued().filter((x) => x.qid !== qid);
  const item = { qid: qid || "q-" + uid(), kind, body, at: new Date().toISOString() };
  list.push(item);
  store(list);
  showRows();
  return item;
}
export function dequeue(qid) { store(queued().filter((x) => x.qid !== qid)); showRows(); }
export function queueItem(qid) { return queued().find((x) => x.qid === qid) || null; }

/* Waiting entries appear in the ledger, marked pending, so every figure counts them */
function rowsOf(item) {
  const parts = item.kind === "group" ? item.body : [item.body];
  return parts.map((b, i) => {
    const row = fromApi(Object.assign({}, b, {
      id: item.qid + (item.kind === "group" ? "-" + i : ""), recurringID: "", created_by: state.me === null ? null : Number(state.me),
      created_date: item.at, group_id: item.kind === "group" ? item.qid : null,
    }));
    row.pending = true;
    row.qid = item.qid;
    return row;
  });
}
function showRows() {
  const list = queued();
  state.tx = state.tx.filter((x) => !x.pending);
  const rows = [].concat(...list.map(rowsOf));
  state.tx.push(...rows);
  upsertTx([]); // sorts the ledger again
  renderPill(list);
  clearInterval(timer);
  if (list.length) timer = setInterval(flushQueue, 30000);
}

/* Send what is waiting. Stops at the first sign the connection is still down. */
export async function flushQueue() {
  // Already sending (a retry, say) when the device comes back online: go again right after
  if (busy) { again = true; return; }
  let list = queued();
  if (!state.status) return;
  showRows();
  if (!list.length) return;
  busy = true;
  const sent = [], failed = [];
  try {
    for (const item of list) {
      try {
        const res = item.kind === "group" ? await POST("/transactions/group", item.body) : await POST("/transactions", item.body);
        sent.push(res);
        dequeue(item.qid);
      } catch (e) {
        if (e.status === 0) break;
        // Wally refused it (a category or person that no longer exists): say so and let it go
        failed.push([item, e]);
        dequeue(item.qid);
      }
    }
  } finally {
    busy = false;
    if (again) { again = false; setTimeout(flushQueue, 0); }
  }
  if (!sent.length && !failed.length) return;
  showRows();
  sent.forEach((r) => upsertTx(r));
  refresh({ tx: true });
  if (failed.length) {
    const [item, e] = failed[0];
    const b = item.kind === "group" ? item.body[0] : item.body;
    toast(t("{name} couldn’t be sent: {reason}", { name: b.name || b.category, reason: e.message }));
  } else {
    toast(tn(sent.length, "Sent {n} transaction that was waiting", "Sent {n} transactions that were waiting"));
  }
}

/* A small note at the bottom of the screen while something waits */
function renderPill(list) {
  let pill = $("add-queue");
  if (!list.length) { if (pill) pill.remove(); return; }
  if (!pill) {
    pill = document.createElement("div");
    pill.id = "add-queue";
    pill.className = "w-queue";
    pill.setAttribute("role", "status");
    document.body.appendChild(pill);
    pill.addEventListener("click", (ev) => { if (ev.target.closest("[data-send]")) flushQueue(); });
  }
  pill.innerHTML = icon("history") + "<span>" + esc(tn(list.length, "{n} waiting to send", "{n} waiting to send")) + '</span><button type="button" class="w-link" data-send>' + t("Send now") + "</button>";
}

export function initQueue() {
  window.addEventListener("online", flushQueue);
}
