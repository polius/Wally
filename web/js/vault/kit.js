/* The household's Emergency Kit, as a PDF: one A4 page in Wally's colors (its tints print as light grey
   in black and white) with whose household it opens, the recovery key and its QR code, the Wally address when it
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
// Wally's own colors, light mode. The tints print as light grey on a black and white printer; the key and its
// QR code stay near black, so they read and scan either way.
const C = {
  ink: "#1C1C1E", ink2: "#48484A", ink3: "#8E8E93", hint: "#AEAEB2", sep: "#D8D8DD",
  accent: "#4F5BD5", accentInk: "#3D47B5", tint: "#EEF0FD", group: "#F2F2F7", warnBg: "#FFF4E2", warn: "#B4600A",
};
const MONO = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';
// Key rows: three even rows of four groups (a kit from before 2.0 shipped has 13 groups: 5, 5 and 3)
const rowsOf = (n) => (n === 12 ? [[0, 4], [4, 8], [8, 12]] : [[0, 5], [5, 10], [10, n]]);

function loadImage(src) {
  return new Promise((resolve) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => resolve(null); i.src = src; });
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/* Draws the kit in millimetres, its type at scale s (smaller when a language runs long).
   extra is spare room added between the sections, so a short language still fills the page evenly.
   Returns where each row of the key is, for the text layer, whether the page held it all, and the room left. */
