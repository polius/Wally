/* This device's copy of an encrypted household: the household keys and the sealed records, kept in
   IndexedDB, opened in memory only. Syncs with the server and saves changes all or nothing.

   Each browser is a device. It keeps the keys (which can be used here but never read out), the
   records as sealed by whoever saved them, and a cursor: the household counter it last saw.
   Opening Wally reads the copy, then asks the server for what changed since the cursor. */
import { open as openRecord, seal } from "./crypto.js";

const DB = "wally-vault";
const LOCK = "wally.lockOnClose";

export const vault = {
  id: null,         // the household's vault id
  person: null,     // whose keys these are
  keys: null,       // {record, id}: CryptoKeys
  recs: new Map(),  // record id → {v, seq, obj}: obj is null for a deleted record
  cursor: 0,
  broken: new Set(),// records that would not open: changed by someone without the key
  ready: false,
  gen: 0,           // raised on every change to recs, so indexes know to rebuild
};
const listeners = [];
export function onRemote(fn) { listeners.push(fn); }

/* ---------- IndexedDB ---------- */
let dbp = null;
function idb() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore("keys");
        d.createObjectStore("records", { keyPath: "id" });
        d.createObjectStore("meta");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { dbp = null; reject(req.error); };
      req.onblocked = () => reject(new Error("Close Wally’s other tabs, then try again."));
    });
  }
  return dbp;
}
function tx(stores, mode, fn) {
  return idb().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(stores, mode);
    let out;
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("Saving on this device was stopped."));
    out = fn(t);
  }));
}
function req(r) { return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }

export function lockOnClose() { try { return localStorage.getItem(LOCK) === "1"; } catch (e) { return false; } }
export function setLockOnClose(on) {
  try { if (on) localStorage.setItem(LOCK, "1"); else localStorage.removeItem(LOCK); } catch (e) { /* fine */ }
  if (vault.keys) return on ? tx(["keys"], "readwrite", (t) => t.objectStore("keys").delete("household")) : saveKeys(vault.keys);
}

/* The keys this device kept, if they are for this household and this person */
export async function loadKeys(vaultId, personId) {
  let got = null;
  try { got = await tx(["keys"], "readonly", (t) => req(t.objectStore("keys").get("household"))); } catch (e) { return null; }
  if (!got || got.vault !== vaultId || String(got.person) !== String(personId)) return null;
  return got;
}
export async function useKeys(keys, vaultId, personId) {
  if (vault.id && (vault.id !== vaultId || String(vault.person) !== String(personId))) await wipe();
  vault.keys = keys; vault.id = vaultId; vault.person = String(personId);
  if (!lockOnClose()) await saveKeys(keys);
  // Ask the browser not to clear this copy when space runs low (Safari's seven days still apply in a tab)
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* fine */ }
}
function saveKeys(keys) {
  return tx(["keys"], "readwrite", (t) => t.objectStore("keys").put({ vault: vault.id, person: vault.person, record: keys.record, id: keys.id, at: Date.now() }, "household"));
}
/* Signed out, the session ended, or encryption turned off: nothing of the household stays here */
export async function wipe() {
  vault.keys = null; vault.id = null; vault.person = null; vault.recs = new Map(); vault.cursor = 0; vault.broken = new Set(); vault.ready = false; vault.gen++;
  try { const d = await dbp; if (d) d.close(); } catch (e) { /* fine */ }
  dbp = null;
  await new Promise((resolve) => { const r = indexedDB.deleteDatabase(DB); r.onsuccess = r.onerror = r.onblocked = () => resolve(); });
}
/* Whether this browser holds anything of an encrypted household, for the sign-out check */
export async function hasCopy() {
  try { return !!(await tx(["keys"], "readonly", (t) => req(t.objectStore("keys").get("household")))); } catch (e) { return false; }
}

