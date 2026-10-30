/* Settings, every pane and dialog, against a real server.
     BASE=http://localhost:8805 EMPTY=http://localhost:8807 SHOTS=/tmp/shots node settings.mjs
   BASE is a fresh demo household (DEMO=true, people Alex and Ana, sign-in off). The run changes it,
   so start it on an empty data folder each time. EMPTY (optional) is a fresh server without DEMO, for
   the one-person household and empty states. SHOTS (optional) is a folder for screenshots.
   Fails on any console error or page error. */
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.BASE || "http://localhost:8805";
const EMPTY = process.env.EMPTY || "";
const SHOTS = process.env.SHOTS || "";
if (SHOTS && !existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });
const TMP = mkdtempSync(join(tmpdir(), "wally-settings-"));

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log("  ok   " + msg); else { failures++; console.log("  FAIL " + msg); } };
const section = (s) => console.log("\n" + s);

/* ---------- two-step codes, worked out here as an authenticator app would ---------- */
function base32(s) {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of s.replace(/[\s=]/g, "").toUpperCase()) bits += abc.indexOf(ch).toString(2).padStart(5, "0");
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
function totp(secret, at = Date.now()) {
  const counter = Math.floor(at / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", base32(secret)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, "0");
}

/* ---------- the browser ---------- */
const browser = await chromium.launch();
let errors = [];
let allowHttp = 0;   // expected 4xx answers (wrong password and so on) log a resource error in the console
async function newPage(base, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1440, height: 900 }, colorScheme: opts.dark ? "dark" : "light", serviceWorkers: "block", acceptDownloads: true });
  await ctx.addInitScript((who) => { if (!localStorage.getItem("wally.person")) localStorage.setItem("wally.person", who); }, opts.who || "1");
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    if (allowHttp && /Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) return;
    errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message));
  page.on("dialog", (d) => d.dismiss());
  return { ctx, page, base };
}
async function expectHttpError(fn) { allowHttp++; try { return await fn(); } finally { await new Promise((r) => setTimeout(r, 150)); allowHttp--; } }

/* The API, as this browser (same cookies), saying who it is while sign-in is off */
function apiOf(env) {
  return async (method, path, body, headers = {}) => {
    const r = await env.ctx.request.fetch(env.base + "/api" + path, { method, data: body, headers: { "X-Wally-Person": "1", ...headers }, failOnStatusCode: false });
    const text = await r.text();
    let data = null; try { data = JSON.parse(text); } catch (e) { data = text; }
    return { status: r.status(), data };
  };
}

const W = await newPage(BASE);
const { page } = W;
const api = apiOf(W);

async function open(path) {
  await page.goto(BASE + path, { waitUntil: "networkidle" });
  await page.waitForSelector("#set-pane .w-group, .w-scell", { timeout: 10000 });
}
async function pane(id) {
  await page.click(`#set-nav a[data-pane="${id}"]`);
  await page.waitForFunction((id) => location.pathname === "/settings/" + id && document.querySelector("#set-pane .w-group"), id);
  await page.waitForTimeout(150);
}
const dialog = () => page.locator("#dlg .w-dialog");
async function dlgOk() { await page.click("#dlg [data-dlg-ok]"); }
async function dlgCancel() { await page.click("#dlg [data-dlg-x]"); await dlgClosed(); }
async function dlgClosed() { await page.waitForFunction(() => document.getElementById("dlg").hidden, null, { timeout: 8000 }); }
async function dlgError() {
  await page.waitForFunction(() => { const e = document.getElementById("dlg-err"); return e && !e.hidden && e.textContent; }, null, { timeout: 8000 });
  return page.textContent("#dlg-err");
}
async function toastText(re) {
  await page.waitForFunction((src) => document.getElementById("toast").classList.contains("on") && new RegExp(src).test(document.getElementById("toast-t").textContent), re.source, { timeout: 8000 });
  return page.textContent("#toast-t");
}
async function undo() { await page.click("#toast-undo"); await toastText(/Undone/); }
async function paneText() { return page.textContent("#set-pane"); }
async function shot(name, p = page) { if (SHOTS) await p.screenshot({ path: join(SHOTS, name + ".png"), fullPage: true }); }

