/* Browser tests for touch screens: phones and tablets, in WebKit (Safari's engine) and Chromium.
     - One tap is enough on the add sheet: while the amount's keypad is up, a tap on any row used to go
       to another row or nowhere (the keypad went as the finger came down, and the rows moved), and iOS
       takes a change on touch for a hover and waits for a second tap.
     - The category row (wide screens) opens its list from anywhere on it; the tags row, its label too,
       goes to the tag field.
     - The icon picker draws only what's near the screen, and keeps working as a grid.
     - No text field or menu iOS would zoom into (under 16px) on any page or sheet it can open.
     - Setup: the starting categories are in the language picked on its first step.
   Needs a dev server with demo data (BASE) and an empty one (EMPTY):
     WALLY_DATA=/tmp/wally-touch DEMO=true python -m uvicorn utils.dev_server:app --port 8891
     WALLY_DATA=/tmp/wally-touch-empty python -m uvicorn utils.dev_server:app --port 8892
   Run:  BASE=http://localhost:8891 EMPTY=http://localhost:8892 node tests/e2e/touch.mjs
   (npx playwright install chromium webkit) */
import { webkit, chromium, devices } from "playwright";

const BASE = process.env.BASE || "http://localhost:8891";
const EMPTY = process.env.EMPTY || "http://localhost:8892";
let failed = 0, passed = 0;
function check(ok, name, extra) {
  if (ok) { passed++; console.log("  ok   " + name); }
  else { failed++; console.log("  FAIL " + name + (extra !== undefined ? "  → " + JSON.stringify(extra) : "")); }
}
function section(name) { console.log("\n" + name); }

async function page(bt, dev, path = "/") {
  const b = await bt.launch();
  const ctx = await b.newContext({ ...dev, serviceWorkers: "block" });
  await ctx.addInitScript(() => localStorage.setItem("wally.person", "1"));
  const p = await ctx.newPage();
  p.errors = [];
  p.on("pageerror", (e) => p.errors.push(e.message));
  p.on("dialog", (d) => d.dismiss());
  await p.goto(BASE + path, { waitUntil: "networkidle" });
  return [b, p];
}
const openAdd = async (p) => { await p.evaluate(async () => (await import("/js/add.js")).openAdd()); await p.waitForSelector("#add-form"); await p.waitForTimeout(350); };
const closeAdd = (p) => p.evaluate(() => { const w = document.getElementById("add-modal"); w.hidden = true; w.innerHTML = ""; document.documentElement.classList.remove("w-addopen"); });
const st = (p) => p.evaluate(() => { const f = document.getElementById("add-form"); const page = [...f.querySelectorAll("[data-pstep]")].find((x) => !x.hidden); return { page: page && page.dataset.pstep, focus: document.activeElement.id, kp: f.classList.contains("kp"), cal: !!document.getElementById("add-cal") && !document.getElementById("add-cal").hidden, who: (document.querySelector('#add-who [aria-checked="true"]') || {}).dataset?.aw }; });

