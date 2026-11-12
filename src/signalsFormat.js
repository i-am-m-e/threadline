// signalsFormat.js — the plain words and small figures the Signals screens show.
//
// One look per kind of information (docs/specs/2026-11-12-signals-redesign.md, section 1).
// This file works out WHAT is shown: "Sep 20, 3 to 6 pm", "Updated 2 hours ago", how many
// confidence bars and occasion dots. signals-parts.js draws it. Everything here is plain code
// from the Thread and its records: no AI, and nothing taken from the model's wording.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

// A record's time, "2026-09-20T15:30" or "2026-09-20", read as it is written (local time).
function parts(stamp) {
  const m = typeof stamp === "string" && stamp.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) return null;
  const [, year, month, day, hour, minute] = m;
  return { year: Number(year), month: Number(month), day: Number(day), hour: hour === undefined ? null : Number(hour), minute: Number(minute ?? 0) };
}

const dayText = (p, now) => `${MONTHS[p.month - 1]} ${p.day}${p.year === now.getFullYear() ? "" : `, ${p.year}`}`;
const half = (p) => (p.hour < 12 ? "am" : "pm");
const clock = (p) => `${p.hour % 12 || 12}${p.minute ? `:${String(p.minute).padStart(2, "0")}` : ""}`;

/**
 * When something happened, in plain words: "Sep 20, 3 to 6 pm" for a time window
 * ({ start, end }), or "Sep 20, 3:30 pm" for one record's time. Never an ISO timestamp.
 * The year is added only when it isn't the current one. Returns "" if it isn't a time.
 * @param {{start: string, end: string}|string} when
 */
export function whenText(when, now = new Date()) {
  const start = parts(typeof when === "string" ? when : when?.start);
  const end = parts(typeof when === "string" ? when : when?.end);
  if (!start || !end) return "";
  if (start.hour === null) return dayText(start, now);
  const sameDay = start.year === end.year && start.month === end.month && start.day === end.day;
  if (!sameDay) return `${dayText(start, now)}, ${clock(start)} ${half(start)} to ${dayText(end, now)}, ${clock(end)} ${half(end)}`;
  if (start.hour === end.hour && start.minute === end.minute) return `${dayText(start, now)}, ${clock(start)} ${half(start)}`;
  const from = half(start) === half(end) ? clock(start) : `${clock(start)} ${half(start)}`;
  return `${dayText(start, now)}, ${from} to ${clock(end)} ${half(end)}`;
}

/**
 * When the Thread last changed in the app: "Updated 2 hours ago". Minutes and hours for
 * today's changes, days for the last week, then the date.
 */
export function updatedText(iso, now = new Date()) {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const ago = now.getTime() - then.getTime();
  const count = (n, word) => `Updated ${n} ${word}${n === 1 ? "" : "s"} ago`;
  if (ago < MINUTE) return "Updated just now";
  if (ago < HOUR) return count(Math.floor(ago / MINUTE), "minute");
  if (ago < 24 * HOUR) return count(Math.floor(ago / HOUR), "hour");
  const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((midnight(now) - midnight(then)) / (24 * HOUR));
  if (days <= 1) return "Updated yesterday";
  if (days < 7) return count(days, "day");
  return `Updated ${dayText({ year: then.getFullYear(), month: then.getMonth() + 1, day: then.getDate() }, now)}`;
}

const LEVELS = ["Low", "Medium", "High"];

/** The confidence meter: three bars, filled up to the level (Low 1, Medium 2, High 3). */
export function confidenceBars(confidence) {
  const filled = LEVELS.indexOf(confidence) + 1;
  return LEVELS.map((_, i) => i < filled);
}

const MAX_DOTS = 10;

/**
 * Recurrence: one dot per occasion (a triggered time window, counted by code). Past 10 the
 * dots stop and the words carry the count.
 */
export function occasionDots(occasions) {
  const n = Math.max(0, Math.floor(Number(occasions) || 0));
  return { dots: Math.min(n, MAX_DOTS), more: Math.max(0, n - MAX_DOTS), text: `${n} occasion${n === 1 ? "" : "s"}` };
}

/** The status as the pill shows it. Only the wording changes; the status rules are in threads.js. */
export const statusLabel = (status) => (status === "Flagged" ? "Flagged for review" : status);

/**
 * Source of a claim: one look per trust label, everywhere. Copper = records, teal = policy,
 * purple dashed = suggested (needs a decision), amber = staff input. Inferred (proposed by
 * Threadline, unconfirmed) is dashed too; Historical is a past decision or outcome.
 */
export const TRUST_KINDS = {
  Observed: { className: "tag-observed", dashed: false, means: "From the records" },
  Authoritative: { className: "tag-authoritative", dashed: false, means: "From policy" },
  Suggested: { className: "tag-suggested", dashed: true, means: "Suggested by Threadline: needs a decision" },
  Experiential: { className: "tag-experiential", dashed: false, means: "Staff input" },
  Inferred: { className: "tag-inferred", dashed: true, means: "Proposed by Threadline: unconfirmed" },
  Historical: { className: "tag-historical", dashed: false, means: "An earlier decision or outcome" },
};

/** The look for one trust label. A label we don't know is shown as unconfirmed, never as a record. */
export const trustKind = (label) => ({ label, ...(TRUST_KINDS[label] ?? TRUST_KINDS.Inferred) });
