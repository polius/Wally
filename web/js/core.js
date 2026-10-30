/* Wally core: the API, the data held in the browser, and the helpers every page uses.
   Every figure on every page is worked out here, in the browser, from the ledger. */

export const $ = (id) => document.getElementById(id);
export const DAY = 864e5;

/* ---------- translation ----------
   English text is the key. A language file maps it to the translation; anything missing
   falls back to English, so a raw key is never shown. */
let DICT = {};
export let LANG = "en";
export function t(s, vars) {
  let out = DICT[s];
  if (typeof out !== "string" || !out) out = s;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return out;
}
/* Plurals: tn(3, "{n} transaction", "{n} transactions"). A language with more forms gives an
   object {one, few, many, other} under the singular English text. */
const PLURAL = {};
export function tn(n, one, other, vars) {
  const rules = PLURAL[LANG] || (PLURAL[LANG] = new Intl.PluralRules(LANG));
  const entry = DICT[one];
  const all = Object.assign({ n: num(n) }, vars || {});
  if (entry && typeof entry === "object") {
    const form = entry[rules.select(n)] || entry.other || other;
    return form.replace(/\{(\w+)\}/g, (m, k) => (k in all ? all[k] : m));
  }
  return t(n === 1 ? one : other, all);
}
export const LANGUAGES = [
  ["en", "English"], ["es", "Español"], ["ca", "Català"], ["fr", "Français"], ["de", "Deutsch"], ["it", "Italiano"], ["pt", "Português"],
  ["ru", "Русский"], ["zh", "中文"], ["ja", "日本語"], ["ko", "한국어"], ["hi", "हिन्दी"], ["ar", "العربية"],
];
export async function loadLanguage(lang) {
  LANG = LANGUAGES.some((l) => l[0] === lang) ? lang : "en";
  DICT = {};
  if (LANG !== "en") {
    try {
      const r = await fetch(`/locales/${LANG}.json`, { cache: "no-cache" });
      if (r.ok) DICT = await r.json();
    } catch (e) { /* English it is */ }
  }
  document.documentElement.lang = LANG;
  document.documentElement.dir = LANG === "ar" ? "rtl" : "ltr";
  makeFormats();
}

/* ---------- API ---------- */
export class ApiError extends Error {
  constructor(status, detail) {
    const message = typeof detail === "string" ? detail : (detail && (detail.message || (Array.isArray(detail) && detail[0] && detail[0].msg))) || t("Something went wrong.");
    super(message);
    this.status = status;
    this.detail = detail;
  }
}
const listeners = { signedout: [], change: [] };
export function on(name, fn) { (listeners[name] = listeners[name] || []).push(fn); }
export function emit(name, data) { (listeners[name] || []).forEach((fn) => fn(data)); }

export async function api(method, path, body, opts) {
  const headers = { Accept: "application/json" };
  const who = localStorage.getItem("wally.person");
  if (who && state.status && !state.status.signin) headers["X-Wally-Person"] = who;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  let r;
  try {
    r = await fetch("/api" + path, { method, headers, body: payload, credentials: "same-origin" });
  } catch (e) {
    throw new ApiError(0, t("Wally can’t be reached. Check your connection."));
  }
  if (r.status === 401 && !(opts && opts.quiet401)) emit("signedout");
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  if (!r.ok) throw new ApiError(r.status, data && data.detail !== undefined ? data.detail : data);
  return data;
}
export const GET = (p, o) => api("GET", p, undefined, o);
export const POST = (p, b, o) => api("POST", p, b === undefined ? {} : b, o);
export const PUT = (p, b, o) => api("PUT", p, b, o);
export const DEL = (p, b, o) => api("DELETE", p, b, o);

