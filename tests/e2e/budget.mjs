/* Budget (B1–B9) on the demo: the page, a limit's panel and sheet, past months, no limit for everything,
   Settings › Categories, Worth noticing, the toast after adding, the phone, and the setup.
     BASE=http://localhost:8891 node budget.mjs   (a demo server: DEMO=true) */
import { chromium } from "playwright";
const BASE = process.env.BASE || "http://localhost:8891";
let fails = 0;
const ok = (c, m, extra) => { console.log((c ? "  ok   " : "  FAIL ") + m + (extra !== undefined && !c ? " — " + JSON.stringify(extra) : "")); if (!c) fails++; };
const browser = await chromium.launch();
async function open(kind = "desktop", path = "/") {
  const opts = kind === "phone" ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } : { viewport: { width: 1440, height: 900 } };
  const ctx = await browser.newContext({ ...opts, serviceWorkers: "block" });
  await ctx.addInitScript(() => { localStorage.setItem("wally.person", "1"); });
  const p = await ctx.newPage();
  p.errors = [];
  p.on("console", (m) => { if (m.type() === "error") p.errors.push(m.text()); });
  p.on("pageerror", (e) => p.errors.push("PAGEERROR " + e.message));
  await p.goto(BASE + path, { waitUntil: "networkidle" }); await p.waitForTimeout(500);
  p.done = () => ctx.close();
  return p;
}
const api = (p, path, method = 'GET', body) => p.evaluate(async ([path, method, body]) => { const r = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', 'X-Wally-Person': '1' }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => null) }; }, [path, method, body]);
const txt = (p, sel) => p.$eval(sel, (e) => e.innerText).catch(() => '');
let p = await open('desktop', '/budget');
// B1
const lead = await txt(p, '.bg-sum');
ok(/Left to spend/.test(lead) && /a day · \d+ days? left/.test(lead) && /spent/.test(lead) && /2,700\.00\s€ limit/.test(lead), 'B1 lead: left to spend, per day and days left, then spent against the limit', lead);
ok((await p.$$('.bg-lead .bg-bar')).length === 1, 'B1 the lead has its own bar');
const names = await p.$$eval('.bg-row h6', (l) => l.map((h) => h.textContent));
ok(names.join() === 'Groceries,Utilities,Food,Shopping,Entertainment,Travel', 'B1 rows by limit, largest first; yearly after', names);
ok((await p.$$('.bg-list .bg-bar u')).length === 6 && /Even share by today/.test(await txt(p, '.bg-legend')), 'B1 the even share by today on every bar, and the legend says so');
ok(/left for Groceries/.test(await txt(p, '#bg-insp')), 'B1 the panel opens on the first limit');
await p.click('[data-bid="Shopping"]'); await p.waitForTimeout(300);
const insp = await txt(p, '#bg-insp');
ok(/over for Shopping/.test(insp) && /Even share by today/.test(insp) && /Usually by now/.test(insp) && /Remove limit/.test(insp), 'B1 a row opens its panel, with the even share by today', insp.slice(0, 160));
// B3 edit
await p.click('#bg-insp [data-edit]'); await p.waitForTimeout(300);
ok((await p.inputValue('#lim-amt')) === '120.00' && /usually spend/.test(await txt(p, '#dlg')), 'B3 the sheet has the amount and one sentence');
await p.fill('#lim-amt', ''); await p.waitForTimeout(100);
ok(await p.$eval('[data-dlg-ok]', (b) => b.disabled), 'B3 Save waits for an amount');
await p.fill('#lim-amt', '150'); await p.click('[data-dlg-ok]'); await p.waitForTimeout(600);
ok(/of 150\.00\s€/.test(await txt(p, '[data-bid="Shopping"]')), 'B3 saved: the row says 150.00 €');
// Remove with Undo
await p.click('#bg-insp [data-remove]'); await p.waitForTimeout(600);
ok((await p.$$('[data-bid="Shopping"]')).length === 0 && /Limit removed/.test(await txt(p, '#toast')), 'B3 Remove limit: gone, no question, a toast');
await p.click('#toast-undo'); await p.waitForTimeout(800);
ok((await p.$$('[data-bid="Shopping"]')).length === 1, 'B3 Undo brings it back');
// B8 past month
await p.click('[data-step="-1"]'); await p.waitForTimeout(400);
const past = await txt(p, '.bg-sum');
ok(/at the end of/.test(past) && !/a day/.test(past), 'B8 last month: how it ended, no per day', past);
ok((await p.$$('.bg-bar u')).length === 0 && !(await txt(p, '.bg-list')).includes('Each year') && (await p.$$('#bg-insp')).length === 0, 'B8 no today mark, no yearly limits, no panel');
ok(await p.$eval('[data-step="1"]', (b) => !b.disabled), 'B8 › goes back');
await p.click('[data-step="1"]'); await p.waitForTimeout(300);
ok(await p.$eval('[data-step="1"]', (b) => b.disabled), 'B1 the months after this one cannot be opened');
// B9 without a limit for everything
const m = new Date().toISOString().slice(0, 7);
await api(p, '/budgets?category=&month=' + m, 'DELETE');
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(400);
const nolim = await txt(p, '.bg-sum');
ok(/^Spending/.test(nolim) && /No limit for the whole month\. Set one/.test(nolim), 'B9 leads with spending and offers the limit quietly', nolim);
await p.click('[data-limit=""]'); await p.waitForTimeout(300);
ok(/Everything/.test(await txt(p, '#dlg h5')) && (await p.inputValue('#lim-amt')) === '', 'B9 Set one opens the sheet for everything');
await p.fill('#lim-amt', '2700'); await p.click('[data-dlg-ok]'); await p.waitForTimeout(600);
ok(/Left to spend/.test(await txt(p, '.bg-sum')), 'B9 set: the page leads with what is left again');
// B7 Settings › Categories › Groceries
await p.goto(BASE + '/settings/categories/Groceries', { waitUntil: 'networkidle' }); await p.waitForTimeout(400);
ok(/Limit\s*600\.00\s€ each month/.test(await txt(p, '#set-pane')), 'B7 a category has a Limit row', (await txt(p, '#set-pane')).slice(0, 200));
await p.click('[data-k="limit"]'); await p.waitForTimeout(300);
ok((await p.inputValue('#lim-amt')) === '600.00', 'B7 it opens the same sheet');
await p.keyboard.press('Escape');
// B4 Summary
await p.goto(BASE + '/', { waitUntil: 'networkidle' }); await p.waitForTimeout(500);
const first = await txt(p, '#s-notice .s-notice');
ok(/over its limit/.test(first), 'B4 Worth noticing leads with the largest overrun', first);
ok((await p.$$('#s-notice .s-notice')).length <= 3, 'B4 still three lines at most');
await p.click('#s-notice [data-go-budget]'); await p.waitForTimeout(500);
ok(/\/budget\?c=/.test(p.url()) && /over for/.test(await txt(p, '#bg-insp')), 'B4 it opens Budget on that limit', p.url());
// B5 toast
await p.goto(BASE + '/', { waitUntil: 'networkidle' }); await p.waitForTimeout(400);
await p.click('.w-hadd'); await p.waitForTimeout(400);
await p.fill('#add-amt', '10'); await p.click('#add-name'); await p.keyboard.type('Mercadona'); await p.waitForTimeout(500); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
await p.click('#add-go', { timeout: 4000 }).catch(async () => { await p.keyboard.press('Enter'); });
await p.waitForTimeout(900);
const toast = await txt(p, '#toast');
ok(/^Added · .* left for Groceries|^Added · Groceries is .* over/.test(toast), 'B5 the toast says what is left', toast);
ok(p.errors.length === 0, 'desktop: no console errors', p.errors);
await p.done();
// Phone: the tab bar, the person menu, a limit as a page
p = await open('phone', '/budget');
const tabs = await p.$$eval('#tabbar a span', (l) => l.map((s) => s.textContent));
ok(tabs.join() === 'Summary,Transactions,Budget,Recurring', 'B6 phone tab bar: Budget in, Settings out', tabs);
await p.tap('.w-main .w-pswitch-b'); await p.waitForTimeout(300);
ok(await p.$eval('.w-main .w-pswitch-m a[href="/settings"]', (a) => !!a.offsetParent).catch(() => false), 'B6 Settings is in the person menu');
await p.keyboard.press('Escape');
await p.tap('[data-bid="Groceries"]'); await p.waitForTimeout(500);
ok(await p.$eval('#bg-insp', (e) => e.classList.contains('open') && e.getBoundingClientRect().width === innerWidth), 'B1 phone: a limit opens as a page');
await p.tap('#bg-insp [data-close]'); await p.waitForTimeout(400);
ok(!(await p.$eval('#bg-insp', (e) => e.classList.contains('open'))), 'B1 phone: back to the list');
ok(p.errors.length === 0, 'phone: no console errors', p.errors);
await p.done();
// B2 setup: no limits at all
p = await open('desktop', '/budget');
const all = (await api(p, '/budgets')).j;
for (const c of [...new Set(all.map((b) => b.category))]) await api(p, '/budgets?category=' + encodeURIComponent(c) + '&month=' + all.filter((b) => b.category === c).map((b) => b.since).sort()[0], 'DELETE');
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(500);
const setup = await txt(p, '#bg-page');
ok(/See what’s left as you spend/.test(setup) && /Everything/.test(setup) && /Start with these/.test(setup), 'B2 no limits: the page is the setup');
const sug = await p.$$eval('[data-ei]', (l) => l.map((b) => b.textContent.replace(/[^\d.]/g, "")));
ok(sug.length > 2 && sug.every((v) => /^\d+\.00$/.test(v)) && Number(sug[0]) % 100 === 0 && sug.slice(1).every((v) => Number(v) % 10 === 0), 'B2 amounts filled from the last three months, rounded up', sug);
// Selecting an amount makes it a field; Return shows it as an amount again
await p.click('[data-ei="1"]'); await p.waitForTimeout(200);
ok(await p.evaluate(() => document.activeElement.matches('[data-si="1"]')), 'B2 selecting an amount makes it a field');
await p.keyboard.type('555'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
ok(/555\.00/.test(await p.$eval('[data-ei="1"]', (b) => b.textContent)), 'B2 Return shows it as an amount again');
await p.click('[data-start]'); await p.waitForTimeout(1200);
ok(/Left to spend/.test(await txt(p, '.bg-sum')) && (await p.$$('.bg-row')).length >= 1, 'B2 Start with these: the budget is on');
ok(p.errors.length === 0, 'setup: no console errors', p.errors);
await p.done();
await browser.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
