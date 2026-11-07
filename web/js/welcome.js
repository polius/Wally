/* Welcome to Wally 2.0: shown once to each person in a household upgraded from 1.x.
   The person who upgrades sees it full screen before "Who uses Wally?" (pages/signin.js); everyone
   else sees it over the app the first time they open 2.0 (app.js). It says what's new and that
   the data came across, checked one by one by api/upgrade.py. The full report
   stays in the data folder (upgrade-report-<date>.txt) until encryption is turned on. */
import { t, tn, icon, POST } from "./core.js";
import { trapFocus } from "./ui.js";

const SEEN = "wally.welcomed";

/* The card. One button, always in view; the middle scrolls on a short screen. */
export function welcomeCard(report) {
  const k = report.kept || {};
  const row = (ic, title, sub, i) =>
    '<li style="--i:' + i + '"><span class="w-welico">' + icon(ic) + "</span><span><b>" + title + "</b><small>" + sub + "</small></span></li>";
  return '<section class="w-wel" role="dialog" aria-modal="true" aria-labelledby="wel-h" tabindex="-1">' +
    '<div class="w-welbody">' +
      '<span class="w-mark w-welmark" aria-hidden="true"></span>' +
      '<h1 id="wel-h" class="w-welh">' + t("Welcome to {app}", { app: '<span class="w-welapp">Wally 2.0</span>' }) + "</h1>" +
      '<p class="w-welok">' + icon("check") + "<span>" + tn(k.transactions || 0, "{n} transaction came across, checked one by one.", "{n} transactions came across, checked one by one.") + "</span></p>" +
      '<ul class="w-welfeat">' +
        row("users", t("The whole household"), t("Each person has their own view, and shared costs are split between you."), 0) +
        row("repeat", t("Recurring, on its day"), t("Bills and salaries are added when they’re due, and Wally notices when a price goes up."), 1) +
        row("chart", t("Your month in review"), t("On the 1st: what you spent, what you earned and what you kept."), 2) +
        row("shield", t("Private if you want"), t("Encrypt everything on your devices, so even the server can’t read it."), 3) +
      "</ul>" +
    "</div>" +
    '<div class="w-welfoot"><button type="button" class="w-btn primary w-welgo" id="wel-go">' + t("Continue") + "</button></div></section>";
}

/* Enter continues from anywhere on the card, as its one button would */
export function wireCard(card) {
  card.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.target.closest("a,button")) { ev.preventDefault(); card.querySelector("#wel-go").click(); }
  });
}

/* Seen: by this person, or before anyone was added, by whoever upgraded on this browser */
export async function markSeen() {
  try { await POST("/upgrade/seen"); } catch (e) { /* shown again next time */ }
}
export function rememberHere() { try { localStorage.setItem(SEEN, "1"); } catch (e) { /* fine */ } }

/* Over the app, the first time someone opens 2.0. Whoever upgraded saw it on this browser already. */
export async function welcomeOnce(report) {
  let here = false;
  try { here = localStorage.getItem(SEEN) === "1"; localStorage.removeItem(SEEN); } catch (e) { /* fine */ }
  if (here) return markSeen();
  const back = document.activeElement;
  const wrap = document.createElement("div");
  wrap.className = "w-welwrap";
  wrap.innerHTML = welcomeCard(report);
  document.body.appendChild(wrap);
  const card = wrap.firstChild;
  wireCard(card);
  requestAnimationFrame(() => wrap.classList.add("on"));
  // The card takes focus, not the button, so it opens without a focus ring; Enter or Tab reach the button
  card.focus({ preventScroll: true });
  const close = () => {
    markSeen();
    wrap.classList.remove("on");
    document.removeEventListener("keydown", onKey, true);
    setTimeout(() => wrap.remove(), matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 240);
    if (back && document.contains(back)) back.focus();
  };
  const onKey = (ev) => {
    if (ev.key === "Escape") { ev.preventDefault(); close(); }
    else trapFocus(card, ev);
  };
  document.addEventListener("keydown", onKey, true);
  card.querySelector("#wel-go").addEventListener("click", close);
}
