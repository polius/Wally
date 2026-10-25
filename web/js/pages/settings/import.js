/* Settings › Import and export.
   Import: choose a CSV, map its columns (Wally v1 files and Wally exports are recognised), preview what
   happens to each row (new, matched with something typed by hand, possible match, or imported before),
   decide, then commit. Export: every transaction as a CSV that imports back into Wally. */
import { t, tn, esc, state, f, num, dlab, pname, couple, parseAmt, POST, GET, reloadLedger, TODAY } from "../../core.js";
import { toast, errorToast, empty } from "../../ui.js";
import { refresh } from "../../shell.js";
import { group, gi, ico, linkBtn, loadScript, download, paint, segK as seg } from "./common.js";

const PAPA = "/js/vendors/papaparse.min.js";
const PAGE = 100;
const V1 = ["name", "category", "tags", "amount", "type", "date"];
const WALLY = ["date", "name", "category", "amount", "type", "tags", "person", "paid_by", "shares", "note"];
const FIELDS = () => [
  ["", t("Don’t import")], ["date", t("Date")], ["name", t("Name")], ["amount", t("Amount")], ["type", t("Type")], ["category", t("Category")],
  ["tags", t("Tags")], ["person", t("Whose")], ["paid_by", t("Paid by")], ["note", t("Note")],
];
/* Bank exports name their columns in many languages */
const GUESS = [
  ["date", /^(date|fecha|data|datum|dia|day|booking|value date|fecha valor|f\. ?valor|transaction date|buchungstag|valuta)/i],
  ["amount", /^(amount|importe|import|montant|betrag|valor|value|sum|cantidad|quantitat|importo|сумма|金额|金額|금액)/i],
  ["name", /(name|concept|description|descripci|payee|merchant|details|memo|beneficiar|libell|verwendungszweck|causale|descri|текст|摘要|内容)/i],
  ["category", /categor/i], ["type", /^(type|tipo|tipus)$/i], ["tags", /^(tags?|etiquet)/i], ["note", /^(notes?|nota|comment)/i],
  ["person", /^(person|persona|who|whose|owner)$/i], ["paid_by", /^paid.?by$/i],
];
const DATE_FORMATS = () => [["dmy", t("DD/MM/YYYY")], ["ymd", t("YYYY-MM-DD")], ["mdy", t("MM/DD/YYYY")]];

let box = null;
let step = "start";       // start → map → preview → done
let file = null;          // {name, header:[...], rows:[[...]], kind}
let map = [];             // for each column, the field it fills ("" = not imported)
let dateFmt = "dmy";
let spending = "neg";      // without a Type column: spending is written negative ("neg") or positive ("pos")
let prev = null;          // {rows:[ImportRow], items:[preview row], counts, bad:[{line, why}]}
let choice = {};          // index → {action, category, who}
let filter = "all", limit = PAGE, busy = false, result = null;

export function mount(el) {
  box = el;
  box.addEventListener("click", onClick);
  box.addEventListener("change", onChange);
  box.addEventListener("dragover", (ev) => { if (ev.target.closest(".w-drop")) { ev.preventDefault(); ev.target.closest(".w-drop").classList.add("over"); } });
  box.addEventListener("dragleave", (ev) => { const d = ev.target.closest(".w-drop"); if (d) d.classList.remove("over"); });
  box.addEventListener("drop", (ev) => { const d = ev.target.closest(".w-drop"); if (!d) return; ev.preventDefault(); d.classList.remove("over"); const fl = ev.dataTransfer.files[0]; if (fl) readFile(fl); });
  render();
}
export function update() { if (box && step !== "preview") render(); else if (box) renderFoot(); }
export function unmount() { box = null; }

/* ---------- drawing ---------- */
function render() {
  let html = "";
  if (step === "start") html = dropZone();
  else if (step === "map") html = mapping();
  else if (step === "preview") html = previewHtml();
  else if (step === "done") html = done();
  paint(box, html + exportGroup());
  if (step === "preview") renderFoot();
}