/* ---------- one tap on the add sheet, on a phone ---------- */
for (const [bn, bt, dev] of [["webkit iPhone", webkit, devices["iPhone 14"]], ["chromium Pixel", chromium, devices["Pixel 7"]]]) {
  section(bn + ": one tap, on a sheet just opened (keypad up)");
  const [b, p] = await page(bt, dev);
  await p.waitForSelector("#app:not([hidden])");
  const cases = [
    ["#add-catrow", (s) => s.page === "cat", "Category opens its page"],
    ["#add-name", (s) => s.focus === "add-name" && !s.kp, "the name takes the typing, keypad gone"],
    ["#add-datecell", (s) => s.cal && !s.kp, "Date opens the calendar"],
    ["#add-reprow", (s) => s.page === "repeat", "Repeat opens its page"],
    ["#lbl-tags", (s) => s.focus === "add-tag" && !s.kp, "the Tags label goes to the tag field"],
    ["#add-tagrow", (s) => s.focus === "add-tag" && !s.kp, "anywhere on the tags row goes to the tag field", { position: { x: 120, y: 10 } }],
    ["#add-note", (s) => s.focus === "add-note" && !s.kp, "Note takes the typing"],
  ];
  for (const [sel, ok, name, opts] of cases) {
    await openAdd(p);
    const before = await st(p);
    await p.tap(sel, opts);
    await p.waitForTimeout(350);
    const s = await st(p);
    check(before.kp && ok(s), name, s);
    await closeAdd(p);
  }
  // The keypad stays as it is while the finger is down: nothing appears or moves before the tap lands
  await openAdd(p);
  const during = await p.evaluate(() => {
    const row = document.getElementById("add-reprow"), r = row.getBoundingClientRect(), f = document.getElementById("add-form");
    const o = { pointerId: 1, pointerType: "touch", isPrimary: true, bubbles: true, clientX: r.x + 20, clientY: r.y + 10 };
    row.dispatchEvent(new PointerEvent("pointerdown", o));
    const res = { kp: f.classList.contains("kp"), foot: getComputedStyle(f.querySelector(".w-pfoot")).display, top: Math.round(row.getBoundingClientRect().top) === Math.round(r.top) };
    row.dispatchEvent(new PointerEvent("pointerup", o));
    row.click();
    return res;
  });
  check(during.kp && during.foot === "none" && during.top, "touch down changes nothing (iOS would wait for a second tap)", during);
  await closeAdd(p);
  // Opening, the caret blinks in the amount: right after the 0.00, where the first digit goes
  await openAdd(p);
  const caret = await p.evaluate(() => { const i = document.getElementById("add-amt"), cs = getComputedStyle(i); return { focus: document.activeElement === i, color: cs.caretColor, align: cs.textAlign }; });
  check(caret.focus && !/rgba\(0, 0, 0, 0\)|transparent/.test(caret.color) && caret.align === "right", "the sheet opens with the caret in the amount, after the 0.00", caret);
  await p.tap('[data-k="7"]');
  check(await p.$eval("#add-amt", (i) => getComputedStyle(i).textAlign) === "center", "typed, the amount is centred");
  await closeAdd(p);
  // Tapping the amount again brings the keypad back, also while it has focus
  await openAdd(p);
  await p.tap("#add-note"); await p.waitForTimeout(250);
  await p.tap("#add-amt"); await p.waitForTimeout(250);
  check((await st(p)).kp, "a tap on the amount brings the keypad back");
  await p.tap('[data-k="4"]'); await p.tap('[data-k="2"]');
  check(await p.$eval("#add-amt", (i) => i.value) === "42", "the keypad types");
  await p.tap("#add-knext"); await p.waitForTimeout(250);
  check((await st(p)).focus === "add-name" && !(await st(p)).kp, "Next goes on to the name");
  await closeAdd(p);
  // A tag: a tap on it keeps it; a tap on its × removes it
  await openAdd(p);
  await p.tap("#add-tagrow .k"); await p.keyboard.type("trip food "); await p.waitForTimeout(150);
  await p.tap("#add-tags .w-chip >> nth=0", { position: { x: 8, y: 10 } }); await p.waitForTimeout(250);
  check(JSON.stringify(await p.$$eval("#add-tags .w-chipx", (l) => l.map((n) => n.dataset.tg))) === '["#trip","#food"]' && (await st(p)).focus === "add-tag", "a tap on a tag keeps it", await p.$$eval("#add-tags .w-chipx", (l) => l.map((n) => n.dataset.tg)));
  await p.tap('#add-tags [data-tg="#trip"]'); await p.waitForTimeout(250);
  check(JSON.stringify(await p.$$eval("#add-tags .w-chipx", (l) => l.map((n) => n.dataset.tg))) === '["#food"]', "a tap on its × removes it");
  const xr = await p.$eval("#add-tags .w-chipx", (n) => { const a = getComputedStyle(n, "::after"), r = n.getBoundingClientRect(); return [r.width - parseFloat(a.left) - parseFloat(a.right), r.height - parseFloat(a.top) - parseFloat(a.bottom)]; });
  check(xr[0] >= 28 && xr[1] >= 32, "the × is big enough for a finger", xr);
  await closeAdd(p);
  // Who, segmented: one tap changes it
  await openAdd(p);
  const was = (await st(p)).who;
  const other = await p.evaluate((w) => [...document.querySelectorAll("#add-who [data-aw]")].map((x) => x.dataset.aw).find((x) => x !== w), was);
  await p.tap('#add-who [data-aw="' + other + '"]'); await p.waitForTimeout(250);
  check((await st(p)).who === other, "Who changes with one tap", [was, other, await st(p)]);
  await closeAdd(p);
  // touch-action: double taps don't zoom, in the sheet as anywhere
  check(await p.evaluate(() => getComputedStyle(document.body).touchAction) === "manipulation", "no double-tap zoom");
  check(!p.errors.length, "no errors", p.errors);
  await b.close();
}

