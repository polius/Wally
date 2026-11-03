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
  await page.waitForSelector("#set-pane .w-gl, #set-pane .w-group, .w-setlist", { timeout: 10000 });
}
async function pane(id) {
  await page.click(`#set-nav a[data-pane="${id}"]`);
  await page.waitForFunction((id) => location.pathname === "/settings/" + id && document.querySelector("#set-pane .w-gl, #set-pane .w-group"), id);
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
/* An item's own page (a person, a category, a tag), opened from its row */
async function openRow(sel) { await page.click(sel); await page.waitForSelector("#set-pane .w-shero"); await page.waitForTimeout(100); }
async function back() { await page.click("#set-head .w-sback"); await page.waitForFunction(() => !document.querySelector("#set-pane .w-shero")); await page.waitForTimeout(100); }
async function editMode(on) { await page.click(`#set-act [data-act="${on ? "edit" : "done"}"]`); await page.waitForTimeout(150); }
async function shot(name, p = page) { if (SHOTS) await p.screenshot({ path: join(SHOTS, name + ".png"), fullPage: true }); }

/* ======================================================================= */
section("Layout and moving between panes");
await open("/settings");
ok(await page.locator("#set-nav a").count() === 8, "eight panes in five groups");
ok((await page.locator("#set-nav .grp > span").allTextContents()).join() === "Household,General,Security,Data,Advanced", "Household, General, Security, Data, Advanced");
ok(await page.getAttribute('#set-nav a[data-pane="people"]', "aria-current") === "page", "/settings opens People on desktop");
ok((await page.textContent("#set-title")) === "People" && await page.locator("#set-pane .w-gl").count() === 1, "People pane is drawn, with its title");
ok(/Wally \d/.test(await page.textContent("#set-nav")), "version at the bottom of the panes");
ok(/2/.test(await page.textContent('#set-nav a[data-pane="people"] .v')), "People shows how many");
for (const id of ["categories", "tags", "region", "appearance", "import", "keys", "security", "people"]) await pane(id);
ok(true, "every pane opens");
await page.goBack(); await page.waitForFunction(() => location.pathname === "/settings/security");
ok(true, "Back goes to the pane before");
for (const [old, now] of [["signin", "security"], ["privacy", "security"], ["language", "region"], ["currency", "region"]]) {
  await open("/settings/" + old);
  ok(await page.getAttribute(`#set-nav a[data-pane="${now}"]`, "aria-current") === "page", "/settings/" + old + " opens " + now);
}
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
ok(await page.locator('#set-pane a.w-gr[data-pane^="people/"]').count() === 2 && !/Rename|Switch/.test(await paneText()), "one row per person, opening their page; no links on the rows");
await page.click('[data-act="add"]');
ok(await page.locator("#dlg .w-sheetd").isVisible(), "Add a Person is a sheet");
ok(await page.isDisabled("#dlg [data-dlg-ok]"), "Add waits for a name");
await page.fill("#np-name", "Sam");
await dlgOk(); await dlgClosed();
await toastText(/Added Sam/);
let people = (await api("GET", "/people")).data;
ok(people.some((p) => p.name === "Sam"), "Sam is saved");
const samId = people.find((p) => p.name === "Sam").id;
await page.click('[data-act="add"]');
await page.fill("#np-name", "sam");
ok(await page.isDisabled("#dlg [data-dlg-ok]") && /Sam is already in the household/.test(await page.textContent("#np-name-note")), "a name already taken: Add waits, and the footnote says who has it");
await dlgCancel();
// Her page: rename from the Name row
await openRow(`#set-pane a[data-pane="people/${samId}"]`);
ok(page.url().endsWith("/settings/people/" + samId) && /Sam/.test(await page.textContent("#set-pane .w-shero")), "her page: picture, name, how many transactions");
ok(await page.locator('#set-pane [data-act="switch"]').count() === 1 && await page.locator('#set-pane .w-gr.red[data-act="remove"]').count() === 1, "Switch to Sam, and one red Remove row");
await page.click('#set-pane [data-act="rename"]');
await page.fill("#rp-name", "Samantha");
await page.keyboard.press("Enter"); await dlgClosed();
await toastText(/Renamed to Samantha/);
ok(/Samantha/.test(await page.textContent("#set-pane .w-shero")), "the page shows the new name");
await back();
// Edit: reorder with the handles (arrow keys)
await editMode(true);
ok(await page.locator("#set-pane [data-grip]").count() === 3 && await page.locator('#set-pane a.w-gr').count() === 0, "Edit shows a handle on each row");
await page.focus(`#set-pane [data-grip="${samId}"]`);
await page.keyboard.press("ArrowUp");
await page.waitForTimeout(400);
people = (await api("GET", "/people")).data;
ok(people.map((p) => p.name).join() === "Alex,Samantha,Ana", "moving up saves the order");
await editMode(false);
await page.reload(); await page.waitForSelector("#set-pane .w-gl");
ok((await page.locator("#set-pane .w-gr .k").allTextContents()).slice(0, 3).join("|").includes("Samantha"), "order kept after reload");
// Remove, moving her transactions to Ana (three people: the alert asks who)
const own = await api("POST", "/transactions", { name: "Sam's lunch", category: "Food", amount: "9.50", type: "expense", date: "2026-10-20", person_id: samId });
ok(own.status === 200, "a transaction of Samantha's for the test");
await openRow(`#set-pane a[data-pane="people/${samId}"]`);
await page.click('#set-pane [data-act="remove"]');
await page.waitForSelector("#dlg .w-alert #rp-to");
ok(/Remove Samantha\?/.test(await dialog().textContent()), "remove is an alert that names her");
ok(await page.inputValue("#rp-to") === "1", "it suggests you as the heir");
await page.selectOption("#rp-to", "2");
await dlgOk(); await dlgClosed();
await toastText(/Removed Samantha/);
await page.waitForFunction(() => location.pathname === "/settings/people");
ok(true, "and goes back to the list");
const moved = (await api("GET", "/transactions/search?text=" + encodeURIComponent("Sam's lunch"))).data;
ok(moved.length === 1 && moved[0].person_id === 2, "her transaction went to Ana");
ok(!(await paneText()).includes("Samantha"), "she is gone from the list");
// Two people: the alert says where things go in a sentence
await openRow('#set-pane a[data-pane="people/2"]');
await page.click('#set-pane [data-act="remove"]');
await page.waitForSelector("#dlg .w-alert");
ok(/move to Alex/.test(await dialog().textContent()) && await page.locator("#rp-to").count() === 0, "with two people, no choice: it says they move to Alex");
await dlgCancel();
await back();

// No settling up; switching lives on the other person's page and under your name
ok(!/Settled payments|Settle up|owes/.test(await paneText()), "no settle up and no who-owes-whom");
ok(!/Turn a tag into a person/.test(await paneText()), "turning a tag into a person moved to Tags");
ok(await page.locator("#side .w-me .w-meb").count() === 1 && await page.locator("#side .w-me [data-switch]").count() === 1, "Switch person at the foot of the sidebar, under your name");

/* ======================================================================= */
section("Categories");
await pane("categories");
ok((await page.locator("#set-pane .w-glh").allTextContents()).join() === "Expenses,Income", "Expenses, then Income");
ok(await page.locator("#set-pane .w-swb, #set-pane .w-link").count() === 0, "no color dots, Rename links or bins on the rows");
await openRow('#set-pane a[data-pane="categories/Rent"]');
ok(/Rent/.test(await page.textContent("#set-pane .w-shero")) && /a month/.test(await page.textContent("#set-pane .w-shero")), "Rent's page: icon, name, how much a month");
const rentColor = (await api("GET", "/categories/colors")).data.Rent;
await page.click('#set-pane [data-act="color"]');
ok(await page.locator("#dlg .w-swatches [role=radio]").count() === 9 && (await page.getAttribute('#dlg .w-swatches [data-c="' + rentColor + '"]', "aria-checked")) === "true", "nine colors to pick from, the one in use ringed");
const otherColor = rentColor === 6 ? 5 : 6;
await page.click('#dlg .w-swatches [data-c="' + otherColor + '"]');
await dlgOk(); await dlgClosed();
ok((await api("GET", "/categories/colors")).data.Rent === otherColor, "Done keeps the color picked");
await page.click('#set-pane [data-act="color"]');
await page.click('#dlg .w-swatches [data-c="' + rentColor + '"]'); await dlgOk(); await dlgClosed();
await page.click('#set-pane [data-act="icon"]');
ok(await page.locator("#ic-list > .w-icgrp").first().locator("[role=radio]").count() === 64 && (await page.getAttribute('#ic-list [data-i="rent"]', "aria-checked")) === "true", "64 suggested icons, the one in use ringed");
await page.waitForFunction(() => document.querySelectorAll("#ic-list [data-i^='l-']").length > 1500, null, { timeout: 8000 });
ok(/Search [\d,]+ icons/.test(await page.getAttribute("#ic-q", "placeholder")), "then all of Lucide's, and the search says how many");
await page.fill("#ic-q", "piggy");
ok((await page.locator("#ic-list [data-i]").first().getAttribute("data-i")) === "savings", "searching by Lucide's words finds Wally's own icon first");
await page.fill("#ic-q", "zzzz");
ok(/No icons match/.test(await page.textContent("#ic-list")), "nothing found says so");
await page.fill("#ic-q", "");
await page.click('#dlg .w-icons [data-i="sofa"]');
ok((await page.getAttribute("#dlg .w-icprev use", "href")) === "#i-sofa", "the big icon on top shows the pick");
await dlgOk(); await dlgClosed();
ok((await api("GET", "/categories/icons")).data.Rent === "sofa" && (await page.getAttribute("#set-pane .w-shero use", "href")) === "#i-sofa", "Done keeps the icon picked, and Rent's page shows it");
await page.click('#set-pane [data-act="icon"]');
await page.fill("#ic-q", "hamburger");
await page.click('#ic-list [data-i="l-hamburger"]'); await dlgOk(); await dlgClosed();
ok((await api("GET", "/categories/icons")).data.Rent === "l-hamburger" && (await page.getAttribute("#set-pane .w-shero use", "href")) === "/icons/lucide.svg#hamburger", "one of Lucide's is kept too, drawn from the library file");
await page.click('#set-pane [data-act="icon"]');
await page.click('#dlg .w-icons [data-i="rent"]'); await dlgOk(); await dlgClosed();
ok(!("Rent" in (await api("GET", "/categories/icons")).data), "picking the name's own icon goes back to following the name");
await back();
await page.click('#set-pane [data-act="add"]');
await page.fill("#cat-new", "Pets");
await page.keyboard.press("Enter"); await dlgClosed();
await toastText(/Added Pets/);
ok((await api("GET", "/categories")).data.includes("Pets"), "a category is added");
await openRow('#set-pane a[data-pane="categories/Pets"]');
await page.click('#set-pane [data-act="rename"]');
await page.fill("#cr-name", "food");
ok(await page.isDisabled("#dlg [data-dlg-ok]") && /Food is already a category\. Merge/.test(await page.textContent("#cr-name-note")), "renaming into an existing name is refused, and the footnote points to Merge");
await page.fill("#cr-name", "");
ok(await page.isDisabled("#dlg [data-dlg-ok]") && /Type a name/.test(await page.textContent("#cr-name-note")), "an emptied name: Done waits and says why");
await page.fill("#cr-name", "Animals");
await dlgOk(); await dlgClosed();
await page.waitForFunction(() => location.pathname === "/settings/categories/Animals");
ok((await api("GET", "/categories")).data.includes("Animals"), "renamed, and its page follows the new name");
await page.click('#set-pane [data-act="delete"]');
await page.waitForSelector("#dlg .w-alert");
ok(/No transactions use it/.test(await dialog().textContent()), "an unused category: a short alert");
await dlgOk(); await dlgClosed();
await toastText(/Deleted Animals/);
ok(!(await api("GET", "/categories")).data.includes("Animals"), "deleted");
await undo();
ok((await api("GET", "/categories")).data.includes("Animals"), "Undo brings it back");
await page.goto(BASE + "/settings/categories", { waitUntil: "networkidle" }); await page.waitForSelector("#set-pane .w-gl");
// Edit: a red minus on each row deletes; Travel's transactions move where you say
const stats = Object.fromEntries((await api("GET", "/categories/stats")).data.map((c) => [c.name, c.count]));
await editMode(true);
ok(await page.locator("#set-pane .w-gminus").count() >= 9, "Edit puts a delete button on each row");
await page.click('#set-pane .w-gminus[data-name="Travel"]');
await page.waitForSelector("#cd-to");
ok(new RegExp(stats.Travel + " transactions").test(await dialog().textContent()), "delete asks where its " + stats.Travel + " transactions go");
await page.selectOption("#cd-to", "Shopping");
await dlgOk(); await dlgClosed();
await toastText(/Deleted Travel/);
const stats2 = Object.fromEntries((await api("GET", "/categories/stats")).data.map((c) => [c.name, c.count]));
ok(!("Travel" in stats2) && stats2.Shopping === stats.Shopping + stats.Travel, "they moved to Shopping");
await editMode(false);
// Merge from a category's page
await openRow('#set-pane a[data-pane="categories/Animals"]');
await page.click('#set-pane [data-act="merge"]');
await page.click('#dlg [data-to="Miscellaneous"]');
await dlgOk(); await dlgClosed();
await toastText(/Merged Animals into Miscellaneous/);
ok(!(await api("GET", "/categories")).data.includes("Animals"), "merging takes the category away");
await page.reload(); await page.waitForSelector("#set-pane .w-gl");
ok(!(await paneText()).includes("Travel"), "and Travel stays gone after reload");

/* ======================================================================= */
section("Tags");
await pane("tags");
await page.click('#set-pane [data-act="add"]');
await page.fill("#tag-new", "#work");
await dlgOk(); await dlgClosed();
await toastText(/Added #work/);
await openRow('#set-pane a[data-pane="tags/work"]');
await page.click('#set-pane [data-act="rename"]');
await page.fill("#tr-name", "job");
await dlgOk(); await dlgClosed();
await page.waitForFunction(() => location.pathname === "/settings/tags/job");
ok((await api("GET", "/tags")).data.includes("job"), "a tag is renamed");
// Typing an existing name in Rename is refused, as for categories: Merge is the way
await page.click('#set-pane [data-act="rename"]');
await page.fill("#tr-name", "coffee");
ok(/#coffee is already a tag\. Merge/.test(await page.textContent("#tr-name-note")) && await page.isDisabled("#dlg [data-dlg-ok]") && (await page.textContent("#dlg [data-dlg-ok]")) === "Done", "rename into an existing tag waits, and points to Merge");
await dlgCancel();
await page.click('#set-pane [data-act="delete"]');
await dlgOk(); await dlgClosed();
await page.waitForFunction(() => location.pathname === "/settings/tags");
ok(!(await api("GET", "/tags")).data.includes("job"), "a tag is deleted after confirming");
const tstats = Object.fromEntries((await api("GET", "/tags/stats")).data.map((c) => [c.name, c.count]));
await openRow('#set-pane a[data-pane="tags/holiday"]');
await page.click('#set-pane [data-act="merge"]');
await page.click('#dlg [data-to="gift"]');
ok(new RegExp("Its " + tstats.holiday + " transactions get #gift instead").test(await page.textContent("#tm-what")), "Merge's header says how many transactions get the tag picked");
await dlgOk(); await dlgClosed();
await toastText(/Merged #holiday into #gift/);
const tstats2 = Object.fromEntries((await api("GET", "/tags/stats")).data.map((c) => [c.name, c.count]));
ok(!("holiday" in tstats2) && tstats2.gift === tstats.gift + tstats.holiday, "merge moves every transaction to the other tag");
// Make this a person
const before = (await api("GET", "/people/from-tag/preview?tag=sport")).data.count;
await openRow('#set-pane a[data-pane="tags/sport"]');
await page.click('#set-pane [data-act="fromtag"]');
await page.click('#dlg [data-who="2"]');
await page.waitForFunction((n) => document.getElementById("ft-what").textContent.includes("Its " + n + " transactions become Ana’s own"), String(before));
ok((await page.textContent("#dlg [data-dlg-ok]")) === "Make", "Make #sport a Person says how many become whose (" + before + "), and its action is Make");
await dlgOk(); await dlgClosed();
await toastText(new RegExp("Moved " + before + " transactions to Ana"));
const tagsAfter = (await api("GET", "/tags/stats")).data;
ok(!tagsAfter.some((t) => t.name === "sport" && t.count > 0), "the tag is taken off them");

/* ======================================================================= */
section("Language & Region");
await pane("region");
ok(/Language/.test(await paneText()) && /Currency/.test(await paneText()) && /Week starts on/.test(await paneText()) && /Time zone/.test(await paneText()), "language, currency, amounts, week and time zone in one place");
await page.click('#set-pane a[data-pane="region/currency"]');
await page.waitForSelector("#cur-q");
ok((await page.textContent("#set-title")) === "Currency" && /Language & Region/.test(await page.textContent("#set-head .w-sback")), "Currency opens as a list, with a way back");
await page.fill("#cur-q", "dollar");
await page.waitForTimeout(150);
ok(await page.locator('#set-pane [data-act="pick-cur"][data-name="USD"]').count() === 1 && await page.locator('#set-pane [data-act="pick-cur"][data-name="GBP"]').count() === 0, "search narrows the list");
await page.click('#set-pane [data-act="pick-cur"][data-name="USD"]');
await toastText(/USD/);
ok((await api("GET", "/currency")).data.selected === "USD", "picking one makes it the main currency");
await page.fill("#cur-q", "");
await page.click('#set-pane [data-act="add"]');
await page.fill("#cu-name", "xbt"); await page.fill("#cu-sym", "₿");
await dlgOk(); await dlgClosed();
ok((await api("GET", "/currency")).data.currencies.some((c) => c.name === "XBT" && c.symbol === "₿"), "a currency is added (code upper-cased)");
await editMode(true);
ok(await page.locator('#set-pane .w-gminus[data-name="USD"]').count() === 0, "the currency in use can't be deleted");
await page.click('#set-pane [data-act="edit-cur"][data-name="XBT"]');
await page.waitForSelector("#cu-name");
ok(await page.evaluate(() => document.activeElement && document.activeElement.matches("[data-dlg-ok]")), "editing a currency opens with Save ready, no field focused");
await page.fill("#cu-name", "XBC");
await dlgOk(); await dlgClosed();
ok((await api("GET", "/currency")).data.currencies.some((c) => c.name === "XBC"), "and edited, in Edit");
await page.click('#set-pane .w-gminus[data-name="XBC"]');
await toastText(/Deleted XBC/);
await undo();
ok((await api("GET", "/currency")).data.currencies.some((c) => c.name === "XBC"), "delete has Undo");
await editMode(false);
await page.click("#set-head .w-sback");
await page.waitForSelector("#cur-pos");
await page.click('#cur-pos [data-v="left"]');
await page.waitForTimeout(300);
ok((await api("GET", "/currency")).data.position === "left", "Amounts: symbol before, saved");
ok(/\$1,234\.56/.test(await page.textContent("#set-pane .w-glf")), "the sample under the rows follows it");
await page.click('#cur-pos [data-v="right"]');
await page.click('#set-pane a[data-pane="region/currency"]'); await page.waitForSelector("#cur-q");
await page.click('#set-pane [data-act="pick-cur"][data-name="EUR"]'); await toastText(/EUR/);
await page.click("#set-head .w-sback"); await page.waitForSelector("#cur-pos");
await page.click('#set-pane a[data-pane="region/week"]');
await page.click('#set-pane [data-act="pick-week"][data-v="sun"]');
await page.waitForFunction(() => location.pathname === "/settings/region");
ok((await api("GET", "/config")).data.week_start === "sun", "Week starts on Sunday saved, and back to Language & Region");
ok(/Sunday/.test(await paneText()), "the row shows it");
await page.click('#set-pane a[data-pane="region/week"]');
await page.click('#set-pane [data-act="pick-week"][data-v="mon"]');
await page.waitForFunction(() => location.pathname === "/settings/region");
await page.click('#set-pane a[data-pane="region/timezone"]');
await page.fill("#tz-q", "madrid");
await page.click('#set-pane [data-act="pick-tz"][data-v="Europe/Madrid"]');
await toastText(/Europe\/Madrid/);
ok((await api("GET", "/config")).data.timezone === "Europe/Madrid", "time zone saved");
await page.click('#set-pane a[data-pane="region/timezone"]');
await page.click('#set-pane [data-act="pick-tz"][data-v=""]');
await toastText(/follows the server/);

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
await page.click('#set-pane [data-act="create"]');
ok(await page.isDisabled("#dlg [data-dlg-ok]"), "New Key waits for a name");
await page.fill("#key-name", "Test script");
await dlgOk();
await page.waitForSelector("#key-raw");
const rawKey = (await page.textContent("#key-raw")).trim();
ok(/^wly_[0-9a-f]{64}$/.test(rawKey), "the new key is shown once");
await page.click("#dlg [data-copy]");
await toastText(/Key copied/);
await dlgOk(); await dlgClosed();
const viaKey = await fetch(BASE + "/api/transactions", { method: "POST", headers: { "X-API-Key": rawKey, "Content-Type": "application/json" }, body: JSON.stringify({ name: "Shortcut coffee", amount: "2.20", category: "Food", person_id: 1 }) });
const viaKeyJson = await viaKey.json();
ok(viaKey.status === 200 && viaKeyJson.created_by === 1, "the key adds a transaction, added by its owner");
await page.reload(); await page.waitForSelector("#set-pane .w-gl");
// The keys arrive after the pane is drawn
await page.waitForFunction(() => /Test script/.test(document.getElementById("set-pane").textContent) && /\d/.test(document.querySelector('#set-nav a[data-pane="keys"] .v').textContent), null, { timeout: 8000 }).catch(() => {});
ok(/Test script/.test(await paneText()) && /last used just now/.test(await paneText()), "the list shows what it can do and when it was used");
ok(/1/.test(await page.textContent('#set-nav a[data-pane="keys"] .v')), "the pane list counts keys");
await page.click('#set-pane [data-act="ios"]');
ok((await dialog().textContent()).includes(BASE + "/api/transactions") && (await dialog().textContent()).includes("X-API-Key"), "iPhone steps show the exact request");
await dlgOk(); await dlgClosed();
await page.click('#set-pane [data-act="android"]');
ok((await page.textContent("#sc-req")).includes('"amount": "{amount}"'), "Android request with variables");
await dlgOk(); await dlgClosed();
await openRow('#set-pane [data-act="key"]');
ok(/Alex/.test(await paneText()) && /Read and write/.test(await paneText()), "a key's page: what it can do and whose it is");
await page.click('#set-pane [data-act="delete"]');
await page.waitForSelector("#dlg .w-alert");
await dlgOk(); await dlgClosed();
ok((await api("GET", "/api-keys")).data.length === 0, "a key is deleted after confirming");

/* ======================================================================= */
section("Appearance");
await pane("appearance");
ok(!/Week starts on|Time zone|About/.test(await paneText()), "only Theme and Hide amounts");
await page.click('#ap-theme [data-v="dark"]');
ok(await page.getAttribute("html", "data-theme") === "dark", "Dark applies at once");
await page.waitForFunction(() => /Dark/.test(document.querySelector('#set-nav a[data-pane="appearance"] .v').textContent));
ok(true, "the pane list says Dark");
await shot("appearance-dark");
await page.click('#ap-theme [data-v="light"]');
ok(await page.getAttribute("html", "data-theme") === "light", "Light");
await page.click('#ap-theme [data-v="auto"]');
ok(await page.getAttribute("html", "data-theme") === null, "Auto follows the device");
await page.click("#hide-toggle");
ok(await page.evaluate(() => document.documentElement.classList.contains("w-hide")), "Hide amounts on");
await page.click("#hide-toggle");
ok(!(await page.evaluate(() => document.documentElement.classList.contains("w-hide"))), "and off");

/* ======================================================================= */
section("Language");
await pane("region");
await page.click('#set-pane [data-act="lang"]');
await page.waitForSelector(".w-popmenu");
const langRow = await page.locator('#set-pane [data-act="lang"]').boundingBox(), langMenu = await page.locator(".w-popmenu").boundingBox();
ok(langMenu.x >= langRow.x + langRow.width && langMenu.y < langRow.y + langRow.height, "the language menu opens beside its row, English level with it");
ok(await page.locator(".w-popmenu [data-lang]").count() === 13 && !/needs review/.test(await page.textContent(".w-popmenu")), "the language is a menu of 13, each in its own name");
await page.click('.w-popmenu [data-lang="es"]');
await page.waitForFunction(() => document.documentElement.lang === "es", null, { timeout: 8000 });
await page.waitForSelector("#set-pane .w-gl");
ok((await api("GET", "/language")).data.language === "es", "Español saved, and Wally reloaded in it");
await page.click('#set-pane [data-act="lang"]');
await page.click('.w-popmenu [data-lang="ar"]');
await page.waitForFunction(() => document.documentElement.dir === "rtl", null, { timeout: 8000 });
await page.waitForSelector("#set-pane .w-gl");
const navBox = await page.locator("#set-nav").boundingBox(), paneBox = await page.locator("#set-pane").boundingBox();
ok(navBox.x > paneBox.x, "Arabic mirrors the layout (panes on the right)");
await shot("arabic");
await page.click('#set-pane [data-act="lang"]');
await page.click('.w-popmenu [data-lang="en"]');
await page.waitForFunction(() => document.documentElement.lang === "en" && document.documentElement.dir === "ltr", null, { timeout: 8000 });
await page.waitForSelector("#set-pane .w-gl");

/* ======================================================================= */
section("Sign-in & Privacy");
/* Sign-in and Privacy are one page, /settings/security; two-step, the kit, browsers and the server open their own pages */
async function secOpen(sub) {
  await page.goto(BASE + "/settings/security" + (sub ? "/" + sub : ""), { waitUntil: "networkidle" });
  await page.waitForSelector("#set-pane .w-sec", { timeout: 10000 });
  await page.waitForTimeout(150);
}
const twoStepRow = 'a[data-pane="security/two-step"]';
await secOpen();
ok(/Off\. Anyone who can reach this address/.test(await paneText()) && !/Change household password/.test(await paneText()), "off: only “Ask for a password”, no password rows");
ok(/End-to-end encryption/.test(await paneText()) && await page.isDisabled("#pv-toggle"), "Privacy is on the same page; encryption waits for sign-in");
await page.click("#si-toggle");
await page.waitForSelector("#so-pw");
ok(/Everyone in the household uses the same password/.test(await dialog().textContent()), "turning on asks for one password, for everyone");
await page.fill("#so-pw", "short");
await page.fill("#so-rep", "short");
ok(await page.isDisabled("#dlg [data-dlg-ok]") && /At least 8 characters/.test(await dialog().textContent()) &&
  !(await page.locator('#dlg [data-rule="len"]').evaluate((e) => e.classList.contains("ok"))), "Turn On waits for at least 8 characters");
await page.fill("#so-pw", "alexpassword");
await page.fill("#so-rep", "alexpassw0rd");
ok(await page.isDisabled("#dlg [data-dlg-ok]") && await page.locator('#dlg [data-rule="len"].ok').count() === 1 && await page.locator('#dlg [data-rule="same"].ok').count() === 0,
  "the two passwords must match: the length rule ticks, Turn On waits for the match");
await page.fill("#so-rep", "alexpassword");
ok(await page.locator('#dlg [data-rule="same"].ok').count() === 1 && !(await page.isDisabled("#dlg [data-dlg-ok]")), "once they match, Turn On lights up");
await dlgOk();
// Then the household's Emergency Kit, once
await page.waitForSelector("#kit-saved", { timeout: 10000 });
ok(/Save the household’s Emergency Kit/.test(await dialog().textContent()), "turning on shows the household's Emergency Kit");
const kit1 = (await page.locator("#dlg .w-kitkey").innerText()).replace(/\s+/g, "-");
ok(/^([0-9A-Z]{4}-){11}[0-9A-Z]{4}$/.test(kit1), "a 48-character recovery key, in 12 groups");
ok(await page.isDisabled("#dlg [data-dlg-ok]"), "Done waits until it is saved");
const [kitDl] = await Promise.all([page.waitForEvent("download"), page.click("#dlg [data-save]")]);
const kitPdf = readFileSync(await kitDl.path(), "latin1");
ok(kitDl.suggestedFilename() === "wally-emergency-kit.pdf" && kitPdf.startsWith("%PDF-") && kit1.split("-").every((g) => kitPdf.includes(g)), "the kit downloads as a PDF, with the key in it as text");
await page.click("#kit-saved");
await dlgOk(); await dlgClosed();
await toastText(/Sign-in is on/);
let status = (await api("GET", "/auth/status")).data;
ok(status.signin && status.me && status.me.id === 1 && status.two_step === false, "sign-in is on and this browser stays signed in as Alex");
await page.reload(); await page.waitForSelector("#set-pane .w-sec");
ok(/On/.test(await page.textContent('#set-nav a[data-pane="security"] .v')), "still in after reload (session cookie)");
await page.waitForFunction(() => /Signed-in browsers\s*1/.test(document.getElementById("set-pane").textContent));
let txt = await paneText();
ok(/Change household password/.test(txt) && await page.locator('[data-act="password"]').count() === 1, "a Change household password row");
ok(/Two-step sign-in\s*Off/.test(txt) && await page.locator(twoStepRow).count() === 1, "a Two-step sign-in row, Off");
ok(!/Recovery codes/.test(txt), "no recovery codes while two-step is off");
ok(/Signed-in browsers/.test(txt) && await page.locator('[data-act="signout"]').count() === 1, "Browsers: Signed-in browsers, and Sign out of this browser");
ok(/If you forget the password/.test(txt) && /Emergency Kit\s*Made /.test(txt), "If you forget the password: the Emergency Kit, and when it was made");
ok(/Turning it on makes a new Emergency Kit/.test(txt) && !await page.isDisabled("#pv-toggle"), "encryption can be turned on now, in one footnote");
await page.click('a[data-pane="security/browsers"]');
await page.waitForFunction(() => /Alex · Last seen/.test(document.getElementById("set-pane").textContent));
ok(/\/settings\/security\/browsers$/.test(page.url()) && /Sign-in & Privacy/.test(await page.textContent("#set-head")), "Signed-in browsers opens its own page, with a way back");
ok(await page.isDisabled('[data-act="others"]'), "Sign out of other browsers waits until there are others");
await page.click('#set-head a[data-pane="security"]');
await page.waitForSelector('a[data-pane="security/kit"]');
await page.click('a[data-pane="security/kit"]');
await page.waitForSelector('[data-act="kit"]');
txt = await paneText();
ok(/Lost the kit too\?/.test(txt) && /README/.test(txt) && !/python3 -m api\.signin_off/.test(txt) && !/password\.txt/.test(txt), "Emergency Kit page: Make a new kit, and Lost the kit too? in one sentence, pointing at the README");
ok(typeof status.kit === "string", "status says when the kit was made");
const anon = await fetch(BASE + "/api/ledger");
ok(anon.status === 401, "without the cookie, the API now asks to sign in");
ok((await fetch(BASE + "/api/ledger", { headers: { "X-API-Key": rawKey } })).status === 401, "the deleted API key no longer works");

// Adding a person with sign-in on: a name, nothing else
await open("/settings/people");
await page.click('[data-act="add"]');
await page.waitForSelector("#np-name");
ok(/They sign in with the household password\./.test(await dialog().textContent()), "Add a Person: new people sign in with the household password");
ok(await page.locator("#dlg input").count() === 1 && await page.locator('#dlg input[type="password"]').count() === 0, "Add a person asks only for a name");
await page.fill("#np-name", "Lee");
await dlgOk(); await dlgClosed();
await toastText(/Added Lee/);
const leeId = (await api("GET", "/people")).data.find((p) => p.name === "Lee").id;
const lee = await browser.newContext();
const leeIn = await lee.request.post(BASE + "/api/login", { data: { person_id: leeId, password: "alexpassword" } });
ok(leeIn.ok() && (await leeIn.json()).code_needed === false, "Lee signs in with the household password");
ok((await (await lee.request.get(BASE + "/api/auth/status")).json()).me.name === "Lee", "as Lee");
await openRow(`#set-pane a[data-pane="people/${leeId}"]`);
await page.click('#set-pane [data-act="remove"]');
await page.waitForSelector("#dlg [data-dlg-ok]");
ok(/They still know the household password/.test(await dialog().textContent()), "removing someone says they still know the password");
await dlgOk(); await dlgClosed();
await toastText(/Removed Lee/);
ok((await lee.request.get(BASE + "/api/ledger", { failOnStatusCode: false })).status() === 401, "and their sign-in ends");
await lee.close();
await secOpen();

// Change the household password: every other browser is signed out
const anaCtx = await browser.newContext();
ok((await anaCtx.request.post(BASE + "/api/login", { data: { person_id: 2, password: "alexpassword" } })).ok(), "Ana signs in elsewhere with the same password");
await page.click('[data-act="password"]');
await page.fill("#pw-cur", "wrongwrong"); await page.fill("#pw-new", "alexpassword2"); await page.fill("#pw-rep", "alexpassword2");
await expectHttpError(async () => { await dlgOk(); ok(/not right/.test(await dlgError()), "a wrong current password is refused"); });
await page.fill("#pw-cur", "alexpassword"); await page.fill("#pw-rep", "different1");
ok(await page.locator("#dlg [data-dlg-ok]").isDisabled() && !(await page.locator('#dlg [data-rule="same"]').evaluate((n) => n.classList.contains("ok"))) && await page.locator('#dlg [data-rule="len"]').evaluate((n) => n.classList.contains("ok")),
  "the two new passwords must match: Change waits, and only the length rule is ticked");
await page.fill("#pw-rep", "alexpassword2");
ok(await page.locator('#dlg [data-rule="same"]').evaluate((n) => n.classList.contains("ok")), "both rules ticked once they match");
await dlgOk(); await dlgClosed();
await toastText(/Password changed/);
ok((await anaCtx.request.get(BASE + "/api/ledger", { failOnStatusCode: false })).status() === 401, "changing the password signs Ana's browser out");
await anaCtx.close();
ok((await api("GET", "/ledger")).status === 200, "and keeps this one in");
// From now on the browser sends a login key made from the password, never the password
const loginKey = (pw) => page.evaluate(async (pw) => {
  const kdf = await fetch("/api/vault/kdf").then((r) => r.json());
  return (await (await import("/js/vault/crypto.js")).fromPassword(pw, kdf.salt)).login;
}, pw);

// A new Emergency Kit: the password, then the new key; the old one stops working
const recoverWith = async (key) => {
  const c = await browser.newContext();
  const r = await c.request.post(BASE + "/api/kit/recover", { data: { person_id: 2, key }, failOnStatusCode: false });
  await c.close();
  return r.status();
};
ok(await expectHttpError(() => recoverWith(kit1)) === 200, "the first kit works");
await secOpen("kit");
await page.click('[data-act="kit"]');
await page.waitForSelector("#kit-pw");
await page.fill("#kit-pw", "wrongwrong");
await expectHttpError(async () => { await dlgOk(); ok(/not right/.test(await dlgError()), "a new kit asks for the password, and a wrong one is refused"); });
await page.fill("#kit-pw", "alexpassword2");
await dlgOk();
await page.waitForSelector("#kit-saved", { timeout: 10000 });
const kit2 = (await page.locator("#dlg .w-kitkey").innerText()).replace(/\s+/g, "-");
ok(kit2 !== kit1, "a new key is shown");
await page.click("#kit-saved");
await dlgOk(); await dlgClosed();
await toastText(/New Emergency Kit saved/);
ok(await expectHttpError(() => recoverWith(kit1)) === 401, "the old kit stops working");
ok(await expectHttpError(() => recoverWith(kit2)) === 200, "the new one works");
await secOpen();

// Two-step: set up with a real QR and secret, confirmed with a code worked out here and the password
await page.click(twoStepRow);
await page.waitForSelector("#ts-secret");
const qrPath = await page.getAttribute("#dlg svg.w-qr path", "d");
ok(qrPath && qrPath.length > 500, "a real QR code is drawn");
const secret = (await page.textContent("#ts-secret")).replace(/\s/g, "");
ok(/^[A-Z2-7]{32}$/.test(secret), "the secret is shown to type in");
ok(/One code for the household/.test(await dialog().textContent()) && await page.locator("#dlg #ts-pw").count() === 1, "one code for the household, and it asks for the password");
await page.fill("#ts-code", totp(secret));
await page.waitForTimeout(300);
ok(!(await page.locator("#rc-codes").count()) && await dialog().isVisible(), "six digits alone don't send it");
await page.fill("#ts-pw", "wrongwrong");
await expectHttpError(async () => { await dlgOk(); ok(/password is not right/.test(await dlgError()), "a wrong password is refused"); });
await page.fill("#ts-code", "000000");
await page.fill("#ts-pw", "alexpassword2");
await page.evaluate(() => { const e = document.getElementById("dlg-err"); e.hidden = true; e.textContent = ""; });
await expectHttpError(async () => { await dlgOk(); ok(/code is not right/.test(await dlgError()), "a wrong code is refused"); });
await page.fill("#ts-code", totp(secret));
await dlgOk();
await page.waitForSelector("#rc-codes", { timeout: 8000 });
const codes = await page.$$eval("#rc-codes span", (s) => s.map((x) => x.textContent));
ok(codes.length === 10, "ten recovery codes are shown");
const [rcDl] = await Promise.all([page.waitForEvent("download"), page.click("#dlg [data-save]")]);
ok(readFileSync(await rcDl.path(), "utf8").includes(codes[0]), "recovery codes download");
await dlgOk(); await dlgClosed();
await toastText(/Two-step sign-in is on/);
await page.waitForFunction(() => /\/settings\/security\/two-step$/.test(location.pathname) && /Codes left\s*10 of 10/.test(document.getElementById("set-pane").textContent));
ok(true, "two-step opens its own page: 10 of 10 codes left");
txt = await paneText();
ok(/the same on everyone’s phone/.test(txt) && await page.locator('[data-act="2show"]').count() === 1 && await page.locator("#ts-toggle").count() === 1, "two-step on: Add a phone, and a switch to turn it off");
ok((await api("GET", "/auth/status")).data.two_step === true, "status says two-step is on");
// New codes replace the old ones
await page.click('[data-act="codes"]');
await page.fill("#ts-pw", "alexpassword2");
await dlgOk();
await page.waitForSelector("#rc-codes");
const codes2 = await page.$$eval("#rc-codes span", (s) => s.map((x) => x.textContent));
ok(codes2.length === 10 && codes2[0] !== codes[0], "new recovery codes");
await dlgOk(); await dlgClosed();
// Ana signs in on a phone with a recovery code; Settings lists it, with her name, then signs it out
const other = await browser.newContext({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
const l1 = await other.request.post(BASE + "/api/login", { data: { person_id: 2, password: await loginKey("alexpassword2") } });
ok((await l1.json()).code_needed === true, "signing in elsewhere asks for the code");
const oldCode = await other.request.post(BASE + "/api/login/code", { data: { recovery_code: codes[0] }, failOnStatusCode: false });
ok(oldCode.status() === 401, "an old recovery code no longer works");
const l2 = await other.request.post(BASE + "/api/login/code", { data: { recovery_code: codes2[0] } });
ok(l2.status() === 200, "a new recovery code signs in");
await page.reload(); await page.waitForSelector("#set-pane .w-sec");
await page.waitForFunction(() => /Codes left\s*9 of 10/.test(document.getElementById("set-pane").textContent));
ok(true, "9 codes are left");
await secOpen("browsers");
await page.waitForFunction(() => /Safari on iPhone/.test(document.getElementById("set-pane").textContent));
txt = await paneText();
ok(/This browser/.test(txt) && /Safari on iPhone\s*Ana · Last seen/.test(txt), "Signed-in browsers lists both, and the phone shows it is Ana's");
await shot("signin-on");
await page.click('[data-act="others"]');
await page.waitForSelector("#dlg .w-alert");
ok(/Sign out of 1 other browser\?/.test(await dialog().textContent()), "Sign out of other browsers asks first, with the number");
await dlgOk();
await toastText(/Signed out of 1 other browser/);
ok((await other.request.get(BASE + "/api/ledger", { failOnStatusCode: false })).status() === 401, "Sign out others ends the other session");
await other.close();
// Two-step off: the switch on its page
await secOpen("two-step");
await page.click("#ts-toggle");
await page.fill("#ts-pw", "alexpassword2");
await dlgOk(); await dlgClosed();
await toastText(/Two-step sign-in is off/);
ok((await api("GET", "/auth/status")).data.two_step === false, "two-step off");
await page.waitForFunction(() => location.pathname === "/settings/security" && /Two-step sign-in\s*Off/.test(document.getElementById("set-pane").textContent));
ok(!/Recovery codes/.test(await paneText()), "back on Sign-in & Privacy, and the recovery codes are gone");
// Turn sign-in off: asks the password, and removes it
await page.click("#si-toggle");
await page.waitForSelector("#sf-pw");
ok(!(await page.isDisabled("#dlg [data-dlg-ok]")), "Turn Off stays lit, as in an iOS alert");
await dlgOk();
ok(/Enter your password first/.test(await dlgError()) && await dialog().isVisible(), "with the field empty it asks for the password");
await page.fill("#sf-pw", "nope");
await expectHttpError(async () => { await dlgOk(); ok(/not right/.test(await dlgError()), "turning off with a wrong password is refused"); });
await page.fill("#sf-pw", "alexpassword2");
await dlgOk(); await dlgClosed();
await toastText(/Sign-in is off/);
const offStatus = await fetch(BASE + "/api/auth/status").then((r) => r.json());
ok(offStatus.signin === false && offStatus.kit === null, "sign-in is off, and there is no kit");
ok(await recoverWith(kit2) === 400, "the kit no longer opens anything");
await page.reload(); await page.waitForSelector("#set-pane .w-sec");
ok(/Off/.test(await page.textContent('#set-nav a[data-pane="security"] .v')), "and Wally still opens in this browser");
await page.click("#si-toggle");
await page.waitForSelector("#so-pw");
ok(true, "turning it on again asks for a new password");
await dlgCancel();

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
await P.page.waitForSelector(".w-setlist");
ok(await P.page.locator(".w-setlist .w-gr").count() === 8, "phone: Settings is a list of panes in five groups");
await shot("phone-list", P.page);
await P.page.click('.w-setlist [data-pane="security"]');
await P.page.waitForFunction(() => location.pathname === "/settings/security" && document.querySelector("#set-pane .w-gl"));
ok(await P.page.locator("#set-nav").count() === 0, "a pane opens full screen, without the desktop pane list");
ok(await P.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "390 px: no sideways scrolling");
await shot("phone-security", P.page);
for (const id of ["people", "categories/Rent", "tags/coffee", "import", "keys", "appearance", "region", "region/currency"]) {
  await P.page.goto(BASE + "/settings/" + id, { waitUntil: "networkidle" });
  await P.page.waitForSelector("#set-pane .w-gl, #set-pane .w-group");
  ok(await P.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "390 px " + id + ": no sideways scrolling");
  await shot("phone-" + id.replace("/", "-"), P.page);
}
ok((await P.page.textContent("#set-title")) === "Currency" && /Language & Region/.test(await P.page.textContent("#set-head .w-sback")), "phone: a pushed page has ‹ back and a large title");
await P.page.goto(BASE + "/settings/people", { waitUntil: "networkidle" });
await P.page.waitForSelector("#set-pane .w-gl");
await P.page.click("#set-head .w-sback");
await P.page.waitForSelector(".w-setlist");
ok(P.page.url().endsWith("/settings"), "Back goes to the list");
await P.page.goto(BASE + "/settings/people/2", { waitUntil: "networkidle" });
await P.page.waitForSelector("#set-pane .w-shero");
await P.page.click('#set-pane [data-act="remove"]');
await P.page.waitForSelector("#dlg .w-alert");
const dlgBox = await P.page.locator("#dlg .w-alert").boundingBox();
ok(dlgBox.y + dlgBox.height > 780 && /Remove Ana/.test(await P.page.textContent("#dlg [data-dlg-ok]")), "phone: removing is an action sheet at the bottom, Remove Ana in it");
await P.page.click("#dlg [data-dlg-x]");
// The large title sits right on its first group; a category's delete is a short sheet with where its transactions go as a row
await P.page.goto(BASE + "/settings/tags", { waitUntil: "networkidle" });
await P.page.waitForSelector("#set-pane .w-gl");
const gap = await P.page.evaluate(() => document.querySelector("#set-pane .w-gl").getBoundingClientRect().top - document.querySelector("#set-title").getBoundingClientRect().bottom);
ok(gap >= 4 && gap <= 16, "phone: the title sits right above its first group (" + Math.round(gap) + " px)");
await P.page.goto(BASE + "/settings/categories/Rent", { waitUntil: "networkidle" });
await P.page.waitForSelector("#set-pane .w-shero");
await P.page.click('#set-pane [data-act="delete"]');
await P.page.waitForSelector("#dlg .w-alert.w-hsheet #cd-to");
const sheetBox = await P.page.locator("#dlg .w-alert").boundingBox();
ok(sheetBox.x === 0 && sheetBox.width === 390 && sheetBox.y + sheetBox.height >= 843 && /Delete Rent/.test(await P.page.textContent("#dlg [data-dlg-ok]")), "phone: deleting a category is a sheet from the bottom, Delete Rent in it");
await P.page.click("#dlg [data-dlg-x]");
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
  await E.page.waitForSelector("#set-pane .w-gl");
  ok(await E.page.locator("#set-act [data-act=edit]").count() === 0, "one person: nothing to reorder");
  await E.page.goto(EMPTY + "/settings/people/" + me.data.id, { waitUntil: "networkidle" });
  await E.page.waitForSelector("#set-pane .w-shero");
  ok(!(await E.page.locator('#set-pane [data-act="remove"], #set-pane [data-act="switch"]').count()), "one person: no removing and no Switch");
  for (const [id, re] of [["tags", /No tags yet/], ["keys", /Create a key/]]) {
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