function dropZone() {
  return '<label class="w-drop" data-k="drop">' + '<svg class="i w-drop-i" aria-hidden="true"><use href="#i-file"/></svg><b>' + t("Drop a CSV here, or choose a file") + "</b><span>" +
    t("Any bank export works, and files from Wally v1 and 2.0. Nothing is written until you confirm the preview.") + "</span>" +
    '<input type="file" id="imp-file" accept=".csv,text/csv,text/plain" class="w-vh"><span class="w-btn ghost" aria-hidden="true">' + t("Choose a file") + "</span></label>";
}

function kindLabel() {
  return file.kind === "v1" ? t("Wally v1 file") : file.kind === "wally" ? t("Wally export") : t("Bank file: check the columns");
}
function mapping() {
  const fields = FIELDS();
  const sample = file.rows.slice(0, 5);
  const missing = ["date", "amount"].filter((k) => !map.includes(k));
  const th = file.header.map((h, i) => '<th scope="col"><span class="w-imp-h">' + esc(h || t("Column {n}", { n: i + 1 })) + '</span><select data-col="' + i + '" data-k="col:' + i + '" aria-label="' + esc(t("What {column} holds", { column: h || t("Column {n}", { n: i + 1 }) })) + '">' +
    fields.map(([v, l]) => '<option value="' + v + '"' + (map[i] === v ? " selected" : "") + ">" + l + "</option>").join("") + "</select></th>").join("");
  const body = sample.map((r) => "<tr>" + file.header.map((h, i) => "<td>" + esc(r[i] || "") + "</td>").join("") + "</tr>").join("");
  return '<div class="w-sgroup"><div class="w-glabel"><span>' + t("Columns of {file}, {n} rows", { file: esc(file.name), n: num(file.rows.length) }) + '</span><span class="w-pill' + (file.kind === "bank" ? "" : " good") + '">' + kindLabel() + "</span></div>" +
    '<div class="w-group"><div class="w-imp-opts">' +
      '<label class="w-inline"><span>' + t("Dates are written") + '</span><select class="w-mini" id="imp-datefmt" data-k="datefmt">' + DATE_FORMATS().map(([v, l]) => '<option value="' + v + '"' + (v === dateFmt ? " selected" : "") + ">" + l + "</option>").join("") + "</select></label>" +
      (map.includes("type") ? '<span class="w-hint">' + t("The Type column says what is income and what is spending.") + "</span>"
        : '<label class="w-inline"><span>' + t("Spending is written as") + '</span><select class="w-mini" id="imp-signs" data-k="signs"><option value="neg"' + (spending === "neg" ? " selected" : "") + ">" + t("Negative amounts, like −12.40") +
          '</option><option value="pos"' + (spending === "pos" ? " selected" : "") + ">" + t("Positive amounts, like 12.40") + "</option></select></label>") + "</div>" +
    '<div class="w-scroll"><table class="w-table w-imp-map"><thead><tr>' + th + "</tr></thead><tbody>" + body + "</tbody></table></div></div></div>" +
    '<div class="w-imp-foot"><button type="button" class="w-btn ghost" data-act="reset" data-k="reset">' + t("Choose another file") + "</button>" +
    '<button type="button" class="w-btn primary" data-act="preview" data-k="preview"' + (missing.length || busy ? " disabled" : "") + ">" +
    (missing.length ? (missing.includes("date") ? t("Pick the Date column") : t("Pick the Amount column")) : busy ? t("Checking…") : tn(file.rows.length, "Preview {n} row", "Preview {n} rows")) + "</button></div>";
}