/* ---------- dates: ISO strings, in the browser's own day ---------- */
export function pad(n) { return (n < 10 ? "0" : "") + n; }
export function ds(y, m, d) { return y + "-" + pad(m) + "-" + pad(d); }
export function T(s) { return Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)); }
export function S(ms) { return new Date(ms).toISOString().slice(0, 10); }
export function addD(s, n) { return S(T(s) + n * DAY); }
export function dim(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
export function wd(s) { return new Date(T(s)).getUTCDay(); }
export function span(a, b) { return Math.round((T(b) - T(a)) / DAY) + 1; }
export function ym(s) { return [+s.slice(0, 4), +s.slice(5, 7)]; }
export function ymAdd(y, m, k) { m += k; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return [y, m]; }
export function mmin(a, b) { return a < b ? a : b; }
export function mmax(a, b) { return a > b ? a : b; }
export function localToday() { const d = new Date(); return ds(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
export let TODAY = localToday();
export let START = TODAY.slice(0, 8) + "01";
export function refreshToday() { TODAY = localToday(); }
export function monthsIn(a, b) { const o = []; let c = ym(a); const e = ym(b); while (c[0] < e[0] || (c[0] === e[0] && c[1] <= e[1])) { o.push(c); c = ymAdd(c[0], c[1], 1); } return o; }
export function monthBounds(y, m) { const s = ds(y, m, 1), e = ds(y, m, dim(y, m)); return [s, e < TODAY ? e : TODAY]; }

/* Week start: Monday, Sunday or Saturday, from Settings */
export function weekStart() { return (state.config && state.config.week_start) || "mon"; }
export function wkOff(s) { const w = wd(s); return weekStart() === "sun" ? w : weekStart() === "sat" ? (w + 1) % 7 : (w + 6) % 7; }
export function dows(short) {
  const first = weekStart() === "sun" ? 0 : weekStart() === "sat" ? 6 : 1;
  const out = [];
  for (let i = 0; i < 7; i++) out.push(F.wd[short ? "narrow" : "short"][(first + i) % 7]);
  return out;
}

/* ---------- formats ---------- */
export const F = { months: [], monthsIn: [], mon: [], wd: { narrow: [], short: [], long: [] } };
let NUM, NUM0, NUMP, PCT;
function makeFormats() {
  const loc = LANG;
  const m = (opt) => new Intl.DateTimeFormat(loc, Object.assign({ timeZone: "UTC" }, opt));
  const mLong = m({ month: "long" }), mShort = m({ month: "short" });
  const standalone = (fmt, i) => { const p = fmt.formatToParts(Date.UTC(2026, i, 15)).find((x) => x.type === "month"); return p ? p.value : fmt.format(Date.UTC(2026, i, 15)); };
  F.months = []; F.monthsIn = []; F.mon = [];
  for (let i = 0; i < 12; i++) {
    const L = standalone(mLong, i);
    F.monthsIn.push(L);  // as written inside a sentence: "octubre" in Spanish, "October" in English
    F.months.push(L.charAt(0).toLocaleUpperCase(loc) + L.slice(1));  // as a heading
    F.mon.push(standalone(mShort, i).replace(/\.$/, ""));
  }
  ["narrow", "short", "long"].forEach((k) => { const w = m({ weekday: k }); F.wd[k] = []; for (let i = 0; i < 7; i++) F.wd[k].push(w.format(Date.UTC(2026, 1, 1 + i))); });
  F.dayMonth = m({ day: "numeric", month: "short" });
  F.dayMonthLong = m({ day: "numeric", month: "long" });
  F.full = m({ weekday: "long", day: "numeric", month: "long" });
  F.fullYear = m({ day: "numeric", month: "long", year: "numeric" });
  F.monthYear = m({ month: "long", year: "numeric" });
  F.monYear = m({ month: "short", year: "numeric" });
  F.weekdayShort = m({ weekday: "short", day: "numeric", month: "short" });
  NUM = new Intl.NumberFormat(loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  NUM0 = new Intl.NumberFormat(loc, { maximumFractionDigits: 0 });
  NUMP = new Intl.NumberFormat(loc, { maximumFractionDigits: 1 });
  PCT = new Intl.NumberFormat(loc, { style: "percent", maximumFractionDigits: 0 });
}
makeFormats();
export function num(n) { return NUM0.format(n); }
export function num1(n) { return NUMP.format(n); }
export function pct(x) { return PCT.format(x); }
export function decSep() { return NUM.formatToParts(1.5).find((p) => p.type === "decimal").value; }

export function symbol() { return (state.currency && state.currency.symbol) || "€"; }
function withSymbol(s, neg) {
  const sym = symbol();
  const before = state.currency && state.currency.position === "left";
  const body = (neg ? "\u2212" : "") + (before ? sym + s : s + "\u00a0" + sym);
  // Inside right-to-left text an amount stays one left-to-right piece
  return LANG === "ar" ? "\u2066" + body + "\u2069" : body;
}
/* Money: f(12.5) → "12,50 €" with the household's symbol and position, in the reader's language */
export function f(n) { return withSymbol(NUM.format(Math.abs(n)), n < 0 && Math.abs(n) >= 0.005); }
export function f0(n) { return withSymbol(NUM0.format(Math.abs(Math.round(n))), Math.round(n) < 0); }
export function fk(n) {
  const a = Math.abs(n);
  if (a >= 1000) return withSymbol(NUMP.format(Math.round(a / 100) / 10) + "k", n < 0);
  return withSymbol(NUM0.format(Math.round(a)), n < 0);
}
export function fc(cents) { return f(cents / 100); }
export function bigMoney(n) {
  const s = f(n), sep = decSep(), i = s.lastIndexOf(sep);
  if (i < 0) return esc(s);
  const m = s.slice(i).match(/^(.\d+)(.*)$/);
  return esc(s.slice(0, i)) + '<span class="c">' + esc(m ? m[1] : s.slice(i)) + "</span>" + esc(m ? m[2] : "");
}
export function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
export function dlab(s) { return F.dayMonth.format(T(s)); }
export function dlabW(s) { return F.weekdayShort.format(T(s)); }
export function dlabL(s) { return F.full.format(T(s)); }
export function dlabY(s) { return F.fullYear.format(T(s)); }
export function monthName(m) { return F.months[m - 1]; }
/* A month inside a sentence */
export function monthIn(m) { return F.monthsIn[m - 1]; }
export function monthYear(y, m) { return F.monthYear.format(Date.UTC(y, m - 1, 15)); }

/* Amount typed by hand: "12,40", "1.234,56", "12.40+8.15" → euros, or null */
export function parseAmt(s) {
  if (s == null) return null;
  let v = String(s).trim().replace(/[\s €$£¥₹₩₺₽₪]/g, "");
  if (!v) return null;
  const lastDot = v.lastIndexOf("."), lastComma = v.lastIndexOf(",");
  if (lastDot > -1 && lastComma > -1) {
    if (lastComma > lastDot) v = v.replace(/\./g, "").replace(",", ".");
    else v = v.replace(/,/g, "");
  } else if (lastComma > -1) {
    v = /,\d{3}$/.test(v) && v.split(",").length > 2 ? v.replace(/,/g, "") : v.replace(",", ".");
  }
  const n = Number(v);
  return isFinite(n) ? n : null;
}
/* Sums in the amount field: 12.40+8.15−3 */
export function evalAmt(s) {
  const raw = String(s || "").replace(/−/g, "-").replace(/\s/g, "");
  if (!raw) return null;
  const parts = raw.match(/[+-]?[^+-]+/g);
  if (!parts) return null;
  let total = 0;
  for (const p of parts) {
    const sign = p[0] === "-" ? -1 : 1;
    const v = parseAmt(p.replace(/^[+-]/, ""));
    if (v === null) return null;
    total += sign * v;
  }
  return Math.round(total * 100) / 100;
}
export const toCents = (n) => Math.round(n * 100);

/* ---------- the data held in the browser ---------- */
export const state = {
  status: null,          // /auth/status
  people: [],            // [{id, name, ...}] in order
  me: null,              // person key of whoever is using this browser
  tx: [],                // the ledger, newest first
  rules: [],             // recurring rules
  config: {},
  currency: { symbol: "€", position: "right", selected: "EUR", currencies: [] },
  categories: [],        // names, in order
  tags: [],
  irules: [],
  prefs: {},
  scope: "all",          // "all" or a person key
  hide: false,           // Hide amounts
};
export function personKey(id) { return id === null || id === undefined ? null : String(id); }
export function person(key) { return state.people.find((p) => String(p.id) === String(key)) || null; }
export function pname(key) { if (key === null || key === undefined || key === "shared") return t("Shared"); const p = person(key); return p ? p.name : t("Someone"); }
export function pindex(key) { const i = state.people.findIndex((p) => String(p.id) === String(key)); return i < 0 ? 0 : i; }
export function initial(name) { return (name || "?").trim().charAt(0).toLocaleUpperCase(LANG); }
export function av(key, cls) {
  if (key === null || key === undefined || key === "shared") return '<span class="w-av shared ' + (cls || "") + '" aria-hidden="true"></span>';
  if (key === "all") return '<span class="w-av both ' + (cls || "") + '" aria-hidden="true"></span>';
  return '<span class="w-av p' + (pindex(key) % 6) + " " + (cls || "") + '" aria-hidden="true">' + esc(initial(pname(key))) + "</span>";
}
export function couple() { return state.people.length >= 2; }

/* A row of /ledger: [id, date, name, category, cents, type, created, person_id, created_by, shares, paid_by, tags, recurring_id, note, group_id, import_ref, source] */
function uuid(hex) { return hex.length === 32 ? hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20) : hex; }
export function fromRow(r) {
  return fromLedger({ i: uuid(r[0]), d: r[1], n: r[2], c: r[3], a: r[4], t: r[5], ca: r[6], p: r[7], cb: r[8], s: r[9], b: r[10], g: r[11], r: r[12], o: r[13], gr: r[14], im: r[15], src: r[16] });
}
/* A transaction from the ledger or from the API, in the shape every page uses */
export function fromLedger(r) {
  const shc = r.s || null;
  const sh = shc ? Object.fromEntries(Object.entries(shc).map(([k, v]) => [k, v / 100])) : null;
  return {
    id: r.i, d: r.d, n: r.n || "", c: r.c, a: r.a / 100, ac: r.a, type: r.t === "i" ? "income" : "expense",
    p: personKey(r.p), sh, shc, by: personKey(r.b), tags: (r.g || []).map((g) => "#" + g),
    rec: !!r.r, rid: r.r || "", note: r.o || "", cb: personKey(r.cb), gr: r.gr || null, im: !!r.im, ir: typeof r.im === "string" ? r.im : null, src: r.src || null, ca: r.ca || "",
  };
}
export function fromApi(x) {
  return fromLedger({
    i: x.id, d: x.date, n: x.name, c: x.category, a: toCents(Number(x.amount)), t: x.type === "income" ? "i" : "e",
    p: x.person_id, s: x.shares, b: x.paid_by, g: x.tags, r: x.recurringID, o: x.note, cb: x.created_by, gr: x.group_id,
    im: x.import_ref || 0, src: x.source, ca: x.created_date,
  });
}
/* Back to the API's shape, for saving */
export function toApi(t) {
  return {
    name: t.n, category: t.c, tags: (t.tags || []).map((g) => g.replace(/^#/, "")), amount: (t.ac !== undefined ? t.ac / 100 : t.a).toFixed(2),
    type: t.type, date: t.d, person_id: t.p === null ? null : Number(t.p), shares: t.shc || null, paid_by: t.by === null || t.by === undefined ? null : Number(t.by), note: t.note || "",
  };
}
export function sortTx() { state.tx.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : a.ca < b.ca ? 1 : a.ca > b.ca ? -1 : 0)); }
export function upsertTx(list) {
  (Array.isArray(list) ? list : [list]).forEach((x) => {
    const t = x.i ? fromLedger(x) : fromApi(x);
    const i = state.tx.findIndex((y) => y.id === t.id);
    if (i >= 0) state.tx[i] = t; else state.tx.push(t);
  });
  sortTx();
  setStart();
}
export function removeTx(ids) { const set = new Set(ids); state.tx = state.tx.filter((t) => !set.has(t.id)); setStart(); }
function setStart() {
  const last = state.tx.length ? state.tx[state.tx.length - 1].d : TODAY;
  START = last.slice(0, 8) + "01";
}

/* The rule shape every page uses */
export function fromRule(r) {
  return {
    id: r.id, n: r.name, c: r.category, a: Number(r.amount), ac: toCents(Number(r.amount)), type: r.type, tags: (r.tags || []).map((g) => "#" + g),
    p: personKey(r.person_id), shc: r.shares || null, sh: r.shares ? Object.fromEntries(Object.entries(r.shares).map(([k, v]) => [k, v / 100])) : null, by: personKey(r.paid_by),
    start: r.startDate, freq: r.frequency, every: r.interval || 1, end: r.endDate ? { type: "until", until: r.endDate } : { type: "never" },
    endDate: r.endDate, paused: !!r.paused, varies: !!r.about, note: r.note || "", anchor: r.anchor_day || null, missed: r.missed || null, lastRun: r.last_run, raw: r,
  };
}

export async function loadAll() {
  const [status, people, ledger, rules, config, currency, categories, tags] = await Promise.all([
    GET("/auth/status"), GET("/people"), GET("/ledger"), GET("/recurring"), GET("/config"), GET("/currency"), GET("/categories"), GET("/tags"),
  ]);
  state.status = status;
  state.people = people;
  state.tx = ledger.rows.map(fromRow);
  setStart();
  state.rules = rules.map(fromRule);
  state.config = config;
  const sel = currency.currencies.find((c) => c.name === currency.selected);
  state.currency = { symbol: sel ? sel.symbol : currency.selected, position: currency.position, selected: currency.selected, currencies: currency.currencies };
  state.categories = categories;
  state.tags = tags;
  const meKey = status.me ? String(status.me.id) : localStorage.getItem("wally.person");
  state.me = person(meKey) ? String(meKey) : null;
  try { state.prefs = state.me ? await GET("/me/prefs") : {}; } catch (e) { state.prefs = {}; }
  loadExtras();
  return state;
}
/* Import rules are not needed to draw the first page */
export async function loadExtras() {
  try {
    state.irules = await GET("/rules");
    emit("change", { extras: true });
  } catch (e) { /* shown when opened */ }
}
export async function reloadRules() { state.rules = (await GET("/recurring")).map(fromRule); }
export async function reloadLedger() { state.tx = (await GET("/ledger")).rows.map(fromRow); setStart(); }
export async function savePrefs(changes) {
  Object.assign(state.prefs, changes);
  if (state.me) { try { await PUT("/me/prefs", changes); } catch (e) { /* kept in this browser */ } }
}

/* ---------- money in a range, for whoever is shown ---------- */
/* A transaction's amount for "all", or for one person: their own, plus their share of shared ones */
export function amt(t, sc) {
  sc = sc || state.scope;
  if (sc === "all" || t.p === sc) return t.a;
  if (t.p === null) {
    if (t.sh) return t.sh[sc] || 0;
    const n = state.people.length;
    return n ? t.a / n : 0;
  }
  return 0;
}
export function inRange(t, a, b) { return t.d >= a && t.d <= b; }
export function totals(a, b, sc) {
  let inc = 0, exp = 0, n = 0;
  for (const t of state.tx) {
    if (t.d < a || t.d > b) continue;
    const v = amt(t, sc);
    if (!v) continue;
    n++;
    if (t.type === "income") inc += v; else exp += v;
  }
  return { inc, exp, net: inc - exp, rate: inc > 0 ? (inc - exp) / inc : null, n };
}
export function byCat(a, b, sc) { const o = {}; for (const t of state.tx) { if (t.type !== "expense" || t.d < a || t.d > b) continue; const v = amt(t, sc); if (v) o[t.c] = (o[t.c] || 0) + v; } return o; }
export function byTag(a, b, sc) { const o = {}; for (const t of state.tx) { if (t.type !== "expense" || t.d < a || t.d > b) continue; const v = amt(t, sc); if (!v) continue; t.tags.forEach((g) => { o[g] = (o[g] || 0) + v; }); } return o; }
export function daily(a, len, sc, type) {
  const arr = new Array(len).fill(0), t0 = T(a);
  for (const t of state.tx) {
    if (t.type !== (type || "expense")) continue;
    const i = Math.round((T(t.d) - t0) / DAY);
    if (i < 0 || i >= len) continue;
    arr[i] += amt(t, sc);
  }
  return arr;
}
export function cum(arr) { const o = []; let s = 0; arr.forEach((v) => { s += v; o.push(s); }); return o; }
export function extend(arr, len) { const o = []; for (let i = 0; i < len; i++) o.push(arr[Math.min(i, arr.length - 1)]); return o; }

/* ---------- categories: v1's nine colors, given by rank in the range shown ---------- */
export const CAT = {};
const ICONS = [
  ["income", /income|salary|salari|sueldo|n[oó]mina|wage|gehalt|salaire|stipendio|freelance|bonus|ingreso|ingr[eé]s|revenu|einkommen|reddito|renda|доход|зарплат|收入|工资|給料|収入|급여|수입|आय|वेतन|دخل|راتب/i],
  ["rent", /rent|alquiler|lloguer|loyer|miete|affitto|aluguel|mortgage|hipoteca|housing|home|house|casa|vivienda|habitatge|logement|wohnung|аренд|жиль|房租|住房|家賃|住宅|월세|주거|किराया|إيجار|سكن/i],
  ["groceries", /grocer|supermarket|super|aliment|compra|courses|lebensmittel|spesa|mercado|продукт|超市|食品|食料|スーパー|식료품|장보기|किराना|بقالة|سوبر/i],
  ["food", /food|restaurant|comida|menjar|dining|eat|café|cafe|coffee|repas|essen|cibo|ristorante|comer|еда|ресторан|餐|吃|外食|食事|식비|외식|भोजन|खाना|طعام|مطعم/i],
  ["travel", /travel|viaje|viatge|voyage|reise|viaggi|viagem|holiday|vacation|vacaciones|vacances|urlaub|flight|vuelo|hotel|путешеств|отпуск|旅|旅行|여행|यात्रा|سفر/i],
  ["utilities", /utilit|bills?|suministro|subministr|factur|électric|electric|water|agua|gas|internet|phone|tel[eé]fon|móvil|mobile|strom|nebenkosten|bollette|contas|коммунал|счет|水电|公共|光熱|公共料金|공과금|बिल|فواتير|مرافق/i],
  ["shopping", /shop|compras|achats|einkauf|acquisti|clothes|ropa|roba|vêtements|kleidung|abbigliamento|roupa|amazon|покупк|одежд|购物|买|買い物|쇼핑|खरीदारी|تسوق/i],
  ["healthcare", /health|salud|salut|santé|gesundheit|salute|saúde|medic|doctor|pharma|farmac|dental|gym|sport|fitness|здоров|медиц|医|健康|의료|건강|स्वास्थ्य|صحة|طب/i],
  ["entertainment", /entertain|ocio|oci|loisir|freizeit|svago|lazer|fun|movie|cine|music|streaming|netflix|spotify|game|juego|развлеч|娱乐|エンタメ|娯楽|오락|여가|मनोरंजन|ترفيه/i],
  ["car", /car|coche|cotxe|voiture|auto|carro|fuel|gasolina|benzin|petrol|parking|transport|taxi|uber|metro|bus|train|tren|машин|транспорт|汽车|交通|車|자동차|교통|गाड़ी|परिवहन|سيارة|مواصلات/i],
  ["gift", /gift|regalo|regal|cadeau|geschenk|presente|подар|礼物|プレゼント|贈|선물|उपहार|هدية/i],
  ["education", /educa|school|escuela|escola|école|schule|scuola|course|curso|book|libro|llibre|livre|buch|образован|учеб|教育|学|교육|शिक्षा|تعليم/i],
  ["pet", /pet|mascota|animal|chien|hund|cane|perro|gos|cat|gato|gat|chat|katze|питом|宠物|ペット|반려|पालतू|حيوان/i],
  ["kids", /kid|child|niñ|nen|enfant|kinder|bambin|criança|baby|bebé|дет|孩|子供|育児|아이|육아|बच्चे|أطفال/i],
  ["savings", /saving|ahorro|estalvi|épargne|sparen|rispar|poupan|invest|inversi|сбереж|инвест|储蓄|投资|貯金|投資|저축|투자|बचत|निवेश|ادخار|استثمار/i],
  ["tax", /tax|impuesto|impost|impôt|steuer|tasse|налог|税|세금|कर|ضريبة/i],
];
export function catIcon(name) {
  for (const [icon, re] of ICONS) if (re.test(name || "")) return icon;
  return "misc";
}
export function cat(name) {
  if (!CAT[name]) CAT[name] = { n: name, c: 9, i: catIcon(name) };
  return CAT[name];
}
/* Colors by rank in the range shown: the biggest category is red, then orange, yellow... grey for the rest */
export function rerank(a, b, sc) {
  const totalsBy = byCat(a, b, sc);
  const names = new Set(state.categories.concat(Object.keys(totalsBy)));
  const ranked = [...names].filter((n) => !isIncomeCat(n)).sort((x, y) => (totalsBy[y] || 0) - (totalsBy[x] || 0) || x.localeCompare(y));
  ranked.forEach((n, i) => { cat(n).c = i < 8 ? i + 1 : 9; });
  names.forEach((n) => { if (isIncomeCat(n)) cat(n).c = 0; });
  return ranked;
}
export function isIncomeCat(name) {
  const inc = state.tx.some((t) => t.c === name && t.type === "income");
  const exp = state.tx.some((t) => t.c === name && t.type === "expense");
  return inc && !exp || (!inc && !exp && catIcon(name) === "income");
}
export function expCats() { return state.categories.filter((c) => !isIncomeCat(c)); }
export function cc(c) { return "var(--c" + cat(c).c + ")"; }
export function icon(id, cls) { return '<svg class="i ' + (cls || "") + '" aria-hidden="true"><use href="#i-' + id + '"/></svg>'; }
export function tile(c, size, col) {
  col = col || cc(c);
  return '<span class="w-ico" style="background:color-mix(in srgb,' + col + " 15%,transparent);color:color-mix(in srgb," + col + " 82%,var(--w-ink))" + (size ? ";width:" + size + "px;height:" + size + "px" : "") + '"><svg class="i" aria-hidden="true"><use href="#i-' + cat(c).i + '"/></svg></span>';
}

/* Settings that matter to a figure */
export function debounce(fn, ms) { let h; return function () { const args = arguments; clearTimeout(h); h = setTimeout(() => fn.apply(this, args), ms); }; }
export function uid() { return Math.random().toString(36).slice(2, 10); }
export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const MOD = isMac ? "⌘" : "Ctrl";
