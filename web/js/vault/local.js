/* With encryption on, the server can't read the household's data, so what its routers did for the
   web app is done here, on this device's copy: the same paths, the same answers, the same rules
   (api/routers/transactions.py, recurring_transactions.py, categories.py, tags.py, data.py,
   people.py, api/services/engine.py and ledger.py). core.js's api() sends these paths here.

   Each request runs as a draft over the copy. The draft's changes are sealed and saved in one
   batch. If another device saved one of the same records first, the copy takes in what it saved
   and the request runs again; a record this request changed keeps the other device's fields and
   takes only the fields this request changed (the same field: the later save wins). */
import { vault, commit, Conflict, serial, syncInside, onRemote } from "./store.js";
import { idFor, uuid, newUuid, randomId, sha256Hex } from "./crypto.js";

let env = null;      // {people(), me(), config(), ApiError}
export function setEnv(e) { env = e; }
const fail = (status, detail) => new env.ApiError(status, detail);

/* ---------- the copy, by kind ---------- */
const KEY = { tx: "id", rule: "id", irule: "id", cat: "name", tag: "name" };
let built = -1, index = null;
function idx() {
  if (built === vault.gen && index) return index;
  index = { tx: new Map(), rule: new Map(), cat: new Map(), tag: new Map(), irule: new Map() };
  for (const [rid, r] of vault.recs) {
    const o = r.obj;
    if (o && index[o.k]) index[o.k].set(o[KEY[o.k]], rid);
  }
  built = vault.gen;
  return index;
}
function base(kind, key) {
  const rid = idx()[kind].get(key);
  const r = rid && vault.recs.get(rid);
  return r && r.obj ? r.obj : null;
}
function clone(o) { return o === null || o === undefined ? null : JSON.parse(JSON.stringify(o)); }
async function ridOf(kind, key) {
  if (kind === "tx" || kind === "rule") return String(key).replace(/-/g, "").toLowerCase();
  if (kind === "irule") return key;
  return idx()[kind].get(key) || idFor(vault.keys, kind + "|" + key);
}

/* A draft: reads see its own changes; nothing is saved until it is committed */
class Draft {
  constructor() { this.w = new Map(); }
  get(kind, key) {
    const k = kind + "\u0000" + key;
    if (this.w.has(k)) return this.w.get(k).obj;
    return base(kind, key);
  }
  all(kind) {
    const out = [];
    for (const [key] of idx()[kind]) {
      const k = kind + "\u0000" + key;
      const o = this.w.has(k) ? this.w.get(k).obj : base(kind, key);
      if (o) out.push(o);
    }
    for (const c of this.w.values()) if (c.kind === kind && c.obj && !idx()[kind].has(c.key)) out.push(c.obj);
    return out;
  }
  put(kind, obj, opts) {
    obj.k = kind;
    const key = obj[KEY[kind]], k = kind + "\u0000" + key;
    const was = this.w.get(k);
    // Put back after a delete in the same draft: it replaces what was there, even a deleted one
    this.w.set(k, { kind, key, obj, ifAbsent: !!(opts && opts.ifAbsent) && !was, resurrect: !!(opts && opts.resurrect) || !!was });
    return obj;
  }
  del(kind, key) { this.w.set(kind + "\u0000" + key, { kind, key, obj: null }); }
  /* record id → {kind, obj, ifAbsent}, ready to seal */
  async changes() {
    const out = new Map();
    for (const c of this.w.values()) {
      const rid = await ridOf(c.kind, c.key);
      const have = vault.recs.get(rid);
      if (c.ifAbsent && have && !c.resurrect) continue;     // already there, or deleted on purpose
      if (c.obj && have && have.obj && same(have.obj, c.obj)) continue;
      out.set(rid, { kind: c.kind, obj: c.obj, ifAbsent: c.ifAbsent && !have });
    }
    return out;
  }
}
function same(a, b) { return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b)); }
function sortKeys(v) { if (v === null || typeof v !== "object" || Array.isArray(v)) return v; const o = {}; Object.keys(v).sort().forEach((k) => { o[k] = sortKeys(v[k]); }); return o; }

/* Three versions of one record: as it was, as this request made it, as another device saved it */
function merge3(before, mine, theirs) {
  if (!before) return Object.assign({}, theirs, Object.fromEntries(Object.entries(mine).filter(([, v]) => v !== null && v !== undefined)));
  const out = clone(theirs);
  for (const k of new Set([...Object.keys(before), ...Object.keys(mine)])) {
    if (JSON.stringify(before[k]) !== JSON.stringify(mine[k])) out[k] = clone(mine[k]);
  }
  return out;
}

const MAX_TRIES = 6;
/* Run a request on the copy and save what it changed, all or none */
function run(handler, opts) {
  return serial(async () => {
    let first = null;
    for (let attempt = 0; ; attempt++) {
      const d = new Draft();
      let respond;
      try { respond = await handler(d); }
      catch (e) { if (attempt && e.status === 404) throw fail(409, "Deleted on another device."); throw e; }
      const changes = await d.changes();
      if (first) {
        for (const [rid, c] of changes) {
          const f = first.get(rid), now = vault.recs.get(rid);
          if (!f || !c.obj || !f.after || !now || !now.obj) continue;
          c.obj = normalize(c.kind, merge3(f.before, f.after, now.obj));
        }
      } else {
        first = new Map([...changes].map(([rid, c]) => { const now = vault.recs.get(rid); return [rid, { before: now && now.obj ? clone(now.obj) : null, after: clone(c.obj) }]; }));
      }
      if (!changes.size && opts && opts.via) await opts.via([]);
      if (changes.size) {
        try {
          await commit(changes, opts && opts.via);
        } catch (e) {
          if (!(e instanceof Conflict) || attempt >= MAX_TRIES - 1) throw e instanceof Conflict ? fail(409, "Changed on another device too often. Try again.") : e;
          await syncInside();
          continue;
        }
      }
      return typeof respond === "function" ? respond() : respond;
    }
  });
}
/* A saved record, from the copy */
function read(kind, key) { return base(kind, key); }