/* ======================================================================= */
section("Layout and moving between panes");
await open("/settings");
ok(await page.locator("#set-nav a").count() === 9, "nine panes in three groups");
ok(await page.getAttribute('#set-nav a[data-pane="people"]', "aria-current") === "page", "/settings opens People on desktop");
ok(/People in this household/.test(await paneText()), "People pane is drawn");
ok(/Wally \d/.test(await page.textContent("#set-nav")), "version at the bottom of the panes");
ok(/2/.test(await page.textContent('#set-nav a[data-pane="people"] span')), "People shows how many");
for (const id of ["categories", "tags", "currency", "import", "keys", "signin", "language", "appearance", "people"]) await pane(id);
ok(true, "every pane opens");
await page.goBack(); await page.waitForFunction(() => location.pathname === "/settings/appearance");
await page.waitForSelector("#set-pane .w-group");
ok(/Theme/.test(await paneText()), "Back goes to the pane before");
await open("/settings/nosuchpane");
ok(await page.getAttribute('#set-nav a[data-pane="people"]', "aria-current") === "page", "an unknown pane falls back to People");
// Keyboard: the panes are links in the tab order
await page.focus('#set-nav a[data-pane="tags"]');
await page.keyboard.press("Enter");
await page.waitForFunction(() => location.pathname === "/settings/tags");
ok(true, "Enter on a pane link opens it");

/* ======================================================================= */
section("People");
await open("/settings/people");
await page.click('[data-act="add"]');
ok(await dialog().isVisible(), "Add a person opens a dialog");
await dlgOk();
ok(/Type their name/.test(await dlgError()), "an empty name is refused in the dialog");
await page.fill("#np-name", "Sam");
await dlgOk(); await dlgClosed();
await toastText(/Added Sam/);
let people = (await api("GET", "/people")).data;
ok(people.some((p) => p.name === "Sam"), "Sam is saved");
const samId = people.find((p) => p.name === "Sam").id;
await page.click('[data-act="add"]');
await page.fill("#np-name", "sam");
await expectHttpError(async () => { await dlgOk(); ok(/already here/.test(await dlgError()), "the API's error shows in the dialog (same name)"); });
await dlgCancel();
// Rename, and focus comes back to the Rename button
await page.click(`[data-act="rename"][data-id="${samId}"]`);
await page.fill("#rp-name", "Samantha");
await page.keyboard.press("Enter"); await dlgClosed();
await toastText(/Renamed to Samantha/);
await page.waitForTimeout(100);
ok(await page.evaluate(() => document.activeElement && document.activeElement.dataset.k) === "rename:" + samId, "focus returns to Rename after the dialog");
// Reorder
await page.click(`[data-act="up"][data-id="${samId}"]`);
await page.waitForTimeout(300);
people = (await api("GET", "/people")).data;
ok(people.map((p) => p.name).join() === "Alex,Samantha,Ana", "moving up saves the order");
await page.reload(); await page.waitForSelector("#set-pane .w-group");
ok((await page.locator("#set-pane .w-gi h6").allTextContents()).slice(0, 3).join("|").replace(/\s+/g, " ").includes("Samantha"), "order kept after reload");
// Remove, moving her transactions to Alex
const own = await api("POST", "/transactions", { name: "Sam's lunch", category: "Food", amount: "9.50", type: "expense", date: "2026-10-20", person_id: samId });
ok(own.status === 200, "a transaction of Samantha's for the test");
await page.click(`[data-act="remove"][data-id="${samId}"]`);
await page.waitForSelector("#dlg .w-opts");
ok(/1 transaction of their own/.test(await dialog().textContent()), "remove dialog says what she has (from /usage)");
ok(await page.isChecked('#dlg input[name="rp-to"][value="1"]'), "it suggests you as the heir");
await page.check('#dlg input[name="rp-to"][value="2"]');
await dlgOk(); await dlgClosed();
await toastText(/Removed Samantha/);
const moved = (await api("GET", "/transactions/search?text=" + encodeURIComponent("Sam's lunch"))).data;
ok(moved.length === 1 && moved[0].person_id === 2, "her transaction went to Ana");
ok(!(await paneText()).includes("Samantha"), "she is gone from the list");

// Turn a tag into a person
const before = (await api("GET", "/people/from-tag/preview?tag=sport")).data.count;
await page.click('[data-act="fromtag"]');
await page.selectOption("#ft-tag", "sport");
await page.selectOption("#ft-person", "2");
await page.waitForFunction((n) => document.getElementById("ft-preview").textContent.includes(n + " transactions have #sport"), String(before));
ok(true, "preview counts the tag's transactions (" + before + ")");
await dlgOk(); await dlgClosed();
await toastText(new RegExp("Moved " + before + " transactions to Ana"));
const tagsAfter = (await api("GET", "/tags/stats")).data;
ok(!tagsAfter.some((t) => t.name === "sport" && t.count > 0), "the tag is taken off them");

// No settling up; your own row can switch who is using this browser
ok(!/Settled payments|Settle up|owes/.test(await paneText()), "no settle up and no who-owes-whom");
ok(await page.locator("#set-pane [data-switch]").count() === 1, "Switch sits on your own row");
ok(await page.locator("#side [data-switch], #side .w-me").count() === 0, "and no longer in the sidebar");

