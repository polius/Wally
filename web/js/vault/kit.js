/* The household's Emergency Kit, as a PDF: one A4 page in black and grey (it prints the same on any
   printer) with whose household it opens, the recovery key and its QR code, the Wally address when it
   works from other devices (a line to write it in otherwise), a line for the password, and how to use it.

   The page is drawn on a 300 dpi canvas with the browser's own text engine, so every language,
   right to left and CJK included, comes out as it does in the app; a PDF's built-in fonts could
   not. The PDF around it is written here, with no library: the page as one JPEG, and the recovery
   key again as invisible text over it, so it can be selected and copied from the file. */
import { t, esc, LANG, state } from "../core.js";

let qrLoad = null;
function qrLib() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  if (!qrLoad) {
    qrLoad = new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = "/js/vendors/qrcode.js";
      s.onload = () => resolve(window.qrcode || null);
      s.onerror = () => { qrLoad = null; resolve(null); };
      document.head.appendChild(s);
    });
  }
  return qrLoad;
}
async function qrModules(key) {
  const qr = await qrLib();
  if (!qr) return null;
  const q = qr(0, "M");
  q.addData(key.replace(/-/g, ""));
  q.make();
  return q;
}
/* The key as a QR code, so a phone can read it instead of typing it */
export async function qrSvg(text, label) {
  const q = await qrModules(text);
  if (!q) return "";
  const n = q.getModuleCount();
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += "M" + c + " " + r + "h1v1h-1z";
  return '<svg class="w-qr" viewBox="-2 -2 ' + (n + 4) + " " + (n + 4) + '" shape-rendering="crispEdges" role="img" aria-label="' + esc(label || t("QR code of your recovery key")) + '"><path fill="currentColor" d="' + d + '"/></svg>';
}
export function keyGroups(key) { return '<code class="w-kitkey" translate="no">' + key.split("-").map((g) => "<span>" + esc(g) + "</span>").join("") + "</code>"; }

/* ---------- the page ---------- */
const PX = 300 / 25.4;          // canvas pixels per millimetre, at 300 dpi
const PAGE = { w: 210, h: 297 };
const INK = "#111111", INK2 = "#444444", INK3 = "#6B6B6B", LINE = "#CCCCCC", RULE = "#999999";
const MONO = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';
// Key rows: 5, 5 and 3 groups of four
const ROWS = [[0, 5], [5, 10], [10, 13]];