/* ---------- wide screens, mouse and touch: the category row and the tags row ---------- */
for (const [bn, bt, dev] of [["chromium desktop", chromium, { viewport: { width: 1440, height: 900 } }], ["webkit iPad", webkit, devices["iPad (gen 7)"]]]) {
  section(bn + ": the category row and the tags row");
  const [b, p] = await page(bt, dev);
  await p.waitForSelector("#app:not([hidden])");
  const touch = bn.includes("iPad");
  const press = (sel, opts) => (touch ? p.tap(sel, opts) : p.click(sel, opts));
  const cat = () => p.evaluate(() => ({ open: !document.getElementById("add-catlist").hidden, focus: document.activeElement.id, val: document.getElementById("add-cat").value }));
  for (const [sel, name] of [["#lbl-cat", "the Category label"], [".w-catchev", "the chevron"], ["#add-cat", "the field"], ["#add-catrow", "the row's empty space"]]) {
    await openAdd(p);
    await press(sel, sel === "#add-catrow" ? { position: { x: 120, y: 12 } } : undefined); await p.waitForTimeout(250);
    const c = await cat();
    check(c.open && c.focus === "add-cat", name + " opens the list", c);
    await closeAdd(p);
  }
  await openAdd(p);
  await press("#lbl-cat"); await p.waitForTimeout(200);
  await press(".w-catchev"); await p.waitForTimeout(200);
  let c = await cat();
  check(!c.open && c.focus === "add-cat", "the chevron closes it again", c);
  await press(".w-catchev"); await p.waitForTimeout(200);
  check((await cat()).open, "and opens it");
  const who = await p.evaluate(() => (document.querySelector('#add-who [aria-checked="true"]') || {}).dataset.aw);
  const name = await p.$eval('#add-catlist [data-co="2"] b', (n) => n.textContent);
  await press('#add-catlist [data-co="2"]'); await p.waitForTimeout(250);
  c = await cat();
  const who2 = await p.evaluate(() => (document.querySelector('#add-who [aria-checked="true"]') || {}).dataset.aw);
  check(!c.open && c.val === name && who2 === who, "an option picks it, and the click stays there", { c, name, who, who2 });
  await press("#lbl-tags"); await p.waitForTimeout(200);
  check((await cat()).focus === "add-tag", "the Tags label goes to the tag field");
  await p.keyboard.type("trip ");
  await press("#add-tagrow", { position: { x: 200, y: 12 } }); await p.waitForTimeout(200);
  check((await cat()).focus === "add-tag" && await p.$$eval("#add-tags .w-chip", (x) => x.length) === 1, "the tags row's empty space too, keeping the tags", await cat());
  // The tag itself is no button: a click on it keeps it, and goes to the field. Only its × removes it
  await press("#add-tags .w-chip", { position: { x: 10, y: 12 } }); await p.waitForTimeout(200);
  check((await cat()).focus === "add-tag" && await p.$$eval("#add-tags .w-chip", (x) => x.length) === 1, "a click on a tag keeps it", await cat());
  await press("#add-tags .w-chipx"); await p.waitForTimeout(200);
  check((await cat()).focus === "add-tag" && await p.$$eval("#add-tags .w-chip", (x) => x.length) === 0, "its × removes it, the focus staying in the field");
  await closeAdd(p);
  await b.close();
}