const STATUS = () => ({ new: [t("New"), "good"], matched: [t("Already added"), ""], possible: [t("Possible match"), "warn"], skipped: [t("Imported before"), ""] });
function previewHtml() {
  const c = prev.counts;
  const items = prev.items.filter((it) => filter === "all" || it.status === filter);
  const st = STATUS();
  const people = state.people;
  const who = (it) => {
    const ch = choice[it.index];
    if (people.length < 2) return "";
    return '<select class="w-imp-sel" data-who="' + it.index + '" data-k="who:' + it.index + '" aria-label="' + esc(t("Whose")) + '">' +
      people.map((p) => '<option value="' + p.id + '"' + (ch.who === String(p.id) ? " selected" : "") + ">" + esc(p.name) + "</option>").join("") +
      '<option value="shared"' + (ch.who === "shared" ? " selected" : "") + ">" + t("Shared") + "</option></select>";
  };
  const catSel = (it) => {
    const ch = choice[it.index], list = state.categories.slice();
    if (ch.category && !list.includes(ch.category)) list.unshift(ch.category);
    return '<select class="w-imp-sel" data-cat="' + it.index + '" data-k="cat:' + it.index + '" aria-label="' + esc(t("Category")) + '">' +
      (ch.category ? "" : '<option value="" selected>' + t("Pick one") + "</option>") +
      list.map((k) => '<option value="' + esc(k) + '"' + (k === ch.category ? " selected" : "") + ">" + esc(k) + (state.categories.includes(k) ? "" : " · " + t("new")) + "</option>").join("") + "</select>" +
      (it.rule_id && ch.category === it.category ? ' <span class="w-hint">' + t("from a rule") + "</span>" : "");
  };
  const decide = (it) => {
    const ch = choice[it.index];
    const opts = it.status === "possible" ? [["", t("Decide…")], ["match", t("Same one: keep once")], ["add", t("Different: add it")]] : [["match", t("Keep once")], ["add", t("Add it as new")]];
    return '<select class="w-imp-sel" data-dec="' + it.index + '" data-k="dec:' + it.index + '" aria-label="' + esc(t("What to do with {name}", { name: it.row.name })) + '">' +
      opts.map(([v, l]) => '<option value="' + v + '"' + ((ch.action || "") === v ? " selected" : "") + ">" + l + "</option>").join("") + "</select>";
  };
  const rows = items.slice(0, limit).map((it) => {
    const r = it.row, ch = choice[it.index], [label, cls] = st[it.status];
    const adding = ch.action === "add";
    const statusCell = '<span class="w-pill ' + cls + '">' + label + "</span>" + (it.match ? '<small class="w-imp-m">' + t("{name}, {date}", { name: esc(it.match.name || it.match.category), date: dlab(it.match.date) }) + "</small>" : "") +
      (it.status === "matched" || it.status === "possible" ? decide(it) : "");
    return '<tr class="' + (it.status === "skipped" ? "w-imp-skip" : "") + (it.status === "possible" && !ch.action ? " w-imp-open" : "") + '"><td>' + statusCell + "</td><td>" + esc(dlab(r.date)) + "</td><td>" + esc(r.name) + "</td>" +
      '<td class="amt w-imp-amt">' + (r.type === "income" ? "+" : "−") + esc(f(Number(r.amount))) + "</td>" +
      "<td>" + (it.status === "skipped" ? "" : adding ? catSel(it) : esc(it.match ? it.match.category : "")) + "</td>" +
      (people.length >= 2 ? "<td>" + (it.status === "skipped" ? "" : adding ? who(it) : esc(it.match ? pname(it.match.person_id) : "")) + "</td>" : "") + "</tr>";
  });
  const more = items.length > limit ? '<div class="w-gmore">' + linkBtn(t("Show {n} more", { n: num(Math.min(PAGE, items.length - limit)) }), ' data-act="more" data-k="more"') + "</div>" : "";
  const bad = prev.bad.length ? '<details class="w-imp-bad"><summary>' + tn(prev.bad.length, "{n} row can’t be read and is left out", "{n} rows can’t be read and are left out") + "</summary><ul>" +
    prev.bad.slice(0, 20).map((b) => "<li>" + t("Line {n}: {why}", { n: num(b.line), why: esc(b.why) }) + "</li>").join("") + "</ul></details>" : "";
  // Only the kinds this file has
  const filters = [["all", t("All") + " " + num(prev.items.length)], ["new", t("New") + " " + num(c.new)], ["matched", t("Already added") + " " + num(c.matched)], ["possible", t("Possible") + " " + num(c.possible)], ["skipped", t("Imported before") + " " + num(c.skipped)]]
    .filter(([k]) => k === "all" || c[k]);
  return '<div class="w-sgroup"><div class="w-glabel"><span>' + t("Preview of {file}", { file: esc(file.name) }) + "</span>" +
    '<span class="w-imp-counts">' + [["good", tn(c.new, "{n} new", "{n} new")], ["", tn(c.matched, "{n} already added", "{n} already added")], ["warn", tn(c.possible, "{n} possible match", "{n} possible matches")], ["", tn(c.skipped, "{n} imported before", "{n} imported before")]]
      .filter((x, i) => i === 0 || c[["new", "matched", "possible", "skipped"][i]]).map(([cls, s]) => '<span class="w-pill ' + cls + '">' + s + "</span>").join("") + "</span></div>" +
    '<div class="w-group"><div class="w-imp-opts">' + seg("imp-filter", filters, filter, t("Show rows"), "sm") + fillAll() +
    '<span class="w-hint">' + t("Already added: the same amount within 3 days and a similar name, typed by hand. It is kept once, with the bank’s name as its source.") + "</span></div>" +
    '<div class="w-scroll"><table class="w-table w-imp-prev"><thead><tr><th scope="col">' + t("What happens") + '</th><th scope="col">' + t("Date") + '</th><th scope="col">' + t("Name") + '</th><th scope="col" class="w-imp-amt">' + t("Amount") + '</th><th scope="col">' + t("Category") + "</th>" +
    (people.length >= 2 ? '<th scope="col">' + t("Whose") + "</th>" : "") + "</tr></thead><tbody>" +
    (rows.join("") || '<tr><td colspan="6">' + empty("filter", t("No rows here"), "") + "</td></tr>") + "</tbody></table></div>" + more + "</div>" + bad + "</div>" +
    '<div class="w-imp-foot" id="imp-foot"></div>';
}
/* Rows the file and the rules left without a category can all get one at once */
function fillAll() {
  const n = prev.items.filter((it) => choice[it.index].action === "add" && !choice[it.index].category).length;
  if (!n) return "";
  return '<label class="w-inline"><span>' + tn(n, "{n} row has no category. Give it:", "{n} rows have no category. Give them:") + '</span><select class="w-mini" id="imp-fill" data-k="fill"><option value="">' + t("Pick one") + "</option>" +
    state.categories.map((k) => '<option value="' + esc(k) + '">' + esc(k) + "</option>").join("") + "</select></label>";
}
function renderFoot() {
  const foot = box && box.querySelector("#imp-foot");
  if (!foot) return;
  const open = prev.items.filter((it) => it.status === "possible" && !choice[it.index].action).length;
  const noCat = prev.items.filter((it) => choice[it.index] && choice[it.index].action === "add" && !choice[it.index].category).length;
  const adds = prev.items.filter((it) => choice[it.index] && choice[it.index].action === "add").length;
  const matches = prev.items.filter((it) => choice[it.index] && choice[it.index].action === "match").length;
  let label;
  if (open) label = tn(open, "Decide {n} possible match", "Decide {n} possible matches");
  else if (noCat) label = tn(noCat, "Pick a category for {n} row", "Pick a category for {n} rows");
  else if (!adds && !matches) label = t("Nothing new to import");
  else if (busy) label = t("Importing…");
  else if (adds && matches) label = t("Import {n} and keep {m} once", { n: num(adds), m: num(matches) });
  else if (adds) label = tn(adds, "Import {n} transaction", "Import {n} transactions");
  else label = tn(matches, "Keep {n} once", "Keep {n} once");
  foot.innerHTML = '<button type="button" class="w-btn ghost" data-act="reset" data-k="reset">' + t("Cancel") + "</button>" +
    '<button type="button" class="w-btn ghost" data-act="back" data-k="back">' + t("Back to columns") + "</button>" +
    '<button type="button" class="w-btn primary" data-act="commit" data-k="commit"' + (open || noCat || busy || (!adds && !matches) ? " disabled" : "") + ">" + label + "</button>";
}
function done() {
  return '<div class="w-group">' + empty("check", t("Import finished"),
    t("{added} added and {matched} kept once with what you had typed.", { added: tn(result.added, "{n} transaction", "{n} transactions"), matched: num(result.matched) }),
    '<div class="w-imp-acts"><button type="button" class="w-btn ghost" data-act="reset" data-k="reset">' + t("Import another file") + '</button><a class="w-btn primary" href="/transactions" data-link>' + t("See transactions") + "</a></div>") + "</div>";
}
function exportGroup() {
  return group(t("Export"), [
    gi(ico("download"), t("Export everything"), t("CSV with date, name, category, amount, type, tags, person, paid by, shares and note. Imports back into Wally."),
      '<button type="button" class="w-btn ghost" data-act="export" data-k="export"' + (state.tx.length ? "" : " disabled") + ">" + t("Export CSV") + "</button>"),
    gi(ico("file"), t("Wally v1 file format"), t("name,category,tags,amount,type,date is still accepted, so old exports import as they are.")),
  ]);
}