/* ---------- money and dates ---------- */
export function toCents(amount) {
  if (amount === null || amount === undefined || amount === "") throw fail(422, "Enter an amount.");
  let s = typeof amount === "number" ? (Number.isFinite(amount) ? (/e/i.test(String(amount)) ? amount.toFixed(8) : String(amount)) : "") : String(amount).trim();
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (!m[2] && !m[3])) throw fail(422, "Not an amount.");
  const frac = (m[3] || "") + "000";
  // Rounded half up, as Decimal does on the server
  let cents = Number(m[2] || "0") * 100 + Number(frac.slice(0, 2)) + (Number(frac[2]) >= 5 ? 1 : 0);
  return m[1] === "-" ? -cents : cents;
}
export function amountText(cents) { const neg = cents < 0, c = Math.abs(cents); return (neg ? "-" : "") + Math.floor(c / 100) + "." + String(c % 100).padStart(2, "0"); }
const ISO = /^\d{4}-\d{2}-\d{2}$/;
function isoDate(v, what) {
  if (typeof v !== "string" || !ISO.test(v) || isNaN(Date.UTC(+v.slice(0, 4), +v.slice(5, 7) - 1, +v.slice(8, 10)))) throw fail(422, (what || "date") + " is not a date.");
  const d = new Date(Date.UTC(+v.slice(0, 4), +v.slice(5, 7) - 1, +v.slice(8, 10)));
  if (d.toISOString().slice(0, 10) !== v) throw fail(422, (what || "date") + " is not a date.");
  return v;
}
const DAY = 864e5;
function T(s) { return Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)); }
function S(ms) { return new Date(ms).toISOString().slice(0, 10); }
function addDays(s, n) { return S(T(s) + n * DAY); }
function daysBetween(a, b) { return Math.round((T(a) - T(b)) / DAY); }
function dim(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
/* relativedelta(months=n): the same day, or the month's last day when it is shorter */
function addMonths(s, n) {
  let y = +s.slice(0, 4), m = +s.slice(5, 7) + n;
  y += Math.floor((m - 1) / 12); m = ((m - 1) % 12 + 12) % 12 + 1;
  const d = Math.min(+s.slice(8, 10), dim(y, m));
  return y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
}
/* Today for the household: its time zone in Settings, or this browser's */
export function today() {
  const tz = env && env.config() && env.config().timezone;
  try {
    if (tz) return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch (e) { /* not a zone this browser knows */ }
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
/* UTC, as the server writes it: 2026-10-24T09:33:49.123000 */
function now() { return new Date().toISOString().slice(0, 23) + "000"; }

/* ---------- who owns what (services/ledger.py) ---------- */
function peopleIds() {
  return env.people().slice().sort((a, b) => (a.position - b.position) || (a.id - b.id)).map((p) => p.id);
}
function actor() { const m = env.me(); return m === null || m === undefined ? null : Number(m); }
export function cleanTags(tags) {
  const out = [];
  for (const tag of tags || []) {
    const name = String(tag).trim().replace(/^#+/, "").trim();
    if (name && !out.includes(name)) out.push(name.slice(0, 40));
  }
  return out;
}
function ensureCategory(d, name) { if (name && !d.get("cat", name)) d.put("cat", { name }); }
function ensureTags(d, tags) { for (const g of tags) if (!d.get("tag", g)) d.put("tag", { name: g }); }
export function evenShares(total, people, payer) {
  if (!people.length) return {};
  const baseShare = Math.floor(total / people.length), spare = total - baseShare * people.length;
  const shares = {};
  people.forEach((p) => { shares[String(p)] = baseShare; });
  const order = people.map((p, i) => [p, i]).sort((a, b) => ((a[0] !== payer) - (b[0] !== payer)) || (a[1] - b[1])).map((x) => x[0]);
  order.slice(0, spare).forEach((p) => { shares[String(p)] += 1; });
  return shares;
}
export function resolveOwner(data, actorPerson, ids) {
  ids = ids || peopleIds();
  const personId = data.person_id;
  if (personId !== null && personId !== undefined) {
    if (!ids.includes(personId)) throw fail(400, "This person does not exist.");
    data.shares = null; data.paid_by = null;
    return data;
  }
  data.person_id = null;
  if (ids.length < 2) { data.shares = null; data.paid_by = null; return data; }
  const cents = data.cents;
  let payer = data.paid_by === undefined ? null : data.paid_by;
  if ((data.type || "expense") === "income") payer = null;
  else if (payer === null) payer = ids.includes(actorPerson) ? actorPerson : ids[0];
  else if (!ids.includes(payer)) throw fail(400, "Paid by must be someone in the household.");
  data.paid_by = payer;
  const shares = data.shares;
  if (shares && Object.keys(shares).length) {
    const out = {};
    for (const [key, value] of Object.entries(shares)) {
      if (!/^\d+$/.test(String(key)) || !ids.includes(Number(key))) throw fail(400, "Shares can only be for people in the household.");
      if (!Number.isInteger(value) || value < 0) throw fail(400, "Shares are whole cents, zero or more.");
      if (value) out[String(Number(key))] = value;
    }
    if (Object.values(out).reduce((a, b) => a + b, 0) !== cents) throw fail(400, "Shares must add up to the amount.");
    data.shares = out;
  } else data.shares = evenShares(cents, ids, payer);
  return data;
}
/* After merging two devices' changes: an owner and shares that still fit together */
function normalize(kind, obj) {
  if (kind !== "tx" && kind !== "rule") return obj;
  const ids = peopleIds();
  if (obj.person_id !== null && !ids.includes(obj.person_id)) obj.person_id = null;
  if (obj.paid_by !== null && !ids.includes(obj.paid_by)) obj.paid_by = null;
  try { return resolveOwner(obj, null, ids); }
  catch (e) { obj.shares = null; return resolveOwner(obj, null, ids); }
}
function intOrNull(v, what) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n)) throw fail(422, what + " is not a whole number.");
  return n;
}
function shareMap(v) {
  if (v === null || v === undefined) return null;
  if (typeof v !== "object" || Array.isArray(v)) throw fail(422, "shares is not a list of parts.");
  const out = {};
  for (const [k, x] of Object.entries(v)) { if (!Number.isInteger(x)) throw fail(422, "Shares are whole cents."); out[k] = x; }
  return out;
}
const TYPES = ["expense", "income"];
function type(v) { if (v === undefined || v === null) return "expense"; if (!TYPES.includes(v)) throw fail(422, "type is expense or income."); return v; }

/* ---------- transactions (routers/transactions.py) ---------- */
function txFields(body, partial) {
  const o = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  if (!partial || has("name")) o.name = String(body.name === undefined || body.name === null ? "" : body.name);
  if (!partial || has("category")) { if (body.category === undefined || body.category === null) { if (!partial) throw fail(422, "category is missing."); } else o.category = String(body.category); }
  if (!partial || has("tags")) o.tags = Array.isArray(body.tags) ? body.tags.map(String) : [];
  if (!partial || has("amount")) o.cents = toCents(body.amount);
  if (!partial || has("type")) o.type = type(body.type);
  if (!partial || has("date")) o.date = body.date === undefined || body.date === null ? today() : isoDate(body.date);
  if (!partial || has("person_id")) o.person_id = intOrNull(body.person_id, "person_id");
  if (!partial || has("shares")) o.shares = shareMap(body.shares);
  if (!partial || has("paid_by")) o.paid_by = intOrNull(body.paid_by, "paid_by");
  if (!partial || has("note")) o.note = String(body.note === undefined || body.note === null ? "" : body.note);
  return o;
}
function checkNew(o) {
  if (o.cents <= 0) throw fail(422, "amount must be positive");
  if (o.cents >= 10000000000) throw fail(422, "amount is too large");
  o.name = o.name.trim();
  return o;
}
function prepare(d, data, ids) {
  data.tags = cleanTags(data.tags);
  data.category = String(data.category || "").trim();
  if (!data.category) throw fail(400, "Pick a category.");
  data = resolveOwner(data, actor(), ids);
  ensureCategory(d, data.category);
  ensureTags(d, data.tags);
  return data;
}
function newTx(data, extra) {
  return Object.assign({
    id: newUuid(), name: data.name, category: data.category, tags: data.tags, cents: data.cents, type: data.type, date: data.date,
    person_id: data.person_id, shares: data.shares, paid_by: data.paid_by, note: data.note || "", recurringID: "", created_date: now(),
    created_by: actor(), import_ref: null, source: null, group_id: null,
  }, extra || {});
}
export function txPublic(t) {
  return {
    id: t.id, recurringID: t.recurringID || "", name: t.name, category: t.category, tags: t.tags || [], amount: amountText(t.cents), type: t.type, date: t.date,
    person_id: t.person_id, shares: t.shares || null, paid_by: t.paid_by, note: t.note || "", created_by: t.created_by, created_date: t.created_date,
    import_ref: t.import_ref || null, source: t.source || null, group_id: t.group_id || null,
  };
}
const OWN = ["name", "category", "tags", "cents", "type", "date", "person_id", "shares", "paid_by", "note"];
function pick(o, keys) { const out = {}; keys.forEach((k) => { out[k] = clone(o[k]); }); return out; }

const LEDGER_COLUMNS = ["id", "date", "name", "category", "cents", "type", "created", "person_id", "created_by", "shares", "paid_by", "tags", "recurring_id", "note", "group_id", "import_ref", "source"];
function ledger() {
  const rows = [];
  const list = new Draft().all("tx").sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.created_date < b.created_date ? 1 : a.created_date > b.created_date ? -1 : 0));
  for (const t of list) {
    // Ids as the server writes them, without dashes: the app reads either
    const row = [t.id.replace(/-/g, ""), t.date, t.name, t.category, t.cents, t.type === "income" ? "i" : "e", String(t.created_date || "").replace("T", " ").slice(0, 19), t.person_id, t.created_by,
      t.shares && Object.keys(t.shares).length ? t.shares : null, t.paid_by, t.tags && t.tags.length ? t.tags : null, t.recurringID || null, t.note || null, t.group_id || null,
      t.import_ref || null, t.source || null];
    while (row.length && (row[row.length - 1] === null || row[row.length - 1] === undefined)) row.pop();
    rows.push(row);
  }
  return { columns: LEDGER_COLUMNS, rows };
}