async function drawKit(ctx, key, address, s, logo, extra = 0) {
  const rtl = document.documentElement.dir === "rtl";
  const cjk = /^(ja|zh|ko)/.test(LANG);
  const sans = getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";
  const M = 18, W = PAGE.w - 2 * M, BOTTOM = PAGE.h - 16;
  const mm = (pt) => pt * s * 25.4 / 72;                       // a type size in points, as millimetres
  // Type is set at its printed size in CSS pixels (96 to the inch) and placed in millimetres, so the system font
  // picks the design it uses at that size on screen: text for the body, display for the title. Set at a few
  // "pixels" (millimetres), it would pick its loosely spaced caption design.
  const CSS = 96 / 25.4;
  const font = (size, weight = 400, family = sans) => { ctx.font = weight + " " + (mm(size) * CSS) + "px " + family; };
  const measure = (str) => ctx.measureText(str).width / CSS;
  const put = (str, x, y) => { ctx.save(); ctx.scale(1 / CSS, 1 / CSS); ctx.fillText(str, x * CSS, y * CSS); ctx.restore(); };
  // x is measured from the start edge (the right one in right-to-left languages); a box of width w is mirrored whole
  const bx = (x, w = 0) => (rtl ? PAGE.w - x - w : x);
  const text = (str, x, y, o = {}) => {
    font(o.size || 12, o.weight || 400, o.family);
    ctx.fillStyle = o.color || C.ink;
    ctx.direction = o.ltr ? "ltr" : rtl ? "rtl" : "ltr";
    ctx.textAlign = o.center ? "center" : o.end ? (rtl ? "left" : "right") : (rtl ? "right" : "left");
    put(str, o.center ? x : bx(x), y);
  };
  // Words to lines that fit, or characters where a language writes no spaces
  const wrap = (str, maxW, size, weight = 400) => {
    font(size, weight);
    const tokens = cjk ? [...str] : str.split(/(\s+)/);
    const lines = [];
    let line = "";
    for (const tok of tokens) {
      const next = line + tok;
      if (line && measure(next.trim()) > maxW) { lines.push(line.trim()); line = tok.trimStart(); }
      else line = next;
    }
    if (line.trim()) lines.push(line.trim());
    return lines;
  };
  const lead = (size) => mm(size) * 1.42;
  // A paragraph; one part of it may be bold (the household's names, the link to choose)
  const para = (str, x, y, maxW, o = {}) => {
    const size = o.size || 12, lh = lead(size);
    const at = o.bold ? str.indexOf(o.bold) : -1;
    if (at >= 0 && !rtl && !cjk) return boldPara(str, at, at + o.bold.length, x, y, maxW, size, lh, o.color || C.ink, o.boldColor || C.ink);
    const lines = wrap(str, maxW, size, o.weight);
    lines.forEach((l, i) => text(l, x, y + i * lh, o));
    return y + (lines.length - 1) * lh;
  };
  const boldPara = (str, from, to, x, y, maxW, size, lh, color, boldColor) => {
    const words = [];
    let i = 0;
    for (const tok of str.split(/(\s+)/)) {
      // A word that is partly bold (the names, then a full stop) is split where the bold ends
      for (const [a, b] of [[i, Math.min(i + tok.length, Math.max(from, i))], [Math.max(from, i), Math.min(to, i + tok.length)], [Math.max(to, i), i + tok.length]]) {
        if (b > a) words.push({ s: str.slice(a, b), b: a >= from && b <= to });
      }
      i += tok.length;
    }
    const width = (wd) => { font(size, wd.b ? 650 : 400); return measure(wd.s); };
    const lines = [[]];
    let lw = 0;
    for (const wd of words) {
      const space = /^\s+$/.test(wd.s), ww = width(wd);
      if (!space && lw + ww > maxW && lines[lines.length - 1].some((q) => !/^\s+$/.test(q.s))) { lines.push([]); lw = 0; }
      if (space && !lines[lines.length - 1].length) continue;
      lines[lines.length - 1].push(wd); lw += ww;
    }
    ctx.direction = "ltr"; ctx.textAlign = "left";
    lines.forEach((l, n) => { let cx = x; l.forEach((wd) => { font(size, wd.b ? 650 : 400); ctx.fillStyle = wd.b ? boldColor : color; put(wd.s, cx, y + n * lh); cx += measure(wd.s); }); });
    return y + (lines.length - 1) * lh;
  };
  // A section's name, small and grey, inset like the app's group labels
  const label = (str, y) => text(str, M + 4, y, { size: 10.5, weight: 600, color: C.ink3 });
  const fill = (color, x, y, w, h, r) => { ctx.fillStyle = color; roundRect(ctx, bx(x, w), y, w, h, r); ctx.fill(); };

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, PAGE.w, PAGE.h);

  // Header: the wallet in color, the name, and the day it was made
  let y = 16;
  if (logo) ctx.drawImage(logo, bx(M, 9), y, 9, 9);
  text("Wally", M + 11.5, y + 6.4, { size: 14, weight: 650 });
  const made = new Intl.DateTimeFormat(LANG, { day: "numeric", month: "long", year: "numeric" }).format(new Date());
  text(t("Made {date}", { date: made }), M + W, y + 6.4, { size: 10.5, color: C.ink3, end: true });

  // The title, and whose household it opens
  y += 9 + 8 + mm(30) * 0.8;
  text(t("Emergency Kit"), M, y, { size: 30, weight: 700 });
  const names = (state.people || []).map((p) => p.name).filter(Boolean);
  const listed = names.length ? new Intl.ListFormat(LANG, { type: "conjunction" }).format(names) : "";
  const whose = names.length
    ? t("For the household of {names}. Keep it with your passport: it opens Wally if the password is forgotten.", { names: listed })
    : t("Keep it with your passport: it opens Wally if the password is forgotten.");
  y = para(whose, M, y + 6 + mm(13) * 1.1, W - 10, { size: 13, color: C.ink2, bold: listed });

  // The recovery key and its QR code, on the accent's tint
  y += 13 + extra;
  label(t("Recovery key"), y);
  const pad = 8, qrSize = 36 * Math.min(1.1, s), groups = key.split("-");
  // The key as large as it goes, keeping a clear gap before the code
  const ROWS = rowsOf(groups.length);
  let keySize = 18;
  font(keySize, 600, MONO);
  const widest = Math.max(...ROWS.map(([a, b]) => measure(groups.slice(a, b).join("  "))));
  keySize *= Math.min(1, (W - qrSize - 5 - pad - 10) / widest);
  const keyLh = mm(keySize) * 1.75;
  const boxY = y + 3.2, boxH = Math.max(qrSize + 2 * 5, 3 * keyLh + 2 * pad);
  fill(C.tint, M, boxY, W, boxH, 4.5);
  const rows = [];
  // Physical positions: the code sits at the end of the card, the key at its start
  const qrX = rtl ? M + 5 : M + W - 5 - qrSize, qrY = boxY + (boxH - qrSize) / 2;
  const keyX = rtl ? M + 5 + qrSize + pad : M + pad;
  font(keySize, 600, MONO);
  ctx.fillStyle = C.ink; ctx.direction = "ltr"; ctx.textAlign = "left";
  const firstLine = boxY + (boxH - 3 * keyLh) / 2 + keyLh * 0.68;
  ROWS.forEach(([a, b], i) => {
    const line = groups.slice(a, b).join("  ");
    const by = firstLine + i * keyLh;
    put(line, keyX, by);
    rows.push({ text: groups.slice(a, b).join("-"), shown: line, x: keyX, y: by, w: measure(line), size: keySize * s });
  });
  const q = await qrModules(key);
  if (q) {
    ctx.fillStyle = "#fff"; roundRect(ctx, qrX, qrY, qrSize, qrSize, 2.6); ctx.fill();
    const n = q.getModuleCount(), qp = 2.6, cell = (qrSize - 2 * qp) / n;
    ctx.fillStyle = C.ink;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) ctx.fillRect(qrX + qp + c * cell, qrY + qp + r * cell, cell + 0.02, cell + 0.02);
  }
  y = boxY + boxH;

  // The address and the password: two rows, as in Settings, with room to write on
  y += 11 + extra;
  const fields = [
    // The address only when it works from another device: made on the server itself, it would print localhost
    { k: t("Wally address"), v: address || "", hint: address ? "" : t("Write it here") },
    { k: t("Household password"), v: "", hint: t("Write it here by hand, if you like") },
  ];
  const rowH = 16 * Math.max(s, 0.9), fy = y;
  fill(C.group, M, fy, W, rowH * fields.length, 4.5);
  fields.forEach((f, i) => {
    const mid = fy + i * rowH + rowH / 2 + mm(12.5) * 0.34;
    text(f.k, M + 6, mid, { size: 12.5, weight: 500 });
    if (f.v) text(f.v, M + W - 6, mid, { size: 12.5, color: C.ink2, end: true, ltr: true });
    else text(f.hint, M + W - 6, mid, { size: 11, color: C.hint, end: true });
    if (i) { ctx.fillStyle = C.sep; ctx.fillRect(bx(M + 6, W - 6), fy + i * rowH - 0.12, W - 6, 0.24); }
  });
  y = fy + rowH * fields.length;

  // How to use it: numbered steps, each number in an accent circle
  y += 13 + extra;
  label(t("If you forget the password"), y);
  const steps = [
    t("On the sign-in page, choose Forgot password?"),
    t("Type this key, or scan the code and paste it."),
    t("Choose a new household password."),
  ];
  const link = t("Forgot password?");
  // The circles line up with the section's name above them, as the steps aren't in a card
  const r0 = 3.3, cx0 = M + 4 + r0, tx = cx0 + r0 + 4;
  y += 4;
  steps.forEach((st, i) => {
    const base = y + 3 + mm(13) * 0.75;
    const cy = base - mm(13) * 0.36;
    ctx.fillStyle = C.accent; ctx.beginPath(); ctx.arc(bx(cx0), cy, r0, 0, Math.PI * 2); ctx.fill();
    font(10.5, 700); ctx.fillStyle = "#fff"; ctx.direction = "ltr"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    put(String(i + 1), bx(cx0), cy + 0.15);
    ctx.textBaseline = "alphabetic";
    y = para(st, tx, base, W - (tx - M), { size: 13, color: C.ink, bold: i === 0 ? link : "", boldColor: C.accentInk }) + mm(13) * 0.45;
  });

  // Keep it safe: a calm warning at the foot of the page
  const safe = t("Anyone with this key can open your Wally, even with two-step sign-in on. Making a new kit in Settings › Sign-in & Privacy stops this one working.");
  const wp = 6, icon = 5.2, wtx = M + wp + icon + 4;
  const safeLines = wrap(safe, W - (wtx - M) - wp, 11);
  const wlh = lead(11), wh = 2 * wp + (safeLines.length - 1) * wlh + mm(11) * 0.9;
  const top = Math.max(y + 12 + extra, BOTTOM - wh);
  fill(C.warnBg, M, top, W, wh, 4.5);
  // A rounded warning triangle, with its mark
  const ix = bx(M + wp, icon), iy = top + wp + 0.1;
  ctx.fillStyle = C.warn; ctx.strokeStyle = C.warn; ctx.lineWidth = 0.9; ctx.lineJoin = "round";
  ctx.beginPath(); ctx.moveTo(ix + icon / 2, iy); ctx.lineTo(ix + icon, iy + icon * 0.88); ctx.lineTo(ix, iy + icon * 0.88); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = C.warnBg; ctx.fillRect(ix + icon / 2 - 0.3, iy + icon * 0.3, 0.6, icon * 0.3);
  ctx.beginPath(); ctx.arc(ix + icon / 2, iy + icon * 0.72, 0.35, 0, Math.PI * 2); ctx.fill();
  safeLines.forEach((l, i) => text(l, wtx, top + wp + mm(11) * 0.78 + i * wlh, { size: 11, color: C.ink2 }));
  return { rows, fits: top + wh <= BOTTOM + 0.01, slack: BOTTOM - wh - (y + 12 + extra) };
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
  const logo = await loadImage("/icons/wally.svg");
  // Smaller type, a step at a time, until the longest language fits the page
  const addr = address === undefined ? reachable() : address;
  let drawn, scale;
  for (scale of [1.2, 1.15, 1.1, 1.05, 1, 0.95, 0.9, 0.85, 0.8, 0.75]) {
    drawn = await drawKit(ctx, key, addr, scale, logo);
    if (drawn.fits) break;
  }
  // Room to spare is shared between the four gaps, up to a point; the rest stays under the warning
  if (drawn.slack > 1) drawn = await drawKit(ctx, key, addr, scale, logo, Math.min(drawn.slack / 4, 9));
  const rows = drawn.rows;
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
