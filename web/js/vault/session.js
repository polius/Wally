/* End-to-end encryption on this device: signing in and unlocking, getting back in with the
   Emergency Kit, a new password or recovery key, turning encryption on or off, and keeping the
   copy in step with the server. There is one household key, opened by the household password. The pages call these; crypto.js makes the keys, store.js keeps
   the copy, local.js answers the app's requests from it. */
import * as C from "./crypto.js";
import * as store from "./store.js";
import * as local from "./local.js";

const { vault } = store;
let core = null;     // core.js, set by start(): api(), state, emit()...
export function bind(c) {
  core = c;
  store.setTransport((m, p, b, o) => core.api(m, p, b, Object.assign({}, o || {}, { raw: true })));
  local.setEnv({ people: () => core.state.people || [], me: () => core.state.me, config: () => core.state.config || {}, ApiError: core.ApiError });
}
const raw = (m, p, b, o) => core.api(m, p, b, Object.assign({ raw: true }, o || {}));
const quiet = (m, p, b) => raw(m, p, b, { quiet401: true });
const FLAG = "wally.vault";
function flag(on) { try { if (on) localStorage.setItem(FLAG, "1"); else localStorage.removeItem(FLAG); } catch (e) { /* fine */ } }
export function hadVault() { try { return localStorage.getItem(FLAG) === "1"; } catch (e) { return false; } }

/* ---------- passwords into keys ---------- */
/* What the server needs to check the household password: the login key when there is a salt,
   otherwise the password as typed (only with encryption off, when it never had a salt) */
export async function credentials(password) {
  const kdf = await raw("GET", "/vault/kdf");
  if (!kdf.salt) return { kdf, login: password, unlock: null };
  const k = await C.fromPassword(password, kdf.salt);
  return { kdf, login: k.login, unlock: k.unlock };
}
export async function proof(password) {
  return (await credentials(password)).login;
}

/* ---------- unlocking ---------- */
async function adopt(secret, vaultId, personId) {
  const keys = await C.householdKeys(secret);
  await store.useKeys(keys, vaultId, personId);
  flag(true);
}
/* After signing in with the password: open the household key with it */
export async function unlockWith(unlockKey, personId) {
  const k = await raw("GET", "/vault/key");
  const secret = await C.unlock(unlockKey, k.wrap, k.vault_id);
  if (!secret) throw new core.ApiError(401, "That password is not right.");
  try { await adopt(secret, k.vault_id, personId); } finally { secret.fill(0); }
}
/* Signed in, but this browser has no key (cleared, Safari's seven days, a new tab after "Lock when Wally closes") */
export async function unlockWithPassword(password, personId) {
  const kdf = await raw("GET", "/vault/kdf");
  if (!kdf.salt) throw new core.ApiError(401, "That password is not right.");
  const k = await C.fromPassword(password, kdf.salt);
  await unlockWith(k.unlock, personId);
}

/* Opening Wally: the keys this browser kept, then the copy, then what changed. false: needs unlocking. */
export async function resume(status) {
  const me = status.me && status.me.id;
  if (!vault.keys || vault.id !== status.vault.id || vault.person !== String(me)) {
    const kept = await store.loadKeys(status.vault.id, me);
    if (!kept) {
      // A copy from another household, or from before encryption was turned off and on again
      if (await store.hasCopy()) await store.wipe();
      return false;
    }
    vault.keys = { record: kept.record, id: kept.id }; vault.id = status.vault.id; vault.person = String(me);
  }
  if (!vault.ready) await store.openCopy();
  await syncNow();
  return true;
}
export function active() { return !!(vault.keys && vault.ready); }

/* ---------- staying in step ---------- */
let timer = null, pending = null;
export async function syncNow() {
  try {
    const before = vault.id;
    const n = await store.sync();
    if (before !== vault.id) return 0;
    return n;
  } catch (e) {
    if (e.status === 409 || e.status === 403) { await store.wipe(); flag(false); location.reload(); }
    throw e;
  }
}
export function startSync() {
  // On focus, every 30 seconds while visible, and after a save
  const tick = () => { if (document.visibilityState === "visible") syncNow().catch(() => {}); };
  document.addEventListener("visibilitychange", tick);
  addEventListener("focus", tick);
  clearInterval(timer);
  timer = setInterval(tick, 30000);
  store.onRemote(() => {
    clearTimeout(pending);
    pending = setTimeout(() => core.reloadAll().catch(() => {}), 50);
  });
}
export function afterSave() { clearTimeout(pending); setTimeout(() => syncNow().catch(() => {}), 1200); }
export function runEngine() { return local.runAll(); }
/* Sign out, a session that ended, encryption turned off: nothing of the household stays here */
export async function forget() { flag(false); await store.wipe(); }
export const isLocal = local.isLocal;
export const lockOnClose = store.lockOnClose;
export const setLockOnClose = store.setLockOnClose;
export function records() { let n = 0; for (const r of vault.recs.values()) if (r.obj) n++; return n; }
/* Records that would not open: changed by someone without the key. Never silently dropped. */
export function broken() { return vault.broken.size; }
export function handle(method, path, body, send) {
  const out = local.handle(method, path, body, send);
  if (method !== "GET") out.then(afterSave, () => {});
  return out;
}