function ruleKey(name) {
  const words = String(name).toUpperCase().replace(/\*/g, " ").split(/\s+/).filter((w) => w && /\p{L}/u.test(w) && !/\d/.test(w));
  return words.slice(0, 3).join(" ");
}
async function learnRule(d, t) {
  const key = ruleKey(t.source && t.source.name !== undefined ? t.source.name : t.name);
  if (!key) return;
  const rule = d.all("irule").find((r) => r.match === key);
  if (rule) d.put("irule", Object.assign(clone(rule), { category: t.category, person_id: t.person_id, set_person: true }));
  else d.put("irule", { id: await idFor(vault.keys, "irule|" + key), match: key, category: t.category, person_id: t.person_id, set_person: true, uses: 0, learned: true, position: 999, created_at: now() });
}

const tx = {
  create: (body) => run((d) => {
    const data = prepare(d, checkNew(txFields(body)), undefined);
    const t = d.put("tx", newTx(data, { group_id: body.group_id || null }));
    return () => txPublic(read("tx", t.id));
  }),
  group: (parts) => run((d) => {
    if (!Array.isArray(parts) || parts.length < 2) throw fail(400, "A split receipt has at least two parts.");
    const ids = peopleIds(), gid = randomId();
    const made = parts.map((p) => d.put("tx", newTx(prepare(d, checkNew(txFields(p)), ids), { group_id: gid })));
    return () => made.map((t) => txPublic(read("tx", t.id)));
  }),
  update: (id, body) => run(async (d) => {
    const cur = d.get("tx", id);
    if (!cur) throw fail(404, "This transaction does not exist");
    const changes = txFields(body, true);
    const before = [cur.category, cur.person_id];
    let merged = Object.assign(pick(cur, OWN), changes);
    if (("cents" in changes || "person_id" in changes) && !("shares" in changes)) merged.shares = null;
    if (!(merged.cents > 0)) throw fail(400, "Enter an amount.");
    merged = prepare(d, merged);
    const next = d.put("tx", Object.assign(clone(cur), merged));
    if (next.import_ref && env.config().learn_rules !== false && (next.category !== before[0] || next.person_id !== before[1])) await learnRule(d, next);
    return () => txPublic(read("tx", id));
  }),
  remove: (id) => run((d) => {
    if (!d.get("tx", id)) throw fail(404, "This transaction does not exist");
    d.del("tx", id);
    return { ok: true };
  }),
  bulk: (body) => run((d) => {
    const rows = (body.ids || []).map((i) => d.get("tx", canon(i))).filter(Boolean);
    if (body.action === "delete") { rows.forEach((t) => d.del("tx", t.id)); return { ok: true, count: rows.length }; }
    if (body.action !== "update") throw fail(422, "action is delete or update.");
    const ids = peopleIds();
    for (const t of rows) {
      const data = {
        name: t.name, category: body.category || t.category, tags: t.tags, cents: t.cents, type: t.type, date: t.date,
        person_id: body.set_person ? intOrNull(body.person_id, "person_id") : t.person_id, shares: body.set_person ? null : t.shares, paid_by: t.paid_by, note: t.note,
      };
      d.put("tx", Object.assign(clone(t), prepare(d, data, ids)));
    }
    return { ok: true, count: rows.length };
  }),
  restore: (list) => run((d) => {
    const ids = peopleIds(), made = [];
    for (const x of list || []) {
      if (!x.id || d.get("tx", canon(x.id))) continue;
      const own = prepare(d, checkNew(txFields(x)), ids);
      made.push(d.put("tx", Object.assign(newTx(own), {
        id: canon(x.id), recurringID: x.recurringID ? canon(x.recurringID) : "", import_ref: x.import_ref || null, source: x.source || null,
        created_by: intOrNull(x.created_by, "created_by"), created_date: x.created_date ? fmtStamp(x.created_date) : now(), group_id: x.group_id || null,
      })));
    }
    return () => made.map((t) => txPublic(read("tx", t.id)));
  }),
};
/* A created_date as the UI kept it ("2026-10-24 09:33:49" or ISO), written the server's way */
function fmtStamp(s) {
  const v = String(s).replace(" ", "T").replace(/Z$/, "");
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?/.exec(v);
  return m ? m[1] + "." + (m[2] || "").padEnd(6, "0") : now();
}