/* ---------- reading the copy ---------- */
export async function openCopy() {
  const [rows, cursor] = await tx(["records", "meta"], "readonly", (t) => Promise.all([req(t.objectStore("records").getAll()), req(t.objectStore("meta").get("cursor"))]));
  vault.recs = new Map();
  await openAll(rows || []);
  vault.cursor = cursor || 0;
  vault.ready = true;
}
async function openAll(rows) {
  const out = await Promise.all(rows.map(async (r) => {
    if (!r.ct) return [r, null, true];
    try { return [r, await openRecord(vault.keys, r.id, r.v, r.ct), true]; } catch (e) { return [r, null, false]; }
  }));
  for (const [r, obj, okay] of out) {
    if (!okay) { vault.broken.add(r.id); continue; }
    vault.broken.delete(r.id);
    vault.recs.set(r.id, { v: r.v, seq: r.seq, obj });
  }
  vault.gen++;
}

/* ---------- the server ---------- */
let send = null;   // core.js's api(), without the local routes
export function setTransport(fn) { send = fn; }

/* One thing at a time on this device: a save never runs while the copy is being updated */
let queue = Promise.resolve();
export function serial(fn) {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}

/* What changed since the cursor. Returns how many records changed. */
export function sync() { return serial(syncNow); }
/* For a save that is already running, which holds the queue */
export function syncInside() { return syncNow(); }
async function syncNow() {
  let body;
  try {
    body = await send("GET", "/vault/changes?since=" + vault.cursor, undefined, { raw: true });
  } catch (e) {
    if (e.status !== 410) throw e;
    // Away longer than deletions are kept: start again from nothing
    vault.cursor = 0;
    body = await send("GET", "/vault/changes?since=0", undefined, { raw: true });
  }
  if (body.vault_id && vault.id && body.vault_id !== vault.id) {
    // Encryption was turned off and on again elsewhere: a new household key
    const e = new Error("Encryption was turned on again on another device.");
    e.status = 409;
    throw e;
  }
  const full = vault.cursor === 0;
  const fresh = (body.records || []).filter((r) => { const have = vault.recs.get(r.id); return full || !have || have.v < r.v || vault.broken.has(r.id); });
  if (full) { vault.recs = new Map(); vault.gen++; }
  await openAll(fresh);
  const before = vault.cursor;
  vault.cursor = Math.max(vault.cursor, body.seq || 0);
  if (fresh.length || full || vault.cursor !== before) await persist(fresh, full);
  if (fresh.length && !full) listeners.forEach((fn) => fn(fresh.map((r) => r.id)));
  return fresh.length;
}
async function persist(rows, replace) {
  await tx(["records", "meta"], "readwrite", (t) => {
    const s = t.objectStore("records");
    if (replace) s.clear();
    for (const r of rows) s.put({ id: r.id, v: r.v, seq: r.seq, ct: r.ct });
    t.objectStore("meta").put(vault.cursor, "cursor");
  });
}

/* ---------- saving ---------- */
export class Conflict extends Error {}

/* Seal and save a set of changes, all or none. changes: Map of record id → {obj (null deletes),
   ifAbsent}. Returns {ok: true} or throws Conflict after taking in what the other device saved. */
export async function commit(changes, via) {
  const ops = [];
  const sealed = [];
  for (const [id, c] of changes) {
    const have = vault.recs.get(id);
    const base = have ? have.v : 0;
    if (c.obj === null && (!have || have.obj === null)) continue;
    const ct = c.obj === null ? null : await seal(vault.keys, id, base + 1, c.obj);
    ops.push(c.ifAbsent && !have ? { id, base: 0, ct, if_absent: true } : { id, base, ct });
    sealed.push({ id, base, ct, obj: c.obj });
  }
  if (!ops.length) return { ok: true, empty: true };
  let res;
  try {
    res = via ? await via(ops) : await send("POST", "/vault/batch", { ops });
  } catch (e) {
    if (e.status === 409 && e.detail && e.detail.conflicts) {
      await openAll(e.detail.conflicts);
      throw new Conflict("Changed on another device.");
    }
    throw e;
  }
  const versions = (res && res.versions) || {};
  const skipped = new Set((res && res.skipped) || []);
  const rows = [];
  for (const s of sealed) {
    if (skipped.has(s.id) || !(s.id in versions)) continue;
    const v = versions[s.id];
    vault.recs.set(s.id, { v, seq: res ? res.seq : 0, obj: s.obj });
    rows.push({ id: s.id, v, seq: res ? res.seq : 0, ct: s.ct });
  }
  vault.gen++;
  await tx(["records"], "readwrite", (t) => { const st = t.objectStore("records"); rows.forEach((r) => st.put(r)); });
  return { ok: true };
}