/* ---------- getting back in ---------- */
/* With the recovery key from the household's Emergency Kit, which also stands in for two-step
   sign-in. Returns what opens the household key. */
export async function prove(personId, text) {
  const bytes = await C.parseRecoveryKey(text);
  if (!bytes) throw new core.ApiError(400, "That recovery key has a typo. Check each group of four.");
  const keys = await C.fromRecoveryKey(bytes);
  bytes.fill(0);
  const r = await quiet("POST", "/kit/recover", { person_id: Number(personId), login: keys.login });
  const secret = await C.unlock(keys.unlock, r.wrap, r.vault_id);
  if (!secret) throw new core.ApiError(400, "This recovery key opened nothing. Check that it’s this household’s Emergency Kit.");
  return { secret, vault_id: r.vault_id };
}
/* A new household password after the recovery key */
export async function setup(found, password, personId) {
  const salt = C.newSalt();
  const k = await C.fromPassword(password, salt);
  await raw("POST", "/kit/password", { salt, new: k.login, wrap: await C.lock(k.unlock, found.secret, found.vault_id) });
  try { await adopt(found.secret, found.vault_id, personId); } finally { found.secret.fill(0); }
}

/* The household secret, opened again with the password: needed to lock it under anything new */
async function secretFrom(password) {
  const k = await credentials(password);
  const key = await raw("GET", "/vault/key");
  const secret = k.unlock && await C.unlock(k.unlock, key.wrap, key.vault_id);
  if (!secret) throw new core.ApiError(401, "That password is not right.");
  return { secret, login: k.login, vaultId: key.vault_id };
}
export async function newRecoveryKey(password) {
  const s = await secretFrom(password);
  try {
    const key = await C.newRecoveryKey();
    const rk = await C.fromRecoveryKey(await C.parseRecoveryKey(key));
    await quiet("POST", "/kit", { current: s.login, recovery_login: rk.login, recovery_wrap: await C.lock(rk.unlock, s.secret, s.vaultId) });
    return key;
  } finally { s.secret.fill(0); }
}
/* A new household password. With encryption on, the household key is locked under it again. */
export async function changePassword(current, next) {
  const encrypted = !!(core.state.status && core.state.status.vault && core.state.status.vault.on);
  const kdf = await raw("GET", "/vault/kdf");
  if (!kdf.salt && !encrypted) {
    // Never had a salt: from now on the server never sees this password
    const salt = C.newSalt(), k = await C.fromPassword(next, salt);
    return quiet("PUT", "/password", { current, new: k.login, salt });
  }
  const old = await C.fromPassword(current, kdf.salt);
  const salt = C.newSalt(), k = await C.fromPassword(next, salt);
  const body = { current: old.login, new: k.login, salt };
  if (encrypted) {
    const key = await raw("GET", "/vault/key");
    const secret = await C.unlock(old.unlock, key.wrap, key.vault_id);
    if (!secret) throw new core.ApiError(401, { message: "That password is not right." });
    try { body.wrap = await C.lock(k.unlock, secret, key.vault_id); } finally { secret.fill(0); }
  }
  return quiet("PUT", "/password", body);
}

/* ---------- turning encryption on or off ---------- */
/* Turning on: every record is sealed here, sent to a new file, read back and compared, and only
   then does the server switch to it. Returns the recovery key of the household's Emergency Kit. */
