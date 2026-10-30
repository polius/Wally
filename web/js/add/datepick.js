/* The date as a month to pick a day from, in the sheet's own look rather than the browser's date picker.
   Days after `max` cannot be picked. The keys a date picker should have move the focus: arrows by a day
   or a week, Page Up/Down by a month, Home/End to the week's ends. */
import { t, esc, icon, ds, dim, ym, ymAdd, addD, wkOff, dows, monthYear, dlabL, TODAY } from "../core.js";

/* view: [year, month] shown; sel: the day picked; focus: the day that takes the Tab */
export function calHtml(view, sel, focus, max) {
  const [y, m] = view, first = ds(y, m, 1), last = ds(y, m, dim(y, m));
  const nav = (k, label, on) => '<button type="button" class="w-x" data-cm="' + k + '" aria-label="' + esc(label) + '"' + (on ? "" : " disabled") + ">" + icon(k < 0 ? "left" : "right") + "</button>";
  let h = '<div class="w-dcalh"><b aria-live="polite">' + esc(monthYear(y, m)) + "</b>" + nav(-1, t("Previous month"), true) + nav(1, t("Next month"), !max || last < max) + "</div>" +
    '<div class="w-dcalg">' + dows(true).map((d) => '<span class="dow" aria-hidden="true">' + esc(d) + "</span>").join("");
  for (let i = 0; i < wkOff(first); i++) h += "<span></span>";
  for (let d = 1; d <= dim(y, m); d++) {
    const s = ds(y, m, d);
    h += '<button type="button" data-cd="' + s + '" tabindex="' + (s === focus ? 0 : -1) + '" aria-label="' + esc(dlabL(s)) + '" aria-pressed="' + (s === sel) + '"' +
      (s === TODAY ? ' aria-current="date"' : "") + (max && s > max ? " disabled" : "") + ">" + d + "</button>";
  }
  return h + "</div>";
}

/* The day a key moves the focus to, or null for other keys */
export function calKey(key, day, rtl) {
  const side = rtl ? -1 : 1;
  const step = { ArrowLeft: -side, ArrowRight: side, ArrowUp: -7, ArrowDown: 7 }[key];
  if (step) return addD(day, step);
  if (key === "Home") return addD(day, -wkOff(day));
  if (key === "End") return addD(day, 6 - wkOff(day));
  if (key === "PageUp" || key === "PageDown") return monthStep(day, key === "PageUp" ? -1 : 1);
  return null;
}
/* The same day k months away, or that month's last day */
export function monthStep(day, k) {
  const [y, m] = ym(day), q = ymAdd(y, m, k);
  return ds(q[0], q[1], Math.min(+day.slice(8), dim(q[0], q[1])));
}