/* ---------- reading the file ---------- */
async function readFile(fl) {
  try {
    await loadScript(PAPA);
    const text = (await fl.text()).replace(/^﻿/, "");
    const parsed = window.Papa.parse(text, { skipEmptyLines: "greedy" });
    const data = parsed.data.filter((r) => r.some((c) => String(c).trim() !== ""));
    if (data.length < 2) throw new Error(t("This file has no rows."));
    const header = data[0].map((h) => String(h).trim());
    file = { name: fl.name, header, rows: data.slice(1), kind: "bank" };
    const lower = header.map((h) => h.toLowerCase());
    if (WALLY.slice(0, 7).every((k) => lower.includes(k))) file.kind = "wally";
    else if (V1.every((k) => lower.includes(k))) file.kind = "v1";
    map = guessMap(lower, file.kind !== "bank");
    spending = "neg";
    dateFmt = guessDates();
    step = "map";
    render();
  } catch (e) { errorToast(e); }
}
function guessMap(lower, exact) {
  const out = lower.map(() => "");
  const taken = new Set();
  if (exact) {
    lower.forEach((h, i) => { const k = h === "shares" ? "" : h; if (FIELDS().some(([v]) => v === k) && k && !taken.has(k)) { out[i] = k; taken.add(k); } });
    return out;
  }
  for (const [k, re] of GUESS) {
    const i = lower.findIndex((h, j) => !out[j] && re.test(h));
    if (i >= 0 && !taken.has(k)) { out[i] = k; taken.add(k); }
  }
  return out;
}
function guessDates() {
  const col = map.indexOf("date");
  if (col < 0) return dateFmt;
  const vals = file.rows.slice(0, 200).map((r) => String(r[col] || "").trim());
  if (vals.some((v) => /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(v))) return "ymd";
  let dmy = false, mdy = false;
  vals.forEach((v) => { const m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/); if (m) { if (+m[1] > 12) dmy = true; if (+m[2] > 12) mdy = true; } });
  return mdy && !dmy ? "mdy" : "dmy";
}
function parseDate(v) {
  v = String(v || "").trim();
  let y, m, d, x;
  if (dateFmt === "ymd" && (x = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) [y, m, d] = [+x[1], +x[2], +x[3]];
  else if (dateFmt !== "ymd" && (x = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/))) {
    [d, m, y] = dateFmt === "dmy" ? [+x[1], +x[2], +x[3]] : [+x[2], +x[1], +x[3]];
    if (y < 100) y += 2000;
  } else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}