/* ---------- the recurring engine (services/engine.py) ---------- */
const MAX_STEPS = 100000;
export function occurrence(rule, n) {
  const start = rule.startDate, step = n * (rule.interval || 1);
  if (rule.frequency === "daily") return addDays(start, step);
  if (rule.frequency === "weekly") return addDays(start, step * 7);
  let cur = addMonths(start, rule.frequency === "monthly" ? step : step * 12);
  if (rule.anchor_day && rule.anchor_day > +cur.slice(8, 10)) {
    const y = +cur.slice(0, 4), m = +cur.slice(5, 7);
    cur = cur.slice(0, 8) + String(Math.min(rule.anchor_day, dim(y, m))).padStart(2, "0");
  }
  return cur;
}
export function datesBetween(rule, after, until) {
  const last = rule.endDate === null || rule.endDate === undefined ? until : (until < rule.endDate ? until : rule.endDate);
  const out = [];
  for (let n = 0; n < MAX_STEPS; n++) {
    const cur = occurrence(rule, n);
    if (cur > last) break;
    if (after === null || after === undefined || cur > after) out.push(cur);
  }
  return out;
}
export function nextDate(rule, after) {
  for (let n = 0; n < MAX_STEPS; n++) {
    const cur = occurrence(rule, n);
    if (rule.endDate && cur > rule.endDate) return null;
    if (cur > after) return cur;
  }
  return null;
}
/* The id of a rule's charge on a date: the same on every device, so two devices adding it make one */
async function occurrenceId(ruleId, on) { return uuid(await idFor(vault.keys, "occurrence|" + ruleId + "|" + on)); }
async function makeTransaction(rule, on) {
  return {
    id: await occurrenceId(rule.id, on), name: rule.name, category: rule.category, tags: (rule.tags || []).slice(), cents: rule.cents, type: rule.type, date: on,
    person_id: rule.person_id, shares: rule.shares ? clone(rule.shares) : null, paid_by: rule.paid_by, note: "", recurringID: rule.id, created_date: now(),
    created_by: null, import_ref: null, source: null, group_id: null,
  };
}
function madeSet(d) { const s = new Set(); for (const t of d.all("tx")) if (t.recurringID) s.add(t.recurringID + "|" + t.date); return s; }
/* Catch up every date since last_run. Running twice, here or on another device, never adds a date twice. */
async function runRule(d, rule, day, made, resurrect) {
  if (rule.paused) return 0;
  made = made || madeSet(d);
  let added = 0;
  for (const on of datesBetween(rule, rule.last_run, day)) {
    if (made.has(rule.id + "|" + on)) continue;
    d.put("tx", await makeTransaction(rule, on), resurrect ? { resurrect: true } : { ifAbsent: true });
    made.add(rule.id + "|" + on);
    added++;
  }
  if (rule.last_run !== day) d.put("rule", Object.assign(rule, { last_run: day }));
  return added;
}
/* What the server does just after midnight; here, when Wally opens and when the day changes */
export function runAll() {
  return run(async (d) => {
    const day = today(), made = madeSet(d);
    let added = 0;
    for (const r of d.all("rule")) added += await runRule(d, clone(r), day, made);
    return { added };
  });
}

function ruleFields(body, partial) {
  const o = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  if (!partial || has("name")) o.name = String(body.name === undefined || body.name === null ? "" : body.name);
  if (!partial || has("category")) { if (body.category === undefined || body.category === null) { if (!partial) throw fail(422, "category is missing."); } else o.category = String(body.category); }
  if (!partial || has("tags")) o.tags = Array.isArray(body.tags) ? body.tags.map(String) : [];
  if (!partial || has("amount")) o.cents = toCents(body.amount);
  if (!partial || has("type")) o.type = type(body.type);
  if (!partial || has("startDate")) o.startDate = body.startDate === undefined || body.startDate === null ? today() : isoDate(body.startDate, "startDate");
  if (!partial || has("endDate")) o.endDate = body.endDate === undefined || body.endDate === null || body.endDate === "" ? null : isoDate(body.endDate, "endDate");
  if (!partial || has("frequency")) { const f = body.frequency === undefined ? "monthly" : body.frequency; if (!["daily", "weekly", "monthly", "yearly"].includes(f)) throw fail(422, "Not a frequency."); o.frequency = f; }
  if (!partial || has("interval")) o.interval = body.interval === undefined || body.interval === null ? 1 : intOrNull(body.interval, "interval");
  if (!partial || has("person_id")) o.person_id = intOrNull(body.person_id, "person_id");
  if (!partial || has("shares")) o.shares = shareMap(body.shares);
  if (!partial || has("paid_by")) o.paid_by = intOrNull(body.paid_by, "paid_by");
  if (!partial || has("about")) o.about = !!body.about;
  if (!partial || has("note")) o.note = String(body.note === undefined || body.note === null ? "" : body.note);
  return o;
}
function checkRule(o) {
  if (!(o.cents > 0)) throw fail(422, "amount must be positive");
  if (!(o.interval >= 1 && o.interval <= 999)) throw fail(422, "interval must be between 1 and 999");
  if (o.endDate !== null) {
    if (o.endDate < o.startDate) throw fail(422, "endDate must be on or after startDate");
    if (o.endDate > addMonths(o.startDate, 1200)) throw fail(422, "endDate cannot be more than 100 years after startDate");
  }
  return o;
}
function prepareRule(d, data) {
  data.tags = cleanTags(data.tags);
  data = resolveOwner(data, actor());
  ensureCategory(d, data.category);
  ensureTags(d, data.tags);
  return data;
}
const RULE_OWN = ["name", "category", "tags", "cents", "type", "startDate", "endDate", "frequency", "interval", "person_id", "shares", "paid_by", "about", "note"];
export function rulePublic(r) {
  return {
    id: r.id, name: r.name, category: r.category, tags: r.tags || [], amount: amountText(r.cents), type: r.type, startDate: r.startDate, endDate: r.endDate || null,
    frequency: r.frequency, interval: r.interval || 1, person_id: r.person_id, shares: r.shares || null, paid_by: r.paid_by, about: !!r.about, note: r.note || "",
    paused: !!r.paused, last_run: r.last_run || null, anchor_day: r.anchor_day || null, missed: r.missed || null, created_date: r.created_date,
  };
}
function newRule(data) {
  return Object.assign(pick(data, RULE_OWN), { id: newUuid(), paused: false, last_run: null, anchor_day: null, missed: null, created_date: now() });
}
function getRule(d, id) { const r = d.get("rule", id); if (!r) throw fail(404, "This recurring transaction does not exist"); return clone(r); }
const FIELDS = ["name", "category", "tags", "cents", "type", "person_id", "shares", "paid_by"];