/* ---------- the icon picker: drawn as it comes near the screen ---------- */
for (const [bn, bt, dev, slow] of [["chromium Pixel 4x CPU", chromium, devices["Pixel 7"], 4], ["webkit iPhone", webkit, devices["iPhone 14"], 0], ["chromium desktop", chromium, { viewport: { width: 1440, height: 900 } }, 0]]) {
  section(bn + ": the icon picker");
  const [b, p] = await page(bt, dev, "/settings/categories/Groceries");
  const errs = p.errors;
  if (slow) { const cdp = await p.context().newCDPSession(p); await cdp.send("Emulation.setCPUThrottlingRate", { rate: slow }); }
  await p.waitForSelector('[data-act="icon"]');
  const opens = [], searches = [];
  for (let i = 0; i < 3; i++) {
    opens.push(await p.evaluate(() => new Promise((res) => {
      const t0 = performance.now();
      document.querySelector('[data-act="icon"]').click();
      const wait = () => { if (document.querySelector('#ic-list [data-from]:not([data-from="0"])') && !document.getElementById("ic-wait")) requestAnimationFrame(() => setTimeout(() => res({ ms: Math.round(performance.now() - t0), drawn: document.querySelectorAll("#ic-list [data-i]").length, blocks: document.querySelectorAll("#ic-list .w-icons").length, focus: document.activeElement.id || document.activeElement.getAttribute("data-dlg-ok") !== null && "Done" }), 0)); else requestAnimationFrame(wait); };
      wait();
    })));
    for (const q of ["c", "ca", "car", ""]) searches.push(await p.evaluate((q) => new Promise((res) => {
      const i = document.getElementById("ic-q"), list = document.getElementById("ic-list"), t0 = performance.now();
      const done = () => requestAnimationFrame(() => setTimeout(() => res(q + ":" + Math.round(performance.now() - t0) + "ms/" + list.querySelectorAll("[data-i]").length), 0));
      const mo = new MutationObserver(() => { mo.disconnect(); done(); });
      mo.observe(list, { childList: true });
      i.value = q; i.dispatchEvent(new Event("input", { bubbles: true }));
    }), q));
    if (i < 2) { await p.click("[data-dlg-x]"); await p.waitForTimeout(200); }
  }
  console.log("  open:", JSON.stringify(opens));
  console.log("  search:", searches.slice(-4).join("  "));
  const total = await p.evaluate(() => [...document.querySelectorAll("#ic-list .w-icons")].reduce((s, b) => s + +b.dataset.n, 0));
  check(opens.every((o) => o.drawn <= 64 * 3), "opens drawing only the first blocks (" + opens[2].drawn + " of " + total + ")");
  check(opens[2].focus === (bn.includes("desktop") ? "ic-q" : "Done"), "focus on open: " + (bn.includes("desktop") ? "the search" : "not the search, no keyboard"), opens[2].focus);
  // Every block is as tall before it's drawn as after: jumping straight to any of them (dragging the
  // scroll bar), nothing moves
  const sizes = await p.evaluate(async () => {
    const sc = document.getElementById("ic-list").parentElement, wrong = [];
    const blocks = [...document.querySelectorAll("#ic-list .w-icons")];
    for (const b of blocks.slice().reverse()) {
      if (b.dataset.on) continue;
      const h0 = b.getBoundingClientRect().height;
      sc.scrollTop = b.offsetTop - 50;
      // The browser says it's near the screen a frame or a few later (more with a slow CPU)
      for (let t = 0; t < 60 && !b.dataset.on; t++) await new Promise((r) => requestAnimationFrame(r));
      const h1 = b.getBoundingClientRect().height;
      if (!b.dataset.on || Math.abs(h0 - h1) > 0.01) wrong.push([b.dataset.from, h0, h1, !!b.dataset.on]);
    }
    return { wrong, empty: blocks.filter((b) => !b.dataset.on).length, drawn: document.querySelectorAll("#ic-list [data-i]").length };
  });
  check(!sizes.wrong.length && sizes.empty === 0, "every block drawn as it comes, as tall as it was before", sizes);
  // The sheet turned: blocks not drawn yet follow the new rows
  await p.click("[data-dlg-x]"); await p.waitForTimeout(200);
  await p.click('[data-act="icon"]'); await p.waitForTimeout(400);
  const turned = await p.evaluate(async () => {
    const d = document.querySelector(".w-icdlg"); d.style.maxWidth = "300px";
    await new Promise((r) => setTimeout(r, 200));
    const sc = document.getElementById("ic-list").parentElement, b = [...document.querySelectorAll("#ic-list .w-icons:not([data-on])")].pop();
    const h0 = b.getBoundingClientRect().height;
    sc.scrollTop = b.offsetTop - 50;
    for (let t = 0; t < 60 && !b.dataset.on; t++) await new Promise((r) => requestAnimationFrame(r));
    return [h0, b.getBoundingClientRect().height, !!b.dataset.on];
  });
  check(turned[2] && Math.abs(turned[0] - turned[1]) < 0.01, "after the sheet changes width too", turned);
  // Search, Enter, the pick
  await p.fill("#ic-q", "bicycle");
  await p.waitForTimeout(100);
  const found = await p.$$eval("#ic-list [data-i]", (x) => x.map((n) => n.dataset.i));
  check(found[0] === "bike", "search finds Wally's own first", found.slice(0, 4));
  await p.press("#ic-q", "Enter");
  await p.waitForTimeout(500);
  const saved = await p.evaluate(async () => (await (await fetch("/api/categories/icons")).json()).Groceries);
  check(saved === "bike" && await p.evaluate(() => document.getElementById("dlg").hidden), "Enter picks the first one found, and is Done (as before)", saved);
  await p.click('[data-act="icon"]');
  await p.waitForTimeout(400);
  await p.fill("#ic-q", "zzzz");
  await p.waitForTimeout(100);
  check(await p.$eval("#ic-list", (n) => n.textContent.includes("zzzz")), "nothing found says so");
  await p.fill("#ic-q", "");
  await p.waitForTimeout(100);
  // Arrow keys across a block that isn't drawn yet
  const arrow = await p.evaluate(async () => {
    const sc = document.getElementById("ic-list").parentElement; sc.scrollTop = 0;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const last = document.querySelector('#ic-list [data-x="63"]');
    last.focus();
    return [!!last, document.querySelector('#ic-list [data-x="71"]') !== null && document.querySelector('#ic-list [data-x="71"]').closest(".w-icons").dataset.on];
  });
  await p.keyboard.press("ArrowDown");
  const af = await p.evaluate(() => [document.activeElement.dataset.x, document.activeElement.getAttribute("aria-checked")]);
  check(af[0] === "71" && af[1] === "true", "↓ from the last row of a block goes to the next, and picks it", { arrow, af });
  // Done saves; open again shows the pick checked, wherever it is
  const picked = await p.evaluate(() => document.activeElement.dataset.i);
  await p.click("[data-dlg-ok]");
  await p.waitForTimeout(400);
  await p.click('[data-act="icon"]');
  await p.waitForTimeout(400);
  check(await p.$eval(".w-icprev use", (u) => u.getAttribute("href")).then((h) => h.endsWith(picked.replace(/^l-/, "")) ), "Done keeps it: " + picked);
  const checked = await p.evaluate(async (id) => { const sc = document.getElementById("ic-list").parentElement; for (let y = 0; y <= sc.scrollHeight; y += sc.clientHeight / 2) { sc.scrollTop = y; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); } return [...document.querySelectorAll('#ic-list [aria-checked="true"]')].map((x) => x.dataset.i); }, picked);
  check(checked.length >= 1 && checked.every((x) => x === picked), "the pick shows checked when its block is drawn", checked);
  await p.click("[data-dlg-x]");
  await p.evaluate(async () => { await fetch("/api/categories/Groceries", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ icon: "" }) }); });
  check(!errs.length, "no errors", errs);
  await b.close();
}