/* "−48,20", "(48.20)", "48.20-", "1.234,56 €" → a signed number */
function parseSigned(v) {
  let s = String(v || "").trim().replace(/[−‒–]/g, "-");
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/-$/.test(s)) { neg = true; s = s.slice(0, -1); }
  if (/^-/.test(s)) { neg = !neg; s = s.slice(1); }
  if (/^\+/.test(s)) s = s.slice(1);
  const n = parseAmt(s);
  return n === null ? null : neg ? -n : n;
}
const INCOME = /^(income|ingreso|ingrés|ingres|revenu|einnahme|entrata|receita|доход|收入|収入|수입|आय|دخل|in|credit|cr|haber)$/i;
const EXPENSE = /^(expense|gasto|despesa|dépense|depense|ausgabe|spesa|расход|支出|지출|व्यय|مصروف|out|debit|dr|debe)$/i;
function readTags(v) {
  const s = String(v || "").trim();
  if (!s) return [];
  if (s.includes("#")) return (s.match(/#[^\s,;#]+/g) || []).map((g) => g.slice(1));
  // Wally v1 writes tags as a CSV inside the cell
  const row = window.Papa.parse(s, { header: false }).data[0] || [];
  return row.map((g) => String(g).trim()).filter(Boolean);
}
function buildRows() {
  const idx = (k) => map.indexOf(k);
  const at = (r, k) => (idx(k) >= 0 ? String(r[idx(k)] == null ? "" : r[idx(k)]).trim() : "");
  const byName = Object.fromEntries(state.people.map((p) => [p.name.toLocaleLowerCase(), String(p.id)]));
  const rows = [], bad = [];
  file.rows.forEach((r, i) => {
    const line = i + 2;
    const date = parseDate(at(r, "date"));
    if (!date) return bad.push({ line, why: t("the date “{v}” is not {format}", { v: at(r, "date"), format: DATE_FORMATS().find((x) => x[0] === dateFmt)[1] }) });
    const n = parseSigned(at(r, "amount"));
    if (n === null) return bad.push({ line, why: t("“{v}” is not an amount", { v: at(r, "amount") }) });
    if (n === 0) return bad.push({ line, why: t("the amount is zero") });
    const typeRaw = at(r, "type");
    let type;
    if (INCOME.test(typeRaw)) type = "income";
    else if (EXPENSE.test(typeRaw)) type = "expense";
    else if (idx("type") >= 0) type = "expense";
    else type = (n < 0) === (spending === "neg") ? "expense" : "income";
    rows.push({
      line, date, name: at(r, "name").slice(0, 200), amount: Math.abs(n).toFixed(2), type,
      category: at(r, "category"), tags: readTags(at(r, "tags")), person: at(r, "person"),
      paid_by: byName[at(r, "paid_by").toLocaleLowerCase()] || "", note: at(r, "note"),
    });
  });
  return { rows, bad };
}

async function runPreview() {
  const { rows, bad } = buildRows();
  if (!rows.length) { toast(bad.length ? t("No row could be read. Check the date format and the columns.") : t("This file has no rows.")); return; }
  busy = true; render();
  try {
    const res = await POST("/import/preview", rows.map(({ line, ...row }) => row));
    const meKey = state.me || (state.people[0] ? String(state.people[0].id) : "");
    prev = { rows, bad, counts: res.counts, items: res.rows.map((it) => ({ ...it, row: rows[it.index] })) };
    choice = {};
    prev.items.forEach((it) => {
      const action = it.status === "new" ? "add" : it.status === "matched" ? "match" : it.status === "possible" ? "" : "skip";
      const who = it.shared ? "shared" : it.person_id !== null && it.person_id !== undefined ? String(it.person_id) : meKey;
      choice[it.index] = { action, category: it.category || "", who };
    });
    filter = res.counts.possible ? "possible" : "all";
    limit = PAGE;
    step = "preview";
  } catch (e) { errorToast(e); }
  busy = false;
  render();
}

async function commit() {
  busy = true; renderFoot();
  try {
    const rows = prev.items.filter((it) => choice[it.index].action === "add" || choice[it.index].action === "match").map((it) => {
      const ch = choice[it.index];
      const { line, ...row } = it.row;
      return {
        ...row, category: ch.category || row.category, import_ref: it.import_ref, action: ch.action, match_id: ch.action === "match" && it.match ? it.match.id : null,
        person_id: ch.who && ch.who !== "shared" ? Number(ch.who) : null, shared: ch.who === "shared" && state.people.length >= 2,
      };
    });
    result = await POST("/import/commit", { rows });
    const [cats, tags, irules] = await Promise.all([GET("/categories"), GET("/tags"), GET("/rules"), reloadLedger()]);
    state.categories = cats; state.tags = tags; state.irules = irules;
    step = "done";
    busy = false;
    refresh({ data: true });
    toast(t("Imported {n}, kept {m} once", { n: num(result.added), m: num(result.matched) }));
  } catch (e) { busy = false; renderFoot(); errorToast(e); }
}

/* ---------- export ---------- */
async function exportAll() {
  try {
    await loadScript(PAPA);
    const list = state.tx.slice().reverse();
    const data = list.map((tx) => [
      tx.d, tx.n, tx.c, (tx.ac / 100).toFixed(2), tx.type,
      tx.tags.length ? window.Papa.unparse([tx.tags.map((g) => g.slice(1))], { header: false }).replace(/\r?\n$/, "") : "",
      tx.p ? pname(tx.p) : couple() ? "shared" : "",
      tx.by ? pname(tx.by) : "",
      tx.shc ? Object.entries(tx.shc).map(([k, c]) => pname(k) + ":" + (c / 100).toFixed(2)).join(";") : "",
      tx.note || "",
    ]);
    const csv = window.Papa.unparse({ fields: WALLY, data });
    const name = "wally-" + TODAY + ".csv";
    download(name, "﻿" + csv, "text/csv;charset=utf-8");
    toast(tn(list.length, "Exported {n} transaction as {file}", "Exported {n} transactions as {file}", { file: name }));
  } catch (e) { errorToast(e); }
}

/* ---------- events ---------- */
function onChange(ev) {
  const el = ev.target;
  if (el.id === "imp-file") { if (el.files[0]) readFile(el.files[0]); el.value = ""; return; }
  if (el.dataset.col !== undefined) {
    const i = +el.dataset.col, v = el.value;
    if (v) map = map.map((x, j) => (j !== i && x === v ? "" : x));   // a field comes from one column only
    map[i] = v;
    if (v === "date") dateFmt = guessDates();
    return render();
  }
  if (el.id === "imp-datefmt") { dateFmt = el.value; return; }
  if (el.id === "imp-signs") { spending = el.value; return; }
  if (el.dataset.dec !== undefined) { choice[el.dataset.dec].action = el.value; return render(); }
  if (el.dataset.cat !== undefined) { choice[el.dataset.cat].category = el.value; return el.value ? render() : renderFoot(); }
  if (el.id === "imp-fill" && el.value) {
    prev.items.forEach((it) => { const ch = choice[it.index]; if (ch.action === "add" && !ch.category) ch.category = el.value; });
    return render();
  }
  if (el.dataset.who !== undefined) { choice[el.dataset.who].who = el.value; return; }
}
function onClick(ev) {
  const fb = ev.target.closest("#imp-filter [data-v]");
  if (fb) { filter = fb.dataset.v; limit = PAGE; return render(); }
  const b = ev.target.closest("[data-act]");
  if (!b || b.disabled) return;
  switch (b.dataset.act) {
    case "reset": step = "start"; file = null; prev = null; result = null; return render();
    case "back": step = "map"; return render();
    case "preview": return runPreview();
    case "more": limit += PAGE; return render();
    case "commit": return commit();
    case "export": return exportAll();
  }
}
/* Onboarding's "Import a CSV" lands here */
export { readFile };