/* ======================================================================= */
section("Categories");
await pane("categories");
ok(await page.locator("#set-pane .w-ramp span").count() === 9, "the rank ramp");
await page.fill("#cat-new", "Pets");
await page.keyboard.press("Enter");
await toastText(/Added Pets/);
ok((await api("GET", "/categories")).data.includes("Pets"), "a category is added");
await page.click('[data-act="rename"][data-name="Pets"]');
await page.fill("#cr-name", "Food");
await dlgOk();
ok(/already a category/.test(await dlgError()), "renaming into an existing name is refused");
await page.fill("#cr-name", "Animals");
await dlgOk(); await dlgClosed();
ok((await api("GET", "/categories")).data.includes("Animals"), "renamed");
await page.click('[data-act="delete"][data-name="Animals"]');
await toastText(/Deleted Animals/);
ok(!(await api("GET", "/categories")).data.includes("Animals"), "an unused category deletes at once");
await undo();
ok((await api("GET", "/categories")).data.includes("Animals"), "Undo brings it back");
const stats = Object.fromEntries((await api("GET", "/categories/stats")).data.map((c) => [c.name, c.count]));
await page.click('[data-act="delete"][data-name="Travel"]');
await page.waitForSelector("#cd-to");
ok(new RegExp(stats.Travel + " transactions").test(await dialog().textContent()), "delete asks where its " + stats.Travel + " transactions go");
await page.selectOption("#cd-to", "Shopping");
await dlgOk(); await dlgClosed();
await toastText(/Deleted Travel/);
const stats2 = Object.fromEntries((await api("GET", "/categories/stats")).data.map((c) => [c.name, c.count]));
ok(!("Travel" in stats2) && stats2.Shopping === stats.Shopping + stats.Travel, "they moved to Shopping");
await page.reload(); await page.waitForSelector("#set-pane .w-group");
ok(!(await paneText()).includes("Travel"), "and it stays gone after reload");

