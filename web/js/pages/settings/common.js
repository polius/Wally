/* Pieces every Settings pane uses: grouped rows, switches, dates, copying and downloading. */
import { t, esc, icon, LANG, F, T } from "../../core.js";
import { toast, seg } from "../../ui.js";

/* A labelled group of rows, like System Settings: label on the left, a note on the right */
export function group(label, rows, right, attrs) {
  return '<div class="w-sgroup"' + (attrs || "") + '><div class="w-glabel"><span>' + label + "</span>" + (right ? "<span>" + right + "</span>" : "") +
    '</div><div class="w-group">' + rows.join("") + "</div></div>";
}
/* One row: icon, title and line under it, then whatever goes on the right */
export function gi(iconHtml, title, sub, right, attrs) {
  return '<div class="w-gi"' + (attrs || "") + ">" + iconHtml + "<div><h6>" + title + "</h6>" + (sub ? "<p>" + sub + "</p>" : "") + "</div>" + (right || "<span></span>") + "</div>";
}
/* A row that is itself a button, for "Add a person" and the like */
export function giButton(iconHtml, title, sub, attrs) {
  return '<button type="button" class="w-gi w-gbtn"' + (attrs || "") + ">" + iconHtml + "<div><h6>" + title + "</h6>" + (sub ? "<p>" + sub + "</p>" : "") + "</div>" + icon("right", "w-gchev") + "</button>";
}
export function ico(name, cls) { return '<span class="w-ico' + (cls ? " " + cls : "") + '">' + icon(name) + "</span>"; }
/* An on/off switch. The label is what it turns on. */
export function toggle(id, on, label, disabled) {
  return '<button type="button" class="w-switch" role="switch" id="' + id + '" aria-checked="' + !!on + '" aria-label="' + esc(label) + '"' + (disabled ? " disabled" : "") + "></button>";
}
/* Wide controls (segments, selects) move under the text on a phone */
export function ctl(html) { return '<div class="w-gctl">' + html + "</div>"; }
export function linkBtn(label, attrs, cls) { return '<button type="button" class="w-link' + (cls ? " " + cls : "") + '"' + (attrs || "") + ">" + label + "</button>"; }
export function iconBtn(name, label, attrs, cls) { return '<button type="button" class="w-x' + (cls ? " " + cls : "") + '" aria-label="' + esc(label) + '" title="' + esc(label) + '"' + (attrs || "") + ">" + icon(name) + "</button>"; }
export function trashBtn(label, attrs) { return iconBtn("trash", label, attrs); }

/* A labelled field inside a dialog */
export function field(label, input, hint) {
  return '<label class="w-sfield"><span>' + label + "</span>" + input + (hint ? '<small class="w-hint">' + hint + "</small>" : "") + "</label>";
}
export function textInput(id, value, attrs) {
  return '<div class="w-input"><input id="' + id + '" value="' + esc(value || "") + '" autocomplete="off"' + (attrs || "") + "></div>";
}
export function passwordInput(id, autocomplete, attrs) {
  return '<div class="w-input"><input type="password" id="' + id + '" autocomplete="' + (autocomplete || "current-password") + '"' + (attrs || "") + "></div>";
}

/* ---------- dates and times from the server ---------- */
/* The API writes UTC without a zone ("2026-10-25 09:33:49" or "2026-10-25T09:33:49.87"). */
export function parseUtc(s) {
  if (!s) return null;
  let v = String(s).replace(" ", "T");
  if (!/[zZ]|[+-]\d\d:?\d\d$/.test(v)) v += "Z";
  const d = new Date(v);
  return isNaN(d) ? null : d;
}
/* A local wall-clock time, like the backups' "created" */
export function parseLocal(s) { const d = s ? new Date(String(s).replace(" ", "T")) : null; return d && !isNaN(d) ? d : null; }
export function localISO(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
export function clock(d) { return new Intl.DateTimeFormat(LANG, { hour: "2-digit", minute: "2-digit" }).format(d); }
export function dayLabel(d) { return F.dayMonth.format(T(localISO(d))) + " " + d.getFullYear(); }
/* "3 days ago", "yesterday", "just now" */
export function ago(d) {
  if (!d) return t("never");
  const sec = (d.getTime() - Date.now()) / 1000;
  if (Math.abs(sec) < 60) return t("just now");
  const rtf = new Intl.RelativeTimeFormat(LANG, { numeric: "auto" });
  const steps = [[60, "minute"], [24, "hour"], [30, "day"], [12, "month"], [Infinity, "year"]];
  let v = sec / 60;
  for (const [size, unit] of steps) {
    if (Math.abs(v) < size) return rtf.format(Math.round(v), unit);
    v /= size;
  }
  return "";
}

/* "Chrome on Mac" from a browser's user agent */
export function deviceLabel(ua) {
  ua = ua || "";
  if (!ua) return t("Unknown browser");
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /SamsungBrowser/.test(ua) ? "Samsung Internet"
    : /HeadlessChrome/.test(ua) ? "Chrome" : /Chrome\/|CriOS/.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /curl|python|okhttp|Shortcuts|HTTP/i.test(ua) ? ua.split("/")[0] : "";
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X|Macintosh/.test(ua) ? "Mac"
    : /Windows/.test(ua) ? "Windows" : /CrOS/.test(ua) ? "ChromeOS" : /Linux/.test(ua) ? "Linux" : "";
  if (browser && os) return t("{browser} on {device}", { browser, device: os });
  return browser || os || t("Unknown browser");
}
export function isPhoneUA(ua) { return /iPhone|Android.*Mobile/.test(ua || ""); }

/* Sizes: "2.4 MB" */
export function size(bytes) {
  const n = new Intl.NumberFormat(LANG, { maximumFractionDigits: 1 });
  if (bytes >= 1048576) return t("{n} MB", { n: n.format(bytes / 1048576) });
  return t("{n} KB", { n: n.format(Math.max(1, Math.round(bytes / 1024))) });
}

/* ---------- copy, download, scripts ---------- */
export async function copyText(text, done) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(area);
    area.select();
    try { document.execCommand("copy"); } catch (e2) { /* the text stays on screen to copy by hand */ }
    area.remove();
  }
  toast(done || t("Copied"));
}
export function download(name, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: type || "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
/* Vendor scripts are classic scripts, loaded the first time a pane needs them */
const scripts = {};
export function loadScript(src) {
  if (!scripts[src]) {
    scripts[src] = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => { delete scripts[src]; reject(new Error(t("Wally can’t be reached. Check your connection."))); };
      document.head.appendChild(s);
    });
  }
  return scripts[src];
}

/* The value of an input inside a dialog */
export function val(root, id) { const n = root.querySelector("#" + id); return n ? n.value.trim() : ""; }

/* Re-draw a pane without losing the keyboard's place: the focused control keeps focus
   when it has a data-k key, so toggles and arrows can be pressed again and again. */
export function paint(box, html) {
  const active = document.activeElement;
  const key = active && box.contains(active) ? (active.closest("[data-k]") || {}).dataset : null;
  const k = key && key.k;
  box.innerHTML = html;
  if (k) { const again = box.querySelector('[data-k="' + CSS.escape(k) + '"]'); if (again) again.focus(); }
}
/* Counts the sidebar of panes shows that no other page loads */
export const counts = { keys: null };
/* ui.js's seg(), with keys so the pressed button keeps focus when the pane is drawn again */
export function segK(id, items, value, label, cls) {
  return seg(id, items, value, label, cls).replace(/data-v="([^"]*)"/g, (m, v) => m + ' data-k="' + id + ":" + v + '"');
}
