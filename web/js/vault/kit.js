/* The household's Emergency Kit, as a PDF: one A4 page with the recovery key, its QR code, the
   Wally address, a box to write the household password in by hand, and how to use it.

   The page is drawn on a 300 dpi canvas with the browser's own text engine, so every language,
   right to left and CJK included, comes out as it does in the app; a PDF's built-in fonts could
   not. The PDF around it is written here, with no library: the page as one JPEG, and the recovery
   key again as invisible text over it, so it can be selected and copied from the file. */
import { t, esc, LANG } from "../core.js";

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
const INK = "#14161B", INK2 = "#4A4F5C", INK3 = "#7A7F8C", LINE = "#E1E4EA", ACCENT = "#4F5BD5";
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
  const M = 18, W = PAGE.w - 2 * M;
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
    const lines = wrap(s, maxW, size, o.weight);
    lines.forEach((l, i) => text(l, x, y + i * lh, o));
    return y + lines.length * lh;
  };
  const eyebrow = (s, x, y) => text(s.toLocaleUpperCase(LANG), x, y, { size: 7.5, weight: 650, color: INK3 });

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, PAGE.w, PAGE.h);

  // Header: a soft wash of the accent, the mark, the name, and what this is
  // Fades into the page instead of ending in an edge
  const g = ctx.createLinearGradient(0, 0, 0, 74);
  g.addColorStop(0, "#E9ECFF"); g.addColorStop(0.65, "#F4F5FF"); g.addColorStop(1, "#FFFFFF");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, PAGE.w, 74);
  const logo = await loadImage("/icons/icon-192.png");
  if (logo) {
    ctx.save(); roundRect(ctx, X(M, 12), 15, 12, 12, 3); ctx.clip();
    ctx.drawImage(logo, X(M, 12), 15, 12, 12); ctx.restore();
  }
  text("Wally", M + 15, 23.4, { size: 15, weight: 700 });
  text(t("Emergency Kit").toLocaleUpperCase(LANG), M, 20, { size: 8, weight: 700, color: ACCENT, end: true });
  const made = new Intl.DateTimeFormat(LANG, { day: "numeric", month: "long", year: "numeric" }).format(new Date());
  text(t("Made {date}", { date: made }), M, 25.4, { size: 8.5, color: INK2, end: true });
  text(t("Wally Emergency Kit"), M, 46, { size: 25, weight: 750 });
  para(t("This recovery key opens Wally if you forget the password or can’t get a two-step code. Whoever runs the server doesn’t have it."), M, 55, W, { size: 10.5, color: INK2 });

  // The Wally address
  let y = 80;
  eyebrow(t("Wally address"), M, y);
  ctx.fillStyle = "#F7F8FA"; roundRect(ctx, M, y + 3, W, 12, 2.6); ctx.fill();
  ctx.strokeStyle = LINE; ctx.lineWidth = 0.25; ctx.stroke();
  text(address, M + 4.5, y + 10.8, { size: 11.5, weight: 500, ltr: true });

  // The recovery key, with its QR code
  y = 104;
  eyebrow(t("Recovery key"), M, y);
  const boxH = 46;
  ctx.fillStyle = "#F0F2FF"; roundRect(ctx, M, y + 3, W, boxH, 3.2); ctx.fill();
  ctx.strokeStyle = "rgba(79,91,213,.35)"; ctx.lineWidth = 0.3; ctx.stroke();
  const groups = key.split("-"), qrSize = 36, qrX = rtl ? M + 5 : M + W - 5 - qrSize, qrY = y + 3 + (boxH - qrSize) / 2;
  const keyX = rtl ? M + qrSize + 14 : M + 7;
  const rows = [];
  font(15, 600, MONO);
  ctx.fillStyle = INK; ctx.direction = "ltr"; ctx.textAlign = "left";
  ROWS.forEach(([a, b], i) => {
    const line = groups.slice(a, b).join("  ");
    const by = y + 18 + i * 11.5;
    ctx.fillText(line, keyX, by);
    rows.push({ text: groups.slice(a, b).join("-"), shown: line, x: keyX, y: by, w: ctx.measureText(line).width, size: 15 });
  });
  const q = await qrModules(key);
  if (q) {
    ctx.fillStyle = "#fff"; roundRect(ctx, qrX, qrY, qrSize, qrSize, 2.4); ctx.fill();
    const n = q.getModuleCount(), pad = 2.4, cell = (qrSize - 2 * pad) / n;
    ctx.fillStyle = INK;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) ctx.fillRect(qrX + pad + c * cell, qrY + pad + r * cell, cell + 0.02, cell + 0.02);
  }

  // The household password, by hand
  y = 162;
  eyebrow(t("Household password"), M, y);
  text(t("Write it here by hand, if you like."), M, y, { size: 7.5, color: INK3, end: true });
  ctx.strokeStyle = "#C9CDD6"; ctx.lineWidth = 0.3;
  roundRect(ctx, M, y + 3, W, 13, 2.6); ctx.stroke();

  // How to use it
  y = 192;
  eyebrow(t("How to use it"), M, y);
  const steps = [
    t("On the sign-in page, choose Forgot password."),
    t("Type this key, or scan the code with your phone’s camera and paste it."),
    t("Choose a new household password. No two-step code is needed."),
  ];
  let sy = y + 9;
  steps.forEach((s, i) => {
    ctx.fillStyle = ACCENT;
    ctx.beginPath(); ctx.arc(X(M + 3, 0), sy - 1.3, 3, 0, Math.PI * 2); ctx.fill();
    font(8, 700); ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.direction = "ltr";
    ctx.fillText(String(i + 1), X(M + 3, 0), sy - 0.1);
    sy = para(s, M + 10, sy, W - 10, { size: 10.5, color: INK }) + 3.2;
  });

  // Keep it safe: anchored above the footer
  const safe = t("Keep it somewhere safe and offline, such as with your passport. Anyone with this key can open your Wally, even with two-step sign-in on. Making a new one in Settings › Sign-in stops this one working.");
  const safeLines = wrap(safe, W - 16, 9.5);
  const safeH = 12 + safeLines.length * 5;
  y = Math.max(sy + 6, 272 - safeH);
  ctx.fillStyle = "#FFF8E8"; roundRect(ctx, M, y, W, safeH, 3); ctx.fill();
  ctx.strokeStyle = "#F1D79A"; ctx.lineWidth = 0.3; ctx.stroke();
  text(t("Keep it safe"), M + 8, y + 7.4, { size: 10, weight: 700, color: "#7A4E00" });
  safeLines.forEach((l, i) => text(l, M + 8, y + 13 + i * 5, { size: 9.5, color: "#5C4100" }));

  // Footer
  ctx.strokeStyle = LINE; ctx.lineWidth = 0.25;
  ctx.beginPath(); ctx.moveTo(M, 280); ctx.lineTo(PAGE.w - M, 280); ctx.stroke();
  text("Wally · " + t("Emergency Kit"), M, 286, { size: 7.5, color: INK3 });
  text(address, M, 286, { size: 7.5, color: INK3, end: true, ltr: true });
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
    const size = 15 * 0.95, scale = (width / (chars * 0.6 * size)) * 100;
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

/* The Emergency Kit as a PDF file */
export async function kitPdf(key, address) {
  await document.fonts.ready;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(PAGE.w * PX);
  canvas.height = Math.round(PAGE.h * PX);
  const ctx = canvas.getContext("2d");
  ctx.scale(PX, PX);
  const rows = await drawKit(ctx, key, address || location.origin);
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