/* ======================================================================= */
section("Tags");
await pane("tags");
await page.fill("#tag-new", "#work");
await page.click('[data-act="add"]');
await toastText(/Added #work/);
await page.click('[data-act="rename"][data-name="work"]');
await page.fill("#tr-name", "job");
await dlgOk(); await dlgClosed();
ok((await api("GET", "/tags")).data.includes("job"), "a tag is renamed");
const tstats = Object.fromEntries((await api("GET", "/tags/stats")).data.map((c) => [c.name, c.count]));
await page.click('[data-act="merge"][data-name="holiday"]');
await page.selectOption("#tr-name", "gift");
await dlgOk(); await dlgClosed();
await toastText(/Merged #holiday into #gift/);
const tstats2 = Object.fromEntries((await api("GET", "/tags/stats")).data.map((c) => [c.name, c.count]));
ok(!("holiday" in tstats2) && tstats2.gift === tstats.gift + tstats.holiday, "merge moves every transaction to the other tag");
// Typing an existing name in Rename turns it into a merge
await page.click('[data-act="rename"][data-name="job"]');
await page.fill("#tr-name", "coffee");
ok(/already exists/.test(await page.textContent("#tr-hint")) && (await page.textContent("#dlg [data-dlg-ok]")) === "Merge", "rename into an existing tag says it merges");
await dlgCancel();
await page.click('[data-act="delete"][data-name="job"]');
await dlgOk(); await dlgClosed();
ok(!(await api("GET", "/tags")).data.includes("job"), "a tag is deleted after confirming");

/* ======================================================================= */
section("Currency");
await pane("currency");
await page.selectOption("#cur-sel", "USD");
await toastText(/USD/);
ok((await api("GET", "/currency")).data.selected === "USD", "main currency saved");
ok(/\$/.test(await page.textContent("#cur-preview")), "the preview uses the new symbol");
await page.click('#cur-pos [data-v="left"]');
await page.waitForFunction(() => /^\$1/.test(document.getElementById("cur-preview").textContent));
ok((await api("GET", "/currency")).data.position === "left", "symbol before, saved and previewed live");
await page.click('[data-act="add"]');
await page.fill("#cu-name", "xbt"); await page.fill("#cu-sym", "₿");
await dlgOk(); await dlgClosed();
ok((await api("GET", "/currency")).data.currencies.some((c) => c.name === "XBT" && c.symbol === "₿"), "a currency is added (code upper-cased)");
await page.click('[data-act="more"]');
await page.click('[data-act="edit"][data-name="XBT"]');
await page.fill("#cu-name", "XBC");
await dlgOk(); await dlgClosed();
ok((await api("GET", "/currency")).data.currencies.some((c) => c.name === "XBC"), "and edited");
await page.click('[data-act="delete"][data-name="XBC"]');
await toastText(/Deleted XBC/);
await undo();
ok((await api("GET", "/currency")).data.currencies.some((c) => c.name === "XBC"), "delete has Undo");
ok(await page.locator('[data-act="delete"][data-name="USD"]').count() === 0, "the currency in use can't be deleted");
await page.selectOption("#cur-sel", "EUR");
await page.click('#cur-pos [data-v="right"]');
await page.waitForTimeout(300);

/* ======================================================================= */
section("Import and export");
await pane("import");
const ledger = (await api("GET", "/ledger")).data;
const col = Object.fromEntries(ledger.columns.map((c, i) => [c, i]));
const typed = ledger.rows.filter((r) => !r[col.imported] && r[col.type] === "e" && r[col.date] <= "2026-10-20");
const t1 = typed.find((r) => /mercadona/i.test(r[col.name])) || typed[0];
const t2 = typed.find((r) => r !== t1 && r[col.date] !== t1[col.date] && !typed.some((x) => x !== r && x[col.date] === r[col.date] && x[col.cents] === r[col.cents]));
const dmy = (iso) => iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4);
const money = (c) => (c / 100).toFixed(2).replace(".", ",");
// v1 file: name,category,tags,amount,type,date
const v1 = "name,category,tags,amount,type,date\nPiano lesson,Education,\"music,kids\",45.00,expense,2026-10-02\nBook fair,Entertainment,,12.50,expense,2026-10-03\nRefund,Income,,30.00,income,2026-10-04\n";
writeFileSync(join(TMP, "v1.csv"), v1);
await page.setInputFiles("#imp-file", join(TMP, "v1.csv"));
await page.waitForSelector(".w-imp-map");
ok(/Wally v1 file/.test(await paneText()), "the v1 format is recognised");
ok((await page.$$eval(".w-imp-map select", (s) => s.map((x) => x.value))).join() === "name,category,tags,amount,type,date", "its columns are mapped");
ok(await page.inputValue("#imp-datefmt") === "ymd", "and its dates read as YYYY-MM-DD");
await page.click('[data-act="preview"]');
await page.waitForSelector(".w-imp-prev");
ok(/3 new/.test(await page.textContent(".w-imp-counts")), "preview: 3 new");
await page.click('[data-act="commit"]');
await toastText(/Imported 3/);
const piano = (await api("GET", "/transactions/search?text=Piano")).data;
ok(piano.length === 1 && piano[0].tags.join() === "music,kids" && piano[0].category === "Education", "v1 rows are saved with category and tags");
ok((await api("GET", "/transactions/search?text=Refund")).data.some((x) => x.type === "income"), "the income row is income");
await page.click('[data-act="reset"]');
await page.setInputFiles("#imp-file", join(TMP, "v1.csv"));
await page.click('[data-act="preview"]');
await page.waitForSelector(".w-imp-prev");
ok(/3 imported before/.test(await page.textContent(".w-imp-counts")), "importing it again: all skipped");
ok((await page.textContent("#imp-foot")).includes("Nothing new to import"), "and there is nothing to commit");
await page.click('#imp-foot [data-act="reset"]');

// A bank file: semicolons, DD/MM/YYYY, signed amounts, one typed by hand, one possible match, one new, one bad
const bank = "Fecha;Concepto;Importe\n" +
  dmy(t1[col.date]) + ";" + (t1[col.name] || "SHOP").toUpperCase() + " 4521 BCN;-" + money(t1[col.cents]) + "\n" +
  dmy(t2[col.date]) + ";ZXQ PAYMENT 7781;-" + money(t2[col.cents]) + "\n" +
  "13/10/2026;BIZUM FROM JO;+60,00\n" +
  "31/02/2026;BROKEN DATE;-5,00\n" +
  "14/10/2026;NEW SHOP 22;-17,35\n";
writeFileSync(join(TMP, "bank.csv"), bank);
await page.setInputFiles("#imp-file", join(TMP, "bank.csv"));
await page.waitForSelector(".w-imp-map");
ok((await page.$$eval(".w-imp-map select", (s) => s.map((x) => x.value))).join() === "date,name,amount", "bank columns are guessed (Fecha, Concepto, Importe)");
ok(await page.inputValue("#imp-datefmt") === "dmy", "DD/MM/YYYY is detected");
await page.click('[data-act="preview"]');
await page.waitForSelector(".w-imp-prev");
const counts = await page.textContent(".w-imp-counts");
ok(/1 already added/.test(counts) && /1 possible match/.test(counts) && /2 new/.test(counts), "preview counts: 1 matched, 1 possible, 2 new (" + counts.trim() + ")");
ok(/1 row can’t be read/.test(await paneText()), "the bad date is listed as unreadable");
ok(/Decide 1 possible match/.test(await page.textContent("#imp-foot")) && await page.isDisabled('#imp-foot [data-act="commit"]'), "you must decide on the possible match first");
await page.selectOption(".w-imp-prev select[data-dec]", "match");
await page.click('#imp-filter [data-v="all"]');
ok(/\+/.test(await page.textContent(".w-imp-prev tbody")), "positive amounts are income");
// Change the category and the person of the new BIZUM row
const bizum = page.locator(".w-imp-prev tr", { hasText: "BIZUM" });
await bizum.locator("select[data-cat]").selectOption("Income");
await bizum.locator("select[data-who]").selectOption("2");
ok(/1 row has no category/.test(await paneText()), "rows without a category are counted");
await page.selectOption("#imp-fill", "Shopping");
await page.click('#imp-foot [data-act="commit"]');
await toastText(/Imported 2, kept 2 once/);
const bz = (await api("GET", "/transactions/search?text=BIZUM")).data;
ok(bz.length === 1 && bz[0].category === "Income" && bz[0].person_id === 2 && bz[0].type === "income", "the row's category and person were used");
ok((await api("GET", "/transactions/search?text=NEW%20SHOP")).data[0].category === "Shopping", "the rest got the category given to all");
const t1after = (await api("GET", "/transactions/id/" + t1[col.id])).data[0];
ok(t1after && t1after.source && /4521/.test(t1after.source.name), "the matched one keeps the bank's name as its source");
await page.click('[data-act="reset"]');
await page.setInputFiles("#imp-file", join(TMP, "bank.csv"));
await page.click('[data-act="preview"]');
await page.waitForSelector(".w-imp-prev");
ok(/4 imported before/.test(await page.textContent(".w-imp-counts")), "re-importing the bank file skips every row");
await page.click('#imp-foot [data-act="reset"]');
await shot("import-done");

// Export
const [dl] = await Promise.all([page.waitForEvent("download"), page.click('[data-act="export"]')]);
const csv = readFileSync(await dl.path(), "utf8").replace(/^﻿/, "");
const lines = csv.trim().split(/\r?\n/);
const nTx = (await api("GET", "/ledger")).data.rows.length;
ok(lines[0] === "date,name,category,amount,type,tags,person,paid_by,shares,note", "export header");
ok(lines.length - 1 === nTx, "export has every transaction (" + nTx + ")");
ok(/^wally-\d{4}-\d\d-\d\d\.csv$/.test(dl.suggestedFilename()), "export file name");
ok(lines.some((l) => /Piano lesson,Education,45\.00,expense,"music,kids"/.test(l)), "tags are written as v1 does");
ok(lines.some((l) => /,shared,(Alex|Ana),Alex:\d+\.\d\d;Ana:\d+\.\d\d,/.test(l)), "shared rows carry payer and shares");
// The export imports back: everything is either already there or imported before
writeFileSync(join(TMP, "export.csv"), csv);
await page.setInputFiles("#imp-file", join(TMP, "export.csv"));
await page.waitForSelector(".w-imp-map");
ok(/Wally export/.test(await paneText()), "a Wally export is recognised");
await page.click('[data-act="preview"]');
await page.waitForSelector(".w-imp-prev", { timeout: 20000 });
// Only the two rows matched to the bank file show as new: they carry the bank's fingerprint now
const reCounts = (await page.textContent(".w-imp-counts")).trim();
ok(/^[0-2] new/.test(reCounts), "re-importing the export adds nothing typed or imported before (" + reCounts + ")");
await page.click('#imp-foot [data-act="reset"]');

/* ======================================================================= */
section("API keys");
await pane("keys");
await page.fill("#key-name", "Test script");
await page.click('[data-act="create"]');
await page.waitForSelector("#key-raw");
const rawKey = (await page.textContent("#key-raw")).trim();
ok(/^wly_[0-9a-f]{60}$/.test(rawKey), "the new key is shown once");
await page.click("#dlg [data-copy]");
await toastText(/Key copied/);
await dlgOk(); await dlgClosed();
const viaKey = await fetch(BASE + "/api/transactions", { method: "POST", headers: { "X-API-Key": rawKey, "Content-Type": "application/json" }, body: JSON.stringify({ name: "Shortcut coffee", amount: "2.20", category: "Food", person_id: 1 }) });
const viaKeyJson = await viaKey.json();
ok(viaKey.status === 200 && viaKeyJson.created_by === 1, "the key adds a transaction, added by its owner");
await page.reload(); await page.waitForSelector("#set-pane .w-group");
// The keys arrive after the pane is drawn
await page.waitForFunction(() => /Test script/.test(document.getElementById("set-pane").textContent) && /\d/.test(document.querySelector('#set-nav a[data-pane="keys"] span').textContent), null, { timeout: 8000 }).catch(() => {});
ok(/Test script/.test(await paneText()) && /last used just now/.test(await paneText()) && /Alex/.test(await paneText()), "the list shows owner and last used");
ok(/1/.test(await page.textContent('#set-nav a[data-pane="keys"] span')), "the pane list counts keys");
await page.click('[data-act="ios"]');
ok((await dialog().textContent()).includes(BASE + "/api/transactions") && (await dialog().textContent()).includes("X-API-Key"), "iPhone steps show the exact request");
await dlgOk(); await dlgClosed();
await page.click('[data-act="android"]');
ok((await page.textContent("#sc-req")).includes('"amount": "{amount}"'), "Android request with variables");
await dlgOk(); await dlgClosed();
const keyId = (await api("GET", "/api-keys")).data[0].id;
await page.click(`[data-act="delete"][data-id="${keyId}"]`);
await dlgOk(); await dlgClosed();
ok((await api("GET", "/api-keys")).data.length === 0, "a key is deleted after confirming");

/* ======================================================================= */
section("Appearance");
await pane("appearance");
await page.click('#ap-theme [data-v="dark"]');
ok(await page.getAttribute("html", "data-theme") === "dark", "Dark applies at once");
await shot("appearance-dark");
await page.click('#ap-theme [data-v="light"]');
ok(await page.getAttribute("html", "data-theme") === "light", "Light");
await page.click('#ap-theme [data-v="auto"]');
ok(await page.getAttribute("html", "data-theme") === null, "Auto follows the device");
await page.click("#hide-toggle");
ok(await page.evaluate(() => document.documentElement.classList.contains("w-hide")), "Hide amounts on");
await page.click("#hide-toggle");
ok(!(await page.evaluate(() => document.documentElement.classList.contains("w-hide"))), "and off");
await page.click('#ap-week [data-v="sun"]');
await page.waitForTimeout(300);
ok((await api("GET", "/config")).data.week_start === "sun", "Week starts on Sunday saved");
await page.selectOption("#tz-sel", "Europe/Madrid");
await toastText(/Europe\/Madrid/);
ok((await api("GET", "/config")).data.timezone === "Europe/Madrid", "time zone saved");
await page.selectOption("#tz-sel", "");
await toastText(/follows the server/);
await page.reload(); await page.waitForSelector("#set-pane .w-group");
ok(await page.getAttribute('#ap-week [data-v="sun"]', "aria-pressed") === "true", "week start is kept after reload");
await page.click('#ap-week [data-v="mon"]');
await page.waitForTimeout(300);
ok(!/Open on/.test(await paneText()), "no Open on: Wally always opens on the Dashboard");

/* ======================================================================= */
section("Language");
await pane("language");
await page.click('[data-lang="es"]');
await page.waitForFunction(() => document.documentElement.lang === "es", null, { timeout: 8000 });
await page.waitForSelector("#set-pane .w-group");
ok((await api("GET", "/language")).data.language === "es", "Español saved, and Wally reloaded in it");
await page.click('[data-lang="ar"]');
await page.waitForFunction(() => document.documentElement.dir === "rtl", null, { timeout: 8000 });
await page.waitForSelector("#set-pane .w-group");
const navBox = await page.locator("#set-nav").boundingBox(), paneBox = await page.locator("#set-pane").boundingBox();
ok(navBox.x > paneBox.x, "Arabic mirrors the layout (panes on the right)");
await shot("arabic");
await page.click('[data-lang="en"]');
await page.waitForFunction(() => document.documentElement.lang === "en" && document.documentElement.dir === "ltr", null, { timeout: 8000 });
await page.waitForSelector("#set-pane .w-group");

/* ======================================================================= */
section("Sign-in");
await pane("signin");
await page.click("#si-toggle");
await page.waitForSelector("#so-me");
await page.fill("#so-me", "short");
await page.fill("#so-p2", "anapassword");
await dlgOk();
ok(/at least 8/.test(await dlgError()), "a short password is refused in the dialog");
await page.fill("#so-me", "alexpassword");
await dlgOk(); await dlgClosed();
await toastText(/Sign-in is on/);
let status = (await api("GET", "/auth/status")).data;
ok(status.signin && status.me && status.me.id === 1, "sign-in is on and this browser stays signed in as Alex");
await page.reload(); await page.waitForSelector("#set-pane .w-group");
ok(/On/.test(await page.textContent('#set-nav a[data-pane="signin"] span')), "still in after reload (session cookie)");
ok(/Password set · Two-step off/.test(await paneText()), "Household shows each person's status");
const anon = await fetch(BASE + "/api/ledger");
ok(anon.status === 401, "without the cookie, the API now asks to sign in");
ok((await fetch(BASE + "/api/ledger", { headers: { "X-API-Key": rawKey } })).status === 401, "the deleted API key no longer works");
// Change password
await page.click('[data-act="password"]');
await page.fill("#pw-cur", "wrongwrong"); await page.fill("#pw-new", "alexpassword2"); await page.fill("#pw-rep", "alexpassword2");
await expectHttpError(async () => { await dlgOk(); ok(/not right/.test(await dlgError()), "a wrong current password is refused"); });
await page.fill("#pw-cur", "alexpassword"); await page.fill("#pw-rep", "different1");
await dlgOk();
ok(/not the same/.test(await dlgError()), "the two new passwords must match");
await page.fill("#pw-rep", "alexpassword2");
await dlgOk(); await dlgClosed();
await toastText(/Password changed/);
// Two-step: set up with a real QR and secret, confirm with a code worked out here
await page.click('[data-act="2on"]');
await page.waitForSelector("#ts-secret");
const qrPath = await page.getAttribute("#dlg svg.w-qr path", "d");
ok(qrPath && qrPath.length > 500, "a real QR code is drawn");
const secret = (await page.textContent("#ts-secret")).replace(/\s/g, "");
ok(/^[A-Z2-7]{32}$/.test(secret), "the secret is shown to type in");
await page.fill("#ts-code", "000000");
await expectHttpError(async () => { await dlgOk(); ok(/not right/.test(await dlgError()), "a wrong code is refused"); });
await page.fill("#ts-code", totp(secret));   // sent as soon as the sixth digit is typed
await page.waitForSelector("#rc-codes", { timeout: 8000 });
const codes = await page.$$eval("#rc-codes span", (s) => s.map((x) => x.textContent));
ok(codes.length === 10, "ten recovery codes are shown");
const [rcDl] = await Promise.all([page.waitForEvent("download"), page.click("#dlg [data-save]")]);
ok(readFileSync(await rcDl.path(), "utf8").includes(codes[0]), "recovery codes download");
await dlgOk(); await dlgClosed();
await toastText(/Two-step sign-in is on/);
await page.waitForFunction(() => /10 of 10 left/.test(document.getElementById("set-pane").textContent));
ok(true, "10 of 10 codes left");
// New codes replace the old ones
await page.click('[data-act="codes"]');
await page.fill("#ts-pw", "alexpassword2");
await dlgOk();
await page.waitForSelector("#rc-codes");
const codes2 = await page.$$eval("#rc-codes span", (s) => s.map((x) => x.textContent));
ok(codes2.length === 10 && codes2[0] !== codes[0], "new recovery codes");
await dlgOk(); await dlgClosed();
// Another browser signs in with a recovery code; Settings lists it, then signs it out
const other = await browser.newContext({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
const l1 = await other.request.post(BASE + "/api/login", { data: { person_id: 1, password: "alexpassword2" } });
ok((await l1.json()).code_needed === true, "signing in elsewhere asks for the code");
const oldCode = await other.request.post(BASE + "/api/login/code", { data: { recovery_code: codes[0] }, failOnStatusCode: false });
ok(oldCode.status() === 401, "an old recovery code no longer works");
const l2 = await other.request.post(BASE + "/api/login/code", { data: { recovery_code: codes2[0] } });
ok(l2.status() === 200, "a new recovery code signs in");
await page.reload(); await page.waitForSelector("#set-pane .w-group");
await page.waitForFunction(() => /Safari on iPhone/.test(document.getElementById("set-pane").textContent));
ok(/This browser/.test(await paneText()) && /9 of 10 left/.test(await paneText()), "Signed-in browsers lists both, and 9 codes are left");
await page.click('[data-act="others"]');
await toastText(/Signed out of 1 other browser/);
ok((await other.request.get(BASE + "/api/ledger", { failOnStatusCode: false })).status() === 401, "Sign out others ends the other session");
await other.close();
// Require two-step for everyone
await page.click("#req2-toggle");
await toastText(/next sign-in/);
ok((await api("GET", "/auth/status")).data.require_two_step === true, "two-step required for everyone");
await page.waitForFunction(() => /Asked at next sign-in/.test(document.getElementById("set-pane").textContent));
ok(await page.locator('[data-act="2off"]').count() === 0, "you can't turn yours off while it is required");
await page.click("#req2-toggle");
await toastText(/optional again/);
// Two-step off
await page.click('[data-act="2off"]');
await page.fill("#ts-pw", "alexpassword2");
await dlgOk(); await dlgClosed();
await toastText(/Two-step sign-in is off/);
ok((await api("GET", "/auth/status")).data.me.two_step === false, "two-step off");
await shot("signin-on");
// Turn sign-in off: asks your password
await page.click("#si-toggle");
await page.fill("#sf-pw", "nope");
await expectHttpError(async () => { await dlgOk(); ok(/not right/.test(await dlgError()), "turning off with a wrong password is refused"); });
await page.fill("#sf-pw", "alexpassword2");
await dlgOk(); await dlgClosed();
await toastText(/Sign-in is off/);
ok((await fetch(BASE + "/api/auth/status").then((r) => r.json())).signin === false, "sign-in is off");
await page.reload(); await page.waitForSelector("#set-pane .w-group");
ok(/Off/.test(await page.textContent('#set-nav a[data-pane="signin"] span')), "and Wally still opens in this browser");

/* ======================================================================= */
section("Widths, dark, and the phone");
for (const [w, h] of [[1440, 900], [1100, 800], [900, 800]]) {
  await page.setViewportSize({ width: w, height: h });
  await open("/settings/people");
  const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok(over <= 0, w + " px: no sideways scrolling");
  await shot("people-" + w);
}
const P = await newPage(BASE, { viewport: { width: 390, height: 844 }, dark: true });
await P.page.goto(BASE + "/settings", { waitUntil: "networkidle" });
await P.page.waitForSelector(".w-scell");
ok(await P.page.locator(".w-scell").count() === 9, "phone: Settings is a list of panes");
await shot("phone-list", P.page);
await P.page.click('.w-scell[data-pane="signin"]');
await P.page.waitForSelector("#set-pane .w-group");
ok(P.page.url().endsWith("/settings/signin") && (await P.page.textContent("#set-title")) === "Sign-in", "a pane opens full screen with its title");
ok(await P.page.locator("#set-nav").count() === 0, "without the desktop pane list");
const sw = await P.page.locator("#si-toggle").boundingBox();
ok(sw.height >= 26 && sw.width >= 44, "switches are big enough to tap");
ok(await P.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "390 px: no sideways scrolling");
await shot("phone-signin", P.page);
for (const id of ["people", "import", "keys", "appearance", "currency"]) {
  await P.page.goto(BASE + "/settings/" + id, { waitUntil: "networkidle" });
  await P.page.waitForSelector("#set-pane .w-group");
  ok(await P.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "390 px " + id + ": no sideways scrolling");
  await shot("phone-" + id, P.page);
}
await P.page.click("[data-pane-back]");
await P.page.waitForSelector(".w-scell");
ok(P.page.url().endsWith("/settings"), "Back goes to the list");
await P.page.setViewportSize({ width: 1100, height: 800 });
await P.page.waitForSelector("#set-nav");
ok(true, "widening the window shows the pane list beside the pane");
await shot("dark-1100", P.page);
await P.ctx.close();

/* ======================================================================= */
if (EMPTY) {
  section("A one-person household, empty");
  const E = await newPage(EMPTY);
  const eapi = apiOf(E);
  const me = await eapi("POST", "/people", { name: "Robin" });
  await E.ctx.addInitScript((id) => localStorage.setItem("wally.person", id), String(me.data.id));
  await E.page.goto(EMPTY + "/settings/people", { waitUntil: "networkidle" });
  await E.page.waitForSelector("#set-pane .w-group");
  const txt = await E.page.textContent("#set-pane");
  ok(!/Removing a person/.test(txt) && !(await E.page.locator("#set-pane [data-switch]").count()), "one person: no removing and no Switch");
  for (const [id, re] of [["tags", /No tags yet/], ["keys", /No API keys yet/]]) {
    await E.page.goto(EMPTY + "/settings/" + id, { waitUntil: "networkidle" });
    await E.page.waitForFunction((src) => new RegExp(src).test(document.getElementById("set-pane").textContent), re.source);
    ok(true, id + ": empty state");
  }
  await E.page.goto(EMPTY + "/settings/import", { waitUntil: "networkidle" });
  await E.page.waitForSelector("#set-pane .w-group");
  ok(await E.page.isDisabled('[data-act="export"]'), "nothing to export yet");
  await E.ctx.close();
}

await browser.close();
section("Console");
ok(errors.length === 0, "no console errors" + (errors.length ? ": " + errors.slice(0, 5).join(" | ") : ""));
console.log(failures ? `\n${failures} FAILED` : "\nAll passed");
process.exit(failures ? 1 : 0);