/* ---------- iOS zooms into a text field or a menu under 16px, and stays zoomed: none, anywhere ---------- */
section("no field iOS would zoom into, on every page and every sheet it opens");
const ROUTES = ["/", "/transactions", "/recurring", "/review", "/settings", "/settings/people", "/settings/categories", "/settings/categories/Groceries",
  "/settings/tags", "/settings/region", "/settings/region/currency", "/settings/appearance", "/settings/security", "/settings/import", "/settings/keys", "/settings/people/1", "/settings/people/2", "/transactions?mode=all"];
const SIZES = (process.env.SIZES || "portrait,promax,max").split(",");
const audit = () => {
  const bad = [];
  const sel = 'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button]):not([type=submit]):not([type=hidden]):not([type=file]):not([type=color]),select,textarea,[contenteditable=""],[contenteditable=true]';
  for (const n of document.querySelectorAll(sel)) {
    const r = n.getBoundingClientRect(), cs = getComputedStyle(n);
    if (n.disabled || cs.visibility === "hidden" || !(r.width || r.height) || n.closest("[hidden]")) continue;
    const fs = parseFloat(cs.fontSize);
    if (fs < 16) bad.push((n.id ? "#" + n.id : n.tagName.toLowerCase() + "." + [...n.classList].join(".") + "(" + (n.closest("[id]") || {}).id + ")") + " " + fs + "px");
  }
  // On a phone a sheet spans the screen
  const sheet = document.querySelector("#dlg:not([hidden]) .w-sheetd");
  if (sheet && innerWidth < 768 && Math.abs(sheet.getBoundingClientRect().width - innerWidth) > 1) bad.push("sheet " + sheet.className + " " + Math.round(sheet.getBoundingClientRect().width) + "px wide on a " + innerWidth + "px screen");
  // Wider than the screen: iOS lets the page be dragged sideways, or zooms out to fit
  if (document.documentElement.scrollWidth > innerWidth + 1) bad.push("page wider than the screen: " + document.documentElement.scrollWidth + " > " + innerWidth);
  return bad;
};
const found = new Map(), opened = new Set();
const note = (size, where, list) => list.forEach((b) => { const k = size + " " + b; if (!found.has(k)) found.set(k, where); });
for (const size of SIZES) {
  const dev = { portrait: devices["iPhone 14"], promax: devices["iPhone 15 Pro Max"], landscape: devices["iPhone 14 landscape"], max: devices["iPhone 15 Pro Max landscape"], ipad: devices["iPad (gen 7)"] }[size];
  const b = await webkit.launch();
  const ctx = await b.newContext({ ...dev, serviceWorkers: "block" });
  await ctx.addInitScript(() => localStorage.setItem("wally.person", "1"));
  const p = await ctx.newPage();
  p.on("dialog", (d) => d.dismiss());
  await p.goto(BASE + "/", { waitUntil: "networkidle" });
  check(await p.evaluate(() => matchMedia("(pointer:coarse)").matches), size + ": a touch screen, " + await p.evaluate(() => innerWidth) + "px wide");
  // The add sheet: new, and editing a transaction
  for (const how of ["new", "edit"]) {
    await p.evaluate(async (how) => { const m = await import("/js/add.js"), c = await import("/js/core.js"); m.openAdd(how === "edit" ? { tx: c.state.tx[0] } : undefined); }, how);
    await p.waitForTimeout(300);
    note(size, "add " + how, await p.evaluate(audit));
    // its pages
    for (const step of ["cat", "split", "repeat"]) {
      const ok = await p.evaluate((s) => { const b = document.querySelector('#add-form [data-step="' + s + '"]'); if (b && b.offsetParent) { b.click(); return true; } return false; }, step);
      if (ok) { await p.waitForTimeout(200); note(size, "add " + how + " › " + step, await p.evaluate(audit)); await p.evaluate(() => { const b = document.querySelector('#add-form [data-pstep]:not([hidden]) [data-step="main"]'); if (b) b.click(); }); }
    }
    await p.evaluate(async () => { const w = document.getElementById("add-modal"); w.hidden = true; w.innerHTML = ""; document.documentElement.classList.remove("w-addopen"); });
  }
  // The Custom Range sheets, behind menus the clicks below don't open
  for (const [route, open] of [["/", "r.openRange(r.rangeOf(), () => {})"], ["/transactions", "r.openRangeSheet(() => {})"]]) {
    await p.goto(BASE + route, { waitUntil: "networkidle" }); await p.waitForTimeout(300);
    const mod = route === "/" ? "/js/pages/dashboard/range.js" : "/js/pages/transactions/sheets.js";
    await p.evaluate(async ([m, code]) => { const r = await import(m); new Function("r", code)(r); }, [mod, open]);
    await p.waitForTimeout(300);
    const shown = await p.evaluate(() => !document.getElementById("dlg").hidden);
    check(shown, size + ": " + route + " Custom Range opens");
    if (shown) { opened.add(size + " " + route + " ▸ Custom Range"); note(size, route + " ▸ Custom Range", await p.evaluate(audit)); await p.keyboard.press("Escape"); await p.waitForTimeout(150); }
  }
  for (const route of ROUTES) {
    await p.goto(BASE + route, { waitUntil: "networkidle" });
    await p.waitForTimeout(300);
    note(size, route, await p.evaluate(audit));
    const n = await p.evaluate(() => {
      const c = [...document.querySelectorAll("#app button, #app [data-act], #app [role=button], #app summary")].filter((x) => x.offsetParent && !x.closest("nav, .w-tabbar, .w-side"));
      c.forEach((x, i) => x.setAttribute("data-zz", i));
      return c.length;
    });
    for (let i = 0; i < n; i++) {
      const label = await p.evaluate((i) => { const x = document.querySelector('[data-zz="' + i + '"]'); return x && x.offsetParent ? (x.textContent.trim() || x.getAttribute("aria-label") || x.className).slice(0, 40) : null; }, i);
      if (label === null || /sign out|log out|export|download|turn off|reset|delete all/i.test(label)) continue;
      const url = p.url();
      await p.evaluate((i) => document.querySelector('[data-zz="' + i + '"]').click(), i).catch(() => {});
      await p.waitForTimeout(250);
      const open = await p.evaluate(() => !document.getElementById("dlg").hidden || !document.getElementById("add-modal").hidden);
      note(size, route + " ▸ " + label, await p.evaluate(audit));
      if (open) {
        opened.add(size + " " + route + " ▸ " + label);
        await p.keyboard.press("Escape"); await p.waitForTimeout(150);
        await p.evaluate(() => { const d = document.getElementById("dlg"); if (!d.hidden) { const x = d.querySelector("[data-dlg-x]"); if (x) x.click(); } });
        await p.evaluate(() => { const w = document.getElementById("add-modal"); if (!w.hidden) { w.hidden = true; w.innerHTML = ""; document.documentElement.classList.remove("w-addopen"); } });
      }
      if (p.url() !== url) { await p.goto(url, { waitUntil: "networkidle" }); await p.waitForTimeout(200); await p.evaluate(() => { const c = [...document.querySelectorAll("#app button, #app [data-act], #app [role=button], #app summary")].filter((x) => x.offsetParent && !x.closest("nav, .w-tabbar, .w-side")); c.forEach((x, i) => x.setAttribute("data-zz", i)); }); }
    }
  }
  await b.close();
}
console.log("  (" + opened.size + " sheets opened)");
check(found.size === 0, "no field under 16px, and no page wider than the screen", [...found].map(([k, w]) => k + " ← " + w));