const recurring = {
  list: () => serial(() => new Draft().all("rule").sort((a, b) => (a.created_date < b.created_date ? 1 : a.created_date > b.created_date ? -1 : 0)).map(rulePublic)),
  create: (body) => run(async (d) => {
    const rule = d.put("rule", newRule(prepareRule(d, checkRule(ruleFields(body)))));
    await runRule(d, rule, today());
    return () => rulePublic(read("rule", rule.id));
  }),
  update: (id, body) => run(async (d) => {
    const rule = getRule(d, id);
    const changes = ruleFields(body, true);
    let applyTo = body.applyTo || "later";
    if (applyTo === "future") applyTo = "later";
    if (!["later", "all"].includes(applyTo)) throw fail(422, "applyTo is later or all.");
    let merged = Object.assign(pick(rule, RULE_OWN), changes);
    if (("cents" in changes || "person_id" in changes) && !("shares" in changes)) merged.shares = null;
    merged = prepareRule(d, checkRule(merged));
    const day = today();
    const made = d.all("tx").some((t) => t.recurringID === rule.id);

    if (applyTo === "later" && made) {
      let start;
      if ("startDate" in changes) {
        start = changes.startDate;
        if (start <= day) throw fail(400, "A change from the next charge starts after today. To change past charges too, choose All.");
      } else {
        start = nextDate(rule, day);
        if (start === null) throw fail(400, "This rule has no more charges to change.");
        merged.startDate = start;
      }
      const next = newRule(merged);
      if (!("startDate" in changes) && merged.frequency === rule.frequency && ["monthly", "yearly"].includes(rule.frequency)) {
        // Keep falling on the same day, even if the next charge is on a shorter month's last day
        next.anchor_day = rule.anchor_day || +rule.startDate.slice(8, 10);
      }
      next.last_run = day;
      rule.endDate = addDays(start, -1);
      d.put("rule", rule);
      d.put("rule", next);
      return () => rulePublic(read("rule", next.id));
    }

    const scheduleChanged = ["startDate", "frequency", "interval"].some((k) => merged[k] !== rule[k]);
    const endChanged = merged.endDate !== rule.endDate;
    Object.assign(rule, merged);
    if ("startDate" in changes || "frequency" in changes) rule.anchor_day = null;
    let resurrect = false;
    if (made && applyTo === "all") {
      if (scheduleChanged) {
        // Different dates: make its past again from the new schedule
        for (const t of d.all("tx")) if (t.recurringID === rule.id) d.del("tx", t.id);
        rule.last_run = null;
        resurrect = true;
      } else {
        for (const t of d.all("tx")) {
          if (t.recurringID !== rule.id) continue;
          if (endChanged && rule.endDate !== null && t.date > rule.endDate) { d.del("tx", t.id); continue; }
          d.put("tx", Object.assign(clone(t), pick(merged, FIELDS)));
        }
      }
    } else if (!made) rule.last_run = null;
    d.put("rule", rule);
    await runRule(d, rule, day, null, resurrect);
    return () => rulePublic(read("rule", rule.id));
  }),
  end: (id, body) => run((d) => {
    const rule = getRule(d, id);
    const on = isoDate(body && body.date);
    if (on < rule.startDate) throw fail(400, "A rule cannot end before it starts.");
    rule.endDate = on;
    d.put("rule", rule);
    return () => rulePublic(read("rule", id));
  }),
  pause: (id) => run(async (d) => {
    const rule = getRule(d, id);
    if (!rule.paused) {
      await runRule(d, rule, today());
      rule.paused = true;
      d.put("rule", rule);
    }
    return () => rulePublic(read("rule", id));
  }),
  resume: (id) => run((d) => {
    const rule = getRule(d, id);
    if (rule.paused) {
      const day = today();
      const missed = datesBetween(rule, rule.last_run, day);
      Object.assign(rule, { missed: missed.length ? missed : null, paused: false, last_run: day });
      d.put("rule", rule);
    }
    return () => rulePublic(read("rule", id));
  }),
  missed: (id, body) => run(async (d) => {
    const rule = getRule(d, id);
    if (body && body.add) {
      const made = madeSet(d);
      for (const on of rule.missed || []) if (!made.has(rule.id + "|" + on)) d.put("tx", await makeTransaction(rule, on), { ifAbsent: true });
    }
    rule.missed = null;
    d.put("rule", rule);
    return () => rulePublic(read("rule", id));
  }),
  remove: (id, body) => run((d) => {
    const rule = getRule(d, id);
    d.del("rule", id);
    const all = body && body.applyTo === "all";
    for (const t of d.all("tx")) {
      if (t.recurringID !== rule.id) continue;
      if (all) d.del("tx", t.id);
      // Past transactions stay, as ordinary ones
      else d.put("tx", Object.assign(clone(t), { recurringID: "" }));
    }
    return { ok: true };
  }),
};

/* ---------- categories (routers/categories.py) ---------- */
const byLower = (a, b) => { const x = a.toLowerCase(), y = b.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; };
function catNames(d) { return d.all("cat").map((c) => c.name); }
function iconArg(v) { if (v === undefined || v === null) return ""; const s = String(v); if (!/^[a-z0-9-]{0,64}$/.test(s)) throw fail(422, "icon is an icon's id."); return s; }
function pub(name) { const c = read("cat", name) || {}; return { name, icon: c.icon || null }; }
function catUsage(d, name) {
  return { transactions: d.all("tx").filter((t) => t.category === name).length, recurring: d.all("rule").filter((r) => r.category === name).length };
}
function moveCategory(d, from, to) {
  for (const t of d.all("tx")) if (t.category === from) d.put("tx", Object.assign(clone(t), { category: to }));
  for (const r of d.all("rule")) if (r.category === from) d.put("rule", Object.assign(clone(r), { category: to }));
  for (const i of d.all("irule")) if (i.category === from) d.put("irule", Object.assign(clone(i), { category: to }));
}
const categories = {
  list: () => serial(() => catNames(new Draft()).sort(byLower)),
  icons: () => serial(() => Object.fromEntries(new Draft().all("cat").filter((c) => c.icon).map((c) => [c.name, c.icon]))),
  stats: () => serial(() => { const d = new Draft(), counts = {}; d.all("tx").forEach((t) => { counts[t.category] = (counts[t.category] || 0) + 1; }); return catNames(d).sort(byLower).map((n) => ({ name: n, count: counts[n] || 0 })); }),
  create: (body) => run((d) => {
    const name = String((body && body.name) || "");
    if (!name) throw fail(422, "A category needs a name.");
    if (d.get("cat", name)) throw fail(400, "This category already exists.");
    const icon = iconArg(body.icon);
    d.put("cat", icon ? { name, icon } : { name });
    return () => pub(name);
  }),
  update: (name, body) => run((d) => {
    const cat = d.get("cat", name);
    if (!cat) throw fail(404, "This category does not exist.");
    const to = body && body.name !== undefined && body.name !== null ? String(body.name) : name;
    if (!to.trim()) throw fail(400, "A category needs a name.");
    if (to !== name) {
      if (d.get("cat", to)) throw fail(400, "A category with this name already exists.");
      moveCategory(d, name, to);
      d.del("cat", name);
    }
    // The icon moves with the name; "" goes back to the one picked from the name
    let icon = cat.icon || "";
    if (body && body.icon !== undefined && body.icon !== null) icon = iconArg(body.icon);
    const row = { name: to };
    if (icon) row.icon = icon;
    d.put("cat", row);
    return () => pub(to);
  }),
  usage: (name) => serial(() => catUsage(new Draft(), name)),
  remove: (name, moveTo) => run((d) => {
    if (!d.get("cat", name)) throw fail(404, "This category does not exist.");
    const used = catUsage(d, name);
    if (used.transactions || used.recurring) {
      if (!moveTo || moveTo === name || !d.get("cat", moveTo)) {
        const n = used.transactions;
        throw fail(400, "Cannot delete category. " + n + " transaction" + (n !== 1 ? "s" : "") + " " + (n !== 1 ? "are" : "is") + " using this category. Choose where to move them.");
      }
      moveCategory(d, name, moveTo);
    }
    d.del("cat", name);
    return { ok: true };
  }),
};

