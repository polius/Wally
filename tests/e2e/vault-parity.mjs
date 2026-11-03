/* The same requests to a household in the clear (answered by the server) and to an encrypted one
   (answered by js/vault/local.js in the browser): every answer, and everything stored after
   every step, must be the same. This is what keeps the two from drifting apart.
     REPO=/path/to/Wally PYTHON=/path/to/python PORT=8898 node vault-parity.mjs */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = process.env.REPO || process.cwd();
const PYTHON = process.env.PYTHON || "python3";
const PORT = +(process.env.PORT || 8898);
let failures = 0, passed = 0;
const ok = (cond, msg) => { if (cond) passed++; else { failures++; console.log("  FAIL " + msg); } };
const servers = [];

async function startServer(port) {
  const data = mkdtempSync(join(tmpdir(), "wally-parity-"));
  const env = { ...process.env, WALLY_DATA: data };
  delete env.DEMO;
  const proc = spawn(PYTHON, ["-m", "uvicorn", "utils.dev_server:app", "--port", String(port)], { cwd: REPO, env, stdio: "ignore" });
  servers.push(proc);
  const base = "http://localhost:" + port;
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(base + "/api/health"); if (r.ok) return base; } catch (e) { /* not yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server did not start");
}
function apiClient(base) {
  let cookie = "";
  return async (method, path, body, headers) => {
    const r = await fetch(base + "/api" + path, { method, headers: { "content-type": "application/json", cookie, ...(headers || {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) {
      const kv = c.split(";")[0], k = kv.split("=")[0];
      cookie = cookie.split("; ").filter((x) => x && !x.startsWith(k + "=")).concat([kv]).join("; ");
    }
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch (e) { data = text; }
    return { status: r.status, data };
  };
}

const D = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const browser = await chromium.launch();
try {
  const [P, E] = await Promise.all([startServer(PORT), startServer(PORT + 1)]);
  // The same household on both: two people, UTC, sign-in on
  const p = apiClient(P), e = apiClient(E);
  for (const c of [p, e]) {
    await c("POST", "/people", { name: "Alex" });
    await c("POST", "/people", { name: "Ana" });
    await c("PUT", "/config", { timezone: "UTC" });
    await c("PUT", "/signin", { enabled: true, password: "house-pass-1" }, { "x-wally-person": "1" });
  }
  await p("POST", "/login", { person_id: 1, password: "house-pass-1" });
  // Colors are given the first time anyone asks; the browser asks when it opens, so ask here too
  await p("GET", "/categories/colors");
  // The encrypted one: Alex turns encryption on in a browser, which then answers everything
  const ctx = await browser.newContext({ serviceWorkers: "block" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (x) => errors.push(x.message));
  await page.goto(E + "/", { waitUntil: "networkidle" });
  await page.click('[data-prof="1"]');
  await page.fill("#si-in", "house-pass-1");
  await page.click("#si-go");
  await page.waitForSelector("#app:not([hidden])");
  await page.evaluate(async () => {
    const s = await import("/js/vault/session.js"); s.bind(await import("/js/core.js"));
    await s.turnOn("house-pass-1");
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("#app:not([hidden])");
  ok(await page.evaluate(async () => (await import("/js/core.js")).vaultOn()), "the browser answers for the encrypted household");
  const local = async (method, path, body) => page.evaluate(async ([m, pa, b]) => {
    const core = await import("/js/core.js");
    try { return { status: 200, data: await core.api(m, pa, b === null ? undefined : b) }; }
    catch (x) { return { status: x.status, data: { detail: x.detail } }; }
  }, [method, path, body === undefined ? null : body]);

  /* ---------- labels: ids differ on the two sides, so everything is named by how it came to be ---------- */
  const sides = { P: { map: new Map(), back: new Map() }, E: { map: new Map(), back: new Map() } };
  const hex = (id) => String(id).replace(/-/g, "").toLowerCase();
  const name = (side, id) => (id === null || id === undefined || id === "" ? id : sides[side].map.get(hex(id)) || "?" + hex(id).slice(0, 6));
  const real = (side, label) => { const r = sides[side].back.get(label); if (!r) throw new Error("no " + label + " on " + side); return r; };
  function learn(side, label, id) { sides[side].map.set(hex(id), label); sides[side].back.set(label, id); }

  const get = (side, path) => (side === "P" ? p("GET", path) : local("GET", path));
  async function state(side) {
    const [led, rules, cats, colors, icons, tags, irules] = await Promise.all(["/ledger", "/recurring", "/categories", "/categories/colors", "/categories/icons", "/tags", "/rules"].map((x) => get(side, x)));
    return { led: led.data, rules: rules.data, cats: cats.data, colors: colors.data, icons: icons.data, tags: tags.data, irules: irules.data };
  }
  /* New transactions and rules since the last step get labels from what they are, the same on both sides */
  function labelNew(side, st, op) {
    const rules = st.rules.filter((r) => !sides[side].map.has(hex(r.id))).sort((a, b) => (a.startDate + a.name).localeCompare(b.startDate + b.name));
    rules.forEach((r, i) => learn(side, op + ":r" + i, r.id));
    const txs = st.led.rows.filter((r) => !sides[side].map.has(hex(r[0])));
    const keyOf = (r) => [r[1], r[2], String(r[4]).padStart(12, "0"), r[3], JSON.stringify(r.slice(7))].join("|");
    const occ = txs.filter((r) => r[12]), own = txs.filter((r) => !r[12]).sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
    for (const r of occ) learn(side, "occ:" + name(side, r[12]) + ":" + r[1], r[0]);
    own.forEach((r, i) => learn(side, op + ":t" + i, r[0]));
  }
  const groups = (side) => new Map();
  function norm(side, st) {
    const g = new Map();
    const rows = st.led.rows.map((r) => {
      const x = r.slice(); while (x.length < 17) x.push(null);
      const gid = x[14];
      if (gid && !g.has(gid)) g.set(gid, null);
      return { id: name(side, x[0]), date: x[1], name: x[2], cat: x[3], cents: x[4], type: x[5], person: x[7], by: x[8], shares: x[9], paid: x[10], tags: x[11], rule: name(side, x[12]), note: x[13], group: gid, ref: x[15], src: x[16] };
    });
    // A group is named after its first part
    for (const gid of g.keys()) g.set(gid, rows.filter((r) => r.group === gid).map((r) => r.id).sort()[0]);
    rows.forEach((r) => { r.group = r.group ? "g:" + g.get(r.group) : null; });
    rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const rules = st.rules.map((r) => ({ ...r, id: name(side, r.id), amount: Math.round(Number(r.amount) * 100), created_date: undefined })).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const irules = st.irules.map((r) => ({ match: r.match, category: r.category, person_id: r.person_id, set_person: r.set_person, uses: r.uses, learned: r.learned, position: r.position }));
    const colors = Object.fromEntries(Object.entries(st.colors).sort());
    const icons = Object.fromEntries(Object.entries(st.icons).sort());
    return JSON.stringify({ rows, rules, cats: st.cats, colors, icons, tags: st.tags, irules });
  }
  const sortKeys = (v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : Array.isArray(v) ? v.map(sortKeys) : v);
  function normBody(side, body) {
    // The order of keys in an object means nothing to the app; the order of a list does
    return JSON.stringify(sortKeys(body), (k, v) => {
      if (k === "created_date" || k === "created_at") return undefined;
      if ((k === "id" || k === "recurringID" || k === "match_id") && typeof v === "string" && v.length >= 32) return name(side, v);
      if (k === "group_id" && v) return "group";
      if (k === "amount" && (typeof v === "string" || typeof v === "number")) return Math.round(Number(v) * 100);
      if (k === "rule_id") return v === null ? null : "rule";
      return v;
    });
  }

  let step = 0;
  /* One request on both sides. path and body may be functions of the side, for ids. */
  async function both(label, method, path, body, opts = {}) {
    step++;
    const res = {};
    for (const side of ["P", "E"]) {
      const pa = typeof path === "function" ? path(side) : path;
      const b = typeof body === "function" ? body(side) : body;
      res[side] = side === "P" ? await p(method, pa, b) : await local(method, pa, b);
    }
    const what = step + ". " + method + " " + (typeof path === "function" ? path("P").replace(/[0-9a-f-]{32,36}/g, "…") : path) + (label ? " (" + label + ")" : "");
    const okStatus = res.P.status === res.E.status || (res.P.status === 422 && res.E.status === 422);
    ok(okStatus, what + ": status " + res.P.status + " vs " + res.E.status + " — " + JSON.stringify(res.E.data).slice(0, 200) + " / " + JSON.stringify(res.P.data).slice(0, 200));
    if (res.P.status === 400 && res.E.status === 400 && !opts.anyMessage) ok(res.P.data.detail === res.E.data.detail, what + ": same message — " + JSON.stringify(res.P.data.detail) + " vs " + JSON.stringify(res.E.data.detail));
    const sts = {};
    for (const side of ["P", "E"]) { sts[side] = await state(side); labelNew(side, sts[side], label || "s" + step); }
    if (res.P.status === 200 && res.E.status === 200 && !opts.skipBody) {
      const a = normBody("P", res.P.data), c = normBody("E", res.E.data);
      ok(a === c, what + ": same answer\n      server:  " + a.slice(0, 600) + "\n      browser: " + c.slice(0, 600));
    }
    const sa = norm("P", sts.P), sb = norm("E", sts.E);
    if (sa !== sb) {
      let i = 0; while (i < sa.length && sa[i] === sb[i]) i++;
      ok(false, what + ": same data afterwards\n      server:  …" + sa.slice(Math.max(0, i - 200), i + 300) + "\n      browser: …" + sb.slice(Math.max(0, i - 200), i + 300));
    } else ok(true, what);
    return res;
  }
  const tx = (side, l) => real(side, l);
  const pub = async (side, l) => (await get(side, "/transactions/id/" + tx(side, l))).data[0];

  console.log("Transactions");
  await both("t1", "POST", "/transactions", { name: "Mercadona", category: "Groceries", amount: "23.45", date: D(3), paid_by: 1, tags: ["#weekly", " weekly ", "x"], note: "Café" });
  await both("t2", "POST", "/transactions", { name: "  Bar Pinotxo ", category: "Food", amount: "10.01", date: D(2) });
  await both("t3", "POST", "/transactions", { name: "Pharmacy", category: "Healthcare", amount: "7.5", date: D(2), person_id: 2, paid_by: 1, shares: { 2: 750 } });
  await both("t4", "POST", "/transactions", { name: "Dentist", category: "Therapy", amount: "80", date: D(4), shares: { 1: 2000, 2: 6000 } });
  await both("t5", "POST", "/transactions", { name: "Salary", category: "Income", amount: "2450.00", date: D(5), type: "income", paid_by: 2 });
  await both("bad shares", "POST", "/transactions", { name: "x", category: "Food", amount: "30", date: D(1), shares: { 1: 1000, 2: 1000 } });
  await both("no category", "POST", "/transactions", { name: "x", category: " ", amount: "3", date: D(1) });
  await both("zero", "POST", "/transactions", { name: "x", category: "Food", amount: "0", date: D(1) });
  await both("stranger", "POST", "/transactions", { name: "x", category: "Food", amount: "3", date: D(1), person_id: 9 });
  await both("g", "POST", "/transactions/group", [{ name: "IKEA", category: "Shopping", amount: "40", date: D(6) }, { name: "IKEA", category: "Food", amount: "4.5", date: D(6), person_id: 1 }]);
  await both("g1", "POST", "/transactions/group", [{ name: "One", category: "Food", amount: "1", date: D(6) }]);
  await both("", "PUT", (s) => "/transactions/" + tx(s, "t1:t0"), { amount: "7.03" });
  await both("", "PUT", (s) => "/transactions/" + tx(s, "t2:t0"), { person_id: 2 });
  await both("", "PUT", (s) => "/transactions/" + tx(s, "t4:t0"), { amount: "81", shares: { 1: 8000, 2: 100 } });
  await both("", "PUT", (s) => "/transactions/" + tx(s, "t1:t0"), { name: "Mercadona 2", category: "Brand new", tags: ["fresh"] });
  await both("", "PUT", (s) => "/transactions/" + tx(s, "t1:t0"), { amount: "0" });
  await both("", "PUT", (s) => "/transactions/" + tx(s, "t5:t0"), { type: "expense" });
  await both("", "PUT", "/transactions/00000000-0000-4000-8000-000000000000", { name: "nobody" });
  await both("", "POST", "/transactions/bulk", (s) => ({ ids: [tx(s, "t1:t0"), tx(s, "t2:t0"), tx(s, "t5:t0")], action: "update", category: "Food" }));
  await both("", "POST", "/transactions/bulk", (s) => ({ ids: [tx(s, "t2:t0"), tx(s, "t3:t0")], action: "update", person_id: null, set_person: true }));
  await both("", "POST", "/transactions/bulk", (s) => ({ ids: [tx(s, "t3:t0")], action: "update", person_id: 1, set_person: true }));
  const gone = { P: await pub("P", "g:t0"), E: await pub("E", "g:t0") };
  await both("", "DELETE", (s) => "/transactions/" + tx(s, "g:t0"));
  await both("", "DELETE", (s) => "/transactions/" + tx(s, "g:t0"));
  await both("restore", "POST", "/transactions/restore", (s) => [gone[s]], { skipBody: false });
  await both("", "POST", "/transactions/bulk", (s) => ({ ids: [tx(s, "g:t1"), tx(s, "t4:t0")], action: "delete" }));

  console.log("Recurring");
  await both("r1", "POST", "/recurring", { name: "Netflix", category: "Entertainment", amount: "13.99", startDate: D(100), frequency: "monthly", paid_by: 2 });
  await both("r2", "POST", "/recurring", { name: "Swim", category: "Healthcare", amount: "32", startDate: D(40), endDate: D(5), frequency: "weekly", interval: 2, person_id: 2 });
  await both("r3", "POST", "/recurring", { name: "Gym", category: "Healthcare", amount: "1.5", startDate: D(3), frequency: "daily", tags: ["#fit"] });
  await both("r4", "POST", "/recurring", { name: "Insurance", category: "Utilities", amount: "384", startDate: "2024-02-29", frequency: "yearly", paid_by: 1 });
  await both("r5", "POST", "/recurring", { name: "Rent", category: "Rent", amount: "1250", startDate: "2026-01-31", frequency: "monthly", paid_by: 1 });
  await both("bad rule", "POST", "/recurring", { name: "x", category: "Food", amount: "1", startDate: D(3), endDate: D(5), frequency: "daily" });
  await both("bad interval", "POST", "/recurring", { name: "x", category: "Food", amount: "1", startDate: D(3), frequency: "daily", interval: 0 });
  await both("later", "PUT", (s) => "/recurring/" + real(s, "r1:r0"), { amount: "15.99", applyTo: "later" });
  await both("later rent", "PUT", (s) => "/recurring/" + real(s, "r5:r0"), { amount: "1300", applyTo: "later" });
  await both("", "PUT", (s) => "/recurring/" + real(s, "r2:r0"), { name: "Swim club", category: "Sport", applyTo: "all" });
  await both("", "PUT", (s) => "/recurring/" + real(s, "r3:r0"), { startDate: D(5), applyTo: "all" });
  await both("", "PUT", (s) => "/recurring/" + real(s, "r3:r0"), { endDate: D(2), applyTo: "all" });
  await both("", "PUT", (s) => "/recurring/" + real(s, "r3:r0"), { startDate: D(1), applyTo: "later" });
  await both("", "PUT", (s) => "/recurring/" + real(s, "r4:r0"), { person_id: 2, applyTo: "all" });
  await both("", "POST", (s) => "/recurring/" + real(s, "later:r0") + "/pause");
  await both("", "POST", (s) => "/recurring/" + real(s, "later:r0") + "/resume");
  await both("", "POST", (s) => "/recurring/" + real(s, "later:r0") + "/missed", { add: true });
  await both("", "POST", (s) => "/recurring/" + real(s, "r2:r0") + "/end", { date: D(30) });
  await both("", "POST", (s) => "/recurring/" + real(s, "r2:r0") + "/end", { date: D(400) });
  await both("", "DELETE", (s) => "/recurring/" + real(s, "r3:r0"), { applyTo: "future" });
  await both("", "DELETE", (s) => "/recurring/" + real(s, "r2:r0"), { applyTo: "all" });

  console.log("Categories and tags");
  await both("", "GET", "/categories/colors");
  await both("", "POST", "/categories", { name: "Kids", color: 3 });
  await both("", "POST", "/categories", { name: "Kids" });
  await both("", "PUT", "/categories/Kids", { color: 5 });
  await both("", "PUT", "/categories/Kids", { icon: "Not an icon" }, { anyMessage: true });
  await both("", "PUT", "/categories/Food", { icon: "pizza" });
  await both("", "PUT", "/categories/Food", { name: "Eating out" });
  await both("", "GET", "/categories/icons");
  await both("", "PUT", "/categories/Eating%20out", { icon: "" });
  await both("", "PUT", "/categories/Eating%20out", { icon: "coffee", color: 2 });
  await both("", "PUT", "/categories/Eating%20out", { name: "Groceries" });
  await both("", "GET", "/categories/Eating%20out/usage");
  await both("", "DELETE", "/categories/Eating%20out", undefined, { anyMessage: false });
  await both("", "DELETE", "/categories/Eating%20out?move_to=Groceries");
  await both("", "DELETE", "/categories/Kids");
  await both("", "GET", "/categories/colors");
  await both("", "POST", "/tags", { name: "holiday" });
  await both("", "POST", "/tags", { name: "holiday" });
  await both("", "PUT", "/tags/weekly", { name: "#week" });
  await both("", "PUT", "/tags/x", { name: "week" });
  await both("", "DELETE", "/tags/fresh");
  await both("", "DELETE", "/tags/nothing");

  console.log("Import");
  const rows = [
    { date: D(2), name: "BAR PINOTXO BARCELONA", amount: "-10.01", type: "expense" },
    { date: D(3), name: "MERCADONA 4521 BCN", amount: "7.03" },
    { date: D(6), name: "SOMETHING ELSE", amount: "-40.00" },
    { date: D(9), name: "Netflix.com", amount: "-13.99" },
    { date: D(1), name: "Glovo 22", amount: "18.20", category: "", person: "shared" },
    { date: D(1), name: "Glovo 22", amount: "18.20", person: "ana" },
    { date: D(1), name: "Uber", amount: "5", tags: ["#trip"], paid_by: "2" },
  ];
  const prev = await both("", "POST", "/import/preview", rows);
  await both("", "POST", "/import/preview", []);
  const commit = (s) => ({ rows: rows.map((r, i) => {
    const pr = (s === "P" ? prev.P : prev.E).data.rows[i];
    return { ...r, import_ref: pr.import_ref, action: pr.status === "matched" || pr.status === "possible" ? "match" : pr.status === "skipped" ? "skip" : "add", match_id: pr.match ? pr.match.id : null, category: pr.category || r.category || "", person_id: pr.person_id, shared: pr.shared };
  }) });
  await both("imp", "POST", "/import/commit", commit);
  await both("", "POST", "/import/commit", commit);
  await both("", "POST", "/import/preview", rows);
  const imported = (s) => (s === "P" ? null : null);
  await both("learn", "PUT", (s) => "/transactions/" + real(s, "imp:t0"), { category: "Transport", person_id: 2 });
  await both("", "POST", "/import/preview", [{ date: D(0), name: "UBER TRIP 33", amount: "-9" }, { date: D(0), name: "uber", amount: "-9" }]);

  console.log("People");
  await both("", "GET", "/people/2/usage");
  await both("", "GET", "/people/from-tag/preview?tag=week");
  await both("", "POST", "/people/2/from-tag", { tag: "week", remove_tag: true });
  await both("", "POST", "/people/from-tags/preview", { tags: { holiday: 1, fit: 2 }, remove_tag: false });
  ok((await p("POST", "/people", { name: "Sam" })).status === 200, "Sam joins the household in the clear, with only a name");
  ok(await page.evaluate(async () => { const c = await import("/js/core.js"); await c.POST("/people", { name: "Sam" }); c.state.people = await c.GET("/people"); return c.state.people.length; }) === 3, "and the encrypted one");
  await both("sam", "POST", "/transactions", { name: "Pizza", category: "Food", amount: "30.01", date: D(1), paid_by: 3 });
  await both("", "POST", "/transactions", { name: "Cinema", category: "Entertainment", amount: "12", date: D(1), person_id: 3 });
  await both("", "POST", "/recurring", { name: "Phone", category: "Utilities", amount: "20", startDate: D(10), frequency: "monthly", person_id: 3 });
  await both("", "GET", "/people/3/usage");
  await both("", "DELETE", "/people/3", { move_to: null });
  await page.evaluate(async () => { const c = await import("/js/core.js"); c.state.people = await c.GET("/people"); });
  await both("after", "POST", "/transactions", { name: "After", category: "Food", amount: "9.99", date: D(0) });
  await both("", "DELETE", "/people/2", { move_to: 1 });

  ok(errors.length === 0, "no errors in the browser" + (errors.length ? ": " + errors.join(" | ") : ""));
} catch (x) {
  failures++;
  console.log("  FAIL " + (x.stack || x));
} finally {
  await browser.close();
  servers.forEach((s) => s.kill("SIGKILL"));
}
console.log(failures ? "\n" + failures + " failed, " + passed + " passed" : "\nAll " + passed + " parity checks passed.");
process.exit(failures ? 1 : 0);