/* ---------- a tap on the Split or Paid by menu leaves the amount alone ----------
   The menus kept their options' markup in a data-k, the attribute the keypad's keys use, and a tap on
   one typed that markup into the amount */
for (const [bn, bt, dev] of [["chromium desktop", chromium, { viewport: { width: 1280, height: 900 } }], ["webkit iPhone", webkit, devices["iPhone 14"]]]) {
  section(bn + ": the Split and Paid by menus");
  const [b, p] = await page(bt, dev);
  await p.waitForSelector("#app:not([hidden])");
  const phone = bn.includes("iPhone");
  await openAdd(p);
  if (!phone) await p.fill("#add-amt", "20"); else { await p.tap('[data-k="2"]'); await p.tap('[data-k="0"]'); await p.tap("#add-knext"); await p.keyboard.press("Escape"); }
  await p.waitForTimeout(200);
  await (phone ? p.tap('#add-who [data-aw="shared"]') : p.click('#add-who [data-aw="shared"]')); await p.waitForTimeout(200);
  if (phone) { await p.tap("#add-byrow"); await p.waitForTimeout(300); }
  for (const id of ["add-bysel", "add-smsel"]) await p.evaluate((i) => { const n = document.getElementById(i); if (n) n.click(); }, id);
  await p.selectOption("#add-bysel", "2"); await p.waitForTimeout(200);
  check(await p.$eval("#add-amt", (i) => i.value) === "20", "a tap on the menus, and a pick: the amount stays 20", await p.$eval("#add-amt", (i) => i.value));
  check(await p.$$eval("#add-form [data-k]", (l) => l.every((n) => n.closest("#add-keypad"))), "only the keypad's keys carry data-k");
  // Anywhere on a menu's row opens it: the label, the space, the value and the chevron are all the menu
  const rows = await p.evaluate(() => [...document.querySelectorAll(".w-grpick")].filter((r) => r.offsetParent).map((r) => {
    const sel = r.querySelector("select"), b = r.getBoundingClientRect(), y = b.top + b.height / 2;
    return [sel.id, [b.left + 20, b.left + b.width / 2, b.right - 60, b.right - 14].every((x) => document.elementFromPoint(x, y) === sel), r.querySelector(".v").textContent];
  }));
  check(rows.length >= 1 && rows.every(([, all]) => all), "a tap anywhere on " + rows.map(([id]) => id).join(", ") + " opens its menu", rows);
  check(rows.find(([id]) => id === "add-bysel")[2] === "Ana", "the row shows what was picked", rows);
  check(!p.errors.length, "no errors", p.errors);
  await closeAdd(p);
  await b.close();
}

