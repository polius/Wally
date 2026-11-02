/* End-to-end encryption: every key Wally makes, and how a record is sealed. Nothing here talks to
   the server. tests/vault_crypto.py does the same in Python, to check what the browser wrote.

   household password ──Argon2id (64 MiB, 3 passes, one salt per household)──▶ master
     master ──HKDF "wally login v1"──▶ login key: sent at sign-in instead of the password
     master ──HKDF "wally unlock v1"─▶ unlock key: never leaves the browser; opens the household key
   recovery key (52 characters) ──HKDF──▶ its own login key and unlock key, the same way
   household secret (32 random bytes, one per household)
     ──HKDF "wally record key v1"──▶ AES-256-GCM key for records
     ──HKDF "wally id key v1"──────▶ HMAC key for ids that must be the same on every device
   A record: nonce ‖ AES-GCM(JSON padded with spaces to 64 bytes, additional data "id.version").
   A locked key: nonce ‖ AES-GCM(secret, additional data "wally wrap <vault id>"). */

const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = () => {
  if (!globalThis.crypto || !crypto.subtle) throw new Error("This browser can’t encrypt: open Wally over HTTPS.");
  return crypto.subtle;
};

export const ARGON = { memorySize: 65536, iterations: 3, parallelism: 1, hashLength: 32 };

/* ---------- bytes ---------- */
export function random(n) { return crypto.getRandomValues(new Uint8Array(n)); }
export function b64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unb64(s) {
  const raw = atob(s), out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
export function hex(bytes) { return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""); }
function concat(a, b) { const out = new Uint8Array(a.length + b.length); out.set(a); out.set(b, a.length); return out; }
export async function sha256Hex(text) { return hex(new Uint8Array(await subtle().digest("SHA-256", enc.encode(text)))); }

/* JSON with keys in order, so the same object always gives the same text */
export function stable(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
}

/* ---------- Argon2id, from hash-wasm (MIT), loaded the first time a password is typed ---------- */
let argonLoad = null;
function argon() {
  if (globalThis.hashwasm && globalThis.hashwasm.argon2id) return Promise.resolve(globalThis.hashwasm);
  if (!argonLoad) {
    argonLoad = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "/js/vendors/argon2.umd.min.js";
      s.onload = () => (globalThis.hashwasm ? resolve(globalThis.hashwasm) : reject(new Error("Argon2 did not load.")));
      s.onerror = () => { argonLoad = null; reject(new Error("Wally can’t be reached. Check your connection.")); };
      document.head.appendChild(s);
    });
  }
  return argonLoad;
}

async function hkdf(ikm, info, length = 32) {
  if (!secure()) return hkdfPlain(ikm, enc.encode(info), length);
  const base = await subtle().importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await subtle().deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode(info) }, base, length * 8));
}
export function hkdfBytes(ikm, info) { return hkdf(ikm, info); }
/* Browsers keep WebCrypto for HTTPS (and localhost). Encryption needs it; signing in with a login
   key does not, so a household that turned encryption off still signs in over plain HTTP. */
export function secure() { return !!(globalThis.crypto && crypto.subtle && globalThis.isSecureContext !== false); }

/* SHA-256, HMAC and HKDF (RFC 5869) in plain JavaScript, used only without WebCrypto */
const K256 = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
export function sha256(data) {
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const len = data.length, total = Math.ceil((len + 9) / 64) * 64, m = new Uint8Array(total);
  m.set(data); m[len] = 0x80;
  const view = new DataView(m.buffer);
  view.setUint32(total - 4, (len * 8) >>> 0); view.setUint32(total - 8, Math.floor(len / 0x20000000));
  const w = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2];
      w[i] = (((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3)) + w[i - 16] + (((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10)) + w[i - 7];
    }
    let [A, B, Cc, D, E, F, G, H] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (H + (((E >>> 6) | (E << 26)) ^ ((E >>> 11) | (E << 21)) ^ ((E >>> 25) | (E << 7))) + ((E & F) ^ (~E & G)) + K256[i] + w[i]) >>> 0;
      const t2 = ((((A >>> 2) | (A << 30)) ^ ((A >>> 13) | (A << 19)) ^ ((A >>> 22) | (A << 10))) + ((A & B) ^ (A & Cc) ^ (B & Cc))) >>> 0;
      H = G; G = F; F = E; E = (D + t1) >>> 0; D = Cc; Cc = B; B = A; A = (t1 + t2) >>> 0;
    }
    h[0] += A; h[1] += B; h[2] += Cc; h[3] += D; h[4] += E; h[5] += F; h[6] += G; h[7] += H;
  }
  const out = new Uint8Array(32), ov = new DataView(out.buffer);
  h.forEach((v, i) => ov.setUint32(i * 4, v));
  return out;
}
function hmac(key, data) {
  const k = new Uint8Array(64);
  k.set(key.length > 64 ? sha256(key) : key);
  const inner = new Uint8Array(64 + data.length), outer = new Uint8Array(96);
  for (let i = 0; i < 64; i++) { inner[i] = k[i] ^ 0x36; outer[i] = k[i] ^ 0x5c; }
  inner.set(data, 64);
  outer.set(sha256(inner), 64);
  return sha256(outer);
}
export function hkdfPlain(ikm, info, length) {
  const prk = hmac(new Uint8Array(32), ikm);
  const out = new Uint8Array(length);
  let prev = new Uint8Array(0);
  for (let i = 0, pos = 0; pos < length; i++) {
    const block = new Uint8Array(prev.length + info.length + 1);
    block.set(prev); block.set(info, prev.length); block[block.length - 1] = i + 1;
    prev = hmac(prk, block);
    out.set(prev.subarray(0, Math.min(32, length - pos)), pos);
    pos += 32;
  }
  return out;
}
function aesKey(bytes) { return subtle().importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]); }