function loadImage(src) {
  return new Promise((resolve) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => resolve(null); i.src = src; });
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/* Draws the kit in millimetres. Returns where each row of the key is, for the text layer. */
async function drawKit(ctx, key, address) {
  const rtl = document.documentElement.dir === "rtl";
  const sans = getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";
  const M = 16, W = PAGE.w - 2 * M;
  // In millimetres from the start edge: mirrored for right-to-left languages
  const X = (x, w = 0) => (rtl ? PAGE.w - x - w : x);
  const font = (size, weight = 400, family = sans) => { ctx.font = weight + " " + (size * 25.4 / 72) + "px " + family; };
  const text = (s, x, y, o = {}) => {
    font(o.size || 10, o.weight || 400, o.family);
    ctx.fillStyle = o.color || INK;
    ctx.direction = o.ltr ? "ltr" : rtl ? "rtl" : "ltr";
    ctx.textAlign = o.end ? (rtl ? "left" : "right") : (rtl ? "right" : "left");
    ctx.fillText(s, o.end ? (rtl ? x : PAGE.w - x) : X(x), y);
  };
  // Words to lines that fit, or characters where a language writes no spaces
  const wrap = (s, maxW, size, weight = 400) => {
    font(size, weight);
    const cjk = /^(ja|zh)/.test(LANG);
    const tokens = cjk ? [...s] : s.split(/(\s+)/);
    const lines = [];
    let line = "";
    for (const tok of tokens) {
      const next = line + tok;
      if (line && ctx.measureText(next.trim()).width > maxW) { lines.push(line.trim()); line = tok.trimStart(); }
      else line = next;
    }
    if (line.trim()) lines.push(line.trim());
    return lines;
  };
  const para = (s, x, y, maxW, o = {}) => {
    const size = o.size || 10, lh = o.lh || size * 0.53;
    const at = o.bold ? s.indexOf(o.bold) : -1;
    if (at >= 0 && !rtl && !/^(ja|zh)/.test(LANG)) return boldPara(s, at, at + o.bold.length, x, y, maxW, size, lh, o.color || INK);
    const lines = wrap(s, maxW, size, o.weight);
    lines.forEach((l, i) => text(l, x, y + i * lh, o));
    return y + lines.length * lh;
  };
  // A paragraph with one part in bold (the household's names, the link to choose): word by word
  const boldPara = (s, from, to, x, y, maxW, size, lh, color) => {
    const words = [];
    let i = 0;
    for (const tok of s.split(/(\s+)/)) {
      // A word that is partly bold (the names, then a full stop) is split where the bold ends
      for (const [a, b] of [[i, Math.min(i + tok.length, Math.max(from, i))], [Math.max(from, i), Math.min(to, i + tok.length)], [Math.max(to, i), i + tok.length]]) {
        if (b > a) words.push({ s: s.slice(a, b), w: a >= from && b <= to ? 700 : 400 });
      }
      i += tok.length;
    }
    const width = (wd) => { font(size, wd.w); return ctx.measureText(wd.s).width; };
    const lines = [[]];
    let lw = 0;
    for (const wd of words) {
      const space = /^\s+$/.test(wd.s), ww = width(wd);
      if (!space && lw + ww > maxW && lines[lines.length - 1].some((q) => !/^\s+$/.test(q.s))) { lines.push([]); lw = 0; }
      if (space && !lines[lines.length - 1].length) continue;
      lines[lines.length - 1].push(wd); lw += ww;
    }
    ctx.fillStyle = color; ctx.direction = "ltr"; ctx.textAlign = "left";
    lines.forEach((l, n) => { let cx = x; l.forEach((wd) => { font(size, wd.w); ctx.fillText(wd.s, cx, y + n * lh); cx += ctx.measureText(wd.s).width; }); });
    return y + lines.length * lh;
  };
  const eyebrow = (s, x, y) => text(s.toLocaleUpperCase(LANG), x, y, { size: 7.5, weight: 650, color: INK3 });

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, PAGE.w, PAGE.h);
  // Large, calm type that fills the page: it is read on paper, in a drawer, years from now
  const label = (s, y) => { ctx.letterSpacing = "0.3px"; text(s.toLocaleUpperCase(LANG), M, y, { size: 14.2, weight: 600, color: INK3 }); ctx.letterSpacing = "0px"; };

  // Header: the mark in grey, the name, and the day it was made
  const logo = await loadImage("/icons/icon-192.png");
  if (logo) {
    ctx.save(); roundRect(ctx, X(M, 11), 14.5, 11, 11, 2.6); ctx.clip();
    ctx.filter = "grayscale(1)";
    ctx.drawImage(logo, X(M, 11), 14.5, 11, 11); ctx.restore();
    ctx.filter = "none";
  }
  text("Wally", M + 14, 22.4, { size: 17, weight: 700 });
  const made = new Intl.DateTimeFormat(LANG, { day: "numeric", month: "long", year: "numeric" }).format(new Date());
  text(t("Made {date}", { date: made }), M, 22.4, { size: 15, color: INK3, end: true });

  // The title once, and whose household it opens
  ctx.letterSpacing = "-0.24px";
  text(t("Emergency Kit"), M, 48.1, { size: 34, weight: 700 });
  ctx.letterSpacing = "0px";
  const names = (state.people || []).map((p) => p.name).filter(Boolean);
  const listed = names.length ? new Intl.ListFormat(LANG, { type: "conjunction" }).format(names) : "";
  const whose = names.length
    ? t("For the household of {names}. Keep it with your passport: it opens Wally if the password is forgotten.", { names: listed })
    : t("Keep it with your passport: it opens Wally if the password is forgotten.");
  let y = para(whose, M, 62.4, W, { size: 17, lh: 8.7, color: INK2, bold: listed });

  // The recovery key, with its QR code, in a black outline
  y = Math.max(y + 10, 89.5);
  label(t("Recovery key"), y);
  const boxH = 52.4, boxY = y + 5.2;
  ctx.strokeStyle = INK; ctx.lineWidth = 0.75; roundRect(ctx, M, boxY, W, boxH, 5); ctx.stroke();
  const groups = key.split("-"), qrSize = 39, qrX = rtl ? M + 7.7 : M + W - 7.7 - qrSize, qrY = boxY + (boxH - qrSize) / 2;
  const keyX = rtl ? M + qrSize + 15.4 : M + 7.7;
  const rows = [];
  font(17.5, 700, MONO);
  ctx.fillStyle = INK; ctx.direction = "ltr"; ctx.textAlign = "left";
  ROWS.forEach(([a, b], i) => {
    const line = groups.slice(a, b).join("  ");
    const by = boxY + 16.7 + i * 11.25;
    ctx.fillText(line, keyX, by);
    rows.push({ text: groups.slice(a, b).join("-"), shown: line, x: keyX, y: by, w: ctx.measureText(line).width, size: 17.5 });
  });
  const q = await qrModules(key);
  if (q) {
    ctx.strokeStyle = INK; ctx.lineWidth = 0.75; ctx.strokeRect(qrX, qrY, qrSize, qrSize);
    const n = q.getModuleCount(), pad = 2.4, cell = (qrSize - 2 * pad) / n;
    ctx.fillStyle = INK;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) ctx.fillRect(qrX + pad + c * cell, qrY + pad + r * cell, cell + 0.02, cell + 0.02);
  }

  // Lines to read or write on: the value on the line, or a grey hint where it goes
  const line = (name, value, hint, at) => {
    label(name, at);
    if (value) {
      text(value, M, at + 12.5, { size: 17, weight: 500, ltr: true });
      text(hint, M, at + 12.5, { size: 14.2, color: "#999999", end: true });
    } else text(hint, M, at + 13, { size: 14.2, color: "#999999" });
    ctx.strokeStyle = RULE; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(M, at + 17.9); ctx.lineTo(PAGE.w - M, at + 17.9); ctx.stroke();
  };
  y = boxY + boxH + 12;
  // The address only when it works from another device: made on the server itself, it would print localhost
  line(t("Wally address"), address || "", address ? t("or write it here") : t("Write it here"), y);
  y += 29.9;
  line(t("Household password"), "", t("Write it here by hand, if you like"), y);

  // How to use it
  y += 29.8;
  label(t("If you forget the password"), y);
  const steps = [
    t("On the sign-in page, choose Forgot password?"),
    t("Type this key, or scan the code and paste it."),
    t("Choose a new household password."),
  ];
  let sy = y + 12.4;
  // "Forgot password?" in bold, as it reads on the sign-in page
  const link = t("Forgot password?");
  steps.forEach((st, i) => {
    // The number ends where a list's marker would, a space before the step
    font(17); ctx.fillStyle = "#222222"; ctx.direction = rtl ? "rtl" : "ltr"; ctx.textAlign = rtl ? "left" : "right";
    ctx.fillText((i + 1) + ".", X(M + 7.4), sy);
    sy = para(st, M + 9, sy, W - 9, { size: 17, lh: 8.7, color: "#222222", bold: i === 0 ? link : "" });
  });

  // Keep it safe: at the foot of the page, under a thin rule
  const safe = t("Anyone with this key can open your Wally, even with two-step sign-in on. Making a new kit in Settings › Sign-in & Privacy stops this one working.");
  const safeLines = wrap(safe, W, 14.9);
  const top = Math.max(sy + 8, 281 - (safeLines.length - 1) * 7.6);
  ctx.strokeStyle = LINE; ctx.lineWidth = 0.35;
  ctx.beginPath(); ctx.moveTo(M, top - 7.5); ctx.lineTo(PAGE.w - M, top - 7.5); ctx.stroke();
  safeLines.forEach((l, i) => text(l, M, top + i * 7.6, { size: 14.9, color: INK2 }));
  return rows;
}