/* ---------- turning the phone: every page fits the new width, its charts drawn again for it ---------- */
for (const [bn, bt] of [["webkit", webkit], ["chromium", chromium]]) {
  section(bn + ": turning the phone, landscape to portrait and back");
  const [b, p] = await page(bt, devices["iPhone 14 landscape"]);
  const fits = () => p.evaluate(() => ({
    wide: document.documentElement.scrollWidth - innerWidth, scale: visualViewport.scale,
    charts: [...document.querySelectorAll("svg.chart")].filter((c) => c.getClientRects().length).map((c) => Math.abs(+c.getAttribute("width") - Math.floor(c.parentElement.clientWidth))),
  }));
  for (const path of ["/", "/transactions", "/recurring", "/review", "/settings", "/settings/categories/Groceries"]) {
    for (const [from, to] of [[[844, 390], [390, 844]], [[390, 844], [844, 390]]]) {
      await p.setViewportSize({ width: from[0], height: from[1] });
      await p.goto(BASE + path, { waitUntil: "networkidle" }); await p.waitForTimeout(400);
      await p.setViewportSize({ width: to[0], height: to[1] }); await p.waitForTimeout(600);
      const f = await fits();
      check(f.wide <= 0 && f.scale === 1 && f.charts.every((d) => d <= 1), path + " " + (to[0] < to[1] ? "turned to portrait" : "turned to landscape") + ": fits, charts drawn again (" + f.charts.length + ")", f);
    }
  }
  check(!p.errors.length, "no errors", p.errors);
  await b.close();
}