/* ---------- tags (routers/tags.py) ---------- */
function renameIn(list, from, to) { const out = []; list.forEach((g) => { const v = g === from ? to : g; if (!out.includes(v)) out.push(v); }); return out; }
const tags = {
  list: () => serial(() => new Draft().all("tag").map((g) => g.name).sort(byLower)),
  stats: () => serial(() => {
    const d = new Draft(), counts = {};
    d.all("tx").forEach((t) => (t.tags || []).forEach((g) => { counts[g] = (counts[g] || 0) + 1; }));
    return [...new Set([...d.all("tag").map((g) => g.name), ...Object.keys(counts)])].sort(byLower).map((n) => ({ name: n, count: counts[n] || 0 }));
  }),
  create: (body) => run((d) => {
    const name = String((body && body.name) || "");
    if (!name) throw fail(422, "A tag needs a name.");
    if (d.get("tag", name)) throw fail(400, "This tag already exists.");
    d.put("tag", { name });
    return { name };
  }),
  update: (name, body) => run((d) => {
    if (!d.get("tag", name)) throw fail(404, "This tag does not exist.");
    const to = String((body && body.name) || "").trim().replace(/^#+/, "");
    if (!to) throw fail(400, "A tag needs a name.");
    for (const kind of ["tx", "rule"]) {
      for (const x of d.all(kind)) if ((x.tags || []).includes(name)) d.put(kind, Object.assign(clone(x), { tags: renameIn(x.tags, name, to) }));
    }
    if (to !== name) { d.del("tag", name); d.put("tag", { name: to }); }
    return { name: to };
  }),
  remove: (name) => run((d) => {
    if (!d.get("tag", name)) throw fail(404, "This tag does not exist.");
    for (const kind of ["tx", "rule"]) {
      for (const x of d.all(kind)) if ((x.tags || []).includes(name)) d.put(kind, Object.assign(clone(x), { tags: x.tags.filter((g) => g !== name) }));
    }
    d.del("tag", name);
    return { ok: true };
  }),
};

/* ---------- import (routers/data.py) ---------- */
function words(name) { return new Set((String(name).toLowerCase().match(/[a-z]+/g) || []).filter((w) => w.length >= 3)); }
/* Python's difflib.SequenceMatcher(None, a, b).ratio(), for "MERCADONA 4521 BCN" and "Mercadona" */
export function ratio(a, b) {
  a = Array.from(a); b = Array.from(b);
  if (!a.length && !b.length) return 1;
  const b2j = new Map();
  b.forEach((ch, i) => { if (!b2j.has(ch)) b2j.set(ch, []); b2j.get(ch).push(i); });
  if (b.length >= 200) {
    const ntest = Math.floor(b.length / 100) + 1;
    for (const [ch, list] of [...b2j]) if (list.length > ntest) b2j.delete(ch);
  }
  function longest(alo, ahi, blo, bhi) {
    let besti = alo, bestj = blo, bestsize = 0, j2len = new Map();
    for (let i = alo; i < ahi; i++) {
      const next = new Map();
      for (const j of b2j.get(a[i]) || []) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) || 0) + 1;
        next.set(j, k);
        if (k > bestsize) { besti = i - k + 1; bestj = j - k + 1; bestsize = k; }
      }
      j2len = next;
    }
    while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) { besti--; bestj--; bestsize++; }
    while (besti + bestsize < ahi && bestj + bestsize < bhi && a[besti + bestsize] === b[bestj + bestsize]) bestsize++;
    return [besti, bestj, bestsize];
  }
  let matched = 0;
  const queue = [[0, a.length, 0, b.length]];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop();
    const [i, j, k] = longest(alo, ahi, blo, bhi);
    if (k) {
      matched += k;
      if (alo < i && blo < j) queue.push([alo, i, blo, j]);
      if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
    }
  }
  return (2 * matched) / (a.length + b.length);
}
export function similar(a, b) {
  if (!a || !b) return false;
  const wa = words(a), wb = words(b);
  for (const w of wa) if (wb.has(w)) return true;
  return ratio([...wa].sort().join(" "), [...wb].sort().join(" ")) >= 0.75;
}
function importRow(r) {
  let cents = toCents(r.amount);
  if (cents < 0) cents = -cents;
  if (cents === 0) throw fail(422, "amount cannot be zero");
  return {
    date: isoDate(r.date), name: String(r.name || ""), cents, type: type(r.type), category: String(r.category || ""), tags: Array.isArray(r.tags) ? r.tags.map(String) : [],
    person: String(r.person || ""), paid_by: String(r.paid_by === undefined || r.paid_by === null ? "" : r.paid_by), note: String(r.note || ""),
  };
}
async function importRefs(rows) {
  const seen = {}, out = [];
  for (const r of rows) {
    const b = r.date + "|" + r.type + "|" + amountText(r.cents) + "|" + r.name.trim().toLowerCase();
    const n = seen[b] || 0;
    seen[b] = n + 1;
    out.push((await sha256Hex(b + "|" + n)).slice(0, 32));
  }
  return out;
}
function rulesInOrder(d) { return d.all("irule").sort((a, b) => (a.position - b.position) || (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0) || (a.id < b.id ? -1 : 1)); }
function applyRules(rules, name) { const up = name.toUpperCase(); return rules.find((r) => up.includes(r.match.toUpperCase())) || null; }
function personFrom(raw, people) {
  const v = raw.trim().toLowerCase();
  if (!v) return [null, false];
  if (["shared", "compartido", "compartit", "household"].includes(v)) return [null, true];
  return [v in people ? people[v] : null, false];
}
const byStamp = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.created_date < b.created_date ? -1 : a.created_date > b.created_date ? 1 : 0);
const importer = {
  preview: (rawRows) => serial(async () => {
    if (!Array.isArray(rawRows) || !rawRows.length) throw fail(400, "This file has no rows.");
    const rows = rawRows.map(importRow);
    const refs = await importRefs(rows);
    const d = new Draft(), all = d.all("tx").sort(byStamp);
    const people = Object.fromEntries(env.people().map((p) => [p.name.toLowerCase(), p.id]));
    const rules = rulesInOrder(d);
    const refSet = new Set(refs), known = new Set(all.filter((t) => t.import_ref && refSet.has(t.import_ref)).map((t) => t.import_ref));
    const names = new Set(rows.map((r) => r.name.trim().toLowerCase()).filter(Boolean));
    const past = new Map();
    for (const t of all) { const n = t.name.trim().toLowerCase(); if (names.has(n)) past.set(n + "\u0000" + t.type, t); }
    const dates = rows.map((r) => r.date).sort();
    const lo = addDays(dates[0], -3), hi = addDays(dates[dates.length - 1], 3);
    const inWindow = all.filter((t) => t.date >= lo && t.date <= hi);
    const typed = inWindow.filter((t) => !t.import_ref), imported = inWindow.filter((t) => t.import_ref);
    const taken = new Set(), out = [], counts = { new: 0, matched: 0, possible: 0, skipped: 0 };
    rows.forEach((row, i) => {
      const ref = refs[i];
      const item = { index: i, import_ref: ref, status: "new", match: null, rule_id: null };
      let [personId, shared] = personFrom(row.person, people);
      let category = row.category;
      const lname = row.name.trim().toLowerCase();
      if (known.has(ref)) item.status = "skipped";
      else if (imported.some((t) => t.type === row.type && t.cents === row.cents && t.date === row.date && t.name.trim().toLowerCase() === lname)) item.status = "skipped";
      else {
        const same = typed.filter((t) => !taken.has(t.id) && t.type === row.type && t.cents === row.cents && Math.abs(daysBetween(t.date, row.date)) <= 3);
        const match = same.find((t) => similar(t.name, row.name)) || null;
        const possible = match ? null : same.find((t) => t.date === row.date) || null;
        if (match || possible) {
          const hit = match || possible;
          taken.add(hit.id);
          item.status = match ? "matched" : "possible";
          item.match = { id: hit.id, name: hit.name, date: hit.date, category: hit.category, person_id: hit.person_id };
        } else {
          const rule = applyRules(rules, row.name);
          const last = past.get(lname + "\u0000" + row.type);
          if (rule) {
            item.rule_id = rule.id;
            if (!category) category = rule.category;
            if (!row.person && rule.set_person) { personId = rule.person_id; shared = rule.person_id === null; }
          } else if (last) {
            if (!category) category = last.category;
            if (!row.person) { personId = last.person_id; shared = last.person_id === null; }
          }
        }
      }
      Object.assign(item, { category, person_id: personId, shared });
      counts[item.status]++;
      out.push(item);
    });
    return { rows: out, counts };
  }),
  commit: (body) => run((d) => {
    const ids = peopleIds(), rules = rulesInOrder(d).map(clone), me = actor();
    const refs = new Set(d.all("tx").map((t) => t.import_ref).filter(Boolean));
    let added = 0, matched = 0;
    const used = new Map();
    for (const raw of (body && body.rows) || []) {
      if (raw.action === "skip") continue;
      const row = importRow(raw);
      const ref = String(raw.import_ref || "");
      if (!ref || refs.has(ref)) continue;
      if (raw.action === "match") {
        const hit = raw.match_id ? d.get("tx", canon(raw.match_id)) : null;
        if (!hit) throw fail(400, "A matched transaction no longer exists. Preview the file again.");
        d.put("tx", Object.assign(clone(hit), { import_ref: ref, source: { name: row.name, date: row.date } }));
        refs.add(ref);
        matched++;
        continue;
      }
      if (raw.action !== "add") throw fail(422, "action is add, match or skip.");
      let data = {
        name: row.name, category: row.category || "Miscellaneous", tags: cleanTags(row.tags), cents: row.cents, type: row.type, date: row.date, note: row.note,
        person_id: raw.shared ? null : intOrNull(raw.person_id, "person_id"), shares: null, paid_by: /^\d+$/.test(row.paid_by) ? Number(row.paid_by) : null,
      };
      // Not said in the file and no rule: it was whoever imports it
      if (data.person_id === null && !raw.shared && ids.length >= 2 && ids.includes(me)) data.person_id = me;
      data = prepare(d, data, ids);
      d.put("tx", newTx(data, { import_ref: ref }));
      refs.add(ref);
      const rule = applyRules(rules, row.name);
      if (rule) { rule.uses = (rule.uses || 0) + 1; used.set(rule.id, rule); }
      added++;
    }
    used.forEach((r) => d.put("irule", r));
    return { added, matched };
  }),
  rules: () => serial(() => rulesInOrder(new Draft())),
};

