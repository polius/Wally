/* Budget (B1–B9) on the demo: the page, a limit's panel and sheet, past months, no limit for everything,
   Settings › Categories, Worth noticing, the toast after adding, the phone, and no limits at all.
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
ok(/Left to spend/.test(lead) && /a day until \w+ \d+/.test(lead) && /Spent\s*1,9\d\d\.\d\d\s€/.test(lead) && /Bills still due/.test(lead) && /Limit\s*2,700\.00\s€/.test(lead), 'B1 lead: left to spend, per day until the month ends, then a bar with a key: spent, bills still due, limit', lead);
ok((await p.$$('.bg-lead .bg-bar')).length === 1 && (await p.$$('.bg-lead .bg-bar u')).length === 1, 'B1 the lead has its own bar, with the even-share mark');
const names = await p.$$eval('.bg-row h6', (l) => l.map((h) => h.textContent));
ok(names.join() === 'Groceries,Utilities,Food,Shopping,Entertainment,Travel', 'B1 rows by limit, largest first; yearly after', names);
ok((await p.$$('.bg-list .bg-bar u')).length === 6 && !/Even pace/.test(await txt(p, '.bg-sum')) && (await p.$$('.bg-legend')).length === 0, 'B1 the even pace by today on every bar; no legend');
await p.click('.w-pswitch-b'); await p.waitForTimeout(200);
const pmenu = await txt(p, '.w-pswitch-m');
ok(/Everyone/.test(await txt(p, '.w-pswitch-b')) && (await p.$$('.w-pswitch-m button:disabled')).length === 2 && (await p.$$('.w-pswitch-m [data-scope]')).length === 0 && /Budget is for the whole household/.test(pmenu), 'B1 the person menu says Everyone; the people are disabled, and it says why', pmenu);
await p.keyboard.press('Escape');
ok(/of 200\.00\s€ · 24\.00\s€ still due/.test(await txt(p, '[data-bid="Utilities"]')) && !/%/.test(await txt(p, '.bg-list')) && !/%/.test(await txt(p, '.bg-key')) && !/still due/.test(await txt(p, '[data-bid="Entertainment"]')) && !/this year/.test(await txt(p, '[data-bid="Travel"]')), 'B1 bills still due named only when they put a limit over');
ok(/left for Groceries/.test(await txt(p, '#bg-insp')), 'B1 the panel opens on the first limit');
await p.click('[data-bid="Shopping"]'); await p.waitForTimeout(300);
const insp = await txt(p, '#bg-insp');
ok(/over for Shopping/.test(insp) && !/Even pace|usual/.test(insp) && /Spent\s*128\.99\s€ of 120\.00\s€/.test(insp) && !/%/.test(insp) && /Remove limit/.test(insp), 'B1 a row opens its panel: spent of the limit, no pace or usual rows', insp.slice(0, 160));
await p.hover('.bg-lead .bg-bar', { position: { x: 10, y: 3 } }); await p.waitForTimeout(250);
const tipT = await txt(p, '#tip');
ok(await p.$eval('#tip', (e) => e.classList.contains('on')) && /^Everything/.test(tipT) && /Spent\s*1,9\d\d\.\d\d\s€/.test(tipT) && /(Left to spend|Over the limit)\s*[\d,]+\.\d\d\s€/.test(tipT) && /Even pace by today\s*[\d,]+\.\d\d\s€/.test(tipT) && /Above the even pace\s*[\d,]+\.\d\d\s€/.test(tipT) && /same amount each day/.test(tipT), 'B1 hovering anywhere on the bar: spent, left or over, the even pace and how far apart', tipT);
await p.mouse.move(5, 5); await p.waitForTimeout(250);
ok(await p.$eval('#tip', (e) => !e.classList.contains('on')), 'B1 and the tooltip goes when the mouse leaves');
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
// A category without a limit: selected, the sheet opens to set one
ok((await p.$$('.bg-none[data-limit="Healthcare"]')).length === 1, 'B3 a category without a limit can be selected');
await p.click('.bg-none[data-limit="Healthcare"]'); await p.waitForTimeout(300);
const hcSug = await p.inputValue('#lim-amt');
ok(/^\d+0\.00$/.test(hcSug) && /Healthcare/.test(await txt(p, '#dlg')) && (await p.$$('#dlg #lim-per')).length === 1 && !/Remove limit/.test(await txt(p, '#dlg')), 'B3 its sheet starts from what is usually spent, rounded up to ten; Month or Year; nothing to remove', hcSug);
await p.fill('#lim-amt', '100'); await p.click('[data-dlg-ok]'); await p.waitForTimeout(600);
ok((await p.$$('[data-bid="Healthcare"]')).length === 1 && (await p.$$('.bg-none[data-limit="Healthcare"]')).length === 0, 'B3 saved: it moves up among the limits');
await api(p, '/budgets?category=Healthcare&month=' + new Date().toISOString().slice(0, 7), 'DELETE');
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(400);
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
ok(/^Spending/.test(nolim) && /You usually spend [\d,]+\.\d\d\s€ a month\. Set a limit/.test(nolim), 'B9 leads with spending, what is usually spent, and offers the limit', nolim);
await p.click('[data-limit=""]'); await p.waitForTimeout(300);
const allSug = await p.inputValue('#lim-amt'), allDlg = await txt(p, '#dlg');
ok(/Everything/.test(await txt(p, '#dlg h5')) && /^\d+00\.00$/.test(allSug) && /Limit, each month/.test(allDlg) && (await p.$$('#dlg #lim-per')).length === 0, 'B9 Set a limit opens the sheet for everything: the usual, rounded up to a hundred; monthly only, no Month or Year', allSug);
ok((await api(p, '/budgets', 'PUT', { category: '', period: 'year', amount: '30000', month: m })).s === 400, 'B9 the API refuses a yearly limit for everything');
p.errors = p.errors.filter((e) => !/status of 400/.test(e)); // that refusal, asked for on purpose
await p.fill('#lim-amt', '2700'); await p.click('[data-dlg-ok]'); await p.waitForTimeout(600);
ok(/Left to spend/.test(await txt(p, '.bg-sum')), 'B9 set: the page leads with what is left again');
await p.click('.bg-sum [data-limit=""]'); await p.waitForTimeout(300);
ok((await p.inputValue('#lim-amt')) === '2700.00' && /Remove limit/.test(await txt(p, '#dlg')), 'B9 Edit on the lead opens its sheet: change it or remove it');
await p.keyboard.press('Escape'); await p.waitForTimeout(200);
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
// Recap: last month's limits, household only, and in its PDF
const prevM = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); })();
await p.goto(BASE + '/review?m=' + prevM, { waitUntil: 'networkidle' }); await p.waitForTimeout(600);
const rb = await txt(p, '.w-mrev section[aria-labelledby="mr-bud"]');
const order = await p.$$eval('.w-mrev h2', (l) => l.map((h) => h.textContent));
ok(/Budget/.test(rb) && /42\.07\s€ left · 3 of 5 categories within/.test(rb) && /Groceries\s*630\.20\s€ of 600\.00\s€\s*30\.20\s€ over/.test(rb) && /^Everything/.test((await txt(p, '.w-mrev .w-mrbrow')).trim()), 'Recap: the month\'s limits, everything first, what was over; the header gives the month, then the categories', rb.slice(0, 200));
ok(order.indexOf('Budget') === order.indexOf('What changed') + 1, 'Recap: Budget right after What changed', order);
ok((await p.$eval('.w-mrev .w-mrbrow', (a) => a.getAttribute('href'))) === '/budget?m=' + prevM, 'Recap: a limit opens Budget on that month');
await p.evaluate(() => window.dispatchEvent(new Event('beforeprint'))); await p.waitForTimeout(300);
ok(/Budget/.test(await txt(p, '#w-print')) && /Groceries\s*630\.20\s€ of 600\.00\s€\s*30\.20\s€ over/.test(await txt(p, '#w-print .pr-bud')), 'Recap PDF: the same limits');
await p.evaluate(() => window.dispatchEvent(new Event('afterprint')));
await p.click('[data-mrsc="1"]'); await p.waitForTimeout(400);
ok((await p.$$('.w-mrev section[aria-labelledby="mr-bud"]')).length === 0, 'Recap: one person\'s recap has no household limits');
await p.click('[data-mrsc="all"]'); await p.waitForTimeout(300);
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
// B2 no limits at all: the same page, what was spent by category, and a link to set a limit; no setup
p = await open('desktop', '/budget');
const all = (await api(p, '/budgets')).j;
await p.route(/\/api\/budgets(\?|$)/, (r) => r.request().method() === 'GET' ? r.fulfill({ json: [] }) : r.continue());
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(500);
const none = await txt(p, '#bg-page');
ok(all.length > 0 && /^Spending/.test(none) && /Set a limit/.test(none) && /No limit/.test(none) && (await p.$$('.bg-none[data-limit]')).length > 2 && !/Start with these/.test(none) && (await p.$$('#bg-insp')).length === 0, 'B2 no limits: the page lists what was spent and offers a limit, no setup', none.slice(0, 160));
ok(await p.$eval('[data-step="-1"]', (b) => !b.disabled), 'B2 no limits: past months can still be opened');
// Back to the real limits
await p.unroute(/\/api\/budgets(\?|$)/); await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(400);
ok(p.errors.length === 0, 'no limits: no console errors', p.errors);
await p.done();
// The panel: a long transaction name gives way, the date and the amount stay inside it
p = await open('desktop', '/budget');
await api(p, '/transactions', 'POST', { type: 'expense', category: 'Groceries', amount: 11, date: new Date().toISOString().slice(0, 10), name: 'Fira Medieval - Llangonissa artesana de la Garrotxa i del Ripollès', person: 1 });
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(400);
await p.click('[data-bid="Groceries"]'); await p.waitForTimeout(300);
const past2 = await p.$eval('#bg-insp', (box) => { const r = box.getBoundingClientRect().right; return [...box.querySelectorAll('.rec-kv b')].filter((b) => b.getBoundingClientRect().right > r + 0.5).length; });
ok(past2 === 0 && await p.$eval('#bg-insp .bg-txn', (e) => e.scrollWidth > e.clientWidth), 'B1 a long name ends in an ellipsis; every amount stays inside the panel', past2);
ok(p.errors.length === 0, 'panel: no console errors', p.errors);
await p.done();
await browser.close();
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