/* ---------- setup: the starting categories in the language picked on its first step ---------- */
{
  section("setup on a phone, in Spanish");
  const SPANISH = ["Ocio", "Comida", "Supermercado", "Salud", "Ingresos", "Varios", "Alquiler", "Compras", "Viajes", "Suministros"].sort();
  const small = () => [...document.querySelectorAll("input:not([type=checkbox]):not([type=radio]):not([type=hidden]),select,textarea")]
    .filter((n) => n.getClientRects().length && !n.closest("[hidden]")).map((n) => [n.id || n.className, parseFloat(getComputedStyle(n).fontSize)]).filter(([, f]) => f < 16);
  const cats = (p) => p.evaluate(async () => (await (await fetch("/api/categories")).json()).sort());
  const b = await webkit.launch();
  const p = await (await b.newContext({ ...devices["iPhone 14"], serviceWorkers: "block" })).newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(EMPTY + "/", { waitUntil: "networkidle" });
  await p.waitForSelector("#onb-lang");
  check(!(await p.evaluate(small)).length, "first step: no field iOS would zoom into", await p.evaluate(small));
  await p.selectOption("#onb-lang", "es");
  await p.waitForFunction(() => document.documentElement.lang === "es");
  await p.waitForTimeout(300);
  check(JSON.stringify(await cats(p)) === JSON.stringify(SPANISH), "picking Español names the categories in Spanish", await cats(p));
  await p.tap("#onb-next");
  await p.waitForSelector("[data-name]");
  check(!(await p.evaluate(small)).length, "people step: no field iOS would zoom into", await p.evaluate(small));
  await p.fill('[data-name="0"]', "Pol");
  await p.tap("#onb-next");
  await p.waitForSelector("#onb-pwd");
  check(!(await p.evaluate(small)).length, "password step: no field iOS would zoom into", await p.evaluate(small));
  await p.tap("#onb-skip");
  await p.waitForSelector("[data-onb-data]");
  await p.tap('[data-onb-data="add"]');
  await p.tap("#onb-next");
  await p.waitForSelector("#app:not([hidden])");
  await p.waitForTimeout(500);
  const app = await p.evaluate(async () => { const c = await import("/js/core.js"); return c.state.categories.map((n) => [n, c.cat(n).i, c.isIncomeCat(n)]); });
  check(JSON.stringify(app.map(([n]) => n).sort()) === JSON.stringify(SPANISH), "the app has them", app);
  check(JSON.stringify(app.filter(([, , inc]) => inc)) === JSON.stringify([["Ingresos", "income", true]]), "Ingresos is the income category", app);
  check(new Set(app.map(([, i]) => i)).size === 10, "each has its own icon", app);
  await p.goto(EMPTY + "/settings/categories", { waitUntil: "networkidle" });
  await p.waitForTimeout(400);
  const listed = await p.evaluate(() => document.querySelector("#app").innerText);
  check(SPANISH.every((n) => listed.includes(n)), "Settings › Categories lists them");
  // Set up, they're the household's: a language changed later leaves them as they are
  await p.evaluate(() => fetch("/api/language/en", { method: "PUT" }));
  check(JSON.stringify(await cats(p)) === JSON.stringify(SPANISH), "a language changed after setup keeps them", await cats(p));
  check(!errs.length, "no errors", errs);
  await b.close();
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
