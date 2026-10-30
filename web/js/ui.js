/* Shared pieces of interface: tooltips, dialogs, toasts with Undo, focus traps and chart drawing. */
import { $, t, esc } from "./core.js";

/* ---------- tooltips: on hover, on focus, and on tap ---------- */
const tip = () => $("tip");
export function showTip(html, ev) { const el = tip(); el.innerHTML = html; el.classList.add("on"); moveTip(ev); }
export function moveTip(ev) {
  const el = tip(), r = el.getBoundingClientRect();
  let x, y;
  if (ev && ev.clientX !== undefined && (ev.clientX || ev.clientY)) { x = ev.clientX + 14; y = ev.clientY + 14; }
  else { const b = (ev && ev.target ? ev.target : document.activeElement).getBoundingClientRect(); x = b.left + b.width / 2; y = b.bottom + 8; }
  if (x + r.width > innerWidth - 8) x = Math.max(8, x - r.width - 28);
  if (y + r.height > innerHeight - 8) y = Math.max(8, y - r.height - 28);
  el.style.left = x + "px"; el.style.top = y + "px";
}
export function hideTip() { tip().classList.remove("on"); }
export function row(k, v, sw) { return '<div class="r"><span>' + (sw ? '<i style="background:' + sw + '"></i>' : "") + k + "</span><b>" + v + "</b></div>"; }
export function hover(node, html) {
  const show = (ev) => showTip(typeof html === "function" ? html() : html, ev);
  node.addEventListener("mousemove", show);
  node.addEventListener("mouseleave", hideTip);
  node.addEventListener("focus", show);
  node.addEventListener("blur", hideTip);
  node.addEventListener("touchstart", (ev) => { show(ev.touches[0] || ev); setTimeout(hideTip, 2500); }, { passive: true });
}

/* ---------- SVG charts, drawn at their real pixel width so text stays 11 to 12 px ---------- */
const NS = "http://www.w3.org/2000/svg";
export function el(tag, attrs, parent) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
export function txt(p, x, y, s, cls, anchor) { const n = el("text", { x, y, class: cls || "ax", "text-anchor": anchor || "start" }, p); n.textContent = s; return n; }
export function niceMax(v) { if (v <= 0) return 100; const p = Math.pow(10, Math.floor(Math.log10(v / 4))), steps = [1, 2, 2.5, 5, 10]; for (const s of steps) if (s * p * 4 >= v) return s * p * 4; return 40 * p; }
const CH = {};
const ro = new ResizeObserver((es) => es.forEach((e) => { const c = CH[e.target.id]; if (c && Math.abs(e.contentRect.width - (c.w || 0)) > 1) draw(e.target.id); }));
export function chart(id, h, fn, label) {
  const box = $(id);
  if (!box) return;
  const first = !CH[id] || CH[id].box !== box;
  CH[id] = { h, fn, w: 0, box, label };
  if (first) ro.observe(box);
  draw(id);
}
export function draw(id) {
  const c = CH[id], box = $(id);
  if (!box || !c) return;
  const w = Math.floor(box.clientWidth);
  if (!w) return;
  c.w = w;
  const h = typeof c.h === "function" ? c.h(w) : c.h;
  box.innerHTML = "";
  box.style.height = h + "px";
  const svg = el("svg", { width: w, height: h, viewBox: "0 0 " + w + " " + h, class: "chart", role: "img" }, box);
  if (c.label) svg.setAttribute("aria-label", typeof c.label === "function" ? c.label() : c.label);
  c.fn(svg, w, h);
}

/* ---------- toasts, with Undo for changes that are easy to reverse ---------- */
let toastTimer, undoFn = null;
export function toast(msg, undo) {
  $("toast-t").textContent = msg;
  undoFn = undo || null;
  $("toast-undo").hidden = !undo;
  $("toast").classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("on"), undo ? 7000 : 3200);
}
export function errorToast(e) { toast(e && e.message ? e.message : t("Something went wrong.")); }
export function initToast() {
  $("toast-undo").textContent = t("Undo");
  $("toast-undo").addEventListener("click", async () => {
    $("toast").classList.remove("on");
    const fn = undoFn; undoFn = null;
    if (fn) { try { await fn(); toast(t("Undone")); } catch (e) { errorToast(e); } }
  });
}