/* ---------- the PDF around it ---------- */
const enc = new TextEncoder();
const ascii = (s) => s.replace(/[^\x20-\x7E]/g, "?");
function pdfString(s) { return "(" + ascii(s).replace(/[\\()]/g, (c) => "\\" + c) + ")"; }

function buildPdf(jpeg, wPx, hPx, rows) {
  const W = 595.28, H = 841.89, pt = W / PAGE.w;
  // The key again as text: invisible (render mode 3), in Courier, stretched to sit where it's drawn
  let layer = "";
  for (const r of rows) {
    const chars = r.shown.length, width = r.w * pt;
    const size = r.size * 0.95, scale = (width / (chars * 0.6 * size)) * 100;
    layer += "BT 3 Tr /F1 " + size.toFixed(2) + " Tf " + scale.toFixed(2) + " Tz " + (r.x * pt).toFixed(2) + " " + (H - r.y * pt).toFixed(2) + " Td " + pdfString(r.shown) + " Tj ET\n";
  }
  const content = "q " + W + " 0 0 " + H + " 0 0 cm /Im1 Do Q\n" + layer;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + W + " " + H + "] /Resources << /XObject << /Im1 4 0 R >> /Font << /F1 6 0 R >> >> /Contents 5 0 R >>",
    null, // the image, binary
    "<< /Length " + enc.encode(content).length + " >>\nstream\n" + content + "\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
    "<< /Title " + pdfString("Wally Emergency Kit") + " /Creator (Wally) >>",
  ];
  const parts = [], offsets = [];
  let length = 0;
  const push = (x) => { const b = typeof x === "string" ? enc.encode(x) : x; parts.push(b); length += b.length; };
  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  objs.forEach((o, i) => {
    offsets.push(length);
    push((i + 1) + " 0 obj\n");
    if (o === null) {
      push("<< /Type /XObject /Subtype /Image /Width " + wPx + " /Height " + hPx + " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + jpeg.length + " >>\nstream\n");
      push(jpeg);
      push("\nendstream");
    } else push(o);
    push("\nendobj\n");
  });
  const xref = length;
  push("xref\n0 " + (objs.length + 1) + "\n0000000000 65535 f \n" + offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join(""));
  push("trailer\n<< /Size " + (objs.length + 1) + " /Root 1 0 R /Info 7 0 R >>\nstartxref\n" + xref + "\n%%EOF\n");
  return new Blob(parts, { type: "application/pdf" });
}

/* This page's address, unless it only works on the server itself (localhost, 127.x, ::1) */
function reachable() {
  const h = location.hostname;
  return /^(localhost|127\.|0\.0\.0\.0$|\[?::1\]?$)/i.test(h) || h.endsWith(".localhost") ? "" : location.origin;
}
/* The Emergency Kit as a PDF file */
export async function kitPdf(key, address) {
  await document.fonts.ready;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(PAGE.w * PX);
  canvas.height = Math.round(PAGE.h * PX);
  const ctx = canvas.getContext("2d");
  ctx.scale(PX, PX);
  const rows = await drawKit(ctx, key, address === undefined ? reachable() : address);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.93));
  const jpeg = new Uint8Array(await blob.arrayBuffer());
  return buildPdf(jpeg, canvas.width, canvas.height, rows);
}
export async function downloadKitPdf(key) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(await kitPdf(key));
  a.download = "wally-emergency-kit.pdf";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