/* ---------- a password ---------- */
export function newSalt() { return b64(random(16)); }
/* {login, unlock}: the login key as 64 hex characters, and the key that opens the household key */
export async function fromPassword(password, salt) {
  const hw = await argon();
  const master = await hw.argon2id({ password: String(password).normalize("NFC"), salt: unb64(salt), outputType: "binary", ...ARGON });
  try {
    // Without WebCrypto (plain HTTP) there is no unlock key: enough to sign in, not to open encrypted data
    return { login: hex(await hkdf(master, "wally login v1")), unlock: secure() ? await aesKey(await hkdf(master, "wally unlock v1")) : null };
  } finally { master.fill(0); }
}

/* ---------- the household key, locked ---------- */
export async function lock(unlockKey, secret, vaultId) {
  const iv = random(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv, additionalData: enc.encode("wally wrap " + vaultId) }, unlockKey, secret));
  return b64(concat(iv, ct));
}
/* The secret, or null when this is the wrong password, recovery key or code */
export async function unlock(unlockKey, wrap, vaultId) {
  const raw = unb64(wrap);
  try {
    return new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv: raw.subarray(0, 12), additionalData: enc.encode("wally wrap " + vaultId) }, unlockKey, raw.subarray(12)));
  } catch (e) { return null; }
}
export function newSecret() { return random(32); }
/* The keys a device keeps. Neither can be read back out of the browser, only used. */
export async function householdKeys(secret) {
  const [r, i] = await Promise.all([hkdf(secret, "wally record key v1"), hkdf(secret, "wally id key v1")]);
  const record = await subtle().importKey("raw", r, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  const id = await subtle().importKey("raw", i, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  r.fill(0); i.fill(0);
  return { record, id };
}

/* ---------- records ---------- */
const BLOCK = 64;
export async function seal(keys, id, version, obj) {
  const body = enc.encode(JSON.stringify(obj));
  // Padded to 64 bytes with spaces, which JSON ignores, so sizes say little about what is inside
  const size = Math.max(BLOCK, Math.ceil(body.length / BLOCK) * BLOCK);
  const padded = new Uint8Array(size).fill(0x20);
  padded.set(body);
  const iv = random(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(id + "." + version) }, keys.record, padded));
  return b64(concat(iv, ct));
}
/* Throws when the record was changed, or moved to another id or version, by anyone without the key */
export async function open(keys, id, version, ct) {
  const raw = unb64(ct);
  const plain = await subtle().decrypt({ name: "AES-GCM", iv: raw.subarray(0, 12), additionalData: enc.encode(id + "." + version) }, keys.record, raw.subarray(12));
  return JSON.parse(dec.decode(plain));
}

/* An id every device works out the same, without the server learning the name: a category, a tag,
   a recurring rule's charge on a date */
export async function idFor(keys, text) {
  const sig = new Uint8Array(await subtle().sign("HMAC", keys.id, enc.encode(text)));
  return hex(sig.subarray(0, 16));
}
export function randomId() { return hex(random(16)); }
export function uuid(h) { return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20, 32); }
export function newUuid() {
  const b = random(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  return uuid(hex(b));
}

/* ---------- recovery keys: Crockford base32, easy to read and type ---------- */
const ABC = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function toBase32(bytes, chars) {
  let bits = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  bits = bits.padEnd(chars * 5, "0");
  let out = "";
  for (let i = 0; i < chars; i++) out += ABC[parseInt(bits.slice(i * 5, i * 5 + 5), 2)];
  return out;
}
function fromBase32(text, bits) {
  let s = "";
  for (const ch of text) { const v = ABC.indexOf(ch); if (v < 0) return null; s += v.toString(2).padStart(5, "0"); }
  if (/1/.test(s.slice(bits))) return null;
  const out = new Uint8Array(Math.floor(bits / 8));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 8, i * 8 + 8), 2);
  return { bytes: out, rest: s.slice(out.length * 8, bits) };
}
function clean(text) { return String(text || "").toUpperCase().replace(/[\s\-_.]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1"); }
async function checkByte(bytes) { return new Uint8Array(await subtle().digest("SHA-256", bytes))[0]; }

/* 31 random bytes and a check byte: 52 characters, shown in 13 groups of 4 */
export async function newRecoveryKey() {
  const body = random(31);
  return toBase32(concat(body, new Uint8Array([await checkByte(body)])), 52).match(/.{4}/g).join("-");
}
/* The key's bytes, or null when it was mistyped */
export async function parseRecoveryKey(text) {
  const s = clean(text);
  if (s.length !== 52) return null;
  const r = fromBase32(s, 256);
  if (!r) return null;
  return r.bytes[31] === (await checkByte(r.bytes.subarray(0, 31))) ? r.bytes : null;
}
export async function fromRecoveryKey(bytes) {
  return { login: hex(await hkdf(bytes, "wally recovery login v1")), unlock: await aesKey(await hkdf(bytes, "wally recovery unlock v1")) };
}


