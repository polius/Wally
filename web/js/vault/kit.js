/* The Emergency Kit: the recovery key on one printed page, with a QR code, and how to use it.
   Printed the way the month in review is (css/print.css): everything else is hidden while it prints. */
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
/* The key as a QR code, so a phone can read it instead of typing it */
export async function qrSvg(text, label) {
  const qr = await qrLib();
  if (!qr) return "";
  const q = qr(0, "M");
  q.addData(text.replace(/-/g, ""));
  q.make();
  const n = q.getModuleCount();
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += "M" + c + " " + r + "h1v1h-1z";
  return '<svg class="w-qr" viewBox="-2 -2 ' + (n + 4) + " " + (n + 4) + '" shape-rendering="crispEdges" role="img" aria-label="' + esc(label || t("QR code of your recovery key")) + '"><path fill="currentColor" d="' + d + '"/></svg>';
}
export function keyGroups(key) { return '<code class="w-kitkey" translate="no">' + key.split("-").map((g) => "<span>" + esc(g) + "</span>").join("") + "</code>"; }
export function kitText(name, key) {
  return t("Wally Emergency Kit for {name}", { name }) + "\n\n" + t("Recovery key") + ":\n" + key + "\n\n" +
    t("If you forget your password: on the sign-in page, choose Forgot password, then type this key. Then choose a new password.") + "\n" +
    t("Keep it somewhere safe and offline. Anyone with this key and your two-step code can open your Wally.") + "\n";
}

/* Print the kit, or save it as a PDF from the print dialog */
export async function printKit(name, key, address) {
  document.getElementById("w-print")?.remove();
  const root = document.createElement("div");
  root.id = "w-print";
  root.className = "pr";
  root.dir = document.documentElement.dir || "ltr";
  root.lang = document.documentElement.lang;
  const made = new Intl.DateTimeFormat(LANG, { day: "numeric", month: "long", year: "numeric" }).format(new Date());
  root.innerHTML = '<section class="pr-sheet pr-kit"><header class="pr-head"><span class="pr-brand"><img src="/icons/icon-192.png" alt="">Wally</span><span>' + esc(t("Made {date}", { date: made })) + "</span></header>" +
    '<div class="pr-body"><span class="pr-eye">' + esc(t("Emergency Kit")) + "</span>" +
    '<div class="pr-title"><h1>' + esc(t("Wally Emergency Kit for {name}", { name })) + "</h1><p>" + esc(t("Your recovery key opens Wally if you forget your password. Nobody else has it, not even whoever runs the server.")) + "</p></div>" +
    '<div class="pr-kitbox"><div><span class="pr-k">' + esc(t("Recovery key")) + "</span>" + keyGroups(key) + "</div>" + (await qrSvg(key)) + "</div>" +
    '<ol class="pr-kitsteps"><li>' + esc(t("On the sign-in page, choose Forgot password.")) + "</li><li>" + esc(t("Type this key, or scan the code with your phone’s camera and paste it.")) + "</li><li>" + esc(t("Enter your two-step code if Wally asks, then choose a new password.")) + "</li></ol>" +
    '<dl class="pr-kitfacts"><div><dt>' + esc(t("Wally address")) + "</dt><dd>" + esc(address || location.origin) + "</dd></div><div><dt>" + esc(t("Name")) + "</dt><dd>" + esc(name) + "</dd></div></dl>" +
    '<p class="pr-foot">' + esc(t("Keep it somewhere safe and offline, such as with your passport. Anyone with this key and your two-step code can open your Wally. Making a new one in Settings › Privacy stops this one working.")) + "</p></div>" +
    '<footer class="pr-pfoot"><span>' + esc(t("Emergency Kit")) + "</span><span></span></footer></section>";
  document.body.appendChild(root);
  await Promise.all([...root.querySelectorAll("img")].map((i) => i.decode().catch(() => {})));
  const before = document.title;
  document.title = t("Wally Emergency Kit for {name}", { name });
  const clean = () => { root.remove(); document.body.classList.remove("pr-on"); document.title = before; removeEventListener("afterprint", clean); };
  document.body.classList.add("pr-on");
  addEventListener("afterprint", clean);
  print();
}