export async function turnOn(password, progress) {
  progress = progress || (() => {});
  const me = Number(core.state.me);
  progress("keys");
  const kdf = await raw("GET", "/vault/kdf");
  const current = kdf.salt ? (await C.fromPassword(password, kdf.salt)).login : password;
  const salt = C.newSalt(), mine = await C.fromPassword(password, salt);
  const secret = C.newSecret(), vaultId = C.randomId();
  try {
    const recoveryKey = await C.newRecoveryKey();
    const rk = await C.fromRecoveryKey(await C.parseRecoveryKey(recoveryKey));
    const keys = await C.householdKeys(secret);
    progress("pause");
    const start = await quiet("POST", "/vault/convert/start", {
      direction: "on", current, vault_id: vaultId, salt, login_key: mine.login, wrap: await C.lock(mine.unlock, secret, vaultId),
      recovery_login: rk.login, recovery_wrap: await C.lock(rk.unlock, secret, vaultId),
    });
    const id = start.id;
    try {
      const { items } = await raw("GET", "/vault/convert/export?id=" + id);
      const built = [];
      for (const item of items) built.push({ rid: await ridFor(keys, item), obj: shapeForVault(item) });
      // Ids must be unique: two items with one id would lose one
      if (new Set(built.map((b) => b.rid)).size !== built.length) throw new Error("Two items have the same id. Nothing changed.");
      const sent = new Map();
      for (let i = 0; i < built.length; i += 500) {
        const part = built.slice(i, i + 500);
        const records = [];
        for (const b of part) { const ct = await C.seal(keys, b.rid, 1, b.obj); records.push({ id: b.rid, ct }); sent.set(b.rid, C.stable(b.obj)); }
        await raw("POST", "/vault/convert/records", { id, records });
        progress("seal", Math.min(i + 500, built.length), built.length);
      }
      progress("check");
      const back = await raw("GET", "/vault/convert/readback?id=" + id);
      if (back.records.length !== sent.size) throw new Error("The new file has " + back.records.length + " records, not " + sent.size + ". Nothing changed.");
      for (const r of back.records) {
        const obj = await C.open(keys, r.id, r.v, r.ct);
        if (sent.get(r.id) !== C.stable(obj)) throw new Error("A record came back different. Nothing changed.");
      }
      progress("switch");
      await raw("POST", "/vault/convert/finish", { id, count: sent.size });
    } catch (e) {
      try { await raw("POST", "/vault/convert/abort", { id }); } catch (e2) { /* it expires on its own */ }
      throw e;
    }
    await store.wipe();
    await store.useKeys(keys, vaultId, me);
    flag(true);
    return { recoveryKey };
  } finally { secret.fill(0); }
}
/* The shape a record keeps: as exported, with an import rule's id made a record id */
function shapeForVault(item) { return JSON.parse(JSON.stringify(item)); }
async function ridFor(keys, item) {
  if (item.k === "tx" || item.k === "rule") return item.id.replace(/-/g, "").toLowerCase();
  if (item.k === "cat" || item.k === "tag") return C.idFor(keys, item.k + "|" + item.name);
  if (item.k === "irule") { const rid = await C.idFor(keys, "irule|" + item.id); item.id = rid; return rid; }
  throw new Error("Unknown item.");
}
/* Turning off: every record opened here, sent to a new file in the clear, read back and compared */
export async function turnOff(password, progress) {
  progress = progress || (() => {});
  progress("keys");
  const kdf = await raw("GET", "/vault/kdf");
  const current = (await C.fromPassword(password, kdf.salt)).login;
  progress("pause");
  const start = await quiet("POST", "/vault/convert/start", { direction: "off", current });
  const id = start.id;
  try {
    // Paused: nothing changes now, so this is everything
    await store.sync();
    if (vault.broken.size) throw new Error(vault.broken.size + " records would not open. Nothing changed.");
    const items = [...vault.recs.values()].filter((r) => r.obj).map((r) => r.obj);
    for (let i = 0; i < items.length; i += 1000) {
      await raw("POST", "/vault/convert/plain", { id, items: items.slice(i, i + 1000) });
      progress("open", Math.min(i + 1000, items.length), items.length);
    }
    progress("check");
    const back = await raw("GET", "/vault/convert/readback?id=" + id);
    const want = items.map(comparable).sort(), got = back.items.map(comparable).sort();
    if (want.length !== got.length) throw new Error("The new file has " + got.length + " items, not " + want.length + ". Nothing changed.");
    for (let i = 0; i < want.length; i++) if (want[i] !== got[i]) throw new Error("An item came back different. Nothing changed.");
    progress("switch");
    await raw("POST", "/vault/convert/finish", { id, count: items.length });
  } catch (e) {
    try { await raw("POST", "/vault/convert/abort", { id }); } catch (e2) { /* it expires on its own */ }
    throw e;
  }
  await forget();
}
/* An item as both sides write it: an import rule gets a new number in the clear */
function comparable(o) {
  const c = JSON.parse(JSON.stringify(o));
  if (c.k === "irule") delete c.id;
  return C.stable(c);
}
export { C as crypto };
