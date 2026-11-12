// signals-parts.js — the small pieces every Signals screen is drawn from.
//
// One look per kind of information (docs/specs/2026-11-12-signals-redesign.md, section 1):
//   1 context · 2 title · 3 when it happened · 4 when it changed · 5 status · 6 confidence ·
//   7 recurrence · 8 source of a claim · 9 measure · 10 reference · 11 things you can do.
// What each piece SAYS is worked out in signalsFormat.js (tested); this file only draws it.
// The styles are in styles.css under "Signals: information styles".
//
// Text from the model or the records is always set as plain text (textContent), never as HTML.
// The only HTML used here is our own icons (icons.js).

import { icons } from "./icons.js";
import { whenText, updatedText, confidenceBars, occasionDots, statusLabel, trustKind } from "./signalsFormat.js";

/** An element with a class and plain text. */
export function el(tag, className = "", content = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== "") node.textContent = content;
  return node;
}

function icon(name, size = 13) {
  const span = el("span", "meta-icon");
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = icons[name](size); // our own SVG, never text from a record or the model
  return span;
}

/** 1. Context: small capitals above the title, the site with a pin. "HEALTHCARE · ⌖ SYNTHETIC UCC A". */
export function contextLine(domain, location) {
  const line = el("div", "meta-context");
  if (domain) line.append(el("span", "", domain));
  if (domain && location) line.append(el("span", "meta-sep"));
  if (location) {
    const site = el("span", "meta-site");
    site.append(icon("mapPin", 13), el("span", "", location));
    line.append(site);
  }
  return line;
}

/** 2. Title: the only large text in a card. */
export const titleLine = (title, tag = "h2") => el(tag, "meta-title", title);

/** 3. When it happened: a blue tag with a calendar, in plain words ("Sep 20, 3 to 6 pm"). */
export function whenTag(when, now = new Date()) {
  const words = whenText(when, now);
  const tag = el("span", "meta-when");
  if (!words) return tag;
  tag.append(icon("calendar", 13), el("span", "", words));
  return tag;
}

/** 4. When it changed: small grey text with a clock ("Updated 2 hours ago"). */
export function updatedNote(iso, now = new Date()) {
  const note = el("span", "meta-updated");
  note.append(icon("clock", 13), el("span", "", updatedText(iso, now)));
  const then = new Date(iso);
  if (!Number.isNaN(then.getTime())) note.title = then.toLocaleString();
  return note;
}

/** 5. Status: a filled pill, first in its row. */
export function statusPill(status) {
  return el("span", `status-pill status-${String(status).toLowerCase().replace(/[^a-z]+/g, "-")}`, statusLabel(status));
}

/** 6. Confidence: three bars plus the word, never colour alone. */
export function confidenceMeter(confidence) {
  const meter = el("span", "meta-confidence");
  const bars = el("span", "meta-bars");
  bars.setAttribute("aria-hidden", "true");
  for (const filled of confidenceBars(confidence)) bars.append(el("span", `meta-bar${filled ? " is-filled" : ""}`));
  meter.append(bars, el("span", "", confidence));
  meter.setAttribute("aria-label", `Pattern confidence: ${confidence}`);
  return meter;
}

/** 7. Recurrence: one dot per occasion (counted by code), beside confidence. */
export function occasionMarks(occasions) {
  const { dots, more, text } = occasionDots(occasions);
  const marks = el("span", "meta-occasions");
  const row = el("span", "meta-dots");
  row.setAttribute("aria-hidden", "true");
  for (let i = 0; i < dots; i++) row.append(el("span", "meta-dot"));
  if (more) row.append(el("span", "meta-dots-more", `+${more}`));
  marks.append(row, el("span", "", text));
  return marks;
}

/** 8. Source of a claim: copper = records, teal = policy, purple dashed = suggested, amber = staff input. */
export function trustTag(label) {
  const kind = trustKind(label);
  const tag = el("span", `tag ${kind.className}${kind.dashed ? " is-dashed" : ""}`, kind.label);
  tag.title = kind.means;
  return tag;
}

/** 9. Measure: big number, grey unit, and what it is compared with underneath. */
export function measure(value, unit, under = "") {
  const box = el("div", "meta-measure");
  const top = el("div", "meta-measure-top");
  top.append(el("span", "meta-measure-value", String(value)), el("span", "meta-measure-unit", unit));
  box.append(top);
  if (under) box.append(el("div", "meta-measure-under", under));
  return box;
}

/** 10. Reference (record IDs, Thread IDs): grey monospace, always last. For checking, not reading. */
export const reference = (text) => el("span", "meta-ref", text);

/**
 * 11. Things you can do: a raised button. `primary` (blue fill) is for the one main action;
 * information is never drawn as a button.
 */
export function actionButton(label, { primary = false, disabled = false, onClick } = {}) {
  const b = el("button", `signals-button${primary ? " is-primary" : ""}`, label);
  b.type = "button";
  b.disabled = disabled;
  if (onClick) b.onclick = onClick;
  return b;
}