/* ---------- focus ---------- */
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
export function focusables(root) { return [...root.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null || n === document.activeElement); }
export function trapFocus(root, ev) {
  if (ev.key !== "Tab") return;
  const list = focusables(root);
  if (!list.length) return;
  const first = list[0], last = list[list.length - 1];
  if (ev.shiftKey && document.activeElement === first) { last.focus(); ev.preventDefault(); }
  else if (!ev.shiftKey && document.activeElement === last) { first.focus(); ev.preventDefault(); }
}

/* ---------- dialogs ----------
   openDialog({title, body, ok, cancel, danger, wide, onOk(root) → false keeps it open, onOpen(root)}) */
let current = null;
export function openDialog(o) {
  const w = $("dlg");
  const back = document.activeElement;
  w.innerHTML = '<div class="w-dialog' + (o.wide ? " wide" : "") + '" role="dialog" aria-modal="true" aria-labelledby="dlg-t"><h5 id="dlg-t">' + o.title + "</h5>" + (o.body || "") +
    '<p class="w-dlgerr" id="dlg-err" role="alert" hidden></p><div class="w-dlgf">' + (o.noCancel ? "" : '<button type="button" class="w-btn ghost" data-dlg-x>' + (o.cancel || t("Cancel")) + "</button>") +
    (o.ok ? '<button type="button" class="w-btn primary' + (o.danger ? " dangerbtn" : "") + '" data-dlg-ok>' + o.ok + "</button>" : "") + "</div></div>";
  w.hidden = false;
  current = { o, back };
  const root = w.firstChild;
  if (o.onOpen) o.onOpen(root);
  const first = root.querySelector("[autofocus]") || root.querySelector("input,select,textarea") || root.querySelector("[data-dlg-x]") || root.querySelector("[data-dlg-ok]");
  if (first) first.focus();
  return root;
}
export function closeDialog() {
  if (!current) return;
  const { back } = current;
  current = null;
  $("dlg").hidden = true;
  $("dlg").innerHTML = "";
  if (back && document.contains(back)) back.focus();
}
export function dialogError(msg) { const e = $("dlg-err"); if (e) { e.textContent = msg; e.hidden = !msg; } }
export function dialogOpen() { return !!current; }
export function initDialogs() {
  const w = $("dlg");
  w.addEventListener("click", async (ev) => {
    if (ev.target === w || ev.target.closest("[data-dlg-x]")) { closeDialog(); return; }
    const ok = ev.target.closest("[data-dlg-ok]");
    if (ok && current) {
      const o = current.o;
      if (!o.onOk) { closeDialog(); return; }
      ok.disabled = true;
      try {
        const keep = await o.onOk(w.firstChild);
        if (keep !== false && current && current.o === o) closeDialog();
      } catch (e) { dialogError(e.message || t("Something went wrong.")); }
      finally { if (ok.isConnected) { ok.disabled = false; if (current && current.o === o) ok.focus(); } }
    }
  });
  w.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") { ev.stopPropagation(); closeDialog(); }
    else if (ev.key === "Enter" && ev.target.matches("input:not([type=checkbox]):not([type=radio])")) { const ok = w.querySelector("[data-dlg-ok]"); if (ok) { ev.preventDefault(); ok.click(); } }
    else trapFocus(w.firstChild, ev);
  });
}
export function confirmDialog(title, body, ok, danger) {
  return new Promise((resolve) => {
    let done = false;
    openDialog({ title, body: body ? "<p>" + body + "</p>" : "", ok, danger, onOk: () => { done = true; resolve(true); } });
    const obs = new MutationObserver(() => { if ($("dlg").hidden) { obs.disconnect(); if (!done) resolve(false); } });
    obs.observe($("dlg"), { attributes: true, attributeFilter: ["hidden"] });
  });
}

/* ---------- small builders ---------- */
export function seg(id, items, value, label, cls) {
  return '<div class="w-seg ' + (cls || "") + '" id="' + id + '" role="group" aria-label="' + esc(label) + '">' +
    items.map(([v, l]) => '<button type="button" data-v="' + esc(v) + '" aria-pressed="' + (String(v) === String(value)) + '">' + l + "</button>").join("") + "</div>";
}
export function sw(id, on, label) { return '<button type="button" class="w-switch" role="switch" id="' + id + '" aria-checked="' + !!on + '" aria-label="' + esc(label || "") + '"></button>'; }
export function empty(iconId, title, body, action) {
  return '<div class="w-empty"><span class="w-empty-i"><svg class="i"><use href="#i-' + iconId + '"/></svg></span><b>' + title + "</b>" + (body ? "<p>" + body + "</p>" : "") + (action || "") + "</div>";
}