/* ---------- people (routers/people.py): the parts that touch transactions ---------- */
function respread(item, removed, left, moveTo) {
  if (item.person_id === removed) { item.person_id = moveTo; item.shares = null; item.paid_by = null; }
  if (item.person_id !== null) return item;
  if (left.length < 2) { item.shares = null; item.paid_by = null; return item; }
  if (item.paid_by === removed) item.paid_by = left.includes(moveTo) ? moveTo : left[0];
  if (item.shares && String(removed) in item.shares) {
    const cents = item.cents;
    const shares = {};
    for (const [k, v] of Object.entries(item.shares)) if (k !== String(removed) && left.includes(Number(k))) shares[k] = v;
    if (!Object.keys(shares).length) item.shares = evenShares(cents, left, item.paid_by);
    else {
      const heir = left.includes(moveTo) ? String(moveTo) : String(item.paid_by || left[0]);
      shares[heir] = (shares[heir] || 0) + item.shares[String(removed)];
      item.shares = shares;
    }
  }
  return item;
}
function convertTags(d, map, removeTag, rest) {
  const tagsMap = {};
  for (const [tag, pid] of Object.entries(map)) tagsMap[tag.replace(/^#+/, "")] = Number(pid);
  rest = rest === undefined || rest === null ? null : Number(rest);
  for (const pid of new Set([...Object.values(tagsMap), ...(rest === null ? [] : [rest])])) if (!env.people().some((p) => p.id === pid)) throw fail(404, "This person does not exist.");
  const counts = Object.fromEntries(Object.values(tagsMap).map((p) => [p, 0]));
  // A few of each person's, newest first, as the server gives them (api/routers/people.py)
  const examples = Object.fromEntries(Object.values(tagsMap).map((p) => [p, []]));
  const newest = (a, b) => String(b.date).localeCompare(String(a.date)) || String(b.created_date || "").localeCompare(String(a.created_date || ""));
  let shared = 0, rested = 0;
  for (const kind of ["tx", "rule"]) {
    for (const row0 of kind === "tx" ? [...d.all(kind)].sort(newest) : d.all(kind)) {
      const found = (row0.tags || []).filter((g) => g in tagsMap);
      if (!found.length) {
        // The rest, shared evenly, becomes one person's (api/routers/people.py)
        if (rest !== null && row0.person_id === null && !(row0.shares && Object.keys(row0.shares).length) && (row0.paid_by === null || row0.paid_by === undefined)) {
          d.put(kind, Object.assign(clone(row0), { person_id: rest }));
          if (kind === "tx") rested++;
        }
        continue;
      }
      const row = clone(row0);
      const owners = new Set(found.map((g) => tagsMap[g]));
      if (owners.size === 1) {
        row.person_id = [...owners][0]; row.shares = null; row.paid_by = null;
        if (kind === "tx") {
          counts[row.person_id]++;
          const seen = examples[row.person_id];
          if (row.name && !seen.includes(row.name) && seen.length < 3) seen.push(row.name);
        }
      } else if (kind === "tx") shared++;
      if (removeTag) row.tags = row.tags.filter((g) => !found.includes(g));
      d.put(kind, row);
    }
  }
  return { counts, shared, examples, rest: rested };
}
const people = {
  usage: (id) => serial(() => {
    const d = new Draft(), pid = Number(id);
    const txs = d.all("tx");
    return {
      own: txs.filter((t) => t.person_id === pid).length,
      shared: txs.filter((t) => t.person_id === null && ((t.shares && String(pid) in t.shares) || t.paid_by === pid)).length,
      rules: d.all("rule").filter((r) => r.person_id === pid).length,
    };
  }),
  remove: (id, body, send) => {
    const pid = Number(id);
    const moveTo = body && body.move_to !== undefined && body.move_to !== null ? Number(body.move_to) : null;
    return run((d) => {
      const left = peopleIds().filter((i) => i !== pid);
      if (moveTo !== null && !left.includes(moveTo)) throw fail(400, "Move their transactions to someone still here.");
      for (const kind of ["tx", "rule"]) {
        for (const x of d.all(kind)) {
          if (kind === "tx" && x.person_id !== pid && x.person_id !== null) continue;
          const before = JSON.stringify([x.person_id, x.shares, x.paid_by]);
          const item = respread(clone(x), pid, left, moveTo);
          if (JSON.stringify([item.person_id, item.shares, item.paid_by]) !== before) d.put(kind, item);
        }
      }
      return { ok: true };
    // Their transactions move and they leave the household in one save
    }, { via: (ops) => send("DELETE", "/people/" + pid, { move_to: moveTo, ops }) });
  },
  tagPreview: (tag) => serial(() => { const g = String(tag || "").replace(/^#+/, ""); return { tag: g, count: new Draft().all("tx").filter((t) => (t.tags || []).includes(g)).length }; }),
  fromTag: (id, body) => run((d) => { const r = convertTags(d, { [body.tag]: Number(id) }, body.remove_tag !== false); return { ok: true, count: r.counts[Number(id)] }; }),
  fromTags: (body, preview) => preview
    ? serial(() => convertTags(new Draft(), body.tags || {}, body.remove_tag !== false, body.rest))
    : run((d) => Object.assign({ ok: true }, convertTags(d, body.tags || {}, body.remove_tag !== false, body.rest))),
};

/* ---------- the routes ---------- */
const dec = (s) => decodeURIComponent(s);
/* A transaction or rule id as the server takes it: with or without dashes, any case */
const canon = (s) => { const h = String(s).toLowerCase(); return /^[0-9a-f]{32}$/.test(h) ? uuid(h) : h; };
const idArg = (s) => canon(dec(s));
const ROUTES = [
  ["GET", /^\/ledger$/, () => serial(ledger)],
  ["GET", /^\/transactions\/id\/([^/]+)$/, (m) => serial(() => { const t = base("tx", idArg(m[1])); return t ? [txPublic(t)] : []; })],
  ["POST", /^\/transactions$/, (m, b) => tx.create(b)],
  ["POST", /^\/transactions\/group$/, (m, b) => tx.group(b)],
  ["POST", /^\/transactions\/bulk$/, (m, b) => tx.bulk(b || {})],
  ["POST", /^\/transactions\/restore$/, (m, b) => tx.restore(b)],
  ["PUT", /^\/transactions\/([^/]+)$/, (m, b) => tx.update(idArg(m[1]), b || {})],
  ["DELETE", /^\/transactions\/([^/]+)$/, (m) => tx.remove(idArg(m[1]))],
  ["GET", /^\/recurring$/, () => recurring.list()],
  ["GET", /^\/recurring\/([^/]+)$/, (m) => serial(() => { const r = base("rule", idArg(m[1])); return r ? [rulePublic(r)] : []; })],
  ["POST", /^\/recurring$/, (m, b) => recurring.create(b || {})],
  ["PUT", /^\/recurring\/([^/]+)$/, (m, b) => recurring.update(idArg(m[1]), b || {})],
  ["POST", /^\/recurring\/([^/]+)\/end$/, (m, b) => recurring.end(idArg(m[1]), b)],
  ["POST", /^\/recurring\/([^/]+)\/pause$/, (m) => recurring.pause(idArg(m[1]))],
  ["POST", /^\/recurring\/([^/]+)\/resume$/, (m) => recurring.resume(idArg(m[1]))],
  ["POST", /^\/recurring\/([^/]+)\/missed$/, (m, b) => recurring.missed(idArg(m[1]), b)],
  ["DELETE", /^\/recurring\/([^/]+)$/, (m, b) => recurring.remove(idArg(m[1]), b)],
  ["GET", /^\/categories$/, () => categories.list()],
  ["GET", /^\/categories\/icons$/, () => categories.icons()],
  ["GET", /^\/categories\/stats$/, () => categories.stats()],
  ["POST", /^\/categories$/, (m, b) => categories.create(b || {})],
  ["GET", /^\/categories\/(.+)\/usage$/, (m) => categories.usage(dec(m[1]))],
  ["PUT", /^\/categories\/([^/?]+)$/, (m, b) => categories.update(dec(m[1]), b || {})],
  ["DELETE", /^\/categories\/([^/?]+)$/, (m, b, q) => categories.remove(dec(m[1]), q.get("move_to"))],
  ["GET", /^\/tags$/, () => tags.list()],
  ["GET", /^\/tags\/stats$/, () => tags.stats()],
  ["POST", /^\/tags$/, (m, b) => tags.create(b || {})],
  ["PUT", /^\/tags\/([^/]+)$/, (m, b) => tags.update(dec(m[1]), b || {})],
  ["DELETE", /^\/tags\/([^/]+)$/, (m) => tags.remove(dec(m[1]))],
  ["GET", /^\/rules$/, () => importer.rules()],
  ["POST", /^\/import\/preview$/, (m, b) => importer.preview(b)],
  ["POST", /^\/import\/commit$/, (m, b) => importer.commit(b)],
  ["GET", /^\/people\/(\d+)\/usage$/, (m) => people.usage(m[1])],
  ["GET", /^\/people\/from-tag\/preview$/, (m, b, q) => people.tagPreview(q.get("tag"))],
  ["POST", /^\/people\/(\d+)\/from-tag$/, (m, b) => people.fromTag(m[1], b || {})],
  ["POST", /^\/people\/from-tags\/preview$/, (m, b) => people.fromTags(b || {}, true)],
  ["POST", /^\/people\/from-tags$/, (m, b) => people.fromTags(b || {}, false)],
];
/* Paths only the server can answer, even when encrypted */
export const LOCAL = /^\/(transactions|ledger|recurring|categories|tags|summary|import|rules)(\/|$|\?)|^\/people\/(\d+\/usage|\d+\/from-tag|from-tags?)(\/|$|\?)/;

/* Answer a request from the copy, the way the server would. send() reaches the server. */
export async function handle(method, path, body, send) {
  const [p, qs] = path.split("?");
  const q = new URLSearchParams(qs || "");
  if (method === "DELETE") {
    const m = /^\/people\/(\d+)$/.exec(p);
    if (m) return people.remove(m[1], body, send);
  }
  for (const [mt, re, fn] of ROUTES) {
    if (mt !== method) continue;
    const m = re.exec(p);
    if (m) return fn(m, body, q);
  }
  throw fail(409, "This isn’t available while Wally is encrypted.");
}
export function isLocal(method, path) {
  if (method === "DELETE" && /^\/people\/\d+$/.test(path.split("?")[0])) return true;
  return LOCAL.test(path);
}
export { onRemote };
